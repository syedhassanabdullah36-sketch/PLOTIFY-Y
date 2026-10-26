/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P38 — Daylight & Visual Comfort Analyzer Verification Suite
 * Covers Groups A through I from the P38 Specification:
 *   Group A: Geometry, Unit Normalization & Analysis-Plane Grid Integrity
 *   Group B: Window, Glazing & Shading Representation & Provenance
 *   Group C: Mode A Geometric Daylight Potential & Mode B Solar Position / Shadow Screening
 *   Group D: Mode C Simplified BRE Split-Flux Daylight Factor & Illuminance Calculations
 *   Group E: Mode D Unsupported Annual Climate Metrics (sDA/ASE/DA/UDI = null) & Mode E Visual Comfort, Glare (DGP = null) & View Out
 *   Group F: Mode F Scenario Comparison & Trade-Off Detection
 *   Group G: Cross-Feature Consistency (P30–P37)
 *   Group H: Preview, Atomic Apply, Rollback & Persistence
 *   Group I: Honesty, Non-Fabrication & Anti-Overclaim Guarantees
 */

import { INITIAL_SAMPLE_PROJECTS } from './src/services/storage';
import { Project } from './src/types/project';
import {
  P38_DAYLIGHT_ANALYZER_ENGINE_VERSION,
  P38_DAYLIGHT_SCHEMA_VERSION,
  DaylightWindowRecord,
} from './src/types/daylightComfort';
import {
  convertLengthToMetres,
  convertElevationToMetres,
  convertAreaToSquareMetres,
  initializeProjectDaylightComfortData,
  computeDaylightComfortSourceFingerprint,
  generateRoomAnalysisPlaneGridSI,
  evaluateRoomDaylightGeometrySI,
  evaluateWindowForScenarioSI,
  evaluateModeAGeometricDaylightPotential,
  calculateAnalyticalSolarPosition,
  evaluateModeBSolarAndShading,
  evaluateModeCSimplifiedDaylight,
  evaluateModeDAnnualSimulationStatus,
  evaluateRoomForDaylightScenario,
  compareRoomDaylightScenarios,
  evaluateProjectDaylightComfort,
  previewDaylightRecommendation,
  applyDaylightProposalAtomically,
  rollbackLastDaylightApply,
  getP38DaylightSummaryForComparison,
  DEFAULT_DAYLIGHT_CRITERIA,
} from './src/services/daylightComfortService';

let passedAssertions = 0;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`✗ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  passedAssertions++;
}

function assertApprox(
  actual: number | null | undefined,
  expected: number,
  tolerance: number,
  message: string
): void {
  if (
    actual === null ||
    actual === undefined ||
    !Number.isFinite(actual) ||
    Math.abs(actual - expected) > tolerance
  ) {
    console.error(
      `✗ ASSERTION FAILED: ${message} (expected ~${expected} ± ${tolerance}, got ${actual})`
    );
    process.exit(1);
  }
  passedAssertions++;
}

function cloneProject(proj: Project): Project {
  return JSON.parse(JSON.stringify(proj));
}

console.log('================================================================');
console.log('P38 — DAYLIGHT & VISUAL COMFORT ANALYZER VERIFICATION SUITE');
console.log('================================================================\n');

const baseSample = cloneProject(INITIAL_SAMPLE_PROJECTS[0]);

// ============================================================================
// GROUP A — Geometry, Unit Normalization & Analysis-Plane Grid Integrity
// ============================================================================
console.log('• Group A: Geometry, Unit Normalization & Analysis-Plane Grid Integrity...');
{
  // A1: Feet vs Metres conversion accuracy
  assertApprox(
    convertLengthToMetres(10, 'feet'),
    3.048,
    1e-4,
    '10 feet should equal 3.048 metres'
  );
  assertApprox(
    convertLengthToMetres(5, 'metres'),
    5.0,
    1e-6,
    '5 metres should equal 5.0 metres'
  );
  assertApprox(
    convertAreaToSquareMetres(100, 'feet'),
    9.290304,
    1e-4,
    '100 sq ft should equal 9.290304 m²'
  );
  assert(
    convertElevationToMetres(null, 'metres') === null,
    'Null elevation should remain null'
  );

  // A2: Metric vs Imperial equivalent room geometry produces identical SI dimensions
  const metricProj = cloneProject(baseSample);
  metricProj.unit = 'metres';
  metricProj.floorPlan!.rooms[0].width = 6.0;
  metricProj.floorPlan!.rooms[0].length = 4.0;

  const imperialProj = cloneProject(baseSample);
  imperialProj.unit = 'feet';
  imperialProj.floorPlan!.rooms[0].width = 6.0 / 0.3048;
  imperialProj.floorPlan!.rooms[0].length = 4.0 / 0.3048;

  const mData = initializeProjectDaylightComfortData(metricProj);
  const iData = initializeProjectDaylightComfortData(imperialProj);
  const mRoom = metricProj.floorPlan!.rooms[0];
  const iRoom = imperialProj.floorPlan!.rooms[0];
  mData.roomConfigs[mRoom.id].ceilingHeight = 3.0;
  mData.roomConfigs[mRoom.id].dimensionUnit = 'metres';
  iData.roomConfigs[iRoom.id].ceilingHeight = 3.0 / 0.3048;
  iData.roomConfigs[iRoom.id].dimensionUnit = 'feet';

  const mGeom = evaluateRoomDaylightGeometrySI(
    metricProj,
    mRoom,
    mData.roomConfigs[mRoom.id],
    mData.windows.filter((w) => w.roomId === mRoom.id)
  );
  const iGeom = evaluateRoomDaylightGeometrySI(
    imperialProj,
    iRoom,
    iData.roomConfigs[iRoom.id],
    iData.windows.filter((w) => w.roomId === iRoom.id)
  );

  assertApprox(
    mGeom.floorAreaM2,
    24.0,
    1e-3,
    'Metric 6m x 4m room floor area should be 24.0 m²'
  );
  assertApprox(
    iGeom.floorAreaM2,
    24.0,
    1e-2,
    'Imperial equivalent room floor area should be 24.0 m²'
  );
  assertApprox(
    mGeom.roomVolumeM3,
    72.0,
    1e-2,
    'Metric 6m x 4m x 3m room volume should be 72.0 m³'
  );
  assertApprox(
    iGeom.roomVolumeM3,
    72.0,
    1e-1,
    'Imperial equivalent room volume should be 72.0 m³'
  );

  // A3: Work-plane grid generation within perimeter margins
  const grid = generateRoomAnalysisPlaneGridSI(
    6.0,
    4.0,
    0.8,
    0.5,
    1.0,
    ['south']
  );
  assert(
    grid.points.length > 0,
    'Work-plane analysis grid should generate interior points'
  );
  for (const pt of grid.points) {
    assert(
      pt.localXMetres > 0 && pt.localXMetres < 6.0,
      `Grid point X (${pt.localXMetres}) must lie strictly inside room width (6.0)`
    );
    assert(
      pt.localYMetres > 0 && pt.localYMetres < 4.0,
      `Grid point Y (${pt.localYMetres}) must lie strictly inside room length (4.0)`
    );
  }
}
console.log('  ✓ Group A Passed');

// ============================================================================
// GROUP B — Window, Glazing & Shading Representation & Provenance
// ============================================================================
console.log('• Group B: Window, Glazing & Shading Representation & Provenance...');
{
  const proj = cloneProject(baseSample);
  proj.unit = 'metres';
  const dData = initializeProjectDaylightComfortData(proj);
  const room = proj.floorPlan!.rooms[0];
  const rConfig = dData.roomConfigs[room.id];
  rConfig.ceilingHeight = 3.0;
  rConfig.dimensionUnit = 'metres';
  const geom = evaluateRoomDaylightGeometrySI(proj, room, rConfig, []);
  const scenario = dData.scenarios[0];

  // B1: Gross vs Net glazed area with frame fraction f_frame = 0.20
  const testWin: DaylightWindowRecord = {
    windowId: 'win-test-b1',
    roomId: room.id,
    label: 'South Test Window',
    wallEdge: 'south',
    floorLevel: 1,
    offsetAlongWall: 0.5,
    grossWidth: 2.0,
    grossHeight: 1.5,
    sillHeight: 0.9,
    headHeight: 2.4,
    dimensionUnit: 'metres',
    dimensionProvenance: 'user-entered',
    frameFraction: 0.2,
    frameFractionProvenance: 'user-entered',
    explicitGlazedAreaInUnitSq: null,
    visibleTransmittanceVT: 0.7,
    vtProvenance: 'user-entered',
    glazingAssemblyKind: 'double-clear-igu',
    maintenanceFactorM: 0.9,
    maintenanceProvenance: 'traceable-generic-reference',
    revealDepth: 0.15,
    exteriorShadingType: 'horizontal-overhang',
    overhangProjectionDepth: 0.6,
    overhangHeightAboveWindowHead: 0.1,
    sideFinProjectionDepth: null,
    exteriorLouverCutoffAngleDeg: null,
    interiorShadingType: 'sheer-diffusing-roller-blind',
    defaultBlindState: 'retracted-open',
    interiorBlindTransmittanceMultiplier: 0.35,
    interiorBlindProvenance: 'user-entered',
    operabilityStatus: 'operable',
  };

  const evalWin = evaluateWindowForScenarioSI(
    proj,
    room,
    geom,
    testWin,
    scenario,
    []
  );
  assertApprox(
    evalWin.grossOpeningAreaM2,
    3.0,
    1e-4,
    'Gross window area for 2.0m x 1.5m window should be 3.0 m²'
  );
  assertApprox(
    evalWin.netGlazedAreaM2,
    2.4,
    1e-4,
    'Net glazed area with 20% frame fraction should be 2.4 m²'
  );
  assertApprox(
    evalWin.headHeightMetres,
    2.4,
    1e-4,
    'Window head height (0.9m sill + 1.5m height) should be 2.4m'
  );
  assertApprox(
    evalWin.effectiveTransmittanceT,
    0.7,
    1e-4,
    'Effective VT when blind is retracted should equal bare VT (0.70)'
  );

  // B2: Deployed blind transmittance multiplier
  const deployedWin: DaylightWindowRecord = {
    ...testWin,
    defaultBlindState: 'fully-deployed-closed',
  };
  const evalDeployed = evaluateWindowForScenarioSI(
    proj,
    room,
    geom,
    deployedWin,
    scenario,
    []
  );
  assertApprox(
    evalDeployed.effectiveTransmittanceT,
    0.7 * 0.35,
    1e-4,
    'Effective VT when blind is fully deployed should be 0.70 * 0.35 = 0.245'
  );

  // B3: Missing window height from P33 width-only opening must NOT be fabricated
  const p33WidthOnlyWin: DaylightWindowRecord = {
    ...testWin,
    windowId: 'win-p33-width-only',
    grossHeight: null,
    headHeight: null,
    dimensionProvenance: 'derived-from-project-geometry',
    visibleTransmittanceVT: null,
    vtProvenance: 'unavailable-or-unverified',
  };
  const evalMissing = evaluateWindowForScenarioSI(
    proj,
    room,
    geom,
    p33WidthOnlyWin,
    scenario,
    []
  );
  assert(
    evalMissing.grossHeightMetres === null &&
      evalMissing.netGlazedAreaM2 === null,
    'Missing window height must result in null grossHeightMetres and null netGlazedAreaM2 (never fabricated)'
  );
  assert(
    evalMissing.effectiveTransmittanceT === null,
    'Missing visible transmittance VT must result in null effectiveTransmittanceT (never fabricated)'
  );
}
console.log('  ✓ Group B Passed');

// ============================================================================
// GROUP C — Mode A Geometric Daylight Potential & Mode B Solar Position / Shadow Screening
// ============================================================================
console.log('• Group C: Mode A Geometric Daylight Potential & Mode B Solar Position / Shadow Screening...');
{
  const proj = cloneProject(baseSample);
  proj.unit = 'metres';
  const room = proj.floorPlan!.rooms[0];
  room.width = 5.0;
  room.length = 6.0; // Deep room if window is on south wall (depth = 6.0m)
  const dData = initializeProjectDaylightComfortData(proj);
  const rConfig = dData.roomConfigs[room.id];
  rConfig.ceilingHeight = 2.8;
  rConfig.dimensionUnit = 'metres';

  const testWin: DaylightWindowRecord = {
    windowId: 'win-c1',
    roomId: room.id,
    label: 'South Window',
    wallEdge: 'south',
    floorLevel: 1,
    offsetAlongWall: 0.5,
    grossWidth: 2.0,
    grossHeight: 1.3,
    sillHeight: 0.9, // headHeight = 2.2m -> L/H_head = 6.0 / 2.2 = 2.73 > 2.5
    headHeight: 2.2,
    dimensionUnit: 'metres',
    dimensionProvenance: 'user-entered',
    frameFraction: 0.15,
    frameFractionProvenance: 'traceable-generic-reference',
    explicitGlazedAreaInUnitSq: null,
    visibleTransmittanceVT: 0.68,
    vtProvenance: 'user-entered',
    glazingAssemblyKind: 'double-clear-igu',
    maintenanceFactorM: 0.9,
    maintenanceProvenance: 'traceable-generic-reference',
    revealDepth: 0.15,
    exteriorShadingType: 'none',
    overhangProjectionDepth: null,
    overhangHeightAboveWindowHead: 0.1,
    sideFinProjectionDepth: null,
    exteriorLouverCutoffAngleDeg: null,
    interiorShadingType: 'sheer-diffusing-roller-blind',
    defaultBlindState: 'retracted-open',
    interiorBlindTransmittanceMultiplier: 0.35,
    interiorBlindProvenance: 'user-entered',
    operabilityStatus: 'operable',
  };

  const geom = evaluateRoomDaylightGeometrySI(proj, room, rConfig, [testWin]);
  const scenario = dData.scenarios[0];
  const evalWindows = [
    evaluateWindowForScenarioSI(proj, room, geom, testWin, scenario, []),
  ];
  const modeA = evaluateModeAGeometricDaylightPotential(
    geom,
    evalWindows,
    [],
    DEFAULT_DAYLIGHT_CRITERIA,
    true
  );

  assertApprox(
    modeA.totalGrossWindowAreaM2,
    2.6,
    1e-3,
    'Gross window area should be 2.0 * 1.3 = 2.6 m²'
  );
  assertApprox(
    modeA.totalNetGlazedAreaM2,
    2.21,
    1e-3,
    'Net glazed area should be 2.6 * 0.85 = 2.21 m²'
  );
  assertApprox(
    modeA.netGlazedToFloorAreaRatioPercent,
    (2.21 / 30.0) * 100,
    1e-2,
    'Net glazed-to-floor ratio should be (2.21 / 30) * 100 = 7.37%'
  );
  assertApprox(
    modeA.depthToWindowHeadRatio,
    6.0 / 2.2,
    0.02,
    'Depth to window head height ratio should be 6.0 / 2.2 = 2.73'
  );
  assert(
    modeA.exceedsLimitingDepthHeuristic === true,
    '6.0m room depth with 2.2m window head height should exceed 2.5x limiting depth heuristic'
  );

  // Mode B: Analytical solar position at 40°N on Vernal Equinox vs Summer Solstice vs Winter Solstice
  const posEq = calculateAnalyticalSolarPosition({
    latitudeDeg: 40.0,
    longitudeDeg: 0.0,
    timeZoneUtcOffsetHours: 0,
    isDaylightSavingTime: false,
    analysisDateIso: '2026-03-21',
    analysisLocalTime24h: '12:00',
  });
  const posSum = calculateAnalyticalSolarPosition({
    latitudeDeg: 40.0,
    longitudeDeg: 0.0,
    timeZoneUtcOffsetHours: 0,
    isDaylightSavingTime: false,
    analysisDateIso: '2026-06-21',
    analysisLocalTime24h: '12:00',
  });
  const posWin = calculateAnalyticalSolarPosition({
    latitudeDeg: 40.0,
    longitudeDeg: 0.0,
    timeZoneUtcOffsetHours: 0,
    isDaylightSavingTime: false,
    analysisDateIso: '2026-12-21',
    analysisLocalTime24h: '12:00',
  });

  assert(
    posSum.solarAltitudeDeg! > posEq.solarAltitudeDeg! &&
      posEq.solarAltitudeDeg! > posWin.solarAltitudeDeg!,
    `Solar altitude at 40°N noon must satisfy Summer (${posSum.solarAltitudeDeg}°) > Equinox (${posEq.solarAltitudeDeg}°) > Winter (${posWin.solarAltitudeDeg}°)`
  );

  // Overhang shadow reduction check
  const modeBUnshaded = evaluateModeBSolarAndShading(
    geom,
    evalWindows,
    scenario.environmentalConditions
  );

  const shadedWinRecord: DaylightWindowRecord = {
    ...testWin,
    exteriorShadingType: 'horizontal-overhang',
    overhangProjectionDepth: 1.0, // 1.0m overhang on south window
  };
  const evalWindowsShaded = [
    evaluateWindowForScenarioSI(proj, room, geom, shadedWinRecord, scenario, []),
  ];
  const modeBShaded = evaluateModeBSolarAndShading(
    geom,
    evalWindowsShaded,
    scenario.environmentalConditions
  );

  assert(
    modeBShaded.windowSolarExposures[0].overhangVerticalShadowMetres >
      modeBUnshaded.windowSolarExposures[0].overhangVerticalShadowMetres,
    '1.0m overhang must increase vertical shadow drop on south window'
  );
  assert(
    modeBShaded.windowSolarExposures[0].directSunlitGlazedFraction <
      modeBUnshaded.windowSolarExposures[0].directSunlitGlazedFraction,
    '1.0m overhang must reduce direct sunlit glazed fraction on south window'
  );
}
console.log('  ✓ Group C Passed');

// ============================================================================
// GROUP D — Mode C Simplified BRE Split-Flux Daylight Factor & Illuminance
// ============================================================================
console.log('• Group D: Mode C Simplified BRE Split-Flux Daylight Factor & Illuminance...');
{
  const proj = cloneProject(baseSample);
  proj.unit = 'metres';
  const room = proj.floorPlan!.rooms[0];
  room.width = 5.0;
  room.length = 4.0; // A_floor = 20 m²
  const dData = initializeProjectDaylightComfortData(proj);
  const rConfig = dData.roomConfigs[room.id];
  rConfig.ceilingHeight = 3.0; // Perimeter = 18m -> A_walls = 54m², A_total = 20 + 20 + 54 = 94 m²
  rConfig.dimensionUnit = 'metres';
  rConfig.ceilingReflectance = 0.75;
  rConfig.wallReflectance = 0.55;
  rConfig.floorReflectance = 0.30;

  const winD1: DaylightWindowRecord = {
    windowId: 'win-d1',
    roomId: room.id,
    label: 'South Window D1',
    wallEdge: 'south',
    floorLevel: 1,
    offsetAlongWall: 0.5,
    grossWidth: 2.5,
    grossHeight: 1.6,
    sillHeight: 0.9,
    headHeight: 2.5,
    dimensionUnit: 'metres',
    dimensionProvenance: 'user-entered',
    frameFraction: 0.15, // A_gross = 4.0 m², A_g = 3.4 m²
    frameFractionProvenance: 'user-entered',
    explicitGlazedAreaInUnitSq: null,
    visibleTransmittanceVT: 0.7,
    vtProvenance: 'user-entered',
    glazingAssemblyKind: 'double-clear-igu',
    maintenanceFactorM: 0.9,
    maintenanceProvenance: 'traceable-generic-reference',
    revealDepth: 0.15,
    exteriorShadingType: 'none',
    overhangProjectionDepth: null,
    overhangHeightAboveWindowHead: 0,
    sideFinProjectionDepth: null,
    exteriorLouverCutoffAngleDeg: null,
    interiorShadingType: 'none',
    defaultBlindState: 'retracted-open',
    interiorBlindTransmittanceMultiplier: null,
    interiorBlindProvenance: 'unavailable-or-unverified',
    operabilityStatus: 'operable',
  };

  const geom = evaluateRoomDaylightGeometrySI(proj, room, rConfig, [winD1]);
  const scenario = dData.scenarios[0];
  const evalWindows = [
    evaluateWindowForScenarioSI(proj, room, geom, winD1, scenario, []),
  ];
  const modeC = evaluateModeCSimplifiedDaylight(
    geom,
    rConfig,
    evalWindows,
    scenario,
    DEFAULT_DAYLIGHT_CRITERIA,
    undefined
  );

  assert(
    modeC.meanDaylightFactorPercent !== null &&
      modeC.meanDaylightFactorPercent > 2.0,
    `BRE Split-Flux Mean Daylight Factor (${modeC.meanDaylightFactorPercent}%) should exceed 2.0%`
  );
  assert(
    modeC.estimatedOvercastMeanIlluminanceLux !== null &&
      modeC.estimatedOvercastMeanIlluminanceLux > 200,
    'Estimated overcast mean illuminance under 10,000 lux reference sky should exceed 200 lux'
  );
  assert(
    modeC.meetsMeanDfTarget === true,
    'Mean DF should meet the >= 2.0% advisory benchmark'
  );

  // D2: Higher surface reflectances increase Mean DF
  const highReflConfig = JSON.parse(JSON.stringify(rConfig));
  highReflConfig.ceilingReflectance = 0.88;
  highReflConfig.wallReflectance = 0.78;
  highReflConfig.floorReflectance = 0.45;
  const modeCHighRefl = evaluateModeCSimplifiedDaylight(
    geom,
    highReflConfig,
    evalWindows,
    scenario,
    DEFAULT_DAYLIGHT_CRITERIA,
    undefined
  );
  assert(
    modeCHighRefl.meanDaylightFactorPercent! >
      modeC.meanDaylightFactorPercent!,
    'Increasing interior surface reflectances must increase inter-reflected Mean Daylight Factor'
  );

  // D3: External obstruction reduces sky angle theta and lowers Mean DF
  const evalWindowsObstructed = [
    evaluateWindowForScenarioSI(proj, room, geom, winD1, scenario, [
      {
        obstructionId: 'obs-1',
        label: 'Tall Opposite Building',
        wallEdge: 'south',
        horizontalDistance: 8.0,
        obstructionTopElevation: 12.0,
        dimensionUnit: 'metres',
        provenance: 'user-entered',
        sourceNote: 'Test obstruction',
      },
    ]),
  ];
  const modeCObstructed = evaluateModeCSimplifiedDaylight(
    geom,
    rConfig,
    evalWindowsObstructed,
    scenario,
    DEFAULT_DAYLIGHT_CRITERIA,
    undefined
  );
  assert(
    evalWindowsObstructed[0].visibleVerticalSkyAngleDeg < 90,
    'External obstruction must reduce visible vertical sky angle theta below 90°'
  );
  assert(
    modeCObstructed.meanDaylightFactorPercent! <
      modeC.meanDaylightFactorPercent!,
    'External obstruction must reduce Mean Daylight Factor'
  );
}
console.log('  ✓ Group D Passed');

// ============================================================================
// GROUP E — Mode D Unsupported Annual Metrics & Mode E Glare / View Out
// ============================================================================
console.log('• Group E: Mode D Unsupported Annual Metrics & Mode E Glare / View Out...');
{
  const proj = cloneProject(baseSample);
  const dData = initializeProjectDaylightComfortData(proj);
  const modeD = evaluateModeDAnnualSimulationStatus(
    dData.scenarios[0].environmentalConditions
  );
  assert(
    modeD.isAnnualEngineImplemented === false,
    'Mode D must explicitly report isAnnualEngineImplemented = false'
  );
  assert(
    modeD.sDA_300_50_Percent === null &&
      modeD.ASE_1000_250_Percent === null &&
      modeD.daylightAutonomyPercent === null &&
      modeD.usefulDaylightIlluminancePercent === null,
    'sDA, ASE, DA, and UDI must all be explicitly null (never fabricated)'
  );

  const report = evaluateProjectDaylightComfort(proj);
  const rmEval = report.allRoomEvaluationsForActiveScenario.find(
    (r) => r.evaluatedWindows.length > 0
  )!;

  assert(
    rmEval.modeE_VisualComfortGlareView.isQuantitativeDgpSupported === false &&
      rmEval.modeE_VisualComfortGlareView.daylightGlareProbabilityDGP === null,
    'Luminance-based DGP must be explicitly null (requires HDR eye-level field)'
  );
  assert(
    rmEval.modeE_VisualComfortGlareView.viewOutAssessment
      .horizontalViewAngleFromRoomCentreDeg !== null &&
      rmEval.modeE_VisualComfortGlareView.viewOutAssessment
        .horizontalViewAngleFromRoomCentreDeg > 0,
    'Horizontal view-out angle from room centre must be positive for rooms with exterior windows'
  );
}
console.log('  ✓ Group E Passed');

// ============================================================================
// GROUP F — Mode F Scenario Comparison & Trade-Off Detection
// ============================================================================
console.log('• Group F: Mode F Scenario Comparison & Trade-Off Detection...');
{
  const proj = cloneProject(baseSample);
  const dData = initializeProjectDaylightComfortData(proj);
  const room = proj.floorPlan!.rooms[0];
  dData.roomConfigs[room.id].ceilingHeight = 9.5;

  const scenA = dData.scenarios[0];
  const scenB = JSON.parse(JSON.stringify(dData.scenarios[1]));
  const roomWin = dData.windows.find((w) => w.roomId === room.id)!;
  scenB.windowOverrides[roomWin.windowId] = {
    windowId: roomWin.windowId,
    blindDeploymentState: 'fully-deployed-closed',
  };

  const evalA = evaluateRoomForDaylightScenario(proj, room, dData, scenA);
  const evalB = evaluateRoomForDaylightScenario(proj, room, dData, scenB);

  const comp = compareRoomDaylightScenarios(evalA, evalB, scenA, scenB);

  assert(
    comp.baselineScenarioId === scenA.scenarioId &&
      comp.comparedScenarioId === scenB.scenarioId,
    'Scenario comparison IDs must match Scenario A and Scenario B'
  );
  assert(
    comp.deltaMeanDaylightFactorPercent !== null &&
      comp.deltaMeanDaylightFactorPercent < 0,
    'Deploying blind in Scenario B must reduce Mean Daylight Factor relative to unshaded Scenario A'
  );
  assert(
    comp.changedInputsSummary.length > 0,
    'Scenario comparison must list changed inputs'
  );
}
console.log('  ✓ Group F Passed');

// ============================================================================
// GROUP G — Cross-Feature Consistency (P30–P37)
// ============================================================================
console.log('• Group G: Cross-Feature Consistency (P30–P37)...');
{
  const proj = cloneProject(baseSample);
  const report = evaluateProjectDaylightComfort(proj);

  assert(
    typeof report.p35MaterialIntegration
      .noOpticalInferenceFromMaterialCategoryNote === 'string' &&
      report.p35MaterialIntegration.noOpticalInferenceFromMaterialCategoryNote
        .length > 0,
    'P35 climate/material integration note must be populated'
  );
  assert(
    typeof report.p37NaturalVentilationIntegration
      .p37StaleIfWindowModifiedNote === 'string',
    'P37 natural ventilation integration note must be populated'
  );

  // P31 comparison export
  const p31Summaries = getP38DaylightSummaryForComparison(proj);
  assert(
    Array.isArray(p31Summaries) && p31Summaries.length > 0,
    'P31 comparison export must return option summaries'
  );
  assert(
    p31Summaries[0].calculationMethodVersion ===
      P38_DAYLIGHT_ANALYZER_ENGINE_VERSION,
    'P31 comparison export must include P38 engine version'
  );
}
console.log('  ✓ Group G Passed');

// ============================================================================
// GROUP H — Preview, Atomic Apply, Rollback & Persistence
// ============================================================================
console.log('• Group H: Preview, Atomic Apply, Rollback & Persistence...');
{
  const proj = cloneProject(baseSample);
  const dData = initializeProjectDaylightComfortData(proj);
  const room = proj.floorPlan!.rooms[0];
  // Set ceilingHeight to null so a high-priority recommendation to specify ceiling height is generated
  dData.roomConfigs[room.id].ceilingHeight = null;
  proj.daylightComfort = dData;

  const evalBefore = evaluateProjectDaylightComfort(proj);
  const allRecs = evalBefore.allRoomEvaluationsForActiveScenario.flatMap(
    (r) => r.recommendations
  );
  const targetRec = allRecs.find((r) => r.canPreviewAndApplyInPlotify)!;
  assert(
    Boolean(targetRec),
    'Room with missing ceiling height must generate an actionable P38 recommendation'
  );

  // H1: Non-destructive preview must not mutate live project
  const ceilingBeforePreview =
    proj.daylightComfort.roomConfigs[room.id].ceilingHeight;
  const previewDiff = previewDaylightRecommendation(
    proj,
    targetRec.recommendationId
  );
  assert(
    previewDiff.isSafeToApply === true,
    'Preview diff must be marked safe to apply'
  );
  assert(
    proj.daylightComfort.roomConfigs[room.id].ceilingHeight ===
      ceilingBeforePreview,
    'previewDaylightRecommendation must NOT mutate the original project'
  );

  // H2: Stale preview rejection if project changes before apply
  const mutatedProj = cloneProject(proj);
  mutatedProj.floorPlan!.rooms[0].width += 2.0;
  const staleApplyRes = applyDaylightProposalAtomically(
    mutatedProj,
    previewDiff
  );
  assert(
    staleApplyRes.applied === false,
    'Stale preview must be rejected when underlying project fingerprint changes'
  );

  // H3: Atomic apply creates snapshot and updates project
  const validApplyRes = applyDaylightProposalAtomically(proj, previewDiff);
  assert(
    validApplyRes.applied === true && validApplyRes.snapshotId !== null,
    'Valid preview must apply atomically and record a pre-apply snapshot ID'
  );
  assert(
    validApplyRes.updatedProject.daylightComfort?.lastPreApplySnapshotId ===
      validApplyRes.snapshotId,
    'Updated project must persist lastPreApplySnapshotId'
  );

  // H4: Rollback restores exact pre-apply state
  const rollbackRes = rollbackLastDaylightApply(validApplyRes.updatedProject);
  assert(
    rollbackRes.rolledBack === true,
    'rollbackLastDaylightApply must succeed'
  );
  assert(
    rollbackRes.restoredProject.daylightComfort?.roomConfigs[room.id]
      .ceilingHeight === ceilingBeforePreview,
    'Rolled-back project must restore original ceiling height (null)'
  );
}
console.log('  ✓ Group H Passed');

// ============================================================================
// GROUP I — Honesty, Non-Fabrication & Anti-Overclaim Guarantees
// ============================================================================
console.log('• Group I: Honesty, Non-Fabrication & Anti-Overclaim Guarantees...');
{
  // I1: Clearing VT to null transitions room to insufficient-evidence and blocks Mean DF
  const proj = cloneProject(baseSample);
  const dData = initializeProjectDaylightComfortData(proj);
  const room = proj.floorPlan!.rooms[0];
  dData.roomConfigs[room.id].ceilingHeight = 9.5;
  dData.windows.forEach((w) => {
    if (w.roomId === room.id) {
      w.visibleTransmittanceVT = null;
      w.vtProvenance = 'unavailable-or-unverified';
      w.reportedUFactorWPerM2K = 1.4;
      w.reportedShgc = 0.38;
    }
  });
  proj.daylightComfort = dData;

  const rep = evaluateProjectDaylightComfort(proj);
  const rmEval = rep.allRoomEvaluationsForActiveScenario.find(
    (r) => r.roomId === room.id
  )!;
  assert(
    rmEval.completenessState === 'insufficient-evidence',
    `Room with missing VT must be 'insufficient-evidence' even if U-factor/SHGC are present (got ${rmEval.completenessState})`
  );
  assert(
    rmEval.modeC_SimplifiedDaylight.meanDaylightFactorPercent === null,
    'Mean Daylight Factor must be null when VT is missing (never inferred from U-factor or SHGC)'
  );

  // I2: All configured criteria are explicitly labelled advisory-reference & unverified-screening-benchmark
  for (const crit of DEFAULT_DAYLIGHT_CRITERIA) {
    assert(
      crit.authorityStatus === 'advisory-reference' &&
        crit.verificationStatus === 'unverified-screening-benchmark',
      `Criterion ${crit.criterionId} must be marked advisory-reference and unverified-screening-benchmark`
    );
    assert(
      crit.nonComplianceDisclaimer.length > 20,
      `Criterion ${crit.criterionId} must include a non-compliance disclaimer`
    );
  }

  // I3: Engine & Schema version constants
  assert(
    P38_DAYLIGHT_ANALYZER_ENGINE_VERSION ===
      'p38-daylight-visual-comfort-v1.0.0' &&
      P38_DAYLIGHT_SCHEMA_VERSION === '1.0.0',
    'P38 engine and schema versions must match contract'
  );
}
console.log('  ✓ Group I Passed');

console.log('\n================================================================');
console.log(
  `✓ ALL ${passedAssertions} P38 DAYLIGHT & VISUAL COMFORT ASSERTIONS PASSED!`
);
console.log('================================================================');
