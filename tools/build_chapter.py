"""Turn one rulebook chapter (.docx from the second draft folder) into a
rulebook/<slug>.html page that uses the site shell.

Usage: python3 tools/build_chapter.py <chapter.docx> <slug> <prev-slug|-> <next-slug|->
Example: python3 tools/build_chapter.py "Jimothy D10 - Chapter 12 - Martial Combat Styles.docx" ch12 ch11 ch13
"""
import html
import re
import sys

import docx
from docx.table import Table
from docx.text.paragraph import Paragraph

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

CHAPTER_NAMES = {
    'front': 'Front Matter', 'ch1': 'The Six-Faced World', 'ch2': 'Locations and Settings',
    'ch3': 'Monsera and the United Domains', 'ch4': 'The Grand Dungeon', 'ch5': 'Legends of Terrana',
    'ch6': 'Character Creation Overview', 'ch7': 'Tropes, Virtues, and Vices', 'ch8': 'Heritages',
    'ch9': 'Merits and Flaws', 'ch10': 'Backgrounds', 'ch11': 'Willpower, Fate, Sanity, and Mana',
    'ch12': 'Martial Combat Styles', 'ch13': 'Magic', 'ch14': 'Equipment and Items',
    'ch15': 'Bestiary', 'ch16': 'Alternate Eras', 'terms': 'Key Terms',
}

ABILITY = re.compile(r'^(Default Ability|Option A|Option B):\s*(.+?)\s*\((Combat|Outside combat|Both)\)\s*(.*)$', re.S)
LABEL = re.compile(r'^([A-Z][^:]{0,60}):\s+(.*)$', re.S)


def esc(s):
    return html.escape(s, quote=True)


def slugify(s):
    s = re.sub(r"[’']", '', s.lower())
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def style_name(p):
    return p.style.name if p.style is not None else ''


def runs_html(p):
    out = []
    for r in p.runs:
        t = r.text.replace('\t', ' ')
        if not t:
            continue
        t = esc(t)
        if r.bold:
            t = '<strong>' + t + '</strong>'
        if r.italic:
            t = '<em>' + t + '</em>'
        out.append(t)
    return ''.join(out).replace('</strong><strong>', '').replace('</em><em>', '')


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


def table_html(t, section_titles):
    rows = []
    for i, r in enumerate(t.rows):
        cells, seen = [], None
        for c in r.cells:
            if c._tc is seen:
                continue
            seen = c._tc
            txt = c.text.strip()
            tag = 'th' if i == 0 else 'td'
            inner = esc(txt).replace('\n', '<br>')
            key = txt.lower()
            if i > 0 and key in section_titles:
                inner = '<a href="#' + section_titles[key] + '">' + inner + '</a>'
            cells.append('<%s>%s</%s>' % (tag, inner, tag))
        rows.append('<tr>' + ''.join(cells) + '</tr>')
    head, body = rows[0], rows[1:]
    return ('<div class="table-wrap"><table><thead>' + head + '</thead><tbody>' +
            ''.join(body) + '</tbody></table></div>')


def build(path, slug, prev_slug, next_slug):
    doc = docx.Document(path)
    items = list(blocks(doc))

    # 1. Chapter title and the "In This Chapter" list (groups are the bold lines)
    title = ''
    toc_groups = []
    i = 0
    while i < len(items):
        b = items[i]
        if isinstance(b, Paragraph) and style_name(b) == 'Heading 1':
            title = b.text.strip()
        elif isinstance(b, Paragraph) and b.text.strip() == 'In This Chapter':
            i += 1
            while i < len(items) and isinstance(items[i], Paragraph) and not items[i].text.strip():
                i += 1
            while i < len(items) and isinstance(items[i], Paragraph) and '\t' in items[i].text:
                p = items[i]
                name = p.text.split('\t')[0].strip()
                bold = any(r.bold for r in p.runs if r.text.strip())
                if bold:
                    toc_groups.append([name, []])
                else:
                    if not toc_groups:
                        toc_groups.append(['', []])
                    toc_groups[-1][1].append(name)
                i += 1
            break
        i += 1
    body_items = items[i:]

    # 2. Split into sections at each Heading 2
    sections = []
    current = {'title': 'Introduction', 'items': []}
    for b in body_items:
        if isinstance(b, Paragraph) and style_name(b) == 'Heading 2':
            if current['items'] or sections:
                sections.append(current)
            current = {'title': b.text.strip(), 'items': []}
        else:
            current['items'].append(b)
    sections.append(current)
    sections = [s for s in sections if s['items']]

    for s in sections:
        s['id'] = slugify(s['title'])
    section_titles = {}
    for s in sections:
        section_titles[s['title'].lower()] = s['id']

    # Link TOC names (e.g. "Quickcut Style (Short Blades)") to section ids
    def toc_link(name):
        base = re.sub(r'\s*\(.*\)$', '', name).lower()
        sid = (section_titles.get(name.lower()) or section_titles.get(base)
               or sub_titles.get(name.lower()))
        return sid

    # 3. Render each section
    sub_titles = {}
    out_sections = []
    for s in sections:
        parts = []
        its = s['items']
        k = 0
        # Style-style header: short bold line (form), tagline, Covers, Primary/Secondary
        if (len(its) > 3 and isinstance(its[0], Paragraph) and len(its[0].text) < 30
                and all(r.bold for r in its[0].runs if r.text.strip())
                and its[0].text.strip() and ':' not in its[0].text):
            parts.append('<div class="entry-form px">' + esc(its[0].text.strip()) + '</div>')
            k = 1
        while k < len(its):
            b = its[k]
            k += 1
            if isinstance(b, Table):
                parts.append(table_html(b, section_titles))
                continue
            text = b.text.strip()
            if not text:
                continue
            sn = style_name(b)
            if sn == 'Heading 3':
                if re.match(r'^Rank \d+:', text):
                    num, name = text.split(':', 1)
                    parts.append('<h3 class="rank"><span class="rank-num">' + esc(num) +
                                 '</span> ' + esc(name.strip()) + '</h3>')
                else:
                    hid = s['id'] + '-' + slugify(text)
                    sub_titles[text.lower()] = hid
                    parts.append('<h3 id="' + hid + '">' + esc(text) + '</h3>')
                continue
            m = ABILITY.match(text)
            if m:
                kind, name, use, rest = m.groups()
                parts.append(
                    '<div class="ability"><div class="ability-head">'
                    '<span class="ability-kind">' + esc(kind) + '</span>'
                    '<span class="ability-name">' + esc(name) + '</span>'
                    '<span class="use use-' + slugify(use) + '">' + esc(use) + '</span></div>'
                    '<p>' + esc(rest) + '</p></div>')
                continue
            if text.startswith('Primary:') and 'Secondary:' in text:
                pri, sec = text.split('Secondary:', 1)
                pri = pri.replace('Primary:', '').strip()
                parts.append('<div class="pools"><div><span class="term">Primary</span> ' + esc(pri) +
                             '</div><div><span class="term">Secondary</span> ' + esc(sec.strip()) + '</div></div>')
                continue
            first_bold = next((r for r in b.runs if r.text.strip()), None)
            m = LABEL.match(text)
            if m and first_bold is not None and first_bold.bold:
                parts.append('<p><strong class="term">' + esc(m.group(1)) + ':</strong> ' + esc(m.group(2)) + '</p>')
                continue
            if all(r.italic for r in b.runs if r.text.strip()):
                parts.append('<p class="tagline">' + esc(text) + '</p>')
                continue
            parts.append('<p>' + runs_html(b) + '</p>')
        out_sections.append(
            '<section class="panel win" id="' + s['id'] + '">\n<h2>' + esc(s['title']) + '</h2>\n' +
            '\n'.join(parts) + '\n</section>')

    # 4. "In This Chapter" panel
    toc_html = []
    for g, names in toc_groups:
        lis = []
        for n in names:
            sid = toc_link(n)
            if sid:
                lis.append('<li><a href="#' + sid + '">' + esc(n) + '</a></li>')
            else:
                lis.append('<li>' + esc(n) + '</li>')
        head = '<h3>' + esc(g) + '</h3>' if g else ''
        toc_html.append('<div class="toc-group">' + head + '<ul>' + ''.join(lis) + '</ul></div>')

    num = re.match(r'Chapter (\d+):\s*(.*)', title)
    kicker = 'Chapter ' + num.group(1) if num else ''
    heading = num.group(2) if num else title

    def chap_link(sl, label):
        if sl == '-':
            return ''
        n = re.sub(r'\D', '', sl)
        name = CHAPTER_NAMES.get(sl, '')
        prefix = ('Chapter ' + n + ': ') if n else ''
        return '<a class="act" href="' + sl + '.html">' + label + ': ' + esc(prefix + name) + '</a>'

    pager = ('<nav class="pager win" aria-label="Chapters">' + chap_link(prev_slug, 'Previous') +
             chap_link(next_slug, 'Next') + '</nav>')

    page = '''<!doctype html>
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
'''.format(title=esc(heading), slug=slug, kicker=esc(kicker), heading=esc(heading),
           toc=''.join(toc_html), sections='\n\n'.join(out_sections), pager=pager)
    return page


if __name__ == '__main__':
    src, slug, prev_slug, next_slug = sys.argv[1:5]
    with open('rulebook/' + slug + '.html', 'w', encoding='utf-8') as f:
        f.write(build(src, slug, prev_slug, next_slug))
    print('wrote rulebook/' + slug + '.html')
