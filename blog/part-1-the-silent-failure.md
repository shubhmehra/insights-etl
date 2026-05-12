# My background job silently died. I had no idea for days. 🪦

*Part 1 of 3 — Building a reliable Instagram ETL with Temporal*

---

I was building an Instagram analytics platform. Every 15 minutes, a job runs — fetch posts, pull metrics, store everything. For most creators it worked fine.

Then one creator ran a backfill. Two years of content. The workflow started, processed a few hundred posts… and stopped. No error. No alert. No failed job in the dashboard. Just silence.

I found out because a client asked why their data looked stale. Not from an alert. From a client.

---

## What actually happened 🧵

Temporal records every single step a workflow takes — that's how it replays state after a crash. Every activity call writes ~3 events to the workflow history:

`Scheduled → Started → Completed`

There's a hard limit: **~50,000 events per workflow execution.** Hit it, and Temporal terminates the workflow. Quietly. By default, with no visible error unless you're watching the right place.

Here's the math that burned me:

| Creator size | Posts | Activity calls | History events | Safe? |
|---|---|---|---|---|
| 100 posts | 100 | 200 | ~600 | ✅ |
| 5,000 posts | 5,000 | 10,000 | ~30,000 | ⚠️ Getting close |
| 10,000 posts | 10,000 | 20,000 | ~60,000 | 💀 Terminated |

In my tests I had maybe 50 creators with ~100 posts each. Everything looked great. Then a real backfill hit the wall.

---

## The painful part 😮‍💨

The code I wrote wasn't wrong in any obvious way:

```typescript
// Looks totally fine. Ships in most codebases without a second thought.
export async function naiveEtlWorkflow(creatorId: string): Promise<void> {
  let afterCursor: string | null = null;

  while (true) {
    const { posts, nextCursor, hasMore } = await fetchMediaBatch({
      creatorId,
      afterCursor,
      limit: 10,
    });

    for (const post of posts) {
      await fetchPostInsights(post.id);
    }
    await storeMediaBatch({ creatorId, posts, insightsMap });

    if (!hasMore) break;
    afterCursor = nextCursor;
  }
}
```

No one writes a `while(true)` loop and thinks about history events. You think about pagination. You think about rate limits. The history limit isn't even in the Temporal getting-started guide.

---

## Why this is worse than a crash 😤

A crashed job is loud. It shows up in error tracking. Someone gets paged. You know there's a problem.

A silently terminated workflow is invisible. The job *appeared* to run. No errors were thrown. The only sign was missing data — and missing data only shows up when someone notices something looks wrong.

By the time I caught it, the creator had 4 days of gaps.

---

## What I did about it ➡️

I rebuilt the ETL with a pattern called `continueAsNew` — Temporal's way of letting a workflow chain into a fresh execution, carrying its state forward.

The fix is surprisingly small. Two additions to the workflow. I'll show exactly what changed in Part 2.

**👉 Part 2: Two lines of code that made my ETL unkillable** *(link coming soon)*

Full code and a runnable demo are on GitHub → [GITHUB_LINK]

---

*If you've ever had a background job "succeed" but produce incomplete data — this thread is for you. Drop a comment, I'd love to hear what bit you.*

---

## LinkedIn version (short)

> My background job silently died. I found out when a client asked why their data was stale. 😤
>
> I was building an Instagram ETL on Temporal. Every 15 mins — fetch posts, pull metrics, store. For most creators it was fine.
>
> Then one creator ran a backfill. The workflow just... stopped. No error. No alert. Just silence.
>
> What happened: Temporal records every step a workflow takes. Every activity call = ~3 history events. Hard limit = 50,000. Hit it → workflow gets terminated. Quietly.
>
> 100 posts = ~600 events ✅
> 5,000 posts = ~30,000 events ⚠️
> 10,000 posts = ~60,000 events 💀
>
> I had tested with small datasets. Everything passed. Then a real backfill hit the wall and I had 4 days of data gaps.
>
> A crash is loud. A silently terminated workflow is invisible.
>
> Part 2 is about the fix → just two additions to the workflow code. Full walkthrough on Hashnode: [HASHNODE_LINK]
>
> Repo with runnable demo: [GITHUB_LINK]
