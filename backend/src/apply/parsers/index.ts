import type { ParsedForm } from "../types.js";
import { parseGreenhouseForm } from "./greenhouse.js";
import { parseLeverForm } from "./lever.js";
import { parseAshbyForm } from "./ashby.js";

export async function parseForm(source: string, jobUrl: string): Promise<ParsedForm> {
  switch (source) {
    case "greenhouse":
      return parseGreenhouseForm(jobUrl);
    case "lever":
      return parseLeverForm(jobUrl);
    case "ashby":
      return parseAshbyForm(jobUrl);
    default:
      throw new Error(`Auto-apply not supported for source: ${source}`);
  }
}
