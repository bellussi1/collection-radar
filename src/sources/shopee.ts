import { withShopeePage } from "../browser.js";
import { detectCondition, parsePrice } from "../normalize.js";
import type { RawListing } from "../types.js";
import { type Source, SourceBlockedError } from "./types.js";

interface ShopeeItemBasic {
  itemid?: number | string;
  shopid?: number | string;
  name?: string;
  price?: number;
  price_min?: number;
  price_max?: number;
  image?: string;
  shop_location?: string;
  shop_name?: string;
  historical_sold?: number;
  item_rating?: { rating_star?: number; rating_count?: number[] };
  currency?: string;
}

export interface ShopeeCard {
  title: string | null;
  link: string | null;
  priceText: string | null;
  image: string | null;
  text: string;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mapShopeeItem(item: ShopeeItemBasic): RawListing | null {
  const itemid = Number(item.itemid ?? 0);
  const shopid = Number(item.shopid ?? 0);
  if (!itemid || !shopid || !item.name) return null;

  const rawPrice = Number(item.price_min ?? item.price ?? 0);
  const price = rawPrice > 0 ? round2(rawPrice / 100000) : null;
  const image = item.image
    ? item.image.startsWith("http")
      ? item.image
      : `https://cf.shopee.com.br/file/${item.image}`
    : null;
  const rating = item.item_rating?.rating_star;
  const sold = item.historical_sold;
  const noteParts: string[] = [];
  if (typeof rating === "number" && rating > 0) {
    noteParts.push(`avaliação ${rating.toFixed(1).replace(".", ",")}`);
  }
  if (typeof sold === "number" && sold > 0) {
    noteParts.push(`${sold.toLocaleString("pt-BR")} vendidos`);
  }
  const priceNote = noteParts.length > 0 ? noteParts.join(" · ") : null;
  const description = [item.name, item.shop_location, priceNote, "Shopee"]
    .filter(Boolean)
    .join(" | ");

  return {
    source: "shopee",
    externalId: `${shopid}_${itemid}`,
    url: `https://shopee.com.br/product/${shopid}/${itemid}`,
    title: item.name,
    price,
    shipping: null,
    currency: "BRL",
    seller: item.shop_name?.trim() || null,
    location: item.shop_location?.trim() || null,
    condition: detectCondition(item.name) ?? "novo",
    description,
    imageUrl: image,
    sellerRating: null,
    priceNote,
    raw: item
  } satisfies RawListing;
}

export function parseShopeeResponse(data: unknown): RawListing[] {
  const payload = data as {
    items?: Array<{ item_basic?: ShopeeItemBasic } | ShopeeItemBasic>;
  } | null;
  const entries = payload?.items ?? [];
  return entries
    .map((entry) =>
      "item_basic" in entry ? (entry.item_basic ?? null) : (entry as ShopeeItemBasic)
    )
    .filter((item): item is ShopeeItemBasic => Boolean(item))
    .map(mapShopeeItem)
    .filter((listing): listing is RawListing => Boolean(listing));
}

export function parseShopeeCards(elements: Element[], max: number): ShopeeCard[] {
  return elements.slice(0, max).map((element) => {
    const text = (element as HTMLElement).innerText ?? "";
    const link =
      (element.querySelector('a[href*="/product/"]') as HTMLAnchorElement | null)?.href ??
      (element.querySelector("a") as HTMLAnchorElement | null)?.href ??
      null;
    const title =
      (element.querySelector('[data-sqe="name"]') as HTMLElement | null)?.innerText.trim() ??
      text
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean) ??
      null;
    const priceText =
      (element.querySelector('[data-sqe="price"]') as HTMLElement | null)?.innerText.trim() ??
      text.match(/R\$\s*[\d.,]+/)?.[0] ??
      null;
    const image = (element.querySelector("img") as HTMLImageElement | null)?.src ?? null;
    return { title, link, priceText, image, text } satisfies ShopeeCard;
  });
}

function mapShopeeCard(card: ShopeeCard): RawListing | null {
  if (!card.title || !card.link) return null;
  const idMatch = card.link.match(/\/product\/(\d+)\/(\d+)/);
  return {
    source: "shopee",
    externalId: idMatch ? `${idMatch[1]}_${idMatch[2]}` : card.link,
    url: card.link,
    title: card.title,
    price: card.priceText ? parsePrice(card.priceText) : null,
    shipping: null,
    currency: "BRL",
    seller: null,
    location: null,
    condition: detectCondition(card.text) ?? "novo",
    description: card.text,
    imageUrl: card.image,
    sellerRating: null,
    raw: card
  } satisfies RawListing;
}

export class ShopeeSource implements Source {
  readonly name = "shopee" as const;

  async search(term: string, limit: number): Promise<RawListing[]> {
    const saved = process.env.SHOPEE_SEARCH_URL?.trim();
    const url = saved
      ? saved.includes("{query}")
        ? saved.replace("{query}", encodeURIComponent(term))
        : `${saved}${saved.includes("?") ? "&" : "?"}keyword=${encodeURIComponent(term)}`
      : `https://shopee.com.br/search?keyword=${encodeURIComponent(term)}`;

    return withShopeePage(async (page) => {
      const responsePromise = page
        .waitForResponse(
          (response) =>
            response.url().includes("/api/v4/search/search_items") && response.status() === 200,
          { timeout: 45_000 }
        )
        .catch(() => null);

      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (response && response.status() >= 400) {
        throw new SourceBlockedError("shopee", `Shopee respondeu ${response.status()}`);
      }

      const apiResponse = await responsePromise;
      if (apiResponse) {
        try {
          const data = (await apiResponse.json()) as {
            items?: unknown[];
            error?: number;
          };
          if (Array.isArray(data.items) && data.items.length > 0) {
            return parseShopeeResponse(data).slice(0, limit);
          }
          if (data.error === 90309999) {
            throw new SourceBlockedError(
              "shopee",
              "Shopee exige login. Rode npm run shopee:login e tente de novo."
            );
          }
        } catch (error) {
          if (error instanceof SourceBlockedError) throw error;
        }
      }

      await page
        .waitForSelector(
          '[data-sqe="item"], .shopee-search-item-result__item, .shopee-search-empty-result-section',
          { timeout: 20_000 }
        )
        .catch(() => undefined);

      const cards = (await page.$$eval(
        '[data-sqe="item"], .shopee-search-item-result__item',
        parseShopeeCards,
        limit
      )) as ShopeeCard[];
      const listings = cards
        .map(mapShopeeCard)
        .filter((listing): listing is RawListing => Boolean(listing));
      if (listings.length > 0) return listings;

      const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
      if (bodyText.includes("ainda não está logado") || bodyText.includes("Faça login")) {
        throw new SourceBlockedError(
          "shopee",
          "Shopee exige login. Rode npm run shopee:login e tente de novo."
        );
      }
      return [];
    });
  }
}
