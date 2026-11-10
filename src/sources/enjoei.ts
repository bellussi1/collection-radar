import { withPage } from "../browser.js";
import { cleanText, parsePrice } from "../normalize.js";
import type { RawListing } from "../types.js";
import type { Source } from "./types.js";

export interface EnjoeiCard {
  title: string | null;
  priceText: string | null;
  brand: string | null;
  link: string | null;
  seller: string | null;
  text: string;
  image: string | null;
}

export function parseEnjoeiCards(elements: Element[], max: number): EnjoeiCard[] {
  return elements.slice(0, max).map((element) => {
    const text = (element as HTMLElement).innerText ?? "";
    const link =
      (element.querySelector('a[href*="/p/"]') as HTMLAnchorElement | null)?.href ?? null;
    const image =
      (element.querySelector("img.c-product-card__img") as HTMLImageElement | null)?.src ?? null;
    const seller =
      (element.querySelector('a[href*="/@"]') as HTMLAnchorElement | null)?.innerText.trim() ?? null;
    return {
      title: (element.querySelector(".c-product-card__title") as HTMLElement | null)?.innerText.trim() ?? null,
      priceText: (element.querySelector(".c-product-card__price") as HTMLElement | null)?.innerText.trim() ?? null,
      brand: (element.querySelector(".c-product-card__brand") as HTMLElement | null)?.innerText.trim() ?? null,
      link,
      seller,
      text,
      image
    } satisfies EnjoeiCard;
  });
}

export function mapEnjoeiCard(card: EnjoeiCard): RawListing {
  const cleanUrl = card.link?.split("?")[0] ?? "";
  return {
    source: "enjoei",
    externalId: cleanUrl.split("/").filter(Boolean).at(-1) ?? cleanUrl,
    url: cleanUrl,
    title: card.title ?? "",
    price: card.priceText ? parsePrice(card.priceText) : null,
    shipping: null,
    currency: "BRL",
    seller: cleanText(card.seller),
    location: null,
    condition: card.text.toLowerCase().includes("novo") ? "novo" : "usado",
    description: cleanText([card.brand, card.text].filter(Boolean).join(" | ")),
    imageUrl: card.image,
    sellerRating: null,
    raw: card
  } satisfies RawListing;
}

export class EnjoeiSource implements Source {
  readonly name = "enjoei" as const;

  async search(term: string, limit: number): Promise<RawListing[]> {
    const url = `https://www.enjoei.com.br/s?query=${encodeURIComponent(term)}`;
    return withPage(async (page) => {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (response && response.status() >= 400) {
        throw new Error(`Enjoei respondeu ${response.status()}`);
      }
      await page.waitForSelector(".c-product-card", { timeout: 20_000 }).catch(() => undefined);
      await page
        .waitForFunction(() => document.querySelectorAll(".c-product-card").length > 0, { timeout: 10_000 })
        .catch(() => undefined);

      const cards = (await page.$$eval(".c-product-card", parseEnjoeiCards, limit)) as EnjoeiCard[];

      return cards.filter((card) => card.title && card.link).map(mapEnjoeiCard);
    });
  }
}
