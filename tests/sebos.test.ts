import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseGoogleCseResponse } from "../src/sources/sebos.js";

test("parseGoogleCseResponse lê preço, domínio e condição", () => {
  const data = JSON.parse(readFileSync("tests/fixtures/google-cse-search.json", "utf8"));
  const listings = parseGoogleCseResponse(data);
  assert.equal(listings.length, 2);

  const first = listings[0]!;
  assert.equal(first.source, "sebos");
  assert.equal(first.title, "Assassin's Apprentice — Robin Hobb | Sebo do Messias");
  assert.equal(first.url, "https://www.sebodomessias.com.br/produto/assassins-apprentice");
  assert.equal(first.price, 49.9);
  assert.equal(first.seller, "sebodomessias.com.br");
  assert.equal(first.condition, "usado");
  assert.equal(first.imageUrl, "https://www.sebodomessias.com.br/img.jpg");
  assert.match(first.description ?? "", /sebodomessias\.com\.br/);

  const second = listings[1]!;
  assert.equal(second.price, null);
  assert.equal(second.seller, "seboexemplo.com.br");
  assert.equal(second.condition, "usado");
});
