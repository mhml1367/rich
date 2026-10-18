import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { jalaliDate, nextPeriod, periodKey } from '../economy/calendar';
import { scenarioById } from '../economy/scenarios';
import { MARKET_PRODUCTS, marketQuote, type MarketCategory } from '../economy/market';
import { INDEX_SCALE, CATEGORIES, divRound, realValue, weightedIndex, fixedPayment, type Indices } from '../economy/math';
import { settleLoan } from '../economy/loan';
import { LOAN_PRODUCTS } from '../economy/loan-products';
import { CITY_BUILDINGS } from '../city/buildings';
import { BUSINESS_MODELS } from '../city/business-models';
import { scoreFinancialState } from '../game/scoring';
import { EconomyService } from '../economy/economy.service';
import { RealtimeService } from './realtime.service';
import { SKILLS, FUNDS, INSURANCE_PLANS, EVENT_CARDS } from '../game/systems';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class RoomService {
  private scheduler?: (roomId: string, periodKey: string, deadline: Date) => Promise<void>;

  constructor(
    @Inject('PG_POOL') private readonly pool: Pool,
    @Inject(EconomyService) private readonly economy: EconomyService,
    @Inject(RealtimeService) private readonly realtime: RealtimeService,
  ) {}

  setScheduler(scheduler: (roomId: string, periodKey: string, deadline: Date) => Promise<void>) {
    this.scheduler = scheduler;
  }

  async create(input: { title: string; displayName: string; mode: string; scenarioId: string; turnSeconds?: number; maxPlayers?: number; botCount?: number }, playerAccountId?: string) {
    if (!input || typeof input !== 'object') throw new BadRequestException('room details required');
    const title = this.name(input.title, 80);
    const displayName = this.name(input.displayName, 40);
    const mode = input.mode;
    if (!['solo', 'live', 'async'].includes(mode)) throw new BadRequestException('invalid mode');
    try { scenarioById(input.scenarioId); } catch { throw new BadRequestException('invalid scenario'); }
    const turnSeconds = input.turnSeconds ?? (mode === 'async' ? 86400 : 180);
    if (!Number.isSafeInteger(turnSeconds) || turnSeconds < 30 || turnSeconds > 604800) throw new BadRequestException('invalid turn duration');
    const botCount = input.botCount ?? (mode === 'solo' ? 6 : 0);
    const maxPlayers = input.maxPlayers ?? Math.max(mode === 'solo' ? 7 : 4, botCount + 1);
    if (!Number.isSafeInteger(botCount) || botCount < 0 || botCount > 6 || !Number.isSafeInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 8 || botCount >= maxPlayers) {
      throw new BadRequestException('invalid room capacity or bot count');
    }
    const roomId = randomUUID();
    const playerId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const inviteCode = randomBytes(5).toString('hex').slice(0, 8).toUpperCase();
    const key = periodKey(jalaliDate(new Date()));
    const deadline = new Date(Date.now() + turnSeconds * 1000);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO rooms(id,title,mode,scenario_id,turn_seconds,invite_code,max_players,bot_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [roomId, title, mode, input.scenarioId, turnSeconds, inviteCode, maxPlayers, botCount]);
      await client.query('INSERT INTO room_members(room_id,player_id,display_name,token_hash,player_account_id) VALUES ($1,$2,$3,$4,$5)', [roomId, playerId, displayName, hashToken(token), playerAccountId ?? null]);
      await client.query('INSERT INTO economy_accounts(id,room_id,cash_tomans,monthly_salary_tomans,monthly_rent_tomans) VALUES ($1,$2,$3,$4,$5)',
        [playerId, roomId, '10000000', '6000000', '2000000']);
      await client.query('INSERT INTO autopilot_policies(room_id,player_id) VALUES ($1,$2)', [roomId, playerId]);
      await client.query('INSERT INTO player_skills(room_id,player_id) VALUES ($1,$2)', [roomId, playerId]);
      await client.query(`INSERT INTO player_challenges(room_id,player_id,challenge_id) VALUES ($1,$2,'financial_freedom'),($1,$2,'debt_exit')`, [roomId, playerId]);
      if (botCount > 0) {
        const rivals = [
          { name: 'آرمان · کارآفرین', style: 'entrepreneur', difficulty: 'normal', cash: '10000000', salary: '7000000', rent: '1800000' },
          { name: 'مهسا · محتاط', style: 'conservative', difficulty: 'hard', cash: '10000000', salary: '5500000', rent: '1500000' },
          { name: 'نوید · فرصت‌طلب', style: 'opportunist', difficulty: 'hard', cash: '10000000', salary: '6200000', rent: '1700000' },
          { name: 'رها · تحلیلگر', style: 'analyst', difficulty: 'normal', cash: '10000000', salary: '6500000', rent: '1800000' },
          { name: 'سام · متعادل', style: 'balanced', difficulty: 'normal', cash: '10000000', salary: '6000000', rent: '1600000' },
          { name: 'نیلوفر · خوش‌گذران', style: 'consumer', difficulty: 'easy', cash: '10000000', salary: '6800000', rent: '2200000' },
        ];
        for (const rival of rivals.slice(0, botCount)) {
          const rivalId = randomUUID();
          const secret = randomBytes(32).toString('base64url');
          await client.query('INSERT INTO room_members(room_id,player_id,display_name,token_hash,is_bot,bot_style,bot_difficulty) VALUES ($1,$2,$3,$4,true,$5,$6)',
            [roomId, rivalId, rival.name, hashToken(secret), rival.style, rival.difficulty]);
          await client.query('INSERT INTO economy_accounts(id,room_id,cash_tomans,monthly_salary_tomans,monthly_rent_tomans) VALUES ($1,$2,$3,$4,$5)',
            [rivalId, roomId, rival.cash, rival.salary, rival.rent]);
          await client.query('INSERT INTO player_skills(room_id,player_id) VALUES ($1,$2)', [roomId, rivalId]);
          await client.query(`INSERT INTO player_challenges(room_id,player_id,challenge_id) VALUES ($1,$2,'financial_freedom'),($1,$2,'debt_exit')`, [roomId, rivalId]);
        }
      }
      await client.query('INSERT INTO room_turns(room_id,period_key,deadline_at) VALUES ($1,$2,$3)', [roomId, key, deadline]);
      const card = EVENT_CARDS[Math.floor(Math.random() * EVENT_CARDS.length)];
      await client.query(`INSERT INTO room_event_cards(room_id,period_key,card_id,kind,title,description,effect) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
        [roomId, key, card.id, card.kind, card.title, card.description, JSON.stringify(card.effect)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    // Durable deadline is in PostgreSQL. Startup/sweep retries scheduling if Redis is unavailable.
    await this.scheduleBestEffort(roomId, key, deadline);
    return { roomId, playerId, token, inviteCode, periodKey: key, deadlineAt: deadline.toISOString() };
  }

  async join(roomId: string, displayNameInput: string, playerAccountId?: string) {
    if (typeof roomId !== 'string' || roomId.length > 64) throw new BadRequestException('invalid room code');
    const displayName = this.name(displayNameInput, 40);
    const playerId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const room = await client.query('SELECT id,mode,max_players FROM rooms WHERE id::text=$1 OR invite_code=upper($1) FOR UPDATE', [roomId]);
      if (!room.rowCount) throw new NotFoundException('room not found');
      if (room.rows[0].mode === 'solo') throw new ForbiddenException('solo room');
      const resolvedRoomId = String(room.rows[0].id);
      const turn = await client.query("SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND status IN ('open','settling') FOR UPDATE", [resolvedRoomId]);
      if (!turn.rowCount || turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) {
        throw new ForbiddenException('turn is locked');
      }
      const started = await client.query('SELECT 1 FROM economic_periods WHERE room_id=$1 LIMIT 1', [resolvedRoomId]);
      if (started.rowCount) throw new ForbiddenException('room already started');
      const count = await client.query('SELECT count(*)::integer AS total FROM room_members WHERE room_id=$1', [resolvedRoomId]);
      if (Number(count.rows[0].total) >= Number(room.rows[0].max_players)) throw new ForbiddenException('room full');
      await client.query('INSERT INTO room_members(room_id,player_id,display_name,token_hash,player_account_id) VALUES ($1,$2,$3,$4,$5)', [resolvedRoomId, playerId, displayName, hashToken(token), playerAccountId ?? null]);
      await client.query('INSERT INTO economy_accounts(id,room_id,cash_tomans,monthly_salary_tomans,monthly_rent_tomans) VALUES ($1,$2,$3,$4,$5)',
        [playerId, resolvedRoomId, '10000000', '6000000', '2000000']);
      await client.query('INSERT INTO autopilot_policies(room_id,player_id) VALUES ($1,$2)', [resolvedRoomId, playerId]);
      await client.query('INSERT INTO player_skills(room_id,player_id) VALUES ($1,$2)', [resolvedRoomId, playerId]);
      await client.query(`INSERT INTO player_challenges(room_id,player_id,challenge_id) VALUES ($1,$2,'financial_freedom'),($1,$2,'debt_exit')`, [resolvedRoomId, playerId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    const resolved = await this.pool.query('SELECT id,invite_code FROM rooms WHERE id::text=$1 OR invite_code=upper($1)', [roomId]);
    const resolvedRoomId = String(resolved.rows[0].id);
    this.realtime.emitRoom(resolvedRoomId, 'room.members.changed', { roomId: resolvedRoomId });
    return { roomId: resolvedRoomId, inviteCode: String(resolved.rows[0].invite_code), playerId, token };
  }

  async authenticate(roomId: string, token: string): Promise<string> {
    this.validRoomId(roomId);
    if (!token || token.length > 200) throw new ForbiddenException('invalid room token');
    const member = await this.pool.query('SELECT player_id FROM room_members WHERE room_id=$1 AND token_hash=$2', [roomId, hashToken(token)]);
    if (!member.rowCount) throw new ForbiddenException('invalid room token');
    return String(member.rows[0].player_id);
  }

  async snapshot(roomId: string, token: string) {
    const playerId = await this.authenticate(roomId, token);
    const room = await this.pool.query('SELECT id,title,mode,scenario_id,turn_seconds,invite_code,max_players,bot_count FROM rooms WHERE id=$1', [roomId]);
    if (!room.rowCount) throw new NotFoundException('room not found');
    const turn = await this.pool.query('SELECT period_key,deadline_at,status,published_at FROM room_turns WHERE room_id=$1 ORDER BY period_key DESC LIMIT 1', [roomId]);
    const members = await this.pool.query('SELECT player_id,display_name,is_bot,bot_style,bot_difficulty FROM room_members WHERE room_id=$1 ORDER BY joined_at', [roomId]);
    const buildingCostCase = CITY_BUILDINGS.map(building => `WHEN '${building.id}' THEN ${building.baseCost.toString()}`).join(' ');
    const [account, positions, ownedBuildings, loans, rentArrears, guarantees, latestIndices, restructureHistory, standings, checkRequests, turnProgress, autopilotPolicy, chatMessages, financialChecks, businesses, partnershipOffers, businessHoldings, contractOffers] = await Promise.all([
      this.pool.query('SELECT cash_tomans,monthly_salary_tomans,monthly_rent_tomans FROM economy_accounts WHERE room_id=$1 AND id=$2', [roomId, playerId]),
      this.pool.query('SELECT category,market_value_tomans FROM investment_positions WHERE room_id=$1 AND player_id=$2 ORDER BY category', [roomId, playerId]),
      this.pool.query('SELECT building_id,level FROM city_buildings WHERE room_id=$1 AND player_id=$2 ORDER BY building_id', [roomId, playerId]),
      this.pool.query('SELECT principal_tomans,rate_kind,fixed_annual_rate_bps,variable_margin_bps,months_remaining,arrears_interest_tomans,arrears_principal_tomans,arrears_fee_tomans,monthly_penalty_bps FROM loans WHERE room_id=$1 AND borrower_id=$2 AND (principal_tomans>0 OR arrears_interest_tomans>0 OR arrears_principal_tomans>0 OR arrears_fee_tomans>0)', [roomId, playerId]),
      this.pool.query('SELECT COALESCE(SUM(amount_tomans-paid_tomans),0)::text AS total FROM rent_arrears WHERE room_id=$1 AND account_id=$2', [roomId, playerId]),
      this.pool.query(`SELECT COALESCE(SUM(gc.amount_tomans-gc.paid_tomans),0)::text AS total FROM guarantee_claims gc
        JOIN guarantees g ON g.id=gc.guarantee_id AND g.room_id=gc.room_id WHERE g.room_id=$1 AND g.guarantor_id=$2 AND gc.restructured_at IS NULL`, [roomId, playerId]),
      this.pool.query(`SELECT category,index_units FROM price_indices WHERE room_id=$1
        AND period_key=(SELECT MAX(period_key) FROM price_indices WHERE room_id=$1)`, [roomId]),
      this.pool.query('SELECT period_key FROM debt_restructure_events WHERE room_id=$1 AND player_id=$2 ORDER BY period_key DESC LIMIT 1', [roomId, playerId]),
      this.pool.query(`SELECT rm.player_id,rm.display_name,rm.is_bot,ea.cash_tomans,
        (SELECT COALESCE(SUM(ip.market_value_tomans),0)::text FROM investment_positions ip WHERE ip.room_id=rm.room_id AND ip.player_id=rm.player_id) AS investments,
        (SELECT COALESCE(SUM(cb.level * CASE cb.building_id ${buildingCostCase} ELSE 0 END),0)::text FROM city_buildings cb WHERE cb.room_id=rm.room_id AND cb.player_id=rm.player_id) AS buildings,
        (SELECT COALESCE(SUM(l.principal_tomans+l.arrears_interest_tomans+l.arrears_fee_tomans),0)::text FROM loans l WHERE l.room_id=rm.room_id AND l.borrower_id=rm.player_id) AS loan_debt,
        (SELECT COALESCE(SUM(ra.amount_tomans-ra.paid_tomans),0)::text FROM rent_arrears ra WHERE ra.room_id=rm.room_id AND ra.account_id=rm.player_id) AS rent_debt,
        (SELECT COALESCE(SUM(gc.amount_tomans-gc.paid_tomans),0)::text FROM guarantee_claims gc JOIN guarantees g ON g.id=gc.guarantee_id AND g.room_id=gc.room_id WHERE g.room_id=rm.room_id AND g.guarantor_id=rm.player_id AND gc.restructured_at IS NULL) AS guarantee_debt
        FROM room_members rm JOIN economy_accounts ea ON ea.room_id=rm.room_id AND ea.id=rm.player_id WHERE rm.room_id=$1`, [roomId]),
      this.pool.query(`SELECT r.id,r.period_key,r.issuer_id,r.payee_id,r.guarantor_id,r.due_period,r.amount_tomans,
        issuer.display_name AS issuer_name,payee.display_name AS payee_name,guarantor.display_name AS guarantor_name
        FROM check_guarantee_requests r JOIN room_members issuer ON issuer.room_id=r.room_id AND issuer.player_id=r.issuer_id
        JOIN room_members payee ON payee.room_id=r.room_id AND payee.player_id=r.payee_id
        JOIN room_members guarantor ON guarantor.room_id=r.room_id AND guarantor.player_id=r.guarantor_id
        WHERE r.room_id=$1 AND r.status='pending' ORDER BY r.created_at`, [roomId]),
      this.pool.query(`SELECT
        (SELECT count(*)::integer FROM room_turns WHERE room_id=$1 AND period_key <= $2) AS turn_number,
        (SELECT count(*)::integer FROM room_turn_ready WHERE room_id=$1 AND period_key=$2) AS ready_count,
        (SELECT count(*)::integer FROM room_members WHERE room_id=$1 AND is_bot=false) AS human_count,
        EXISTS (SELECT 1 FROM room_turn_ready WHERE room_id=$1 AND period_key=$2 AND player_id=$3) AS is_ready`, [roomId, turn.rows[0]?.period_key ?? '', playerId]),
      this.pool.query(`SELECT enabled,strategy,reserve_months,invest_surplus_bps FROM autopilot_policies WHERE room_id=$1 AND player_id=$2`, [roomId, playerId]),
      this.pool.query(`SELECT m.id,m.player_id,m.message,m.created_at,rm.display_name FROM room_chat_messages m
        JOIN room_members rm ON rm.room_id=m.room_id AND rm.player_id=m.player_id
        WHERE m.room_id=$1 ORDER BY m.id DESC LIMIT 40`, [roomId]),
      this.pool.query(`SELECT c.id,c.issuer_id,c.payee_id,c.due_period,c.amount_tomans,c.status,g.guarantor_id,
        issuer.display_name AS issuer_name,payee.display_name AS payee_name,guarantor.display_name AS guarantor_name
        FROM checks c LEFT JOIN guarantees g ON g.room_id=c.room_id AND g.check_id=c.id
        JOIN room_members issuer ON issuer.room_id=c.room_id AND issuer.player_id=c.issuer_id
        JOIN room_members payee ON payee.room_id=c.room_id AND payee.player_id=c.payee_id
        LEFT JOIN room_members guarantor ON guarantor.room_id=g.room_id AND guarantor.player_id=g.guarantor_id
        WHERE c.room_id=$1 AND (c.issuer_id=$2 OR c.payee_id=$2 OR g.guarantor_id=$2)
        ORDER BY c.due_period DESC,c.id`, [roomId, playerId]),
      this.pool.query(`SELECT b.id,b.model_id,b.branch_number,b.level,b.manager_enabled,b.unpaid_expenses_tomans,b.retained_earnings_tomans,
        COALESCE((SELECT json_agg(json_build_object('playerId',bo.player_id,'displayName',rm.display_name,'isBot',rm.is_bot,'shareBps',bo.share_bps,'capitalTomans',bo.capital_contributed_tomans) ORDER BY bo.joined_at)
          FROM business_owners bo JOIN room_members rm ON rm.room_id=bo.room_id AND rm.player_id=bo.player_id WHERE bo.business_id=b.id),'[]'::json) AS owners,
        result.period_key AS last_period_key,result.revenue_tomans,result.materials_cost_tomans,result.payroll_cost_tomans,result.overhead_cost_tomans,
        result.manager_cost_tomans,result.net_profit_tomans,result.distributed_tomans
        FROM business_branches b LEFT JOIN LATERAL (SELECT * FROM business_period_results r WHERE r.business_id=b.id ORDER BY r.period_key DESC LIMIT 1) result ON true
        WHERE b.room_id=$1 AND EXISTS (SELECT 1 FROM business_owners mine WHERE mine.business_id=b.id AND mine.player_id=$2)
        ORDER BY b.created_at,b.branch_number`, [roomId, playerId]),
      this.pool.query(`SELECT o.id,o.business_id,o.proposer_id,o.invitee_id,o.share_bps,o.contribution_tomans,o.period_key,
        b.model_id,proposer.display_name AS proposer_name,invitee.display_name AS invitee_name
        FROM business_partnership_offers o JOIN business_branches b ON b.id=o.business_id AND b.room_id=o.room_id
        JOIN room_members proposer ON proposer.room_id=o.room_id AND proposer.player_id=o.proposer_id
        JOIN room_members invitee ON invitee.room_id=o.room_id AND invitee.player_id=o.invitee_id
        WHERE o.room_id=$1 AND o.status='pending' AND o.invitee_id=$2 ORDER BY o.created_at`, [roomId, playerId]),
      this.pool.query(`SELECT b.id,b.model_id,b.retained_earnings_tomans,b.unpaid_expenses_tomans,bo.player_id,bo.share_bps,bo.capital_contributed_tomans
        FROM business_branches b JOIN business_owners bo ON bo.business_id=b.id AND bo.room_id=b.room_id WHERE b.room_id=$1`, [roomId]),
      this.pool.query(`SELECT c.id,c.proposer_id,c.contract_kind,c.amount_tomans,c.interest_bps,c.months,c.asset_category,c.asset_value_tomans,
        rm.display_name AS proposer_name FROM player_contracts c JOIN room_members rm ON rm.room_id=c.room_id AND rm.player_id=c.proposer_id
        WHERE c.room_id=$1 AND c.counterparty_id=$2 AND c.status='pending' ORDER BY c.created_at`, [roomId, playerId]),
    ]);
    const indices = Object.fromEntries(CATEGORIES.map(category => [category, INDEX_SCALE])) as Indices;
    const [skillRows, eventRows, fundRows, policyRows, auctionRows, challengeRows, wellbeingRows] = await Promise.all([
      this.pool.query('SELECT management,negotiation,marketing,skill_points,experience_points FROM player_skills WHERE room_id=$1 AND player_id=$2', [roomId, playerId]),
      this.pool.query(`SELECT c.card_id AS id,c.kind,c.title,c.description,c.effect,ch.choice FROM room_event_cards c LEFT JOIN player_event_choices ch ON ch.room_id=c.room_id AND ch.period_key=c.period_key AND ch.player_id=$2 WHERE c.room_id=$1 AND c.period_key=$3`, [roomId, playerId, turn.rows[0]?.period_key ?? '']),
      this.pool.query('SELECT fund_id,market_value_tomans FROM fund_positions WHERE room_id=$1 AND player_id=$2 ORDER BY fund_id', [roomId, playerId]),
      this.pool.query('SELECT plan_id,premium_tomans,coverage_tomans,active FROM insurance_policies WHERE room_id=$1 AND player_id=$2 ORDER BY plan_id', [roomId, playerId]),
      this.pool.query(`SELECT a.id,a.seller_id,a.asset_category,a.asset_value_tomans,a.reserve_price_tomans,a.status,COALESCE(MAX(b.bid_tomans),0)::text AS highest_bid_tomans,COUNT(b.bidder_id)::integer AS bid_count
        FROM player_auctions a LEFT JOIN player_auction_bids b ON b.auction_id=a.id WHERE a.room_id=$1 AND a.status='open' GROUP BY a.id ORDER BY a.created_at`, [roomId]),
      this.pool.query('SELECT challenge_id,completed,completed_period FROM player_challenges WHERE room_id=$1 AND player_id=$2 ORDER BY challenge_id', [roomId, playerId]),
      this.pool.query('SELECT free_time,health,security FROM wellbeing_scores WHERE room_id=$1 AND player_id=$2 ORDER BY period_key DESC LIMIT 1', [roomId, playerId]),
    ]);
    for (const row of latestIndices.rows) indices[row.category as keyof Indices] = BigInt(String(row.index_units));
    const cityIndex = weightedIndex(indices, { food: 2000n, housing: 2500n, car: 500n, gold: 1000n, currency: 1000n, equipment: 1000n, materials: 2000n });
    const currentBuildings = new Map(ownedBuildings.rows.map(row => [String(row.building_id), Number(row.level)]));
    const businessValueByPlayer = new Map<string, bigint>();
    const businessIncomeByPlayer = new Map<string, bigint>();
    const holdingsByBranch = new Map<string, typeof businessHoldings.rows>();
    for (const holding of businessHoldings.rows) {
      const branchId = String(holding.id);
      holdingsByBranch.set(branchId, [...(holdingsByBranch.get(branchId) ?? []), holding]);
    }
    for (const holders of holdingsByBranch.values()) {
      const branch = holders[0];
      const model = BUSINESS_MODELS.find(item => item.id === String(branch.model_id));
      if (!model) continue;
      const bookValue = holders.reduce((sum, holder) => sum + BigInt(String(holder.capital_contributed_tomans)), 0n)
        + BigInt(String(branch.retained_earnings_tomans)) - BigInt(String(branch.unpaid_expenses_tomans));
      const equity = bookValue > 0n ? bookValue : 0n;
      for (const holder of holders) {
        const share = BigInt(String(holder.share_bps));
        const value = divRound(equity * indices[model.salesIndex] * share, INDEX_SCALE * 10_000n);
        businessValueByPlayer.set(String(holder.player_id), (businessValueByPlayer.get(String(holder.player_id)) ?? 0n) + value);
      }
    }
    let businessMonthlyIncome = 0n;
    for (const branch of businesses.rows) {
      const owner = (branch.owners as Array<{ playerId: string; shareBps: number | string }>).find(item => item.playerId === playerId);
      if (!owner || branch.distributed_tomans == null) continue;
      const shareIncome = BigInt(String(branch.distributed_tomans)) * BigInt(String(owner.shareBps)) / 10_000n;
      businessMonthlyIncome += shareIncome;
    }
    let buildingValue = 0n;
    let passiveIncome = 0n;
    const city = CITY_BUILDINGS.map(building => {
      const level = currentBuildings.get(building.id) ?? 0;
      const marketIndex = building.indexCategory ? indices[building.indexCategory] : INDEX_SCALE;
      const nominalBuildingValue = divRound(building.baseCost * BigInt(level) * marketIndex, INDEX_SCALE);
      const nominalIncome = divRound(building.monthlyIncome * BigInt(level) * marketIndex, INDEX_SCALE);
      buildingValue += nominalBuildingValue;
      passiveIncome += nominalIncome;
      return { buildingId: building.id, name: building.name, level,
        nextCostTomans: level < 5 ? (building.baseCost * BigInt(level + 1)).toString() : null,
        monthlyIncomeTomans: nominalIncome.toString(),
        baseMonthlyIncomeTomans: building.monthlyIncome.toString(), maxLevel: 5 };
    });
    let loanDebt = 0n;
    let monthlyLoanService = 0n;
    let loanArrears = 0n;
    const loanSummary: Array<{ principalTomans: string; rateKind: string; annualRateBps: string; monthsRemaining: number; monthlyDueTomans: string; arrearsTomans: string }> = [];
    const scenario = scenarioById(String(room.rows[0].scenario_id));
    for (const loan of loans.rows) {
      const principal = BigInt(String(loan.principal_tomans));
      const arrearsInterest = BigInt(String(loan.arrears_interest_tomans));
      const arrearsPrincipal = BigInt(String(loan.arrears_principal_tomans));
      const arrearsFee = BigInt(String(loan.arrears_fee_tomans));
      const rate = loan.rate_kind === 'fixed'
        ? BigInt(String(loan.fixed_annual_rate_bps))
        : scenario.referenceAnnualRateBps + BigInt(String(loan.variable_margin_bps));
      loanDebt += principal + arrearsInterest + arrearsFee;
      loanArrears += arrearsInterest + arrearsPrincipal + arrearsFee;
      const monthsRemaining = Number(loan.months_remaining);
      try {
        const monthlyDue = settleLoan({ principal, arrearsInterest, arrearsPrincipal, arrearsFee,
          monthsRemaining, monthlyPenaltyBps: BigInt(String(loan.monthly_penalty_bps)) }, rate, 9_223_372_036_854_775_807n).due;
        monthlyLoanService += monthlyDue;
        loanSummary.push({ principalTomans: principal.toString(), rateKind: String(loan.rate_kind), annualRateBps: rate.toString(),
          monthsRemaining, monthlyDueTomans: monthlyDue.toString(), arrearsTomans: (arrearsInterest + arrearsPrincipal + arrearsFee).toString() });
      } catch {
        const monthlyPrincipal = monthsRemaining > 0 ? principal / BigInt(monthsRemaining) : principal;
        monthlyLoanService += monthlyPrincipal + arrearsInterest + arrearsPrincipal + arrearsFee;
      }
    }
    const rentArrearsTotal = BigInt(String(rentArrears.rows[0]?.total ?? '0'));
    const guaranteeClaims = BigInt(String(guarantees.rows[0]?.total ?? '0'));
    let financial: (ReturnType<typeof scoreFinancialState> & { canRestructure?: boolean; nextRestructurePeriod?: string | null }) | null = null;
    if (account.rowCount) {
      const cash = BigInt(String(account.rows[0].cash_tomans));
      const investmentValue = positions.rows.reduce((sum, position) => sum + BigInt(String(position.market_value_tomans)), 0n);
      const assets = cash + investmentValue + buildingValue + (businessValueByPlayer.get(playerId) ?? 0n);
      const liabilities = loanDebt + rentArrearsTotal + guaranteeClaims;
      const monthlyObligations = BigInt(String(account.rows[0].monthly_rent_tomans)) + monthlyLoanService;
      const well = wellbeingRows.rows[0];
      const lifeQuality = well ? Math.floor((Number(well.free_time) + Number(well.health) + Number(well.security)) / 3)
        : Math.min(100, (currentBuildings.get('park') ?? 0) * 12 + (currentBuildings.get('homes') ?? 0) * 8 + 25);
      const toReal = (amount: bigint) => realValue(amount, cityIndex);
      financial = scoreFinancialState({
        realAssets: toReal(assets), realLiabilities: toReal(liabilities), realNetWorth: toReal(assets - liabilities),
        realCash: toReal(cash), realPassiveIncome: toReal(passiveIncome + businessMonthlyIncome), realMonthlyObligations: toReal(monthlyObligations),
        lifeQuality, arrears: toReal(rentArrearsTotal + loanArrears + guaranteeClaims),
      });
      const currentKey = String(turn.rows[0]?.period_key ?? '');
      const lastKey = String(restructureHistory.rows[0]?.period_key ?? '');
      const monthOrdinal = (key: string) => { const [year, month] = key.split('-').map(Number); return year * 12 + month; };
      const cooldownPassed = !lastKey || (currentKey && monthOrdinal(currentKey) - monthOrdinal(lastKey) >= 3);
      financial = { ...financial, canRestructure: Boolean(financial.restructuringEligible && cooldownPassed),
        nextRestructurePeriod: lastKey ? `${Number(lastKey.slice(0, 4)) + Math.floor((Number(lastKey.slice(5)) + 2) / 12)}-${String((Number(lastKey.slice(5)) + 2) % 12 + 1).padStart(2, '0')}` : null };
    }
    const decision = turn.rowCount ? await this.pool.query(
      'SELECT action_type,category,amount_tomans,status,reason FROM player_decisions WHERE room_id=$1 AND period_key=$2 AND player_id=$3',
      [roomId, turn.rows[0].period_key, playerId],
    ) : { rows: [] };
    const leaderboard = standings.rows.map(row => {
      const assets = BigInt(String(row.cash_tomans)) + BigInt(String(row.investments)) + BigInt(String(row.buildings)) + (businessValueByPlayer.get(String(row.player_id)) ?? 0n);
      const liabilities = BigInt(String(row.loan_debt)) + BigInt(String(row.rent_debt)) + BigInt(String(row.guarantee_debt));
      const worth = realValue(assets - liabilities, cityIndex).toString();
      const mine = String(row.player_id) === playerId;
      return { playerId: String(row.player_id), displayName: String(row.display_name), isBot: Boolean(row.is_bot), worth,
        netWorthTomans: mine ? worth : null, cashTomans: mine ? String(row.cash_tomans) : null };
    }).sort((a, b) => BigInt(a.worth) > BigInt(b.worth) ? -1 : BigInt(a.worth) < BigInt(b.worth) ? 1 : 0)
      .map(({ worth: _privateSortKey, ...player }, index) => ({ ...player, rank: index + 1 }));
    const chat = chatMessages.rows.reverse().map(row => ({ id: String(row.id), playerId: String(row.player_id), displayName: String(row.display_name), message: String(row.message), createdAt: new Date(row.created_at).toISOString() }));
    return {
      room: room.rows[0], turn: turn.rows[0] ? { ...turn.rows[0], turn_number: Number(turnProgress.rows[0]?.turn_number ?? 1), ready_count: Number(turnProgress.rows[0]?.ready_count ?? 0), human_count: Number(turnProgress.rows[0]?.human_count ?? 1), is_ready: Boolean(turnProgress.rows[0]?.is_ready) } : null,
      members: members.rows, playerId,
      account: account.rows[0] ?? null, positions: positions.rows, city, financial, leaderboard, loans: loanSummary,
      marketQuotes: Object.fromEntries((Object.keys(MARKET_PRODUCTS) as MarketCategory[]).map(category => [category, marketQuote(category, indices[category])])),
      checkRequests: checkRequests.rows, checks: financialChecks.rows, autopilot: autopilotPolicy.rows[0] ?? { enabled: true, strategy: 'balanced', reserve_months: 1, invest_surplus_bps: 2500 }, chat,
      loanOffers: { fixedAnnualRateBps: (scenario.referenceAnnualRateBps + LOAN_PRODUCTS.fixed.spreadBps).toString(),
        variableAnnualRateBps: (scenario.referenceAnnualRateBps + LOAN_PRODUCTS.variable.marginBps).toString(),
        minMonths: LOAN_PRODUCTS.fixed.minMonths, maxMonths: LOAN_PRODUCTS.fixed.maxMonths },
      decision: decision.rows[0] ?? null,
      businessCatalog: BUSINESS_MODELS.map(model => ({ ...model, startupCost: model.startupCost.toString(), baseRevenue: model.baseRevenue.toString(), materialsCost: model.materialsCost.toString(), payrollCost: model.payrollCost.toString(), overheadCost: model.overheadCost.toString() })),
      businesses: businesses.rows,
      businessMonthlyIncomeTomans: businessMonthlyIncome.toString(),
      partnershipOffers: partnershipOffers.rows,
      contractOffers: contractOffers.rows,
      skills: skillRows.rows[0] ?? { management: 0, negotiation: 0, marketing: 0, skill_points: 1, experience_points: 0 },
      skillCatalog: SKILLS,
      eventCard: eventRows.rows[0] ?? null,
      funds: { catalog: FUNDS.map(f => ({ ...f, allocations: Object.fromEntries(Object.entries(f.allocations).map(([k,v]) => [k, v.toString()])) })), positions: fundRows.rows },
      insurance: { catalog: INSURANCE_PLANS.map(p => ({ ...p, premiumTomans: p.premiumTomans.toString(), coverageTomans: p.coverageTomans.toString() })), policies: policyRows.rows },
      auctions: auctionRows.rows,
      challenges: challengeRows.rows.map(row => {
        const completed = String(row.challenge_id) === 'financial_freedom'
          ? Boolean(financial?.meetsFreedom)
          : Boolean(row.completed || (loanDebt + rentArrearsTotal + guaranteeClaims === 0n));
        return { ...row, completed, completed_period: completed ? (row.completed_period ?? turn.rows[0]?.period_key ?? null) : null };
      }),
      wellbeing: wellbeingRows.rows[0] ?? { free_time: 50, health: 50, security: 50 },
    };
  }

  async chooseEvent(roomId: string, token: string, key: string, choice: string) {
    const playerId = await this.authenticate(roomId, token);
    if (!['accept','decline','management','negotiation','marketing'].includes(choice)) throw new BadRequestException('invalid event choice');
    const client=await this.pool.connect();
    try { await client.query('BEGIN'); await this.assertTurnOpen(client,roomId,key,playerId);
      const card=await client.query('SELECT kind FROM room_event_cards WHERE room_id=$1 AND period_key=$2',[roomId,key]);
      if(!card.rowCount) throw new NotFoundException('event card not found');
      if(card.rows[0].kind==='skill'&&!['management','negotiation','marketing'].includes(choice)) throw new BadRequestException('choose a skill');
      if(card.rows[0].kind!=='skill'&&!['accept','decline'].includes(choice)) throw new BadRequestException('choose accept or decline');
      const result=await client.query(`INSERT INTO player_event_choices(room_id,period_key,player_id,choice) VALUES ($1,$2,$3,$4)
        ON CONFLICT (room_id,period_key,player_id) DO UPDATE SET choice=EXCLUDED.choice RETURNING choice`,[roomId,key,playerId,choice]);
      await client.query('COMMIT'); return {choice:result.rows[0].choice};
    } catch(error){await client.query('ROLLBACK');throw error;} finally{client.release();}
  }

  async upgradeSkill(roomId: string, token: string, key: string, skillId: string) {
    const playerId = await this.authenticate(roomId, token);
    if (!SKILLS.some(s => s.id === skillId)) throw new BadRequestException('invalid skill');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertTurnOpen(client, roomId, key, playerId);
      const updated = await client.query(`UPDATE player_skills SET skill_points=skill_points-1,${skillId}=${skillId}+1
        WHERE room_id=$1 AND player_id=$2 AND skill_points>0 AND ${skillId}<10 RETURNING ${skillId},skill_points`, [roomId,playerId]);
      if (!updated.rowCount) throw new BadRequestException('no skill point available or skill is maxed');
      await client.query('COMMIT');
      return { skillId, level: updated.rows[0][skillId], skillPoints: updated.rows[0].skill_points };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async tradeFund(roomId: string, token: string, key: string, fundId: string, action: string, amountTomans: string) {
    const playerId = await this.authenticate(roomId, token);
    const fund = FUNDS.find(f => f.id === fundId);
    if (!fund || !['buy','sell'].includes(action) || !/^\d{1,18}$/.test(amountTomans)) throw new BadRequestException('invalid fund trade');
    const amount = BigInt(amountTomans); if (amount < 100_000n || amount > 9_000_000_000_000_000n) throw new BadRequestException('trade must be at least 100,000 tomans');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await this.assertTurnOpen(client,roomId,key,playerId);
      const a = await client.query('SELECT cash_tomans FROM economy_accounts WHERE room_id=$1 AND id=$2 FOR UPDATE',[roomId,playerId]);
      const p = await client.query('SELECT market_value_tomans FROM fund_positions WHERE room_id=$1 AND player_id=$2 AND fund_id=$3 FOR UPDATE',[roomId,playerId,fundId]);
      const held = BigInt(String(p.rows[0]?.market_value_tomans ?? 0)); const cash = BigInt(String(a.rows[0].cash_tomans));
      if (action === 'buy' && cash < amount) throw new BadRequestException('insufficient cash');
      if (action === 'sell' && held < amount) throw new BadRequestException('insufficient fund units');
      const delta = action === 'buy' ? amount : -amount; const cashDelta = -delta;
      await client.query(`INSERT INTO fund_positions(room_id,player_id,fund_id,market_value_tomans) VALUES ($1,$2,$3,$4)
        ON CONFLICT(room_id,player_id,fund_id) DO UPDATE SET market_value_tomans=fund_positions.market_value_tomans+$4`,[roomId,playerId,fundId,delta.toString()]);
      await client.query('UPDATE economy_accounts SET cash_tomans=cash_tomans+$3 WHERE room_id=$1 AND id=$2',[roomId,playerId,cashDelta.toString()]);
      await client.query('COMMIT'); return { fundId,action,amountTomans:amount.toString() };
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async setInsurance(roomId: string, token: string, key: string, planId: string, active: boolean) {
    const playerId = await this.authenticate(roomId, token); const plan = INSURANCE_PLANS.find(p=>p.id===planId);
    if (!plan || typeof active !== 'boolean') throw new BadRequestException('invalid insurance selection');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN'); await this.assertTurnOpen(client,roomId,key,playerId);
      if (active) await client.query(`INSERT INTO insurance_policies(id,room_id,player_id,plan_id,premium_tomans,coverage_tomans,purchased_period)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(room_id,player_id,plan_id) DO UPDATE SET active=true`,[randomUUID(),roomId,playerId,planId,plan.premiumTomans.toString(),plan.coverageTomans.toString(),key]);
      else await client.query('UPDATE insurance_policies SET active=false WHERE room_id=$1 AND player_id=$2 AND plan_id=$3',[roomId,playerId,planId]);
      await client.query('COMMIT'); return { planId,active };
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async createAuction(roomId: string, token: string, key: string, input: { assetCategory: string; assetValueTomans: string; reservePriceTomans: string }) {
    const playerId = await this.authenticate(roomId,token);
    if (!['car','gold','currency','equipment','materials'].includes(input.assetCategory) || !/^\d{1,18}$/.test(input.assetValueTomans) || !/^\d{1,18}$/.test(input.reservePriceTomans)) throw new BadRequestException('invalid auction');
    const value=BigInt(input.assetValueTomans), reserve=BigInt(input.reservePriceTomans); if(value<=0n||reserve<=0n||reserve>value*2n) throw new BadRequestException('invalid auction values');
    const client=await this.pool.connect();
    try{await client.query('BEGIN');await this.assertTurnOpen(client,roomId,key,playerId);
      const held=await client.query('SELECT market_value_tomans FROM investment_positions WHERE room_id=$1 AND player_id=$2 AND category=$3 FOR UPDATE',[roomId,playerId,input.assetCategory]);
      if(!held.rowCount||BigInt(String(held.rows[0].market_value_tomans))<value) throw new BadRequestException('asset value exceeds holdings');
      const reserved=await client.query("SELECT COALESCE(SUM(asset_value_tomans),0)::text AS amount FROM player_auctions WHERE room_id=$1 AND seller_id=$2 AND asset_category=$3 AND status='open'",[roomId,playerId,input.assetCategory]);
      if(BigInt(String(held.rows[0].market_value_tomans))-BigInt(String(reserved.rows[0].amount))<value) throw new BadRequestException('asset is already listed');
      await client.query('INSERT INTO player_auctions(id,room_id,seller_id,period_key,asset_category,asset_value_tomans,reserve_price_tomans) VALUES ($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),roomId,playerId,key,input.assetCategory,value.toString(),reserve.toString()]);
      await client.query('COMMIT');return {created:true};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }

  async bidAuction(roomId: string, token: string, auctionId: string, key: string, amountTomans: string) {
    const bidder=await this.authenticate(roomId,token); if(!/^\d{1,18}$/.test(amountTomans)||BigInt(amountTomans)<=0n) throw new BadRequestException('invalid bid');
    const client=await this.pool.connect();
    try { await client.query('BEGIN'); await this.assertTurnOpen(client,roomId,key,bidder);
    const auction=await client.query("SELECT seller_id,reserve_price_tomans,period_key FROM player_auctions WHERE id=$1 AND room_id=$2 AND status='open' FOR UPDATE",[auctionId,roomId]);
    if(!auction.rowCount||auction.rows[0].seller_id===bidder||String(auction.rows[0].period_key)!==key||BigInt(amountTomans)<BigInt(String(auction.rows[0].reserve_price_tomans))) throw new BadRequestException('auction closed or bid below reserve');
    const cash=await client.query('SELECT cash_tomans FROM economy_accounts WHERE room_id=$1 AND id=$2 FOR UPDATE',[roomId,bidder]);
    if(!cash.rowCount||BigInt(String(cash.rows[0].cash_tomans))<BigInt(amountTomans)) throw new BadRequestException('insufficient cash');
    await client.query(`INSERT INTO player_auction_bids(room_id,auction_id,bidder_id,bid_tomans) VALUES ($1,$2,$3,$4)
      ON CONFLICT(auction_id,bidder_id) DO UPDATE SET bid_tomans=GREATEST(player_auction_bids.bid_tomans,EXCLUDED.bid_tomans),updated_at=now()`,[roomId,auctionId,bidder,amountTomans]);
    await client.query('COMMIT'); return { bidTomans:amountTomans };
    } catch(error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  private async assertTurnOpen(client: import('pg').PoolClient, roomId: string, key: string, playerId: string) {
    const turn=await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE',[roomId,key]);
    if(!turn.rowCount||turn.rows[0].status!=='open'||new Date(turn.rows[0].deadline_at).getTime()<=Date.now()) throw new ForbiddenException('period is locked');
    await this.assertNotReady(client,roomId,key,playerId);
  }

  async proposePlayerContract(roomId: string, token: string, key: string, input: { counterpartyId: string; kind: string; amountTomans: string; interestBps?: number; months?: number; assetCategory?: string; assetValueTomans?: string }) {
    const proposerId = await this.authenticate(roomId, token);
    this.validRoomId(roomId); this.validPeriodKey(key);
    if (!input || !uuidPattern.test(input.counterpartyId) || input.counterpartyId === proposerId
      || !['loan', 'asset_trade'].includes(input.kind) || typeof input.amountTomans !== 'string' || !/^\d{1,18}$/.test(input.amountTomans)) {
      throw new BadRequestException('invalid player contract');
    }
    const amount = BigInt(input.amountTomans);
    if (amount <= 0n || amount > 9_223_372_036_854_775_807n) throw new BadRequestException('invalid contract amount');
    const kind = input.kind as 'loan' | 'asset_trade';
    if ((kind === 'loan' && (!Number.isSafeInteger(input.interestBps) || input.interestBps! < 0 || input.interestBps! > 1_000_000
      || !Number.isSafeInteger(input.months) || input.months! < 1 || input.months! > 120 || input.assetCategory !== undefined || input.assetValueTomans !== undefined))
      || (kind === 'asset_trade' && (!['car','gold','currency','equipment','materials'].includes(String(input.assetCategory))
        || typeof input.assetValueTomans !== 'string' || !/^\d{1,18}$/.test(input.assetValueTomans) || input.interestBps !== undefined || input.months !== undefined))) {
      throw new BadRequestException('invalid contract terms');
    }
    const assetValue = kind === 'asset_trade' ? BigInt(input.assetValueTomans!) : null;
    if (assetValue !== null && (assetValue <= 0n || assetValue > 9_223_372_036_854_775_807n)) throw new BadRequestException('invalid asset value');
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await this.assertNotReady(client, roomId, key, proposerId);
      const counterparty = await client.query('SELECT is_bot FROM room_members WHERE room_id=$1 AND player_id=$2', [roomId, input.counterpartyId]);
      if (!counterparty.rowCount || counterparty.rows[0].is_bot) throw new BadRequestException('contracts require another human player');
      await client.query(`INSERT INTO player_contracts(id,room_id,period_key,proposer_id,counterparty_id,contract_kind,amount_tomans,interest_bps,months,asset_category,asset_value_tomans)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, roomId, key, proposerId, input.counterpartyId, kind, amount.toString(), kind === 'loan' ? input.interestBps : null,
        kind === 'loan' ? input.months : null, kind === 'asset_trade' ? input.assetCategory : null, assetValue?.toString() ?? null]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'player.contract.changed', { roomId, periodKey: key, contractId: id, action: 'proposed', counterpartyId: input.counterpartyId });
    return { roomId, periodKey: key, contractId: id, status: 'pending' };
  }

  async respondPlayerContract(roomId: string, token: string, contractId: string, accept: boolean) {
    const counterpartyId = await this.authenticate(roomId, token);
    this.validRoomId(roomId);
    if (!uuidPattern.test(contractId) || typeof accept !== 'boolean') throw new BadRequestException('invalid contract response');
    const client = await this.pool.connect();
    let key = ''; let kind = ''; let proposerId = ''; let loanId: string | null = null; let expired = false;
    try {
      await client.query('BEGIN');
      const contract = await client.query(`SELECT * FROM player_contracts WHERE room_id=$1 AND id=$2 FOR UPDATE`, [roomId, contractId]);
      if (!contract.rowCount || String(contract.rows[0].counterparty_id) !== counterpartyId) throw new NotFoundException('contract not found');
      const row = contract.rows[0]; key = String(row.period_key); kind = String(row.contract_kind); proposerId = String(row.proposer_id);
      if (row.status !== 'pending') throw new BadRequestException('contract is no longer pending');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount || turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) {
        await client.query("UPDATE player_contracts SET status='expired',responded_at=now() WHERE id=$1", [contractId]); expired = true;
      } else {
        await this.assertNotReady(client, roomId, key, counterpartyId);
        if (accept) {
          const [lenderId, borrowerId] = kind === 'loan' ? [proposerId, counterpartyId] : [counterpartyId, proposerId];
          const accounts = await client.query('SELECT id,cash_tomans FROM economy_accounts WHERE room_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE', [roomId, [lenderId, borrowerId]]);
          const accountMap = new Map(accounts.rows.map(item => [String(item.id), BigInt(String(item.cash_tomans))]));
          const lenderCash = accountMap.get(lenderId); const borrowerCash = accountMap.get(borrowerId);
          if (lenderCash === undefined || borrowerCash === undefined) throw new NotFoundException('contract account not found');
          const amount = BigInt(String(row.amount_tomans));
          if (kind === 'loan') {
            if (lenderCash < amount) throw new BadRequestException('lender has insufficient cash');
            loanId = randomUUID();
            const borrowerSkill=await client.query('SELECT negotiation FROM player_skills WHERE room_id=$1 AND player_id=$2',[roomId,borrowerId]);
            const negotiatedRate=Math.max(0,Number(row.interest_bps)-Number(borrowerSkill.rows[0]?.negotiation??0)*50);
            await client.query(`INSERT INTO loans(id,room_id,borrower_id,lender_id,principal_tomans,rate_kind,fixed_annual_rate_bps,months_remaining)
              VALUES ($1,$2,$3,$4,$5,'fixed',$6,$7)`, [loanId, roomId, borrowerId, lenderId, amount.toString(), negotiatedRate, Number(row.months)]);
            await client.query('UPDATE economy_accounts SET cash_tomans=$3 WHERE room_id=$1 AND id=$2', [roomId, lenderId, (lenderCash - amount).toString()]);
            await client.query('UPDATE economy_accounts SET cash_tomans=$3 WHERE room_id=$1 AND id=$2', [roomId, borrowerId, (borrowerCash + amount).toString()]);
            await this.writeLedger(client, roomId, key, lenderId, 'p2p_loan_funded', contractId, -amount, lenderCash - amount);
            await this.writeLedger(client, roomId, key, borrowerId, 'p2p_loan_received', contractId, amount, borrowerCash + amount);
            await this.writeContractLedger(client, roomId, key, contractId, lenderId, 'loan_funded', -amount, lenderCash - amount);
            await this.writeContractLedger(client, roomId, key, contractId, borrowerId, 'loan_received', amount, borrowerCash + amount);
          } else {
            const sellerId = proposerId; const buyerId = counterpartyId;
            const sellerCash = accountMap.get(sellerId)!; const buyerCash = accountMap.get(buyerId)!;
            const price = amount; const assetValue = BigInt(String(row.asset_value_tomans));
            if (buyerCash < price) throw new BadRequestException('buyer has insufficient cash');
            const sellerPosition = await client.query('SELECT market_value_tomans FROM investment_positions WHERE room_id=$1 AND player_id=$2 AND category=$3 FOR UPDATE', [roomId, sellerId, row.asset_category]);
            const held = sellerPosition.rowCount ? BigInt(String(sellerPosition.rows[0].market_value_tomans)) : 0n;
            if (held < assetValue) throw new BadRequestException('seller has insufficient asset holdings');
            const buyerPosition = await client.query('SELECT market_value_tomans FROM investment_positions WHERE room_id=$1 AND player_id=$2 AND category=$3 FOR UPDATE', [roomId, buyerId, row.asset_category]);
            const buyerHeld = buyerPosition.rowCount ? BigInt(String(buyerPosition.rows[0].market_value_tomans)) : 0n;
            await client.query('UPDATE economy_accounts SET cash_tomans=$3 WHERE room_id=$1 AND id=$2', [roomId, sellerId, (sellerCash + price).toString()]);
            await client.query('UPDATE economy_accounts SET cash_tomans=$3 WHERE room_id=$1 AND id=$2', [roomId, buyerId, (buyerCash - price).toString()]);
            await client.query(`INSERT INTO investment_positions(room_id,player_id,category,market_value_tomans) VALUES ($1,$2,$3,$4)
              ON CONFLICT(room_id,player_id,category) DO UPDATE SET market_value_tomans=EXCLUDED.market_value_tomans`, [roomId, sellerId, row.asset_category, (held - assetValue).toString()]);
            await client.query(`INSERT INTO investment_positions(room_id,player_id,category,market_value_tomans) VALUES ($1,$2,$3,$4)
              ON CONFLICT(room_id,player_id,category) DO UPDATE SET market_value_tomans=EXCLUDED.market_value_tomans`, [roomId, buyerId, row.asset_category, (buyerHeld + assetValue).toString()]);
            await this.writeLedger(client, roomId, key, sellerId, 'p2p_asset_sale', contractId, price, sellerCash + price);
            await this.writeLedger(client, roomId, key, buyerId, 'p2p_asset_purchase', contractId, -price, buyerCash - price);
            await this.writeContractLedger(client, roomId, key, contractId, sellerId, 'cash_received', price, sellerCash + price);
            await this.writeContractLedger(client, roomId, key, contractId, buyerId, 'cash_paid', -price, buyerCash - price);
            await this.writeContractLedger(client, roomId, key, contractId, sellerId, 'asset_sent', 0n, sellerCash + price, String(row.asset_category), -assetValue, held - assetValue);
            await this.writeContractLedger(client, roomId, key, contractId, buyerId, 'asset_received', 0n, buyerCash - price, String(row.asset_category), assetValue, buyerHeld + assetValue);
          }
        }
        await client.query("UPDATE player_contracts SET status=$3,responded_at=now(),loan_id=$4 WHERE room_id=$1 AND id=$2", [roomId, contractId, accept ? 'accepted' : 'declined', loanId]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    if (expired) throw new ForbiddenException('contract expired with the turn');
    this.realtime.emitRoom(roomId, 'player.contract.changed', { roomId, periodKey: key, contractId, action: accept ? 'accepted' : 'declined', proposerId, counterpartyId });
    return { roomId, periodKey: key, contractId, kind, status: accept ? 'accepted' : 'declined', loanId };
  }

  private async writeLedger(client: import('pg').PoolClient, roomId: string, key: string, playerId: string, kind: string, sourceId: string, amount: bigint, balance: bigint) {
    await client.query(`INSERT INTO economy_ledger(room_id,period_key,account_id,source_kind,source_id,amount_tomans,balance_before_tomans,balance_after_tomans)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [roomId, key, playerId, kind, sourceId, amount.toString(), (balance-amount).toString(), balance.toString()]);
  }

  private async writeContractLedger(client: import('pg').PoolClient, roomId: string, key: string, contractId: string, playerId: string, kind: string,
    cashChange: bigint, cashBalance: bigint, assetCategory: string | null = null, assetChange = 0n, assetBalance: bigint | null = null) {
    await client.query(`INSERT INTO player_contract_ledger(room_id,period_key,contract_id,player_id,entry_kind,cash_change_tomans,cash_balance_after_tomans,asset_category,asset_change_tomans,asset_balance_after_tomans)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [roomId, key, contractId, playerId, kind, cashChange.toString(), cashBalance.toString(), assetCategory,
      assetChange.toString(), assetBalance?.toString() ?? null]);
  }

  async updateAutopilot(roomId: string, token: string, input: { enabled: boolean; strategy: string; reserveMonths: number; investSurplusBps: number }) {
    const playerId = await this.authenticate(roomId, token);
    if (!input || typeof input.enabled !== 'boolean' || !['reserve', 'balanced', 'growth'].includes(input.strategy)
      || !Number.isInteger(input.reserveMonths) || input.reserveMonths < 0 || input.reserveMonths > 6
      || !Number.isInteger(input.investSurplusBps) || input.investSurplusBps < 0 || input.investSurplusBps > 5000) {
      throw new BadRequestException('invalid autopilot policy');
    }
    const result = await this.pool.query(`INSERT INTO autopilot_policies(room_id,player_id,enabled,strategy,reserve_months,invest_surplus_bps,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (room_id,player_id) DO UPDATE SET enabled=EXCLUDED.enabled,
      strategy=EXCLUDED.strategy,reserve_months=EXCLUDED.reserve_months,invest_surplus_bps=EXCLUDED.invest_surplus_bps,updated_at=now()
      RETURNING enabled,strategy,reserve_months,invest_surplus_bps`, [roomId, playerId, input.enabled, input.strategy, input.reserveMonths, input.investSurplusBps]);
    return result.rows[0];
  }

  async sendChat(roomId: string, token: string, input: { message: string }) {
    const playerId = await this.authenticate(roomId, token);
    if (!input || typeof input.message !== 'string') throw new BadRequestException('message required');
    const message = [...input.message].filter(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127).join(String()).trim();
    if (!message || message.length > 280) throw new BadRequestException('message must be 1..280 characters');
    const result = await this.pool.query(`INSERT INTO room_chat_messages(room_id,player_id,message) VALUES ($1,$2,$3)
      RETURNING id,player_id,message,created_at`, [roomId, playerId, message]);
    const member = await this.pool.query('SELECT display_name FROM room_members WHERE room_id=$1 AND player_id=$2', [roomId, playerId]);
    const chatMessage = { id: String(result.rows[0].id), playerId, displayName: String(member.rows[0].display_name), message, createdAt: new Date(result.rows[0].created_at).toISOString() };
    this.realtime.emitRoom(roomId, 'room.chat.message', chatMessage);
    return chatMessage;
  }

  async markTurnReady(roomId: string, token: string, key: string) {
    const playerId = await this.authenticate(roomId, token);
    this.validPeriodKey(key);
    const client = await this.pool.connect();
    let readyCount = 0;
    let humanCount = 0;
    let deadline: Date | null = null;
    try {
      await client.query('BEGIN');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await client.query('INSERT INTO room_turn_ready(room_id,period_key,player_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [roomId, key, playerId]);
      const counts = await client.query(`SELECT
        (SELECT count(*)::integer FROM room_turn_ready WHERE room_id=$1 AND period_key=$2) AS ready_count,
        (SELECT count(*)::integer FROM room_members WHERE room_id=$1 AND is_bot=false) AS human_count`, [roomId, key]);
      readyCount = Number(counts.rows[0].ready_count);
      humanCount = Number(counts.rows[0].human_count);
      if (readyCount >= humanCount) {
        deadline = new Date();
        await client.query('UPDATE room_turns SET deadline_at=$3 WHERE room_id=$1 AND period_key=$2', [roomId, key, deadline]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'period.ready.changed', { roomId, periodKey: key, readyCount, humanCount });
    if (deadline) await this.scheduleBestEffort(roomId, key, deadline);
    return { roomId, periodKey: key, readyCount, humanCount, settling: Boolean(deadline) };
  }

  async restructureDebt(roomId: string, token: string, key: string) {
    const playerId = await this.authenticate(roomId, token);
    this.validPeriodKey(key);
    const before = await this.snapshot(roomId, token);
    if (before.turn?.period_key !== key) throw new ForbiddenException('restructure is only available in the active period');
    if (!before.financial?.restructuringEligible) throw new ForbiddenException('restructuring eligibility is not met');
    const client = await this.pool.connect();
    const loanId = randomUUID();
    let amount = 0n;
    let rateBps = 0n;
    try {
      await client.query('BEGIN');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await this.assertNotReady(client, roomId, key, playerId);
      const account = await client.query('SELECT id FROM economy_accounts WHERE room_id=$1 AND id=$2 FOR UPDATE', [roomId, playerId]);
      if (!account.rowCount) throw new NotFoundException('account not found');
      const last = await client.query('SELECT period_key FROM debt_restructure_events WHERE room_id=$1 AND player_id=$2 ORDER BY period_key DESC LIMIT 1', [roomId, playerId]);
      if (last.rowCount) {
        const [lastYear, lastMonth] = String(last.rows[0].period_key).split('-').map(Number);
        const [year, month] = key.split('-').map(Number);
        if (year * 12 + month - (lastYear * 12 + lastMonth) < 3) throw new ForbiddenException('restructuring cooldown is active');
      }
      const loans = await client.query(`SELECT id,principal_tomans,arrears_interest_tomans,arrears_fee_tomans FROM loans
        WHERE room_id=$1 AND borrower_id=$2 AND (principal_tomans>0 OR arrears_interest_tomans>0 OR arrears_fee_tomans>0) FOR UPDATE`, [roomId, playerId]);
      for (const loan of loans.rows) amount += BigInt(String(loan.principal_tomans)) + BigInt(String(loan.arrears_interest_tomans)) + BigInt(String(loan.arrears_fee_tomans));
      const rent = await client.query('SELECT amount_tomans,paid_tomans FROM rent_arrears WHERE room_id=$1 AND account_id=$2 AND paid_tomans<amount_tomans FOR UPDATE', [roomId, playerId]);
      for (const row of rent.rows) amount += BigInt(String(row.amount_tomans)) - BigInt(String(row.paid_tomans));
      const claims = await client.query(`SELECT gc.id,gc.amount_tomans,gc.paid_tomans FROM guarantee_claims gc JOIN guarantees g
        ON g.id=gc.guarantee_id AND g.room_id=gc.room_id WHERE g.room_id=$1 AND g.guarantor_id=$2 AND gc.restructured_at IS NULL AND gc.paid_tomans<gc.amount_tomans FOR UPDATE OF gc`, [roomId, playerId]);
      for (const claim of claims.rows) amount += BigInt(String(claim.amount_tomans)) - BigInt(String(claim.paid_tomans));
      if (amount <= 0n || amount > 9_223_372_036_854_775_807n) throw new BadRequestException('no eligible debt to restructure');
      const scenarioResult = await client.query('SELECT r.scenario_id FROM rooms r WHERE r.id=$1', [roomId]);
      rateBps = scenarioById(String(scenarioResult.rows[0].scenario_id)).referenceAnnualRateBps;
      for (const loan of loans.rows) await client.query(`UPDATE loans SET principal_tomans=0,arrears_interest_tomans=0,
        arrears_principal_tomans=0,arrears_fee_tomans=0,months_remaining=0,monthly_penalty_bps=0 WHERE id=$1 AND room_id=$2`, [loan.id, roomId]);
      await client.query('UPDATE rent_arrears SET paid_tomans=amount_tomans WHERE room_id=$1 AND account_id=$2 AND paid_tomans<amount_tomans', [roomId, playerId]);
      await client.query('UPDATE guarantee_claims SET restructured_at=now() WHERE id=ANY($1::bigint[])', [claims.rows.map(row => String(row.id))]);
      await client.query(`INSERT INTO loans(id,room_id,borrower_id,principal_tomans,rate_kind,fixed_annual_rate_bps,variable_margin_bps,months_remaining,
        arrears_interest_tomans,arrears_principal_tomans,arrears_fee_tomans,monthly_penalty_bps)
        VALUES ($1,$2,$3,$4,'fixed',$5,NULL,36,0,0,0,0)`, [loanId, roomId, playerId, amount.toString(), rateBps.toString()]);
      await client.query(`INSERT INTO debt_restructure_events(id,room_id,player_id,period_key,consolidated_loan_id,original_debt_tomans)
        VALUES ($1,$2,$3,$4,$5,$6)`, [randomUUID(), roomId, playerId, key, loanId, amount.toString()]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'debt.restructured', { roomId, periodKey: key, playerId, amountTomans: amount.toString() });
    return { roomId, periodKey: key, loanId, amountTomans: amount.toString(), annualRateBps: rateBps.toString(), months: 36, rateKind: 'fixed' };
  }

  async issueLoan(roomId: string, token: string, key: string, input: { amountTomans: string; months: number; rateKind: string }) {
    const playerId = await this.authenticate(roomId, token);
    this.validPeriodKey(key);
    if (!input || typeof input.amountTomans !== 'string' || !/^\d{1,18}$/.test(input.amountTomans)) throw new BadRequestException('amountTomans must be an integer string');
    const principal = BigInt(input.amountTomans);
    if (principal < 500_000n || principal > 100_000_000n) throw new BadRequestException('loan amount must be 500,000..100,000,000 tomans');
    if (!Number.isSafeInteger(input.months) || input.months < LOAN_PRODUCTS.fixed.minMonths || input.months > LOAN_PRODUCTS.fixed.maxMonths) throw new BadRequestException('loan term must be 6..60 months');
    if (input.rateKind !== 'fixed' && input.rateKind !== 'variable') throw new BadRequestException('invalid loan rate kind');
    const client = await this.pool.connect();
    const loanId = randomUUID();
    let annualRate = 0n;
    let payment = 0n;
    try {
      await client.query('BEGIN');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await this.assertNotReady(client, roomId, key, playerId);
      const account = await client.query('SELECT cash_tomans,monthly_salary_tomans,monthly_rent_tomans FROM economy_accounts WHERE room_id=$1 AND id=$2 FOR UPDATE', [roomId, playerId]);
      if (!account.rowCount) throw new NotFoundException('account not found');
      const currentOrigin = await client.query('SELECT 1 FROM loan_originations WHERE room_id=$1 AND player_id=$2 AND period_key=$3', [roomId, playerId, key]);
      if (currentOrigin.rowCount) throw new ForbiddenException('one loan application is allowed per period');
      const room = await client.query('SELECT scenario_id FROM rooms WHERE id=$1', [roomId]);
      const scenario = scenarioById(String(room.rows[0].scenario_id));
      const product = input.rateKind === 'fixed' ? LOAN_PRODUCTS.fixed : LOAN_PRODUCTS.variable;
      annualRate = scenario.referenceAnnualRateBps + ('spreadBps' in product ? product.spreadBps : product.marginBps);
      payment = fixedPayment(principal, annualRate, input.months);

      const activeLoans = await client.query(`SELECT * FROM loans WHERE room_id=$1 AND borrower_id=$2
        AND (principal_tomans>0 OR arrears_interest_tomans>0 OR arrears_principal_tomans>0 OR arrears_fee_tomans>0) FOR UPDATE`, [roomId, playerId]);
      let existingService = 0n;
      let arrears = 0n;
      for (const loan of activeLoans.rows) {
        const rate = loan.rate_kind === 'fixed' ? BigInt(String(loan.fixed_annual_rate_bps))
          : scenario.referenceAnnualRateBps + BigInt(String(loan.variable_margin_bps));
        const loanArrears = BigInt(String(loan.arrears_interest_tomans)) + BigInt(String(loan.arrears_principal_tomans)) + BigInt(String(loan.arrears_fee_tomans));
        arrears += loanArrears;
        existingService += settleLoan({ principal: BigInt(String(loan.principal_tomans)),
          arrearsInterest: BigInt(String(loan.arrears_interest_tomans)), arrearsPrincipal: BigInt(String(loan.arrears_principal_tomans)),
          arrearsFee: BigInt(String(loan.arrears_fee_tomans)), monthsRemaining: Number(loan.months_remaining),
          monthlyPenaltyBps: BigInt(String(loan.monthly_penalty_bps)) }, rate, 9_223_372_036_854_775_807n).due;
      }
      const rentArrears = await client.query('SELECT COALESCE(SUM(amount_tomans-paid_tomans),0)::text AS total FROM rent_arrears WHERE room_id=$1 AND account_id=$2', [roomId, playerId]);
      arrears += BigInt(String(rentArrears.rows[0]?.total ?? '0'));
      if (arrears > 0n) throw new ForbiddenException('clear or restructure arrears before borrowing');
      const owned = await client.query('SELECT building_id,level FROM city_buildings WHERE room_id=$1 AND player_id=$2', [roomId, playerId]);
      const passiveIncome = owned.rows.reduce((sum, row) => {
        const building = CITY_BUILDINGS.find(item => item.id === String(row.building_id));
        return sum + (building?.monthlyIncome ?? 0n) * BigInt(String(row.level));
      }, 0n);
      const salary = BigInt(String(account.rows[0].monthly_salary_tomans));
      const rent = BigInt(String(account.rows[0].monthly_rent_tomans));
      const disposable = salary + passiveIncome > rent ? salary + passiveIncome - rent : 0n;
      const maximumDebtService = disposable * 4_000n / 10_000n;
      if (existingService + payment > maximumDebtService) throw new BadRequestException('monthly payment exceeds the 40% affordability limit');
      const cash = BigInt(String(account.rows[0].cash_tomans));
      if (cash + principal > 9_223_372_036_854_775_807n) throw new BadRequestException('cash balance limit exceeded');
      const fixedRate = input.rateKind === 'fixed' ? annualRate.toString() : null;
      const variableMargin = input.rateKind === 'variable' ? LOAN_PRODUCTS.variable.marginBps.toString() : null;
      await client.query(`INSERT INTO loans(id,room_id,borrower_id,principal_tomans,rate_kind,fixed_annual_rate_bps,variable_margin_bps,months_remaining,monthly_penalty_bps)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [loanId, roomId, playerId, principal.toString(), input.rateKind,
        fixedRate, variableMargin, input.months, product.monthlyPenaltyBps.toString()]);
      await client.query('UPDATE economy_accounts SET cash_tomans=cash_tomans+$3 WHERE room_id=$1 AND id=$2', [roomId, playerId, principal.toString()]);
      await client.query(`INSERT INTO loan_originations(id,room_id,player_id,loan_id,period_key,amount_tomans,annual_rate_bps)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), roomId, playerId, loanId, key, principal.toString(), annualRate.toString()]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'loan.issued', { roomId, periodKey: key, playerId, loanId });
    return { roomId, periodKey: key, playerId, loanId, amountTomans: principal.toString(), rateKind: input.rateKind,
      annualRateBps: annualRate.toString(), months: input.months, monthlyPaymentTomans: payment.toString() };
  }

  async requestGuaranteedCheck(roomId: string, token: string, key: string, input: { payeeId: string; guarantorId: string; duePeriod: string; amountTomans: string }) {
    const issuerId = await this.authenticate(roomId, token);
    this.validPeriodKey(key);
    if (!input || !uuidPattern.test(input.payeeId) || !uuidPattern.test(input.guarantorId)) throw new BadRequestException('valid payee and guarantor are required');
    this.validPeriodKey(input.duePeriod);
    if (input.duePeriod !== nextPeriod(key)) throw new BadRequestException('guaranteed checks must be due in the next Jalali month');
    if (input.payeeId === issuerId || input.guarantorId === issuerId || input.payeeId === input.guarantorId) throw new BadRequestException('issuer, payee and guarantor must be different players');
    if (typeof input.amountTomans !== 'string' || !/^\d{1,18}$/.test(input.amountTomans)) throw new BadRequestException('amountTomans must be an integer string');
    const amount = BigInt(input.amountTomans);
    if (amount < 100_000n || amount > 100_000_000n) throw new BadRequestException('check amount must be 100,000..100,000,000 tomans');
    const client = await this.pool.connect();
    const requestId = randomUUID();
    try {
      await client.query('BEGIN');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await this.assertNotReady(client, roomId, key, issuerId);
      const members = await client.query(`SELECT player_id,is_bot FROM room_members WHERE room_id=$1 AND player_id IN ($2,$3,$4)`, [roomId, input.payeeId, input.guarantorId, issuerId]);
      if (members.rowCount !== 3 || members.rows.some(member => Boolean(member.is_bot))) throw new BadRequestException('payee and guarantor must be human members of this room');
      await client.query(`INSERT INTO check_guarantee_requests(id,room_id,period_key,issuer_id,payee_id,guarantor_id,due_period,amount_tomans,guarantee_cap_tomans)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`, [requestId, roomId, key, issuerId, input.payeeId, input.guarantorId, input.duePeriod, amount.toString()]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'check.guarantee.requested', { roomId, periodKey: key, requestId });
    return { roomId, periodKey: key, requestId, status: 'pending', duePeriod: input.duePeriod, amountTomans: amount.toString() };
  }

  async respondGuaranteedCheck(roomId: string, token: string, requestId: string, accept: boolean) {
    const guarantorId = await this.authenticate(roomId, token);
    if (!uuidPattern.test(requestId) || typeof accept !== 'boolean') throw new BadRequestException('valid request id and decision are required');
    const client = await this.pool.connect();
    let checkId: string | null = null;
    let period = '';
    try {
      await client.query('BEGIN');
      const request = await client.query('SELECT * FROM check_guarantee_requests WHERE id=$1 AND room_id=$2 FOR UPDATE', [requestId, roomId]);
      if (!request.rowCount) throw new NotFoundException('guarantee request not found');
      const row = request.rows[0];
      period = String(row.period_key);
      if (String(row.guarantor_id) !== guarantorId) throw new ForbiddenException('only the proposed guarantor can respond');
      if (row.status !== 'pending') throw new ForbiddenException('guarantee request is no longer pending');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, period]);
      if (!turn.rowCount || turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await this.assertNotReady(client, roomId, period, guarantorId);
      if (accept) {
        checkId = randomUUID();
        await client.query(`INSERT INTO checks(id,room_id,issuer_id,payee_id,due_period,amount_tomans,status)
          VALUES ($1,$2,$3,$4,$5,$6,'pending')`, [checkId, roomId, row.issuer_id, row.payee_id, row.due_period, row.amount_tomans]);
        await client.query(`INSERT INTO guarantees(id,room_id,guarantor_id,check_id,cap_tomans)
          VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), roomId, guarantorId, checkId, row.guarantee_cap_tomans]);
      }
      await client.query('UPDATE check_guarantee_requests SET status=$3,check_id=$4 WHERE id=$1 AND room_id=$2', [requestId, roomId, accept ? 'accepted' : 'declined', checkId]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'check.guarantee.responded', { roomId, periodKey: period, requestId, status: accept ? 'accepted' : 'declined', checkId });
    return { roomId, requestId, periodKey: period, status: accept ? 'accepted' : 'declined', checkId };
  }

  async createBusiness(roomId: string, token: string, key: string, input: { modelId: string; managerEnabled?: boolean }) {
    const playerId = await this.authenticate(roomId, token);
    this.validPeriodKey(key);
    const model = BUSINESS_MODELS.find(item => item.id === input?.modelId);
    if (!model || (input.managerEnabled !== undefined && typeof input.managerEnabled !== 'boolean')) throw new BadRequestException('invalid business setup');
    const businessId = randomUUID();
    const client = await this.pool.connect();
    let branchNumber = 0;
    try {
      await client.query('BEGIN');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await this.assertNotReady(client, roomId, key, playerId);
      const [owned, branch] = await Promise.all([
        client.query('SELECT count(*)::integer AS count FROM business_owners WHERE room_id=$1 AND player_id=$2', [roomId, playerId]),
        client.query('SELECT COALESCE(max(branch_number),0)::integer AS max FROM business_branches WHERE room_id=$1 AND model_id=$2', [roomId, model.id]),
      ]);
      if (Number(owned.rows[0].count) >= 8) throw new BadRequestException('business branch limit reached');
      branchNumber = Number(branch.rows[0].max) + 1;
      if (branchNumber > 3) throw new BadRequestException('this business model reached the room branch limit');
      const account = await client.query('SELECT cash_tomans FROM economy_accounts WHERE room_id=$1 AND id=$2 FOR UPDATE', [roomId, playerId]);
      if (!account.rowCount) throw new NotFoundException('account not found');
      const cash = BigInt(String(account.rows[0].cash_tomans));
      if (cash < model.startupCost) throw new BadRequestException('insufficient_cash');
      const balanceAfter = cash - model.startupCost;
      await client.query('INSERT INTO business_branches(id,room_id,model_id,branch_number,level,manager_enabled,created_period) VALUES ($1,$2,$3,$4,1,$5,$6)',
        [businessId, roomId, model.id, branchNumber, input.managerEnabled ?? true, key]);
      await client.query('INSERT INTO business_owners(room_id,business_id,player_id,share_bps,capital_contributed_tomans) VALUES ($1,$2,$3,10000,$4)',
        [roomId, businessId, playerId, model.startupCost.toString()]);
      await client.query('UPDATE economy_accounts SET cash_tomans=$3 WHERE room_id=$1 AND id=$2', [roomId, playerId, balanceAfter.toString()]);
      await client.query(`INSERT INTO economy_ledger(room_id,period_key,account_id,source_kind,source_id,amount_tomans,balance_before_tomans,balance_after_tomans)
        VALUES ($1,$2,$3,'business_startup',$4,$5,$6-$5::bigint,$6)`, [roomId, key, playerId, businessId, (-model.startupCost).toString(), balanceAfter.toString()]);
      await client.query(`INSERT INTO business_ledger(room_id,business_id,period_key,player_id,entry_kind,amount_tomans)
        VALUES ($1,$2,$3,$4,'startup',$5)`, [roomId, businessId, key, playerId, model.startupCost.toString()]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'business.changed', { roomId, periodKey: key, businessId, action: 'opened' });
    return { roomId, periodKey: key, businessId, modelId: model.id, branchNumber, startupCostTomans: model.startupCost.toString(), managerEnabled: input.managerEnabled ?? true };
  }

  async setBusinessManager(roomId: string, token: string, key: string, businessId: string, enabled: boolean) {
    const playerId = await this.authenticate(roomId, token);
    this.validPeriodKey(key); this.validRoomId(roomId);
    if (!uuidPattern.test(businessId) || typeof enabled !== 'boolean') throw new BadRequestException('invalid manager request');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await this.assertNotReady(client, roomId, key, playerId);
      const owned = await client.query(`UPDATE business_branches b SET manager_enabled=$4 WHERE b.room_id=$1 AND b.id=$2
        AND EXISTS (SELECT 1 FROM business_owners o WHERE o.business_id=b.id AND o.player_id=$3) RETURNING b.id`, [roomId, businessId, playerId, enabled]);
      if (!owned.rowCount) throw new NotFoundException('business not found or not owned');
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'business.changed', { roomId, periodKey: key, businessId, action: enabled ? 'manager_hired' : 'manager_released' });
    return { roomId, periodKey: key, businessId, managerEnabled: enabled };
  }

  async proposeBusinessPartner(roomId: string, token: string, key: string, businessId: string, input: { partnerId: string; shareBps: number; contributionTomans: string }) {
    const proposerId = await this.authenticate(roomId, token);
    this.validPeriodKey(key); this.validRoomId(roomId);
    if (!uuidPattern.test(businessId) || !input || !uuidPattern.test(input.partnerId) || input.partnerId === proposerId
      || !Number.isSafeInteger(input.shareBps) || input.shareBps < 500 || input.shareBps > 9000
      || typeof input.contributionTomans !== 'string' || !/^\d{1,18}$/.test(input.contributionTomans)) throw new BadRequestException('invalid partnership terms');
    const contribution = BigInt(input.contributionTomans);
    const offerId = randomUUID();
    const client = await this.pool.connect();
    let autoAccepted = false;
    let partnerIsBot = false;
    try {
      await client.query('BEGIN');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await this.assertNotReady(client, roomId, key, proposerId);
      const branch = await client.query('SELECT id FROM business_branches WHERE room_id=$1 AND id=$2 FOR UPDATE', [roomId, businessId]);
      if (!branch.rowCount) throw new NotFoundException('business not found');
      const proposer = await client.query('SELECT share_bps FROM business_owners WHERE room_id=$1 AND business_id=$2 AND player_id=$3 FOR UPDATE', [roomId, businessId, proposerId]);
      if (!proposer.rowCount || Number(proposer.rows[0].share_bps) <= input.shareBps) throw new ForbiddenException('insufficient ownership share');
      const invitee = await client.query('SELECT is_bot FROM room_members WHERE room_id=$1 AND player_id=$2', [roomId, input.partnerId]);
      if (!invitee.rowCount) throw new NotFoundException('partner not found in room');
      if ((await client.query('SELECT 1 FROM business_owners WHERE business_id=$1 AND player_id=$2', [businessId, input.partnerId])).rowCount) throw new BadRequestException('player already owns this business');
      partnerIsBot = Boolean(invitee.rows[0].is_bot);
      await client.query(`INSERT INTO business_partnership_offers(id,room_id,business_id,proposer_id,invitee_id,share_bps,contribution_tomans,period_key,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')`, [offerId, roomId, businessId, proposerId, input.partnerId, input.shareBps, contribution.toString(), key]);
      if (partnerIsBot) {
        const botAccount = await client.query('SELECT cash_tomans FROM economy_accounts WHERE room_id=$1 AND id=$2 FOR UPDATE', [roomId, input.partnerId]);
        const botCash = botAccount.rowCount ? BigInt(String(botAccount.rows[0].cash_tomans)) : 0n;
        if (input.shareBps <= Math.floor(Number(proposer.rows[0].share_bps) / 2) && contribution <= botCash / 5n) {
          await this.acceptBusinessPartnership(client, roomId, key, offerId, businessId, proposerId, input.partnerId, input.shareBps, contribution);
          autoAccepted = true;
        } else {
          await client.query("UPDATE business_partnership_offers SET status='declined',responded_at=now() WHERE id=$1", [offerId]);
        }
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'business.changed', { roomId, periodKey: key, businessId, action: autoAccepted ? 'partner_joined' : partnerIsBot ? 'bot_declined' : 'partnership_requested', offerId });
    return { roomId, periodKey: key, businessId, offerId, status: autoAccepted ? 'accepted' : partnerIsBot ? 'declined' : 'pending' };
  }

  async respondBusinessPartnership(roomId: string, token: string, offerId: string, accept: boolean) {
    const partnerId = await this.authenticate(roomId, token);
    this.validRoomId(roomId);
    if (!uuidPattern.test(offerId) || typeof accept !== 'boolean') throw new BadRequestException('invalid partnership response');
    const client = await this.pool.connect();
    let businessId: string; let key: string; let expired = false;
    try {
      await client.query('BEGIN');
      const offer = await client.query(`SELECT id,business_id,period_key,proposer_id,invitee_id,share_bps,contribution_tomans,status
        FROM business_partnership_offers WHERE room_id=$1 AND id=$2 FOR UPDATE`, [roomId, offerId]);
      if (!offer.rowCount || String(offer.rows[0].invitee_id) !== partnerId) throw new NotFoundException('partnership offer not found');
      if (offer.rows[0].status !== 'pending') throw new BadRequestException('partnership offer is no longer pending');
      businessId = String(offer.rows[0].business_id); key = String(offer.rows[0].period_key);
      const turn = await client.query("SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE", [roomId, key]);
      if (!turn.rowCount || turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) {
        await client.query("UPDATE business_partnership_offers SET status='expired',responded_at=now() WHERE id=$1", [offerId]);
        expired = true;
      } else {
        await this.assertNotReady(client, roomId, key, partnerId);
        if (accept) await this.acceptBusinessPartnership(client, roomId, key, offerId, businessId, String(offer.rows[0].proposer_id), partnerId,
          Number(offer.rows[0].share_bps), BigInt(String(offer.rows[0].contribution_tomans)));
        else await client.query("UPDATE business_partnership_offers SET status='declined',responded_at=now() WHERE id=$1", [offerId]);
      }
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    if (expired) throw new ForbiddenException('partnership offer expired with the turn');
    this.realtime.emitRoom(roomId, 'business.changed', { roomId, periodKey: key!, businessId: businessId!, action: accept ? 'partner_joined' : 'partnership_declined', playerId: partnerId });
    return { roomId, periodKey: key!, businessId: businessId!, status: accept ? 'accepted' : 'declined' };
  }

  private async acceptBusinessPartnership(client: import('pg').PoolClient, roomId: string, key: string, offerId: string, businessId: string, proposerId: string, partnerId: string, shareBps: number, contribution: bigint) {
    const proposer = await client.query('SELECT share_bps FROM business_owners WHERE room_id=$1 AND business_id=$2 AND player_id=$3 FOR UPDATE', [roomId, businessId, proposerId]);
    if (!proposer.rowCount || Number(proposer.rows[0].share_bps) <= shareBps) throw new BadRequestException('partnership ownership changed');
    const account = await client.query('SELECT cash_tomans FROM economy_accounts WHERE room_id=$1 AND id=$2 FOR UPDATE', [roomId, partnerId]);
    if (!account.rowCount || BigInt(String(account.rows[0].cash_tomans)) < contribution) throw new BadRequestException('partner has insufficient cash');
    const balanceAfter = BigInt(String(account.rows[0].cash_tomans)) - contribution;
    await client.query('UPDATE business_owners SET share_bps=share_bps-$4 WHERE room_id=$1 AND business_id=$2 AND player_id=$3', [roomId, businessId, proposerId, shareBps]);
    await client.query('INSERT INTO business_owners(room_id,business_id,player_id,share_bps,capital_contributed_tomans) VALUES ($1,$2,$3,$4,$5)', [roomId, businessId, partnerId, shareBps, contribution.toString()]);
    await client.query('UPDATE economy_accounts SET cash_tomans=$3 WHERE room_id=$1 AND id=$2', [roomId, partnerId, balanceAfter.toString()]);
    if (contribution > 0n) {
      await client.query(`INSERT INTO economy_ledger(room_id,period_key,account_id,source_kind,source_id,amount_tomans,balance_before_tomans,balance_after_tomans)
        VALUES ($1,$2,$3,'business_partner_capital',$4,$5,$6-$5::bigint,$6)`, [roomId, key, partnerId, offerId, (-contribution).toString(), balanceAfter.toString()]);
      await client.query(`INSERT INTO business_ledger(room_id,business_id,period_key,player_id,entry_kind,amount_tomans)
        VALUES ($1,$2,$3,$4,'partner_capital',$5)`, [roomId, businessId, key, partnerId, contribution.toString()]);
    }
    await client.query("UPDATE business_partnership_offers SET status='accepted',responded_at=now() WHERE room_id=$1 AND id=$2", [roomId, offerId]);
  }

  async buildCity(roomId: string, token: string, key: string, buildingId: string, operation: string) {
    const playerId = await this.authenticate(roomId, token);
    this.validPeriodKey(key);
    const building = CITY_BUILDINGS.find(item => item.id === buildingId);
    if (!building) throw new BadRequestException('invalid building');
    if (operation !== 'build' && operation !== 'upgrade') throw new BadRequestException('invalid building operation');
    const client = await this.pool.connect();
    let level: number;
    let cost: bigint;
    try {
      await client.query('BEGIN');
      const turn = await client.query('SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) throw new ForbiddenException('period is locked');
      await this.assertNotReady(client, roomId, key, playerId);
      const account = await client.query('SELECT cash_tomans FROM economy_accounts WHERE room_id=$1 AND id=$2 FOR UPDATE', [roomId, playerId]);
      if (!account.rowCount) throw new NotFoundException('account not found');
      const current = await client.query('SELECT level FROM city_buildings WHERE room_id=$1 AND player_id=$2 AND building_id=$3 FOR UPDATE', [roomId, playerId, buildingId]);
      const previousLevel = current.rowCount ? Number(current.rows[0].level) : 0;
      if ((previousLevel === 0 && operation !== 'build') || (previousLevel > 0 && operation !== 'upgrade')) {
        throw new BadRequestException(previousLevel === 0 ? 'building must be constructed first' : 'building already exists; upgrade it');
      }
      if (previousLevel >= 5) throw new BadRequestException('building is at maximum level');
      level = previousLevel + 1;
      cost = building.baseCost * BigInt(level);
      const cash = BigInt(String(account.rows[0].cash_tomans));
      if (cash < cost) throw new BadRequestException('insufficient_cash');
      await client.query('UPDATE economy_accounts SET cash_tomans=cash_tomans-$3 WHERE room_id=$1 AND id=$2', [roomId, playerId, cost.toString()]);
      await client.query(`INSERT INTO city_buildings(room_id,player_id,building_id,level) VALUES ($1,$2,$3,$4)
        ON CONFLICT (room_id,player_id,building_id) DO UPDATE SET level=EXCLUDED.level,updated_at=now()`, [roomId, playerId, buildingId, level]);
      await client.query(`INSERT INTO city_building_transactions(room_id,period_key,player_id,building_id,operation,previous_level,new_level,cost_tomans)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [roomId, key, playerId, buildingId, operation, previousLevel, level, cost.toString()]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    this.realtime.emitRoom(roomId, 'city.building.changed', { roomId, periodKey: key, playerId, buildingId, level });
    return { roomId, periodKey: key, playerId, buildingId, level, costTomans: cost.toString(), status: 'built' };
  }

  async submitDecision(roomId: string, token: string, key: string, input: { action: string; category?: string; amountTomans?: string }) {
    const playerId = await this.authenticate(roomId, token);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new BadRequestException('invalid period');
    if (!input || !['hold', 'buy', 'sell'].includes(input.action)) throw new BadRequestException('invalid action');
    const action = input.action;
    const categories = ['car', 'gold', 'currency', 'equipment', 'materials'];
    let category: string | null = null;
    let amount = 0n;
    if (action === 'hold') {
      if (input.category !== undefined || input.amountTomans !== undefined) throw new BadRequestException('hold does not accept an amount or category');
    } else {
      if (typeof input.category !== 'string' || !categories.includes(input.category)) throw new BadRequestException('invalid asset category');
      if (typeof input.amountTomans !== 'string' || !/^\d{1,18}$/.test(input.amountTomans)) throw new BadRequestException('amountTomans must be an integer string');
      amount = BigInt(input.amountTomans);
      if (amount <= 0n || amount > 9_223_372_036_854_775_807n) throw new BadRequestException('invalid amount');
      category = input.category;
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const turn = await client.query("SELECT status,deadline_at FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE", [roomId, key]);
      if (!turn.rowCount) throw new NotFoundException('period not found');
      if (turn.rows[0].status !== 'open' || new Date(turn.rows[0].deadline_at).getTime() <= Date.now()) {
        throw new ForbiddenException('period is locked');
      }
      await this.assertNotReady(client, roomId, key, playerId);
      await client.query(`INSERT INTO player_decisions(room_id,period_key,player_id,action_type,category,amount_tomans,status,reason,submitted_at,processed_at)
        VALUES ($1,$2,$3,$4,$5,$6,'pending',NULL,now(),NULL)
        ON CONFLICT (room_id,period_key,player_id) DO UPDATE SET action_type=EXCLUDED.action_type,category=EXCLUDED.category,
        amount_tomans=EXCLUDED.amount_tomans,status='pending',reason=NULL,submitted_at=now(),processed_at=NULL`,
        [roomId, key, playerId, action, category, amount.toString()]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    this.realtime.emitRoom(roomId, 'decision.updated', { roomId, periodKey: key, playerId });
    return { roomId, periodKey: key, action, category, amountTomans: amount.toString(), status: 'pending' };
  }

  async returnReport(roomId: string, token: string, sincePeriod?: string) {
    const playerId = await this.authenticate(roomId, token);
    if (sincePeriod) this.validPeriodKey(sincePeriod);
    const current = await this.pool.query("SELECT period_key FROM room_turns WHERE room_id=$1 AND status='open' ORDER BY period_key DESC LIMIT 1", [roomId]);
    if (!current.rowCount) return { fromPeriod: sincePeriod ?? null, toPeriod: null, periods: [] };
    const currentKey = String(current.rows[0].period_key);
    if (!sincePeriod || sincePeriod >= currentKey) return { fromPeriod: sincePeriod ?? null, toPeriod: currentKey, periods: [] };
    const [ledger, decisions, ledgerEntries] = await Promise.all([
      this.pool.query(`SELECT period_key,
        COALESCE(SUM(GREATEST(amount_tomans,0)),0)::text AS income_tomans,
        COALESCE(SUM(GREATEST(-amount_tomans,0)),0)::text AS expense_tomans,
        COALESCE(SUM(amount_tomans),0)::text AS net_cash_change_tomans,
        COALESCE(SUM(amount_tomans) FILTER (WHERE source_kind='salary'),0)::text AS salary_tomans,
        COALESCE(SUM(amount_tomans) FILTER (WHERE source_kind='city_income'),0)::text AS city_income_tomans
        FROM economy_ledger WHERE room_id=$1 AND account_id=$2 AND period_key >= $3 AND period_key < $4
        GROUP BY period_key ORDER BY period_key`, [roomId, playerId, sincePeriod, currentKey]),
      this.pool.query(`SELECT period_key,action_type,category,amount_tomans,status,reason FROM player_decisions
        WHERE room_id=$1 AND player_id=$2 AND period_key >= $3 AND period_key < $4 ORDER BY period_key`, [roomId, playerId, sincePeriod, currentKey]),
      this.pool.query(`SELECT ledger.id,ledger.period_key,ledger.source_kind,ledger.source_id,ledger.amount_tomans,
        branch.model_id AS business_model_id,branch.branch_number AS business_branch_number,
        CASE WHEN ledger.source_kind='loan_payment' AND COALESCE(origin.period_key,loan_contract.period_key,restructure.period_key) IS NOT NULL THEN
          ((split_part(ledger.period_key,'-',1)::integer-split_part(COALESCE(origin.period_key,loan_contract.period_key,restructure.period_key),'-',1)::integer)*12
          + split_part(ledger.period_key,'-',2)::integer-split_part(COALESCE(origin.period_key,loan_contract.period_key,restructure.period_key),'-',2)::integer+1)
        END AS loan_installment_number
        FROM economy_ledger ledger
        LEFT JOIN business_branches branch ON branch.room_id=ledger.room_id AND (
          (ledger.source_kind='business_startup' AND branch.id::text=ledger.source_id) OR
          (ledger.source_kind='business_income' AND branch.id::text=split_part(ledger.source_id,':',1))
        )
        LEFT JOIN loan_originations origin ON ledger.source_kind='loan_payment'
          AND origin.loan_id::text=ledger.source_id AND origin.room_id=ledger.room_id
        LEFT JOIN player_contracts loan_contract ON ledger.source_kind='loan_payment'
          AND loan_contract.loan_id::text=ledger.source_id AND loan_contract.room_id=ledger.room_id
        LEFT JOIN debt_restructure_events restructure ON ledger.source_kind='loan_payment'
          AND restructure.consolidated_loan_id::text=ledger.source_id AND restructure.room_id=ledger.room_id
        WHERE ledger.room_id=$1 AND ledger.account_id=$2 AND ledger.period_key >= $3 AND ledger.period_key < $4
        ORDER BY ledger.period_key,ledger.id`, [roomId, playerId, sincePeriod, currentKey]),
    ]);
    const decisionByPeriod = new Map(decisions.rows.map(row => [String(row.period_key), row]));
    const entriesByPeriod = new Map<string, Array<{ id: string; sourceKind: string; sourceId: string; amountTomans: string; businessModelId?: string; businessBranchNumber?: number; loanInstallmentNumber?: number }>>();
    for (const row of ledgerEntries.rows) {
      const key = String(row.period_key);
      const entries = entriesByPeriod.get(key) ?? [];
      entries.push({ id: String(row.id), sourceKind: String(row.source_kind), sourceId: String(row.source_id), amountTomans: String(row.amount_tomans),
        ...(row.business_model_id ? { businessModelId: String(row.business_model_id), businessBranchNumber: Number(row.business_branch_number) } : {}),
        ...(row.loan_installment_number ? { loanInstallmentNumber: Number(row.loan_installment_number) } : {}) });
      entriesByPeriod.set(key, entries);
    }
    const periods = ledger.rows.map(row => {
      const key = String(row.period_key);
      const decision = decisionByPeriod.get(key);
      return { periodKey: key, incomeTomans: String(row.income_tomans), expenseTomans: String(row.expense_tomans),
        netCashChangeTomans: String(row.net_cash_change_tomans), salaryTomans: String(row.salary_tomans), cityIncomeTomans: String(row.city_income_tomans),
        transactions: entriesByPeriod.get(key) ?? [],
        delegateAction: decision ? { action: String(decision.action_type), category: decision.category ? String(decision.category) : null,
          amountTomans: String(decision.amount_tomans), status: String(decision.status), reason: decision.reason ? String(decision.reason) : null } : null };
    });
    return { fromPeriod: sincePeriod, toPeriod: currentKey, periods };
  }

  async openOrSettlingTurns() {
    const rows = await this.pool.query("SELECT room_id,period_key,deadline_at,status FROM room_turns WHERE status IN ('open','settling')");
    return rows.rows.map(row => ({ roomId: String(row.room_id), periodKey: String(row.period_key), deadline: new Date(row.deadline_at), status: String(row.status) }));
  }

  async processDueTurn(roomId: string, key: string) {
    this.validRoomId(roomId);
    nextPeriod(key);
    const client = await this.pool.connect();
    let scenarioId: string;
    let turnSeconds: number;
    let newlyLocked = false;
    try {
      await client.query('BEGIN');
      const result = await client.query(`SELECT t.status,t.deadline_at,r.scenario_id,r.turn_seconds
        FROM room_turns t JOIN rooms r ON r.id=t.room_id WHERE t.room_id=$1 AND t.period_key=$2 FOR UPDATE OF t`, [roomId, key]);
      if (!result.rowCount || result.rows[0].status === 'published') { await client.query('COMMIT'); return { status: 'already_published' }; }
      if (result.rows[0].status === 'open' && new Date(result.rows[0].deadline_at).getTime() > Date.now()) {
        await client.query('COMMIT'); return { status: 'not_due' };
      }
      scenarioId = String(result.rows[0].scenario_id);
      turnSeconds = Number(result.rows[0].turn_seconds);
      newlyLocked = result.rows[0].status === 'open';
      await client.query("UPDATE room_turns SET status='settling' WHERE room_id=$1 AND period_key=$2", [roomId, key]);
      await client.query("UPDATE check_guarantee_requests SET status='expired' WHERE room_id=$1 AND period_key=$2 AND status='pending'", [roomId, key]);
      await client.query("UPDATE player_contracts SET status='expired',responded_at=now() WHERE room_id=$1 AND period_key=$2 AND status='pending'", [roomId, key]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }

    if (newlyLocked) this.realtime.emitRoom(roomId, 'period.locked', { roomId, periodKey: key });
    await this.economy.settlePeriod(roomId, key, scenarioId);
    const botActions = await this.pool.query(`SELECT rm.player_id AS "playerId",rm.display_name AS "displayName",rm.bot_style AS style,
      pd.action_type AS action,pd.category,pd.amount_tomans AS "amountTomans",pd.status
      FROM player_decisions pd JOIN room_members rm USING(room_id,player_id)
      WHERE pd.room_id=$1 AND pd.period_key=$2 AND rm.is_bot=true ORDER BY rm.joined_at`, [roomId, key]);
    const nextKey = nextPeriod(key);
    const deadline = new Date(Date.now() + turnSeconds * 1000);
    const finalize = await this.pool.connect();
    let newlyPublished = false;
    try {
      await finalize.query('BEGIN');
      const turn = await finalize.query('SELECT status FROM room_turns WHERE room_id=$1 AND period_key=$2 FOR UPDATE', [roomId, key]);
      if (turn.rows[0]?.status !== 'published') {
        await finalize.query("UPDATE room_turns SET status='published',published_at=now() WHERE room_id=$1 AND period_key=$2", [roomId, key]);
        await finalize.query('INSERT INTO room_turns(room_id,period_key,deadline_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [roomId, nextKey, deadline]);
        newlyPublished = true;
      }
      await finalize.query('COMMIT');
    } catch (error) { await finalize.query('ROLLBACK'); throw error; }
    finally { finalize.release(); }
    if (!newlyPublished) return { status: 'already_published' };
    await this.scheduleBestEffort(roomId, nextKey, deadline);
    this.realtime.emitRoom(roomId, 'city.rivals.acted', { roomId, periodKey: key, actions: botActions.rows });
    this.realtime.emitRoom(roomId, 'period.result.published', { roomId, periodKey: key });
    this.realtime.emitRoom(roomId, 'period.opened', { roomId, periodKey: nextKey, deadlineAt: deadline.toISOString() });
    return { status: 'published', nextPeriodKey: nextKey };
  }

  private async scheduleBestEffort(roomId: string, key: string, deadline: Date) {
    try { await this.scheduler?.(roomId, key, deadline); }
    catch { /* PostgreSQL deadline remains authoritative; recovery sweep schedules it. */ }
  }

  private async assertNotReady(client: import('pg').PoolClient, roomId: string, key: string, playerId: string) {
    const ready = await client.query('SELECT 1 FROM room_turn_ready WHERE room_id=$1 AND period_key=$2 AND player_id=$3', [roomId, key, playerId]);
    if (ready.rowCount) throw new ForbiddenException('you have already marked this turn ready');
  }

  private validRoomId(id: string) { if (!uuidPattern.test(id)) throw new BadRequestException('invalid room id'); }
  private validPeriodKey(key: string) { if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new BadRequestException('invalid period'); }
  private name(value: string, max: number) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new BadRequestException('invalid name');
    return value.trim();
  }
}
