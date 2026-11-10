import type { ScanStats, StoredListing, Work } from "./types.js";

export interface DigestItem {
  listing: StoredListing;
  work: Work;
  score: number;
  reasons: string;
  overBudget: boolean;
  priceDropPct?: number | null;
}

const COLORS = {
  paper: "#f4f1ea",
  surface: "#ffffff",
  ink: "#1c1b18",
  muted: "#6b665c",
  rule: "#ddd6c8",
  pine: "#1f4d3a",
  pineSoft: "#eef4ef",
  ochre: "#8a5a2b",
  ochreSoft: "#f7efe3"
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function brl(value: number | null): string {
  if (value === null) return "preço não informado";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    estante: "Estante Virtual",
    olx: "OLX",
    mercadolivre: "Mercado Livre",
    enjoei: "Enjoei",
    abebooks: "AbeBooks",
    shopee: "Shopee",
    sebos: "Sebos independentes"
  };
  return labels[source] ?? source;
}

function confidence(score: number, hasEnglishSignal: boolean): string {
  if (score >= 0.9 && hasEnglishSignal) return "edição confirmada";
  if (score >= 0.78) return "provável";
  return "possível";
}

function totalOf(item: DigestItem): number | null {
  if (item.listing.price === null) return null;
  return item.listing.price + (item.listing.shipping ?? 0);
}

function discountOf(item: DigestItem): number {
  const total = totalOf(item);
  if (total === null || item.work.max_price <= 0) return 0;
  return Math.max(0, 1 - total / item.work.max_price);
}

function priceLine(item: DigestItem): string {
  const total = totalOf(item);
  const drop = item.priceDropPct ? ` · caiu ${item.priceDropPct}% desde o último alerta` : "";
  if (total === null) return `preço não informado${drop}`;
  const shipping =
    item.listing.shipping && item.listing.shipping > 0
      ? ` + ${brl(item.listing.shipping)} frete`
      : "";
  const target = item.work.max_price;
  if (item.overBudget) {
    return `${brl(item.listing.price)}${shipping} · acima do teto de ${brl(target)}${drop}`;
  }
  const pct = Math.round(discountOf(item) * 100);
  return pct > 0
    ? `${brl(item.listing.price)}${shipping} · ${pct}% abaixo do teto de ${brl(target)}${drop}`
    : `${brl(item.listing.price)}${shipping} · teto ${brl(target)}${drop}`;
}

function cover(item: DigestItem, width: number, height: number): string {
  const url = item.listing.imageUrl;
  if (url) {
    return `<img src="${escapeHtml(url)}" width="${width}" height="${height}" alt="" style="display:block;width:${width}px;height:${height}px;object-fit:cover;border-radius:2px;background:${COLORS.rule}" />`;
  }
  const initial = escapeHtml(item.work.title.trim().slice(0, 1).toUpperCase() || "?");
  return `<div style="width:${width}px;height:${height}px;background:${COLORS.rule};border-radius:2px;text-align:center;line-height:${height}px;font-family:Georgia,'Times New Roman',serif;font-size:${Math.round(width / 2)}px;color:${COLORS.muted}">${initial}</div>`;
}

function chips(item: DigestItem): string {
  return item.reasons
    .split(",")
    .map((reason) => reason.trim())
    .filter(Boolean)
    .slice(0, 4)
    .map(
      (reason) =>
        `<span style="display:inline-block;background:#f0ece2;border-radius:3px;padding:2px 6px;margin:2px 4px 2px 0;font-size:10px;letter-spacing:.02em;color:${COLORS.muted}">${escapeHtml(reason)}</span>`
    )
    .join("");
}

function metaLine(item: DigestItem): string {
  const parts = [sourceLabel(item.listing.source)];
  if (item.listing.location) parts.push(item.listing.location);
  if (item.listing.priceNote) parts.push(item.listing.priceNote);
  parts.push(
    `confiança ${Math.round(item.score * 100)}% (${confidence(item.score, item.reasons.includes("inglês"))})`
  );
  if (!item.reasons.includes("inglês")) parts.push("idioma a confirmar");
  return parts.map(escapeHtml).join(" · ");
}

function workLine(item: DigestItem): string {
  const base = item.work.author;
  if (!item.work.series) return base;
  return `${base} · ${item.work.series} #${item.work.volume}`;
}

function listingLine(item: DigestItem): string {
  return `Anúncio: ${item.listing.title}`;
}

function sortItems(items: DigestItem[]): DigestItem[] {
  return [...items].sort((a, b) => {
    if (a.overBudget !== b.overBudget) return a.overBudget ? 1 : -1;
    const discount = discountOf(b) - discountOf(a);
    if (discount !== 0) return discount;
    if (b.score !== a.score) return b.score - a.score;
    return (totalOf(a) ?? Infinity) - (totalOf(b) ?? Infinity);
  });
}

function topPicks(items: DigestItem[]): DigestItem[] {
  return sortItems(items)
    .filter(
      (item) =>
        !item.overBudget &&
        item.listing.price !== null &&
        item.score >= 0.85 &&
        item.reasons.includes("inglês")
    )
    .slice(0, 3);
}

function healthLine(stats: ScanStats): string {
  return Object.entries(stats.sourceHealth ?? {})
    .map(([source, health]) => {
      const label = sourceLabel(source);
      if (health.blocked) return `${label}: bloqueado`;
      if (health.queries >= 2 && health.listings === 0) {
        return `${label}: 0 anúncios em ${health.queries} consultas (atenção)`;
      }
      return `${label}: ${health.listings} anúncios`;
    })
    .join(" · ");
}

function groupTitle(priority: number): string {
  const titles: Record<number, string> = {
    1: "Prioridade 1 — coleção principal",
    2: "Prioridade 2 — quero ler",
    3: "Prioridade 3 — radar geral"
  };
  return titles[priority] ?? `Prioridade ${priority}`;
}

export function buildDigest(
  items: DigestItem[],
  stats: ScanStats,
  dashboardUrl = "http://127.0.0.1:4317",
  note?: string
): { html: string; text: string; subject: string; displayed: DigestItem[] } {
  const date = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const sorted = sortItems(items);
  const MAX_EMAIL_ITEMS = 20;
  const displayed = sorted.slice(0, MAX_EMAIL_ITEMS);
  const hidden = Math.max(0, sorted.length - displayed.length);
  const picks = topPicks(displayed);
  const pickIds = new Set(picks.map((item) => `${item.listing.id}:${item.work.key}`));

  const groups = new Map<number, DigestItem[]>();
  for (const item of displayed) {
    if (pickIds.has(`${item.listing.id}:${item.work.key}`)) continue;
    const list = groups.get(item.work.priority) ?? [];
    list.push(item);
    groups.set(item.work.priority, list);
  }

  const subjectPick = picks[0];
  const subject = subjectPick
    ? `Radar — ${items.length} achado${items.length === 1 ? "" : "s"} — ${subjectPick.work.title.slice(0, 42)} ${brl(totalOf(subjectPick))}`
    : `Radar — ${items.length} achado${items.length === 1 ? "" : "s"}`;

  const topCards = picks
    .map(
      (item) => `
        <tr>
          <td width="88" valign="top" style="padding:14px 0 0">
            <a href="${escapeHtml(item.listing.url)}" style="text-decoration:none">${cover(item, 72, 108)}</a>
          </td>
          <td valign="top" style="padding:14px 0 0 14px">
            <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:${COLORS.pine};margin-bottom:4px">Achado em destaque</div>
            <div style="font-size:17px;line-height:1.3;margin-bottom:3px">
              <a href="${escapeHtml(item.listing.url)}" style="color:${COLORS.ink};text-decoration:none;font-weight:600">${escapeHtml(item.work.title)}</a>
            </div>
            <div style="font-size:12px;color:${COLORS.muted};line-height:1.5;margin-bottom:3px">${escapeHtml(workLine(item))}</div>
            <div style="font-size:11px;color:${COLORS.muted};line-height:1.5;margin-bottom:6px">${escapeHtml(listingLine(item))}</div>
            <div style="font-size:14px;color:${COLORS.ink};font-weight:600;margin-bottom:4px">${escapeHtml(priceLine(item))}</div>
            <div style="font-size:11px;color:${COLORS.muted};line-height:1.5">${metaLine(item)}</div>
            <div style="margin-top:6px">${chips(item)}</div>
          </td>
        </tr>`
    )
    .join("");

  const groupHtml = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([priority, group]) => {
      const rows = group
        .map(
          (item) => `
            <tr>
              <td width="56" valign="top" style="padding:14px 0 14px;border-top:1px solid ${COLORS.rule}">
                <a href="${escapeHtml(item.listing.url)}" style="text-decoration:none">${cover(item, 44, 66)}</a>
              </td>
              <td valign="top" style="padding:14px 0 14px 12px;border-top:1px solid ${COLORS.rule}">
                <div style="font-size:14px;line-height:1.35;margin-bottom:3px">
                  <a href="${escapeHtml(item.listing.url)}" style="color:${COLORS.ink};text-decoration:none;font-weight:600">${escapeHtml(item.work.title)}</a>
                </div>
                <div style="font-size:11px;color:${COLORS.muted};line-height:1.5;margin-bottom:2px">${escapeHtml(workLine(item))}</div>
                <div style="font-size:11px;color:${COLORS.muted};line-height:1.5;margin-bottom:4px">${escapeHtml(listingLine(item))}</div>
                <div style="font-size:13px;color:${COLORS.ink};font-weight:600;margin-bottom:3px">
                  ${escapeHtml(priceLine(item))}
                  ${
                    item.overBudget
                      ? `<span style="display:inline-block;margin-left:6px;background:${COLORS.ochreSoft};color:${COLORS.ochre};border-radius:3px;padding:1px 6px;font-size:10px;font-weight:500">acima do teto</span>`
                      : ""
                  }
                </div>
                <div style="font-size:11px;color:${COLORS.muted};line-height:1.5">${metaLine(item)}</div>
                <div style="margin-top:5px">${chips(item)}</div>
              </td>
            </tr>`
        )
        .join("");
      return `
        <h2 style="font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:${COLORS.muted};margin:30px 0 0;border-top:2px solid ${COLORS.ink};padding-top:10px">${groupTitle(priority)}</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
    })
    .join("");

  const health = healthLine(stats);
  const healthHtml = health
    ? `<p style="font-size:11px;color:${COLORS.muted};line-height:1.6;margin:10px 0 0">${escapeHtml(health)}</p>`
    : "";

  const empty = `
    <p style="font-size:14px;color:${COLORS.muted};line-height:1.7;margin:20px 0 0">
      Nenhum anúncio novo passou do corte de confiança nesta varredura. O radar continua rodando.
    </p>`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${COLORS.paper}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.paper}">
    <tr><td align="center" style="padding:28px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${COLORS.surface};border:1px solid ${COLORS.rule}">
        <tr><td style="padding:28px 28px 10px">
          <div style="font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${COLORS.muted}">Collection Radar</div>
          <h1 style="font-family:Georgia,'Times New Roman',serif;font-size:30px;line-height:1.1;color:${COLORS.ink};margin:8px 0 6px;font-weight:400">Achados de ${date}</h1>
          <p style="font-size:13px;color:${COLORS.muted};line-height:1.6;margin:0">
            ${items.length} anúncio${items.length === 1 ? "" : "s"} novo${items.length === 1 ? "" : "s"} com match.
            ${displayed.length} melhores no e-mail${hidden > 0 ? ` · +${hidden} no banco` : ""}.
            ${
              note ??
              (stats.queries > 0
                ? `${stats.queries} consultas · ${stats.pages} páginas · ${stats.errors} erro${stats.errors === 1 ? "" : "s"}.`
                : "Reenvio manual do banco local.")
            }
          </p>
          ${healthHtml}
          <p style="font-size:12px;line-height:1.6;margin:10px 0 0">
            <a href="${escapeHtml(dashboardUrl)}" style="color:${COLORS.pine};text-decoration:underline">Abrir o dashboard</a>
            <span style="color:${COLORS.muted}">· todos os matches, filtros e botões de ignorar/comprei. Rode <span style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace">npm run dashboard</span>.</span>
          </p>
        </td></tr>
        ${
          picks.length > 0
            ? `<tr><td style="padding:0 28px 8px">
                <h2 style="font-family:ui-monospace,SFMono-Regular,Consolas,'Liberation Mono',monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:${COLORS.pine};margin:18px 0 0;border-top:2px solid ${COLORS.pine};padding-top:10px">Melhores oportunidades</h2>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${topCards}</table>
              </td></tr>`
            : ""
        }
        <tr><td style="padding:0 28px 28px">
          ${items.length === 0 ? empty : groupHtml}
          ${
            hidden > 0
              ? `<p style="font-size:12px;color:${COLORS.muted};line-height:1.6;margin:20px 0 0">Mais ${hidden} achado${hidden === 1 ? "" : "s"} ficou${hidden === 1 ? "" : "aram"} no banco (<span style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace">data/radar.db</span>). O e-mail mostra os 20 melhores.</p>`
              : ""
          }
          <p style="font-size:11px;color:${COLORS.muted};line-height:1.6;margin:30px 0 0;border-top:1px solid ${COLORS.rule};padding-top:14px">
            Confirme edição, idioma, formato e estado antes de comprar. O radar não compra nada sozinho.
            Para ajustar tetos e obras, edite <span style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace">config/watchlist.yaml</span> e <span style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace">config/keepa-wishlist.yaml</span>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    `COLLECTION RADAR — ${date}`,
    `${items.length} anúncio(s) novo(s) com match. ${displayed.length} melhores no e-mail${hidden > 0 ? `; +${hidden} no banco` : ""}.`,
    stats.queries > 0
      ? `${stats.queries} consultas · ${stats.pages} páginas · ${stats.errors} erro(s).`
      : (note ?? "Reenvio manual do banco local."),
    `Dashboard: ${dashboardUrl}`,
    ...(health ? [health] : []),
    ""
  ];

  if (picks.length > 0) {
    textLines.push("MELHORES OPORTUNIDADES");
    for (const item of picks) {
      textLines.push(
        `- ${item.work.title} — ${brl(totalOf(item))} (${priceLine(item)})`,
        `  ${workLine(item)}`,
        `  ${listingLine(item)}`,
        `  ${metaLine(item)}`,
        `  ${item.listing.url}`,
        ""
      );
    }
  }

  for (const [priority, group] of [...groups.entries()].sort(([a], [b]) => a - b)) {
    textLines.push(groupTitle(priority).toUpperCase());
    for (const item of group) {
      textLines.push(
        `- ${item.work.title}`,
        `  ${workLine(item)}`,
        `  ${listingLine(item)}`,
        `  ${priceLine(item)}`,
        `  ${metaLine(item)}`,
        `  ${item.listing.url}`,
        ""
      );
    }
  }

  textLines.push("Confirme edição e estado antes de comprar.");

  return { html, text: textLines.join("\n"), subject, displayed };
}
