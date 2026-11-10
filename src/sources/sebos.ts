import { withPage } from "../browser.js";
import {
  containmentScore,
  detectCondition,
  jaccardScore,
  parsePrice,
  parseUsd
} from "../normalize.js";
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
    item.pagemap?.product?.[0]?.price
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

export interface CsePageCard {
  title: string | null;
  link: string | null;
  snippet: string | null;
  domain: string | null;
  image: string | null;
}

export function parseCsePageCards(elements: Element[], max: number): CsePageCard[] {
  return elements.slice(0, max).map((element) => {
    const anchor = element.querySelector("a.gs-title") as HTMLAnchorElement | null;
    return {
      title: anchor?.innerText.trim() ?? null,
      link: anchor?.getAttribute("data-ctorig") ?? anchor?.href ?? null,
      snippet:
        (element.querySelector(".gs-snippet") as HTMLElement | null)?.innerText.trim() ?? null,
      domain:
        (element.querySelector(".gs-visibleUrl-short") as HTMLElement | null)?.innerText.trim() ??
        null,
      image: (element.querySelector("img.gs-image") as HTMLImageElement | null)?.src ?? null
    } satisfies CsePageCard;
  });
}

export function mapCsePageCard(card: CsePageCard, price: number | null): RawListing {
  const url = card.link ?? "";
  let domain = card.domain?.trim() || null;
  if (!domain) {
    try {
      domain = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      domain = null;
    }
  }
  const title = card.title?.trim() ?? "";
  const snippet = card.snippet?.trim() ?? "";
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
    imageUrl: card.image,
    sellerRating: null,
    raw: card
  } satisfies RawListing;
}

function priceFromOffers(offers: unknown): number | null {
  if (offers === null || offers === undefined) return null;
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const price = priceFromOffers(offer);
      if (price !== null) return price;
    }
    return null;
  }
  if (typeof offers === "object") {
    const object = offers as Record<string, unknown>;
    for (const key of ["price", "lowPrice", "highPrice"]) {
      if (object[key] !== undefined) {
        const price = parseMoney(object[key] as string | number);
        if (price !== null) return price;
      }
    }
  }
  return null;
}

function priceFromJsonLd(text: string, expectedTitle: string): number | null {
  try {
    const data = JSON.parse(text) as unknown;
    const products: Array<{ name: string; price: number }> = [];

    const walk = (value: unknown): void => {
      if (value === null || value === undefined) return;
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
        return;
      }
      if (typeof value === "object") {
        const object = value as Record<string, unknown>;
        const name = typeof object.name === "string" ? object.name : "";
        const price = priceFromOffers(object.offers);
        if (name && price !== null) products.push({ name, price });
        for (const nested of Object.values(object)) walk(nested);
      }
    };
    walk(data);

    let best: { price: number; score: number } | null = null;
    for (const product of products) {
      const score = Math.max(
        containmentScore(expectedTitle, product.name),
        containmentScore(product.name, expectedTitle),
        jaccardScore(expectedTitle, product.name)
      );
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { price: product.price, score };
      }
    }
    return best?.price ?? null;
  } catch {
    return null;
  }
}

async function fetchPagePrice(url: string, expectedTitle: string): Promise<number | null> {
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
      const price = priceFromJsonLd(script[1] ?? "", expectedTitle);
      if (price !== null) return price;
    }

    const titleMeta = html.match(
      /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']*)["']/i
    );
    const metaTitle = titleMeta?.[1] ?? "";
    const titleScore = metaTitle
      ? Math.max(
          containmentScore(expectedTitle, metaTitle),
          containmentScore(metaTitle, expectedTitle),
          jaccardScore(expectedTitle, metaTitle)
        )
      : 0;
    if (titleScore < 0.5) return null;

    const meta = html.match(
      /<meta[^>]+(?:property|name)=["'](?:product:price:amount|og:price:amount|price)["'][^>]+content=["']([^"']+)["']/i
    );
    return meta?.[1] ? parseMoney(meta[1]) : null;
  } catch {
    return null;
  }
}

function isRecommendationUrl(url: string): boolean {
  return /\/recomendacao\//i.test(url);
}

export class GoogleCseSource implements Source {
  readonly name = "sebos" as const;

  constructor(private readonly options: { fetchPages?: boolean; maxPageFetches?: number } = {}) {}

  async search(term: string, limit: number): Promise<RawListing[]> {
    const cx = process.env.GOOGLE_CSE_CX?.trim();
    if (!cx) {
      throw new Error("Configure GOOGLE_CSE_CX para buscar sebos independentes.");
    }
    const key = process.env.GOOGLE_CSE_API_KEY?.trim();
    if (!key) return this.searchPublicPage(term, limit, cx);

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
      if (item.link && isRecommendationUrl(item.link)) continue;
      let price = parseCsePrice(item);
      if (
        price === null &&
        (this.options.fetchPages ?? true) &&
        fetched < (this.options.maxPageFetches ?? 5) &&
        item.link
      ) {
        price = await fetchPagePrice(item.link, item.title ?? "");
        fetched += 1;
        await sleep(300);
      }
      const listing = mapCseItem(item, price);
      if (listing.title && listing.url) listings.push(listing);
    }

    return listings;
  }

  private async searchPublicPage(term: string, limit: number, cx: string): Promise<RawListing[]> {
    const url = `https://cse.google.com/cse?cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(term)}&hl=pt-BR`;
    return withPage(async (page) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page
        .waitForSelector(".gsc-webResult.gsc-result, #resInfo-0", { timeout: 20_000 })
        .catch(() => undefined);

      const cards = (await page.$$eval(
        ".gsc-webResult.gsc-result",
        parseCsePageCards,
        Math.min(Math.max(limit, 1), 10)
      )) as CsePageCard[];

      const listings: RawListing[] = [];
      let fetched = 0;
      for (const card of cards) {
        if (card.link && isRecommendationUrl(card.link)) continue;
        let price: number | null = null;
        if (
          (this.options.fetchPages ?? true) &&
          fetched < (this.options.maxPageFetches ?? 5) &&
          card.link
        ) {
          price = await fetchPagePrice(card.link, card.title ?? "");
          fetched += 1;
          await sleep(300);
        }
        const listing = mapCsePageCard(card, price);
        if (listing.title && listing.url) listings.push(listing);
      }
      return listings;
    });
  }
}
