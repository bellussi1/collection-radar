import { withPage } from "../browser.js";
import { cleanText, parsePrice } from "../normalize.js";
import { extractSellerRating, parseSellerScore } from "../seller.js";
import type { RawListing } from "../types.js";
import { SourceBlockedError, type Source } from "./types.js";

export interface OlxCard {
  title: string | null;
  priceText: string | null;
  link: string | null;
  seller: string | null;
  sellerScoreText: string | null;
  location: string | null;
  text: string;
  image: string | null;
}

export function parseOlxCards(elements: Element[], max: number): OlxCard[] {
  return elements.slice(0, max).map((element) => {
    const text = (element as HTMLElement).innerText ?? "";
    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const dateIndex = lines.findIndex(
      (line) => /\b\d{1,2} de [a-z]{3,}/i.test(line) || /\d{1,2}:\d{2}/.test(line)
    );
    const location = dateIndex > 0 ? (lines[dateIndex - 1] ?? null) : null;
    const link =
      (element.querySelector('a[data-testid="adcard-link"]') as HTMLAnchorElement | null)?.href ?? null;
    const image = (element.querySelector("img") as HTMLImageElement | null)?.src ?? null;
    const seller =
      (element.querySelector('[class*="transactionalSellerName"]') as HTMLElement | null)?.innerText.trim() ??
      null;
    const sellerScoreText =
      (element.querySelector('[class*="transactionalSellerScore"]') as HTMLElement | null)?.innerText.trim() ??
      null;
    return {
      title: (element.querySelector("h2.olx-adcard__title") as HTMLElement | null)?.innerText.trim() ?? null,
      priceText: (element.querySelector("h3.olx-adcard__price") as HTMLElement | null)?.innerText.trim() ?? null,
      link,
      seller,
      sellerScoreText,
      location,
      text,
      image
    } satisfies OlxCard;
  });
}

export function mapOlxCard(card: OlxCard): RawListing {
  const normalized = card.text.toLowerCase();
  const condition = normalized.includes("novo")
    ? "novo"
    : normalized.includes("usado")
      ? "usado"
      : null;
  const seller = cleanText(card.seller);
  return {
    source: "olx",
    externalId: card.link?.split("/").filter(Boolean).at(-1) ?? card.link ?? "",
    url: card.link ?? "",
    title: card.title ?? "",
    price: card.priceText ? parsePrice(card.priceText) : null,
    shipping: null,
    currency: "BRL",
    seller,
    location: cleanText(card.location),
    condition,
    description: cleanText(card.text),
    imageUrl: card.image,
    sellerRating:
      parseSellerScore(card.sellerScoreText) ?? extractSellerRating(card.text, seller),
    raw: card
  } satisfies RawListing;
}

export class OlxSource implements Source {
  readonly name = "olx" as const;

  async search(term: string, limit: number): Promise<RawListing[]> {
    const url = `https://www.olx.com.br/brasil?q=${encodeURIComponent(term)}`;
    return withPage(async (page) => {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (response?.status() === 403) {
        throw new SourceBlockedError("olx", "OLX bloqueou a requisição (Cloudflare 403)");
      }

      await page
        .waitForSelector("section.olx-adcard, [data-testid='adcard-link']", { timeout: 20_000 })
        .catch(() => undefined);

      const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      if (bodyText.includes("Sorry, you have been blocked") || bodyText.includes("Attention Required")) {
        throw new SourceBlockedError("olx", "OLX bloqueou a requisição (Cloudflare)");
      }

      const cards = (await page.$$eval("section.olx-adcard", parseOlxCards, limit)) as OlxCard[];

      return cards
        .filter(
          (card) =>
            card.title &&
            card.link &&
            !card.link.includes("/vi/") &&
            !card.link.includes("custom_tag=") &&
            !card.link.includes("rec=n")
        )
        .map(mapOlxCard);
    });
  }
}
