import type { Settings, SourceName } from "../types.js";
import { AbeBooksSource } from "./abebooks.js";
import { EnjoeiSource } from "./enjoei.js";
import { EstanteSource } from "./estante.js";
import { MercadoLivreSource } from "./mercadolivre.js";
import { OlxSource } from "./olx.js";
import { GoogleCseSource } from "./sebos.js";
import { ShopeeSource } from "./shopee.js";
import type { Source } from "./types.js";

export function createSources(settings: Settings): Source[] {
  const registry: Record<SourceName, () => Source> = {
    estante: () => new EstanteSource(),
    olx: () => new OlxSource(),
    mercadolivre: () => new MercadoLivreSource(),
    enjoei: () => new EnjoeiSource(),
    abebooks: () => new AbeBooksSource(),
    shopee: () => new ShopeeSource(),
    sebos: () => new GoogleCseSource()
  };

  return (
    (Object.keys(registry) as SourceName[])
      // AbeBooks é ISBN-only e roda no isbn-scan; Shopee e sebos ficam fora
      // do scan normal e rodam em comandos próprios.
      .filter((name) => name !== "abebooks" && settings.sources[name])
      .map((name) => registry[name]())
  );
}

export type { Source } from "./types.js";
export { SourceBlockedError } from "./types.js";
