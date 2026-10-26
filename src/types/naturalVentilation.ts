/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P37 — Natural Ventilation Scenario Analyzer Type Contracts
 * Account A | Locked Roadmap: P37 of P30–P40
 *
 * Connects room geometry, building orientation, facade and internal openings,
 * room adjacency, vertical connectivity, user-entered or scenario-based
 * environmental conditions, and multidisciplinary constraints (P30–P36) to
 * explainable, deterministic natural ventilation potential, airflow-path
 * screening, preliminary orifice/stack/wind estimates, and scenario comparison
 * without pretending to be a CFD solver, wind-tunnel study, or statutory
 * compliance certification engine.
 */

import {
  FacadeConcept,
  InteriorRoomConcept,
  MeasurementUnit,
} from './project';
import { MaterialSuitabilityStatus } from './climateMaterialAdvisor';

export const P37_NATURAL_VENTILATION_ENGINE_VERSION = 'p37-natural-ventilation-analyzer-v1.0.0';
export const P37_NATURAL_VENTILATION_SCHEMA_VERSION = '1.0.0';

/**
 * Epistemic provenance states per P37 Section 6:
 * - 'measured-or-manufacturer-verified': Backed by physical site measurement or manufacturer product datasheet
 * - 'traceable-technical-reference': Published engineering handbook or standard method (e.g. ASHRAE Fundamentals Ch. 16, CIBSE AM10)
 * - 'user-entered': Explicitly entered by the user without third-party verification
 * - 'scenario-assumption': Explicit user-selected or exploratory "what-if" scenario parameter
 * - 'derived-from-project-geometry': Deterministically calculated from verified 2D/3D project coordinates
 * - 'unavailable-or-unverified': Missing, unknown, or unverified input
 */
export type VentilationEvidenceProvenance =
  | 'measured-or-manufacturer-verified'
  | 'traceable-technical-reference'
  | 'user-entered'
  | 'scenario-assumption'
  | 'derived-from-project-geometry'
  | 'unavailable-or-unverified';

/**
 * Completeness and assessment states per P37 Section 6.
 * Never uses a fabricated numerical probability of accuracy.
 */
export type VentilationCompletenessState =
  | 'verified-inputs'
  | 'sufficient-for-preliminary-estimate'
  | 'sufficient-for-qualitative-screening'
  | 'insufficient-evidence';

/**
 * Explicit P37 Assessment Modes per P37 Section 10:
 * - Mode A: Geometric Ventilation Potential (opening-to-floor area ratios, facade exposures, opening elevations)
 * - Mode B: Qualitative Airflow-Path Screening (single-sided, cross-ventilation, stack, internal transfer paths)
 * - Mode C: Quantified Preliminary Airflow Estimate (wind/stack orifice equations, effective series area, Q and ACH)
 * - Mode D: Scenario Comparison (side-by-side comparison of opening states, layouts, or environmental scenarios)
 * - Mode E: Insufficient-Data Guidance (identifies missing geometry, operability, or boundary conditions)
 */
export type VentilationAssessmentMode =
  | 'mode-a-geometric-potential'
  | 'mode-b-qualitative-path-screening'
  | 'mode-c-quantified-preliminary-estimate'
  | 'mode-d-scenario-comparison'
  | 'mode-e-insufficient-data-guidance';

/**
 * Standardized evaluation status labels per P37 Section 13.
 */
export type VentilationEvaluationStatus =
  | 'favorable-for-scenario'
  | 'conditional-or-constrained'
  | 'concern-identified'
  | 'insufficient-evidence'
  | 'unconfigured';

/**
 * Traceable technical reference metadata per P37 Section 6 & Section 18.
 */
export interface VentilationSourceMetadata {
  sourceId: string;
  publisher: string;
  title: string;
  editionOrYear: string;
  urlOrIdentifier: string;
  accessOrReviewDate: string;
  applicabilityNote: string;
  licenceOrUsageNote: string;
}

/**
 * Cardinal or intercardinal wall/facade orientation and compass azimuth in degrees from True North [0, 360).
 */
export type WallCardinalEdge = 'north' | 'south' | 'east' | 'west';

/**
 * Opening classification for Domain B per P37 Section 7.
 */
export type VentilationOpeningCategory =
  | 'window'
  | 'door'
  | 'louvre'
  | 'vent'
  | 'trickle-vent'
  | 'skylight'
  | 'stack-outlet'
  | 'internal-transfer-opening';

export type OpeningBoundaryLocation = 'exterior-envelope' | 'interior-partition' | 'roof-or-atrium';

/**
 * CRITICAL P37 RULE (Section 4 & Section 7 Domain B):
 * Never assume all windows or doors are operable from a generic label alone.
 */
export type OpeningOperabilityStatus = 'operable' | 'fixed' | 'unknown';

export type OpeningMechanismType =
  | 'casement-side-hung'
  | 'sliding-horizontal'
  | 'double-hung-vertical'
  | 'awning-top-hung'
  | 'hopper-bottom-hung'
  | 'tilt-and-turn'
  | 'louvred-jallousie'
  | 'pivot'
  | 'hinged-door'
  | 'transfer-grille-or-undercut'
  | 'fixed-glazing'
  | 'custom'
  | 'unknown';

export type ScenarioOpeningState = 'closed' | 'partially-open' | 'fully-open';

/**
 * Domain B — Ventilation Opening Record.
 * Can be linked to a P33 `KnownRoomOpening` (`linkedP33OpeningId`) or created directly in P37.
 * Explicitly separates gross opening dimensions from clear openable area and effective orifice area.
 */
export interface VentilationOpeningRecord {
  openingId: string;
  roomId: string;
  /** If interior-partition opening connects to a specific adjacent room */
  connectedRoomId?: string;
  /** Optional link to P33 KnownRoomOpening */
  linkedP33OpeningId?: string;
  label: string;
  category: VentilationOpeningCategory;
  boundaryLocation: OpeningBoundaryLocation;
  wallEdge: WallCardinalEdge;
  floorLevel: number;
  operabilityStatus: OpeningOperabilityStatus;
  operabilityProvenance: VentilationEvidenceProvenance;
  mechanismType: OpeningMechanismType;
  /**
   * Gross opening width in `dimensionUnit`.
   */
  grossWidth: number | null;
  /**
   * Gross opening height in `dimensionUnit`.
   * Note: P33 KnownRoomOpening only stores width; height is null until specified by the user or scenario!
   */
  grossHeight: number | null;
  dimensionUnit: MeasurementUnit;
  dimensionProvenance: VentilationEvidenceProvenance;
  /**
   * Optional explicit clear openable area in m² or sq ft (in `dimensionUnit` squared).
   * If null, calculated from grossWidth * grossHeight * maxOpenableFraction when both width and height are known.
   */
  explicitClearOpenableAreaInUnitSq: number | null;
  /**
   * Maximum geometric fraction of the gross opening that can physically open based on mechanism (in [0, 1]).
   * E.g. sliding window ~ 0.50, awning ~ 0.35–0.50, casement ~ 0.85–0.90, fixed = 0.0.
   * Null when unknown.
   */
  maxOpenableFraction: number | null;
  openableFractionProvenance: VentilationEvidenceProvenance;
  /**
   * Reduction factor for insect screens, security grilles, or guards (multiplier in (0, 1], where 1.0 = no screen reduction).
   */
  screenOrGrilleFactor: number;
  /**
   * Reduction factor for furniture, curtains, or partition obstructions near the opening (multiplier in (0, 1], where 1.0 = unobstructed).
   */
  obstructionFactor: number;
  /**
   * Sill elevation above room floor in `dimensionUnit` (required for vertical stack height Δh and P34 reach checks).
   * Null when unknown.
   */
  sillElevation: number | null;
  /**
   * Head elevation above room floor in `dimensionUnit`.
   * If null and sillElevation + grossHeight are known, derived as sillElevation + grossHeight.
   */
  headElevation: number | null;
  elevationProvenance: VentilationEvidenceProvenance;
  /**
   * Operating handle / hardware height above room floor in `dimensionUnit` (for P34 accessibility cross-check).
   */
  hardwareReachHeight?: number | null;
  /**
   * Orifice discharge coefficient C_d (dimensionless, typically ~0.60–0.65 for sharp-edged rectangular openings).
   * Null when unconfigured/unavailable.
   */
  dischargeCoefficientCd: number | null;
  cdProvenance: VentilationEvidenceProvenance;
  /**
   * Default operating state in baseline scenario ('closed' | 'partially-open' | 'fully-open').
   */
  defaultScenarioState: ScenarioOpeningState;
  /**
   * Opening deployment fraction in [0, 1] when state is 'partially-open' (1.0 when 'fully-open', 0.0 when 'closed').
   */
  defaultScenarioOpenFraction: number;
  /**
   * Weather / rain protection characteristic (e.g. deep overhang, awning sash, unprotected).
   */
  rainProtectionKind: 'protected-by-overhang-or-louvre' | 'awning-limited-rain-protection' | 'unprotected-direct-exposure';
  hasSecurityRestrictorOrNightLatch: boolean;
  notes?: string;
}

/**
 * Validated opening geometry and free-area metrics in SI units (m, m²) for a specific scenario.
 */
export interface EvaluatedOpeningMetricsSI {
  openingId: string;
  label: string;
  roomId: string;
  connectedRoomId?: string;
  category: VentilationOpeningCategory;
  boundaryLocation: OpeningBoundaryLocation;
  wallEdge: WallCardinalEdge;
  compassAzimuthDeg: number;
  operabilityStatus: OpeningOperabilityStatus;
  mechanismType: OpeningMechanismType;
  scenarioState: ScenarioOpeningState;
  scenarioOpenFraction: number;
  grossWidthMetres: number | null;
  grossHeightMetres: number | null;
  grossAreaM2: number | null;
  maxOpenableAreaM2: number | null;
  /**
   * Effective clear free area A_eff (m²) in the active scenario:
   * A_eff = A_openable_max * scenarioOpenFraction * screenOrGrilleFactor * obstructionFactor
   */
  effectiveScenarioFreeAreaM2: number | null;
  dischargeCoefficientCd: number | null;
  /**
   * Effective orifice conductance product (C_d * A_eff) in m² for airflow equations.
   */
  cdTimesEffectiveAreaM2: number | null;
  sillElevationMetres: number | null;
  headElevationMetres: number | null;
  /**
   * Opening mid-height (centroid) elevation above room floor in metres:
   * z_center = sillElevationMetres + 0.5 * grossHeightMetres (or 0.5 * (sill + head))
   */
  centroidElevationAboveFloorMetres: number | null;
  /**
   * Absolute centroid elevation above building datum (Ground Floor = 0.0 m) when story heights are known.
   */
  absoluteCentroidElevationMetres: number | null;
  p33FurnitureObstructionDetected: boolean;
  p33ObstructionDetail?: string;
  p34AccessibilityConcernDetected: boolean;
  p34AccessibilityDetail?: string;
  missingDataDisclosures: string[];
}

/**
 * Domain C — Airflow Path Strategy Classification per P37 Section 7 Domain C & Section 10.
 */
export type VentilationStrategyClassification =
  | 'single-sided'
  | 'cross-ventilation'
  | 'stack-buoyancy'
  | 'combined-wind-and-stack'
  | 'internal-transfer-assisted'
  | 'no-identified-path'
  | 'insufficient-geometry-or-opening-data';

/**
 * Discovered or evaluated airflow path segment for a room or multi-room route.
 */
export interface AirflowPathRecord {
  pathId: string;
  primaryRoomId: string;
  primaryRoomName: string;
  strategyType: VentilationStrategyClassification;
  isPathActiveInScenario: boolean;
  inletOpeningIds: string[];
  outletOpeningIds: string[];
  intermediateTransferOpeningIds: string[];
  traversedRoomIds: string[];
  traversedRoomNames: string[];
  inletWallEdges: WallCardinalEdge[];
  outletWallEdges: WallCardinalEdge[];
  /** Orientation difference Δθ in degrees between inlet and outlet facades [0, 180] */
  facadeAngleDifferenceDeg: number | null;
  /** Vertical elevation difference Δh = z_outlet - z_inlet in metres */
  verticalElevationSeparationMetres: number | null;
  /** Room plan depth along the primary airflow direction in metres */
  flowPathPlanLengthMetres: number | null;
  /** Ratio of room depth to ceiling height (L / H) for single-sided & cross-ventilation screening */
  depthToHeightRatio: number | null;
  /** Advisory depth-to-height screening note (e.g. CIBSE AM10 L <= 2.5H single-sided, L <= 5H cross-ventilation) */
  depthToHeightScreeningStatus: 'within-heuristic-limit' | 'exceeds-heuristic-limit' | 'height-unknown';
  depthToHeightExplanation: string;
  /** Effective series orifice area (C_d * A_eff)_series in m² when both inlet and outlet have valid C_d and A_eff */
  effectiveSeriesConductanceCdAM2: number | null;
  blockedOrClosedReasons: string[];
  internalDoorPrivacyTradeOffWarning?: string;
  conceptualDiagramVectors: Array<{
    fromXMetres: number;
    fromYMetres: number;
    toXMetres: number;
    toYMetres: number;
    pathKind: 'wind-cross' | 'single-sided-exchange' | 'stack-vertical' | 'internal-transfer' | 'blocked-door';
    label: string;
  }>;
  explanation: string;
}

/**
 * Domain D — Environmental and Operating Condition Scenario per P37 Section 7 Domain D.
 * CRITICAL RULE: Never inferred automatically from a city name or P35 climate regime!
 */
export interface EnvironmentalConditionScenario {
  conditionId: string;
  label: string;
  description: string;
  provenance: VentilationEvidenceProvenance;
  /** Outdoor wind speed v at building reference height in m/s (null when unknown/unspecified) */
  windSpeedMetresPerSec: number | null;
  windSpeedProvenance: VentilationEvidenceProvenance;
  /** Wind approach direction in degrees clockwise from True North [0, 360) (0 = North, 90 = East, 180 = South, 270 = West) */
  windDirectionDegFromNorth: number | null;
  windDirectionProvenance: VentilationEvidenceProvenance;
  /**
   * Wind pressure coefficient difference ΔC_p = C_p,windward - C_p,leeward (dimensionless).
   * Explicitly separated from CFD: represents a user-entered or textbook screening assumption for low-rise rectangular buildings.
   */
  assumedDeltaCp: number | null;
  deltaCpProvenance: VentilationEvidenceProvenance;
  shelterAndExposureAssumptionNote: string;
  /** Outdoor dry-bulb air temperature T_out in °C (null when unknown) */
  outdoorTempCelsius: number | null;
  /** Indoor air temperature T_in in °C (null when unknown) */
  indoorTempCelsius: number | null;
  temperatureProvenance: VentilationEvidenceProvenance;
  /** Outdoor relative humidity RH_out in % [0, 100] (null when unknown) */
  outdoorRelativeHumidityPercent: number | null;
  humidityProvenance: VentilationEvidenceProvenance;
  /** Air density ρ in kg/m³ (standard reference 1.204 kg/m³ at 20 °C, 101.325 kPa) */
  airDensityKgPerM3: number;
  airDensityProvenance: VentilationEvidenceProvenance;
  /** Outdoor acoustic environment condition (cross-checked with P36 noise observations) */
  outdoorNoiseCondition: 'quiet' | 'moderate-urban' | 'high-traffic-or-plant-noise' | 'unknown';
  /** Outdoor air quality / smoke / pollen condition */
  outdoorAirQualityCondition: 'clean-ambient' | 'moderate-pollen-or-urban' | 'poor-smoke-or-pollution-event' | 'unknown';
  /** Rain / wind-driven rain condition */
  precipitationCondition: 'dry' | 'light-rain' | 'wind-driven-rain-storm' | 'unknown';
  /** Operating mode / time of day */
  operatingScheduleMode: 'daytime-occupied' | 'night-purge-cooling' | 'peak-summer-afternoon' | 'winter-background-trickle';
  /**
   * Method for combining simultaneous wind and stack driving forces when both ΔP_wind and ΔP_stack are present:
   * - 'quadrature-pressure-addition': ΔP_total = ΔP_wind + ΔP_stack (or Q_total = sqrt(Q_wind^2 + Q_stack^2) for assisting flow)
   * - 'report-separately-and-dominant': Reports Q_wind and Q_stack separately and uses dominant or quadrature with explicit disclosure.
   * Never blindly sums Q_wind + Q_stack linearly!
   */
  combinedDrivingForceMethod: 'quadrature-flow-combination' | 'dominant-mechanism-conservative';
}

/**
 * Complete ventilation scenario definition (combines environmental conditions + per-opening state overrides).
 */
export interface NaturalVentilationScenario {
  scenarioId: string;
  name: string;
  description: string;
  isBaseline: boolean;
  environmentalConditions: EnvironmentalConditionScenario;
  /**
   * Per-opening state overrides for this scenario (keyed by openingId).
   * If omitted for an opening, the opening's `defaultScenarioState` and `defaultScenarioOpenFraction` are used.
   */
  openingStateOverrides: Record<
    string,
    {
      state: ScenarioOpeningState;
      openFraction: number;
    }
  >;
  createdAt: string;
}

/**
 * Domain E — Configurable Ventilation Criterion per P37 Section 7 Domain E & Section 9.
 * Never claims automatic statutory compliance from a generic ratio or ACH value.
 */
export interface ConfiguredVentilationCriterion {
  criterionId: string;
  metric:
    | 'openable-area-to-floor-area-percent'
    | 'outdoor-airflow-per-person-lps'
    | 'outdoor-airflow-per-floor-area-lps-m2'
    | 'preliminary-air-changes-per-hour-ach';
  label: string;
  minTarget: number;
  maxAdvisoryTarget: number | null;
  unit: '%' | 'L/(s·person)' | 'L/(s·m²)' | 'ACH (h⁻¹)';
  purposeScope: 'background-iaq-ventilation' | 'comfort-cooling-or-purge' | 'architectural-geometric-screening';
  authorityStatus: 'advisory-reference' | 'project-defined' | 'statutory-verified';
  jurisdictionOrStandard: string;
  applicabilityConditions: string;
  versionOrDate: string;
  provenance: VentilationEvidenceProvenance;
  sourceMetadata: VentilationSourceMetadata;
  nonComplianceGuaranteeNote: string;
}

/**
 * Room-specific natural ventilation configuration stored in `ProjectNaturalVentilationData`.
 */
export interface RoomVentilationConfig {
  roomId: string;
  /**
   * Explicit room ceiling height in `heightUnit`.
   * Synchronized with P36 `RoomAcousticConfig.ceilingHeight` when present so the user does not have to enter it twice,
   * while preserving exact provenance (`ceilingHeightProvenance`). Null when unknown.
   */
  ceilingHeight: number | null;
  heightUnit: MeasurementUnit;
  ceilingHeightProvenance: VentilationEvidenceProvenance;
  /**
   * Expected design occupancy count for per-person airflow screening (L/s per person).
   * Synchronized with P30 brief or P36 occupancy if available, or user-entered.
   */
  occupancyCountAssumption: number | null;
  occupancyProvenance: VentilationEvidenceProvenance;
  /**
   * Whether the room is connected to a vertical stack shaft, double-height void, or stairwell atrium.
   */
  hasVerticalAtriumOrStackConnection: boolean;
  verticalStackOutletElevationMetres: number | null;
  verticalStackOutletFreeAreaM2: number | null;
  /**
   * Custom room-level target overrides.
   */
  customMinOpenableFloorRatioPercent?: number | null;
  customTargetAch?: number | null;
  updatedAt: string;
}

/**
 * Domain A — Room Geometry and Orientation Validation Result in SI units (m, m², m³).
 */
export interface RoomVentilationGeometryResult {
  roomId: string;
  roomName: string;
  roomType: string;
  floorLevel: number;
  projectUnit: MeasurementUnit;
  widthMetres: number | null;
  lengthMetres: number | null;
  ceilingHeightMetres: number | null;
  ceilingHeightProvenance: VentilationEvidenceProvenance;
  floorAreaM2: number | null;
  roomVolumeM3: number | null;
  isVolumeValid: boolean;
  northOrientationOffsetDeg: number;
  exteriorWallEdges: WallCardinalEdge[];
  interiorSharedWalls: Array<{
    wallEdge: WallCardinalEdge;
    neighborRoomId: string;
    neighborRoomName: string;
    neighborRoomType: string;
    sharedLengthMetres: number;
    hasInternalOpening: boolean;
    hasOperableOpenTransferInScenario: boolean;
  }>;
  exteriorFacadeCount: number;
  hasOppositeExteriorFacades: boolean;
  hasAdjacentCornerExteriorFacades: boolean;
  validationIssues: string[];
  missingGeometryDisclosures: string[];
}

/**
 * Mode A — Geometric Ventilation Potential Result.
 */
export interface GeometricVentilationPotentialResult {
  mode: 'mode-a-geometric-potential';
  floorAreaM2: number | null;
  totalGrossOpeningAreaM2: number;
  totalMaxOpenableAreaM2: number | null;
  totalScenarioEffectiveFreeAreaM2: number | null;
  /** Ratio of max openable area to room floor area in % */
  maxOpenableToFloorAreaPercent: number | null;
  /** Ratio of active scenario effective free area to room floor area in % */
  scenarioEffectiveFreeAreaToFloorAreaPercent: number | null;
  openableRatioCriterion: ConfiguredVentilationCriterion;
  meetsOpenableAreaRatioTarget: boolean | null;
  operableExteriorOpeningsCount: number;
  fixedExteriorOpeningsCount: number;
  unknownOperabilityOpeningsCount: number;
  operableInternalTransferOpeningsCount: number;
  maxVerticalOpeningSeparationMetres: number | null;
  geometricPotentialStatus: VentilationEvaluationStatus;
  explanation: string;
}

/**
 * Mode C — Quantified Preliminary Airflow Estimate Result per P37 Section 11.
 */
export interface QuantifiedAirflowEstimateResult {
  mode: 'mode-c-quantified-preliminary-estimate';
  isQuantifiedEstimateAvailable: boolean;
  unavailabilityReasons: string[];
  /**
   * Wind-driven calculation details:
   * ΔP_wind = 0.5 * ρ * v^2 * ΔC_p (Pa)
   * Q_wind = (C_d * A_eff) * sqrt(2 * |ΔP_wind| / ρ) (m³/s)
   */
  windDriven: {
    isApplicable: boolean;
    windSpeedMetresPerSec: number | null;
    windDirectionDeg: number | null;
    incidenceAngleDegOnWindwardWall: number | null;
    effectiveDeltaCp: number | null;
    deltaPWindPascals: number | null;
    effectiveConductanceCdAM2: number | null;
    flowRateM3PerSec: number | null;
    flowRateLitresPerSec: number | null;
    formulaUsed: string;
    nonApplicableReason?: string;
  };
  /**
   * Stack / buoyancy-driven calculation details:
   * ΔP_stack = ρ * g * Δh * |T_in - T_out| / T_ref,K (Pa)
   * Q_stack = (C_d * A_eff)_series * sqrt(2 * |ΔP_stack| / ρ) (m³/s)
   */
  stackDriven: {
    isApplicable: boolean;
    verticalSeparationDeltaHMetres: number | null;
    indoorTempCelsius: number | null;
    outdoorTempCelsius: number | null;
    tempDifferenceAbsKelvin: number | null;
    deltaPStackPascals: number | null;
    effectiveSeriesConductanceCdAM2: number | null;
    flowRateM3PerSec: number | null;
    flowRateLitresPerSec: number | null;
    flowDirection: 'upward-warm-indoor-buoyancy' | 'downward-reverse-buoyancy' | 'neutral-no-delta-t' | 'not-applicable';
    formulaUsed: string;
    nonApplicableReason?: string;
  };
  /**
   * Combined preliminary airflow rate Q_combined:
   * Uses quadrature combination Q_combined = sqrt(Q_wind^2 + Q_stack^2) or dominant mechanism.
   * NEVER blindly adds Q_wind + Q_stack linearly!
   */
  combinedFlowRateM3PerSec: number | null;
  combinedFlowRateLitresPerSec: number | null;
  combinationMethodUsed: string;
  /**
   * Air Changes Per Hour:
   * ACH = (Q_combined * 3600) / V (h⁻¹)
   * Computed ONLY when both Q_combined and room volume V > 0 are valid.
   */
  estimatedAch: number | null;
  achFormulaUsed: string;
  /**
   * Per-person outdoor airflow rate (L/s per person) when occupancyCountAssumption > 0.
   */
  estimatedLitresPerSecPerPerson: number | null;
  /**
   * Per-unit-floor-area outdoor airflow rate (L/s per m²) when floorAreaM2 > 0.
   */
  estimatedLitresPerSecPerM2: number | null;
  achCriterion: ConfiguredVentilationCriterion;
  perPersonCriterion: ConfiguredVentilationCriterion;
  perAreaCriterion: ConfiguredVentilationCriterion;
  meetsAchTarget: boolean | null;
  meetsPerPersonTarget: boolean | null;
  meetsPerAreaTarget: boolean | null;
  steadyStateAssumptionsAndLimitations: string[];
  noCfdOrComplianceGuarantee: string;
  explanation: string;
}

/**
 * Domain F — Multidisciplinary Comfort, IAQ, Moisture, Acoustic, and Accessibility Trade-Off Item.
 */
export interface VentilationConstraintAndTradeOffItem {
  tradeOffId: string;
  domain:
    | 'outdoor-noise-p36-conflict'
    | 'internal-privacy-p36-p30-conflict'
    | 'thermal-draft-or-overheating'
    | 'humidity-moisture-p35-materials'
    | 'outdoor-air-quality-smoke-pollen'
    | 'rain-and-storm-ingress'
    | 'security-and-night-purge'
    | 'accessibility-p34-hardware-and-doors'
    | 'furniture-p33-obstruction';
  severity: 'blocking-or-high-concern' | 'moderate-trade-off' | 'favorable-or-clear';
  title: string;
  finding: string;
  linkedRoadmapFeature: 'P30' | 'P32' | 'P33' | 'P34' | 'P35' | 'P36' | 'P37';
  mitigationGuidance: string;
}

/**
 * Domain H — Actionable Natural Ventilation Recommendation per P37 Section 7 Domain H.
 * Includes all 9 mandatory explanation attributes plus optional safe preview/apply mutation.
 */
export type VentilationInterventionCategory =
  | 'opening-operability-upgrade'
  | 'cross-ventilation-transfer-path'
  | 'stack-or-high-level-outlet'
  | 'acoustic-attenuated-ventilation'
  | 'rain-and-solar-shading-protection'
  | 'furniture-obstruction-clearance'
  | 'accessible-window-controls'
  | 'missing-geometry-or-condition-data'
  | 'hybrid-mechanical-or-specialist-referral';

export interface VentilationRecommendation {
  recommendationId: string;
  roomId: string;
  roomName: string;
  category: VentilationInterventionCategory;
  priority: 'high' | 'medium' | 'advisory';
  title: string;
  /** 1. What ventilation limitation or opportunity it addresses */
  issueOrOpportunityAddressed: string;
  /** 2. Which geometric, opening, or scenario input triggered it */
  triggeringInputOrObservation: string;
  /** 3. Why the proposed intervention is physically relevant */
  physicalRelevanceExplanation: string;
  /** 4. Which boundary/operating conditions must hold for it to work */
  requiredOperatingConditions: string[];
  /** 5. What evidence or calculation supports the proposal */
  supportingEvidence: string;
  /** 6. What remains unknown or unverified */
  remainingUnknowns: string[];
  /** 7. Whether the expected benefit is qualitative, preliminary-estimated, or verified */
  expectedBenefitKind: 'qualitative' | 'preliminary-estimated' | 'verified';
  /** Quantified or qualitative summary of expected ΔA_eff, ΔQ, or ΔACH */
  expectedBenefitSummary: string;
  /** 8. Whether an architectural design modification is required */
  requiresArchitecturalDesignChange: boolean;
  /** 9. Explicit multidisciplinary trade-offs across noise (P36), privacy (P30/P36), materials/moisture (P35), accessibility (P34), furniture (P33), security, and cost */
  multidisciplinaryTradeOffs: {
    acousticsAndNoiseP36: string;
    speechPrivacyP30P36: string;
    moistureAndMaterialsP35: string;
    accessibilityAndReachP34: string;
    furnitureAndCirculationP33: string;
    rainSecurityAndMaintenance: string;
  };
  canPreviewAndApplyInPlotify: boolean;
  proposedMutation?: {
    roomId: string;
    /** Optional update to an existing opening's operability, height, or mechanism */
    updateOpening?: {
      openingId: string;
      operabilityStatus?: OpeningOperabilityStatus;
      mechanismType?: OpeningMechanismType;
      grossHeight?: number;
      maxOpenableFraction?: number;
      sillElevation?: number;
      dischargeCoefficientCd?: number;
      defaultScenarioState?: ScenarioOpeningState;
      defaultScenarioOpenFraction?: number;
      rainProtectionKind?: VentilationOpeningRecord['rainProtectionKind'];
    };
    /** Optional addition of a new ventilation opening (e.g. internal transfer grille/transom or high-level operable vent) */
    addOpening?: VentilationOpeningRecord;
    /** Optional update to room ceiling height if missing */
    setRoomCeilingHeight?: {
      ceilingHeight: number;
      heightUnit: MeasurementUnit;
      provenance: VentilationEvidenceProvenance;
    };
    /** Optional facade shading update on active design alternative */
    proposedFacadeShadingStyle?: FacadeConcept['shadingStyle'];
  };
}

/**
 * Complete room-level evaluation for a single scenario.
 */
export interface RoomScenarioVentilationEvaluation {
  evaluationId: string;
  projectId: string;
  roomId: string;
  roomName: string;
  roomType: string;
  floorLevel: number;
  scenarioId: string;
  scenarioName: string;
  evaluatedAt: string;
  calculationModelVersion: string;
  inputFingerprint: string;
  primaryAssessmentMode: VentilationAssessmentMode;
  supportedModes: VentilationAssessmentMode[];
  overallStatus: VentilationEvaluationStatus;
  completenessState: VentilationCompletenessState;
  evidenceCoveragePercent: number;
  geometry: RoomVentilationGeometryResult;
  evaluatedOpenings: EvaluatedOpeningMetricsSI[];
  dominantStrategy: VentilationStrategyClassification;
  discoveredAirflowPaths: AirflowPathRecord[];
  modeA_GeometricPotential: GeometricVentilationPotentialResult;
  modeC_QuantifiedEstimate: QuantifiedAirflowEstimateResult;
  domainF_ConstraintsAndTradeOffs: VentilationConstraintAndTradeOffItem[];
  domainH_Recommendations: VentilationRecommendation[];
  missingEvidenceGuidance: string[];
  influentialInputsSummary: string[];
}

/**
 * Mode D — Side-by-Side Scenario Comparison Result for a room.
 */
export interface RoomVentilationScenarioComparisonResult {
  mode: 'mode-d-scenario-comparison';
  roomId: string;
  roomName: string;
  baselineScenarioId: string;
  baselineScenarioName: string;
  comparedScenarioId: string;
  comparedScenarioName: string;
  areConditionsComparable: boolean;
  conditionDifferencesDisclosed: string[];
  baselineStrategy: VentilationStrategyClassification;
  comparedStrategy: VentilationStrategyClassification;
  strategyChanged: boolean;
  baselineEffectiveFreeAreaM2: number | null;
  comparedEffectiveFreeAreaM2: number | null;
  deltaEffectiveFreeAreaM2: number | null;
  baselineCombinedFlowLitresPerSec: number | null;
  comparedCombinedFlowLitresPerSec: number | null;
  deltaFlowLitresPerSec: number | null;
  baselineAch: number | null;
  comparedAch: number | null;
  deltaAch: number | null;
  baselineStatus: VentilationEvaluationStatus;
  comparedStatus: VentilationEvaluationStatus;
  keyTradeOffShifts: string[];
  comparisonSummaryExplanation: string;
}

/**
 * Non-destructive preview diff for applying a P37 ventilation recommendation or configuration change.
 */
export interface VentilationProposalPreviewDiff {
  proposalId: string;
  recommendationId?: string;
  roomId: string;
  roomName: string;
  title: string;
  createdAt: string;
  sourceFingerprintAtPreview: string;
  isSafeToApply: boolean;
  blockingReasons: string[];
  warningNotices: string[];
  p36AcousticPrivacyWarnings: string[];
  p35MoistureMaterialWarnings: string[];
  p34AccessibilityPreserved: boolean;
  p33FurnitureGeometryPreserved: boolean;
  p30AndP32Preserved: boolean;
  beforeStrategy: VentilationStrategyClassification;
  afterStrategy: VentilationStrategyClassification;
  beforeEffectiveFreeAreaM2: number | null;
  afterEffectiveFreeAreaM2: number | null;
  beforeEstimatedAch: number | null;
  afterEstimatedAch: number | null;
  beforeStatus: VentilationEvaluationStatus;
  afterStatus: VentilationEvaluationStatus;
  fieldChanges: Array<{
    fieldPath: string;
    label: string;
    beforeValue: string;
    afterValue: string;
    changed: boolean;
  }>;
  proposedProjectClone: Record<string, unknown>;
}

/**
 * Read-only P37 summary exposed for P31 Multi-Option Design Comparison per P37 Section 12.
 */
export interface P37OptionVentilationComparisonSummary {
  optionId: string;
  optionName: string;
  calculationModelVersion: string;
  activeScenarioName: string;
  roomsEvaluatedCount: number;
  roomsWithCrossOrStackPotentialCount: number;
  roomsSingleSidedOnlyCount: number;
  roomsWithNoOperablePathCount: number;
  roomsWithQuantifiedEstimateCount: number;
  averageOpenableToFloorAreaPercent: number | null;
  averageEstimatedAch: number | null;
  overallCompletenessState: VentilationCompletenessState;
  comparabilityStatus: 'comparable-preliminary' | 'incomplete-ventilation-data';
  summaryExplanation: string;
  caveats: string[];
}

/**
 * Persistent project-scoped P37 state stored on `Project.naturalVentilation`.
 */
export interface ProjectNaturalVentilationData {
  schemaVersion: string;
  calculationModelVersion: string;
  isConfigured: boolean;
  selectedRoomId?: string;
  activeScenarioId: string;
  comparisonScenarioId?: string;
  roomConfigs: Record<string, RoomVentilationConfig>;
  openings: VentilationOpeningRecord[];
  scenarios: NaturalVentilationScenario[];
  customCriteriaOverrides: ConfiguredVentilationCriterion[];
  lastEvaluatedAt?: string;
  lastSourceFingerprint?: string;
  lastPreApplySnapshotId?: string;
  requestSequenceId: number;
}

/**
 * Top-level P37 Natural Ventilation Scenario Analyzer project report.
 */
export interface NaturalVentilationProjectEvaluationReport {
  evaluationId: string;
  schemaVersion: string;
  calculationModelVersion: string;
  projectId: string;
  projectName: string;
  unit: MeasurementUnit;
  evaluatedAt: string;
  requestSequenceId: number;
  sourceFingerprint: string;
  isStale: boolean;
  staleReasons: string[];
  isConfigured: boolean;
  selectedRoomId: string | null;
  activeScenario: NaturalVentilationScenario;
  comparisonScenario: NaturalVentilationScenario | null;
  allScenarios: NaturalVentilationScenario[];
  activeRoomEvaluation: RoomScenarioVentilationEvaluation | null;
  comparisonRoomEvaluation: RoomScenarioVentilationEvaluation | null;
  activeRoomScenarioComparison: RoomVentilationScenarioComparisonResult | null;
  allRoomEvaluationsForActiveScenario: RoomScenarioVentilationEvaluation[];
  configuredCriteria: ConfiguredVentilationCriterion[];
  p30BriefIntegration: {
    hasBrief: boolean;
    confirmedVentilationAndDaylightNotes: string[];
    unconfirmedBriefAssumptions: string[];
    acousticIsolatedRoomPairs: Array<{ sourceName: string; targetName: string; priority: string }>;
  };
  p31OptionComparisonSummaries: P37OptionVentilationComparisonSummary[];
  p32PersonalizationIntegration: {
    hasPersonalizationProfile: boolean;
    explicitNaturalLightAndAirflowWeight: number | null;
    explicitPrivacyWeight: number | null;
    unconfirmedSuggestionsHeld: string[];
  };
  p33FurnitureAndOpeningsIntegration: {
    syncedP33OpeningsCount: number;
    placedFurnitureCount: number;
    obstructedOpeningsWarnings: string[];
  };
  p34AccessibilityIntegration: {
    hasAccessibilityReview: boolean;
    hardwareReachAndClearanceNotes: string[];
  };
  p35ClimateAndMaterialIntegration: {
    climateIsConfigured: boolean;
    climateProfileName: string;
    noAutomaticWeatherInferenceNote: string;
    moistureSensitiveMaterialWarnings: string[];
  };
  p36AcousticIntegration: {
    hasAcousticPlanner: boolean;
    outdoorNoiseConflictWarnings: string[];
    internalTransferPrivacyWarnings: string[];
  };
  roadmapScopeBoundaries: Array<{
    roadmapId: string;
    title: string;
    boundaryStatement: string;
  }>;
  professionalDisclaimer: string;
}
