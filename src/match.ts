import {
  containmentScore,
  detectFormat,
  detectLanguage,
  detectPublisher,
  extractIsbn,
  normalizeText,
  tokenSet
} from "./normalize.js";
import type { MatchResult, RawListing, Work } from "./types.js";

function authorScore(haystack: string, author: string): number {
  const full = containmentScore(haystack, author);
  const lastName = author.split(/\s+/).filter(Boolean).at(-1) ?? "";
  if (lastName.length < 3) return full;
  const last = containmentScore(haystack, lastName);
  return Math.max(full, last * 0.9);
}

function isSet(text: string): boolean {
  const normalized = normalizeText(text);
  return ["box", "trilogia", "trilogy", "colecao", "collection", "kit", "lote", "volumes"].some(
    (word) => normalized.includes(word)
  );
}

export function matchListing(
  listing: RawListing,
  works: Work[],
  minScore: number
): MatchResult | null {
  const haystack = [listing.title, listing.description, listing.condition]
    .filter(Boolean)
    .join(" ");
  const language = detectLanguage(haystack);
  const format = detectFormat(haystack);
  const publisher = detectPublisher(haystack);
  const isbn = extractIsbn(haystack);
  const set = isSet(haystack);
  const listingIsSet = /\b(set|boxed|box set|collection|trilogy|complete)\b/i.test(haystack);
  const listingIsEdition = /\b(illustrated|deluxe|collector|collectors|anniversary|special|limited|signed)\b/i.test(
    haystack
  );
  const nonBook = /\b(cd|vinil|lp|jogo|board game|jogo de tabuleiro|action figure|camiseta|poster|pôster|mangá)\b/i.test(
    haystack
  );
  const bookish = /\b(livro|book|isbn|paperback|hardcover|capa|editora)\b/i.test(haystack);
  if (nonBook && !bookish) return null;

  let best: MatchResult | null = null;
  let bestTitleTokens = 0;

  for (const work of works) {
    if (!work.enabled) continue;
    // Sets e edições específicas do Keepa só casam com anúncios que também são set/edição.
    if (work.notes.includes("Keepa set") && !listingIsSet) continue;
    if (work.notes.includes("Keepa edição específica") && !listingIsEdition) continue;

    const reasons: string[] = [];
    let score = 0;

    if (work.isbn13 && isbn && isbn === work.isbn13) {
      score = 1;
      reasons.push("ISBN exato");
    } else {
      const titleCandidates = [work.title, ...work.aliases].filter((value) => value.length > 2);
      let titleOnly = 0;
      let titleHaystack = 0;
      for (const candidate of titleCandidates) {
        titleOnly = Math.max(titleOnly, containmentScore(listing.title, candidate));
        titleHaystack = Math.max(titleHaystack, containmentScore(haystack, candidate));
      }
      // Título no anúncio vale mais; descrição sozinha vale 85%.
      const title = Math.max(titleOnly, titleHaystack * 0.85);
      // Se o título não ajuda, a descrição precisa ser quase exata.
      if (titleOnly < 0.3 && titleHaystack < 0.9) continue;
      const author = authorScore(haystack, work.author);
      const series = work.series ? containmentScore(haystack, work.series) : 0;

      // Sem autor não dá para confirmar edição; evita CD, jogo e título genérico.
      if (author < 0.2) continue;

      if (title >= 0.45) reasons.push("título");
      if (author >= 0.6) reasons.push("autor");
      if (series >= 0.6) reasons.push("série");

      score =
        author > 0
          ? 0.55 * title + 0.3 * author + 0.15 * series
          : 0.85 * title + 0.15 * series;

      // Um autor/série sozinho não basta: evita alertar qualquer livro do autor.
      const weakTitle = title < 0.45;

      const publisherKey = publisher?.replace(/\s+/g, "");
      if (
        publisherKey &&
        work.preferred_publishers.some(
          (item) => normalizeText(item).replace(/\s+/g, "") === publisherKey
        )
      ) {
        score += 0.08;
        reasons.push(`editora ${publisher}`);
      }
      if (format !== "unknown" && work.preferred_formats.includes(format)) {
        score += 0.04;
        reasons.push(format);
      }
      if (language === "en") {
        score += 0.05;
        reasons.push("inglês");
      } else if (language === "pt") {
        // O radar é para edições originais em inglês. Edição PT não entra no digest.
        score = Math.min(score - 0.12, 0.45);
        reasons.push("edição PT (ignorada)");
      }
      if (weakTitle) score = Math.min(score, 0.55);
      if (set) reasons.push("conjunto/box");
    }

    score = Math.max(0, Math.min(1, score));
    if (score < minScore) continue;

    const titleTokens = tokenSet(work.title).size;
    if (
      !best ||
      score > best.score ||
      (score === best.score && titleTokens > bestTitleTokens) ||
      (score === best.score && titleTokens === bestTitleTokens && work.priority < best.work.priority)
    ) {
      best = {
        work,
        score,
        reasons: [...new Set(reasons)],
        language,
        format,
        publisher
      };
      bestTitleTokens = titleTokens;
    }
  }

  return best;
}
