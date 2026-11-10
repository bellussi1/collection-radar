import sharp, { type Sharp } from "sharp";

export const USER_AGENT = "collection-radar/0.1 (personal book radar)";

export interface ImageHashes {
  full: string;
  center: string;
  trim: string;
}

export type CoverVerdict = "same" | "likely" | "inconclusive" | "different";

/**
 * Hash perceptual dHash de 64 bits: reduz a imagem para 9x8 em escala de cinza
 * e compara cada pixel com o vizinho da direita. Robusto a compressão e a
 * pequenas mudanças de brilho, barato o bastante para rodar em lote.
 */
async function dhash(pipeline: Sharp): Promise<string> {
  const raw = await pipeline.resize(9, 8, { fit: "fill" }).grayscale().raw().toBuffer();
  if (raw.length < 72) throw new Error("imagem pequena demais para hash");
  let bits = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = raw[y * 9 + x] ?? 0;
      const right = raw[y * 9 + x + 1] ?? 0;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export async function hashImage(buffer: Buffer): Promise<ImageHashes> {
  const base = sharp(buffer, { failOn: "none" }).rotate();
  const metadata = await base.metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  const full = await dhash(base.clone());

  let center = full;
  if (width > 0 && height > 0) {
    const side = Math.max(1, Math.floor(Math.min(width, height) * 0.72));
    const left = Math.max(0, Math.floor((width - side) / 2));
    const top = Math.max(0, Math.floor((height - side) / 2));
    try {
      center = await dhash(base.clone().extract({ left, top, width: side, height: side }));
    } catch {
      center = full;
    }
  }

  let trim = full;
  try {
    trim = await dhash(base.clone().trim({ threshold: 12 }));
  } catch {
    trim = full;
  }

  return { full, center, trim };
}

export function hamming(a: string, b: string): number {
  let xor = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let distance = 0;
  while (xor > 0n) {
    distance += Number(xor & 1n);
    xor >>= 1n;
  }
  return distance;
}

/** Menor distância entre as variantes (inteira, centro e recorte de bordas). */
export function minDistance(a: ImageHashes, b: ImageHashes): number {
  const aHashes = [a.full, a.center, a.trim];
  const bHashes = [b.full, b.center, b.trim];
  let best = 64;
  for (const left of aHashes) {
    for (const right of bHashes) {
      best = Math.min(best, hamming(left, right));
    }
  }
  return best;
}

export function classifyDistance(distance: number): CoverVerdict {
  if (distance <= 8) return "same";
  if (distance <= 12) return "likely";
  if (distance > 20) return "different";
  return "inconclusive";
}

export async function fetchImage(url: string, referer?: string): Promise<Buffer | null> {
  const normalized = url.startsWith("//") ? `https:${url}` : url;
  try {
    const response = await fetch(normalized, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8",
        ...(referer ? { Referer: referer } : {})
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 500 || buffer.length > 20_000_000) return null;
    return buffer;
  } catch {
    return null;
  }
}

export async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}
