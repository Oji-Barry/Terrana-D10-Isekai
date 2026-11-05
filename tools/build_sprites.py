"""Index the DawnLike character sheets (16x16, two animation frames: Name0.png and Name1.png)
into assets/sprites/sprites.json for the combat sprite picker.
DawnLike by DragonDePlatino, palette by DawnBringer, CC BY-SA 3.0."""
import json, os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'assets', 'sprites', 'dawnlike')
NICE = {'Quadraped': 'Beasts', 'Player': 'Heroes', 'Humanoid': 'People', 'Pest': 'Bugs', 'Misc': 'Odd Creatures', 'Reptile': 'Reptiles and Dragons',
        'Undead': 'Undead', 'Demon': 'Demons', 'Elemental': 'Elementals and Constructs', 'Slime': 'Slimes', 'Plant': 'Plants', 'Aquatic': 'Sea Life',
        'Avian': 'Birds', 'Cat': 'Cats', 'Dog': 'Dogs and Wolves', 'Rodent': 'Rodents'}
out = {'sheets': []}
for f in sorted(os.listdir(D)):
    if not f.endswith('0.png'): continue
    name = f[:-5]
    im = Image.open(os.path.join(D, f)).convert('RGBA')
    w, h = im.size
    cells = []
    for r in range(h // 16):
        for c in range(w // 16):
            if name == 'Reptile' and (r >= 13 or (r, c) == (12, 3)): continue  # the artist's note, and Platino (hidden)
            if im.crop((c * 16, r * 16, c * 16 + 16, r * 16 + 16)).getbbox(): cells.append([r, c])
    out['sheets'].append({'id': name, 'label': NICE.get(name, name), 'cols': w // 16, 'rows': h // 16, 'h': h / 16, 'cells': cells})
out['sheets'].sort(key=lambda s: ['Player', 'Humanoid'].index(s['id']) if s['id'] in ('Player', 'Humanoid') else 9)
json.dump(out, open(os.path.join(ROOT, 'assets', 'sprites', 'sprites.json'), 'w'), separators=(',', ':'))
print(sum(len(s['cells']) for s in out['sheets']), 'sprites')
