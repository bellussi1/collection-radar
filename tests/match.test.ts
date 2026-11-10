import assert from "node:assert/strict";
import test from "node:test";
import { matchListing } from "../src/match.js";
import type { RawListing, Work } from "../src/types.js";

function work(partial: Partial<Work> & Pick<Work, "key" | "title" | "author">): Work {
  return {
    series: "",
    volume: 1,
    status: "Want to Read",
    language: "en",
    priority: 1,
    enabled: true,
    aliases: [],
    preferred_publishers: [],
    preferred_formats: ["hardcover", "paperback"],
    isbn13: "",
    max_price: 150,
    notes: "",
    ...partial
  };
}

function listing(partial: Partial<RawListing> & Pick<RawListing, "title">): RawListing {
  return {
    source: "estante",
    externalId: "1",
    url: "https://example.com/1",
    price: 100,
    shipping: null,
    currency: "BRL",
    seller: null,
    location: null,
    condition: null,
    description: null,
    imageUrl: null,
    sellerRating: null,
    ...partial
  };
}

const works: Work[] = [
  work({
    key: "assassin-s-quest--robin-hobb",
    title: "Assassin's Quest",
    author: "Robin Hobb",
    series: "The Farseer Trilogy",
    volume: 3,
    aliases: ["A Fúria do Assassino"],
    preferred_publishers: ["HarperVoyager"],
    isbn13: "9780007562275"
  }),
  work({
    key: "royal-assassin--robin-hobb",
    title: "Royal Assassin",
    author: "Robin Hobb",
    series: "The Farseer Trilogy",
    volume: 2,
    aliases: ["O Assassino do Rei"],
    preferred_publishers: ["HarperVoyager"],
    isbn13: "9780007562268"
  }),
  work({
    key: "the-well-of-ascension--brandon-sanderson",
    title: "The Well of Ascension",
    author: "Brandon Sanderson",
    series: "Mistborn",
    volume: 2,
    preferred_publishers: ["Tor", "Gollancz"]
  }),
  work({
    key: "mistborn-secret-history--brandon-sanderson",
    title: "Mistborn: Secret History",
    author: "Brandon Sanderson",
    series: "Mistborn",
    volume: 3.5,
    preferred_publishers: ["Tor"]
  })
];

test("edição PT é ignorada", () => {
  const result = matchListing(
    listing({ title: "A Fúria do Assassino", description: "Robin Hobb - Suma - Capa Mole" }),
    works,
    0.62
  );
  assert.equal(result, null);
});

test("edição inglesa da Gollancz entra", () => {
  const result = matchListing(
    listing({
      title:
        "The Well of Ascension: Mistborn Book Two, de Brandon Sanderson. Editorial Gollancz, Capa Mole em Inglês, 2010"
    }),
    works,
    0.62
  );
  assert.ok(result);
  assert.equal(result?.work.key, "the-well-of-ascension--brandon-sanderson");
  assert.ok(result!.score >= 0.8);
});

test("ISBN exato vence", () => {
  const result = matchListing(
    listing({
      title: "Livro importado",
      description: "ISBN 9780007562275 Robin Hobb HarperVoyager"
    }),
    works,
    0.62
  );
  assert.ok(result);
  assert.equal(result?.work.key, "assassin-s-quest--robin-hobb");
  assert.equal(result?.score, 1);
});

test("box genérico não vira Secret History", () => {
  const result = matchListing(
    listing({ title: "box mistborn trilogy brandon sanderson", description: "Box com 3 livros" }),
    works,
    0.62
  );
  assert.equal(result, null);
});

test("descrição não sequestra o título", () => {
  const result = matchListing(
    listing({ title: "Dune", description: "Mistborn Brandon Sanderson" }),
    works,
    0.62
  );
  assert.equal(result, null);
});

test("Royal Assassin não é confundido com Assassin's Quest", () => {
  const result = matchListing(
    listing({ title: "Royal Assassin", description: "Robin Hobb HarperVoyager paperback" }),
    works,
    0.62
  );
  assert.ok(result);
  assert.equal(result?.work.key, "royal-assassin--robin-hobb");
});

const fireBlood = work({
  key: "fire-blood--george-r-r-martin",
  title: "Fire & Blood",
  author: "George R. R. Martin",
  series: "A Song of Ice and Fire",
  preferred_publishers: ["Bantam"]
});

const strengthOfFew = work({
  key: "the-strength-of-the-few--james-islington",
  title: "The Strength of the Few",
  author: "James Islington",
  series: "Hierarchy",
  preferred_publishers: ["Orbit"]
});

const swordCitadel = work({
  key: "sword-citadel--gene-wolfe",
  title: "Sword & Citadel",
  author: "Gene Wolfe",
  series: "The Book of the New Sun",
  preferred_publishers: ["Tor"]
});

const memoryEmpire = work({
  key: "a-memory-called-empire--arkady-martine",
  title: "A Memory Called Empire",
  author: "Arkady Martine",
  series: "Teixcalaan",
  preferred_publishers: ["Tor"]
});

const dungeonCarl = work({
  key: "dungeon-crawler-carl--matt-dinniman",
  title: "Dungeon Crawler Carl",
  author: "Matt Dinniman",
  series: "Dungeon Crawler Carl",
  preferred_publishers: ["Ace"]
});

const bloodAndBoneSet = work({
  key: "of-blood-and-bone-set--john-gwynne",
  title: "Of Blood and Bone Series 3 Books Collection Set",
  author: "John Gwynne",
  series: "Of Blood and Bone",
  preferred_publishers: ["Orbit"],
  notes: "Keepa set"
});

test("kit/box não casa com obra de volume único", () => {
  const kit = matchListing(
    listing({
      title: "Kit 3 Livros Mistborn Wax & Wayne V. 1 2 3 Brandon Sanderson",
      description: "Brandon Sanderson kit com 3 livros"
    }),
    works,
    0.55
  );
  assert.equal(kit, null);

  const box = matchListing(
    listing({
      title: "Mistborn Trilogy Box Set 3 Books Brandon Sanderson",
      description: "Box com 3 livros"
    }),
    works,
    0.55
  );
  assert.equal(box, null);
});

test("set de outra série não casa com obra de volume único", () => {
  const result = matchListing(
    listing({
      title: "livros george r.r.martin game of thrones '6' livros",
      description: "George R. R. Martin - 6 livros"
    }),
    [fireBlood],
    0.55
  );
  assert.equal(result, null);
});

test("título fraco não casa por autor/série", () => {
  const power = matchListing(
    listing({
      title: "The Power Of Few - Livro De Fantasia De Islington Em Inglês",
      description: "James Islington"
    }),
    [strengthOfFew],
    0.55
  );
  assert.equal(power, null);

  const urth = matchListing(
    listing({
      title: "livro the urth of the new sun gene wolfe",
      description: "Gene Wolfe - usado"
    }),
    [swordCitadel],
    0.55
  );
  assert.equal(urth, null);
});

test("edição PT não casa com obra inglesa", () => {
  const memory = matchListing(
    listing({
      title: "Uma Memória Chamada Empire Arkady Martine English Tor Books Paper",
      description: "Arkady Martine - Tor Books"
    }),
    [memoryEmpire],
    0.55
  );
  assert.equal(memory, null);

  const carl = matchListing(
    listing({
      title: "Cenário Apocalíptico De Carl Matt Dinniman English Ace Books Hard",
      description: "Matt Dinniman - Ace Books"
    }),
    [dungeonCarl],
    0.55
  );
  assert.equal(carl, null);
});

test("set casa com set da mesma série", () => {
  const result = matchListing(
    listing({
      title: "Of Blood and Bone Series 3 Books Collection Set by John Gwynne",
      description: "John Gwynne - 3 books collection set - paperback"
    }),
    [bloodAndBoneSet],
    0.55
  );
  assert.ok(result);
  assert.equal(result?.work.key, "of-blood-and-bone-set--john-gwynne");
});
