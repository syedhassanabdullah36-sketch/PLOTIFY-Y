/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P38 — Daylight & Visual Comfort Analyzer Type Contracts
 * Account A | Locked Roadmap: P38 of P30–P40
 *
 * Connects room geometry, window placement, glazing optical properties,
 * interior surface reflectances, external obstructions, site orientation,
 * solar position, and shading devices to explainable, deterministic
 * daylight availability, direct-sun/shadow geometry, qualitative glare and
 * view-out screening, and scenario comparison without fabricating illuminance,
 * annual climate-based metrics (sDA/ASE/UDI), or Daylight Glare Probability (DGP).
 */

import {
  FacadeConcept,
  InteriorRoomConcept,
  MeasurementUnit,
} from './project';
import { WallCardinalEdge } from './naturalVentilation';

export const P38_DAYLIGHT_ANALYZER_ENGINE_VERSION = 'p38-daylight-visual-comfort-v1.0.0';
export const P38_DAYLIGHT_SCHEMA_VERSION = '1.0.0';

/**
 * Epistemic provenance states per P38 Section 5.2:
 * - 'measured-on-site': Physical site illuminance/luminance or reflectance measurement
 * - 'manufacturer-or-lab-test': Certified manufacturer or laboratory optical datasheet (e.g. EN 410 / NFRC 200)
 * - 'traceable-generic-reference': Published engineering handbook or standard reference value (e.g. CIBSE LG10, IES Handbook)
 * - 'derived-from-project-geometry': Deterministically calculated from verified 2D/3D project coordinates
 * - 'user-entered': Explicitly entered by the user without third-party laboratory verification
 * - 'imported-weather-or-sky': Imported standard sky or weather boundary condition
 * - 'illustrative-scenario-assumption': Exploratory "what-if" scenario parameter
 * - 'calculated-result': Deterministically computed output from a documented P38 calculation method
 * - 'unavailable-or-unverified': Missing, unknown, or unverified input
 */
export type DaylightEvidenceProvenance =
  | 'measured-on-site'
  | 'manufacturer-or-lab-test'
  | 'traceable-generic-reference'
  | 'derived-from-project-geometry'
  | 'user-entered'
  | 'imported-weather-or-sky'
  | 'illustrative-scenario-assumption'
  | 'calculated-result'
  | 'unavailable-or-unverified';

/**
 * Explicit result-completeness states per P38 Section 5.3.
 * Never reduced to a single opaque green/red score.
 */
export type DaylightCompletenessState =
  | 'sufficient-for-geometric-screening'
  | 'sufficient-for-solar-position-screening'
  | 'sufficient-for-simplified-calculation'
  | 'sufficient-for-climate-based-simulation'
  | 'insufficient-evidence'
  | 'unsupported-model-or-geometry'
  | 'invalid-input'
  | 'stale-result'
  | 'calculation-failed'
  | 'awaiting-required-environmental-data';

/**
 * Explicit P38 Assessment Modes per P38 Section 9:
 * - Mode A: Geometric Daylight Potential (WFR, glazed area, depth ratio, orientation, shading presence)
 * - Mode B: Solar Position and Direct-Sun Screening (solar altitude/azimuth, overhang/fin shadow, sun patch depth)
 * - Mode C: Simplified Daylight Calculation (BRE/CIBSE Split-Flux Mean Daylight Factor under CIE Overcast Sky & work-plane point proxy)
 * - Mode D: Climate-Based Annual Daylight Modelling (sDA, ASE, DA, UDI — explicitly reported as unsupported without a validated annual Radiance/climate engine)
 * - Mode E: Visual Comfort, Glare and View Out (direct-sun glare screening, contrast screening, horizontal view-out angle, DGP limitation disclosure)
 * - Mode F: Scenario Comparison (side-by-side comparison of glazing, shading, reflectance, or solar scenarios)
 */
export type DaylightAssessmentMode =
  | 'mode-a-geometric-potential'
  | 'mode-b-solar-position-and-shading'
  | 'mode-c-simplified-daylight-calculation'
  | 'mode-d-climate-based-annual-simulation'
  | 'mode-e-visual-comfort-glare-and-view'
  | 'mode-f-scenario-comparison';

export type DaylightEvaluationStatus =
  | 'favorable-for-screened-criteria'
  | 'conditional-or-tradeoff-identified'
  | 'concern-identified'
  | 'insufficient-evidence'
  | 'unsupported-method'
  | 'invalid-input';

/**
 * Traceable technical reference metadata per P38 Section 5.2 & Section 19.
 */
export interface DaylightSourceMetadata {
  sourceId: string;
  publisher: string;
  title: string;
  editionOrVersion: string;
  urlOrIdentifier: string;
  accessDate: string;
  relevantConditions: string;
  unitsNote: string;
  applicabilityAndScopeNote: string;
}

/**
 * Glazing assembly classification per P38 Section 7.
 * CRITICAL RULE: A generic glass label never automatically assigns a verified VT/Tvis value.
 */
export type GlazingAssemblyKind =
  | 'single-clear-glass'
  | 'double-clear-igu'
  | 'double-low-e-solar-control'
  | 'triple-low-e-igu'
  | 'tinted-or-reflective-glass'
  | 'translucent-fritted-or-diffusing'
  | 'custom-product-glazing'
  | 'unknown-glazing';

/**
 * Exterior & interior shading device configuration per P38 Section 7, 8 & 12.
 */
export type ExteriorShadingDeviceType =
  | 'none'
  | 'horizontal-overhang'
  | 'vertical-side-fins'
  | 'combined-overhang-and-fins'
  | 'external-louvers-brise-soleil';

export type InteriorShadingDeviceType =
  | 'none'
  | 'sheer-diffusing-roller-blind'
  | 'venetian-slat-blind'
  | 'blackout-opaque-roller-shade';

export type MovableShadingDeploymentState =
  | 'retracted-open'
  | 'partially-deployed'
  | 'fully-deployed-closed';

/**
 * P38 Window, Glazing, and Shading Record per P38 Section 7 & 8.
 * Can be linked to a P33 `KnownRoomOpening` or P37 `VentilationOpeningRecord`.
 * Explicitly separates gross opening dimensions from frame fraction, net glazed area, and optical VT.
 */
export interface DaylightWindowRecord {
  windowId: string;
  roomId: string;
  linkedP33OpeningId?: string;
  linkedP37OpeningId?: string;
  label: string;
  wallEdge: WallCardinalEdge;
  floorLevel: number;
  /** Offset along the room wall from top-left corner in `dimensionUnit` */
  offsetAlongWall: number | null;
  /** Gross opening width in `dimensionUnit` (null if unknown) */
  grossWidth: number | null;
  /** Gross opening height in `dimensionUnit` (null if unknown — never invented from width alone!) */
  grossHeight: number | null;
  /** Sill height above room floor in `dimensionUnit` (null if unknown) */
  sillHeight: number | null;
  /** Head height above room floor in `dimensionUnit` (derived as sillHeight + grossHeight when both known) */
  headHeight: number | null;
  dimensionUnit: MeasurementUnit;
  dimensionProvenance: DaylightEvidenceProvenance;
  /**
   * Framing fraction f_frame in [0, 1) representing opaque frame/mullions as a fraction of gross opening area.
   * E.g. 0.15 means 15% opaque frame and 85% net transparent glazing.
   * Null if unknown and explicitGlazedAreaInUnitSq is not provided.
   */
  frameFraction: number | null;
  frameFractionProvenance: DaylightEvidenceProvenance;
  /**
   * Optional explicit net glazed area in `dimensionUnit` squared (sq ft or m²).
   * If null, computed as grossWidth * grossHeight * (1 - frameFraction) when all three are valid.
   */
  explicitGlazedAreaInUnitSq: number | null;
  /**
   * Visible Light Transmittance (VT / T_vis) at normal incidence in (0, 1].
   * CRITICAL P38 GUARDRAIL: Never inferred from U-factor, SHGC, or a generic glass label!
   */
  visibleTransmittanceVT: number | null;
  vtProvenance: DaylightEvidenceProvenance;
  vtSourceProductAndVersion?: string;
  vtSourceConditionsNote?: string;
  /** Optional thermal U-factor (W/(m²·K)) stored strictly to verify P38 never infers VT from U-factor */
  reportedUFactorWPerM2K?: number | null;
  /** Optional Solar Heat Gain Coefficient (SHGC / g-value) stored strictly to verify P38 never infers VT from SHGC */
  reportedShgc?: number | null;
  glazingAssemblyKind: GlazingAssemblyKind;
  /** Maintenance / dirt depreciation factor M in (0, 1] (typically 0.85–0.95 for vertical glazing) */
  maintenanceFactorM: number;
  maintenanceProvenance: DaylightEvidenceProvenance;
  /** Window reveal / recess depth in `dimensionUnit` (0 if flush) */
  revealDepth: number;
  /** Exterior fixed or operable shading configuration */
  exteriorShadingType: ExteriorShadingDeviceType;
  /** Horizontal overhang projection depth P_overhang perpendicular to facade in `dimensionUnit` */
  overhangProjectionDepth: number | null;
  /** Vertical gap between window head and overhang underside in `dimensionUnit` (0 if mounted at window head) */
  overhangHeightAboveWindowHead: number;
  /** Vertical side-fin projection depth P_fin perpendicular to facade in `dimensionUnit` */
  sideFinProjectionDepth: number | null;
  /** Exterior louver slat cut-off profile angle in degrees (when exteriorShadingType === 'external-louvers-brise-soleil') */
  exteriorLouverCutoffAngleDeg: number | null;
  /** Interior blind/shade configuration */
  interiorShadingType: InteriorShadingDeviceType;
  defaultBlindState: MovableShadingDeploymentState;
  /**
   * Visible light transmittance multiplier of the interior blind when deployed in (0, 1].
   * Null when unknown (P38 never assumes a blind transmits a known % unless specified!).
   */
  interiorBlindTransmittanceMultiplier: number | null;
  interiorBlindProvenance: DaylightEvidenceProvenance;
  /** Operability status preserved for P37 cross-check ('operable' | 'fixed' | 'unknown') */
  operabilityStatus: 'operable' | 'fixed' | 'unknown';
  /** Hardware / blind control height in `dimensionUnit` for P34 accessibility reach check */
  controlReachHeight?: number | null;
  notes?: string;
}

/**
 * External Obstruction Record (e.g. opposite building, courtyard wall, terrain bank) per P38 Section 8.
 * CRITICAL RULE: Never manufactured from an unverified assumption!
 */
export interface ExternalObstructionRecord {
  obstructionId: string;
  label: string;
  wallEdge: WallCardinalEdge;
  /** Horizontal perpendicular distance D from facade window plane to obstruction in `dimensionUnit` */
  horizontalDistance: number;
  /**Obstruction top height above ground/floor datum in `dimensionUnit` */
  obstructionTopElevation: number;
  dimensionUnit: MeasurementUnit;
  provenance: DaylightEvidenceProvenance;
  sourceNote: string;
}

/**
 * Optional on-site measured illuminance record for a room per P38 Section 1 & 5.2.
 * Kept strictly distinct from calculated predictions!
 */
export interface MeasuredRoomIlluminanceRecord {
  measurementId: string;
  roomId: string;
  measuredMeanIlluminanceLux: number;
  measuredMinIlluminanceLux: number | null;
  measuredOutdoorHorizontalLux: number | null;
  measuredAtDateTime: string;
  skyConditionDescription: string;
  instrumentAndMethodNote: string;
  provenance: 'measured-on-site' | 'user-entered';
}

/**
 * Room-level optical, surface reflectance, and analysis-plane configuration per P38 Section 6 & 8.
 */
export interface RoomDaylightConfig {
  roomId: string;
  /**
   * Room shape classification. Plotify 2D floor-plan rooms are axis-aligned rectangles.
   * If marked 'irregular-polygon-unsupported', numerical daylight factor and grid calculations are withheld.
   */
  geometryShape: 'rectangle' | 'irregular-polygon-unsupported';
  /**
   * Room ceiling height in `dimensionUnit`.
   * Synchronized with P36/P37 ceiling height when available; null when unknown.
   */
  ceilingHeight: number | null;
  ceilingHeightProvenance: DaylightEvidenceProvenance;
  /**
   * Horizontal work-plane elevation above room floor in `dimensionUnit` (e.g. 0.80 m / 2.62 ft for desk height,
   * or user-configured per room use). Never silently assumed without disclosure!
   */
  workPlaneHeight: number | null;
  workPlaneProvenance: DaylightEvidenceProvenance;
  /**
   * Perimeter wall exclusion band margin in `dimensionUnit` for work-plane analysis grid points (e.g. 0.50 m / 1.64 ft).
   */
  perimeterGridMargin: number;
  /**
   * Maximum target grid spacing in `dimensionUnit` (e.g. 1.0 m / 3.28 ft).
   */
  analysisGridSpacing: number;
  dimensionUnit: MeasurementUnit;
  /**
   * Interior surface diffuse visible reflectances in [0, 1].
   * Null when unknown — never fabricated from a material name alone!
   */
  ceilingReflectance: number | null;
  ceilingReflectanceProvenance: DaylightEvidenceProvenance;
  wallReflectance: number | null;
  wallReflectanceProvenance: DaylightEvidenceProvenance;
  floorReflectance: number | null;
  floorReflectanceProvenance: DaylightEvidenceProvenance;
  /** Visual comfort and task priorities for this room */
  visualPriorities: Array<
    | 'vdt-screen-glare-control'
    | 'high-daylight-task-illumination'
    | 'morning-sunlight-access'
    | 'exterior-view-connection'
    | 'privacy-and-darkening'
  >;
  updatedAt: string;
}

/**
 * Solar Location, Time, and Sky Boundary Condition for a P38 Scenario per P38 Section 9 (Modes B & C).
 * CRITICAL RULE: Latitude and longitude are NEVER inferred from project name or city string!
 */
export interface DaylightEnvironmentalConditions {
  conditionId: string;
  label: string;
  description: string;
  /** Site latitude in decimal degrees [-90, 90] (positive = North, negative = South). Null when unknown. */
  latitudeDeg: number | null;
  /** Site longitude in decimal degrees [-180, 180] (positive = East, negative = West). Null when unknown. */
  longitudeDeg: number | null;
  /** Standard time-zone meridian offset from UTC in hours [-12, +14] (e.g. 0 for UTC, -5 for EST, +1 for CET) */
  timeZoneUtcOffsetHours: number | null;
  /** Whether Daylight Saving Time (+1h clock offset) is active for the local clock time */
  isDaylightSavingTime: boolean;
  locationProvenance: DaylightEvidenceProvenance;
  /** Analysis date in ISO 'YYYY-MM-DD' format (e.g. '2026-03-21' Equinox, '2026-06-21' Summer Solstice, '2026-12-21' Winter Solstice) */
  analysisDateIso: string;
  /** Local clock time in 24-hour 'HH:MM' format (e.g. '09:00', '12:00', '15:30') */
  analysisLocalTime24h: string;
  dateTimeProvenance: DaylightEvidenceProvenance;
  /**
   * Sky luminance model boundary condition for Mode C simplified calculations:
   * - 'cie-standard-overcast-sky': CIE Standard Overcast Sky (ISO 15469 Type 1 / Moon-Spencer overcast sky) required for Daylight Factor
   * - 'clear-sky-solar-screening-only': Clear-sky direct solar position screening (Mode B only; Daylight Factor requires overcast sky)
   * - 'unspecified-sky': Sky condition not specified
   */
  skyModelCondition:
    | 'cie-standard-overcast-sky'
    | 'clear-sky-solar-screening-only'
    | 'unspecified-sky';
  /**
   * Unobstructed outdoor diffuse horizontal illuminance E_ext in lux under CIE Overcast Sky
   * (e.g. 10,000 lux reference overcast sky). Used ONLY when converting Daylight Factor (%) to preliminary overcast interior lux.
   */
  overcastExteriorIlluminanceLux: number | null;
  skyConditionProvenance: DaylightEvidenceProvenance;
  /** Whether a validated hourly annual climate weather file (EPW/TMY) is attached */
  hasValidatedHourlyWeatherFile: boolean;
  weatherFileNote: string;
}

/**
 * Per-window scenario override for Mode F comparison (allows testing alternative window sizes, VT, overhangs, or blind states).
 */
export interface ScenarioWindowOverride {
  windowId: string;
  grossWidth?: number;
  grossHeight?: number;
  sillHeight?: number;
  visibleTransmittanceVT?: number;
  vtProvenance?: DaylightEvidenceProvenance;
  exteriorShadingType?: ExteriorShadingDeviceType;
  overhangProjectionDepth?: number | null;
  sideFinProjectionDepth?: number | null;
  exteriorLouverCutoffAngleDeg?: number | null;
  blindDeploymentState?: MovableShadingDeploymentState;
}

/**
 * Complete P38 Daylight & Visual Comfort Scenario.
 */
export interface DaylightScenario {
  scenarioId: string;
  name: string;
  description: string;
  isBaseline: boolean;
  environmentalConditions: DaylightEnvironmentalConditions;
  windowOverrides: Record<string, ScenarioWindowOverride>;
  surfaceReflectanceOverrides?: Record<
    string,
    {
      ceilingReflectance?: number;
      wallReflectance?: number;
      floorReflectance?: number;
      provenance: DaylightEvidenceProvenance;
    }
  >;
  createdAt: string;
}

/**
 * Configurable Daylight & Visual Comfort Criterion per P38 Section 13.
 * Never claims statutory compliance with EN 17037, ANSI/IES LM-83, or local building codes from a threshold match.
 */
export interface ConfiguredDaylightCriterion {
  criterionId: string;
  roomTypeScope: string; // e.g. 'all-habitable', 'living', 'bedroom', 'office', 'kitchen'
  metric:
    | 'window-to-floor-area-ratio-percent'
    | 'glazed-to-floor-area-ratio-percent'
    | 'mean-daylight-factor-percent'
    | 'room-depth-to-window-head-ratio'
    | 'horizontal-view-out-angle-deg';
  label: string;
  minTarget: number | null;
  maxTarget: number | null;
  unit: '%' | 'dimensionless' | 'deg';
  authorityStatus: 'advisory-reference' | 'project-defined' | 'statutory-verified';
  jurisdictionAndStandard: string;
  editionOrVersion: string;
  applicabilityConditions: string;
  verificationStatus: 'unverified-screening-benchmark' | 'project-confirmed';
  provenance: DaylightEvidenceProvenance;
  sourceMetadata: DaylightSourceMetadata;
  nonComplianceDisclaimer: string;
}

/**
 * Validated analysis-plane grid point in SI units (m) inside a room.
 */
export interface WorkPlaneAnalysisPointSI {
  pointId: string;
  row: number;
  col: number;
  /** Local room X coordinate in metres from room left wall (0 < x < widthMetres) */
  localXMetres: number;
  /** Local room Y coordinate in metres from room top/north wall (0 < y < lengthMetres) */
  localYMetres: number;
  /** Elevation z above room floor in metres (= workPlaneHeightMetres) */
  elevationZMetres: number;
  /** Distance from nearest window wall in metres */
  distanceToNearestWindowWallMetres: number | null;
  /** Point daylight factor proxy (%) under Mode C when supported (explicitly labelled as point proxy) */
  pointDaylightFactorProxyPercent: number | null;
  /** Whether direct solar beam reaches this work-plane point under Mode B solar position */
  receivesDirectSunInScenario: boolean;
}

/**
 * Validated Room Geometry & Analysis Plane Result in SI units (m, m², m³) per P38 Section 6.
 */
export interface RoomDaylightGeometryValidationSI {
  roomId: string;
  roomName: string;
  roomType: string;
  floorLevel: number;
  geometryShape: 'rectangle' | 'irregular-polygon-unsupported';
  projectUnit: MeasurementUnit;
  rawX: number;
  rawY: number;
  rawWidth: number;
  rawLength: number;
  isOriginZeroValid: boolean;
  is2DGeometryValid: boolean;
  widthMetres: number | null;
  lengthMetres: number | null;
  floorAreaM2: number | null;
  ceilingHeightMetres: number | null;
  ceilingHeightProvenance: DaylightEvidenceProvenance;
  roomVolumeM3: number | null;
  totalInternalSurfaceAreaM2: number | null;
  workPlaneHeightMetres: number | null;
  workPlaneProvenance: DaylightEvidenceProvenance;
  perimeterGridMarginMetres: number;
  analysisGridSpacingMetres: number;
  analysisPoints: WorkPlaneAnalysisPointSI[];
  analysisGridCoveragePercent: number | null;
  northOrientationOffsetDeg: number;
  exteriorWallEdges: WallCardinalEdge[];
  validationErrors: string[];
  missingGeometryDisclosures: string[];
}

/**
 * Validated Window & Optical Performance Metrics in SI units (m, m²) for a scenario.
 */
export interface EvaluatedDaylightWindowSI {
  windowId: string;
  label: string;
  roomId: string;
  wallEdge: WallCardinalEdge;
  compassAzimuthDeg: number;
  grossWidthMetres: number | null;
  grossHeightMetres: number | null;
  grossOpeningAreaM2: number | null;
  sillHeightMetres: number | null;
  headHeightMetres: number | null;
  windowCentreHeightMetres: number | null;
  frameFraction: number | null;
  frameFractionProvenance: DaylightEvidenceProvenance;
  netGlazedAreaM2: number | null;
  dimensionProvenance: DaylightEvidenceProvenance;
  visibleTransmittanceVT: number | null;
  vtProvenance: DaylightEvidenceProvenance;
  maintenanceFactorM: number;
  interiorShadingType: InteriorShadingDeviceType;
  blindDeploymentState: MovableShadingDeploymentState;
  interiorBlindMultiplier: number | null;
  /**
   * Effective visible transmittance T_eff = VT * interiorBlindMultiplier (when blind deployed).
   * Null if VT is unknown or if blind is deployed with unknown multiplier.
   */
  effectiveTransmittanceT: number | null;
  exteriorShadingType: ExteriorShadingDeviceType;
  overhangProjectionMetres: number | null;
  overhangGapAboveHeadMetres: number;
  sideFinProjectionMetres: number | null;
  exteriorLouverCutoffAngleDeg: number | null;
  /** Vertical obstruction angle θ_obs (deg) from external obstructions on this wall edge */
  externalObstructionAngleDeg: number;
  /** Vertical overhang cut-off angle θ_overhang (deg) from window centre */
  overhangSkyCutoffAngleDeg: number;
  /** Unobstructed vertical sky angle θ (deg) = max(0, 90 - θ_obs - θ_overhang) for BRE Split-Flux formula */
  visibleVerticalSkyAngleDeg: number;
  p33FurnitureObstructionWarning?: string;
  p34AccessibilityControlWarning?: string;
  missingOpticalOrDimensionDisclosures: string[];
}

/**
 * Mode A — Geometric Daylight Potential Result per P38 Section 9 Mode A.
 */
export interface ModeAGeometricDaylightResult {
  mode: 'mode-a-geometric-potential';
  completenessState: DaylightCompletenessState;
  floorAreaM2: number | null;
  windowCount: number;
  windowsWithCompleteDimensionsCount: number;
  windowsWithWidthOnlyCount: number;
  totalGrossWindowAreaM2: number | null;
  totalNetGlazedAreaM2: number | null;
  /** Gross Window-to-Floor-Area Ratio (WFR_gross) in % */
  grossWindowToFloorAreaRatioPercent: number | null;
  /** Net Glazed-to-Floor-Area Ratio (GFR_net) in % */
  netGlazedToFloorAreaRatioPercent: number | null;
  /** Window-to-Exterior-Wall Ratio (WWR) on windowed facades in % */
  windowToWallRatioPercent: number | null;
  primaryWindowOrientations: Array<{
    wallEdge: WallCardinalEdge;
    azimuthDeg: number;
    windowCount: number;
  }>;
  /** Room plan depth L_depth perpendicular to primary window wall in metres */
  roomDepthFromPrimaryWindowWallMetres: number | null;
  /** Highest window head height H_head above floor in metres */
  primaryWindowHeadHeightMetres: number | null;
  /**
   * Geometric limiting depth ratio (L_depth / H_head) and no-sky-line / BRE depth heuristic:
   * L_depth / (H_head - H_workplane) compared against 2 / (1 - R_backwall) when available.
   */
  depthToWindowHeadRatio: number | null;
  limitingDepthHeuristicThreshold: number;
  exceedsLimitingDepthHeuristic: boolean | null;
  hasExteriorShadingConfigured: boolean;
  hasExternalObstructionsConfigured: boolean;
  confirmedBriefDaylightRequired: boolean | null;
  criterionChecks: Array<{
    criterion: ConfiguredDaylightCriterion;
    measuredValue: number | null;
    meetsTarget: boolean | null;
    note: string;
  }>;
  nonComplianceAndProxyDisclosure: string;
  explanation: string;
}

/**
 * Mode B — Solar Position and Direct-Sun / Shadow Screening Result per P38 Section 9 Mode B.
 */
export interface ModeBSolarShadingResult {
  mode: 'mode-b-solar-position-and-shading';
  completenessState: DaylightCompletenessState;
  isSolarPositionCalculated: boolean;
  locationAndTimeProvenance: DaylightEvidenceProvenance;
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  analysisDateIso: string;
  analysisLocalTime24h: string;
  dayOfYearN: number | null;
  solarDeclinationDeg: number | null;
  equationOfTimeMinutes: number | null;
  solarTimeDecimalHours: number | null;
  solarHourAngleDeg: number | null;
  /** Solar altitude angle α_s above horizon in degrees [-90, +90] */
  solarAltitudeDeg: number | null;
  /** Solar azimuth angle γ_s clockwise from True North in degrees [0, 360) */
  solarAzimuthDegFromNorth: number | null;
  isSunAboveHorizon: boolean;
  windowSolarExposures: Array<{
    windowId: string;
    label: string;
    wallEdge: WallCardinalEdge;
    wallAzimuthDeg: number;
    /** Horizontal surface-solar azimuth difference γ = |γ_s - γ_wall| in [0, 180] deg */
    surfaceSolarAzimuthDiffDeg: number;
    isFacadeSunlit: boolean;
    /** Vertical solar profile angle Ω_v = arctan(tan(α_s) / cos(γ)) in degrees (0, 90] when facade is sunlit */
    verticalProfileAngleDeg: number | null;
    isBlockedByExternalObstruction: boolean;
    /** Vertical shadow drop S_v cast on window by overhang: S_v = max(0, P_overhang * tan(Ω_v) - gap) in metres */
    overhangVerticalShadowMetres: number;
    /** Horizontal shadow width S_h cast on window by side fin: S_h = P_fin * tan(γ) in metres */
    sideFinHorizontalShadowMetres: number;
    /** Fraction of net glazed area shaded by exterior overhang/fins/louvers in [0, 1] */
    exteriorShadedGlazedFraction: number;
    /** Fraction of net glazed area receiving direct solar beam in [0, 1] */
    directSunlitGlazedFraction: number;
    /** Direct-sun floor/work-plane penetration depth into room from window wall in metres */
    directSunPenetrationDepthMetres: number;
    shadingExplanation: string;
  }>;
  workPlanePointsInDirectSunCount: number;
  workPlaneDirectSunCoveragePercent: number | null;
  maxDirectSunPenetrationDepthMetres: number | null;
  unavailabilityOrLimitationReasons: string[];
  explanation: string;
}

/**
 * Mode C — Simplified Daylight Calculation Result per P38 Section 9 Mode C.
 * Uses BRE / CIBSE Split-Flux Mean Daylight Factor under CIE Standard Overcast Sky.
 */
export interface ModeCSimplifiedDaylightResult {
  mode: 'mode-c-simplified-daylight-calculation';
  completenessState: DaylightCompletenessState;
  isCalculationSupported: boolean;
  modelName: string;
  formulaDocumented: string;
  skyBoundaryCondition: string;
  totalInternalSurfaceAreaM2: number | null;
  areaWeightedAverageReflectanceR: number | null;
  reflectanceProvenanceSummary: string;
  /**
   * Calculated Mean Daylight Factor (DF_mean) in % under CIE Standard Overcast Sky:
   * DF_mean = sum( T_i * A_g,i * θ_i * M_i ) / ( A_total * (1 - R^2) ) * 100
   * Null whenever required geometry, glazing VT, or surface reflectances are missing.
   */
  meanDaylightFactorPercent: number | null;
  /** Minimum point daylight factor proxy (%) across work-plane grid points when supported */
  minPointDaylightFactorProxyPercent: number | null;
  /** Uniformity ratio proxy (minPointProxy / meanDF) on work plane */
  uniformityRatioProxy: number | null;
  /**
   * Preliminary overcast interior illuminance E_in,mean (lux) = (DF_mean / 100) * E_ext,overcast
   * Computed ONLY when overcastExteriorIlluminanceLux is explicitly configured.
   */
  estimatedOvercastMeanIlluminanceLux: number | null;
  /** On-site measured illuminance record if entered by user (kept strictly distinct from calculated prediction!) */
  measuredIlluminanceRecord: MeasuredRoomIlluminanceRecord | null;
  meanDfCriterion: ConfiguredDaylightCriterion;
  meetsMeanDfTarget: boolean | null;
  windowContributions: Array<{
    windowId: string;
    label: string;
    netGlazedAreaM2: number;
    effectiveTransmittanceT: number;
    visibleSkyAngleDeg: number;
    maintenanceFactorM: number;
    dfContributionPercent: number;
  }>;
  missingRequiredInputs: string[];
  modelAssumptions: string[];
  modelLimitations: string[];
  en17037NonEquivalenceDisclosure: string;
  explanation: string;
}

/**
 * Mode D — Climate-Based Annual Daylight Modelling Status per P38 Section 9 Mode D.
 * Explicitly reports sDA, ASE, DA, and UDI as unsupported/unavailable rather than fabricating numbers!
 */
export interface ModeDAnnualSimulationStatusResult {
  mode: 'mode-d-climate-based-annual-simulation';
  completenessState: DaylightCompletenessState;
  isAnnualEngineImplemented: false; // Enforced invariant: no fake annual raytracer
  sDA_300_50_Percent: null;
  ASE_1000_250_Percent: null;
  daylightAutonomyPercent: null;
  usefulDaylightIlluminancePercent: null;
  whyUnavailableExplanation: string;
  requiredForValidatedAnnualSimulation: string[];
}

/**
 * Mode E — Visual Comfort, Glare and View-Out Screening Result per P38 Section 9 Mode E & Section 11.
 */
export interface ModeEVisualComfortGlareViewResult {
  mode: 'mode-e-visual-comfort-glare-and-view';
  completenessState: DaylightCompletenessState;
  isQuantitativeDgpSupported: false; // Enforced invariant: DGP requires eye-level luminance field simulation
  daylightGlareProbabilityDGP: null;
  dgpLimitationDisclosure: string;
  qualitativeGlareRiskLevel:
    | 'low-screened-concern'
    | 'moderate-conditional-concern'
    | 'high-direct-sun-or-low-angle-concern'
    | 'insufficient-evidence';
  identifiedComfortAndGlareFindings: Array<{
    findingId: string;
    category:
      | 'direct-sun-on-workplane'
      | 'low-angle-solar-beam-risk'
      | 'high-window-contrast-or-unshaded-glazing'
      | 'inadequate-daylight-penetration-depth'
      | 'shading-reduces-daylight-tradeoff'
      | 'view-out-obstruction';
    severity: 'high-concern' | 'moderate-review' | 'favorable-note';
    title: string;
    explanation: string;
  }>;
  viewOutAssessment: {
    isViewOutEvaluated: boolean;
    /** Horizontal sight angle (degrees) subtended by exterior windows from the room centre point */
    horizontalViewAngleFromRoomCentreDeg: number | null;
    minExternalObstructionDistanceMetres: number | null;
    viewOutCriterion: ConfiguredDaylightCriterion;
    meetsHorizontalViewAngleTarget: boolean | null;
    p33FurnitureViewBlockWarning?: string;
    viewOutSummary: string;
  };
  explanation: string;
}

/**
 * Mode F — Side-by-Side Scenario Comparison Result per P38 Section 9 Mode F.
 */
export interface ModeFDaylightScenarioComparisonResult {
  mode: 'mode-f-scenario-comparison';
  roomId: string;
  roomName: string;
  baselineScenarioId: string;
  baselineScenarioName: string;
  comparedScenarioId: string;
  comparedScenarioName: string;
  areAssumptionsEquivalentForDfComparison: boolean;
  hasIncomparableEvidenceMixWarning: boolean;
  changedInputsSummary: string[];
  comparabilityDisclosures: string[];
  baselineNetGlazedAreaM2: number | null;
  comparedNetGlazedAreaM2: number | null;
  deltaNetGlazedAreaM2: number | null;
  baselineGlazedToFloorRatioPercent: number | null;
  comparedGlazedToFloorRatioPercent: number | null;
  deltaGlazedToFloorRatioPercent: number | null;
  baselineMeanDaylightFactorPercent: number | null;
  comparedMeanDaylightFactorPercent: number | null;
  deltaMeanDaylightFactorPercent: number | null;
  baselineDirectSunCoveragePercent: number | null;
  comparedDirectSunCoveragePercent: number | null;
  deltaDirectSunCoveragePercent: number | null;
  baselineGlareRisk: ModeEVisualComfortGlareViewResult['qualitativeGlareRiskLevel'];
  comparedGlareRisk: ModeEVisualComfortGlareViewResult['qualitativeGlareRiskLevel'];
  daylightVsSolarControlTradeOffSummary: string;
}

/**
 * Actionable P38 Daylight & Visual Comfort Recommendation per P38 Section 4, 12, 14 & 15.
 */
export type DaylightRecommendationCategory =
  | 'add-or-enlarge-window-glazing'
  | 'add-exterior-overhang-or-shading'
  | 'deploy-or-configure-interior-blinds'
  | 'upgrade-surface-reflectance'
  | 'supply-missing-geometry-or-optical-data'
  | 'relocate-obstructing-furniture-advisory';

export interface DaylightRecommendation {
  recommendationId: string;
  roomId: string;
  roomName: string;
  category: DaylightRecommendationCategory;
  priority: 'high' | 'medium' | 'advisory';
  title: string;
  issueOrOpportunityAddressed: string;
  triggeringInputsAndConditions: string;
  physicalRationale: string;
  supportingEvidenceLevel: string;
  expectedDaylightAndGlareEffect: string;
  remainingUnknownsAndLimitations: string[];
  multidisciplinaryTradeOffs: {
    solarHeatAndShadingTradeOff: string;
    naturalVentilationP37Impact: string;
    acousticsAndNoiseP36Impact: string;
    materialsAndReflectanceP35Impact: string;
    accessibilityAndControlsP34Impact: string;
    furnitureAndCirculationP33Impact: string;
  };
  canPreviewAndApplyInPlotify: boolean;
  proposedMutation?: {
    roomId: string;
    setRoomCeilingHeight?: {
      ceilingHeight: number;
      workPlaneHeight: number;
      provenance: DaylightEvidenceProvenance;
    };
    setRoomSurfaceReflectances?: {
      ceilingReflectance: number;
      wallReflectance: number;
      floorReflectance: number;
      provenance: DaylightEvidenceProvenance;
    };
    updateWindow?: {
      windowId: string;
      grossWidth?: number;
      grossHeight?: number;
      sillHeight?: number;
      frameFraction?: number;
      visibleTransmittanceVT?: number;
      vtProvenance?: DaylightEvidenceProvenance;
      exteriorShadingType?: ExteriorShadingDeviceType;
      overhangProjectionDepth?: number;
      sideFinProjectionDepth?: number;
      interiorShadingType?: InteriorShadingDeviceType;
      defaultBlindState?: MovableShadingDeploymentState;
      interiorBlindTransmittanceMultiplier?: number;
    };
    addWindow?: DaylightWindowRecord;
    proposedFacadeShadingStyle?: FacadeConcept['shadingStyle'];
  };
}

/**
 * Complete Room-Level P38 Evaluation for a Scenario.
 */
export interface RoomScenarioDaylightEvaluation {
  evaluationId: string;
  projectId: string;
  roomId: string;
  roomName: string;
  roomType: string;
  floorLevel: number;
  scenarioId: string;
  scenarioName: string;
  evaluatedAt: string;
  calculationMethodVersion: string;
  inputFingerprint: string;
  selectedMode: DaylightAssessmentMode;
  overallStatus: DaylightEvaluationStatus;
  completenessState: DaylightCompletenessState;
  geometry: RoomDaylightGeometryValidationSI;
  evaluatedWindows: EvaluatedDaylightWindowSI[];
  externalObstructions: ExternalObstructionRecord[];
  modeA_GeometricPotential: ModeAGeometricDaylightResult;
  modeB_SolarAndShading: ModeBSolarShadingResult;
  modeC_SimplifiedDaylight: ModeCSimplifiedDaylightResult;
  modeD_AnnualSimulationStatus: ModeDAnnualSimulationStatusResult;
  modeE_VisualComfortGlareView: ModeEVisualComfortGlareViewResult;
  recommendations: DaylightRecommendation[];
  warningsAndLimitations: string[];
  missingInputsGuidance: string[];
}

/**
 * Non-destructive preview diff for applying a P38 recommendation or configuration change per P38 Section 15.
 */
export interface DaylightProposalPreviewDiff {
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
  marksP37NaturalVentilationStale: boolean;
  p37StaleDisclosureNote: string;
  p36AcousticWarnings: string[];
  p34AccessibilityPreserved: boolean;
  p33FurniturePreserved: boolean;
  p30AndP32Preserved: boolean;
  beforeCompleteness: DaylightCompletenessState;
  afterCompleteness: DaylightCompletenessState;
  beforeGlazedToFloorRatioPercent: number | null;
  afterGlazedToFloorRatioPercent: number | null;
  beforeMeanDaylightFactorPercent: number | null;
  afterMeanDaylightFactorPercent: number | null;
  beforeDirectSunCoveragePercent: number | null;
  afterDirectSunCoveragePercent: number | null;
  beforeGlareRisk: ModeEVisualComfortGlareViewResult['qualitativeGlareRiskLevel'];
  afterGlareRisk: ModeEVisualComfortGlareViewResult['qualitativeGlareRiskLevel'];
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
 * Read-only P38 summary exposed for P31 Multi-Option Design Comparison per P38 Section 14 (P31).
 */
export interface P38OptionDaylightComparisonSummary {
  optionId: string;
  optionName: string;
  calculationMethodVersion: string;
  activeScenarioName: string;
  roomsEvaluatedCount: number;
  roomsWithWindowGeometryCount: number;
  roomsWithCalculatedMeanDfCount: number;
  averageNetGlazedToFloorRatioPercent: number | null;
  averageMeanDaylightFactorPercent: number | null;
  facadeShadingStyle: string;
  overallCompletenessState: DaylightCompletenessState;
  comparabilityStatus: 'comparable-simplified-daylight' | 'geometric-screening-only' | 'incomplete-daylight-data';
  summaryExplanation: string;
  comparisonLimitations: string[];
}

/**
 * Persistent project-scoped P38 state stored on `Project.daylightComfort`.
 */
export interface ProjectDaylightComfortData {
  schemaVersion: string;
  calculationMethodVersion: string;
  isConfigured: boolean;
  selectedRoomId?: string;
  selectedAssessmentMode: DaylightAssessmentMode;
  activeScenarioId: string;
  comparisonScenarioId?: string;
  roomConfigs: Record<string, RoomDaylightConfig>;
  windows: DaylightWindowRecord[];
  externalObstructions: ExternalObstructionRecord[];
  measuredIlluminanceRecords: Record<string, MeasuredRoomIlluminanceRecord>;
  scenarios: DaylightScenario[];
  customCriteriaOverrides: ConfiguredDaylightCriterion[];
  lastEvaluatedAt?: string;
  lastSourceFingerprint?: string;
  lastPreApplySnapshotId?: string;
  requestSequenceId: number;
}

/**
 * Top-level P38 Daylight & Visual Comfort Analyzer Project Evaluation Report.
 */
export interface DaylightComfortProjectEvaluationReport {
  assessmentId: string;
  schemaVersion: string;
  calculationMethodVersion: string;
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
  selectedAssessmentMode: DaylightAssessmentMode;
  activeScenario: DaylightScenario;
  comparisonScenario: DaylightScenario | null;
  allScenarios: DaylightScenario[];
  activeRoomEvaluation: RoomScenarioDaylightEvaluation | null;
  comparisonRoomEvaluation: RoomScenarioDaylightEvaluation | null;
  modeF_ScenarioComparison: ModeFDaylightScenarioComparisonResult | null;
  allRoomEvaluationsForActiveScenario: RoomScenarioDaylightEvaluation[];
  configuredCriteria: ConfiguredDaylightCriterion[];
  sourceReferencesLedger: DaylightSourceMetadata[];
  p30BriefIntegration: {
    hasBrief: boolean;
    confirmedNaturalLightRooms: string[];
    unconfirmedBriefLightAssumptions: string[];
    unresolvedBriefConflicts: string[];
  };
  p31OptionComparisonSummaries: P38OptionDaylightComparisonSummary[];
  p32PersonalizationIntegration: {
    hasPersonalizationProfile: boolean;
    explicitNaturalLightAndShadingWeight: number | null;
    explicitPreferredShadingStyles: string[];
    unconfirmedSuggestionsHeld: string[];
  };
  p33FurnitureAndOpeningsIntegration: {
    syncedP33WindowOpeningsCount: number;
    incompleteP33WindowHeightDisclosures: string[];
    furnitureWindowObstructionWarnings: string[];
  };
  p34AccessibilityIntegration: {
    hasAccessibilityReview: boolean;
    windowAndShadeControlReachWarnings: string[];
  };
  p35MaterialIntegration: {
    climateProfileName: string;
    noOpticalInferenceFromMaterialCategoryNote: string;
  };
  p36AcousticIntegration: {
    hasAcousticPlanner: boolean;
    glazingAndNoiseTradeOffWarnings: string[];
  };
  p37NaturalVentilationIntegration: {
    hasNaturalVentilation: boolean;
    sharedWindowIdsCount: number;
    p37StaleIfWindowModifiedNote: string;
  };
  roadmapScopeBoundaries: Array<{
    roadmapId: string;
    title: string;
    boundaryStatement: string;
  }>;
  professionalDisclaimer: string;
}
