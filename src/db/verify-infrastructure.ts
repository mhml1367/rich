import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { Pool } from 'pg';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';

async function main() {
  if (!process.env.DATABASE_URL || !process.env.REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const queueConnection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const workerConnection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const eventsConnection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const queueName = `masir-infra-${randomUUID()}`;
  const queue = new Queue<{ value: number }>(queueName, { connection: queueConnection });
  queue.setMaxListeners(0);
  const events = new QueueEvents(queueName, { connection: eventsConnection });
  const worker = new Worker<{ value: number }>(queueName, async job => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return job.data.value * 2;
  }, { connection: workerConnection, concurrency: 8 });
  const servers: Array<{ http: ReturnType<typeof createServer>; io: Server; pub: Redis; sub: Redis; port: number }> = [];
  const sockets: Array<{ close: () => void }> = [];
  try {
    const database = await pool.query(`SELECT current_database() AS database,
      (SELECT count(*)::integer FROM information_schema.tables WHERE table_schema='public') AS tables`);
    const pong = await redis.ping();
    const serverInfo = await redis.info('server');
    const redisVersion = serverInfo.match(/^redis_version:(.+)$/m)?.[1]?.trim();
    if (!redisVersion) throw new Error('Redis did not report its server version');
    const [redisMajor, redisMinor] = redisVersion.split('.').map(Number);
    if (redisMajor < 6 || (redisMajor === 6 && redisMinor < 2)) throw new Error(`BullMQ requires Redis 6.2 or newer; found ${redisVersion}`);
    await events.waitUntilReady();
    const jobs = await Promise.all(Array.from({ length: 64 }, (_, value) => queue.add('concurrent-round-trip', { value }, { removeOnComplete: true, removeOnFail: true })));
    const values = await Promise.all(jobs.map(job => job.waitUntilFinished(events, 20_000)));
    if (values.length !== 64 || values.some((value, index) => value !== index * 2)) throw new Error('BullMQ concurrent results were missing or out of order');

    const requireFromClient = createRequire(resolve(process.cwd(), 'client', 'package.json'));
    const socketClient = requireFromClient('socket.io-client') as { io: (url: string, options: object) => { on: (event: string, handler: (...args: unknown[]) => void) => void; close: () => void } };
    for (let index = 0; index < 2; index++) {
      const http = createServer();
      const io = new Server(http, { transports: ['websocket'] });
      const pub = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
      const sub = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
      io.adapter(createAdapter(pub, sub));
      io.on('connection', socket => socket.join('qa-concurrent-room'));
      await new Promise<void>(resolve => http.listen(0, '127.0.0.1', resolve));
      const address = http.address();
      if (!address || typeof address === 'string') throw new Error('Socket.IO test server failed to bind');
      servers.push({ http, io, pub, sub, port: address.port });
    }
    const received = [new Set<number>(), new Set<number>()];
    let connected = 0;
    let resolveConnected!: () => void;
    const allConnected = new Promise<void>(resolve => { resolveConnected = resolve; });
    servers.forEach((server, index) => {
      const socket = socketClient.io(`http://127.0.0.1:${server.port}`, { transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      socket.on('connect', () => { connected++; if (connected === 2) resolveConnected(); });
      socket.on('qa-concurrent', (...args: unknown[]) => {
        const payload = args[0] as { sequence: number };
        received[index].add(payload.sequence);
        if (received.every(set => set.size === 64)) resolveMessages();
      });
    });
    await Promise.race([allConnected, new Promise((_, reject) => setTimeout(() => reject(new Error('Socket.IO clients did not connect')), 10_000))]);
    let resolveMessages!: () => void;
    const allMessages = new Promise<void>(resolve => { resolveMessages = resolve; });
    for (let sequence = 0; sequence < 64; sequence++) servers[0].io.to('qa-concurrent-room').emit('qa-concurrent', { sequence });
    await Promise.race([allMessages, new Promise((_, reject) => setTimeout(() => reject(new Error('Socket.IO Redis fanout lost concurrent messages')), 10_000))]);
    if (received.some(set => set.size !== 64)) throw new Error('Socket.IO Redis fanout count mismatch');
    process.stdout.write(`${JSON.stringify({ postgres: database.rows[0], redis: pong, redisVersion, bullmq: '64-concurrent-jobs-ok', websocket: '64-events-x-2-servers-ok' })}\n`);
  } finally {
    for (const socket of sockets) socket.close();
    await Promise.all(servers.map(async ({ http, io, pub, sub }) => {
      await new Promise<void>(resolve => io.close(() => resolve()));
      await new Promise<void>(resolve => http.close(() => resolve()));
      await Promise.all([pub.quit(), sub.quit()]);
    }));
    await worker.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await Promise.all([redis.quit(), queueConnection.quit(), workerConnection.quit(), eventsConnection.quit(), pool.end()]);
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
