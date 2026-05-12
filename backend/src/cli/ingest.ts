import "dotenv/config";
import { ingest } from "../services/ingest.js";
import type { JobSource } from "../types.js";

// Usage:
//   npm run ingest -- greenhouse stripe
//   npm run ingest -- lever netflix
//   npm run ingest -- ashby linear
//   npm run ingest -- linkedin "software engineer" "Remote" 2
//   npm run ingest -- indeed "backend engineer" "San Francisco" 1

async function main() {
  const [source, query, location, pages] = process.argv.slice(2);
  if (!source || !query) {
    console.error("Usage: npm run ingest -- <source> <query> [location] [pages]");
    process.exit(1);
  }
  const result = await ingest({
    source: source as JobSource,
    query,
    location,
    pages: pages ? Number(pages) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
