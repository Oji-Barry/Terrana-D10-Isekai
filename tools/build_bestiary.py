"""Chapter 15 Bestiary -> combat/bestiary.json for the combat room's NPC picker.
Run after build_rulebook.py: python3 tools/build_bestiary.py"""
import html, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'rulebook', 'ch15.html'), encoding='utf-8').read()
body = src[src.find('<h2'):]


def text(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()


out, section = [], ''
for m in re.finditer(r'<h2[^>]*>(.*?)</h2>|<div class="entry">(.*?)</div>\s*(?=<div class="entry">|<h2|<h3|</section|</main|$)', body, re.S):
    if m.group(1) is not None:
        section = text(m.group(1)); continue
    e = m.group(2)
    nm = re.search(r'class="entry-name" id="([^"]+)">(.*?)</div>', e)
    if not nm: continue
    c = {'id': nm.group(1), 'name': text(nm.group(2)), 'section': section}
    tags = re.search(r'<div class="stats tags">(.*?)</div>', e, re.S)
    if tags:
        t = [text(x) for x in re.findall(r'<span>(.*?)</span>', tags.group(1))]
        if t and t[0].startswith('Rank'): c['rank'] = t[0][5:].strip(); t = t[1:]
        c['tags'] = t
        if len(t) >= 3: c['type'], c['size'], c['elements'] = t[0], t[1], t[2]
    stats = ' | '.join(text(x) for x in re.findall(r'<div class="stats">(.*?)</div>', e, re.S))
    def num(label):
        mm = re.search(label + r'\s+(\d+)', stats)
        return int(mm.group(1)) if mm else None
    for k, lab in (('attack', 'Attack'), ('defense', 'Defense'), ('damage', 'Damage'), ('move', 'Move'), ('bdt', 'BDT'), ('mana', 'Mana'), ('mt', 'M/T')):
        v = num(lab)
        if v is not None: c[k] = v
    hm = re.search(r'Health\s+(\d+)\s*/\s*(\d+)\s*/\s*(\d+)', stats)
    if hm: c['health'] = {'b': int(hm.group(1)), 'l': int(hm.group(2)), 'a': int(hm.group(3))}
    c['abilities'] = []
    for p in re.findall(r'<p>(.*?)</p>', e, re.S):
        for part in re.split(r'(?=<strong>)', p):
            sm = re.match(r'<strong>(.*?)</strong>(.*)', part, re.S)
            if not sm: continue
            k, v = text(sm.group(1)).rstrip(':').strip(), text(sm.group(2))
            if k in ('Found', 'Loot', 'Trait'): c[k.lower()] = (c.get(k.lower(), '') + ' ' + v).strip()
            else: c['abilities'].append({'name': k, 'text': v})
    out.append(c)
json.dump(out, open(os.path.join(ROOT, 'combat', 'bestiary.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(out), 'creatures;', sum(1 for c in out if 'attack' not in c), 'without stats')
