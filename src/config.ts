import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { QueryConfig, Settings, Work } from "./types.js";

const DEFAULT_SETTINGS: Settings = {
  scan: {
    max_queries: 0,
    limit_per_query: 30,
    delay_ms: 2500,
    min_score: 0.62,
    immediate_score: 0.82,
    max_age_days: 30
  },
  sources: {
    estante: true,
    olx: true,
    mercadolivre: true,
    enjoei: true
  },
  email: {
    enabled: false,
    to: "enzobellussi3@gmail.com"
  }
};

function readYaml(path: string): unknown {
  const fullPath = resolve(process.cwd(), path);
  return parse(readFileSync(fullPath, "utf8"));
}

export function loadSettings(): Settings {
  let fileSettings: Partial<Settings> = {};
  try {
    fileSettings = (readYaml("config/settings.yaml") ?? {}) as Partial<Settings>;
  } catch {
    // usa defaults
  }
  return {
    scan: { ...DEFAULT_SETTINGS.scan, ...(fileSettings.scan ?? {}) },
    sources: { ...DEFAULT_SETTINGS.sources, ...(fileSettings.sources ?? {}) },
    email: { ...DEFAULT_SETTINGS.email, ...(fileSettings.email ?? {}) }
  };
}

function loadIsbnOverrides(): Record<string, string> {
  try {
    const data = readYaml("config/isbn-overrides.yaml") as Record<string, unknown> | null;
    if (!data) return {};
    return Object.fromEntries(
      Object.entries(data)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, value as string])
    );
  } catch {
    return {};
  }
}

export function loadWorks(): Work[] {
  const data = readYaml("config/watchlist.yaml") as { works?: unknown[] } | null;
  const works = Array.isArray(data?.works) ? data.works : [];
  const overrides = loadIsbnOverrides();
  return works.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      key: String(row.key ?? ""),
      title: String(row.title ?? ""),
      author: String(row.author ?? ""),
      series: String(row.series ?? ""),
      volume: Number(row.volume ?? 1),
      status: String(row.status ?? "none"),
      language: String(row.language ?? "en"),
      priority: Number(row.priority ?? 3),
      enabled: Boolean(row.enabled ?? true),
      aliases: Array.isArray(row.aliases) ? row.aliases.map(String) : [],
      preferred_publishers: Array.isArray(row.preferred_publishers)
        ? row.preferred_publishers.map(String)
        : [],
      preferred_formats: Array.isArray(row.preferred_formats)
        ? row.preferred_formats.map(String)
        : [],
      isbn13: String(row.isbn13 ?? ""),
      max_price: Number(row.max_price ?? 150),
      notes: String(row.notes ?? "")
    } satisfies Work;
  }).map((work) => ({ ...work, isbn13: overrides[work.key] ?? work.isbn13 }));
}

export function loadQueries(): QueryConfig[] {
  const data = readYaml("config/queries.yaml") as { queries?: unknown[] } | null;
  const queries = Array.isArray(data?.queries) ? data.queries : [];
  return queries
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        term: String(row.term ?? "").trim(),
        kind: String(row.kind ?? "author"),
        priority: Number(row.priority ?? 3),
        enabled: Boolean(row.enabled ?? true)
      } satisfies QueryConfig;
    })
    .filter((query) => query.enabled && query.term.length > 1);
}
