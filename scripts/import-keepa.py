"""Importa o CSV de Tracking Overview do Keepa para o radar.

Uso:
    python scripts/import-keepa.py [caminho-do-csv]

Gera:
    config/keepa-wishlist.yaml  — overrides de preço/formato + obras novas
    config/keepa-queries.yaml   — consultas de autor para as obras novas

O CSV não traz autor. As regras abaixo cobrem as séries conhecidas; o que não
casar fica com `enabled: false` e `notes: "Keepa: revisar autor"` para revisão.
"""
import csv
import os
import re
import sys
import unicodedata
from datetime import date

import yaml

sys.stdout.reconfigure(encoding="utf-8")

DEFAULT_CSV = r"C:\Users\Bellussi\Downloads\KeepaExport-2026-11-09-TrackingOverview.csv"
csv_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CSV
repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
config_dir = os.path.join(repo_root, "config")

def norm(value):
    value = unicodedata.normalize("NFKD", value or "")
    value = value.encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def base_title(value):
    value = re.sub(r":\s*(book\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|\d+)(\s*-\s*\d+)?\s*$", "", value, flags=re.I)
    value = re.sub(r":\s*\d+\s*-\s*\d+\s*$", "", value)
    value = re.sub(r":\s*\d+\s*$", "", value)
    return value.strip()


def parse_price(value):
    if not value:
        return None
    match = re.search(r"R\$\s*([\d.,]+)", value)
    if not match:
        return None
    raw = match.group(1)
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}\.\d{2}", raw):
        pass
    else:
        raw = raw.replace(".", "")
    try:
        return float(raw)
    except ValueError:
        return None


def slug(value):
    return re.sub(r"[^a-z0-9]+", "-", norm(value)).strip("-")


with open(os.path.join(config_dir, "watchlist.yaml"), encoding="utf-8") as f:
    existing = yaml.safe_load(f)["works"]
def strip_the(value):
    return value[4:] if value.startswith("the ") else value


existing_by_title = {}
for work in existing:
    for candidate in [work["title"]] + (work.get("aliases") or []):
        key = norm(candidate)
        existing_by_title.setdefault(key, work)
        existing_by_title.setdefault(strip_the(key), work)
existing_by_key = {work["key"]: work for work in existing}


def find_existing(title):
    normalized = norm(title)
    variants = {normalized, strip_the(normalized)}
    for variant in variants:
        if variant in existing_by_title:
            return existing_by_title[variant]
    for variant in variants:
        for key, work in existing_by_title.items():
            if len(key) >= 4 and variant.startswith(key + " "):
                return work
    for variant in variants:
        for key, work in existing_by_title.items():
            if len(key) >= 4 and (": " + key) in (": " + variant):
                return work
    return None


# (regex no título normalizado, autor, série, volume, formato)
RULES = [
    # Precedência: edições específicas e sets
    (r"^assassin s apprentice the illustrated edition\b", "Robin Hobb", "The Farseer Trilogy", 1, "hardcover"),
    (r"^royal assassin the illustrated edition\b", "Robin Hobb", "The Farseer Trilogy", 2, "hardcover"),
    (r"^assassin s quest the illustrated edition\b", "Robin Hobb", "The Farseer Trilogy", 3, "hardcover"),
    (r"^mistborn the final empire\b", "Brandon Sanderson", "Mistborn", 1, "paperback"),
    (r"^the well of ascension\b", "Brandon Sanderson", "Mistborn", 2, "paperback"),
    (r"^the hero of ages\b", "Brandon Sanderson", "Mistborn", 3, "paperback"),
    (r"^gardens of the moon\b", "Steven Erikson", "Malazan Book of the Fallen", 1, "paperback"),
    (r"^deadhouse gates\b", "Steven Erikson", "Malazan Book of the Fallen", 2, "paperback"),
    (r"^sword citadel\b", "Gene Wolfe", "The Book of the New Sun", 1, "paperback"),
    (r"^shadow claw\b", "Gene Wolfe", "The Book of the New Sun", 1, "paperback"),
    (r"^katabasis\b", "R. F. Kuang", "", 1, "hardcover"),
    (r"^the lord of the rings\b", "J.R.R. Tolkien", "The Lord of the Rings", 1, "hardcover"),
    (r"^the tolkien treasury\b", "J.R.R. Tolkien", "", 1, "hardcover"),
    (r"^the first law trilogy\b", "Joe Abercrombie", "The First Law", 1, "paperback"),
    (r"^the silo series\b", "Hugh Howey", "Silo", 1, "paperback"),
    (r"^by brandon sanderson the mistborn 7 books\b", "Brandon Sanderson", "Mistborn", 1, "paperback"),
    (r"^mistborn wax wayne\b", "Brandon Sanderson", "Mistborn", 4, "paperback"),
    (r"^best served cold\b", "Joe Abercrombie", "The First Law", 1, "hardcover"),
    (r"^the heroes\b", "Joe Abercrombie", "The First Law", 1, "hardcover"),
    (r"^red country\b", "Joe Abercrombie", "The First Law", 1, "hardcover"),
    (r"^john gwynne faithful and the fallen collection\b", "John Gwynne", "The Faithful and the Fallen", 1, "paperback"),
    (r"^the wheel of time complete set\b", "Robert Jordan", "The Wheel of Time", 1, "paperback"),
    (r"^steven erikson 10 books collection\b", "Steven Erikson", "Malazan Book of the Fallen", 1, "paperback"),
    (r"^the stormlight archive boxed set part two\b", "Brandon Sanderson", "The Stormlight Archive", 1, "paperback"),
    (r"^the three body problem.*deluxe\b", "Cixin Liu", "Remembrance of Earth's Past", 1, "hardcover"),
    # John Gwynne
    (r"^a time of dread\b", "John Gwynne", "Of Blood and Bone", 1, "paperback"),
    (r"^a time of blood\b", "John Gwynne", "Of Blood and Bone", 2, "paperback"),
    (r"^a time of courage\b", "John Gwynne", "Of Blood and Bone", 3, "paperback"),
    (r"^malice\b", "John Gwynne", "The Faithful and the Fallen", 1, "paperback"),
    (r"^valour\b", "John Gwynne", "The Faithful and the Fallen", 2, "paperback"),
    (r"^valor\b", "John Gwynne", "The Faithful and the Fallen", 2, "paperback"),
    (r"^ruin\b", "John Gwynne", "The Faithful and the Fallen", 3, "paperback"),
    (r"^wrath\b", "John Gwynne", "The Faithful and the Fallen", 4, "paperback"),
    (r"^the shadow of the gods\b", "John Gwynne", "The Bloodsworn Trilogy", 1, "paperback"),
    (r"^the hunger of the gods\b", "John Gwynne", "The Bloodsworn Trilogy", 2, "paperback"),
    (r"^the fury of the gods\b", "John Gwynne", "The Bloodsworn Trilogy", 3, "paperback"),
    (r"^the bloodsworn saga boxed set\b", "John Gwynne", "The Bloodsworn Trilogy", 1, "paperback"),
    (r"^john gwynne of blood and bone series 3 books", "John Gwynne", "Of Blood and Bone", 1, "hardcover"),
    # Joe Abercrombie
    (r"^the blade itself\b", "Joe Abercrombie", "The First Law", 1, "hardcover"),
    (r"^before they are hanged\b", "Joe Abercrombie", "The First Law", 2, "hardcover"),
    (r"^last argument of kings\b", "Joe Abercrombie", "The First Law", 3, "hardcover"),
    (r"^a little hatred\b", "Joe Abercrombie", "The Age of Madness", 1, "hardcover"),
    (r"^the trouble with peace\b", "Joe Abercrombie", "The Age of Madness", 2, "hardcover"),
    (r"^the wisdom of crowds\b", "Joe Abercrombie", "The Age of Madness", 3, "hardcover"),
    (r"^the age of madness trilogy\b", "Joe Abercrombie", "The Age of Madness", 1, "paperback"),
    # Robin Hobb
    (r"^assassin s apprentice\b", "Robin Hobb", "The Farseer Trilogy", 1, "paperback"),
    (r"^royal assassin\b", "Robin Hobb", "The Farseer Trilogy", 2, "paperback"),
    (r"^assassin s quest\b", "Robin Hobb", "The Farseer Trilogy", 3, "paperback"),
    (r"^fool s errand\b", "Robin Hobb", "The Tawny Man Trilogy", 1, "paperback"),
    (r"^golden fool\b", "Robin Hobb", "The Tawny Man Trilogy", 2, "paperback"),
    (r"^fool s fate\b", "Robin Hobb", "The Tawny Man Trilogy", 3, "paperback"),
    (r"^ship of magic\b", "Robin Hobb", "The Liveship Traders", 1, "paperback"),
    (r"^mad ship\b", "Robin Hobb", "The Liveship Traders", 2, "paperback"),
    (r"^ship of destiny\b", "Robin Hobb", "The Liveship Traders", 3, "paperback"),
    (r"^dragon keeper\b", "Robin Hobb", "The Rain Wild Chronicles", 1, "paperback"),
    (r"^dragon haven\b", "Robin Hobb", "The Rain Wild Chronicles", 2, "paperback"),
    (r"^city of dragons\b", "Robin Hobb", "The Rain Wild Chronicles", 3, "paperback"),
    (r"^blood of dragons\b", "Robin Hobb", "The Rain Wild Chronicles", 4, "paperback"),
    (r"^fool s assassin\b", "Robin Hobb", "The Fitz and the Fool", 1, "paperback"),
    (r"^fool s quest\b", "Robin Hobb", "The Fitz and the Fool", 2, "paperback"),
    (r"^assassin s fate\b", "Robin Hobb", "The Fitz and the Fool", 3, "paperback"),
    (r"^the rain wild chronicles 4", "Robin Hobb", "The Rain Wild Chronicles", 1, "paperback"),
    (r"^tawny man trilogy", "Robin Hobb", "The Tawny Man Trilogy", 1, "paperback"),
    (r"^liveship traders trilogy", "Robin Hobb", "The Liveship Traders", 1, "paperback"),
    (r"^fitz and the fool trilogy", "Robin Hobb", "The Fitz and the Fool", 1, "paperback"),
    (r"^the complete farseer trilogy", "Robin Hobb", "The Farseer Trilogy", 1, "paperback"),
    # Frank Herbert
    (r"^dune deluxe edition\b", "Frank Herbert", "Dune", 1, "hardcover"),
    (r"^dune messiah deluxe\b", "Frank Herbert", "Dune", 2, "hardcover"),
    (r"^dune the inspiration\b", "Frank Herbert", "Dune", 1, "paperback"),
    (r"^dune messiah\b", "Frank Herbert", "Dune", 2, "paperback"),
    (r"^children of dune\b", "Frank Herbert", "Dune", 3, "paperback"),
    (r"^god emperor of dune\b", "Frank Herbert", "Dune", 4, "paperback"),
    (r"^heretics of dune\b", "Frank Herbert", "Dune", 5, "paperback"),
    (r"^chapterhouse dune\b", "Frank Herbert", "Dune", 6, "paperback"),
    (r"^frank herbert s dune saga", "Frank Herbert", "Dune", 1, "hardcover"),
    (r"^dune\b", "Frank Herbert", "Dune", 1, "paperback"),
    # Dan Simmons
    (r"^hyperion\b", "Dan Simmons", "Hyperion Cantos", 1, "paperback"),
    (r"^the fall of hyperion\b", "Dan Simmons", "Hyperion Cantos", 2, "paperback"),
    (r"^endymion\b", "Dan Simmons", "Hyperion Cantos", 3, "paperback"),
    (r"^the rise of endymion\b", "Dan Simmons", "Hyperion Cantos", 4, "paperback"),
    # Cixin Liu
    (r"^the three body problem\b", "Cixin Liu", "Remembrance of Earth's Past", 1, "paperback"),
    (r"^the dark forest\b", "Cixin Liu", "Remembrance of Earth's Past", 2, "paperback"),
    (r"^death s end\b", "Cixin Liu", "Remembrance of Earth's Past", 3, "paperback"),
    (r"^three body problem boxed set\b", "Cixin Liu", "Remembrance of Earth's Past", 1, "paperback"),
    # R. F. Kuang
    (r"^the poppy war\b", "R. F. Kuang", "The Poppy War", 1, "hardcover"),
    (r"^the dragon republic\b", "R. F. Kuang", "The Poppy War", 2, "hardcover"),
    (r"^the burning god\b", "R. F. Kuang", "The Poppy War", 3, "hardcover"),
    # Patrick Rothfuss
    (r"^the name of the wind\b", "Patrick Rothfuss", "The Kingkiller Chronicle", 1, "hardcover"),
    (r"^the wise man s fear\b", "Patrick Rothfuss", "The Kingkiller Chronicle", 2, "hardcover"),
    # Scott Lynch
    (r"^the lies of locke lamora\b", "Scott Lynch", "Gentleman Bastard", 1, "hardcover"),
    (r"^red seas under red skies\b", "Scott Lynch", "Gentleman Bastard", 2, "hardcover"),
    (r"^the republic of thieves\b", "Scott Lynch", "Gentleman Bastard", 3, "hardcover"),
    # George R. R. Martin
    (r"^a game of thrones\b", "George R. R. Martin", "A Song of Ice and Fire", 1, "paperback"),
    (r"^a clash of kings\b", "George R. R. Martin", "A Song of Ice and Fire", 2, "paperback"),
    (r"^a storm of swords\b", "George R. R. Martin", "A Song of Ice and Fire", 3, "paperback"),
    (r"^a feast for crows\b", "George R. R. Martin", "A Song of Ice and Fire", 4, "paperback"),
    (r"^a dance with dragons\b", "George R. R. Martin", "A Song of Ice and Fire", 5, "paperback"),
    (r"^a knight of the seven kingdoms\b", "George R. R. Martin", "A Song of Ice and Fire", 1, "paperback"),
    (r"^fire blood\b", "George R. R. Martin", "A Song of Ice and Fire", 1, "hardcover"),
    (r"^george r r martin s a game of thrones 5 book", "George R. R. Martin", "A Song of Ice and Fire", 1, "paperback"),
    # Tolkien
    (r"^the hobbit\b", "J.R.R. Tolkien", "", 1, "paperback"),
    (r"^the lord of the rings collector", "J.R.R. Tolkien", "The Lord of the Rings", 1, "hardcover"),
    (r"^the silmarillion\b", "J.R.R. Tolkien", "", 1, "hardcover"),
    # Cormac McCarthy
    (r"^the road\b", "Cormac McCarthy", "", 1, "paperback"),
    (r"^blood meridian\b", "Cormac McCarthy", "", 1, "paperback"),
    (r"^no country for old men\b", "Cormac McCarthy", "", 1, "paperback"),
    (r"^suttree\b", "Cormac McCarthy", "", 1, "paperback"),
    # M. L. Wang
    (r"^the sword of kaigen\b", "M. L. Wang", "", 1, "paperback"),
    (r"^blood over bright haven\b", "M. L. Wang", "", 1, "hardcover"),
    # Robert Jackson Bennett
    (r"^the tainted cup\b", "Robert Jackson Bennett", "Ana and Din", 1, "hardcover"),
    (r"^a drop of corruption\b", "Robert Jackson Bennett", "Ana and Din", 2, "hardcover"),
    (r"^a trade of blood\b", "Robert Jackson Bennett", "Ana and Din", 3, "hardcover"),
    # James Islington
    (r"^the will of the many\b", "James Islington", "Hierarchy", 1, "hardcover"),
    # Jay Kristoff
    (r"^empire of the vampire\b", "Jay Kristoff", "Empire of the Vampire", 1, "hardcover"),
    (r"^empire of the damned\b", "Jay Kristoff", "Empire of the Vampire", 2, "hardcover"),
    (r"^empire of the dawn\b", "Jay Kristoff", "Empire of the Vampire", 3, "hardcover"),
    # Christopher Ruocchio
    (r"^empire of silence\b", "Christopher Ruocchio", "The Sun Eater", 1, "hardcover"),
    (r"^howling dark\b", "Christopher Ruocchio", "The Sun Eater", 2, "hardcover"),
    (r"^demon in white\b", "Christopher Ruocchio", "The Sun Eater", 3, "hardcover"),
    (r"^kingdoms of death\b", "Christopher Ruocchio", "The Sun Eater", 4, "hardcover"),
    (r"^ashes of man\b", "Christopher Ruocchio", "The Sun Eater", 5, "hardcover"),
    (r"^disquiet gods\b", "Christopher Ruocchio", "The Sun Eater", 6, "hardcover"),
    (r"^shadows upon time\b", "Christopher Ruocchio", "The Sun Eater", 7, "hardcover"),
    (r"^the dregs of empire\b", "Christopher Ruocchio", "The Sun Eater", 5.5, "hardcover"),
    # Matt Dinniman
    (r"^dungeon crawler carl\b", "Matt Dinniman", "Dungeon Crawler Carl", 1, "hardcover"),
    (r"^carl s doomsday scenario\b", "Matt Dinniman", "Dungeon Crawler Carl", 2, "hardcover"),
    (r"^the dungeon anarchist s cookbook\b", "Matt Dinniman", "Dungeon Crawler Carl", 3, "hardcover"),
    (r"^the gate of the feral gods\b", "Matt Dinniman", "Dungeon Crawler Carl", 4, "hardcover"),
    (r"^the butcher s masquerade\b", "Matt Dinniman", "Dungeon Crawler Carl", 5, "hardcover"),
    (r"^the eye of the bedlam bride\b", "Matt Dinniman", "Dungeon Crawler Carl", 6, "hardcover"),
    (r"^this inevitable ruin\b", "Matt Dinniman", "Dungeon Crawler Carl", 7, "hardcover"),
    (r"^a parade of horribles\b", "Matt Dinniman", "Dungeon Crawler Carl", 8, "hardcover"),
    # James S. A. Corey
    (r"^leviathan wakes\b", "James S. A. Corey", "The Expanse", 1, "hardcover"),
    (r"^caliban s war\b", "James S. A. Corey", "The Expanse", 2, "hardcover"),
    (r"^abaddon s gate\b", "James S. A. Corey", "The Expanse", 3, "hardcover"),
    # Robert Jordan
    (r"^the eye of the world\b", "Robert Jordan", "The Wheel of Time", 1, "paperback"),
    (r"^the great hunt\b", "Robert Jordan", "The Wheel of Time", 2, "paperback"),
    (r"^the dragon reborn\b", "Robert Jordan", "The Wheel of Time", 3, "paperback"),
    (r"^the shadow rising\b", "Robert Jordan", "The Wheel of Time", 4, "paperback"),
    (r"^the fires of heaven\b", "Robert Jordan", "The Wheel of Time", 5, "paperback"),
    (r"^lord of chaos\b", "Robert Jordan", "The Wheel of Time", 6, "paperback"),
    (r"^a crown of swords\b", "Robert Jordan", "The Wheel of Time", 7, "paperback"),
    (r"^the path of daggers\b", "Robert Jordan", "The Wheel of Time", 8, "paperback"),
    (r"^winter s heart\b", "Robert Jordan", "The Wheel of Time", 9, "paperback"),
    (r"^crossroads of twilight\b", "Robert Jordan", "The Wheel of Time", 10, "paperback"),
    (r"^knife of dreams\b", "Robert Jordan", "The Wheel of Time", 11, "paperback"),
    (r"^the gathering storm\b", "Robert Jordan", "The Wheel of Time", 12, "paperback"),
    (r"^towers of midnight\b", "Robert Jordan", "The Wheel of Time", 13, "paperback"),
    (r"^a memory of light\b", "Robert Jordan", "The Wheel of Time", 14, "paperback"),
    # R. Scott Bakker
    (r"^the darkness that comes before\b", "R. Scott Bakker", "The Prince of Nothing", 1, "paperback"),
    (r"^the warrior prophet\b", "R. Scott Bakker", "The Prince of Nothing", 2, "paperback"),
    (r"^the thousandfold thought\b", "R. Scott Bakker", "The Prince of Nothing", 3, "paperback"),
    # Outros
    (r"^the broken earth trilogy\b", "N. K. Jemisin", "The Broken Earth", 1, "paperback"),
    (r"^the murderbot diaries collection\b", "Martha Wells", "The Murderbot Diaries", 1, "hardcover"),
    (r"^stormlight archives hc box set\b", "Brandon Sanderson", "The Stormlight Archive", 1, "hardcover"),
    (r"^the stormlight archive hardcover boxed set\b", "Brandon Sanderson", "The Stormlight Archive", 1, "hardcover"),
    (r"^mistborn trilogy boxed set\b", "Brandon Sanderson", "Mistborn", 1, "paperback"),
    (r"^by brandon sanderson \(the mistborn\) 7 books\b", "Brandon Sanderson", "Mistborn", 1, "paperback"),
    (r"^the dandelion dynasty\b", "Ken Liu", "The Dandelion Dynasty", 1, "paperback"),
    (r"^monk and robot\b", "Becky Chambers", "Monk & Robot", 1, "paperback"),
    (r"^a psalm for the wild built\b", "Becky Chambers", "Monk & Robot", 1, "paperback"),
    (r"^project hail mary\b", "Andy Weir", "", 1, "paperback"),
    (r"^the martian\b", "Andy Weir", "", 1, "paperback"),
    (r"^recursion\b", "Blake Crouch", "", 1, "paperback"),
    (r"^dark matter\b", "Blake Crouch", "", 1, "paperback"),
    (r"^blake crouch collection\b", "Blake Crouch", "", 1, "paperback"),
    (r"^11 22 63\b", "Stephen King", "", 1, "paperback"),
    (r"^lonesome dove\b", "Larry McMurtry", "", 1, "paperback"),
    (r"^piranesi\b", "Susanna Clarke", "", 1, "paperback"),
    (r"^jonathan strange\b", "Susanna Clarke", "", 1, "hardcover"),
    (r"^the lions of al rassan\b", "Guy Gavriel Kay", "", 1, "paperback"),
    (r"^musashi\b", "Eiji Yoshikawa", "", 1, "paperback"),
    (r"^neuromancer\b", "William Gibson", "", 1, "hardcover"),
    (r"^the buffalo hunter hunter\b", "Stephen Graham Jones", "", 1, "hardcover"),
    (r"^the rage of dragons\b", "Evan Winter", "The Burning", 1, "hardcover"),
    (r"^the fires of vengeance\b", "Evan Winter", "The Burning", 2, "hardcover"),
    (r"^of blood and fire\b", "Ryan Cahill", "The Bound and the Broken", 1, "hardcover"),
    (r"^he who fights with monsters\b", "Travis Deverell", "He Who Fights with Monsters", 1, "hardcover"),
    (r"^shadow slave\b", "Guiltythree", "Shadow Slave", 1, "hardcover"),
    (r"^sword and citadel\b", "Gene Wolfe", "The Book of the New Sun", 1, "paperback"),
    (r"^shadow and claw\b", "Gene Wolfe", "The Book of the New Sun", 1, "paperback"),
    (r"^wind and truth\b", "Brandon Sanderson", "The Stormlight Archive", 5, "hardcover"),
    (r"^the stormlight archive boxed set part one\b", "Brandon Sanderson", "The Stormlight Archive", 1, "paperback"),
    (r"^brandon sanderson 3 books collection\b", "Brandon Sanderson", "", 1, "paperback"),
    (r"^box jurassic park\b", "Michael Crichton", "Jurassic Park", 1, "hardcover"),
    (r"^the priory of the orange tree\b", "Samantha Shannon", "The Roots of Chaos", 1, "hardcover"),
    (r"^a day of fallen night\b", "Samantha Shannon", "The Roots of Chaos", 0, "hardcover"),
    (r"^among the burning flowers\b", "Samantha Shannon", "The Roots of Chaos", 0, "hardcover"),
]

with open(csv_path, encoding="utf-8-sig", newline="") as f:
    rows = list(csv.DictReader(f))

overrides = {}
new_works = {}
queries = {}
SET_PATTERNS = [
    r"^the first law trilogy\b",
    r"^the age of madness trilogy\b",
    r"^the broken earth trilogy\b",
    r"^the complete farseer trilogy\b",
    r"^tawny man trilogy\b",
    r"^liveship traders trilogy\b",
    r"^fitz and the fool trilogy\b",
    r"^the rain wild chronicles 4\b",
    r"^the bloodsworn saga boxed set\b",
    r"^john gwynne of blood and bone series 3\b",
    r"^the stormlight archive boxed set\b",
    r"^stormlight archives hc box set\b",
    r"^the stormlight archive hardcover boxed set\b",
    r"^mistborn trilogy boxed set\b",
    r"^by brandon sanderson the mistborn 7 books\b",
    r"^mistborn wax wayne\b",
    r"^the dandelion dynasty\b",
    r"^monk and robot\b",
    r"^the silo series\b",
    r"^the wheel of time complete set\b",
    r"^steven erikson 10 books\b",
    r"^the three body problem boxed set\b",
    r"^the lord of the rings\b",
    r"^the tolkien treasury\b",
    r"^frank herbert s dune saga\b",
    r"^dune saga books 4 6\b",
    r"^george r r martin s a game of thrones 5 book\b",
    r"^the murderbot diaries collection\b",
    r"\bboxed set\b",
    r"\bcollection set\b",
    r"\bcomplete series\b",
    r"\b\d+\s*-\s*\d+\b",
]
EDITION_PATTERN = re.compile(r"\b(illustrated|deluxe|collector|collectors|anniversary|special|limited|signed)\b", re.I)

for row in rows:
    title = (row.get("Título do produto") or "").strip()
    if not title:
        continue
    desired = parse_price(row.get("Buy Box: Preço desejado ") or row.get("Amazon: Preço desejado ") or row.get("Novo: Preço desejado "))
    current = parse_price(row.get("Buy Box: Atual") or row.get("Amazon: Atual") or row.get("Novo: Atual"))
    max_price = desired or current
    normalized = norm(title)
    base = base_title(title)
    rule = next((r for r in RULES if re.search(r[0], normalized)), None)
    is_set = any(re.search(pattern, normalized) for pattern in SET_PATTERNS)

    # Sets/box sets viram uma obra própria; não aplicam o preço do set ao volume 1.
    if rule and is_set:
        author, series, fmt = rule[1], rule[2], rule[4]
        set_title = re.split(r"\s+[-–—]\s+|\s+\(", title)[0].strip()
        if ":" in set_title:
            head, tail = set_title.split(":", 1)
            if not re.search(r"\b(set|complete|boxed|collection)\b", tail, re.I):
                set_title = head.strip()
        key = slug(set_title) + "--" + slug(author)
        if key not in new_works:
            new_works[key] = {
                "key": key,
                "title": set_title,
                "author": author,
                "series": series,
                "volume": 1,
                "status": "Want to Buy",
                "language": "en",
                "priority": 1,
                "enabled": True,
                "aliases": [title] if title != set_title else [],
                "preferred_publishers": [],
                "preferred_formats": [fmt],
                "isbn13": "",
                "max_price": round(max_price, 2) if max_price else 150,
                "notes": "Keepa set",
            }
        queries[author] = {"term": author, "kind": "author", "priority": 1, "enabled": True}
        continue

    # Edições específicas (illustrated, deluxe, collector's) são obras próprias;
    # não podem sobrescrever o preço da edição comum.
    if rule and EDITION_PATTERN.search(title) and not is_set:
        author, series, volume, fmt = rule[1], rule[2], rule[3], rule[4]
        edition_title = title.strip()
        key = slug(edition_title) + "--" + slug(author)
        if key not in new_works:
            new_works[key] = {
                "key": key,
                "title": edition_title,
                "author": author,
                "series": series,
                "volume": volume,
                "status": "Want to Buy",
                "language": "en",
                "priority": 1,
                "enabled": True,
                "aliases": [],
                "preferred_publishers": [],
                "preferred_formats": [fmt],
                "isbn13": "",
                "max_price": round(max_price, 2) if max_price else 150,
                "notes": "Keepa edição específica",
            }
        queries[author] = {"term": author, "kind": "author", "priority": 1, "enabled": True}
        continue

    matched = find_existing(base) or find_existing(title)
    if rule and matched and (
        matched["volume"] != rule[3] or norm(matched["author"]) != norm(rule[1])
    ):
        matched = None

    author = rule[1] if rule else (matched["author"] if matched else "")
    series = rule[2] if rule else (matched["series"] if matched else "")
    volume = rule[3] if rule else (matched["volume"] if matched else 1)
    fmt = rule[4] if rule else "paperback"

    if matched:
        key = matched["key"]
        overrides[key] = {
            "max_price": round(max_price, 2) if max_price else matched["max_price"],
            "preferred_formats": [fmt] if fmt else matched["preferred_formats"],
            "priority": 1,
            "enabled": True,
            "notes": "Keepa wishlist",
        }
    else:
        work_title = base.split(":")[0].strip() if rule else base
        if normalized.startswith("mistborn ") and ":" in base:
            work_title = base.split(":", 1)[1].strip()
        key = slug(work_title) + "--" + slug(author or "revisar")
        existing_work = existing_by_key.get(key)
        if existing_work:
            overrides[existing_work["key"]] = {
                "max_price": round(max_price, 2) if max_price else existing_work["max_price"],
                "preferred_formats": [fmt] if fmt else existing_work["preferred_formats"],
                "priority": 1,
                "enabled": True,
                "notes": "Keepa wishlist",
            }
            if author:
                queries[author] = {"term": author, "kind": "author", "priority": 1, "enabled": True}
            continue
        if key not in new_works:
            new_works[key] = {
                "key": key,
                "title": work_title,
                "author": author,
                "series": series,
                "volume": volume,
                "status": "Want to Buy",
                "language": "en",
                "priority": 1,
                "enabled": bool(author),
                "aliases": [title] if title != work_title else [],
                "preferred_publishers": [],
                "preferred_formats": [fmt],
                "isbn13": "",
                "max_price": round(max_price, 2) if max_price else 150,
                "notes": "Keepa wishlist" if author else "Keepa: revisar autor",
            }
        if author:
            queries[author] = {"term": author, "kind": "author", "priority": 1, "enabled": True}

out_watch = os.path.join(config_dir, "keepa-wishlist.yaml")
with open(out_watch, "w", encoding="utf-8") as f:
    f.write("# Gerado por scripts/import-keepa.py. Revise antes de confiar.\n")
    f.write(f"# Fonte: {os.path.basename(csv_path)} em {date.today().isoformat()}\n")
    yaml.safe_dump({"overrides": overrides, "works": list(new_works.values())}, f, allow_unicode=True, sort_keys=False)

out_queries = os.path.join(config_dir, "keepa-queries.yaml")
with open(out_queries, "w", encoding="utf-8") as f:
    f.write("# Consultas de autor geradas pelo import do Keepa.\n")
    yaml.safe_dump({"queries": list(queries.values())}, f, allow_unicode=True, sort_keys=False)

print(f"linhas: {len(rows)}")
print(f"overrides em obras existentes: {len(overrides)}")
print(f"obras novas: {len(new_works)} ({sum(1 for w in new_works.values() if w['enabled'])} com autor)")
print(f"consultas novas: {len(queries)}")
print(f"arquivos: {out_watch} e {out_queries}")
print("\nObras novas sem autor (revisar):")
for w in new_works.values():
    if not w["author"]:
        print(f"  - {w['title']}")
