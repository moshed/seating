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
- **A couple renders as one `.pair` box**, gold outline + a gold rule down the left joining the two dots. `appendGuests()` builds it. This replaced an SVG-line version that measured chip offsets — those coordinates went stale the moment the webfont loaded and left lines pointing at nothing. Anything position-measured here needs a redraw on font load and reflow; the CSS box needs neither.
- Guest-list parsing splits a line on `&`, `+`, or `and`. A one-word first name inherits the last name of the second (`David & Sarah Klein` -> David Klein / Sarah Klein).
- Seating is random only. There are no affinity rules / no "keep these apart" logic yet.

## Not done yet
- No sync. State is per-browser localStorage — editing on the phone does not show up on the Mac. Use Download CSV / Copy chart as text to move it, or wire up Supabase if it needs to be shared.
