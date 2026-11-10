import { containmentScore, jaccardScore } from "./normalize.js";
import type { Work } from "./types.js";

export interface OcrScore {
  score: number;
  titleScore: number;
  authorScore: number;
}

export function scoreOcrText(text: string, work: Work): OcrScore {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return { score: 0, titleScore: 0, authorScore: 0 };

  const titleContainment = containmentScore(work.title, normalized);
  const titleJaccard = jaccardScore(work.title, normalized);
  const titleScore = Math.max(titleContainment, titleJaccard * 0.9);

  const authorContainment = containmentScore(work.author, normalized);
  const lastName = work.author.split(/\s+/).filter(Boolean).at(-1) ?? "";
  const authorLast = lastName.length >= 3 ? containmentScore(lastName, normalized) : 0;
  const authorScore = Math.max(authorContainment, authorLast * 0.9);

  return {
    titleScore,
    authorScore,
    score: Math.min(1, titleScore * 0.85 + authorScore * 0.15)
  };
}
