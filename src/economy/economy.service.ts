import { Inject, Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { INDEX_SCALE, CATEGORIES, nextIndex, divRound, applyBasisPoints, type Indices } from './math';
import { nextPeriod } from './calendar';
import { settleLoan } from './loan';
import { scenarioById } from './scenarios';
import { CITY_BUILDINGS } from '../city/buildings';
import { BUSINESS_MODELS } from '../city/business-models';
import { MARKET_PRODUCTS, marketChangeBps, type MarketCategory } from './market';
import { FUNDS, INSURANCE_PLANS } from '../game/systems';

const money = (value: unknown) => BigInt(String(value));
const sqlMoney = (value: bigint) => value.toString();

@Injectable()
export class EconomyService {
  constructor(@Inject('PG_POOL') private readonly pool: Pool) {}

  async getIndices(roomId: string, periodKey: string) {
    nextPeriod(periodKey);
    const result = await this.pool.query(
      `SELECT p.scenario_id, p.status, i.category, i.index_units
       FROM economic_periods p JOIN price_indices i ON i.room_id=p.room_id AND i.period_key=p.period_key
       WHERE p.room_id=$1 AND p.period_key=$2 ORDER BY i.category`, [roomId, periodKey],
    );
    if (!result.rowCount) return null;
    return {
      roomId, periodKey,
      scenarioId: String(result.rows[0].scenario_id),
      status: String(result.rows[0].status),
      indexScale: INDEX_SCALE.toString(),
      indices: Object.fromEntries(result.rows.map(row => [String(row.category), String(row.index_units)])),
    };
  }

  async getIndexHistory(roomId: string, limit = 12) {
    const result = await this.pool.query(`SELECT p.period_key,p.scenario_id,i.category,i.index_units
      FROM (SELECT room_id,period_key,scenario_id FROM economic_periods WHERE room_id=$1 AND status='published'
        ORDER BY period_key DESC LIMIT $2) p
      JOIN price_indices i ON i.room_id=p.room_id AND i.period_key=p.period_key
      ORDER BY p.period_key,i.category`, [roomId, Math.max(1, Math.min(24, Math.trunc(limit)))]);
    const periods = new Map<string, { periodKey: string; scenarioId: string; indices: Record<string, string> }>();
    for (const row of result.rows) {
      const key = String(row.period_key);
      let period = periods.get(key);
      if (!period) {
        period = { periodKey: key, scenarioId: String(row.scenario_id), indices: {} };
        periods.set(key, period);
      }
      period.indices[String(row.category)] = String(row.index_units);
    }
    return [...periods.values()];
  }

  async settlePeriod(roomId: string, periodKey: string, scenarioId: string) {
    // Validate inputs before touching the database.
    nextPeriod(periodKey);
    const scenario = scenarioById(scenarioId);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [roomId]);
      const existing = await client.query('SELECT status, scenario_id FROM economic_periods WHERE room_id=$1 AND period_key=$2', [roomId, periodKey]);
      if (existing.rowCount) {
        if (existing.rows[0].status !== 'published' || existing.rows[0].scenario_id !== scenarioId) throw new Error('period exists with a different state or scenario');
        await client.query('COMMIT');
        return { roomId, periodKey, scenarioId, alreadySettled: true };
      }
      const latest = await client.query('SELECT period_key FROM economic_periods WHERE room_id=$1 ORDER BY period_key DESC LIMIT 1', [roomId]);
      if (latest.rowCount && nextPeriod(String(latest.rows[0].period_key)) !== periodKey) throw new Error('periods must be settled in order');
      const previousKey = latest.rowCount ? String(latest.rows[0].period_key) : null;
      const previous = Object.fromEntries(CATEGORIES.map(category => [category, INDEX_SCALE])) as Indices;
      if (previousKey) {
        const rows = await client.query('SELECT category, index_units FROM price_indices WHERE room_id=$1 AND period_key=$2', [roomId, previousKey]);
        if (rows.rowCount !== CATEGORIES.length) throw new Error('previous period has incomplete indices');
        for (const row of rows.rows) previous[row.category as keyof Indices] = money(row.index_units);
      }
      await client.query('INSERT INTO economic_periods(room_id,period_key,scenario_id) VALUES ($1,$2,$3)', [roomId, periodKey, scenarioId]);
      const current = Object.fromEntries(CATEGORIES.map(category => [category, nextIndex(previous[category], marketChangeBps(roomId, periodKey, category, scenario.monthlyChangeBps[category]))])) as Indices;
      const event = await client.query('SELECT card_id FROM room_event_cards WHERE room_id=$1 AND period_key=$2', [roomId,periodKey]);
      if (event.rows[0]?.card_id === 'supply_shock') current.equipment = nextIndex(current.equipment,1000n);
      for (const category of CATEGORIES) {
        await client.query('INSERT INTO price_indices(room_id,period_key,category,index_units) VALUES ($1,$2,$3,$4)', [roomId, periodKey, category, sqlMoney(current[category])]);
      }
      const positions = await client.query('SELECT player_id,category,market_value_tomans FROM investment_positions WHERE room_id=$1 ORDER BY player_id,category FOR UPDATE', [roomId]);
      for (const position of positions.rows) {
        const category = String(position.category) as keyof Indices;
        const updated = divRound(money(position.market_value_tomans) * current[category], previous[category]);
        await client.query('UPDATE investment_positions SET market_value_tomans=$4 WHERE room_id=$1 AND player_id=$2 AND category=$3',
          [roomId, position.player_id, category, sqlMoney(updated)]);
      }
      const funds = await client.query('SELECT player_id,fund_id,market_value_tomans FROM fund_positions WHERE room_id=$1 ORDER BY player_id,fund_id FOR UPDATE',[roomId]);
      for(const position of funds.rows) {
        const fund=FUNDS.find(f=>f.id===String(position.fund_id)); if(!fund) continue;
        let nextValue=0n; const value=money(position.market_value_tomans);
        for(const [category,weight] of Object.entries(fund.allocations) as Array<[keyof Indices,bigint]>) nextValue += divRound(value*weight*current[category],10_000n*previous[category]);
        nextValue -= nextValue*BigInt(fund.annualFeeBps)/120_000n;
        await client.query('UPDATE fund_positions SET market_value_tomans=$4 WHERE room_id=$1 AND player_id=$2 AND fund_id=$3',[roomId,position.player_id,position.fund_id,sqlMoney(nextValue<0n?0n:nextValue)]);
      }
      const accounts = await client.query('SELECT * FROM economy_accounts WHERE room_id=$1 ORDER BY id FOR UPDATE', [roomId]);
      const cityLevels = await client.query('SELECT player_id,building_id,level FROM city_buildings WHERE room_id=$1 ORDER BY player_id,building_id', [roomId]);
      const cityIncome = new Map<string, Array<{ buildingId: string; amount: bigint }>>();
      for (const row of cityLevels.rows) {
        const building = CITY_BUILDINGS.find(item => item.id === String(row.building_id));
        if (!building || building.monthlyIncome === 0n) continue;
        let amount = building.monthlyIncome * BigInt(row.level);
        if (building.indexCategory) amount = divRound(amount * current[building.indexCategory], INDEX_SCALE);
        const accountId = String(row.player_id);
        const sources = cityIncome.get(accountId) ?? [];
        sources.push({ buildingId: building.id, amount });
        cityIncome.set(accountId, sources);
      }
      const balances = new Map<string, bigint>();
      for (const account of accounts.rows) {
        const id = String(account.id);
        if (account.last_settled_period && account.last_settled_period !== previousKey) throw new Error(`account ${id} missed a period`);
        let cash = money(account.cash_tomans);
        const salary = applyBasisPoints(money(account.monthly_salary_tomans), 10_000n + scenario.wageChangeBps);
        const rent = divRound(money(account.monthly_rent_tomans) * current.housing, previous.housing);
        cash += salary;
        if (salary) await this.ledger(client, roomId, periodKey, id, 'salary', id, salary, cash);
        for (const income of cityIncome.get(id) ?? []) {
          cash += income.amount;
          await this.ledger(client, roomId, periodKey, id, 'city_income', `${periodKey}:${income.buildingId}`, income.amount, cash);
        }
        const oldRent = await client.query('SELECT period_key,amount_tomans,paid_tomans FROM rent_arrears WHERE room_id=$1 AND account_id=$2 AND paid_tomans<amount_tomans ORDER BY period_key FOR UPDATE', [roomId, id]);
        const oldRentDue = oldRent.rows.reduce<bigint>((sum, row) => sum + money(row.amount_tomans) - money(row.paid_tomans), 0n);
        const totalRentDue = oldRentDue + rent;
        const rentPaid = cash < totalRentDue ? cash : totalRentDue;
        let allocatable = rentPaid;
        for (const row of oldRent.rows) {
          const outstanding = money(row.amount_tomans) - money(row.paid_tomans);
          const allocation = allocatable < outstanding ? allocatable : outstanding;
          if (allocation > 0n) await client.query('UPDATE rent_arrears SET paid_tomans=paid_tomans+$4 WHERE room_id=$1 AND account_id=$2 AND period_key=$3', [roomId, id, row.period_key, sqlMoney(allocation)]);
          allocatable -= allocation;
        }
        cash -= rentPaid;
        if (rentPaid) await this.ledger(client, roomId, periodKey, id, 'rent', id, -rentPaid, cash);
        // Current unpaid rent becomes an explicit claim; older claims retain their unpaid balance.
        if (allocatable < rent) await client.query(
          'INSERT INTO rent_arrears(room_id,account_id,period_key,amount_tomans) VALUES ($1,$2,$3,$4)',
          [roomId, id, periodKey, sqlMoney(rent - allocatable)],
        );
        await client.query('UPDATE economy_accounts SET monthly_salary_tomans=$3,monthly_rent_tomans=$4 WHERE id=$1 AND room_id=$2', [id, roomId, sqlMoney(salary), sqlMoney(rent)]);
        balances.set(id, cash);
      }
      const branchRows = await client.query(`SELECT b.id,b.model_id,b.branch_number,b.level,b.manager_enabled,b.unpaid_expenses_tomans,b.retained_earnings_tomans,
        o.player_id,o.share_bps,COALESCE(ps.management,0) AS management,COALESCE(ps.marketing,0) AS marketing FROM business_branches b JOIN business_owners o ON o.business_id=b.id AND o.room_id=b.room_id
        LEFT JOIN player_skills ps ON ps.room_id=o.room_id AND ps.player_id=o.player_id
        WHERE b.room_id=$1 ORDER BY b.id,o.player_id FOR UPDATE OF b,o`, [roomId]);
      const branches = new Map<string, { modelId: string; level: number; manager: boolean; unpaid: bigint; retained: bigint; owners: Array<{ playerId: string; shareBps: number; management:number; marketing:number }> }>();
      for (const row of branchRows.rows) {
        const id = String(row.id);
        const branch = branches.get(id) ?? { modelId: String(row.model_id), level: Number(row.level), manager: Boolean(row.manager_enabled), unpaid: money(row.unpaid_expenses_tomans), retained: money(row.retained_earnings_tomans), owners: [] };
        branch.owners.push({ playerId: String(row.player_id), shareBps: Number(row.share_bps), management:Number(row.management),marketing:Number(row.marketing) });
        branches.set(id, branch);
      }
      for (const [businessId, branch] of branches) {
        const model = BUSINESS_MODELS.find(item => item.id === branch.modelId);
        if (!model) throw new Error(`business model ${branch.modelId} is not configured`);
        const level = BigInt(branch.level);
        const management=branch.owners.reduce((sum,owner)=>sum+BigInt(owner.management*owner.shareBps),0n)/10_000n;
        const marketing=branch.owners.reduce((sum,owner)=>sum+BigInt(owner.marketing*owner.shareBps),0n)/10_000n;
        let revenue = divRound(model.baseRevenue * level * current[model.salesIndex], previous[model.salesIndex]);
        if (!branch.manager) revenue = divRound(revenue * 8_500n, 10_000n);
        revenue = divRound(revenue * (10_000n + marketing * 100n),10_000n);
        const materials = divRound(model.materialsCost * level * current[model.materialsIndex], previous[model.materialsIndex]);
        const payroll = divRound(applyBasisPoints(model.payrollCost * level, 10_000n + scenario.wageChangeBps) * (10_000n - management * 50n),10_000n);
        const overhead = divRound(model.overheadCost * level * current.housing, previous.housing);
        const managerCost = branch.manager ? divRound(revenue * 800n, 10_000n) : 0n;
        const operatingProfit = revenue - materials - payroll - overhead - managerCost;
        let unpaid = branch.unpaid;
        let retained = branch.retained;
        let distributable = 0n;
        if (operatingProfit < 0n) {
          const loss = -operatingProfit;
          const reserveUse = retained < loss ? retained : loss;
          retained -= reserveUse;
          unpaid += loss - reserveUse;
        } else {
          let surplus = operatingProfit;
          const debtPayment = surplus < unpaid ? surplus : unpaid;
          surplus -= debtPayment; unpaid -= debtPayment;
          const reserveAddition = surplus / 10n;
          retained += reserveAddition;
          distributable = surplus - reserveAddition;
        }
        let distributed = 0n;
        for (const owner of branch.owners) {
          const payout = distributable * BigInt(owner.shareBps) / 10_000n;
          if (payout > 0n) {
            const cash = balances.get(owner.playerId);
            if (cash === undefined) throw new Error('business owner account missing');
            balances.set(owner.playerId, cash + payout);
            await this.ledger(client, roomId, periodKey, owner.playerId, 'business_income', `${businessId}:${periodKey}`, payout, cash + payout);
            await client.query(`INSERT INTO business_ledger(room_id,business_id,period_key,player_id,entry_kind,amount_tomans)
              VALUES ($1,$2,$3,$4,'profit_distribution',$5)`, [roomId, businessId, periodKey, owner.playerId, payout.toString()]);
            distributed += payout;
          }
        }
        retained += distributable - distributed;
        await client.query(`UPDATE business_branches SET unpaid_expenses_tomans=$3,retained_earnings_tomans=$4 WHERE room_id=$1 AND id=$2`,
          [roomId, businessId, unpaid.toString(), retained.toString()]);
        await client.query(`INSERT INTO business_period_results(room_id,period_key,business_id,revenue_tomans,materials_cost_tomans,payroll_cost_tomans,overhead_cost_tomans,manager_cost_tomans,net_profit_tomans,distributed_tomans,retained_tomans,unpaid_expenses_tomans)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [roomId, periodKey, businessId, revenue.toString(), materials.toString(), payroll.toString(), overhead.toString(), managerCost.toString(), operatingProfit.toString(), distributed.toString(), retained.toString(), unpaid.toString()]);
        const entries: Array<[string, bigint]> = [['revenue', revenue], ['materials', -materials], ['payroll', -payroll], ['overhead', -overhead], ['manager', -managerCost], ['retained', retained]];
        for (const [kind, amount] of entries) if (amount !== 0n) await client.query(`INSERT INTO business_ledger(room_id,business_id,period_key,entry_kind,amount_tomans) VALUES ($1,$2,$3,$4,$5)`,
          [roomId, businessId, periodKey, kind, amount.toString()]);
      }
      // The delegate reserves mandatory payments and one extra month of obligations, then invests 25% of remaining free cash.
      const submitted = await client.query('SELECT player_id FROM player_decisions WHERE room_id=$1 AND period_key=$2', [roomId, periodKey]);
      const submittedPlayers = new Set(submitted.rows.map(row => String(row.player_id)));
      const botRows = await client.query("SELECT player_id,bot_style,bot_difficulty FROM room_members WHERE room_id=$1 AND is_bot=true", [roomId]);
      const bots = new Map(botRows.rows.map(row => [String(row.player_id), { style: String(row.bot_style), difficulty: String(row.bot_difficulty ?? 'normal') }]));
      const policyRows = await client.query('SELECT player_id,enabled,strategy,reserve_months,invest_surplus_bps FROM autopilot_policies WHERE room_id=$1', [roomId]);
      const policies = new Map(policyRows.rows.map(row => [String(row.player_id), row]));
      for (const account of accounts.rows) {
        const playerId = String(account.id);
        if (submittedPlayers.has(playerId)) continue;
        const cash = balances.get(playerId) ?? 0n;
        const dueChecks = await client.query("SELECT COALESCE(SUM(amount_tomans),0)::text AS total FROM checks WHERE room_id=$1 AND issuer_id=$2 AND due_period<=$3 AND status='pending'", [roomId, playerId, periodKey]);
        let loanDue = 0n;
        const activeLoans = await client.query('SELECT * FROM loans WHERE room_id=$1 AND borrower_id=$2 AND (principal_tomans>0 OR arrears_interest_tomans>0 OR arrears_fee_tomans>0)', [roomId, playerId]);
        for (const loan of activeLoans.rows) {
          const rate = loan.rate_kind === 'fixed' ? money(loan.fixed_annual_rate_bps) : scenario.referenceAnnualRateBps + money(loan.variable_margin_bps);
          loanDue += settleLoan({ principal: money(loan.principal_tomans), arrearsInterest: money(loan.arrears_interest_tomans),
            arrearsPrincipal: money(loan.arrears_principal_tomans), arrearsFee: money(loan.arrears_fee_tomans),
            monthsRemaining: Number(loan.months_remaining), monthlyPenaltyBps: money(loan.monthly_penalty_bps) }, rate, 9_223_372_036_854_775_807n).due;
        }
        const rentBuffer = money(account.monthly_rent_tomans);
        const mandatory = money(dueChecks.rows[0]?.total ?? 0) + loanDue;
        const bot = bots.get(playerId);
        const style = bot?.style;
        const policy = policies.get(playerId);
        const strategy = style === 'entrepreneur' || style === 'opportunist' ? 'growth' : style === 'conservative' ? 'reserve' : String(policy?.strategy ?? 'balanced');
        const enabled = style ? true : policy?.enabled !== false;
        const reserveMonths = style === 'conservative' ? 3n : style === 'consumer' ? 1n : style === 'analyst' ? 2n : style ? 1n : BigInt(Number(policy?.reserve_months ?? 1));
        const baseInvestBps = style === 'entrepreneur' ? 5500n : style === 'opportunist' ? 4500n : style === 'conservative' ? 1000n : style === 'consumer' ? 0n : style === 'analyst' ? 2500n : style === 'balanced' ? 3000n : BigInt(Number(policy?.invest_surplus_bps ?? 2500));
        const difficultyMultiplier = bot?.difficulty === 'hard' ? 11_000n : bot?.difficulty === 'easy' ? 7_500n : 10_000n;
        const investBps = baseInvestBps * difficultyMultiplier / 10_000n;
        const buffer = rentBuffer * reserveMonths + loanDue;
        const surplus = cash > mandatory + buffer ? cash - mandatory - buffer : 0n;
        const investAmount = surplus * investBps / 10_000n;
        const investableCategories = ['car', 'gold', 'currency', 'equipment', 'materials'] as const;
        const preferredCategory = style === 'conservative' && (scenario.id === 'high_inflation' || scenario.id === 'market_shock') ? 'currency'
          : style === 'conservative' ? 'gold' : style === 'entrepreneur' ? 'materials'
          : style === 'consumer' ? 'car' : undefined;
        const chosenCategory = preferredCategory ?? [...investableCategories].sort((a, b) => Number(scenario.monthlyChangeBps[b] - scenario.monthlyChangeBps[a]))[0];
        const minimumTrend = style === 'analyst' ? 25n : 0n;
        const shouldInvest = enabled && investAmount >= 100_000n && scenario.monthlyChangeBps[chosenCategory] > minimumTrend && style !== 'consumer';
        await client.query(`INSERT INTO player_decisions(room_id,period_key,player_id,action_type,category,amount_tomans,status,reason)
          VALUES ($1,$2,$3,$4,$5,$6,'delegated',$7)`, [roomId, periodKey, playerId, shouldInvest ? 'buy' : 'hold',
          shouldInvest ? chosenCategory : null, shouldInvest ? sqlMoney(investAmount) : '0',
          shouldInvest ? `رقیب ${style} (${bot?.difficulty ?? 'normal'}): خرید ${chosenCategory} با ${investBps / 100n}٪ از مازاد آزاد`
            : style === 'consumer' ? 'رقیب خوش‌گذران: فعلاً خرید نکرد و ذخیرهٔ هزینه‌های جاری را نگه داشت'
              : style ? `رقیب ${style}: نقدینگی و ذخیرهٔ ${reserveMonths}ماهه را حفظ کرد`
                : !enabled ? 'نمایندهٔ خودکار غیرفعال بود؛ نقد حفظ شد' : 'نمایندهٔ خودکار: نقد برای هزینه‌های ضروری و ذخیره حفظ شد']);
      }
      const decisions = await client.query(`SELECT * FROM player_decisions WHERE room_id=$1 AND period_key=$2 ORDER BY player_id FOR UPDATE`, [roomId, periodKey]);
      for (const decision of decisions.rows) {
        const playerId = String(decision.player_id);
        const available = balances.get(playerId);
        if (available === undefined) throw new Error('decision account missing');
        if (decision.action_type === 'hold') {
          await client.query(`UPDATE player_decisions SET status=CASE WHEN status='delegated' THEN 'delegated' ELSE 'executed' END,
            processed_at=now() WHERE room_id=$1 AND period_key=$2 AND player_id=$3`, [roomId, periodKey, playerId]);
          continue;
        }
        const amount = money(decision.amount_tomans);
        const category = String(decision.category);
        const fee = applyBasisPoints(amount, MARKET_PRODUCTS[category as MarketCategory]?.feeBps ?? 0n);
        let rejection: string | null = null;
        if (decision.action_type === 'buy') {
          if (available < amount) rejection = 'insufficient_cash';
          else if (amount <= fee) rejection = 'amount_below_fee';
          else {
            balances.set(playerId, available - amount);
            await client.query(`INSERT INTO investment_positions(room_id,player_id,category,market_value_tomans) VALUES ($1,$2,$3,$4)
              ON CONFLICT (room_id,player_id,category) DO UPDATE SET market_value_tomans=investment_positions.market_value_tomans+EXCLUDED.market_value_tomans`,
              [roomId, playerId, category, sqlMoney(amount - fee)]);
            await this.ledger(client, roomId, periodKey, playerId, 'asset_buy', `${periodKey}:${category}`, -(amount - fee), available - amount + fee);
            if (fee) await this.ledger(client, roomId, periodKey, playerId, 'market_fee', `${periodKey}:${category}`, -fee, available - amount);
          }
        } else {
          const held = await client.query('SELECT market_value_tomans FROM investment_positions WHERE room_id=$1 AND player_id=$2 AND category=$3 FOR UPDATE', [roomId, playerId, category]);
          const marketValue = held.rowCount ? money(held.rows[0].market_value_tomans) : 0n;
          if (marketValue < amount) rejection = 'insufficient_position';
          else {
            balances.set(playerId, available + amount - fee);
            await client.query('UPDATE investment_positions SET market_value_tomans=market_value_tomans-$4 WHERE room_id=$1 AND player_id=$2 AND category=$3',
              [roomId, playerId, category, sqlMoney(amount)]);
            await this.ledger(client, roomId, periodKey, playerId, 'asset_sell', `${periodKey}:${category}`, amount, available + amount);
            if (fee) await this.ledger(client, roomId, periodKey, playerId, 'market_fee', `${periodKey}:${category}`, -fee, available + amount - fee);
          }
        }
        await client.query(`UPDATE player_decisions SET status=CASE WHEN status='delegated' THEN 'delegated' ELSE $4 END,
          reason=COALESCE($5,reason),processed_at=now() WHERE room_id=$1 AND period_key=$2 AND player_id=$3`,
          [roomId, periodKey, playerId, rejection ? 'rejected' : 'executed', rejection]);
      }
      const checks = await client.query("SELECT * FROM checks WHERE room_id=$1 AND due_period <= $2 AND status = 'pending' ORDER BY due_period,id FOR UPDATE", [roomId, periodKey]);
      for (const check of checks.rows) {
        const issuer = String(check.issuer_id);
        const payee = String(check.payee_id);
        const amount = money(check.amount_tomans);
        const available = balances.get(issuer);
        if (available === undefined || !balances.has(payee)) throw new Error('check account missing');
        if (available >= amount) {
          balances.set(issuer, available - amount);
          balances.set(payee, balances.get(payee)! + amount);
          await this.ledger(client, roomId, periodKey, issuer, 'check_debit', String(check.id), -amount, balances.get(issuer)!);
          await this.ledger(client, roomId, periodKey, payee, 'check_credit', String(check.id), amount, balances.get(payee)!);
          await client.query("UPDATE checks SET status='paid',settled_period=$3 WHERE id=$1 AND room_id=$2", [check.id, roomId, periodKey]);
        } else {
          await client.query("UPDATE checks SET status='bounced',settled_period=$3 WHERE id=$1 AND room_id=$2", [check.id, roomId, periodKey]);
          await this.invokeCheckGuarantees(client, roomId, periodKey, String(check.id), payee, amount, balances);
        }
      }
      const loans = await client.query('SELECT * FROM loans WHERE room_id=$1 AND (principal_tomans > 0 OR arrears_interest_tomans > 0 OR arrears_fee_tomans > 0) ORDER BY borrower_id,id FOR UPDATE', [roomId]);
      for (const loan of loans.rows) {
        const borrower = String(loan.borrower_id);
        const available = balances.get(borrower);
        if (available === undefined) throw new Error('borrower account missing');
        const annualRate = loan.rate_kind === 'fixed'
          ? money(loan.fixed_annual_rate_bps)
          : scenario.referenceAnnualRateBps + money(loan.variable_margin_bps);
        const oldArrears = money(loan.arrears_interest_tomans) + money(loan.arrears_principal_tomans) + money(loan.arrears_fee_tomans);
        const result = settleLoan({
          principal: money(loan.principal_tomans),
          arrearsInterest: money(loan.arrears_interest_tomans),
          arrearsPrincipal: money(loan.arrears_principal_tomans),
          arrearsFee: money(loan.arrears_fee_tomans),
          monthsRemaining: Number(loan.months_remaining),
          monthlyPenaltyBps: money(loan.monthly_penalty_bps),
        }, annualRate, available);
        balances.set(borrower, available - result.paid);
        if (result.paid) await this.ledger(client, roomId, periodKey, borrower, 'loan_payment', String(loan.id), -result.paid, balances.get(borrower)!);
        if (result.paid && loan.lender_id) {
          const lenderId = String(loan.lender_id);
          const lenderBalance = balances.get(lenderId);
          if (lenderBalance === undefined) throw new Error('player loan lender account missing');
          balances.set(lenderId, lenderBalance + result.paid);
          await this.ledger(client, roomId, periodKey, lenderId, 'p2p_loan_repayment_received', String(loan.id), result.paid, lenderBalance + result.paid);
          const contract = await client.query('SELECT id FROM player_contracts WHERE room_id=$1 AND loan_id=$2', [roomId, loan.id]);
          if (contract.rowCount) {
            for (const [playerId, kind, cashChange, balance] of [
              [borrower, 'loan_repayment', -result.paid, available - result.paid],
              [lenderId, 'loan_repayment_received', result.paid, lenderBalance + result.paid],
            ] as const) {
              await client.query(`INSERT INTO player_contract_ledger(room_id,period_key,contract_id,player_id,entry_kind,cash_change_tomans,cash_balance_after_tomans)
                VALUES ($1,$2,$3,$4,$5,$6,$7)`, [roomId, periodKey, contract.rows[0].id, playerId, kind, cashChange.toString(), balance.toString()]);
            }
          }
        }
        const next = result.next;
        await client.query(`UPDATE loans SET principal_tomans=$3,arrears_interest_tomans=$4,
          arrears_principal_tomans=$5,arrears_fee_tomans=$6,months_remaining=$7 WHERE id=$1 AND room_id=$2`,
          [loan.id, roomId, sqlMoney(next.principal), sqlMoney(next.arrearsInterest), sqlMoney(next.arrearsPrincipal), sqlMoney(next.arrearsFee), next.monthsRemaining]);
        const arrears = next.arrearsInterest + next.arrearsPrincipal + next.arrearsFee;
        if (arrears > oldArrears) await this.claimGuarantees(client, roomId, periodKey, 'loan_id', String(loan.id), arrears - oldArrears, 'loan_arrears');
      }
      // Old guarantee claims are repaid gradually, after rent, checks, and scheduled loan payments.
      const claims = await client.query(`SELECT gc.id,gc.amount_tomans,gc.paid_tomans,g.guarantor_id,ea.monthly_salary_tomans
        FROM guarantee_claims gc JOIN guarantees g ON g.id=gc.guarantee_id AND g.room_id=gc.room_id
        JOIN economy_accounts ea ON ea.id=g.guarantor_id AND ea.room_id=g.room_id
        WHERE g.room_id=$1 AND gc.restructured_at IS NULL AND gc.period_key<$2 AND gc.paid_tomans<gc.amount_tomans
        ORDER BY gc.period_key,g.guarantor_id,gc.id FOR UPDATE OF gc`, [roomId, periodKey]);
      const claimBudgets = new Map<string, bigint>();
      for (const claim of claims.rows) {
        const guarantor = String(claim.guarantor_id);
        const available = balances.get(guarantor) ?? 0n;
        const budget = claimBudgets.get(guarantor) ?? money(claim.monthly_salary_tomans) / 10n;
        const outstanding = money(claim.amount_tomans) - money(claim.paid_tomans);
        const paid = [available, budget, outstanding].reduce((smallest, value) => value < smallest ? value : smallest);
        if (paid <= 0n) continue;
        balances.set(guarantor, available - paid);
        claimBudgets.set(guarantor, budget - paid);
        await client.query('UPDATE guarantee_claims SET paid_tomans=paid_tomans+$2 WHERE id=$1', [claim.id, sqlMoney(paid)]);
        await this.ledger(client, roomId, periodKey, guarantor, 'guarantee_claim_payment', String(claim.id), -paid, available - paid);
      }
      const choices=await client.query('SELECT player_id,choice FROM player_event_choices WHERE room_id=$1 AND period_key=$2',[roomId,periodKey]);
      const eventId=String(event.rows[0]?.card_id??'');
      for(const item of choices.rows) {
        const player=String(item.player_id), choice=String(item.choice);
        if(eventId==='mentor_visit'&&['management','negotiation','marketing'].includes(choice)) await client.query(`UPDATE player_skills SET ${choice}=LEAST(10,${choice}+1) WHERE room_id=$1 AND player_id=$2`,[roomId,player]);
        if(eventId==='city_contract'&&choice==='accept') {
          const available=balances.get(player)??0n; if(available>=500_000n) {
            balances.set(player,available-500_000n);
            await client.query(`INSERT INTO investment_positions(room_id,player_id,category,market_value_tomans) VALUES ($1,$2,'gold','550000') ON CONFLICT(room_id,player_id,category) DO UPDATE SET market_value_tomans=investment_positions.market_value_tomans+550000`,[roomId,player]);
            await this.ledger(client,roomId,periodKey,player,'event_opportunity_buy',periodKey,-500_000n,available-500_000n);
          }
        }
      }
      const activePolicies=await client.query('SELECT * FROM insurance_policies WHERE room_id=$1 AND active=true ORDER BY player_id,plan_id FOR UPDATE',[roomId]);
      for(const policy of activePolicies.rows) {
        const player=String(policy.player_id), planId=String(policy.plan_id), available=balances.get(player)??0n, premium=money(policy.premium_tomans);
        const paid=available<premium?available:premium;
        if(paid>0n){balances.set(player,available-paid);await this.ledger(client,roomId,periodKey,player,'insurance_premium',String(policy.id),-paid,available-paid);}
        let reason:string|null=null;
        if(planId==='crisis'&&eventId==='supply_shock')reason='supply_shock';
        if(planId==='business'&&eventId==='business_disruption')reason='business_loss';
        if(reason&&paid===premium){const exists=await client.query('SELECT 1 FROM insurance_claims WHERE policy_id=$1 AND period_key=$2 AND reason=$3',[policy.id,periodKey,reason]);if(!exists.rowCount){const claim=money(policy.coverage_tomans);balances.set(player,(balances.get(player)??0n)+claim);await client.query('INSERT INTO insurance_claims(room_id,period_key,policy_id,amount_tomans,reason) VALUES ($1,$2,$3,$4,$5)',[roomId,periodKey,policy.id,sqlMoney(claim),reason]);await this.ledger(client,roomId,periodKey,player,'insurance_claim',String(policy.id),claim,(balances.get(player)??0n));}}
      }
      const auctions=await client.query("SELECT * FROM player_auctions WHERE room_id=$1 AND period_key<=$2 AND status='open' ORDER BY created_at FOR UPDATE",[roomId,periodKey]);
      for(const auction of auctions.rows){
        const bids=await client.query('SELECT bidder_id,bid_tomans FROM player_auction_bids WHERE auction_id=$1 ORDER BY bid_tomans DESC,updated_at',[auction.id]);
        const seller=String(auction.seller_id), category=String(auction.asset_category); let winner:{bidder:string;amount:bigint}|null=null;
        for(const bid of bids.rows){const bidder=String(bid.bidder_id), amount=money(bid.bid_tomans);if(amount<money(auction.reserve_price_tomans))continue;const balance=balances.get(bidder)??0n;if(balance>=amount){winner={bidder,amount};break;}}
        if(!winner){await client.query("UPDATE player_auctions SET status='no_sale' WHERE id=$1",[auction.id]);continue;}
        const sellerBalance=balances.get(seller)??0n,buyerBalance=balances.get(winner.bidder)!;
        await client.query('UPDATE investment_positions SET market_value_tomans=market_value_tomans-$4 WHERE room_id=$1 AND player_id=$2 AND category=$3',[roomId,seller,category,String(auction.asset_value_tomans)]);
        await client.query(`INSERT INTO investment_positions(room_id,player_id,category,market_value_tomans) VALUES ($1,$2,$3,$4) ON CONFLICT(room_id,player_id,category) DO UPDATE SET market_value_tomans=investment_positions.market_value_tomans+EXCLUDED.market_value_tomans`,[roomId,winner.bidder,category,String(auction.asset_value_tomans)]);
        balances.set(seller,sellerBalance+winner.amount);balances.set(winner.bidder,buyerBalance-winner.amount);
        await this.ledger(client,roomId,periodKey,seller,'auction_sale',String(auction.id),winner.amount,sellerBalance+winner.amount);
        await this.ledger(client,roomId,periodKey,winner.bidder,'auction_purchase',String(auction.id),-winner.amount,buyerBalance-winner.amount);
        await client.query("UPDATE player_auctions SET status='sold',winner_id=$2,winning_bid_tomans=$3 WHERE id=$1",[auction.id,winner.bidder,sqlMoney(winner.amount)]);
      }
      const life=await client.query(`SELECT rm.player_id,COUNT(DISTINCT b.id)::integer AS branches,COALESCE(SUM(CASE WHEN cb.building_id='park' THEN cb.level ELSE 0 END),0)::integer AS parks,COALESCE(SUM(CASE WHEN cb.building_id='homes' THEN cb.level ELSE 0 END),0)::integer AS homes,COALESCE(SUM(CASE WHEN cb.building_id='civic' THEN cb.level ELSE 0 END),0)::integer AS civic,COALESCE(ea.cash_tomans,0)::bigint AS cash,COALESCE(ea.monthly_rent_tomans,0)::bigint AS rent
        FROM room_members rm LEFT JOIN business_owners bo ON bo.room_id=rm.room_id AND bo.player_id=rm.player_id LEFT JOIN business_branches b ON b.id=bo.business_id
        LEFT JOIN city_buildings cb ON cb.room_id=rm.room_id AND cb.player_id=rm.player_id LEFT JOIN economy_accounts ea ON ea.room_id=rm.room_id AND ea.id=rm.player_id WHERE rm.room_id=$1 GROUP BY rm.player_id,ea.cash_tomans,ea.monthly_rent_tomans`,[roomId]);
      for(const row of life.rows){const cash=balances.get(String(row.player_id))??money(row.cash), rent=money(row.rent), parks=Number(row.parks), homes=Number(row.homes), civic=Number(row.civic), branches=Number(row.branches);const free=Math.max(0,Math.min(100,100-branches*12));const health=Math.max(0,Math.min(100,60+parks*8+homes*3));const security=Math.max(0,Math.min(100,30+Number(cash*40n/(rent>0n?rent:1_000_000n))+civic*5));await client.query('INSERT INTO wellbeing_scores(room_id,player_id,period_key,free_time,health,security) VALUES ($1,$2,$3,$4,$5,$6)',[roomId,row.player_id,periodKey,free,health,security]);}
      await client.query(`UPDATE player_skills SET experience_points=experience_points+1,skill_points=LEAST(99,skill_points+CASE WHEN (experience_points+1)%2=0 THEN 1 ELSE 0 END) WHERE room_id=$1`,[roomId]);
      await client.query(`UPDATE player_challenges c SET completed=true,completed_period=$2 FROM room_members rm WHERE c.room_id=$1 AND c.player_id=rm.player_id AND c.challenge_id='debt_exit' AND c.completed=false AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.room_id=$1 AND l.borrower_id=c.player_id AND (l.principal_tomans>0 OR l.arrears_interest_tomans>0 OR l.arrears_principal_tomans>0 OR l.arrears_fee_tomans>0)) AND NOT EXISTS (SELECT 1 FROM rent_arrears r WHERE r.room_id=$1 AND r.account_id=c.player_id AND r.paid_tomans<r.amount_tomans)`,[roomId,periodKey]);
      for (const [id, cash] of balances) {
        await client.query('UPDATE economy_accounts SET cash_tomans=$3,last_settled_period=$4 WHERE id=$1 AND room_id=$2', [id, roomId, sqlMoney(cash), periodKey]);
      }
      await client.query("UPDATE economic_periods SET status='published',settled_at=now() WHERE room_id=$1 AND period_key=$2", [roomId, periodKey]);
      await client.query('COMMIT');
      return { roomId, periodKey, scenarioId, alreadySettled: false, accountsSettled: balances.size };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async ledger(client: PoolClient, roomId: string, period: string, account: string, kind: string, source: string, amount: bigint, balance: bigint) {
    await client.query(`INSERT INTO economy_ledger(room_id,period_key,account_id,source_kind,source_id,amount_tomans,balance_before_tomans,balance_after_tomans)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [roomId, period, account, kind, source, sqlMoney(amount), sqlMoney(balance-amount), sqlMoney(balance)]);
  }

  private async claimGuarantees(client: PoolClient, roomId: string, period: string, targetColumn: 'check_id' | 'loan_id', targetId: string, loss: bigint, reason: string) {
    const guarantees = await client.query(`SELECT * FROM guarantees WHERE room_id=$1 AND ${targetColumn}=$2 ORDER BY id FOR UPDATE`, [roomId, targetId]);
    let uncovered = loss;
    for (const guarantee of guarantees.rows) {
      const room = money(guarantee.cap_tomans) - money(guarantee.claimed_tomans);
      const claim = room < uncovered ? room : uncovered;
      if (claim <= 0n) continue;
      await client.query('UPDATE guarantees SET claimed_tomans=claimed_tomans+$3 WHERE id=$1 AND room_id=$2', [guarantee.id, roomId, sqlMoney(claim)]);
      await client.query('INSERT INTO guarantee_claims(room_id,guarantee_id,period_key,amount_tomans,reason) VALUES ($1,$2,$3,$4,$5)',
        [roomId, guarantee.id, period, sqlMoney(claim), reason]);
      uncovered -= claim;
      if (uncovered === 0n) break;
    }
  }

  private async invokeCheckGuarantees(client: PoolClient, roomId: string, period: string, checkId: string, payee: string, loss: bigint, balances: Map<string, bigint>) {
    const guarantees = await client.query('SELECT * FROM guarantees WHERE room_id=$1 AND check_id=$2 ORDER BY id FOR UPDATE', [roomId, checkId]);
    let uncovered = loss;
    for (const guarantee of guarantees.rows) {
      const capacity = money(guarantee.cap_tomans) - money(guarantee.claimed_tomans);
      const claim = capacity < uncovered ? capacity : uncovered;
      if (claim <= 0n) continue;
      const guarantor = String(guarantee.guarantor_id);
      const available = balances.get(guarantor) ?? 0n;
      const paid = available < claim ? available : claim;
      if (paid > 0n) {
        const payeeBalance = balances.get(payee);
        if (payeeBalance === undefined) throw new Error('check payee account missing');
        balances.set(guarantor, available - paid);
        balances.set(payee, payeeBalance + paid);
        await this.ledger(client, roomId, period, guarantor, 'check_guarantee_debit', `${checkId}:${guarantee.id}`, -paid, available - paid);
        await this.ledger(client, roomId, period, payee, 'check_guarantee_credit', `${checkId}:${guarantee.id}`, paid, payeeBalance + paid);
      }
      await client.query('UPDATE guarantees SET claimed_tomans=claimed_tomans+$3 WHERE id=$1 AND room_id=$2', [guarantee.id, roomId, sqlMoney(claim)]);
      if (claim > paid) {
        await client.query('INSERT INTO guarantee_claims(room_id,guarantee_id,period_key,amount_tomans,reason) VALUES ($1,$2,$3,$4,$5)',
          [roomId, guarantee.id, period, sqlMoney(claim - paid), 'bounced_check']);
      }
      uncovered -= claim;
      if (uncovered === 0n) break;
    }
  }
}
