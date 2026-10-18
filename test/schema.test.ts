import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import { EconomyService } from '../src/economy/economy.service';
import { RoomService } from '../src/rooms/room.service';
import { RealtimeService } from '../src/rooms/realtime.service';

test('schema creates room-scoped financial records and rejects cross-room checks', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const roomA = '11111111-1111-4111-8111-111111111111';
    const roomB = '22222222-2222-4222-8222-222222222222';
    const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await db.query("INSERT INTO rooms(id,title,mode,scenario_id,turn_seconds) VALUES ($1,'A','async','boom',60),($2,'B','async','boom',60)", [roomA, roomB]);
    await db.query('INSERT INTO economy_accounts(id,room_id) VALUES ($1,$2),($3,$4)', [accountA, roomA, accountB, roomB]);
    await db.query("INSERT INTO economic_periods(room_id,period_key,scenario_id,status) VALUES ($1,'1405-07','boom','published'),($2,'1405-07','boom','published')", [roomA, roomB]);
    await db.query("INSERT INTO price_indices(room_id,period_key,category,index_units) VALUES ($1,'1405-07','food',1010000),($2,'1405-07','food',1050000)", [roomA, roomB]);
    const results = await db.query("SELECT room_id,index_units FROM price_indices WHERE period_key='1405-07' ORDER BY room_id");
    assert.deepEqual(results.rows.map(row => String(row.index_units)), ['1010000', '1050000']);
    await assert.rejects(db.query("INSERT INTO checks(id,room_id,issuer_id,payee_id,due_period,amount_tomans) VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',$1,$2,$3,'1405-07',1000)", [roomA, accountA, accountB]));
  } finally {
    await db.close();
  }
});

test('due room turn settles once and opens the next Jalali month', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const client = {
      query: async (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? { rowCount: 1, rows: [{}] }
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const economy = new EconomyService(pool);
    const rooms = new RoomService(pool, economy, new RealtimeService());
    const jobs: string[] = [];
    rooms.setScheduler(async (_roomId, key) => { jobs.push(key); });
    const created = await rooms.create({ title: 'شهر', displayName: 'مینا', mode: 'solo', scenarioId: 'boom', turnSeconds: 30 });
    assert.equal((await rooms.processDueTurn(created.roomId, created.periodKey)).status, 'not_due');
    await db.query("UPDATE room_turns SET deadline_at=now()-interval '1 second' WHERE room_id=$1", [created.roomId]);
    const result = await rooms.processDueTurn(created.roomId, created.periodKey);
    assert.equal(result.status, 'published');
    assert.equal((await rooms.processDueTurn(created.roomId, created.periodKey)).status, 'already_published');
    const turns = await db.query('SELECT period_key,status FROM room_turns WHERE room_id=$1 ORDER BY period_key', [created.roomId]);
    assert.deepEqual(turns.rows.map(row => row.status), ['published', 'open']);
    assert.equal(jobs.length, 2);
    const report = await rooms.returnReport(created.roomId, created.token, created.periodKey);
    assert.equal(report.periods.length, 1);
    assert.equal(report.periods[0].periodKey, created.periodKey);
    assert.ok(BigInt(report.periods[0].salaryTomans) > 0n);
    assert.ok(report.periods[0].transactions.some((item) => item.sourceKind === 'salary' && BigInt(item.amountTomans) > 0n));
    assert.ok(report.periods[0].transactions.some((item) => item.sourceKind === 'rent' && BigInt(item.amountTomans) < 0n));
    assert.equal(report.periods[0].delegateAction?.status, 'delegated');
  } finally { await db.close(); }
});

test('monthly settlement updates each room independently and is idempotent', async () => {
  const db = new PGlite();
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const roomA = '11111111-1111-4111-8111-111111111111';
    const roomB = '22222222-2222-4222-8222-222222222222';
    const accountA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const accountB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await db.query("INSERT INTO rooms(id,title,mode,scenario_id,turn_seconds) VALUES ($1,'A','async','boom',60),($2,'B','async','recession',60)", [roomA, roomB]);
    await db.query("INSERT INTO room_members(room_id,player_id,display_name,token_hash) VALUES ($1,$2,'A','hash-a'),($3,$4,'B','hash-b')", [roomA, accountA, roomB, accountB]);
    await db.query("INSERT INTO room_turns(room_id,period_key,deadline_at) VALUES ($1,'1405-07',now()-interval '1 day'),($2,'1405-07',now()-interval '1 day')", [roomA, roomB]);
    await db.query('INSERT INTO economy_accounts(id,room_id,cash_tomans,monthly_salary_tomans,monthly_rent_tomans) VALUES ($1,$2,10000000,6000000,2000000),($3,$4,10000000,6000000,2000000)', [accountA, roomA, accountB, roomB]);
    const client = {
      query: async (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
        ? { rowCount: 1, rows: [{}] }
        : db.query(sql, values as never[] | undefined),
      release: () => {},
    };
    const pool = { connect: async () => client, query: client.query } as unknown as Pool;
    const economy = new EconomyService(pool);
    await economy.settlePeriod(roomA, '1405-07', 'boom');
    await economy.settlePeriod(roomB, '1405-07', 'recession');
    const historyA = await economy.getIndexHistory(roomA);
    const historyB = await economy.getIndexHistory(roomB);
    assert.equal(historyA.length, 1);
    assert.equal(historyA[0].periodKey, '1405-07');
    assert.equal(Object.keys(historyA[0].indices).length, 7);
    assert.notDeepEqual(historyA[0].indices, historyB[0].indices);
    assert.equal((await economy.settlePeriod(roomA, '1405-07', 'boom')).alreadySettled, true);
    const balances = await db.query('SELECT room_id,cash_tomans FROM economy_accounts ORDER BY room_id');
    assert.deepEqual(balances.rows.map(row => String(row.cash_tomans)), ['11060000', '11001500']);
    const ledgers = await db.query('SELECT room_id,count(*)::integer AS entries FROM economy_ledger GROUP BY room_id ORDER BY room_id');
    assert.deepEqual(ledgers.rows.map(row => Number(row.entries)), [4, 4]);
    const delegates = await db.query('SELECT room_id,action_type,category,status FROM player_decisions WHERE period_key=$1 ORDER BY room_id', ['1405-07']);
    assert.deepEqual(delegates.rows.map(row => [row.action_type, row.category, row.status]), [
      ['buy', 'materials', 'delegated'], ['buy', 'currency', 'delegated'],
    ]);
  } finally { await db.close(); }
});
