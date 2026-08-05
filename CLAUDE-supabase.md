# Seating — Supabase (device linking)

Project: **Misc**, ref `atqhfbaurrmivjarowco` (us-east-2). Prefix for this app: `seat_`.

Used for one thing only: keeping the same chart in step across two devices. There is no
login and no user table.

## Schema
```sql
public.seat_charts (id uuid pk, doc jsonb, rev bigint, created_at, updated_at)
```
RLS is on and **there are no policies**, plus `revoke all ... from anon` — so the table
cannot be selected, listed or dumped through PostgREST. Confirmed: a direct
`GET /rest/v1/seat_charts` returns `42501 permission denied`.

## The only two doors
Both `security definer`, both granted to `anon`:
- `seat_chart_put(p_id uuid, p_doc jsonb) -> bigint` — upsert, bumps `rev`, returns it.
  Rejects null or >2 MB documents.
- `seat_chart_get(p_id uuid, p_rev bigint default 0) -> jsonb` — returns
  `{rev, doc}`, or `{rev, same:true}` when the caller is already current, or `null`
  for an unknown id.

**The uuid is the credential.** Knowing it is the entire authorisation, exactly like the
Pinpoint player key. Anyone with the code can read and overwrite that chart; nobody
without it can find one. Do not add a SELECT policy — that would make every chart
enumerable.

The committed `sb_publishable_…` key is the anon key and is meant to ship in client
code. It grants nothing beyond executing those two functions, so this is not a breach of
the "keys only in edge functions" rule, which is about *secret* keys.

## One shared chart by default
`DEFAULT_CHART` in `app.js` is a fixed uuid every browser syncs to with no setup —
open the page anywhere and you are on the same chart. Moshe asked for exactly this
("it should write automatically"); the earlier build required pasting a code, so a new
browser silently kept its own copy and nothing reached the server.

That uuid ships in the public `app.js`, so **anyone who can open the page can edit the
real chart**. The password is the only gate, and it is a doormat. That is the accepted
trade.

`firstPull()` runs on boot: whatever the server holds wins, because that is the shared
truth. Only when the server has no row at all does the browser seed it from `guests.tsv`
and push. A row that exists but is *empty* is respected — someone deleted everything on
purpose, so it stays deleted everywhere; the browser just opens the Guests box so there
is a way back. Verified across two browsers: wipe on one propagates to the other, and a
restore from either brings all 311 back. "Start a separate chart" (`forkChart`) mints a fresh uuid for a private copy;
"Go back to the shared chart" returns to `DEFAULT_CHART`.

## Client behaviour (`app.js`)
- `localStorage['seating.chart']` holds the uuid, `seating.rev` the last seen revision.
  The key was bumped from `seating.link` so browsers still pointing at a hand-made code
  from the old build fall back to the shared chart.
- Every `save()` schedules a push 900 ms later (debounced).
- A 5 s poll calls `seat_chart_get` with the last rev; a newer doc replaces local state
  and re-renders. **Polling is skipped while a drag is in progress** so the board is
  never yanked out from under a finger.
- Last write wins. This is built for one person on a laptop and a phone, not a room of
  simultaneous editors — two people editing the same table at the same second will have
  one of them lose.
- Realtime was deliberately not used: it needs a SELECT policy, which would undo the
  no-enumeration property above.
