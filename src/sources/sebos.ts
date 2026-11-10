import { detectCondition, parsePrice, parseUsd } from "../normalize.js";
import type { RawListing } from "../types.js";
import type { Source } from "./types.js";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CseItem {
  title?: string;
  link?: string;
  snippet?: string;
  pagemap?: {
    metatags?: Array<Record<string, string>>;
    offer?: Array<{ price?: string; pricecurrency?: string }>;
    product?: Array<{ price?: string }>;
    cse_image?: Array<{ src?: string }>;
    cse_thumbnail?: Array<{ src?: string }>;
  };
}

interface CseResponse {
  items?: CseItem[];
  error?: { code?: number; message?: string };
}

function parseMoney(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/US\$/i.test(text)) return parseUsd(text);
  if (/R\$|BRL/i.test(text)) return parsePrice(text);
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const parsed = Number(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCsePrice(item: CseItem): number | null {
  const meta = item.pagemap?.metatags?.[0] ?? {};
  const candidates = [
    meta["product:price:amount"],
    meta["og:price:amount"],
    meta.price,
    item.pagemap?.offer?.[0]?.price,
    item.pagemap?.product?.[0]?.price,
    item.snippet?.match(/R\$\s*[\d.,]+/)?.[0]
  ];
  for (const candidate of candidates) {
    const price = parseMoney(candidate);
    if (price !== null) return price;
  }
  return null;
}

export function extractCseItems(data: unknown): CseItem[] {
  const payload = data as CseResponse | null;
  return payload?.items ?? [];
}

export function mapCseItem(item: CseItem, price: number | null): RawListing {
  const url = item.link ?? "";
  let domain: string | null = null;
  try {
    domain = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    domain = null;
  }
  const title = item.title?.trim() ?? "";
  const snippet = item.snippet?.trim() ?? "";
  return {
    source: "sebos",
    externalId: url,
    url,
    title,
    price,
    shipping: null,
    currency: "BRL",
    seller: domain,
    location: null,
    condition: detectCondition(`${title} ${snippet}`),
    description: [snippet, domain].filter(Boolean).join(" | "),
    imageUrl: item.pagemap?.cse_image?.[0]?.src ?? item.pagemap?.cse_thumbnail?.[0]?.src ?? null,
    sellerRating: null,
    raw: item
  } satisfies RawListing;
}

export function parseGoogleCseResponse(data: unknown): RawListing[] {
  return extractCseItems(data)
    .map((item) => mapCseItem(item, parseCsePrice(item)))
    .filter((listing) => listing.title.length > 0 && listing.url.length > 0);
}

function priceFromJsonLd(text: string): number | null {
  try {
    const data = JSON.parse(text) as unknown;
    const walk = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      if (Array.isArray(value)) {
        for (const item of value) {
          const price = walk(item);
          if (price !== null) return price;
        }
        return null;
      }
      if (typeof value === "object") {
        const object = value as Record<string, unknown>;
        if (object.offers) {
          const price = walk(object.offers);
          if (price !== null) return price;
        }
        for (const key of ["price", "lowPrice", "highPrice"]) {
          if (object[key] !== undefined) {
            const price = parseMoney(object[key] as string | number);
            if (price !== null) return price;
          }
        }
        for (const nested of Object.values(object)) {
          const price = walk(nested);
          if (price !== null) return price;
        }
      }
      return null;
    };
    return walk(data);
  } catch {
    return null;
  }
}

async function fetchPagePrice(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return null;
    const html = await response.text();
    if (html.length > 2_000_000) return null;

    const scripts = [
      ...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
    ];
    for (const script of scripts) {
      const price = priceFromJsonLd(script[1] ?? "");
      if (price !== null) return price;
    }

    const meta = html.match(
      /<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount|price)["'][^>]+content=["']([^"']+)["']/i
    );
    return meta?.[1] ? parseMoney(meta[1]) : null;
  } catch {
    return null;
  }
}

export class GoogleCseSource implements Source {
  readonly name = "sebos" as const;

  constructor(private readonly options: { fetchPages?: boolean; maxPageFetches?: number } = {}) {}

  async search(term: string, limit: number): Promise<RawListing[]> {
    const key = process.env.GOOGLE_CSE_API_KEY?.trim();
    const cx = process.env.GOOGLE_CSE_CX?.trim();
    if (!key || !cx) {
      throw new Error(
        "Configure GOOGLE_CSE_API_KEY e GOOGLE_CSE_CX para buscar sebos independentes."
      );
    }

    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", key);
    url.searchParams.set("cx", cx);
    url.searchParams.set("q", `${term} livro`);
    url.searchParams.set("num", String(Math.min(Math.max(limit, 1), 10)));
    url.searchParams.set("hl", "pt-BR");
    url.searchParams.set("gl", "br");

    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Google CSE respondeu ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`
      );
    }
    const data = (await response.json()) as CseResponse;
    if (data.error) {
      throw new Error(`Google CSE: ${data.error.message ?? data.error.code ?? "erro"}`);
    }

    const items = extractCseItems(data);
    const listings: RawListing[] = [];
    let fetched = 0;

    for (const item of items) {
      let price = parseCsePrice(item);
      if (
        price === null &&
        (this.options.fetchPages ?? true) &&
        fetched < (this.options.maxPageFetches ?? 5) &&
        item.link
      ) {
        price = await fetchPagePrice(item.link);
        fetched += 1;
        await sleep(300);
      }
      const listing = mapCseItem(item, price);
      if (listing.title && listing.url) listings.push(listing);
    }

    return listings;
  }
}
