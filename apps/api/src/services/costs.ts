import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  catalogResponseSchema, costCatalogSchema, costEstimateSchema, costModificationsSchema,
  type CostCatalog, type CostEstimate,
} from '../schemas/costs.js';

export class CostCatalogError extends Error {}

export async function loadCostCatalog(): Promise<CostCatalog> {
  try {
    const file = process.env.ADAPT_DATA_DIR
      ? resolve(process.env.ADAPT_DATA_DIR, 'sample-cost-catalog.json')
      : new URL('../../../../data/sample-cost-catalog.json', import.meta.url);
    return costCatalogSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    throw new CostCatalogError('Illustrative cost catalog is unavailable.');
  }
}

export async function getCostCatalog() {
  const { items, updatedAt, limitations } = await loadCostCatalog();
  return catalogResponseSchema.parse({ items, updatedAt, limitations });
}

export async function estimateModificationCosts(input: unknown, catalogInput?: unknown): Promise<CostEstimate> {
  const modifications = costModificationsSchema.parse(input);
  const catalog = catalogInput === undefined ? await loadCostCatalog() : costCatalogSchema.parse(catalogInput);
  const costs: CostEstimate['costs'] = [];
  const unpricedWork: CostEstimate['unpricedWork'] = [];
  const professionalEstimates: CostEstimate['professionalEstimates'] = [];
  let lowCents = 0;
  let highCents = 0;
  for (const modification of modifications) {
    const item = catalog.items.find((item) => item.type === modification.type);
    if (!item) {
      unpricedWork.push({ modificationId: modification.id, type: modification.type, requiresProfessionalEstimate: true });
      professionalEstimates.push({ modificationId: modification.id, reason: 'Work is not covered by the catalog. Obtain a professional estimate; no price has been assigned.' });
      continue;
    }
    costs.push({ modificationId: modification.id, title: item.title, lowUsd: item.lowUsd, highUsd: item.highUsd, basis: item.basis, status: 'illustrative' });
    lowCents += Math.round(item.lowUsd * 100);
    highCents += Math.round(item.highUsd * 100);
    if (item.requiresProfessionalReview || modification.requiresProfessionalReview) {
      professionalEstimates.push({ modificationId: modification.id, reason: 'Obtain a professional estimate and feasibility review. The catalog range is a fictional planning placeholder.' });
    }
  }
  const knownSubtotal = { lowUsd: lowCents / 100, highUsd: highCents / 100, status: 'illustrative' as const };
  return costEstimateSchema.parse({
    status: 'illustrative', currency: 'USD', catalogUpdatedAt: catalog.updatedAt,
    costs, knownSubtotal, total: unpricedWork.length ? null : knownSubtotal,
    complete: unpricedWork.length === 0, professionalEstimates, unpricedWork,
    limitations: [...catalog.limitations, 'Each modification is counted once at its catalog range; quantities, dimensions, taxes, permits, and local pricing are not calculated. Obtain contractor estimates before budgeting real work.'],
  });
}
