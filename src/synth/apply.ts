import type { GeneratorCatalog } from './catalog';
import { estimateCost, fitsBudget } from './cost';
import { parsePatch } from './schema';
import type { RenderBudget, VisualPatch } from './types';
import { type ValidationIssue, validatePatch } from './validate';

export interface ProposalResult {
  ok: boolean;
  patch?: VisualPatch;
  issues: ValidationIssue[];
}

/** 未検証の入力 (JSON.parse 済み unknown) を検証済み Patch にするゲート。 */
export function gatePatchProposal(
  input: unknown,
  catalog: GeneratorCatalog,
  budget: RenderBudget,
): ProposalResult {
  const parsed = parsePatch(input);
  if (!parsed.ok) {
    return {
      ok: false,
      issues: parsed.issues.map((message) => ({ code: 'schema', message })),
    };
  }

  const validationIssues = validatePatch(parsed.patch, catalog);
  if (validationIssues.length > 0) {
    return { ok: false, issues: validationIssues };
  }

  const budgetIssues = fitsBudget(estimateCost(parsed.patch, catalog), budget);
  if (budgetIssues.length > 0) {
    return { ok: false, issues: budgetIssues };
  }

  return { ok: true, patch: parsed.patch, issues: [] };
}
