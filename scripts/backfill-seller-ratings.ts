import "dotenv/config";
import { RadarDb } from "../src/db.js";
import { extractSellerRating } from "../src/seller.js";

const db = new RadarDb("data/radar.db");
const rows = db.listRawListings();
let rated = 0;

for (const row of rows) {
  if (!row.rawJson) continue;
  let raw: { text?: unknown };
  try {
    raw = JSON.parse(row.rawJson) as { text?: unknown };
  } catch {
    continue;
  }
  const rating = extractSellerRating(String(raw.text ?? ""), row.seller);
  if (rating === null) continue;
  db.setSellerRating(row.id, rating);
  rated += 1;
}

console.log(`Notas de vendedor: ${rated} anúncios atualizados de ${rows.length} com raw_json.`);
db.close();
