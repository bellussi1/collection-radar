import { type Browser, type BrowserContext, chromium, type Page } from "playwright";

let browser: Browser | null = null;
let context: BrowserContext | null = null;
let shopeeContext: BrowserContext | null = null;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36";

export async function getContext(): Promise<BrowserContext> {
  if (context) return context;

  const headless = process.env.HEADLESS === "true";
  browser = await chromium.launch({
    headless,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--window-position=-32000,-32000",
      "--window-size=1000,800",
      "--disable-dev-shm-usage"
    ]
  });

  context = await browser.newContext({
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1366, height: 768 },
    userAgent: USER_AGENT
  });
  context.setDefaultTimeout(30_000);
  context.setDefaultNavigationTimeout(45_000);
  return context;
}

export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function getShopeeContext(
  options: { headless?: boolean; offscreen?: boolean } = {}
): Promise<BrowserContext> {
  if (shopeeContext) return shopeeContext;

  const headless = options.headless ?? process.env.HEADLESS === "true";
  const offscreen = options.offscreen ?? true;
  const profileDir = process.env.SHOPEE_PROFILE_DIR?.trim() || "data/shopee-profile";
  const args = ["--disable-blink-features=AutomationControlled", "--disable-dev-shm-usage"];
  if (offscreen) {
    args.push("--window-position=-32000,-32000", "--window-size=1000,800");
  }

  shopeeContext = await chromium.launchPersistentContext(profileDir, {
    headless,
    args,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1366, height: 768 },
    userAgent: USER_AGENT
  });
  shopeeContext.setDefaultTimeout(30_000);
  shopeeContext.setDefaultNavigationTimeout(45_000);
  return shopeeContext;
}

export async function withShopeePage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await getShopeeContext();
  const page = await ctx.newPage();
  try {
    return await fn(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function closeBrowser(): Promise<void> {
  await shopeeContext?.close().catch(() => undefined);
  shopeeContext = null;
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  context = null;
  browser = null;
}
