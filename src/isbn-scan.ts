import "dotenv/config";
import { closeBrowser } from "./browser.js";
import { loadSettings, loadWorks } from "./config.js";
import { RadarDb } from "./db.js";
import { matchListing } from "./match.js";
import { isValidIsbn13 } from "./normalize.js";
import { AbeBooksSource } from "./sources/abebooks.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] ?? fallback;
  return fallback;
}

async function main(): Promise<void> {
  const settings = loadSettings();
  const limit = Number(argValue("--limit", "0"));
  const perIsbn = Number(argValue("--per-isbn", "3"));
  const priority = argValue("--priority", "all");
  const isbnFilter = argValue("--isbn", "").replace(/\D/g, "");

  const allWorks = loadWorks().filter(
    (work) => work.enabled && isValidIsbn13(work.isbn13)
  );
  const filtered = allWorks
    .filter((work) => priority === "all" || String(work.priority) === priority)
    .filter((work) => !isbnFilter || work.isbn13.includes(isbnFilter));
  const selected = limit > 0 ? filtered.slice(0, limit) : filtered;

  const db = new RadarDb("data/radar.db");
  const owned = new Set(db.listOwnedKeys());
  const matchable = selected.filter((work) => !owned.has(work.key));
  const source = new AbeBooksSource(settings.currency.usd_brl);

  console.log(
    `AbeBooks ISBN: ${selected.length} obras · câmbio ${settings.currency.usd_brl.toFixed(2)} · até ${perIsbn} ofertas por ISBN`
  );

  let totalListings = 0;
  let newListings = 0;
  let matches = 0;
  let errors = 0;

  for (const [index, work] of selected.entries()) {
    const label = `${String(index + 1).padStart(2)}/${selected.length}`;
    if (owned.has(work.key)) {
      console.log(`${label} ${work.title} — já na coleção`);
      continue;
    }

    const runId = db.startRun("abebooks", work.isbn13);
    let found = 0;
    let created = 0;
    let runErrors = 0;

    try {
      const listings = await source.search(work.isbn13, perIsbn);
      found = listings.length;
      totalListings += found;
      for (const listing of listings) {
        const stored = db.upsertListing(listing);
        if (stored.isNew) {
          created += 1;
          newListings += 1;
        }
        const match = matchListing(listing, matchable, settings.scan.min_score);
        if (match) {
          db.recordMatch(stored.id, match);
          matches += 1;
        }
      }
      const best = listings[0];
      console.log(
        `${label} ${work.title} — ${found} oferta${found === 1 ? "" : "s"}${
          best?.priceNote ? ` · ${best.priceNote}` : ""
        }`
      );
    } catch (error) {
      runErrors += 1;
      errors += 1;
      console.warn(
        `${label} ${work.title} — erro: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      db.finishRun(runId, found, created, runErrors);
    }

    await sleep(settings.scan.delay_ms);
  }

  await closeBrowser();
  db.close();
  console.log("");
  console.log(
    `AbeBooks: ${selected.length} ISBNs · ${totalListings} anúncios · ${newListings} novos · ${matches} matches · ${errors} erros`
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
