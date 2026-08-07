// Live demo: VLM document extraction of the committed lab-panel fixture using real Claude vision.
// Run:  pnpm --filter @copilot/agent demo:extract   (needs ANTHROPIC_API_KEY in copilot/.env)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractLabPdf, type PageImage } from "@copilot/ingestion";
import { createClaudeVlm } from "../src/anthropic/claudeVlm.js";

const env = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
const apiKey = env.match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY in copilot/.env first.");
  process.exit(1);
}

const png = resolve(process.cwd(), "../../packages/ingestion/fixtures/w2/susan-lab-panel.page-1.png");
const pages: PageImage[] = [{ page: 1, mediaType: "image/png", base64: readFileSync(png).toString("base64") }];

const port = createClaudeVlm({ apiKey, model: "claude-opus-4-8" });
const started = Date.now();
const outcome = await extractLabPdf(port, pages);

console.log(`\nStatus: ${outcome.status}  (attempts=${outcome.attempts}, ${Date.now() - started}ms)\n`);
if (outcome.status === "ok") {
  for (const r of outcome.extraction.results) {
    console.log(
      `• ${r.testName}: ${r.value}${r.unit ? " " + r.unit : ""}  [${r.abnormalFlag}]  confidence=${r.confidence}`,
    );
  }
} else {
  console.log("Degraded — flagged fields:", outcome.issues);
}
