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

test("cache de capas e resultado da comparação persistem", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-db-"));
  const db = new RadarDb(join(dir, "radar.db"));
  try {
    const url = "https://example.com/cover.jpg";
    db.saveImageHashes(url, {
      full: "0123456789abcdef",
      center: "fedcba9876543210",
      trim: "00000000000000ff"
    });
    assert.deepEqual(db.getImageHashes(url), {
      full: "0123456789abcdef",
      center: "fedcba9876543210",
      trim: "00000000000000ff"
    });

    db.saveWorkCover("the-hobbit--j-r-r-tolkien", url);
    assert.equal(db.getWorkCover("the-hobbit--j-r-r-tolkien")?.url, url);

    db.saveCoverCheck(42, "the-hobbit--j-r-r-tolkien", 7, url, "https://example.com/listing.jpg");
    assert.deepEqual(db.getCoverCheck(42, "the-hobbit--j-r-r-tolkien"), {
      distance: 7,
      knownUrl: url
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("obra comprada fica suprimida até ser removida da coleção", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-db-"));
  const db = new RadarDb(join(dir, "radar.db"));
  try {
    const key = "the-hobbit--j-r-r-tolkien";
    assert.equal(db.isSuppressed(123, key), false);

    db.addOwned(key, "The Hobbit", "paperback", 42);
    assert.equal(db.isSuppressed(123, key), true);
    assert.deepEqual(db.listOwnedKeys(), [key]);

    db.removeOwned(key);
    assert.equal(db.isSuppressed(123, key), false);
    assert.deepEqual(db.listOwnedKeys(), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
