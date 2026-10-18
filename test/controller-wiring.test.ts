import assert from 'node:assert/strict';
import test from 'node:test';
import { Module, UnauthorizedException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { EconomyController } from '../src/economy/economy.controller';
import { EconomyService } from '../src/economy/economy.service';
import { AuthService } from '../src/auth/auth.service';
import { RoomController } from '../src/rooms/room.controller';
import { RoomService } from '../src/rooms/room.service';

test('Nest injects room and economy controllers and protects city creation with a phone session', async () => {
  class SmokeModule {}
  Module({
    controllers: [RoomController, EconomyController],
    providers: [
      { provide: AuthService, useValue: { authenticate: async (token: string) => {
        if (token !== 'valid-phone-session') throw new UnauthorizedException();
        return { id: 'd8a6a4d2-2bc8-44c1-bc91-67d3c9a2742a' };
      } } },
      { provide: RoomService, useValue: {
        create: async (_input: unknown, accountId: string) => ({ roomId: 'room-created', accountId }),
        join: async () => ({ roomId: 'room-joined' }),
        authenticate: async () => 'player-id',
      } },
      { provide: EconomyService, useValue: { getIndexHistory: async () => [{ periodKey: '1405-07' }] } },
    ],
  })(SmokeModule);
  const app = await NestFactory.create(SmokeModule, { logger: false });
  try {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const denied = await fetch(`${base}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 401);
    const created = await fetch(`${base}/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer valid-phone-session' }, body: JSON.stringify({ title: 'Smoke', displayName: 'Player', mode: 'solo', scenarioId: 'boom' }) });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { roomId: 'room-created', accountId: 'd8a6a4d2-2bc8-44c1-bc91-67d3c9a2742a' });
    const history = await fetch(`${base}/economy/rooms/room-id/history`, { headers: { Authorization: 'Bearer any-room-token' } });
    assert.equal(history.status, 200);
    assert.deepEqual(await history.json(), [{ periodKey: '1405-07' }]);
  } finally { await app.close(); }
});
