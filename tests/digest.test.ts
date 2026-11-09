import assert from "node:assert/strict";
import test from "node:test";
import { buildDigest } from "../src/digest.js";
import type { ScanStats } from "../src/types.js";

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
  const digest = buildDigest([], stats({
    sourceHealth: {
      olx: { queries: 5, listings: 0, errors: 0, blocked: false }
    }
  }));
  assert.match(digest.text, /OLX: 0 anúncios em 5 consultas \(atenção\)/);
});

test("digest avisa quando uma fonte foi bloqueada", () => {
  const digest = buildDigest([], stats({
    sourceHealth: {
      mercadolivre: { queries: 3, listings: 0, errors: 1, blocked: true }
    }
  }));
  assert.match(digest.text, /Mercado Livre: bloqueado/);
});
