"""Make the fillable sheet: printer PDF + form fields at the HTML input/dot/box positions.
python3 fill.py printer.pdf boxes.json template_fillable.pdf template_boxes.json out.pdf
Checkbox looks (dot, square, cross) are copied from the template's widgets."""
import json, sys
import pikepdf
from pikepdf import Name, Dictionary, Array, String

src, boxes, tpl, tplboxes, out = sys.argv[1:6]
pdf = pikepdf.open(src)
old = pikepdf.open(tpl)
kind_of = {b['name']: b['kind'] for b in json.load(open(tplboxes))}
look = {}
for a in old.pages[0].Annots:
    par = a.get('/Parent')
    names = []
    node = a
    while node is not None:
        if '/T' in node: names.append(str(node.T))
        node = node.get('/Parent')
    nm = '.'.join(reversed(names))
    k = kind_of.get(nm)
    if k and k != 'text' and k not in look:
        cp = lambda ap: Dictionary({kk: pdf.copy_foreign(vv) for kk, vv in ap.items()})
        look[k] = {'N': cp(a.AP.N), 'D': cp(a.AP.D), 'MK': Dictionary(CA=String(str(a.MK.CA))), 'DA': String(str(a.DA))}
assert set(look) == {'dot', 'box', 'cross'}, look.keys()

tiro = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name('/Times-Roman'), Encoding=Name.WinAnsiEncoding))
zadb = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name('/ZapfDingbats')))
page = pdf.pages[0]
H = float(page.MediaBox[3])
page.Annots = pdf.make_indirect(Array())
roots, nodes = [], {}

def node(path):
    if path in nodes: return nodes[path]
    parent = node(path.rsplit('.', 1)[0]) if '.' in path else None
    n = pdf.make_indirect(Dictionary(T=String(path.rsplit('.', 1)[-1]), Kids=Array()))
    if parent is None: roots.append(n)
    else: n.Parent = parent; parent.Kids.append(n)
    nodes[path] = n
    return n

for b in json.load(open(boxes)):
    x0, x1 = b['x'] * .75, (b['x'] + b['w']) * .75
    y1, y0 = H - b['y'] * .75, H - (b['y'] + b['h']) * .75
    parent = node(b['name'].rsplit('.', 1)[0]) if '.' in b['name'] else None
    w = Dictionary(Type=Name.Annot, Subtype=Name.Widget, Rect=Array([x0, y0, x1, y1]), F=4, P=page.obj,
                   T=String(b['name'].rsplit('.', 1)[-1]), BS=Dictionary(S=Name.S, W=0))
    if b['kind'] == 'text':
        ww, hh = x1 - x0, y1 - y0
        ap = pdf.make_stream(('/Tx BMC\nq\n0 w\n0 0 %.4f %.4f re\nW\nn\nQ\nEMC\n' % (ww, hh)).encode(),
                             BBox=Array([0, 0, ww, hh]), Resources=Dictionary(Font=Dictionary(TiRo=tiro)))
        w.FT = Name.Tx; w.DA = String('0.1 0.06 0.03 rg /TiRo 7.5 Tf'); w.AP = Dictionary(N=ap); w.Ff = 0
    else:
        L = look[b['kind']]
        w.FT = Name.Btn; w.V = Name.Off; w.AS = Name.Off; w.MK = Dictionary(L['MK']); w.DA = L['DA']
        w.AP = Dictionary(N=Dictionary(L['N']), D=Dictionary(L['D']))
    w = pdf.make_indirect(w)
    if parent is None: roots.append(w)
    else: w.Parent = parent; parent.Kids.append(w)
    page.Annots.append(w)

pdf.Root.AcroForm = Dictionary(Fields=Array(roots), NeedAppearances=False, DA=String('0 g /TiRo 7.5 Tf'),
                               DR=Dictionary(Font=Dictionary(TiRo=tiro, ZaDb=zadb)))
pdf.save(out)
print('fields', len(page.Annots))
