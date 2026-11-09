import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { stringify } from "yaml";
import { loadWorks } from "./config.js";
import {
  containmentScore,
  detectFormat,
  isValidIsbn13,
  normalizeText
} from "./normalize.js";
import type { Work } from "./types.js";

const USER_AGENT = "collection-radar/0.1 (personal book radar)";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Candidate {
  isbn13: string;
  title: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  format: "hardcover" | "paperback" | "mass_market" | "unknown";
  language: string;
  source: "openlibrary" | "googlebooks";
}

interface ScoredCandidate extends Candidate {
  score: number;
  reasons: string[];
}

interface Proposal {
  work_key: string;
  title: string;
  author: string;
  preferred_publishers: string[];
  proposals: ScoredCandidate[];
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] ?? fallback;
  return fallback;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" }
    });
    if (!response.ok) {
      console.warn(`  HTTP ${response.status} em ${url}`);
      return null;
    }
    return (await response.json()) as unknown;
  } catch (error) {
    console.warn(`  erro de rede: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function openLibraryCandidates(work: Work): Promise<Candidate[]> {
  const searchUrl = new URL("https://openlibrary.org/search.json");
  searchUrl.searchParams.set("title", work.title);
  searchUrl.searchParams.set("author", work.author);
  searchUrl.searchParams.set("language", "eng");
  searchUrl.searchParams.set("limit", "5");
  searchUrl.searchParams.set("fields", "key,title,author_name,first_publish_year");

  const search = (await fetchJson(searchUrl.toString())) as
    | { docs?: Array<{ key?: string }> }
    | null;
  const workKey = search?.docs?.[0]?.key;
  if (!workKey) return [];

  const editionsUrl = `https://openlibrary.org${workKey}/editions.json?limit=50`;
  const editions = (await fetchJson(editionsUrl)) as
    | { entries?: Array<Record<string, unknown>> }
    | null;

  const candidates: Candidate[] = [];
  for (const entry of editions?.entries ?? []) {
    const isbns = Array.isArray(entry.isbn_13) ? entry.isbn_13 : [];
    const publishers = Array.isArray(entry.publishers) ? entry.publishers : [];
    const languages = Array.isArray(entry.languages) ? entry.languages : [];
    const publisher = publishers.map(String).join(" ");
    const language = languages
      .map((item) => (typeof item === "object" && item ? String((item as { key?: string }).key ?? "") : ""))
      .join(",")
      .replace(/\/languages\//g, "");
    const format = detectFormat(String(entry.physical_format ?? ""));
    for (const isbn of isbns) {
      candidates.push({
        isbn13: String(isbn).replace(/-/g, ""),
        title: String(entry.title ?? work.title),
        authors: [work.author],
        publisher,
        publishedDate: String(entry.publish_date ?? ""),
        format,
        language,
        source: "openlibrary"
      });
    }
  }
  return candidates;
}

async function googleBooksCandidates(work: Work): Promise<Candidate[]> {
  const query = `intitle:${work.title} inauthor:${work.author}`;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("langRestrict", "en");
  url.searchParams.set("maxResults", "10");
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  if (apiKey) url.searchParams.set("key", apiKey);

  const data = (await fetchJson(url.toString())) as
    | { items?: Array<{ volumeInfo?: Record<string, unknown> }> }
    | null;

  const candidates: Candidate[] = [];
  for (const item of data?.items ?? []) {
    const info = item.volumeInfo ?? {};
    const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers : [];
    const isbns = identifiers
      .filter((id) => typeof id === "object" && id && (id as { type?: string }).type === "ISBN_13")
      .map((id) => String((id as { identifier?: string }).identifier ?? "").replace(/-/g, ""));
    const publisher = String(info.publisher ?? "");
    const title = [info.title, info.subtitle].filter(Boolean).map(String).join(": ");
    const authors = Array.isArray(info.authors) ? info.authors.map(String) : [work.author];
    const format = detectFormat([title, publisher].join(" "));
    for (const isbn of isbns) {
      candidates.push({
        isbn13: isbn,
        title,
        authors,
        publisher,
        publishedDate: String(info.publishedDate ?? ""),
        format,
        language: String(info.language ?? ""),
        source: "googlebooks"
      });
    }
  }
  return candidates;
}

function scoreCandidate(candidate: Candidate, work: Work): ScoredCandidate {
  const reasons: string[] = [];
  if (!isValidIsbn13(candidate.isbn13)) {
    return { ...candidate, score: 0, reasons: ["ISBN inválido"] };
  }

  const titleScore = containmentScore(work.title, candidate.title);
  const authorScore = containmentScore(work.author, candidate.authors.join(" "));
  if (titleScore < 0.55 || authorScore < 0.5) {
    return { ...candidate, score: 0, reasons: ["título/autor não batem"] };
  }

  const haystack = normalizeText([candidate.title, candidate.publisher, candidate.publishedDate].join(" "));
  if (
    /(summary|study guide|annotated|large print|abridged|movie tie|box set|omnibus|collection|analysis)/.test(
      haystack
    )
  ) {
    return { ...candidate, score: 0, reasons: ["edição não desejada"] };
  }

  let score = 0;
  score += titleScore * 30;
  if (titleScore >= 0.8) reasons.push("título");
  score += authorScore * 20;
  if (authorScore >= 0.8) reasons.push("autor");

  const publisher = normalizeText(candidate.publisher).replace(/\s+/g, "");
  const preferred = work.preferred_publishers.map((item) => normalizeText(item).replace(/\s+/g, ""));
  if (preferred.some((item) => item.length > 2 && publisher.includes(item))) {
    score += 40;
    reasons.push(`editora ${candidate.publisher}`);
  } else if (publisher) {
    score += 5;
  }

  if (candidate.format !== "unknown" && work.preferred_formats.includes(candidate.format)) {
    score += 20;
    reasons.push(candidate.format);
  }
  if (candidate.language === "" || candidate.language === "en" || candidate.language === "eng") {
    score += 10;
    reasons.push("inglês");
  } else {
    return { ...candidate, score: 0, reasons: ["idioma não inglês"] };
  }

  return {
    ...candidate,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons
  };
}

function dedupe(scored: ScoredCandidate[]): ScoredCandidate[] {
  const byIsbn = new Map<string, ScoredCandidate>();
  for (const candidate of scored) {
    const current = byIsbn.get(candidate.isbn13);
    if (!current || candidate.score > current.score) byIsbn.set(candidate.isbn13, candidate);
  }
  return [...byIsbn.values()]
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.publishedDate.localeCompare(b.publishedDate));
}

function loadExistingOverrides(): Record<string, string> {
  try {
    const raw = readFileSync("config/isbn-overrides.yaml", "utf8");
    const parsed = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const match = line.match(/^"([^"]+)":\s*"([^"]+)"/);
        return match ? [match[1], match[2]] : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry));
    return Object.fromEntries(parsed);
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const limit = Number(argValue("--limit", "50"));
  const minConfidence = Number(argValue("--min-confidence", "85"));
  const works = loadWorks()
    .filter((work) => work.enabled && work.priority <= 2 && !work.isbn13)
    .slice(0, limit);

  console.log(`Enriquecendo ${works.length} obras (limite ${limit}, confiança mínima ${minConfidence})`);

  const proposals: Proposal[] = [];
  const overrides = loadExistingOverrides();

  for (const [index, work] of works.entries()) {
    const openLibrary = await openLibraryCandidates(work);
    await sleep(900);
    const googleBooks = await googleBooksCandidates(work);
    await sleep(500);

    const scored = dedupe(
      [...openLibrary, ...googleBooks].map((candidate) => scoreCandidate(candidate, work))
    );
    proposals.push({
      work_key: work.key,
      title: work.title,
      author: work.author,
      preferred_publishers: work.preferred_publishers,
      proposals: scored.slice(0, 3)
    });

    const best = scored[0];
    const publisherMatched = Boolean(best?.reasons.some((reason) => reason.startsWith("editora ")));
    if (
      best &&
      best.score >= minConfidence &&
      (publisherMatched || work.preferred_publishers.length === 0)
    ) {
      overrides[work.key] = best.isbn13;
    }
    console.log(
      `${String(index + 1).padStart(2)}/${works.length} ${work.title} — ${
        best ? `${best.isbn13} (${best.score}%) ${best.publisher}` : "sem proposta"
      }`
    );
  }

  writeFileSync(
    "config/isbn-proposals.yaml",
    stringify({ generated_at: new Date().toISOString(), proposals }),
    "utf8"
  );

  const lines = [
    "# Gerado por npm run enrich. Revise antes de confiar.",
    "# Formato: work_key: isbn13",
    ...Object.entries(overrides)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, isbn]) => `${JSON.stringify(key)}: ${JSON.stringify(isbn)}`)
  ];
  writeFileSync("config/isbn-overrides.yaml", lines.join("\n") + "\n", "utf8");

  console.log("");
  console.log(`Propostas: config/isbn-proposals.yaml`);
  console.log(`Overrides com confiança >= ${minConfidence}: config/isbn-overrides.yaml`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
