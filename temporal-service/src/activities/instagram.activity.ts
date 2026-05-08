import axios, { AxiosError } from 'axios';
import type { MediaPost, MediaInsights } from '../shared/types';

const baseUrl = () =>
  process.env.INSTAGRAM_API_BASE_URL || 'http://localhost:3001';

// ── Custom error ──────────────────────────────────────────────────────────────
// A typed error lets the workflow distinguish "token expired, go refresh it"
// from generic network failures. Temporal will retry generic errors; the
// workflow can catch TokenExpiredError and handle it differently.
export class TokenExpiredError extends Error {
  constructor() {
    super('Instagram access token has expired — token refresh required');
    this.name = 'TokenExpiredError';
  }
}

// ── fetchMediaBatch ───────────────────────────────────────────────────────────

export interface FetchMediaParams {
  creatorId: string;
  afterCursor: string | null;
  limit: number;
  simulateError?: 'token_expired' | 'rate_limit'; // test-only escape hatch
}

export interface FetchMediaResult {
  posts: MediaPost[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchMediaBatch(
  params: FetchMediaParams
): Promise<FetchMediaResult> {
  const { creatorId, afterCursor, limit, simulateError } = params;

  try {
    const response = await axios.get(`${baseUrl()}/v1/${creatorId}/media`, {
      params: {
        limit,
        ...(afterCursor ? { after: afterCursor } : {}),
        ...(simulateError ? { simulate_error: simulateError } : {}),
      },
    });

    const { data, paging } = response.data;

    return {
      posts: data as MediaPost[],
      nextCursor: paging?.cursors?.after ?? null,
      hasMore: !!paging?.next,
    };
  } catch (err) {
    if (err instanceof AxiosError && err.response?.status === 401) {
      throw new TokenExpiredError();
    }
    // Re-throw everything else (including 429) so Temporal's retry policy
    // handles it automatically — no manual retry logic needed here.
    throw err;
  }
}

// ── fetchPostInsights ─────────────────────────────────────────────────────────

export async function fetchPostInsights(mediaId: string): Promise<MediaInsights> {
  const response = await axios.get(`${baseUrl()}/v1/${mediaId}/insights`);

  // Instagram returns an array of metric objects — flatten into a plain object
  const metrics: Partial<MediaInsights> = {};
  for (const item of response.data.data as Array<{ name: string; values: Array<{ value: number }> }>) {
    (metrics as Record<string, number>)[item.name] = item.values[0]?.value ?? 0;
  }

  return metrics as MediaInsights;
}

// ── refreshToken ──────────────────────────────────────────────────────────────

export interface RefreshTokenResult {
  accessToken: string;
  expiresIn: number; // seconds
}

export async function refreshToken(
  currentToken: string
): Promise<RefreshTokenResult> {
  const response = await axios.get(`${baseUrl()}/v1/oauth/token/refresh`, {
    params: {
      grant_type: 'ig_refresh_token',
      access_token: currentToken,
    },
  });

  return {
    accessToken: response.data.access_token,
    expiresIn: response.data.expires_in,
  };
}
