import assert from "node:assert/strict";
import test from "node:test";
import { scoreOcrText } from "../src/ocr-score.js";
import type { Work } from "../src/types.js";

const work: Work = {
  key: "the-hobbit--j-r-r-tolkien",
  title: "The Hobbit",
  author: "J. R. R. Tolkien",
  series: "",
  volume: 1,
  status: "",
  language: "en",
  priority: 1,
  enabled: true,
  aliases: [],
  preferred_publishers: [],
  preferred_formats: [],
  isbn13: "",
  max_price: 150,
  notes: ""
};

test("OCR com título e autor legíveis confirma a obra", () => {
  const scored = scoreOcrText("THE HOBBIT J.R.R. TOLKIEN", work);
  assert.ok(scored.titleScore >= 0.9);
  assert.ok(scored.score >= 0.9);
});

test("OCR só com o título ainda confirma", () => {
  const scored = scoreOcrText("The Hobbit", work);
  assert.ok(scored.titleScore >= 0.9);
  assert.ok(scored.score >= 0.8);
});

test("OCR de texto aleatório não confirma", () => {
  const scored = scoreOcrText("livro em bom estado pouco uso", work);
  assert.ok(scored.titleScore < 0.4);
  assert.ok(scored.score < 0.4);
});

test("OCR vazio retorna zero", () => {
  assert.deepEqual(scoreOcrText("   ", work), {
    score: 0,
    titleScore: 0,
    authorScore: 0
  });
});
