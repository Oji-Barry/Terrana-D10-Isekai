/* OurSpace: player pages, character pages, friends, Top 8, blogs, and PMs.
   Needs vendor/supabase, assets/auth.js, and the tables in
   supabase/02_ourspace.sql. Each page sets <body data-os="home|user|char|edit|mail">. */

(function () {
  var A = window.Terrana.auth;
  var db = A.client;
  var me = null;
  var page = document.body.getAttribute('data-os');
  var qs = new URLSearchParams(location.search);

  // ---------- small helpers ----------
  function $(id) { return document.getElementById(id); }
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
  function box(title, kids, cls) { return el('section', { class: 'os-box ' + (cls || '') }, [el('h2', { text: title }), el('div', { class: 'in' }, kids)]); }
  function when(iso) {
    try { return new Date(iso).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return ''; }
  }
  function day(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch (e) { return ''; }
  }
  function say(id, text, bad) { var m = $(id); if (!m) return; m.textContent = text || ''; m.classList.toggle('err', !!bad); }
  function oops(err) { return A.friendly(err); }
  function uLink(name) { return 'u.html?u=' + encodeURIComponent(name); }
  function cLink(id) { return 'c.html?id=' + encodeURIComponent(id); }
  async function must(q) { var r = await q; if (r.error) throw r.error; return r.data; }
  function pic(url, alt) {
    if (url && /^https:\/\//.test(url)) return el('img', { class: 'os-pic', src: url, alt: alt || '', referrerpolicy: 'no-referrer', loading: 'lazy' });
    return el('div', { class: 'os-pic blank', role: 'img', 'aria-label': alt || 'No picture' }, ['No picture']);
  }

  // ---------- picture uploads (Supabase Storage bucket "ourspace") ----------
  // Pictures are shrunk in the browser first so they load fast and fit the free storage.
  // Animated GIFs are kept as they are.
  var MAX_BYTES = 3 * 1024 * 1024;
  function shrink(file, maxSide) {
    return new Promise(function (resolve, reject) {
      if (file.type === 'image/gif') { resolve({ blob: file, type: 'image/gif', ext: 'gif' }); return; }
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        var g = c.getContext('2d');
        g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? resolve({ blob: b, type: 'image/jpeg', ext: 'jpg' }) : reject(new Error('Could not read that picture.')); }, 'image/jpeg', 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can open.')); };
      img.src = url;
    });
  }
  async function uploadPic(file, kind, maxSide) {
    if (!file || !/^image\//.test(file.type)) throw new Error('Choose a picture file (JPG, PNG, WebP, or GIF).');
    var out = await shrink(file, maxSide || 1200);
    if (out.blob.size > MAX_BYTES) throw new Error('That picture is over 3 MB. Try a smaller one.');
    var path = me.id + '/' + kind + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + out.ext;
    var r = await db.storage.from('ourspace').upload(path, out.blob, { contentType: out.type, upsert: false });
    if (r.error) throw r.error;
    return db.storage.from('ourspace').getPublicUrl(path).data.publicUrl;
  }

  // ---------- page colors ----------
  var THEMES = {
    classic: { label: 'Classic', bg: '#e5e5e5', text: '#222222', link: '#003399', head: '#6699cc', headText: '#ffffff', box: '#ffffff', box2: '#d5e8fb', accent: '#ff9933', accent2: '#ffcc99' },
    night: { label: 'Midnight', bg: '#0b0b2a', text: '#e8e8ff', link: '#ffcc33', head: '#3333aa', headText: '#ffffff', box: '#16163f', box2: '#22225a', accent: '#cc33ff', accent2: '#3a1a55' },
    goth: { label: 'Gothic', bg: '#000000', text: '#dddddd', link: '#ff3355', head: '#550011', headText: '#ffffff', box: '#111111', box2: '#1e0a0f', accent: '#880022', accent2: '#2a0008' },
    emo: { label: 'Emo Night', bg: '#0d0d0d', text: '#e6e6e6', link: '#ff1a75', head: '#1a1a1a', headText: '#ff1a75', box: '#141414', box2: '#222222', accent: '#ff1a75', accent2: '#330014' },
    scene: { label: 'Scene Kid Neon', bg: '#111111', text: '#ffffff', link: '#00ffcc', head: '#ff00cc', headText: '#000000', box: '#1b1b1b', box2: '#2a002a', accent: '#ccff00', accent2: '#003322' },
    bubblegum: { label: 'Bubblegum', bg: '#ffd6ec', text: '#4a1036', link: '#cc0077', head: '#ff66b3', headText: '#ffffff', box: '#fff0f8', box2: '#ffe0f0', accent: '#9966ff', accent2: '#e8dcff' },
    glitter: { label: 'Glitter Pink', bg: '#ff99cc', text: '#3d0026', link: '#cc0066', head: '#ff3399', headText: '#ffffff', box: '#ffe6f2', box2: '#ffcce6', accent: '#ffcc00', accent2: '#fff2b3' },
    kawaii: { label: 'Kawaii Pastel', bg: '#fdf1ff', text: '#5a3a6b', link: '#b04fd6', head: '#c8a2ff', headText: '#ffffff', box: '#ffffff', box2: '#f3e8ff', accent: '#7ad1c9', accent2: '#dff7f4' },
    babyblue: { label: 'Baby Blue', bg: '#cfe9ff', text: '#16324f', link: '#0b62b5', head: '#7ab8f5', headText: '#ffffff', box: '#f4faff', box2: '#e1f0ff', accent: '#ffb347', accent2: '#ffe9c7' },
    lavender: { label: 'Lavender Dreams', bg: '#e9e1f7', text: '#3b2d55', link: '#6a3fbf', head: '#9a7ad6', headText: '#ffffff', box: '#faf7ff', box2: '#efe7fb', accent: '#e58fb4', accent2: '#fbe3ee' },
    ocean: { label: 'Ocean', bg: '#0b3a5a', text: '#e6f6ff', link: '#7fe3ff', head: '#11688f', headText: '#ffffff', box: '#0f4b70', box2: '#135a85', accent: '#ffd166', accent2: '#4a3a10' },
    sunset: { label: 'Sunset Strip', bg: '#ff7e5f', text: '#2b0f0a', link: '#5b1a6b', head: '#d1495b', headText: '#ffffff', box: '#ffe6d9', box2: '#ffd0bd', accent: '#feb47b', accent2: '#ffe3cc' },
    vapor: { label: 'Vaporwave', bg: '#1a1033', text: '#ffe9ff', link: '#00f0ff', head: '#ff71ce', headText: '#1a1033', box: '#24164a', box2: '#2f1d5e', accent: '#01cdfe', accent2: '#05ffa1' },
    y2k: { label: 'Y2K Chrome', bg: '#c9d1dc', text: '#1a1f29', link: '#2b59c3', head: '#8e9cb3', headText: '#ffffff', box: '#eef2f7', box2: '#dde3ec', accent: '#ff4fa3', accent2: '#ffd6ea' },
    matrix: { label: 'Matrix', bg: '#000000', text: '#00ff41', link: '#00ff41', head: '#003b00', headText: '#00ff41', box: '#001a00', box2: '#002900', accent: '#008f11', accent2: '#001400' },
    terminal: { label: 'CCN Terminal', bg: '#000000', text: '#33ff66', link: '#66ffff', head: '#003300', headText: '#33ff66', box: '#001100', box2: '#002200', accent: '#00aa44', accent2: '#003311' },
    grunge: { label: 'Grunge', bg: '#2e2a24', text: '#e8e0d0', link: '#d9a441', head: '#4a4136', headText: '#f2e6cc', box: '#38332c', box2: '#443d34', accent: '#8c2f1b', accent2: '#3b241c' },
    punk: { label: 'Punk Show', bg: '#111111', text: '#f5f5f5', link: '#ff2d2d', head: '#000000', headText: '#ff2d2d', box: '#1c1c1c', box2: '#2a2a2a', accent: '#ffe600', accent2: '#333000' },
    skater: { label: 'Skate Park', bg: '#5c6770', text: '#f2f2f2', link: '#ffcc00', head: '#2e3338', headText: '#ffffff', box: '#46505a', box2: '#525d68', accent: '#ff6600', accent2: '#4d2b14' },
    camo: { label: 'Camo', bg: '#4b5320', text: '#f0ead6', link: '#e6d690', head: '#2f3517', headText: '#f0ead6', box: '#5b6430', box2: '#69733a', accent: '#8b5a2b', accent2: '#3e2a14' },
    leopard: { label: 'Leopard', bg: '#c8963e', text: '#2b1a05', link: '#7a1f00', head: '#5c3a12', headText: '#ffe6b3', box: '#fff3dc', box2: '#f7e0b5', accent: '#000000', accent2: '#c8963e' },
    zebra: { label: 'Zebra', bg: '#f4f4f4', text: '#111111', link: '#cc0033', head: '#111111', headText: '#ffffff', box: '#ffffff', box2: '#e8e8e8', accent: '#cc0033', accent2: '#ffd6e0' },
    starry: { label: 'Starry Night', bg: '#0a1033', text: '#f2f4ff', link: '#ffd95e', head: '#1d2a66', headText: '#ffd95e', box: '#111a4d', box2: '#1a2460', accent: '#5e8bff', accent2: '#1d2a66' },
    candy: { label: 'Candy Shop', bg: '#fff3b0', text: '#4a2c00', link: '#e0004d', head: '#ff7aa2', headText: '#ffffff', box: '#ffffff', box2: '#fff8d6', accent: '#3ec1d3', accent2: '#d6f6fa' },
    lime: { label: 'Lime Soda', bg: '#d8ff7a', text: '#1f3300', link: '#2a7a00', head: '#7ac943', headText: '#ffffff', box: '#f6ffe0', box2: '#e8ffb8', accent: '#ff7f11', accent2: '#ffe0c2' },
    fire: { label: 'Inferno', bg: '#1a0500', text: '#ffe6cc', link: '#ffae00', head: '#b32400', headText: '#ffffff', box: '#2b0a00', box2: '#3d1000', accent: '#ff4d00', accent2: '#4d1500' },
    ice: { label: 'Frost', bg: '#e6f7ff', text: '#0d2b3e', link: '#0077b3', head: '#99d6f2', headText: '#0d2b3e', box: '#ffffff', box2: '#eefaff', accent: '#7fa8c9', accent2: '#dbe9f4' },
    gold: { label: 'Gold Bling', bg: '#141414', text: '#f5e6b3', link: '#ffd700', head: '#3d3000', headText: '#ffd700', box: '#1f1f1f', box2: '#2b2610', accent: '#d4af37', accent2: '#3d3311' },
    retro95: { label: 'Retro Desktop', bg: '#008080', text: '#000000', link: '#000080', head: '#000080', headText: '#ffffff', box: '#c0c0c0', box2: '#d4d0c8', accent: '#808080', accent2: '#e0e0e0' },
    coffee: { label: 'Coffeehouse', bg: '#3e2723', text: '#f3e5d8', link: '#ffcc80', head: '#5d4037', headText: '#ffffff', box: '#4e342e', box2: '#5d4037', accent: '#a1887f', accent2: '#4e342e' },
    forest: { label: 'Elf Forest', bg: '#1f3a1f', text: '#f0f5e6', link: '#ffdd77', head: '#3d6b2e', headText: '#ffffff', box: '#2a4a26', box2: '#335a2e', accent: '#c08a3e', accent2: '#4a3b20' },
    dungeon: { label: 'Dungeon', bg: '#3a3530', text: '#f2e8d5', link: '#ffb347', head: '#5c5248', headText: '#ffffff', box: '#2b2724', box2: '#3a342e', accent: '#a0522d', accent2: '#4d3324' },
    dragon: { label: 'Dragonfolk Red', bg: '#2a0000', text: '#ffe0cc', link: '#ffb000', head: '#8b0000', headText: '#ffd700', box: '#3a0505', box2: '#4d0a0a', accent: '#ff4500', accent2: '#4d1a00' },
    slime: { label: 'Slime Kingdom', bg: '#b8f5c9', text: '#0b3d1b', link: '#00804a', head: '#3ccf73', headText: '#ffffff', box: '#eafff0', box2: '#d0fadc', accent: '#7a5cff', accent2: '#e3dcff' },
    mages: { label: 'Mages Guild', bg: '#1b1035', text: '#efe6ff', link: '#c9a7ff', head: '#4b2a8a', headText: '#ffe08a', box: '#241548', box2: '#2f1c5c', accent: '#ffcc4d', accent2: '#4a3a12' },
    monsera: { label: 'Royal Monsera', bg: '#f6f0e1', text: '#2c1d0e', link: '#7a1e1e', head: '#1f3b6b', headText: '#f6d77a', box: '#fffaf0', box2: '#efe5cc', accent: '#b8862d', accent2: '#f3e2b8' },
    void: { label: 'The Void', bg: '#000000', text: '#c7c7ff', link: '#9d7bff', head: '#16002e', headText: '#c7c7ff', box: '#07000f', box2: '#10001f', accent: '#5b00b3', accent2: '#1a0033' },
    sky: { label: 'Sky Islands', bg: '#a7d8ff', text: '#10314d', link: '#0050a0', head: '#4ea3e0', headText: '#ffffff', box: '#f5fbff', box2: '#ddeffd', accent: '#ffd34e', accent2: '#fff0bf' }
  };
  var FONTS = {
    verdana: ['Verdana', 'Verdana, Geneva, Tahoma, sans-serif'],
    arial: ['Arial', 'Arial, Helvetica, sans-serif'],
    tahoma: ['Tahoma', 'Tahoma, Verdana, sans-serif'],
    trebuchet: ['Trebuchet', '"Trebuchet MS", sans-serif'],
    comic: ['Comic Sans', '"Comic Sans MS", "Comic Sans", "Chalkboard SE", cursive'],
    times: ['Times', '"Times New Roman", Times, serif'],
    georgia: ['Georgia', 'Georgia, serif'],
    palatino: ['Palatino', '"Palatino Linotype", Palatino, "Book Antiqua", serif'],
    garamond: ['Garamond', 'Garamond, "EB Garamond", serif'],
    courier: ['Courier', '"Courier New", Courier, monospace'],
    lucida: ['Lucida Console', '"Lucida Console", Monaco, monospace'],
    impact: ['Impact', 'Impact, "Arial Black", sans-serif'],
    arialblack: ['Arial Black', '"Arial Black", Gadget, sans-serif'],
    papyrus: ['Papyrus', 'Papyrus, fantasy'],
    brush: ['Brush Script', '"Brush Script MT", "Segoe Script", cursive'],
    copperplate: ['Copperplate', 'Copperplate, "Copperplate Gothic Light", fantasy'],
    pixel: ['Pixel', '"DotGothic16", "Courier New", monospace']
  };
  // Background patterns: Hero Patterns by Steve Schoger (CC BY 4.0, tinted to match the theme) and retro desktop tiles
  // (classic-wallpaper by Peter O., Unlicense; Background-Textures by John Galiszewski, MIT). Files in assets/ourspace-bg/.
  var PAT_DEFAULT = { classic: 'h:plus', night: 'h:fourPointStars', goth: 'h:skulls', emo: 'h:heavyRain', scene: 'h:pixelDots', bubblegum: 'h:polkaDots', glitter: 'h:slantedStars',
    kawaii: 'h:bubbles', babyblue: 'h:endlessClouds', lavender: 'h:wiggle', ocean: 'h:anchorsAway', sunset: 'h:topography', vapor: 'h:graphPaper', y2k: 'r:brushed', matrix: 'h:circuitBoard',
    terminal: 'h:signal', grunge: 'h:texture', punk: 'h:zigZag', skater: 'h:brickWall', camo: 'h:leaf', leopard: 'h:melt', zebra: 'h:wiggle', starry: 'h:fourPointStars', candy: 'h:iLikeFood',
    lime: 'h:bubbles', fire: 'h:fallingTriangles', ice: 'h:hexagons', gold: 'h:glamorous', retro95: 'r:check', coffee: 'h:moroccan', forest: 'h:leaf', dungeon: 'h:brickWall', dragon: 'h:aztec',
    slime: 'h:bubbles', mages: 'h:volcanoLamp', monsera: 'h:formalInvitation', void: 'h:jupiter', sky: 'h:endlessClouds' };
  var OLD_PAT = { stars: 'h:fourPointStars', checker: 'h:tinyCheckers', hearts: 'h:polkaDots', stripes: 'h:stripes', diagonal: 'h:diagonalStripes', plaid: 'h:houndstooth', polka: 'h:polkaDots',
    grid: 'h:graphPaper', diamonds: 'h:flippedDiamonds', waves: 'h:wiggle', scanlines: 'h:rails', sparkle: 'h:slantedStars', zigzag: 'h:zigZag', bricks: 'h:brickWall', circuit: 'h:circuitBoard' };
  var PAT_COLORS = { accent: 'Accent', link: 'Links', head: 'Box headers', text: 'Text', box: 'Boxes', headText: 'Header text' };
  var PAT = { hero: null, retro: null, p: null };
  function patLib() {
    if (!PAT.p) PAT.p = Promise.all([fetch('../assets/ourspace-bg/hero.json').then(function (r) { return r.json(); }), fetch('../assets/ourspace-bg/retro/retro.json').then(function (r) { return r.json(); })])
      .then(function (x) { PAT.hero = x[0]; PAT.retro = x[1]; return PAT; }).catch(function () { PAT.hero = {}; PAT.retro = []; return PAT; });
    return PAT.p;
  }
  function patOf(t) {
    var p = t.pattern;
    if (p === undefined || p === null) p = PAT_DEFAULT[t.preset] || 'none';
    if (OLD_PAT[p]) p = OLD_PAT[p];
    return typeof p === 'string' && /^(none|h:[A-Za-z]+|r:[a-z0-9_]+)$/.test(p) ? p : 'none';
  }
  function heroName(k) { return k.replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); }); }
  function applyPattern(t) {
    var fx = document.getElementById('os-bgfx');
    if (!fx) { fx = document.createElement('div'); fx.id = 'os-bgfx'; fx.setAttribute('aria-hidden', 'true'); document.body.insertBefore(fx, document.body.firstChild); }
    var p = patOf(t), c = themeColors(t)[PAT_COLORS[t.patColor] ? t.patColor : 'accent'], k = Math.max(0.04, Math.min(0.8, +t.patStrength || 0.2)), f = fx.style;
    f.cssText = '';
    document.body.classList.toggle('os-fx', p !== 'none');
    if (p === 'none') return;
    patLib().then(function () {
      if (patOf(t) !== p) return;
      if (p.indexOf('h:') === 0) {
        var tpl = PAT.hero[p.slice(2)]; if (!tpl) return;
        f.backgroundImage = tpl.split('{C}').join(c.slice(1)).split('{O}').join(String(Math.round(k * 100) / 100));
      } else {
        var r = PAT.retro.filter(function (x) { return x.id === p.slice(2); })[0]; if (!r) return;
        var u = 'url("../assets/ourspace-bg/retro/' + r.id + '.png")';
        f.imageRendering = 'pixelated';
        if (r.tint) { f.backgroundColor = c; f.webkitMaskImage = f.maskImage = u; f.webkitMaskSize = f.maskSize = 'auto'; f.opacity = String(Math.min(1, k * 2.2)); }
        else { f.backgroundImage = u; f.opacity = String(Math.min(1, 0.25 + k * 1.2)); }
      }
    });
  }
  var BG_MODES = { tile: 'Tile it', cover: 'Stretch to fill', center: 'Center it once', fixed: 'Fill and stay put when scrolling' };
  var COLOR_KEYS = [['bg', 'Background'], ['text', 'Text'], ['link', 'Links'], ['head', 'Box headers'], ['headText', 'Header text'], ['box', 'Boxes'], ['box2', 'Box shading'], ['accent', 'Accent'], ['accent2', 'Accent shading']];
  var CSSVAR = { bg: '--os-bg', text: '--os-text', link: '--os-link', head: '--os-head', headText: '--os-head-text', box: '--os-box', box2: '--os-box2', accent: '--os-accent', accent2: '--os-accent2' };
  function hex(v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : null; }
  function themeColors(t) {
    t = t || {};
    var base = THEMES[t.preset] || THEMES.classic, out = {};
    COLOR_KEYS.forEach(function (k) { out[k[0]] = hex((t.colors || {})[k[0]]) || base[k[0]]; });
    return out;
  }

  // ---------- custom layout code (like the old days): CSS only, never scripts ----------
  // Every rule is kept inside the page's content area (#os-main), which also boxes in anything "fixed",
  // so a layout can restyle its own page but can't cover the menus or pretend to be another page.
  // "body" rules may only change the page background, colors, fonts, and cursor.
  var CSS_MAX = 20000;
  var BODY_OK = /^(background(-[a-z]+)?|color|font(-[a-z]+)?|cursor|text-shadow|letter-spacing|line-height)$/;
  function cleanDecls(txt, bodyRule) {
    return txt.split(';').map(function (d) {
      var i = d.indexOf(':'); if (i < 0) return '';
      var prop = d.slice(0, i).trim().toLowerCase(), val = d.slice(i + 1).trim();
      if (!/^-?[a-z][a-z0-9-]*$/.test(prop) || !val) return '';
      if (bodyRule && !BODY_OK.test(prop)) return '';
      if (/expression|javascript:|vbscript:|behavior|binding|@import|<|\\/.test(val)) return '';
      var bad = false;
      val = val.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, function (m, q, u) { if (!/^https:\/\/[^\s'"()]+$/i.test(u)) bad = true; return 'url("' + u + '")'; });
      if (bad) return '';
      return prop + ': ' + val;
    }).filter(Boolean).join('; ');
  }
  function scopeSel(sel) {
    return sel.split(',').map(function (x) {
      x = x.trim(); if (!x) return null;
      if (/^(html|body)$/i.test(x)) return 'body.os-custom';
      if (/^(html|body)\b/i.test(x)) return null;   // nothing outside the content area
      if (/[{}<]/.test(x)) return null;
      return '#os-main ' + x;
    }).filter(Boolean).join(', ');
  }
  function cleanCss(src) {
    src = String(src || '').slice(0, CSS_MAX).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[a-z-]+[^{};]*;/gi, '');
    var out = '', i = 0;
    function block(start) { var depth = 0; for (var j = start; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (!depth) return j; } } return src.length; }
    function rules(text) {
      var res = '', k = 0;
      while (k < text.length) {
        var open = text.indexOf('{', k); if (open < 0) break;
        var close = text.indexOf('}', open); if (close < 0) break;
        var sel = scopeSel(text.slice(k, open)), body = cleanDecls(text.slice(open + 1, close), /body\.os-custom/.test(sel) && sel.split(',').length === 1);
        if (sel && body) res += sel + ' { ' + body + ' }\n';
        k = close + 1;
      }
      return res;
    }
    while (i < src.length) {
      var at = src.indexOf('@', i), open = src.indexOf('{', i);
      if (open < 0) break;
      if (at >= 0 && at < open) {
        var head = src.slice(at, open).trim(), end = block(open), inner = src.slice(open + 1, end);
        out += rules(src.slice(i, at));
        if (/^@media\s+[^{;]+$/i.test(head) && !/[<>]/.test(head)) out += head + ' {\n' + rules(inner) + '}\n';
        else if (/^@(-webkit-)?keyframes\s+[a-z0-9_-]+$/i.test(head)) {
          var kf = '', m2, re = /([^{}]+)\{([^{}]*)\}/g;
          while ((m2 = re.exec(inner))) { if (/^\s*(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*\s*$/i.test(m2[1])) kf += m2[1].trim() + ' { ' + cleanDecls(m2[2]) + ' }\n'; }
          out += head + ' {\n' + kf + '}\n';
        }
        i = end + 1;
      } else {
        var close = src.indexOf('}', open); if (close < 0) break;
        out += rules(src.slice(i, close + 1));
        i = close + 1;
      }
    }
    return out;
  }
  function bgUrl(u) { return typeof u === 'string' && /^https:\/\/[^\s'"()]+$/i.test(u) ? u : ''; }
  function applyTheme(t) {
    t = t || {};
    var c = themeColors(t), r = document.documentElement.style;
    Object.keys(CSSVAR).forEach(function (k) { r.setProperty(CSSVAR[k], c[k]); });
    r.setProperty('--os-font', (FONTS[t.font] || FONTS.verdana)[1]);
    applyPattern(t);
    // Your own background picture: replaces the theme's background and pattern, leaves everything else alone
    var bg = bgUrl((t.bgImage || {}).url), mode = BG_MODES[(t.bgImage || {}).mode] ? t.bgImage.mode : 'tile', b = document.body.style;
    document.body.classList.toggle('os-has-bg', !!bg);
    b.backgroundImage = bg ? 'url("' + bg + '")' : '';
    b.backgroundRepeat = bg ? (mode === 'tile' ? 'repeat' : 'no-repeat') : '';
    b.backgroundSize = bg ? (mode === 'cover' || mode === 'fixed' ? 'cover' : 'auto') : '';
    b.backgroundPosition = bg ? (mode === 'center' ? 'center top' : '0 0') : '';
    b.backgroundAttachment = bg && mode === 'fixed' ? 'fixed' : '';
    // Your own layout code
    var css = cleanCss(t.css), tag = document.getElementById('os-custom-css');
    if (!tag) { tag = document.createElement('style'); tag.id = 'os-custom-css'; document.head.appendChild(tag); }
    tag.textContent = css;
    document.body.classList.toggle('os-custom', !!css);
  }
  // Layout codes people can copy and share
  function themeCode(t) { try { return 'OURSPACE:' + btoa(unescape(encodeURIComponent(JSON.stringify(t)))); } catch (e) { return ''; } }
  function readThemeCode(code) {
    try {
      var s = String(code || '').trim().replace(/^OURSPACE:/, '');
      var t = JSON.parse(decodeURIComponent(escape(atob(s))));
      return t && typeof t === 'object' ? t : null;
    } catch (e) { return null; }
  }

  // ---------- shell ----------
  async function unread() {
    if (!me) return 0;
    var r = await db.from('messages').select('id', { count: 'exact', head: true }).eq('recipient', me.id).is('read_at', null).eq('hidden_by_recipient', false);
    return r.error ? 0 : (r.count || 0);
  }
  async function shell() {
    var addr = { home: '', user: 'profile', char: 'character', edit: 'edit', mail: 'mail' }[page] || '';
    var links = [['home', 'Home', 'index.html']];
    if (me) links.push(['user', 'My Page', uLink(me.username)], ['mail', 'Mail', 'messages.html'], ['edit', 'Edit Page', 'edit.html']);
    else links.push(['login', 'Log In', '../account/index.html?next=ourspace/index.html']);
    links.push(['site', 'Back to Terrana', '../index.html']);
    var nav = el('nav', { class: 'os-links', 'aria-label': 'OurSpace' });
    links.forEach(function (l) {
      var mine = l[0] === 'user' && page === 'user' && qs.get('u') && me && qs.get('u').toLowerCase() === me.username.toLowerCase();
      var a = el('a', { href: l[2], 'aria-current': (l[0] === page && (l[0] !== 'user' || mine)) ? 'page' : null, text: l[1] });
      if (l[0] === 'mail') { a.id = 'mail-link'; }
      nav.appendChild(a);
    });
    var top = el('div', {}, [
      el('div', { class: 'os-address', 'aria-hidden': 'true', text: 'CCN://ourspace.blogspot.ccn/' + addr }),
      el('header', { class: 'os-top' }, [
        el('a', { class: 'os-logo', href: 'index.html' }, ['Our', el('span', { text: 'Space' }), el('small', { text: 'a place for adventurers' })]),
        nav
      ])
    ]);
    document.body.insertBefore(top, document.body.firstChild);
    // The OurSpace Radio on pages without a profile song (profile pages put it in their left column)
    if (page !== 'user' && page !== 'char' && window.TerranaMusic) {
      var strip = el('details', { class: 'os-radio' }, [el('summary', { text: '♫ OurSpace Radio' })]);
      var holder = el('div', {}); strip.appendChild(holder);
      top.appendChild(strip);
      window.TerranaMusic.mountPlayer(holder, {});
    }
    document.body.appendChild(el('footer', { class: 'os-foot' }, ['OurSpace is part of ', el('a', { href: '../index.html', text: 'Jimothy’s D10 Isekai JRPG' }), '. Be kind. Your Storyteller is watching.', el('br'),
      'Background patterns: ', el('a', { href: 'https://heropatterns.com', text: 'Hero Patterns' }), ' by Steve Schoger (CC BY 4.0). Retro tiles: ', el('a', { href: 'https://github.com/peteroupc/classic-wallpaper', text: 'classic-wallpaper' }), ' by Peter O. (Unlicense) and ',
      el('a', { href: 'https://github.com/JohnGWebDev/Background-Textures', text: 'Background-Textures' }), ' by John Galiszewski (MIT). Music by Juhani Junkala (CC0).']));
    var n = await unread();
    if (n) $('mail-link').appendChild(el('span', { class: 'os-badge', text: String(n), 'aria-label': n + ' unread' }));
  }

  // ---------- data ----------
  async function profilesById(ids) {
    ids = ids.filter(Boolean);
    if (!ids.length) return {};
    var rows = await must(db.from('profiles').select('id, username').in('id', ids));
    var out = {}; rows.forEach(function (r) { out[r.id] = r; }); return out;
  }
  async function playerPages(ids) {
    ids = ids.filter(Boolean);
    if (!ids.length) return {};
    var rows = await must(db.from('player_pages').select('*').in('id', ids));
    var out = {}; rows.forEach(function (r) { out[r.id] = r; }); return out;
  }
  async function charPages(ids) {
    ids = ids.filter(Boolean);
    if (!ids.length) return {};
    var rows = await must(db.from('character_pages').select('*').in('id', ids));
    var out = {}; rows.forEach(function (r) { out[r.id] = r; }); return out;
  }
  async function friendIds(id) {
    var rows = await must(db.from('friendships').select('requester, addressee, status').eq('status', 'accepted').or('requester.eq.' + id + ',addressee.eq.' + id));
    return rows.map(function (r) { return r.requester === id ? r.addressee : r.requester; });
  }
  // Friendship between me and someone: null, 'friends', 'sent', or 'received'
  async function relation(id) {
    if (!me || me.id === id) return null;
    var rows = await must(db.from('friendships').select('requester, addressee, status')
      .or('and(requester.eq.' + me.id + ',addressee.eq.' + id + '),and(requester.eq.' + id + ',addressee.eq.' + me.id + ')'));
    var r = rows[0];
    if (!r) return null;
    if (r.status === 'accepted') return 'friends';
    return r.requester === me.id ? 'sent' : 'received';
  }
  async function befriend(id) { return must(db.from('friendships').insert({ requester: me.id, addressee: id })); }
  async function accept(id) { return must(db.from('friendships').update({ status: 'accepted' }).eq('requester', id).eq('addressee', me.id)); }
  async function unfriend(id) {
    await must(db.from('friendships').delete().eq('requester', me.id).eq('addressee', id));
    await must(db.from('friendships').delete().eq('requester', id).eq('addressee', me.id));
  }

  // ---------- pieces ----------
  // entries: [{t:'p'|'c', id}]
  async function top8Box(title, entries, emptyText) {
    entries = (entries || []).filter(function (e) { return e && e.id && (e.t === 'p' || e.t === 'c'); }).slice(0, 8);
    var pids = entries.filter(function (e) { return e.t === 'p'; }).map(function (e) { return e.id; });
    var cids = entries.filter(function (e) { return e.t === 'c'; }).map(function (e) { return e.id; });
    var pr = await profilesById(pids), pp = await playerPages(pids), cp = await charPages(cids);
    var owners = await profilesById(Object.keys(cp).map(function (k) { return cp[k].owner; }));
    var grid = el('div', { class: 'os-top8' });
    entries.forEach(function (e) {
      if (e.t === 'p' && pr[e.id]) {
        var pg = pp[e.id] || {};
        grid.appendChild(el('div', { class: 'os-friend' }, [el('a', { href: uLink(pr[e.id].username) }, [pic(pg.pic_url, pr[e.id].username), el('span', { text: pg.display_name || pr[e.id].username })])]));
      } else if (e.t === 'c' && cp[e.id]) {
        grid.appendChild(el('div', { class: 'os-friend' }, [el('a', { href: cLink(e.id) }, [pic(cp[e.id].pic_url, cp[e.id].name), el('span', { text: cp[e.id].name })]),
          el('small', { text: owners[cp[e.id].owner] ? 'by ' + owners[cp[e.id].owner].username : '' })]));
      }
    });
    return box(title, grid.children.length ? [grid] : [el('p', { class: 'os-hint', text: emptyText })], 'os-top8box');
  }

  async function postsBox(title, author, characterId, mine) {
    var q = db.from('posts').select('*').eq('author', author).order('created_at', { ascending: false }).limit(30);
    q = characterId ? q.eq('character_id', characterId) : q.is('character_id', null);
    var posts = await must(q);
    var inner = [];
    if (mine) {
      var f = el('form', { class: 'os-form', id: 'post-form' }, [
        el('div', {}, [el('label', { for: 'post-title', text: 'New blog entry' }), el('input', { id: 'post-title', maxlength: '120', placeholder: 'Title', required: true })]),
        el('div', {}, [el('label', { for: 'post-body', class: 'visually-hidden', text: 'Entry' }), el('textarea', { id: 'post-body', maxlength: '10000', placeholder: 'What happened today?', required: true })]),
        el('div', {}, [el('label', { for: 'post-pics', text: 'Add pictures (up to 4)' }), el('input', { id: 'post-pics', type: 'file', accept: 'image/*', multiple: true }), el('div', { class: 'os-thumbs', id: 'post-thumbs' })]),
        el('div', { class: 'row' }, [
          el('div', {}, [el('label', { for: 'post-vis', text: 'Who can read it' }), el('select', { id: 'post-vis' }, [
            el('option', { value: 'public', text: 'Everyone' }), el('option', { value: 'friends', text: 'Friends only' }), el('option', { value: 'private', text: 'Only me' })])]),
          el('div', { style: 'align-self:end' }, [el('button', { class: 'os-btn go', type: 'submit', text: 'Post It' })])
        ]),
        el('p', { class: 'os-msg', id: 'post-msg', role: 'alert' })
      ]);
      f.querySelector('#post-pics').addEventListener('change', function (ev) {
        var th = $('post-thumbs'); th.textContent = '';
        var files = Array.prototype.slice.call(ev.target.files || [], 0, 4);
        if ((ev.target.files || []).length > 4) say('post-msg', 'Only the first 4 pictures will be added.', true); else say('post-msg', '');
        files.forEach(function (fl) { th.appendChild(el('img', { src: URL.createObjectURL(fl), alt: fl.name })); });
      });
      f.addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var t = $('post-title').value.trim(), b = $('post-body').value.trim();
        if (!t || !b) { say('post-msg', 'Give your entry a title and some words.', true); return; }
        var btn = f.querySelector('button[type=submit]');
        btn.disabled = true;
        try {
          var files = Array.prototype.slice.call($('post-pics').files || [], 0, 4), imgs = [];
          for (var i = 0; i < files.length; i++) { say('post-msg', 'Uploading picture ' + (i + 1) + ' of ' + files.length + '...'); imgs.push(await uploadPic(files[i], 'post', 1400)); }
          var row = { author: me.id, character_id: characterId || null, title: t, body: b, visibility: $('post-vis').value };
          if (imgs.length) row.images = imgs;
          await must(db.from('posts').insert(row));
          location.reload();
        } catch (e) { btn.disabled = false; say('post-msg', oops(e), true); }
      });
      inner.push(f);
    }
    if (!posts.length) inner.push(el('p', { class: 'os-hint', text: 'No blog entries yet.' }));
    var VIS = { public: '', friends: ' (friends only)', private: ' (only you)' };
    posts.forEach(function (p) {
      var row = el('article', { class: 'os-post' }, [
        el('h4', { text: p.title }),
        el('div', { class: 'when', text: when(p.created_at) + (mine ? VIS[p.visibility] || '' : '') }),
        el('div', { class: 'body', text: p.body }),
        postPics(p)
      ]);
      if (mine) row.appendChild(el('button', { class: 'os-btn danger', type: 'button', text: 'Delete', onclick: async function () {
        if (!confirm('Delete "' + p.title + '"?')) return;
        try { await must(db.from('posts').delete().eq('id', p.id)); row.remove(); } catch (e) { alert(oops(e)); }
      } }));
      inner.push(row);
    });
    return box(title, inner, 'orange os-blog');
  }

  function postPics(p) {
    var list = (p.images || []).filter(function (u) { return typeof u === 'string' && /^https:\/\//.test(u); }).slice(0, 4);
    if (!list.length) return null;
    return el('div', { class: 'os-post-pics' }, list.map(function (u) {
      return el('a', { href: u, target: '_blank', rel: 'noopener' }, [el('img', { src: u, alt: 'Picture from ' + p.title, referrerpolicy: 'no-referrer', loading: 'lazy' })]);
    }));
  }
  function friendButtons(targetId, rel, msgHref) {
    var wrap = el('div', {});
    if (!me) { wrap.appendChild(el('a', { class: 'os-btn', href: '../account/index.html?next=ourspace/index.html', text: 'Log in to add friends' })); return wrap; }
    if (me.id === targetId) return wrap;
    function act(label, fn, cls) {
      return el('button', { class: 'os-btn ' + (cls || ''), type: 'button', text: label, onclick: async function (ev) {
        ev.target.disabled = true;
        try { if ((await fn()) === false) { ev.target.disabled = false; return; } location.reload(); } catch (e) { ev.target.disabled = false; alert(oops(e)); }
      } });
    }
    if (rel === 'friends') {
      wrap.appendChild(el('a', { class: 'os-btn go', href: msgHref, text: 'Send Message' }));
      wrap.appendChild(act('Remove Friend', function () { if (!confirm('Remove this friend?')) return false; return unfriend(targetId); }, 'danger'));
    } else if (rel === 'sent') {
      wrap.appendChild(el('span', { class: 'os-hint', text: 'Friend request sent. ' }));
      wrap.appendChild(act('Cancel Request', function () { return unfriend(targetId); }));
    } else if (rel === 'received') {
      wrap.appendChild(act('Accept Friend Request', function () { return accept(targetId); }, 'go'));
      wrap.appendChild(act('Decline', function () { return unfriend(targetId); }));
    } else {
      wrap.appendChild(act('Add to Friends', function () { return befriend(targetId); }, 'go'));
    }
    return wrap;
  }

  function infoTable(rows) {
    var t = el('table', { class: 'os-table' });
    rows.filter(function (r) { return r[1] && String(r[1]).trim(); }).forEach(function (r) {
      t.appendChild(el('tr', {}, [el('th', { scope: 'row', text: r[0] }), el('td', { text: r[1] })]));
    });
    return t.children.length ? t : el('p', { class: 'os-hint', text: 'Nothing here yet.' });
  }

  // ---------- Home ----------
  async function home(main) {
    var left = el('div', { class: 'os-col' }), right = el('div', { class: 'os-col' });
    main.appendChild(el('div', { class: 'os-cols' }, [left, right]));
    if (me) {
      left.appendChild(box('Hello, ' + me.username + '!', [
        el('p', {}, ['Welcome to OurSpace, where adventurers, their characters, and their friends hang out.']),
        el('a', { class: 'os-btn go', href: uLink(me.username), text: 'View My Page' }),
        el('a', { class: 'os-btn', href: 'edit.html', text: 'Edit My Page' }),
        el('a', { class: 'os-btn', href: 'messages.html', text: 'Mail' })
      ]));
      var reqs = await must(db.from('friendships').select('requester, addressee, status, created_at').eq('status', 'pending').or('requester.eq.' + me.id + ',addressee.eq.' + me.id));
      var people = await profilesById(reqs.map(function (r) { return r.requester === me.id ? r.addressee : r.requester; }));
      var list = el('ul', { class: 'os-list' });
      reqs.forEach(function (r) {
        var other = r.requester === me.id ? r.addressee : r.requester, p = people[other];
        if (!p) return;
        var li = el('li', {}, [el('span', {}, [el('a', { href: uLink(p.username), text: p.username }), r.requester === me.id ? ' (waiting on them)' : ' wants to be your friend'])]);
        li.appendChild(friendButtons(other, r.requester === me.id ? 'sent' : 'received', ''));
        list.appendChild(li);
      });
      left.appendChild(box('Friend Requests', list.children.length ? [list] : [el('p', { class: 'os-hint', text: 'No friend requests right now.' })], 'orange'));
      var fids = await friendIds(me.id), fp = await profilesById(fids);
      var fl = el('ul', { class: 'os-list' });
      fids.forEach(function (id) { if (fp[id]) fl.appendChild(el('li', {}, [el('a', { href: uLink(fp[id].username), text: fp[id].username }), el('a', { class: 'os-btn', href: 'messages.html?to=' + encodeURIComponent(fp[id].username), text: 'Message' })])); });
      left.appendChild(box('My Friends (' + fids.length + ')', fl.children.length ? [fl] : [el('p', { class: 'os-hint', text: 'No friends yet. Find the people you play with below and add them.' })]));
    } else {
      left.appendChild(box('Welcome to OurSpace', [
        el('p', { text: 'Make a page for yourself and every character you play, add friends, pick your Top 8, and keep a blog.' }),
        el('a', { class: 'os-btn go', href: '../account/index.html?next=ourspace/index.html', text: 'Log In' }),
        el('a', { class: 'os-btn', href: '../account/index.html?next=ourspace/index.html#signup', text: 'Sign Up' })
      ]));
    }
    var find = el('form', { class: 'os-form' }, [
      el('div', {}, [el('label', { for: 'find-name', text: 'Find a player by username' }), el('input', { id: 'find-name', maxlength: '20', autocomplete: 'off' })]),
      el('div', {}, [el('button', { class: 'os-btn go', type: 'submit', text: 'Go' })]),
      el('p', { class: 'os-msg', id: 'find-msg', role: 'alert' })
    ]);
    find.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var n = $('find-name').value.trim();
      if (!n) return;
      var r = await db.from('profiles').select('username').eq('username', n).maybeSingle();
      if (r.data) location.href = uLink(r.data.username); else say('find-msg', 'No player has that username.', true);
    });
    left.appendChild(box('Find People', [find]));

    var newest = await must(db.from('profiles').select('id, username, created_at').order('created_at', { ascending: false }).limit(8));
    right.appendChild(await top8Box('Cool New People', newest.map(function (p) { return { t: 'p', id: p.id }; }), 'Nobody here yet.'));
    var chars = await must(db.from('character_pages').select('id').order('updated_at', { ascending: false }).limit(8));
    right.appendChild(await top8Box('Recently Updated Characters', chars.map(function (c) { return { t: 'c', id: c.id }; }), 'No characters yet.'));
    var posts = await must(db.from('posts').select('*').order('created_at', { ascending: false }).limit(10));
    var who = await profilesById(posts.map(function (p) { return p.author; })), cps = await charPages(posts.map(function (p) { return p.character_id; }));
    var pl = [];
    posts.forEach(function (p) {
      var by = p.character_id && cps[p.character_id] ? el('a', { href: cLink(p.character_id), text: cps[p.character_id].name }) : who[p.author] ? el('a', { href: uLink(who[p.author].username), text: who[p.author].username }) : 'someone';
      pl.push(el('article', { class: 'os-post' }, [el('h4', { text: p.title }), el('div', { class: 'when' }, ['by ', by, ', ' + when(p.created_at)]),
        el('div', { class: 'body', text: p.body.length > 400 ? p.body.slice(0, 400) + '...' : p.body }), postPics(p)]));
    });
    right.appendChild(box('Latest Blog Entries', pl.length ? pl : [el('p', { class: 'os-hint', text: 'No blog entries yet.' })], 'orange'));
  }

  // ---------- Player page ----------
  // ---------- Profile songs: one from the site's music, or one the player uploaded ----------
  var SONG_BUCKET = 'ourspace-music';
  function songBase() { return db.storage.from(SONG_BUCKET).getPublicUrl('x').data.publicUrl.replace(/x$/, ''); }
  function cleanSong(sg) {
    if (!sg || typeof sg !== 'object') return null;
    if (sg.lib && typeof sg.lib === 'string') return { lib: sg.lib.slice(0, 60) };
    if (typeof sg.url === 'string' && sg.url.indexOf(songBase()) === 0) return { url: sg.url, title: String(sg.title || 'Song').slice(0, 80) };
    return null;
  }
  // Use This Layout: copies someone's look (not their song) into your Edit page, where you can change it and save
  function borrowBtn(theme) {
    if (!theme || !Object.keys(theme).length) return null;
    return el('button', { class: 'os-btn', type: 'button', text: 'Use This Layout', title: 'Copy this page’s look to your own page', onclick: function () {
      var t = Object.assign({}, theme); delete t.song;
      try { localStorage.setItem('os-borrow', themeCode(t)); } catch (e) {}
      location.href = 'edit.html';
    } });
  }
  function radioBox() {
    if (!window.TerranaMusic) return null;
    var holder = el('div', {});
    var b = box('♫ OurSpace Radio', [holder], 'os-songbox');
    window.TerranaMusic.mountPlayer(holder, {});
    return b;
  }
  function songBox(theme, owner) {
    var sg = cleanSong((theme || {}).song), M = window.TerranaMusic;
    if (!sg || !M) return null;
    var holder = el('div', {});
    var b = box('♫ ' + owner + '’s Song', [holder], 'os-songbox');
    M.setRepeat('one');
    M.mountPlayer(holder, {});   // the full player: visitors can switch to any mood or track
    var auto = (theme || {}).songAuto !== false;   // the page owner chooses whether it starts by itself
    if (sg.lib) M.play(sg.lib, { paused: !auto, mood: 'all' });
    else M.refreshUploads().then(function () {
      // an uploaded song plays from its uploader's group, so the track list shows their other songs too
      var g = M.uploads().filter(function (x) { return x.tracks.some(function (id) { var t = M.track(id); return t && t.url === sg.url; }); })[0];
      var id = g && g.tracks.filter(function (id) { return M.track(id).url === sg.url; })[0];
      if (id) M.play(id, { paused: !auto, mood: g.id }); else M.playUrl(sg.url, sg.title, { paused: !auto });
    });
    if (auto) M.autoStart();
    return b;
  }

  async function userPage(main) {
    var name = qs.get('u') || (me && me.username);
    if (!name) { main.appendChild(box('No page picked', [el('p', { text: 'Pick a player from the OurSpace home page.' })])); return; }
    var prof = await must(db.from('profiles').select('id, username, created_at').eq('username', name).maybeSingle());
    if (!prof) { main.appendChild(box('Not found', [el('p', { text: 'No player has that username.' })])); return; }
    document.title = prof.username + ' | OurSpace';
    var pg = (await must(db.from('player_pages').select('*').eq('id', prof.id).maybeSingle())) || {};
    applyTheme(pg.theme);
    var mine = !!me && me.id === prof.id;
    var rel = await relation(prof.id);
    var fids = await friendIds(prof.id);
    var chars = await must(db.from('character_pages').select('*').eq('owner', prof.id).order('name', { ascending: true }));
    var it = pg.interests || {};

    var left = el('div', { class: 'os-col' }), right = el('div', { class: 'os-col' });
    main.appendChild(el('div', { class: 'os-cols' }, [left, right]));
    left.appendChild(el('section', { class: 'os-box' }, [el('div', { class: 'in' }, [
      el('h1', { class: 'os-name', text: pg.display_name || prof.username }),
      el('div', { class: 'os-profile' }, [pic(pg.pic_url, prof.username), el('div', {}, [
        pg.tagline ? el('p', { class: 'os-tag', text: '"' + pg.tagline + '"' }) : null,
        pg.mood ? el('p', { class: 'os-meta' }, [el('strong', { text: 'Mood: ' }), pg.mood]) : null,
        el('p', { class: 'os-meta', text: '@' + prof.username }),
        el('p', { class: 'os-meta', text: 'Joined ' + day(prof.created_at) }),
        pg.updated_at ? el('p', { class: 'os-meta', text: 'Last updated ' + day(pg.updated_at) }) : null
      ])]),
      pg.status ? el('p', {}, [el('strong', { text: 'Status: ' }), pg.status]) : null,
      mine ? el('a', { class: 'os-btn go', href: 'edit.html', text: 'Edit My Page' }) : friendButtons(prof.id, rel, 'messages.html?to=' + encodeURIComponent(prof.username)),
      !mine && me ? borrowBtn(pg.theme) : null
    ])]));
    var sbx = songBox(pg.theme, pg.display_name || prof.username) || radioBox(); if (sbx) left.appendChild(sbx);
    left.appendChild(box(prof.username + '’s Interests', [infoTable([['General', it.general], ['Music', it.music], ['Heroes', it.heroes], ['Games', it.games], ['Groups', it.groups]])]));
    var cl = el('ul', { class: 'os-list' });
    chars.forEach(function (c) { cl.appendChild(el('li', {}, [el('a', { href: cLink(c.id), text: c.name }), c.tagline ? el('span', { class: 'os-hint', text: c.tagline }) : null])); });
    left.appendChild(box(prof.username + '’s Characters', cl.children.length ? [cl] : [el('p', { class: 'os-hint', text: mine ? 'Make a character in the Forge and it shows up here.' : 'No characters yet.' })]));

    right.appendChild(box('About Me', [el('div', { class: 'os-post' }, [el('div', { class: 'body', text: pg.about || (mine ? 'Tell people about yourself on the Edit page.' : '') })]),
      pg.who_to_meet ? el('h3', { text: 'Who I’d like to meet' }) : null, pg.who_to_meet ? el('div', { class: 'body', style: 'white-space:pre-wrap', text: pg.who_to_meet }) : null], 'orange'));
    var top = (pg.top8 || []).filter(function (e) { return e.t === 'c' || fids.indexOf(e.id) >= 0; });
    var t8 = await top8Box(prof.username + '’s Friend Space', top, mine ? 'Pick your Top 8 on the Edit page.' : 'No Top 8 yet.');
    t8.querySelector('.in').insertBefore(el('p', {}, [el('strong', { text: prof.username + ' has ' + fids.length + ' friend' + (fids.length === 1 ? '' : 's') + '.' })]), t8.querySelector('.in').firstChild);
    right.appendChild(t8);
    right.appendChild(await postsBox(prof.username + '’s Blog', prof.id, null, mine));
  }

  // ---------- Character page ----------
  async function charPage(main) {
    var id = qs.get('id');
    var cp = id ? await must(db.from('character_pages').select('*').eq('id', id).maybeSingle()) : null;
    if (!cp) { main.appendChild(box('Not found', [el('p', { text: 'That character page does not exist.' })])); return; }
    document.title = cp.name + ' | OurSpace';
    applyTheme(cp.theme);
    var owner = (await profilesById([cp.owner]))[cp.owner] || { username: '' };
    var mine = !!me && me.id === cp.owner;
    var rel = await relation(cp.owner);
    var sheet = await db.from('characters').select('id, sheet_visibility').eq('id', id).maybeSingle();
    var canSheet = !sheet.error && !!sheet.data;
    var d = cp.details || {};

    var left = el('div', { class: 'os-col' }), right = el('div', { class: 'os-col' });
    main.appendChild(el('div', { class: 'os-cols' }, [left, right]));
    left.appendChild(el('section', { class: 'os-box' }, [el('div', { class: 'in' }, [
      el('h1', { class: 'os-name', text: d.display_name || cp.name }),
      el('div', { class: 'os-profile' }, [pic(cp.pic_url, cp.name), el('div', {}, [
        cp.tagline ? el('p', { class: 'os-tag', text: '"' + cp.tagline + '"' }) : null,
        cp.mood ? el('p', { class: 'os-meta' }, [el('strong', { text: 'Mood: ' }), cp.mood]) : null,
        el('p', { class: 'os-meta' }, ['Played by ', el('a', { href: uLink(owner.username), text: owner.username })]),
        cp.updated_at ? el('p', { class: 'os-meta', text: 'Last updated ' + day(cp.updated_at) }) : null
      ])]),
      cp.status ? el('p', {}, [el('strong', { text: 'Status: ' }), cp.status]) : null,
      canSheet ? el('a', { class: 'os-btn', href: '../characters/view.html?id=' + encodeURIComponent(id), text: 'View Character Sheet' }) : null,
      mine ? el('a', { class: 'os-btn go', href: 'edit.html?c=' + encodeURIComponent(id), text: 'Edit This Page' }) : null,
      !mine && me ? borrowBtn(cp.theme) : null,
      !mine && rel === 'friends' ? el('a', { class: 'os-btn go', href: 'messages.html?to=' + encodeURIComponent(owner.username) + '&tc=' + encodeURIComponent(id), text: 'Send ' + cp.name + ' a Message' }) : null,
      !mine && me && rel !== 'friends' ? el('p', { class: 'os-hint' }, ['Become friends with ', el('a', { href: uLink(owner.username), text: owner.username }), ' to message their characters.']) : null
    ])]));
    var sbc = songBox(cp.theme, d.display_name || cp.name) || radioBox(); if (sbc) left.appendChild(sbc);
    left.appendChild(box('Details', [infoTable([['Heritage', d.heritage], ['Past Life', d.past_life], ['Party', d.party], ['Rank', d.rank], ['Location', d.location],
      ['Age', d.age], ['Birthday', d.birthday], ['Star Sign', d.star_sign], ['Height', d.height], ['Hair', d.hair], ['Eyes', d.eyes], ['Relationship', d.relationship],
      ['Likes', d.likes], ['Dislikes', d.dislikes], ['Favorite Food', d.fav_food], ['Fear', d.fear]])]));
    left.appendChild(box('Inventory', [el('div', { class: 'body', style: 'white-space:pre-wrap', text: d.inventory || 'Empty pockets.' })]));
    right.appendChild(box('About ' + cp.name, [el('div', { class: 'body', style: 'white-space:pre-wrap', text: cp.about || (mine ? 'Write about your character on the Edit page.' : '') }),
      d.who_to_meet ? el('h3', { text: 'Who I’d like to meet' }) : null, d.who_to_meet ? el('div', { class: 'body', style: 'white-space:pre-wrap', text: d.who_to_meet }) : null], 'orange'));
    right.appendChild(await top8Box(cp.name + '’s Top 8', cp.top8 || [], mine ? 'Pick this character’s Top 8 on the Edit page.' : 'No Top 8 yet.'));
    right.appendChild(await postsBox(cp.name + '’s Blog', cp.owner, id, mine));
  }

  // ---------- Edit ----------
  function field(id, label, value, opts) {
    opts = opts || {};
    var input = opts.long ? el('textarea', { id: id, maxlength: String(opts.max || 4000) }) : el('input', { id: id, maxlength: String(opts.max || 120), type: opts.type || 'text', placeholder: opts.ph || null });
    input.value = value || '';
    return el('div', {}, [el('label', { for: id, text: label }), input]);
  }
  function val(id) { return ($(id).value || '').trim(); }
  async function editPage(main) {
    if (!me) { main.appendChild(box('Log in first', [el('a', { class: 'os-btn go', href: '../account/index.html?next=ourspace/edit.html', text: 'Log In' })])); return; }
    var cid = qs.get('c');
    var row, isChar = !!cid;
    if (isChar) {
      row = await must(db.from('character_pages').select('*').eq('id', cid).maybeSingle());
      if (!row || row.owner !== me.id) { main.appendChild(box('Not yours', [el('p', { text: 'You can only edit your own characters’ pages.' })])); return; }
    } else {
      row = (await must(db.from('player_pages').select('*').eq('id', me.id).maybeSingle())) || { id: me.id };
    }
    var theme = row.theme || {};
    applyTheme(theme);
    var d = row.details || {}, it = row.interests || {};
    var mineChars = await must(db.from('character_pages').select('id, name, owner').eq('owner', me.id).order('name', { ascending: true }));
    var fids = await friendIds(me.id), fp = await profilesById(fids);
    var friendChars = fids.length ? await must(db.from('character_pages').select('id, name, owner').in('owner', fids).order('name', { ascending: true })) : [];
    var vis = null;
    if (isChar) { var s = await db.from('characters').select('sheet_visibility').eq('id', cid).maybeSingle(); vis = s.data ? s.data.sheet_visibility : 'private'; }

    var form = el('form', { class: 'os-form' });
    form.appendChild(el('h1', { class: 'os-name', text: isChar ? 'Edit ' + row.name + '’s Page' : 'Edit My Page' }));
    form.appendChild(el('p', { class: 'os-msg', id: 'edit-msg', role: 'alert' }));
    var basics = [
      el('legend', { text: 'Profile' }),
      isChar ? field('f-display', 'Name shown on the page', d.display_name, { max: 60, ph: row.name }) : field('f-display', 'Display name', row.display_name, { max: 60, ph: me.username }),
      field('f-tagline', 'Tagline', row.tagline, { max: 120 }),
      el('div', { class: 'row' }, [field('f-mood', 'Mood', row.mood, { max: 40 }), field('f-status', 'Status', row.status, { max: 140 })]),
      el('div', { class: 'os-picedit' }, [
        el('div', { id: 'pic-preview' }, [pic(row.pic_url, 'Current picture')]),
        el('div', {}, [
          el('label', { for: 'f-upload', text: 'Upload a picture' }),
          el('input', { id: 'f-upload', type: 'file', accept: 'image/*' }),
          el('p', { class: 'os-hint', text: 'JPG, PNG, WebP, or GIF. Big pictures are shrunk to fit. Animated GIFs stay animated (3 MB max).' }),
          field('f-pic', 'Or paste a picture web address (starts with https://)', row.pic_url, { max: 500, type: 'url', ph: 'https://' }),
          el('button', { class: 'os-btn', type: 'button', id: 'pic-clear', text: 'Remove Picture' })
        ])
      ]),
      el('p', { class: 'os-hint', text: 'Use a picture you made or have the right to share.' }),
      field('f-about', isChar ? 'About this character' : 'About me', row.about, { long: true }),
      field('f-meet', 'Who I’d like to meet', isChar ? d.who_to_meet : row.who_to_meet, { long: true, max: 2000 })
    ];
    form.appendChild(el('fieldset', {}, basics));
    function showPic(u) { var pv = $('pic-preview'); pv.textContent = ''; pv.appendChild(pic(u, 'Current picture')); }
    form.querySelector('#f-upload').addEventListener('change', async function (ev) {
      var fl = ev.target.files && ev.target.files[0];
      if (!fl) return;
      say('edit-msg', 'Uploading your picture...');
      try {
        var u = await uploadPic(fl, isChar ? 'char-' + cid : 'me', 800);
        $('f-pic').value = u; showPic(u);
        say('edit-msg', 'Picture uploaded. Press Save Page to keep it.');
      } catch (e) { say('edit-msg', oops(e), true); }
      ev.target.value = '';
    });
    form.querySelector('#f-pic').addEventListener('change', function () { showPic(val('f-pic')); });
    form.querySelector('#pic-clear').addEventListener('click', function () { $('f-pic').value = ''; showPic(''); });
    if (isChar) {
      var DET = [['heritage', 'Heritage'], ['past_life', 'Past Life'], ['party', 'Party'], ['rank', 'Rank'], ['location', 'Location'], ['age', 'Age'], ['birthday', 'Birthday'], ['star_sign', 'Star Sign'],
        ['height', 'Height'], ['hair', 'Hair'], ['eyes', 'Eyes'], ['relationship', 'Relationship'], ['likes', 'Likes'], ['dislikes', 'Dislikes'], ['fav_food', 'Favorite Food'], ['fear', 'Fear']];
      var grid = el('div', { class: 'row' });
      DET.forEach(function (x) { grid.appendChild(field('d-' + x[0], x[1], d[x[0]], { max: 80 })); });
      form.appendChild(el('fieldset', {}, [el('legend', { text: 'Details' }), grid, field('d-inventory', 'Inventory', d.inventory, { long: true, max: 2000 })]));
      var vs = el('select', { id: 'f-vis' }, [el('option', { value: 'private', text: 'Only me (and the Storyteller)' }), el('option', { value: 'friends', text: 'My friends' }), el('option', { value: 'public', text: 'Everyone' })]);
      vs.value = vis || 'private';
      form.appendChild(el('fieldset', {}, [el('legend', { text: 'Character Sheet' }), el('label', { for: 'f-vis', text: 'Who can see this character’s stats' }), vs]));
    } else {
      var ig = el('div', { class: 'row' });
      [['general', 'General'], ['music', 'Music'], ['heroes', 'Heroes'], ['games', 'Games'], ['groups', 'Groups']].forEach(function (x) { ig.appendChild(field('i-' + x[0], x[1], it[x[0]], { max: 300 })); });
      form.appendChild(el('fieldset', {}, [el('legend', { text: 'Interests' }), ig]));
    }

    // Top 8: players can hold friends and characters; characters hold characters
    var options = [];
    if (!isChar) fids.forEach(function (id) { if (fp[id]) options.push(['p:' + id, fp[id].username + ' (friend)']); });
    mineChars.forEach(function (c) { if (c.id !== cid) options.push(['c:' + c.id, c.name + ' (your character)']); });
    friendChars.forEach(function (c) { options.push(['c:' + c.id, c.name + ' (' + ((fp[c.owner] || {}).username || 'friend') + '’s character)']); });
    var cur = (row.top8 || []).map(function (e) { return e.t + ':' + e.id; });
    var t8 = el('div', { class: 'row' });
    for (var i = 0; i < 8; i++) {
      var sel = el('select', { id: 't8-' + i }, [el('option', { value: '', text: '(empty)' })]);
      options.forEach(function (o) { sel.appendChild(el('option', { value: o[0], text: o[1] })); });
      if (cur[i] && options.some(function (o) { return o[0] === cur[i]; })) sel.value = cur[i];
      t8.appendChild(el('div', {}, [el('label', { for: 't8-' + i, text: 'Spot ' + (i + 1) }), sel]));
    }
    form.appendChild(el('fieldset', {}, [el('legend', { text: 'Top 8' }), el('p', { class: 'os-hint', text: isChar ? 'Characters from this one’s story: yours and your friends’.' : 'Your friends and characters. Add friends first to see them here.' }), t8]));

    // Profile song
    var song = cleanSong(theme.song);
    var songSel = el('select', { id: 'f-song' });
    var songMsg = el('p', { class: 'os-hint', id: 'song-msg' });
    var songUp = el('input', { type: 'file', id: 'f-song-up', accept: 'audio/*' });
    var myUploads = [];
    async function fillSongs() {
      var M = window.TerranaMusic, lib = M ? await M.library() : { moods: [], tracks: [] };
      var up = await db.storage.from(SONG_BUCKET).list(me.id, { limit: 20, sortBy: { column: 'created_at', order: 'desc' } });
      myUploads = (up.data || []).filter(function (f) { return f.name && f.name !== '.emptyFolderPlaceholder'; }).map(function (f) {
        return { url: songBase() + me.id + '/' + f.name, title: f.name.replace(/^\d+-/, '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') };
      });
      songSel.textContent = '';
      songSel.appendChild(el('option', { value: '', text: 'No song' }));
      if (myUploads.length) {
        var og = el('optgroup', { label: 'My uploads' });
        myUploads.forEach(function (u, i) { og.appendChild(el('option', { value: 'u:' + i, text: u.title })); });
        songSel.appendChild(og);
      }
      if (M) { await M.refreshUploads(); M.uploads().forEach(function (g) {
        if (g.name === me.username) return;
        var og3 = el('optgroup', { label: g.name + '’s uploads' });
        g.tracks.forEach(function (id) { var t = M.track(id); if (t) og3.appendChild(el('option', { value: 'o:' + id, text: t.title })); });
        songSel.appendChild(og3);
      }); }
      lib.moods.filter(function (m) { return !m.user; }).forEach(function (m) {
        var og2 = el('optgroup', { label: m.name });
        m.tracks.forEach(function (id) { var t = lib.byId[id]; og2.appendChild(el('option', { value: 'l:' + id + ':' + m.id, text: t.title })); });
        songSel.appendChild(og2);
      });
      if (song && song.lib) { var o = songSel.querySelector('option[value^="l:' + song.lib + ':"]'); if (o) songSel.value = o.value; }
      else if (song && song.url) {
        var k = myUploads.findIndex(function (u) { return u.url === song.url; });
        if (k >= 0) songSel.value = 'u:' + k;
        else { var other = Array.prototype.filter.call(songSel.options, function (o) { var t = o.value.indexOf('o:') === 0 && M.track(o.value.slice(2)); return t && t.url === song.url; })[0]; songSel.value = other ? other.value : ''; }
      }
    }
    function readSong() {
      var v = songSel.value;
      if (v.indexOf('l:') === 0) return { lib: v.split(':')[1] };
      if (v.indexOf('u:') === 0) { var u = myUploads[+v.slice(2)]; return u ? { url: u.url, title: u.title } : null; }
      if (v.indexOf('o:') === 0) { var ot = window.TerranaMusic && window.TerranaMusic.track(v.slice(2)); return ot ? { url: ot.url, title: ot.title } : null; }
      return null;
    }
    songUp.addEventListener('change', async function () {
      var fl = songUp.files[0]; if (!fl) return;
      if (fl.size > 10 * 1024 * 1024) { say('song-msg', 'That file is over 10 MB. Try a shorter song or a smaller file.', true); return; }
      if (!/^audio\//.test(fl.type)) { say('song-msg', 'That is not a music file this site can play.', true); return; }
      say('song-msg', 'Uploading...');
      var safe = fl.name.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-60);
      var r = await db.storage.from(SONG_BUCKET).upload(me.id + '/' + Date.now() + '-' + safe, fl, { contentType: fl.type, upsert: false });
      if (r.error) { say('song-msg', /policy|row-level/i.test(r.error.message || '') ? 'You can keep 5 songs. Delete one first.' : oops(r.error), true); return; }
      song = { url: songBase() + r.data.path, title: safe.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ') };
      await fillSongs();
      say('song-msg', 'Uploaded. Save Page to make it your song.');
      songUp.value = '';
    });
    var songPrev = el('button', { class: 'os-btn', type: 'button', text: 'Listen', onclick: function () {
      var M = window.TerranaMusic, sg = readSong(); if (!M || !sg) return;
      M.unlock(); M.setRepeat('one'); if (sg.lib) M.play(sg.lib); else M.playUrl(sg.url, sg.title);
    } });
    var songAuto = el('input', { type: 'checkbox', id: 'f-song-auto' }); songAuto.checked = theme.songAuto !== false;
    var songStop = el('button', { class: 'os-btn', type: 'button', text: 'Stop', onclick: function () { if (window.TerranaMusic) window.TerranaMusic.stop(); } });
    var songDel = el('button', { class: 'os-btn danger', type: 'button', text: 'Delete Upload', onclick: async function () {
      var v = songSel.value; if (v.indexOf('u:') !== 0) { say('song-msg', 'Pick one of your uploads first.', true); return; }
      var u = myUploads[+v.slice(2)]; if (!u || !confirm('Delete "' + u.title + '" for good?')) return;
      var r = await db.storage.from(SONG_BUCKET).remove([u.url.slice(songBase().length)]);
      if (r.error) { say('song-msg', oops(r.error), true); return; }
      if (song && song.url === u.url) song = null;
      await fillSongs(); say('song-msg', 'Deleted. Save Page if it was your song.');
    } });
    fillSongs().catch(function () {});
    form.appendChild(el('fieldset', {}, [el('legend', { text: 'Profile Song' }),
      el('p', { class: 'os-hint', text: 'Plays when people visit this page. Pick from the site’s music, from other players’ uploads, or upload your own (up to 5 songs, 10 MB each). Your uploads show up for everyone under your username, in every music player on the site. Only upload music you have the right to share.' }),
      el('div', {}, [el('label', { for: 'f-song', text: 'Song' }), songSel]),
      el('label', { class: 'os-chk' }, [songAuto, ' Play it automatically when people visit (visitors can still pause or mute it)']),
      el('div', {}, [songPrev, songStop, songDel]),
      el('div', {}, [el('label', { for: 'f-song-up', text: 'Upload a song' }), songUp]), songMsg]));

    // Colors
    var pr = el('select', { id: 'th-preset' });
    Object.keys(THEMES).forEach(function (k) { pr.appendChild(el('option', { value: k, text: THEMES[k].label })); });
    pr.value = THEMES[theme.preset] ? theme.preset : 'classic';
    var fo = el('select', { id: 'th-font' });
    Object.keys(FONTS).forEach(function (k) { fo.appendChild(el('option', { value: k, text: FONTS[k][0] })); });
    fo.value = FONTS[theme.font] ? theme.font : 'verdana';
    var pa = el('select', { id: 'th-pattern' }, [el('option', { value: 'none', text: 'None' })]);
    var pc = el('select', { id: 'th-patcolor' });
    Object.keys(PAT_COLORS).forEach(function (k) { pc.appendChild(el('option', { value: k, text: PAT_COLORS[k] })); });
    pc.value = PAT_COLORS[theme.patColor] ? theme.patColor : 'accent';
    var ps = el('input', { id: 'th-patstrength', type: 'range', min: '4', max: '60', value: String(Math.round((+theme.patStrength || 0.2) * 100)) });
    var patWant = patOf(theme);
    patLib().then(function () {
      var g1 = el('optgroup', { label: 'Patterns (tinted to your theme)' }), g2 = el('optgroup', { label: 'Retro desktop tiles (tinted)' }), g3 = el('optgroup', { label: 'Retro desktop tiles (original colors)' });
      Object.keys(PAT.hero).sort().forEach(function (k) { g1.appendChild(el('option', { value: 'h:' + k, text: heroName(k) })); });
      PAT.retro.forEach(function (r) { (r.tint ? g2 : g3).appendChild(el('option', { value: 'r:' + r.id, text: r.name })); });
      pa.appendChild(g1); pa.appendChild(g2); pa.appendChild(g3);
      pa.value = patWant;
    });
    [pc, ps].forEach(function (x) { x.addEventListener('input', function () { applyTheme(readTheme()); }); });
    var colors = el('div', { class: 'colors' });
    var colorVals = themeColors(theme);
    COLOR_KEYS.forEach(function (k) { colors.appendChild(el('label', {}, [el('input', { type: 'color', id: 'th-' + k[0], value: colorVals[k[0]] }), k[1]])); });
    // Background picture
    var bgU = el('input', { id: 'bg-url', type: 'url', placeholder: 'https://...', value: bgUrl((theme.bgImage || {}).url) });
    var bgM = el('select', { id: 'bg-mode' });
    Object.keys(BG_MODES).forEach(function (k) { bgM.appendChild(el('option', { value: k, text: BG_MODES[k] })); });
    bgM.value = BG_MODES[(theme.bgImage || {}).mode] ? theme.bgImage.mode : 'tile';
    var bgF = el('input', { id: 'bg-up', type: 'file', accept: 'image/*' });
    var bgMsg = el('p', { class: 'os-hint', id: 'bg-msg' });
    bgF.addEventListener('change', async function () {
      var fl = bgF.files[0]; if (!fl) return;
      say('bg-msg', 'Uploading...');
      try { bgU.value = await uploadPic(fl, 'bg', 1920); say('bg-msg', 'Uploaded. Save Page to keep it.'); applyTheme(readTheme()); }
      catch (e) { say('bg-msg', oops(e), true); }
      bgF.value = '';
    });
    bgU.addEventListener('change', function () { applyTheme(readTheme()); });
    bgM.addEventListener('change', function () { applyTheme(readTheme()); });
    var bgX = el('button', { class: 'os-btn', type: 'button', text: 'Remove Picture', onclick: function () { bgU.value = ''; applyTheme(readTheme()); } });

    // Layout code
    var css = el('textarea', { id: 'th-css', class: 'os-code', rows: '12', spellcheck: 'false', maxlength: String(CSS_MAX), placeholder: '/* Your own layout code (CSS). Try:\n.os-box > h2 { background: hotpink; }\n.os-name { font-size: 40px; text-shadow: 0 0 8px gold; } */' });
    css.value = theme.css || '';
    var cssT = 0; css.addEventListener('input', function () { clearTimeout(cssT); cssT = setTimeout(function () { applyTheme(readTheme()); }, 300); });
    var SNIPS = [
      ['Rounded boxes', '.os-box { border-radius: 14px; overflow: hidden; }'],
      ['Glowing name', '.os-name { text-shadow: 0 0 6px var(--os-accent), 0 0 14px var(--os-accent); }'],
      ['Rainbow headers', '.os-box > h2 { background: linear-gradient(90deg, red, orange, gold, lime, deepskyblue, violet); color: #fff; text-shadow: 1px 1px 0 #000; }'],
      ['See-through boxes', '.os-box { background: rgba(0, 0, 0, 0.45); } .os-box .in { background: transparent; }'],
      ['Dashed borders', '.os-box { border: 3px dashed var(--os-accent); }'],
      ['Big profile picture', '.os-pic { width: 100%; max-width: 260px; }'],
      ['Spinning picture', '@keyframes spin { to { transform: rotate(360deg); } } .os-pic { animation: spin 8s linear infinite; }'],
      ['Blinking status', '@keyframes blink { 50% { opacity: 0.2; } } .os-tag { animation: blink 1.2s steps(2) infinite; }'],
      ['Sparkle cursor', 'body { cursor: crosshair; }'],
      ['Hide my blog', '.os-blog { display: none; }']
    ];
    var snipRow = el('div', { class: 'os-snips' }, SNIPS.map(function (sn) { return el('button', { class: 'os-btn', type: 'button', text: '+ ' + sn[0], onclick: function () { css.value = (css.value ? css.value.replace(/\s*$/, '\n') : '') + sn[1] + '\n'; applyTheme(readTheme()); } }); }));

    // Share and copy layouts
    var codeBox = el('textarea', { id: 'th-share', class: 'os-code', rows: '3', spellcheck: 'false', placeholder: 'Paste a layout code here (it starts with OURSPACE:) and press Use Code' });
    var codeMsg = el('p', { class: 'os-hint', id: 'code-msg' });
    function loadTheme(t2) {
      if (!t2) return false;
      if (THEMES[t2.preset]) pr.value = t2.preset;
      fo.value = FONTS[t2.font] ? t2.font : 'verdana';
      patWant = patOf(t2); pa.value = patWant; pc.value = PAT_COLORS[t2.patColor] ? t2.patColor : 'accent'; ps.value = String(Math.round((+t2.patStrength || 0.2) * 100));
      var cv = themeColors(t2); COLOR_KEYS.forEach(function (k) { form.querySelector('#th-' + k[0]).value = cv[k[0]]; });
      bgU.value = bgUrl((t2.bgImage || {}).url); bgM.value = BG_MODES[(t2.bgImage || {}).mode] ? t2.bgImage.mode : 'tile';
      css.value = typeof t2.css === 'string' ? t2.css.slice(0, CSS_MAX) : '';
      applyTheme(readTheme());
      return true;
    }

    function readTheme() {
      var t = { preset: pr.value, font: fo.value, pattern: pa.value || patWant, colors: {}, patColor: pc.value, patStrength: (+ps.value || 20) / 100 };
      var bu = bgUrl(bgU.value.trim()); if (bu) t.bgImage = { url: bu, mode: bgM.value };
      if (css.value.trim()) t.css = css.value.slice(0, CSS_MAX);
      var sgx = readSong(); if (sgx) t.song = sgx;
      if (!songAuto.checked) t.songAuto = false;
      var base = THEMES[pr.value];
      COLOR_KEYS.forEach(function (k) { var v = $('th-' + k[0]).value.toLowerCase(); if (v !== base[k[0]].toLowerCase()) t.colors[k[0]] = v; });
      return t;
    }
    pr.addEventListener('change', function () { var b = THEMES[pr.value]; COLOR_KEYS.forEach(function (k) { $('th-' + k[0]).value = b[k[0]]; }); patWant = PAT_DEFAULT[pr.value] || 'none'; pa.value = patWant; applyTheme(readTheme()); });
    pa.addEventListener('change', function () { patWant = pa.value; });
    [fo, pa].forEach(function (x) { x.addEventListener('change', function () { applyTheme(readTheme()); }); });
    colors.addEventListener('input', function () { applyTheme(readTheme()); });
    form.appendChild(el('fieldset', {}, [el('legend', { text: 'Page Look' }), el('div', { class: 'row' }, [
      el('div', {}, [el('label', { for: 'th-preset', text: 'Theme' }), pr]), el('div', {}, [el('label', { for: 'th-font', text: 'Font' }), fo])]),
      el('div', {}, [el('label', { for: 'th-pattern', text: 'Background pattern' }), pa]),
      el('div', { class: 'row' }, [el('div', {}, [el('label', { for: 'th-patcolor', text: 'Pattern color' }), pc]), el('div', {}, [el('label', { for: 'th-patstrength', text: 'Pattern strength' }), ps])]),
      el('p', { class: 'os-hint', text: 'Each theme comes with a matching pattern. Patterns: Hero Patterns by Steve Schoger (CC BY 4.0). Retro tiles: classic-wallpaper by Peter O. (Unlicense) and Background-Textures by John Galiszewski (MIT).' }),
      el('p', { class: 'os-hint', text: 'Change any color. The page shows it as you go.' }), colors]));
    form.appendChild(el('fieldset', {}, [el('legend', { text: 'Background Picture' }),
      el('p', { class: 'os-hint', text: 'Your own picture behind the page. It replaces the theme’s background and pattern and leaves the rest of the theme alone. Animated GIFs work (up to 3 MB).' }),
      el('div', {}, [el('label', { for: 'bg-up', text: 'Upload a picture' }), bgF]),
      el('div', {}, [el('label', { for: 'bg-url', text: 'Or a picture address' }), bgU]),
      el('div', {}, [el('label', { for: 'bg-mode', text: 'How it shows' }), bgM]), el('div', {}, [bgX]), bgMsg]));
    form.appendChild(el('fieldset', {}, [el('legend', { text: 'Layout Code (CSS)' }),
      el('p', { class: 'os-hint', text: 'Go all out, like the old days. Write your own CSS to restyle anything on your page: boxes, headers, fonts, pictures, animations. It only affects your own page (scripts are not allowed), and the page updates as you type.' }),
      snipRow, css,
      el('p', { class: 'os-hint', text: 'Handy names: .os-box (every box), .os-box > h2 (box headers), .os-name (your name), .os-pic (your picture), .os-tag (your quote), .os-table (info tables), .os-post (blog posts), .os-blog, .os-songbox, .os-top8box. Colors: var(--os-bg), var(--os-text), var(--os-link), var(--os-head), var(--os-accent).' })]));
    form.appendChild(el('fieldset', {}, [el('legend', { text: 'Share a Layout' }),
      el('p', { class: 'os-hint', text: 'Copy your layout code to give your whole look to a friend, or paste one to use theirs. You can also press Use This Layout on anyone’s page.' }),
      el('div', {}, [el('button', { class: 'os-btn', type: 'button', text: 'Copy My Layout Code', onclick: function () {
        var code = themeCode(Object.assign(readTheme(), { song: undefined })); codeBox.value = code;
        if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { say('code-msg', 'Copied! Send it to anyone.'); }, function () { say('code-msg', 'Select the code and copy it.'); });
      } }), el('button', { class: 'os-btn go', type: 'button', text: 'Use Code', onclick: function () {
        if (loadTheme(readThemeCode(codeBox.value))) say('code-msg', 'Layout loaded. Save Page to keep it.'); else say('code-msg', 'That is not a layout code.', true);
      } })]), codeBox, codeMsg]));
    var pend = null; try { pend = localStorage.getItem('os-borrow'); localStorage.removeItem('os-borrow'); } catch (e) {}

    form.appendChild(el('div', {}, [el('button', { class: 'os-btn go', type: 'submit', text: 'Save Page' }),
      el('a', { class: 'os-btn', href: isChar ? cLink(cid) : uLink(me.username), text: 'View Page' })]));
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var picUrl = val('f-pic');
      if (picUrl && !/^https:\/\//.test(picUrl)) { say('edit-msg', 'The picture address has to start with https://', true); return; }
      var top = [], seen = {};
      for (var j = 0; j < 8; j++) { var v = $('t8-' + j).value; if (v && !seen[v]) { seen[v] = 1; top.push({ t: v.charAt(0), id: v.slice(2) }); } }
      var upd = { tagline: val('f-tagline'), mood: val('f-mood'), status: val('f-status'), pic_url: picUrl, about: val('f-about'), top8: top, theme: readTheme() };
      try {
        if (isChar) {
          var nd = { display_name: val('f-display'), who_to_meet: val('f-meet'), inventory: val('d-inventory') };
          DET.forEach(function (x) { nd[x[0]] = val('d-' + x[0]); });
          upd.details = nd;
          await must(db.from('character_pages').update(upd).eq('id', cid));
          await must(db.from('characters').update({ sheet_visibility: $('f-vis').value }).eq('id', cid));
        } else {
          upd.display_name = val('f-display'); upd.who_to_meet = val('f-meet');
          upd.interests = {}; ['general', 'music', 'heroes', 'games', 'groups'].forEach(function (x) { upd.interests[x] = val('i-' + x); });
          var exists = await db.from('player_pages').select('id').eq('id', me.id).maybeSingle();
          if (exists.data) await must(db.from('player_pages').update(upd).eq('id', me.id));
          else { upd.id = me.id; await must(db.from('player_pages').insert(upd)); }
        }
        say('edit-msg', 'Saved!');
        window.scrollTo(0, 0);
      } catch (e) { say('edit-msg', oops(e), true); window.scrollTo(0, 0); }
    });
    main.appendChild(el('section', { class: 'os-box' }, [el('div', { class: 'in' }, [form])]));
    if (pend && loadTheme(readThemeCode(pend))) say('edit-msg', 'Layout borrowed! Look it over, change anything, then Save Page.');
    if (!isChar && mineChars.length) {
      var l = el('ul', { class: 'os-list' });
      mineChars.forEach(function (c) { l.appendChild(el('li', {}, [c.name, el('a', { class: 'os-btn', href: 'edit.html?c=' + encodeURIComponent(c.id), text: 'Edit ' + c.name + '’s Page' })])); });
      main.appendChild(el('div', { style: 'height:12px' }));
      main.appendChild(box('Your Characters’ Pages', [l]));
    }
  }

  // ---------- Mail ----------
  async function mailPage(main) {
    if (!me) { main.appendChild(box('Log in first', [el('a', { class: 'os-btn go', href: '../account/index.html?next=ourspace/messages.html', text: 'Log In' })])); return; }
    var pg = await must(db.from('player_pages').select('theme').eq('id', me.id).maybeSingle());
    applyTheme(pg && pg.theme);
    var fids = await friendIds(me.id), fp = await profilesById(fids);
    var myChars = await must(db.from('character_pages').select('id, name').eq('owner', me.id).order('name', { ascending: true }));
    var inbox = await must(db.from('messages').select('*').eq('recipient', me.id).eq('hidden_by_recipient', false).order('created_at', { ascending: false }).limit(100));
    var sent = await must(db.from('messages').select('*').eq('sender', me.id).eq('hidden_by_sender', false).order('created_at', { ascending: false }).limit(100));
    var all = inbox.concat(sent);
    var people = await profilesById(all.map(function (m) { return m.sender; }).concat(all.map(function (m) { return m.recipient; })));
    var cps = await charPages(all.map(function (m) { return m.sender_character; }).concat(all.map(function (m) { return m.recipient_character; })));
    function who(pid, cid) {
      var p = people[pid] ? people[pid].username : 'someone';
      return cid && cps[cid] ? cps[cid].name + ' (' + p + ')' : p;
    }

    var left = el('div', { class: 'os-col' }), right = el('div', { class: 'os-col' });
    main.appendChild(el('div', { class: 'os-cols' }, [left, right]));

    // Write
    var to = el('select', { id: 'm-to' }, [el('option', { value: '', text: fids.length ? 'Choose a friend' : 'Add friends first' })]);
    fids.forEach(function (id) { if (fp[id]) to.appendChild(el('option', { value: id, text: fp[id].username })); });
    var toc = el('select', { id: 'm-toc' }, [el('option', { value: '', text: 'The player' })]);
    var from = el('select', { id: 'm-from' }, [el('option', { value: '', text: 'Me (' + me.username + ')' })]);
    myChars.forEach(function (c) { from.appendChild(el('option', { value: c.id, text: c.name })); });
    async function loadTargets(keep) {
      toc.textContent = '';
      toc.appendChild(el('option', { value: '', text: 'The player' }));
      if (!to.value) return;
      var cs = await must(db.from('character_pages').select('id, name').eq('owner', to.value).order('name', { ascending: true }));
      cs.forEach(function (c) { toc.appendChild(el('option', { value: c.id, text: c.name })); });
      if (keep) toc.value = keep;
    }
    to.addEventListener('change', function () { loadTargets(); });
    var form = el('form', { class: 'os-form', id: 'm-form' }, [
      el('div', { class: 'row' }, [el('div', {}, [el('label', { for: 'm-to', text: 'To' }), to]), el('div', {}, [el('label', { for: 'm-toc', text: 'Send it to' }), toc])]),
      el('div', {}, [el('label', { for: 'm-from', text: 'Send it as' }), from]),
      field('m-subject', 'Subject', '', { max: 120 }),
      field('m-body', 'Message', '', { long: true, max: 5000 }),
      el('div', {}, [el('button', { class: 'os-btn go', type: 'submit', text: 'Send' })]),
      el('p', { class: 'os-msg', id: 'm-msg', role: 'alert' })
    ]);
    form.addEventListener('submit', async function (ev) {
      ev.preventDefault();
      if (!to.value) { say('m-msg', 'Choose who to send it to.', true); return; }
      if (!val('m-body')) { say('m-msg', 'Write a message first.', true); return; }
      try {
        await must(db.from('messages').insert({ sender: me.id, recipient: to.value, sender_character: from.value || null, recipient_character: toc.value || null, subject: val('m-subject'), body: val('m-body') }));
        location.href = 'messages.html?sent=1';
      } catch (e) { say('m-msg', oops(e), true); }
    });
    left.appendChild(box('Write a Message', [form], 'orange'));
    left.appendChild(box('About Mail', [el('p', { class: 'os-hint', text: 'You can message friends, as yourself or as one of your characters, to them or to one of their characters. Hidden messages stay hidden for you only.' })]));

    function mailBox(title, rows, incoming) {
      if (!rows.length) return box(title, [el('p', { class: 'os-hint', text: incoming ? 'No messages yet.' : 'Nothing sent yet.' })]);
      var t = el('table', { class: 'os-mail' }, [el('tr', {}, [el('th', { text: incoming ? 'From' : 'To' }), el('th', { text: 'Subject' }), el('th', { text: 'Date' })])]);
      rows.forEach(function (m) {
        var tr = el('tr', { class: 'open' + (incoming && !m.read_at ? ' unread' : ''), tabindex: '0' }, [
          el('td', { text: (incoming ? '' : 'To ') + (incoming ? who(m.sender, m.sender_character) : who(m.recipient, m.recipient_character)) + (m.recipient_character && incoming && cps[m.recipient_character] ? ', to ' + cps[m.recipient_character].name : '') }),
          el('td', { text: m.subject || '(no subject)' }),
          el('td', { text: day(m.created_at) })
        ]);
        var openRow = null;
        function open() {
          if (openRow) { openRow.remove(); openRow = null; return; }
          var acts = el('div', {}, []);
          if (incoming && fp[m.sender]) acts.appendChild(el('a', { class: 'os-btn go', href: 'messages.html?to=' + encodeURIComponent(people[m.sender].username) + (m.sender_character ? '&tc=' + encodeURIComponent(m.sender_character) : '') + (m.recipient_character ? '&as=' + encodeURIComponent(m.recipient_character) : '') + '&re=' + encodeURIComponent(m.subject || ''), text: 'Reply' }));
          acts.appendChild(el('button', { class: 'os-btn', type: 'button', text: 'Hide', onclick: async function () {
            try { await must(db.from('messages').update(incoming ? { hidden_by_recipient: true } : { hidden_by_sender: true }).eq('id', m.id)); tr.remove(); if (openRow) openRow.remove(); } catch (e) { alert(oops(e)); }
          } }));
          openRow = el('tr', {}, [el('td', { colspan: '3' }, [el('div', { class: 'os-hint', text: when(m.created_at) }), el('div', { class: 'os-letter', text: m.body }), acts])]);
          tr.after(openRow);
          if (incoming && !m.read_at) {
            m.read_at = new Date().toISOString();
            tr.classList.remove('unread');
            db.from('messages').update({ read_at: m.read_at }).eq('id', m.id).then(function () {});
          }
        }
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        t.appendChild(tr);
      });
      return box(title, [t]);
    }
    right.appendChild(mailBox('Inbox', inbox, true));
    right.appendChild(mailBox('Sent', sent, false));

    if (qs.get('sent')) say('m-msg', 'Message sent!');
    var tn = qs.get('to');
    if (tn) {
      var hit = fids.filter(function (id) { return fp[id] && fp[id].username.toLowerCase() === tn.toLowerCase(); })[0];
      if (hit) { to.value = hit; await loadTargets(qs.get('tc')); }
      else say('m-msg', 'You can only message friends. Add ' + tn + ' as a friend first.', true);
    }
    if (qs.get('as') && myChars.some(function (c) { return c.id === qs.get('as'); })) from.value = qs.get('as');
    if (qs.get('re')) $('m-subject').value = /^re: /i.test(qs.get('re')) ? qs.get('re') : 'Re: ' + qs.get('re');
  }

  // ---------- start ----------
  var PAGES = { home: home, user: userPage, char: charPage, edit: editPage, mail: mailPage };
  A.currentPlayer().then(async function (p) {
    me = p;
    await shell();
    var main = $('os-main');
    main.textContent = '';
    try { await PAGES[page](main); }
    catch (e) { main.appendChild(box('Something went wrong', [el('p', { text: oops(e) }), el('p', { class: 'os-hint', text: 'If this keeps happening, OurSpace may not be set up on the server yet.' })])); }
  }).catch(function () {
    $('os-main').textContent = 'Could not reach the server. Try refreshing the page.';
  });
})();
