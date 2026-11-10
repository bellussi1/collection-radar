import type { Settings, SourceName } from "../types.js";
import { AbeBooksSource } from "./abebooks.js";
import { EnjoeiSource } from "./enjoei.js";
import { EstanteSource } from "./estante.js";
import { MercadoLivreSource } from "./mercadolivre.js";
import { OlxSource } from "./olx.js";
import { ShopeeSource } from "./shopee.js";
import type { Source } from "./types.js";

export function createSources(settings: Settings): Source[] {
  const registry: Record<SourceName, () => Source> = {
    estante: () => new EstanteSource(),
    olx: () => new OlxSource(),
    mercadolivre: () => new MercadoLivreSource(),
    enjoei: () => new EnjoeiSource(),
    abebooks: () => new AbeBooksSource(),
    shopee: () => new ShopeeSource()
  };

  return (Object.keys(registry) as SourceName[])
    // AbeBooks é ISBN-only e roda no isbn-scan; Shopee fica fora do scan
    // normal por padrão, mas pode ser chamada com --source shopee.
    .filter((name) => name !== "abebooks" && settings.sources[name])
    .map((name) => registry[name]());
}

export { SourceBlockedError } from "./types.js";
export type { Source } from "./types.js";
