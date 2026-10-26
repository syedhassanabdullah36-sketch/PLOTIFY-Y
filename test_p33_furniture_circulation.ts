/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P33 — Furniture & Circulation Intelligence Verification Suite
 * Account A | Locked Roadmap: P33 of P30–P40
 *
 * Covers Section 16 (A–E) of Prompt 33:
 * A. Furniture Catalog & Instance Unit Tests
 * B. Geometric Validation Tests (Collisions, Room Boundary Overflows, Known Door Swings, Missing Door Honesty, Fixed Structural Columns)
 * C. Circulation & Route Analysis Tests (Grid Pathfinding, Narrow Pinch Detection, Complete Blockage, Insufficient Data)
 * D. Suggestion & Integration Tests (P30/P32 Confirmed-Only Context, P31 Comparison Summary Export, Non-Destructive Preview & Apply)
 * E. Failure Injection & Recovery Tests (Invalid Dimensions, Invalid Room/Floor, Snapshot Creation & Rollback, Unchanged Room Geometry)
 */

import { INITIAL_SAMPLE_PROJECTS } from './src/services/storage';
import { Project } from './src/types/project';
import {
  P33_FURNITURE_ENGINE_VERSION,
  KnownRoomOpening,
} from './src/types/furnitureIntelligence';
import {
  STARTER_FURNITURE_CATALOG,
  convertMeasurement,
  getDefaultClearanceThresholds,
  ensureProjectFurnitureLayoutData,
  getAllCatalogTemplates,
  createPlacedFurnitureInstance,
  moveFurnitureInstance,
  rotateFurnitureInstance,
  resizeFurnitureInstance,
  duplicateFurnitureInstance,
  getInstanceFootprintRect,
  validateFurnitureLayout,
  evaluateSingleCirculationRoute,
  evaluateRoomCirculationAndRoutes,
  generateFurnitureLayoutSuggestions,
  previewFurnitureSuggestion,
  applyFurnitureSuggestionWithConfirmation,
  saveProjectFurnitureLayoutSafely,
  rollbackProjectFurnitureLayout,
  evaluateFurnitureIntelligence,
  getP33MetricsForOptionComparison,
} from './src/services/furnitureIntelligenceService';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[P33 ASSERTION FAILED] ${message}`);
  }
}

async function runP33Verification() {
  console.log('================================================================');
  console.log('P33 — FURNITURE & CIRCULATION INTELLIGENCE VERIFICATION SUITE');
  console.log(`Engine Version: ${P33_FURNITURE_ENGINE_VERSION}`);
  console.log('================================================================\n');

  const baseProject: Project = JSON.parse(
    JSON.stringify(INITIAL_SAMPLE_PROJECTS[0])
  );
  assert(
    Boolean(baseProject.floorPlan && baseProject.floorPlan.rooms.length > 0),
    'Sample project must have 2D floorPlan rooms'
  );

  const rooms = baseProject.floorPlan!.rooms;
  const firstRoom = rooms[0]; // e.g., Living Room (0, 0, 18x14 ft)
  const secondRoom = rooms[1]; // e.g., Dining Room

  // ---------------------------------------------------------------------------
  // A. FURNITURE CATALOG & INSTANCE UNIT TESTS
  // ---------------------------------------------------------------------------
  console.log('--- Section A: Furniture Catalog & Instance Unit Tests ---');

  assert(
    STARTER_FURNITURE_CATALOG.length >= 12,
    'Starter catalog must include templates across all 8 required categories'
  );
  const categoriesPresent = new Set(
    STARTER_FURNITURE_CATALOG.map((t) => t.category)
  );
  const requiredCategories = [
    'sleeping',
    'seating-living',
    'dining',
    'work-office',
    'storage-cabinetry',
    'kitchen-casework',
    'bathroom-fixtures',
    'utility-laundry',
  ];
  for (const cat of requiredCategories) {
    assert(
      categoriesPresent.has(cat as any),
      `Starter catalog must include category "${cat}"`
    );
  }

  for (const tpl of STARTER_FURNITURE_CATALOG) {
    assert(
      tpl.provenance === 'illustrative-template-default',
      `Template ${tpl.templateId} must carry 'illustrative-template-default' provenance`
    );
    assert(
      tpl.defaultDimensionsFeet.width > 0 &&
        tpl.defaultDimensionsFeet.depth > 0 &&
        tpl.defaultDimensionsMetres.width > 0 &&
        tpl.defaultDimensionsMetres.depth > 0,
      `Template ${tpl.templateId} must have positive dimensions in both feet and metres`
    );
  }

  // Unit conversion consistency
  const tenFeetInMetres = convertMeasurement(10, 'feet', 'metres');
  assert(
    Math.abs(tenFeetInMetres - 3.048) < 0.01,
    `10 feet should convert to ~3.048 metres, got ${tenFeetInMetres}`
  );
  const backToFeet = convertMeasurement(tenFeetInMetres, 'metres', 'feet');
  assert(
    Math.abs(backToFeet - 10) < 0.02,
    `Round-trip unit conversion should return ~10 feet, got ${backToFeet}`
  );

  // Template vs Instance separation
  const sofaTemplate = STARTER_FURNITURE_CATALOG.find(
    (t) => t.templateId === 'tpl-sofa-3seat'
  )!;
  const placedSofa = createPlacedFurnitureInstance({
    project: baseProject,
    template: sofaTemplate,
    roomId: firstRoom.id,
    x: firstRoom.x + 1,
    y: firstRoom.y + 1,
  });

  const resizedSofa = resizeFurnitureInstance(placedSofa, 8.5, 3.5);
  assert(
    resizedSofa.width === 8.5 && resizedSofa.depth === 3.5,
    'Resized instance must update width and depth'
  );
  assert(
    resizedSofa.dimensionProvenance === 'user-edited-custom',
    'Resized instance must update provenance to user-edited-custom'
  );
  assert(
    sofaTemplate.defaultDimensionsFeet.width === 7.0,
    'Resizing an instance must NEVER mutate the underlying catalog template'
  );

  // Rotation & oriented footprint bounding box
  const rotatedSofa90 = rotateFurnitureInstance(placedSofa, 90);
  const rect0 = getInstanceFootprintRect(placedSofa, 'feet');
  const rect90 = getInstanceFootprintRect(rotatedSofa90, 'feet');
  assert(
    rect0.width === 7.0 && rect0.length === 3.0,
    '0-deg sofa footprint should be 7.0 x 3.0 ft'
  );
  assert(
    rect90.width === 3.0 && rect90.length === 7.0,
    '90-deg rotated sofa footprint should swap to 3.0 x 7.0 ft'
  );

  // Duplication
  const dupSofa = duplicateFurnitureInstance(placedSofa, 2.0, 1.5);
  assert(
    dupSofa.instanceId !== placedSofa.instanceId &&
      dupSofa.x === placedSofa.x + 2.0 &&
      dupSofa.y === placedSofa.y + 1.5,
    'Duplicated instance must have distinct ID and offset coordinates'
  );
  console.log('✓ Section A passed (Catalog, units, rotation, template/instance isolation)\n');

  // ---------------------------------------------------------------------------
  // B. GEOMETRIC VALIDATION TESTS
  // ---------------------------------------------------------------------------
  console.log('--- Section B: Geometric Validation Tests ---');

  const thresholds = getDefaultClearanceThresholds(baseProject.unit);

  // B1. Valid placement inside room bounds
  const validDiags = validateFurnitureLayout({
    project: baseProject,
    instances: [placedSofa],
    knownOpenings: [],
    thresholds,
  });
  assert(
    !validDiags.some(
      (d) =>
        d.category === 'furniture-collision' ||
        d.category === 'room-boundary-overflow'
    ),
    'Valid sofa placement inside room should have 0 collisions and 0 boundary overflows'
  );

  // B2. Honest missing door opening disclosure (NEVER fabricate door locations)
  assert(
    validDiags.some(
      (d) =>
        d.category === 'missing-opening-or-route-data' &&
        d.severity === 'unavailable' &&
        d.isCompleteData === false &&
        d.missingInputs.includes('room.knownOpenings')
    ),
    'When room has no knownOpenings, validator must report missing-opening-or-route-data instead of fabricating doors'
  );

  // B3. Furniture-to-furniture collision on same floor vs different floor
  const overlappingChair = createPlacedFurnitureInstance({
    project: baseProject,
    template: STARTER_FURNITURE_CATALOG.find(
      (t) => t.templateId === 'tpl-armchair'
    )!,
    roomId: firstRoom.id,
    x: placedSofa.x + 1.0,
    y: placedSofa.y + 0.5,
  });
  const collisionDiags = validateFurnitureLayout({
    project: baseProject,
    instances: [placedSofa, overlappingChair],
    knownOpenings: [],
    thresholds,
  });
  const pairCollision = collisionDiags.find(
    (d) => d.category === 'furniture-collision'
  );
  assert(
    Boolean(pairCollision && pairCollision.severity === 'conflict'),
    'Overlapping furniture on the same floor must trigger a furniture-collision conflict'
  );

  // Different floor should NOT collide
  const upperFloorRoom = rooms.find((r) => r.floorLevel === 2);
  if (upperFloorRoom) {
    const upperSofa = {
      ...overlappingChair,
      instanceId: 'furn-upper-test',
      roomId: upperFloorRoom.id,
      floorLevel: 2,
      x: placedSofa.x,
      y: placedSofa.y,
    };
    const crossFloorDiags = validateFurnitureLayout({
      project: baseProject,
      instances: [placedSofa, upperSofa],
      knownOpenings: [],
      thresholds,
    });
    assert(
      !crossFloorDiags.some((d) => d.category === 'furniture-collision'),
      'Furniture at identical X/Y on different floor levels must NOT collide'
    );
  }

  // B4. Room boundary overflow
  const overflowingSofa = moveFurnitureInstance(
    placedSofa,
    firstRoom.x + firstRoom.width - 2.0,
    firstRoom.y + 1.0
  );
  const boundaryDiags = validateFurnitureLayout({
    project: baseProject,
    instances: [overflowingSofa],
    knownOpenings: [],
    thresholds,
  });
  assert(
    boundaryDiags.some(
      (d) =>
        d.category === 'room-boundary-overflow' && d.severity === 'conflict'
    ),
    'Furniture extending past room wall must trigger room-boundary-overflow conflict'
  );

  // B5. Known door opening & inward door-swing obstruction
  const knownSouthDoor: KnownRoomOpening = {
    openingId: 'door-living-south',
    roomId: firstRoom.id,
    floorLevel: firstRoom.floorLevel,
    type: 'door',
    label: 'Living South Entry Door',
    wallEdge: 'south',
    offsetAlongWall: 3.0,
    width: 3.0,
    swingDirection: 'inward-left',
    swingDepth: 3.0,
    provenance: 'user-entered',
  };
  const doorBlockingSofa = moveFurnitureInstance(
    placedSofa,
    firstRoom.x + 2.0,
    firstRoom.y + firstRoom.length - 3.5
  );
  const doorDiags = validateFurnitureLayout({
    project: baseProject,
    instances: [doorBlockingSofa],
    knownOpenings: [knownSouthDoor],
    thresholds,
  });
  assert(
    doorDiags.some(
      (d) =>
        (d.category === 'door-swing-obstruction' ||
          d.category === 'door-opening-obstruction') &&
        d.affectedOpeningId === 'door-living-south'
    ),
    'Furniture placed inside known inward door-swing zone must trigger door-swing-obstruction conflict'
  );

  // B6. Fixed structural column collision
  const projectWithColumn: Project = {
    ...baseProject,
    structuralCoordination: {
      ...(baseProject.structuralCoordination as any),
      columns: [
        {
          id: 'col-test-1',
          x: firstRoom.x + 2.0,
          y: firstRoom.y + 2.0,
          width: 1.5,
          depth: 1.5,
          floorLevels: [firstRoom.floorLevel],
          status: 'aligned',
        },
      ],
    },
  };
  const colDiags = validateFurnitureLayout({
    project: projectWithColumn,
    instances: [placedSofa],
    knownOpenings: [knownSouthDoor],
    thresholds,
  });
  assert(
    colDiags.some(
      (d) =>
        d.category === 'fixed-object-collision' &&
        d.affectedFixedObstacleId?.includes('col-test-1')
    ),
    'Furniture overlapping a known structural column must trigger fixed-object-collision'
  );
  console.log('✓ Section B passed (Containment, collisions, known doors, missing door honesty, fixed obstacles)\n');

  // ---------------------------------------------------------------------------
  // C. CIRCULATION & ROUTE ANALYSIS TESTS
  // ---------------------------------------------------------------------------
  console.log('--- Section C: Circulation & Route Analysis Tests ---');

  // C1. Passable route with clear walkway
  const topWallSofa = moveFurnitureInstance(
    placedSofa,
    firstRoom.x + 1.0,
    firstRoom.y + 0.5
  );
  const passableEval = evaluateRoomCirculationAndRoutes({
    project: baseProject,
    instances: [topWallSofa],
    knownOpenings: [knownSouthDoor],
    thresholds,
    customRoutes: [],
    validationDiagnostics: [],
  });
  const livingMetric = passableEval.roomMetrics.find(
    (m) => m.roomId === firstRoom.id
  )!;
  assert(
    livingMetric.routesEvaluated.length > 0 &&
      livingMetric.routesEvaluated[0].status === 'passable-meets-threshold',
    `Clear room route should be passable-meets-threshold, got ${livingMetric.routesEvaluated[0]?.status}`
  );
  assert(
    livingMetric.routesEvaluated[0].pathWaypoints.length >= 2 &&
      livingMetric.routesEvaluated[0].pathLength! > 0,
    'Passable route must return grid waypoints and positive path length'
  );

  // C2. Blocked route when furniture partitions the doorway / path
  const wideBlocker = resizeFurnitureInstance(
    moveFurnitureInstance(
      placedSofa,
      firstRoom.x,
      firstRoom.y + firstRoom.length - 5.0
    ),
    firstRoom.width,
    2.5
  );
  const blockedRouteRes = evaluateSingleCirculationRoute({
    room: firstRoom,
    routeQuery: {
      id: 'route-test-blocked',
      roomId: firstRoom.id,
      floorLevel: firstRoom.floorLevel,
      label: 'South Door to North Wall',
      startPoint: {
        x: firstRoom.x + 4.5,
        y: firstRoom.y + firstRoom.length - 0.5,
        source: 'known-door',
        openingId: knownSouthDoor.openingId,
      },
      endPoint: {
        x: firstRoom.x + 4.5,
        y: firstRoom.y + 1.0,
        source: 'user-selected-point',
      },
    },
    roomInstances: [wideBlocker],
    fixedObstacles: [],
    thresholds,
    unit: baseProject.unit,
  });
  assert(
    blockedRouteRes.status === 'blocked' &&
      blockedRouteRes.blockingInstanceIds.includes(wideBlocker.instanceId),
    'Wall-to-wall blocking furniture must result in status="blocked" and identify the blocking instance'
  );

  // C3. Insufficient data when room has furniture but no known doors or custom routes
  const noDoorEval = evaluateRoomCirculationAndRoutes({
    project: baseProject,
    instances: [topWallSofa],
    knownOpenings: [],
    thresholds,
    customRoutes: [],
    validationDiagnostics: [],
  });
  const noDoorLiving = noDoorEval.roomMetrics.find(
    (m) => m.roomId === firstRoom.id
  )!;
  assert(
    noDoorLiving.hasMissingDoorData === true &&
      noDoorLiving.routesEvaluated[0]?.status === 'insufficient-data',
    'Room without knownOpenings must report status="insufficient-data" rather than a false pass'
  );
  console.log('✓ Section C passed (Grid routing, blocked partition detection, insufficient-data honesty)\n');

  // ---------------------------------------------------------------------------
  // D. SUGGESTION & P30/P31/P32 INTEGRATION TESTS
  // ---------------------------------------------------------------------------
  console.log('--- Section D: Suggestion & P30/P31/P32 Integration Tests ---');

  const suggestions = generateFurnitureLayoutSuggestions({
    project: baseProject,
    instances: [overflowingSofa],
    knownOpenings: [knownSouthDoor],
    thresholds,
    diagnostics: validateFurnitureLayout({
      project: baseProject,
      instances: [overflowingSofa],
      knownOpenings: [knownSouthDoor],
      thresholds,
    }),
  });
  const boundaryFixSug = suggestions.find(
    (s) => s.type === 'resolve-boundary-overflow'
  );
  assert(
    Boolean(boundaryFixSug),
    'Generator must produce a resolve-boundary-overflow suggestion for overflowing furniture'
  );

  // Non-destructive preview
  const instancesSnapshotBeforePreview = JSON.stringify([overflowingSofa]);
  const preview = previewFurnitureSuggestion({
    project: baseProject,
    currentInstances: [overflowingSofa],
    knownOpenings: [knownSouthDoor],
    thresholds,
    customRoutes: [],
    suggestion: boundaryFixSug!,
  });
  assert(
    JSON.stringify([overflowingSofa]) === instancesSnapshotBeforePreview,
    'previewFurnitureSuggestion must NEVER mutate currentInstances'
  );
  assert(
    preview.afterConflictCount < preview.beforeConflictCount,
    `Preview should reduce conflicts (before=${preview.beforeConflictCount}, after=${preview.afterConflictCount})`
  );

  // P31 Option Comparison Summary export
  const p31Summary = getP33MetricsForOptionComparison(
    baseProject,
    [topWallSofa],
    [knownSouthDoor],
    thresholds,
    []
  );
  assert(
    p31Summary.totalPlacedFurnitureCount === 1 &&
      p31Summary.totalCollisionCount === 0 &&
      p31Summary.averageFreeFloorRatioPercent !== null,
    'P31 export summary must report accurate furniture counts, collisions, and free floor ratio'
  );

  // Unconfirmed P30/P32 items must be ignored
  const projectWithUnconfirmedBrief: Project = {
    ...baseProject,
    brief: {
      ...(baseProject.brief as any),
      spaces: [],
      interpretedBrief: {
        id: 'ib-p33-test',
        rawInputText: 'Test prompt',
        normalizedInputText: 'Test prompt',
        interpretedAt: new Date().toISOString(),
        interpreterMode: 'deterministic-local',
        requestSequenceId: 1,
        projectSummary: 'Test summary',
        requirements: [
          {
            id: 'b-confirmed',
            category: 'spaces-program',
            description: 'Large Living Sofa',
            normalizedValue: 'Large sofa',
            priority: 'must-have',
            source: 'explicit',
            reviewStatus: 'confirmed',
            confidence: 'high',
            validationStatus: 'valid',
          },
          {
            id: 'b-inferred',
            category: 'spaces-program',
            description: 'Speculative Grand Piano',
            normalizedValue: 'Grand piano',
            priority: 'optional',
            source: 'inferred',
            reviewStatus: 'needs-review',
            confidence: 'low',
            validationStatus: 'valid',
          },
        ],
        assumptions: [],
        conflicts: [],
        clarificationQuestions: [],
        validation: {} as any,
      },
    } as any,
  };
  const fullEval = evaluateFurnitureIntelligence({
    project: projectWithUnconfirmedBrief,
    instances: [topWallSofa],
    knownOpenings: [knownSouthDoor],
  });
  assert(
    fullEval.p30CompatibilitySummary.confirmedRequirementsUsed.length === 1 &&
      fullEval.p30CompatibilitySummary.unconfirmedAssumptionsIgnored === 1,
    'P33 must use confirmed P30 requirements and ignore unconfirmed P30 inferences'
  );
  console.log('✓ Section D passed (Suggestion preview, P30/P32 confirmed-only filtering, P31 summary export)\n');

  // ---------------------------------------------------------------------------
  // E. FAILURE INJECTION, SNAPSHOT PERSISTENCE & ROLLBACK TESTS
  // ---------------------------------------------------------------------------
  console.log('--- Section E: Failure Injection, Persistence & Rollback Tests ---');

  // E1. Reject invalid negative/zero resize or non-finite coordinates
  let caughtResizeError = false;
  try {
    resizeFurnitureInstance(placedSofa, -2, 0);
  } catch {
    caughtResizeError = true;
  }
  assert(
    caughtResizeError,
    'resizeFurnitureInstance must throw on zero or negative dimensions'
  );

  let caughtMoveError = false;
  try {
    moveFurnitureInstance(placedSofa, Number.NaN, 5);
  } catch {
    caughtMoveError = true;
  }
  assert(
    caughtMoveError,
    'moveFurnitureInstance must throw on NaN/Infinity coordinates'
  );

  // E2. Reject unconfirmed suggestion application
  let caughtUnconfirmedApply = false;
  try {
    applyFurnitureSuggestionWithConfirmation({
      project: baseProject,
      suggestion: boundaryFixSug!,
      userConfirmed: false,
    });
  } catch {
    caughtUnconfirmedApply = true;
  }
  assert(
    caughtUnconfirmedApply,
    'applyFurnitureSuggestionWithConfirmation must reject userConfirmed=false'
  );

  // E3. Safe persistence preserves room geometry and creates pre-save snapshot for rollback
  const roomsBeforeSave = JSON.stringify(baseProject.floorPlan!.rooms);
  const layoutToSave = {
    ...ensureProjectFurnitureLayoutData(baseProject),
    instances: [topWallSofa],
    knownOpenings: [knownSouthDoor],
  };
  const { updatedProject, preSaveSnapshotId } =
    saveProjectFurnitureLayoutSafely({
      project: baseProject,
      layoutData: layoutToSave,
      actor: 'test-runner',
      reason: 'P33 verification save test',
    });

  assert(
    JSON.stringify(updatedProject.floorPlan!.rooms) === roomsBeforeSave,
    'Saving P33 furniture layout must NEVER alter project.floorPlan.rooms geometry'
  );
  assert(
    Boolean(preSaveSnapshotId),
    'saveProjectFurnitureLayoutSafely must create a pre-save snapshot checkpoint'
  );
  assert(
    updatedProject.furnitureLayout?.instances.length === 1,
    'Updated project must contain the saved furniture instance'
  );

  const rolledBackProject = rollbackProjectFurnitureLayout(
    updatedProject,
    preSaveSnapshotId!
  );
  assert(
    !rolledBackProject.furnitureLayout ||
      rolledBackProject.furnitureLayout.instances.length === 0,
    'Rollback to pre-save snapshot must restore prior furniture state cleanly'
  );
  assert(
    JSON.stringify(rolledBackProject.floorPlan!.rooms) === roomsBeforeSave,
    'Rollback must preserve room geometry intact'
  );

  console.log('✓ Section E passed (Invalid input rejection, room geometry immutability, snapshot rollback)\n');
  console.log('================================================================');
  console.log('ALL P33 FURNITURE & CIRCULATION INTELLIGENCE TESTS PASSED (100%)');
  console.log('================================================================');
}

runP33Verification().catch((err) => {
  console.error(err);
  process.exit(1);
});
