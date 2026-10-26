/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P34 — Universal Accessibility Review Verification Suite
 * Account A | Locked Roadmap: P34 of P30–P40
 *
 * Verifies Sections A through G:
 * A. Rule Profile & Jurisdiction Governance (no universal code claim without profile, imperial/metric conversion)
 * B. Exact Continuous 2D Geometric Checks (turning circles, T-turns, clear floor spaces, bathroom/furniture obstructions)
 * C. Doorway, Route Continuity & Multi-Storey Vertical Access (clear vs nominal width, inward swing, stairs never satisfy wheelchair vertical access)
 * D. Ramps, Lifts, Sanitary Fixtures, Operable Controls & Honest Unassessed Topics (unassessed never counted as passing)
 * E. Explainable Improvement Suggestions, Non-Destructive Preview, Safe Apply & Snapshot Rollback
 * F. Cross-Engine Compatibility with P30 Brief, P31 Comparison, P32 Personalization Guardrail & P33 Furniture
 * G. Stale Review Detection & Fingerprint Integrity
 */

import { Project } from './src/types/project';
import { P34_ACCESSIBILITY_ENGINE_VERSION } from './src/types/universalAccessibility';
import { P33_FURNITURE_ENGINE_VERSION } from './src/types/furnitureIntelligence';
import { getDefaultClearanceThresholds } from './src/services/furnitureIntelligenceService';
import {
  getAccessibilityRuleProfiles,
  ensureProjectAccessibilityReviewData,
  findMaxInscribedTurningCircle,
  checkTTurnSpaceInRoom,
  evaluateUniversalAccessibility,
  previewAccessibilitySuggestion,
  applyAccessibilitySuggestionSafely,
  saveProjectAccessibilityReviewSafely,
  rollbackAccessibilityChanges,
  getP34SummaryForOptionComparison,
} from './src/services/universalAccessibilityService';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${message}`);
  } else {
    failed++;
    console.error(`  ✗ FAILED: ${message}`);
  }
}

function createBaseTestProject(unit: 'feet' | 'metres' = 'feet'): Project {
  const now = new Date().toISOString();
  return {
    id: 'proj-p34-test',
    name: 'P34 Accessibility Verification Residence',
    projectType: 'house',
    plotWidth: unit === 'feet' ? 40 : 12,
    plotLength: unit === 'feet' ? 50 : 15,
    unit,
    roadFacing: 'South',
    floors: 1,
    rooms: {
      bedrooms: 1,
      bathrooms: 1,
      kitchen: 1,
      livingRoom: 1,
    },
    budget: 350000,
    currency: 'USD',
    notes: 'Test project for P34 Universal Accessibility Review',
    status: 'Schematic Design',
    floorPlan: {
      rooms: [
        {
          id: 'room-living',
          name: 'Living Room',
          type: 'living',
          x: 0,
          y: 0,
          width: unit === 'feet' ? 14 : 4.2,
          length: unit === 'feet' ? 16 : 5.0,
          floorLevel: 1,
        },
        {
          id: 'room-bath',
          name: 'Accessible Bathroom',
          type: 'bathroom',
          x: unit === 'feet' ? 14 : 4.2,
          y: 0,
          width: unit === 'feet' ? 6 : 1.85,
          length: unit === 'feet' ? 8 : 2.5,
          floorLevel: 1,
        },
      ],
    },
    brief: {
      version: '1.0.0',
      lastUpdated: now,
      approvalStatus: 'client-approved',
      objectives: {
        primaryPurpose: 'Barrier-free accessible home',
        buildingUse: 'residential',
        intendedUsers: 'Couple with wheelchair user',
        mainActivities: 'Daily living and remote work',
        desiredOutcomes: 'Step-free circulation and full turning spaces',
        projectStage: 'Schematic Design',
      },
      occupancy: {
        regularOccupants: 2,
        occasionalVisitors: 2,
        occupancyPattern: 'Full-time residence',
        userGroupNeeds: 'Wheelchair user requires full turning and step-free access',
        futureExpansionNeeds: 'None',
        accessibilityNotes: 'Wheelchair user requires full turning and step-free access',
      },
      preferences: {
        spatialCharacter: 'Open plan',
        indoorOutdoorRelationship: 'Level threshold patio',
        naturalLightPriorities: 'High',
        storagePriorities: 'Accessible reach storage',
        circulationPreferences: 'Wide corridors',
        materialPreferences: 'Non-slip matte flooring',
      },
      constraints: {
        siteRestrictionsSummary: 'Flat urban plot',
        structuralAssumptions: 'Timber frame',
        knownMandatoryRequirements: ['60-inch turning circle in all rooms'],
        accessibilityMandatory: true,
        unresolvedQuestions: [],
      },
      spaces: [
        {
          id: 'sp-living',
          name: 'Living Room',
          category: 'living',
          targetArea: 200,
          minArea: 150,
          quantity: 1,
          floorPreference: 1,
          priority: 'mandatory',
          privacyLevel: 'public',
          naturalLightRequired: true,
          plumbingRequired: false,
          outdoorAccessRequired: true,
          acousticPrivacyRequired: false,
          wheelchairAccessible: true,
        },
        {
          id: 'sp-bath',
          name: 'Accessible Bathroom',
          category: 'hygiene',
          targetArea: 48,
          minArea: 40,
          quantity: 1,
          floorPreference: 1,
          priority: 'mandatory',
          privacyLevel: 'private',
          naturalLightRequired: false,
          plumbingRequired: true,
          outdoorAccessRequired: false,
          acousticPrivacyRequired: true,
          wheelchairAccessible: true,
        },
      ],
      relationships: [],
      circulationWallAllowancePercent: 15,
      revisions: [],
    },
    furnitureLayout: {
      version: P33_FURNITURE_ENGINE_VERSION,
      unit,
      customTemplates: [],
      instances: [],
      knownOpenings: [
        {
          openingId: 'op-living-entry',
          roomId: 'room-living',
          floorLevel: 1,
          type: 'door',
          label: 'Main Entry Door',
          wallEdge: 'south',
          offsetAlongWall: unit === 'feet' ? 4 : 1.2,
          width: unit === 'feet' ? 3.2 : 1.0,
          swingDirection: 'inward-left',
          provenance: 'user-entered',
        },
        {
          openingId: 'op-bath-door',
          roomId: 'room-bath',
          floorLevel: 1,
          type: 'door',
          label: 'Bathroom Door',
          wallEdge: 'west',
          offsetAlongWall: unit === 'feet' ? 2 : 0.6,
          width: unit === 'feet' ? 3.0 : 0.95,
          swingDirection: 'outward',
          provenance: 'user-entered',
        },
      ],
      clearanceThresholds: getDefaultClearanceThresholds(unit),
      customRoutes: [],
      lastSavedAt: now,
      lastPreSaveSnapshotId: null,
      requestSequenceId: 1,
    },
    createdAt: now,
    updatedAt: now,
  };
}

console.log('================================================================');
console.log('PLOTIFY P34 — UNIVERSAL ACCESSIBILITY REVIEW VERIFICATION SUITE');
console.log(`Engine Version: ${P34_ACCESSIBILITY_ENGINE_VERSION}`);
console.log('================================================================\n');

// SECTION A: Rule Profile & Jurisdiction Governance
console.log('Section A: Accessibility Rule Profiles, Jurisdiction Governance & Unit Conversion');
{
  const baseProj = createBaseTestProject('feet');
  const defaultReview = ensureProjectAccessibilityReviewData(baseProj);
  assert(
    defaultReview.activeProfileId === 'general-screening-configurable',
    'Default profile when no jurisdiction is set is general-screening-configurable (non-statutory)'
  );

  const profilesFeet = getAccessibilityRuleProfiles('feet');
  const adaFeet = profilesFeet['us-ada-2010-standards'];
  assert(
    adaFeet.authorityClassification === 'statutory-standard' &&
      adaFeet.thresholds.turningCircleDiameter === 5.0 &&
      adaFeet.thresholds.clearFloorSpaceWidth === 2.5 &&
      adaFeet.thresholds.clearFloorSpaceLength === 4.0 &&
      adaFeet.thresholds.minDoorClearOpeningWidth === 2.67 &&
      adaFeet.thresholds.minAccessibleRouteClearWidth === 3.0,
    '2010 ADA profile in feet has exact 5.0 ft (60 in) turning circle, 2.5x4.0 ft (30x48 in) clear floor space, 2.67 ft (32 in) door clear width, and 3.0 ft (36 in) route width'
  );

  const profilesMetres = getAccessibilityRuleProfiles('metres');
  const isoMetres = profilesMetres['iso-21542-2021-reference'];
  assert(
    isoMetres.authorityClassification === 'international-reference' &&
      isoMetres.thresholds.turningCircleDiameter === 1.5 &&
      isoMetres.thresholds.clearFloorSpaceWidth === 0.8 &&
      isoMetres.thresholds.clearFloorSpaceLength === 1.3 &&
      isoMetres.thresholds.minDoorClearOpeningWidth === 0.85 &&
      isoMetres.thresholds.minAccessibleRouteClearWidth === 0.9,
    'ISO 21542:2021 profile in metres has exact 1.50 m turning circle, 0.80x1.30 m clear floor space, 0.85 m door clear width, and 0.90 m route width'
  );

  const adaConvertedToMetres = profilesMetres['us-ada-2010-standards'];
  assert(
    Math.abs(adaConvertedToMetres.thresholds.turningCircleDiameter - 1.52) <= 0.02 &&
      adaConvertedToMetres.thresholds.unit === 'metres',
    '2010 ADA profile converts cleanly from feet to metres without silent unit mismatch'
  );
}

// SECTION B: Exact Continuous 2D Geometric Checks (Turning Circle, T-Turn, Clear Floor Space)
console.log('\nSection B: Exact Continuous 2D Wheelchair Turning & Clear Floor Space Geometry');
{
  const proj = createBaseTestProject('feet');
  const bathRoom = proj.floorPlan!.rooms.find((r) => r.id === 'room-bath')!;

  // 1. Empty 6x8 ft bathroom has max inscribed turning circle of 6.0 ft (>= 5.0 ft target)
  const emptyTurn = findMaxInscribedTurningCircle(bathRoom, [], 5.0);
  assert(
    emptyTurn.meetsTarget && emptyTurn.maxDiameter === 6.0,
    'Empty 6x8 ft bathroom yields exact 6.0 ft max inscribed turning circle (>= 5.0 ft target)'
  );

  // 2. Place a 2.5 x 3.5 ft vanity/cabinet at center of bathroom (x: 15.5, y: 2.2) blocking the 5.0 ft circle
  const centerObstacle = [{ x: 15.5, y: 2.2, width: 2.5, length: 3.5 }];
  const blockedTurn = findMaxInscribedTurningCircle(bathRoom, centerObstacle, 5.0);
  assert(
    !blockedTurn.meetsTarget && blockedTurn.maxDiameter < 5.0,
    `Central obstacle in 6x8 ft bathroom reduces max turning circle to ${blockedTurn.maxDiameter} ft (< 5.0 ft) and fails turning check`
  );

  // 3. Narrow 4.5 x 8.0 ft room fails even when completely empty
  const narrowRoom = { ...bathRoom, width: 4.5, length: 8.0 };
  const narrowTurn = findMaxInscribedTurningCircle(narrowRoom, [], 5.0);
  assert(
    !narrowTurn.meetsTarget && narrowTurn.maxDiameter === 4.5,
    '4.5 x 8.0 ft room fails 5.0 ft turning circle even when empty (maxDiameter = 4.5 ft)'
  );

  // 4. T-Turn Space verification
  const tTurnRoom = {
    id: 'r-t',
    name: 'T-Turn Vestibule',
    type: 'custom',
    x: 0,
    y: 0,
    width: 5.0,
    length: 5.0,
    floorLevel: 1,
  };
  const cornerBlocks = [
    { x: 0, y: 3.2, width: 0.9, length: 1.8 },
    { x: 4.1, y: 3.2, width: 0.9, length: 1.8 },
  ];
  const tTurnFits = checkTTurnSpaceInRoom(tTurnRoom, cornerBlocks, 5.0, 3.0);
  assert(
    tTurnFits === true,
    'T-shaped turning space (5.0 ft span, 3.0 ft arm width) is detected between corner chases'
  );
}

// SECTION C: Doorway Clear Width vs Nominal Width, Inward Swing & Multi-Storey Vertical Access
console.log('\nSection C: Doorways, Route Continuity & Multi-Storey Vertical Circulation');
{
  const proj = createBaseTestProject('feet');

  // Make bathroom door narrow (2.4 ft nominal < 2.67 ft required) and inward-swinging
  proj.furnitureLayout!.knownOpenings = proj.furnitureLayout!.knownOpenings.map((op) =>
    op.openingId === 'op-bath-door'
      ? { ...op, width: 2.4, swingDirection: 'inward-left' }
      : op
  );

  const report1 = evaluateUniversalAccessibility(proj);
  const bathDoorCrit = report1.allCriterionResults.find(
    (c) => c.criterionId === 'crit-door-op-bath-door'
  );
  assert(
    bathDoorCrit?.status === 'does-not-meet-configured-criterion',
    '2.4 ft doorway fails configured minimum clear opening width (2.67 ft / 32 in)'
  );

  // Test room with zero openings recorded -> must be 'insufficient-data', NEVER 'meets-configured-criterion'
  const projNoDoors = createBaseTestProject('feet');
  projNoDoors.furnitureLayout!.knownOpenings = [];
  const reportNoDoors = evaluateUniversalAccessibility(projNoDoors);
  const missingDoorCrit = reportNoDoors.allCriterionResults.find(
    (c) => c.criterionId === 'crit-door-missing-room-bath'
  );
  const missingRouteCrit = reportNoDoors.allCriterionResults.find(
    (c) => c.criterionId === 'crit-route-room-bath'
  );
  assert(
    missingDoorCrit?.status === 'insufficient-data' &&
      missingRouteCrit?.status === 'insufficient-data',
    'Room without recorded doorways reports insufficient-data for both door clearance and route continuity (never assumed passing)'
  );

  // Test Multi-Storey project with Stairs only -> must FAIL wheelchair vertical access
  const multiFloorProj = createBaseTestProject('feet');
  multiFloorProj.floors = 2;
  multiFloorProj.floorPlan!.rooms.push({
    id: 'room-bed-up',
    name: 'Upper Primary Bedroom',
    type: 'bedroom',
    x: 0,
    y: 0,
    width: 14,
    length: 14,
    floorLevel: 2,
  });
  const revWithStairOnly = ensureProjectAccessibilityReviewData(multiFloorProj);
  revWithStairOnly.elements.stairs.push({
    stairId: 'stair-main',
    name: 'Main Staircase',
    floorLevelStart: 1,
    floorLevelEnd: 2,
    clearWidth: 3.5,
    hasContinuousHandrails: true,
    hasTactileWarningStrips: true,
    hasVisualContrastNosings: true,
    provenance: 'user-entered',
    updatedAt: new Date().toISOString(),
  });
  multiFloorProj.accessibilityReview = revWithStairOnly;

  const multiReportStairs = evaluateUniversalAccessibility(multiFloorProj);
  const vertCritStairs = multiReportStairs.allCriterionResults.find(
    (c) => c.criterionId === 'crit-vertical-multistorey-connection'
  );
  assert(
    vertCritStairs?.status === 'does-not-meet-configured-criterion',
    'Multi-storey building with only stairs FAILS wheelchair vertical access (stairs never satisfy floor-to-floor wheeled circulation)'
  );

  // Now add a compliant passenger elevator serving Floors 1 and 2
  revWithStairOnly.elements.verticalLifts.push({
    liftId: 'lift-main',
    name: 'Residential Passenger Lift',
    liftType: 'passenger-elevator',
    servedFloors: [1, 2],
    cabClearWidth: 4.5,
    cabClearDepth: 5.8,
    doorClearWidth: 3.0,
    hasTactileAndBrailleControls: true,
    hasAudibleAndVisualIndicators: true,
    provenance: 'user-entered',
    updatedAt: new Date().toISOString(),
  });
  const multiReportWithLift = evaluateUniversalAccessibility(multiFloorProj);
  const vertCritWithLift = multiReportWithLift.allCriterionResults.find(
    (c) => c.criterionId === 'crit-vertical-multistorey-connection'
  );
  const liftDimCrit = multiReportWithLift.allCriterionResults.find(
    (c) => c.criterionId === 'crit-lift-lift-main'
  );
  assert(
    vertCritWithLift?.status === 'meets-configured-criterion' &&
      liftDimCrit?.status === 'meets-configured-criterion',
    'Adding a compliant passenger lift serving Floors 1 & 2 resolves multi-storey vertical access'
  );
}

// SECTION D: Ramps, Sanitary Fixtures, Operable Controls & Honest Unassessed Topics
console.log('\nSection D: Ramps, Sanitary Fixtures, Operable Controls & Unassessed Topic Honesty');
{
  const proj = createBaseTestProject('feet');
  const rev = ensureProjectAccessibilityReviewData(proj);

  // Add a steep ramp (rise 1.0 ft over 8.0 ft run = 1:8 slope > max 1:12)
  rev.elements.ramps.push({
    rampId: 'ramp-steep',
    name: 'Steep Entry Ramp',
    floorLevelStart: 1,
    floorLevelEnd: 1,
    connectsRoomOrExteriorIds: ['room-living'],
    clearWidth: 3.5,
    runLength: 8.0,
    verticalRise: 1.0,
    topLandingLength: 5.0,
    bottomLandingLength: 5.0,
    hasHandrailsBothSides: true,
    provenance: 'user-entered',
    updatedAt: new Date().toISOString(),
  });
  proj.accessibilityReview = rev;

  const repSteep = evaluateUniversalAccessibility(proj);
  const steepCrit = repSteep.allCriterionResults.find(
    (c) => c.criterionId === 'crit-ramp-ramp-steep'
  );
  assert(
    steepCrit?.status === 'does-not-meet-configured-criterion',
    'Steep 1:8 ramp is flagged as does-not-meet-configured-criterion against 1:12 maximum slope'
  );

  // Fix ramp run to 12.5 ft (1:12.5 <= 1:12)
  rev.elements.ramps[0].runLength = 12.5;
  const repCompliantRamp = evaluateUniversalAccessibility(proj);
  const passRampCrit = repCompliantRamp.allCriterionResults.find(
    (c) => c.criterionId === 'crit-ramp-ramp-steep'
  );
  assert(
    passRampCrit?.status === 'meets-configured-criterion',
    '1:12.5 ramp with 3.5 ft clear width and 5.0 ft landings meets configured ramp criterion'
  );

  // Verify that unmodeled bathroom fixture attributes, operable controls, wayfinding, and alarms are NOT counted as passing
  const bathFixtureMetaCrit = repCompliantRamp.allCriterionResults.find(
    (c) => c.criterionId === 'crit-fixture-meta-room-bath'
  );
  const controlsUnmodeledCrit = repCompliantRamp.allCriterionResults.find(
    (c) => c.criterionId === 'crit-controls-unmodeled'
  );
  const wayfindingUnmodeledCrit = repCompliantRamp.allCriterionResults.find(
    (c) => c.criterionId === 'crit-wayfinding-unmodeled'
  );
  const alarmsUnmodeledCrit = repCompliantRamp.allCriterionResults.find(
    (c) => c.criterionId === 'crit-alarms-unmodeled'
  );

  assert(
    bathFixtureMetaCrit?.status === 'insufficient-data' &&
      controlsUnmodeledCrit?.status === 'unassessed' &&
      wayfindingUnmodeledCrit?.status === 'unassessed' &&
      alarmsUnmodeledCrit?.status === 'unassessed',
    'Unmodeled bathroom fixture details, operable control heights, tactile signage, and visual alarms are explicitly reported as insufficient-data or unassessed'
  );

  assert(
    repCompliantRamp.summaryCounts.unassessed +
      repCompliantRamp.summaryCounts.insufficientData >=
      4 &&
      repCompliantRamp.overallReviewState !== 'all-evaluated-criteria-met',
    'Summary counts keep unassessed/insufficient-data strictly separate from meetsConfiguredCriterion'
  );
}

// SECTION E: Improvement Suggestions, Non-Destructive Preview, Safe Apply & Rollback
console.log('\nSection E: Improvement Suggestions, Non-Destructive Preview, Safe Apply & Rollback');
{
  const proj = createBaseTestProject('feet');
  const now = new Date().toISOString();
  // Place a storage cabinet in the middle of the 6x8 ft bathroom so it blocks the 5.0 ft turning circle
  proj.furnitureLayout!.instances.push({
    instanceId: 'inst-blocking-linen',
    templateId: 'tpl-wardrobe',
    projectId: proj.id,
    name: 'Linen Cabinet',
    category: 'storage-cabinetry',
    footprintShape: 'rectangle',
    roomId: 'room-bath',
    floorLevel: 1,
    x: 15.5,
    y: 2.0,
    width: 3.0,
    depth: 2.0,
    height: 6.5,
    unit: 'feet',
    rotationDeg: 0,
    dimensionProvenance: 'user-edited-custom',
    isLocked: false,
    createdAt: now,
    updatedAt: now,
  });

  const beforeRep = evaluateUniversalAccessibility(proj);
  const bathDiagBefore = beforeRep.roomDiagnostics.find((d) => d.roomId === 'room-bath')!;
  assert(
    bathDiagBefore.turningSpaceStatus === 'does-not-meet-configured-criterion',
    'Bathroom with central linen cabinet fails 5.0 ft wheelchair turning circle before remediation'
  );

  const actionableSug = beforeRep.improvementSuggestions.find(
    (s) => s.targetRoomId === 'room-bath' && s.canAutoPreviewAndApply
  );
  assert(
    Boolean(actionableSug),
    `Generated actionable accessibility remediation suggestion: "${actionableSug?.title}"`
  );

  // Non-destructive preview must not mutate `proj`
  const origInstancesCount = proj.furnitureLayout!.instances.length;
  const origX = proj.furnitureLayout!.instances[0].x;
  const preview = previewAccessibilitySuggestion(proj, actionableSug!.suggestionId);

  assert(
    proj.furnitureLayout!.instances.length === origInstancesCount &&
      proj.furnitureLayout!.instances[0].x === origX,
    'previewAccessibilitySuggestion is 100% non-destructive and does not mutate saved project state'
  );
  assert(
    preview.isSafeToApply &&
      preview.resolvedCriterionIds.includes('crit-turn-room-bath') &&
      preview.newlyIntroducedFailureIds.length === 0,
    'Preview verifies that applying the suggestion resolves crit-turn-room-bath without introducing new failures'
  );

  // Apply safely with automatic pre-apply snapshot creation
  const applyResult = applyAccessibilitySuggestionSafely(
    proj,
    actionableSug!.suggestionId
  );
  const bathDiagAfter = applyResult.postApplyReport.roomDiagnostics.find(
    (d) => d.roomId === 'room-bath'
  )!;
  assert(
    bathDiagAfter.turningSpaceStatus === 'meets-configured-criterion' &&
      Boolean(applyResult.snapshotId),
    `applyAccessibilitySuggestionSafely resolved bathroom turning circle (${bathDiagAfter.maxClearInscribedCircleDiameter} ft >= 5.0 ft) and created snapshot ${applyResult.snapshotId}`
  );

  // Rollback to pre-apply snapshot
  const rolledBackProject = rollbackAccessibilityChanges(
    applyResult.updatedProject,
    applyResult.snapshotId
  );
  const reportAfterRollback = evaluateUniversalAccessibility(rolledBackProject);
  const bathDiagRolledBack = reportAfterRollback.roomDiagnostics.find(
    (d) => d.roomId === 'room-bath'
  )!;
  assert(
    bathDiagRolledBack.turningSpaceStatus === 'does-not-meet-configured-criterion' &&
      rolledBackProject.furnitureLayout!.instances.length === origInstancesCount &&
      rolledBackProject.furnitureLayout!.instances[0].x === origX,
    'rollbackAccessibilityChanges faithfully restores pre-apply furniture placement and evaluation state'
  );
}

// SECTION F: Cross-Engine Compatibility (P30 Brief, P31 Comparison, P32 Soft-Preference Guardrail)
console.log('\nSection F: P30 Brief, P31 Option Comparison & P32 Soft-Preference Guardrail');
{
  const proj = createBaseTestProject('feet');
  const now = new Date().toISOString();
  // Add P30 interpreted brief with 1 confirmed requirement and 1 unconfirmed assumption
  proj.brief!.interpretedBrief = {
    id: 'ib-p34-test',
    rawInputText: 'Wheelchair accessible home with roll-in bathroom.',
    normalizedInputText: 'Wheelchair accessible home with roll-in bathroom.',
    interpretedAt: now,
    interpreterMode: 'deterministic-local',
    requestSequenceId: 1,
    projectSummary: 'Wheelchair accessible residence',
    requirements: [
      {
        id: 'req-acc-1',
        category: 'accessibility',
        description:
          'All primary living and bathroom spaces must provide a 60-inch wheelchair turning circle.',
        normalizedValue: 60,
        unit: 'inches',
        priority: 'must-have',
        source: 'explicit',
        reviewStatus: 'confirmed',
        confidence: 'high',
        validationStatus: 'valid',
      },
      {
        id: 'req-acc-unconfirmed',
        category: 'accessibility',
        description:
          'Inferred assumption: automated power door openers on all interior bedroom doors.',
        normalizedValue: true,
        priority: 'preferred',
        source: 'inferred',
        reviewStatus: 'needs-review',
        confidence: 'medium',
        validationStatus: 'valid',
      },
    ],
    assumptions: [],
    conflicts: [],
    clarificationQuestions: [],
    validation: {
      isStructurallyValid: true,
      readyForIntegration: true,
      complianceDisclaimer: 'Non-statutory brief validation',
      structurallyValidItems: [],
      missingNonBlockingItems: [],
      unresolvedConflicts: [],
      confirmedRequirementsCount: 1,
      unverifiedAssumptionsCount: 1,
      professionalVerificationItems: [],
      downstreamCompatibility: [],
    },
  };

  // Add P32 personalization preferences
  proj.designPersonalization = {
    id: 'prof-p34',
    projectId: proj.id,
    version: 'p32-v1',
    createdAt: now,
    updatedAt: now,
    requestSequenceId: 1,
    preferredFacadeStyles: ['Minimalist'],
    preferredPrimaryMaterials: ['timber'],
    preferredCostTiers: ['Balanced Mid-Range'],
    preferredInteriorStyles: ['Minimalist'],
    preferredShadingStyles: ['deep-overhangs'],
    preferredFloors: 1,
    spatialPriorityWeights: {
      opennessAndLivingArea: 80,
      privacyAndZoneSeparation: 50,
      storageAndUtilityCapacity: 60,
      budgetPredictability: 70,
      lowCarbonMaterials: 50,
      compactPlotFootprint: 40,
      naturalLightAndShading: 75,
    },
    roomCategoryPriorities: [],
    budgetRange: {
      minBudget: 250000,
      targetBudget: 350000,
      maxBudget: 400000,
      currency: 'USD',
      isHardCap: false,
      origin: 'explicit-user',
      confirmationStatus: 'confirmed',
    },
    items: [
      {
        id: 'pref-1',
        dimension: 'architectural-style',
        key: 'preferredStyle',
        label: 'Minimalist Style',
        value: 'Minimalist',
        weight: 95,
        origin: 'explicit-user',
        confirmationStatus: 'confirmed',
        isHardConstraint: false,
        sourceReference: 'User input',
        rationale: 'Aesthetic preference',
        updatedAt: now,
      },
    ],
  };

  const report = evaluateUniversalAccessibility(proj);
  assert(
    report.p30P32Alignment.confirmedInterpretedAccessibilityRequirements.length === 1 &&
      report.p30P32Alignment.unconfirmedAccessibilityAssumptions.length === 1,
    'P34 separates confirmed P30 accessibility requirements from unconfirmed P30 assumptions'
  );
  assert(
    report.p30P32Alignment.p32SoftPreferenceGuardrailCheck
      .mandatoryCriteriaOverriddenByPreferences === 0,
    'P32 soft preferences never override or suppress P34 mandatory accessibility criteria'
  );

  const p31Summary = getP34SummaryForOptionComparison(proj, 'opt-a', 'Option A');
  assert(
    p31Summary.unassessedOrInsufficientCount > 0 &&
      p31Summary.caveats.length > 0,
    'P31 comparison export keeps unassessed criteria distinct from passing counts and includes explicit caveats'
  );
}

// SECTION G: Stale Review Detection & Fingerprint Integrity
console.log('\nSection G: Stale Review Detection & Source Fingerprint Integrity');
{
  const proj = createBaseTestProject('feet');
  const rev = ensureProjectAccessibilityReviewData(proj);
  const { updatedProject } = saveProjectAccessibilityReviewSafely(proj, rev, false);

  const freshReport = evaluateUniversalAccessibility(updatedProject);
  assert(
    freshReport.isStale === false,
    'Newly saved accessibility review is not marked stale'
  );

  // Mutate a room dimension -> fingerprint must change and report must be marked stale
  const mutatedProject: Project = JSON.parse(JSON.stringify(updatedProject));
  mutatedProject.floorPlan!.rooms[1].width = 4.2;

  const staleReport = evaluateUniversalAccessibility(mutatedProject);
  assert(
    staleReport.isStale === true &&
      staleReport.sourceFingerprint !== freshReport.sourceFingerprint,
    'Modifying room geometry changes sourceFingerprint and marks previous accessibility review as stale'
  );
}

console.log('\n================================================================');
console.log(`P34 VERIFICATION SUMMARY: ${passed} Passed, ${failed} Failed`);
console.log('================================================================\n');

if (failed > 0) {
  process.exit(1);
}
