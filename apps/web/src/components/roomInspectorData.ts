import type { ConstraintFinding, Layout, Point2D } from '../contracts'

function pointOnSegment(point: Point2D, start: Point2D, end: Point2D, tolerance = 2): boolean {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y) <= tolerance
  const projection = ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)
  if (projection < 0 || projection > 1) return false
  return Math.hypot(point.x - (start.x + projection * (end.x - start.x)), point.y - (start.y + projection * (end.y - start.y))) <= tolerance
}

export function inRoom(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false
  for (let index = 0; index < polygon.length; index++) {
    if (pointOnSegment(point, polygon[index], polygon[(index + 1) % polygon.length])) return true
  }
  let inside = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index]
    const b = polygon[previous]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function roomContents(layout: Layout, roomId: string) {
  const room = layout.rooms.find((item) => item.id === roomId)
  if (!room) return { doors: [], objects: [], ids: [roomId] }
  const doors = layout.doors.filter((door) => inRoom(door.center, room.polygon))
  const objects = layout.objects.filter((object) => inRoom({ x: object.bounds.x + object.bounds.width / 2, y: object.bounds.y + object.bounds.height / 2 }, room.polygon))
  return { doors, objects, ids: [roomId, ...doors.map((door) => door.id), ...objects.map((object) => object.id)] }
}

export function roomFindings(findings: ConstraintFinding[] | undefined, elementIds: string[]): ConstraintFinding[] {
  return findings?.filter((finding) => elementIds.some((id) => finding.affectedElementIds.includes(id))) ?? []
}
