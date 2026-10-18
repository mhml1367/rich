import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException, OnModuleDestroy, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type Redis from 'ioredis';
import type { Pool } from 'pg';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type OtpRecord = { codeHash: string; mode: 'register' | 'login'; displayName: string };

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(@Inject('PG_POOL') private readonly pool: Pool, @Inject('REDIS') redis: Redis) { this.redis = redis; }

  async requestOtp(input: { phone?: string; displayName?: string; mode?: string }) {
    const phone = this.normalizePhone(input?.phone);
    const mode = input?.mode;
    if (mode !== 'register' && mode !== 'login') throw new BadRequestException('invalid_auth_mode');
    const displayName = mode === 'register' ? this.cleanName(input?.displayName) : '';
    const existing = await this.pool.query('SELECT id FROM player_accounts WHERE phone=$1', [phone]);
    if (mode === 'register' && existing.rowCount) throw new ConflictException('phone_already_registered');
    if (mode === 'login' && !existing.rowCount) throw new NotFoundException('phone_not_registered');
    const throttleKey = `masir:otp:throttle:${phone}`;
    const allowed = await this.redis.set(throttleKey, '1', 'EX', 60, 'NX');
    if (!allowed) throw new HttpException('otp_resend_wait', HttpStatus.TOO_MANY_REQUESTS);

    const code = randomInt(100000, 1000000).toString();
    const record: OtpRecord = { codeHash: hash(code), mode, displayName };
    const key = `masir:otp:${phone}`;
    await this.redis.set(key, JSON.stringify(record), 'EX', 300);
    await this.redis.del(`${key}:attempts`);
    if (process.env.NODE_ENV === 'production') {
      await this.redis.del(key, `${key}:attempts`);
      throw new ServiceUnavailableException('sms_provider_not_configured');
    }
    return { phone, expiresInSeconds: 300, delivery: 'development', developmentCode: code };
  }

  async verifyOtp(input: { phone?: string; code?: string }) {
    const phone = this.normalizePhone(input?.phone);
    const code = String(input?.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) throw new BadRequestException('invalid_otp');
    const key = `masir:otp:${phone}`;
    const value = await this.redis.get(key);
    if (!value) throw new UnauthorizedException('otp_expired_or_missing');
    const attempts = await this.redis.incr(`${key}:attempts`);
    if (attempts === 1) await this.redis.expire(`${key}:attempts`, 300);
    if (attempts > 5) {
      await this.redis.del(key, `${key}:attempts`);
      throw new UnauthorizedException('otp_attempts_exceeded');
    }
    let record: OtpRecord;
    try { record = JSON.parse(value) as OtpRecord; } catch { await this.redis.del(key, `${key}:attempts`); throw new UnauthorizedException('otp_expired_or_missing'); }
    const supplied = Buffer.from(hash(code), 'hex');
    const expected = Buffer.from(record.codeHash, 'hex');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new UnauthorizedException('invalid_otp');
    await this.redis.del(key, `${key}:attempts`);

    const client = await this.pool.connect();
    let user: { id: string; phone: string; display_name: string };
    try {
      await client.query('BEGIN');
      if (record.mode === 'register') {
        const inserted = await client.query(`INSERT INTO player_accounts(id,phone,display_name) VALUES ($1,$2,$3)
          ON CONFLICT(phone) DO NOTHING RETURNING id,phone,display_name`, [randomUUID(), phone, record.displayName]);
        if (!inserted.rowCount) throw new ConflictException('phone_already_registered');
        user = inserted.rows[0] as typeof user;
      } else {
        const found = await client.query('SELECT id,phone,display_name FROM player_accounts WHERE phone=$1 FOR UPDATE', [phone]);
        if (!found.rowCount) throw new NotFoundException('phone_not_registered');
        user = found.rows[0] as typeof user;
      }
      const token = randomBytes(32).toString('base64url');
      await client.query('INSERT INTO player_sessions(id,player_account_id,token_hash,expires_at) VALUES ($1,$2,$3,now()+interval \'30 days\')',
        [randomUUID(), user.id, hash(token)]);
      await client.query('COMMIT');
      return { user: { id: String(user.id), phone: String(user.phone), displayName: String(user.display_name) }, token };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async authenticate(token?: string) {
    if (!token || token.length > 200) throw new UnauthorizedException('phone_session_required');
    const result = await this.pool.query(`SELECT pa.id,pa.phone,pa.display_name FROM player_sessions ps
      JOIN player_accounts pa ON pa.id=ps.player_account_id WHERE ps.token_hash=$1 AND ps.expires_at>now()`, [hash(token)]);
    if (!result.rowCount) throw new UnauthorizedException('phone_session_expired');
    return { id: String(result.rows[0].id), phone: String(result.rows[0].phone), displayName: String(result.rows[0].display_name) };
  }

  async logout(token?: string) {
    if (token) await this.pool.query('DELETE FROM player_sessions WHERE token_hash=$1', [hash(token)]);
    return { ok: true };
  }

  async onModuleDestroy() { await this.redis.quit(); }

  private normalizePhone(value?: string) {
    const raw = String(value ?? '').trim().replace(/[\s()-]/g, '');
    const digits = raw.replace(/\D/g, '');
    let phone = '';
    if (/^09\d{9}$/.test(digits)) phone = `+98${digits.slice(1)}`;
    else if (/^989\d{9}$/.test(digits)) phone = `+${digits}`;
    else if (/^00989\d{9}$/.test(digits)) phone = `+${digits.slice(2)}`;
    if (!phone) throw new BadRequestException('invalid_iranian_mobile');
    return phone;
  }

  private cleanName(value?: string) {
    const name = String(value ?? '').trim();
    if (name.length < 2 || name.length > 40) throw new BadRequestException('invalid_display_name');
    return name;
  }
}
