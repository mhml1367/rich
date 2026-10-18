import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import type { Pool } from 'pg';
import type Redis from 'ioredis';
import { AuthService } from '../src/auth/auth.service';
import { RoomService } from '../src/rooms/room.service';
import { EconomyService } from '../src/economy/economy.service';
import { RealtimeService } from '../src/rooms/realtime.service';

class MemoryRedis {
  values = new Map<string, string>();
  counters = new Map<string, number>();
  async set(key: string, value: string, ...options: Array<string | number>) {
    if (options.includes('NX') && this.values.has(key)) return null;
    this.values.set(key, value); return 'OK';
  }
  async get(key: string) { return this.values.get(key) ?? null; }
  async del(...keys: string[]) { for (const key of keys) { this.values.delete(key); this.counters.delete(key); } return 1; }
  async incr(key: string) { const value = (this.counters.get(key) ?? 0) + 1; this.counters.set(key, value); return value; }
  async expire() { return 1; }
  async quit() { return 'OK'; }
}

test('mobile OTP registration, login, session revocation, and wrong-code handling work end to end', async () => {
  const db = new PGlite();
  const redis = new MemoryRedis();
  const oldEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'test';
  try {
    await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
    const pool = { query: (sql: string, values?: unknown[]) => db.query(sql, values as never[] | undefined), connect: async () => {
      const client = {
        query: (sql: string, values?: unknown[]) => db.query(sql, values as never[] | undefined),
        release: () => {},
      };
      return client;
    } } as unknown as Pool;
    const auth = new AuthService(pool, redis as unknown as Redis);
    const challenge = await auth.requestOtp({ phone: '09123456789', displayName: 'Mina', mode: 'register' });
    assert.equal(challenge.phone, '+989123456789');
    assert.match(challenge.developmentCode, /^\d{6}$/);
    await assert.rejects(auth.verifyOtp({ phone: '09123456789', code: '000000' }), /invalid_otp/);
    const registered = await auth.verifyOtp({ phone: '+989123456789', code: challenge.developmentCode });
    assert.equal(registered.user.displayName, 'Mina');
    assert.equal((await auth.authenticate(registered.token)).id, registered.user.id);
    const rooms = new RoomService(pool, {} as EconomyService, new RealtimeService());
    const city = await rooms.create({ title: 'Mina city', displayName: 'Mina', mode: 'solo', scenarioId: 'boom', botCount: 1, maxPlayers: 2 }, registered.user.id);
    const linked = await db.query('SELECT player_account_id FROM room_members WHERE room_id=$1 AND player_id=$2', [city.roomId, city.playerId]);
    assert.equal(linked.rows[0].player_account_id, registered.user.id);
    await auth.logout(registered.token);
    await assert.rejects(auth.authenticate(registered.token), /phone_session_expired/);

    await redis.del('masir:otp:throttle:+989123456789');
    const loginChallenge = await auth.requestOtp({ phone: '00989123456789', mode: 'login' });
    const loggedIn = await auth.verifyOtp({ phone: '09123456789', code: loginChallenge.developmentCode });
    assert.equal(loggedIn.user.id, registered.user.id);
    assert.equal(loggedIn.user.phone, registered.user.phone);
    await auth.onModuleDestroy();
  } finally {
    if (oldEnvironment === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldEnvironment;
    await db.close();
  }
});

test('phone OTP endpoints reject an unregistered login and invalid mobile numbers', async () => {
  const redis = new MemoryRedis();
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Pool;
  const auth = new AuthService(pool, redis as unknown as Redis);
  await assert.rejects(auth.requestOtp({ phone: '12345', mode: 'login' }), /invalid_iranian_mobile/);
  await assert.rejects(auth.requestOtp({ phone: '09123456789', mode: 'login' }), /phone_not_registered/);
  await auth.onModuleDestroy();
});
