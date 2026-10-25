const geometryBaseUrl = () => (process.env.GEOMETRY_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

export class GeometryUnavailableError extends Error {}

export async function callGeometry<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${geometryBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new GeometryUnavailableError('Geometry validation is unavailable. Start the geometry service and try again.');
  }
  const payload = await response.json().catch(() => null) as (T & { error?: { message?: string } }) | null;
  if (!response.ok) {
    if (response.status >= 500) throw new GeometryUnavailableError('Geometry validation is unavailable. Please try again.');
    const error = new Error(payload?.error?.message ?? 'The geometry service rejected this request.') as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  if (payload === null) throw new GeometryUnavailableError('Geometry validation returned an invalid response.');
  return payload;
}
