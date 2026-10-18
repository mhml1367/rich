import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { EconomyService } from '../src/economy/economy.service';
import { nextPeriod } from '../src/economy/calendar';
import { RoomService } from '../src/rooms/room.service';
import { RealtimeService } from '../src/rooms/realtime.service';

test('economic period lookup and replay are scoped to the requested room', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT status, scenario_id')) return { rowCount: 1, rows: [{ status: 'published', scenario_id: 'recession' }] };
      return { rowCount: 0, rows: [] };
    },
    release: () => {},
  };
  const pool = { connect: async () => client, query: client.query } as unknown as Pool;
  const economy = new EconomyService(pool);
  const first = await economy.settlePeriod('room-a', '1405-07', 'recession');
  const second = await economy.settlePeriod('room-b', '1405-07', 'recession');
  assert.equal(first.alreadySettled, true);
  assert.equal(second.alreadySettled, true);
  const existing = calls.filter(call => call.sql.startsWith('SELECT status, scenario_id'));
  assert.deepEqual(existing.map(call => call.values), [['room-a', '1405-07'], ['room-b', '1405-07']]);
  assert.equal(calls.some(call => call.sql.startsWith('INSERT')), false);
});

test('new room persists member, account, and first turn in one transaction', async () => {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    query: async (sql: string, values?: unknown[]) => { calls.push({ sql, values }); return { rowCount: 0, rows: [] }; },
    release: () => {},
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const rooms = new RoomService(pool, {} as EconomyService, new RealtimeService());
  let scheduled: { roomId: string; periodKey: string } | undefined;
  rooms.setScheduler(async (roomId, periodKey) => { scheduled = { roomId, periodKey }; });
  const created = await rooms.create({ title: 'شهر', displayName: 'مینا', mode: 'async', scenarioId: 'boom' });
  assert.equal(calls[0].sql, 'BEGIN');
  assert.equal(calls.at(-1)?.sql, 'COMMIT');
  assert.equal(calls.filter(call => call.sql.startsWith('INSERT')).length, 8);
  assert.ok(calls.some(call => call.sql.includes('INSERT INTO room_event_cards')));
  assert.equal(calls.find(call => call.sql.startsWith('INSERT INTO economy_accounts'))?.values?.[1], created.roomId);
  assert.deepEqual(scheduled, { roomId: created.roomId, periodKey: created.periodKey });
  assert.ok(created.token.length >= 40);
});

test('live-room members share room updates while each snapshot keeps its own decision private', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const events: Array<{ room: string; event: string }> = [];
    const realtime = new RealtimeService();
    realtime.attach({ to: (room: string) => ({ emit: (event: string) => events.push({ room, event }) }) } as never);
    const rooms = new RoomService(pool, {} as EconomyService, realtime);
    const host = await rooms.create({ title: 'Live city', displayName: 'Host', mode: 'live', scenarioId: 'boom', turnSeconds: 300 });
    const guest = await rooms.join(host.roomId, 'Guest');
    const hostSnapshot = await rooms.snapshot(host.roomId, host.token);
    const guestSnapshot = await rooms.snapshot(host.roomId, guest.token);
    assert.equal(hostSnapshot.members.length, 2);
    assert.equal(guestSnapshot.members.length, 2);
    assert.equal(hostSnapshot.turn.period_key, guestSnapshot.turn.period_key);
    await rooms.submitDecision(host.roomId, host.token, host.periodKey, { action: 'hold' });
    assert.equal((await rooms.snapshot(host.roomId, host.token)).decision?.action_type, 'hold');
    assert.equal((await rooms.snapshot(host.roomId, guest.token)).decision, null);
    assert.ok(events.some(item => item.room === `room:${host.roomId}` && item.event === 'room.members.changed'));
    assert.ok(events.some(item => item.room === `room:${host.roomId}` && item.event === 'decision.updated'));
  } finally { await db.close(); }
});

test('city construction and upgrades charge the player and persist within the active turn', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const rooms = new RoomService(pool, {} as EconomyService, new RealtimeService());
    const created = await rooms.create({ title: 'شهر', displayName: 'مینا', mode: 'solo', scenarioId: 'boom', turnSeconds: 300 });
    const built = await rooms.buildCity(created.roomId, created.token, created.periodKey, 'workshop', 'build');
    assert.equal(built.level, 1);
    assert.equal(built.costTomans, '4000000');
    assert.equal((await db.query('SELECT cash_tomans FROM economy_accounts WHERE id=$1', [created.playerId])).rows[0].cash_tomans, 6000000);

    await assert.rejects(rooms.buildCity(created.roomId, created.token, created.periodKey, 'workshop', 'upgrade'), /insufficient_cash/);
    const park = await rooms.buildCity(created.roomId, created.token, created.periodKey, 'park', 'build');
    assert.equal(park.level, 1);
    assert.equal(park.costTomans, '1500000');
    const snapshot = await rooms.snapshot(created.roomId, created.token);
    assert.equal(snapshot.city.find(item => item.buildingId === 'workshop')?.level, 1);
    assert.equal(snapshot.city.find(item => item.buildingId === 'workshop')?.nextCostTomans, '8000000');
    assert.equal(snapshot.city.find(item => item.buildingId === 'workshop')?.monthlyIncomeTomans, '860000');
    assert.equal(snapshot.financial?.status, 'building');
    assert.equal(snapshot.financial?.passiveIncomeTomans, '860000');

    await new EconomyService(pool).settlePeriod(created.roomId, created.periodKey, 'boom');
    const account = await db.query('SELECT cash_tomans FROM economy_accounts WHERE id=$1', [created.playerId]);
    const delegated = await db.query("SELECT amount_tomans,category,status FROM player_decisions WHERE room_id=$1 AND period_key=$2 AND player_id=$3", [created.roomId, created.periodKey, created.playerId]);
    assert.equal(delegated.rows[0].category, 'materials');
    assert.equal(delegated.rows[0].status, 'delegated');
    const income = await db.query("SELECT amount_tomans FROM economy_ledger WHERE account_id=$1 AND source_kind='city_income'", [created.playerId]);
    const periodFlows = await db.query("SELECT source_kind,amount_tomans FROM economy_ledger WHERE account_id=$1 AND source_kind IN ('salary','rent')", [created.playerId]);
    const salary = BigInt(String(periodFlows.rows.find(row => row.source_kind === 'salary')?.amount_tomans));
    const rent = BigInt(String(periodFlows.rows.find(row => row.source_kind === 'rent')?.amount_tomans));
    const invested = BigInt(String(delegated.rows[0].amount_tomans));
    const fee = (invested * 50n + 5_000n) / 10_000n;
    assert.equal(BigInt(String(account.rows[0].cash_tomans)), 4_500_000n + salary + rent + BigInt(String(income.rows[0].amount_tomans)) - invested);
    const holding = await db.query("SELECT market_value_tomans FROM investment_positions WHERE room_id=$1 AND player_id=$2 AND category='materials'", [created.roomId, created.playerId]);
    assert.equal(BigInt(String(holding.rows[0].market_value_tomans)), invested - fee);
    const feeEntry = await db.query("SELECT amount_tomans FROM economy_ledger WHERE account_id=$1 AND source_kind='market_fee'", [created.playerId]);
    assert.equal(BigInt(String(feeEntry.rows[0].amount_tomans)), -fee);
  } finally { await db.close(); }
});

test('selling gold pays the net proceeds and records the market fee separately', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const economy = new EconomyService(pool);
    const rooms = new RoomService(pool, economy, new RealtimeService());
    const created = await rooms.create({ title: 'بازار طلا', displayName: 'مینا', mode: 'solo', scenarioId: 'recession', turnSeconds: 300 });
    await db.query("INSERT INTO investment_positions(room_id,player_id,category,market_value_tomans) VALUES ($1,$2,'gold',2000000)", [created.roomId, created.playerId]);
    await rooms.submitDecision(created.roomId, created.token, created.periodKey, { action: 'sell', category: 'gold', amountTomans: '1000000' });
    await economy.settlePeriod(created.roomId, created.periodKey, 'recession');
    const ledger = await db.query("SELECT source_kind,amount_tomans FROM economy_ledger WHERE room_id=$1 AND account_id=$2 AND source_kind IN ('asset_sell','market_fee') ORDER BY source_kind", [created.roomId, created.playerId]);
    assert.deepEqual(ledger.rows.map(row => [row.source_kind, String(row.amount_tomans)]), [['asset_sell', '1000000'], ['market_fee', '-5000']]);
    const account = await db.query('SELECT cash_tomans FROM economy_accounts WHERE room_id=$1 AND id=$2', [created.roomId, created.playerId]);
    const otherFlows = await db.query("SELECT COALESCE(SUM(amount_tomans),0)::text AS amount FROM economy_ledger WHERE room_id=$1 AND account_id=$2 AND source_kind NOT IN ('asset_sell','market_fee')", [created.roomId, created.playerId]);
    assert.equal(BigInt(String(account.rows[0].cash_tomans)), 10_000_000n + BigInt(String(otherFlows.rows[0].amount)) + 995_000n);
  } finally { await db.close(); }
});

test('eligible arrears consolidate into one fixed loan and enforce the cooldown', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const rooms = new RoomService(pool, {} as EconomyService, new RealtimeService());
    const created = await rooms.create({ title: 'شهر', displayName: 'مینا', mode: 'solo', scenarioId: 'boom', turnSeconds: 300 });
    const oldLoanId = '11111111-1111-4111-8111-111111111111';
    await db.query(`INSERT INTO loans(id,room_id,borrower_id,principal_tomans,rate_kind,fixed_annual_rate_bps,months_remaining)
      VALUES ($1,$2,$3,20000000,'fixed',1800,24)`, [oldLoanId, created.roomId, created.playerId]);
    const before = await rooms.snapshot(created.roomId, created.token);
    assert.equal(before.financial?.status, 'bankrupt');
    assert.equal(before.financial?.canRestructure, true);
    const result = await rooms.restructureDebt(created.roomId, created.token, created.periodKey);
    assert.equal(result.amountTomans, '20000000');
    assert.equal(result.months, 36);
    assert.equal(result.rateKind, 'fixed');
    const oldLoan = await db.query('SELECT principal_tomans,months_remaining FROM loans WHERE id=$1', [oldLoanId]);
    assert.equal(String(oldLoan.rows[0].principal_tomans), '0');
    assert.equal(Number(oldLoan.rows[0].months_remaining), 0);
    const newLoan = await db.query('SELECT principal_tomans,rate_kind,months_remaining FROM loans WHERE id=$1', [result.loanId]);
    assert.equal(String(newLoan.rows[0].principal_tomans), '20000000');
    assert.equal(newLoan.rows[0].rate_kind, 'fixed');
    assert.equal(Number(newLoan.rows[0].months_remaining), 36);
    await assert.rejects(rooms.restructureDebt(created.roomId, created.token, created.periodKey), /cooldown/);
  } finally { await db.close(); }
});

test('solo rooms include six distinct AI personalities and rank their real net worth', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const economy = new EconomyService(pool);
    const rooms = new RoomService(pool, economy, new RealtimeService());
    const created = await rooms.create({ title: 'شهر', displayName: 'مینا', mode: 'solo', scenarioId: 'boom', turnSeconds: 300 });
    const roster = await db.query('SELECT display_name,bot_style,bot_difficulty FROM room_members WHERE room_id=$1 AND is_bot=true ORDER BY bot_style', [created.roomId]);
    assert.deepEqual(roster.rows.map(row => row.bot_style), ['analyst', 'balanced', 'conservative', 'consumer', 'entrepreneur', 'opportunist']);
    assert.ok(roster.rows.every(row => ['easy', 'normal', 'hard'].includes(String(row.bot_difficulty))));
    await economy.settlePeriod(created.roomId, created.periodKey, 'boom');
    const decisions = await db.query("SELECT rm.bot_style,pd.action_type,pd.category,pd.amount_tomans,pd.status FROM room_members rm JOIN player_decisions pd ON pd.room_id=rm.room_id AND pd.player_id=rm.player_id WHERE rm.room_id=$1 AND rm.is_bot=true ORDER BY rm.bot_style", [created.roomId]);
    assert.deepEqual(decisions.rows.map(row => [row.bot_style, row.action_type, row.category, row.status]), [
      ['analyst', 'buy', 'materials', 'delegated'], ['balanced', 'buy', 'materials', 'delegated'],
      ['conservative', 'buy', 'gold', 'delegated'], ['consumer', 'hold', null, 'delegated'],
      ['entrepreneur', 'buy', 'materials', 'delegated'], ['opportunist', 'buy', 'materials', 'delegated'],
    ]);
    assert.ok(BigInt(String(decisions.rows[4].amount_tomans)) > BigInt(String(decisions.rows[2].amount_tomans)));
    const snapshot = await rooms.snapshot(created.roomId, created.token);
    assert.equal(snapshot.leaderboard.length, 7);
    assert.equal(snapshot.leaderboard[0].rank, 1);
    assert.ok(snapshot.leaderboard.every(entry => entry.playerId === created.playerId
      ? typeof entry.netWorthTomans === 'string' && typeof entry.cashTomans === 'string'
      : entry.netWorthTomans === null && entry.cashTomans === null));
  } finally { await db.close(); }
});

test('business launch, bot partnership, and monthly profit distribution persist atomically', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const economy = new EconomyService(pool);
    const rooms = new RoomService(pool, economy, new RealtimeService());
    const created = await rooms.create({ title: 'شهر کسب‌وکار', displayName: 'مینا', mode: 'solo', scenarioId: 'boom', turnSeconds: 300 });
    const started = await rooms.createBusiness(created.roomId, created.token, created.periodKey, { modelId: 'grocery' });
    assert.equal(started.startupCostTomans, '8000000');
    const rival = (await db.query('SELECT player_id FROM room_members WHERE room_id=$1 AND is_bot=true LIMIT 1', [created.roomId])).rows[0];
    const offer = await rooms.proposeBusinessPartner(created.roomId, created.token, created.periodKey, started.businessId, {
      partnerId: String(rival.player_id), shareBps: 2000, contributionTomans: '1000000',
    });
    assert.equal(offer.status, 'accepted');
    const owners = await db.query('SELECT share_bps FROM business_owners WHERE business_id=$1 ORDER BY share_bps', [started.businessId]);
    assert.deepEqual(owners.rows.map(row => Number(row.share_bps)), [2000, 8000]);
    await economy.settlePeriod(created.roomId, created.periodKey, 'boom');
    const result = await db.query('SELECT revenue_tomans,materials_cost_tomans,payroll_cost_tomans,overhead_cost_tomans,manager_cost_tomans,net_profit_tomans,distributed_tomans FROM business_period_results WHERE business_id=$1', [started.businessId]);
    const row = result.rows[0];
    assert.equal(BigInt(String(row.net_profit_tomans)), BigInt(String(row.revenue_tomans)) - BigInt(String(row.materials_cost_tomans))
      - BigInt(String(row.payroll_cost_tomans)) - BigInt(String(row.overhead_cost_tomans)) - BigInt(String(row.manager_cost_tomans)));
    assert.ok(BigInt(String(row.distributed_tomans)) > 0n);
    const snapshot = await rooms.snapshot(created.roomId, created.token);
    assert.equal(snapshot.businesses.length, 1);
    assert.equal(snapshot.businesses[0].owners.find(owner => owner.playerId === created.playerId)?.shareBps, 8000);
    assert.equal(snapshot.businessMonthlyIncomeTomans, (BigInt(String(row.distributed_tomans)) * 8n / 10n).toString());
    assert.ok(BigInt(snapshot.financial?.assetsTomans || '0') > 0n);
    const ledger = await db.query('SELECT amount_tomans,balance_before_tomans,balance_after_tomans FROM economy_ledger WHERE room_id=$1', [created.roomId]);
    assert.ok(ledger.rowCount > 0);
    for (const entry of ledger.rows) assert.equal(BigInt(String(entry.balance_before_tomans)) + BigInt(String(entry.amount_tomans)), BigInt(String(entry.balance_after_tomans)));
  } finally { await db.close(); }
});

test('autopilot settles six consecutive turns for a player absent for half a year', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const economy = new EconomyService(pool);
    const rooms = new RoomService(pool, economy, new RealtimeService());
    const created = await rooms.create({ title: 'Absent player', displayName: 'Player', mode: 'async', scenarioId: 'high_inflation', turnSeconds: 60, botCount: 0 });
    const periods: string[] = [];
    let key = created.periodKey;
    for (let i = 0; i < 6; i++) {
      periods.push(key);
      await db.query("UPDATE room_turns SET deadline_at=now()-interval '1 minute' WHERE room_id=$1 AND period_key=$2", [created.roomId, key]);
      const result = await rooms.processDueTurn(created.roomId, key);
      assert.equal(result.status, 'published');
      key = result.nextPeriodKey!;
    }
    assert.equal(periods[0], '1405-07');
    assert.equal(periods[5], '1405-12');
    const decisions = await db.query("SELECT status,COUNT(*)::int AS n FROM player_decisions WHERE room_id=$1 AND player_id=$2 GROUP BY status", [created.roomId, created.playerId]);
    assert.deepEqual(decisions.rows.map(row => [row.status, Number(row.n)]), [['delegated', 6]]);
    const published = await db.query("SELECT COUNT(*)::int AS n FROM room_turns WHERE room_id=$1 AND status='published'", [created.roomId]);
    assert.equal(Number(published.rows[0].n), 6);
    const rent = await db.query("SELECT COUNT(*)::int AS n FROM economy_ledger WHERE room_id=$1 AND account_id=$2 AND source_kind='rent'", [created.roomId, created.playerId]);
    assert.equal(Number(rent.rows[0].n), 6);
    await db.query("UPDATE room_turns SET deadline_at=now()-interval '1 minute' WHERE room_id=$1 AND period_key=$2", [created.roomId, periods[5]]);
    assert.equal((await rooms.processDueTurn(created.roomId, periods[5])).status, 'already_published');
    assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM player_decisions WHERE room_id=$1 AND player_id=$2", [created.roomId, created.playerId])).rows[0].n, 6);
  } finally { await db.close(); }
});

test('a business loss is recorded and carried as unpaid expenses when its reserve is empty', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const economy = new EconomyService(pool);
    const rooms = new RoomService(pool, economy, new RealtimeService());
    const created = await rooms.create({ title: 'Recession test', displayName: 'Owner', mode: 'solo', scenarioId: 'recession', turnSeconds: 300 });
    const started = await rooms.createBusiness(created.roomId, created.token, created.periodKey, { modelId: 'grocery' });
    await db.query('UPDATE business_branches SET manager_enabled=false WHERE id=$1', [started.businessId]);
    await economy.settlePeriod(created.roomId, created.periodKey, 'recession');
    const result = await db.query('SELECT net_profit_tomans,retained_tomans,unpaid_expenses_tomans FROM business_period_results WHERE business_id=$1', [started.businessId]);
    assert.ok(BigInt(String(result.rows[0].net_profit_tomans)) < 0n);
    assert.equal(String(result.rows[0].retained_tomans), '0');
    assert.ok(BigInt(String(result.rows[0].unpaid_expenses_tomans)) > 0n);
    const branch = await db.query('SELECT unpaid_expenses_tomans FROM business_branches WHERE id=$1', [started.businessId]);
    assert.equal(String(branch.rows[0].unpaid_expenses_tomans), String(result.rows[0].unpaid_expenses_tomans));
  } finally { await db.close(); }
});

test('room invite codes enforce configured capacity and player contracts settle to both ledgers', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const economy = new EconomyService(pool);
    const rooms = new RoomService(pool, economy, new RealtimeService());
    const host = await rooms.create({ title: 'اتاق معامله', displayName: 'مینا', mode: 'live', scenarioId: 'boom', turnSeconds: 300, maxPlayers: 2, botCount: 0 });
    const guest = await rooms.join(host.inviteCode, 'سارا');
    assert.equal(guest.roomId, host.roomId);
    await assert.rejects(rooms.join(host.inviteCode, 'بازیکن سوم'), /room full/);
    await db.query('INSERT INTO investment_positions(room_id,player_id,category,market_value_tomans) VALUES ($1,$2,\'gold\',2000000)', [host.roomId, host.playerId]);
    const loanOffer = await rooms.proposePlayerContract(host.roomId, host.token, host.periodKey, {
      counterpartyId: guest.playerId, kind: 'loan', amountTomans: '1000000', interestBps: 1800, months: 12,
    });
    const loanAccepted = await rooms.respondPlayerContract(host.roomId, guest.token, loanOffer.contractId, true);
    assert.equal(loanAccepted.status, 'accepted');
    const loan = await db.query('SELECT borrower_id,lender_id,principal_tomans FROM loans WHERE id=$1', [loanAccepted.loanId]);
    assert.equal(loan.rows[0].borrower_id, guest.playerId);
    assert.equal(loan.rows[0].lender_id, host.playerId);
    const tradeOffer = await rooms.proposePlayerContract(host.roomId, host.token, host.periodKey, {
      counterpartyId: guest.playerId, kind: 'asset_trade', amountTomans: '500000', assetCategory: 'gold', assetValueTomans: '1500000',
    });
    await rooms.respondPlayerContract(host.roomId, guest.token, tradeOffer.contractId, true);
    const holdings = await db.query('SELECT player_id,market_value_tomans FROM investment_positions WHERE room_id=$1 AND category=\'gold\' ORDER BY player_id', [host.roomId]);
    assert.equal(String(holdings.rows.find(row => row.player_id === host.playerId)?.market_value_tomans), '500000');
    assert.equal(String(holdings.rows.find(row => row.player_id === guest.playerId)?.market_value_tomans), '1500000');
    const tradeEntries = await db.query('SELECT entry_kind FROM player_contract_ledger WHERE contract_id=$1 ORDER BY id', [tradeOffer.contractId]);
    assert.deepEqual(tradeEntries.rows.map(row => row.entry_kind), ['cash_received','cash_paid','asset_sent','asset_received']);
    const hostSnapshot = await rooms.snapshot(host.roomId, host.token);
    assert.equal(hostSnapshot.leaderboard.find(entry => entry.playerId === guest.playerId)?.netWorthTomans, null);
    assert.equal(hostSnapshot.leaderboard.find(entry => entry.playerId === guest.playerId)?.cashTomans, null);
    await economy.settlePeriod(host.roomId, host.periodKey, 'boom');
    const repayments = await db.query("SELECT amount_tomans FROM economy_ledger WHERE room_id=$1 AND source_kind='p2p_loan_repayment_received'", [host.roomId]);
    assert.equal(repayments.rowCount, 1);
    assert.ok(BigInt(String(repayments.rows[0].amount_tomans)) > 0n);
  } finally { await db.close(); }
});

test('loan issue records fixed terms and enforces the affordability limit atomically', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const rooms = new RoomService(pool, {} as EconomyService, new RealtimeService());
    const created = await rooms.create({ title: 'شهر', displayName: 'مینا', mode: 'solo', scenarioId: 'boom', turnSeconds: 300 });
    await assert.rejects(rooms.issueLoan(created.roomId, created.token, created.periodKey, { amountTomans: '100000000', months: 6, rateKind: 'fixed' }), /40% affordability/);
    const issued = await rooms.issueLoan(created.roomId, created.token, created.periodKey, { amountTomans: '10000000', months: 24, rateKind: 'fixed' });
    assert.equal(issued.annualRateBps, '2300');
    assert.equal(issued.months, 24);
    assert.ok(BigInt(issued.monthlyPaymentTomans) > 0n);
    assert.equal(String((await db.query('SELECT cash_tomans FROM economy_accounts WHERE id=$1', [created.playerId])).rows[0].cash_tomans), '20000000');
    const origin = await db.query('SELECT amount_tomans,annual_rate_bps FROM loan_originations WHERE loan_id=$1', [issued.loanId]);
    assert.equal(String(origin.rows[0].amount_tomans), '10000000');
    assert.equal(Number(origin.rows[0].annual_rate_bps), 2300);
    const snapshot = await rooms.snapshot(created.roomId, created.token);
    assert.equal(snapshot.loans[0].principalTomans, '10000000');
    assert.equal(snapshot.loanOffers.fixedAnnualRateBps, '2300');
    await assert.rejects(rooms.issueLoan(created.roomId, created.token, created.periodKey, { amountTomans: '5000000', months: 24, rateKind: 'fixed' }), /one loan application/);
    assert.equal((await db.query('SELECT count(*)::integer AS total FROM loans WHERE borrower_id=$1', [created.playerId])).rows[0].total, 1);
  } finally { await db.close(); }
});

test('guaranteed checks require the named guarantor and settle on their Jalali due period', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? Promise.resolve({ rowCount: 1, rows: [{}] })
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const economy = new EconomyService(pool);
    const rooms = new RoomService(pool, economy, new RealtimeService());
    const issuer = await rooms.create({ title: 'شهر', displayName: 'مینا', mode: 'async', scenarioId: 'recession', turnSeconds: 300 });
    const payee = await rooms.join(issuer.roomId, 'سارا');
    const guarantor = await rooms.join(issuer.roomId, 'رضا');
    const duePeriod = nextPeriod(issuer.periodKey);
    const request = await rooms.requestGuaranteedCheck(issuer.roomId, issuer.token, issuer.periodKey, {
      payeeId: payee.playerId, guarantorId: guarantor.playerId, duePeriod, amountTomans: '20000000',
    });
    assert.equal(request.status, 'pending');
    assert.equal((await db.query('SELECT count(*)::integer AS total FROM checks WHERE room_id=$1', [issuer.roomId])).rows[0].total, 0);
    await assert.rejects(rooms.respondGuaranteedCheck(issuer.roomId, issuer.token, request.requestId, true), /only the proposed guarantor/);
    const accepted = await rooms.respondGuaranteedCheck(issuer.roomId, guarantor.token, request.requestId, true);
    assert.equal(accepted.status, 'accepted');
    assert.ok(accepted.checkId);
    assert.equal((await db.query('SELECT count(*)::integer AS total FROM guarantees WHERE room_id=$1 AND check_id=$2', [issuer.roomId, accepted.checkId])).rows[0].total, 1);
    const payeeBefore = BigInt(String((await db.query('SELECT cash_tomans FROM economy_accounts WHERE id=$1', [payee.playerId])).rows[0].cash_tomans));
    for (const playerId of [issuer.playerId, guarantor.playerId]) {
      await db.query("INSERT INTO player_decisions(room_id,period_key,player_id,action_type,category,amount_tomans,status) VALUES ($1,$2,$3,'hold',NULL,0,'pending')", [issuer.roomId, issuer.periodKey, playerId]);
    }
    await economy.settlePeriod(issuer.roomId, issuer.periodKey, 'recession');
    await db.query("UPDATE room_turns SET status='published',published_at=now() WHERE room_id=$1 AND period_key=$2", [issuer.roomId, issuer.periodKey]);
    await db.query('INSERT INTO room_turns(room_id,period_key,deadline_at) VALUES ($1,$2,now()+interval \'1 day\')', [issuer.roomId, duePeriod]);
    for (const playerId of [issuer.playerId, guarantor.playerId]) {
      await db.query("INSERT INTO player_decisions(room_id,period_key,player_id,action_type,category,amount_tomans,status) VALUES ($1,$2,$3,'hold',NULL,0,'pending')", [issuer.roomId, duePeriod, playerId]);
    }
    await economy.settlePeriod(issuer.roomId, duePeriod, 'recession');
    const check = await db.query('SELECT status,settled_period FROM checks WHERE id=$1', [accepted.checkId]);
    assert.equal(check.rows[0].status, 'bounced');
    assert.equal(check.rows[0].settled_period, duePeriod);
    const payeeAfter = BigInt(String((await db.query('SELECT cash_tomans FROM economy_accounts WHERE id=$1', [payee.playerId])).rows[0].cash_tomans));
    assert.ok(payeeAfter > payeeBefore);
    const paid = await db.query("SELECT COALESCE(sum(amount_tomans),0)::text AS total FROM economy_ledger WHERE room_id=$1 AND source_kind='check_guarantee_credit'", [issuer.roomId]);
    assert.ok(BigInt(paid.rows[0].total) > 0n);
    const claim = await db.query("SELECT amount_tomans FROM guarantee_claims WHERE room_id=$1 AND reason='bounced_check'", [issuer.roomId]);
    assert.equal(claim.rowCount, 1);
    assert.ok(BigInt(String(claim.rows[0].amount_tomans)) > 0n);
    const collectionPeriod = nextPeriod(duePeriod);
    await db.query("UPDATE room_turns SET status='published',published_at=now() WHERE room_id=$1 AND period_key=$2", [issuer.roomId, duePeriod]);
    await db.query('INSERT INTO room_turns(room_id,period_key,deadline_at) VALUES ($1,$2,now()+interval \'1 day\')', [issuer.roomId, collectionPeriod]);
    await economy.settlePeriod(issuer.roomId, collectionPeriod, 'recession');
    const claimAfterPayment = await db.query('SELECT amount_tomans,paid_tomans FROM guarantee_claims WHERE room_id=$1 AND reason=\'bounced_check\'', [issuer.roomId]);
    assert.ok(BigInt(String(claimAfterPayment.rows[0].paid_tomans)) > 0n);
    assert.ok(BigInt(String(claimAfterPayment.rows[0].paid_tomans)) < BigInt(String(claimAfterPayment.rows[0].amount_tomans)));
  } finally { await db.close(); }
});
