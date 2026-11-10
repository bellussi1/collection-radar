import { closeBrowser } from "./browser.js";
import { loadQueries, loadSettings, loadWorks } from "./config.js";
import { RadarDb } from "./db.js";
import { buildDigest, type DigestItem } from "./digest.js";
import { matchListing } from "./match.js";
import { sendDigest } from "./notify.js";
import { createSources, SourceBlockedError } from "./sources/index.js";
import type { QueryConfig, ScanStats, SourceName } from "./types.js";

export interface ScanOptions {
  source?: SourceName;
  query?: string;
  queries?: string[];
  limit?: number;
  maxQueries?: number;
  noEmail?: boolean;
  headless?: boolean;
  dbPath?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runScan(options: ScanOptions = {}): Promise<ScanStats> {
  if (options.headless) process.env.HEADLESS = "true";

  const settings = loadSettings();
  const works = loadWorks();
  const allQueries = loadQueries();
  const enabledWorks = works.filter((work) => work.enabled);

  let queries = allQueries;
  const needles = [
    ...(options.query ? [options.query.toLowerCase()] : []),
    ...(options.queries ?? []).map((value) => value.toLowerCase())
  ];
  if (needles.length > 0) {
    queries = queries.filter((query) =>
      needles.some((needle) => query.term.toLowerCase().includes(needle))
    );
  }
  if (options.maxQueries && options.maxQueries > 0) {
    queries = queries.slice(0, options.maxQueries);
  }

  const sources = createSources(settings).filter(
    (source) => !options.source || source.name === options.source
  );

  if (sources.length === 0) {
    throw new Error("Nenhuma fonte habilitada. Verifique config/settings.yaml.");
  }
  if (queries.length === 0) {
    throw new Error("Nenhuma consulta encontrada. Verifique config/queries.yaml.");
  }

  const db = new RadarDb(options.dbPath ?? "data/radar.db");
  const ownedKeys = new Set(db.listOwnedKeys());
  const matchableWorks = enabledWorks.filter((work) => !ownedKeys.has(work.key));
  const explicitFilter = Boolean(options.query || options.queries?.length || options.maxQueries);
  if (!explicitFilter && settings.scan.max_queries > 0 && queries.length > settings.scan.max_queries) {
    const totalQueries = queries.length;
    const cursor = Number(db.getKv("query_cursor") ?? 0) % totalQueries;
    const rotated = [...queries.slice(cursor), ...queries.slice(0, cursor)];
    queries = rotated.slice(0, settings.scan.max_queries);
    db.setKv("query_cursor", String((cursor + queries.length) % totalQueries));
  }

  const startedAt = new Date().toISOString();
  const sourceHealth: ScanStats["sourceHealth"] = {};
  for (const source of sources) {
    sourceHealth[source.name] = { queries: 0, listings: 0, errors: 0, blocked: false };
  }
  const stats: ScanStats = {
    startedAt,
    finishedAt: startedAt,
    queries: queries.length,
    pages: 0,
    listings: 0,
    newListings: 0,
    matches: 0,
    errors: 0,
    bySource: {},
    sourceHealth
  };

  console.log(
    `Radar: ${sources.map((source) => source.name).join(", ")} · ${queries.length} consultas · ${enabledWorks.length} obras`
  );

  try {
    for (const source of sources) {
      let sourceCount = 0;
      for (const query of queries) {
        const runId = db.startRun(source.name, query.term);
        let found = 0;
        let newListings = 0;
        let errors = 0;
        try {
          sourceHealth[source.name]!.queries += 1;
          const listings = await source.search(query.term, options.limit ?? settings.scan.limit_per_query);
          found = listings.length;
          stats.pages += 1;
          stats.listings += listings.length;
          sourceHealth[source.name]!.listings += listings.length;

          for (const listing of listings) {
            const stored = db.upsertListing(listing);
            if (stored.isNew) {
              newListings += 1;
              stats.newListings += 1;
            }
            const match = matchListing(listing, matchableWorks, settings.scan.min_score);
            if (match) {
              db.recordMatch(stored.id, match);
              stats.matches += 1;
            }
          }
          sourceCount += found;
          stats.bySource[source.name] = (stats.bySource[source.name] ?? 0) + found;
          console.log(
            `  ${source.name.padEnd(13)} ${query.term.slice(0, 42).padEnd(44)} ${found} anúncios (${newListings} novos)`
          );
        } catch (error) {
          errors += 1;
          stats.errors += 1;
          sourceHealth[source.name]!.errors += 1;
          const message = error instanceof Error ? error.message : String(error);
          if (error instanceof SourceBlockedError) {
            sourceHealth[source.name]!.blocked = true;
            console.warn(`  ${source.name.padEnd(13)} bloqueado: ${message}`);
            db.finishRun(runId, found, newListings, errors);
            // Se a fonte bloqueou, não adianta insistir nas próximas consultas desta rodada.
            break;
          }
          console.warn(`  ${source.name.padEnd(13)} erro em "${query.term}": ${message}`);
        } finally {
          db.finishRun(runId, found, newListings, errors);
        }
        await sleep(settings.scan.delay_ms);
      }
      const health = sourceHealth[source.name]!;
      console.log(`  ${source.name}: ${sourceCount} anúncios nesta rodada`);
      if (health.blocked) {
        console.warn(`  atenção: ${source.name} foi bloqueado nesta rodada`);
      } else if (health.queries >= 2 && health.listings === 0) {
        console.warn(
          `  atenção: ${source.name} retornou 0 anúncios em ${health.queries} consultas — possível bloqueio ou mudança de layout`
        );
      }
    }
  } finally {
    await closeBrowser();
  }

  stats.finishedAt = new Date().toISOString();

  const recent = db.listRecentMatches(startedAt, settings.scan.min_score);
  const workMap = new Map(works.map((work) => [work.key, work]));
  const digestItems: DigestItem[] = [];
  for (const row of recent) {
    const work = workMap.get(row.workKey);
    if (!work || !work.enabled) continue;
    if (db.isSuppressed(row.listing.id, row.workKey)) continue;
    if (db.wasAlerted(row.listing.id, row.workKey, "email")) continue;
    const total = row.listing.price === null ? null : row.listing.price + (row.listing.shipping ?? 0);
    digestItems.push({
      listing: row.listing,
      work,
      score: row.score,
      reasons: row.reasons,
      overBudget: total !== null && total > work.max_price
    });
  }

  const digest = buildDigest(digestItems, stats, settings.dashboard.url);
  const emailEnabled = settings.email.enabled && !options.noEmail;
  const result = await sendDigest({
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
    to: settings.email.to,
    enabled: emailEnabled
  });

  if (result.sent) {
    for (const item of digest.displayed) {
      const total =
        item.listing.price === null ? null : item.listing.price + (item.listing.shipping ?? 0);
      db.markAlerted(item.listing.id, item.work.key, "email", total);
    }
  }

  console.log("");
  console.log(`Novos: ${stats.newListings} · matches: ${stats.matches} · erros: ${stats.errors}`);
  console.log(`Digest: ${result.path}.html`);
  console.log(
    result.sent
      ? `E-mail enviado para ${settings.email.to}.`
      : `E-mail não enviado: ${result.reason ?? "modo dry-run"}.`
  );

  db.close();
  return stats;
}
