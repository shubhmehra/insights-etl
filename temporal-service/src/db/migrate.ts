import { readFileSync } from 'fs';
import { join } from 'path';
import { pool } from './client';

async function migrate(): Promise<void> {
  const sql = readFileSync(
    join(__dirname, 'migrations', '001_create_tables.sql'),
    'utf-8'
  );
  await pool.query(sql);
  console.log('✅ Migrations complete');
}

migrate()
  .catch((err) => { console.error('Migration failed:', err); process.exit(1); })
  .finally(() => pool.end());
