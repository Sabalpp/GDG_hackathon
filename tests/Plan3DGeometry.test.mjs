import assert from 'node:assert/strict';
import test from 'node:test';
import { boundsCenter, layoutBounds, mmToMeters, planToScene, pointOnWall, wallOpenings } from '../src/components/Plan3DGeometry.ts';

const wall = { id: 'wall', start: { x: 4200, y: 0 }, end: { x: 4200, y: 4500 }, thickness: 100, editable: false };

test('millimeter conversion preserves the canonical x-right/y-down plan orientation', () => {
  assert.equal(mmToMeters(760), 0.76);
  assert.deepEqual(planToScene({ x: 6000, y: 4500 }, { x: 3000, y: 2250 }), [3, 2.25]);
});

test('a door cuts only its referenced wall and retains exact clear width', () => {
  const door = { id: 'bath-door', wallId: 'wall', center: { x: 4200, y: 1150 }, clearWidth: 760, editable: true };
  const { openings, runs } = wallOpenings(wall, [door]);
  assert.deepEqual(openings, [{ id: 'bath-door', startMm: 770, endMm: 1530 }]);
  assert.deepEqual(runs, [{ startMm: 0, endMm: 770 }, { startMm: 1530, endMm: 4500 }]);
  assert.deepEqual(pointOnWall(wall, openings[0].startMm), { x: 4200, y: 770 });
});

test('off-wall doors do not create invented openings', () => {
  const door = { id: 'unplaced', wallId: 'wall', center: { x: 5000, y: 1150 }, clearWidth: 900, editable: true };
  assert.deepEqual(wallOpenings(wall, [door]), { openings: [], runs: [{ startMm: 0, endMm: 4500 }] });
});

test('the scene bounds come from the supplied layout rather than a fixed apartment', () => {
  const layout = { id: 'tiny', units: 'mm', rooms: [{ id: 'r', label: 'Room', polygon: [{ x: 100, y: 200 }, { x: 2100, y: 200 }, { x: 2100, y: 3200 }, { x: 100, y: 3200 }] }], walls: [], doors: [], objects: [] };
  const bounds = layoutBounds(layout);
  assert.deepEqual(bounds, { minX: 100, minY: 200, maxX: 2100, maxY: 3200 });
  assert.deepEqual(boundsCenter(bounds), { x: 1100, y: 1700 });
});
