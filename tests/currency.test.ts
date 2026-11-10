import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parsePtaxResponse, ptaxDateCandidates, resolveUsdBrl } from "../src/currency.js";

const now = new Date(2026, 10, 10, 8, 0);
const ptax = {
  value: [
    {
      cotacaoCompra: 5.514,
      cotacaoVenda: 5.5146,
      dataHoraCotacao: "2026-11-09 13:11:19.041465"
    }
  ]
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "radar-currency-"));
}

function cacheEntry(rate: number, fetchedAt: Date): string {
  return JSON.stringify({
    usd_brl: {
      rate,
      fetchedAt: fetchedAt.toISOString(),
      source: "ptax",
      ptaxDate: "2026-11-09"
    }
  });
}

test("parsePtaxResponse lê a cotação de venda", () => {
  assert.deepEqual(parsePtaxResponse(ptax), {
    rate: 5.5146,
    date: "2026-11-09 13:11:19.041465"
  });
});

test("parsePtaxResponse usa a compra quando a venda falta", () => {
  assert.deepEqual(
    parsePtaxResponse({
      value: [{ cotacaoCompra: 5.51, dataHoraCotacao: "2026-11-09 13:00:00" }]
    }),
    { rate: 5.51, date: "2026-11-09 13:00:00" }
  );
});

test("parsePtaxResponse devolve null para resposta vazia ou inválida", () => {
  assert.equal(parsePtaxResponse({ value: [] }), null);
  assert.equal(parsePtaxResponse({ value: [{ cotacaoCompra: 0, cotacaoVenda: 0 }] }), null);
  assert.equal(parsePtaxResponse(null), null);
});

test("ptaxDateCandidates começa hoje e volta dia a dia", () => {
  assert.deepEqual(ptaxDateCandidates(now, 3), ["11-10-2026", "11-09-2026", "11-08-2026"]);
});

test("cache fresco evita a consulta à PTAX", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "currency-cache.json");
    writeFileSync(path, cacheEntry(5.4, new Date(now.getTime() - 60 * 60 * 1000)));
    const result = await resolveUsdBrl({
      fallback: 5.52,
      cachePath: path,
      now,
      fetcher: async () => {
        throw new Error("não deveria buscar");
      }
    });
    assert.equal(result.source, "cache");
    assert.equal(result.rate, 5.4);
    assert.equal(result.ptaxDate, "2026-11-09");
    assert.equal(result.stale, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cache expirado é atualizado pela PTAX", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "currency-cache.json");
    writeFileSync(path, cacheEntry(5.4, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
    const urls: string[] = [];
    const result = await resolveUsdBrl({
      fallback: 5.52,
      cachePath: path,
      now,
      cacheHours: 12,
      fetcher: async (url) => {
        urls.push(url);
        if (url.includes("11-10-2026")) return { value: [] };
        return ptax;
      }
    });
    assert.equal(result.source, "ptax");
    assert.equal(result.rate, 5.5146);
    assert.equal(result.ptaxDate, "2026-11-09 13:11:19.041465");
    assert.equal(urls.length, 2);
    assert.ok(urls[0]?.includes("11-10-2026"));
    assert.ok(urls[1]?.includes("11-09-2026"));

    const cached = JSON.parse(readFileSync(path, "utf8")) as {
      usd_brl: { rate: number; source: string };
    };
    assert.equal(cached.usd_brl.rate, 5.5146);
    assert.equal(cached.usd_brl.source, "ptax");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("falha da PTAX usa o cache antigo", async () => {
  const dir = tempDir();
  try {
    const path = join(dir, "currency-cache.json");
    writeFileSync(path, cacheEntry(5.4, new Date(now.getTime() - 48 * 60 * 60 * 1000)));
    const result = await resolveUsdBrl({
      fallback: 5.52,
      cachePath: path,
      now,
      fetcher: async () => {
        throw new Error("offline");
      }
    });
    assert.equal(result.source, "cache");
    assert.equal(result.stale, true);
    assert.equal(result.rate, 5.4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sem cache e sem PTAX usa o fallback de 5,52", async () => {
  const dir = tempDir();
  try {
    let calls = 0;
    const result = await resolveUsdBrl({
      fallback: 5.52,
      cachePath: join(dir, "sem-cache.json"),
      now,
      fetcher: async () => {
        calls += 1;
        throw new Error("offline");
      }
    });
    assert.equal(result.source, "fallback");
    assert.equal(result.rate, 5.52);
    assert.equal(result.stale, true);
    assert.equal(calls, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("PTAX sem cotação em nenhum dia cai no fallback", async () => {
  const dir = tempDir();
  try {
    const result = await resolveUsdBrl({
      fallback: 5.52,
      cachePath: join(dir, "vazio.json"),
      now,
      fetcher: async () => ({ value: [] })
    });
    assert.equal(result.source, "fallback");
    assert.equal(result.rate, 5.52);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fallback inválido usa 5,52", async () => {
  const dir = tempDir();
  try {
    const result = await resolveUsdBrl({
      fallback: 0,
      cachePath: join(dir, "sem-cache.json"),
      now,
      fetcher: async () => {
        throw new Error("offline");
      }
    });
    assert.equal(result.rate, 5.52);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
