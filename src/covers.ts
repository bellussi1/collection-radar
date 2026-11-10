import "dotenv/config";
import { loadWorks } from "./config.js";
import {
  classifyDistance,
  fetchImage,
  fetchJson,
  hashImage,
  minDistance,
  type CoverVerdict,
  type ImageHashes
} from "./coverhash.js";
import { RadarDb } from "./db.js";
import { containmentScore } from "./normalize.js";
import type { Work } from "./types.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] ?? fallback;
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function googleBooksKey(): string | null {
  const key = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  return key ? key : null;
}

function normalizeGoogleImage(url: string): string {
  const https = url.replace(/^http:\/\//, "https://");
  return https.replace(/&zoom=\d/, "&zoom=2");
}

async function openLibraryIsbnCover(isbn: string): Promise<{ url: string; buffer: Buffer } | null> {
  const url = `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`;
  const buffer = await fetchImage(url);
  await sleep(500);
  return buffer ? { url, buffer } : null;
}

async function openLibrarySearchCover(
  work: Work
): Promise<{ url: string; buffer: Buffer } | null> {
  const search = new URL("https://openlibrary.org/search.json");
  search.searchParams.set("title", work.title);
  search.searchParams.set("author", work.author);
  search.searchParams.set("limit", "5");
  search.searchParams.set("fields", "title,author_name,cover_i");

  const data = (await fetchJson(search.toString())) as
    | { docs?: Array<{ title?: string; author_name?: string[]; cover_i?: number }> }
    | null;
  await sleep(500);

  for (const doc of data?.docs ?? []) {
    if (!doc.cover_i) continue;
    const titleScore = containmentScore(work.title, doc.title ?? "");
    if (titleScore < 0.55) continue;
    const authors = doc.author_name ?? [];
    const authorOk =
      authors.length === 0 ||
      authors.some(
        (author) =>
          containmentScore(work.author, author) >= 0.5 ||
          containmentScore(author, work.author) >= 0.5
      );
    if (!authorOk) continue;

    const url = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
    const buffer = await fetchImage(url);
    await sleep(500);
    if (buffer) return { url, buffer };
  }
  return null;
}

async function googleBooksIsbnCover(isbn: string): Promise<{ url: string; buffer: Buffer } | null> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `isbn:${isbn}`);
  url.searchParams.set("maxResults", "5");
  const key = googleBooksKey();
  if (key) url.searchParams.set("key", key);

  const data = (await fetchJson(url.toString())) as
    | {
        items?: Array<{
          volumeInfo?: {
            imageLinks?: { thumbnail?: string; smallThumbnail?: string };
          };
        }>;
      }
    | null;
  await sleep(500);

  for (const item of data?.items ?? []) {
    const links = item.volumeInfo?.imageLinks;
    const image = links?.thumbnail ?? links?.smallThumbnail;
    if (!image) continue;
    const normalized = normalizeGoogleImage(image);
    const buffer = await fetchImage(normalized);
    await sleep(500);
    if (buffer) return { url: normalized, buffer };
  }
  return null;
}

async function googleBooksSearchCover(
  work: Work
): Promise<{ url: string; buffer: Buffer } | null> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `intitle:${work.title} inauthor:${work.author}`);
  url.searchParams.set("langRestrict", "en");
  url.searchParams.set("maxResults", "5");
  const key = googleBooksKey();
  if (key) url.searchParams.set("key", key);

  const data = (await fetchJson(url.toString())) as
    | {
        items?: Array<{
          volumeInfo?: {
            title?: string;
            authors?: string[];
            imageLinks?: { thumbnail?: string; smallThumbnail?: string };
          };
        }>;
      }
    | null;
  await sleep(500);

  for (const item of data?.items ?? []) {
    const info = item.volumeInfo ?? {};
    if (containmentScore(work.title, info.title ?? "") < 0.55) continue;
    const authors = info.authors ?? [];
    const authorOk =
      authors.length === 0 ||
      authors.some(
        (author) =>
          containmentScore(work.author, author) >= 0.5 ||
          containmentScore(author, work.author) >= 0.5
      );
    if (!authorOk) continue;

    const links = info.imageLinks;
    const image = links?.thumbnail ?? links?.smallThumbnail;
    if (!image) continue;
    const normalized = normalizeGoogleImage(image);
    const buffer = await fetchImage(normalized);
    await sleep(500);
    if (buffer) return { url: normalized, buffer };
  }
  return null;
}

async function resolveKnownCover(
  work: Work
): Promise<{ url: string; buffer: Buffer } | null> {
  if (work.isbn13) {
    return (
      (await openLibraryIsbnCover(work.isbn13)) ??
      (await googleBooksIsbnCover(work.isbn13))
    );
  }
  return (await openLibrarySearchCover(work)) ?? (await googleBooksSearchCover(work));
}

async function cachedImageHashes(
  db: RadarDb,
  url: string,
  referer?: string
): Promise<ImageHashes | null> {
  const cached = db.getImageHashes(url);
  if (cached) return cached;

  const buffer = await fetchImage(url, referer);
  await sleep(500);
  if (!buffer) return null;
  try {
    const hashes = await hashImage(buffer);
    db.saveImageHashes(url, hashes);
    return hashes;
  } catch (error) {
    console.warn(`  hash falhou: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function knownCoverHashes(
  db: RadarDb,
  work: Work
): Promise<{ url: string; hashes: ImageHashes } | null> {
  const cached = db.getWorkCover(work.key);
  if (cached?.url) {
    const hashes = await cachedImageHashes(db, cached.url);
    if (hashes) return { url: cached.url, hashes };
  }
  if (cached && !cached.url) {
    const age = Date.now() - Date.parse(cached.checkedAt);
    if (Number.isFinite(age) && age < 14 * 24 * 60 * 60 * 1000) return null;
  }

  const resolved = await resolveKnownCover(work);
  db.saveWorkCover(work.key, resolved?.url ?? null);
  if (!resolved) return null;

  try {
    const hashes = await hashImage(resolved.buffer);
    db.saveImageHashes(resolved.url, hashes);
    return { url: resolved.url, hashes };
  } catch {
    return null;
  }
}

function verdictLabel(verdict: CoverVerdict): string {
  switch (verdict) {
    case "same":
      return "igual";
    case "likely":
      return "provável";
    case "inconclusive":
      return "inconclusiva";
    case "different":
      return "diferente";
  }
}

async function main(): Promise<void> {
  const maxScore = Number(argValue("--max-score", "0.8"));
  const limit = Number(argValue("--limit", "200"));
  const force = hasFlag("--force");
  const db = new RadarDb("data/radar.db");
  const works = new Map(
    loadWorks()
      .filter((work) => work.enabled)
      .map((work) => [work.key, work])
  );

  const all = db.listDashboardMatches(10_000);
  const candidates = all
    .filter((row) => {
      const work = works.get(row.workKey);
      if (!work || !row.listing.imageUrl) return false;
      if (row.owned || row.feedbackStatus) return false;
      if (row.score > maxScore) return false;
      if (!force && db.getCoverCheck(row.listing.id, row.workKey)) return false;
      return true;
    })
    .slice(0, limit);

  console.log(
    `Capas: ${candidates.length} anúncios (confiança <= ${Math.round(maxScore * 100)}%, limite ${limit})${
      force ? " · forçando recálculo" : ""
    }`
  );

  const counts: Record<CoverVerdict, number> = {
    same: 0,
    likely: 0,
    inconclusive: 0,
    different: 0
  };
  let noCover = 0;
  let errors = 0;

  for (const [index, row] of candidates.entries()) {
    const work = works.get(row.workKey);
    if (!work || !row.listing.imageUrl) continue;

    const label = `${String(index + 1).padStart(3)}/${candidates.length}`;
    const listingHashes = await cachedImageHashes(
      db,
      row.listing.imageUrl,
      row.listing.url
    );
    if (!listingHashes) {
      errors += 1;
      console.log(`${label} ${work.title} — foto do anúncio indisponível`);
      continue;
    }

    const known = await knownCoverHashes(db, work);
    if (!known) {
      noCover += 1;
      console.log(`${label} ${work.title} — sem capa conhecida`);
      continue;
    }

    const distance = minDistance(listingHashes, known.hashes);
    const verdict = classifyDistance(distance);
    counts[verdict] += 1;
    db.saveCoverCheck(row.listing.id, row.workKey, distance, known.url, row.listing.imageUrl);
    console.log(
      `${label} ${work.title} — d=${String(distance).padStart(2)} ${verdictLabel(verdict)} · ${row.listing.source}`
    );
  }

  const total = candidates.length;
  console.log("");
  console.log(
    `Capas: ${total} verificadas · ${counts.same} iguais · ${counts.likely} prováveis · ` +
      `${counts.inconclusive} inconclusivas · ${counts.different} diferentes · ` +
      `${noCover} sem capa conhecida · ${errors} erros`
  );
  db.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
