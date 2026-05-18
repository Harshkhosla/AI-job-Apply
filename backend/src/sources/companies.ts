// Curated lists of company slugs by ATS provider.
// Edit these freely — these are the slugs used in the public board URLs.
//
//   Greenhouse: https://boards.greenhouse.io/<slug>
//   Lever:      https://jobs.lever.co/<slug>
//   Ashby:      https://jobs.ashbyhq.com/<slug>

// Greenhouse company slugs. Includes companies that hire in India / remote
// and have strong React/Node/TypeScript/AI stacks.
export const GREENHOUSE_COMPANIES: string[] = [
  "stripe",
  "airbnb",
  "anthropic",
  "openai",
  "discord",
  "asana",
  "coinbase",
  "duolingo",
  "figma",
  "gitlab",
  "notion",
  "pinterest",
  "reddit",
  "snowflake",
  "vercel",
  "dropbox",
  "shopify",
  "razorpay",
  "swiggy",
  "zomato",
  "cred",
  "groww",
  "meesho",
  "udaan",
  "postman",
  "freshworks",
  "browserstack",
  "atlan",
  "hasura",
];

export const LEVER_COMPANIES: string[] = [
  "netflix",
  "plaid",
  "palantir",
  "twitch",
  "ramp",
  "scale",
  "anduril",
  "brex",
  "checkr",
  "kraken",
  "lattice",
  "mercury",
  "rippling",
  "shipt",
  "yelp",
];

export const ASHBY_COMPANIES: string[] = [
  "linear",
  "ramp",
  "openai",
  "perplexity",
  "vanta",
  "deel",
  "posthog",
  "supabase",
  "retool",
  "replit",
  "modal",
  "mistral",
  "harvey",
  "cursor",
  "warp",
];

// Default keyword searches for board-less sources (LinkedIn, Indeed).
// Edit these to match what you're hunting for.
export interface KeywordSearch {
  query: string;
  location?: string;
  pages?: number;
  easyApplyOnly?: boolean;
}
// Tuned for: Full Stack / SDE — React, Next.js, Node.js, TypeScript, AI/LLM.
// Mix of India-based and remote roles.
export const LINKEDIN_SEARCHES: KeywordSearch[] = [
  // Easy-Apply-only searches — the bot can actually apply to these.
  { query: "full stack engineer", location: "India", pages: 2, easyApplyOnly: true },
  { query: "software development engineer", location: "India", pages: 2, easyApplyOnly: true },
  { query: "MERN stack developer", location: "India", pages: 2, easyApplyOnly: true },
  { query: "Next.js developer", location: "India", pages: 2, easyApplyOnly: true },
  { query: "react developer", location: "Bengaluru, Karnataka, India", pages: 2, easyApplyOnly: true },
  { query: "Node.js engineer", location: "India", pages: 1, easyApplyOnly: true },
  { query: "AI engineer", location: "India", pages: 1, easyApplyOnly: true },
  // Broader searches without Easy-Apply filter (manual apply jobs)
  { query: "full stack engineer", location: "Remote", pages: 2 },
  { query: "software engineer typescript", location: "Remote", pages: 1 },
];
// Broad Indeed sweep: ~25 keyword/location combinations covering all the role
// types we hire for, across India tier-1 cities and global Remote. Each
// search hits Indeed sorted by date so the newest postings always surface.
// The Playwright context is reused across all searches via a module-level
// singleton in sources/indeed.ts, so 25 searches != 25 browsers.
export const INDEED_SEARCHES: KeywordSearch[] = [
  // Full stack / SDE — India-wide
  { query: "full stack developer", location: "India", pages: 2 },
  { query: "full stack engineer", location: "India", pages: 2 },
  { query: "software development engineer", location: "India", pages: 2 },
  { query: "software engineer", location: "India", pages: 2 },
  { query: "SDE", location: "India", pages: 2 },

  // Stack-specific — India-wide
  { query: "MERN stack developer", location: "India", pages: 2 },
  { query: "next.js developer", location: "India", pages: 2 },
  { query: "react developer", location: "India", pages: 2 },
  { query: "node.js developer", location: "India", pages: 2 },
  { query: "typescript developer", location: "India", pages: 2 },
  { query: "javascript developer", location: "India", pages: 1 },

  // Frontend / Backend split — India-wide
  { query: "frontend engineer", location: "India", pages: 2 },
  { query: "backend engineer node", location: "India", pages: 2 },

  // AI / ML — India-wide
  { query: "AI engineer", location: "India", pages: 2 },
  { query: "machine learning engineer", location: "India", pages: 1 },
  { query: "LLM engineer", location: "India", pages: 1 },
  { query: "generative AI engineer", location: "India", pages: 1 },

  // Tier-1 cities (often surface jobs not tagged "India" generally)
  { query: "full stack developer", location: "Bengaluru, Karnataka", pages: 2 },
  { query: "software engineer", location: "Bengaluru, Karnataka", pages: 2 },
  { query: "react developer", location: "Hyderabad, Telangana", pages: 1 },
  { query: "full stack engineer", location: "Pune, Maharashtra", pages: 1 },
  { query: "software engineer", location: "Mumbai, Maharashtra", pages: 1 },
  { query: "full stack developer", location: "Delhi, India", pages: 1 },
  { query: "software engineer", location: "Noida, Uttar Pradesh", pages: 1 },
  { query: "full stack developer", location: "Gurugram, Haryana", pages: 1 },
  { query: "software engineer", location: "Chennai, Tamil Nadu", pages: 1 },
];
