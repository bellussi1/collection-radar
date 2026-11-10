import "dotenv/config";
import { runScan } from "./scan.js";

const featured = [
  "Robin Hobb",
  "Brandon Sanderson",
  "Steven Erikson",
  "Frank Herbert",
  "Pierce Brown",
  "Christopher Ruocchio",
  "Cormac McCarthy",
  "Matt Dinniman"
];

await runScan({
  source: "shopee",
  queries: featured,
  limit: 20,
  noEmail: true
});
