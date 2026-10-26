import {
  Currency,
  FacadeConcept,
  InteriorRoomConcept,
  MeasurementUnit,
  RoadFacingSide,
} from './project';

export const P35_MATERIAL_ADVISOR_ENGINE_VERSION = 'p35-climate-material-advisor-v1.0.0';

/**
 * Source hierarchy per P35 Section 4:
 * 1. Official national meteorological and climate data
 * 2. Applicable, properly documented climatic design data (e.g. ASHRAE Handbook Ch. 14 / Standard 169)
 * 3. Relevant standards and official technical guidance (e.g. UNEP, EU Adaptation Guidance, US EPA Moisture Guidance)
 * 4. Manufacturer technical data and test reports for the actual product
 * 5. Environmental product declarations (EPDs) or verified product records
 * 6. Traceable generic material datasets and recognized technical references (e.g. ASHRAE Handbook Fundamentals Ch. 26, ISO 10456)
 * 7. Explicitly labelled user-entered assumptions when reliable external data is unavailable
 */
export type ClimateDataSourceTier =
  | 'official-meteorological-record'
  | 'documented-climatic-design-data'
  | 'technical-standard-or-guidance'
  | 'reference-screening-profile'
  | 'user-entered-assumption'
  | 'unconfigured';

export type ClimateStatisticBasis =
  | 'climatological-design-statistic'
  | 'multi-year-average'
  | 'local-observation'
  | 'regional-screening-assumption'
  | 'unconfigured';

export type ExposureSeverityLevel =
  | 'none-or-negligible'
  | 'low'
  | 'moderate'
  | 'high'
  | 'severe'
  | 'unknown';

export type HumidityWettingRegime =
  | 'arid-dry'
  | 'semi-arid-seasonal'
  | 'temperate-moderate-moisture'
  | 'humid-subtropical-or-continental'
  | 'tropical-wet-or-monsoon'
  | 'marine-persistent-damp'
  | 'unknown';

export type CoastalSaltExposureLevel =
  | 'inland-none'
  | 'coastal-region-1km-to-10km'
  | 'coastal-nearshore-300m-to-1km'
  | 'severe-marine-surf-under-300m'
  | 'deicing-salt-runoff'
  | 'unknown';

export type FreezeThawExposureLevel =
  | 'none-frost-free'
  | 'occasional-freeze-dry-winter'
  | 'moderate-freeze-thaw-with-rain'
  | 'severe-frequent-freeze-thaw-wet'
  | 'unknown';

/**
 * Explicit climate-context model per P35 Section 4.
 * Never fabricates coordinates, climate zone numbers, or meteorological statistics when unconfigured.
 */
export interface ProjectClimateContext {
  profileId: string;
  profileName: string;
  /** Whether the user has explicitly selected/configured climate inputs or if it remains unconfigured */
  isConfigured: boolean;
  sourceTier: ClimateDataSourceTier;
  statisticBasis: ClimateStatisticBasis;
  geographicCoverageNote: string;
  sourceCitation: string;
  sourceVersionOrEdition: string;
  retrievalDateOrMethod: string;
  licenceAndUsageNote: string;
  /** Temperature unit used for display/input ('C' or 'F'); internally normalized to Celsius for deterministic rules */
  temperatureUnit: 'C' | 'F';
  /** Summer 1% cooling design dry-bulb temperature (°C) — null if unknown/unconfigured */
  summerDesignHighTempC: number | null;
  /** Extreme annual maximum temperature (°C) — null if unknown/unconfigured */
  extremeMaxTempC: number | null;
  /** Winter 99% heating design dry-bulb temperature (°C) — null if unknown/unconfigured */
  winterDesignLowTempC: number | null;
  /** Typical diurnal temperature swing (°C) — null if unknown/unconfigured */
  diurnalTempSwingC: number | null;
  /** Mean annual relative humidity (%) — null if unknown/unconfigured */
  meanRelativeHumidityPct: number | null;
  humidityWettingRegime: HumidityWettingRegime;
  /** Annual precipitation in mm/year — null if unknown/unconfigured */
  annualPrecipitationMm: number | null;
  windDrivenRainExposure: ExposureSeverityLevel;
  freezeThawExposure: FreezeThawExposureLevel;
  coastalSaltExposure: CoastalSaltExposureLevel;
  solarUvExposure: ExposureSeverityLevel;
  wildfireEmberExposure: ExposureSeverityLevel;
  airbornePollutantOrDustNote?: string;
  limitationsAndCaveats: string[];
  updatedAt: string;
}

/**
 * Material application categories mapped directly to Plotify project specifications (P35 Section 5).
 */
export type MaterialApplicationCategory =
  | 'exterior-primary-facade'
  | 'exterior-accent-cladding'
  | 'roof-covering-and-trim'
  | 'exterior-glazing-and-frames'
  | 'envelope-insulation-and-moisture-control'
  | 'interior-wall-finish'
  | 'interior-floor-finish';

/**
 * Epistemic provenance status for individual material properties per P35 Section 6.
 */
export type MaterialEvidenceStatus =
  | 'verified-product-data'
  | 'traceable-generic-data'
  | 'user-entered'
  | 'illustrative-default'
  | 'unavailable'
  | 'requires-verification';

export type MaterialRecordKind =
  | 'traceable-generic-material'
  | 'verified-product-record'
  | 'user-custom-material';

export interface PropertyWithProvenance<T> {
  value: T | null;
  unit: string;
  evidenceStatus: MaterialEvidenceStatus;
  sourceCitation: string;
  testMethodOrStandard?: string;
  applicableConditions: string;
}

export type ResistanceRating =
  | 'high-resistant'
  | 'moderate-conditional'
  | 'low-sensitive'
  | 'not-applicable'
  | 'unavailable';

/**
 * Typed material candidate model with per-property provenance and application scope (P35 Section 6).
 */
export interface ClimateMaterialCandidate {
  materialId: string;
  displayName: string;
  recordKind: MaterialRecordKind;
  /** Supported building applications for this material record */
  supportedApplications: MaterialApplicationCategory[];
  /** Maps to Plotify FacadeConcept.primaryMaterial / accentMaterial when applicable */
  mappedFacadeMaterial?: FacadeConcept['primaryMaterial'];
  /** Maps to Plotify InteriorRoomConcept.wallFinish when applicable */
  mappedInteriorWallFinish?: InteriorRoomConcept['wallFinish'];
  /** Maps to Plotify InteriorRoomConcept.floorFinish when applicable */
  mappedInteriorFloorFinish?: InteriorRoomConcept['floorFinish'];
  /** Maps to Plotify FacadeConcept.windowStyle when applicable */
  mappedWindowStyle?: FacadeConcept['windowStyle'];
  /** Maps to Plotify FacadeConcept.costTier when applicable */
  mappedCostTier: FacadeConcept['costTier'];
  defaultHexColor: string;
  materialClassSummary: string;
  productManufacturerOrStandardNote: string;

  // Thermal & Solar Properties
  thermalConductivityWPerMK: PropertyWithProvenance<number>;
  specificHeatJPerKgK: PropertyWithProvenance<number>;
  densityKgPerM3: PropertyWithProvenance<number>;
  solarReflectanceFraction: PropertyWithProvenance<number>;
  thermalEmissivityFraction: PropertyWithProvenance<number>;
  maxServiceTempC: PropertyWithProvenance<number>;

  // Moisture, Wetting & Vapour Properties
  waterAbsorptionPctByWeight: PropertyWithProvenance<number>;
  vapourDiffusionResistanceFactorMu: PropertyWithProvenance<number>;
  moistureSensitivityRating: PropertyWithProvenance<ResistanceRating>;
  dryingPotentialNote: string;

  // Durability & Environmental Exposure Properties
  freezeThawResistance: PropertyWithProvenance<ResistanceRating>;
  coastalSaltCorrosionResistance: PropertyWithProvenance<ResistanceRating>;
  uvWeatheringResistance: PropertyWithProvenance<ResistanceRating>;
  combustibilityOrWildfireNote: PropertyWithProvenance<string>;

  // Maintenance, Service Life, Cost & Carbon Reference
  maintenanceIntervalYears: PropertyWithProvenance<number>;
  maintenanceRequirementsSummary: string;
  expectedServiceLifeYearsRange: PropertyWithProvenance<{ minYears: number; maxYears: number }>;
  relativeCostIndexPerM2Usd: PropertyWithProvenance<number>;
  /**
   * Optional reference to Plotify's existing scenarioCalculator.ts embodied carbon intensity
   * (kg CO2e / m2 GFA) when compatible. Kept strictly distinct from climate suitability.
   */
  embodiedCarbonKgCo2ePerM2GfaRef: PropertyWithProvenance<number>;

  // Assembly & Compatibility Requirements
  requiresVentilatedRainscreenOrDrainageCavity: boolean;
  requiresProtectiveSealerOrCoatingInWetClimate: boolean;
  requiresMarineGradeFixingsNearCoast: boolean;
  suitableForInteriorWetRooms: boolean;
  compatibleSubstratesAndFixingsNote: string;
  knownIncompatibilities: string[];

  // Provenance & Limitations
  sourceOrganisation: string;
  sourceDocument: string;
  datasetVersion: string;
  publicationDate: string;
  applicableGeography: string;
  overallEvidenceStatus: MaterialEvidenceStatus;
  knownLimitations: string[];
}

/**
 * Distinct evaluation statuses per P35 Section 7.
 * Missing data never defaults to 'suitable-for-screened-conditions'.
 */
export type MaterialSuitabilityStatus =
  | 'suitable-for-screened-conditions'
  | 'conditionally-suitable'
  | 'concern-identified'
  | 'not-recommended-for-screened-conditions'
  | 'insufficient-evidence'
  | 'not-assessed'
  | 'requires-professional-review';

export type ClimateExposureDomainId =
  | 'heat-and-solar-radiation'
  | 'humidity-wetting-and-moisture'
  | 'freeze-thaw-and-cold'
  | 'coastal-salt-and-corrosion'
  | 'uv-and-weathering'
  | 'wildfire-and-specialized'
  | 'durability-and-maintenance'
  | 'assembly-and-substrate-compatibility';

export interface ExposureDomainEvaluation {
  domainId: ClimateExposureDomainId;
  domainTitle: string;
  climateExposureObserved: string;
  requiredProperties: string[];
  knownPropertyValues: string[];
  missingProperties: string[];
  status: MaterialSuitabilityStatus;
  evaluationBasis: 'standards-or-handbook-rule' | 'general-screening-advice' | 'unassessed';
  explanation: string;
  conditionsOrDetailingRequired: string[];
  sourceReferences: string[];
}

export interface AssemblyCompatibilityCheck {
  application: MaterialApplicationCategory;
  targetRoomName?: string;
  isWetRoomContext: boolean;
  facadeShadingStyle?: FacadeConcept['shadingStyle'];
  facadeOrientationExposure?: string;
  assemblyDetailsCompleteInModel: boolean;
  status: MaterialSuitabilityStatus;
  compatibilityFindings: string[];
  missingAssemblyInputs: string[];
  requiredDetailingRecommendations: string[];
}

export interface MaterialCandidateSuitabilityReport {
  materialId: string;
  displayName: string;
  recordKind: MaterialRecordKind;
  application: MaterialApplicationCategory;
  targetRoomId?: string;
  targetRoomName?: string;
  overallStatus: MaterialSuitabilityStatus;
  evaluationBasis: 'standards-or-handbook-rule' | 'general-screening-advice' | 'unassessed';
  domainEvaluations: ExposureDomainEvaluation[];
  assemblyCheck: AssemblyCompatibilityCheck;
  supportingPropertiesSummary: string[];
  missingEvidenceItems: string[];
  maintenanceAndDurabilityConcerns: string[];
  principalTradeOffs: string[];
  conditionsAndProfessionalChecksRequired: string[];
  p30BriefAlignment: {
    matchesConfirmedRequirements: boolean;
    conflictsWithConfirmedRequirements: string[];
    unconfirmedBriefInferencesNoted: string[];
  };
  p32PreferenceAlignment: {
    matchesExplicitUserPreference: boolean;
    preferenceExplanation: string;
  };
  whySuitableOrUnsuitableSummary: string;
}

export interface MaterialRankingWeights {
  climateSuitability: number;
  durabilityAndWeathering: number;
  lowMaintenance: number;
  thermalAndMoistureFit: number;
  costPredictability: number;
  userPreferenceMatch: number;
  embodiedCarbonReference: number;
}

export interface MaterialComparisonCriterionScore {
  criterionId: keyof MaterialRankingWeights;
  label: string;
  rawValueDisplay: string;
  unit: string;
  evidenceStatus: MaterialEvidenceStatus;
  normalizedScore: number | null; // 0-100 when available, null when missing
  weight: number;
  weightedPoints: number;
  isMissingData: boolean;
  explanation: string;
}

export interface ComparedMaterialCandidateEntry {
  candidate: ClimateMaterialCandidate;
  suitability: MaterialCandidateSuitabilityReport;
  /**
   * True ONLY when the candidate satisfies all confirmed P30 mandatory material constraints
   * AND is not 'not-recommended-for-screened-conditions'.
   * Tracked strictly separately from preference ranking score!
   */
  meetsMandatoryAndClimateScreen: boolean;
  mandatoryOrClimateBlockReasons: string[];
  /**
   * Optional weighted ranking score (0-100). Null if climate context is unconfigured or scoring disabled.
   * Missing property data contributes 0 points while keeping the full criterion weight in the denominator.
   */
  weightedPreferenceScore: number | null;
  availableCriteriaCount: number;
  totalActiveCriteriaCount: number;
  dataCoveragePercent: number;
  missingDataPenaltyApplied: boolean;
  criterionScores: MaterialComparisonCriterionScore[];
  leadingStrengths: string[];
  leadingTradeOffs: string[];
}

export interface MaterialSideBySideComparisonResult {
  application: MaterialApplicationCategory;
  targetRoomId?: string;
  targetRoomName?: string;
  climateProfileName: string;
  climateIsConfigured: boolean;
  scoringEnabled: boolean;
  weights: MaterialRankingWeights;
  entries: ComparedMaterialCandidateEntry[];
  isRankingTie: boolean;
  isRankingSensitiveToWeights: boolean;
  rankingSensitivityExplanation: string;
  missingDataDisclosure: string[];
  comparisonDisclaimer: string;
}

export interface MaterialSelectionApplyRequest {
  application: MaterialApplicationCategory;
  materialId: string;
  /** Optional target DesignAlternative ID; defaults to activeAlternativeId or first alternative */
  targetAlternativeId?: string;
  /** Optional target room ID when applying interior wall/floor finishes (or 'all-rooms' / 'wet-rooms' / 'dry-rooms') */
  targetRoomScope?: string;
}

export interface MaterialSelectionPreviewDiff {
  request: MaterialSelectionApplyRequest;
  candidateName: string;
  suitabilityStatus: MaterialSuitabilityStatus;
  isSafeToApply: boolean;
  blockingReasons: string[];
  warningNotices: string[];
  fieldChanges: Array<{
    fieldPath: string;
    label: string;
    beforeValue: string;
    afterValue: string;
    changed: boolean;
  }>;
  preservesRoomGeometryAndIds: boolean;
  preservesP30AndP32Data: boolean;
  proposedProjectClone: Record<string, unknown>;
}

export interface SavedEnvelopeMaterialSelections {
  roofCoveringMaterialId?: string;
  glazingSpecificationMaterialId?: string;
  insulationMoistureMaterialId?: string;
  primaryFacadeMaterialId?: string;
  accentCladdingMaterialId?: string;
  updatedAt: string;
}

export interface ProjectMaterialAdvisorData {
  version: string;
  climateContext: ProjectClimateContext;
  selectedApplication: MaterialApplicationCategory;
  selectedTargetRoomId?: string;
  comparedMaterialIdsByApplication: Partial<Record<MaterialApplicationCategory, string[]>>;
  customMaterialCatalogue: ClimateMaterialCandidate[];
  savedEnvelopeSelections: SavedEnvelopeMaterialSelections;
  scoringEnabled: boolean;
  rankingWeights: MaterialRankingWeights;
  lastEvaluatedAt?: string;
  lastSourceFingerprint?: string;
  lastPreApplySnapshotId?: string;
  requestSequenceId: number;
}

export interface P35OptionMaterialComparisonSummary {
  optionId: string;
  optionName: string;
  climateProfileName: string;
  climateIsConfigured: boolean;
  primaryFacadeMaterialId: string;
  primaryFacadeMaterialName: string;
  primaryFacadeSuitabilityStatus: MaterialSuitabilityStatus;
  accentFacadeMaterialId?: string;
  accentFacadeSuitabilityStatus?: MaterialSuitabilityStatus;
  interiorFinishesEvaluatedCount: number;
  concernsOrNotRecommendedCount: number;
  insufficientEvidenceCount: number;
  embodiedCarbonIntensityKgPerM2Ref: number | null;
  summaryExplanation: string;
  caveats: string[];
}

export interface ClimateMaterialAdvisorEvaluationReport {
  evaluationId: string;
  engineVersion: string;
  projectId: string;
  projectName: string;
  evaluatedAt: string;
  requestSequenceId: number;
  sourceFingerprint: string;
  isStale: boolean;
  staleReason?: string;
  climateContext: ProjectClimateContext;
  solarOrientationSummary: {
    northOffsetDeg: number;
    roadFacing: RoadFacingSide;
    highSolarExposureFacades: string[];
    orientationAdvisory: string;
  };
  activeApplication: MaterialApplicationCategory;
  activeTargetRoomId?: string;
  availableCatalogue: ClimateMaterialCandidate[];
  currentProjectMaterialEvaluations: MaterialCandidateSuitabilityReport[];
  activeApplicationEvaluations: MaterialCandidateSuitabilityReport[];
  comparisonResult: MaterialSideBySideComparisonResult;
  p30Compatibility: {
    hasBrief: boolean;
    confirmedMaterialRequirements: string[];
    unconfirmedMaterialAssumptions: string[];
    briefMaterialConflicts: string[];
  };
  p31OptionSummaries: P35OptionMaterialComparisonSummary[];
  p32Compatibility: {
    hasPersonalizationProfile: boolean;
    explicitPreferredMaterials: string[];
    inferredUnconfirmedMaterials: string[];
    lowCarbonPriorityWeight: number;
  };
  carbonBoundaryDisclosure: {
    usesExistingScenarioCalculatorFormula: boolean;
    systemBoundaryNote: string;
    p44IntegrationNote: string;
  };
  roadmapScopeBoundaries: Array<{
    roadmapId: string;
    title: string;
    boundaryStatement: string;
  }>;
  complianceDisclaimer: string;
}
