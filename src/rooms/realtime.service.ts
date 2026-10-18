import { Injectable } from '@nestjs/common';
import type { Namespace, Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private server?: Server | Namespace;
  attach(server: Server | Namespace) { this.server = server; }
  emitRoom(roomId: string, event: string, payload: object) {
    this.server?.to(`room:${roomId}`).emit(event, { ...payload, emittedAt: new Date().toISOString() });
  }
}
