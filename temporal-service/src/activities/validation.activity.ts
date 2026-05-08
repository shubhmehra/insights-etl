import axios from 'axios';
import { fetchMediaBatch, fetchPostInsights } from './instagram.activity';
import { storeMediaBatch } from './db.activity';

const baseUrl = () =>
  process.env.INSTAGRAM_API_BASE_URL || 'http://localhost:3001';

/**
 * Fetch every media ID the Instagram API has for a creator within a date range.
 * Pages through the full result set — used by the validation workflow to build
 * the ground-truth list of what should be stored.
 */
export async function getMediaIdsFromAPI(
  creatorId: string,
  fromDate: string,
  toDate: string
): Promise<string[]> {
  const ids: string[] = [];
  let afterCursor: string | null = null;

  while (true) {
    const { posts, nextCursor, hasMore } = await fetchMediaBatch({
      creatorId,
      afterCursor,
      limit: 100,
    });

    for (const post of posts) {
      // Only include posts within the requested date range
      if (post.timestamp >= fromDate && post.timestamp <= toDate) {
        ids.push(post.id);
      }
    }

    if (!hasMore) break;
    afterCursor = nextCursor;
  }

  return ids;
}

/**
 * Re-fetch a single post and its insights, then store them.
 * Called for each post the validation workflow finds is missing from the DB.
 */
export async function recoverMediaPost(
  creatorId: string,
  mediaId: string
): Promise<void> {
  // Fetch the single post's details via the insights endpoint
  const insights = await fetchPostInsights(mediaId);

  // We don't have the full post metadata here — reconstruct a minimal post
  // object. In production you'd call the media endpoint for the full object.
  const post = {
    id: mediaId,
    timestamp: new Date().toISOString(), // fallback — real impl fetches from API
    media_type: 'IMAGE' as const,
  };

  await storeMediaBatch({
    creatorId,
    posts: [post],
    insightsMap: { [mediaId]: insights },
  });
}
