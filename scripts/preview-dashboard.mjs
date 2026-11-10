import { chromium } from "playwright";
import path from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:4317";
const out = path.join(process.cwd(), "data", "outbox", "dashboard-top.png");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.screenshot({ path: out });
await browser.close();
console.log(out);
