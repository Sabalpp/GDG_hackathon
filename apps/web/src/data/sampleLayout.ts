import type { Layout } from '../contracts'

// Calibrated local demo fixture. Every coordinate and dimension is in millimeters.
export const sampleLayout: Layout = {
  id: 'sample-apartment-v1',
  units: 'mm',
  rooms: [
    { id: 'living', label: 'Living / sleeping', polygon: [{ x: 0, y: 0 }, { x: 4200, y: 0 }, { x: 4200, y: 4500 }, { x: 0, y: 4500 }] },
    { id: 'bath', label: 'Bath', polygon: [{ x: 4200, y: 0 }, { x: 6000, y: 0 }, { x: 6000, y: 2200 }, { x: 4200, y: 2200 }] },
    { id: 'kitchen', label: 'Kitchen', polygon: [{ x: 4200, y: 2200 }, { x: 6000, y: 2200 }, { x: 6000, y: 4500 }, { x: 4200, y: 4500 }] },
  ],
  walls: [
    { id: 'wall-north', start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thickness: 150, editable: false },
    { id: 'wall-east', start: { x: 6000, y: 0 }, end: { x: 6000, y: 4500 }, thickness: 150, editable: false },
    { id: 'wall-south', start: { x: 6000, y: 4500 }, end: { x: 0, y: 4500 }, thickness: 150, editable: false },
    { id: 'wall-west', start: { x: 0, y: 4500 }, end: { x: 0, y: 0 }, thickness: 150, editable: false },
    { id: 'partition-east', start: { x: 4200, y: 0 }, end: { x: 4200, y: 4500 }, thickness: 100, editable: false },
    { id: 'partition-bath', start: { x: 4200, y: 2200 }, end: { x: 6000, y: 2200 }, thickness: 100, editable: false },
  ],
  doors: [
    { id: 'bath-door', wallId: 'partition-east', center: { x: 4200, y: 1150 }, clearWidth: 760, swing: 'right', editable: true, source: 'calibrated demo fixture' },
  ],
  objects: [
    { id: 'sofa', kind: 'furniture', label: 'Sofa', bounds: { x: 550, y: 550, width: 1750, height: 800 }, movable: true },
    { id: 'bed', kind: 'furniture', label: 'Bed', bounds: { x: 650, y: 2700, width: 2000, height: 1500 }, movable: true },
    { id: 'counter', kind: 'fixture', label: 'Kitchen counter', bounds: { x: 4850, y: 3200, width: 1050, height: 1100 }, movable: false },
    { id: 'bath-fixture', kind: 'fixture', label: 'Bath fixture', bounds: { x: 5050, y: 400, width: 700, height: 1200 }, movable: false },
  ],
}
