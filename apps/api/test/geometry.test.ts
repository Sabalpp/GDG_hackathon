import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type RequestListener } from 'node:http';
import { test } from 'node:test';
import { z } from 'zod';
import { createGeometryClient, GeometryError } from '../src/services/geometry.js';

// Transport-only fixtures, deliberately not proposed ADAPT canonical contracts.
const contract = {
  path: '/test/validate',
  request: z.strictObject({ fixture: z.literal('layout') }),
  response: z.strictObject({ verified: z.boolean() }),
};
const payload = { fixture: 'layout' } as const;

async function withPython(handler: RequestListener, run: (url: string) => Promise<void>) {
  const server = createServer(handler).listen(0, '127.0.0.1');
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

function expectError(code: string, status: number) {
  return (error: unknown) => error instanceof GeometryError && error.code === code && error.status === status;
}

test('geometry client forwards JSON to mock Python and validates true and false results', async () => {
  for (const verified of [true, false]) {
    await withPython(async (req, res) => {
      assert.equal(req.method, 'POST');
      assert.equal(req.url, contract.path);
      assert.equal(req.headers['content-type'], 'application/json');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      assert.deepEqual(JSON.parse(Buffer.concat(chunks).toString()), payload);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ verified }));
    }, async (baseUrl) => {
      assert.deepEqual(await createGeometryClient(contract, { baseUrl })(payload), { verified });
    });
  }
});

test('geometry client uses GEOMETRY_BASE_URL from the server environment', async () => {
  await withPython((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"verified":false}');
  }, async (baseUrl) => {
    const previous = process.env.GEOMETRY_BASE_URL;
    process.env.GEOMETRY_BASE_URL = baseUrl;
    try {
      assert.deepEqual(await createGeometryClient(contract)(payload), { verified: false });
    } finally {
      if (previous === undefined) delete process.env.GEOMETRY_BASE_URL;
      else process.env.GEOMETRY_BASE_URL = previous;
    }
  });
});

test('geometry client rejects invalid requests before contacting Python', async () => {
  await assert.rejects(createGeometryClient(contract)({ fixture: 'bad' } as never), expectError('INVALID_GEOMETRY_REQUEST', 400));
});

test('geometry client rejects invalid JSON, schema mismatches, wrong content type, and oversized responses', async () => {
  for (const [body, contentType] of [
    ['not JSON', 'application/json'], ['{}', 'application/json'],
    ['{"verified":"true"}', 'application/json'],
    ['{"verified":true,"unverified":true}', 'application/json'],
    ['{"verified":true}', 'text/plain'], ['x'.repeat(1024 * 1024 + 1), 'application/json'],
  ]) {
    await withPython((_req, res) => {
      res.writeHead(200, { 'Content-Type': contentType! });
      res.end(body);
    }, async (baseUrl) => {
      await assert.rejects(createGeometryClient(contract, { baseUrl })(payload), expectError('INVALID_GEOMETRY_RESPONSE', 502));
    });
  }
});

test('geometry client rejects non-success statuses, even with a passing body', async () => {
  for (const status of [422, 500]) {
    await withPython((_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end('{"verified":true}');
    }, async (baseUrl) => {
      await assert.rejects(createGeometryClient(contract, { baseUrl })(payload), expectError('GEOMETRY_UPSTREAM_ERROR', 502));
    });
  }
});

test('geometry client times out during headers or response body', async () => {
  for (const sendHeaders of [false, true]) {
    await withPython((_req, res) => {
      if (sendHeaders) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{');
      }
    }, async (baseUrl) => {
      await assert.rejects(createGeometryClient(contract, { baseUrl, timeoutMs: 50 })(payload), expectError('GEOMETRY_TIMEOUT', 504));
    });
  }
});

test('geometry client safely handles a refused connection', async () => {
  let baseUrl = '';
  await withPython((_req, res) => res.end(), async (url) => { baseUrl = url; });
  await assert.rejects(createGeometryClient(contract, { baseUrl })(payload), expectError('GEOMETRY_UNAVAILABLE', 502));
});

test('geometry client rejects redirects and invalid configuration', async () => {
  await withPython((_req, res) => {
    res.writeHead(302, { Location: 'http://example.com' });
    res.end();
  }, async (baseUrl) => {
    await assert.rejects(createGeometryClient(contract, { baseUrl })(payload), expectError('GEOMETRY_UNAVAILABLE', 502));
  });
  await assert.rejects(createGeometryClient(contract, { baseUrl: 'file:///tmp' })(payload), expectError('GEOMETRY_NOT_CONFIGURED', 503));
});
