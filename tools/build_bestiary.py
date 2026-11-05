"""Chapter 15 Bestiary -> combat/bestiary.json for the combat room's NPC picker.
Run after build_rulebook.py: python3 tools/build_bestiary.py"""
import html, json, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'rulebook', 'ch15.html'), encoding='utf-8').read()
body = src[src.find('<h2'):]


def text(s):
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()



# Default sprite for each creature: DawnLike sheet:row:col. The Storyteller can pick another in the combat room.
SPRITES = {
 'Slime': 'Slime:3:0', 'Water Slime': 'Slime:1:0', 'Acid Slime': 'Slime:4:0', 'Poison Slime': 'Slime:1:2', 'Magma Slime': 'Slime:3:2', 'Metal Slime': 'Slime:4:1', 'Great Slime': 'Slime:2:2', 'Slime Swarm': 'Slime:0:3',
 'Giant Rat': 'Rodent:2:2', 'Horned Rabbit': 'Misc:2:0', 'Acid Wolf': 'Dog:3:1', 'Assault Dog': 'Dog:0:1', 'Pax Coyote': 'Dog:2:0', 'Cave Crawler': 'Pest:2:2', 'Dire Boar': 'Quadraped:0:4', 'Giant Spider': 'Pest:4:1',
 'Hellhound': 'Dog:5:0', 'Forest Bear': 'Quadraped:3:3', 'Rock Turtle': 'Reptile:11:0', 'Thunderbird': 'Avian:9:3', 'Griffon': 'Avian:9:0', 'Manticore': 'Cat:0:4', 'Basilisk': 'Reptile:8:2', 'Terminate Boa': 'Reptile:4:4',
 'Chimera': 'Misc:4:0', 'Behemoth': 'Quadraped:10:0',
 'Mandrake': 'Plant:6:1', 'Myconid Scout': 'Plant:7:0', 'Carnivorous Vine': 'Plant:6:0', 'Treant': 'Plant:0:0', 'Spore Mother': 'Plant:0:3',
 'Kobold Scout': 'Humanoid:19:0', 'Kobold Packmaster': 'Humanoid:19:2', 'Orc Warrior': 'Player:12:0', 'Orc Shaman': 'Player:12:6', 'Orc Warlord': 'Player:12:4', 'Lizardman Warrior': 'Demon:0:0', 'Lizardman Shaman': 'Demon:0:2',
 'Bugfolk Drone': 'Demon:2:1', 'Mantis Blade': 'Demon:2:4', 'Hive Queen': 'Demon:2:5',
 'Goblin': 'Player:14:0', 'Goblin Tinkerer': 'Player:14:2', 'Ogre': 'Humanoid:14:0', 'Troll': 'Humanoid:21:0', 'Minotaur': 'Demon:0:3',
 'Automaton Servitor': 'Elemental:1:1', 'Living Armor': 'Humanoid:4:0', 'Mud Golem': 'Elemental:1:0', 'Clockwork Sentinel': 'Elemental:0:4', 'Automaton Duelist': 'Elemental:1:3', 'Stone Golem': 'Elemental:0:6',
 'Iron Golem': 'Humanoid:0:6', 'War Automaton': 'Elemental:0:0', 'Mana Construct': 'Elemental:1:4',
 'Skeleton': 'Undead:2:0', 'Zombie': 'Undead:0:1', 'Ghoul': 'Undead:0:6', 'Ghost': 'Undead:4:0', 'Wraith': 'Undead:5:0', 'Dullahan': 'Undead:3:3', 'Death Knight': 'Undead:3:0', 'Vampire': 'Undead:3:1',
 'Vampire Lord': 'Undead:3:2', 'Vampire Queen': 'Undead:2:1', 'Lich': 'Undead:2:7', 'Bone Dragon': 'Undead:6:0',
 'Fire Drake': 'Reptile:3:0', 'Frost Drake': 'Reptile:3:4', 'Wyvern': 'Reptile:1:2', 'Earth Dragon': 'Reptile:2:4', 'Red Wyrm': 'Reptile:3:3', 'Blue Wyrm': 'Reptile:1:7', 'Storm Wyrm': 'Reptile:3:5',
 'Dark Dragon': 'Reptile:2:1', 'Elder Dragon': 'Reptile:2:7', 'Ancient Dragon': 'Reptile:2:3',
 'Grindylow': 'Aquatic:4:0', 'Kappa': 'Aquatic:4:1', 'Funayurei': 'Undead:4:1', 'Deep Raider': 'Aquatic:3:2', 'Giant Crab': 'Aquatic:0:5', 'Kelpie': 'Quadraped:4:2', 'Siren': 'Humanoid:18:0',
 'Sea Serpent': 'Aquatic:2:0', 'Umibozu': 'Undead:8:1', 'Kraken': 'Aquatic:0:7', 'Leviathan': 'Aquatic:1:3',
 'Pixie': 'Humanoid:3:0', "Will-o'-Wisp": 'Elemental:2:0', 'Dream Stag': 'Quadraped:1:6', 'Kitsune Trickster': 'Dog:0:3', 'Nightmare Imp': 'Demon:4:1', 'Redcap': 'Player:13:0', 'Bogeyman': 'Undead:7:1', 'Hag of the Seeming': 'Humanoid:23:0',
 'Voidling Mite': 'Pest:0:1', 'Voidling Stalker': 'Elemental:2:3', 'Void Maw': 'Elemental:5:2', 'Voidling Horror': 'Demon:1:6', 'Void Leviathan': 'Aquatic:2:2', 'Void Kaiju': 'Demon:1:3', 'Giant Void Kaiju': 'Demon:1:0',
 'Bandit': 'Humanoid:7:0', 'Thug': 'Humanoid:0:0', 'City Guard': 'Humanoid:4:1', 'Mercenary': 'Humanoid:0:4', 'Veteran Delver': 'Humanoid:5:0', 'Knight': 'Humanoid:4:3', 'Battle Mage': 'Humanoid:10:1',
 'Assassin': 'Humanoid:2:6', 'Necromancer': 'Humanoid:17:0', 'Sword Saint': 'Humanoid:12:1',
 'Empress Kishirika Kishirisu': 'Humanoid:6:5', 'Badigadi, the Fighting God': 'Demon:1:4', 'Atoferatofe Ryback': 'Demon:6:0', "Atofe's Imperial Guard": 'Undead:3:0', 'Necross Lacross': 'Undead:2:6',
 'The Earth God': 'Elemental:3:3', 'Beethove Tovetha': 'Demon:7:1', 'Raja Iblis Baglahagla': 'Demon:1:1', 'Vita, the Abyssal King': 'Demon:1:6', 'Lynebyne, the Stone King': 'Elemental:0:6',
 'Samedynomedy, Demon King of Light': 'Humanoid:3:5', 'Patorsetor, the Enchantress Demon King': 'Humanoid:15:2', 'Qeblaqabla, the Evil Demon King': 'Demon:1:2',
 'Warchief Gruk Ironmaw': 'Player:14:7', 'The Grand Beastmaster': 'Player:13:1', 'Asterion of the Maze': 'Demon:0:3', 'The Chrono-Goliath': 'Elemental:0:4', 'Skyrend, the Storm Alpha': 'Avian:9:3',
 'The Kraken Vanguard': 'Aquatic:3:1', 'The Iron Juggernaut': 'Elemental:1:1', 'The Doppler Matriarch': 'Demon:6:1', 'Mother Maelis, the Siren Matron': 'Humanoid:18:2', 'Cindermaw, the Magma Wyrm': 'Reptile:3:1',
 'The Rune Sentinel': 'Elemental:1:3', 'The Dullahan Overseer': 'Undead:3:3', 'Conductor Kessler': 'Undead:2:5', 'Warden Arcanum': 'Elemental:1:4', 'The Crystal Basilisk': 'Reptile:8:0', 'The Rift Stalker': 'Elemental:2:4',
 'The Monk of a Thousand Steps': 'Humanoid:14:2', 'The Devil Prince Defiler': 'Demon:1:7', 'Vaelthrax': 'Reptile:0:4',
 'Sky Pirate': 'Humanoid:9:3', 'Sky Pirate Captain': 'Humanoid:9:4', 'Asteroid Burrower': 'Pest:3:0', 'Nebula Wraith': 'Undead:4:2', 'Nyxhollow Swarm': 'Pest:0:0', 'Star Whale': 'Aquatic:1:3',
}

out, section = [], ''
for m in re.finditer(r'<h2[^>]*>(.*?)</h2>|<div class="entry">(.*?)</div>\s*(?=<div class="entry">|<h2|<h3|</section|</main|$)', body, re.S):
    if m.group(1) is not None:
        section = text(m.group(1)); continue
    e = m.group(2)
    nm = re.search(r'class="entry-name" id="([^"]+)">(.*?)</div>', e)
    if not nm: continue
    c = {'id': nm.group(1), 'name': text(nm.group(2)), 'section': section}
    tags = re.search(r'<div class="stats tags">(.*?)</div>', e, re.S)
    if tags:
        t = [text(x) for x in re.findall(r'<span>(.*?)</span>', tags.group(1))]
        if t and t[0].startswith('Rank'): c['rank'] = t[0][5:].strip(); t = t[1:]
        c['tags'] = t
        if len(t) >= 3: c['type'], c['size'], c['elements'] = t[0], t[1], t[2]
    stats = ' | '.join(text(x) for x in re.findall(r'<div class="stats">(.*?)</div>', e, re.S))
    def num(label):
        mm = re.search(label + r'\s+(\d+)', stats)
        return int(mm.group(1)) if mm else None
    for k, lab in (('attack', 'Attack'), ('defense', 'Defense'), ('damage', 'Damage'), ('move', 'Move'), ('bdt', 'BDT'), ('mana', 'Mana'), ('mt', 'M/T')):
        v = num(lab)
        if v is not None: c[k] = v
    hm = re.search(r'Health\s+(\d+)\s*/\s*(\d+)\s*/\s*(\d+)', stats)
    if hm: c['health'] = {'b': int(hm.group(1)), 'l': int(hm.group(2)), 'a': int(hm.group(3))}
    c['abilities'] = []
    for p in re.findall(r'<p>(.*?)</p>', e, re.S):
        for part in re.split(r'(?=<strong>)', p):
            sm = re.match(r'<strong>(.*?)</strong>(.*)', part, re.S)
            if not sm: continue
            k, v = text(sm.group(1)).rstrip(':').strip(), text(sm.group(2))
            if k in ('Found', 'Loot', 'Trait'): c[k.lower()] = (c.get(k.lower(), '') + ' ' + v).strip()
            else: c['abilities'].append({'name': k, 'text': v})
    if c['name'] in SPRITES: c['sprite'] = SPRITES[c['name']]
    out.append(c)
json.dump(out, open(os.path.join(ROOT, 'combat', 'bestiary.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(out), 'creatures;', sum(1 for c in out if 'sprite' not in c), 'without sprites;', sum(1 for c in out if 'attack' not in c), 'without stats')
