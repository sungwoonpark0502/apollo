import { zodToJsonSchema } from 'zod-to-json-schema';
import { AppError, isDiskFullError, type ToolCtx, type ToolDef, type ToolResult } from '@apollo/shared';

export interface AnthropicToolJson {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface RegistryOpts {
  perf?: (turnId: string, name: string, durMs: number) => void;
  log?: (msg: string) => void;
  /** Test hook: overrides the 15s/30s execution timeouts. */
  timeoutMsOverride?: number;
}

class ToolTimeoutError extends Error {
  constructor() {
    super('tool timed out');
    this.name = 'ToolTimeoutError';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ToolTimeoutError()), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export function createRegistry(tools: ToolDef[], opts: RegistryOpts = {}) {
  const map = new Map<string, ToolDef>();
  for (const t of tools) {
    if (map.has(t.name)) throw new Error(`duplicate tool ${t.name}`);
    map.set(t.name, t);
  }

  return {
    get(name: string): ToolDef | undefined {
      return map.get(name);
    },
    all(): ToolDef[] {
      return [...map.values()];
    },
    /** Tool JSON for the Anthropic API, generated from each tool's zod params. */
    anthropicTools(): AnthropicToolJson[] {
      return this.all().map((t) => {
        const schema = zodToJsonSchema(t.params, { $refStrategy: 'none' }) as Record<string, unknown>;
        delete schema['$schema'];
        return { name: t.name, description: t.description, input_schema: schema };
      });
    },
    /**
     * Validates args, enforces the 15s/30s timeout, records a perf span, and
     * converts every failure into a recoverable ToolResult (never throws).
     */
    async execute(name: string, rawArgs: unknown, ctx: ToolCtx): Promise<ToolResult> {
      const tool = map.get(name);
      if (!tool) return { llmText: `ERROR unknown tool ${name}` };
      const parsed = tool.params.safeParse(rawArgs);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return { llmText: `ERROR invalid arguments: ${issue ? `${issue.path.join('.')} ${issue.message}` : 'unparseable'}` };
      }
      const timeoutMs = opts.timeoutMsOverride ?? (tool.networked ? 30_000 : 15_000);
      const t0 = performance.now();
      try {
        return await withTimeout(tool.execute(parsed.data, ctx), timeoutMs);
      } catch (e) {
        if (e instanceof ToolTimeoutError) {
          opts.log?.(`tool ${name} timed out after ${timeoutMs}ms`);
          return { llmText: `ERROR ${name} timed out` };
        }
        // J3: a disk-full / write failure is not a recoverable tool error — abort the
        // turn honestly with DISK_FULL rather than feeding a raw SQLite message to the LLM.
        if (isDiskFullError(e)) {
          opts.log?.(`tool ${name} write failed: disk full`);
          throw new AppError('DISK_FULL', `${name} write failed`, e);
        }
        const msg = e instanceof Error ? e.message : 'unknown failure';
        opts.log?.(`tool ${name} threw: ${msg}`);
        return { llmText: `ERROR ${name} failed: ${msg}` };
      } finally {
        opts.perf?.(ctx.turnId, `tool:${name}`, performance.now() - t0);
      }
    },
  };
}

export type Registry = ReturnType<typeof createRegistry>;
