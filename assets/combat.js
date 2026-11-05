/* Hosted combat. combat/index.html (host or join) and combat/room.html?id=...
   Needs supabase/05_combat.sql. Characters bring a snapshot from
   assets/forge.js (TerranaCharacter.combatKit) when they join. */

(function () {
  var A = window.Terrana.auth, db = A.client;
  var $ = function (id) { return document.getElementById(id); };
  var page = document.body.getAttribute('data-combat');
  var me = null;

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'class') e.className = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  async function must(q) { var r = await q; if (r.error) throw r.error; return r.data; }
  function oops(e) { return A.friendly(e); }
  function say(id, t, ok) { var m = $(id); if (!m) return; m.textContent = t || ''; m.classList.toggle('ok', !!ok); }
  function opt(v, t, sel) { var o = el('option', { value: String(v), text: t }); if (sel) o.selected = true; return o; }
  function field(label, input) { var id = input.id || ('f' + Math.random().toString(36).slice(2, 8)); input.id = id; return el('div', {}, [el('label', { for: id, text: label }), input]); }
  function num(id, v, min, max) { return el('input', { id: id, type: 'number', value: String(v), min: String(min), max: String(max), step: '1' }); }
  function loadScript(src) { return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.body.appendChild(s); }); }

  // ---------- dice ----------
  function d10s(n) {
    n = Math.max(0, Math.min(60, n | 0));
    var a = new Uint32Array(n), out = [];
    if (n) crypto.getRandomValues(a);
    for (var i = 0; i < n; i++) out.push(1 + (a[i] % 10));
    return out;
  }
  function successes(dice) { return dice.reduce(function (s, d) { return s + (d === 10 ? 2 : d >= 6 ? 1 : 0); }, 0); }
  // Wound penalties, cumulative across damage types (the sheet's health track)
  function woundPenalty(c) {
    var h = c.health || {}, p = 0;
    var bx = c.boxes || { b: 7, l: 5, a: 3 };
    // only the last three boxes of each track carry a penalty: -1, -2, -4
    ['b', 'l', 'a'].forEach(function (k) { var n = Math.min(h[k] || 0, bx[k] || 0), tot = bx[k] || 0; if (n > tot - 3 && n > 0) p += [1, 2, 4][n - (tot - 3) - 1]; });
    return p;
  }
  function incap(c) { var h = c.health || {}, b = c.boxes || {}; return (h.a || 0) >= (b.a || 3); }

  // "Dexterity + Magic + Fire dots" against a character's combat kit
  function evalPool(str, kit, spell) {
    var parts = [], unknown = [];
    if (!str) return { total: 0, parts: [], unknown: ['no dice pool listed'] };
    var cap = /cap at lowest|lowest dots among/i.test(str) && spell && spell.schools ? Math.min.apply(null, spell.schools.map(function (s) { return (kit.dots || {})[s] || 0; })) : null;
    str.replace(/\(.*?\)/g, '').split('+').forEach(function (raw) {
      var t = raw.trim().replace(/\s+dots?$/i, '').trim();
      if (!t) return;
      if (/lowest dots among combined schools/i.test(t)) { parts.push(['Lowest school', cap || 0]); return; }
      var v = null;
      if (kit.attrs && t in kit.attrs) v = kit.attrs[t];
      else if (kit.abilities && t in kit.abilities) v = kit.abilities[t];
      else if (kit.dots && t in kit.dots) v = kit.dots[t];
      else if (kit.dots && (t + ' Magic') in kit.dots) v = kit.dots[t + ' Magic'];
      else if (/^heritage$/i.test(t) && kit.dots) v = kit.dots.Heritage || 0;
      if (v === null) { unknown.push(t); v = 0; }
      if (cap !== null && spell && spell.schools && spell.schools.indexOf(t) >= 0) v = Math.min(v, cap);
      parts.push([t, v]);
    });
    return { total: parts.reduce(function (s, p) { return s + p[1]; }, 0), parts: parts, unknown: unknown };
  }

  // ---------- list page ----------
  async function listPage(main) {
    main.appendChild(el('section', { class: 'panel win' }, [el('h1', { text: 'Combat' }),
      el('p', { class: 'center', text: 'Host a fight as the Storyteller, or tap an active fight to join it. Public fights let anyone in; private ones need the code from their Storyteller. Everyone sees the map, turn order, health, and every roll live.' })]));
    // Host
    var hostBox;
    if (me) {
      var nm = el('input', { id: 'enc-name', maxlength: '80', placeholder: 'Goblin Ambush' });
      var vis = el('div', { class: 'cb-vis', role: 'radiogroup', 'aria-label': 'Who can join' }, [
        el('label', {}, [el('input', { type: 'radio', name: 'enc-vis', value: 'public', checked: true }), el('span', {}, [el('b', { text: 'Public' }), el('small', { text: 'Anyone can tap it to join.' })])]),
        el('label', {}, [el('input', { type: 'radio', name: 'enc-vis', value: 'private' }), el('span', {}, [el('b', { text: 'Private' }), el('small', { text: 'Players need your join code.' })])])]);
      var size = el('select', { id: 'enc-size' }, [opt('5x7', '5 x 7 zones'), opt('6x8', '6 x 8 zones', true), opt('7x9', '7 x 9 zones'), opt('10x10', '10 x 10 zones'), opt('custom', 'Custom...')]);
      var cols = num('enc-cols', 8, 3, 20), rows = num('enc-rows', 8, 3, 20);
      var custom = el('div', { class: 'two', hidden: true }, [field('Columns', cols), field('Rows', rows)]);
      size.addEventListener('change', function () { custom.hidden = size.value !== 'custom'; });
      var theme = el('select', { id: 'enc-theme' }, [opt('dark', 'Dark', true), opt('light', 'Light')]);
      var hf = el('form', { class: 'cb-f' }, [field('Encounter name', nm), vis, el('div', { class: 'two' }, [field('Map size', size), field('Map look', theme)]), custom,
        el('div', {}, [el('button', { class: 'act primary', type: 'submit', text: 'Start Encounter' })]), el('p', { class: 'cb-msg', id: 'host-msg', role: 'alert' })]);
      hf.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var n = nm.value.trim() || 'Encounter';
        var c = 6, r = 8;
        if (size.value === 'custom') { c = Math.max(3, Math.min(20, +cols.value || 8)); r = Math.max(3, Math.min(20, +rows.value || 8)); }
        else { var p = size.value.split('x'); c = +p[0]; r = +p[1]; }
        var pub = (hf.querySelector('input[name=enc-vis]:checked') || {}).value !== 'private';
        try {
          var row = await must(db.from('encounters').insert({ host: me.id, name: n, public: pub, map: { cols: c, rows: r, theme: theme.value } }).select().single());
          location.href = 'room.html?id=' + encodeURIComponent(row.id);
        } catch (e) { say('host-msg', oops(e)); }
      });
      hostBox = el('section', { class: 'panel win' }, [el('h2', { text: 'Host a Fight' }), hf]);
    } else hostBox = el('section', { class: 'panel win' }, [el('h2', { text: 'Host a Fight' }), el('p', { class: 'center', text: 'Log in to host or join a fight.' }),
      el('div', { class: 'button-row center-row' }, [el('a', { class: 'act primary', href: '../account/index.html?next=combat/index.html', text: 'Log In' })])]);
    // Active fights
    var tiles = el('div', { class: 'cb-tiles', 'aria-live': 'polite' });
    var code = el('input', { id: 'join-code', maxlength: '6', autocomplete: 'off', placeholder: 'ABC123', style: 'text-transform:uppercase', 'aria-label': 'Join code' });
    async function joinCode(v, msgId) {
      try { var r = await db.rpc('join_encounter', { join_code: v }); if (r.error) throw r.error; location.href = 'room.html?id=' + encodeURIComponent(r.data); }
      catch (e) { say(msgId, oops(e)); }
    }
    var jf = el('form', { class: 'cb-codebar' }, [el('label', { for: 'join-code', text: 'Have a code?' }), code, el('button', { class: 'act', type: 'submit', text: 'Join', disabled: !me })]);
    jf.addEventListener('submit', function (ev) { ev.preventDefault(); joinCode(code.value.trim(), 'join-msg'); });
    async function drawTiles() {
      var r = await db.rpc('list_encounters');
      if (r.error) throw r.error;
      tiles.textContent = '';
      (r.data || []).forEach(function (e, i) {
        var msg = 'tile-msg-' + i;
        var t = el('div', { class: 'cb-tile' + (e.is_public ? ' pub' : ' priv') + (e.mine ? ' mine' : '') });
        var codeIn = el('input', { maxlength: '6', placeholder: 'Code', autocomplete: 'off', style: 'text-transform:uppercase', 'aria-label': 'Code for ' + e.name });
        var codeRow = el('form', { class: 'cb-tile-code', hidden: true }, [codeIn, el('button', { class: 'act small primary', type: 'submit', text: 'Enter' })]);
        codeRow.addEventListener('submit', function (ev) { ev.preventDefault(); joinCode(codeIn.value.trim(), msg); });
        var btn = el('button', { type: 'button', class: 'cb-tile-btn', 'aria-label': (e.mine ? 'Open ' : 'Join ') + e.name, onclick: async function () {
          if (!me) { location.href = '../account/index.html?next=combat/index.html'; return; }
          if (e.mine) { location.href = 'room.html?id=' + encodeURIComponent(e.id); return; }
          if (!e.is_public) { codeRow.hidden = false; codeIn.focus(); return; }
          try { var j = await db.rpc('join_public_encounter', { e: e.id }); if (j.error) throw j.error; location.href = 'room.html?id=' + encodeURIComponent(j.data); }
          catch (er) { say(msg, oops(er)); }
        } }, [el('img', { src: '../assets/icons/crossed-swords.svg', alt: '', class: 'cb-tile-icon' }), el('b', { text: e.name }),
          el('small', { text: 'Storyteller: ' + (e.host_name || '?') }), el('small', { text: e.players + ' player' + (e.players === 1 ? '' : 's') + ' joined' }),
          el('span', { class: 'cb-tile-tag', text: e.mine ? 'You are in' : e.is_public ? 'Public' : 'Private: code' })]);
        t.appendChild(btn); t.appendChild(codeRow); t.appendChild(el('p', { class: 'cb-msg', id: msg, role: 'alert' }));
        tiles.appendChild(t);
      });
      if (!tiles.children.length) tiles.appendChild(el('p', { class: 'center cv-muted', text: 'No fights going right now. Host one!' }));
    }
    main.appendChild(el('div', { class: 'cb-listgrid' }, [hostBox,
      el('section', { class: 'panel win' }, [el('h2', { text: 'Active Fights' }), tiles, jf, el('p', { class: 'cb-msg', id: 'join-msg', role: 'alert' })])]));
    await drawTiles();
    setInterval(function () { if (!document.hidden && !tiles.querySelector('.cb-tile-code:not([hidden])')) drawTiles().catch(function () {}); }, 15000);
    if (!me) return;
    // Mine
    var hosted = await must(db.from('encounters').select('id, name, code, created_at, host, open, public').eq('host', me.id).order('created_at', { ascending: false }));
    var joined = await must(db.from('encounter_players').select('encounter_id').eq('player', me.id));
    var jids = joined.map(function (j) { return j.encounter_id; }).filter(function (x) { return !hosted.some(function (h) { return h.id === x; }); });
    var jenc = jids.length ? await must(db.from('encounters').select('id, name, code, created_at, host').in('id', jids)) : [];
    var list = el('ul', { class: 'cb-encs' });
    hosted.concat(jenc).forEach(function (e) {
      list.appendChild(el('li', {}, [el('span', {}, [el('strong', { text: e.name }), ' ', el('span', { class: 'cv-muted', text: e.host === me.id ? '(you host, ' + (e.public ? 'public' : 'private') + ', code ' + e.code + (e.open ? '' : ', joining closed') + ')' : '(joined)' })]),
        el('a', { class: 'act primary', href: 'room.html?id=' + encodeURIComponent(e.id), text: 'Open' })]));
    });
    main.appendChild(el('section', { class: 'panel win' }, [el('h2', { text: 'Your Encounters' }), list.children.length ? list : el('p', { class: 'center cv-muted', text: 'None yet.' })]));
  }

  // ---------- room ----------
  var R = { enc: null, players: {}, cs: {}, rolls: [], host: false, sel: null, tab: 'spells', moving: null, data: null };
  var CONDS = ['Bleeding', 'Blinded', 'Burning', 'Chilled', 'Exhausted', 'Grappled', 'Petrified', 'Poisoned', 'Prone', 'Rooted'];
  function mineC(c) { return c && (c.owner === me.id || R.host); }
  function list() { return Object.keys(R.cs).map(function (k) { return R.cs[k]; }); }
  function order() {
    var o = ((R.enc.state || {}).order || []).filter(function (id) { return R.cs[id]; });
    var rest = list().filter(function (c) { return o.indexOf(c.id) < 0; }).sort(function (a, b) { return b.initiative - a.initiative || a.name.localeCompare(b.name); });
    return o.map(function (id) { return R.cs[id]; }).concat(rest);
  }
  function current() { var o = ((R.enc.state || {}).order || []).filter(function (id) { return R.cs[id]; }); var t = (R.enc.state || {}).turn || 0; return o.length ? R.cs[o[t % o.length]] : null; }
  async function upd(c, patch) {
    Object.assign(c, patch);
    drawAll();
    var r = await db.from('combatants').update(patch).eq('id', c.id);
    if (r.error) { alert(oops(r.error)); refresh(); }
  }
  // Add a roll or note to the log now, without waiting for the live update
  async function addRoll(row) {
    var r = await must(db.from('rolls').insert(Object.assign({ encounter_id: R.enc.id, roller: me.id }, row)).select().single());
    if (r && !R.rolls.some(function (x) { return x.id === r.id; })) R.rolls.unshift(r);
    drawLog();
    return r;
  }
  async function note(text, extra) { return addRoll({ label: text, detail: Object.assign({ kind: 'note' }, extra || {}) }); }

  async function refresh() {
    var id = R.enc.id;
    R.enc = await must(db.from('encounters').select('*').eq('id', id).single());
    var cs = await must(db.from('combatants').select('*').eq('encounter_id', id));
    R.cs = {}; cs.forEach(function (c) { R.cs[c.id] = c; });
    R.rolls = await must(db.from('rolls').select('*').eq('encounter_id', id).order('created_at', { ascending: false }).limit(80));
    var ps = await must(db.from('encounter_players').select('player').eq('encounter_id', id));
    var ids = ps.map(function (p) { return p.player; }).concat([R.enc.host]);
    var prof = await must(db.from('profiles').select('id, username').in('id', ids));
    R.players = {}; prof.forEach(function (p) { R.players[p.id] = p.username; });
    drawAll();
  }
  function live() {
    var id = R.enc.id;
    var ch = db.channel('enc-' + id);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'combatants', filter: 'encounter_id=eq.' + id }, function (p) {
      if (p.eventType === 'DELETE') delete R.cs[(p.old || {}).id]; else R.cs[p.new.id] = p.new;
      drawAll();
    }).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rolls', filter: 'encounter_id=eq.' + id }, function (p) {
      if (!R.rolls.some(function (r) { return r.id === p.new.id; })) R.rolls.unshift(p.new);
      drawLog();
    }).on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rolls' }, function () { refresh(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'encounters', filter: 'id=eq.' + id }, function (p) { R.enc = p.new; drawAll(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'encounters', filter: 'id=eq.' + id }, function () { location.href = 'index.html'; })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'encounter_players', filter: 'encounter_id=eq.' + id }, function () { refresh(); })
      .subscribe();
    // a slow safety net in case a live update is missed
    setInterval(function () { if (!document.hidden && !document.querySelector('dialog[open]')) refresh().catch(function () {}); }, 20000);
  }

  function drawAll() { drawTop(); drawMap(); drawTracker(); drawActions(); drawLog(); }

  function drawTop() {
    var t = $('cb-top'); t.textContent = '';
    var st = R.enc.state || {}, cur = current();
    t.appendChild(el('div', {}, [el('h1', { class: 'px', text: R.enc.name }),
      el('div', { class: 'cb-sub' }, ['Storyteller: ' + (R.players[R.enc.host] || '') + '. Join code ', el('span', { class: 'cb-code', text: R.enc.code })])]));
    var bar = el('div', { class: 'cb-bar' }, [el('span', { class: 'cb-round', text: 'Round ' + (st.round || 1) + (cur ? ': ' + cur.name + '’s turn' : '') })]);
    if (R.host) {
      bar.appendChild(el('button', { class: 'act', type: 'button', text: 'Set Turn Order', onclick: setOrder }));
      bar.appendChild(el('button', { class: 'act primary', type: 'button', text: 'Next Turn', onclick: nextTurn }));
      bar.appendChild(el('button', { class: 'act', type: 'button', text: 'Add NPC', onclick: npcDialog }));
      bar.appendChild(el('button', { class: 'act', type: 'button', text: 'Map', onclick: mapDialog }));
      bar.appendChild(el('button', { class: 'act', type: 'button', text: R.enc.open ? 'Close Joining' : 'Open Joining', onclick: function () { db.from('encounters').update({ open: !R.enc.open }).eq('id', R.enc.id).then(refresh); } }));
      bar.appendChild(el('button', { class: 'act', type: 'button', text: R.enc.public ? 'Make Private' : 'Make Public', title: R.enc.public ? 'Players will need the join code' : 'Anyone can join from the Combat page', onclick: function () { db.from('encounters').update({ public: !R.enc.public }).eq('id', R.enc.id).then(refresh); } }));
      bar.appendChild(el('button', { class: 'act', type: 'button', text: 'End', onclick: async function () {
        if (!confirm('End this encounter for everyone? Its map, combatants, and log are deleted.')) return;
        await db.from('encounters').delete().eq('id', R.enc.id); location.href = 'index.html';
      } }));
    } else {
      bar.appendChild(el('button', { class: 'act', type: 'button', text: 'Leave', onclick: async function () {
        if (!confirm('Leave this encounter? Your combatants are removed.')) return;
        await db.from('combatants').delete().eq('encounter_id', R.enc.id).eq('owner', me.id);
        await db.from('encounter_players').delete().eq('encounter_id', R.enc.id).eq('player', me.id);
        location.href = 'index.html';
      } }));
    }
    bar.appendChild(el('button', { class: 'act', type: 'button', text: 'Bring a Character', onclick: bringDialog }));
    t.appendChild(bar);
  }

  function drawMap() {
    var m = R.enc.map || {}, cols = m.cols || 6, rows = m.rows || 8;
    var wrap = $('cb-map'); wrap.textContent = '';
    var size = Math.max(40, Math.min(72, Math.floor((wrap.clientWidth - 40) / cols) - 3));
    var grid = el('div', { class: 'cb-map ' + (m.theme === 'light' ? 'light' : 'dark'), role: 'grid', 'aria-label': 'Battle map, ' + cols + ' by ' + rows + ' zones', style: 'grid-template-columns:repeat(' + cols + ', var(--z));--z:' + size + 'px' });
    var at = {}; list().forEach(function (c) { if (c.x !== null && c.x !== undefined && c.y !== null) at[c.x + ',' + c.y] = c; });
    var cur = current(), mover = R.moving ? R.cs[R.moving] : null;
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) (function (x, y) {
      var c = at[x + ',' + y];
      var label = String.fromCharCode(65 + x) + (y + 1);
      var z = el('button', { type: 'button', class: 'cb-zone' + (mover && !c ? ' target' : ''), 'aria-label': 'Zone ' + label + (c ? ': ' + c.name : ', empty') }, [el('span', { class: 'lab', text: label })]);
      if (c) {
        var tok = el('span', { class: 'cb-token ' + c.side + (R.sel === c.id ? ' sel' : '') + (cur && cur.id === c.id ? ' turn' : '') + (incap(c) ? ' down' : '') + (c.hidden ? ' hid' : ''), text: c.pic_url ? '' : initials(c.name) });
        if (c.pic_url) tok.style.backgroundImage = 'url("' + c.pic_url.replace(/"/g, '') + '")';
        z.appendChild(tok);
      }
      z.addEventListener('click', function () {
        if (c) { R.sel = c.id; R.moving = mineC(c) ? c.id : null; drawAll(); return; }
        if (mover && mineC(mover)) { R.moving = null; upd(mover, { x: x, y: y }); }
      });
      grid.appendChild(z);
    })(x, y);
    wrap.appendChild(grid);
    var hint = mover ? 'Moving ' + mover.name + ': pick an empty zone. Pick the token again to cancel.' : 'Pick your token, then an empty zone, to move it.';
    var unplaced = list().filter(function (c) { return (c.x === null || c.x === undefined) && mineC(c); });
    wrap.appendChild(el('p', { class: 'cb-maphint', text: hint + (unplaced.length ? ' Not on the map yet: ' + unplaced.map(function (c) { return c.name; }).join(', ') + ' (pick it in the list, then a zone).' : '') }));
  }
  function initials(n) { return n.split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 3).toUpperCase(); }

  function boxesRow(c, k, label) {
    var n = (c.boxes || {})[k] || 0, h = (c.health || {})[k] || 0, can = mineC(c);
    var row = el('span', { class: 'cb-boxes', role: 'group', 'aria-label': label + ' ' + h + ' of ' + n });
    for (var i = 0; i < n; i++) (function (i) {
      row.appendChild(el('button', { type: 'button', class: 'cb-box ' + k + (i < h ? ' on' : ''), disabled: !can, 'aria-label': label + ' box ' + (i + 1), onclick: function () {
        var next = i < h && i === h - 1 ? i : i + 1;
        var hh = Object.assign({}, c.health); hh[k] = next;
        var stats = Object.assign({}, c.stats || {}); if (next > h) stats.hurt = true;
        upd(c, { health: hh, stats: stats });
      } }));
    })(i);
    return row;
  }
  function stepper(c, key, max, label) {
    var can = mineC(c);
    var inp = el('input', { type: 'number', value: String(c[key]), min: '0', max: String(max), 'aria-label': label, disabled: !can });
    inp.addEventListener('change', function () { var v = Math.max(0, Math.min(max, +inp.value || 0)); var p = {}; p[key] = v; upd(c, p); });
    return el('span', { class: 'cb-num' }, [
      can ? el('button', { type: 'button', text: '-', 'aria-label': 'Lower ' + label, onclick: function () { var p = {}; p[key] = Math.max(0, c[key] - 1); upd(c, p); } }) : null,
      inp,
      can ? el('button', { type: 'button', text: '+', 'aria-label': 'Raise ' + label, onclick: function () { var p = {}; p[key] = Math.min(max, c[key] + 1); upd(c, p); } }) : null]);
  }
  function drawTracker() {
    var t = $('cb-tracker'); t.textContent = '';
    var cur = current();
    var listEl = el('div', { class: 'cb-list' });
    order().forEach(function (c) {
      var can = mineC(c), bdt = c.bdt || 1;
      var head = el('div', { class: 'cb-c-head' }, [
        el('button', { class: 'cb-c-name', type: 'button', onclick: function () { R.sel = c.id; R.moving = can ? c.id : null; drawAll(); } }, [el('span', { class: 'cb-side ' + c.side }), c.name]),
        el('span', { class: 'cb-sub' }, ['Init ', R.host ? el('input', { type: 'number', value: String(c.initiative), style: 'width:52px', 'aria-label': 'Initiative for ' + c.name, onchange: function (e) { upd(c, { initiative: +e.target.value || 0 }); } }) : String(c.initiative)])
      ]);
      var sub = el('div', { class: 'cb-sub', text: (c.kind === 'pc' ? 'Played by ' + (R.players[c.owner] || '') : c.kind === 'summon' ? 'SumMonz of ' + (R.players[c.owner] || '') : 'NPC') + (c.hidden ? ' (hidden from players)' : '') + '. BDT ' + bdt + ', LDT ' + bdt * 2 + ', ADT ' + bdt * 3 + '.' });
      var ap = el('span', { class: 'cb-boxes' });
      for (var i = 0; i < 3; i++) (function (i) {
        ap.appendChild(el('button', { type: 'button', class: 'cb-box ap' + (i < c.ap ? ' on' : ''), disabled: !can, 'aria-label': 'AP ' + (i + 1), onclick: function () { upd(c, { ap: i < c.ap && i === c.ap - 1 ? i : i + 1 }); } }));
      })(i);
      var tracks = el('div', { class: 'cb-tracks' }, [
        el('div', { class: 'cb-track' }, [el('span', { text: 'Bashing' }), boxesRow(c, 'b', 'Bashing')]),
        el('div', { class: 'cb-track' }, [el('span', { text: 'Lethal' }), boxesRow(c, 'l', 'Lethal')]),
        el('div', { class: 'cb-track' }, [el('span', { text: 'Aggravated' }), boxesRow(c, 'a', 'Aggravated'), incap(c) ? el('span', { class: 'cb-incap', text: 'INCAPACITATED' }) : null]),
        el('div', { class: 'cb-track' }, [el('span', { text: 'AP' }), ap]),
        el('div', { class: 'cb-track' }, [el('span', { text: 'Mana' }), stepper(c, 'mana', 999, 'Mana'), el('span', { class: 'cb-sub', text: 'of ' + c.mana_max + ', M/T ' + c.mt })]),
        el('div', { class: 'cb-track' }, [el('span', { text: 'Willpower' }), stepper(c, 'willpower', 10, 'Willpower')])
      ]);
      var conds = el('div', { class: 'cb-conds' });
      (c.conditions || []).forEach(function (cd) {
        conds.appendChild(el('button', { type: 'button', class: 'cb-cond', disabled: !can, title: can ? 'Remove' : null, text: cd + (can ? ' x' : ''), onclick: function () { upd(c, { conditions: (c.conditions || []).filter(function (x) { return x !== cd; }) }); } }));
      });
      if (can) {
        var add = el('select', { 'aria-label': 'Add a condition to ' + c.name }, [opt('', '+ Condition')]);
        CONDS.forEach(function (cd) { if ((c.conditions || []).indexOf(cd) < 0) add.appendChild(opt(cd, cd)); });
        add.addEventListener('change', function () { if (add.value) upd(c, { conditions: (c.conditions || []).concat([add.value]) }); });
        conds.appendChild(add);
      }
      var extra = el('div', { class: 'cb-bar', style: 'margin-top:6px' });
      if (can) {
        if (c.x !== null && c.x !== undefined) extra.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Off Map', onclick: function () { upd(c, { x: null, y: null }); } }));
        if (R.host && c.kind === 'npc') extra.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: c.hidden ? 'Reveal' : 'Hide', onclick: function () { upd(c, { hidden: !c.hidden }); } }));
        if (c.character_id && c.owner === me.id) extra.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Refresh Stats', onclick: function () { resync(c); } }));
        extra.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Remove', onclick: async function () { if (confirm('Remove ' + c.name + ' from the fight?')) { delete R.cs[c.id]; drawAll(); await db.from('combatants').delete().eq('id', c.id); } } }));
      }
      listEl.appendChild(el('div', { class: 'cb-c' + (cur && cur.id === c.id ? ' turn' : '') + (R.sel === c.id ? ' sel' : '') }, [head, sub, tracks, conds, extra]));
    });
    if (!listEl.children.length) listEl.appendChild(el('p', { class: 'cv-muted', text: 'Nobody here yet. Bring a character, or the Storyteller can add NPCs.' }));
    var players = Object.keys(R.players).map(function (k) { return R.players[k] + (k === R.enc.host ? ' (Storyteller)' : ''); });
    t.appendChild(el('h2', { class: 'px', style: 'margin-top:0', text: 'Turn Order' }));
    t.appendChild(listEl);
    t.appendChild(el('p', { class: 'cb-sub', style: 'margin-top:10px', text: 'At the table: ' + players.join(', ') }));
  }

  async function setOrder() {
    var o = list().slice().sort(function (a, b) { return b.initiative - a.initiative || a.name.localeCompare(b.name); }).map(function (c) { return c.id; });
    var st = Object.assign({}, R.enc.state, { order: o, turn: 0, round: (R.enc.state || {}).round || 1 });
    R.enc.state = st; drawAll();
    await must(db.from('encounters').update({ state: st }).eq('id', R.enc.id));
    var first = R.cs[o[0]];
    if (first) { await upkeep(first); await note('Turn order set. Round ' + st.round + ': ' + first.name + ' goes first.'); }
  }
  // Upkeep: regain 1 AP (2 if hurt since your last turn), recover mana by Mana dots
  async function upkeep(c) {
    var s = c.stats || {}, regen = (s.mana && s.mana.regen) || s.regen || 1;
    var patch = { ap: Math.min(3, (c.ap || 0) + (s.hurt ? 2 : 1)), mana: Math.min(c.mana_max || 0, (c.mana || 0) + regen), stats: Object.assign({}, s, { hurt: false }) };
    await upd(c, patch);
    var conds = (c.conditions || []).filter(function (x) { return ['Bleeding', 'Burning', 'Poisoned'].indexOf(x) >= 0; });
    return conds;
  }
  async function nextTurn() {
    var st = Object.assign({ round: 1, turn: 0, order: [] }, R.enc.state);
    st.order = (st.order || []).filter(function (id) { return R.cs[id]; });
    if (!st.order.length) { await setOrder(); return; }
    st.turn = (st.turn || 0) + 1;
    if (st.turn >= st.order.length) { st.turn = 0; st.round = (st.round || 1) + 1; }
    R.enc.state = st; drawAll();
    await must(db.from('encounters').update({ state: st }).eq('id', R.enc.id));
    var c = R.cs[st.order[st.turn]];
    if (!c) return;
    var conds = await upkeep(c);
    await note('Round ' + st.round + ': ' + c.name + '’s turn. Upkeep: AP ' + c.ap + ', mana ' + c.mana + '.' + (conds.length ? ' Roll for ' + conds.join(', ') + '.' : '') + (incap(c) ? ' ' + c.name + ' is Incapacitated.' : ''));
  }

  // ---------- bring a character / NPCs ----------
  async function ensureForge() {
    if (window.TerranaCharacter) return;
    window.FORGE_HEADLESS = true;
    await loadScript('../assets/forge.js?v=fa6ce042');
    R.data = R.data || await fetch('../forge/data.json?v=1863d047').then(function (r) { return r.json(); });
  }
  async function kitFor(row) {
    await ensureForge();
    R.data = R.data || await fetch('../forge/data.json?v=1863d047').then(function (r) { return r.json(); });
    window.TerranaCharacter.load(R.data, row, { username: me.username, is_admin: !!me.is_admin });
    return window.TerranaCharacter.combatKit();
  }
  function fromKit(k) {
    return { ap: 3, boxes: k.boxes || { b: 7, l: 5, a: 3 }, initiative: k.initiative, bdt: k.bdt, mana: k.mana.pool, mana_max: k.mana.pool, mt: k.mana.mt, willpower: k.willpower, stats: k };
  }
  async function bringDialog() {
    var chars = await must(db.from('characters').select('id, name, sheet').eq('owner', me.id).order('created_at', { ascending: true }));
    chars = chars.filter(function (c) { return c.sheet && c.sheet.build; });
    var d = dialog('Bring a Character');
    if (!chars.length) { d.body.appendChild(el('p', { text: 'Make a character in the Forge first.' })); d.open(); return; }
    var sel = el('select', { id: 'bring-char' }); chars.forEach(function (c) { sel.appendChild(opt(c.id, c.name)); });
    var summon = el('input', { type: 'checkbox', id: 'bring-summon' });
    d.body.appendChild(el('div', { class: 'cb-f' }, [field('Character', sel),
      el('label', { class: 'chk', for: 'bring-summon' }, [summon, 'Also bring their first SumMonz or familiar']),
      el('p', { class: 'cb-desc', text: 'Your character joins with their stats, spells, and maneuvers from the Forge, with a full mana pool.' }),
      el('p', { class: 'cb-msg', id: 'bring-msg', role: 'alert' })]));
    d.ok('Bring Them', async function () {
      var row = chars.filter(function (c) { return c.id === sel.value; })[0];
      var k = await kitFor(row);
      var cp = await db.from('character_pages').select('pic_url').eq('id', row.id).maybeSingle();
      var pic = (cp && cp.data && /^https:\/\//.test(cp.data.pic_url || '')) ? cp.data.pic_url : '';
      await must(db.from('combatants').insert(Object.assign({ encounter_id: R.enc.id, owner: me.id, character_id: row.id, name: row.name, kind: 'pc', side: 'party', pic_url: pic }, fromKit(k))));
      if (summon.checked) {
        var b = row.sheet.build, comp = (b.starter_summon && b.starter_summon.name) ? b.starter_summon : b.familiar;
        if (comp) await must(db.from('combatants').insert({ encounter_id: R.enc.id, owner: me.id, name: comp.name || 'SumMonz', kind: 'summon', side: 'party', ap: 3, initiative: k.initiative, bdt: 3,
          boxes: { b: 3, l: 2, a: 1 }, mana: 3, mana_max: 3, mt: 2, stats: { npc: true, attack: 4, defense: 4, damage: 3, regen: 1, notes: 'Rank F: Attack 4, Defense 4, Damage 3, BDT 3, Health 3 / 2 / 1, Mana 3, M/T 2, Move 1' } }));
      }
      await refresh();
    });
    d.open();
  }
  async function resync(c) {
    var row = await must(db.from('characters').select('id, name, sheet').eq('id', c.character_id).single());
    var k = await kitFor(row);
    var f = fromKit(k);
    await upd(c, { stats: Object.assign({}, k, { hurt: (c.stats || {}).hurt }), bdt: f.bdt, boxes: f.boxes, mana_max: f.mana_max, mt: f.mt, initiative: f.initiative, name: row.name });
  }
  // ---------- NPCs: pick from the Chapter 15 Bestiary, adjust, add ----------
  var BESTIARY = null;
  var RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
  var RANK_STATS = { F: [4, 3, 3, [3, 2, 1], 3, 2], E: [6, 4, 4, [4, 3, 2], 6, 3], D: [8, 5, 5, [5, 4, 3], 9, 4], C: [10, 6, 6, [6, 5, 4], 12, 5], B: [12, 7, 7, [7, 6, 5], 15, 6],
    A: [14, 8, 8, [8, 7, 6], 18, 7], S: [16, 9, 9, [9, 8, 7], 21, 8], SS: [20, 12, 12, [12, 11, 10], 30, 12], SSS: [25, 15, 15, [15, 14, 13], 45, 15] };
  async function bestiary() { if (!BESTIARY) BESTIARY = await fetch('bestiary.json?v=c9331b6c').then(function (r) { return r.json(); }); return BESTIARY; }
  function pickCreature(done) {
    var d = dialog('Choose from the Bestiary');
    var q = el('input', { type: 'search', placeholder: 'Search by name, type, or element', 'aria-label': 'Search the Bestiary' });
    var sec = el('select', { 'aria-label': 'Section' }, [opt('', 'Every section', true)]);
    var list = el('div', { class: 'cb-best', role: 'listbox', 'aria-label': 'Creatures' });
    d.body.appendChild(el('div', { class: 'cb-f' }, [el('div', { class: 'two' }, [q, sec]), list]));
    bestiary().then(function (all) {
      var seen = {}; all.forEach(function (c) { if (!seen[c.section]) { seen[c.section] = 1; sec.appendChild(opt(c.section, c.section)); } });
      function draw() {
        list.textContent = '';
        var t = q.value.trim().toLowerCase();
        all.filter(function (c) { return (!sec.value || c.section === sec.value) && (!t || (c.name + ' ' + (c.tags || []).join(' ') + ' ' + c.section).toLowerCase().indexOf(t) >= 0); }).forEach(function (c) {
          list.appendChild(el('button', { type: 'button', class: 'cb-best-row', role: 'option', onclick: function () { d.close(); d.el.remove(); done(c); } }, [
            el('span', { class: 'cb-best-rank', text: c.rank || '?' }),
            el('span', {}, [el('b', { text: c.name }), el('small', { text: [c.type, c.size, c.elements && c.elements !== 'None' ? c.elements : '', c.section].filter(Boolean).join(' · ') })]),
            el('span', { class: 'cb-best-num', text: 'A' + (c.attack || 0) + ' D' + (c.defense || 0) + ' Dmg' + (c.damage || 0) })]));
        });
        if (!list.children.length) list.appendChild(el('p', { class: 'cv-muted', text: 'Nothing matches.' }));
      }
      q.addEventListener('input', draw); sec.addEventListener('change', draw); draw(); q.focus();
    });
    d.ok('Close', function () {});
    d.open();
  }
  async function uploadNpcPic(file) {
    if (!file || !/^image\//.test(file.type)) throw new Error('Choose a picture file (JPG, PNG, WebP, or GIF).');
    var blob = file, type = file.type, ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    if (file.type !== 'image/gif') {
      var img = await new Promise(function (ok, bad) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = function () { bad(new Error('That file is not a picture this browser can open.')); }; i.src = URL.createObjectURL(file); });
      var k = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight)), cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      blob = await new Promise(function (ok) { cv.toBlob(ok, 'image/png'); }); type = 'image/png'; ext = 'png';
    }
    if (blob.size > 3 * 1024 * 1024) throw new Error('That picture is over 3 MB. Try a smaller one.');
    var path = me.id + '/npc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    var r = await db.storage.from('ourspace').upload(path, blob, { contentType: type, upsert: false });
    if (r.error) throw r.error;
    return db.storage.from('ourspace').getPublicUrl(path).data.publicUrl;
  }
  function npcDialog() {
    var d = dialog('Add NPCs');
    var picked = null;
    var f = {
      name: el('input', { maxlength: '50', placeholder: 'Goblin' }), count: num('npc-count', 1, 1, 12), side: el('select', {}, [opt('enemy', 'Enemy', true), opt('neutral', 'Neutral'), opt('party', 'Ally')]),
      init: num('npc-init', 3, 0, 40), bdt: num('npc-bdt', 3, 1, 60), b: num('npc-b', 3, 0, 40), l: num('npc-l', 2, 0, 40), a: num('npc-a', 1, 1, 40),
      mana: num('npc-mana', 3, 0, 9999), mt: num('npc-mt', 2, 0, 99), atk: num('npc-atk', 4, 0, 60), def: num('npc-def', 4, 0, 60), dmg: num('npc-dmg', 3, 0, 60), move: num('npc-move', 1, 0, 20),
      notes: el('textarea', { maxlength: '1500', rows: '3', placeholder: 'Attacks, spells, traits' }), hidden: el('input', { type: 'checkbox' }),
      elite: el('input', { type: 'checkbox' }), boss: el('input', { type: 'checkbox' }),
      pic: el('input', { type: 'url', maxlength: '500', placeholder: 'https:// (optional)' }), file: el('input', { type: 'file', accept: 'image/*' })
    };
    var chosen = el('p', { class: 'cb-desc', text: 'Pick a creature to fill everything in, or type your own. You can change any number before adding.' });
    function fill() {
      if (!picked) return;
      var c = picked, rank = c.rank, base = RANK_STATS[rank] || null;
      var atk = c.attack, def = c.defense, dmg = c.damage, bdt = c.bdt, h = Object.assign({}, c.health || {}), mana = c.mana, mt = c.mt;
      if (f.elite.checked && base) { // Elite: +1 rank, keeping the creature's size bonuses
        var nr = RANKS[Math.min(RANKS.length - 1, RANKS.indexOf(rank) + 1)], nb = RANK_STATS[nr];
        atk += nb[0] - base[0]; def += nb[0] - base[0]; dmg += nb[1] - base[1]; bdt += nb[2] - base[2];
        h.b += nb[3][0] - base[3][0]; h.l += nb[3][1] - base[3][1]; h.a += nb[3][2] - base[3][2]; mana += nb[4] - base[4]; mt += nb[5] - base[5]; rank = nr;
      }
      if (f.boss.checked && !/Boss/.test(c.section)) { h.b *= 2; h.l *= 2; h.a *= 2; }
      f.name.value = c.name; f.atk.value = atk; f.def.value = def; f.dmg.value = dmg; f.bdt.value = bdt;
      f.b.value = h.b || 0; f.l.value = h.l || 0; f.a.value = h.a || 1; f.mana.value = mana || 0; f.mt.value = mt || 0; f.move.value = c.move || 1;
      f.notes.value = (c.abilities || []).map(function (x) { return x.name + ': ' + x.text; }).concat(c.trait ? ['Trait: ' + c.trait] : []).concat(f.boss.checked && !/Boss/.test(c.section) ? ['Boss: two attacks a turn, immune to one condition.'] : []).join('\n');
      chosen.textContent = c.name + ', Rank ' + rank + '. ' + [c.type, c.size, c.elements].filter(Boolean).join(', ') + '.' + (c.loot ? ' Loot: ' + c.loot : '');
    }
    f.elite.addEventListener('change', fill); f.boss.addEventListener('change', fill);
    d.body.appendChild(el('div', { class: 'cb-f' }, [
      el('div', {}, [el('button', { class: 'act primary', type: 'button', text: 'Choose from the Bestiary', onclick: function () { pickCreature(function (c) { picked = c; fill(); }); } })]), chosen,
      el('div', { class: 'two' }, [el('label', { class: 'chk' }, [f.elite, 'Elite (+1 rank)']), el('label', { class: 'chk' }, [f.boss, 'Boss (double health, two attacks)'])]),
      el('div', { class: 'two' }, [field('Name', f.name), field('How many', f.count)]),
      el('div', { class: 'three' }, [field('Side', f.side), field('Initiative', f.init), field('Move', f.move)]),
      el('div', { class: 'three' }, [field('Attack pool', f.atk), field('Defense pool', f.def), field('Damage pool', f.dmg)]),
      el('div', { class: 'three' }, [field('Bashing boxes', f.b), field('Lethal boxes', f.l), field('Aggravated boxes', f.a)]),
      el('div', { class: 'three' }, [field('BDT', f.bdt), field('Mana', f.mana), field('M/T', f.mt)]),
      field('Attacks, spells, and traits', f.notes),
      el('div', { class: 'two' }, [field('Picture (upload)', f.file), field('Or a picture address', f.pic)]),
      el('label', { class: 'chk' }, [f.hidden, 'Hidden from players until revealed'])]));
    d.ok('Add', async function () {
      var n = Math.max(1, Math.min(12, +f.count.value || 1)), base = f.name.value.trim() || 'Enemy', rows = [];
      var pic = /^https:\/\//.test(f.pic.value.trim()) ? f.pic.value.trim() : '';
      if (f.file.files && f.file.files[0]) pic = await uploadNpcPic(f.file.files[0]);
      var abil = picked ? (picked.abilities || []) : [];
      for (var i = 0; i < n; i++) rows.push({ encounter_id: R.enc.id, owner: me.id, name: n > 1 ? base + ' ' + (i + 1) : base, kind: 'npc', side: f.side.value, ap: 3, initiative: +f.init.value || 0, bdt: +f.bdt.value || 1,
        boxes: { b: +f.b.value || 0, l: +f.l.value || 0, a: +f.a.value || 1 }, mana: +f.mana.value || 0, mana_max: +f.mana.value || 0, mt: +f.mt.value || 0, hidden: f.hidden.checked, pic_url: pic,
        stats: { npc: true, attack: +f.atk.value || 0, defense: +f.def.value || 0, damage: +f.dmg.value || 0, move: +f.move.value || 1, notes: f.notes.value.trim(), regen: 1,
          creature: picked ? { id: picked.id, rank: picked.rank, type: picked.type, size: picked.size, elements: picked.elements, abilities: abil, trait: picked.trait || '' } : null } });
      await must(db.from('combatants').insert(rows));
      await refresh();
    });
    d.open();
  }
  function mapDialog() {
    var m = R.enc.map || {};
    var d = dialog('Battle Map');
    var cols = num('map-cols', m.cols || 6, 3, 20), rows = num('map-rows', m.rows || 8, 3, 20);
    var theme = el('select', {}, [opt('dark', 'Dark', m.theme !== 'light'), opt('light', 'Light', m.theme === 'light')]);
    d.body.appendChild(el('div', { class: 'cb-f' }, [el('div', { class: 'three' }, [field('Columns', cols), field('Rows', rows), field('Look', theme)]),
      el('p', { class: 'cb-desc', text: 'The book’s battle maps are 5 x 7, 6 x 8, and 7 x 9 zones. Tokens outside a smaller map are taken off it.' })]));
    d.ok('Save Map', async function () {
      var c = Math.max(3, Math.min(20, +cols.value || 6)), r = Math.max(3, Math.min(20, +rows.value || 8));
      await must(db.from('encounters').update({ map: { cols: c, rows: r, theme: theme.value } }).eq('id', R.enc.id));
      var off = list().filter(function (x) { return x.x !== null && (x.x >= c || x.y >= r); });
      for (var i = 0; i < off.length; i++) await db.from('combatants').update({ x: null, y: null }).eq('id', off[i].id);
      await refresh();
    });
    d.open();
  }

  // ---------- dialogs ----------
  function dialog(title) {
    var d = el('dialog', { class: 'win cb-dialog', 'aria-label': title });
    var body = el('div', {});
    var msg = el('p', { class: 'cb-msg', role: 'alert' });
    var okBtn = el('button', { class: 'act primary', type: 'button', text: 'OK' });
    d.appendChild(el('h2', { class: 'px', text: title }));
    d.appendChild(body);
    d.appendChild(msg);
    d.appendChild(el('div', { class: 'button-row', style: 'margin-top:12px' }, [el('button', { class: 'act', type: 'button', text: 'Cancel', onclick: function () { close(); } }), okBtn]));
    function close() { d.close(); d.remove(); }
    d.addEventListener('cancel', function () { setTimeout(close, 0); });
    return {
      el: d, body: body, close: close, msg: function (t) { msg.textContent = t || ''; },
      ok: function (label, fn) {
        okBtn.textContent = label;
        okBtn.addEventListener('click', async function () {
          okBtn.disabled = true; msg.textContent = '';
          try { var r = await fn(); if (r !== false) close(); } catch (e) { msg.textContent = oops(e); } finally { okBtn.disabled = false; }
        });
      },
      open: function () { document.body.appendChild(d); d.showModal(); }
    };
  }

  // The roll dialog: confirm the dice, mana, AP, and Willpower, then roll.
  // a = { label, pool, parts, unknown, spell, maneuver, kind, kit, targetable }
  function rollDialog(c, a) {
    var kit = c.stats || {}, spell = a.spell;
    var d = dialog(a.label);
    var body = d.body;
    if (a.desc) body.appendChild(el('p', { class: 'cb-desc', text: a.desc }));
    if (a.link) body.appendChild(el('p', { class: 'cb-desc' }, [el('a', { href: a.link, target: '_blank', rel: 'noopener', text: 'Full rules in the book' })]));
    var parts = el('ul', { class: 'cb-parts' });
    var bonus = num('r-bonus', 0, -20, 40), penalty = num('r-pen', woundPenalty(c), 0, 20);
    var target = el('select', { id: 'r-target' }, [opt('', 'No target')]);
    list().forEach(function (o) { if (o.id !== c.id) target.appendChild(opt(o.id, o.name + (o.side === c.side ? ' (ally)' : ''))); });
    var curSel = R.sel && R.sel !== c.id ? R.sel : '';
    if (curSel) target.value = curSel;
    var hasMana = !!spell;
    var cost = spell ? spell.cost || 0 : 0;
    var dotsCap = 0;
    if (spell) {
      if (spell.kind === 'combo') dotsCap = Math.min.apply(null, (spell.schools || []).map(function (s) { return (kit.dots || {})[s] || 0; }));
      else dotsCap = (kit.dots || {})[spell.school] || 0;
    }
    var manaTo = spell ? spell.mana_to || 'either' : 'either';
    var atkMana = el('select', { id: 'r-matk' }), dmgMana = el('select', { id: 'r-mdmg' });
    var ap = el('select', { id: 'r-ap' }, [opt(0, 'No AP'), opt(1, '+1 die for 1 AP'), opt(3, '+2 dice for 3 AP'), opt(6, '+3 dice for 6 AP')]);
    var wp = el('input', { type: 'checkbox', id: 'r-wp' });
    var real = el('input', { type: 'checkbox', id: 'r-real' }), realN = num('r-realn', 0, 0, 60);
    var realWrap = field('Successes you rolled', realN); realWrap.hidden = true;
    real.addEventListener('change', function () { realWrap.hidden = !real.checked; });
    function capLeft() {
      var mtLeft = Math.max(0, (c.mt || 0) - cost), have = Math.max(0, (c.mana || 0) - cost);
      return Math.max(0, Math.min(dotsCap, mtLeft, have));
    }
    function fillMana() {
      var cap = capLeft(), a1 = +atkMana.value || 0, d1 = +dmgMana.value || 0;
      [[atkMana, a1, d1, manaTo === 'damage'], [dmgMana, d1, a1, manaTo === 'attack']].forEach(function (x) {
        var s = x[0], cur = x[1], other = x[2], off = x[3];
        s.textContent = '';
        var max = off ? 0 : Math.max(0, cap - other);
        for (var i = 0; i <= max; i++) s.appendChild(opt(i, i === 0 ? 'None' : '+' + i + ' mana (' + i + ' ' + (i === 1 ? 'die' : 'dice') + ')', i === Math.min(cur, max)));
        s.disabled = off || max === 0;
      });
    }
    function apDice(v) { return { 0: 0, 1: 1, 3: 2, 6: 3 }[v] || 0; }
    function total() { return Math.max(0, a.pool + (+bonus.value || 0) - (+penalty.value || 0) + (+atkMana.value || 0) + apDice(+ap.value) + (wp.checked ? 3 : 0)); }
    function drawParts() {
      parts.textContent = '';
      (a.parts || []).forEach(function (p) { parts.appendChild(el('li', {}, [el('span', { text: p[0] }), el('span', { text: String(p[1]) })])); });
      (a.unknown || []).forEach(function (u) { parts.appendChild(el('li', { class: 'warn' }, [el('span', { text: u + ' (not found, use Bonus dice)' }), el('span', { text: '0' })])); });
      if (+bonus.value) parts.appendChild(el('li', {}, [el('span', { text: 'Bonus dice' }), el('span', { text: String(+bonus.value) })]));
      if (+penalty.value) parts.appendChild(el('li', {}, [el('span', { text: 'Wound and other penalties' }), el('span', { text: '-' + (+penalty.value) })]));
      if (+atkMana.value) parts.appendChild(el('li', {}, [el('span', { text: 'Extra mana on the attack' }), el('span', { text: '+' + atkMana.value })]));
      if (+ap.value) parts.appendChild(el('li', {}, [el('span', { text: 'AP spent (' + ap.value + ')' }), el('span', { text: '+' + apDice(+ap.value) })]));
      if (wp.checked) parts.appendChild(el('li', {}, [el('span', { text: 'Willpower' }), el('span', { text: '+3' })]));
      parts.appendChild(el('li', { class: 'total' }, [el('span', { text: 'Dice to roll' }), el('span', { text: String(total()) })]));
      if (hasMana) {
        var spend = cost + (+atkMana.value || 0) + (+dmgMana.value || 0);
        parts.appendChild(el('li', { class: spend > c.mana ? 'warn' : '' }, [el('span', { text: 'Mana spent (cost ' + cost + (+dmgMana.value ? ', ' + dmgMana.value + ' set aside for damage' : '') + ')' }), el('span', { text: spend + ' of ' + c.mana })]));
      }
      if (+ap.value > c.ap) parts.appendChild(el('li', { class: 'warn' }, [el('span', { text: 'You hold ' + c.ap + ' AP. Allies can give you the rest.' }), el('span', { text: '' })]));
    }
    [bonus, penalty, ap, wp].forEach(function (x) { x.addEventListener('input', drawParts); x.addEventListener('change', drawParts); });
    atkMana.addEventListener('change', function () { fillMana(); drawParts(); });
    dmgMana.addEventListener('change', function () { fillMana(); drawParts(); });
    var f = el('div', { class: 'cb-f' }, [parts]);
    if (a.targetable !== false) f.appendChild(field('Target', target));
    f.appendChild(el('div', { class: 'two' }, [field('Bonus dice (specialty, items, boons)', bonus), field('Penalty dice', penalty)]));
    if (hasMana) {
      var rule = manaTo === 'attack' ? 'This magic can only add mana to the attack.' : manaTo === 'damage' ? 'This magic can only add mana to damage.' : 'This magic can add mana to the attack or to damage.';
      f.appendChild(el('p', { class: 'cb-desc', text: 'Cost: ' + (spell.costText || cost) + '. Extra mana: up to ' + dotsCap + ' (your dots) or your M/T of ' + (c.mt || 0) + ', whichever comes first. ' + rule }));
      f.appendChild(el('div', { class: 'two' }, [field('Extra mana on the attack', atkMana), field('Mana set aside for damage', dmgMana)]));
    }
    f.appendChild(el('div', { class: 'two' }, [field('Spend AP for dice', ap), el('label', { class: 'chk', style: 'align-self:end' }, [wp, 'Spend 1 Willpower for +3 dice'])]));
    f.appendChild(el('label', { class: 'chk' }, [real, 'I rolled real dice']));
    f.appendChild(realWrap);
    body.appendChild(f);
    fillMana(); drawParts();
    d.ok('Roll', async function () {
      var n = total();
      var spend = hasMana ? cost + (+atkMana.value || 0) + (+dmgMana.value || 0) : 0;
      if (hasMana && spend > c.mana) { d.msg('Not enough mana. This needs ' + spend + ' and ' + c.name + ' has ' + c.mana + '.'); return false; }
      if (wp.checked && c.willpower < 1) { d.msg('No Willpower left to spend.'); return false; }
      var dice = real.checked ? [] : d10s(n), succ = real.checked ? Math.max(0, +realN.value || 0) : successes(dice);
      var patch = {};
      if (spend) patch.mana = c.mana - spend;
      if (+ap.value) patch.ap = Math.max(0, c.ap - (+ap.value));
      if (wp.checked) patch.willpower = c.willpower - 1;
      if (Object.keys(patch).length) await upd(c, patch);
      var tgt = R.cs[target.value];
      await addRoll({ combatant_id: c.id, label: a.label + (tgt ? ' at ' + tgt.name : ''), pool: n, dice: dice, successes: succ,
        detail: { kind: a.kind || 'roll', target: tgt ? tgt.id : null, setAside: +dmgMana.value || 0, mana: spend, ap: +ap.value || 0, wp: wp.checked, real: real.checked, damagePool: a.damagePool || 0, attacker: c.id } });
    });
    d.open();
  }

  function damageDialog(roll) {
    var c = R.cs[roll.combatant_id], det = roll.detail || {}, tgt = R.cs[det.target];
    var d = dialog('Roll Damage');
    var defRoll = R.rolls.filter(function (r) { return r.created_at > roll.created_at && (r.detail || {}).kind === 'defense' && r.combatant_id === det.target; }).slice(-1)[0];
    var def = num('dm-def', defRoll ? defRoll.successes : 0, 0, 60);
    var dpool = num('dm-pool', det.damagePool || 0, 0, 60);
    var bonus = num('dm-bonus', 0, -20, 40);
    var real = el('input', { type: 'checkbox' }), realN = num('dm-realn', 0, 0, 80);
    var realWrap = field('Damage successes you rolled', realN); realWrap.hidden = true;
    real.addEventListener('change', function () { realWrap.hidden = !real.checked; });
    var out = el('ul', { class: 'cb-parts' });
    function draw() {
      out.textContent = '';
      var ex = Math.max(0, roll.successes - (+def.value || 0));
      out.appendChild(el('li', {}, [el('span', { text: 'Attack successes' }), el('span', { text: String(roll.successes) })]));
      out.appendChild(el('li', {}, [el('span', { text: 'Defense successes' }), el('span', { text: String(+def.value || 0) })]));
      out.appendChild(el('li', { class: roll.successes > (+def.value || 0) ? 'total' : 'warn' }, [el('span', { text: roll.successes > (+def.value || 0) ? 'Hit! Excess successes' : 'Miss: the defense held' }), el('span', { text: String(ex) })]));
      out.appendChild(el('li', {}, [el('span', { text: 'Damage dice: pool ' + (+dpool.value || 0) + ' + mana set aside ' + (det.setAside || 0) + (+bonus.value ? ' + bonus ' + bonus.value : '') }), el('span', { text: String(Math.max(0, (+dpool.value || 0) + (det.setAside || 0) + (+bonus.value || 0))) })]));
    }
    [def, dpool, bonus].forEach(function (x) { x.addEventListener('input', draw); });
    d.body.appendChild(el('div', { class: 'cb-f' }, [
      el('p', { class: 'cb-desc', text: (c ? c.name : 'Attacker') + (tgt ? ' against ' + tgt.name + ' (BDT ' + tgt.bdt + ', LDT ' + tgt.bdt * 2 + ', ADT ' + tgt.bdt * 3 + ')' : '') + '. Damage = damage roll successes + excess successes, compared to the target’s thresholds.' }),
      el('div', { class: 'three' }, [field('Defense successes', def), field('Damage pool', dpool), field('Bonus dice', bonus)]),
      el('p', { class: 'cb-desc', text: 'Damage pool: a weapon’s damage Attribute + its Rating. Spells that deal damage equal to excess successes use 0 here.' }),
      out, el('label', { class: 'chk' }, [real, 'I rolled real dice']), realWrap]));
    draw();
    d.ok('Roll Damage', async function () {
      var ex = Math.max(0, roll.successes - (+def.value || 0));
      if (roll.successes <= (+def.value || 0)) {
        await addRoll({ combatant_id: roll.combatant_id, label: 'Missed' + (tgt ? ' ' + tgt.name : ''), detail: { kind: 'note' } });
        return;
      }
      var n = Math.max(0, (+dpool.value || 0) + (det.setAside || 0) + (+bonus.value || 0));
      var dice = real.checked ? [] : d10s(n), s = real.checked ? +realN.value || 0 : successes(dice);
      var totalDmg = s + ex, res = null;
      if (tgt) { var b = tgt.bdt || 1; res = totalDmg >= b * 3 ? 'a' : totalDmg >= b * 2 ? 'l' : totalDmg >= b ? 'b' : null; }
      await addRoll({ combatant_id: roll.combatant_id, label: 'Damage' + (tgt ? ' to ' + tgt.name : ''), pool: n, dice: dice, successes: s,
        detail: { kind: 'damage', of: roll.id, target: tgt ? tgt.id : null, excess: ex, total: totalDmg, result: res, real: real.checked } });
    });
    d.open();
  }
  async function applyDamage(roll) {
    var det = roll.detail || {}, t = R.cs[det.target];
    if (!t || !det.result) return;
    var h = Object.assign({ b: 0, l: 0, a: 0 }, t.health), box = t.boxes || {};
    var k = det.result;
    // a hit landing in a full column moves up to the next damage type
    while (k && (h[k] || 0) >= (box[k] || 0)) k = k === 'b' ? 'l' : k === 'l' ? 'a' : null;
    if (!k) { await note(t.name + ' is Incapacitated: the hit landed in a full column.'); return; }
    h[k] = (h[k] || 0) + 1;
    await upd(t, { health: h, stats: Object.assign({}, t.stats || {}, { hurt: true }) });
    var NAMES = { b: 'Bashing', l: 'Lethal', a: 'Aggravated' };
    await addRoll({ label: t.name + ' takes 1 ' + NAMES[k] + '.' + (incap(t) ? ' ' + t.name + ' is Incapacitated: choose Fall Unconscious, Risk It, or Blaze of Glory.' : ''),
      detail: { kind: 'note', applied: roll.id } });
  }

  // ---------- my actions ----------
  function drawActions() {
    var box = $('cb-actions'); box.textContent = '';
    var c = R.sel ? R.cs[R.sel] : null;
    if (!c || !mineC(c)) {
      var mineList = list().filter(function (x) { return x.owner === me.id; });
      box.appendChild(el('h2', { class: 'px', style: 'margin-top:0', text: 'Actions' }));
      box.appendChild(el('p', { class: 'cv-muted', text: mineList.length ? 'Pick one of your tokens (or its name in Turn Order) to act with it.' : 'Bring a character to act. The Storyteller can act with any NPC.' }));
      return;
    }
    var kit = c.stats || {};
    box.appendChild(el('h2', { class: 'px', style: 'margin-top:0', text: c.name }));
    if (kit.npc) {
      box.appendChild(el('p', { class: 'cb-desc', text: kit.creature ? ['Rank ' + kit.creature.rank, kit.creature.type, kit.creature.size, kit.creature.elements, 'Move ' + (kit.move || 1)].filter(Boolean).join(' · ') + (kit.creature.trait ? '. Trait: ' + kit.creature.trait : '') : (kit.notes || '') }));
      var acts = el('div', { class: 'cb-acts' });
      ((kit.creature || {}).abilities || []).forEach(function (ab) {
        var isAtk = /melee|ranged|damage|casts|breath|bolt|bite|claw|strike|slam/i.test(ab.name + ' ' + ab.text);
        acts.appendChild(el('button', { class: 'cb-act', type: 'button', onclick: function () { rollDialog(c, { label: c.name + ': ' + ab.name, pool: kit.attack || 0, parts: [['Attack pool', kit.attack || 0]], kind: isAtk ? 'attack' : 'roll', damagePool: kit.damage || 0, targetable: isAtk, desc: ab.text }); } },
          [el('span', {}, [el('b', { text: ab.name }), el('small', { text: ab.text })]), el('span', { class: 'pool', text: String(kit.attack || 0) })]));
      });
      [['Attack', kit.attack, 'attack'], ['Defense', kit.defense, 'defense']].forEach(function (x) {
        acts.appendChild(el('button', { class: 'cb-act', type: 'button', onclick: function () { rollDialog(c, { label: c.name + ': ' + x[0], pool: x[1] || 0, parts: [[x[0] + ' pool', x[1] || 0]], kind: x[2], damagePool: kit.damage || 0, targetable: x[2] === 'attack' }); } },
          [el('span', { text: x[0] }), el('span', { class: 'pool', text: String(x[1] || 0) })]));
      });
      acts.appendChild(customButton(c));
      box.appendChild(acts);
      return;
    }
    var tabs = [['spells', 'Spellbook'], ['maneuvers', 'Maneuvers'], ['defense', 'Defense'], ['summons', 'Summons'], ['belt', 'Belt'], ['custom', 'Custom']];
    var LO = kit.loadout || {};
    // The Combat Loadout's prepared picks come first; "Show everything" lists all you know
    function prepared(list, keys) {
      keys = (keys || []).filter(Boolean);
      if (!keys.length || R.showAll) return list || [];
      return keys.map(function (k2) { return (list || []).filter(function (x) { return x.key === k2; })[0]; }).filter(Boolean);
    }
    function allToggle(keys) {
      if (!(keys || []).filter(Boolean).length) return el('p', { class: 'cb-sub', text: 'Showing everything you know. Prepare up to 5 on the Combat Loadout tab of your character page.' });
      return el('label', { class: 'chk cb-sub', style: 'display:flex;gap:6px;align-items:center;margin-bottom:6px' }, [el('input', { type: 'checkbox', checked: !!R.showAll, onchange: function (e) { R.showAll = e.target.checked; drawActions(); } }), 'Show everything I know, not just my prepared ' + (R.tab === 'spells' ? 'spells' : 'maneuvers')]);
    }
    var tb = el('div', { class: 'cb-tabs', role: 'tablist' });
    tabs.forEach(function (t) { tb.appendChild(el('button', { class: 'cb-tab', type: 'button', role: 'tab', 'aria-selected': String(R.tab === t[0]), text: t[1], onclick: function () { R.tab = t[0]; drawActions(); } })); });
    box.appendChild(tb);
    var acts2 = el('div', { class: 'cb-acts' });
    if (R.tab === 'spells') {
      acts2.appendChild(allToggle(LO.spells));
      prepared(kit.spells, LO.spells).forEach(function (sp) {
        var p = evalPool(sp.pool, kit, sp);
        var attack = /attack/i.test(sp.type || '');
        acts2.appendChild(el('button', { class: 'cb-act', type: 'button', onclick: function () {
          rollDialog(c, { label: sp.name, pool: p.total, parts: p.parts, unknown: p.unknown, spell: sp, kind: attack ? 'attack' : 'roll', desc: [sp.type, sp.range, sp.defense ? 'Defense: ' + sp.defense : ''].filter(Boolean).join('. ') + '. ' + (sp.effect || ''),
            link: sp.id ? '../rulebook/' + (sp.page || 'ch13') + '.html#' + sp.id : null });
        } }, [el('span', {}, [el('b', { text: sp.name }), el('small', { text: sp.school + ' Rank ' + sp.rank + '. ' + (sp.costText || sp.cost) + ' mana. ' + (sp.type || '') })]), el('span', { class: 'pool', text: p.total + 'd' })]));
      });
      if (!acts2.children.length) acts2.appendChild(el('p', { class: 'cv-muted', text: 'No spells. Pick spells in the Forge (Step 11), then Refresh Stats.' }));
    } else if (R.tab === 'maneuvers') {
      acts2.appendChild(allToggle(LO.maneuvers));
      var armed = {}; (kit.weapons || []).forEach(function (w) { var stn = (LO.weapons || {})[w.key] || ((kit.styles || []).length === 1 ? kit.styles[0].name : ''); if (stn) (armed[stn] = armed[stn] || []).push(w.name); });
      var mlist = prepared(kit.maneuvers, LO.maneuvers);
      if ((LO.maneuvers || []).filter(Boolean).length && !R.showAll) mlist = (kit.maneuvers || []).filter(function (m) { return m.rank === 0; }).concat(mlist.filter(function (m) { return m.rank !== 0; }));
      mlist.forEach(function (mv) {
        var p = evalPool(mv.pool, kit);
        if (mv.rank === 0 && armed[mv.style]) mv = Object.assign({}, mv, { name: 'Attack with ' + armed[mv.style].join(' or ') });
        acts2.appendChild(el('button', { class: 'cb-act', type: 'button', onclick: function () {
          rollDialog(c, { label: mv.name + (mv.rank ? '' : ' (' + mv.style + ')'), pool: p.total, parts: p.parts, unknown: p.unknown, kind: 'attack', desc: (mv.slot ? mv.slot + ', ' : '') + (mv.use || '') + '. ' + mv.text,
            link: mv.id ? '../rulebook/ch12.html#' + mv.id : null });
        } }, [el('span', {}, [el('b', { text: mv.name }), el('small', { text: mv.style + (mv.rank ? ' Rank ' + mv.rank + ', ' + mv.slot : '') })]), el('span', { class: 'pool', text: p.total + 'd' })]));
      });
      if (!acts2.children.length) acts2.appendChild(el('p', { class: 'cv-muted', text: 'No Combat Styles yet.' }));
    } else if (R.tab === 'defense') {
      (kit.defenses || []).forEach(function (df) {
        var p = evalPool(df.pool, kit);
        acts2.appendChild(el('button', { class: 'cb-act', type: 'button', onclick: function () { rollDialog(c, { label: df.name, pool: p.total, parts: p.parts, unknown: p.unknown, kind: 'defense', targetable: false }); } },
          [el('span', {}, [el('b', { text: df.name }), el('small', { text: df.pool })]), el('span', { class: 'pool', text: p.total + 'd' })]));
      });
    } else if (R.tab === 'summons') {
      (kit.summons || []).forEach(function (sm) {
        acts2.appendChild(el('button', { class: 'cb-act', type: 'button', onclick: function () { addRoll({ label: c.name + ' calls ' + sm.name + ' (' + sm.kind + ').', combatant_id: c.id, detail: { kind: 'note' } }); } },
          [el('span', {}, [el('b', { text: sm.name }), el('small', { text: sm.kind + '. ' + (sm.text || '') })]), el('span', { class: 'pool', text: 'Call' })]));
      });
      if (!acts2.children.length) acts2.appendChild(el('p', { class: 'cv-muted', text: 'No familiar or SumMonz. Use Bring a Character to put one on the map.' }));
    } else if (R.tab === 'belt') {
      R.beltUsed = R.beltUsed || {};
      var usedNow = R.beltUsed[c.id + ':' + (R.enc.state || {}).round] || 0;
      (kit.belt || []).forEach(function (bi) {
        var cost = usedNow === 0 ? 'free' : usedNow === 1 ? '1 AP' : '2 AP';
        acts2.appendChild(el('button', { class: 'cb-act', type: 'button', onclick: function () {
          var k2 = c.id + ':' + (R.enc.state || {}).round; R.beltUsed[k2] = (R.beltUsed[k2] || 0) + 1;
          addRoll({ label: c.name + ' uses ' + bi.name + (bi.detail ? ' (' + bi.detail + ')' : '') + ' from the belt (' + cost + ').', combatant_id: c.id, detail: { kind: 'note' } });
          drawActions();
        } }, [el('span', {}, [el('b', { text: bi.slot + '. ' + bi.name }), el('small', { text: (bi.detail ? bi.detail + '. ' : '') + 'Next use this round: ' + cost })]), el('span', { class: 'pool', text: 'Use' })]));
      });
      if (!acts2.children.length) acts2.appendChild(el('p', { class: 'cv-muted', text: 'Nothing on your belt. Set it on your character page, Equipment and Notes tab, then Refresh Stats.' }));
    } else acts2.appendChild(customButton(c));
    box.appendChild(acts2);
    box.appendChild(el('p', { class: 'cb-sub', style: 'margin-top:8px', text: 'Initiative ' + (kit.initiative || c.initiative) + '. Move ' + (kit.move || 1) + ' zone' + ((kit.move || 1) === 1 ? '' : 's') + ' per turn. Wound penalty -' + woundPenalty(c) + '.' }));
  }
  function customButton(c) {
    return el('button', { class: 'cb-act', type: 'button', onclick: function () {
      var d = dialog('Custom Roll');
      var lab = el('input', { maxlength: '80', placeholder: 'Strength + Athletics to break free' }), n = num('cu-n', 3, 0, 60);
      var kind = el('select', {}, [opt('roll', 'Any roll', true), opt('attack', 'An attack'), opt('defense', 'A defense')]);
      d.body.appendChild(el('div', { class: 'cb-f' }, [field('What is it?', lab), el('div', { class: 'two' }, [field('Dice', n), field('Kind', kind)])]));
      d.ok('Next', function () {
        rollDialog(c, { label: lab.value.trim() || 'Roll', pool: +n.value || 0, parts: [['Dice', +n.value || 0]], kind: kind.value, targetable: kind.value === 'attack' });
      });
      d.open();
    } }, [el('span', {}, [el('b', { text: 'Custom roll' }), el('small', { text: 'Type the dice yourself' })]), el('span', { class: 'pool', text: '?' })]);
  }

  function drawLog() {
    var l = $('cb-log'); l.textContent = '';
    var ul = el('ul', { class: 'cb-log', 'aria-live': 'polite' });
    var applied = {}; R.rolls.forEach(function (r) { if ((r.detail || {}).applied) applied[r.detail.applied] = 1; });
    R.rolls.slice(0, 80).forEach(function (r) {
      var c = R.cs[r.combatant_id], det = r.detail || {};
      var who = c ? c.name : (R.players[r.roller] || '');
      var li = el('li', {});
      if (det.kind === 'note') { li.appendChild(el('span', { class: 'cb-note', text: r.label })); ul.appendChild(li); return; }
      li.appendChild(el('div', {}, [el('span', { class: 'who', text: who }), ': ' + r.label + ' ', el('span', { class: 'when', text: new Date(r.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })]));
      if (r.dice && r.dice.length) li.appendChild(el('div', { class: 'cb-dice' }, r.dice.map(function (dv) { return el('span', { class: 'cb-die' + (dv === 10 ? ' ten' : dv >= 6 ? ' hit' : ''), text: String(dv) }); })));
      else if (det.real) li.appendChild(el('div', { class: 'cb-sub', text: 'Rolled with real dice.' }));
      var line = [el('span', { class: 'cb-succ', text: r.successes + ' success' + (r.successes === 1 ? '' : 'es') })];
      if (r.pool) line.push(' on ' + r.pool + ' dice');
      if (det.mana) line.push('. ' + det.mana + ' mana spent' + (det.setAside ? ' (' + det.setAside + ' set aside for damage)' : ''));
      if (det.ap) line.push('. ' + det.ap + ' AP');
      if (det.wp) line.push('. 1 Willpower');
      if (det.kind === 'damage') {
        var t = R.cs[det.target];
        line.push('. Total damage ' + det.total + ' (' + det.excess + ' excess)');
        line.push(det.result ? ': ' + { b: 'Bashing', l: 'Lethal', a: 'Aggravated' }[det.result] + (t ? ' to ' + t.name : '') : t ? ': below ' + t.name + '’s BDT, no damage' : '');
      }
      li.appendChild(el('div', {}, line));
      var btns = el('div', { class: 'cb-bar', style: 'margin-top:4px' });
      if (det.kind === 'attack' && c && mineC(c)) btns.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Roll Damage', onclick: function () { damageDialog(r); } }));
      if (det.kind === 'attack' && det.target && R.cs[det.target] && R.cs[det.target].owner === me.id && R.cs[det.target].owner !== (c && c.owner)) {
        btns.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Defend', onclick: function () { R.sel = det.target; R.tab = 'defense'; drawAll(); $('cb-actions').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));
      }
      var tg = R.cs[det.target];
      if (det.kind === 'damage' && det.result && !applied[r.id] && tg && mineC(tg)) btns.appendChild(el('button', { class: 'act cb-mini primary', type: 'button', text: 'Apply to ' + tg.name, onclick: function (e) { e.target.disabled = true; applyDamage(r); } }));
      if (btns.children.length) li.appendChild(btns);
      ul.appendChild(li);
    });
    l.appendChild(el('h2', { class: 'px', style: 'margin-top:0', text: 'Roll Log' }));
    l.appendChild(ul.children.length ? ul : el('p', { class: 'cv-muted', text: 'No rolls yet. 6 or higher is a success; a 10 counts twice.' }));
  }

  async function roomPage(main) {
    if (!me) { main.appendChild(el('section', { class: 'panel win' }, [el('p', { class: 'center', text: 'Log in to join this fight.' }), el('div', { class: 'button-row center-row' }, [el('a', { class: 'act primary', href: '../account/index.html?next=combat/index.html', text: 'Log In' })])])); return; }
    var id = new URLSearchParams(location.search).get('id');
    var enc = id ? (await db.from('encounters').select('*').eq('id', id).maybeSingle()).data : null;
    if (!enc) { main.appendChild(el('section', { class: 'panel win' }, [el('p', { class: 'center', text: 'This encounter is over, or you have not joined it. Join with its code on the Combat page.' }), el('div', { class: 'button-row center-row' }, [el('a', { class: 'act primary', href: 'index.html', text: 'Combat' })])])); return; }
    R.enc = enc; R.host = enc.host === me.id;
    document.title = enc.name + ' | Combat | Jimothy’s D10 Isekai JRPG';
    main.appendChild(el('section', { class: 'panel win cb-top', id: 'cb-top' }));
    main.appendChild(el('div', { class: 'cb-layout' }, [
      el('div', { class: 'cb-col' }, [el('section', { class: 'panel win cb-mapwrap', id: 'cb-map' }), el('section', { class: 'panel win', id: 'cb-actions' }), el('section', { class: 'panel win', id: 'cb-log' })]),
      el('div', { class: 'cb-col' }, [el('section', { class: 'panel win', id: 'cb-tracker' })])
    ]));
    await refresh();
    live();
    window.addEventListener('resize', function () { drawMap(); });
  }

  A.currentPlayer().then(async function (p) {
    me = p;
    var main = $('cb-main'); main.textContent = '';
    try { await (page === 'room' ? roomPage : listPage)(main); }
    catch (e) { main.appendChild(el('section', { class: 'panel win' }, [el('p', { class: 'center', text: 'Combat could not load. ' + oops(e) }), el('p', { class: 'center cv-muted', text: 'If this keeps happening, combat may not be set up on the server yet.' })])); }
  });
})();
