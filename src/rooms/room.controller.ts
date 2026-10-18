import { Body, Controller, Get, Headers, Inject, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { RoomService } from './room.service';
import { AuthService } from '../auth/auth.service';

@Controller('rooms')
export class RoomController {
  constructor(@Inject(RoomService) private readonly rooms: RoomService, @Inject(AuthService) private readonly auth: AuthService) {}

  @Post()
  async create(@Body() input: { title: string; displayName: string; mode: string; scenarioId: string; turnSeconds?: number; maxPlayers?: number; botCount?: number }, @Headers('authorization') authorization?: string) {
    const user = await this.auth.authenticate(this.bearer(authorization));
    return this.rooms.create(input, user.id);
  }

  @Post(':roomId/join')
  async join(@Param('roomId') roomId: string, @Body() input: { displayName: string }, @Headers('authorization') authorization?: string) {
    const user = await this.auth.authenticate(this.bearer(authorization));
    return this.rooms.join(roomId, input?.displayName, user.id);
  }

  @Get(':roomId/return-report')
  returnReport(@Param('roomId') roomId: string, @Headers('authorization') authorization: string | undefined, @Query('since') since?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.returnReport(roomId, authorization.slice(7), since);
  }

  @Get(':roomId')
  snapshot(@Param('roomId') roomId: string, @Headers('authorization') authorization?: string) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.snapshot(roomId, authorization.slice(7));
  }

  @Post(':roomId/decisions/:periodKey')
  submitDecision(
    @Param('roomId') roomId: string,
    @Param('periodKey') periodKey: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() input: { action: string; category?: string; amountTomans?: string },
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.submitDecision(roomId, authorization.slice(7), periodKey, input);
  }

  @Post(':roomId/turns/:periodKey/ready')
  markTurnReady(
    @Param('roomId') roomId: string,
    @Param('periodKey') periodKey: string,
    @Headers('authorization') authorization?: string,
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.markTurnReady(roomId, authorization.slice(7), periodKey);
  }

  @Post(':roomId/autopilot')
  updateAutopilot(
    @Param('roomId') roomId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() input: { enabled: boolean; strategy: string; reserveMonths: number; investSurplusBps: number },
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.updateAutopilot(roomId, authorization.slice(7), input);
  }

  @Post(':roomId/buildings/:buildingId/:periodKey')
  buildCity(
    @Param('roomId') roomId: string,
    @Param('buildingId') buildingId: string,
    @Param('periodKey') periodKey: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() input: { operation: string },
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.buildCity(roomId, authorization.slice(7), periodKey, buildingId, input?.operation);
  }

  @Post(':roomId/restructure/:periodKey')
  restructure(
    @Param('roomId') roomId: string,
    @Param('periodKey') periodKey: string,
    @Headers('authorization') authorization?: string,
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.restructureDebt(roomId, authorization.slice(7), periodKey);
  }

  @Post(':roomId/loans/:periodKey')
  issueLoan(
    @Param('roomId') roomId: string,
    @Param('periodKey') periodKey: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() input: { amountTomans: string; months: number; rateKind: string },
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.issueLoan(roomId, authorization.slice(7), periodKey, input);
  }

  @Post(':roomId/check-requests/:periodKey')
  requestCheck(
    @Param('roomId') roomId: string,
    @Param('periodKey') periodKey: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() input: { payeeId: string; guarantorId: string; duePeriod: string; amountTomans: string },
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.requestGuaranteedCheck(roomId, authorization.slice(7), periodKey, input);
  }

  @Post(':roomId/check-requests/:requestId/respond')
  respondCheck(
    @Param('roomId') roomId: string,
    @Param('requestId') requestId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() input: { accept: boolean },
  ) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.respondGuaranteedCheck(roomId, authorization.slice(7), requestId, input?.accept);
  }

  @Post(':roomId/businesses/:periodKey')
  createBusiness(@Param('roomId') roomId: string, @Param('periodKey') periodKey: string, @Headers('authorization') authorization: string | undefined,
    @Body() input: { modelId: string; managerEnabled?: boolean }) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.createBusiness(roomId, authorization.slice(7), periodKey, input);
  }

  @Post(':roomId/businesses/:businessId/:periodKey/manager')
  setBusinessManager(@Param('roomId') roomId: string, @Param('businessId') businessId: string, @Param('periodKey') periodKey: string,
    @Headers('authorization') authorization: string | undefined, @Body() input: { enabled: boolean }) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.setBusinessManager(roomId, authorization.slice(7), periodKey, businessId, input?.enabled);
  }

  @Post(':roomId/businesses/:businessId/:periodKey/partnerships')
  proposeBusinessPartner(@Param('roomId') roomId: string, @Param('businessId') businessId: string, @Param('periodKey') periodKey: string,
    @Headers('authorization') authorization: string | undefined, @Body() input: { partnerId: string; shareBps: number; contributionTomans: string }) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.proposeBusinessPartner(roomId, authorization.slice(7), periodKey, businessId, input);
  }

  @Post(':roomId/business-partnerships/:offerId/respond')
  respondBusinessPartnership(@Param('roomId') roomId: string, @Param('offerId') offerId: string,
    @Headers('authorization') authorization: string | undefined, @Body() input: { accept: boolean }) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.respondBusinessPartnership(roomId, authorization.slice(7), offerId, input?.accept);
  }

  @Post(':roomId/contracts/:periodKey')
  proposePlayerContract(@Param('roomId') roomId: string, @Param('periodKey') periodKey: string, @Headers('authorization') authorization: string | undefined,
    @Body() input: { counterpartyId: string; kind: string; amountTomans: string; interestBps?: number; months?: number; assetCategory?: string; assetValueTomans?: string }) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.proposePlayerContract(roomId, authorization.slice(7), periodKey, input);
  }

  @Post(':roomId/contracts/:contractId/respond')
  respondPlayerContract(@Param('roomId') roomId: string, @Param('contractId') contractId: string, @Headers('authorization') authorization: string | undefined,
    @Body() input: { accept: boolean }) {
    if (!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.respondPlayerContract(roomId, authorization.slice(7), contractId, input?.accept);
  }

  @Post(':roomId/event-cards/:periodKey')
  chooseEvent(@Param('roomId') roomId: string,@Param('periodKey') key: string,@Headers('authorization') authorization: string|undefined,@Body() input:{choice:string}) {
    if(!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.chooseEvent(roomId,authorization.slice(7),key,input?.choice);
  }
  @Post(':roomId/skills/:periodKey')
  upgradeSkill(@Param('roomId') roomId:string,@Param('periodKey') key:string,@Headers('authorization') authorization:string|undefined,@Body() input:{skillId:string}) {
    if(!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.upgradeSkill(roomId,authorization.slice(7),key,input?.skillId);
  }
  @Post(':roomId/funds/:periodKey')
  tradeFund(@Param('roomId') roomId:string,@Param('periodKey') key:string,@Headers('authorization') authorization:string|undefined,@Body() input:{fundId:string;action:string;amountTomans:string}) {
    if(!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.tradeFund(roomId,authorization.slice(7),key,input?.fundId,input?.action,input?.amountTomans);
  }
  @Post(':roomId/insurance/:periodKey')
  setInsurance(@Param('roomId') roomId:string,@Param('periodKey') key:string,@Headers('authorization') authorization:string|undefined,@Body() input:{planId:string;active:boolean}) {
    if(!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.setInsurance(roomId,authorization.slice(7),key,input?.planId,input?.active);
  }
  @Post(':roomId/auctions/:periodKey')
  createAuction(@Param('roomId') roomId:string,@Param('periodKey') key:string,@Headers('authorization') authorization:string|undefined,@Body() input:{assetCategory:string;assetValueTomans:string;reservePriceTomans:string}) {
    if(!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.createAuction(roomId,authorization.slice(7),key,input);
  }
  @Post(':roomId/auctions/:auctionId/bids/:periodKey')
  bidAuction(@Param('roomId') roomId:string,@Param('auctionId') auctionId:string,@Param('periodKey') key:string,@Headers('authorization') authorization:string|undefined,@Body() input:{amountTomans:string}) {
    if(!authorization?.startsWith('Bearer ')) throw new UnauthorizedException('room token required');
    return this.rooms.bidAuction(roomId,authorization.slice(7),auctionId,key,input?.amountTomans);
  }

  private bearer(value?: string) {
    if (!value?.startsWith('Bearer ')) throw new UnauthorizedException('phone_session_required');
    return value.slice(7);
  }
}
