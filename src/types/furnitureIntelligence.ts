/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P33 — Furniture & Circulation Intelligence Type Contracts
 * Account A | Locked Roadmap: P33 of P30–P40
 */

import { MeasurementUnit } from './project';

export const P33_FURNITURE_ENGINE_VERSION = 'p33-furniture-circulation-v1.0.0';

export type FurnitureCategory =
  | 'sleeping'
  | 'seating-living'
  | 'dining'
  | 'work-office'
  | 'storage-cabinetry'
  | 'kitchen-casework'
  | 'bathroom-fixtures'
  | 'utility-laundry';

/**
 * Current 2D floor-plan renderer and AABB geometry engine reliably support rectangular footprints.
 * Oriented rectangles (0°, 90°, 180°, 270° or finite angle) are validated via exact bounding boxes.
 */
export type FurnitureFootprintShape = 'rectangle';

/**
 * Epistemic provenance of furniture dimensions:
 * - 'illustrative-template-default': Generic starter planning dimensions (NOT manufacturer-verified product specs).
 * - 'user-edited-custom': Dimensions explicitly customized by the user.
 * - 'user-verified-spec': Dimensions explicitly entered and marked verified by the user.
 */
export type DimensionProvenance =
  | 'illustrative-template-default'
  | 'user-edited-custom'
  | 'user-verified-spec';

export interface FurnitureCatalogTemplate {
  templateId: string;
  category: FurnitureCategory;
  name: string;
  description: string;
  /** Room types where this template is commonly placed (e.g. ['bedroom'], ['living', 'dining']) */
  supportedRoomTypes: string[];
  footprintShape: FurnitureFootprintShape;
  defaultDimensionsFeet: {
    width: number;
    depth: number;
    height: number;
  };
  defaultDimensionsMetres: {
    width: number;
    depth: number;
    height: number;
  };
  recommendedClearanceFeet: {
    front: number;
    sides: number;
    rear: number;
  };
  recommendedClearanceMetres: {
    front: number;
    sides: number;
    rear: number;
  };
  provenance: DimensionProvenance;
  provenanceDisclosure: string;
  allowResize: boolean;
  colorHex: string;
  isCustomTemplate?: boolean;
}

export interface PlacedFurnitureInstance {
  instanceId: string;
  templateId: string;
  projectId: string;
  roomId: string;
  floorLevel: number;
  name: string;
  category: FurnitureCategory;
  footprintShape: FurnitureFootprintShape;
  /** Top-left X coordinate in plot units (feet or metres) */
  x: number;
  /** Top-left Y coordinate in plot units (feet or metres) */
  y: number;
  /** Unrotated width (X-axis at 0 deg) in `unit` */
  width: number;
  /** Unrotated depth (Y-axis at 0 deg) in `unit` */
  depth: number;
  /** Vertical height in `unit` */
  height: number;
  unit: MeasurementUnit;
  /** Rotation angle in degrees (typically 0, 90, 180, 270) */
  rotationDeg: number;
  clearanceOverrides?: {
    front?: number;
    sides?: number;
    rear?: number;
  };
  dimensionProvenance: DimensionProvenance;
  isLocked?: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Explicit door or opening geometry for a room.
 * CRITICAL P33 RULE: Never fabricated when absent from project data.
 * Only present when explicitly defined by the user or imported from verified opening records.
 */
export interface KnownRoomOpening {
  openingId: string;
  roomId: string;
  floorLevel: number;
  type: 'door' | 'window' | 'open-passage';
  label: string;
  wallEdge: 'north' | 'south' | 'east' | 'west';
  /** Distance from top-left corner of that room wall in `unit` */
  offsetAlongWall: number;
  /** Opening width in `unit` */
  width: number;
  swingDirection:
    | 'inward-left'
    | 'inward-right'
    | 'outward'
    | 'sliding-or-none'
    | 'unknown';
  /** Swing projection depth into the room when inward-swinging (in `unit`) */
  swingDepth?: number;
  provenance: 'user-entered' | 'imported-floorplan';
}

export interface KnownFixedRoomObstacle {
  obstacleId: string;
  label: string;
  kind: 'structural-column' | 'mep-equipment' | 'user-fixed-zone';
  floorLevel: number;
  x: number;
  y: number;
  width: number;
  depth: number;
  sourceReference: string;
}

/**
 * Explicit, user-configurable circulation clearance thresholds.
 * P33 distinguishes geometric measurements from configurable design heuristics
 * and never claims statutory accessibility compliance (reserved for P34).
 */
export interface CirculationClearanceThresholds {
  unit: MeasurementUnit;
  /** Primary walkway / corridor width threshold (e.g. 3.0 ft or 0.90 m) */
  primaryWalkwayWidth: number;
  /** Secondary passage / between-furniture passable width (e.g. 2.5 ft or 0.75 m) */
  secondaryPassageWidth: number;
  /** Minimum clearance around interactive furniture fronts (e.g. 2.0 ft or 0.60 m) */
  furnitureFrontClearance: number;
  /** Clear depth required in front of a known doorway (e.g. 3.0 ft or 0.90 m) */
  doorwayApproachClearDepth: number;
  thresholdProvenance: 'illustrative-planning-default' | 'user-configured';
  nonComplianceDisclaimer: string;
}

export interface CirculationRouteQuery {
  id: string;
  roomId: string;
  floorLevel: number;
  label: string;
  startPoint: {
    x: number;
    y: number;
    source: 'known-door' | 'user-selected-point';
    openingId?: string;
  };
  endPoint: {
    x: number;
    y: number;
    source: 'known-door' | 'furniture-front' | 'user-selected-point';
    openingId?: string;
    targetInstanceId?: string;
  };
}

export type FurnitureDiagnosticCategory =
  | 'furniture-collision'
  | 'room-boundary-overflow'
  | 'invalid-room-or-floor'
  | 'invalid-dimensions-or-coords'
  | 'door-opening-obstruction'
  | 'door-swing-obstruction'
  | 'fixed-object-collision'
  | 'clearance-zone-violation'
  | 'circulation-route-blocked'
  | 'missing-opening-or-route-data';

export interface FurnitureValidationDiagnostic {
  id: string;
  category: FurnitureDiagnosticCategory;
  severity: 'conflict' | 'warning' | 'info' | 'unavailable';
  roomId: string | null;
  roomName?: string;
  floorLevel: number | null;
  affectedInstanceIds: string[];
  affectedOpeningId?: string;
  affectedFixedObstacleId?: string;
  calculationMethod: string;
  measuredValue: string;
  thresholdUsed?: string;
  explanation: string;
  suggestedAdjustment?: string;
  isCompleteData: boolean;
  missingInputs: string[];
  collisionRect?: {
    x: number;
    y: number;
    width: number;
    length: number;
  };
}

export interface CirculationRouteResult {
  routeId: string;
  roomId: string;
  roomName: string;
  floorLevel: number;
  label: string;
  status:
    | 'passable-meets-threshold'
    | 'passable-narrow'
    | 'blocked'
    | 'insufficient-data';
  gridCellSize: number;
  requiredClearanceWidth: number;
  minimumMeasuredClearanceAlongPath: number | null;
  pathLength: number | null;
  straightLineDistance: number | null;
  pathWaypoints: Array<{ x: number; y: number }>;
  bottleneckPoint?: {
    x: number;
    y: number;
    clearance: number;
    causedBy: string;
  };
  blockingInstanceIds: string[];
  explanation: string;
  methodAndApproximationNote: string;
}

export interface RoomCirculationMetrics {
  roomId: string;
  roomName: string;
  roomType: string;
  floorLevel: number;
  grossRoomArea: number;
  occupiedFurnitureArea: number;
  occupiedFixedObstacleArea: number;
  netFreeFloorArea: number;
  furnitureDensityPercent: number;
  freeFloorRatioPercent: number;
  placedInstanceCount: number;
  knownDoorCount: number;
  hasMissingDoorData: boolean;
  collisionCount: number;
  boundaryOverflowCount: number;
  clearanceWarningCount: number;
  doorConflictCount: number;
  fixedObjectConflictCount: number;
  minPairwiseFurnitureGap: number | null;
  routesEvaluated: CirculationRouteResult[];
}

export interface FurnitureLayoutSuggestion {
  suggestionId: string;
  type:
    | 'resolve-collision'
    | 'resolve-boundary-overflow'
    | 'resolve-door-conflict'
    | 'improve-clearance-rotation'
    | 'relocate-for-route'
    | 'p30-p32-starter-arrangement';
  title: string;
  targetRoomId: string;
  targetRoomName: string;
  targetInstanceIds: string[];
  triggerDiagnosticIds: string[];
  influencedByP30Requirements: string[];
  influencedByP32Preferences: string[];
  rationale: string;
  evidenceBasis:
    | 'computed-geometric-resolution'
    | 'deterministic-heuristic-with-confirmed-preferences';
  proposedChanges: Array<{
    instanceId: string;
    instanceName: string;
    action: 'move' | 'rotate' | 'resize' | 'place-new';
    beforeSummary: string;
    afterSummary: string;
    proposedInstance: PlacedFurnitureInstance;
  }>;
  expectedImprovementSummary: string;
}

export interface FurnitureSuggestionPreviewDiff {
  suggestionId: string;
  title: string;
  targetRoomId: string;
  beforeConflictCount: number;
  afterConflictCount: number;
  beforeWarningCount: number;
  afterWarningCount: number;
  beforeFreeFloorRatioPercent: number;
  afterFreeFloorRatioPercent: number;
  isSafeToApply: boolean;
  safetyNotes: string[];
  proposedInstances: PlacedFurnitureInstance[];
}

export interface P33OptionComparisonSummary {
  projectId: string;
  engineVersion: string;
  totalPlacedFurnitureCount: number;
  furnishedRoomsCount: number;
  totalRoomsCount: number;
  totalCollisionCount: number;
  totalBoundaryOverflowCount: number;
  totalDoorConflictCount: number;
  totalClearanceWarningCount: number;
  averageFreeFloorRatioPercent: number | null;
  blockedRoutesCount: number;
  unassessedDoorRoomsCount: number;
  noteForP31Comparison: string;
}

export interface FurnitureIntelligenceEvaluationResult {
  evaluationId: string;
  engineVersion: string;
  projectId: string;
  projectName: string;
  unit: MeasurementUnit;
  evaluatedAt: string;
  requestSequenceId: number;
  sourceFingerprint: string;
  clearanceThresholds: CirculationClearanceThresholds;
  diagnostics: FurnitureValidationDiagnostic[];
  roomMetrics: RoomCirculationMetrics[];
  suggestions: FurnitureLayoutSuggestion[];
  p30CompatibilitySummary: {
    confirmedRequirementsUsed: string[];
    unconfirmedAssumptionsIgnored: number;
    unresolvedBriefConflictsCount: number;
  };
  p32CompatibilitySummary: {
    hasPersonalizationProfile: boolean;
    confirmedPreferencesUsed: string[];
    unconfirmedSuggestionsIgnored: number;
  };
  p31ExportSummary: P33OptionComparisonSummary;
  p34BoundaryDisclaimer: string;
}

export interface ProjectFurnitureLayoutData {
  version: string;
  unit: MeasurementUnit;
  customTemplates: FurnitureCatalogTemplate[];
  instances: PlacedFurnitureInstance[];
  knownOpenings: KnownRoomOpening[];
  clearanceThresholds: CirculationClearanceThresholds;
  customRoutes: CirculationRouteQuery[];
  lastSavedAt: string;
  lastPreSaveSnapshotId?: string | null;
  requestSequenceId: number;
}
