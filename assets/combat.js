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
  function moveLeft(c) { var t = ST().t; return Math.max(0, moveOf(c) + (t.extra || 0) - (t.moved || 0)); }
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

  function drawAll() { drawTop(); drawBanner(); drawMap(); drawPhases(); drawLoadout(); drawCard(); drawLog(); }

  // ---------- top box ----------
  function drawTop() {
    var t = $('cb-top'); t.textContent = '';
    var s = ST(), cur = current();
    t.appendChild(el('div', {}, [el('h1', { class: 'px', text: R.enc.name }),
      el('div', { class: 'cb-sub' }, ['Storyteller: ' + (R.players[R.enc.host] || '') + '. ' + (R.enc.public ? 'Public fight' : 'Private fight') + '. Join code ', el('span', { class: 'cb-code', text: R.enc.code })])]));
    var status = s.started ? 'Round ' + s.round + ': ' + (cur ? cur.name + '’s turn, ' + PHASES[s.phase][0] + ' Phase' : 'nobody left in the order') : s.order.length ? 'Turn order is set. Ready to start.' : 'Setting up: bring characters, add NPCs, then set the turn order.';
    var bar = el('div', { class: 'cb-bar' }, [el('span', { class: 'cb-round', text: status })]);
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
  function drawMap() {
    var m = R.enc.map || {}, cols = m.cols || 6, rows = m.rows || 8;
    var wrap = $('cb-map'); wrap.textContent = '';
    var size = Math.max(36, Math.min(72, Math.floor((wrap.clientWidth - 30) / cols) - 3));
    var grid = el('div', { class: 'cb-map ' + (m.theme === 'light' ? 'light' : 'dark'), role: 'grid', 'aria-label': 'Battle map, ' + cols + ' by ' + rows + ' zones', style: 'grid-template-columns:repeat(' + cols + ', var(--z));--z:' + size + 'px' });
    var at = {}; list().forEach(function (c) { if (c.x !== null && c.x !== undefined && c.y !== null) at[c.x + ',' + c.y] = c; });
    var s = ST(), cur = current(), mover = R.moving ? R.cs[R.moving] : null;
    var counted = !!(mover && s.started && cur && mover.id === cur.id && (s.phase === 2 || s.phase === 5));
    var left = mover ? (counted ? moveLeft(mover) : 99) : 0;
    for (var y = 0; y < rows; y++) for (var x = 0; x < cols; x++) (function (x, y) {
      var c = at[x + ',' + y];
      var label = String.fromCharCode(65 + x) + (y + 1);
      var dist = mover && mover.x !== null && mover.x !== undefined ? Math.max(Math.abs(x - mover.x), Math.abs(y - mover.y)) : 0;
      var reach = mover && !c && (mover.x === null || mover.x === undefined || dist <= left);
      var z = el('button', { type: 'button', class: 'cb-zone' + (reach ? ' target' : ''), 'aria-label': 'Zone ' + label + (c ? ': ' + c.name : ', empty') }, [el('span', { class: 'lab', text: label })]);
      if (c) {
        var tok = el('span', { class: 'cb-token ' + c.side + (R.sel === c.id ? ' sel' : '') + (cur && cur.id === c.id ? ' turn' : '') + (incap(c) ? ' down' : '') + (c.hidden ? ' hid' : ''), text: c.pic_url ? '' : initials(c.name) });
        if (c.pic_url) tok.style.backgroundImage = 'url("' + c.pic_url.replace(/"/g, '') + '")';
        z.appendChild(tok);
      }
      z.addEventListener('click', function () {
        if (c) { R.sel = c.id; R.moving = mayMove(c) ? (R.moving === c.id ? null : c.id) : null; drawAll(); return; }
        if (!mover || !reach) return;
        var placing = mover.x === null || mover.x === undefined, fromX = mover.x, fromY = mover.y;
        R.moving = null;
        upd(mover, { x: x, y: y });
        if (counted && !placing) { var t = Object.assign({}, ST().t); markDone({ moved: (t.moved || 0) + dist, last: { id: mover.id, x: fromX, y: fromY, dist: dist, phase: s.phase, wasDone: !!(t.done || {})[s.phase] } }); }
      });
      grid.appendChild(z);
    })(x, y);
    wrap.appendChild(grid);
    var hint;
    if (mover) hint = counted ? 'Moving ' + mover.name + ': ' + left + ' zone' + (left === 1 ? '' : 's') + ' left this turn (diagonals count as 1). Pick a lit zone.' : 'Placing ' + mover.name + ': pick any empty zone.';
    else if (!s.started) hint = 'Setup: pick your token, then any empty zone, to place it.';
    else if (canControl() && (s.phase === 2 || s.phase === 5)) hint = 'Pick ' + cur.name + ', then a lit zone, to move.';
    else hint = 'Tokens move during the Move or Use Item phases.';
    var unplaced = list().filter(function (c) { return (c.x === null || c.x === undefined) && mineC(c); });
    wrap.appendChild(el('p', { class: 'cb-maphint', text: hint + (unplaced.length ? ' Not on the map yet: ' + unplaced.map(function (c) { return c.name; }).join(', ') + '.' : '') }));
  }
  // Who may move a token right now
  function mayMove(c) {
    var s = ST(), cur = current();
    if (!mineC(c)) return false;
    if (!s.started || c.x === null || c.x === undefined) return true;   // setup, or placing a newcomer
    if (R.host && (!cur || c.id !== cur.id)) return true;              // the Storyteller can reposition anyone else
    return !!cur && c.id === cur.id && canControl() && (s.phase === 2 || s.phase === 5) && moveLeft(c) > 0;
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
    if (s.phase === 0) await doUpkeep(c);
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
    var mana = Math.max(0, Math.min(c.mana_max || 0, (c.mana || 0) + regenOf(c)) - paid);
    var patch = { ap: Math.min(3, (c.ap || 0) + (k.hurt ? 2 : 1)), mana: mana, stats: Object.assign({}, k, { hurt: false, effects: kept }) };
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
      box.appendChild(el('p', { class: 'cb-line', text: 'When you click Upkeep: +' + hurt + ' AP' + (kit.hurt ? ' (you were hurt)' : '') + ' up to 3, and +' + regenOf(c) + ' mana.' }));
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
      var left = moveLeft(c);
      box.appendChild(el('p', { class: 'cb-line' }, ['Movement left: ', el('b', { text: left + ' of ' + (moveOf(c) + (t.extra || 0)) }), ' zone' + (left === 1 ? '' : 's') + '. Pick your token, then a lit zone.']));
      if (!R.moving && left > 0 && c.x !== null && c.x !== undefined) box.appendChild(actBtn('Move ' + c.name, 'Lights up the zones you can reach', null, function () { R.sel = c.id; R.moving = c.id; drawAll(); }));
      var lm = t.last;
      if (lm && lm.id === c.id && lm.phase === i) box.appendChild(actBtn('Undo last move', 'Back to ' + String.fromCharCode(65 + lm.x) + (lm.y + 1) + ' and get ' + lm.dist + ' zone' + (lm.dist === 1 ? '' : 's') + ' back', null, async function () {
        await upd(c, { x: lm.x, y: lm.y });
        var t2 = Object.assign({}, ST().t); t2.moved = Math.max(0, (t2.moved || 0) - lm.dist); t2.last = null; t2.done = Object.assign({}, t2.done); if (!lm.wasDone) delete t2.done[i];
        await saveState({ t: t2 });
      }));
      var apKids = [[1, 1], [3, 2], [6, 3]].map(function (x) {
        return actBtn('Spend ' + x[0] + ' AP', '+' + x[1] + ' zone' + (x[1] === 1 ? '' : 's') + ' of movement', x[0] + ' AP', async function () {
          if ((c.ap || 0) < x[0]) { alert(c.name + ' holds ' + (c.ap || 0) + ' AP. Allies can give AP first.'); return; }
          await upd(c, { ap: c.ap - x[0] });
          await markDone({ extra: (t.extra || 0) + x[1] });
          await note(c.name + ' spends ' + x[0] + ' AP for ' + x[1] + ' more zone' + (x[1] === 1 ? '' : 's') + ' of movement.');
        }, (c.ap || 0) < x[0]);
      });
      box.appendChild(group('Spend AP to move farther (' + (c.ap || 0) + ' AP held)', 'apmove', apKids));
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
      var after = function (r) { return markDone({ attack: r && (r.detail || {}).kind === 'attack' ? r.id : null }); };
      if (kit.npc) {
        var npcActs = ((kit.creature || {}).abilities || []).map(function (ab) {
          var isAtk = /melee|ranged|damage|casts|breath|bolt|bite|claw|strike|slam/i.test(ab.name + ' ' + ab.text);
          return actBtn(ab.name, ab.text, String(kit.attack || 0), function () { rollDialog(c, { label: c.name + ': ' + ab.name, pool: kit.attack || 0, parts: [['Attack pool', kit.attack || 0]], kind: isAtk ? 'attack' : 'roll', damagePool: kit.damage || 0, targetable: isAtk, desc: ab.text, after: after }); });
        });
        npcActs.push(actBtn('Basic attack', 'Attack pool against a target’s defense', String(kit.attack || 0), function () { rollDialog(c, { label: c.name + ': Attack', pool: kit.attack || 0, parts: [['Attack pool', kit.attack || 0]], kind: 'attack', damagePool: kit.damage || 0, after: after }); }));
        box.appendChild(group('Attack', 'atk', npcActs));
        box.appendChild(group('Other', 'other', [customButton(c, after)]));
        return;
      }
      var LO = kit.loadout || {}, mv = prepared(kit.maneuvers, LO.maneuvers), sp = prepared(kit.spells, LO.spells);
      var armed = {}; (kit.weapons || []).forEach(function (w) { var stn = (LO.weapons || {})[w.key] || ((kit.styles || []).length === 1 ? kit.styles[0].name : ''); if (stn) (armed[stn] = armed[stn] || []).push(w.name); });
      var atkKids = (kit.maneuvers || []).filter(function (m) { return m.rank === 0; }).map(function (m) {
        var p = evalPool(m.pool, kit);
        return actBtn(armed[m.style] ? 'Attack with ' + armed[m.style].join(' or ') : 'Attack (' + m.style + ')', m.style, p.total + 'd', function () { rollDialog(c, { label: (armed[m.style] ? 'Attack with ' + armed[m.style][0] : 'Attack') + ' (' + m.style + ')', pool: p.total, parts: p.parts, unknown: p.unknown, kind: 'attack', after: after }); });
      }).concat(mv.map(function (m) {
        var p = evalPool(m.pool, kit);
        return actBtn(m.name, m.style + ' Rank ' + m.rank + '. ' + m.text, p.total + 'd', function () { rollDialog(c, { label: m.name, pool: p.total, parts: p.parts, unknown: p.unknown, kind: 'attack', desc: m.text, link: m.id ? '../rulebook/ch12.html#' + m.id : null, after: after }); });
      }));
      if (!(kit.maneuvers || []).length) atkKids.push(el('p', { class: 'cb-desc', text: 'No Combat Styles.' }));
      else if (!mv.length) atkKids.push(el('p', { class: 'cb-desc' }, ['No maneuvers prepared. ', loadoutLink(c), ', then Refresh Stats.']));
      box.appendChild(group('Attack', 'atk', atkKids));
      var spKids = sp.map(function (x) {
        var p = evalPool(x.pool, kit, x), attack = /attack/i.test(x.type || '');
        return actBtn(x.name, x.school + ' Rank ' + x.rank + '. ' + (x.costText || x.cost) + ' mana. ' + (x.type || ''), p.total + 'd', function () {
          rollDialog(c, { label: x.name, pool: p.total, parts: p.parts, unknown: p.unknown, spell: x, kind: attack ? 'attack' : 'roll', desc: [x.type, x.range, x.defense ? 'Defense: ' + x.defense : ''].filter(Boolean).join('. ') + '. ' + (x.effect || ''), link: x.id ? '../rulebook/' + (x.page || 'ch13') + '.html#' + x.id : null, after: after });
        });
      });
      if (!sp.length) spKids.push(el('p', { class: 'cb-desc' }, [(kit.spells || []).length ? 'No spells prepared. ' : 'No spells known. ', (kit.spells || []).length ? loadoutLink(c) : null, (kit.spells || []).length ? ', then Refresh Stats.' : '']));
      box.appendChild(group('Cast a Spell', 'spell', spKids));
      box.appendChild(group('Other', 'other', [customButton(c, after)]));
      return;
    }
    if (i === 4) {
      var atk = t.attack ? R.rolls.filter(function (r) { return r.id === t.attack; })[0] : null;
      var dmg = atk ? R.rolls.filter(function (r) { return (r.detail || {}).kind === 'damage' && (r.detail || {}).of === atk.id; })[0] : null;
      if (!atk) { box.appendChild(el('p', { class: 'cb-line', text: 'No attack this turn. Click Damage to move on.' })); return; }
      var dr = R.rolls.filter(function (r) { return (r.detail || {}).vs === atk.id; })[0];
      if (dr) box.appendChild(el('p', { class: 'cb-line', text: (dr.detail.hit ? 'Hit: ' + atk.successes + ' against ' + dr.successes + ', so ' + dr.detail.excess + ' carry to damage.' : 'Missed: ' + atk.successes + ' against ' + dr.successes + '.') }));
      if (!dmg && dr && !dr.detail.hit) box.appendChild(el('p', { class: 'cb-line', text: 'No damage to roll. Click Damage to move on.' }));
      else if (!dmg) box.appendChild(actBtn('Roll Damage', atk.label, null, function () { damageDialog(atk, function () { return markDone(); }); }));
      else box.appendChild(el('p', { class: 'cb-line', text: 'Damage rolled: ' + dmg.label + '. Apply it from the Roll Log, then click Damage.' }));
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
  function drawLoadout() {
    var box = $('cb-loadout'); box.textContent = '';
    var c = R.sel ? R.cs[R.sel] : current();
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
  function drawCard() {
    var box = $('cb-card'); box.textContent = '';
    var c = R.sel ? R.cs[R.sel] : current();
    if (!c) { box.appendChild(el('p', { class: 'center cv-muted', text: 'Click a name in the banner to see their card.' })); return; }
    var can = mineC(c), bdt = c.bdt || 1, cur = current();
    var pic = el('div', { class: 'cb-portrait ' + c.side, text: c.pic_url ? '' : initials(c.name) });
    if (c.pic_url) pic.style.backgroundImage = 'url("' + c.pic_url.replace(/"/g, '') + '")';
    box.appendChild(pic);
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
      if (spell && /persistent/i.test(spell.type || '')) { // keep it on the card so Upkeep can ask about paying for it
        var st2 = Object.assign({}, c.stats || {}); st2.effects = (st2.effects || []).concat([{ name: spell.name, upkeep: Math.max(0, (spell.cost || 0) - 1) }]); await upd(c, { stats: st2 });
      }
      var row = await addRoll({ combatant_id: c.id, label: a.label + (tgt ? ' at ' + tgt.name : ''), pool: n, dice: dice, successes: succ,
        detail: { kind: a.kind || 'roll', target: tgt ? tgt.id : null, setAside: +dmgMana.value || 0, mana: spend, ap: +ap.value || 0, wp: wp.checked, real: real.checked, damagePool: a.damagePool || 0, attacker: c.id } });
      if ((a.kind || 'roll') === 'attack' && tgt && row) await autoDefend(row, tgt, spell);
      if (a.after) await a.after(row);
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
  async function autoDefend(atk, t, spell) {
    var d = bestDefense(t, spell), pen = woundPenalty(t), n = Math.max(0, d.total - pen);
    var dice = d10s(n), succ = successes(dice), ex = Math.max(0, atk.successes - succ);
    await addRoll({ combatant_id: t.id, label: d.name + ' against ' + ((R.cs[atk.combatant_id] || {}).name || 'the attack') + (pen ? ' (wounds -' + pen + ')' : ''), pool: n, dice: dice, successes: succ,
      detail: { kind: 'defense', vs: atk.id, auto: true, hit: atk.successes > succ, excess: ex } });
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
      el('p', { class: 'cb-desc', text: 'Damage pool: a weapon’s damage Attribute + its Rating. Spells that deal damage equal to excess successes use 0 here.' }),
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
    return el('button', { class: 'cb-act', type: 'button', onclick: function () {
      var d = dialog('Custom Roll');
      var lab = el('input', { maxlength: '80', placeholder: 'Strength + Athletics to break free' }), n = num('cu-n', 3, 0, 60);
      var kind = el('select', {}, [opt('roll', 'Any roll', true), opt('attack', 'An attack'), opt('defense', 'A defense')]);
      d.body.appendChild(el('div', { class: 'cb-f' }, [field('What is it?', lab), el('div', { class: 'two' }, [field('Dice', n), field('Kind', kind)])]));
      d.ok('Next', function () {
        rollDialog(c, { label: lab.value.trim() || 'Roll', pool: +n.value || 0, parts: [['Dice', +n.value || 0]], kind: kind.value, targetable: kind.value === 'attack', after: after });
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
      if (det.kind === 'defense' && det.vs) line.push(det.hit ? '. The attack lands, ' + det.excess + ' success' + (det.excess === 1 ? '' : 'es') + ' over the defense carry to damage.' : '. The defense holds: a miss.');
      if (det.kind === 'damage') {
        var t = R.cs[det.target];
        line.push('. Total damage ' + det.total + ' (' + det.excess + ' excess)');
        line.push(det.result ? ': ' + { b: 'Bashing', l: 'Lethal', a: 'Aggravated' }[det.result] + (t ? ' to ' + t.name : '') : t ? ': below ' + t.name + '’s BDT, no damage' : '');
      }
      li.appendChild(el('div', {}, line));
      var btns = el('div', { class: 'cb-bar', style: 'margin-top:4px' });
      var defR = R.rolls.filter(function (x) { return (x.detail || {}).vs === r.id; })[0];
      if (det.kind === 'attack' && c && mineC(c) && !(defR && !defR.detail.hit)) btns.appendChild(el('button', { class: 'act cb-mini', type: 'button', text: 'Roll Damage', onclick: function () { damageDialog(r); } }));
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
        el('section', { class: 'panel win cb-arena' }, [el('div', { class: 'cb-mapwrap', id: 'cb-map' }), el('nav', { class: 'cb-phases', id: 'cb-phases', 'aria-label': 'Combat phases' })]),
        el('section', { class: 'panel win', id: 'cb-loadout' })]),
      el('div', { class: 'cb-col' }, [el('section', { class: 'panel win cb-card', id: 'cb-card' }), el('section', { class: 'panel win', id: 'cb-log' })])
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
