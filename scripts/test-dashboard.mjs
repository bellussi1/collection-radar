import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const base = "http://127.0.0.1:4317";

async function stats() {
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  const ignored = text.match(/(\d+) IGNORADOS/)?.[1];
  const bought = text.match(/(\d+) COMPRADOS/)?.[1];
  return { ignored, bought };
}

await page.goto(base, { waitUntil: "networkidle" });
const first = page.locator("article.row").first();
const firstTitle = await first.locator("h2").innerText();
console.log("primeiro:", firstTitle);
console.log("stats iniciais:", await stats());

await first.getByRole("button", { name: "Ignorar" }).click();
await page.waitForLoadState("networkidle");
console.log("apos ignorar:", await stats());
console.log("primeiro ainda ativo?", await page.locator("article.row h2", { hasText: firstTitle }).count());

await page.goto(base + "/?status=ignored", { waitUntil: "networkidle" });
console.log("ignorados na tela:", await page.locator("article.row").count());
const ignoredRow = page.locator("article.row").first();
console.log("ignorado:", await ignoredRow.locator("h2").innerText());
await ignoredRow.getByRole("button", { name: "Reabrir" }).click();
await page.waitForLoadState("networkidle");
console.log("apos reabrir:", await stats());

await page.goto(base, { waitUntil: "networkidle" });
const second = page.locator("article.row").first();
const secondTitle = await second.locator("h2").innerText();
console.log("segundo:", secondTitle);
await second.getByRole("button", { name: "Comprei" }).click();
await page.waitForLoadState("networkidle");
console.log("apos comprar:", await stats());
console.log("owned section:", await page.locator("section.owned").count());

await page.goto(base + "/?status=bought", { waitUntil: "networkidle" });
console.log("comprados na tela:", await page.locator("article.row").count());
const ownedRemove = page.locator("section.owned").getByRole("button", { name: "Remover" }).first();
await ownedRemove.click();
await page.waitForLoadState("networkidle");
console.log("apos remover:", await stats());

await page.goto(base, { waitUntil: "networkidle" });
await page.screenshot({ path: "data/outbox/dashboard-final.png" });
console.log("screenshot: data/outbox/dashboard-final.png");
await browser.close();
