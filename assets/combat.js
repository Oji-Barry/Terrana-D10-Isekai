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
      el('p', { class: 'center', text: 'Host a fight as the Storyteller, or tap an active fight to join it. Public fights let anyone in; private ones need the code from their Storyteller. Everyone sees the map, turn order, health, and every roll live.' }),
      el('p', { class: 'center' }, [el('a', { class: 'act', href: 'my-bestiary.html', text: 'My Bestiary' })])]));
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
  var R = { enc: null, players: {}, cs: {}, rolls: [], host: false, sel: null, moving: null, data: null, open: {}, pay: {} };
  var CONDS = ['Bleeding', 'Blinded', 'Burning', 'Chilled', 'Exhausted', 'Grappled', 'Petrified', 'Poisoned', 'Prone', 'Rooted'];
  var PHASES = [
    ['Upkeep', 'Regain AP and mana, pay upkeep for anything still running, and resolve Burning, Bleeding, and Poisoned.'],
    ['Planning', 'Lock in what you want to do this turn.'],
    ['Move or Use Item', 'Move up to your Movement, use a belt item, or both. AP buys extra zones or items.'],
    ['Action', 'Make an attack or cast a spell from what you prepared.'],
    ['Damage', 'Roll damage for a hit and mark it on the target.'],
    ['Move or Use Item', 'Use whatever Movement and items you have left.'],
    ['Ending', 'End-of-turn effects resolve, then the next turn begins.']];
  function mineC(c) { return c && (c.owner === me.id || R.host); }
  function list() { return Object.keys(R.cs).map(function (k) { return R.cs[k]; }); }
  function ST() {
    var s = Object.assign({ round: 1, turn: 0, order: [], started: false, mode: 'initiative', first: 'party', phase: 0 }, R.enc.state || {});
    s.t = Object.assign({ moved: 0, extra: 0, items: 0, done: {}, attack: null }, s.t || {});
    return s;
  }
  function byInit(a, b) { return b.initiative - a.initiative || a.name.localeCompare(b.name); }
  function computeOrder(mode, first) {
    var all = list().slice().sort(byInit);
    if (mode !== 'team') return all.map(function (c) { return c.id; });
    var party = all.filter(function (c) { return c.side === 'party'; }), foes = all.filter(function (c) { return c.side !== 'party'; });
    return (first === 'enemy' ? foes.concat(party) : party.concat(foes)).map(function (c) { return c.id; });
  }
  function order() {
    var o = ST().order.filter(function (id) { return R.cs[id]; });
    var rest = list().filter(function (c) { return o.indexOf(c.id) < 0; }).sort(byInit);
    return o.map(function (id) { return R.cs[id]; }).concat(rest);
  }
  function current() { var s = ST(); if (!s.started) return null; var o = s.order.filter(function (id) { return R.cs[id]; }); return o.length ? R.cs[o[s.turn % o.length]] : null; }
  function canControl() { var c = current(); return !!c && (R.host || c.owner === me.id); }
  function moveOf(c) { var k = c.stats || {}; return k.move || 1; }
  // Free Movement left this turn (none once in difficult terrain), plus zones already bought with AP
  function freeLeft(c) { var t = ST().t; return t.stuck ? 0 : Math.max(0, moveOf(c) - (t.moved || 0)); }
  function preLeft() { var t = ST().t; return Math.max(0, (t.extra || 0) - (t.extraUsed || 0)); }
  function moveLeft(c) { return freeLeft(c) + preLeft(); }
  // Zones bought with AP cost 1, then 2 more, then 3 more (1, 3, 6 in all), at most 3 a turn
  function canBuyMore(c) { var p = ST().t.paid || 0; return p < 3 && (c.ap || 0) >= p + 1; }
  function terrainAt(x, y, n) { var ter = (R.enc.map || {}).terrain || {}; for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) { var t = TER[ter[(x + i) + ',' + (y + j)]]; if (t && (t[3] === 'difficult' || t[3] === 'cover')) return true; } return false; }
  async function upd(c, patch) {
    Object.assign(c, patch);
    drawAll();
    var r = await db.from('combatants').update(patch).eq('id', c.id);
    if (r.error) { alert(oops(r.error)); refresh(); }
  }
  // Turn state lives on the encounter. The Storyteller writes it directly; the player whose turn it is goes through turn_update.
  async function saveState(patch) {
    var s = Object.assign(ST(), patch);
    R.enc.state = s; drawAll();
    var r = R.host ? await db.from('encounters').update({ state: s }).eq('id', R.enc.id) : await db.rpc('turn_update', { e: R.enc.id, patch: patch });
    if (r.error) { alert(oops(r.error)); refresh(); }
  }
  async function markDone(extra) {
    var s = ST(), t = Object.assign({}, s.t, extra || {}); t.done = Object.assign({}, t.done); t.done[s.phase] = true;
    if (t.last && !(extra && 'last' in extra)) t.last = Object.assign({}, t.last, { wasDone: true }); // something else happened after the move, so undo keeps the phase locked
    await saveState({ t: t });
  }
  // Add a roll or note to the log now, without waiting for the live update
  async function addRoll(row) {
    var r = await must(db.from('rolls').insert(Object.assign({ encounter_id: R.enc.id, roller: me.id }, row)).select().single());
    if (r && !R.rolls.some(function (x) { return x.id === r.id; })) { R.rolls.unshift(r); toast(r); }
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
      if (!R.rolls.some(function (r) { return r.id === p.new.id; })) { R.rolls.unshift(p.new); toast(p.new); }
      drawLog();
    }).on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'rolls' }, function () { refresh(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'encounters', filter: 'id=eq.' + id }, function (p) { R.enc = p.new; drawAll(); })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'encounters', filter: 'id=eq.' + id }, function () { location.href = 'index.html'; })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'encounter_players', filter: 'encounter_id=eq.' + id }, function () { refresh(); })
      .subscribe();
    // a slow safety net in case a live update is missed
    setInterval(function () { if (!document.hidden && !document.querySelector('dialog[open]')) refresh().catch(function () {}); }, 20000);
  }

  // Anyone added after the turn order was set joins it by Initiative, so every creature on the field gets a turn
  async function syncOrder() {
    if (!R.host || R.syncing) return;
    var s = ST(); if (!s.order.length) return;
    var known = s.order.filter(function (id) { return R.cs[id]; });
    var fresh = list().filter(function (c) { return known.indexOf(c.id) < 0; });
    if (!fresh.length && known.length === s.order.length) return;
    var cur = current(), o = computeOrder(s.mode, s.first);
    var patch = { order: o };
    if (s.started) patch.turn = cur && o.indexOf(cur.id) >= 0 ? o.indexOf(cur.id) : (s.turn % Math.max(1, o.length));
    R.syncing = true;
    try { await saveState(patch); if (fresh.length) await note(fresh.map(function (c) { return c.name; }).join(', ') + (fresh.length === 1 ? ' joins' : ' join') + ' the turn order by Initiative.'); }
    finally { R.syncing = false; }
  }
  // A pop-up over the battlefield for each new entry in the Roll Log: 10 seconds, or close it with the X
  function rollSummary(r) {
    var c = R.cs[r.combatant_id], det = r.detail || {}, bits = [];
    if (det.kind !== 'note' && det.kind !== 'wpdmg' && (r.pool || (r.dice && r.dice.length) || det.real)) bits.push(r.successes + ' success' + (r.successes === 1 ? '' : 'es') + (r.pool ? ' on ' + r.pool + (r.pool === 1 ? ' die' : ' dice') : ''));
    if (det.kind === 'defense' && det.vs) bits.push(det.contest ? (det.hit ? 'the attacker wins' : 'the defense holds') : det.social ? (det.hit ? det.excess + ' Willpower damage coming' : 'the words do not land') : det.hit ? 'HIT, ' + det.excess + ' over carry to damage' : 'MISS, the defense holds');
    if (det.kind === 'damage') { var t = R.cs[det.target]; bits.push('total ' + (det.total || 0) + (det.result ? ': ' + { b: 'Bashing', l: 'Lethal', a: 'Aggravated' }[det.result] + (t ? ' to ' + t.name : '') : t ? ': below ' + t.name + '’s BDT' : '')); }
    return { who: c ? c.name : (R.players[r.roller] || ''), text: r.label, line: bits.join('. '), cls: det.kind === 'defense' ? (det.hit ? 'hit' : 'miss') : det.kind === 'damage' && det.result ? 'hit' : '' };
  }
  // Sound effects for each new log entry: a miss whooshes, a hit waits for its damage roll
  function sfx(n) { if (window.SFX) window.SFX.play(n); }
  function sfxFor(r) {
    var det = r.detail || {};
    if (det.kind === 'defense') { if (det.contest) sfx(det.hit ? 'thud' : 'block'); else if (det.social) sfx(det.hit ? 'sting' : 'whoosh'); else if (!det.hit) sfx('whoosh'); return; }
    if (det.kind === 'damage') { sfx({ a: 'crush', l: 'slash', b: 'punch' }[det.result] || 'tink'); return; }
    if (det.kind === 'note') { var tx = r.label || ''; if (/Incapacitated|defeated|is down/i.test(tx)) sfx('defeat'); else if (/Total Defense|takes (half|full) cover|takes aim/i.test(tx)) sfx('buff'); else if (/heal/i.test(tx)) sfx('heal'); return; }
    if (det.kind === 'wpdmg') { sfx('sting'); return; }
    if (/^(attack|contest|roll)$/.test(det.kind || 'roll')) sfx(det.spell || /cast|spell/i.test(r.label || '') ? 'cast' : 'dice');
  }
  function soundCtl() {
    if (!window.SFX) return null;
    var btn = el('button', { type: 'button', class: 'act cb-mini cb-sound', 'aria-pressed': String(!SFX.muted()), title: 'Sound effects', text: SFX.muted() ? '🔇 Sound' : '🔊 Sound' });
    var sl = el('input', { type: 'range', min: '0', max: '100', value: String(Math.round(SFX.volume() * 100)), 'aria-label': 'Sound effects volume', class: 'cb-vol' });
    btn.addEventListener('click', function () { SFX.muted(!SFX.muted()); btn.textContent = SFX.muted() ? '🔇 Sound' : '🔊 Sound'; btn.setAttribute('aria-pressed', String(!SFX.muted())); if (!SFX.muted()) SFX.play('select'); });
    sl.addEventListener('change', function () { SFX.volume(+sl.value / 100); SFX.play('cursor'); });
    return el('span', { class: 'cb-soundwrap' }, [btn, sl]);
  }
  function toast(r) {
    var box = $('cb-toasts'); if (!box || !r) return;
    sfxFor(r);
    var sm = rollSummary(r);
    var t = el('div', { class: 'cb-toast ' + sm.cls, role: 'status' });
    function bye() { if (t.parentNode) { t.classList.add('out'); setTimeout(function () { t.remove(); }, 250); } }
    t.appendChild(el('button', { type: 'button', class: 'cb-toast-x', 'aria-label': 'Close', text: '×', onclick: bye }));
    if (sm.who && (r.detail || {}).kind !== 'note') t.appendChild(el('b', { text: sm.who }));
    t.appendChild(el('p', { text: sm.text }));
    if (sm.line) t.appendChild(el('p', { class: 'cb-toast-line', text: sm.line }));
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(bye, 10000);
  }

  function turnSounds() {
    var s = ST(), k = s.started ? s.round + ':' + s.turn : '', pk = k + ':' + s.phase;
    if (R.lastTurnKey !== undefined && k && k !== R.lastTurnKey) sfx('turn');
    else if (R.lastPhaseKey !== undefined && k && pk !== R.lastPhaseKey) sfx('phase');
    R.lastTurnKey = k; R.lastPhaseKey = pk;
  }
  // ---------- Music: the Storyteller picks it and everyone hears it. A switch lets players pick too. ----------
  function musicState() { return ST().music || {}; }
  function canPickMusic() { return R.host || !!musicState().open; }
  async function writeMusic(patch) {
    var m = Object.assign({}, musicState(), patch);
    if (R.host) return saveState({ music: m });
    var r = await db.rpc('set_music', { e: R.enc.id, m: m });
    if (r.error) { alert(A.friendly ? A.friendly(r.error) : r.error.message); return; }
    R.enc.state = r.data; drawAll();
  }
  function musicAction(action, data) {
    var M = window.TerranaMusic, m = musicState(), now = Date.now(), s = M.state();
    var pos = m.playing ? (now - (m.t0 || now)) / 1000 : (m.pos || 0);
    if (action === 'toggle') {
      if (m.id && m.playing && !s.playing) { M.resume(); return; }   // the browser held it back: just start it here
      if (!m.id) { var first = M.nextId(1); if (first) writeMusic({ id: first, mood: s.mood, playing: true, t0: now, pos: 0 }); return; }
      return writeMusic(m.playing ? { playing: false, pos: s.time || pos } : { playing: true, t0: now - (m.pos || 0) * 1000 });
    }
    if (action === 'next' || action === 'prev') { var n = M.nextId(action === 'next' ? 1 : -1); if (n) writeMusic({ id: n, playing: true, t0: now, pos: 0 }); return; }
    if (action === 'pick') return writeMusic({ id: data, playing: true, t0: now, pos: 0 });
    if (action === 'mood') { M.setMood(data); return writeMusic({ mood: data }); }
    if (action === 'repeat') return writeMusic({ repeat: { all: 'one', one: 'off', off: 'all' }[m.repeat || 'all'] });
    if (action === 'seek') return writeMusic(m.playing ? { t0: now - data * 1000 } : { pos: data });
  }
  function syncMusic() {
    var M = window.TerranaMusic; if (!M) return;
    var box = $('cb-music');
    if (box && !R.player) {
      var sw = R.host ? el('label', { class: 'mp-switch' }, [el('input', { type: 'checkbox', id: 'mus-open', onchange: function (e) { writeMusic({ open: e.target.checked }); } }), 'Let players pick songs']) : null;
      R.player = M.mountPlayer(box, { canChange: canPickMusic, onAction: musicAction, lockedNote: 'The Storyteller picks the music. You can still look through the list.', extra: sw });
      M.on(function (what) { if (what === 'play') { R.musicKey = null; setTimeout(syncMusic, 50); } });   // catch up after pressing play
      M.onEnded = function () {   // everyone moves on together; the Storyteller's page writes it down
        var m = musicState(), n = (m.repeat || 'all') === 'off' ? M.nextId(1) : M.nextId(1);
        if (!n) { if (R.host) writeMusic({ playing: false, pos: 0 }); return; }
        M.play(n);
        if (R.host) writeMusic({ id: n, playing: true, t0: Date.now(), pos: 0 });
      };
    }
    var m = musicState(), s = M.state();
    var sw2 = $('mus-open'); if (sw2) sw2.checked = !!m.open;
    if (m.mood && m.mood !== s.mood) M.setMood(m.mood);
    if ((m.repeat || 'all') !== s.repeat) M.setRepeat(m.repeat || 'all');
    var key = JSON.stringify([m.id, m.playing, m.t0, m.pos]);
    if (key === R.musicKey) { if (R.player) R.player.redraw(); return; }
    R.musicKey = key;
    if (!m.id) { if (s.playing) M.pause(); if (R.player) R.player.redraw(); return; }
    var dur = (M.track(m.id) || {}).dur || 0, at = m.playing ? (Date.now() - (m.t0 || Date.now())) / 1000 : (m.pos || 0);
    if (dur && at > dur) at = (m.repeat || 'all') === 'one' ? at % dur : Math.max(0, dur - 0.5);
    if (m.id !== s.id) { M.play(m.id, { at: at, paused: !m.playing }); return; }
    if (!m.playing) { if (s.playing) M.pause(); M.seek(at); return; }
    if (Math.abs(s.time - at) > 2) M.seek(at);
    if (!s.playing) M.resume();
  }

  function drawAll() { syncOrder(); turnSounds(); syncMusic(); drawTop(); drawBanner(); drawMap(); drawPhases(); drawLoadout(); drawCard(); drawLog(); drawMine(); }

  // ---------- Personal Bestiary: fight a creature, add it, and from then on see its stats ----------
  async function loadBestiary() {
    R.myBest = {};
    if (!me) return;
    var r = await db.from('player_bestiary').select('creature');
    if (r.error) { R.bestOff = true; return; }
    (r.data || []).forEach(function (x) { R.myBest[x.creature] = true; });
  }
  async function bestList() { if (!R.bestJson) R.bestJson = await fetch('bestiary.json?v=40e559a0').then(function (r) { return r.json(); }); return R.bestJson; }
  function statBlock(b) {
    return el('div', { class: 'cb-beast' }, [
      el('p', { class: 'cb-beast-tags', text: 'Rank ' + b.rank + ' · ' + [b.type, b.size, b.elements].filter(Boolean).join(' · ') }),
      el('div', { class: 'cb-beast-stats' }, [['Attack', b.attack], ['Defense', b.defense], ['Damage', b.damage], ['Move', b.move], ['BDT', b.bdt], ['Mana', b.mana]].map(function (x) { return el('span', {}, [el('small', { text: x[0] }), el('b', { text: String(x[1]) })]); })),
      el('ul', { class: 'cb-beast-ab' }, (b.abilities || []).map(function (ab) { return el('li', {}, [el('b', { text: ab.name + ': ' }), ab.text]); })),
      b.trait ? el('p', {}, [el('b', { text: 'Trait: ' }), b.trait]) : null,
      b.found ? el('p', {}, [el('b', { text: 'Found: ' }), b.found]) : null,
      b.loot ? el('p', {}, [el('b', { text: 'Loot: ' }), b.loot]) : null]);
  }
  function bestiaryBlock(c) {
    var cr = (c.stats || {}).creature; if (!cr || !cr.id || R.bestOff || !me) return null;
    var wrap = el('div', { class: 'cb-bestbox' }, [el('h3', { class: 'px', text: 'Bestiary' })]);
    if (R.myBest[cr.id]) {
      var hold = el('div'); wrap.appendChild(hold);
      bestList().then(function (L) { var b = L.filter(function (x) { return x.id === cr.id; })[0]; if (b) hold.appendChild(statBlock(b)); });
    } else if (ST().started) {
      wrap.appendChild(el('p', { class: 'cb-desc', text: 'You have fought a ' + c.name.replace(/ \d+$/, '') + '. Add it to your Bestiary to see its stats from now on.' }));
      wrap.appendChild(el('button', { class: 'act cb-mini primary', type: 'button', text: 'Add to My Bestiary', onclick: async function (e) {
        e.target.disabled = true;
        var b0 = (await bestList()).filter(function (x) { return x.id === cr.id; })[0];
        var r = await db.from('player_bestiary').insert({ creature: cr.id, name: b0 ? b0.name : c.name });
        if (r.error && !/duplicate/i.test(r.error.message || '')) { e.target.disabled = false; alert(A.friendly(r.error)); return; }
        R.myBest[cr.id] = true; sfx('buff'); drawAll();
      } }));
    } else wrap.appendChild(el('p', { class: 'cb-desc', text: 'Fight one to add it to your Bestiary.' }));
    wrap.appendChild(el('p', { class: 'cb-desc' }, [el('a', { href: 'my-bestiary.html', target: '_blank', text: 'Open My Bestiary' })]));
    return wrap;
  }

  // ---------- Slide-out drawers: music on the left, your sheets on the right ----------
  function drawer(side, label, icon) {
    var d = el('aside', { class: 'cb-drawer ' + side, id: 'cb-drawer-' + side, 'aria-label': label, 'aria-hidden': 'true' });
    var tab = el('button', { type: 'button', class: 'cb-drawer-tab ' + side, 'aria-controls': d.id, 'aria-expanded': 'false', onclick: function () { toggleDrawer(side); } }, [el('span', { 'aria-hidden': 'true', text: icon }), el('span', { class: 'lbl', text: label })]);
    var close = el('button', { type: 'button', class: 'cb-drawer-x', 'aria-label': 'Close ' + label, text: '×', onclick: function () { toggleDrawer(side, false); } });
    d.appendChild(el('div', { class: 'cb-drawer-head' }, [el('h2', { class: 'px', text: label }), close]));
    var body = el('div', { class: 'cb-drawer-body' }); d.appendChild(body);
    document.body.appendChild(d); document.body.appendChild(tab);
    return body;
  }
  function toggleDrawer(side, open) {
    var d = $('cb-drawer-' + side), tab = document.querySelector('.cb-drawer-tab.' + side);
    if (open === undefined) open = !d.classList.contains('open');
    ['left', 'right'].forEach(function (s2) { if (s2 !== side && open) { var o = $('cb-drawer-' + s2); if (o) { o.classList.remove('open'); o.setAttribute('aria-hidden', 'true'); document.querySelector('.cb-drawer-tab.' + s2).setAttribute('aria-expanded', 'false'); } } });
    d.classList.toggle('open', open); d.setAttribute('aria-hidden', String(!open)); tab.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('cb-drawer-open', !!document.querySelector('.cb-drawer.open'));
    if (open) { var f = d.querySelector('button, select, input'); if (f) f.focus(); }
  }
  // Your sheets: the character sheet, and below it the combat sheet (your card and loadout), kept up to date as you spend mana and AP
  function drawMine() {
    var box = $('cb-mine'); if (!box) return;
    var mine = list().filter(function (c) { return c.owner === me.id && c.kind !== 'npc'; });
    if (!mine.length) { box.textContent = ''; box.appendChild(el('p', { class: 'cb-desc', text: 'Bring a character into the fight to see your sheets here.' })); R.mineSel = null; return; }
    if (!mine.some(function (c) { return c.id === R.mineSel; })) R.mineSel = mine[0].id;
    var c = R.cs[R.mineSel];
    if (!box.querySelector('.cb-mine-pick') || box.getAttribute('data-n') !== String(mine.length) + c.id) {
      box.textContent = ''; box.setAttribute('data-n', String(mine.length) + c.id);
      if (mine.length > 1) {
        var sel = el('select', { class: 'cb-mine-pick', 'aria-label': 'Whose sheets' }, mine.map(function (m) { return opt(m.id, m.name, m.id === c.id); }));
        sel.addEventListener('change', function () { R.mineSel = sel.value; drawMine(); });
        box.appendChild(sel);
      } else box.appendChild(el('span', { class: 'cb-mine-pick', hidden: true }));
      if (c.character_id) box.appendChild(el('details', { class: 'cb-mine-sec' }, [el('summary', { text: 'Character Sheet' }),
        el('iframe', { class: 'cb-sheetframe', title: c.name + '’s character sheet', loading: 'lazy', src: '../characters/view.html?id=' + encodeURIComponent(c.character_id) + '&embed=1' })]));
      box.appendChild(el('details', { class: 'cb-mine-sec', open: true }, [el('summary', { text: 'Combat Sheet' }), el('div', { class: 'cb-card cb-mine-card' }), el('div', { class: 'cb-mine-lo' })]));
    }
    drawCard(box.querySelector('.cb-mine-card'), c);
    drawLoadout(box.querySelector('.cb-mine-lo'), c);
  }

  // ---------- top box ----------
  function drawTop() {
    var t = $('cb-top'); t.textContent = '';
    var s = ST(), cur = current();
    t.appendChild(el('div', {}, [el('h1', { class: 'px', text: R.enc.name }),
      el('div', { class: 'cb-sub' }, ['Storyteller: ' + (R.players[R.enc.host] || '') + '. ' + (R.enc.public ? 'Public fight' : 'Private fight') + '. Join code ', el('span', { class: 'cb-code', text: R.enc.code })])]));
    var status = s.started ? 'Round ' + s.round + ': ' + (cur ? cur.name + '’s turn, ' + PHASES[s.phase][0] + ' Phase' : 'nobody left in the order') : s.order.length ? 'Turn order is set. Ready to start.' : 'Setting up: bring characters, add NPCs, then set the turn order.';
    var bar = el('div', { class: 'cb-bar' }, [el('span', { class: 'cb-round', text: status }), soundCtl()]);
    if (R.host) {
      if (!s.started) bar.appendChild(el('button', { class: 'act primary', type: 'button', text: 'Start Combat', disabled: !s.order.length, title: s.order.length ? null : 'Set the turn order first', onclick: startCombat }));
      else bar.appendChild(el('button', { class: 'act', type: 'button', text: 'Stop Combat', title: 'Back to setup; health and positions stay', onclick: function () { saveState({ started: false, phase: 0, t: {} }); } }));
      bar.appendChild(el('button', { class: 'act', type: 'button', text: 'Add NPC', onclick: npcDialog }));
      bar.appendChild(el('button', { class: 'act', type: 'button', text: 'Map', onclick: mapDialog }));
      bar.appendChild(el('button', { class: 'act', type: 'button', text: R.enc.open ? 'Close Joining' : 'Open Joining', onclick: function () { db.from('encounters').update({ open: !R.enc.open }).eq('id', R.enc.id).then(refresh); } }));
      bar.appendChild(el('button', { class: 'act', type: 'button', text: R.enc.public ? 'Make Private' : 'Make Public', onclick: function () { db.from('encounters').update({ public: !R.enc.public }).eq('id', R.enc.id).then(refresh); } }));
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
  async function startCombat() {
    var s = ST(); if (!s.order.length) return;
    await saveState({ started: true, round: 1, turn: 0, phase: 0, t: {} });
    var first = current();
    await note('Combat starts. Round 1: ' + (first ? first.name : '') + ' goes first.');
  }

  // ---------- banner of names ----------
  function drawBanner() {
    var b = $('cb-banner'); b.textContent = '';
    var s = ST(), cur = current();
    var names = el('div', { class: 'cb-names', role: 'list' });
    order().forEach(function (c, i) {
      var inOrder = s.order.indexOf(c.id) >= 0;
      names.appendChild(el('button', { type: 'button', role: 'listitem', class: 'cb-chip ' + c.side + (cur && cur.id === c.id ? ' turn' : '') + (R.sel === c.id ? ' sel' : '') + (incap(c) ? ' down' : '') + (inOrder ? '' : ' new'),
        title: 'Initiative ' + c.initiative + (inOrder ? '' : '. Not in the turn order yet'), onclick: function () { R.sel = c.id; R.moving = (c.x === null || c.x === undefined) && mayMove(c) ? c.id : null; drawAll(); } },
        [s.order.length && inOrder ? el('span', { class: 'cb-chip-n', text: String(s.order.indexOf(c.id) + 1) }) : null, c.name]));
    });
    if (!names.children.length) names.appendChild(el('span', { class: 'cv-muted', text: 'Nobody here yet. Bring a character, or the Storyteller can add NPCs.' }));
    b.appendChild(names);
    if (R.host) b.appendChild(el('button', { class: 'act primary cb-orderbtn', type: 'button', text: s.order.length ? 'Reset Turn Order' : 'Set Turn Order', onclick: orderDialog }));
  }
  function orderDialog() {
    var s = ST();
    var d = dialog('Set Turn Order');
    var mode = el('div', { class: 'cb-vis' }, [
      el('label', {}, [el('input', { type: 'radio', name: 'ord', value: 'initiative', checked: s.mode !== 'team' }), el('span', {}, [el('b', { text: 'Strict Initiative' }), el('small', { text: 'Everyone mixed together, highest Initiative first.' })])]),
      el('label', {}, [el('input', { type: 'radio', name: 'ord', value: 'team', checked: s.mode === 'team' }), el('span', {}, [el('b', { text: 'By Team' }), el('small', { text: 'One side takes all its turns, then the other. Initiative orders each side.' })])])]);
    var first = el('select', { id: 'ord-first' }, [opt('party', 'Players first', s.first !== 'enemy'), opt('enemy', 'Enemies first', s.first === 'enemy')]);
    var inits = el('div', { class: 'cb-inits' });
    list().sort(byInit).forEach(function (c) {
      var inp = el('input', { type: 'number', value: String(c.initiative), min: '0', max: '60', 'aria-label': 'Initiative for ' + c.name, 'data-id': c.id });
      inits.appendChild(el('label', {}, [el('span', { class: 'cb-side ' + c.side }), el('span', { text: c.name }), inp]));
    });
    d.body.appendChild(el('div', { class: 'cb-f' }, [mode, field('If by team, who goes first', first), el('h3', { class: 'px', text: 'Initiative' }), inits,
      el('p', { class: 'cb-desc', text: 'Characters use Dexterity + Perception. Change any number before setting the order.' })]));
    d.ok('Set Order', async function () {
      var ups = [];
      inits.querySelectorAll('input').forEach(function (inp) { var c = R.cs[inp.getAttribute('data-id')], v = +inp.value || 0; if (c && c.initiative !== v) { c.initiative = v; ups.push(db.from('combatants').update({ initiative: v }).eq('id', c.id)); } });
      await Promise.all(ups);
      var m = (d.el.querySelector('input[name=ord]:checked') || {}).value || 'initiative';
      var o = computeOrder(m, first.value);
      var patch = { order: o, mode: m, first: first.value };
      if (s.started) { var cur = current(); patch.turn = Math.max(0, o.indexOf(cur ? cur.id : '')); }
      else { patch.turn = 0; patch.phase = 0; patch.t = {}; }
      await saveState(patch);
      await note('Turn order set (' + (m === 'team' ? 'by team, ' + (first.value === 'enemy' ? 'enemies' : 'players') + ' first' : 'strict Initiative') + '): ' + o.map(function (id) { return R.cs[id].name; }).join(', ') + '.');
    });
    d.open();
  }

  // ---------- arena ----------
  function zonesOf(c) { var n = +((c.stats || {}).zones) || 1; return Math.max(1, Math.min(6, n)); }
  function drawMap() {
    var m = R.enc.map || {}, cols = m.cols || 6, rows = m.rows || 8;
    var wrap = $('cb-map'); wrap.textContent = '';
    var size = Math.max(36, Math.min(72, Math.floor((wrap.clientWidth - 30) / cols) - 3));
    var th = THEMES.filter(function (t) { return t[0] === m.theme; })[0] || THEMES[0], ter = m.terrain || {};
    var grid = el('div', { class: 'cb-map ' + (th[2] ? 'tiled ' + th[0] : th[0]), role: 'grid', 'aria-label': 'Battle map, ' + cols + ' by ' + rows + ' zones', style: 'grid-template-columns:repeat(' + cols + ', var(--z));grid-template-rows:repeat(' + rows + ', var(--z));--z:' + size + 'px' });
    var at = {}, placed = list().filter(function (c) { return c.x !== null && c.x !== undefined && c.y !== null; });
    placed.forEach(function (c) { var n = zonesOf(c); for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) at[(c.x + i) + ',' + (c.y + j)] = c; });
    var s = ST(), cur = current(), mover = R.moving ? R.cs[R.moving] : null;
    var counted = !!(mover && s.started && cur && mover.id === cur.id && (s.phase === 2 || s.phase === 5));
    var mn = mover ? zonesOf(mover) : 1, left = mover ? (counted ? moveLeft(mover) : 99) : 0;
    function terAt(x, y, eff) { for (var i = 0; i < mn; i++) for (var j = 0; j < mn; j++) { var t = TER[ter[(x + i) + ',' + (y + j)]]; if (t && (eff === 'difficult' ? t[3] === 'difficult' || t[3] === 'cover' : t[3] === eff)) return true; } return false; }
    function fits(x, y) { // a token of the mover's size could stand with its top-left corner here
      if (x + mn > cols || y + mn > rows || terAt(x, y, 'block')) return false;
      for (var i = 0; i < mn; i++) for (var j = 0; j < mn; j++) { var o = at[(x + i) + ',' + (y + j)]; if (o && o.id !== mover.id) return false; }
      return true;
    }
    // Cheapest way to each zone, in AP. Blocked zones cannot be crossed. Free movement can carry you into difficult terrain,
    // but it ends there; from then on every zone (in or out) is bought: 1, then 2 more, then 3 more AP.
    var path = {};
    if (mover && mover.x !== null && mover.x !== undefined) {
      var t0 = s.t, ap0 = counted ? (mover.ap || 0) : 99;
      var start = { x: mover.x, y: mover.y, free: counted ? freeLeft(mover) : 99, pre: counted ? preLeft() : 0, paid: counted ? (t0.paid || 0) : 0, stuck: counted ? !!t0.stuck : false, ap: 0, steps: 0, freeUsed: 0, preUsed: 0 };
      var q = [start], seen = {};
      while (q.length) {
        q.sort(function (a, b) { return a.ap - b.ap || a.steps - b.steps; });
        var n0 = q.shift(), sk = [n0.x, n0.y, n0.free, n0.pre, n0.paid, n0.stuck].join(',');
        if (seen[sk]) continue; seen[sk] = 1;
        var key0 = n0.x + ',' + n0.y, best = path[key0];
        if (n0.steps && (!best || n0.ap < best.ap || (n0.ap === best.ap && n0.free + n0.pre > best.free + best.pre))) path[key0] = n0;
        for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
          if (!dx && !dy) continue;
          var nx = n0.x + dx, ny = n0.y + dy;
          if (nx < 0 || ny < 0 || nx + mn > cols || ny + mn > rows || terAt(nx, ny, 'block')) continue;
          var diff = terAt(nx, ny, 'difficult'), nn = Object.assign({}, n0, { x: nx, y: ny, steps: n0.steps + 1 });
          if (!counted) { if (nn.steps > 40) continue; q.push(nn); continue; }
          if (!n0.stuck && n0.free > 0) { nn.free--; nn.freeUsed++; }
          else if (n0.pre > 0) { nn.pre--; nn.preUsed++; }
          else { if (n0.paid >= 3) continue; nn.paid++; nn.ap += nn.paid; if (nn.ap > ap0) continue; }
          if (diff) { nn.stuck = true; nn.free = 0; }
          q.push(nn);
        }
      }
    }
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) (function (x, y) {
      var c = at[x + ',' + y];
      var label = String.fromCharCode(65 + x) + (y + 1);
      var pth = path[x + ',' + y], dist = pth ? pth.steps : 0, apCost = pth && counted ? pth.ap : 0;
      var placing0 = mover && (mover.x === null || mover.x === undefined);
      var reach = mover && fits(x, y) && !(x === mover.x && y === mover.y) && (placing0 || !!pth);
      var tk = TER[ter[x + ',' + y]];
      var z = el('button', { type: 'button', class: 'cb-zone' + (reach ? ' target' : '') + (R.editTer ? ' edit' : ''), style: 'grid-column:' + (x + 1) + ';grid-row:' + (y + 1) + (th[2] ? ';' + tileStyle(th[2], size) : ''),
        title: tk ? tk[1] + '. ' + TER_TEXT[tk[3]] : (reach && apCost ? 'Costs ' + apCost + ' AP' : null),
        'aria-label': 'Zone ' + label + (tk ? ', ' + tk[1] : '') + (c ? ': ' + c.name : ', empty') + (reach && apCost ? ', costs ' + apCost + ' AP' : '') }, [el('span', { class: 'lab', text: label })]);
      if (tk) z.appendChild(el('span', { class: 'cb-ter ' + tk[3] }, [/^(Floor|Pit):/.test(tk[2]) ? el('span', { class: 'cb-ter-tile', style: tileStyle(tk[2], size) }) : objNode(tk[2], Math.max(32, Math.floor(size * 0.8 / 16) * 16))]));
      if (reach && apCost) z.appendChild(el('span', { class: 'cb-apcost', text: '+' + apCost + ' AP' }));
      z.addEventListener('click', function () {
        if (R.editTer && R.host) { setTerrain(x, y, R.editTer === 'erase' ? null : R.editTer); return; }
        if (!mover || !reach) { if (c) pickToken(c); return; }
        var placing = mover.x === null || mover.x === undefined, fromX = mover.x, fromY = mover.y;
        R.moving = null;
        upd(mover, apCost ? { x: x, y: y, ap: (mover.ap || 0) - apCost } : { x: x, y: y });
        if (apCost) note(mover.name + ' spends ' + apCost + ' AP to move' + (pth.stuck ? ' through difficult terrain' : ' farther') + '.');
        if (tk && tk[3] === 'hazard') note(mover.name + ' enters ' + tk[1] + ': roll Fortitude + Endurance or catch Burning.');
        if (counted && !placing) {
          var t = Object.assign({}, ST().t);
          markDone({ moved: (t.moved || 0) + pth.freeUsed, extraUsed: (t.extraUsed || 0) + pth.preUsed, paid: pth.paid, stuck: pth.stuck,
            last: { id: mover.id, x: fromX, y: fromY, dist: dist, ap: apCost, prev: { moved: t.moved || 0, extraUsed: t.extraUsed || 0, paid: t.paid || 0, stuck: !!t.stuck }, phase: s.phase, wasDone: !!(t.done || {})[s.phase] } });
        }
      });
      grid.appendChild(z);
    })(x, y);
    // Tokens sit on top, spanning as many zones as the creature fills
    placed.forEach(function (c) {
      var n = zonesOf(c), sp = (c.stats || {}).sprite, tg = R.targeting ? R.targeting.ok[c.id] : null;
      var tgc = R.targeting ? (tg && tg.ok ? ' tgt-ok' : tg && R.host ? ' tgt-far' : ' tgt-no') : '';
      var tok = el('span', { class: 'cb-token ' + c.side + (sp ? ' spr' : '') + (R.sel === c.id ? ' sel' : '') + (cur && cur.id === c.id ? ' turn' : '') + (incap(c) ? ' down' : '') + (c.hidden ? ' hid' : ''), text: sp || c.pic_url ? '' : initials(c.name) });
      if (sp) tok.appendChild(spriteNode(sp, Math.max(32, Math.floor((size * n + 3 * (n - 1)) * 0.78 / 16) * 16)));
      else if (c.pic_url) tok.style.backgroundImage = 'url("' + c.pic_url.replace(/"/g, '') + '")';
      var cell = el('button', { type: 'button', class: 'cb-tokcell' + (mover && mover.id !== c.id ? ' pass' : '') + tgc, style: 'grid-column:' + (c.x + 1) + ' / span ' + n + ';grid-row:' + (c.y + 1) + ' / span ' + n,
        title: R.targeting ? (tg && tg.ok ? 'Target ' + c.name + (tg.cover ? ' (half cover, -2 dice)' : '') : tg ? tg.why + (R.host ? '. As Storyteller you can still pick it.' : '') : null) : null,
        'aria-label': c.name + (n > 1 ? ' (' + n + 'x' + n + ')' : '') + (R.targeting ? (tg && tg.ok ? ', in range' : ', out of range') : ''),
        onclick: function () { if (R.targeting) { if (tg && (tg.ok || R.host)) chooseTarget(c, tg); return; } pickToken(c); } }, [tok]);
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
    var hint;
    if (R.targeting) {
      var tgA = R.targeting.act, okN = Object.keys(R.targeting.ok).filter(function (k) { return R.targeting.ok[k].ok; }).length;
      wrap.appendChild(el('div', { class: 'ff-target' }, [
        el('p', {}, [el('span', { class: 'ff-hand', 'aria-hidden': 'true', text: '▶' }), el('b', { text: tgA.label }), ': pick a target. Range: ' + tgA.range.text + '.' + (okN ? '' : ' Nothing is in range.')]),
        el('div', { class: 'button-row' }, [
          tgA.kind !== 'attack' ? el('button', { class: 'act cb-mini', type: 'button', text: 'No target', onclick: function () { chooseTarget(null, null); } }) : null,
          R.multi && R.multi.left > 0 ? el('button', { class: 'act cb-mini', type: 'button', text: 'Skip the remaining attacks', onclick: function () { skipRest(R.targeting.c); } })
            : el('button', { class: 'act cb-mini', type: 'button', text: 'Back to the menu', onclick: function () { var cc = R.targeting.c; R.targeting = null; drawAll(); actionMenu(cc); } })])]));
    }
    if (R.targeting) hint = '';
    else if (mover) hint = counted ? 'Moving ' + mover.name + ': ' + left + ' zone' + (left === 1 ? '' : 's') + ' left this turn (diagonals count as 1). Pick a lit zone' + (mn > 1 ? ' for its top-left corner.' : '.') : 'Placing ' + mover.name + ': pick a lit zone' + (mn > 1 ? ' for its top-left corner (' + mn + 'x' + mn + ').' : '.');
    else if (!s.started) hint = 'Setup: pick your token, then any empty zone, to place it.';
    else if (canControl() && (s.phase === 2 || s.phase === 5)) hint = 'Pick ' + cur.name + ', then a lit zone, to move.';
    else hint = '';
    if (R.host) wrap.appendChild(terrainBar());
    var unplaced = list().filter(function (c) { return (c.x === null || c.x === undefined) && mineC(c); });
    var hintText = (hint + (unplaced.length ? ' Not on the map yet: ' + unplaced.map(function (c) { return c.name; }).join(', ') + '.' : '')).trim();
    if (hintText) wrap.appendChild(el('p', { class: 'cb-maphint', text: hintText }));
  }
  function terrainBar() {
    var bar = el('div', { class: 'cb-terbar' });
    bar.appendChild(el('button', { type: 'button', class: 'act cb-mini' + (R.editTer ? ' primary' : ''), text: R.editTer ? 'Done Editing Terrain' : 'Edit Terrain', onclick: function () { R.editTer = R.editTer ? null : 'boulder'; R.moving = null; drawMap(); } }));
    if (!R.editTer) return bar;
    var pal = el('div', { class: 'cb-pal', role: 'radiogroup', 'aria-label': 'Terrain to place' });
    [['block', 'Blocks movement'], ['cover', 'Cover'], ['difficult', 'Difficult terrain'], ['hazard', 'Hazards']].forEach(function (g) {
      pal.appendChild(el('span', { class: 'cb-pal-h', text: g[1] }));
      TERRAIN.filter(function (t) { return t[3] === g[0]; }).forEach(function (t) {
        var icon = /^(Floor|Pit):/.test(t[2]) ? el('span', { class: 'cb-pal-tile', style: tileStyle(t[2], 32) }) : objNode(t[2], 32);
        pal.appendChild(el('button', { type: 'button', role: 'radio', 'aria-checked': String(R.editTer === t[0]), class: 'cb-pal-b' + (R.editTer === t[0] ? ' on' : ''), title: t[1] + '. ' + TER_TEXT[t[3]], onclick: function () { R.editTer = t[0]; drawMap(); } }, [icon, el('span', { text: t[1] })]));
      });
    });
    pal.appendChild(el('button', { type: 'button', role: 'radio', 'aria-checked': String(R.editTer === 'erase'), class: 'cb-pal-b' + (R.editTer === 'erase' ? ' on' : ''), onclick: function () { R.editTer = 'erase'; drawMap(); } }, [el('span', { class: 'cb-erase', text: '✕' }), el('span', { text: 'Erase' })]));
    bar.appendChild(pal);
    bar.appendChild(el('p', { class: 'cb-desc', text: 'Pick a piece, then click zones to place it. Click a zone again to clear it. ' + (TER_TEXT[(TER[R.editTer] || [])[3]] || '') }));
    return bar;
  }
  function pickToken(c) { R.sel = c.id; R.moving = mayMove(c) ? (R.moving === c.id ? null : c.id) : null; drawAll(); }
  // Who may move a token right now
  function mayMove(c) {
    var s = ST(), cur = current();
    if (!mineC(c)) return false;
    if (!s.started || c.x === null || c.x === undefined) return true;   // setup, or placing a newcomer
    if (R.host && (!cur || c.id !== cur.id)) return true;              // the Storyteller can reposition anyone else
    return !!cur && c.id === cur.id && canControl() && (s.phase === 2 || s.phase === 5) && (moveLeft(c) > 0 || canBuyMore(c));
  }
  function initials(n) { return n.split(/\s+/).map(function (w) { return w.charAt(0); }).join('').slice(0, 3).toUpperCase(); }

  // ---------- phase buttons, down the right side of the arena ----------
  function drawPhases() {
    var box = $('cb-phases'); box.textContent = '';
    var s = ST(), cur = current(), ctl = canControl();
    box.appendChild(el('h3', { class: 'px', text: s.started && cur ? cur.name : 'Phases' }));
    if (!s.started) { box.appendChild(el('p', { class: 'cb-desc', text: 'The phases light up once the Storyteller starts combat.' })); }
    PHASES.forEach(function (p, i) {
      var isCur = s.started && i === s.phase, isPrev = s.started && i === s.phase - 1;
      var back = isPrev && !s.t.done[s.phase];
      var btn = el('button', { type: 'button', class: 'cb-phase' + (isCur ? ' cur' : '') + (s.started && i < s.phase ? ' past' : ''), disabled: !ctl || !(isCur || back),
        'aria-expanded': String(isCur), title: isCur ? 'Click when you are finished with this phase' : back ? 'Go back to this phase' : null,
        onclick: function () { if (isCur) finishPhase(); else if (back) saveState({ phase: i }); } },
        [el('span', { class: 'cb-phase-n', text: String(i + 1) }), el('span', { text: p[0] }), isCur ? el('span', { class: 'cb-phase-done', text: ctl ? 'Done' : '' }) : null]);
      box.appendChild(btn);
      if (isCur && cur) {
        var opts = el('div', { class: 'cb-phase-opts' });
        opts.appendChild(el('p', { class: 'cb-desc', text: p[1] }));
        if (ctl) phaseOptions(i, cur, opts); else opts.appendChild(el('p', { class: 'cb-desc', text: 'Waiting for ' + cur.name + (cur.owner === R.enc.host ? '' : ' (' + (R.players[cur.owner] || 'their player') + ')') + '.' }));
        box.appendChild(opts);
      }
    });
  }
  async function finishPhase() {
    var s = ST(), c = current(); if (!c) return;
    if (s.phase === 0) {
      await doUpkeep(c);
      var stuck = c.x !== null && c.x !== undefined && terrainAt(c.x, c.y, zonesOf(c));
      return saveState({ phase: 1, t: Object.assign({}, ST().t, { stuck: stuck }) });
    }
    if (s.phase === 6) return endTurn();
    await saveState({ phase: s.phase + 1 });
  }
  async function endTurn() {
    var s = ST();
    var o = R.host ? s.order.filter(function (id) { return R.cs[id]; }) : s.order;
    if (!o.length) return;
    var turn = (s.turn + 1) % o.length, round = s.round + (s.turn + 1 >= o.length ? 1 : 0);
    var patch = { turn: turn, round: round, phase: 0, t: {} }; if (R.host) patch.order = o;
    await saveState(patch);
    var c = current();
    await note('Round ' + round + ': ' + (c ? c.name : '') + '’s turn.' + (c && incap(c) ? ' ' + c.name + ' is Incapacitated.' : ''));
  }
  function regenOf(c) { var k = c.stats || {}; return (k.mana && k.mana.regen) || k.regen || 1; }
  async function doUpkeep(c) {
    var k = c.stats || {}, effects = (k.effects || []).slice(), paid = 0, kept = [], dropped = [];
    effects.forEach(function (e, i) { var pay = R.pay[c.id + ':' + i] !== false; if (pay) { paid += e.upkeep || 0; kept.push(e); } else dropped.push(e.name); });
    var mana = Math.max(0, Math.min(c.mana_max || 0, (c.mana || 0) + regenOf(c) + (k.hurt ? 1 : 0)) - paid);
    var aim = k.aim && k.aim.turns > 0 ? Object.assign({}, k.aim, { turns: k.aim.turns - 1 }) : null;
    var patch = { ap: Math.min(3, (c.ap || 0) + (k.hurt ? 2 : 1)), mana: mana, stats: Object.assign({}, k, { hurt: false, effects: kept, guard: null, aim: aim }) };
    await upd(c, patch);
    R.pay = {};
    await note(c.name + ' Upkeep: AP ' + patch.ap + ', mana ' + mana + (paid ? ' (paid ' + paid + ' upkeep)' : '') + (dropped.length ? '. Ended: ' + dropped.join(', ') : '') + '.');
  }
  function actBtn(label, sub, right, fn, disabled) {
    return el('button', { class: 'cb-act', type: 'button', disabled: !!disabled, onclick: fn }, [el('span', {}, [el('b', { text: label }), sub ? el('small', { text: sub }) : null]), right ? el('span', { class: 'pool', text: right }) : null]);
  }
  function group(title, key, kids) {
    var open = !!R.open[key];
    var g = el('div', { class: 'cb-group' });
    g.appendChild(el('button', { type: 'button', class: 'cb-group-h', 'aria-expanded': String(open), onclick: function () { R.open[key] = !open; drawPhases(); } }, [title, el('span', { text: open ? '−' : '+' })]));
    if (open) g.appendChild(el('div', { class: 'cb-group-b' }, kids));
    return g;
  }
  function prepared(list, keys) { keys = (keys || []).filter(Boolean); return keys.map(function (k2) { return (list || []).filter(function (x) { return x.key === k2; })[0]; }).filter(Boolean); }
  function phaseOptions(i, c, box) {
    var s = ST(), kit = c.stats || {}, t = s.t;
    if (i === 0) {
      var hurt = kit.hurt ? 2 : 1;
      var rg = regenOf(c);
      box.appendChild(el('p', { class: 'cb-line', text: '+1 AP & +' + rg + ' Mana, +2 AP & +' + (rg + 1) + ' Mana if damage taken last turn.' }));
      if (kit.hurt) box.appendChild(el('p', { class: 'cb-line', text: c.name + ' took damage, so this Upkeep gives +2 AP & +' + (rg + 1) + ' Mana.' }));
      (kit.effects || []).forEach(function (e, j) {
        var key = c.id + ':' + j, pay = R.pay[key] !== false;
        box.appendChild(el('label', { class: 'chk cb-line' }, [el('input', { type: 'checkbox', checked: pay, onchange: function (ev) { R.pay[key] = ev.target.checked; } }), 'Pay ' + (e.upkeep || 0) + ' mana to keep ' + e.name + ' running']));
      });
      (c.conditions || []).filter(function (x) { return ['Bleeding', 'Burning', 'Poisoned'].indexOf(x) >= 0; }).forEach(function (cd) {
        var pool = kit.npc ? (kit.defense || 0) : ((kit.attrs || {}).Fortitude || 0) + ((kit.abilities || {}).Endurance || 0);
        box.appendChild(actBtn('Roll for ' + cd, 'Fortitude + Endurance against the effect’s rating', pool + 'd', function () { rollDialog(c, { label: c.name + ' resists ' + cd, pool: pool, parts: [['Fortitude + Endurance', pool]], kind: 'roll', targetable: false }); }));
      });
      return;
    }
    if (i === 1) { box.appendChild(el('p', { class: 'cb-line', text: 'Say what you plan to do. Click Planning when everyone is ready.' })); return; }
    if (i === 2 || i === 5) {
      var free = freeLeft(c), pre = preLeft(), paid = t.paid || 0;
      box.appendChild(el('p', { class: 'cb-line' }, t.stuck ? ['In difficult terrain: no free movement this turn. Each zone costs AP', paid < 3 ? ' (next one: ' + (paid + 1) + ' AP).' : '; no more this turn.'] :
        ['Free movement left: ', el('b', { text: free + ' of ' + moveOf(c) }), ' zone' + (moveOf(c) === 1 ? '' : 's') + '.']));
      if (pre) box.appendChild(el('p', { class: 'cb-line', text: 'Bought with AP and not used yet: ' + pre + ' zone' + (pre === 1 ? '' : 's') + '.' }));
      box.appendChild(el('p', { class: 'cb-line', text: 'Past that, zones cost AP: 1, then 2 more, then 3 more. You can step into difficult terrain with free movement, but it ends there and getting out costs AP. Lit zones show the cost.' }));
      if (!R.moving && c.x !== null && c.x !== undefined && (free + pre > 0 || canBuyMore(c))) box.appendChild(actBtn('Move ' + c.name, 'Lights up the zones you can reach', null, function () { R.sel = c.id; R.moving = c.id; drawAll(); }));
      var lm = t.last;
      if (lm && lm.id === c.id && lm.phase === i) box.appendChild(actBtn('Undo last move', 'Back to ' + String.fromCharCode(65 + lm.x) + (lm.y + 1) + (lm.ap ? ' and get ' + lm.ap + ' AP back' : ''), null, async function () {
        await upd(c, lm.ap ? { x: lm.x, y: lm.y, ap: (c.ap || 0) + lm.ap } : { x: lm.x, y: lm.y });
        var t2 = Object.assign({}, ST().t, lm.prev || {}); t2.last = null; t2.done = Object.assign({}, t2.done); if (!lm.wasDone) delete t2.done[i];
        await saveState({ t: t2 });
      }));
      var apKids = [];
      for (var k = 1; k <= 3 - paid; k++) (function (k) {
        var costK = 0; for (var j = 1; j <= k; j++) costK += paid + j;
        apKids.push(actBtn('Spend ' + costK + ' AP', '+' + k + ' zone' + (k === 1 ? '' : 's') + ' of movement', costK + ' AP', async function () {
          if ((c.ap || 0) < costK) { alert(c.name + ' holds ' + (c.ap || 0) + ' AP. Allies can give AP first.'); return; }
          await upd(c, { ap: c.ap - costK });
          await markDone({ extra: (ST().t.extra || 0) + k, paid: paid + k });
          await note(c.name + ' spends ' + costK + ' AP for ' + k + ' more zone' + (k === 1 ? '' : 's') + ' of movement.');
        }, (c.ap || 0) < costK));
      })(k);
      if (apKids.length) box.appendChild(group('Spend AP to move farther (' + (c.ap || 0) + ' AP held)', 'apmove', apKids));
      var cost = t.items === 0 ? 0 : t.items === 1 ? 1 : 2;
      var items = (kit.belt || []).map(function (bi) {
        return actBtn(bi.slot + '. ' + bi.name, bi.detail || '', cost ? cost + ' AP' : 'free', async function () {
          if (cost && (c.ap || 0) < cost) { alert('This item costs ' + cost + ' AP and ' + c.name + ' holds ' + (c.ap || 0) + '.'); return; }
          if (cost) await upd(c, { ap: c.ap - cost });
          await markDone({ items: (t.items || 0) + 1 });
          await addRoll({ label: c.name + ' uses ' + bi.name + (bi.detail ? ' (' + bi.detail + ')' : '') + ' from the belt (' + (cost ? cost + ' AP' : 'free') + ').', combatant_id: c.id, detail: { kind: 'note' } });
        });
      });
      box.appendChild(group('Use an item (next one: ' + (cost ? cost + ' AP' : 'free') + ')', 'items', items.length ? items : [el('p', { class: 'cb-desc', text: kit.npc ? 'NPCs have no belt.' : 'Nothing on the belt. Set it on the character page, then Refresh Stats.' })]));
      return;
    }
    if (i === 3) {
      if (t.done[3]) { box.appendChild(el('p', { class: 'cb-line', text: 'Action taken. Click Action to move on to Damage.' })); return; }
      if (R.targeting) {
        box.appendChild(el('p', { class: 'cb-line', text: 'Pick a target on the map for ' + R.targeting.act.label + '.' }));
        if (R.multi && R.multi.left > 0) box.appendChild(actBtn('Skip the remaining attacks', 'End the Action here', null, function () { skipRest(c); }));
        else box.appendChild(actBtn('Back to the menu', 'Choose something else', null, function () { R.targeting = null; drawAll(); actionMenu(c); }));
        return;
      }
      if (R.multi && R.multi.c === c.id && R.multi.left > 0) {
        box.appendChild(el('p', { class: 'cb-line', text: R.multi.left + ' extra attack' + (R.multi.left === 1 ? '' : 's') + ' left this turn.' }));
        box.appendChild(actBtn('Next attack', 'Same attack, pick a target', null, function () { var b0 = R.multi.act; if (b0) nextAttack(c, b0); }));
        box.appendChild(actBtn('Skip the remaining attacks', 'End the Action here', null, function () { skipRest(c); }));
        return;
      }
      box.appendChild(el('button', { type: 'button', class: 'ff-open', onclick: function () { actionMenu(c); } }, [el('span', { class: 'ff-hand', 'aria-hidden': 'true', text: '▶' }), 'Open Action Menu']));
      box.appendChild(el('p', { class: 'cb-desc', text: 'Combat Actions, Attacks, Spells, and Social. Pick one, pick a target in range, then roll.' }));
      return;
    }
    if (i === 4) {
      var atk = t.attack ? R.rolls.filter(function (r) { return r.id === t.attack; })[0] : null;
      var dmg = atk ? R.rolls.filter(function (r) { return (r.detail || {}).kind === 'damage' && (r.detail || {}).of === atk.id; })[0] : null;
      if (!atk) { box.appendChild(el('p', { class: 'cb-line', text: 'No attack this turn. Click Damage to move on.' })); return; }
      var dr = R.rolls.filter(function (r) { return (r.detail || {}).vs === atk.id; })[0];
      if ((atk.detail || {}).social) {
        var wpd = R.rolls.filter(function (r) { return (r.detail || {}).kind === 'wpdmg' && r.detail.of === atk.id; })[0], st0 = R.cs[(atk.detail || {}).target];
        if (!dr) box.appendChild(el('p', { class: 'cb-line', text: 'Waiting for the defense roll.' }));
        else if (!dr.detail.hit) box.appendChild(el('p', { class: 'cb-line', text: 'The words did not land: ' + atk.successes + ' against ' + dr.successes + '. Click Damage to move on.' }));
        else if (wpd) box.appendChild(el('p', { class: 'cb-line', text: wpd.label + '. Click Damage to move on.' }));
        else if (st0) box.appendChild(actBtn('Deal ' + dr.detail.excess + ' Willpower damage', 'Social combat: each success over the defense is 1 Willpower damage to ' + st0.name, null, async function () {
          var row = await addRoll({ combatant_id: atk.combatant_id, label: dr.detail.excess + ' Willpower damage to ' + st0.name, detail: { kind: 'wpdmg', of: atk.id, target: st0.id, n: dr.detail.excess } });
          if (mineC(st0)) await applyWp(row);
          await markDone();
        }));
        return;
      }
      // One attack, or several from extra attacks: each hit rolls its own damage
      var ids = (t.attacks && t.attacks.length ? t.attacks : [t.attack]);
      var rows = ids.map(function (id) { return R.rolls.filter(function (r) { return r.id === id; })[0]; }).filter(Boolean);
      function dmgOf(a) { return R.rolls.filter(function (r) { return (r.detail || {}).kind === 'damage' && (r.detail || {}).of === a.id; })[0]; }
      function defOf(a) { return R.rolls.filter(function (r) { return (r.detail || {}).vs === a.id; })[0]; }
      function allDone() { return rows.every(function (a) { var d0 = defOf(a); return dmgOf(a) || (d0 && !d0.detail.hit); }); }
      rows.forEach(function (a, n) {
        var d0 = defOf(a), dm0 = dmgOf(a), tg = R.cs[(a.detail || {}).target], pre = rows.length > 1 ? 'Attack ' + (n + 1) + (tg ? ' on ' + tg.name : '') + ': ' : '';
        if (d0) box.appendChild(el('p', { class: 'cb-line', text: pre + (d0.detail.hit ? 'Hit, ' + a.successes + ' against ' + d0.successes + ', so ' + d0.detail.excess + ' carry to damage.' : 'Missed, ' + a.successes + ' against ' + d0.successes + '.') }));
        if (!dm0 && (!d0 || d0.detail.hit)) box.appendChild(actBtn('Roll Damage' + (rows.length > 1 ? ' (attack ' + (n + 1) + ')' : ''), a.label, null, function () { damageDialog(a, function () { return allDone() ? markDone() : null; }); }));
        else if (dm0) box.appendChild(el('p', { class: 'cb-line', text: pre + 'Damage rolled: ' + dm0.label + '.' }));
      });
      if (allDone()) box.appendChild(el('p', { class: 'cb-line', text: rows.some(dmgOf) ? 'Apply damage from the Roll Log, then click Damage.' : 'No damage to roll. Click Damage to move on.' }));
      return;
    }
    if (i === 6) {
      var nxt = (function () { var o = s.order.filter(function (id) { return R.cs[id]; }); return o.length ? R.cs[o[(s.turn + 1) % o.length]] : null; })();
      box.appendChild(el('p', { class: 'cb-line', text: 'Resolve anything that ends this turn. Click Ending to pass the turn' + (nxt ? ' to ' + nxt.name : '') + '.' }));
    }
  }
  function loadoutLink(c) {
    return c.character_id && c.owner === me.id ? el('a', { href: '../characters/view.html?id=' + encodeURIComponent(c.character_id), target: '_blank', rel: 'noopener', text: 'Prepare some on the Combat Loadout tab' }) : 'Their player prepares them on the Combat Loadout tab';
  }

  // ---------- loadout box (only the player and the Storyteller) ----------
  function drawLoadout(box0, c0) {
    var box = box0 || $('cb-loadout'); box.textContent = '';
    var c = c0 || (R.sel ? R.cs[R.sel] : current());
    if (!c) { box.appendChild(el('h2', { class: 'px', text: 'Combat Loadout' })); box.appendChild(el('p', { class: 'center cv-muted', text: 'Click a name in the banner to see their loadout.' })); return; }
    box.appendChild(el('h2', { class: 'px', text: c.name + '’s Loadout' }));
    if (!mineC(c)) { box.appendChild(el('p', { class: 'center cv-muted', text: 'Only ' + (c.kind === 'npc' ? 'the Storyteller' : (R.players[c.owner] || 'their player') + ' and the Storyteller') + ' can see this loadout.' })); return; }
    var kit = c.stats || {}, LO = kit.loadout || {};
    var g = el('div', { class: 'cb-lo' });
    if (kit.npc) {
      g.appendChild(loCard('Stats', [loRow('Attack / Defense', (kit.attack || 0) + ' / ' + (kit.defense || 0)), loRow('Damage', String(kit.damage || 0)), loRow('Move', String(kit.move || 1)), kit.creature ? loRow('Rank', kit.creature.rank + ', ' + [kit.creature.type, kit.creature.size, kit.creature.elements].filter(Boolean).join(', ')) : null]));
      g.appendChild(loCard('Attacks and Traits', ((kit.creature || {}).abilities || []).map(function (ab) { return loRow(ab.name, ab.text); }).concat(kit.creature && kit.creature.trait ? [loRow('Trait', kit.creature.trait)] : []).concat(!kit.creature && kit.notes ? [el('p', { class: 'cb-desc', text: kit.notes })] : [])));
      g.appendChild(loCard('Defend', [actBtn('Defense roll', 'Use when attacked', String(kit.defense || 0), function () { rollDialog(c, { label: c.name + ': Defense', pool: kit.defense || 0, parts: [['Defense pool', kit.defense || 0]], kind: 'defense', targetable: false }); })]));
    } else {
      var armed = (kit.weapons || []).map(function (w) { var stn = (LO.weapons || {})[w.key] || ((kit.styles || []).length === 1 ? kit.styles[0].name : ''); return loRow(w.name, w.slot + (stn ? ', ' + stn : '') + (w.bonus ? ', +' + w.bonus + ' ' + (w.cat || '') : '')); });
      g.appendChild(loCard('Weapons', armed.length ? armed : [el('p', { class: 'cb-desc', text: 'No weapons.' })]));
      g.appendChild(loCard('Prepared Maneuvers', prepared(kit.maneuvers, LO.maneuvers).map(function (m) { return loRow(m.name, m.style + ' Rank ' + m.rank + '. ' + m.text); }).concat(!(LO.maneuvers || []).filter(Boolean).length ? [el('p', { class: 'cb-desc' }, ['None prepared. ', loadoutLink(c), '.'])] : [])));
      g.appendChild(loCard('Prepared Spells', prepared(kit.spells, LO.spells).map(function (x) { return loRow(x.name, x.school + ' ' + x.rank + ', ' + (x.costText || x.cost) + ' mana. ' + [x.type, x.range].filter(Boolean).join('. ')); }).concat(!(LO.spells || []).filter(Boolean).length ? [el('p', { class: 'cb-desc' }, ['None prepared.'])] : [])));
      g.appendChild(loCard('Summons', prepared(kit.summons, LO.summons).map(function (x) { return loRow(x.name, x.kind + '. ' + (x.text || '')); }).concat(!(LO.summons || []).filter(Boolean).length ? [el('p', { class: 'cb-desc', text: 'None prepared.' })] : [])));
      g.appendChild(loCard('Belt', (kit.belt || []).map(function (b) { return loRow(b.slot + '. ' + b.name, b.detail || ''); }).concat(!(kit.belt || []).length ? [el('p', { class: 'cb-desc', text: 'Empty.' })] : [])));
      g.appendChild(loCard('Defend', (kit.defenses || []).map(function (df) {
        var p = evalPool(df.pool, kit);
        return actBtn(df.name, df.pool, p.total + 'd', function () { rollDialog(c, { label: df.name, pool: p.total, parts: p.parts, unknown: p.unknown, kind: 'defense', targetable: false }); });
      })));
    }
    box.appendChild(g);
    if (c.character_id && c.owner === me.id) box.appendChild(el('div', { class: 'button-row center-row' }, [el('button', { class: 'act', type: 'button', text: 'Refresh Stats', onclick: function () { resync(c); } }), el('a', { class: 'act', href: '../characters/view.html?id=' + encodeURIComponent(c.character_id), target: '_blank', rel: 'noopener', text: 'Open Character Page' })]));
  }
  function loCard(title, kids) { return el('section', { class: 'cb-lo-card' }, [el('h3', { class: 'px', text: title })].concat(kids)); }
  function loRow(a, b) { return el('div', { class: 'cb-lo-row' }, [el('b', { text: a }), b ? el('small', { text: b }) : null]); }

  // ---------- title card (everyone sees it) ----------
  function boxesCol(c, k, label) {
    var n = (c.boxes || {})[k] || 0, h = (c.health || {})[k] || 0, can = mineC(c);
    var col = el('div', { class: 'cb-hcol', role: 'group', 'aria-label': label + ' ' + h + ' of ' + n }, [el('span', { class: 'cb-hhead', text: label })]);
    for (var i = 0; i < n; i++) (function (i) {
      col.appendChild(el('button', { type: 'button', class: 'cb-box ' + k + (i < h ? ' on' : ''), disabled: !can, 'aria-label': label + ' box ' + (i + 1), text: i < h ? '✕' : '', onclick: function () {
        var next = i < h && i === h - 1 ? i : i + 1;
        var hh = Object.assign({}, c.health); hh[k] = next;
        var stats = Object.assign({}, c.stats || {}); if (next > h) stats.hurt = true;
        upd(c, { health: hh, stats: stats });
      } }));
    })(i);
    return col;
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
  function drawCard(box0, c0) {
    var box = box0 || $('cb-card'); box.textContent = '';
    var c = c0 || (R.sel ? R.cs[R.sel] : current());
    if (!c) { box.appendChild(el('p', { class: 'center cv-muted', text: 'Click a name in the banner to see their card.' })); return; }
    var can = mineC(c), bdt = c.bdt || 1, cur = current();
    var csp = (c.stats || {}).sprite;
    var pic = el('div', { class: 'cb-portrait ' + c.side, text: c.pic_url || csp ? '' : initials(c.name) });
    if (c.pic_url) pic.style.backgroundImage = 'url("' + c.pic_url.replace(/"/g, '') + '")';
    else if (csp) pic.appendChild(spriteNode(csp, 112));
    box.appendChild(pic);
    if (can) box.appendChild(el('div', { class: 'center' }, [el('button', { class: 'act cb-mini', type: 'button', text: csp ? 'Change Sprite' : 'Choose a Sprite', onclick: function () {
      pickSprite(csp, async function (spec) {
        await upd(c, { stats: Object.assign({}, c.stats || {}, { sprite: spec }) });
        if (c.character_id && c.owner === me.id) { // keep it with the character for every fight
          var row = await db.from('characters').select('sheet').eq('id', c.character_id).single();
          if (row.data) await db.from('characters').update({ sheet: Object.assign({}, row.data.sheet, { sprite: spec }) }).eq('id', c.character_id);
        }
      });
    } })]));
    box.appendChild(el('h2', { class: 'px cb-card-name', text: c.name }));
    box.appendChild(el('p', { class: 'cb-sub center', text: (c.kind === 'pc' ? 'Played by ' + (R.players[c.owner] || '') : c.kind === 'summon' ? 'SumMonz of ' + (R.players[c.owner] || '') : 'NPC') + ' · ' + ({ party: 'Party', enemy: 'Enemy', neutral: 'Neutral' }[c.side]) + ' · Initiative ' + c.initiative + (cur && cur.id === c.id ? ' · Their turn' : '') + (c.hidden ? ' · Hidden from players' : '') }));
    if (incap(c)) box.appendChild(el('p', { class: 'cb-incap center', text: 'INCAPACITATED' }));
    box.appendChild(el('div', { class: 'cb-dts' }, [el('span', { text: 'BDT ' + bdt }), el('span', { text: 'LDT ' + bdt * 2 }), el('span', { text: 'ADT ' + bdt * 3 }), el('span', { text: 'Penalty -' + woundPenalty(c) })]));
    box.appendChild(el('div', { class: 'cb-health' }, [boxesCol(c, 'b', 'Bashing'), boxesCol(c, 'l', 'Lethal'), boxesCol(c, 'a', 'Aggravated')]));
    var ap = el('span', { class: 'cb-boxes' });
    for (var i = 0; i < Math.max(3, c.ap || 0); i++) (function (i) {
      ap.appendChild(el('button', { type: 'button', class: 'cb-box ap' + (i < c.ap ? ' on' : ''), disabled: !can, 'aria-label': 'AP ' + (i + 1), onclick: function () { upd(c, { ap: i < c.ap && i === c.ap - 1 ? i : i + 1 }); } }));
    })(i);
    box.appendChild(el('div', { class: 'cb-tracks' }, [
      el('div', { class: 'cb-track' }, [el('span', { text: 'AP' }), ap]),
      el('div', { class: 'cb-track' }, [el('span', { text: 'Mana' }), stepper(c, 'mana', 9999, 'Mana'), el('span', { class: 'cb-sub', text: 'of ' + c.mana_max + ', M/T ' + c.mt })]),
      el('div', { class: 'cb-track' }, [el('span', { text: 'Willpower' }), stepper(c, 'willpower', 10, 'Willpower')]),
      el('div', { class: 'cb-track' }, [el('span', { text: 'Move' }), el('span', { text: String(moveOf(c)) + ' zone' + (moveOf(c) === 1 ? '' : 's') })])]));
    var effects = (c.stats || {}).effects || [];
    if (effects.length) box.appendChild(el('p', { class: 'cb-sub', text: 'Running: ' + effects.map(function (e) { return e.name + ' (upkeep ' + e.upkeep + ')'; }).join(', ') }));
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
    box.appendChild(conds);
    if (c.kind === 'npc' && !mineC(c)) { var bb = bestiaryBlock(c); if (bb) box.appendChild(bb); }
    if (can) {
      var extra = el('div', { class: 'cb-bar', style: 'margin-top:8px;justify-content:center' });
      if (c.x !== null && c.x !== undefined) extra.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Off Map', onclick: function () { upd(c, { x: null, y: null }); } }));
      if (R.host && c.kind === 'npc') extra.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: c.hidden ? 'Reveal' : 'Hide', onclick: function () { upd(c, { hidden: !c.hidden }); } }));
      extra.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Remove', onclick: async function () { if (confirm('Remove ' + c.name + ' from the fight?')) { delete R.cs[c.id]; R.sel = null; drawAll(); await db.from('combatants').delete().eq('id', c.id); } } }));
      box.appendChild(extra);
    }
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
    var k = window.TerranaCharacter.combatKit();
    if (row.sheet && row.sheet.sprite) k.sprite = row.sheet.sprite;
    return k;
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
    await upd(c, { stats: Object.assign({}, k, { hurt: (c.stats || {}).hurt, sprite: k.sprite || (c.stats || {}).sprite, effects: (c.stats || {}).effects }), bdt: f.bdt, boxes: f.boxes, mana_max: f.mana_max, mt: f.mt, initiative: f.initiative, name: row.name });
  }
  // ---------- sprites: DawnLike by DragonDePlatino (palette by DawnBringer), CC BY-SA 3.0 ----------
  var SPR = null;
  async function sprites() { if (!SPR) SPR = await fetch('../assets/sprites/sprites.json?v=f1fb7495').then(function (r) { return r.json(); }); return SPR; }
  function sheetOf(id) { return SPR ? SPR.sheets.filter(function (x) { return x.id === id; })[0] : null; }
  // Two frames, swapped back and forth, for the bouncing idle
  function spriteNode(spec, px) {
    var p = String(spec).split(':'), sh = sheetOf(p[0]) || (p[0] === 'Reptile' ? { cols: 8, rows: 15, h: 15.5 } : null);
    var wrap = el('span', { class: 'cb-spr', style: 'width:' + px + 'px;height:' + px + 'px', 'aria-hidden': 'true' });
    if (!sh) { if (!SPR) sprites().then(function () { drawAll(); }); return wrap; }
    [0, 1].forEach(function (f) {
      wrap.appendChild(el('span', { class: 'cb-spr-f f' + f, style: 'background-image:url(../assets/sprites/dawnlike/' + p[0] + f + '.png);background-size:' + (sh.cols * px) + 'px ' + ((sh.h || sh.rows) * px) + 'px;background-position:-' + (+p[2] * px) + 'px -' + (+p[1] * px) + 'px' }));
    });
    return wrap;
  }
  function pickSprite(current, done) {
    var d = dialog('Choose a Sprite');
    var sel = el('select', { 'aria-label': 'Sprite group' });
    var q = el('input', { type: 'search', placeholder: 'Search a group', 'aria-label': 'Search' });
    var grid = el('div', { class: 'cb-sprgrid' });
    d.body.appendChild(el('div', { class: 'cb-f' }, [el('div', { class: 'two' }, [sel, q]), grid, el('p', { class: 'cb-desc', text: 'Sprites: DawnLike by DragonDePlatino, palette by DawnBringer (CC BY-SA 3.0).' })]));
    sprites().then(function (S) {
      var cur = String(current || '').split(':')[0];
      S.sheets.forEach(function (sh) { sel.appendChild(opt(sh.id, sh.label + ' (' + sh.cells.length + ')', sh.id === cur)); });
      function draw() {
        grid.textContent = '';
        var t = q.value.trim().toLowerCase();
        var cells = t === 'platino' ? [['Reptile', 12, 3]] : [];
        if (!cells.length) S.sheets.filter(function (sh) { return t ? sh.label.toLowerCase().indexOf(t) >= 0 : sh.id === sel.value; }).forEach(function (sh) { sh.cells.forEach(function (rc) { cells.push([sh.id, rc[0], rc[1]]); }); });
        cells.forEach(function (x) {
          var spec = x.join(':');
          grid.appendChild(el('button', { type: 'button', class: 'cb-sprbtn' + (spec === current ? ' on' : ''), 'aria-label': 'Sprite ' + spec, onclick: function () { d.close(); done(spec); } }, [spriteNode(spec, 48)]));
        });
      }
      sel.addEventListener('change', function () { q.value = ''; draw(); }); q.addEventListener('input', draw); draw();
    });
    d.ok('Close', function () {});
    d.open();
  }

  // ---------- NPCs: pick from the Chapter 15 Bestiary, adjust, add ----------
  var BESTIARY = null;
  var RANKS = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'SS', 'SSS'];
  var RANK_STATS = { F: [4, 3, 3, [3, 2, 1], 3, 2], E: [6, 4, 4, [4, 3, 2], 6, 3], D: [8, 5, 5, [5, 4, 3], 9, 4], C: [10, 6, 6, [6, 5, 4], 12, 5], B: [12, 7, 7, [7, 6, 5], 15, 6],
    A: [14, 8, 8, [8, 7, 6], 18, 7], S: [16, 9, 9, [9, 8, 7], 21, 8], SS: [20, 12, 12, [12, 11, 10], 30, 12], SSS: [25, 15, 15, [15, 14, 13], 45, 15] };
  async function bestiary() { if (!BESTIARY) BESTIARY = await fetch('bestiary.json?v=40e559a0').then(function (r) { return r.json(); }); return BESTIARY; }
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
      init: num('npc-init', 3, 0, 40), zones: el('select', { id: 'npc-zones' }, [1, 2, 3, 4, 5].map(function (n) { return opt(n, n === 1 ? '1 (one zone)' : n + ' (' + n + 'x' + n + ' zones)', n === 1); })), bdt: num('npc-bdt', 3, 1, 60), b: num('npc-b', 3, 0, 40), l: num('npc-l', 2, 0, 40), a: num('npc-a', 1, 1, 40),
      mana: num('npc-mana', 3, 0, 9999), mt: num('npc-mt', 2, 0, 99), atk: num('npc-atk', 4, 0, 60), def: num('npc-def', 4, 0, 60), dmg: num('npc-dmg', 3, 0, 60), move: num('npc-move', 1, 0, 20),
      notes: el('textarea', { maxlength: '1500', rows: '3', placeholder: 'Attacks, spells, traits' }), hidden: el('input', { type: 'checkbox' }),
      elite: el('input', { type: 'checkbox' }), boss: el('input', { type: 'checkbox' }),
      pic: el('input', { type: 'url', maxlength: '500', placeholder: 'https:// (optional)' }), file: el('input', { type: 'file', accept: 'image/*' })
    };
    var chosen = el('p', { class: 'cb-desc', text: 'Pick a creature to fill everything in, or type your own. You can change any number before adding.' });
    var npcSprite = null, sprPrev = el('span', { class: 'cb-sprprev' });
    function drawSpr() { sprPrev.textContent = ''; if (npcSprite) sprPrev.appendChild(spriteNode(npcSprite, 48)); else sprPrev.appendChild(el('span', { class: 'cv-muted', text: 'None' })); }
    drawSpr();
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
      var zm = String(c.size || '').match(/(\d)x\d/); f.zones.value = zm ? zm[1] : '1';
      f.name.value = c.name; f.atk.value = atk; f.def.value = def; f.dmg.value = dmg; f.bdt.value = bdt;
      f.b.value = h.b || 0; f.l.value = h.l || 0; f.a.value = h.a || 1; f.mana.value = mana || 0; f.mt.value = mt || 0; f.move.value = c.move || 1;
      f.notes.value = (c.abilities || []).map(function (x) { return x.name + ': ' + x.text; }).concat(c.trait ? ['Trait: ' + c.trait] : []).concat(f.boss.checked && !/Boss/.test(c.section) ? ['Boss: two attacks a turn, immune to one condition.'] : []).join('\n');
      if (c.sprite) { npcSprite = c.sprite; drawSpr(); }
      chosen.textContent = c.name + ', Rank ' + rank + '. ' + [c.type, c.size, c.elements].filter(Boolean).join(', ') + '.' + (c.loot ? ' Loot: ' + c.loot : '');
    }
    f.elite.addEventListener('change', fill); f.boss.addEventListener('change', fill);
    d.body.appendChild(el('div', { class: 'cb-f' }, [
      el('div', {}, [el('button', { class: 'act primary', type: 'button', text: 'Choose from the Bestiary', onclick: function () { pickCreature(function (c) { picked = c; fill(); }); } })]), chosen,
      el('div', { class: 'two' }, [el('label', { class: 'chk' }, [f.elite, 'Elite (+1 rank)']), el('label', { class: 'chk' }, [f.boss, 'Boss (double health, two attacks)'])]),
      el('div', { class: 'two' }, [field('Name', f.name), field('How many', f.count)]),
      el('div', { class: 'three' }, [field('Side', f.side), field('Initiative', f.init), field('Move', f.move)]),
      el('div', { class: 'two' }, [field('Size on the map', f.zones), el('p', { class: 'cb-desc', style: 'align-self:end', text: 'Large 2x2, Huge 3x3, Gargantuan 4x4, Colossal 5x5.' })]),
      el('div', { class: 'three' }, [field('Attack pool', f.atk), field('Defense pool', f.def), field('Damage pool', f.dmg)]),
      el('div', { class: 'three' }, [field('Bashing boxes', f.b), field('Lethal boxes', f.l), field('Aggravated boxes', f.a)]),
      el('div', { class: 'three' }, [field('BDT', f.bdt), field('Mana', f.mana), field('M/T', f.mt)]),
      field('Attacks, spells, and traits', f.notes),
      el('div', { class: 'cb-sprrow' }, [el('span', { class: 'cb-lab', text: 'Sprite on the map' }), sprPrev, el('button', { class: 'act cb-mini', type: 'button', text: 'Choose a Sprite', onclick: function () { pickSprite(npcSprite, function (spec) { npcSprite = spec; drawSpr(); }); } })]),
      el('div', { class: 'two' }, [field('Portrait picture (upload)', f.file), field('Or a picture address', f.pic)]),
      el('label', { class: 'chk' }, [f.hidden, 'Hidden from players until revealed'])]));
    d.ok('Add', async function () {
      var n = Math.max(1, Math.min(12, +f.count.value || 1)), base = f.name.value.trim() || 'Enemy', rows = [];
      var pic = /^https:\/\//.test(f.pic.value.trim()) ? f.pic.value.trim() : '';
      if (f.file.files && f.file.files[0]) pic = await uploadNpcPic(f.file.files[0]);
      var abil = picked ? (picked.abilities || []) : [];
      for (var i = 0; i < n; i++) rows.push({ encounter_id: R.enc.id, owner: me.id, name: n > 1 ? base + ' ' + (i + 1) : base, kind: 'npc', side: f.side.value, ap: 3, initiative: +f.init.value || 0, bdt: +f.bdt.value || 1,
        boxes: { b: +f.b.value || 0, l: +f.l.value || 0, a: +f.a.value || 1 }, mana: +f.mana.value || 0, mana_max: +f.mana.value || 0, mt: +f.mt.value || 0, hidden: f.hidden.checked, pic_url: pic,
        stats: { npc: true, sprite: npcSprite, zones: +f.zones.value || 1, attack: +f.atk.value || 0, defense: +f.def.value || 0, damage: +f.dmg.value || 0, move: +f.move.value || 1, notes: f.notes.value.trim(), regen: 1,
          creature: picked ? { id: picked.id, rank: picked.rank, type: picked.type, size: picked.size, elements: picked.elements, abilities: abil, trait: picked.trait || '' } : null } });
      await must(db.from('combatants').insert(rows));
      await refresh();
    });
    d.open();
  }
  // ---------- map looks and terrain (DawnLike tiles) ----------
  var OBJ = { Floor: [21, 39, 0], Wall: [20, 51, 0], Tree: [12, 36, 1], Hill: [16, 18, 1], Pit: [8, 32, 1], Decor: [8, 22, 1], Effect: [8, 26, 1], Ore: [9, 7, 1] };
  var THEMES = [['dark', 'Classic Dark', ''], ['light', 'Classic Light', ''], ['dungeon', 'Dungeon', 'Floor:7:1'], ['castle', 'Castle Hall', 'Floor:10:1'], ['ice', 'Ice Palace', 'Floor:4:1'],
    ['forest', 'Forest', 'Floor:7:8'], ['meadow', 'Meadow', 'Floor:4:8'], ['swamp', 'Swamp', 'Floor:10:8'], ['desert', 'Desert', 'Floor:19:1'], ['beach', 'Beach', 'Floor:16:1'],
    ['snow', 'Snowfield', 'Floor:16:15'], ['ship', 'Ship Deck', 'Floor:19:8'], ['tavern', 'Tavern', 'Floor:16:8'], ['road', 'Dirt Road', 'Floor:22:1'], ['cave', 'Cave', 'Floor:25:1'],
    ['volcano', 'Volcano', 'Floor:10:15'], ['void', 'The Void', 'Floor:13:8']];
  // effect: block (nothing passes, full cover), difficult (costs 1 extra AP to enter), cover (difficult and half cover), hazard (passable but dangerous)
  var TERRAIN = [
    ['boulder', 'Boulder', 'Hill:0:3', 'block'], ['sandstone', 'Sandstone Rock', 'Hill:3:15', 'block'], ['tree', 'Tree', 'Tree:3:3', 'block'], ['pine', 'Pine', 'Tree:15:3', 'block'],
    ['snowpine', 'Snowy Pine', 'Tree:21:3', 'block'], ['deadtree', 'Dead Tree', 'Tree:3:9', 'block'], ['palm', 'Palm', 'Tree:27:9', 'block'], ['mushroom', 'Giant Mushroom', 'Tree:30:3', 'block'],
    ['pillar', 'Pillar', 'Wall:4:5', 'block'], ['wall', 'Stone Wall', 'Wall:6:3', 'block'], ['palisade', 'Wooden Wall', 'Wall:3:10', 'block'], ['statue', 'Statue', 'Decor:20:3', 'block'],
    ['deepwater', 'Deep Water', 'Pit:15:1', 'block'], ['lava', 'Lava', 'Pit:27:1', 'block'], ['pit', 'Pit', 'Pit:3:1', 'block'],
    ['crates', 'Crates', 'Decor:9:3', 'cover'], ['brush', 'Brush', 'Hill:0:15', 'cover'],
    ['rubble', 'Rubble', 'Ore:1:0', 'difficult'], ['shallows', 'Shallow Water', 'Pit:9:1', 'difficult'], ['ice', 'Ice', 'Pit:12:1', 'difficult'], ['mud', 'Mud', 'Floor:22:1', 'difficult'],
    ['drift', 'Deep Snow', 'Floor:16:15', 'difficult'], ['webs', 'Webs', 'Decor:19:0', 'difficult'], ['thorns', 'Thorns', 'Decor:2:4', 'difficult'],
    ['fire', 'Fire', 'Effect:21:1', 'hazard']];
  var TER = {}; TERRAIN.forEach(function (t) { TER[t[0]] = t; });
  var TER_TEXT = { block: 'Blocks movement and gives full cover.', cover: 'Difficult terrain and half cover (-2 dice to shots through it).', difficult: 'Difficult terrain: you can enter with free movement, but it ends there; leaving costs AP.', hazard: 'Anyone entering or starting a turn here rolls Fortitude + Endurance or catches Burning.' };
  function objNode(spec, px) {
    var p = String(spec).split(':'), sh = OBJ[p[0]];
    var wrap = el('span', { class: 'cb-spr', style: 'width:' + px + 'px;height:' + px + 'px', 'aria-hidden': 'true' });
    if (!sh) return wrap;
    (sh[2] ? [0, 1] : ['']).forEach(function (f, i) {
      wrap.appendChild(el('span', { class: 'cb-spr-f' + (sh[2] ? ' f' + i : ''), style: 'background-image:url(../assets/sprites/dawnlike/objects/' + p[0] + f + '.png);background-size:' + (sh[0] * px) + 'px ' + (sh[1] * px) + 'px;background-position:-' + (+p[2] * px) + 'px -' + (+p[1] * px) + 'px' }));
    });
    return wrap;
  }
  function tileStyle(spec, px) { var p = String(spec).split(':'), sh = OBJ[p[0]]; return 'background-image:url(../assets/sprites/dawnlike/objects/' + p[0] + (sh[2] ? '0' : '') + '.png);background-size:' + (sh[0] * px) + 'px ' + (sh[1] * px) + 'px;background-position:-' + (+p[2] * px) + 'px -' + (+p[1] * px) + 'px;image-rendering:pixelated'; }
  function mapDialog() {
    var m = R.enc.map || {};
    var d = dialog('Battle Map');
    var cols = num('map-cols', m.cols || 6, 3, 20), rows = num('map-rows', m.rows || 8, 3, 20), picked = m.theme || 'dark';
    var looks = el('div', { class: 'cb-looks', role: 'radiogroup', 'aria-label': 'Map look' });
    function drawLooks() {
      looks.textContent = '';
      THEMES.forEach(function (t) {
        var sw = el('span', { class: 'cb-look-sw ' + (t[2] ? '' : t[0]), style: t[2] ? tileStyle(t[2], 40) : '' });
        looks.appendChild(el('button', { type: 'button', role: 'radio', 'aria-checked': String(picked === t[0]), class: 'cb-look' + (picked === t[0] ? ' on' : ''), onclick: function () { picked = t[0]; drawLooks(); } }, [sw, el('span', { text: t[1] })]));
      });
    }
    drawLooks();
    d.body.appendChild(el('div', { class: 'cb-f' }, [el('div', { class: 'two' }, [field('Columns', cols), field('Rows', rows)]), el('h3', { class: 'px', text: 'Look' }), looks,
      el('p', { class: 'cb-desc', text: 'The book’s battle maps are 5 x 7, 6 x 8, and 7 x 9 zones. Tokens and terrain outside a smaller map are taken off it. Add boulders, trees, water, and other terrain with Edit Terrain under the map.' })]));
    d.ok('Save Map', async function () {
      var c = Math.max(3, Math.min(20, +cols.value || 6)), r = Math.max(3, Math.min(20, +rows.value || 8));
      var ter = {}; Object.keys(m.terrain || {}).forEach(function (k) { var xy = k.split(','); if (+xy[0] < c && +xy[1] < r) ter[k] = m.terrain[k]; });
      await must(db.from('encounters').update({ map: Object.assign({}, m, { cols: c, rows: r, theme: picked, terrain: ter }) }).eq('id', R.enc.id));
      var off = list().filter(function (x) { return x.x !== null && (x.x >= c || x.y >= r); });
      for (var i = 0; i < off.length; i++) await db.from('combatants').update({ x: null, y: null }).eq('id', off[i].id);
      await refresh();
    });
    d.open();
  }
  async function setTerrain(x, y, kind) {
    var m = Object.assign({}, R.enc.map || {}), ter = Object.assign({}, m.terrain || {}), k = x + ',' + y;
    if (!kind || ter[k] === kind) delete ter[k]; else ter[k] = kind;
    m.terrain = ter; R.enc.map = m; drawMap();
    var r = await db.from('encounters').update({ map: m }).eq('id', R.enc.id);
    if (r.error) { alert(oops(r.error)); refresh(); }
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
    if (a.targetId !== undefined) { if (a.targetId === c.id) target.appendChild(opt(c.id, c.name)); curSel = a.targetId || ''; }
    if (curSel) target.value = curSel;
    // Battle Aura (Aura Fist, Aura Blade): 1 mana, then 1 mana per die on the attack or the damage, up to your Battle Aura dots
    var aura = a.aura || null, auraDots = aura ? ((kit.dots || {})['Battle Aura'] || 0) : 0;
    var auraSel = el('select', { id: 'r-aura' });
    function fillAura() {
      var used = spell ? 0 : (+atkMana.value || 0) + (+dmgMana.value || 0);   // plain mana on a weapon or fist attack shares the Battle Aura cap
      var cur = auraSel.value, cap = Math.max(0, Math.min(auraDots - used, (c.mt || 0) - 1 - used, (c.mana || 0) - 1 - used));
      auraSel.textContent = '';
      auraSel.appendChild(opt('', 'No, just roll'));
      for (var i = 1; i <= cap; i++) auraSel.appendChild(opt('a' + i, '+' + i + ' ' + (i === 1 ? 'die' : 'dice') + ' to the attack (' + (i + 1) + ' mana)'));
      for (var j = 1; j <= cap; j++) auraSel.appendChild(opt('d' + j, '+' + j + ' ' + (j === 1 ? 'die' : 'dice') + ' to damage (' + (j + 1) + ' mana)'));
      auraSel.value = cur; if (auraSel.value !== cur) auraSel.value = '';
      auraSel.disabled = cap === 0;
    }
    function auraAtk() { return /^a/.test(auraSel.value) ? +auraSel.value.slice(1) : 0; }
    function auraDmg() { return /^d/.test(auraSel.value) ? +auraSel.value.slice(1) : 0; }
    function auraSpend() { return auraSel.value ? 1 + auraAtk() + auraDmg() : 0; }
    var hasMana = !!spell || a.boostCap > 0;
    var cost = spell ? spell.cost || 0 : 0;
    var dotsCap = spell ? 0 : (a.boostCap || 0);
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
      var au = spell ? 0 : auraSpend(), ad = spell ? 0 : auraAtk() + auraDmg();
      var mtLeft = Math.max(0, (c.mt || 0) - cost - au), have = Math.max(0, (c.mana || 0) - cost - au);
      return Math.max(0, Math.min(dotsCap - ad, mtLeft, have));
    }
    function fillMana() {
      var cap = capLeft(), a1 = +atkMana.value || 0, d1 = +dmgMana.value || 0;
      [[atkMana, a1, d1, manaTo === 'damage'], [dmgMana, d1, a1, manaTo === 'attack']].forEach(function (x) {
        var s = x[0], cur = x[1], other = x[2], off = x[3];
        s.textContent = '';
        var max = off ? 0 : Math.max(0, cap - other);   // each mana is 1 die, on the attack or the damage roll, split however you like
        for (var i = 0; i <= max; i++) s.appendChild(opt(i, i === 0 ? 'None' : '+' + i + ' mana (' + i + ' ' + (i === 1 ? 'die' : 'dice') + ')', i === Math.min(cur, max)));
        s.disabled = off || max === 0;
      });
    }
    function apDice(v) { return { 0: 0, 1: 1, 3: 2, 6: 3 }[v] || 0; }
    // Extra attacks (Ch. 12): with 3 Style dots spend 1 AP for 1 more, 5 dots 3 AP for 2 more, 7 dots 6 AP for 3 more. Once per round, same attack.
    var canMulti = (a.multiDots || 0) >= 3 && !a.multiOf && !(ST().t || {}).multiUsed;
    var multi = el('select', { id: 'r-multi' }, [opt(0, 'No extra attacks')].concat(
      (a.multiDots >= 3 ? [opt(1, '1 extra attack for 1 AP')] : []), (a.multiDots >= 5 ? [opt(3, '2 extra attacks for 3 AP')] : []), (a.multiDots >= 7 ? [opt(6, '3 extra attacks for 6 AP')] : [])));
    function multiN() { return canMulti ? apDice(+multi.value) : 0; }
    function multiAP() { return canMulti ? (+multi.value || 0) : 0; }
    function total() { return Math.max(0, a.pool + (+bonus.value || 0) - (+penalty.value || 0) + (+atkMana.value || 0) + auraAtk() + apDice(+ap.value) + (wp.checked ? 3 : 0)); }
    function drawParts() {
      parts.textContent = '';
      (a.parts || []).forEach(function (p) { parts.appendChild(el('li', {}, [el('span', { text: p[0] }), el('span', { text: String(p[1]) })])); });
      (a.unknown || []).forEach(function (u) { parts.appendChild(el('li', { class: 'warn' }, [el('span', { text: u + ' (not found, use Bonus dice)' }), el('span', { text: '0' })])); });
      if (+bonus.value) parts.appendChild(el('li', {}, [el('span', { text: 'Bonus dice' }), el('span', { text: String(+bonus.value) })]));
      if (+penalty.value) parts.appendChild(el('li', {}, [el('span', { text: 'Wound and other penalties' }), el('span', { text: '-' + (+penalty.value) })]));
      if (+atkMana.value) parts.appendChild(el('li', {}, [el('span', { text: 'Extra mana on the attack' }), el('span', { text: '+' + atkMana.value })]));
      if (auraAtk()) parts.appendChild(el('li', {}, [el('span', { text: aura.name + ' on the attack' }), el('span', { text: '+' + auraAtk() })]));
      if (+ap.value) parts.appendChild(el('li', {}, [el('span', { text: 'AP spent (' + ap.value + ')' }), el('span', { text: '+' + apDice(+ap.value) })]));
      if (wp.checked) parts.appendChild(el('li', {}, [el('span', { text: 'Willpower' }), el('span', { text: '+3' })]));
      parts.appendChild(el('li', { class: 'total' }, [el('span', { text: 'Dice to roll' }), el('span', { text: String(total()) })]));
      if (auraSel.value) parts.appendChild(el('li', { class: auraSpend() > c.mana ? 'warn' : '' }, [el('span', { text: aura.name + ': mana spent' + (auraDmg() ? ' (' + auraDmg() + ' set aside for damage)' : '') }), el('span', { text: auraSpend() + ' of ' + c.mana })]));
      if (hasMana) {
        var spend = cost + (+atkMana.value || 0) + (+dmgMana.value || 0);
        if (spend) parts.appendChild(el('li', { class: spend > c.mana ? 'warn' : '' }, [el('span', { text: 'Mana spent (' + (spell ? 'cost ' + cost : 'enhancement') + (+dmgMana.value ? ', ' + dmgMana.value + ' set aside for damage' : '') + ')' }), el('span', { text: spend + ' of ' + c.mana })]));
      }
      if (multiN()) parts.appendChild(el('li', {}, [el('span', { text: 'Extra attacks, each rolled and defended on its own (' + multiAP() + ' AP)' }), el('span', { text: '+' + multiN() })]));
      if ((+ap.value || 0) + multiAP() > c.ap) parts.appendChild(el('li', { class: 'warn' }, [el('span', { text: 'You hold ' + c.ap + ' AP. Allies can give you the rest.' }), el('span', { text: '' })]));
    }
    [bonus, penalty, ap, wp, auraSel, multi].forEach(function (x) { x.addEventListener('input', drawParts); x.addEventListener('change', drawParts); });
    atkMana.addEventListener('change', function () { fillMana(); if (aura) fillAura(); drawParts(); });
    dmgMana.addEventListener('change', function () { fillMana(); if (aura) fillAura(); drawParts(); });
    auraSel.addEventListener('change', function () { fillMana(); });
    var f = el('div', { class: 'cb-f' }, [parts]);
    if (a.targetId !== undefined) {
      var tg0 = R.cs[a.targetId];
      f.appendChild(el('p', { class: 'cb-line' }, ['Target: ', el('b', { text: tg0 ? tg0.name : 'none' }), a.rangeNote ? ' (' + a.rangeNote + ')' : '']));
    } else if (a.targetable !== false) f.appendChild(field('Target', target));
    f.appendChild(el('div', { class: 'two' }, [field('Bonus dice (specialty, items, boons)', bonus), field('Penalty dice', penalty)]));
    if (aura) {
      f.appendChild(el('h3', { class: 'px cb-ask', text: 'Spend mana to enhance it?' }));
      f.appendChild(el('p', { class: 'cb-desc', text: aura.name + ' (Battle Aura): 1 mana, then 1 mana per die, up to your ' + auraDots + ' Battle Aura dots and your M/T of ' + (c.mt || 0) + '.' }));
      f.appendChild(field(aura.name, auraSel));
    }
    if (hasMana) {
      if (!aura) f.appendChild(el('h3', { class: 'px cb-ask', text: 'Spend mana to enhance it?' }));
      var rule = manaTo === 'attack' ? 'This magic can only add mana to the attack.' : manaTo === 'damage' ? 'This magic can only add mana to damage.' : 'Put it on the attack, or set it aside for the damage roll.';
      f.appendChild(el('p', { class: 'cb-desc', text: (spell ? 'Cost: ' + (spell.costText || cost) + '. ' : '') + '1 die per mana, up to ' + dotsCap + ' (your ' + (spell ? 'dots' : (a.boostName || 'Style') + ' dots') + ') or your M/T of ' + (c.mt || 0) + ', whichever comes first. ' + rule }));
      f.appendChild(el('div', { class: 'two' }, [field('Extra mana on the attack', atkMana), field('Mana set aside for damage', dmgMana)]));
    }
    f.appendChild(el('div', { class: 'two' }, [field('Spend AP for dice', ap), el('label', { class: 'chk', style: 'align-self:end' }, [wp, 'Spend 1 Willpower for +3 dice'])]));
    if (canMulti) f.appendChild(field('Extra attacks (' + a.multiDots + ' ' + (a.boostStyle || 'Style') + ' dots)', multi));
    if (a.multiOf) f.appendChild(el('p', { class: 'cb-desc', text: 'Extra attack ' + a.multiOf + '. It gets its own roll and the target defends as normal.' }));
    f.appendChild(el('label', { class: 'chk' }, [real, 'I rolled real dice']));
    f.appendChild(realWrap);
    body.appendChild(f);
    fillMana(); if (aura) fillAura(); drawParts();
    d.ok('Roll', async function () {
      var n = total();
      var spend = (hasMana ? cost + (+atkMana.value || 0) + (+dmgMana.value || 0) : 0) + auraSpend();
      if (spend > c.mana) { d.msg('Not enough mana. This needs ' + spend + ' and ' + c.name + ' has ' + c.mana + '.'); return false; }
      if (wp.checked && c.willpower < 1) { d.msg('No Willpower left to spend.'); return false; }
      var dice = real.checked ? [] : d10s(n), succ = real.checked ? Math.max(0, +realN.value || 0) : successes(dice);
      var patch = {};
      if (spend) patch.mana = c.mana - spend;
      if ((+ap.value || 0) + multiAP()) patch.ap = Math.max(0, c.ap - (+ap.value || 0) - multiAP());
      if (wp.checked) patch.willpower = c.willpower - 1;
      if (Object.keys(patch).length) await upd(c, patch);
      var tgt = R.cs[target.value];
      if (spell && /persistent/i.test(spell.type || '')) { // keep it on the card so Upkeep can ask about paying for it
        var st2 = Object.assign({}, c.stats || {}); st2.effects = (st2.effects || []).concat([{ name: spell.name, upkeep: Math.max(0, (spell.cost || 0) - 1) }]); await upd(c, { stats: st2 });
      }
      var row = await addRoll({ combatant_id: c.id, label: a.label + (tgt ? ' at ' + tgt.name : '') + (a.override ? ' (Storyteller allowed it out of range)' : ''), pool: n, dice: dice, successes: succ,
        detail: { kind: a.kind || 'roll', target: tgt ? tgt.id : null, setAside: (+dmgMana.value || 0) + auraDmg(), mana: spend, ap: +ap.value || 0, wp: wp.checked, real: real.checked, damagePool: a.damagePool || 0, damageText: a.damageText || '', attacker: c.id, social: !!a.social, spell: spell ? spell.name : undefined, multi: multiN() || undefined, multiOf: a.multiOf || undefined } });
      var res = null;
      if (((a.kind || 'roll') === 'attack' || a.kind === 'contest') && tgt && row) res = await autoDefend(row, tgt, spell, a.social, a.defense ? a.defense(tgt) : null);
      if ((a.kind === 'attack' || a.kind === 'contest') && c.hidden) { await upd(c, { hidden: false }); await note(c.name + ' attacks and is no longer hidden.'); }
      if (a.aimUsed) await upd(c, { stats: Object.assign({}, c.stats || {}, { aim: null }) });
      if (a.post && row) await a.post(row, tgt, res);
      if (a.after) await a.after(row);
      if (R.multi && R.multi.c === c.id) R.multi.act = a;
      if (a.fromMenu && row) resultWindow(c, tgt, row, res, a, function () { nextAttack(c, a); });
    });
    d.open();
  }

  // The target's defense rolls automatically, so everyone sees at once whether the attack landed and by how much
  function bestDefense(t, spell) {
    var k = t.stats || {};
    if (k.npc) return { name: 'Defense', total: k.defense || 0 };
    var want = spell && spell.defense ? spell.defense.toLowerCase() : '';
    var opts = (k.defenses || []).map(function (d) { return { name: d.name, total: evalPool(d.pool, k).total }; });
    if (want) { var m = opts.filter(function (d) { return want.indexOf(d.name.toLowerCase().replace(/ defense$/, '')) >= 0 || want.indexOf(d.name.toLowerCase().split(' (')[0]) >= 0; }); if (m.length) opts = m; }
    opts = opts.filter(function (d) { return !/notice/i.test(d.name) || /notice|perception/.test(want); });
    return opts.sort(function (a, b) { return b.total - a.total; })[0] || { name: 'Defense', total: 0 };
  }
  async function autoDefend(atk, t, spell, social, forced) {
    var d = forced || (social ? socialDefense(t) : bestDefense(t, spell)), pen = woundPenalty(t), gd = social ? 0 : guardDice(t), n = Math.max(0, d.total - pen + gd);
    var dice = d10s(n), succ = successes(dice), ex = Math.max(0, atk.successes - succ);
    await addRoll({ combatant_id: t.id, label: d.name + ' against ' + ((R.cs[atk.combatant_id] || {}).name || 'the attack') + (pen ? ' (wounds -' + pen + ')' : '') + (gd ? ' (' + guardText(t) + ' +' + gd + ')' : ''), pool: n, dice: dice, successes: succ,
      detail: { kind: 'defense', vs: atk.id, auto: true, hit: atk.successes > succ, excess: ex, social: !!social, contest: !!forced } });
    if (social && succ - atk.successes >= 5) await note(t.name + ' makes a Critical Comeback: 5 or more over the attacker. The exchange ends in ' + t.name + '’s favor.');
    return { hit: atk.successes > succ, excess: ex, def: succ, name: d.name };
  }
  // Social combat: the defender rolls Willpower + Composure (NPCs use their Defense)
  function socialDefense(t) {
    var k = t.stats || {};
    if (k.npc) return { name: 'Defense', total: k.defense || 0 };
    return { name: 'Willpower + Composure', total: (k.willpower || t.willpower || 0) + ((k.attrs || {}).Composure || 0) };
  }
  async function applyWp(r) {
    var det = r.detail || {}, t = R.cs[det.target]; if (!t) return;
    var n = det.n || 0, left = Math.max(0, (t.willpower || 0) - n);
    if (mineC(t)) await upd(t, { willpower: left });
    await note(t.name + ' takes ' + n + ' Willpower damage' + (left === 0 ? ': their Willpower row is full. They lose a Willpower dot and the social combat ends.' : n >= 5 ? ' (' + left + ' left). 5 or more in one retort: the social combat ends.' : ' (' + left + ' left).'), { applied: r.id });
  }
  function damageDialog(roll, after) {
    var c = R.cs[roll.combatant_id], det = roll.detail || {}, tgt = R.cs[det.target];
    var d = dialog('Roll Damage');
    var defRoll = R.rolls.filter(function (r) { return (r.detail || {}).vs === roll.id; })[0] || R.rolls.filter(function (r) { return r.created_at > roll.created_at && (r.detail || {}).kind === 'defense' && r.combatant_id === det.target; }).slice(-1)[0];
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
      el('p', { class: 'cb-desc', text: det.damageText ? 'Damage pool: ' + det.damageText + '.' : 'Damage pool: a weapon’s damage Attribute + its Rating. Spells that deal damage equal to excess successes use 0 here.' }),
      det.setAside ? el('p', { class: 'cb-desc', text: det.setAside + ' mana was set aside for this damage roll when the attack was declared (mana is always declared before the attack roll).' }) : null,
      out, el('label', { class: 'chk' }, [real, 'I rolled real dice']), realWrap]));
    draw();
    d.ok('Roll Damage', async function () {
      var ex = Math.max(0, roll.successes - (+def.value || 0));
      if (roll.successes <= (+def.value || 0)) {
        await addRoll({ combatant_id: roll.combatant_id, label: 'Missed' + (tgt ? ' ' + tgt.name : ''), detail: { kind: 'damage', of: roll.id, target: null, excess: 0, total: 0, result: null } });
        if (after) await after();
        return;
      }
      var n = Math.max(0, (+dpool.value || 0) + (det.setAside || 0) + (+bonus.value || 0));
      var dice = real.checked ? [] : d10s(n), s = real.checked ? +realN.value || 0 : successes(dice);
      var totalDmg = s + ex, res = null;
      if (tgt) { var b = tgt.bdt || 1; res = totalDmg >= b * 3 ? 'a' : totalDmg >= b * 2 ? 'l' : totalDmg >= b ? 'b' : null; }
      await addRoll({ combatant_id: roll.combatant_id, label: 'Damage' + (tgt ? ' to ' + tgt.name : ''), pool: n, dice: dice, successes: s,
        detail: { kind: 'damage', of: roll.id, target: tgt ? tgt.id : null, excess: ex, total: totalDmg, result: res, real: real.checked } });
      if (after) await after();
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
    if (mineC(t)) await upd(t, { health: h, stats: Object.assign({}, t.stats || {}, { hurt: true }) });
    else { var rr = await db.rpc('apply_damage', { c: t.id, k: k }); if (rr.error) throw rr.error; t.health = h; drawAll(); }
    var NAMES = { b: 'Bashing', l: 'Lethal', a: 'Aggravated' };
    await addRoll({ label: t.name + ' takes 1 ' + NAMES[k] + '.' + (incap(t) ? ' ' + t.name + ' is Incapacitated: choose Fall Unconscious, Risk It, or Blaze of Glory.' : ''),
      detail: { kind: 'note', applied: roll.id } });
  }

  function customButton(c, after) {
    return el('button', { class: 'cb-act', type: 'button', onclick: function () { customRoll(c, after); } }, [el('span', {}, [el('b', { text: 'Custom roll' }), el('small', { text: 'Type the dice yourself' })]), el('span', { class: 'pool', text: '?' })]);
  }
  function customRoll(c, after) {
    (function () {
      var d = dialog('Custom Roll');
      var lab = el('input', { maxlength: '80', placeholder: 'Strength + Athletics to break free' }), n = num('cu-n', 3, 0, 60);
      var kind = el('select', {}, [opt('roll', 'Any roll', true), opt('attack', 'An attack'), opt('defense', 'A defense')]);
      d.body.appendChild(el('div', { class: 'cb-f' }, [field('What is it?', lab), el('div', { class: 'two' }, [field('Dice', n), field('Kind', kind)])]));
      d.ok('Next', function () {
        rollDialog(c, { label: lab.value.trim() || 'Roll', pool: +n.value || 0, parts: [['Dice', +n.value || 0]], kind: kind.value, targetable: kind.value === 'attack', after: after });
      });
      d.open();
    })();
  }
  // ---------- the Action menu, Final Fantasy style: pick it, pick a target in range, enhance it, roll ----------
  // Range (Chapter 14): melee hits adjacent zones (one farther with Reach); bows, guns, and ranged spells hit anything in line of sight.
  var RANGED_STYLES = /Windreader|Sundown|Iron Rain/, UNARMED_STYLES = /Ten Count|Drifting Leaf|Main Event|Dragon/;
  var LOS = { n: 99, sight: true, text: 'line of sight' };
  function styleRange(style, kit) {
    if (RANGED_STYLES.test(style || '')) return LOS;
    var LO = (kit && kit.loadout) || {};
    var reach = /Heron/.test(style || '') || ((kit && kit.weapons) || []).some(function (w) { return /\breach\b/i.test(w.notes || '') && (LO.weapons || {})[w.key] === style; });
    return reach ? { n: 2, text: 'Reach, up to 2 zones' } : { n: 1, text: 'adjacent zones' };
  }
  function parseRange(txt, fallback) {
    var s = String(txt || '').trim();
    if (!s || /weapon'?s reach/i.test(s)) return fallback;
    if (/^self/i.test(s) && /adjacent|touch/i.test(s)) return { n: 1, self: true, text: s };
    if (/^self|caster'?s zone/i.test(s)) return { n: 0, self: true, only: true, text: s };
    var m = s.match(/(\d+)\s+zones?/i);
    if (m && !/line of sight/i.test(s)) return { n: +m[1], sight: true, text: s };
    if (/line of sight|ranged|targeted|any zone|battlefield|^zone|aoe/i.test(s)) return { n: 99, sight: true, text: s };
    if (/adjacent|touch|melee/i.test(s)) return { n: 1, text: s };
    return { n: 99, sight: true, text: s };
  }
  function npcRange(ab) {
    var s = (ab.name || '') + ' ' + (ab.text || '');
    if (/\bmelee\b/i.test(s)) return { n: 1, text: 'adjacent zones' };
    if (/ranged|line of sight|cone|breath|bolt|beam|spit|throw/i.test(s)) return LOS;
    return { n: 1, text: 'adjacent zones' };
  }
  // Damage pool (Chapter 14): the weapon's damage Attribute + its Rating. The Attribute comes from the weapon tables, by name, then by Style.
  var DMG_BY_NAME = [[/greatsword|broadsword|axe|hatchet|quarterstaff|spear|trident|halberd|pike|shield|knuckle|glove|cestus|club|baton|chair|table|bottle|ladder|staff|rod|scepter/i, 'Strength'],
    [/knife|dagger|stiletto|short sword|rapier|saber|longsword|katana|naginata|glaive/i, 'Dexterity'], [/bow|crossbow|pistol|revolver|derringer|rifle|musket|shotgun|gun|cannon|sling/i, 'Perception'], [/whip/i, 'Manipulation']];
  var DMG_BY_STYLE = [[/Quickcut|Silver Arc/, 'Dexterity'], [/Windreader|Sundown|Iron Rain/, 'Perception'], [/Ten Count|Drifting Leaf/, 'Strength or Dexterity'], [/./, 'Strength']];
  function weaponDamage(kit, style, wname) {
    var attr = null;
    DMG_BY_NAME.forEach(function (x) { if (!attr && wname && x[0].test(wname)) attr = x[1]; });
    DMG_BY_STYLE.forEach(function (x) { if (!attr && x[0].test(style || '')) attr = x[1]; });
    var at = kit.attrs || {}, av, an;
    if (attr === 'Strength or Dexterity') { an = (at.Strength || 0) >= (at.Dexterity || 0) ? 'Strength' : 'Dexterity'; } else an = attr;
    av = at[an] || 0;
    var w = (kit.weapons || []).filter(function (x) { return x.name === wname; })[0];
    var rating = w && w.cat === 'Damage' ? (w.bonus || 0) : 0, extra = ((kit.bonus || {}).damage || 0) - (kit.weapons || []).reduce(function (t, x) { return t + (x.cat === 'Damage' ? (x.bonus || 0) : 0); }, 0);   // other worn gear only: kit.bonus.damage counts every weapon's Damage bonus too
    var text = an + ' ' + av + (rating ? ' + Rating ' + rating : wname ? ' (no Rating set on the character page)' : '') + (extra ? ' + ' + extra + ' from other gear' : '');
    return { pool: av + rating + extra, text: text };
  }
  function placedC(c) { return c && c.x !== null && c.x !== undefined && c.y !== null && c.y !== undefined; }
  function gap(a, b) {
    var na = zonesOf(a), nb = zonesOf(b);
    var dx = Math.max(0, b.x - (a.x + na - 1), a.x - (b.x + nb - 1)), dy = Math.max(0, b.y - (a.y + na - 1), a.y - (b.y + nb - 1));
    return Math.max(dx, dy);
  }
  // A line from the middle of one token to the middle of the other: a wall or boulder on it blocks the shot, brush or crates give half cover
  function sightLine(a, b) {
    var ter = (R.enc.map || {}).terrain || {}, na = zonesOf(a), nb = zonesOf(b);
    var x0 = a.x + na / 2, y0 = a.y + na / 2, x1 = b.x + nb / 2, y1 = b.y + nb / 2;
    var steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 8), worst = 'clear';
    function inside(c, x, y) { var n = zonesOf(c); return x >= c.x && x < c.x + n && y >= c.y && y < c.y + n; }
    for (var i = 1; i < steps; i++) {
      var x = Math.floor(x0 + (x1 - x0) * i / steps), y = Math.floor(y0 + (y1 - y0) * i / steps);
      if (inside(a, x, y) || inside(b, x, y)) continue;
      var t = TER[ter[x + ',' + y]];
      if (t && t[3] === 'block') return 'none';
      if (t && t[3] === 'cover') worst = 'half';
    }
    return worst;
  }
  function targetCheck(c, t, rg) {
    if (!placedC(c) || !placedC(t)) return { ok: true, note: '' };
    var d = gap(c, t);
    if (d > rg.n) return { ok: false, why: d + ' zone' + (d === 1 ? '' : 's') + ' away, range is ' + rg.text };
    var sg = d > 1 ? sightLine(c, t) : 'clear';
    if (sg === 'none') return { ok: false, why: 'No line of sight' };
    return { ok: true, cover: sg === 'half', note: d + ' zone' + (d === 1 ? '' : 's') + ' away' + (sg === 'half' ? ', half cover' : '') };
  }

  // What the menu offers. Each item: { name, sub, pool, desc, act } where act is what happens once it is picked.
  function menuCats(c, after) {
    var kit = c.stats || {}, LO = kit.loadout || {}, conds = c.conditions || [];
    var cats = [];
    // Combat Actions from the rules
    var acts = [];
    if (conds.indexOf('Grappled') >= 0 || conds.indexOf('Petrified') >= 0) {
      var bf = kit.npc ? (kit.attack || 0) : ((kit.attrs || {}).Strength || 0) + ((kit.abilities || {}).Athletics || 0);
      acts.push({ name: 'Break Free', sub: 'Strength + Athletics', pool: bf + 'd', desc: (conds.indexOf('Petrified') >= 0 ? 'Petrified: roll against the cast successes to break free.' : 'Grappled: a failed Upkeep roll can be tried again in the Action Phase.'),
        act: { label: c.name + ' tries to break free', pool: bf, parts: [['Strength + Athletics', bf]], kind: 'roll', targets: 'none' } });
    }
    if (conds.indexOf('Burning') >= 0) acts.push({ name: 'Put Out the Flames', sub: 'Spends the turn', pool: '', desc: 'Burning ends with Water Magic, or by spending a full turn putting it out.',
      act: { label: 'Put Out the Flames', targets: 'none', run: async function () { await upd(c, { conditions: (c.conditions || []).filter(function (x) { return x !== 'Burning'; }) }); await note(c.name + ' spends the turn putting out the flames. Burning ends.'); await after(null); } } });
    if (conds.indexOf('Bleeding') >= 0) acts.push({ name: 'Apply Pressure', sub: 'No other actions', pool: '', desc: 'Applying pressure (no other actions) stops the next Bleeding tick.',
      act: { label: 'Apply Pressure', targets: 'none', run: async function () { await note(c.name + ' applies pressure to the wound: the next Bleeding tick is stopped.'); await after(null); } } });
    var ADJ = { n: 1, text: 'adjacent zones' };
    function mine(str) { return kit.npc ? (kit.attack || 0) : evalPool(str, kit).total; }
    function contest(name, sub, atkStr, defName, defStr, desc, win) {
      var n = mine(atkStr);
      return { name: name, sub: sub, pool: n + 'd', desc: desc,
        act: { label: name, pool: n, parts: [[kit.npc ? 'Attack pool' : atkStr, n]], kind: 'contest', range: ADJ, targets: 'others', winText: win,
          defense: function (t) { return typeof defStr === 'function' ? defStr(t) : { name: defName, total: poolOf(t, defStr) }; },
          post: async function (row, t, res) { if (res && res.hit) await contestWin(name, c, t); } } };
    }
    var bestAtk = (kit.maneuvers || []).filter(function (m) { return m.rank === 0; }).map(function (m) { return evalPool(m.pool, kit).total; }).sort(function (x, y) { return y - x; })[0];
    acts.push(contest('Shove', 'Strength + Athletics', 'Strength + Athletics', 'Strength + Athletics', 'Strength + Athletics', 'Shove an adjacent target. They resist with Strength + Athletics. If you win, they are pushed 1 zone into an empty zone.', 'They are pushed 1 zone away.'));
    acts.push(contest('Trip', 'Dexterity + Athletics', 'Dexterity + Athletics', 'Dexterity + Acrobatics', 'Dexterity + Acrobatics', 'Sweep an adjacent target’s legs. They resist with Dexterity + Acrobatics. If you win, they are knocked Prone.', 'They are knocked Prone.'));
    acts.push(contest('Grapple', 'Strength + Martial Arts', 'Strength + Martial Arts', '', function (t) { var dd = poolOf(t, 'Dexterity + Dodge'), sa = poolOf(t, 'Strength + Athletics'); return dd >= sa ? { name: 'Dodge', total: dd } : { name: 'Strength + Athletics', total: sa }; }, 'Seize an adjacent target. They resist with Dodge or Strength + Athletics, whichever is better. If you win, they are Grappled.', 'They are Grappled.'));
    var dis = contest('Disarm', 'Your attack pool', 'Dexterity + Melee', '', function (t) { return bestDefense(t); }, 'Knock the weapon from an adjacent target’s hand. They resist with their best defense. If you win, their weapon lands in an adjacent zone.', 'Their weapon lands in an adjacent zone.');
    if (!kit.npc && bestAtk !== undefined) { dis.pool = bestAtk + 'd'; dis.act.pool = bestAtk; dis.act.parts = [['Best attack pool', bestAtk]]; }
    acts.push(dis);
    var cov = nearCover(c), hideN = mine('Dexterity + Stealth');
    if (cov) acts.push({ name: 'Hide', sub: 'Dexterity + Stealth', pool: hideN + 'd', desc: 'In or behind cover. Everyone against you rolls Perception + Awareness. Beat them all and you are hidden until you attack or someone finds you.',
      act: { label: c.name + ' tries to hide', pool: hideN, parts: [[kit.npc ? 'Attack pool' : 'Dexterity + Stealth', hideN]], kind: 'roll', targets: 'none', post: function (row) { return hideCheck(c, row); } } });
    acts.push({ name: 'Total Defense', sub: 'No attack this turn', pool: '+2', desc: 'Give up your attack. +2 dice to every defense until your next turn.',
      act: { label: 'Total Defense', targets: 'none', run: async function () { await setGuard(c, 'total'); await note(c.name + ' takes Total Defense: +2 dice to every defense until their next turn.'); await after(null); } } });
    var cvN = cov === 'full' ? 3 : 1, cvT = cov === 'full' ? 'full cover' : 'half cover';
    if (cov) acts.push({ name: 'Take Cover', sub: cov === 'full' ? 'Full cover' : 'Half cover', pool: '+' + cvN, desc: 'Get down behind the cover next to you. Half cover (brush, crates) adds 1 die to every defense until your next turn; full cover (walls, boulders) adds 3. You are beside ' + cvT + '.',
      act: { label: 'Take Cover', targets: 'none', run: async function () { await setGuard(c, 'cover', cvN); await note(c.name + ' takes ' + cvT + ': +' + cvN + ' ' + (cvN === 1 ? 'die' : 'dice') + ' to every defense until their next turn.'); await after(null); } } });
    acts.push({ name: 'Aim', sub: 'No attack this turn', pool: '+2', desc: 'Give up your attack and line up a shot. +2 dice on your next ranged attack against that target.',
      act: { label: 'Aim', range: LOS, targets: 'others', run: async function (t) { if (!t) return; await upd(c, { stats: Object.assign({}, c.stats || {}, { aim: { target: t.id, turns: 1 } }) }); await note(c.name + ' takes aim at ' + t.name + ': +2 dice on their next ranged attack against them.'); await after(null); } } });
    cats.push({ name: 'Combat Actions', items: acts });

    if (kit.npc) {
      var na = ((kit.creature || {}).abilities || []).map(function (ab) {
        var isAtk = /melee|ranged|damage|casts|breath|bolt|bite|claw|strike|slam/i.test(ab.name + ' ' + ab.text);
        return { name: ab.name, sub: isAtk ? 'Attack' : 'Ability', pool: (kit.attack || 0) + 'd', desc: ab.text,
          act: { label: c.name + ': ' + ab.name, pool: kit.attack || 0, parts: [['Attack pool', kit.attack || 0]], kind: isAtk ? 'attack' : 'roll', damagePool: kit.damage || 0, desc: ab.text, range: isAtk ? npcRange(ab) : LOS, targets: isAtk ? 'others' : 'any' } };
      });
      na.unshift({ name: 'Attack', sub: 'Basic attack', pool: (kit.attack || 0) + 'd', desc: 'Attack pool against a target’s defense.',
        act: { label: c.name + ': Attack', pool: kit.attack || 0, parts: [['Attack pool', kit.attack || 0]], kind: 'attack', damagePool: kit.damage || 0, range: { n: 1, text: 'adjacent zones' }, targets: 'others' } });
      cats.push({ name: 'Attacks', items: na });
    } else {
      var sp = prepared(kit.spells, LO.spells), mv = prepared(kit.maneuvers, LO.maneuvers);
      var auraFist = sp.filter(function (x) { return x.name === 'Aura Fist'; })[0], auraBlade = sp.filter(function (x) { return x.name === 'Aura Blade'; })[0];
      function auraFor(style) { return UNARMED_STYLES.test(style || '') ? auraFist || null : auraBlade || null; }
      var armed = {}; (kit.weapons || []).forEach(function (w) { var stn = (LO.weapons || {})[w.key] || ((kit.styles || []).length === 1 ? kit.styles[0].name : ''); if (stn) (armed[stn] = armed[stn] || []).push(w.name); });
      var atk = (kit.maneuvers || []).filter(function (m) { return m.rank === 0; }).map(function (m) {
        var p = evalPool(m.pool, kit), rg = styleRange(m.style, kit), nm = armed[m.style] ? 'Attack with ' + armed[m.style][0] : 'Attack (' + m.style.replace(/ Style$/, '') + ')';
        var dm = weaponDamage(kit, m.style, armed[m.style] ? armed[m.style][0] : '');
        return { name: nm, sub: m.style + '. Range: ' + rg.text + '. Damage ' + dm.pool, pool: p.total + 'd', desc: 'A standard attack with ' + m.style + '. Range: ' + rg.text + '. Damage pool: ' + dm.text + '.',
          act: { label: nm, pool: p.total, parts: p.parts, unknown: p.unknown, kind: 'attack', range: rg, targets: 'others', aura: auraFor(m.style), damagePool: dm.pool, damageText: dm.text, boostCap: (kit.dots || {})['Battle Aura'] || 0, boostName: 'Battle Aura', multiDots: (kit.dots || {})[m.style] || 0, boostStyle: m.style } };
      }).concat(mv.map(function (m) {
        var p = evalPool(m.pool, kit), rg = styleRange(m.style, kit), dm = weaponDamage(kit, m.style, armed[m.style] ? armed[m.style][0] : '');
        return { name: m.name, sub: m.style + ' Rank ' + m.rank, pool: p.total + 'd', desc: m.text + ' Range: ' + rg.text + '. Damage pool: ' + dm.text + '.',
          act: { label: m.name, pool: p.total, parts: p.parts, unknown: p.unknown, kind: 'attack', desc: m.text, link: m.id ? '../rulebook/ch12.html#' + m.id : null, range: rg, targets: 'others', aura: auraFor(m.style), damagePool: dm.pool, damageText: dm.text, boostCap: (kit.dots || {})['Battle Aura'] || 0, boostName: 'Battle Aura', multiDots: (kit.dots || {})[m.style] || 0, boostStyle: m.style } };
      }));
      cats.push({ name: 'Attacks', items: atk, empty: (kit.maneuvers || []).length ? 'No maneuvers prepared. Prepare them on the Combat Loadout, then Refresh Stats.' : 'No Combat Styles.' });
      var spells = sp.filter(function (x) { return x.name !== 'Aura Fist' && x.name !== 'Aura Blade'; }).map(function (x) {
        var p = evalPool(x.pool, kit, x), attack = /attack/i.test(x.type || ''), rg = parseRange(x.range, LOS);
        return { name: x.name, sub: x.school + ' Rank ' + x.rank + '. ' + (x.costText || x.cost) + ' mana', pool: p.total + 'd', desc: [x.type, x.range ? 'Range: ' + x.range : '', x.defense ? 'Defense: ' + x.defense : ''].filter(Boolean).join('. ') + '. ' + (x.effect || ''),
          act: { label: x.name, pool: p.total, parts: p.parts, unknown: p.unknown, spell: x, kind: attack ? 'attack' : 'roll', range: rg, targets: rg.only ? 'self' : attack ? 'others' : 'any',
            desc: [x.type, x.range, x.defense ? 'Defense: ' + x.defense : ''].filter(Boolean).join('. ') + '. ' + (x.effect || ''), link: x.id ? '../rulebook/' + (x.page || 'ch13') + '.html#' + x.id : null } };
      });
      cats.push({ name: 'Spells', items: spells, empty: (kit.spells || []).length ? 'No spells prepared. Prepare them on the Combat Loadout, then Refresh Stats.' : 'No spells known.' });
      var ka = kit.attrs || {}, kb = kit.abilities || {};
      function soc(name, attr, ab, desc, extra) {
        var n = (ka[attr] || 0) + (kb[ab] || 0);
        return { name: name, sub: attr + ' + ' + ab, pool: n + 'd', desc: desc + ' They resist with Willpower + Composure. Each success over is 1 Willpower damage.',
          act: Object.assign({ label: name, pool: n, parts: [[attr, ka[attr] || 0], [ab, kb[ab] || 0]], kind: 'attack', social: true, range: { n: 99, text: 'anyone who can hear you' }, targets: 'others' }, extra || {}) };
      }
      var intim = (ka.Manipulation || 0) > (ka.Charisma || 0) ? 'Manipulation' : 'Charisma';
      var socItems = [
        soc('Persuade', 'Charisma', 'Persuasion', 'Win them over with a real argument.'),
        soc('Intimidate', intim, 'Presence', 'Make them afraid of what happens next.'),
        soc('Deceive', 'Manipulation', 'Subterfuge', 'Sell them a lie.'),
        soc('Taunt', 'Manipulation', 'Expression', 'Get under their skin. If you win, they must attack you on their next turn.', { post: async function (row, t, res) { if (t && res && res.hit) await note(t.name + ' is taunted: they must attack ' + c.name + ' on their next turn.'); } })];
      cats.push({ name: 'Social', items: socItems.concat([{ name: 'Social Attack', sub: 'Social Attribute + an Ability', pool: '', desc: 'Words as a weapon. You roll a Social Attribute + a relevant Ability; they roll Willpower + Composure. Each success over is 1 Willpower damage. 5 or more over for the defender is a Critical Comeback.',
        act: { label: 'Social Attack', kind: 'attack', social: true, range: { n: 99, text: 'anyone who can hear you' }, targets: 'others', run: function (t, info) { socialDialog(c, t, info, after); } } }]) });
    }
    cats.push({ name: 'Other', items: [{ name: 'Custom roll', sub: 'Type the dice yourself', pool: '?', desc: 'For anything the menu does not cover.', act: { label: 'Custom roll', targets: 'none', run: function () { customRoll(c, after); } } }] });
    return cats;
  }

  function actionMenu(c) {
    var after = attackAfter(c), cats = menuCats(c, after);
    sfx('open');
    var ci = R.ffCat !== undefined ? Math.min(R.ffCat, cats.length - 1) : cats[0].items.length ? 0 : 1;
    var d = el('dialog', { class: 'ff-menu', 'aria-label': 'Action menu for ' + c.name });
    var catList = el('div', { class: 'ff-cats', role: 'tablist', 'aria-label': 'Categories' });
    var itemList = el('div', { class: 'ff-list', role: 'list' });
    var help = el('p', { class: 'ff-help', 'aria-live': 'polite' });
    var head = el('div', { class: 'ff-head' }, [el('span', { class: 'px', text: c.name }), el('span', { class: 'ff-stats', text: 'AP ' + (c.ap || 0) + '   MP ' + (c.mana || 0) + '/' + (c.mana_max || 0) + '   WP ' + (c.willpower || 0) })]);
    function close() { d.close(); d.remove(); }
    function drawCats() {
      catList.textContent = '';
      cats.forEach(function (cat, i) {
        catList.appendChild(el('button', { type: 'button', role: 'tab', 'aria-selected': String(i === ci), class: 'ff-cat' + (i === ci ? ' on' : ''), 'data-i': String(i),
          onclick: function () { ci = i; R.ffCat = i; drawCats(); drawItems(); }, onfocus: function () { help.textContent = cat.items.length ? cat.items.length + ' option' + (cat.items.length === 1 ? '' : 's') + '.' : ''; } }, [cat.name]));
      });
    }
    function drawItems() {
      itemList.textContent = '';
      var cat = cats[ci];
      if (!cat.items.length) { itemList.appendChild(el('p', { class: 'ff-empty', text: cat.empty || 'Nothing here.' })); help.textContent = ''; return; }
      cat.items.forEach(function (it) {
        var b = el('button', { type: 'button', class: 'ff-item', role: 'listitem',
          onfocus: function () { help.textContent = it.desc || it.sub || ''; sfx('cursor'); }, onmouseenter: function () { help.textContent = it.desc || it.sub || ''; },
          onclick: function () { sfx('select'); close(); startTarget(c, it.act, after); } },
          [el('span', { class: 'ff-name' }, [el('b', { text: it.name }), it.sub ? el('small', { text: it.sub }) : null]), it.pool ? el('span', { class: 'ff-pool', text: it.pool }) : null]);
        itemList.appendChild(b);
      });
      help.textContent = cat.items[0].desc || cat.items[0].sub || '';
    }
    d.addEventListener('keydown', function (e) {
      var inCats = e.target.classList.contains('ff-cat'), inItems = e.target.classList.contains('ff-item');
      var group = inCats ? catList.querySelectorAll('.ff-cat') : itemList.querySelectorAll('.ff-item');
      var idx = Array.prototype.indexOf.call(group, e.target);
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && idx >= 0) {
        e.preventDefault(); var nx = group[(idx + (e.key === 'ArrowDown' ? 1 : group.length - 1)) % group.length]; nx.focus();
        if (inCats) { ci = +nx.getAttribute('data-i'); R.ffCat = ci; drawCats(); drawItems(); catList.querySelectorAll('.ff-cat')[ci].focus(); }
      } else if (e.key === 'ArrowRight' && inCats) { e.preventDefault(); var f = itemList.querySelector('.ff-item'); if (f) f.focus(); }
      else if ((e.key === 'ArrowLeft' || e.key === 'Backspace') && inItems) { e.preventDefault(); catList.querySelectorAll('.ff-cat')[ci].focus(); }
    });
    d.addEventListener('cancel', function () { setTimeout(close, 0); });
    drawCats(); drawItems();
    d.appendChild(head);
    d.appendChild(el('div', { class: 'ff-body' }, [catList, itemList]));
    d.appendChild(help);
    d.appendChild(el('div', { class: 'ff-foot' }, [el('button', { type: 'button', class: 'ff-close', onclick: close, text: 'Close' })]));
    document.body.appendChild(d); d.showModal();
    var first = itemList.querySelector('.ff-item') || catList.querySelectorAll('.ff-cat')[ci]; if (first) first.focus();
  }

  // Marks the Action done, or, with extra attacks still to make, keeps the phase open and records each attack for the Damage phase
  function attackAfter(c) {
    return async function (r) {
      var det = (r && r.detail) || {}, t = ST().t || {};
      var ids = (t.attacks || []).concat(det.kind === 'attack' ? [r.id] : []);
      if (det.multi) R.multi = { c: c.id, left: det.multi, total: det.multi + 1, n: 1, act: null };
      else if (det.multiOf && R.multi && R.multi.c === c.id) { R.multi.left--; R.multi.n++; }
      if (R.multi && R.multi.c === c.id && R.multi.left > 0) {
        await saveState({ t: Object.assign({}, t, { attacks: ids, attack: ids[0] || null, multiUsed: true }) });
        return;
      }
      R.multi = null;
      return markDone({ attack: ids[0] || null, attacks: ids, multiUsed: t.multiUsed || !!det.multi });
    };
  }
  function nextAttack(c, a) {
    if (!(R.multi && R.multi.c === c.id && R.multi.left > 0)) return;
    var base = a.base || a, nm = base.label.replace(/ \(attack \d+ of \d+\)$/, '');
    startTarget(c, Object.assign({}, base, { label: nm + ' (attack ' + (R.multi.n + 1) + ' of ' + R.multi.total + ')', multiOf: (R.multi.n + 1) + ' of ' + R.multi.total, base: base }), base.after);
  }
  async function skipRest(c) {
    R.multi = null; R.targeting = null;
    var t = ST().t || {};
    await markDone({ attack: (t.attacks || [])[0] || null, attacks: t.attacks || [], multiUsed: true });
  }
  // After a pick: light up the targets in range on the map (or skip it when there is no target)
  function startTarget(c, act, after) {
    act = Object.assign({ after: after, fromMenu: true }, act);
    if (!act.base) act.base = act;
    if (act.targets === 'none') { if (act.run) act.run(null, null); else rollDialog(c, Object.assign({}, act, { targetId: '', targetable: false })); return; }
    if (act.targets === 'self' || !placedC(c)) {
      if (act.targets === 'self') return finishTarget(c, act, c, { ok: true, note: 'self' });
      if (act.run) return act.run(null, null);
      return rollDialog(c, act);   // not on the map yet: pick the target in the roll window
    }
    var ok = {};
    list().forEach(function (t) {
      if (t.id === c.id && act.targets === 'others') return;
      if (t.id === c.id) { if (act.range.self || act.targets === 'any') ok[t.id] = { ok: true, note: 'self' }; return; }
      if (!placedC(t)) return;
      ok[t.id] = targetCheck(c, t, act.range);
    });
    R.targeting = { c: c, act: act, ok: ok };
    drawAll();
    var m = $('cb-map'); if (m && m.scrollIntoView) m.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function chooseTarget(t, info) {
    var tg = R.targeting; if (!tg) return;
    R.targeting = null; drawAll();
    finishTarget(tg.c, tg.act, t, info);
  }
  function finishTarget(c, act, t, info) {
    var a = Object.assign({}, act, { targetId: t ? t.id : '', rangeNote: info ? info.note || info.why || '' : '' });
    if (info && !info.ok) a.override = true;
    if (info && info.cover) { a.pool = Math.max(0, (a.pool || 0) - 2); a.parts = (a.parts || []).concat([['Half cover', -2]]); }
    var aim = (c.stats || {}).aim;
    if (aim && t && aim.target === t.id && a.kind === 'attack' && !a.social && a.range && a.range.sight) { a.pool = (a.pool || 0) + 2; a.parts = (a.parts || []).concat([['Aim', 2]]); a.aimUsed = true; }
    if (a.run) return a.run(t, info);
    rollDialog(c, a);
  }
  // Combat Action helpers
  function poolOf(t, str) { var k = t.stats || {}; return k.npc ? (k.defense || 0) : evalPool(str, k).total; }
  function guardDice(t) { var g = (t.stats || {}).guard || {}; return (g.total ? 2 : 0) + (g.cover ? (+g.cover || 1) : 0); }
  function guardText(t) { var g = (t.stats || {}).guard || {}; return [g.total ? 'Total Defense' : '', g.cover ? 'taking cover' : ''].filter(Boolean).join(', '); }
  async function setGuard(c, key, val) { var k = c.stats || {}, g = Object.assign({}, k.guard || {}); g[key] = val || true; await upd(c, { stats: Object.assign({}, k, { guard: g }) }); }
  function nearCover(c) {
    if (!placedC(c)) return false;
    var ter = (R.enc.map || {}).terrain || {}, n = zonesOf(c);
    var best = false;   // 'full' beside a wall or boulder, 'half' beside brush or crates
    for (var x = c.x - 1; x <= c.x + n; x++) for (var y = c.y - 1; y <= c.y + n; y++) { var t = TER[ter[x + ',' + y]]; if (t && t[3] === 'block') return 'full'; if (t && t[3] === 'cover') best = 'half'; }
    return best;
  }
  function freeZone(t, x, y) {
    var m = R.enc.map || {}, cols = m.cols || 6, rows = m.rows || 8, ter = m.terrain || {}, n = zonesOf(t);
    if (x < 0 || y < 0 || x + n > cols || y + n > rows) return false;
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var tt = TER[ter[(x + i) + ',' + (y + j)]]; if (tt && tt[3] === 'block') return false;
      if (list().some(function (o) { return o.id !== t.id && placedC(o) && x + i >= o.x && x + i < o.x + zonesOf(o) && y + j >= o.y && y + j < o.y + zonesOf(o); })) return false;
    }
    return true;
  }
  async function addCond(t, cd) {
    if ((t.conditions || []).indexOf(cd) >= 0) return;
    if (mineC(t)) await upd(t, { conditions: (t.conditions || []).concat([cd]) });
    else await note('Storyteller: mark ' + t.name + ' ' + cd + '.');
  }
  async function contestWin(name, c, t) {
    if (!t) return;
    if (name === 'Shove') {
      var nc = zonesOf(c), nt = zonesOf(t);
      var dx = Math.sign((t.x + nt / 2) - (c.x + nc / 2)), dy = Math.sign((t.y + nt / 2) - (c.y + nc / 2)), nx = t.x + dx, ny = t.y + dy;
      if (!placedC(t) || !placedC(c) || !freeZone(t, nx, ny)) { await note(t.name + ' has no empty zone behind them, so they stay put.'); return; }
      var zl = String.fromCharCode(65 + nx) + (ny + 1);
      if (mineC(t)) { await upd(t, { x: nx, y: ny }); await note(c.name + ' shoves ' + t.name + ' to ' + zl + '.'); }
      else await note(c.name + ' shoves ' + t.name + '. Storyteller: move them to ' + zl + '.');
    } else if (name === 'Trip') { await addCond(t, 'Prone'); await note(t.name + ' is knocked Prone.'); }
    else if (name === 'Grapple') { await addCond(t, 'Grappled'); await note(t.name + ' is Grappled: no belt items or attacks until they break free.'); }
    else if (name === 'Disarm') await note(t.name + ' is disarmed: their weapon lands in an adjacent zone.');
  }
  async function hideCheck(c, row) {
    var foes = list().filter(function (o) { return o.side !== c.side && o.side !== 'neutral' && placedC(o) && !incap(o); }), spotted = [];
    for (var i = 0; i < foes.length; i++) {
      var o = foes[i], n = Math.max(0, poolOf(o, 'Perception + Awareness') - woundPenalty(o)), dice = d10s(n), sc = successes(dice);
      await addRoll({ combatant_id: o.id, label: 'Perception + Awareness to spot ' + c.name, pool: n, dice: dice, successes: sc, detail: { kind: 'roll' } });
      if (sc >= row.successes) spotted.push(o.name);
    }
    if (!spotted.length) { await upd(c, { hidden: true }); await note(c.name + ' is hidden until they attack or someone finds them.'); }
    else await note(c.name + ' is spotted by ' + spotted.join(', ') + '.');
  }
  function socialDialog(c, t, info, after) {
    var kit = c.stats || {}, d = dialog('Social Attack' + (t ? ' on ' + t.name : ''));
    var attr = el('select', { id: 'so-attr' }); ['Charisma', 'Manipulation', 'Composure'].forEach(function (a) { attr.appendChild(opt(a, a + ' (' + ((kit.attrs || {})[a] || 0) + ')', a === 'Charisma')); });
    var ab = el('select', { id: 'so-ab' });
    Object.keys(kit.abilities || {}).sort().forEach(function (a) { ab.appendChild(opt(a, a + ' (' + (kit.abilities[a] || 0) + ')', a === 'Persuasion')); });
    var line = el('p', { class: 'cb-line' });
    function pool() { return ((kit.attrs || {})[attr.value] || 0) + ((kit.abilities || {})[ab.value] || 0); }
    function draw() { line.textContent = 'Dice: ' + pool() + (info && info.cover ? ' (half cover does not apply to words)' : '') + '. ' + (t ? t.name + ' defends with ' + socialDefense(t).name + '.' : ''); }
    attr.addEventListener('change', draw); ab.addEventListener('change', draw);
    d.body.appendChild(el('div', { class: 'cb-f' }, [el('p', { class: 'cb-desc', text: 'Pick the Social Attribute and the Ability that fit what you say: a threat, a plea, a lie, a taunt.' }), el('div', { class: 'two' }, [field('Social Attribute', attr), field('Ability', ab)]), line]));
    draw();
    d.ok('Next', function () {
      rollDialog(c, { label: 'Social: ' + attr.value + ' + ' + ab.value, pool: pool(), parts: [[attr.value, (kit.attrs || {})[attr.value] || 0], [ab.value, (kit.abilities || {})[ab.value] || 0]], kind: 'attack', social: true,
        targetId: t ? t.id : '', rangeNote: info && info.ok === false ? info.why : '', override: !!(info && info.ok === false), after: after, fromMenu: true });
    });
    d.open();
  }
  // The answer after the roll: hit or miss, and how many successes carry to the Damage phase
  function resultWindow(c, t, row, res, a, onClose) {
    var d = el('dialog', { class: 'ff-menu ff-result', 'aria-label': 'Result' });
    var hit = res && res.hit, title = !res ? 'ROLLED' : a.kind === 'contest' ? (hit ? 'SUCCESS!' : 'BLOCKED') : hit ? 'HIT!' : 'MISS';
    var lines = [el('p', {}, [el('b', { text: c.name }), ' rolled ' + row.successes + ' success' + (row.successes === 1 ? '' : 'es') + ' on ' + row.pool + (row.pool === 1 ? ' die.' : ' dice.')])];
    if (res) lines.push(el('p', {}, [el('b', { text: t.name }), '’s ' + res.name + ': ' + res.def + ' success' + (res.def === 1 ? '' : 'es') + '.']));
    if (hit && a.kind === 'contest') lines.push(el('p', { class: 'ff-big' }, [el('b', { text: String(res.excess) }), ' over. ' + (a.winText || 'You win.')]));
    else if (hit) lines.push(el('p', { class: 'ff-big' }, [el('b', { text: String(res.excess) }), ' success' + (res.excess === 1 ? '' : 'es') + ' over. ' + (a.social ? 'That is ' + res.excess + ' Willpower damage in the Damage phase.' : 'They carry to the Damage phase.')]));
    else if (res) lines.push(el('p', { text: a.social ? 'The words do not land.' : a.kind === 'contest' ? 'The defense holds.' : 'The defense holds. No damage to roll.' }));
    if (R.multi && R.multi.c === c.id && R.multi.left > 0) lines.push(el('p', { text: R.multi.left + ' extra attack' + (R.multi.left === 1 ? '' : 's') + ' to go. Pick the next target.' }));
    function close() { if (!d.parentNode) return; if (d.open) d.close(); d.remove(); if (onClose) onClose(); }
    d.appendChild(el('h2', { class: 'px ff-title ' + (hit ? 'hit' : res ? 'miss' : ''), text: title }));
    lines.forEach(function (l) { d.appendChild(l); });
    var ok = el('button', { type: 'button', class: 'ff-close', text: 'OK', onclick: close });
    d.appendChild(el('div', { class: 'ff-foot' }, [ok]));
    d.addEventListener('cancel', function () { setTimeout(close, 0); });
    document.body.appendChild(d); d.showModal(); ok.focus();
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
      var line = det.kind === 'wpdmg' ? [] : [el('span', { class: 'cb-succ', text: r.successes + ' success' + (r.successes === 1 ? '' : 'es') })];
      if (r.pool) line.push(' on ' + r.pool + ' dice');
      if (det.mana) line.push('. ' + det.mana + ' mana spent' + (det.setAside ? ' (' + det.setAside + ' set aside for damage)' : ''));
      if (det.ap) line.push('. ' + det.ap + ' AP');
      if (det.wp) line.push('. 1 Willpower');
      if (det.kind === 'defense' && det.vs && det.contest) line.push(det.hit ? '. ' + ((R.cs[(R.rolls.filter(function (x) { return x.id === det.vs; })[0] || {}).combatant_id] || {}).name || 'The attacker') + ' wins.' : '. The defense holds.');
      else if (det.kind === 'defense' && det.vs && det.social) line.push(det.hit ? '. The words land: ' + det.excess + ' Willpower damage in the Damage phase.' : '. The defense holds.');
      else if (det.kind === 'defense' && det.vs) line.push(det.hit ? '. The attack lands, ' + det.excess + ' success' + (det.excess === 1 ? '' : 'es') + ' over the defense carry to damage.' : '. The defense holds: a miss.');
      if (det.kind === 'damage') {
        var t = R.cs[det.target];
        line.push('. Total damage ' + det.total + ' (' + det.excess + ' excess)');
        line.push(det.result ? ': ' + { b: 'Bashing', l: 'Lethal', a: 'Aggravated' }[det.result] + (t ? ' to ' + t.name : '') : t ? ': below ' + t.name + '’s BDT, no damage' : '');
      }
      li.appendChild(el('div', {}, line));
      var btns = el('div', { class: 'cb-bar', style: 'margin-top:4px' });
      var defR = R.rolls.filter(function (x) { return (x.detail || {}).vs === r.id; })[0], tg0 = R.cs[det.target];
      if (det.kind === 'wpdmg' && !applied[r.id] && tg0 && mineC(tg0)) btns.appendChild(el('button', { class: 'act cb-mini primary', type: 'button', text: 'Apply to ' + tg0.name, onclick: function (e) { e.target.disabled = true; applyWp(r); } }));
      if (det.kind === 'attack' && !det.social && c && mineC(c) && !(defR && !defR.detail.hit)) btns.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Roll Damage', onclick: function () { damageDialog(r); } }));
      var hasDef = R.rolls.some(function (x) { return (x.detail || {}).vs === r.id; });
      if (det.kind === 'attack' && !hasDef && det.target && R.cs[det.target] && R.cs[det.target].owner === me.id && R.cs[det.target].owner !== (c && c.owner)) {
        btns.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Defend', onclick: function () { R.sel = det.target; drawAll(); $('cb-loadout').scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));
      }
      var tg = R.cs[det.target];
      var atkr = R.cs[det.attacker] || c;
      if (det.kind === 'damage' && det.result && !applied[r.id] && tg && (mineC(tg) || (atkr && mineC(atkr)))) btns.appendChild(el('button', { class: 'act cb-mini primary', type: 'button', text: 'Apply to ' + tg.name, onclick: function (e) { e.target.disabled = true; applyDamage(r); } }));
      if (btns.children.length) li.appendChild(btns);
      ul.appendChild(li);
    });
    l.appendChild(el('h2', { class: 'px', style: 'margin-top:0', text: 'Roll Log' }));
    l.appendChild(ul.children.length ? ul : el('p', { class: 'cv-muted', text: 'No rolls yet. 6 or higher is a success; a 10 counts twice.' }));
  }

  // My Bestiary: every creature as a JRPG monster book. Ones you have added show their full entry; the rest are ??? until you fight them.
  async function bestiaryPage(main) {
    main.textContent = '';
    if (!me) { main.appendChild(el('section', { class: 'panel win' }, [el('h1', { text: 'My Bestiary' }), el('p', { class: 'center' }, ['', el('a', { href: '../account/index.html?next=combat/my-bestiary.html', text: 'Log in' }), ' to see your Bestiary.'])])); return; }
    await loadBestiary(); await sprites().catch(function () {});
    var L = await bestList();
    var got = L.filter(function (b) { return R.myBest[b.id]; }).length;
    var head = el('section', { class: 'panel win' }, [el('h1', { text: 'My Bestiary' }),
      el('p', { class: 'center px cb-bestcount', text: 'DISCOVERED ' + got + ' / ' + L.length }),
      el('p', { class: 'center', text: R.bestOff ? 'Your Bestiary needs one more setup step on the server. Ask the Storyteller.' : 'Fight a creature in the combat room, then tap Add to My Bestiary on its card. Its full entry shows here and in every fight after.' })]);
    var q = el('input', { type: 'search', placeholder: 'Search your Bestiary', 'aria-label': 'Search your Bestiary' });
    var only = el('label', { class: 'chk' }, [el('input', { type: 'checkbox', id: 'best-only' }), 'Only show discovered']);
    head.appendChild(el('div', { class: 'cb-bar', style: 'justify-content:center' }, [q, only]));
    main.appendChild(head);
    var grid = el('div', { class: 'cb-bookgrid' });
    main.appendChild(el('section', { class: 'panel win' }, [grid]));
    function draw() {
      grid.textContent = '';
      var t = q.value.trim().toLowerCase(), on = $('best-only').checked, n = 0;
      L.forEach(function (b, i) {
        var known = !!R.myBest[b.id];
        if (on && !known) return;
        if (t && !(known && (b.name + ' ' + b.section + ' ' + b.type).toLowerCase().indexOf(t) >= 0)) return;
        n++;
        var pic = el('div', { class: 'cb-bookpic' + (known ? '' : ' unknown') }, [b.sprite ? spriteNode(b.sprite, 64) : el('span', { text: '?' })]);
        grid.appendChild(el('article', { class: 'cb-bookcard' + (known ? '' : ' unknown') }, [
          el('div', { class: 'cb-booknum px', text: 'No. ' + ('00' + (i + 1)).slice(-3) }), pic,
          el('h2', { class: 'px', text: known ? b.name : '???' }),
          known ? statBlock(b) : el('p', { class: 'cb-desc center', text: b.section + ' · Rank ' + b.rank })]));
      });
      if (!n) grid.appendChild(el('p', { class: 'center cv-muted', text: 'Nothing here yet.' }));
    }
    q.addEventListener('input', draw); $('best-only').addEventListener('change', draw);
    draw();
  }

  async function roomPage(main) {
    if (!me) { main.appendChild(el('section', { class: 'panel win' }, [el('p', { class: 'center', text: 'Log in to join this fight.' }), el('div', { class: 'button-row center-row' }, [el('a', { class: 'act primary', href: '../account/index.html?next=combat/index.html', text: 'Log In' })])])); return; }
    var id = new URLSearchParams(location.search).get('id');
    var enc = id ? (await db.from('encounters').select('*').eq('id', id).maybeSingle()).data : null;
    if (!enc) { main.appendChild(el('section', { class: 'panel win' }, [el('p', { class: 'center', text: 'This encounter is over, or you have not joined it. Join with its code on the Combat page.' }), el('div', { class: 'button-row center-row' }, [el('a', { class: 'act primary', href: 'index.html', text: 'Combat' })])])); return; }
    R.enc = enc; R.host = enc.host === me.id;
    document.title = enc.name + ' | Combat | Jimothy’s D10 Isekai JRPG';
    main.appendChild(el('section', { class: 'panel win cb-top', id: 'cb-top' }));
    main.appendChild(el('section', { class: 'panel win cb-banner', id: 'cb-banner', 'aria-label': 'Turn order' }));
    main.appendChild(el('div', { class: 'cb-layout' }, [
      el('div', { class: 'cb-col' }, [
        el('section', { class: 'panel win cb-arena' }, [el('div', { class: 'cb-mapwrap', id: 'cb-map' }), el('nav', { class: 'cb-phases', id: 'cb-phases', 'aria-label': 'Combat phases' }), el('div', { class: 'cb-toasts', id: 'cb-toasts', 'aria-live': 'polite' })]),
        el('section', { class: 'panel win', id: 'cb-loadout' })]),
      el('div', { class: 'cb-col' }, [el('section', { class: 'panel win cb-card', id: 'cb-card' }), el('section', { class: 'panel win', id: 'cb-log' })])
    ]));
    drawer('left', 'Music', '♫').appendChild(el('div', { class: 'cb-music', id: 'cb-music' }));
    drawer('right', 'My Sheets', '📜').appendChild(el('div', { id: 'cb-mine' }));
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.querySelector('.cb-drawer.open')) { toggleDrawer('left', false); toggleDrawer('right', false); } });
    await loadBestiary();
    await sprites().catch(function () {});
    await refresh();
    live();
    window.addEventListener('resize', function () { drawMap(); });
  }

  A.currentPlayer().then(async function (p) {
    me = p;
    var main = $('cb-main'); main.textContent = '';
    try { await (page === 'room' ? roomPage : page === 'bestiary' ? bestiaryPage : listPage)(main); }
    catch (e) { main.appendChild(el('section', { class: 'panel win' }, [el('p', { class: 'center', text: 'Combat could not load. ' + oops(e) }), el('p', { class: 'center cv-muted', text: 'If this keeps happening, combat may not be set up on the server yet.' })])); }
  });
})();
