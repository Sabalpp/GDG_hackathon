import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server, type RequestListener } from 'node:http';
import { test } from 'node:test';
import { createApp } from '../src/app.js';
import { validateLayoutRequestSchema } from '../src/schemas/layouts.js';

const request = {
  layout: {
    id: 'layout', units: 'mm',
    walls: [{ id: 'wall', start: { x: 0, y: 0 }, end: { x: 3000, y: 0 }, thickness: 100, editable: false, source: 'user' }],
    doors: [{ id: 'door', wallId: 'wall', center: { x: 1000, y: 0 }, clearWidth: 900, editable: true, source: 'user' }],
    objects: [{ id: 'chair', kind: 'furniture', label: 'Chair', bounds: { x: 100, y: 100, width: 400, height: 400 }, movable: true, source: 'sample' }],
    rooms: [{ id: 'room', label: 'Room', polygon: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 0, y: 3000 }] }],
  },
  goals: [{ id: 'goal', type: 'minimum-door-width', targetMm: 850, status: 'confirmed' }, { id: 'draft', type: 'minimum-path-width', status: 'draft' }],
};
const finding = { id: 'finding', goalId: 'goal', verdict: 'pass', measuredMm: 900, requiredMm: 850, affectedElementIds: ['door'], explanation: 'Measured clear width meets target.' };
const integrity = { id: 'integrity:clear', goalId: 'layout-integrity', verdict: 'pass', affectedElementIds: [], explanation: 'No collisions.' };
const response = { findings: [integrity, finding], summary: { passCount: 2, failCount: 0, unknownCount: 0, allPassed: true }, routes: [], limitations: ['Concept geometry only.'] };

async function start(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
}
async function withServices(handler: RequestListener, run: (url: string) => Promise<void>, timeoutMs = 1000) {
  const python = createServer(handler);
  const api = createServer(createApp(undefined, { baseUrl: await start(python), path: '/custom/validate', timeoutMs }));
  try { await run(await start(api)); } finally { await close(api); await close(python); }
}
const post = (url: string, body: unknown = request) => fetch(`${url}/api/v1/layouts/validate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const jsonHandler = (body: unknown): RequestListener => (_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body));
};

test('public endpoint forwards canonical mm layout and only confirmed goals to configurable Python route', async () => {
  await withServices(async (req, res) => {
    assert.equal(req.url, '/custom/validate');
    assert.equal(req.method, 'POST');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), { ...request, goals: [request.goals[0]] });
    jsonHandler(response)(req, res);
  }, async (url) => {
    const result = await post(url);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), response);
  });
});

test('public endpoint preserves fail and unknown without reporting a pass', async () => {
  for (const verdict of ['fail', 'unknown']) {
    const body = { findings: [integrity, { ...finding, verdict, measuredMm: verdict === 'fail' ? 800 : undefined }], summary: {
      passCount: 1, failCount: verdict === 'fail' ? 1 : 0, unknownCount: verdict === 'unknown' ? 1 : 0, allPassed: false,
    }, routes: [], limitations: [] };
    await withServices(jsonHandler(body), async (url) => {
      const input = structuredClone(request);
      if (verdict === 'fail') input.layout.doors[0]!.clearWidth = 800;
      const result = await post(url, input);
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), JSON.parse(JSON.stringify(body)));
    });
  }
});

test('invalid dimensions, references, IDs, goals and unsafe extra fields never reach Python', async () => {
  let calls = 0;
  const variants: unknown[] = [];
  const change = (fn: (body: any) => void) => { const body = structuredClone(request); fn(body); variants.push(body); };
  change((b) => b.layout.units = 'in');
  change((b) => b.layout.doors[0].wallId = 'missing');
  change((b) => b.layout.doors[0].clearWidth = -1);
  change((b) => b.layout.walls[0].end = b.layout.walls[0].start);
  change((b) => b.layout.objects[0].bounds.width = 0);
  change((b) => b.layout.rooms[0].polygon = [{ x: 0, y: 0 }]);
  change((b) => b.layout.doors[0].id = 'wall');
  change((b) => b.layout.walls[0].confidence = 2);
  change((b) => b.goals[0].fromRoomId = 'missing');
  change((b) => b.goals[0].targetMm = -1);
  change((b) => b.goals[1].id = 'goal');
  change((b) => b.goals[0].status = 'draft');
  change((b) => b.goals[0] = { id: 'route', type: 'reachable-route', status: 'confirmed', fromRoomId: 'room' });
  change((b) => b.geometryBaseUrl = 'http://attacker');
  variants.push(null, {});
  await withServices((_req, res) => { calls++; res.end(); }, async (url) => {
    for (const body of variants) assert.equal((await post(url, body)).status, 400);
    assert.equal(calls, 0);
  });
  const nonfinite = structuredClone(request);
  nonfinite.layout.walls[0]!.start.x = Infinity;
  assert.equal(validateLayoutRequestSchema.safeParse(nonfinite).success, false);
});

test('malformed, incomplete, contradictory or unreferenced findings are rejected', async () => {
  const bodies = [
    {}, { ...response, summary: {} }, { ...response, findings: [] },
    { ...response, findings: [integrity, { ...finding, goalId: 'draft' }] },
    { ...response, findings: [integrity, { ...finding, affectedElementIds: ['missing'] }] },
    { ...response, findings: [integrity, { ...finding, measuredMm: 800 }] },
    { ...response, findings: [integrity, { ...finding, measuredMm: undefined }] },
    { ...response, findings: [integrity, { ...finding, requiredMm: 700 }] },
    { ...response, findings: [integrity, { ...finding, verdict: 'unknown' }] },
    { ...response, findings: [integrity, finding, finding] },
    { ...response, summary: { ...response.summary, passCount: 3 } },
  ];
  for (const body of bodies) await withServices(jsonHandler(body), async (url) => {
    const result = await post(url);
    assert.equal(result.status, 502);
    assert.equal((await result.json()).error.code, 'INVALID_GEOMETRY_RESPONSE');
  });
  await withServices(jsonHandler(response), async (url) => {
    const body = structuredClone(request);
    body.goals.push({ ...body.goals[0]!, id: 'uncovered' });
    assert.equal((await post(url, body)).status, 502);
  });
});

test('public route safely maps upstream HTTP, malformed JSON, connection, and timeout failures', async () => {
  const scenarios: [RequestListener, number, string][] = [
    [(_req, res) => { res.writeHead(500); res.end('private debug data'); }, 502, 'GEOMETRY_UPSTREAM_ERROR'],
    [(_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{'); }, 502, 'INVALID_GEOMETRY_RESPONSE'],
    [(req) => req.socket.destroy(), 502, 'GEOMETRY_UNAVAILABLE'],
    [() => {}, 504, 'GEOMETRY_TIMEOUT'],
  ];
  for (const [handler, status, code] of scenarios) await withServices(handler, async (url) => {
    const result = await post(url);
    assert.equal(result.status, status);
    const body = await result.json();
    assert.equal(body.error.code, code);
    assert.equal(body.findings, undefined);
    assert(!JSON.stringify(body).includes('private'));
  }, 100);
});

test('public endpoint rejects non-JSON bodies', async () => {
  await withServices(jsonHandler(response), async (url) => {
    const result = await fetch(`${url}/api/v1/layouts/validate`, { method: 'POST', body: 'text' });
    assert.equal(result.status, 415);
  });
});

test('actual Python uncertainty extensions and point reachability are accepted', async () => {
  const body = structuredClone(request) as any;
  body.layout.doors[0].clearWidth = null;
  delete body.goals[0].targetMm;
  const resultBody = {
    findings: [integrity, { ...finding, verdict: 'unknown', measuredMm: undefined, requiredMm: undefined }],
    summary: { passCount: 1, failCount: 0, unknownCount: 1, allPassed: false }, routes: [], limitations: ['Unknown width.'],
  };
  await withServices(jsonHandler(resultBody), async (url) => {
    const result = await post(url, body);
    assert.equal(result.status, 200);
    assert.equal((await result.json()).summary.allPassed, false);
  });
});

test('actual Python route traces are preserved and inconsistent traces rejected', async () => {
  const body = structuredClone(request) as any;
  body.layout.rooms.push({ id: 'other', label: 'Other room', polygon: [{ x: 3000, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 3000 }] });
  body.goals = [{ id: 'route', type: 'minimum-path-width', status: 'confirmed', targetMm: 850, fromRoomId: 'room', toRoomId: 'other' }];
  const resultBody = {
    findings: [integrity, { ...finding, goalId: 'route', affectedElementIds: ['room', 'other'] }],
    summary: response.summary,
    routes: [{ goalId: 'route', fromRoomId: 'room', toRoomId: 'other', verdict: 'pass', requiredMm: 850, measuredMm: 900, points: [{ x: 100, y: 100 }, { x: 4000, y: 100 }] }],
    limitations: ['Simplified geometry.'],
  };
  await withServices(jsonHandler(resultBody), async (url) => {
    const result = await post(url, body);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), resultBody);
  });
  resultBody.routes[0]!.verdict = 'unknown';
  await withServices(jsonHandler(resultBody), async (url) => {
    assert.equal((await post(url, body)).status, 502);
  });
});

test('upstream geometry schema rejection is 422 rather than an availability error', async () => {
  await withServices((_req, res) => { res.writeHead(422); res.end('private details'); }, async (url) => {
    const result = await post(url);
    assert.equal(result.status, 422);
    assert.equal((await result.json()).error.code, 'INVALID_GEOMETRY_REQUEST');
  });
});
