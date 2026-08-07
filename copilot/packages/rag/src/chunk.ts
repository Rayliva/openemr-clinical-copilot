import type { GuidelineChunk } from "./contracts.js";

/**
 * Pure markdown chunking for the guideline corpus: split by section (heading boundaries), retain
 * the section heading + doc id on every chunk, and split a long section into overlapping windows
 * so a recommendation spanning a boundary is not lost. Deterministic `chunkId`s → idempotent
 * re-chunking (`w2-hybrid-rag`). No embeddings here.
 */

export interface MarkdownDoc {
  readonly id: string;
  readonly markdown: string;
}

export interface ChunkOptions {
  /** Target window size in characters (default 800). */
  readonly targetChars?: number;
  /** Overlap between adjacent windows in characters (default 120). */
  readonly overlapChars?: number;
}

const DEFAULT_TARGET = 800;
const DEFAULT_OVERLAP = 120;

interface Section {
  readonly heading: string;
  readonly text: string;
}

/**
 * Split markdown into heading-delimited sections. Content before the first heading is skipped, as
 * are empty sections. **A level-1 (`#`) heading is treated as the document title, not retrievable
 * content** — its body (e.g. a corpus-provenance disclaimer) is NOT chunked, so it can never
 * surface as guideline "evidence." Corpus convention: `#` = doc title, `##`+ = content sections.
 */
function splitSections(markdown: string): Section[] {
  const sections: Section[] = [];
  let heading: string | null = null;
  let level = 0;
  let body: string[] = [];

  const flush = (): void => {
    if (heading !== null && level > 1 && body.join("\n").trim().length > 0) {
      sections.push({ heading, text: body.join("\n").trim() });
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (match !== null) {
      flush();
      level = match[1]?.length ?? 0;
      // Strip an optional ATX closing sequence ("## Heading ##" → "Heading").
      heading = (match[2] ?? "").replace(/\s+#+\s*$/, "").trim();
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

/** Split a section's text into overlapping windows, each no larger than `target`. */
function splitWindows(text: string, target: number, overlap: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= target) {
    return [trimmed];
  }
  const step = Math.max(1, target - overlap);
  const windows: string[] = [];
  for (let start = 0; start < trimmed.length; start += step) {
    windows.push(trimmed.slice(start, start + target));
    if (start + target >= trimmed.length) {
      break;
    }
  }
  return windows;
}

export function chunkMarkdown(doc: MarkdownDoc, options: ChunkOptions = {}): GuidelineChunk[] {
  // Clamp to a sane positive window so a degenerate targetChars≤0 can't emit empty-text chunks.
  const target = Math.max(1, options.targetChars ?? DEFAULT_TARGET);
  const overlap = Math.max(0, options.overlapChars ?? DEFAULT_OVERLAP);
  const chunks: GuidelineChunk[] = [];

  splitSections(doc.markdown).forEach((section, sectionIndex) => {
    splitWindows(section.text, target, overlap).forEach((text, windowIndex) => {
      chunks.push({
        chunkId: `${doc.id}::${sectionIndex}::${windowIndex}`,
        doc: doc.id,
        section: section.heading,
        text,
      });
    });
  });
  return chunks;
}
