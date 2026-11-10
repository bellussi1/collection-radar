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

function hasSingleVolumeMarker(title: string): boolean {
  const normalized = normalizeText(title);
  return (
    /\b(book|livro|volume|vol|trilogy|trilogia|series|serie)\s*#?\d+\b/.test(normalized) ||
    /\b(book|livro|volume|vol)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(
      normalized
    ) ||
    /\b#\d+\b/.test(normalized)
  );
}

function isStrongSetListing(title: string, haystack: string): boolean {
  const normalizedTitle = normalizeText(title);
  const normalizedHaystack = normalizeText(haystack);
  return (
    /\b(kit|lote|box|boxed|boxset|colecao completa|complete series|complete set|omnibus)\b/.test(
      normalizedTitle
    ) ||
    /\b\d+\s*(livros?|books?|volumes?)\b/.test(normalizedTitle) ||
    /\bvolumes?\s*\d+\s*(a|-|ate)\s*\d+\b/.test(normalizedTitle) ||
    /\b(box set|boxed set|kit|lote|colecao completa|complete series|omnibus)\b/.test(
      normalizedHaystack
    )
  );
}

function isWeakSetListing(title: string): boolean {
  if (hasSingleVolumeMarker(title)) return false;
  const normalized = normalizeText(title);
  return /\b(trilogy|trilogia|collection)\b/.test(normalized);
}

function isSetWork(work: Work): boolean {
  if (work.notes.includes("Keepa set")) return true;
  const title = normalizeText(work.title);
  return /\b(box|boxed|boxset|collection|trilogy|trilogia|omnibus|complete|kit|set)\b/.test(title);
}

function isEditionWork(work: Work): boolean {
  return /\b(illustrated|deluxe|collector|collectors|anniversary|special|limited|signed)\b/i.test(
    work.title
  );
}

function isGenericWork(work: Work): boolean {
  const title = normalizeText(work.title).replace(/^by /, "").trim();
  return title === normalizeText(work.author);
}

function setCount(title: string): number | null {
  const match = normalizeText(title).match(/\b(\d+)\s*(books?|livros?|volumes?)\b/);
  return match?.[1] ? Number(match[1]) : null;
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
  const listingStrongSet = isStrongSetListing(listing.title, haystack);
  const listingWeakSet = isWeakSetListing(listing.title);
  const listingIsEdition =
    /\b(illustrated|deluxe|collector|collectors|anniversary|special|limited|signed)\b/i.test(
      haystack
    );
  const nonBook =
    /\b(cd|vinil|lp|jogo|board game|jogo de tabuleiro|action figure|camiseta|poster|pôster|mangá)\b/i.test(
      haystack
    );
  const bookish = /\b(livro|book|isbn|paperback|hardcover|capa|editora)\b/i.test(haystack);
  if (nonBook && !bookish) return null;

  let best: MatchResult | null = null;
  let bestTitleTokens = 0;

  for (const work of works) {
    if (!work.enabled) continue;
    if (isGenericWork(work)) continue;
    const workIsSet = isSetWork(work);
    const listingIsSet = listingStrongSet || (listingWeakSet && workIsSet);
    if (workIsSet !== listingIsSet) continue;
    if (isEditionWork(work) && !listingIsEdition) continue;
    // Edições específicas do Keepa só casam com anúncios que também são edição.
    if (work.notes.includes("Keepa edição específica") && !listingIsEdition) continue;
    if (workIsSet) {
      const workCount = setCount(work.title);
      const listingCount = setCount(listing.title);
      if (workCount !== null && listingCount !== null && workCount !== listingCount) continue;
    }

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
      // Se o título não ajuda, a descrição precisa ser quase exata e o autor
      // precisa aparecer no título. Evita blurb que cita outro autor.
      if (titleOnly < 0.3) {
        if (titleHaystack < 0.9) continue;
        // Exige o nome completo do autor no título; "king" de "half a king"
        // não pode confirmar Stephen King.
        const authorTitle = containmentScore(listing.title, work.author);
        if (authorTitle < 0.9) continue;
      }
      // Título fraco não confirma edição; sets e edições PT já foram cortados.
      if (title < 0.55) continue;
      const author = authorScore(haystack, work.author);
      const series = work.series ? containmentScore(haystack, work.series) : 0;

      // Sem autor não dá para confirmar edição; evita CD, jogo e título genérico.
      if (author < 0.2) continue;

      if (title >= 0.55) reasons.push("título");
      if (author >= 0.6) reasons.push("autor");
      if (series >= 0.6) reasons.push("série");

      score =
        author > 0 ? 0.55 * title + 0.3 * author + 0.15 * series : 0.85 * title + 0.15 * series;

      // Um autor/série sozinho não basta: evita alertar qualquer livro do autor.
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
        // O radar é para edições originais em inglês. Edição PT não entra.
        continue;
      }
      if (listingIsSet) reasons.push("conjunto/box");
    }

    score = Math.max(0, Math.min(1, score));
    if (score < minScore) continue;

    const titleTokens = tokenSet(work.title).size;
    if (
      !best ||
      score > best.score ||
      (score === best.score && titleTokens > bestTitleTokens) ||
      (score === best.score &&
        titleTokens === bestTitleTokens &&
        work.priority < best.work.priority)
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
