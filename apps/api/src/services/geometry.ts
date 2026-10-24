import { z } from 'zod';

export class GeometryError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export interface GeometryClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

// The caller supplies the agreed request/response schemas and Python route.
// A response is never accepted based on HTTP status alone.
export function createGeometryClient<RequestSchema extends z.ZodType, ResponseSchema extends z.ZodType>(
  contract: { path: string; request: RequestSchema; response: ResponseSchema },
  options: GeometryClientOptions = {},
) {
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Geometry timeout must be a positive integer');
  }

  return async (input: z.input<RequestSchema>): Promise<z.output<ResponseSchema>> => {
    const request = contract.request.safeParse(input);
    if (!request.success) {
      throw new GeometryError(400, 'INVALID_GEOMETRY_REQUEST', 'Layout validation request does not match the geometry contract.');
    }

    let url: URL;
    try {
      const base = new URL(options.baseUrl ?? process.env.GEOMETRY_BASE_URL ?? 'http://localhost:8000');
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error();
      url = new URL(contract.path.replace(/^\//, ''), `${base.href.replace(/\/$/, '')}/`);
      if (url.origin !== base.origin) throw new Error();
    } catch {
      throw new GeometryError(503, 'GEOMETRY_NOT_CONFIGURED', 'Geometry service configuration is invalid.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request.data),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new GeometryError(502, 'GEOMETRY_UPSTREAM_ERROR', 'Geometry service could not complete validation.');
      }
      if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')) {
        await response.body?.cancel();
        throw new GeometryError(502, 'INVALID_GEOMETRY_RESPONSE', 'Geometry service returned an invalid response.');
      }

      // Bound memory usage; the same timeout covers headers and body streaming.
      const reader = response.body?.getReader();
      if (!reader) throw new GeometryError(502, 'INVALID_GEOMETRY_RESPONSE', 'Geometry service returned an invalid response.');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) {
          await reader.cancel();
          throw new GeometryError(502, 'INVALID_GEOMETRY_RESPONSE', 'Geometry service returned an invalid response.');
        }
        chunks.push(value);
      }
      let parsed;
      try {
        parsed = contract.response.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        throw new GeometryError(502, 'INVALID_GEOMETRY_RESPONSE', 'Geometry service returned an invalid response.');
      }
      if (!parsed.success) {
        throw new GeometryError(502, 'INVALID_GEOMETRY_RESPONSE', 'Geometry service returned an invalid response.');
      }
      return parsed.data;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new GeometryError(504, 'GEOMETRY_TIMEOUT', 'Geometry validation timed out. No result has been verified.');
      }
      if (error instanceof GeometryError) throw error;
      throw new GeometryError(502, 'GEOMETRY_UNAVAILABLE', 'Geometry service is unavailable. No result has been verified.');
    } finally {
      clearTimeout(timer);
    }
  };
}
