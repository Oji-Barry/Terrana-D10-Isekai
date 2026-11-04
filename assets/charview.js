/* The website character page: characters/view.html?id=...
   Draws a Forge character in the site's style, in tabs, with links into the
   rulebook. The owner can record and spend XP, track Willpower, Fate, Sanity,
   and health, switch attuned spells on and off, and keep money, equipment,
   and notes. Changes save on their own a moment after you stop.
   Every number comes from assets/forge.js in headless mode, so the page and
   the Forge never disagree. */

(function () {
  var A = window.Terrana.auth, db = A.client;
  var $ = function (id) { return document.getElementById(id); };
  var id = new URLSearchParams(location.search).get('id');
  var row = null, data = null, me = null, M = null, mine = false, tab = 'overview';
  var TABS = [['overview', 'Overview'], ['traits', 'Attributes and Abilities'], ['styles', 'Combat Styles'], ['magic', 'Magic'],
    ['merits', 'Merits and Backgrounds'], ['companions', 'Companions'], ['gear', 'Equipment and Notes'], ['xp', 'Experience']];
  try { var saved = sessionStorage.getItem('cv-tab'); if (saved && TABS.some(function (t) { return t[0] === saved; })) tab = saved; } catch (e) {}

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
  function slug(s) { return String(s).toLowerCase().replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function link(href, text) { return href ? el('a', { href: href, target: '_blank', rel: 'noopener', text: text || 'Rules' }) : el('span', { text: text || '' }); }
  function dots(n, max) {
    max = Math.max(max || 7, n);
    var d = el('span', { class: 'cv-dots', role: 'img', 'aria-label': n + ' dot' + (n === 1 ? '' : 's') });
    for (var i = 0; i < max; i++) d.appendChild(el('span', { class: 'cv-dot' + (i < n ? ' on' : '') }));
    return d;
  }
  function card(title, kids, href) {
    return el('section', { class: 'cv-card' }, [el('h3', { class: 'px' }, [title, href ? ' ' : null, href ? el('a', { href: href, target: '_blank', rel: 'noopener', style: 'font-family:var(--body);font-size:13px', text: 'Rules' }) : null])].concat(kids));
  }
  function row2(name, sub, right) { return el('div', { class: 'cv-row' }, [el('span', { class: 'nm' }, [name, sub ? el('small', { text: sub }) : null]), right]); }
  function say(t, bad) { var m = $('cv-msg'); if (!m) { if (t) toast(t, bad); return; } m.textContent = t || ''; m.classList.toggle('err', !!bad); }
  function brief(t) { t = t || ''; if (t.length <= 220) return t; var m = t.match(/^(.+?[.!?])\s+(.+?[.!?])(\s|$)/); return m ? m[1] + ' ' + m[2] : t.slice(0, 200) + '...'; }
  function when(iso) { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return ''; } }
  var PHYS = { Strength: 1, Dexterity: 1, Fortitude: 1 };
  function attrLink(a) { return '../rulebook/ch6.html#' + (PHYS[a] ? 'attributes-' + slug(a) : 'attributes'); }
  function abLink(a) { return '../rulebook/ch6.html#quick-reference-' + slug(a); }
  function plus(n) { return n ? (n > 0 ? ' +' + n : ' ' + n) : ''; }

  // ---------- saving: a moment after the last change, then a quick "Saved" ----------
  var pending = null, timer = null, saving = false, again = false;
  function toast(text, bad) {
    var t = $('cv-toast');
    if (!t) { t = el('div', { id: 'cv-toast', class: 'cv-toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(t); }
    t.textContent = text; t.classList.toggle('err', !!bad); t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove('show'); }, bad ? 4000 : 1200);
  }
  // patch: extras to merge (gear, money, attuned, tracks)
  function queue(patch) {
    pending = Object.assign(pending || {}, patch);
    M = window.TerranaCharacter.setExtras(pending);
    clearTimeout(timer);
    timer = setTimeout(flush, 900);
  }
  async function flush() {
    if (!pending) return;
    if (saving) { again = true; return; }
    saving = true;
    var patch = pending; pending = null;
    var before = row.sheet || {};
    var notes = [];
    if (patch.money) { var a = moneyLine(before.money || M.money), b = moneyLine(patch.money); if (a !== b) notes.push('Money on hand: ' + b + ' (was ' + a + ')'); }
    if (patch.gear) notes = notes.concat(gearChanges(before.gear || {}, patch.gear));
    if (patch.attuned) Object.keys(Object.assign({}, before.attuned || {}, patch.attuned)).forEach(function (k) {
      var was = !!(before.attuned || {})[k], now = !!patch.attuned[k];
      if (was !== now) { var sp = (M.attunables || []).filter(function (x) { return x.id === k; })[0]; if (sp) notes.push(sp.name + (now ? ' attuned (' + sp.mana + ' mana held)' : ' released')); }
    });
    try { await persist(null, notes); toast('Saved'); }
    catch (e) { toast('Not saved: ' + A.friendly(e), true); pending = Object.assign(patch, pending || {}); }
    saving = false;
    if (again || pending) { again = false; clearTimeout(timer); timer = setTimeout(flush, 300); }
  }
  window.addEventListener('beforeunload', function (e) { if (pending || saving) { flush(); e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', function () { if (document.hidden && pending) flush(); });

  async function persist(nextModel, historyText) {
    var s = window.TerranaCharacter.sheet();
    var hist = ((row.sheet && row.sheet.history) || []).slice();
    (historyText || []).forEach(function (t) { hist.push({ d: new Date().toISOString(), text: t }); });
    if (hist.length > 400) hist = hist.slice(-400);
    var sheet = Object.assign({}, row.sheet || {}, { build: s.build, xp: s.xp, view: s.view, gear: s.gear, money: s.money, attuned: s.attuned, tracks: s.tracks, history: hist });
    var res = await db.from('characters').update({ sheet: sheet }).eq('id', id).select('sheet').single();
    if (res.error) throw res.error;
    row.sheet = res.data.sheet;
    M = nextModel || window.TerranaCharacter.model();
    drawHead();
  }

  // ---------- header ----------
  function drawHead() {
    var h = $('cv-head'); h.textContent = '';
    var st = {}; M.stats.forEach(function (x) { st[x.name] = x.dots; });
    var b = M.combat.bdt;
    var facts = [['Level', String(M.level)], ['Player', M.player], ['Heritage', M.heritage ? M.heritage.name + (M.heritage.vpower ? ' (' + M.heritage.vpower + ')' : '') : ''],
      ['Trope', M.trope ? M.trope.name : ''], ['Drive', M.drives.join(', ')], ['Role', M.role], ['Past Life', M.past_life],
      ['Action Points', 'Hold 3, use up to 6 a turn'], ['Initiative', String(M.combat.initiative)], ['Movement', M.combat.move + ' zone' + (M.combat.move === 1 ? '' : 's') + ' a turn'],
      ['BDT / LDT / ADT', b + ' / ' + b * 2 + ' / ' + b * 3], ['Mana Pool / M/T', M.mana.pool + ' / ' + M.mana.mt + (M.mana.held ? ' (' + M.mana.held + ' attuned)' : '')],
      ['Willpower / Fate / Sanity', (st.Willpower || 0) + ' / ' + (st.Fate || 0) + ' / ' + (st.Sanity || 0)], ['XP', M.xp.unspent + ' unspent of ' + M.xp.earned]];
    h.appendChild(el('h1', { class: 'cv-name', text: M.name }));
    var ul = el('dl', { class: 'cv-sheettop' });
    facts.forEach(function (f) { if (f[1]) ul.appendChild(el('div', {}, [el('dt', { text: f[0] }), el('dd', { text: f[1] })])); });
    h.appendChild(ul);
    var btns = el('div', { class: 'cv-buttons' });
    if (mine) btns.appendChild(el('a', { class: 'act primary', href: '../forge/index.html?id=' + encodeURIComponent(id), text: 'Edit in the Forge' }));
    btns.appendChild(el('a', { class: 'act', href: 'sheet.html?id=' + encodeURIComponent(id), text: 'Download Sheet' }));
    btns.appendChild(el('a', { class: 'act', href: '../ourspace/c.html?id=' + encodeURIComponent(id), text: 'OurSpace Page' }));
    if (mine) btns.appendChild(el('a', { class: 'act', href: 'index.html', text: 'My Characters' }));
    h.appendChild(btns);
  }
  function drawTabs() {
    var t = $('cv-tabs'); t.textContent = '';
    TABS.forEach(function (x) {
      t.appendChild(el('button', { type: 'button', class: 'cv-tab', role: 'tab', id: 'tab-' + x[0], 'aria-selected': String(tab === x[0]), 'aria-controls': 'cv-body',
        onclick: function () { if (pending) flush(); tab = x[0]; try { sessionStorage.setItem('cv-tab', tab); } catch (e) {} drawTabs(); drawBody(); }, text: x[1] }));
    });
  }

  // ---------- tracks: Willpower, Fate, Sanity (blank, check, X) and health (X) ----------
  function tracks() { return JSON.parse(JSON.stringify(M.tracks || {})); }
  function triRow(key, label) {
    var tr = tracks(), arr = (tr[key] || []).slice();
    var wrap = el('div', { class: 'cv-tri', role: 'group', 'aria-label': label + ' boxes' });
    for (var i = 0; i < 10; i++) (function (i) {
      var v = arr[i] || 0;
      wrap.appendChild(el('button', { type: 'button', class: 'cv-tb' + (v === 1 ? ' chk' : v === 2 ? ' x' : ''), disabled: !mine, 'aria-label': label + ' box ' + (i + 1) + ': ' + ['empty', 'checked', 'X'][v],
        text: v === 1 ? '✓' : v === 2 ? '✕' : '', onclick: function () {
          var t2 = tracks(); var a2 = (t2[key] || []).slice(); a2[i] = ((a2[i] || 0) + 1) % 3; t2[key] = a2; queue({ tracks: t2 }); drawBody();
        } }));
    })(i);
    return wrap;
  }
  var PEN = { b: [0, 0, 0, 0, 1, 2, 4], l: [0, 0, 1, 2, 4, 4, 4], a: [1, 2, 4, 4, 4] };
  function healthCard() {
    var tr = tracks(), hp = tr.health || {}, kids = [];
    var total = 0;
    [['b', 'Bashing'], ['l', 'Lethal'], ['a', 'Aggravated']].forEach(function (k) {
      var n = M.boxes[k[0]], arr = (hp[k[0]] || []).slice(), boxes = el('span', { class: 'cv-tri', role: 'group', 'aria-label': k[1] + ' damage' });
      var filled = arr.filter(Boolean).length;
      if (filled) total += PEN[k[0]][Math.min(filled, PEN[k[0]].length) - 1] || 4;
      for (var i = 0; i < n; i++) (function (i) {
        boxes.appendChild(el('button', { type: 'button', class: 'cv-tb hb ' + k[0] + (arr[i] ? ' x' : ''), disabled: !mine, 'aria-label': k[1] + ' box ' + (i + 1) + (arr[i] ? ': damaged' : ''), text: arr[i] ? '✕' : '',
          title: PEN[k[0]][i] ? '-' + PEN[k[0]][i] + ' when filled' : null, onclick: function () {
            var t2 = tracks(); t2.health = t2.health || {}; var a2 = (t2.health[k[0]] || []).slice(); a2[i] = !a2[i]; t2.health[k[0]] = a2; queue({ tracks: t2 }); drawBody();
          } }));
      })(i);
      kids.push(el('div', { class: 'cv-row' }, [el('span', { class: 'nm', text: k[1] }), boxes]));
    });
    kids.push(el('p', { class: 'cv-muted', style: 'margin:6px 0 0', text: 'Wound penalty: ' + (total ? '-' + total + ' dice' : 'none') + '. BDT ' + M.combat.bdt + ', LDT ' + M.combat.bdt * 2 + ', ADT ' + M.combat.bdt * 3 + '. Click a box to mark it with an X.' }));
    return card('Health', kids, '../rulebook/terms.html');
  }

  // ---------- tabs ----------
  var DRAW = {};
  DRAW.overview = function (b) {
    var g = el('div', { class: 'cv-grid' });
    var t = M.trope;
    g.appendChild(card('Trope', t ? [row2(t.name, t.group + ' Trope', null), el('p', { class: 'cv-muted' }, ['Boon: ' + t.boon + '. Bane: ' + t.bane + '. ', link(t.link, 'Read the Trope')])] : [el('p', { class: 'cv-muted', text: 'No Trope picked.' })]));
    var h = M.heritage;
    g.appendChild(card('Heritage', h ? [
      row2(h.name, h.rare ? 'Rare heritage' : 'Common heritage', null),
      h.innate ? row2('Innate Attribute', h.innate, null) : null,
      h.innate_flaw ? row2('Innate Flaw', h.innate_flaw, null) : null,
      h.attribute_flaw && h.attribute_flaw !== 'None' ? row2('Attribute Flaw', h.attribute_flaw + ' can never be the Affinity column', null) : null,
      h.merit ? row2('Heritage Merit', h.merit + (h.merit_text ? ': ' + h.merit_text : ''), null) : null,
      h.name === 'Vampire' ? row2('Vampiric Power', h.vpower || 'Not picked yet. Choose it in the Forge, Step 4.', null) : null,
      el('p', {}, [link(h.link, 'Read the ' + h.name + ' entry')])
    ] : [el('p', { class: 'cv-muted', text: 'No heritage picked.' })]));
    var sc = M.scales.map(function (s) {
      return row2(s.name, s.pos + (s.side ? ' (' + s.side + ')' : '') + (s.drive ? '. Drive: ' + s.drive : ''), s.high ? el('span', { class: 'cv-tag gold', text: 'High' }) : null);
    });
    g.appendChild(card('Virtues and Vices', sc, '../rulebook/ch7.html'));
    g.appendChild(card('Willpower, Fate, Sanity', M.stats.map(function (s) {
      return el('div', { class: 'cv-row', style: 'display:block' }, [el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:center' }, [link('../rulebook/ch11.html#' + slug(s.name), s.name), dots(s.dots, 10)]),
        triRow(s.name.toLowerCase(), s.name), el('small', { class: 'cv-muted', text: s.used })]);
    }).concat([el('p', { class: 'cv-muted', style: 'margin:6px 0 0', text: 'Click a box once for a check, twice for an X, a third time to clear it. A full row of checks adds a dot; a full row of X’s takes one away.' })]), '../rulebook/ch11.html'));
    g.appendChild(healthCard());
    var att = M.mana.attuned.map(function (a) { return row2(a.name + ' (' + a.school + ')', (a.effects.length ? a.effects.join(', ') : brief(a.effect)), el('span', { class: 'px', text: a.mana + ' held' })); });
    g.appendChild(card('Mana', [
      row2('Mana', 'Powers all magic', dots(M.mana.dots, 10)),
      row2('Mana Pool', 'All magic (' + M.mana.magicDots + ': Magic, Circle Magic, and every Magical Knowledge dot) x Mana', el('span', { class: 'px', text: String(M.mana.pool) })),
      row2('Max Mana per Turn', 'Fortitude + Mana' + (M.mana.arcane ? ', minus Arcane Enhancements' : '') + (M.mana.held ? ', minus ' + M.mana.held + ' attuned (' + M.mana.mtFull + ' without)' : ''), el('span', { class: 'px', text: String(M.mana.mt) }))
    ].concat(att.length ? [el('h4', { text: 'Attuned now' })].concat(att) : [el('p', { class: 'cv-muted', style: 'margin:6px 0 0', text: M.attunables.length ? 'Nothing attuned. Switch attuned spells on in the Magic tab.' : '' })]), '../rulebook/ch11.html'));
    var c = M.combat;
    g.appendChild(card('Combat', [
      row2('Action Points', 'Hold up to 3, use up to 6 in a turn. Regain 1 at Upkeep, 2 if you took damage.', el('span', { class: 'px', text: '3 / 6' })),
      row2('Initiative', 'Dexterity + Perception' + (M.mods.init ? plus(M.mods.init) + ' from gear' : ''), el('span', { class: 'px', text: String(c.initiative) })),
      row2('Movement', 'Zones per turn, from Dexterity' + (M.mods.move ? ', with gear and attuned spells' : ''), el('span', { class: 'px', text: String(c.move) })),
      row2('BDT', 'Fortitude + Resilience + Armor', el('span', { class: 'px', text: String(c.bdt) })),
      row2('LDT / ADT', 'BDT x2 / BDT x3', el('span', { class: 'px', text: (c.bdt * 2) + ' / ' + (c.bdt * 3) })),
      c.attack || c.damage || c.defense ? row2('From gear', ['Attack' + plus(c.attack), 'Damage' + plus(c.damage), 'Defense' + plus(c.defense)].join(', '), null) : null
    ], '../rulebook/terms.html'));
    g.appendChild(card('Level ' + M.level, M.levelParts.map(function (p) { return row2(p[0], null, el('span', { class: 'px', text: String(p[1]) })); }).concat([el('p', { class: 'cv-muted', text: 'Merits, Flaws, Backgrounds, Willpower, Fate, and Sanity do not count.' })]), '../rulebook/ch6.html#calculating-character-level'));
    b.appendChild(g);
  };
  DRAW.traits = function (b) {
    b.appendChild(el('h2', { class: 'px', style: 'margin-top:0', text: 'Attributes' }));
    var g = el('div', { class: 'cv-grid3' });
    M.attrs.forEach(function (c) {
      g.appendChild(card(c.col + (c.num ? ' (' + c.num + ')' : ''), [c.des ? el('p', { class: 'cv-muted', text: c.des }) : null].concat(c.list.map(function (a) {
        var bon = M.mods.attr[a.name] || 0;
        return row2(link(attrLink(a.name), a.name), [a.innate ? 'Innate Attribute' : '', bon ? plus(bon).trim() + ' from gear or magic' : ''].filter(Boolean).join('. ') || null, dots(a.dots));
      })), '../rulebook/ch6.html#attributes'));
    });
    b.appendChild(g);
    b.appendChild(el('h2', { class: 'px', text: 'Abilities' }));
    if (M.past_life) b.appendChild(el('p', { class: 'center' }, ['Past Life Occupation: ', el('strong', { text: M.past_life })]));
    var g2 = el('div', { class: 'cv-grid3' });
    var ORDER = ['Warrior', 'Troubadour', 'Mage', 'Rogue', 'Noble', 'Sage'];
    M.abilities.slice().sort(function (a, b2) { return ORDER.indexOf(a.group) - ORDER.indexOf(b2.group); }).forEach(function (gr) {
      g2.appendChild(card(gr.group + (gr.num ? ' (' + gr.num + ')' : ''), gr.list.map(function (a) {
        var name = el('span', {}, [link(abLink(a.name), a.name), a.pl ? el('span', { class: 'cv-tag', text: 'PL' }) : null]);
        var bon = M.mods.ab[a.name] || 0;
        return row2(name, [a.specs.length ? 'Specialties: ' + a.specs.join(', ') : '', bon ? plus(bon).trim() + ' from gear' : ''].filter(Boolean).join('. ') || null, dots(a.dots));
      }), '../rulebook/ch6.html#abilities-' + slug(gr.group)));
    });
    b.appendChild(g2);
  };
  // One power as a card: rank, slot, name, cost, text, rules, and an attune switch
  function powerCard(rank, title, slot, x, page) {
    if (!x) return null;
    var kids = [el('div', { class: 'cv-pc-top' }, [el('span', { class: 'cv-pc-rank', text: 'Rank ' + rank + (title ? ': ' + title : '') }), slot ? el('span', { class: 'cv-tag', text: slot }) : null]),
      el('div', { class: 'cv-pc-name', text: x.name }),
      x.use || x.cost || x.note ? el('div', { class: 'cv-pc-meta', text: [x.use, x.cost ? String(x.cost).replace(/^(\d+)/, '$1 mana') : '', x.note, x.type, x.range].filter(Boolean).join('. ') }) : null,
      el('p', { class: 'cv-pc-text', text: x.effect || x.text || '' })];
    if (x.attunable && mine) {
      var on = !!M.attunedOn[x.id];
      kids.push(el('button', { type: 'button', class: 'act small' + (on ? ' primary' : ''), 'aria-pressed': String(on), text: on ? 'Attuned (on)' : 'Attune (off)', onclick: function () {
        var a = Object.assign({}, M.attunedOn); if (on) delete a[x.id]; else a[x.id] = true; queue({ attuned: a }); drawBody();
      } }));
    } else if (x.attunable && M.attunedOn[x.id]) kids.push(el('span', { class: 'cv-tag gold', text: 'Attuned' }));
    if (x.id) kids.push(el('a', { href: '../rulebook/' + page + '.html#' + x.id, target: '_blank', rel: 'noopener', class: 'cv-pc-link', text: 'Full rules' }));
    return el('article', { class: 'cv-pc' + (x.attunable && M.attunedOn[x.id] ? ' on' : '') }, kids);
  }
  function groupHead(name, sub, dotsN, href, tag) {
    return el('div', { class: 'cv-group-head' }, [el('h2', { class: 'px', text: name }), el('div', { class: 'cv-group-sub' }, [dotsN !== null ? dots(dotsN) : null, tag ? el('span', { class: 'cv-tag gold', text: tag }) : null,
      sub ? el('span', { class: 'cv-muted', text: sub }) : null, href ? link(href, 'Read it in the book') : null])]);
  }
  DRAW.styles = function (b) {
    if (!M.styles.length) { b.appendChild(el('p', { class: 'center cv-muted', text: 'No Combat Styles yet.' })); return; }
    M.styles.forEach(function (s) {
      b.appendChild(groupHead(s.name, s.weapons + '. Primary: ' + s.primary + '. Secondary: ' + s.secondary + '.', s.dots, s.link, s.tier));
      var grid = el('div', { class: 'cv-cards' });
      s.ranks.forEach(function (r) {
        grid.appendChild(powerCard(r.rank, r.title, 'Default', r.def, 'ch12'));
        r.picks.forEach(function (p) { grid.appendChild(powerCard(r.rank, r.title, p.opt, p, 'ch12')); });
      });
      b.appendChild(grid);
    });
  };
  function knowledgeBlock(b, k) {
    b.appendChild(groupHead(k.name, k.circle ? (k.focus || 'Circle Magic discipline') : (k.kind || (k.heritage ? 'Heritage magic' : '')), k.dots, k.link, k.tier));
    if (k.circle) { b.appendChild(el('p', { class: 'cv-muted center', text: 'Circle Magic grows with every dot instead of picking spells. What you can do at ' + k.dots + ' dot' + (k.dots === 1 ? '' : 's') + ' is in its entry.' })); return; }
    if (k.single) b.appendChild(el('p', { class: 'cv-muted center', text: 'A single spell with no Option A or B. Each rank improves what it can do.' }));
    if (k.needsAdapt) b.appendChild(el('p', { class: 'cv-msg err', text: 'Hyuman Adaptation: choose where your free dot goes in the Forge (Step 4).' }));
    if (k.tribal) b.appendChild(el('div', { class: 'cv-cards' }, k.tribal.map(function (t) { return powerCard(t.rank, '', 'Tribal', { name: t.name, text: 'Written with the Storyteller.' }, 'ch8'); })));
    var grid = el('div', { class: 'cv-cards' });
    (k.ranks || []).forEach(function (r) {
      if (r.def) grid.appendChild(powerCard(r.rank, r.title, 'Default', r.def, k.page));
      r.picks.forEach(function (p) { grid.appendChild(powerCard(r.rank, r.title, p.opt || 'Spell', p, k.page)); });
      (r.combos || []).forEach(function (c) { grid.appendChild(powerCard(r.rank, r.title, 'Combination', { name: c.name + ' (' + c.schools.join(' + ') + ')', cost: c.cost, text: c.text, id: c.id }, 'ch13')); });
    });
    if (grid.children.length) b.appendChild(grid);
    else if (k.dots && !k.tribal) b.appendChild(el('p', { class: 'cv-muted center' }, ['No spells picked for these dots yet. ', mine ? el('a', { href: '../forge/index.html?id=' + encodeURIComponent(id), text: 'Pick them in the Forge' }) : null]));
  }
  DRAW.magic = function (b) {
    b.appendChild(el('p', { class: 'cv-msg', id: 'cv-msg', role: 'alert' }));
    if (!M.knowledges.length && !M.vpowers) { b.appendChild(el('p', { class: 'center cv-muted', text: 'No Magical Knowledges yet.' })); return; }
    M.knowledges.forEach(function (k) {
      if (k.vampire || k.needsPower) {
        b.appendChild(groupHead('Vampiric Powers', 'Heritage magic. A born vampire gets one free dot in one power; the others are bought with XP and raised on their own.', null, k.link, 'Primary'));
        if (k.needsPower) b.appendChild(el('p', { class: 'cv-msg err' }, ['No Vampiric Power picked yet. ', mine ? el('a', { href: '../forge/index.html?id=' + encodeURIComponent(id), text: 'Pick it in the Forge (Step 4)' }) : null, '.']));
        (M.vpowers || []).forEach(function (vp) {
          if (!vp.dots) {
            b.appendChild(el('div', { class: 'cv-vp-off' }, [el('strong', { text: vp.name }), el('span', { class: 'cv-muted', text: ' Not learned yet. Buy it on the Experience tab (new dot x5).' }), ' ', link(vp.link, 'Rules')]));
            return;
          }
          var sub = Object.assign({}, vp, { kind: vp.main ? 'Your free Vampiric Power' : 'Bought with XP' });
          knowledgeBlock(b, sub);
        });
        return;
      }
      knowledgeBlock(b, k);
    });
  };
  DRAW.merits = function (b) {
    var g = el('div', { class: 'cv-grid' });
    function mf(x) {
      var sub = [x.option ? x.option.name : '', x.note].filter(Boolean).join('. ');
      var n = Number(x.value);
      return el('div', { class: 'cv-mf' }, [row2(link(x.link, x.name), sub || null, isFinite(n) && n > 0 && n <= 10 ? dots(n, Math.max(n, 3)) : null),
        el('p', { class: 'cv-muted', style: 'font-size:14px;margin:2px 0 6px', text: brief((x.option && x.option.text) || x.text || '') })]);
    }
    g.appendChild(card('Merits', M.merits.length ? M.merits.map(mf) : [el('p', { class: 'cv-muted', text: 'No Merits.' })], '../rulebook/ch9.html'));
    g.appendChild(card('Flaws', M.flaws.length ? M.flaws.map(mf) : [el('p', { class: 'cv-muted', text: 'No Flaws.' })], '../rulebook/ch9.html'));
    var bgs = M.backgrounds.slice().sort(function (a, b2) { return (a.name === 'Resources' ? -1 : 0) - (b2.name === 'Resources' ? -1 : 0); });
    if (!bgs.some(function (x) { return x.name === 'Resources'; })) bgs.unshift({ name: 'Resources', dots: 0, link: '../rulebook/ch10.html', what: 'Your lifestyle and income.' });
    var bgKids = [];
    bgs.forEach(function (x) {
      bgKids.push(row2(link(x.link, x.name), x.who ? x.who : x.what, dots(x.dots)));
      if (x.name === 'Resources') bgKids.push(moneyBox());
    });
    g.appendChild(card('Backgrounds', bgKids, '../rulebook/ch10.html'));
    g.appendChild(card('Guilds', M.guilds.length ? M.guilds.map(function (x) { return row2(x.name, null, dots(x.dots || 0)); }) : [el('p', { class: 'cv-muted', text: 'No guilds.' })], '../rulebook/ch10.html#guild-standing'));
    b.appendChild(g);
  };
  DRAW.companions = function (b) {
    if (!M.companions.length) { b.appendChild(el('p', { class: 'center cv-muted', text: 'No familiar or SumMonz yet. Familiar Bond (Chapter 9) gives a familiar, and Summoning Magic (Chapter 13) gives a first SumMonz.' })); return; }
    var g = el('div', { class: 'cv-grid' });
    M.companions.forEach(function (c) {
      var f = c.c || {}, forms = Object.keys(f.forms || {}).sort().map(function (k) { return row2(['First', 'Second', 'Third', 'Fourth'][k - 1] + ' Form', f.forms[k], null); });
      g.appendChild(card(f.name || c.kind, [row2(c.kind, c.text, null)].concat(forms).concat([
        el('p', { class: 'cv-muted', text: c.kind === 'Familiar' ? 'Add your Familiar Bond dots to its Attack and Defense pools. It does not count toward your SumMonz on the field.' : 'Rank F to start. On the field: 1 at 1 to 2 Summoning dots, 2 at 3 to 4, 3 at 5 to 6, 4 at 7.' }),
        link(c.kind === 'Familiar' ? '../rulebook/ch9.html' : '../rulebook/ch13.html#the-disciplines-of-circle-magic-summoning-magic', 'Rules')])));
    });
    b.appendChild(g);
  };

  // ---------- money on hand ----------
  function coins() { return window.TerranaCoins || []; }
  function moneyLine(m) { m = m || {}; return coins().filter(function (c) { return (m[c[0]] || 0) > 0; }).map(function (c) { return m[c[0]] + ' ' + c[1]; }).join(', ') || 'nothing'; }
  function moneyBox() {
    var money = Object.assign({}, M.money || {});
    var wrap = el('div', { class: 'cv-money' });
    var tot = el('p', { class: 'cv-muted', style: 'margin:6px 0' });
    function total() {
      var usd = coins().reduce(function (s2, c) { return s2 + (money[c[0]] || 0) * c[2]; }, 0);
      tot.textContent = 'Money on hand' + (M.moneyStart ? ' (Starting Funds for your Resources)' : '') + '. Worth about $' + usd.toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' by the book’s guide. Changes save on their own.';
    }
    coins().forEach(function (c) {
      var inp = el('input', { type: 'number', min: '0', step: '1', value: String(money[c[0]] || 0), 'aria-label': c[1], disabled: !mine });
      function setv(v) { money[c[0]] = Math.max(0, Math.floor(+v || 0)); inp.value = String(money[c[0]]); total(); queue({ money: Object.assign({}, money) }); }
      inp.addEventListener('input', function () { setv(inp.value); });
      wrap.appendChild(el('div', { class: 'cv-coin' }, [el('span', { text: c[1] }), el('span', { class: 'cv-stepper' }, [
        mine ? el('button', { type: 'button', text: '-', 'aria-label': 'One less ' + c[1], onclick: function () { setv((money[c[0]] || 0) - 1); } }) : null, inp,
        mine ? el('button', { type: 'button', text: '+', 'aria-label': 'One more ' + c[1], onclick: function () { setv((money[c[0]] || 0) + 1); } }) : null])]));
    });
    total();
    return el('div', {}, [tot, wrap]);
  }

  // ---------- equipment and notes ----------
  var SLOTS = [['headgear', 'Headgear'], ['torso', 'Torso'], ['left_arm', 'Left Arm'], ['right_arm', 'Right Arm'], ['legs', 'Legs'], ['footwear', 'Footwear'], ['main_weapon', 'Main Weapon'], ['side_arm', 'Side Arm'], ['alt_weapons', 'Alt Weapons']];
  var NOTES = [['quests', 'Quests'], ['npcs', 'People'], ['locations', 'Places'], ['lore', 'Lore'], ['leads', 'Leads'], ['general', 'Other Notes']];
  var CATS = ['', 'Armor', 'Attack', 'Damage', 'Defense', 'Initiative', 'Movement', 'Mana Pool', 'Max Mana per Turn', 'Attribute', 'Ability', 'Combat Style', 'Magic', 'Other'];
  // Belt items from Chapter 14 (Potions and Mana Crystals), plus the other things that ride on a belt
  var BELT = [
    ['', 'Empty', ''], ['Minor healing potion', 'Potion', 'PHP 3, Basic healing. Rating 1.'], ['Healing potion', 'Potion', 'PHP 3, Advanced healing. Rating 3.'], ['Greater healing potion', 'Potion', 'PHP 3, Expert healing. Rating 5.'],
    ['Antidote', 'Potion', 'Ends the Poisoned condition. Rating 2.'], ['Small Mana Crystal', 'Mana crystal', 'Recover 1 mana.'], ['Mana Crystal', 'Mana crystal', 'Recover 2 mana.'], ['Large Mana Crystal', 'Mana crystal', 'Recover 4 mana.'],
    ['Huge Mana Crystal', 'Mana crystal', 'Recover 8 mana.'], ['Spell scroll', 'Scroll', 'Release it for the spell’s mana cost; the successes were locked in when it was made (Chapter 13, Scroll Magic).'],
    ['SumMonz card', 'Card', 'Summon its SumMonz for mana equal to its rank (Chapter 13).'], ['Thrown weapon', 'Weapon', 'Thrown at a target; rating adds to damage (Chapter 14).'],
    ['Poison', 'Poison', 'Applies Poisoned at the rating the Storyteller sets.'], ['Other', 'Other', '']];
  function gearCopy() {
    var g0 = M.gear || {}, worn = {};
    Object.keys(g0.worn || {}).forEach(function (k) { var v = g0.worn[k]; worn[k] = typeof v === 'string' ? { name: v } : Object.assign({}, v); });
    return { worn: worn, belt: (g0.belt || []).map(function (x) { return typeof x === 'string' ? (x ? { type: 'Other', name: x } : null) : x && Object.assign({}, x); }),
      carried: (g0.carried || []).map(function (x) { return Object.assign({}, x); }), stash: (g0.stash || []).map(function (x) { return Object.assign({}, x); }), notes: Object.assign({}, g0.notes || {}) };
  }
  function gearChanges(a, b) {
    var out = [];
    function nm(v) { return !v ? '' : typeof v === 'string' ? v : [v.name, Number(v.bonus) ? plus(Number(v.bonus)).trim() + ' ' + (v.which || v.cat || '') : ''].filter(Boolean).join(' ').trim(); }
    SLOTS.forEach(function (s2) { var x = nm((a.worn || {})[s2[0]]), y = nm((b.worn || {})[s2[0]]); if (x !== y) out.push(s2[1] + ': ' + (y || 'empty') + (x ? ' (was ' + x + ')' : '')); });
    function bn(v) { return !v ? '' : typeof v === 'string' ? v : (v.name || v.type || ''); }
    for (var i = 0; i < 7; i++) { var x = bn((a.belt || [])[i]), y = bn((b.belt || [])[i]); if (x !== y) out.push('Belt ' + (i + 1) + ': ' + (y || 'empty')); }
    [['carried', 'Carried'], ['stash', 'Stash']].forEach(function (k) {
      function m(list) { var o = {}; (list || []).forEach(function (it) { if (it && it.name) o[it.name] = (o[it.name] || 0) + (it.qty || 1); }); return o; }
      var A0 = m(a[k[0]]), B0 = m(b[k[0]]);
      Object.keys(B0).forEach(function (n) { if (!(n in A0)) out.push(k[1] + ': added ' + (B0[n] > 1 ? B0[n] + ' ' : '') + n); else if (A0[n] !== B0[n]) out.push(k[1] + ': ' + n + ' ' + A0[n] + ' to ' + B0[n]); });
      Object.keys(A0).forEach(function (n) { if (!(n in B0)) out.push(k[1] + ': removed ' + n); });
    });
    return out;
  }
  var gear = null;
  function changed() { queue({ gear: JSON.parse(JSON.stringify(gear)) }); }
  function itemList(key, title, hint) {
    var listEl = el('div', { class: 'cv-items' });
    function draw() {
      listEl.textContent = '';
      (gear[key] || []).forEach(function (it, i) {
        var nm = el('input', { value: it.name || '', maxlength: '80', placeholder: 'Item', 'aria-label': title + ' item ' + (i + 1), disabled: !mine });
        var q = el('input', { type: 'number', min: '1', step: '1', value: String(it.qty || 1), 'aria-label': 'How many', disabled: !mine, style: 'width:70px' });
        nm.addEventListener('input', function () { it.name = nm.value; changed(); });
        q.addEventListener('input', function () { it.qty = Math.max(1, +q.value || 1); changed(); });
        listEl.appendChild(el('div', { class: 'cv-item' }, [nm, q, mine ? el('button', { class: 'act small', type: 'button', text: 'Remove', onclick: function () { gear[key].splice(i, 1); changed(); draw(); } }) : null]));
      });
      if (!(gear[key] || []).length) listEl.appendChild(el('p', { class: 'cv-muted', text: 'Nothing here.' }));
    }
    draw();
    return card(title, [el('p', { class: 'cv-muted', text: hint }), listEl,
      mine ? el('button', { class: 'act small', type: 'button', text: 'Add Item', onclick: function () { gear[key] = gear[key] || []; gear[key].push({ name: '', qty: 1 }); draw(); var ins = listEl.querySelectorAll('input:not([type=number])'); if (ins.length) ins[ins.length - 1].focus(); } }) : null]);
  }
  function whichOptions(cat) {
    var L = M.lists || {};
    return cat === 'Attribute' ? L.attrs : cat === 'Ability' ? L.abilities : cat === 'Combat Style' ? L.styles : cat === 'Magic' ? L.magics : null;
  }
  DRAW.gear = function (b) {
    gear = gearCopy();
    b.appendChild(el('p', { class: 'cv-muted center', text: mine ? 'Everything here saves on its own a moment after you stop typing.' : '' }));
    // Worn and wielded: item, bonus, what it improves, which one, notes
    var wt = el('div', { class: 'cv-worn' }, [el('div', { class: 'cv-worn-h' }, ['Slot', 'Item', 'Bonus', 'Improves', 'Which', 'Notes'].map(function (t) { return el('span', { text: t }); }))]);
    SLOTS.forEach(function (s2) {
      var it = gear.worn[s2[0]] = gear.worn[s2[0]] || {};
      var nm = el('input', { value: it.name || '', maxlength: '80', placeholder: 'Nothing', disabled: !mine, 'aria-label': s2[1] + ' item' });
      var bonus = el('input', { type: 'number', step: '1', min: '-10', max: '10', value: it.bonus ? String(it.bonus) : '', placeholder: '+0', disabled: !mine, 'aria-label': s2[1] + ' bonus' });
      var cat = el('select', { disabled: !mine, 'aria-label': s2[1] + ' improves' });
      CATS.forEach(function (c) { var o = el('option', { value: c, text: c || 'Nothing' }); if ((it.cat || '') === c) o.selected = true; cat.appendChild(o); });
      var whichWrap = el('span', {});
      function drawWhich() {
        whichWrap.textContent = '';
        var opts = whichOptions(cat.value);
        var w;
        if (opts) { w = el('select', { disabled: !mine, 'aria-label': s2[1] + ' which' }, [el('option', { value: '', text: 'Choose...' })]); opts.forEach(function (o) { var op = el('option', { value: o, text: o }); if (it.which === o) op.selected = true; w.appendChild(op); }); }
        else w = el('input', { value: it.which || '', maxlength: '60', placeholder: cat.value === 'Other' ? 'What it affects' : '', disabled: !mine || !cat.value || cat.value !== 'Other', 'aria-label': s2[1] + ' which' });
        w.addEventListener('change', function () { it.which = w.value; changed(); });
        w.addEventListener('input', function () { it.which = w.value; changed(); });
        whichWrap.appendChild(w);
      }
      drawWhich();
      var note = el('input', { value: it.notes || '', maxlength: '120', placeholder: 'Rating, quirks', disabled: !mine, 'aria-label': s2[1] + ' notes' });
      nm.addEventListener('input', function () { it.name = nm.value; changed(); });
      bonus.addEventListener('input', function () { it.bonus = Number(bonus.value) || 0; changed(); });
      cat.addEventListener('change', function () { it.cat = cat.value; it.which = ''; drawWhich(); changed(); });
      note.addEventListener('input', function () { it.notes = note.value; changed(); });
      wt.appendChild(el('div', { class: 'cv-worn-r' }, [el('span', { class: 'cv-worn-slot', text: s2[1] }), nm, bonus, cat, whichWrap, note]));
    });
    b.appendChild(card('Worn and Wielded', [el('p', { class: 'cv-muted', text: 'Gloves, bracers, and rings go on the arm they are worn on. Carry at most 3 weapons and wield 2. Armor bonuses add to your BDT; attribute, ability, initiative, movement, and mana bonuses show up on the other tabs.' }), wt], '../rulebook/ch14.html'));
    // Belt
    var belt = el('div', { class: 'cv-belt' });
    for (var i = 0; i < 7; i++) (function (i) {
      var it = gear.belt[i] || null;
      var sel = el('select', { disabled: !mine, 'aria-label': 'Belt ' + (i + 1) });
      BELT.forEach(function (x) { var o = el('option', { value: x[0], text: x[0] || (i < 3 ? 'Empty' : 'Empty (needs an item or ability)') }); if (it && it.type === x[0]) o.selected = true; sel.appendChild(o); });
      var detail = el('input', { value: (it && it.detail) || '', maxlength: '80', disabled: !mine || !it, 'aria-label': 'Belt ' + (i + 1) + ' details' });
      var info = el('div', { class: 'cv-muted cv-belt-info' });
      function fill() {
        var x = BELT.filter(function (y) { return y[0] === sel.value; })[0] || BELT[0];
        info.textContent = x[2];
        detail.disabled = !mine || !sel.value;
        detail.placeholder = sel.value === 'Spell scroll' ? 'Which spell, and its successes' : sel.value === 'SumMonz card' ? 'Which SumMonz' : sel.value === 'Poison' ? 'Name and rating' : sel.value === 'Thrown weapon' ? 'Weapon and rating' : sel.value === 'Other' ? 'What is it?' : 'Notes';
      }
      sel.addEventListener('change', function () {
        if (!sel.value) gear.belt[i] = null; else gear.belt[i] = { type: sel.value, name: sel.value === 'Other' ? (detail.value || 'Item') : sel.value, detail: detail.value };
        fill(); changed();
      });
      detail.addEventListener('input', function () { if (gear.belt[i]) { gear.belt[i].detail = detail.value; if (gear.belt[i].type === 'Other') gear.belt[i].name = detail.value || 'Item'; changed(); } });
      fill();
      belt.appendChild(el('div', { class: 'cv-belt-r' + (i >= 3 ? ' extra' : '') }, [el('label', { text: 'Belt ' + (i + 1) + (i === 0 ? ' (free)' : i === 1 ? ' (1 AP)' : i === 2 ? ' (2 AP)' : ' (extra slot)') }), sel, detail, info]));
    })(i);
    b.appendChild(el('div', { style: 'height:14px' }));
    b.appendChild(card('Belt', [el('p', { class: 'cv-muted', text: 'Set before combat. The first item you use in a turn is free, the second costs 1 AP, the third 2 more. Slots 4 to 7 only open when an item or ability grants them.' }), belt], '../rulebook/ch14.html'));
    var g2 = el('div', { class: 'cv-grid' });
    g2.appendChild(itemList('carried', 'Carried', 'In your pack and pockets.'));
    g2.appendChild(itemList('stash', 'Stash', 'Things you own but are not carrying: at home, in storage, on a ranch.'));
    b.appendChild(el('div', { style: 'height:14px' }));
    b.appendChild(g2);
    var notes = NOTES.map(function (n) {
      var ta = el('textarea', { rows: '4', maxlength: '4000', disabled: !mine, 'aria-label': n[1] });
      ta.value = gear.notes[n[0]] || '';
      ta.addEventListener('input', function () { gear.notes[n[0]] = ta.value; changed(); });
      return el('div', { class: 'cv-slot' }, [el('label', { text: n[1] }), ta]);
    });
    b.appendChild(el('div', { style: 'height:14px' }));
    b.appendChild(card('Campaign Notes', notes));
    b.appendChild(el('div', { style: 'height:14px' }));
    b.appendChild(historyCard());
  };
  function historyCard() {
    var hist = el('ul', { class: 'cv-log' });
    var buys = M.xp.buys.slice().reverse(), logs = M.xp.log.slice().reverse();
    var other = ((row.sheet && row.sheet.history) || []).slice().reverse();
    var all = [];
    buys.forEach(function (x, i) { all.push({ d: x.d, li: el('li', {}, [el('span', { text: when(x.d) + ': spent ' + x.cost + ' XP on ' + x.label }),
      mine && i === 0 ? el('button', { class: 'act small', type: 'button', text: 'Undo', onclick: function () { if (confirm('Undo this purchase and get ' + x.cost + ' XP back?')) act(function () { return window.TerranaCharacter.undo(x.id); }, 'Purchase undone.'); } }) : null]) }); });
    logs.forEach(function (x) { all.push({ d: x.d, li: el('li', {}, [el('span', { text: when(x.d) + ': earned ' + x.amt + ' XP' + (x.note ? ' (' + x.note + ')' : '') }),
      mine ? el('button', { class: 'act small', type: 'button', text: 'Remove', onclick: function () { if (confirm('Remove this XP entry?')) act(function () { return window.TerranaCharacter.removeAward(x.id); }, 'XP entry removed.'); } }) : null]) }); });
    other.forEach(function (x) { all.push({ d: x.d, li: el('li', {}, [el('span', { text: when(x.d) + ': ' + x.text })]) }); });
    all.sort(function (a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : 0; }).forEach(function (x) { hist.appendChild(x.li); });
    return card('History', hist.children.length ? [hist] : [el('p', { class: 'cv-muted', text: 'Nothing yet. XP, purchases, money, equipment, and attunement changes show up here.' })]);
  }

  // ---------- Experience ----------
  async function act(fn, ok) {
    try { var m = fn(); await persist(m); drawBody(); say(ok); toast('Saved'); }
    catch (e) {
      M = window.TerranaCharacter.load(data, row, { username: M.player, is_admin: me && me.is_admin });
      drawHead(); drawBody(); say(A.friendly(e), true);
    }
  }
  function pickDialog(o, done) {
    var rk = o.ranks[o.next - 1];
    var d = el('dialog', { class: 'win dialog', 'aria-labelledby': 'pk-t' });
    var opts = el('div', { class: 'cv-opts' });
    var list = o.kind === 'style' ? [['a', 'Option A', rk.a], ['b', 'Option B', rk.b]] : rk.spells.map(function (s, i) { return [String(i), s.opt ? 'Option ' + s.opt : 'Spell', s]; });
    if (o.kind === 'know') (window.TerranaCharacter.combosFor(o.name, o.next) || []).forEach(function (c) { list.push(['c:' + c.id, 'Combination spell, free with this dot', { name: c.name + ' (' + c.schools.join(' + ') + ')', text: c.text }]); });
    list.forEach(function (x, i) {
      var inp = el('input', { type: 'radio', name: 'pk', value: x[0], id: 'pk-' + i });
      opts.appendChild(el('label', { for: 'pk-' + i }, [inp, el('span', {}, [el('b', { text: x[2].name }), ' (' + x[1] + (x[2].use ? ', ' + x[2].use : '') + ')', el('small', { text: x[2].text || '' })])]));
    });
    if (rk.default) opts.insertBefore(el('p', { class: 'cv-muted' }, ['You also gain the Default: ', el('b', { text: rk.default.name })]), opts.firstChild);
    d.appendChild(el('div', { class: 'form' }, [el('h2', { id: 'pk-t', class: 'px', text: o.label + ': Rank ' + o.next + ' (' + rk.title + ')' }),
      el('p', { text: 'This dot costs ' + o.cost + ' XP. Choose what you learn with it.' }), opts,
      el('div', { class: 'button-row' }, [el('button', { class: 'act', type: 'button', text: 'Cancel', onclick: function () { d.close(); d.remove(); } }),
        el('button', { class: 'act primary', type: 'button', text: 'Buy It', onclick: function () {
          var c = d.querySelector('input[name=pk]:checked');
          if (!c) { alert('Choose one first.'); return; }
          d.close(); d.remove(); done(c.value);
        } })])]));
    document.body.appendChild(d);
    d.showModal();
  }
  function buy(o) {
    var C = window.TerranaCharacter;
    if (o.needsText) {
      var t = prompt('Name the new ' + o.name + ' specialty (5 XP). Ideas: ' + (o.suggestions || []).join(', '));
      if (t === null) return;
      return act(function () { return C.buy(o, { text: t }); }, 'Bought the specialty for 5 XP.');
    }
    if (o.ranks && o.ranks[o.next - 1]) return pickDialog(o, function (pick) { act(function () { return C.buy(o, { pick: pick }); }, 'Bought ' + o.label + ' ' + o.next + ' for ' + o.cost + ' XP.'); });
    if (!confirm('Spend ' + o.cost + ' XP on ' + o.label + (o.next ? ' (to ' + o.next + ')' : '') + '?')) return;
    act(function () { return C.buy(o, {}); }, 'Bought ' + o.label + ' for ' + o.cost + ' XP.');
  }
  DRAW.xp = function (b) {
    var C = window.TerranaCharacter;
    b.appendChild(el('p', { class: 'cv-msg', id: 'cv-msg', role: 'alert' }));
    b.appendChild(el('div', { class: 'cv-xp-top' }, [['Earned', M.xp.earned], ['Spent', M.xp.spent], ['Unspent', M.xp.unspent]].map(function (x) {
      return el('div', { class: 'cv-card cv-stat' }, [el('span', { class: 'big', text: String(x[1]) }), x[0] + ' XP']);
    })));
    if (mine) {
      var aff = (row.sheet && row.sheet.build && row.sheet.build.attr_cols) || {};
      var affCol = Object.keys(aff).filter(function (k) { return aff[k] === 'Affinity'; })[0];
      var BON = { Physical: 'took part in combat or made a big physical gesture', Mental: 'used magic, or made a profound discovery or had a profound idea', Social: 'took part at all (automatic)' };
      var checks = el('div', { class: 'cv-checks' }, [
        el('label', {}, [el('input', { type: 'checkbox', id: 'xc-free', checked: true, disabled: true }), '1 XP: you were there (free every chapter)']),
        el('label', {}, [el('input', { type: 'checkbox', id: 'xc-act' }), '1 XP: you acted (played your character)']),
        el('label', {}, [el('input', { type: 'checkbox', id: 'xc-q' }), '1 XP: answered the Storyteller’s question or shared what you learned']),
        el('label', {}, [el('input', { type: 'checkbox', id: 'xc-aff', checked: affCol === 'Social' }), '1 XP Affinity bonus' + (affCol ? ' (' + affCol + ': ' + BON[affCol] + ')' : '')]),
        affCol === 'Social' ? el('label', {}, [el('input', { type: 'checkbox', id: 'xc-table' }), '1 more XP: everyone at the table earned a bonus (Social Affinity)']) : null
      ]);
      var note = el('input', { id: 'xp-note', maxlength: '200', placeholder: 'Chapter or session (optional)' });
      var amt = el('input', { id: 'xp-amt', type: 'number', min: '-100', max: '200', step: '1', placeholder: 'Or type any amount' });
      var f = el('form', { class: 'cv-form' }, [checks, el('div', { class: 'cv-inline' }, [el('div', {}, [el('label', { for: 'xp-note', text: 'Note' }), note]), el('div', {}, [el('label', { for: 'xp-amt', text: 'Other amount' }), amt])]),
        el('div', {}, [el('button', { class: 'act primary', type: 'submit', text: 'Add XP' })]),
        el('p', { class: 'cv-muted', text: 'XP is awarded by your Storyteller at the end of each story chapter. Record it here.' })]);
      f.addEventListener('submit', function (ev) {
        ev.preventDefault();
        var n = amt.value !== '' ? Number(amt.value) : 1 + ['xc-act', 'xc-q', 'xc-aff', 'xc-table'].reduce(function (s, k) { return s + ($(k) && $(k).checked ? 1 : 0); }, 0);
        act(function () { return C.award(n, note.value); }, 'Added ' + n + ' XP.');
      });
      b.appendChild(card('Add XP', [f], '../rulebook/ch6.html#earning-and-spending-xp-earning-xp'));
      var groups = {};
      M.offers.forEach(function (o) { (groups[o.group] = groups[o.group] || []).push(o); });
      var order = ['Attributes', 'Abilities', 'Specialties', 'Combat Styles', 'Magical Knowledges', 'Mana', 'Options You Did Not Pick', 'Combination Spells'];
      var spend = [el('p', { class: 'cv-muted', text: 'Costs follow the Chapter 6 table: the new dot times the listed number. Past Life (PL) abilities cost new dot x2. Raising a Style or school past a rank asks which option you learn.' })];
      order.forEach(function (gname) {
        var list = groups[gname]; if (!list || !list.length) return;
        var det = el('details', { class: 'cv-more' }, [el('summary', { text: gname + ' (' + list.length + ')' })]);
        list.forEach(function (o) {
          var lab = o.next && o.kind !== 'spec' ? o.label + ': ' + o.cur + ' to ' + o.next + (o.tier === 'S' && o.cur === 0 ? ' (new, Secondary)' : '') : o.label;
          det.appendChild(el('div', { class: 'cv-buy' }, [el('span', { class: 'nm', text: lab }),
            el('button', { class: 'act small' + (o.ok ? ' primary' : ''), type: 'button', disabled: !o.ok && !M.st ? true : null, text: o.cost + ' XP', onclick: function () { buy(o); } })]));
        });
        spend.push(det);
      });
      b.appendChild(card('Spend XP (' + M.xp.unspent + ' unspent)', spend, '../rulebook/ch6.html#earning-and-spending-xp'));
    }
    b.appendChild(el('p', { class: 'cv-muted center', text: 'Every XP entry and purchase is listed under History on the Equipment and Notes tab, where the most recent purchase can be undone.' }));
  };
  function drawBody() {
    var b = $('cv-body'); b.textContent = '';
    b.setAttribute('aria-labelledby', 'tab-' + tab);
    DRAW[tab](b);
  }

  // ---------- start ----------
  function loadScript(src) { return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.body.appendChild(s); }); }
  async function start() {
    if (!id) { $('cv-loading').textContent = 'No character picked. Open one from My Characters.'; return; }
    me = await A.currentPlayer();
    var res = await db.from('characters').select('id, name, owner, sheet').eq('id', id).maybeSingle();
    if (res.error) throw res.error;
    if (!res.data) { $('cv-loading').textContent = 'This character is private, or does not exist. Log in to see your own characters.'; return; }
    row = res.data;
    mine = !!me && me.id === row.owner;
    if (!row.sheet || !row.sheet.build) { $('cv-loading').textContent = 'This character has not been made in the Forge yet.'; return; }
    window.FORGE_HEADLESS = true;
    await loadScript('../assets/forge.js');
    data = await fetch('../forge/data.json').then(function (r) { return r.json(); });
    var owner = mine ? me : (await db.from('profiles').select('username').eq('id', row.owner).maybeSingle()).data || {};
    M = window.TerranaCharacter.load(data, row, { username: owner.username || '', is_admin: !!(me && me.is_admin) });
    document.title = M.name + ' | Jimothy’s D10 Isekai JRPG';
    $('cv-loading').hidden = true;
    $('cv-main').hidden = false;
    drawHead(); drawTabs(); drawBody();
  }
  start().catch(function (e) { $('cv-loading').textContent = 'Could not load this character. ' + A.friendly(e); });
})();
