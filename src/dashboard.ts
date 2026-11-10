import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadWorks } from "./config.js";
import { RadarDb, type DashboardMatch, type OwnedWork } from "./db.js";
import { detectFormat, normalizeText } from "./normalize.js";
import type { Work } from "./types.js";

const PORT = Number(process.env.DASHBOARD_PORT ?? 4317);
const PAGE_SIZE = 40;

const C = {
  paper: "#f4f1ea",
  surface: "#ffffff",
  ink: "#1c1b18",
  muted: "#6b665c",
  rule: "#ddd6c8",
  pine: "#1f4d3a",
  pineSoft: "#eef4ef",
  ochre: "#8a5a2b",
  ochreSoft: "#f7efe3",
  red: "#a33a32",
  redSoft: "#f8e9e7"
};

interface Filters {
  q: string;
  source: string;
  series: string;
  priority: string;
  status: string;
  over: string;
  sort: string;
  page: number;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    estante: "Estante Virtual",
    olx: "OLX",
    mercadolivre: "Mercado Livre",
    enjoei: "Enjoei"
  };
  return labels[source] ?? source;
}

function brl(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function totalOf(row: DashboardMatch): number | null {
  if (row.listing.price === null) return null;
  return row.listing.price + (row.listing.shipping ?? 0);
}

function discountOf(row: DashboardMatch, work: Work | undefined): number {
  const total = totalOf(row);
  if (total === null || !work || work.max_price <= 0) return 0;
  return Math.max(0, 1 - total / work.max_price);
}

function isOver(row: DashboardMatch, work: Work | undefined): boolean {
  const total = totalOf(row);
  return Boolean(total !== null && work && total > work.max_price);
}

function parseFilters(url: URL): Filters {
  const number = Number(url.searchParams.get("page") ?? "1");
  return {
    q: url.searchParams.get("q")?.trim() ?? "",
    source: url.searchParams.get("source") ?? "all",
    series: url.searchParams.get("series") ?? "all",
    priority: url.searchParams.get("priority") ?? "all",
    status: url.searchParams.get("status") ?? "active",
    over: url.searchParams.get("over") ?? "all",
    sort: url.searchParams.get("sort") ?? "discount",
    page: Number.isFinite(number) && number > 0 ? Math.floor(number) : 1
  };
}

function queryString(filters: Filters, overrides: Partial<Filters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.source !== "all") params.set("source", merged.source);
  if (merged.series !== "all") params.set("series", merged.series);
  if (merged.priority !== "all") params.set("priority", merged.priority);
  if (merged.status !== "active") params.set("status", merged.status);
  if (merged.over !== "all") params.set("over", merged.over);
  if (merged.sort !== "discount") params.set("sort", merged.sort);
  if (merged.page > 1) params.set("page", String(merged.page));
  return params.toString();
}

function statusOf(row: DashboardMatch, work: Work | undefined): string {
  if (row.owned) return "comprado";
  if (row.feedbackStatus === "ignored") return "ignorado";
  if (row.feedbackStatus === "wrong_edition") return "edição errada";
  if (work && !work.enabled) return "desativada";
  if (row.listing.isNew) return "novo";
  return "visto";
}

function statusClass(row: DashboardMatch, work: Work | undefined): string {
  if (row.owned) return "status-owned";
  if (row.feedbackStatus === "ignored") return "status-ignored";
  if (row.feedbackStatus === "wrong_edition") return "status-wrong";
  if (work && !work.enabled) return "status-disabled";
  if (row.listing.isNew) return "status-new";
  return "status-seen";
}

function cover(url: string | null, width: number, height: number, initial: string): string {
  return `<div class="cover-wrap" style="width:${width}px;height:${height}px">
    <span>${esc(initial)}</span>
    ${url ? `<img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />` : ""}
  </div>`;
}

function knownCover(work: Work | undefined): string {
  if (!work?.isbn13) return "";
  return `<div class="cover-wrap cover-known" style="width:56px;height:84px" title="Capa conhecida da edição">
    <span>capa</span>
    <img src="https://covers.openlibrary.org/b/isbn/${encodeURIComponent(work.isbn13)}-M.jpg" alt="Capa conhecida" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()" />
  </div>`;
}

function rowHtml(row: DashboardMatch, work: Work | undefined, filters: Filters): string {
  const title = work?.title ?? row.workKey;
  const author = work?.author ?? "";
  const series = work?.series ? `${work.series} #${work.volume}` : "";
  const priority = work?.priority ? `P${work.priority}` : "P?";
  const total = totalOf(row);
  const discount = Math.round(discountOf(row, work) * 100);
  const over = isOver(row, work);
  const status = statusOf(row, work);
  const language = row.reasons.includes("inglês") ? "inglês" : "idioma a confirmar";
  const redirect = `/?${queryString(filters)}`;
  const listingId = row.listing.id;
  const workKey = row.workKey;
  const format = work?.preferred_formats[0] ?? detectFormat(row.listing.title) ?? "unknown";
  const price = row.listing.price ?? "";

  return `
    <article class="row ${over ? "row-over" : ""}">
      <div class="covers">
        <a href="${esc(row.listing.url)}" target="_blank" rel="noreferrer">${cover(row.listing.imageUrl, 56, 84, title.slice(0, 1).toUpperCase())}</a>
        ${knownCover(work)}
      </div>
      <div class="main">
        <div class="kicker">${priority}${series ? ` · ${esc(series)}` : ""} · <span class="status ${statusClass(row, work)}">${status}</span></div>
        <h2><a href="${esc(row.listing.url)}" target="_blank" rel="noreferrer">${esc(title)}</a></h2>
        ${author ? `<div class="author">${esc(author)}</div>` : ""}
        <div class="listing">Anúncio: ${esc(row.listing.title)}</div>
        <div class="meta">
          ${esc(sourceLabel(row.listing.source))}${row.listing.location ? ` · ${esc(row.listing.location)}` : ""}${row.listing.seller ? ` · ${esc(row.listing.seller)}` : ""}
          · confiança ${Math.round(row.score * 100)}% · ${language}
        </div>
        <div class="chips">${row.reasons.split(",").map((reason) => `<span>${esc(reason.trim())}</span>`).join("")}</div>
      </div>
      <div class="price">
        <div class="total">${brl(total)}</div>
        <div class="target">${work ? `teto ${brl(work.max_price)}` : "sem teto"}</div>
        <div class="discount ${over ? "discount-over" : ""}">${over ? "acima do teto" : discount > 0 ? `${discount}% abaixo` : "no teto"}</div>
        ${row.listing.shipping && row.listing.shipping > 0 ? `<div class="shipping">inclui ${brl(row.listing.shipping)} frete</div>` : ""}
      </div>
      <div class="actions">
        <a class="button button-primary" href="${esc(row.listing.url)}" target="_blank" rel="noreferrer">Abrir</a>
        ${row.owned ? ownedForm(0, workKey, title, format, price, redirect, "remove", "Remover") : ownedForm(listingId, workKey, title, format, price, redirect, "add", "Comprei")}
        ${feedbackForm(listingId, workKey, "ignored", redirect, "Ignorar")}
        ${feedbackForm(listingId, workKey, "wrong_edition", redirect, "Edição errada")}
        ${row.feedbackStatus && !row.owned ? feedbackForm(listingId, workKey, "clear", redirect, "Reabrir") : ""}
      </div>
    </article>`;
}

function feedbackForm(
  listingId: number,
  workKey: string,
  status: string,
  redirect: string,
  label: string
): string {
  return `<form method="post" action="/feedback">
    <input type="hidden" name="listing_id" value="${listingId}" />
    <input type="hidden" name="work_key" value="${esc(workKey)}" />
    <input type="hidden" name="status" value="${status}" />
    <input type="hidden" name="redirect" value="${esc(redirect)}" />
    <button class="button" type="submit">${label}</button>
  </form>`;
}

function ownedForm(
  listingId: number,
  workKey: string,
  title: string,
  format: string,
  price: number | string,
  redirect: string,
  action: string,
  label: string
): string {
  return `<form method="post" action="/owned">
    <input type="hidden" name="action" value="${action}" />
    ${listingId > 0 ? `<input type="hidden" name="listing_id" value="${listingId}" />` : ""}
    <input type="hidden" name="work_key" value="${esc(workKey)}" />
    <input type="hidden" name="title" value="${esc(title)}" />
    <input type="hidden" name="format" value="${esc(format)}" />
    <input type="hidden" name="price" value="${esc(String(price))}" />
    <input type="hidden" name="redirect" value="${esc(redirect)}" />
    <button class="button" type="submit">${label}</button>
  </form>`;
}

function option(value: string, label: string, current: string): string {
  return `<option value="${esc(value)}"${value === current ? " selected" : ""}>${esc(label)}</option>`;
}

function pageHtml(
  rows: DashboardMatch[],
  works: Map<string, Work>,
  owned: OwnedWork[],
  filters: Filters,
  allRows: DashboardMatch[]
): string {
  const sources = [...new Set(allRows.map((row) => row.listing.source))].sort();
  const series = [...new Set(allRows.map((row) => works.get(row.workKey)?.series).filter(Boolean) as string[])].sort();
  const active = allRows.filter(
    (row) => !row.owned && !row.feedbackStatus && works.get(row.workKey)?.enabled !== false
  ).length;
  const ignored = allRows.filter((row) => row.feedbackStatus === "ignored").length;
  const bought = allRows.filter((row) => row.owned).length;
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const page = Math.min(filters.page, totalPages);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const prev = page > 1 ? `/?${queryString(filters, { page: page - 1 })}` : "";
  const next = page < totalPages ? `/?${queryString(filters, { page: page + 1 })}` : "";

  const ownedHtml = owned.length
    ? `<section class="owned">
        <h2>Coleção física</h2>
        <p class="muted">${owned.length} obra${owned.length === 1 ? "" : "s"} marcada${owned.length === 1 ? "" : "s"} como comprada${owned.length === 1 ? "" : "s"}. O radar não alerta mais essas obras.</p>
        <div class="owned-list">
          ${owned
            .map(
              (item) => `<div class="owned-item">
                <div><strong>${esc(item.title)}</strong><div class="muted">${esc(item.format ?? "formato não informado")} · ${brl(item.price)}</div></div>
                <form method="post" action="/owned">
                  <input type="hidden" name="action" value="remove" />
                  <input type="hidden" name="work_key" value="${esc(item.workKey)}" />
                  <input type="hidden" name="redirect" value="/?${esc(queryString(filters, { status: "bought" }))}" />
                  <button class="button" type="submit">Remover</button>
                </form>
              </div>`
            )
            .join("")}
        </div>
      </section>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Collection Radar</title>
  <style>
    :root {
      --paper: ${C.paper}; --surface: ${C.surface}; --ink: ${C.ink}; --muted: ${C.muted};
      --rule: ${C.rule}; --pine: ${C.pine}; --pine-soft: ${C.pineSoft}; --ochre: ${C.ochre};
      --ochre-soft: ${C.ochreSoft}; --red: ${C.red}; --red-soft: ${C.redSoft};
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--paper); color: var(--ink); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    a { color: inherit; }
    .wrap { max-width: 1280px; margin: 0 auto; padding: 28px 20px 60px; }
    .brand { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10px; letter-spacing: .2em; text-transform: uppercase; color: var(--muted); }
    h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 36px; line-height: 1.05; margin: 8px 0 8px; }
    .lede { color: var(--muted); font-size: 13px; line-height: 1.6; margin: 0 0 18px; max-width: 720px; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 18px 0 24px; }
    .stat { background: var(--surface); border: 1px solid var(--rule); padding: 12px 14px; }
    .stat strong { display: block; font-family: Georgia, serif; font-size: 24px; font-weight: 400; }
    .stat span { font-family: ui-monospace, monospace; font-size: 10px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
    .filters { display: grid; grid-template-columns: 1.4fr repeat(6, minmax(110px, 1fr)) auto; gap: 8px; align-items: end; background: var(--surface); border: 1px solid var(--rule); padding: 14px; margin-bottom: 18px; }
    .field label { display: block; font-family: ui-monospace, monospace; font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); margin-bottom: 4px; }
    .field input, .field select { width: 100%; border: 1px solid var(--rule); background: #fff; padding: 8px 9px; font: inherit; font-size: 13px; color: var(--ink); }
    .field input:focus, .field select:focus { outline: 2px solid var(--pine); outline-offset: 1px; }
    .button { border: 1px solid var(--rule); background: #fff; color: var(--ink); padding: 6px 9px; font: inherit; font-size: 11px; cursor: pointer; text-decoration: none; display: inline-block; }
    .button:hover { border-color: var(--ink); }
    .button-primary { background: var(--ink); color: #fff; border-color: var(--ink); }
    .button-primary:hover { background: #000; }
    .results-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin: 8px 0 4px; }
    .results-head h2 { font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin: 0; }
    .results-head span { font-size: 12px; color: var(--muted); }
    .row { display: grid; grid-template-columns: 124px minmax(0, 1fr) 150px 120px; gap: 16px; padding: 16px 0; border-top: 1px solid var(--rule); }
    .row-over { background: linear-gradient(90deg, transparent, var(--ochre-soft)); }
    .covers { display: flex; gap: 6px; align-items: flex-start; }
    .cover-wrap { position: relative; overflow: hidden; border: 1px solid var(--rule); background: #e9e3d6; flex: 0 0 auto; }
    .cover-wrap span { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: Georgia, serif; font-size: 18px; color: var(--muted); }
    .cover-wrap img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .cover-known { border-color: var(--pine); }
    .kicker { font-family: ui-monospace, monospace; font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); margin-bottom: 4px; }
    .status { display: inline-block; padding: 1px 5px; border-radius: 2px; font-size: 9px; letter-spacing: .04em; }
    .status-new { background: var(--pine-soft); color: var(--pine); }
    .status-seen { background: #f0ece2; color: var(--muted); }
    .status-ignored { background: #f0ece2; color: var(--muted); text-decoration: line-through; }
    .status-wrong { background: var(--red-soft); color: var(--red); }
    .status-owned { background: var(--pine); color: #fff; }
    .status-disabled { background: #f0ece2; color: var(--muted); }
    .row h2 { font-size: 17px; line-height: 1.3; margin: 0 0 3px; font-weight: 600; }
    .row h2 a { text-decoration: none; }
    .row h2 a:hover { text-decoration: underline; }
    .author { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .listing { font-size: 11px; color: var(--muted); line-height: 1.45; margin-bottom: 4px; }
    .meta { font-size: 11px; color: var(--muted); line-height: 1.45; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .chips span { background: #f0ece2; color: var(--muted); font-size: 9px; padding: 2px 5px; border-radius: 2px; }
    .price { text-align: right; }
    .total { font-family: Georgia, serif; font-size: 20px; }
    .target { font-size: 10px; color: var(--muted); margin-top: 2px; }
    .discount { font-size: 11px; color: var(--pine); margin-top: 3px; }
    .discount-over { color: var(--ochre); }
    .shipping { font-size: 10px; color: var(--muted); margin-top: 2px; }
    .actions { display: flex; flex-direction: column; gap: 4px; align-items: stretch; }
    .actions form { margin: 0; }
    .actions .button { width: 100%; text-align: center; }
    .pagination { display: flex; justify-content: space-between; align-items: center; margin: 22px 0; font-size: 12px; color: var(--muted); }
    .pagination a { color: var(--ink); }
    .owned { margin-top: 36px; border-top: 2px solid var(--ink); padding-top: 14px; }
    .owned h2 { font-family: Georgia, serif; font-size: 22px; font-weight: 400; margin: 0 0 4px; }
    .muted { color: var(--muted); font-size: 12px; line-height: 1.5; }
    .owned-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
    .owned-item { background: var(--surface); border: 1px solid var(--rule); padding: 10px 12px; display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    .owned-item strong { font-size: 13px; }
    footer { margin-top: 40px; border-top: 1px solid var(--rule); padding-top: 12px; font-size: 10px; color: var(--muted); font-family: ui-monospace, monospace; }
    @media (max-width: 980px) {
      .filters { grid-template-columns: 1fr 1fr; }
      .row { grid-template-columns: 90px minmax(0, 1fr); }
      .price { grid-column: 2; text-align: left; }
      .actions { grid-column: 2; flex-direction: row; flex-wrap: wrap; }
      .actions .button { width: auto; }
      .stats { grid-template-columns: 1fr 1fr; }
      .owned-list { grid-template-columns: 1fr; }
    }
    @media (max-width: 560px) {
      .filters { grid-template-columns: 1fr; }
      .row { grid-template-columns: 70px minmax(0, 1fr); gap: 10px; }
      h1 { font-size: 30px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="brand">Collection Radar</div>
    <h1>Acervo de achados</h1>
    <p class="lede">Todos os matches do banco local, com filtros, capa do anúncio ao lado da capa conhecida e ações de coleção. O e-mail mostra só os 20 melhores; aqui está o resto.</p>
    <div class="stats">
      <div class="stat"><strong>${allRows.length}</strong><span>matches no banco</span></div>
      <div class="stat"><strong>${active}</strong><span>ativos</span></div>
      <div class="stat"><strong>${ignored}</strong><span>ignorados</span></div>
      <div class="stat"><strong>${bought}</strong><span>comprados</span></div>
    </div>

    <form class="filters" method="get" action="/">
      <div class="field"><label for="q">Busca</label><input id="q" name="q" value="${esc(filters.q)}" placeholder="título, autor, série, vendedor" /></div>
      <div class="field"><label for="source">Fonte</label><select id="source" name="source">${option("all", "Todas", filters.source)}${sources.map((source) => option(source, sourceLabel(source), filters.source)).join("")}</select></div>
      <div class="field"><label for="series">Série</label><select id="series" name="series">${option("all", "Todas", filters.series)}${series.map((item) => option(item, item, filters.series)).join("")}</select></div>
      <div class="field"><label for="priority">Prioridade</label><select id="priority" name="priority">${option("all", "Todas", filters.priority)}${option("1", "P1", filters.priority)}${option("2", "P2", filters.priority)}${option("3", "P3", filters.priority)}</select></div>
      <div class="field"><label for="status">Status</label><select id="status" name="status">${option("active", "Ativos", filters.status)}${option("ignored", "Ignorados", filters.status)}${option("wrong_edition", "Edição errada", filters.status)}${option("bought", "Comprados", filters.status)}${option("all", "Todos", filters.status)}</select></div>
      <div class="field"><label for="over">Teto</label><select id="over" name="over">${option("all", "Todos", filters.over)}${option("under", "Dentro do teto", filters.over)}${option("over", "Acima do teto", filters.over)}</select></div>
      <div class="field"><label for="sort">Ordem</label><select id="sort" name="sort">${option("discount", "Desconto", filters.sort)}${option("price", "Preço", filters.sort)}${option("date", "Data", filters.sort)}${option("confidence", "Confiança", filters.sort)}</select></div>
      <button class="button button-primary" type="submit">Filtrar</button>
    </form>

    <div class="results-head">
      <h2>Resultados</h2>
      <span>${rows.length} match${rows.length === 1 ? "" : "es"} · página ${page} de ${totalPages}</span>
    </div>
    ${pageRows.length === 0 ? `<p class="muted">Nenhum match com esses filtros.</p>` : pageRows.map((row) => rowHtml(row, works.get(row.workKey), filters)).join("")}
    <nav class="pagination">
      <div>${prev ? `<a href="${prev}">← anterior</a>` : ""}</div>
      <div>${next ? `<a href="${next}">próxima →</a>` : ""}</div>
    </nav>
    ${ownedHtml}
    <footer>127.0.0.1:${PORT} · dados em data/radar.db · Ctrl+C para parar o servidor</footer>
  </div>
</body>
</html>`;
}

function filterRows(
  rows: DashboardMatch[],
  works: Map<string, Work>,
  filters: Filters
): DashboardMatch[] {
  const needle = normalizeText(filters.q);
  const filtered = rows.filter((row) => {
    const work = works.get(row.workKey);
    if (filters.source !== "all" && row.listing.source !== filters.source) return false;
    if (filters.series !== "all" && work?.series !== filters.series) return false;
    if (filters.priority !== "all" && String(work?.priority ?? "") !== filters.priority) return false;
    if (
      filters.status === "active" &&
      (row.owned || row.feedbackStatus || (work !== undefined && !work.enabled))
    ) {
      return false;
    }
    if (filters.status === "bought" && !row.owned) return false;
    if (
      filters.status !== "active" &&
      filters.status !== "bought" &&
      filters.status !== "all" &&
      row.feedbackStatus !== filters.status
    ) {
      return false;
    }
    const over = isOver(row, work);
    if (filters.over === "over" && !over) return false;
    if (filters.over === "under" && over) return false;
    if (needle) {
      const haystack = normalizeText(
        [
          work?.title,
          work?.author,
          work?.series,
          row.listing.title,
          row.listing.seller,
          row.listing.location
        ]
          .filter(Boolean)
          .join(" ")
      );
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    const workA = works.get(a.workKey);
    const workB = works.get(b.workKey);
    if (filters.sort === "price") {
      return (totalOf(a) ?? Infinity) - (totalOf(b) ?? Infinity);
    }
    if (filters.sort === "date") {
      return b.listing.firstSeen.localeCompare(a.listing.firstSeen);
    }
    if (filters.sort === "confidence") {
      return b.score - a.score;
    }
    const overA = isOver(a, workA) ? 1 : 0;
    const overB = isOver(b, workB) ? 1 : 0;
    if (overA !== overB) return overA - overB;
    return discountOf(b, workB) - discountOf(a, workA) || b.score - a.score;
  });

  return filtered;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("corpo grande demais"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function redirect(res: ServerResponse, location: string): void {
  const safe = location.startsWith("/") ? location : "/";
  res.writeHead(303, { Location: safe });
  res.end();
}

function main(): void {
  const db = new RadarDb("data/radar.db");

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);

      if (req.method === "GET" && url.pathname === "/") {
        const works = new Map(loadWorks().map((work) => [work.key, work]));
        const allRows = db.listDashboardMatches(5000);
        const filters = parseFilters(url);
        const rows = filterRows(allRows, works, filters);
        const owned = db.listOwned();
        const html = pageHtml(rows, works, owned, filters, allRows);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }

      if (req.method === "POST" && url.pathname === "/feedback") {
        const form = new URLSearchParams(await readBody(req));
        const listingId = Number(form.get("listing_id") ?? "0");
        const workKey = form.get("work_key") ?? "";
        const status = form.get("status") ?? "";
        if (listingId > 0 && workKey) {
          if (status === "clear") db.clearFeedback(listingId, workKey);
          else if (status === "ignored" || status === "wrong_edition") {
            db.setFeedback(listingId, workKey, status);
          }
        }
        redirect(res, form.get("redirect") ?? "/");
        return;
      }

      if (req.method === "POST" && url.pathname === "/owned") {
        const form = new URLSearchParams(await readBody(req));
        const action = form.get("action") ?? "";
        const workKey = form.get("work_key") ?? "";
        if (workKey) {
          if (action === "remove") {
            db.removeOwned(workKey);
          } else {
            const price = Number(form.get("price") ?? "");
            db.addOwned(
              workKey,
              form.get("title") ?? workKey,
              form.get("format") ?? null,
              Number.isFinite(price) && price > 0 ? price : null
            );
            const listingId = Number(form.get("listing_id") ?? "0");
            if (listingId > 0) db.setFeedback(listingId, workKey, "bought");
          }
        }
        redirect(res, form.get("redirect") ?? "/");
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
    } catch (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`erro: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Collection Radar dashboard: http://127.0.0.1:${PORT}`);
  });
}

main();
