"""Add per-rank choices to forge/data.json, read from the built rulebook pages:
Combat Style ranks (Default Ability, Option A, Option B) from ch12.html and
casting school / Battle Aura ranks (Default Ability, two spells) from ch13.html.

Run after build_rulebook.py and build_forge_data.py:
  python3 tools/build_forge_ranks.py
"""
import html
import json
import re


def clean(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()


def styles(page):
    out = {}
    # each style section: <section ... id="quickcut-style"> ... ranks
    for m in re.finditer(r'<h3 class="rank" id="([a-z0-9-]+)-rank-(\d)-[a-z0-9-]+"><span class="rank-num">Rank \d</span> ([^<]+)</h3>(.*?)(?=<h3 class="rank"|</section>)', page, re.S):
        base, rank, rname, body = m.group(1), int(m.group(2)), m.group(3).strip(), m.group(4)
        abil = re.findall(r'<div class="ability" id="([^"]+)"><div class="ability-head"><span class="ability-kind">([^<]+)</span><span class="ability-name">([^<]+)</span>(?:<span class="use">([^<]+)</span>)?</div><p>(.*?)</p>', body, re.S)
        kinds = {k: {'name': clean(n), 'id': i, 'use': u, 'text': clean(t)} for i, k, n, u, t in abil}
        assert set(kinds) >= {'Default Ability', 'Option A', 'Option B'}, (base, rank, list(kinds))
        out.setdefault(base, []).append({'rank': rank, 'title': rname, 'id': '%s-rank-%d-%s' % (base, rank, re.sub(r'[^a-z0-9]+', '-', rname.lower())),
                                         'default': kinds['Default Ability'], 'a': kinds['Option A'], 'b': kinds['Option B']})
    return out


def schools(page):
    out = {}
    for m in re.finditer(r'<h3 class="rank" id="([a-z0-9-]+)-rank-(\d)-([a-z0-9-]+)"><span class="rank-num">Rank \d</span> ([^<]+)</h3>(.*?)(?=<h3 class="rank"|<section|</section>)', page, re.S):
        base, rank, rid, rname, body = m.group(1), int(m.group(2)), m.group(3), m.group(4).strip(), m.group(5)
        d = re.search(r'<p><strong>Default Ability: ([^<]+)</strong>(?:<em>([^<]*)</em>)?(.*?)</p>', body, re.S)
        spells = []
        for sm in re.finditer(r'<div class="entry"><div class="entry-name" id="([^"]+)">([^<]+)</div>(.*?)</div>', body, re.S):
            tag = re.search(r'<p class="tagline">(.*?)</p>', sm.group(3), re.S)
            cost = re.search(r'<strong>Mana Cost: </strong>([^<]+)', sm.group(3))
            spells.append({'name': clean(sm.group(2)), 'id': sm.group(1), 'cost': cost.group(1).strip() if cost else '',
                           'text': clean(tag.group(1)) if tag else ''})
        assert len(spells) == 2, (base, rank, len(spells))
        out.setdefault(base, []).append({'rank': rank, 'title': rname, 'id': '%s-rank-%d-%s' % (base, rank, rid),
                                         'default': {'name': clean(d.group(1)), 'note': clean(d.group(2) or '').strip('() '), 'text': clean(d.group(3))} if d else None,
                                         'spells': spells})
    return out


def main():
    with open('forge/data.json', encoding='utf-8') as fh:
        data = json.load(fh)
    p12 = open('rulebook/ch12.html', encoding='utf-8').read()
    p13 = open('rulebook/ch13.html', encoding='utf-8').read()
    st = styles(p12)
    for s in data['styles']:
        key = re.sub(r'[^a-z0-9]+', '-', s['name'].lower().replace("'", '')).strip('-')
        s['ranks'] = st[key]
        assert len(s['ranks']) == 7, s['name']
    sc = schools(p13)
    for k in data['knowledges']:
        key = 'battle-aura' if k['name'] == 'Battle Aura' else (k['name'].lower() + '-magic')
        if k['name'] == 'Circle Magic':
            continue
        k['ranks'] = sc[key]
        assert len(k['ranks']) == 7, k['name']
    # Circle Magic is ten disciplines, each its own knowledge (no spell list)
    toc = json.load(open('rulebook/toc.json', encoding='utf-8'))
    disc = [n for n in toc['ch13'] if n['s'] == 'The Disciplines of Circle Magic'][0]['c']
    i = [k['name'] for k in data['knowledges']].index('Circle Magic')
    out = []
    for n in disc:
        m = re.search(r'id="%s">.*?</h3>\s*<p>(.*?)</p>' % re.escape(n['id']), p13, re.S)
        first = re.split(r'(?<=\.)\s', clean(m.group(1)))[0] if m else ''
        out.append({'name': n['s'], 'kind': 'Circle Magic discipline', 'extra_mana_dice': '', 'focus': first,
                    'link': '../rulebook/ch13.html#' + n['id'], 'ranks': None, 'circle': True})
    data['knowledges'][i:i + 1] = out
    with open('forge/data.json', 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print('ranks added: %d styles, %d knowledges' % (len(data['styles']), sum(1 for k in data['knowledges'] if k.get('ranks'))))


if __name__ == '__main__':
    main()
