import { withPage } from "../browser.js";
import { cleanText, parsePrice, slugify } from "../normalize.js";
import type { RawListing } from "../types.js";
import { SourceBlockedError, type Source } from "./types.js";

interface MlApiItem {
  id: string;
  title: string;
  price: number;
  permalink: string;
  thumbnail?: string;
  condition?: string;
  seller?: { nickname?: string };
  address?: { city_name?: string; state_name?: string };
  shipping?: { free_shipping?: boolean };
}

interface MlCard {
  title: string | null;
  link: string | null;
  price: number | null;
  seller: string | null;
  location: string | null;
  shipping: number | null;
  text: string;
  image: string | null;
}

export class MercadoLivreSource implements Source {
  readonly name = "mercadolivre" as const;

  async search(term: string, limit: number): Promise<RawListing[]> {
    const token = process.env.ML_ACCESS_TOKEN?.trim();
    if (token) {
      return this.searchApi(term, limit, token);
    }
    return this.searchBrowser(term, limit);
  }

  private async searchApi(term: string, limit: number, token: string): Promise<RawListing[]> {
    const url = new URL("https://api.mercadolibre.com/sites/MLB/search");
    url.searchParams.set("q", term);
    url.searchParams.set("limit", String(Math.min(limit, 50)));
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Mercado Livre API respondeu ${response.status}`);
    }
    const data = (await response.json()) as { results?: MlApiItem[] };
    return (data.results ?? []).map((item) => ({
      source: "mercadolivre",
      externalId: item.id,
      url: item.permalink,
      title: item.title,
      price: item.price,
      shipping: item.shipping?.free_shipping ? 0 : null,
      currency: "BRL",
      seller: item.seller?.nickname ?? null,
      location: [item.address?.city_name, item.address?.state_name].filter(Boolean).join(", ") || null,
      condition: item.condition === "used" ? "usado" : item.condition === "new" ? "novo" : null,
      description: item.title,
      imageUrl: item.thumbnail ?? null,
      raw: item
    }));
  }

  private async searchBrowser(term: string, limit: number): Promise<RawListing[]> {
    const url = `https://lista.mercadolivre.com.br/${slugify(term)}`;
    return withPage(async (page) => {
      const response = await page.goto(url, { waitUntil: "domcontentloaded" });
      if (response?.status() === 403) {
        throw new SourceBlockedError("mercadolivre", "Mercado Livre bloqueou a requisição (403)");
      }
      await page
        .waitForSelector("li.ui-search-layout__item, .ui-search-result", { timeout: 20_000 })
        .catch(() => undefined);

      const bodyText = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
      if (
        bodyText.includes("Hubo un error accediendo") ||
        bodyText.includes("Acesso negado") ||
        bodyText.includes("Just a moment") ||
        bodyText.includes("Attention Required")
      ) {
        throw new SourceBlockedError("mercadolivre", "Mercado Livre retornou erro de acesso/bloqueio");
      }

      const cards = (await page.$$eval("li.ui-search-layout__item", (elements, max) => {
        return elements.slice(0, max).map((element) => {
          const text = (element as HTMLElement).innerText ?? "";
          const titleNode = element.querySelector("a.poly-component__title") as HTMLAnchorElement | null;
          const fraction = element.querySelector(".poly-price__current .andes-money-amount__fraction")?.textContent ?? "";
          const cents = element.querySelector(".poly-price__current .andes-money-amount__cents")?.textContent ?? "";
          const numeric = fraction ? Number(fraction.replace(/\./g, "")) : NaN;
          const price = Number.isFinite(numeric)
            ? numeric + (cents ? Number(cents) / 100 : 0)
            : null;
          const seller =
            (element.querySelector(".poly-component__seller") as HTMLElement | null)?.innerText.trim() ?? null;
          const locationNode =
            (element.querySelector('[class*="location"]') as HTMLElement | null) ??
            (element.querySelector('[class*="ubication"]') as HTMLElement | null);
          const image = (element.querySelector("img.poly-component__picture") as HTMLImageElement | null)?.src ?? null;
          const shipping = text.toLowerCase().includes("grátis") || text.toLowerCase().includes("gratis") ? 0 : null;
          return {
            title: titleNode?.innerText.trim() ?? null,
            link: titleNode?.href ?? null,
            price,
            seller,
            location: locationNode?.innerText.trim() ?? null,
            shipping,
            text,
            image
          } satisfies MlCard;
        });
      }, limit)) as MlCard[];

      return cards
        .filter((card) => card.title && card.link)
        .map((card) => {
          const idMatch = card.link?.match(/\/p\/(MLB\d+)/) ?? card.link?.match(/[?&]wid=(MLB\d+)/);
          return {
            source: "mercadolivre",
            externalId: idMatch?.[1] ?? card.link ?? "",
            url: card.link ?? "",
            title: card.title ?? "",
            price: card.price ?? (card.text ? parsePrice(card.text) : null),
            shipping: card.shipping,
            currency: "BRL",
            seller: cleanText(card.seller),
            location: cleanText(card.location),
            condition: card.text.toLowerCase().includes("usado") ? "usado" : null,
            description: cleanText(card.text),
            imageUrl: card.image,
            raw: card
          } satisfies RawListing;
        });
    });
  }
}
