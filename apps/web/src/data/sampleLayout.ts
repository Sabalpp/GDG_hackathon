import type { Layout } from '../contracts'
import canonical from '../../../../data/sample-layout.json'

// The one canonical sample shared with the geometry service and the smoke tests.
// Every coordinate and dimension is in millimeters.
export const sampleLayout = canonical as Layout
