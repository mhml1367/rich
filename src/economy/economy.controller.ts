import { BadRequestException, Controller, Get, Headers, Inject, NotFoundException, Param, UnauthorizedException } from '@nestjs/common';
import { CATEGORIES } from './math';
import { SCENARIOS } from './scenarios';
import { EconomyService } from './economy.service';
import { RoomService } from '../rooms/room.service';

@Controller('economy')
export class EconomyController {
  constructor(@Inject(EconomyService) private readonly economy: EconomyService, @Inject(RoomService) private readonly rooms: RoomService) {}

  @Get('scenarios')
  scenarios() {
    return Object.values(SCENARIOS).map(scenario => ({
      id: scenario.id,
      label: scenario.label,
      wageChangeBps: Number(scenario.wageChangeBps),
      referenceAnnualRateBps: Number(scenario.referenceAnnualRateBps),
      monthlyChangeBps: Object.fromEntries(CATEGORIES.map(category => [category, Number(scenario.monthlyChangeBps[category])])),
    }));
  }

  @Get('categories')
  categories() { return CATEGORIES; }

  @Get('rooms/:roomId/history')
  async history(@Param('roomId') roomId: string, @Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    await this.rooms.authenticate(roomId, authorization.slice(7));
    return this.economy.getIndexHistory(roomId);
  }

  @Get('rooms/:roomId/periods/:periodKey/indices')
  async indices(@Param('roomId') roomId: string, @Param('periodKey') periodKey: string, @Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    await this.rooms.authenticate(roomId, authorization.slice(7));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) throw new BadRequestException('invalid period');
    const indices = await this.economy.getIndices(roomId, periodKey);
    if (!indices) throw new NotFoundException('period not found');
    return indices;
  }
}
