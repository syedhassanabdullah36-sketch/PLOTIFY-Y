/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P38 — Daylight & Visual Comfort Analyzer Service
 * Account A | Locked Roadmap: P38 of P30–P40
 *
 * Deterministic, unit-safe, provenance-aware daylight availability, solar-position
 * and shadow geometry, simplified BRE Split-Flux Daylight Factor calculation,
 * qualitative glare/view-out screening, and scenario comparison engine:
 * - Room geometry validation, zero-origin acceptance, and SI unit conversion (m, m², m³)
 * - Explicit work-plane analysis grid generation with wall exclusion margin
 * - Window & glazing validation: gross vs. net glazed area, framing fraction, and VT/Tvis
 *   (never inferred from U-factor, SHGC, or generic glass labels)
 * - Solar position geometry (declination, equation of time, hour angle, altitude, azimuth,
 *   vertical profile angle, overhang/side-fin shadow projection, direct-sun floor depth)
 * - Simplified BRE / CIBSE Split-Flux Mean Daylight Factor under CIE Standard Overcast Sky
 * - Honest Mode D boundary: sDA, ASE, DA, and UDI return explicit unsupported/null status
 * - Honest Mode E boundary: qualitative glare & horizontal view-out angle screening; DGP returns null
 * - Mode F scenario comparison with assumption & evidence-equivalence checks
 * - Read-only P30–P37 integration, P31 comparison export, non-destructive preview,
 *   atomic apply with pre-apply snapshot, P37 staleness marking, and safe rollback
 */

import {
  FloorPlanRoom,
  MeasurementUnit,
  Project,
} from '../types/project';
import {
  ConfiguredDaylightCriterion,
  DaylightAssessmentMode,
  DaylightComfortProjectEvaluationReport,
  DaylightCompletenessState,
  DaylightEnvironmentalConditions,
  DaylightEvaluationStatus,
  DaylightEvidenceProvenance,
  DaylightProposalPreviewDiff,
  DaylightRecommendation,
  DaylightScenario,
  DaylightSourceMetadata,
  DaylightWindowRecord,
  EvaluatedDaylightWindowSI,
  ExternalObstructionRecord,
  GlazingAssemblyKind,
  ModeAGeometricDaylightResult,
  ModeBSolarShadingResult,
  ModeCSimplifiedDaylightResult,
  ModeDAnnualSimulationStatusResult,
  ModeEVisualComfortGlareViewResult,
  ModeFDaylightScenarioComparisonResult,
  MovableShadingDeploymentState,
  P38_DAYLIGHT_ANALYZER_ENGINE_VERSION,
  P38_DAYLIGHT_SCHEMA_VERSION,
  P38OptionDaylightComparisonSummary,
  ProjectDaylightComfortData,
  RoomDaylightConfig,
  RoomDaylightGeometryValidationSI,
  RoomScenarioDaylightEvaluation,
  WorkPlaneAnalysisPointSI,
} from '../types/daylightComfort';
import { WallCardinalEdge } from '../types/naturalVentilation';
import { initializeProjectBrief } from './briefService';
import { extractComparableOptions } from './designComparisonService';
import { initializePersonalizationProfile } from './designPersonalizationService';
import { ensureProjectFurnitureLayoutData } from './furnitureIntelligenceService';
import { initializeProjectMaterialAdvisorData } from './climateMaterialAdvisorService';
import { initializeProjectAcousticPlannerData } from './acousticComfortService';
import {
  computeAngularDifferenceDeg,
  getWallCompassAzimuthDeg,
  initializeProjectNaturalVentilationData,
} from './naturalVentilationService';
import {
  createProjectSnapshot,
  executeSafeRestore,
  getProjectSnapshots,
} from './versioningService';

export {
  P38_DAYLIGHT_ANALYZER_ENGINE_VERSION,
  P38_DAYLIGHT_SCHEMA_VERSION,
};

export const P38_PROFESSIONAL_DISCLAIMER =
  'Daylight & Visual Comfort Analyzer (P38) provides geometric daylight potential screening, analytical solar-position and overhang/fin shadow projection, simplified BRE Split-Flux Mean Daylight Factor calculations under a CIE Standard Overcast Sky, and qualitative visual-comfort / view-out screening. It does NOT perform multi-bounce raytracing (Radiance), climate-based annual daylight simulation (sDA/ASE/UDI), high-dynamic-range luminance glare probability (DGP), or statutory building-code / EN 17037 / ANSI/IES LM-83 compliance certification.';

const METRES_PER_FOOT = 0.3048;
const SQ_METRES_PER_SQ_FOOT = 0.09290304;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const INTERNAL_GLASS_DIFFUSE_REFLECTANCE = 0.10; // Standard BRE Split-Flux internal diffuse glass reflectance

/**
 * In-memory snapshot fallback for headless Node.js / CLI verification environments.
 */
const memoryDaylightSnapshots = new Map<string, Project>();

export function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

export function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

export function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

/**
 * Single defined linear unit conversion path to SI metres (m).
 * Rejects non-finite or non-positive physical dimensions.
 */
export function convertLengthToMetres(
  value: number | null | undefined,
  unit: MeasurementUnit
): number | null {
  if (
    value === null ||
    value === undefined ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return null;
  }
  return unit === 'feet' ? value * METRES_PER_FOOT : value;
}

/**
 * Single defined elevation/coordinate conversion path to SI metres (m).
 * Accepts valid 0.0 origin/sill elevations while rejecting negative or non-finite values.
 */
export function convertElevationToMetres(
  value: number | null | undefined,
  unit: MeasurementUnit
): number | null {
  if (
    value === null ||
    value === undefined ||
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return null;
  }
  return unit === 'feet' ? value * METRES_PER_FOOT : value;
}

/**
 * Single defined area conversion path from `unit` squared (sq ft or m²) to SI square metres (m²).
 */
export function convertAreaToSquareMetres(
  area: number | null | undefined,
  unit: MeasurementUnit
): number | null {
  if (
    area === null ||
    area === undefined ||
    typeof area !== 'number' ||
    !Number.isFinite(area) ||
    area <= 0
  ) {
    return null;
  }
  return unit === 'feet' ? area * SQ_METRES_PER_SQ_FOOT : area;
}

/**
 * Public technical reference ledger per P38 Section 19.
 * Uses only public bibliographic metadata and physical formulas; never claims unimplemented standards.
 */
export const P38_TECHNICAL_REFERENCES: Record<string, DaylightSourceMetadata> = {
  BRE_CIBSE_SPLIT_FLUX: {
    sourceId: 'bre-cibse-lg10-split-flux',
    publisher: 'BRE / Chartered Institution of Building Services Engineers (CIBSE)',
    title: 'CIBSE Lighting Guide LG10: Daylighting — A Guide for Designers (BRE Split-Flux Method / Lynes Formula)',
    editionOrVersion: '2014 / Current Reference',
    urlOrIdentifier: 'https://www.cibse.org/knowledge-research/knowledge-portal/lighting-guide-10-daylighting-a-guide-for-designers',
    accessDate: '2026-10-26',
    relevantConditions: 'CIE Standard Overcast Sky; rectangular room geometry with diffuse interior surfaces.',
    unitsNote: 'Areas in m², visible sky angle θ in degrees, dimensionless transmittances/reflectances in [0, 1], output Mean Daylight Factor in %.',
    applicabilityAndScopeNote:
      'Provides the classical analytical Split-Flux Mean Daylight Factor equation DF_mean = (T * A_g * θ * M) / (A_total * (1 - R²)) * 100% and limiting room depth screening heuristics.',
  },
  EN_17037_SCOPE_REF: {
    sourceId: 'en-17037-2018-a1-2021',
    publisher: 'CEN / BSI',
    title: 'BS EN 17037:2018+A1:2021 — Daylight in buildings',
    editionOrVersion: '2018+A1:2021',
    urlOrIdentifier: 'https://landingpage.bsigroup.com/LandingPage/Undated?UPI=000000000030342286',
    accessDate: '2026-10-26',
    relevantConditions: 'Addresses daylight provision across reference plane fractions, view out, sunlight exposure hours, and glare protection.',
    unitsNote: 'Lux, % reference plane fraction, view angle (deg), hours.',
    applicabilityAndScopeNote:
      'Scope reference only. P38 simplified BRE Split-Flux Mean Daylight Factor and qualitative view/glare checks do NOT constitute a verified EN 17037 compliance calculation.',
  },
  IES_LM_83_23_SCOPE_REF: {
    sourceId: 'ansi-ies-lm-83-23',
    publisher: 'Illuminating Engineering Society (IES)',
    title: 'ANSI/IES LM-83-23 — Approved Method: IES Spatial Daylight Autonomy (sDA) and Annual Sunlight Exposure (ASE)',
    editionOrVersion: '2023',
    urlOrIdentifier: 'https://store.ies.org/product/approved-method-ies-spatial-daylight-autonomy-sda-and-annual-sunlight-exposure-ase/',
    accessDate: '2026-10-26',
    relevantConditions: 'Requires full-year hourly meteorological climate data (TMY/EPW), validated radiative transfer simulation, and dynamic blind schedules.',
    unitsNote: '% of analysis area meeting illuminance thresholds over annual occupied hours.',
    applicabilityAndScopeNote:
      'Scope reference only. Because Plotify does not embed a validated annual climate-based raytracing engine, P38 explicitly reports sDA and ASE as unsupported in Mode D rather than fabricating values.',
  },
  ISO_CIE_15469_SKY: {
    sourceId: 'iso-cie-15469-sky-distribution',
    publisher: 'ISO / CIE',
    title: 'ISO 15469:2004 / ISO/CIE 15469:2026 — Spatial distribution of daylight — CIE standard general sky',
    editionOrVersion: '2004 / 2026 Edition',
    urlOrIdentifier: 'https://www.iso.org/standard/38608.html | https://www.iso.org/standard/90136.html',
    accessDate: '2026-10-26',
    relevantConditions: 'Defines standard sky luminance distributions including CIE Standard Overcast Sky (Type 1).',
    unitsNote: 'Relative luminance distribution L(γ, Z).',
    applicabilityAndScopeNote:
      'Defines the CIE Standard Overcast Sky boundary condition assumed by the Mode C simplified BRE Split-Flux Daylight Factor method.',
  },
  SOLAR_GEOMETRY_NOAA_DUFFIE_BECKMAN: {
    sourceId: 'solar-geometry-duffie-beckman',
    publisher: 'NOAA / Duffie & Beckman (Solar Engineering of Thermal Processes)',
    title: 'Analytical Solar Position & Overhang Shadow Projection Equations',
    editionOrVersion: 'Standard Astronomical Reference',
    urlOrIdentifier: 'https://gml.noaa.gov/grad/solcalc/solareqns.PDF',
    accessDate: '2026-10-26',
    relevantConditions: 'Requires explicit latitude, longitude, time zone, date, and local time.',
    unitsNote: 'Angles in degrees (declination δ, hour angle ω, solar altitude α_s, solar azimuth γ_s, vertical profile angle Ω_v).',
    applicabilityAndScopeNote:
      'Used in Mode B for deterministic solar altitude, azimuth, facade incidence, overhang shadow drop, and direct-sun floor penetration screening.',
  },
};

/**
 * Default configurable daylight criteria per P38 Section 13.
 * Explicitly labelled as 'advisory-reference' and 'unverified-screening-benchmark'.
 */
export const DEFAULT_DAYLIGHT_CRITERIA: ConfiguredDaylightCriterion[] = [
  {
    criterionId: 'crit-p38-glazed-to-floor-ratio',
    roomTypeScope: 'all-habitable',
    metric: 'glazed-to-floor-area-ratio-percent',
    label: 'Advisory Net Glazed-to-Floor-Area Ratio (GFR)',
    minTarget: 10.0,
    maxTarget: 35.0,
    unit: '%',
    authorityStatus: 'advisory-reference',
    jurisdictionAndStandard: 'Early-Stage Architectural Daylight Screening Heuristic (10%–25% Reference)',
    editionOrVersion: '2026.1',
    applicabilityConditions:
      'Compares net transparent window glazed area against habitable room floor area. Geometric indicator only; does not account for VT, obstructions, or sky conditions.',
    verificationStatus: 'unverified-screening-benchmark',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P38_TECHNICAL_REFERENCES.BRE_CIBSE_SPLIT_FLUX,
    nonComplianceDisclaimer:
      'A glazed-to-floor ratio >= 10% is a preliminary geometric screening indicator only and does NOT prove statutory building-code or EN 17037 compliance.',
  },
  {
    criterionId: 'crit-p38-mean-daylight-factor',
    roomTypeScope: 'all-habitable',
    metric: 'mean-daylight-factor-percent',
    label: 'Advisory Mean Daylight Factor (BRE Split-Flux Overcast Sky)',
    minTarget: 2.0,
    maxTarget: 5.0,
    unit: '%',
    authorityStatus: 'advisory-reference',
    jurisdictionAndStandard: 'CIBSE LG10 / BRE Split-Flux Advisory Screening Range (2.0%–5.0% Mean DF)',
    editionOrVersion: '2026.1',
    applicabilityConditions:
      'Applies under a CIE Standard Overcast Sky when room height, window glazed area, glazing VT, and interior surface reflectances are known.',
    verificationStatus: 'unverified-screening-benchmark',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P38_TECHNICAL_REFERENCES.BRE_CIBSE_SPLIT_FLUX,
    nonComplianceDisclaimer:
      'Mean Daylight Factor calculated via the simplified BRE Split-Flux equation is a room-average overcast-sky estimate and does NOT constitute EN 17037 target illuminance / median daylight factor compliance.',
  },
  {
    criterionId: 'crit-p38-depth-to-head-ratio',
    roomTypeScope: 'all-habitable',
    metric: 'room-depth-to-window-head-ratio',
    label: 'Single-Sided Room Depth to Window Head Height Ratio (L / H_head)',
    minTarget: null,
    maxTarget: 2.5,
    unit: 'dimensionless',
    authorityStatus: 'advisory-reference',
    jurisdictionAndStandard: 'BRE / CIBSE LG10 Limiting Room Depth Heuristic (L <= 2.5 * H_head)',
    editionOrVersion: '2026.1',
    applicabilityConditions:
      'Screens whether single-sided daylight distribution is likely to drop off sharply in the rear half of a deep room.',
    verificationStatus: 'unverified-screening-benchmark',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P38_TECHNICAL_REFERENCES.BRE_CIBSE_SPLIT_FLUX,
    nonComplianceDisclaimer:
      'Advisory geometric depth ratio only; does not replace point-by-point illuminance modeling.',
  },
  {
    criterionId: 'crit-p38-horizontal-view-angle',
    roomTypeScope: 'all-habitable',
    metric: 'horizontal-view-out-angle-deg',
    label: 'Advisory Horizontal View-Out Sight Angle from Room Centre',
    minTarget: 14.0,
    maxTarget: null,
    unit: 'deg',
    authorityStatus: 'advisory-reference',
    jurisdictionAndStandard: 'Preliminary View-Out Screening Reference (>= 14° Horizontal Sight Cone)',
    editionOrVersion: '2026.1',
    applicabilityConditions:
      'Measures horizontal sight angle subtended by exterior window openings from the geometric centre of the room.',
    verificationStatus: 'unverified-screening-benchmark',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P38_TECHNICAL_REFERENCES.EN_17037_SCOPE_REF,
    nonComplianceDisclaimer:
      'Geometric horizontal sight angle screening only; full EN 17037 view-out assessment also requires verification of visible landscape/sky/ground layers and external view distance.',
  },
];

/**
 * Creates default exploratory scenarios for P38 so users can compare baseline vs. solar-control / glazing alternatives
 * while keeping provenance 100% explicit ('illustrative-scenario-assumption' when site coordinates are absent).
 */
export function createDefaultDaylightScenarios(project?: Project): DaylightScenario[] {
  const siteLat =
    typeof project?.siteContext?.latitude === 'number' &&
    Number.isFinite(project.siteContext.latitude) &&
    project.siteContext.latitude >= -90 &&
    project.siteContext.latitude <= 90
      ? project.siteContext.latitude
      : null;
  const siteLon =
    typeof project?.siteContext?.longitude === 'number' &&
    Number.isFinite(project.siteContext.longitude) &&
    project.siteContext.longitude >= -180 &&
    project.siteContext.longitude <= 180
      ? project.siteContext.longitude
      : null;

  const hasVerifiedSiteCoords = siteLat !== null && siteLon !== null;

  return [
    {
      scenarioId: 'p38-scen-baseline-overcast-equinox',
      name: 'Scenario 1 — Baseline Overcast Sky & Equinox Noon Screening',
      description:
        'Baseline configuration evaluating CIE Standard Overcast Sky (10,000 lux reference) for Mode C Daylight Factor and March Equinox 12:00 solar geometry for Mode B screening.',
      isBaseline: true,
      environmentalConditions: {
        conditionId: 'p38-env-baseline',
        label: hasVerifiedSiteCoords
          ? 'Site Coordinates + CIE Overcast Sky & Equinox Noon'
          : 'Illustrative 40°N Latitude Scenario + CIE Overcast Sky (Scenario Assumption)',
        description: hasVerifiedSiteCoords
          ? 'Uses explicit site latitude/longitude with CIE Standard Overcast Sky and March Equinox 12:00 solar screening.'
          : 'Site latitude/longitude are not configured on the project; uses an explicitly labelled 40.0°N, 0.0°E illustrative scenario assumption.',
        latitudeDeg: hasVerifiedSiteCoords ? siteLat : 40.0,
        longitudeDeg: hasVerifiedSiteCoords ? siteLon : 0.0,
        timeZoneUtcOffsetHours: 0,
        isDaylightSavingTime: false,
        locationProvenance: hasVerifiedSiteCoords ? 'user-entered' : 'illustrative-scenario-assumption',
        analysisDateIso: '2026-03-21',
        analysisLocalTime24h: '12:00',
        dateTimeProvenance: 'illustrative-scenario-assumption',
        skyModelCondition: 'cie-standard-overcast-sky',
        overcastExteriorIlluminanceLux: 10000,
        skyConditionProvenance: 'imported-weather-or-sky',
        hasValidatedHourlyWeatherFile: false,
        weatherFileNote: 'No hourly TMY/EPW climate file attached; Mode D annual simulation (sDA/ASE) is disabled.',
      },
      windowOverrides: {},
      createdAt: '2026-10-26T00:00:00.000Z',
    },
    {
      scenarioId: 'p38-scen-summer-afternoon-low-sun',
      name: 'Scenario 2 — Afternoon Low-Angle Sun & Glare Stress Test (16:00)',
      description:
        'Tests afternoon low-angle solar exposure (16:00 local time) to screen West/South-West windows for direct-sun penetration and potential glare.',
      isBaseline: false,
      environmentalConditions: {
        conditionId: 'p38-env-afternoon-glare',
        label: 'Afternoon Solar Exposure (16:00 Local Time)',
        description:
          'Evaluates direct solar beam penetration and overhang/side-fin shading performance during afternoon working hours.',
        latitudeDeg: hasVerifiedSiteCoords ? siteLat : 40.0,
        longitudeDeg: hasVerifiedSiteCoords ? siteLon : 0.0,
        timeZoneUtcOffsetHours: 0,
        isDaylightSavingTime: false,
        locationProvenance: hasVerifiedSiteCoords ? 'user-entered' : 'illustrative-scenario-assumption',
        analysisDateIso: '2026-03-21',
        analysisLocalTime24h: '16:00',
        dateTimeProvenance: 'illustrative-scenario-assumption',
        skyModelCondition: 'cie-standard-overcast-sky',
        overcastExteriorIlluminanceLux: 10000,
        skyConditionProvenance: 'imported-weather-or-sky',
        hasValidatedHourlyWeatherFile: false,
        weatherFileNote: 'No hourly TMY/EPW climate file attached.',
      },
      windowOverrides: {},
      createdAt: '2026-10-26T00:00:00.000Z',
    },
    {
      scenarioId: 'p38-scen-winter-solstice-morning',
      name: 'Scenario 3 — Winter Solstice Low Sun (Dec 21, 10:00)',
      description:
        'Tests low winter solar altitude on December 21 at 10:00 to inspect deep direct-sun penetration and low-angle glare risk.',
      isBaseline: false,
      environmentalConditions: {
        conditionId: 'p38-env-winter-morning',
        label: 'Winter Solstice Morning (Dec 21, 10:00)',
        description:
          'Evaluates low solar altitude angle during winter morning hours.',
        latitudeDeg: hasVerifiedSiteCoords ? siteLat : 40.0,
        longitudeDeg: hasVerifiedSiteCoords ? siteLon : 0.0,
        timeZoneUtcOffsetHours: 0,
        isDaylightSavingTime: false,
        locationProvenance: hasVerifiedSiteCoords ? 'user-entered' : 'illustrative-scenario-assumption',
        analysisDateIso: '2026-12-21',
        analysisLocalTime24h: '10:00',
        dateTimeProvenance: 'illustrative-scenario-assumption',
        skyModelCondition: 'cie-standard-overcast-sky',
        overcastExteriorIlluminanceLux: 10000,
        skyConditionProvenance: 'imported-weather-or-sky',
        hasValidatedHourlyWeatherFile: false,
        weatherFileNote: 'No hourly TMY/EPW climate file attached.',
      },
      windowOverrides: {},
      createdAt: '2026-10-26T00:00:00.000Z',
    },
  ];
}

/**
 * Determines which walls of a room are exterior building envelope walls vs. interior shared walls
 * using exact 2D floor-plan room coordinates on the same floor level.
 */
export function detectExteriorRoomWallEdges(
  room: FloorPlanRoom,
  allRooms: FloorPlanRoom[]
): WallCardinalEdge[] {
  const sameFloorOthers = (allRooms || []).filter(
    (r) =>
      r.id !== room.id &&
      (r.floorLevel || 1) === (room.floorLevel || 1) &&
      Number.isFinite(r.x) &&
      Number.isFinite(r.y) &&
      Number.isFinite(r.width) &&
      r.width > 0 &&
      Number.isFinite(r.length) &&
      r.length > 0
  );

  const tol = 0.25;
  const rx1 = room.x;
  const ry1 = room.y;
  const rx2 = room.x + room.width;
  const ry2 = room.y + room.length;

  let northShared = 0;
  let southShared = 0;
  let eastShared = 0;
  let westShared = 0;

  for (const nb of sameFloorOthers) {
    const nx1 = nb.x;
    const ny1 = nb.y;
    const nx2 = nb.x + nb.width;
    const ny2 = nb.y + nb.length;

    const overlapX = Math.max(0, Math.min(rx2, nx2) - Math.max(rx1, nx1));
    const overlapY = Math.max(0, Math.min(ry2, ny2) - Math.max(ry1, ny1));

    if (Math.abs(ry1 - ny2) <= tol && overlapX > 0.1) {
      northShared += overlapX;
    }
    if (Math.abs(ry2 - ny1) <= tol && overlapX > 0.1) {
      southShared += overlapX;
    }
    if (Math.abs(rx2 - nx1) <= tol && overlapY > 0.1) {
      eastShared += overlapY;
    }
    if (Math.abs(rx1 - nx2) <= tol && overlapY > 0.1) {
      westShared += overlapY;
    }
  }

  const exterior: WallCardinalEdge[] = [];
  if (northShared < room.width * 0.75) exterior.push('north');
  if (southShared < room.width * 0.75) exterior.push('south');
  if (eastShared < room.length * 0.75) exterior.push('east');
  if (westShared < room.length * 0.75) exterior.push('west');

  return exterior;
}

/**
 * Initializes or normalizes `ProjectDaylightComfortData` on a project without mutating upstream P30–P37 state.
 * Synchronizes existing room ceiling heights from P36/P37 and existing window records from P33/P37
 * while preserving exact provenance and never inventing missing window heights or glazing VT!
 */
export function initializeProjectDaylightComfortData(
  project: Project
): ProjectDaylightComfortData {
  const rooms = project.floorPlan?.rooms || [];
  const p36Data = project.acousticPlanner;
  const p37Data = project.naturalVentilation;
  const p33Data = project.furnitureLayout;

  const existing = project.daylightComfort;
  const defaultScenarios = createDefaultDaylightScenarios(project);

  // Build roomConfigs
  const roomConfigs: Record<string, RoomDaylightConfig> = {};
  for (const rm of rooms) {
    const prevCfg = existing?.roomConfigs?.[rm.id];
    const p36RoomCfg = p36Data?.roomConfigs?.[rm.id];
    const p37RoomCfg = p37Data?.roomConfigs?.[rm.id];

    // Inherit ceiling height from P38 if set, else P37 or P36 if already user-configured
    let ceilingHeight: number | null = prevCfg?.ceilingHeight ?? null;
    let ceilingHeightProvenance: DaylightEvidenceProvenance =
      prevCfg?.ceilingHeightProvenance ?? 'unavailable-or-unverified';

    if (ceilingHeight === null) {
      if (
        p37RoomCfg &&
        typeof p37RoomCfg.ceilingHeight === 'number' &&
        Number.isFinite(p37RoomCfg.ceilingHeight) &&
        p37RoomCfg.ceilingHeight > 0
      ) {
        ceilingHeight =
          p37RoomCfg.heightUnit === project.unit
            ? p37RoomCfg.ceilingHeight
            : project.unit === 'metres'
            ? round2(p37RoomCfg.ceilingHeight * METRES_PER_FOOT)
            : round2(p37RoomCfg.ceilingHeight / METRES_PER_FOOT);
        ceilingHeightProvenance =
          p37RoomCfg.ceilingHeightProvenance === 'user-entered'
            ? 'user-entered'
            : 'illustrative-scenario-assumption';
      } else if (
        p36RoomCfg &&
        typeof p36RoomCfg.ceilingHeight === 'number' &&
        Number.isFinite(p36RoomCfg.ceilingHeight) &&
        p36RoomCfg.ceilingHeight > 0
      ) {
        ceilingHeight =
          p36RoomCfg.heightUnit === project.unit
            ? p36RoomCfg.ceilingHeight
            : project.unit === 'metres'
            ? round2(p36RoomCfg.ceilingHeight * METRES_PER_FOOT)
            : round2(p36RoomCfg.ceilingHeight / METRES_PER_FOOT);
        ceilingHeightProvenance =
          p36RoomCfg.ceilingHeightProvenance === 'user-entered'
            ? 'user-entered'
            : 'illustrative-scenario-assumption';
      }
    }

    const defaultWorkPlane =
      prevCfg?.workPlaneHeight !== undefined
        ? prevCfg.workPlaneHeight
        : project.unit === 'feet'
        ? 2.62 // 0.80 m standard desk plane
        : 0.8;

    roomConfigs[rm.id] = {
      roomId: rm.id,
      geometryShape: prevCfg?.geometryShape || 'rectangle',
      ceilingHeight,
      ceilingHeightProvenance,
      workPlaneHeight: defaultWorkPlane,
      workPlaneProvenance:
        prevCfg?.workPlaneProvenance || 'traceable-generic-reference',
      perimeterGridMargin:
        prevCfg?.perimeterGridMargin ?? (project.unit === 'feet' ? 1.64 : 0.5),
      analysisGridSpacing:
        prevCfg?.analysisGridSpacing ?? (project.unit === 'feet' ? 3.28 : 1.0),
      dimensionUnit: project.unit,
      ceilingReflectance:
        prevCfg && prevCfg.ceilingReflectance !== undefined
          ? prevCfg.ceilingReflectance
          : 0.80,
      ceilingReflectanceProvenance:
        prevCfg?.ceilingReflectanceProvenance || 'illustrative-scenario-assumption',
      wallReflectance:
        prevCfg && prevCfg.wallReflectance !== undefined
          ? prevCfg.wallReflectance
          : 0.60,
      wallReflectanceProvenance:
        prevCfg?.wallReflectanceProvenance || 'illustrative-scenario-assumption',
      floorReflectance:
        prevCfg && prevCfg.floorReflectance !== undefined
          ? prevCfg.floorReflectance
          : 0.25,
      floorReflectanceProvenance:
        prevCfg?.floorReflectanceProvenance || 'illustrative-scenario-assumption',
      visualPriorities: prevCfg?.visualPriorities ||
        (rm.type === 'office'
          ? ['vdt-screen-glare-control', 'high-daylight-task-illumination', 'exterior-view-connection']
          : rm.type === 'bedroom'
          ? ['morning-sunlight-access', 'privacy-and-darkening', 'exterior-view-connection']
          : ['high-daylight-task-illumination', 'exterior-view-connection']),
      updatedAt: prevCfg?.updatedAt || '2026-10-26T00:00:00.000Z',
    };
  }

  // Synchronize windows from existing P38 records, P33 knownOpenings, and P37 openings
  const windows: DaylightWindowRecord[] = Array.isArray(existing?.windows)
    ? existing!.windows.map((w) => ({ ...w }))
    : [];

  // 1. Sync any P33 KnownRoomOpening of type === 'window' not yet represented
  for (const p33Op of p33Data?.knownOpenings || []) {
    if (p33Op.type !== 'window') continue;
    const alreadySynced = windows.some(
      (w) => w.linkedP33OpeningId === p33Op.openingId || w.windowId === p33Op.openingId
    );
    if (!alreadySynced) {
      // CRITICAL P38 RULE (Section 7 & Section 14 P33):
      // P33 KnownRoomOpening only stores width! Never invent window height, VT, or glazed area from P33 alone.
      windows.push({
        windowId: `p38-win-from-p33-${p33Op.openingId}`,
        roomId: p33Op.roomId,
        linkedP33OpeningId: p33Op.openingId,
        label: p33Op.label || `Window (${p33Op.wallEdge.toUpperCase()})`,
        wallEdge: p33Op.wallEdge,
        floorLevel: p33Op.floorLevel || 1,
        offsetAlongWall: p33Op.offsetAlongWall,
        grossWidth: p33Op.width,
        grossHeight: null, // Explicitly null because P33 does not store window height
        sillHeight: null,
        headHeight: null,
        dimensionUnit: p33Data?.unit || project.unit,
        dimensionProvenance: 'derived-from-project-geometry',
        frameFraction: null,
        frameFractionProvenance: 'unavailable-or-unverified',
        explicitGlazedAreaInUnitSq: null,
        visibleTransmittanceVT: null, // Never fabricated from P33 record
        vtProvenance: 'unavailable-or-unverified',
        glazingAssemblyKind: 'unknown-glazing',
        maintenanceFactorM: 0.90,
        maintenanceProvenance: 'traceable-generic-reference',
        revealDepth: 0,
        exteriorShadingType: 'none',
        overhangProjectionDepth: null,
        overhangHeightAboveWindowHead: 0,
        sideFinProjectionDepth: null,
        exteriorLouverCutoffAngleDeg: null,
        interiorShadingType: 'none',
        defaultBlindState: 'retracted-open',
        interiorBlindTransmittanceMultiplier: null,
        interiorBlindProvenance: 'unavailable-or-unverified',
        operabilityStatus: 'unknown',
        notes: 'Imported from P33 KnownRoomOpening (width only; window height, frame fraction, and glazing VT require input).',
      });
    }
  }

  // 2. Sync any P37 VentilationOpeningRecord of category === 'window' or 'skylight'
  const nvInitialized = p37Data || initializeProjectNaturalVentilationData(project);
  for (const p37Op of nvInitialized.openings || []) {
    if (p37Op.category !== 'window' && p37Op.category !== 'skylight') continue;
    if (p37Op.boundaryLocation !== 'exterior-envelope') continue;
    const alreadySynced = windows.some(
      (w) =>
        w.linkedP37OpeningId === p37Op.openingId ||
        (p37Op.linkedP33OpeningId && w.linkedP33OpeningId === p37Op.linkedP33OpeningId)
    );
    if (!alreadySynced && windows.filter((w) => w.roomId === p37Op.roomId).length === 0) {
      const activeAlt =
        project.designAlternatives?.find((a) => a.id === project.activeAlternativeId) ||
        project.designAlternatives?.[0];
      const hasFacadeOverhang = activeAlt?.facade?.shadingStyle === 'deep-overhangs';

      windows.push({
        windowId: `p38-win-from-p37-${p37Op.openingId}`,
        roomId: p37Op.roomId,
        linkedP37OpeningId: p37Op.openingId,
        linkedP33OpeningId: p37Op.linkedP33OpeningId,
        label: p37Op.label,
        wallEdge: p37Op.wallEdge,
        floorLevel: p37Op.floorLevel || 1,
        offsetAlongWall: null,
        grossWidth: p37Op.grossWidth,
        grossHeight: p37Op.grossHeight,
        sillHeight: p37Op.sillElevation,
        headHeight:
          p37Op.sillElevation !== null && p37Op.grossHeight !== null
            ? round2(p37Op.sillElevation + p37Op.grossHeight)
            : p37Op.headElevation,
        dimensionUnit: p37Op.dimensionUnit,
        dimensionProvenance:
          p37Op.dimensionProvenance === 'user-entered'
            ? 'user-entered'
            : p37Op.dimensionProvenance === 'derived-from-project-geometry'
            ? 'derived-from-project-geometry'
            : 'illustrative-scenario-assumption',
        frameFraction: 0.15,
        frameFractionProvenance: 'illustrative-scenario-assumption',
        explicitGlazedAreaInUnitSq: null,
        visibleTransmittanceVT: 0.70,
        vtProvenance: 'illustrative-scenario-assumption',
        vtSourceProductAndVersion: 'Illustrative Double Clear Glazing Scenario Assumption (VT = 0.70)',
        vtSourceConditionsNote: 'Normal incidence visible transmittance scenario assumption; replace with manufacturer NFRC 200 / EN 410 data for verified assessment.',
        glazingAssemblyKind: 'double-clear-igu',
        maintenanceFactorM: 0.90,
        maintenanceProvenance: 'traceable-generic-reference',
        revealDepth: project.unit === 'feet' ? 0.5 : 0.15,
        exteriorShadingType: hasFacadeOverhang ? 'horizontal-overhang' : 'none',
        overhangProjectionDepth: hasFacadeOverhang
          ? project.unit === 'feet'
            ? 3.0
            : 0.9
          : null,
        overhangHeightAboveWindowHead: 0,
        sideFinProjectionDepth: null,
        exteriorLouverCutoffAngleDeg: null,
        interiorShadingType: 'sheer-diffusing-roller-blind',
        defaultBlindState: 'retracted-open',
        interiorBlindTransmittanceMultiplier: 0.35,
        interiorBlindProvenance: 'illustrative-scenario-assumption',
        operabilityStatus: p37Op.operabilityStatus,
        controlReachHeight: p37Op.hardwareReachHeight,
      });
    }
  }

  // 3. For unconfigured projects where rooms have exterior walls and no P33/P37 window records yet,
  // seed an explicitly labelled 'illustrative-scenario-assumption' window so sample projects can be evaluated
  if (!Array.isArray(existing?.windows)) {
    const activeAlt =
      project.designAlternatives?.find((a) => a.id === project.activeAlternativeId) ||
      project.designAlternatives?.[0];
    const hasFacadeOverhang = activeAlt?.facade?.shadingStyle === 'deep-overhangs';

    for (const rm of rooms) {
      if (windows.some((w) => w.roomId === rm.id)) continue;
      const extEdges = detectExteriorRoomWallEdges(rm, rooms);
      if (extEdges.length === 0) continue;
      const primaryEdge = extEdges.includes('south')
        ? 'south'
        : extEdges.includes('east')
        ? 'east'
        : extEdges[0];
      const wallSpan =
        primaryEdge === 'north' || primaryEdge === 'south' ? rm.width : rm.length;
      const winW = round2(
        Math.max(
          project.unit === 'feet' ? 3.5 : 1.1,
          Math.min(project.unit === 'feet' ? 8.0 : 2.4, wallSpan * 0.42)
        )
      );
      const winH = project.unit === 'feet' ? 4.8 : 1.5;
      const sillH = project.unit === 'feet' ? 2.8 : 0.85;

      windows.push({
        windowId: `p38-win-default-${rm.id}`,
        roomId: rm.id,
        label: `${rm.name} ${primaryEdge.toUpperCase()} Window`,
        wallEdge: primaryEdge,
        floorLevel: rm.floorLevel || 1,
        offsetAlongWall: round2(Math.max(0.5, (wallSpan - winW) / 2)),
        grossWidth: winW,
        grossHeight: winH,
        sillHeight: sillH,
        headHeight: round2(sillH + winH),
        dimensionUnit: project.unit,
        dimensionProvenance: 'illustrative-scenario-assumption',
        frameFraction: 0.15,
        frameFractionProvenance: 'illustrative-scenario-assumption',
        explicitGlazedAreaInUnitSq: null,
        visibleTransmittanceVT: 0.70,
        vtProvenance: 'illustrative-scenario-assumption',
        vtSourceProductAndVersion:
          'Illustrative Double Clear Glazing Scenario Assumption (VT = 0.70)',
        glazingAssemblyKind: 'double-clear-igu',
        maintenanceFactorM: 0.90,
        maintenanceProvenance: 'traceable-generic-reference',
        revealDepth: project.unit === 'feet' ? 0.5 : 0.15,
        exteriorShadingType: hasFacadeOverhang ? 'horizontal-overhang' : 'none',
        overhangProjectionDepth: hasFacadeOverhang
          ? project.unit === 'feet'
            ? 3.0
            : 0.9
          : null,
        overhangHeightAboveWindowHead: 0,
        sideFinProjectionDepth: null,
        exteriorLouverCutoffAngleDeg: null,
        interiorShadingType: 'sheer-diffusing-roller-blind',
        defaultBlindState: 'retracted-open',
        interiorBlindTransmittanceMultiplier: 0.35,
        interiorBlindProvenance: 'illustrative-scenario-assumption',
        operabilityStatus: 'operable',
      });
    }
  }

  const scenarios =
    Array.isArray(existing?.scenarios) && existing!.scenarios.length > 0
      ? existing!.scenarios
      : defaultScenarios;

  const activeScenarioId =
    existing?.activeScenarioId && scenarios.some((s) => s.scenarioId === existing.activeScenarioId)
      ? existing.activeScenarioId
      : scenarios[0].scenarioId;

  const comparisonScenarioId =
    existing?.comparisonScenarioId &&
    scenarios.some((s) => s.scenarioId === existing.comparisonScenarioId)
      ? existing.comparisonScenarioId
      : scenarios.length > 1
      ? scenarios[1].scenarioId
      : scenarios[0].scenarioId;

  const selectedRoomId =
    existing?.selectedRoomId && rooms.some((r) => r.id === existing.selectedRoomId)
      ? existing.selectedRoomId
      : rooms[0]?.id;

  return {
    schemaVersion: P38_DAYLIGHT_SCHEMA_VERSION,
    calculationMethodVersion: P38_DAYLIGHT_ANALYZER_ENGINE_VERSION,
    isConfigured: Boolean(existing?.isConfigured),
    selectedRoomId,
    selectedAssessmentMode:
      existing?.selectedAssessmentMode || 'mode-c-simplified-daylight-calculation',
    activeScenarioId,
    comparisonScenarioId,
    roomConfigs,
    windows,
    externalObstructions: Array.isArray(existing?.externalObstructions)
      ? existing!.externalObstructions
      : [],
    measuredIlluminanceRecords: existing?.measuredIlluminanceRecords || {},
    scenarios,
    customCriteriaOverrides: Array.isArray(existing?.customCriteriaOverrides)
      ? existing!.customCriteriaOverrides
      : [],
    lastEvaluatedAt: existing?.lastEvaluatedAt,
    lastSourceFingerprint: existing?.lastSourceFingerprint,
    lastPreApplySnapshotId: existing?.lastPreApplySnapshotId,
    requestSequenceId: existing?.requestSequenceId || 1,
  };
}

/**
 * Computes a deterministic fingerprint of all project, room, window, optical, obstruction,
 * orientation, and scenario inputs that influence P38 daylight and visual comfort calculations.
 */
export function computeDaylightComfortSourceFingerprint(
  project: Project,
  daylightData?: ProjectDaylightComfortData
): string {
  const dData = daylightData || initializeProjectDaylightComfortData(project);
  const roomsPart = (project.floorPlan?.rooms || [])
    .map(
      (r) =>
        `${r.id}:${r.name}:${r.type}:${r.floorLevel}:${r.x},${r.y},${r.width}x${r.length}`
    )
    .join('|');

  const cfgPart = Object.values(dData.roomConfigs || {})
    .sort((a, b) => a.roomId.localeCompare(b.roomId))
    .map(
      (c) =>
        `${c.roomId}:${c.geometryShape}:H=${c.ceilingHeight ?? 'null'}(${c.ceilingHeightProvenance}):WP=${c.workPlaneHeight ?? 'null'}:R=${c.ceilingReflectance ?? 'null'},${c.wallReflectance ?? 'null'},${c.floorReflectance ?? 'null'}`
    )
    .join('|');

  const winPart = (dData.windows || [])
    .map(
      (w) =>
        `${w.windowId}:${w.roomId}:${w.wallEdge}:${w.grossWidth ?? 'null'}x${w.grossHeight ?? 'null'}:sill=${w.sillHeight ?? 'null'}:ff=${w.frameFraction ?? 'null'}:vt=${w.visibleTransmittanceVT ?? 'null'}(${w.vtProvenance}):shade=${w.exteriorShadingType},${w.overhangProjectionDepth ?? 'null'},${w.sideFinProjectionDepth ?? 'null'}:blind=${w.interiorShadingType},${w.defaultBlindState},${w.interiorBlindTransmittanceMultiplier ?? 'null'}`
    )
    .join('|');

  const obsPart = (dData.externalObstructions || [])
    .map(
      (o) =>
        `${o.obstructionId}:${o.wallEdge}:D=${o.horizontalDistance}:H=${o.obstructionTopElevation}`
    )
    .join('|');

  const scenPart = (dData.scenarios || [])
    .map(
      (s) =>
        `${s.scenarioId}:${s.environmentalConditions.latitudeDeg ?? 'null'},${s.environmentalConditions.longitudeDeg ?? 'null'}:${s.environmentalConditions.analysisDateIso}@${s.environmentalConditions.analysisLocalTime24h}:${s.environmentalConditions.skyModelCondition}:${s.environmentalConditions.overcastExteriorIlluminanceLux ?? 'null'}:${JSON.stringify(s.windowOverrides || {})}`
    )
    .join('|');

  const northDeg = project.siteContext?.northOrientationOffsetDeg ?? 0;
  const p33Wins = (project.furnitureLayout?.knownOpenings || [])
    .filter((o) => o.type === 'window')
    .map((o) => `${o.openingId}:${o.width}`)
    .join(',');

  const raw = [
    P38_DAYLIGHT_ANALYZER_ENGINE_VERSION,
    project.id,
    project.unit,
    `north=${northDeg}`,
    `activeScen=${dData.activeScenarioId}`,
    `compScen=${dData.comparisonScenarioId || ''}`,
    roomsPart,
    cfgPart,
    winPart,
    obsPart,
    scenPart,
    p33Wins,
  ].join('||');

  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `p38-fp-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Generates a horizontal work-plane grid of analysis points strictly inside the room's boundaries
 * in SI metres, respecting `perimeterGridMarginMetres` and `analysisGridSpacingMetres`.
 */
export function generateRoomAnalysisPlaneGridSI(
  widthMetres: number,
  lengthMetres: number,
  workPlaneHeightMetres: number,
  perimeterMarginMetres: number,
  gridSpacingMetres: number,
  windowWallEdges: WallCardinalEdge[]
): {
  points: WorkPlaneAnalysisPointSI[];
  coveragePercent: number;
} {
  if (
    !Number.isFinite(widthMetres) ||
    widthMetres <= 0 ||
    !Number.isFinite(lengthMetres) ||
    lengthMetres <= 0 ||
    !Number.isFinite(workPlaneHeightMetres) ||
    workPlaneHeightMetres < 0
  ) {
    return { points: [], coveragePercent: 0 };
  }

  const safeMarginX = Math.min(
    Math.max(0.1, Number.isFinite(perimeterMarginMetres) ? perimeterMarginMetres : 0.5),
    widthMetres * 0.35
  );
  const safeMarginY = Math.min(
    Math.max(0.1, Number.isFinite(perimeterMarginMetres) ? perimeterMarginMetres : 0.5),
    lengthMetres * 0.35
  );

  const usableW = Math.max(0.1, widthMetres - 2 * safeMarginX);
  const usableL = Math.max(0.1, lengthMetres - 2 * safeMarginY);
  const safeSpacing = Math.max(
    0.25,
    Number.isFinite(gridSpacingMetres) && gridSpacingMetres > 0 ? gridSpacingMetres : 1.0
  );

  const cols = Math.min(12, Math.max(1, Math.floor(usableW / safeSpacing) + 1));
  const rows = Math.min(12, Math.max(1, Math.floor(usableL / safeSpacing) + 1));

  const stepX = cols > 1 ? usableW / (cols - 1) : 0;
  const stepY = rows > 1 ? usableL / (rows - 1) : 0;

  const points: WorkPlaneAnalysisPointSI[] = [];
  for (let r = 0; r < rows; r++) {
    const y = cols === 1 && rows === 1 ? lengthMetres / 2 : safeMarginY + r * stepY;
    for (let c = 0; c < cols; c++) {
      const x = cols === 1 ? widthMetres / 2 : safeMarginX + c * stepX;
      // Strict interior boundary guard: 0 < x < widthMetres and 0 < y < lengthMetres
      if (x <= 0 || x >= widthMetres || y <= 0 || y >= lengthMetres) continue;

      let minDist: number | null = null;
      for (const edge of windowWallEdges) {
        const d =
          edge === 'north'
            ? y
            : edge === 'south'
            ? lengthMetres - y
            : edge === 'west'
            ? x
            : widthMetres - x;
        if (minDist === null || d < minDist) {
          minDist = d;
        }
      }

      points.push({
        pointId: `pt-${r}-${c}`,
        row: r,
        col: c,
        localXMetres: round3(x),
        localYMetres: round3(y),
        elevationZMetres: round3(workPlaneHeightMetres),
        distanceToNearestWindowWallMetres: minDist !== null ? round3(minDist) : null,
        pointDaylightFactorProxyPercent: null,
        receivesDirectSunInScenario: false,
      });
    }
  }

  const coverageArea = usableW * usableL;
  const totalArea = widthMetres * lengthMetres;
  const coveragePercent = round2(Math.min(100, (coverageArea / totalArea) * 100));

  return { points, coveragePercent };
}

/**
 * Validates room geometry, origin coordinates, ceiling height, and work-plane grid in SI units (m, m², m³).
 * Accepts valid 0.0 origin coordinates (x = 0, y = 0) and rejects non-finite or non-positive dimensions.
 */
export function evaluateRoomDaylightGeometrySI(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomDaylightConfig | undefined,
  roomWindows: DaylightWindowRecord[]
): RoomDaylightGeometryValidationSI {
  const validationErrors: string[] = [];
  const missingGeometryDisclosures: string[] = [];
  const unit = project.unit || 'feet';

  const coordsFinite =
    typeof room?.x === 'number' &&
    Number.isFinite(room.x) &&
    typeof room?.y === 'number' &&
    Number.isFinite(room.y);

  if (!coordsFinite) {
    validationErrors.push('Room origin coordinates (x, y) must be finite numbers.');
  }

  const isOriginZeroValid = coordsFinite && (room.x === 0 || room.y === 0);

  const widthMetres = convertLengthToMetres(room?.width, unit);
  const lengthMetres = convertLengthToMetres(room?.length, unit);

  if (widthMetres === null || lengthMetres === null) {
    validationErrors.push(
      `Room dimensions (width=${room?.width}, length=${room?.length}) must be finite positive numbers.`
    );
  }

  const geometryShape = roomConfig?.geometryShape || 'rectangle';
  if (geometryShape === 'irregular-polygon-unsupported') {
    validationErrors.push(
      'Room shape is marked as an irregular polygon; P38 rectangular work-plane and Split-Flux surface equations do not support unmodeled non-rectangular polygons.'
    );
  }

  const is2DGeometryValid =
    coordsFinite &&
    widthMetres !== null &&
    lengthMetres !== null &&
    geometryShape === 'rectangle';

  const floorAreaM2 =
    is2DGeometryValid && widthMetres !== null && lengthMetres !== null
      ? round3(widthMetres * lengthMetres)
      : null;

  const cfgUnit = roomConfig?.dimensionUnit || unit;
  const ceilingHeightMetres =
    roomConfig?.ceilingHeight !== null && roomConfig?.ceilingHeight !== undefined
      ? convertLengthToMetres(roomConfig.ceilingHeight, cfgUnit)
      : null;

  const ceilingHeightProvenance: DaylightEvidenceProvenance =
    ceilingHeightMetres !== null
      ? roomConfig?.ceilingHeightProvenance || 'user-entered'
      : 'unavailable-or-unverified';

  if (ceilingHeightMetres === null) {
    missingGeometryDisclosures.push(
      'Room ceiling height is unspecified; total internal surface area (A_total), room volume (V), and Mode C Mean Daylight Factor are withheld until ceiling height is provided.'
    );
  }

  const roomVolumeM3 =
    floorAreaM2 !== null && ceilingHeightMetres !== null
      ? round3(floorAreaM2 * ceilingHeightMetres)
      : null;

  const totalInternalSurfaceAreaM2 =
    is2DGeometryValid &&
    widthMetres !== null &&
    lengthMetres !== null &&
    ceilingHeightMetres !== null &&
    floorAreaM2 !== null
      ? round3(
          2 * floorAreaM2 + 2 * (widthMetres + lengthMetres) * ceilingHeightMetres
        )
      : null;

  const rawWorkPlane = roomConfig?.workPlaneHeight ?? null;
  let workPlaneHeightMetres =
    rawWorkPlane !== null ? convertElevationToMetres(rawWorkPlane, cfgUnit) : null;

  if (
    workPlaneHeightMetres !== null &&
    ceilingHeightMetres !== null &&
    workPlaneHeightMetres >= ceilingHeightMetres
  ) {
    validationErrors.push(
      `Work-plane height (${round2(workPlaneHeightMetres)} m) must be strictly below room ceiling height (${round2(ceilingHeightMetres)} m).`
    );
    workPlaneHeightMetres = null;
  }

  const perimeterGridMarginMetres =
    convertLengthToMetres(roomConfig?.perimeterGridMargin ?? 0.5, cfgUnit) ?? 0.5;
  const analysisGridSpacingMetres =
    convertLengthToMetres(roomConfig?.analysisGridSpacing ?? 1.0, cfgUnit) ?? 1.0;

  const windowWallEdges = Array.from(
    new Set((roomWindows || []).map((w) => w.wallEdge))
  );

  const gridRes =
    is2DGeometryValid &&
    widthMetres !== null &&
    lengthMetres !== null &&
    workPlaneHeightMetres !== null
      ? generateRoomAnalysisPlaneGridSI(
          widthMetres,
          lengthMetres,
          workPlaneHeightMetres,
          perimeterGridMarginMetres,
          analysisGridSpacingMetres,
          windowWallEdges
        )
      : { points: [], coveragePercent: null };

  const northOrientationOffsetDeg =
    typeof project.siteContext?.northOrientationOffsetDeg === 'number' &&
    Number.isFinite(project.siteContext.northOrientationOffsetDeg)
      ? project.siteContext.northOrientationOffsetDeg
      : 0;

  const exteriorWallEdges = is2DGeometryValid
    ? detectExteriorRoomWallEdges(room, project.floorPlan?.rooms || [])
    : [];

  return {
    roomId: room?.id || 'unknown',
    roomName: room?.name || 'Unnamed Room',
    roomType: room?.type || 'other',
    floorLevel: room?.floorLevel || 1,
    geometryShape,
    projectUnit: unit,
    rawX: room?.x ?? Number.NaN,
    rawY: room?.y ?? Number.NaN,
    rawWidth: room?.width ?? Number.NaN,
    rawLength: room?.length ?? Number.NaN,
    isOriginZeroValid,
    is2DGeometryValid,
    widthMetres: widthMetres !== null ? round3(widthMetres) : null,
    lengthMetres: lengthMetres !== null ? round3(lengthMetres) : null,
    floorAreaM2,
    ceilingHeightMetres:
      ceilingHeightMetres !== null ? round3(ceilingHeightMetres) : null,
    ceilingHeightProvenance,
    roomVolumeM3,
    totalInternalSurfaceAreaM2,
    workPlaneHeightMetres:
      workPlaneHeightMetres !== null ? round3(workPlaneHeightMetres) : null,
    workPlaneProvenance:
      roomConfig?.workPlaneProvenance || 'traceable-generic-reference',
    perimeterGridMarginMetres: round3(perimeterGridMarginMetres),
    analysisGridSpacingMetres: round3(analysisGridSpacingMetres),
    analysisPoints: gridRes.points,
    analysisGridCoveragePercent: gridRes.coveragePercent,
    northOrientationOffsetDeg,
    exteriorWallEdges,
    validationErrors,
    missingGeometryDisclosures,
  };
}

/**
 * Evaluates a single `DaylightWindowRecord` (plus optional scenario overrides and external obstructions)
 * into validated SI optical and geometric metrics (`EvaluatedDaylightWindowSI`).
 *
 * CRITICAL P38 GUARDRAILS:
 * 1. Never assumes the entire gross opening area is transparent glazing unless frameFraction === 0.
 * 2. Never infers VT from U-factor, SHGC, or a generic glass label.
 * 3. If only window width is available (e.g. from P33), never invents window height or net glazed area.
 */
export function evaluateWindowForScenarioSI(
  project: Project,
  room: FloorPlanRoom,
  roomGeometry: RoomDaylightGeometryValidationSI,
  windowRec: DaylightWindowRecord,
  scenario: DaylightScenario,
  externalObstructions: ExternalObstructionRecord[]
): EvaluatedDaylightWindowSI {
  const missingDisclosures: string[] = [];
  const override = scenario.windowOverrides?.[windowRec.windowId];
  const winUnit = windowRec.dimensionUnit || project.unit || 'feet';

  const rawWidth = override?.grossWidth !== undefined ? override.grossWidth : windowRec.grossWidth;
  const rawHeight =
    override?.grossHeight !== undefined ? override.grossHeight : windowRec.grossHeight;
  const rawSill = override?.sillHeight !== undefined ? override.sillHeight : windowRec.sillHeight;

  const grossWidthMetres = convertLengthToMetres(rawWidth, winUnit);
  const grossHeightMetres = convertLengthToMetres(rawHeight, winUnit);

  if (grossWidthMetres === null) {
    missingDisclosures.push(`Window "${windowRec.label}" is missing a valid positive width.`);
  }
  if (grossHeightMetres === null) {
    missingDisclosures.push(
      `Window "${windowRec.label}" is missing window height; gross area and net glazed area cannot be computed from width alone.`
    );
  }

  const grossOpeningAreaM2 =
    grossWidthMetres !== null && grossHeightMetres !== null
      ? round4(grossWidthMetres * grossHeightMetres)
      : null;

  const sillHeightMetres =
    rawSill !== null && rawSill !== undefined
      ? convertElevationToMetres(rawSill, winUnit)
      : null;

  let headHeightMetres: number | null = null;
  if (sillHeightMetres !== null && grossHeightMetres !== null) {
    headHeightMetres = round3(sillHeightMetres + grossHeightMetres);
  } else if (windowRec.headHeight !== null && windowRec.headHeight !== undefined) {
    headHeightMetres = convertLengthToMetres(windowRec.headHeight, winUnit);
  } else {
    missingDisclosures.push(
      `Window "${windowRec.label}" sill/head elevation is unspecified; vertical window centre and limiting depth ratio use caution.`
    );
  }

  if (
    headHeightMetres !== null &&
    roomGeometry.ceilingHeightMetres !== null &&
    headHeightMetres > roomGeometry.ceilingHeightMetres + 0.05
  ) {
    missingDisclosures.push(
      `Window "${windowRec.label}" head height (${round2(headHeightMetres)} m) exceeds room ceiling height (${round2(roomGeometry.ceilingHeightMetres)} m).`
    );
  }

  const windowCentreHeightMetres =
    sillHeightMetres !== null && grossHeightMetres !== null
      ? round3(sillHeightMetres + 0.5 * grossHeightMetres)
      : headHeightMetres !== null && grossHeightMetres !== null
      ? round3(Math.max(0, headHeightMetres - 0.5 * grossHeightMetres))
      : null;

  // Frame fraction & net glazed area validation
  let frameFraction: number | null = null;
  if (
    windowRec.frameFraction !== null &&
    windowRec.frameFraction !== undefined &&
    typeof windowRec.frameFraction === 'number' &&
    Number.isFinite(windowRec.frameFraction)
  ) {
    if (windowRec.frameFraction >= 0 && windowRec.frameFraction < 1) {
      frameFraction = round3(windowRec.frameFraction);
    } else {
      missingDisclosures.push(
        `Window "${windowRec.label}" has an invalid framing fraction (${windowRec.frameFraction}); must be in [0, 1).`
      );
    }
  }

  let netGlazedAreaM2: number | null = null;
  if (
    windowRec.explicitGlazedAreaInUnitSq !== null &&
    windowRec.explicitGlazedAreaInUnitSq !== undefined
  ) {
    const explicitM2 = convertAreaToSquareMetres(
      windowRec.explicitGlazedAreaInUnitSq,
      winUnit
    );
    if (
      explicitM2 !== null &&
      (grossOpeningAreaM2 === null || explicitM2 <= grossOpeningAreaM2 + 1e-4)
    ) {
      netGlazedAreaM2 = round4(explicitM2);
    } else {
      missingDisclosures.push(
        `Window "${windowRec.label}" explicit glazed area is invalid or exceeds gross opening area.`
      );
    }
  } else if (grossOpeningAreaM2 !== null && frameFraction !== null) {
    netGlazedAreaM2 = round4(grossOpeningAreaM2 * (1 - frameFraction));
  } else if (grossOpeningAreaM2 !== null && frameFraction === null) {
    missingDisclosures.push(
      `Window "${windowRec.label}" is missing framing fraction (frameFraction) or explicit glazed area; P38 does not assume 100% of gross opening area is transparent glass.`
    );
  }

  // Visible Transmittance (VT / Tvis) validation — NEVER inferred from U-factor, SHGC, or glazingAssemblyKind!
  const rawVT =
    override?.visibleTransmittanceVT !== undefined
      ? override.visibleTransmittanceVT
      : windowRec.visibleTransmittanceVT;
  const rawVtProvenance =
    override?.vtProvenance !== undefined ? override.vtProvenance : windowRec.vtProvenance;

  let visibleTransmittanceVT: number | null = null;
  let vtProvenance: DaylightEvidenceProvenance = 'unavailable-or-unverified';

  if (rawVT !== null && rawVT !== undefined && typeof rawVT === 'number' && Number.isFinite(rawVT)) {
    if (rawVT > 0 && rawVT <= 1.0) {
      visibleTransmittanceVT = round3(rawVT);
      // Never auto-promote user-entered or scenario-assumption to manufacturer-or-lab-test
      vtProvenance =
        rawVtProvenance && rawVtProvenance !== 'unavailable-or-unverified'
          ? rawVtProvenance
          : 'user-entered';
    } else {
      missingDisclosures.push(
        `Window "${windowRec.label}" visible light transmittance (VT = ${rawVT}) is out of physical range (0, 1]. Rejected.`
      );
    }
  } else {
    if (
      (windowRec.reportedUFactorWPerM2K !== null &&
        windowRec.reportedUFactorWPerM2K !== undefined) ||
      (windowRec.reportedShgc !== null && windowRec.reportedShgc !== undefined)
    ) {
      missingDisclosures.push(
        `Window "${windowRec.label}" reports U-factor/SHGC but omits Visible Light Transmittance (VT/Tvis). P38 never infers VT from thermal U-factor or solar heat-gain coefficient.`
      );
    } else {
      missingDisclosures.push(
        `Window "${windowRec.label}" is missing Visible Light Transmittance (VT/Tvis); numerical daylight calculations require explicit VT in (0, 1].`
      );
    }
  }

  const maintenanceFactorM =
    typeof windowRec.maintenanceFactorM === 'number' &&
    Number.isFinite(windowRec.maintenanceFactorM) &&
    windowRec.maintenanceFactorM > 0 &&
    windowRec.maintenanceFactorM <= 1
      ? round3(windowRec.maintenanceFactorM)
      : 0.90;

  const blindDeploymentState: MovableShadingDeploymentState =
    override?.blindDeploymentState || windowRec.defaultBlindState || 'retracted-open';

  let interiorBlindMultiplier: number | null = 1.0;
  if (blindDeploymentState !== 'retracted-open' && windowRec.interiorShadingType !== 'none') {
    const rawBlindMult = windowRec.interiorBlindTransmittanceMultiplier;
    if (
      rawBlindMult !== null &&
      rawBlindMult !== undefined &&
      typeof rawBlindMult === 'number' &&
      Number.isFinite(rawBlindMult) &&
      rawBlindMult >= 0 &&
      rawBlindMult <= 1
    ) {
      interiorBlindMultiplier =
        blindDeploymentState === 'fully-deployed-closed'
          ? round3(rawBlindMult)
          : round3(1 - 0.5 * (1 - rawBlindMult));
    } else {
      interiorBlindMultiplier = null;
      missingDisclosures.push(
        `Window "${windowRec.label}" has an active interior blind (${windowRec.interiorShadingType}, ${blindDeploymentState}) without a specified optical transmittance multiplier. P38 does not guess blind transmission.`
      );
    }
  }

  const effectiveTransmittanceT =
    visibleTransmittanceVT !== null && interiorBlindMultiplier !== null
      ? round4(visibleTransmittanceVT * interiorBlindMultiplier)
      : null;

  // Exterior shading dimensions in SI metres
  const exteriorShadingType =
    override?.exteriorShadingType || windowRec.exteriorShadingType || 'none';
  const rawOverhang =
    override?.overhangProjectionDepth !== undefined
      ? override.overhangProjectionDepth
      : windowRec.overhangProjectionDepth;
  const rawFin =
    override?.sideFinProjectionDepth !== undefined
      ? override.sideFinProjectionDepth
      : windowRec.sideFinProjectionDepth;
  const rawLouverCutoff =
    override?.exteriorLouverCutoffAngleDeg !== undefined
      ? override.exteriorLouverCutoffAngleDeg
      : windowRec.exteriorLouverCutoffAngleDeg;

  const overhangProjectionMetres =
    exteriorShadingType === 'horizontal-overhang' ||
    exteriorShadingType === 'combined-overhang-and-fins'
      ? convertLengthToMetres(rawOverhang, winUnit)
      : null;

  const overhangGapAboveHeadMetres =
    convertElevationToMetres(windowRec.overhangHeightAboveWindowHead ?? 0, winUnit) ?? 0;

  const sideFinProjectionMetres =
    exteriorShadingType === 'vertical-side-fins' ||
    exteriorShadingType === 'combined-overhang-and-fins'
      ? convertLengthToMetres(rawFin, winUnit)
      : null;

  const exteriorLouverCutoffAngleDeg =
    exteriorShadingType === 'external-louvers-brise-soleil' &&
    typeof rawLouverCutoff === 'number' &&
    Number.isFinite(rawLouverCutoff) &&
    rawLouverCutoff > 0 &&
    rawLouverCutoff < 90
      ? round2(rawLouverCutoff)
      : null;

  // External obstruction angle θ_obs (deg) from window centre
  const wallObstructions = (externalObstructions || []).filter(
    (o) => o.wallEdge === windowRec.wallEdge
  );
  let externalObstructionAngleDeg = 0;
  const refWinCentreZ = windowCentreHeightMetres ?? 1.5;

  for (const obs of wallObstructions) {
    const distM = convertLengthToMetres(obs.horizontalDistance, obs.dimensionUnit);
    const topM = convertElevationToMetres(obs.obstructionTopElevation, obs.dimensionUnit);
    if (distM !== null && topM !== null && topM > refWinCentreZ) {
      const angleDeg = Math.atan2(topM - refWinCentreZ, distM) * RAD_TO_DEG;
      if (angleDeg > externalObstructionAngleDeg) {
        externalObstructionAngleDeg = round2(angleDeg);
      }
    }
  }

  // Overhang sky cut-off angle θ_overhang (deg) from window centre
  let overhangSkyCutoffAngleDeg = 0;
  if (overhangProjectionMetres !== null && grossHeightMetres !== null) {
    const verticalDistCentreToOverhang = 0.5 * grossHeightMetres + overhangGapAboveHeadMetres;
    if (verticalDistCentreToOverhang > 0) {
      overhangSkyCutoffAngleDeg = round2(
        Math.atan2(overhangProjectionMetres, verticalDistCentreToOverhang) * RAD_TO_DEG * 0.55
      );
    }
  } else if (exteriorLouverCutoffAngleDeg !== null) {
    overhangSkyCutoffAngleDeg = round2((90 - exteriorLouverCutoffAngleDeg) * 0.6);
  }

  const visibleVerticalSkyAngleDeg = round2(
    Math.max(0, 90 - externalObstructionAngleDeg - overhangSkyCutoffAngleDeg)
  );

  // Check P33 furniture obstruction near window wall
  let p33FurnitureObstructionWarning: string | undefined;
  const furnitureInstances = (project.furnitureLayout?.instances || []).filter(
    (inst) => inst.roomId === room.id
  );
  for (const inst of furnitureInstances) {
    const instHeightM = convertLengthToMetres(inst.height, inst.unit) ?? 0;
    const sillM = sillHeightMetres ?? 0.9;
    if (instHeightM > sillM + 0.15) {
      const distToWall =
        windowRec.wallEdge === 'north'
          ? inst.y - room.y
          : windowRec.wallEdge === 'south'
          ? room.y + room.length - (inst.y + inst.depth)
          : windowRec.wallEdge === 'west'
          ? inst.x - room.x
          : room.x + room.width - (inst.x + inst.width);
      const distM = convertElevationToMetres(Math.max(0, distToWall), project.unit) ?? 99;
      if (distM <= 0.6) {
        p33FurnitureObstructionWarning = `Placed furniture item "${inst.name}" (height ${round2(instHeightM)} m) sits within ${round2(distM)} m of ${windowRec.wallEdge.toUpperCase()} window "${windowRec.label}" and rises above sill height (${round2(sillM)} m), potentially obstructing daylight and view out. (Flagged as geometric warning; no arbitrary lux deduction applied).`;
        break;
      }
    }
  }

  // Check P34 accessibility control reach height
  let p34AccessibilityControlWarning: string | undefined;
  if (
    windowRec.controlReachHeight !== null &&
    windowRec.controlReachHeight !== undefined
  ) {
    const reachM = convertElevationToMetres(windowRec.controlReachHeight, winUnit);
    if (reachM !== null && (reachM > 1.22 || reachM < 0.38)) {
      p34AccessibilityControlWarning = `Window/shade control height on "${windowRec.label}" (${round2(reachM)} m above floor) falls outside typical accessible forward/side reach limits (0.38 m – 1.22 m / 15 in – 48 in per P34).`;
    }
  }

  const compassAzimuthDeg = getWallCompassAzimuthDeg(
    windowRec.wallEdge,
    roomGeometry.northOrientationOffsetDeg
  );

  return {
    windowId: windowRec.windowId,
    label: windowRec.label,
    roomId: windowRec.roomId,
    wallEdge: windowRec.wallEdge,
    compassAzimuthDeg,
    grossWidthMetres: grossWidthMetres !== null ? round3(grossWidthMetres) : null,
    grossHeightMetres: grossHeightMetres !== null ? round3(grossHeightMetres) : null,
    grossOpeningAreaM2,
    sillHeightMetres: sillHeightMetres !== null ? round3(sillHeightMetres) : null,
    headHeightMetres: headHeightMetres !== null ? round3(headHeightMetres) : null,
    windowCentreHeightMetres,
    frameFraction,
    frameFractionProvenance: windowRec.frameFractionProvenance,
    netGlazedAreaM2,
    dimensionProvenance: windowRec.dimensionProvenance,
    visibleTransmittanceVT,
    vtProvenance,
    maintenanceFactorM,
    interiorShadingType: windowRec.interiorShadingType,
    blindDeploymentState,
    interiorBlindMultiplier,
    effectiveTransmittanceT,
    exteriorShadingType,
    overhangProjectionMetres:
      overhangProjectionMetres !== null ? round3(overhangProjectionMetres) : null,
    overhangGapAboveHeadMetres: round3(overhangGapAboveHeadMetres),
    sideFinProjectionMetres:
      sideFinProjectionMetres !== null ? round3(sideFinProjectionMetres) : null,
    exteriorLouverCutoffAngleDeg,
    externalObstructionAngleDeg,
    overhangSkyCutoffAngleDeg,
    visibleVerticalSkyAngleDeg,
    p33FurnitureObstructionWarning,
    p34AccessibilityControlWarning,
    missingOpticalOrDimensionDisclosures: missingDisclosures,
  };
}

/**
 * Evaluates Mode A — Geometric Daylight Potential per P38 Section 9 Mode A.
 */
export function evaluateModeAGeometricDaylightPotential(
  roomGeometry: RoomDaylightGeometryValidationSI,
  evaluatedWindows: EvaluatedDaylightWindowSI[],
  externalObstructions: ExternalObstructionRecord[],
  criteria: ConfiguredDaylightCriterion[],
  confirmedBriefDaylightRequired: boolean | null
): ModeAGeometricDaylightResult {
  const floorAreaM2 = roomGeometry.floorAreaM2;
  const windowCount = evaluatedWindows.length;
  const windowsWithCompleteDimensions = evaluatedWindows.filter(
    (w) => w.grossOpeningAreaM2 !== null && w.grossOpeningAreaM2 > 0
  );
  const windowsWithWidthOnly = evaluatedWindows.filter(
    (w) => w.grossWidthMetres !== null && w.grossHeightMetres === null
  );
  const windowsWithNetGlazed = evaluatedWindows.filter(
    (w) => w.netGlazedAreaM2 !== null && w.netGlazedAreaM2 >= 0
  );

  const totalGrossWindowAreaM2 =
    windowsWithCompleteDimensions.length > 0
      ? round3(
          windowsWithCompleteDimensions.reduce(
            (sum, w) => sum + (w.grossOpeningAreaM2 || 0),
            0
          )
        )
      : windowCount === 0
      ? 0
      : null;

  const totalNetGlazedAreaM2 =
    windowsWithNetGlazed.length > 0 && windowsWithNetGlazed.length === windowCount
      ? round3(
          windowsWithNetGlazed.reduce((sum, w) => sum + (w.netGlazedAreaM2 || 0), 0)
        )
      : windowCount === 0
      ? 0
      : null;

  const grossWindowToFloorAreaRatioPercent =
    floorAreaM2 !== null && floorAreaM2 > 0 && totalGrossWindowAreaM2 !== null
      ? round2((totalGrossWindowAreaM2 / floorAreaM2) * 100)
      : null;

  const netGlazedToFloorAreaRatioPercent =
    floorAreaM2 !== null && floorAreaM2 > 0 && totalNetGlazedAreaM2 !== null
      ? round2((totalNetGlazedAreaM2 / floorAreaM2) * 100)
      : null;

  // Primary window orientations
  const orientationMap = new Map<
    WallCardinalEdge,
    { wallEdge: WallCardinalEdge; azimuthDeg: number; windowCount: number; area: number }
  >();
  for (const w of evaluatedWindows) {
    const cur = orientationMap.get(w.wallEdge) || {
      wallEdge: w.wallEdge,
      azimuthDeg: w.compassAzimuthDeg,
      windowCount: 0,
      area: 0,
    };
    cur.windowCount += 1;
    cur.area += w.grossOpeningAreaM2 || 0;
    orientationMap.set(w.wallEdge, cur);
  }
  const primaryWindowOrientations = Array.from(orientationMap.values())
    .sort((a, b) => b.area - a.area || b.windowCount - a.windowCount)
    .map(({ wallEdge, azimuthDeg, windowCount: wc }) => ({
      wallEdge,
      azimuthDeg,
      windowCount: wc,
    }));

  // Window-to-exterior-wall ratio (WWR) on windowed walls
  let windowToWallRatioPercent: number | null = null;
  if (
    roomGeometry.ceilingHeightMetres !== null &&
    roomGeometry.widthMetres !== null &&
    roomGeometry.lengthMetres !== null &&
    totalGrossWindowAreaM2 !== null &&
    primaryWindowOrientations.length > 0
  ) {
    let windowedFacadeWallAreaM2 = 0;
    for (const ori of primaryWindowOrientations) {
      const wallLen =
        ori.wallEdge === 'north' || ori.wallEdge === 'south'
          ? roomGeometry.widthMetres
          : roomGeometry.lengthMetres;
      windowedFacadeWallAreaM2 += wallLen * roomGeometry.ceilingHeightMetres;
    }
    if (windowedFacadeWallAreaM2 > 0) {
      windowToWallRatioPercent = round2(
        Math.min(100, (totalGrossWindowAreaM2 / windowedFacadeWallAreaM2) * 100)
      );
    }
  }

  // Room depth perpendicular to primary window wall
  let roomDepthFromPrimaryWindowWallMetres: number | null = null;
  if (
    primaryWindowOrientations.length > 0 &&
    roomGeometry.widthMetres !== null &&
    roomGeometry.lengthMetres !== null
  ) {
    const primaryEdge = primaryWindowOrientations[0].wallEdge;
    roomDepthFromPrimaryWindowWallMetres =
      primaryEdge === 'north' || primaryEdge === 'south'
        ? roomGeometry.lengthMetres
        : roomGeometry.widthMetres;
  }

  const validHeads = evaluatedWindows
    .map((w) => w.headHeightMetres)
    .filter((h): h is number => h !== null && h > 0);
  const primaryWindowHeadHeightMetres =
    validHeads.length > 0 ? round3(Math.max(...validHeads)) : null;

  const depthToWindowHeadRatio =
    roomDepthFromPrimaryWindowWallMetres !== null &&
    primaryWindowHeadHeightMetres !== null &&
    primaryWindowHeadHeightMetres > 0
      ? round2(roomDepthFromPrimaryWindowWallMetres / primaryWindowHeadHeightMetres)
      : null;

  const limitingDepthHeuristicThreshold = 2.5;
  const exceedsLimitingDepthHeuristic =
    depthToWindowHeadRatio !== null
      ? depthToWindowHeadRatio > limitingDepthHeuristicThreshold
      : null;

  const hasExteriorShadingConfigured = evaluatedWindows.some(
    (w) => w.exteriorShadingType !== 'none'
  );
  const hasExternalObstructionsConfigured = externalObstructions.length > 0;

  const gfrCrit =
    criteria.find((c) => c.metric === 'glazed-to-floor-area-ratio-percent') ||
    DEFAULT_DAYLIGHT_CRITERIA[0];
  const depthCrit =
    criteria.find((c) => c.metric === 'room-depth-to-window-head-ratio') ||
    DEFAULT_DAYLIGHT_CRITERIA[2];

  const criterionChecks: ModeAGeometricDaylightResult['criterionChecks'] = [
    {
      criterion: gfrCrit,
      measuredValue: netGlazedToFloorAreaRatioPercent,
      meetsTarget:
        netGlazedToFloorAreaRatioPercent !== null && gfrCrit.minTarget !== null
          ? netGlazedToFloorAreaRatioPercent >= gfrCrit.minTarget
          : null,
      note:
        netGlazedToFloorAreaRatioPercent !== null
          ? `Net Glazed-to-Floor Ratio is ${netGlazedToFloorAreaRatioPercent}% vs. advisory screening target >= ${gfrCrit.minTarget}%.`
          : 'Net glazed area or room floor area is incomplete.',
    },
    {
      criterion: depthCrit,
      measuredValue: depthToWindowHeadRatio,
      meetsTarget:
        depthToWindowHeadRatio !== null && depthCrit.maxTarget !== null
          ? depthToWindowHeadRatio <= depthCrit.maxTarget
          : null,
      note:
        depthToWindowHeadRatio !== null
          ? `Room depth to window head height ratio (L / H_head) is ${depthToWindowHeadRatio} vs. advisory threshold <= ${depthCrit.maxTarget}.`
          : 'Window head height or room depth is unspecified.',
    },
  ];

  let completenessState: DaylightCompletenessState = 'sufficient-for-geometric-screening';
  if (!roomGeometry.is2DGeometryValid) {
    completenessState = 'invalid-input';
  } else if (windowCount === 0 || windowsWithWidthOnly.length > 0 || totalNetGlazedAreaM2 === null) {
    completenessState = 'insufficient-evidence';
  }

  return {
    mode: 'mode-a-geometric-potential',
    completenessState,
    floorAreaM2,
    windowCount,
    windowsWithCompleteDimensionsCount: windowsWithCompleteDimensions.length,
    windowsWithWidthOnlyCount: windowsWithWidthOnly.length,
    totalGrossWindowAreaM2,
    totalNetGlazedAreaM2,
    grossWindowToFloorAreaRatioPercent,
    netGlazedToFloorAreaRatioPercent,
    windowToWallRatioPercent,
    primaryWindowOrientations,
    roomDepthFromPrimaryWindowWallMetres,
    primaryWindowHeadHeightMetres,
    depthToWindowHeadRatio,
    limitingDepthHeuristicThreshold,
    exceedsLimitingDepthHeuristic,
    hasExteriorShadingConfigured,
    hasExternalObstructionsConfigured,
    confirmedBriefDaylightRequired,
    criterionChecks,
    nonComplianceAndProxyDisclosure:
      'Mode A geometric ratios (WFR, GFR, WWR, L/H_head) describe physical window geometry and daylight access potential only. They are NOT equivalent to illuminance (lux), Daylight Factor (%), or annual Daylight Autonomy (sDA), and do NOT prove building-code compliance.',
    explanation:
      windowCount === 0
        ? `No exterior windows are recorded for ${roomGeometry.roomName}; geometric daylight potential is 0%.`
        : netGlazedToFloorAreaRatioPercent !== null
        ? `${roomGeometry.roomName} has ${windowCount} window(s) with ${totalNetGlazedAreaM2} m² net glazed area (${netGlazedToFloorAreaRatioPercent}% of ${floorAreaM2} m² floor area).`
        : `${roomGeometry.roomName} has ${windowCount} window record(s), but ${windowsWithWidthOnly.length} window(s) lack height or framing fraction data so net glazed area cannot be completed.`,
  };
}

/**
 * Computes day of year N (1..365) from an ISO date string 'YYYY-MM-DD'.
 */
export function computeDayOfYearFromIsoDate(isoDate: string): number | null {
  if (typeof isoDate !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day > monthLengths[month - 1]) return null;
  let dayOfYear = day;
  for (let m = 0; m < month - 1; m++) {
    dayOfYear += monthLengths[m];
  }
  return dayOfYear;
}

/**
 * Parses a 24-hour local clock time string 'HH:MM' into decimal hours [0, 24).
 */
export function parseLocalTime24hToDecimalHours(timeStr: string): number | null {
  if (typeof timeStr !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return hh + mm / 60;
}

/**
 * Analytical Solar Position Calculator per P38 Section 9 Mode B & Section 20 Group C.
 * Computes solar declination δ, equation of time EoT, apparent solar time AST,
 * solar hour angle ω, solar altitude α_s, and solar azimuth γ_s (clockwise from True North).
 *
 * CRITICAL GUARDRAIL: Never infers latitude or longitude from a project title or city string.
 */
export function calculateAnalyticalSolarPosition(params: {
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  timeZoneUtcOffsetHours: number | null;
  isDaylightSavingTime: boolean;
  analysisDateIso: string;
  analysisLocalTime24h: string;
}): {
  isValid: boolean;
  errorReason?: string;
  dayOfYearN: number | null;
  solarDeclinationDeg: number | null;
  equationOfTimeMinutes: number | null;
  solarTimeDecimalHours: number | null;
  solarHourAngleDeg: number | null;
  solarAltitudeDeg: number | null;
  solarAzimuthDegFromNorth: number | null;
  isSunAboveHorizon: boolean;
} {
  const {
    latitudeDeg,
    longitudeDeg,
    timeZoneUtcOffsetHours,
    isDaylightSavingTime,
    analysisDateIso,
    analysisLocalTime24h,
  } = params;

  if (
    latitudeDeg === null ||
    latitudeDeg === undefined ||
    typeof latitudeDeg !== 'number' ||
    !Number.isFinite(latitudeDeg) ||
    latitudeDeg < -90 ||
    latitudeDeg > 90
  ) {
    return {
      isValid: false,
      errorReason: 'Valid site or scenario latitude in [-90°, +90°] is required.',
      dayOfYearN: null,
      solarDeclinationDeg: null,
      equationOfTimeMinutes: null,
      solarTimeDecimalHours: null,
      solarHourAngleDeg: null,
      solarAltitudeDeg: null,
      solarAzimuthDegFromNorth: null,
      isSunAboveHorizon: false,
    };
  }

  if (
    longitudeDeg === null ||
    longitudeDeg === undefined ||
    typeof longitudeDeg !== 'number' ||
    !Number.isFinite(longitudeDeg) ||
    longitudeDeg < -180 ||
    longitudeDeg > 180
  ) {
    return {
      isValid: false,
      errorReason: 'Valid site or scenario longitude in [-180°, +180°] is required.',
      dayOfYearN: null,
      solarDeclinationDeg: null,
      equationOfTimeMinutes: null,
      solarTimeDecimalHours: null,
      solarHourAngleDeg: null,
      solarAltitudeDeg: null,
      solarAzimuthDegFromNorth: null,
      isSunAboveHorizon: false,
    };
  }

  const dayOfYearN = computeDayOfYearFromIsoDate(analysisDateIso);
  if (dayOfYearN === null) {
    return {
      isValid: false,
      errorReason: `Invalid ISO date "${analysisDateIso}"; expected YYYY-MM-DD.`,
      dayOfYearN: null,
      solarDeclinationDeg: null,
      equationOfTimeMinutes: null,
      solarTimeDecimalHours: null,
      solarHourAngleDeg: null,
      solarAltitudeDeg: null,
      solarAzimuthDegFromNorth: null,
      isSunAboveHorizon: false,
    };
  }

  const clockDecimalHours = parseLocalTime24hToDecimalHours(analysisLocalTime24h);
  if (clockDecimalHours === null) {
    return {
      isValid: false,
      errorReason: `Invalid 24-hour time "${analysisLocalTime24h}"; expected HH:MM.`,
      dayOfYearN,
      solarDeclinationDeg: null,
      equationOfTimeMinutes: null,
      solarTimeDecimalHours: null,
      solarHourAngleDeg: null,
      solarAltitudeDeg: null,
      solarAzimuthDegFromNorth: null,
      isSunAboveHorizon: false,
    };
  }

  // Cooper (1969) solar declination equation: δ = 23.45 * sin(360/365 * (284 + N))
  const declDeg = 23.45 * Math.sin(((360 / 365) * (284 + dayOfYearN)) * DEG_TO_RAD);

  // Fractional year B for Equation of Time (Spencer / Duffie & Beckman)
  const B = ((360 / 365) * (dayOfYearN - 81)) * DEG_TO_RAD;
  const eotMinutes =
    9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);

  const tzHours =
    timeZoneUtcOffsetHours !== null &&
    timeZoneUtcOffsetHours !== undefined &&
    Number.isFinite(timeZoneUtcOffsetHours)
      ? timeZoneUtcOffsetHours
      : Math.round(longitudeDeg / 15);

  const standardMeridianDeg = tzHours * 15;
  const dstAdjustmentHours = isDaylightSavingTime ? -1.0 : 0.0;
  const longitudeTimeCorrectionMinutes = 4 * (longitudeDeg - standardMeridianDeg);

  // Apparent Solar Time (AST) in decimal hours
  const solarTimeDecimalHours =
    clockDecimalHours +
    dstAdjustmentHours +
    (longitudeTimeCorrectionMinutes + eotMinutes) / 60;

  // Solar hour angle ω (degrees): 0° at solar noon, negative in morning, positive in afternoon
  const hourAngleDeg = 15 * (solarTimeDecimalHours - 12);

  const latRad = latitudeDeg * DEG_TO_RAD;
  const declRad = declDeg * DEG_TO_RAD;
  const omegaRad = hourAngleDeg * DEG_TO_RAD;

  // Solar altitude angle α_s: sin(α_s) = sin(φ)sin(δ) + cos(φ)cos(δ)cos(ω)
  const sinAlt = Math.max(
    -1,
    Math.min(
      1,
      Math.sin(latRad) * Math.sin(declRad) +
        Math.cos(latRad) * Math.cos(declRad) * Math.cos(omegaRad)
    )
  );
  const altRad = Math.asin(sinAlt);
  const solarAltitudeDeg = round2(altRad * RAD_TO_DEG);

  // Solar azimuth angle γ_s clockwise from True North [0°, 360°)
  const cosAlt = Math.cos(altRad);
  let solarAzimuthDegFromNorth = 180.0;
  if (cosAlt > 1e-6) {
    const cosAzNorth = Math.max(
      -1,
      Math.min(
        1,
        (Math.sin(declRad) - Math.sin(altRad) * Math.sin(latRad)) /
          (cosAlt * Math.cos(latRad) + 1e-9)
      )
    );
    const azFromNorthDeg = Math.acos(cosAzNorth) * RAD_TO_DEG;
    solarAzimuthDegFromNorth = round2(
      hourAngleDeg <= 0 ? azFromNorthDeg : (360 - azFromNorthDeg) % 360
    );
  }

  return {
    isValid: true,
    dayOfYearN,
    solarDeclinationDeg: round2(declDeg),
    equationOfTimeMinutes: round2(eotMinutes),
    solarTimeDecimalHours: round2(solarTimeDecimalHours),
    solarHourAngleDeg: round2(hourAngleDeg),
    solarAltitudeDeg,
    solarAzimuthDegFromNorth,
    isSunAboveHorizon: solarAltitudeDeg > 0,
  };
}

/**
 * Evaluates Mode B — Solar Position and Direct-Sun / Overhang Shadow Screening per P38 Section 9 Mode B.
 */
export function evaluateModeBSolarAndShading(
  roomGeometry: RoomDaylightGeometryValidationSI,
  evaluatedWindows: EvaluatedDaylightWindowSI[],
  env: DaylightEnvironmentalConditions
): ModeBSolarShadingResult {
  const unavailabilityReasons: string[] = [];

  const solarPos = calculateAnalyticalSolarPosition({
    latitudeDeg: env.latitudeDeg,
    longitudeDeg: env.longitudeDeg,
    timeZoneUtcOffsetHours: env.timeZoneUtcOffsetHours,
    isDaylightSavingTime: env.isDaylightSavingTime,
    analysisDateIso: env.analysisDateIso,
    analysisLocalTime24h: env.analysisLocalTime24h,
  });

  if (!solarPos.isValid || solarPos.solarAltitudeDeg === null || solarPos.solarAzimuthDegFromNorth === null) {
    unavailabilityReasons.push(
      solarPos.errorReason ||
        'Location coordinates (latitude/longitude) or analysis date/time are missing or invalid.'
    );
    return {
      mode: 'mode-b-solar-position-and-shading',
      completenessState: 'awaiting-required-environmental-data',
      isSolarPositionCalculated: false,
      locationAndTimeProvenance: env.locationProvenance,
      latitudeDeg: env.latitudeDeg,
      longitudeDeg: env.longitudeDeg,
      analysisDateIso: env.analysisDateIso,
      analysisLocalTime24h: env.analysisLocalTime24h,
      dayOfYearN: solarPos.dayOfYearN,
      solarDeclinationDeg: null,
      equationOfTimeMinutes: null,
      solarTimeDecimalHours: null,
      solarHourAngleDeg: null,
      solarAltitudeDeg: null,
      solarAzimuthDegFromNorth: null,
      isSunAboveHorizon: false,
      windowSolarExposures: [],
      workPlanePointsInDirectSunCount: 0,
      workPlaneDirectSunCoveragePercent: null,
      maxDirectSunPenetrationDepthMetres: null,
      unavailabilityOrLimitationReasons: unavailabilityReasons,
      explanation: `Solar position calculation unavailable: ${unavailabilityReasons.join(' ')}`,
    };
  }

  const altDeg = solarPos.solarAltitudeDeg;
  const azDeg = solarPos.solarAzimuthDegFromNorth;
  const altRad = altDeg * DEG_TO_RAD;
  const workPlaneZ = roomGeometry.workPlaneHeightMetres ?? 0.8;

  const windowSolarExposures: ModeBSolarShadingResult['windowSolarExposures'] = [];
  let maxPenetrationDepthM = 0;

  for (const win of evaluatedWindows) {
    const surfaceSolarAzimuthDiffDeg = round2(
      computeAngularDifferenceDeg(azDeg, win.compassAzimuthDeg)
    );
    const isBlockedByExternalObstruction =
      altDeg > 0 && altDeg <= win.externalObstructionAngleDeg;
    const isFacadeSunlit =
      altDeg > 0 && surfaceSolarAzimuthDiffDeg < 89.5 && !isBlockedByExternalObstruction;

    let verticalProfileAngleDeg: number | null = null;
    let overhangVerticalShadowMetres = 0;
    let sideFinHorizontalShadowMetres = 0;
    let exteriorShadedGlazedFraction = 0;
    let directSunlitGlazedFraction = 0;
    let directSunPenetrationDepthMetres = 0;
    let shadingExplanation = '';

    if (!isFacadeSunlit) {
      shadingExplanation =
        altDeg <= 0
          ? 'Sun is at or below the horizon; no direct solar beam.'
          : isBlockedByExternalObstruction
          ? `Direct solar beam (altitude ${altDeg}°) is blocked by external obstruction (${win.externalObstructionAngleDeg}° obstruction angle).`
          : `${win.wallEdge.toUpperCase()} facade (${win.compassAzimuthDeg}° azimuth) is in self-shade away from the solar beam (solar azimuth ${azDeg}°, Δγ = ${surfaceSolarAzimuthDiffDeg}° >= 90°).`;
    } else {
      const gammaRad = surfaceSolarAzimuthDiffDeg * DEG_TO_RAD;
      const cosGamma = Math.max(1e-4, Math.cos(gammaRad));
      const tanProfile = Math.tan(altRad) / cosGamma;
      verticalProfileAngleDeg = round2(Math.atan(tanProfile) * RAD_TO_DEG);

      const winH = win.grossHeightMetres;
      const winW = win.grossWidthMetres;

      if (win.overhangProjectionMetres !== null && win.overhangProjectionMetres > 0) {
        const rawDrop =
          win.overhangProjectionMetres * tanProfile - win.overhangGapAboveHeadMetres;
        overhangVerticalShadowMetres = round3(Math.max(0, rawDrop));
      }

      if (win.sideFinProjectionMetres !== null && win.sideFinProjectionMetres > 0) {
        sideFinHorizontalShadowMetres = round3(
          Math.max(0, win.sideFinProjectionMetres * Math.tan(gammaRad))
        );
      }

      if (winH !== null && winW !== null && winH > 0 && winW > 0) {
        const unshadedHeight = Math.max(0, winH - overhangVerticalShadowMetres);
        const unshadedWidth = Math.max(0, winW - sideFinHorizontalShadowMetres);
        let unshadedFrac = (unshadedHeight * unshadedWidth) / (winH * winW);

        if (
          win.exteriorShadingType === 'external-louvers-brise-soleil' &&
          win.exteriorLouverCutoffAngleDeg !== null &&
          verticalProfileAngleDeg >= win.exteriorLouverCutoffAngleDeg
        ) {
          unshadedFrac = 0;
        }

        exteriorShadedGlazedFraction = round3(Math.min(1, Math.max(0, 1 - unshadedFrac)));

        const blindClosedBlock =
          win.interiorShadingType === 'blackout-opaque-roller-shade' &&
          win.blindDeploymentState === 'fully-deployed-closed'
            ? 0
            : win.interiorShadingType !== 'none' &&
              win.blindDeploymentState !== 'retracted-open' &&
              win.interiorBlindMultiplier !== null
            ? win.interiorBlindMultiplier
            : 1.0;

        directSunlitGlazedFraction = round3(unshadedFrac * blindClosedBlock);

        // Compute floor/work-plane direct sun penetration depth from window wall
        const effectiveSunTopZ =
          (win.headHeightMetres ?? (win.sillHeightMetres ?? 0.9) + winH) -
          overhangVerticalShadowMetres;
        const sillZ = win.sillHeightMetres ?? 0.9;

        if (
          directSunlitGlazedFraction > 0.01 &&
          effectiveSunTopZ > Math.max(sillZ, workPlaneZ) &&
          Math.tan(altRad) > 1e-3
        ) {
          directSunPenetrationDepthMetres = round2(
            Math.max(0, ((effectiveSunTopZ - workPlaneZ) / Math.tan(altRad)) * cosGamma)
          );
          if (directSunPenetrationDepthMetres > maxPenetrationDepthM) {
            maxPenetrationDepthM = directSunPenetrationDepthMetres;
          }
        }

        shadingExplanation = `Sunlit facade (profile angle Ω_v = ${verticalProfileAngleDeg}°): ${round2(
          exteriorShadedGlazedFraction * 100
        )}% shaded by exterior devices, ${round2(
          directSunlitGlazedFraction * 100
        )}% direct beam transmitted, penetrating ${directSunPenetrationDepthMetres} m onto work plane.`;
      } else {
        unavailabilityReasons.push(
          `Window "${win.label}" is missing width or height; exact shadow fraction and sun penetration depth are withheld.`
        );
        shadingExplanation = `Sunlit facade (profile angle Ω_v = ${verticalProfileAngleDeg}°), but window height/width are incomplete for shadow fraction calculation.`;
      }
    }

    windowSolarExposures.push({
      windowId: win.windowId,
      label: win.label,
      wallEdge: win.wallEdge,
      wallAzimuthDeg: win.compassAzimuthDeg,
      surfaceSolarAzimuthDiffDeg,
      isFacadeSunlit,
      verticalProfileAngleDeg,
      isBlockedByExternalObstruction,
      overhangVerticalShadowMetres,
      sideFinHorizontalShadowMetres,
      exteriorShadedGlazedFraction,
      directSunlitGlazedFraction,
      directSunPenetrationDepthMetres,
      shadingExplanation,
    });
  }

  // Mark work-plane grid points that receive direct sun in this scenario
  let workPlanePointsInDirectSunCount = 0;
  for (const pt of roomGeometry.analysisPoints) {
    let hitBySun = false;
    for (const exp of windowSolarExposures) {
      if (!exp.isFacadeSunlit || exp.directSunPenetrationDepthMetres <= 0) continue;
      const distFromEdge =
        exp.wallEdge === 'north'
          ? pt.localYMetres
          : exp.wallEdge === 'south'
          ? (roomGeometry.lengthMetres ?? 0) - pt.localYMetres
          : exp.wallEdge === 'west'
          ? pt.localXMetres
          : (roomGeometry.widthMetres ?? 0) - pt.localXMetres;
      if (distFromEdge <= exp.directSunPenetrationDepthMetres) {
        hitBySun = true;
        break;
      }
    }
    pt.receivesDirectSunInScenario = hitBySun;
    if (hitBySun) workPlanePointsInDirectSunCount++;
  }

  const workPlaneDirectSunCoveragePercent =
    roomGeometry.analysisPoints.length > 0
      ? round2(
          (workPlanePointsInDirectSunCount / roomGeometry.analysisPoints.length) * 100
        )
      : null;

  return {
    mode: 'mode-b-solar-position-and-shading',
    completenessState:
      unavailabilityReasons.length === 0
        ? 'sufficient-for-solar-position-screening'
        : 'insufficient-evidence',
    isSolarPositionCalculated: true,
    locationAndTimeProvenance: env.locationProvenance,
    latitudeDeg: env.latitudeDeg,
    longitudeDeg: env.longitudeDeg,
    analysisDateIso: env.analysisDateIso,
    analysisLocalTime24h: env.analysisLocalTime24h,
    dayOfYearN: solarPos.dayOfYearN,
    solarDeclinationDeg: solarPos.solarDeclinationDeg,
    equationOfTimeMinutes: solarPos.equationOfTimeMinutes,
    solarTimeDecimalHours: solarPos.solarTimeDecimalHours,
    solarHourAngleDeg: solarPos.solarHourAngleDeg,
    solarAltitudeDeg: altDeg,
    solarAzimuthDegFromNorth: azDeg,
    isSunAboveHorizon: solarPos.isSunAboveHorizon,
    windowSolarExposures,
    workPlanePointsInDirectSunCount,
    workPlaneDirectSunCoveragePercent,
    maxDirectSunPenetrationDepthMetres:
      evaluatedWindows.length > 0 ? round2(maxPenetrationDepthM) : null,
    unavailabilityOrLimitationReasons: unavailabilityReasons,
    explanation: `At ${env.analysisDateIso} ${env.analysisLocalTime24h} (lat ${env.latitudeDeg}°, lon ${env.longitudeDeg}°, provenance: ${env.locationProvenance}), solar altitude α_s = ${altDeg}° and azimuth γ_s = ${azDeg}°. ${
      workPlaneDirectSunCoveragePercent !== null
        ? `${workPlanePointsInDirectSunCount}/${roomGeometry.analysisPoints.length} work-plane grid points (${workPlaneDirectSunCoveragePercent}%) receive direct solar beam (max depth ${round2(maxPenetrationDepthM)} m).`
        : ''
    }`,
  };
}

/**
 * Evaluates Mode C — Simplified Daylight Calculation per P38 Section 9 Mode C & Section 10.
 *
 * Implements the classical BRE / CIBSE Split-Flux Mean Daylight Factor method under CIE Standard Overcast Sky:
 *   DF_mean = [ sum_i ( T_i,eff * A_g,i * θ_i * M_i ) ] / [ A_total * (1 - R^2) ] * 100%
 *
 * Where:
 *   - T_i,eff: Effective visible light transmittance of window i (dimensionless in (0, 1])
 *   - A_g,i: Net transparent glazed area of window i (m²)
 *   - θ_i: Unobstructed vertical angle of visible sky from window i centre (degrees, in [0°, 90°])
 *   - M_i: Maintenance / dirt correction factor (dimensionless in (0, 1])
 *   - A_total: Total internal room surface area (floor + ceiling + gross walls, m²)
 *   - R: Area-weighted average diffuse reflectance of internal room surfaces in [0, 1)
 */
export function evaluateModeCSimplifiedDaylight(
  roomGeometry: RoomDaylightGeometryValidationSI,
  roomConfig: RoomDaylightConfig,
  evaluatedWindows: EvaluatedDaylightWindowSI[],
  scenario: DaylightScenario,
  criteria: ConfiguredDaylightCriterion[],
  measuredRecord: DaylightComfortProjectEvaluationReport['activeRoomEvaluation'] extends null
    ? never
    : ProjectDaylightComfortData['measuredIlluminanceRecords'][string] | undefined
): ModeCSimplifiedDaylightResult {
  const missingInputs: string[] = [];
  const env = scenario.environmentalConditions;
  const meanDfCriterion =
    criteria.find((c) => c.metric === 'mean-daylight-factor-percent') ||
    DEFAULT_DAYLIGHT_CRITERIA[1];

  const reflOverride = scenario.surfaceReflectanceOverrides?.[roomGeometry.roomId];
  const rhoC =
    reflOverride?.ceilingReflectance !== undefined
      ? reflOverride.ceilingReflectance
      : roomConfig.ceilingReflectance;
  const rhoW =
    reflOverride?.wallReflectance !== undefined
      ? reflOverride.wallReflectance
      : roomConfig.wallReflectance;
  const rhoF =
    reflOverride?.floorReflectance !== undefined
      ? reflOverride.floorReflectance
      : roomConfig.floorReflectance;

  if (!roomGeometry.is2DGeometryValid || roomGeometry.floorAreaM2 === null) {
    missingInputs.push('Valid 2D rectangular room dimensions (width and length > 0).');
  }
  if (
    roomGeometry.ceilingHeightMetres === null ||
    roomGeometry.totalInternalSurfaceAreaM2 === null
  ) {
    missingInputs.push(
      'Room ceiling height (required to compute total internal room surface area A_total).'
    );
  }
  if (
    rhoC === null ||
    rhoC === undefined ||
    !Number.isFinite(rhoC) ||
    rhoC < 0 ||
    rhoC >= 1 ||
    rhoW === null ||
    rhoW === undefined ||
    !Number.isFinite(rhoW) ||
    rhoW < 0 ||
    rhoW >= 1 ||
    rhoF === null ||
    rhoF === undefined ||
    !Number.isFinite(rhoF) ||
    rhoF < 0 ||
    rhoF >= 1
  ) {
    missingInputs.push(
      'Valid interior surface visible reflectances (ceiling, wall, and floor reflectance in [0, 1)).'
    );
  }

  if (env.skyModelCondition !== 'cie-standard-overcast-sky') {
    missingInputs.push(
      `CIE Standard Overcast Sky boundary condition (currently set to "${env.skyModelCondition}"). Daylight Factor is defined strictly under an overcast sky.`
    );
  }

  if (evaluatedWindows.length === 0) {
    missingInputs.push('At least one exterior window record on the room.');
  }

  for (const w of evaluatedWindows) {
    if (w.netGlazedAreaM2 === null) {
      missingInputs.push(
        `Window "${w.label}": net glazed area (requires gross width, gross height, and framing fraction).`
      );
    }
    if (w.effectiveTransmittanceT === null) {
      missingInputs.push(
        `Window "${w.label}": visible light transmittance (VT/Tvis) in (0, 1]${
          w.blindDeploymentState !== 'retracted-open'
            ? ' and deployed blind transmittance multiplier'
            : ''
        }.`
      );
    }
  }

  const reflProv =
    reflOverride?.provenance ||
    (roomConfig.ceilingReflectanceProvenance === roomConfig.wallReflectanceProvenance
      ? roomConfig.ceilingReflectanceProvenance
      : 'illustrative-scenario-assumption');

  if (missingInputs.length > 0) {
    // Clear point proxies on grid points
    for (const pt of roomGeometry.analysisPoints) {
      pt.pointDaylightFactorProxyPercent = null;
    }
    return {
      mode: 'mode-c-simplified-daylight-calculation',
      completenessState: !roomGeometry.is2DGeometryValid
        ? 'invalid-input'
        : 'insufficient-evidence',
      isCalculationSupported: false,
      modelName: 'BRE / CIBSE Split-Flux Mean Daylight Factor (Lynes / CIE Overcast Sky)',
      formulaDocumented:
        'DF_mean = [ sum_i ( T_i,eff * A_g,i * θ_i * M_i ) ] / [ A_total * (1 - R^2) ] * 100%',
      skyBoundaryCondition: env.skyModelCondition,
      totalInternalSurfaceAreaM2: roomGeometry.totalInternalSurfaceAreaM2,
      areaWeightedAverageReflectanceR: null,
      reflectanceProvenanceSummary: `Surface reflectance provenance: ${reflProv}`,
      meanDaylightFactorPercent: null,
      minPointDaylightFactorProxyPercent: null,
      uniformityRatioProxy: null,
      estimatedOvercastMeanIlluminanceLux: null,
      measuredIlluminanceRecord: measuredRecord || null,
      meanDfCriterion,
      meetsMeanDfTarget: null,
      windowContributions: [],
      missingRequiredInputs: missingInputs,
      modelAssumptions: [
        'CIE Standard Overcast Sky luminance distribution (independent of solar azimuth).',
        'Diffuse inter-reflection inside a rectangular room enclosure represented by 1 / (1 - R²).',
      ],
      modelLimitations: [
        'Calculation withheld because one or more required geometric, optical, or sky inputs are missing.',
      ],
      en17037NonEquivalenceDisclosure:
        'Simplified BRE Split-Flux Mean Daylight Factor does NOT establish compliance with BS EN 17037:2018+A1:2021.',
      explanation: `Simplified Daylight Factor calculation withheld due to missing required inputs: ${missingInputs.join(
        ' '
      )}`,
    };
  }

  const aTotal = roomGeometry.totalInternalSurfaceAreaM2!;
  const aFloor = roomGeometry.floorAreaM2!;
  const aCeiling = aFloor;
  const aGrossWindowTotal = evaluatedWindows.reduce(
    (sum, w) => sum + (w.grossOpeningAreaM2 || 0),
    0
  );
  const aNetWall = Math.max(0, aTotal - aFloor - aCeiling - aGrossWindowTotal);

  const rWeighted =
    (aFloor * rhoF! +
      aCeiling * rhoC! +
      aNetWall * rhoW! +
      aGrossWindowTotal * INTERNAL_GLASS_DIFFUSE_REFLECTANCE) /
    aTotal;
  const rClamped = Math.min(0.92, Math.max(0.01, rWeighted));
  const denom = aTotal * (1 - rClamped * rClamped);

  const windowContributions: ModeCSimplifiedDaylightResult['windowContributions'] = [];
  let totalDfPercent = 0;

  for (const w of evaluatedWindows) {
    const ag = w.netGlazedAreaM2!;
    const tEff = w.effectiveTransmittanceT!;
    const theta = w.visibleVerticalSkyAngleDeg;
    const m = w.maintenanceFactorM;

    // BRE Split-Flux formula: DF_i (%) = (T_eff * A_g * θ * M) / (A_total * (1 - R^2))
    // Note: In the classical Lynes / BRE Split-Flux formula with θ in degrees,
    // the factor (T * A_g * θ * M) / (A_total * (1 - R^2)) directly yields DF in percent (%).
    const dfContribPct = denom > 0 ? (tEff * ag * theta * m) / denom : 0;
    totalDfPercent += dfContribPct;

    windowContributions.push({
      windowId: w.windowId,
      label: w.label,
      netGlazedAreaM2: round3(ag),
      effectiveTransmittanceT: round3(tEff),
      visibleSkyAngleDeg: round2(theta),
      maintenanceFactorM: round2(m),
      dfContributionPercent: round2(dfContribPct),
    });
  }

  const meanDaylightFactorPercent = round2(totalDfPercent);

  // Compute work-plane grid point distribution proxy (explicitly labelled as point proxy)
  let minPointDfProxy: number | null = null;
  if (roomGeometry.analysisPoints.length > 0 && meanDaylightFactorPercent > 0) {
    const rawWeights: number[] = [];
    for (const pt of roomGeometry.analysisPoints) {
      const d = Math.max(0.5, pt.distanceToNearestWindowWallMetres ?? 1.5);
      // Split-flux internal reflected component + sky component distance decay proxy
      const ircShare = rClamped * 0.45;
      const directShare = (1 - ircShare) / Math.pow(1 + 0.35 * d, 1.35);
      rawWeights.push(ircShare + directShare);
    }
    const avgWeight =
      rawWeights.reduce((acc, v) => acc + v, 0) / rawWeights.length;

    for (let i = 0; i < roomGeometry.analysisPoints.length; i++) {
      const normalizedProxy =
        avgWeight > 0
          ? round2(meanDaylightFactorPercent * (rawWeights[i] / avgWeight))
          : meanDaylightFactorPercent;
      roomGeometry.analysisPoints[i].pointDaylightFactorProxyPercent = normalizedProxy;
      if (minPointDfProxy === null || normalizedProxy < minPointDfProxy) {
        minPointDfProxy = normalizedProxy;
      }
    }
  }

  const uniformityRatioProxy =
    minPointDfProxy !== null && meanDaylightFactorPercent > 0
      ? round2(minPointDfProxy / meanDaylightFactorPercent)
      : null;

  const estimatedOvercastMeanIlluminanceLux =
    env.overcastExteriorIlluminanceLux !== null &&
    env.overcastExteriorIlluminanceLux !== undefined &&
    Number.isFinite(env.overcastExteriorIlluminanceLux) &&
    env.overcastExteriorIlluminanceLux > 0
      ? round2((meanDaylightFactorPercent / 100) * env.overcastExteriorIlluminanceLux)
      : null;

  const meetsMeanDfTarget =
    meanDfCriterion.minTarget !== null
      ? meanDaylightFactorPercent >= meanDfCriterion.minTarget
      : null;

  return {
    mode: 'mode-c-simplified-daylight-calculation',
    completenessState: 'sufficient-for-simplified-calculation',
    isCalculationSupported: true,
    modelName: 'BRE / CIBSE Split-Flux Mean Daylight Factor (Lynes / CIE Overcast Sky)',
    formulaDocumented:
      'DF_mean (%) = [ sum_i ( T_i,eff * A_g,i * θ_i * M_i ) ] / [ A_total * (1 - R^2) ]',
    skyBoundaryCondition: `CIE Standard Overcast Sky (ISO 15469 Type 1)${
      env.overcastExteriorIlluminanceLux
        ? `, Reference E_ext = ${env.overcastExteriorIlluminanceLux.toLocaleString()} lux`
        : ''
    }`,
    totalInternalSurfaceAreaM2: round2(aTotal),
    areaWeightedAverageReflectanceR: round3(rClamped),
    reflectanceProvenanceSummary: `Ceiling ρ=${rhoC}, Wall ρ=${rhoW}, Floor ρ=${rhoF} (provenance: ${reflProv})`,
    meanDaylightFactorPercent,
    minPointDaylightFactorProxyPercent: minPointDfProxy,
    uniformityRatioProxy,
    estimatedOvercastMeanIlluminanceLux,
    measuredIlluminanceRecord: measuredRecord || null,
    meanDfCriterion,
    meetsMeanDfTarget,
    windowContributions,
    missingRequiredInputs: [],
    modelAssumptions: [
      'CIE Standard Overcast Sky (azimuth-independent diffuse sky dome).',
      'Room surfaces act as diffuse Lambertian reflectors with area-weighted mean reflectance R.',
      'Internal glass diffuse reflectance assumed at 0.10 in the area-weighted reflectance denominator.',
      'Work-plane grid point values represent a distance-weighted Split-Flux distribution proxy normalized to DF_mean, not a multi-bounce Radiance raytrace.',
    ],
    modelLimitations: [
      'Does not model direct sunlight patches, specular light shelves, or complex non-rectangular room geometries.',
      'Does not calculate climate-based annual metrics (sDA, ASE, UDI).',
    ],
    en17037NonEquivalenceDisclosure:
      'This simplified BRE Split-Flux Mean Daylight Factor calculation is an architectural engineering screening method and is NOT an EN 17037-compliant point-grid target daylight assessment.',
    explanation: `Calculated Mean Daylight Factor DF_mean = ${meanDaylightFactorPercent}% across ${evaluatedWindows.length} window(s) (A_total = ${round2(
      aTotal
    )} m², mean surface reflectance R = ${round3(rClamped)})${
      estimatedOvercastMeanIlluminanceLux !== null
        ? `, corresponding to ~${estimatedOvercastMeanIlluminanceLux} lux under a ${env.overcastExteriorIlluminanceLux?.toLocaleString()} lux overcast sky.`
        : '.'
    }`,
  };
}

/**
 * Evaluates Mode D — Climate-Based Annual Daylight Modelling Status per P38 Section 9 Mode D.
 * Explicitly returns unsupported status and `null` values for sDA, ASE, DA, and UDI so fake numbers are never fabricated!
 */
export function evaluateModeDAnnualSimulationStatus(
  env: DaylightEnvironmentalConditions
): ModeDAnnualSimulationStatusResult {
  return {
    mode: 'mode-d-climate-based-annual-simulation',
    completenessState: env.hasValidatedHourlyWeatherFile
      ? 'unsupported-model-or-geometry'
      : 'awaiting-required-environmental-data',
    isAnnualEngineImplemented: false,
    sDA_300_50_Percent: null,
    ASE_1000_250_Percent: null,
    daylightAutonomyPercent: null,
    usefulDaylightIlluminancePercent: null,
    whyUnavailableExplanation:
      'Climate-based annual daylight metrics — Spatial Daylight Autonomy (sDA 300/50%), Annual Sunlight Exposure (ASE 1000,250h), Daylight Autonomy (DA), and Useful Daylight Illuminance (UDI) — are explicitly withheld as unsupported. Plotify P38 does not bundle a validated annual Perez all-weather sky + multi-bounce radiative transfer engine (e.g. Radiance / 2-phase or 5-phase matrix method) and never fabricates annual percentages from static geometry or a single solar angle.',
    requiredForValidatedAnnualSimulation: [
      'Validated hourly meteorological weather dataset (TMY3 / EPW with global, diffuse horizontal, and direct normal irradiance/illuminance).',
      'Validated annual sky discretization and radiative transfer solver (e.g. Radiance / Perez All-Weather Sky model per ANSI/IES LM-83-23).',
      'Dynamic blind deployment and occupancy schedules (e.g. 08:00–18:00 occupied hours).',
    ],
  };
}

/**
 * Evaluates Mode E — Visual Comfort, Glare and View Out Screening per P38 Section 9 Mode E & Section 11.
 *
 * CRITICAL GUARDRAILS:
 * 1. Never fabricates Daylight Glare Probability (DGP) or eye-level luminance maps.
 * 2. Never automatically classifies every East- or West-facing window as uncomfortable without checking
 *    actual solar position, shading, and geometry.
 */
export function evaluateModeEVisualComfortGlareAndView(
  roomGeometry: RoomDaylightGeometryValidationSI,
  roomConfig: RoomDaylightConfig,
  evaluatedWindows: EvaluatedDaylightWindowSI[],
  externalObstructions: ExternalObstructionRecord[],
  modeA: ModeAGeometricDaylightResult,
  modeB: ModeBSolarShadingResult,
  modeC: ModeCSimplifiedDaylightResult,
  criteria: ConfiguredDaylightCriterion[]
): ModeEVisualComfortGlareViewResult {
  const findings: ModeEVisualComfortGlareViewResult['identifiedComfortAndGlareFindings'] = [];
  const viewCriterion =
    criteria.find((c) => c.metric === 'horizontal-view-out-angle-deg') ||
    DEFAULT_DAYLIGHT_CRITERIA[3];

  // 1. Evaluate horizontal view-out sight angle from room centre
  let horizontalViewAngleFromRoomCentreDeg: number | null = null;
  if (
    roomGeometry.is2DGeometryValid &&
    roomGeometry.widthMetres !== null &&
    roomGeometry.lengthMetres !== null
  ) {
    let totalAngleDeg = 0;
    for (const w of evaluatedWindows) {
      if (w.grossWidthMetres === null) continue;
      // Check if window spans seated-to-standing eye-level band (1.10m to 1.65m) when sill/head are known
      const spansEyeBand =
        w.sillHeightMetres === null ||
        w.headHeightMetres === null ||
        (w.sillHeightMetres <= 1.65 && w.headHeightMetres >= 1.10);
      if (!spansEyeBand) continue;

      const distFromCentre =
        w.wallEdge === 'north' || w.wallEdge === 'south'
          ? roomGeometry.lengthMetres / 2
          : roomGeometry.widthMetres / 2;

      if (distFromCentre > 0) {
        const subtendedDeg =
          2 * Math.atan2(w.grossWidthMetres / 2, distFromCentre) * RAD_TO_DEG;
        totalAngleDeg += subtendedDeg;
      }
    }
    horizontalViewAngleFromRoomCentreDeg = round2(Math.min(360, totalAngleDeg));
  }

  const obsDistances = (externalObstructions || [])
    .map((o) => convertLengthToMetres(o.horizontalDistance, o.dimensionUnit))
    .filter((d): d is number => d !== null && d > 0);
  const minExternalObstructionDistanceMetres =
    obsDistances.length > 0 ? round2(Math.min(...obsDistances)) : null;

  const p33ViewWarn = evaluatedWindows.find((w) => w.p33FurnitureObstructionWarning)
    ?.p33FurnitureObstructionWarning;

  const meetsHorizontalViewAngleTarget =
    horizontalViewAngleFromRoomCentreDeg !== null && viewCriterion.minTarget !== null
      ? horizontalViewAngleFromRoomCentreDeg >= viewCriterion.minTarget
      : null;

  if (
    minExternalObstructionDistanceMetres !== null &&
    minExternalObstructionDistanceMetres < 6.0
  ) {
    findings.push({
      findingId: 'glare-view-close-obstruction',
      category: 'view-out-obstruction',
      severity: 'moderate-review',
      title: 'Close External Obstruction Limits Distant View Out',
      explanation: `An external obstruction sits ${minExternalObstructionDistanceMetres} m from the facade (< 6.0 m advisory view distance), restricting distant horizon views and reducing sky component.`,
    });
  }

  if (p33ViewWarn) {
    findings.push({
      findingId: 'glare-view-p33-furniture-block',
      category: 'view-out-obstruction',
      severity: 'moderate-review',
      title: 'Tall Furniture Near Window Sill May Obstruct View Out',
      explanation: p33ViewWarn,
    });
  }

  // 2. Direct-sun and low-angle solar glare screening (using actual Mode B geometry, time, and shading)
  const sunlitExposures = modeB.windowSolarExposures.filter(
    (e) => e.isFacadeSunlit && e.directSunlitGlazedFraction > 0.05
  );

  let hasHighGlareConcern = false;
  let hasModerateGlareConcern = false;

  if (
    modeB.isSolarPositionCalculated &&
    modeB.solarAltitudeDeg !== null &&
    sunlitExposures.length > 0
  ) {
    const isLowAngleSun = modeB.solarAltitudeDeg > 0 && modeB.solarAltitudeDeg <= 25.0;
    const requiresScreenGlareControl = roomConfig.visualPriorities.includes(
      'vdt-screen-glare-control'
    );

    if (isLowAngleSun) {
      hasHighGlareConcern = true;
      findings.push({
        findingId: 'glare-low-angle-solar-beam',
        category: 'low-angle-solar-beam-risk',
        severity: 'high-concern',
        title: `Low-Angle Direct Sunlight (${modeB.solarAltitudeDeg}° Altitude) on Unshaded Glazing`,
        explanation: `At ${modeB.analysisDateIso} ${modeB.analysisLocalTime24h}, the solar altitude is low (${modeB.solarAltitudeDeg}° <= 25°) and enters through ${sunlitExposures
          .map((e) => `${e.label} (${round2(e.directSunlitGlazedFraction * 100)}% unshaded)`)
          .join(', ')}, creating a high risk of direct field-of-view disability/discomfort glare.`,
      });
    } else if (
      (modeB.workPlaneDirectSunCoveragePercent ?? 0) > 20 ||
      (requiresScreenGlareControl && (modeB.maxDirectSunPenetrationDepthMetres ?? 0) > 1.2)
    ) {
      hasHighGlareConcern = requiresScreenGlareControl;
      hasModerateGlareConcern = !requiresScreenGlareControl;
      findings.push({
        findingId: 'glare-direct-sun-workplane',
        category: 'direct-sun-on-workplane',
        severity: requiresScreenGlareControl ? 'high-concern' : 'moderate-review',
        title: 'Direct Solar Beam Penetrates Work Plane',
        explanation: `Direct sunlight covers ${modeB.workPlaneDirectSunCoveragePercent}% of the work-plane grid (penetration depth ${modeB.maxDirectSunPenetrationDepthMetres} m).${
          requiresScreenGlareControl
            ? ' Because VDT/screen glare control is a priority in this room, unshaded direct sun on work surfaces can cause veiling reflections.'
            : ''
        }`,
      });
    } else {
      hasModerateGlareConcern = true;
      findings.push({
        findingId: 'glare-moderate-direct-sun',
        category: 'direct-sun-on-workplane',
        severity: 'moderate-review',
        title: 'Controlled Direct Sunlight Near Window Zone',
        explanation: `Direct solar beam reaches ${modeB.maxDirectSunPenetrationDepthMetres} m from the window wall (${modeB.workPlaneDirectSunCoveragePercent}% of work plane).`,
      });
    }
  }

  // 3. Contrast & room depth uniformity screening
  if (
    modeA.exceedsLimitingDepthHeuristic === true &&
    evaluatedWindows.length > 0 &&
    modeA.primaryWindowOrientations.length === 1
  ) {
    hasModerateGlareConcern = true;
    findings.push({
      findingId: 'glare-deep-room-contrast',
      category: 'inadequate-daylight-penetration-depth',
      severity: 'moderate-review',
      title: 'Single-Sided Deep Room Contrast Ratio Concern',
      explanation: `Room depth to window head height ratio (${modeA.depthToWindowHeadRatio}) exceeds the ${modeA.limitingDepthHeuristicThreshold} single-sided heuristic. The back of the room may appear gloomy relative to bright window glazing, increasing visual adaptation contrast.`,
    });
  }

  // 4. Shading vs. Daylight trade-off screening
  const deployedBlinds = evaluatedWindows.filter(
    (w) => w.interiorShadingType !== 'none' && w.blindDeploymentState !== 'retracted-open'
  );
  if (
    deployedBlinds.length > 0 &&
    modeC.meanDaylightFactorPercent !== null &&
    modeC.meanDaylightFactorPercent < 2.0
  ) {
    hasModerateGlareConcern = true;
    findings.push({
      findingId: 'glare-shading-daylight-conflict',
      category: 'shading-reduces-daylight-tradeoff',
      severity: 'moderate-review',
      title: 'Shading Deployment Reduces Mean Daylight Factor Below 2.0%',
      explanation: `Active interior blinds on ${deployedBlinds
        .map((w) => w.label)
        .join(', ')} control direct sun but reduce Mean Daylight Factor to ${
        modeC.meanDaylightFactorPercent
      }% (< 2.0% advisory benchmark), illustrating the trade-off between glare control and diffuse daylight availability.`,
    });
  }

  let qualitativeGlareRiskLevel: ModeEVisualComfortGlareViewResult['qualitativeGlareRiskLevel'] =
    'low-screened-concern';
  if (
    evaluatedWindows.length === 0 ||
    (!modeB.isSolarPositionCalculated && modeA.completenessState === 'insufficient-evidence')
  ) {
    qualitativeGlareRiskLevel = 'insufficient-evidence';
  } else if (hasHighGlareConcern) {
    qualitativeGlareRiskLevel = 'high-direct-sun-or-low-angle-concern';
  } else if (hasModerateGlareConcern) {
    qualitativeGlareRiskLevel = 'moderate-conditional-concern';
  }

  return {
    mode: 'mode-e-visual-comfort-glare-and-view',
    completenessState:
      qualitativeGlareRiskLevel === 'insufficient-evidence'
        ? 'insufficient-evidence'
        : 'sufficient-for-solar-position-screening',
    isQuantitativeDgpSupported: false,
    daylightGlareProbabilityDGP: null,
    dgpLimitationDisclosure:
      'Daylight Glare Probability (DGP) is explicitly reported as null/unsupported because validated DGP calculation (Wienold & Christoffersen) requires eye-level vertical illuminance E_v, exact occupant gaze vector, and high-dynamic-range (HDR) luminance solid-angle integration from a raytraced scene.',
    qualitativeGlareRiskLevel,
    identifiedComfortAndGlareFindings: findings,
    viewOutAssessment: {
      isViewOutEvaluated: horizontalViewAngleFromRoomCentreDeg !== null,
      horizontalViewAngleFromRoomCentreDeg,
      minExternalObstructionDistanceMetres,
      viewOutCriterion: viewCriterion,
      meetsHorizontalViewAngleTarget,
      p33FurnitureViewBlockWarning: p33ViewWarn,
      viewOutSummary:
        horizontalViewAngleFromRoomCentreDeg !== null
          ? `Horizontal sight angle subtended by exterior windows from room centre is ${horizontalViewAngleFromRoomCentreDeg}° (advisory target >= ${viewCriterion.minTarget}°).`
          : 'Horizontal view-out angle could not be evaluated due to missing window width or room dimensions.',
    },
    explanation: `Qualitative visual comfort screening identified ${findings.length} finding(s) (overall qualitative risk: ${qualitativeGlareRiskLevel}). Quantitative DGP is withheld (${
      horizontalViewAngleFromRoomCentreDeg !== null
        ? `horizontal view angle = ${horizontalViewAngleFromRoomCentreDeg}°`
        : 'view angle unavailable'
    }).`,
  };
}

/**
 * Generates traceable P38 recommendations for a room evaluation per P38 Section 4, 12, 14 & 15.
 */
export function generateDaylightRecommendations(
  project: Project,
  room: FloorPlanRoom,
  roomGeometry: RoomDaylightGeometryValidationSI,
  roomConfig: RoomDaylightConfig,
  evaluatedWindows: EvaluatedDaylightWindowSI[],
  modeA: ModeAGeometricDaylightResult,
  modeB: ModeBSolarShadingResult,
  modeC: ModeCSimplifiedDaylightResult,
  modeE: ModeEVisualComfortGlareViewResult
): DaylightRecommendation[] {
  const recs: DaylightRecommendation[] = [];
  const unit = project.unit || 'feet';

  // 1. Missing ceiling height recommendation
  if (roomGeometry.ceilingHeightMetres === null) {
    const defaultH = unit === 'feet' ? 9.5 : 2.9;
    const defaultWP = unit === 'feet' ? 2.62 : 0.8;
    recs.push({
      recommendationId: `p38-rec-set-height-${room.id}`,
      roomId: room.id,
      roomName: room.name,
      category: 'supply-missing-geometry-or-optical-data',
      priority: 'high',
      title: `Specify Ceiling Height for ${room.name} (${defaultH} ${unit})`,
      issueOrOpportunityAddressed:
        'Room ceiling height is currently unspecified, preventing calculation of total internal surface area (A_total) and Mode C Mean Daylight Factor.',
      triggeringInputsAndConditions: `roomConfigs["${room.id}"].ceilingHeight === null`,
      physicalRationale:
        'Daylight inter-reflection inside a room depends on the total enclosing surface area (walls, floor, and ceiling) in the Split-Flux denominator A_total * (1 - R²).',
      supportingEvidenceLevel: 'Completes required geometric input (user-entered / scenario assumption).',
      expectedDaylightAndGlareEffect:
        'Unlocks Mode C BRE Split-Flux Mean Daylight Factor and Window-to-Wall Ratio (WWR) calculations.',
      remainingUnknownsAndLimitations: [
        'Verify actual structural slab-to-ceiling height on architectural section drawings.',
      ],
      multidisciplinaryTradeOffs: {
        solarHeatAndShadingTradeOff: 'Allows accurate window head-to-ceiling clearance validation.',
        naturalVentilationP37Impact:
          'Also enables room volume V and Air Changes Per Hour (ACH) in P37 when synchronized.',
        acousticsAndNoiseP36Impact:
          'Higher ceiling volume increases Sabine reverberation time RT60 in P36.',
        materialsAndReflectanceP35Impact: 'Determines net interior wall surface area.',
        accessibilityAndControlsP34Impact: 'No impact on floor-level wheelchair clearances.',
        furnitureAndCirculationP33Impact: 'No impact on 2D furniture footprints.',
      },
      canPreviewAndApplyInPlotify: true,
      proposedMutation: {
        roomId: room.id,
        setRoomCeilingHeight: {
          ceilingHeight: defaultH,
          workPlaneHeight: defaultWP,
          provenance: 'user-entered',
        },
      },
    });
  }

  // 2. Incomplete window dimensions or missing VT (e.g. imported from P33 width-only record)
  const incompleteWin = evaluatedWindows.find(
    (w) => w.grossHeightMetres === null || w.visibleTransmittanceVT === null || w.frameFraction === null
  );
  if (incompleteWin) {
    const defaultWinH = unit === 'feet' ? 4.8 : 1.5;
    const defaultSill = unit === 'feet' ? 2.8 : 0.85;
    recs.push({
      recommendationId: `p38-rec-complete-win-${incompleteWin.windowId}`,
      roomId: room.id,
      roomName: room.name,
      category: 'supply-missing-geometry-or-optical-data',
      priority: 'high',
      title: `Complete Window Height, Frame Fraction & Glazing VT for "${incompleteWin.label}"`,
      issueOrOpportunityAddressed: `Window "${incompleteWin.label}" has incomplete vertical dimensions or optical properties (${incompleteWin.missingOpticalOrDimensionDisclosures.join(
        ' '
      )}).`,
      triggeringInputsAndConditions: `grossHeight=${incompleteWin.grossHeightMetres ?? 'null'}, frameFraction=${incompleteWin.frameFraction ?? 'null'}, VT=${incompleteWin.visibleTransmittanceVT ?? 'null'}`,
      physicalRationale:
        'Net glazed area A_g = W * H * (1 - f_frame) and visible transmittance VT are mandatory physical parameters for daylight transmission.',
      supportingEvidenceLevel:
        'Supplies explicit user-entered / scenario glazing parameters (never silently assumed).',
      expectedDaylightAndGlareEffect:
        'Enables net glazed area, Window-to-Floor Ratio, Solar Shadow fraction, and Mean Daylight Factor calculations.',
      remainingUnknownsAndLimitations: [
        'Confirm actual manufacturer glazing NFRC 200 / EN 410 VT specification.',
      ],
      multidisciplinaryTradeOffs: {
        solarHeatAndShadingTradeOff: 'Larger glazed height increases both daylight and solar heat gain.',
        naturalVentilationP37Impact:
          'Updating physical window height may affect P37 openable area if linked; P37 will be marked for review.',
        acousticsAndNoiseP36Impact:
          'Larger glazed area requires verifying facade sound insulation (Rw/STC) in noisy sites (P36).',
        materialsAndReflectanceP35Impact: 'Glazing frame material must suit local climate exposure (P35).',
        accessibilityAndControlsP34Impact:
          'Sill height at 0.85 m (2.8 ft) keeps operable hardware within accessible reach range (P34).',
        furnitureAndCirculationP33Impact: 'Preserves 2D floor-plan layout.',
      },
      canPreviewAndApplyInPlotify: true,
      proposedMutation: {
        roomId: room.id,
        updateWindow: {
          windowId: incompleteWin.windowId,
          grossHeight: defaultWinH,
          sillHeight: defaultSill,
          frameFraction: incompleteWin.frameFraction ?? 0.15,
          visibleTransmittanceVT: incompleteWin.visibleTransmittanceVT ?? 0.70,
          vtProvenance: 'illustrative-scenario-assumption',
        },
      },
    });
  }

  // 3. If room has no windows or low daylight factor (< 2.0%), propose adding or enlarging a window
  if (
    evaluatedWindows.length === 0 ||
    (modeC.meanDaylightFactorPercent !== null && modeC.meanDaylightFactorPercent < 2.0)
  ) {
    const targetEdge: WallCardinalEdge =
      roomGeometry.exteriorWallEdges[0] || 'south';
    if (evaluatedWindows.length === 0) {
      const winW = unit === 'feet' ? 5.0 : 1.5;
      const winH = unit === 'feet' ? 4.8 : 1.5;
      const sill = unit === 'feet' ? 2.8 : 0.85;
      recs.push({
        recommendationId: `p38-rec-add-window-${room.id}`,
        roomId: room.id,
        roomName: room.name,
        category: 'add-or-enlarge-window-glazing',
        priority: 'high',
        title: `Add Exterior Daylight Window on ${targetEdge.toUpperCase()} Facade (${winW}×${winH} ${unit})`,
        issueOrOpportunityAddressed: `${room.name} currently has no recorded exterior windows (0% glazed-to-floor ratio).`,
        triggeringInputsAndConditions: `windowCount === 0 on ${room.name}`,
        physicalRationale:
          'Providing an exterior glazed opening introduces sky component and internal reflected daylight into the room.',
        supportingEvidenceLevel: 'Evaluated via Mode A GFR and Mode C BRE Split-Flux DF.',
        expectedDaylightAndGlareEffect:
          'Increases net glazed-to-floor ratio and provides exterior view-out connection.',
        remainingUnknownsAndLimitations: [
          'Requires structural lintel coordination and facade elevation review.',
        ],
        multidisciplinaryTradeOffs: {
          solarHeatAndShadingTradeOff:
            'Pair with exterior overhang if located on South, East, or West orientation.',
          naturalVentilationP37Impact:
            'Can also serve as an operable ventilation inlet/outlet in P37 if configured as operable.',
          acousticsAndNoiseP36Impact:
            'Exterior glazing has lower airborne sound insulation than solid masonry/stud walls (P36).',
          materialsAndReflectanceP35Impact: 'Select corrosion- and UV-resistant window frames (P35).',
          accessibilityAndControlsP34Impact:
            'Mount window operator between 0.38 m and 1.22 m above floor (P34).',
          furnitureAndCirculationP33Impact: 'Keep tall storage clear of the new window wall (P33).',
        },
        canPreviewAndApplyInPlotify: true,
        proposedMutation: {
          roomId: room.id,
          addWindow: {
            windowId: `p38-win-added-${room.id}`,
            roomId: room.id,
            label: `${room.name} ${targetEdge.toUpperCase()} Daylight Window`,
            wallEdge: targetEdge,
            floorLevel: room.floorLevel || 1,
            offsetAlongWall: unit === 'feet' ? 3.0 : 1.0,
            grossWidth: winW,
            grossHeight: winH,
            sillHeight: sill,
            headHeight: round2(sill + winH),
            dimensionUnit: unit,
            dimensionProvenance: 'user-entered',
            frameFraction: 0.15,
            frameFractionProvenance: 'illustrative-scenario-assumption',
            explicitGlazedAreaInUnitSq: null,
            visibleTransmittanceVT: 0.72,
            vtProvenance: 'illustrative-scenario-assumption',
            vtSourceProductAndVersion: 'Double Clear Low-E Scenario Assumption (VT = 0.72)',
            glazingAssemblyKind: 'double-clear-igu',
            maintenanceFactorM: 0.90,
            maintenanceProvenance: 'traceable-generic-reference',
            revealDepth: unit === 'feet' ? 0.5 : 0.15,
            exteriorShadingType: 'horizontal-overhang',
            overhangProjectionDepth: unit === 'feet' ? 2.5 : 0.75,
            overhangHeightAboveWindowHead: 0,
            sideFinProjectionDepth: null,
            exteriorLouverCutoffAngleDeg: null,
            interiorShadingType: 'sheer-diffusing-roller-blind',
            defaultBlindState: 'retracted-open',
            interiorBlindTransmittanceMultiplier: 0.35,
            interiorBlindProvenance: 'illustrative-scenario-assumption',
            operabilityStatus: 'operable',
          },
        },
      });
    } else {
      const firstWin = evaluatedWindows[0];
      if (firstWin.grossWidthMetres !== null && firstWin.grossHeightMetres !== null) {
        const curW =
          unit === 'feet'
            ? round2(firstWin.grossWidthMetres / METRES_PER_FOOT)
            : firstWin.grossWidthMetres;
        const proposedW = round2(curW * 1.35);
        recs.push({
          recommendationId: `p38-rec-widen-win-${firstWin.windowId}`,
          roomId: room.id,
          roomName: room.name,
          category: 'add-or-enlarge-window-glazing',
          priority: 'medium',
          title: `Widen Window "${firstWin.label}" (${curW} → ${proposedW} ${unit}) to Improve Daylight Factor`,
          issueOrOpportunityAddressed: `Mean Daylight Factor (${modeC.meanDaylightFactorPercent}%) is below the 2.0% advisory benchmark.`,
          triggeringInputsAndConditions: `DF_mean = ${modeC.meanDaylightFactorPercent}% < 2.0% on ${room.name}`,
          physicalRationale:
            'Increasing net glazed area A_g directly increases the sky flux entering the room in the Split-Flux numerator and widens the horizontal view-out angle.',
          supportingEvidenceLevel: 'Calculated estimate via Mode C BRE Split-Flux equation.',
          expectedDaylightAndGlareEffect:
            'Increases Mean Daylight Factor by ~35% on that window contribution and improves horizontal sight angle.',
          remainingUnknownsAndLimitations: [
            'Check structural wall opening span and lintel capacity.',
          ],
          multidisciplinaryTradeOffs: {
            solarHeatAndShadingTradeOff:
              'Larger glazing area increases direct solar exposure unless paired with external shading.',
            naturalVentilationP37Impact:
              'Modifying physical window width affects linked P37 opening geometry; P37 is flagged for recalculation.',
            acousticsAndNoiseP36Impact:
              'Verify exterior facade acoustic insulation if facing road traffic (P36).',
            materialsAndReflectanceP35Impact: 'Increased glazing area relative to opaque cladding.',
            accessibilityAndControlsP34Impact: 'Preserves accessible sill and hardware reach.',
            furnitureAndCirculationP33Impact: 'Preserves interior circulation clearances.',
          },
          canPreviewAndApplyInPlotify: true,
          proposedMutation: {
            roomId: room.id,
            updateWindow: {
              windowId: firstWin.windowId,
              grossWidth: proposedW,
            },
          },
        });
      }
    }
  }

  // 4. Direct-sun / glare control recommendation: add or deepen exterior overhang
  const unshadedSunWin = modeB.windowSolarExposures.find(
    (e) => e.isFacadeSunlit && e.directSunlitGlazedFraction > 0.35
  );
  if (unshadedSunWin) {
    const winObj = evaluatedWindows.find((w) => w.windowId === unshadedSunWin.windowId);
    const curOverhangM = winObj?.overhangProjectionMetres ?? 0;
    const targetOverhangInUnit =
      unit === 'feet'
        ? round2(Math.max(3.5, (curOverhangM / METRES_PER_FOOT) + 2.0))
        : round2(Math.max(1.0, curOverhangM + 0.6));

    recs.push({
      recommendationId: `p38-rec-overhang-${unshadedSunWin.windowId}`,
      roomId: room.id,
      roomName: room.name,
      category: 'add-exterior-overhang-or-shading',
      priority:
        modeE.qualitativeGlareRiskLevel === 'high-direct-sun-or-low-angle-concern'
          ? 'high'
          : 'medium',
      title: `Configure ${targetOverhangInUnit} ${unit} Horizontal Overhang on "${unshadedSunWin.label}"`,
      issueOrOpportunityAddressed: `Window "${unshadedSunWin.label}" transmits ${round2(
        unshadedSunWin.directSunlitGlazedFraction * 100
      )}% direct solar beam (${unshadedSunWin.directSunPenetrationDepthMetres} m floor penetration depth), contributing to direct-sun glare risk.`,
      triggeringInputsAndConditions: `Solar altitude α_s = ${modeB.solarAltitudeDeg}°, profile angle Ω_v = ${unshadedSunWin.verticalProfileAngleDeg}°, directSunlitGlazedFraction = ${unshadedSunWin.directSunlitGlazedFraction}`,
      physicalRationale:
        'An exterior horizontal overhang casts a vertical shadow S_v = P_overhang * tan(Ω_v), intercepting high- and mid-angle direct solar beams while preserving lower-hemisphere view out.',
      supportingEvidenceLevel: 'Calculated via Mode B analytical shadow projection and Mode C sky-angle trade-off.',
      expectedDaylightAndGlareEffect:
        'Reduces direct-sun floor penetration and glare risk, with a modest trade-off reduction in visible vertical sky angle θ and overcast Mean Daylight Factor.',
      remainingUnknownsAndLimitations: [
        'Low-angle early morning or late afternoon sun (Ω_v < 20°) may also require vertical side fins or movable interior blinds.',
      ],
      multidisciplinaryTradeOffs: {
        solarHeatAndShadingTradeOff:
          'Demonstrates the classic architectural trade-off: reduces direct solar beam penetration while slightly reducing overcast sky angle θ.',
        naturalVentilationP37Impact:
          'Exterior overhangs also improve rain protection for operable windows in P37 without obstructing airflow.',
        acousticsAndNoiseP36Impact: 'No adverse impact on indoor reverberation.',
        materialsAndReflectanceP35Impact: 'Select weather-resistant exterior overhang soffit material (P35).',
        accessibilityAndControlsP34Impact:
          'Fixed passive exterior overhang requires no manual occupant operation (favorable for P34).',
        furnitureAndCirculationP33Impact: 'Exterior projection does not encroach on indoor floor space.',
      },
      canPreviewAndApplyInPlotify: true,
      proposedMutation: {
        roomId: room.id,
        updateWindow: {
          windowId: unshadedSunWin.windowId,
          exteriorShadingType:
            winObj?.sideFinProjectionMetres && winObj.sideFinProjectionMetres > 0
              ? 'combined-overhang-and-fins'
              : 'horizontal-overhang',
          overhangProjectionDepth: targetOverhangInUnit,
        },
        proposedFacadeShadingStyle: 'deep-overhangs',
      },
    });
  }

  // 5. High-reflectance interior surfaces upgrade when room is deep or DF is modest
  if (
    (roomConfig.wallReflectance ?? 0.6) < 0.72 ||
    (roomConfig.ceilingReflectance ?? 0.8) < 0.85
  ) {
    recs.push({
      recommendationId: `p38-rec-reflectance-${room.id}`,
      roomId: room.id,
      roomName: room.name,
      category: 'upgrade-surface-reflectance',
      priority: 'advisory',
      title: `Increase Interior Surface Reflectances in ${room.name} (Ceiling 0.85, Walls 0.75, Floor 0.35)`,
      issueOrOpportunityAddressed:
        'Higher diffuse interior surface reflectance improves the Internally Reflected Component (IRC) of daylight, especially in the rear half of the room.',
      triggeringInputsAndConditions: `Current reflectances: ceiling=${roomConfig.ceilingReflectance ?? 'null'}, wall=${roomConfig.wallReflectance ?? 'null'}, floor=${roomConfig.floorReflectance ?? 'null'}`,
      physicalRationale:
        'In the BRE Split-Flux equation, internal inter-reflection scales with 1 / (1 - R²); increasing area-weighted reflectance R increases diffuse daylight uniformity without increasing solar heat gain.',
      supportingEvidenceLevel: 'Calculated estimate via Mode C Split-Flux inter-reflection denominator.',
      expectedDaylightAndGlareEffect:
        'Increases Mean Daylight Factor and softens brightness contrast between window walls and interior surfaces.',
      remainingUnknownsAndLimitations: [
        'Assumes matte/diffuse finishes (glossy surfaces can introduce specular glare).',
      ],
      multidisciplinaryTradeOffs: {
        solarHeatAndShadingTradeOff:
          'Improves indoor daylight distribution without increasing exterior solar heat gain.',
        naturalVentilationP37Impact: 'No impact on ventilation openings.',
        acousticsAndNoiseP36Impact:
          'Ensure high-reflectance acoustic ceiling tiles/plaster retain their P36 sound absorption coefficients.',
        materialsAndReflectanceP35Impact:
          'Coordinate light-toned matte mineral/limewash wall finishes with P35 moisture suitability.',
        accessibilityAndControlsP34Impact:
          'Maintain visual contrast between walls, floors, and door frames for low-vision wayfinding (P34).',
        furnitureAndCirculationP33Impact: 'No impact on furniture clearances.',
      },
      canPreviewAndApplyInPlotify: true,
      proposedMutation: {
        roomId: room.id,
        setRoomSurfaceReflectances: {
          ceilingReflectance: 0.85,
          wallReflectance: 0.75,
          floorReflectance: 0.35,
          provenance: 'illustrative-scenario-assumption',
        },
      },
    });
  }

  return recs;
}

/**
 * Evaluates a single room under a specific `DaylightScenario`.
 */
export function evaluateRoomForDaylightScenario(
  project: Project,
  room: FloorPlanRoom,
  daylightData: ProjectDaylightComfortData,
  scenario: DaylightScenario
): RoomScenarioDaylightEvaluation {
  const roomConfig: RoomDaylightConfig = daylightData.roomConfigs?.[room.id] || {
    roomId: room.id,
    geometryShape: 'rectangle',
    ceilingHeight: null,
    ceilingHeightProvenance: 'unavailable-or-unverified',
    workPlaneHeight: project.unit === 'feet' ? 2.62 : 0.8,
    workPlaneProvenance: 'traceable-generic-reference',
    perimeterGridMargin: project.unit === 'feet' ? 1.64 : 0.5,
    analysisGridSpacing: project.unit === 'feet' ? 3.28 : 1.0,
    dimensionUnit: project.unit,
    ceilingReflectance: 0.8,
    ceilingReflectanceProvenance: 'illustrative-scenario-assumption',
    wallReflectance: 0.6,
    wallReflectanceProvenance: 'illustrative-scenario-assumption',
    floorReflectance: 0.25,
    floorReflectanceProvenance: 'illustrative-scenario-assumption',
    visualPriorities: ['high-daylight-task-illumination', 'exterior-view-connection'],
    updatedAt: '2026-10-26T00:00:00.000Z',
  };

  const roomWindows = (daylightData.windows || []).filter((w) => w.roomId === room.id);
  const geometry = evaluateRoomDaylightGeometrySI(
    project,
    room,
    roomConfig,
    roomWindows
  );

  const evaluatedWindows = roomWindows.map((w) =>
    evaluateWindowForScenarioSI(
      project,
      room,
      geometry,
      w,
      scenario,
      daylightData.externalObstructions || []
    )
  );

  // Check if P30 brief has confirmed naturalLightRequired for this room
  let confirmedBriefDaylightRequired: boolean | null = null;
  if (project.brief) {
    const isApproved =
      project.brief.approvalStatus === 'client-approved' ||
      project.brief.approvalStatus === 'locked';
    const matchedSpace = (project.brief.spaces || []).find(
      (s) =>
        s.name.toLowerCase().includes(room.name.toLowerCase()) ||
        room.name.toLowerCase().includes(s.name.toLowerCase()) ||
        s.category === room.type
    );
    if (matchedSpace) {
      confirmedBriefDaylightRequired = isApproved
        ? Boolean(matchedSpace.naturalLightRequired)
        : null;
    }
  }

  const allCriteria = [
    ...DEFAULT_DAYLIGHT_CRITERIA.filter(
      (dc) => !daylightData.customCriteriaOverrides.some((cc) => cc.metric === dc.metric)
    ),
    ...daylightData.customCriteriaOverrides,
  ];

  const modeA = evaluateModeAGeometricDaylightPotential(
    geometry,
    evaluatedWindows,
    daylightData.externalObstructions || [],
    allCriteria,
    confirmedBriefDaylightRequired
  );

  const modeB = evaluateModeBSolarAndShading(
    geometry,
    evaluatedWindows,
    scenario.environmentalConditions
  );

  const measuredRecord = daylightData.measuredIlluminanceRecords?.[room.id];

  const modeC = evaluateModeCSimplifiedDaylight(
    geometry,
    roomConfig,
    evaluatedWindows,
    scenario,
    allCriteria,
    measuredRecord
  );

  const modeD = evaluateModeDAnnualSimulationStatus(
    scenario.environmentalConditions
  );

  const modeE = evaluateModeEVisualComfortGlareAndView(
    geometry,
    roomConfig,
    evaluatedWindows,
    daylightData.externalObstructions || [],
    modeA,
    modeB,
    modeC,
    allCriteria
  );

  const recommendations = generateDaylightRecommendations(
    project,
    room,
    geometry,
    roomConfig,
    evaluatedWindows,
    modeA,
    modeB,
    modeC,
    modeE
  );

  const selectedMode = daylightData.selectedAssessmentMode;

  let completenessState: DaylightCompletenessState = modeC.completenessState;
  if (!geometry.is2DGeometryValid) {
    completenessState = 'invalid-input';
  } else if (selectedMode === 'mode-d-climate-based-annual-simulation') {
    completenessState = modeD.completenessState;
  } else if (selectedMode === 'mode-a-geometric-potential') {
    completenessState = modeA.completenessState;
  } else if (selectedMode === 'mode-b-solar-position-and-shading') {
    completenessState = modeB.completenessState;
  }

  let overallStatus: DaylightEvaluationStatus = 'favorable-for-screened-criteria';
  if (!geometry.is2DGeometryValid) {
    overallStatus = 'invalid-input';
  } else if (selectedMode === 'mode-d-climate-based-annual-simulation') {
    overallStatus = 'unsupported-method';
  } else if (
    completenessState === 'insufficient-evidence' ||
    completenessState === 'awaiting-required-environmental-data'
  ) {
    overallStatus = 'insufficient-evidence';
  } else if (
    modeE.qualitativeGlareRiskLevel === 'high-direct-sun-or-low-angle-concern' ||
    (modeC.meetsMeanDfTarget === false && modeC.meanDaylightFactorPercent !== null)
  ) {
    overallStatus = 'concern-identified';
  } else if (
    modeE.qualitativeGlareRiskLevel === 'moderate-conditional-concern' ||
    modeA.exceedsLimitingDepthHeuristic === true
  ) {
    overallStatus = 'conditional-or-tradeoff-identified';
  }

  const warningsAndLimitations = [
    ...geometry.validationErrors,
    ...evaluatedWindows.flatMap((w) =>
      w.p33FurnitureObstructionWarning ? [w.p33FurnitureObstructionWarning] : []
    ),
    ...evaluatedWindows.flatMap((w) =>
      w.p34AccessibilityControlWarning ? [w.p34AccessibilityControlWarning] : []
    ),
    modeC.en17037NonEquivalenceDisclosure,
  ];

  const missingInputsGuidance = [
    ...geometry.missingGeometryDisclosures,
    ...evaluatedWindows.flatMap((w) => w.missingOpticalOrDimensionDisclosures),
    ...modeC.missingRequiredInputs,
  ];

  const roomFp = computeDaylightComfortSourceFingerprint(project, daylightData);

  return {
    evaluationId: `p38-room-eval-${room.id}-${scenario.scenarioId}`,
    projectId: project.id,
    roomId: room.id,
    roomName: room.name,
    roomType: room.type,
    floorLevel: room.floorLevel || 1,
    scenarioId: scenario.scenarioId,
    scenarioName: scenario.name,
    evaluatedAt: new Date().toISOString(),
    calculationMethodVersion: P38_DAYLIGHT_ANALYZER_ENGINE_VERSION,
    inputFingerprint: roomFp,
    selectedMode,
    overallStatus,
    completenessState,
    geometry,
    evaluatedWindows,
    externalObstructions: daylightData.externalObstructions || [],
    modeA_GeometricPotential: modeA,
    modeB_SolarAndShading: modeB,
    modeC_SimplifiedDaylight: modeC,
    modeD_AnnualSimulationStatus: modeD,
    modeE_VisualComfortGlareView: modeE,
    recommendations,
    warningsAndLimitations,
    missingInputsGuidance,
  };
}

/**
 * Mode F — Side-by-Side Scenario Comparison per P38 Section 9 Mode F.
 * Checks which inputs changed, whether sky/environmental assumptions are equivalent for DF comparison,
 * and flags any incomparable evidence mix (e.g. measured illuminance vs. illustrative scenario assumption).
 */
export function compareRoomDaylightScenarios(
  baselineEval: RoomScenarioDaylightEvaluation,
  comparedEval: RoomScenarioDaylightEvaluation,
  baselineScenario: DaylightScenario,
  comparedScenario: DaylightScenario
): ModeFDaylightScenarioComparisonResult {
  const changedInputsSummary: string[] = [];
  const comparabilityDisclosures: string[] = [];

  const envA = baselineScenario.environmentalConditions;
  const envB = comparedScenario.environmentalConditions;

  if (envA.analysisDateIso !== envB.analysisDateIso || envA.analysisLocalTime24h !== envB.analysisLocalTime24h) {
    changedInputsSummary.push(
      `Solar Date/Time: ${envA.analysisDateIso} ${envA.analysisLocalTime24h} → ${envB.analysisDateIso} ${envB.analysisLocalTime24h}`
    );
  }
  if (envA.latitudeDeg !== envB.latitudeDeg || envA.longitudeDeg !== envB.longitudeDeg) {
    changedInputsSummary.push(
      `Solar Coordinates: (${envA.latitudeDeg}°, ${envA.longitudeDeg}°) → (${envB.latitudeDeg}°, ${envB.longitudeDeg}°)`
    );
  }
  if (envA.skyModelCondition !== envB.skyModelCondition) {
    changedInputsSummary.push(
      `Sky Model Condition: ${envA.skyModelCondition} → ${envB.skyModelCondition}`
    );
  }

  // Compare window parameters between the two evaluations
  for (const winA of baselineEval.evaluatedWindows) {
    const winB = comparedEval.evaluatedWindows.find((w) => w.windowId === winA.windowId);
    if (!winB) continue;
    if (winA.netGlazedAreaM2 !== winB.netGlazedAreaM2) {
      changedInputsSummary.push(
        `Window "${winA.label}" Net Glazed Area: ${winA.netGlazedAreaM2 ?? 'null'} m² → ${winB.netGlazedAreaM2 ?? 'null'} m²`
      );
    }
    if (winA.visibleTransmittanceVT !== winB.visibleTransmittanceVT) {
      changedInputsSummary.push(
        `Window "${winA.label}" Glazing VT: ${winA.visibleTransmittanceVT ?? 'null'} (${winA.vtProvenance}) → ${winB.visibleTransmittanceVT ?? 'null'} (${winB.vtProvenance})`
      );
    }
    if (
      winA.exteriorShadingType !== winB.exteriorShadingType ||
      winA.overhangProjectionMetres !== winB.overhangProjectionMetres ||
      winA.sideFinProjectionMetres !== winB.sideFinProjectionMetres
    ) {
      changedInputsSummary.push(
        `Window "${winA.label}" Exterior Shading: ${winA.exteriorShadingType} (overhang=${winA.overhangProjectionMetres ?? 0}m) → ${winB.exteriorShadingType} (overhang=${winB.overhangProjectionMetres ?? 0}m)`
      );
    }
    if (winA.blindDeploymentState !== winB.blindDeploymentState) {
      changedInputsSummary.push(
        `Window "${winA.label}" Interior Blind State: ${winA.blindDeploymentState} → ${winB.blindDeploymentState}`
      );
    }
  }

  if (
    baselineEval.modeC_SimplifiedDaylight.areaWeightedAverageReflectanceR !==
    comparedEval.modeC_SimplifiedDaylight.areaWeightedAverageReflectanceR
  ) {
    changedInputsSummary.push(
      `Mean Internal Surface Reflectance R: ${baselineEval.modeC_SimplifiedDaylight.areaWeightedAverageReflectanceR ?? 'null'} → ${comparedEval.modeC_SimplifiedDaylight.areaWeightedAverageReflectanceR ?? 'null'}`
    );
  }

  const areAssumptionsEquivalentForDfComparison =
    envA.skyModelCondition === 'cie-standard-overcast-sky' &&
    envB.skyModelCondition === 'cie-standard-overcast-sky' &&
    baselineEval.modeC_SimplifiedDaylight.isCalculationSupported &&
    comparedEval.modeC_SimplifiedDaylight.isCalculationSupported;

  if (!areAssumptionsEquivalentForDfComparison) {
    comparabilityDisclosures.push(
      'Mean Daylight Factor comparison is incomplete or uses different sky boundary conditions between the two scenarios.'
    );
  }

  // Check evidence equivalence (e.g. manufacturer-verified VT vs illustrative assumption, or measured lux vs predicted)
  const provSetA = new Set(baselineEval.evaluatedWindows.map((w) => w.vtProvenance));
  const provSetB = new Set(comparedEval.evaluatedWindows.map((w) => w.vtProvenance));
  const hasMixedProvenance =
    Array.from(provSetA).join(',') !== Array.from(provSetB).join(',') ||
    envA.locationProvenance !== envB.locationProvenance;

  if (hasMixedProvenance) {
    comparabilityDisclosures.push(
      'Evidence-level warning: The compared scenarios use different input provenance tiers (e.g. user-entered/manufacturer data vs. illustrative scenario assumption). Do not treat illustrative predictions as equivalent to measured or certified data.'
    );
  }

  const baseGlazed = baselineEval.modeA_GeometricPotential.totalNetGlazedAreaM2;
  const compGlazed = comparedEval.modeA_GeometricPotential.totalNetGlazedAreaM2;
  const deltaNetGlazedAreaM2 =
    baseGlazed !== null && compGlazed !== null ? round3(compGlazed - baseGlazed) : null;

  const baseGfr = baselineEval.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent;
  const compGfr = comparedEval.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent;
  const deltaGlazedToFloorRatioPercent =
    baseGfr !== null && compGfr !== null ? round2(compGfr - baseGfr) : null;

  const baseDf = baselineEval.modeC_SimplifiedDaylight.meanDaylightFactorPercent;
  const compDf = comparedEval.modeC_SimplifiedDaylight.meanDaylightFactorPercent;
  const deltaMeanDaylightFactorPercent =
    baseDf !== null && compDf !== null ? round2(compDf - baseDf) : null;

  const baseSun = baselineEval.modeB_SolarAndShading.workPlaneDirectSunCoveragePercent;
  const compSun = comparedEval.modeB_SolarAndShading.workPlaneDirectSunCoveragePercent;
  const deltaDirectSunCoveragePercent =
    baseSun !== null && compSun !== null ? round2(compSun - baseSun) : null;

  let tradeOffSummary =
    'Compared scenarios under documented optical, shading, and solar assumptions.';
  if (deltaMeanDaylightFactorPercent !== null && deltaDirectSunCoveragePercent !== null) {
    if (deltaDirectSunCoveragePercent < 0 && deltaMeanDaylightFactorPercent < 0) {
      tradeOffSummary = `Solar-control trade-off identified: Compared scenario reduces direct-sun work-plane exposure by ${Math.abs(
        deltaDirectSunCoveragePercent
      )}% while reducing overcast Mean Daylight Factor by ${Math.abs(
        deltaMeanDaylightFactorPercent
      )}% (${baseDf}% → ${compDf}%).`;
    } else if (deltaDirectSunCoveragePercent < 0 && deltaMeanDaylightFactorPercent >= 0) {
      tradeOffSummary = `Compared scenario reduces direct-sun work-plane exposure by ${Math.abs(
        deltaDirectSunCoveragePercent
      )}% while maintaining or improving Mean Daylight Factor (${baseDf}% → ${compDf}%).`;
    } else if (deltaMeanDaylightFactorPercent > 0 && deltaDirectSunCoveragePercent > 0) {
      tradeOffSummary = `Compared scenario increases Mean Daylight Factor by +${deltaMeanDaylightFactorPercent}% (${baseDf}% → ${compDf}%), but also increases direct-sun work-plane coverage by +${deltaDirectSunCoveragePercent}%.`;
    }
  }

  return {
    mode: 'mode-f-scenario-comparison',
    roomId: baselineEval.roomId,
    roomName: baselineEval.roomName,
    baselineScenarioId: baselineScenario.scenarioId,
    baselineScenarioName: baselineScenario.name,
    comparedScenarioId: comparedScenario.scenarioId,
    comparedScenarioName: comparedScenario.name,
    areAssumptionsEquivalentForDfComparison,
    hasIncomparableEvidenceMixWarning: hasMixedProvenance,
    changedInputsSummary,
    comparabilityDisclosures,
    baselineNetGlazedAreaM2: baseGlazed,
    comparedNetGlazedAreaM2: compGlazed,
    deltaNetGlazedAreaM2,
    baselineGlazedToFloorRatioPercent: baseGfr,
    comparedGlazedToFloorRatioPercent: compGfr,
    deltaGlazedToFloorRatioPercent,
    baselineMeanDaylightFactorPercent: baseDf,
    comparedMeanDaylightFactorPercent: compDf,
    deltaMeanDaylightFactorPercent,
    baselineDirectSunCoveragePercent: baseSun,
    comparedDirectSunCoveragePercent: compSun,
    deltaDirectSunCoveragePercent,
    baselineGlareRisk: baselineEval.modeE_VisualComfortGlareView.qualitativeGlareRiskLevel,
    comparedGlareRisk: comparedEval.modeE_VisualComfortGlareView.qualitativeGlareRiskLevel,
    daylightVsSolarControlTradeOffSummary: tradeOffSummary,
  };
}

/**
 * Generates read-only P38 summaries for each comparable option in P31 (`extractComparableOptions`)
 * per P38 Section 14 (P31). Never mutates P31's score engine or fabricates deltas.
 */
export function getP38DaylightSummaryForComparison(
  project: Project
): P38OptionDaylightComparisonSummary[] {
  const options = extractComparableOptions(project);
  const baseDaylightData = initializeProjectDaylightComfortData(project);
  const activeScenario =
    baseDaylightData.scenarios.find((s) => s.scenarioId === baseDaylightData.activeScenarioId) ||
    baseDaylightData.scenarios[0];

  return options.map((opt) => {
    const optProject: Project = {
      ...project,
      unit: opt.unit,
      floors: opt.floors,
      floorPlan: { rooms: opt.rooms },
    };
    const optDaylight = initializeProjectDaylightComfortData(optProject);
    const shadingStyle = opt.facade?.shadingStyle || 'none';

    // Reflect option facade shading style on windows that have no explicit override
    if (shadingStyle === 'deep-overhangs' || shadingStyle === 'brise-soleil') {
      optDaylight.windows = optDaylight.windows.map((w) => ({
        ...w,
        exteriorShadingType: 'horizontal-overhang',
        overhangProjectionDepth: opt.unit === 'feet' ? 3.0 : 0.9,
      }));
    } else if (shadingStyle === 'motorized-louvers') {
      optDaylight.windows = optDaylight.windows.map((w) => ({
        ...w,
        exteriorShadingType: 'external-louvers-brise-soleil',
        exteriorLouverCutoffAngleDeg: 45,
      }));
    }

    const roomEvals = (opt.rooms || []).map((rm) =>
      evaluateRoomForDaylightScenario(optProject, rm, optDaylight, activeScenario)
    );

    const roomsWithWin = roomEvals.filter(
      (re) =>
        re.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent !== null &&
        re.modeA_GeometricPotential.windowCount > 0
    );
    const roomsWithDf = roomEvals.filter(
      (re) => re.modeC_SimplifiedDaylight.meanDaylightFactorPercent !== null
    );

    const avgGfr =
      roomsWithWin.length > 0
        ? round2(
            roomsWithWin.reduce(
              (acc, r) =>
                acc + (r.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent || 0),
              0
            ) / roomsWithWin.length
          )
        : null;

    const avgDf =
      roomsWithDf.length > 0
        ? round2(
            roomsWithDf.reduce(
              (acc, r) => acc + (r.modeC_SimplifiedDaylight.meanDaylightFactorPercent || 0),
              0
            ) / roomsWithDf.length
          )
        : null;

    const limitations: string[] = [];
    if (roomsWithDf.length < roomEvals.length) {
      limitations.push(
        `${roomEvals.length - roomsWithDf.length} of ${roomEvals.length} room(s) lack ceiling height, window height, or glazing VT required for Mode C Mean Daylight Factor.`
      );
    }
    if (opt.sharesBaselineGeometry) {
      limitations.push(
        'Shares baseline 2D room geometry; differences reflect facade shading style only.'
      );
    }

    return {
      optionId: opt.optionId,
      optionName: opt.name,
      calculationMethodVersion: P38_DAYLIGHT_ANALYZER_ENGINE_VERSION,
      activeScenarioName: activeScenario.name,
      roomsEvaluatedCount: roomEvals.length,
      roomsWithWindowGeometryCount: roomsWithWin.length,
      roomsWithCalculatedMeanDfCount: roomsWithDf.length,
      averageNetGlazedToFloorRatioPercent: avgGfr,
      averageMeanDaylightFactorPercent: avgDf,
      facadeShadingStyle: shadingStyle,
      overallCompletenessState:
        roomsWithDf.length === roomEvals.length && roomEvals.length > 0
          ? 'sufficient-for-simplified-calculation'
          : roomsWithWin.length > 0
          ? 'sufficient-for-geometric-screening'
          : 'insufficient-evidence',
      comparabilityStatus:
        roomsWithDf.length === roomEvals.length && roomEvals.length > 0
          ? 'comparable-simplified-daylight'
          : roomsWithWin.length > 0
          ? 'geometric-screening-only'
          : 'incomplete-daylight-data',
      summaryExplanation:
        avgDf !== null
          ? `Option "${opt.name}" has an average Mean Daylight Factor of ${avgDf}% across ${roomsWithDf.length}/${roomEvals.length} rooms (facade shading: ${shadingStyle}).`
          : avgGfr !== null
          ? `Option "${opt.name}" has an average Net Glazed-to-Floor Ratio of ${avgGfr}% (geometric screening only; ceiling height or VT missing for DF).`
          : `Option "${opt.name}" lacks complete window height or optical data for numerical daylight comparison.`,
      comparisonLimitations: limitations,
    };
  });
}

/**
 * Top-level P38 Project Evaluation function.
 */
export function evaluateProjectDaylightComfort(
  project: Project
): DaylightComfortProjectEvaluationReport {
  const dData = initializeProjectDaylightComfortData(project);
  const currentFingerprint = computeDaylightComfortSourceFingerprint(project, dData);

  const isStale = Boolean(
    dData.lastSourceFingerprint && dData.lastSourceFingerprint !== currentFingerprint
  );
  const staleReasons: string[] = [];
  if (isStale) {
    staleReasons.push(
      'Underlying room geometry, window dimensions, glazing optical properties, surface reflectances, shading, or solar scenario inputs changed since the last saved assessment.'
    );
  }

  const rooms = project.floorPlan?.rooms || [];
  const selectedRoomId =
    dData.selectedRoomId && rooms.some((r) => r.id === dData.selectedRoomId)
      ? dData.selectedRoomId
      : rooms[0]?.id || null;

  const activeScenario =
    dData.scenarios.find((s) => s.scenarioId === dData.activeScenarioId) ||
    dData.scenarios[0];

  const comparisonScenario =
    dData.scenarios.find((s) => s.scenarioId === dData.comparisonScenarioId) ||
    dData.scenarios[1] ||
    null;

  const allRoomEvaluationsForActiveScenario = rooms.map((rm) =>
    evaluateRoomForDaylightScenario(project, rm, dData, activeScenario)
  );

  if (isStale) {
    for (const re of allRoomEvaluationsForActiveScenario) {
      re.completenessState = 'stale-result';
    }
  }

  const activeRoomEvaluation =
    allRoomEvaluationsForActiveScenario.find((re) => re.roomId === selectedRoomId) ||
    allRoomEvaluationsForActiveScenario[0] ||
    null;

  const activeRoomObj = rooms.find((r) => r.id === activeRoomEvaluation?.roomId);
  const comparisonRoomEvaluation =
    activeRoomObj && comparisonScenario
      ? evaluateRoomForDaylightScenario(project, activeRoomObj, dData, comparisonScenario)
      : null;

  const modeF_ScenarioComparison =
    activeRoomEvaluation && comparisonRoomEvaluation && comparisonScenario
      ? compareRoomDaylightScenarios(
          activeRoomEvaluation,
          comparisonRoomEvaluation,
          activeScenario,
          comparisonScenario
        )
      : null;

  // Read-only P30 Brief Integration
  const brief = initializeProjectBrief(project);
  const isBriefApproved =
    brief.approvalStatus === 'client-approved' || brief.approvalStatus === 'locked';
  const confirmedNaturalLightRooms: string[] = [];
  const unconfirmedBriefLightAssumptions: string[] = [];

  for (const sp of brief.spaces || []) {
    if (sp.naturalLightRequired) {
      if (isBriefApproved) {
        confirmedNaturalLightRooms.push(`${sp.name} (Confirmed mandatory/preferred natural light)`);
      } else {
        unconfirmedBriefLightAssumptions.push(
          `${sp.name}: naturalLightRequired=true [Unconfirmed draft brief assumption]`
        );
      }
    }
  }
  for (const req of brief.interpretedBrief?.requirements || []) {
    if (req.category === 'daylight-ventilation') {
      if (req.reviewStatus === 'confirmed') {
        confirmedNaturalLightRooms.push(`${req.description} [Confirmed P30 requirement]`);
      } else {
        unconfirmedBriefLightAssumptions.push(
          `${req.description} [${req.reviewStatus} — held as unconfirmed assumption]`
        );
      }
    }
  }
  const unresolvedBriefConflicts = (brief.interpretedBrief?.conflicts || [])
    .filter((c) => !c.resolved)
    .map((c) => `${c.title}: ${c.description}`);

  // Read-only P31 Option Comparison Summaries
  const p31OptionComparisonSummaries = getP38DaylightSummaryForComparison(project);

  // Read-only P32 Personalization Integration
  const p32Profile = initializePersonalizationProfile(project);
  const explicitNaturalLightAndShadingWeight =
    p32Profile.spatialPriorityWeights?.naturalLightAndShading ?? null;
  const explicitPreferredShadingStyles = p32Profile.preferredShadingStyles || [];
  const unconfirmedSuggestionsHeld = (p32Profile.items || [])
    .filter(
      (item) =>
        item.origin === 'inferred-suggestion' ||
        item.confirmationStatus === 'unconfirmed-suggestion'
    )
    .map((item) => `${item.label}: ${item.value} (${item.confirmationStatus})`);

  // Read-only P33 Furniture & Openings Integration
  const p33Data = ensureProjectFurnitureLayoutData(project);
  const p33WindowOpenings = (p33Data.knownOpenings || []).filter((o) => o.type === 'window');
  const incompleteP33WindowHeightDisclosures = dData.windows
    .filter((w) => w.linkedP33OpeningId && w.grossHeight === null)
    .map(
      (w) =>
        `Window "${w.label}" (linked to P33 ${w.linkedP33OpeningId}) only specifies width (${w.grossWidth} ${w.dimensionUnit}); P38 does not invent height or VT.`
    );
  const furnitureWindowObstructionWarnings = allRoomEvaluationsForActiveScenario
    .flatMap((re) => re.evaluatedWindows)
    .filter((w) => Boolean(w.p33FurnitureObstructionWarning))
    .map((w) => w.p33FurnitureObstructionWarning as string);

  // Read-only P34 Accessibility Integration
  const windowAndShadeControlReachWarnings = allRoomEvaluationsForActiveScenario
    .flatMap((re) => re.evaluatedWindows)
    .filter((w) => Boolean(w.p34AccessibilityControlWarning))
    .map((w) => w.p34AccessibilityControlWarning as string);

  // Read-only P35 Material Integration
  const p35Data = initializeProjectMaterialAdvisorData(project);

  // Read-only P36 Acoustic Integration
  const p36Data = initializeProjectAcousticPlannerData(project);
  const glazingAndNoiseTradeOffWarnings: string[] = [];
  for (const obs of p36Data.noiseObservations || []) {
    if (
      obs.qualitativeSeverity === 'high-intrusive' ||
      (obs.soundLevelDb !== null && obs.soundLevelDb >= 60)
    ) {
      const rmWins = dData.windows.filter((w) => w.roomId === obs.roomId);
      if (rmWins.length > 0) {
        glazingAndNoiseTradeOffWarnings.push(
          `Room "${obs.roomId}" has P36 noise observation "${obs.sourceDescription}" (${
            obs.soundLevelDb ? `${obs.soundLevelDb} dBA` : obs.qualitativeSeverity
          }) and ${rmWins.length} exterior window(s). Enlarging windows for daylight must be balanced against exterior acoustic glazing insulation (Rw/STC) in P36.`
        );
      }
    }
  }

  // Read-only P37 Natural Ventilation Integration
  const sharedWindowIdsCount = dData.windows.filter(
    (w) => Boolean(w.linkedP37OpeningId || w.linkedP33OpeningId)
  ).length;

  const allCriteria = [
    ...DEFAULT_DAYLIGHT_CRITERIA.filter(
      (dc) => !dData.customCriteriaOverrides.some((cc) => cc.metric === dc.metric)
    ),
    ...dData.customCriteriaOverrides,
  ];

  return {
    assessmentId: `p38-proj-eval-${project.id}-${dData.requestSequenceId}`,
    schemaVersion: P38_DAYLIGHT_SCHEMA_VERSION,
    calculationMethodVersion: P38_DAYLIGHT_ANALYZER_ENGINE_VERSION,
    projectId: project.id,
    projectName: project.name,
    unit: project.unit,
    evaluatedAt: new Date().toISOString(),
    requestSequenceId: dData.requestSequenceId,
    sourceFingerprint: currentFingerprint,
    isStale,
    staleReasons,
    isConfigured: dData.isConfigured,
    selectedRoomId,
    selectedAssessmentMode: dData.selectedAssessmentMode,
    activeScenario,
    comparisonScenario,
    allScenarios: dData.scenarios,
    activeRoomEvaluation,
    comparisonRoomEvaluation,
    modeF_ScenarioComparison,
    allRoomEvaluationsForActiveScenario,
    configuredCriteria: allCriteria,
    sourceReferencesLedger: Object.values(P38_TECHNICAL_REFERENCES),
    p30BriefIntegration: {
      hasBrief: Boolean(project.brief),
      confirmedNaturalLightRooms,
      unconfirmedBriefLightAssumptions,
      unresolvedBriefConflicts,
    },
    p31OptionComparisonSummaries,
    p32PersonalizationIntegration: {
      hasPersonalizationProfile: Boolean(project.designPersonalization),
      explicitNaturalLightAndShadingWeight,
      explicitPreferredShadingStyles,
      unconfirmedSuggestionsHeld,
    },
    p33FurnitureAndOpeningsIntegration: {
      syncedP33WindowOpeningsCount: p33WindowOpenings.length,
      incompleteP33WindowHeightDisclosures,
      furnitureWindowObstructionWarnings,
    },
    p34AccessibilityIntegration: {
      hasAccessibilityReview: Boolean(project.accessibilityReview),
      windowAndShadeControlReachWarnings,
    },
    p35MaterialIntegration: {
      climateProfileName: p35Data.climateContext.profileName,
      noOpticalInferenceFromMaterialCategoryNote:
        'P38 never assigns visible light transmittance (VT) or diffuse surface reflectance solely from a P35 material category, U-factor, or SHGC.',
    },
    p36AcousticIntegration: {
      hasAcousticPlanner: Boolean(project.acousticPlanner),
      glazingAndNoiseTradeOffWarnings,
    },
    p37NaturalVentilationIntegration: {
      hasNaturalVentilation: Boolean(project.naturalVentilation),
      sharedWindowIdsCount,
      p37StaleIfWindowModifiedNote:
        'P38 reuses window geometry without recalculating P37 airflow. If a P38 proposal modifies physical window dimensions, any associated P37 natural ventilation scenario is flagged as stale.',
    },
    roadmapScopeBoundaries: [
      {
        roadmapId: 'P37',
        title: 'Natural Ventilation Scenario Analyzer (Authoritative Airflow Engine)',
        boundaryStatement:
          'P38 reads window records and flags when a physical window change requires P37 recalculation; P38 never calculates wind/stack airflow or ACH.',
      },
      {
        roadmapId: 'P39',
        title: 'Design Rationale & Decision History (Future Scope — Not Implemented in P38)',
        boundaryStatement:
          'P38 records scenario provenance and pre-apply snapshots for daylight changes; cross-project decision rationale timelines belong to P39.',
      },
      {
        roadmapId: 'P40',
        title: 'Design Quality Benchmark & Improvement Loop (Future Scope — Not Implemented in P38)',
        boundaryStatement:
          'P38 does not compute a global multi-domain design quality benchmark score; that belongs to P40.',
      },
    ],
    professionalDisclaimer: P38_PROFESSIONAL_DISCLAIMER,
  };
}

/**
 * Generates a non-destructive preview diff (`DaylightProposalPreviewDiff`) for a P38 recommendation
 * without mutating the source `Project` per P38 Section 15.
 */
export function previewDaylightRecommendation(
  project: Project,
  recommendationId: string
): DaylightProposalPreviewDiff {
  const currentReport = evaluateProjectDaylightComfort(project);
  const allRecs = currentReport.allRoomEvaluationsForActiveScenario.flatMap(
    (re) => re.recommendations
  );
  const rec = allRecs.find((r) => r.recommendationId === recommendationId);

  if (!rec || !rec.canPreviewAndApplyInPlotify || !rec.proposedMutation) {
    return {
      proposalId: `p38-preview-invalid-${Date.now()}`,
      recommendationId,
      roomId: rec?.roomId || '',
      roomName: rec?.roomName || 'Unknown Room',
      title: rec?.title || 'Unsupported Proposal',
      createdAt: new Date().toISOString(),
      sourceFingerprintAtPreview: currentReport.sourceFingerprint,
      isSafeToApply: false,
      blockingReasons: [
        'This recommendation is advisory-only or has no supported Plotify mutation payload.',
      ],
      warningNotices: [],
      marksP37NaturalVentilationStale: false,
      p37StaleDisclosureNote: 'No physical window change proposed.',
      p36AcousticWarnings: [],
      p34AccessibilityPreserved: true,
      p33FurniturePreserved: true,
      p30AndP32Preserved: true,
      beforeCompleteness: 'insufficient-evidence',
      afterCompleteness: 'insufficient-evidence',
      beforeGlazedToFloorRatioPercent: null,
      afterGlazedToFloorRatioPercent: null,
      beforeMeanDaylightFactorPercent: null,
      afterMeanDaylightFactorPercent: null,
      beforeDirectSunCoveragePercent: null,
      afterDirectSunCoveragePercent: null,
      beforeGlareRisk: 'insufficient-evidence',
      afterGlareRisk: 'insufficient-evidence',
      fieldChanges: [],
      proposedProjectClone: JSON.parse(JSON.stringify(project)) as Record<string, unknown>,
    };
  }

  const roomBefore = currentReport.allRoomEvaluationsForActiveScenario.find(
    (re) => re.roomId === rec.roomId
  );

  const clonedProject: Project = JSON.parse(JSON.stringify(project));
  const dData = initializeProjectDaylightComfortData(clonedProject);
  const mut = rec.proposedMutation;
  const fieldChanges: DaylightProposalPreviewDiff['fieldChanges'] = [];
  let marksP37NaturalVentilationStale = false;

  if (mut.setRoomCeilingHeight) {
    const prevCfg = dData.roomConfigs[mut.roomId];
    const beforeH =
      prevCfg?.ceilingHeight !== null && prevCfg?.ceilingHeight !== undefined
        ? `${prevCfg.ceilingHeight} ${prevCfg.dimensionUnit}`
        : 'null (unspecified)';
    const afterH = `${mut.setRoomCeilingHeight.ceilingHeight} ${clonedProject.unit} (${mut.setRoomCeilingHeight.provenance})`;

    dData.roomConfigs[mut.roomId] = {
      ...(prevCfg || {
        roomId: mut.roomId,
        geometryShape: 'rectangle',
        perimeterGridMargin: clonedProject.unit === 'feet' ? 1.64 : 0.5,
        analysisGridSpacing: clonedProject.unit === 'feet' ? 3.28 : 1.0,
        dimensionUnit: clonedProject.unit,
        ceilingReflectance: 0.8,
        ceilingReflectanceProvenance: 'illustrative-scenario-assumption',
        wallReflectance: 0.6,
        wallReflectanceProvenance: 'illustrative-scenario-assumption',
        floorReflectance: 0.25,
        floorReflectanceProvenance: 'illustrative-scenario-assumption',
        visualPriorities: ['high-daylight-task-illumination'],
      }),
      ceilingHeight: mut.setRoomCeilingHeight.ceilingHeight,
      ceilingHeightProvenance: mut.setRoomCeilingHeight.provenance,
      workPlaneHeight: mut.setRoomCeilingHeight.workPlaneHeight,
      workPlaneProvenance: 'traceable-generic-reference',
      updatedAt: new Date().toISOString(),
    };

    fieldChanges.push({
      fieldPath: `daylightComfort.roomConfigs.${mut.roomId}.ceilingHeight`,
      label: `Room Ceiling Height (${rec.roomName})`,
      beforeValue: beforeH,
      afterValue: afterH,
      changed: beforeH !== afterH,
    });
  }

  if (mut.setRoomSurfaceReflectances) {
    const prevCfg = dData.roomConfigs[mut.roomId];
    if (prevCfg) {
      const beforeR = `ceiling=${prevCfg.ceilingReflectance ?? 'null'}, wall=${prevCfg.wallReflectance ?? 'null'}, floor=${prevCfg.floorReflectance ?? 'null'}`;
      const sr = mut.setRoomSurfaceReflectances;
      const afterR = `ceiling=${sr.ceilingReflectance}, wall=${sr.wallReflectance}, floor=${sr.floorReflectance} (${sr.provenance})`;
      prevCfg.ceilingReflectance = sr.ceilingReflectance;
      prevCfg.ceilingReflectanceProvenance = sr.provenance;
      prevCfg.wallReflectance = sr.wallReflectance;
      prevCfg.wallReflectanceProvenance = sr.provenance;
      prevCfg.floorReflectance = sr.floorReflectance;
      prevCfg.floorReflectanceProvenance = sr.provenance;
      prevCfg.updatedAt = new Date().toISOString();

      fieldChanges.push({
        fieldPath: `daylightComfort.roomConfigs.${mut.roomId}.reflectances`,
        label: `Interior Surface Reflectances (${rec.roomName})`,
        beforeValue: beforeR,
        afterValue: afterR,
        changed: beforeR !== afterR,
      });
    }
  }

  if (mut.updateWindow) {
    const uw = mut.updateWindow;
    const idx = dData.windows.findIndex((w) => w.windowId === uw.windowId);
    if (idx >= 0) {
      const beforeW = dData.windows[idx];
      const nextWidth = uw.grossWidth !== undefined ? uw.grossWidth : beforeW.grossWidth;
      const nextHeight = uw.grossHeight !== undefined ? uw.grossHeight : beforeW.grossHeight;
      const nextSill = uw.sillHeight !== undefined ? uw.sillHeight : beforeW.sillHeight;

      if (uw.grossWidth !== undefined || uw.grossHeight !== undefined) {
        marksP37NaturalVentilationStale = true;
      }

      const afterW: DaylightWindowRecord = {
        ...beforeW,
        grossWidth: nextWidth,
        grossHeight: nextHeight,
        sillHeight: nextSill,
        headHeight:
          nextSill !== null && nextHeight !== null
            ? round2(nextSill + nextHeight)
            : beforeW.headHeight,
        dimensionProvenance:
          uw.grossWidth !== undefined || uw.grossHeight !== undefined
            ? 'user-entered'
            : beforeW.dimensionProvenance,
        frameFraction: uw.frameFraction !== undefined ? uw.frameFraction : beforeW.frameFraction,
        frameFractionProvenance:
          uw.frameFraction !== undefined ? 'user-entered' : beforeW.frameFractionProvenance,
        visibleTransmittanceVT:
          uw.visibleTransmittanceVT !== undefined
            ? uw.visibleTransmittanceVT
            : beforeW.visibleTransmittanceVT,
        vtProvenance: uw.vtProvenance || beforeW.vtProvenance,
        exteriorShadingType: uw.exteriorShadingType ?? beforeW.exteriorShadingType,
        overhangProjectionDepth:
          uw.overhangProjectionDepth !== undefined
            ? uw.overhangProjectionDepth
            : beforeW.overhangProjectionDepth,
        sideFinProjectionDepth:
          uw.sideFinProjectionDepth !== undefined
            ? uw.sideFinProjectionDepth
            : beforeW.sideFinProjectionDepth,
        interiorShadingType: uw.interiorShadingType ?? beforeW.interiorShadingType,
        defaultBlindState: uw.defaultBlindState ?? beforeW.defaultBlindState,
        interiorBlindTransmittanceMultiplier:
          uw.interiorBlindTransmittanceMultiplier !== undefined
            ? uw.interiorBlindTransmittanceMultiplier
            : beforeW.interiorBlindTransmittanceMultiplier,
      };
      dData.windows[idx] = afterW;

      fieldChanges.push({
        fieldPath: `daylightComfort.windows.${uw.windowId}`,
        label: `Window "${beforeW.label}" Geometry, Optical & Shading`,
        beforeValue: `W=${beforeW.grossWidth ?? 'null'}×H=${beforeW.grossHeight ?? 'null'}, ff=${beforeW.frameFraction ?? 'null'}, VT=${beforeW.visibleTransmittanceVT ?? 'null'}, shade=${beforeW.exteriorShadingType}(${beforeW.overhangProjectionDepth ?? 0})`,
        afterValue: `W=${afterW.grossWidth ?? 'null'}×H=${afterW.grossHeight ?? 'null'}, ff=${afterW.frameFraction ?? 'null'}, VT=${afterW.visibleTransmittanceVT ?? 'null'}, shade=${afterW.exteriorShadingType}(${afterW.overhangProjectionDepth ?? 0})`,
        changed: true,
      });
    }
  }

  if (mut.addWindow) {
    const newW = mut.addWindow;
    if (!dData.windows.some((w) => w.windowId === newW.windowId)) {
      dData.windows.push(newW);
      marksP37NaturalVentilationStale = true;
      fieldChanges.push({
        fieldPath: `daylightComfort.windows.${newW.windowId}`,
        label: `New Daylight Window (${newW.label})`,
        beforeValue: 'Not present',
        afterValue: `${newW.wallEdge.toUpperCase()} window ${newW.grossWidth}×${newW.grossHeight} ${newW.dimensionUnit}, VT=${newW.visibleTransmittanceVT}`,
        changed: true,
      });
    }
  }

  if (mut.proposedFacadeShadingStyle && clonedProject.designAlternatives?.length) {
    const activeAltIdx = clonedProject.designAlternatives.findIndex(
      (a) => a.id === clonedProject.activeAlternativeId
    );
    const targetIdx = activeAltIdx >= 0 ? activeAltIdx : 0;
    const beforeShading = clonedProject.designAlternatives[targetIdx].facade.shadingStyle;
    clonedProject.designAlternatives[targetIdx].facade.shadingStyle =
      mut.proposedFacadeShadingStyle;
    fieldChanges.push({
      fieldPath: `designAlternatives[${targetIdx}].facade.shadingStyle`,
      label: 'Facade Shading Style',
      beforeValue: beforeShading,
      afterValue: mut.proposedFacadeShadingStyle,
      changed: beforeShading !== mut.proposedFacadeShadingStyle,
    });
  }

  // If physical window dimensions changed and project.naturalVentilation exists, mark P37 fingerprint stale
  if (marksP37NaturalVentilationStale && clonedProject.naturalVentilation) {
    clonedProject.naturalVentilation.lastSourceFingerprint = `p37-marked-stale-by-p38-${Date.now()}`;
  }

  dData.isConfigured = true;
  dData.requestSequenceId = (dData.requestSequenceId || 1) + 1;
  dData.lastEvaluatedAt = new Date().toISOString();
  dData.lastSourceFingerprint = computeDaylightComfortSourceFingerprint(clonedProject, dData);
  clonedProject.daylightComfort = dData;

  const afterReport = evaluateProjectDaylightComfort(clonedProject);
  const roomAfter = afterReport.allRoomEvaluationsForActiveScenario.find(
    (re) => re.roomId === rec.roomId
  );

  const p34WarningsAfter = (roomAfter?.evaluatedWindows || []).some((w) =>
    Boolean(w.p34AccessibilityControlWarning)
  );

  return {
    proposalId: `p38-preview-${rec.recommendationId}-${Date.now()}`,
    recommendationId: rec.recommendationId,
    roomId: rec.roomId,
    roomName: rec.roomName,
    title: rec.title,
    createdAt: new Date().toISOString(),
    sourceFingerprintAtPreview: currentReport.sourceFingerprint,
    isSafeToApply: fieldChanges.some((f) => f.changed),
    blockingReasons: fieldChanges.some((f) => f.changed)
      ? []
      : ['Proposed changes are already applied to the project state.'],
    warningNotices: [
      rec.multidisciplinaryTradeOffs.solarHeatAndShadingTradeOff,
      rec.multidisciplinaryTradeOffs.naturalVentilationP37Impact,
    ],
    marksP37NaturalVentilationStale,
    p37StaleDisclosureNote: marksP37NaturalVentilationStale
      ? 'This proposal modifies physical window geometry; applying it will mark P37 Natural Ventilation scenarios as stale so airflow can be reviewed.'
      : 'Does not alter physical P37 ventilation opening areas.',
    p36AcousticWarnings: afterReport.p36AcousticIntegration.glazingAndNoiseTradeOffWarnings,
    p34AccessibilityPreserved: !p34WarningsAfter,
    p33FurniturePreserved: true,
    p30AndP32Preserved: true,
    beforeCompleteness: roomBefore?.completenessState || 'insufficient-evidence',
    afterCompleteness: roomAfter?.completenessState || 'insufficient-evidence',
    beforeGlazedToFloorRatioPercent:
      roomBefore?.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent ?? null,
    afterGlazedToFloorRatioPercent:
      roomAfter?.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent ?? null,
    beforeMeanDaylightFactorPercent:
      roomBefore?.modeC_SimplifiedDaylight.meanDaylightFactorPercent ?? null,
    afterMeanDaylightFactorPercent:
      roomAfter?.modeC_SimplifiedDaylight.meanDaylightFactorPercent ?? null,
    beforeDirectSunCoveragePercent:
      roomBefore?.modeB_SolarAndShading.workPlaneDirectSunCoveragePercent ?? null,
    afterDirectSunCoveragePercent:
      roomAfter?.modeB_SolarAndShading.workPlaneDirectSunCoveragePercent ?? null,
    beforeGlareRisk:
      roomBefore?.modeE_VisualComfortGlareView.qualitativeGlareRiskLevel ||
      'insufficient-evidence',
    afterGlareRisk:
      roomAfter?.modeE_VisualComfortGlareView.qualitativeGlareRiskLevel ||
      'insufficient-evidence',
    fieldChanges,
    proposedProjectClone: clonedProject as unknown as Record<string, unknown>,
  };
}

/**
 * Atomically applies a previewed P38 daylight proposal after creating a pre-apply snapshot checkpoint.
 * Rejects stale previews if the underlying project changed since the preview was generated.
 */
export function applyDaylightProposalAtomically(
  currentProject: Project,
  previewDiff: DaylightProposalPreviewDiff
): {
  applied: boolean;
  updatedProject: Project;
  snapshotId: string | null;
  evaluationReport: DaylightComfortProjectEvaluationReport;
  message: string;
} {
  const liveFingerprint = computeDaylightComfortSourceFingerprint(currentProject);

  if (previewDiff.sourceFingerprintAtPreview !== liveFingerprint) {
    const liveReport = evaluateProjectDaylightComfort(currentProject);
    return {
      applied: false,
      updatedProject: currentProject,
      snapshotId: null,
      evaluationReport: liveReport,
      message:
        'Stale preview rejected: underlying room geometry, windows, optical properties, or scenario inputs changed since this preview was generated. Please regenerate the preview before applying.',
    };
  }

  if (!previewDiff.isSafeToApply) {
    const liveReport = evaluateProjectDaylightComfort(currentProject);
    return {
      applied: false,
      updatedProject: currentProject,
      snapshotId: null,
      evaluationReport: liveReport,
      message: `Cannot apply proposal: ${previewDiff.blockingReasons.join('; ')}`,
    };
  }

  let snapshotId = `p38-snap-${Date.now()}`;
  try {
    const snap = createProjectSnapshot(currentProject, {
      trigger: 'auto-checkpoint',
      label: `Pre-P38 Daylight & Visual Comfort Apply: ${previewDiff.title}`,
      description: `Automatic checkpoint before applying P38 proposal "${previewDiff.title}" on room "${previewDiff.roomName}".`,
    });
    if (snap && snap.id) {
      snapshotId = snap.id;
    }
  } catch {
    // Fallback for headless Node test environment
  }
  memoryDaylightSnapshots.set(snapshotId, JSON.parse(JSON.stringify(currentProject)));

  const updatedProject: Project = JSON.parse(
    JSON.stringify(previewDiff.proposedProjectClone)
  ) as Project;
  const dData = initializeProjectDaylightComfortData(updatedProject);
  dData.isConfigured = true;
  dData.lastPreApplySnapshotId = snapshotId;
  dData.requestSequenceId = (dData.requestSequenceId || 1) + 1;
  dData.lastEvaluatedAt = new Date().toISOString();
  dData.lastSourceFingerprint = computeDaylightComfortSourceFingerprint(updatedProject, dData);
  updatedProject.daylightComfort = dData;
  updatedProject.updatedAt = new Date().toISOString();

  const evaluationReport = evaluateProjectDaylightComfort(updatedProject);

  return {
    applied: true,
    updatedProject,
    snapshotId,
    evaluationReport,
    message: `Applied P38 Daylight & Visual Comfort change "${previewDiff.title}" with snapshot checkpoint (${snapshotId}).`,
  };
}

/**
 * Rolls back the project to the last pre-P38-apply snapshot checkpoint.
 */
export function rollbackLastDaylightApply(
  currentProject: Project
): {
  rolledBack: boolean;
  restoredProject: Project;
  message: string;
} {
  const snapshotId = currentProject.daylightComfort?.lastPreApplySnapshotId;
  if (!snapshotId) {
    return {
      rolledBack: false,
      restoredProject: currentProject,
      message: 'No pre-apply P38 snapshot ID is recorded on this project.',
    };
  }

  const memSnap = memoryDaylightSnapshots.get(snapshotId);
  if (memSnap) {
    const restored: Project = JSON.parse(JSON.stringify(memSnap));
    return {
      rolledBack: true,
      restoredProject: restored,
      message: `Successfully rolled back project to pre-P38 snapshot (${snapshotId}).`,
    };
  }

  try {
    const snapshots = getProjectSnapshots(currentProject);
    const found = snapshots.find((s) => s.id === snapshotId);
    if (found) {
      const restoreRes = executeSafeRestore(currentProject, found);
      if (restoreRes.success && restoreRes.restoredProject) {
        return {
          rolledBack: true,
          restoredProject: restoreRes.restoredProject,
          message: `Successfully rolled back project to pre-P38 snapshot (${snapshotId}).`,
        };
      }
    }
  } catch {
    // ignore
  }

  return {
    rolledBack: false,
    restoredProject: currentProject,
    message: `Could not locate snapshot "${snapshotId}" in storage.`,
  };
}
