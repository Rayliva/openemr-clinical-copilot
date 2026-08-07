// Authoring-time script: render each demo HTML document in this folder to a matching
// <name>.pdf — the realistic source document a physician would upload into the
// Clinical Co-Pilot document-ingestion flow.
//
// Modeled on packages/ingestion/scripts/render-fixtures.mjs. These are SYNTHETIC demo
// upload documents (not eval fixtures). Re-run after editing any HTML:
//   cd copilot && pnpm --filter @copilot/ingestion exec node ../demo-documents/render-demo-docs.mjs
//
// Playwright is an authoring-time devDependency of @copilot/ingestion only.
import { createRequire } from "node:module";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync } from "node:fs";

const scriptDir = dirname(fileURLToPath(import.meta.url));

// Playwright is an authoring-time devDependency of @copilot/ingestion only. This
// script lives outside that package, so resolve playwright from the package root
// rather than relying on Node's directory-walk from this file's location.
const requireFromIngestion = createRequire(
  resolve(scriptDir, "../packages/ingestion/package.json"),
);
const { chromium } = requireFromIngestion("playwright");

// Every *.html in this folder renders to a matching *.pdf.
const htmlFiles = readdirSync(scriptDir)
  .filter((f) => f.endsWith(".html"))
  .sort();

// US Letter at 96 CSS px/in.
const VIEWPORT = { width: 816, height: 1056 };

const browser = await chromium.launch();
try {
  for (const file of htmlFiles) {
    const name = basename(file, ".html");
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const htmlUrl = pathToFileURL(resolve(scriptDir, file)).href;
    await page.goto(htmlUrl, { waitUntil: "networkidle" });

    await page.pdf({
      path: resolve(scriptDir, `${name}.pdf`),
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
    });

    await page.close();
    console.log(`rendered ${name} → ${name}.pdf`);
  }
} finally {
  await browser.close();
}
