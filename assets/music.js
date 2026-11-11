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
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = ROOT + 'assets/music.css?v=ee1b939d'; document.head.appendChild(css);
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
    var win = null, cv = null, cv2 = null, fr = null, g = null, raf = 0, collapsed = false, modeBtn = null, winMenu = null, speedBtn = null, speedMenu = null;
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
      { id: 'labyrinth', name: 'Labyrinth', fn: labyrinth, group: 'saver' },
      { id: 'stars', name: 'Starfield', fn: starfield, group: 'saver' },
      { id: 'mystic', name: 'Mystic Lines', fn: mystic, group: 'saver' },
      { id: 'bezier', name: 'Bezier Ribbons', fn: bezier, group: 'saver' },
      { id: 'fish', name: 'Fish Tank', frame: 'vendor/webgl-aquarium/aquarium/aquarium.html?numFish=100&fitWindow=true', by: 'Google (WebGL Aquarium)', group: 'saver' },
      { id: 'dvd', name: 'DVD Bounce', fn: dvdBounce, group: 'saver' },
      { id: 'dice', name: 'Flying Dice', fn: flyingDice, group: 'saver' }
    ];
    var GROUPS = [['media', 'Classic Media Player'], ['saver', 'Classic Screensavers']];
    var MD_LIST = [];   // filled from assets/music/milkdrop.json
    function allModes() { return MODES.concat(MD_LIST); }
    function cur() { var id = pref.vis.mode; return allModes().filter(function (m) { return m.id === id; })[0] || MODES[0]; }
    function setMode(id) { pref.vis.mode = id; savePref(); plasma = null; label(); if (cur().md) startMd(); }
    function mdInfo() {
      if (md.presets) return Promise.resolve();
      return fetch(ROOT + 'assets/music/milkdrop.json?v=37519469').then(function (r) { return r.json(); }).then(function (d) {
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
    // Speed: a steady Slow, Normal or Fast, or Follow the Music, which slows right down in quiet parts and races on loud ones
    var SPEEDS = [['slow', 'Slow', 0.5], ['normal', 'Normal', 1], ['fast', 'Fast', 1.8], ['music', 'Follow the Music', 0]];
    var follow = 1;
    function speedMult() {
      var sp = pref.vis.speed || 'normal';
      if (sp !== 'music') { var f = SPEEDS.filter(function (x) { return x[0] === sp; })[0]; return f ? f[2] : 1; }
      var live = analyser && !audio.paused, want = live ? 0.2 + sm.all * 3.2 + sm.bass * 1.6 : 0.3;
      follow += (Math.min(3.2, want) - follow) * ease(0.12);
      return follow;
    }
    function speedMenuOpen(box, btn) {
      var open = box.hidden;
      closeMenus();
      if (!open) return;
      box.textContent = '';
      box.appendChild(el('small', { text: 'Speed' }));
      SPEEDS.forEach(function (x) {
        box.appendChild(el('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String((pref.vis.speed || 'normal') === x[0]), text: x[1],
          onclick: function (e) { e.stopPropagation(); closeMenus(); pref.vis.speed = x[0]; savePref(); label(); } }));
      });
      box.hidden = false; btn.setAttribute('aria-expanded', 'true');
      (box.querySelector('[aria-checked="true"]') || box.querySelector('button')).focus();
    }
    function build() {
      win = el('div', { class: 'mp-vis', role: 'region', 'aria-label': 'Music visualizer' });
      winMenu = el('div', { class: 'mp-vismenu', role: 'menu', hidden: true });
      speedMenu = el('div', { class: 'mp-vismenu', role: 'menu', hidden: true });
      speedBtn = el('button', { type: 'button', class: 'mp-vis-pick mp-vis-speed', 'aria-haspopup': 'menu', 'aria-expanded': 'false', text: 'Speed ▾', onclick: function (e) { e.stopPropagation(); speedMenuOpen(speedMenu, speedBtn); } });
      modeBtn = el('button', { type: 'button', class: 'mp-vis-pick', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: 'Choose a visualization', onclick: function (e) { e.stopPropagation(); menu(winMenu, modeBtn); } });
      var bMin = el('button', { type: 'button', title: 'Collapse', 'aria-label': 'Collapse visualizer', text: '▁', onclick: function () { collapsed = !collapsed; win.classList.toggle('collapsed', collapsed); bMin.textContent = collapsed ? '▔' : '▁'; bMin.setAttribute('aria-label', collapsed ? 'Expand visualizer' : 'Collapse visualizer'); loop(); } });
      var bMax = el('button', { type: 'button', title: 'Full screen', 'aria-label': 'Full screen', text: '□', onclick: maxToggle });
      var bX = el('button', { type: 'button', title: 'Close', 'aria-label': 'Close visualizer', text: '×', onclick: hide });
      var head = el('div', { class: 'mp-vis-head' }, [el('span', { class: 'mp-vis-name', text: 'Visualizer' }), el('span', { class: 'mp-vis-pickwrap mp-vis-speedwrap' }, [speedBtn, speedMenu]), el('span', { class: 'mp-vis-pickwrap' }, [modeBtn, winMenu]), el('span', { class: 'mp-vis-btns' }, [bMin, bMax, bX])]);
      head.addEventListener('mouseleave', function () { if (win.classList.contains('max')) peek(); });
      cv = el('canvas', { class: 'mp-vis-cv', ondblclick: maxToggle });
      cv2 = el('canvas', { class: 'mp-vis-cv mp-vis-gl', ondblclick: maxToggle });
      fr = el('iframe', { class: 'mp-vis-cv mp-vis-fr', title: 'Screensaver', tabindex: '-1' });
      win.appendChild(head); win.appendChild(cv); win.appendChild(cv2); win.appendChild(fr);
      document.body.appendChild(win);
      g = cv.getContext('2d');
      try { build.ok = !!document.createElement('canvas').getContext('webgl2'); } catch (e) { build.ok = false; }
      document.addEventListener('fullscreenchange', function () { win.classList.toggle('max', document.fullscreenElement === win); win.classList.remove('peek'); fit(); });
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
      if (speedBtn) {
        var spn = SPEEDS.filter(function (x) { return x[0] === (pref.vis.speed || 'normal'); })[0] || SPEEDS[1];
        speedBtn.disabled = false;
        speedBtn.title = 'Speed: ' + spn[1];
      }
      if (!win) return;
      win.classList.toggle('gl', !!m.md); win.classList.toggle('fr', !!m.frame);
      var want = m.frame ? ROOT + m.frame : '';
      if (fr.getAttribute('data-src') !== want) { fr.setAttribute('data-src', want); fr.src = want || 'about:blank'; }
    }
    function maxToggle() {
      if (document.fullscreenElement === win) { document.exitFullscreen(); return; }
      if (win.classList.contains('max')) { win.classList.remove('max'); fit(); return; }
      win.style.width = ''; [cv, cv2, fr].forEach(function (p) { p.style.height = ''; });
      if (win.requestFullscreen) win.requestFullscreen().catch(function () { win.classList.add('max'); fit(); }); else { win.classList.add('max'); fit(); }
      if (document.activeElement && win.contains(document.activeElement)) document.activeElement.blur();   // let the title bar tuck away
    }
    // On a computer the small window grows to fill the space to the right of the page's main area,
    // so it sits beside the book without covering it. Phones keep the small size from the stylesheet.
    function mainArea() {
      var sel = ['.layout', '.os-main', 'main.content', 'main', '.page'];
      for (var i = 0; i < sel.length; i++) { var e = document.querySelector(sel[i]); if (e && e.offsetWidth > 300) return e; }
      return null;
    }
    function fit() {
      if (!win) return;
      var parts = [cv, cv2, fr];
      if (win.classList.contains('max') || document.fullscreenElement === win || window.innerWidth <= 560) {
        win.style.width = ''; parts.forEach(function (p) { p.style.height = ''; }); return;
      }
      var area = mainArea(), vw = document.documentElement.clientWidth;
      var room = area ? vw - area.getBoundingClientRect().right - 28 : 300;
      var W = Math.round(Math.max(300, room)), H = Math.round(Math.max(170, Math.min(W * 0.62, window.innerHeight * 0.65)));
      win.style.width = W + 'px'; parts.forEach(function (p) { p.style.height = H + 'px'; });
    }
    var fitT = 0;
    window.addEventListener('resize', function () { clearTimeout(fitT); fitT = setTimeout(fit, 120); });
    function show() { if (!win) build(); win.hidden = false; label(); fit(); loop(); }
    function hide() { if (document.fullscreenElement === win) document.exitFullscreen(); win.classList.remove('max'); win.hidden = true; cancelAnimationFrame(raf); raf = 0; if (fr) { fr.removeAttribute('data-src'); fr.src = 'about:blank'; } }
    function loop() { if (!raf && win && !win.hidden && !collapsed) raf = requestAnimationFrame(frame); }
    // Every look moves by real time (dt, in seconds) and by the size of the window (U), so it runs at the
    // same pace in the small window and in full screen, on any screen. Each frame starts from solid black,
    // so nothing leaves streaks; where a look wants a tail, it redraws its own recent past and lets it go.
    var lastT = 0, dt = 1 / 60, K = 1, U = 100;
    function ease(rate) { return 1 - Math.pow(1 - rate, K); }   // a per-frame smoothing rate made frame-rate proof
    function clear(c) { g.globalAlpha = 1; g.shadowBlur = 0; g.fillStyle = c || '#000'; g.fillRect(0, 0, cv.width, cv.height); }
    function frame(now) {
      raf = 0;
      if (!win || win.hidden || collapsed) { lastT = 0; return; }
      now = now || performance.now();
      dt = lastT ? Math.min(0.05, Math.max(0.001, (now - lastT) / 1000)) : 1 / 60; lastT = now; K = dt * 60;
      var m = cur(), dpr = Math.min(2, window.devicePixelRatio || 1), c0 = m.md ? cv2 : cv;
      var w = Math.max(10, Math.floor(c0.clientWidth * dpr)), h = Math.max(10, Math.floor(c0.clientHeight * dpr));
      if (m.frame) {
        // the screensavers in their own pages still follow the Speed menu (3D Pipes and the WebGL Aquarium read these)
        if (m.id === 'fish' || m.id === 'pipes') {
          if (analyser && !audio.paused) { analyser.getByteFrequencyData(freq); sm.bass += (energy(1, 12) - sm.bass) * ease(0.08); sm.all += (energy(1, 400) - sm.all) * ease(0.08); }
          var spd = speedMult();
          try { var fw = fr.contentWindow; if (fw) { fw.pipeSpeed = spd; if (fw.g && fw.g.globals) fw.g.globals.speed = spd; } } catch (e) {}
        }
        raf = requestAnimationFrame(frame); return;
      }
      if (m.md) {
        if (md.viz) {
          var key = w + 'x' + h; if (md.size !== key) { md.size = key; cv2.width = w; cv2.height = h; md.viz.setRendererSize(w, h); }
          if (analyser && !audio.paused) { analyser.getByteFrequencyData(freq); sm.bass += (energy(1, 12) - sm.bass) * ease(0.08); sm.all += (energy(1, 400) - sm.all) * ease(0.08); }
          md.viz.render({ elapsedTime: dt * speedMult() });
        }
      } else {
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; plasma = null; }
        U = Math.min(w, h);
        var live = analyser && !audio.paused;
        if (live) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave); }
        else { for (var i = 0; i < freq.length; i++) freq[i] = Math.max(0, freq[i] - 6 * K); for (var j = 0; j < wave.length; j++) wave[j] = 128 + Math.sin(j / 60 + t * 2) * 6; }
        // smoothed levels, so nothing jumps from frame to frame
        var e = ease(0.08);
        sm.bass += (energy(1, 12) - sm.bass) * e; sm.mid += (energy(12, 120) - sm.mid) * e; sm.all += (energy(1, 400) - sm.all) * e;
        dt *= speedMult(); K = dt * 60;   // from here on, everything moves at the chosen speed
        t += dt;
        m.fn(w, h, dpr);
      }
      raf = requestAnimationFrame(frame);
    }
    function energy(a, b) { var s = 0; for (var i = a; i < b; i++) s += freq[i]; return s / ((b - a) * 255); }
    function bandVal(i, n) { var a = Math.floor(Math.pow(i / n, 1.7) * 700) + 1, b = Math.floor(Math.pow((i + 1) / n, 1.7) * 700) + 2; return energy(a, b); }
    function bars(w, h, dpr) {
      clear();
      var n = w < 400 * dpr ? 32 : 64, gap = Math.max(1, Math.floor(w / n * 0.18)), bw = w / n;
      var grad = g.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, '#1ee34a'); grad.addColorStop(0.6, '#f2e93a'); grad.addColorStop(1, '#ff3b3b');
      for (var i = 0; i < n; i++) {
        var bh = bandVal(i, n) * h * 0.95;
        peaks[i] = Math.max((peaks[i] || 0) - h * 0.48 * dt, bh);
        g.fillStyle = grad; g.fillRect(i * bw + gap / 2, h - bh, bw - gap, bh);
        g.fillStyle = '#fff'; g.fillRect(i * bw + gap / 2, h - peaks[i] - 3 * dpr, bw - gap, 2 * dpr);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)'; for (var y = h; y > 0; y -= 4 * dpr) g.fillRect(0, y, w, dpr);
    }
    function mirror(w, h) {
      clear('#040012');
      var n = 48, bw = w / n;
      for (var i = 0; i < n; i++) {
        var v = bandVal(i, n), bh = v * h * 0.46;
        g.fillStyle = 'hsl(' + ((i / n) * 280 + t * 12) % 360 + ',90%,' + (45 + v * 20) + '%)';
        g.fillRect(i * bw + 1, h / 2 - bh, bw - 2, bh * 2);
      }
    }
    function scope(w, h, dpr) {
      clear();
      var hue = (t * 25) % 360;
      g.lineWidth = 2.5 * dpr; g.strokeStyle = 'hsl(' + hue + ',100%,60%)'; g.shadowColor = g.strokeStyle; g.shadowBlur = 12 * dpr;
      g.beginPath();
      for (var i = 0; i < w; i += 2) { var v = wave[Math.floor(i / w * wave.length)] / 128 - 1, y = h / 2 + v * h * 0.42; if (i) g.lineTo(i, y); else g.moveTo(i, y); }
      g.stroke(); g.shadowBlur = 0;
    }
    var plasmaCv = null;
    function ambience(w, h) {
      var pw = 96, ph = Math.max(20, Math.round(96 * h / w));
      if (!plasma || plasma.width !== pw || plasma.height !== ph) plasma = g.createImageData(pw, ph);
      phase += (0.36 + sm.bass * 1.2) * dt;   // speeds up a little with the beat, never jumps
      var d = plasma.data, k = phase;
      for (var y = 0; y < ph; y++) for (var x = 0; x < pw; x++) {
        var v = Math.sin(x / 9 + k) + Math.sin(y / 7 - k * 1.3) + Math.sin((x + y) / 11 + k * 0.7) + Math.sin(Math.sqrt((x - pw / 2) * (x - pw / 2) + (y - ph / 2) * (y - ph / 2)) / 6 - k * 2);
        var o = (y * pw + x) * 4, c = v * Math.PI / 2;
        d[o] = 110 + 100 * Math.sin(c + t * 0.15); d[o + 1] = 60 + 55 * Math.sin(c + 2.1 + sm.mid); d[o + 2] = 130 + 100 * Math.sin(c + 4.2); d[o + 3] = 255;
      }
      if (!plasmaCv) plasmaCv = document.createElement('canvas');
      plasmaCv.width = pw; plasmaCv.height = ph; plasmaCv.getContext('2d').putImageData(plasma, 0, 0);
      g.imageSmoothingEnabled = true; g.drawImage(plasmaCv, 0, 0, w, h);
    }
    function alchemy(w, h, dpr) {
      clear('#000008');
      var cx = w / 2, cy = h / 2, R = U * 0.18, n = 96;
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
    // stars fly toward you at a steady pace; each one draws its own short streak, so nothing smears
    function starfield(w, h, dpr) {
      clear('#00000a');
      while (stars.length < 220) stars.push({ x: Math.random() * 2 - 1, y: Math.random() * 2 - 1, z: Math.random() });
      var sp = (0.22 + sm.all * 0.9) * dt, sc = Math.max(w, h) * 0.5;
      g.lineCap = 'round';
      stars.forEach(function (s) {
        var z0 = Math.min(1, s.z + sp * 3);
        s.z -= sp; if (s.z <= 0.02) { s.x = Math.random() * 2 - 1; s.y = Math.random() * 2 - 1; s.z = 1; return; }
        var px = w / 2 + s.x / s.z * sc, py = h / 2 + s.y / s.z * sc;
        if (px < -20 || px > w + 20 || py < -20 || py > h + 20) { s.z = 0; return; }
        var qx = w / 2 + s.x / z0 * sc, qy = h / 2 + s.y / z0 * sc, a = 1 - s.z;
        g.strokeStyle = 'hsla(' + (200 + s.x * 60) + ',80%,' + (60 + a * 30) + '%,' + a + ')';
        g.lineWidth = Math.max(dpr, a * U * 0.009);
        g.beginPath(); g.moveTo(qx, qy); g.lineTo(px, py); g.stroke();
      });
    }
    // ---- Classic Media Player looks ----
    var mist = [];   // recent bar heights, drawn drifting up and fading out
    function oceanMist(w, h, dpr) {
      clear('#00081e');
      var n = 64, bw = w / n, now = [];
      for (var i = 0; i < n; i++) now.push(bandVal(i, n));
      oceanMist.acc = (oceanMist.acc || 0) + dt;
      if (oceanMist.acc > 1 / 30) { oceanMist.acc = 0; mist.unshift(now); if (mist.length > 24) mist.pop(); }
      for (var k = mist.length - 1; k >= 0; k--) {
        var rise = k * h * 0.012, a = 0.22 * (1 - k / mist.length);
        g.fillStyle = 'rgba(120,200,255,' + a + ')';
        for (var j = 0; j < n; j++) { var bh0 = mist[k][j] * h * 0.7; g.fillRect(j * bw + bw * 0.2, h - bh0 - rise, bw * 0.6, Math.max(dpr, bh0 * 0.25)); }
      }
      for (var b = 0; b < n; b++) {
        var bh = now[b] * h * 0.7;
        var gr = g.createLinearGradient(0, h, 0, h - bh); gr.addColorStop(0, 'rgba(40,120,255,0.95)'); gr.addColorStop(1, 'rgba(160,240,255,0.8)');
        g.fillStyle = gr; g.fillRect(b * bw + bw * 0.3, h - bh, bw * 0.4, bh);
      }
    }
    var embers = [];
    function fireStorm(w, h, dpr) {
      clear();
      var n = 40;
      for (var i = 0; i < n; i++) {
        var v = bandVal(i, n);
        if (Math.random() < v * 0.9 * K) embers.push({ x: (i + Math.random()) / n, y: 1, vy: -(0.35 + v * 1.6), life: 1, r: 0.01 + v * 0.02, ph: Math.random() * 6 });
      }
      embers = embers.filter(function (e) { return e.life > 0; }).slice(-900);
      embers.forEach(function (e) {
        e.y += e.vy * dt; e.x += Math.sin(e.y * 12 + t + e.ph) * 0.04 * dt; e.life -= 0.9 * dt;
        if (e.life <= 0) return;
        g.fillStyle = 'hsla(' + (15 + e.life * 40) + ',100%,' + (35 + e.life * 30) + '%,' + e.life + ')';
        g.beginPath(); g.arc(e.x * w, e.y * h, e.r * U * e.life + dpr, 0, Math.PI * 2); g.fill();
      });
    }
    function spiderWeb(w, h, dpr) {
      clear('#00000a');
      var cx = w / 2, cy = h / 2, n = 24, R = U * 0.42, pts = [];
      for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2 + t * 0.15, r = R * (0.45 + bandVal(i % 12, 12) * 0.6); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      g.lineWidth = dpr;
      for (var j = 0; j < n; j++) for (var k = 1; k <= 5; k++) {
        var q = pts[(j + k * 3) % n];
        g.strokeStyle = 'hsla(' + ((j * 15 + t * 20) % 360) + ',80%,65%,0.55)';
        g.beginPath(); g.moveTo(pts[j][0], pts[j][1]); g.lineTo(q[0], q[1]); g.stroke();
      }
    }
    function circleDance(w, h, dpr) {
      clear();
      var cx = w / 2, cy = h / 2, R = U * 0.28;
      for (var i = 0; i < 7; i++) {
        var a = t * (0.3 + i * 0.07) + i * 0.9, v = bandVal(i * 2, 14);
        var x = cx + Math.cos(a) * R * (0.6 + i * 0.08) * (w / U > 1.4 ? 1.6 : 1), y = cy + Math.sin(a * 1.3) * R * 0.8;
        g.strokeStyle = 'hsla(' + (i * 50 + t * 15) % 360 + ',90%,60%,0.9)'; g.lineWidth = 2 * dpr;
        g.beginPath(); g.arc(x, y, U * 0.03 + v * U * 0.18, 0, Math.PI * 2); g.stroke();
      }
    }
    // ---- Classic screensavers ----
    // 3D Maze: walks the maze at a steady walking pace, easing into each turn, drawn at the window's own resolution
    var mz = null, mzCv = null;
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
      // the route through every opening, one cell at a time, with straight runs merged
      var steps = [[1, 1]];
      for (i = 1; i < path.length; i++) { var a0 = path[i - 1], b0 = path[i]; steps.push([(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2]); steps.push(b0); }
      var first = Math.atan2(steps[1][1] - 1, steps[1][0] - 1);
      return { m: m, W: W, steps: steps, k: 0, f: 0, x: 1.5, y: 1.5, ang: first };
    }
    // walk a maze's route at a steady pace, easing into each turn; starts a new maze at the end
    function walkMaze(st, n, pace) {
      var a = st.steps[st.k], b = st.steps[st.k + 1];
      if (!b) return makeMaze(n);
      var want = Math.atan2(b[1] - a[1], b[0] - a[0]), diff = Math.atan2(Math.sin(want - st.ang), Math.cos(want - st.ang));
      st.ang += Math.sign(diff) * Math.min(Math.abs(diff), (0.8 + Math.abs(diff) * 3.2) * dt);
      if (Math.abs(diff) < 0.35) { st.f += pace * dt * (1 - Math.abs(diff) / 0.35 * 0.8); if (st.f >= 1) { st.f -= 1; st.k++; if (!st.steps[st.k + 1]) st.f = 0; } }
      var a2 = st.steps[st.k], b2 = st.steps[st.k + 1] || a2;
      st.x = a2[0] + 0.5 + (b2[0] - a2[0]) * st.f; st.y = a2[1] + 0.5 + (b2[1] - a2[1]) * st.f;
      return st;
    }
    function maze(w, h, dpr) {
      if (!mz) mz = makeMaze(8);
      mz = walkMaze(mz, 8, 1.7);
      // render at up to 640 columns, then scale smoothly to the window
      var lw = Math.max(160, Math.min(640, Math.round(w / Math.max(1, dpr * 0.75)))), lh = Math.max(90, Math.round(lw * h / w));
      if (!mzCv) mzCv = document.createElement('canvas');
      if (mzCv.width !== lw || mzCv.height !== lh) { mzCv.width = lw; mzCv.height = lh; }
      var o = mzCv.getContext('2d');
      var sky = o.createLinearGradient(0, 0, 0, lh / 2); sky.addColorStop(0, '#3a3a52'); sky.addColorStop(1, '#6b6b86');
      o.fillStyle = sky; o.fillRect(0, 0, lw, lh / 2);
      var fl = o.createLinearGradient(0, lh / 2, 0, lh); fl.addColorStop(0, '#2b241d'); fl.addColorStop(1, '#6e5a44');
      o.fillStyle = fl; o.fillRect(0, lh / 2, lw, lh / 2);
      var fov = 1.05, pulse = 0.9 + sm.bass * 0.15, plane = Math.tan(fov / 2);
      var cdx = Math.cos(mz.ang), cdy = Math.sin(mz.ang), pdx = -cdy * plane, pdy = cdx * plane;
      for (var col = 0; col < lw; col++) {
        var cam = 2 * (col + 0.5) / lw - 1, dx = cdx + pdx * cam, dy = cdy + pdy * cam;
        var mx = Math.floor(mz.x), my = Math.floor(mz.y), sx = Math.abs(1 / dx), sy = Math.abs(1 / dy), stx = dx < 0 ? -1 : 1, sty = dy < 0 ? -1 : 1;
        var tx = (dx < 0 ? mz.x - mx : mx + 1 - mz.x) * sx, ty = (dy < 0 ? mz.y - my : my + 1 - mz.y) * sy, side = 0, guard = 0;
        while (guard++ < 64) { if (tx < ty) { tx += sx; mx += stx; side = 0; } else { ty += sy; my += sty; side = 1; } if (!mz.m[mx] || mz.m[mx][my]) break; }
        var dist = Math.max(0.05, side ? ty - sy : tx - sx), wh = lh / dist;   // perpendicular distance, so walls stay straight
        var u = side ? mz.x + dist * dx : mz.y + dist * dy; u -= Math.floor(u);
        var top = (lh - wh) / 2, shade = Math.max(0.22, 1 - dist / 9) * (side ? 0.8 : 1) * pulse;
        var br = 'rgb(' + Math.round(150 * shade) + ',' + Math.round(58 * shade) + ',' + Math.round(40 * shade) + ')';
        var mo = 'rgb(' + Math.round(70 * shade) + ',' + Math.round(62 * shade) + ',' + Math.round(55 * shade) + ')';
        o.fillStyle = br; o.fillRect(col, top, 1, wh);
        o.fillStyle = mo;
        for (var r = 0; r < 6; r++) {   // brick rows with mortar
          var y0 = top + wh * r / 6, uu = (u * 2 + (r % 2) * 0.5) % 1;
          if (uu < 0.05) o.fillRect(col, y0, 1, wh / 6); else o.fillRect(col, y0, 1, Math.max(0.6, wh / 6 * 0.08));
        }
      }
      g.imageSmoothingEnabled = true; g.drawImage(mzCv, 0, 0, w, h);
    }
    // Labyrinth: a dark stone corridor lit only by torches on the walls. Cobblestone floor, stone block walls,
    // stone slab ceiling, all made here as small textures. Each torch flickers and lights the stone around it.
    var lab = null, labTex = null, labCv = null, labImg = null, labZ = null;
    // Torch fire: the classic falling-embers fire effect (the one from the old PlayStation Doom intro), run in
    // three small grids so neighbouring torches never burn in step. The bottom row is hottest in the middle,
    // so each fire rises in licking tongues and burns out at the top.
    var FW = 16, FH = 34, fires = null, fireAcc = 0, FIREPAL = [];
    (function () {
      var stops = [[0, 0, 0, 0], [6, 70, 10, 5], [12, 160, 30, 8], [18, 215, 70, 12], [24, 240, 130, 20], [30, 250, 200, 60], [36, 255, 250, 200]];
      for (var v = 0; v <= 36; v++) { var k = 0; while (stops[k + 1][0] < v) k++; var a = stops[k], b = stops[k + 1], f = (v - a[0]) / (b[0] - a[0]); FIREPAL.push([a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f]); }
    })();
    function stepFires() {
      if (!fires) { fires = [0, 1, 2].map(function () { return new Uint8Array(FW * FH); }); }
      fireAcc += dt;
      while (fireAcc > 1 / 28) {
        fireAcc -= 1 / 28;
        fires.forEach(function (F) {
          for (var x = 0; x < FW; x++) { var c = Math.abs(x - (FW - 1) / 2) / (FW / 2); F[(FH - 1) * FW + x] = c < 0.22 ? 36 : c < 0.45 ? 28 + Math.floor(Math.random() * 8) : c < 0.68 ? 8 + Math.floor(Math.random() * 14) : 0; }
          for (var y = 1; y < FH; y++) for (var x2 = 0; x2 < FW; x2++) {
            var src = y * FW + x2, pix = F[src];
            if (!pix) { F[src - FW] = 0; continue; }
            var r = Math.floor(Math.random() * 3), dst = Math.min(FW * FH - 1, Math.max(FW, src - r + 1));
            F[dst - FW] = Math.max(0, pix - (Math.random() < 0.72 ? 1 : 0) - (Math.random() < 0.18 ? 1 : 0));
          }
        });
      }
    }
    function labTextures() {
      var S = 64, seed = 7;
      function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
      function make(fn) { var a = new Float32Array(S * S * 3); for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) { var c = fn(x, y), o = (y * S + x) * 3; a[o] = c[0]; a[o + 1] = c[1]; a[o + 2] = c[2]; } return a; }
      // walls: rows of rough stone blocks with dark mortar
      var rows = [], yy = 0;
      while (yy < S) { var hgt = 13 + Math.floor(rnd() * 6); if (S - yy < 18) hgt = S - yy; var cuts = [], xx = Math.floor(rnd() * 20); while (cuts.length < 8) { cuts.push(xx % S); xx += 16 + Math.floor(rnd() * 14); } rows.push({ y0: yy, y1: yy + hgt, cuts: cuts.sort(function (p, q) { return p - q; }), tone: [] }); yy += hgt; }
      rows.forEach(function (r) { for (var i = 0; i < 10; i++) r.tone.push(0.75 + rnd() * 0.45); });
      var wall = make(function (x, y) {
        var r = rows.filter(function (q) { return y >= q.y0 && y < q.y1; })[0], k = 0;
        for (var i = 0; i < r.cuts.length; i++) if (x >= r.cuts[i]) k = i + 1;
        var dx = Math.min.apply(null, r.cuts.map(function (c) { var d = Math.abs(x - c); return Math.min(d, S - d); })), dy = Math.min(y - r.y0, r.y1 - 1 - y);
        var n = (rnd() - 0.5) * 22, tone = r.tone[k % r.tone.length];
        if (dx < 1.5 || dy < 1) return [28 + n * 0.3, 25 + n * 0.3, 22 + n * 0.3];
        var edge = Math.min(1, Math.min(dx, dy) / 4) * 0.35 + 0.65;
        return [(112 + n) * tone * edge, (104 + n) * tone * edge, (94 + n) * tone * edge];
      });
      // floor: rounded cobbles (a wrapped Voronoi pattern) with dark gaps
      var pts = []; for (var gy = 0; gy < 4; gy++) for (var gx = 0; gx < 4; gx++) pts.push([gx * 16 + 3 + rnd() * 10, gy * 16 + 3 + rnd() * 10, 0.7 + rnd() * 0.5]);
      var floor = make(function (x, y) {
        var d1 = 1e9, d2 = 1e9, best = null;
        pts.forEach(function (p) { var dx = Math.abs(x - p[0]), dy = Math.abs(y - p[1]); dx = Math.min(dx, S - dx); dy = Math.min(dy, S - dy); var d = Math.sqrt(dx * dx + dy * dy); if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d; });
        var n = (rnd() - 0.5) * 18;
        if (d2 - d1 < 2.2) return [22 + n * 0.3, 20 + n * 0.3, 18 + n * 0.3];
        var dome = Math.max(0.55, 1 - d1 / 14), t2 = best[2];
        return [(96 + n) * t2 * dome, (88 + n) * t2 * dome, (78 + n) * t2 * dome];
      });
      // floor tiles: four square stone tiles across each hallway (the cobbles above are the ceiling)
      var ceil = make(function (x, y) {
        var n = (rnd() - 0.5) * 14, sx = x % 16, sy = y % 16, tone = ((x >> 4) * 3 + (y >> 4) * 5) % 4 * 0.06 + 0.8;
        if (sx < 1.2 || sy < 1.2) return [18, 17, 16];
        return [(74 + n) * tone, (70 + n) * tone, (66 + n) * tone];
      });
      return { S: S, wall: wall, floor: floor, ceil: ceil };
    }
    function makeLab() {
      var st = makeMaze(10), W = st.W, m = st.m, torches = [], seen = {};
      // Spread the torches evenly: each new torch goes in the spot that is the longest walk from every torch
      // so far, until nowhere is more than a few steps from one. No clusters, no long dark stretches.
      var open = [], x, y;
      for (x = 1; x < W - 1; x++) for (y = 1; y < W - 1; y++) if (!m[x][y]) open.push([x, y]);
      var far = {};
      function walkDist() {
        far = {}; var q = [];
        torches.forEach(function (t) { var k = t.cx + ',' + t.cy; if (far[k] == null) { far[k] = 0; q.push([t.cx, t.cy]); } });
        for (var h2 = 0; h2 < q.length; h2++) {
          var c = q[h2], dd = far[c[0] + ',' + c[1]];
          [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) { var nx2 = c[0] + d[0], ny2 = c[1] + d[1], k2 = nx2 + ',' + ny2; if (!m[nx2][ny2] && far[k2] == null) { far[k2] = dd + 1; q.push([nx2, ny2]); } });
        }
      }
      function hang(cx, cy) {
        var walls = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(function (d) { var wx = cx + d[0], wy = cy + d[1]; return m[wx] && m[wx][wy] && !seen[wx + ',' + wy + ',' + (-d[0]) + ',' + (-d[1])]; });
        if (!walls.length) return false;
        var d = walls[Math.floor(Math.random() * walls.length)], wx = cx + d[0], wy = cy + d[1];
        var tc = { x: wx + 0.5 - d[0] * 0.575, y: wy + 0.5 - d[1] * 0.575, ax: wx + 0.5 - d[0] * 0.5, ay: wy + 0.5 - d[1] * 0.5, z: 0.27, ph: Math.random() * 10, fire: torches.length % 3, nx: -d[0], ny: -d[1], cx: cx, cy: cy };
        seen[wx + ',' + wy + ',' + (-d[0]) + ',' + (-d[1])] = tc; torches.push(tc); return true;
      }
      var first = open[Math.floor(Math.random() * open.length)]; hang(first[0], first[1]);
      for (var guard2 = 0; guard2 < 200; guard2++) {
        walkDist();
        var best = null, bd = -1;
        open.forEach(function (c) { var dd = far[c[0] + ',' + c[1]]; if (dd == null) dd = 99; if (dd > bd || (dd === bd && Math.random() < 0.3)) { bd = dd; best = c; } });
        if (bd <= 3) break;
        // a crossroads has no wall of its own, so the torch goes on a wall one step away
        if (!hang(best[0], best[1])) [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) { var nx2 = best[0] + d[0], ny2 = best[1] + d[1]; return !m[nx2][ny2] && hang(nx2, ny2); });
      }
      // which torches can light each open cell (in reach, with nothing solid in between)
      var lit = {};
      for (x = 1; x < W - 1; x++) for (y = 1; y < W - 1; y++) {
        if (m[x][y]) continue;
        lit[x + ',' + y] = torches.filter(function (t) {
          var dx = t.x - (x + 0.5), dy = t.y - (y + 0.5), d = Math.sqrt(dx * dx + dy * dy); if (d > 5) return false;
          for (var s2 = 0.1; s2 < d - 0.1; s2 += 0.1) { var px = Math.floor(x + 0.5 + dx * s2 / d), py = Math.floor(y + 0.5 + dy * s2 / d); if (m[px][py]) return false; }
          return true;
        });
      }
      st.torches = seen; st.lit = lit; st.list = torches;
      return st;
    }
    function labyrinth(w, h, dpr) {
      if (!labTex) labTex = labTextures();
      if (!lab) lab = makeLab();
      var next = walkMaze(lab, 10, 1.1); if (next !== lab) lab = makeLab();
      var lw = Math.max(160, Math.min(480, Math.round(w / Math.max(1, dpr)))), lh = Math.max(90, Math.round(lw * h / w));
      if (!labCv) labCv = document.createElement('canvas');
      if (labCv.width !== lw || labCv.height !== lh) { labCv.width = lw; labCv.height = lh; labImg = null; }
      var o = labCv.getContext('2d');
      if (!labImg) labImg = o.createImageData(lw, lh);
      var px = labImg.data, T = labTex, S = T.S, M = lab.m, half = lh / 2;
      // each torch flickers on its own, a little brighter with the bass
      lab.list.forEach(function (tc) { tc.f = (0.85 + Math.sin(t * 9 + tc.ph) * 0.06 + Math.sin(t * 23 + tc.ph * 2) * 0.04 + Math.sin(t * 3.1 + tc.ph) * 0.05) * (1 + sm.bass * 0.25); });
      function light(cx, cy, x, y, z) {
        var L = 0.1, ls = lab.lit[cx + ',' + cy];
        if (ls) for (var i = 0; i < ls.length; i++) { var tc = ls[i], dx = x - tc.x, dy = y - tc.y, dz = z - tc.z, d2 = dx * dx + dy * dy + dz * dz * 1.5; L += 2.1 * tc.f / (1 + d2 * 5); }
        return L > 1.6 ? 1.6 : L;
      }
      function put(i, tex, tx, ty, L, warm) {
        var o2 = ((ty & 63) * S + (tx & 63)) * 3;
        px[i] = tex[o2] * L * (1 + warm * 0.25); px[i + 1] = tex[o2 + 1] * L * (1 + warm * 0.02); px[i + 2] = tex[o2 + 2] * L * (1 - warm * 0.25); px[i + 3] = 255;
      }
      if (!labZ || labZ.length !== lw) labZ = new Float32Array(lw);
      stepFires();
      var fov = 1.05, plane = Math.tan(fov / 2), cdx = Math.cos(lab.ang), cdy = Math.sin(lab.ang), pdx = -cdy * plane, pdy = cdx * plane;
      for (var col = 0; col < lw; col++) {
        var cam = 2 * (col + 0.5) / lw - 1, dx = cdx + pdx * cam, dy = cdy + pdy * cam;
        var mx = Math.floor(lab.x), my = Math.floor(lab.y), sx = Math.abs(1 / dx), sy = Math.abs(1 / dy), stx = dx < 0 ? -1 : 1, sty = dy < 0 ? -1 : 1;
        var tx = (dx < 0 ? lab.x - mx : mx + 1 - lab.x) * sx, ty = (dy < 0 ? lab.y - my : my + 1 - lab.y) * sy, side = 0, guard = 0;
        while (guard++ < 80) { if (tx < ty) { tx += sx; mx += stx; side = 0; } else { ty += sy; my += sty; side = 1; } if (!M[mx] || M[mx][my]) break; }
        var dist = Math.max(0.05, side ? ty - sy : tx - sx), wh = lh / dist, top = half - wh / 2, bot = half + wh / 2;
        labZ[col] = dist;
        var hx = lab.x + dist * dx, hy = lab.y + dist * dy, u = side ? hx : hy; u -= Math.floor(u);
        var nx = side ? 0 : -stx, ny = side ? -sty : 0, fcx = mx + nx, fcy = my + ny;   // the open cell in front of this wall face
        var torch = lab.torches[mx + ',' + my + ',' + nx + ',' + ny], tu = Math.floor(u * S);
        var shadeSide = side ? 0.82 : 1;
        for (var y = 0; y < lh; y++) {
          var i = (y * lw + col) * 4;
          if (y >= top && y < bot) {
            var v = (y - top) / wh;
            if (torch && Math.abs(u - 0.5) < 0.045 && v > 0.4 && v < 0.49) {   // the iron plate the torch bracket is bolted to
              var Lp = light(fcx, fcy, hx, hy, v); px[i] = 34 * Lp + 8; px[i + 1] = 32 * Lp + 8; px[i + 2] = 34 * Lp + 9; px[i + 3] = 255; continue;
            }
            var Lw = light(fcx, fcy, hx + nx * 0.01, hy + ny * 0.01, v) * shadeSide;
            put(i, T.wall, tu, Math.floor(v * S), Lw, Math.min(1, Lw));
          } else {
            var fl = y >= bot, p = fl ? y - half + 0.5 : half - y - 0.5, rd = half / p;
            var wx = lab.x + rd * dx, wy = lab.y + rd * dy, cx = Math.floor(wx), cy = Math.floor(wy);
            var L2 = light(cx, cy, wx, wy, fl ? 1 : 0);
            put(i, fl ? T.ceil : T.floor, Math.floor(wx * S), Math.floor(wy * S), L2, Math.min(1, L2));
          }
        }
      }
      // ---- torches stick out from the walls: drawn as upright sprites, nearest last, hidden behind nearer walls ----
      var invDet = 1 / (pdx * cdy - cdx * pdy);
      function sprite(wx, wy, zTop, zBot, ww, fn) {
        var rx = wx - lab.x, ry = wy - lab.y, tX = invDet * (cdy * rx - cdx * ry), tY = invDet * (-pdy * rx + pdx * ry);
        if (tY < 0.3) return;
        var sc = lh / tY, sxc = lw / 2 * (1 + tX / tY), sw = ww * sc, y0 = half + (zTop - 0.5) * sc, sh = (zBot - zTop) * sc;
        var c0 = Math.max(0, Math.floor(sxc - sw / 2)), c1 = Math.min(lw - 1, Math.ceil(sxc + sw / 2)), r0 = Math.max(0, Math.floor(y0)), r1 = Math.min(lh - 1, Math.ceil(y0 + sh));
        for (var cc = c0; cc <= c1; cc++) {
          if (tY >= labZ[cc]) continue;
          var uu = (cc + 0.5 - (sxc - sw / 2)) / sw; if (uu < 0 || uu >= 1) continue;
          for (var rr = r0; rr <= r1; rr++) { var vv = (rr + 0.5 - y0) / sh; if (vv >= 0 && vv < 1) fn(uu, vv, (rr * lw + cc) * 4); }
        }
      }
      function ink(i, r, gg, b) { px[i] = r; px[i + 1] = gg; px[i + 2] = b; px[i + 3] = 255; }
      var near = lab.list.map(function (tc) { var ddx = tc.x - lab.x, ddy = tc.y - lab.y; return { tc: tc, d: ddx * ddx + ddy * ddy }; })
        .filter(function (q) { return q.d < 81; }).sort(function (p1, p2) { return p2.d - p1.d; });
      near.forEach(function (q) {
        var tc = q.tc, cx2 = Math.floor(tc.x), cy2 = Math.floor(tc.y), Lt = light(cx2, cy2, tc.x, tc.y, 0.45) * 0.8;
        // the iron arm, from the wall plate out to the holder
        for (var k = 0; k <= 28; k++) { var f = k / 28; sprite(tc.ax + (tc.x - tc.ax) * f, tc.ay + (tc.y - tc.ay) * f, 0.425 + f * 0.01, 0.455, 0.045, function (uu, vv, i) { ink(i, 30 * Lt + 10, 28 * Lt + 9, 30 * Lt + 10); }); }
        // the wooden handle, a little thinner at the bottom
        sprite(tc.x, tc.y, 0.34, 0.56, 0.05, function (uu, vv, i) {
          var hw = 0.5 - vv * 0.18; if (Math.abs(uu - 0.5) > hw * 0.9) return;
          var band = (Math.floor(vv * 9) % 2) ? 0.85 : 1, edge = 1 - Math.abs(uu - 0.5) * 1.2;
          ink(i, (120 * Lt + 18) * band * edge, (72 * Lt + 10) * band * edge, (38 * Lt + 6) * band * edge);
        });
        // the fire
        var F = fires[tc.fire];
        sprite(tc.x, tc.y, 0.06, 0.37, 0.15, function (uu, vv, i) {
          var val = F[Math.floor(vv * FH) * FW + Math.floor(uu * FW)];
          if (val < 4) return;
          var c = FIREPAL[val], a = val < 10 ? (val - 3) / 7 : 1;
          px[i] = px[i] * (1 - a) + c[0] * a; px[i + 1] = px[i + 1] * (1 - a) + c[1] * a; px[i + 2] = px[i + 2] * (1 - a) + c[2] * a;
        });
        // the iron cup the fire sits in, wider at the rim
        sprite(tc.x, tc.y, 0.33, 0.38, 0.085, function (uu, vv, i) {
          if (Math.abs(uu - 0.5) * 2 > 1 - vv * 0.45) return;
          var rim = vv < 0.25 ? 1.5 : 1; ink(i, (44 * Lt + 14) * rim, (40 * Lt + 12) * rim, (40 * Lt + 12) * rim);
        });
      });
      o.putImageData(labImg, 0, 0);
      g.imageSmoothingEnabled = true; g.drawImage(labCv, 0, 0, w, h);
    }
    // Mystic Lines and Bezier Ribbons: the shapes keep a short echo of where they just were, drawn fresh each frame
    function bouncer(n, s0, s1) { return Array.apply(null, Array(n)).map(function () { var a = Math.random() * Math.PI * 2, s = s0 + Math.random() * (s1 - s0); return { x: Math.random(), y: Math.random(), vx: Math.cos(a) * s, vy: Math.sin(a) * s }; }); }
    function bounce(pts, sp, w, h) {
      var ax = U / w, ay = U / h;   // the same speed across the screen whichever way it moves
      pts.forEach(function (q) {
        q.x += q.vx * sp * ax * dt; q.y += q.vy * sp * ay * dt;
        if (q.x < 0) { q.x = 0; q.vx = Math.abs(q.vx); } else if (q.x > 1) { q.x = 1; q.vx = -Math.abs(q.vx); }
        if (q.y < 0) { q.y = 0; q.vy = Math.abs(q.vy); } else if (q.y > 1) { q.y = 1; q.vy = -Math.abs(q.vy); }
      });
    }
    function snap(pts) { return pts.map(function (q) { return [q.x, q.y]; }); }
    var poly = null;
    function mystic(w, h, dpr) {
      clear();
      if (!poly) poly = [0, 1].map(function (s2) { return { hue: s2 * 180, pts: bouncer(4, 0.25, 0.5), hist: [], acc: 0 }; });
      var sp = 1 + sm.all * 1.5;
      poly.forEach(function (pg) {
        pg.hue = (pg.hue + 18 * dt) % 360;
        bounce(pg.pts, sp, w, h);
        pg.acc += dt; if (pg.acc >= 1 / 20) { pg.acc = 0; pg.hist.unshift(snap(pg.pts)); if (pg.hist.length > 14) pg.hist.pop(); }
        g.lineWidth = 1.5 * dpr;
        var all = [snap(pg.pts)].concat(pg.hist);
        for (var k = all.length - 1; k >= 0; k--) {
          g.strokeStyle = 'hsla(' + pg.hue + ',100%,60%,' + (k ? 0.75 * (1 - k / (all.length)) : 1) + ')';
          g.beginPath(); all[k].forEach(function (q, i) { if (i) g.lineTo(q[0] * w, q[1] * h); else g.moveTo(q[0] * w, q[1] * h); }); g.closePath(); g.stroke();
        }
      });
    }
    var bz = null;
    function bezier(w, h, dpr) {
      clear();
      if (!bz) bz = { pts: bouncer(4, 0.2, 0.45), hist: [], acc: 0 };
      bounce(bz.pts, 0.8 + sm.all * 1.5, w, h);
      bz.acc += dt; if (bz.acc >= 1 / 24) { bz.acc = 0; bz.hist.unshift(snap(bz.pts)); if (bz.hist.length > 10) bz.hist.pop(); }
      var all = [snap(bz.pts)].concat(bz.hist), gap = U * 0.035;
      g.lineWidth = 1.5 * dpr;
      for (var e = all.length - 1; e >= 0; e--) {
        var p = all[e], fade = e ? 0.6 * (1 - e / all.length) : 0.95;
        for (var k = 0; k < 3; k++) {
          g.strokeStyle = 'hsla(' + ((t * 25 + k * 40) % 360) + ',90%,60%,' + fade + ')';
          g.beginPath(); g.moveTo(p[0][0] * w, p[0][1] * h + k * gap);
          g.bezierCurveTo(p[1][0] * w, p[1][1] * h + k * gap, p[2][0] * w, p[2][1] * h + k * gap, p[3][0] * w, p[3][1] * h + k * gap); g.stroke();
        }
      }
    }
    // The bouncing disc logo, with CCN on it. It changes color at every wall and cheers when it hits a corner.
    // Its speed is a share of the screen per second, so it crosses the small window and full screen in the same time.
    var dvd = null;
    function dvdBounce(w, h, dpr) {
      clear();
      var lw = Math.max(60, U * 0.32), lh = lw * 0.5;
      if (!dvd) dvd = { x: Math.random(), y: Math.random(), vx: 1, vy: 1, hue: 200, cheer: 0 };
      var sp = (1 + sm.all * 0.4) * dt, hitX = false, hitY = false;
      dvd.x += dvd.vx * 0.075 * sp * U / Math.max(1, w - lw) ; dvd.y += dvd.vy * 0.06 * sp * U / Math.max(1, h - lh);
      if (dvd.x <= 0) { dvd.x = 0; dvd.vx = 1; hitX = true; } else if (dvd.x >= 1) { dvd.x = 1; dvd.vx = -1; hitX = true; }
      if (dvd.y <= 0) { dvd.y = 0; dvd.vy = 1; hitY = true; } else if (dvd.y >= 1) { dvd.y = 1; dvd.vy = -1; hitY = true; }
      if (hitX || hitY) dvd.hue = (dvd.hue + 70 + Math.random() * 120) % 360;
      if (hitX && hitY) dvd.cheer = 2;
      var col = 'hsl(' + dvd.hue + ',90%,60%)', x = dvd.x * (w - lw), y = dvd.y * (h - lh);
      g.fillStyle = col;
      g.font = 'italic 900 ' + Math.round(lh * 0.62) + 'px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.save(); g.translate(x + lw / 2, y + lh * 0.6); g.transform(1, 0, -0.18, 1, 0, 0); g.fillText('CCN', 0, 0); g.restore();
      // the flattened disc underneath, with a hole cut out
      g.beginPath(); g.ellipse(x + lw / 2, y + lh * 0.82, lw * 0.46, lh * 0.15, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#000'; g.beginPath(); g.ellipse(x + lw / 2, y + lh * 0.82, lw * 0.11, lh * 0.045, 0, 0, Math.PI * 2); g.fill();
      if (dvd.cheer > 0) {
        dvd.cheer -= dt;
        g.fillStyle = 'rgba(255,255,255,' + Math.min(1, dvd.cheer / 0.7) + ')'; g.font = 'bold ' + Math.round(U * 0.08) + 'px "Arial Black", sans-serif';
        g.fillText('CORNER!', w / 2, h * 0.15);
      }
    }
    // Flying Dice: real 3D d10s (assets/d10.js) tumble toward you at an easy pace, each in its own color,
    // some spinning fast and some barely turning, with their numbers on the faces
    var dice = [], d10Load = null;
    var DICE_COLORS = [['#e8b33a', '#3a2205'], ['#c8323c', '#ffffff'], ['#2f6fd6', '#ffffff'], ['#2f9e5a', '#ffffff'], ['#8a4fd0', '#ffffff'], ['#e8e4da', '#222222'], ['#2a2a33', '#f0c050']];
    function newDie(far) {
      var c = DICE_COLORS[Math.floor(Math.random() * DICE_COLORS.length)], lazy = Math.random() < 0.35;
      function spin() { return (Math.random() - 0.5) * (lazy ? 0.5 : 2.6); }
      return { x: (Math.random() * 2 - 1) * 2.4, y: (Math.random() * 2 - 1) * 1.5, z: far ? 8 : 1 + Math.random() * 7, size: 0.42,
        rot: [Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3], spin: [spin(), spin(), spin()], color: c[0], ink: c[1] };
    }
    function flyingDice(w, h, dpr) {
      clear();
      if (!window.D10) { if (!d10Load) d10Load = loadScript(ROOT + 'assets/d10.js?v=395f3425').catch(function () { d10Load = null; }); return; }
      while (dice.length < 20) dice.push(newDie(false));
      var sp = (1.1 + sm.all * 2.2) * dt, cam = { cx: w / 2, cy: h / 2, f: Math.max(w, h) * 0.35 };
      dice.forEach(function (d, i) {
        d.z -= sp; d.rot[0] += d.spin[0] * dt; d.rot[1] += d.spin[1] * dt; d.rot[2] += d.spin[2] * dt;
        if (d.z <= 0.9) dice[i] = newDie(true);
      });
      dice.sort(function (p, q) { return q.z - p.z; });
      dice.forEach(function (d) { d.alpha = Math.max(0, Math.min(1, (8 - d.z) / 1.8)); window.D10.draw(g, d, cam); });
      g.globalAlpha = 1; g.setTransform(1, 0, 0, 1, 0, 0);
    }
    return { show: show, hide: hide, menu: menu };
  })();
  M.visualizer = VIS;
})();
