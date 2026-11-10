import { withPage } from "../browser.js";
import { extractIsbn, isValidIsbn13, parseUsd } from "../normalize.js";
import { parseStarRating } from "../seller.js";
import type { RawListing } from "../types.js";
import { SourceBlockedError, type Source } from "./types.js";

export interface AbeBooksCard {
  title: string | null;
  author: string | null;
  isbn13: string | null;
  publisher: string | null;
  series: string | null;
  seller: string | null;
  sellerInfo: string | null;
  sellerRatingText: string | null;
  condition: string | null;
  priceText: string | null;
  shippingText: string | null;
  shipsTo: string | null;
  description: string | null;
  url: string | null;
  image: string | null;
  itemId: string | null;
}

export function parseAbeBooksCards(elements: Element[], max: number): AbeBooksCard[] {
  return elements.slice(0, max).map((element) => {
    const isbnText =
      (element.querySelector('[data-test-id^="isbn-"]') as HTMLElement | null)?.innerText.trim() ?? null;
    return {
      title:
        (element.querySelector('[data-test-id="listing-title"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      author:
        (element.querySelector('[data-test-id="listing-author"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      isbn13: isbnText?.match(/\b(97[89]\d{10})\b/)?.[1] ?? null,
      publisher:
        (element.querySelector('[data-test-id^="publisher-"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      series:
        (element.querySelector('[data-test-id="listing-series-link"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      seller:
        (element.querySelector('[data-test-id="listing-seller-link"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      sellerInfo:
        (element.querySelector('[data-test-id="seller-info"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      sellerRatingText:
        (element.querySelector('[data-test-id="star-rating"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      condition:
        (element.querySelector('[data-test-id="listing-condition"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      priceText:
        (element.querySelector('[data-test-id="listing-price"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      shippingText:
        (
          element.querySelector('[data-test-id^="item-shipping-price-"]') as HTMLElement | null
        )?.innerText.trim() ?? null,
      shipsTo:
        (
          element.querySelector(
            '[data-test-id^="snippet-shopping-preferences-modal-trigger-"]'
          ) as HTMLElement | null
        )?.innerText.trim() ?? null,
      description:
        (element.querySelector('[data-test-id^="description-"]') as HTMLElement | null)?.innerText.trim() ??
        null,
      url:
        (element.querySelector('[data-test-id="listing-title-link"]') as HTMLAnchorElement | null)?.href ??
        null,
      image: (element.querySelector("img") as HTMLImageElement | null)?.src ?? null,
      itemId: element.getAttribute("data-csa-c-item-id")
    } satisfies AbeBooksCard;
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function conditionOf(value: string | null): string | null {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("new")) return "novo";
  if (normalized.includes("used")) return "usado";
  return value;
}

export function mapAbeBooksCard(card: AbeBooksCard, usdBrl: number): RawListing {
  const priceUsd = card.priceText ? parseUsd(card.priceText) : null;
  const shippingUsd = card.shippingText ? parseUsd(card.shippingText) : null;
  const totalUsd = priceUsd === null ? null : priceUsd + (shippingUsd ?? 0);
  const price = priceUsd === null ? null : round2(priceUsd * usdBrl);
  const shipping = shippingUsd === null ? null : round2(shippingUsd * usdBrl);
  const seller = card.seller?.trim() ?? null;
  let location: string | null = null;
  if (card.sellerInfo && seller) {
    const parts = card.sellerInfo
      .replace(/^Seller:\s*/i, "")
      .split(seller)
      .map((part) => part.replace(/^[, ]+|[, ]+$/g, ""))
      .filter(Boolean);
    location = parts[0] ?? null;
  }
  const description = [
    card.title,
    card.author,
    card.publisher,
    card.isbn13 ? `ISBN ${card.isbn13}` : null,
    card.series,
    card.condition,
    card.shipsTo,
    card.description
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    source: "abebooks",
    externalId: card.itemId ?? card.url ?? "",
    url: card.url ?? "",
    title: card.title ?? "",
    price,
    shipping,
    currency: "BRL",
    seller,
    location,
    condition: conditionOf(card.condition),
    description,
    imageUrl: card.image,
    sellerRating: parseStarRating(card.sellerRatingText),
    priceNote:
      totalUsd === null
        ? null
        : `US$ ${totalUsd.toFixed(2)} · câmbio ${usdBrl.toFixed(2).replace(".", ",")}`,
    raw: {
      ...card,
      priceUsd,
      shippingUsd,
      totalUsd,
      exchangeRate: usdBrl
    }
  } satisfies RawListing;
}

export class AbeBooksSource implements Source {
  readonly name = "abebooks" as const;

  constructor(private readonly usdBrl = 5.52) {}

  async search(term: string, limit: number): Promise<RawListing[]> {
    const isbn = extractIsbn(term) ?? term.replace(/\D/g, "");
    if (!isValidIsbn13(isbn)) {
      throw new Error("AbeBooks espera um ISBN-13 válido");
    }

    const url = `https://www.abebooks.com/servlet/SearchResults?isbn=${isbn}&sortby=17`;
    return withPage(async (page) => {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (response && response.status() >= 400) {
        throw new SourceBlockedError("abebooks", `AbeBooks respondeu ${response.status()}`);
      }
      await page
        .waitForSelector('[data-srp-item-role="listing"], #srp-search-results-list', { timeout: 30_000 })
        .catch(() => undefined);

      const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      if (bodyText.includes("Sorry, you have been blocked") || bodyText.includes("Attention Required")) {
        throw new SourceBlockedError("abebooks", "AbeBooks bloqueou a requisição");
      }
      if (!bodyText.includes("Shipping destination: Brazil") && !bodyText.includes("to Brazil")) {
        console.warn("AbeBooks: destino de envio não está Brasil; confira o site.");
      }

      const cards = (await page.$$eval(
        '[data-srp-item-role="listing"]',
        parseAbeBooksCards,
        limit
      )) as AbeBooksCard[];

      return cards
        .map((card) => mapAbeBooksCard(card, this.usdBrl))
        .filter((listing) => listing.title.length > 0 && listing.url.length > 0);
    });
  }
}
