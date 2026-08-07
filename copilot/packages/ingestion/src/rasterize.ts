import type { PageImage } from "./extract.js";

/**
 * The injected boundary that turns an uploaded PDF's bytes into page rasters — the input both the
 * VLM (`VlmExtractPort`) and the OCR (`OcrPort`) consume, so one rasterization serves both. The
 * concrete engine (`pdfjs-dist` + `@napi-rs/canvas`, `docs/decisions/w2-pdf-rasterizer.md`) lives at
 * the edge in `apps/agent`; `@copilot/ingestion` owns only the contract (`orchestrator-only`).
 *
 * Returns one {@link PageImage} per page in page order (1-based `page`, base64 PNG).
 */
export type PdfRasterizePort = (pdf: Uint8Array) => Promise<readonly PageImage[]>;
