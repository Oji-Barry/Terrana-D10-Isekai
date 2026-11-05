"""Add ?v=<content hash> to every script, stylesheet, and data.json reference,
so browsers load the new file as soon as it changes instead of a cached copy.
Run before every push: python3 tools/stamp_assets.py
"""
import glob, hashlib, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)


def h(path):
    return hashlib.sha1(open(path, 'rb').read()).hexdigest()[:8]


def sub(path, pattern, version):
    s = open(path, encoding='utf-8').read()
    n = re.sub(pattern, lambda m: m.group(1) + '?v=' + version, s)
    if n != s:
        open(path, 'w', encoding='utf-8').write(n)


V = r'(?:\?v=[0-9a-f]{8})?'
# 1. files that other scripts load, in dependency order
data = h('forge/data.json')
sub('assets/forge.js', r"(fetch\('data\.json)" + V, data)
sub('characters/sheet.html', r"(fetch\('\.\./forge/data\.json)" + V, data)
for js in ('assets/charview.js', 'assets/combat.js'):
    sub(js, r"('\.\./forge/data\.json)" + V, data)
forge = h('assets/forge.js')
for js in ('assets/charview.js', 'assets/combat.js'):
    sub(js, r"('\.\./assets/forge\.js)" + V, forge)
sub('assets/combat.js', r"(fetch\('bestiary\.json)" + V, h('combat/bestiary.json'))
sub('assets/site.js', r"(root \+ 'assets/auth\.js)" + V, h('assets/auth.js'))

# 2. every page
vers = {os.path.basename(p): h(p) for p in glob.glob('assets/*.js') + glob.glob('assets/*.css')}
pages = [p for p in glob.glob('**/*.html', recursive=True) if not p.startswith(('tools/', 'node_modules/'))]
for page in pages:
    s = open(page, encoding='utf-8').read()
    n = re.sub(r'((?:\.\./)*assets/([a-z_-]+\.(?:js|css)))' + V + r'"',
               lambda m: m.group(1) + ('?v=' + vers[m.group(2)] if m.group(2) in vers else '') + '"', s)
    if n != s:
        open(page, 'w', encoding='utf-8').write(n)
print('stamped', len(pages), 'pages')
