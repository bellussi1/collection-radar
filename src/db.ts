import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { MatchResult, RawListing, StoredListing } from "./types.js";

interface ListingRow {
  id: number;
  source: string;
  external_id: string;
  url: string;
  title: string;
  price: number | null;
  shipping: number | null;
  total: number | null;
  currency: string;
  seller: string | null;
  location: string | null;
  condition: string | null;
  description: string | null;
  image_url: string | null;
  first_seen: string;
  last_seen: string;
}

export class RadarDb {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS listings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        external_id TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        price REAL,
        shipping REAL,
        total REAL,
        currency TEXT NOT NULL DEFAULT 'BRL',
        seller TEXT,
        location TEXT,
        condition TEXT,
        description TEXT,
        image_url TEXT,
        first_seen TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        raw_json TEXT,
        UNIQUE(source, external_id)
      );
      CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL,
        work_key TEXT NOT NULL,
        score REAL NOT NULL,
        reasons TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(listing_id, work_key)
      );
      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL,
        work_key TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        channel TEXT NOT NULL,
        UNIQUE(listing_id, work_key, channel)
      );
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        source TEXT,
        query TEXT,
        found INTEGER DEFAULT 0,
        new_listings INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings(first_seen);
      CREATE INDEX IF NOT EXISTS idx_matches_work_key ON matches(work_key);
    `);
  }

  upsertListing(listing: RawListing): { id: number; isNew: boolean } {
    const now = new Date().toISOString();
    const total =
      listing.price === null ? null : listing.price + (listing.shipping ?? 0);
    const existing = this.db
      .prepare("SELECT id, first_seen FROM listings WHERE url = ?")
      .get(listing.url) as { id: number; first_seen: string } | undefined;

    if (existing) {
      this.db
        .prepare(`
          UPDATE listings
          SET title = ?, price = ?, shipping = ?, total = ?, seller = ?, location = ?,
              condition = ?, description = ?, image_url = ?, last_seen = ?, raw_json = ?
          WHERE id = ?
        `)
        .run(
          listing.title,
          listing.price,
          listing.shipping,
          total,
          listing.seller,
          listing.location,
          listing.condition,
          listing.description,
          listing.imageUrl,
          now,
          listing.raw ? JSON.stringify(listing.raw) : null,
          existing.id
        );
      return { id: existing.id, isNew: false };
    }

    const result = this.db
      .prepare(`
        INSERT INTO listings
          (source, external_id, url, title, price, shipping, total, currency, seller,
           location, condition, description, image_url, first_seen, last_seen, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        listing.source,
        listing.externalId,
        listing.url,
        listing.title,
        listing.price,
        listing.shipping,
        total,
        listing.currency,
        listing.seller,
        listing.location,
        listing.condition,
        listing.description,
        listing.imageUrl,
        now,
        now,
        listing.raw ? JSON.stringify(listing.raw) : null
      );
    return { id: Number(result.lastInsertRowid), isNew: true };
  }

  recordMatch(listingId: number, match: MatchResult): void {
    const now = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO matches (listing_id, work_key, score, reasons, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(listing_id, work_key) DO UPDATE SET
          score = excluded.score,
          reasons = excluded.reasons
      `)
      .run(listingId, match.work.key, match.score, match.reasons.join(", "), now);
  }

  wasAlerted(listingId: number, workKey: string, channel: string): boolean {
    const row = this.db
      .prepare("SELECT 1 AS ok FROM alerts WHERE listing_id = ? AND work_key = ? AND channel = ?")
      .get(listingId, workKey, channel) as { ok: number } | undefined;
    return Boolean(row);
  }

  markAlerted(listingId: number, workKey: string, channel: string): void {
    this.db
      .prepare(`
        INSERT OR IGNORE INTO alerts (listing_id, work_key, sent_at, channel)
        VALUES (?, ?, ?, ?)
      `)
      .run(listingId, workKey, new Date().toISOString(), channel);
  }

  startRun(source: string, query: string): number {
    const result = this.db
      .prepare("INSERT INTO runs (started_at, source, query) VALUES (?, ?, ?)")
      .run(new Date().toISOString(), source, query);
    return Number(result.lastInsertRowid);
  }

  finishRun(runId: number, found: number, newListings: number, errors: number): void {
    this.db
      .prepare(`
        UPDATE runs SET finished_at = ?, found = ?, new_listings = ?, errors = ? WHERE id = ?
      `)
      .run(new Date().toISOString(), found, newListings, errors, runId);
  }

  listRecentMatches(sinceIso: string, minScore: number): Array<{ listing: StoredListing; workKey: string; score: number; reasons: string }> {
    const rows = this.db
      .prepare(`
        SELECT l.*, m.work_key AS match_work_key, m.score AS match_score, m.reasons AS match_reasons
        FROM listings l
        JOIN matches m ON m.listing_id = l.id
        WHERE l.first_seen >= ? AND m.score >= ?
        ORDER BY m.score DESC, l.total ASC
        LIMIT 500
      `)
      .all(sinceIso, minScore) as unknown as Array<
        ListingRow & { match_work_key: string; match_score: number; match_reasons: string }
      >;

    return rows.map((row) => ({
      listing: {
        id: row.id,
        source: row.source as StoredListing["source"],
        externalId: row.external_id,
        url: row.url,
        title: row.title,
        price: row.price,
        shipping: row.shipping,
        currency: "BRL",
        seller: row.seller,
        location: row.location,
        condition: row.condition,
        description: row.description,
        imageUrl: row.image_url,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        isNew: row.first_seen === row.last_seen
      },
      workKey: row.match_work_key,
      score: row.match_score,
      reasons: row.match_reasons
    }));
  }

  countListings(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM listings").get() as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}
