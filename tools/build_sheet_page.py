"""Build characters/sheet.html from the Character Sheet HTML (tools/sheets/).
The page loads a character and fills the sheet from the snapshot the Forge
saves (sheet.view, keyed by the sheet's data-field names).
  python3 tools/build_sheet_page.py
"""
import re

SRC = 'tools/sheets/Character Sheet v9.7.html'
OUT = 'characters/sheet.html'

BAR_CSS = """
<style>
.sheet-bar { position:sticky; top:0; z-index:50; display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:center;
  padding:8px 16px; background:#14123a; color:#f2ecff; font-family:system-ui, sans-serif; font-size:14px; border-bottom:2px solid #f2c44f; }
.sheet-bar a, .sheet-bar button { color:#14123a; background:#f2c44f; border:0; border-radius:6px; padding:6px 12px; font:inherit; font-weight:600; text-decoration:none; cursor:pointer; }
.sheet-bar a.ghost { background:transparent; color:#f2ecff; border:1px solid #8f88d9; }
.sheet-bar .msg { flex-basis:100%; text-align:center; font-size:13px; color:#d9d3f7; }
.sheet-bar .msg:empty { display:none; }
@media print { .sheet-bar { display:none !important; } }
</style>
"""

BAR = """
<div class="sheet-bar" id="sheet-bar">
  <a class="ghost" href="index.html">My Characters</a>
  <a class="ghost" id="bar-forge" href="../forge/index.html">Edit in the Forge</a>
  <button type="button" onclick="window.print()">Print or Save as PDF</button>
  <p class="msg" id="bar-msg">Loading...</p>
</div>
"""

FILL = r"""
<script src="../vendor/supabase-2.118.0.js"></script>
<script src="../assets/auth.js"></script>
<script>
(function () {
  var msg = document.getElementById('bar-msg');
  function say(t) { msg.textContent = t || ''; }
  function fillDots(box, n) {
    var ds = box.querySelectorAll('.d');
    for (var i = 0; i < ds.length; i++) ds[i].classList.toggle('f', i < n);
  }
  function apply(view) {
    document.querySelectorAll('[data-field]').forEach(function (e) {
      var f = e.getAttribute('data-field');
      if (!(f in view)) return;
      var v = view[f];
      if (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA') { e.value = v; return; }
      if (e.classList.contains('cb')) { e.classList.toggle('chk', !!v); return; }
      if (e.classList.contains('vv-row')) {
        e.querySelectorAll('.vvd').forEach(function (d) {
          var p = Number(d.getAttribute('data-pos'));
          d.classList.remove('fv', 'fc');
          if (p === v && p <= 2) d.classList.add('fv');
          if (p === v && p >= 4) d.classList.add('fc');
        });
        return;
      }
      if (e.querySelector('.d')) fillDots(e, Number(v) || 0);
    });
  }
  var id = new URLSearchParams(location.search).get('id');
  if (!id) { say('No character picked. Open a sheet from My Characters.'); return; }
  document.getElementById('bar-forge').href = '../forge/index.html?id=' + encodeURIComponent(id);
  var A = window.Terrana && window.Terrana.auth;
  function loadScript(src) {
    return new Promise(function (ok, bad) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.body.appendChild(s); });
  }
  // Fill from the character's Forge choices with the current rules; fall back
  // to the snapshot the Forge saved if that can't load.
  async function liveView(c) {
    window.FORGE_HEADLESS = true;
    await loadScript('../assets/forge.js');
    var data = await fetch('../forge/data.json').then(function (r) { return r.json(); });
    var owner = await A.client.from('profiles').select('username').eq('id', c.owner).maybeSingle();
    return window.TerranaForgeView(data, c, { username: owner.data ? owner.data.username : '' });
  }
  A.client.from('characters').select('id, name, owner, sheet').eq('id', id).maybeSingle().then(async function (res) {
    if (res.error) { say(A.friendly(res.error)); return; }
    if (!res.data) { say('This sheet is private, or the character does not exist. Log in to see your own characters.'); return; }
    var c = res.data;
    document.title = c.name + ' | Character Sheet | Jimothy’s D10 Isekai JRPG';
    var view = null;
    if (c.sheet && c.sheet.build) { try { view = await liveView(c); } catch (e) { console.warn('sheet', e); } }
    view = view || (c.sheet && c.sheet.view) || null;
    if (!view) { say('Nothing to show yet. Make this character in the Forge first.'); return; }
    apply(view);
    say('Filled from the Forge. You can type on the sheet before printing, but changes here are not saved.');
  }).catch(function () { say('Could not reach the server. Try refreshing the page.'); });
})();
</script>
"""

s = open(SRC, encoding='utf-8').read()
s = re.sub(r'<title>.*?</title>', "<title>Character Sheet | Jimothy's D10 Isekai JRPG</title>", s, count=1, flags=re.S)
s = s.replace('</head>', '<meta name="viewport" content="width=device-width, initial-scale=1">\n<link rel="icon" href="../assets/icons/d10.svg" type="image/svg+xml">' + BAR_CSS + '</head>', 1)
s = re.sub(r'<body([^>]*)>', lambda m: '<body' + m.group(1) + '>' + BAR, s, count=1)
i = s.rfind('</body>')
s = s[:i] + FILL + s[i:]
open(OUT, 'w', encoding='utf-8').write(s)
print('wrote', OUT, len(s))
