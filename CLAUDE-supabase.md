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

## A chart per browser, shared on purpose
There is **no global chart**. The first time a browser opens the app it mints its own
uuid (`newChartId()`), seeds it from `guests.tsv` and pushes — saving to the server needs
no button, but the chart is that browser's alone. A private/incognito window therefore
gets a *different* chart, which is the point: one person's edits must not land on
everyone.

Sharing is opt-in: copy the code from More -> "Share this chart" and paste it on the other
device. From then on both are on the same row and either can edit or wipe it. "Start a new
chart" (`forkChart`) moves this device to a fresh code and leaves anyone else on the old
one.

This flip-flopped twice during the build. The rule that satisfies both asks: **always
write to the server, never share without a code.**

`firstPull()` runs on boot: whatever the server holds wins for that code. Only when the
row does not exist does the browser seed it. A row that exists but is *empty* is
respected — someone deleted everything on purpose, so it stays deleted for everyone on
that code; the browser just opens the Guests box so there is a way back.

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


## Version history — nothing is unrecoverable
`seat_chart_history` snapshots **every** insert, update and delete on `seat_charts` via
the `seat_chart_snapshot()` trigger, keeping the newest 100 versions per chart. Same
lockdown as the main table: RLS on, no policies, `revoke all from anon` — a direct
`GET /rest/v1/seat_chart_history` returns 42501.

Two RPCs, both granted to `anon`:
- `seat_chart_versions(p_id)` — last 40 snapshots as `{hid, saved_at, guests, tables}`,
  no documents.
- `seat_chart_restore(p_id, p_hid)` — writes that snapshot back and returns `{rev, doc}`.

Surfaced as More -> "Restore an earlier version…". This exists because charts are shared
by code and **either device can wipe one**; a wipe now costs a couple of taps to undo
rather than being final.

⚠️ **Never run `delete from seat_charts` (or any blanket DELETE) to tidy up.** This table
holds other people's charts, not just test rows. Filter by the exact id you created, or
leave it alone. Two cleanup deletes during the build removed a row that was not mine.
