import 'dotenv/config';
import { Client } from 'pg';

const databaseName = process.env.PG_DATABASE_NAME ?? 'masir_servat';

async function main() {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) throw new Error('invalid database name');
  const connectionString = process.env.PG_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
  const client = new Client({ connectionString });
  try {
    await client.connect();
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [databaseName]);
    if (existing.rowCount) {
      process.stdout.write(`Database ${databaseName} already exists.\n`);
      return;
    }
    await client.query(`CREATE DATABASE "${databaseName}"`);
    process.stdout.write(`Database ${databaseName} created.\n`);
  } finally {
    await client.end();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
