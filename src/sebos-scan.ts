import "dotenv/config";
import { runScan } from "./scan.js";

if (!process.env.GOOGLE_CSE_API_KEY?.trim() || !process.env.GOOGLE_CSE_CX?.trim()) {
  console.error(
    "Configure GOOGLE_CSE_API_KEY e GOOGLE_CSE_CX no .env para buscar sebos independentes."
  );
  process.exit(1);
}

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
  source: "sebos",
  queries: featured,
  limit: 10,
  noEmail: true
});
