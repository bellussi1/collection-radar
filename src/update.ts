import "dotenv/config";
import { spawnSync } from "node:child_process";

interface Step {
  name: string;
  args: string[];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

const quick = hasFlag("--quick");
const dryRun = hasFlag("--dry-run");

const steps: Step[] = [
  ...(quick
    ? []
    : [
        {
          name: "scan",
          args: ["run", "scan", "--", "--no-email"]
        }
      ]),
  { name: "rematch", args: ["run", "rematch"] },
  {
    name: "covers",
    args: ["run", "covers", "--", "--max-score", "0.8", "--limit", "30"]
  },
  { name: "ocr", args: ["run", "ocr", "--", "--limit", "20"] },
  { name: "digest", args: ["run", "digest", "--", "--new", "--no-email"] }
];

function runNpm(args: string[]) {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return spawnSync(process.execPath, [npmExecPath, ...args], { stdio: "inherit" });
  }
  return spawnSync("npm", args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
}

if (dryRun) {
  console.log("Atualização do dashboard:");
  for (const step of steps) console.log(`  npm ${step.args.join(" ")}`);
  process.exit(0);
}

console.log(
  `Atualização do dashboard${quick ? " (rápida, sem scan)" : ""} · ${steps.length} etapas`
);
const started = Date.now();
const failed: string[] = [];

for (const step of steps) {
  console.log("");
  console.log(`== ${step.name} ==`);
  const result = runNpm(step.args);
  if (result.status !== 0) {
    failed.push(step.name);
    console.warn(`Etapa ${step.name} falhou (exit ${result.status ?? "?"}). Seguindo.`);
  }
}

const elapsed = Math.round((Date.now() - started) / 1000);
console.log("");
console.log(`Atualização concluída em ${Math.floor(elapsed / 60)}m ${elapsed % 60}s.`);
if (failed.length > 0) {
  console.log(`Etapas com falha: ${failed.join(", ")}.`);
  process.exitCode = 1;
}
console.log("Dashboard: http://127.0.0.1:4317");
console.log("Recarregue a página. Se o servidor não estiver rodando: npm run dashboard.");
