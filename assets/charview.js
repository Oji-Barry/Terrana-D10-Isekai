/* The website character page: characters/view.html?id=...
   Draws a Forge character in the site's style, in tabs, with links into the
   rulebook, and lets the owner record and spend XP. Uses assets/forge.js in
   headless mode for every number, so the page and the Forge never disagree. */

(function () {
  var A = window.Terrana.auth, db = A.client;
  var $ = function (id) { return document.getElementById(id); };
  var id = new URLSearchParams(location.search).get('id');
  var row = null, data = null, me = null, M = null, mine = false, tab = 'overview';
  var TABS = [['overview', 'Overview'], ['traits', 'Attributes and Abilities'], ['styles', 'Combat Styles'], ['magic', 'Magic'],
    ['merits', 'Merits and Backgrounds'], ['companions', 'Companions'], ['xp', 'Experience']];
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
  function link(href, text) { return href ? el('a', { href: href, text: text || 'Rules' }) : el('span', { text: text || '' }); }
  function book(href) { return href ? el('a', { href: href, class: 'cv-book', text: 'In the book', 'aria-label': 'Read this in the rulebook' }) : null; }
  function dots(n, max) {
    max = Math.max(max || 7, n);
    var d = el('span', { class: 'cv-dots', role: 'img', 'aria-label': n + ' dot' + (n === 1 ? '' : 's') });
    for (var i = 0; i < max; i++) d.appendChild(el('span', { class: 'cv-dot' + (i < n ? ' on' : '') }));
    return d;
  }
  function card(title, kids, href) {
    return el('section', { class: 'cv-card' }, [el('h3', { class: 'px' }, [title, href ? ' ' : null, href ? el('a', { href: href, style: 'font-family:var(--body);font-size:13px', text: 'Rules' }) : null])].concat(kids));
  }
  function row2(name, sub, right) { return el('div', { class: 'cv-row' }, [el('span', { class: 'nm' }, [name, sub ? el('small', { text: sub }) : null]), right]); }
  function say(t, bad) { var m = $('cv-msg'); if (!m) return; m.textContent = t || ''; m.classList.toggle('err', !!bad); }
  function when(iso) { try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return ''; } }
  var PHYS = { Strength: 1, Dexterity: 1, Fortitude: 1 };
  function attrLink(a) { return '../rulebook/ch6.html#' + (PHYS[a] ? 'attributes-' + slug(a) : 'attributes'); }
  function abLink(a) { return '../rulebook/ch6.html#quick-reference-' + slug(a); }

  // ---------- header ----------
  function drawHead() {
    var h = $('cv-head'); h.textContent = '';
    var facts = [['Level', String(M.level)], ['Heritage', M.heritage ? M.heritage.name : ''], ['Trope', M.trope ? M.trope.name : ''], ['Role', M.role], ['Player', M.player]];
    h.appendChild(el('h1', { class: 'cv-name', text: M.name }));
    var ul = el('ul', { class: 'cv-facts' });
    facts.forEach(function (f) { if (f[1]) ul.appendChild(el('li', {}, [el('b', { text: f[0] + ':' }), f[1]])); });
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
        onclick: function () { tab = x[0]; try { sessionStorage.setItem('cv-tab', tab); } catch (e) {} drawTabs(); drawBody(); }, text: x[1] }));
    });
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
      h.merit ? row2('Heritage Merit', h.merit, null) : null,
      el('p', {}, [link(h.link, 'Read the ' + h.name + ' entry')])
    ] : [el('p', { class: 'cv-muted', text: 'No heritage picked.' })]));
    g.appendChild(card('Role', [el('p', { text: M.role || 'No Role picked.' }), el('p', { class: 'cv-muted', text: 'Your Role sets where you start when combat begins. It can change in play.' })], '../rulebook/ch6.html#the-creation-process'));
    var sc = M.scales.map(function (s) {
      return row2(s.name, s.pos + (s.side ? ' (' + s.side + ')' : '') + (s.drive ? '. Drive: ' + s.drive : ''), s.high ? el('span', { class: 'cv-tag gold', text: 'High' }) : null);
    });
    g.appendChild(card('Virtues and Vices', sc, '../rulebook/ch7.html'));
    g.appendChild(card('Willpower, Fate, Sanity', M.stats.map(function (s) { return el('div', { class: 'cv-row', style: 'display:block' }, [el('div', { style: 'display:flex;justify-content:space-between;gap:8px;align-items:center' }, [link('../rulebook/ch11.html#' + slug(s.name), s.name), dots(s.dots, 10)]), el('small', { class: 'cv-muted', text: s.used })]); })));
    g.appendChild(card('Mana', [
      row2('Mana', 'Powers all magic', dots(M.mana.dots, 10)),
      row2('Mana Pool', '(Magic + Circle Magic) x Mana', el('span', { class: 'px', text: String(M.mana.pool) })),
      row2('Max Mana per Turn', 'Fortitude + Mana', el('span', { class: 'px', text: String(M.mana.mt) }))
    ], '../rulebook/ch11.html'));
    g.appendChild(card('Combat', [
      row2('Initiative', 'Dexterity + Perception', el('span', { class: 'px', text: String(M.combat.initiative) })),
      row2('Movement', 'Zones per turn, from Dexterity', el('span', { class: 'px', text: String(M.combat.move) })),
      row2('BDT', 'Fortitude, plus armor and Resilience', el('span', { class: 'px', text: String(M.combat.bdt) })),
      row2('LDT / ADT', 'BDT x2 / BDT x3, before armor', el('span', { class: 'px', text: (M.combat.bdt * 2) + ' / ' + (M.combat.bdt * 3) }))
    ], '../rulebook/terms.html'));
    g.appendChild(card('Level ' + M.level, M.levelParts.map(function (p) { return row2(p[0], null, el('span', { class: 'px', text: String(p[1]) })); }).concat([el('p', { class: 'cv-muted', text: 'Merits, Flaws, Backgrounds, Willpower, Fate, and Sanity do not count.' })]), '../rulebook/ch6.html#calculating-character-level'));
    b.appendChild(g);
  };
  DRAW.traits = function (b) {
    var g = el('div', { class: 'cv-grid' });
    M.attrs.forEach(function (c) {
      g.appendChild(card(c.col + (c.num ? ' (' + c.num + ')' : ''), [c.des ? el('p', { class: 'cv-muted', text: c.des }) : null].concat(c.list.map(function (a) {
        return row2(link(attrLink(a.name), a.name), a.innate ? 'Innate Attribute' : null, dots(a.dots));
      })), '../rulebook/ch6.html#attributes'));
    });
    b.appendChild(g);
    b.appendChild(el('h2', { class: 'px', text: 'Abilities' }));
    if (M.past_life) b.appendChild(el('p', { class: 'center' }, ['Past Life Occupation: ', el('strong', { text: M.past_life }), '. Abilities marked PL cost new dot x2 XP. ', link('../rulebook/ch6.html#abilities-past-life-occupation', 'Rules')]));
    var g2 = el('div', { class: 'cv-grid' });
    M.abilities.forEach(function (gr) {
      g2.appendChild(card(gr.group + (gr.num ? ' (' + gr.num + ')' : ''), gr.list.map(function (a) {
        var name = el('span', {}, [link(abLink(a.name), a.name), a.pl ? el('span', { class: 'cv-tag', text: 'PL' }) : null]);
        return row2(name, a.specs.length ? 'Specialties: ' + a.specs.join(', ') : null, dots(a.dots));
      }), '../rulebook/ch6.html#abilities-' + slug(gr.group)));
    });
    b.appendChild(g2);
  };
  function entry(kind, x, page) {
    if (!x) return null;
    return el('div', { class: 'cv-entry' }, [
      el('b', { text: (kind ? kind + ': ' : '') + x.name }),
      x.use ? el('span', { class: 'use', text: ' (' + x.use + ')' }) : null,
      x.cost ? el('span', { class: 'use', text: ' (' + String(x.cost).replace(/^(\d+)/, '$1 mana') + ')' }) : null,
      x.note ? el('span', { class: 'use', text: ' (' + x.note + ')' }) : null,
      x.text ? el('p', { text: x.text }) : null,
      x.id ? el('a', { href: '../rulebook/' + page + '.html#' + x.id, text: 'Full rules' }) : null
    ]);
  }
  DRAW.styles = function (b) {
    if (!M.styles.length) { b.appendChild(el('p', { class: 'center cv-muted', text: 'No Combat Styles yet.' })); return; }
    M.styles.forEach(function (s) {
      var kids = [row2(s.weapons, 'Primary pool: ' + s.primary + '. Secondary: ' + s.secondary, dots(s.dots)), el('p', {}, [el('span', { class: 'cv-tag gold', text: s.tier }), ' ', link(s.link, 'Read the whole Style')])];
      s.ranks.forEach(function (r) {
        kids.push(el('div', { class: 'cv-rank' }, [el('div', { class: 'cv-rank-title', text: 'Rank ' + r.rank + ': ' + r.title }), entry('Default', r.def, 'ch12')]
          .concat(r.picks.map(function (p) { return entry(p.opt, p, 'ch12'); }))
          .concat(r.picks.length ? [] : [el('p', { class: 'cv-muted', text: 'No option picked for this rank yet.' })])));
      });
      b.appendChild(card(s.name, kids));
    });
  };
  DRAW.magic = function (b) {
    if (!M.knowledges.length) { b.appendChild(el('p', { class: 'center cv-muted', text: 'No Magical Knowledges yet.' })); return; }
    M.knowledges.forEach(function (k) {
      var kids = [row2(k.heritage ? 'Heritage magic' : (k.kind || 'Magical Knowledge'), k.focus || null, dots(k.dots)), el('p', {}, [el('span', { class: 'cv-tag gold', text: k.tier }), ' ', link(k.link, 'Read it in the book')])];
      if (k.circle) kids.push(el('p', { class: 'cv-muted', text: 'Circle Magic grows with every dot instead of picking spells. What you can do at ' + k.dots + ' dot' + (k.dots === 1 ? '' : 's') + ' is in its entry.' }));
      if (k.single) kids.push(el('p', { class: 'cv-muted', text: 'A single spell with no Option A or B. Each rank improves what it can do.' }));
      if (k.tribal) kids.push(el('div', {}, k.tribal.length ? k.tribal.map(function (t) { return row2('Rank ' + t.rank + ': ' + t.name, 'Written with the Storyteller', null); }) : [el('p', { class: 'cv-muted', text: 'Tribal Magic spells are written with the Storyteller.' })]));
      (k.ranks || []).forEach(function (r) {
        kids.push(el('div', { class: 'cv-rank' }, [el('div', { class: 'cv-rank-title', text: 'Rank ' + r.rank + ': ' + r.title }), r.def ? entry('Default', r.def, k.page) : null]
          .concat(r.picks.map(function (p) { return entry(p.opt || 'Spell', p, k.page); }))
          .concat((r.combos || []).map(function (c) { return entry('Combination', { name: c.name + ' (' + c.schools.join(' + ') + ')', cost: c.cost, text: c.text, id: c.id }, 'ch13'); }))
          .concat(r.picks.length || (r.combos || []).length ? [] : [el('p', { class: 'cv-muted', text: 'Nothing picked for this rank yet.' })])));
      });
      b.appendChild(card(k.name, kids));
    });
  };
  DRAW.merits = function (b) {
    var g = el('div', { class: 'cv-grid' });
    function mf(x) {
      var sub = [x.option ? x.option.name : '', x.note, x.cost ? 'Cost: ' + x.cost : ''].filter(Boolean).join('. ');
      var n = Number(x.value);
      return el('div', {}, [row2(link(x.link, x.name), sub || null, isFinite(n) && n > 0 && n <= 10 ? el('span', { class: 'px', text: String(n) }) : null),
        x.option && x.option.text ? el('p', { class: 'cv-muted', style: 'font-size:14px', text: x.option.text }) : null]);
    }
    g.appendChild(card('Merits', M.merits.length ? M.merits.map(mf) : [el('p', { class: 'cv-muted', text: 'No Merits.' })], '../rulebook/ch9.html'));
    g.appendChild(card('Flaws', M.flaws.length ? M.flaws.map(mf) : [el('p', { class: 'cv-muted', text: 'No Flaws.' })], '../rulebook/ch9.html'));
    g.appendChild(card('Backgrounds', M.backgrounds.map(function (x) { return row2(link(x.link, x.name), x.who ? x.who : x.what, dots(x.dots)); }), '../rulebook/ch10.html'));
    g.appendChild(card('Guild Standing', M.guilds.length ? M.guilds.map(function (x) { return row2(x.name, null, dots(x.dots || 0)); }) : [el('p', { class: 'cv-muted', text: 'No guilds.' })], '../rulebook/ch10.html#guild-standing'));
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

  // ---------- Experience ----------
  async function persist(nextModel) {
    var s = window.TerranaCharacter.sheet();
    var sheet = Object.assign({}, row.sheet || {}, { build: s.build, xp: s.xp, view: s.view });
    var res = await db.from('characters').update({ sheet: sheet }).eq('id', id).select('sheet').single();
    if (res.error) throw res.error;
    row.sheet = res.data.sheet;
    M = nextModel || window.TerranaCharacter.model();
    drawHead(); drawBody();
  }
  async function act(fn, ok) {
    try { var m = fn(); await persist(m); say(ok); }
    catch (e) {
      // put things back the way they were saved
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

      // Spending
      var groups = {};
      M.offers.forEach(function (o) { (groups[o.group] = groups[o.group] || []).push(o); });
      var order = ['Attributes', 'Abilities', 'Specialties', 'Combat Styles', 'Magical Knowledges', 'Mana', 'Options You Did Not Pick', 'Combination Spells'];
      var spend = [el('p', { class: 'cv-muted', text: 'Costs follow the Chapter 6 table: the new dot times the listed number. Raising a Style or school past a rank asks which option you learn.' })];
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
    // History
    var hist = el('ul', { class: 'cv-log' });
    var buys = M.xp.buys.slice().reverse(), logs = M.xp.log.slice().reverse();
    buys.forEach(function (x, i) {
      hist.appendChild(el('li', {}, [el('span', { text: when(x.d) + ': spent ' + x.cost + ' on ' + x.label }),
        mine && i === 0 ? el('button', { class: 'act small', type: 'button', text: 'Undo', onclick: function () { if (confirm('Undo this purchase and get ' + x.cost + ' XP back?')) act(function () { return window.TerranaCharacter.undo(x.id); }, 'Purchase undone.'); } }) : null]));
    });
    logs.forEach(function (x) {
      hist.appendChild(el('li', {}, [el('span', { text: when(x.d) + ': earned ' + x.amt + (x.note ? ' (' + x.note + ')' : '') }),
        mine ? el('button', { class: 'act small', type: 'button', text: 'Remove', onclick: function () { if (confirm('Remove this XP entry?')) act(function () { return window.TerranaCharacter.removeAward(x.id); }, 'XP entry removed.'); } }) : null]));
    });
    b.appendChild(card('History', hist.children.length ? [hist] : [el('p', { class: 'cv-muted', text: 'No XP recorded yet.' })]));
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
