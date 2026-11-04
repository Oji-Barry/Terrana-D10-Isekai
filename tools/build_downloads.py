"""Write downloads/index.html from the files in downloads/files.
  python3 tools/build_downloads.py
"""
import os
from html import escape
from urllib.parse import quote

FILES = 'downloads/files'
GROUPS = [
    ('The Rulebook', 'The whole second draft as one PDF, with bookmarks and links. The battle maps, playmat, and sheets are in the back.', [
        ('Terrana Core Rulebook (Second Draft).pdf', 'Core Rulebook (Second Draft)', 'Digital edition'),
    ]),
    ('Character Sheet', 'The Fillable version types right into the PDF. The Printer version is for pencil and paper. Characters made in the Forge also have a filled-in sheet under My Characters.', [
        ('Terrana Character Sheet v9.7 Fillable.pdf', 'Character Sheet v9.7', 'Fillable'),
        ('Terrana Character Sheet v9.7 Printer.pdf', 'Character Sheet v9.7', 'Printer'),
    ]),
    ("Summoner's Sheet", 'Six SumMonz cards per page, each with all four forms and their techniques.', [
        ("Terrana Summoner's Sheet v1.2 Fillable.pdf", "Summoner's Sheet v1.2", 'Fillable'),
        ("Terrana Summoner's Sheet v1.2 Printer.pdf", "Summoner's Sheet v1.2", 'Printer'),
    ]),
    ('Combat Playmat', 'Track health, mana, conditions, and your loadout during a fight. The printer versions are sized for 18 mm beads.', [
        ('Terrana Combat Playmat v6 Online Fillable.pdf', 'Combat Playmat v6', 'Online, fillable'),
        ('Terrana Combat Playmat v5 Printer Light.pdf', 'Combat Playmat v5', 'Printer, light'),
        ('Terrana Combat Playmat v5 Printer Dark.pdf', 'Combat Playmat v5', 'Printer, dark'),
    ]),
]


def size(n):
    return '%.1f MB' % (n / 1048576) if n >= 1048576 else '%d KB' % round(n / 1024)


rows = []
for title, blurb, items in GROUPS:
    li = []
    for fn, name, kind in items:
        p = os.path.join(FILES, fn)
        assert os.path.exists(p), p
        li.append('<li class="dl-row"><span class="dl-name"><strong>%s</strong><span class="dl-kind">%s, PDF, %s</span></span>'
                  '<a class="act small primary" href="files/%s" download>Download</a></li>' % (escape(name), escape(kind), size(os.path.getsize(p)), quote(fn)))
    rows.append('<section class="panel win">\n  <h2>%s</h2>\n  <p>%s</p>\n  <ul class="dl-list">%s</ul>\n</section>' % (escape(title), escape(blurb), ''.join(li)))

page = '''<!doctype html>
<html lang="en" data-root="../">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Downloads | Jimothy's D10 Isekai JRPG</title>
<link rel="stylesheet" href="../assets/site.css">
<link rel="icon" href="../assets/icons/d10.svg" type="image/svg+xml">
</head>
<body data-page="downloads" data-address="www.terrana.ccn/downloads/">
<div class="page">
  <div id="site-top"></div>
  <main class="content narrow">
    <section class="panel win">
      <h1>Downloads</h1>
      <p class="center">The rulebook, sheets, and playmat, free to download and print.</p>
    </section>
%s
  </main>
  <div id="site-bottom"></div>
</div>
<script src="../assets/site.js"></script>
<script src="../vendor/supabase-2.118.0.js"></script>
<script src="../assets/auth.js"></script>
</body>
</html>
''' % '\n'.join(rows)
open('downloads/index.html', 'w', encoding='utf-8').write(page)
print('wrote downloads/index.html')
