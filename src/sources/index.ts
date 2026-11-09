import type { Settings, SourceName } from "../types.js";
import { EnjoeiSource } from "./enjoei.js";
import { EstanteSource } from "./estante.js";
import { MercadoLivreSource } from "./mercadolivre.js";
import { OlxSource } from "./olx.js";
import type { Source } from "./types.js";

export function createSources(settings: Settings): Source[] {
  const registry: Record<SourceName, () => Source> = {
    estante: () => new EstanteSource(),
    olx: () => new OlxSource(),
    mercadolivre: () => new MercadoLivreSource(),
    enjoei: () => new EnjoeiSource()
  };

  return (Object.keys(registry) as SourceName[])
    .filter((name) => settings.sources[name])
    .map((name) => registry[name]());
}

export { SourceBlockedError } from "./types.js";
export type { Source } from "./types.js";
