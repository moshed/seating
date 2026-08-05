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

## Client behaviour (`app.js`)
- `localStorage['seating.link']` holds the uuid, `seating.rev` the last seen revision.
- Every `save()` schedules a push 900 ms later (debounced).
- A 5 s poll calls `seat_chart_get` with the last rev; a newer doc replaces local state
  and re-renders. **Polling is skipped while a drag is in progress** so the board is
  never yanked out from under a finger.
- Last write wins. This is built for one person on a laptop and a phone, not a room of
  simultaneous editors — two people editing the same table at the same second will have
  one of them lose.
- Realtime was deliberately not used: it needs a SELECT policy, which would undo the
  no-enumeration property above.
