import "dotenv/config";
import { upsertProfile } from "../services/profile.js";
import profile from "./profile.json" with { type: "json" };
import type { ProfileData } from "../types.js";

async function main() {
  await upsertProfile(profile as ProfileData);
  console.log("Profile seeded.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
