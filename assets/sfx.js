/* Jimothy's D10 Isekai JRPG: 16-bit style sound effects, made in the browser (no files).
   They play on their own channel, alongside any music, never in place of it.
   SFX.play('whoosh'), SFX.volume(0..1), SFX.muted(true/false). Settings are kept per browser. */
(function () {
  'use strict';
  var ctx = null, out = null;
  var vol = 0.6, mute = false;
  try { var sv = JSON.parse(localStorage.getItem('terrana-sfx') || '{}'); if (typeof sv.v === 'number') vol = sv.v; mute = !!sv.m; } catch (e) {}
  function save() { try { localStorage.setItem('terrana-sfx', JSON.stringify({ v: vol, m: mute })); } catch (e) {} }
  function ac() {
    if (!ctx) {
      var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
      ctx = new C(); out = ctx.createGain(); out.gain.value = vol; out.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // Browsers only allow sound after a click or key press, so wake the audio on the first one
  ['pointerdown', 'keydown'].forEach(function (ev) { window.addEventListener(ev, function once() { ac(); window.removeEventListener(ev, once, true); }, true); });

  // ---- building blocks ----
  function tone(type, f0, f1, t0, dur, g, dest) {
    var o = ctx.createOscillator(), v = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    v.gain.setValueAtTime(0.0001, t0); v.gain.exponentialRampToValueAtTime(g, t0 + 0.008); v.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(v); v.connect(dest || out); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  var noiseBuf = null;
  function noise(t0, dur, g, filt, f0, f1, q) {
    if (!noiseBuf) { noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), v = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    f.type = filt || 'lowpass'; f.Q.value = q || 1; f.frequency.setValueAtTime(f0, t0); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    v.gain.setValueAtTime(0.0001, t0); v.gain.exponentialRampToValueAtTime(g, t0 + Math.min(0.03, dur / 3)); v.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(v); v.connect(out); s.start(t0); s.stop(t0 + dur + 0.02);
  }
  function notes(type, list, step, g, len) { var t = ctx.currentTime; list.forEach(function (f, i) { if (f) tone(type, f, f, t + i * step, len || step * 1.6, g); }); }

  var SOUNDS = {
    // menu
    cursor: function (t) { tone('square', 1320, 1320, t, 0.04, 0.12); },
    select: function (t) { tone('square', 880, 880, t, 0.05, 0.14); tone('square', 1320, 1320, t + 0.05, 0.08, 0.14); },
    cancel: function (t) { tone('square', 660, 440, t, 0.1, 0.12); },
    open: function (t) { tone('triangle', 520, 1040, t, 0.12, 0.2); },
    // dice and rolls
    dice: function (t) { for (var i = 0; i < 6; i++) { var at = t + i * 0.045 + Math.random() * 0.02; noise(at, 0.03, 0.35, 'bandpass', 2500 + Math.random() * 2500, 0, 6); tone('square', 300 + Math.random() * 500, 0, at, 0.02, 0.05); } },
    cast: function (t) { [988, 1319, 1568, 1976, 2637].forEach(function (f, i) { tone('sine', f, f * 1.01, t + i * 0.05, 0.25, 0.12); }); noise(t, 0.35, 0.08, 'highpass', 4000, 9000, 1); },
    // attack results
    whoosh: function (t) { noise(t, 0.32, 0.5, 'bandpass', 400, 2600, 2.5); noise(t + 0.05, 0.25, 0.25, 'bandpass', 900, 3800, 3); },
    block: function (t) { tone('square', 1800, 1700, t, 0.08, 0.15); tone('triangle', 2400, 2300, t, 0.18, 0.1); noise(t, 0.06, 0.2, 'highpass', 3000, 0, 1); },
    thud: function (t) { tone('sine', 140, 60, t, 0.18, 0.5); noise(t, 0.08, 0.3, 'lowpass', 1200, 300, 1); },
    tink: function (t) { tone('triangle', 2200, 2100, t, 0.12, 0.15); tone('square', 3300, 3300, t, 0.04, 0.05); },
    punch: function (t) { tone('sine', 180, 50, t, 0.2, 0.7); noise(t, 0.12, 0.6, 'lowpass', 2500, 400, 1); },
    slash: function (t) { noise(t, 0.18, 0.6, 'highpass', 1500, 6000, 1.5); tone('sawtooth', 900, 200, t, 0.15, 0.15); tone('sine', 160, 60, t + 0.04, 0.16, 0.45); },
    crush: function (t) { tone('sine', 120, 35, t, 0.4, 0.9); tone('sawtooth', 220, 50, t, 0.3, 0.25); noise(t, 0.35, 0.8, 'lowpass', 3000, 200, 1); noise(t + 0.08, 0.2, 0.4, 'bandpass', 600, 150, 2); },
    sting: function (t) { tone('square', 740, 740, t, 0.08, 0.12); tone('square', 554, 554, t + 0.08, 0.16, 0.12); },
    // turn flow
    turn: function () { notes('square', [523, 659, 784], 0.07, 0.12, 0.12); },
    phase: function (t) { tone('triangle', 660, 660, t, 0.06, 0.12); },
    heal: function () { notes('triangle', [523, 659, 784, 1047, 1319], 0.06, 0.14, 0.2); },
    defeat: function () { notes('square', [392, 330, 262, 196], 0.14, 0.14, 0.24); },
    victory: function () { notes('square', [523, 523, 523, 523, 415, 466, 523, 0, 466, 523], 0.1, 0.13, 0.16); },
    buff: function () { notes('triangle', [440, 554, 659, 880], 0.05, 0.12, 0.12); },
    move: function (t) { tone('square', 200, 260, t, 0.05, 0.08); tone('square', 260, 200, t + 0.06, 0.05, 0.08); }
  };

  window.SFX = {
    list: Object.keys(SOUNDS),
    play: function (name) {
      if (mute || !SOUNDS[name] || !ac() || ctx.state !== 'running') return;
      try { SOUNDS[name](ctx.currentTime + 0.01); } catch (e) {}
    },
    volume: function (v) { if (typeof v === 'number') { vol = Math.max(0, Math.min(1, v)); if (out) out.gain.value = vol; save(); } return vol; },
    muted: function (m) { if (typeof m === 'boolean') { mute = m; save(); } return mute; }
  };
})();
