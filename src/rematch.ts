import "dotenv/config";
import { loadSettings, loadWorks } from "./config.js";
import { RadarDb } from "./db.js";
import { matchListing } from "./match.js";

const db = new RadarDb("data/radar.db");
const settings = loadSettings();
const works = loadWorks().filter((work) => work.enabled);
const listings = db.listAllListings();

db.clearMatches();
let matches = 0;
for (const listing of listings) {
  const match = matchListing(listing, works, settings.scan.min_score);
  if (!match) continue;
  db.recordMatch(listing.id, match);
  matches += 1;
}

console.log(
  `Re-match: ${listings.length} anúncios · ${matches} matches · ${works.length} obras ativas`
);
db.close();
