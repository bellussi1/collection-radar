import "dotenv/config";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { stringify } from "yaml";
import { loadWorks } from "./config.js";
import { containmentScore, isValidIsbn13, jaccardScore, normalizeText } from "./normalize.js";
import type { Work } from "./types.js";

const USER_AGENT = "collection-radar/0.1 (personal book radar)";
const REPORT_PATH = "config/isbn-validation.yaml";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type ValidationStatus = "ok" | "review" | "divergent" | "missing";

export interface IsbnMetadata {
  source: "openlibrary" | "googlebooks";
  title: string;
  authors: string[];
  publisher: string;
  publishedDate: string;
  language: string;
}

export interface SourceResult {
  found: boolean;
  metadata: IsbnMetadata | null;
  error: string | null;
}

export interface ValidationItem {
  work_key: string;
  title: string;
  author: string;
  isbn13: string;
  preferred_publishers: string[];
  status: ValidationStatus;
  issues: string[];
  title_score: number | null;
  author_score: number | null;
  publisher_match: boolean | null;
  sources: {
    openlibrary: SourceResult;
    googlebooks: SourceResult;
  };
}

interface Comparison {
  titleScore: number;
  authorScore: number | null;
  publisherMatch: boolean | null;
  issues: string[];
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] ?? fallback;
  return fallback;
}

export function comparableTitle(title: string): string {
  const trimmed = title
    .replace(/\s*[([][^)\]]*[)\]]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const [main = "", ...rest] = trimmed.split(":");
  if (rest.length === 0) return trimmed;
  const suffix = rest.join(":").toLowerCase();
  return /\b(book|volume|vol\.?|novel|archive|series)\b/.test(suffix) ? main.trim() : trimmed;
}

const PUBLISHER_GROUPS: string[][] = [
  ["harpervoyager", "harpercollins", "voyager"],
  ["delrey", "ballantine", "randomhouse", "penguinrandomhouse", "vintage", "knopf"],
  ["tor", "macmillan", "torbooks"],
  ["gollancz", "orion"],
  ["orbit", "hachette", "littlebrown"],
  ["ace", "berkley", "penguin", "penguinrandomhouse"],
  ["daw", "penguin", "penguinrandomhouse"],
  ["bantam", "randomhouse", "penguinrandomhouse"],
  ["picador", "macmillan", "panmacmillan"],
  ["roc", "penguin", "penguinrandomhouse"],
  ["stmartins", "macmillan"],
  ["fsg", "farrar", "macmillan"],
  ["sagapress", "simonschuster"]
];

function publisherGroup(value: string): Set<string> {
  const normalized = normalizeText(value).replace(/\s+/g, "");
  const group = new Set([normalized]);
  for (const members of PUBLISHER_GROUPS) {
    if (members.some((member) => normalized.includes(member))) {
      for (const member of members) group.add(member);
    }
  }
  return group;
}

export function publisherMatches(preferred: string[], actual: string): boolean {
  if (normalizeText(actual).replace(/\s+/g, "").length < 3) return false;
  const actualGroup = publisherGroup(actual);
  return preferred.some((publisher) => {
    const preferredGroup = publisherGroup(publisher);
    return [...preferredGroup].some(
      (member) => member.length > 2 && [...actualGroup].some((other) => other.includes(member))
    );
  });
}

function hasNonLatin(value: string): boolean {
  return /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u.test(value);
}

export function authorScore(workAuthor: string, authors: string[]): number {
  const haystack = authors.join(" ");
  if (!haystack) return 0;
  const full = containmentScore(workAuthor, haystack);
  const lastName = workAuthor.split(/\s+/).filter(Boolean).at(-1) ?? "";
  const last = lastName.length >= 3 ? containmentScore(lastName, haystack) : 0;
  return Math.max(full, last * 0.9);
}

export function parseOpenLibraryBook(isbn: string, json: unknown): IsbnMetadata | null {
  if (!json || typeof json !== "object") return null;
  const entry = (json as Record<string, unknown>)[`ISBN:${isbn}`];
  if (!entry || typeof entry !== "object") return null;
  const data = entry as Record<string, unknown>;
  const title = [data.title, data.subtitle]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(": ");
  if (!title) return null;

  const authors = Array.isArray(data.authors)
    ? data.authors
        .map((author) =>
          typeof author === "object" && author
            ? String((author as { name?: unknown }).name ?? "").trim()
            : ""
        )
        .filter(Boolean)
    : [];
  const publishers = Array.isArray(data.publishers)
    ? data.publishers
        .map((publisher) =>
          typeof publisher === "object" && publisher
            ? String((publisher as { name?: unknown }).name ?? "").trim()
            : ""
        )
        .filter(Boolean)
    : [];

  return {
    source: "openlibrary",
    title,
    authors,
    publisher: publishers.join(" "),
    publishedDate: String(data.publish_date ?? "").trim(),
    language: ""
  };
}

export function parseGoogleBooksVolume(isbn: string, json: unknown): IsbnMetadata | null {
  if (!json || typeof json !== "object") return null;
  const items = (json as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const info = (item as { volumeInfo?: unknown }).volumeInfo;
    if (!info || typeof info !== "object") continue;
    const volume = info as Record<string, unknown>;
    const identifiers = Array.isArray(volume.industryIdentifiers) ? volume.industryIdentifiers : [];
    const matches = identifiers.some((identifier) => {
      if (!identifier || typeof identifier !== "object") return false;
      const id = identifier as { type?: unknown; identifier?: unknown };
      return id.type === "ISBN_13" && String(id.identifier ?? "").replace(/-/g, "") === isbn;
    });
    if (!matches) continue;

    const title = [volume.title, volume.subtitle]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(": ");
    if (!title) continue;

    return {
      source: "googlebooks",
      title,
      authors: Array.isArray(volume.authors) ? volume.authors.map(String) : [],
      publisher: String(volume.publisher ?? "").trim(),
      publishedDate: String(volume.publishedDate ?? "").trim(),
      language: String(volume.language ?? "").trim()
    };
  }
  return null;
}

export function compareMetadata(work: Work, metadata: IsbnMetadata): Comparison {
  const issues: string[] = [];
  const titleScore = jaccardScore(comparableTitle(work.title), comparableTitle(metadata.title));
  if (titleScore < 0.6) {
    issues.push(`título: "${work.title}" vs "${metadata.title}"`);
  } else if (titleScore < 0.8) {
    issues.push(`título parcial: "${work.title}" vs "${metadata.title}"`);
  }

  const author = metadata.authors.length > 0 ? authorScore(work.author, metadata.authors) : null;
  if (author === null) {
    issues.push("autor não informado pela API");
  } else if (author < 0.6) {
    if (metadata.authors.some(hasNonLatin)) {
      issues.push(`autor em outro alfabeto: ${metadata.authors.join(", ")}`);
    } else {
      issues.push(`autor: "${work.author}" vs "${metadata.authors.join(", ")}"`);
    }
  }

  let publisherMatch: boolean | null = null;
  if (work.preferred_publishers.length > 0) {
    if (!metadata.publisher) {
      issues.push("editora não informada pela API");
    } else {
      publisherMatch = publisherMatches(work.preferred_publishers, metadata.publisher);
      if (!publisherMatch) {
        issues.push(
          `editora: esperada ${work.preferred_publishers.join(" / ")}, encontrada ${metadata.publisher}`
        );
      }
    }
  }

  if (metadata.language && !["en", "eng"].includes(metadata.language.toLowerCase())) {
    issues.push(`idioma: ${metadata.language}`);
  }

  return { titleScore, authorScore: author, publisherMatch, issues };
}

export function validateWork(
  work: Work,
  openlibrary: SourceResult,
  googlebooks: SourceResult
): ValidationItem {
  const issues: string[] = [];
  const comparisons: Comparison[] = [];
  const sources: Array<[string, SourceResult]> = [
    ["Open Library", openlibrary],
    ["Google Books", googlebooks]
  ];

  for (const [label, result] of sources) {
    if (result.metadata) {
      comparisons.push(compareMetadata(work, result.metadata));
    } else if (result.error) {
      issues.push(`${label}: ${result.error}`);
    } else {
      issues.push(`${label}: ISBN não encontrado`);
    }
  }

  const base = {
    work_key: work.key,
    title: work.title,
    author: work.author,
    isbn13: work.isbn13,
    preferred_publishers: work.preferred_publishers,
    sources: { openlibrary, googlebooks }
  };

  if (comparisons.length === 0) {
    return {
      ...base,
      status: "missing",
      issues,
      title_score: null,
      author_score: null,
      publisher_match: null
    };
  }

  const titleScore = Math.min(...comparisons.map((item) => item.titleScore));
  const authorScores = comparisons
    .map((item) => item.authorScore)
    .filter((value): value is number => value !== null);
  const author = authorScores.length > 0 ? Math.min(...authorScores) : null;
  const publisherResults = comparisons
    .map((item) => item.publisherMatch)
    .filter((value): value is boolean => value !== null);
  const publisherMatch = publisherResults.length > 0 ? publisherResults.every(Boolean) : null;
  const allIssues = [...issues, ...comparisons.flatMap((item) => item.issues)];
  const nonLatinAuthor = comparisons.some((item) =>
    item.issues.some((issue) => issue.startsWith("autor em outro alfabeto"))
  );

  let status: ValidationStatus = "ok";
  if (titleScore < 0.45 || (author !== null && author < 0.45 && !nonLatinAuthor)) {
    status = "divergent";
  } else if (
    titleScore < 0.7 ||
    (author !== null && author < 0.7) ||
    publisherMatch === false ||
    nonLatinAuthor ||
    allIssues.some((issue) => issue.includes("não informad"))
  ) {
    status = "review";
  }

  return {
    ...base,
    status,
    issues: allIssues,
    title_score: Number(titleScore.toFixed(3)),
    author_score: author === null ? null : Number(author.toFixed(3)),
    publisher_match: publisherMatch
  };
}

async function fetchJson(
  url: string,
  retries: number
): Promise<{ data: unknown | null; error: string | null }> {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(15_000)
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < retries) {
          await sleep(2000);
          continue;
        }
        return { data: null, error: `HTTP ${response.status}` };
      }
      if (!response.ok) return { data: null, error: `HTTP ${response.status}` };
      return { data: (await response.json()) as unknown, error: null };
    } catch (error) {
      if (attempt < retries) {
        await sleep(1000);
        continue;
      }
      return { data: null, error: error instanceof Error ? error.message : String(error) };
    }
  }
  return { data: null, error: "falha desconhecida" };
}

async function fetchOpenLibrary(isbn: string): Promise<SourceResult> {
  const url = new URL("https://openlibrary.org/api/books");
  url.searchParams.set("bibkeys", `ISBN:${isbn}`);
  url.searchParams.set("format", "json");
  url.searchParams.set("jscmd", "data");
  const response = await fetchJson(url.toString(), 2);
  if (response.error) return { found: false, metadata: null, error: response.error };
  const metadata = parseOpenLibraryBook(isbn, response.data);
  return {
    found: metadata !== null,
    metadata,
    error: metadata ? null : "ISBN não encontrado"
  };
}

async function fetchGoogleBooks(isbn: string): Promise<SourceResult> {
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", `isbn:${isbn}`);
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY?.trim();
  if (apiKey) url.searchParams.set("key", apiKey);
  const response = await fetchJson(url.toString(), 1);
  if (response.error) return { found: false, metadata: null, error: response.error };
  const metadata = parseGoogleBooksVolume(isbn, response.data);
  return {
    found: metadata !== null,
    metadata,
    error: metadata ? null : "ISBN não encontrado"
  };
}

function formatItem(item: ValidationItem): string {
  const label = item.status.padEnd(9);
  const detail = item.issues.find(
    (issue) => !issue.startsWith("Open Library:") && !issue.startsWith("Google Books:")
  );
  return `${label} ${item.title} (${item.isbn13})${detail ? ` — ${detail}` : ""}`;
}

async function main(): Promise<void> {
  const limit = Number(argValue("--limit", "0"));
  const delay = Number(argValue("--delay", "300"));
  const works = loadWorks().filter((work) => work.enabled && isValidIsbn13(work.isbn13));
  const selected = limit > 0 ? works.slice(0, limit) : works;

  console.log(`Validando ${selected.length} ISBNs contra Open Library e Google Books...`);
  const items: ValidationItem[] = [];
  let googleBooksEnabled = true;

  for (const [index, work] of selected.entries()) {
    const openlibrary = await fetchOpenLibrary(work.isbn13);
    let googlebooks: SourceResult = {
      found: false,
      metadata: null,
      error: "fonte desabilitada após HTTP 429"
    };
    if (googleBooksEnabled) {
      googlebooks = await fetchGoogleBooks(work.isbn13);
      if (googlebooks.error?.startsWith("HTTP 429")) {
        googleBooksEnabled = false;
        console.warn("Google Books: quota esgotada; seguindo só com Open Library.");
      }
    }

    const item = validateWork(work, openlibrary, googlebooks);
    items.push(item);
    console.log(`${String(index + 1).padStart(2)}/${selected.length} ${formatItem(item)}`);

    if (index < selected.length - 1) await sleep(Number.isFinite(delay) ? delay : 300);
  }

  const summary = {
    total: items.length,
    ok: items.filter((item) => item.status === "ok").length,
    review: items.filter((item) => item.status === "review").length,
    divergent: items.filter((item) => item.status === "divergent").length,
    missing: items.filter((item) => item.status === "missing").length
  };
  const order: Record<ValidationStatus, number> = {
    divergent: 0,
    review: 1,
    missing: 2,
    ok: 3
  };
  items.sort(
    (a, b) => order[a.status] - order[b.status] || a.title.localeCompare(b.title, "pt-BR")
  );

  writeFileSync(
    REPORT_PATH,
    stringify({ generated_at: new Date().toISOString(), summary, items }),
    "utf8"
  );

  const flagged = items.filter((item) => item.status !== "ok");
  if (flagged.length > 0) {
    console.log("");
    console.log("Para revisar:");
    for (const item of flagged) {
      console.log(`- ${item.status}: ${item.title} (${item.isbn13})`);
      const details = item.issues.filter(
        (issue) => !issue.startsWith("Open Library:") && !issue.startsWith("Google Books:")
      );
      for (const issue of details.length > 0 ? details : item.issues) console.log(`  ${issue}`);
    }
  }

  console.log("");
  console.log(
    `Resumo: ${summary.ok} ok · ${summary.review} revisar · ${summary.divergent} divergentes · ${summary.missing} não encontrados`
  );
  console.log(`Relatório: ${REPORT_PATH}`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
