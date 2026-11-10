import assert from "node:assert/strict";
import test from "node:test";
import { buildDigest, type DigestItem } from "../src/digest.js";
import type { ScanStats, StoredListing, Work } from "../src/types.js";

function stats(partial: Partial<ScanStats> = {}): ScanStats {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    queries: 10,
    pages: 10,
    listings: 100,
    newListings: 100,
    matches: 0,
    errors: 0,
    bySource: {},
    sourceHealth: {},
    ...partial
  };
}

test("digest avisa quando uma fonte retorna zero anúncios", () => {
  const digest = buildDigest(
    [],
    stats({
      sourceHealth: {
        olx: { queries: 5, listings: 0, errors: 0, blocked: false }
      }
    })
  );
  assert.match(digest.text, /OLX: 0 anúncios em 5 consultas \(atenção\)/);
});

test("digest avisa quando uma fonte foi bloqueada", () => {
  const digest = buildDigest(
    [],
    stats({
      sourceHealth: {
        mercadolivre: { queries: 3, listings: 0, errors: 1, blocked: true }
      }
    })
  );
  assert.match(digest.text, /Mercado Livre: bloqueado/);
});

function digestItem(index: number): DigestItem {
  const work: Work = {
    key: `work-${index}`,
    title: `Book ${index}`,
    author: "Author",
    series: "",
    volume: 0,
    status: "",
    language: "en",
    priority: 1,
    enabled: true,
    aliases: [],
    preferred_publishers: [],
    preferred_formats: [],
    isbn13: "",
    max_price: 100,
    notes: ""
  };
  const now = new Date().toISOString();
  const listing: StoredListing = {
    id: index + 1,
    source: "olx",
    externalId: `external-${index}`,
    url: `https://example.com/${index}`,
    title: `Book ${index}`,
    price: 50 + index,
    shipping: 0,
    currency: "BRL",
    seller: null,
    location: null,
    condition: null,
    description: null,
    imageUrl: null,
    sellerRating: null,
    firstSeen: now,
    lastSeen: now,
    isNew: true
  };
  return {
    listing,
    work,
    score: 0.9,
    reasons: "título",
    overBudget: false
  };
}

test("digest devolve só os 20 exibidos para marcar como alertados", () => {
  const digest = buildDigest(
    Array.from({ length: 25 }, (_, index) => digestItem(index)),
    stats()
  );
  assert.equal(digest.displayed.length, 20);
  assert.match(digest.text, /25 anúncio\(s\) novo\(s\).*20 melhores no e-mail; \+5 no banco/);
});

test("digest diário usa a nota em vez de reenvio manual", () => {
  const digest = buildDigest(
    [],
    stats({ queries: 0, pages: 0, errors: 0 }),
    "http://127.0.0.1:4317",
    "Digest diário: novos matches desde o último e-mail."
  );
  assert.match(digest.text, /Digest diário: novos matches desde o último e-mail\./);
  assert.doesNotMatch(digest.text, /Reenvio manual do banco local/);
});
