import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseShopeeResponse } from "../src/sources/shopee.js";

test("parseShopeeResponse converte preço, URL e condição", () => {
  const data = JSON.parse(readFileSync("tests/fixtures/shopee-search.json", "utf8"));
  const listings = parseShopeeResponse(data);
  assert.equal(listings.length, 2);

  const first = listings[0]!;
  assert.equal(first.source, "shopee");
  assert.equal(first.externalId, "222_111");
  assert.equal(first.url, "https://shopee.com.br/product/222/111");
  assert.equal(first.title, "Assassin's Apprentice — Robin Hobb");
  assert.equal(first.price, 49.9);
  assert.equal(first.seller, "Livraria Teste");
  assert.equal(first.location, "São Paulo");
  assert.equal(first.condition, "novo");
  assert.equal(first.sellerRating, null);
  assert.match(first.priceNote ?? "", /avaliação 4,8/);
  assert.match(first.priceNote ?? "", /120 vendidos/);
  assert.match(first.description ?? "", /Shopee/);

  const second = listings[1]!;
  assert.equal(second.price, 35);
  assert.equal(second.condition, "usado");
});
