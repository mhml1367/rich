import { ConnectedSocket, MessageBody, OnGatewayInit, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Inject } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Namespace, Socket } from 'socket.io';
import { RoomService } from './room.service';
import { RealtimeService } from './realtime.service';

@WebSocketGateway({ namespace: 'rooms', cors: { origin: process.env.CORS_ORIGIN || false } })
export class RoomGateway implements OnGatewayInit<Namespace> {
  @WebSocketServer() server!: Namespace;
  private publisher?: Redis;
  private subscriber?: Redis;
  constructor(@Inject(RoomService) private readonly rooms: RoomService, @Inject(RealtimeService) private readonly realtime: RealtimeService) {}

  async afterInit(namespace: Namespace) {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error('REDIS_URL is required for clustered room events');
    this.publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.subscriber = this.publisher.duplicate();
    await Promise.all([this.publisher.ping(), this.subscriber.ping()]);
    namespace.server.adapter(createAdapter(this.publisher, this.subscriber));
    this.realtime.attach(namespace);
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()]);
  }

  @SubscribeMessage('room.join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() input: { roomId: string; token: string }) {
    try {
      if (!input || typeof input.roomId !== 'string' || typeof input.token !== 'string') throw new Error('invalid join request');
      await this.rooms.authenticate(input.roomId, input.token);
      await socket.join(`room:${input.roomId}`);
      return { ok: true, snapshot: await this.rooms.snapshot(input.roomId, input.token) };
    } catch {
      return { ok: false, error: 'room access denied' };
    }
  }

  @SubscribeMessage('room.chat.send')
  async sendChat(@MessageBody() input: { roomId: string; token: string; message: string }) {
    try {
      if (!input || typeof input.roomId !== 'string' || typeof input.token !== 'string') throw new Error('invalid chat request');
      const message = await this.rooms.sendChat(input.roomId, input.token, { message: input.message });
      return { ok: true, message };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'message rejected' };
    }
  }
}
