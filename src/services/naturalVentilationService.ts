/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P37 — Natural Ventilation Scenario Analyzer Service
 * Account A | Locked Roadmap: P37 of P30–P40
 *
 * Deterministic, unit-safe, provenance-aware natural ventilation calculation,
 * airflow-path screening, and scenario comparison engine:
 * - Room geometry validation & SI unit conversion (m, m², m³)
 * - Explicit opening operability, gross vs. clear openable vs. scenario-effective free area (A_eff)
 * - Series orifice conductance ((C_d * A_eff)_series) for multi-opening paths
 * - 2D/3D airflow path discovery: single-sided, cross-ventilation, stack/buoyancy,
 *   combined wind+stack, and internal-transfer-assisted paths
 * - Wind-driven pressure (ΔP_wind = 0.5 * ρ * v² * ΔC_p) and orifice flow
 * - Stack/buoyancy pressure (ΔP_stack = ρ * g * Δh * |T_in - T_out| / T_ref,K) and orifice flow
 * - Quadrature or dominant combination of wind + stack flows (never blind linear addition)
 * - Air Changes Per Hour (ACH = Q * 3600 / V) and L/s per person / L/s per m² screening
 * - Multidisciplinary trade-offs across P30, P31, P32, P33, P34, P35, and P36
 * - Non-destructive preview, checkpointed atomic apply, and safe rollback
 */

import {
  DesignAlternative,
  FloorPlanRoom,
  MeasurementUnit,
  Project,
} from '../types/project';
import {
  AirflowPathRecord,
  ConfiguredVentilationCriterion,
  EnvironmentalConditionScenario,
  EvaluatedOpeningMetricsSI,
  GeometricVentilationPotentialResult,
  NaturalVentilationProjectEvaluationReport,
  NaturalVentilationScenario,
  OpeningBoundaryLocation,
  OpeningMechanismType,
  OpeningOperabilityStatus,
  P37_NATURAL_VENTILATION_ENGINE_VERSION,
  P37_NATURAL_VENTILATION_SCHEMA_VERSION,
  P37OptionVentilationComparisonSummary,
  ProjectNaturalVentilationData,
  QuantifiedAirflowEstimateResult,
  RoomScenarioVentilationEvaluation,
  RoomVentilationConfig,
  RoomVentilationGeometryResult,
  RoomVentilationScenarioComparisonResult,
  ScenarioOpeningState,
  VentilationAssessmentMode,
  VentilationCompletenessState,
  VentilationConstraintAndTradeOffItem,
  VentilationEvaluationStatus,
  VentilationEvidenceProvenance,
  VentilationOpeningCategory,
  VentilationOpeningRecord,
  VentilationProposalPreviewDiff,
  VentilationRecommendation,
  VentilationSourceMetadata,
  VentilationStrategyClassification,
  WallCardinalEdge,
} from '../types/naturalVentilation';
import { initializeProjectBrief } from './briefService';
import { extractComparableOptions } from './designComparisonService';
import { initializePersonalizationProfile } from './designPersonalizationService';
import { ensureProjectFurnitureLayoutData } from './furnitureIntelligenceService';
import {
  BUILTIN_CLIMATE_MATERIAL_CATALOGUE,
  initializeProjectMaterialAdvisorData,
} from './climateMaterialAdvisorService';
import { initializeProjectAcousticPlannerData } from './acousticComfortService';
import {
  createProjectSnapshot,
  executeSafeRestore,
  getProjectSnapshots,
} from './versioningService';

export {
  P37_NATURAL_VENTILATION_ENGINE_VERSION,
  P37_NATURAL_VENTILATION_SCHEMA_VERSION,
};

export const P37_PROFESSIONAL_DISCLAIMER =
  'Natural Ventilation Scenario Analyzer (P37) provides preliminary architectural airflow-path screening, geometric opening ratios, and simplified steady-state orifice/buoyancy/wind scenario estimates based on user-supplied or scenario-assumed inputs. It does NOT perform Computational Fluid Dynamics (CFD), wind-tunnel testing, dynamic annual thermal/energy simulation, contaminant dispersion modeling, or statutory building-code / ASHRAE 62.1 / 62.2 compliance certification.';

const METRES_PER_FOOT = 0.3048;
const SQ_METRES_PER_SQ_FOOT = 0.09290304;
const GRAVITY_M_PER_S2 = 9.80665;
const KELVIN_OFFSET = 273.15;
const DEFAULT_AIR_DENSITY_KG_M3 = 1.204; // Dry air at 20 °C, 101.325 kPa

/**
 * In-memory snapshot fallback for headless Node.js / CLI verification environments.
 */
const memoryVentilationSnapshots = new Map<string, Project>();

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
 * Converts a linear dimension to metres with strict finite/positive validation.
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
 * Converts a non-negative elevation (which may be 0.0 m at floor level) to metres.
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
 * Converts an area in `unit` squared (sq ft or m²) to square metres (m²).
 */
export function convertAreaToSquareMetres(
  area: number | null | undefined,
  unit: MeasurementUnit
): number | null {
  if (
    area === null ||
    area === undefined ||
    typeof valueIsFiniteNonNegative(area) !== 'number'
  ) {
    return null;
  }
  return unit === 'feet' ? area * SQ_METRES_PER_SQ_FOOT : area;
}

function valueIsFiniteNonNegative(v: number | null | undefined): number | null {
  if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
    return null;
  }
  return v;
}

/**
 * Auditable public technical reference metadata per P37 Section 18.
 * Never reproduces copyrighted standard tables or claims automatic code certification.
 */
export const P37_TECHNICAL_REFERENCES: Record<string, VentilationSourceMetadata> = {
  ASHRAE_FUNDAMENTALS_CH16: {
    sourceId: 'ashrae-fundamentals-ch16-ventilation-infiltration',
    publisher: 'ASHRAE',
    title: 'ASHRAE Handbook — Fundamentals, Chapter 16: Ventilation and Infiltration',
    editionOrYear: '2025',
    urlOrIdentifier: 'https://www.ashrae.org/technical-resources/ashrae-handbook',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Provides fundamental physical equations for orifice airflow (Q = C_d * A * sqrt(2*ΔP/ρ)), wind-induced surface pressure (ΔP_w = 0.5*ρ*v²*ΔC_p), hydrostatic stack buoyancy pressure, and quadrature combination of wind and stack driving forces.',
    licenceOrUsageNote: 'Public physical formulas and bibliographic metadata only; no proprietary tables reproduced.',
  },
  ASHRAE_62_1_SCOPE_REF: {
    sourceId: 'ashrae-62-1-scope-reference',
    publisher: 'ASHRAE',
    title: 'ANSI/ASHRAE Standard 62.1 — Ventilation and Acceptable Indoor Air Quality',
    editionOrYear: '2022 / 2025',
    urlOrIdentifier: 'https://www.ashrae.org/technical-resources/bookstore/standards-62-1-62-2',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Defines minimum ventilation rates and natural ventilation procedure prerequisites in commercial/institutional spaces. Preliminary ACH or opening-to-floor ratios in P37 are screening indicators and do NOT establish ASHRAE 62.1 compliance.',
    licenceOrUsageNote: 'Scope boundary reference only.',
  },
  ASHRAE_62_2_SCOPE_REF: {
    sourceId: 'ashrae-62-2-scope-reference',
    publisher: 'ASHRAE',
    title: 'ANSI/ASHRAE Standard 62.2 — Ventilation and Acceptable Indoor Air Quality in Residential Buildings',
    editionOrYear: '2022 / 2025',
    urlOrIdentifier: 'https://www.ashrae.org/technical-resources/bookstore/standards-62-1-62-2',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Defines residential dwelling mechanical and infiltration/natural ventilation requirements. Operable windows alone do not automatically satisfy continuous residential IAQ requirements under ASHRAE 62.2.',
    licenceOrUsageNote: 'Scope boundary reference only.',
  },
  CIBSE_AM10_NAT_VENT: {
    sourceId: 'cibse-am10-natural-ventilation',
    publisher: 'Chartered Institution of Building Services Engineers (CIBSE)',
    title: 'CIBSE Applications Manual AM10: Natural Ventilation in Non-Domestic Buildings',
    editionOrYear: '2005 (Reprinted / Current Guidance)',
    urlOrIdentifier: 'https://www.cibse.org/knowledge-research/knowledge-portal/applications-manual-10-natural-ventilation-in-non-domestic-buildings-2005',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Provides early-stage geometric depth-to-height screening heuristics (e.g. single-sided plan depth L <= 2.5*H; cross-ventilation plan depth L <= 5*H) and series opening conductance formulations.',
    licenceOrUsageNote: 'Bibliographic citation and standard dimensional ratios only.',
  },
  ISO_17772_1_IEQ: {
    sourceId: 'iso-17772-1-2017',
    publisher: 'International Organization for Standardization (ISO)',
    title: 'ISO 17772-1:2017 Energy performance of buildings — Indoor environmental quality — Part 1: Indoor environmental input parameters',
    editionOrYear: '2017',
    urlOrIdentifier: 'https://www.iso.org/standard/60498.html',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Provides general indoor environmental quality screening categories for ventilation airflow per person and per floor area.',
    licenceOrUsageNote: 'Metadata citation only.',
  },
};

/**
 * Default configurable ventilation screening criteria per P37 Section 7 Domain E & Section 9.
 * Explicitly labeled as 'advisory-reference' — never claimed as statutory pass/fail rules.
 */
export const DEFAULT_VENTILATION_CRITERIA: ConfiguredVentilationCriterion[] = [
  {
    criterionId: 'crit-openable-floor-area-ratio',
    metric: 'openable-area-to-floor-area-percent',
    label: 'Preliminary Openable Area to Room Floor Area Ratio',
    minTarget: 4.0,
    maxAdvisoryTarget: 10.0,
    unit: '%',
    purposeScope: 'architectural-geometric-screening',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Early-Stage Architectural Screening Heuristic (Common 4%–5% Reference)',
    applicabilityConditions:
      'Compares net clear openable exterior opening area against habitable room floor area. Does NOT prove airflow rate, thermal comfort, or statutory building-code compliance.',
    versionOrDate: '2026.1',
    provenance: 'traceable-technical-reference',
    sourceMetadata: P37_TECHNICAL_REFERENCES.CIBSE_AM10_NAT_VENT,
    nonComplianceGuaranteeNote:
      'Meeting a 4% or 5% openable-to-floor-area ratio is a geometric screening indicator only; actual statutory compliance depends on local building codes and ASHRAE 62.1/62.2 procedures.',
  },
  {
    criterionId: 'crit-preliminary-ach-comfort',
    metric: 'preliminary-air-changes-per-hour-ach',
    label: 'Preliminary Scenario Air Change Rate (Comfort / Purge Screening)',
    minTarget: 3.0,
    maxAdvisoryTarget: 15.0,
    unit: 'ACH (h⁻¹)',
    purposeScope: 'comfort-cooling-or-purge',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Preliminary Passive Cooling & Purge Screening Range (CIBSE AM10 / ASHRAE Ch. 16)',
    applicabilityConditions:
      'Applies only when room ceiling height (volume V) and driving pressures (wind speed or stack ΔT and Δh) are explicitly defined for the scenario.',
    versionOrDate: '2026.1',
    provenance: 'traceable-technical-reference',
    sourceMetadata: P37_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH16,
    nonComplianceGuaranteeNote:
      'Scenario ACH reflects simplified steady-state orifice equations under the assumed boundary conditions; it is not a dynamic annual simulation or code certification.',
  },
  {
    criterionId: 'crit-outdoor-air-per-person',
    metric: 'outdoor-airflow-per-person-lps',
    label: 'Preliminary Outdoor Airflow per Occupant',
    minTarget: 7.5,
    maxAdvisoryTarget: 20.0,
    unit: 'L/(s·person)',
    purposeScope: 'background-iaq-ventilation',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Advisory IAQ Screening Benchmark (ISO 17772-1 / ASHRAE Reference Context)',
    applicabilityConditions:
      'Requires both a quantified preliminary scenario airflow rate Q (L/s) and a declared room occupancy count > 0.',
    versionOrDate: '2026.1',
    provenance: 'traceable-technical-reference',
    sourceMetadata: P37_TECHNICAL_REFERENCES.ISO_17772_1_IEQ,
    nonComplianceGuaranteeNote:
      'Does not establish ASHRAE 62.1 or 62.2 compliance, which requires zone air distribution effectiveness, breathing-zone calculations, and outdoor air quality verification.',
  },
  {
    criterionId: 'crit-outdoor-air-per-m2',
    metric: 'outdoor-airflow-per-floor-area-lps-m2',
    label: 'Preliminary Outdoor Airflow per Unit Floor Area',
    minTarget: 0.6,
    maxAdvisoryTarget: 3.0,
    unit: 'L/(s·m²)',
    purposeScope: 'background-iaq-ventilation',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Advisory Per-Area Ventilation Screening Benchmark',
    applicabilityConditions:
      'Requires a quantified preliminary scenario airflow rate Q (L/s) and valid room floor area (m²).',
    versionOrDate: '2026.1',
    provenance: 'traceable-technical-reference',
    sourceMetadata: P37_TECHNICAL_REFERENCES.ISO_17772_1_IEQ,
    nonComplianceGuaranteeNote:
      'Advisory screening metric only; does not replace statutory mechanical or natural ventilation code tables.',
  },
];

/**
 * Default starter scenarios for P37 so users can immediately inspect how scenario assumptions
 * (e.g. calm wind vs. moderate breeze, internal doors closed vs. open, daytime vs. night purge)
 * change airflow paths and preliminary estimates, while keeping provenance 100% explicit.
 */
export function createDefaultVentilationScenarios(): NaturalVentilationScenario[] {
  return [
    {
      scenarioId: 'scen-baseline-moderate-breeze',
      name: 'Scenario 1 — Baseline Daytime Breeze (Scenario Assumption)',
      description:
        'Exploratory daytime scenario assuming a light-to-moderate breeze (2.5 m/s from South-West / 225°), mild temperature differential (T_in = 24 °C, T_out = 21 °C), and default opening states.',
      isBaseline: true,
      environmentalConditions: {
        conditionId: 'env-baseline-breeze',
        label: 'Light Breeze & Mild ΔT (Exploratory Scenario Assumption)',
        description:
          'Explicit scenario assumption for preliminary airflow-path and orifice screening. Not derived from live weather or site meteorological stations.',
        provenance: 'scenario-assumption',
        windSpeedMetresPerSec: 2.5,
        windSpeedProvenance: 'scenario-assumption',
        windDirectionDegFromNorth: 225, // SW wind
        windDirectionProvenance: 'scenario-assumption',
        assumedDeltaCp: 0.65,
        deltaCpProvenance: 'scenario-assumption',
        shelterAndExposureAssumptionNote:
          'Assumes suburban low-rise sheltered exposure (nominal windward-to-leeward ΔC_p ≈ 0.65 at normal incidence; scaled by cos(θ) for oblique wind angles).',
        outdoorTempCelsius: 21.0,
        indoorTempCelsius: 24.0,
        temperatureProvenance: 'scenario-assumption',
        outdoorRelativeHumidityPercent: 55,
        humidityProvenance: 'scenario-assumption',
        airDensityKgPerM3: DEFAULT_AIR_DENSITY_KG_M3,
        airDensityProvenance: 'traceable-technical-reference',
        outdoorNoiseCondition: 'moderate-urban',
        outdoorAirQualityCondition: 'clean-ambient',
        precipitationCondition: 'dry',
        operatingScheduleMode: 'daytime-occupied',
        combinedDrivingForceMethod: 'quadrature-flow-combination',
      },
      openingStateOverrides: {},
      createdAt: '2026-10-26T00:00:00.000Z',
    },
    {
      scenarioId: 'scen-calm-wind-stack-only',
      name: 'Scenario 2 — Calm Wind / Buoyancy Stack Test (v = 0 m/s)',
      description:
        'Tests pure thermal buoyancy (stack effect) under still-air outdoor conditions (v = 0 m/s) with a 6 °C indoor-to-outdoor temperature difference (T_in = 25 °C, T_out = 19 °C).',
      isBaseline: false,
      environmentalConditions: {
        conditionId: 'env-calm-stack',
        label: 'Calm Air / Night-Purge Buoyancy (v = 0 m/s, ΔT = 6 K)',
        description:
          'Zero-wind scenario testing whether vertical separation (Δh) between low-level inlets and high-level outlets supports stack-driven flow.',
        provenance: 'scenario-assumption',
        windSpeedMetresPerSec: 0,
        windSpeedProvenance: 'scenario-assumption',
        windDirectionDegFromNorth: 180,
        windDirectionProvenance: 'scenario-assumption',
        assumedDeltaCp: 0.6,
        deltaCpProvenance: 'scenario-assumption',
        shelterAndExposureAssumptionNote: 'Zero wind speed (v = 0 m/s); wind pressure ΔP_wind = 0 Pa.',
        outdoorTempCelsius: 19.0,
        indoorTempCelsius: 25.0,
        temperatureProvenance: 'scenario-assumption',
        outdoorRelativeHumidityPercent: 60,
        humidityProvenance: 'scenario-assumption',
        airDensityKgPerM3: DEFAULT_AIR_DENSITY_KG_M3,
        airDensityProvenance: 'traceable-technical-reference',
        outdoorNoiseCondition: 'quiet',
        outdoorAirQualityCondition: 'clean-ambient',
        precipitationCondition: 'dry',
        operatingScheduleMode: 'night-purge-cooling',
        combinedDrivingForceMethod: 'quadrature-flow-combination',
      },
      openingStateOverrides: {},
      createdAt: '2026-10-26T00:00:00.000Z',
    },
    {
      scenarioId: 'scen-adverse-heat-rain-noise',
      name: 'Scenario 3 — High Outdoor Heat, Rain & Street Noise Constraint Check',
      description:
        'Tests environmental constraints when outdoor air is hot and humid (34 °C, 80% RH) with wind-driven rain and high street noise.',
      isBaseline: false,
      environmentalConditions: {
        conditionId: 'env-adverse-constraints',
        label: 'Adverse Hot-Humid, Rain & High Street Noise Scenario',
        description:
          'Evaluates when opening windows for natural ventilation introduces overheating, moisture/condensation, rain ingress, or acoustic disturbance.',
        provenance: 'scenario-assumption',
        windSpeedMetresPerSec: 3.5,
        windSpeedProvenance: 'scenario-assumption',
        windDirectionDegFromNorth: 180,
        windDirectionProvenance: 'scenario-assumption',
        assumedDeltaCp: 0.65,
        deltaCpProvenance: 'scenario-assumption',
        shelterAndExposureAssumptionNote: 'Moderate storm breeze with wind-driven rain.',
        outdoorTempCelsius: 34.0,
        indoorTempCelsius: 25.0,
        temperatureProvenance: 'scenario-assumption',
        outdoorRelativeHumidityPercent: 80,
        humidityProvenance: 'scenario-assumption',
        airDensityKgPerM3: 1.15,
        airDensityProvenance: 'scenario-assumption',
        outdoorNoiseCondition: 'high-traffic-or-plant-noise',
        outdoorAirQualityCondition: 'moderate-pollen-or-urban',
        precipitationCondition: 'wind-driven-rain-storm',
        operatingScheduleMode: 'peak-summer-afternoon',
        combinedDrivingForceMethod: 'quadrature-flow-combination',
      },
      openingStateOverrides: {},
      createdAt: '2026-10-26T00:00:00.000Z',
    },
  ];
}

/**
 * Computes the compass azimuth in degrees [0, 360) for a room wall edge,
 * accounting for `project.siteContext.northOrientationOffsetDeg` if configured.
 * Standard 2D plan convention: top = North (0°), right = East (90°), bottom = South (180°), left = West (270°).
 */
export function getWallCompassAzimuthDeg(
  wallEdge: WallCardinalEdge,
  northOffsetDeg: number = 0
): number {
  const baseDeg: Record<WallCardinalEdge, number> = {
    north: 0,
    east: 90,
    south: 180,
    west: 270,
  };
  const raw = (baseDeg[wallEdge] + (Number.isFinite(northOffsetDeg) ? northOffsetDeg : 0)) % 360;
  return raw < 0 ? raw + 360 : raw;
}

/**
 * Computes the acute/obtuse angular difference Δθ in [0, 180] degrees between two azimuth angles.
 */
export function computeAngularDifferenceDeg(azimuthADeg: number, azimuthBDeg: number): number {
  const diff = Math.abs(azimuthADeg - azimuthBDeg) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Determines which walls of a room are exterior envelope walls vs. interior shared walls
 * by inspecting 2D room coordinates on the same floor level.
 */
export function analyzeRoomWallsAndAdjacency(
  room: FloorPlanRoom,
  allRooms: FloorPlanRoom[],
  unit: MeasurementUnit
): {
  exteriorWallEdges: WallCardinalEdge[];
  interiorSharedWalls: Array<{
    wallEdge: WallCardinalEdge;
    neighborRoomId: string;
    neighborRoomName: string;
    neighborRoomType: string;
    sharedLengthMetres: number;
  }>;
} {
  const sameFloorOthers = allRooms.filter(
    (r) => r.id !== room.id && r.floorLevel === room.floorLevel
  );
  const tol = 0.25; // tolerance in plot units for wall contact
  const edges: WallCardinalEdge[] = ['north', 'south', 'east', 'west'];
  const exteriorWallEdges: WallCardinalEdge[] = [];
  const interiorSharedWalls: Array<{
    wallEdge: WallCardinalEdge;
    neighborRoomId: string;
    neighborRoomName: string;
    neighborRoomType: string;
    sharedLengthMetres: number;
  }> = [];

  for (const edge of edges) {
    let coveredLength = 0;
    for (const other of sameFloorOthers) {
      if (edge === 'north') {
        // room's top edge y === other's bottom edge (other.y + other.length)
        if (Math.abs(room.y - (other.y + other.length)) <= tol) {
          const overlapStart = Math.max(room.x, other.x);
          const overlapEnd = Math.min(room.x + room.width, other.x + other.width);
          const overlap = overlapEnd - overlapStart;
          if (overlap > tol) {
            coveredLength += overlap;
            const lenM = convertLengthToMetres(overlap, unit) ?? 0;
            interiorSharedWalls.push({
              wallEdge: 'north',
              neighborRoomId: other.id,
              neighborRoomName: other.name,
              neighborRoomType: other.type,
              sharedLengthMetres: round2(lenM),
            });
          }
        }
      } else if (edge === 'south') {
        // room's bottom edge (room.y + room.length) === other's top edge other.y
        if (Math.abs(room.y + room.length - other.y) <= tol) {
          const overlapStart = Math.max(room.x, other.x);
          const overlapEnd = Math.min(room.x + room.width, other.x + other.width);
          const overlap = overlapEnd - overlapStart;
          if (overlap > tol) {
            coveredLength += overlap;
            const lenM = convertLengthToMetres(overlap, unit) ?? 0;
            interiorSharedWalls.push({
              wallEdge: 'south',
              neighborRoomId: other.id,
              neighborRoomName: other.name,
              neighborRoomType: other.type,
              sharedLengthMetres: round2(lenM),
            });
          }
        }
      } else if (edge === 'west') {
        // room's left edge room.x === other's right edge (other.x + other.width)
        if (Math.abs(room.x - (other.x + other.width)) <= tol) {
          const overlapStart = Math.max(room.y, other.y);
          const overlapEnd = Math.min(room.y + room.length, other.y + other.length);
          const overlap = overlapEnd - overlapStart;
          if (overlap > tol) {
            coveredLength += overlap;
            const lenM = convertLengthToMetres(overlap, unit) ?? 0;
            interiorSharedWalls.push({
              wallEdge: 'west',
              neighborRoomId: other.id,
              neighborRoomName: other.name,
              neighborRoomType: other.type,
              sharedLengthMetres: round2(lenM),
            });
          }
        }
      } else if (edge === 'east') {
        // room's right edge (room.x + room.width) === other's left edge other.x
        if (Math.abs(room.x + room.width - other.x) <= tol) {
          const overlapStart = Math.max(room.y, other.y);
          const overlapEnd = Math.min(room.y + room.length, other.y + other.length);
          const overlap = overlapEnd - overlapStart;
          if (overlap > tol) {
            coveredLength += overlap;
            const lenM = convertLengthToMetres(overlap, unit) ?? 0;
            interiorSharedWalls.push({
              wallEdge: 'east',
              neighborRoomId: other.id,
              neighborRoomName: other.name,
              neighborRoomType: other.type,
              sharedLengthMetres: round2(lenM),
            });
          }
        }
      }
    }

    const totalEdgeSpan = edge === 'north' || edge === 'south' ? room.width : room.length;
    // If at least 25% of the wall is not blocked by an adjacent indoor room, it has exterior envelope exposure
    if (totalEdgeSpan - coveredLength > Math.max(tol, totalEdgeSpan * 0.25)) {
      exteriorWallEdges.push(edge);
    }
  }

  return { exteriorWallEdges, interiorSharedWalls };
}

/**
 * Synchronizes P33 `KnownRoomOpening` records into P37 `VentilationOpeningRecord` items
 * without fabricating missing height, operability, or free area.
 *
 * CRITICAL P37 RULE (Section 4 & Section 12):
 * P33 `KnownRoomOpening` stores `width` and `wallEdge`, but does NOT store opening height,
 * sill elevation, or whether a window is operable vs. fixed.
 * Therefore, newly synced P33 openings preserve `grossWidth` from P33 and set `grossHeight: null`
 * and `operabilityStatus: 'unknown'` until configured by the user or a scenario mutation.
 */
export function syncOpeningsWithP33(
  project: Project,
  existingP37Openings: VentilationOpeningRecord[]
): VentilationOpeningRecord[] {
  const furnitureData = ensureProjectFurnitureLayoutData(project);
  const p33Openings = furnitureData.knownOpenings || [];
  const rooms = project.floorPlan?.rooms || [];
  const merged = [...existingP37Openings];

  for (const p33Op of p33Openings) {
    const alreadyExists = merged.some(
      (op) => op.linkedP33OpeningId === p33Op.openingId || op.openingId === p33Op.openingId
    );
    if (alreadyExists) continue;

    const room = rooms.find((r) => r.id === p33Op.roomId);
    let boundaryLocation: OpeningBoundaryLocation = 'exterior-envelope';
    let connectedRoomId: string | undefined;

    if (room) {
      const adj = analyzeRoomWallsAndAdjacency(room, rooms, project.unit);
      const sharedOnEdge = adj.interiorSharedWalls.find((w) => w.wallEdge === p33Op.wallEdge);
      if (sharedOnEdge && !adj.exteriorWallEdges.includes(p33Op.wallEdge)) {
        boundaryLocation = 'interior-partition';
        connectedRoomId = sharedOnEdge.neighborRoomId;
      } else if (p33Op.type === 'open-passage') {
        boundaryLocation = 'interior-partition';
        connectedRoomId = sharedOnEdge?.neighborRoomId;
      }
    }

    const category: VentilationOpeningCategory =
      p33Op.type === 'window'
        ? 'window'
        : p33Op.type === 'open-passage'
        ? 'internal-transfer-opening'
        : 'door';

    merged.push({
      openingId: `p37-sync-${p33Op.openingId}`,
      roomId: p33Op.roomId,
      connectedRoomId,
      linkedP33OpeningId: p33Op.openingId,
      label: p33Op.label || `${p33Op.wallEdge.toUpperCase()} ${p33Op.type}`,
      category,
      boundaryLocation,
      wallEdge: p33Op.wallEdge,
      floorLevel: p33Op.floorLevel,
      operabilityStatus: p33Op.type === 'open-passage' ? 'operable' : 'unknown',
      operabilityProvenance:
        p33Op.type === 'open-passage' ? 'derived-from-project-geometry' : 'unavailable-or-unverified',
      mechanismType:
        p33Op.type === 'open-passage'
          ? 'transfer-grille-or-undercut'
          : p33Op.type === 'door'
          ? 'hinged-door'
          : 'unknown',
      grossWidth: p33Op.width,
      grossHeight: null, // Never fabricated from P33 2D width!
      dimensionUnit: project.unit,
      dimensionProvenance: 'derived-from-project-geometry',
      explicitClearOpenableAreaInUnitSq: null,
      maxOpenableFraction: p33Op.type === 'open-passage' ? 1.0 : null,
      openableFractionProvenance:
        p33Op.type === 'open-passage' ? 'derived-from-project-geometry' : 'unavailable-or-unverified',
      screenOrGrilleFactor: 1.0,
      obstructionFactor: 1.0,
      sillElevation: p33Op.type === 'door' || p33Op.type === 'open-passage' ? 0 : null,
      headElevation: null,
      elevationProvenance:
        p33Op.type === 'door' || p33Op.type === 'open-passage'
          ? 'derived-from-project-geometry'
          : 'unavailable-or-unverified',
      dischargeCoefficientCd: null,
      cdProvenance: 'unavailable-or-unverified',
      defaultScenarioState: p33Op.type === 'open-passage' ? 'fully-open' : 'closed',
      defaultScenarioOpenFraction: p33Op.type === 'open-passage' ? 1.0 : 0.0,
      rainProtectionKind: 'unprotected-direct-exposure',
      hasSecurityRestrictorOrNightLatch: false,
      notes: 'Synchronized from P33 2D opening record. Specify height, operability, and C_d to enable quantified orifice airflow estimates.',
    });
  }

  return merged;
}

/**
 * Initializes or normalizes `ProjectNaturalVentilationData` on a project without mutating input state.
 * Also reuses verified/user-entered ceiling heights from P36 (`project.acousticPlanner`) when available
 * so the user does not have to re-enter room heights, while preserving exact provenance.
 */
export function initializeProjectNaturalVentilationData(
  project: Project
): ProjectNaturalVentilationData {
  const rooms = project.floorPlan?.rooms || [];
  const existing = project.naturalVentilation;
  const p36Data = project.acousticPlanner;
  const briefData = project.brief;

  const roomConfigs: Record<string, RoomVentilationConfig> = {
    ...(existing?.roomConfigs || {}),
  };

  for (const room of rooms) {
    if (!roomConfigs[room.id]) {
      const p36RoomCfg = p36Data?.roomConfigs?.[room.id];
      const briefSpace = briefData?.spaces?.find(
        (s) =>
          s.name.toLowerCase() === room.name.toLowerCase() ||
          room.name.toLowerCase().includes(s.name.toLowerCase())
      );

      let ceilingHeight: number | null = null;
      let heightUnit: MeasurementUnit = project.unit;
      let ceilingHeightProvenance: VentilationEvidenceProvenance = 'unavailable-or-unverified';

      if (
        p36RoomCfg &&
        p36RoomCfg.ceilingHeight !== null &&
        Number.isFinite(p36RoomCfg.ceilingHeight) &&
        p36RoomCfg.ceilingHeight > 0
      ) {
        ceilingHeight = p36RoomCfg.ceilingHeight;
        heightUnit = p36RoomCfg.heightUnit || project.unit;
        ceilingHeightProvenance =
          p36RoomCfg.ceilingHeightProvenance === 'measured-on-site'
            ? 'measured-or-manufacturer-verified'
            : p36RoomCfg.ceilingHeightProvenance === 'user-entered'
            ? 'user-entered'
            : 'scenario-assumption';
      }

      let occupancyCountAssumption: number | null = null;
      let occupancyProvenance: VentilationEvidenceProvenance = 'unavailable-or-unverified';
      if (
        p36RoomCfg &&
        p36RoomCfg.occupantCountAssumption !== null &&
        p36RoomCfg.occupantCountAssumption > 0
      ) {
        occupancyCountAssumption = p36RoomCfg.occupantCountAssumption;
        occupancyProvenance = 'user-entered';
      } else if (
        briefSpace &&
        typeof briefSpace.occupantCapacity === 'number' &&
        briefSpace.occupantCapacity > 0
      ) {
        occupancyCountAssumption = briefSpace.occupantCapacity;
        occupancyProvenance =
          briefData?.approvalStatus === 'client-approved' || briefData?.approvalStatus === 'locked'
            ? 'user-entered'
            : 'scenario-assumption';
      }

      roomConfigs[room.id] = {
        roomId: room.id,
        ceilingHeight,
        heightUnit,
        ceilingHeightProvenance,
        occupancyCountAssumption,
        occupancyProvenance,
        hasVerticalAtriumOrStackConnection: false,
        verticalStackOutletElevationMetres: null,
        verticalStackOutletFreeAreaM2: null,
        updatedAt: existing?.lastEvaluatedAt || '2026-10-26T00:00:00.000Z',
      };
    }
  }

  const syncedOpenings = syncOpeningsWithP33(project, existing?.openings || []);
  const scenarios =
    existing?.scenarios && existing.scenarios.length > 0
      ? existing.scenarios
      : createDefaultVentilationScenarios();

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
    schemaVersion: P37_NATURAL_VENTILATION_SCHEMA_VERSION,
    calculationModelVersion: P37_NATURAL_VENTILATION_ENGINE_VERSION,
    isConfigured: Boolean(existing?.isConfigured),
    selectedRoomId,
    activeScenarioId,
    comparisonScenarioId,
    roomConfigs,
    openings: syncedOpenings,
    scenarios,
    customCriteriaOverrides: existing?.customCriteriaOverrides || [],
    lastEvaluatedAt: existing?.lastEvaluatedAt,
    lastSourceFingerprint: existing?.lastSourceFingerprint,
    lastPreApplySnapshotId: existing?.lastPreApplySnapshotId,
    requestSequenceId: existing?.requestSequenceId ?? 1,
  };
}

/**
 * Computes a deterministic fingerprint over all project, room, opening, and scenario inputs
 * that affect P37 natural ventilation evaluations.
 */
export function computeNaturalVentilationSourceFingerprint(
  project: Project,
  nvData?: ProjectNaturalVentilationData
): string {
  const data = nvData || initializeProjectNaturalVentilationData(project);
  const roomsPart = (project.floorPlan?.rooms || [])
    .map(
      (r) =>
        `${r.id}:${r.name}:${r.type}:${r.floorLevel}:${r.x}:${r.y}:${r.width}:${r.length}`
    )
    .join('|');
  const cfgPart = Object.values(data.roomConfigs)
    .sort((a, b) => a.roomId.localeCompare(b.roomId))
    .map(
      (c) =>
        `${c.roomId}:h=${c.ceilingHeight ?? 'null'}(${c.heightUnit},${c.ceilingHeightProvenance}):occ=${c.occupancyCountAssumption ?? 'null'}:stack=${c.hasVerticalAtriumOrStackConnection},${c.verticalStackOutletElevationMetres ?? 'null'},${c.verticalStackOutletFreeAreaM2 ?? 'null'}`
    )
    .join('|');
  const openingsPart = [...data.openings]
    .sort((a, b) => a.openingId.localeCompare(b.openingId))
    .map(
      (o) =>
        `${o.openingId}:${o.roomId}:${o.connectedRoomId ?? ''}:${o.category}:${o.boundaryLocation}:${o.wallEdge}:${o.operabilityStatus}:${o.mechanismType}:w=${o.grossWidth ?? 'null'}:h=${o.grossHeight ?? 'null'}:expA=${o.explicitClearOpenableAreaInUnitSq ?? 'null'}:frac=${o.maxOpenableFraction ?? 'null'}:scr=${o.screenOrGrilleFactor}:obs=${o.obstructionFactor}:sill=${o.sillElevation ?? 'null'}:cd=${o.dischargeCoefficientCd ?? 'null'}:st=${o.defaultScenarioState}:${o.defaultScenarioOpenFraction}`
    )
    .join('|');
  const scenPart = data.scenarios
    .map(
      (s) =>
        `${s.scenarioId}:${s.environmentalConditions.windSpeedMetresPerSec ?? 'null'}:${s.environmentalConditions.windDirectionDegFromNorth ?? 'null'}:${s.environmentalConditions.assumedDeltaCp ?? 'null'}:${s.environmentalConditions.outdoorTempCelsius ?? 'null'}:${s.environmentalConditions.indoorTempCelsius ?? 'null'}:${s.environmentalConditions.combinedDrivingForceMethod}:${JSON.stringify(s.openingStateOverrides)}`
    )
    .join('|');
  const northOffset = project.siteContext?.northOrientationOffsetDeg ?? 0;

  return `p37-fp::u=${project.unit}::n=${northOffset}::active=${data.activeScenarioId}::cmp=${data.comparisonScenarioId ?? ''}::rooms=[${roomsPart}]::cfg=[${cfgPart}]::openings=[${openingsPart}]::scen=[${scenPart}]`;
}

/**
 * Validates room geometry and computes floor area, volume (when ceiling height is present),
 * exterior facade exposures, and shared interior walls in SI units.
 */
export function evaluateRoomVentilationGeometry(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomVentilationConfig,
  allOpenings: VentilationOpeningRecord[],
  scenario: NaturalVentilationScenario
): RoomVentilationGeometryResult {
  const validationIssues: string[] = [];
  const missingGeometryDisclosures: string[] = [];

  const widthMetres = convertLengthToMetres(room.width, project.unit);
  const lengthMetres = convertLengthToMetres(room.length, project.unit);

  if (widthMetres === null || lengthMetres === null) {
    validationIssues.push(
      `Room "${room.name}" has invalid or non-positive 2D plan dimensions (width=${room.width}, length=${room.length} ${project.unit}).`
    );
  }

  const floorAreaM2 =
    widthMetres !== null && lengthMetres !== null ? round2(widthMetres * lengthMetres) : null;

  const ceilingHeightMetres = convertLengthToMetres(
    roomConfig.ceilingHeight,
    roomConfig.heightUnit || project.unit
  );

  if (ceilingHeightMetres === null) {
    missingGeometryDisclosures.push(
      `Ceiling height for "${room.name}" is not yet specified (2D floor-plan rooms store width and length only). Room volume V (m³) and Air Changes Per Hour (ACH) are withheld until ceiling height is entered.`
    );
  }

  const roomVolumeM3 =
    floorAreaM2 !== null && ceilingHeightMetres !== null
      ? round2(floorAreaM2 * ceilingHeightMetres)
      : null;

  const northOrientationOffsetDeg = project.siteContext?.northOrientationOffsetDeg ?? 0;
  const allRooms = project.floorPlan?.rooms || [];
  const { exteriorWallEdges, interiorSharedWalls: rawShared } = analyzeRoomWallsAndAdjacency(
    room,
    allRooms,
    project.unit
  );

  if (exteriorWallEdges.length === 0) {
    missingGeometryDisclosures.push(
      `Room "${room.name}" is an internal room with 0 direct exterior facade walls on the 2D floor plan; natural ventilation requires internal transfer openings or vertical stack shafts.`
    );
  }

  const roomOpenings = allOpenings.filter((o) => o.roomId === room.id || o.connectedRoomId === room.id);

  const interiorSharedWalls = rawShared.map((sw) => {
    const matchingOpenings = roomOpenings.filter(
      (o) =>
        o.boundaryLocation === 'interior-partition' &&
        ((o.roomId === room.id && o.wallEdge === sw.wallEdge) ||
          o.connectedRoomId === sw.neighborRoomId ||
          o.roomId === sw.neighborRoomId)
    );
    const hasInternalOpening = matchingOpenings.length > 0;
    const hasOperableOpenTransferInScenario = matchingOpenings.some((o) => {
      if (o.operabilityStatus !== 'operable') return false;
      const override = scenario.openingStateOverrides[o.openingId];
      const state = override ? override.state : o.defaultScenarioState;
      const frac = override ? override.openFraction : o.defaultScenarioOpenFraction;
      return state !== 'closed' && frac > 0;
    });

    return {
      ...sw,
      hasInternalOpening,
      hasOperableOpenTransferInScenario,
    };
  });

  const hasOppositeExteriorFacades =
    (exteriorWallEdges.includes('north') && exteriorWallEdges.includes('south')) ||
    (exteriorWallEdges.includes('east') && exteriorWallEdges.includes('west'));

  const hasAdjacentCornerExteriorFacades =
    (exteriorWallEdges.includes('north') || exteriorWallEdges.includes('south')) &&
    (exteriorWallEdges.includes('east') || exteriorWallEdges.includes('west'));

  return {
    roomId: room.id,
    roomName: room.name,
    roomType: room.type,
    floorLevel: room.floorLevel,
    projectUnit: project.unit,
    widthMetres: widthMetres !== null ? round2(widthMetres) : null,
    lengthMetres: lengthMetres !== null ? round2(lengthMetres) : null,
    ceilingHeightMetres: ceilingHeightMetres !== null ? round2(ceilingHeightMetres) : null,
    ceilingHeightProvenance: roomConfig.ceilingHeightProvenance,
    floorAreaM2,
    roomVolumeM3,
    isVolumeValid: roomVolumeM3 !== null && roomVolumeM3 > 0,
    northOrientationOffsetDeg,
    exteriorWallEdges,
    interiorSharedWalls,
    exteriorFacadeCount: exteriorWallEdges.length,
    hasOppositeExteriorFacades,
    hasAdjacentCornerExteriorFacades,
    validationIssues,
    missingGeometryDisclosures,
  };
}

/**
 * Evaluates a single `VentilationOpeningRecord` in SI units for the active scenario,
 * enforcing strict distinction between gross area, max openable area, and effective scenario free area (A_eff).
 */
export function evaluateOpeningForScenarioSI(
  project: Project,
  room: FloorPlanRoom,
  roomGeometry: RoomVentilationGeometryResult,
  opening: VentilationOpeningRecord,
  scenario: NaturalVentilationScenario
): EvaluatedOpeningMetricsSI {
  const missingDataDisclosures: string[] = [];
  const compassAzimuthDeg = getWallCompassAzimuthDeg(
    opening.wallEdge,
    roomGeometry.northOrientationOffsetDeg
  );

  const override = scenario.openingStateOverrides[opening.openingId];
  const scenarioState: ScenarioOpeningState = override
    ? override.state
    : opening.defaultScenarioState;
  const rawFraction = override ? override.openFraction : opening.defaultScenarioOpenFraction;
  const scenarioOpenFraction =
    scenarioState === 'closed'
      ? 0
      : scenarioState === 'fully-open'
      ? 1.0
      : Math.max(0, Math.min(1, Number.isFinite(rawFraction) ? rawFraction : 0.5));

  const grossWidthMetres = convertLengthToMetres(opening.grossWidth, opening.dimensionUnit);
  const grossHeightMetres = convertLengthToMetres(opening.grossHeight, opening.dimensionUnit);

  if (grossWidthMetres === null) {
    missingDataDisclosures.push(`Opening "${opening.label}" is missing a valid gross width.`);
  }
  if (grossHeightMetres === null && opening.explicitClearOpenableAreaInUnitSq === null) {
    missingDataDisclosures.push(
      `Opening "${opening.label}" has no specified opening height (2D plan defines width only). Specify opening height or explicit clear openable area to compute opening area (m²).`
    );
  }

  const grossAreaM2 =
    grossWidthMetres !== null && grossHeightMetres !== null
      ? round3(grossWidthMetres * grossHeightMetres)
      : null;

  // Check P33 furniture obstruction near this wall
  const furnitureData = project.furnitureLayout;
  const roomFurniture = (furnitureData?.instances || []).filter(
    (f) => f.roomId === room.id && f.floorLevel === room.floorLevel
  );
  let p33FurnitureObstructionDetected = false;
  let p33ObstructionDetail: string | undefined;

  for (const item of roomFurniture) {
    const distThreshold = item.unit === 'feet' ? 1.5 : 0.45;
    if (opening.wallEdge === 'north' && Math.abs(item.y - room.y) <= distThreshold) {
      p33FurnitureObstructionDetected = true;
      p33ObstructionDetail = `Placed furniture "${item.name}" is within ${distThreshold} ${item.unit} of the North wall where "${opening.label}" is located.`;
    } else if (
      opening.wallEdge === 'south' &&
      Math.abs(item.y + item.depth - (room.y + room.length)) <= distThreshold
    ) {
      p33FurnitureObstructionDetected = true;
      p33ObstructionDetail = `Placed furniture "${item.name}" is within ${distThreshold} ${item.unit} of the South wall where "${opening.label}" is located.`;
    } else if (opening.wallEdge === 'west' && Math.abs(item.x - room.x) <= distThreshold) {
      p33FurnitureObstructionDetected = true;
      p33ObstructionDetail = `Placed furniture "${item.name}" is within ${distThreshold} ${item.unit} of the West wall where "${opening.label}" is located.`;
    } else if (
      opening.wallEdge === 'east' &&
      Math.abs(item.x + item.width - (room.x + room.width)) <= distThreshold
    ) {
      p33FurnitureObstructionDetected = true;
      p33ObstructionDetail = `Placed furniture "${item.name}" is within ${distThreshold} ${item.unit} of the East wall where "${opening.label}" is located.`;
    }
  }

  // Max openable area A_openable,max
  let maxOpenableAreaM2: number | null = null;
  if (opening.operabilityStatus === 'fixed') {
    maxOpenableAreaM2 = 0;
  } else if (opening.operabilityStatus === 'unknown') {
    maxOpenableAreaM2 = null;
    missingDataDisclosures.push(
      `Operability status for "${opening.label}" is 'unknown'. P37 never assumes windows or doors are operable from labels alone.`
    );
  } else if (opening.operabilityStatus === 'operable') {
    if (
      opening.explicitClearOpenableAreaInUnitSq !== null &&
      opening.explicitClearOpenableAreaInUnitSq >= 0
    ) {
      maxOpenableAreaM2 = convertAreaToSquareMetres(
        opening.explicitClearOpenableAreaInUnitSq,
        opening.dimensionUnit
      );
    } else if (
      grossAreaM2 !== null &&
      opening.maxOpenableFraction !== null &&
      Number.isFinite(opening.maxOpenableFraction) &&
      opening.maxOpenableFraction >= 0 &&
      opening.maxOpenableFraction <= 1
    ) {
      maxOpenableAreaM2 = round3(grossAreaM2 * opening.maxOpenableFraction);
    } else {
      missingDataDisclosures.push(
        `Operable opening "${opening.label}" requires either an explicit clear openable area or both gross dimensions and an openable mechanism fraction.`
      );
    }
  }

  const screenFactor = Math.max(
    0.1,
    Math.min(1.0, Number.isFinite(opening.screenOrGrilleFactor) ? opening.screenOrGrilleFactor : 1.0)
  );
  const obsFactor = Math.max(
    0.1,
    Math.min(1.0, Number.isFinite(opening.obstructionFactor) ? opening.obstructionFactor : 1.0)
  );

  // Effective free area in the active scenario A_eff
  let effectiveScenarioFreeAreaM2: number | null = null;
  if (opening.operabilityStatus === 'fixed' || scenarioState === 'closed' || scenarioOpenFraction === 0) {
    effectiveScenarioFreeAreaM2 = 0;
  } else if (maxOpenableAreaM2 !== null) {
    effectiveScenarioFreeAreaM2 = round4(
      maxOpenableAreaM2 * scenarioOpenFraction * screenFactor * obsFactor
    );
  }

  // Discharge coefficient C_d
  const validCd =
    opening.dischargeCoefficientCd !== null &&
    Number.isFinite(opening.dischargeCoefficientCd) &&
    opening.dischargeCoefficientCd > 0 &&
    opening.dischargeCoefficientCd <= 1.0
      ? opening.dischargeCoefficientCd
      : null;

  if (
    opening.operabilityStatus === 'operable' &&
    scenarioState !== 'closed' &&
    validCd === null
  ) {
    missingDataDisclosures.push(
      `Discharge coefficient C_d is not specified for "${opening.label}" (typical sharp-edged opening reference is C_d ≈ 0.60–0.65).`
    );
  }

  const cdTimesEffectiveAreaM2 =
    effectiveScenarioFreeAreaM2 !== null && validCd !== null
      ? round4(validCd * effectiveScenarioFreeAreaM2)
      : effectiveScenarioFreeAreaM2 === 0
      ? 0
      : null;

  // Elevations & Centroid
  const sillElevationMetres = convertElevationToMetres(
    opening.sillElevation,
    opening.dimensionUnit
  );
  const explicitHeadMetres = convertElevationToMetres(
    opening.headElevation,
    opening.dimensionUnit
  );
  const headElevationMetres =
    explicitHeadMetres !== null
      ? explicitHeadMetres
      : sillElevationMetres !== null && grossHeightMetres !== null
      ? round2(sillElevationMetres + grossHeightMetres)
      : null;

  const centroidElevationAboveFloorMetres =
    sillElevationMetres !== null && headElevationMetres !== null
      ? round2(0.5 * (sillElevationMetres + headElevationMetres))
      : sillElevationMetres !== null && grossHeightMetres !== null
      ? round2(sillElevationMetres + 0.5 * grossHeightMetres)
      : null;

  const storyHeightDatumM =
    roomGeometry.ceilingHeightMetres !== null && room.floorLevel > 1
      ? (room.floorLevel - 1) * roomGeometry.ceilingHeightMetres
      : room.floorLevel === 1
      ? 0
      : null;

  const absoluteCentroidElevationMetres =
    centroidElevationAboveFloorMetres !== null && storyHeightDatumM !== null
      ? round2(storyHeightDatumM + centroidElevationAboveFloorMetres)
      : null;

  // P34 Accessibility Reach & Clear Width Check
  const reachHeightM =
    opening.hardwareReachHeight !== undefined && opening.hardwareReachHeight !== null
      ? convertElevationToMetres(opening.hardwareReachHeight, opening.dimensionUnit)
      : sillElevationMetres !== null && grossHeightMetres !== null
      ? round2(sillElevationMetres + 0.35 * grossHeightMetres)
      : sillElevationMetres;

  let p34AccessibilityConcernDetected = false;
  let p34AccessibilityDetail: string | undefined;

  if (opening.operabilityStatus === 'operable') {
    if (reachHeightM !== null && (reachHeightM > 1.22 || (opening.category === 'window' && reachHeightM < 0.38))) {
      p34AccessibilityConcernDetected = true;
      p34AccessibilityDetail = `Operable hardware/sill height (${round2(reachHeightM)} m) for "${opening.label}" falls outside accessible reach range (0.38 m – 1.22 m per ADA 308 / ISO 21542). Consider remote/motorized actuators or accessible crank hardware.`;
    } else if (
      opening.category === 'door' &&
      grossWidthMetres !== null &&
      grossWidthMetres < 0.815
    ) {
      p34AccessibilityConcernDetected = true;
      p34AccessibilityDetail = `Doorway "${opening.label}" gross width (${round2(grossWidthMetres)} m) is narrower than standard accessible clear passage width (0.815 m / 32 in).`;
    }
  }

  return {
    openingId: opening.openingId,
    label: opening.label,
    roomId: opening.roomId,
    connectedRoomId: opening.connectedRoomId,
    category: opening.category,
    boundaryLocation: opening.boundaryLocation,
    wallEdge: opening.wallEdge,
    compassAzimuthDeg: round2(compassAzimuthDeg),
    operabilityStatus: opening.operabilityStatus,
    mechanismType: opening.mechanismType,
    scenarioState,
    scenarioOpenFraction: round2(scenarioOpenFraction),
    grossWidthMetres: grossWidthMetres !== null ? round2(grossWidthMetres) : null,
    grossHeightMetres: grossHeightMetres !== null ? round2(grossHeightMetres) : null,
    grossAreaM2,
    maxOpenableAreaM2,
    effectiveScenarioFreeAreaM2,
    dischargeCoefficientCd: validCd,
    cdTimesEffectiveAreaM2,
    sillElevationMetres: sillElevationMetres !== null ? round2(sillElevationMetres) : null,
    headElevationMetres: headElevationMetres !== null ? round2(headElevationMetres) : null,
    centroidElevationAboveFloorMetres,
    absoluteCentroidElevationMetres,
    p33FurnitureObstructionDetected,
    p33ObstructionDetail,
    p34AccessibilityConcernDetected,
    p34AccessibilityDetail,
    missingDataDisclosures,
  };
}

/**
 * Computes effective series orifice conductance (C_d * A_eff)_series in m²
 * for two or three opening groups in series along a single flow path:
 *
 * (C_d * A_eff)_series = 1 / sqrt( sum_k (1 / G_k^2) )
 *
 * where G_k = sum_{i in group k} (C_{d,i} * A_{eff,i}) > 0.
 */
export function computeSeriesOrificeConductanceM2(groupConductancesM2: number[]): number | null {
  if (groupConductancesM2.length === 0) return null;
  for (const g of groupConductancesM2) {
    if (typeof g !== 'number' || !Number.isFinite(g) || g <= 0) {
      return null;
    }
  }
  const invSqSum = groupConductancesM2.reduce((acc, g) => acc + 1 / (g * g), 0);
  if (invSqSum <= 0 || !Number.isFinite(invSqSum)) return null;
  return round4(1 / Math.sqrt(invSqSum));
}

/**
 * Mode B — Discovers and classifies all candidate airflow paths for a room in the active scenario:
 * - Direct cross-ventilation (operable openings on opposite or adjacent exterior facades of the room)
 * - Internal-transfer-assisted cross-ventilation (exterior opening in room -> open internal door/transfer grille -> adjacent room with operable exterior opening on a different facade)
 * - Stack / buoyancy ventilation (low-level inlet + high-level outlet / skylight / atrium stack outlet with Δh >= 0.40 m)
 * - Single-sided ventilation (operable exterior opening(s) on a single facade orientation only)
 * - Blocked / closed paths (when operable openings exist geometrically but are closed in the active scenario, or when internal doors are closed without transfer vents)
 */
export function discoverRoomAirflowPaths(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomVentilationConfig,
  roomGeometry: RoomVentilationGeometryResult,
  roomEvaluatedOpenings: EvaluatedOpeningMetricsSI[],
  allOpenings: VentilationOpeningRecord[],
  scenario: NaturalVentilationScenario
): {
  dominantStrategy: VentilationStrategyClassification;
  paths: AirflowPathRecord[];
} {
  const paths: AirflowPathRecord[] = [];
  const allRooms = project.floorPlan?.rooms || [];

  const roomExteriorOpenings = roomEvaluatedOpenings.filter(
    (o) => o.boundaryLocation === 'exterior-envelope' || o.boundaryLocation === 'roof-or-atrium'
  );
  const roomInternalOpenings = roomEvaluatedOpenings.filter(
    (o) => o.boundaryLocation === 'interior-partition'
  );

  if (roomEvaluatedOpenings.length === 0 && !roomConfig.hasVerticalAtriumOrStackConnection) {
    return {
      dominantStrategy: 'insufficient-geometry-or-opening-data',
      paths: [],
    };
  }

  const activeExteriorOpenings = roomExteriorOpenings.filter(
    (o) =>
      o.operabilityStatus === 'operable' &&
      o.scenarioState !== 'closed' &&
      o.scenarioOpenFraction > 0 &&
      (o.effectiveScenarioFreeAreaM2 === null || o.effectiveScenarioFreeAreaM2 > 0)
  );

  // Check unknown operability
  const unknownExteriorOpenings = roomExteriorOpenings.filter(
    (o) => o.operabilityStatus === 'unknown'
  );

  // 1. Check Direct Cross-Ventilation across distinct exterior facades of the same room
  const activeEdges = Array.from(new Set(activeExteriorOpenings.map((o) => o.wallEdge)));
  if (activeEdges.length >= 2) {
    // Pick the pair of edges with the largest angular separation (preferring opposite 180° over corner 90°)
    let bestPair: [WallCardinalEdge, WallCardinalEdge] = [activeEdges[0], activeEdges[1]];
    let maxAngle = 0;
    for (let i = 0; i < activeEdges.length; i++) {
      for (let j = i + 1; j < activeEdges.length; j++) {
        const azA = getWallCompassAzimuthDeg(activeEdges[i], roomGeometry.northOrientationOffsetDeg);
        const azB = getWallCompassAzimuthDeg(activeEdges[j], roomGeometry.northOrientationOffsetDeg);
        const diff = computeAngularDifferenceDeg(azA, azB);
        if (diff > maxAngle) {
          maxAngle = diff;
          bestPair = [activeEdges[i], activeEdges[j]];
        }
      }
    }

    // Orient inlet vs outlet relative to scenario wind direction if available
    const windDir = scenario.environmentalConditions.windDirectionDegFromNorth ?? 180;
    const az0 = getWallCompassAzimuthDeg(bestPair[0], roomGeometry.northOrientationOffsetDeg);
    const az1 = getWallCompassAzimuthDeg(bestPair[1], roomGeometry.northOrientationOffsetDeg);
    const inc0 = computeAngularDifferenceDeg(windDir, az0);
    const inc1 = computeAngularDifferenceDeg(windDir, az1);
    const inletEdge = inc0 <= inc1 ? bestPair[0] : bestPair[1];
    const outletEdge = inc0 <= inc1 ? bestPair[1] : bestPair[0];

    const inlets = activeExteriorOpenings.filter((o) => o.wallEdge === inletEdge);
    const outlets = activeExteriorOpenings.filter((o) => o.wallEdge === outletEdge);

    const gInlet = inlets.reduce((s, o) => s + (o.cdTimesEffectiveAreaM2 ?? 0), 0);
    const gOutlet = outlets.reduce((s, o) => s + (o.cdTimesEffectiveAreaM2 ?? 0), 0);
    const seriesCdA =
      gInlet > 0 && gOutlet > 0 ? computeSeriesOrificeConductanceM2([gInlet, gOutlet]) : null;

    const spanAlongFlowM =
      inletEdge === 'north' || inletEdge === 'south'
        ? roomGeometry.lengthMetres
        : roomGeometry.widthMetres;
    const depthToHeight =
      spanAlongFlowM !== null &&
      roomGeometry.ceilingHeightMetres !== null &&
      roomGeometry.ceilingHeightMetres > 0
        ? round2(spanAlongFlowM / roomGeometry.ceilingHeightMetres)
        : null;

    const depthStatus =
      depthToHeight === null
        ? 'height-unknown'
        : depthToHeight <= 5.0
        ? 'within-heuristic-limit'
        : 'exceeds-heuristic-limit';

    paths.push({
      pathId: `path-cross-${room.id}-${inletEdge}-${outletEdge}`,
      primaryRoomId: room.id,
      primaryRoomName: room.name,
      strategyType: 'cross-ventilation',
      isPathActiveInScenario: true,
      inletOpeningIds: inlets.map((o) => o.openingId),
      outletOpeningIds: outlets.map((o) => o.openingId),
      intermediateTransferOpeningIds: [],
      traversedRoomIds: [room.id],
      traversedRoomNames: [room.name],
      inletWallEdges: [inletEdge],
      outletWallEdges: [outletEdge],
      facadeAngleDifferenceDeg: maxAngle,
      verticalElevationSeparationMetres: 0,
      flowPathPlanLengthMetres: spanAlongFlowM,
      depthToHeightRatio: depthToHeight,
      depthToHeightScreeningStatus: depthStatus,
      depthToHeightExplanation:
        depthToHeight === null
          ? 'Specify room ceiling height H to check the cross-ventilation plan depth ratio (L <= 5H advisory heuristic per CIBSE AM10).'
          : depthToHeight <= 5.0
          ? `Plan depth ratio L/H = ${depthToHeight} is within the CIBSE AM10 cross-ventilation screening limit (L <= 5.0 H).`
          : `Plan depth ratio L/H = ${depthToHeight} exceeds the CIBSE AM10 cross-ventilation screening heuristic (L <= 5.0 H); central zones may experience reduced airflow distribution.`,
      effectiveSeriesConductanceCdAM2: seriesCdA,
      blockedOrClosedReasons: [],
      conceptualDiagramVectors: [
        {
          fromXMetres: 0.15 * (roomGeometry.widthMetres ?? 4),
          fromYMetres: 0.5 * (roomGeometry.lengthMetres ?? 4),
          toXMetres: 0.85 * (roomGeometry.widthMetres ?? 4),
          toYMetres: 0.5 * (roomGeometry.lengthMetres ?? 4),
          pathKind: 'wind-cross',
          label: `Cross-ventilation (${inletEdge.toUpperCase()} → ${outletEdge.toUpperCase()}, Δθ = ${maxAngle}°)`,
        },
      ],
      explanation: `Direct ${maxAngle === 180 ? 'two-sided opposite' : 'corner adjacent'} cross-ventilation path between ${inletEdge.toUpperCase()} inlet (${inlets.map((i) => i.label).join(', ')}) and ${outletEdge.toUpperCase()} outlet (${outlets.map((o) => o.label).join(', ')}).`,
    });
  }

  // 2. Check Stack / Buoyancy Path (vertical elevation separation Δh >= 0.35 m between operable openings or room atrium/stack outlet)
  const openingsWithCentroid = activeExteriorOpenings.filter(
    (o) => o.centroidElevationAboveFloorMetres !== null
  );
  if (openingsWithCentroid.length >= 2) {
    const sortedByZ = [...openingsWithCentroid].sort(
      (a, b) =>
        (a.centroidElevationAboveFloorMetres ?? 0) - (b.centroidElevationAboveFloorMetres ?? 0)
    );
    const lowest = sortedByZ[0];
    const highest = sortedByZ[sortedByZ.length - 1];
    const deltaH = round2(
      (highest.centroidElevationAboveFloorMetres ?? 0) -
        (lowest.centroidElevationAboveFloorMetres ?? 0)
    );
    if (deltaH >= 0.35) {
      const gLow = lowest.cdTimesEffectiveAreaM2 ?? 0;
      const gHigh = highest.cdTimesEffectiveAreaM2 ?? 0;
      const seriesCdA =
        gLow > 0 && gHigh > 0 ? computeSeriesOrificeConductanceM2([gLow, gHigh]) : null;

      paths.push({
        pathId: `path-stack-${room.id}-${lowest.openingId}-${highest.openingId}`,
        primaryRoomId: room.id,
        primaryRoomName: room.name,
        strategyType: 'stack-buoyancy',
        isPathActiveInScenario: true,
        inletOpeningIds: [lowest.openingId],
        outletOpeningIds: [highest.openingId],
        intermediateTransferOpeningIds: [],
        traversedRoomIds: [room.id],
        traversedRoomNames: [room.name],
        inletWallEdges: [lowest.wallEdge],
        outletWallEdges: [highest.wallEdge],
        facadeAngleDifferenceDeg: computeAngularDifferenceDeg(
          lowest.compassAzimuthDeg,
          highest.compassAzimuthDeg
        ),
        verticalElevationSeparationMetres: deltaH,
        flowPathPlanLengthMetres: roomGeometry.widthMetres,
        depthToHeightRatio:
          roomGeometry.widthMetres !== null &&
          roomGeometry.ceilingHeightMetres !== null &&
          roomGeometry.ceilingHeightMetres > 0
            ? round2(roomGeometry.widthMetres / roomGeometry.ceilingHeightMetres)
            : null,
        depthToHeightScreeningStatus:
          roomGeometry.ceilingHeightMetres === null ? 'height-unknown' : 'within-heuristic-limit',
        depthToHeightExplanation: `Vertical centroid separation Δh = ${deltaH} m between low-level opening "${lowest.label}" (z = ${lowest.centroidElevationAboveFloorMetres} m) and high-level opening "${highest.label}" (z = ${highest.centroidElevationAboveFloorMetres} m).`,
        effectiveSeriesConductanceCdAM2: seriesCdA,
        blockedOrClosedReasons: [],
        conceptualDiagramVectors: [
          {
            fromXMetres: 0.3 * (roomGeometry.widthMetres ?? 4),
            fromYMetres: 0.7 * (roomGeometry.lengthMetres ?? 4),
            toXMetres: 0.7 * (roomGeometry.widthMetres ?? 4),
            toYMetres: 0.2 * (roomGeometry.lengthMetres ?? 4),
            pathKind: 'stack-vertical',
            label: `Buoyancy stack path (Δh = ${deltaH} m)`,
          },
        ],
        explanation: `Vertical buoyancy/stack path driven by elevation difference Δh = ${deltaH} m between low opening "${lowest.label}" and high opening "${highest.label}".`,
      });
    }
  } else if (
    roomConfig.hasVerticalAtriumOrStackConnection &&
    roomConfig.verticalStackOutletElevationMetres !== null &&
    roomConfig.verticalStackOutletFreeAreaM2 !== null &&
    roomConfig.verticalStackOutletFreeAreaM2 > 0 &&
    activeExteriorOpenings.length >= 1
  ) {
    const lowest = activeExteriorOpenings[0];
    const zIn = lowest.centroidElevationAboveFloorMetres ?? 1.0;
    const deltaH = round2(roomConfig.verticalStackOutletElevationMetres - zIn);
    if (deltaH > 0.35) {
      const gLow = lowest.cdTimesEffectiveAreaM2 ?? 0;
      const gStack = 0.62 * roomConfig.verticalStackOutletFreeAreaM2;
      const seriesCdA =
        gLow > 0 ? computeSeriesOrificeConductanceM2([gLow, gStack]) : null;

      paths.push({
        pathId: `path-atrium-stack-${room.id}`,
        primaryRoomId: room.id,
        primaryRoomName: room.name,
        strategyType: 'stack-buoyancy',
        isPathActiveInScenario: true,
        inletOpeningIds: [lowest.openingId],
        outletOpeningIds: [`stack-outlet-${room.id}`],
        intermediateTransferOpeningIds: [],
        traversedRoomIds: [room.id],
        traversedRoomNames: [room.name],
        inletWallEdges: [lowest.wallEdge],
        outletWallEdges: [lowest.wallEdge],
        facadeAngleDifferenceDeg: 0,
        verticalElevationSeparationMetres: deltaH,
        flowPathPlanLengthMetres: roomGeometry.widthMetres,
        depthToHeightRatio: null,
        depthToHeightScreeningStatus: 'within-heuristic-limit',
        depthToHeightExplanation: `Connected to vertical stack/atrium outlet at elevation ${roomConfig.verticalStackOutletElevationMetres} m (Δh = ${deltaH} m).`,
        effectiveSeriesConductanceCdAM2: seriesCdA,
        blockedOrClosedReasons: [],
        conceptualDiagramVectors: [
          {
            fromXMetres: 0.25 * (roomGeometry.widthMetres ?? 4),
            fromYMetres: 0.6 * (roomGeometry.lengthMetres ?? 4),
            toXMetres: 0.6 * (roomGeometry.widthMetres ?? 4),
            toYMetres: 0.15 * (roomGeometry.lengthMetres ?? 4),
            pathKind: 'stack-vertical',
            label: `Atrium/stack outlet (Δh = ${deltaH} m)`,
          },
        ],
        explanation: `Stack ventilation path via low-level inlet "${lowest.label}" and vertical stack/atrium exhaust outlet (Δh = ${deltaH} m).`,
      });
    }
  }

  // 3. Check Internal-Transfer-Assisted Multi-Room Cross-Ventilation Path
  if (activeExteriorOpenings.length >= 1 && roomInternalOpenings.length >= 1) {
    for (const internalOp of roomInternalOpenings) {
      const neighborRoomId =
        internalOp.connectedRoomId ||
        roomGeometry.interiorSharedWalls.find((w) => w.wallEdge === internalOp.wallEdge)
          ?.neighborRoomId;
      const neighborRoom = allRooms.find((r) => r.id === neighborRoomId);
      if (!neighborRoom) continue;

      const neighborOpeningsRaw = allOpenings.filter(
        (o) =>
          o.roomId === neighborRoom.id &&
          (o.boundaryLocation === 'exterior-envelope' || o.boundaryLocation === 'roof-or-atrium')
      );
      const neighborExtActive = neighborOpeningsRaw
        .map((no) =>
          evaluateOpeningForScenarioSI(project, neighborRoom, roomGeometry, no, scenario)
        )
        .filter(
          (no) =>
            no.operabilityStatus === 'operable' &&
            no.scenarioState !== 'closed' &&
            no.scenarioOpenFraction > 0 &&
            no.wallEdge !== activeExteriorOpenings[0].wallEdge
        );

      if (neighborExtActive.length > 0) {
        const isTransferOpen =
          internalOp.operabilityStatus === 'operable' &&
          internalOp.scenarioState !== 'closed' &&
          internalOp.scenarioOpenFraction > 0;

        const extIn = activeExteriorOpenings[0];
        const extOut = neighborExtActive[0];
        const angleDiff = computeAngularDifferenceDeg(
          extIn.compassAzimuthDeg,
          extOut.compassAzimuthDeg
        );

        const gIn = extIn.cdTimesEffectiveAreaM2 ?? 0;
        const gTrans = internalOp.cdTimesEffectiveAreaM2 ?? 0;
        const gOut = extOut.cdTimesEffectiveAreaM2 ?? 0;
        const series3 =
          isTransferOpen && gIn > 0 && gTrans > 0 && gOut > 0
            ? computeSeriesOrificeConductanceM2([gIn, gTrans, gOut])
            : null;

        paths.push({
          pathId: `path-transfer-${room.id}-${neighborRoom.id}`,
          primaryRoomId: room.id,
          primaryRoomName: room.name,
          strategyType: 'internal-transfer-assisted',
          isPathActiveInScenario: isTransferOpen,
          inletOpeningIds: [extIn.openingId],
          outletOpeningIds: [extOut.openingId],
          intermediateTransferOpeningIds: [internalOp.openingId],
          traversedRoomIds: [room.id, neighborRoom.id],
          traversedRoomNames: [room.name, neighborRoom.name],
          inletWallEdges: [extIn.wallEdge],
          outletWallEdges: [extOut.wallEdge],
          facadeAngleDifferenceDeg: angleDiff,
          verticalElevationSeparationMetres: 0,
          flowPathPlanLengthMetres:
            roomGeometry.widthMetres !== null
              ? round2(
                  roomGeometry.widthMetres +
                    (convertLengthToMetres(neighborRoom.width, project.unit) ?? 0)
                )
              : null,
          depthToHeightRatio: null,
          depthToHeightScreeningStatus:
            roomGeometry.ceilingHeightMetres === null
              ? 'height-unknown'
              : 'within-heuristic-limit',
          depthToHeightExplanation: isTransferOpen
            ? `Multi-room cross-ventilation path through internal opening "${internalOp.label}" into "${neighborRoom.name}".`
            : `Potential multi-room cross-ventilation path through "${internalOp.label}" into "${neighborRoom.name}" is currently BLOCKED because "${internalOp.label}" is closed or lacks an operable transfer grille in this scenario.`,
          effectiveSeriesConductanceCdAM2: series3,
          blockedOrClosedReasons: isTransferOpen
            ? []
            : [
                `Internal partition opening "${internalOp.label}" between "${room.name}" and "${neighborRoom.name}" is closed in the active scenario. Cross-ventilation across internal doors stops when the door is closed unless an acoustic transfer grille or transom is provided.`,
              ],
          internalDoorPrivacyTradeOffWarning:
            `Leaving internal door/opening "${internalOp.label}" open between "${room.name}" and "${neighborRoom.name}" enables cross-ventilation but directly reduces airborne speech privacy (P36 Domain D). Consider an acoustically attenuated transfer duct/baffle if privacy is required.`,
          conceptualDiagramVectors: [
            {
              fromXMetres: 0.2 * (roomGeometry.widthMetres ?? 4),
              fromYMetres: 0.5 * (roomGeometry.lengthMetres ?? 4),
              toXMetres: 0.9 * (roomGeometry.widthMetres ?? 4),
              toYMetres: 0.5 * (roomGeometry.lengthMetres ?? 4),
              pathKind: isTransferOpen ? 'internal-transfer' : 'blocked-door',
              label: isTransferOpen
                ? `Internal transfer via ${internalOp.label} → ${neighborRoom.name}`
                : `Blocked at closed ${internalOp.label}`,
            },
          ],
          explanation: isTransferOpen
            ? `Internal-transfer-assisted cross-ventilation from "${room.name}" (${extIn.wallEdge.toUpperCase()}) through open "${internalOp.label}" to "${neighborRoom.name}" (${extOut.wallEdge.toUpperCase()}).`
            : `Candidate cross-ventilation route to "${neighborRoom.name}" is inactive because internal opening "${internalOp.label}" is closed in this scenario.`,
        });
      }
    }
  }

  // 4. Single-Sided Ventilation Path (when active exterior openings exist on 1 facade edge)
  if (activeExteriorOpenings.length >= 1) {
    const primaryEdge = activeEdges[0];
    const edgeOpenings = activeExteriorOpenings.filter((o) => o.wallEdge === primaryEdge);
    // In single-sided ventilation with no separate outlet, roughly half of the open area acts as inflow and half as outflow in series:
    // G_in = 0.5 * G_total, G_out = 0.5 * G_total => G_series = (0.5 * G) / sqrt(2) ≈ 0.3536 * G_total
    const totalEdgeCdA = edgeOpenings.reduce((s, o) => s + (o.cdTimesEffectiveAreaM2 ?? 0), 0);
    const singleSidedEffectiveCdA = totalEdgeCdA > 0 ? round4(totalEdgeCdA * 0.3536) : null;

    const roomDepthMetres =
      primaryEdge === 'north' || primaryEdge === 'south'
        ? roomGeometry.lengthMetres
        : roomGeometry.widthMetres;
    const depthToHeight =
      roomDepthMetres !== null &&
      roomGeometry.ceilingHeightMetres !== null &&
      roomGeometry.ceilingHeightMetres > 0
        ? round2(roomDepthMetres / roomGeometry.ceilingHeightMetres)
        : null;

    const depthStatus =
      depthToHeight === null
        ? 'height-unknown'
        : depthToHeight <= 2.5
        ? 'within-heuristic-limit'
        : 'exceeds-heuristic-limit';

    paths.push({
      pathId: `path-single-sided-${room.id}-${primaryEdge}`,
      primaryRoomId: room.id,
      primaryRoomName: room.name,
      strategyType: 'single-sided',
      isPathActiveInScenario: true,
      inletOpeningIds: edgeOpenings.map((o) => o.openingId),
      outletOpeningIds: edgeOpenings.map((o) => o.openingId),
      intermediateTransferOpeningIds: [],
      traversedRoomIds: [room.id],
      traversedRoomNames: [room.name],
      inletWallEdges: [primaryEdge],
      outletWallEdges: [primaryEdge],
      facadeAngleDifferenceDeg: 0,
      verticalElevationSeparationMetres: 0,
      flowPathPlanLengthMetres: roomDepthMetres,
      depthToHeightRatio: depthToHeight,
      depthToHeightScreeningStatus: depthStatus,
      depthToHeightExplanation:
        depthToHeight === null
          ? 'Specify room ceiling height H to evaluate single-sided plan depth ratio (L <= 2.5H advisory heuristic per CIBSE AM10).'
          : depthToHeight <= 2.5
          ? `Single-sided room depth ratio L/H = ${depthToHeight} is within the CIBSE AM10 heuristic limit (L <= 2.5 H).`
          : `Single-sided room depth ratio L/H = ${depthToHeight} exceeds the CIBSE AM10 single-sided heuristic limit (L <= 2.5 H); fresh air exchange at the back of the room is likely limited without cross-ventilation or stack assistance.`,
      effectiveSeriesConductanceCdAM2: singleSidedEffectiveCdA,
      blockedOrClosedReasons: [],
      conceptualDiagramVectors: [
        {
          fromXMetres: 0.2 * (roomGeometry.widthMetres ?? 4),
          fromYMetres: 0.3 * (roomGeometry.lengthMetres ?? 4),
          toXMetres: 0.55 * (roomGeometry.widthMetres ?? 4),
          toYMetres: 0.3 * (roomGeometry.lengthMetres ?? 4),
          pathKind: 'single-sided-exchange',
          label: `Single-sided bidirectional exchange (${primaryEdge.toUpperCase()})`,
        },
      ],
      explanation: `Single-sided ventilation on the ${primaryEdge.toUpperCase()} facade via ${edgeOpenings.map((o) => o.label).join(', ')}. Bidirectional inflow/outflow occurs across the same facade exposure, which is less effective than cross-ventilation for deep rooms.`,
    });
  }

  // Determine Dominant Strategy for the active scenario
  const hasActiveCross = paths.some(
    (p) => p.strategyType === 'cross-ventilation' && p.isPathActiveInScenario
  );
  const hasActiveStack = paths.some(
    (p) => p.strategyType === 'stack-buoyancy' && p.isPathActiveInScenario
  );
  const hasActiveTransfer = paths.some(
    (p) => p.strategyType === 'internal-transfer-assisted' && p.isPathActiveInScenario
  );
  const hasActiveSingle = paths.some(
    (p) => p.strategyType === 'single-sided' && p.isPathActiveInScenario
  );

  let dominantStrategy: VentilationStrategyClassification = 'no-identified-path';
  if ((hasActiveCross || hasActiveTransfer) && hasActiveStack) {
    dominantStrategy = 'combined-wind-and-stack';
  } else if (hasActiveCross) {
    dominantStrategy = 'cross-ventilation';
  } else if (hasActiveTransfer) {
    dominantStrategy = 'internal-transfer-assisted';
  } else if (hasActiveStack) {
    dominantStrategy = 'stack-buoyancy';
  } else if (hasActiveSingle) {
    dominantStrategy = 'single-sided';
  } else if (unknownExteriorOpenings.length > 0 && activeExteriorOpenings.length === 0) {
    dominantStrategy = 'insufficient-geometry-or-opening-data';
  } else {
    dominantStrategy = 'no-identified-path';
  }

  return { dominantStrategy, paths };
}

/**
 * Mode A — Evaluates Geometric Ventilation Potential for a room in the active scenario.
 */
export function evaluateModeAGeometricPotential(
  roomGeometry: RoomVentilationGeometryResult,
  evaluatedOpenings: EvaluatedOpeningMetricsSI[],
  openableRatioCriterion: ConfiguredVentilationCriterion
): GeometricVentilationPotentialResult {
  const exteriorOpenings = evaluatedOpenings.filter(
    (o) => o.boundaryLocation === 'exterior-envelope' || o.boundaryLocation === 'roof-or-atrium'
  );
  const internalOpenings = evaluatedOpenings.filter(
    (o) => o.boundaryLocation === 'interior-partition'
  );

  const totalGrossOpeningAreaM2 = round3(
    exteriorOpenings.reduce((s, o) => s + (o.grossAreaM2 ?? 0), 0)
  );

  const operableExteriorOpeningsCount = exteriorOpenings.filter(
    (o) => o.operabilityStatus === 'operable'
  ).length;
  const fixedExteriorOpeningsCount = exteriorOpenings.filter(
    (o) => o.operabilityStatus === 'fixed'
  ).length;
  const unknownOperabilityOpeningsCount = evaluatedOpenings.filter(
    (o) => o.operabilityStatus === 'unknown'
  ).length;
  const operableInternalTransferOpeningsCount = internalOpenings.filter(
    (o) => o.operabilityStatus === 'operable'
  ).length;

  const hasAnyValidOpenableArea = exteriorOpenings.some(
    (o) => o.maxOpenableAreaM2 !== null
  );
  const totalMaxOpenableAreaM2 = hasAnyValidOpenableArea
    ? round3(exteriorOpenings.reduce((s, o) => s + (o.maxOpenableAreaM2 ?? 0), 0))
    : operableExteriorOpeningsCount === 0 && fixedExteriorOpeningsCount > 0 && unknownOperabilityOpeningsCount === 0
    ? 0
    : null;

  const hasAnyValidScenarioArea = exteriorOpenings.some(
    (o) => o.effectiveScenarioFreeAreaM2 !== null
  );
  const totalScenarioEffectiveFreeAreaM2 = hasAnyValidScenarioArea
    ? round4(exteriorOpenings.reduce((s, o) => s + (o.effectiveScenarioFreeAreaM2 ?? 0), 0))
    : totalMaxOpenableAreaM2 === 0
    ? 0
    : null;

  const maxOpenableToFloorAreaPercent =
    totalMaxOpenableAreaM2 !== null &&
    roomGeometry.floorAreaM2 !== null &&
    roomGeometry.floorAreaM2 > 0
      ? round2((totalMaxOpenableAreaM2 / roomGeometry.floorAreaM2) * 100)
      : null;

  const scenarioEffectiveFreeAreaToFloorAreaPercent =
    totalScenarioEffectiveFreeAreaM2 !== null &&
    roomGeometry.floorAreaM2 !== null &&
    roomGeometry.floorAreaM2 > 0
      ? round2((totalScenarioEffectiveFreeAreaM2 / roomGeometry.floorAreaM2) * 100)
      : null;

  const meetsOpenableAreaRatioTarget =
    maxOpenableToFloorAreaPercent !== null
      ? maxOpenableToFloorAreaPercent >= openableRatioCriterion.minTarget
      : null;

  const centroids = exteriorOpenings
    .filter((o) => o.operabilityStatus === 'operable' && o.centroidElevationAboveFloorMetres !== null)
    .map((o) => o.centroidElevationAboveFloorMetres as number);
  const maxVerticalOpeningSeparationMetres =
    centroids.length >= 2
      ? round2(Math.max(...centroids) - Math.min(...centroids))
      : null;

  let geometricPotentialStatus: VentilationEvaluationStatus = 'insufficient-evidence';
  let explanation = '';

  if (exteriorOpenings.length === 0 && operableInternalTransferOpeningsCount === 0) {
    geometricPotentialStatus = 'insufficient-evidence';
    explanation = `No exterior windows, doors, or internal transfer openings are defined for "${roomGeometry.roomName}". Add or configure openings to assess geometric ventilation potential.`;
  } else if (totalMaxOpenableAreaM2 === null) {
    geometricPotentialStatus = 'insufficient-evidence';
    explanation = `Openings exist for "${roomGeometry.roomName}", but operability status or opening height/clear area is not yet specified (${unknownOperabilityOpeningsCount} opening(s) have unknown operability or missing height).`;
  } else if (meetsOpenableAreaRatioTarget === true) {
    geometricPotentialStatus = 'favorable-for-scenario';
    explanation = `Maximum openable exterior area is ${totalMaxOpenableAreaM2} m² (${maxOpenableToFloorAreaPercent}% of ${roomGeometry.floorAreaM2} m² floor area), meeting the ${openableRatioCriterion.minTarget}% preliminary geometric screening benchmark. Active scenario effective free area is ${totalScenarioEffectiveFreeAreaM2 ?? 0} m² (${scenarioEffectiveFreeAreaToFloorAreaPercent ?? 0}%).`;
  } else {
    geometricPotentialStatus = 'concern-identified';
    explanation = `Maximum openable exterior area is ${totalMaxOpenableAreaM2} m² (${maxOpenableToFloorAreaPercent}% of ${roomGeometry.floorAreaM2} m² floor area), which is below the ${openableRatioCriterion.minTarget}% preliminary geometric screening benchmark.`;
  }

  return {
    mode: 'mode-a-geometric-potential',
    floorAreaM2: roomGeometry.floorAreaM2,
    totalGrossOpeningAreaM2,
    totalMaxOpenableAreaM2,
    totalScenarioEffectiveFreeAreaM2,
    maxOpenableToFloorAreaPercent,
    scenarioEffectiveFreeAreaToFloorAreaPercent,
    openableRatioCriterion,
    meetsOpenableAreaRatioTarget,
    operableExteriorOpeningsCount,
    fixedExteriorOpeningsCount,
    unknownOperabilityOpeningsCount,
    operableInternalTransferOpeningsCount,
    maxVerticalOpeningSeparationMetres,
    geometricPotentialStatus,
    explanation,
  };
}

/**
 * Mode C — Computes Quantified Preliminary Airflow Estimates (Q_wind, Q_stack, Q_combined, ACH, L/s per person, L/s per m²)
 * using documented ASHRAE Fundamentals Chapter 16 / CIBSE AM10 orifice and hydrostatic buoyancy equations.
 *
 * CRITICAL P37 SECTION 11 RULES:
 * 1. Never compute wind-driven flow without wind speed v, wind direction, opening orientation, C_d, A_eff, and ΔC_p.
 * 2. Never compute stack-driven flow without vertical opening separation Δh > 0, indoor/outdoor temperatures, C_d, and A_eff.
 * 3. Never blindly sum Q_wind + Q_stack linearly! Use quadrature combination Q = sqrt(Q_wind² + Q_stack²) or dominant mechanism.
 * 4. Never compute ACH without valid room volume V > 0.
 */
export function evaluateModeCQuantifiedAirflowEstimate(
  roomConfig: RoomVentilationConfig,
  roomGeometry: RoomVentilationGeometryResult,
  discoveredPaths: AirflowPathRecord[],
  scenario: NaturalVentilationScenario,
  criteria: {
    achCriterion: ConfiguredVentilationCriterion;
    perPersonCriterion: ConfiguredVentilationCriterion;
    perAreaCriterion: ConfiguredVentilationCriterion;
  }
): QuantifiedAirflowEstimateResult {
  const env = scenario.environmentalConditions;
  const unavailabilityReasons: string[] = [];

  const rho =
    typeof env.airDensityKgPerM3 === 'number' &&
    Number.isFinite(env.airDensityKgPerM3) &&
    env.airDensityKgPerM3 > 0.5 &&
    env.airDensityKgPerM3 < 2.0
      ? env.airDensityKgPerM3
      : DEFAULT_AIR_DENSITY_KG_M3;

  // Identify active wind path (prefer cross-ventilation or internal-transfer-assisted, fallback to single-sided)
  const activeCrossOrTransferPath = discoveredPaths.find(
    (p) =>
      p.isPathActiveInScenario &&
      (p.strategyType === 'cross-ventilation' || p.strategyType === 'internal-transfer-assisted')
  );
  const activeSingleSidedPath = discoveredPaths.find(
    (p) => p.isPathActiveInScenario && p.strategyType === 'single-sided'
  );
  const windPath = activeCrossOrTransferPath || activeSingleSidedPath;

  // --- 1. Wind-Driven Calculation ---
  let windApplicable = false;
  let incidenceAngleDeg: number | null = null;
  let effectiveDeltaCp: number | null = null;
  let deltaPWindPascals: number | null = null;
  let windConductanceCdAM2: number | null = null;
  let windFlowM3PerSec: number | null = null;
  let windFlowLitresPerSec: number | null = null;
  let windNonApplicableReason: string | undefined;

  if (!windPath) {
    windNonApplicableReason = 'No active operable exterior airflow path is open in this scenario.';
  } else if (windPath.effectiveSeriesConductanceCdAM2 === null || windPath.effectiveSeriesConductanceCdAM2 <= 0) {
    windNonApplicableReason =
      'Effective orifice conductance (C_d * A_eff) is unavailable because opening height, openable fraction, or discharge coefficient C_d is not yet specified.';
  } else if (
    env.windSpeedMetresPerSec === null ||
    !Number.isFinite(env.windSpeedMetresPerSec) ||
    env.windSpeedMetresPerSec < 0
  ) {
    windNonApplicableReason = 'Outdoor wind speed v (m/s) is not specified in the scenario.';
  } else if (
    env.windDirectionDegFromNorth === null ||
    !Number.isFinite(env.windDirectionDegFromNorth)
  ) {
    windNonApplicableReason = 'Outdoor wind direction (deg from North) is not specified in the scenario.';
  } else if (
    env.assumedDeltaCp === null ||
    !Number.isFinite(env.assumedDeltaCp) ||
    env.assumedDeltaCp <= 0
  ) {
    windNonApplicableReason = 'Scenario wind pressure coefficient difference (ΔC_p) is not specified.';
  } else {
    windApplicable = true;
    windConductanceCdAM2 = windPath.effectiveSeriesConductanceCdAM2;
    const inletEdge = windPath.inletWallEdges[0];
    const inletAzimuth = getWallCompassAzimuthDeg(
      inletEdge,
      roomGeometry.northOrientationOffsetDeg
    );
    incidenceAngleDeg = round2(
      computeAngularDifferenceDeg(env.windDirectionDegFromNorth, inletAzimuth)
    );

    if (
      windPath.strategyType === 'cross-ventilation' ||
      windPath.strategyType === 'internal-transfer-assisted'
    ) {
      // Scale nominal ΔC_p by directional incidence factor (minimum 0.15 for oblique/corner cross-flow when facades differ)
      const cosFactor = Math.max(0.15, Math.abs(Math.cos((incidenceAngleDeg * Math.PI) / 180)));
      effectiveDeltaCp = round3(env.assumedDeltaCp * cosFactor);
    } else {
      // Single-sided wind turbulence produces a much smaller local fluctuating pressure coefficient (typically ~0.05–0.10 of nominal ΔC_p)
      effectiveDeltaCp = round3(env.assumedDeltaCp * 0.08);
    }

    deltaPWindPascals = round3(
      0.5 * rho * env.windSpeedMetresPerSec * env.windSpeedMetresPerSec * effectiveDeltaCp
    );
    windFlowM3PerSec = round4(
      windConductanceCdAM2 * Math.sqrt((2 * Math.abs(deltaPWindPascals)) / rho)
    );
    windFlowLitresPerSec = round2(windFlowM3PerSec * 1000);
  }

  // --- 2. Stack / Buoyancy-Driven Calculation ---
  const stackPath = discoveredPaths.find(
    (p) => p.isPathActiveInScenario && p.strategyType === 'stack-buoyancy'
  );
  let stackApplicable = false;
  let verticalSeparationDeltaHMetres: number | null =
    stackPath?.verticalElevationSeparationMetres ?? null;
  let tempDiffAbsK: number | null = null;
  let deltaPStackPascals: number | null = null;
  let stackConductanceCdAM2: number | null = null;
  let stackFlowM3PerSec: number | null = null;
  let stackFlowLitresPerSec: number | null = null;
  let stackFlowDirection: QuantifiedAirflowEstimateResult['stackDriven']['flowDirection'] =
    'not-applicable';
  let stackNonApplicableReason: string | undefined;

  if (!stackPath || verticalSeparationDeltaHMetres === null || verticalSeparationDeltaHMetres <= 0) {
    stackNonApplicableReason =
      'No active vertical separation (Δh > 0.35 m) between low-level and high-level operable openings in this scenario.';
  } else if (
    stackPath.effectiveSeriesConductanceCdAM2 === null ||
    stackPath.effectiveSeriesConductanceCdAM2 <= 0
  ) {
    stackNonApplicableReason =
      'Effective series orifice conductance (C_d * A_eff)_series for the stack openings is not yet specified.';
  } else if (
    env.indoorTempCelsius === null ||
    env.outdoorTempCelsius === null ||
    !Number.isFinite(env.indoorTempCelsius) ||
    !Number.isFinite(env.outdoorTempCelsius)
  ) {
    stackNonApplicableReason =
      'Indoor temperature (T_in) or outdoor temperature (T_out) is not specified in the scenario.';
  } else {
    const tInK = env.indoorTempCelsius + KELVIN_OFFSET;
    const tOutK = env.outdoorTempCelsius + KELVIN_OFFSET;
    if (tInK <= 0 || tOutK <= 0) {
      stackNonApplicableReason = 'Invalid absolute temperature in Kelvin.';
    } else {
      stackApplicable = true;
      stackConductanceCdAM2 = stackPath.effectiveSeriesConductanceCdAM2;
      tempDiffAbsK = round2(Math.abs(tInK - tOutK));
      const tRefK = 0.5 * (tInK + tOutK);

      deltaPStackPascals = round3(
        rho * GRAVITY_M_PER_S2 * verticalSeparationDeltaHMetres * (tempDiffAbsK / tRefK)
      );
      stackFlowM3PerSec = round4(
        stackConductanceCdAM2 * Math.sqrt((2 * Math.abs(deltaPStackPascals)) / rho)
      );
      stackFlowLitresPerSec = round2(stackFlowM3PerSec * 1000);
      stackFlowDirection =
        tempDiffAbsK === 0
          ? 'neutral-no-delta-t'
          : env.indoorTempCelsius > env.outdoorTempCelsius
          ? 'upward-warm-indoor-buoyancy'
          : 'downward-reverse-buoyancy';
    }
  }

  // --- 3. Combine Wind and Stack Flows (Never blind linear sum!) ---
  let combinedFlowRateM3PerSec: number | null = null;
  let combinedFlowRateLitresPerSec: number | null = null;
  let combinationMethodUsed = 'None (neither wind nor stack orifice estimate is active)';

  if (windApplicable && stackApplicable && windFlowM3PerSec !== null && stackFlowM3PerSec !== null) {
    if (env.combinedDrivingForceMethod === 'dominant-mechanism-conservative') {
      combinedFlowRateM3PerSec = round4(Math.max(windFlowM3PerSec, stackFlowM3PerSec));
      combinationMethodUsed =
        'Dominant mechanism conservative envelope: Q_combined = max(Q_wind, Q_stack)';
    } else {
      combinedFlowRateM3PerSec = round4(
        Math.sqrt(
          windFlowM3PerSec * windFlowM3PerSec + stackFlowM3PerSec * stackFlowM3PerSec
        )
      );
      combinationMethodUsed =
        'ASHRAE Ch. 16 quadrature pressure superposition: Q_combined = sqrt(Q_wind² + Q_stack²) (never linear Q_wind + Q_stack addition)';
    }
    combinedFlowRateLitresPerSec = round2(combinedFlowRateM3PerSec * 1000);
  } else if (windApplicable && windFlowM3PerSec !== null) {
    combinedFlowRateM3PerSec = windFlowM3PerSec;
    combinedFlowRateLitresPerSec = windFlowLitresPerSec;
    combinationMethodUsed = 'Wind-driven orifice flow only (Q_combined = Q_wind)';
  } else if (stackApplicable && stackFlowM3PerSec !== null) {
    combinedFlowRateM3PerSec = stackFlowM3PerSec;
    combinedFlowRateLitresPerSec = stackFlowLitresPerSec;
    combinationMethodUsed = 'Buoyancy/stack-driven orifice flow only (Q_combined = Q_stack)';
  } else {
    if (windNonApplicableReason) unavailabilityReasons.push(windNonApplicableReason);
    if (stackNonApplicableReason) unavailabilityReasons.push(stackNonApplicableReason);
  }

  // --- 4. Air Changes Per Hour (ACH) and Specific Airflow Rates ---
  let estimatedAch: number | null = null;
  if (combinedFlowRateM3PerSec !== null) {
    if (roomGeometry.roomVolumeM3 !== null && roomGeometry.roomVolumeM3 > 0) {
      estimatedAch = round2((combinedFlowRateM3PerSec * 3600) / roomGeometry.roomVolumeM3);
    } else {
      unavailabilityReasons.push(
        `Volumetric airflow Q = ${combinedFlowRateLitresPerSec} L/s is computed, but Air Changes Per Hour (ACH) cannot be calculated until room ceiling height H (and room volume V) is specified.`
      );
    }
  }

  const estimatedLitresPerSecPerPerson =
    combinedFlowRateLitresPerSec !== null &&
    roomConfig.occupancyCountAssumption !== null &&
    roomConfig.occupancyCountAssumption > 0
      ? round2(combinedFlowRateLitresPerSec / roomConfig.occupancyCountAssumption)
      : null;

  const estimatedLitresPerSecPerM2 =
    combinedFlowRateLitresPerSec !== null &&
    roomGeometry.floorAreaM2 !== null &&
    roomGeometry.floorAreaM2 > 0
      ? round2(combinedFlowRateLitresPerSec / roomGeometry.floorAreaM2)
      : null;

  const targetAch =
    roomConfig.customTargetAch !== undefined && roomConfig.customTargetAch !== null
      ? roomConfig.customTargetAch
      : criteria.achCriterion.minTarget;

  const meetsAchTarget = estimatedAch !== null ? estimatedAch >= targetAch : null;
  const meetsPerPersonTarget =
    estimatedLitresPerSecPerPerson !== null
      ? estimatedLitresPerSecPerPerson >= criteria.perPersonCriterion.minTarget
      : null;
  const meetsPerAreaTarget =
    estimatedLitresPerSecPerM2 !== null
      ? estimatedLitresPerSecPerM2 >= criteria.perAreaCriterion.minTarget
      : null;

  const isQuantifiedEstimateAvailable = combinedFlowRateM3PerSec !== null;

  const explanation = isQuantifiedEstimateAvailable
    ? `Preliminary scenario airflow rate Q = ${combinedFlowRateM3PerSec} m³/s (${combinedFlowRateLitresPerSec} L/s) via ${combinationMethodUsed}.${
        estimatedAch !== null
          ? ` For room volume V = ${roomGeometry.roomVolumeM3} m³, estimated scenario ACH = ${estimatedAch} h⁻¹ (screening target >= ${targetAch} h⁻¹).`
          : ' Specify room ceiling height to convert Q into Air Changes Per Hour (ACH).'
      }`
    : `Quantified orifice airflow estimate (Mode C) is currently withheld: ${unavailabilityReasons.join(' ')}`;

  return {
    mode: 'mode-c-quantified-preliminary-estimate',
    isQuantifiedEstimateAvailable,
    unavailabilityReasons,
    windDriven: {
      isApplicable: windApplicable,
      windSpeedMetresPerSec: env.windSpeedMetresPerSec,
      windDirectionDeg: env.windDirectionDegFromNorth,
      incidenceAngleDegOnWindwardWall: incidenceAngleDeg,
      effectiveDeltaCp,
      deltaPWindPascals,
      effectiveConductanceCdAM2: windConductanceCdAM2,
      flowRateM3PerSec: windFlowM3PerSec,
      flowRateLitresPerSec: windFlowLitresPerSec,
      formulaUsed:
        'ΔP_wind = 0.5 · ρ · v² · ΔC_p,eff (Pa); Q_wind = (C_d · A_eff)_series · √(2 · |ΔP_wind| / ρ) (m³/s)',
      nonApplicableReason: windNonApplicableReason,
    },
    stackDriven: {
      isApplicable: stackApplicable,
      verticalSeparationDeltaHMetres,
      indoorTempCelsius: env.indoorTempCelsius,
      outdoorTempCelsius: env.outdoorTempCelsius,
      tempDifferenceAbsKelvin: tempDiffAbsK,
      deltaPStackPascals,
      effectiveSeriesConductanceCdAM2: stackConductanceCdAM2,
      flowRateM3PerSec: stackFlowM3PerSec,
      flowRateLitresPerSec: stackFlowLitresPerSec,
      flowDirection: stackFlowDirection,
      formulaUsed:
        'ΔP_stack = ρ · g · Δh · |T_in - T_out| / T_ref,K (Pa); Q_stack = (C_d · A_eff)_series · √(2 · |ΔP_stack| / ρ) (m³/s)',
      nonApplicableReason: stackNonApplicableReason,
    },
    combinedFlowRateM3PerSec,
    combinedFlowRateLitresPerSec,
    combinationMethodUsed,
    estimatedAch,
    achFormulaUsed: 'ACH = (Q_combined × 3600) / V (h⁻¹), where V = A_floor × H_room (m³)',
    estimatedLitresPerSecPerPerson,
    estimatedLitresPerSecPerM2,
    achCriterion: criteria.achCriterion,
    perPersonCriterion: criteria.perPersonCriterion,
    perAreaCriterion: criteria.perAreaCriterion,
    meetsAchTarget,
    meetsPerPersonTarget,
    meetsPerAreaTarget,
    steadyStateAssumptionsAndLimitations: [
      'Uses simplified steady-state macroscopic orifice equations assuming uniform zone air mixing and hydrostatic pressure distribution.',
      'Does not model local indoor air velocity jets, turbulent eddy recirculation, furniture wake aerodynamics, or thermal stratification gradients (which require CFD).',
      'Wind pressure coefficient ΔC_p is an explicit scenario/reference screening parameter, not a wind-tunnel or 3D urban canyon simulation.',
    ],
    noCfdOrComplianceGuarantee:
      'Preliminary scenario estimate only. Does not constitute CFD simulation or statutory ASHRAE 62.1 / 62.2 / local building-code compliance.',
    explanation,
  };
}

/**
 * Domain F — Evaluates multidisciplinary comfort, IAQ, moisture (P35), acoustic (P36),
 * privacy (P30/P36), accessibility (P34), and furniture (P33) constraints and trade-offs.
 */
export function evaluateDomainFConstraintsAndTradeOffs(
  project: Project,
  room: FloorPlanRoom,
  evaluatedOpenings: EvaluatedOpeningMetricsSI[],
  discoveredPaths: AirflowPathRecord[],
  scenario: NaturalVentilationScenario
): VentilationConstraintAndTradeOffItem[] {
  const items: VentilationConstraintAndTradeOffItem[] = [];
  const env = scenario.environmentalConditions;

  const openExteriorOpenings = evaluatedOpenings.filter(
    (o) =>
      (o.boundaryLocation === 'exterior-envelope' || o.boundaryLocation === 'roof-or-atrium') &&
      o.operabilityStatus === 'operable' &&
      o.scenarioState !== 'closed' &&
      o.scenarioOpenFraction > 0
  );

  // 1. P36 Outdoor Noise vs. Open Exterior Windows Conflict
  const p36Data = initializeProjectAcousticPlannerData(project);
  const roomNoiseObs = (p36Data.noiseObservations || []).filter(
    (obs) =>
      obs.roomId === room.id &&
      (obs.sourceCategory === 'road-traffic' ||
        obs.sourceCategory === 'rail-or-aircraft' ||
        obs.sourceCategory === 'external-plant-equipment' ||
        obs.sourceCategory === 'neighbouring-activities')
  );
  const hasHighP36OutdoorNoise = roomNoiseObs.some(
    (obs) =>
      obs.qualitativeSeverity === 'high-intrusive' ||
      (obs.soundLevelDb !== null && obs.soundLevelDb >= 55)
  );

  if (
    openExteriorOpenings.length > 0 &&
    (env.outdoorNoiseCondition === 'high-traffic-or-plant-noise' || hasHighP36OutdoorNoise)
  ) {
    items.push({
      tradeOffId: `to-noise-${room.id}`,
      domain: 'outdoor-noise-p36-conflict',
      severity: 'blocking-or-high-concern',
      title: 'Outdoor Noise Ingress vs. Open Facade Windows (P36 Conflict)',
      finding: `Opening exterior windows (${openExteriorOpenings.map((o) => o.label).join(', ')}) in "${room.name}" during high outdoor noise (${
        hasHighP36OutdoorNoise ? 'recorded in P36 noise observations' : 'active scenario condition'
      }) bypasses facade glazing sound insulation (reducing effective facade attenuation to ~10–15 dB).`,
      linkedRoadmapFeature: 'P36',
      mitigationGuidance:
        'Consider acoustically attenuated ventilation louvres, baffled trickle/acoustic vents, or relocating primary ventilation inlets to a quiet courtyard/leeward facade.',
    });
  } else if (openExteriorOpenings.length > 0 && env.outdoorNoiseCondition === 'moderate-urban') {
    items.push({
      tradeOffId: `to-noise-mod-${room.id}`,
      domain: 'outdoor-noise-p36-conflict',
      severity: 'moderate-trade-off',
      title: 'Moderate Urban Noise vs. Natural Ventilation (P36 Trade-Off)',
      finding: `Open facade openings (${openExteriorOpenings.map((o) => o.label).join(', ')}) admit ambient urban sound alongside outdoor air.`,
      linkedRoadmapFeature: 'P36',
      mitigationGuidance:
        'Check P36 indoor background noise target (LAeq) for noise-sensitive spaces such as bedrooms or home offices.',
    });
  }

  // 2. P30 / P36 Internal Speech Privacy vs. Internal Transfer Path Conflict
  const activeTransferPaths = discoveredPaths.filter(
    (p) => p.strategyType === 'internal-transfer-assisted'
  );
  const brief = initializeProjectBrief(project);
  const hasBriefAcousticIsolation = (brief.relationships || []).some(
    (rel) =>
      rel.relationType === 'acoustic-isolated' &&
      (rel.sourceSpaceId.includes(room.id) || rel.targetSpaceId.includes(room.id))
  );

  if (activeTransferPaths.length > 0 || hasBriefAcousticIsolation) {
    const anyOpenTransfer = activeTransferPaths.some((p) => p.isPathActiveInScenario);
    if (anyOpenTransfer) {
      items.push({
        tradeOffId: `to-privacy-${room.id}`,
        domain: 'internal-privacy-p36-p30-conflict',
        severity: hasBriefAcousticIsolation ? 'blocking-or-high-concern' : 'moderate-trade-off',
        title: 'Internal Cross-Ventilation Path vs. Room-to-Room Speech Privacy (P30/P36)',
        finding: `Active internal transfer path (${activeTransferPaths.map((p) => p.explanation).join(' ')}) creates a direct airborne sound path between adjacent rooms${
          hasBriefAcousticIsolation ? ', conflicting with a P30 Brief acoustic-isolation requirement' : ''
        }.`,
        linkedRoadmapFeature: hasBriefAcousticIsolation ? 'P30' : 'P36',
        mitigationGuidance:
          'Use acoustically lined crosstalk attenuators / baffled transfer grilles in the partition wall rather than leaving a standard hinged door open.',
      });
    }
  }

  // 3. Outdoor Thermal Comfort (Overheating or Cold Draft Risk)
  if (openExteriorOpenings.length > 0 && env.outdoorTempCelsius !== null) {
    if (env.outdoorTempCelsius > 30) {
      items.push({
        tradeOffId: `to-thermal-hot-${room.id}`,
        domain: 'thermal-draft-or-overheating',
        severity: 'blocking-or-high-concern',
        title: `Outdoor Heat Gain Risk (T_out = ${env.outdoorTempCelsius} °C)`,
        finding: `Outdoor air temperature (${env.outdoorTempCelsius} °C) exceeds indoor temperature (${env.indoorTempCelsius ?? 25} °C). High daytime natural ventilation rates will introduce sensible heat into "${room.name}".`,
        linkedRoadmapFeature: 'P37',
        mitigationGuidance:
          'Restrict daytime opening fraction to minimum hygienic background ventilation during peak outdoor heat, and shift high-volume purge ventilation to cooler night/early-morning hours.',
      });
    } else if (env.outdoorTempCelsius < 12) {
      items.push({
        tradeOffId: `to-thermal-cold-${room.id}`,
        domain: 'thermal-draft-or-overheating',
        severity: 'moderate-trade-off',
        title: `Cold Draft & Heating Penalty Risk (T_out = ${env.outdoorTempCelsius} °C)`,
        finding: `Cold outdoor air (${env.outdoorTempCelsius} °C) entering through low-sill openings can cause local occupant draft discomfort and heating energy loss.`,
        linkedRoadmapFeature: 'P37',
        mitigationGuidance:
          'Use high-level trickle vents or hopper/top-hung openings in winter to pre-mix incoming cool air near the ceiling above the occupied zone.',
      });
    }
  }

  // 4. Outdoor Humidity & P35 Moisture-Sensitive Interior Materials
  const p35Data = initializeProjectMaterialAdvisorData(project);
  const activeAlt =
    project.designAlternatives?.find((a) => a.id === project.activeAlternativeId) ||
    project.designAlternatives?.[0];
  const roomInterior = activeAlt?.interiors?.[room.id];
  const hasMoistureSensitiveFinish =
    roomInterior?.wallFinish === 'timber-slats' ||
    roomInterior?.wallFinish === 'acoustic-felt' ||
    roomInterior?.floorFinish === 'light-oak-plank' ||
    roomInterior?.floorFinish === 'smoked-walnut';

  if (
    openExteriorOpenings.length > 0 &&
    ((env.outdoorRelativeHumidityPercent !== null && env.outdoorRelativeHumidityPercent >= 75) ||
      p35Data.climateContext.humidityWettingRegime === 'tropical-wet-or-monsoon' ||
      p35Data.climateContext.humidityWettingRegime === 'humid-subtropical-or-continental' ||
      p35Data.climateContext.humidityWettingRegime === 'marine-persistent-damp')
  ) {
    items.push({
      tradeOffId: `to-moisture-p35-${room.id}`,
      domain: 'humidity-moisture-p35-materials',
      severity: hasMoistureSensitiveFinish ? 'blocking-or-high-concern' : 'moderate-trade-off',
      title: 'Outdoor Humidity vs. P35 Moisture-Sensitive Finishes',
      finding: `Unconditioned humid outdoor air (${
        env.outdoorRelativeHumidityPercent !== null
          ? `RH = ${env.outdoorRelativeHumidityPercent}%`
          : `P35 climate profile: ${p35Data.climateContext.profileName}`
      }) admitted into "${room.name}"${
        hasMoistureSensitiveFinish
          ? ` exposes moisture-sensitive interior finishes (${roomInterior?.wallFinish}, ${roomInterior?.floorFinish}) to dimensional swelling or mildew risk.`
          : ' increases indoor latent moisture load.'
      }`,
      linkedRoadmapFeature: 'P35',
      mitigationGuidance:
        'Cross-check interior finish selections in P35 Climate-Responsive Material Advisor (prefer mineral limewash, porcelain/travertine, or marine-sealed finishes in humid natural-ventilation zones).',
    });
  }

  // 5. Outdoor Air Quality / Smoke / Pollen
  if (
    openExteriorOpenings.length > 0 &&
    env.outdoorAirQualityCondition === 'poor-smoke-or-pollution-event'
  ) {
    items.push({
      tradeOffId: `to-iaq-${room.id}`,
      domain: 'outdoor-air-quality-smoke-pollen',
      severity: 'blocking-or-high-concern',
      title: 'Unfiltered Outdoor Smoke / Air Pollution Event',
      finding: `Scenario specifies poor outdoor air quality (smoke/particulate event). Unfiltered natural ventilation openings admit PM2.5 and outdoor pollutants directly into "${room.name}".`,
      linkedRoadmapFeature: 'P37',
      mitigationGuidance:
        'Close exterior natural ventilation openings during smoke/pollution events and rely on filtered mechanical ventilation or portable HEPA filtration.',
    });
  }

  // 6. Rain / Wind-Driven Rain Ingress
  const unprotectedOpenings = openExteriorOpenings.filter(
    (o) => {
      const rawOp = (project.naturalVentilation?.openings || []).find(
        (ro) => ro.openingId === o.openingId
      );
      return !rawOp || rawOp.rainProtectionKind === 'unprotected-direct-exposure';
    }
  );
  if (
    unprotectedOpenings.length > 0 &&
    (env.precipitationCondition === 'light-rain' ||
      env.precipitationCondition === 'wind-driven-rain-storm')
  ) {
    items.push({
      tradeOffId: `to-rain-${room.id}`,
      domain: 'rain-and-storm-ingress',
      severity:
        env.precipitationCondition === 'wind-driven-rain-storm'
          ? 'blocking-or-high-concern'
          : 'moderate-trade-off',
      title: 'Rain Ingress Risk at Unprotected Open Windows',
      finding: `Openings (${unprotectedOpenings.map((o) => o.label).join(', ')}) lack deep overhangs or weather-louvre protection during ${env.precipitationCondition.replace(/-/g, ' ')}.`,
      linkedRoadmapFeature: 'P35',
      mitigationGuidance:
        'Provide architectural canopy/overhang shading, top-hung awning sashes, or weather-protected louvres so background ventilation can continue during light rain.',
    });
  }

  // 7. Ground-Floor Night-Purge Security Constraint
  if (
    room.floorLevel === 1 &&
    openExteriorOpenings.length > 0 &&
    env.operatingScheduleMode === 'night-purge-cooling'
  ) {
    const unsecuredOpenings = openExteriorOpenings.filter((o) => {
      const rawOp = (project.naturalVentilation?.openings || []).find(
        (ro) => ro.openingId === o.openingId
      );
      return !rawOp?.hasSecurityRestrictorOrNightLatch;
    });
    if (unsecuredOpenings.length > 0) {
      items.push({
        tradeOffId: `to-security-${room.id}`,
        domain: 'security-and-night-purge',
        severity: 'moderate-trade-off',
        title: 'Ground-Floor Night-Purge Security & Intrusion Constraint',
        finding: `Ground-floor (Level 1) openings (${unsecuredOpenings.map((o) => o.label).join(', ')}) are open during night-purge cooling without security restrictors or louvred grilles.`,
        linkedRoadmapFeature: 'P37',
        mitigationGuidance:
          'Specify window opening restrictors (<= 100 mm clear gap), secure night-ventilation louvres, or high-level clerestory outlets for unattended night cooling.',
      });
    }
  }

  // 8. P34 Accessibility Hardware Reach & Door Width
  const p34FlaggedOpenings = evaluatedOpenings.filter((o) => o.p34AccessibilityConcernDetected);
  for (const op of p34FlaggedOpenings) {
    items.push({
      tradeOffId: `to-p34-${op.openingId}`,
      domain: 'accessibility-p34-hardware-and-doors',
      severity: 'moderate-trade-off',
      title: `Accessible Window/Door Operation Check (${op.label})`,
      finding:
        op.p34AccessibilityDetail ||
        `Opening "${op.label}" requires accessibility review for hardware reach height and operating force.`,
      linkedRoadmapFeature: 'P34',
      mitigationGuidance:
        'Ensure operable window controls and latches are located between 0.38 m and 1.22 m above the floor (or provide motorized/chain-winder controls) per P34 Universal Accessibility guidelines.',
    });
  }

  // 9. P33 Furniture Obstruction
  const p33FlaggedOpenings = evaluatedOpenings.filter((o) => o.p33FurnitureObstructionDetected);
  for (const op of p33FlaggedOpenings) {
    items.push({
      tradeOffId: `to-p33-${op.openingId}`,
      domain: 'furniture-p33-obstruction',
      severity: 'moderate-trade-off',
      title: `Furniture Placement Near Ventilation Opening (${op.label})`,
      finding:
        op.p33ObstructionDetail ||
        `Placed furniture in P33 stands immediately adjacent to "${op.label}", potentially obstructing sash operation or airflow distribution.`,
      linkedRoadmapFeature: 'P33',
      mitigationGuidance:
        'Maintain at least 0.60 m clear zone in front of operable windows and ventilation grilles in P33 Furniture & Circulation Intelligence.',
    });
  }

  return items;
}

/**
 * Domain H — Generates actionable, evidence-backed natural ventilation recommendations
 * with all 9 mandatory explanation attributes per P37 Section 7 Domain H.
 */
export function generateRoomVentilationRecommendations(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomVentilationConfig,
  roomGeometry: RoomVentilationGeometryResult,
  evaluatedOpenings: EvaluatedOpeningMetricsSI[],
  rawOpenings: VentilationOpeningRecord[],
  dominantStrategy: VentilationStrategyClassification,
  discoveredPaths: AirflowPathRecord[],
  modeAResult: GeometricVentilationPotentialResult,
  modeCResult: QuantifiedAirflowEstimateResult,
  tradeOffs: VentilationConstraintAndTradeOffItem[],
  scenario: NaturalVentilationScenario
): VentilationRecommendation[] {
  const recommendations: VentilationRecommendation[] = [];

  // 1. Missing Ceiling Height Recommendation (unlocks Volume V and Mode C ACH)
  if (roomGeometry.ceilingHeightMetres === null) {
    const defaultSuggestedHeight = project.unit === 'feet' ? 9.5 : 2.9;
    recommendations.push({
      recommendationId: `rec-height-${room.id}`,
      roomId: room.id,
      roomName: room.name,
      category: 'missing-geometry-or-condition-data',
      priority: 'high',
      title: `Specify Room Ceiling Height for "${room.name}" to Unlock Volume & ACH`,
      issueOrOpportunityAddressed:
        'Room ceiling height is currently unspecified because 2D floor-plan rooms store plan width and length only.',
      triggeringInputOrObservation: `roomConfigs["${room.id}"].ceilingHeight === null`,
      physicalRelevanceExplanation:
        'Air Changes Per Hour (ACH = Q × 3600 / V) and depth-to-height ventilation ratios (L/H) depend directly on 3D room volume V = A_floor × H_room.',
      requiredOperatingConditions: [
        'Verified or scenario-declared floor-to-ceiling clear height for the room.',
      ],
      supportingEvidence:
        'ASHRAE Fundamentals Ch. 16 volumetric air change definition and CIBSE AM10 L/H depth-to-height ratios.',
      remainingUnknowns: [
        'Exact structural soffit or suspended ceiling plenum depth if not yet detailed.',
      ],
      expectedBenefitKind: 'preliminary-estimated',
      expectedBenefitSummary: `Setting ceiling height to ${defaultSuggestedHeight} ${project.unit} establishes room volume V = ${round2(
        (roomGeometry.floorAreaM2 ?? 0) *
          (convertLengthToMetres(defaultSuggestedHeight, project.unit) ?? 2.9)
      )} m³ and enables Mode C ACH calculation.`,
      requiresArchitecturalDesignChange: false,
      multidisciplinaryTradeOffs: {
        acousticsAndNoiseP36:
          'Also unlocks Sabine reverberation time (RT60) volume calculation in P36 Acoustic Comfort Planner.',
        speechPrivacyP30P36: 'No adverse impact on partition speech privacy.',
        moistureAndMaterialsP35: 'Establishes gross wall surface area for P35 material takeoffs.',
        accessibilityAndReachP34: 'No impact on floor accessibility clearances.',
        furnitureAndCirculationP33: 'Establishes vertical head clearance for tall cabinetry.',
        rainSecurityAndMaintenance: 'Data completion only; no construction cost penalty.',
      },
      canPreviewAndApplyInPlotify: true,
      proposedMutation: {
        roomId: room.id,
        setRoomCeilingHeight: {
          ceilingHeight: defaultSuggestedHeight,
          heightUnit: project.unit,
          provenance: 'scenario-assumption',
        },
      },
    });
  }

  // 2. Unconfigured / Unknown Operability Opening Upgrade (e.g. P33 synced window or closed/unknown opening)
  const roomRawOpenings = rawOpenings.filter((o) => o.roomId === room.id);
  const unknownOrIncompleteExteriorOp = roomRawOpenings.find(
    (o) =>
      o.boundaryLocation === 'exterior-envelope' &&
      (o.operabilityStatus === 'unknown' ||
        o.grossHeight === null ||
        o.dischargeCoefficientCd === null)
  );

  if (unknownOrIncompleteExteriorOp) {
    const defaultH = project.unit === 'feet' ? 4.5 : 1.4;
    const defaultSill = project.unit === 'feet' ? 3.0 : 0.9;
    const widthM =
      convertLengthToMetres(
        unknownOrIncompleteExteriorOp.grossWidth ?? (project.unit === 'feet' ? 4.0 : 1.2),
        unknownOrIncompleteExteriorOp.dimensionUnit
      ) ?? 1.2;
    const heightM = convertLengthToMetres(defaultH, project.unit) ?? 1.4;
    const estFreeAreaM2 = round3(widthM * heightM * 0.65);

    recommendations.push({
      recommendationId: `rec-config-opening-${unknownOrIncompleteExteriorOp.openingId}`,
      roomId: room.id,
      roomName: room.name,
      category: 'opening-operability-upgrade',
      priority: 'high',
      title: `Configure Operable Casement/Awning Parameters for "${unknownOrIncompleteExteriorOp.label}"`,
      issueOrOpportunityAddressed: `Opening "${unknownOrIncompleteExteriorOp.label}" currently has incomplete 3D/operability parameters (operability=${unknownOrIncompleteExteriorOp.operabilityStatus}, height=${unknownOrIncompleteExteriorOp.grossHeight ?? 'unset'}, C_d=${unknownOrIncompleteExteriorOp.dischargeCoefficientCd ?? 'unset'}).`,
      triggeringInputOrObservation: `Opening "${unknownOrIncompleteExteriorOp.label}" synced from 2D plan lacks vertical height, openable fraction, or C_d.`,
      physicalRelevanceExplanation:
        'Orifice airflow Q = C_d · A_eff · sqrt(2·|ΔP|/ρ) requires known vertical opening height, operable sash fraction, sill elevation, and discharge coefficient C_d.',
      requiredOperatingConditions: [
        'Window sash must be physically operable and opened by occupants or automated actuators during favorable outdoor conditions.',
      ],
      supportingEvidence:
        'ASHRAE Fundamentals Ch. 16 sharp-edged orifice equation (typical C_d ≈ 0.62, operable casement clear fraction ≈ 0.65).',
      remainingUnknowns: [
        'Manufacturer-specific insect screen porosity and exact frame mullion profile.',
      ],
      expectedBenefitKind: 'preliminary-estimated',
      expectedBenefitSummary: `Provides ${estFreeAreaM2} m² of clear openable area (C_d = 0.62) on the ${unknownOrIncompleteExteriorOp.wallEdge.toUpperCase()} facade and activates Mode C airflow calculations.`,
      requiresArchitecturalDesignChange: false,
      multidisciplinaryTradeOffs: {
        acousticsAndNoiseP36:
          'When open, exterior glazing sound insulation is reduced; keep closed during peak street noise.',
        speechPrivacyP30P36: 'Exterior opening does not reduce internal room-to-room partition privacy.',
        moistureAndMaterialsP35:
          'Includes awning/overhang rain protection setting to reduce rain splash on interior sills.',
        accessibilityAndReachP34: `Sill height set to ${defaultSill} ${project.unit} (0.91 m), within accessible reach range (0.38 m – 1.22 m).`,
        furnitureAndCirculationP33:
          'Outward-opening casement/awning avoids encroaching on indoor furniture circulation.',
        rainSecurityAndMaintenance:
          'Configure with weather-protected awning/casement sash and restrictor latch.',
      },
      canPreviewAndApplyInPlotify: true,
      proposedMutation: {
        roomId: room.id,
        updateOpening: {
          openingId: unknownOrIncompleteExteriorOp.openingId,
          operabilityStatus: 'operable',
          mechanismType: 'casement-side-hung',
          grossHeight: unknownOrIncompleteExteriorOp.grossHeight ?? defaultH,
          maxOpenableFraction: unknownOrIncompleteExteriorOp.maxOpenableFraction ?? 0.65,
          sillElevation: unknownOrIncompleteExteriorOp.sillElevation ?? defaultSill,
          dischargeCoefficientCd: unknownOrIncompleteExteriorOp.dischargeCoefficientCd ?? 0.62,
          defaultScenarioState: 'fully-open',
          defaultScenarioOpenFraction: 1.0,
          rainProtectionKind: 'protected-by-overhang-or-louvre',
        },
      },
    });
  }

  // 3. Single-Sided or No-Path Room -> Add Cross-Ventilation or High-Level Stack Outlet
  if (
    dominantStrategy === 'single-sided' ||
    dominantStrategy === 'no-identified-path' ||
    dominantStrategy === 'insufficient-geometry-or-opening-data'
  ) {
    // Check if the room has a second exterior wall where a second operable window or high-level clerestory vent can be added
    const existingExtEdges = new Set(
      evaluatedOpenings
        .filter((o) => o.boundaryLocation === 'exterior-envelope')
        .map((o) => o.wallEdge)
    );
    const candidateSecondExtEdge = roomGeometry.exteriorWallEdges.find(
      (edge) => !existingExtEdges.has(edge)
    );

    if (candidateSecondExtEdge) {
      const wDefault = project.unit === 'feet' ? 4.0 : 1.2;
      const hDefault = project.unit === 'feet' ? 4.0 : 1.2;
      const sillDefault = project.unit === 'feet' ? 3.0 : 0.9;
      const newOpeningId = `p37-op-cross-${room.id}-${candidateSecondExtEdge}`;

      recommendations.push({
        recommendationId: `rec-add-cross-window-${room.id}`,
        roomId: room.id,
        roomName: room.name,
        category: 'cross-ventilation-transfer-path',
        priority: 'high',
        title: `Add Operable Exterior Opening on ${candidateSecondExtEdge.toUpperCase()} Facade to Enable Cross-Ventilation`,
        issueOrOpportunityAddressed: `Room "${room.name}" currently relies on ${dominantStrategy.replace(/-/g, ' ')} despite having exterior exposure on the ${candidateSecondExtEdge.toUpperCase()} wall.`,
        triggeringInputOrObservation: `Room has ${roomGeometry.exteriorWallEdges.length} exterior walls (${roomGeometry.exteriorWallEdges.join(', ')}), but operable openings are not active across two distinct facades.`,
        physicalRelevanceExplanation:
          'Adding an operable opening on a second exterior facade creates a windward-to-leeward pressure differential (ΔP_wind) and increases effective series orifice conductance.',
        requiredOperatingConditions: [
          'Both inlet and outlet facade openings must be open simultaneously under wind or buoyancy driving forces.',
        ],
        supportingEvidence:
          'CIBSE AM10 Cross-Ventilation Strategy (increases effective plan depth limit from 2.5H to 5.0H) and ASHRAE Ch. 16 series orifice flow.',
        remainingUnknowns: [
          'Local external wind shielding from neighboring structures or trees.',
        ],
        expectedBenefitKind: 'preliminary-estimated',
        expectedBenefitSummary: `Upgrades "${room.name}" strategy from '${dominantStrategy}' to 'cross-ventilation' and adds ~0.94 m² openable area on the ${candidateSecondExtEdge.toUpperCase()} facade.`,
        requiresArchitecturalDesignChange: true,
        multidisciplinaryTradeOffs: {
          acousticsAndNoiseP36:
            'Additional exterior glazing opening requires acoustic check if facing a road or mechanical plant.',
          speechPrivacyP30P36:
            'Achieves cross-ventilation directly through the exterior envelope without compromising internal partition privacy.',
          moistureAndMaterialsP35:
            'Requires exterior flashing, sill weatherproofing, and compatible facade trim.',
          accessibilityAndReachP34:
            'Sill elevation at 0.90 m keeps window latch within accessible reach range.',
          furnitureAndCirculationP33:
            'Requires keeping wall segment clear of tall wardrobes or shelving.',
          rainSecurityAndMaintenance:
            'Specify overhang/awning protection and window lock restrictor.',
        },
        canPreviewAndApplyInPlotify: true,
        proposedMutation: {
          roomId: room.id,
          addOpening: {
            openingId: newOpeningId,
            roomId: room.id,
            label: `${candidateSecondExtEdge.toUpperCase()} Cross-Ventilation Window`,
            category: 'window',
            boundaryLocation: 'exterior-envelope',
            wallEdge: candidateSecondExtEdge,
            floorLevel: room.floorLevel,
            operabilityStatus: 'operable',
            operabilityProvenance: 'scenario-assumption',
            mechanismType: 'casement-side-hung',
            grossWidth: wDefault,
            grossHeight: hDefault,
            dimensionUnit: project.unit,
            dimensionProvenance: 'scenario-assumption',
            explicitClearOpenableAreaInUnitSq: null,
            maxOpenableFraction: 0.65,
            openableFractionProvenance: 'scenario-assumption',
            screenOrGrilleFactor: 0.9,
            obstructionFactor: 1.0,
            sillElevation: sillDefault,
            headElevation: null,
            elevationProvenance: 'scenario-assumption',
            dischargeCoefficientCd: 0.62,
            cdProvenance: 'traceable-technical-reference',
            defaultScenarioState: 'fully-open',
            defaultScenarioOpenFraction: 1.0,
            rainProtectionKind: 'protected-by-overhang-or-louvre',
            hasSecurityRestrictorOrNightLatch: true,
          },
        },
      });
    } else if (roomGeometry.exteriorWallEdges.length >= 1) {
      // Single exterior wall only: propose high-level clerestory/hopper outlet to create vertical stack separation Δh
      const extEdge = roomGeometry.exteriorWallEdges[0];
      const wDefault = project.unit === 'feet' ? 4.0 : 1.2;
      const hDefault = project.unit === 'feet' ? 1.8 : 0.55;
      const highSill = project.unit === 'feet' ? 7.2 : 2.2;
      const stackOpeningId = `p37-op-clerestory-${room.id}-${extEdge}`;

      recommendations.push({
        recommendationId: `rec-add-stack-clerestory-${room.id}`,
        roomId: room.id,
        roomName: room.name,
        category: 'stack-or-high-level-outlet',
        priority: 'medium',
        title: `Add High-Level Clerestory Vent on ${extEdge.toUpperCase()} Wall for Single-Facet Buoyancy Stack`,
        issueOrOpportunityAddressed: `Room "${room.name}" only has exterior exposure on the ${extEdge.toUpperCase()} facade, limiting wind-driven cross-ventilation.`,
        triggeringInputOrObservation: `exteriorFacadeCount === 1 (${extEdge.toUpperCase()})`,
        physicalRelevanceExplanation:
          'Separating a low-level inlet and a high-level clerestory outlet vertically (Δh > 1.0 m) enables thermal buoyancy (stack effect) even when wind speed is zero.',
        requiredOperatingConditions: [
          'Requires a temperature difference |T_in - T_out| > 0 K and both low and high openings open.',
        ],
        supportingEvidence:
          'Hydrostatic buoyancy equation ΔP_stack = ρ · g · Δh · |T_in - T_out| / T_ref,K (ASHRAE Fundamentals Ch. 16 / CIBSE AM10).',
        remainingUnknowns: [
          'Requires remote chain actuator or pole operator because sill height (2.2 m) is above direct manual reach.',
        ],
        expectedBenefitKind: 'preliminary-estimated',
        expectedBenefitSummary:
          'Establishes vertical opening separation Δh >= 1.1 m to unlock stack-driven airflow under calm wind conditions.',
        requiresArchitecturalDesignChange: true,
        multidisciplinaryTradeOffs: {
          acousticsAndNoiseP36:
            'High-level awning/hopper vent can be lined with acoustic soffit baffles.',
          speechPrivacyP30P36: 'Preserves full internal partition privacy.',
          moistureAndMaterialsP35: 'Protected below roof overhang.',
          accessibilityAndReachP34:
            'Sill at 2.2 m exceeds manual reach (1.22 m max); MUST include wall-mounted switch or geared winder at 0.90 m height per P34.',
          furnitureAndCirculationP33: 'High-level placement avoids all floor furniture conflicts.',
          rainSecurityAndMaintenance:
            'High-level hopper/awning provides secure night-purge cooling with rain protection.',
        },
        canPreviewAndApplyInPlotify: true,
        proposedMutation: {
          roomId: room.id,
          addOpening: {
            openingId: stackOpeningId,
            roomId: room.id,
            label: `${extEdge.toUpperCase()} High-Level Clerestory Stack Vent`,
            category: 'vent',
            boundaryLocation: 'exterior-envelope',
            wallEdge: extEdge,
            floorLevel: room.floorLevel,
            operabilityStatus: 'operable',
            operabilityProvenance: 'scenario-assumption',
            mechanismType: 'awning-top-hung',
            grossWidth: wDefault,
            grossHeight: hDefault,
            dimensionUnit: project.unit,
            dimensionProvenance: 'scenario-assumption',
            explicitClearOpenableAreaInUnitSq: null,
            maxOpenableFraction: 0.75,
            openableFractionProvenance: 'scenario-assumption',
            screenOrGrilleFactor: 0.9,
            obstructionFactor: 1.0,
            sillElevation: highSill,
            headElevation: null,
            elevationProvenance: 'scenario-assumption',
            hardwareReachHeight: project.unit === 'feet' ? 3.2 : 1.0, // wall-mounted actuator height
            dischargeCoefficientCd: 0.62,
            cdProvenance: 'traceable-technical-reference',
            defaultScenarioState: 'fully-open',
            defaultScenarioOpenFraction: 1.0,
            rainProtectionKind: 'protected-by-overhang-or-louvre',
            hasSecurityRestrictorOrNightLatch: true,
          },
        },
      });
    }
  }

  // 4. Rain / Solar Shading Trade-off Recommendation
  const hasRainConflict = tradeOffs.some((t) => t.domain === 'rain-and-storm-ingress');
  if (hasRainConflict) {
    recommendations.push({
      recommendationId: `rec-shading-rain-${room.id}`,
      roomId: room.id,
      roomName: room.name,
      category: 'rain-and-solar-shading-protection',
      priority: 'medium',
      title: `Upgrade Facade Shading to Deep Overhangs / Louvers for Weather-Protected Ventilation`,
      issueOrOpportunityAddressed:
        'Unprotected exterior openings must be closed during rain events, interrupting natural ventilation.',
      triggeringInputOrObservation:
        'Scenario precipitation condition combined with unprotected exterior openings.',
      physicalRelevanceExplanation:
        'Architectural overhangs and external louvers shield upper sash openings from wind-driven rain while reducing direct solar heat gain.',
      requiredOperatingConditions: [
        'Overhang projection depth sized appropriately for window height and prevailing storm angle.',
      ],
      supportingEvidence: 'Passive climate-responsive envelope detailing (P35 / P37 coordination).',
      remainingUnknowns: ['Structural cantilever detailing and local wind uplift loads.'],
      expectedBenefitKind: 'qualitative',
      expectedBenefitSummary:
        'Allows background natural ventilation to remain partially open during light rain and reduces summer solar heat gain.',
      requiresArchitecturalDesignChange: true,
      multidisciplinaryTradeOffs: {
        acousticsAndNoiseP36: 'Underside of overhang can receive exterior-grade acoustic absorption.',
        speechPrivacyP30P36: 'No impact on internal privacy.',
        moistureAndMaterialsP35:
          'Protects facade cladding and window sills from wetting (improves P35 durability).',
        accessibilityAndReachP34: 'No impact on interior accessibility.',
        furnitureAndCirculationP33: 'Exterior element; no interior footprint impact.',
        rainSecurityAndMaintenance: 'Reduces water ingress risk during summer storms.',
      },
      canPreviewAndApplyInPlotify: true,
      proposedMutation: {
        roomId: room.id,
        proposedFacadeShadingStyle: 'deep-overhangs',
      },
    });
  }

  // 5. Outdoor Noise / Air Quality / Extreme Heat Hybrid Referral
  const hasHighNoiseOrSmokeOrHeat = tradeOffs.some(
    (t) =>
      t.severity === 'blocking-or-high-concern' &&
      (t.domain === 'outdoor-noise-p36-conflict' ||
        t.domain === 'outdoor-air-quality-smoke-pollen' ||
        t.domain === 'thermal-draft-or-overheating')
  );
  if (hasHighNoiseOrSmokeOrHeat) {
    recommendations.push({
      recommendationId: `rec-hybrid-mep-${room.id}`,
      roomId: room.id,
      roomName: room.name,
      category: 'hybrid-mechanical-or-specialist-referral',
      priority: 'advisory',
      title: `Consider Mixed-Mode / Filtered Mechanical Ventilation or Attenuated Ventilators for Adverse Conditions`,
      issueOrOpportunityAddressed:
        'Natural ventilation through unattenuated open windows conflicts with high outdoor noise, extreme outdoor heat (>30 °C), or outdoor smoke/particulate events.',
      triggeringInputOrObservation: tradeOffs
        .filter((t) => t.severity === 'blocking-or-high-concern')
        .map((t) => t.title)
        .join('; '),
      physicalRelevanceExplanation:
        'Direct facade openings cannot simultaneously maximize free airflow area, filter PM2.5 particulates, dehumidify humid air, and provide >30 dB sound insulation without acoustic attenuators or mechanical filtration.',
      requiredOperatingConditions: [
        'Mixed-mode controls that switch to filtered/attenuated ventilation when outdoor temperature, noise, or AQI exceed comfort thresholds.',
      ],
      supportingEvidence:
        'ASHRAE 62.1 / CIBSE AM10 Mixed-Mode Ventilation guidance and P36 Acoustic Comfort coordination.',
      remainingUnknowns: [
        'Detailed HVAC plant sizing, filter pressure drop, and acoustic louver insertion loss spectra.',
      ],
      expectedBenefitKind: 'qualitative',
      expectedBenefitSummary:
        'Maintains indoor air quality and acoustic/thermal comfort during hours when windows must remain closed.',
      requiresArchitecturalDesignChange: true,
      multidisciplinaryTradeOffs: {
        acousticsAndNoiseP36:
          'Preserves facade sound insulation while requiring P36 Domain F mechanical fan noise control.',
        speechPrivacyP30P36:
          'Ducted systems require crosstalk attenuators between quiet rooms.',
        moistureAndMaterialsP35:
          'Enables active dehumidification to protect P35 moisture-sensitive interior finishes.',
        accessibilityAndReachP34: 'Automated controls reduce manual window operation burden.',
        furnitureAndCirculationP33: 'Coordinate supply/extract grille locations with ceiling/wall layout.',
        rainSecurityAndMaintenance: 'Requires periodic filter replacement and fan maintenance.',
      },
      canPreviewAndApplyInPlotify: false,
    });
  }

  return recommendations;
}

/**
 * Evaluates a single room for a specific `NaturalVentilationScenario`, determining
 * supported Assessment Modes (Modes A, B, C, E), overall status, and completeness state.
 */
export function evaluateRoomForScenario(
  project: Project,
  room: FloorPlanRoom,
  nvData: ProjectNaturalVentilationData,
  scenario: NaturalVentilationScenario
): RoomScenarioVentilationEvaluation {
  const roomConfig: RoomVentilationConfig = nvData.roomConfigs[room.id] || {
    roomId: room.id,
    ceilingHeight: null,
    heightUnit: project.unit,
    ceilingHeightProvenance: 'unavailable-or-unverified',
    occupancyCountAssumption: null,
    occupancyProvenance: 'unavailable-or-unverified',
    hasVerticalAtriumOrStackConnection: false,
    verticalStackOutletElevationMetres: null,
    verticalStackOutletFreeAreaM2: null,
    updatedAt: '2026-10-26T00:00:00.000Z',
  };

  const allCriteria = [
    ...DEFAULT_VENTILATION_CRITERIA.filter(
      (dc) => !nvData.customCriteriaOverrides.some((cc) => cc.metric === dc.metric)
    ),
    ...nvData.customCriteriaOverrides,
  ];

  const openableRatioCriterion =
    allCriteria.find((c) => c.metric === 'openable-area-to-floor-area-percent') ||
    DEFAULT_VENTILATION_CRITERIA[0];
  const achCriterion =
    allCriteria.find((c) => c.metric === 'preliminary-air-changes-per-hour-ach') ||
    DEFAULT_VENTILATION_CRITERIA[1];
  const perPersonCriterion =
    allCriteria.find((c) => c.metric === 'outdoor-airflow-per-person-lps') ||
    DEFAULT_VENTILATION_CRITERIA[2];
  const perAreaCriterion =
    allCriteria.find((c) => c.metric === 'outdoor-airflow-per-floor-area-lps-m2') ||
    DEFAULT_VENTILATION_CRITERIA[3];

  const geometry = evaluateRoomVentilationGeometry(
    project,
    room,
    roomConfig,
    nvData.openings,
    scenario
  );

  const roomOpeningsRaw = nvData.openings.filter(
    (o) => o.roomId === room.id || o.connectedRoomId === room.id
  );
  const evaluatedOpenings = roomOpeningsRaw.map((op) =>
    evaluateOpeningForScenarioSI(project, room, geometry, op, scenario)
  );

  const { dominantStrategy, paths: discoveredAirflowPaths } = discoverRoomAirflowPaths(
    project,
    room,
    roomConfig,
    geometry,
    evaluatedOpenings,
    nvData.openings,
    scenario
  );

  const modeA_GeometricPotential = evaluateModeAGeometricPotential(
    geometry,
    evaluatedOpenings,
    openableRatioCriterion
  );

  const modeC_QuantifiedEstimate = evaluateModeCQuantifiedAirflowEstimate(
    roomConfig,
    geometry,
    discoveredAirflowPaths,
    scenario,
    {
      achCriterion,
      perPersonCriterion,
      perAreaCriterion,
    }
  );

  const domainF_ConstraintsAndTradeOffs = evaluateDomainFConstraintsAndTradeOffs(
    project,
    room,
    evaluatedOpenings,
    discoveredAirflowPaths,
    scenario
  );

  const domainH_Recommendations = generateRoomVentilationRecommendations(
    project,
    room,
    roomConfig,
    geometry,
    evaluatedOpenings,
    nvData.openings,
    dominantStrategy,
    discoveredAirflowPaths,
    modeA_GeometricPotential,
    modeC_QuantifiedEstimate,
    domainF_ConstraintsAndTradeOffs,
    scenario
  );

  // Determine supported Assessment Modes (Modes A, B, C, E)
  const supportedModes: VentilationAssessmentMode[] = [];
  if (modeA_GeometricPotential.totalMaxOpenableAreaM2 !== null) {
    supportedModes.push('mode-a-geometric-potential');
  }
  if (
    dominantStrategy !== 'insufficient-geometry-or-opening-data' &&
    evaluatedOpenings.length > 0
  ) {
    supportedModes.push('mode-b-qualitative-path-screening');
  }
  if (modeC_QuantifiedEstimate.isQuantifiedEstimateAvailable) {
    supportedModes.push('mode-c-quantified-preliminary-estimate');
  }
  if (supportedModes.length === 0) {
    supportedModes.push('mode-e-insufficient-data-guidance');
  }

  const primaryAssessmentMode: VentilationAssessmentMode =
    modeC_QuantifiedEstimate.isQuantifiedEstimateAvailable
      ? 'mode-c-quantified-preliminary-estimate'
      : supportedModes.includes('mode-b-qualitative-path-screening')
      ? 'mode-b-qualitative-path-screening'
      : supportedModes.includes('mode-a-geometric-potential')
      ? 'mode-a-geometric-potential'
      : 'mode-e-insufficient-data-guidance';

  // Missing evidence guidance
  const missingEvidenceGuidance: string[] = [
    ...geometry.validationIssues,
    ...geometry.missingGeometryDisclosures,
    ...evaluatedOpenings.flatMap((o) => o.missingDataDisclosures),
  ];
  if (!modeC_QuantifiedEstimate.isQuantifiedEstimateAvailable) {
    for (const reason of modeC_QuantifiedEstimate.unavailabilityReasons) {
      if (!missingEvidenceGuidance.includes(reason)) {
        missingEvidenceGuidance.push(reason);
      }
    }
  }

  // Completeness State & Evidence Coverage
  let evidencePoints = 0;
  const maxPoints = 5;
  if (geometry.floorAreaM2 !== null && geometry.floorAreaM2 > 0) evidencePoints += 1;
  if (geometry.isVolumeValid) evidencePoints += 1;
  if (modeA_GeometricPotential.totalMaxOpenableAreaM2 !== null) evidencePoints += 1;
  if (evaluatedOpenings.some((o) => o.cdTimesEffectiveAreaM2 !== null && o.cdTimesEffectiveAreaM2 > 0)) {
    evidencePoints += 1;
  }
  if (modeC_QuantifiedEstimate.isQuantifiedEstimateAvailable) evidencePoints += 1;

  const evidenceCoveragePercent = Math.round((evidencePoints / maxPoints) * 100);

  const allInputsVerified =
    modeC_QuantifiedEstimate.isQuantifiedEstimateAvailable &&
    geometry.ceilingHeightProvenance === 'measured-or-manufacturer-verified' &&
    scenario.environmentalConditions.provenance === 'measured-or-manufacturer-verified';

  const completenessState: VentilationCompletenessState = allInputsVerified
    ? 'verified-inputs'
    : modeC_QuantifiedEstimate.isQuantifiedEstimateAvailable
    ? 'sufficient-for-preliminary-estimate'
    : supportedModes.includes('mode-b-qualitative-path-screening') ||
      supportedModes.includes('mode-a-geometric-potential')
    ? 'sufficient-for-qualitative-screening'
    : 'insufficient-evidence';

  // Overall evaluation status
  const hasHighTradeOff = domainF_ConstraintsAndTradeOffs.some(
    (t) => t.severity === 'blocking-or-high-concern'
  );
  const hasModerateTradeOff = domainF_ConstraintsAndTradeOffs.some(
    (t) => t.severity === 'moderate-trade-off'
  );

  let overallStatus: VentilationEvaluationStatus = 'insufficient-evidence';
  if (completenessState === 'insufficient-evidence') {
    overallStatus = 'insufficient-evidence';
  } else if (
    dominantStrategy === 'no-identified-path' ||
    modeA_GeometricPotential.meetsOpenableAreaRatioTarget === false ||
    modeC_QuantifiedEstimate.meetsAchTarget === false
  ) {
    overallStatus = 'concern-identified';
  } else if (hasHighTradeOff) {
    overallStatus = 'concern-identified';
  } else if (hasModerateTradeOff || dominantStrategy === 'single-sided') {
    overallStatus = 'conditional-or-constrained';
  } else {
    overallStatus = 'favorable-for-scenario';
  }

  const influentialInputsSummary: string[] = [
    `Room Floor Area: ${geometry.floorAreaM2 ?? 'Unknown'} m² | Ceiling Height: ${
      geometry.ceilingHeightMetres !== null
        ? `${geometry.ceilingHeightMetres} m (${geometry.ceilingHeightProvenance})`
        : 'Unspecified'
    }`,
    `Dominant Strategy: ${dominantStrategy} (${discoveredAirflowPaths.filter((p) => p.isPathActiveInScenario).length} active path(s))`,
    `Scenario Effective Free Area (A_eff): ${
      modeA_GeometricPotential.totalScenarioEffectiveFreeAreaM2 !== null
        ? `${modeA_GeometricPotential.totalScenarioEffectiveFreeAreaM2} m²`
        : 'Incomplete opening data'
    }`,
    `Driving Forces (${scenario.name}): Wind v = ${
      scenario.environmentalConditions.windSpeedMetresPerSec ?? 'N/A'
    } m/s @ ${scenario.environmentalConditions.windDirectionDegFromNorth ?? 'N/A'}°, T_in = ${
      scenario.environmentalConditions.indoorTempCelsius ?? 'N/A'
    } °C, T_out = ${scenario.environmentalConditions.outdoorTempCelsius ?? 'N/A'} °C`,
  ];

  const inputFingerprint = `rm-${room.id}-${scenario.scenarioId}-${geometry.floorAreaM2 ?? 0}-${geometry.roomVolumeM3 ?? 0}-${modeA_GeometricPotential.totalScenarioEffectiveFreeAreaM2 ?? 'null'}-${modeC_QuantifiedEstimate.combinedFlowRateLitresPerSec ?? 'null'}`;

  return {
    evaluationId: `p37-eval-${room.id}-${scenario.scenarioId}`,
    projectId: project.id,
    roomId: room.id,
    roomName: room.name,
    roomType: room.type,
    floorLevel: room.floorLevel,
    scenarioId: scenario.scenarioId,
    scenarioName: scenario.name,
    evaluatedAt: new Date().toISOString(),
    calculationModelVersion: P37_NATURAL_VENTILATION_ENGINE_VERSION,
    inputFingerprint,
    primaryAssessmentMode,
    supportedModes,
    overallStatus,
    completenessState,
    evidenceCoveragePercent,
    geometry,
    evaluatedOpenings,
    dominantStrategy,
    discoveredAirflowPaths,
    modeA_GeometricPotential,
    modeC_QuantifiedEstimate,
    domainF_ConstraintsAndTradeOffs,
    domainH_Recommendations,
    missingEvidenceGuidance,
    influentialInputsSummary,
  };
}

/**
 * Mode D — Compares two ventilation scenarios for the same room side-by-side,
 * reporting strategy shifts, ΔA_eff, ΔQ, ΔACH, environmental condition differences, and trade-offs.
 */
export function compareRoomVentilationScenarios(
  baselineEval: RoomScenarioVentilationEvaluation,
  comparedEval: RoomScenarioVentilationEvaluation,
  baselineScenario: NaturalVentilationScenario,
  comparedScenario: NaturalVentilationScenario
): RoomVentilationScenarioComparisonResult {
  const conditionDifferencesDisclosed: string[] = [];
  const envA = baselineScenario.environmentalConditions;
  const envB = comparedScenario.environmentalConditions;

  if (envA.windSpeedMetresPerSec !== envB.windSpeedMetresPerSec) {
    conditionDifferencesDisclosed.push(
      `Wind speed changed from ${envA.windSpeedMetresPerSec ?? 'unset'} m/s to ${envB.windSpeedMetresPerSec ?? 'unset'} m/s.`
    );
  }
  if (envA.windDirectionDegFromNorth !== envB.windDirectionDegFromNorth) {
    conditionDifferencesDisclosed.push(
      `Wind direction changed from ${envA.windDirectionDegFromNorth ?? 'unset'}° to ${envB.windDirectionDegFromNorth ?? 'unset'}°.`
    );
  }
  if (
    envA.indoorTempCelsius !== envB.indoorTempCelsius ||
    envA.outdoorTempCelsius !== envB.outdoorTempCelsius
  ) {
    conditionDifferencesDisclosed.push(
      `Temperatures changed from (T_in=${envA.indoorTempCelsius ?? 'unset'} °C, T_out=${envA.outdoorTempCelsius ?? 'unset'} °C) to (T_in=${envB.indoorTempCelsius ?? 'unset'} °C, T_out=${envB.outdoorTempCelsius ?? 'unset'} °C).`
    );
  }
  if (envA.precipitationCondition !== envB.precipitationCondition) {
    conditionDifferencesDisclosed.push(
      `Precipitation changed from '${envA.precipitationCondition}' to '${envB.precipitationCondition}'.`
    );
  }
  if (envA.outdoorNoiseCondition !== envB.outdoorNoiseCondition) {
    conditionDifferencesDisclosed.push(
      `Outdoor noise condition changed from '${envA.outdoorNoiseCondition}' to '${envB.outdoorNoiseCondition}'.`
    );
  }

  const baseArea = baselineEval.modeA_GeometricPotential.totalScenarioEffectiveFreeAreaM2;
  const cmpArea = comparedEval.modeA_GeometricPotential.totalScenarioEffectiveFreeAreaM2;
  const deltaEffectiveFreeAreaM2 =
    baseArea !== null && cmpArea !== null ? round4(cmpArea - baseArea) : null;

  const baseFlow = baselineEval.modeC_QuantifiedEstimate.combinedFlowRateLitresPerSec;
  const cmpFlow = comparedEval.modeC_QuantifiedEstimate.combinedFlowRateLitresPerSec;
  const deltaFlowLitresPerSec =
    baseFlow !== null && cmpFlow !== null ? round2(cmpFlow - baseFlow) : null;

  const baseAch = baselineEval.modeC_QuantifiedEstimate.estimatedAch;
  const cmpAch = comparedEval.modeC_QuantifiedEstimate.estimatedAch;
  const deltaAch = baseAch !== null && cmpAch !== null ? round2(cmpAch - baseAch) : null;

  const strategyChanged = baselineEval.dominantStrategy !== comparedEval.dominantStrategy;

  const keyTradeOffShifts: string[] = [];
  const baseTradeIds = new Set(
    baselineEval.domainF_ConstraintsAndTradeOffs.map((t) => `${t.domain}:${t.severity}`)
  );
  for (const t of comparedEval.domainF_ConstraintsAndTradeOffs) {
    if (!baseTradeIds.has(`${t.domain}:${t.severity}`)) {
      keyTradeOffShifts.push(`[${t.severity.toUpperCase()}] ${t.title}: ${t.finding}`);
    }
  }

  const comparisonSummaryExplanation = `Comparing "${baselineScenario.name}" vs. "${comparedScenario.name}" for room "${baselineEval.roomName}": strategy ${
    strategyChanged
      ? `shifts from '${baselineEval.dominantStrategy}' to '${comparedEval.dominantStrategy}'`
      : `remains '${baselineEval.dominantStrategy}'`
  }. Effective free area ΔA_eff = ${
    deltaEffectiveFreeAreaM2 !== null
      ? `${deltaEffectiveFreeAreaM2 >= 0 ? '+' : ''}${deltaEffectiveFreeAreaM2} m²`
      : 'N/A'
  }, preliminary airflow ΔQ = ${
    deltaFlowLitresPerSec !== null
      ? `${deltaFlowLitresPerSec >= 0 ? '+' : ''}${deltaFlowLitresPerSec} L/s`
      : 'N/A'
  }, and ΔACH = ${
    deltaAch !== null ? `${deltaAch >= 0 ? '+' : ''}${deltaAch} h⁻¹` : 'N/A'
  }.`;

  return {
    mode: 'mode-d-scenario-comparison',
    roomId: baselineEval.roomId,
    roomName: baselineEval.roomName,
    baselineScenarioId: baselineScenario.scenarioId,
    baselineScenarioName: baselineScenario.name,
    comparedScenarioId: comparedScenario.scenarioId,
    comparedScenarioName: comparedScenario.name,
    areConditionsComparable:
      baselineEval.completenessState !== 'insufficient-evidence' &&
      comparedEval.completenessState !== 'insufficient-evidence',
    conditionDifferencesDisclosed,
    baselineStrategy: baselineEval.dominantStrategy,
    comparedStrategy: comparedEval.dominantStrategy,
    strategyChanged,
    baselineEffectiveFreeAreaM2: baseArea,
    comparedEffectiveFreeAreaM2: cmpArea,
    deltaEffectiveFreeAreaM2,
    baselineCombinedFlowLitresPerSec: baseFlow,
    comparedCombinedFlowLitresPerSec: cmpFlow,
    deltaFlowLitresPerSec,
    baselineAch: baseAch,
    comparedAch: cmpAch,
    deltaAch,
    baselineStatus: baselineEval.overallStatus,
    comparedStatus: comparedEval.overallStatus,
    keyTradeOffShifts,
    comparisonSummaryExplanation,
  };
}

/**
 * Exports a read-only summary of P37 Natural Ventilation performance for P31 Multi-Option Design Comparison.
 */
export function getP37NaturalVentilationSummaryForComparison(
  project: Project
): P37OptionVentilationComparisonSummary[] {
  const comparableOptions = extractComparableOptions(project);
  const nvData = initializeProjectNaturalVentilationData(project);
  const activeScenario =
    nvData.scenarios.find((s) => s.scenarioId === nvData.activeScenarioId) ||
    nvData.scenarios[0];
  const rooms = project.floorPlan?.rooms || [];

  const roomEvals = rooms.map((room) =>
    evaluateRoomForScenario(project, room, nvData, activeScenario)
  );

  const roomsEvaluatedCount = roomEvals.length;
  const roomsWithCrossOrStackPotentialCount = roomEvals.filter(
    (e) =>
      e.dominantStrategy === 'cross-ventilation' ||
      e.dominantStrategy === 'stack-buoyancy' ||
      e.dominantStrategy === 'combined-wind-and-stack' ||
      e.dominantStrategy === 'internal-transfer-assisted'
  ).length;
  const roomsSingleSidedOnlyCount = roomEvals.filter(
    (e) => e.dominantStrategy === 'single-sided'
  ).length;
  const roomsWithNoOperablePathCount = roomEvals.filter(
    (e) =>
      e.dominantStrategy === 'no-identified-path' ||
      e.dominantStrategy === 'insufficient-geometry-or-opening-data'
  ).length;
  const roomsWithQuantifiedEstimateCount = roomEvals.filter(
    (e) => e.modeC_QuantifiedEstimate.isQuantifiedEstimateAvailable
  ).length;

  const validRatios = roomEvals
    .map((e) => e.modeA_GeometricPotential.maxOpenableToFloorAreaPercent)
    .filter((v): v is number => v !== null);
  const averageOpenableToFloorAreaPercent =
    validRatios.length > 0
      ? round2(validRatios.reduce((a, b) => a + b, 0) / validRatios.length)
      : null;

  const validAch = roomEvals
    .map((e) => e.modeC_QuantifiedEstimate.estimatedAch)
    .filter((v): v is number => v !== null);
  const averageEstimatedAch =
    validAch.length > 0 ? round2(validAch.reduce((a, b) => a + b, 0) / validAch.length) : null;

  const overallCompletenessState: VentilationCompletenessState =
    roomsWithQuantifiedEstimateCount === roomsEvaluatedCount && roomsEvaluatedCount > 0
      ? 'sufficient-for-preliminary-estimate'
      : validRatios.length > 0
      ? 'sufficient-for-qualitative-screening'
      : 'insufficient-evidence';

  const optionsList =
    comparableOptions.length > 0
      ? comparableOptions
      : [
          {
            optionId: 'baseline-project',
            name: `${project.name} (Baseline)`,
          },
        ];

  return optionsList.map((opt) => ({
    optionId: opt.optionId,
    optionName: opt.name,
    calculationModelVersion: P37_NATURAL_VENTILATION_ENGINE_VERSION,
    activeScenarioName: activeScenario.name,
    roomsEvaluatedCount,
    roomsWithCrossOrStackPotentialCount,
    roomsSingleSidedOnlyCount,
    roomsWithNoOperablePathCount,
    roomsWithQuantifiedEstimateCount,
    averageOpenableToFloorAreaPercent,
    averageEstimatedAch,
    overallCompletenessState,
    comparabilityStatus:
      validRatios.length > 0 ? 'comparable-preliminary' : 'incomplete-ventilation-data',
    summaryExplanation:
      validRatios.length > 0
        ? `${roomsWithCrossOrStackPotentialCount}/${roomsEvaluatedCount} room(s) have cross/stack ventilation paths under "${activeScenario.name}" (mean openable ratio: ${averageOpenableToFloorAreaPercent}%${
            averageEstimatedAch !== null ? `, mean scenario ACH: ${averageEstimatedAch} h⁻¹` : ''
          }).`
        : `Ventilation opening dimensions and operability status are not yet fully configured across rooms; P31 comparison marks natural ventilation data as incomplete.`,
    caveats: [
      'Preliminary orifice/buoyancy screening only; not a CFD or statutory ASHRAE 62.1/62.2 compliance assessment.',
      'Opening operability and weather conditions are scenario-bound.',
    ],
  }));
}

/**
 * Top-level deterministic P37 evaluation across the project, active room, active scenario,
 * and comparison scenario, including read-only P30–P36 integrations.
 */
export function evaluateProjectNaturalVentilation(
  project: Project
): NaturalVentilationProjectEvaluationReport {
  const nvData = initializeProjectNaturalVentilationData(project);
  const currentFingerprint = computeNaturalVentilationSourceFingerprint(project, nvData);
  const isStale = Boolean(
    nvData.lastSourceFingerprint && nvData.lastSourceFingerprint !== currentFingerprint
  );
  const staleReasons: string[] = [];
  if (isStale) {
    staleReasons.push(
      'Room geometry, opening parameters, or scenario environmental conditions changed since the last saved P37 evaluation.'
    );
  }

  const rooms = project.floorPlan?.rooms || [];
  const activeScenario =
    nvData.scenarios.find((s) => s.scenarioId === nvData.activeScenarioId) ||
    nvData.scenarios[0];
  const comparisonScenario =
    (nvData.comparisonScenarioId
      ? nvData.scenarios.find((s) => s.scenarioId === nvData.comparisonScenarioId)
      : nvData.scenarios[1]) || null;

  const allRoomEvaluationsForActiveScenario = rooms.map((room) =>
    evaluateRoomForScenario(project, room, nvData, activeScenario)
  );

  const selectedRoomId =
    nvData.selectedRoomId && rooms.some((r) => r.id === nvData.selectedRoomId)
      ? nvData.selectedRoomId
      : rooms[0]?.id || null;

  const activeRoomEvaluation =
    allRoomEvaluationsForActiveScenario.find((e) => e.roomId === selectedRoomId) ||
    allRoomEvaluationsForActiveScenario[0] ||
    null;

  const activeRoomObj = rooms.find((r) => r.id === activeRoomEvaluation?.roomId) || null;
  const comparisonRoomEvaluation =
    activeRoomObj && comparisonScenario
      ? evaluateRoomForScenario(project, activeRoomObj, nvData, comparisonScenario)
      : null;

  const activeRoomScenarioComparison =
    activeRoomEvaluation && comparisonRoomEvaluation && comparisonScenario
      ? compareRoomVentilationScenarios(
          activeRoomEvaluation,
          comparisonRoomEvaluation,
          activeScenario,
          comparisonScenario
        )
      : null;

  // Read-only P30 Brief Integration
  const brief = initializeProjectBrief(project);
  const confirmedVentilationAndDaylightNotes: string[] = [];
  const unconfirmedBriefAssumptions: string[] = [];
  const isBriefApproved =
    brief.approvalStatus === 'client-approved' || brief.approvalStatus === 'locked';
  for (const space of brief.spaces || []) {
    if (space.naturalLightRequired || space.outdoorAccessRequired || space.notes) {
      const entry = `${space.name}: naturalLightRequired=${space.naturalLightRequired}, outdoorAccessRequired=${space.outdoorAccessRequired}, occupantCapacity=${space.occupantCapacity ?? 'unspecified'}`;
      if (isBriefApproved) {
        confirmedVentilationAndDaylightNotes.push(entry);
      } else {
        unconfirmedBriefAssumptions.push(`${entry} [Draft P30 requirement]`);
      }
    }
  }
  const spaceNameById = new Map<string, string>();
  for (const sp of brief.spaces || []) {
    spaceNameById.set(sp.id, sp.name);
  }
  const acousticIsolatedRoomPairs = (brief.relationships || [])
    .filter((rel) => rel.relationType === 'acoustic-isolated')
    .map((rel) => ({
      sourceName: spaceNameById.get(rel.sourceSpaceId) || rel.sourceSpaceId,
      targetName: spaceNameById.get(rel.targetSpaceId) || rel.targetSpaceId,
      priority: rel.priority,
    }));

  // Read-only P31 Option Comparison Summaries
  const p31OptionComparisonSummaries = getP37NaturalVentilationSummaryForComparison(project);

  // Read-only P32 Personalization Integration
  const p32Profile = initializePersonalizationProfile(project);
  const explicitNaturalLightAndAirflowWeight =
    p32Profile.spatialPriorityWeights?.naturalLightAndShading ?? null;
  const explicitPrivacyWeight =
    p32Profile.spatialPriorityWeights?.privacyAndZoneSeparation ?? null;
  const unconfirmedSuggestionsHeld = (p32Profile.items || [])
    .filter(
      (item) =>
        item.origin === 'inferred-suggestion' ||
        item.confirmationStatus === 'unconfirmed-suggestion'
    )
    .map((item) => `${item.label}: ${item.value} (${item.confirmationStatus} — held as non-binding in P37)`);

  // Read-only P33 Furniture & Openings Integration
  const furnitureData = ensureProjectFurnitureLayoutData(project);
  const obstructedOpeningsWarnings = allRoomEvaluationsForActiveScenario
    .flatMap((re) => re.evaluatedOpenings)
    .filter((o) => o.p33FurnitureObstructionDetected && o.p33ObstructionDetail)
    .map((o) => o.p33ObstructionDetail as string);

  // Read-only P34 Accessibility Integration
  const hardwareReachAndClearanceNotes = allRoomEvaluationsForActiveScenario
    .flatMap((re) => re.evaluatedOpenings)
    .filter((o) => o.p34AccessibilityConcernDetected && o.p34AccessibilityDetail)
    .map((o) => o.p34AccessibilityDetail as string);

  // Read-only P35 Climate & Material Integration
  const p35Data = initializeProjectMaterialAdvisorData(project);
  const moistureSensitiveMaterialWarnings = allRoomEvaluationsForActiveScenario
    .flatMap((re) => re.domainF_ConstraintsAndTradeOffs)
    .filter((t) => t.domain === 'humidity-moisture-p35-materials')
    .map((t) => t.finding);

  // Read-only P36 Acoustic Integration
  const outdoorNoiseConflictWarnings = allRoomEvaluationsForActiveScenario
    .flatMap((re) => re.domainF_ConstraintsAndTradeOffs)
    .filter((t) => t.domain === 'outdoor-noise-p36-conflict')
    .map((t) => t.finding);
  const internalTransferPrivacyWarnings = allRoomEvaluationsForActiveScenario
    .flatMap((re) => re.domainF_ConstraintsAndTradeOffs)
    .filter((t) => t.domain === 'internal-privacy-p36-p30-conflict')
    .map((t) => t.finding);

  const allCriteria = [
    ...DEFAULT_VENTILATION_CRITERIA.filter(
      (dc) => !nvData.customCriteriaOverrides.some((cc) => cc.metric === dc.metric)
    ),
    ...nvData.customCriteriaOverrides,
  ];

  return {
    evaluationId: `p37-proj-eval-${project.id}-${nvData.requestSequenceId}`,
    schemaVersion: P37_NATURAL_VENTILATION_SCHEMA_VERSION,
    calculationModelVersion: P37_NATURAL_VENTILATION_ENGINE_VERSION,
    projectId: project.id,
    projectName: project.name,
    unit: project.unit,
    evaluatedAt: new Date().toISOString(),
    requestSequenceId: nvData.requestSequenceId,
    sourceFingerprint: currentFingerprint,
    isStale,
    staleReasons,
    isConfigured: nvData.isConfigured,
    selectedRoomId,
    activeScenario,
    comparisonScenario,
    allScenarios: nvData.scenarios,
    activeRoomEvaluation,
    comparisonRoomEvaluation,
    activeRoomScenarioComparison,
    allRoomEvaluationsForActiveScenario,
    configuredCriteria: allCriteria,
    p30BriefIntegration: {
      hasBrief: Boolean(project.brief),
      confirmedVentilationAndDaylightNotes,
      unconfirmedBriefAssumptions,
      acousticIsolatedRoomPairs,
    },
    p31OptionComparisonSummaries,
    p32PersonalizationIntegration: {
      hasPersonalizationProfile: Boolean(project.designPersonalization),
      explicitNaturalLightAndAirflowWeight,
      explicitPrivacyWeight,
      unconfirmedSuggestionsHeld,
    },
    p33FurnitureAndOpeningsIntegration: {
      syncedP33OpeningsCount: (furnitureData.knownOpenings || []).length,
      placedFurnitureCount: (furnitureData.instances || []).length,
      obstructedOpeningsWarnings,
    },
    p34AccessibilityIntegration: {
      hasAccessibilityReview: Boolean(project.accessibilityReview),
      hardwareReachAndClearanceNotes,
    },
    p35ClimateAndMaterialIntegration: {
      climateIsConfigured: p35Data.climateContext.isConfigured,
      climateProfileName: p35Data.climateContext.profileName,
      noAutomaticWeatherInferenceNote:
        'P37 never infers site wind speed, wind direction, outdoor temperature, humidity, or air quality from a city name or P35 climate profile. All environmental conditions are explicit scenario inputs.',
      moistureSensitiveMaterialWarnings,
    },
    p36AcousticIntegration: {
      hasAcousticPlanner: Boolean(project.acousticPlanner),
      outdoorNoiseConflictWarnings,
      internalTransferPrivacyWarnings,
    },
    roadmapScopeBoundaries: [
      {
        roadmapId: 'P38',
        title: 'Daylight & Visual Comfort Analyzer (Not Implemented in P37)',
        boundaryStatement:
          'P37 analyzes window free area, orientation, and shading strictly for airflow and rain/thermal trade-offs; daylight factor, illuminance, and glare belong to P38.',
      },
      {
        roadmapId: 'P39',
        title: 'Design Rationale & Decision History (Not Implemented in P37)',
        boundaryStatement:
          'P37 records scenario assumptions and pre-apply snapshots for ventilation changes; project-wide decision rationale timelines belong to P39.',
      },
      {
        roadmapId: 'P40',
        title: 'Design Quality Benchmark & Improvement Loop (Not Implemented in P37)',
        boundaryStatement:
          'P37 does not compute a global multi-domain design quality benchmark score; that belongs to P40.',
      },
    ],
    professionalDisclaimer: P37_PROFESSIONAL_DISCLAIMER,
  };
}

/**
 * Generates a non-destructive preview diff (`VentilationProposalPreviewDiff`) for a P37 recommendation
 * without mutating the source `Project`.
 */
export function previewVentilationRecommendation(
  project: Project,
  recommendationId: string
): VentilationProposalPreviewDiff {
  const currentReport = evaluateProjectNaturalVentilation(project);
  const allRecs = currentReport.allRoomEvaluationsForActiveScenario.flatMap(
    (re) => re.domainH_Recommendations
  );
  const rec = allRecs.find((r) => r.recommendationId === recommendationId);

  if (!rec || !rec.canPreviewAndApplyInPlotify || !rec.proposedMutation) {
    return {
      proposalId: `p37-preview-invalid-${Date.now()}`,
      recommendationId,
      roomId: rec?.roomId || '',
      roomName: rec?.roomName || 'Unknown Room',
      title: rec?.title || 'Unsupported Recommendation',
      createdAt: new Date().toISOString(),
      sourceFingerprintAtPreview: currentReport.sourceFingerprint,
      isSafeToApply: false,
      blockingReasons: [
        'This recommendation is advisory/specialist-only or has no supported Plotify mutation payload.',
      ],
      warningNotices: [],
      p36AcousticPrivacyWarnings: [],
      p35MoistureMaterialWarnings: [],
      p34AccessibilityPreserved: true,
      p33FurnitureGeometryPreserved: true,
      p30AndP32Preserved: true,
      beforeStrategy: 'insufficient-geometry-or-opening-data',
      afterStrategy: 'insufficient-geometry-or-opening-data',
      beforeEffectiveFreeAreaM2: null,
      afterEffectiveFreeAreaM2: null,
      beforeEstimatedAch: null,
      afterEstimatedAch: null,
      beforeStatus: 'insufficient-evidence',
      afterStatus: 'insufficient-evidence',
      fieldChanges: [],
      proposedProjectClone: JSON.parse(JSON.stringify(project)) as Record<string, unknown>,
    };
  }

  const roomEvalBefore = currentReport.allRoomEvaluationsForActiveScenario.find(
    (re) => re.roomId === rec.roomId
  );

  // Deep clone project for non-destructive simulation
  const clonedProject: Project = JSON.parse(JSON.stringify(project));
  const nvData = initializeProjectNaturalVentilationData(clonedProject);
  const mut = rec.proposedMutation;
  const fieldChanges: VentilationProposalPreviewDiff['fieldChanges'] = [];

  if (mut.setRoomCeilingHeight) {
    const prevCfg = nvData.roomConfigs[mut.roomId];
    const beforeH = prevCfg?.ceilingHeight !== null && prevCfg?.ceilingHeight !== undefined
      ? `${prevCfg.ceilingHeight} ${prevCfg.heightUnit}`
      : 'null (unspecified)';
    const afterH = `${mut.setRoomCeilingHeight.ceilingHeight} ${mut.setRoomCeilingHeight.heightUnit} (${mut.setRoomCeilingHeight.provenance})`;

    nvData.roomConfigs[mut.roomId] = {
      ...(prevCfg || {
        roomId: mut.roomId,
        occupancyCountAssumption: null,
        occupancyProvenance: 'unavailable-or-unverified',
        hasVerticalAtriumOrStackConnection: false,
        verticalStackOutletElevationMetres: null,
        verticalStackOutletFreeAreaM2: null,
      }),
      ceilingHeight: mut.setRoomCeilingHeight.ceilingHeight,
      heightUnit: mut.setRoomCeilingHeight.heightUnit,
      ceilingHeightProvenance: mut.setRoomCeilingHeight.provenance,
      updatedAt: new Date().toISOString(),
    };

    fieldChanges.push({
      fieldPath: `naturalVentilation.roomConfigs.${mut.roomId}.ceilingHeight`,
      label: `Room Ceiling Height (${rec.roomName})`,
      beforeValue: beforeH,
      afterValue: afterH,
      changed: beforeH !== afterH,
    });
  }

  if (mut.updateOpening) {
    const uo = mut.updateOpening;
    const idx = nvData.openings.findIndex((o) => o.openingId === uo.openingId);
    if (idx >= 0) {
      const beforeOp = nvData.openings[idx];
      const afterOp: VentilationOpeningRecord = {
        ...beforeOp,
        operabilityStatus: uo.operabilityStatus ?? beforeOp.operabilityStatus,
        operabilityProvenance: uo.operabilityStatus ? 'user-entered' : beforeOp.operabilityProvenance,
        mechanismType: uo.mechanismType ?? beforeOp.mechanismType,
        grossHeight: uo.grossHeight !== undefined ? uo.grossHeight : beforeOp.grossHeight,
        dimensionProvenance:
          uo.grossHeight !== undefined ? 'user-entered' : beforeOp.dimensionProvenance,
        maxOpenableFraction:
          uo.maxOpenableFraction !== undefined
            ? uo.maxOpenableFraction
            : beforeOp.maxOpenableFraction,
        openableFractionProvenance:
          uo.maxOpenableFraction !== undefined
            ? 'user-entered'
            : beforeOp.openableFractionProvenance,
        sillElevation:
          uo.sillElevation !== undefined ? uo.sillElevation : beforeOp.sillElevation,
        elevationProvenance:
          uo.sillElevation !== undefined ? 'user-entered' : beforeOp.elevationProvenance,
        dischargeCoefficientCd:
          uo.dischargeCoefficientCd !== undefined
            ? uo.dischargeCoefficientCd
            : beforeOp.dischargeCoefficientCd,
        cdProvenance:
          uo.dischargeCoefficientCd !== undefined
            ? 'traceable-technical-reference'
            : beforeOp.cdProvenance,
        defaultScenarioState: uo.defaultScenarioState ?? beforeOp.defaultScenarioState,
        defaultScenarioOpenFraction:
          uo.defaultScenarioOpenFraction ?? beforeOp.defaultScenarioOpenFraction,
        rainProtectionKind: uo.rainProtectionKind ?? beforeOp.rainProtectionKind,
      };
      nvData.openings[idx] = afterOp;

      fieldChanges.push({
        fieldPath: `naturalVentilation.openings.${uo.openingId}`,
        label: `Opening "${beforeOp.label}" Operability & 3D Parameters`,
        beforeValue: `status=${beforeOp.operabilityStatus}, h=${beforeOp.grossHeight ?? 'null'}, frac=${beforeOp.maxOpenableFraction ?? 'null'}, C_d=${beforeOp.dischargeCoefficientCd ?? 'null'}`,
        afterValue: `status=${afterOp.operabilityStatus}, h=${afterOp.grossHeight ?? 'null'}, frac=${afterOp.maxOpenableFraction ?? 'null'}, C_d=${afterOp.dischargeCoefficientCd ?? 'null'}`,
        changed: true,
      });
    }
  }

  if (mut.addOpening) {
    const newOp = mut.addOpening;
    const exists = nvData.openings.some((o) => o.openingId === newOp.openingId);
    if (!exists) {
      nvData.openings.push(newOp);
      fieldChanges.push({
        fieldPath: `naturalVentilation.openings.${newOp.openingId}`,
        label: `New Ventilation Opening (${newOp.label})`,
        beforeValue: 'Not present',
        afterValue: `${newOp.category} on ${newOp.wallEdge.toUpperCase()} (${newOp.grossWidth}×${newOp.grossHeight} ${newOp.dimensionUnit}, operable=${newOp.operabilityStatus})`,
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
      label: 'Facade Shading & Weather Protection Style',
      beforeValue: beforeShading,
      afterValue: mut.proposedFacadeShadingStyle,
      changed: beforeShading !== mut.proposedFacadeShadingStyle,
    });
  }

  nvData.isConfigured = true;
  nvData.requestSequenceId = (nvData.requestSequenceId || 1) + 1;
  nvData.lastSourceFingerprint = computeNaturalVentilationSourceFingerprint(clonedProject, nvData);
  nvData.lastEvaluatedAt = new Date().toISOString();
  clonedProject.naturalVentilation = nvData;

  const afterReport = evaluateProjectNaturalVentilation(clonedProject);
  const roomEvalAfter = afterReport.allRoomEvaluationsForActiveScenario.find(
    (re) => re.roomId === rec.roomId
  );

  const p36AcousticPrivacyWarnings = (roomEvalAfter?.domainF_ConstraintsAndTradeOffs || [])
    .filter(
      (t) =>
        t.domain === 'outdoor-noise-p36-conflict' ||
        t.domain === 'internal-privacy-p36-p30-conflict'
    )
    .map((t) => t.finding);

  const p35MoistureMaterialWarnings = (roomEvalAfter?.domainF_ConstraintsAndTradeOffs || [])
    .filter((t) => t.domain === 'humidity-moisture-p35-materials')
    .map((t) => t.finding);

  const p34IssuesAfter = (roomEvalAfter?.evaluatedOpenings || []).some(
    (o) => o.p34AccessibilityConcernDetected
  );

  return {
    proposalId: `p37-preview-${rec.recommendationId}-${Date.now()}`,
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
      rec.multidisciplinaryTradeOffs.acousticsAndNoiseP36,
      rec.multidisciplinaryTradeOffs.accessibilityAndReachP34,
    ],
    p36AcousticPrivacyWarnings,
    p35MoistureMaterialWarnings,
    p34AccessibilityPreserved: !p34IssuesAfter,
    p33FurnitureGeometryPreserved: true,
    p30AndP32Preserved: true,
    beforeStrategy:
      roomEvalBefore?.dominantStrategy || 'insufficient-geometry-or-opening-data',
    afterStrategy:
      roomEvalAfter?.dominantStrategy || 'insufficient-geometry-or-opening-data',
    beforeEffectiveFreeAreaM2:
      roomEvalBefore?.modeA_GeometricPotential.totalScenarioEffectiveFreeAreaM2 ?? null,
    afterEffectiveFreeAreaM2:
      roomEvalAfter?.modeA_GeometricPotential.totalScenarioEffectiveFreeAreaM2 ?? null,
    beforeEstimatedAch: roomEvalBefore?.modeC_QuantifiedEstimate.estimatedAch ?? null,
    afterEstimatedAch: roomEvalAfter?.modeC_QuantifiedEstimate.estimatedAch ?? null,
    beforeStatus: roomEvalBefore?.overallStatus || 'insufficient-evidence',
    afterStatus: roomEvalAfter?.overallStatus || 'insufficient-evidence',
    fieldChanges,
    proposedProjectClone: clonedProject as unknown as Record<string, unknown>,
  };
}

/**
 * Atomically applies a previewed P37 ventilation proposal after creating a pre-apply snapshot checkpoint.
 * Rejects stale previews if the underlying project changed since the preview was generated.
 */
export function applyVentilationProposalAtomically(
  currentProject: Project,
  previewDiff: VentilationProposalPreviewDiff
): {
  applied: boolean;
  updatedProject: Project;
  snapshotId: string | null;
  evaluationReport: NaturalVentilationProjectEvaluationReport;
  message: string;
} {
  const liveFingerprint = computeNaturalVentilationSourceFingerprint(currentProject);

  if (previewDiff.sourceFingerprintAtPreview !== liveFingerprint) {
    const liveReport = evaluateProjectNaturalVentilation(currentProject);
    return {
      applied: false,
      updatedProject: currentProject,
      snapshotId: null,
      evaluationReport: liveReport,
      message:
        'Stale preview rejected: underlying project geometry, openings, or scenario state changed since this preview was generated. Please regenerate the preview before applying.',
    };
  }

  if (!previewDiff.isSafeToApply) {
    const liveReport = evaluateProjectNaturalVentilation(currentProject);
    return {
      applied: false,
      updatedProject: currentProject,
      snapshotId: null,
      evaluationReport: liveReport,
      message: `Cannot apply proposal: ${previewDiff.blockingReasons.join('; ')}`,
    };
  }

  // Create pre-apply snapshot checkpoint
  let snapshotId = `p37-snap-${Date.now()}`;
  try {
    const snap = createProjectSnapshot(currentProject, {
      trigger: 'auto-checkpoint',
      label: `Pre-P37 Natural Ventilation Apply: ${previewDiff.title}`,
      description: `Automatic checkpoint before applying P37 recommendation "${previewDiff.title}" on room "${previewDiff.roomName}".`,
    });
    if (snap && snap.id) {
      snapshotId = snap.id;
    }
  } catch {
    // Fallback for headless test environments without localStorage
  }
  memoryVentilationSnapshots.set(snapshotId, JSON.parse(JSON.stringify(currentProject)));

  const updatedProject: Project = JSON.parse(
    JSON.stringify(previewDiff.proposedProjectClone)
  ) as Project;
  const nvData = initializeProjectNaturalVentilationData(updatedProject);
  nvData.isConfigured = true;
  nvData.lastPreApplySnapshotId = snapshotId;
  nvData.requestSequenceId = (nvData.requestSequenceId || 1) + 1;
  nvData.lastEvaluatedAt = new Date().toISOString();
  nvData.lastSourceFingerprint = computeNaturalVentilationSourceFingerprint(updatedProject, nvData);
  updatedProject.naturalVentilation = nvData;
  updatedProject.updatedAt = new Date().toISOString();

  const evaluationReport = evaluateProjectNaturalVentilation(updatedProject);

  return {
    applied: true,
    updatedProject,
    snapshotId,
    evaluationReport,
    message: `Applied P37 Natural Ventilation change "${previewDiff.title}" with snapshot checkpoint (${snapshotId}).`,
  };
}

/**
 * Rolls back the project to the last pre-P37-apply snapshot checkpoint.
 */
export function rollbackLastVentilationApply(
  currentProject: Project
): {
  rolledBack: boolean;
  restoredProject: Project;
  message: string;
} {
  const snapshotId = currentProject.naturalVentilation?.lastPreApplySnapshotId;
  if (!snapshotId) {
    return {
      rolledBack: false,
      restoredProject: currentProject,
      message: 'No pre-apply P37 snapshot ID is recorded on this project.',
    };
  }

  const memSnap = memoryVentilationSnapshots.get(snapshotId);
  if (memSnap) {
    const restored: Project = JSON.parse(JSON.stringify(memSnap));
    return {
      rolledBack: true,
      restoredProject: restored,
      message: `Successfully rolled back project to pre-P37 snapshot (${snapshotId}).`,
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
          message: `Successfully rolled back project to pre-P37 snapshot (${snapshotId}).`,
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
