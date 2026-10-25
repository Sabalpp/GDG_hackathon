import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const router = Router();
const catalogPath = fileURLToPath(new URL('../../../../data/sample-cost-catalog.json', import.meta.url));

export async function costLinesFor(modifications: Array<{ id: string; type: string }>) {
  const catalog = JSON.parse(await readFile(catalogPath, 'utf8')) as { items: Array<{ type: string; title: string; lowUsd: number; highUsd: number; basis: string }> };
  return modifications.flatMap((modification) => {
    const item = catalog.items.find((candidate) => candidate.type === modification.type);
    return item ? [{ modificationId: modification.id, title: item.title, lowUsd: item.lowUsd, highUsd: item.highUsd, basis: item.basis, status: 'illustrative' as const }] : [];
  });
}

router.get('/costs', async (_req, res, next) => {
  try {
    res.json(JSON.parse(await readFile(catalogPath, 'utf8')));
  } catch (error) {
    next(error);
  }
});

export default router;
