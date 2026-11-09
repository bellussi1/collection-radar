import type { RawListing, SourceName } from "../types.js";

export interface Source {
  name: SourceName;
  search(term: string, limit: number): Promise<RawListing[]>;
}

export class SourceBlockedError extends Error {
  constructor(
    public readonly source: SourceName,
    message: string
  ) {
    super(message);
    this.name = "SourceBlockedError";
  }
}
