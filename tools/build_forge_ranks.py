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


def heritage_magic(page):
    """Each Heritage magic in ch8.html: its heading id and seven ranks of two spells (A and B)."""
    out = {}
    heads = list(re.finditer(r'<h4 id="([a-z0-9-]+)">(?:Heritage Magic|Vampiric Power): ([^<]+)</h4>', page))
    for i, h in enumerate(heads):
        name = html.unescape(h.group(2)).strip()
        end = heads[i + 1].start() if i + 1 < len(heads) else len(page)
        nxt = page.find('<h3', h.end())
        if 0 <= nxt < end:
            end = nxt
        body = page[h.end():end]
        ranks = []
        for m in re.finditer(r'<h4 class="minor" id="[^"]+">Rank (\d) ([A-Za-z]+)\s*\(choose one\)</h4>(.*?)(?=<h4|$)', body, re.S):
            spells = []
            for sm in re.finditer(r'<div class="entry"><div class="entry-name" id="([^"]+)">([AB])\. ([^<]+)</div>(.*?)</div>\s*(?=<div class="entry"|<h4|</section>|$)', m.group(3), re.S):
                cost = re.search(r'<strong>Mana Cost: </strong>([^<]+)', sm.group(4))
                eff = re.search(r'<strong>Effect: </strong>(.*?)</p>', sm.group(4), re.S)
                spells.append({'name': clean(sm.group(3)), 'opt': sm.group(2), 'id': sm.group(1),
                               'cost': cost.group(1).strip() if cost else '', 'text': clean(eff.group(1)) if eff else ''})
            assert len(spells) == 2, (name, m.group(1), len(spells))
            ranks.append({'rank': int(m.group(1)), 'title': m.group(2), 'id': h.group(1), 'default': None, 'spells': spells})
        assert len(ranks) in (0, 7), (name, len(ranks))
        out[name] = {'id': h.group(1), 'ranks': ranks or None}
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
        if k['name'] == 'Circle Magic' or k['kind'] == 'Circle Magic discipline':
            continue
        k['ranks'] = sc[key]
        assert len(k['ranks']) == 7, k['name']
    # Two- and three-school combination spells (taken in place of a rank's option)
    combos = []
    for sec, n in (('two-school-combinations', 2), ('three-school-combinations', 3), ('four-school-combinations', 4),
                   ('five-school-combinations', 5), ('six-school-combinations', 6)):
        i0 = p13.find('id="%s"' % sec)
        i1 = p13.find('<section', i0)
        for m in re.finditer(r'<div class="entry"><div class="entry-name" id="([^"]+)">([^<]+)</div>(.*?)</div>', p13[i0:i1], re.S):
            nm = clean(m.group(2))
            mm = re.match(r'^(.+?) \((.+)\)$', nm)
            parts = [x.strip() for x in mm.group(2).split('+')]
            assert len(parts) == n, nm
            tag = re.search(r'<p class="tagline">(.*?)</p>', m.group(3), re.S)
            combos.append({'name': mm.group(1), 'schools': parts, 'dots': n, 'id': m.group(1),
                           'cost': str(n * n), 'text': clean(tag.group(1)) if tag else ''})
    counts = [len([c for c in combos if c['dots'] == n]) for n in (2, 3, 4, 5, 6)]
    assert counts == [21, 35, 35, 21, 7], counts
    if 'id="creation-magic"' in p13:
        combos.append({'name': 'Creation Magic', 'schools': ['Fire', 'Water', 'Air', 'Earth', 'Nature', 'Bright', 'Shade'],
                       'dots': 7, 'id': 'creation-magic', 'cost': '49',
                       'text': 'The single combination of all seven schools: the only magic that brings new life into the world.'})
    data['combos'] = combos

    # Circle Magic is ten disciplines, each its own knowledge (no spell list)
    toc = json.load(open('rulebook/toc.json', encoding='utf-8'))
    disc = [n for n in toc['ch13'] if n['s'] == 'The Disciplines of Circle Magic'][0]['c']
    names = [k['name'] for k in data['knowledges']]
    if 'Circle Magic' not in names:
        # Chapter 6 already lists each discipline as its own row
        by_name = {n['s']: n for n in disc}
        for k in data['knowledges']:
            if k['kind'] == 'Circle Magic discipline':
                k['circle'] = True
                k['ranks'] = None
                k['link'] = '../rulebook/ch13.html#' + by_name[k['name']]['id']
        assert sum(1 for k in data['knowledges'] if k.get('circle')) == len(disc)
        disc = []
    i = names.index('Circle Magic') if 'Circle Magic' in names else len(names)
    out = []
    for n in disc:
        m = re.search(r'id="%s">.*?</h3>\s*<p>(.*?)</p>' % re.escape(n['id']), p13, re.S)
        first = re.split(r'(?<=\.)\s', clean(m.group(1)))[0] if m else ''
        out.append({'name': n['s'], 'kind': 'Circle Magic discipline', 'extra_mana_dice': '', 'focus': first,
                    'link': '../rulebook/ch13.html#' + n['id'], 'ranks': None, 'circle': True})
    if out:
        data['knowledges'][i:i + 1] = out
    hm = heritage_magic(open('rulebook/ch8.html', encoding='utf-8').read())
    data['heritage_magic'] = hm
    for h in data['heritages']:
        assert h['heritage_magic'] in hm, h['heritage_magic']
    with open('forge/data.json', 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print('ranks added: %d styles, %d knowledges, %d heritage magics (%d with ranks)' % (len(data['styles']), sum(1 for k in data['knowledges'] if k.get('ranks')), len(hm), sum(1 for v in hm.values() if v['ranks'])))


if __name__ == '__main__':
    main()
