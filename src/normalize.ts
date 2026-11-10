const STOPWORDS = new Set([
  "a", "o", "as", "os", "um", "uma", "de", "da", "do", "das", "dos", "em", "no", "na",
  "nos", "nas", "para", "por", "com", "sem", "e", "ou", "que", "se", "ao", "aos",
  "the", "an", "of", "and", "or", "to", "in", "on", "for", "with", "by", "from",
  "livro", "livros", "book", "books", "edicao", "edition", "capa", "mole", "dura",
  "comum", "brochura", "paperback", "hardcover", "hardback", "novo", "nova", "usado",
  "usada", "seminovo", "ingles", "english", "importado", "importada", "volume", "vol",
  "serie", "series", "colecao", "collection", "box", "kit", "lote"
]);

const PT_PUBLISHERS = [
  "suma", "aleph", "intrinseca", "trama", "leya", "darkside", "globo alt", "plataforma21",
  "morro branco", "boitempo", "companhia das letras", "record", "sextante", "arqueiro",
  "alta books", "alta novel", "estrada dos livros", "editora planeta", "vestigio",
  "ediouro", "novo seculo", "faro editorial", "tusquets", "planet", "sextante",
  "harpercollins brasil"
];

const EN_PUBLISHERS = [
  "harpervoyager", "harper voyager", "harpercollins", "del rey", "tor", "gollancz",
  "orbit", "daw", "ace", "bantam", "baen", "saga press", "pan macmillan", "penguin",
  "random house", "knopf", "picador", "bloomsbury", "head of zeus", "st. martin's",
  "st martins", "fsg", "farrar", "fourth estate", "roc", "voyager", "berkley",
  "crown", "broadway", "mariner", "subterranean", "centipede"
];

export function stripAccents(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeText(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, "-");
}

export function tokenSet(value: string): Set<string> {
  const tokens = normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
  return new Set(tokens);
}

export function containmentScore(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / Math.min(left.size, right.size);
}

export function jaccardScore(a: string, b: string): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const token of left) if (right.has(token)) common += 1;
  return common / (left.size + right.size - common);
}

export function parsePrice(value: string): number | null {
  const match = value.match(/(?:R\$|BRL)\s*([0-9][0-9.,]*)/i);
  if (!match?.[1]) return null;
  let raw = match[1].trim();
  if (raw.includes(",")) {
    raw = raw.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}\.\d{2}$/.test(raw)) {
    // 85.40 no formato americano
  } else {
    raw = raw.replace(/\./g, "");
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseUsd(value: string): number | null {
  const match = value.match(/US\$\s*([0-9][0-9.,]*)/i);
  if (!match?.[1]) return null;
  let raw = match[1].trim();
  if (raw.includes(",") && raw.includes(".")) {
    raw = raw.replace(/,/g, "");
  } else if (raw.includes(",")) {
    raw = raw.replace(",", ".");
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

const PT_WORDS = new Set([
  "imperio", "poco", "heroi", "furia", "assassino", "aprendiz",
  "rei", "navio", "arcano", "bobo", "destino", "santuario", "ventos", "cronicas",
  "espada", "feiticaria", "curva", "sonho", "silencio", "liga", "lei", "braceletes",
  "perdicao", "ascensao", "primeira", "segunda", "mole", "dura", "comum", "usado",
  "novo", "seminovo", "colecao", "trilogia", "edicao", "traducao", "nacional",
  "brasileira", "portugues", "uma", "um", "o", "os", "literatura", "cenario",
  "apocaliptico", "intergalactica", "historia", "secreta", "capa"
]);

function includesPublisher(text: string, publisher: string): boolean {
  const escaped = publisher.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text);
}

export function detectLanguage(text: string): "en" | "pt" | "unknown" {
  const normalized = normalizeText(text);
  const tokens = new Set(normalized.split(" "));
  const ptSignals = [
    "portugues", "edicao em portugues", "traducao", "traduzido", "pt br", "nacional",
    "brasileira", "livro em portugues"
  ];
  const enSignals = [
    "ingles", "edicao em ingles", "english", "importado", "importada", "livro em ingles"
  ];

  if (enSignals.some((signal) => normalized.includes(signal))) return "en";
  if (ptSignals.some((signal) => normalized.includes(signal))) return "pt";

  let ptScore = 0;
  let enScore = 0;
  for (const token of tokens) {
    if (PT_WORDS.has(token)) ptScore += 1;
  }
  if (/[áàâãéêíóôõúç]/i.test(text)) ptScore += 1;
  if (PT_PUBLISHERS.some((publisher) => includesPublisher(normalized, publisher))) ptScore += 2;
  if (EN_PUBLISHERS.some((publisher) => includesPublisher(normalized, publisher))) enScore += 2;
  if (/\b(the|and|of|with|from|book|hardcover|paperback)\b/.test(normalized)) enScore += 1;

  if (ptScore > enScore) return "pt";
  if (enScore > ptScore) return "en";
  return "unknown";
}

export function detectCondition(
  text: string | null | undefined
): "novo" | "usado" | null {
  const normalized = normalizeText(text ?? "");
  if (/\bnovo\b/.test(normalized) || /\bnew\b/.test(normalized)) return "novo";
  if (/\busado\b/.test(normalized) || /\bused\b/.test(normalized)) return "usado";
  return null;
}

export function detectFormat(text: string): "hardcover" | "paperback" | "mass_market" | "unknown" {
  const normalized = normalizeText(text);
  if (normalized.includes("mass market") || normalized.includes("edicao de bolso") || normalized.includes("bolso")) {
    return "mass_market";
  }
  if (normalized.includes("capa dura") || normalized.includes("hardcover") || normalized.includes("hardback")) {
    return "hardcover";
  }
  if (
    normalized.includes("capa mole") ||
    normalized.includes("capa comum") ||
    normalized.includes("paperback") ||
    normalized.includes("softcover") ||
    normalized.includes("brochura")
  ) {
    return "paperback";
  }
  return "unknown";
}

export function detectPublisher(text: string): string | null {
  const normalized = normalizeText(text);
  for (const publisher of EN_PUBLISHERS) {
    if (includesPublisher(normalized, publisher)) return publisher;
  }
  for (const publisher of PT_PUBLISHERS) {
    if (includesPublisher(normalized, publisher)) return publisher;
  }
  return null;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^97[89]\d{10}$/.test(isbn)) return false;
  let sum = 0;
  for (let index = 0; index < 12; index += 1) {
    const digit = Number(isbn[index]);
    sum += digit * (index % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(isbn[12]);
}

export function extractIsbn(text: string): string | null {
  const matches = text.match(/97[89](?:[\s-]?\d){10}/g);
  if (!matches) return null;
  for (const candidate of matches) {
    const isbn = candidate.replace(/\D/g, "");
    if (isValidIsbn13(isbn)) return isbn;
  }
  return null;
}

export function cleanText(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : null;
}
