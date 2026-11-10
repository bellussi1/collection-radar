import "dotenv/config";
import sharp from "sharp";
import { createWorker } from "tesseract.js";
import { loadWorks } from "./config.js";
import { fetchImage } from "./coverhash.js";
import { RadarDb } from "./db.js";
import { scoreOcrText } from "./ocr-score.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] ?? fallback;
  return fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const limit = Number(argValue("--limit", "50"));
  const maxScore = Number(argValue("--max-score", "0.8"));
  const lang = argValue("--lang", "eng+por");
  const allMatches = hasFlag("--all");
  const force = hasFlag("--force");

  const works = new Map(loadWorks().map((work) => [work.key, work]));
  const db = new RadarDb("data/radar.db");
  const candidates = db
    .listDashboardMatches(10_000)
    .filter((row) => {
      const work = works.get(row.workKey);
      if (!work || !row.listing.imageUrl) return false;
      if (!work.enabled) return false;
      if (row.owned || row.feedbackStatus) return false;
      if (!force && db.getOcrCheck(row.listing.id, row.workKey)) return false;
      if (
        !allMatches &&
        row.score > maxScore &&
        (row.coverDistance === null || row.coverDistance <= 12)
      ) {
        return false;
      }
      return true;
    })
    .slice(0, limit);

  console.log(
    `OCR: ${candidates.length} imagens · idioma ${lang}${allMatches ? " · todos os matches" : ""}`
  );

  const worker = await createWorker(lang, 1, {
    cachePath: "data/tesseract",
    logger: () => undefined
  });

  let confirmed = 0;
  let weak = 0;
  let empty = 0;
  let errors = 0;

  try {
    for (const [index, row] of candidates.entries()) {
      const work = works.get(row.workKey);
      if (!work || !row.listing.imageUrl) continue;
      const label = `${String(index + 1).padStart(3)}/${candidates.length}`;

      try {
        let text: string;
        let confidence: number | null;
        const cached = db.getImageOcr(row.listing.imageUrl);
        if (cached) {
          text = cached.text;
          confidence = cached.confidence;
        } else {
          const buffer = await fetchImage(row.listing.imageUrl, row.listing.url);
          if (!buffer) {
            errors += 1;
            console.log(`${label} ${work.title} — imagem indisponível`);
            continue;
          }
          const processed = await sharp(buffer, { failOn: "none" })
            .rotate()
            .grayscale()
            .normalize()
            .resize({ width: 1200, withoutEnlargement: true })
            .sharpen()
            .png()
            .toBuffer();
          const result = await worker.recognize(processed);
          text = result.data.text.trim();
          confidence = result.data.confidence ?? null;
          db.saveImageOcr(row.listing.imageUrl, text, confidence);
        }

        const scored = scoreOcrText(text, work);
        db.saveOcrCheck(row.listing.id, row.workKey, text, scored.score, confidence);
        const clean = text.replace(/\s+/g, " ").trim();
        const titlePct = Math.round(scored.titleScore * 100);
        const confPct = confidence === null ? "?" : Math.round(confidence);
        console.log(
          `${label} ${work.title} — OCR ${confPct}% · título ${titlePct}% · ${clean.slice(0, 90) || "(sem texto)"}`
        );
        if (scored.titleScore >= 0.7) confirmed += 1;
        else if (clean.length >= 5) weak += 1;
        else empty += 1;
      } catch (error) {
        errors += 1;
        console.warn(
          `${label} ${work.title} — erro: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      await sleep(150);
    }
  } finally {
    await worker.terminate();
    db.close();
  }

  console.log("");
  console.log(
    `OCR: ${candidates.length} imagens · ${confirmed} título confirmado · ${weak} fraco · ${empty} sem texto · ${errors} erros`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
