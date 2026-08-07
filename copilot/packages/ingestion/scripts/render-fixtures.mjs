// Authoring-time script: render each W2 HTML fixture to two committed artifacts —
//   <name>.pdf         the realistic source document (front-desk upload / demo / record)
//   <name>.page-1.png  the per-page raster the pipeline consumes (VLM + OCR + overlay)
//
// The HTML stays the human-editable source of truth (its values are drift-guarded against
// the ground-truth JSON in fixtures.test.ts); re-run this after editing an HTML fixture:
//   pnpm --filter @copilot/ingestion render-fixtures
//
// Playwright is an authoring-time devDependency ONLY — CI and the runtime pipeline read the
// committed PNG/PDF, never Chromium. Not a test; not run in CI.
import { chromium } from "playwright";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(scriptDir, "../fixtures/w2");

/** Single-page synthetic documents (the demo fixtures are one page each). */
const fixtures = ["susan-lab-panel", "susan-intake-form"];

// US Letter at 96 CSS px/in, so the PNG raster matches the PDF page geometry.
const VIEWPORT = { width: 816, height: 1056 };

const browser = await chromium.launch();
try {
  for (const name of fixtures) {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    const htmlUrl = pathToFileURL(resolve(fixturesDir, `${name}.html`)).href;
    await page.goto(htmlUrl, { waitUntil: "networkidle" });

    // The page raster the VLM / OCR / overlay all read.
    await page.screenshot({ path: resolve(fixturesDir, `${name}.page-1.png`), fullPage: true });

    // The source-of-record document (a scanned lab report IS a PDF). printBackground keeps
    // the colored abnormal-flag styling so the demo/overlay looks like a real report.
    await page.pdf({
      path: resolve(fixturesDir, `${name}.pdf`),
      format: "Letter",
      printBackground: true,
      margin: { top: "0.5in", bottom: "0.5in", left: "0.5in", right: "0.5in" },
    });

    await page.close();
    console.log(`rendered ${name} → ${name}.pdf + ${name}.page-1.png`);
  }
} finally {
  await browser.close();
}
