// Live demo: guideline RAG over the committed corpus using real Cohere embed + rerank.
// Run:  pnpm --filter @copilot/agent demo:rag   (needs COHERE_API_KEY in copilot/.env)
// Optional: pass a query as the first arg.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkMarkdown, buildIndex, retrieveEvidence, rerankEvidence } from "@copilot/rag";
import { createCohereEmbed } from "../src/cohere/cohereEmbed.js";
import { createCohereRerank } from "../src/cohere/cohereRerank.js";

const env = readFileSync(resolve(process.cwd(), "../../.env"), "utf8");
const apiKey = env.match(/^COHERE_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) {
  console.error("Set COHERE_API_KEY in copilot/.env first.");
  process.exit(1);
}

const query = process.argv[2] ?? "Should I intensify her diabetes therapy? Her A1c is 8.1.";

const markdown = readFileSync(
  resolve(process.cwd(), "../../packages/rag/corpus/type2-diabetes-management.md"),
  "utf8",
);
const chunks = chunkMarkdown({ id: "t2dm-management", markdown });
const index = await buildIndex(chunks, createCohereEmbed({ apiKey, inputType: "search_document" }));
const fused = await retrieveEvidence(query, index, createCohereEmbed({ apiKey, inputType: "search_query" }), {
  topK: 5,
});
const { snippets, reranked } = await rerankEvidence(query, fused, createCohereRerank({ apiKey }), { topN: 3 });

console.log(`\nQuery: ${query}`);
console.log(`Indexed ${index.length} guideline chunks. Reranked=${reranked}. Top evidence:\n`);
for (const s of snippets) {
  console.log(`• [${s.score.toFixed(3)}] ${s.doc} › ${s.section}`);
  console.log(`    ${s.text.slice(0, 160).replace(/\s+/g, " ")}…\n`);
}
