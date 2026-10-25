import { z } from 'zod';

const id = z.string().trim().min(1).max(120);
const millimeters = z.number().finite().positive();
const point = z.strictObject({ x: z.number().finite(), y: z.number().finite() });
const sourced = {
  source: z.string().trim().max(200).optional(),
  confidence: z.number().finite().min(0).max(1).optional(),
};

const wall = z.strictObject({
  id, start: point, end: point, thickness: millimeters, editable: z.boolean(), ...sourced,
});
const door = z.strictObject({
  id, wallId: id, center: point, clearWidth: millimeters,
  swing: z.enum(['left', 'right', 'sliding']).optional(), editable: z.boolean(), ...sourced,
});
const object = z.strictObject({
  id, kind: z.enum(['furniture', 'fixture']), label: z.string().trim().min(1).max(160),
  bounds: z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: millimeters, height: millimeters }),
  movable: z.boolean(), ...sourced,
});
const room = z.strictObject({ id, label: z.string().trim().min(1).max(160), polygon: z.array(point).min(3).max(100) });

export const layoutSchema = z.strictObject({
  id, units: z.literal('mm'), walls: z.array(wall).max(300), doors: z.array(door).max(200),
  objects: z.array(object).max(500), rooms: z.array(room).min(1).max(200),
}).superRefine((layout, ctx) => {
  const ids = new Set<string>();
  for (const element of [...layout.walls, ...layout.doors, ...layout.objects, ...layout.rooms]) {
    if (ids.has(element.id)) ctx.addIssue({ code: 'custom', message: `Duplicate layout ID: ${element.id}` });
    ids.add(element.id);
  }
  for (const item of layout.walls) {
    if (Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) <= 0) {
      ctx.addIssue({ code: 'custom', message: `Wall ${item.id} has zero length.` });
    }
  }
  for (const item of layout.doors) {
    const parent = layout.walls.find((candidate) => candidate.id === item.wallId);
    if (!parent) {
      ctx.addIssue({ code: 'custom', message: `Door ${item.id} references an unknown wall.` });
      continue;
    }
    const dx = parent.end.x - parent.start.x;
    const dy = parent.end.y - parent.start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) continue;
    const distance = ((item.center.x - parent.start.x) * dx + (item.center.y - parent.start.y) * dy) / length;
    const offset = Math.abs((item.center.x - parent.start.x) * dy - (item.center.y - parent.start.y) * dx) / length;
    if (offset > parent.thickness / 2 || distance - item.clearWidth / 2 < 0 || distance + item.clearWidth / 2 > length) {
      ctx.addIssue({ code: 'custom', message: `Door ${item.id} does not fit its referenced wall.` });
    }
  }
  for (const parent of layout.walls) {
    const dx = parent.end.x - parent.start.x;
    const dy = parent.end.y - parent.start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) continue;
    const intervals = layout.doors.filter((item) => item.wallId === parent.id).map((item) => {
      const distance = ((item.center.x - parent.start.x) * dx + (item.center.y - parent.start.y) * dy) / length;
      return { id: item.id, start: distance - item.clearWidth / 2, end: distance + item.clearWidth / 2 };
    }).sort((a, b) => a.start - b.start);
    for (let index = 1; index < intervals.length; index++) {
      if (intervals[index].start < intervals[index - 1].end) {
        ctx.addIssue({ code: 'custom', message: `Door openings ${intervals[index - 1].id} and ${intervals[index].id} overlap.` });
      }
    }
  }
  for (const item of layout.rooms) {
    const twiceArea = item.polygon.reduce((sum, vertex, index) => {
      const next = item.polygon[(index + 1) % item.polygon.length];
      return sum + vertex.x * next.y - next.x * vertex.y;
    }, 0);
    if (Math.abs(twiceArea) < 1) ctx.addIssue({ code: 'custom', message: `Room ${item.id} has no area.` });
  }
});

export const goalSchema = z.strictObject({
  id,
  type: z.enum(['minimum-door-width', 'minimum-path-width', 'reachable-route']),
  targetMm: millimeters.optional(),
  fromRoomId: id.optional(),
  toRoomId: id.optional(),
  status: z.literal('confirmed'),
}).superRefine((goal, ctx) => {
  if (goal.type !== 'reachable-route' && goal.targetMm === undefined) {
    ctx.addIssue({ code: 'custom', message: `Goal ${goal.id} needs a target in millimeters.` });
  }
  if (goal.type === 'reachable-route' && (!goal.fromRoomId || !goal.toRoomId || goal.fromRoomId === goal.toRoomId)) {
    ctx.addIssue({ code: 'custom', message: `Goal ${goal.id} needs two distinct rooms.` });
  }
});

function checkGoalReferences(value: { layout: z.infer<typeof layoutSchema>; goals: Array<z.infer<typeof goalSchema>> }, ctx: z.RefinementCtx) {
  const goalIds = new Set<string>();
  const roomIds = new Set(value.layout.rooms.map((room) => room.id));
  for (const goal of value.goals) {
    if (goalIds.has(goal.id)) ctx.addIssue({ code: 'custom', message: `Duplicate goal ID: ${goal.id}` });
    goalIds.add(goal.id);
    if (goal.type === 'reachable-route' && (!roomIds.has(goal.fromRoomId!) || !roomIds.has(goal.toRoomId!))) {
      ctx.addIssue({ code: 'custom', message: `Goal ${goal.id} references an unknown room.` });
    }
  }
}

export const validateRequestSchema = z.strictObject({ layout: layoutSchema, goals: z.array(goalSchema).min(1).max(30) }).superRefine(checkGoalReferences);
export const generateRequestSchema = z.strictObject({
  layout: layoutSchema, goals: z.array(goalSchema).min(1).max(30),
  budgetUsd: z.number().finite().nonnegative().optional(),
}).superRefine(checkGoalReferences);

export type Layout = z.infer<typeof layoutSchema>;
export type Goal = z.infer<typeof goalSchema>;
