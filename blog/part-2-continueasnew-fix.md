# Two lines of code that made my ETL unkillable ⚡

*Part 2 of 3 — Building a reliable Instagram ETL with Temporal*

---

In [Part 1](link-to-part-1) I showed how a Temporal workflow silently dies when it hits the 50,000 event history limit. A creator backfill triggered it. No error, no alert, 4 days of missing data.

This part is the fix. It's honestly smaller than you'd expect.

---

## The problem in one sentence 🎯

Temporal's history is per-execution. The fix is to start a fresh execution before the old one fills up — and carry the cursor forward so you don't lose your place.

That mechanism is called `continueAsNew`.

---

## What changed — the diff 🔍

Here's the broken version vs the fixed version, side by side:

| | Naive workflow | Fixed workflow |
|---|---|---|
| History tracking | None — runs until terminated | Checks `historyLength` before each batch |
| What happens at the limit | Silent termination 💀 | Chains into a fresh execution ♻️ |
| State between executions | Lost | Carried forward via checkpoint |
| Cursor after restart | Gone (starts over) | Preserved in `ETLCheckpoint` |
| Resumable after full crash | ❌ | ✅ via `persistCheckpoint` to DB |

Two additions. That's the whole fix.

---

## Addition 1: check history BEFORE the loop body 🔢

```typescript
const HISTORY_THRESHOLD = 1_000;

while (true) {
  // ✅ Check BEFORE doing work — not after
  if (workflowInfo().historyLength >= HISTORY_THRESHOLD) {
    await persistCheckpoint(checkpoint); // save to DB for hard crash recovery
    await continueAsNew<typeof creatorInsightsETLWorkflow>(checkpoint);
    return; // TypeScript needs this — continueAsNew never actually returns
  }

  // ... fetch, transform, store
}
```

Why check *before* the loop body and not after?

If you check after, you've already added events from that iteration. You need headroom for the activities *about to run*. Checking at the top means you always have room to finish the current batch.

---

## Addition 2: the checkpoint carries the cursor ✅

The naive workflow tracked the cursor in a local variable — it died with the execution.

The fixed version wraps it in a `checkpoint` object that gets passed into the next execution:

```typescript
// After each successful batch:
checkpoint = {
  ...checkpoint,
  afterCursor: nextCursor,                            // ← cursor carries forward
  processedUntil: posts.at(-1)?.timestamp ?? checkpoint.processedUntil,
  totalProcessed: checkpoint.totalProcessed + posts.length,
};
```

When `continueAsNew` fires, it passes this checkpoint as the argument to the new execution. The new execution picks up from exactly where the old one left off.

Zero data loss. Zero restart-from-scratch.

---

## Why threshold = 1,000 and not 49,999? 🤔

You want headroom. The `continueAsNew` call itself adds events. Any signals or queries hitting the workflow concurrently add events. Operating near the ceiling means a burst could push you over.

1,000 events per execution is conservative. You pay in more executions, but you never risk termination.

---

## What this looks like in the Temporal UI 👀

When you run the fixed workflow against a large dataset, you'll see something like:

```
creator-123-etl (execution 1)  →  Continued as New
creator-123-etl (execution 2)  →  Continued as New
creator-123-etl (execution 3)  →  Completed ✅
```

Each execution processes a chunk, hands off to the next, and the final one completes normally. The full processing history is spread across multiple executions — each one clean, each one well under the limit.

---

## Bonus: query the live state without touching the DB 🔎

One thing I love about this pattern — you can ask a running workflow what it's doing right now:

```typescript
export const progressQuery = defineQuery<ETLCheckpoint>('getProgress');

// Inside the workflow:
setHandler(progressQuery, () => checkpoint);
```

Then from outside:
```bash
npm run query:progress
# → { creatorId: 'creator-123', totalProcessed: 847, afterCursor: 'abc123' }
```

No database polling. No extra API call. The workflow just tells you. This isn't possible with Bull or a cron job — it's unique to durable execution frameworks.

---

## Coming up in Part 3 🔜

Two patterns I added after this:

- A workflow that **sleeps for 55 days** to auto-refresh Instagram tokens — survives server restarts, tests in milliseconds
- A nightly **data validation workflow** that finds silent data loss and recovers it automatically

**👉 Part 3: Workflows that sleep for 55 days (and tests that run in milliseconds)** *(link coming soon)*

Full runnable demo → [GITHUB_LINK]

---

## LinkedIn version (short)

> Two lines of code fixed an ETL that was silently dying on large datasets. 🧵
>
> In Temporal, every activity = ~3 history events. 50,000 events = workflow termination. No error, no alert.
>
> The fix is called `continueAsNew` — chain into a fresh execution before the old one fills up, carry the cursor forward.
>
> Two changes to the workflow:
>
> 1️⃣ Check `historyLength` BEFORE each batch — not after (you need headroom for what's about to run)
>
> 2️⃣ Wrap the cursor in a checkpoint object — it gets passed into the new execution, so you never lose your place
>
> You also get live state queries for free. While the workflow is running:
> → `npm run query:progress` → `{ processed: 847, cursor: 'abc123' }`
>
> No DB polling. No extra API. The running workflow just tells you.
>
> Full walkthrough → [HASHNODE_LINK]
> Runnable demo → [GITHUB_LINK]
