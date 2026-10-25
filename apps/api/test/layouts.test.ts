import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { sampleLayout } from '../../web/src/data/sampleLayout.js';

async function withApi(run: (url: string) => Promise<void>) {
  const priorGeometryUrl = process.env.GEOMETRY_BASE_URL;
  process.env.GEOMETRY_BASE_URL = 'http://127.0.0.1:1';
  const server = createApp().listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    if (priorGeometryUrl === undefined) delete process.env.GEOMETRY_BASE_URL;
    else process.env.GEOMETRY_BASE_URL = priorGeometryUrl;
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const post = (url: string, path: string, body: unknown) => fetch(`${url}/api/v1/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const goal = { id: 'door-goal', type: 'minimum-door-width', targetMm: 850, status: 'confirmed' };

test('geometry unavailability is explicit and never replaced by local pass findings', async () => {
  await withApi(async (url) => {
    const response = await post(url, 'layouts/validate', { layout: sampleLayout, goals: [goal] });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'GEOMETRY_UNAVAILABLE');
  });
});

test('proposal generation reports geometry unavailability clearly', async () => {
  await withApi(async (url) => {
    const response = await post(url, 'proposals/generate', { layout: sampleLayout, goals: [goal], budgetUsd: 12000 });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'GEOMETRY_UNAVAILABLE');
  });
});

test('invalid geometry and unconfirmed goals are rejected before proxying', async () => {
  await withApi(async (url) => {
    const badLayout = structuredClone(sampleLayout);
    badLayout.doors[0].wallId = 'missing-wall';
    for (const body of [
      { layout: badLayout, goals: [goal] },
      { layout: sampleLayout, goals: [{ ...goal, status: 'draft' }] },
    ]) {
      const response = await post(url, 'layouts/validate', body);
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error.code, 'INVALID_REQUEST');
    }
  });
});

test('CORS permits a local Vite origin without opening access to other sites', async () => {
  await withApi(async (url) => {
    const endpoint = `${url}/api/v1/layouts/validate`;
    const headers = { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' };
    const allowed = await fetch(endpoint, { method: 'OPTIONS', headers: { ...headers, Origin: 'http://localhost:5173' } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    const denied = await fetch(endpoint, { method: 'OPTIONS', headers: { ...headers, Origin: 'https://unlisted.example' } });
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });
});

test('catalog endpoint returns the sample cost catalog', async () => {
  await withApi(async (url) => {
    const response = await fetch(`${url}/api/v1/catalog/costs`);
    assert.equal(response.status, 200);
    const catalog = await response.json();
    assert(catalog.items.some((item: { type: string }) => item.type === 'resize-demo-door'));
  });
});
