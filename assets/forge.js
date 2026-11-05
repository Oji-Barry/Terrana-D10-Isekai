/* Jimothy's D10 Isekai JRPG - Character Forge.
   Walks a player through the 13 creation steps of Chapter 6.
   The build is kept in characters.sheet.build; progress in characters.sheet.forge. */

(function () {
  var A = window.Terrana.auth;
  var db = A.client;
  var $ = function (id) { return document.getElementById(id); };

  var STEPS = [
    'Pick your Trope', 'Consult the Scales', 'Assign your Role', 'Choose your Heritage',
    'Allocate your Attributes', 'Prioritize your Abilities', 'Select your Merits and Flaws',
    'Determine your Backgrounds', 'Set Willpower, Fate, and Sanity', 'Choose your Combat Styles',
    'Choose your Magical Knowledges', 'Spend your Freebie Points', 'Calculate your Level'
  ];
  var BUILT = 13; // steps that are built so far

  var D = null;      // forge/data.json
  var me = null;     // logged in player
  var ch = null;     // the character row
  var build = {};    // the character's choices
  var forge = {};    // progress: { step, done: [], ok: [] }
  var step = 1;
  var XPS = { log: [], buys: [] }; // experience after creation: sheet.xp
  var EXTRA = { gear: {}, money: null, attuned: {}, tracks: {} }; // sheet.gear, money, attuned, tracks (the character page)

  // ---------- small helpers ----------
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function bookLink(href, label) {
    return el('a', { href: href, target: '_blank', rel: 'noopener', class: 'book-link',
      'aria-label': (label || 'Read more') + ' (opens the rulebook in a new tab)' }, [label || 'Read in the rulebook']);
  }
  function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
  function byName(list, name) { for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i]; return null; }

  // ---------- steps ----------
  // Each step: render(panel) draws it; check() returns [{key, text}] warnings; summary() for So Far.
  var S = {};

  // Step 1: Trope
  S[1] = {
    intro: 'Choose one Trope, the personality archetype at the heart of your character. Its Boon gives one bonus die on rolls with one ability. Its Bane gives one penalty die on rolls with another.',
    link: '../rulebook/ch7.html#part-1-tropes',
    render: function (p) {
      var groups = {};
      D.tropes.forEach(function (t) { (groups[t.group] = groups[t.group] || []).push(t); });
      Object.keys(groups).forEach(function (g) {
        var fs = el('fieldset', { class: 'choice-group' }, [el('legend', { class: 'px', text: g + ' Tropes' })]);
        var grid = el('div', { class: 'choice-grid' });
        groups[g].forEach(function (t) {
          var id = 'trope-' + slug(t.name);
          var input = el('input', { type: 'radio', name: 'trope', id: id, value: t.name });
          if (build.trope === t.name) input.checked = true;
          input.addEventListener('change', function () { build.trope = t.name; refresh(); });
          grid.appendChild(el('div', { class: 'choice' }, [
            input,
            el('label', { for: id }, [
              el('span', { class: 'choice-name', text: t.name }),
              el('span', { class: 'choice-meta', text: 'Boon: ' + t.boon + '  |  Bane: ' + t.bane })
            ]),
            bookLink(t.link, 'Rules')
          ]));
        });
        fs.appendChild(grid);
        p.appendChild(fs);
      });
    },
    check: function () {
      return build.trope ? [] : [{ key: 'trope.none', text: 'No Trope picked yet.' }];
    },
    summary: function () { return build.trope ? [['Trope', build.trope]] : []; }
  };

  // Step 2: Scales
  var POS = [
    { v: 'virtue2', label: 'High', side: 'virtue', n: 2 },
    { v: 'virtue1', label: 'Low', side: 'virtue', n: 1 },
    { v: 'central', label: 'Central', side: null, n: 0 },
    { v: 'vice1', label: 'Low', side: 'vice', n: 1 },
    { v: 'vice2', label: 'High', side: 'vice', n: 2 }
  ];
  function scaleCounts() {
    var c = { high: 0, low: 0, central: 0, unset: 0 };
    D.scales.forEach(function (s) {
      var v = (build.scales || {})[slug(s.name)] || 'central';
      if (v === 'central') c.central++;
      else if (/2$/.test(v)) c.high++;
      else c.low++;
    });
    return c;
  }
  S[2] = {
    intro: 'Mark where your character sits on each of the seven scales: two highs (the 2 at either end), two lows (the 1 on either side), and three central. Then pick one Driving Factor for each high. It must match the scale and the side the high sits on.',
    link: '../rulebook/ch7.html#part-2-virtues-vices-and-the-seven-scales',
    counter: function () {
      var c = scaleCounts();
      return [['Highs', 2 - c.high], ['Lows', 2 - c.low]];
    },
    render: function (p) {
      build.scales = build.scales || {};
      build.drives = build.drives || {};
      D.scales.forEach(function (s) {
        var key = slug(s.name);
        var row = el('fieldset', { class: 'scale-row' }, [
          el('legend', {}, [
            el('span', { class: 'scale-virtue', text: s.virtue }),
            el('span', { class: 'scale-q', text: s.tension }),
            el('span', { class: 'scale-vice', text: s.vice })
          ])
        ]);
        var seg = el('div', { class: 'scale-seg', role: 'radiogroup', 'aria-label': s.name });
        POS.forEach(function (pos) {
          var id = 'sc-' + key + '-' + pos.v;
          var input = el('input', { type: 'radio', name: 'sc-' + key, id: id, value: pos.v });
          if ((build.scales[key] || 'central') === pos.v) input.checked = true;
          input.addEventListener('change', function () {
            build.scales[key] = pos.v;
            if (!/2$/.test(pos.v)) delete build.drives[key];
            refresh(true);
          });
          var word = pos.side === 'virtue' ? s.virtue : pos.side === 'vice' ? s.vice : '';
          seg.appendChild(input);
          seg.appendChild(el('label', { for: id, class: 'seg-' + pos.v, title: (pos.label + ' ' + word).trim() }, [
            el('span', { class: 'seg-n', text: String(pos.n) }),
            el('span', { class: 'seg-l', text: pos.label })
          ]));
        });
        row.appendChild(seg);

        var v = build.scales[key];
        if (v && /2$/.test(v)) {
          var side = v.indexOf('virtue') === 0 ? 'virtue' : 'vice';
          var drives = side === 'virtue' ? s.virtue_drives : s.vice_drives;
          var sid = 'drive-' + key;
          var sel = el('select', { id: sid }, [el('option', { value: '', text: 'Choose a Driving Factor' })]);
          drives.forEach(function (d) {
            var o = el('option', { value: d, text: d });
            if (build.drives[key] === d) o.selected = true;
            sel.appendChild(o);
          });
          sel.addEventListener('change', function () {
            if (sel.value) build.drives[key] = sel.value; else delete build.drives[key];
            refresh();
          });
          row.appendChild(el('div', { class: 'drive-pick' }, [
            el('label', { for: sid, text: 'High ' + (side === 'virtue' ? s.virtue : s.vice) + ' Driving Factor' }),
            sel,
            bookLink(s.link, 'Scale rules')
          ]));
        }
        p.appendChild(row);
      });
    },
    check: function () {
      var w = [], c = scaleCounts();
      if (c.high !== 2) w.push({ key: 'scales.high.' + c.high, text: 'You have ' + c.high + ' high' + (c.high === 1 ? '' : 's') + '. The book asks for 2.' });
      if (c.low !== 2) w.push({ key: 'scales.low.' + c.low, text: 'You have ' + c.low + ' low' + (c.low === 1 ? '' : 's') + '. The book asks for 2.' });
      D.scales.forEach(function (s) {
        var k = slug(s.name), v = (build.scales || {})[k];
        if (v && /2$/.test(v) && !(build.drives || {})[k]) w.push({ key: 'drive.' + k, text: 'Pick a Driving Factor for your high on ' + s.name + '.' });
      });
      return w;
    },
    summary: function () {
      var out = [];
      D.scales.forEach(function (s) {
        var k = slug(s.name), v = (build.scales || {})[k];
        if (!v || v === 'central') return;
        var word = v.indexOf('virtue') === 0 ? s.virtue : s.vice;
        var line = (/2$/.test(v) ? 'High ' : 'Low ') + word;
        if ((build.drives || {})[k]) line += ' (' + build.drives[k] + ')';
        out.push([/2$/.test(v) ? 'High' : 'Low', line]);
      });
      return out;
    }
  };

  // Step 3: Role
  S[3] = {
    intro: 'Your Role is your position on the battlefield: a line, then one word for how you fight. It decides where you start when combat begins, and you can change it as play goes on.',
    link: '../rulebook/ch6.html#the-creation-process',
    render: function (p) {
      build.role = build.role || {};
      var wrap = el('div', { class: 'role-picks' });
      [['position', 'Position', D.roles.positions], ['style', 'Fighting style', D.roles.styles]].forEach(function (r) {
        var id = 'role-' + r[0];
        var sel = el('select', { id: id }, [el('option', { value: '', text: 'Choose...' })]);
        r[2].forEach(function (x) {
          var o = el('option', { value: x, text: x });
          if (build.role[r[0]] === x) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () { build.role[r[0]] = sel.value; refresh(); });
        wrap.appendChild(el('div', { class: 'field' }, [el('label', { for: id, text: r[1] }), sel]));
      });
      p.appendChild(wrap);
      var shown = el('p', { class: 'role-result px', id: 'role-result' });
      p.appendChild(shown);
      updateRole();
    },
    check: function () {
      var r = build.role || {}, w = [];
      if (!r.position) w.push({ key: 'role.position', text: 'No Position picked yet.' });
      if (!r.style) w.push({ key: 'role.style', text: 'No fighting style picked yet.' });
      return w;
    },
    summary: function () {
      var r = build.role || {};
      return r.position || r.style ? [['Role', ((r.position || '') + ' ' + (r.style || '')).trim()]] : [];
    }
  };
  function updateRole() {
    var t = $('role-result');
    if (!t) return;
    var r = build.role || {};
    t.textContent = r.position && r.style ? r.position + ' ' + r.style : '';
  }

  // Step 4: Heritage
  function heritage() { return build.heritage && byName(D.heritages, build.heritage.name); }
  function innateChoices(h) {
    if (!h) return [];
    var all = [].concat(D.attributes.Physical, D.attributes.Social, D.attributes.Mental);
    if (/^any one$/i.test(h.innate_attribute)) return all;
    var picks = h.innate_attribute.split(/\s+or\s+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return all.indexOf(x) >= 0; });
    return picks;
  }
  S[4] = {
    intro: 'Pick your heritage and record what it gives you: your Innate Attribute (it starts at 2 dots), your Innate Flaw, your Attribute Flaw, one Heritage Merit, and one free dot of your Heritage magic, marked P. Rare heritages need Storyteller approval.',
    link: '../rulebook/ch8.html#how-heritages-work',
    render: function (p) {
      build.heritage = build.heritage || {};
      [['Common Heritages', false], ['Rare Heritages', true]].forEach(function (g) {
        var fs = el('fieldset', { class: 'choice-group' }, [el('legend', { class: 'px', text: g[0] })]);
        var grid = el('div', { class: 'choice-grid' });
        D.heritages.filter(function (h) { return h.rare === g[1]; }).forEach(function (h) {
          var id = 'her-' + slug(h.name);
          var input = el('input', { type: 'radio', name: 'heritage', id: id, value: h.name });
          if (build.heritage.name === h.name) input.checked = true;
          input.addEventListener('change', function () {
            build.heritage = { name: h.name };
            var c = innateChoices(h);
            if (c.length === 1) build.heritage.innate = c[0];
            if (h.heritage_merits.length === 1) build.heritage.merit = h.heritage_merits[0];
            refresh(true);
          });
          grid.appendChild(el('div', { class: 'choice' }, [
            input,
            el('label', { for: id }, [
              el('span', { class: 'choice-name', text: h.name }),
              el('span', { class: 'choice-meta', text: 'Innate: ' + h.innate_attribute + '  |  Magic: ' + h.heritage_magic })
            ]),
            bookLink(h.link, 'Rules')
          ]));
        });
        fs.appendChild(grid);
        p.appendChild(fs);
      });

      var h = heritage();
      if (!h) return;
      var box = el('fieldset', { class: 'heritage-details win-inset' }, [el('legend', { class: 'px', text: h.name })]);
      var demon = h.name === 'Demon';

      if (demon) {
        box.appendChild(el('p', { class: 'hint', text: 'Demon traits are set with your Storyteller. Type in what you agree on together.' }));
        [['innate', 'Innate Attribute'], ['innate_flaw', 'Innate Flaw'], ['attribute_flaw', 'Attribute Flaw']].forEach(function (f) {
          var id = 'dem-' + f[0];
          var input = el('input', { id: id, maxlength: '60', value: build.heritage[f[0]] || '' });
          input.addEventListener('input', function () { build.heritage[f[0]] = input.value; refresh(false, true); });
          box.appendChild(el('div', { class: 'field' }, [el('label', { for: id, text: f[1] }), input]));
        });
      } else {
        var choices = innateChoices(h);
        if (choices.length > 1) {
          var iid = 'her-innate';
          var sel = el('select', { id: iid }, [el('option', { value: '', text: 'Choose your Innate Attribute' })]);
          choices.forEach(function (c) {
            var o = el('option', { value: c, text: c });
            if (build.heritage.innate === c) o.selected = true;
            sel.appendChild(o);
          });
          sel.addEventListener('change', function () { build.heritage.innate = sel.value; refresh(); });
          box.appendChild(el('div', { class: 'field' }, [el('label', { for: iid, text: 'Innate Attribute (starts at 2 dots)' }), sel]));
        } else {
          box.appendChild(el('p', {}, [el('strong', { text: 'Innate Attribute: ' }), (choices[0] || h.innate_attribute) + ' (starts at 2 dots)']));
        }
        box.appendChild(el('p', {}, [el('strong', { text: 'Innate Flaw: ' }), h.innate_flaw]));
        box.appendChild(el('p', {}, [el('strong', { text: 'Attribute Flaw: ' }), h.attribute_flaw === 'None' ? 'None' : h.attribute_flaw + ' can never be your Affinity column']));
      }

      if (h.heritage_merits.length > 1) {
        var mid = 'her-merit';
        var ms = el('select', { id: mid }, [el('option', { value: '', text: 'Choose 1 Heritage Merit' })]);
        h.heritage_merits.forEach(function (m) {
          var o = el('option', { value: m, text: m });
          if (build.heritage.merit === m) o.selected = true;
          ms.appendChild(o);
        });
        ms.addEventListener('change', function () { build.heritage.merit = ms.value; refresh(); });
        box.appendChild(el('div', { class: 'field' }, [el('label', { for: mid, text: 'Heritage Merit' }), ms]));
      } else {
        box.appendChild(el('p', {}, [el('strong', { text: 'Heritage Merit: ' }), h.heritage_merits[0] || '']));
      }
      heritageMagicChoice(box, h);
      box.appendChild(el('p', {}, [bookLink(h.link, 'Read the full ' + h.name + ' entry')]));
      p.appendChild(box);
    },
    check: function () {
      var w = [], h = heritage();
      if (!h) return [{ key: 'her.none', text: 'No heritage picked yet.' }];
      if (h.rare) w.push({ key: 'her.rare.' + slug(h.name), text: h.name + ' is a Rare heritage. Rare heritages need Storyteller approval.' });
      if (!h.creation_allowed) w.push({ key: 'her.nocreate.' + slug(h.name), text: h.name + ' cannot be chosen at creation. A character only becomes one in play.' });
      if (h.name === 'Demon') {
        if (!build.heritage.innate || !build.heritage.innate_flaw || !build.heritage.attribute_flaw)
          w.push({ key: 'her.demon.blank', text: 'Fill in the Demon traits you agreed on with your Storyteller.' });
      } else if (!build.heritage.innate) {
        w.push({ key: 'her.innate', text: 'Choose your Innate Attribute.' });
      }
      if (!build.heritage.merit) w.push({ key: 'her.merit', text: 'Choose your Heritage Merit.' });
      if (h.name === 'Vampire' && !build.heritage.vpower) w.push({ key: 'her.vpower', text: 'Choose which Vampiric Power gets your free dot.' });
      if (h.name === 'Hyuman' && !build.heritage.adapt) w.push({ key: 'her.adapt', text: 'Choose where your Adaptation dot goes.' });
      if (h.name === 'Demon' && !(build.heritage.magic || '').trim()) w.push({ key: 'her.demon.magic', text: 'Name your tribe\u2019s Heritage magic with your Storyteller.' });
      return w;
    },
    summary: function () {
      var h = heritage();
      if (!h) return [];
      var out = [['Heritage', h.name]];
      if (build.heritage.innate) out.push(['Innate', build.heritage.innate + ' (2 dots)']);
      if (build.heritage.merit) out.push(['Heritage Merit', build.heritage.merit]);
      if (hmOn()) out.push(['Heritage Magic', hmName() + ' ' + hmVal() + ' (P)']);
      else if (hyAdapt()) out.push(['Adaptation', hyAdapt().slice(2) + ' 1 (free)']);
      return out;
    }
  };

  // ---------- Storyteller Mode and dot helpers ----------
  function stMode() { return !!(forge.st && me && me.is_admin); }
  function dotMax(normal) { return stMode() ? 10 : normal; }

  // A row of clickable dots. base = dots that come free (drawn locked).
  // limit (optional): dots above it can't be filled right now and are faded out
  // Outside Storyteller Mode nothing can be filled past 5 at creation (the
  // Golden Rule), unless noCap is set (Willpower, Fate, Sanity).
  function dotRow(label, value, max, base, onSet, limit, noCap, readOnly) {
    base = base || 0;
    if (limit === undefined || limit === null) limit = max;
    if (!noCap && !stMode()) limit = Math.min(limit, 5);
    if (stMode()) limit = max;   // Storyteller Mode: every dot is open
    if (readOnly) limit = value;
    var row = el('div', { class: 'dots', role: 'group', 'aria-label': label });
    for (var i = 1; i <= max; i++) {
      (function (n) {
        var on = n <= value;
        var locked = n <= base;
        var out = !on && n > limit;
        var b = el('button', {
          type: 'button',
          class: 'dot' + (on ? ' on' : '') + (locked ? ' locked' : '') + (out ? ' out' : '') + (n > 5 ? ' over5' : ''),
          'aria-label': label + ': ' + n + (n === 1 ? ' dot' : ' dots') + (out ? ' (no dots left)' : ''),
          'aria-pressed': on ? 'true' : 'false',
          disabled: locked || out || readOnly ? 'disabled' : null
        });
        b.addEventListener('click', function () {
          var v = (n === value) ? Math.max(base, n - 1) : n;
          onSet(v);
        });
        row.appendChild(b);
      })(i);
    }
    row.appendChild(el('span', { class: 'dot-n px', text: String(value) }));
    return row;
  }

  function goldenRule(name, v) {
    return v > 5 ? [{ key: 'golden.' + slug(name) + '.' + v, text: name + ' has ' + v + ' dots. The Golden Rule says nothing goes above 5 at creation.' }] : [];
  }

  // ---------- Step 5: Attributes ----------
  var COLS = ['Physical', 'Social', 'Mental'];
  var COLNUM = { Affinity: 6, Standard: 5, Aversion: 4 };
  function hyumanAdapt() {
    return build.heritage && build.heritage.name === 'Hyuman' && build.heritage.merit === 'Hyuman Adaptability';
  }
  function innateAttr() { return build.heritage && build.heritage.innate; }
  function attrBase(a) { return a === innateAttr() ? 2 : 1; }
  function attrVal(a) { var v = (build.attrs || {})[a]; return v === undefined ? attrBase(a) : v; }
  function colNumber(col) {
    if (hyumanAdapt()) return 5;
    var d = (build.attr_cols || {})[col];
    return d ? COLNUM[d] : null;
  }
  function colLeft(col) {
    var n = colNumber(col);
    if (n === null) return null;
    var spent = 0;
    D.attributes[col].forEach(function (a) { spent += attrVal(a) - attrBase(a); });
    return n - spent;
  }
  // The highest dot an attribute can be filled to right now: its column cap
  // (Aversion 4, or 5 if Innate), never above 5 at creation, and no more than
  // the column has dots left for. Dots above this are faded out.
  function attrLimit(a, col) {
    var cap = colNumber(col);
    var limit = Math.min(5, cap === null ? 5 : cap + (a === innateAttr() ? 1 : 0));
    var left = colLeft(col);
    if (left !== null) limit = Math.min(limit, attrVal(a) + Math.max(0, left));
    return limit;
  }
  function attributeFlawCol() {
    var h = heritage();
    if (!h) return null;
    var f = h.name === 'Demon' ? (build.heritage.attribute_flaw || '') : h.attribute_flaw;
    return COLS.indexOf(f) >= 0 ? f : null;
  }
  S[5] = {
    intro: 'Every attribute starts at 1 dot (your Innate Attribute starts at 2). Give each column one designation: Affinity (6), Standard (5), or Aversion (4). That number is the column’s cap and the number of dots you spend across its three attributes. Your Attribute Flaw column can never be your Affinity. No attribute can be filled above 5 at creation.',
    link: '../rulebook/ch6.html#attributes',
    counter: function () {
      return COLS.map(function (c) { var l = colLeft(c); return [c, l === null ? '-' : l]; });
    },
    render: function (p) {
      build.attr_cols = build.attr_cols || {};
      build.attrs = build.attrs || {};
      if (hyumanAdapt()) {
        p.appendChild(el('p', { class: 'note-box', text: 'Hyuman Adaptability: all three columns are 5 instead of Affinity, Standard, and Aversion.' }));
      }
      var flaw = attributeFlawCol();
      var grid = el('div', { class: 'attr-cols' });
      COLS.forEach(function (col) {
        var box = el('fieldset', { class: 'attr-col' }, [el('legend', { class: 'px', text: col })]);
        if (!hyumanAdapt()) {
          var id = 'col-' + col;
          var sel = el('select', { id: id }, [el('option', { value: '', text: 'Designation...' })]);
          ['Affinity', 'Standard', 'Aversion'].forEach(function (dname) {
            // each designation is used once, and the Attribute Flaw column can't be Affinity
            var takenBy = COLS.filter(function (c) { return c !== col && build.attr_cols[c] === dname; })[0];
            var flawBlock = dname === 'Affinity' && flaw === col;
            var o = el('option', { value: dname, text: dname + ' (' + COLNUM[dname] + ')' + (takenBy ? ' (used by ' + takenBy + ')' : flawBlock ? ' (Attribute Flaw)' : '') });
            if ((takenBy || flawBlock) && !stMode()) o.disabled = true;
            if (build.attr_cols[col] === dname) o.selected = true;
            sel.appendChild(o);
          });
          sel.addEventListener('change', function () { build.attr_cols[col] = sel.value; refresh(true); });
          box.appendChild(el('div', { class: 'field' }, [el('label', { for: id, text: 'Designation' }), sel]));
          if (flaw === col) box.appendChild(el('p', { class: 'hint', text: 'Attribute Flaw: this column cannot be your Affinity.' }));
        }
        D.attributes[col].forEach(function (a) {
          var base = attrBase(a);
          box.appendChild(el('div', { class: 'trait' }, [
            el('span', { class: 'trait-name', text: a + (a === innateAttr() ? ' (Innate)' : '') }),
            dotRow(a, attrVal(a), stMode() ? 10 : 7, base, function (v) { build.attrs[a] = v; refresh(true); },
              stMode() ? null : attrLimit(a, col))
          ]));
        });
        grid.appendChild(box);
      });
      p.appendChild(grid);
    },
    check: function () {
      var w = [];
      if (!hyumanAdapt()) {
        var used = {};
        COLS.forEach(function (c) {
          var d = (build.attr_cols || {})[c];
          if (!d) w.push({ key: 'cols.unset.' + c, text: 'Give the ' + c + ' column a designation.' });
          else if (used[d]) w.push({ key: 'cols.dup.' + d, text: 'Affinity, Standard, and Aversion should each be used once. ' + d + ' is used twice.' });
          used[d] = true;
        });
        var flaw = attributeFlawCol();
        if (flaw && (build.attr_cols || {})[flaw] === 'Affinity') w.push({ key: 'cols.flaw.' + flaw, text: 'Your Attribute Flaw is ' + flaw + ', so it cannot be your Affinity column.' });
      }
      COLS.forEach(function (c) {
        var l = colLeft(c);
        if (l !== null && l > 0) w.push({ key: 'attr.left.' + c + '.' + l, text: c + ' has ' + l + ' dot' + (l === 1 ? '' : 's') + ' left to place.' });
        if (l !== null && l < 0) w.push({ key: 'attr.over.' + c + '.' + l, text: c + ' is ' + (-l) + ' dot' + (l === -1 ? '' : 's') + ' over its number.' });
        var cap = colNumber(c);
        D.attributes[c].forEach(function (a) {
          var v = attrVal(a), limit = cap === null ? 99 : cap + (a === innateAttr() ? 1 : 0);
          if (v > limit) w.push({ key: 'attr.cap.' + a + '.' + v, text: a + ' is above its column cap of ' + limit + '.' });
          w = w.concat(goldenRule(a, v));
        });
      });
      return w;
    },
    summary: function () {
      if (!build.attrs && !build.attr_cols) return [];
      return COLS.map(function (c) {
        return [c + (colNumber(c) ? ' (' + colNumber(c) + ')' : ''), D.attributes[c].map(function (a) { return a.slice(0, 3) + ' ' + attrVal(a); }).join(', ')];
      });
    }
  };

  // ---------- Step 6: Abilities ----------
  var GROUPS = ['Warrior', 'Rogue', 'Troubadour', 'Noble', 'Mage', 'Sage'];
  function abVal(a) { return (build.abilities || {})[a] || 0; }
  function groupLeft(g) {
    var n = (build.ab_groups || {})[g];
    if (!n) return null;
    var s = 0;
    D.abilities[g].forEach(function (a) { s += abVal(a.name); });
    return n - s;
  }
  // Past Life Occupation and specialties
  var OTHER = '__other';
  function job() { return build.pl_job && build.pl_job !== 'Other' ? byName(D.occupations, build.pl_job) : null; }
  function plCount() { return Object.keys(build.pl || {}).filter(function (k) { return build.pl[k]; }).length; }
  function plMax() { var j = job(); return j ? j.pl.length : 3; }
  function specSlots(a) { return ((build.pl || {})[a] ? 1 : 0) + (abVal(a) + fbOf('abilities', a) >= 4 ? 1 : 0); }
  function specList(a) {
    var s = (build.specialties || {})[a];
    if (typeof s === 'string') s = s ? [s] : [];
    return (s || []).slice();
  }
  function setJob(name) {
    var j = name && name !== 'Other' ? byName(D.occupations, name) : null;
    build.pl_job = name || undefined;
    build.pl = {};
    if (j) {
      build.pl_occupation = j.name;
      j.pl.forEach(function (x) {
        build.pl[x.ability] = true;
        var s = specList(x.ability);
        if (s[0] && s[0] !== x.specialty && abVal(x.ability) >= 4) s = [x.specialty, s[0]];
        else s[0] = x.specialty;
        build.specialties[x.ability] = s;
        delete build.spec_other[x.ability + '|0'];
      });
    } else if (name === 'Other') {
      if (byName(D.occupations, build.pl_occupation || '')) build.pl_occupation = '';
    } else {
      build.pl_occupation = '';
    }
  }

  function specialtyBoxes(box, a) {
    var slots = specSlots(a.name);
    if (!slots) return;
    var s = specList(a.name);
    var opts = D.specialties[a.name] || [];
    for (var i = 0; i < slots; i++) (function (i) {
      var k = a.name + '|' + i;
      var cur = s[i] || '';
      var other = !!build.spec_other[k] || (cur && opts.indexOf(cur) < 0);
      var label = slots === 2 ? (i === 0 ? 'PL specialty' : '4-dot specialty') : ((build.pl || {})[a.name] ? 'PL specialty' : 'Free specialty');
      var id = 'sp-' + slug(a.name) + '-' + i;
      var sel = el('select', { id: id }, [el('option', { value: '', text: 'Choose...' })]);
      opts.forEach(function (o) {
        var op = el('option', { value: o, text: o });
        if (!other && cur === o) op.selected = true;
        sel.appendChild(op);
      });
      var ot = el('option', { value: OTHER, text: 'Other...' });
      if (other) ot.selected = true;
      sel.appendChild(ot);
      sel.addEventListener('change', function () {
        var list = specList(a.name);
        if (sel.value === OTHER) { build.spec_other[k] = true; if (opts.indexOf(list[i]) >= 0) list[i] = ''; }
        else { delete build.spec_other[k]; list[i] = sel.value; }
        build.specialties[a.name] = list;
        refresh(true);
      });
      var kids = [el('label', { for: id, text: a.name + ': ' + label }), sel];
      if (other) {
        var tid = id + '-other';
        var tx = el('input', { id: tid, maxlength: '40', value: cur, placeholder: 'Write your own', 'aria-label': a.name + ' ' + label + ', your own' });
        tx.addEventListener('input', function () {
          var list = specList(a.name);
          list[i] = tx.value;
          build.specialties[a.name] = list;
          refresh();
        });
        kids.push(tx);
      }
      box.appendChild(el('div', { class: 'field specialty' }, kids));
    })(i);
  }

  S[6] = {
    intro: 'Abilities start at 0 dots. Give each of the six groups a different number from 2 to 7. That number is how many dots you spend in that group, and no ability can be filled above 5 at creation. Then choose your Past Life Occupation: it marks PL on 3 to 5 abilities. Every PL ability and every ability with 4 or more dots gets a free specialty, and an ability with both gets two.',
    link: '../rulebook/ch6.html#abilities-past-life-occupation',
    counter: function () {
      return GROUPS.map(function (g) { var l = groupLeft(g); return [g, l === null ? '-' : l]; });
    },
    render: function (p) {
      build.ab_groups = build.ab_groups || {};
      build.abilities = build.abilities || {};
      build.specialties = build.specialties || {};
      build.spec_other = build.spec_other || {};
      build.pl = build.pl || {};
      if (build.pl_occupation && !build.pl_job) build.pl_job = byName(D.occupations, build.pl_occupation) ? build.pl_occupation : 'Other';

      // Past Life Occupation
      var occBox = el('fieldset', { class: 'pl-box' }, [el('legend', { class: 'px', text: 'Past Life Occupation' })]);
      var jobSel = el('select', { id: 'pl-job' }, [el('option', { value: '', text: 'Choose...' })]);
      D.occupations.forEach(function (o) {
        var op = el('option', { value: o.name, text: o.name });
        if (build.pl_job === o.name) op.selected = true;
        jobSel.appendChild(op);
      });
      var oth = el('option', { value: 'Other', text: 'Other...' });
      if (build.pl_job === 'Other') oth.selected = true;
      jobSel.appendChild(oth);
      jobSel.addEventListener('change', function () { setJob(jobSel.value); refresh(true); });
      occBox.appendChild(el('div', { class: 'field' }, [el('label', { for: 'pl-job', text: 'What did you do before Terrana?' }), jobSel]));
      if (build.pl_job === 'Other') {
        var occ = el('input', { id: 'pl-occ', maxlength: '60', value: build.pl_occupation || '', placeholder: 'For example: skateboarder, librarian' });
        occ.addEventListener('input', function () { build.pl_occupation = occ.value; refresh(); });
        occBox.appendChild(el('div', { class: 'field' }, [el('label', { for: 'pl-occ', text: 'Your occupation' }), occ]));
      }
      var j = job();
      var hint = j ? 'Marks PL on ' + j.pl.map(function (x) { return x.ability; }).join(', ') + ', and picks a specialty for each. You can change them below.'
        : build.pl_job === 'Other' ? 'Check PL on the 3 abilities that fit your occupation, then pick their specialties.'
        : 'Pick a job to mark its PL abilities, or choose Other to write your own.';
      occBox.appendChild(el('p', { class: 'hint', text: hint }));
      if (build.pl_job) occBox.appendChild(el('p', { class: 'pl-count px', text: 'PL marks: ' + plCount() + ' of ' + plMax() + (plMax() < 5 ? ' (up to 5 with your Storyteller)' : '') }));
      p.appendChild(occBox);

      var grid = el('div', { class: 'ab-groups' });
      GROUPS.forEach(function (g) {
        var box = el('fieldset', { class: 'ab-group' }, [el('legend', { class: 'px', text: g })]);
        var id = 'grp-' + g;
        var sel = el('select', { id: id }, [el('option', { value: '', text: 'Dots...' })]);
        for (var n = 2; n <= 7; n++) {
          // each number can be used by one group only (Storyteller Mode can break this)
          var takenBy = GROUPS.filter(function (o) { return o !== g && build.ab_groups[o] === n; })[0];
          var o = el('option', { value: String(n), text: takenBy ? n + ' (used by ' + takenBy + ')' : String(n) });
          if (takenBy && !stMode()) o.disabled = true;
          if (build.ab_groups[g] === n) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', function () { build.ab_groups[g] = sel.value ? Number(sel.value) : undefined; refresh(true); });
        box.appendChild(el('div', { class: 'field inline' }, [el('label', { for: id, text: g + ' dots' }), sel]));
        D.abilities[g].forEach(function (a) {
          var v = abVal(a.name);
          var plId = 'pl-' + slug(a.name);
          var pl = el('input', { type: 'checkbox', id: plId });
          if (build.pl[a.name]) pl.checked = true;
          pl.addEventListener('change', function () {
            if (pl.checked && plCount() >= 5 && !stMode()) {
              pl.checked = false;
              showToast('5 PL marks is the most a character can have.');
              return;
            }
            if (pl.checked) build.pl[a.name] = true; else delete build.pl[a.name];
            refresh(true);
          });
          box.appendChild(el('div', { class: 'trait' }, [
            el('span', { class: 'trait-name', title: a.used_for, text: a.name }),
            dotRow(a.name, v, stMode() ? 10 : 7, 0, function (nv) { build.abilities[a.name] = nv; refresh(true); },
              stMode() ? null : Math.min(5, groupLeft(g) === null ? 5 : v + Math.max(0, groupLeft(g)))),
            el('label', { class: 'pl-check', for: plId }, [pl, ' PL'])
          ]));
          specialtyBoxes(box, a);
        });
        grid.appendChild(box);
      });
      p.appendChild(grid);
    },
    check: function () {
      var w = [], seen = {};
      GROUPS.forEach(function (g) {
        var n = (build.ab_groups || {})[g];
        if (!n) { w.push({ key: 'grp.unset.' + g, text: 'Give the ' + g + ' group a number from 2 to 7.' }); return; }
        if (seen[n]) w.push({ key: 'grp.dup.' + n, text: 'Each group should get a different number. ' + n + ' is used more than once.' });
        seen[n] = true;
        var l = groupLeft(g);
        if (l > 0) w.push({ key: 'grp.left.' + g + '.' + l, text: g + ' has ' + l + ' dot' + (l === 1 ? '' : 's') + ' left to place.' });
        if (l < 0) w.push({ key: 'grp.over.' + g + '.' + l, text: g + ' is ' + (-l) + ' dot' + (l === -1 ? '' : 's') + ' over its number.' });
      });
      GROUPS.forEach(function (g) {
        D.abilities[g].forEach(function (a) {
          w = w.concat(goldenRule(a.name, abVal(a.name)));
          var s = specList(a.name).slice(0, specSlots(a.name));
          for (var i = 0; i < specSlots(a.name); i++) {
            if (!(s[i] || '').trim()) w.push({ key: 'spec.' + a.name + '.' + i, text: 'Pick ' + (i ? 'a second' : 'a') + ' specialty for ' + a.name + '.' });
          }
          if (s.length === 2 && s[0] && s[0].trim().toLowerCase() === (s[1] || '').trim().toLowerCase()) w.push({ key: 'spec.dup.' + a.name, text: a.name + ' has the same specialty twice. Pick two different ones.' });
        });
      });
      if (!build.pl_job) w.push({ key: 'pl.none', text: 'Choose your Past Life Occupation.' });
      else if (build.pl_job === 'Other' && !(build.pl_occupation || '').trim()) w.push({ key: 'pl.name', text: 'Write in your Past Life Occupation.' });
      var c = plCount();
      if (build.pl_job && c < 3) w.push({ key: 'pl.few.' + c, text: 'Mark PL on at least 3 abilities. You have ' + c + '.' });
      if (c > plMax()) w.push({ key: 'pl.more.' + c, text: 'You have ' + c + ' PL marks. ' + (job() ? job().name : 'Other') + ' gets ' + plMax() + '. Up to 5 is fine if it makes sense to your Storyteller.' });
      return w;
    },
    summary: function () {
      var out = [];
      if (build.pl_occupation) out.push(['Past Life', build.pl_occupation]);
      var top = [], sp = [];
      GROUPS.forEach(function (g) {
        D.abilities[g].forEach(function (a) {
          var v = abVal(a.name);
          if (v || (build.pl || {})[a.name]) top.push(a.name + ' ' + v + ((build.pl || {})[a.name] ? ' (PL)' : ''));
          var s = specList(a.name).slice(0, specSlots(a.name)).filter(function (x) { return x && x.trim(); });
          if (s.length) sp.push(a.name + ': ' + s.join(', '));
        });
      });
      if (top.length) out.push(['Abilities', top.join(', ')]);
      if (sp.length) out.push(['Specialties', sp.join('; ')]);
      return out;
    }
  };

  // ---------- Step 7: Merits and Flaws ----------
  function costOptions(c, isFlaw) {
    var o = [], unit = c.unit || 'dot';
    var word = isFlaw ? 'back' : '';
    function lbl(t, pts) { return t + ' (' + pts + ' pt' + (pts === 1 ? '' : 's') + (word ? ' ' + word : '') + ')'; }
    if (c.kind === 'per_dot') {
      var max = stMode() ? Math.max(c.max, 10) : c.max;
      for (var n = 1; n <= max; n++) o.push({ v: String(n), pts: n * c.per, label: lbl(n + ' ' + unit + (n === 1 ? '' : 's'), n * c.per) });
    } else if (c.kind === 'fixed') {
      o.push({ v: 'take', pts: c.cost, label: lbl('Take it', c.cost) });
    } else if (c.kind === 'levels') {
      c.levels.forEach(function (pts, i) { o.push({ v: String(i + 1), pts: pts, label: lbl((i + 1) + ' ' + unit + (i ? 's' : ''), pts) }); });
    } else if (c.kind === 'choice') {
      c.options.forEach(function (pts, i) { o.push({ v: 'c' + i, pts: pts, label: lbl('Option ' + (i + 1), pts) }); });
    } else if (c.kind === 'range') {
      for (var p2 = c.min; p2 <= c.max; p2++) o.push({ v: 'r' + p2, pts: p2, label: lbl('Set with your Storyteller', p2) });
    } else if (c.kind === 'named') {
      // a list from the book, then Other at each point level
      (c.options || []).forEach(function (x, i) { o.push({ v: 'n' + i, pts: x.points, label: lbl(x.name + (x.dots ? ', ' + x.dots + ' dot' + (x.dots > 1 ? 's' : '') : ''), x.points) }); });
      (c.levels || range(c.min, c.max)).forEach(function (pts) { o.push({ v: 'r' + pts, pts: pts, label: lbl('Other, made with your Storyteller', pts) }); });
    }
    return o;
  }
  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }
  function picksTotal(kind) {
    var list = kind === 'flaws' ? D.flaws : D.merits, picks = build[kind] || {}, t = 0;
    Object.keys(picks).forEach(function (name) {
      var item = byName(list, name);
      if (!item) return;
      var opt = costOptions(kind === 'flaws' ? item.points : item.cost, kind === 'flaws').filter(function (o) { return o.v === picks[name]; })[0];
      if (opt) t += opt.pts;
    });
    return t;
  }
  function meritBudget() { return 7 + Math.min(picksTotal('flaws'), 7); }
  function meritLeft() { return meritBudget() - picksTotal('merits'); }

  function pickList(p, kind) {
    var list = kind === 'flaws' ? D.flaws : D.merits;
    build[kind] = build[kind] || {};
    var groups = {};
    list.forEach(function (m) { (groups[m.group] = groups[m.group] || []).push(m); });
    Object.keys(groups).forEach(function (g, gi) {
      var det = el('details', { class: 'pick-group' });
      var count = groups[g].filter(function (m) { return build[kind][m.name]; }).length;
      if (count) det.open = true;
      det.appendChild(el('summary', {}, [el('span', { class: 'px', text: g + (kind === 'flaws' ? ' Flaws' : (/Merits|Eyes|Powers|Enhancements/.test(g) ? '' : ' Merits')) }), count ? el('span', { class: 'pick-count', text: count + ' picked' }) : null]));
      groups[g].forEach(function (m) {
        var id = kind + '-' + slug(m.name);
        var c = kind === 'flaws' ? m.points : m.cost;
        if (m.options) c.options = m.options;
        var sel = el('select', { id: id }, [el('option', { value: '', text: 'None' })]);
        costOptions(c, kind === 'flaws').forEach(function (o) {
          var op = el('option', { value: o.v, text: o.label });
          if (build[kind][m.name] === o.v) op.selected = true;
          sel.appendChild(op);
        });
        sel.addEventListener('change', function () {
          if (sel.value) build[kind][m.name] = sel.value; else delete build[kind][m.name];
          refresh(!!m.options || m.name === 'Familiar Bond');
        });
        det.appendChild(el('div', { class: 'pick-row' }, [
          el('label', { for: id, class: 'pick-name', text: m.name }),
          el('span', { class: 'pick-cost', text: c.text }),
          sel,
          bookLink(m.link, 'Rules')
        ]));
        if (kind === 'merits' && m.name === 'Familiar Bond' && build.merits[m.name]) companionBox(det, 'familiar', 'Your Familiar', 'Familiar Bond at creation gives you one tiny or small Rank F familiar. Add your Familiar Bond dots to its Attack and Defense pools. It does not count toward your SumMonz on the field.');
        // the chosen curse or bargain, or a box to describe your own
        var v = build[kind][m.name] || '';
        if (m.options && v.charAt(0) === 'n') {
          det.appendChild(el('p', { class: 'hint pick-detail', text: m.options[Number(v.slice(1))].text }));
        } else if (m.options && v.charAt(0) === 'r') {
          build.flaw_notes = build.flaw_notes || {};
          var nid = id + '-note';
          var note = el('input', { id: nid, maxlength: '200', value: build.flaw_notes[m.name] || '', placeholder: 'Describe it as agreed with your Storyteller' });
          note.addEventListener('input', function () { build.flaw_notes[m.name] = note.value; refresh(); });
          det.appendChild(el('div', { class: 'field pick-detail' }, [el('label', { for: nid, text: 'Your ' + (m.name === 'Cursed' ? 'curse' : 'bargain') }), note]));
        }
      });
      p.appendChild(det);
    });
  }
  S[7] = {
    intro: 'You have 7 points to spend on Merits. Each Flaw point you take gives you 1 more point, up to 7 more, for a maximum of 14. Your Heritage Merit is free and already recorded. Points you do not spend carry over to Backgrounds in Step 8.',
    link: '../rulebook/ch9.html#overview',
    counter: function () {
      return [['Merit points', meritLeft()], ['Flaw points', Math.min(picksTotal('flaws'), 7) + ' / 7']];
    },
    render: function (p) {
      if (build.heritage && build.heritage.merit) {
        p.appendChild(el('p', { class: 'note-box' }, [el('strong', { text: 'Heritage Merit (free): ' }), build.heritage.merit]));
      }
      p.appendChild(el('h2', { class: 'sub-title px', text: 'Merits' }));
      pickList(p, 'merits');
      p.appendChild(el('h2', { class: 'sub-title px', text: 'Flaws' }));
      pickList(p, 'flaws');
    },
    check: function () {
      var w = [], left = meritLeft(), fl = picksTotal('flaws');
      if (left < 0) w.push({ key: 'merit.over.' + left, text: 'Your Merits cost ' + (-left) + ' more point' + (left === -1 ? '' : 's') + ' than you have.' });
      if (fl > 7) w.push({ key: 'flaw.over.' + fl, text: 'Your Flaws add up to ' + fl + ' points. Only 7 of them count toward Merits.' });
      ['merits', 'flaws'].forEach(function (kind) {
        Object.keys(build[kind] || {}).forEach(function (name) {
          var item = byName(kind === 'flaws' ? D.flaws : D.merits, name);
          var c = item && (kind === 'flaws' ? item.points : item.cost);
          if (c && c.kind === 'range') w.push({ key: 'st.' + slug(name), text: name + ' is set with your Storyteller. Agree on the points together.' });
          if (c && c.kind === 'named' && String(build[kind][name]).charAt(0) === 'r') {
            w.push({ key: 'st.' + slug(name), text: 'Your own ' + name + ' needs your Storyteller to agree on it.' });
            if (!((build.flaw_notes || {})[name] || '').trim()) w.push({ key: 'note.' + slug(name), text: 'Describe your ' + (name === 'Cursed' ? 'curse' : 'bargain') + '.' });
          }
          if (c && c.kind === 'per_dot' && Number(build[kind][name]) > c.max) w.push({ key: 'max.' + slug(name), text: name + ' is above its usual max of ' + c.max + '.' });
        });
      });
      return w;
    },
    summary: function () {
      var out = [];
      var ms = Object.keys(build.merits || {}), fs = Object.keys(build.flaws || {});
      if (ms.length) out.push(['Merits', ms.join(', ')]);
      if ((build.merits || {})['Familiar Bond'] && companionText(build.familiar)) out.push(['Familiar', companionText(build.familiar)]);
      if (fs.length) out.push(['Flaws', fs.map(function (n) {
        var f = byName(D.flaws, n), v = String(build.flaws[n]);
        if (f && f.options && v.charAt(0) === 'n') return n + ' (' + f.options[Number(v.slice(1))].name + ')';
        if (f && f.options && v.charAt(0) === 'r') return n + ' (' + (((build.flaw_notes || {})[n] || '').trim() || 'Other') + ')';
        return n;
      }).join(', ')]);
      return out;
    }
  };

  // ---------- Step 8: Backgrounds ----------
  // Dots changed in the story from the character page (not creation choices): sheet.tracks.story
  function storyAdj(kind, n) { return ((((EXTRA.tracks || {}).story || {})[kind]) || {})[n] || 0; }
  function bgVal(n) {
    var v = (build.backgrounds || {})[n];
    if (v === undefined) v = n === 'Resources' ? 1 : 0;
    return Math.max(0, v + storyAdj('bg', n));
  }
  function meritVal(kind, n) {
    var v = (build[kind] || {})[n];
    if (v === undefined || v === null || v === '' || isNaN(Number(v))) return v;
    return Math.max(0, Number(v) + storyAdj(kind === 'merits' ? 'merit' : 'flaw', n));
  }
  var PEOPLE_BGS = ['Allies', 'Contacts', 'Fixer', 'Mentor', 'Retainers'];
  function bgSpent() {
    var s = 0;
    D.backgrounds.forEach(function (b) { s += bgVal(b.name) - (b.name === 'Resources' ? 1 : 0); });
    (build.guilds || []).forEach(function (g) { s += g.dots || 0; });
    return s;
  }
  function bgBudget() { return 7 + Math.max(meritLeft(), 0); }
  S[8] = {
    intro: 'You have 7 points to spend on Backgrounds, plus any points left over from Step 7. Every character starts with 1 free dot of Resources. No Background can be filled above 5 at creation. Guild Standing also uses these points; in most games the limit is 3 dots in any one guild.',
    link: '../rulebook/ch10.html#background-list',
    counter: function () { return [['Points', bgBudget() - bgSpent()]]; },
    render: function (p) {
      build.backgrounds = build.backgrounds || {};
      build.guilds = build.guilds || [];
      build.guilds.forEach(function (g) { if (g && g.name === 'Mercenaries Guild (space era)') g.name = 'Mercenaries Guild (Future Era)'; });
      var box = el('div', { class: 'bg-list' });
      D.backgrounds.forEach(function (b) {
        var base = b.name === 'Resources' ? 1 : 0;
        box.appendChild(el('div', { class: 'trait bg' }, [
          el('span', { class: 'trait-name' }, [b.name, el('span', { class: 'trait-what', text: b.what })]),
          dotRow(b.name, bgVal(b.name), dotMax(7), base, function (v) { build.backgrounds[b.name] = v; refresh(true); },
            bgVal(b.name) + Math.max(0, bgBudget() - bgSpent())),
          bookLink(b.link, 'Rules')
        ]));
        // name the NPCs you and your Storyteller add to the game
        if (PEOPLE_BGS.indexOf(b.name) >= 0 && bgVal(b.name) + fbOf('backgrounds', b.name) > 0) {
          build.bg_names = build.bg_names || {};
          var nid = 'bgn-' + slug(b.name);
          var nm = el('input', { id: nid, maxlength: '200', value: build.bg_names[b.name] || '', placeholder: 'Names, separated by commas' });
          nm.addEventListener('input', function () { build.bg_names[b.name] = nm.value; refresh(); });
          box.appendChild(el('div', { class: 'field bg-names' }, [el('label', { for: nid, text: b.name + ': who are they?' }), nm]));
        }
      });
      p.appendChild(box);
      p.appendChild(el('h2', { class: 'sub-title px', text: 'Guild Standing' }));
      var gl = el('div', { class: 'guilds' });
      for (var i = 0; i < 3; i++) {
        (function (i) {
          var g = build.guilds[i] || { name: '', dots: 0 };
          var id = 'guild-' + i;
          // pick a guild from the book (each one once), or Other to write one in
          var listed = !!byName(D.guilds, g.name || '');
          var other = !!g.other || (!!g.name && !listed);
          var sel = el('select', { id: id }, [el('option', { value: '', text: 'Choose a guild...' })]);
          D.guilds.forEach(function (x) {
            var taken = build.guilds.some(function (o, j) { return j !== i && o && o.name === x.name; });
            var op = el('option', { value: x.name, text: x.name + (taken ? ' (already picked)' : '') });
            if (taken) op.disabled = true;
            if (!other && g.name === x.name) op.selected = true;
            sel.appendChild(op);
          });
          var ot = el('option', { value: OTHER, text: 'Other...' });
          if (other) ot.selected = true;
          sel.appendChild(ot);
          sel.addEventListener('change', function () {
            var cur = build.guilds[i] || { dots: 0 };
            if (sel.value === OTHER) { cur.other = true; if (byName(D.guilds, cur.name || '')) cur.name = ''; }
            else { delete cur.other; cur.name = sel.value; }
            build.guilds[i] = cur;
            refresh(true);
          });
          var pick = el('div', { class: 'guild-pick' }, [el('label', { for: id, class: 'visually-hidden', text: 'Guild ' + (i + 1) }), sel]);
          if (other) {
            var name = el('input', { id: id + '-other', maxlength: '50', value: g.name || '', placeholder: 'Guild name', 'aria-label': 'Guild ' + (i + 1) + ' name' });
            name.addEventListener('input', function () { build.guilds[i] = Object.assign(build.guilds[i] || { dots: 0 }, { name: name.value }); refresh(); });
            pick.appendChild(name);
          } else if (listed) {
            pick.appendChild(el('p', { class: 'hint', text: byName(D.guilds, g.name).what }));
          }
          gl.appendChild(el('div', { class: 'trait guild' }, [
            pick,
            dotRow('Guild ' + (i + 1) + ' standing', g.dots || 0, dotMax(7), 0, function (v) { build.guilds[i] = Object.assign(build.guilds[i] || { name: '' }, { dots: v }); refresh(true); },
              (g.dots || 0) + Math.max(0, bgBudget() - bgSpent()))
          ]));
        })(i);
      }
      p.appendChild(gl);
      p.appendChild(el('p', {}, [bookLink('../rulebook/ch10.html#guild-standing', 'Guild Standing rules')]));
    },
    check: function () {
      var w = [], left = bgBudget() - bgSpent();
      if (left > 0) w.push({ key: 'bg.left.' + left, text: left + ' Background point' + (left === 1 ? '' : 's') + ' left to spend.' });
      if (left < 0) w.push({ key: 'bg.over.' + left, text: 'You are ' + (-left) + ' Background point' + (left === -1 ? '' : 's') + ' over.' });
      D.backgrounds.forEach(function (b) { w = w.concat(goldenRule(b.name, bgVal(b.name))); });
      (build.guilds || []).forEach(function (g, i) {
        if (g && g.dots > 3) w.push({ key: 'guild.over.' + i + '.' + g.dots, text: (g.name || 'A guild') + ' has ' + g.dots + ' dots. Most games limit Guild Standing to 3 at creation.' });
        if (g && g.dots && !(g.name || '').trim()) w.push({ key: 'guild.noname.' + i, text: 'Choose the guild for your Guild Standing.' });
        var gx = g && byName(D.guilds, g.name || '');
        if (gx && gx.era) w.push({ key: 'guild.era.' + i, text: g.name + ' only exists in a ' + gx.era.toLowerCase() + ' game (Chapter 16). Check with your Storyteller.' });
      });
      return w;
    },
    summary: function () {
      var items = D.backgrounds.filter(function (b) { return bgVal(b.name) > 0; }).map(function (b) {
        var who = ((build.bg_names || {})[b.name] || '').trim();
        return b.name + ' ' + bgVal(b.name) + (who ? ' (' + who + ')' : '');
      });
      (build.guilds || []).forEach(function (g) { if (g && g.dots) items.push((g.name || 'Guild') + ' ' + g.dots); });
      return items.length ? [['Backgrounds', items.join(', ')]] : [];
    }
  };

  // ---------- Step 9: Willpower, Fate, Sanity ----------
  function highsBySide() {
    var v = 0, x = 0;
    Object.keys(build.scales || {}).forEach(function (k) {
      if (build.scales[k] === 'virtue2') v++;
      if (build.scales[k] === 'vice2') x++;
    });
    return { virtue: v, vice: x };
  }
  function startWillpower() {
    var h = highsBySide();
    if (h.vice >= 2) return 4;
    if (h.virtue >= 2) return 6;
    return 5;
  }
  function statVal(n) {
    var s = (build.stats || {})[n];
    if (s === undefined) s = n === 'Willpower' ? startWillpower() : 5;
    var adj = ((EXTRA.tracks || {}).adj || {})[n] || 0; // full rows of checks or X's on the character page
    return Math.max(0, Math.min(10, s + adj));
  }
  function statStart(n) { return n === 'Willpower' ? startWillpower() : 5; }
  S[9] = {
    intro: 'These are filled in for you: 5 dots of each. If both of your highs are Vices, Willpower is 4. If both are Virtues, it is 6. One of each leaves it at 5. Fate and Sanity can only be changed at creation by Merits and Flaws.',
    link: '../rulebook/ch11.html',
    render: function (p) {
      // players can't change these, so drop any change saved before they were locked
      if (!(me && me.is_admin)) build.stats = {};
      build.stats = build.stats || {};
      var h = highsBySide();
      p.appendChild(el('p', { class: 'note-box', text: 'Your highs: ' + h.virtue + ' Virtue, ' + h.vice + ' Vice. Starting Willpower: ' + startWillpower() + '.' }));
      ['Willpower', 'Fate', 'Sanity'].forEach(function (n) {
        p.appendChild(el('div', { class: 'trait stat' }, [
          el('span', { class: 'trait-name', text: n }),
          dotRow(n, statVal(n), 10, 0, function (v) { build.stats[n] = v; refresh(true); }, null, true, !stMode()),
          stMode() && statVal(n) !== statStart(n) ? el('button', { type: 'button', class: 'act small', text: 'Reset to ' + statStart(n), onclick: function () { delete build.stats[n]; refresh(true); } }) : null
        ]));
      });
      p.appendChild(el('p', { class: 'hint', text: stMode() ? 'Storyteller Mode: change these only if a Merit or Flaw says so.' : 'These are set by the rules. If a Merit or Flaw changes them, your Storyteller adjusts them in Storyteller Mode.' }));
      if (stMode()) storytellerExtras(p);
    },
    check: function () {
      var w = [];
      ['Willpower', 'Fate', 'Sanity'].forEach(function (n) {
        if (statVal(n) !== statStart(n)) w.push({ key: 'stat.' + n + '.' + statVal(n), text: n + ' is ' + statVal(n) + ' instead of ' + statStart(n) + '. Make sure a Merit or Flaw allows it.' });
      });
      return w;
    },
    summary: function () {
      return [['Willpower / Fate / Sanity', statVal('Willpower') + ' / ' + statVal('Fate') + ' / ' + statVal('Sanity')]];
    }
  };

  // Storyteller-only extras: big Mana and custom Health boxes
  function storytellerExtras(p) {
    build.st_extra = build.st_extra || {};
    var x = build.st_extra;
    var box = el('fieldset', { class: 'st-extras' }, [el('legend', { class: 'px', text: 'Storyteller Extras' })]);
    box.appendChild(el('div', { class: 'trait' }, [
      el('span', { class: 'trait-name', text: 'Mana' }),
      dotRow('Mana', x.mana || 1, 20, 0, function (v) { x.mana = v; refresh(true); }, null, true)
    ]));
    [['bashing', 'Bashing boxes'], ['lethal', 'Lethal boxes'], ['aggravated', 'Aggravated boxes']].forEach(function (h) {
      var id = 'hb-' + h[0];
      var sel = el('select', { id: id }, [el('option', { value: '', text: 'Book standard' })]);
      for (var n = 1; n <= 20; n++) {
        var o = el('option', { value: String(n), text: String(n) });
        if ((x.health || {})[h[0]] === n) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener('change', function () {
        x.health = x.health || {};
        if (sel.value) x.health[h[0]] = Number(sel.value); else delete x.health[h[0]];
        refresh();
      });
      box.appendChild(el('div', { class: 'field inline' }, [el('label', { for: id, text: h[1] }), sel]));
    });
    p.appendChild(box);
  }

  // ---------- shared: totals with Freebie Points ----------
  var SK_DOTS = { Affinity: 7, Standard: 5, Aversion: 3 };
  function fb() {
    build.fb = build.fb || {};
    ['attrs', 'abilities', 'styles', 'knows', 'backgrounds'].forEach(function (k) { build.fb[k] = build.fb[k] || {}; });
    build.fb.mana = build.fb.mana || 0;
    return build.fb;
  }
  function fbOf(kind, n) { return ((build.fb || {})[kind] || {})[n] || 0; }
  function attrTotal(a) { return attrVal(a) + fbOf('attrs', a) + xpDots('attr', a); }
  function abTotal(a) { return abVal(a) + fbOf('abilities', a) + xpDots('ab', a); }
  function styleVal(n) { return (build.styles || {})[n] || 0; }
  function knowVal(n) { return (build.knows || {})[n] || 0; }
  function styleTotal(n) { return styleVal(n) + fbOf('styles', n) + xpDots('style', n); }
  function knowTotal(n) { return knowVal(n) + knowFree(n) + fbOf('knows', n) + xpDots('know', n); }
  function manaTotal() { return 1 + ((build.fb || {}).mana || 0) + xpDots('mana', ''); }
  // dots for Steps 10 and 11 come from the Physical or Mental column
  function skBudget(col) {
    if (evenSpreadSafe()) return 5;
    var d = (build.attr_cols || {})[col];
    return d ? SK_DOTS[d] : null;
  }
  function evenSpreadSafe() { return hyumanAdapt(); }
  function styleLeft() { var b = skBudget('Physical'); if (b === null) return null; var s = 0; D.styles.forEach(function (x) { s += styleVal(x.name); }); return b - s; }
  // Heritage Magic: 1 free dot from Step 4, more can be bought with knowledge dots
  // Hyuman Adaptation: 'hm:<a bloodline magic>' or 'k:<a casting school or circle discipline>'
  function hyAdapt() { var h = heritage(); return h && h.name === 'Hyuman' ? (build.heritage.adapt || '') : null; }
  function knowFree(n) { return hyAdapt() === 'k:' + n ? 1 : 0; }
  function hmOn() { var a = hyAdapt(); return !!heritage() && !(a && a.indexOf('k:') === 0); }
  function hmBase() { return hmOn() ? Math.max(1, build.hm_dots || 1) : 0; }
  function hmVal() { return hmOn() ? hmBase() + ((build.fb || {}).hm || 0) + xpDots('hm', '') : 0; }
  function hmName() {
    var h = heritage(); if (!h) return '';
    if (h.name === 'Demon') return (build.heritage.magic || '').trim() || 'Tribal Magic';
    if (h.name === 'Vampire') return build.heritage.vpower || 'Vampiric Powers';
    var a = hyAdapt();
    if (a && a.indexOf('hm:') === 0) return a.slice(3);
    return h.heritage_magic;
  }
  function hmKey() { var h = heritage(); return h && h.name === 'Demon' ? 'Tribal Magic' : hmName(); }
  function hmData() { return (D.heritage_magic || {})[hmKey()] || null; }
  function hmItem() { var d = hmData(); return d && d.ranks ? { name: hmName(), ranks: d.ranks, link: '../rulebook/ch8.html#' + d.id } : null; }
  var VPOWERS = ['Auspex', 'Blood Sorcery', 'Celerity', 'Dominion', 'Vigor'];
  // Step 4: which Heritage magic the free dot goes to
  function heritageMagicChoice(box, h) {
    var hd = (D.heritage_magic || {})[h.heritage_magic] || {};
    var link = hd.id ? '../rulebook/ch8.html#' + hd.id : h.link;
    if (h.name === 'Vampire') {
      var vs = el('select', { id: 'her-vpower' }, [el('option', { value: '', text: 'Choose a Vampiric Power' })]);
      VPOWERS.forEach(function (v) { vs.appendChild(el('option', { value: v, text: v })); });
      vs.value = build.heritage.vpower || '';
      vs.addEventListener('change', function () { build.heritage.vpower = vs.value; refresh(true); });
      box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'her-vpower', text: 'Vampiric Power (1 free dot, marked P)' }), vs]));
      box.appendChild(el('p', { class: 'hint' }, ['A born vampire starts with one of the five powers. The others can be bought with XP after creation. ', bookLink(link, 'Vampiric Powers')]));
      return;
    }
    if (h.name === 'Hyuman') {
      var as = el('select', { id: 'her-adapt' }, [el('option', { value: '', text: 'Choose where your free dot goes' })]);
      var g1 = el('optgroup', { label: 'A non-Hyuman parent\u2019s bloodline magic' });
      var seen = {};
      D.heritages.forEach(function (x) {
        var names = x.heritage_magic === 'Vampiric Powers' ? VPOWERS : [x.heritage_magic];
        names.forEach(function (n) {
          if (x.name === 'Hyuman' || seen[n] || !((D.heritage_magic || {})[n] || {}).ranks) return;
          seen[n] = 1;
          g1.appendChild(el('option', { value: 'hm:' + n, text: n + ' (' + x.name + ')' }));
        });
      });
      var g2 = el('optgroup', { label: 'One dot in a casting school' });
      var g3 = el('optgroup', { label: 'One dot in a Circle Magic discipline' });
      D.knowledges.forEach(function (k) {
        if (k.kind === 'Casting school') g2.appendChild(el('option', { value: 'k:' + k.name, text: k.name }));
        else if (k.circle) g3.appendChild(el('option', { value: 'k:' + k.name, text: k.name }));
      });
      [g1, g2, g3].forEach(function (g) { as.appendChild(g); });
      as.value = build.heritage.adapt || '';
      as.addEventListener('change', function () { build.heritage.adapt = as.value; delete build.hm_dots; if (build.fb) delete build.fb.hm; refresh(true); });
      box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'her-adapt', text: 'Adaptation (1 free dot)' }), as]));
      box.appendChild(el('p', { class: 'hint' }, ['A bloodline magic is raised like any Heritage magic, and a Hyuman is never locked out of its spells. A school or discipline dot is a normal knowledge dot. ', bookLink(link, 'Adaptation')]));
      return;
    }
    if (h.name === 'Demon') {
      var mi = el('input', { id: 'dem-magic', maxlength: '60', value: build.heritage.magic || '', placeholder: 'Name your tribe\u2019s magic' });
      mi.addEventListener('input', function () { build.heritage.magic = mi.value; refresh(false, true); });
      box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'dem-magic', text: 'Heritage Magic (Tribal Magic, 1 free dot)' }), mi]));
      box.appendChild(el('p', { class: 'hint' }, ['Designed with your Storyteller. ', bookLink(link, 'Tribal Magic guidelines')]));
      return;
    }
    box.appendChild(el('p', {}, [el('strong', { text: 'Heritage Magic: ' }), bookLink(link, h.heritage_magic), ', 1 free dot, marked P']));
  }
  function knowLeft() { var b = skBudget('Mental'); if (b === null) return null; var s = 0; D.knowledges.forEach(function (x) { s += knowVal(x.name); }); if (hmOn()) s += hmBase() - 1; return b - s; }
  // Combination spells: open to a casting school's rank once every school in
  // the combination has enough dots (2 each for two schools, 3 each for three)
  // A rank's pick is one value for players; Storyteller Mode can keep several
  function picksAt(v) { return v === undefined || v === null ? [] : (Array.isArray(v) ? v.map(String) : [String(v)]); }
  function comboById(id) { for (var i = 0; i < D.combos.length; i++) if (D.combos[i].id === id) return D.combos[i]; return null; }
  function comboMet(c) { return c.schools.every(function (sc) { return knowTotal(sc) >= c.dots; }); }
  function comboTakenElsewhere(c, school, r) {
    var kp = build.know_picks || {};
    return Object.keys(kp).some(function (sc) {
      return Object.keys(kp[sc] || {}).some(function (rr) { return picksAt(kp[sc][rr]).indexOf('c:' + c.id) >= 0 && !(sc === school && String(rr) === String(r)); });
    });
  }
  function combosFor(school, r) {
    return (D.combos || []).filter(function (c) {
      return c.schools.indexOf(school) >= 0 && c.dots <= r && comboMet(c) && !comboTakenElsewhere(c, school, r);
    });
  }
  // Name and pick a starter companion: a familiar, or a first SumMonz (fiend or spirit)
  function companionBox(box, key, title, hint) {
    build[key] = build[key] || {};
    var c = build[key];
    var isSummon = key === 'starter_summon';
    var fs = el('fieldset', { class: 'companion' }, [el('legend', { class: 'px', text: title }), el('p', { class: 'hint', text: hint })]);
    var nid = 'cmp-' + key + '-name';
    var nm = el('input', { id: nid, maxlength: '60', value: c.name || '', placeholder: 'Name' });
    nm.addEventListener('input', function () { c.name = nm.value; refresh(); });
    fs.appendChild(el('div', { class: 'field' }, [el('label', { for: nid, text: 'Name' }), nm]));
    if (isSummon) {
      var kid = 'cmp-' + key + '-kind';
      var ks = el('select', { id: kid }, [el('option', { value: '', text: 'Choose...' }), el('option', { value: 'fiend', text: 'Fiend (a creature of the world)' }), el('option', { value: 'spirit', text: 'Spirit (Soul Summoning, any form)' })]);
      ks.value = c.kind || '';
      ks.addEventListener('change', function () { c.kind = ks.value; c.pick = ''; refresh(true); });
      fs.appendChild(el('div', { class: 'field' }, [el('label', { for: kid, text: 'Kind' }), ks]));
    }
    var list = isSummon ? (c.kind ? D.starters[c.kind === 'fiend' ? 'fiends' : 'spirits'] : null) : D.starters.familiars;
    if (list) {
      var pid = 'cmp-' + key + '-pick';
      var ps = el('select', { id: pid }, [el('option', { value: '', text: 'Choose...' })]);
      list.forEach(function (x) { ps.appendChild(el('option', { value: x, text: x })); });
      ps.appendChild(el('option', { value: OTHER, text: 'Other...' }));
      ps.value = c.pick || '';
      ps.addEventListener('change', function () { c.pick = ps.value; refresh(true); });
      fs.appendChild(el('div', { class: 'field' }, [el('label', { for: pid, text: 'Creature' }), ps]));
      if (c.pick === OTHER) {
        var wid = 'cmp-' + key + '-what';
        var wh = el('input', { id: wid, maxlength: '200', value: c.what || '', placeholder: isSummon && c.kind === 'spirit' ? 'Describe its form and school' : 'Describe it (Storyteller approval)' });
        wh.addEventListener('input', function () { c.what = wh.value; refresh(); });
        fs.appendChild(el('div', { class: 'field' }, [el('label', { for: wid, text: 'Your own' }), wh]));
      }
      fs.appendChild(el('p', { class: 'hint', text: 'Rank F: ' + D.starters.stats + '.' }));
    }
    if (isSummon) {
      // one name box per form its Summoning dots unlock: 2nd at 3, 3rd at 5, 4th at 7
      var dots = knowTotal('Summoning Magic');
      var forms = [['First Form', 1], ['Second Form', 3], ['Third Form', 5], ['Fourth Form', 7]].filter(function (f) { return dots >= f[1]; });
      c.forms = c.forms || {};
      var ff = el('div', { class: 'form-names' });
      forms.forEach(function (f, i) {
        var fid = 'cmp-' + key + '-form-' + (i + 1);
        var fi = el('input', { id: fid, maxlength: '60', value: c.forms[i + 1] || '', placeholder: i ? 'Name of its evolved form' : 'Usually its own name' });
        fi.addEventListener('input', function () { c.forms[i + 1] = fi.value; if (!fi.value.trim()) delete c.forms[i + 1]; refresh(); });
        ff.appendChild(el('div', { class: 'field' }, [el('label', { for: fid, text: f[0] + (i ? ' (' + f[1] + ' dots)' : '') }), fi]));
      });
      fs.appendChild(el('p', { class: 'hint', text: 'Name each form your Summoning dots unlock. The same names go on your Summoner\u2019s Sheet.' }));
      fs.appendChild(ff);
    }
    box.appendChild(fs);
  }
  function companionText(c) {
    if (!c) return '';
    var what = c.pick === OTHER ? (c.what || '').trim() : (c.pick || '');
    var out = [c.name, what].filter(function (x) { return x && x.trim(); }).join(', ');
    var fn = Object.keys(c.forms || {}).sort().filter(function (k) { return +k > 1 && c.forms[k].trim(); }).map(function (k) { return c.forms[k].trim(); });
    return out + (fn.length ? ' (evolves into ' + fn.join(', then ') + ')' : '');
  }
  // Storyteller Mode: check every option the current dots reach
  function selectAll(kinds) {
    if (kinds.indexOf('style') >= 0) {
      build.style_picks = build.style_picks || {};
      D.styles.forEach(function (st) {
        var t = styleTotal(st.name); if (!t) return;
        var mine = build.style_picks[st.name] = build.style_picks[st.name] || {};
        for (var r = 1; r <= Math.min(t, st.ranks.length); r++) mine[r] = ['a', 'b'];
      });
    }
    if (kinds.indexOf('know') >= 0) {
      build.know_picks = build.know_picks || {};
      D.knowledges.forEach(function (k) {
        var t = knowTotal(k.name); if (!t || !k.ranks) return;
        var mine = build.know_picks[k.name] = build.know_picks[k.name] || {};
        for (var r = 1; r <= Math.min(t, k.ranks.length); r++) {
          var keep = picksAt(mine[r]).filter(function (v) { return v.indexOf('c:') === 0; });
          mine[r] = ['0', '1'].concat(keep);
        }
      });
      var hi = hmItem();
      if (hi) {
        build.hm_picks = build.hm_picks || {};
        var hp = build.hm_picks[hi.name] = build.hm_picks[hi.name] || {};
        for (var hr = 1; hr <= Math.min(hmVal(), hi.ranks.length); hr++) hp[hr] = ['0', '1'];
      }
      (D.combos || []).forEach(function (c) {
        if (!comboMet(c) || comboTakenElsewhere(c, null, null)) return;
        var school = c.schools[0], r = c.dots;
        var mine = build.know_picks[school] = build.know_picks[school] || {};
        mine[r] = picksAt(mine[r]).concat(['c:' + c.id]);
      });
    }
    refresh(true);
  }
  function selectAllBar(p, kinds, what) {
    if (!stMode()) return;
    p.appendChild(el('div', { class: 'st-all' }, [
      el('button', { type: 'button', class: 'act small', text: 'Select All', onclick: function () { selectAll(kinds); } }),
      el('span', { class: 'hint', text: 'Storyteller Mode: checks every ' + what + ' your dots reach.' })
    ]));
  }
  // Heritage magic picks: Option A or B per rank, a single spell (Undying Flesh), or Storyteller-written spells (Tribal Magic)
  function heritagePicks(box, from, to) {
    if (to < from) return;
    var h = heritage(), d = hmData();
    if (h.name === 'Demon') {
      build.tribal = build.tribal || {};
      var fs = el('fieldset', { class: 'rank-pick' }, [el('legend', {}, [bookLink(d ? '../rulebook/ch8.html#' + d.id : h.link, 'Tribal Magic spells')]),
        el('p', { class: 'hint', text: 'Write each rank\u2019s spell with your Storyteller. Every spell costs mana equal to its rank. The Storyteller may write them one rank at a time.' })]);
      for (var r = from; r <= to; r++) (function (r) {
        var id = 'tribal-' + r;
        var inp = el('input', { id: id, maxlength: '120', value: build.tribal[r] || '', placeholder: 'Spell name' });
        inp.addEventListener('input', function () { build.tribal[r] = inp.value; if (!inp.value.trim()) delete build.tribal[r]; refresh(false, true); });
        fs.appendChild(el('div', { class: 'field' }, [el('label', { for: id, text: 'Rank ' + r + (RANKS[r - 1] ? ': ' + RANKS[r - 1] : '') }), inp]));
      })(r);
      box.appendChild(fs);
      return;
    }
    var hi = hmItem();
    if (!hi) {
      if (d) box.appendChild(el('p', { class: 'hint' }, [hmName() + ' is a single spell with no Option A or B. Each rank improves what it can do. ', bookLink('../rulebook/ch8.html#' + d.id, 'Rank table')]));
      return;
    }
    if (h.name === 'Hyuman') box.appendChild(el('p', { class: 'hint', text: 'Hyuman: you are never locked out. Each dot gives one of its two spells, and the other can be bought with XP later.' }));
    rankPicks(box, hi, 'hm', from, Math.min(to, hi.ranks.length));
  }
  var RANKS = ['Core', 'Terrestrial', 'Aerial', 'Lunar', 'Stellar', 'Galactic', 'Cosmic'];
  function heritageSpellNames() {
    var h = heritage(); if (!h || !hmOn()) return [];
    var out = [];
    if (h.name === 'Demon') { Object.keys(build.tribal || {}).sort().forEach(function (r) { if (+r <= hmVal() && build.tribal[r]) out.push(build.tribal[r]); }); return out; }
    var hi = hmItem(); if (!hi) return [];
    var mine = (build.hm_picks || {})[hi.name] || {};
    for (var r = 1; r <= Math.min(hmVal(), hi.ranks.length); r++) picksAt(mine[r]).forEach(function (v) { var sp = hi.ranks[r - 1].spells[+v]; if (sp) out.push(sp.name); });
    return out;
  }
  function rankLabel(r) { return 'Rank ' + r.rank + ': ' + r.title; }

  // Choices for each new rank of a style (Option A or B) or a school (one of two spells)
  var PICK_STORE = { style: 'style_picks', know: 'know_picks', hm: 'hm_picks' };
  function rankPicks(box, item, kind, from, to) {
    var page = kind === 'style' ? 'ch12' : kind === 'hm' ? 'ch8' : 'ch13';
    var store = PICK_STORE[kind];
    build[store] = build[store] || {};
    var mine = build[store][item.name] = build[store][item.name] || {};
    for (var r = from; r <= to; r++) (function (r) {
      var rk = item.ranks[r - 1];
      if (!rk) return;
      var fs = el('fieldset', { class: 'rank-pick' }, [
        el('legend', {}, [bookLink('../rulebook/' + page + '.html#' + rk.id, rankLabel(rk))])
      ]);
      if (rk.default) {
        fs.appendChild(el('p', { class: 'rank-default' }, [
          el('strong', { text: 'Default: ' }),
          kind === 'style' ? bookLink('../rulebook/ch12.html#' + rk.default.id, rk.default.name) : el('span', { text: rk.default.name }),
          el('span', { class: 'hint', text: ' ' + (rk.default.note ? '(' + rk.default.note + ') ' : '') + rk.default.text })
        ]));
      }
      if (stMode()) fs.appendChild(el('p', { class: 'hint', text: 'Storyteller Mode: check as many as you like.' }));
      var opts = kind === 'style' ? [['a', 'Option A', rk.a], ['b', 'Option B', rk.b]] : rk.spells.map(function (s, i) { return [String(i), s.opt ? 'Option ' + s.opt : 'Spell', s]; });
      var combos = kind === 'know' && item.kind === 'Casting school' ? combosFor(item.name, r) : [];
      opts = opts.concat(combos.map(function (c) { return ['c:' + c.id, 'Combination', { name: c.name + ' (' + c.schools.join(' + ') + ')', id: c.id, cost: c.cost, text: c.text }, true]; }));
      opts.forEach(function (o, oi) {
        if (o[3] && !(opts[oi - 1] || [])[3]) fs.appendChild(el('p', { class: 'combo-head px', text: stMode() ? 'Combination spells:' : 'Or a combination spell instead:' }));
        var id = 'rk-' + kind + '-' + slug(item.name) + '-' + r + '-' + o[0];
        var multi = stMode();
        var input = el('input', { type: multi ? 'checkbox' : 'radio', name: 'rk-' + kind + '-' + slug(item.name) + '-' + r, id: id, value: o[0] });
        if (picksAt(mine[r]).indexOf(o[0]) >= 0) input.checked = true;
        input.addEventListener('change', function () {
          if (multi) {
            var cur = picksAt(mine[r]).filter(function (x) { return x !== o[0]; });
            if (input.checked) cur.push(o[0]);
            if (cur.length) mine[r] = cur; else delete mine[r];
          } else {
            mine[r] = o[0];
          }
          refresh(kind !== 'style');
        });
        fs.appendChild(el('div', { class: 'rank-opt' }, [
          input,
          el('label', { for: id }, [el('strong', { text: o[2].name }), kind === 'style' ? ' (' + o[1] + (o[2].use ? ', ' + o[2].use : '') + ')' : kind === 'hm' ? ' (' + o[1] + (o[2].cost ? ', ' + o[2].cost.replace(/\s*\(stays committed\)/, '').replace(/^(\d+)/, '$1 mana') : '') + ')' : (o[2].cost ? ' (' + o[2].cost + ' mana)' : ''),
            el('span', { class: 'hint rank-text', text: o[2].text })]),
          bookLink('../rulebook/' + page + '.html#' + o[2].id, 'Rules')
        ]));
      });
      box.appendChild(fs);
    })(r);
  }
  function missingPicks(item, kind, upTo, w) {
    var mine = ((build[PICK_STORE[kind]] || {})[item.name]) || {};
    if (!item.ranks) return;
    for (var r = 1; r <= upTo; r++) {
      var arr = picksAt(mine[r]);
      var broken = arr.filter(function (v) { return v.indexOf('c:') === 0; }).map(function (v) { return comboById(v.slice(2)); })
        .filter(function (cb) { return !cb || !comboMet(cb); });
      if (broken.length) {
        var cb = broken[0];
        w.push({ key: 'pick.know.' + slug(item.name) + '.' + r, text: item.name + ' Rank ' + r + ': ' + (cb ? cb.name + ' needs ' + cb.dots + ' dots in ' + cb.schools.join(', ') : 'that combination spell') + '. Pick again.' });
        continue;
      }
      if (!arr.length) w.push({ key: 'pick.' + kind + '.' + slug(item.name) + '.' + r, text: item.name + ' Rank ' + r + ': choose ' + (kind !== 'know' ? 'Option A or B.' : item.name === 'Battle Aura' ? 'one of the two techniques.' : 'one of the two spells.') });
    }
  }

  // ---------- Step 10: Combat Styles ----------
  S[10] = {
    intro: 'Your Physical column decides how many dots you spend on Combat Styles: 7 for Affinity, 5 for Standard, or 3 for Aversion. Spread them across any styles you like, up to 5 dots in one style. Every style taken here is marked P for Primary. Each dot unlocks that rank’s Default Ability, plus your choice of its Option A or Option B.',
    link: '../rulebook/ch12.html#how-styles-work',
    counter: function () { var l = styleLeft(); return [['Style dots', l === null ? '-' : l]]; },
    render: function (p) {
      build.styles = build.styles || {};
      selectAllBar(p, ['style'], 'Option A and B');
      if (skBudget('Physical') === null) p.appendChild(el('p', { class: 'note-box', text: 'Give your Physical column a designation in Step 5 first. It sets how many style dots you get.' }));
      var left = styleLeft();
      D.styles.forEach(function (s) {
        var v = styleVal(s.name);
        var card = el('div', { class: 'sk-card' + (v ? ' picked' : '') });
        card.appendChild(el('div', { class: 'sk-head' }, [
          el('div', { class: 'sk-name' }, [bookLink(s.link, s.name), v ? el('span', { class: 'pmark px', text: ' P' }) : null,
            el('span', { class: 'hint sk-meta', text: (s.weapons + '. Primary: ' + s.primary + '. Secondary: ' + s.secondary).replace(/\.*$/, '.') })]),
          dotRow(s.name, v, stMode() ? 10 : 7, 0, function (nv) { build.styles[s.name] = nv; if (!nv) delete build.styles[s.name]; refresh(true); },
            left === null ? 0 : v + Math.max(0, left))
        ]));
        if (v) rankPicks(card, s, 'style', 1, v);
        p.appendChild(card);
      });
    },
    check: function () {
      var w = [], l = styleLeft();
      if (l === null) w.push({ key: 'sty.nocol', text: 'Give your Physical column a designation in Step 5 first.' });
      else if (l > 0) w.push({ key: 'sty.left.' + l, text: l + ' style dot' + (l === 1 ? '' : 's') + ' left to place.' });
      else if (l < 0) w.push({ key: 'sty.over.' + l, text: 'You are ' + (-l) + ' style dot' + (l === -1 ? '' : 's') + ' over.' });
      D.styles.forEach(function (s) { var v = styleVal(s.name); w = w.concat(goldenRule(s.name, v)); missingPicks(s, 'style', v, w); });
      return w;
    },
    summary: function () {
      var a = D.styles.filter(function (s) { return styleVal(s.name); }).map(function (s) { return s.name.replace(/ Style$/, '') + ' ' + styleVal(s.name) + ' (P)'; });
      return a.length ? [['Combat Styles', a.join(', ')]] : [];
    }
  };

  // ---------- Step 11: Magical Knowledges ----------
  S[11] = {
    intro: 'Your Mental column decides how many dots you spend on Magical Knowledges (casting schools, Battle Aura, and Circle Magic): 7 for Affinity, 5 for Standard, or 3 for Aversion, up to 5 dots in one knowledge. Every knowledge taken here is marked P. Your Heritage Magic starts with its free dot from Step 4, and you can raise it with these dots too. For a casting school or Battle Aura, each dot gives that rank’s Default Ability and your choice of one of its two techniques. Each Heritage magic dot gives that rank’s Option A or Option B.',
    link: '../rulebook/ch13.html#learning-the-casting-schools',
    counter: function () { var l = knowLeft(); return [['Knowledge dots', l === null ? '-' : l]]; },
    render: function (p) {
      build.knows = build.knows || {};
      selectAllBar(p, ['know'], 'spell, technique, and combination spell');
      var h = heritage();
      if (h) {
        p.appendChild(el('h2', { class: 'sub-title px', text: 'Heritage Magic' }));
        var hcard = el('div', { class: 'sk-card picked' });
        var hd = hmData();
        var hlink = hd ? '../rulebook/ch8.html#' + hd.id : h.link;
        if (!hmOn()) {
          hcard.appendChild(el('p', { class: 'hint' }, ['Adaptation: your free dot is in ' + hyAdapt().slice(2) + ', shown below with your other knowledges. ', bookLink(hlink, 'Adaptation')]));
        } else if (h.name === 'Hyuman' && !hyAdapt()) {
          hcard.appendChild(el('p', { class: 'note-box', text: 'Choose where your Adaptation dot goes in Step 4 first.' }));
        } else if (h.name === 'Vampire' && !build.heritage.vpower) {
          hcard.appendChild(el('p', { class: 'note-box', text: 'Choose your Vampiric Power in Step 4 first.' }));
        } else {
          var hv = hmBase();
          hcard.appendChild(el('div', { class: 'sk-head' }, [
            el('div', { class: 'sk-name' }, [bookLink(hlink, hmName()), el('span', { class: 'pmark px', text: ' P' }),
              el('span', { class: 'hint sk-meta', text: h.name + ' Heritage Magic. The first dot is free from Step 4; each dot above it uses one knowledge dot.' })]),
            dotRow(hmName(), hv, stMode() ? 10 : 7, 1, function (nv) { build.hm_dots = Math.max(1, nv); refresh(true); },
              knowLeft() === null ? 1 : hv + Math.max(0, knowLeft()))
          ]));
          heritagePicks(hcard, 1, hmVal());
        }
        p.appendChild(hcard);
      }
      if (skBudget('Mental') === null) p.appendChild(el('p', { class: 'note-box', text: 'Give your Mental column a designation in Step 5 first. It sets how many knowledge dots you get.' }));
      var left = knowLeft();
      D.knowledges.forEach(function (k, ki) {
        var free = knowFree(k.name);
        var head = k.circle ? 'Circle Magic' : k.kind === 'Casting school' ? 'Casting Magic' : k.name;
        var prev = D.knowledges[ki - 1];
        var prevHead = prev ? (prev.circle ? 'Circle Magic' : prev.kind === 'Casting school' ? 'Casting Magic' : prev.name) : null;
        if (head !== prevHead) p.appendChild(el('h2', { class: 'sub-title px', text: head }));
        var v = knowVal(k.name) + free;
        var card = el('div', { class: 'sk-card' + (v ? ' picked' : '') });
        card.appendChild(el('div', { class: 'sk-head' }, [
          el('div', { class: 'sk-name' }, [bookLink(k.link, k.name), v ? el('span', { class: 'pmark px', text: ' P' }) : null,
            el('span', { class: 'hint sk-meta', text: (k.kind + (k.focus ? '. ' + k.focus : '') + (free ? '. 1 free dot from Hyuman Adaptation' : '')).replace(/\.+/g, '.').replace(/\.*$/, '.') })]),
          dotRow(k.name, v, stMode() ? 10 : 7, free, function (nv) { nv -= free; build.knows[k.name] = nv; if (nv <= 0) delete build.knows[k.name]; refresh(true); },
            left === null ? free : v + Math.max(0, left))
        ]));
        if (v && k.ranks) rankPicks(card, k, 'know', 1, v);
        if (v && !k.ranks) card.appendChild(el('p', { class: 'hint' }, ['Circle Magic disciplines have no spell list. What you can do at each dot is in its entry. ', bookLink(k.link, k.name + ' rules')]));
        if (k.name === 'Summoning Magic' && knowTotal(k.name) > 0) companionBox(card, 'starter_summon', 'Your First SumMonz', 'Summoning Magic at creation gives you one Rank 1 (F) SumMonz on its own card. Choose it with your Storyteller.');
        p.appendChild(card);
      });
    },
    check: function () {
      var w = [], l = knowLeft();
      if (hmOn()) { w = w.concat(goldenRule(hmName(), hmBase())); var hi = hmItem(); if (hi) missingPicks(hi, 'hm', hmBase(), w); }
      if (l === null) w.push({ key: 'kn.nocol', text: 'Give your Mental column a designation in Step 5 first.' });
      else if (l > 0) w.push({ key: 'kn.left.' + l, text: l + ' knowledge dot' + (l === 1 ? '' : 's') + ' left to place.' });
      else if (l < 0) w.push({ key: 'kn.over.' + l, text: 'You are ' + (-l) + ' knowledge dot' + (l === -1 ? '' : 's') + ' over.' });
      D.knowledges.forEach(function (k) { var v = knowVal(k.name) + knowFree(k.name); w = w.concat(goldenRule(k.name, v)); missingPicks(k, 'know', v, w); });
      return w;
    },
    summary: function () {
      var a = D.knowledges.filter(function (k) { return knowVal(k.name) + knowFree(k.name); }).map(function (k) { return k.name + ' ' + (knowVal(k.name) + knowFree(k.name)) + ' (P)'; });
      var out = a.length ? [['Magical Knowledges', a.join(', ')]] : [];
      var hs = heritageSpellNames();
      if (hs.length) out.push(['Heritage Spells', hs.join(', ')]);
      var cs = [];
      Object.keys(build.know_picks || {}).forEach(function (sc) { Object.keys(build.know_picks[sc]).forEach(function (r) {
        picksAt(build.know_picks[sc][r]).forEach(function (v) {
          if (v.indexOf('c:') === 0 && comboById(v.slice(2))) cs.push(comboById(v.slice(2)).name);
        });
      }); });
      if (cs.length) out.push(['Combination Spells', cs.join(', ')]);
      if (knowTotal('Summoning Magic') && companionText(build.starter_summon)) out.push(['First SumMonz', companionText(build.starter_summon)]);
      return out;
    }
  };

  // ---------- Step 12: Freebie Points ----------
  var fbOpen = {}; // which Step 12 groups are open, kept while you click dots
  var FB_COST = { attrs: 3, abilities: 2, styles: 4, knows: 4, backgrounds: 1, mana: 7, hm: 4 };
  function fbPoints() {
    var f = build.fb || {};
    if (f.preset === 'Custom') return Number(f.custom) || 0;
    var pr = D.freebie_presets.filter(function (x) { return x.name === (f.preset || 'Newb'); })[0];
    return pr ? pr.points : 7;
  }
  function fbSpent() {
    var f = build.fb || {}, s = 0;
    ['attrs', 'abilities', 'styles', 'knows', 'backgrounds'].forEach(function (k) {
      Object.keys(f[k] || {}).forEach(function (n) { s += (f[k][n] || 0) * FB_COST[k]; });
    });
    return s + (f.mana || 0) * FB_COST.mana + (f.hm || 0) * FB_COST.hm;
  }
  function fbLeft() { return fbPoints() - fbSpent(); }

  // A dot row where earlier dots are locked gold and freebie dots are blue
  function fbRow(label, base, kind, name, cap) {
    var f = fb();
    var extra = kind === 'mana' || kind === 'hm' ? (f[kind] || 0) : (f[kind][name] || 0);
    var max = stMode() ? 10 : 7;
    var limit = stMode() ? 10 : Math.min(cap, base + extra + Math.max(0, Math.floor(fbLeft() / FB_COST[kind])));
    var row = el('div', { class: 'dots', role: 'group', 'aria-label': label });
    for (var i = 1; i <= max; i++) (function (n) {
      var earned = n <= base, bought = n > base && n <= base + extra, out = !earned && !bought && n > limit;
      var b = el('button', {
        type: 'button',
        class: 'dot' + (earned ? ' on earned' : '') + (bought ? ' on fb' : '') + (out ? ' out' : '') + (n > 5 ? ' over5' : ''),
        'aria-label': label + ': ' + n + (n === 1 ? ' dot' : ' dots') + (earned ? ' (from earlier steps)' : bought ? ' (freebie)' : ''),
        'aria-pressed': earned || bought ? 'true' : 'false',
        disabled: earned || out ? 'disabled' : null
      });
      b.addEventListener('click', function () {
        var nx = (n === base + extra) ? extra - 1 : n - base;
        if (kind === 'mana' || kind === 'hm') f[kind] = nx; else if (nx > 0) f[kind][name] = nx; else delete f[kind][name];
        refresh(true);
      });
      row.appendChild(b);
    })(i);
    row.appendChild(el('span', { class: 'dot-n px', text: String(base + extra) }));
    return row;
  }

  S[12] = {
    intro: 'Spend your Freebie Points. Each dot costs: Attribute 3, Ability 2, Combat Style, Magical Knowledge, or Heritage Magic 4, Background 1, Mana 7. This is the only time Mana can be raised during creation. A new style or knowledge bought here is marked S for Secondary. Freebies cannot be spent on Merits, Flaws, Willpower, Fate, Sanity, or other Heritage traits, and nothing goes above 5. Gold dots are from earlier steps; blue dots are freebies.',
    link: '../rulebook/ch6.html#the-creation-process',
    counter: function () { return [['Freebie points', fbLeft()]]; },
    render: function (p) {
      var f = fb();
      selectAllBar(p, ['style', 'know'], 'option and spell');
      var presetSel = el('select', { id: 'fb-preset' });
      D.freebie_presets.forEach(function (x) {
        var o = el('option', { value: x.name, text: x.name + ' (' + x.points + ' points)' });
        if ((f.preset || 'Newb') === x.name) o.selected = true;
        presetSel.appendChild(o);
      });
      if (stMode() || f.preset === 'Custom') {
        var co = el('option', { value: 'Custom', text: 'Custom (Storyteller)' });
        if (f.preset === 'Custom') co.selected = true;
        presetSel.appendChild(co);
      }
      presetSel.addEventListener('change', function () { f.preset = presetSel.value; refresh(true); });
      var pr = D.freebie_presets.filter(function (x) { return x.name === (f.preset || 'Newb'); })[0];
      var top = el('div', { class: 'field' }, [el('label', { for: 'fb-preset', text: 'How many Freebie Points? Your Storyteller decides.' }), presetSel]);
      if (pr) top.appendChild(el('p', { class: 'hint', text: pr.note }));
      if (f.preset === 'Custom') {
        var cu = el('input', { id: 'fb-custom', type: 'number', min: '0', max: '200', value: String(f.custom || 0), disabled: stMode() ? null : 'disabled' });
        cu.addEventListener('input', function () { f.custom = Number(cu.value) || 0; refresh(); });
        top.appendChild(el('div', { class: 'field inline' }, [el('label', { for: 'fb-custom', text: 'Points' }), cu]));
      }
      p.appendChild(top);

      function group(title, open, fill) {
        var det = el('details', { class: 'pick-group' });
        if (fbOpen[title] !== undefined ? fbOpen[title] : open) det.open = true;
        det.addEventListener('toggle', function () { fbOpen[title] = det.open; });
        det.appendChild(el('summary', {}, [el('span', { class: 'px', text: title })]));
        fill(det);
        p.appendChild(det);
      }
      function line(box, name, row, extra) {
        box.appendChild(el('div', { class: 'trait fb-line' }, [el('span', { class: 'trait-name', text: name }), row]));
        if (extra) extra(box);
      }
      var anyIn = function (k) { return Object.keys(f[k]).length > 0; };
      group('Attributes (3 each)', anyIn('attrs'), function (box) {
        COLS.forEach(function (col) {
          D.attributes[col].forEach(function (a) {
            var cap = Math.min(5, (colNumber(col) === null ? 5 : colNumber(col) + (a === innateAttr() ? 1 : 0)));
            line(box, a, fbRow(a, attrVal(a), 'attrs', a, cap));
          });
        });
      });
      group('Abilities (2 each)', anyIn('abilities'), function (box) {
        GROUPS.forEach(function (g) { D.abilities[g].forEach(function (a) { line(box, a.name + ((build.pl || {})[a.name] ? ' (PL)' : ''), fbRow(a.name, abVal(a.name), 'abilities', a.name, 5)); }); });
        box.appendChild(el('p', { class: 'hint', text: 'An ability that reaches 4 dots gets its free specialty. Pick it in Step 6.' }));
      });
      group('Combat Styles (4 each)', anyIn('styles'), function (box) {
        D.styles.forEach(function (s) {
          var base = styleVal(s.name), x = fbOf('styles', s.name);
          line(box, s.name + (base ? ' (P)' : x ? ' (S)' : ''), fbRow(s.name, base, 'styles', s.name, 5), function (b) { if (x) rankPicks(b, s, 'style', base + 1, base + x); });
        });
      });
      group('Magical Knowledges (4 each)', anyIn('knows') || f.hm > 0, function (box) {
        if (hmOn()) line(box, hmName() + ' (Heritage Magic, P)', fbRow(hmName(), hmBase(), 'hm', 'hm', 5), function (b) { var x = (build.fb || {}).hm || 0; if (x) heritagePicks(b, hmBase() + 1, hmBase() + x); });
        D.knowledges.forEach(function (k) {
          var base = knowVal(k.name) + knowFree(k.name), x = fbOf('knows', k.name);
          line(box, k.name + (base ? ' (P)' : x ? ' (S)' : ''), fbRow(k.name, base, 'knows', k.name, 5), function (b) { if (x && k.ranks) rankPicks(b, k, 'know', base + 1, base + x); });
        });
      });
      group('Backgrounds (1 each)', anyIn('backgrounds'), function (box) {
        D.backgrounds.forEach(function (b) { line(box, b.name, fbRow(b.name, bgVal(b.name), 'backgrounds', b.name, 5)); });
      });
      group('Mana (7 each)', f.mana > 0, function (box) {
        line(box, 'Mana', fbRow('Mana', 1, 'mana', 'Mana', 5));
      });
    },
    check: function () {
      var w = [], l = fbLeft();
      if (l > 0) w.push({ key: 'fb.left.' + l, text: l + ' Freebie Point' + (l === 1 ? '' : 's') + ' left to spend.' });
      if (l < 0) w.push({ key: 'fb.over.' + l, text: 'You are ' + (-l) + ' Freebie Point' + (l === -1 ? '' : 's') + ' over.' });
      if ((build.fb || {}).preset && build.fb.preset !== 'Newb') w.push({ key: 'fb.preset.' + build.fb.preset, text: build.fb.preset + ' gives more than the standard 7 points. Check with your Storyteller.' });
      D.styles.forEach(function (s) { if (fbOf('styles', s.name)) missingPicks(s, 'style', styleTotal(s.name), w); });
      D.knowledges.forEach(function (k) { if (fbOf('knows', k.name)) missingPicks(k, 'know', knowTotal(k.name), w); });
      if ((build.fb || {}).hm && hmItem()) missingPicks(hmItem(), 'hm', hmVal(), w);
      return w;
    },
    summary: function () {
      var f = build.fb || {}, out = [];
      if (fbSpent()) out.push(['Freebies', fbSpent() + ' of ' + fbPoints() + ' spent']);
      var s = D.styles.filter(function (x) { return fbOf('styles', x.name) && !styleVal(x.name); }).map(function (x) { return x.name.replace(/ Style$/, '') + ' ' + fbOf('styles', x.name) + ' (S)'; })
        .concat(D.knowledges.filter(function (x) { return fbOf('knows', x.name) && !knowVal(x.name) && !knowFree(x.name); }).map(function (x) { return x.name + ' ' + fbOf('knows', x.name) + ' (S)'; }));
      if (s.length) out.push(['Secondary', s.join(', ')]);
      out.push(['Mana', String(manaTotal())]);
      return out;
    }
  };

  // ---------- Step 13: Level ----------
  function levelParts() {
    var a = 0, ab = 0, st = 0, kn = 0;
    COLS.forEach(function (c) { D.attributes[c].forEach(function (x) { a += attrTotal(x); }); });
    GROUPS.forEach(function (g) { D.abilities[g].forEach(function (x) { ab += abTotal(x.name); }); });
    D.styles.forEach(function (x) { st += styleTotal(x.name); });
    D.knowledges.forEach(function (x) { kn += knowTotal(x.name); });
    var her = hmVal();
    extraPowers().forEach(function (p) { her += xpDots('vp', p); });
    return [['Attributes', a], ['Mana', manaTotal()], ['Abilities', ab], ['Combat Styles', st], ['Magical Knowledges', kn], ['Heritage Magic', her]];
  }
  function level() { return levelParts().reduce(function (s, x) { return s + x[1]; }, 0); }
  S[13] = {
    intro: 'Your Level is the total of your dots in Attributes (including Mana), Abilities, Combat Styles, and Magical Knowledges (including Heritage Magic). Merits, Flaws, Backgrounds, Willpower, Fate, Sanity, and Virtues and Vices do not count. The Forge adds it up for you.',
    link: '../rulebook/ch6.html#the-creation-process',
    render: function (p) {
      var tbl = el('div', { class: 'level-box' });
      levelParts().forEach(function (x) { tbl.appendChild(el('div', { class: 'level-row' }, [el('span', { text: x[0] }), el('span', { class: 'px', text: String(x[1]) })])); });
      tbl.appendChild(el('div', { class: 'level-row total' }, [el('span', { class: 'px', text: 'Level' }), el('span', { class: 'px', text: String(level()) })]));
      p.appendChild(tbl);
      var todo = stillToDo();
      p.appendChild(el('p', { class: 'hint center', text: todo.length ? 'Some steps are unfinished. Finish shows you what is left.' : 'Everything is filled in. Press Finish to complete your character.' }));
    },
    check: function () { return []; },
    summary: function () { return [['Level', String(level())]]; }
  };

  // ---------- unfinished steps ----------
  // Warnings that mean "not done yet" rather than "check with your Storyteller".
  // Saving with these is fine, but the step stays marked and you are reminded again.
  var TODO_RE = /^(trope\.none|drive\.|role\.(position|style)|her\.(none|demon\.blank|innate|merit)$|cols\.unset|attr\.left|grp\.(unset|left)|spec\.[A-Z]|pl\.(none|name|few)|bg\.left|guild\.noname|note\.|sty\.(nocol|left)|kn\.(nocol|left)|pick\.|fb\.left)/;
  function isTodo(w) { return TODO_RE.test(w.key); }
  function todos(n) { return stMode() ? [] : S[n].check().filter(isTodo); }
  // every step with something left, saved or not (for the Last Check)
  function stillToDo() {
    var out = [];
    for (var n = 1; n <= BUILT; n++) if (todos(n).length) out.push(n);
    return out;
  }
  function unfinished() {
    return (forge.done || []).filter(function (n) { return n <= BUILT && todos(n).length; }).sort(function (a, b) { return a - b; });
  }

  // ---------- drawing ----------
  function drawSteps() {
    var ol = $('step-list');
    ol.textContent = '';
    STEPS.forEach(function (name, i) {
      var n = i + 1;
      var done = (forge.done || []).indexOf(n) >= 0;
      var ready = n <= BUILT;
      var todo = done && ready && todos(n).length > 0;
      var b = el('button', {
        type: 'button', class: 'step-btn' + (n === step ? ' current' : '') + (todo ? ' todo' : done ? ' done' : ''),
        'aria-current': n === step ? 'step' : null, disabled: ready ? null : 'disabled',
        title: ready ? name + (todo ? ' (unfinished)' : '') : name + ' (coming soon)'
      }, [el('span', { class: 'step-n', text: String(n) + (todo ? '!' : '') }), el('span', { class: 'step-name', text: name })]);
      if (ready) b.addEventListener('click', function () { go(n); });
      ol.appendChild(el('li', {}, [b]));
    });
  }

  function drawCounter() {
    var c = $('counter');
    var mini = $('counter-mini');
    var f = S[step] && S[step].counter;
    mini.textContent = '';
    mini.hidden = !f;
    if (f) f().forEach(function (x) {
      mini.appendChild(el('span', { class: 'mini-row' + (x[1] === 0 ? ' zero' : x[1] < 0 ? ' over' : '') }, [
        x[0] + ' ', el('b', { class: 'px', text: String(x[1]) })
      ]));
    });
    if (!f) { c.hidden = true; return; }
    c.hidden = false;
    c.textContent = '';
    c.appendChild(el('div', { class: 'px counter-title', text: 'Left to Place' }));
    f().forEach(function (x) {
      c.appendChild(el('div', { class: 'counter-row' + (x[1] === 0 ? ' zero' : x[1] < 0 ? ' over' : '') }, [
        el('span', { text: x[0] }), el('span', { class: 'px counter-n', text: String(x[1]) })
      ]));
    });
  }

  function drawSoFar() {
    var dl = $('sofar');
    dl.textContent = '';
    dl.appendChild(el('dt', { text: 'Name' }));
    dl.appendChild(el('dd', { text: ch.name }));
    for (var n = 1; n <= BUILT; n++) {
      S[n].summary().forEach(function (r) {
        dl.appendChild(el('dt', { text: r[0] }));
        dl.appendChild(el('dd', { text: r[1] }));
      });
    }
  }

  function drawStep() {
    var p = $('step-panel');
    p.textContent = '';
    var s = S[step];
    if (me && me.is_admin) {
      var stId = 'st-mode';
      var stBox = el('input', { type: 'checkbox', id: stId });
      if (forge.st) stBox.checked = true;
      stBox.addEventListener('change', function () { forge.st = stBox.checked; refresh(true); });
      p.appendChild(el('div', { class: 'st-switch' + (forge.st ? ' on' : '') }, [
        el('label', { for: stId }, [stBox, el('span', { class: 'px', text: ' Storyteller Mode' })]),
        el('span', { class: 'hint', text: forge.st ? 'Up to 10 dots, Mana to 20, custom Health boxes, no rule warnings.' : 'Only you can see this.' })
      ]));
    }
    p.appendChild(el('div', { class: 'kicker', text: 'Step ' + step + ' of 13' }));
    p.appendChild(el('h1', { text: STEPS[step - 1] }));
    p.appendChild(el('p', { class: 'step-intro' }, [s.intro + ' ', bookLink(s.link, 'Full rules')]));
    s.render(p);
    $('btn-back').disabled = step === 1;
    $('btn-next').textContent = step === BUILT ? 'Finish' : 'Next';
    drawSteps();
    drawCounter();
    drawSoFar();
  }

  // redraw everything (full) or just the side panels
  function refresh(full, soft) {
    if (full) {
      var y = window.scrollY;
      drawStep();
      window.scrollTo(0, y);
    } else {
      drawCounter();
      drawSoFar();
      updateRole();
    }
  }

  function go(n) {
    step = n;
    drawStep();
    var top = $('step-panel').getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo(0, Math.max(0, top));
  }

  // Money on hand (Chapter 14 coins)
  var COINS = [['sc', 'Small Copper', 0.1], ['lc', 'Large Copper', 1], ['ss', 'Small Silver', 10], ['ls', 'Large Silver', 100], ['sg', 'Small Gold', 1000], ['lg', 'Large Gold', 10000], ['kg', 'King\u2019s Gold', 100000]];
  // Chapter 14 Starting Funds by Resources dots
  var START_FUNDS = { 0: { lc: 5 }, 1: { ls: 3 }, 2: { sg: 1 }, 3: { sg: 2 }, 4: { sg: 3 }, 5: { lg: 2 }, 6: { lg: 3 }, 7: { kg: 1 } };
  function startMoney() { return Object.assign({}, START_FUNDS[Math.min(7, bgVal('Resources'))] || {}); }
  function moneyText(m) {
    return COINS.filter(function (c) { return (m[c[0]] || 0) > 0; }).map(function (c) { return m[c[0]] + ' ' + c[1]; }).join(', ');
  }
  window.TerranaCoins = COINS;

  // ---------- sheet snapshot ----------
  // Every value the Character Sheet page needs, keyed by the sheet's data-field
  // names (Character Sheet v9.7). Numbers fill dot rows, true ticks a box.
  function sheetView() {
    var v = {}, k = function (s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); };
    var h = heritage();
    v['char.name'] = ch.name || '';
    v['char.player'] = (me && me.username) || '';
    v['char.trope'] = build.trope || '';
    var r = build.role || {};
    v['char.role'] = ((r.position || '') + ' ' + (r.style || '')).trim();
    var drives = Object.keys(build.drives || {}).map(function (x) { return build.drives[x]; }).filter(Boolean);
    v['char.drive'] = drives.join(', ');
    v['char.heritage'] = v['bio.heritage'] = h ? h.name : '';
    v['char.level'] = String(level());
    v['bio.name'] = ch.name || '';
    COLS.forEach(function (c) {
      if (colNumber(c)) v['attr_group.' + k(c)] = String(colNumber(c));
      D.attributes[c].forEach(function (a) { v['attr.' + k(a)] = attrTotal(a); });
    });
    GROUPS.forEach(function (g) {
      var n = (build.ab_groups || {})[g];
      if (n) v['ability_group.' + k(g)] = String(n);
      D.abilities[g].forEach(function (a) {
        var key = 'ability.' + k(a.name);
        v[key] = abTotal(a.name);
        if ((build.pl || {})[a.name]) v[key + '.mark'] = true;
        var sp = specList(a.name).map(function (x, i) { return x === OTHER ? ((build.spec_other || {})[a.name + '|' + i] || '') : x; })
          .filter(function (x) { return x && x.trim(); });
        if ((build.pl || {})[a.name]) sp.unshift('PL');
        if (sp.length) v[key + '.specialty'] = sp.join(', ');
      });
    });
    // Merits, Flaws, Backgrounds: row 1 is Resources
    v['merit.1'] = bgVal('Resources');
    var rows = [];
    D.backgrounds.forEach(function (b) {
      if (b.name === 'Resources' || !bgVal(b.name)) return;
      var who = ((build.bg_names || {})[b.name] || '').trim();
      rows.push([b.name + (who ? ' (' + who + ')' : ''), bgVal(b.name)]);
    });
    [['merits', D.merits, ''], ['flaws', D.flaws, 'Flaw: ']].forEach(function (g) {
      Object.keys(build[g[0]] || {}).forEach(function (n) {
        var m = byName(g[1], n), val = build[g[0]][n], label = n;
        if (m && m.options && String(val).charAt(0) === 'n') label += ' (' + m.options[Number(String(val).slice(1))].name + ')';
        var dots = m && m.cost && m.cost.kind === 'per_dot' ? Number(val) : (isFinite(Number(val)) ? Number(val) : (m && m.cost && m.cost.cost) || 0);
        rows.push([g[2] + label, dots]);
      });
    });
    rows.slice(0, 9).forEach(function (x, i) { v['merit.' + (i + 2) + '.name'] = x[0]; v['merit.' + (i + 2)] = x[1] || 0; });
    (build.guilds || []).filter(function (g) { return g && g.name; }).slice(0, 6).forEach(function (g, i) { v['guild.' + (i + 1) + '.name'] = g.name; v['guild.' + (i + 1)] = g.dots || 0; });
    // Combat Styles and Magical Knowledges
    var styles = D.styles.filter(function (x) { return styleTotal(x.name); });
    styles.slice(0, 10).forEach(function (x, i) { v['style.' + (i + 1) + '.name'] = x.name; v['style.' + (i + 1)] = styleTotal(x.name); });
    var knows = [];
    if (hmOn()) knows.push({ name: hmName() + ' (Heritage)', dots: hmVal(), hm: true });
    D.knowledges.forEach(function (x) { if (knowTotal(x.name)) knows.push({ name: x.name, dots: knowTotal(x.name), item: x }); });
    knows.slice(0, 10).forEach(function (x, i) { v['knowledge.' + (i + 1) + '.name'] = x.name; v['knowledge.' + (i + 1)] = x.dots; });
    // Detail cards: each style or knowledge with its picks per rank
    var cards = [], spells = [];
    styles.forEach(function (st) {
      var mine = (build.style_picks || {})[st.name] || {};
      var ranks = {};
      for (var r = 1; r <= Math.min(styleTotal(st.name), 7); r++) {
        var rk = st.ranks[r - 1]; if (!rk) continue;
        var ps = picksAt(mine[r]).map(function (p) { return (rk[p] || {}).name; }).filter(Boolean);
        ranks[r] = [rk.default ? rk.default.name : ''].concat(ps).filter(Boolean).join(' + ');
      }
      cards.push({ name: st.name, tier: styleVal(st.name) ? 'Primary' : 'Secondary', pool: st.primary + ' / ' + st.secondary, ranks: ranks });
    });
    function knowCard(name, item, tier, store, upTo, school) {
      var mine = (build[store] || {})[item.name] || {}, ranks = {};
      for (var r = 1; r <= Math.min(upTo, item.ranks.length); r++) {
        var rk = item.ranks[r - 1];
        var ps = picksAt(mine[r]).map(function (p) {
          if (p.indexOf('c:') === 0) { var cb = comboById(p.slice(2)); if (cb) spells.push([cb.name, cb.schools.join('+'), cb.dots, cb.cost]); return cb ? cb.name : ''; }
          var sp = rk.spells[+p]; if (sp) spells.push([sp.name, school, r, (sp.cost || '').replace(/\s*\(.*$/, '').split(',')[0]]);
          return sp ? sp.name : '';
        }).filter(Boolean);
        ranks[r] = [rk.default ? rk.default.name : ''].concat(ps).filter(Boolean).join(' + ');
      }
      cards.push({ name: name, tier: tier, pool: '', ranks: ranks });
    }
    var hi = hmItem();
    if (hi) knowCard(hmName() + ' (Heritage)', hi, 'Primary', 'hm_picks', hmVal(), hmName());
    D.knowledges.forEach(function (x) {
      var t = knowTotal(x.name); if (!t) return;
      if (x.ranks) knowCard(x.name, x, knowVal(x.name) + knowFree(x.name) ? 'Primary' : 'Secondary', 'know_picks', t, x.name);
      else cards.push({ name: x.name, tier: knowVal(x.name) + knowFree(x.name) ? 'Primary' : 'Secondary', pool: '', ranks: {} });
    });
    cards.slice(0, 8).forEach(function (c, i) {
      var p = 'detail.' + (i + 1) + '.';
      v[p + 'name'] = c.name; v[p + 'tier'] = c.tier; if (c.pool) v[p + 'pool'] = c.pool;
      Object.keys(c.ranks).forEach(function (r) { v[p + 'rank.' + r] = c.ranks[r]; });
    });
    spells.slice(0, 10).forEach(function (x, i) {
      var p = 'spell.' + (i + 1) + '.';
      v[p + 'name'] = x[0]; v[p + 'school'] = x[1]; v[p + 'rank'] = String(x[2]); if (x[3]) v[p + 'mana'] = String(x[3]);
    });
    // Willpower, Fate, Sanity, Mana, Virtues and Vices
    v['willpower.dots'] = statVal('Willpower'); v['fate.dots'] = statVal('Fate'); v['sanity.dots'] = statVal('Sanity');
    v['mana.dots'] = manaTotal();
    var cmv = characterModel();
    v['mana.pool.max'] = v['mana.pool.current'] = String(cmv.mana.pool);
    v['mana.per_turn.max'] = v['mana.per_turn.current'] = String(cmv.mana.mt);
    if (cmv.mana.held) v['mana.committed'] = String(cmv.mana.held);
    var POS = { virtue2: 1, virtue1: 2, central: 3, vice1: 4, vice2: 5 };
    D.scales.forEach(function (sc) { v['vv.' + k(sc.name)] = POS[(build.scales || {})[slug(sc.name)] || 'central']; });
    // Companions
    var sm = [];
    if (knowTotal('Summoning Magic') && companionText(build.starter_summon)) sm.push([(build.starter_summon.name || 'SumMonz'), build.starter_summon.kind === 'spirit' ? 'Spirit' : 'Fiend', 'F', companionText(build.starter_summon)]);
    if ((build.merits || {})['Familiar Bond'] && companionText(build.familiar)) sm.push([(build.familiar.name || 'Familiar'), 'Familiar', 'F', companionText(build.familiar)]);
    sm.forEach(function (x, i) { var p = 'summon.' + (i + 1) + '.'; v[p + 'name'] = x[0]; v[p + 'type'] = x[1]; v[p + 'dots'] = x[2]; v[p + 'notes'] = x[3]; });
    if (build.pl_occupation || build.pl_job) v['profile.past_life'] = build.pl_occupation || build.pl_job;
    // Equipment, belt, money, and notes from the character page
    var gw = (EXTRA.gear || {}).worn || {};
    ['headgear', 'torso', 'left_arm', 'right_arm', 'legs', 'footwear', 'main_weapon', 'side_arm', 'alt_weapons'].forEach(function (x) {
      var it = gw[x]; if (!it) return;
      if (typeof it === 'string') { v['equip.' + x] = it; return; }
      if (it.name) v['equip.' + x] = it.name + (Number(it.bonus) ? ' (' + (it.bonus > 0 ? '+' : '') + it.bonus + ' ' + (it.which || it.cat || '') + ')' : '');
    });
    var carried = ((EXTRA.gear || {}).carried || []).map(function (i) { return (i.qty > 1 ? i.qty + ' ' : '') + i.name; }).filter(Boolean);
    if (carried.length) v['equip.stowed'] = carried.join(', ');
    ((EXTRA.gear || {}).belt || []).forEach(function (b2, i) { if (b2 && i < 7) v['belt.' + (i + 1)] = typeof b2 === 'string' ? b2 : (b2.name || b2.type || ''); });
    var mn = moneyText(EXTRA.money || startMoney());
    if (mn) v['resources.funds'] = mn;
    var nt = (EXTRA.gear || {}).notes || {};
    ['quests', 'npcs', 'locations', 'lore', 'leads', 'general'].forEach(function (x) { if (nt[x]) v['notes.' + x] = nt[x]; });
    if (carried.length || ((EXTRA.gear || {}).stash || []).length) v['profile.inventory'] = carried.concat(((EXTRA.gear || {}).stash || []).map(function (i) { return (i.qty > 1 ? i.qty + ' ' : '') + i.name + ' (stash)'; })).join(', ');
    return v;
  }

  // ---------- saving ----------
  async function save(nextStep) {
    var sheet = Object.assign({}, ch.sheet || {});
    forge.step = nextStep;
    forge.done = forge.done || [];
    if (forge.done.indexOf(step) < 0) forge.done.push(step);
    forge.unfinished = forge.complete ? stillToDo() : unfinished();
    sheet.build = build;
    sheet.forge = forge;
    try { sheet.view = sheetView(); } catch (e) { console.warn('sheet view', e); }
    var res = await db.from('characters').update({ sheet: sheet }).eq('id', ch.id).select('sheet, updated_at').single();
    if (res.error) throw res.error;
    ch.sheet = res.data.sheet;
  }

  function openSave() {
    var all = stMode() ? [] : S[step].check();
    var todo = all.filter(isTodo);
    var warn = all.filter(function (w) { return !isTodo(w) && (forge.ok || []).indexOf(w.key) < 0; });
    var box = $('save-warnings');
    box.textContent = '';
    if (todo.length) {
      box.appendChild(el('p', { class: 'ff-warn-head', text: 'Not finished yet:' }));
      var tl = el('ul', { class: 'ff-warn' });
      todo.forEach(function (w) { tl.appendChild(el('li', { text: w.text })); });
      box.appendChild(tl);
      box.appendChild(el('p', { class: 'ff-note', text: 'You can save now and come back. This step gets a ! in the tracker, and you will get one last reminder before you finish.' }));
    }
    if (warn.length) {
      box.appendChild(el('p', { class: 'ff-warn-head', text: 'Something is amiss:' }));
      var ul = el('ul', { class: 'ff-warn' });
      warn.forEach(function (w) { ul.appendChild(el('li', { text: w.text })); });
      box.appendChild(ul);
      box.appendChild(el('p', { class: 'ff-note', text: 'Ask your Storyteller and verify with them you’re all good. Choosing Yes saves anyway and will not ask about these again.' }));
    }
    if (!todo.length && !warn.length) {
      box.appendChild(el('p', { class: 'ff-ok', text: 'Everything checks out for this step.' }));
    }
    var dlg = $('dlg-save');
    dlg._warn = warn;
    dlg.showModal();
    $('save-yes').focus();
  }

  // ---------- Experience after creation ----------
  // sheet.xp = { log: [{ id, d, amt, note }], buys: [{ id, d, kind, name, cost, label, pick }] }
  // kinds: attr, ab, spec, style, know, hm, mana (one dot each), opt (an unchosen option), combo
  var DOT_KINDS = { attr: 1, ab: 1, style: 1, know: 1, hm: 1, mana: 1, vp: 1 };
  // Vampires: the other Vampiric Powers, bought with XP after creation
  function extraPowers() { var h = heritage(); return h && h.name === 'Vampire' ? VPOWERS.filter(function (p) { return p !== build.heritage.vpower && xpDots('vp', p) > 0; }) : []; }
  function vpItem(p) { var d = (D.heritage_magic || {})[p]; return d && d.ranks ? { name: p, ranks: d.ranks, link: '../rulebook/ch8.html#' + d.id } : null; }
  function xpDots(kind, name) {
    var n = 0;
    (XPS.buys || []).forEach(function (b) { if (b.kind === kind && (b.name || '') === (name || '')) n++; });
    return n;
  }
  function xpEarned() { return (XPS.log || []).reduce(function (s, x) { return s + (Number(x.amt) || 0); }, 0); }
  function xpSpent() { return (XPS.buys || []).reduce(function (s, x) { return s + (Number(x.cost) || 0); }, 0); }
  function xpCap(kind) { var st = !!(me && me.is_admin); return kind === 'mana' ? (st ? 20 : 10) : (st ? 10 : 7); }
  function styleItem(n) { return byName(D.styles, n); }
  function knowItem(n) { return byName(D.knowledges, n); }
  // What the next purchase of each trait costs, by the Chapter 6 table
  function xpCost(kind, name) {
    if (kind === 'attr') { var a = attrTotal(name) + 1; return { next: a, cost: a * 5 }; }
    if (kind === 'ab') { var b = abTotal(name) + 1; return { next: b, cost: b * ((build.pl || {})[name] ? 2 : 3) }; }
    if (kind === 'style') { var c = styleTotal(name) + 1; return { next: c, cost: c * (styleVal(name) ? 5 : 6) }; }
    if (kind === 'know') { var k = knowTotal(name) + 1; return { next: k, cost: k * (knowVal(name) + knowFree(name) ? 5 : 6) }; }
    if (kind === 'hm') { var h = hmVal() + 1; return { next: h, cost: h * 5 }; }
    if (kind === 'mana') { var m = manaTotal() + 1; return { next: m, cost: m * 7 }; }
    if (kind === 'vp') { var v = xpDots('vp', name) + 1; return { next: v, cost: v * 5 }; }
    if (kind === 'spec') return { next: specList(name).length + 1, cost: 5 };
    return null;
  }
  function xpCurrent(kind, name) {
    return kind === 'attr' ? attrTotal(name) : kind === 'ab' ? abTotal(name) : kind === 'style' ? styleTotal(name)
      : kind === 'know' ? knowTotal(name) : kind === 'hm' ? hmVal() : kind === 'mana' ? manaTotal() : kind === 'vp' ? xpDots('vp', name) : 0;
  }
  function pickStoreFor(kind) { return kind === 'style' ? 'style_picks' : kind === 'hm' || kind === 'vp' ? 'hm_picks' : 'know_picks'; }
  function addPick(store, item, rank, val) {
    build[store] = build[store] || {};
    var mine = build[store][item] = build[store][item] || {};
    var cur = picksAt(mine[rank]);
    if (cur.indexOf(String(val)) < 0) cur.push(String(val));
    mine[rank] = cur.length === 1 ? cur[0] : cur;
  }
  function dropPick(store, item, rank, val) {
    var mine = ((build[store] || {})[item]) || {};
    var cur = picksAt(mine[rank]).filter(function (x) { return x !== String(val); });
    if (cur.length) mine[rank] = cur.length === 1 ? cur[0] : cur; else delete mine[rank];
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  // Every purchase the character can make right now
  function xpOffers() {
    var out = [], unspent = xpEarned() - xpSpent();
    function dot(kind, name, label, group, extra) {
      var c = xpCost(kind, name), cur = xpCurrent(kind, name);
      if (cur >= xpCap(kind)) return;
      out.push(Object.assign({ kind: kind, name: name, label: label, group: group, cur: cur, next: c.next, cost: c.cost, ok: c.cost <= unspent }, extra || {}));
    }
    COLS.forEach(function (c) { D.attributes[c].forEach(function (a) { dot('attr', a, a, 'Attributes'); }); });
    GROUPS.forEach(function (g) { D.abilities[g].forEach(function (a) { dot('ab', a.name, a.name + ((build.pl || {})[a.name] ? ' (PL)' : ''), 'Abilities'); }); });
    GROUPS.forEach(function (g) { D.abilities[g].forEach(function (a) {
      if (specList(a.name).length < 3) out.push({ kind: 'spec', name: a.name, label: a.name + ' specialty', group: 'Specialties', cur: specList(a.name).length, next: specList(a.name).length + 1, cost: 5, ok: 5 <= unspent, needsText: true, suggestions: D.specialties[a.name] || [] });
    }); });
    D.styles.forEach(function (st) { dot('style', st.name, st.name, 'Combat Styles', { ranks: st.ranks, tier: styleVal(st.name) ? 'P' : 'S' }); });
    if (hmOn() && !(heritage().name === 'Vampire' && !build.heritage.vpower)) {
      var hi = hmItem();
      dot('hm', '', hmName() + ' (Heritage)', 'Magical Knowledges', { ranks: hi ? hi.ranks : null, tier: 'P', itemName: hmName() });
    }
    if (heritage() && heritage().name === 'Vampire') VPOWERS.forEach(function (p) {
      if (p === build.heritage.vpower) return;
      var vi = vpItem(p);
      dot('vp', p, p + ' (Vampiric Power)', 'Magical Knowledges', { ranks: vi ? vi.ranks : null, tier: 'P' });
    });
    D.knowledges.forEach(function (k) { dot('know', k.name, k.name, 'Magical Knowledges', { ranks: k.ranks, tier: knowVal(k.name) + knowFree(k.name) ? 'P' : 'S' }); });
    dot('mana', '', 'Mana', 'Mana');
    // Options not picked at ranks you already have: Rank x2
    D.styles.forEach(function (st) {
      var t = styleTotal(st.name), mine = (build.style_picks || {})[st.name] || {};
      for (var r = 1; r <= Math.min(t, st.ranks.length); r++) {
        var have = picksAt(mine[r]);
        if (!have.length) continue;
        ['a', 'b'].forEach(function (o) { if (have.indexOf(o) < 0) out.push({ kind: 'opt', src: 'style', name: st.name, rank: r, pick: o, label: st.name + ' Rank ' + r + ': ' + st.ranks[r - 1][o].name, group: 'Options You Did Not Pick', cost: r * 2, ok: r * 2 <= unspent }); });
      }
    });
    D.knowledges.forEach(function (k) {
      if (!k.ranks) return;
      var t = knowTotal(k.name), mine = (build.know_picks || {})[k.name] || {};
      for (var r = 1; r <= Math.min(t, k.ranks.length); r++) {
        var have = picksAt(mine[r]).filter(function (x) { return x.indexOf('c:') !== 0; });
        if (!have.length && !picksAt(mine[r]).length) continue;
        ['0', '1'].forEach(function (o) { var sp = k.ranks[r - 1].spells[+o]; if (sp && have.indexOf(o) < 0) out.push({ kind: 'opt', src: 'know', name: k.name, rank: r, pick: o, label: k.name + ' Rank ' + r + ': ' + sp.name, group: 'Options You Did Not Pick', cost: r * 2, ok: r * 2 <= unspent }); });
      }
    });
    var hi2 = hmItem();
    if (hi2 && heritage() && heritage().name === 'Hyuman') {
      var hp = (build.hm_picks || {})[hi2.name] || {};
      for (var r2 = 1; r2 <= Math.min(hmVal(), hi2.ranks.length); r2++) {
        var hv = picksAt(hp[r2]);
        if (!hv.length) continue;
        ['0', '1'].forEach(function (o) { if (hv.indexOf(o) < 0) out.push({ kind: 'opt', src: 'hm', name: hi2.name, rank: r2, pick: o, label: hi2.name + ' Rank ' + r2 + ': ' + hi2.ranks[r2 - 1].spells[+o].name + ' (Hyuman)', group: 'Options You Did Not Pick', cost: r2 * 2, ok: r2 * 2 <= unspent }); });
      }
    }
    // Combination spells you qualify for and don't know: Rank x2 per school
    var known = {};
    Object.keys(build.know_picks || {}).forEach(function (sc) { Object.keys(build.know_picks[sc]).forEach(function (r) { picksAt(build.know_picks[sc][r]).forEach(function (v) { if (v.indexOf('c:') === 0) known[v.slice(2)] = 1; }); }); });
    (D.combos || []).forEach(function (c) {
      if (known[c.id] || !comboMet(c)) return;
      var cost = c.dots * 2 * c.schools.length;
      out.push({ kind: 'combo', name: c.id, label: c.name + ' (' + c.schools.join(' + ') + ')', group: 'Combination Spells', cost: cost, ok: cost <= unspent, text: c.text });
    });
    return out;
  }
  // Make a purchase. o is an offer from xpOffers(); extra = { pick, text }
  function xpBuy(o, extra) {
    extra = extra || {};
    var unspent = xpEarned() - xpSpent();
    var st = !!(me && me.is_admin);
    if (o.cost > unspent && !st) throw new Error('Not enough XP. This costs ' + o.cost + ' and you have ' + unspent + '.');
    var b = { id: newId(), d: new Date().toISOString(), kind: o.kind, name: o.name || '', cost: o.cost, label: o.label };
    if (o.kind === 'spec') {
      var t = (extra.text || '').trim();
      if (!t) throw new Error('Name the specialty first.');
      build.specialties = build.specialties || {};
      var list = specList(o.name); list.push(t); build.specialties[o.name] = list;
      b.text = t; b.label = o.name + ': ' + t;
    } else if (DOT_KINDS[o.kind]) {
      b.label = o.label + ' ' + o.cur + ' to ' + o.next;
      if (o.ranks && o.ranks[o.next - 1]) {
        if (extra.pick === undefined || extra.pick === null || extra.pick === '') throw new Error('Choose the option for Rank ' + o.next + '.');
        var store = pickStoreFor(o.kind), item = o.kind === 'hm' ? hmName() : o.name;
        if (o.kind === 'hm' && heritage() && heritage().name === 'Vampire' && !build.heritage.vpower) throw new Error('Choose your Vampiric Power in the Forge (Step 4) first.');
        addPick(store, item, o.next, extra.pick);
        b.pick = { store: store, item: item, rank: o.next, val: String(extra.pick) };
      }
    } else if (o.kind === 'opt') {
      var s2 = pickStoreFor(o.src);
      addPick(s2, o.name, o.rank, o.pick);
      b.pick = { store: s2, item: o.name, rank: o.rank, val: String(o.pick) };
    } else if (o.kind === 'combo') {
      var c = comboById(o.name);
      addPick('know_picks', c.schools[0], c.dots, 'c:' + c.id);
      b.pick = { store: 'know_picks', item: c.schools[0], rank: c.dots, val: 'c:' + c.id };
    }
    XPS.buys = XPS.buys || [];
    XPS.buys.push(b);
    return b;
  }
  // Undo a purchase (only the newest one, so later picks never point at a missing dot)
  function xpUndo(id) {
    var buys = XPS.buys || [];
    var last = buys[buys.length - 1];
    if (!last || last.id !== id) throw new Error('Only the most recent purchase can be undone.');
    if (last.pick) dropPick(last.pick.store, last.pick.item, last.pick.rank, last.pick.val);
    if (last.kind === 'spec') {
      var l = specList(last.name), i = l.lastIndexOf(last.text);
      if (i >= 0) { l.splice(i, 1); build.specialties[last.name] = l; }
    }
    buys.pop();
  }
  function xpAward(amt, note) {
    amt = Math.round(Number(amt));
    if (!amt) throw new Error('Enter how much XP.');
    XPS.log = XPS.log || [];
    XPS.log.push({ id: newId(), d: new Date().toISOString(), amt: amt, note: (note || '').trim().slice(0, 200) });
  }
  function xpRemoveAward(id) {
    var l = XPS.log || [], i = l.map(function (x) { return x.id; }).indexOf(id);
    if (i < 0) return;
    var after = l.slice(0, i).concat(l.slice(i + 1));
    var earned = after.reduce(function (s, x) { return s + (Number(x.amt) || 0); }, 0);
    if (earned < xpSpent()) throw new Error('That XP is already spent. Undo purchases first.');
    XPS.log = after;
  }

  // Mana Pool = (all magic: Magic + Circle Magic + every Magical Knowledge dot) x Mana
  function allMagicDots() {
    var n = abTotal('Magic') + abTotal('Circle Magic');
    D.knowledges.forEach(function (x) { n += knowTotal(x.name); });
    n += hmVal();
    extraPowers().forEach(function (p) { n += xpDots('vp', p); });
    return n;
  }
  function wornList() {
    var w = (EXTRA.gear || {}).worn || {};
    return Object.keys(w).map(function (k) { var v = w[k]; return typeof v === 'string' ? { slot: k, name: v } : Object.assign({ slot: k }, v || {}); }).filter(function (x) { return x.name; });
  }
  // Every attuned spell the character knows, with its held mana and what it does
  function attunables() {
    var out = [];
    function scan(item, dots, store, school, kind) {
      if (!item || !item.ranks) return;
      var mine = (build[store] || {})[item.name] || {};
      for (var r = 1; r <= Math.min(dots, item.ranks.length); r++) picksAt(mine[r]).forEach(function (v) {
        var sp = item.ranks[r - 1].spells[+v];
        if (sp && /attuned/i.test((sp.cost || '') + ' ' + (sp.type || ''))) out.push({ id: sp.id, name: sp.name, school: school, rank: r, mana: firstInt(sp.cost), dots: dots, effect: sp.effect || sp.text || '', kind: kind });
      });
    }
    D.knowledges.forEach(function (k) { scan(k, knowTotal(k.name), 'know_picks', k.name, 'know'); });
    var hi = hmItem(); if (hi) scan(hi, hmVal(), 'hm_picks', hi.name, 'hm');
    extraPowers().forEach(function (p) { scan(vpItem(p), xpDots('vp', p), 'hm_picks', p, 'hm'); });
    return out;
  }
  // Modifiers from worn gear and from attuned spells that are switched on
  function modifiers() {
    var m = { attr: {}, ab: {}, dots: {}, bdt: 0, init: 0, move: 0, pool: 0, mt: 0, attack: 0, damage: 0, defense: 0, doubleBdt: false, moveX2: false, notes: [], held: 0, active: [], boxes: { b: 0, l: 0, a: 0 } };
    function add(map, k, v) { map[k] = (map[k] || 0) + v; }
    wornList().forEach(function (it) {
      var b = Number(it.bonus) || 0; if (!b) return;
      var c = it.cat || '', w = it.which || '';
      if (c === 'Attribute' && w) add(m.attr, w, b);
      else if (c === 'Ability' && w) add(m.ab, w, b);
      else if ((c === 'Combat Style' || c === 'Magic') && w) add(m.dots, w, b);
      else if (c === 'Armor') m.bdt += b;
      else if (c === 'Initiative') m.init += b;
      else if (c === 'Movement') m.move += b;
      else if (c === 'Mana Pool') m.pool += b;
      else if (c === 'Max Mana per Turn') m.mt += b;
      else if (c === 'Attack') m.attack += b;
      else if (c === 'Damage') m.damage += b;
      else if (c === 'Defense') m.defense += b;
      else if (c === 'Bashing boxes') m.boxes.b += b;
      else if (c === 'Lethal boxes') m.boxes.l += b;
      else if (c === 'Aggravated boxes') m.boxes.a += b;
    });
    var on = EXTRA.attuned || {};
    attunables().forEach(function (a) {
      if (!on[a.id]) return;
      var d = a.dots, half = Math.ceil(d / 2), e = a.effect, fx = [];
      m.held += a.mana;
      if (/move one extra zone/i.test(e)) { m.move += 1; fx.push('+1 Movement' + (/flying/i.test(e) ? ' while flying' : '')); }
      if (/gain Armor equal to half your Heritage dots/i.test(e) || /add half your Heritage dots, rounded up, to your BDT/i.test(e)) { m.bdt += half; fx.push('+' + half + ' BDT'); }
      else if (/gain Armor equal to your Heritage dots/i.test(e) || /add your Heritage dots to your BDT/i.test(e)) { m.bdt += d; fx.push('+' + d + ' BDT'); }
      if (/Move is reduced by 1/i.test(e)) { m.move -= 1; fx.push('-1 Movement'); }
      var ad = e.match(/add (\d) to (Strength|Dexterity|Fortitude)( and (Strength|Dexterity|Fortitude))?/i);
      if (ad && !/your choice of/i.test(e)) { add(m.attr, ad[2], +ad[1]); if (ad[4]) add(m.attr, ad[4], +ad[1]); fx.push('+' + ad[1] + ' ' + ad[2] + (ad[4] ? ' and ' + ad[4] : '')); }
      if (/double your BDT|BDT doubles/i.test(e)) { m.doubleBdt = true; fx.push('BDT doubled'); }
      if (/double your normal movement/i.test(e)) { m.moveX2 = true; fx.push('flying at double movement'); }
      var hb, re = /(\d+|one|two|three) (?:extra |additional |more )?(Bashing|Lethal|Aggravated)(?: health)? box(?:es)?/ig, W = { one: 1, two: 2, three: 3 };
      while ((hb = re.exec(e))) { var nb = W[hb[1].toLowerCase()] || +hb[1]; m.boxes[hb[2][0].toLowerCase()] += nb; fx.push('+' + nb + ' ' + hb[2] + ' box' + (nb === 1 ? '' : 'es')); }
      m.active.push({ id: a.id, name: a.name, school: a.school, mana: a.mana, effects: fx, effect: e });
    });
    return m;
  }

  // ---------- Character model for the website character page ----------
  function moveZones(d) { return d >= 7 ? 3 : d >= 5 ? 2 : 1; }
  function characterModel() {
    var h = heritage(), r = build.role || {};
    var POSL = { virtue2: 'High Virtue', virtue1: 'Low Virtue', central: 'Central', vice1: 'Low Vice', vice2: 'High Vice' };
    var m = {
      name: ch.name, player: (me && me.username) || '', level: level(), levelParts: levelParts(),
      trope: build.trope ? byName(D.tropes, build.trope) : null,
      role: ((r.position || '') + ' ' + (r.style || '')).trim(),
      scales: D.scales.map(function (sc) {
        var v = (build.scales || {})[slug(sc.name)] || 'central';
        var side = /^virtue/.test(v) ? sc.virtue : /^vice/.test(v) ? sc.vice : '';
        return { name: sc.name, pos: POSL[v], side: side, high: /2$/.test(v), drive: (build.drives || {})[slug(sc.name)] || '', link: sc.link };
      }),
      heritage: h ? { name: h.name, link: h.link, rare: h.rare, innate: build.heritage.innate || '', innate_flaw: h.name === 'Demon' ? build.heritage.innate_flaw : h.innate_flaw,
        attribute_flaw: h.name === 'Demon' ? build.heritage.attribute_flaw : h.attribute_flaw, merit: build.heritage.merit || '',
        merit_text: ((h.merit_text || {})[build.heritage.merit] || ''), vpower: build.heritage.vpower || '', adapt: build.heritage.adapt || '' } : null,
      stats: ['Willpower', 'Fate', 'Sanity'].map(function (n) { var x = byName(D.stats, n) || {}; return { name: n, dots: statVal(n), used: x.used_for || '' }; }),
      mana: null, combat: null,
      attrs: COLS.map(function (c) { return { col: c, num: colNumber(c), des: (build.attr_cols || {})[c] || '', list: D.attributes[c].map(function (a) { return { name: a, dots: attrTotal(a), innate: a === innateAttr() }; }) }; }),
      lists: { attrs: [].concat.apply([], COLS.map(function (c) { return D.attributes[c]; })), abilities: [].concat.apply([], GROUPS.map(function (g) { return D.abilities[g].map(function (a) { return a.name; }); })),
        styles: D.styles.map(function (x) { return x.name; }), magics: D.knowledges.map(function (x) { return x.name; }).concat(hmOn() ? [hmName()] : []) },
      abilities: GROUPS.map(function (g) {
        return { group: g, num: (build.ab_groups || {})[g] || null, list: D.abilities[g].map(function (a) {
          var sp = specList(a.name).map(function (x, i) { return x === OTHER ? ((build.spec_other || {})[a.name + '|' + i] || '') : x; }).filter(function (x) { return x && x.trim(); });
          return { name: a.name, dots: abTotal(a.name), pl: !!(build.pl || {})[a.name], specs: sp, used: a.used_for || '' };
        }) };
      }),
      past_life: build.pl_occupation || build.pl_job || '',
      styles: [], knowledges: [], combos: [],
      merits: [], flaws: [], backgrounds: [], guilds: (build.guilds || []).filter(function (g) { return g && g.name; }).map(function (g) { return Object.assign({}, g, { dots: Math.max(0, (Number(g.dots) || 0) + storyAdj('guild', g.name)) }); }),
      companions: [],
      xp: { earned: xpEarned(), spent: xpSpent(), log: (XPS.log || []).slice(), buys: (XPS.buys || []).slice() },
      st: !!(me && me.is_admin),
      drives: Object.keys(build.drives || {}).map(function (k) { return build.drives[k]; }).filter(Boolean),
      gear: EXTRA.gear || {}, money: EXTRA.money || {}
    };
    m.xp.unspent = m.xp.earned - m.xp.spent;
    var md = modifiers();
    function A(n) { return attrTotal(n) + (md.attr[n] || 0); }
    var arcane = Number(meritVal('merits', 'Arcane Enhancements')) || 0;
    var mtBase = A('Fortitude') + manaTotal() + md.mt - arcane;
    var allDots = allMagicDots() + (md.ab.Magic || 0) + (md.ab['Circle Magic'] || 0);
    m.mana = { dots: manaTotal(), magicDots: allDots, pool: allDots * manaTotal() + md.pool, mtFull: mtBase, mt: Math.max(0, mtBase - md.held), held: md.held, attuned: md.active, arcane: arcane };
    var bdt = A('Fortitude') + Number(meritVal('merits', 'Resilience') || 0) + md.bdt;
    if (md.doubleBdt) bdt *= 2;
    var mv = moveZones(A('Dexterity')) + md.move;
    m.combat = { initiative: A('Dexterity') + A('Perception') + md.init, move: md.moveX2 ? mv * 2 : mv, bdt: bdt, attack: md.attack, damage: md.damage, defense: md.defense };
    m.mods = md;
    m.attunables = attunables();
    m.attunedOn = Object.assign({}, EXTRA.attuned || {});
    m.money = EXTRA.money || startMoney();
    m.moneyStart = !EXTRA.money;
    m.tracks = EXTRA.tracks || {};
    var mer = build.merits || {};
    function boxN(v) { var s2 = String(v || ''); return /2|n1/.test(s2) ? 2 : v ? 1 : 0; }
    // Health boxes: the book's 7 / 5 / 3 (or the Storyteller's custom count), plus Merits, worn items,
    // attuned spells that are on, and extra boxes the player adds by hand for anything else (heritage abilities, story rewards)
    var stH = (build.st_extra || {}).health || {}, mb = m.mods.boxes, hand = (EXTRA.tracks || {}).boxAdj || {};
    m.boxSources = { b: [], l: [], a: [] };
    function src(k, n, what) { if (n) m.boxSources[k].push((n > 0 ? '+' : '') + n + ' ' + what); return n; }
    m.boxes = {
      b: Math.max(1, (stH.bashing || 7) + src('b', mb.b, 'from items and spells') + src('b', hand.b || 0, 'added by hand')),
      l: Math.max(1, (stH.lethal || 5) + src('l', boxN(meritVal('merits', 'Bonus Lethal Health')), 'Bonus Lethal Health') + src('l', mb.l, 'from items and spells') + src('l', hand.l || 0, 'added by hand')),
      a: Math.max(1, (stH.aggravated || 3) + src('a', boxN(meritVal('merits', 'Bonus Aggravated Health')), 'Bonus Aggravated Health') + src('a', mb.a, 'from items and spells') + src('a', hand.a || 0, 'added by hand'))
    };
    D.styles.forEach(function (st) {
      var t = styleTotal(st.name); if (!t) return;
      var mine = (build.style_picks || {})[st.name] || {};
      m.styles.push({ name: st.name, link: st.link, dots: t, tier: styleVal(st.name) ? 'Primary' : 'Secondary', weapons: st.weapons, primary: st.primary, secondary: st.secondary,
        ranks: st.ranks.slice(0, t).map(function (rk) {
          var have = picksAt(mine[rk.rank]);
          return { rank: rk.rank, title: rk.title, id: rk.id, def: rk.default, picks: ['a', 'b'].filter(function (o) { return have.indexOf(o) >= 0; }).map(function (o) { return Object.assign({ opt: o === 'a' ? 'Option A' : 'Option B' }, rk[o]); }) };
        }) });
    });
    function knowEntry(name, item, dots, tier, store, page, extra) {
      var mine = (build[store] || {})[item.name] || {};
      return Object.assign({ name: name, dots: dots, tier: tier, link: item.link, ranks: (item.ranks || []).slice(0, dots).map(function (rk) {
        var have = picksAt(mine[rk.rank]);
        return { rank: rk.rank, title: rk.title, id: rk.id, def: rk.default, picks: rk.spells.map(function (sp, i) { return have.indexOf(String(i)) >= 0 ? Object.assign({}, sp, { opt: sp.opt ? 'Option ' + sp.opt : '', attunable: /attuned/i.test((sp.cost || '') + ' ' + (sp.type || '')) }) : null; }).filter(Boolean),
          combos: have.filter(function (v) { return v.indexOf('c:') === 0; }).map(function (v) { return comboById(v.slice(2)); }).filter(Boolean) };
      }), page: page }, extra || {});
    }
    var hi = hmItem(), hd = hmData();
    if (hmOn()) {
      var hk = { name: hmName(), ranks: hi ? hi.ranks : null, link: hd ? '../rulebook/ch8.html#' + hd.id : (h ? h.link : '') };
      var he = hi ? knowEntry(hmName(), hk, hmVal(), 'Primary', 'hm_picks', 'ch8', { heritage: true }) : { name: hmName(), dots: hmVal(), tier: 'Primary', link: hk.link, ranks: [], heritage: true, page: 'ch8' };
      if (h && h.name === 'Demon') he.tribal = Object.keys(build.tribal || {}).filter(function (k) { return +k <= hmVal(); }).sort().map(function (k) { return { rank: +k, name: build.tribal[k] }; });
      if (!hi && hd) he.single = true;
      if (h && h.name === 'Vampire' && !build.heritage.vpower) { he.single = false; he.needsPower = true; he.name = 'Vampiric Powers'; }
      if (h && h.name === 'Hyuman' && !build.heritage.adapt) he.needsAdapt = true;
      m.knowledges.push(he);
    }
    if (h && h.name === 'Vampire') {
      m.vpowers = VPOWERS.map(function (p) {
        var main = p === build.heritage.vpower, d3 = main ? hmVal() : xpDots('vp', p), vi = vpItem(p);
        var e = d3 && vi ? knowEntry(p, vi, d3, main ? 'Primary' : 'Bought with XP', 'hm_picks', 'ch8', {}) : { name: p, dots: 0, ranks: [], link: vi ? vi.link : '' };
        e.main = main; return e;
      });
      // the chosen power is shown inside the Vampiric Powers group, not on its own
      m.knowledges = m.knowledges.filter(function (k) { return !(k.heritage && build.heritage.vpower && k.name === build.heritage.vpower); });
      if (build.heritage.vpower) m.knowledges.unshift({ name: 'Vampiric Powers', vampire: true, heritage: true, dots: 0, ranks: [], link: (hmData() && '../rulebook/ch8.html#' + ((D.heritage_magic || {})['Vampiric Powers'] || {}).id) || '' });
    }
    D.knowledges.forEach(function (k) {
      var t = knowTotal(k.name); if (!t) return;
      var tier = knowVal(k.name) + knowFree(k.name) ? 'Primary' : 'Secondary';
      if (k.ranks) m.knowledges.push(knowEntry(k.name, k, t, tier, 'know_picks', 'ch13', { kind: k.kind }));
      else m.knowledges.push({ name: k.name, dots: t, tier: tier, link: k.link, ranks: [], circle: true, kind: k.kind, focus: k.focus });
    });
    m.knowledges.forEach(function (k) { (k.ranks || []).forEach(function (rk) { (rk.combos || []).forEach(function (c) { m.combos.push(c); }); }); });
    D.backgrounds.forEach(function (b) { var v = bgVal(b.name); if (v) m.backgrounds.push({ name: b.name, dots: v, link: b.link, what: b.what, who: ((build.bg_names || {})[b.name] || '').trim() }); });
    [['merits', D.merits, m.merits], ['flaws', D.flaws, m.flaws]].forEach(function (g) {
      Object.keys(build[g[0]] || {}).forEach(function (n) {
        var x = byName(g[1], n) || {}, val = meritVal(g[0], n), opt = null;
        if (x.options && String(val).charAt(0) === 'n') opt = x.options[Number(String(val).slice(1))];
        if (!opt && (x.points || x.cost || {}).options && String(val).charAt(0) === 'n') opt = (x.points || x.cost).options[Number(String(val).slice(1))];
        var note = ((build.flaw_notes || {})[n] || (build.merit_notes || {})[n] || '').trim();
        var ck = x.cost || x.points || {};
        var item = { name: n, adjustable: ck.kind === 'per_dot' && !opt, max: ck.max || 5, value: val, link: x.link, group: x.group, cost: (x.cost || x.points || {}).text || '', option: opt, note: note, text: x.text || '' };
        if (n === 'Familiar Bond' && build.familiar && companionText(build.familiar)) item.note = 'Familiar: ' + companionText(build.familiar) + (note ? '. ' + note : '');
        g[2].push(item);
      });
    });
    if ((build.merits || {})['Familiar Bond'] && build.familiar) m.companions.push({ kind: 'Familiar', c: build.familiar, text: companionText(build.familiar), dots: Number(meritVal('merits', 'Familiar Bond')) || 1 });
    if (knowTotal('Summoning Magic') && build.starter_summon) m.companions.push({ kind: build.starter_summon.kind === 'spirit' ? 'SumMonz (Spirit)' : 'SumMonz (Fiend)', c: build.starter_summon, text: companionText(build.starter_summon), summoning: knowTotal('Summoning Magic') });
    m.offers = xpOffers();
    return m;
  }

  // ---------- Combat snapshot: what a character brings into an encounter ----------
  function manaRegen(d) { return d >= 10 ? 5 : d >= 9 ? 4 : d >= 7 ? 3 : d >= 4 ? 2 : 1; }
  function firstInt(s) { var m = String(s || '').match(/\d+/); return m ? Number(m[0]) : 0; }
  function combatKit() {
    var k = { attrs: {}, abilities: {}, dots: {}, spells: [], maneuvers: [], defenses: [] };
    COLS.forEach(function (c) { D.attributes[c].forEach(function (a) { k.attrs[a] = attrTotal(a); }); });
    GROUPS.forEach(function (g) { D.abilities[g].forEach(function (a) { k.abilities[a.name] = abTotal(a.name); }); });
    D.knowledges.forEach(function (x) { var t = knowTotal(x.name); if (t) k.dots[x.name] = t; });
    D.styles.forEach(function (x) { var t = styleTotal(x.name); if (t) k.dots[x.name] = t; });
    if (hmOn()) { k.dots[hmName()] = hmVal(); k.dots.Heritage = hmVal(); k.heritage_magic = hmName(); }
    var MT = { Damage: 'damage', Attack: 'attack', 'Attack or damage': 'either' };
    function addSpell(sp, school, kind, rank, extra) {
      if (!sp) return;
      k.spells.push(Object.assign({ name: sp.name, school: school, kind: kind, rank: rank, cost: firstInt(sp.cost), costText: sp.cost || '', pool: sp.dice_pool || '', type: sp.type || '',
        range: sp.range || '', defense: sp.defense || '', effect: sp.effect || sp.text || '', speed: sp.speed || '', id: sp.id || '' }, extra || {}));
    }
    D.knowledges.forEach(function (x) {
      var t = knowTotal(x.name); if (!t || !x.ranks) return;
      var mine = (build.know_picks || {})[x.name] || {};
      for (var r = 1; r <= Math.min(t, x.ranks.length); r++) {
        picksAt(mine[r]).forEach(function (v) {
          if (v.indexOf('c:') === 0) {
            var c = comboById(v.slice(2));
            if (c) addSpell({ name: c.name, cost: c.cost, dice_pool: c.dice_pool, type: c.type, range: c.range, defense: c.defense, effect: c.effect || c.text, speed: c.speed, id: c.id },
              c.schools.join(' + '), 'combo', c.dots, { schools: c.schools, mana_to: 'either', page: 'ch13' });
          } else addSpell(x.ranks[r - 1].spells[+v], x.name, 'know', r, { mana_to: MT[x.extra_mana_dice] || 'either', page: 'ch13' });
        });
      }
    });
    var hi = hmItem(), hd = hmData();
    if (hi) {
      var hp = (build.hm_picks || {})[hi.name] || {};
      for (var r2 = 1; r2 <= Math.min(hmVal(), hi.ranks.length); r2++) picksAt(hp[r2]).forEach(function (v) { addSpell(hi.ranks[r2 - 1].spells[+v], hi.name, 'hm', r2, { mana_to: (hd && hd.mana_to) || 'either', page: 'ch8' }); });
    }
    extraPowers().forEach(function (p) {
      var vi = vpItem(p), d2 = xpDots('vp', p), pk = (build.hm_picks || {})[p] || {};
      k.dots[p] = d2;
      if (vi) for (var r3 = 1; r3 <= Math.min(d2, vi.ranks.length); r3++) picksAt(pk[r3]).forEach(function (v) { addSpell(vi.ranks[r3 - 1].spells[+v], p, 'hm', r3, { mana_to: ((D.heritage_magic || {})[p] || {}).mana_to || 'either', page: 'ch8' }); });
    });
    D.styles.forEach(function (st) {
      var t = styleTotal(st.name); if (!t) return;
      k.maneuvers.push({ name: 'Attack', style: st.name, rank: 0, use: 'Combat', text: 'A standard attack with this Style.', pool: st.primary + ' + ' + st.name, page: 'ch12', id: '' });
      var mine = (build.style_picks || {})[st.name] || {};
      for (var r = 1; r <= Math.min(t, st.ranks.length); r++) {
        var rk = st.ranks[r - 1], list = [['Default', rk.default]];
        picksAt(mine[r]).forEach(function (o) { list.push([o === 'a' ? 'Option A' : 'Option B', rk[o]]); });
        list.forEach(function (x) {
          if (!x[1] || /^Outside combat/i.test(x[1].use || '')) return;
          k.maneuvers.push({ name: x[1].name, style: st.name, rank: r, slot: x[0], use: x[1].use || '', text: x[1].text || '', pool: st.primary + ' + ' + st.name, page: 'ch12', id: x[1].id || '' });
        });
      }
      k.defenses.push({ name: st.name + ' defense', pool: st.secondary + ' + ' + st.name });
    });
    k.defenses.unshift({ name: 'Dodge', pool: 'Dexterity + Dodge' });
    k.defenses.push({ name: 'Resist (body)', pool: 'Fortitude + Endurance' }, { name: 'Resist (mind)', pool: 'Composure + Presence' }, { name: 'Notice', pool: 'Perception + Awareness' });
    var mana = manaTotal();
    var cm = characterModel();
    var md = cm.mods;
    Object.keys(md.attr).forEach(function (a) { k.attrs[a] = (k.attrs[a] || 0) + md.attr[a]; });
    Object.keys(md.ab).forEach(function (a) { k.abilities[a] = (k.abilities[a] || 0) + md.ab[a]; });
    Object.keys(md.dots).forEach(function (a) { k.dots[a] = (k.dots[a] || 0) + md.dots[a]; });
    k.mana = { dots: mana, pool: cm.mana.pool, mt: cm.mana.mt, regen: manaRegen(mana) };
    k.initiative = cm.combat.initiative;
    k.move = cm.combat.move;
    k.bdt = cm.combat.bdt;
    k.bonus = { attack: md.attack, damage: md.damage, defense: md.defense };
    k.boxes = cm.boxes;
    k.willpower = statVal('Willpower');
    return k;
  }

  // Headless use by the Character Sheet page: fill a sheet from a saved build
  // without drawing the Forge.
  function headlessLoad(data, row, player) {
    D = data; ch = row; me = player || null;
    build = (row.sheet && row.sheet.build) || {};
    forge = (row.sheet && row.sheet.forge) || { step: 1, done: [], ok: [] };
    XPS = (row.sheet && row.sheet.xp) || { log: [], buys: [] };
    var sh = row.sheet || {};
    EXTRA = { gear: sh.gear || {}, money: sh.money || null, attuned: sh.attuned || {}, tracks: sh.tracks || {} };
  }
  window.TerranaForgeView = function (data, row, player) { headlessLoad(data, row, player); return sheetView(); };
  // The website character page: a model to draw, plus XP actions that change build and xp.
  // After an action, save { build, xp, view } back to the character row.
  window.TerranaCharacter = {
    load: function (data, row, player) { headlessLoad(data, row, player); return characterModel(); },
    model: characterModel,
    award: function (amt, note) { xpAward(amt, note); return characterModel(); },
    removeAward: function (id) { xpRemoveAward(id); return characterModel(); },
    buy: function (offer, extra) { xpBuy(offer, extra); return characterModel(); },
    undo: function (id) { xpUndo(id); return characterModel(); },
    combosFor: function (school, r) { return combosFor(school, r); },
    sheet: function () { return { build: build, xp: XPS, view: sheetView(), gear: EXTRA.gear, money: EXTRA.money || startMoney(), attuned: EXTRA.attuned, tracks: EXTRA.tracks }; },
    setExtras: function (x) { Object.keys(x || {}).forEach(function (k) { EXTRA[k] = x[k]; }); return characterModel(); },
    combatKit: combatKit
  };
  if (window.FORGE_HEADLESS) return;

  $('save-no').addEventListener('click', function () { $('dlg-save').close(); });
  $('save-yes').addEventListener('click', async function () {
    var dlg = $('dlg-save');
    var btn = $('save-yes');
    forge.ok = forge.ok || [];
    (dlg._warn || []).forEach(function (w) { if (forge.ok.indexOf(w.key) < 0) forge.ok.push(w.key); });
    var next = Math.min(step + 1, BUILT);
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
      await save(step === BUILT ? step : next);
      dlg.close();
      if (step === BUILT) {
        drawSteps();
        if (stillToDo().length) openLastCheck();
        else await finishChar();
      } else {
        go(next);
      }
    } catch (err) {
      $('save-warnings').appendChild(el('p', { class: 'ff-warn-head', text: 'Could not save: ' + A.friendly(err) }));
    }
    btn.disabled = false;
    btn.textContent = 'Yes';
  });

  // Arrow keys move between Yes and No, like a game menu
  $('dlg-save').addEventListener('keydown', function (e) {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) < 0) return;
    e.preventDefault();
    ($(document.activeElement && document.activeElement.id === 'save-yes' ? 'save-no' : 'save-yes')).focus();
  });

  // One last reminder of every unfinished step before finishing
  function openLastCheck() {
    var box = $('last-list');
    box.textContent = '';
    var dlg = $('dlg-last');
    stillToDo().forEach(function (n) {
      var ul = el('ul', { class: 'ff-warn' });
      todos(n).forEach(function (w) { ul.appendChild(el('li', { text: w.text })); });
      box.appendChild(el('div', { class: 'last-step' }, [
        el('div', { class: 'last-head' }, [
          el('span', { class: 'ff-warn-head', text: 'Step ' + n + ': ' + STEPS[n - 1] }),
          el('button', { type: 'button', class: 'act small', text: 'Go There', onclick: function () { dlg.close(); go(n); } })
        ]),
        ul
      ]));
    });
    dlg.showModal();
    $('last-back').focus();
  }
  $('last-back').addEventListener('click', function () { $('dlg-last').close(); });
  $('last-finish').addEventListener('click', async function () {
    $('dlg-last').close();
    await finishChar();
  });
  // mark the character complete
  async function finishChar() {
    try {
      forge.complete = true;
      await save(step);
      drawSteps();
      showToast(ch.name + ' is complete!');
    } catch (err) {
      forge.complete = false;
      showToast('Could not save: ' + A.friendly(err));
    }
  }

  function showToast(text) {
    var t = el('div', { class: 'ff-toast px', role: 'status', text: text });
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  $('btn-next').addEventListener('click', openSave);
  $('btn-back').addEventListener('click', function () { if (step > 1) go(step - 1); });

  // ---------- start ----------
  async function start() {
    var res = await fetch('data.json');
    D = await res.json();
    me = await A.currentPlayer();
    $('forge-loading').hidden = true;

    if (!me) {
      var pick = $('forge-pick');
      pick.hidden = false;
      $('forge-pick-buttons').appendChild(el('a', { class: 'act primary', href: '../account/index.html?next=forge/index.html', text: 'Log In to Start' }));
      return;
    }

    var id = new URLSearchParams(location.search).get('id');
    if (!id) {
      $('forge-pick').hidden = false;
      $('forge-pick-buttons').appendChild(el('a', { class: 'act primary', href: '../characters/index.html', text: 'Pick or Make a Character' }));
      return;
    }

    var r = await db.from('characters').select('id, name, sheet, owner').eq('id', id).maybeSingle();
    if (r.error || !r.data || r.data.owner !== me.id) {
      $('forge-pick').hidden = false;
      $('forge-pick').querySelector('p').textContent = 'That character could not be found on your account.';
      $('forge-pick-buttons').appendChild(el('a', { class: 'act primary', href: '../characters/index.html', text: 'My Characters' }));
      return;
    }
    ch = r.data;
    build = (ch.sheet && ch.sheet.build) || {};
    forge = (ch.sheet && ch.sheet.forge) || { step: 1, done: [], ok: [] };
    XPS = (ch.sheet && ch.sheet.xp) || { log: [], buys: [] };
    step = Math.min(Math.max(forge.step || 1, 1), BUILT);
    $('forge-charname').textContent = ch.name;
    document.title = ch.name + ' | Character Forge';
    $('forge-main').hidden = false;
    drawStep();
  }


  start().catch(function (err) {
    $('forge-loading').innerHTML = '';
    $('forge-loading').appendChild(el('p', { class: 'center', text: 'The Forge could not load. ' + A.friendly(err) }));
  });
})();
