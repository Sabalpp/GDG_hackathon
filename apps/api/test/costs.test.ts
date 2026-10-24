import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { catalogResponseSchema, costCatalogSchema, costEstimateSchema } from '../src/schemas/costs.js';
import { estimateModificationCosts, loadCostCatalog } from '../src/services/costs.js';

const modification = (id: string, type: string, review = false) => ({
  id, type, targetElementId: `element-${id}`, params: {}, requiresProfessionalReview: review,
});
async function withApi(run: (url: string) => Promise<void>) {
  const server = createApp().listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('catalog HTTP endpoint returns shared validated items, date, and limitations', async () => {
  const catalog = await loadCostCatalog();
  await withApi(async (url) => {
    const response = await fetch(`${url}/api/v1/catalog/costs`);
    assert.equal(response.status, 200);
    assert.deepEqual(catalogResponseSchema.parse(await response.json()), {
      items: catalog.items, updatedAt: catalog.updatedAt, limitations: catalog.limitations,
    });
    assert(catalog.items.every((item) => item.status === 'illustrative'));
  });
});

test('catalog lookup sums all supported types and flags professional estimates', async () => {
  const result = await estimateModificationCosts([
    modification('move', 'move-furniture'), modification('door', 'resize-demo-door'), modification('partition', 'move-demo-partition'),
  ]);
  assert.equal(costEstimateSchema.safeParse(result).success, true);
  assert.deepEqual(result.total, { lowUsd: 3800, highUsd: 15700, status: 'illustrative' });
  assert.equal(result.complete, true);
  assert(result.costs.every((line) => line.status === 'illustrative'));
  assert.deepEqual(result.professionalEstimates.map((item) => item.modificationId), ['door', 'partition']);
  assert.deepEqual(result.costs.map((line) => line.modificationId), ['move', 'door', 'partition']);
});

test('repeated types are counted per modification; caller prices cannot override catalog', async () => {
  const first = { ...modification('a', 'move-furniture'), params: { lowUsd: 999999, highUsd: 999999, quantity: 200 } };
  const result = await estimateModificationCosts([first, modification('b', 'move-furniture', true)]);
  assert.deepEqual(result.total, { lowUsd: 0, highUsd: 400, status: 'illustrative' });
  assert.equal(result.professionalEstimates[0]?.modificationId, 'b');
  assert.deepEqual(first.params, { lowUsd: 999999, highUsd: 999999, quantity: 200 });
});

test('unknown work has no price and prevents a misleading complete total', async () => {
  const result = await estimateModificationCosts([modification('move', 'move-furniture'), modification('structure', 'structural-work')]);
  assert.equal(result.complete, false);
  assert.equal(result.total, null);
  assert.deepEqual(result.knownSubtotal, { lowUsd: 0, highUsd: 200, status: 'illustrative' });
  assert.deepEqual(result.unpricedWork, [{ modificationId: 'structure', type: 'structural-work', requiresProfessionalEstimate: true }]);
  assert.equal(result.costs.length, 1);
  assert(result.professionalEstimates.some((item) => item.modificationId === 'structure'));
});

test('empty modifications means zero illustrative cost for zero work', async () => {
  const result = await estimateModificationCosts([]);
  assert.equal(result.complete, true);
  assert.deepEqual(result.total, { lowUsd: 0, highUsd: 0, status: 'illustrative' });
  assert.deepEqual(result.costs, []);
});

test('malformed modifications, duplicate IDs and invalid catalogs are rejected', async () => {
  for (const input of [null, {}, [modification('a', 'move-furniture'), modification('a', 'move-furniture')],
    [{ ...modification('a', 'move-furniture'), params: { x: Infinity } }],
    [{ ...modification('a', 'move-furniture'), lowUsd: 5 }]]) {
    await assert.rejects(estimateModificationCosts(input));
  }
  const catalog = await loadCostCatalog();
  for (const field of ['lowUsd', 'highUsd']) {
    const invalid = structuredClone(catalog);
    invalid.items[0]![field as 'lowUsd' | 'highUsd'] = -1;
    assert.equal(costCatalogSchema.safeParse(invalid).success, false);
  }
  const backwards = structuredClone(catalog);
  backwards.items[0]!.lowUsd = 300;
  await assert.rejects(estimateModificationCosts([], backwards));
  const duplicate = structuredClone(catalog);
  duplicate.items[1] = duplicate.items[0]!;
  assert.equal(costCatalogSchema.safeParse(duplicate).success, false);
});

test('ADAPT_DATA_DIR is supported and corrupt or missing catalogs return sanitized 503', async () => {
  const catalog = await loadCostCatalog();
  const directory = await mkdtemp(join(tmpdir(), 'adapt-costs-'));
  const previous = process.env.ADAPT_DATA_DIR;
  process.env.ADAPT_DATA_DIR = directory;
  try {
    await withApi(async (url) => {
      const endpoint = `${url}/api/v1/catalog/costs`;
      assert.equal((await fetch(endpoint)).status, 503);
      await writeFile(join(directory, 'sample-cost-catalog.json'), JSON.stringify(catalog));
      assert.equal((await fetch(endpoint)).status, 200);
      await writeFile(join(directory, 'sample-cost-catalog.json'), 'private invalid data');
      const response = await fetch(endpoint);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: { code: 'COST_CATALOG_UNAVAILABLE', message: 'Illustrative cost catalog is unavailable.' } });
    });
  } finally {
    if (previous === undefined) delete process.env.ADAPT_DATA_DIR;
    else process.env.ADAPT_DATA_DIR = previous;
    await rm(directory, { recursive: true });
  }
});
