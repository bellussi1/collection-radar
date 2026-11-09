"""Gera config/watchlist.yaml e config/queries.yaml a partir do Calibre.

Uso:
    python scripts/build-watchlist.py [caminho-do-metadata.db]

O padrão é C:\\Users\\Bellussi\\Biblioteca do calibre\\metadata.db.
"""
import json, re, unicodedata, os, sqlite3, sys
from datetime import date

db_path = sys.argv[1] if len(sys.argv) > 1 else r"C:\Users\Bellussi\Biblioteca do calibre\metadata.db"
con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute("""
    select
      b.id, b.title, b.sort, b.pubdate, b.series_index,
      (select group_concat(a.name, ' & ') from books_authors_link l join authors a on a.id=l.author where l.book=b.id) as authors,
      (select s.name from books_series_link l join series s on s.id=l.series where l.book=b.id) as series,
      (select p.name from books_publishers_link l join publishers p on p.id=l.publisher where l.book=b.id) as publisher,
      (select group_concat(la.lang_code, ',') from books_languages_link l join languages la on la.id=l.lang_code where l.book=b.id) as langs,
      (select cc.value from books_custom_column_1_link l join custom_column_1 cc on cc.id=l.value where l.book=b.id) as hardcover_status,
      (select group_concat(t.name, ',') from books_tags_link l join tags t on t.id=l.tag where l.book=b.id) as tags
    from books b
    order by b.id
""")]
con.close()

def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
    return s

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")

# Portuguese/original-title -> English title
title_map = {
    "a furia do assassino": "Assassin's Quest",
    "o assassino do rei": "Royal Assassin",
    "o aprendiz de assassino": "Assassin's Apprentice",
    "pombo solitario": "Lonesome Dove",
    "o hobbit": "The Hobbit",
    "eu que nunca conheci os homens": "I Who Have Never Known Men",
    "flores para algernon": "Flowers for Algernon",
    "a curva do sonho": "The Lathe of Heaven",
    "o oceano no fim do caminho": "The Ocean at the End of the Lane",
    "imperio do silencio": "Empire of Silence",
    "l etranger": "The Stranger",
    "cien anos de soledad": "One Hundred Years of Solitude",
    "piknik na obochine": "Roadside Picnic",
    "san ti": "The Three-Body Problem",
    "hei an senlin": "The Dark Forest",
    "sishen yongsheng": "Death's End",
}

priority_authors = {
    "robin hobb", "brandon sanderson", "steven erikson", "frank herbert", "pierce brown",
    "christopher ruocchio", "cormac mccarthy", "matt dinniman", "joe abercrombie",
    "george r. r. martin", "patrick rothfuss", "n. k. jemisin", "jay kristoff",
    "mark lawrence", "ken liu", "john gwynne", "scott lynch", "james islington",
    "dan simmons", "cixin liu", "jeff vandermeer", "ursula k. le guin", "gene wolfe",
    "china mieville", "martha wells", "arkady martine", "john scalzi", "fonda lee",
    "r. f. kuang", "susanna clarke", "andy weir", "j.r.r. tolkien", "robert jordan",
    "glen cook", "m. l. wang", "becky chambers", "neil gaiman",
    "arkadi strugatski & boris strugatski",
}

sf_f_tags = {
    "fantasy", "science fiction", "grimdark", "space opera", "epic fantasy",
    "high fantasy", "litrpg", "science fantasy", "horror", "dystopian",
    "cyberpunk", "military fantasy", "historical fantasy", "urban fantasy",
    "progression fantasy", "silkpunk", "dark fantasy", "weird fiction",
    "post apocalyptic", "apocalyptic", "sword and sorcery",
}

literary_tags = {
    "literary fiction", "magical realism", "historical fiction", "romance",
    "family saga", "classic",
}

publisher_map = {
    "robin hobb": ["HarperVoyager"],
    "brandon sanderson": ["Tor", "Gollancz"],
    "steven erikson": ["Bantam", "Tor"],
    "frank herbert": ["Ace", "Berkley"],
    "pierce brown": ["Del Rey"],
    "christopher ruocchio": ["DAW", "Baen"],
    "cormac mccarthy": ["Knopf", "Picador"],
    "matt dinniman": ["Ace", "Dandy House"],
    "joe abercrombie": ["Gollancz", "Orbit"],
    "george r. r. martin": ["HarperVoyager", "Bantam"],
    "patrick rothfuss": ["DAW", "Gollancz"],
    "n. k. jemisin": ["Orbit"],
    "jay kristoff": ["St. Martin's Press", "HarperCollins"],
    "mark lawrence": ["Voyager", "Ace"],
    "ken liu": ["Saga Press", "Head of Zeus"],
    "john gwynne": ["Orbit", "Pan Macmillan"],
    "scott lynch": ["Del Rey", "Gollancz"],
    "james islington": ["Orbit"],
    "dan simmons": ["Bantam", "Gollancz"],
    "cixin liu": ["Tor", "Head of Zeus"],
    "jeff vandermeer": ["FSG", "Fourth Estate"],
    "ursula k. le guin": ["Ace", "Gollancz"],
    "gene wolfe": ["Tor", "Gollancz"],
    "china mieville": ["Del Rey", "Pan Macmillan"],
    "martha wells": ["Tor.com", "Tor"],
    "arkady martine": ["Tor"],
    "john scalzi": ["Tor"],
    "fonda lee": ["Orbit"],
    "r. f. kuang": ["HarperVoyager"],
    "susanna clarke": ["Bloomsbury"],
    "andy weir": ["Crown", "Broadway"],
    "j.r.r. tolkien": ["HarperCollins", "Mariner"],
    "robert jordan": ["Tor", "Orbit"],
    "glen cook": ["Tor", "Roc"],
    "m. l. wang": ["Independently Published"],
}

exclude_titles = [
    "omnibus", "boxset", "box set", "complete series", "3-book bundle",
    "the complete malazan", "the wheel of time (complete", "lord of mysteries",
    "the dandelion dynasty boxset",
]
exclude_authors = ["karl marx", "vladimir ilitch lenin", "vladimir lenin"]

seen = {}
for r in rows:
    author = (r.get("authors") or "").strip()
    title = (r.get("title") or "").strip()
    if not author or not title:
        continue
    if any(x in norm(title) for x in exclude_titles):
        continue
    if norm(author) in exclude_authors:
        continue
    # skip Chinese web novel volumes
    if "lord of mysteries" in norm(title) and norm(title) not in ("lord of mysteries side stories",):
        continue

    key_title = title_map.get(norm(title), title)
    base_title = key_title.strip()
    work_key = slug(base_title) + "--" + slug(author.split("&")[0])

    status = r.get("hardcover_status") or ""
    tags = r.get("tags") or ""
    lang = r.get("langs") or ""
    series = r.get("series") or ""
    series_index = r.get("series_index") or 1

    if work_key in seen:
        # merge aliases/status
        w = seen[work_key]
        if title not in w["aliases"]:
            w["aliases"].append(title)
        if status == "Read":
            w["status"] = "Read"
        elif status == "Want to Read" and w["status"] not in ("Read", "Currently Reading"):
            w["status"] = "Want to Read"
        continue

    tag_set = {norm(t) for t in tags.split(",") if t.strip()}
    is_sf_f = bool(tag_set & sf_f_tags) or (
        "speculative fiction" in tag_set and not (tag_set & literary_tags)
    )
    is_priority_author = any(a in norm(author) for a in priority_authors)
    keep_literary = norm(author) == "cormac mccarthy"

    if not is_sf_f and not is_priority_author and not keep_literary:
        # Fora do escopo: ficção literária, romance, não ficção etc.
        priority = 3
        enabled = False
    elif is_priority_author or keep_literary or status in ("Read", "Currently Reading"):
        priority = 1
        enabled = True
    elif status == "Want to Read":
        priority = 2
        enabled = True
    else:
        priority = 3
        enabled = False

    preferred = publisher_map.get(norm(author), [])
    aliases = []
    if title != base_title:
        aliases.append(title)
    if norm(title) in title_map:
        aliases.append(title)

    seen[work_key] = {
        "key": work_key,
        "title": base_title,
        "author": author,
        "series": series,
        "volume": series_index,
        "status": status or "none",
        "language": "en",
        "priority": priority,
        "enabled": enabled,
        "aliases": sorted(set(aliases)),
        "preferred_publishers": preferred,
        "preferred_formats": ["hardcover", "paperback"],
        "isbn13": "",
        "max_price": 150 if priority == 1 else 120 if priority == 2 else 100,
        "notes": tags,
    }

# O Calibre tem o omnibus de Rain Wild; a coleção física é dos 4 volumes individuais.
seen.pop("the-rain-wild-chronicles--robin-hobb", None)
rain_wild = [
    ("Dragon Keeper", 1, "9780008154394"),
    ("Dragon Haven", 2, "9780008154400"),
    ("City of Dragons", 3, "9780008154417"),
    ("Blood of Dragons", 4, "9780008154462"),
]
for title, volume, isbn in rain_wild:
    key = slug(title) + "--robin-hobb"
    seen[key] = {
        "key": key,
        "title": title,
        "author": "Robin Hobb",
        "series": "The Rain Wild Chronicles",
        "volume": volume,
        "status": "Want to Read",
        "language": "en",
        "priority": 1,
        "enabled": True,
        "aliases": [],
        "preferred_publishers": ["HarperVoyager"],
        "preferred_formats": ["hardcover", "paperback"],
        "isbn13": isbn,
        "max_price": 150,
        "notes": "Realm of the Elderlings",
    }

# Malazan: o Calibre tem o omnibus; a coleção física é dos volumes individuais.
malazan = [
    "Gardens of the Moon", "Deadhouse Gates", "Memories of Ice", "House of Chains",
    "Midnight Tides", "The Bonehunters", "Reaper's Gale", "Toll the Hounds",
    "Dust of Dreams", "The Crippled God",
]
for index, title in enumerate(malazan, start=1):
    key = slug(title) + "--steven-erikson"
    seen[key] = {
        "key": key,
        "title": title,
        "author": "Steven Erikson",
        "series": "Malazan Book of the Fallen",
        "volume": index,
        "status": "Want to Read",
        "language": "en",
        "priority": 1,
        "enabled": True,
        "aliases": [],
        "preferred_publishers": ["Bantam", "Tor"],
        "preferred_formats": ["hardcover", "paperback"],
        "isbn13": "",
        "max_price": 150,
        "notes": "Malazan",
    }

# McCarthy citado no perfil, mas sem ficha no Calibre.
for title in ["No Country for Old Men", "Suttree"]:
    key = slug(title) + "--cormac-mccarthy"
    seen[key] = {
        "key": key,
        "title": title,
        "author": "Cormac McCarthy",
        "series": "",
        "volume": 1,
        "status": "Want to Read",
        "language": "en",
        "priority": 1,
        "enabled": True,
        "aliases": [],
        "preferred_publishers": ["Knopf", "Picador"],
        "preferred_formats": ["hardcover", "paperback"],
        "isbn13": "",
        "max_price": 150,
        "notes": "McCarthy",
    }

works = sorted(seen.values(), key=lambda w: (w["priority"], w["author"].lower(), w["series"].lower(), w["volume"]))

# ASOIAF já está na coleção física HarperVoyager; não precisa alertar.
for w in works:
    if w["series"] == "A Song of Ice and Fire":
        w["enabled"] = False
        w["notes"] = (w["notes"] + " | já tenho a coleção HarperVoyager").strip(" |")

# Robin Hobb ISBNs (HarperVoyager UK 129x198mm)
hobb_isbns = {
    "assassin-s-apprentice--robin-hobb": "9780007562251",
    "royal-assassin--robin-hobb": "9780007562268",
    "assassin-s-quest--robin-hobb": "9780007562275",
    "ship-of-magic--robin-hobb": "9780008117450",
    "the-mad-ship--robin-hobb": "9780008117467",
    "ship-of-destiny--robin-hobb": "9780008117474",
    "fool-s-errand--robin-hobb": "9780007585892",
    "the-golden-fool--robin-hobb": "9780007585908",
    "fool-s-fate--robin-hobb": "9780007588978",
    "dragon-keeper--robin-hobb": "9780008154394",
    "dragon-haven--robin-hobb": "9780008154400",
    "city-of-dragons--robin-hobb": "9780008154417",
    "blood-of-dragons--robin-hobb": "9780008154462",
    "fool-s-assassin--robin-hobb": "9780007444205",
    "fool-s-quest--robin-hobb": "9780007444243",
    "assassin-s-fate--robin-hobb": "9780007444281",
}
for w in works:
    if w["key"] in hobb_isbns:
        w["isbn13"] = hobb_isbns[w["key"]]

# Queries: authors + series + priority-1 standalone titles
featured_authors = {
    "robin hobb", "brandon sanderson", "steven erikson", "frank herbert",
    "pierce brown", "christopher ruocchio", "cormac mccarthy", "matt dinniman",
}
queries = {}
for w in works:
    if not w["enabled"]:
        continue
    q = w["author"].split("&")[0].strip()
    if q:
        entry = queries.setdefault(
            norm(q), {"term": q, "kind": "author", "priority": w["priority"]}
        )
        if norm(q) in featured_authors:
            entry["featured"] = 1
    if w["series"]:
        queries.setdefault(norm(w["series"]), {"term": w["series"], "kind": "series", "priority": w["priority"]})
    if not w["series"] and w["priority"] == 1:
        queries.setdefault(norm(w["title"]), {"term": w["title"], "kind": "title", "priority": 1})
    # PT alias for priority 1
    if w["priority"] == 1:
        for a in w["aliases"]:
            if not a or norm(a) == norm(w["title"]):
                continue
            if len(a) < 7 or len(a) > 60:
                continue
            if any(x in norm(a) for x in ("bundle", "omnibus", "box", "complete", "trilogy set")):
                continue
            if norm(a) in ("hei an senlin", "sishen yongsheng", "san ti"):
                continue
            queries.setdefault(norm(a), {"term": a, "kind": "alias", "priority": 1})

kind_order = {"author": 0, "series": 1, "title": 2, "alias": 3}
query_list = sorted(
    queries.values(),
    key=lambda q: (
        q["priority"],
        -q.get("featured", 0),
        kind_order.get(q["kind"], 9),
        q["term"].lower(),
    ),
)

repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
outdir = os.path.join(repo_root, "config")
os.makedirs(outdir, exist_ok=True)

# Write YAML manually (JSON strings are valid YAML)
def q(s):
    return json.dumps(s, ensure_ascii=False)

lines = []
lines.append(f"# Gerado a partir da biblioteca Calibre em {date.today().isoformat()}.")
lines.append("# Edite à vontade: o radar lê este arquivo a cada execução.")
lines.append("works:")
for w in works:
    lines.append(f"  - key: {q(w['key'])}")
    lines.append(f"    title: {q(w['title'])}")
    lines.append(f"    author: {q(w['author'])}")
    lines.append(f"    series: {q(w['series'])}")
    lines.append(f"    volume: {w['volume']}")
    lines.append(f"    status: {q(w['status'])}")
    lines.append(f"    language: {q(w['language'])}")
    lines.append(f"    priority: {w['priority']}")
    lines.append(f"    enabled: {'true' if w['enabled'] else 'false'}")
    lines.append(f"    aliases: [{', '.join(q(a) for a in w['aliases'])}]")
    lines.append(f"    preferred_publishers: [{', '.join(q(p) for p in w['preferred_publishers'])}]")
    lines.append(f"    preferred_formats: [{', '.join(q(p) for p in w['preferred_formats'])}]")
    lines.append(f"    isbn13: {q(w['isbn13'])}")
    lines.append(f"    max_price: {w['max_price']}")
    lines.append(f"    notes: {q(w['notes'])}")

open(os.path.join(outdir, "watchlist.yaml"), "w", encoding="utf-8").write("\n".join(lines) + "\n")

qlines = ["# Consultas geradas a partir da watchlist. Ajuste a prioridade e os termos.",
          "queries:"]
for x in query_list:
    qlines.append(f"  - term: {q(x['term'])}")
    qlines.append(f"    kind: {q(x['kind'])}")
    qlines.append(f"    priority: {x['priority']}")
    qlines.append(f"    enabled: true")
open(os.path.join(outdir, "queries.yaml"), "w", encoding="utf-8").write("\n".join(qlines) + "\n")

print("works", len(works), "enabled", sum(1 for w in works if w["enabled"]))
print("queries", len(query_list))
from collections import Counter
print("by priority", Counter(w["priority"] for w in works))
print("queries by kind", Counter(q["kind"] for q in query_list))
print("first 20 works")
for w in works[:20]:
    print(w["priority"], w["author"], "|", w["title"], "|", w["series"], w["volume"])
