import { Module } from '@nestjs/common';
import { Pool } from 'pg';
import { EconomyService } from './economy/economy.service';
import { EconomyController } from './economy/economy.controller';
import { RoomService } from './rooms/room.service';
import { RoomController } from './rooms/room.controller';
import { RoomGateway } from './rooms/room.gateway';
import { RealtimeService } from './rooms/realtime.service';
import { TurnQueueService } from './rooms/turn-queue.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import Redis from 'ioredis';

@Module({
  controllers: [AuthController, EconomyController, RoomController],
  providers: [
    { provide: 'PG_POOL', useFactory: () => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
      return new Pool({ connectionString: process.env.DATABASE_URL });
    } },
    { provide: 'REDIS', useFactory: () => {
      if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');
      return new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
    } },
    EconomyService,
    RealtimeService,
    RoomService,
    RoomGateway,
    TurnQueueService,
    AuthService,
  ],
})
export class AppModule {}
