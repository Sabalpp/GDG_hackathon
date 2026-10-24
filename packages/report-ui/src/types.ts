// Structural mirror of the frozen contracts (spec §6 / services/geometry/app/models.py).
// Swap these for imports from @adapt/contracts once Dev B publishes that package;
// the shapes are identical, so no component code changes.

export type Verdict = 'pass' | 'fail' | 'unknown';

export interface Point2D { x: number; y: number }
export interface Rect2D extends Point2D { width: number; height: number }

export interface Layout {
  id: string;
  units: 'mm';
  walls: { id: string; editable?: boolean }[];
  doors: { id: string; clearWidth?: number | null }[];
  objects: { id: string; label: string; kind: 'furniture' | 'fixture'; bounds: Rect2D }[];
  rooms: { id: string; label: string }[];
}

export interface Goal {
  id: string;
  type: 'minimum-door-width' | 'minimum-path-width' | 'reachable-route';
  targetMm?: number | null;
  fromRoomId?: string | null;
  toRoomId?: string | null;
  status: 'draft' | 'confirmed';
}

export interface ConstraintFinding {
  id: string;
  goalId: string;
  verdict: Verdict;
  measuredMm?: number | null;
  requiredMm?: number | null;
  affectedElementIds: string[];
  explanation: string;
}

export interface Summary {
  passCount: number;
  failCount: number;
  unknownCount: number;
  allPassed: boolean;
}

export interface Modification {
  id: string;
  type: 'move-furniture' | 'resize-demo-door' | 'move-demo-partition';
  targetElementId: string;
  params: Record<string, string | number>;
  requiresProfessionalReview: boolean;
}

export interface CostLine {
  modificationId: string;
  title: string;
  lowUsd: number;
  highUsd: number;
  basis: string;
  status: 'illustrative';
}

export interface Proposal {
  id: string;
  originalLayoutId: string;
  resultLayout: Layout;
  modifications: Modification[];
  findingsBefore: ConstraintFinding[];
  findingsAfter: ConstraintFinding[];
  costs: CostLine[];
  unresolvedQuestions: string[];
}

export interface Budget { currency: 'USD'; max: number }

export interface CostCatalogItem {
  type: Modification['type'];
  title: string;
  lowUsd: number;
  highUsd: number;
  basis: string;
}
