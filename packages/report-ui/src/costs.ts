import type { CostCatalogItem, CostLine, Modification } from './types';

/**
 * Deterministic catalog lookup (spec §15): totals come from the table, never a model.
 * Express should attach these server-side; this is the same logic for local-only mode.
 */
export function costLinesFromCatalog(modifications: Modification[], catalog: CostCatalogItem[]): CostLine[] {
  return modifications.flatMap((mod) => {
    const item = catalog.find((c) => c.type === mod.type);
    if (!item) return [];
    return [{
      modificationId: mod.id,
      title: item.title,
      lowUsd: item.lowUsd,
      highUsd: item.highUsd,
      basis: item.basis,
      status: 'illustrative' as const,
    }];
  });
}

export function totalCosts(costs: CostLine[]): { lowUsd: number; highUsd: number } {
  return costs.reduce(
    (sum, line) => ({ lowUsd: sum.lowUsd + line.lowUsd, highUsd: sum.highUsd + line.highUsd }),
    { lowUsd: 0, highUsd: 0 },
  );
}

export type BudgetFit = 'within' | 'may-exceed' | 'exceeds' | 'no-budget' | 'no-costs';

export function budgetFit(costs: CostLine[], max?: number): BudgetFit {
  if (costs.length === 0) return 'no-costs';
  if (max == null) return 'no-budget';
  const { lowUsd, highUsd } = totalCosts(costs);
  if (lowUsd > max) return 'exceeds';
  if (highUsd > max) return 'may-exceed';
  return 'within';
}
