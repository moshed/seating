# Seating

Wedding seating chart. Live at https://seating.dancykier.com

Code: `/Users/moshe/Apps/seating/` · repo `moshed/seating` (public, GitHub Pages off `main` root).

## What it is
Paste a guest list, get tables. Guests drag between tables. Couples are linked and always move together.

## Files (no build step, no backend)
- `index.html` — markup + two modals (guest import, more menu)
- `styles.css` — warm ivory/gold wedding palette, Cormorant Garamond + Inter
- `app.js` — one IIFE, all state in `localStorage` under key `seating.v1`

## Data model
```
{ v:1, title, defaultSeats, guests:[{id,name,partner|null}], tables:[{id,name,seats,guests:[guestId]}] }
```
`partner` is a symmetric pointer between two guest ids — that pair is the "unit" that drags as one.

## Things that are load-bearing
- **`[hidden]{display:none !important}` in styles.css.** `.modal` and `.linkbar` set `display:flex`, which beats the UA `[hidden]` rule — without the override every modal is permanently visible. This bit once already.
- **Drag uses pointer events, not HTML5 DnD** — HTML5 drag does not work on touch. `.chip` needs `touch-action:none` or the browser scrolls instead of dragging.
- **Tables are allowed to overflow.** An over-capacity table gets `.over` (bright red `--red` border + red `12/10` count) and is listed in the sidebar's "Over capacity" panel; clicking a row scrolls to that table and flashes it — it is never a blocked drop. An earlier build rejected drops that did not fit, which with 300 guests on exactly-full tables meant *no drag ever worked*. Do not reintroduce a capacity check in `canDrop`.
- **Tables list names one per row** — `.table-body` and `.pool-body` are `flex-direction:column`. They used to wrap horizontally; Moshe asked for a single column per table.
- **A couple renders as one `.pair` box**, gold outline + a gold rule down the left joining the two dots. `appendGuests()` builds it. This replaced an SVG-line version that measured chip offsets — those coordinates went stale the moment the webfont loaded and left lines pointing at nothing. Anything position-measured here needs a redraw on font load and reflow; the CSS box needs neither.
- Guest-list import has two modes, picked automatically: **plain lines** (split on `&` / `+` / `and`; a one-word first name inherits the second's last name, `David & Sarah Klein` -> David Klein / Sarah Klein) and **tab-separated spreadsheet paste** (3+ tabbed lines triggers it).
- The spreadsheet mode finds columns **by header name**, not position — `Fname`, `Lname`, `Spouse`, `responses`, `Sal`, `Table #`. The header row must be included in the paste. `responses` holds `yes-2` style counts: the number is how many people are coming, blank means no reply (skipped unless "Include no-RSVP" is ticked). For 2 people it pairs Fname+Lname with Spouse+Lname; with no spouse it falls back to `Mrs. <Lname>` when the salutation says "and Mrs.", else `Guest of <name>`. A filled-in `Table #` seats those guests directly and skips the shuffle.
- **An .xlsx can be dropped straight onto the page** (or picked with "Choose a file…"). Rather than ship a ~900 KB spreadsheet library, `app.js` walks the zip central directory by hand and inflates with the browser's `DecompressionStream('deflate-raw')`, reading only the first worksheet plus `sharedStrings.xml`. Needs Chrome 103 / Safari 16.4+. `.csv` and `.tsv` also work.
- On a browser with no saved chart, the app fetches `guests.tsv` and seats it automatically — no empty state. A browser that already holds a chart keeps it (edits are not stomped), so **More -> Reset to the Leo & Dani guest list** exists to get back to the default in one click.
- Verified against the real 246-household wedding sheet, both pasted and dropped as the raw .xlsx: 311 guests, 105 couples, 32 tables, no couple split.
- **Seeding groups by last name.** `randomize()` buckets units by surname (last word of the name), shuffles the bucket order, sorts biggest family first, and drops each family at the *tightest* table it fits at whole. A family too big for one table fills whole empty tables first so it lands as solid blocks, not scattered singles. On the real list that leaves 143 surnames with only 5 split — and each of those has more people than a 10-seat table. The remaining randomness is in the order of equally-sized families, so Shuffle still reshuffles.
- No "keep these apart" rules and no cross-family affinity.
- **Double-click a name to rename it.** 15 rows in the real sheet say two are coming but leave `Spouse` blank, so those wives import as `Mrs. <Lastname>` — renaming is how they get fixed, and it keeps the couple link intact.

## Password gate
The chart is behind a password (`adina123`). An inline script in `<head>` adds `class="locked"` to `<html>` before first paint so the guest list never flashes; `app.js` compares a SHA-256 of what's typed against `PW_SHA256` and sets `localStorage['seating.unlocked']`.

⚠️ **This is a doormat, not a deadbolt** — it is a static page, so devtools or a direct fetch of `guests.tsv` bypasses it entirely. Moshe asked for it so nobody wanders in *by accident*, which is what it does. Do not describe it as securing the data. `crypto.subtle` is absent over plain http, so there is a literal-compare fallback for localhost testing.

## The real guest list
`guests.tsv` is the actual Leo & Dani wedding list (246 households, 311 confirmed), exported from `LEO AND DANI SEATING CHART.xlsx` with the original 7 columns intact. The **Load the Leo & Dani guest list** button in the import modal fetches it and drops it in the textarea, so it goes through the same column parser as a manual paste — no separate code path.

⚠️ **The repo and the site are public, so this file is publicly readable.** Moshe asked for it to ship with the app ("so it can be imported by anyone using the app") and was told. To pull it: delete `guests.tsv`, the `#import-load` button in `index.html`, and its handler in `app.js`.

## Not done yet
- No sharing or sync — asked for and explicitly declined 4 Aug 2026 ("i dont actually need it to be shared"). State is per-browser localStorage — editing on the phone does not show up on the Mac. Use Download CSV / Copy chart as text to move it, or wire up Supabase if it needs to be shared.
