import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const previousSchema = await pool.query(`SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='economic_periods'
    ) AS table_exists, EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='economic_periods' AND column_name='room_id'
    ) AS room_scoped`);
    if (previousSchema.rows[0].table_exists && !previousSchema.rows[0].room_scoped) {
      throw new Error('Old global economy schema detected. Back up and migrate its data before applying the room-scoped baseline.');
    }
    const sql = await readFile(resolve(process.cwd(), 'src/db/schema.sql'), 'utf8');
    await pool.query(sql);
    process.stdout.write('Economy schema ready.\n');
  } finally {
    await pool.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
