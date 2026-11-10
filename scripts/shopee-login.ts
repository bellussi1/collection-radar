import "dotenv/config";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { closeBrowser, getShopeeContext } from "../src/browser.js";

const context = await getShopeeContext({ headless: false, offscreen: false });
const page = context.pages()[0] ?? (await context.newPage());
await page.goto("https://shopee.com.br/", { waitUntil: "domcontentloaded", timeout: 60_000 });

console.log("Faça login na janela do Chromium que abriu.");
console.log("Depois de entrar na sua conta, volte aqui e pressione Enter.");

const rl = createInterface({ input, output });
await rl.question("Enter para salvar o perfil e fechar: ");
rl.close();

await closeBrowser();
console.log("Perfil da Shopee salvo em data/shopee-profile.");
