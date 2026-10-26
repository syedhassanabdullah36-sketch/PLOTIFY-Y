/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P33 — Furniture & Circulation Intelligence Service
 * Account A | Locked Roadmap: P33 of P30–P40
 *
 * Deterministic furniture catalog, placement, room containment, collision detection,
 * known opening/swing zone conflict validation, fixed-obstacle checking, grid-based
 * circulation routing & clearance measurement, explainable layout improvement suggestions,
 * and safe non-destructive persistence with snapshot rollback.
 */

import { Project, MeasurementUnit, FloorPlanRoom } from '../types/project';
import {
  P33_FURNITURE_ENGINE_VERSION,
  FurnitureCategory,
  FurnitureCatalogTemplate,
  PlacedFurnitureInstance,
  KnownRoomOpening,
  KnownFixedRoomObstacle,
  CirculationClearanceThresholds,
  CirculationRouteQuery,
  FurnitureValidationDiagnostic,
  CirculationRouteResult,
  RoomCirculationMetrics,
  FurnitureLayoutSuggestion,
  FurnitureSuggestionPreviewDiff,
  P33OptionComparisonSummary,
  FurnitureIntelligenceEvaluationResult,
  ProjectFurnitureLayoutData,
  DimensionProvenance,
} from '../types/furnitureIntelligence';
import {
  createProjectSnapshot,
  executeSafeRestore,
  getProjectSnapshots,
} from './versioningService';
import { ProjectSnapshot } from '../types/versioning';

const inMemoryP33Snapshots = new Map<string, ProjectSnapshot>();

const FEET_PER_METRE = 3.28084;
const METRES_PER_FOOT = 0.3048;
const EPSILON = 1e-4;

export const P34_BOUNDARY_DISCLAIMER =
  'P33 evaluates general furniture fit, configurable planning clearances, and circulation route passability. It does NOT perform Universal Accessibility Review (wheelchair turning radii, accessible fixture transfer spaces, or statutory accessibility code compliance), which belongs to P34.';

export const STARTER_FURNITURE_CATALOG: FurnitureCatalogTemplate[] = [
  // 1. Sleeping
  {
    templateId: 'tpl-bed-queen',
    category: 'sleeping',
    name: 'Queen Bed',
    description: 'Standard double/queen bed frame for primary or guest bedrooms.',
    supportedRoomTypes: ['bedroom'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 5.0, depth: 6.67, height: 3.0 },
    defaultDimensionsMetres: { width: 1.52, depth: 2.03, height: 0.91 },
    recommendedClearanceFeet: { front: 2.5, sides: 2.0, rear: 0.0 },
    recommendedClearanceMetres: { front: 0.76, sides: 0.61, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (5.0 ft × 6.67 ft / 1.52 m × 2.03 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#6366f1',
  },
  {
    templateId: 'tpl-bed-single',
    category: 'sleeping',
    name: 'Single / Twin Bed',
    description: 'Compact single bed for secondary, child, or compact guest bedrooms.',
    supportedRoomTypes: ['bedroom'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 3.25, depth: 6.25, height: 2.8 },
    defaultDimensionsMetres: { width: 0.99, depth: 1.9, height: 0.85 },
    recommendedClearanceFeet: { front: 2.0, sides: 2.0, rear: 0.0 },
    recommendedClearanceMetres: { front: 0.61, sides: 0.61, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (3.25 ft × 6.25 ft / 0.99 m × 1.90 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#818cf8',
  },
  {
    templateId: 'tpl-nightstand',
    category: 'sleeping',
    name: 'Bedside Nightstand',
    description: 'Compact bedside table for bedroom sleeping zones.',
    supportedRoomTypes: ['bedroom'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 1.8, depth: 1.5, height: 2.0 },
    defaultDimensionsMetres: { width: 0.55, depth: 0.46, height: 0.61 },
    recommendedClearanceFeet: { front: 1.5, sides: 0.25, rear: 0.0 },
    recommendedClearanceMetres: { front: 0.46, sides: 0.08, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (1.8 ft × 1.5 ft / 0.55 m × 0.46 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#a5b4fc',
  },
  // 2. Seating & Living
  {
    templateId: 'tpl-sofa-3seat',
    category: 'seating-living',
    name: '3-Seater Living Sofa',
    description: 'Primary living room sofa with front legroom clearance zone.',
    supportedRoomTypes: ['living', 'other'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 7.0, depth: 3.0, height: 2.8 },
    defaultDimensionsMetres: { width: 2.13, depth: 0.91, height: 0.85 },
    recommendedClearanceFeet: { front: 2.5, sides: 1.5, rear: 0.0 },
    recommendedClearanceMetres: { front: 0.76, sides: 0.46, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (7.0 ft × 3.0 ft / 2.13 m × 0.91 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#10b981',
  },
  {
    templateId: 'tpl-armchair',
    category: 'seating-living',
    name: 'Lounge Armchair',
    description: 'Single lounge chair for living or reading corners.',
    supportedRoomTypes: ['living', 'bedroom', 'other'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 2.8, depth: 2.8, height: 2.8 },
    defaultDimensionsMetres: { width: 0.85, depth: 0.85, height: 0.85 },
    recommendedClearanceFeet: { front: 2.0, sides: 1.0, rear: 0.0 },
    recommendedClearanceMetres: { front: 0.61, sides: 0.3, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (2.8 ft × 2.8 ft / 0.85 m × 0.85 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#34d399',
  },
  {
    templateId: 'tpl-coffee-table',
    category: 'seating-living',
    name: 'Coffee Table',
    description: 'Low table positioned in front of living seating.',
    supportedRoomTypes: ['living'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 4.0, depth: 2.0, height: 1.5 },
    defaultDimensionsMetres: { width: 1.22, depth: 0.61, height: 0.46 },
    recommendedClearanceFeet: { front: 1.5, sides: 1.5, rear: 1.5 },
    recommendedClearanceMetres: { front: 0.46, sides: 0.46, rear: 0.46 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (4.0 ft × 2.0 ft / 1.22 m × 0.61 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#6ee7b7',
  },
  // 3. Dining
  {
    templateId: 'tpl-dining-6seat',
    category: 'dining',
    name: '6-Person Dining Table Set',
    description: 'Rectangular dining table footprint including tucked chair envelope.',
    supportedRoomTypes: ['dining', 'living', 'kitchen'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 6.0, depth: 3.5, height: 2.5 },
    defaultDimensionsMetres: { width: 1.83, depth: 1.07, height: 0.76 },
    recommendedClearanceFeet: { front: 2.5, sides: 2.5, rear: 2.5 },
    recommendedClearanceMetres: { front: 0.76, sides: 0.76, rear: 0.76 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (6.0 ft × 3.5 ft / 1.83 m × 1.07 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#f59e0b',
  },
  // 4. Work & Study
  {
    templateId: 'tpl-work-desk',
    category: 'work-office',
    name: 'Study / Home Office Desk',
    description: 'Work desk with front chair pull-out clearance zone.',
    supportedRoomTypes: ['bedroom', 'living', 'other'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 4.5, depth: 2.25, height: 2.5 },
    defaultDimensionsMetres: { width: 1.37, depth: 0.69, height: 0.76 },
    recommendedClearanceFeet: { front: 3.0, sides: 1.0, rear: 0.0 },
    recommendedClearanceMetres: { front: 0.91, sides: 0.3, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (4.5 ft × 2.25 ft / 1.37 m × 0.69 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#0ea5e9',
  },
  // 5. Storage & Cabinetry
  {
    templateId: 'tpl-wardrobe',
    category: 'storage-cabinetry',
    name: '2-Door Wardrobe / Closet',
    description: 'Full-height bedroom or hallway storage wardrobe with door/drawer pull clearance.',
    supportedRoomTypes: ['bedroom', 'corridor', 'other'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 4.0, depth: 2.0, height: 7.0 },
    defaultDimensionsMetres: { width: 1.22, depth: 0.61, height: 2.13 },
    recommendedClearanceFeet: { front: 2.5, sides: 0.25, rear: 0.0 },
    recommendedClearanceMetres: { front: 0.76, sides: 0.08, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (4.0 ft × 2.0 ft / 1.22 m × 0.61 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#8b5cf6',
  },
  // 6. Kitchen Casework
  {
    templateId: 'tpl-kitchen-counter',
    category: 'kitchen-casework',
    name: 'Kitchen Base Counter Run',
    description: 'Standard depth kitchen base counter and appliance work zone.',
    supportedRoomTypes: ['kitchen'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 6.0, depth: 2.0, height: 3.0 },
    defaultDimensionsMetres: { width: 1.83, depth: 0.61, height: 0.91 },
    recommendedClearanceFeet: { front: 3.5, sides: 0.5, rear: 0.0 },
    recommendedClearanceMetres: { front: 1.07, sides: 0.15, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (6.0 ft × 2.0 ft / 1.83 m × 0.61 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#ec4899',
  },
  // 7. Bathroom Fixtures
  {
    templateId: 'tpl-bath-vanity',
    category: 'bathroom-fixtures',
    name: 'Bathroom Vanity & Basin',
    description: 'Countertop basin vanity with front standing zone.',
    supportedRoomTypes: ['bathroom'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 3.0, depth: 1.75, height: 2.8 },
    defaultDimensionsMetres: { width: 0.91, depth: 0.53, height: 0.85 },
    recommendedClearanceFeet: { front: 2.5, sides: 0.5, rear: 0.0 },
    recommendedClearanceMetres: { front: 0.76, sides: 0.15, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (3.0 ft × 1.75 ft / 0.91 m × 0.53 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#14b8a6',
  },
  {
    templateId: 'tpl-wc-fixture',
    category: 'bathroom-fixtures',
    name: 'WC / Toilet Fixture',
    description: 'Standard WC footprint with front user clearance.',
    supportedRoomTypes: ['bathroom'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 1.5, depth: 2.25, height: 2.5 },
    defaultDimensionsMetres: { width: 0.46, depth: 0.69, height: 0.76 },
    recommendedClearanceFeet: { front: 2.0, sides: 0.5, rear: 0.0 },
    recommendedClearanceMetres: { front: 0.61, sides: 0.15, rear: 0.0 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (1.5 ft × 2.25 ft / 0.46 m × 0.69 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#2dd4bf',
  },
  // 8. Utility & Laundry
  {
    templateId: 'tpl-laundry-washer',
    category: 'utility-laundry',
    name: 'Washer / Dryer Stack',
    description: 'Utility appliance footprint with front loading door clearance.',
    supportedRoomTypes: ['utility', 'bathroom', 'kitchen', 'other'],
    footprintShape: 'rectangle',
    defaultDimensionsFeet: { width: 2.5, depth: 2.5, height: 6.0 },
    defaultDimensionsMetres: { width: 0.76, depth: 0.76, height: 1.83 },
    recommendedClearanceFeet: { front: 3.0, sides: 0.25, rear: 0.25 },
    recommendedClearanceMetres: { front: 0.91, sides: 0.08, rear: 0.08 },
    provenance: 'illustrative-template-default',
    provenanceDisclosure:
      'Illustrative starter planning dimension (2.5 ft × 2.5 ft / 0.76 m × 0.76 m); not a manufacturer-verified product specification.',
    allowResize: true,
    colorHex: '#64748b',
  },
];

export function convertMeasurement(
  value: number,
  fromUnit: MeasurementUnit,
  toUnit: MeasurementUnit
): number {
  if (fromUnit === toUnit) return Number(value.toFixed(3));
  if (fromUnit === 'feet' && toUnit === 'metres') {
    return Number((value * METRES_PER_FOOT).toFixed(3));
  }
  return Number((value * FEET_PER_METRE).toFixed(3));
}

export function getDefaultClearanceThresholds(
  unit: MeasurementUnit
): CirculationClearanceThresholds {
  if (unit === 'metres') {
    return {
      unit: 'metres',
      primaryWalkwayWidth: 0.91,
      secondaryPassageWidth: 0.76,
      furnitureFrontClearance: 0.61,
      doorwayApproachClearDepth: 0.91,
      thresholdProvenance: 'illustrative-planning-default',
      nonComplianceDisclaimer: P34_BOUNDARY_DISCLAIMER,
    };
  }
  return {
    unit: 'feet',
    primaryWalkwayWidth: 3.0,
    secondaryPassageWidth: 2.5,
    furnitureFrontClearance: 2.0,
    doorwayApproachClearDepth: 3.0,
    thresholdProvenance: 'illustrative-planning-default',
    nonComplianceDisclaimer: P34_BOUNDARY_DISCLAIMER,
  };
}

export function ensureProjectFurnitureLayoutData(
  project: Project
): ProjectFurnitureLayoutData {
  const unit: MeasurementUnit = project.unit || 'feet';
  if (project.furnitureLayout) {
    // Normalize thresholds if unit changed
    const current = project.furnitureLayout;
    const normalizedThresholds =
      current.clearanceThresholds.unit === unit
        ? current.clearanceThresholds
        : {
            ...current.clearanceThresholds,
            unit,
            primaryWalkwayWidth: convertMeasurement(
              current.clearanceThresholds.primaryWalkwayWidth,
              current.clearanceThresholds.unit,
              unit
            ),
            secondaryPassageWidth: convertMeasurement(
              current.clearanceThresholds.secondaryPassageWidth,
              current.clearanceThresholds.unit,
              unit
            ),
            furnitureFrontClearance: convertMeasurement(
              current.clearanceThresholds.furnitureFrontClearance,
              current.clearanceThresholds.unit,
              unit
            ),
            doorwayApproachClearDepth: convertMeasurement(
              current.clearanceThresholds.doorwayApproachClearDepth,
              current.clearanceThresholds.unit,
              unit
            ),
          };
    return {
      ...current,
      version: P33_FURNITURE_ENGINE_VERSION,
      unit,
      customTemplates: current.customTemplates || [],
      instances: current.instances || [],
      knownOpenings: current.knownOpenings || [],
      clearanceThresholds: normalizedThresholds,
      customRoutes: current.customRoutes || [],
      requestSequenceId: current.requestSequenceId || 1,
    };
  }

  return {
    version: P33_FURNITURE_ENGINE_VERSION,
    unit,
    customTemplates: [],
    instances: [],
    knownOpenings: [],
    clearanceThresholds: getDefaultClearanceThresholds(unit),
    customRoutes: [],
    lastSavedAt: new Date().toISOString(),
    lastPreSaveSnapshotId: null,
    requestSequenceId: 1,
  };
}

export function getAllCatalogTemplates(
  project: Project
): FurnitureCatalogTemplate[] {
  const layout = ensureProjectFurnitureLayoutData(project);
  return [...STARTER_FURNITURE_CATALOG, ...layout.customTemplates];
}

export interface AABBRect {
  x: number;
  y: number;
  width: number;
  length: number;
}

/**
 * Computes the oriented axis-aligned bounding box of a PlacedFurnitureInstance in plot coordinates.
 * For 90° and 270° rotations, width and depth swap cleanly; for arbitrary angles, the exact
 * rotated bounding box around the unrotated center or top-left anchor is returned.
 */
export function getInstanceFootprintRect(
  instance: PlacedFurnitureInstance,
  targetUnit?: MeasurementUnit
): AABBRect {
  const unit = targetUnit || instance.unit;
  const x = convertMeasurement(instance.x, instance.unit, unit);
  const y = convertMeasurement(instance.y, instance.unit, unit);
  const rawW = convertMeasurement(instance.width, instance.unit, unit);
  const rawD = convertMeasurement(instance.depth, instance.unit, unit);

  const normRot = ((instance.rotationDeg % 360) + 360) % 360;
  if (Math.abs(normRot - 90) < 1 || Math.abs(normRot - 270) < 1) {
    return {
      x,
      y,
      width: rawD,
      length: rawW,
    };
  }
  if (Math.abs(normRot) < 1 || Math.abs(normRot - 180) < 1) {
    return {
      x,
      y,
      width: rawW,
      length: rawD,
    };
  }

  const rad = (normRot * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    x,
    y,
    width: Number((rawW * cos + rawD * sin).toFixed(3)),
    length: Number((rawW * sin + rawD * cos).toFixed(3)),
  };
}

/**
 * Computes the front functional clearance rectangle of a furniture instance based on its rotation.
 * At 0°, front is on the south (+Y) edge; at 90°, front is on the west (-X) edge;
 * at 180°, front is on the north (-Y) edge; at 270°, front is on the east (+X) edge.
 */
export function getInstanceFrontClearanceRect(
  instance: PlacedFurnitureInstance,
  thresholds: CirculationClearanceThresholds,
  templates: FurnitureCatalogTemplate[],
  targetUnit?: MeasurementUnit
): AABBRect {
  const unit = targetUnit || thresholds.unit;
  const rect = getInstanceFootprintRect(instance, unit);
  const tpl = templates.find((t) => t.templateId === instance.templateId);

  let frontDepth = thresholds.furnitureFrontClearance;
  if (instance.clearanceOverrides?.front !== undefined) {
    frontDepth = convertMeasurement(
      instance.clearanceOverrides.front,
      instance.unit,
      unit
    );
  } else if (tpl) {
    const tplFront =
      unit === 'metres'
        ? tpl.recommendedClearanceMetres.front
        : tpl.recommendedClearanceFeet.front;
    frontDepth = Math.max(frontDepth, tplFront);
  }

  const normRot = ((instance.rotationDeg % 360) + 360) % 360;
  if (Math.abs(normRot - 90) < 45) {
    // 90° -> Front faces West (-X)
    return {
      x: Number((rect.x - frontDepth).toFixed(3)),
      y: rect.y,
      width: frontDepth,
      length: rect.length,
    };
  }
  if (Math.abs(normRot - 180) < 45) {
    // 180° -> Front faces North (-Y)
    return {
      x: rect.x,
      y: Number((rect.y - frontDepth).toFixed(3)),
      width: rect.width,
      length: frontDepth,
    };
  }
  if (Math.abs(normRot - 270) < 45) {
    // 270° -> Front faces East (+X)
    return {
      x: Number((rect.x + rect.width).toFixed(3)),
      y: rect.y,
      width: frontDepth,
      length: rect.length,
    };
  }
  // 0° -> Front faces South (+Y)
  return {
    x: rect.x,
    y: Number((rect.y + rect.length).toFixed(3)),
    width: rect.width,
    length: frontDepth,
  };
}

export function getRectOverlap(a: AABBRect, b: AABBRect): AABBRect | null {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.length, b.y + b.length);

  if (x2 - x1 > EPSILON && y2 - y1 > EPSILON) {
    return {
      x: Number(x1.toFixed(3)),
      y: Number(y1.toFixed(3)),
      width: Number((x2 - x1).toFixed(3)),
      length: Number((y2 - y1).toFixed(3)),
    };
  }
  return null;
}

export function getPairwiseRectGap(a: AABBRect, b: AABBRect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(
    0,
    Math.max(a.y - (b.y + b.length), b.y - (a.y + a.length))
  );
  if (dx === 0 && dy === 0) return 0;
  return Number(Math.hypot(dx, dy).toFixed(3));
}

/**
 * Computes the doorway opening threshold and inward door-swing zone in plot coordinates
 * for a verified KnownRoomOpening on a room.
 */
export function getKnownOpeningZones(
  room: FloorPlanRoom,
  opening: KnownRoomOpening,
  thresholds: CirculationClearanceThresholds
): {
  doorwayPoint: { x: number; y: number };
  approachZone: AABBRect;
  swingZone: AABBRect | null;
} {
  const w = Math.max(0.5, opening.width);
  const swingDepth = opening.swingDepth && opening.swingDepth > 0 ? opening.swingDepth : w;
  const approachDepth = thresholds.doorwayApproachClearDepth;

  if (opening.wallEdge === 'north') {
    const startX = Math.min(
      room.x + room.width - w,
      Math.max(room.x, room.x + opening.offsetAlongWall)
    );
    const approachZone: AABBRect = {
      x: startX,
      y: room.y,
      width: w,
      length: Math.min(room.length, approachDepth),
    };
    const swingZone: AABBRect | null =
      opening.swingDirection === 'inward-left' ||
      opening.swingDirection === 'inward-right'
        ? {
            x: startX,
            y: room.y,
            width: w,
            length: Math.min(room.length, swingDepth),
          }
        : null;
    return {
      doorwayPoint: { x: Number((startX + w / 2).toFixed(3)), y: Number((room.y + 0.25).toFixed(3)) },
      approachZone,
      swingZone,
    };
  }

  if (opening.wallEdge === 'south') {
    const startX = Math.min(
      room.x + room.width - w,
      Math.max(room.x, room.x + opening.offsetAlongWall)
    );
    const approachLen = Math.min(room.length, approachDepth);
    const swingLen = Math.min(room.length, swingDepth);
    return {
      doorwayPoint: {
        x: Number((startX + w / 2).toFixed(3)),
        y: Number((room.y + room.length - 0.25).toFixed(3)),
      },
      approachZone: {
        x: startX,
        y: Number((room.y + room.length - approachLen).toFixed(3)),
        width: w,
        length: approachLen,
      },
      swingZone:
        opening.swingDirection === 'inward-left' ||
        opening.swingDirection === 'inward-right'
          ? {
              x: startX,
              y: Number((room.y + room.length - swingLen).toFixed(3)),
              width: w,
              length: swingLen,
            }
          : null,
    };
  }

  if (opening.wallEdge === 'west') {
    const startY = Math.min(
      room.y + room.length - w,
      Math.max(room.y, room.y + opening.offsetAlongWall)
    );
    const approachW = Math.min(room.width, approachDepth);
    const swingW = Math.min(room.width, swingDepth);
    return {
      doorwayPoint: {
        x: Number((room.x + 0.25).toFixed(3)),
        y: Number((startY + w / 2).toFixed(3)),
      },
      approachZone: {
        x: room.x,
        y: startY,
        width: approachW,
        length: w,
      },
      swingZone:
        opening.swingDirection === 'inward-left' ||
        opening.swingDirection === 'inward-right'
          ? {
              x: room.x,
              y: startY,
              width: swingW,
              length: w,
            }
          : null,
    };
  }

  // east wallEdge
  const startY = Math.min(
    room.y + room.length - w,
    Math.max(room.y, room.y + opening.offsetAlongWall)
  );
  const approachW = Math.min(room.width, approachDepth);
  const swingW = Math.min(room.width, swingDepth);
  return {
    doorwayPoint: {
      x: Number((room.x + room.width - 0.25).toFixed(3)),
      y: Number((startY + w / 2).toFixed(3)),
    },
    approachZone: {
      x: Number((room.x + room.width - approachW).toFixed(3)),
      y: startY,
      width: approachW,
      length: w,
    },
    swingZone:
      opening.swingDirection === 'inward-left' ||
      opening.swingDirection === 'inward-right'
        ? {
            x: Number((room.x + room.width - swingW).toFixed(3)),
            y: startY,
            width: swingW,
            length: w,
          }
        : null,
  };
}

/**
 * Extracts known fixed obstacles (structural columns and floor-mounted MEP equipment)
 * from the project when present. Never fabricates obstacles when absent.
 */
export function extractKnownFixedRoomObstacles(
  project: Project
): KnownFixedRoomObstacle[] {
  const obstacles: KnownFixedRoomObstacle[] = [];

  if (project.structuralCoordination?.columns) {
    for (const col of project.structuralCoordination.columns) {
      const levels = col.floorLevels && col.floorLevels.length > 0 ? col.floorLevels : [1];
      for (const level of levels) {
        obstacles.push({
          obstacleId: `col-${col.id}-L${level}`,
          label: `Structural Column ${col.id}`,
          kind: 'structural-column',
          floorLevel: level,
          x: Number((col.x - col.width / 2).toFixed(3)),
          y: Number((col.y - col.depth / 2).toFixed(3)),
          width: col.width,
          depth: col.depth,
          sourceReference: `project.structuralCoordination.columns[${col.id}]`,
        });
      }
    }
  }

  if (project.mepCoordination?.components) {
    for (const comp of project.mepCoordination.components) {
      if (comp.location && comp.location.z <= 3.0) {
        obstacles.push({
          obstacleId: `mep-${comp.id}`,
          label: comp.name || `MEP Equipment ${comp.id}`,
          kind: 'mep-equipment',
          floorLevel: comp.floorLevel || 1,
          x: comp.location.x,
          y: comp.location.y,
          width: comp.location.width,
          depth: comp.location.length,
          sourceReference: `project.mepCoordination.components[${comp.id}]`,
        });
      }
    }
  }

  return obstacles;
}

/**
 * Places a new furniture instance into a target room, centering it safely within the room
 * or at an explicit coordinate. Does NOT mutate `project.floorPlan.rooms`.
 */
export function createPlacedFurnitureInstance(params: {
  project: Project;
  template: FurnitureCatalogTemplate;
  roomId: string;
  x?: number;
  y?: number;
  rotationDeg?: number;
  customWidth?: number;
  customDepth?: number;
  customHeight?: number;
  dimensionProvenance?: DimensionProvenance;
  notes?: string;
}): PlacedFurnitureInstance {
  const { project, template, roomId } = params;
  const unit: MeasurementUnit = project.unit || 'feet';
  const rooms = project.floorPlan?.rooms || [];
  const room = rooms.find((r) => r.id === roomId);

  const defaultDims =
    unit === 'metres'
      ? template.defaultDimensionsMetres
      : template.defaultDimensionsFeet;

  const width =
    params.customWidth !== undefined && params.customWidth > 0
      ? params.customWidth
      : defaultDims.width;
  const depth =
    params.customDepth !== undefined && params.customDepth > 0
      ? params.customDepth
      : defaultDims.depth;
  const height =
    params.customHeight !== undefined && params.customHeight > 0
      ? params.customHeight
      : defaultDims.height;

  const rotationDeg = params.rotationDeg !== undefined ? params.rotationDeg : 0;
  const floorLevel = room ? room.floorLevel : 1;

  let defaultX = 0;
  let defaultY = 0;
  if (room) {
    const effW = rotationDeg === 90 || rotationDeg === 270 ? depth : width;
    const effD = rotationDeg === 90 || rotationDeg === 270 ? width : depth;
    defaultX = Number(
      Math.max(room.x, room.x + (room.width - effW) / 2).toFixed(2)
    );
    defaultY = Number(
      Math.max(room.y, room.y + (room.length - effD) / 2).toFixed(2)
    );
  }

  const now = new Date().toISOString();
  const provenance: DimensionProvenance =
    params.dimensionProvenance ||
    (params.customWidth !== undefined || params.customDepth !== undefined
      ? 'user-edited-custom'
      : template.provenance);

  return {
    instanceId: `furn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    templateId: template.templateId,
    projectId: project.id,
    roomId,
    floorLevel,
    name: template.name,
    category: template.category,
    footprintShape: 'rectangle',
    x: params.x !== undefined ? params.x : defaultX,
    y: params.y !== undefined ? params.y : defaultY,
    width,
    depth,
    height,
    unit,
    rotationDeg,
    dimensionProvenance: provenance,
    isLocked: false,
    notes: params.notes,
    createdAt: now,
    updatedAt: now,
  };
}

export function moveFurnitureInstance(
  instance: PlacedFurnitureInstance,
  newX: number,
  newY: number
): PlacedFurnitureInstance {
  if (!Number.isFinite(newX) || !Number.isFinite(newY)) {
    throw new Error('Furniture coordinates must be finite numbers.');
  }
  return {
    ...instance,
    x: Number(newX.toFixed(3)),
    y: Number(newY.toFixed(3)),
    updatedAt: new Date().toISOString(),
  };
}

export function rotateFurnitureInstance(
  instance: PlacedFurnitureInstance,
  nextRotationDeg: number
): PlacedFurnitureInstance {
  if (!Number.isFinite(nextRotationDeg)) {
    throw new Error('Rotation angle must be a finite number.');
  }
  const normalized = ((nextRotationDeg % 360) + 360) % 360;
  return {
    ...instance,
    rotationDeg: normalized,
    updatedAt: new Date().toISOString(),
  };
}

export function resizeFurnitureInstance(
  instance: PlacedFurnitureInstance,
  newWidth: number,
  newDepth: number,
  newHeight?: number
): PlacedFurnitureInstance {
  if (
    !Number.isFinite(newWidth) ||
    !Number.isFinite(newDepth) ||
    newWidth <= 0 ||
    newDepth <= 0
  ) {
    throw new Error('Furniture width and depth must be positive finite numbers.');
  }
  return {
    ...instance,
    width: Number(newWidth.toFixed(3)),
    depth: Number(newDepth.toFixed(3)),
    height:
      newHeight !== undefined && Number.isFinite(newHeight) && newHeight > 0
        ? Number(newHeight.toFixed(3))
        : instance.height,
    dimensionProvenance: 'user-edited-custom',
    updatedAt: new Date().toISOString(),
  };
}

export function duplicateFurnitureInstance(
  instance: PlacedFurnitureInstance,
  offsetX = 1.0,
  offsetY = 1.0
): PlacedFurnitureInstance {
  const now = new Date().toISOString();
  return {
    ...instance,
    instanceId: `furn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: `${instance.name} (Copy)`,
    x: Number((instance.x + offsetX).toFixed(3)),
    y: Number((instance.y + offsetY).toFixed(3)),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Deterministic Geometric Validation Engine (Section 9 of Prompt 33)
 */
export function validateFurnitureLayout(params: {
  project: Project;
  instances: PlacedFurnitureInstance[];
  knownOpenings: KnownRoomOpening[];
  thresholds: CirculationClearanceThresholds;
}): FurnitureValidationDiagnostic[] {
  const { project, instances, knownOpenings, thresholds } = params;
  const unit: MeasurementUnit = project.unit || 'feet';
  const rooms = project.floorPlan?.rooms || [];
  const roomMap = new Map<string, FloorPlanRoom>();
  for (const r of rooms) {
    roomMap.set(r.id, r);
  }

  const templates = getAllCatalogTemplates(project);
  const fixedObstacles = extractKnownFixedRoomObstacles(project);
  const diagnostics: FurnitureValidationDiagnostic[] = [];

  // 1. Validate each instance's coordinates, dimensions, room assignment, and room boundary containment
  for (const inst of instances) {
    if (
      !Number.isFinite(inst.x) ||
      !Number.isFinite(inst.y) ||
      !Number.isFinite(inst.width) ||
      !Number.isFinite(inst.depth) ||
      !Number.isFinite(inst.rotationDeg) ||
      inst.width <= 0 ||
      inst.depth <= 0
    ) {
      diagnostics.push({
        id: `diag-invalid-dims-${inst.instanceId}`,
        category: 'invalid-dimensions-or-coords',
        severity: 'conflict',
        roomId: inst.roomId || null,
        floorLevel: inst.floorLevel,
        affectedInstanceIds: [inst.instanceId],
        calculationMethod: 'Deterministic numeric domain check (width > 0, depth > 0, finite x/y/rotation)',
        measuredValue: `w=${inst.width}, d=${inst.depth}, x=${inst.x}, y=${inst.y}, rot=${inst.rotationDeg}`,
        explanation: `Furniture item "${inst.name}" has zero, negative, or non-finite dimensions or coordinates.`,
        suggestedAdjustment: 'Reset dimensions to positive finite values or remove the invalid item.',
        isCompleteData: true,
        missingInputs: [],
      });
      continue;
    }

    const room = roomMap.get(inst.roomId);
    if (!room || room.floorLevel !== inst.floorLevel) {
      diagnostics.push({
        id: `diag-invalid-room-${inst.instanceId}`,
        category: 'invalid-room-or-floor',
        severity: 'conflict',
        roomId: inst.roomId || null,
        roomName: room?.name,
        floorLevel: inst.floorLevel,
        affectedInstanceIds: [inst.instanceId],
        calculationMethod: 'Room ID lookup and floorLevel equality check against project.floorPlan.rooms',
        measuredValue: `roomId=${inst.roomId}, instanceFloor=${inst.floorLevel}, roomFloor=${room?.floorLevel ?? 'missing'}`,
        explanation: !room
          ? `Furniture item "${inst.name}" references a non-existent room (${inst.roomId}).`
          : `Furniture item "${inst.name}" is on floor ${inst.floorLevel}, but room "${room.name}" is on floor ${room.floorLevel}.`,
        suggestedAdjustment: 'Reassign the item to an existing room on the matching floor level.',
        isCompleteData: true,
        missingInputs: [],
      });
      continue;
    }

    const rect = getInstanceFootprintRect(inst, unit);
    const overflowLeft = Math.max(0, room.x - rect.x);
    const overflowTop = Math.max(0, room.y - rect.y);
    const overflowRight = Math.max(0, rect.x + rect.width - (room.x + room.width));
    const overflowBottom = Math.max(
      0,
      rect.y + rect.length - (room.y + room.length)
    );
    const maxOverflow = Math.max(
      overflowLeft,
      overflowTop,
      overflowRight,
      overflowBottom
    );

    if (maxOverflow > EPSILON) {
      diagnostics.push({
        id: `diag-boundary-${inst.instanceId}`,
        category: 'room-boundary-overflow',
        severity: 'conflict',
        roomId: room.id,
        roomName: room.name,
        floorLevel: room.floorLevel,
        affectedInstanceIds: [inst.instanceId],
        calculationMethod: '2D Axis-Aligned Bounding Box (AABB) containment check against room interior bounds',
        measuredValue: `${maxOverflow.toFixed(2)} ${unit} outside ${room.name} (${room.width}×${room.length} ${unit})`,
        thresholdUsed: `0.00 ${unit} boundary overhang`,
        explanation: `"${inst.name}" (${rect.width}×${rect.length} ${unit}) extends ${maxOverflow.toFixed(2)} ${unit} outside the boundary of "${room.name}".`,
        suggestedAdjustment:
          rect.width <= room.width && rect.length <= room.length
            ? `Move "${inst.name}" inward to stay within [${room.x}, ${room.x + room.width - rect.width}] × [${room.y}, ${room.y + room.length - rect.length}] ${unit}.`
            : rect.length <= room.width && rect.width <= room.length
              ? `Rotate "${inst.name}" by 90° and center it inside "${room.name}".`
              : `"${inst.name}" exceeds the dimensions of "${room.name}"; resize it or select a smaller template.`,
        isCompleteData: true,
        missingInputs: [],
      });
    }

    // Check front functional clearance against room walls or other objects
    const frontZone = getInstanceFrontClearanceRect(
      inst,
      thresholds,
      templates,
      unit
    );
    const frontOutLeft = Math.max(0, room.x - frontZone.x);
    const frontOutTop = Math.max(0, room.y - frontZone.y);
    const frontOutRight = Math.max(
      0,
      frontZone.x + frontZone.width - (room.x + room.width)
    );
    const frontOutBottom = Math.max(
      0,
      frontZone.y + frontZone.length - (room.y + room.length)
    );
    const maxFrontWallClip = Math.max(
      frontOutLeft,
      frontOutTop,
      frontOutRight,
      frontOutBottom
    );

    if (maxFrontWallClip > EPSILON && maxOverflow <= EPSILON) {
      const availableClearance = Math.max(0, frontZone.width < frontZone.length ? frontZone.width - maxFrontWallClip : frontZone.length - maxFrontWallClip);
      diagnostics.push({
        id: `diag-clearance-wall-${inst.instanceId}`,
        category: 'clearance-zone-violation',
        severity: 'warning',
        roomId: room.id,
        roomName: room.name,
        floorLevel: room.floorLevel,
        affectedInstanceIds: [inst.instanceId],
        calculationMethod: 'Oriented front functional clearance zone check against room walls',
        measuredValue: `${availableClearance.toFixed(2)} ${unit} front clearance before wall`,
        thresholdUsed: `${thresholds.furnitureFrontClearance.toFixed(2)} ${unit} (${thresholds.thresholdProvenance})`,
        explanation: `The front functional access zone of "${inst.name}" is clipped by the wall of "${room.name}" by ${maxFrontWallClip.toFixed(2)} ${unit}.`,
        suggestedAdjustment: `Rotate "${inst.name}" so its front faces the room interior, or shift it ${maxFrontWallClip.toFixed(2)} ${unit} away from the wall.`,
        isCompleteData: true,
        missingInputs: [],
      });
    }
  }

  // 2. Pairwise furniture-to-furniture collision and front-clearance intrusion on the same floor
  for (let i = 0; i < instances.length; i++) {
    for (let j = i + 1; j < instances.length; j++) {
      const a = instances[i];
      const b = instances[j];
      if (a.floorLevel !== b.floorLevel) continue;

      const rectA = getInstanceFootprintRect(a, unit);
      const rectB = getInstanceFootprintRect(b, unit);
      const overlap = getRectOverlap(rectA, rectB);

      if (overlap) {
        const room = roomMap.get(a.roomId);
        diagnostics.push({
          id: `diag-collision-${a.instanceId}-${b.instanceId}`,
          category: 'furniture-collision',
          severity: 'conflict',
          roomId: a.roomId === b.roomId ? a.roomId : a.roomId,
          roomName: room?.name,
          floorLevel: a.floorLevel,
          affectedInstanceIds: [a.instanceId, b.instanceId],
          calculationMethod: '2D AABB footprint intersection on matching floorLevel',
          measuredValue: `Overlap ${overlap.width.toFixed(2)}×${overlap.length.toFixed(2)} ${unit} (${(overlap.width * overlap.length).toFixed(2)} sq.${unit})`,
          thresholdUsed: `0.00 sq.${unit} physical footprint overlap`,
          explanation: `"${a.name}" and "${b.name}" physically overlap by ${overlap.width.toFixed(2)}×${overlap.length.toFixed(2)} ${unit} on Floor ${a.floorLevel}.`,
          suggestedAdjustment: `Separate "${a.name}" and "${b.name}" by at least ${Math.min(overlap.width, overlap.length).toFixed(2)} ${unit}.`,
          isCompleteData: true,
          missingInputs: [],
          collisionRect: overlap,
        });
      } else if (a.roomId === b.roomId) {
        // Check if B intrudes into A's front clearance zone or vice-versa
        const frontA = getInstanceFrontClearanceRect(a, thresholds, templates, unit);
        const frontOverlapAB = getRectOverlap(frontA, rectB);
        if (frontOverlapAB) {
          const room = roomMap.get(a.roomId);
          diagnostics.push({
            id: `diag-clearance-pair-${a.instanceId}-${b.instanceId}`,
            category: 'clearance-zone-violation',
            severity: 'warning',
            roomId: a.roomId,
            roomName: room?.name,
            floorLevel: a.floorLevel,
            affectedInstanceIds: [a.instanceId, b.instanceId],
            calculationMethod: 'Front clearance envelope intersection with adjacent furniture footprint',
            measuredValue: `Intrusion ${frontOverlapAB.width.toFixed(2)}×${frontOverlapAB.length.toFixed(2)} ${unit}`,
            thresholdUsed: `${thresholds.furnitureFrontClearance.toFixed(2)} ${unit} front clearance (${thresholds.thresholdProvenance})`,
            explanation: `"${b.name}" intrudes into the front functional clearance zone of "${a.name}".`,
            suggestedAdjustment: `Increase separation between "${a.name}" and "${b.name}" or rotate "${a.name}".`,
            isCompleteData: true,
            missingInputs: [],
            collisionRect: frontOverlapAB,
          });
        }
      }
    }
  }

  // 3. Fixed obstacle collisions (structural columns & floor-mounted MEP equipment)
  for (const inst of instances) {
    const instRect = getInstanceFootprintRect(inst, unit);
    const room = roomMap.get(inst.roomId);
    for (const obs of fixedObstacles) {
      if (obs.floorLevel !== inst.floorLevel) continue;
      const obsRect: AABBRect = {
        x: obs.x,
        y: obs.y,
        width: obs.width,
        length: obs.depth,
      };
      const overlap = getRectOverlap(instRect, obsRect);
      if (overlap) {
        diagnostics.push({
          id: `diag-fixed-obs-${inst.instanceId}-${obs.obstacleId}`,
          category: 'fixed-object-collision',
          severity: 'conflict',
          roomId: inst.roomId,
          roomName: room?.name,
          floorLevel: inst.floorLevel,
          affectedInstanceIds: [inst.instanceId],
          affectedFixedObstacleId: obs.obstacleId,
          calculationMethod: `2D AABB intersection with ${obs.kind} (${obs.sourceReference})`,
          measuredValue: `Overlap ${overlap.width.toFixed(2)}×${overlap.length.toFixed(2)} ${unit}`,
          thresholdUsed: `0.00 ${unit} overlap with fixed building element`,
          explanation: `"${inst.name}" collides with ${obs.label} at (${obs.x.toFixed(2)}, ${obs.y.toFixed(2)}).`,
          suggestedAdjustment: `Shift "${inst.name}" clear of ${obs.label}.`,
          isCompleteData: true,
          missingInputs: [],
          collisionRect: overlap,
        });
      }
    }
  }

  // 4. Door / opening conflict checks — NEVER fabricate openings when absent
  const furnishedRoomIds = Array.from(new Set(instances.map((i) => i.roomId)));
  for (const roomId of furnishedRoomIds) {
    const room = roomMap.get(roomId);
    if (!room) continue;

    const roomOpenings = knownOpenings.filter(
      (o) =>
        o.roomId === room.id &&
        o.floorLevel === room.floorLevel &&
        (o.type === 'door' || o.type === 'open-passage')
    );

    if (roomOpenings.length === 0) {
      diagnostics.push({
        id: `diag-missing-openings-${room.id}`,
        category: 'missing-opening-or-route-data',
        severity: 'unavailable',
        roomId: room.id,
        roomName: room.name,
        floorLevel: room.floorLevel,
        affectedInstanceIds: instances
          .filter((i) => i.roomId === room.id)
          .map((i) => i.instanceId),
        calculationMethod: 'Explicit opening metadata inspection (no fabricated doors)',
        measuredValue: '0 known door openings defined for room',
        explanation: `Doorway approach and door-swing obstruction checks for "${room.name}" cannot be evaluated because the floor-plan model has no verified door opening location for this room. Plotify does not guess or fabricate door coordinates.`,
        suggestedAdjustment: `Add a Known Door Opening on the North, South, East, or West wall of "${room.name}" to enable doorway and door-to-furniture route checks.`,
        isCompleteData: false,
        missingInputs: ['room.knownOpenings'],
      });
      continue;
    }

    const roomInstances = instances.filter((i) => i.roomId === room.id);
    for (const opening of roomOpenings) {
      const { approachZone, swingZone } = getKnownOpeningZones(
        room,
        opening,
        thresholds
      );

      for (const inst of roomInstances) {
        const instRect = getInstanceFootprintRect(inst, unit);
        if (swingZone) {
          const swingOverlap = getRectOverlap(instRect, swingZone);
          if (swingOverlap) {
            diagnostics.push({
              id: `diag-door-swing-${opening.openingId}-${inst.instanceId}`,
              category: 'door-swing-obstruction',
              severity: 'conflict',
              roomId: room.id,
              roomName: room.name,
              floorLevel: room.floorLevel,
              affectedInstanceIds: [inst.instanceId],
              affectedOpeningId: opening.openingId,
              calculationMethod: '2D AABB intersection between furniture footprint and inward door-swing envelope',
              measuredValue: `Swing zone intrusion ${swingOverlap.width.toFixed(2)}×${swingOverlap.length.toFixed(2)} ${unit}`,
              thresholdUsed: `Clear inward swing arc (${opening.width.toFixed(2)} ${unit} radius)`,
              explanation: `"${inst.name}" obstructs the inward swing zone of "${opening.label}" on the ${opening.wallEdge} wall of "${room.name}".`,
              suggestedAdjustment: `Move "${inst.name}" outside the ${opening.wallEdge} doorway swing zone.`,
              isCompleteData: true,
              missingInputs: [],
              collisionRect: swingOverlap,
            });
            continue;
          }
        }

        const approachOverlap = getRectOverlap(instRect, approachZone);
        if (approachOverlap) {
          diagnostics.push({
            id: `diag-door-approach-${opening.openingId}-${inst.instanceId}`,
            category: 'door-opening-obstruction',
            severity: 'conflict',
            roomId: room.id,
            roomName: room.name,
            floorLevel: room.floorLevel,
            affectedInstanceIds: [inst.instanceId],
            affectedOpeningId: opening.openingId,
            calculationMethod: '2D AABB intersection between furniture footprint and doorway approach threshold zone',
            measuredValue: `Approach zone intrusion ${approachOverlap.width.toFixed(2)}×${approachOverlap.length.toFixed(2)} ${unit}`,
            thresholdUsed: `${thresholds.doorwayApproachClearDepth.toFixed(2)} ${unit} doorway approach depth (${thresholds.thresholdProvenance})`,
            explanation: `"${inst.name}" blocks the doorway approach clearance of "${opening.label}" on the ${opening.wallEdge} wall of "${room.name}".`,
            suggestedAdjustment: `Shift "${inst.name}" at least ${thresholds.doorwayApproachClearDepth.toFixed(2)} ${unit} clear of "${opening.label}".`,
            isCompleteData: true,
            missingInputs: [],
            collisionRect: approachOverlap,
          });
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Grid-based room circulation and route evaluation (Section 10 of Prompt 33).
 * Uses a discretized 2D room occupancy grid and Dijkstra/A* pathfinding that accounts for
 * furniture obstacles, fixed structural columns, and local corridor clearance width.
 */
export function evaluateSingleCirculationRoute(params: {
  room: FloorPlanRoom;
  routeQuery: CirculationRouteQuery;
  roomInstances: PlacedFurnitureInstance[];
  fixedObstacles: KnownFixedRoomObstacle[];
  thresholds: CirculationClearanceThresholds;
  unit: MeasurementUnit;
}): CirculationRouteResult {
  const { room, routeQuery, roomInstances, fixedObstacles, thresholds, unit } =
    params;

  const gridCellSize = unit === 'metres' ? 0.15 : 0.5;
  const cols = Math.max(4, Math.ceil(room.width / gridCellSize));
  const rows = Math.max(4, Math.ceil(room.length / gridCellSize));

  const instRects = roomInstances.map((inst) => ({
    instanceId: inst.instanceId,
    name: inst.name,
    rect: getInstanceFootprintRect(inst, unit),
  }));

  const obsRects = fixedObstacles
    .filter((o) => o.floorLevel === room.floorLevel)
    .map((o) => ({
      obstacleId: o.obstacleId,
      name: o.label,
      rect: { x: o.x, y: o.y, width: o.width, length: o.depth },
    }));

  // Build occupancy grid and local clearance map
  const blocked: boolean[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(false)
  );
  const cellClearance: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(0)
  );
  const nearestBlockerName: string[][] = Array.from({ length: rows }, () =>
    Array(cols).fill('Room wall')
  );

  const toWorld = (r: number, c: number) => ({
    x: Number((room.x + (c + 0.5) * (room.width / cols)).toFixed(3)),
    y: Number((room.y + (r + 0.5) * (room.length / rows)).toFixed(3)),
  });

  const toGrid = (wx: number, wy: number) => {
    const c = Math.min(
      cols - 1,
      Math.max(0, Math.floor(((wx - room.x) / room.width) * cols))
    );
    const r = Math.min(
      rows - 1,
      Math.max(0, Math.floor(((wy - room.y) / room.length) * rows))
    );
    return { r, c };
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pt = toWorld(r, c);
      let isCellBlocked = false;

      for (const item of instRects) {
        // Allow destination furniture front edge cell if it's the target
        if (
          pt.x >= item.rect.x + EPSILON &&
          pt.x <= item.rect.x + item.rect.width - EPSILON &&
          pt.y >= item.rect.y + EPSILON &&
          pt.y <= item.rect.y + item.rect.length - EPSILON
        ) {
          isCellBlocked = true;
          break;
        }
      }
      if (!isCellBlocked) {
        for (const obs of obsRects) {
          if (
            pt.x >= obs.rect.x + EPSILON &&
            pt.x <= obs.rect.x + obs.rect.width - EPSILON &&
            pt.y >= obs.rect.y + EPSILON &&
            pt.y <= obs.rect.y + obs.rect.length - EPSILON
          ) {
            isCellBlocked = true;
            break;
          }
        }
      }
      blocked[r][c] = isCellBlocked;

      if (!isCellBlocked) {
        // Compute local passage width at (pt.x, pt.y) by measuring clear span horizontally and vertically
        // between room walls and furniture/obstacles
        let leftBound = room.x;
        let rightBound = room.x + room.width;
        let topBound = room.y;
        let bottomBound = room.y + room.length;
        let blockerLabel = 'Room boundary';

        const allObstacles = [
          ...instRects.map((i) => ({ label: i.name, rect: i.rect })),
          ...obsRects.map((o) => ({ label: o.name, rect: o.rect })),
        ];

        for (const ob of allObstacles) {
          // Horizontal ray at pt.y
          if (pt.y >= ob.rect.y && pt.y <= ob.rect.y + ob.rect.length) {
            if (ob.rect.x + ob.rect.width <= pt.x && ob.rect.x + ob.rect.width > leftBound) {
              leftBound = ob.rect.x + ob.rect.width;
              blockerLabel = ob.label;
            }
            if (ob.rect.x >= pt.x && ob.rect.x < rightBound) {
              rightBound = ob.rect.x;
              blockerLabel = ob.label;
            }
          }
          // Vertical ray at pt.x
          if (pt.x >= ob.rect.x && pt.x <= ob.rect.x + ob.rect.width) {
            if (ob.rect.y + ob.rect.length <= pt.y && ob.rect.y + ob.rect.length > topBound) {
              topBound = ob.rect.y + ob.rect.length;
              blockerLabel = ob.label;
            }
            if (ob.rect.y >= pt.y && ob.rect.y < bottomBound) {
              bottomBound = ob.rect.y;
              blockerLabel = ob.label;
            }
          }
        }

        const horizSpan = Math.max(0, rightBound - leftBound);
        const vertSpan = Math.max(0, bottomBound - topBound);
        // The effective passage width at this cell is the narrower of the two spans if turning,
        // or the active corridor span along the channel
        const corridorWidth = Math.min(horizSpan, vertSpan);
        cellClearance[r][c] = Number(corridorWidth.toFixed(3));
        nearestBlockerName[r][c] = blockerLabel;
      }
    }
  }

  const startG = toGrid(routeQuery.startPoint.x, routeQuery.startPoint.y);
  const endG = toGrid(routeQuery.endPoint.x, routeQuery.endPoint.y);

  const straightDist = Number(
    Math.hypot(
      routeQuery.endPoint.x - routeQuery.startPoint.x,
      routeQuery.endPoint.y - routeQuery.startPoint.y
    ).toFixed(2)
  );

  // If start or end cell is directly blocked by a furniture item, identify the blocker
  const findNearestFreeCell = (g: { r: number; c: number }) => {
    if (!blocked[g.r][g.c]) return g;
    for (let radius = 1; radius <= 2; radius++) {
      for (let dr = -radius; dr <= radius; dr++) {
        for (let dc = -radius; dc <= radius; dc++) {
          const nr = g.r + dr;
          const nc = g.c + dc;
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && !blocked[nr][nc]) {
            return { r: nr, c: nc };
          }
        }
      }
    }
    return null;
  };

  const effStart = findNearestFreeCell(startG);
  const effEnd = findNearestFreeCell(endG);

  const findBlockingInstancesBetween = (): string[] => {
    const blockers: string[] = [];
    for (const item of instRects) {
      // Check if item intersects the bounding box or straight segment between start and end, or blocks start/end
      const minX = Math.min(routeQuery.startPoint.x, routeQuery.endPoint.x) - 0.5;
      const maxX = Math.max(routeQuery.startPoint.x, routeQuery.endPoint.x) + 0.5;
      const minY = Math.min(routeQuery.startPoint.y, routeQuery.endPoint.y) - 0.5;
      const maxY = Math.max(routeQuery.startPoint.y, routeQuery.endPoint.y) + 0.5;
      const overlap = getRectOverlap(item.rect, {
        x: minX,
        y: minY,
        width: Math.max(0.5, maxX - minX),
        length: Math.max(0.5, maxY - minY),
      });
      if (overlap) {
        blockers.push(item.instanceId);
      }
    }
    return blockers.length > 0
      ? blockers
      : roomInstances.map((i) => i.instanceId);
  };

  if (!effStart || !effEnd) {
    const blockingIds = findBlockingInstancesBetween();
    return {
      routeId: routeQuery.id,
      roomId: room.id,
      roomName: room.name,
      floorLevel: room.floorLevel,
      label: routeQuery.label,
      status: 'blocked',
      gridCellSize,
      requiredClearanceWidth: thresholds.primaryWalkwayWidth,
      minimumMeasuredClearanceAlongPath: 0,
      pathLength: null,
      straightLineDistance: straightDist,
      pathWaypoints: [],
      blockingInstanceIds: blockingIds,
      explanation: `Route "${routeQuery.label}" in "${room.name}" is completely blocked at its access point by placed furniture.`,
      methodAndApproximationNote: `Evaluated on a ${cols}×${rows} discretized room occupancy grid (cell size ${gridCellSize} ${unit}).`,
    };
  }

  // Run Dijkstra maximizing minimum clearance first, then minimizing path distance
  const dist: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(Infinity)
  );
  const maxMinClearance: number[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(-1)
  );
  const parent: Array<Array<{ r: number; c: number } | null>> = Array.from(
    { length: rows },
    () => Array(cols).fill(null)
  );
  const visited: boolean[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(false)
  );

  dist[effStart.r][effStart.c] = 0;
  maxMinClearance[effStart.r][effStart.c] =
    cellClearance[effStart.r][effStart.c];

  const dirs = [
    { dr: -1, dc: 0, cost: 1 },
    { dr: 1, dc: 0, cost: 1 },
    { dr: 0, dc: -1, cost: 1 },
    { dr: 0, dc: 1, cost: 1 },
    { dr: -1, dc: -1, cost: Math.SQRT2 },
    { dr: -1, dc: 1, cost: Math.SQRT2 },
    { dr: 1, dc: -1, cost: Math.SQRT2 },
    { dr: 1, dc: 1, cost: Math.SQRT2 },
  ];

  for (let step = 0; step < rows * cols; step++) {
    let bestR = -1;
    let bestC = -1;
    let bestScore = Infinity;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!visited[r][c] && dist[r][c] < bestScore) {
          bestScore = dist[r][c];
          bestR = r;
          bestC = c;
        }
      }
    }

    if (bestR === -1) break;
    if (bestR === effEnd.r && bestC === effEnd.c) break;
    visited[bestR][bestC] = true;

    for (const d of dirs) {
      const nr = bestR + d.dr;
      const nc = bestC + d.dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (blocked[nr][nc]) continue;
      // Prevent diagonal corner cutting through blocked cells
      if (
        d.dr !== 0 &&
        d.dc !== 0 &&
        (blocked[bestR + d.dr][bestC] || blocked[bestR][bestC + d.dc])
      ) {
        continue;
      }

      const cellCl = cellClearance[nr][nc];
      // Penalize narrow cells below primaryWalkwayWidth so pathfinder prefers wider walkways
      const penalty =
        cellCl < thresholds.secondaryPassageWidth
          ? 8.0
          : cellCl < thresholds.primaryWalkwayWidth
            ? 3.0
            : 1.0;

      const stepWorldDist = d.cost * ((room.width / cols + room.length / rows) / 2);
      const nextCost = dist[bestR][bestC] + stepWorldDist * penalty;

      if (nextCost < dist[nr][nc]) {
        dist[nr][nc] = nextCost;
        maxMinClearance[nr][nc] = Math.min(
          maxMinClearance[bestR][bestC],
          cellCl
        );
        parent[nr][nc] = { r: bestR, c: bestC };
      }
    }
  }

  if (dist[effEnd.r][effEnd.c] === Infinity) {
    const blockingIds = findBlockingInstancesBetween();
    return {
      routeId: routeQuery.id,
      roomId: room.id,
      roomName: room.name,
      floorLevel: room.floorLevel,
      label: routeQuery.label,
      status: 'blocked',
      gridCellSize,
      requiredClearanceWidth: thresholds.primaryWalkwayWidth,
      minimumMeasuredClearanceAlongPath: 0,
      pathLength: null,
      straightLineDistance: straightDist,
      pathWaypoints: [],
      blockingInstanceIds: blockingIds,
      explanation: `No continuous passable path exists for "${routeQuery.label}" in "${room.name}"; furniture footprints completely partition the room.`,
      methodAndApproximationNote: `Evaluated via 8-connected grid pathfinding (${cols}×${rows} cells, ~${gridCellSize} ${unit} resolution).`,
    };
  }

  // Reconstruct path waypoints and find bottleneck cell
  const waypoints: Array<{ x: number; y: number }> = [];
  let curr: { r: number; c: number } | null = effEnd;
  let minCl = Infinity;
  let bottleneckCell = effStart;

  while (curr) {
    const pt = toWorld(curr.r, curr.c);
    waypoints.push(pt);
    const cl = cellClearance[curr.r][curr.c];
    if (cl < minCl) {
      minCl = cl;
      bottleneckCell = curr;
    }
    curr = parent[curr.r][curr.c];
  }
  waypoints.reverse();

  // Compute true geometric polyline length
  let pathLength = 0;
  for (let i = 1; i < waypoints.length; i++) {
    pathLength += Math.hypot(
      waypoints[i].x - waypoints[i - 1].x,
      waypoints[i].y - waypoints[i - 1].y
    );
  }
  pathLength = Number(pathLength.toFixed(2));
  const measuredMinClearance = Number(
    (Number.isFinite(minCl) ? minCl : 0).toFixed(2)
  );
  const bPt = toWorld(bottleneckCell.r, bottleneckCell.c);
  const bCause = nearestBlockerName[bottleneckCell.r][bottleneckCell.c];

  // Determine status against thresholds
  let status: CirculationRouteResult['status'] = 'passable-meets-threshold';
  const blockingIds: string[] = [];

  if (measuredMinClearance < thresholds.secondaryPassageWidth - EPSILON) {
    status = 'blocked';
    for (const item of instRects) {
      if (item.name === bCause) blockingIds.push(item.instanceId);
    }
    if (blockingIds.length === 0) {
      blockingIds.push(...findBlockingInstancesBetween());
    }
  } else if (measuredMinClearance < thresholds.primaryWalkwayWidth - EPSILON) {
    status = 'passable-narrow';
    for (const item of instRects) {
      if (item.name === bCause) blockingIds.push(item.instanceId);
    }
  }

  const explanation =
    status === 'passable-meets-threshold'
      ? `Route "${routeQuery.label}" is passable (${pathLength} ${unit} path length; minimum corridor clearance ${measuredMinClearance} ${unit} >= ${thresholds.primaryWalkwayWidth} ${unit} threshold).`
      : status === 'passable-narrow'
        ? `Route "${routeQuery.label}" is passable but narrows to ${measuredMinClearance} ${unit} near "${bCause}" (below primary walkway threshold ${thresholds.primaryWalkwayWidth} ${unit}, above secondary passage minimum ${thresholds.secondaryPassageWidth} ${unit}).`
        : `Route "${routeQuery.label}" pinches to ${measuredMinClearance} ${unit} near "${bCause}", which is below the minimum passable threshold (${thresholds.secondaryPassageWidth} ${unit}).`;

  return {
    routeId: routeQuery.id,
    roomId: room.id,
    roomName: room.name,
    floorLevel: room.floorLevel,
    label: routeQuery.label,
    status,
    gridCellSize,
    requiredClearanceWidth: thresholds.primaryWalkwayWidth,
    minimumMeasuredClearanceAlongPath: measuredMinClearance,
    pathLength,
    straightLineDistance: straightDist,
    pathWaypoints: waypoints,
    bottleneckPoint: {
      x: bPt.x,
      y: bPt.y,
      clearance: measuredMinClearance,
      causedBy: bCause,
    },
    blockingInstanceIds: blockingIds,
    explanation,
    methodAndApproximationNote: `Evaluated via 8-connected grid pathfinding (${cols}×${rows} cells, ~${gridCellSize} ${unit} resolution). Does NOT use straight-line distance as route passability.`,
  };
}

/**
 * Evaluates circulation metrics and route passability across all rooms in the project.
 */
export function evaluateRoomCirculationAndRoutes(params: {
  project: Project;
  instances: PlacedFurnitureInstance[];
  knownOpenings: KnownRoomOpening[];
  thresholds: CirculationClearanceThresholds;
  customRoutes: CirculationRouteQuery[];
  validationDiagnostics: FurnitureValidationDiagnostic[];
}): {
  roomMetrics: RoomCirculationMetrics[];
  routeDiagnostics: FurnitureValidationDiagnostic[];
} {
  const {
    project,
    instances,
    knownOpenings,
    thresholds,
    customRoutes,
    validationDiagnostics,
  } = params;
  const unit: MeasurementUnit = project.unit || 'feet';
  const rooms = project.floorPlan?.rooms || [];
  const templates = getAllCatalogTemplates(project);
  const fixedObstacles = extractKnownFixedRoomObstacles(project);

  const roomMetrics: RoomCirculationMetrics[] = [];
  const routeDiagnostics: FurnitureValidationDiagnostic[] = [];

  for (const room of rooms) {
    const grossRoomArea = Number((room.width * room.length).toFixed(2));
    const roomInstances = instances.filter(
      (i) => i.roomId === room.id && i.floorLevel === room.floorLevel
    );
    const roomOpenings = knownOpenings.filter(
      (o) =>
        o.roomId === room.id &&
        o.floorLevel === room.floorLevel &&
        (o.type === 'door' || o.type === 'open-passage')
    );

    let occupiedFurnitureArea = 0;
    for (const inst of roomInstances) {
      const rect = getInstanceFootprintRect(inst, unit);
      const clipped = getRectOverlap(rect, {
        x: room.x,
        y: room.y,
        width: room.width,
        length: room.length,
      });
      if (clipped) {
        occupiedFurnitureArea += clipped.width * clipped.length;
      }
    }
    occupiedFurnitureArea = Number(occupiedFurnitureArea.toFixed(2));

    let occupiedFixedObstacleArea = 0;
    for (const obs of fixedObstacles) {
      if (obs.floorLevel !== room.floorLevel) continue;
      const clipped = getRectOverlap(
        { x: obs.x, y: obs.y, width: obs.width, length: obs.depth },
        { x: room.x, y: room.y, width: room.width, length: room.length }
      );
      if (clipped) {
        occupiedFixedObstacleArea += clipped.width * clipped.length;
      }
    }
    occupiedFixedObstacleArea = Number(occupiedFixedObstacleArea.toFixed(2));

    const netFreeFloorArea = Number(
      Math.max(
        0,
        grossRoomArea - occupiedFurnitureArea - occupiedFixedObstacleArea
      ).toFixed(2)
    );
    const furnitureDensityPercent =
      grossRoomArea > 0
        ? Number(((occupiedFurnitureArea / grossRoomArea) * 100).toFixed(1))
        : 0;
    const freeFloorRatioPercent =
      grossRoomArea > 0
        ? Number(((netFreeFloorArea / grossRoomArea) * 100).toFixed(1))
        : 100;

    // Pairwise minimum gap between furniture items in this room
    let minPairwiseFurnitureGap: number | null = null;
    if (roomInstances.length >= 2) {
      for (let i = 0; i < roomInstances.length; i++) {
        for (let j = i + 1; j < roomInstances.length; j++) {
          const gap = getPairwiseRectGap(
            getInstanceFootprintRect(roomInstances[i], unit),
            getInstanceFootprintRect(roomInstances[j], unit)
          );
          if (minPairwiseFurnitureGap === null || gap < minPairwiseFurnitureGap) {
            minPairwiseFurnitureGap = gap;
          }
        }
      }
    }

    // Build routes to evaluate for this room:
    // 1. User custom routes for this room
    // 2. Automatic door-to-furniture-front routes when knownOpenings exist
    const roomCustomRoutes = customRoutes.filter(
      (r) => r.roomId === room.id && r.floorLevel === room.floorLevel
    );

    const queriesToRun: CirculationRouteQuery[] = [...roomCustomRoutes];

    if (roomOpenings.length > 0 && roomInstances.length > 0) {
      const primaryOpening = roomOpenings[0];
      const { doorwayPoint } = getKnownOpeningZones(
        room,
        primaryOpening,
        thresholds
      );

      for (const inst of roomInstances) {
        const frontZone = getInstanceFrontClearanceRect(
          inst,
          thresholds,
          templates,
          unit
        );
        const targetX = Number(
          Math.min(
            room.x + room.width - 0.25,
            Math.max(room.x + 0.25, frontZone.x + frontZone.width / 2)
          ).toFixed(3)
        );
        const targetY = Number(
          Math.min(
            room.y + room.length - 0.25,
            Math.max(room.y + 0.25, frontZone.y + frontZone.length / 2)
          ).toFixed(3)
        );
        queriesToRun.push({
          id: `route-${primaryOpening.openingId}-to-${inst.instanceId}`,
          roomId: room.id,
          floorLevel: room.floorLevel,
          label: `${primaryOpening.label} → ${inst.name}`,
          startPoint: {
            x: doorwayPoint.x,
            y: doorwayPoint.y,
            source: 'known-door',
            openingId: primaryOpening.openingId,
          },
          endPoint: {
            x: targetX,
            y: targetY,
            source: 'furniture-front',
            targetInstanceId: inst.instanceId,
          },
        });
      }

      // If multiple doors exist in the room, also check door-to-door traversal
      if (roomOpenings.length >= 2) {
        const secondOpening = roomOpenings[1];
        const secondZones = getKnownOpeningZones(
          room,
          secondOpening,
          thresholds
        );
        queriesToRun.push({
          id: `route-${primaryOpening.openingId}-to-${secondOpening.openingId}`,
          roomId: room.id,
          floorLevel: room.floorLevel,
          label: `${primaryOpening.label} → ${secondOpening.label}`,
          startPoint: {
            x: doorwayPoint.x,
            y: doorwayPoint.y,
            source: 'known-door',
            openingId: primaryOpening.openingId,
          },
          endPoint: {
            x: secondZones.doorwayPoint.x,
            y: secondZones.doorwayPoint.y,
            source: 'known-door',
            openingId: secondOpening.openingId,
          },
        });
      }
    }

    const routesEvaluated: CirculationRouteResult[] = [];
    if (
      roomInstances.length > 0 &&
      roomOpenings.length === 0 &&
      roomCustomRoutes.length === 0
    ) {
      // Explicitly report insufficient-data for doorway route evaluation rather than fabricating a door
      routesEvaluated.push({
        routeId: `route-unassessed-${room.id}`,
        roomId: room.id,
        roomName: room.name,
        floorLevel: room.floorLevel,
        label: `Doorway Entry → ${room.name} Furniture`,
        status: 'insufficient-data',
        gridCellSize: unit === 'metres' ? 0.15 : 0.5,
        requiredClearanceWidth: thresholds.primaryWalkwayWidth,
        minimumMeasuredClearanceAlongPath: null,
        pathLength: null,
        straightLineDistance: null,
        pathWaypoints: [],
        blockingInstanceIds: [],
        explanation: `Door-to-furniture circulation route cannot be evaluated because "${room.name}" has no known door openings or user-selected route access points.`,
        methodAndApproximationNote:
          'Plotify never fabricates doorway locations when opening metadata is absent.',
      });
    } else {
      for (const q of queriesToRun) {
        const res = evaluateSingleCirculationRoute({
          room,
          routeQuery: q,
          roomInstances,
          fixedObstacles,
          thresholds,
          unit,
        });
        routesEvaluated.push(res);

        if (res.status === 'blocked' || res.status === 'passable-narrow') {
          routeDiagnostics.push({
            id: `diag-route-${res.routeId}`,
            category: 'circulation-route-blocked',
            severity: res.status === 'blocked' ? 'conflict' : 'warning',
            roomId: room.id,
            roomName: room.name,
            floorLevel: room.floorLevel,
            affectedInstanceIds: res.blockingInstanceIds,
            calculationMethod: res.methodAndApproximationNote,
            measuredValue:
              res.minimumMeasuredClearanceAlongPath !== null
                ? `Min path clearance ${res.minimumMeasuredClearanceAlongPath.toFixed(2)} ${unit} (path length ${res.pathLength ?? 'N/A'} ${unit})`
                : 'Path completely obstructed (0.00 clearance)',
            thresholdUsed: `Primary walkway ${thresholds.primaryWalkwayWidth.toFixed(2)} ${unit}, min passable ${thresholds.secondaryPassageWidth.toFixed(2)} ${unit} (${thresholds.thresholdProvenance})`,
            explanation: res.explanation,
            suggestedAdjustment:
              res.bottleneckPoint && res.bottleneckPoint.causedBy !== 'Room boundary'
                ? `Relocate or rotate "${res.bottleneckPoint.causedBy}" to widen the passage at (${res.bottleneckPoint.x}, ${res.bottleneckPoint.y}).`
                : `Reposition furniture in "${room.name}" to open a continuous ${thresholds.primaryWalkwayWidth.toFixed(2)} ${unit} walkway.`,
            isCompleteData: true,
            missingInputs: [],
          });
        }
      }
    }

    const roomDiags = validationDiagnostics.filter((d) => d.roomId === room.id);
    roomMetrics.push({
      roomId: room.id,
      roomName: room.name,
      roomType: room.type,
      floorLevel: room.floorLevel,
      grossRoomArea,
      occupiedFurnitureArea,
      occupiedFixedObstacleArea,
      netFreeFloorArea,
      furnitureDensityPercent,
      freeFloorRatioPercent,
      placedInstanceCount: roomInstances.length,
      knownDoorCount: roomOpenings.length,
      hasMissingDoorData: roomInstances.length > 0 && roomOpenings.length === 0,
      collisionCount: roomDiags.filter(
        (d) => d.category === 'furniture-collision'
      ).length,
      boundaryOverflowCount: roomDiags.filter(
        (d) => d.category === 'room-boundary-overflow'
      ).length,
      clearanceWarningCount: roomDiags.filter(
        (d) => d.category === 'clearance-zone-violation'
      ).length,
      doorConflictCount: roomDiags.filter(
        (d) =>
          d.category === 'door-opening-obstruction' ||
          d.category === 'door-swing-obstruction'
      ).length,
      fixedObjectConflictCount: roomDiags.filter(
        (d) => d.category === 'fixed-object-collision'
      ).length,
      minPairwiseFurnitureGap,
      routesEvaluated,
    });
  }

  return { roomMetrics, routeDiagnostics };
}

/**
 * Extracts confirmed P30 requirements and confirmed P32 preferences without promoting
 * unconfirmed inferences or overriding hard geometric constraints.
 */
export function inspectP30AndP32ContextForFurniture(project: Project): {
  confirmedP30Requirements: string[];
  unconfirmedP30IgnoredCount: number;
  unresolvedP30ConflictsCount: number;
  hasP32Profile: boolean;
  confirmedP32Preferences: string[];
  unconfirmedP32IgnoredCount: number;
} {
  const confirmedP30Requirements: string[] = [];
  let unconfirmedP30IgnoredCount = 0;
  let unresolvedP30ConflictsCount = 0;

  if (project.brief) {
    const briefData = project.brief;
    for (const space of briefData.spaces || []) {
      confirmedP30Requirements.push(
        `Space "${space.name}" (${space.category}, qty ${space.quantity})`
      );
    }
    if (briefData.interpretedBrief) {
      const ib = briefData.interpretedBrief;
      for (const req of ib.requirements || []) {
        if (req.reviewStatus === 'confirmed' || req.source === 'explicit') {
          confirmedP30Requirements.push(
            `${req.description}: ${String(req.normalizedValue)}`
          );
        } else {
          unconfirmedP30IgnoredCount++;
        }
      }
      for (const assump of ib.assumptions || []) {
        if (assump.status === 'confirmed') {
          confirmedP30Requirements.push(
            `${assump.description}: ${String(assump.assumedValue)}`
          );
        } else {
          unconfirmedP30IgnoredCount++;
        }
      }
      unresolvedP30ConflictsCount = (ib.conflicts || []).filter(
        (c) => !c.resolved
      ).length;
    }
  }

  const confirmedP32Preferences: string[] = [];
  let unconfirmedP32IgnoredCount = 0;
  const hasP32Profile = Boolean(project.designPersonalization);

  if (project.designPersonalization) {
    const profile = project.designPersonalization;
    for (const item of profile.items || []) {
      if (
        item.confirmationStatus === 'confirmed' &&
        (item.origin === 'explicit-user' ||
          item.origin === 'imported-project-fact')
      ) {
        confirmedP32Preferences.push(
          `${item.label}: ${String(item.value)} (weight ${item.weight})`
        );
      } else {
        unconfirmedP32IgnoredCount++;
      }
    }
    for (const rp of profile.roomCategoryPriorities || []) {
      if (rp.confirmationStatus === 'confirmed') {
        confirmedP32Preferences.push(
          `Room priority: ${rp.label} (weight ${rp.importanceWeight})`
        );
      } else {
        unconfirmedP32IgnoredCount++;
      }
    }
  }

  return {
    confirmedP30Requirements,
    unconfirmedP30IgnoredCount,
    unresolvedP30ConflictsCount,
    hasP32Profile,
    confirmedP32Preferences,
    unconfirmedP32IgnoredCount,
  };
}

/**
 * Generates deterministic, explainable furniture layout improvement suggestions (Section 12 of Prompt 33).
 * Never auto-applies changes without explicit user preview & confirmation.
 */
export function generateFurnitureLayoutSuggestions(params: {
  project: Project;
  instances: PlacedFurnitureInstance[];
  knownOpenings: KnownRoomOpening[];
  thresholds: CirculationClearanceThresholds;
  diagnostics: FurnitureValidationDiagnostic[];
}): FurnitureLayoutSuggestion[] {
  const { project, instances, knownOpenings, thresholds, diagnostics } = params;
  const unit: MeasurementUnit = project.unit || 'feet';
  const rooms = project.floorPlan?.rooms || [];
  const roomMap = new Map<string, FloorPlanRoom>();
  for (const r of rooms) roomMap.set(r.id, r);

  const p30p32 = inspectP30AndP32ContextForFurniture(project);
  const suggestions: FurnitureLayoutSuggestion[] = [];

  // Helper to find a conflict-free candidate position & rotation for an instance inside its room
  const findValidPositionInRoom = (
    targetInst: PlacedFurnitureInstance,
    room: FloorPlanRoom,
    otherInstances: PlacedFurnitureInstance[],
    roomOpenings: KnownRoomOpening[],
    preferRotationChange = false
  ): PlacedFurnitureInstance | null => {
    const candidateRotations = preferRotationChange
      ? [
          (targetInst.rotationDeg + 90) % 360,
          (targetInst.rotationDeg + 180) % 360,
          (targetInst.rotationDeg + 270) % 360,
          targetInst.rotationDeg,
        ]
      : [
          targetInst.rotationDeg,
          (targetInst.rotationDeg + 90) % 360,
          (targetInst.rotationDeg + 180) % 360,
          (targetInst.rotationDeg + 270) % 360,
        ];

    const step = unit === 'metres' ? 0.3 : 1.0;

    for (const rot of candidateRotations) {
      const rotated = rotateFurnitureInstance(targetInst, rot);
      const rectSize = getInstanceFootprintRect(rotated, unit);
      if (rectSize.width > room.width || rectSize.length > room.length) {
        continue;
      }

      for (
        let y = room.y;
        y <= room.y + room.length - rectSize.length + EPSILON;
        y += step
      ) {
        for (
          let x = room.x;
          x <= room.x + room.width - rectSize.width + EPSILON;
          x += step
        ) {
          const cand = moveFurnitureInstance(rotated, x, y);
          const candRect = getInstanceFootprintRect(cand, unit);

          let hasOverlap = false;
          for (const other of otherInstances) {
            if (other.floorLevel !== cand.floorLevel) continue;
            const otherRect = getInstanceFootprintRect(other, unit);
            if (getRectOverlap(candRect, otherRect)) {
              hasOverlap = true;
              break;
            }
          }
          if (hasOverlap) continue;

          // Check known openings
          for (const op of roomOpenings) {
            const { approachZone, swingZone } = getKnownOpeningZones(
              room,
              op,
              thresholds
            );
            if (
              getRectOverlap(candRect, approachZone) ||
              (swingZone && getRectOverlap(candRect, swingZone))
            ) {
              hasOverlap = true;
              break;
            }
          }
          if (!hasOverlap) {
            return cand;
          }
        }
      }
    }
    return null;
  };

  // 1. Resolve Room Boundary Overflows
  for (const diag of diagnostics.filter(
    (d) => d.category === 'room-boundary-overflow'
  )) {
    const instId = diag.affectedInstanceIds[0];
    const inst = instances.find((i) => i.instanceId === instId);
    if (!inst || inst.isLocked) continue;
    const room = roomMap.get(inst.roomId);
    if (!room) continue;

    const others = instances.filter((i) => i.instanceId !== inst.instanceId);
    const roomOpenings = knownOpenings.filter((o) => o.roomId === room.id);
    const candidate = findValidPositionInRoom(inst, room, others, roomOpenings);

    if (candidate) {
      const rotatedChanged = candidate.rotationDeg !== inst.rotationDeg;
      suggestions.push({
        suggestionId: `sug-boundary-${inst.instanceId}`,
        type: 'resolve-boundary-overflow',
        title: `Reposition "${inst.name}" inside "${room.name}" bounds`,
        targetRoomId: room.id,
        targetRoomName: room.name,
        targetInstanceIds: [inst.instanceId],
        triggerDiagnosticIds: [diag.id],
        influencedByP30Requirements: p30p32.confirmedP30Requirements.slice(0, 2),
        influencedByP32Preferences: p30p32.confirmedP32Preferences.slice(0, 2),
        rationale: `"${inst.name}" currently extends outside "${room.name}". Moving it to (${candidate.x}, ${candidate.y})${rotatedChanged ? ` and rotating to ${candidate.rotationDeg}°` : ''} eliminates the boundary overflow without colliding with other furniture or known doorways.`,
        evidenceBasis: 'computed-geometric-resolution',
        proposedChanges: [
          {
            instanceId: inst.instanceId,
            instanceName: inst.name,
            action: rotatedChanged ? 'rotate' : 'move',
            beforeSummary: `(${inst.x}, ${inst.y}) ${unit}, rot ${inst.rotationDeg}°`,
            afterSummary: `(${candidate.x}, ${candidate.y}) ${unit}, rot ${candidate.rotationDeg}°`,
            proposedInstance: candidate,
          },
        ],
        expectedImprovementSummary:
          'Resolves 1 room boundary overflow conflict while preserving room walls and existing furniture.',
      });
    }
  }

  // 2. Resolve Furniture-to-Furniture Collisions
  for (const diag of diagnostics.filter(
    (d) => d.category === 'furniture-collision'
  )) {
    const movableId = diag.affectedInstanceIds.find((id) => {
      const found = instances.find((i) => i.instanceId === id);
      return found && !found.isLocked;
    });
    if (!movableId) continue;
    const inst = instances.find((i) => i.instanceId === movableId)!;
    const room = roomMap.get(inst.roomId);
    if (!room) continue;

    const others = instances.filter((i) => i.instanceId !== inst.instanceId);
    const roomOpenings = knownOpenings.filter((o) => o.roomId === room.id);
    const candidate = findValidPositionInRoom(inst, room, others, roomOpenings);

    if (candidate) {
      suggestions.push({
        suggestionId: `sug-collision-${diag.id}`,
        type: 'resolve-collision',
        title: `Separate "${inst.name}" to resolve footprint collision in "${room.name}"`,
        targetRoomId: room.id,
        targetRoomName: room.name,
        targetInstanceIds: [inst.instanceId],
        triggerDiagnosticIds: [diag.id],
        influencedByP30Requirements: p30p32.confirmedP30Requirements.slice(0, 2),
        influencedByP32Preferences: p30p32.confirmedP32Preferences.slice(0, 2),
        rationale: `${diag.explanation} Relocating "${inst.name}" to (${candidate.x}, ${candidate.y}) ${unit} eliminates the physical overlap.`,
        evidenceBasis: 'computed-geometric-resolution',
        proposedChanges: [
          {
            instanceId: inst.instanceId,
            instanceName: inst.name,
            action:
              candidate.rotationDeg !== inst.rotationDeg ? 'rotate' : 'move',
            beforeSummary: `(${inst.x}, ${inst.y}) ${unit}, rot ${inst.rotationDeg}°`,
            afterSummary: `(${candidate.x}, ${candidate.y}) ${unit}, rot ${candidate.rotationDeg}°`,
            proposedInstance: candidate,
          },
        ],
        expectedImprovementSummary:
          'Eliminates pairwise furniture footprint overlap.',
      });
    }
  }

  // 3. Resolve Doorway / Door-Swing Conflicts
  for (const diag of diagnostics.filter(
    (d) =>
      d.category === 'door-opening-obstruction' ||
      d.category === 'door-swing-obstruction'
  )) {
    const instId = diag.affectedInstanceIds[0];
    const inst = instances.find((i) => i.instanceId === instId);
    if (!inst || inst.isLocked) continue;
    const room = roomMap.get(inst.roomId);
    if (!room) continue;

    const others = instances.filter((i) => i.instanceId !== inst.instanceId);
    const roomOpenings = knownOpenings.filter((o) => o.roomId === room.id);
    const candidate = findValidPositionInRoom(inst, room, others, roomOpenings);

    if (candidate) {
      suggestions.push({
        suggestionId: `sug-door-${diag.id}`,
        type: 'resolve-door-conflict',
        title: `Clear doorway zone in "${room.name}" by moving "${inst.name}"`,
        targetRoomId: room.id,
        targetRoomName: room.name,
        targetInstanceIds: [inst.instanceId],
        triggerDiagnosticIds: [diag.id],
        influencedByP30Requirements: p30p32.confirmedP30Requirements.slice(0, 2),
        influencedByP32Preferences: p30p32.confirmedP32Preferences.slice(0, 2),
        rationale: `${diag.explanation} Moving "${inst.name}" to (${candidate.x}, ${candidate.y}) ${unit} restores unobstructed doorway approach and swing clearance.`,
        evidenceBasis: 'computed-geometric-resolution',
        proposedChanges: [
          {
            instanceId: inst.instanceId,
            instanceName: inst.name,
            action: 'move',
            beforeSummary: `(${inst.x}, ${inst.y}) ${unit}, rot ${inst.rotationDeg}°`,
            afterSummary: `(${candidate.x}, ${candidate.y}) ${unit}, rot ${candidate.rotationDeg}°`,
            proposedInstance: candidate,
          },
        ],
        expectedImprovementSummary:
          'Restores full doorway approach and swing arc clearance.',
      });
    }
  }

  // 4. Resolve Front Clearance / Circulation Warnings via Rotation or Relocation
  for (const diag of diagnostics.filter(
    (d) =>
      d.category === 'clearance-zone-violation' ||
      d.category === 'circulation-route-blocked'
  )) {
    const instId = diag.affectedInstanceIds[0];
    if (!instId) continue;
    const inst = instances.find((i) => i.instanceId === instId);
    if (!inst || inst.isLocked) continue;
    const room = roomMap.get(inst.roomId);
    if (!room) continue;

    if (
      suggestions.some((s) => s.targetInstanceIds.includes(inst.instanceId))
    ) {
      continue;
    }

    const others = instances.filter((i) => i.instanceId !== inst.instanceId);
    const roomOpenings = knownOpenings.filter((o) => o.roomId === room.id);
    const candidate = findValidPositionInRoom(
      inst,
      room,
      others,
      roomOpenings,
      true
    );

    if (
      candidate &&
      (candidate.x !== inst.x ||
        candidate.y !== inst.y ||
        candidate.rotationDeg !== inst.rotationDeg)
    ) {
      suggestions.push({
        suggestionId: `sug-clearance-${diag.id}`,
        type:
          diag.category === 'circulation-route-blocked'
            ? 'relocate-for-route'
            : 'improve-clearance-rotation',
        title: `Reorient "${inst.name}" in "${room.name}" to improve circulation clearance`,
        targetRoomId: room.id,
        targetRoomName: room.name,
        targetInstanceIds: [inst.instanceId],
        triggerDiagnosticIds: [diag.id],
        influencedByP30Requirements: p30p32.confirmedP30Requirements.slice(0, 2),
        influencedByP32Preferences: p30p32.confirmedP32Preferences.slice(0, 2),
        rationale: `${diag.explanation} Adjusting "${inst.name}" to (${candidate.x}, ${candidate.y}) ${unit} at ${candidate.rotationDeg}° improves functional front clearance and walkway width.`,
        evidenceBasis:
          p30p32.confirmedP30Requirements.length > 0 ||
          p30p32.confirmedP32Preferences.length > 0
            ? 'deterministic-heuristic-with-confirmed-preferences'
            : 'computed-geometric-resolution',
        proposedChanges: [
          {
            instanceId: inst.instanceId,
            instanceName: inst.name,
            action:
              candidate.rotationDeg !== inst.rotationDeg ? 'rotate' : 'move',
            beforeSummary: `(${inst.x}, ${inst.y}) ${unit}, rot ${inst.rotationDeg}°`,
            afterSummary: `(${candidate.x}, ${candidate.y}) ${unit}, rot ${candidate.rotationDeg}°`,
            proposedInstance: candidate,
          },
        ],
        expectedImprovementSummary:
          'Improves front clearance and route passage width inside the room.',
      });
    }
  }

  // 5. Starter room arrangement suggestion for unfurnished rooms (informed by confirmed P30/P32 context)
  for (const room of rooms) {
    const roomInstances = instances.filter((i) => i.roomId === room.id);
    if (roomInstances.length > 0) continue;

    let starterTemplateId: string | null = null;
    if (room.type === 'bedroom') starterTemplateId = 'tpl-bed-queen';
    else if (room.type === 'living') starterTemplateId = 'tpl-sofa-3seat';
    else if (room.type === 'dining') starterTemplateId = 'tpl-dining-6seat';
    else if (room.type === 'kitchen') starterTemplateId = 'tpl-kitchen-counter';
    else if (room.type === 'bathroom') starterTemplateId = 'tpl-bath-vanity';
    else if (room.type === 'utility') starterTemplateId = 'tpl-laundry-washer';

    if (!starterTemplateId) continue;
    const tpl = STARTER_FURNITURE_CATALOG.find(
      (t) => t.templateId === starterTemplateId
    );
    if (!tpl) continue;

    const proposedInst = createPlacedFurnitureInstance({
      project,
      template: tpl,
      roomId: room.id,
    });
    const rect = getInstanceFootprintRect(proposedInst, unit);
    if (rect.width <= room.width && rect.length <= room.length) {
      suggestions.push({
        suggestionId: `sug-starter-${room.id}`,
        type: 'p30-p32-starter-arrangement',
        title: `Place starter "${tpl.name}" in unfurnished "${room.name}"`,
        targetRoomId: room.id,
        targetRoomName: room.name,
        targetInstanceIds: [proposedInst.instanceId],
        triggerDiagnosticIds: [],
        influencedByP30Requirements: p30p32.confirmedP30Requirements.slice(0, 3),
        influencedByP32Preferences: p30p32.confirmedP32Preferences.slice(0, 3),
        rationale: `"${room.name}" (${room.width}×${room.length} ${unit}) currently has no placed furniture. Placing a "${tpl.name}" (${rect.width}×${rect.length} ${unit}) provides a baseline functional footprint aligned with confirmed room type "${room.type}".`,
        evidenceBasis:
          p30p32.confirmedP30Requirements.length > 0 ||
          p30p32.confirmedP32Preferences.length > 0
            ? 'deterministic-heuristic-with-confirmed-preferences'
            : 'computed-geometric-resolution',
        proposedChanges: [
          {
            instanceId: proposedInst.instanceId,
            instanceName: proposedInst.name,
            action: 'place-new',
            beforeSummary: 'Unfurnished room (0 items)',
            afterSummary: `Place "${proposedInst.name}" at (${proposedInst.x}, ${proposedInst.y}) ${unit}`,
            proposedInstance: proposedInst,
          },
        ],
        expectedImprovementSummary: `Establishes initial furniture layout in "${room.name}" while maintaining ${((1 - (rect.width * rect.length) / (room.width * room.length)) * 100).toFixed(0)}% free floor area.`,
      });
    }
  }

  return suggestions;
}

/**
 * Computes a non-destructive preview diff for a proposed furniture suggestion
 * without mutating the project's saved furniture instances.
 */
export function previewFurnitureSuggestion(params: {
  project: Project;
  currentInstances: PlacedFurnitureInstance[];
  knownOpenings: KnownRoomOpening[];
  thresholds: CirculationClearanceThresholds;
  customRoutes: CirculationRouteQuery[];
  suggestion: FurnitureLayoutSuggestion;
}): FurnitureSuggestionPreviewDiff {
  const {
    project,
    currentInstances,
    knownOpenings,
    thresholds,
    customRoutes,
    suggestion,
  } = params;

  const beforeValDiags = validateFurnitureLayout({
    project,
    instances: currentInstances,
    knownOpenings,
    thresholds,
  });
  const beforeCirc = evaluateRoomCirculationAndRoutes({
    project,
    instances: currentInstances,
    knownOpenings,
    thresholds,
    customRoutes,
    validationDiagnostics: beforeValDiags,
  });
  const allBeforeDiags = [...beforeValDiags, ...beforeCirc.routeDiagnostics];

  // Build proposed instances array without mutating currentInstances
  const proposedInstances = currentInstances.map((inst) => ({ ...inst }));
  for (const change of suggestion.proposedChanges) {
    const idx = proposedInstances.findIndex(
      (i) => i.instanceId === change.instanceId
    );
    if (idx >= 0) {
      proposedInstances[idx] = { ...change.proposedInstance };
    } else if (change.action === 'place-new') {
      proposedInstances.push({ ...change.proposedInstance });
    }
  }

  const afterValDiags = validateFurnitureLayout({
    project,
    instances: proposedInstances,
    knownOpenings,
    thresholds,
  });
  const afterCirc = evaluateRoomCirculationAndRoutes({
    project,
    instances: proposedInstances,
    knownOpenings,
    thresholds,
    customRoutes,
    validationDiagnostics: afterValDiags,
  });
  const allAfterDiags = [...afterValDiags, ...afterCirc.routeDiagnostics];

  const beforeRoomMetric = beforeCirc.roomMetrics.find(
    (m) => m.roomId === suggestion.targetRoomId
  );
  const afterRoomMetric = afterCirc.roomMetrics.find(
    (m) => m.roomId === suggestion.targetRoomId
  );

  const beforeConflictCount = allBeforeDiags.filter(
    (d) => d.severity === 'conflict'
  ).length;
  const afterConflictCount = allAfterDiags.filter(
    (d) => d.severity === 'conflict'
  ).length;
  const beforeWarningCount = allBeforeDiags.filter(
    (d) => d.severity === 'warning'
  ).length;
  const afterWarningCount = allAfterDiags.filter(
    (d) => d.severity === 'warning'
  ).length;

  const isSafeToApply = afterConflictCount <= beforeConflictCount;
  const safetyNotes: string[] = [
    'Preview is non-destructive; saved room geometry and walls are never modified.',
    `Conflicts change from ${beforeConflictCount} to ${afterConflictCount}; warnings change from ${beforeWarningCount} to ${afterWarningCount}.`,
  ];

  return {
    suggestionId: suggestion.suggestionId,
    title: suggestion.title,
    targetRoomId: suggestion.targetRoomId,
    beforeConflictCount,
    afterConflictCount,
    beforeWarningCount,
    afterWarningCount,
    beforeFreeFloorRatioPercent: beforeRoomMetric?.freeFloorRatioPercent ?? 100,
    afterFreeFloorRatioPercent: afterRoomMetric?.freeFloorRatioPercent ?? 100,
    isSafeToApply,
    safetyNotes,
    proposedInstances,
  };
}

/**
 * Exports a clean, read-only P33 furniture & circulation summary for P31 Multi-Option Design Comparison
 * without altering P31's core logic.
 */
export function getP33MetricsForOptionComparison(
  project: Project,
  instancesOverride?: PlacedFurnitureInstance[],
  knownOpeningsOverride?: KnownRoomOpening[],
  thresholdsOverride?: CirculationClearanceThresholds,
  customRoutesOverride?: CirculationRouteQuery[]
): P33OptionComparisonSummary {
  const layout = ensureProjectFurnitureLayoutData(project);
  const instances = instancesOverride ?? layout.instances;
  const knownOpenings = knownOpeningsOverride ?? layout.knownOpenings;
  const thresholds = thresholdsOverride ?? layout.clearanceThresholds;
  const customRoutes = customRoutesOverride ?? layout.customRoutes;

  const valDiags = validateFurnitureLayout({
    project,
    instances,
    knownOpenings,
    thresholds,
  });
  const circ = evaluateRoomCirculationAndRoutes({
    project,
    instances,
    knownOpenings,
    thresholds,
    customRoutes,
    validationDiagnostics: valDiags,
  });

  const furnishedRooms = circ.roomMetrics.filter(
    (m) => m.placedInstanceCount > 0
  );
  const averageFreeFloorRatioPercent =
    furnishedRooms.length > 0
      ? Number(
          (
            furnishedRooms.reduce((acc, m) => acc + m.freeFloorRatioPercent, 0) /
            furnishedRooms.length
          ).toFixed(1)
        )
      : null;

  const blockedRoutesCount = circ.roomMetrics.reduce(
    (acc, m) =>
      acc + m.routesEvaluated.filter((r) => r.status === 'blocked').length,
    0
  );
  const unassessedDoorRoomsCount = circ.roomMetrics.filter(
    (m) => m.hasMissingDoorData
  ).length;

  return {
    projectId: project.id,
    engineVersion: P33_FURNITURE_ENGINE_VERSION,
    totalPlacedFurnitureCount: instances.length,
    furnishedRoomsCount: furnishedRooms.length,
    totalRoomsCount: circ.roomMetrics.length,
    totalCollisionCount: valDiags.filter(
      (d) => d.category === 'furniture-collision'
    ).length,
    totalBoundaryOverflowCount: valDiags.filter(
      (d) => d.category === 'room-boundary-overflow'
    ).length,
    totalDoorConflictCount: valDiags.filter(
      (d) =>
        d.category === 'door-opening-obstruction' ||
        d.category === 'door-swing-obstruction'
    ).length,
    totalClearanceWarningCount: valDiags.filter(
      (d) => d.category === 'clearance-zone-violation'
    ).length,
    averageFreeFloorRatioPercent,
    blockedRoutesCount,
    unassessedDoorRoomsCount,
    noteForP31Comparison:
      instances.length === 0
        ? 'No P33 furniture layout placed for this option yet.'
        : `${instances.length} furniture items across ${furnishedRooms.length}/${circ.roomMetrics.length} rooms; avg free floor ratio ${averageFreeFloorRatioPercent}%.`,
  };
}

/**
 * Full deterministic P33 Furniture & Circulation Intelligence evaluation pipeline.
 */
export function evaluateFurnitureIntelligence(params: {
  project: Project;
  instances?: PlacedFurnitureInstance[];
  knownOpenings?: KnownRoomOpening[];
  clearanceThresholds?: CirculationClearanceThresholds;
  customRoutes?: CirculationRouteQuery[];
  requestSequenceId?: number;
}): FurnitureIntelligenceEvaluationResult {
  const { project } = params;
  const layout = ensureProjectFurnitureLayoutData(project);
  const unit: MeasurementUnit = project.unit || 'feet';

  const instances = params.instances ?? layout.instances;
  const knownOpenings = params.knownOpenings ?? layout.knownOpenings;
  const clearanceThresholds =
    params.clearanceThresholds ?? layout.clearanceThresholds;
  const customRoutes = params.customRoutes ?? layout.customRoutes;
  const requestSequenceId =
    params.requestSequenceId ?? layout.requestSequenceId;

  const valDiags = validateFurnitureLayout({
    project,
    instances,
    knownOpenings,
    thresholds: clearanceThresholds,
  });

  const { roomMetrics, routeDiagnostics } = evaluateRoomCirculationAndRoutes({
    project,
    instances,
    knownOpenings,
    thresholds: clearanceThresholds,
    customRoutes,
    validationDiagnostics: valDiags,
  });

  const allDiagnostics = [...valDiags, ...routeDiagnostics];

  const suggestions = generateFurnitureLayoutSuggestions({
    project,
    instances,
    knownOpenings,
    thresholds: clearanceThresholds,
    diagnostics: allDiagnostics,
  });

  const p30p32 = inspectP30AndP32ContextForFurniture(project);
  const p31ExportSummary = getP33MetricsForOptionComparison(
    project,
    instances,
    knownOpenings,
    clearanceThresholds,
    customRoutes
  );

  const sourceFingerprint = `p33-${project.id}-i${instances.length}-o${knownOpenings.length}-r${customRoutes.length}-seq${requestSequenceId}`;

  return {
    evaluationId: `eval-p33-${Date.now()}-${requestSequenceId}`,
    engineVersion: P33_FURNITURE_ENGINE_VERSION,
    projectId: project.id,
    projectName: project.name,
    unit,
    evaluatedAt: new Date().toISOString(),
    requestSequenceId,
    sourceFingerprint,
    clearanceThresholds,
    diagnostics: allDiagnostics,
    roomMetrics,
    suggestions,
    p30CompatibilitySummary: {
      confirmedRequirementsUsed: p30p32.confirmedP30Requirements,
      unconfirmedAssumptionsIgnored: p30p32.unconfirmedP30IgnoredCount,
      unresolvedBriefConflictsCount: p30p32.unresolvedP30ConflictsCount,
    },
    p32CompatibilitySummary: {
      hasPersonalizationProfile: p30p32.hasP32Profile,
      confirmedPreferencesUsed: p30p32.confirmedP32Preferences,
      unconfirmedSuggestionsIgnored: p30p32.unconfirmedP32IgnoredCount,
    },
    p31ExportSummary,
    p34BoundaryDisclaimer: P34_BOUNDARY_DISCLAIMER,
  };
}

/**
 * Safely persists P33 furniture layout data onto a Project copy after creating an automatic
 * pre-save project snapshot via `snapshotService.createProjectSnapshot`.
 * Never mutates `project.floorPlan.rooms` or any room walls/dimensions.
 */
export function saveProjectFurnitureLayoutSafely(params: {
  project: Project;
  layoutData: ProjectFurnitureLayoutData;
  actor?: string;
  reason?: string;
}): {
  updatedProject: Project;
  preSaveSnapshotId: string | null;
} {
  const { project, layoutData, actor = 'user', reason } = params;

  // Validate payload before persisting
  if (!Array.isArray(layoutData.instances)) {
    throw new Error('Invalid furniture layout payload: instances must be an array.');
  }
  for (const inst of layoutData.instances) {
    if (
      !Number.isFinite(inst.x) ||
      !Number.isFinite(inst.y) ||
      !Number.isFinite(inst.width) ||
      !Number.isFinite(inst.depth) ||
      inst.width <= 0 ||
      inst.depth <= 0
    ) {
      throw new Error(
        `Cannot save invalid furniture instance "${inst.name}": dimensions must be positive finite numbers.`
      );
    }
  }

  let preSaveSnapshotId: string | null = null;
  try {
    const snap = createProjectSnapshot(project, {
      trigger: 'auto-checkpoint',
      label: reason || 'Pre-P33 Furniture & Circulation Layout Checkpoint',
      description: `Automated checkpoint created by ${actor} prior to saving P33 furniture layout.`,
    });
    preSaveSnapshotId = snap.id;
    inMemoryP33Snapshots.set(snap.id, snap);
  } catch {
    preSaveSnapshotId = null;
  }

  const nextSeq = (layoutData.requestSequenceId || 1) + 1;
  const savedLayout: ProjectFurnitureLayoutData = {
    ...layoutData,
    version: P33_FURNITURE_ENGINE_VERSION,
    unit: project.unit || layoutData.unit || 'feet',
    lastSavedAt: new Date().toISOString(),
    lastPreSaveSnapshotId:
      preSaveSnapshotId ?? layoutData.lastPreSaveSnapshotId ?? null,
    requestSequenceId: nextSeq,
  };

  const updatedProject: Project = {
    ...project,
    furnitureLayout: savedLayout,
    updatedAt: new Date().toISOString(),
  };

  return {
    updatedProject,
    preSaveSnapshotId,
  };
}

/**
 * Applies a user-confirmed P33 furniture layout suggestion safely with automatic snapshot protection.
 */
export function applyFurnitureSuggestionWithConfirmation(params: {
  project: Project;
  suggestion: FurnitureLayoutSuggestion;
  userConfirmed: boolean;
}): {
  updatedProject: Project;
  preSaveSnapshotId: string | null;
} {
  const { project, suggestion, userConfirmed } = params;
  if (!userConfirmed) {
    throw new Error(
      'Furniture layout suggestions cannot be applied without explicit user confirmation.'
    );
  }

  const layout = ensureProjectFurnitureLayoutData(project);
  const nextInstances = layout.instances.map((i) => ({ ...i }));

  for (const change of suggestion.proposedChanges) {
    const idx = nextInstances.findIndex(
      (i) => i.instanceId === change.instanceId
    );
    if (idx >= 0) {
      nextInstances[idx] = { ...change.proposedInstance };
    } else if (change.action === 'place-new') {
      nextInstances.push({ ...change.proposedInstance });
    }
  }

  return saveProjectFurnitureLayoutSafely({
    project,
    layoutData: {
      ...layout,
      instances: nextInstances,
    },
    actor: 'user-confirmed-p33-suggestion',
    reason: `Pre-P33 suggestion application (${suggestion.title})`,
  });
}

/**
 * Restores a project to its pre-P33 furniture layout snapshot via `executeSafeRestore`.
 */
export function rollbackProjectFurnitureLayout(
  project: Project,
  snapshotId?: string
): Project {
  const targetSnapshotId =
    snapshotId || project.furnitureLayout?.lastPreSaveSnapshotId;
  const snaps = getProjectSnapshots(project);
  const targetSnapshot =
    (targetSnapshotId ? inMemoryP33Snapshots.get(targetSnapshotId) : undefined) ||
    (targetSnapshotId ? snaps.find((s) => s.id === targetSnapshotId) : undefined) ||
    snaps[0];

  if (!targetSnapshot) {
    throw new Error('No snapshot available to restore furniture layout.');
  }

  const res = executeSafeRestore(project, targetSnapshot);
  if (!res.success || !res.restoredProject) {
    throw new Error(
      res.validation.errors.join('; ') || 'Snapshot rollback failed.'
    );
  }
  return res.restoredProject;
}
