import { z } from 'zod';

const id = z.string().trim().min(1).max(200);
const coordinate = z.number().finite().min(-10_000_000).max(10_000_000);
const dimension = z.number().finite().positive().max(10_000_000);
const point = z.strictObject({ x: coordinate, y: coordinate });
const provenance = {
  source: z.enum(['sample', 'user', 'ai-inferred']),
  confidence: z.number().finite().min(0).max(1).optional(),
};
export const wallSchema = z.strictObject({
  id, start: point, end: point, thickness: dimension, editable: z.boolean(), ...provenance,
}).refine((wall) => wall.start.x !== wall.end.x || wall.start.y !== wall.end.y, 'Wall must have length');
export const doorSchema = z.strictObject({
  id, wallId: id, center: point, clearWidth: dimension,
  swing: z.enum(['left', 'right', 'sliding']).optional(), editable: z.boolean(), ...provenance,
});
export const floorObjectSchema = z.strictObject({
  id, kind: z.enum(['furniture', 'fixture']), label: z.string().trim().min(1).max(500),
  bounds: z.strictObject({ x: coordinate, y: coordinate, width: dimension, height: dimension }),
  movable: z.boolean(), ...provenance,
});
export const roomSchema = z.strictObject({
  id, label: z.string().trim().min(1).max(500), polygon: z.array(point).min(3).max(1000),
}).refine(({ polygon }) => Math.abs(polygon.reduce((area, p, i) => {
  const next = polygon[(i + 1) % polygon.length]!;
  return area + p.x * next.y - next.x * p.y;
}, 0)) > 0, 'Room polygon must have nonzero area');
export const layoutSchema = z.strictObject({
  id, units: z.literal('mm'), walls: z.array(wallSchema).max(1000),
  doors: z.array(doorSchema).max(1000), objects: z.array(floorObjectSchema).max(1000),
  rooms: z.array(roomSchema).max(1000),
});
export const goalSchema = z.strictObject({
  id, type: z.enum(['minimum-door-width', 'minimum-path-width', 'reachable-route']),
  targetMm: dimension.optional(), fromRoomId: id.optional(), toRoomId: id.optional(),
  status: z.enum(['draft', 'confirmed']),
}).superRefine((goal, ctx) => {
  if (goal.status !== 'confirmed') return;
  if (goal.type !== 'reachable-route' && goal.targetMm === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Confirmed width goals require targetMm' });
  }
  if (goal.type === 'reachable-route' && (!goal.fromRoomId || !goal.toRoomId || goal.fromRoomId === goal.toRoomId)) {
    ctx.addIssue({ code: 'custom', message: 'Confirmed routes require distinct source and destination rooms' });
  }
});
export const validateLayoutRequestSchema = z.strictObject({
  layout: layoutSchema, goals: z.array(goalSchema).min(1).max(100),
}).superRefine(({ layout, goals }, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const elements = [...layout.walls, ...layout.doors, ...layout.objects, ...layout.rooms];
  if (new Set(elements.map((item) => item.id)).size !== elements.length) issue('Layout element IDs must be unique');
  if (new Set(goals.map((goal) => goal.id)).size !== goals.length) issue('Goal IDs must be unique');
  const walls = new Set(layout.walls.map((wall) => wall.id));
  const rooms = new Set(layout.rooms.map((room) => room.id));
  for (const door of layout.doors) if (!walls.has(door.wallId)) issue('Door references an unknown wall');
  for (const goal of goals) {
    if (goal.fromRoomId && !rooms.has(goal.fromRoomId)) issue('Goal references an unknown source room');
    if (goal.toRoomId && !rooms.has(goal.toRoomId)) issue('Goal references an unknown destination room');
  }
  if (!goals.some((goal) => goal.status === 'confirmed')) issue('At least one confirmed goal is required');
});
export const constraintFindingSchema = z.strictObject({
  id, goalId: id, verdict: z.enum(['pass', 'fail', 'unknown']),
  measuredMm: z.number().finite().nonnegative().max(10_000_000).optional(),
  requiredMm: dimension.optional(), affectedElementIds: z.array(id).max(1000),
  explanation: z.string().trim().min(1).max(4000),
});
// Provisional summary shared with Python; checked against findings before return.
export const geometrySummarySchema = z.strictObject({
  total: z.number().int().nonnegative(), passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(), unknown: z.number().int().nonnegative(),
  status: z.enum(['pass', 'fail', 'unknown']),
});
export const validateLayoutResponseSchema = z.strictObject({
  findings: z.array(constraintFindingSchema).min(1).max(2000), summary: geometrySummarySchema,
});
export type ValidateLayoutRequest = z.infer<typeof validateLayoutRequestSchema>;
export type ValidateLayoutResponse = z.infer<typeof validateLayoutResponseSchema>;
