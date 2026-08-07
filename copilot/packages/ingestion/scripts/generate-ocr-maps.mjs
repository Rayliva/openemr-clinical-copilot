// Authoring-time script: OCR each committed W2 fixture PNG with in-process tesseract.js and
// write a committed word→coordinate map:
//   fixtures/w2/<name>.page-1.ocr.json   { words: [{ text, box:{page,x,y,w,h} }, ...] }
//
// This is the CI-offline half of the OCR decision (docs/decisions/w2-ocr-engine.md): the map
// is generated ONCE here (a reviewed golden) and committed, so the box-match runs with NO live
// OCR on the graded path. Boxes are [0,1]-normalized against the raster dimensions.
//
// tesseract.js is a devDependency ONLY — CI and the runtime pipeline read the committed
// *.ocr.json, never Tesseract. Not a test; not run in CI. Pinned engine (tesseract.js@7 + `eng`
// LSTM traineddata); regenerate rarely and REVIEW THE DIFF:
//   pnpm --filter @copilot/ingestion generate-ocr-maps
import { createWorker } from "tesseract.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(scriptDir, "../fixtures/w2");

/** Single-page synthetic documents (the demo fixtures are one page each). */
const fixtures = ["susan-lab-panel", "susan-intake-form"];

/** Read a PNG's pixel dimensions from its IHDR chunk (bytes 16–24, big-endian). */
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Clamp to [0,1] and round to 5 decimals for a stable committed diff. */
function norm(n, span) {
  // Surface an out-of-raster box during the "review the diff" step: clamping keeps the golden
  // schema-valid, but a value outside [0,span] means Tesseract pointed past the page edge.
  if (n < 0 || n > span) {
    console.warn(`  warn: pixel value ${n} outside [0, ${span}] — clamped (check the golden)`);
  }
  return Math.round(Math.min(1, Math.max(0, n / span)) * 1e5) / 1e5;
}

/** Flatten tesseract.js v7 block→paragraph→line→word tree into a flat word list. */
function flattenWords(data) {
  if (Array.isArray(data.words) && data.words.length > 0) {
    return data.words;
  }
  const out = [];
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        for (const w of l.words ?? []) {
          out.push(w);
        }
      }
    }
  }
  return out;
}

const worker = await createWorker("eng");
try {
  for (const name of fixtures) {
    const pngPath = resolve(fixturesDir, `${name}.page-1.png`);
    const { width, height } = pngSize(readFileSync(pngPath));

    const { data } = await worker.recognize(pngPath, {}, { blocks: true, text: true });
    const words = flattenWords(data)
      .map((w) => ({ text: (w.text ?? "").trim(), bbox: w.bbox }))
      // Drop empty/whitespace-only tokens — they carry no matchable text.
      .filter((w) => w.text !== "" && w.bbox)
      .map((w) => ({
        text: w.text,
        box: {
          page: 1,
          x: norm(w.bbox.x0, width),
          y: norm(w.bbox.y0, height),
          w: norm(w.bbox.x1 - w.bbox.x0, width),
          h: norm(w.bbox.y1 - w.bbox.y0, height),
        },
      }));

    const outPath = resolve(fixturesDir, `${name}.page-1.ocr.json`);
    writeFileSync(outPath, JSON.stringify({ words }, null, 2) + "\n");
    console.log(`generated ${name}.page-1.ocr.json (${words.length} words, ${width}x${height})`);
  }
} finally {
  await worker.terminate();
}
