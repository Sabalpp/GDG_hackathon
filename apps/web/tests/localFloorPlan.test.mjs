import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzeFloorPlanPixels } from '../src/analysis/localFloorPlan.ts'

function drawing(width = 1000, height = 720) {
  const data = new Uint8ClampedArray(width * height * 4)
  data.fill(255)
  const stroke = (x1, y1, x2, y2, thickness = 12) => {
    for (let y = Math.max(0, y1 - thickness / 2); y <= Math.min(height - 1, y2 + thickness / 2); y++) {
      for (let x = Math.max(0, x1 - thickness / 2); x <= Math.min(width - 1, x2 + thickness / 2); x++) {
        const offset = (Math.floor(y) * width + Math.floor(x)) * 4
        data[offset] = data[offset + 1] = data[offset + 2] = 20
      }
    }
  }
  return { width, height, data, stroke }
}

test('detects walls, rooms, and a door from high contrast pixels', () => {
  const image = drawing()
  image.stroke(120, 120, 870, 120)
  image.stroke(120, 620, 870, 620)
  image.stroke(120, 120, 120, 620)
  image.stroke(870, 120, 870, 620)
  image.stroke(420, 120, 420, 260)
  image.stroke(420, 320, 420, 620)
  image.stroke(120, 370, 225, 370)
  image.stroke(285, 370, 420, 370)
  const result = analyzeFloorPlanPixels(image, 12000, 8000)
  assert.equal(result.source, 'image-inferred')
  assert.ok(result.layout.walls.length >= 6)
  assert.ok(result.layout.rooms.length >= 2)
  assert.ok(result.layout.doors.length >= 1)
  assert.ok(result.layout.walls.every((wall) => wall.source === 'image-inferred' && wall.confidence > 0))
})

test('rejects drawings without detectable walls', () => {
  assert.throws(() => analyzeFloorPlanPixels(drawing(), 12000, 8000), /wall lines/)
})
