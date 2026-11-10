/**
 * Extrai a nota do vendedor do texto do card de busca. OLX e Mercado Livre
 * colocam a nota (0–5) na linha imediatamente abaixo do nome do vendedor.
 */
export function extractSellerRating(text: string, seller: string | null): number | null {
  if (!seller) return null;
  const target = seller.trim().toLowerCase();
  if (!target) return null;

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const index = lines.findIndex((line) => line.toLowerCase() === target);
  if (index < 0) return null;

  const next = lines[index + 1];
  const match = next?.match(/^([0-5](?:[.,]\d)?)$/);
  if (!match?.[1]) return null;
  const rating = Number(match[1].replace(",", "."));
  return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
}

/** Nota no formato 4.8/4,8, sem confundir com preço. */
export function parseSellerScore(text: string | null | undefined): number | null {
  const match = (text ?? "").match(/\b([0-5][.,]\d)\b/);
  if (!match?.[1]) return null;
  const rating = Number(match[1].replace(",", "."));
  return Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
}
