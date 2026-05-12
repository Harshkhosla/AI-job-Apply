import "dotenv/config";
import { ingestAll } from "../services/ingest.js";

// Usage:
//   npm run ingest:all              # all curated companies, all time
//   npm run ingest:all -- 48        # only postings in last 48h
//   npm run ingest:all -- 24 greenhouse,ashby

async function main() {
  const [hoursArg, sourcesArg] = process.argv.slice(2);
  const hours = hoursArg ? Number(hoursArg) : undefined;
  const sources = sourcesArg
    ? (sourcesArg.split(",").filter(Boolean) as Array<"greenhouse" | "lever" | "ashby">)
    : undefined;

  console.log(
    `Bulk ingest: sources=${sources?.join(",") ?? "all"} window=${hours ? hours + "h" : "all-time"}`
  );
  const r = await ingestAll({ hours, sources });
  console.log(JSON.stringify(r, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
