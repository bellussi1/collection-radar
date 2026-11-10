import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright";
import { mapAbeBooksCard, parseAbeBooksCards } from "../src/sources/abebooks.js";
import { mapEnjoeiCard, parseEnjoeiCards } from "../src/sources/enjoei.js";
import { mapEstanteCard, parseEstanteCards } from "../src/sources/estante.js";
import { mapMlCard, parseMlCards } from "../src/sources/mercadolivre.js";
import { mapOlxCard, parseOlxCards } from "../src/sources/olx.js";

let browser: Browser;
let page: Page;

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
});

function fixture(name: string): string {
  return readFileSync(`tests/fixtures/${name}`, "utf8");
}

test("parser da OLX lê cards salvos e a nota do vendedor", async () => {
  await page.setContent(fixture("olx-search.html"), { waitUntil: "domcontentloaded" });
  const cards = await page.$$eval("section.olx-adcard", parseOlxCards, 5);
  assert.ok(cards.length > 0);

  const listings = cards.map(mapOlxCard);
  const first = listings[0];
  assert.ok(first);
  assert.equal(first.source, "olx");
  assert.ok(first.title.length > 0);
  assert.ok(first.url.startsWith("https://"));
  assert.ok(first.price !== null);
  assert.equal(first.seller, "Nico");
  assert.equal(first.sellerRating, 5);
  assert.ok(listings.some((listing) => listing.sellerRating === 4.8));
  assert.ok(listings.some((listing) => listing.seller === null && listing.sellerRating === null));
});

test("parser do Mercado Livre lê cards salvos e a nota do vendedor", async () => {
  await page.setContent(fixture("mercadolivre-search.html"), { waitUntil: "domcontentloaded" });
  const cards = await page.$$eval("li.ui-search-layout__item", parseMlCards, 5);
  assert.equal(cards.length, 2);

  const first = mapMlCard(cards[0]!);
  assert.equal(first.source, "mercadolivre");
  assert.equal(first.externalId, "MLB123456");
  assert.equal(first.title, "Livro Exemplo — Autor");
  assert.equal(first.price, 123.45);
  assert.equal(first.shipping, 0);
  assert.equal(first.seller, "Livraria Exemplo");
  assert.equal(first.sellerRating, 4.8);
  assert.equal(first.condition, "usado");
  assert.equal(first.location, "São Paulo");

  const second = mapMlCard(cards[1]!);
  assert.equal(second.externalId, "MLB654321");
  assert.equal(second.price, 89.9);
  assert.equal(second.seller, null);
  assert.equal(second.sellerRating, null);
});

test("parser do Enjoei lê cards salvos", async () => {
  await page.setContent(fixture("enjoei-search.html"), { waitUntil: "domcontentloaded" });
  const cards = await page.$$eval(".c-product-card", parseEnjoeiCards, 5);
  assert.ok(cards.length > 0);

  const first = mapEnjoeiCard(cards[0]!);
  assert.equal(first.source, "enjoei");
  assert.ok(first.title.length > 0);
  assert.ok(first.url.startsWith("https://"));
  assert.ok(first.price !== null);
  assert.ok(first.condition === "usado" || first.condition === "novo");
  assert.equal(first.sellerRating, null);
});

test("parser da Estante Virtual lê cards salvos", async () => {
  await page.setContent(fixture("estante-search.html"), { waitUntil: "domcontentloaded" });
  const cards = await page.$$eval(".product-item", parseEstanteCards, 5);
  assert.ok(cards.length > 0);

  const first = mapEstanteCard(cards[0]!);
  assert.equal(first.source, "estante");
  assert.ok(first.title.length > 0);
  assert.ok(first.url.startsWith("https://"));
  assert.ok(first.price !== null);
  assert.equal(first.sellerRating, null);
});

test("parser da AbeBooks lê cards salvos e converte o dólar", async () => {
  await page.setContent(fixture("abebooks-search.html"), { waitUntil: "domcontentloaded" });
  const cards = await page.$$eval('[data-srp-item-role="listing"]', parseAbeBooksCards, 3);
  assert.ok(cards.length > 0);

  const first = mapAbeBooksCard(cards[0]!, 5.52);
  assert.equal(first.source, "abebooks");
  assert.match(first.title, /Assassin's Apprentice/i);
  assert.ok(first.url.startsWith("https://"));
  assert.ok(first.price !== null && first.price > 0);
  assert.ok(first.shipping !== null && first.shipping > 0);
  assert.match(first.description ?? "", /9780007562251/);
  assert.match(first.priceNote ?? "", /US\$/);
  assert.match(first.priceNote ?? "", /5,52/);
  assert.ok(first.sellerRating === null || first.sellerRating >= 4);
  assert.ok(first.condition === "novo" || first.condition === "usado");
});
