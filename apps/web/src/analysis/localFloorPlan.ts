import type { Layout, Point2D } from '../contracts'

export type PixelImage = { width: number; height: number; data: Uint8ClampedArray }
export type LocalPlanResult = { layout: Layout; notes: string[]; source: 'image-inferred' }

type Band = { center: number; thickness: number }
type Run = { start: number; end: number }
type DetectedWall = { axis: 'h' | 'v'; fixed: number; start: number; end: number; thickness: number; gaps: Run[]; confidence: number }

function bands(projection: Uint32Array, minPixels: number, minThickness: number): Band[] {
  const result: Band[] = []
  let start = -1
  for (let index = 0; index <= projection.length; index++) {
    const active = index < projection.length && projection[index] >= minPixels
    if (active && start < 0) start = index
    if ((!active || index === projection.length) && start >= 0) {
      const end = index - 1
      if (end - start + 1 >= minThickness) {
        let weighted = 0
        let total = 0
        for (let position = start; position <= end; position++) {
          weighted += position * projection[position]
          total += projection[position]
        }
        result.push({ center: Math.round(weighted / total), thickness: end - start + 1 })
      }
      start = -1
    }
  }
  return result
}

function runs(values: boolean[], minLength: number): Run[] {
  const result: Run[] = []
  let start = -1
  for (let index = 0; index <= values.length; index++) {
    if (index < values.length && values[index] && start < 0) start = index
    if ((index === values.length || !values[index]) && start >= 0) {
      if (index - start >= minLength) result.push({ start, end: index - 1 })
      start = -1
    }
  }
  return result
}

function chooseBounds(vertical: Band[], horizontal: Band[], width: number, height: number, aspect: number) {
  let best: { left: number; right: number; top: number; bottom: number; score: number } | undefined
  for (let left = 0; left < vertical.length; left++) for (let right = left + 1; right < vertical.length; right++) {
    const planWidth = vertical[right].center - vertical[left].center
    if (planWidth < width * 0.35) continue
    for (let top = 0; top < horizontal.length; top++) for (let bottom = top + 1; bottom < horizontal.length; bottom++) {
      const planHeight = horizontal[bottom].center - horizontal[top].center
      if (planHeight < height * 0.35) continue
      const ratioError = Math.abs(Math.log((planWidth / planHeight) / aspect))
      const areaReward = 0.08 * (planWidth * planHeight) / (width * height)
      const score = ratioError - areaReward
      if (!best || score < best.score) best = {
        left: vertical[left].center, right: vertical[right].center,
        top: horizontal[top].center, bottom: horizontal[bottom].center, score,
      }
    }
  }
  if (!best || Math.abs(Math.log(((best.right - best.left) / (best.bottom - best.top)) / aspect)) > 0.28) {
    throw new Error('The outside walls could not be matched to the dimensions entered. Try a clearer, straight-on plan image.')
  }
  return best
}

function detectWalls(binary: Uint8Array, imageWidth: number, imageHeight: number, axis: 'h' | 'v', wallBands: Band[], outer: { left: number; right: number; top: number; bottom: number }): DetectedWall[] {
  const from = axis === 'h' ? outer.left : outer.top
  const to = axis === 'h' ? outer.right : outer.bottom
  const length = to - from + 1
  const result: DetectedWall[] = []
  for (const band of wallBands) {
    const fixed = band.center
    if (fixed < (axis === 'h' ? outer.top : outer.left) - 2 || fixed > (axis === 'h' ? outer.bottom : outer.right) + 2) continue
    const half = Math.max(1, Math.floor(band.thickness / 2))
    const present: boolean[] = []
    for (let position = from; position <= to; position++) {
      let dark = 0
      for (let delta = -half; delta <= half; delta++) {
        const x = axis === 'h' ? position : fixed + delta
        const y = axis === 'h' ? fixed + delta : position
        if (x >= 0 && x < imageWidth && y >= 0 && y < imageHeight) dark += binary[y * imageWidth + x]
      }
      present.push(dark >= Math.max(2, Math.ceil(band.thickness * 0.4)))
    }
    const raw = runs(present, Math.max(12, Math.round(length * 0.025)))
      .map((run) => ({ start: run.start + from, end: run.end + from }))
    if (!raw.length) continue
    const maxOpening = Math.max(22, Math.min(95, Math.round(length * 0.14)))
    let group: Run[] = [raw[0]]
    const save = () => {
      const start = group[0].start
      const end = group[group.length - 1].end
      if (end - start < Math.max(70, length * 0.12)) return
      const gaps: Run[] = []
      for (let index = 1; index < group.length; index++) {
        const gap = { start: group[index - 1].end + 1, end: group[index].start - 1 }
        if (gap.end - gap.start + 1 >= 12) gaps.push(gap)
      }
      const support = group.reduce((sum, run) => sum + run.end - run.start + 1, 0) / (end - start + 1)
      result.push({ axis, fixed, start, end, thickness: band.thickness, gaps, confidence: Math.max(0.35, Math.min(0.9, support)) })
    }
    for (let index = 1; index < raw.length; index++) {
      if (raw[index].start - group[group.length - 1].end - 1 <= maxOpening) group.push(raw[index])
      else { save(); group = [raw[index]] }
    }
    save()
  }
  return result
}

function coverage(walls: DetectedWall[], axis: 'h' | 'v', fixed: number, start: number, end: number) {
  const matching = walls.filter((wall) => wall.axis === axis && Math.abs(wall.fixed - fixed) <= 3)
  const intervals = matching.map((wall) => ({ start: Math.max(start, wall.start), end: Math.min(end, wall.end) }))
    .filter((interval) => interval.end > interval.start).sort((a, b) => a.start - b.start)
  let covered = 0
  let lastEnd = start
  for (const interval of intervals) {
    covered += Math.max(0, interval.end - Math.max(lastEnd, interval.start))
    lastEnd = Math.max(lastEnd, interval.end)
  }
  return covered / Math.max(1, end - start)
}

function detectRooms(walls: DetectedWall[], outer: { left: number; right: number; top: number; bottom: number }) {
  const xs = [...new Set([outer.left, outer.right, ...walls.filter((wall) => wall.axis === 'v').map((wall) => wall.fixed)])].sort((a, b) => a - b)
  const ys = [...new Set([outer.top, outer.bottom, ...walls.filter((wall) => wall.axis === 'h').map((wall) => wall.fixed)])].sort((a, b) => a - b)
  const candidates: { left: number; right: number; top: number; bottom: number }[] = []
  for (let left = 0; left < xs.length; left++) for (let right = left + 1; right < xs.length; right++) {
    if (xs[right] - xs[left] < 65) continue
    for (let top = 0; top < ys.length; top++) for (let bottom = top + 1; bottom < ys.length; bottom++) {
      if (ys[bottom] - ys[top] < 65) continue
      const box = { left: xs[left], right: xs[right], top: ys[top], bottom: ys[bottom] }
      if (coverage(walls, 'v', box.left, box.top, box.bottom) < 0.85 || coverage(walls, 'v', box.right, box.top, box.bottom) < 0.85
        || coverage(walls, 'h', box.top, box.left, box.right) < 0.85 || coverage(walls, 'h', box.bottom, box.left, box.right) < 0.85) continue
      const divided = walls.some((wall) => wall.axis === 'v' && wall.fixed > box.left + 3 && wall.fixed < box.right - 3
        && coverage(walls, 'v', wall.fixed, box.top, box.bottom) > 0.7)
        || walls.some((wall) => wall.axis === 'h' && wall.fixed > box.top + 3 && wall.fixed < box.bottom - 3
          && coverage(walls, 'h', wall.fixed, box.left, box.right) > 0.7)
      if (!divided) candidates.push(box)
    }
  }
  candidates.sort((a, b) => (a.right - a.left) * (a.bottom - a.top) - (b.right - b.left) * (b.bottom - b.top))
  const rooms: typeof candidates = []
  for (const box of candidates) {
    if (rooms.some((other) => Math.min(box.right, other.right) - Math.max(box.left, other.left) > 3
      && Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 3)) continue
    rooms.push(box)
  }
  return rooms.length ? rooms.slice(0, 16) : [{ left: outer.left, right: outer.right, top: outer.top, bottom: outer.bottom }]
}

export function analyzeFloorPlanPixels(image: PixelImage, widthMm: number, heightMm: number): LocalPlanResult {
  const { width, height, data } = image
  if (width < 200 || height < 150 || data.length < width * height * 4) throw new Error('The plan image is too small or could not be read.')
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm < 500 || heightMm < 500) throw new Error("Enter the drawing's overall width and height in millimeters.")
  const binary = new Uint8Array(width * height)
  const rows = new Uint32Array(height)
  const columns = new Uint32Array(width)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x
    const offset = index * 4
    const luminance = 0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]
    if (data[offset + 3] > 120 && luminance < 155) {
      binary[index] = 1
      rows[y]++
      columns[x]++
    }
  }
  const minThickness = Math.max(3, Math.round(Math.min(width, height) * 0.004))
  const horizontal = bands(rows, Math.round(width * 0.12), minThickness)
  const vertical = bands(columns, Math.round(height * 0.12), minThickness)
  if (horizontal.length < 2 || vertical.length < 2) throw new Error('Could not detect enough straight wall lines. Use a clear, high-contrast floor plan.')
  const outer = chooseBounds(vertical, horizontal, width, height, widthMm / heightMm)
  const detected = [
    ...detectWalls(binary, width, height, 'h', horizontal, outer),
    ...detectWalls(binary, width, height, 'v', vertical, outer),
  ]
  if (detected.length < 4) throw new Error('Could not trace the outside walls. Try a clearer plan image.')
  const roomBoxes = detectRooms(detected, outer)
  const scaleX = widthMm / (outer.right - outer.left)
  const scaleY = heightMm / (outer.bottom - outer.top)
  const point = (x: number, y: number): Point2D => ({ x: Math.round((x - outer.left) * scaleX), y: Math.round((y - outer.top) * scaleY) })
  const walls: Layout['walls'] = []
  const doors: Layout['doors'] = []
  for (const segment of detected) {
    const id = `image-wall-${walls.length + 1}`
    const start = segment.axis === 'h' ? point(segment.start, segment.fixed) : point(segment.fixed, segment.start)
    const end = segment.axis === 'h' ? point(segment.end, segment.fixed) : point(segment.fixed, segment.end)
    if (Math.hypot(end.x - start.x, end.y - start.y) < 100) continue
    walls.push({ id, start, end, thickness: Math.max(25, Math.round(segment.thickness * Math.min(scaleX, scaleY))), editable: false, source: 'image-inferred', confidence: segment.confidence })
    for (const gap of segment.gaps) {
      const clearWidth = Math.round((gap.end - gap.start + 1) * (segment.axis === 'h' ? scaleX : scaleY))
      const center = segment.axis === 'h' ? point((gap.start + gap.end) / 2, segment.fixed) : point(segment.fixed, (gap.start + gap.end) / 2)
      if (clearWidth < 200 || clearWidth > 2400) continue
      doors.push({ id: `image-door-${doors.length + 1}`, wallId: id, center, clearWidth, editable: false, source: 'image-inferred', confidence: Math.min(0.7, segment.confidence) })
    }
  }
  const rooms: Layout['rooms'] = roomBoxes.map((box, index) => ({
    id: `image-room-${index + 1}`, label: `Room ${index + 1}`,
    polygon: [point(box.left, box.top), point(box.right, box.top), point(box.right, box.bottom), point(box.left, box.bottom)],
  }))
  return {
    layout: { id: `image-plan-${crypto.randomUUID()}`, units: 'mm', walls, doors, objects: [], rooms },
    notes: [
      'Straight dark lines and rectangular spaces were detected. Review the 2D result against the original drawing.',
      'Door openings are estimated from visible gaps. Room names and furniture are not read from the image.',
    ],
    source: 'image-inferred',
  }
}

export async function analyzeFloorPlanFile(file: File, widthMm: number, heightMm: number): Promise<LocalPlanResult> {
  if (file.size > 8 * 1024 * 1024) throw new Error('Floor-plan images must be 8 MB or smaller.')
  if (!['image/png', 'image/jpeg', 'image/svg+xml'].includes(file.type.toLowerCase())) throw new Error('Choose a PNG, JPEG, or SVG floor-plan image.')
  const url = URL.createObjectURL(file)
  const image = new Image()
  try {
    image.src = url
    try { await image.decode() }
    catch { throw new Error('This floor-plan image could not be opened.') }
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(image.naturalWidth * scale)
    canvas.height = Math.round(image.naturalHeight * scale)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('The browser could not read this floor-plan image.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return analyzeFloorPlanPixels(context.getImageData(0, 0, canvas.width, canvas.height), widthMm, heightMm)
  } finally { URL.revokeObjectURL(url) }
}
