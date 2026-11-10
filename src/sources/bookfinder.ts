import { withPage } from "../browser.js";
import { detectCondition, extractIsbn, isValidIsbn13 } from "../normalize.js";
import type { RawListing } from "../types.js";
import { type Source, SourceBlockedError } from "./types.js";

export interface BookfinderCard {
  title: string | null;
  authors: string | null;
  isbn13: string | null;
  publisher: string | null;
  binding: string | null;
  condition: string | null;
  conditionText: string | null;
  seller: string | null;
  sellerLocation: string | null;
  fromText: string | null;
  priceUsd: number | null;
  shippingUsd: number | null;
  affiliate: string | null;
  url: string | null;
  itemId: string | null;
}

export function parseBookfinderCards(elements: Element[]): BookfinderCard[] {
  return elements.map((element) => {
    const spans = element.querySelectorAll("span");
    let conditionText: string | null = null;
    let fromText: string | null = null;
    for (let index = 0; index < spans.length; index += 1) {
      const span = spans[index];
      const text = (span?.textContent ?? "").trim();
      if (!conditionText && text.toLowerCase().startsWith("condition")) {
        conditionText = span?.parentElement?.textContent?.replace(/\s+/g, " ").trim() ?? null;
      }
      if (!fromText && text.toLowerCase().startsWith("from")) {
        fromText = span?.parentElement?.textContent?.replace(/\s+/g, " ").trim() ?? null;
      }
    }

    const priceText = element.getAttribute("data-csa-c-usdprice")?.trim() ?? null;
    const shippingText = element.getAttribute("data-csa-c-usdshipping")?.trim() ?? null;
    const parsedPrice = priceText ? Number(priceText.replace(",", ".")) : null;
    const parsedShipping = shippingText ? Number(shippingText.replace(",", ".")) : null;
    const link =
      (element.querySelector('a[href*="invId="]') as HTMLAnchorElement | null) ??
      (element.querySelector("a[href]") as HTMLAnchorElement | null);

    return {
      title: element.getAttribute("data-csa-c-title")?.trim() ?? null,
      authors: element.getAttribute("data-csa-c-authors")?.trim() ?? null,
      isbn13: element.getAttribute("data-csa-c-isbn")?.trim() ?? null,
      publisher: element.getAttribute("data-csa-c-publisher")?.trim() ?? null,
      binding: element.getAttribute("data-csa-c-binding")?.trim() ?? null,
      condition: element.getAttribute("data-csa-c-condition")?.trim() ?? null,
      conditionText,
      seller: element.getAttribute("data-csa-c-seller")?.trim() ?? null,
      sellerLocation: element.getAttribute("data-csa-c-sellerlocation")?.trim() ?? null,
      fromText,
      priceUsd: parsedPrice !== null && Number.isFinite(parsedPrice) ? parsedPrice : null,
      shippingUsd:
        parsedShipping !== null && Number.isFinite(parsedShipping) ? parsedShipping : null,
      affiliate: element.getAttribute("data-csa-c-affiliate")?.trim() ?? null,
      url: link?.href ?? null,
      itemId: element.getAttribute("data-test-id")?.trim() ?? null
    } satisfies BookfinderCard;
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function cleanUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    for (const key of [
      "_ptid",
      "utm_medium",
      "utm_source",
      "utm_campaign",
      "utm_content",
      "utm_term"
    ]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function mapBookfinderCard(
  card: BookfinderCard,
  usdBrl: number,
  coverUrl: string | null
): RawListing {
  const price = card.priceUsd === null ? null : round2(card.priceUsd * usdBrl);
  const shipping = card.shippingUsd === null ? null : round2(card.shippingUsd * usdBrl);
  const totalUsd = card.priceUsd === null ? null : card.priceUsd + (card.shippingUsd ?? 0);
  const url = cleanUrl(card.url);
  const invId = url?.match(/[?&]invId=(\d+)/)?.[1] ?? null;
  const externalId = invId ? `${card.affiliate ?? "bookfinder"}:${invId}` : (url ?? "");

  const from = card.fromText?.replace(/^From:\s*/i, "").trim() ?? "";
  const fromParts = from.split(",").map((part) => part.trim());
  const seller = card.seller ?? fromParts[0] ?? null;
  const location = fromParts.length > 1 ? fromParts.slice(1).join(", ") : card.sellerLocation;
  const conditionText = card.conditionText?.replace(/^Condition:\s*/i, "").trim() ?? null;
  const condition = detectCondition([card.condition, conditionText].filter(Boolean).join(" "));

  return {
    source: "bookfinder",
    externalId,
    url: url ?? "",
    title: card.title ?? "",
    price,
    shipping,
    currency: "BRL",
    seller,
    location,
    condition: condition ?? card.condition,
    description: [
      card.title,
      card.authors,
      card.publisher,
      card.binding,
      card.isbn13 ? `ISBN ${card.isbn13}` : null,
      conditionText ?? card.condition,
      "English",
      card.affiliate ? `via ${card.affiliate}` : null
    ]
      .filter(Boolean)
      .join(" | "),
    imageUrl: coverUrl,
    sellerRating: null,
    priceNote:
      totalUsd === null
        ? null
        : `US$ ${totalUsd.toFixed(2)} · frete US$ ${(card.shippingUsd ?? 0).toFixed(2)} · câmbio ${usdBrl.toFixed(2).replace(".", ",")}`,
    raw: {
      ...card,
      priceUsd: card.priceUsd,
      shippingUsd: card.shippingUsd,
      totalUsd,
      exchangeRate: usdBrl
    }
  } satisfies RawListing;
}

function totalOf(listing: RawListing): number | null {
  return listing.price === null ? null : listing.price + (listing.shipping ?? 0);
}

export class BookfinderSource implements Source {
  readonly name = "bookfinder" as const;

  constructor(private readonly usdBrl = 5.52) {}

  async search(term: string, limit: number): Promise<RawListing[]> {
    const isbn = extractIsbn(term) ?? term.replace(/\D/g, "");
    if (!isValidIsbn13(isbn)) {
      throw new Error("Bookfinder espera um ISBN-13 válido");
    }

    const url = `https://www.bookfinder.com/search/?isbn=${isbn}&mode=isbn&currency=USD&destination=BR`;
    return withPage(async (page) => {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      if (response && response.status() >= 400) {
        throw new SourceBlockedError("bookfinder", `Bookfinder respondeu ${response.status()}`);
      }
      await page
        .waitForSelector('[data-csa-c-item-type="search-offer"]', { timeout: 30_000 })
        .catch(() => undefined);

      const bodyText = (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).replace(/\s+/g, " ");
      if (/sorry, you have been blocked|attention required|robot check|captcha/i.test(bodyText)) {
        throw new SourceBlockedError("bookfinder", "Bookfinder bloqueou a requisição");
      }

      const cards = (await page.$$eval(
        '[data-csa-c-item-type="search-offer"]',
        parseBookfinderCards
      )) as BookfinderCard[];
      const coverUrl = `https://pictures.abebooks.com/isbn/${isbn}-us-300.jpg`;

      return cards
        .map((card) => mapBookfinderCard(card, this.usdBrl, coverUrl))
        .filter(
          (listing) => listing.title.length > 0 && listing.url.length > 0 && listing.price !== null
        )
        .sort((a, b) => (totalOf(a) ?? Infinity) - (totalOf(b) ?? Infinity))
        .slice(0, limit);
    });
  }
}
