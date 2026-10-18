import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PGlite } from '@electric-sql/pglite';
import { EconomyService } from '../src/economy/economy.service';
import { RealtimeService } from '../src/rooms/realtime.service';
import { RoomService } from '../src/rooms/room.service';

test('Nest injects RoomService and chat sends a realtime event', async () => {
  const db = new PGlite();
  await db.exec(await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8'));
  const client = {
    query: (sql: string, values?: unknown[]) => sql.includes('pg_advisory_xact_lock')
      ? Promise.resolve({ rowCount: 1, rows: [{}] })
      : db.query(sql, values as never[] | undefined),
    release: () => {},
  };
  const pool = { connect: async () => client, query: client.query };
  class WiringModule {}
  Module({
    providers: [
      { provide: 'PG_POOL', useValue: pool },
      EconomyService,
      RealtimeService,
      RoomService,
    ],
  })(WiringModule);

  const app = await NestFactory.createApplicationContext(WiringModule, { logger: false });
  try {
    const rooms = app.get(RoomService);
    const realtime = app.get(RealtimeService);
    assert.ok((rooms as unknown as { economy?: EconomyService }).economy);
    assert.equal((rooms as unknown as { realtime?: RealtimeService }).realtime, realtime);

    const emissions: Array<{ room: string; event: string; payload: Record<string, unknown> }> = [];
    realtime.attach({
      to: (room: string) => ({ emit: (event: string, payload: object) => emissions.push({ room, event, payload }) }),
    } as never);
    const created = await rooms.create({ title: 'Chat test', displayName: 'Player', mode: 'live', scenarioId: 'boom' });
    const chat = await rooms.sendChat(created.roomId, created.token, { message: 'سلام' });
    assert.equal(emissions.length, 1);
    assert.equal(emissions[0].room, `room:${created.roomId}`);
    assert.equal(emissions[0].event, 'room.chat.message');
    assert.equal(emissions[0].payload.message, chat.message);
  } finally {
    await app.close();
    await db.close();
  }
});
