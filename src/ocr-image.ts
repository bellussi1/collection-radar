import sharp from "sharp";

export interface PreprocessOptions {
  width?: number;
  threshold?: number | null;
  deskew?: boolean;
  crop?: boolean;
}

export interface PreprocessResult {
  buffer: Buffer;
  angle: number;
  cropped: boolean;
  width: number;
  height: number;
}

async function rowVariance(input: Buffer, angle: number): Promise<number> {
  const { data, info } = await sharp(input)
    .grayscale()
    .resize({ width: 400, fit: "inside" })
    .rotate(angle, { background: "#fff" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const marginX = Math.floor(width * 0.15);
  const marginY = Math.floor(height * 0.15);
  const start = marginY;
  const end = height - marginY;
  const count = Math.max(0, end - start);
  if (count === 0 || width - marginX * 2 <= 0) return 0;

  const rows = new Float64Array(count);
  for (let y = start; y < end; y += 1) {
    let sum = 0;
    for (let x = marginX; x < width - marginX; x += 1) {
      const index = (y * width + x) * channels;
      sum += data[index] ?? 0;
    }
    rows[y - start] = sum;
  }

  let mean = 0;
  for (const value of rows) mean += value;
  mean /= count;
  let variance = 0;
  for (const value of rows) variance += (value - mean) ** 2;
  return variance / count;
}

export async function estimateSkewAngle(input: Buffer, range = 6): Promise<number> {
  const zeroVariance = await rowVariance(input, 0);
  let bestAngle = 0;
  let bestVariance = zeroVariance;

  for (let angle = -range; angle <= range; angle += 1) {
    if (angle === 0) continue;
    const variance = await rowVariance(input, angle);
    if (variance > bestVariance) {
      bestVariance = variance;
      bestAngle = angle;
    }
  }

  // Ângulo no limite indica que a projeção não achou uma linha de texto;
  // nesse caso é melhor não girar a capa.
  if (Math.abs(bestAngle) >= range) return 0;
  // Sem ganho claro, mantém a imagem como está. Capas com pouco texto ou
  // ilustrações podem produzir um ângulo aleatório.
  if (bestAngle !== 0 && bestVariance < zeroVariance * 1.05) return 0;
  return bestAngle;
}

export async function preprocessCoverImage(
  input: Buffer,
  options: PreprocessOptions = {}
): Promise<PreprocessResult> {
  const width = options.width ?? 1200;
  const threshold = options.threshold === undefined ? null : options.threshold;
  const deskew = options.deskew ?? false;
  const crop = options.crop ?? false;

  const base = await sharp(input, { failOn: "none" })
    .rotate()
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
  const originalMeta = await sharp(base).metadata();

  let croppedBuffer = base;
  let cropped = false;
  if (crop) {
    try {
      const trimmed = await sharp(base).trim({ threshold: 10 }).png().toBuffer();
      const trimmedMeta = await sharp(trimmed).metadata();
      if (
        originalMeta.width &&
        originalMeta.height &&
        trimmedMeta.width &&
        trimmedMeta.height &&
        trimmedMeta.width * trimmedMeta.height >= 0.25 * originalMeta.width * originalMeta.height &&
        (trimmedMeta.width < originalMeta.width || trimmedMeta.height < originalMeta.height)
      ) {
        croppedBuffer = trimmed;
        cropped = true;
      }
    } catch {
      // Mantém a imagem inteira se o trim não conseguir isolar a capa.
    }
  }

  const angle = deskew ? await estimateSkewAngle(croppedBuffer) : 0;
  const deskewed =
    angle === 0
      ? croppedBuffer
      : await sharp(croppedBuffer).rotate(angle, { background: "#fff" }).png().toBuffer();

  let pipeline = sharp(deskewed)
    .resize({ width, fit: "inside", withoutEnlargement: false, kernel: "lanczos3" })
    .sharpen();
  if (threshold !== null) pipeline = pipeline.threshold(threshold);
  const processed = await pipeline.png().toBuffer();
  const meta = await sharp(processed).metadata();

  return {
    buffer: processed,
    angle,
    cropped,
    width: meta.width ?? width,
    height: meta.height ?? 0
  };
}
