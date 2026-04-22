import type { TemplateContext } from '../types';

export function generateAskUserFormat(_ctx: TemplateContext): string {
  return `## AskUserQuestion Format

**ALWAYS follow this structure for every AskUserQuestion call:**
1. **Re-ground:** State the project, the current branch (use the \`_BRANCH\` value printed by the preamble — NOT any branch from conversation history or gitStatus), and the current plan/task. (1-2 sentences)
2. **Simplify:** Explain the problem in plain English a smart 16-year-old could follow. No raw function names, no internal jargon, no implementation details. Use concrete examples and analogies. Say what it DOES, not what it's called.
3. **Recommend (ALWAYS):** Every question ends with \`RECOMMENDATION: Choose [X] because [one-line reason]\`. Never omit this line. It is required for every AskUserQuestion, regardless of whether the options are coverage-differentiated or different-in-kind.
4. **Score completeness (when meaningful):** When options differ in coverage (e.g. full test coverage vs happy path vs shortcut, complete error handling vs partial), score each with \`Completeness: N/10\` on its own line. Calibration: 10 = complete (all edge cases, full coverage), 7 = happy path only, 3 = shortcut. Flag any option ≤5 where a higher-completeness option exists. When options differ in kind (picking a review posture, picking an architectural approach, cherry-pick Add/Defer/Skip, choosing between two different kinds of systems), the completeness axis doesn't apply — skip \`Completeness: N/10\` entirely and write one line: \`Note: options differ in kind, not coverage — no completeness score.\` Do not fabricate filler scores.
5. **Options:** Lettered options: \`A) ... B) ... C) ...\` — when an option involves effort, show both scales: \`(human: ~X / CC: ~Y)\`

Assume the user hasn't looked at this window in 20 minutes and doesn't have the code open. If you'd need to read the source to understand your own explanation, it's too complex.

Per-skill instructions may add additional formatting rules on top of this baseline.`;
}

