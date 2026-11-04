"""Rebuild the Lulu wraparound cover for a new page count.

The back and front stay exactly as they were; only the spine changes width
(Lulu: spine inches = interior pages / 444 + 0.06).
  python3 cover.py <interior page count>
"""
import sys
import pikepdf
from pikepdf import Name

OLD = '/mnt/user-data/uploads/James New Game Modes/D10 Isekai/Books/Jimothy D10 - Core Rulebook Cover Lulu Edit.pdf'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'out/Jimothy D10 - Core Rulebook Cover Lulu Edit.pdf'
pages = int(sys.argv[1])
OLD_PAGES = 332

pdf = pikepdf.open(OLD)
pg = pdf.pages[0]
W, H = float(pg.MediaBox[2]), float(pg.MediaBox[3])
side = 9 + 612                      # bleed + trim width of the back (and of the front)
old_spine = W - 2 * side
assert abs(old_spine - (OLD_PAGES / 444 + 0.06) * 72) < 0.5, old_spine
new_spine = (pages / 444 + 0.06) * 72
NW = 2 * side + new_spine
form = pg.as_form_xobject()
out = pikepdf.new()
page = out.add_blank_page(page_size=(NW, H))
fx = out.copy_foreign(form)
page.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(F=fx))
sx = new_spine / old_spine
ops = (
    'q 0 0 %.4f %.4f re W n /F Do Q\n' % (side, H) +
    'q %.4f 0 %.4f %.4f re W n %.6f 0 0 1 %.4f 0 cm /F Do Q\n' % (side, new_spine, H, sx, side - side * sx) +
    'q %.4f 0 %.4f %.4f re W n 1 0 0 1 %.4f 0 cm /F Do Q\n' % (side + new_spine, side, H, new_spine - old_spine)
)
page.Contents = out.make_stream(ops.encode())
out.save(OUT)
print('cover %.4f x %.4f in, spine %.4f in' % (NW / 72, H / 72, new_spine / 72))
