import 'dotenv/config';
import { Pool } from 'pg';
import { EconomyService } from './economy/economy.service';

async function main() {
  const [roomId, period, scenario] = process.argv.slice(2);
  if (!roomId || !period || !scenario) throw new Error('Usage: npm run settle -- <room-uuid> 1405-07 high_inflation');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    process.stdout.write(`${JSON.stringify(await new EconomyService(pool).settlePeriod(roomId, period, scenario))}\n`);
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
