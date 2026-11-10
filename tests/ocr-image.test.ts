import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { estimateSkewAngle, preprocessCoverImage } from "../src/ocr-image.js";

async function lineImage(angle = 0): Promise<Buffer> {
  const lines = Array.from(
    { length: 14 },
    (_, index) => `<rect x="60" y="${60 + index * 45}" width="480" height="16" fill="black"/>`
  ).join("");
  const svg = `<svg width="600" height="760" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    ${lines}
  </svg>`;
  const base = await sharp(Buffer.from(svg)).png().toBuffer();
  return angle === 0 ? base : sharp(base).rotate(angle, { background: "#fff" }).png().toBuffer();
}

test("estimateSkewAngle encontra uma inclinação", async () => {
  const angle = await estimateSkewAngle(await lineImage(5));
  assert.ok(Math.abs(angle) >= 3, `ângulo ${angle}`);
  assert.ok(Math.abs(angle) <= 8, `ângulo ${angle}`);
});

test("preprocessCoverImage faz upscale", async () => {
  const result = await preprocessCoverImage(await lineImage(0), { width: 1200 });
  assert.equal(result.width, 1200);
  assert.ok(result.height > 0);
  assert.equal(result.cropped, false);
  assert.equal(result.angle, 0);
});

test("preprocessCoverImage permite recorte opcional", async () => {
  const result = await preprocessCoverImage(await lineImage(0), {
    width: 1200,
    crop: true
  });
  assert.equal(result.width, 1200);
  assert.ok(result.height > 0);
  assert.equal(result.cropped, true);
});

test("preprocessCoverImage mantém imagem uniforme sem quebrar", async () => {
  const white = await sharp({
    create: { width: 200, height: 300, channels: 3, background: "#fff" }
  })
    .png()
    .toBuffer();
  const result = await preprocessCoverImage(white);
  assert.equal(result.cropped, false);
  assert.equal(result.width, 1200);
  assert.ok(result.height > 0);
});
