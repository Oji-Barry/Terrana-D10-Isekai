"""Compile the Terrana Core Rulebook (Second Draft) and the Lulu print edition.

Chapters are rebuilt from the second draft .docx files with book page numbers.
The cover, title page, Foreword, Introduction, and back matter (maps, playmat,
Summoner's Sheet, character sheet) are reused from the last compiled books.

  python3 compile.py
"""
import copy, json, os, re, shutil, subprocess, sys
import docx
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from pypdf import PdfReader, PdfWriter, PageObject, Transformation
from pypdf.generic import (ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject,
                           RectangleObject)
import pdfplumber

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = '/mnt/user-data/uploads/James New Game Modes/D10 Isekai/Books/second draft'
NEWEST = '/mnt/user-data/outputs/book'          # tonight's edited chapters win over SRC
OLD_BOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'base', 'Jimothy D10 - Core Rulebook (Second Draft).pdf')
OLD_LULU = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'base', 'Jimothy D10 - Core Rulebook Interior Lulu Edit.pdf')
WORK = os.path.join(HERE, 'work')
OUT = os.path.join(HERE, 'out')
os.makedirs(WORK, exist_ok=True); os.makedirs(OUT, exist_ok=True)

CHAPTERS = [
    ('ch1', 'Chapter 1 - The Six-Faced World', 'Chapter 1: The Six-Faced World'),
    ('ch2', 'Chapter 2 - Locations and Settings', 'Chapter 2: Locations and Settings'),
    ('ch3', 'Chapter 3 - Monsera and the United Domains', 'Chapter 3: Monsera and the United Domains'),
    ('ch4', 'Chapter 4 - The Grand Dungeon', 'Chapter 4: The Grand Dungeon'),
    ('ch5', 'Chapter 5 - Legends of Terrana', 'Chapter 5: Legends of Terrana'),
    ('ch6', 'Chapter 6 - Character Creation Overview', 'Chapter 6: Character Creation Overview'),
    ('ch7', 'Chapter 7 - Tropes, Virtues, and Vices', 'Chapter 7: Tropes, Virtues, and Vices'),
    ('ch8', 'Chapter 8 - Heritages', 'Chapter 8: Heritages'),
    ('ch9', 'Chapter 9 - Merits and Flaws', 'Chapter 9: Merits and Flaws'),
    ('ch10', 'Chapter 10 - Backgrounds', 'Chapter 10: Backgrounds'),
    ('ch11', 'Chapter 11 - Willpower, Fate, Sanity, and Mana', 'Chapter 11: Willpower, Fate, Sanity, and Mana'),
    ('ch12', 'Chapter 12 - Martial Combat Styles', 'Chapter 12: Martial Combat Styles'),
    ('ch13', 'Chapter 13 - Magic', 'Chapter 13: Magic'),
    ('ch14', 'Chapter 14 - Equipment and Items', 'Chapter 14: Equipment and Items'),
    ('ch15', 'Chapter 15 - Bestiary', 'Chapter 15: Bestiary'),
    ('ch16', 'Chapter 16 - Alternate Eras', 'Chapter 16: Alternate Eras'),
    ('index', 'Index - Key Terms', 'Index: Key Terms'),
]
OFFSET = 3            # physical page = book page + 3 (cover, inside cover, title page)
FIRST_CHAPTER = 5     # Chapter 1 starts on book page 5
OLD_BACK_START = 316  # back matter starts on book page 316 in the base book (bk/base)


def src_docx(name):
    p = os.path.join(NEWEST, 'Jimothy D10 - %s.docx' % name)
    return p if os.path.exists(p) else os.path.join(SRC, 'Jimothy D10 - %s.docx' % name)


def norm(s):
    s = s.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    return re.sub(r'\s+', ' ', s).strip().lower()


# ---------- docx helpers ----------
def set_start(d, start):
    """First section starts a new page and numbers from `start`."""
    s = d.element.body.find('.//' + qn('w:sectPr'))
    t = s.find(qn('w:type'))
    if t is None:
        t = s.makeelement(qn('w:type'), {}); s.insert(0, t)
    t.set(qn('w:val'), 'nextPage')
    pg = s.find(qn('w:pgNumType'))
    if pg is None:
        pg = s.makeelement(qn('w:pgNumType'), {}); s.append(pg)
    pg.set(qn('w:start'), str(start))
    # later sections continue numbering
    for s2 in d.element.body.findall('.//' + qn('w:sectPr'))[1:]:
        p2 = s2.find(qn('w:pgNumType'))
        if p2 is not None and p2.get(qn('w:start')):
            del p2.attrib[qn('w:start')]


def contents_paras(d):
    """'In This Chapter' entries: paragraphs whose last run is a tab plus a number."""
    out = []
    started = False
    for p in d.paragraphs:
        if p.text.strip() == 'In This Chapter':
            started = True
            continue
        if not started:
            continue
        if p.style is not None and p.style.name.startswith('Heading') and out:
            break
        m = re.match(r'^(.*)\t(\d+)$', p.text)
        if m:
            out.append((p, m.group(1).strip(), int(m.group(2))))
    return out


def set_number(p, n):
    for r in reversed(p.runs):
        if re.search(r'\t\d+$', r.text):
            r.text = re.sub(r'\t\d+$', '\t%d' % n, r.text)
            return
        if re.fullmatch(r'\d+', r.text.strip()):
            r.text = str(n); return


def convert(docx_path):
    pdf = docx_path[:-5] + '.pdf'
    if os.path.exists(pdf):
        os.remove(pdf)
    subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', os.path.dirname(docx_path), docx_path],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
    return pdf


def page_lines(pdf):
    with pdfplumber.open(pdf) as p:
        return [[norm(l) for l in (pg.extract_text() or '').split('\n')] for pg in p.pages]


def find_heading(lines, title, first=0, loose=False):
    t = norm(re.sub(r'\s*\((?!HRC)[^)]*\)$', '', title))
    full = norm(title)
    for i in range(first, len(lines)):
        for l in lines[i]:
            if l == full or l == t:
                return i
    for i in range(first, len(lines)):
        for l in lines[i]:
            if l.startswith(t + ' (') or (l.startswith(t) and (loose or len(l) < len(t) + 25)):
                return i
    return None


# ---------- build ----------
def build(rebuild_numbers=None):
    """Convert every chapter. Returns {key: (start_book_page, pdf_path, page_count, lines)}."""
    info = {}
    page = FIRST_CHAPTER
    for key, name, title in CHAPTERS:
        if page % 2 == 0:
            page += 1           # every chapter starts on an odd (left) page
        d = docx.Document(src_docx(name))
        set_start(d, page)
        if name.startswith('Chapter 12'):
            for p in d.paragraphs:
                for r in p.runs:
                    if r.text == 'The Eleven Styles':
                        r.text = 'The Twelve Styles'
        if rebuild_numbers and key in rebuild_numbers:
            for (p, label, old), new in zip(contents_paras(d), rebuild_numbers[key]):
                set_number(p, new)
        path = os.path.join(WORK, key + '.docx')
        d.save(path)
        if os.environ.get('REUSE') and os.path.exists(path[:-5] + '.pdf'):
            pdf = path[:-5] + '.pdf'
        else:
            pdf = convert(path)
        n = len(PdfReader(pdf).pages)
        info[key] = (page, pdf, n, page_lines(pdf))
        print('  %-6s book %3d to %3d (%d pages)' % (key, page, page + n - 1, n))
        page += n
    return info


def contents_numbers(info):
    """Book page numbers for each chapter's In This Chapter list."""
    nums = {}
    for key, name, title in CHAPTERS:
        start, pdf, n, lines = info[key]
        d = docx.Document(src_docx(name))
        entries = contents_paras(d)
        if not entries:
            continue
        body_first = 1          # skip the contents page itself
        out = []
        last = body_first
        for p, label, old in entries:
            if label == 'The Eleven Styles':
                label = 'The Twelve Styles'
            i = find_heading(lines, label, max(body_first, last if label != 'The Basics' else body_first))
            if i is None:
                i = find_heading(lines, label, max(body_first, last), loose=True)
            if i is None:
                i = max(old - 1, 0)   # chapter-relative fallback
            out.append(start + i)
            last = i
        nums[key] = out
    return nums


def toc_numbers(info, back):
    """New numbers for the Table of Contents docx entries."""
    d = docx.Document(os.path.join(SRC, 'Jimothy D10 - Table of Contents.docx'))
    starts = {title: info[key][0] for key, name, title in CHAPTERS}
    cur = None
    out = []
    for p in d.paragraphs:
        m = re.match(r'^(.*)\t(\d+)$', p.text)
        if not m:
            continue
        label, old = m.group(1).strip(), int(m.group(2))
        if label in starts or label.startswith('Chapter') or label.startswith('Index'):
            key = [k for k, nm, t in CHAPTERS if t == label]
            cur = key[0] if key else None
            out.append((p, label, starts.get(label, old)))
            continue
        if label in back:
            cur = None
        if cur is None:
            out.append((p, label, back.get(label, old)))
            continue
        start, pdf, n, lines = info[cur]
        lab = 'The Twelve Styles' if label == 'The Eleven Styles' else label
        i = find_heading(lines, lab, 1 if cur not in ('ch1', 'ch5', 'ch6', 'ch10', 'ch11') else 0)
        if i is None:
            old_start = OLD_STARTS.get(cur)
            i = old - old_start if old_start else 0
        out.append((p, lab, start + i))
    return d, out


OLD_STARTS = {}


def read_old_starts():
    r = PdfReader(OLD_BOOK)
    for o in r.outline:
        if isinstance(o, list):
            continue
        for key, name, title in CHAPTERS:
            if o.title == title:
                OLD_STARTS[key] = r.get_destination_page_number(o) + 1 - OFFSET


def make_toc(d, entries, path):
    set_start(d, 4)
    for p, label, num in entries:
        if label == 'The Twelve Styles':
            for r in p.runs:
                if r.text == 'The Eleven Styles':
                    r.text = 'The Twelve Styles'
        set_number(p, num)
    d.save(path)
    return convert(path)


# ---------- outline and links ----------
def old_outline():
    r = PdfReader(OLD_BOOK)
    out = []

    def walk(o, depth, parent):
        for x in o:
            if isinstance(x, list):
                walk(x, depth + 1, out[-1] if out else None)
            else:
                out.append({'title': x.title, 'depth': depth, 'page': r.get_destination_page_number(x) + 1 - OFFSET, 'kids': []})
    walk(r.outline, 0, None)
    return out


def link_rects(pdf_path, page_index, target_of, ncols):
    """Link every contents line on a page: the line ending in a page number links to that page."""
    rects = []
    with pdfplumber.open(pdf_path) as p:
        pg = p.pages[page_index]
        H = float(pg.height); W = float(pg.width)
        words = pg.extract_words(keep_blank_chars=False, use_text_flow=True)
    colw = W / ncols
    lines = {}
    for w in words:
        col = min(int(w['x0'] / colw), ncols - 1)
        key = (col, round(w['top'] / 3))
        lines.setdefault(key, []).append(w)
    keys = sorted(lines, key=lambda k: (k[0], k[1]))
    prev = {}
    for k in keys:
        ws = sorted(lines[k], key=lambda w: w['x0'])
        last = ws[-1]['text']
        m = re.search(r'(\d+)$', last)
        if m and ('..' in last or re.fullmatch(r'\d+', last)):
            num = int(m.group(1))
            tgt = target_of(num)
            x0 = min(w['x0'] for w in ws); x1 = max(w['x1'] for w in ws)
            top = min(w['top'] for w in ws); bot = max(w['bottom'] for w in ws)
            only_dots = len(ws) == 1 and re.fullmatch(r'[\.\s]*\d+', last.replace('…', '.'))
            if (len(ws) == 1 or only_dots) and prev.get(k[0]):
                pw = prev[k[0]]
                top = min(top, pw['top']); x0 = min(x0, pw['x0'])
            if tgt is not None:
                rects.append(((x0, H - bot, x1, H - top), tgt))
            prev[k[0]] = None
        else:
            prev[k[0]] = {'top': min(w['top'] for w in ws), 'x0': min(w['x0'] for w in ws)}
    return rects


def chapter_mentions(pdf_path, chapter_pages):
    """Rects for 'Chapter N' and 'Ch. N' mentions on every page."""
    found = []
    with pdfplumber.open(pdf_path) as p:
        for pi, pg in enumerate(p.pages):
            H = float(pg.height)
            ws = pg.extract_words()
            for a, b in zip(ws, ws[1:]):
                if a['text'] in ('Chapter', '(Chapter', 'Ch.', '(Ch.') and re.match(r'^(\d+)', b['text']):
                    n = int(re.match(r'^(\d+)', b['text']).group(1))
                    if n in chapter_pages and abs(a['top'] - b['top']) < 2:
                        found.append((pi, (a['x0'], H - b['bottom'], b['x1'], H - a['top']), chapter_pages[n]))
    return found


def add_link(writer, page_index, rect, target_index):
    annot = DictionaryObject({
        NameObject('/Type'): NameObject('/Annot'),
        NameObject('/Subtype'): NameObject('/Link'),
        NameObject('/Rect'): RectangleObject(rect),
        NameObject('/Border'): ArrayObject([NumberObject(0), NumberObject(0), NumberObject(0)]),
        NameObject('/Dest'): ArrayObject([writer.pages[target_index].indirect_reference, NameObject('/XYZ'),
                                          NumberObject(0), NumberObject(792), NumberObject(0)]),
    })
    page = writer.pages[page_index]
    if '/Annots' not in page:
        page[NameObject('/Annots')] = ArrayObject()
    page['/Annots'].append(writer._add_object(annot))


# ---------- Lulu placement ----------
import pypdfium2 as pdfium
import numpy as np
LW, LH, BLEED = 630.0, 810.0, 9.0


def content_box(pdf_path, i, scale=0.5):
    doc = pdfium.PdfDocument(pdf_path)
    img = np.asarray(doc[i].render(scale=scale).to_pil().convert('RGB')).astype(int)
    bg = img[2, 2]
    diff = np.abs(img - bg).sum(axis=2) > 40
    cols = np.where(diff.any(axis=0))[0]
    if len(cols) == 0:
        return None, tuple(int(x) for x in bg)
    return (cols[0] / scale, cols[-1] / scale), tuple(int(x) for x in bg)


def lulu_page(writer, src_page, book_no, box, bg, hairlines):
    """Place an 8.5x11 page on the 8.75x11.25 bleed page with a 1 in inside margin."""
    page = PageObject.create_blank_page(width=LW, height=LH)
    right = (book_no + 1) % 2 == 1         # odd Lulu pages are right-hand pages
    x = BLEED
    if box:
        cx0, cx1 = box
        if right:
            lo, hi = BLEED + 72 - cx0, LW - BLEED - 36 - cx1
        else:
            lo, hi = BLEED + 36 - cx0, LW - BLEED - 72 - cx1
        x = min(max(BLEED, lo), hi) if lo <= hi else (lo + hi) / 2
    page.merge_transformed_page(src_page, Transformation().translate(x, BLEED))
    ops = []
    if bg != (255, 255, 255) and min(bg) < 250:
        ops.append(b'q %.4f %.4f %.4f rg 0 0 %.0f %.0f re f Q' % (bg[0] / 255, bg[1] / 255, bg[2] / 255, LW, LH))
    from pypdf.generic import ContentStream
    if ops:
        # background goes under everything: prepend
        cs = page.get_contents()
        data = b'\n'.join(ops) + b'\n' + (cs.get_data() if cs else b'')
        s = ContentStream(None, None); s.set_data(data); page.replace_contents(s)
    if hairlines:
        cs = page.get_contents()
        extra = b''.join(b'\nq %.2f %.2f m %.2f %.2f l .5 w .7 .7 .7 RG S Q' % (lx + x, ly1 + BLEED, lx + x, ly2 + BLEED) for lx, ly1, ly2 in hairlines)
        s = ContentStream(None, None); s.set_data(cs.get_data() + extra); page.replace_contents(s)
    page.trimbox = RectangleObject([BLEED, BLEED, LW - BLEED, LH - BLEED])
    page.bleedbox = RectangleObject([0, 0, LW, LH])
    writer.add_page(page)


def vertical_lines(src_page):
    try:
        c = src_page.get_contents().get_data().decode('latin1')
    except Exception:
        return []
    out = []
    for m in re.finditer(r'([\d.]+) ([\d.]+) m\s+([\d.]+) ([\d.]+) l', c):
        x1, y1, x2, y2 = map(float, m.groups())
        if abs(x1 - x2) < 0.5 and abs(y1 - y2) > 100 and 250 < x1 < 360:
            out.append((x1, y1, y2))
    return out


# ---------- main ----------
def main():
    read_old_starts()
    print('pass 1')
    info = build()
    nums = contents_numbers(info)
    print('pass 2 (contents page numbers)')
    info2 = build(nums)
    if [info2[k][2] for k, _, _ in CHAPTERS] != [info[k][2] for k, _, _ in CHAPTERS]:
        print('page counts moved; one more pass')
        nums = contents_numbers(info2); info2 = build(nums)
    info = info2
    idx_start, _, idx_n, _ = info['index']
    back_start = idx_start + idx_n
    shift = back_start - OLD_BACK_START
    json.dump({k: [info[k][0], info[k][2]] for k in info}, open(os.path.join(OUT, 'pages.json'), 'w'), indent=1)

    # ---- Table of Contents (digital) ----
    d, entries = toc_numbers(info, {})
    after_index = False
    fixed = []
    for p, label, num in entries:
        if label == 'Battle Maps':
            after_index = True
        if after_index:
            old = int(re.search(r'\t(\d+)$', p.text).group(1))
            num = old + shift
        fixed.append((p, label, num))
    toc_pdf = make_toc(d, fixed, os.path.join(WORK, 'toc.docx'))
    assert len(PdfReader(toc_pdf).pages) == 1, 'TOC no longer fits on one page'

    # ---- assemble digital ----
    old = PdfReader(OLD_BOOK)
    w = PdfWriter()
    for i in range(6):                       # cover, inside cover, title, Foreword, Introduction, blank
        w.add_page(old.pages[i])
    w.add_page(PdfReader(toc_pdf).pages[0])  # book page 4
    book = 5
    starts = {}
    for key, name, title in CHAPTERS:
        st, pdf, n, lines = info[key]
        while book < st:
            w.add_blank_page(612, 792); book += 1
        starts[key] = st
        for pg in PdfReader(pdf).pages:
            w.add_page(pg); book += 1
    for i in range(OLD_BACK_START + OFFSET - 1, len(old.pages)):
        w.add_page(old.pages[i])
    total_book = len(w.pages) - OFFSET
    print('digital: %d physical pages, %d book pages' % (len(w.pages), total_book))

    # ---- bookmarks ----
    ol = old_outline()
    chapter_of = {}
    cur = None
    for e in ol:
        if e['depth'] == 0:
            cur = [k for k, nm, t in CHAPTERS if t == e['title']]
            cur = cur[0] if cur else None
        e['ch'] = cur
    parents = {}
    added_dragon = False
    # Chapter 8: heritages under Part 1 and Part 2, from the current heritage list
    HER = json.load(open('/home/claude/terrana-d10-isekai/forge/data.json', encoding='utf-8'))['heritages']
    ol = [e for e in ol if not (e['ch'] == 'ch8' and e['depth'] == 2)]
    for e in ol:
        ch = e['ch']
        if ch == 'ch8' and e['depth'] == 1 and e['title'].startswith('Part '):
            rare = e['title'].startswith('Part 2')
            e['kids8'] = (['Rare Monster Factions'] if rare else ['Monster Factions']) + sorted(h['name'] for h in HER if h['rare'] == rare)
        if e['depth'] == 0:
            if ch:
                pg = starts[ch]
            elif e['page'] >= OLD_BACK_START:
                pg = e['page'] + shift
            else:
                pg = e['page']
        elif ch:
            st, pdf, n, lines = info[ch]
            i = find_heading(lines, e['title'], 1 if ch not in ('ch1', 'ch5', 'ch6', 'ch10', 'ch11') else 0)
            if i is None:
                i = e['page'] - OLD_STARTS[ch]
            pg = st + i
        else:
            pg = e['page'] + shift if e['page'] >= OLD_BACK_START else e['page']
        parent = parents.get(e['depth'] - 1)
        item = w.add_outline_item(e['title'], pg + OFFSET - 1, parent=parent)
        parents[e['depth']] = item
        if e.get('kids8'):
            st8, pdf8, n8, lines8 = info['ch8']
            first = pg - st8
            for nm in e['kids8']:
                i = find_heading(lines8, nm, first) if 'Monster Factions' in nm else None
                if i is None:
                    key = norm(nm)
                    i = next((j for j in range(first, len(lines8)) if lines8[j] and (lines8[j][0] == key or lines8[j][0].startswith(key + ' '))), None)
                if i is not None:
                    w.add_outline_item(nm, st8 + i + OFFSET - 1, parent=item)
        if e['title'] == 'Iron Rain Style' and not added_dragon:
            st, pdf, n, lines = info['ch12']
            i = find_heading(lines, "Dragon's Blade Style", 1)
            item = w.add_outline_item("Dragon's Blade Style", st + i + OFFSET - 1, parent=parent)
            added_dragon = True

    # ---- links ----
    tmp = os.path.join(WORK, 'digital_nolinks.pdf')
    w.write(tmp)
    phys = lambda b: b + OFFSET - 1
    n_links = 0
    for rect, tgt in link_rects(tmp, phys(4), lambda n: phys(n) if 1 <= n <= total_book else None, 3):
        add_link(w, phys(4), rect, tgt); n_links += 1
    for key, name, title in CHAPTERS:
        st, pdf, n, lines = info[key]
        if not any(l == 'in this chapter' for l in lines[0]):
            continue
        ncols = 3 if key == 'ch13' else (2 if key == 'ch4' else 1)
        for rect, tgt in link_rects(tmp, phys(st), lambda n: phys(n) if 1 <= n <= total_book else None, ncols):
            add_link(w, phys(st), rect, tgt); n_links += 1
    chap_pages = {int(re.match(r'ch(\d+)', k).group(1)): phys(info[k][0]) for k, _, _ in CHAPTERS if k.startswith('ch')}
    for pi, rect, tgt in chapter_mentions(tmp, chap_pages):
        if OFFSET + 4 <= pi < phys(back_start) and pi != phys(4):
            add_link(w, pi, rect, tgt); n_links += 1
    print('links', n_links)
    w.page_mode = '/UseOutlines'
    w.write(os.path.join(OUT, 'Jimothy D10 - Core Rulebook (Second Draft).pdf'))

    # ---- print edition ----
    d, entries = toc_numbers(info, {})
    after = False
    for p, label, num in entries:
        pass
    pd = docx.Document(os.path.join(SRC, 'Jimothy D10 - Table of Contents.docx'))
    paras = pd.paragraphs
    pe = []
    for p in paras:
        m = re.match(r'^(.*)\t(\d+)$', p.text)
        if m:
            pe.append(p)
    # reuse the digital numbers for everything up to the index
    num_by_text = {}
    for (p, label, num) in fixed:
        num_by_text.setdefault(p.text.split('\t')[0], []).append(num)
    seen = {}
    printed = []
    for p in pe:
        lab = p.text.split('\t')[0]
        key = 'The Twelve Styles' if lab == 'The Eleven Styles' else lab
        k = seen.get(key, 0); seen[key] = k + 1
        printed.append([p, lab, num_by_text[key][k]])
    b = back_start
    def relabel(p, text):
        p.runs[0].text = text
        for r in p.runs[1:-1]:
            r.text = ''
    plan = {'Battle Maps': b, 'Combat Playmat': b + 18, "Summoner's Sheet": b + 20,
            'Six SumMonz with All Three Forms': b + 20, 'Character Sheets': b + 21,
            "Jimothy's D10 Isekai Character Sheet": b + 21}
    for row in printed:
        p, lab, num = row
        if lab in plan:
            row[2] = plan[lab]
        elif lab == 'Light Versions':
            relabel(p, '5x7 Maps'); row[2] = b
        elif lab == 'Dark Versions':
            relabel(p, '6x8 Maps'); row[2] = b + 6
            nx = copy.deepcopy(p._p); p._p.addnext(nx)
            q = Paragraph(nx, p._parent); relabel(q, '7x9 Maps'); set_number(q, b + 12)
        elif lab in ('Light Version', 'Dark Version'):
            p._p.getparent().remove(p._p); row[2] = None
    for p, lab, num in printed:
        if num is not None:
            if lab == 'The Eleven Styles':
                for r in p.runs:
                    if r.text == 'The Eleven Styles': r.text = 'The Twelve Styles'
            set_number(p, num)
    set_start(pd, 4)
    pd.save(os.path.join(WORK, 'toc_print.docx'))
    toc_print = convert(os.path.join(WORK, 'toc_print.docx'))
    assert len(PdfReader(toc_print).pages) == 1

    oldl = PdfReader(OLD_LULU)
    lw = PdfWriter()
    for i in range(4):                       # title page, Foreword, Introduction (print wording), blank
        lw.add_page(oldl.pages[i])
    tp = PdfReader(toc_print).pages[0]
    box, bg = content_box(toc_print, 0)
    lulu_page(lw, tp, 4, box, bg, [])
    book = 5
    for key, name, title in CHAPTERS:
        st, pdf, n, lines = info[key]
        while book < st:
            pg = PageObject.create_blank_page(width=LW, height=LH)
            pg.trimbox = RectangleObject([BLEED, BLEED, LW - BLEED, LH - BLEED]); pg.bleedbox = RectangleObject([0, 0, LW, LH])
            lw.add_page(pg); book += 1
        r = PdfReader(pdf)
        for i, pg in enumerate(r.pages):
            box, bg = content_box(pdf, i)
            lulu_page(lw, pg, book, box, bg, vertical_lines(pg))
            book += 1
    old_back_lulu = OLD_BACK_START + 1 - 1        # Lulu index of book page 304
    for i in range(old_back_lulu, len(oldl.pages) - 1):
        lw.add_page(oldl.pages[i])
    if len(lw.pages) % 2:
        pass
    # closing blank so the page count stays even
    pg = PageObject.create_blank_page(width=LW, height=LH)
    pg.trimbox = RectangleObject([BLEED, BLEED, LW - BLEED, LH - BLEED]); pg.bleedbox = RectangleObject([0, 0, LW, LH])
    lw.add_page(pg)
    if len(lw.pages) % 2:
        pg = PageObject.create_blank_page(width=LW, height=LH)
        pg.trimbox = RectangleObject([BLEED, BLEED, LW - BLEED, LH - BLEED]); pg.bleedbox = RectangleObject([0, 0, LW, LH])
        lw.add_page(pg)
    lw.write(os.path.join(OUT, 'Jimothy D10 - Core Rulebook Interior Lulu Edit.pdf'))
    print('lulu interior: %d pages' % len(lw.pages))
    json.dump({'digital_pages': len(w.pages), 'book_pages': total_book, 'back_start': back_start,
               'lulu_pages': len(lw.pages)}, open(os.path.join(OUT, 'summary.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
