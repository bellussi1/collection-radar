export type SourceName = "estante" | "olx" | "mercadolivre" | "enjoei" | "abebooks" | "shopee";

export interface RawListing {
  source: SourceName;
  externalId: string;
  url: string;
  title: string;
  price: number | null;
  shipping: number | null;
  currency: "BRL";
  seller: string | null;
  location: string | null;
  condition: string | null;
  description: string | null;
  imageUrl: string | null;
  sellerRating: number | null;
  priceNote?: string | null;
  raw?: unknown;
}

export interface Work {
  key: string;
  title: string;
  author: string;
  series: string;
  volume: number;
  status: string;
  language: string;
  priority: number;
  enabled: boolean;
  aliases: string[];
  preferred_publishers: string[];
  preferred_formats: string[];
  isbn13: string;
  max_price: number;
  notes: string;
}

export interface QueryConfig {
  term: string;
  kind: "author" | "series" | "title" | "alias" | string;
  priority: number;
  enabled: boolean;
}

export interface Settings {
  scan: {
    max_queries: number;
    limit_per_query: number;
    delay_ms: number;
    min_score: number;
    immediate_score: number;
    max_age_days: number;
    price_drop_pct: number;
  };
  sources: Record<SourceName, boolean>;
  email: {
    enabled: boolean;
    to: string;
  };
  dashboard: {
    url: string;
  };
  currency: {
    usd_brl: number;
  };
}

export interface MatchResult {
  work: Work;
  score: number;
  reasons: string[];
  language: "en" | "pt" | "unknown";
  format: "hardcover" | "paperback" | "mass_market" | "unknown";
  publisher: string | null;
}

export interface StoredListing extends RawListing {
  id: number;
  firstSeen: string;
  lastSeen: string;
  isNew: boolean;
}

export interface MatchRow {
  listing: StoredListing;
  match: MatchResult;
}

export interface ScanStats {
  startedAt: string;
  finishedAt: string;
  queries: number;
  pages: number;
  listings: number;
  newListings: number;
  matches: number;
  errors: number;
  bySource: Record<string, number>;
  sourceHealth: Record<
    string,
    { queries: number; listings: number; errors: number; blocked: boolean }
  >;
}
