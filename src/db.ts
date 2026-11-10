import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ImageHashes } from "./coverhash.js";
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
  seller_rating: number | null;
  price_note: string | null;
  first_seen: string;
  last_seen: string;
}

export interface DashboardMatch {
  listing: StoredListing;
  workKey: string;
  score: number;
  reasons: string;
  feedbackStatus: string | null;
  owned: boolean;
  coverDistance: number | null;
  knownCoverUrl: string | null;
  firstTotal: number | null;
  minTotal: number | null;
  priceChanges: number;
  ocrScore: number | null;
  ocrText: string | null;
  ocrConfidence: number | null;
}

export interface CoverCheck {
  distance: number;
  knownUrl: string | null;
}

export interface OwnedWork {
  workKey: string;
  title: string;
  format: string | null;
  price: number | null;
  acquiredAt: string;
  notes: string | null;
}

export interface SourceHealth {
  source: string;
  lastRunAt: string;
  finishedAt: string | null;
  queries: number;
  listings: number;
  newListings: number;
  errors: number;
  blocked: boolean;
  note: string | null;
}

function mapListing(row: ListingRow): StoredListing {
  return {
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
    sellerRating: row.seller_rating,
    priceNote: row.price_note,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    isNew: row.first_seen === row.last_seen
  };
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
        seller_rating REAL,
        price_note TEXT,
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
        total REAL,
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
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback (
        listing_id INTEGER NOT NULL,
        work_key TEXT NOT NULL,
        status TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (listing_id, work_key)
      );
      CREATE TABLE IF NOT EXISTS owned (
        work_key TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        format TEXT,
        price REAL,
        acquired_at TEXT NOT NULL,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS image_hashes (
        url TEXT PRIMARY KEY,
        hash_full TEXT NOT NULL,
        hash_center TEXT NOT NULL,
        hash_trim TEXT NOT NULL,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS work_covers (
        work_key TEXT PRIMARY KEY,
        url TEXT,
        checked_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS cover_checks (
        listing_id INTEGER NOT NULL,
        work_key TEXT NOT NULL,
        distance INTEGER NOT NULL,
        known_url TEXT,
        listing_url TEXT,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (listing_id, work_key)
      );
      CREATE TABLE IF NOT EXISTS price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL,
        price REAL,
        shipping REAL,
        total REAL,
        seen_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS image_ocr (
        url TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        confidence REAL,
        fetched_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ocr_checks (
        listing_id INTEGER NOT NULL,
        work_key TEXT NOT NULL,
        text TEXT NOT NULL,
        score REAL NOT NULL,
        confidence REAL,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (listing_id, work_key)
      );
      CREATE TABLE IF NOT EXISTS source_health (
        source TEXT PRIMARY KEY,
        last_run_at TEXT NOT NULL,
        finished_at TEXT,
        queries INTEGER DEFAULT 0,
        listings INTEGER DEFAULT 0,
        new_listings INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        blocked INTEGER DEFAULT 0,
        note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_listings_first_seen ON listings(first_seen);
      CREATE INDEX IF NOT EXISTS idx_matches_work_key ON matches(work_key);
      CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);
      CREATE INDEX IF NOT EXISTS idx_price_history_listing ON price_history(listing_id, seen_at);
    `);

    // Primeira abertura depois da tabela nova: resume a última rodada de cada
    // fonte a partir dos runs já gravados. A janela de 2h agrupa as consultas
    // da mesma execução sem precisar de um id de lote no histórico antigo.
    const healthCount = this.db
      .prepare("SELECT COUNT(*) AS count FROM source_health")
      .get() as unknown as { count: number };
    if (Number(healthCount.count) === 0) {
      this.db.exec(`
        INSERT INTO source_health
          (source, last_run_at, finished_at, queries, listings, new_listings, errors, blocked, note)
        SELECT
          r.source,
          l.last_started,
          MAX(r.finished_at),
          COUNT(*),
          COALESCE(SUM(r.found), 0),
          COALESCE(SUM(r.new_listings), 0),
          COALESCE(SUM(r.errors), 0),
          0,
          NULL
        FROM runs r
        JOIN (
          SELECT source, MAX(started_at) AS last_started
          FROM runs
          WHERE source IS NOT NULL
          GROUP BY source
        ) l ON l.source = r.source
        WHERE julianday(r.started_at) >= julianday(l.last_started) - (2.0 / 24.0)
        GROUP BY r.source, l.last_started
      `);
    }

    const alertColumns = this.db.prepare("PRAGMA table_info(alerts)").all() as unknown as Array<{
      name: string;
    }>;
    if (!alertColumns.some((column) => column.name === "total")) {
      this.db.exec("ALTER TABLE alerts ADD COLUMN total REAL");
    }

    const listingColumns = this.db
      .prepare("PRAGMA table_info(listings)")
      .all() as unknown as Array<{ name: string }>;
    if (!listingColumns.some((column) => column.name === "seller_rating")) {
      this.db.exec("ALTER TABLE listings ADD COLUMN seller_rating REAL");
    }
    if (!listingColumns.some((column) => column.name === "price_note")) {
      this.db.exec("ALTER TABLE listings ADD COLUMN price_note TEXT");
    }
    this.db.exec(`
      UPDATE alerts
      SET total = (SELECT l.total FROM listings l WHERE l.id = alerts.listing_id)
      WHERE total IS NULL
    `);

    // Baseline para anúncios que já existiam antes do histórico de preço.
    this.db.exec(`
      INSERT INTO price_history (listing_id, price, shipping, total, seen_at)
      SELECT id, price, shipping, total, first_seen FROM listings
      WHERE NOT EXISTS (SELECT 1 FROM price_history ph WHERE ph.listing_id = listings.id)
    `);
  }

  upsertListing(listing: RawListing): { id: number; isNew: boolean } {
    const now = new Date().toISOString();
    const total = listing.price === null ? null : listing.price + (listing.shipping ?? 0);
    const existing = this.db
      .prepare(
        "SELECT id, price, shipping, total FROM listings WHERE (source = ? AND external_id = ?) OR url = ? LIMIT 1"
      )
      .get(listing.source, listing.externalId, listing.url) as
      | { id: number; price: number | null; shipping: number | null; total: number | null }
      | undefined;

    if (existing) {
      this.db
        .prepare(`
          UPDATE listings
          SET source = ?, external_id = ?, url = ?, title = ?, price = ?, shipping = ?,
              total = ?, seller = ?, location = ?, condition = ?, description = ?,
              image_url = ?, seller_rating = ?, price_note = ?, last_seen = ?, raw_json = ?
          WHERE id = ?
        `)
        .run(
          listing.source,
          listing.externalId,
          listing.url,
          listing.title,
          listing.price,
          listing.shipping,
          total,
          listing.seller,
          listing.location,
          listing.condition,
          listing.description,
          listing.imageUrl,
          listing.sellerRating,
          listing.priceNote ?? null,
          now,
          listing.raw ? JSON.stringify(listing.raw) : null,
          existing.id
        );
      if (listing.price !== existing.price || total !== existing.total) {
        this.recordPriceHistory(existing.id, listing.price, listing.shipping, total, now);
      }
      return { id: existing.id, isNew: false };
    }

    const result = this.db
      .prepare(`
        INSERT INTO listings
          (source, external_id, url, title, price, shipping, total, currency, seller,
           location, condition, description, image_url, seller_rating, price_note,
           first_seen, last_seen, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        listing.sellerRating,
        listing.priceNote ?? null,
        now,
        now,
        listing.raw ? JSON.stringify(listing.raw) : null
      );
    const id = Number(result.lastInsertRowid);
    this.recordPriceHistory(id, listing.price, listing.shipping, total, now);
    return { id, isNew: true };
  }

  private recordPriceHistory(
    listingId: number,
    price: number | null,
    shipping: number | null,
    total: number | null,
    seenAt: string
  ): void {
    this.db
      .prepare(`
        INSERT INTO price_history (listing_id, price, shipping, total, seen_at)
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(listingId, price, shipping, total, seenAt);
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

  markAlerted(
    listingId: number,
    workKey: string,
    channel: string,
    total: number | null = null
  ): void {
    this.db
      .prepare(`
        INSERT INTO alerts (listing_id, work_key, sent_at, channel, total)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(listing_id, work_key, channel) DO UPDATE SET
          sent_at = excluded.sent_at,
          total = excluded.total
      `)
      .run(listingId, workKey, new Date().toISOString(), channel, total);
  }

  getAlertTotal(listingId: number, workKey: string, channel: string): number | null {
    const row = this.db
      .prepare("SELECT total FROM alerts WHERE listing_id = ? AND work_key = ? AND channel = ?")
      .get(listingId, workKey, channel) as { total: number | null } | undefined;
    return row?.total ?? null;
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

  recordSourceHealth(health: SourceHealth): void {
    this.db
      .prepare(`
        INSERT INTO source_health
          (source, last_run_at, finished_at, queries, listings, new_listings, errors, blocked, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
          last_run_at = excluded.last_run_at,
          finished_at = excluded.finished_at,
          queries = excluded.queries,
          listings = excluded.listings,
          new_listings = excluded.new_listings,
          errors = excluded.errors,
          blocked = excluded.blocked,
          note = excluded.note
      `)
      .run(
        health.source,
        health.lastRunAt,
        health.finishedAt,
        health.queries,
        health.listings,
        health.newListings,
        health.errors,
        health.blocked ? 1 : 0,
        health.note
      );
  }

  listSourceHealth(): SourceHealth[] {
    const rows = this.db
      .prepare("SELECT * FROM source_health ORDER BY source")
      .all() as unknown as Array<{
      source: string;
      last_run_at: string;
      finished_at: string | null;
      queries: number | null;
      listings: number | null;
      new_listings: number | null;
      errors: number | null;
      blocked: number | null;
      note: string | null;
    }>;
    return rows.map((row) => ({
      source: row.source,
      lastRunAt: row.last_run_at,
      finishedAt: row.finished_at,
      queries: Number(row.queries ?? 0),
      listings: Number(row.listings ?? 0),
      newListings: Number(row.new_listings ?? 0),
      errors: Number(row.errors ?? 0),
      blocked: Boolean(row.blocked),
      note: row.note
    }));
  }

  listRecentMatches(
    sinceIso: string,
    minScore: number
  ): Array<{ listing: StoredListing; workKey: string; score: number; reasons: string }> {
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
      listing: mapListing(row),
      workKey: row.match_work_key,
      score: row.match_score,
      reasons: row.match_reasons
    }));
  }

  listAllListings(): StoredListing[] {
    const rows = this.db
      .prepare("SELECT * FROM listings ORDER BY first_seen DESC")
      .all() as unknown as ListingRow[];
    return rows.map(mapListing);
  }

  listRawListings(): Array<{ id: number; seller: string | null; rawJson: string | null }> {
    const rows = this.db
      .prepare("SELECT id, seller, raw_json FROM listings WHERE raw_json IS NOT NULL")
      .all() as unknown as Array<{ id: number; seller: string | null; raw_json: string | null }>;
    return rows.map((row) => ({ id: row.id, seller: row.seller, rawJson: row.raw_json }));
  }

  setSellerRating(listingId: number, rating: number | null): void {
    this.db.prepare("UPDATE listings SET seller_rating = ? WHERE id = ?").run(rating, listingId);
  }

  clearMatches(): void {
    this.db.exec("DELETE FROM matches");
  }

  listDashboardMatches(limit = 2000): DashboardMatch[] {
    const rows = this.db
      .prepare(`
        SELECT l.*, m.work_key AS match_work_key, m.score AS match_score,
               m.reasons AS match_reasons, f.status AS feedback_status,
               CASE WHEN o.work_key IS NULL THEN 0 ELSE 1 END AS owned,
               cc.distance AS cover_distance, cc.known_url AS cover_known_url,
               oc.score AS ocr_score, oc.text AS ocr_text, oc.confidence AS ocr_confidence,
               (SELECT ph.total FROM price_history ph WHERE ph.listing_id = l.id
                 ORDER BY ph.seen_at ASC, ph.id ASC LIMIT 1) AS first_total,
               (SELECT MIN(ph.total) FROM price_history ph WHERE ph.listing_id = l.id) AS min_total,
               (SELECT COUNT(*) FROM price_history ph WHERE ph.listing_id = l.id) AS price_changes
        FROM matches m
        JOIN listings l ON l.id = m.listing_id
        LEFT JOIN feedback f ON f.listing_id = m.listing_id AND f.work_key = m.work_key
        LEFT JOIN owned o ON o.work_key = m.work_key
        LEFT JOIN cover_checks cc ON cc.listing_id = m.listing_id AND cc.work_key = m.work_key
        LEFT JOIN ocr_checks oc ON oc.listing_id = m.listing_id AND oc.work_key = m.work_key
        ORDER BY l.first_seen DESC, m.score DESC
        LIMIT ?
      `)
      .all(limit) as unknown as Array<
      ListingRow & {
        match_work_key: string;
        match_score: number;
        match_reasons: string;
        feedback_status: string | null;
        owned: number;
        cover_distance: number | null;
        cover_known_url: string | null;
        ocr_score: number | null;
        ocr_text: string | null;
        ocr_confidence: number | null;
        first_total: number | null;
        min_total: number | null;
        price_changes: number;
      }
    >;

    return rows.map((row) => ({
      listing: mapListing(row),
      workKey: row.match_work_key,
      score: row.match_score,
      reasons: row.match_reasons,
      feedbackStatus: row.feedback_status,
      owned: Boolean(row.owned),
      coverDistance: row.cover_distance,
      knownCoverUrl: row.cover_known_url,
      firstTotal: row.first_total,
      minTotal: row.min_total,
      priceChanges: row.price_changes,
      ocrScore: row.ocr_score,
      ocrText: row.ocr_text,
      ocrConfidence: row.ocr_confidence
    }));
  }

  getImageHashes(url: string): ImageHashes | null {
    const row = this.db
      .prepare("SELECT hash_full, hash_center, hash_trim FROM image_hashes WHERE url = ?")
      .get(url) as { hash_full: string; hash_center: string; hash_trim: string } | undefined;
    if (!row) return null;
    return { full: row.hash_full, center: row.hash_center, trim: row.hash_trim };
  }

  saveImageHashes(url: string, hashes: ImageHashes): void {
    this.db
      .prepare(`
        INSERT INTO image_hashes (url, hash_full, hash_center, hash_trim, fetched_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          hash_full = excluded.hash_full,
          hash_center = excluded.hash_center,
          hash_trim = excluded.hash_trim,
          fetched_at = excluded.fetched_at
      `)
      .run(url, hashes.full, hashes.center, hashes.trim, new Date().toISOString());
  }

  getWorkCover(workKey: string): { url: string | null; checkedAt: string } | null {
    const row = this.db
      .prepare("SELECT url, checked_at FROM work_covers WHERE work_key = ?")
      .get(workKey) as { url: string | null; checked_at: string } | undefined;
    return row ? { url: row.url, checkedAt: row.checked_at } : null;
  }

  saveWorkCover(workKey: string, url: string | null): void {
    this.db
      .prepare(`
        INSERT INTO work_covers (work_key, url, checked_at) VALUES (?, ?, ?)
        ON CONFLICT(work_key) DO UPDATE SET url = excluded.url, checked_at = excluded.checked_at
      `)
      .run(workKey, url, new Date().toISOString());
  }

  getCoverCheck(listingId: number, workKey: string): CoverCheck | null {
    const row = this.db
      .prepare("SELECT distance, known_url FROM cover_checks WHERE listing_id = ? AND work_key = ?")
      .get(listingId, workKey) as { distance: number; known_url: string | null } | undefined;
    return row ? { distance: row.distance, knownUrl: row.known_url } : null;
  }

  saveCoverCheck(
    listingId: number,
    workKey: string,
    distance: number,
    knownUrl: string | null,
    listingUrl: string
  ): void {
    this.db
      .prepare(`
        INSERT INTO cover_checks
          (listing_id, work_key, distance, known_url, listing_url, checked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(listing_id, work_key) DO UPDATE SET
          distance = excluded.distance,
          known_url = excluded.known_url,
          listing_url = excluded.listing_url,
          checked_at = excluded.checked_at
      `)
      .run(listingId, workKey, distance, knownUrl, listingUrl, new Date().toISOString());
  }

  getImageOcr(url: string): { text: string; confidence: number | null } | null {
    const row = this.db.prepare("SELECT text, confidence FROM image_ocr WHERE url = ?").get(url) as
      | { text: string; confidence: number | null }
      | undefined;
    return row ? { text: row.text, confidence: row.confidence } : null;
  }

  saveImageOcr(url: string, text: string, confidence: number | null): void {
    this.db
      .prepare(`
        INSERT INTO image_ocr (url, text, confidence, fetched_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          text = excluded.text,
          confidence = excluded.confidence,
          fetched_at = excluded.fetched_at
      `)
      .run(url, text, confidence, new Date().toISOString());
  }

  getOcrCheck(
    listingId: number,
    workKey: string
  ): { text: string; score: number; confidence: number | null } | null {
    const row = this.db
      .prepare(
        "SELECT text, score, confidence FROM ocr_checks WHERE listing_id = ? AND work_key = ?"
      )
      .get(listingId, workKey) as
      | { text: string; score: number; confidence: number | null }
      | undefined;
    return row ? { text: row.text, score: row.score, confidence: row.confidence } : null;
  }

  saveOcrCheck(
    listingId: number,
    workKey: string,
    text: string,
    score: number,
    confidence: number | null
  ): void {
    this.db
      .prepare(`
        INSERT INTO ocr_checks (listing_id, work_key, text, score, confidence, checked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(listing_id, work_key) DO UPDATE SET
          text = excluded.text,
          score = excluded.score,
          confidence = excluded.confidence,
          checked_at = excluded.checked_at
      `)
      .run(listingId, workKey, text, score, confidence, new Date().toISOString());
  }

  setFeedback(
    listingId: number,
    workKey: string,
    status: string,
    note: string | null = null
  ): void {
    this.db
      .prepare(`
        INSERT INTO feedback (listing_id, work_key, status, note, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(listing_id, work_key) DO UPDATE SET
          status = excluded.status,
          note = excluded.note,
          created_at = excluded.created_at
      `)
      .run(listingId, workKey, status, note, new Date().toISOString());
  }

  clearFeedback(listingId: number, workKey: string): void {
    this.db
      .prepare("DELETE FROM feedback WHERE listing_id = ? AND work_key = ?")
      .run(listingId, workKey);
  }

  isSuppressed(listingId: number, workKey: string): boolean {
    const feedback = this.db
      .prepare(`
        SELECT 1 AS ok FROM feedback
        WHERE listing_id = ? AND work_key = ?
          AND status IN ('ignored', 'bought', 'wrong_edition')
      `)
      .get(listingId, workKey) as { ok: number } | undefined;
    if (feedback) return true;
    const owned = this.db.prepare("SELECT 1 AS ok FROM owned WHERE work_key = ?").get(workKey) as
      | { ok: number }
      | undefined;
    return Boolean(owned);
  }

  addOwned(
    workKey: string,
    title: string,
    format: string | null = null,
    price: number | null = null,
    notes: string | null = null
  ): void {
    this.db
      .prepare(`
        INSERT INTO owned (work_key, title, format, price, acquired_at, notes)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(work_key) DO UPDATE SET
          title = excluded.title,
          format = excluded.format,
          price = excluded.price,
          notes = excluded.notes
      `)
      .run(workKey, title, format, price, new Date().toISOString(), notes);
  }

  removeOwned(workKey: string): void {
    this.db.prepare("DELETE FROM owned WHERE work_key = ?").run(workKey);
    this.db.prepare("DELETE FROM feedback WHERE work_key = ? AND status = 'bought'").run(workKey);
  }

  listOwned(): OwnedWork[] {
    const rows = this.db
      .prepare("SELECT * FROM owned ORDER BY acquired_at DESC")
      .all() as unknown as Array<{
      work_key: string;
      title: string;
      format: string | null;
      price: number | null;
      acquired_at: string;
      notes: string | null;
    }>;
    return rows.map((row) => ({
      workKey: row.work_key,
      title: row.title,
      format: row.format,
      price: row.price,
      acquiredAt: row.acquired_at,
      notes: row.notes
    }));
  }

  listOwnedKeys(): string[] {
    return (
      this.db.prepare("SELECT work_key FROM owned").all() as unknown as Array<{
        work_key: string;
      }>
    ).map((row) => row.work_key);
  }

  countListings(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM listings").get() as {
      count: number;
    };
    return row.count;
  }

  getKv(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setKv(key: string, value: string): void {
    this.db
      .prepare(`
        INSERT INTO kv (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(key, value);
  }

  close(): void {
    this.db.close();
  }
}
