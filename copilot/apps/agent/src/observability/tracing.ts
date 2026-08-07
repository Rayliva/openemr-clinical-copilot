import { AsyncLocalStorage } from "node:async_hooks";

/**
 * A minimal tracing abstraction so the graph and deps stay decoupled from any
 * specific backend (Langfuse lives behind this interface). Request-scoped: the
 * current tracer is carried in AsyncLocalStorage so nodes can emit spans without
 * threading it through every signature.
 */

export interface TraceSpan {
  /**
   * Open a CHILD span under this one (W2 span nesting). Optional so a minimal span double (a bare
   * `{ end }`) still satisfies the interface — when absent, a would-be child falls back to a
   * top-level span. The Langfuse span client implements it (`span.span(...)`).
   */
  span?(name: string, input?: unknown): TraceSpan;
  end(data?: { output?: unknown; error?: unknown }): void;
}

export interface TraceGeneration {
  end(data: {
    output?: unknown;
    usage?: { promptTokens?: number; completionTokens?: number; costUsd?: number };
  }): void;
}

export interface Tracer {
  span(name: string, input?: unknown): TraceSpan;
  generation(name: string, opts: { model: string; input?: unknown }): TraceGeneration;
  /** Close the root trace, recording the final output. */
  end(output?: unknown): void;
}

export interface RequestTracerFactory {
  start(opts: { name: string; correlationId: string; input?: unknown }): Tracer;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * The request-scoped tracing context: the tracer plus a map of long-lived "parent" spans that
 * outlive a single node invocation (the supervisor span parents the worker spans across hops). The
 * map is mutated in place and visible across the whole async subtree of one `withTracer` run — and
 * isolated between concurrent requests by AsyncLocalStorage.
 */
interface TraceContext {
  readonly tracer: Tracer;
  readonly parents: Map<string, TraceSpan>;
}

const store = new AsyncLocalStorage<TraceContext>();

/** Run `fn` with `tracer` as the current tracer for its whole async subtree. */
export function withTracer<T>(tracer: Tracer | undefined, fn: () => Promise<T>): Promise<T> {
  return tracer === undefined ? fn() : store.run({ tracer, parents: new Map() }, fn);
}

export function currentTracer(): Tracer | undefined {
  return store.getStore()?.tracer;
}

/**
 * Open (or return the already-open) long-lived parent span under `key`. Idempotent per key so a node
 * that runs once per hop (the supervisor) reuses one span across hops. Returns undefined when no
 * tracer is active. End it with {@link endParentSpan}.
 */
export function openParentSpan(key: string, name: string, input?: unknown): TraceSpan | undefined {
  const ctx = store.getStore();
  if (ctx === undefined) {
    return undefined;
  }
  const existing = ctx.parents.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const span = ctx.tracer.span(name, input);
  ctx.parents.set(key, span);
  return span;
}

/** End the parent span under `key` (if open) and drop it, so a later run opens a fresh one. */
export function endParentSpan(key: string, data?: { output?: unknown; error?: unknown }): void {
  const ctx = store.getStore();
  const span = ctx?.parents.get(key);
  span?.end(data);
  ctx?.parents.delete(key);
}

/**
 * Open a span CHILD of the open parent under `parentKey` — the W2 worker-under-supervisor nesting.
 * Falls back to a top-level span when the parent isn't open (or the tracer's span type can't nest),
 * and to undefined when no tracer is active. Never throws.
 */
export function childSpan(parentKey: string, name: string, input?: unknown): TraceSpan | undefined {
  const ctx = store.getStore();
  if (ctx === undefined) {
    return undefined;
  }
  const parent = ctx.parents.get(parentKey);
  if (parent?.span !== undefined) {
    return parent.span(name, input);
  }
  return ctx.tracer.span(name, input);
}

/** Wrap an async step in a span (no-op when there is no current tracer). */
export async function tracedSpan<T>(
  name: string,
  input: unknown,
  fn: () => Promise<T>,
  summarize?: (result: T) => unknown,
): Promise<T> {
  const span = currentTracer()?.span(name, input);
  try {
    const result = await fn();
    span?.end({ output: summarize ? summarize(result) : undefined });
    return result;
  } catch (error) {
    span?.end({ error });
    throw error;
  }
}
