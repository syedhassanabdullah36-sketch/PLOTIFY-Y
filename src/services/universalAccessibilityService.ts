/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P34 — Universal Accessibility Review Service
 * Account A | Locked Roadmap: P34 of P30–P40
 *
 * Provides jurisdiction-aware rule profile governance, exact continuous 2D
 * geometric turning/clear-floor/doorway analysis, P30/P31/P32/P33 integration,
 * honest unassessed topic reporting, non-destructive suggestion preview,
 * atomic application with snapshot creation, and safe rollback.
 */

import { Project, FloorPlanRoom, MeasurementUnit } from '../types/project';
import {
  P34_ACCESSIBILITY_ENGINE_VERSION,
  AccessibilityResultStatus,
  AccessibilityRuleProfileId,
  AccessibilityRuleProfile,
  AccessibilityProfileThresholds,
  BuildingOccupancyAccessibilityType,
  ConstructionAccessibilityScope,
  ProjectAccessibilityReviewData,
  AccessibilityCriterionResult,
  AccessibilityTopicId,
  AccessibilityTopicCoverageItem,
  RoomAccessibilityDiagnostic,
  AccessibilityGeometricOverlayItem,
  AccessibilityImprovementSuggestion,
  AccessibilitySuggestionPreview,
  P30P32AccessibilityAlignmentReport,
  UniversalAccessibilityEvaluationReport,
  P34OptionComparisonSummary,
  DoorAccessibilityMetadata,
} from '../types/universalAccessibility';
import {
  convertMeasurement,
  ensureProjectFurnitureLayoutData,
  getAllCatalogTemplates,
  getInstanceFootprintRect,
  getInstanceFrontClearanceRect,
  getKnownOpeningZones,
  extractKnownFixedRoomObstacles,
  evaluateFurnitureIntelligence,
  AABBRect,
} from './furnitureIntelligenceService';
import {
  createProjectSnapshot,
  getProjectSnapshots,
  executeSafeRestore,
} from './versioningService';

// In-memory snapshot fallback for headless Node.js / CLI test environments without localStorage
const memoryAccessibilitySnapshots = new Map<string, Project>();

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMeasure(val: number, unit: MeasurementUnit): string {
  const suffix = unit === 'feet' ? 'ft' : 'm';
  return `${round2(val)} ${suffix}`;
}

function formatMinorMeasure(val: number, unit: MeasurementUnit): string {
  const suffix = unit === 'feet' ? 'in' : 'mm';
  return `${round2(val)} ${suffix}`;
}

function getRoomBoundsRect(room: FloorPlanRoom): AABBRect {
  return {
    x: room.x,
    y: room.y,
    width: room.width,
    length: room.length,
  };
}

/**
 * Converts thresholds defined in a canonical unit ('feet' or 'metres') to the target unit.
 */
function convertProfileThresholds(
  source: AccessibilityProfileThresholds,
  targetUnit: MeasurementUnit
): AccessibilityProfileThresholds {
  if (source.unit === targetUnit) {
    return { ...source };
  }
  const conv = (v: number) => round2(convertMeasurement(v, source.unit, targetUnit));
  const convMinor = (v: number) =>
    source.unit === 'feet' && targetUnit === 'metres'
      ? Math.round(v * 25.4)
      : round2(v / 25.4);

  return {
    unit: targetUnit,
    turningCircleDiameter: conv(source.turningCircleDiameter),
    tTurnArmWidth: conv(source.tTurnArmWidth),
    tTurnTotalSpan: conv(source.tTurnTotalSpan),
    clearFloorSpaceWidth: conv(source.clearFloorSpaceWidth),
    clearFloorSpaceLength: conv(source.clearFloorSpaceLength),
    minDoorClearOpeningWidth: conv(source.minDoorClearOpeningWidth),
    doorPullSideManeuverDepth: conv(source.doorPullSideManeuverDepth),
    doorPullSideLatchClearance: conv(source.doorPullSideLatchClearance),
    doorPushSideManeuverDepth: conv(source.doorPushSideManeuverDepth),
    maxDoorThresholdHeightMinorUnit: convMinor(source.maxDoorThresholdHeightMinorUnit),
    minAccessibleRouteClearWidth: conv(source.minAccessibleRouteClearWidth),
    minRoutePassingWidth: conv(source.minRoutePassingWidth),
    maxRampSlopeRatio: source.maxRampSlopeRatio,
    maxRampCrossSlopeRatio: source.maxRampCrossSlopeRatio,
    minRampClearWidth: conv(source.minRampClearWidth),
    minRampLandingLength: conv(source.minRampLandingLength),
    minStairClearWidth: conv(source.minStairClearWidth),
    minLiftCabWidth: conv(source.minLiftCabWidth),
    minLiftCabDepth: conv(source.minLiftCabDepth),
    minReachHeightMinorUnit: convMinor(source.minReachHeightMinorUnit),
    maxReachHeightMinorUnit: convMinor(source.maxReachHeightMinorUnit),
  };
}

const CANONICAL_FEET_THRESHOLDS: AccessibilityProfileThresholds = {
  unit: 'feet',
  turningCircleDiameter: 5.0, // 60 in
  tTurnArmWidth: 3.0, // 36 in
  tTurnTotalSpan: 5.0, // 60 in
  clearFloorSpaceWidth: 2.5, // 30 in
  clearFloorSpaceLength: 4.0, // 48 in
  minDoorClearOpeningWidth: 2.67, // 32 in
  doorPullSideManeuverDepth: 5.0, // 60 in
  doorPullSideLatchClearance: 1.5, // 18 in
  doorPushSideManeuverDepth: 4.0, // 48 in
  maxDoorThresholdHeightMinorUnit: 0.5, // 0.5 in
  minAccessibleRouteClearWidth: 3.0, // 36 in
  minRoutePassingWidth: 5.0, // 60 in
  maxRampSlopeRatio: 1 / 12, // 1:12 (8.33%)
  maxRampCrossSlopeRatio: 1 / 48, // 1:48 (2.08%)
  minRampClearWidth: 3.0, // 36 in
  minRampLandingLength: 5.0, // 60 in
  minStairClearWidth: 3.0, // 36 in
  minLiftCabWidth: 4.25, // 51 in
  minLiftCabDepth: 5.67, // 68 in
  minReachHeightMinorUnit: 15, // 15 in
  maxReachHeightMinorUnit: 48, // 48 in
};

const CANONICAL_ISO_METRE_THRESHOLDS: AccessibilityProfileThresholds = {
  unit: 'metres',
  turningCircleDiameter: 1.5, // 1500 mm
  tTurnArmWidth: 0.9, // 900 mm
  tTurnTotalSpan: 1.5, // 1500 mm
  clearFloorSpaceWidth: 0.8, // 800 mm
  clearFloorSpaceLength: 1.3, // 1300 mm
  minDoorClearOpeningWidth: 0.85, // 850 mm
  doorPullSideManeuverDepth: 1.5, // 1500 mm
  doorPullSideLatchClearance: 0.5, // 500 mm
  doorPushSideManeuverDepth: 1.2, // 1200 mm
  maxDoorThresholdHeightMinorUnit: 13, // 13 mm
  minAccessibleRouteClearWidth: 0.9, // 900 mm
  minRoutePassingWidth: 1.5, // 1500 mm
  maxRampSlopeRatio: 1 / 12, // 1:12 (8.33%)
  maxRampCrossSlopeRatio: 1 / 50, // 1:50 (2.00%)
  minRampClearWidth: 1.0, // 1000 mm
  minRampLandingLength: 1.5, // 1500 mm
  minStairClearWidth: 1.0, // 1000 mm
  minLiftCabWidth: 1.1, // 1100 mm
  minLiftCabDepth: 1.4, // 1400 mm
  minReachHeightMinorUnit: 400, // 400 mm
  maxReachHeightMinorUnit: 1200, // 1200 mm
};

/**
 * Returns the catalog of jurisdiction-aware Accessibility Review Profiles converted to `unit`.
 */
export function getAccessibilityRuleProfiles(
  unit: MeasurementUnit,
  buildingOccupancyType: BuildingOccupancyAccessibilityType = 'residential-private',
  constructionScope: ConstructionAccessibilityScope = 'new-construction',
  customOverrides?: Partial<AccessibilityProfileThresholds>
): Record<AccessibilityRuleProfileId, AccessibilityRuleProfile> {
  const baseScreeningThresholds =
    unit === 'metres'
      ? convertProfileThresholds(CANONICAL_ISO_METRE_THRESHOLDS, 'metres')
      : convertProfileThresholds(CANONICAL_FEET_THRESHOLDS, 'feet');

  const adaThresholds = convertProfileThresholds(CANONICAL_FEET_THRESHOLDS, unit);
  const isoThresholds = convertProfileThresholds(CANONICAL_ISO_METRE_THRESHOLDS, unit);

  const customMerged: AccessibilityProfileThresholds = {
    ...baseScreeningThresholds,
    ...(customOverrides || {}),
    unit,
  };

  return {
    'general-screening-configurable': {
      profileId: 'general-screening-configurable',
      name: 'General Accessibility Screening (Configurable Non-Statutory)',
      jurisdiction: 'Non-Jurisdictional (General Architectural Screening)',
      standardName: 'Plotify Configurable Accessibility Planning Thresholds',
      editionOrVersion: 'P34 v1.0 Screening Baseline',
      sourceUrlOrCitation: 'Internal configurable design-assistance baseline (non-statutory)',
      authorityClassification: 'general-screening-only',
      buildingOccupancyType,
      constructionScope,
      thresholds: baseScreeningThresholds,
      applicabilityNotes:
        'Used when a specific legal jurisdiction or statutory code edition has not been selected. Evaluates geometric clearances against transparent planning thresholds.',
      statutoryDisclaimer:
        'General accessibility screening is a design-assistance check and does NOT constitute statutory code compliance or certification by an Authority Having Jurisdiction (AHJ) or licensed accessibility specialist.',
    },
    'us-ada-2010-standards': {
      profileId: 'us-ada-2010-standards',
      name: 'U.S. 2010 ADA Standards for Accessible Design (Reference Profile)',
      jurisdiction: 'United States (Federal DOJ / DOT)',
      standardName: '2010 ADA Standards for Accessible Design',
      editionOrVersion: '2010 Edition (36 CFR Part 1191, Chapters 3–6)',
      sourceUrlOrCitation: 'https://www.ada.gov/law-and-regs/design-standards/2010-stds/',
      authorityClassification: 'statutory-standard',
      buildingOccupancyType,
      constructionScope,
      thresholds: adaThresholds,
      applicabilityNotes:
        'Applies technical criteria from Chapters 3, 4, and 6 of the U.S. 2010 ADA Standards (60 in turning space §304.3.1, 30×48 in clear floor space §305.3, 32 in min clear door width §404.2.3, 36 in min accessible route width §403.5.1, 1:12 max ramp slope §405.2). Note: Private single-family residences are generally exempt from Title III unless used as a place of public accommodation or required by project brief.',
      statutoryDisclaimer:
        'Automated geometric evaluation checks modeled dimensions against cited 2010 ADA Standards thresholds. Unmodeled elements (hardware operating force, surface slip resistance, braille dome spacing, local state/municipal amendments) require human review by a certified accessibility professional.',
    },
    'iso-21542-2021-reference': {
      profileId: 'iso-21542-2021-reference',
      name: 'ISO 21542:2021 Accessibility & Usability of the Built Environment',
      jurisdiction: 'International Standard (ISO Reference)',
      standardName: 'ISO 21542:2021 Building construction — Accessibility and usability of the built environment',
      editionOrVersion: '2021 Second Edition (Clauses 7–26)',
      sourceUrlOrCitation: 'https://www.iso.org/standard/71860.html',
      authorityClassification: 'international-reference',
      buildingOccupancyType,
      constructionScope,
      thresholds: isoThresholds,
      applicabilityNotes:
        'Applies international metric reference criteria from ISO 21542:2021 (1500 mm turning circle, 800×1300 mm wheelchair clear floor space, 850 mm min clear door opening width, 900 mm min corridor/route clear width, 1:12 max ramp gradient).',
      statutoryDisclaimer:
        'ISO 21542:2021 is an international reference standard. Local statutory adoption varies by country, occupancy classification, and Authority Having Jurisdiction (AHJ).',
    },
    'custom-project-profile': {
      profileId: 'custom-project-profile',
      name: 'Custom Project Accessibility Threshold Profile',
      jurisdiction: 'User-Configured Project Criteria',
      standardName: 'User-Defined Project Accessibility Thresholds',
      editionOrVersion: 'Custom Project Configuration',
      sourceUrlOrCitation: 'User-specified project accessibility parameters',
      authorityClassification: 'user-configured',
      buildingOccupancyType,
      constructionScope,
      thresholds: customMerged,
      applicabilityNotes:
        'Evaluates project spaces against user-customized dimensional thresholds. Useful for bespoke client mobility requirements or local code overlays.',
      statutoryDisclaimer:
        'Custom user-configured thresholds reflect project-specific parameters and do not represent official statutory certification.',
    },
  };
}

/**
 * Ensures a project has a valid `ProjectAccessibilityReviewData` structure without mutating the input project.
 */
export function ensureProjectAccessibilityReviewData(
  project: Project
): ProjectAccessibilityReviewData {
  if (project.accessibilityReview) {
    return {
      activeProfileId: project.accessibilityReview.activeProfileId || 'general-screening-configurable',
      buildingOccupancyType:
        project.accessibilityReview.buildingOccupancyType ||
        (project.projectType === 'apartment' ? 'multi-family-common' : 'residential-private'),
      constructionScope: project.accessibilityReview.constructionScope || 'new-construction',
      customThresholds: project.accessibilityReview.customThresholds
        ? { ...project.accessibilityReview.customThresholds }
        : undefined,
      elements: {
        doorDetails: { ...(project.accessibilityReview.elements?.doorDetails || {}) },
        ramps: [...(project.accessibilityReview.elements?.ramps || [])],
        stairs: [...(project.accessibilityReview.elements?.stairs || [])],
        verticalLifts: [...(project.accessibilityReview.elements?.verticalLifts || [])],
        fixtureDetails: [...(project.accessibilityReview.elements?.fixtureDetails || [])],
        operableControls: [...(project.accessibilityReview.elements?.operableControls || [])],
        sensoryAndWayfinding: [...(project.accessibilityReview.elements?.sensoryAndWayfinding || [])],
      },
      lastEvaluatedAt: project.accessibilityReview.lastEvaluatedAt,
      lastSourceFingerprint: project.accessibilityReview.lastSourceFingerprint,
      lastPreApplySnapshotId: project.accessibilityReview.lastPreApplySnapshotId,
      requestSequenceId: project.accessibilityReview.requestSequenceId || 1,
    };
  }

  let defaultProfile: AccessibilityRuleProfileId = 'general-screening-configurable';
  const regCountry = project.regulations?.profile?.country?.toLowerCase() || '';
  if (regCountry.includes('united states') || regCountry === 'us' || regCountry === 'usa') {
    defaultProfile = 'us-ada-2010-standards';
  }

  return {
    activeProfileId: defaultProfile,
    buildingOccupancyType:
      project.projectType === 'apartment' ? 'multi-family-common' : 'residential-private',
    constructionScope: 'new-construction',
    elements: {
      doorDetails: {},
      ramps: [],
      stairs: [],
      verticalLifts: [],
      fixtureDetails: [],
      operableControls: [],
      sensoryAndWayfinding: [],
    },
    requestSequenceId: 1,
  };
}

/**
 * Computes a deterministic source fingerprint over all inputs that affect P34 evaluation.
 */
export function computeAccessibilitySourceFingerprint(project: Project): string {
  const reviewData = ensureProjectAccessibilityReviewData(project);
  const furnitureData = ensureProjectFurnitureLayoutData(project);
  const rooms = (project.floorPlan?.rooms || []).map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    x: round2(r.x),
    y: round2(r.y),
    w: round2(r.width),
    l: round2(r.length),
    fl: r.floorLevel,
  }));

  const payload = {
    unit: project.unit,
    floors: project.floors,
    rooms,
    profileId: reviewData.activeProfileId,
    occupancy: reviewData.buildingOccupancyType,
    scope: reviewData.constructionScope,
    customThresholds: reviewData.customThresholds || null,
    elements: reviewData.elements,
    furnitureInstances: furnitureData.instances.map((i) => ({
      id: i.instanceId,
      tpl: i.templateId,
      rm: i.roomId,
      fl: i.floorLevel,
      x: round2(i.x),
      y: round2(i.y),
      w: round2(i.width),
      d: round2(i.depth),
      rot: i.rotationDeg,
    })),
    openings: furnitureData.knownOpenings.map((o) => ({
      id: o.openingId,
      rm: o.roomId,
      fl: o.floorLevel,
      edge: o.wallEdge,
      off: round2(o.offsetAlongWall),
      w: round2(o.width),
      sw: o.swingDirection,
    })),
    briefMandatory: Boolean(project.brief?.constraints?.accessibilityMandatory),
    briefSpaces: (project.brief?.spaces || []).map((s) => ({
      id: s.id,
      name: s.name,
      wc: Boolean(s.wheelchairAccessible),
    })),
  };

  const raw = JSON.stringify(payload);
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `p34-fp-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Strict interior rectangle overlap check (touching edges within 1e-4 tolerance are allowed).
 */
function rectsOverlapStrict(a: AABBRect, b: AABBRect, eps = 1e-4): boolean {
  return (
    a.x < b.x + b.width - eps &&
    a.x + a.width > b.x + eps &&
    a.y < b.y + b.length - eps &&
    a.y + a.length > b.y + eps
  );
}

function isRectInsideRoom(rect: AABBRect, roomRect: AABBRect, eps = 1e-4): boolean {
  return (
    rect.x >= roomRect.x - eps &&
    rect.y >= roomRect.y - eps &&
    rect.x + rect.width <= roomRect.x + roomRect.width + eps &&
    rect.y + rect.length <= roomRect.y + roomRect.length + eps
  );
}

/**
 * Checks if a circle of center (cx, cy) and diameter D lies completely inside `roomRect`
 * and does not intersect any rectangle in `obstacles`.
 */
export function isCircleUnobstructedInRoom(
  cx: number,
  cy: number,
  diameter: number,
  roomRect: AABBRect,
  obstacles: AABBRect[],
  eps = 1e-4
): boolean {
  const r = diameter / 2;
  if (
    cx - r < roomRect.x - eps ||
    cx + r > roomRect.x + roomRect.width + eps ||
    cy - r < roomRect.y - eps ||
    cy + r > roomRect.y + roomRect.length + eps
  ) {
    return false;
  }
  const rEffective = Math.max(0, r - eps);
  const rSq = rEffective * rEffective;
  for (const obs of obstacles) {
    const closestX = Math.max(obs.x, Math.min(cx, obs.x + obs.width));
    const closestY = Math.max(obs.y, Math.min(cy, obs.y + obs.length));
    const dx = cx - closestX;
    const dy = cy - closestY;
    if (dx * dx + dy * dy < rSq) {
      return false;
    }
  }
  return true;
}

/**
 * Exact continuous 2D search for the maximum unobstructed inscribed circle (and square)
 * inside a room after subtracting all solid furniture footprints, fixed obstacles, and
 * inward-swinging door arcs.
 */
export function findMaxInscribedTurningCircle(
  room: FloorPlanRoom,
  obstacles: AABBRect[],
  targetDiameter: number
): {
  maxDiameter: number;
  meetsTarget: boolean;
  bestCenter: { cx: number; cy: number };
} {
  const roomRect = getRoomBoundsRect(room);
  const maxPossible = Math.min(room.width, room.length);

  if (maxPossible <= 0) {
    return {
      maxDiameter: 0,
      meetsTarget: false,
      bestCenter: { cx: room.x + room.width / 2, cy: room.y + room.length / 2 },
    };
  }

  const xAnchorsSet = new Set<number>([roomRect.x]);
  const yAnchorsSet = new Set<number>([roomRect.y]);

  for (const obs of obstacles) {
    if (obs.x + obs.width > roomRect.x && obs.x + obs.width < roomRect.x + roomRect.width) {
      xAnchorsSet.add(obs.x + obs.width);
    }
    if (obs.x > roomRect.x && obs.x < roomRect.x + roomRect.width) {
      xAnchorsSet.add(obs.x);
    }
    if (obs.y + obs.length > roomRect.y && obs.y + obs.length < roomRect.y + roomRect.length) {
      yAnchorsSet.add(obs.y + obs.length);
    }
    if (obs.y > roomRect.y && obs.y < roomRect.y + roomRect.length) {
      yAnchorsSet.add(obs.y);
    }
  }

  const xAnchors = Array.from(xAnchorsSet).sort((a, b) => a - b);
  const yAnchors = Array.from(yAnchorsSet).sort((a, b) => a - b);

  const findCenterForDiameter = (D: number): { cx: number; cy: number } | null => {
    if (D > maxPossible + 1e-4) return null;
    const r = D / 2;

    const candidateCx = new Set<number>([
      roomRect.x + r,
      roomRect.x + roomRect.width - r,
      roomRect.x + roomRect.width / 2,
    ]);
    const candidateCy = new Set<number>([
      roomRect.y + r,
      roomRect.y + roomRect.length - r,
      roomRect.y + roomRect.length / 2,
    ]);

    for (const xa of xAnchors) {
      candidateCx.add(xa + r);
      candidateCx.add(xa - r);
    }
    for (const ya of yAnchors) {
      candidateCy.add(ya + r);
      candidateCy.add(ya - r);
    }

    for (const cx of candidateCx) {
      for (const cy of candidateCy) {
        if (isCircleUnobstructedInRoom(cx, cy, D, roomRect, obstacles)) {
          return { cx: round2(cx), cy: round2(cy) };
        }
      }
    }
    return null;
  };

  const targetFit = findCenterForDiameter(targetDiameter);

  let low = targetFit ? targetDiameter : 0;
  let high = maxPossible;
  let bestCenter = targetFit || {
    cx: round2(roomRect.x + roomRect.width / 2),
    cy: round2(roomRect.y + roomRect.length / 2),
  };
  let bestD = targetFit ? targetDiameter : 0;

  for (let iter = 0; iter < 18; iter++) {
    const mid = (low + high) / 2;
    const center = findCenterForDiameter(mid);
    if (center) {
      bestD = mid;
      bestCenter = center;
      low = mid;
    } else {
      high = mid;
    }
  }

  return {
    maxDiameter: round2(bestD),
    meetsTarget: Boolean(targetFit) || bestD >= targetDiameter - 1e-3,
    bestCenter,
  };
}

/**
 * Checks whether a T-shaped wheelchair turning space (total span L × L with arm width W)
 * fits unobstructed inside the room in any of the 4 cardinal orientations.
 */
export function checkTTurnSpaceInRoom(
  room: FloorPlanRoom,
  obstacles: AABBRect[],
  totalSpan: number,
  armWidth: number
): boolean {
  const roomRect = getRoomBoundsRect(room);
  if (room.width < totalSpan - 1e-4 || room.length < totalSpan - 1e-4) {
    return false;
  }

  const xCandidates = new Set<number>([roomRect.x, roomRect.x + roomRect.width - totalSpan]);
  const yCandidates = new Set<number>([roomRect.y, roomRect.y + roomRect.length - totalSpan]);
  for (const obs of obstacles) {
    xCandidates.add(obs.x + obs.width);
    xCandidates.add(obs.x - totalSpan);
    yCandidates.add(obs.y + obs.length);
    yCandidates.add(obs.y - totalSpan);
  }

  const stemOffset = (totalSpan - armWidth) / 2;

  for (const bx of xCandidates) {
    for (const by of yCandidates) {
      const outerBox: AABBRect = { x: bx, y: by, width: totalSpan, length: totalSpan };
      if (!isRectInsideRoom(outerBox, roomRect)) continue;

      const orientations: Array<[AABBRect, AABBRect]> = [
        [
          { x: bx, y: by, width: totalSpan, length: armWidth },
          { x: bx + stemOffset, y: by, width: armWidth, length: totalSpan },
        ],
        [
          { x: bx, y: by + totalSpan - armWidth, width: totalSpan, length: armWidth },
          { x: bx + stemOffset, y: by, width: armWidth, length: totalSpan },
        ],
        [
          { x: bx, y: by, width: armWidth, length: totalSpan },
          { x: bx, y: by + stemOffset, width: totalSpan, length: armWidth },
        ],
        [
          { x: bx + totalSpan - armWidth, y: by, width: armWidth, length: totalSpan },
          { x: bx, y: by + stemOffset, width: totalSpan, length: armWidth },
        ],
      ];

      for (const [arm1, arm2] of orientations) {
        const blocked = obstacles.some(
          (obs) => rectsOverlapStrict(arm1, obs) || rectsOverlapStrict(arm2, obs)
        );
        if (!blocked) return true;
      }
    }
  }
  return false;
}

/**
 * Checks if a stationary clear floor space (e.g., 30 in × 48 in / 2.5 ft × 4.0 ft)
 * is unobstructed inside the room.
 */
export function checkClearFloorSpaceForRect(
  room: FloorPlanRoom,
  requiredRect: AABBRect,
  obstacles: AABBRect[]
): {
  isInsideRoom: boolean;
  isObstacleFree: boolean;
  blockingObstacleCount: number;
} {
  const roomRect = getRoomBoundsRect(room);
  const inside = isRectInsideRoom(requiredRect, roomRect);
  let blockingCount = 0;
  for (const obs of obstacles) {
    if (rectsOverlapStrict(requiredRect, obs)) {
      blockingCount++;
    }
  }
  return {
    isInsideRoom: inside,
    isObstacleFree: inside && blockingCount === 0,
    blockingObstacleCount: blockingCount,
  };
}

/**
 * Inspects P30 Brief and P32 Personalization context to extract mandatory accessibility
 * requirements, confirmed vs unconfirmed assumptions, and verify that P32 soft preferences
 * never override mandatory accessibility constraints.
 */
export function inspectP30P32AccessibilityContext(
  project: Project,
  roomStatusMap: Map<string, AccessibilityResultStatus>
): P30P32AccessibilityAlignmentReport {
  const brief = project.brief;
  const hasMandatoryBriefAccessibilityFlag = Boolean(brief?.constraints?.accessibilityMandatory);
  const briefAccessibilityNotes = brief?.occupancy?.accessibilityNotes || '';

  const rooms = project.floorPlan?.rooms || [];
  const briefSpacesRequiringWheelchairAccess: P30P32AccessibilityAlignmentReport['briefSpacesRequiringWheelchairAccess'] =
    [];

  for (const space of brief?.spaces || []) {
    if (space.wheelchairAccessible || hasMandatoryBriefAccessibilityFlag) {
      const matchedRoom = rooms.find(
        (r) =>
          r.name.toLowerCase() === space.name.toLowerCase() ||
          r.type.toLowerCase() === space.category.toLowerCase() ||
          (space.category === 'hygiene' && r.type.toLowerCase() === 'bathroom')
      );
      const status: AccessibilityResultStatus = matchedRoom
        ? roomStatusMap.get(matchedRoom.id) || 'unassessed'
        : 'insufficient-data';
      briefSpacesRequiringWheelchairAccess.push({
        spaceId: space.id,
        spaceName: space.name,
        matchedRoomId: matchedRoom?.id,
        matchedRoomName: matchedRoom?.name,
        roomAccessibilityStatus: status,
      });
    }
  }

  const confirmedInterpretedAccessibilityRequirements: P30P32AccessibilityAlignmentReport['confirmedInterpretedAccessibilityRequirements'] =
    [];
  const unconfirmedAccessibilityAssumptions: P30P32AccessibilityAlignmentReport['unconfirmedAccessibilityAssumptions'] =
    [];

  if (brief?.interpretedBrief) {
    for (const req of brief.interpretedBrief.requirements || []) {
      const reqText = req.description || '';
      const isAcc =
        req.category === 'accessibility' ||
        reqText.toLowerCase().includes('wheelchair') ||
        reqText.toLowerCase().includes('accessible') ||
        reqText.toLowerCase().includes('ada') ||
        reqText.toLowerCase().includes('step-free');
      if (!isAcc) continue;

      if (req.reviewStatus === 'confirmed' || req.source === 'explicit') {
        confirmedInterpretedAccessibilityRequirements.push({
          requirementId: req.id,
          text: reqText,
          source: req.source,
        });
      } else if (req.reviewStatus === 'needs-review') {
        unconfirmedAccessibilityAssumptions.push({
          assumptionId: req.id,
          text: reqText,
          status: req.reviewStatus,
        });
      }
    }

    for (const assump of brief.interpretedBrief.assumptions || []) {
      const assumpText = assump.description || '';
      const isAcc =
        assump.category === 'accessibility' ||
        assumpText.toLowerCase().includes('wheelchair') ||
        assumpText.toLowerCase().includes('accessible') ||
        assumpText.toLowerCase().includes('mobility');
      if (isAcc && assump.status !== 'confirmed') {
        unconfirmedAccessibilityAssumptions.push({
          assumptionId: assump.id,
          text: assumpText,
          status: assump.status,
        });
      }
    }
  }

  const softPreferencesInspected = project.designPersonalization?.items?.length || 0;

  return {
    hasMandatoryBriefAccessibilityFlag,
    briefAccessibilityNotes,
    briefSpacesRequiringWheelchairAccess,
    confirmedInterpretedAccessibilityRequirements,
    unconfirmedAccessibilityAssumptions,
    p32SoftPreferenceGuardrailCheck: {
      softPreferencesInspected,
      mandatoryCriteriaOverriddenByPreferences: 0,
      guardrailExplanation:
        'Enforced P34 Guardrail: Soft style, finish, or spatial preferences from P32 Adaptive Design Personalization are strictly isolated from P34 mandatory accessibility criteria and cannot suppress or override any accessibility failure.',
    },
  };
}

/**
 * Core deterministic P34 Universal Accessibility Review evaluation engine.
 */
export function evaluateUniversalAccessibility(
  project: Project
): UniversalAccessibilityEvaluationReport {
  const unit = project.unit;
  const reviewData = ensureProjectAccessibilityReviewData(project);
  const profiles = getAccessibilityRuleProfiles(
    unit,
    reviewData.buildingOccupancyType,
    reviewData.constructionScope,
    reviewData.customThresholds
  );
  const activeProfile =
    profiles[reviewData.activeProfileId] || profiles['general-screening-configurable'];
  const thresholds = activeProfile.thresholds;

  const currentFingerprint = computeAccessibilitySourceFingerprint(project);
  const isStale = Boolean(
    reviewData.lastSourceFingerprint &&
      reviewData.lastSourceFingerprint !== currentFingerprint
  );
  const staleReasons: string[] = [];
  if (isStale) {
    staleReasons.push(
      'Project geometry, furniture placement, door openings, or accessibility profile changed since the last saved review.'
    );
  }

  const furnitureData = ensureProjectFurnitureLayoutData(project);
  const templates = getAllCatalogTemplates(project);
  const p33Report = evaluateFurnitureIntelligence({ project });
  const fixedObstacles = extractKnownFixedRoomObstacles(project);
  const rooms = project.floorPlan?.rooms || [];

  const hasMandatoryBriefFlag = Boolean(project.brief?.constraints?.accessibilityMandatory);
  const briefSpaces = project.brief?.spaces || [];

  const allCriterionResults: AccessibilityCriterionResult[] = [];
  const geometricOverlays: AccessibilityGeometricOverlayItem[] = [];
  const roomDiagnostics: RoomAccessibilityDiagnostic[] = [];
  const roomStatusMap = new Map<string, AccessibilityResultStatus>();

  // 1. Evaluate each room for Turning Space, Clear Floor Space, Doors/Openings, and Route Connection
  for (const room of rooms) {
    const matchingBriefSpace = briefSpaces.find(
      (s) =>
        s.name.toLowerCase() === room.name.toLowerCase() ||
        s.category.toLowerCase() === room.type.toLowerCase() ||
        (s.category === 'hygiene' && room.type.toLowerCase() === 'bathroom')
    );
    const isRoomMandatoryAccessible =
      hasMandatoryBriefFlag || Boolean(matchingBriefSpace?.wheelchairAccessible);

    const roomCriteria: AccessibilityCriterionResult[] = [];

    const roomInstances = furnitureData.instances.filter(
      (inst) => inst.roomId === room.id && inst.floorLevel === room.floorLevel
    );
    const roomOpenings = furnitureData.knownOpenings.filter(
      (op) => op.roomId === room.id && op.floorLevel === room.floorLevel
    );
    const roomFixedObs = fixedObstacles.filter((fo) => fo.floorLevel === room.floorLevel);

    const solidObstacleBoxes: AABBRect[] = [];
    for (const inst of roomInstances) {
      solidObstacleBoxes.push(getInstanceFootprintRect(inst, unit));
    }
    for (const fo of roomFixedObs) {
      solidObstacleBoxes.push({
        x: fo.x,
        y: fo.y,
        width: fo.width,
        length: fo.depth,
      });
    }
    for (const op of roomOpenings) {
      const opZones = getKnownOpeningZones(room, op, furnitureData.clearanceThresholds);
      if (opZones.swingZone) {
        solidObstacleBoxes.push(opZones.swingZone);
      }
    }

    // 1A. Wheelchair Turning Space (Circular & T-Shaped)
    const turningResult = findMaxInscribedTurningCircle(
      room,
      solidObstacleBoxes,
      thresholds.turningCircleDiameter
    );
    const tTurnAvailable = checkTTurnSpaceInRoom(
      room,
      solidObstacleBoxes,
      thresholds.tTurnTotalSpan,
      thresholds.tTurnArmWidth
    );

    let turningStatus: AccessibilityResultStatus;
    let turningExplanation: string;
    let turningRemediation: string | undefined;

    if (turningResult.meetsTarget) {
      turningStatus = 'meets-configured-criterion';
      turningExplanation = `Room "${room.name}" provides an unobstructed circular wheelchair turning space of ${formatMeasure(
        turningResult.maxDiameter,
        unit
      )} diameter (required >= ${formatMeasure(thresholds.turningCircleDiameter, unit)}).`;
    } else if (tTurnAvailable) {
      turningStatus = 'warning';
      turningExplanation = `Room "${room.name}" max unobstructed circular turning diameter is ${formatMeasure(
        turningResult.maxDiameter,
        unit
      )} (below ${formatMeasure(
        thresholds.turningCircleDiameter,
        unit
      )} circle), but an unobstructed T-shaped turning space (${formatMeasure(
        thresholds.tTurnTotalSpan,
        unit
      )} span × ${formatMeasure(thresholds.tTurnArmWidth, unit)} arms) is available.`;
      turningRemediation = `Verify whether a T-shaped turning space is acceptable under ${activeProfile.standardName} or clear ${formatMeasure(
        thresholds.turningCircleDiameter - turningResult.maxDiameter,
        unit
      )} of additional floor width.`;
    } else {
      turningStatus = 'does-not-meet-configured-criterion';
      const emptyMax = Math.min(room.width, room.length);
      if (emptyMax < thresholds.turningCircleDiameter - 1e-3) {
        turningExplanation = `Room "${room.name}" structural dimensions (${formatMeasure(
          room.width,
          unit
        )} × ${formatMeasure(
          room.length,
          unit
        )}) are narrower than the required ${formatMeasure(
          thresholds.turningCircleDiameter,
          unit
        )} turning diameter even when empty.`;
        turningRemediation = `Widen room "${room.name}" in the 2D Floor Plan Editor so both width and length are at least ${formatMeasure(
          thresholds.turningCircleDiameter,
          unit
        )}.`;
      } else {
        turningExplanation = `Placed furniture, inward door swings, or fixed obstacles reduce the maximum unobstructed turning circle in "${room.name}" to ${formatMeasure(
          turningResult.maxDiameter,
          unit
        )} (required >= ${formatMeasure(thresholds.turningCircleDiameter, unit)}).`;
        turningRemediation = `Reposition or remove obstructing furniture or reverse inward-swinging doors in "${room.name}" to restore a ${formatMeasure(
          thresholds.turningCircleDiameter,
          unit
        )} clear turning circle.`;
      }
    }

    const turningOverlay: AccessibilityGeometricOverlayItem = {
      overlayId: `ov-turn-${room.id}`,
      floorLevel: room.floorLevel,
      roomId: room.id,
      kind: 'turning-circle',
      status: turningStatus,
      label: `${room.name} Turning Circle`,
      circle: {
        cx: turningResult.bestCenter.cx,
        cy: turningResult.bestCenter.cy,
        diameter: Math.max(
          unit === 'feet' ? 1.5 : 0.45,
          Math.min(turningResult.maxDiameter, thresholds.turningCircleDiameter)
        ),
      },
      measuredDisplay: formatMeasure(turningResult.maxDiameter, unit),
      requiredDisplay: formatMeasure(thresholds.turningCircleDiameter, unit),
    };
    geometricOverlays.push(turningOverlay);

    const turningCriterion: AccessibilityCriterionResult = {
      criterionId: `crit-turn-${room.id}`,
      topicId: 'mobility-turning-and-clear-floor',
      title: `Wheelchair Turning Space — ${room.name}`,
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §304.3 (Turning Space)'
          : activeProfile.profileId === 'iso-21542-2021-reference'
          ? 'ISO 21542:2021 Clause 7.2 (1500 mm Turning Space)'
          : 'Configurable Turning Space Threshold',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'room',
      targetId: room.id,
      targetName: room.name,
      floorLevel: room.floorLevel,
      status: turningStatus,
      isMandatoryFromBrief: isRoomMandatoryAccessible,
      measuredValue: turningResult.maxDiameter,
      requiredValue: thresholds.turningCircleDiameter,
      unit: unit === 'feet' ? 'ft' : 'm',
      inputProvenance:
        roomInstances.length > 0
          ? ['measured-project-geometry', 'imported-p33-furniture-layout']
          : ['measured-project-geometry'],
      explanation: turningExplanation,
      remediationGuidance: turningRemediation,
      geometricOverlay: turningOverlay,
    };
    roomCriteria.push(turningCriterion);
    allCriterionResults.push(turningCriterion);

    // 1B. Clear Floor Space (30 in × 48 in / 800 mm × 1300 mm) at placed fixtures/furniture
    let cfsEvaluated = 0;
    let cfsPassing = 0;
    let cfsFailing = 0;

    if (roomInstances.length === 0) {
      const defaultCfsRect: AABBRect = {
        x: room.x,
        y: room.y,
        width: thresholds.clearFloorSpaceWidth,
        length: thresholds.clearFloorSpaceLength,
      };
      const altCfsRect: AABBRect = {
        x: room.x,
        y: room.y,
        width: thresholds.clearFloorSpaceLength,
        length: thresholds.clearFloorSpaceWidth,
      };
      const fitsEmpty =
        checkClearFloorSpaceForRect(room, defaultCfsRect, solidObstacleBoxes).isObstacleFree ||
        checkClearFloorSpaceForRect(room, altCfsRect, solidObstacleBoxes).isObstacleFree;

      cfsEvaluated = 1;
      if (fitsEmpty) {
        cfsPassing = 1;
      } else {
        cfsFailing = 1;
      }

      const cfsCrit: AccessibilityCriterionResult = {
        criterionId: `crit-cfs-room-${room.id}`,
        topicId: 'mobility-turning-and-clear-floor',
        title: `Stationary Wheelchair Clear Floor Space — ${room.name}`,
        clauseOrRuleReference:
          activeProfile.profileId === 'us-ada-2010-standards'
            ? '2010 ADA Standards §305.3 (30 in × 48 in Clear Floor Space)'
            : activeProfile.profileId === 'iso-21542-2021-reference'
            ? 'ISO 21542:2021 Clause 7.1 (800 mm × 1300 mm Clear Floor Space)'
            : 'Clear Floor Space Envelope',
        ruleProfileId: activeProfile.profileId,
        targetScope: 'room',
        targetId: room.id,
        targetName: room.name,
        floorLevel: room.floorLevel,
        status: fitsEmpty ? 'meets-configured-criterion' : 'does-not-meet-configured-criterion',
        isMandatoryFromBrief: isRoomMandatoryAccessible,
        measuredValue: `${round2(Math.min(room.width, room.length))} × ${round2(
          Math.max(room.width, room.length)
        )}`,
        requiredValue: `${thresholds.clearFloorSpaceWidth} × ${thresholds.clearFloorSpaceLength}`,
        unit: unit === 'feet' ? 'ft' : 'm',
        inputProvenance: ['measured-project-geometry'],
        explanation: fitsEmpty
          ? `Room "${room.name}" accommodates a ${formatMeasure(
              thresholds.clearFloorSpaceWidth,
              unit
            )} × ${formatMeasure(
              thresholds.clearFloorSpaceLength,
              unit
            )} stationary wheelchair clear floor space. (No furniture/fixtures placed yet to test fixture-specific approach).`
          : `Room "${room.name}" cannot accommodate a ${formatMeasure(
              thresholds.clearFloorSpaceWidth,
              unit
            )} × ${formatMeasure(thresholds.clearFloorSpaceLength, unit)} clear floor space.`,
      };
      roomCriteria.push(cfsCrit);
      allCriterionResults.push(cfsCrit);
    } else {
      for (const inst of roomInstances) {
        cfsEvaluated++;
        const frontRect = getInstanceFrontClearanceRect(
          inst,
          furnitureData.clearanceThresholds,
          templates,
          unit
        );
        const foot = getInstanceFootprintRect(inst, unit);
        const normRot = ((inst.rotationDeg % 360) + 360) % 360;

        const reqW =
          normRot === 0 || normRot === 180
            ? Math.max(frontRect.width, thresholds.clearFloorSpaceWidth)
            : Math.max(frontRect.width, thresholds.clearFloorSpaceLength);
        const reqL =
          normRot === 0 || normRot === 180
            ? Math.max(frontRect.length, thresholds.clearFloorSpaceLength)
            : Math.max(frontRect.length, thresholds.clearFloorSpaceWidth);

        let approachBox: AABBRect;
        if (normRot === 0) {
          approachBox = {
            x: foot.x + (foot.width - reqW) / 2,
            y: foot.y + foot.length,
            width: reqW,
            length: Math.min(reqL, thresholds.clearFloorSpaceWidth),
          };
        } else if (normRot === 180) {
          const depthNeeded = Math.min(reqL, thresholds.clearFloorSpaceWidth);
          approachBox = {
            x: foot.x + (foot.width - reqW) / 2,
            y: foot.y - depthNeeded,
            width: reqW,
            length: depthNeeded,
          };
        } else if (normRot === 90) {
          const widthNeeded = Math.min(reqW, thresholds.clearFloorSpaceWidth);
          approachBox = {
            x: foot.x - widthNeeded,
            y: foot.y + (foot.length - reqL) / 2,
            width: widthNeeded,
            length: reqL,
          };
        } else {
          const widthNeeded = Math.min(reqW, thresholds.clearFloorSpaceWidth);
          approachBox = {
            x: foot.x + foot.width,
            y: foot.y + (foot.length - reqL) / 2,
            width: widthNeeded,
            length: reqL,
          };
        }

        const otherObstacles = solidObstacleBoxes.filter(
          (b) =>
            Math.abs(b.x - foot.x) > 1e-3 ||
            Math.abs(b.y - foot.y) > 1e-3 ||
            Math.abs(b.width - foot.width) > 1e-3 ||
            Math.abs(b.length - foot.length) > 1e-3
        );

        const frontCheck = checkClearFloorSpaceForRect(room, frontRect, otherObstacles);
        const approachCheck = checkClearFloorSpaceForRect(room, approachBox, otherObstacles);
        const passes = frontCheck.isObstacleFree && approachCheck.isObstacleFree;

        if (passes) {
          cfsPassing++;
        } else {
          cfsFailing++;
        }

        const cfsOverlay: AccessibilityGeometricOverlayItem = {
          overlayId: `ov-cfs-${inst.instanceId}`,
          floorLevel: room.floorLevel,
          roomId: room.id,
          kind: 'clear-floor-space',
          status: passes ? 'meets-configured-criterion' : 'does-not-meet-configured-criterion',
          label: `${inst.name} Approach Space`,
          rect: frontRect,
          measuredDisplay: passes ? 'Unobstructed' : 'Obstructed / Out of Bounds',
          requiredDisplay: `${formatMeasure(thresholds.clearFloorSpaceWidth, unit)} × ${formatMeasure(
            thresholds.clearFloorSpaceLength,
            unit
          )}`,
        };
        geometricOverlays.push(cfsOverlay);

        const cfsCrit: AccessibilityCriterionResult = {
          criterionId: `crit-cfs-${inst.instanceId}`,
          topicId: 'mobility-turning-and-clear-floor',
          title: `Fixture / Furniture Approach Clearance — ${inst.name} (${room.name})`,
          clauseOrRuleReference:
            activeProfile.profileId === 'us-ada-2010-standards'
              ? '2010 ADA Standards §305.3 & §305.5 (Clear Floor Space & Approach)'
              : 'Clear Floor & Functional Approach Space',
          ruleProfileId: activeProfile.profileId,
          targetScope: 'fixture',
          targetId: inst.instanceId,
          targetName: `${inst.name} in ${room.name}`,
          floorLevel: room.floorLevel,
          status: passes ? 'meets-configured-criterion' : 'does-not-meet-configured-criterion',
          isMandatoryFromBrief: isRoomMandatoryAccessible,
          measuredValue: passes ? 'Clear' : 'Blocked',
          requiredValue: `${formatMeasure(frontRect.width, unit)} × ${formatMeasure(
            frontRect.length,
            unit
          )}`,
          unit: unit === 'feet' ? 'ft' : 'm',
          inputProvenance: ['measured-project-geometry', 'imported-p33-furniture-layout'],
          explanation: passes
            ? `Front approach and clear floor zone for "${inst.name}" in "${room.name}" lies completely within room boundaries and is free of solid obstacles.`
            : !frontCheck.isInsideRoom
            ? `Front approach zone for "${inst.name}" extends outside the walls of "${room.name}".`
            : `Front approach zone for "${inst.name}" is obstructed by another placed furniture item, structural column, or inward door swing.`,
          remediationGuidance: passes
            ? undefined
            : `Rotate or reposition "${inst.name}" in "${room.name}" so its front approach clearance rectangle stays inside room walls and clear of obstacles.`,
          geometricOverlay: cfsOverlay,
        };
        roomCriteria.push(cfsCrit);
        allCriterionResults.push(cfsCrit);
      }
    }

    // 1C. Doors & Openings Accessibility in Room
    let doorsEvaluated = 0;
    let doorsPassing = 0;
    let doorsFailing = 0;
    let doorsInsufficientData = 0;

    if (roomOpenings.length === 0) {
      doorsInsufficientData = 1;
      const missingDoorCrit: AccessibilityCriterionResult = {
        criterionId: `crit-door-missing-${room.id}`,
        topicId: 'doors-and-thresholds',
        title: `Doorway Clear Width & Maneuvering Clearance — ${room.name}`,
        clauseOrRuleReference:
          activeProfile.profileId === 'us-ada-2010-standards'
            ? '2010 ADA Standards §404.2.3 & §404.2.4'
            : 'Doorway Clear Opening & Maneuvering Criteria',
        ruleProfileId: activeProfile.profileId,
        targetScope: 'room',
        targetId: room.id,
        targetName: room.name,
        floorLevel: room.floorLevel,
        status: 'insufficient-data',
        isMandatoryFromBrief: isRoomMandatoryAccessible,
        measuredValue: null,
        requiredValue: formatMeasure(thresholds.minDoorClearOpeningWidth, unit),
        unit: unit === 'feet' ? 'ft' : 'm',
        inputProvenance: ['missing-unmodeled'],
        explanation: `No doorway or opening records exist for room "${room.name}". Door clear width, swing direction, latch-side clearance, and threshold height cannot be verified until openings are recorded.`,
        missingInputsRequired: [
          'Door location along room wall (north/south/east/west)',
          'Clear opening width when door is open 90 degrees',
          'Door swing direction (inward-left, inward-right, outward, sliding-or-none)',
          'Threshold height and latch-side clearance',
        ],
        remediationGuidance: `Record the doorway opening for "${room.name}" in P33 Furniture & Circulation or P34 Universal Accessibility Review.`,
      };
      roomCriteria.push(missingDoorCrit);
      allCriterionResults.push(missingDoorCrit);
    } else {
      for (const op of roomOpenings) {
        doorsEvaluated++;
        const doorMeta: DoorAccessibilityMetadata | undefined =
          reviewData.elements.doorDetails[op.openingId];
        const opZones = getKnownOpeningZones(room, op, furnitureData.clearanceThresholds);

        const hasExplicitClearWidth =
          typeof doorMeta?.clearOpeningWidth === 'number' && doorMeta.clearOpeningWidth > 0;
        const leafDeduction = unit === 'feet' ? 0.17 : 0.05;
        const isSlidingOrOpen =
          op.swingDirection === 'sliding-or-none' || op.type === 'open-passage';
        const isInwardSwing =
          op.swingDirection === 'inward-left' || op.swingDirection === 'inward-right';

        const effectiveClearWidth = hasExplicitClearWidth
          ? doorMeta!.clearOpeningWidth!
          : isSlidingOrOpen
          ? op.width
          : round2(Math.max(0, op.width - leafDeduction));

        const doorZoneBlocked = solidObstacleBoxes.some((obs) => {
          if (
            opZones.swingZone &&
            Math.abs(obs.x - opZones.swingZone.x) < 1e-3 &&
            Math.abs(obs.y - opZones.swingZone.y) < 1e-3
          ) {
            return false;
          }
          return rectsOverlapStrict(opZones.approachZone, obs);
        });

        const wallLength =
          op.wallEdge === 'north' || op.wallEdge === 'south' ? room.width : room.length;
        const spaceBeforeOpening = op.offsetAlongWall;
        const spaceAfterOpening = Math.max(0, wallLength - (op.offsetAlongWall + op.width));
        const availableLatchClearance =
          typeof doorMeta?.pullSideLatchClearance === 'number'
            ? doorMeta.pullSideLatchClearance
            : Math.max(spaceBeforeOpening, spaceAfterOpening);

        const latchClearanceFails =
          isInwardSwing &&
          availableLatchClearance < thresholds.doorPullSideLatchClearance - 1e-3;

        const inwardSwingBlocksRoomTurn =
          isInwardSwing && !turningResult.meetsTarget;

        let doorStatus: AccessibilityResultStatus;
        let doorExplanation: string;
        let doorRemediation: string | undefined;

        if (
          op.width < thresholds.minDoorClearOpeningWidth - 1e-3 ||
          effectiveClearWidth < thresholds.minDoorClearOpeningWidth - 1e-3
        ) {
          doorStatus = 'does-not-meet-configured-criterion';
          doorsFailing++;
          doorExplanation = `Opening "${op.openingId}" on ${op.wallEdge} wall of "${room.name}" has ${
            hasExplicitClearWidth ? 'verified clear width' : 'estimated clear width'
          } ${formatMeasure(effectiveClearWidth, unit)} (nominal width ${formatMeasure(
            op.width,
            unit
          )}), which is below the required minimum ${formatMeasure(
            thresholds.minDoorClearOpeningWidth,
            unit
          )}.`;
          doorRemediation = `Widen doorway "${op.openingId}" so clear opening width is at least ${formatMeasure(
            thresholds.minDoorClearOpeningWidth,
            unit
          )}.`;
        } else if (doorZoneBlocked || latchClearanceFails || inwardSwingBlocksRoomTurn) {
          doorStatus = 'does-not-meet-configured-criterion';
          doorsFailing++;
          const reasons: string[] = [];
          if (doorZoneBlocked) {
            reasons.push('door maneuvering zone is obstructed by placed furniture or fixed elements');
          }
          if (latchClearanceFails) {
            reasons.push(
              `pull-side latch clearance is ${formatMeasure(
                availableLatchClearance,
                unit
              )} (requires >= ${formatMeasure(thresholds.doorPullSideLatchClearance, unit)})`
            );
          }
          if (inwardSwingBlocksRoomTurn) {
            reasons.push('inward door swing arc encroaches into the room wheelchair turning space');
          }
          doorExplanation = `Doorway "${op.openingId}" (${op.wallEdge} wall of "${room.name}") clear width is ${formatMeasure(
            effectiveClearWidth,
            unit
          )}, but fails maneuvering criteria because ${reasons.join('; ')}.`;
          doorRemediation = inwardSwingBlocksRoomTurn
            ? `Reverse doorway "${op.openingId}" to swing outward or use a sliding/pocket door, or clear blocking furniture.`
            : `Clear obstructions from the doorway maneuvering zone and ensure ${formatMeasure(
                thresholds.doorPullSideLatchClearance,
                unit
              )} latch-side clearance.`;
        } else if (op.swingDirection === 'unknown') {
          doorStatus = 'insufficient-data';
          doorsInsufficientData++;
          doorExplanation = `Doorway "${op.openingId}" has clear width ${formatMeasure(
            effectiveClearWidth,
            unit
          )}, but swing direction is 'unknown', preventing pull-side vs push-side maneuvering verification.`;
        } else if (!hasExplicitClearWidth && !isSlidingOrOpen) {
          doorStatus = 'warning';
          doorsPassing++;
          doorExplanation = `Doorway "${op.openingId}" (${op.wallEdge} wall of "${room.name}") nominal width is ${formatMeasure(
            op.width,
            unit
          )} (estimated clear width ${formatMeasure(
            effectiveClearWidth,
            unit
          )} >= ${formatMeasure(
            thresholds.minDoorClearOpeningWidth,
            unit
          )}), and maneuvering zone is clear. Exact clear opening width between door stop and 90°-open leaf has not been explicitly verified.`;
          doorRemediation = `Confirm exact clear opening width and threshold height for "${op.openingId}" in P34 Door Details.`;
        } else {
          doorStatus = 'meets-configured-criterion';
          doorsPassing++;
          doorExplanation = `Doorway "${op.openingId}" (${op.wallEdge} wall of "${room.name}") meets clear opening width (${formatMeasure(
            effectiveClearWidth,
            unit
          )} >= ${formatMeasure(
            thresholds.minDoorClearOpeningWidth,
            unit
          )}) and unobstructed maneuvering clearance.`;
        }

        const doorOverlay: AccessibilityGeometricOverlayItem = {
          overlayId: `ov-door-${op.openingId}`,
          floorLevel: room.floorLevel,
          roomId: room.id,
          kind: 'door-maneuvering-zone',
          status: doorStatus,
          label: `Door ${op.openingId} (${op.wallEdge})`,
          rect: opZones.approachZone,
          measuredDisplay: formatMeasure(effectiveClearWidth, unit),
          requiredDisplay: formatMeasure(thresholds.minDoorClearOpeningWidth, unit),
        };
        geometricOverlays.push(doorOverlay);

        const doorCrit: AccessibilityCriterionResult = {
          criterionId: `crit-door-${op.openingId}`,
          topicId: 'doors-and-thresholds',
          title: `Doorway Clear Width & Maneuvering — ${room.name} (${op.wallEdge} wall)`,
          clauseOrRuleReference:
            activeProfile.profileId === 'us-ada-2010-standards'
              ? '2010 ADA Standards §404.2.3 (Clear Width) & §404.2.4 (Maneuvering Clearances)'
              : activeProfile.profileId === 'iso-21542-2021-reference'
              ? 'ISO 21542:2021 Clause 18 (Doors and Windows)'
              : 'Doorway Clear Width & Maneuvering Threshold',
          ruleProfileId: activeProfile.profileId,
          targetScope: 'opening',
          targetId: op.openingId,
          targetName: `${room.name} (${op.wallEdge} door)`,
          floorLevel: room.floorLevel,
          status: doorStatus,
          isMandatoryFromBrief: isRoomMandatoryAccessible,
          measuredValue: effectiveClearWidth,
          requiredValue: thresholds.minDoorClearOpeningWidth,
          unit: unit === 'feet' ? 'ft' : 'm',
          inputProvenance: hasExplicitClearWidth
            ? ['user-entered', 'imported-p33-furniture-layout']
            : ['imported-p33-furniture-layout', 'assumed-requires-verification'],
          explanation: doorExplanation,
          remediationGuidance: doorRemediation,
          geometricOverlay: doorOverlay,
        };
        roomCriteria.push(doorCrit);
        allCriterionResults.push(doorCrit);

        // Threshold height criterion per door
        if (typeof doorMeta?.thresholdHeightMinorUnit === 'number') {
          const thVal = doorMeta.thresholdHeightMinorUnit;
          const thPass = thVal <= thresholds.maxDoorThresholdHeightMinorUnit + 1e-4;
          const thCrit: AccessibilityCriterionResult = {
            criterionId: `crit-threshold-${op.openingId}`,
            topicId: 'doors-and-thresholds',
            title: `Doorway Threshold Height — ${room.name} (${op.wallEdge} wall)`,
            clauseOrRuleReference:
              activeProfile.profileId === 'us-ada-2010-standards'
                ? '2010 ADA Standards §404.2.5 (Thresholds <= 1/2 in)'
                : 'Doorway Threshold Maximum Height',
            ruleProfileId: activeProfile.profileId,
            targetScope: 'opening',
            targetId: op.openingId,
            targetName: `${room.name} (${op.wallEdge} threshold)`,
            floorLevel: room.floorLevel,
            status: thPass
              ? 'meets-configured-criterion'
              : 'does-not-meet-configured-criterion',
            isMandatoryFromBrief: isRoomMandatoryAccessible,
            measuredValue: thVal,
            requiredValue: thresholds.maxDoorThresholdHeightMinorUnit,
            unit: unit === 'feet' ? 'in' : 'mm',
            inputProvenance: [doorMeta.provenance],
            explanation: thPass
              ? `Threshold height at "${op.openingId}" is ${formatMinorMeasure(
                  thVal,
                  unit
                )} (<= ${formatMinorMeasure(thresholds.maxDoorThresholdHeightMinorUnit, unit)}).`
              : `Threshold height at "${op.openingId}" is ${formatMinorMeasure(
                  thVal,
                  unit
                )}, exceeding maximum ${formatMinorMeasure(
                  thresholds.maxDoorThresholdHeightMinorUnit,
                  unit
                )}.`,
            remediationGuidance: thPass
              ? undefined
              : `Bevel or lower the threshold at "${op.openingId}" to ${formatMinorMeasure(
                  thresholds.maxDoorThresholdHeightMinorUnit,
                  unit
                )} or less.`,
          };
          roomCriteria.push(thCrit);
          allCriterionResults.push(thCrit);
        } else {
          const thUnassessed: AccessibilityCriterionResult = {
            criterionId: `crit-threshold-${op.openingId}`,
            topicId: 'doors-and-thresholds',
            title: `Doorway Threshold Height — ${room.name} (${op.wallEdge} wall)`,
            clauseOrRuleReference:
              activeProfile.profileId === 'us-ada-2010-standards'
                ? '2010 ADA Standards §404.2.5 (Thresholds)'
                : 'Doorway Threshold Height',
            ruleProfileId: activeProfile.profileId,
            targetScope: 'opening',
            targetId: op.openingId,
            targetName: `${room.name} (${op.wallEdge} threshold)`,
            floorLevel: room.floorLevel,
            status: 'unassessed',
            isMandatoryFromBrief: false,
            measuredValue: null,
            requiredValue: thresholds.maxDoorThresholdHeightMinorUnit,
            unit: unit === 'feet' ? 'in' : 'mm',
            inputProvenance: ['missing-unmodeled'],
            explanation: `Threshold height for doorway "${op.openingId}" has not been specified in the 2D plan model.`,
            missingInputsRequired: ['Threshold height in inches or millimetres'],
          };
          roomCriteria.push(thUnassessed);
          allCriterionResults.push(thUnassessed);
        }
      }
    }

    // 1D. Accessible Route & Exact Continuous Corridor/Passage Width Check for Room
    const p33RoomMetric = p33Report.roomMetrics.find((m) => m.roomId === room.id);
    const roomRoutes = p33RoomMetric?.routesEvaluated || [];

    let exactMinPassageWidth = Math.min(room.width, room.length);
    if (
      p33RoomMetric &&
      p33RoomMetric.minPairwiseFurnitureGap !== null &&
      p33RoomMetric.minPairwiseFurnitureGap > 0
    ) {
      exactMinPassageWidth = Math.min(exactMinPassageWidth, p33RoomMetric.minPairwiseFurnitureGap);
    }
    for (const rt of roomRoutes) {
      if (rt.minimumMeasuredClearanceAlongPath !== null) {
        exactMinPassageWidth = Math.min(
          exactMinPassageWidth,
          rt.minimumMeasuredClearanceAlongPath
        );
      }
    }

    let routeStatus: AccessibilityResultStatus;
    let routeExplanation: string;
    let routeRemediation: string | undefined;

    if (roomOpenings.length === 0) {
      routeStatus = 'insufficient-data';
      routeExplanation = `Accessible route continuity for "${room.name}" cannot be verified because no door/opening connections are recorded.`;
      routeRemediation = `Add doorway openings for "${room.name}" to trace accessible route continuity.`;
    } else if (
      exactMinPassageWidth < thresholds.minAccessibleRouteClearWidth - 1e-3 ||
      roomRoutes.some((r) => r.status === 'blocked' || r.status === 'passable-narrow')
    ) {
      routeStatus = 'does-not-meet-configured-criterion';
      routeExplanation = `Accessible route serving "${room.name}" is obstructed or narrows to ${formatMeasure(
        exactMinPassageWidth,
        unit
      )}, which is below the required continuous clear width of ${formatMeasure(
        thresholds.minAccessibleRouteClearWidth,
        unit
      )}.`;
      routeRemediation = `Clear furniture/obstacles along the route in "${room.name}" to achieve at least ${formatMeasure(
        thresholds.minAccessibleRouteClearWidth,
        unit
      )} continuous clear width.`;
    } else {
      const gridCellSize = unit === 'feet' ? 0.5 : 0.15;
      if (exactMinPassageWidth < thresholds.minAccessibleRouteClearWidth + gridCellSize) {
        routeStatus = 'warning';
        routeExplanation = `Accessible route in "${room.name}" has measured passage width ${formatMeasure(
          exactMinPassageWidth,
          unit
        )} (required >= ${formatMeasure(
          thresholds.minAccessibleRouteClearWidth,
          unit
        )}), which is within one P33 circulation grid cell (${formatMeasure(
          gridCellSize,
          unit
        )}) of the minimum threshold. Verify exact field dimension.`;
      } else {
        routeStatus = 'meets-configured-criterion';
        routeExplanation = `Accessible route serving "${room.name}" maintains >= ${formatMeasure(
          thresholds.minAccessibleRouteClearWidth,
          unit
        )} clear width (measured ${formatMeasure(exactMinPassageWidth, unit)}).`;
      }
    }

    const routeCrit: AccessibilityCriterionResult = {
      criterionId: `crit-route-${room.id}`,
      topicId: 'accessible-routes-and-corridors',
      title: `Accessible Route Continuity & Clear Width — ${room.name}`,
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §403.5.1 (Clear Width of Accessible Route)'
          : activeProfile.profileId === 'iso-21542-2021-reference'
          ? 'ISO 21542:2021 Clause 7 & Clause 10 (Horizontal Circulation)'
          : 'Accessible Route Minimum Clear Width',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'room',
      targetId: room.id,
      targetName: room.name,
      floorLevel: room.floorLevel,
      status: routeStatus,
      isMandatoryFromBrief: isRoomMandatoryAccessible,
      measuredValue: roomOpenings.length === 0 ? null : round2(exactMinPassageWidth),
      requiredValue: thresholds.minAccessibleRouteClearWidth,
      unit: unit === 'feet' ? 'ft' : 'm',
      inputProvenance:
        roomOpenings.length === 0
          ? ['missing-unmodeled']
          : ['measured-project-geometry', 'imported-p33-furniture-layout'],
      explanation: routeExplanation,
      remediationGuidance: routeRemediation,
    };
    roomCriteria.push(routeCrit);
    allCriterionResults.push(routeCrit);

    // 1E. Sanitary & Kitchen Fixture-Specific Checks when room is Bathroom or Kitchen
    const rTypeLower = room.type.toLowerCase();
    const rNameLower = room.name.toLowerCase();
    const isBathroom =
      rTypeLower.includes('bath') ||
      rTypeLower.includes('wc') ||
      rTypeLower.includes('restroom') ||
      rNameLower.includes('bath') ||
      rNameLower.includes('toilet');
    const isKitchen = rTypeLower.includes('kitchen') || rNameLower.includes('kitchen');

    if (isBathroom || isKitchen) {
      const roomFixtures = reviewData.elements.fixtureDetails.filter(
        (f) => f.roomId === room.id
      );
      if (roomFixtures.length === 0) {
        const fixUnassessed: AccessibilityCriterionResult = {
          criterionId: `crit-fixture-meta-${room.id}`,
          topicId: 'sanitary-and-kitchen-fixtures',
          title: `${
            isBathroom
              ? 'Sanitary Fixture Details (Grab Bars, Transfer & Knee Clearance)'
              : 'Kitchen Work Surface & Sink Knee/Toe Clearance'
          } — ${room.name}`,
          clauseOrRuleReference:
            activeProfile.profileId === 'us-ada-2010-standards'
              ? isBathroom
                ? '2010 ADA Standards §§603–608 (Toilet & Bathing Rooms)'
                : '2010 ADA Standards §804 (Kitchens and Kitchenettes)'
              : 'Sanitary & Kitchen Fixture Accessibility Attributes',
          ruleProfileId: activeProfile.profileId,
          targetScope: 'room',
          targetId: room.id,
          targetName: room.name,
          floorLevel: room.floorLevel,
          status: 'insufficient-data',
          isMandatoryFromBrief: isRoomMandatoryAccessible,
          measuredValue: null,
          requiredValue: isBathroom
            ? 'Verified WC transfer space, grab bars & lavatory knee clearance'
            : 'Verified sink knee/toe clearance & accessible work surface height',
          unit: 'attributes',
          inputProvenance: ['missing-unmodeled'],
          explanation: `Room "${room.name}" is a ${
            isBathroom ? 'bathroom/sanitary space' : 'kitchen'
          }, but fixture-level accessibility attributes (${
            isBathroom
              ? 'WC side/rear grab bars, toilet transfer space, lavatory knee/toe clearance'
              : 'sink knee/toe clearance, 34 in / 865 mm max work surface height'
          }) have not been modeled. Room turning geometry alone does not verify fixture compliance.`,
          missingInputsRequired: isBathroom
            ? [
                'WC transfer space dimensions',
                'Grab bar / wall blocking provision',
                'Lavatory knee and toe clearance under sink',
              ]
            : ['Sink knee and toe clearance', 'Accessible counter/work surface height'],
        };
        roomCriteria.push(fixUnassessed);
        allCriterionResults.push(fixUnassessed);
      } else {
        for (const fix of roomFixtures) {
          const requiresKnee =
            fix.fixtureType === 'lavatory-sink' ||
            fix.fixtureType === 'kitchen-sink' ||
            fix.fixtureType === 'work-surface';
          const requiresGrabAndTransfer =
            fix.fixtureType === 'wc-toilet' ||
            fix.fixtureType === 'roll-in-shower' ||
            fix.fixtureType === 'transfer-shower' ||
            fix.fixtureType === 'bathtub';

          let fixStatus: AccessibilityResultStatus = 'meets-configured-criterion';
          const issues: string[] = [];

          if (requiresKnee && fix.hasKneeAndToeClearance === false) {
            fixStatus = 'does-not-meet-configured-criterion';
            issues.push('missing required knee and toe clearance beneath fixture');
          } else if (requiresKnee && fix.hasKneeAndToeClearance === undefined) {
            fixStatus = 'insufficient-data';
            issues.push('knee and toe clearance not specified');
          }

          if (requiresGrabAndTransfer) {
            if (fix.hasGrabBarsOrBlocking === false) {
              fixStatus = 'does-not-meet-configured-criterion';
              issues.push('grab bars or wall reinforcement blocking not provided');
            }
            if (fix.hasTransferSpace === false) {
              fixStatus = 'does-not-meet-configured-criterion';
              issues.push('wheelchair transfer space not provided');
            }
            if (fix.hasGrabBarsOrBlocking === undefined || fix.hasTransferSpace === undefined) {
              if (fixStatus === 'meets-configured-criterion') {
                fixStatus = 'insufficient-data';
              }
              issues.push('grab bar or transfer space status incomplete');
            }
          }

          const fixCrit: AccessibilityCriterionResult = {
            criterionId: `crit-fixture-${fix.fixtureId}`,
            topicId: 'sanitary-and-kitchen-fixtures',
            title: `Fixture Accessibility (${fix.fixtureType}) — ${room.name}`,
            clauseOrRuleReference:
              activeProfile.profileId === 'us-ada-2010-standards'
                ? '2010 ADA Standards §§604–608 / §804'
                : 'Fixture Transfer, Grab Bar & Knee Clearance',
            ruleProfileId: activeProfile.profileId,
            targetScope: 'fixture',
            targetId: fix.fixtureId,
            targetName: `${fix.fixtureType} in ${room.name}`,
            floorLevel: room.floorLevel,
            status: fixStatus,
            isMandatoryFromBrief: isRoomMandatoryAccessible,
            measuredValue: issues.length === 0 ? 'Provided' : issues.join('; '),
            requiredValue: requiresKnee
              ? 'Knee/toe clearance provided'
              : 'Transfer space & grab bars provided',
            unit: 'attributes',
            inputProvenance: [fix.provenance],
            explanation:
              issues.length === 0
                ? `Fixture "${fix.fixtureType}" in "${room.name}" satisfies configured transfer, grab bar, and knee/toe clearance attributes.`
                : `Fixture "${fix.fixtureType}" in "${room.name}" issue: ${issues.join('; ')}.`,
          };
          roomCriteria.push(fixCrit);
          allCriterionResults.push(fixCrit);
        }
      }
    }

    let overallRoomStatus: AccessibilityResultStatus = 'meets-configured-criterion';
    if (roomCriteria.some((c) => c.status === 'does-not-meet-configured-criterion')) {
      overallRoomStatus = 'does-not-meet-configured-criterion';
    } else if (roomCriteria.some((c) => c.status === 'warning')) {
      overallRoomStatus = 'warning';
    } else if (
      roomCriteria.some((c) => c.status === 'insufficient-data' || c.status === 'unassessed')
    ) {
      overallRoomStatus = 'insufficient-data';
    }

    roomStatusMap.set(room.id, overallRoomStatus);
    roomDiagnostics.push({
      roomId: room.id,
      roomName: room.name,
      roomType: room.type,
      floorLevel: room.floorLevel,
      isMandatoryWheelchairAccessibleInBrief: isRoomMandatoryAccessible,
      roomWidth: room.width,
      roomLength: room.length,
      maxClearInscribedCircleDiameter: turningResult.maxDiameter,
      requiredTurningCircleDiameter: thresholds.turningCircleDiameter,
      turningCircleCenter: turningResult.bestCenter,
      turningSpaceStatus: turningStatus,
      tTurnSpaceAvailable: tTurnAvailable,
      clearFloorSpacesEvaluated: cfsEvaluated,
      clearFloorSpacesPassing: cfsPassing,
      clearFloorSpacesFailing: cfsFailing,
      doorsEvaluated,
      doorsPassing,
      doorsFailing,
      doorsInsufficientData,
      routeConnectionStatus: routeStatus,
      overallRoomStatus,
      criterionResults: roomCriteria,
    });
  }

  // 2. Evaluate Vertical Circulation (Multi-Storey Lifts/Elevators, Ramps, and Stairs)
  const highestFloorInPlan = rooms.reduce((max, r) => Math.max(max, r.floorLevel), 1);
  const totalFloors = Math.max(project.floors, highestFloorInPlan);
  const upperFloorRooms = rooms.filter((r) => r.floorLevel > 1);
  const hasMandatoryUpperFloorRoom = upperFloorRooms.some((r) => {
    const diag = roomDiagnostics.find((d) => d.roomId === r.id);
    return Boolean(diag?.isMandatoryWheelchairAccessibleInBrief);
  });

  const lifts = reviewData.elements.verticalLifts;
  const ramps = reviewData.elements.ramps;
  const stairs = reviewData.elements.stairs;

  if (totalFloors > 1) {
    const floorsServedByLiftOrRamp = new Set<number>([1]);
    for (const lift of lifts) {
      if (lift.servedFloors.includes(1)) {
        for (const fl of lift.servedFloors) floorsServedByLiftOrRamp.add(fl);
      }
    }
    for (const ramp of ramps) {
      if (ramp.floorLevelStart !== ramp.floorLevelEnd) {
        floorsServedByLiftOrRamp.add(ramp.floorLevelStart);
        floorsServedByLiftOrRamp.add(ramp.floorLevelEnd);
      }
    }

    const unservedUpperFloors: number[] = [];
    for (let fl = 2; fl <= totalFloors; fl++) {
      if (!floorsServedByLiftOrRamp.has(fl)) {
        unservedUpperFloors.push(fl);
      }
    }

    if (unservedUpperFloors.length > 0) {
      const isMandatoryVertical =
        hasMandatoryBriefFlag ||
        hasMandatoryUpperFloorRoom ||
        reviewData.buildingOccupancyType !== 'residential-private';

      const vertStatus: AccessibilityResultStatus =
        isMandatoryVertical || stairs.length > 0
          ? 'does-not-meet-configured-criterion'
          : 'insufficient-data';

      allCriterionResults.push({
        criterionId: 'crit-vertical-multistorey-connection',
        topicId: 'vertical-circulation-ramps-lifts-stairs',
        title: `Multi-Storey Wheelchair Vertical Access (Floors 1 to ${totalFloors})`,
        clauseOrRuleReference:
          activeProfile.profileId === 'us-ada-2010-standards'
            ? '2010 ADA Standards §206.2.3 & §§405–409 (Multi-Story Vertical Access)'
            : activeProfile.profileId === 'iso-21542-2021-reference'
            ? 'ISO 21542:2021 Clauses 12–15 (Ramps, Lifts & Vertical Circulation)'
            : 'Multi-Storey Accessible Route Continuity',
        ruleProfileId: activeProfile.profileId,
        targetScope: 'project',
        targetId: project.id,
        targetName: `${project.name} (${totalFloors} Storeys)`,
        status: vertStatus,
        isMandatoryFromBrief: isMandatoryVertical,
        measuredValue:
          stairs.length > 0
            ? `Stairs only (Floors ${unservedUpperFloors.join(', ')} lack lift/ramp)`
            : `No lift or floor-to-floor ramp modeled for Floor(s) ${unservedUpperFloors.join(
                ', '
              )}`,
        requiredValue:
          'Accessible passenger elevator, platform lift, or compliant ramp serving all accessible levels',
        unit: 'levels',
        inputProvenance: stairs.length > 0 ? ['user-entered'] : ['missing-unmodeled'],
        explanation:
          stairs.length > 0
            ? `Project has ${totalFloors} storeys with stairs modeled, but no accessible elevator/lift or floor-to-floor ramp serving Floor(s) ${unservedUpperFloors.join(
                ', '
              )}. Stairs do NOT provide wheelchair-accessible floor-to-floor circulation.`
            : `Project has ${totalFloors} storeys, and Floor(s) ${unservedUpperFloors.join(
                ', '
              )} have no modeled elevator, lift, or accessible ramp connecting to Floor 1.`,
        remediationGuidance:
          'Add an accessible passenger elevator, platform lift, or compliant ramp connecting all accessible storeys, or relocate wheelchair-mandatory spaces to the ground floor (Floor 1).',
      });
    } else {
      allCriterionResults.push({
        criterionId: 'crit-vertical-multistorey-connection',
        topicId: 'vertical-circulation-ramps-lifts-stairs',
        title: `Multi-Storey Wheelchair Vertical Access (Floors 1 to ${totalFloors})`,
        clauseOrRuleReference:
          activeProfile.profileId === 'us-ada-2010-standards'
            ? '2010 ADA Standards §206.2.3'
            : 'Multi-Storey Accessible Vertical Connection',
        ruleProfileId: activeProfile.profileId,
        targetScope: 'project',
        targetId: project.id,
        targetName: `${project.name} (${totalFloors} Storeys)`,
        status: 'meets-configured-criterion',
        isMandatoryFromBrief: hasMandatoryBriefFlag || hasMandatoryUpperFloorRoom,
        measuredValue: `All ${totalFloors} floors connected via lift/ramp`,
        requiredValue: `All ${totalFloors} floors connected`,
        unit: 'levels',
        inputProvenance: ['user-entered'],
        explanation: `All ${totalFloors} storeys are connected by a modeled vertical lift/elevator or ramp.`,
      });
    }
  } else {
    allCriterionResults.push({
      criterionId: 'crit-vertical-multistorey-connection',
      topicId: 'vertical-circulation-ramps-lifts-stairs',
      title: 'Multi-Storey Vertical Circulation',
      clauseOrRuleReference: 'Single-Storey Building Scope',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'project',
      targetId: project.id,
      targetName: project.name,
      status: 'not-applicable',
      isMandatoryFromBrief: false,
      measuredValue: '1 Floor (Single-Storey)',
      requiredValue: 'N/A for single-storey without level changes',
      unit: 'levels',
      inputProvenance: ['measured-project-geometry'],
      explanation:
        'Project is a single-storey layout. Floor-to-floor elevator/lift circulation is not applicable unless internal split levels or entry grade changes exist.',
    });
  }

  // Evaluate each modeled Ramp
  for (const ramp of ramps) {
    const slopeRatio = ramp.runLength > 0 ? ramp.verticalRise / ramp.runLength : 1;
    const slopePasses = slopeRatio <= thresholds.maxRampSlopeRatio + 1e-4;
    const widthPasses = ramp.clearWidth >= thresholds.minRampClearWidth - 1e-3;
    const landingsPass =
      (ramp.topLandingLength === undefined ||
        ramp.topLandingLength >= thresholds.minRampLandingLength - 1e-3) &&
      (ramp.bottomLandingLength === undefined ||
        ramp.bottomLandingLength >= thresholds.minRampLandingLength - 1e-3);
    const landingsVerified =
      ramp.topLandingLength !== undefined && ramp.bottomLandingLength !== undefined;

    let rampStatus: AccessibilityResultStatus;
    if (!slopePasses || !widthPasses || !landingsPass) {
      rampStatus = 'does-not-meet-configured-criterion';
    } else if (!landingsVerified || ramp.hasHandrailsBothSides === undefined) {
      rampStatus = 'warning';
    } else {
      rampStatus = 'meets-configured-criterion';
    }

    const slopeDenominator = slopeRatio > 0 ? round2(1 / slopeRatio) : Infinity;

    allCriterionResults.push({
      criterionId: `crit-ramp-${ramp.rampId}`,
      topicId: 'vertical-circulation-ramps-lifts-stairs',
      title: `Accessible Ramp Slope, Width & Landings — ${ramp.name}`,
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §405 (Ramps: 1:12 max slope, 36 in min width, 60 in landings)'
          : activeProfile.profileId === 'iso-21542-2021-reference'
          ? 'ISO 21542:2021 Clause 12 (Ramps)'
          : 'Accessible Ramp Criteria',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'vertical-element',
      targetId: ramp.rampId,
      targetName: ramp.name,
      floorLevel: ramp.floorLevelStart,
      status: rampStatus,
      isMandatoryFromBrief: hasMandatoryBriefFlag,
      measuredValue: `1:${slopeDenominator} (${round2(slopeRatio * 100)}%), width ${formatMeasure(
        ramp.clearWidth,
        unit
      )}`,
      requiredValue: `<= 1:${round2(1 / thresholds.maxRampSlopeRatio)} (${round2(
        thresholds.maxRampSlopeRatio * 100
      )}%), width >= ${formatMeasure(thresholds.minRampClearWidth, unit)}`,
      unit: 'slope & width',
      inputProvenance: [ramp.provenance],
      explanation:
        rampStatus === 'meets-configured-criterion'
          ? `Ramp "${ramp.name}" running slope is 1:${slopeDenominator} (${round2(
              slopeRatio * 100
            )}%), clear width is ${formatMeasure(
              ramp.clearWidth,
              unit
            )}, and landings meet >= ${formatMeasure(thresholds.minRampLandingLength, unit)}.`
          : `Ramp "${ramp.name}" issue: ${
              !slopePasses
                ? `running slope 1:${slopeDenominator} (${round2(
                    slopeRatio * 100
                  )}%) is steeper than max 1:${round2(1 / thresholds.maxRampSlopeRatio)}; `
                : ''
            }${
              !widthPasses
                ? `clear width ${formatMeasure(ramp.clearWidth, unit)} < ${formatMeasure(
                    thresholds.minRampClearWidth,
                    unit
                  )}; `
                : ''
            }${
              !landingsPass
                ? `landing length < ${formatMeasure(thresholds.minRampLandingLength, unit)}`
                : !landingsVerified
                ? 'top/bottom landing lengths or handrail details not fully verified'
                : ''
            }.`,
      remediationGuidance:
        !slopePasses
          ? `Increase ramp run length to at least ${formatMeasure(
              ramp.verticalRise / thresholds.maxRampSlopeRatio,
              unit
            )} for a ${formatMeasure(ramp.verticalRise, unit)} rise.`
          : undefined,
    });
  }

  // Evaluate each modeled Lift/Elevator
  for (const lift of lifts) {
    const cabWPass = lift.cabClearWidth >= thresholds.minLiftCabWidth - 1e-3;
    const cabDPass = lift.cabClearDepth >= thresholds.minLiftCabDepth - 1e-3;
    const doorPass = lift.doorClearWidth >= thresholds.minDoorClearOpeningWidth - 1e-3;

    const liftPasses = cabWPass && cabDPass && doorPass;
    allCriterionResults.push({
      criterionId: `crit-lift-${lift.liftId}`,
      topicId: 'vertical-circulation-ramps-lifts-stairs',
      title: `Vertical Lift / Elevator Cab & Door Dimensions — ${lift.name}`,
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §§407–410 (Elevators and Platform Lifts)'
          : 'Accessible Lift / Elevator Dimensions',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'vertical-element',
      targetId: lift.liftId,
      targetName: lift.name,
      status: liftPasses
        ? 'meets-configured-criterion'
        : 'does-not-meet-configured-criterion',
      isMandatoryFromBrief: hasMandatoryBriefFlag,
      measuredValue: `${formatMeasure(lift.cabClearWidth, unit)} × ${formatMeasure(
        lift.cabClearDepth,
        unit
      )} (door ${formatMeasure(lift.doorClearWidth, unit)})`,
      requiredValue: `${formatMeasure(thresholds.minLiftCabWidth, unit)} × ${formatMeasure(
        thresholds.minLiftCabDepth,
        unit
      )} (door >= ${formatMeasure(thresholds.minDoorClearOpeningWidth, unit)})`,
      unit: unit === 'feet' ? 'ft' : 'm',
      inputProvenance: [lift.provenance],
      explanation: liftPasses
        ? `Lift "${lift.name}" cab dimensions and door clear width meet configured minimums.`
        : `Lift "${lift.name}" fails minimum cab or door dimensions.`,
    });
  }

  // Evaluate each modeled Stair
  for (const stair of stairs) {
    const widthPass = stair.clearWidth >= thresholds.minStairClearWidth - 1e-3;
    const handrailsPass = stair.hasContinuousHandrails !== false;
    const status: AccessibilityResultStatus =
      !widthPass || !handrailsPass
        ? 'does-not-meet-configured-criterion'
        : stair.hasContinuousHandrails === undefined || stair.hasVisualContrastNosings === undefined
        ? 'warning'
        : 'meets-configured-criterion';

    allCriterionResults.push({
      criterionId: `crit-stair-${stair.stairId}`,
      topicId: 'vertical-circulation-ramps-lifts-stairs',
      title: `Ambulatory Stair Width, Handrails & Nosings — ${stair.name}`,
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §504 (Stairways) & §505 (Handrails)'
          : 'Stairway Width, Handrails & Visual Contrast',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'vertical-element',
      targetId: stair.stairId,
      targetName: stair.name,
      floorLevel: stair.floorLevelStart,
      status,
      isMandatoryFromBrief: false,
      measuredValue: `${formatMeasure(stair.clearWidth, unit)} width`,
      requiredValue: `>= ${formatMeasure(
        thresholds.minStairClearWidth,
        unit
      )} width + continuous handrails`,
      unit: unit === 'feet' ? 'ft' : 'm',
      inputProvenance: [stair.provenance],
      explanation: `Stair "${stair.name}" clear width is ${formatMeasure(
        stair.clearWidth,
        unit
      )}. Note: Stairs serve ambulatory circulation only and do not provide wheelchair access between levels.`,
    });
  }

  // 3. Evaluate Reach Ranges & Operable Parts
  const controls = reviewData.elements.operableControls;
  if (controls.length === 0) {
    allCriterionResults.push({
      criterionId: 'crit-controls-unmodeled',
      topicId: 'reach-ranges-and-operable-parts',
      title: 'Reach Ranges & Operable Controls (Switches, Outlets, Thermostats)',
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §308 (Reach Ranges: 15–48 in) & §309 (Operable Parts)'
          : activeProfile.profileId === 'iso-21542-2021-reference'
          ? 'ISO 21542:2021 Clause 26 (Controls and Switches: 400–1200 mm)'
          : 'Reach Range & Operable Control Heights',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'project',
      targetId: project.id,
      targetName: project.name,
      status: 'unassessed',
      isMandatoryFromBrief: false,
      measuredValue: null,
      requiredValue: `${formatMinorMeasure(
        thresholds.minReachHeightMinorUnit,
        unit
      )} – ${formatMinorMeasure(thresholds.maxReachHeightMinorUnit, unit)} AFF`,
      unit: unit === 'feet' ? 'in' : 'mm',
      inputProvenance: ['missing-unmodeled'],
      explanation:
        'Mounting heights and clear floor space for switches, thermostats, outlets, and operable hardware are not modeled in the 2D floor plan and remain unassessed.',
      missingInputsRequired: [
        'Mounting height above finished floor (AFF)',
        'Clear floor space at control location',
        'Single-hand operability without tight grasping/pinching/twisting',
      ],
    });
  } else {
    for (const ctrl of controls) {
      const heightOk =
        ctrl.mountingHeightMinorUnit >= thresholds.minReachHeightMinorUnit - 1e-3 &&
        ctrl.mountingHeightMinorUnit <= thresholds.maxReachHeightMinorUnit + 1e-3;
      const cfsOk = ctrl.hasClearFloorSpaceAtControl;
      const handOk = ctrl.operableSingleHandWithoutTwisting !== false;
      const passes = heightOk && cfsOk && handOk;

      allCriterionResults.push({
        criterionId: `crit-control-${ctrl.controlId}`,
        topicId: 'reach-ranges-and-operable-parts',
        title: `Operable Control Reach & Operation — ${ctrl.controlType} (${ctrl.roomId})`,
        clauseOrRuleReference:
          activeProfile.profileId === 'us-ada-2010-standards'
            ? '2010 ADA Standards §308 & §309'
            : 'Reach Range & Operable Hardware',
        ruleProfileId: activeProfile.profileId,
        targetScope: 'control',
        targetId: ctrl.controlId,
        targetName: `${ctrl.controlType} (${ctrl.roomId})`,
        floorLevel: ctrl.floorLevel,
        status: passes ? 'meets-configured-criterion' : 'does-not-meet-configured-criterion',
        isMandatoryFromBrief: hasMandatoryBriefFlag,
        measuredValue: `${formatMinorMeasure(ctrl.mountingHeightMinorUnit, unit)} AFF`,
        requiredValue: `${formatMinorMeasure(
          thresholds.minReachHeightMinorUnit,
          unit
        )} – ${formatMinorMeasure(thresholds.maxReachHeightMinorUnit, unit)} AFF`,
        unit: unit === 'feet' ? 'in' : 'mm',
        inputProvenance: [ctrl.provenance],
        explanation: passes
          ? `Control "${ctrl.controlType}" mounting height (${formatMinorMeasure(
              ctrl.mountingHeightMinorUnit,
              unit
            )}) and clear floor space meet reach range requirements.`
          : `Control "${ctrl.controlType}" fails reach range (${formatMinorMeasure(
              ctrl.mountingHeightMinorUnit,
              unit
            )}), clear floor space, or single-hand operation criteria.`,
      });
    }
  }

  // 4. Evaluate Wayfinding, Tactile & Signage
  const signageItems = reviewData.elements.sensoryAndWayfinding.filter(
    (e) => e.category === 'tactile-braille-signage' || e.category === 'high-contrast-wayfinding'
  );
  if (signageItems.length === 0) {
    allCriterionResults.push({
      criterionId: 'crit-wayfinding-unmodeled',
      topicId: 'wayfinding-tactile-and-signage',
      title: 'Wayfinding, Tactile Characters, Braille Signage & Visual Contrast',
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §703 (Signs: Raised Characters & Braille)'
          : activeProfile.profileId === 'iso-21542-2021-reference'
          ? 'ISO 21542:2021 Clauses 39–41 (Wayfinding, Visual Contrast & Tactile Signage)'
          : 'Wayfinding & Tactile Signage Review',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'project',
      targetId: project.id,
      targetName: project.name,
      status:
        reviewData.buildingOccupancyType === 'residential-private'
          ? 'unassessed'
          : 'requires-human-review',
      isMandatoryFromBrief: false,
      measuredValue: null,
      requiredValue: 'Tactile/Braille room identification signage & luminance contrast',
      unit: 'sensory',
      inputProvenance: ['missing-unmodeled'],
      explanation:
        'Wayfinding signage, raised tactile characters, Braille room signs, and surface luminance contrast are not modeled in the floor-plan geometry and remain unassessed.',
      missingInputsRequired: [
        'Tactile & Braille signage schedule for permanent rooms and exits',
        'Visual luminance contrast ratios on doors, walls, and nosings',
      ],
    });
  } else {
    for (const item of signageItems) {
      allCriterionResults.push({
        criterionId: `crit-wayfinding-${item.elementId}`,
        topicId: 'wayfinding-tactile-and-signage',
        title: `Wayfinding / Signage — ${item.description}`,
        clauseOrRuleReference: 'Tactile & Visual Wayfinding Provision',
        ruleProfileId: activeProfile.profileId,
        targetScope: 'sensory',
        targetId: item.elementId,
        targetName: item.description,
        floorLevel: item.floorLevel,
        status: item.isProvided
          ? 'meets-configured-criterion'
          : 'does-not-meet-configured-criterion',
        isMandatoryFromBrief: false,
        measuredValue: item.isProvided ? 'Provided' : 'Not Provided',
        requiredValue: 'Provided & field-verified',
        unit: 'sensory',
        inputProvenance: [item.provenance],
        explanation: item.isProvided
          ? `Wayfinding element "${item.description}" is recorded as provided.`
          : `Required wayfinding element "${item.description}" is marked as not provided.`,
      });
    }
  }

  // 5. Evaluate Visual / Audible Alarms & Communication
  const alarmItems = reviewData.elements.sensoryAndWayfinding.filter(
    (e) => e.category === 'visual-audible-alarm' || e.category === 'assistive-listening-loop'
  );
  if (alarmItems.length === 0) {
    allCriterionResults.push({
      criterionId: 'crit-alarms-unmodeled',
      topicId: 'visual-audible-alarms-and-communication',
      title: 'Visual Strobe & Audible Fire Alarms / Two-Way Communication',
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §702 (Fire Alarm Systems) & §706 (Assistive Listening)'
          : activeProfile.profileId === 'iso-21542-2021-reference'
          ? 'ISO 21542:2021 Clause 37 (Emergency Warning Systems)'
          : 'Visual & Audible Alarm Review',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'project',
      targetId: project.id,
      targetName: project.name,
      status:
        reviewData.buildingOccupancyType === 'residential-private'
          ? 'unassessed'
          : 'requires-human-review',
      isMandatoryFromBrief: false,
      measuredValue: null,
      requiredValue: 'Synchronized visual strobe & audible emergency notification',
      unit: 'sensory',
      inputProvenance: ['missing-unmodeled'],
      explanation:
        'Visual strobe alarms, audible fire notification appliances, and assistive listening systems are not modeled in the architectural plan and remain unassessed.',
      missingInputsRequired: [
        'Visual & audible fire alarm notification layout',
        'Two-way area-of-refuge communication where required',
      ],
    });
  } else {
    for (const item of alarmItems) {
      allCriterionResults.push({
        criterionId: `crit-alarm-${item.elementId}`,
        topicId: 'visual-audible-alarms-and-communication',
        title: `Emergency / Communication — ${item.description}`,
        clauseOrRuleReference: 'Visual & Audible Notification Provision',
        ruleProfileId: activeProfile.profileId,
        targetScope: 'sensory',
        targetId: item.elementId,
        targetName: item.description,
        floorLevel: item.floorLevel,
        status: item.isProvided
          ? 'meets-configured-criterion'
          : 'does-not-meet-configured-criterion',
        isMandatoryFromBrief: false,
        measuredValue: item.isProvided ? 'Provided' : 'Not Provided',
        requiredValue: 'Provided',
        unit: 'sensory',
        inputProvenance: [item.provenance],
        explanation: item.isProvided
          ? `Sensory/communication system "${item.description}" is recorded as provided.`
          : `Sensory/communication system "${item.description}" is marked as not provided.`,
      });
    }
  }

  // 6. Evaluate Site Approach & Pedestrian Access
  const sitePedestrianAccess = (project.siteContext?.accessPoints || []).filter(
    (ap) => ap.type === 'pedestrian'
  );
  const siteSlope = project.siteContext?.slope;
  if (sitePedestrianAccess.length === 0) {
    allCriterionResults.push({
      criterionId: 'crit-site-approach',
      topicId: 'site-approach-and-parking',
      title: 'Accessible Site Arrival & Pedestrian Approach Route',
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §206.2.1 (Site Arrival Points)'
          : 'Site Approach & Accessible Entry Path',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'project',
      targetId: project.id,
      targetName: project.name,
      status: 'insufficient-data',
      isMandatoryFromBrief: hasMandatoryBriefFlag,
      measuredValue: null,
      requiredValue: `Pedestrian path width >= ${formatMeasure(
        thresholds.minAccessibleRouteClearWidth,
        unit
      )} & slope <= 1:20 (or ramp <= 1:12)`,
      unit: unit === 'feet' ? 'ft' : 'm',
      inputProvenance: ['missing-unmodeled'],
      explanation:
        'No pedestrian site access point is modeled in Site Context, or exterior approach grading between site boundary/parking and building entry is unspecified.',
      missingInputsRequired: [
        'Pedestrian site access point width',
        'Exterior path running slope and cross slope to accessible entrance',
      ],
    });
  } else {
    const widestPed = Math.max(...sitePedestrianAccess.map((p) => p.width));
    const widthOk = widestPed >= thresholds.minAccessibleRouteClearWidth - 1e-3;
    const steepSite = siteSlope === 'moderate-5-to-10-pct' || siteSlope === 'steep-over-10-pct';

    let siteStatus: AccessibilityResultStatus = 'meets-configured-criterion';
    if (!widthOk) {
      siteStatus = 'does-not-meet-configured-criterion';
    } else if (steepSite && ramps.length === 0) {
      siteStatus = 'requires-human-review';
    }

    allCriterionResults.push({
      criterionId: 'crit-site-approach',
      topicId: 'site-approach-and-parking',
      title: 'Accessible Site Arrival & Pedestrian Approach Route',
      clauseOrRuleReference:
        activeProfile.profileId === 'us-ada-2010-standards'
          ? '2010 ADA Standards §206.2.1 (Site Arrival Points)'
          : 'Site Approach & Accessible Entry Path',
      ruleProfileId: activeProfile.profileId,
      targetScope: 'project',
      targetId: project.id,
      targetName: project.name,
      status: siteStatus,
      isMandatoryFromBrief: hasMandatoryBriefFlag,
      measuredValue: `${formatMeasure(widestPed, unit)} path width (topography: ${
        siteSlope || 'unspecified'
      })`,
      requiredValue: `>= ${formatMeasure(thresholds.minAccessibleRouteClearWidth, unit)} width`,
      unit: unit === 'feet' ? 'ft' : 'm',
      inputProvenance: ['measured-project-geometry'],
      explanation: !widthOk
        ? `Pedestrian site access point width (${formatMeasure(
            widestPed,
            unit
          )}) is narrower than minimum accessible route width (${formatMeasure(
            thresholds.minAccessibleRouteClearWidth,
            unit
          )}).`
        : steepSite && ramps.length === 0
        ? `Pedestrian access width (${formatMeasure(
            widestPed,
            unit
          )}) meets minimum width, but site topography is "${siteSlope}" without a modeled exterior accessible ramp. Human civil/grading review is required.`
        : `Pedestrian site access width (${formatMeasure(
            widestPed,
            unit
          )}) meets minimum width on flat/gentle site topography. Note: Accessible parking bay dimensions and drop-off aisle slopes remain unassessed unless civil grading is supplied.`,
    });
  }

  // 7. Build Multi-Dimensional Topic Coverage Inventory
  const topicDefinitions: Array<{
    topicId: AccessibilityTopicId;
    topicTitle: string;
    description: string;
    whatIsEvaluated: string[];
    whatRemainsUnassessed: string[];
  }> = [
    {
      topicId: 'mobility-turning-and-clear-floor',
      topicTitle: 'Mobility Turning & Clear Floor Spaces',
      description:
        'Exact continuous 2D evaluation of wheelchair turning circles (60 in / 1500 mm), T-shaped turning spaces, and stationary clear floor spaces (30×48 in / 800×1300 mm) at placed fixtures.',
      whatIsEvaluated: [
        'Exact maximum unobstructed inscribed turning circle diameter in every room',
        'T-shaped turning space fallback geometry in all 4 orientations',
        'Front approach and stationary clear floor space at placed furniture/fixtures',
      ],
      whatRemainsUnassessed: [
        'Floor surface firmness, stability, and slip resistance (coefficient of friction)',
        'Carpet pile height (<= 1/2 in / 13 mm) and exposed edge trim',
      ],
    },
    {
      topicId: 'accessible-routes-and-corridors',
      topicTitle: 'Accessible Routes & Horizontal Circulation',
      description:
        'Continuous path width and connectivity between building entry, corridors, and rooms.',
      whatIsEvaluated: [
        'Minimum continuous passage width inside rooms and corridors',
        'Room-to-room connectivity via recorded openings and P33 circulation routes',
        'Grid discretization resolution warnings where passage is near statutory limits',
      ],
      whatRemainsUnassessed: [
        'Protruding objects mounted on walls between 27 in and 80 in (685–2030 mm) AFF',
        'Headroom clearance below soffits or undersides of open stairs',
      ],
    },
    {
      topicId: 'doors-and-thresholds',
      topicTitle: 'Doors, Openings & Thresholds',
      description:
        'Doorway clear opening width (distinct from rough frame width), swing arc interference, pull/push maneuvering clearance, and threshold height.',
      whatIsEvaluated: [
        'Clear opening width vs nominal opening width',
        'Inward vs outward vs sliding door swing encroachment into turning spaces',
        'Pull-side latch clearance and doorway maneuvering clearance against furniture',
        'Threshold height where metadata is provided',
      ],
      whatRemainsUnassessed: [
        'Door opening force (e.g. <= 5 lbf / 22.2 N interior hinged doors)',
        'Door closer sweep speed (at least 5 seconds from 90° to 12°)',
        'Vision panel glazing viewing height',
      ],
    },
    {
      topicId: 'vertical-circulation-ramps-lifts-stairs',
      topicTitle: 'Vertical Circulation (Ramps, Lifts & Stairs)',
      description:
        'Multi-storey accessible connection, ramp running/cross slope and landings, lift/elevator cab dimensions, and stair safety.',
      whatIsEvaluated: [
        'Multi-storey floor-to-floor accessible connection (strictly distinguishing stairs from lifts/ramps)',
        'Modeled ramp running slope, cross slope, clear width, and landing length',
        'Modeled lift/elevator internal cab dimensions and door clear width',
        'Modeled stair clear width and handrail continuity',
      ],
      whatRemainsUnassessed: [
        'Handrail grip profile cross-section, extension returns, and structural load capacity',
        'Elevator car control panel call button layout and emergency two-way communication',
      ],
    },
    {
      topicId: 'sanitary-and-kitchen-fixtures',
      topicTitle: 'Sanitary & Kitchen Fixtures',
      description:
        'Bathroom and kitchen room turning spaces, doorway swing clearance, WC transfer space, grab bars, and sink/work-surface knee/toe clearance.',
      whatIsEvaluated: [
        'Bathroom and kitchen wheelchair turning space and door swing encroachment',
        'Fixture-level transfer space, grab bar provision, and knee/toe clearance when fixture metadata is supplied',
      ],
      whatRemainsUnassessed: [
        'Exact water closet centerline distance from side wall (16–18 in / 405–455 mm)',
        'Hot water supply and drain pipe insulation/protection under lavatories',
        'Mirror bottom edge mounting height and shower spray unit hose length',
      ],
    },
    {
      topicId: 'reach-ranges-and-operable-parts',
      topicTitle: 'Reach Ranges & Operable Controls',
      description:
        'Mounting heights (15–48 in / 400–1200 mm AFF), clear floor space, and single-hand operability for switches, outlets, and controls.',
      whatIsEvaluated: [
        'Modeled operable control mounting heights and clear floor space',
        'Single-hand operability without tight grasping, pinching, or twisting of the wrist',
      ],
      whatRemainsUnassessed: [
        'Unmodeled electrical switches, receptacles, circuit breakers, and window latches',
      ],
    },
    {
      topicId: 'wayfinding-tactile-and-signage',
      topicTitle: 'Wayfinding, Tactile & Signage',
      description:
        'Tactile raised characters, Grade 2 Braille signage, and visual luminance contrast for low-vision orientation.',
      whatIsEvaluated: [
        'Explicitly recorded tactile/Braille signage and high-contrast wayfinding provisions',
      ],
      whatRemainsUnassessed: [
        'Braille dome dimensions, character stroke width, and sign latch-side mounting height',
        'Light reflectance value (LRV) contrast between walls, doors, and floors',
      ],
    },
    {
      topicId: 'visual-audible-alarms-and-communication',
      topicTitle: 'Visual/Audible Alarms & Assistive Communication',
      description:
        'Visual strobe and audible emergency alarms, assistive listening loops, and two-way refuge communication.',
      whatIsEvaluated: [
        'Explicitly recorded visual/audible alarm and assistive listening provisions',
      ],
      whatRemainsUnassessed: [
        'Candela rating and flash synchronization of visual strobes',
        'Acoustic reverberation time (RT60) and ambient sound levels',
      ],
    },
    {
      topicId: 'site-approach-and-parking',
      topicTitle: 'Site Arrival, Approach & Accessible Parking',
      description:
        'Accessible exterior route from pedestrian site access points and topography screening.',
      whatIsEvaluated: [
        'Pedestrian site access point width and site slope screening from Site Context',
      ],
      whatRemainsUnassessed: [
        'Accessible parking stall dimensions, van access aisle width, and curb ramp flares',
      ],
    },
  ];

  const topicCoverage: AccessibilityTopicCoverageItem[] = topicDefinitions.map((def) => {
    const crits = allCriterionResults.filter((c) => c.topicId === def.topicId);
    const meetsCount = crits.filter((c) => c.status === 'meets-configured-criterion').length;
    const failsCount = crits.filter((c) => c.status === 'does-not-meet-configured-criterion').length;
    const warningCount = crits.filter((c) => c.status === 'warning').length;
    const unassessedOrInsufficientCount = crits.filter(
      (c) => c.status === 'unassessed' || c.status === 'insufficient-data'
    ).length;
    const requiresHumanReviewCount = crits.filter(
      (c) => c.status === 'requires-human-review'
    ).length;
    const notApplicableCount = crits.filter((c) => c.status === 'not-applicable').length;

    let coverageState: AccessibilityTopicCoverageItem['coverageState'] = 'evaluated';
    if (
      crits.length === 0 ||
      unassessedOrInsufficientCount + requiresHumanReviewCount === crits.length
    ) {
      coverageState = 'unassessed-missing-data';
    } else if (notApplicableCount === crits.length) {
      coverageState = 'not-applicable';
    } else if (unassessedOrInsufficientCount > 0 || requiresHumanReviewCount > 0) {
      coverageState = 'partially-evaluated';
    }

    return {
      topicId: def.topicId,
      topicTitle: def.topicTitle,
      description: def.description,
      coverageState,
      totalCriteriaCount: crits.length,
      meetsCount,
      failsCount,
      warningCount,
      unassessedOrInsufficientCount,
      requiresHumanReviewCount,
      whatIsEvaluated: def.whatIsEvaluated,
      whatRemainsUnassessed: def.whatRemainsUnassessed,
    };
  });

  // 8. Compute Summary Counts (strictly keeping unassessed/insufficient-data distinct from meetsConfiguredCriterion)
  const summaryCounts = {
    totalCriteria: allCriterionResults.length,
    meetsConfiguredCriterion: allCriterionResults.filter(
      (c) => c.status === 'meets-configured-criterion'
    ).length,
    doesNotMeetConfiguredCriterion: allCriterionResults.filter(
      (c) => c.status === 'does-not-meet-configured-criterion'
    ).length,
    warning: allCriterionResults.filter((c) => c.status === 'warning').length,
    unassessed: allCriterionResults.filter((c) => c.status === 'unassessed').length,
    insufficientData: allCriterionResults.filter((c) => c.status === 'insufficient-data').length,
    notApplicable: allCriterionResults.filter((c) => c.status === 'not-applicable').length,
    requiresHumanReview: allCriterionResults.filter(
      (c) => c.status === 'requires-human-review'
    ).length,
    mandatoryFailuresCount: allCriterionResults.filter(
      (c) => c.isMandatoryFromBrief && c.status === 'does-not-meet-configured-criterion'
    ).length,
  };

  let overallReviewState: UniversalAccessibilityEvaluationReport['overallReviewState'];
  if (summaryCounts.doesNotMeetConfiguredCriterion > 0) {
    overallReviewState = 'mandatory-or-configured-criteria-failing';
  } else if (summaryCounts.meetsConfiguredCriterion === 0) {
    overallReviewState = 'review-incomplete-insufficient-data';
  } else if (
    summaryCounts.unassessed > 0 ||
    summaryCounts.insufficientData > 0 ||
    summaryCounts.requiresHumanReview > 0
  ) {
    overallReviewState = 'meets-evaluated-criteria-with-unassessed-areas';
  } else {
    overallReviewState = 'all-evaluated-criteria-met';
  }

  const p30P32Alignment = inspectP30P32AccessibilityContext(project, roomStatusMap);

  const improvementSuggestions = generateAccessibilitySuggestions(
    project,
    roomDiagnostics,
    allCriterionResults,
    thresholds
  );

  const gridCell = unit === 'feet' ? '0.50 ft (6.0 in)' : '0.15 m (150 mm)';

  return {
    engineVersion: P34_ACCESSIBILITY_ENGINE_VERSION,
    evaluatedAt: new Date().toISOString(),
    sourceFingerprint: currentFingerprint,
    isStale,
    staleReasons,
    unit,
    activeRuleProfile: activeProfile,
    summaryCounts,
    overallReviewState,
    topicCoverage,
    roomDiagnostics,
    allCriterionResults,
    geometricOverlays,
    p30P32Alignment,
    improvementSuggestions,
    gridResolutionNotice: `Turning circles (${formatMeasure(
      thresholds.turningCircleDiameter,
      unit
    )}), T-turn spaces, doorway widths, and fixture clear floor spaces (${formatMeasure(
      thresholds.clearFloorSpaceWidth,
      unit
    )} × ${formatMeasure(
      thresholds.clearFloorSpaceLength,
      unit
    )}) are verified using exact continuous 2D geometry. P33 pathfinding uses a ${gridCell} grid cell resolution and is supplemented by exact obstacle gap checks.`,
    complianceBoundaryDisclaimer: activeProfile.statutoryDisclaimer,
  };
}

/**
 * Generates explainable, evidence-backed accessibility improvement suggestions.
 */
export function generateAccessibilitySuggestions(
  project: Project,
  roomDiagnostics: RoomAccessibilityDiagnostic[],
  allCriteria: AccessibilityCriterionResult[],
  thresholds: AccessibilityProfileThresholds
): AccessibilityImprovementSuggestion[] {
  const suggestions: AccessibilityImprovementSuggestion[] = [];
  const furnitureData = ensureProjectFurnitureLayoutData(project);
  const rooms = project.floorPlan?.rooms || [];
  const fixedObstacles = extractKnownFixedRoomObstacles(project);
  const unit = project.unit;

  for (const diag of roomDiagnostics) {
    const room = rooms.find((r) => r.id === diag.roomId);
    if (!room) continue;

    const roomInstances = furnitureData.instances.filter(
      (i) => i.roomId === room.id && i.floorLevel === room.floorLevel
    );
    const roomOpenings = furnitureData.knownOpenings.filter(
      (o) => o.roomId === room.id && o.floorLevel === room.floorLevel
    );
    const roomFixedObs = fixedObstacles.filter((fo) => fo.floorLevel === room.floorLevel);

    if (diag.turningSpaceStatus === 'does-not-meet-configured-criterion') {
      const emptyMax = Math.min(room.width, room.length);

      if (emptyMax < thresholds.turningCircleDiameter - 1e-3) {
        const neededW = Math.max(room.width, thresholds.turningCircleDiameter);
        const neededL = Math.max(room.length, thresholds.turningCircleDiameter);
        suggestions.push({
          suggestionId: `sug-expand-room-${room.id}`,
          title: `Advisory: Widen "${room.name}" to Accommodate ${formatMeasure(
            thresholds.turningCircleDiameter,
            unit
          )} Turning Circle`,
          targetRoomId: room.id,
          affectedCriterionIds: [`crit-turn-${room.id}`],
          actionType: 'expand-room-dimension-advisory',
          canAutoPreviewAndApply: false,
          rationale: `Room "${room.name}" measures ${formatMeasure(
            room.width,
            unit
          )} × ${formatMeasure(
            room.length,
            unit
          )}, which is structurally smaller than the required ${formatMeasure(
            thresholds.turningCircleDiameter,
            unit
          )} turning diameter even with zero furniture placed.`,
          expectedAccessibilityImprovement: `Expanding "${room.name}" to at least ${formatMeasure(
            neededW,
            unit
          )} × ${formatMeasure(
            neededL,
            unit
          )} in the 2D Floor Plan Editor will allow a full ${formatMeasure(
            thresholds.turningCircleDiameter,
            unit
          )} wheelchair turning circle.`,
          tradeOffsAndDownstreamImpact: [
            'Requires moving room partition walls in the 2D Floor Plan Editor',
            'May reduce adjacent room area or increase gross building footprint',
          ],
          proposedMutationSummary: `Manual 2D Plan edit required: resize "${room.name}" from ${formatMeasure(
            room.width,
            unit
          )}×${formatMeasure(room.length, unit)} to >= ${formatMeasure(
            neededW,
            unit
          )}×${formatMeasure(neededL, unit)}.`,
        });
      } else {
        const inwardDoors = roomOpenings.filter(
          (o) => o.swingDirection === 'inward-left' || o.swingDirection === 'inward-right'
        );
        for (const inDoor of inwardDoors) {
          suggestions.push({
            suggestionId: `sug-flip-door-${inDoor.openingId}`,
            title: `Reverse Inward Door Swing on "${room.name}" (${inDoor.wallEdge} wall) to Outward`,
            targetRoomId: room.id,
            targetElementId: inDoor.openingId,
            affectedCriterionIds: [`crit-turn-${room.id}`, `crit-door-${inDoor.openingId}`],
            actionType: 'flip-inward-door-swing-outward',
            canAutoPreviewAndApply: true,
            rationale: `Doorway "${inDoor.openingId}" currently swings inward into "${room.name}", encroaching on the interior wheelchair turning space and fixture clearance.`,
            expectedAccessibilityImprovement: `Reversing "${inDoor.openingId}" to swing outward removes the door swing arc from the interior of "${room.name}" and increases usable turning space.`,
            tradeOffsAndDownstreamImpact: [
              'Outward-swinging door requires unobstructed maneuvering clearance on the exterior/corridor side',
            ],
            proposedMutationSummary: `Set swingDirection of opening "${inDoor.openingId}" from '${inDoor.swingDirection}' to 'outward'.`,
            mutationPayload: {
              openingId: inDoor.openingId,
              proposedSwingDirection: 'outward',
            },
          });
        }

        for (const inst of roomInstances) {
          const otherBoxes: AABBRect[] = [];
          for (const other of roomInstances) {
            if (other.instanceId === inst.instanceId) continue;
            otherBoxes.push(getInstanceFootprintRect(other, unit));
          }
          for (const fo of roomFixedObs) {
            otherBoxes.push({ x: fo.x, y: fo.y, width: fo.width, length: fo.depth });
          }
          for (const op of roomOpenings) {
            const g = getKnownOpeningZones(room, op, furnitureData.clearanceThresholds);
            if (g.swingZone) otherBoxes.push(g.swingZone);
          }

          const candidatePositions: Array<{ x: number; y: number; rot: 0 | 90 | 180 | 270 }> = [
            { x: room.x, y: room.y, rot: 0 },
            { x: room.x + room.width - inst.width, y: room.y, rot: 0 },
            { x: room.x, y: room.y + room.length - inst.depth, rot: 180 },
            { x: room.x + room.width - inst.width, y: room.y + room.length - inst.depth, rot: 180 },
            { x: room.x, y: room.y, rot: 270 },
            { x: room.x + room.width - inst.depth, y: room.y, rot: 90 },
          ];

          let foundReposition = false;
          for (const cand of candidatePositions) {
            const testInst = {
              ...inst,
              x: round2(cand.x),
              y: round2(cand.y),
              rotationDeg: cand.rot,
            };
            const foot = getInstanceFootprintRect(testInst, unit);
            if (!isRectInsideRoom(foot, getRoomBoundsRect(room))) continue;
            if (otherBoxes.some((b) => rectsOverlapStrict(foot, b))) continue;

            const turnCheck = findMaxInscribedTurningCircle(
              room,
              [...otherBoxes, foot],
              thresholds.turningCircleDiameter
            );
            if (turnCheck.meetsTarget) {
              foundReposition = true;
              suggestions.push({
                suggestionId: `sug-reposition-furn-${inst.instanceId}`,
                title: `Reposition "${inst.name}" in "${room.name}" to Restore ${formatMeasure(
                  thresholds.turningCircleDiameter,
                  unit
                )} Turning Space`,
                targetRoomId: room.id,
                targetElementId: inst.instanceId,
                affectedCriterionIds: [`crit-turn-${room.id}`, `crit-cfs-${inst.instanceId}`],
                actionType: 'reposition-blocking-furniture',
                canAutoPreviewAndApply: true,
                rationale: `"${inst.name}" at (${round2(inst.x)}, ${round2(
                  inst.y
                )}) obstructs the center of "${room.name}", reducing the turning circle to ${formatMeasure(
                  diag.maxClearInscribedCircleDiameter,
                  unit
                )}.`,
                expectedAccessibilityImprovement: `Moving "${inst.name}" to (${round2(
                  cand.x
                )}, ${round2(cand.y)}) restores a full ${formatMeasure(
                  turnCheck.maxDiameter,
                  unit
                )} unobstructed wheelchair turning space.`,
                tradeOffsAndDownstreamImpact: [
                  'Re-orients furniture against room perimeter wall',
                  'Preserves all room walls and structural dimensions unchanged',
                ],
                proposedMutationSummary: `Move "${inst.name}" from (${round2(inst.x)}, ${round2(
                  inst.y
                )}) to (${round2(cand.x)}, ${round2(cand.y)}) with rotation ${cand.rot}°.`,
                mutationPayload: {
                  furnitureInstanceId: inst.instanceId,
                  proposedFurnitureX: round2(cand.x),
                  proposedFurnitureY: round2(cand.y),
                  proposedFurnitureRotation: cand.rot,
                },
              });
              break;
            }
          }

          if (!foundReposition) {
            const turnWithoutInst = findMaxInscribedTurningCircle(
              room,
              otherBoxes,
              thresholds.turningCircleDiameter
            );
            if (turnWithoutInst.meetsTarget) {
              suggestions.push({
                suggestionId: `sug-remove-furn-${inst.instanceId}`,
                title: `Remove "${inst.name}" from "${room.name}" to Clear ${formatMeasure(
                  thresholds.turningCircleDiameter,
                  unit
                )} Turning Circle`,
                targetRoomId: room.id,
                targetElementId: inst.instanceId,
                affectedCriterionIds: [`crit-turn-${room.id}`, `crit-cfs-${inst.instanceId}`],
                actionType: 'remove-blocking-furniture',
                canAutoPreviewAndApply: true,
                rationale: `Floor area in "${room.name}" cannot simultaneously accommodate "${inst.name}" (${formatMeasure(
                  inst.width,
                  unit
                )}×${formatMeasure(inst.depth, unit)}) and a ${formatMeasure(
                  thresholds.turningCircleDiameter,
                  unit
                )} wheelchair turning space.`,
                expectedAccessibilityImprovement: `Removing "${inst.name}" restores a ${formatMeasure(
                  turnWithoutInst.maxDiameter,
                  unit
                )} unobstructed turning circle in "${room.name}".`,
                tradeOffsAndDownstreamImpact: [
                  `Reduces placed furniture count in "${room.name}" by 1 item ("${inst.name}")`,
                ],
                proposedMutationSummary: `Remove placed furniture instance "${inst.name}" (${inst.instanceId}) from "${room.name}".`,
                mutationPayload: {
                  removeFurnitureInstanceId: inst.instanceId,
                },
              });
            }
          }
        }
      }
    }

    for (const op of roomOpenings) {
      const doorCrit = allCriteria.find((c) => c.criterionId === `crit-door-${op.openingId}`);
      if (!doorCrit || doorCrit.status !== 'does-not-meet-configured-criterion') continue;

      const leafDeduction = unit === 'feet' ? 0.17 : 0.05;
      const targetClearWidth = thresholds.minDoorClearOpeningWidth;
      const neededNominalWidth = round2(targetClearWidth + leafDeduction);
      const wallSpan =
        op.wallEdge === 'north' || op.wallEdge === 'south' ? room.width : room.length;

      if (op.width < neededNominalWidth && wallSpan >= neededNominalWidth + 0.5) {
        suggestions.push({
          suggestionId: `sug-widen-door-${op.openingId}`,
          title: `Widen Doorway "${op.openingId}" in "${room.name}" to ${formatMeasure(
            targetClearWidth,
            unit
          )} Clear Width`,
          targetRoomId: room.id,
          targetElementId: op.openingId,
          affectedCriterionIds: [`crit-door-${op.openingId}`],
          actionType: 'widen-door-opening-record',
          canAutoPreviewAndApply: true,
          rationale: `Doorway "${op.openingId}" currently has nominal width ${formatMeasure(
            op.width,
            unit
          )}, yielding less than the required ${formatMeasure(
            targetClearWidth,
            unit
          )} clear opening width.`,
          expectedAccessibilityImprovement: `Updating doorway "${op.openingId}" nominal width to ${formatMeasure(
            neededNominalWidth,
            unit
          )} and verified clear opening width to ${formatMeasure(
            targetClearWidth,
            unit
          )} satisfies doorway clear width requirements.`,
          tradeOffsAndDownstreamImpact: [
            `Increases doorway structural rough opening along ${op.wallEdge} wall of "${room.name}"`,
          ],
          proposedMutationSummary: `Update opening "${op.openingId}" nominal width to ${formatMeasure(
            neededNominalWidth,
            unit
          )} and verified clear width to ${formatMeasure(targetClearWidth, unit)}.`,
          mutationPayload: {
            openingId: op.openingId,
            proposedOpeningWidth: neededNominalWidth,
            proposedClearOpeningWidth: targetClearWidth,
          },
        });
      }
    }
  }

  return suggestions;
}

/**
 * Applies a suggestion's mutation payload to a deep-cloned Project copy in memory.
 */
function applySuggestionMutationToClonedProject(
  project: Project,
  suggestion: AccessibilityImprovementSuggestion
): Project {
  const cloned: Project = JSON.parse(JSON.stringify(project));
  const furniture = ensureProjectFurnitureLayoutData(cloned);
  const review = ensureProjectAccessibilityReviewData(cloned);
  const payload = suggestion.mutationPayload;

  if (!payload) {
    return cloned;
  }

  if (
    payload.furnitureInstanceId &&
    typeof payload.proposedFurnitureX === 'number' &&
    typeof payload.proposedFurnitureY === 'number'
  ) {
    furniture.instances = furniture.instances.map((inst) =>
      inst.instanceId === payload.furnitureInstanceId
        ? {
            ...inst,
            x: payload.proposedFurnitureX!,
            y: payload.proposedFurnitureY!,
            rotationDeg: payload.proposedFurnitureRotation ?? inst.rotationDeg,
            updatedAt: new Date().toISOString(),
          }
        : inst
    );
  }

  if (payload.removeFurnitureInstanceId) {
    furniture.instances = furniture.instances.filter(
      (inst) => inst.instanceId !== payload.removeFurnitureInstanceId
    );
  }

  if (payload.openingId) {
    if (typeof payload.proposedOpeningWidth === 'number') {
      furniture.knownOpenings = furniture.knownOpenings.map((op) =>
        op.openingId === payload.openingId
          ? {
              ...op,
              width: payload.proposedOpeningWidth!,
            }
          : op
      );
    }
    if (payload.proposedSwingDirection) {
      furniture.knownOpenings = furniture.knownOpenings.map((op) =>
        op.openingId === payload.openingId
          ? {
              ...op,
              swingDirection: payload.proposedSwingDirection!,
            }
          : op
      );
    }
    if (typeof payload.proposedClearOpeningWidth === 'number') {
      const existingMeta = review.elements.doorDetails[payload.openingId];
      review.elements.doorDetails[payload.openingId] = {
        ...(existingMeta || {}),
        openingId: payload.openingId,
        clearOpeningWidth: payload.proposedClearOpeningWidth,
        provenance: 'user-entered',
        updatedAt: new Date().toISOString(),
      };
    }
  }

  cloned.furnitureLayout = furniture;
  cloned.accessibilityReview = review;
  return cloned;
}

/**
 * Non-destructive preview of an accessibility improvement suggestion.
 */
export function previewAccessibilitySuggestion(
  project: Project,
  suggestionId: string
): AccessibilitySuggestionPreview {
  const beforeReport = evaluateUniversalAccessibility(project);
  const suggestion = beforeReport.improvementSuggestions.find(
    (s) => s.suggestionId === suggestionId
  );

  if (!suggestion || !suggestion.canAutoPreviewAndApply) {
    return {
      suggestionId,
      suggestionTitle: suggestion?.title || 'Advisory Suggestion (Manual Edit Required)',
      evaluatedAt: new Date().toISOString(),
      beforeSummary: {
        meetsCount: beforeReport.summaryCounts.meetsConfiguredCriterion,
        failsCount: beforeReport.summaryCounts.doesNotMeetConfiguredCriterion,
        warningCount: beforeReport.summaryCounts.warning,
        unassessedOrInsufficientCount:
          beforeReport.summaryCounts.unassessed + beforeReport.summaryCounts.insufficientData,
      },
      afterSummary: {
        meetsCount: beforeReport.summaryCounts.meetsConfiguredCriterion,
        failsCount: beforeReport.summaryCounts.doesNotMeetConfiguredCriterion,
        warningCount: beforeReport.summaryCounts.warning,
        unassessedOrInsufficientCount:
          beforeReport.summaryCounts.unassessed + beforeReport.summaryCounts.insufficientData,
      },
      resolvedCriterionIds: [],
      newlyIntroducedFailureIds: [],
      netFailureDelta: 0,
      isSafeToApply: false,
      previewNotes: [
        suggestion
          ? 'This suggestion is an architectural geometry advisory and requires explicit wall resizing in the 2D Floor Plan Editor.'
          : `Suggestion "${suggestionId}" was not found.`,
      ],
      proposedProjectState: {},
    };
  }

  const proposedProject = applySuggestionMutationToClonedProject(project, suggestion);
  const afterReport = evaluateUniversalAccessibility(proposedProject);

  const beforeFails = new Set(
    beforeReport.allCriterionResults
      .filter((c) => c.status === 'does-not-meet-configured-criterion')
      .map((c) => c.criterionId)
  );
  const afterFails = new Set(
    afterReport.allCriterionResults
      .filter((c) => c.status === 'does-not-meet-configured-criterion')
      .map((c) => c.criterionId)
  );

  const resolvedCriterionIds: string[] = [];
  for (const id of beforeFails) {
    if (!afterFails.has(id)) {
      resolvedCriterionIds.push(id);
    }
  }

  const newlyIntroducedFailureIds: string[] = [];
  for (const id of afterFails) {
    if (!beforeFails.has(id)) {
      newlyIntroducedFailureIds.push(id);
    }
  }

  const netFailureDelta =
    afterReport.summaryCounts.doesNotMeetConfiguredCriterion -
    beforeReport.summaryCounts.doesNotMeetConfiguredCriterion;

  const isSafeToApply =
    newlyIntroducedFailureIds.length === 0 && resolvedCriterionIds.length > 0;

  return {
    suggestionId: suggestion.suggestionId,
    suggestionTitle: suggestion.title,
    evaluatedAt: new Date().toISOString(),
    beforeSummary: {
      meetsCount: beforeReport.summaryCounts.meetsConfiguredCriterion,
      failsCount: beforeReport.summaryCounts.doesNotMeetConfiguredCriterion,
      warningCount: beforeReport.summaryCounts.warning,
      unassessedOrInsufficientCount:
        beforeReport.summaryCounts.unassessed + beforeReport.summaryCounts.insufficientData,
    },
    afterSummary: {
      meetsCount: afterReport.summaryCounts.meetsConfiguredCriterion,
      failsCount: afterReport.summaryCounts.doesNotMeetConfiguredCriterion,
      warningCount: afterReport.summaryCounts.warning,
      unassessedOrInsufficientCount:
        afterReport.summaryCounts.unassessed + afterReport.summaryCounts.insufficientData,
    },
    resolvedCriterionIds,
    newlyIntroducedFailureIds,
    netFailureDelta,
    isSafeToApply,
    previewNotes: [
      `Non-destructive preview evaluated on cloned project state.`,
      `Resolved criteria: ${resolvedCriterionIds.length} (${resolvedCriterionIds.join(', ') || 'none'}).`,
      `Newly introduced failures: ${newlyIntroducedFailureIds.length}.`,
    ],
    proposedProjectState: {
      furnitureLayout: proposedProject.furnitureLayout,
      accessibilityReview: proposedProject.accessibilityReview,
    },
  };
}

/**
 * Safely applies a confirmed accessibility suggestion after creating a pre-apply project snapshot.
 */
export function applyAccessibilitySuggestionSafely(
  project: Project,
  suggestionId: string
): {
  updatedProject: Project;
  snapshotId: string;
  preview: AccessibilitySuggestionPreview;
  postApplyReport: UniversalAccessibilityEvaluationReport;
} {
  const preview = previewAccessibilitySuggestion(project, suggestionId);
  if (!preview.isSafeToApply) {
    throw new Error(
      `Cannot auto-apply suggestion "${suggestionId}": preview indicates it is either advisory-only or does not cleanly resolve accessibility failures.`
    );
  }

  const snapshotRecord = createProjectSnapshot(project, {
    trigger: 'auto-checkpoint',
    label: `P34 Pre-Accessibility Suggestion (${suggestionId})`,
    description: `Automatic pre-application checkpoint before applying P34 suggestion "${preview.suggestionTitle}".`,
  });
  memoryAccessibilitySnapshots.set(snapshotRecord.id, JSON.parse(JSON.stringify(project)));

  const beforeReport = evaluateUniversalAccessibility(project);
  const suggestion = beforeReport.improvementSuggestions.find(
    (s) => s.suggestionId === suggestionId
  )!;

  const updatedProject = applySuggestionMutationToClonedProject(project, suggestion);
  const postApplyReport = evaluateUniversalAccessibility(updatedProject);

  const review = ensureProjectAccessibilityReviewData(updatedProject);
  review.lastPreApplySnapshotId = snapshotRecord.id;
  review.lastEvaluatedAt = postApplyReport.evaluatedAt;
  review.lastSourceFingerprint = postApplyReport.sourceFingerprint;
  review.requestSequenceId = (project.accessibilityReview?.requestSequenceId || 1) + 1;

  updatedProject.accessibilityReview = review;
  updatedProject.updatedAt = new Date().toISOString();

  return {
    updatedProject,
    snapshotId: snapshotRecord.id,
    preview,
    postApplyReport,
  };
}

/**
 * Saves updated ProjectAccessibilityReviewData safely with snapshot creation and monotonic requestSequenceId.
 */
export function saveProjectAccessibilityReviewSafely(
  project: Project,
  nextReviewData: ProjectAccessibilityReviewData,
  createCheckpoint = true
): {
  updatedProject: Project;
  snapshotId?: string;
  report: UniversalAccessibilityEvaluationReport;
} {
  let snapshotId: string | undefined = nextReviewData.lastPreApplySnapshotId;
  if (createCheckpoint) {
    const snap = createProjectSnapshot(project, {
      trigger: 'auto-checkpoint',
      label: 'P34 Accessibility Review Update',
      description: 'Checkpoint prior to saving P34 accessibility configuration.',
    });
    snapshotId = snap.id;
    memoryAccessibilitySnapshots.set(snap.id, JSON.parse(JSON.stringify(project)));
  }

  const nextSeq = Math.max(
    (project.accessibilityReview?.requestSequenceId || 0) + 1,
    nextReviewData.requestSequenceId || 1
  );

  const candidateProject: Project = {
    ...project,
    accessibilityReview: {
      ...nextReviewData,
      lastPreApplySnapshotId: snapshotId,
      requestSequenceId: nextSeq,
    },
  };

  const report = evaluateUniversalAccessibility(candidateProject);
  candidateProject.accessibilityReview!.lastEvaluatedAt = report.evaluatedAt;
  candidateProject.accessibilityReview!.lastSourceFingerprint = report.sourceFingerprint;
  candidateProject.updatedAt = new Date().toISOString();

  return {
    updatedProject: candidateProject,
    snapshotId,
    report,
  };
}

/**
 * Rolls back accessibility/furniture changes to a previous snapshot.
 */
export function rollbackAccessibilityChanges(
  project: Project,
  snapshotId?: string
): Project {
  const targetId = snapshotId || project.accessibilityReview?.lastPreApplySnapshotId;
  if (!targetId) {
    throw new Error('No pre-apply snapshot ID available for accessibility rollback.');
  }

  const snapshots = getProjectSnapshots(project);
  const found = snapshots.find((s) => s.id === targetId);
  if (found) {
    const restoreResult = executeSafeRestore(project, found);
    if (restoreResult.restoredProject) {
      return restoreResult.restoredProject;
    }
  }

  const memSnap = memoryAccessibilitySnapshots.get(targetId);
  if (memSnap) {
    return JSON.parse(JSON.stringify(memSnap));
  }

  throw new Error(`Snapshot "${targetId}" could not be located for rollback.`);
}

/**
 * Produces a read-only summary of P34 accessibility findings for P31 Multi-Option Design Comparison.
 */
export function getP34SummaryForOptionComparison(
  project: Project,
  optionId = 'baseline',
  optionName = project.name
): P34OptionComparisonSummary {
  const report = evaluateUniversalAccessibility(project);
  const roomsWithTurningCircleCount = report.roomDiagnostics.filter(
    (d) => d.turningSpaceStatus === 'meets-configured-criterion'
  ).length;

  const multiStoreyCrit = report.allCriterionResults.find(
    (c) => c.criterionId === 'crit-vertical-multistorey-connection'
  );
  const hasMultiStoreyVerticalAccessGap = Boolean(
    multiStoreyCrit &&
      (multiStoreyCrit.status === 'does-not-meet-configured-criterion' ||
        multiStoreyCrit.status === 'insufficient-data')
  );

  let overallStatusBadge: P34OptionComparisonSummary['overallStatusBadge'];
  if (report.summaryCounts.mandatoryFailuresCount > 0) {
    overallStatusBadge = 'Mandatory Accessibility Conflict';
  } else if (report.summaryCounts.doesNotMeetConfiguredCriterion > 0) {
    overallStatusBadge = 'Fails Configured Accessibility Criteria';
  } else if (report.summaryCounts.meetsConfiguredCriterion === 0) {
    overallStatusBadge = 'Insufficient Data for Review';
  } else {
    overallStatusBadge = 'Evaluated Criteria Met (Unassessed Topics Remain)';
  }

  const caveats: string[] = [];
  const unassessedTotal =
    report.summaryCounts.unassessed + report.summaryCounts.insufficientData;
  if (unassessedTotal > 0) {
    caveats.push(
      `${unassessedTotal} criteria remain unassessed or lack input data (e.g., operable control heights, tactile signage, visual alarms, or unmodeled fixture details) and are NOT counted as passing.`
    );
  }
  if (hasMultiStoreyVerticalAccessGap) {
    caveats.push(
      'Multi-storey layout lacks a modeled elevator/lift or floor-to-floor ramp; stairs alone do not provide wheelchair vertical access.'
    );
  }
  caveats.push(`Evaluated under profile: ${report.activeRuleProfile.name}.`);

  return {
    optionId,
    optionName,
    activeRuleProfileName: report.activeRuleProfile.name,
    meetsCount: report.summaryCounts.meetsConfiguredCriterion,
    failsCount: report.summaryCounts.doesNotMeetConfiguredCriterion,
    warningCount: report.summaryCounts.warning,
    unassessedOrInsufficientCount: unassessedTotal,
    requiresHumanReviewCount: report.summaryCounts.requiresHumanReview,
    mandatoryFailuresCount: report.summaryCounts.mandatoryFailuresCount,
    roomsWithTurningCircleCount,
    totalRoomsEvaluated: report.roomDiagnostics.length,
    hasMultiStoreyVerticalAccessGap,
    overallStatusBadge,
    caveats,
  };
}
