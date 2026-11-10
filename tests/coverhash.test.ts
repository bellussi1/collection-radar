import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  classifyDistance,
  hamming,
  hashImage,
  minDistance
} from "../src/coverhash.js";

test("hamming conta bits diferentes", () => {
  assert.equal(hamming("0000000000000000", "0000000000000000"), 0);
  assert.equal(hamming("0000000000000001", "0000000000000000"), 1);
  assert.equal(hamming("ffffffffffffffff", "0000000000000000"), 64);
  assert.equal(hamming("00000000000000ff", "0000000000000000"), 8);
});

test("classifyDistance usa os cortes combinados", () => {
  assert.equal(classifyDistance(0), "same");
  assert.equal(classifyDistance(8), "same");
  assert.equal(classifyDistance(9), "likely");
  assert.equal(classifyDistance(12), "likely");
  assert.equal(classifyDistance(13), "inconclusive");
  assert.equal(classifyDistance(20), "inconclusive");
  assert.equal(classifyDistance(21), "different");
});

test("hashImage é estável para a mesma imagem e muda entre imagens distintas", async () => {
  const gradient = await sharp({
    create: { width: 90, height: 120, channels: 3, background: "#ffffff" }
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="90" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect width="90" height="120" fill="url(#g)"/></svg>`
        )
      }
    ])
    .png()
    .toBuffer();

  const stripes = await sharp({
    create: { width: 90, height: 120, channels: 3, background: "#ffffff" }
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="90" height="120"><rect width="15" height="120" fill="#000"/><rect x="30" width="15" height="120" fill="#000"/><rect x="60" width="15" height="120" fill="#000"/></svg>`
        )
      }
    ])
    .png()
    .toBuffer();

  const first = await hashImage(gradient);
  const second = await hashImage(gradient);
  const other = await hashImage(stripes);

  assert.match(first.full, /^[0-9a-f]{16}$/);
  assert.match(first.center, /^[0-9a-f]{16}$/);
  assert.match(first.trim, /^[0-9a-f]{16}$/);
  assert.equal(minDistance(first, second), 0);
  assert.ok(minDistance(first, other) > 0);
});
