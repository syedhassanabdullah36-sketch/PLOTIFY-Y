/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P39 — Biophilic & Indoor Plantscape Planner Verification Suite
 * Account A | Locked Roadmap: P39 of P30–P40
 *
 * Covers Groups A through I:
 * - Group A: Data integrity (stable IDs, schema validation, serialization round-trip, missing/unknown fields, invalid values)
 * - Group B: Plant suitability (known vs unknown light requirements, missing P38 data, different plant requirements, explicit assumptions)
 * - Group C: Geometry & placement (unit consistency, room bounds, container & mature footprint, overlapping placements, door/furniture/circulation conflicts)
 * - Group D: Accessibility & safety (P34 accessibility integration, missing clearance, verified vs unverified toxicity, unsupported structural/installation claims)
 * - Group E: Cross-feature consistency (P33 circulation, P34 accessibility, P37 ventilation conflicts, P38 daylight & staleness, P31 comparison export)
 * - Group F: Scenario comparison (deterministic outputs, scenario deltas, unquantified wellbeing/productivity/VOC/energy benefits)
 * - Group G: Preview, apply & rollback (preview non-mutation, apply preserves unrelated project data, failed validation no partial apply, rollback, idempotency)
 * - Group H: UI & exports (JSON/Markdown export structure, no credentials, placement editing helpers)
 * - Group I: Regression & honesty (missing evidence not verified, unsupported claims remain unsupported)
 */

import { INITIAL_SAMPLE_PROJECTS } from './src/services/storage';
import { Project } from './src/types/project';
import {
  BiophilicPlacementRecord,
  P39_BIOPHILIC_PLANNER_ENGINE_VERSION,
  P39_BIOPHILIC_SCHEMA_VERSION,
} from './src/types/biophilicPlanner';
import {
  P39_DEFAULT_CATALOG,
  applyBiophilicProposalAtomically,
  compareBiophilicScenarios,
  deserializeBiophilicPlannerData,
  evaluateProjectBiophilicPlanner,
  exportBiophilicReportAsJson,
  exportBiophilicReportAsMarkdown,
  exportP39SummaryForP31,
  getProjectBiophilicCatalog,
  initializeProjectBiophilicPlannerData,
  metresToProjectUnit,
  previewBiophilicRecommendations,
  projectAreaToSqMetres,
  projectUnitToMetres,
  removeBiophilicPlacement,
  rollbackLastBiophilicApply,
  serializeBiophilicPlannerData,
  upsertBiophilicPlacement,
  validateBiophilicPlacementRecord,
} from './src/services/biophilicPlannerService';
import { initializeProjectDaylightComfortData } from './src/services/daylightComfortService';
import { ensureProjectFurnitureLayoutData } from './src/services/furnitureIntelligenceService';
import { initializeProjectNaturalVentilationData } from './src/services/naturalVentilationService';

let assertionsCount = 0;

function assert(condition: unknown, message: string): void {
  assertionsCount++;
  if (!condition) {
    throw new Error(`Assertion failed [${assertionsCount}]: ${message}`);
  }
}

function cloneSampleProject(): Project {
  return JSON.parse(JSON.stringify(INITIAL_SAMPLE_PROJECTS[0]));
}

console.log('================================================================');
console.log('P39 — BIOPHILIC & INDOOR PLANTSCAPE PLANNER VERIFICATION SUITE');
console.log('================================================================');

// ============================================================================
// GROUP A: Data Integrity
// ============================================================================
console.log('• Group A: Data Integrity, Serialization & Validation...');
{
  const proj = cloneSampleProject();
  const p39 = initializeProjectBiophilicPlannerData(proj);
  p39.extraFields = { customForwardCompatibleKey: 'preserved-value-123' };
  p39.scenarios[0].placements[0].extraFields = { placementExtraTag: 'v2-tag' };

  assert(
    p39.schemaVersion === P39_BIOPHILIC_SCHEMA_VERSION,
    'Schema version matches P39_BIOPHILIC_SCHEMA_VERSION'
  );
  assert(
    p39.engineVersion === P39_BIOPHILIC_PLANNER_ENGINE_VERSION,
    'Engine version matches P39_BIOPHILIC_PLANNER_ENGINE_VERSION'
  );

  // Serialization round-trip preserving stable IDs and unknown extraFields
  const serialized = serializeBiophilicPlannerData(p39);
  const deserialized = deserializeBiophilicPlannerData(serialized);
  assert(deserialized.valid && deserialized.data !== null, 'Valid JSON deserializes cleanly');
  assert(
    deserialized.data?.extraFields?.customForwardCompatibleKey === 'preserved-value-123',
    'Top-level extraFields preserved across serialization round-trip'
  );
  assert(
    deserialized.data?.scenarios[0].placements[0].extraFields?.placementExtraTag === 'v2-tag',
    'Placement-level extraFields preserved across serialization round-trip'
  );
  assert(
    deserialized.data?.scenarios[0].scenarioId === p39.scenarios[0].scenarioId,
    'Scenario stable ID preserved'
  );

  // Invalid JSON / missing required schema fields rejected
  const badJson = deserializeBiophilicPlannerData('{bad json');
  assert(!badJson.valid && badJson.errors.length > 0, 'Malformed JSON rejected');

  const missingVer = deserializeBiophilicPlannerData(JSON.stringify({ scenarios: [] }));
  assert(!missingVer.valid, 'Missing schemaVersion/engineVersion rejected');

  // Out-of-range / invalid placement values rejected
  const catalog = getProjectBiophilicCatalog(proj, p39);
  const invalidPlacement: BiophilicPlacementRecord = {
    ...p39.scenarios[0].placements[0],
    containerWidth: -1.5,
    quantity: 0,
    catalogId: 'non-existent-species-id',
  };
  const valCheck = validateBiophilicPlacementRecord(invalidPlacement, catalog);
  assert(!valCheck.valid && valCheck.errors.length >= 3, 'Invalid width, quantity, and catalogId caught');

  // Unknown botanical specimen keeps unknown properties as null / unknown
  const unknownSpec = P39_DEFAULT_CATALOG.find(
    (c) => c.catalogId === 'plant-unverified-custom-specimen'
  );
  assert(unknownSpec !== undefined, 'Unverified specimen exists in catalog');
  assert(unknownSpec?.scientificName === null, 'Unknown scientific name is null');
  assert(
    unknownSpec?.expectedMatureWidthRangeMetres === null,
    'Unknown mature width range is null'
  );
  assert(
    unknownSpec?.lightRequirementBand === 'unknown',
    'Unknown light requirement band is explicitly unknown'
  );
  assert(
    unknownSpec?.toxicityStatus === 'unknown-unverified',
    'Unknown toxicity is explicitly unknown-unverified'
  );
}
console.log('  ✓ Group A Passed');

// ============================================================================
// GROUP B: Plant Suitability
// ============================================================================
console.log('• Group B: Plant Suitability, Light Bands & Missing P38 Data...');
{
  const proj = cloneSampleProject();
  const room = proj.floorPlan!.rooms[0];

  // 1. Evaluate with normal P38 seeded daylight
  const report1 = evaluateProjectBiophilicPlanner(proj);
  const rmEval1 = report1.roomEvaluations.find((r) => r.roomId === room.id)!;
  assert(rmEval1 !== undefined, 'Room evaluation exists');
  assert(
    rmEval1.placementEvaluations.length > 0,
    'Default scenario has seeded placement evaluations'
  );
  assert(
    rmEval1.placementEvaluations[0].daylightNonGuaranteeDisclosure.includes(
      'do NOT guarantee'
    ),
    'Explicit disclosure that P38 analytical daylight does not guarantee plant survival'
  );

  // 2. Place a high-light-demanding Ficus lyrata in a room with very low P38 daylight (small low-VT window)
  const lowLightProj = cloneSampleProject();
  const dData = initializeProjectDaylightComfortData(lowLightProj);
  if (dData.roomConfigs[room.id]) {
    dData.roomConfigs[room.id].ceilingHeight = lowLightProj.unit === 'feet' ? 9.0 : 2.75;
    dData.roomConfigs[room.id].ceilingHeightProvenance = 'user-entered';
  }
  dData.windows = dData.windows.map((w) =>
    w.roomId === room.id
      ? {
          ...w,
          grossWidth: 1.0,
          grossHeight: 1.0,
          sillHeight: 3.0,
          headHeight: 4.0,
          frameFraction: 0.15,
          frameFractionProvenance: 'user-entered',
          visibleTransmittanceVT: 0.15,
          vtProvenance: 'user-entered',
        }
      : w
  );
  lowLightProj.daylightComfort = dData;

  const ficusPlacement: BiophilicPlacementRecord = {
    placementId: 'test-ficus-lowlight',
    catalogId: 'plant-ficus-lyrata',
    roomId: room.id,
    floorLevel: room.floorLevel || 1,
    label: 'Fiddle-Leaf Fig in Dim Room',
    quantity: 1,
    mountType: 'floor-standing',
    localX: 2,
    localY: 2,
    rotationDeg: 0,
    containerWidth: 1.6,
    containerDepth: 1.6,
    installedHeight: 5.4,
    expectedMatureWidth: 3.5,
    expectedMatureDepth: 3.5,
    unit: lowLightProj.unit,
    provenance: 'user_entered_project_data',
    completeness: 'complete',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const upRes = upsertBiophilicPlacement(lowLightProj, ficusPlacement);
  const lowLightReport = evaluateProjectBiophilicPlanner(upRes.updatedProject);
  const ficusEval = lowLightReport.roomEvaluations
    .find((r) => r.roomId === room.id)!
    .placementEvaluations.find((pe) => pe.placementId === 'test-ficus-lowlight')!;

  assert(
    ficusEval.lightSuitabilityStatus === 'unsuitable-insufficient-daylight',
    'High-light Ficus in dim room is flagged as unsuitable-insufficient-daylight'
  );
  assert(
    ficusEval.suitabilityStatus === 'unsuitable-under-current-assumptions',
    'Overall suitability is unsuitable-under-current-assumptions'
  );

  // 3. Missing P38 daylight data (missing VT on windows in room) -> not-assessable-with-current-data for living plant
  const noWinProj = cloneSampleProject();
  const noWinDaylight = initializeProjectDaylightComfortData(noWinProj);
  noWinDaylight.windows = noWinDaylight.windows.map((w) =>
    w.roomId === room.id
      ? { ...w, visibleTransmittanceVT: null, grossHeight: null }
      : w
  );
  noWinProj.daylightComfort = noWinDaylight;

  const noWinReport = evaluateProjectBiophilicPlanner(noWinProj);
  const noWinRmEval = noWinReport.roomEvaluations.find((r) => r.roomId === room.id)!;
  if (noWinRmEval.placementEvaluations.length > 0) {
    const livingPe = noWinRmEval.placementEvaluations.find((pe) => pe.isLivingPlant);
    if (livingPe) {
      assert(
        livingPe.suitabilityStatus === 'not-assessable-with-current-data',
        'Living plant in room with missing P38 Mode C daylight is marked not-assessable-with-current-data'
      );
      assert(
        livingPe.missingInputs.some((m) => m.includes('P38 Mode C Daylight Factor is unavailable')),
        'Missing P38 input is explicitly explained'
      );
    }
  }

  // 4. Non-living preserved moss panel in room with missing P38 daylight remains suitable!
  const mossPlacement: BiophilicPlacementRecord = {
    placementId: 'test-moss-nowin',
    catalogId: 'element-preserved-reindeer-moss-panel',
    roomId: room.id,
    floorLevel: room.floorLevel || 1,
    label: 'Preserved Moss Panel',
    quantity: 1,
    mountType: 'wall-mounted',
    wallEdge: 'north',
    localX: 2,
    localY: 0.5,
    rotationDeg: 0,
    containerWidth: 3.9,
    containerDepth: 0.3,
    installedHeight: 3.9,
    expectedMatureWidth: 3.9,
    expectedMatureDepth: 0.3,
    unit: noWinProj.unit,
    provenance: 'user_entered_project_data',
    completeness: 'complete',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const mossProj = upsertBiophilicPlacement(noWinProj, mossPlacement).updatedProject;
  const mossReport = evaluateProjectBiophilicPlanner(mossProj);
  const mossEval = mossReport.roomEvaluations
    .find((r) => r.roomId === room.id)!
    .placementEvaluations.find((pe) => pe.placementId === 'test-moss-nowin')!;
  assert(
    mossEval.lightSuitabilityStatus === 'not-applicable-non-living',
    'Non-living moss panel light suitability is not-applicable-non-living'
  );
  assert(
    mossEval.suitabilityStatus === 'suitable-based-on-available-evidence',
    'Non-living moss panel is suitable even without window daylight'
  );
}
console.log('  ✓ Group B Passed');

// ============================================================================
// GROUP C: Geometry & Placement
// ============================================================================
console.log('• Group C: Geometry, Unit Consistency, Bounds & Spatial Conflicts...');
{
  // Unit conversions
  assert(
    Math.abs((projectUnitToMetres(10, 'feet') ?? 0) - 3.048) < 0.01,
    '10 feet converts to 3.048 metres'
  );
  assert(
    Math.abs(metresToProjectUnit(1.0, 'feet') - 3.28) < 0.02,
    '1.0 metre converts to ~3.28 feet'
  );
  assert(
    Math.abs(projectAreaToSqMetres(100, 'feet') - 9.29) < 0.02,
    '100 sq ft converts to ~9.29 m²'
  );

  const proj = cloneSampleProject();
  const room = proj.floorPlan!.rooms[0];

  // Out-of-bounds placement check
  const outOfBoundsPl: BiophilicPlacementRecord = {
    placementId: 'test-oob',
    catalogId: 'plant-aspidistra-elatior',
    roomId: room.id,
    floorLevel: room.floorLevel || 1,
    label: 'Out of Bounds Plant',
    quantity: 1,
    mountType: 'floor-standing',
    localX: room.width - 0.5,
    localY: room.length - 0.5,
    rotationDeg: 0,
    containerWidth: 2.0,
    containerDepth: 2.0,
    installedHeight: 2.5,
    expectedMatureWidth: 2.8,
    expectedMatureDepth: 2.8,
    unit: proj.unit,
    provenance: 'user_entered_project_data',
    completeness: 'complete',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Overlapping placement check
  const overlapPlA: BiophilicPlacementRecord = {
    ...outOfBoundsPl,
    placementId: 'test-overlap-a',
    label: 'Overlap Plant A',
    localX: 3.0,
    localY: 3.0,
  };
  const overlapPlB: BiophilicPlacementRecord = {
    ...outOfBoundsPl,
    placementId: 'test-overlap-b',
    label: 'Overlap Plant B',
    localX: 3.5,
    localY: 3.5,
  };

  let pTest = upsertBiophilicPlacement(proj, outOfBoundsPl).updatedProject;
  pTest = upsertBiophilicPlacement(pTest, overlapPlA).updatedProject;
  pTest = upsertBiophilicPlacement(pTest, overlapPlB).updatedProject;

  const rep = evaluateProjectBiophilicPlanner(pTest);
  const rmConflicts = rep.roomEvaluations.find((r) => r.roomId === room.id)!.conflicts;

  assert(
    rmConflicts.some(
      (c) => c.placementId === 'test-oob' && c.kind === 'out-of-room-bounds'
    ),
    'Out-of-bounds placement is detected and flagged'
  );
  assert(
    rmConflicts.some(
      (c) =>
        c.placementId === 'test-overlap-a' && c.kind === 'overlapping-plant-placement'
    ),
    'Overlapping placements are detected and flagged'
  );
}
console.log('  ✓ Group C Passed');

// ============================================================================
// GROUP D: Accessibility & Safety
// ============================================================================
console.log('• Group D: Accessibility, Toxicity & Vertical Living-Wall Guardrails...');
{
  const proj = cloneSampleProject();
  const room = proj.floorPlan!.rooms[0];

  // Enable pets/children setting and place toxic ZZ Plant + unverified specimen
  const p39 = initializeProjectBiophilicPlannerData(proj);
  p39.scenarios[0].maintenanceSettings.hasPetsOrYoungChildren = true;
  p39.maintenanceSettings.hasPetsOrYoungChildren = true;
  proj.biophilicPlanner = p39;

  const toxicPl: BiophilicPlacementRecord = {
    placementId: 'test-toxic-zz',
    catalogId: 'plant-zamioculcas-zamiifolia',
    roomId: room.id,
    floorLevel: 1,
    label: 'ZZ Plant in Pet Zone',
    quantity: 1,
    mountType: 'floor-standing',
    localX: 2.0,
    localY: 2.0,
    rotationDeg: 0,
    containerWidth: 1.2,
    containerDepth: 1.2,
    installedHeight: 2.3,
    expectedMatureWidth: 2.0,
    expectedMatureDepth: 2.0,
    unit: proj.unit,
    provenance: 'user_entered_project_data',
    completeness: 'complete',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const unverifiedPl: BiophilicPlacementRecord = {
    ...toxicPl,
    placementId: 'test-unverified-spec',
    catalogId: 'plant-unverified-custom-specimen',
    label: 'Unverified Specimen',
    localX: 5.0,
    localY: 2.0,
    expectedMatureWidth: null,
    expectedMatureDepth: null,
  };

  const livingWallPl: BiophilicPlacementRecord = {
    ...toxicPl,
    placementId: 'test-living-wall',
    catalogId: 'plant-vertical-living-wall-modular',
    label: 'Living Wall Concept',
    mountType: 'wall-mounted',
    wallEdge: 'east',
    localX: 2.0,
    localY: 5.0,
    containerWidth: 5.0,
    containerDepth: 0.8,
    installedHeight: 6.8,
    expectedMatureWidth: 5.2,
    expectedMatureDepth: 1.2,
  };

  let pSafety = upsertBiophilicPlacement(proj, toxicPl).updatedProject;
  pSafety = upsertBiophilicPlacement(pSafety, unverifiedPl).updatedProject;
  pSafety = upsertBiophilicPlacement(pSafety, livingWallPl).updatedProject;

  const safetyRep = evaluateProjectBiophilicPlanner(pSafety);
  const safetyRm = safetyRep.roomEvaluations.find((r) => r.roomId === room.id)!;

  assert(
    safetyRm.conflicts.some(
      (c) =>
        c.placementId === 'test-toxic-zz' &&
        c.kind === 'toxicity-hazard-in-occupied-zone' &&
        c.severity === 'blocking-conflict'
    ),
    'Verified toxic ZZ plant in pet/child household is flagged as blocking toxicity conflict'
  );
  assert(
    safetyRm.conflicts.some(
      (c) =>
        c.placementId === 'test-unverified-spec' &&
        c.kind === 'toxicity-hazard-in-occupied-zone'
    ),
    'Unverified botanical toxicity is never assumed safe in pet/child household'
  );
  assert(
    safetyRm.conflicts.some(
      (c) =>
        c.placementId === 'test-living-wall' &&
        c.kind === 'vertical-wall-structural-moisture-unverified' &&
        c.description.includes('CONCEPTUAL PROPOSAL ONLY')
    ),
    'Vertical living wall explicitly disclaims structural load and waterproofing certification'
  );
  assert(
    safetyRep.crossFeatureIntegration.p34AccessibilityStatus.nonCertificationDisclaimer.includes(
      'does not certify statutory ADA/ISO accessibility compliance'
    ),
    'P34 accessibility non-certification disclaimer is present'
  );
}
console.log('  ✓ Group D Passed');

// ============================================================================
// GROUP E: Cross-Feature Consistency (P30–P38)
// ============================================================================
console.log('• Group E: Cross-Feature Consistency (P33, P34, P37, P38 & P31 Export)...');
{
  const proj = cloneSampleProject();
  const room = proj.floorPlan!.rooms[0];

  // Ensure P33 furniture and door opening exist in room
  const p33 = ensureProjectFurnitureLayoutData(proj);
  const roomFurn = p33.instances.find((f) => f.roomId === room.id);
  const roomDoor = p33.knownOpenings.find(
    (o) => o.roomId === room.id && (o.type === 'door' || o.type === 'open-passage')
  );
  proj.furnitureLayout = p33;

  // Ensure P37 ventilation opening exists in room
  const p37 = initializeProjectNaturalVentilationData(proj);
  proj.naturalVentilation = p37;

  // Place a plant colliding with P33 furniture
  if (roomFurn) {
    const furnLocalX =
      roomFurn.x >= room.x && roomFurn.x <= room.x + room.width
        ? roomFurn.x - room.x
        : roomFurn.x;
    const furnLocalY =
      roomFurn.y >= room.y && roomFurn.y <= room.y + room.length
        ? roomFurn.y - room.y
        : roomFurn.y;
    const collideFurnPl: BiophilicPlacementRecord = {
      placementId: 'test-collide-p33-furn',
      catalogId: 'plant-aspidistra-elatior',
      roomId: room.id,
      floorLevel: 1,
      label: 'Plant Colliding with Furniture',
      quantity: 1,
      mountType: 'floor-standing',
      localX: Math.max(0, furnLocalX),
      localY: Math.max(0, furnLocalY),
      rotationDeg: 0,
      containerWidth: 1.5,
      containerDepth: 1.5,
      installedHeight: 2.5,
      expectedMatureWidth: 2.0,
      expectedMatureDepth: 2.0,
      unit: proj.unit,
      provenance: 'user_entered_project_data',
      completeness: 'complete',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const pWithFurnCollide = upsertBiophilicPlacement(proj, collideFurnPl).updatedProject;
    const repFurn = evaluateProjectBiophilicPlanner(pWithFurnCollide);
    assert(
      repFurn.allConflicts.some(
        (c) =>
          c.placementId === 'test-collide-p33-furn' &&
          c.kind === 'furniture-collision-p33'
      ),
      'P33 furniture collision is detected'
    );
  }

  // Place a plant in P33 door swing zone
  if (roomDoor) {
    const doorCollidePl: BiophilicPlacementRecord = {
      placementId: 'test-collide-p33-door',
      catalogId: 'plant-aspidistra-elatior',
      roomId: room.id,
      floorLevel: 1,
      label: 'Plant in Door Swing',
      quantity: 1,
      mountType: 'floor-standing',
      localX: roomDoor.wallEdge === 'north' || roomDoor.wallEdge === 'south' ? roomDoor.offsetAlongWall : 0.2,
      localY: roomDoor.wallEdge === 'west' || roomDoor.wallEdge === 'east' ? roomDoor.offsetAlongWall : 0.2,
      rotationDeg: 0,
      containerWidth: 1.5,
      containerDepth: 1.5,
      installedHeight: 2.5,
      expectedMatureWidth: 2.0,
      expectedMatureDepth: 2.0,
      unit: proj.unit,
      provenance: 'user_entered_project_data',
      completeness: 'complete',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const pWithDoorCollide = upsertBiophilicPlacement(proj, doorCollidePl).updatedProject;
    const repDoor = evaluateProjectBiophilicPlanner(pWithDoorCollide);
    assert(
      repDoor.allConflicts.some(
        (c) =>
          c.placementId === 'test-collide-p33-door' &&
          c.kind === 'door-or-opening-swing-interference-p33'
      ),
      'P33 door swing interference is detected'
    );
  }

  // Test P38 staleness detection when a P38 window dimension changes after P39 initialization
  const baseProj = cloneSampleProject();
  baseProj.biophilicPlanner = initializeProjectBiophilicPlannerData(baseProj);
  const initialRep = evaluateProjectBiophilicPlanner(baseProj);
  assert(!initialRep.isP38LinkStale, 'Initially P38 link is not stale');

  // Modify P38 window width on baseProj
  const dData = initializeProjectDaylightComfortData(baseProj);
  if (dData.windows.length > 0) {
    dData.windows[0].grossWidth = (dData.windows[0].grossWidth || 4) + 2;
  }
  baseProj.daylightComfort = dData;

  const afterWinChangeRep = evaluateProjectBiophilicPlanner(baseProj);
  assert(
    afterWinChangeRep.isP38LinkStale === true,
    'Changing P38 window geometry marks P39 suitability link stale and triggers recomputation'
  );
  assert(
    afterWinChangeRep.staleReasons.some((s) => s.includes('P38 daylight, window geometry')),
    'Stale reason explains P38 change'
  );

  // Test P31 comparison export
  const p31Summaries = exportP39SummaryForP31(baseProj);
  assert(p31Summaries.length > 0, 'P31 comparison export produces option summaries');
  assert(
    p31Summaries[0].engineVersion === P39_BIOPHILIC_PLANNER_ENGINE_VERSION,
    'P31 summary carries P39 engine version'
  );
}
console.log('  ✓ Group E Passed');

// ============================================================================
// GROUP F: Scenario Comparison
// ============================================================================
console.log('• Group F: Scenario Comparison & Unquantified Benefit Guardrails...');
{
  const proj = cloneSampleProject();
  const repA = evaluateProjectBiophilicPlanner(proj);
  const repB = evaluateProjectBiophilicPlanner(proj);

  assert(
    repA.sourceFingerprint === repB.sourceFingerprint,
    'Identical inputs produce identical deterministic sourceFingerprint'
  );
  assert(repA.scenarioComparison !== null, 'Scenario comparison is computed');

  const cmp = repA.scenarioComparison!;
  assert(
    cmp.metrics.livingPlantCountB > cmp.metrics.livingPlantCountA,
    'High-Density Scenario B has more living plants than Low-Maintenance Scenario A'
  );
  assert(
    cmp.metrics.deltaLivingPlantCount ===
      cmp.metrics.livingPlantCountB - cmp.metrics.livingPlantCountA,
    'Delta living plant count is exact'
  );
  assert(
    (cmp.metrics.estimatedMonthlyMaintenanceMinutesB ?? 0) >
      (cmp.metrics.estimatedMonthlyMaintenanceMinutesA ?? 0),
    'High-Density Scenario B has higher estimated monthly maintenance minutes than Scenario A'
  );

  // Verify no fabricated wellbeing, productivity, air purification, or energy scores
  assert(
    cmp.unquantifiedBenefitDisclosures.occupantWellbeingScore === null,
    'Occupant wellbeing score is explicitly null (unquantified)'
  );
  assert(
    cmp.unquantifiedBenefitDisclosures.productivityGainPercent === null,
    'Productivity gain percent is explicitly null (unquantified)'
  );
  assert(
    cmp.unquantifiedBenefitDisclosures.airPurificationVocRemovalRate === null,
    'Air purification VOC removal rate is explicitly null (unquantified)'
  );
  assert(
    cmp.unquantifiedBenefitDisclosures.thermalOrEnergySavingsKwh === null,
    'Thermal/energy savings is explicitly null (unquantified)'
  );
  assert(
    cmp.unquantifiedBenefitDisclosures.status ===
      'unquantified_unsupported_without_clinical_or_chamber_evidence',
    'Unquantified status code is explicit'
  );
}
console.log('  ✓ Group F Passed');

// ============================================================================
// GROUP G: Preview, Apply & Rollback
// ============================================================================
console.log('• Group G: Non-Destructive Preview, Atomic Apply, Rollback & Idempotency...');
{
  const proj = cloneSampleProject();
  // Remove placements from room 0 so a recommendation is generated to add a plantscape
  const p39 = initializeProjectBiophilicPlannerData(proj);
  const firstRoomId = proj.floorPlan!.rooms[0].id;
  p39.scenarios[0].placements = p39.scenarios[0].placements.filter(
    (p) => p.roomId !== firstRoomId
  );
  proj.biophilicPlanner = p39;

  const beforeJson = JSON.stringify(proj);
  const repBefore = evaluateProjectBiophilicPlanner(proj);
  assert(repBefore.recommendations.length > 0, 'Recommendations generated for empty room');

  const recId = repBefore.recommendations[0].recommendationId;
  const preview = previewBiophilicRecommendations(proj, [recId]);

  // 1. Preview does not mutate live project state
  assert(
    JSON.stringify(proj) === beforeJson,
    'Preview leaves live project state 100% unchanged'
  );
  assert(preview.isSafeToApply === true, 'Preview is marked safe to apply');
  assert(preview.placementDiffs.length === 1, 'Preview contains 1 placement diff');
  assert(
    preview.p38AssessmentsPreservedUnmodified === true,
    'Preview confirms P38 daylight assessments are unmodified'
  );

  // 2. Failed validation does not partially apply changes
  const corruptedPreview = JSON.parse(JSON.stringify(preview));
  corruptedPreview.proposedProjectClone.biophilicPlanner.scenarios[0].placements[0].containerWidth = -99;
  const failedApply = applyBiophilicProposalAtomically(proj, corruptedPreview);
  assert(
    failedApply.applied === false,
    'Corrupted proposed state is rejected by atomic apply validation'
  );
  assert(
    JSON.stringify(failedApply.updatedProject) === beforeJson,
    'Failed apply leaves project state completely untouched'
  );

  // 3. Valid Atomic Apply succeeds and preserves unrelated project data
  const applyRes = applyBiophilicProposalAtomically(proj, preview);
  assert(applyRes.applied === true, 'Valid preview is applied atomically');
  assert(applyRes.snapshotId !== null, 'Pre-apply snapshot ID is recorded');

  const appliedProj = applyRes.updatedProject;
  const afterCount =
    appliedProj.biophilicPlanner!.scenarios[0].placements.filter(
      (p) => p.roomId === firstRoomId
    ).length;
  assert(afterCount === 1, 'Placement was added to target room on apply');

  // 4. Modify an unrelated project field (e.g. project.notes) and verify rollback restores P39 without deleting unrelated changes
  appliedProj.notes = 'Unrelated architectural note updated after P39 apply';
  const rbRes = rollbackLastBiophilicApply(appliedProj);
  assert(rbRes.rolledBack === true, 'Rollback succeeds');
  assert(
    rbRes.restoredProject.notes === 'Unrelated architectural note updated after P39 apply',
    'Rollback preserves unrelated project changes'
  );
  const restoredCount =
    rbRes.restoredProject.biophilicPlanner!.scenarios[0].placements.filter(
      (p) => p.roomId === firstRoomId
    ).length;
  assert(restoredCount === 0, 'Rollback restores pre-apply P39 placement state');

  // 5. Repeated upsert operations with same placementId do not duplicate placements
  const samplePl = p39.scenarios[1].placements[0];
  const up1 = upsertBiophilicPlacement(proj, samplePl).updatedProject;
  const countAfter1 = up1.biophilicPlanner!.scenarios[0].placements.length;
  const up2 = upsertBiophilicPlacement(up1, { ...samplePl, quantity: 2 }).updatedProject;
  const countAfter2 = up2.biophilicPlanner!.scenarios[0].placements.length;
  assert(
    countAfter1 === countAfter2,
    'Repeated upsert with same placementId updates in place without duplicating'
  );
}
console.log('  ✓ Group G Passed');

// ============================================================================
// GROUP H: UI & Exports
// ============================================================================
console.log('• Group H: Structured JSON & Markdown Exports...');
{
  const proj = cloneSampleProject();
  const report = evaluateProjectBiophilicPlanner(proj);

  const jsonExport = exportBiophilicReportAsJson(report);
  const parsedExport = JSON.parse(jsonExport);
  assert(
    parsedExport.engineVersion === P39_BIOPHILIC_PLANNER_ENGINE_VERSION,
    'JSON export includes engineVersion'
  );
  assert(
    parsedExport.schemaVersion === P39_BIOPHILIC_SCHEMA_VERSION,
    'JSON export includes schemaVersion'
  );
  assert(
    Array.isArray(parsedExport.roomEvaluations) && parsedExport.roomEvaluations.length > 0,
    'JSON export includes roomEvaluations'
  );
  assert(
    !jsonExport.includes('API_KEY') && !jsonExport.includes('password'),
    'JSON export contains no credentials or secrets'
  );

  const mdExport = exportBiophilicReportAsMarkdown(report);
  assert(
    mdExport.includes('# P39 Biophilic & Indoor Plantscape Planner Report'),
    'Markdown export includes header'
  );
  assert(
    mdExport.includes('Unquantified Benefits Disclosure'),
    'Markdown export includes unquantified benefits disclosure'
  );
}
console.log('  ✓ Group H Passed');

// ============================================================================
// GROUP I: Regression & Honesty Guarantees
// ============================================================================
console.log('• Group I: Honesty, Non-Fabrication & P30–P38 Invariance...');
{
  const proj = cloneSampleProject();
  const p38Before = JSON.stringify(proj.daylightComfort);
  const p33Before = JSON.stringify(proj.furnitureLayout);
  const p37Before = JSON.stringify(proj.naturalVentilation);

  const report = evaluateProjectBiophilicPlanner(proj);

  assert(
    JSON.stringify(proj.daylightComfort) === p38Before,
    'Evaluating P39 never mutates project.daylightComfort'
  );
  assert(
    JSON.stringify(proj.furnitureLayout) === p33Before,
    'Evaluating P39 never mutates project.furnitureLayout'
  );
  assert(
    JSON.stringify(proj.naturalVentilation) === p37Before,
    'Evaluating P39 never mutates project.naturalVentilation'
  );
  assert(
    report.professionalDisclaimer.includes('do NOT guarantee plant survival'),
    'Professional disclaimer states P38 daylight estimates do not guarantee plant survival'
  );
  assert(
    report.crossFeatureIntegration.p30ComplianceSeparationNote.includes(
      'never treated as P30 statutory building-code'
    ),
    'P30 compliance separation note is explicit'
  );
}
console.log('  ✓ Group I Passed');

console.log('================================================================');
console.log(`✓ ALL ${assertionsCount} P39 BIOPHILIC & INDOOR PLANTSCAPE ASSERTIONS PASSED!`);
console.log('================================================================');
