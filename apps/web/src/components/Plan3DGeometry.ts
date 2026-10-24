import type { Door, Layout, Point2D, Wall } from '../contracts';

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export type Opening = { id: string; startMm: number; endMm: number };
export type WallRun = { startMm: number; endMm: number };

export const mmToMeters = (millimeters: number) => millimeters / 1000;

/** The source layout stays x-right/y-down; scene x/z follows those same directions. */
export function planToScene(point: Point2D, center: Point2D): [number, number] {
  return [mmToMeters(point.x - center.x), mmToMeters(point.y - center.y)];
}

export function layoutBounds(layout: Layout): Bounds | null {
  const points = [
    ...layout.rooms.flatMap((room) => room.polygon),
    ...layout.walls.flatMap((wall) => [wall.start, wall.end]),
    ...layout.doors.map((door) => door.center),
    ...layout.objects.flatMap(({ bounds }) => [
      { x: bounds.x, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    ]),
  ].filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length || !layout.rooms.some((room) => room.polygon.length >= 3)) return null;
  const bounds = {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
  return bounds.maxX > bounds.minX && bounds.maxY > bounds.minY ? bounds : null;
}

export function boundsCenter(bounds: Bounds): Point2D {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}

export function polygonCenter(polygon: Point2D[]): Point2D {
  if (!polygon.length) return { x: 0, y: 0 };
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < polygon.length; index++) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    const cross = a.x * b.y - b.x * a.y;
    twiceArea += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(twiceArea) > 0.001) return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
  return {
    x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
    y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
  };
}

export function pointOnWall(wall: Wall, distanceMm: number): Point2D {
  const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
  if (!length) return wall.start;
  const t = distanceMm / length;
  return {
    x: wall.start.x + (wall.end.x - wall.start.x) * t,
    y: wall.start.y + (wall.end.y - wall.start.y) * t,
  };
}

/** Only doors assigned to this wall and lying on its thickness cut an opening. */
export function wallOpenings(wall: Wall, doors: Door[]): { openings: Opening[]; runs: WallRun[] } {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0 || wall.thickness <= 0) return { openings: [], runs: [] };

  const openings = doors.filter((door) => door.wallId === wall.id && Number.isFinite(door.clearWidth) && door.clearWidth > 0)
    .map((door) => {
      const along = ((door.center.x - wall.start.x) * dx + (door.center.y - wall.start.y) * dy) / length;
      const offset = Math.abs((door.center.x - wall.start.x) * dy - (door.center.y - wall.start.y) * dx) / length;
      return {
        id: door.id,
        startMm: Math.max(0, along - door.clearWidth / 2),
        endMm: Math.min(length, along + door.clearWidth / 2),
        valid: Number.isFinite(offset) && offset <= wall.thickness / 2,
      };
    })
    .filter((opening) => opening.valid && opening.endMm > opening.startMm)
    .sort((a, b) => a.startMm - b.startMm);

  const runs: WallRun[] = [];
  let cursor = 0;
  for (const opening of openings) {
    if (opening.startMm > cursor) runs.push({ startMm: cursor, endMm: opening.startMm });
    cursor = Math.max(cursor, opening.endMm);
  }
  if (cursor < length) runs.push({ startMm: cursor, endMm: length });
  return { openings: openings.map(({ id, startMm, endMm }) => ({ id, startMm, endMm })), runs };
}
