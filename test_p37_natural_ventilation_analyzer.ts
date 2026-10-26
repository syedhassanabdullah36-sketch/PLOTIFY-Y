/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P37 — Natural Ventilation Scenario Analyzer Verification Suite
 * Account A | Locked Roadmap: P37 of P30–P40
 *
 * Verifies Groups A through J per P37 Section 23.
 */

import assert from 'assert';
import { INITIAL_SAMPLE_PROJECTS } from './src/services/storage';
import { Project } from './src/types/project';
import {
  applyVentilationProposalAtomically,
  compareRoomVentilationScenarios,
  computeAngularDifferenceDeg,
  computeNaturalVentilationSourceFingerprint,
  computeSeriesOrificeConductanceM2,
  convertAreaToSquareMetres,
  convertLengthToMetres,
  evaluateModeAGeometricPotential,
  evaluateModeCQuantifiedAirflowEstimate,
  evaluateOpeningForScenarioSI,
  evaluateProjectNaturalVentilation,
  evaluateRoomForScenario,
  evaluateRoomVentilationGeometry,
  getP37NaturalVentilationSummaryForComparison,
  getWallCompassAzimuthDeg,
  initializeProjectNaturalVentilationData,
  P37_NATURAL_VENTILATION_ENGINE_VERSION,
  P37_TECHNICAL_REFERENCES,
  previewVentilationRecommendation,
  rollbackLastVentilationApply,
  round2,
  round4,
} from './src/services/naturalVentilationService';
import { VentilationOpeningRecord } from './src/types/naturalVentilation';

console.log('================================================================');
console.log('P37 — NATURAL VENTILATION SCENARIO ANALYZER VERIFICATION SUITE');
console.log('================================================================\n');

let passedAssertions = 0;
function verify(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passedAssertions++;
}

function createBaseTestProject(): Project {
  const sample = JSON.parse(JSON.stringify(INITIAL_SAMPLE_PROJECTS[0])) as Project;
  sample.unit = 'metres';
  sample.floorPlan = {
    rooms: [
      {
        id: 'rm-living',
        name: 'Living Room',
        type: 'living',
        x: 0,
        y: 0,
        width: 6.0,
        length: 5.0,
        floorLevel: 1,
      },
      {
        id: 'rm-study',
        name: 'Quiet Study',
        type: 'office',
        x: 6.0,
        y: 0,
        width: 4.0,
        length: 5.0,
        floorLevel: 1,
      },
    ],
    gridSnap: 0.5,
    showGrid: true,
  };
  return sample;
}

// ============================================================================
// GROUP A — Geometry and Unit Conversion
// ============================================================================
console.log('• Group A: Room Geometry, Unit Conversion & Orientation...');
{
  const lenMFromFt = convertLengthToMetres(10, 'feet');
  verify(lenMFromFt !== null && Math.abs(lenMFromFt - 3.048) < 1e-6, '10 ft converts to 3.048 m');

  const areaM2FromSqFt = convertAreaToSquareMetres(100, 'feet');
  verify(
    areaM2FromSqFt !== null && Math.abs(areaM2FromSqFt - 9.290304) < 1e-5,
    '100 sq ft converts to 9.290304 m²'
  );

  verify(convertLengthToMetres(0, 'metres') === null, 'Zero length rejected');
  verify(convertLengthToMetres(-4, 'metres') === null, 'Negative length rejected');
  verify(convertLengthToMetres(Number.NaN, 'metres') === null, 'NaN length rejected');

  const proj = createBaseTestProject();
  const nvData = initializeProjectNaturalVentilationData(proj);
  const livingRoom = proj.floorPlan!.rooms[0];

  // Initially ceilingHeight is null -> roomVolumeM3 must be null
  const geomNoHeight = evaluateRoomVentilationGeometry(
    proj,
    livingRoom,
    nvData.roomConfigs['rm-living'],
    nvData.openings,
    nvData.scenarios[0]
  );
  verify(geomNoHeight.floorAreaM2 === 30.0, 'Floor area 6m x 5m = 30.0 m²');
  verify(
    geomNoHeight.roomVolumeM3 === null && !geomNoHeight.isVolumeValid,
    'Room volume is withheld when ceilingHeight is null'
  );
  verify(
    geomNoHeight.exteriorWallEdges.includes('north') &&
      geomNoHeight.exteriorWallEdges.includes('south') &&
      geomNoHeight.exteriorWallEdges.includes('west') &&
      !geomNoHeight.exteriorWallEdges.includes('east'),
    'East wall shared with Quiet Study is detected as interior partition; N/S/W are exterior'
  );

  // Set ceiling height to 3.0 m
  nvData.roomConfigs['rm-living'].ceilingHeight = 3.0;
  nvData.roomConfigs['rm-living'].ceilingHeightProvenance = 'user-entered';
  const geomWithHeight = evaluateRoomVentilationGeometry(
    proj,
    livingRoom,
    nvData.roomConfigs['rm-living'],
    nvData.openings,
    nvData.scenarios[0]
  );
  verify(
    geomWithHeight.roomVolumeM3 === 90.0 && geomWithHeight.isVolumeValid,
    'Room volume is 30 m² x 3.0 m = 90.0 m³ when height is configured'
  );

  // Compass azimuth & angular difference
  verify(getWallCompassAzimuthDeg('south', 15) === 195, 'South wall with +15° offset = 195°');
  verify(computeAngularDifferenceDeg(350, 10) === 20, 'Angular wrap across 0°/360° = 20°');
}
console.log('  ✓ Group A passed');

// ============================================================================
// GROUP B — Opening Operability and Free-Area Logic
// ============================================================================
console.log('• Group B: Opening Operability, Gross vs. Openable vs. Effective Free Area...');
{
  const proj = createBaseTestProject();
  const nvData = initializeProjectNaturalVentilationData(proj);
  nvData.roomConfigs['rm-living'].ceilingHeight = 3.0;
  const livingRoom = proj.floorPlan!.rooms[0];
  const geom = evaluateRoomVentilationGeometry(
    proj,
    livingRoom,
    nvData.roomConfigs['rm-living'],
    [],
    nvData.scenarios[0]
  );

  // 1. Unknown operability opening -> never assumed operable
  const unknownOp: VentilationOpeningRecord = {
    openingId: 'op-unknown',
    roomId: 'rm-living',
    label: 'Unverified Window',
    category: 'window',
    boundaryLocation: 'exterior-envelope',
    wallEdge: 'south',
    floorLevel: 1,
    operabilityStatus: 'unknown',
    operabilityProvenance: 'unavailable-or-unverified',
    mechanismType: 'unknown',
    grossWidth: 1.5,
    grossHeight: 1.2,
    dimensionUnit: 'metres',
    dimensionProvenance: 'user-entered',
    explicitClearOpenableAreaInUnitSq: null,
    maxOpenableFraction: 0.5,
    openableFractionProvenance: 'scenario-assumption',
    screenOrGrilleFactor: 1.0,
    obstructionFactor: 1.0,
    sillElevation: 0.9,
    headElevation: null,
    elevationProvenance: 'user-entered',
    dischargeCoefficientCd: 0.62,
    cdProvenance: 'traceable-technical-reference',
    defaultScenarioState: 'fully-open',
    defaultScenarioOpenFraction: 1.0,
    rainProtectionKind: 'protected-by-overhang-or-louvre',
    hasSecurityRestrictorOrNightLatch: true,
  };
  const evalUnknown = evaluateOpeningForScenarioSI(
    proj,
    livingRoom,
    geom,
    unknownOp,
    nvData.scenarios[0]
  );
  verify(evalUnknown.grossAreaM2 === 1.8, 'Gross area is 1.5 x 1.2 = 1.8 m²');
  verify(
    evalUnknown.maxOpenableAreaM2 === null && evalUnknown.effectiveScenarioFreeAreaM2 === null,
    'Unknown operability window never produces a fabricated openable area'
  );

  // 2. Fixed window -> 0 m² openable area
  const fixedOp: VentilationOpeningRecord = {
    ...unknownOp,
    openingId: 'op-fixed',
    operabilityStatus: 'fixed',
    mechanismType: 'fixed-glazing',
  };
  const evalFixed = evaluateOpeningForScenarioSI(
    proj,
    livingRoom,
    geom,
    fixedOp,
    nvData.scenarios[0]
  );
  verify(
    evalFixed.maxOpenableAreaM2 === 0 && evalFixed.effectiveScenarioFreeAreaM2 === 0,
    'Fixed glazing has 0 m² max openable and 0 m² effective free area'
  );

  // 3. Operable window with 50% sliding fraction, 0.90 screen factor, and partially-open (0.5) scenario state
  const operableOp: VentilationOpeningRecord = {
    ...unknownOp,
    openingId: 'op-sliding',
    operabilityStatus: 'operable',
    mechanismType: 'sliding-horizontal',
    grossWidth: 2.0,
    grossHeight: 1.5, // gross = 3.0 m²
    maxOpenableFraction: 0.5, // max openable = 1.5 m²
    screenOrGrilleFactor: 0.9,
    obstructionFactor: 1.0,
    defaultScenarioState: 'partially-open',
    defaultScenarioOpenFraction: 0.5, // A_eff = 1.5 * 0.5 * 0.9 = 0.675 m²
  };
  const evalOperable = evaluateOpeningForScenarioSI(
    proj,
    livingRoom,
    geom,
    operableOp,
    nvData.scenarios[0]
  );
  verify(evalOperable.grossAreaM2 === 3.0, 'Gross area = 3.0 m²');
  verify(evalOperable.maxOpenableAreaM2 === 1.5, 'Max openable area = 1.5 m²');
  verify(
    evalOperable.effectiveScenarioFreeAreaM2 === 0.675,
    'Effective scenario free area A_eff = 1.5 * 0.5 * 0.9 = 0.675 m²'
  );
  verify(
    evalOperable.cdTimesEffectiveAreaM2 === round4(0.62 * 0.675),
    'C_d * A_eff computed accurately'
  );
}
console.log('  ✓ Group B passed');

// ============================================================================
// GROUP C — Airflow Path Classification (Single-Sided, Cross, Stack, Internal Transfer)
// ============================================================================
console.log('• Group C: Airflow Path Discovery & Strategy Classification...');
{
  const proj = createBaseTestProject();
  const nvData = initializeProjectNaturalVentilationData(proj);
  nvData.roomConfigs['rm-living'].ceilingHeight = 3.0;
  nvData.openings = [
    {
      openingId: 'op-south-inlet',
      roomId: 'rm-living',
      label: 'South Low Casement',
      category: 'window',
      boundaryLocation: 'exterior-envelope',
      wallEdge: 'south',
      floorLevel: 1,
      operabilityStatus: 'operable',
      operabilityProvenance: 'user-entered',
      mechanismType: 'casement-side-hung',
      grossWidth: 1.5,
      grossHeight: 1.2,
      dimensionUnit: 'metres',
      dimensionProvenance: 'user-entered',
      explicitClearOpenableAreaInUnitSq: null,
      maxOpenableFraction: 0.7,
      openableFractionProvenance: 'user-entered',
      screenOrGrilleFactor: 1.0,
      obstructionFactor: 1.0,
      sillElevation: 0.8, // centroid = 0.8 + 0.6 = 1.4 m
      headElevation: null,
      elevationProvenance: 'user-entered',
      dischargeCoefficientCd: 0.62,
      cdProvenance: 'traceable-technical-reference',
      defaultScenarioState: 'fully-open',
      defaultScenarioOpenFraction: 1.0,
      rainProtectionKind: 'protected-by-overhang-or-louvre',
      hasSecurityRestrictorOrNightLatch: true,
    },
  ];
  proj.naturalVentilation = nvData;

  // 1. Only 1 exterior facade opening -> Single-Sided
  const evalSingle = evaluateRoomForScenario(
    proj,
    proj.floorPlan!.rooms[0],
    nvData,
    nvData.scenarios[0]
  );
  verify(
    evalSingle.dominantStrategy === 'single-sided',
    'Single exterior opening classifies as single-sided ventilation'
  );

  // 2. Add North high-level opening -> Cross-Ventilation + Stack Buoyancy = combined-wind-and-stack
  nvData.openings.push({
    openingId: 'op-north-high-outlet',
    roomId: 'rm-living',
    label: 'North High Clerestory',
    category: 'vent',
    boundaryLocation: 'exterior-envelope',
    wallEdge: 'north',
    floorLevel: 1,
    operabilityStatus: 'operable',
    operabilityProvenance: 'user-entered',
    mechanismType: 'awning-top-hung',
    grossWidth: 1.5,
    grossHeight: 0.8,
    dimensionUnit: 'metres',
    dimensionProvenance: 'user-entered',
    explicitClearOpenableAreaInUnitSq: null,
    maxOpenableFraction: 0.75,
    openableFractionProvenance: 'user-entered',
    screenOrGrilleFactor: 1.0,
    obstructionFactor: 1.0,
    sillElevation: 2.0, // centroid = 2.0 + 0.4 = 2.4 m (Δh = 2.4 - 1.4 = 1.0 m)
    headElevation: null,
    elevationProvenance: 'user-entered',
    dischargeCoefficientCd: 0.62,
    cdProvenance: 'traceable-technical-reference',
    defaultScenarioState: 'fully-open',
    defaultScenarioOpenFraction: 1.0,
    rainProtectionKind: 'protected-by-overhang-or-louvre',
    hasSecurityRestrictorOrNightLatch: true,
  });

  const evalCombined = evaluateRoomForScenario(
    proj,
    proj.floorPlan!.rooms[0],
    nvData,
    nvData.scenarios[0]
  );
  verify(
    evalCombined.dominantStrategy === 'combined-wind-and-stack',
    'Opposite facades + vertical separation Δh = 1.0 m classifies as combined-wind-and-stack'
  );

  // 3. Test internal door transfer path for Quiet Study (rm-study)
  nvData.roomConfigs['rm-study'].ceilingHeight = 3.0;
  nvData.openings.push(
    {
      openingId: 'op-study-east',
      roomId: 'rm-study',
      label: 'Study East Window',
      category: 'window',
      boundaryLocation: 'exterior-envelope',
      wallEdge: 'east',
      floorLevel: 1,
      operabilityStatus: 'operable',
      operabilityProvenance: 'user-entered',
      mechanismType: 'casement-side-hung',
      grossWidth: 1.2,
      grossHeight: 1.2,
      dimensionUnit: 'metres',
      dimensionProvenance: 'user-entered',
      explicitClearOpenableAreaInUnitSq: null,
      maxOpenableFraction: 0.7,
      openableFractionProvenance: 'user-entered',
      screenOrGrilleFactor: 1.0,
      obstructionFactor: 1.0,
      sillElevation: 0.9,
      headElevation: null,
      elevationProvenance: 'user-entered',
      dischargeCoefficientCd: 0.62,
      cdProvenance: 'traceable-technical-reference',
      defaultScenarioState: 'fully-open',
      defaultScenarioOpenFraction: 1.0,
      rainProtectionKind: 'protected-by-overhang-or-louvre',
      hasSecurityRestrictorOrNightLatch: true,
    },
    {
      openingId: 'op-internal-door-study',
      roomId: 'rm-study',
      connectedRoomId: 'rm-living',
      label: 'Study-Living Partition Door',
      category: 'door',
      boundaryLocation: 'interior-partition',
      wallEdge: 'west',
      floorLevel: 1,
      operabilityStatus: 'operable',
      operabilityProvenance: 'user-entered',
      mechanismType: 'hinged-door',
      grossWidth: 0.9,
      grossHeight: 2.1,
      dimensionUnit: 'metres',
      dimensionProvenance: 'user-entered',
      explicitClearOpenableAreaInUnitSq: null,
      maxOpenableFraction: 0.9,
      openableFractionProvenance: 'user-entered',
      screenOrGrilleFactor: 1.0,
      obstructionFactor: 1.0,
      sillElevation: 0,
      headElevation: null,
      elevationProvenance: 'user-entered',
      dischargeCoefficientCd: 0.62,
      cdProvenance: 'traceable-technical-reference',
      defaultScenarioState: 'closed', // CLOSED internal door!
      defaultScenarioOpenFraction: 0,
      rainProtectionKind: 'protected-by-overhang-or-louvre',
      hasSecurityRestrictorOrNightLatch: false,
    }
  );

  const evalStudyClosedDoor = evaluateRoomForScenario(
    proj,
    proj.floorPlan!.rooms[1],
    nvData,
    nvData.scenarios[0]
  );
  verify(
    evalStudyClosedDoor.dominantStrategy === 'single-sided',
    'When internal door is closed, Study only has single-sided ventilation'
  );
  const blockedTransferPath = evalStudyClosedDoor.discoveredAirflowPaths.find(
    (p) => p.strategyType === 'internal-transfer-assisted'
  );
  verify(
    blockedTransferPath && !blockedTransferPath.isPathActiveInScenario,
    'Closed internal door marks candidate internal-transfer path as inactive/blocked'
  );

  // Now open the internal door -> upgrades Study to internal-transfer-assisted cross-ventilation
  nvData.openings.find((o) => o.openingId === 'op-internal-door-study')!.defaultScenarioState =
    'fully-open';
  nvData.openings.find(
    (o) => o.openingId === 'op-internal-door-study'
  )!.defaultScenarioOpenFraction = 1.0;

  const evalStudyOpenDoor = evaluateRoomForScenario(
    proj,
    proj.floorPlan!.rooms[1],
    nvData,
    nvData.scenarios[0]
  );
  verify(
    evalStudyOpenDoor.dominantStrategy === 'internal-transfer-assisted',
    'Opening internal door enables internal-transfer-assisted multi-room cross-ventilation'
  );
  verify(
    evalStudyOpenDoor.domainF_ConstraintsAndTradeOffs.some(
      (t) => t.domain === 'internal-privacy-p36-p30-conflict'
    ),
    'Opening internal door between rooms flags P36 airborne speech privacy trade-off'
  );
}
console.log('  ✓ Group C passed');

// ============================================================================
// GROUP D — Quantitative Orifice, Wind, Stack, Series Conductance & ACH Equations
// ============================================================================
console.log('• Group D: Quantitative Wind, Stack, Series Conductance & Quadrature Flow...');
{
  // Test two equal openings in series: G1 = 1.0 m², G2 = 1.0 m² -> G_series = 1 / sqrt(1 + 1) = 0.7071 m²
  const seriesEqual = computeSeriesOrificeConductanceM2([1.0, 1.0]);
  verify(
    seriesEqual !== null && Math.abs(seriesEqual - 0.7071) < 1e-3,
    'Two 1.0 m² conductances in series yield 1/sqrt(2) = 0.7071 m²'
  );

  const proj = createBaseTestProject();
  const nvData = initializeProjectNaturalVentilationData(proj);
  nvData.roomConfigs['rm-living'].ceilingHeight = 3.0; // V = 90 m³
  nvData.roomConfigs['rm-living'].occupancyCountAssumption = 3;
  nvData.openings = [
    {
      openingId: 'op-s',
      roomId: 'rm-living',
      label: 'South Inlet',
      category: 'window',
      boundaryLocation: 'exterior-envelope',
      wallEdge: 'south',
      floorLevel: 1,
      operabilityStatus: 'operable',
      operabilityProvenance: 'user-entered',
      mechanismType: 'casement-side-hung',
      grossWidth: 1.5,
      grossHeight: 1.2, // 1.8 m²
      dimensionUnit: 'metres',
      dimensionProvenance: 'user-entered',
      explicitClearOpenableAreaInUnitSq: 1.0, // A_eff = 1.0 m²
      maxOpenableFraction: 1.0,
      openableFractionProvenance: 'user-entered',
      screenOrGrilleFactor: 1.0,
      obstructionFactor: 1.0,
      sillElevation: 0.6, // centroid = 0.6 + 0.6 = 1.2 m
      headElevation: null,
      elevationProvenance: 'user-entered',
      dischargeCoefficientCd: 0.6, // G1 = 0.60 m²
      cdProvenance: 'user-entered',
      defaultScenarioState: 'fully-open',
      defaultScenarioOpenFraction: 1.0,
      rainProtectionKind: 'protected-by-overhang-or-louvre',
      hasSecurityRestrictorOrNightLatch: true,
    },
    {
      openingId: 'op-n',
      roomId: 'rm-living',
      label: 'North High Outlet',
      category: 'window',
      boundaryLocation: 'exterior-envelope',
      wallEdge: 'north',
      floorLevel: 1,
      operabilityStatus: 'operable',
      operabilityProvenance: 'user-entered',
      mechanismType: 'casement-side-hung',
      grossWidth: 1.5,
      grossHeight: 1.2,
      dimensionUnit: 'metres',
      dimensionProvenance: 'user-entered',
      explicitClearOpenableAreaInUnitSq: 1.0, // A_eff = 1.0 m²
      maxOpenableFraction: 1.0,
      openableFractionProvenance: 'user-entered',
      screenOrGrilleFactor: 1.0,
      obstructionFactor: 1.0,
      sillElevation: 1.6, // centroid = 1.6 + 0.6 = 2.2 m (Δh = 1.0 m)
      headElevation: null,
      elevationProvenance: 'user-entered',
      dischargeCoefficientCd: 0.6, // G2 = 0.60 m²
      cdProvenance: 'user-entered',
      defaultScenarioState: 'fully-open',
      defaultScenarioOpenFraction: 1.0,
      rainProtectionKind: 'protected-by-overhang-or-louvre',
      hasSecurityRestrictorOrNightLatch: true,
    },
  ];

  // Evaluate under Scenario 1 (Wind + Stack)
  const evalBoth = evaluateRoomForScenario(
    proj,
    proj.floorPlan!.rooms[0],
    nvData,
    nvData.scenarios[0]
  );
  const mc = evalBoth.modeC_QuantifiedEstimate;
  verify(mc.isQuantifiedEstimateAvailable, 'Mode C quantified estimate is available');
  verify(
    mc.windDriven.isApplicable &&
      mc.windDriven.flowRateM3PerSec !== null &&
      mc.windDriven.flowRateM3PerSec > 0,
    'Wind-driven flow Q_wind > 0'
  );
  verify(
    mc.stackDriven.isApplicable &&
      mc.stackDriven.flowRateM3PerSec !== null &&
      mc.stackDriven.flowRateM3PerSec > 0,
    'Stack-driven flow Q_stack > 0'
  );

  // Verify quadrature combination: Q_combined = sqrt(Q_wind² + Q_stack²), NOT Q_wind + Q_stack
  const qW = mc.windDriven.flowRateM3PerSec!;
  const qS = mc.stackDriven.flowRateM3PerSec!;
  const expectedQuad = round4(Math.sqrt(qW * qW + qS * qS));
  const linearSum = round4(qW + qS);
  verify(
    mc.combinedFlowRateM3PerSec === expectedQuad && mc.combinedFlowRateM3PerSec < linearSum,
    `Combined flow uses quadrature (${mc.combinedFlowRateM3PerSec} m³/s) and strictly avoids linear sum (${linearSum} m³/s)`
  );

  // Verify ACH = (Q_combined * 3600) / 90.0
  const expectedAch = round2((expectedQuad * 3600) / 90.0);
  verify(mc.estimatedAch === expectedAch, `ACH = ${mc.estimatedAch} h⁻¹ matches (Q * 3600) / V`);

  // Verify Scenario 2 (Calm Wind v = 0 m/s -> Q_wind = 0, Q_combined = Q_stack)
  const evalCalm = evaluateRoomForScenario(
    proj,
    proj.floorPlan!.rooms[0],
    nvData,
    nvData.scenarios[1]
  );
  verify(
    evalCalm.modeC_QuantifiedEstimate.windDriven.flowRateM3PerSec === 0,
    'When wind speed v = 0 m/s, Q_wind = 0 m³/s'
  );
  verify(
    evalCalm.modeC_QuantifiedEstimate.combinedFlowRateM3PerSec ===
      evalCalm.modeC_QuantifiedEstimate.stackDriven.flowRateM3PerSec,
    'Under calm wind (v = 0), combined flow equals pure stack buoyancy flow'
  );
}
console.log('  ✓ Group D passed');

// ============================================================================
// GROUP E & F — Environmental Trade-Offs & Mode D Scenario Comparison
// ============================================================================
console.log('• Group E & F: Environmental Trade-Offs & Mode D Scenario Comparison...');
{
  const proj = createBaseTestProject();
  const nvData = initializeProjectNaturalVentilationData(proj);
  nvData.roomConfigs['rm-living'].ceilingHeight = 3.0;
  nvData.openings = [
    {
      openingId: 'op-s-unprotected',
      roomId: 'rm-living',
      label: 'Unprotected South Window',
      category: 'window',
      boundaryLocation: 'exterior-envelope',
      wallEdge: 'south',
      floorLevel: 1,
      operabilityStatus: 'operable',
      operabilityProvenance: 'user-entered',
      mechanismType: 'casement-side-hung',
      grossWidth: 1.5,
      grossHeight: 1.4,
      dimensionUnit: 'metres',
      dimensionProvenance: 'user-entered',
      explicitClearOpenableAreaInUnitSq: 1.2,
      maxOpenableFraction: 0.7,
      openableFractionProvenance: 'user-entered',
      screenOrGrilleFactor: 1.0,
      obstructionFactor: 1.0,
      sillElevation: 0.8,
      headElevation: null,
      elevationProvenance: 'user-entered',
      dischargeCoefficientCd: 0.62,
      cdProvenance: 'user-entered',
      defaultScenarioState: 'fully-open',
      defaultScenarioOpenFraction: 1.0,
      rainProtectionKind: 'unprotected-direct-exposure',
      hasSecurityRestrictorOrNightLatch: false,
    },
  ];
  proj.naturalVentilation = nvData;

  // Evaluate under Scenario 3 (Adverse Hot 34 °C, 80% RH, Wind-Driven Rain, High Traffic Noise)
  const evalAdverse = evaluateRoomForScenario(
    proj,
    proj.floorPlan!.rooms[0],
    nvData,
    nvData.scenarios[2]
  );
  const tradeDomains = evalAdverse.domainF_ConstraintsAndTradeOffs.map((t) => t.domain);
  verify(
    tradeDomains.includes('outdoor-noise-p36-conflict'),
    'High traffic noise conflict flagged in Domain F'
  );
  verify(
    tradeDomains.includes('thermal-draft-or-overheating'),
    'Outdoor heat (34 °C) overheating risk flagged in Domain F'
  );
  verify(
    tradeDomains.includes('humidity-moisture-p35-materials'),
    'High outdoor humidity (80% RH) moisture risk flagged in Domain F'
  );
  verify(
    tradeDomains.includes('rain-and-storm-ingress'),
    'Rain ingress risk at unprotected window flagged in Domain F'
  );

  // Mode D comparison between Scenario 1 and Scenario 2
  const evalBase = evaluateRoomForScenario(
    proj,
    proj.floorPlan!.rooms[0],
    nvData,
    nvData.scenarios[0]
  );
  const evalCalm = evaluateRoomForScenario(
    proj,
    proj.floorPlan!.rooms[0],
    nvData,
    nvData.scenarios[1]
  );
  const cmp = compareRoomVentilationScenarios(
    evalBase,
    evalCalm,
    nvData.scenarios[0],
    nvData.scenarios[1]
  );
  verify(cmp.mode === 'mode-d-scenario-comparison', 'Mode D comparison object generated');
  verify(
    cmp.conditionDifferencesDisclosed.length >= 2,
    'Condition differences (wind speed, temperature) explicitly disclosed in Mode D'
  );
}
console.log('  ✓ Group E & F passed');

// ============================================================================
// GROUP G — Recommendations, Non-Destructive Preview, Atomic Apply & Rollback
// ============================================================================
console.log('• Group G: 9-Attribute Recommendations, Non-Destructive Preview, Apply & Rollback...');
{
  const proj = createBaseTestProject();
  const reportBefore = evaluateProjectNaturalVentilation(proj);
  const recs = reportBefore.activeRoomEvaluation!.domainH_Recommendations;
  verify(recs.length >= 2, 'Recommendations generated for unconfigured room');

  for (const r of recs) {
    verify(Boolean(r.issueOrOpportunityAddressed), 'Attr 1: issueOrOpportunityAddressed present');
    verify(Boolean(r.triggeringInputOrObservation), 'Attr 2: triggeringInputOrObservation present');
    verify(Boolean(r.physicalRelevanceExplanation), 'Attr 3: physicalRelevanceExplanation present');
    verify(
      Array.isArray(r.requiredOperatingConditions) && r.requiredOperatingConditions.length > 0,
      'Attr 4: requiredOperatingConditions present'
    );
    verify(Boolean(r.supportingEvidence), 'Attr 5: supportingEvidence present');
    verify(
      Array.isArray(r.remainingUnknowns) && r.remainingUnknowns.length > 0,
      'Attr 6: remainingUnknowns present'
    );
    verify(
      ['qualitative', 'preliminary-estimated', 'verified'].includes(r.expectedBenefitKind) &&
        Boolean(r.expectedBenefitSummary),
      'Attr 7: expectedBenefitKind & summary present'
    );
    verify(
      typeof r.requiresArchitecturalDesignChange === 'boolean',
      'Attr 8: requiresArchitecturalDesignChange boolean present'
    );
    verify(
      Boolean(r.multidisciplinaryTradeOffs.acousticsAndNoiseP36) &&
        Boolean(r.multidisciplinaryTradeOffs.accessibilityAndReachP34) &&
        Boolean(r.multidisciplinaryTradeOffs.moistureAndMaterialsP35),
      'Attr 9: multidisciplinaryTradeOffs present'
    );
  }

  // Test Non-Destructive Preview
  const applyableRec = recs.find((r) => r.canPreviewAndApplyInPlotify)!;
  const origJson = JSON.stringify(proj);
  const previewDiff = previewVentilationRecommendation(proj, applyableRec.recommendationId);
  verify(JSON.stringify(proj) === origJson, 'Preview is 100% non-destructive to source project');
  verify(
    previewDiff.isSafeToApply && previewDiff.fieldChanges.length > 0,
    'Preview diff has valid field changes'
  );

  // Test Stale Preview Rejection
  const mutatedProj = JSON.parse(JSON.stringify(proj)) as Project;
  mutatedProj.floorPlan!.rooms[0].width = 7.5; // mutate geometry after preview
  const staleApplyRes = applyVentilationProposalAtomically(mutatedProj, previewDiff);
  verify(
    !staleApplyRes.applied && staleApplyRes.message.includes('Stale preview rejected'),
    'Stale preview is rejected when project geometry changes before apply'
  );

  // Test Valid Atomic Apply & Rollback
  const validApplyRes = applyVentilationProposalAtomically(proj, previewDiff);
  verify(
    validApplyRes.applied && Boolean(validApplyRes.snapshotId),
    'Valid preview applies atomically and records snapshotId'
  );

  const rollbackRes = rollbackLastVentilationApply(validApplyRes.updatedProject);
  verify(
    rollbackRes.rolledBack &&
      rollbackRes.restoredProject.naturalVentilation === undefined,
    'Rollback restores exact pre-apply project state'
  );
}
console.log('  ✓ Group G passed');

// ============================================================================
// GROUP H, I, J — Cross-Feature Integrations (P30–P36), Honesty & Fingerprint
// ============================================================================
console.log('• Group H, I & J: Cross-Feature Integrations (P30–P36), Honesty & Stale Detection...');
{
  const proj = createBaseTestProject();
  const report = evaluateProjectNaturalVentilation(proj);

  // P31 comparison export
  const p31Summaries = getP37NaturalVentilationSummaryForComparison(proj);
  verify(p31Summaries.length >= 1, 'P31 option ventilation comparison summary exported');
  verify(
    p31Summaries[0].calculationModelVersion === P37_NATURAL_VENTILATION_ENGINE_VERSION,
    'P31 summary carries P37 engine version'
  );

  // P35 no-automatic-weather-inference check
  verify(
    report.p35ClimateAndMaterialIntegration.noAutomaticWeatherInferenceNote.includes(
      'never infers site wind speed'
    ),
    'P37 explicitly guarantees no automatic weather inference from P35 climate regimes'
  );

  // Technical references & P38–P40 scope boundaries
  verify(
    Object.keys(P37_TECHNICAL_REFERENCES).length >= 5,
    'Auditable technical references (ASHRAE Ch. 16, 62.1, 62.2, CIBSE AM10, ISO 17772-1) defined'
  );
  verify(
    report.roadmapScopeBoundaries.map((b) => b.roadmapId).join(',') === 'P38,P39,P40',
    'P38, P39, and P40 scope boundaries explicitly enforced'
  );

  // Deterministic fingerprint change detection
  const fp1 = computeNaturalVentilationSourceFingerprint(proj);
  const proj2 = JSON.parse(JSON.stringify(proj)) as Project;
  const nv2 = initializeProjectNaturalVentilationData(proj2);
  nv2.scenarios[0].environmentalConditions.windSpeedMetresPerSec = 5.5;
  proj2.naturalVentilation = nv2;
  const fp2 = computeNaturalVentilationSourceFingerprint(proj2, nv2);
  verify(fp1 !== fp2, 'Fingerprint changes deterministically when scenario wind speed changes');
}
console.log('  ✓ Group H, I & J passed');

console.log('\n================================================================');
console.log(`✓ ALL ${passedAssertions} P37 NATURAL VENTILATION ASSERTIONS PASSED!`);
console.log('================================================================\n');
