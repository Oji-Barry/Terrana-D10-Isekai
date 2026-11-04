"""Build forge/data.json: every character creation option, read from the
Chapter 6 Quick Reference tables, with links to the rulebook pages.

Run after tools/build_rulebook.py (it uses rulebook/toc.json for links):
  python3 tools/build_forge_data.py "<second draft folder>"
"""
import json
import os
import re
import sys

import docx
from docx.table import Table

sys.path.insert(0, os.path.dirname(__file__))
import build_rulebook as rb  # noqa: E402


SPECIALTIES = {
    'Athletics': ['Climbing', 'Running', 'Swimming', 'Jumping', 'Flying', 'Lifting'],
    'Endurance': ['Long Hours', 'Pain', 'Poison', 'Heat and Cold', 'Hunger and Thirst', 'Sickness'],
    'Martial Arts': ['Boxing', 'Kicks', 'Grappling', 'Disarms', 'Pressure Points', 'Brawling'],
    'Melee': ['Swords', 'Axes', 'Polearms', 'Shields', 'Knives', 'Hammers and Maces'],
    'Ranged': ['Bows', 'Guns', 'Thrown Weapons', 'Moving Targets', 'Long Range', 'Trick Shots'],
    'Acrobatics': ['Balance', 'Tumbling', 'Breaking Falls', 'Parkour', 'Contortion', 'Aerial Tricks'],
    'Chicanery': ['Disguises', 'Cons', 'Cheating at Games', 'Dirty Tricks', 'Forgery', 'Smuggling'],
    'Dodge': ['Projectiles', 'Melee Attacks', 'Spells', 'Traps', 'Explosions', 'Grabs'],
    'Sleight of Hand': ['Pickpocketing', 'Palming', 'Card Tricks', 'Lockpicking', 'Disarming Traps', 'Quick Draw'],
    'Stealth': ['Shadows', 'Crowds', 'Silent Movement', 'Tailing', 'Wilderness', 'Breaking In'],
    'Expression': ['Writing', 'Painting', 'Songwriting', 'Speeches', 'Storytelling', 'Teaching'],
    'Performance': ['Singing', 'Instruments', 'Acting', 'Dance', 'Comedy', 'Stage Magic'],
    'Presence': ['Commanding', 'Intimidation', 'Inspiring', 'First Impressions', 'Calming Others', 'Standing Firm'],
    'Persuasion': ['Debate', 'Sales Pitch', 'Charm', 'Pleading', 'Rallying a Crowd', 'Recruiting'],
    'Subterfuge': ['Lying', 'Poker Face', 'Keeping Secrets', 'Misdirection', 'Spin', 'Interrogation'],
    'Commerce': ['Haggling', 'Appraisal', 'Bookkeeping', 'Trade Routes', 'Customer Service', 'Black Markets'],
    'Diplomacy': ['Peace Talks', 'Alliances', 'Hostage Talks', 'Court Politics', 'Guild Politics', 'Legal Disputes'],
    'Etiquette': ['High Society', 'Bedside Manner', 'Hospitality', 'Religious Rites', 'Military Protocol', 'Foreign Customs'],
    'Pilot': ['Ships', 'Wagons and Carts', 'Airships', 'Long Hauls', 'Rough Terrain', 'Chases'],
    'Ride': ['Horses', 'Flying Mounts', 'Beasts of Burden', 'Mounted Combat', 'Long Rides', 'Training Mounts'],
    'Alchemy': ['Healing Potions', 'Antidotes', 'Poisons', 'Herbalism', 'Elements', 'Explosives'],
    'Attunement': ['Holy Relics', 'Weapons', 'Armor', 'Jewelry', 'Quick Bonding', 'Multiple Items'],
    'Circle Magic': ['Scrolls', 'Wards', 'Contracts', 'Summoning', 'Group Rituals', 'Implements'],
    'Implements': ['Wands and Staves', 'Magitech', 'Invention', 'Lab Equipment', 'Enchanted Tools', 'Coding'],
    'Magic': ['Quick Casting', 'Precision', 'Raw Power', 'Defensive Spells', 'Sustained Spells', 'Countering Spells'],
    'Artifacts': ['Identification', 'Ancient Relics', 'Repair', 'Machines', 'Curses', 'Dungeon Loot'],
    'Awareness': ['Sight', 'Hearing', 'Scent', 'Taste', 'Danger', 'Searching'],
    'Crafts': ['Cooking', 'Smithing', 'Woodworking', 'Tailoring', 'Mechanics', 'Jewelcrafting'],
    'Insight': ['Lies', 'Motives', 'Emotions', 'Symptoms', 'Crowd Mood', 'Hidden Loyalties'],
    'Survival': ['Tracking', 'Foraging', 'Shelter', 'Navigation', 'Weather', 'Trapping'],
}

OCCUPATIONS = [
    ('Chef or Cook', 'Crafts (Cooking), Alchemy (Herbalism), Endurance (Long Hours), Awareness (Taste)'),
    ('Nurse or Paramedic', 'Alchemy (Healing Potions), Insight (Symptoms), Endurance (Long Hours), Awareness (Sight)'),
    ('Doctor', 'Alchemy (Antidotes), Insight (Symptoms), Awareness (Searching), Etiquette (Bedside Manner)'),
    ('Police Officer', 'Awareness (Danger), Insight (Lies), Martial Arts (Grappling), Ranged (Guns), Presence (Commanding)'),
    ('Soldier', 'Ranged (Guns), Melee (Knives), Endurance (Pain), Athletics (Running), Etiquette (Military Protocol)'),
    ('Firefighter', 'Athletics (Climbing), Endurance (Heat and Cold), Awareness (Danger)'),
    ('Pro Athlete', 'Athletics (Running), Endurance (Pain), Acrobatics (Balance)'),
    ('Martial Arts Instructor', 'Martial Arts (Kicks), Dodge (Melee Attacks), Acrobatics (Breaking Falls), Expression (Teaching)'),
    ('Dancer', 'Performance (Dance), Acrobatics (Tumbling), Athletics (Jumping)'),
    ('Musician', 'Performance (Instruments), Expression (Songwriting), Presence (First Impressions)'),
    ('Actor', 'Performance (Acting), Subterfuge (Poker Face), Expression (Storytelling), Presence (First Impressions)'),
    ('Stage Magician', 'Performance (Stage Magic), Sleight of Hand (Card Tricks), Subterfuge (Misdirection)'),
    ('Writer or Journalist', 'Expression (Writing), Insight (Motives), Awareness (Searching), Persuasion (Debate)'),
    ('Artist or Designer', 'Expression (Painting), Crafts (Tailoring), Awareness (Sight)'),
    ('Teacher', 'Expression (Teaching), Presence (Calming Others), Insight (Emotions)'),
    ('Salesperson', 'Persuasion (Sales Pitch), Commerce (Customer Service), Chicanery (Cons), Insight (Motives)'),
    ('Business Owner', 'Commerce (Bookkeeping), Diplomacy (Alliances), Persuasion (Recruiting), Presence (Commanding)'),
    ('Bartender or Server', 'Etiquette (Hospitality), Insight (Emotions), Commerce (Customer Service), Persuasion (Charm)'),
    ('Lawyer', 'Diplomacy (Legal Disputes), Persuasion (Debate), Insight (Lies), Subterfuge (Spin)'),
    ('Politician', 'Diplomacy (Court Politics), Persuasion (Rallying a Crowd), Presence (Inspiring), Etiquette (High Society), Subterfuge (Spin)'),
    ('Priest or Clergy', 'Attunement (Holy Relics), Etiquette (Religious Rites), Presence (Calming Others), Insight (Emotions)'),
    ('Scientist', 'Alchemy (Elements), Implements (Lab Equipment), Artifacts (Identification), Awareness (Searching)'),
    ('Engineer or Mechanic', 'Crafts (Mechanics), Implements (Invention), Artifacts (Machines)'),
    ('Programmer', 'Implements (Coding), Artifacts (Machines), Awareness (Searching)'),
    ('Truck or Delivery Driver', 'Pilot (Long Hauls), Endurance (Long Hours), Awareness (Danger)'),
    ('Farmer or Rancher', 'Ride (Beasts of Burden), Survival (Weather), Endurance (Long Hours), Crafts (Woodworking)'),
    ('Hunter or Outdoorsman', 'Ranged (Moving Targets), Survival (Tracking), Stealth (Wilderness), Awareness (Sight)'),
    ('Gamer', 'Awareness (Searching), Insight (Motives), Chicanery (Cheating at Games)'),
    ('Thief or Con Artist', 'Sleight of Hand (Pickpocketing), Stealth (Shadows), Chicanery (Disguises), Subterfuge (Lying)'),
]


def table_rows(t):
    rows = []
    for r in t.rows:
        cells, seen = [], None
        for c in r.cells:
            if c._tc is seen:
                continue
            seen = c._tc
            cells.append(c.text.strip())
        rows.append(cells)
    return rows


def quick_reference(path):
    """Return {heading: [rows...]} for every table under Quick Reference."""
    doc = docx.Document(path)
    out, heading, started = {}, None, False
    for b in rb.blocks(doc):
        if isinstance(b, Table):
            if started and heading:
                rows = table_rows(b)
                out.setdefault(heading, [])
                # tables split across pages repeat their header row
                body = [r for r in rows[1:] if r != rows[0]]
                out[heading].extend(body)
            continue
        txt = b.text.strip()
        if rb.style_name(b) == 'Heading 2' and txt == 'Quick Reference':
            started = True
        elif started and rb.style_name(b) == 'Heading 3':
            heading = txt
    return out


def find_links(toc):
    """Map lower-case names to rulebook URLs, from rulebook/toc.json."""
    links = {}

    def walk(nodes, slug):
        for n in nodes:
            if n.get('id'):
                key = re.sub(r'\s*\(.*\)$', '', n['s']).strip().lower()
                key = re.sub(r'^[ab]\.\s+', '', key)
                links.setdefault((slug, key), '../rulebook/%s.html#%s' % (slug, n['id']))
            walk(n.get('c', []), slug)

    for slug, nodes in toc.items():
        walk(nodes, slug)
    return links


def link(links, slug, name):
    key = name.strip().lower()
    return links.get((slug, key)) or links.get((slug, re.sub(r'\s+style$', '', key))) or (
        '../rulebook/%s.html' % slug)


def parse_cost(text):
    """Best-effort reading of a Merit/Flaw cost. Always keeps the original text."""
    t = text.strip()
    c = {'text': t}
    m = re.match(r'^(\d+) per dot, max (\d+)$', t)
    if m:
        c.update(kind='per_dot', per=int(m.group(1)), max=int(m.group(2)))
        return c
    m = re.match(r'^(\d+) per Gift, max (\d+) Gifts$', t)
    if m:
        c.update(kind='per_dot', per=int(m.group(1)), max=int(m.group(2)), unit='Gift')
        return c
    m = re.match(r'^(\d+)(, heavy)?$', t)
    if m:
        c.update(kind='fixed', cost=int(m.group(1)))
        return c
    m = re.match(r'^(\d+) for 1 box, (\d+) for 2$', t)
    if m:
        c.update(kind='levels', levels=[int(m.group(1)), int(m.group(2))], unit='box')
        return c
    m = re.match(r'^(\d+), or (\d+) for a greater eye$', t)
    if m:
        c.update(kind='choice', options=[int(m.group(1)), int(m.group(2))])
        return c
    m = re.match(r'^(\d+), (\d+), or (\d+) \(1 to 3 dots\)$', t)
    if m:
        c.update(kind='levels', levels=[int(m.group(i)) for i in (1, 2, 3)])
        return c
    m = re.match(r'^(\d+) to (\d+) \(1 to (\d+) dots\)$', t)
    if m:
        lo, hi, n = int(m.group(1)), int(m.group(2)), int(m.group(3))
        c.update(kind='levels', levels=list(range(lo, lo + n)) if hi - lo + 1 == n else [lo + i for i in range(n)])
        return c
    m = re.match(r'^(\d+) for a hand or foot, (\d+) for an arm or leg$', t)
    if m:
        c.update(kind='choice', options=[int(m.group(1)), int(m.group(2))])
        return c
    m = re.match(r'^(\d+) to (\d+), set with the Storyteller$', t)
    if m:
        c.update(kind='range', min=int(m.group(1)), max=int(m.group(2)))
        return c
    m = re.match(r'^(\d+) to (\d+) points back, 1 to 3 dots$', t)
    if m:
        c.update(kind='range', min=int(m.group(1)), max=int(m.group(2)))
        return c
    c['kind'] = 'storyteller'
    return c


def split_names(s):
    return [x.strip() for x in re.split(r',| or ', s) if x.strip()]


def main(src):
    ch6 = os.path.join(src, 'Jimothy D10 - Chapter 6 - Character Creation Overview.docx')
    qr = quick_reference(ch6)
    with open('rulebook/toc.json', encoding='utf-8') as fh:
        links = find_links(json.load(fh))

    data = {'source': 'Chapter 6 Quick Reference, second draft'}

    data['attributes'] = {
        'Physical': ['Strength', 'Dexterity', 'Fortitude'],
        'Social': ['Charisma', 'Manipulation', 'Composure'],
        'Mental': ['Intelligence', 'Perception', 'Wisdom'],
    }
    data['columns'] = {'Affinity': {'dots': 6, 'style_or_knowledge': 7},
                       'Standard': {'dots': 5, 'style_or_knowledge': 5},
                       'Aversion': {'dots': 4, 'style_or_knowledge': 3}}

    # Abilities, by group
    groups = ['Warrior', 'Rogue', 'Troubadour', 'Noble', 'Mage', 'Sage']
    data['abilities'] = {}
    for g in groups:
        data['abilities'][g] = [{'name': r[0], 'used_for': r[1]} for r in qr.get(g, [])]

    # Specialty choices for each ability (Other lets players write their own)
    data['specialties'] = SPECIALTIES
    names = {a['name'] for g in data['abilities'].values() for a in g}
    assert set(SPECIALTIES) == names, set(SPECIALTIES) ^ names

    # Past Life Occupations: each PL ability with the specialty it starts with
    data['occupations'] = []
    for job, picks in OCCUPATIONS:
        pl = []
        for p in picks.split(', '):
            ab, sp = re.match(r'^(.+) \((.+)\)$', p).groups()
            assert sp in SPECIALTIES[ab], (job, ab, sp)
            pl.append({'ability': ab, 'specialty': sp})
        assert 3 <= len(pl) <= 5, job
        data['occupations'].append({'name': job, 'pl': pl})

    # Tropes
    tropes = []
    for h, rows in qr.items():
        if h.endswith(' Tropes'):
            for r in rows:
                tropes.append({'name': r[0], 'group': h.replace(' Tropes', ''), 'boon': r[1], 'bane': r[2],
                               'link': link(links, 'ch7', r[0])})
    data['tropes'] = tropes

    # Scales and Driving Factors
    scales = []
    for r in qr.get('The Seven Scales and Driving Factors', []):
        virtue, vice = [x.strip() for x in r[0].split('/')]
        scales.append({'name': r[0], 'virtue': virtue, 'vice': vice, 'tension': r[1],
                       'virtue_drives': split_names(r[2]), 'vice_drives': split_names(r[3]),
                       'link': link(links, 'ch7', r[0])})
    data['scales'] = scales

    # Step 3: a Position, then one fighting word (the same list for every Position)
    data['roles'] = {
        'positions': ['Frontline', 'Midline', 'Backline'],
        'styles': sorted([
            'Archer', 'Assassin', 'Bard', 'Berserker', 'Brawler', 'Bruiser', 'Caster', 'Commander',
            'Controller', 'Defender', 'Duelist', 'Enchanter', 'Fighter', 'Grappler', 'Guardian',
            'Gunner', 'Healer', 'Hunter', 'Mage', 'Medic', 'Monk', 'Rogue', 'Saboteur', 'Scout',
            'Skirmisher', 'Sniper', 'Striker', 'Summoner', 'Support', 'Tactician', 'Tank',
            'Trapper', 'Vanguard', 'Warden',
        ]),
    }

    # Step 12: how many Freebie Points, set with the Storyteller
    data['freebie_presets'] = [
        {'name': 'Newb', 'points': 7, 'note': 'The standard starting character.'},
        {'name': 'Veteran', 'points': 14, 'note': 'Double the points. Check with your Storyteller.'},
        {'name': 'Legend', 'points': 28, 'note': 'Double again. Check with your Storyteller.'},
    ]

    # Heritages
    heritages = []
    for h, rare in (('Common Heritages', False), ('Rare Heritages', True)):
        for r in qr.get(h, []):
            heritages.append({
                'name': r[0], 'rare': rare,
                'innate_attribute': r[1], 'innate_flaw': r[2], 'attribute_flaw': r[3],
                'heritage_merits': split_names(r[4]), 'heritage_magic': r[5],
                'creation_allowed': r[0] != 'Incorporeal Undead',
                'link': link(links, 'ch8', r[0]),
            })
    data['heritages'] = heritages

    # Merits, Flaws, Special Powers, Enhancements
    merits, flaws = [], []
    for h, rows in qr.items():
        if h.endswith(' Merits'):
            for r in rows:
                merits.append({'name': r[0], 'group': h.replace(' Merits', ''), 'cost': parse_cost(r[1]),
                               'link': link(links, 'ch9', r[0])})
        elif h.endswith(' Flaws'):
            for r in rows:
                flaws.append({'name': r[0], 'group': h.replace(' Flaws', ''), 'points': parse_cost(r[1]),
                              'link': link(links, 'ch9', r[0])})
    for r in qr.get('The Magic Eyes', []):
        merits.append({'name': 'Magic Eye: ' + r[0], 'group': 'Magic Eyes', 'cost': parse_cost(r[1]),
                       'link': link(links, 'ch9', r[0])})
    for r in qr.get('Special Powers', []):
        nm = r[0]
        if nm.endswith('(Flaw)'):
            flaws.append({'name': nm.replace(' (Flaw)', ''), 'group': 'Special Powers', 'points': parse_cost(r[1]),
                          'link': link(links, 'ch9', nm.replace(' (Flaw)', ''))})
        else:
            merits.append({'name': nm, 'group': 'Special Powers', 'cost': parse_cost(r[1]),
                           'link': link(links, 'ch9', nm)})
    for r in qr.get('Enhancements', []):
        merits.append({'name': r[0], 'group': 'Arcane Enhancements', 'cost': parse_cost(r[1]),
                       'heavy': 'heavy' in r[1], 'link': link(links, 'ch9', r[0])})
    data['merits'] = [m for m in merits if m['name'] != 'Magic Eye']  # the eyes are listed one by one
    data['flaws'] = flaws

    data['backgrounds'] = [{'name': r[0], 'what': r[1], 'link': link(links, 'ch10', r[0])}
                           for r in qr.get('Backgrounds', [])]

    data['styles'] = [{'name': r[0], 'weapons': r[1], 'primary': r[2], 'secondary': r[3],
                       'link': link(links, 'ch12', r[0])} for r in qr.get('Combat Styles', [])]

    know = []
    for r in qr.get('Magical Knowledges', []):
        nm = r[0]
        if nm == 'Heritage Magic':
            continue  # comes from Step 4
        slug_name = nm + ' Magic' if r[1] == 'Casting school' else nm
        if nm == 'Circle Magic':
            slug_name = 'Part Three: Circle Magic'
        know.append({'name': nm, 'kind': r[1], 'extra_mana_dice': r[2], 'focus': r[3],
                     'link': link(links, 'ch13', slug_name)})
    data['knowledges'] = know

    data['freebies'] = {'points': 7, 'costs': {'Attribute': 3, 'Ability': 2, 'Combat Style': 4,
                                               'Magical Knowledge': 4, 'Background': 1, 'Mana': 7}}
    data['stats'] = [{'name': r[0], 'start': r[1], 'range': r[2], 'used_for': r[3], 'gained': r[4]}
                     for r in qr.get('Willpower, Fate, Sanity, and Mana', [])]

    os.makedirs('forge', exist_ok=True)
    with open('forge/data.json', 'w', encoding='utf-8') as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    print('wrote forge/data.json')
    for k in ('tropes', 'scales', 'heritages', 'merits', 'flaws', 'backgrounds', 'styles', 'knowledges'):
        print(' ', k, len(data[k]))
    print('  abilities', sum(len(v) for v in data['abilities'].values()))


if __name__ == '__main__':
    main(sys.argv[1])
