import { Langfuse } from "langfuse";
import type { RequestTracerFactory, TraceSpan, Tracer } from "./tracing.js";

/** A Langfuse span client can spawn child spans; this is the slice we use. */
interface LangfuseSpanLike {
  span(opts: { name: string; input?: unknown }): LangfuseSpanLike;
  end(opts: { output?: unknown; level?: "ERROR"; statusMessage?: string }): void;
}

/** Wrap a Langfuse span client as a {@link TraceSpan}, supporting child spans (W2 nesting). */
function wrapSpan(span: LangfuseSpanLike): TraceSpan {
  return {
    span(childName, childInput) {
      return wrapSpan(span.span({ name: childName, input: childInput }));
    },
    end(data) {
      if (data?.error !== undefined) {
        span.end({ level: "ERROR", statusMessage: errorMessage(data.error) });
      } else {
        span.end({ output: data?.output });
      }
    },
  };
}

export interface LangfuseConfig {
  readonly host: string;
  readonly publicKey: string;
  readonly secretKey: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Langfuse-backed tracer factory. Each request gets a trace keyed by the
 * correlation id; nodes emit spans and the LLM step a generation (with token
 * usage + cost). Self-hosted, so PHI-bearing spans stay in-boundary.
 */
export function createLangfuseTracerFactory(config: LangfuseConfig): RequestTracerFactory {
  const client = new Langfuse({
    baseUrl: config.host,
    publicKey: config.publicKey,
    secretKey: config.secretKey,
  });

  return {
    start({ name, correlationId, input }): Tracer {
      const trace = client.trace({
        name,
        sessionId: correlationId,
        metadata: { correlationId },
        input,
      });

      return {
        span(spanName, spanInput) {
          // Library-boundary narrowing: the Langfuse SDK types `trace.span(...)` more loosely than
          // the `LangfuseSpanLike` surface we depend on. Local, unavoidable cast at the SDK edge.
          return wrapSpan(trace.span({ name: spanName, input: spanInput }) as LangfuseSpanLike);
        },
        generation(genName, opts) {
          const generation = trace.generation({
            name: genName,
            model: opts.model,
            input: opts.input,
          });
          return {
            end(data) {
              generation.end({
                output: data.output,
                ...(data.usage !== undefined
                  ? {
                      usage: {
                        input: data.usage.promptTokens ?? null,
                        output: data.usage.completionTokens ?? null,
                        unit: "TOKENS" as const,
                        totalCost: data.usage.costUsd ?? null,
                      },
                    }
                  : {}),
              });
            },
          };
        },
        end(output) {
          trace.update({ output });
        },
      };
    },
    async flush() {
      await client.flushAsync();
    },
    async shutdown() {
      await client.shutdownAsync();
    },
  };
}
