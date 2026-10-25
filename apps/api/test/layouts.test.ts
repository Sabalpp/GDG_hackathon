import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { sampleLayout } from '../../../src/data/sampleLayout.js';

async function withApi(run: (url: string) => Promise<void>) {
  const server = createApp().listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const post = (url: string, path: string, body: unknown) => fetch(`${url}/api/v1/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const doorwayGoal = { id: 'door-goal', type: 'minimum-door-width', targetMm: 850, status: 'confirmed' };
const routeGoal = { id: 'route-goal', type: 'reachable-route', fromRoomId: 'living', toRoomId: 'bath', status: 'confirmed' };

test('a bounded concept edit changes the modeled doorway finding while route stays unknown', async () => {
  await withApi(async (url) => {
    const request = { layout: sampleLayout, goals: [doorwayGoal, routeGoal] };
    const beforeResponse = await post(url, 'layouts/validate', request);
    assert.equal(beforeResponse.status, 200);
    const before = await beforeResponse.json();
    assert.equal(before.find((item: { goalId: string }) => item.goalId === doorwayGoal.id).verdict, 'fail');
    assert.equal(before.find((item: { goalId: string }) => item.goalId === routeGoal.id).verdict, 'unknown');

    const proposalResponse = await post(url, 'proposals/generate', { ...request, budgetUsd: 12000 });
    assert.equal(proposalResponse.status, 200);
    const proposal = await proposalResponse.json();
    assert.equal(sampleLayout.doors[0].clearWidth, 760);
    assert.equal(proposal.resultLayout.doors[0].clearWidth, 850);
    assert.equal(proposal.findingsBefore.find((item: { goalId: string }) => item.goalId === doorwayGoal.id).verdict, 'fail');
    assert.equal(proposal.findingsAfter.find((item: { goalId: string }) => item.goalId === doorwayGoal.id).verdict, 'pass');
    assert.equal(proposal.findingsAfter.find((item: { goalId: string }) => item.goalId === routeGoal.id).verdict, 'unknown');
    assert.deepEqual(proposal.costs, []);
    assert(proposal.unresolvedQuestions.some((question: string) => question.includes('construction feasibility')));
  });
});

test('uneditable doors and targets above the concept limit remain failed', async () => {
  await withApi(async (url) => {
    const locked = structuredClone(sampleLayout);
    locked.doors[0].editable = false;
    const response = await post(url, 'proposals/generate', { layout: locked, goals: [{ ...doorwayGoal, targetMm: 1000 }] });
    assert.equal(response.status, 200);
    const proposal = await response.json();
    assert.equal(proposal.resultLayout.doors[0].clearWidth, 760);
    assert.equal(proposal.modifications.length, 0);
    assert.equal(proposal.findingsAfter[0].verdict, 'fail');
  });
});

test('invalid geometry and unconfirmed goals are rejected before evaluation', async () => {
  await withApi(async (url) => {
    const badLayout = structuredClone(sampleLayout);
    badLayout.doors[0].wallId = 'missing-wall';
    for (const body of [
      { layout: badLayout, goals: [doorwayGoal] },
      { layout: sampleLayout, goals: [{ ...doorwayGoal, status: 'draft' }] },
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
