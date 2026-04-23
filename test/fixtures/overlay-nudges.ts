/**
 * Overlay-efficacy fixture registry.
 *
 * Each fixture defines a reproducible A/B test for one behavioral nudge
 * embedded in a model-overlays/*.md file. The harness at
 * test/skill-e2e-overlay-harness.test.ts iterates this registry and runs
 * `fixture.trials` A/B trials per fixture, asserting `fixture.pass(arms)`.
 *
 * Adding a new overlay eval = one entry in this list. The harness handles
 * arm wiring, concurrency, artifact storage, rate-limit retries, and the
 * cross-harness diagnostic.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  firstTurnParallelism,
  type AgentSdkResult,
} from '../helpers/agent-sdk-runner';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OverlayFixture {
  /** Unique, lowercase/digits/dash only. Used in artifact paths. */
  id: string;
  /** Path to the overlay file, relative to repo root. */
  overlayPath: string;
  /** API model ID, not the overlay family name. */
  model: string;
  /** Integer >= 3. Trials per arm. */
  trials: number;
  /** Max concurrent queries for this fixture's arms. Default 3. */
  concurrency?: number;
  /** Populate the workspace dir before each trial. */
  setupWorkspace: (dir: string) => void;
  /** The prompt the model receives. Non-empty. */
  userPrompt: string;
  /** Compute the per-trial metric from the typed SDK result. */
  metric: (r: AgentSdkResult) => number;
  /** Acceptance predicate across all arms' per-trial metrics. */
  pass: (arms: { overlay: number[]; off: number[] }) => boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateFixtures(fixtures: OverlayFixture[]): void {
  const ids = new Set<string>();
  for (const f of fixtures) {
    if (!f.id || !/^[a-z0-9-]+$/.test(f.id)) {
      throw new Error(
        `fixture id must be non-empty, lowercase/digits/dash only: ${JSON.stringify(f.id)}`,
      );
    }
    if (ids.has(f.id)) {
      throw new Error(`duplicate fixture id: ${f.id}`);
    }
    ids.add(f.id);

    if (!Number.isInteger(f.trials) || f.trials < 3) {
      throw new Error(`${f.id}: trials must be an integer >= 3 (got ${f.trials})`);
    }
    if (
      f.concurrency !== undefined &&
      (!Number.isInteger(f.concurrency) || f.concurrency < 1)
    ) {
      throw new Error(
        `${f.id}: concurrency must be an integer >= 1 (got ${f.concurrency})`,
      );
    }

    if (!f.model) throw new Error(`${f.id}: model must be non-empty`);
    if (!f.userPrompt) throw new Error(`${f.id}: userPrompt must be non-empty`);

    if (path.isAbsolute(f.overlayPath) || f.overlayPath.includes('..')) {
      throw new Error(
        `${f.id}: overlayPath must be relative and must not contain '..' (got ${f.overlayPath})`,
      );
    }
    const fullPath = path.resolve(REPO_ROOT, f.overlayPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`${f.id}: overlay file not found at ${f.overlayPath}`);
    }

    for (const fn of ['setupWorkspace', 'metric', 'pass'] as const) {
      if (typeof f[fn] !== 'function') {
        throw new Error(`${f.id}: ${fn} must be a function`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Metric + predicate helpers
// ---------------------------------------------------------------------------

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Standard fanout predicate: overlay mean beats off mean by at least 0.5
 * parallel tool_use blocks in first turn, AND at least 3 of the overlay
 * trials emit >= 2 parallel tool_use blocks.
 *
 * The combined rule catches both "overlay nudges every trial slightly"
 * (mean) and "overlay sometimes triggers real fanout" (floor). A single
 * 0.5 lift with every trial still emitting 1 call would be suspicious;
 * this predicate rejects it.
 */
export function fanoutPass(arms: { overlay: number[]; off: number[] }): boolean {
  const lift = mean(arms.overlay) - mean(arms.off);
  const floorHits = arms.overlay.filter((n) => n >= 2).length;
  return lift >= 0.5 && floorHits >= 3;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const OVERLAY_FIXTURES: OverlayFixture[] = [
  {
    id: 'opus-4-7-fanout-toy',
    overlayPath: 'model-overlays/opus-4-7.md',
    model: 'claude-opus-4-7',
    trials: 10,
    concurrency: 3,
    setupWorkspace: (dir) => {
      fs.writeFileSync(path.join(dir, 'alpha.txt'), 'Alpha file: used in module A.\n');
      fs.writeFileSync(path.join(dir, 'beta.txt'), 'Beta file: used in module B.\n');
      fs.writeFileSync(path.join(dir, 'gamma.txt'), 'Gamma file: used in module C.\n');
    },
    userPrompt:
      'Read alpha.txt, beta.txt, and gamma.txt and summarize each in one line.',
    metric: (r) => firstTurnParallelism(r.assistantTurns[0]),
    pass: fanoutPass,
  },
  {
    id: 'opus-4-7-fanout-realistic',
    overlayPath: 'model-overlays/opus-4-7.md',
    model: 'claude-opus-4-7',
    trials: 10,
    concurrency: 3,
    setupWorkspace: (dir) => {
      fs.writeFileSync(
        path.join(dir, 'app.ts'),
        "import { config } from './config';\nimport { util } from './src/util';\n\nexport function main() { return config.name + ':' + util(); }\n",
      );
      fs.writeFileSync(
        path.join(dir, 'config.ts'),
        "export const config = { name: 'demo', version: 1 };\n",
      );
      fs.writeFileSync(
        path.join(dir, 'README.md'),
        '# demo project\n\nA small demo. Entry: `app.ts`. Config: `config.ts`.\n',
      );
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'src', 'util.ts'),
        "export function util() { return 'util-result'; }\n",
      );
    },
    userPrompt:
      'Audit this project: read app.ts, config.ts, and README.md, and glob for ' +
      'every .ts file under src/. Summarize what you find in 3 bullet points.',
    metric: (r) => firstTurnParallelism(r.assistantTurns[0]),
    pass: fanoutPass,
  },
];

// Validate at module load so a broken fixture fails fast at test startup,
// not mid-run after burning API dollars.
validateFixtures(OVERLAY_FIXTURES);
