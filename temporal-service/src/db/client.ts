import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5433', 10),
  database: process.env.DB_NAME     || 'creator_insights',
  user:     process.env.DB_USER     || 'creator_insights',
  password: process.env.DB_PASSWORD || 'creator_insights',
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});
