/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P39 — Biophilic & Indoor Plantscape Planner Type Contracts
 * Account A | Locked Roadmap: P39 of P30–P40
 *
 * Connects room geometry, P38 daylight conditions, P33 furniture & circulation clearances,
 * P34 accessibility constraints, P35 moisture/material context, P36 acoustic wall context,
 * and P37 ventilation opening clearance with a provenance-tagged catalog of indoor plants
 * and nature-inspired non-living elements, deterministic suitability evaluation, spatial
 * conflict detection, vertical plant-wall constraint screening, maintenance planning,
 * scenario comparison, non-destructive preview, atomic apply, and snapshot rollback.
 */

import { MeasurementUnit } from './project';
import { WallCardinalEdge } from './naturalVentilation';

export const P39_BIOPHILIC_PLANNER_ENGINE_VERSION = 'p39-biophilic-plantscape-v1.0.0';
export const P39_BIOPHILIC_SCHEMA_VERSION = '1.0.0';

/**
 * Epistemic provenance categories per P39 Section 4:
 * - 'authoritative_geometry': Verified room/opening/furniture coordinates from Plotify geometry
 * - 'user_entered_project_data': Explicitly entered by the user for this project
 * - 'derived_deterministic': Deterministically calculated by P39 from explicit inputs
 * - 'reference_assumption': Traceable horticultural/architectural reference assumption
 * - 'scenario_assumption': Exploratory "what-if" scenario parameter
 * - 'measured_imported': Imported physical measurement (e.g. on-site lux or hygrometer reading)
 * - 'unsupported': Property or claim is unsupported / unverified in the engine
 */
export type P39Provenance =
  | 'authoritative_geometry'
  | 'user_entered_project_data'
  | 'derived_deterministic'
  | 'reference_assumption'
  | 'scenario_assumption'
  | 'measured_imported'
  | 'unsupported';

/**
 * Explicit completeness states per P39 Section 4.
 */
export type P39Completeness =
  | 'complete'
  | 'partial'
  | 'incomplete'
  | 'not_applicable';

/**
 * Distinguishes living plants from nature-inspired non-living interior features
 * per P39 Section 3.A & 3.D.
 */
export type BiophilicElementCategory =
  | 'living-floor-plant'
  | 'living-tabletop-or-shelf-plant'
  | 'living-hanging-or-trailing-plant'
  | 'living-grouped-planter-cluster'
  | 'living-vertical-plant-wall'
  | 'non-living-preserved-moss-panel'
  | 'non-living-natural-material-feature';

export type PlantGrowthForm =
  | 'upright-foliage-tree-or-shrub'
  | 'arching-rosette-or-clumping'
  | 'succulent-or-architectural-upright'
  | 'trailing-or-climbing-vine'
  | 'modular-vertical-living-wall-system'
  | 'non-living-static-feature'
  | 'unknown';

/**
 * Light requirement classification for living plants.
 * Kept strictly distinct from P38 room daylight metrics!
 */
export type PlantLightRequirementBand =
  | 'low-indirect-tolerant'
  | 'medium-bright-indirect'
  | 'high-bright-with-some-direct'
  | 'not-applicable-non-living'
  | 'unknown';

export type DirectSunTolerance =
  | 'sensitive-to-intense-direct-sun'
  | 'tolerates-gentle-morning-or-filtered-sun'
  | 'tolerates-direct-sun'
  | 'not-applicable-non-living'
  | 'unknown';

export type WateringDemandLevel =
  | 'low-drought-tolerant'
  | 'moderate-even-moisture'
  | 'high-consistent-moisture-or-irrigated'
  | 'none-non-living'
  | 'unknown';

export type MaintenanceComplexityLevel =
  | 'low'
  | 'moderate'
  | 'high-specialist'
  | 'minimal-dusting-only'
  | 'unknown';

/**
 * Verified vs unknown toxicity classification per P39 Section 3.A & 9.D.
 * Never fabricates safety claims when botanical toxicity is unverified.
 */
export type ToxicitySafetyStatus =
  | 'verified-non-toxic-pets-and-humans'
  | 'verified-toxic-if-ingested-pets-or-humans'
  | 'verified-mild-irritant-sap-or-oxalate'
  | 'not-applicable-non-living'
  | 'unknown-unverified';

/**
 * Suitability outcome per P39 Section 3.B:
 * - 'suitable-based-on-available-evidence'
 * - 'potentially-suitable-additional-info-needed'
 * - 'unsuitable-under-current-assumptions'
 * - 'not-assessable-with-current-data'
 */
export type BiophilicSuitabilityStatus =
  | 'suitable-based-on-available-evidence'
  | 'potentially-suitable-additional-info-needed'
  | 'unsuitable-under-current-assumptions'
  | 'not-assessable-with-current-data';

/**
 * Traceable horticultural / architectural evidence source metadata.
 */
export interface BiophilicCatalogEvidenceSource {
  sourceId: string;
  publisher: string;
  title: string;
  referenceUrlOrId: string;
  lastReviewedDate: string;
  confidenceLevel: 'high-reference-handbook' | 'moderate-horticultural-guide' | 'user-provided-unverified' | 'unknown';
  scopeAndLimitationsNote: string;
}

/**
 * Catalog record for an indoor plant or nature-inspired element per P39 Section 3.A.
 * Distinguishes verified catalog facts from reference assumptions, user-provided data, and unknown values.
 */
export interface BiophilicCatalogItem {
  catalogId: string;
  displayName: string;
  /** Scientific binomial name when verified; null when unknown or non-living */
  scientificName: string | null;
  isLivingPlant: boolean;
  category: BiophilicElementCategory;
  growthForm: PlantGrowthForm;
  description: string;
  /** Default container / installation dimensions in metres (converted to project unit on placement) */
  defaultContainerWidthMetres: number;
  defaultContainerDepthMetres: number;
  defaultContainerHeightMetres: number;
  /** Expected mature canopy / installation footprint range in metres (null if unknown) */
  expectedMatureWidthRangeMetres: { min: number; max: number } | null;
  expectedMatureDepthRangeMetres: { min: number; max: number } | null;
  expectedMatureHeightRangeMetres: { min: number; max: number } | null;
  lightRequirementBand: PlantLightRequirementBand;
  /**
   * Reference target daylight factor range (%) or horizontal illuminance range (lux) as a planning proxy.
   * Null if unknown or non-living. Explicitly disclosed as a horticultural reference assumption,
   * never a guarantee that the plant will thrive.
   */
  referenceDaylightFactorMinPercent: number | null;
  referenceIlluminanceRangeLux: { min: number; max: number } | null;
  directSunTolerance: DirectSunTolerance;
  wateringDemand: WateringDemandLevel;
  maintenanceComplexity: MaintenanceComplexityLevel;
  /** Estimated routine care minutes per month per unit (reference assumption; null if unknown) */
  estimatedMonthlyCareMinutesPerUnit: number | null;
  preferredRelativeHumidityRangePercent: { min: number; max: number } | null;
  preferredTemperatureRangeCelsius: { min: number; max: number } | null;
  soilAndDrainageRequirement: string | null;
  containerRequirement: string;
  toxicityStatus: ToxicitySafetyStatus;
  toxicityDetails: string;
  /** Specific installation requirements for vertical living walls or heavy planters */
  verticalInstallationRequirements?: {
    requiresWallBackingAndAnchorageReview: boolean;
    requiresWaterproofMembraneAndDripTray: boolean;
    requiresIrrigationAndDrainagePlumbing: boolean;
    requiresMaintenanceAccessClearanceMetres: number;
    estimatedWetWeightKgPerSqmRange: { min: number; max: number } | null;
    structuralAndWaterproofingDisclaimer: string;
  };
  provenance: P39Provenance;
  completeness: P39Completeness;
  missingInformationNotes: string[];
  evidenceSource: BiophilicCatalogEvidenceSource | null;
  isCustomUserEntry?: boolean;
}

/**
 * Individual placement of a plant or biophilic element in a room per P39 Section 3.C & 3.D.
 * Coordinates use the project's native `MeasurementUnit` ('feet' or 'metres') within the room's local coordinate frame
 * `[0, room.width] x [0, room.length]`.
 */
export interface BiophilicPlacementRecord {
  placementId: string;
  catalogId: string;
  roomId: string;
  floorLevel: number;
  label: string;
  quantity: number;
  /** Placement mount mode */
  mountType: 'floor-standing' | 'tabletop-or-shelf' | 'wall-mounted' | 'hanging-overhead';
  /** Wall edge when wall-mounted or placed adjacent to a wall */
  wallEdge?: WallCardinalEdge | null;
  /** Local X coordinate from room top-left corner in `unit` */
  localX: number;
  /** Local Y coordinate from room top-left corner in `unit` */
  localY: number;
  /** Rotation angle in degrees (0, 90, 180, 270) */
  rotationDeg: number;
  /** Container / base installation width in `unit` */
  containerWidth: number;
  /** Container / base installation depth in `unit` */
  containerDepth: number;
  /** Overall installed height in `unit` */
  installedHeight: number;
  /** Expected mature footprint width in `unit` (null if unknown in catalog and not entered by user) */
  expectedMatureWidth: number | null;
  /** Expected mature footprint depth in `unit` (null if unknown in catalog and not entered by user) */
  expectedMatureDepth: number | null;
  unit: MeasurementUnit;
  provenance: P39Provenance;
  completeness: P39Completeness;
  /** Optional user override or notes */
  customMaintenanceNotes?: string;
  createdAt: string;
  updatedAt: string;
  /** Unknown extra fields preserved during serialization round-trips */
  extraFields?: Record<string, unknown>;
}

/**
 * Spatial, circulation, accessibility, furniture, and ventilation conflict record per P39 Section 3.C & 5.
 */
export type PlacementConflictKind =
  | 'out-of-room-bounds'
  | 'overlapping-plant-placement'
  | 'furniture-collision-p33'
  | 'door-or-opening-swing-interference-p33'
  | 'narrowed-circulation-walkway-p33'
  | 'obstructed-accessible-route-or-turning-p34'
  | 'work-area-or-room-function-conflict'
  | 'unsuitable-light-or-direct-sun-p38'
  | 'ventilation-opening-obstruction-p37'
  | 'excessive-plant-density-or-maintenance-access'
  | 'toxicity-hazard-in-occupied-zone'
  | 'vertical-wall-structural-moisture-unverified';

export interface BiophilicPlacementConflict {
  conflictId: string;
  placementId: string;
  roomId: string;
  kind: PlacementConflictKind;
  severity: 'blocking-conflict' | 'warning' | 'advisory-review';
  title: string;
  description: string;
  measuredValue: string | null;
  thresholdOrRuleReference: string;
  relatedFeatureId?: 'P30' | 'P33' | 'P34' | 'P35' | 'P36' | 'P37' | 'P38';
  remediationHint: string;
}

/**
 * Per-placement suitability evaluation combining catalog requirements, P38 daylight, P33/P34 geometry, and P37 context.
 */
export interface PlacementSuitabilityEvaluation {
  placementId: string;
  catalogId: string;
  displayName: string;
  scientificName: string | null;
  isLivingPlant: boolean;
  category: BiophilicElementCategory;
  roomId: string;
  roomName: string;
  suitabilityStatus: BiophilicSuitabilityStatus;
  lightSuitabilityStatus:
    | 'compatible-with-screened-daylight'
    | 'marginal-or-supplemental-lighting-advised'
    | 'unsuitable-insufficient-daylight'
    | 'unsuitable-excessive-direct-sun-exposure'
    | 'not-assessable-missing-daylight-or-plant-data'
    | 'not-applicable-non-living';
  /** Room mean daylight factor (%) read from P38 active scenario, if available */
  roomMeanDaylightFactorPercent: number | null;
  /** Nearest P38 work-plane grid point daylight factor (%), if available */
  localPointDaylightFactorPercent: number | null;
  /** Whether the placement location receives direct solar beam in P38 Mode B */
  receivesDirectSunInActiveScenario: boolean | null;
  /** Container footprint area in m² */
  containerFootprintAreaM2: number;
  /** Mature footprint area in m² (null if mature dimensions are unknown) */
  matureFootprintAreaM2: number | null;
  /** Minimum clearance to nearest room wall, furniture, or door in project unit */
  minClearanceToObstacleInUnit: number | null;
  conflicts: BiophilicPlacementConflict[];
  missingInputs: string[];
  assumptionsUsed: string[];
  evidenceSummary: string;
  daylightNonGuaranteeDisclosure: string;
  provenance: P39Provenance;
  completeness: P39Completeness;
}

/**
 * Deterministic Care & Maintenance Task per P39 Section 3.E.
 */
export interface BiophilicMaintenanceTask {
  taskId: string;
  placementId: string;
  roomId: string;
  roomName: string;
  elementName: string;
  isLivingPlant: boolean;
  taskCategory:
    | 'watering-and-substrate-moisture-check'
    | 'inspection-pruning-and-foliage-cleaning'
    | 'light-condition-and-rotation-review'
    | 'repotting-and-growth-envelope-review'
    | 'vertical-wall-irrigation-drainage-and-moisture-audit'
    | 'non-living-dusting-and-fastener-inspection';
  recommendedCadenceLabel: string;
  estimatedMinutesPerMonth: number | null;
  guidanceText: string;
  conditionalVariabilityDisclosure: string;
  accessAndSafetyNotes: string[];
  provenance: P39Provenance;
}

/**
 * User-configurable maintenance and environmental preferences per P39 Section 3.B & 3.E.
 */
export interface BiophilicMaintenanceSettings {
  userMaintenanceTolerance: 'low' | 'moderate' | 'high-dedicated';
  hasPetsOrYoungChildren: boolean;
  allowSupplementalGrowLightingAssumption: boolean;
  /** Maximum percentage of room floor area allowed for plant containers before flagging density warning */
  maxFloorAreaOccupancyPercentThreshold: number;
  /** Minimum maintenance access clearance around planters/living walls in metres */
  minMaintenanceAccessClearanceMetres: number;
  seasonOrConditionNote: string;
  provenance: P39Provenance;
}

/**
 * Room-level plantscape plan & evaluation summary per P39 Section 3.B, 3.C & 4.
 */
export interface RoomBiophilicPlanEvaluation {
  roomId: string;
  roomName: string;
  roomType: string;
  floorLevel: number;
  roomFloorAreaInUnitSq: number;
  roomFloorAreaM2: number;
  placements: BiophilicPlacementRecord[];
  placementEvaluations: PlacementSuitabilityEvaluation[];
  livingPlantCount: number;
  nonLivingFeatureCount: number;
  totalContainerFloorAreaM2: number;
  totalMatureFloorAreaM2: number | null;
  floorAreaOccupiedPercent: number;
  matureFloorAreaOccupiedPercent: number | null;
  p38DaylightCompleteness: string;
  p38MeanDaylightFactorPercent: number | null;
  p38DirectSunCoveragePercent: number | null;
  p33WalkwayPassable: boolean | null;
  p34AccessibilityClear: boolean;
  p37VentilationClear: boolean;
  roomSuitabilitySummary: BiophilicSuitabilityStatus;
  conflicts: BiophilicPlacementConflict[];
  maintenanceTasks: BiophilicMaintenanceTask[];
  estimatedMonthlyMaintenanceMinutes: number | null;
  missingInputs: string[];
  provenance: P39Provenance;
  completeness: P39Completeness;
}

/**
 * Plantscape Scenario definition per P39 Section 3.F.
 */
export type BiophilicScenarioPresetKind =
  | 'low-maintenance-resilient'
  | 'high-density-foliage'
  | 'vertical-greenspace-focus'
  | 'low-light-tolerant-focus'
  | 'minimal-non-living-accent'
  | 'custom-user-scenario';

export interface BiophilicScenario {
  scenarioId: string;
  name: string;
  description: string;
  presetKind: BiophilicScenarioPresetKind;
  placements: BiophilicPlacementRecord[];
  maintenanceSettings: BiophilicMaintenanceSettings;
  provenance: P39Provenance;
  createdAt: string;
  updatedAt: string;
}

/**
 * Side-by-side Scenario Comparison Result per P39 Section 3.F.
 * CRITICAL RULE: Wellbeing, productivity, air purification, and energy savings are explicitly
 * reported as 'unquantified' — never fabricated as numerical scores!
 */
export interface BiophilicScenarioComparisonResult {
  comparisonId: string;
  scenarioAId: string;
  scenarioAName: string;
  scenarioBId: string;
  scenarioBName: string;
  comparedAt: string;
  metrics: {
    livingPlantCountA: number;
    livingPlantCountB: number;
    deltaLivingPlantCount: number;
    nonLivingFeatureCountA: number;
    nonLivingFeatureCountB: number;
    deltaNonLivingFeatureCount: number;
    floorAreaOccupiedM2A: number;
    floorAreaOccupiedM2B: number;
    deltaFloorAreaOccupiedM2: number;
    matureFloorAreaOccupiedM2A: number | null;
    matureFloorAreaOccupiedM2B: number | null;
    circulationAndAccessibilityWarningsCountA: number;
    circulationAndAccessibilityWarningsCountB: number;
    deltaWarningsCount: number;
    suitablePlacementsCountA: number;
    suitablePlacementsCountB: number;
    unsuitablePlacementsCountA: number;
    unsuitablePlacementsCountB: number;
    estimatedMonthlyMaintenanceMinutesA: number | null;
    estimatedMonthlyMaintenanceMinutesB: number | null;
    deltaMonthlyMaintenanceMinutes: number | null;
    verticalInstallationsCountA: number;
    verticalInstallationsCountB: number;
    completenessA: P39Completeness;
    completenessB: P39Completeness;
  };
  installationConstraintsComparison: {
    scenarioAConstraints: string[];
    scenarioBConstraints: string[];
  };
  /**
   * Explicit non-fabrication guardrails per P39 Section 3.F:
   * Never invent numerical scores for wellbeing, productivity, VOC/air purification, or HVAC energy savings.
   */
  unquantifiedBenefitDisclosures: {
    occupantWellbeingScore: null;
    productivityGainPercent: null;
    airPurificationVocRemovalRate: null;
    thermalOrEnergySavingsKwh: null;
    status: 'unquantified_unsupported_without_clinical_or_chamber_evidence';
    explanation: string;
  };
  tradeOffSummary: string[];
}

/**
 * Actionable P39 Recommendation for adding, relocating, or substituting a plantscape placement.
 */
export interface BiophilicRecommendation {
  recommendationId: string;
  roomId: string;
  roomName: string;
  category:
    | 'add-suitable-room-plantscape'
    | 'resolve-circulation-or-door-conflict'
    | 'substitute-low-light-tolerant-species'
    | 'substitute-pet-safe-non-toxic-species'
    | 'add-vertical-moss-or-living-wall-concept';
  priority: 'high' | 'medium' | 'advisory';
  title: string;
  rationale: string;
  evidenceAndAssumptions: string;
  expectedImpactSummary: string;
  unresolvedConstraints: string[];
  canPreviewAndApply: boolean;
  proposedMutation: {
    action: 'add-placement' | 'update-placement' | 'remove-placement' | 'apply-scenario-placements';
    roomId: string;
    placementToAdd?: BiophilicPlacementRecord;
    placementToUpdate?: BiophilicPlacementRecord;
    placementIdToRemove?: string;
  };
}

/**
 * Non-destructive preview diff for proposed P39 changes per P39 Section 6.
 */
export interface BiophilicProposalPreviewDiff {
  previewId: string;
  title: string;
  createdAt: string;
  sourceFingerprintAtPreview: string;
  p38FingerprintAtPreview: string;
  isSafeToApply: boolean;
  blockingValidationErrors: string[];
  warningNotices: string[];
  selectedRecommendationIds: string[];
  placementDiffs: Array<{
    placementId: string;
    roomId: string;
    roomName: string;
    changeType: 'added' | 'modified' | 'removed';
    beforeSummary: string;
    afterSummary: string;
  }>;
  roomImpactSummaries: Array<{
    roomId: string;
    roomName: string;
    beforePlantCount: number;
    afterPlantCount: number;
    beforeFloorAreaM2: number;
    afterFloorAreaM2: number;
    beforeConflictsCount: number;
    afterConflictsCount: number;
    beforeSuitability: BiophilicSuitabilityStatus;
    afterSuitability: BiophilicSuitabilityStatus;
  }>;
  p38AssessmentsPreservedUnmodified: boolean;
  p33AndP34PreservedUnmodified: boolean;
  p37VentilationPreservedUnmodified: boolean;
  unresolvedDataNotices: string[];
  proposedProjectClone: Record<string, unknown>;
}

/**
 * Normalized P39 summary exported for P31 Multi-Option Design Comparison per P39 Section 5.
 */
export interface P39OptionBiophilicComparisonSummary {
  optionId: string;
  optionName: string;
  engineVersion: string;
  activeScenarioName: string;
  livingPlantCount: number;
  nonLivingFeatureCount: number;
  totalFloorAreaOccupiedM2: number;
  suitablePlacementsCount: number;
  conflictWarningsCount: number;
  estimatedMonthlyMaintenanceMinutes: number | null;
  completeness: P39Completeness;
  provenance: P39Provenance;
  summaryNote: string;
  limitations: string[];
}

/**
 * Persistent project-scoped P39 state stored on `Project.biophilicPlanner`.
 */
export interface ProjectBiophilicPlannerData {
  schemaVersion: string;
  engineVersion: string;
  isConfigured: boolean;
  selectedRoomId?: string;
  activeScenarioId: string;
  comparisonScenarioId?: string;
  customCatalogItems: BiophilicCatalogItem[];
  maintenanceSettings: BiophilicMaintenanceSettings;
  scenarios: BiophilicScenario[];
  lastEvaluatedAt?: string;
  lastSourceFingerprint?: string;
  /** Recorded P38 sourceFingerprint to detect when daylight/window changes make P39 suitability stale */
  lastP38SourceFingerprint?: string;
  lastPreApplySnapshotId?: string;
  requestSequenceId: number;
  extraFields?: Record<string, unknown>;
}

/**
 * Top-level P39 Biophilic & Indoor Plantscape Planner Evaluation Report.
 */
export interface BiophilicPlannerProjectReport {
  reportId: string;
  schemaVersion: string;
  engineVersion: string;
  projectId: string;
  projectName: string;
  unit: MeasurementUnit;
  evaluatedAt: string;
  requestSequenceId: number;
  sourceFingerprint: string;
  p38SourceFingerprint: string;
  isStale: boolean;
  isP38LinkStale: boolean;
  staleReasons: string[];
  isConfigured: boolean;
  selectedRoomId: string | null;
  activeScenario: BiophilicScenario;
  comparisonScenario: BiophilicScenario | null;
  allScenarios: BiophilicScenario[];
  catalog: BiophilicCatalogItem[];
  maintenanceSettings: BiophilicMaintenanceSettings;
  roomEvaluations: RoomBiophilicPlanEvaluation[];
  activeRoomEvaluation: RoomBiophilicPlanEvaluation | null;
  allConflicts: BiophilicPlacementConflict[];
  allMaintenanceTasks: BiophilicMaintenanceTask[];
  recommendations: BiophilicRecommendation[];
  scenarioComparison: BiophilicScenarioComparisonResult | null;
  totals: {
    totalLivingPlants: number;
    totalNonLivingFeatures: number;
    totalContainerFloorAreaM2: number;
    totalMatureFloorAreaM2: number | null;
    totalEstimatedMonthlyMaintenanceMinutes: number | null;
    suitablePlacementsCount: number;
    potentiallySuitableCount: number;
    unsuitablePlacementsCount: number;
    notAssessableCount: number;
    blockingConflictsCount: number;
    warningConflictsCount: number;
  };
  crossFeatureIntegration: {
    p30ComplianceSeparationNote: string;
    p31ComparisonSummaries: P39OptionBiophilicComparisonSummary[];
    p32PersonalizationAlignment: {
      hasBiophilicPriorityRoomCount: number;
      maintenanceToleranceUsed: string;
      note: string;
    };
    p33FurnitureAndCirculationStatus: {
      checkedFurnitureItemsCount: number;
      checkedDoorOpeningsCount: number;
      circulationConflictsCount: number;
    };
    p34AccessibilityStatus: {
      minAccessibleRouteWidthMetres: number;
      accessibilityConflictsCount: number;
      nonCertificationDisclaimer: string;
    };
    p35MaterialAndMoistureStatus: {
      moistureSensitiveInstallationsCount: number;
      materialFinishWarnings: string[];
    };
    p36AcousticCoordinationStatus: {
      preservedMossOrVegetatedWallCount: number;
      acousticNote: string;
    };
    p37VentilationCoordinationStatus: {
      checkedVentilationOpeningsCount: number;
      ventilationObstructionConflictsCount: number;
    };
    p38DaylightIntegrationStatus: {
      p38ActiveScenarioName: string;
      roomsWithCalculatedDaylightCount: number;
      isP38DataStale: boolean;
      daylightNonGuaranteeNote: string;
    };
  };
  overallProvenance: P39Provenance;
  overallCompleteness: P39Completeness;
  professionalDisclaimer: string;
}
