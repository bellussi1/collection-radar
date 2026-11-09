import assert from "node:assert/strict";
import test from "node:test";
import {
  detectFormat,
  detectLanguage,
  detectPublisher,
  extractIsbn,
  isValidIsbn13,
  parsePrice
} from "../src/normalize.js";

test("parsePrice entende formato brasileiro", () => {
  assert.equal(parsePrice("R$ 1.234,56"), 1234.56);
  assert.equal(parsePrice("R$ 85,40"), 85.4);
  assert.equal(parsePrice("R$ 90"), 90);
  assert.equal(parsePrice("sem preço"), null);
});

test("detectLanguage separa edição PT de edição inglesa", () => {
  assert.equal(detectLanguage("Mistborn: O Império Final - Ediouro - Capa Mole"), "pt");
  assert.equal(detectLanguage("MISTBORN: OS BRACELETES DA PERDIÇÃO"), "pt");
  assert.equal(
    detectLanguage("The Well of Ascension: Mistborn Book Two - Gollancz - Paperback - English"),
    "en"
  );
});

test("detectPublisher não confunde editorial com Tor", () => {
  assert.equal(detectPublisher("Editorial Gollancz, capa mole"), "gollancz");
  assert.equal(detectPublisher("Tor Books, hardcover"), "tor");
  assert.equal(detectPublisher("HarperVoyager, paperback"), "harpervoyager");
});

test("detectFormat entende os termos dos anúncios", () => {
  assert.equal(detectFormat("Capa Dura com sobrecapa"), "hardcover");
  assert.equal(detectFormat("Capa Mole, brochura"), "paperback");
  assert.equal(detectFormat("Mass Market Paperback"), "mass_market");
});

test("ISBN-13 valida e extrai", () => {
  assert.equal(isValidIsbn13("9780007562251"), true);
  assert.equal(isValidIsbn13("9780007562252"), false);
  assert.equal(extractIsbn("ISBN 978-0-00-756225-1"), "9780007562251");
  assert.equal(extractIsbn("sem isbn"), null);
});
