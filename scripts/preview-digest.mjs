import { chromium } from "playwright";
import path from "node:path";

const file = process.argv[2];
if (!file) throw new Error("informe o HTML do digest");
const out = path.join(process.cwd(), "data", "outbox", "preview.png");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 720, height: 1200 }, deviceScaleFactor: 1 });
await page.goto("file:///" + path.resolve(file).replace(/\\/g, "/"));
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log(out);
