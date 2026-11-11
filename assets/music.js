/* Jimothy's D10 Isekai JRPG: music player and visualizer.
   One player for the whole page: the book's slide-out menu, the combat room, and OurSpace pages all use it.
   Music by Juhani Junkala (CC0). Sound effects (assets/sfx.js) play on their own channel alongside it. */
(function () {
  'use strict';
  if (window.TerranaMusic) return;
  var ROOT = (function () {
    var s = document.currentScript && document.currentScript.src;
    if (s) return s.replace(/assets\/music\.js.*$/, '');
    return new URL(document.documentElement.getAttribute('data-root') || './', location.href).href;
  })();

  // ---------------- engine ----------------
  var audio = new Audio();
  audio.preload = 'auto';
  audio.crossOrigin = 'anonymous';
  var lib = null, libP = null, listeners = [];
  var st = { id: null, url: '', title: '', mood: 'all', repeat: 'all', note: '' };
  var pref = { vol: 0.6, mute: false, vis: { mode: 0 } };
  try { Object.assign(pref, JSON.parse(localStorage.getItem('terrana-music-pref') || '{}')); } catch (e) {}
  function savePref() { try { localStorage.setItem('terrana-music-pref', JSON.stringify(pref)); } catch (e) {} }
  function applyVol() { audio.volume = pref.mute ? 0 : Math.max(0, Math.min(1, pref.vol)); }
  applyVol();

  var ctx = null, analyser = null;
  // The visualizer needs Web Audio, and browsers only start it after a click, so hook it up on the first one
  function graph() {
    if (analyser) { if (ctx.state === 'suspended') ctx.resume(); return; }
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    try {
      ctx = new C();
      var src = ctx.createMediaElementSource(audio); M._src = src;
      analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.78;
      src.connect(analyser); analyser.connect(ctx.destination);
    } catch (e) { analyser = null; }
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, function () { if (!audio.paused || st.id || st.url) graph(); }, true); });

  function emit(what) { listeners.forEach(function (fn) { try { fn(what, M.state()); } catch (e) {} }); }
  function loadLib() {
    if (lib) return Promise.resolve(lib);
    if (!libP) libP = fetch(ROOT + 'assets/music/library.json?v=ee38227c').then(function (r) { return r.json(); }).then(function (d) {
      lib = d; lib.byId = {}; d.tracks.forEach(function (t) { lib.byId[t.id] = t; });
      loadUploads(0);
      return lib;
    });
    return libP;
  }
  // Songs players uploaded for their OurSpace pages: anyone can play them, grouped under each player's name
  function client() { return window.Terrana && window.Terrana.auth && window.Terrana.auth.client; }
  function songTitle(path) { return path.split('/').pop().replace(/^\d+-/, '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() || 'Song'; }
  function loadUploads(tries) {
    var c = client();
    if (!c || !c.rpc) { if (tries < 40) setTimeout(function () { loadUploads(tries + 1); }, 500); return Promise.resolve(); }
    return c.rpc('list_songs').then(function (r) {
      if (r.error || !Array.isArray(r.data) || !lib) return;
      lib.moods = lib.moods.filter(function (m) { return !m.user; });
      lib.tracks = lib.tracks.filter(function (t) { return !t.url; });
      var groups = {};
      r.data.forEach(function (row) {
        var id = 'u:' + row.path;
        var t = { id: id, title: songTitle(row.path), url: c.storage.from('ourspace-music').getPublicUrl(row.path).data.publicUrl, dur: 0, by: row.username };
        lib.byId[id] = t; lib.tracks.push(t);
        (groups[row.username] = groups[row.username] || []).push(id);
      });
      Object.keys(groups).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).forEach(function (u) { lib.moods.push({ id: 'user:' + u, name: u, user: true, tracks: groups[u] }); });
      emit('library');
    });
  }
  function track(id) { return lib && lib.byId[id]; }
  function moodName(m) { if (!lib || m === 'all') return 'All Music'; var x = lib.moods.filter(function (y) { return y.id === m; })[0]; return x ? (x.user ? x.name + '’s uploads' : x.name) : ''; }
  function queue() {
    if (!lib) return [];
    if (st.mood === 'all') return lib.tracks.map(function (t) { return t.id; });
    var m = lib.moods.filter(function (y) { return y.id === st.mood; })[0];
    return m ? m.tracks.slice() : [];
  }
  function setSrc(id, url, title) {
    st.id = id || null; st.url = url || ''; st.title = title || (id && track(id) ? track(id).title : '');
    audio.src = id ? (track(id).url || ROOT + 'assets/music/' + track(id).file) : url;
    audio.loop = st.repeat === 'one';
  }
  function playNow(at) {
    if (at) { var seek = function () { try { audio.currentTime = Math.min(at, Math.max(0, (audio.duration || at + 1) - 0.25)); } catch (e) {} }; if (audio.readyState >= 1) seek(); else audio.addEventListener('loadedmetadata', seek, { once: true }); }
    var p = audio.play();
    if (p && p.catch) p.catch(function () { st.note = 'blocked'; emit('blocked'); });
  }
  audio.addEventListener('play', function () { st.note = ''; emit('play'); });
  audio.addEventListener('pause', function () { emit('pause'); });
  var lastT = 0;
  audio.addEventListener('timeupdate', function () { var n = Date.now(); if (n - lastT > 450) { lastT = n; emit('time'); } });
  audio.addEventListener('ended', function () {
    if (M.onEnded) return M.onEnded();   // the combat room decides what plays next
    M.next(true);
  });

  var M = {
    root: ROOT,
    audio: audio,
    library: loadLib,
    moodName: moodName,
    track: track,
    on: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; },
    state: function () {
      return { id: st.id, url: st.url, title: st.title, mood: st.mood, moodName: moodName(st.mood), repeat: st.repeat, playing: !audio.paused && !audio.ended,
        time: audio.currentTime || 0, dur: audio.duration || (st.id && track(st.id) ? track(st.id).dur : 0), vol: pref.vol, mute: pref.mute, blocked: st.note === 'blocked' };
    },
    play: function (id, opts) {
      opts = opts || {};
      return loadLib().then(function () {
        if (opts.mood) st.mood = opts.mood;
        if (id && !track(id)) return;
        if (!id) id = st.id || queue()[0];
        if (!id) return;
        if (id !== st.id || !audio.src) setSrc(id);
        if (opts.paused) { if (opts.at !== undefined) { audio.addEventListener('loadedmetadata', function () { try { audio.currentTime = opts.at; } catch (e) {} }, { once: true }); } emit('track'); return; }
        playNow(opts.at); emit('track');
      });
    },
    playUrl: function (url, title, opts) { opts = opts || {}; setSrc(null, url, title); if (opts.paused) { emit('track'); return; } playNow(opts.at); emit('track'); },
    pause: function () { audio.pause(); },
    resume: function () { if (!audio.src) return M.play(); graph(); playNow(); },
    toggle: function () { if (audio.paused) M.resume(); else M.pause(); },
    stop: function () { audio.pause(); try { audio.currentTime = 0; } catch (e) {} emit('pause'); },
    seek: function (sec) { try { audio.currentTime = sec; } catch (e) {} emit('time'); },
    nextId: function (dir) {
      var q = queue(); if (!q.length) return null;
      var i = q.indexOf(st.id);
      if (i < 0) return q[0];
      var j = i + (dir || 1);
      if (j >= q.length) return st.repeat === 'off' && dir !== -1 ? null : q[0];
      if (j < 0) return q[q.length - 1];
      return q[j];
    },
    next: function (auto) {
      if (st.url && !st.id) { if (auto && st.repeat !== 'off') playNow(0.01); return; }
      var n = M.nextId(1);
      if (!n) { emit('pause'); return; }
      M.play(n);
    },
    prev: function () { if (audio.currentTime > 3) return M.seek(0); var p = M.nextId(-1); if (p) M.play(p); },
    setRepeat: function (r) { st.repeat = r; audio.loop = r === 'one'; emit('repeat'); },
    cycleRepeat: function () { M.setRepeat({ all: 'one', one: 'off', off: 'all' }[st.repeat]); },
    setMood: function (m) { st.mood = m; emit('mood'); },
    volume: function (v) { if (typeof v === 'number') { pref.vol = v; applyVol(); savePref(); emit('vol'); } return pref.vol; },
    muted: function (m) { if (typeof m === 'boolean') { pref.mute = m; applyVol(); savePref(); emit('vol'); } return pref.mute; },
    unlock: graph,
    refreshUploads: function () { return loadLib().then(function () { return loadUploads(40); }); },
    uploads: function () { return lib ? lib.moods.filter(function (m) { return m.user; }) : []; }
  };
  window.TerranaMusic = M;
  if (!document.querySelector('link[href*="assets/music.css"]')) {
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = ROOT + 'assets/music.css?v=01dc4f9f'; document.head.appendChild(css);
  }

  // ---------------- book pages: keep going between pages ----------------
  var KEY = 'terrana-music-now';
  M.keepAlive = function () {
    function save() {
      var s = M.state(); if (!s.id) return;
      try { sessionStorage.setItem(KEY, JSON.stringify({ id: s.id, mood: s.mood, repeat: s.repeat, time: s.time, playing: s.playing })); } catch (e) {}
    }
    window.addEventListener('pagehide', save);
    setInterval(save, 2000);
    var saved = null; try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (saved && saved.id) {
      loadLib().then(function () {
        st.mood = saved.mood || 'all'; M.setRepeat(saved.repeat || 'all');
        M.play(saved.id, { at: saved.time || 0, paused: !saved.playing });
        if (saved.playing) M.autoStart();
      });
    } else if (pref.siteAuto !== false) {
      // A new visit: the JRPG Theme starts on Repeat 1. Pausing it turns this off for your next visits; pressing play turns it back on.
      loadLib().then(function () { st.mood = 'theme'; M.setRepeat('one'); M.play('jrpg-theme', { mood: 'theme' }); M.autoStart(); });
    }
    M.on(function (w) { if (w === 'play' || w === 'pause') { var on = w === 'play'; if (M._userToggle) { pref.siteAuto = on; savePref(); M._userToggle = false; saveAutoToAccount(on); } } });
    loadAutoFromAccount(0);
  };
  // Logged-in players: the choice also goes in their account, so it follows them to other devices
  function saveAutoToAccount(on) {
    var c = client(); if (!c || !c.auth || !c.auth.updateUser) return;
    c.auth.getSession().then(function (r) { if (r && r.data && r.data.session) c.auth.updateUser({ data: { site_music_autoplay: on } }); }).catch(function () {});
  }
  function loadAutoFromAccount(tries) {
    var c = client();
    if (!c || !c.auth || !c.auth.getSession) { if (tries < 40) setTimeout(function () { loadAutoFromAccount(tries + 1); }, 500); return; }
    c.auth.getSession().then(function (r) {
      var u = r && r.data && r.data.session && r.data.session.user, v = u && u.user_metadata ? u.user_metadata.site_music_autoplay : undefined;
      if (typeof v !== 'boolean') return;
      pref.siteAuto = v; savePref();
      if (!v) { M._noAuto = true; if (!audio.paused && !M._userStarted) audio.pause(); }
    }).catch(function () {});
  }
  // Browsers hold music back until the visitor clicks or presses a key, so start it on the first one
  // (unless that first click is on the player itself, which then does what was clicked).
  M.autoStart = function () {
    if (!audio.paused) return;
    function go(e) {
      ['pointerdown', 'keydown'].forEach(function (ev) { window.removeEventListener(ev, go, true); });
      if (e && e.target && e.target.closest && e.target.closest('.mp, .menu-music-quick, .mp-vis')) return;
      if (M._noAuto) return;   // their account says they turned it off
      if (audio.paused && audio.src) { graph(); playNow(); }
    }
    setTimeout(function () {
      if (!audio.paused) return;
      ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, go, true); });
    }, 300);
  };

  // ---------------- player widget ----------------
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v === null || v === undefined || v === false) return;
      if (k === 'text') n.textContent = v; else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c !== null && c !== undefined) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  var ICON = { play: '▶', pause: '❚❚', prev: '⏮', next: '⏭', vis: '▦' };
  var REPEAT_TEXT = { all: 'Repeat All', one: 'Repeat 1', off: 'No Repeat' };

  // opts: { title, canChange(): bool, onAction(action, data) to route changes (combat), lockedNote, songOnly (OurSpace) }
  M.mountPlayer = function (box, opts) {
    opts = opts || {};
    var can = function () { return !opts.canChange || opts.canChange(); };
    function act(action, data) {
      M.unlock();
      if (opts.onAction) return opts.onAction(action, data);
      if (action === 'toggle') { M._userToggle = true; M._userStarted = true; M._noAuto = false; M.toggle(); } else if (action === 'next') M.next(); else if (action === 'prev') M.prev();
      else if (action === 'repeat') M.cycleRepeat(); else if (action === 'mood') M.setMood(data); else if (action === 'pick') M.play(data);
      else if (action === 'seek') M.seek(data);
    }
    var wrap = el('div', { class: 'mp' + (opts.songOnly ? ' mp-song' : '') });
    var title = el('div', { class: 'mp-title' }, [el('span', { text: 'No music playing' })]);
    var sub = el('div', { class: 'mp-sub' });
    var bar = el('div', { class: 'mp-bar', role: 'slider', 'aria-label': 'Song position', tabindex: '0', 'aria-valuemin': '0' }, [el('span')]);
    var bPlay = el('button', { type: 'button', class: 'mp-btn mp-play', 'aria-label': 'Play', text: ICON.play, onclick: function () { if (opts.songOnly || can()) act('toggle'); else if (M.state().blocked || !M.state().playing) { M.unlock(); M.resume(); } } });
    var bPrev = el('button', { type: 'button', class: 'mp-btn', 'aria-label': 'Previous song', text: ICON.prev, onclick: function () { if (can()) act('prev'); } });
    var bNext = el('button', { type: 'button', class: 'mp-btn', 'aria-label': 'Next song', text: ICON.next, onclick: function () { if (can()) act('next'); } });
    var bRep = el('button', { type: 'button', class: 'mp-btn mp-rep', onclick: function () { if (can()) act('repeat'); } });
    var bMute = el('button', { type: 'button', class: 'mp-btn', 'aria-label': 'Mute', onclick: function () { M.muted(!M.muted()); } });
    var vol = el('input', { type: 'range', min: '0', max: '100', class: 'mp-vol', 'aria-label': 'Music volume', value: String(Math.round(pref.vol * 100)), oninput: function () { M.volume(+vol.value / 100); if (M.muted() && +vol.value > 0) M.muted(false); } });
    var bVis = el('button', { type: 'button', class: 'mp-btn', 'aria-label': 'Open the visualizer', title: 'Visualizer', text: ICON.vis, onclick: function () { M.unlock(); VIS.show(); } });
    var moodSel = el('select', { class: 'mp-mood', 'aria-label': 'Mood', onchange: function () { if (can()) act('mood', moodSel.value); else draw(); } });
    var list = el('ol', { class: 'mp-tracks' });
    var details = el('details', { class: 'mp-list' }, [el('summary', { text: 'Track list' }), list]);
    var note = el('p', { class: 'mp-note' });
    var screen = el('div', { class: 'mp-screen' }, [title, sub, bar]);
    wrap.appendChild(screen);
    // Two fixed rows, so nothing jumps around: the buttons, then mute + volume + visualizations
    wrap.appendChild(el('div', { class: 'mp-ctrls' }, opts.songOnly ? [bPlay, bRep] : [bPrev, bPlay, bNext, bRep]));
    wrap.appendChild(el('div', { class: 'mp-ctrls2' }, [bMute, vol, el('span', { class: 'mp-viswrap' }, [bVis])]));
    if (!opts.songOnly) { wrap.appendChild(el('label', { class: 'mp-moodrow' }, [el('span', { text: 'Mood' }), moodSel])); wrap.appendChild(details); }
    if (opts.extra) wrap.appendChild(opts.extra);
    wrap.appendChild(note);
    box.appendChild(wrap);

    var browseMood = null;   // someone who cannot change the music can still look through other moods
    function seekFrom(ev) { if (!can() && !opts.songOnly) return; var r = bar.getBoundingClientRect(), s = M.state(); if (!s.dur) return; act('seek', Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * s.dur); }
    bar.addEventListener('click', seekFrom);
    bar.addEventListener('keydown', function (e) { var s = M.state(); if (e.key === 'ArrowRight') act('seek', Math.min(s.dur, s.time + 5)); if (e.key === 'ArrowLeft') act('seek', Math.max(0, s.time - 5)); });
    moodSel.addEventListener('change', function () { browseMood = moodSel.value; drawList(); });

    function drawList() {
      if (!lib) return;
      var s = M.state(), m = browseMood || s.mood;
      var ids = m === 'all' ? lib.tracks.map(function (t) { return t.id; }) : ((lib.moods.filter(function (y) { return y.id === m; })[0] || {}).tracks || []);
      list.textContent = '';
      ids.forEach(function (id) {
        var t = track(id);
        list.appendChild(el('li', {}, [el('button', { type: 'button', class: 'mp-track' + (id === s.id ? ' on' : ''), disabled: !can() ? true : null, title: can() ? 'Play ' + t.title : (opts.lockedNote || ''),
          onclick: function () { if (can()) { if (m !== s.mood) act('mood', m); act('pick', id); } } }, [el('span', { text: t.title }), el('small', { text: t.dur ? fmt(t.dur) : (t.by ? 'by ' + t.by : '') })])]));
      });
    }
    function draw() {
      var s = M.state(), c = can();
      title.firstChild.textContent = s.title || 'No music playing';
      title.classList.toggle('scroll', (s.title || '').length > 22);
      sub.textContent = (opts.songOnly ? '' : s.moodName + '  ·  ') + fmt(s.time) + ' / ' + fmt(s.dur);
      bar.firstChild.style.width = (s.dur ? Math.min(100, s.time / s.dur * 100) : 0) + '%';
      bar.setAttribute('aria-valuenow', String(Math.floor(s.time))); bar.setAttribute('aria-valuemax', String(Math.floor(s.dur || 0)));
      bPlay.textContent = s.playing ? ICON.pause : ICON.play; bPlay.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
      bRep.textContent = REPEAT_TEXT[s.repeat]; bRep.setAttribute('aria-label', REPEAT_TEXT[s.repeat] + '. Click to change.');
      bMute.textContent = s.mute ? '🔇' : '🔊'; bMute.setAttribute('aria-label', s.mute ? 'Unmute' : 'Mute');
      [bPrev, bNext, bRep].forEach(function (b) { b.disabled = !c; });
      bPlay.disabled = !(c || opts.songOnly || s.blocked || (s.id && !s.playing && opts.listenAlong));
      if (lib && moodSel.options.length !== lib.moods.length + 1) {
        moodSel.textContent = '';
        moodSel.appendChild(el('option', { value: 'all', text: 'All Music' }));
        var og1 = el('optgroup', { label: 'Moods' }), og2 = el('optgroup', { label: 'Player Uploads' });
        lib.moods.forEach(function (m) { (m.user ? og2 : og1).appendChild(el('option', { value: m.id, text: m.name })); });
        moodSel.appendChild(og1); if (og2.children.length) moodSel.appendChild(og2);
      }
      if (document.activeElement !== moodSel) moodSel.value = browseMood || s.mood;
      note.textContent = s.blocked ? 'Your browser held the music back. Press ▶ to start it.' : (!c && opts.lockedNote ? opts.lockedNote : '');
      wrap.classList.toggle('locked', !c);
      drawList();
    }
    var off = M.on(function (what) { if (what === 'time') { var s = M.state(); sub.textContent = (opts.songOnly ? '' : s.moodName + '  ·  ') + fmt(s.time) + ' / ' + fmt(s.dur); bar.firstChild.style.width = (s.dur ? Math.min(100, s.time / s.dur * 100) : 0) + '%'; } else draw(); });
    loadLib().then(draw); draw();
    return { redraw: function () { browseMood = null; draw(); }, destroy: function () { off(); wrap.remove(); } };
  };

  // ---------------- visualizer window ----------------
  // Classic effects drawn here, plus MilkDrop presets run by Butterchurn (MIT, Jordan Berg) and picked
  // for gentle light changes. Nothing strobes: brightness and speed follow the music smoothly.
  var VIS = (function () {
    var win = null, cv = null, cv2 = null, fr = null, g = null, raf = 0, collapsed = false, modeBtn = null, winMenu = null;
    var freq = new Uint8Array(1024), wave = new Uint8Array(2048), peaks = [], t = 0, plasma = null, phase = 0;
    var sm = { bass: 0, mid: 0, all: 0 }, stars = [];
    var md = { viz: null, presets: null, loading: null, failed: false, size: '' };
    // Classic Media Player looks and classic screensavers, all redrawn here (no original files), plus 3D Pipes by Isaiah Odhner (MIT)
    var MODES = [
      { id: 'bars', name: 'Classic Bars', fn: bars, group: 'media' },
      { id: 'ocean', name: 'Ocean Mist', fn: oceanMist, group: 'media' },
      { id: 'firestorm', name: 'Fire Storm', fn: fireStorm, group: 'media' },
      { id: 'mirror', name: 'Mirror Bars', fn: mirror, group: 'media' },
      { id: 'scope', name: 'Scope', fn: scope, group: 'media' },
      { id: 'ambience', name: 'Ambience', fn: ambience, group: 'media' },
      { id: 'alchemy', name: 'Alchemy', fn: alchemy, group: 'media' },
      { id: 'web', name: 'Spider’s Web', fn: spiderWeb, group: 'media' },
      { id: 'circles', name: 'Dance of the Circles', fn: circleDance, group: 'media' },
      { id: 'pipes', name: '3D Pipes', frame: 'vendor/pipes/index.html#%7B%22hideUI%22%3Atrue%7D', by: 'Isaiah Odhner', group: 'saver' },
      { id: 'maze', name: '3D Maze', fn: maze, group: 'saver' },
      { id: 'stars', name: 'Starfield', fn: starfield, group: 'saver' },
      { id: 'mystic', name: 'Mystic Lines', fn: mystic, group: 'saver' },
      { id: 'bezier', name: 'Bezier Ribbons', fn: bezier, group: 'saver' },
      { id: 'fish', name: 'Fish Tank', fn: fishTank, group: 'saver' },
      { id: 'dice', name: 'Flying Dice', fn: flyingDice, group: 'saver' }
    ];
    var GROUPS = [['media', 'Classic Media Player'], ['saver', 'Classic Screensavers']];
    var MD_LIST = [];   // filled from assets/music/milkdrop.json
    function allModes() { return MODES.concat(MD_LIST); }
    function cur() { var id = pref.vis.mode; return allModes().filter(function (m) { return m.id === id; })[0] || MODES[0]; }
    function setMode(id) { pref.vis.mode = id; savePref(); plasma = null; label(); if (cur().md) startMd(); }
    function mdInfo() {
      if (md.presets) return Promise.resolve();
      return fetch(ROOT + 'assets/music/milkdrop.json?v=eb7c140c').then(function (r) { return r.json(); }).then(function (d) {
        md.presets = d.presets; MD_LIST = d.list.map(function (x) { return { id: 'md:' + x.key, name: x.name, md: x.key, by: x.by }; });
      }).catch(function () { md.failed = true; });
    }
    function loadScript(src) { return new Promise(function (ok, bad) { var sc = document.createElement('script'); sc.src = src; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc); }); }
    function startMd() {
      if (md.viz) { loadPreset(); return Promise.resolve(); }
      if (md.loading) return md.loading;
      graph();
      md.loading = mdInfo().then(function () { return window.butterchurn ? null : loadScript(ROOT + 'vendor/butterchurn/butterchurn.min.js'); }).then(function () {
        var B = window.butterchurn && (window.butterchurn.default || window.butterchurn);
        if (!B || !ctx || !M._src || !build.ok) throw new Error('no webgl');
        md.viz = B.createVisualizer(ctx, cv2, { width: 300, height: 170, pixelRatio: Math.min(2, window.devicePixelRatio || 1), textureRatio: 1 });
        md.viz.connectAudio(M._src);
        loadPreset();
      }).catch(function () { md.failed = true; pref.vis.mode = 'bars'; label(); });
      return md.loading;
    }
    function loadPreset() { var m = cur(); if (md.viz && m.md && md.presets[m.md]) md.viz.loadPreset(md.presets[m.md], 1.5); }
    function closeMenus() { document.querySelectorAll('.mp-vismenu').forEach(function (x) { x.hidden = true; }); document.querySelectorAll('[aria-haspopup="menu"]').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); }); }
    document.addEventListener('click', function (e) { if (!e.target.closest || !e.target.closest('.mp-vismenu')) closeMenus(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenus(); });
    // The drop-down of visualizations
    function menu(box, btn) {
      var open = box.hidden;
      closeMenus();
      if (!open) return;
      mdInfo().then(function () {
        box.textContent = '';
        function item(m) {
          box.appendChild(el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(cur().id === m.id), text: m.by ? m.name + ', by ' + m.by : m.name, title: m.by ? 'MilkDrop preset by ' + m.by : null,
            onclick: function (e) { e.stopPropagation(); closeMenus(); show(); setMode(m.id); } }));
        }
        GROUPS.forEach(function (gr) { box.appendChild(el('small', { text: gr[1] })); MODES.filter(function (m) { return m.group === gr[0]; }).forEach(item); });
        if (MD_LIST.length) { box.appendChild(el('small', { text: 'MilkDrop (Butterchurn)' })); MD_LIST.forEach(item); }
        box.hidden = false; btn.setAttribute('aria-expanded', 'true');
        var first = box.querySelector('[aria-checked="true"]') || box.querySelector('button'); if (first) first.focus();
      });
    }
    function build() {
      win = el('div', { class: 'mp-vis', role: 'region', 'aria-label': 'Music visualizer' });
      winMenu = el('div', { class: 'mp-vismenu', role: 'menu', hidden: true });
      modeBtn = el('button', { type: 'button', class: 'mp-vis-pick', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Choose a visualization', onclick: function (e) { e.stopPropagation(); menu(winMenu, modeBtn); } });
      var bMin = el('button', { type: 'button', title: 'Collapse', 'aria-label': 'Collapse visualizer', text: '▁', onclick: function () { collapsed = !collapsed; win.classList.toggle('collapsed', collapsed); bMin.textContent = collapsed ? '▔' : '▁'; bMin.setAttribute('aria-label', collapsed ? 'Expand visualizer' : 'Collapse visualizer'); loop(); } });
      var bMax = el('button', { type: 'button', title: 'Full screen', 'aria-label': 'Full screen', text: '□', onclick: maxToggle });
      var bX = el('button', { type: 'button', title: 'Close', 'aria-label': 'Close visualizer', text: '×', onclick: hide });
      var head = el('div', { class: 'mp-vis-head' }, [el('span', { class: 'mp-vis-name', text: 'Visualizer' }), el('span', { class: 'mp-vis-pickwrap' }, [modeBtn, winMenu]), el('span', { class: 'mp-vis-btns' }, [bMin, bMax, bX])]);
      head.addEventListener('mouseleave', function () { if (win.classList.contains('max')) peek(); });
      cv = el('canvas', { class: 'mp-vis-cv', ondblclick: maxToggle });
      cv2 = el('canvas', { class: 'mp-vis-cv mp-vis-gl', ondblclick: maxToggle });
      fr = el('iframe', { class: 'mp-vis-cv mp-vis-fr', title: 'Screensaver', tabindex: '-1' });
      win.appendChild(head); win.appendChild(cv); win.appendChild(cv2); win.appendChild(fr);
      document.body.appendChild(win);
      g = cv.getContext('2d');
      try { build.ok = !!document.createElement('canvas').getContext('webgl2'); } catch (e) { build.ok = false; }
      document.addEventListener('fullscreenchange', function () { win.classList.toggle('max', document.fullscreenElement === win); win.classList.remove('peek'); });
      // In full screen the title bar tucks away and comes back when you move the mouse or tap
      var hideT = 0;
      function peek() { win.classList.add('peek'); clearTimeout(hideT); hideT = setTimeout(function () { if (!head.matches(':hover') && !winMenu.offsetParent) win.classList.remove('peek'); }, 1800); }
      var idleT = 0;   // in full screen the pointer hides after a few still seconds and comes back when it moves
      win.addEventListener('mousemove', function (e) {
        win.classList.remove('idle'); clearTimeout(idleT);
        if (!win.classList.contains('max')) return;
        idleT = setTimeout(function () { if (win.classList.contains('max')) win.classList.add('idle'); }, 3000);
        var r = win.getBoundingClientRect(); if (e.clientY - r.top < 60) peek();
      }, { passive: true });
      win.addEventListener('touchstart', function () { if (win.classList.contains('max')) peek(); }, { passive: true });
      win.addEventListener('keydown', function (e) { if (e.key === 'Tab') peek(); });
      if (typeof pref.vis.mode !== 'string') pref.vis.mode = 'bars';
      label();
      if (cur().md || /^md:/.test(pref.vis.mode)) startMd();
    }
    function label() {
      var m = cur();
      if (modeBtn) modeBtn.textContent = m.name + ' ▾';
      if (!win) return;
      win.classList.toggle('gl', !!m.md); win.classList.toggle('fr', !!m.frame);
      var want = m.frame ? ROOT + m.frame : '';
      if (fr.getAttribute('data-src') !== want) { fr.setAttribute('data-src', want); fr.src = want || 'about:blank'; }
    }
    function maxToggle() {
      if (document.fullscreenElement === win) { document.exitFullscreen(); return; }
      if (win.classList.contains('max')) { win.classList.remove('max'); return; }
      if (win.requestFullscreen) win.requestFullscreen().catch(function () { win.classList.add('max'); }); else win.classList.add('max');
      if (document.activeElement && win.contains(document.activeElement)) document.activeElement.blur();   // let the title bar tuck away
    }
    function show() { if (!win) build(); win.hidden = false; label(); loop(); }
    function hide() { if (document.fullscreenElement === win) document.exitFullscreen(); win.classList.remove('max'); win.hidden = true; cancelAnimationFrame(raf); raf = 0; if (fr) { fr.removeAttribute('data-src'); fr.src = 'about:blank'; } }
    function loop() { if (!raf && win && !win.hidden && !collapsed) raf = requestAnimationFrame(frame); }
    function frame() {
      raf = 0;
      if (!win || win.hidden || collapsed) return;
      var m = cur(), dpr = Math.min(2, window.devicePixelRatio || 1), c0 = m.md ? cv2 : cv;
      var w = Math.max(10, Math.floor(c0.clientWidth * dpr)), h = Math.max(10, Math.floor(c0.clientHeight * dpr));
      if (m.frame) { raf = requestAnimationFrame(frame); return; }
      if (m.md) {
        if (md.viz) { var key = w + 'x' + h; if (md.size !== key) { md.size = key; cv2.width = w; cv2.height = h; md.viz.setRendererSize(w, h); } md.viz.render(); }
      } else {
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; plasma = null; }
        var live = analyser && !audio.paused;
        if (live) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave); }
        else { for (var i = 0; i < freq.length; i++) freq[i] = Math.max(0, freq[i] - 6); for (var j = 0; j < wave.length; j++) wave[j] = 128 + Math.sin(j / 60 + t * 2) * 6; }
        // smoothed levels, so nothing jumps from frame to frame
        sm.bass += (energy(1, 12) - sm.bass) * 0.08; sm.mid += (energy(12, 120) - sm.mid) * 0.08; sm.all += (energy(1, 400) - sm.all) * 0.08;
        t += 1 / 60;
        m.fn(w, h, dpr);
      }
      raf = requestAnimationFrame(frame);
    }
    function energy(a, b) { var s = 0; for (var i = a; i < b; i++) s += freq[i]; return s / ((b - a) * 255); }
    function bandVal(i, n) { var a = Math.floor(Math.pow(i / n, 1.7) * 700) + 1, b = Math.floor(Math.pow((i + 1) / n, 1.7) * 700) + 2; return energy(a, b); }
    function bars(w, h, dpr) {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      var n = w < 400 * dpr ? 32 : 64, gap = Math.max(1, Math.floor(w / n * 0.18)), bw = w / n;
      var grad = g.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, '#1ee34a'); grad.addColorStop(0.6, '#f2e93a'); grad.addColorStop(1, '#ff3b3b');
      for (var i = 0; i < n; i++) {
        var bh = bandVal(i, n) * h * 0.95;
        peaks[i] = Math.max((peaks[i] || 0) - h * 0.008, bh);
        g.fillStyle = grad; g.fillRect(i * bw + gap / 2, h - bh, bw - gap, bh);
        g.fillStyle = '#fff'; g.fillRect(i * bw + gap / 2, h - peaks[i] - 3 * dpr, bw - gap, 2 * dpr);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)'; for (var y = h; y > 0; y -= 4 * dpr) g.fillRect(0, y, w, dpr);
    }
    function mirror(w, h) {
      g.fillStyle = 'rgba(4,0,18,0.35)'; g.fillRect(0, 0, w, h);
      var n = 48, bw = w / n;
      for (var i = 0; i < n; i++) {
        var v = bandVal(i, n), bh = v * h * 0.46;
        g.fillStyle = 'hsl(' + ((i / n) * 280 + t * 12) % 360 + ',90%,' + (45 + v * 20) + '%)';
        g.fillRect(i * bw + 1, h / 2 - bh, bw - 2, bh * 2);
      }
    }
    function scope(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, w, h);
      var hue = (t * 25) % 360;
      g.lineWidth = 2.5 * dpr; g.strokeStyle = 'hsl(' + hue + ',100%,60%)'; g.shadowColor = g.strokeStyle; g.shadowBlur = 12 * dpr;
      g.beginPath();
      for (var i = 0; i < w; i += 2) { var v = wave[Math.floor(i / w * wave.length)] / 128 - 1, y = h / 2 + v * h * 0.42; if (i) g.lineTo(i, y); else g.moveTo(i, y); }
      g.stroke(); g.shadowBlur = 0;
    }
    function ambience(w, h) {
      var pw = 96, ph = Math.max(20, Math.round(96 * h / w));
      if (!plasma || plasma.width !== pw) plasma = g.createImageData(pw, ph);
      phase += (0.006 + sm.bass * 0.02);   // speeds up a little with the beat, never jumps
      var d = plasma.data, k = phase;
      for (var y = 0; y < ph; y++) for (var x = 0; x < pw; x++) {
        var v = Math.sin(x / 9 + k) + Math.sin(y / 7 - k * 1.3) + Math.sin((x + y) / 11 + k * 0.7) + Math.sin(Math.sqrt((x - pw / 2) * (x - pw / 2) + (y - ph / 2) * (y - ph / 2)) / 6 - k * 2);
        var o = (y * pw + x) * 4, c = v * Math.PI / 2;
        d[o] = 110 + 100 * Math.sin(c + t * 0.15); d[o + 1] = 60 + 55 * Math.sin(c + 2.1 + sm.mid); d[o + 2] = 130 + 100 * Math.sin(c + 4.2); d[o + 3] = 255;
      }
      var tmp = VIS._tmp || (VIS._tmp = document.createElement('canvas')); tmp.width = pw; tmp.height = ph; tmp.getContext('2d').putImageData(plasma, 0, 0);
      g.imageSmoothingEnabled = true; g.drawImage(tmp, 0, 0, w, h);
    }
    function alchemy(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,8,0.16)'; g.fillRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.18, n = 96;
      g.save(); g.translate(cx, cy); g.rotate(t * 0.3);
      for (var ring = 0; ring < 3; ring++) {
        g.beginPath();
        for (var i = 0; i <= n; i++) {
          var a = i / n * Math.PI * 2, v = freq[(Math.floor(i / n * 300) + ring * 40) % 512] / 255;
          var r = R * (1 + ring * 0.55) + v * R * (1 + sm.bass);
          var x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.strokeStyle = 'hsla(' + ((t * 30 + ring * 110) % 360) + ',100%,62%,0.9)'; g.lineWidth = (2 - ring * 0.4) * dpr; g.stroke();
      }
      g.restore();
    }
    function starfield(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,10,0.3)'; g.fillRect(0, 0, w, h);
      while (stars.length < 220) stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() });
      var sp = 0.004 + sm.all * 0.03;
      stars.forEach(function (s) {
        s.z -= sp; if (s.z <= 0.02) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; }
        var px = w / 2 + s.x / s.z * w * 0.5, py = h / 2 + s.y / s.z * h * 0.5, r = (1 - s.z) * 2.2 * dpr;
        if (px < 0 || px > w || py < 0 || py > h) { s.z = 0; return; }
        g.fillStyle = 'hsla(' + (200 + s.x * 60) + ',80%,' + (60 + (1 - s.z) * 30) + '%,' + (1 - s.z) + ')';
        g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
      });
    }
    // ---- Classic Media Player looks ----
    function oceanMist(w, h, dpr) {
      g.globalAlpha = 0.92; g.drawImage(cv, 0, -1.5 * dpr); g.globalAlpha = 1;   // the old frame drifts up like mist
      g.fillStyle = 'rgba(0,8,30,0.10)'; g.fillRect(0, 0, w, h);
      var n = 64, bw = w / n;
      for (var i = 0; i < n; i++) {
        var v = bandVal(i, n), bh = v * h * 0.7;
        var gr = g.createLinearGradient(0, h, 0, h - bh); gr.addColorStop(0, 'rgba(40,120,255,0.9)'); gr.addColorStop(1, 'rgba(160,240,255,0.6)');
        g.fillStyle = gr; g.fillRect(i * bw + bw * 0.3, h - bh, bw * 0.4, bh);
      }
    }
    var embers = [];
    function fireStorm(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 0, w, h);
      var n = 40;
      for (var i = 0; i < n; i++) {
        var v = bandVal(i, n);
        if (Math.random() < v * 0.9) embers.push({ x: (i + Math.random()) * w / n, y: h, vy: -(1 + v * 5) * dpr, life: 1, r: (2 + v * 4) * dpr });
      }
      embers = embers.filter(function (e) { return e.life > 0; }).slice(-900);
      embers.forEach(function (e) {
        e.y += e.vy; e.x += Math.sin(e.y / 20 + t) * 0.6 * dpr; e.life -= 0.015;
        g.fillStyle = 'hsla(' + (15 + e.life * 40) + ',100%,' + (35 + e.life * 30) + '%,' + e.life + ')';
        g.beginPath(); g.arc(e.x, e.y, e.r * e.life + dpr, 0, Math.PI * 2); g.fill();
      });
    }
    function spiderWeb(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,10,0.25)'; g.fillRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2, n = 24, R = Math.min(w, h) * 0.42, pts = [];
      for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2 + t * 0.15, r = R * (0.45 + bandVal(i % 12, 12) * 0.6); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      g.lineWidth = dpr;
      for (var j = 0; j < n; j++) for (var k = 1; k <= 5; k++) {
        var q = pts[(j + k * 3) % n];
        g.strokeStyle = 'hsla(' + ((j * 15 + t * 20) % 360) + ',80%,65%,0.35)';
        g.beginPath(); g.moveTo(pts[j][0], pts[j][1]); g.lineTo(q[0], q[1]); g.stroke();
      }
    }
    function circleDance(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.28;
      for (var i = 0; i < 7; i++) {
        var a = t * (0.3 + i * 0.07) + i * 0.9, v = bandVal(i * 2, 14);
        var x = cx + Math.cos(a) * R * (0.6 + i * 0.08), y = cy + Math.sin(a * 1.3) * R * 0.8;
        g.strokeStyle = 'hsla(' + (i * 50 + t * 15) % 360 + ',90%,60%,0.85)'; g.lineWidth = 2 * dpr;
        g.beginPath(); g.arc(x, y, (8 + v * Math.min(w, h) * 0.18) , 0, Math.PI * 2); g.stroke();
      }
    }
    // ---- Classic screensavers ----
    var mz = null;
    function makeMaze(n) {
      var W = n * 2 + 1, m = [], i, j;
      for (i = 0; i < W; i++) { m.push([]); for (j = 0; j < W; j++) m[i].push(1); }
      var path = [], st = [[1, 1]], seen = {}; m[1][1] = 0; seen['1,1'] = 1; path.push([1, 1]);
      while (st.length) {
        var c = st[st.length - 1], nb = [[2, 0], [-2, 0], [0, 2], [0, -2]].map(function (d) { return [c[0] + d[0], c[1] + d[1], d]; })
          .filter(function (q) { return q[0] > 0 && q[1] > 0 && q[0] < W - 1 && q[1] < W - 1 && !seen[q[0] + ',' + q[1]]; });
        if (!nb.length) { st.pop(); if (st.length) path.push(st[st.length - 1]); continue; }
        var q2 = nb[Math.floor(Math.random() * nb.length)];
        m[c[0] + q2[2][0] / 2][c[1] + q2[2][1] / 2] = 0; m[q2[0]][q2[1]] = 0; seen[q2[0] + ',' + q2[1]] = 1; st.push([q2[0], q2[1]]); path.push([q2[0], q2[1]]);
      }
      // walk through every opening, one cell at a time
      var steps = [];
      for (i = 1; i < path.length; i++) { var a0 = path[i - 1], b0 = path[i]; steps.push([(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2]); steps.push(b0); }
      return { m: m, W: W, steps: [[1, 1]].concat(steps), k: 0, f: 0, x: 1.5, y: 1.5, ang: 0, tex: null };
    }
    function maze(w, h) {
      if (!mz) mz = makeMaze(8);
      var lw = 240, lh = Math.max(120, Math.round(240 * h / w));
      var off = VIS._mz || (VIS._mz = document.createElement('canvas'));
      if (off.width !== lw || off.height !== lh) { off.width = lw; off.height = lh; }
      var o = off.getContext('2d');
      // move along the path, turning smoothly toward the next opening
      var a = mz.steps[mz.k], b = mz.steps[mz.k + 1];
      if (!b) { mz = makeMaze(8); return; }
      var want = Math.atan2(b[1] - a[1], b[0] - a[0]), diff = Math.atan2(Math.sin(want - mz.ang), Math.cos(want - mz.ang));
      if (Math.abs(diff) > 0.04) mz.ang += Math.sign(diff) * Math.min(Math.abs(diff), 0.06);
      else { mz.ang = want; mz.f += 0.025; if (mz.f >= 1) { mz.f = 0; mz.k++; } }
      mz.x = a[0] + 0.5 + (b[0] - a[0]) * (Math.abs(diff) > 0.04 ? 0 : mz.f); mz.y = a[1] + 0.5 + (b[1] - a[1]) * (Math.abs(diff) > 0.04 ? 0 : mz.f);
      var sky = o.createLinearGradient(0, 0, 0, lh / 2); sky.addColorStop(0, '#3a3a52'); sky.addColorStop(1, '#6b6b86');
      o.fillStyle = sky; o.fillRect(0, 0, lw, lh / 2);
      var fl = o.createLinearGradient(0, lh / 2, 0, lh); fl.addColorStop(0, '#2b241d'); fl.addColorStop(1, '#6e5a44');
      o.fillStyle = fl; o.fillRect(0, lh / 2, lw, lh / 2);
      var fov = 1.0, pulse = 0.85 + sm.bass * 0.25;
      for (var col = 0; col < lw; col++) {
        var ra = mz.ang + (col / lw - 0.5) * fov, dx = Math.cos(ra), dy = Math.sin(ra);
        var mx = Math.floor(mz.x), my = Math.floor(mz.y), sx = Math.abs(1 / dx), sy = Math.abs(1 / dy), stx = dx < 0 ? -1 : 1, sty = dy < 0 ? -1 : 1;
        var tx = (dx < 0 ? mz.x - mx : mx + 1 - mz.x) * sx, ty = (dy < 0 ? mz.y - my : my + 1 - mz.y) * sy, side = 0, guard = 0;
        while (guard++ < 64) { if (tx < ty) { tx += sx; mx += stx; side = 0; } else { ty += sy; my += sty; side = 1; } if (!mz.m[mx] || mz.m[mx][my]) break; }
        var dist = (side ? ty - sy : tx - sx) * Math.cos(ra - mz.ang), wh = Math.min(lh * 3, lh / Math.max(0.05, dist));
        var u = side ? mz.x + dist / Math.cos(ra - mz.ang) * dx : mz.y + dist / Math.cos(ra - mz.ang) * dy; u -= Math.floor(u);
        var top = (lh - wh) / 2, shade = Math.max(0.25, 1 - dist / 9) * (side ? 0.8 : 1) * pulse;
        for (var r = 0; r < 6; r++) {   // brick rows with mortar
          var y0 = top + wh * r / 6, y1 = top + wh * (r + 1) / 6, off2 = (r % 2) * 0.5, uu = (u * 2 + off2) % 1;
          o.fillStyle = 'rgb(' + Math.round(150 * shade) + ',' + Math.round(58 * shade) + ',' + Math.round(40 * shade) + ')';
          o.fillRect(col, y0, 1, y1 - y0);
          o.fillStyle = 'rgb(' + Math.round(70 * shade) + ',' + Math.round(62 * shade) + ',' + Math.round(55 * shade) + ')';
          if (uu < 0.06) o.fillRect(col, y0, 1, y1 - y0); else o.fillRect(col, y0, 1, Math.max(0.6, (y1 - y0) * 0.08));
        }
      }
      g.imageSmoothingEnabled = false; g.drawImage(off, 0, 0, w, h);
    }
    var poly = null;
    function mystic(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(0, 0, w, h);
      if (!poly) { poly = [0, 1].map(function (s2) { return { hue: s2 * 180, pts: [0, 1, 2, 3].map(function () { return { x: Math.random() * w, y: Math.random() * h, vx: (Math.random() * 2 + 1) * (Math.random() < 0.5 ? -1 : 1), vy: (Math.random() * 2 + 1) * (Math.random() < 0.5 ? -1 : 1) }; }) }; }); }
      var sp = 1 + sm.all * 2;
      poly.forEach(function (pg) {
        pg.hue = (pg.hue + 0.3) % 360;
        pg.pts.forEach(function (q) { q.x += q.vx * sp * dpr; q.y += q.vy * sp * dpr; if (q.x < 0 || q.x > w) q.vx *= -1; if (q.y < 0 || q.y > h) q.vy *= -1; q.x = Math.max(0, Math.min(w, q.x)); q.y = Math.max(0, Math.min(h, q.y)); });
        g.strokeStyle = 'hsl(' + pg.hue + ',100%,60%)'; g.lineWidth = 1.5 * dpr;
        g.beginPath(); pg.pts.forEach(function (q, i) { if (i) g.lineTo(q.x, q.y); else g.moveTo(q.x, q.y); }); g.closePath(); g.stroke();
      });
    }
    var bz = null;
    function bezier(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(0, 0, w, h);
      if (!bz) bz = [0, 1, 2, 3].map(function () { return { x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4 }; });
      var sp = 0.8 + sm.all * 2;
      bz.forEach(function (q) { q.x += q.vx * sp * dpr; q.y += q.vy * sp * dpr; if (q.x < 0 || q.x > w) q.vx *= -1; if (q.y < 0 || q.y > h) q.vy *= -1; });
      for (var k = 0; k < 3; k++) {
        g.strokeStyle = 'hsla(' + ((t * 25 + k * 40) % 360) + ',90%,60%,0.8)'; g.lineWidth = 1.5 * dpr;
        g.beginPath(); g.moveTo(bz[0].x, bz[0].y + k * 10 * dpr); g.bezierCurveTo(bz[1].x, bz[1].y + k * 10 * dpr, bz[2].x, bz[2].y + k * 10 * dpr, bz[3].x, bz[3].y + k * 10 * dpr); g.stroke();
      }
    }
    var fish = null, bubbles = [];
    function fishTank(w, h, dpr) {
      var water = g.createLinearGradient(0, 0, 0, h); water.addColorStop(0, '#0b6fa8'); water.addColorStop(1, '#03264a');
      g.fillStyle = water; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c8a86a'; g.beginPath(); g.moveTo(0, h); for (var x = 0; x <= w; x += 20 * dpr) g.lineTo(x, h - 14 * dpr - Math.sin(x / (40 * dpr)) * 5 * dpr); g.lineTo(w, h); g.fill();
      for (var s2 = 0; s2 < 7; s2++) {   // swaying seaweed
        var bx = (s2 + 0.5) * w / 7; g.strokeStyle = s2 % 2 ? '#2f8f3f' : '#3fae4f'; g.lineWidth = 5 * dpr; g.beginPath(); g.moveTo(bx, h - 10 * dpr);
        for (var k = 1; k <= 6; k++) g.lineTo(bx + Math.sin(t * 1.2 + k * 0.6 + s2) * 8 * dpr, h - 10 * dpr - k * h * 0.07); g.stroke();
      }
      if (!fish) fish = [];
      while (fish.length < 9) fish.push({ x: Math.random() * w, y: h * (0.15 + Math.random() * 0.6), v: (0.5 + Math.random()) * (Math.random() < 0.5 ? -1 : 1), s: (10 + Math.random() * 14), hue: Math.floor(Math.random() * 360), ph: Math.random() * 6 });
      fish.forEach(function (f) {
        f.x += f.v * dpr * (1 + sm.all); f.y += Math.sin(t + f.ph) * 0.3 * dpr;
        if (f.x < -40 * dpr) { f.v = Math.abs(f.v); } if (f.x > w + 40 * dpr) { f.v = -Math.abs(f.v); }
        var s3 = f.s * dpr, dir = f.v > 0 ? 1 : -1, wag = Math.sin(t * 8 + f.ph) * s3 * 0.25;
        g.save(); g.translate(f.x, f.y); g.scale(dir, 1);
        g.fillStyle = 'hsl(' + f.hue + ',85%,55%)';
        g.beginPath(); g.ellipse(0, 0, s3, s3 * 0.55, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.moveTo(-s3 * 0.8, 0); g.lineTo(-s3 * 1.6, -s3 * 0.6 + wag); g.lineTo(-s3 * 1.6, s3 * 0.6 + wag); g.closePath(); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(s3 * 0.5, -s3 * 0.12, s3 * 0.17, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#000'; g.beginPath(); g.arc(s3 * 0.55, -s3 * 0.12, s3 * 0.08, 0, Math.PI * 2); g.fill();
        g.restore();
      });
      if (Math.random() < 0.08 + sm.bass * 0.4) bubbles.push({ x: Math.random() * w, y: h, r: (2 + Math.random() * 4) * dpr });
      bubbles = bubbles.filter(function (b) { return b.y > -10; }).slice(-120);
      g.strokeStyle = 'rgba(220,240,255,0.7)'; g.lineWidth = dpr;
      bubbles.forEach(function (b) { b.y -= (1 + b.r / dpr * 0.3) * dpr; b.x += Math.sin(b.y / 15) * 0.4 * dpr; g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.stroke(); });
    }
    var dice = [], diceImg = null;
    function flyingDice(w, h, dpr) {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      if (!diceImg) { diceImg = new Image(); diceImg.src = ROOT + 'assets/icons/d10.svg'; }
      while (dice.length < 26) dice.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() + 0.1, rot: Math.random() * 6 });
      var sp = 0.005 + sm.all * 0.02;
      dice.forEach(function (d) {
        d.z -= sp; d.rot += 0.01; if (d.z <= 0.05) { d.x = Math.random() * 2 - 1; d.y = Math.random() * 2 - 1; d.z = 1.1; }
        var px = w / 2 + d.x / d.z * w * 0.35, py = h / 2 + d.y / d.z * h * 0.35, sz = (1.15 - d.z) * 60 * dpr;
        if (!diceImg.complete || sz <= 0) return;
        g.save(); g.translate(px, py); g.rotate(d.rot); g.globalAlpha = Math.min(1, (1.15 - d.z) * 1.4); g.drawImage(diceImg, -sz / 2, -sz / 2, sz, sz); g.restore();
      });
      g.globalAlpha = 1;
    }
    return { show: show, hide: hide, menu: menu };
  })();
  M.visualizer = VIS;
})();
