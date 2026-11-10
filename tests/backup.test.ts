import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { backupFileName, pruneBackups, runBackup } from "../src/backup.js";

test("nome do backup usa a data local", () => {
  assert.equal(backupFileName(new Date(2026, 10, 9, 23, 59)), "radar-2026-11-09.db");
  assert.equal(backupFileName(new Date(2026, 0, 1, 0, 0)), "radar-2026-01-01.db");
});

test("retenção mantém os backups mais recentes e ignora outros arquivos", () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-backup-prune-"));
  try {
    for (const date of ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]) {
      writeFileSync(join(dir, `radar-${date}.db`), "x");
    }
    writeFileSync(join(dir, "nota.txt"), "x");

    const removed = pruneBackups(dir, 2);

    assert.deepEqual(removed, ["radar-2026-11-01.db", "radar-2026-11-02.db"]);
    assert.deepEqual(readdirSync(dir).sort(), [
      "nota.txt",
      "radar-2026-11-03.db",
      "radar-2026-11-04.db"
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("backup copia o banco aberto, valida as contagens e não duplica no mesmo dia", async () => {
  const root = mkdtempSync(join(tmpdir(), "radar-backup-"));
  const source = new DatabaseSync(join(root, "radar.db"));
  try {
    source.exec("PRAGMA journal_mode = WAL");
    source.exec("CREATE TABLE owned (work_key TEXT PRIMARY KEY, title TEXT NOT NULL)");
    source.exec("INSERT INTO owned VALUES ('a', 'A'), ('b', 'B')");

    const options = {
      dbPath: join(root, "radar.db"),
      backupDir: join(root, "backups"),
      keep: 14,
      now: new Date(2026, 10, 9)
    };
    const first = await runBackup(options);
    assert.equal(first.path, join(root, "backups", "radar-2026-11-09.db"));
    assert.ok(first.pages > 0);
    assert.ok(first.size > 0);

    const copy = new DatabaseSync(first.path, { readOnly: true });
    const row = copy.prepare("SELECT COUNT(*) AS count FROM owned").get() as { count: number };
    assert.equal(Number(row.count), 2);
    copy.close();

    const second = await runBackup(options);
    assert.equal(second.path, first.path);
    assert.deepEqual(readdirSync(join(root, "backups")).sort(), ["radar-2026-11-09.db"]);
  } finally {
    source.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("runBackup aplica a retenção depois de gravar", async () => {
  const root = mkdtempSync(join(tmpdir(), "radar-backup-retention-"));
  const source = new DatabaseSync(join(root, "radar.db"));
  try {
    source.exec("CREATE TABLE owned (work_key TEXT PRIMARY KEY)");
    source.exec("INSERT INTO owned VALUES ('a')");

    const backupDir = join(root, "backups");
    mkdirSync(backupDir, { recursive: true });
    for (const date of ["2026-11-01", "2026-11-02", "2026-11-03"]) {
      writeFileSync(join(backupDir, `radar-${date}.db`), "x");
    }

    const result = await runBackup({
      dbPath: join(root, "radar.db"),
      backupDir,
      keep: 2,
      now: new Date(2026, 10, 4)
    });

    assert.deepEqual(result.removed, ["radar-2026-11-01.db", "radar-2026-11-02.db"]);
    assert.deepEqual(readdirSync(backupDir).sort(), ["radar-2026-11-03.db", "radar-2026-11-04.db"]);
  } finally {
    source.close();
    rmSync(root, { recursive: true, force: true });
  }
});
