"""Build every rulebook page from the second draft .docx files.

Usage: python3 tools/build_rulebook.py "<path to the second draft folder>"

Writes, inside the repo:
  rulebook/<slug>.html      one page per chapter (front, ch1..ch16, terms)
  rulebook/index.html       the Rulebook landing page
  rulebook/search.json      what the search box looks through
"""
import glob
import hashlib
import html
import io
import json
import os
import re
import sys

import docx
from docx.table import Table
from docx.text.paragraph import Paragraph
from PIL import Image

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
      'wp': 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'}

CHAPTERS = [
    ('front', 'Front Matter', 'Front Matter'),
    ('ch1', 'Chapter 1 - The Six-Faced World', 'The Six-Faced World'),
    ('ch2', 'Chapter 2 - Locations and Settings', 'Locations and Settings'),
    ('ch3', 'Chapter 3 - Monsera and the United Domains', 'Monsera and the United Domains'),
    ('ch4', 'Chapter 4 - The Grand Dungeon', 'The Grand Dungeon'),
    ('ch5', 'Chapter 5 - Legends of Terrana', 'Legends of Terrana'),
    ('ch6', 'Chapter 6 - Character Creation Overview', 'Character Creation Overview'),
    ('ch7', 'Chapter 7 - Tropes, Virtues, and Vices', 'Tropes, Virtues, and Vices'),
    ('ch8', 'Chapter 8 - Heritages', 'Heritages'),
    ('ch9', 'Chapter 9 - Merits and Flaws', 'Merits and Flaws'),
    ('ch10', 'Chapter 10 - Backgrounds', 'Backgrounds'),
    ('ch11', 'Chapter 11 - Willpower, Fate, Sanity, and Mana', 'Willpower, Fate, Sanity, and Mana'),
    ('ch12', 'Chapter 12 - Martial Combat Styles', 'Martial Combat Styles'),
    ('ch13', 'Chapter 13 - Magic', 'Magic'),
    ('ch14', 'Chapter 14 - Equipment and Items', 'Equipment and Items'),
    ('ch15', 'Chapter 15 - Bestiary', 'Bestiary'),
    ('ch16', 'Chapter 16 - Alternate Eras', 'Alternate Eras'),
    ('terms', 'Index - Key Terms', 'Key Terms'),
]
NAME = {c[0]: c[2] for c in CHAPTERS}

ABILITY = re.compile(r'^(Default Ability|Option A|Option B):\s*(.+?)\s*\((Combat|Outside combat|Both)\)\s*(.*)$', re.S)
TOC_LINE = re.compile(r'^(.+?)(?:\t+|\s{1,})(\d{1,3})$')
CH_REF = re.compile(r'\b(Chapters?|Ch\.)\s+(\d{1,2})\b')


def esc(s):
    return html.escape(s, quote=True)


def slugify(s):
    s = re.sub(r"[’']", '', s.lower())
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-') or 'section'


def style_name(p):
    return p.style.name if p.style is not None else ''


def linkify(escaped, here):
    """Turn 'Chapter 5' and '(Ch. 6)' into links to that chapter's page."""
    def rep(m):
        n = int(m.group(2))
        if not 1 <= n <= 16 or 'ch%d' % n == here:
            return m.group(0)
        return '<a href="ch%d.html">%s</a>' % (n, m.group(0))
    return CH_REF.sub(rep, escaped)


def runs_of(p):
    return [r for r in p.runs if r.text.strip()]


def fully_bold(p):
    rs = runs_of(p)
    return bool(rs) and all(r.bold for r in rs)


def fully_italic(p):
    rs = runs_of(p)
    return bool(rs) and all(r.italic for r in rs)


def centered(p):
    return p.alignment is not None and 'CENTER' in str(p.alignment)


def runs_html(p, here):
    out = []
    for r in p.runs:
        t = r.text.replace('\t', ' ')
        if not t:
            continue
        t = linkify(esc(t), here)
        if r.bold and t.strip():
            t = '<strong>' + t + '</strong>'
        if r.italic and t.strip():
            t = '<em>' + t + '</em>'
        out.append(t)
    s = ''.join(out)
    for a, b in (('</strong><strong>', ''), ('</em><em>', ''), ('</strong> <strong>', ' ')):
        s = s.replace(a, b)
    return s.strip()


def blocks(doc):
    def walk(el):
        for c in el.iterchildren():
            if c.tag == W + 'p':
                yield Paragraph(c, doc)
            elif c.tag == W + 'tbl':
                yield Table(c, doc)
            elif c.tag == W + 'sdt':
                yield from walk(c.find(W + 'sdtContent'))
    yield from walk(doc.element.body)


class Pictures:
    def __init__(self, out_dir):
        self.out_dir = out_dir
        os.makedirs(out_dir, exist_ok=True)
        self.count = {}

    def save(self, doc, p, slug):
        """Save every picture in paragraph p; return a list of (src, alt)."""
        found = []
        for blip in p._p.xpath('.//a:blip'):
            rid = blip.get('{%s}embed' % NS['r'])
            if not rid or rid not in doc.part.related_parts:
                continue
            data = doc.part.related_parts[rid].blob
            alt = ''
            for d in p._p.xpath('.//wp:docPr'):
                alt = d.get('descr') or d.get('title') or ''
            try:
                im = Image.open(io.BytesIO(data))
                im.load()
            except Exception:
                continue
            if im.mode not in ('RGB', 'RGBA'):
                im = im.convert('RGBA')
            if im.width > 1600:
                im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
            self.count[slug] = self.count.get(slug, 0) + 1
            name = '%s-%d.webp' % (slug, self.count[slug])
            im.save(os.path.join(self.out_dir, name), 'WEBP', quality=82, method=6)
            found.append(('img/' + name, alt))
        return found


def table_html(t, section_titles, here):
    rows = []
    cols = len(t.columns)
    for i, r in enumerate(t.rows):
        cells, seen = [], None
        for c in r.cells:
            if c._tc is seen:
                continue
            seen = c._tc
            txt = c.text.strip()
            tag = 'th' if i == 0 else 'td'
            inner = linkify(esc(txt), here).replace('\n', '<br>')
            key = txt.lower()
            if i > 0 and key in section_titles:
                inner = '<a href="#' + section_titles[key] + '">' + inner + '</a>'
            cells.append('<%s>%s</%s>' % (tag, inner, tag))
        rows.append('<tr>' + ''.join(cells) + '</tr>')
    width = min(140 * cols, 720)
    return ('<div class="table-wrap"><table style="min-width: %dpx"><thead>' % width + rows[0] +
            '</thead><tbody>' + ''.join(rows[1:]) + '</tbody></table></div>')


def box_html(t, here):
    """A one-cell table used as a box on the page (title page, foreword)."""
    paras = [p for p in t.rows[0].cells[0].paragraphs if p.text.strip()]
    if not paras:
        return '', ''
    title = paras[0].text.strip()
    body = ''.join('<p>' + runs_html(p, here) + '</p>' for p in paras[1:])
    return title, body


class Renderer:
    def __init__(self, doc, slug, pics):
        self.doc = doc
        self.slug = slug
        self.pics = pics
        self.sub_titles = {}
        self.chunks = []

    def chunk(self, cid, title):
        self.chunks.append({'id': cid, 's': title, 't': []})

    def note(self, h):
        if self.chunks:
            self.chunks[-1]['t'].append(h)

    def render(self, section, section_titles):
        parts = []
        its = section['items']
        card = None   # list of html parts while inside an entry card
        ul = None     # list items while inside a bullet list

        def flush_ul():
            nonlocal ul
            if ul:
                target = card if card is not None else parts
                target.append('<ul class="list">' + ''.join(ul) + '</ul>')
            ul = None

        def flush_card():
            nonlocal card
            flush_ul()
            if card is not None:
                parts.append('<div class="entry">' + ''.join(card) + '</div>')
            card = None

        def add(h):
            flush_ul()
            (card if card is not None else parts).append(h)
            self.note(h)

        used_ids = set()

        def new_id(text):
            cid = section['id'] + '-' + slugify(text)
            while cid in used_ids:
                cid += '-2'
            used_ids.add(cid)
            return cid

        self.chunk(section['id'], section['title'])

        k = 0
        # Ch. 12 style header line: a short bold line straight after the section title
        if (its and isinstance(its[0], Paragraph) and fully_bold(its[0]) and not centered(its[0])
                and len(its[0].text.strip()) < 30 and ':' not in its[0].text and len(its) > 3):
            parts.append('<div class="entry-form px">' + esc(its[0].text.strip()) + '</div>')
            k = 1

        while k < len(its):
            b = its[k]
            k += 1
            if isinstance(b, Table):
                if len(b.rows) == 1 and len(b.columns) == 1:
                    title, body = box_html(b, self.slug)
                    flush_card()
                    parts.append('<div class="box"><h3>' + esc(title) + '</h3>' + body + '</div>')
                else:
                    add(table_html(b, section_titles, self.slug))
                continue

            text = b.text.strip()
            if not text:
                continue
            sn = style_name(b)

            if sn in ('Heading 3', 'Heading 4', 'Heading 5'):
                flush_card()
                level = {'Heading 3': 3, 'Heading 4': 4, 'Heading 5': 5}[sn]
                if level == 3 and re.match(r'^Rank \d+:', text):
                    num, name = text.split(':', 1)
                    parts.append('<h3 class="rank"><span class="rank-num">' + esc(num) +
                                 '</span> ' + esc(name.strip()) + '</h3>')
                    continue
                hid = new_id(text)
                self.sub_titles.setdefault(text.lower(), hid)
                self.sub_titles.setdefault(re.sub(r'\s*\(.*\)$', '', text).lower(), hid)
                parts.append('<h%d id="%s">%s</h%d>' % (level, hid, esc(text), level))
                self.chunk(hid, text)
                continue

            if sn == 'List Paragraph':
                if ul is None:
                    ul = []
                li = '<li>' + runs_html(b, self.slug) + '</li>'
                ul.append(li)
                self.note(li)
                continue

            m = ABILITY.match(text)
            if m:
                kind, name, use, rest = m.groups()
                add('<div class="ability"><div class="ability-head">'
                    '<span class="ability-kind">' + esc(kind) + '</span>'
                    '<span class="ability-name">' + esc(name) + '</span>'
                    '<span class="use">' + esc(use) + '</span></div>'
                    '<p>' + linkify(esc(rest), self.slug) + '</p></div>')
                continue

            if text.startswith('Primary:') and 'Secondary:' in text and len(text) < 140:
                pri, sec = text.split('Secondary:', 1)
                pri = pri.replace('Primary:', '').strip()
                add('<div class="pools"><div><span class="term">Primary</span> ' + esc(pri) +
                    '</div><div><span class="term">Secondary</span> ' + esc(sec.strip()) + '</div></div>')
                continue

            if fully_bold(b) and centered(b) and len(text) < 90:
                flush_card()
                hid = new_id(text)
                self.sub_titles.setdefault(text.lower(), hid)
                parts.append('<h4 class="minor" id="' + hid + '">' + esc(text) + '</h4>')
                self.chunk(hid, text)
                continue

            if (fully_bold(b) and not centered(b) and len(text) < 70 and '\t' not in text
                    and not text.endswith(':') and ':' not in text[:-1]):
                flush_card()
                cid = new_id(text)
                self.sub_titles.setdefault(text.lower(), cid)
                self.sub_titles.setdefault(re.sub(r'\s*\(.*\)$', '', text).lower(), cid)
                card = ['<div class="entry-name" id="' + cid + '">' + esc(text) + '</div>']
                self.chunk(cid, text)
                continue

            if '  |  ' in text and not fully_bold(b):
                cls = 'stats tags' if fully_italic(b) else 'stats'
                cells = runs_html(b, self.slug).split('  |  ')
                if len(cells) == 1:
                    cells = [c.strip() for c in text.split('|')]
                    cells = [linkify(esc(c), self.slug) for c in cells]
                add('<div class="' + cls + '">' + ''.join('<span>' + c.strip() + '</span>' for c in cells) + '</div>')
                continue

            if fully_italic(b):
                cls = 'tagline center' if centered(b) else 'tagline'
                add('<p class="' + cls + '">' + linkify(esc(text), self.slug) + '</p>')
                continue

            cls = ' class="center"' if centered(b) else ''
            add('<p' + cls + '>' + runs_html(b, self.slug) + '</p>')

        flush_card()
        return '\n'.join(parts)


def plain(html_text):
    t = re.sub(r'<[^>]+>', ' ', html_text)
    return re.sub(r'\s+', ' ', html.unescape(t)).strip()


def build(path, slug, prev_slug, next_slug, pics):
    doc = docx.Document(path)
    items = list(blocks(doc))

    title = ''
    toc_groups = []
    body = []
    i = 0
    # Chapter title and "In This Chapter" list (bold lines are groups)
    while i < len(items):
        b = items[i]
        if isinstance(b, Paragraph) and style_name(b) == 'Heading 1' and not title:
            title = b.text.strip()
            i += 1
            continue
        if isinstance(b, Paragraph) and b.text.strip() == 'In This Chapter':
            i += 1
            while i < len(items) and isinstance(items[i], Paragraph) and not items[i].text.strip():
                i += 1
            while i < len(items) and isinstance(items[i], Paragraph) and (
                    TOC_LINE.match(items[i].text.strip()) or not items[i].text.strip()):
                p = items[i]
                if not p.text.strip():
                    i += 1
                    continue
                name = TOC_LINE.match(p.text.strip()).group(1).strip()
                if fully_bold(p):
                    toc_groups.append([name, []])
                else:
                    if not toc_groups:
                        toc_groups.append(['', []])
                    toc_groups[-1][1].append(name)
                i += 1
            continue
        break
    body = items[i:]

    # Split into sections at each Heading 2 (a later Heading 1 is a Part divider)
    sections = []
    current = {'title': 'Title Page and Foreword' if slug == 'front' else 'Introduction', 'items': [], 'part': False}
    cover = []
    for b in body:
        if isinstance(b, Paragraph) and style_name(b) in ('Heading 1', 'Heading 2'):
            if current['items'] or current['part']:
                sections.append(current)
            current = {'title': b.text.strip(), 'items': [], 'part': style_name(b) == 'Heading 1'}
        elif (slug == 'front' and not sections and not current['items']
              and isinstance(b, Paragraph) and b._p.xpath('.//a:blip')):
            cover.append(b)
        else:
            current['items'].append(b)
    if current['items'] or current['part']:
        sections.append(current)

    used = set()
    for s in sections:
        sid = slugify(s['title'])
        while sid in used:
            sid += '-2'
        used.add(sid)
        s['id'] = sid
    section_titles = {s['title'].lower(): s['id'] for s in sections}

    r = Renderer(doc, slug, pics)
    out_sections = []
    search = []
    for s in sections:
        inner = r.render(s, section_titles)
        if s['part']:
            out_sections.append('<section class="panel win part" id="' + s['id'] + '">\n<h2>' + esc(s['title']) +
                                '</h2>\n' + inner + '\n</section>')
        else:
            out_sections.append('<section class="panel win" id="' + s['id'] + '">\n<h2>' + esc(s['title']) +
                                '</h2>\n' + inner + '\n</section>')
    for ch in r.chunks:
        t = plain(' '.join(ch['t']))
        if t or ch['id'] in section_titles.values():
            search.append({'p': slug, 'id': ch['id'], 's': ch['s'], 't': t})

    # "In This Chapter" panel: from the book's own list, or from the sections
    if not toc_groups:
        toc_groups = [['', [s['title'] for s in sections]]]

    def toc_link(name):
        base = re.sub(r'\s*\(.*\)$', '', name).lower()
        return (section_titles.get(name.lower()) or section_titles.get(base)
                or r.sub_titles.get(name.lower()) or r.sub_titles.get(base))

    toc_html = []
    for g, names in toc_groups:
        lis = []
        for n in names:
            sid = toc_link(n)
            if sid:
                lis.append('<li><a href="#' + sid + '">' + esc(n) + '</a></li>')
            else:
                lis.append('<li><span>' + esc(n) + '</span></li>')
        gid = toc_link(g) if g else None
        head = ''
        if g:
            head = '<h3>' + ('<a href="#' + gid + '">' + esc(g) + '</a>' if gid else esc(g)) + '</h3>'
        toc_html.append('<div class="toc-group">' + head + '<ul>' + ''.join(lis) + '</ul></div>')

    num = re.match(r'Chapter (\d+):\s*(.*)', title)
    kicker = 'Chapter ' + num.group(1) if num else ''
    heading = NAME[slug]

    cover_html = ''  # pictures from the book are left off the website

    def chap_link(sl, label):
        if not sl:
            return ''
        n = re.sub(r'\D', '', sl)
        prefix = ('Chapter ' + n + ': ') if n else ''
        return '<a class="act" href="' + sl + '.html">' + label + ': ' + esc(prefix + NAME[sl]) + '</a>'

    pager = ('<nav class="pager win" aria-label="Chapters">' + chap_link(prev_slug, 'Previous') +
             chap_link(next_slug, 'Next') + '</nav>')

    page = PAGE.format(
        title=esc(heading), slug=slug, kicker=esc(kicker), heading=esc(heading), cover=cover_html,
        toc=''.join(toc_html), sections='\n\n'.join(out_sections), pager=pager)
    return page, search


PAGE = '''<!doctype html>
<html lang="en" data-root="../">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} | Jimothy's D10 Isekai JRPG</title>
<link rel="stylesheet" href="../assets/site.css">
<link rel="icon" href="../assets/icons/d10.svg" type="image/svg+xml">
</head>
<body data-page="{slug}" data-address="www.terrana.ccn/rulebook/{slug}">
<div class="page">
  <div id="site-top"></div>

  <div class="layout">
    <main class="content">
      <section class="panel win chapter-head" id="top">
        <div class="kicker">{kicker}</div>
        <h1>{heading}</h1>
        {cover}
        <div class="toc">{toc}</div>
      </section>

{sections}

      {pager}
    </main>
  </div>

  <div id="site-bottom"></div>
</div>
<script src="../assets/site.js"></script>
</body>
</html>
'''

INDEX = '''<!doctype html>
<html lang="en" data-root="../">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rulebook | Jimothy's D10 Isekai JRPG</title>
<link rel="stylesheet" href="../assets/site.css">
<link rel="icon" href="../assets/icons/d10.svg" type="image/svg+xml">
</head>
<body data-page="rulebook" data-address="www.terrana.ccn/rulebook/">
<div class="page">
  <div id="site-top"></div>

  <div class="layout">
    <main class="content">
      <section class="panel win">
        <h1>The Rulebook</h1>
        <p class="center">Every chapter of the second draft. Use the search box in the chapter menu to find any rule, spell, or creature.</p>
      </section>
{groups}
    </main>
  </div>

  <div id="site-bottom"></div>
</div>
<script src="../assets/site.js"></script>
</body>
</html>
'''

GROUPS = [
    ('Before You Begin', ['front']),
    ('Learning the World', ['ch1', 'ch2', 'ch3', 'ch4', 'ch5']),
    ('Making a Character', ['ch6', 'ch7', 'ch8', 'ch9', 'ch10', 'ch11']),
    ('Playing the Game', ['ch12', 'ch13', 'ch14', 'ch15', 'ch16']),
    ('Quick Lookup', ['terms']),
]


def build_index():
    out = []
    for g, slugs in GROUPS:
        links = []
        for sl in slugs:
            n = re.sub(r'\D', '', sl)
            num = '<span class="num">' + n + '</span>' if n else '<span class="num"></span>'
            links.append('<a class="menu-item" href="' + sl + '.html">' + num + '<span>' + esc(NAME[sl]) + '</span></a>')
        out.append('      <section class="panel win">\n        <h2>' + esc(g) + '</h2>\n        <nav class="chapter-list" aria-label="' +
                   esc(g) + '">' + ''.join(links) + '</nav>\n      </section>')
    return INDEX.format(groups='\n'.join(out))


def main(src_dir):
    os.makedirs('rulebook', exist_ok=True)
    pics = None
    search = []
    slugs = [c[0] for c in CHAPTERS]
    for idx, (slug, fname, _) in enumerate(CHAPTERS):
        path = os.path.join(src_dir, 'Jimothy D10 - ' + fname + '.docx')
        prev_slug = slugs[idx - 1] if idx > 0 else ''
        next_slug = slugs[idx + 1] if idx + 1 < len(slugs) else ''
        page, s = build(path, slug, prev_slug, next_slug, pics)
        with open('rulebook/' + slug + '.html', 'w', encoding='utf-8') as fh:
            fh.write(page)
        search += s
        print('wrote rulebook/%s.html (%d sections)' % (slug, len(s)))
    for e in search:
        e['c'] = NAME[e['p']]
    with open('rulebook/search.json', 'w', encoding='utf-8') as fh:
        json.dump(search, fh, ensure_ascii=False, separators=(',', ':'))
    with open('rulebook/index.html', 'w', encoding='utf-8') as fh:
        fh.write(build_index())
    print('wrote rulebook/index.html and rulebook/search.json')


if __name__ == '__main__':
    main(sys.argv[1])
