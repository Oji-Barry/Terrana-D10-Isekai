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
  var BUILT = 4; // steps that are built so far

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
      box.appendChild(el('p', {}, [el('strong', { text: 'Heritage Magic: ' }), h.heritage_magic + ', 1 free dot, marked P']));
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
      return w;
    },
    summary: function () {
      var h = heritage();
      if (!h) return [];
      var out = [['Heritage', h.name]];
      if (build.heritage.innate) out.push(['Innate', build.heritage.innate + ' (2 dots)']);
      if (build.heritage.merit) out.push(['Heritage Merit', build.heritage.merit]);
      out.push(['Heritage Magic', h.heritage_magic + ' 1 (P)']);
      return out;
    }
  };

  // ---------- drawing ----------
  function drawSteps() {
    var ol = $('step-list');
    ol.textContent = '';
    STEPS.forEach(function (name, i) {
      var n = i + 1;
      var done = (forge.done || []).indexOf(n) >= 0;
      var ready = n <= BUILT;
      var b = el('button', {
        type: 'button', class: 'step-btn' + (n === step ? ' current' : '') + (done ? ' done' : ''),
        'aria-current': n === step ? 'step' : null, disabled: ready ? null : 'disabled',
        title: ready ? name : name + ' (coming soon)'
      }, [el('span', { class: 'step-n', text: String(n) }), el('span', { class: 'step-name', text: name })]);
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
    p.appendChild(el('div', { class: 'kicker', text: 'Step ' + step + ' of 13' }));
    p.appendChild(el('h1', { text: STEPS[step - 1] }));
    p.appendChild(el('p', { class: 'step-intro' }, [s.intro + ' ', bookLink(s.link, 'Full rules')]));
    s.render(p);
    $('btn-back').disabled = step === 1;
    $('btn-next').textContent = step === BUILT ? 'Save' : 'Next';
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
    sheet.build = build;
    sheet.forge = forge;
    var res = await db.from('characters').update({ sheet: sheet }).eq('id', ch.id).select('sheet, updated_at').single();
    if (res.error) throw res.error;
    ch.sheet = res.data.sheet;
  }

  function openSave() {
    var warn = S[step].check().filter(function (w) { return (forge.ok || []).indexOf(w.key) < 0; });
    var box = $('save-warnings');
    box.textContent = '';
    if (warn.length) {
      box.appendChild(el('p', { class: 'ff-warn-head', text: 'Something is amiss:' }));
      var ul = el('ul', { class: 'ff-warn' });
      warn.forEach(function (w) { ul.appendChild(el('li', { text: w.text })); });
      box.appendChild(ul);
      box.appendChild(el('p', { class: 'ff-note', text: 'Ask your Storyteller and verify with them you’re all good. Choosing Yes saves anyway and will not ask about these again.' }));
    } else {
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
        showToast('Saved. Steps 5 to 13 are coming soon.');
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
