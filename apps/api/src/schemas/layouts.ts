import { z } from 'zod';

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.:-]+$/);
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const dimension = z.number().finite().positive().max(100_000);
const point = z.strictObject({ x: coordinate, y: coordinate });
const provenance = {
  source: z.enum(['sample', 'user', 'ai-inferred']),
  confidence: z.number().finite().min(0).max(1).nullable().optional(),
};
export const wallSchema = z.strictObject({
  id, start: point, end: point, thickness: dimension, editable: z.boolean().default(false), ...provenance,
}).refine((wall) => Math.hypot(wall.start.x - wall.end.x, wall.start.y - wall.end.y) >= 0.01, 'Wall must have length');
export const doorSchema = z.strictObject({
  id, wallId: id, center: point, clearWidth: dimension.nullable().optional(),
  swing: z.enum(['left', 'right', 'sliding']).nullable().optional(), editable: z.boolean().default(false), ...provenance,
});
export const floorObjectSchema = z.strictObject({
  id, kind: z.enum(['furniture', 'fixture']), label: z.string().trim().min(1).max(200),
  bounds: z.strictObject({ x: coordinate, y: coordinate, width: dimension, height: dimension }),
  movable: z.boolean().default(false), ...provenance,
});
export const roomSchema = z.strictObject({
  id, label: z.string().trim().min(1).max(200), polygon: z.array(point).min(3).max(64),
}).refine(({ polygon }) => Math.abs(polygon.reduce((area, p, i) => {
  const next = polygon[(i + 1) % polygon.length]!;
  return area + p.x * next.y - next.x * p.y;
}, 0)) >= 2, 'Room polygon must have nonzero area');
export const layoutSchema = z.strictObject({
  id, units: z.literal('mm'), walls: z.array(wallSchema).max(128),
  doors: z.array(doorSchema).max(64), objects: z.array(floorObjectSchema).max(64),
  rooms: z.array(roomSchema).min(1).max(16),
});
export const goalSchema = z.strictObject({
  id, type: z.enum(['minimum-door-width', 'minimum-path-width', 'reachable-route']),
  targetMm: dimension.nullable().optional(), fromRoomId: id.nullable().optional(), toRoomId: id.nullable().optional(),
  status: z.enum(['draft', 'confirmed']),
}).superRefine((goal, ctx) => {
  if (Boolean(goal.fromRoomId) !== Boolean(goal.toRoomId) || (goal.fromRoomId && goal.fromRoomId === goal.toRoomId)) {
    ctx.addIssue({ code: 'custom', message: 'Route endpoints must be paired and distinct' });
  }
});
export const validateLayoutRequestSchema = z.strictObject({
  layout: layoutSchema, goals: z.array(goalSchema).min(1).max(16),
}).superRefine(({ layout, goals }, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
  const elements = [...layout.walls, ...layout.doors, ...layout.objects, ...layout.rooms];
  if (new Set(elements.map((item) => item.id)).size !== elements.length) issue('Layout element IDs must be unique');
  if (new Set(goals.map((goal) => goal.id)).size !== goals.length) issue('Goal IDs must be unique');
  if (goals.some((goal) => goal.id === 'layout-integrity')) issue('layout-integrity is reserved');
  for (const item of [...layout.walls, ...layout.doors, ...layout.objects]) {
    if (item.source === 'ai-inferred' && item.confidence == null) issue('Inferred elements require confidence');
  }
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
  requiredMm: dimension.optional(), affectedElementIds: z.array(id).max(256),
  explanation: z.string().trim().min(1).max(4000),
});
// Actual Python response contract from services/geometry/app/models.py.
export const geometrySummarySchema = z.strictObject({
  passCount: z.number().int().nonnegative(), failCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(), allPassed: z.boolean(),
});
export const routeTraceSchema = z.strictObject({
  goalId: id, fromRoomId: id, toRoomId: id, verdict: z.enum(['pass', 'fail', 'unknown']),
  requiredMm: dimension.optional(), measuredMm: z.number().finite().nonnegative().optional(),
  points: z.array(point).max(256),
});
export const validateLayoutResponseSchema = z.strictObject({
  findings: z.array(constraintFindingSchema).min(1).max(2000), summary: geometrySummarySchema,
  routes: z.array(routeTraceSchema).max(2000), limitations: z.array(z.string().max(4000)).max(100),
});
export type ValidateLayoutRequest = z.infer<typeof validateLayoutRequestSchema>;
export type ValidateLayoutResponse = z.infer<typeof validateLayoutResponseSchema>;
