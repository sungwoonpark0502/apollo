/**
 * C21.2 agent eval harness: real orchestrator + real system prompt + real LLM,
 * tool executors mocked to canned results. Asserts tool usage (order-insensitive),
 * arg subset match, and reply constraints. Prints pass rate; CI threshold 90%.
 * Without ANTHROPIC_API_KEY it reports SKIPPED and exits 0 (C22).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DateTime } from 'luxon';
import type { AgentEvent } from '@apollo/shared';
import { openDb } from '../apps/desktop/src/main/db/connection';
import { migrate } from '../apps/desktop/src/main/db/migrate';
import { createRepos } from '../apps/desktop/src/main/db/repos/index';
import { createRegistry } from '../apps/desktop/src/main/tools/registry';
import { createOrchestrator } from '../apps/desktop/src/main/agent/orchestrator';
import { buildSystemPrompt } from '../apps/desktop/src/main/agent/systemPrompt';
import { createAnthropicLlm } from '../apps/desktop/src/main/agent/llmAnthropic';
import { parseDotEnv } from '../apps/desktop/src/main/config';
import { buildEvalTools, type RecordedCall } from './toolCatalog';

interface GoldenRow {
  id: string;
  utterance: string;
  prior_user?: string; // H5: a preceding user turn in the SAME conversation (follow-up continuity)
  expect_tools?: Array<{ name: string; args_like?: Record<string, unknown> }>;
  forbid_tools?: string[];
  reply_must_include?: string;
  forbid_bare_refusal?: boolean;
  confirm?: 'approve' | 'deny';
}

const ROOT = dirname(fileURLToPath(import.meta.url));
// Reference now matches C11 examples: Saturday 2026-07-11 10:00 America/Los_Angeles.
const NOW = DateTime.fromObject({ year: 2026, month: 7, day: 11, hour: 10 }, { zone: 'America/Los_Angeles' }).toMillis();
const REFUSAL_RE = /can'?t|cannot|unable|not able to/i;

function subsetMatch(expected: unknown, actual: unknown): boolean {
  if (typeof expected === 'string') {
    return typeof actual === 'string' && actual.toLowerCase().includes(expected.toLowerCase());
  }
  if (typeof expected === 'number' || typeof expected === 'boolean') return actual === expected;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return false;
    return expected.every((e) => actual.some((a) => subsetMatch(e, a)));
  }
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object') return false;
    return Object.entries(expected).every(([k, v]) => subsetMatch(v, (actual as Record<string, unknown>)[k]));
  }
  return true;
}

async function runRow(row: GoldenRow, apiKey: string, model: string): Promise<{ pass: boolean; detail: string }> {
  const calls: RecordedCall[] = [];
  const events: AgentEvent[] = [];
  const db = openDb(':memory:');
  migrate(db);
  const repos = createRepos(db);
  const registry = createRegistry(buildEvalTools(calls));
  const llm = createAnthropicLlm({ apiKey: () => apiKey, model: () => model });

  const orch = createOrchestrator({
    registry,
    repos,
    llm,
    systemPrompt: () => buildSystemPrompt('James'),
    emit: (e) => {
      events.push(e);
      if (e.type === 'confirmRequest') {
        // resolve confirmations per row policy (default deny keeps rows hermetic)
        setTimeout(() => void orch.confirm(e.confirmationId, row.confirm === 'approve'), 0);
      }
    },
    tz: () => 'America/Los_Angeles',
    historyEnabled: () => true,
    now: () => NOW,
    cancelWindowMs: 10,
  });

  const convId = `eval-${row.id}`;
  // H5: play a prior user turn first so the graded utterance resolves via context.
  if (row.prior_user) {
    const pre = orch.handleUserMessage({ text: row.prior_user, source: 'text', convId });
    await pre.completion;
    await new Promise((r) => setTimeout(r, 50));
    calls.length = 0; // only grade tools from the follow-up turn
    events.length = 0;
  }
  const { completion } = orch.handleUserMessage({ text: row.utterance, source: 'text', convId });
  await completion;
  await new Promise((r) => setTimeout(r, 300)); // allow confirm resume to finish
  await new Promise((r) => setTimeout(r, 0));

  const reply = events.filter((e): e is Extract<AgentEvent, { type: 'token' }> => e.type === 'token').map((e) => e.text).join('');
  const problems: string[] = [];

  for (const exp of row.expect_tools ?? []) {
    const hit = calls.find((c) => c.name === exp.name && (!exp.args_like || subsetMatch(exp.args_like, c.args)));
    if (!hit) {
      const sameName = calls.filter((c) => c.name === exp.name);
      problems.push(
        sameName.length
          ? `args mismatch for ${exp.name}: wanted ⊇ ${JSON.stringify(exp.args_like)}, got ${JSON.stringify(sameName.map((c) => c.args))}`
          : `missing tool ${exp.name} (called: ${calls.map((c) => c.name).join(', ') || 'none'})`,
      );
    }
  }
  for (const f of row.forbid_tools ?? []) {
    if (calls.some((c) => c.name === f)) problems.push(`forbidden tool ${f} was executed`);
  }
  if (row.reply_must_include && !reply.toLowerCase().includes(row.reply_must_include.toLowerCase())) {
    problems.push(`reply missing "${row.reply_must_include}": ${reply.slice(0, 120)}`);
  }
  if (row.forbid_bare_refusal && calls.length === 0 && REFUSAL_RE.test(reply) && reply.length < 220) {
    problems.push(`bare refusal: ${reply.slice(0, 120)}`);
  }
  return { pass: problems.length === 0, detail: problems.join(' | ') };
}

async function main(): Promise<void> {
  const env = { ...parseDotEnv(safeRead(join(ROOT, '..', '.env'))), ...process.env } as Record<string, string | undefined>;
  const apiKey = env['ANTHROPIC_API_KEY'];
  const model = env['ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6';
  const rows = readFileSync(join(ROOT, 'golden.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GoldenRow);

  console.log(`eval: ${rows.length} rows, model ${model}`);
  if (!apiKey) {
    console.log('eval: SKIPPED — no ANTHROPIC_API_KEY available (C22). Add a key and run `pnpm eval`.');
    process.exit(0);
  }

  const threshold = Number(env['EVAL_THRESHOLD'] ?? 90);
  const only = env['EVAL_ONLY'];
  const selected = only ? rows.filter((r) => r.id.startsWith(only)) : rows;

  let passed = 0;
  const failures: string[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < selected.length; i += CONCURRENCY) {
    const batch = selected.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (row) => {
        try {
          return { row, ...(await runRow(row, apiKey, model)) };
        } catch (e) {
          return { row, pass: false, detail: `crashed: ${e instanceof Error ? e.message : String(e)}` };
        }
      }),
    );
    for (const r of results) {
      if (r.pass) {
        passed++;
        console.log(`  ✓ ${r.row.id}`);
      } else {
        failures.push(`${r.row.id}: ${r.detail}`);
        console.log(`  ✗ ${r.row.id} — ${r.detail}`);
      }
    }
  }

  const rate = (passed / selected.length) * 100;
  console.log(`\neval: ${passed}/${selected.length} passed (${rate.toFixed(1)}%), threshold ${threshold}%`);
  if (failures.length) console.log(`failures:\n  ${failures.join('\n  ')}`);
  process.exit(rate >= threshold ? 0 : 1);
}

function safeRead(p: string): string {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

void main();
