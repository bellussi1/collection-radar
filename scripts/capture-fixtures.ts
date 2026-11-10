import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { closeBrowser, withPage } from "../src/browser.js";

interface FixtureSource {
  name: string;
  selector: string;
  terms: string[];
  url: (term: string) => string;
}

const sources: FixtureSource[] = [
  {
    name: "olx-search",
    selector: "section.olx-adcard",
    terms: ["robin hobb", "brandon sanderson"],
    url: (term) => `https://www.olx.com.br/brasil?q=${encodeURIComponent(term)}`
  },
  {
    name: "mercadolivre-search",
    selector: "li.ui-search-layout__item",
    terms: ["the dandelion dynasty", "dune", "brandon sanderson"],
    url: (term) => `https://lista.mercadolivre.com.br/${term.replace(/\s+/g, "-")}`
  },
  {
    name: "enjoei-search",
    selector: ".c-product-card",
    terms: ["robin hobb", "brandon sanderson"],
    url: (term) => `https://www.enjoei.com.br/s?query=${encodeURIComponent(term)}`
  },
  {
    name: "estante-search",
    selector: ".product-item",
    terms: ["robin hobb", "brandon sanderson"],
    url: (term) => `https://www.estantevirtual.com.br/busca/${term.replace(/\s+/g, "-")}`
  }
];

mkdirSync("tests/fixtures", { recursive: true });

for (const source of sources) {
  let saved = false;
  for (const term of source.terms) {
    const url = source.url(term);
    console.log(`${source.name}: ${url}`);
    try {
      const cards = await withPage(async (page) => {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        await page.waitForSelector(source.selector, { timeout: 20_000 }).catch(() => undefined);
        return (await page.$$eval(
          source.selector,
          (elements, max) => elements.slice(0, max).map((element) => element.outerHTML),
          3
        )) as string[];
      });
      if (cards.length === 0) {
        console.log("  nenhum card; tentando outro termo");
        continue;
      }
      const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8"><title>${source.name}</title></head>
<body>
<!-- Capturado de ${url} em ${new Date().toISOString()} -->
${cards.join("\n")}
</body>
</html>
`;
      writeFileSync(`tests/fixtures/${source.name}.html`, html, "utf8");
      console.log(`  ${cards.length} cards salvos`);
      saved = true;
      break;
    } catch (error) {
      console.log(`  erro: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!saved) {
    console.log(`  fixture de ${source.name} não atualizada`);
  }
}

await closeBrowser();
