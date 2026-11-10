/**
 * Percentual de queda entre dois totais. Retorna null quando não houve queda
 * ou quando a queda é menor que o corte mínimo.
 */
export function dropPercent(
  previous: number | null,
  current: number | null,
  minPercent = 0
): number | null {
  if (previous === null || current === null || previous <= 0) return null;
  if (current >= previous) return null;
  const percent = (1 - current / previous) * 100;
  if (percent < minPercent) return null;
  const rounded = Math.round(percent);
  return rounded > 0 ? rounded : null;
}

/** Frase do dashboard comparando o total atual com o primeiro total visto. */
export function priceChangeLabel(
  first: number | null,
  current: number | null
): string | null {
  if (first === null || current === null || first <= 0) return null;
  const percent = Math.round((1 - current / first) * 100);
  if (percent > 0) return `caiu ${percent}% desde a primeira vez`;
  if (percent < 0) return `subiu ${Math.abs(percent)}% desde a primeira vez`;
  return "estável desde a primeira vez";
}
