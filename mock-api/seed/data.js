'use strict';

// Deterministic seed data — same values every run so tests are reliable.
// 3 creators, 200 posts each, spread over the past 2 years.

const MEDIA_TYPES = ['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM'];

function buildPosts(creatorId, count) {
  const posts = [];
  const now = new Date('2024-06-01T00:00:00Z').getTime();
  const twoYearsMs = 2 * 365 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    const offsetMs = (i / count) * twoYearsMs;
    const timestamp = new Date(now - twoYearsMs + offsetMs).toISOString();

    posts.push({
      id: `${creatorId}_post_${String(i + 1).padStart(4, '0')}`,
      timestamp,
      media_type: MEDIA_TYPES[i % MEDIA_TYPES.length],
      caption: `Post #${i + 1} from ${creatorId}`,
    });
  }

  // Oldest first — mirrors Instagram's default ordering (chronological)
  return posts;
}

function buildInsights(mediaId, seed) {
  // Deterministic but varied metrics derived from the seed value
  return {
    impressions: 1000 + (seed * 37) % 9000,
    reach: 800 + (seed * 29) % 7000,
    likes: 50 + (seed * 13) % 500,
    comments: 5 + (seed * 7) % 100,
    saves: 10 + (seed * 11) % 200,
    shares: 3 + (seed * 5) % 50,
  };
}

const CREATORS = {
  'creator-001': { name: 'alice_fitness', posts: buildPosts('creator-001', 200) },
  'creator-002': { name: 'bob_travel',    posts: buildPosts('creator-002', 200) },
  'creator-003': { name: 'carol_food',    posts: buildPosts('creator-003', 200) },
};

// Build an insights map: mediaId → metrics
const INSIGHTS = {};
for (const [creatorId, creator] of Object.entries(CREATORS)) {
  creator.posts.forEach((post, idx) => {
    INSIGHTS[post.id] = buildInsights(post.id, idx + 1);
  });
}

// Access tokens — long-lived tokens per creator (expires 60 days from "now")
const TOKENS = {
  'creator-001': {
    access_token: 'token_creator001_v1',
    expires_in: 5184000, // 60 days in seconds
  },
  'creator-002': {
    access_token: 'token_creator002_v1',
    expires_in: 5184000,
  },
  'creator-003': {
    access_token: 'token_creator003_v1',
    expires_in: 5184000,
  },
};

module.exports = { CREATORS, INSIGHTS, TOKENS };
