import "dotenv/config";
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const DEFAULT_DB = "data/radar.db";
const DEFAULT_DIR = "data/backups";
const DEFAULT_KEEP = 14;
const BACKUP_PATTERN = /^radar-\d{4}-\d{2}-\d{2}\.db$/;

export interface BackupOptions {
  dbPath: string;
  backupDir: string;
  keep: number;
  now?: Date;
}

export interface BackupResult {
  path: string;
  pages: number;
  size: number;
  removed: string[];
}

export function backupFileName(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `radar-${year}-${month}-${day}.db`;
}

export function pruneBackups(dir: string, keep: number): string[] {
  if (!Number.isInteger(keep) || keep < 1) {
    throw new Error("a retenção precisa ser um inteiro maior ou igual a 1");
  }
  if (!existsSync(dir)) return [];

  const names = readdirSync(dir)
    .filter((name) => BACKUP_PATTERN.test(name))
    .sort();
  const excess = names.slice(0, Math.max(0, names.length - keep));
  for (const name of excess) unlinkSync(join(dir, name));
  return excess;
}

function removeSidecars(path: string): void {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${path}${suffix}`;
    if (existsSync(sidecar)) unlinkSync(sidecar);
  }
}

function tableCounts(db: DatabaseSync): Map<string, number> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as unknown as Array<{ name: string }>;
  const counts = new Map<string, number>();
  for (const { name } of tables) {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${quoted}`).get() as unknown as {
      count: number;
    };
    counts.set(name, Number(row.count));
  }
  return counts;
}

function verifyBackup(path: string, expected: Map<string, number>): void {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get() as unknown as
      | { integrity_check: string }
      | undefined;
    if (integrity?.integrity_check !== "ok") {
      throw new Error(`integridade falhou: ${integrity?.integrity_check ?? "sem resposta"}`);
    }
    const actual = tableCounts(db);
    for (const [table, count] of expected) {
      if (actual.get(table) !== count) {
        throw new Error(
          `tabela ${table}: esperado ${count}, encontrado ${actual.get(table) ?? "ausente"}`
        );
      }
    }
  } finally {
    db.close();
  }
}

function makeSelfContained(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec("PRAGMA journal_mode = DELETE;");
  } finally {
    db.close();
  }
  removeSidecars(path);
}

export async function runBackup(options: BackupOptions): Promise<BackupResult> {
  const dbPath = resolve(options.dbPath);
  const backupDir = resolve(options.backupDir);
  if (!existsSync(dbPath)) throw new Error(`banco não encontrado: ${dbPath}`);
  if (!statSync(dbPath).isFile()) throw new Error(`banco não é um arquivo: ${dbPath}`);

  mkdirSync(backupDir, { recursive: true });
  const finalPath = resolve(join(backupDir, backupFileName(options.now)));
  if (finalPath === dbPath) throw new Error("o destino do backup é o próprio banco");

  const tempPath = `${finalPath}.tmp-${process.pid}`;
  const source = new DatabaseSync(dbPath, { readOnly: true });
  let pages = 0;
  let expected = new Map<string, number>();
  try {
    expected = tableCounts(source);
    pages = await backup(source, tempPath);
  } finally {
    source.close();
  }

  try {
    verifyBackup(tempPath, expected);
    makeSelfContained(tempPath);
    renameSync(tempPath, finalPath);
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
    removeSidecars(tempPath);
  }

  const removed = pruneBackups(backupDir, options.keep);
  return { path: finalPath, pages, size: statSync(finalPath).size, removed };
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1] ?? fallback;
  return fallback;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function main(): Promise<void> {
  const dbPath = argValue("--db", process.env.RADAR_DB?.trim() || DEFAULT_DB);
  const backupDir = argValue("--dir", process.env.BACKUP_DIR?.trim() || DEFAULT_DIR);
  const keepRaw = argValue("--keep", process.env.BACKUP_KEEP_DAYS?.trim() || String(DEFAULT_KEEP));
  const keep = Number(keepRaw);
  if (!Number.isInteger(keep) || keep < 1) {
    console.error(`Retenção inválida: ${keepRaw}. Use um inteiro maior ou igual a 1.`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runBackup({ dbPath, backupDir, keep });
    const removed =
      result.removed.length > 0
        ? ` · ${result.removed.length} antigo${result.removed.length === 1 ? "" : "s"} removido${result.removed.length === 1 ? "" : "s"}`
        : "";
    console.log(
      `Backup: ${result.path} · ${formatSize(result.size)} · ${keep} dia${keep === 1 ? "" : "s"} de retenção${removed}`
    );
  } catch (error) {
    console.error(`Backup falhou: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
