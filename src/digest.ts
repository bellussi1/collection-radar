import type { ScanStats, StoredListing, Work } from "./types.js";

export interface DigestItem {
  listing: StoredListing;
  work: Work;
  score: number;
  reasons: string;
  overBudget: boolean;
}

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
    enjoei: "Enjoei"
  };
  return labels[source] ?? source;
}

function confidence(score: number, hasEnglishSignal: boolean): string {
  if (score >= 0.9 && hasEnglishSignal) return "edição confirmada";
  if (score >= 0.78) return "provável";
  return "possível";
}

export function buildDigest(
  items: DigestItem[],
  stats: ScanStats
): { html: string; text: string; subject: string } {
  const date = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const subject = `Radar de coleção — ${date} — ${items.length} achado${items.length === 1 ? "" : "s"}`;

  const sorted = [...items].sort((a, b) => {
    if (a.work.priority !== b.work.priority) return a.work.priority - b.work.priority;
    if (b.score !== a.score) return b.score - a.score;
    return (a.listing.price ?? Infinity) - (b.listing.price ?? Infinity);
  });

  const groups = new Map<number, DigestItem[]>();
  for (const item of sorted) {
    const list = groups.get(item.work.priority) ?? [];
    list.push(item);
    groups.set(item.work.priority, list);
  }

  const groupTitles: Record<number, string> = {
    1: "Prioridade 1 — coleção principal",
    2: "Prioridade 2 — quero ler",
    3: "Prioridade 3 — radar geral"
  };

  const rowsHtml = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([priority, group]) => {
      const cards = group
        .map((item) => {
          const shipping =
            item.listing.shipping && item.listing.shipping > 0
              ? ` + ${brl(item.listing.shipping)} frete`
              : "";
          const reasons = item.reasons
            .split(",")
            .map((reason) => reason.trim())
            .filter(Boolean)
            .map((reason) => `<span style="display:inline-block;background:#f1f3f5;border-radius:4px;padding:2px 6px;margin:2px 4px 2px 0;font-size:11px;color:#495057">${escapeHtml(reason)}</span>`)
            .join("");
          return `
            <tr>
              <td style="padding:14px 0;border-bottom:1px solid #e9ecef;vertical-align:top">
                <div style="font-size:15px;line-height:1.35;margin-bottom:4px">
                  <a href="${escapeHtml(item.listing.url)}" style="color:#1c4f8a;text-decoration:none;font-weight:600">${escapeHtml(item.listing.title)}</a>
                </div>
                <div style="font-size:12px;color:#495057;margin-bottom:6px">
                  ${escapeHtml(item.work.title)} · ${escapeHtml(item.work.author)}${item.work.series ? ` · ${escapeHtml(item.work.series)} #${item.work.volume}` : ""}
                </div>
                <div style="font-size:14px;color:#111;font-weight:600;margin-bottom:4px">
                  ${brl(item.listing.price)}${shipping}
                  ${
                    item.overBudget
                      ? `<span style="display:inline-block;margin-left:6px;background:#fff5f5;color:#c92a2a;border:1px solid #ffc9c9;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:500">acima do teto (${brl(item.work.max_price)})</span>`
                      : ""
                  }
                </div>
                <div style="font-size:12px;color:#6c757d;margin-bottom:6px">
                  ${escapeHtml(sourceLabel(item.listing.source))}
                  ${item.listing.location ? ` · ${escapeHtml(item.listing.location)}` : ""}
                  ${item.listing.seller ? ` · ${escapeHtml(item.listing.seller)}` : ""}
                  · confiança ${Math.round(item.score * 100)}% (${confidence(item.score, item.reasons.includes("inglês"))})${item.reasons.includes("inglês") ? "" : " · idioma a confirmar"}
                </div>
                <div>${reasons}</div>
              </td>
            </tr>`;
        })
        .join("");
      return `
        <h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#6c757d;margin:28px 0 4px">${groupTitles[priority] ?? `Prioridade ${priority}`}</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>`;
    })
    .join("");

  const empty = `
    <p style="font-size:14px;color:#495057;line-height:1.6">
      Nenhum anúncio novo passou do corte de confiança nesta varredura. O radar continua rodando.
    </p>`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8f9fa">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f9fa">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #dee2e6;border-radius:8px">
        <tr><td style="padding:24px 24px 8px">
          <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#868e96;margin-bottom:6px">Collection Radar</div>
          <h1 style="font-size:22px;line-height:1.25;margin:0 0 8px;color:#111">Achados de ${date}</h1>
          <p style="font-size:13px;color:#495057;line-height:1.6;margin:0">
            ${items.length} anúncio${items.length === 1 ? "" : "s"} novo${items.length === 1 ? "" : "s"} com match.
            ${stats.queries} consultas · ${stats.pages} páginas · ${stats.errors} erro${stats.errors === 1 ? "" : "s"}.
          </p>
        </td></tr>
        <tr><td style="padding:0 24px 24px">
          ${items.length === 0 ? empty : rowsHtml}
          <p style="font-size:11px;color:#868e96;line-height:1.6;margin:28px 0 0;border-top:1px solid #e9ecef;padding-top:14px">
            Confirme edição, idioma, formato e estado antes de comprar. O radar não compra nada sozinho.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const textLines = [
    `Radar de coleção — ${date}`,
    `${items.length} anúncio(s) novo(s) com match.`,
    ""
  ];
  for (const item of sorted) {
    textLines.push(
      `[P${item.work.priority}] ${item.work.title} — ${item.work.author}`,
      `${item.listing.title}`,
      `${brl(item.listing.price)}${item.listing.shipping ? ` + ${brl(item.listing.shipping)} frete` : ""}${item.overBudget ? ` [acima do teto de ${brl(item.work.max_price)}]` : ""} · ${sourceLabel(item.listing.source)}${item.listing.location ? ` · ${item.listing.location}` : ""}`,
      `confiança ${Math.round(item.score * 100)}% · ${item.reasons}${item.reasons.includes("inglês") ? "" : " · idioma a confirmar"}`,
      item.listing.url,
      ""
    );
  }
  textLines.push("Confirme edição e estado antes de comprar.");

  return { html, text: textLines.join("\n"), subject };
}
