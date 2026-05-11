/**
 * Simulates silent data loss by deleting 5 random posts from the database.
 * Run this before start-validation.ts to give the validation workflow
 * something to find and recover.
 *
 * Usage:
 *   npm run corrupt:data
 *   npm run start:validation
 *   # watch the validation workflow recover the 5 deleted posts
 */
import { pool } from '../db/client';
import * as dotenv from 'dotenv';

dotenv.config();

async function main(): Promise<void> {
  const { rows: posts } = await pool.query(`
    SELECT id FROM media_posts
    ORDER BY RANDOM()
    LIMIT 5
  `);

  if (posts.length === 0) {
    console.log('No posts found. Run npm run start:workflows first.');
    return;
  }

  const ids = posts.map((r) => r.id);

  // Delete insights first (FK constraint)
  await pool.query(`DELETE FROM media_insights WHERE media_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM media_posts WHERE id = ANY($1)`, [ids]);

  console.log(`🗑  Deleted ${ids.length} posts to simulate data loss:`);
  ids.forEach((id) => console.log(`   - ${id}`));
  console.log('\nNow run: npm run start:validation');
  console.log('Watch the validation workflow recover them at http://localhost:8080');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => pool.end());
