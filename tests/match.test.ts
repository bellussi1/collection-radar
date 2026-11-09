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

test("Royal Assassin não é confundido com Assassin's Quest", () => {
  const result = matchListing(
    listing({ title: "Royal Assassin", description: "Robin Hobb HarperVoyager paperback" }),
    works,
    0.62
  );
  assert.ok(result);
  assert.equal(result?.work.key, "royal-assassin--robin-hobb");
});
