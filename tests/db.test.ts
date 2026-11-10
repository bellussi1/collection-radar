import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RadarDb } from "../src/db.js";
import type { RawListing, Work } from "../src/types.js";

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
    sellerRating: null,
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

test("histórico guarda primeira, menor e mudanças de preço", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-db-"));
  const db = new RadarDb(join(dir, "radar.db"));
  try {
    const first = db.upsertListing(
      listing({ externalId: "MLB123", url: "https://example.com/1", price: 100 })
    );
    db.upsertListing(
      listing({ externalId: "MLB123", url: "https://example.com/1", price: 80 })
    );
    db.upsertListing(
      listing({ externalId: "MLB123", url: "https://example.com/1", price: 80 })
    );

    const work: Work = {
      key: "the-well-of-ascension--brandon-sanderson",
      title: "The Well of Ascension",
      author: "Brandon Sanderson",
      series: "Mistborn",
      volume: 2,
      status: "",
      language: "en",
      priority: 1,
      enabled: true,
      aliases: [],
      preferred_publishers: [],
      preferred_formats: [],
      isbn13: "",
      max_price: 150,
      notes: ""
    };
    db.recordMatch(first.id, {
      work,
      score: 0.9,
      reasons: ["título"],
      language: "en",
      format: "paperback",
      publisher: null
    });

    const row = db.listDashboardMatches()[0];
    assert.equal(row?.firstTotal, 100);
    assert.equal(row?.minTotal, 80);
    assert.equal(row?.priceChanges, 2);
    assert.equal(row?.listing.price, 80);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("alerta guarda o total para comparar quedas futuras", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-db-"));
  const db = new RadarDb(join(dir, "radar.db"));
  try {
    const key = "the-hobbit--j-r-r-tolkien";
    db.markAlerted(1, key, "email", 100);
    assert.equal(db.wasAlerted(1, key, "email"), true);
    assert.equal(db.getAlertTotal(1, key, "email"), 100);

    db.markAlerted(1, key, "email", 80);
    assert.equal(db.getAlertTotal(1, key, "email"), 80);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listing guarda nota do vendedor e nota de preço", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-db-"));
  const db = new RadarDb(join(dir, "radar.db"));
  try {
    db.upsertListing(
      listing({
        externalId: "AB1",
        url: "https://example.com/ab1",
        seller: "Rarewaves",
        sellerRating: 5,
        condition: "usado",
        priceNote: "US$ 19.15 · câmbio 5,52"
      })
    );
    const row = db.listAllListings()[0];
    assert.equal(row?.sellerRating, 5);
    assert.equal(row?.priceNote, "US$ 19.15 · câmbio 5,52");
    assert.equal(row?.condition, "usado");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cache de OCR e resultado por obra persistem", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-db-"));
  const db = new RadarDb(join(dir, "radar.db"));
  try {
    const url = "https://example.com/cover.jpg";
    const key = "the-hobbit--j-r-r-tolkien";
    db.saveImageOcr(url, "THE HOBBIT J.R.R. TOLKIEN", 88);
    assert.deepEqual(db.getImageOcr(url), {
      text: "THE HOBBIT J.R.R. TOLKIEN",
      confidence: 88
    });

    db.saveOcrCheck(42, key, "THE HOBBIT J.R.R. TOLKIEN", 0.95, 88);
    assert.deepEqual(db.getOcrCheck(42, key), {
      text: "THE HOBBIT J.R.R. TOLKIEN",
      score: 0.95,
      confidence: 88
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
