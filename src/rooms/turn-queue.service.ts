import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import type { Pool } from 'pg';
import { RoomService } from './room.service';

interface TurnJob { roomId: string; periodKey: string }

@Injectable()
export class TurnQueueService implements OnModuleInit, OnModuleDestroy {
  private queue?: Queue<TurnJob>;
  private worker?: Worker<TurnJob>;
  private producerConnection?: Redis;
  private workerConnection?: Redis;
  private sweepTimer?: NodeJS.Timeout;

  constructor(@Inject(RoomService) private readonly rooms: RoomService, @Inject('PG_POOL') private readonly pool: Pool) {}

  async onModuleInit() {
    if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
    this.producerConnection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.workerConnection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    this.queue = new Queue<TurnJob>('room-turns', { connection: this.producerConnection });
    this.worker = new Worker<TurnJob>('room-turns', async job => {
      await this.rooms.processDueTurn(job.data.roomId, job.data.periodKey);
    }, { connection: this.workerConnection, concurrency: 4 });
    this.rooms.setScheduler((roomId, key, deadline) => this.schedule(roomId, key, deadline));
    await this.recover();
    this.sweepTimer = setInterval(() => { void this.recover().catch(error => console.error('turn recovery failed', error)); }, 60_000);
    this.sweepTimer.unref();
  }

  async schedule(roomId: string, periodKey: string, deadline: Date) {
    if (!this.queue) throw new Error('turn queue not ready');
    const jobId = `${roomId}_${periodKey}`;
    const prior = await this.queue.getJob(jobId);
    if (prior && await prior.getState() === 'delayed') await prior.remove();
    await this.queue.add('settle', { roomId, periodKey }, {
      jobId,
      delay: Math.max(0, deadline.getTime() - Date.now()),
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  private async recover() {
    const turns = await this.rooms.openOrSettlingTurns();
    for (const turn of turns) {
      await this.schedule(turn.roomId, turn.periodKey, turn.status === 'settling' ? new Date() : turn.deadline);
    }
  }

  async onModuleDestroy() {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.worker?.close();
    await this.queue?.close();
    await this.workerConnection?.quit();
    await this.producerConnection?.quit();
    await this.pool.end();
  }
}
