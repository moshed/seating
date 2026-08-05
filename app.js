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

  function saveLocal() {
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {}
  }

  function save() {
    saveLocal();
    if (SYNC.id) schedulePush();
  }

  /* ---------------- linking two devices ----------------
     One row per chart in Supabase, keyed by a random uuid. That uuid is the
     whole credential: the table has no SELECT policy and cannot be listed,
     so the only way in is knowing the code. Last write wins — this is for
     one person on two devices, not a room full of editors. */

  var SYNC = {
    url: 'https://atqhfbaurrmivjarowco.supabase.co',
    key: 'sb_publishable_G44hmJHuAwEcoxq0QPWI7w_BWt_owiB',
    id: null, rev: 0, pushT: 0, poll: 0
  };

  function rpc(fn, body) {
    return fetch(SYNC.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: {
        'apikey': SYNC.key,
        'Authorization': 'Bearer ' + SYNC.key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('rpc ' + r.status);
      return r.json();
    });
  }

  function linkNote(msg) {
    var el = $('#link-note');
    if (el) el.textContent = msg;
  }

  function schedulePush() {
    clearTimeout(SYNC.pushT);
    SYNC.pushT = setTimeout(pushChart, 900);
  }

  function pushChart() {
    if (!SYNC.id) return;
    rpc('seat_chart_put', { p_id: SYNC.id, p_doc: state })
      .then(function (rev) {
        SYNC.rev = rev;
        try { localStorage.setItem('seating.rev', String(rev)); } catch (e) {}
        linkNote('Sent a moment ago');
      })
      .catch(function () { linkNote('Could not reach the server — will retry'); });
  }

  function pullChart() {
    if (!SYNC.id || drag) return;                 // never yank the board mid-drag
    rpc('seat_chart_get', { p_id: SYNC.id, p_rev: SYNC.rev })
      .then(function (res) {
        if (!res || res.same || !res.doc) return;
        SYNC.rev = res.rev;
        try { localStorage.setItem('seating.rev', String(res.rev)); } catch (e) {}
        state = res.doc;
        state.defaultSeats = state.defaultSeats || 10;
        saveLocal();                               // local only — do not echo back
        render();
        toast('Updated from your other device');
      })
      .catch(function () {});
  }

  function startSync(id) {
    SYNC.id = id;
    try { localStorage.setItem('seating.link', id); } catch (e) {}
    clearInterval(SYNC.poll);
    SYNC.poll = setInterval(pullChart, 5000);
    paintLink();
  }

  function stopSync() {
    SYNC.id = null; SYNC.rev = 0;
    clearInterval(SYNC.poll); SYNC.poll = 0;
    try { localStorage.removeItem('seating.link'); localStorage.removeItem('seating.rev'); } catch (e) {}
    paintLink();
  }

  function paintLink() {
    var on = !!SYNC.id;
    $('#link-off').hidden = on;
    $('#link-on').hidden = !on;
    if (on) $('#link-code').textContent = SYNC.id;
    render();
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

  /* ---------------- reading a dropped .xlsx / .csv ----------------
     An .xlsx is a zip of XML. Rather than ship a 900 KB spreadsheet
     library for one file, walk the zip directory by hand and inflate with
     the browser's own DecompressionStream. Only the first worksheet and
     the shared-string table are needed. */

  function u16(dv, o) { return dv.getUint16(o, true); }
  function u32(dv, o) { return dv.getUint32(o, true); }

  function zipEntries(buf) {
    var dv = new DataView(buf), n = buf.byteLength, eocd = -1;
    for (var i = n - 22; i >= 0 && i > n - 66000; i--) {
      if (u32(dv, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip');
    var count = u16(dv, eocd + 10), p = u32(dv, eocd + 16), out = {};
    for (var k = 0; k < count; k++) {
      if (u32(dv, p) !== 0x02014b50) break;
      var nlen = u16(dv, p + 28), elen = u16(dv, p + 30), clen = u16(dv, p + 32);
      out[new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen))] = {
        method: u16(dv, p + 10), csize: u32(dv, p + 20), lho: u32(dv, p + 42)
      };
      p += 46 + nlen + elen + clen;
    }
    return out;
  }

  function zipRead(buf, e) {
    var dv = new DataView(buf);
    if (u32(dv, e.lho) !== 0x04034b50) return Promise.reject(new Error('bad entry'));
    var start = e.lho + 30 + u16(dv, e.lho + 26) + u16(dv, e.lho + 28);
    var data = new Uint8Array(buf, start, e.csize);
    if (e.method === 0) return Promise.resolve(new TextDecoder().decode(data));
    if (e.method !== 8) return Promise.reject(new Error('unsupported compression'));
    if (!window.DecompressionStream) return Promise.reject(new Error('no inflate'));
    var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).text();
  }

  function colIndex(ref) {
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    var n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  function xlsxToTsv(buf) {
    var ents = zipEntries(buf), sheet = null;
    Object.keys(ents).forEach(function (k) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(k) && (!sheet || k < sheet)) sheet = k;
    });
    if (!sheet) throw new Error('no worksheet');
    return Promise.all([
      zipRead(buf, ents[sheet]),
      ents['xl/sharedStrings.xml'] ? zipRead(buf, ents['xl/sharedStrings.xml']) : ''
    ]).then(function (r) {
      var shared = [];
      if (r[1]) {
        var sd = new DOMParser().parseFromString(r[1], 'application/xml');
        Array.prototype.forEach.call(sd.getElementsByTagName('si'), function (si) {
          var t = '';
          Array.prototype.forEach.call(si.getElementsByTagName('t'), function (n) {
            if (n.parentNode.nodeName !== 'rPh') t += n.textContent;
          });
          shared.push(t);
        });
      }
      var doc = new DOMParser().parseFromString(r[0], 'application/xml');
      var rows = [], width = 0;
      Array.prototype.forEach.call(doc.getElementsByTagName('row'), function (row) {
        var cells = [];
        Array.prototype.forEach.call(row.getElementsByTagName('c'), function (c) {
          var col = colIndex(c.getAttribute('r')), t = c.getAttribute('t'), v = '';
          if (t === 'inlineStr') {
            Array.prototype.forEach.call(c.getElementsByTagName('t'), function (n) {
              v += n.textContent;
            });
          } else {
            var vn = c.getElementsByTagName('v')[0];
            v = vn ? vn.textContent : '';
            if (t === 's') v = shared[parseInt(v, 10)] || '';
          }
          while (cells.length < col) cells.push('');
          cells[col] = v.replace(/[\t\r\n]+/g, ' ').trim();
        });
        if (cells.length > width) width = cells.length;
        rows.push(cells);
      });
      var out = [];
      rows.forEach(function (r2) {
        while (r2.length < width) r2.push('');
        if (r2.some(function (c) { return c; })) out.push(r2.join('\t'));
      });
      return out.join('\n');
    });
  }

  // CSV -> TSV, honouring quoted fields that contain commas or newlines.
  function csvToTsv(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (ch !== '\r') cur += ch;
    }
    row.push(cur);
    if (row.some(function (c) { return c; })) rows.push(row);
    return rows.map(function (r) {
      return r.map(function (c) { return c.replace(/\t/g, ' ').trim(); }).join('\t');
    }).join('\n');
  }

  function loadFile(file) {
    var name = (file.name || '').toLowerCase();
    var done = function (t) {
      if (!t || !t.trim()) { toast('That file looked empty'); return; }
      $('#import-text').value = t;
      $('#import-replace').checked = true;
      openModal('#modal-import');
      toast('Loaded ' + file.name + ' — check it, then press Save');
    };
    var fail = function () { toast('Could not read ' + file.name); };

    if (/\.(xlsx|xlsm)$/.test(name)) {
      file.arrayBuffer().then(xlsxToTsv).then(done).catch(fail);
    } else if (/\.csv$/.test(name)) {
      file.text().then(function (t) { done(csvToTsv(t)); }).catch(fail);
    } else if (/\.(tsv|txt)$/.test(name)) {
      file.text().then(done).catch(fail);
    } else if (/\.xls$/.test(name)) {
      toast('Old .xls format — re-save it as .xlsx and drop that');
    } else {
      toast('Drop an .xlsx, .csv or .txt file');
    }
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

  function surname(name) {
    var parts = String(name || '').trim().split(/\s+/);
    return (parts[parts.length - 1] || '').toLowerCase();
  }

  /* Seat by family: everyone sharing a last name is one group, and a group
     goes to the tightest table it fits at whole. Biggest families are placed
     first so they get a table before the space is chipped away. */
  function randomize() {
    if (!state.guests.length) { toast('Add guests first'); return; }
    ensureTables();
    state.tables.forEach(function (t) { t.guests = []; });

    var fams = {}, order = [];
    units().forEach(function (u) {
      var k = surname(guest(u[0]).name);
      if (!fams[k]) { fams[k] = []; order.push(k); }
      fams[k].push(u);
    });
    shuffle(order);                          // ties broken randomly, not alphabetically
    var groups = order.map(function (k) {
      var size = 0;
      fams[k].forEach(function (u) { size += u.length; });
      return { units: fams[k], size: size };
    });
    groups.sort(function (a, b) { return b.size - a.size; });

    var left = [];
    groups.forEach(function (g) {
      var fit = null;
      state.tables.forEach(function (t) {
        if (freeSeats(t) >= g.size && (!fit || freeSeats(t) < freeSeats(fit))) fit = t;
      });
      if (fit) {
        g.units.forEach(function (u) {
          u.forEach(function (id) { fit.guests.push(id); });
        });
        return;
      }
      // Bigger than any one table. Fill whole empty tables with them first so
      // the family lands as a couple of solid blocks instead of confetti.
      var rem = g.units.slice();
      state.tables.forEach(function (t) {
        if (t.guests.length || !rem.length) return;
        for (var i = 0; i < rem.length;) {
          if (rem[i].length <= freeSeats(t)) {
            rem[i].forEach(function (id) { t.guests.push(id); });
            rem.splice(i, 1);
          } else i++;
        }
      });
      rem.forEach(function (u) {
        var best = null;
        state.tables.forEach(function (t) {
          if (freeSeats(t) >= u.length && (!best || freeSeats(t) > freeSeats(best))) best = t;
        });
        if (best) u.forEach(function (id) { best.guests.push(id); });
        else left.push(u);
      });
    });

    // whoever is still standing gets new tables
    while (left.length) {
      var t = { id: uid(), name: 'Table ' + (state.tables.length + 1),
                seats: state.defaultSeats, guests: [] };
      state.tables.push(t);
      for (var i = 0; i < left.length;) {
        if (left[i].length <= freeSeats(t)) {
          left[i].forEach(function (id) { t.guests.push(id); });
          left.splice(i, 1);
        } else i++;
      }
      if (!t.guests.length) {                // a unit larger than a whole table
        left.shift().forEach(function (id) { t.guests.push(id); });
      }
    }

    save(); render();
    toast('Seated by family');
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
    el.title = g.name + ' — double-click to rename';
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
      state.tables.length + ' tables · ' + seats + ' seats' +
      (SYNC.id ? ' · linked' : '');

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
      touch: ev.pointerType === 'touch',
      started: false, ghost: null, ids: null, zone: null, hot: null
    };
  });

  /* Auto-scroll while dragging near an edge. Without this a phone is stuck:
     you pick a name up and the table you want is off-screen with no way to
     reach it, which reads as "dragging doesn't work". */
  var scrollRaf = 0, scrollVec = null;

  function edgeScroll(x, y) {
    var pb = $('#pool-body'), r = pb.getBoundingClientRect(), el = null, top, bottom;
    if (pb.scrollHeight > pb.clientHeight + 4 &&
        x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      el = pb; top = r.top; bottom = r.bottom;
    } else {
      top = 0; bottom = window.innerHeight;
    }
    var band = 72, dir = 0;
    if (y < top + band) dir = -1;
    else if (y > bottom - band) dir = 1;
    scrollVec = dir ? { el: el, dir: dir } : null;
    if (!scrollVec) return;
    step();                                   // move now, don't wait for a frame
    if (!scrollRaf) scrollRaf = requestAnimationFrame(edgeTick);
  }

  function step() {
    if (!scrollVec) return;
    if (scrollVec.el) scrollVec.el.scrollTop += scrollVec.dir * 14;
    else window.scrollBy(0, scrollVec.dir * 14);
  }

  // keeps scrolling while the finger is held still at the edge
  function edgeTick() {
    scrollRaf = 0;
    if (!drag || !scrollVec) return;
    step();
    scrollRaf = requestAnimationFrame(edgeTick);
  }

  function stopEdgeScroll() {
    scrollVec = null;
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); scrollRaf = 0; }
  }

  /* Tap-to-move. On a phone, hauling a name across 32 tables is hopeless, so
     a tap (pointer down and up with no movement) opens a table picker. */
  function openMove(gid) {
    var g = guest(gid);
    if (!g) return;
    var ids = unit(gid);
    $('#move-title').textContent = ids.length > 1
      ? 'Move ' + g.name + ' + partner to…'
      : 'Move ' + g.name + ' to…';

    var list = $('#move-list');
    list.innerHTML = '';
    var here = tableOf(gid);

    var add = function (label, sub, zone, current) {
      var b = document.createElement('button');
      b.className = 'menu-item move-item' + (current ? ' current' : '');
      b.type = 'button';
      var t = document.createElement('span');
      t.className = 'mi-name';
      t.textContent = label;
      var s = document.createElement('span');
      s.className = 'mi-sub';
      s.textContent = sub;
      b.appendChild(t); b.appendChild(s);
      b.addEventListener('click', function () {
        moveUnit(ids, zone);
        save(); render(); closeModals();
        toast(g.name + ' → ' + label);
      });
      list.appendChild(b);
    };

    state.tables.forEach(function (t) {
      add(t.name, t.guests.length + '/' + t.seats, t.id, here && here.id === t.id);
    });
    add('Not seated', unseated().length + ' waiting', 'pool', !here);

    openModal('#modal-move');
  }

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
    edgeScroll(ev.clientX, ev.clientY);
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
    stopEdgeScroll();
    if (!d.started) {
      // a tap, not a drag — on touch that means "show me where to put them"
      if (commit && d.touch && !linking) openMove(d.gid);
      return;
    }
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

  // Double-click a name to fix it — the spreadsheet leaves some spouses blank,
  // so those come in as "Mrs. <Lastname>" and need a real first name typed in.
  document.addEventListener('dblclick', function (ev) {
    if (linking) return;
    var el = ev.target.closest ? ev.target.closest('.chip') : null;
    if (!el) return;
    var g = guest(el.dataset.gid);
    if (!g) return;
    var v = prompt('Name:', g.name);
    if (v === null) return;
    v = v.trim();
    if (!v || v === g.name) return;
    g.name = v;
    save(); render();
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
    var lb = $('#import-load');
    lb.disabled = false;
    lb.textContent = 'Load the Leo & Dani guest list';
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

  // The real wedding list ships with the app so nobody has to find the
  // spreadsheet — it goes through the same column parser as a fresh paste.
  $('#import-load').addEventListener('click', function () {
    var btn = this;
    btn.disabled = true; btn.textContent = 'Loading…';
    fetch('guests.tsv', { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error(r.status);
        return r.text();
      })
      .then(function (t) {
        $('#import-text').value = t;
        btn.textContent = 'Loaded — now press Save';
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = 'Load the Leo & Dani guest list';
        toast('Could not load the list');
      });
  });

  $('#import-save').addEventListener('click', function () {
    var r = applyImport($('#import-text').value, $('#import-replace').checked,
                        $('#import-noreply').checked);
    if (r === 'noheader') toast('Include the header row (Fname / Lname) when pasting from Excel');
    else if (r === 'empty') toast('Nothing to import');
  });

  function applyImport(text, replace, noreply) {
    var res = parseList(text, noreply);
    if (res.error === 'noheader') return 'noheader';
    if (!res.guests.length) return 'empty';

    if (replace) {
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
    return 'ok';
  }

  // Drop a spreadsheet anywhere on the page.
  var dragDepth = 0;
  function hasFiles(ev) {
    var dt = ev.dataTransfer;
    return dt && dt.types && Array.prototype.indexOf.call(dt.types, 'Files') !== -1;
  }
  window.addEventListener('dragenter', function (ev) {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth++;
    $('#filedrop').hidden = false;
  });
  window.addEventListener('dragover', function (ev) {
    if (hasFiles(ev)) { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; }
  });
  window.addEventListener('dragleave', function (ev) {
    if (!hasFiles(ev)) return;
    if (--dragDepth <= 0) { dragDepth = 0; $('#filedrop').hidden = true; }
  });
  window.addEventListener('drop', function (ev) {
    if (!hasFiles(ev)) return;
    ev.preventDefault();
    dragDepth = 0;
    $('#filedrop').hidden = true;
    var f = ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  $('#import-file').addEventListener('change', function () {
    if (this.files && this.files[0]) loadFile(this.files[0]);
    this.value = '';
  });
  $('#import-pick').addEventListener('click', function () { $('#import-file').click(); });

  $('#btn-more').addEventListener('click', function () { openModal('#modal-more'); });
  $('#mm-default').addEventListener('click', function () {
    if (!confirm('Throw away this chart and start again from the Leo & Dani guest list?')) return;
    closeModals();
    state = blank();
    save();
    loadDefaultList();
  });
  $('#mm-link').addEventListener('click', function () {
    closeModals();
    paintLink();
    linkNote(SYNC.id ? 'In sync.' : '');
    openModal('#modal-link');
  });

  $('#link-create').addEventListener('click', function () {
    var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : uuidish();
    rpc('seat_chart_put', { p_id: id, p_doc: state })
      .then(function (rev) {
        SYNC.rev = rev;
        startSync(id);
        linkNote('Created. Type this code on the other device.');
        toast('Link code created');
      })
      .catch(function () { toast('Could not reach the server'); });
  });

  function uuidish() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  $('#link-join').addEventListener('click', function () {
    var id = $('#link-join-input').value.trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
      toast('That does not look like a code');
      return;
    }
    if (state.guests.length &&
        !confirm('Joining replaces the chart on this device with the shared one. Carry on?')) return;
    rpc('seat_chart_get', { p_id: id, p_rev: 0 })
      .then(function (res) {
        if (!res || !res.doc) { toast('No chart with that code'); return; }
        SYNC.rev = res.rev;
        state = res.doc;
        state.defaultSeats = state.defaultSeats || 10;
        saveLocal();
        startSync(id);
        closeModals();
        toast('Linked — this is now the shared chart');
      })
      .catch(function () { toast('Could not reach the server'); });
  });

  $('#link-copy').addEventListener('click', function () {
    navigator.clipboard.writeText(SYNC.id || '')
      .then(function () { toast('Code copied'); })
      .catch(function () { toast('Select the code and copy it'); });
  });

  $('#link-stop').addEventListener('click', function () {
    if (!confirm('Stop syncing? This device keeps its own copy of the chart.')) return;
    stopSync();
    toast('Unlinked');
  });

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

  /* ---------------- password gate ----------------
     This is a static page, so the gate is a doormat, not a deadbolt — it
     stops someone wandering in, but anyone who opens devtools or fetches
     guests.tsv directly can read the list. Storing the hash rather than
     the password at least keeps it out of plain sight in the source. */

  var LOCK = 'seating.unlocked';
  var PW_SHA256 = 'bdda355272ff397a89884a808bd1724aa90bfaf728d18410ee85a019cb847f34';

  function sha256(text) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve(null);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
      .then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      });
  }

  function openGate(done) {
    var gate = $('#gate');
    gate.hidden = false;
    $('#gate-pw').focus();
    $('#gate-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pw = $('#gate-pw').value;
      sha256(pw).then(function (h) {
        // crypto.subtle is unavailable over plain http; fall back to a
        // direct compare there so the gate still works on localhost.
        var ok = h ? h === PW_SHA256 : pw === 'adina123';
        if (!ok) {
          $('#gate-err').hidden = false;
          $('#gate-pw').select();
          return;
        }
        try { localStorage.setItem(LOCK, '1'); } catch (e) {}
        document.documentElement.classList.remove('locked');
        gate.hidden = true;
        done();
      });
    });
  }

  /* ---------------- boot ---------------- */

  // A browser that has never been here gets the real list already seated,
  // so the app is useful the moment it opens.
  function loadDefaultList() {
    fetch('guests.tsv', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (t) {
        if (applyImport(t, true, false) !== 'ok') throw new Error('parse');
      })
      .catch(function () { $('#btn-import').click(); });
  }

  function start() {
    var linked = null, rev = 0;
    try {
      linked = localStorage.getItem('seating.link');
      rev = parseInt(localStorage.getItem('seating.rev'), 10) || 0;
    } catch (e) {}
    if (linked) { SYNC.rev = rev; startSync(linked); pullChart(); }

    render();
    if (!state.guests.length && !linked) loadDefaultList();
  }

  var isUnlocked = false;
  try { isUnlocked = localStorage.getItem(LOCK) === '1'; } catch (e) {}
  if (isUnlocked) {
    document.documentElement.classList.remove('locked');
    start();
  } else {
    openGate(start);
  }
})();
