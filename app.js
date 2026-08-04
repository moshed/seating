/* Seating — wedding seating chart. Vanilla JS, no build step, localStorage only. */
(function () {
  'use strict';

  var LS = 'seating.v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------------- state ---------------- */

  function uid() { return Math.random().toString(36).slice(2, 9); }

  function blank() {
    return { v: 1, title: 'Our Wedding', defaultSeats: 10, guests: [], tables: [] };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(LS);
      if (!raw) return blank();
      var s = JSON.parse(raw);
      if (!s || !Array.isArray(s.guests) || !Array.isArray(s.tables)) return blank();
      s.defaultSeats = s.defaultSeats || 10;
      s.title = s.title || 'Our Wedding';
      return s;
    } catch (e) { return blank(); }
  }

  function save() {
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {}
  }

  /* ---------------- model helpers ---------------- */

  function guest(id) {
    for (var i = 0; i < state.guests.length; i++) if (state.guests[i].id === id) return state.guests[i];
    return null;
  }
  function table(id) {
    for (var i = 0; i < state.tables.length; i++) if (state.tables[i].id === id) return state.tables[i];
    return null;
  }
  // A guest plus their linked partner — the thing that actually gets dragged.
  function unit(id) {
    var g = guest(id);
    if (!g) return [];
    if (g.partner && guest(g.partner)) return [g.id, g.partner];
    return [g.id];
  }
  function tableOf(gid) {
    for (var i = 0; i < state.tables.length; i++) {
      if (state.tables[i].guests.indexOf(gid) !== -1) return state.tables[i];
    }
    return null;
  }
  function unseated() {
    return state.guests.filter(function (g) { return !tableOf(g.id); });
  }
  function freeSeats(t) { return t.seats - t.guests.length; }

  function detach(gid) {
    state.tables.forEach(function (t) {
      var i = t.guests.indexOf(gid);
      if (i !== -1) t.guests.splice(i, 1);
    });
  }

  // Move a whole unit to a table id, or to 'pool'. Returns true if it happened.
  // Tables are allowed to overflow — an over-capacity table just turns red.
  function moveUnit(ids, zone) {
    if (zone === 'pool') { ids.forEach(detach); return true; }
    var t = table(zone);
    if (!t) return false;
    ids.forEach(detach);
    ids.forEach(function (id) { if (t.guests.indexOf(id) === -1) t.guests.push(id); });
    return true;
  }

  function canDrop(ids, zone) {
    return zone === 'pool' || !!table(zone);
  }

  // Render guests into a zone, boxing each couple in a .pair so the two names
  // read as one joined unit (the gold rule down the left ties their dots).
  function appendGuests(container, ids) {
    var seen = {};
    ids.forEach(function (id) {
      if (seen[id]) return;
      var g = guest(id);
      if (!g) return;
      seen[id] = 1;
      var mate = g.partner && ids.indexOf(g.partner) !== -1 && !seen[g.partner]
        ? guest(g.partner) : null;
      if (mate) {
        seen[mate.id] = 1;
        var pair = document.createElement('div');
        pair.className = 'pair';
        pair.appendChild(chip(g));
        pair.appendChild(chip(mate));
        container.appendChild(pair);
      } else {
        container.appendChild(chip(g));
      }
    });
  }

  /* ---------------- guest list parsing ---------------- */

  var SPLIT = /\s+(?:&|\+|and)\s+/i;

  // Returns { guests, assign: {guestId: tableName}, skipped: n }
  function parseList(text, includeNoReply) {
    var lines = text.split(/\r?\n/);
    var tabbed = 0;
    lines.forEach(function (l) { if (l.indexOf('\t') !== -1) tabbed++; });
    return tabbed >= 3 ? parseColumns(lines, includeNoReply) : parsePlain(lines);
  }

  function parsePlain(lines) {
    var out = [];
    lines.forEach(function (line) {
      line = line.replace(/^\s*[-*•]\s*/, '').trim();
      if (!line) return;
      var parts = line.split(SPLIT).map(function (p) { return p.trim(); }).filter(Boolean);
      if (parts.length >= 2) {
        var a = parts[0], b = parts[1];
        // "David & Sarah Klein" -> David Klein, Sarah Klein
        if (a.indexOf(' ') === -1 && b.indexOf(' ') !== -1) {
          a = a + ' ' + b.split(/\s+/).slice(-1)[0];
        }
        var pair = couple(a, b);
        out.push(pair[0], pair[1]);
      } else {
        out.push({ id: uid(), name: parts[0], partner: null });
      }
    });
    return { guests: out, assign: {}, skipped: 0 };
  }

  function couple(a, b) {
    var ga = { id: uid(), name: a, partner: null };
    var gb = { id: uid(), name: b, partner: null };
    ga.partner = gb.id; gb.partner = ga.id;
    return [ga, gb];
  }

  /* Spreadsheet paste (tab separated, as copied straight out of Excel).
     Columns are found by header name, so column order does not matter.
     Understands the wedding-list shape: Sal | Fname | Lname | responses |
     Extra | Spouse | Table #, where "yes-2" means two people are coming. */
  function parseColumns(lines, includeNoReply) {
    var rows = lines.map(function (l) { return l.split('\t'); })
                    .filter(function (r) {
                      return r.some(function (c) { return String(c).trim(); });
                    });
    var pats = {
      fname: /^\s*(f\s*[-_ ]?name|first)/i,
      lname: /^\s*(l\s*[-_ ]?name|last|surname)/i,
      spouse: /spouse|wife|partner/i,
      resp: /response|rsvp|attend|coming/i,
      sal: /^\s*(sal|salut|title|prefix)/i,
      tbl: /table/i
    };
    var head = -1, col = {};
    for (var i = 0; i < rows.length && head === -1; i++) {
      var found = {};
      rows[i].forEach(function (c, j) {
        Object.keys(pats).forEach(function (k) {
          if (found[k] === undefined && pats[k].test(String(c).trim())) found[k] = j;
        });
      });
      if (found.fname !== undefined || found.lname !== undefined) { head = i; col = found; }
    }
    if (head === -1) return { guests: [], assign: {}, skipped: 0, error: 'noheader' };

    var guests = [], assign = {}, skipped = 0;
    var cell = function (r, k) {
      return col[k] === undefined ? '' : String(r[col[k]] === undefined ? '' : r[col[k]]).trim();
    };

    rows.slice(head + 1).forEach(function (r) {
      var fn = cell(r, 'fname'), ln = cell(r, 'lname');
      if (!fn && !ln) return;
      var sal = cell(r, 'sal'), sp = cell(r, 'spouse'),
          resp = cell(r, 'resp'), tbl = cell(r, 'tbl');

      var n;
      if (col.resp === undefined) {
        n = sp && sp.toLowerCase() !== fn.toLowerCase() ? 2 : 1;
      } else {
        var m = resp.match(/\d+/);
        if (m) n = parseInt(m[0], 10);
        else if (/yes/i.test(resp)) n = 1;
        else n = 0;                                  // blank = no reply yet
      }
      if (n < 1) {
        if (!includeNoReply) { skipped++; return; }
        n = sp && sp.toLowerCase() !== fn.toLowerCase() ? 2 : 1;
      }

      var a = (fn + ' ' + ln).trim();
      var mine = [];
      if (n >= 2) {
        var b;
        if (sp && sp.toLowerCase() !== fn.toLowerCase()) b = (sp + ' ' + ln).trim();
        else if (/and\s+(mrs|dr|rabbi)/i.test(sal)) b = ('Mrs. ' + ln).trim();
        else b = 'Guest of ' + a;
        var pair = couple(a, b);
        mine.push(pair[0], pair[1]);
        for (var k = 2; k < n; k++) {
          mine.push({ id: uid(), name: 'Guest ' + (k - 1) + ' of ' + a, partner: null });
        }
      } else {
        mine.push({ id: uid(), name: a, partner: null });
      }
      mine.forEach(function (g) {
        guests.push(g);
        if (tbl) assign[g.id] = tbl;
      });
    });
    return { guests: guests, assign: assign, skipped: skipped };
  }

  /* ---------------- seating ---------------- */

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function units() {
    var seen = {}, list = [];
    state.guests.forEach(function (g) {
      if (seen[g.id]) return;
      var u = unit(g.id);
      u.forEach(function (id) { seen[id] = 1; });
      list.push(u);
    });
    return list;
  }

  function ensureTables() {
    var need = Math.max(1, Math.ceil(state.guests.length / state.defaultSeats));
    while (state.tables.length < need) addTable(true);
  }

  function randomize() {
    if (!state.guests.length) { toast('Add guests first'); return; }
    ensureTables();
    state.tables.forEach(function (t) { t.guests = []; });
    var us = shuffle(units());
    var left = [];
    us.forEach(function (u) {
      var placed = false;
      for (var i = 0; i < state.tables.length; i++) {
        if (freeSeats(state.tables[i]) >= u.length) {
          u.forEach(function (id) { state.tables[i].guests.push(id); });
          placed = true; break;
        }
      }
      if (!placed) left.push(u);
    });
    save(); render();
    toast(left.length ? left.reduce(function (n, u) { return n + u.length; }, 0) + ' guests left over — add a table' : 'Shuffled');
  }

  function addTable(silent) {
    state.tables.push({
      id: uid(),
      name: 'Table ' + (state.tables.length + 1),
      seats: state.defaultSeats,
      guests: []
    });
    if (!silent) { save(); render(); }
  }

  /* ---------------- rendering ---------------- */

  var search = '';
  var linking = false;
  var picked = null;

  function matches(g) {
    return !search || g.name.toLowerCase().indexOf(search) !== -1;
  }

  function chip(g) {
    var el = document.createElement('div');
    el.className = 'chip' + (g.partner && guest(g.partner) ? ' couple' : '');
    el.dataset.gid = g.id;
    if (search && !matches(g)) el.classList.add('dim');
    if (picked === g.id) el.classList.add('picked');

    var nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = g.name;
    el.appendChild(nm);

    var x = document.createElement('button');
    x.className = 'x';
    x.type = 'button';
    x.textContent = '×';
    x.title = 'Remove guest';
    x.dataset.del = g.id;
    el.appendChild(x);
    return el;
  }

  function render() {
    $('#title').textContent = state.title;

    // stats
    var seats = state.tables.reduce(function (n, t) { return n + t.seats; }, 0);
    var seated = state.guests.length - unseated().length;
    $('#stats').textContent =
      state.guests.length + ' guests · ' + seated + ' seated · ' +
      state.tables.length + ' tables · ' + seats + ' seats';

    // over-capacity list
    var over = state.tables.filter(function (t) { return t.guests.length > t.seats; });
    $('#overlist').hidden = !over.length;
    $('#over-count').textContent = over.length;
    var ob = $('#over-body');
    ob.innerHTML = '';
    over.forEach(function (t) {
      var row = document.createElement('button');
      row.className = 'over-row';
      row.type = 'button';
      var nm = document.createElement('span');
      nm.className = 'tn';
      nm.textContent = t.name;
      var by = document.createElement('span');
      by.className = 'by';
      by.textContent = t.guests.length + '/' + t.seats + '  (+' + (t.guests.length - t.seats) + ')';
      row.appendChild(nm); row.appendChild(by);
      row.addEventListener('click', function () { revealTable(t.id); });
      ob.appendChild(row);
    });

    // pool
    var pool = $('#pool-body');
    pool.innerHTML = '';
    var un = unseated();
    $('#pool-count').textContent = un.length;
    appendGuests(pool, un.map(function (g) { return g.id; }));

    // tables
    var wrap = $('#tables');
    wrap.innerHTML = '';
    var pt = document.createElement('div');
    pt.className = 'print-title';
    pt.textContent = state.title;
    wrap.appendChild(pt);

    state.tables.forEach(function (t) {
      var card = document.createElement('div');
      card.className = 'table-card' + (t.guests.length > t.seats ? ' over' : '');

      var head = document.createElement('div');
      head.className = 'thead';

      var nameEl = document.createElement('input');
      nameEl.className = 'tname';
      nameEl.value = t.name;
      nameEl.spellcheck = false;
      nameEl.addEventListener('change', function () {
        t.name = nameEl.value.trim() || t.name; save(); render();
      });
      head.appendChild(nameEl);

      var step = document.createElement('div');
      step.className = 'stepper';
      var minus = document.createElement('button');
      minus.type = 'button'; minus.textContent = '−'; minus.title = 'Fewer seats';
      var n = document.createElement('span');
      n.className = 'n' + (t.guests.length > t.seats ? ' bad' : '');
      n.textContent = t.guests.length + '/' + t.seats;
      var plus = document.createElement('button');
      plus.type = 'button'; plus.textContent = '+'; plus.title = 'More seats';
      minus.addEventListener('click', function () {
        t.seats = Math.max(1, t.seats - 1); save(); render();
      });
      plus.addEventListener('click', function () {
        t.seats = Math.min(60, t.seats + 1); save(); render();
      });
      step.appendChild(minus); step.appendChild(n); step.appendChild(plus);
      head.appendChild(step);

      var del = document.createElement('button');
      del.className = 'tdel'; del.type = 'button'; del.textContent = '×';
      del.title = 'Delete table';
      del.addEventListener('click', function () {
        if (t.guests.length && !confirm('Delete "' + t.name + '"? Its guests go back to the list.')) return;
        state.tables = state.tables.filter(function (x) { return x.id !== t.id; });
        save(); render();
      });
      head.appendChild(del);
      card.appendChild(head);

      var body = document.createElement('div');
      body.className = 'table-body dropzone';
      body.dataset.zone = t.id;
      appendGuests(body, t.guests);
      var empties = Math.max(0, t.seats - t.guests.length);
      for (var i = 0; i < Math.min(empties, 40); i++) {
        var e = document.createElement('div');
        e.className = 'empty-seat';
        body.appendChild(e);
      }
      card.appendChild(body);
      wrap.appendChild(card);
    });

    markMates();
  }

  function revealTable(id) {
    var body = document.querySelector('.table-body[data-zone="' + id + '"]');
    if (!body) return;
    var card = body.closest('.table-card');
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('flash');
    void card.offsetWidth;                       // restart the animation
    card.classList.add('flash');
    setTimeout(function () { card.classList.remove('flash'); }, 1200);
  }

  // Halo both halves of a couple when either is hovered.
  function markMates() {
    $$('.chip').forEach(function (el) {
      el.addEventListener('mouseenter', function () {
        var g = guest(el.dataset.gid);
        if (!g || !g.partner) return;
        $$('.chip[data-gid="' + g.partner + '"]').forEach(function (m) { m.classList.add('mate'); });
        el.classList.add('mate');
      });
      el.addEventListener('mouseleave', function () {
        $$('.chip.mate').forEach(function (m) { m.classList.remove('mate'); });
      });
    });
  }

  /* ---------------- drag & drop (pointer events: works on mouse + touch) ---------------- */

  var drag = null;

  document.addEventListener('pointerdown', function (ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    var el = ev.target.closest ? ev.target.closest('.chip') : null;
    if (!el) return;
    if (ev.target.dataset && ev.target.dataset.del) return;  // the × button
    if (linking) return;                                      // linking mode uses clicks

    drag = {
      gid: el.dataset.gid,
      el: el,
      sx: ev.clientX, sy: ev.clientY,
      started: false, ghost: null, ids: null, zone: null, hot: null
    };
  });

  document.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    if (!drag.started) {
      if (Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) < 6) return;
      startDrag(ev);
    }
    ev.preventDefault();

    drag.ghost.style.left = (ev.clientX - drag.ox) + 'px';
    drag.ghost.style.top = (ev.clientY - drag.oy) + 'px';

    drag.ghost.style.visibility = 'hidden';
    var under = document.elementFromPoint(ev.clientX, ev.clientY);
    drag.ghost.style.visibility = '';
    var zone = under && under.closest ? under.closest('.dropzone') : null;

    if (drag.hot && drag.hot !== zone) { drag.hot.classList.remove('hot', 'no'); }
    drag.zone = zone ? zone.dataset.zone : null;
    drag.hot = zone;
    if (zone) {
      var ok = canDrop(drag.ids, drag.zone);
      zone.classList.toggle('hot', ok);
      zone.classList.toggle('no', !ok);
    }
  }, { passive: false });

  function startDrag(ev) {
    drag.started = true;
    drag.ids = unit(drag.gid);
    document.body.classList.add('dragging');

    var r = drag.el.getBoundingClientRect();
    drag.ox = drag.sx - r.left;
    drag.oy = drag.sy - r.top;

    var g = document.createElement('div');
    g.className = 'chip drag-ghost' + (drag.ids.length > 1 ? ' couple' : '');
    var label = guest(drag.gid).name;
    if (drag.ids.length > 1) {
      var other = guest(drag.ids[1] === drag.gid ? drag.ids[0] : drag.ids[1]);
      if (other) label += '  +  ' + other.name;
    }
    g.textContent = label;
    g.style.left = r.left + 'px';
    g.style.top = r.top + 'px';
    document.body.appendChild(g);
    drag.ghost = g;

    drag.ids.forEach(function (id) {
      $$('.chip[data-gid="' + id + '"]').forEach(function (c) { c.classList.add('ghosting'); });
    });
  }

  function endDrag(commit) {
    if (!drag) return;
    var d = drag; drag = null;
    if (!d.started) return;
    if (d.ghost) d.ghost.remove();
    if (d.hot) d.hot.classList.remove('hot', 'no');
    document.body.classList.remove('dragging');
    if (commit && d.zone && canDrop(d.ids, d.zone)) {
      moveUnit(d.ids, d.zone);
      save();
    }
    render();
  }

  document.addEventListener('pointerup', function () { endDrag(true); });
  document.addEventListener('pointercancel', function () { endDrag(false); });

  /* ---------------- clicks: delete guest, link couples ---------------- */

  document.addEventListener('click', function (ev) {
    var t = ev.target;

    if (t.dataset && t.dataset.del) {
      var g = guest(t.dataset.del);
      if (!g) return;
      if (g.partner) { var p = guest(g.partner); if (p) p.partner = null; }
      detach(g.id);
      state.guests = state.guests.filter(function (x) { return x.id !== g.id; });
      save(); render();
      return;
    }

    if (linking) {
      var chipEl = t.closest ? t.closest('.chip') : null;
      if (!chipEl) return;
      handleLink(chipEl.dataset.gid);
    }
  });

  function handleLink(gid) {
    var g = guest(gid);
    if (!g) return;

    if (g.partner) {                       // tap a linked guest -> unlink the pair
      var p = guest(g.partner);
      if (p) p.partner = null;
      g.partner = null;
      picked = null;
      save(); render(); toast('Unlinked');
      return;
    }
    if (!picked) { picked = gid; render(); return; }
    if (picked === gid) { picked = null; render(); return; }

    var a = guest(picked), b = g;
    if (!a) { picked = gid; render(); return; }
    a.partner = b.id; b.partner = a.id;

    // keep a new couple together: pull b to a's table, else send both to the pool
    var ta = tableOf(a.id), tb = tableOf(b.id);
    if (ta && (!tb || tb.id !== ta.id)) {
      if (!moveUnit([a.id, b.id], ta.id)) moveUnit([a.id, b.id], 'pool');
    } else if (!ta && tb) {
      if (!moveUnit([a.id, b.id], tb.id)) moveUnit([a.id, b.id], 'pool');
    }

    picked = null;
    save(); render();
    toast(a.name + ' + ' + b.name + ' linked');
  }

  /* ---------------- exports ---------------- */

  function chartText() {
    var lines = [state.title, ''];
    state.tables.forEach(function (t) {
      lines.push(t.name + '  (' + t.guests.length + '/' + t.seats + ')');
      t.guests.forEach(function (id) { var g = guest(id); if (g) lines.push('  ' + g.name); });
      lines.push('');
    });
    var un = unseated();
    if (un.length) {
      lines.push('Not seated');
      un.forEach(function (g) { lines.push('  ' + g.name); });
    }
    return lines.join('\n');
  }

  function download(name, text, type) {
    var b = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function csv() {
    var rows = [['Table', 'Seats', 'Guest', 'Linked to']];
    state.tables.forEach(function (t) {
      t.guests.forEach(function (id) {
        var g = guest(id); if (!g) return;
        var p = g.partner ? guest(g.partner) : null;
        rows.push([t.name, t.seats, g.name, p ? p.name : '']);
      });
    });
    unseated().forEach(function (g) {
      var p = g.partner ? guest(g.partner) : null;
      rows.push(['(not seated)', '', g.name, p ? p.name : '']);
    });
    return rows.map(function (r) {
      return r.map(function (c) {
        c = String(c);
        return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
      }).join(',');
    }).join('\n');
  }

  /* ---------------- ui wiring ---------------- */

  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2200);
  }

  function openModal(id) { $(id).hidden = false; }
  function closeModals() { $$('.modal').forEach(function (m) { m.hidden = true; }); }

  $$('.modal').forEach(function (m) {
    m.addEventListener('click', function (ev) {
      if (ev.target === m || (ev.target.dataset && 'close' in ev.target.dataset)) closeModals();
    });
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { closeModals(); if (linking) setLinking(false); }
  });

  $('#title').addEventListener('blur', function () {
    state.title = this.textContent.trim() || 'Our Wedding';
    this.textContent = state.title;
    save(); render();
  });
  $('#title').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') { ev.preventDefault(); this.blur(); }
  });

  $('#search').addEventListener('input', function () {
    search = this.value.trim().toLowerCase();
    render();
  });

  $('#btn-addtable').addEventListener('click', function () { addTable(); });
  $('#btn-random').addEventListener('click', randomize);

  function setLinking(on) {
    linking = on; picked = null;
    document.body.classList.toggle('linking', on);
    $('#btn-link').classList.toggle('on', on);
    $('#linkbar').hidden = !on;
    render();
  }
  $('#btn-link').addEventListener('click', function () { setLinking(!linking); });
  $('#btn-linkdone').addEventListener('click', function () { setLinking(false); });

  $('#btn-import').addEventListener('click', function () {
    var txt = state.guests.length ? guestsToText() : '';
    $('#import-text').value = txt;
    $('#import-replace').checked = true;
    openModal('#modal-import');
    $('#import-text').focus();
  });

  function guestsToText() {
    var seen = {}, lines = [];
    state.guests.forEach(function (g) {
      if (seen[g.id]) return;
      seen[g.id] = 1;
      var p = g.partner ? guest(g.partner) : null;
      if (p) { seen[p.id] = 1; lines.push(g.name + ' & ' + p.name); }
      else lines.push(g.name);
    });
    return lines.join('\n');
  }

  $('#import-save').addEventListener('click', function () {
    var res = parseList($('#import-text').value, $('#import-noreply').checked);
    if (res.error === 'noheader') {
      toast('Include the header row (Fname / Lname) when pasting from Excel');
      return;
    }
    if (!res.guests.length) { toast('Nothing to import'); return; }

    if ($('#import-replace').checked) {
      state.guests = res.guests;
      state.tables.forEach(function (t) { t.guests = []; });
    } else {
      state.guests = state.guests.concat(res.guests);
    }
    closeModals();

    // Honour a filled-in "Table #" column: those guests get seated where the
    // spreadsheet says, everyone else is shuffled into whatever is left.
    var placed = 0;
    Object.keys(res.assign).forEach(function (gid) {
      var name = res.assign[gid];
      var t = null;
      for (var i = 0; i < state.tables.length; i++) {
        if (state.tables[i].name.toLowerCase() === name.toLowerCase() ||
            state.tables[i].name.toLowerCase() === ('table ' + name).toLowerCase()) {
          t = state.tables[i]; break;
        }
      }
      if (!t) {
        t = { id: uid(), name: /^\d+$/.test(name) ? 'Table ' + name : name,
              seats: state.defaultSeats, guests: [] };
        state.tables.push(t);
      }
      if (t.guests.indexOf(gid) === -1) { t.guests.push(gid); placed++; }
    });

    save();
    if (placed) {
      ensureTables();
      save(); render();
    } else {
      randomize();
    }
    if (res.skipped) toast(res.skipped + ' households with no RSVP were left out');
  });

  $('#btn-more').addEventListener('click', function () { openModal('#modal-more'); });
  $('#mm-print').addEventListener('click', function () { closeModals(); setTimeout(function () { window.print(); }, 80); });
  $('#mm-csv').addEventListener('click', function () {
    closeModals(); download('seating.csv', csv(), 'text/csv;charset=utf-8');
  });
  $('#mm-copy').addEventListener('click', function () {
    closeModals();
    navigator.clipboard.writeText(chartText())
      .then(function () { toast('Copied'); })
      .catch(function () { toast('Copy failed'); });
  });
  $('#mm-seatsall').addEventListener('click', function () {
    var v = prompt('Seats at every table:', String(state.defaultSeats));
    if (v === null) return;
    var n = Math.max(1, Math.min(60, parseInt(v, 10) || state.defaultSeats));
    state.defaultSeats = n;
    state.tables.forEach(function (t) { t.seats = n; });
    closeModals(); save(); render();
  });
  $('#mm-clearseats').addEventListener('click', function () {
    state.tables.forEach(function (t) { t.guests = []; });
    closeModals(); save(); render();
  });
  $('#mm-reset').addEventListener('click', function () {
    if (!confirm('Delete all guests and tables? This cannot be undone.')) return;
    state = blank();
    closeModals(); save(); render();
  });

  /* ---------------- boot ---------------- */

  render();
  if (!state.guests.length) setTimeout(function () { $('#btn-import').click(); }, 300);
})();
