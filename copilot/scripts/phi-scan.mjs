#!/usr/bin/env node
/**
 * phi-scan — deterministic PHI-leak guard (NO LLM, offline).
 *
 * Target (a): a SOURCE scan for the logging antipattern the `error-handling-and-logging` rule
 * forbids — string-INTERPOLATED variables in a structured-logger call. Pino's contract is
 * `log.level(contextObject, message)`; a template literal with `${…}` in EITHER argument
 * position smuggles a variable (potentially PHI/secrets) into the log message instead of into
 * the queryable, redactable context object. That is exactly the "Bad" example in the rule.
 *
 * Why (a) over (b) — a log-STREAM scan via `noPhiInLogs`: a source scan needs no captured logs
 * and no running agent, so it is a stable REPO GUARD that catches the antipattern at the point
 * of introduction (a new interpolated log line fails CI) rather than hoping a sampled log stream
 * happened to exercise the leaky path. Fully deterministic + offline, per `w2-eval-gate`.
 *
 * Detects calls to `<logger>.<level>( … )` where `<level>` ∈ {trace,debug,info,warn,error,fatal}
 * and a TOP-LEVEL (message-position) argument is a template literal that interpolates
 * (`` `…${…}…` ``). Precision matters so the gate does not fire on legitimate code:
 *   - `console.*` is EXCLUDED — the rule targets the structured logger (pino / PSR-3), not the
 *     startup/CLI `console`. `console.error(\`…\`)` in a script is a different concern.
 *   - A template literal nested INSIDE a context object (`log.info({ f: \`v:${x}\` }, 'msg')`) is
 *     NOT flagged — that is a structured field value, which is the CORRECT pattern. Only a template
 *     in the message position (`log.error(\`…${x}…\`)` or `log.error(ctx, \`…${x}…\`)`) is the leak.
 *
 * Reports every hit as `file:line` with the offending snippet and exits non-zero on any hit
 * (exit 0 when clean).
 *
 * Usage:
 *   node scripts/phi-scan.mjs              # scan apps/ + packages/ src, exit 1 on any hit
 *   node scripts/phi-scan.mjs --self-test  # prove the detector trips on a bad line, else exit 1
 *   node scripts/phi-scan.mjs <dir> …      # scan explicit roots instead of the defaults
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const COPILOT_ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_ROOTS = ["apps", "packages"];
const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"];
const SCAN_EXTENSIONS = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".turbo", "coverage", ".git"]);

/**
 * A `<receiver>.<level>(` call opener, capturing the receiver identifier so `console.*` can be
 * excluded — e.g. matches `log.error(`, `request.log.warn(` (receiver `log`), `logger.info(`,
 * `this.logger.debug(` (receiver `logger`); the receiver of `console.warn(` is `console`.
 */
const LOG_CALL_OPENER = new RegExp(String.raw`(\w+)\.(?:${LOG_LEVELS.join("|")})\s*\(`, "g");

/**
 * Given source text and the index of the `(` that opens a call, return the argument text up to the
 * matching `)`, tracking nesting through parens, strings, and template literals so a `)` inside a
 * string/`${…}` does not end the span early. Returns null if unbalanced (truncated file).
 */
function readCallArgs(text, openParenIndex) {
  let depth = 0;
  let i = openParenIndex;
  const start = openParenIndex + 1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0) {
        return text.slice(start, i);
      }
    } else if (ch === '"' || ch === "'") {
      // Skip a normal string literal wholesale (handles escaped quotes).
      i++;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") i++;
        i++;
      }
    } else if (ch === "`") {
      // Skip a template literal, but a nested `${ … }` re-enters normal code (may contain `)`),
      // so track brace depth inside the interpolation rather than skipping to the next backtick.
      i++;
      while (i < text.length && text[i] !== "`") {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === "$" && text[i + 1] === "{") {
          let braces = 1;
          i += 2;
          while (i < text.length && braces > 0) {
            if (text[i] === "{") braces++;
            else if (text[i] === "}") braces--;
            i++;
          }
          continue;
        }
        i++;
      }
    }
  }
  return null;
}

/**
 * True if a TOP-LEVEL argument of the call (i.e. the message position — not nested inside an
 * object/array/call) is a template literal that interpolates a value (`` `…${…}…` ``). A template
 * nested inside a context object is a structured field value and is deliberately NOT flagged.
 */
function hasInterpolatedMessageArg(args) {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (ch === "(") paren++;
    else if (ch === ")") paren--;
    else if (ch === "{") brace++;
    else if (ch === "}") brace--;
    else if (ch === "[") bracket++;
    else if (ch === "]") bracket--;
    else if (ch === '"' || ch === "'") {
      i++;
      while (i < args.length && args[i] !== ch) {
        if (args[i] === "\\") i++;
        i++;
      }
    } else if (ch === "`") {
      const topLevel = paren === 0 && brace === 0 && bracket === 0;
      let interpolates = false;
      i++;
      while (i < args.length && args[i] !== "`") {
        if (args[i] === "\\") {
          i += 2;
          continue;
        }
        if (args[i] === "$" && args[i + 1] === "{") {
          interpolates = true;
          // Consume the interpolation so its `)`/`}` don't corrupt depth tracking.
          let braces = 1;
          i += 2;
          while (i < args.length && braces > 0) {
            if (args[i] === "{") braces++;
            else if (args[i] === "}") braces--;
            i++;
          }
          continue;
        }
        i++;
      }
      if (topLevel && interpolates) {
        return true; // interpolation in the message position — the leak antipattern
      }
    }
  }
  return false;
}

/** Line number (1-based) for a character offset. */
function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/**
 * Scan one file's text. Returns an array of hits `{ line, snippet }` — one per interpolated log call.
 * Pure + exported so it is unit-/self-testable without touching the filesystem.
 */
export function scanText(text) {
  const hits = [];
  LOG_CALL_OPENER.lastIndex = 0;
  let match;
  while ((match = LOG_CALL_OPENER.exec(text)) !== null) {
    // Exclude `console.*` — the rule guards the structured logger, not the CLI/startup console.
    if (match[1] === "console") {
      continue;
    }
    const openParen = match.index + match[0].length - 1;
    const args = readCallArgs(text, openParen);
    if (args !== null && hasInterpolatedMessageArg(args)) {
      const line = lineOf(text, match.index);
      const snippet = `${match[0]}${args}`.replace(/\s+/g, " ").trim().slice(0, 160);
      hits.push({ line, snippet });
    }
  }
  return hits;
}

/** Recursively collect scannable source files under a directory. */
function collectFiles(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      collectFiles(full, out);
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      // Test files legitimately build assertion strings; the rule guards production log calls.
      const isTest = /\.(test|spec)\.[mc]?[jt]s$/.test(entry) || full.includes(`${sep}test${sep}`);
      if (!isTest) out.push(full);
    }
  }
  return out;
}

function runScan(roots) {
  const files = [];
  for (const root of roots) {
    collectFiles(join(COPILOT_ROOT, root), files);
  }
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const hit of scanText(text)) {
      findings.push({ file: relative(COPILOT_ROOT, file), ...hit });
    }
  }
  return findings;
}

/**
 * Self-test: the detector MUST trip on the message-interpolation antipattern and MUST NOT trip on
 * the correct patterns (context object, `console.*`). Asserts both the catch and the precision, so
 * a future over-broadening (false positives) or a hole (false negatives) fails the gate. Exits
 * non-zero on any mismatch.
 */
function selfTest() {
  /** @type {{ label: string, src: string, expected: number }[]} */
  const cases = [
    // MUST trip — a variable interpolated into the log MESSAGE (the "Bad" rule example).
    { label: "message interpolation", src: "logger.error(`Failed to send message for ${phone}: ${e.message}`);", expected: 1 },
    // MUST trip — interpolation in the message when the message is the 2nd arg.
    { label: "message-as-2nd-arg interpolation", src: "log.error({ correlationId }, `lab fetch failed for ${pid}`);", expected: 1 },
    // MUST NOT trip — the correct pattern: context object + plain string message.
    { label: "context object (correct)", src: "logger.error({ phone, err: e }, 'Failed to send message');", expected: 0 },
    // MUST NOT trip — a template used as a structured FIELD VALUE inside the context object.
    { label: "template as a field value", src: "app.log.info({ model: `claude:${MODEL}` }, 'agent ready');", expected: 0 },
    // MUST NOT trip — `console.*` is not the structured logger the rule guards.
    { label: "console excluded", src: "console.warn(`disabled: ${String(error)}`);", expected: 0 },
  ];
  const failures = [];
  for (const c of cases) {
    const got = scanText(c.src).length;
    if (got !== c.expected) {
      failures.push(`  [${c.label}] expected ${c.expected} hit(s), got ${got}`);
    }
  }
  if (failures.length === 0) {
    console.log(`phi-scan --self-test: PASS (${cases.length} cases: catches message interpolation; excludes context objects, field values, and console).`);
    process.exit(0);
  }
  console.error("phi-scan --self-test: FAIL");
  for (const f of failures) console.error(f);
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) {
    selfTest();
    return;
  }
  const roots = args.length > 0 ? args : DEFAULT_ROOTS;
  const findings = runScan(roots);
  if (findings.length === 0) {
    console.log(`phi-scan: PASS — no interpolated logger calls found under ${roots.join(", ")}.`);
    process.exit(0);
  }
  console.error(`phi-scan: FAIL — ${findings.length} interpolated logger call(s) (PHI-leak antipattern):`);
  console.error("  Interpolating a variable into a log message can leak PHI/secrets and is not queryable.");
  console.error("  Use a PSR-3/pino context object instead: log.error({ key }, 'message').\n");
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.snippet}`);
  }
  process.exit(1);
}

// Only run the CLI when invoked directly (not when imported by a test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
