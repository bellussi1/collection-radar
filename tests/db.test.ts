import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RadarDb } from "../src/db.js";
import type { RawListing } from "../src/types.js";

function listing(partial: Partial<RawListing> & Pick<RawListing, "url" | "externalId">): RawListing {
  return {
    source: "mercadolivre",
    title: "The Well of Ascension",
    price: 100,
    shipping: 0,
    currency: "BRL",
    seller: "loja",
    location: "São Paulo",
    condition: "novo",
    description: "Brandon Sanderson",
    imageUrl: null,
    ...partial
  };
}

test("upsert não duplica o mesmo anúncio quando a URL muda", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-db-"));
  const db = new RadarDb(join(dir, "radar.db"));
  try {
    const first = db.upsertListing(
      listing({ externalId: "MLB123", url: "https://produto.mercadolivre.com.br/MLB-123?tracking=1" })
    );
    const second = db.upsertListing(
      listing({ externalId: "MLB123", url: "https://produto.mercadolivre.com.br/MLB-123?tracking=2" })
    );
    assert.equal(first.isNew, true);
    assert.equal(second.isNew, false);
    assert.equal(db.countListings(), 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
