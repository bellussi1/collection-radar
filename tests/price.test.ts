import assert from "node:assert/strict";
import test from "node:test";
import { dropPercent, priceChangeLabel } from "../src/price.js";

test("dropPercent só retorna queda acima do corte", () => {
  assert.equal(dropPercent(100, 80, 5), 20);
  assert.equal(dropPercent(100, 95, 5), 5);
  assert.equal(dropPercent(100, 96, 5), null);
  assert.equal(dropPercent(100, 99.8, 0), null);
  assert.equal(dropPercent(100, 100, 0), null);
  assert.equal(dropPercent(100, 120, 0), null);
  assert.equal(dropPercent(null, 80, 0), null);
  assert.equal(dropPercent(0, 80, 0), null);
});

test("priceChangeLabel compara com o primeiro total", () => {
  assert.equal(priceChangeLabel(100, 77), "caiu 23% desde a primeira vez");
  assert.equal(priceChangeLabel(100, 120), "subiu 20% desde a primeira vez");
  assert.equal(priceChangeLabel(100, 100), "estável desde a primeira vez");
  assert.equal(priceChangeLabel(null, 100), null);
  assert.equal(priceChangeLabel(0, 100), null);
});
