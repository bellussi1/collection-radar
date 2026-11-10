import "dotenv/config";
import { loadQueries, loadSettings, loadWorks } from "./config.js";
import { RadarDb } from "./db.js";
import { buildDigest, type DigestItem } from "./digest.js";
import { sendDigest } from "./notify.js";
import { dropPercent } from "./price.js";
import { runScan } from "./scan.js";
import { createSources } from "./sources/index.js";
import { closeBrowser } from "./browser.js";
import type { SourceName } from "./types.js";

interface CliOptions {
  command: string;
  source?: SourceName;
  query?: string;
  queries?: string[];
  limit?: number;
  maxQueries?: number;
  noEmail?: boolean;
  headless?: boolean;
  newOnly?: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { command: argv[0] ?? "help" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (!arg.startsWith("--")) continue;

    const equals = arg.indexOf("=");
    const flag = equals >= 0 ? arg.slice(0, equals) : arg;
    let value: string;
    if (equals >= 0) {
      value = arg.slice(equals + 1);
    } else {
      const parts: string[] = [];
      let next = index + 1;
      while (next < argv.length && !argv[next]?.startsWith("--")) {
        parts.push(argv[next] ?? "");
        next += 1;
      }
      value = parts.join(" ").trim();
      index = next - 1;
    }

    switch (flag) {
      case "--source":
        if (value) options.source = value as SourceName;
        break;
      case "--query":
        if (value) options.query = value;
        break;
      case "--queries":
        if (value) options.queries = value.split(",").map((item) => item.trim()).filter(Boolean);
        break;
      case "--limit":
        if (value) options.limit = Number(value);
        break;
      case "--max-queries":
        if (value) options.maxQueries = Number(value);
        break;
      case "--no-email":
        options.noEmail = true;
        break;
      case "--new":
        options.newOnly = true;
        break;
      case "--headless":
        options.headless = true;
        break;
      default:
        break;
    }
  }
  return options;
}

function printHelp(): void {
  console.log(`collection-radar

Uso:
  npm run scan -- [opções]
  npm run digest -- [--new] [--no-email]
  npm run watchlist
  npm run sources -- --query "robin hobb"

Opções do scan:
  --source estante|olx|mercadolivre|enjoei
  --query "termo"
  --queries "Robin Hobb,Brandon Sanderson,Steven Erikson"
  --limit 30
  --max-queries 20
  --no-email
  --headless

Variáveis de ambiente: veja .env.example (SMTP, Mercado Livre, HEADLESS).
`);
}

function printWatchlist(): void {
  const works = loadWorks();
  const queries = loadQueries();
  const settings = loadSettings();
  const byPriority = new Map<number, number>();
  for (const work of works) {
    byPriority.set(work.priority, (byPriority.get(work.priority) ?? 0) + 1);
  }
  console.log(`Obras: ${works.length} (${works.filter((work) => work.enabled).length} habilitadas)`);
  for (const [priority, count] of [...byPriority.entries()].sort(([a], [b]) => a - b)) {
    console.log(`  prioridade ${priority}: ${count}`);
  }
  console.log(`Consultas: ${queries.length}`);
  console.log(
    `Fontes: ${Object.entries(settings.sources)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(", ")}`
  );
  console.log(`E-mail: ${settings.email.enabled ? "ativado" : "desativado"} · ${settings.email.to}`);
}

async function runDigest(options: CliOptions): Promise<void> {
  const settings = loadSettings();
  const works = loadWorks();
  const db = new RadarDb("data/radar.db");
  const days = options.newOnly ? 30 : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.listRecentMatches(since, settings.scan.min_score);
  const workMap = new Map(works.map((work) => [work.key, work]));
  const items: DigestItem[] = [];
  for (const row of rows) {
    const work = workMap.get(row.workKey);
    if (!work || !work.enabled) continue;
    if (db.isSuppressed(row.listing.id, row.workKey)) continue;
    const total = row.listing.price === null ? null : row.listing.price + (row.listing.shipping ?? 0);
    const alerted = db.wasAlerted(row.listing.id, row.workKey, "email");
    const lastTotal = alerted
      ? db.getAlertTotal(row.listing.id, row.workKey, "email")
      : null;
    const priceDropPct = alerted
      ? dropPercent(lastTotal, total, settings.scan.price_drop_pct)
      : null;
    if (options.newOnly && alerted && priceDropPct === null) continue;
    items.push({
      listing: row.listing,
      work,
      score: row.score,
      reasons: row.reasons,
      overBudget: total !== null && total > work.max_price,
      priceDropPct
    });
  }

  if (options.newOnly && items.length === 0) {
    console.log("Digest diário: nada novo desde o último e-mail.");
    db.close();
    return;
  }

  const digest = buildDigest(
    items,
    {
      startedAt: since,
      finishedAt: new Date().toISOString(),
      queries: 0,
      pages: 0,
      listings: items.length,
      newListings: items.length,
      matches: items.length,
      errors: 0,
      bySource: {},
      sourceHealth: {}
    },
    settings.dashboard.url,
    options.newOnly ? "Digest diário: novos matches e quedas de preço." : undefined
  );
  const result = await sendDigest({
    subject: digest.subject,
    html: digest.html,
    text: digest.text,
    to: settings.email.to,
    enabled: settings.email.enabled && !options.noEmail
  });
  if (result.sent && options.newOnly) {
    for (const item of digest.displayed) {
      const total =
        item.listing.price === null ? null : item.listing.price + (item.listing.shipping ?? 0);
      db.markAlerted(item.listing.id, item.work.key, "email", total);
    }
  }
  console.log(`Digest: ${result.path}.html`);
  console.log(result.sent ? `E-mail enviado para ${settings.email.to}.` : `Não enviado: ${result.reason}`);
  if (options.newOnly && result.sent) {
    console.log(`${digest.displayed.length} match(es) marcados como alertados.`);
  }
  db.close();
}

async function testEmail(): Promise<void> {
  const settings = loadSettings();
  const result = await sendDigest({
    subject: "Collection Radar — teste de SMTP",
    html: "<p>Se você recebeu este e-mail, o SMTP do Collection Radar está funcionando.</p>",
    text: "Se você recebeu este e-mail, o SMTP do Collection Radar está funcionando.",
    to: settings.email.to,
    enabled: true
  });
  console.log(result.sent ? `E-mail de teste enviado para ${settings.email.to}.` : `Não enviado: ${result.reason}`);
  console.log(`Arquivo local: ${result.path}.html`);
}

async function testSources(options: CliOptions): Promise<void> {
  const settings = loadSettings();
  const sources = createSources(settings);
  const term = options.query ?? "robin hobb";
  for (const source of sources) {
    try {
      const listings = await source.search(term, options.limit ?? 5);
      console.log(`${source.name}: ${listings.length} anúncios`);
      for (const listing of listings.slice(0, 3)) {
        console.log(`  ${listing.price ?? "?"} · ${listing.title.slice(0, 80)} · ${listing.url}`);
      }
    } catch (error) {
      console.log(`${source.name}: erro — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await closeBrowser();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  switch (options.command) {
    case "scan": {
      await runScan(options);
      break;
    }
    case "digest": {
      await runDigest(options);
      break;
    }
    case "email-test": {
      await testEmail();
      break;
    }
    case "watchlist": {
      printWatchlist();
      break;
    }
    case "sources": {
      await testSources(options);
      break;
    }
    default: {
      printHelp();
      break;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
