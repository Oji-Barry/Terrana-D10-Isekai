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
      var src = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.78;
      src.connect(analyser); analyser.connect(ctx.destination);
    } catch (e) { analyser = null; }
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, function () { if (!audio.paused || st.id || st.url) graph(); }, true); });

  function emit(what) { listeners.forEach(function (fn) { try { fn(what, M.state()); } catch (e) {} }); }
  function loadLib() {
    if (lib) return Promise.resolve(lib);
    if (!libP) libP = fetch(ROOT + 'assets/music/library.json?v=ee38227c').then(function (r) { return r.json(); }).then(function (d) {
      lib = d; lib.byId = {}; d.tracks.forEach(function (t) { lib.byId[t.id] = t; }); return lib;
    });
    return libP;
  }
  function track(id) { return lib && lib.byId[id]; }
  function moodName(m) { if (!lib || m === 'all') return 'All Music'; var x = lib.moods.filter(function (y) { return y.id === m; })[0]; return x ? x.name : ''; }
  function queue() {
    if (!lib) return [];
    if (st.mood === 'all') return lib.tracks.map(function (t) { return t.id; });
    var m = lib.moods.filter(function (y) { return y.id === st.mood; })[0];
    return m ? m.tracks.slice() : [];
  }
  function setSrc(id, url, title) {
    st.id = id || null; st.url = url || ''; st.title = title || (id && track(id) ? track(id).title : '');
    audio.src = id ? ROOT + 'assets/music/' + track(id).file : url;
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
    unlock: graph
  };
  window.TerranaMusic = M;
  if (!document.querySelector('link[href*="assets/music.css"]')) {
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = ROOT + 'assets/music.css?v=d0164d74'; document.head.appendChild(css);
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
      });
    }
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
      if (action === 'toggle') M.toggle(); else if (action === 'next') M.next(); else if (action === 'prev') M.prev();
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
    var bVis = el('button', { type: 'button', class: 'mp-btn', 'aria-label': 'Visualizer', title: 'Visualizer', text: ICON.vis, onclick: function () { M.unlock(); VIS.show(); } });
    var moodSel = el('select', { class: 'mp-mood', 'aria-label': 'Mood', onchange: function () { if (can()) act('mood', moodSel.value); else draw(); } });
    var list = el('ol', { class: 'mp-tracks' });
    var details = el('details', { class: 'mp-list' }, [el('summary', { text: 'Track list' }), list]);
    var note = el('p', { class: 'mp-note' });
    var screen = el('div', { class: 'mp-screen' }, [title, sub, bar]);
    wrap.appendChild(screen);
    wrap.appendChild(el('div', { class: 'mp-ctrls' }, opts.songOnly ? [bPlay, bRep, bMute, vol, bVis] : [bPrev, bPlay, bNext, bRep, bMute, vol, bVis]));
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
          onclick: function () { if (can()) { if (m !== s.mood) act('mood', m); act('pick', id); } } }, [el('span', { text: t.title }), el('small', { text: fmt(t.dur) })])]));
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
        lib.moods.forEach(function (m) { moodSel.appendChild(el('option', { value: m.id, text: m.name })); });
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
  var VIS = (function () {
    var win = null, cv = null, g = null, raf = 0, collapsed = false, modeName = null;
    var MODES = ['Bars', 'Scope', 'Ambience', 'Alchemy'];
    var freq = new Uint8Array(1024), wave = new Uint8Array(2048), peaks = [], t = 0, plasma = null;
    function build() {
      win = el('div', { class: 'mp-vis', role: 'region', 'aria-label': 'Music visualizer' });
      modeName = el('span', { class: 'mp-vis-mode' });
      var bMode = el('button', { type: 'button', title: 'Next visualization', 'aria-label': 'Next visualization', text: '◆', onclick: function () { pref.vis.mode = (pref.vis.mode + 1) % MODES.length; savePref(); label(); } });
      var bMin = el('button', { type: 'button', title: 'Collapse', 'aria-label': 'Collapse visualizer', text: '▁', onclick: function () { collapsed = !collapsed; win.classList.toggle('collapsed', collapsed); bMin.textContent = collapsed ? '▔' : '▁'; bMin.setAttribute('aria-label', collapsed ? 'Expand visualizer' : 'Collapse visualizer'); loop(); } });
      var bMax = el('button', { type: 'button', title: 'Full screen', 'aria-label': 'Full screen', text: '□', onclick: maxToggle });
      var bX = el('button', { type: 'button', title: 'Close', 'aria-label': 'Close visualizer', text: '×', onclick: hide });
      var head = el('div', { class: 'mp-vis-head' }, [el('span', { class: 'mp-vis-name', text: 'Visualizer' }), modeName, el('span', { class: 'mp-vis-btns' }, [bMode, bMin, bMax, bX])]);
      cv = el('canvas', { class: 'mp-vis-cv', title: 'Click for the next visualization', onclick: function () { bMode.click(); }, ondblclick: maxToggle });
      win.appendChild(head); win.appendChild(cv);
      document.body.appendChild(win);
      g = cv.getContext('2d');
      document.addEventListener('fullscreenchange', function () { win.classList.toggle('max', document.fullscreenElement === win); });
      label();
    }
    function label() { modeName.textContent = MODES[pref.vis.mode]; plasma = null; }
    function maxToggle() {
      if (document.fullscreenElement === win) { document.exitFullscreen(); return; }
      if (win.classList.contains('max')) { win.classList.remove('max'); return; }
      if (win.requestFullscreen) win.requestFullscreen().catch(function () { win.classList.add('max'); }); else win.classList.add('max');
    }
    function show() { if (!win) build(); win.hidden = false; loop(); }
    function hide() { if (document.fullscreenElement === win) document.exitFullscreen(); win.classList.remove('max'); win.hidden = true; cancelAnimationFrame(raf); raf = 0; }
    function loop() { if (!raf && win && !win.hidden && !collapsed) raf = requestAnimationFrame(frame); }
    function frame() {
      raf = 0;
      if (!win || win.hidden || collapsed) return;
      var dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(10, Math.floor(cv.clientWidth * dpr)), h = Math.max(10, Math.floor(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; plasma = null; }
      var live = analyser && !audio.paused;
      if (live) { analyser.getByteFrequencyData(freq); analyser.getByteTimeDomainData(wave); }
      else { for (var i = 0; i < freq.length; i++) freq[i] = Math.max(0, freq[i] - 6); for (var j = 0; j < wave.length; j++) wave[j] = 128 + Math.sin(j / 60 + t * 2) * 6; }
      t += 1 / 60;
      [bars, scope, ambience, alchemy][pref.vis.mode](w, h, dpr);
      raf = requestAnimationFrame(frame);
    }
    function energy(a, b) { var s = 0; for (var i = a; i < b; i++) s += freq[i]; return s / ((b - a) * 255); }
    function bars(w, h, dpr) {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
      var n = w < 400 * dpr ? 32 : 64, gap = Math.max(1, Math.floor(w / n * 0.18)), bw = w / n;
      var grad = g.createLinearGradient(0, h, 0, 0); grad.addColorStop(0, '#1ee34a'); grad.addColorStop(0.6, '#f2e93a'); grad.addColorStop(1, '#ff3b3b');
      for (var i = 0; i < n; i++) {
        var a = Math.floor(Math.pow(i / n, 1.7) * 700) + 1, b = Math.floor(Math.pow((i + 1) / n, 1.7) * 700) + 2;
        var v = energy(a, b), bh = v * h * 0.95;
        peaks[i] = Math.max((peaks[i] || 0) - h * 0.008, bh);
        g.fillStyle = grad; g.fillRect(i * bw + gap / 2, h - bh, bw - gap, bh);
        g.fillStyle = '#fff'; g.fillRect(i * bw + gap / 2, h - peaks[i] - 3 * dpr, bw - gap, 2 * dpr);
      }
      // classic LED rows
      g.fillStyle = 'rgba(0,0,0,0.35)'; for (var y = h; y > 0; y -= 4 * dpr) g.fillRect(0, y, w, dpr);
    }
    function scope(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, w, h);
      var hue = (t * 40) % 360;
      g.lineWidth = 2.5 * dpr; g.strokeStyle = 'hsl(' + hue + ',100%,60%)'; g.shadowColor = g.strokeStyle; g.shadowBlur = 12 * dpr;
      g.beginPath();
      for (var i = 0; i < w; i += 2) { var v = wave[Math.floor(i / w * wave.length)] / 128 - 1, y = h / 2 + v * h * 0.42; if (i) g.lineTo(i, y); else g.moveTo(i, y); }
      g.stroke(); g.shadowBlur = 0;
    }
    function ambience(w, h) {
      var pw = 96, ph = Math.max(20, Math.round(96 * h / w));
      if (!plasma || plasma.width !== pw) plasma = g.createImageData(pw, ph);
      var bass = energy(1, 12), mid = energy(12, 120), d = plasma.data, k = t * (0.6 + bass * 2.5);
      for (var y = 0; y < ph; y++) for (var x = 0; x < pw; x++) {
        var v = Math.sin(x / 9 + k) + Math.sin(y / 7 - k * 1.3) + Math.sin((x + y) / 11 + k * 0.7) + Math.sin(Math.sqrt((x - pw / 2) * (x - pw / 2) + (y - ph / 2) * (y - ph / 2)) / 6 - k * 2);
        var o = (y * pw + x) * 4, c = v * Math.PI / 2;
        d[o] = 128 + 127 * Math.sin(c + t * 0.5); d[o + 1] = 70 + 70 * Math.sin(c + 2.1 + mid * 3); d[o + 2] = 140 + 115 * Math.sin(c + 4.2); d[o + 3] = 255;
      }
      var tmp = VIS._tmp || (VIS._tmp = document.createElement('canvas')); tmp.width = pw; tmp.height = ph; tmp.getContext('2d').putImageData(plasma, 0, 0);
      g.imageSmoothingEnabled = true; g.globalAlpha = 0.55 + bass * 0.45; g.drawImage(tmp, 0, 0, w, h); g.globalAlpha = 1;
    }
    function alchemy(w, h, dpr) {
      g.fillStyle = 'rgba(0,0,8,0.16)'; g.fillRect(0, 0, w, h);
      var cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.18, n = 96, bass = energy(1, 10);
      g.save(); g.translate(cx, cy); g.rotate(t * 0.4);
      for (var ring = 0; ring < 3; ring++) {
        g.beginPath();
        for (var i = 0; i <= n; i++) {
          var a = i / n * Math.PI * 2, v = freq[(Math.floor(i / n * 300) + ring * 40) % 512] / 255;
          var r = R * (1 + ring * 0.55) + v * R * (1.1 + bass);
          var x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.strokeStyle = 'hsla(' + ((t * 50 + ring * 110) % 360) + ',100%,62%,0.9)'; g.lineWidth = (2 - ring * 0.4) * dpr; g.stroke();
      }
      g.restore();
    }
    return { show: show, hide: hide };
  })();
  M.visualizer = VIS;
})();
