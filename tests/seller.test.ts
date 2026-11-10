import assert from "node:assert/strict";
import test from "node:test";
import { extractSellerRating } from "../src/seller.js";

test("extrai nota do vendedor da OLX", () => {
  const text = "box jurassic park\nEntrega Fácil\n\nNico\n5.0\n\nR$ 100\nPoá, Jardim Nova Poá";
  assert.equal(extractSellerRating(text, "Nico"), 5);
});

test("extrai nota do vendedor do Mercado Livre", () => {
  const text = "Máscara de cílios\nMAYBELLINE \n 4.8\nR$\n71\n,69";
  assert.equal(extractSellerRating(text, "MAYBELLINE"), 4.8);
});

test("não confunde preço com nota quando o vendedor não tem nota", () => {
  const text = "Livro\nLivraria Martins Fontes \nR$\n5\n,00";
  assert.equal(extractSellerRating(text, "Livraria Martins Fontes"), null);
});

test("retorna null sem vendedor ou sem linha de nota", () => {
  assert.equal(extractSellerRating("Nico\n5.0", null), null);
  assert.equal(extractSellerRating("Nico\nEntrega Fácil", "Nico"), null);
});
