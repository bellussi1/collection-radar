import "dotenv/config";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_CACHE_PATH = "data/currency-cache.json";
const DEFAULT_CACHE_HOURS = 12;
const FALLBACK_RATE = 5.52;
const USER_AGENT = "collection-radar/0.1 (personal book radar)";
const PTAX_BASE =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarDia(dataCotacao=@dataCotacao)";

export interface PtaxQuote {
  rate: number;
  date: string;
}

export interface CurrencyCacheEntry {
  rate: number;
  fetchedAt: string;
  source: "ptax";
  ptaxDate: string;
}

export interface CurrencyRate {
  rate: number;
  source: "ptax" | "cache" | "fallback";
  fetchedAt: string;
  ptaxDate: string | null;
  stale: boolean;
  detail: string;
}

export type JsonFetcher = (url: string) => Promise<unknown>;

export interface ResolveOptions {
  fallback: number;
  cachePath?: string;
  cacheHours?: number;
  now?: Date;
  fetcher?: JsonFetcher;
}

export function parsePtaxResponse(json: unknown): PtaxQuote | null {
  if (!json || typeof json !== "object") return null;
  const values = (json as { value?: unknown }).value;
  if (!Array.isArray(values) || values.length === 0) return null;
  const first = values[0];
  if (!first || typeof first !== "object") return null;
  const row = first as {
    cotacaoVenda?: unknown;
    cotacaoCompra?: unknown;
    dataHoraCotacao?: unknown;
  };
  const sale = Number(row.cotacaoVenda);
  const buy = Number(row.cotacaoCompra);
  const rate = Number.isFinite(sale) && sale > 0 ? sale : Number.isFinite(buy) && buy > 0 ? buy : 0;
  if (rate <= 0) return null;
  return { rate, date: String(row.dataHoraCotacao ?? "").trim() };
}

export function ptaxDateCandidates(now: Date, days = 7): string[] {
  const candidates: string[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    candidates.push(`${month}-${day}-${date.getFullYear()}`);
  }
  return candidates;
}

export async function fetchPtaxRate(now: Date, fetcher: JsonFetcher): Promise<PtaxQuote | null> {
  for (const date of ptaxDateCandidates(now)) {
    const url = `${PTAX_BASE}?@dataCotacao='${date}'&$format=json`;
    try {
      const json = await fetcher(url);
      const quote = parsePtaxResponse(json);
      if (quote) return quote;
    } catch {
      // Erro de rede ou HTTP: não adianta insistir nos dias anteriores.
      return null;
    }
  }
  return null;
}

async function defaultFetcher(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function readCache(path: string): CurrencyCacheEntry | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      usd_brl?: Partial<CurrencyCacheEntry>;
    };
    const entry = parsed.usd_brl;
    if (!entry || typeof entry.rate !== "number" || !Number.isFinite(entry.rate) || entry.rate <= 0)
      return null;
    const fetchedAt = new Date(String(entry.fetchedAt ?? ""));
    if (Number.isNaN(fetchedAt.getTime())) return null;
    return {
      rate: entry.rate,
      fetchedAt: fetchedAt.toISOString(),
      source: "ptax",
      ptaxDate: String(entry.ptaxDate ?? "")
    };
  } catch {
    return null;
  }
}

function writeCache(path: string, entry: CurrencyCacheEntry): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ usd_brl: entry }, null, 2)}\n`, "utf8");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

function formatPtaxDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export async function resolveUsdBrl(options: ResolveOptions): Promise<CurrencyRate> {
  const now = options.now ?? new Date();
  const cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
  const cacheHours =
    Number.isFinite(options.cacheHours) && (options.cacheHours ?? 0) > 0
      ? (options.cacheHours as number)
      : DEFAULT_CACHE_HOURS;
  const fallback =
    Number.isFinite(options.fallback) && options.fallback > 0 ? options.fallback : FALLBACK_RATE;
  const fetcher = options.fetcher ?? defaultFetcher;
  const cache = readCache(cachePath);
  const maxAgeMs = cacheHours * 60 * 60 * 1000;

  if (cache) {
    const age = now.getTime() - new Date(cache.fetchedAt).getTime();
    if (age >= 0 && age < maxAgeMs) {
      return {
        rate: cache.rate,
        source: "cache",
        fetchedAt: cache.fetchedAt,
        ptaxDate: cache.ptaxDate || null,
        stale: false,
        detail: `cache de ${formatDate(cache.fetchedAt)}${cache.ptaxDate ? ` · PTAX ${formatPtaxDate(cache.ptaxDate)}` : ""}`
      };
    }
  }

  const quote = await fetchPtaxRate(now, fetcher);
  if (quote) {
    const fetchedAt = now.toISOString();
    try {
      writeCache(cachePath, {
        rate: quote.rate,
        fetchedAt,
        source: "ptax",
        ptaxDate: quote.date
      });
    } catch {
      // Sem cache gravado, mas a cotação desta execução continua válida.
    }
    return {
      rate: quote.rate,
      source: "ptax",
      fetchedAt,
      ptaxDate: quote.date,
      stale: false,
      detail: quote.date ? `PTAX ${formatPtaxDate(quote.date)}` : "PTAX do último dia útil"
    };
  }

  if (cache) {
    return {
      rate: cache.rate,
      source: "cache",
      fetchedAt: cache.fetchedAt,
      ptaxDate: cache.ptaxDate || null,
      stale: true,
      detail: `cache antigo de ${formatDate(cache.fetchedAt)}${cache.ptaxDate ? ` · PTAX ${formatPtaxDate(cache.ptaxDate)}` : ""}`
    };
  }

  return {
    rate: fallback,
    source: "fallback",
    fetchedAt: now.toISOString(),
    ptaxDate: null,
    stale: true,
    detail: "fallback fixo"
  };
}
