import { withPage } from "../browser.js";
import { cleanText, parsePrice, slugify } from "../normalize.js";
import type { RawListing } from "../types.js";
import type { Source } from "./types.js";

interface EstanteCard {
  title: string | null;
  author: string | null;
  year: string | null;
  priceText: string | null;
  link: string | null;
  description: string | null;
  image: string | null;
  variations: string | null;
}

export class EstanteSource implements Source {
  readonly name = "estante" as const;

  async search(term: string, limit: number): Promise<RawListing[]> {
    const url = `https://www.estantevirtual.com.br/busca/${slugify(term)}`;
    return withPage(async (page) => {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (response && response.status() >= 400) {
        throw new Error(`Estante Virtual respondeu ${response.status()}`);
      }
      await page
        .waitForSelector(".product-item, .search__content__list, .empty-search", { timeout: 20_000 })
        .catch(() => undefined);

      const cards = (await page.$$eval(".product-item", (elements, max) => {
        return elements.slice(0, max).map((element) => {
          const titleNode = element.querySelector(".product-item__title");
          const authorNode = element.querySelector(".product-item__author");
          const yearNode = element.querySelector(".product-item__year");
          const priceNode = element.querySelector('[data-auto="price"]');
          const descriptionNode = element.querySelector(".product-item__description__text");
          const button = element.querySelector("a.product-item__button") as HTMLAnchorElement | null;
          const linkNode = element.querySelector("a.product-item__link") as HTMLAnchorElement | null;
          const imageNode = element.querySelector("img") as HTMLImageElement | null;
          const variations = Array.from(element.querySelectorAll(".product-item__variations__item"))
            .map((node) => (node.textContent ?? "").trim())
            .filter(Boolean)
            .join(" / ");
          return {
            title: titleNode?.textContent?.trim() ?? null,
            author: authorNode?.textContent?.trim() ?? null,
            year: yearNode?.textContent?.trim() ?? null,
            priceText: priceNode?.textContent?.trim() ?? null,
            link: button?.href ?? linkNode?.href ?? null,
            description: descriptionNode?.textContent?.trim() ?? null,
            image: imageNode?.src ?? null,
            variations
          } satisfies EstanteCard;
        });
      }, limit)) as EstanteCard[];

      return cards
        .filter((card) => card.title && card.link)
        .map((card) => {
          const externalId = card.link?.split("/").filter(Boolean).at(-1) ?? card.link ?? "";
          const description = [card.author, card.year, card.variations, card.description]
            .filter(Boolean)
            .join(" | ");
          return {
            source: "estante",
            externalId,
            url: card.link ?? "",
            title: card.title ?? "",
            price: card.priceText ? parsePrice(card.priceText) : null,
            shipping: null,
            currency: "BRL",
            seller: null,
            location: null,
            condition: cleanText(card.variations),
            description: cleanText(description),
            imageUrl: card.image,
            raw: card
          } satisfies RawListing;
        });
    });
  }
}
