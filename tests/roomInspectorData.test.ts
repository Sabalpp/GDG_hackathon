import assert from 'node:assert/strict'
import test from 'node:test'
import type { ConstraintFinding, Layout } from '../src/contracts.ts'
import { inRoom, roomContents, roomFindings } from '../src/components/roomInspectorData.ts'

const layout: Layout = {
  id: 'test', units: 'mm', walls: [],
  rooms: [
    { id: 'left', label: 'Left', polygon: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }] },
    { id: 'right', label: 'Right', polygon: [{ x: 1000, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 1000 }, { x: 1000, y: 1000 }] },
  ],
  doors: [{ id: 'shared-door', wallId: 'partition', center: { x: 1000, y: 500 }, clearWidth: 800, editable: true }],
  objects: [
    { id: 'chair', kind: 'furniture', label: 'Chair', bounds: { x: 100, y: 100, width: 300, height: 300 }, movable: true },
    { id: 'sink', kind: 'fixture', label: 'Sink', bounds: { x: 1400, y: 100, width: 300, height: 300 }, movable: false },
  ],
}

test('room containment includes a shared boundary and excludes points outside', () => {
  assert.equal(inRoom({ x: 1000, y: 500 }, layout.rooms[0].polygon), true)
  assert.equal(inRoom({ x: 1000, y: 500 }, layout.rooms[1].polygon), true)
  assert.equal(inRoom({ x: 2500, y: 500 }, layout.rooms[1].polygon), false)
})

test('room contents use canonical IDs and geometry', () => {
  assert.deepEqual(roomContents(layout, 'left').ids, ['left', 'shared-door', 'chair'])
  assert.deepEqual(roomContents(layout, 'right').ids, ['right', 'shared-door', 'sink'])
  assert.deepEqual(roomContents(layout, 'missing').ids, ['missing'])
})

test('inspector findings include only supplied associations and retain verdicts', () => {
  const findings: ConstraintFinding[] = [
    { id: 'door-width', goalId: 'one', verdict: 'fail', affectedElementIds: ['shared-door'], explanation: 'Doorway below goal', measuredMm: 800, requiredMm: 850 },
    { id: 'route', goalId: 'two', verdict: 'unknown', affectedElementIds: ['sink'], explanation: 'Route not measured' },
  ]
  assert.deepEqual(roomFindings(findings, roomContents(layout, 'left').ids).map((item) => item.id), ['door-width'])
  assert.deepEqual(roomFindings(findings, roomContents(layout, 'right').ids).map((item) => [item.id, item.verdict]), [['door-width', 'fail'], ['route', 'unknown']])
  assert.deepEqual(roomFindings(undefined, ['left']), [])
})
