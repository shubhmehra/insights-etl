# The stuff cron jobs just can't do 🕰️

*Part 3 of 3 — Building a reliable Instagram ETL with Temporal*

---

After fixing the history limit problem ([Part 1](link-to-part-1), [Part 2](link-to-part-2)), I had a working ETL. But while I was in the codebase, I added three more patterns that I couldn't stop thinking about.

None of them are possible with cron, Bull, or BullMQ. At least not without a lot of extra infrastructure.

---

## Pattern 1: sleep for 55 days 😴

Instagram long-lived tokens expire every 60 days. The standard approach is a cron job that fires nightly, checks expiry dates, refreshes what's close to expiring.

That works. But it means:
- A database table to track token states
- A cron job that has to be running continuously
- Manual recovery if the cron misses a run
- A separate retry mechanism if the refresh call fails

I replaced all of that with this:

```typescript
export async function tokenRefreshWorkflow(
  checkpoint: TokenCheckpoint,
  currentAccessToken: string
): Promise<void> {
  await sleep(checkpoint.refreshIntervalMs); // 55 days in production

  const { accessToken: newToken, expiresIn } = await refreshToken(currentAccessToken);
  await storeRefreshedToken(checkpoint.creatorId, newToken, expiresIn);

  // Reset history, restart the sleep cycle with the new token
  await continueAsNew<typeof tokenRefreshWorkflow>(
    { ...checkpoint, lastRefreshedAt: new Date().toISOString() },
    newToken
  );
}
```

One workflow per creator. It sleeps for 55 days, refreshes the token, then sleeps again — forever.

If the server restarts mid-sleep, Temporal picks up from where the sleep left off. The timer isn't stored in memory. It's stored in the Temporal server's state. A crash doesn't reset it.

---

## Pattern 2: tests that skip 55 days instantly ⏩

The part that genuinely surprised me: I can unit-test a workflow that sleeps for 55 days without actually waiting.

```typescript
it('refreshes token after the interval elapses', async () => {
  const { client, nativeConnection } = testEnv;

  const handle = await client.workflow.start(tokenRefreshWorkflow, {
    args: [checkpoint, 'initial-token'],
    taskQueue: TEST_TASK_QUEUE,
    workflowId: 'test-token-refresh',
  });

  // Skip 55 days of wall-clock time instantly
  await testEnv.sleep('55 days');

  // Workflow should have refreshed by now
  await handle.result();
  expect(mockRefreshToken).toHaveBeenCalledWith('initial-token');
});
```

`testEnv.sleep('55 days')` advances Temporal's internal clock. No actual waiting. The test completes in milliseconds.

This is one of those things that sounds like a trick until you understand how it works — the test environment controls time, and Temporal's `sleep()` uses that clock. It's real test coverage for real production behavior.

---

## Pattern 3: silent data loss recovery 🔍

The ETL activities are at-least-once. If a worker crashes after fetching a post but before storing it, the activity retries and the post gets stored eventually.

But if the *workflow itself* gets terminated mid-run (server restart, manual kill), some posts may have been fetched and never stored. No error. No indication anything is missing.

Enter the nightly validation workflow:

```typescript
export async function dataValidationWorkflow(
  params: ValidationParams
): Promise<ValidationSummary> {
  // Run both queries in parallel
  const [apiIds, storedIds] = await Promise.all([
    getMediaIdsFromAPI(creatorId, fromDate, toDate),  // what Instagram has
    getStoredMediaIds(creatorId, fromDate, toDate),   // what we stored
  ]);

  const missing = apiIds.filter(id => !new Set(storedIds).has(id));

  // Re-fetch and store anything that's missing
  for (const mediaId of missing) {
    await recoverMediaPost(creatorId, mediaId);
  }

  return { totalFromApi, totalStored, missing: missing.length, recovered };
}
```

Run it manually with:
```bash
npm run corrupt:data     # silently deletes 5 random posts
npm run start:validation # finds them, recovers them, reports back
```

Watch it in the Temporal UI. You can see exactly which posts were missing and whether each one was recovered.

---

## The honest comparison 📊

I'm not saying Temporal is always the right tool. For simple scheduled tasks, a cron job is genuinely fine. But there are specific situations where Temporal earns its complexity:

| Scenario | Cron / Bull | Temporal |
|---|---|---|
| Job resumes mid-run after a crash | ❌ Restart from scratch | ✅ Picks up exactly where it stopped |
| Inspect a running job's internal state | ❌ Poll the database | ✅ `defineQuery` — ask the workflow directly |
| Sleep for weeks, survive restarts | ❌ Timer lives in memory | ✅ Timer lives in Temporal server state |
| Test a 55-day sleep in milliseconds | ❌ Not possible | ✅ `testEnv.sleep()` controls the clock |
| Rate limit retries, automatic backoff | Manual implementation | ✅ Built into activity retry config |
| Find and recover silent data loss | ❌ You need to build this | ✅ Write the workflow, it runs on schedule |

The mock Instagram API in the demo intentionally returns a 429 on every 3rd request. Watch the Temporal UI — activities retry automatically with backoff. The workflow doesn't even notice.

---

## Wrapping up 🎁

Three posts, one story:

1. A workflow silently died because of an invisible history limit
2. Two lines — a threshold check and `continueAsNew` — fixed it
3. Three patterns came out of the same codebase that simply aren't possible with cron

The full code is on GitHub with a runnable demo. Docker + Node.js is all you need.

→ [GITHUB_LINK]

If something here clicked or you've hit a similar problem in production — I'd genuinely love to hear about it in the comments.

---

## LinkedIn version (short)

> What a cron job can't do (but a Temporal workflow can) 🧵
>
> After fixing a silent ETL failure, I added three patterns to the same codebase. None of them are possible with cron or Bull.
>
> 😴 Sleep for 55 days — one workflow per creator, loops forever, auto-refreshes Instagram tokens. Server restarts mid-sleep? Temporal picks up from where the timer was. Memory-based timers can't do this.
>
> ⏩ Test that 55-day sleep in milliseconds — `testEnv.sleep('55 days')` advances Temporal's internal clock. Real coverage. No waiting.
>
> 🔍 Find silent data loss — nightly validation workflow compares what the API has vs what's stored. Re-fetches anything missing. Reports back. No external monitoring tool needed.
>
> The part that sold me:
> You can ask a running workflow what it's doing right now — cursor position, posts processed, everything — without touching the database. `defineQuery`. Try doing that with a cron job.
>
> Series recap:
> Part 1 → the silent history limit failure
> Part 2 → continueAsNew, the two-line fix
> Part 3 → this post
>
> Runnable demo on GitHub → [GITHUB_LINK]
