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
  function bgVal(n) {
    var v = (build.backgrounds || {})[n];
    if (v === undefined) return n === 'Resources' ? 1 : 0;
    return v;
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
    if (s !== undefined) return s;
    return n === 'Willpower' ? startWillpower() : 5;
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
  function attrTotal(a) { return attrVal(a) + fbOf('attrs', a); }
  function abTotal(a) { return abVal(a) + fbOf('abilities', a); }
  function styleVal(n) { return (build.styles || {})[n] || 0; }
  function knowVal(n) { return (build.knows || {})[n] || 0; }
  function styleTotal(n) { return styleVal(n) + fbOf('styles', n); }
  function knowTotal(n) { return knowVal(n) + knowFree(n) + fbOf('knows', n); }
  function manaTotal() { return 1 + ((build.fb || {}).mana || 0); }
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
  function hmVal() { return hmOn() ? hmBase() + ((build.fb || {}).hm || 0) : 0; }
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

  // ---------- saving ----------
  async function save(nextStep) {
    var sheet = Object.assign({}, ch.sheet || {});
    forge.step = nextStep;
    forge.done = forge.done || [];
    if (forge.done.indexOf(step) < 0) forge.done.push(step);
    forge.unfinished = forge.complete ? stillToDo() : unfinished();
    sheet.build = build;
    sheet.forge = forge;
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
