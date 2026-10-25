import sampleLayoutJson from '../../../../data/sample-layout.json'
import type { Layout } from '../contracts'

// The UI and geometry service use this shared, calibrated millimeter fixture.
export const sampleLayout = sampleLayoutJson as unknown as Layout
