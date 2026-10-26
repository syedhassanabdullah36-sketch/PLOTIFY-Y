/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P36 — Acoustic Comfort Planner Type Contracts
 * Account A | Locked Roadmap: P36 of P30–P40
 *
 * Connects room geometry, surface materials, furnishings, adjacency,
 * occupancy assumptions, MEP equipment, and noise observations to
 * explainable, deterministic acoustic calculations and screening without
 * pretending to be a certified acoustic simulation or statutory compliance engine.
 */

import {
  FacadeConcept,
  InteriorRoomConcept,
  MeasurementUnit,
} from './project';
import {
  MaterialApplicationCategory,
  MaterialEvidenceStatus,
  MaterialSuitabilityStatus,
} from './climateMaterialAdvisor';

export const P36_ACOUSTIC_PLANNER_ENGINE_VERSION = 'p36-acoustic-comfort-planner-v1.0.0';
export const P36_ACOUSTIC_SCHEMA_VERSION = '1.0.0';

/**
 * Standard octave-band center frequencies (Hz) used for Sabine reverberation screening.
 */
export const OCTAVE_BANDS_HZ = [125, 250, 500, 1000, 2000, 4000] as const;
export type OctaveBandHz = (typeof OCTAVE_BANDS_HZ)[number];

/**
 * Epistemic provenance states per P36 Section 6:
 * - 'measured-on-site': Physical field measurement with documented instrument/location/date
 * - 'manufacturer-or-lab-test': Laboratory test report (e.g. ISO 354 / ASTM C423 / ISO 10140 / ASTM E90)
 * - 'traceable-generic-reference': Published engineering handbook or reference dataset (e.g. ASHRAE Ch. 8)
 * - 'user-entered': Entered by the user without third-party laboratory or field verification
 * - 'illustrative-assumption': Preliminary scenario assumption for educational/exploratory preview only
 * - 'unavailable-or-unverified': No documented acoustic value available
 */
export type AcousticEvidenceProvenance =
  | 'measured-on-site'
  | 'manufacturer-or-lab-test'
  | 'traceable-generic-reference'
  | 'user-entered'
  | 'illustrative-assumption'
  | 'unavailable-or-unverified';

/**
 * Overall evidence completeness / confidence classification per P36 Section 6.
 * Never uses a fabricated numerical probability of correctness.
 */
export type AcousticConfidenceState =
  | 'verified-measurement-or-test-evidence'
  | 'sufficient-for-preliminary-calculation'
  | 'incomplete-evidence-requires-caution'
  | 'insufficient-evidence';

/**
 * Status labels used across P36 UI and domain evaluations per P36 Section 12.
 */
export type AcousticEvaluationStatus =
  | 'estimated-within-target'
  | 'measured-within-target'
  | 'needs-review'
  | 'concern-identified'
  | 'insufficient-evidence'
  | 'unconfigured';

/**
 * Functional room-use profiles per P36 Section 7 Domain B.
 * Treated strictly as functional design profiles, never automatically as statutory classes.
 */
export type FunctionalRoomUseProfileId =
  | 'bedroom-residential'
  | 'living-residential'
  | 'home-office-focused'
  | 'meeting-room'
  | 'classroom-learning'
  | 'healthcare-consultation'
  | 'restaurant-communal-dining'
  | 'reception-circulation'
  | 'music-performance'
  | 'service-utility-wet';

export type AcousticPriorityTag =
  | 'speech-clarity'
  | 'sleep-and-quiet-rest'
  | 'confidential-speech-privacy'
  | 'focused-concentration'
  | 'lively-musical-warmth'
  | 'reverberation-control'
  | 'impact-footfall-control'
  | 'hvac-plant-quietness';

/**
 * Traceable source citation metadata per P36 Section 6 & Section 17.
 */
export interface AcousticSourceMetadata {
  sourceId: string;
  publisher: string;
  title: string;
  editionOrYear: string;
  urlOrIdentifier: string;
  accessOrReviewDate: string;
  applicabilityNote: string;
  licenceOrUsageNote: string;
  testStandardOrConditions?: string;
}

/**
 * Frequency-dependent absorption coefficients (alpha_i in [0.0, 1.0]) across octave bands.
 * Never fabricated from a material name alone.
 */
export type OctaveBandCoefficients = Record<OctaveBandHz, number | null>;

/**
 * Acoustic material or surface treatment record in the P36 reference catalogue or user registry.
 */
export interface AcousticSurfaceMaterialRecord {
  acousticMaterialId: string;
  displayName: string;
  targetSurfaceTypes: Array<'ceiling' | 'wall' | 'floor' | 'door' | 'window'>;
  /** Optional link to Plotify InteriorRoomConcept wallFinish */
  mappedInteriorWallFinish?: InteriorRoomConcept['wallFinish'];
  /** Optional link to Plotify InteriorRoomConcept floorFinish */
  mappedInteriorFloorFinish?: InteriorRoomConcept['floorFinish'];
  /** Optional link to Plotify InteriorRoomConcept ceilingFinish */
  mappedInteriorCeilingFinish?: InteriorRoomConcept['ceilingFinish'];
  /** Optional link to P35 ClimateMaterialCandidate ID for cross-checking moisture/climate compatibility */
  linkedP35MaterialId?: string;
  /** Octave-band sound absorption coefficients (alpha). Null when undocumented/unverified. */
  octaveBandAbsorption: OctaveBandCoefficients;
  /** Applicable frequency range string (e.g. '125 Hz – 4000 Hz octave bands') */
  applicableFrequencyRange: string;
  provenance: AcousticEvidenceProvenance;
  dataVersion: string;
  sourceMetadata: AcousticSourceMetadata;
  mountingOrTestConditions: string;
  moistureAndWetRoomSuitable: boolean;
  fireAndMaintenanceNote: string;
  knownLimitations: string[];
}

/**
 * Partition, floor/ceiling slab, door, or exterior glazing assembly record for Domain D & Domain E screening.
 * Never assigns a tested STC or Rw rating from a generic label like "brick wall" or "double glazing".
 */
export interface AcousticAssemblyRecord {
  assemblyId: string;
  displayName: string;
  elementKind: 'interior-partition' | 'floor-ceiling-slab' | 'interior-door' | 'exterior-facade-glazing';
  constructionDescription: string;
  /**
   * Laboratory airborne sound insulation rating (STC or Rw in dB), ONLY if backed by laboratory test
   * or explicit user-entered test data. Null for generic labels without verified test reports.
   */
  labAirborneRatingDb: number | null;
  airborneRatingMetric: 'STC' | 'Rw' | 'DnT,w' | 'unavailable';
  /**
   * Laboratory impact sound insulation rating (IIC or Ln,w in dB), ONLY if backed by test data.
   */
  labImpactRatingDb: number | null;
  impactRatingMetric: 'IIC' | 'Ln,w' | 'unavailable';
  provenance: AcousticEvidenceProvenance;
  isComponentLabRatingOnly: boolean;
  hasVerifiedPerimeterAcousticSeals?: boolean;
  hasVerifiedJunctionFlankingDetails?: boolean;
  hasAcousticDoorDropSeal?: boolean;
  sourceMetadata: AcousticSourceMetadata;
  limitationsAndFlankingNotes: string[];
}

/**
 * Configurable acoustic criterion per P36 Section 8.
 * Never hard-codes a universal "ideal RT60" or claims statutory code compliance unless verified.
 */
export interface ConfiguredAcousticCriterion {
  criterionId: string;
  roomUseProfileId: FunctionalRoomUseProfileId;
  metric:
    | 'mid-frequency-rt60-seconds'
    | 'background-noise-laeq-dba'
    | 'partition-airborne-insulation-db';
  label: string;
  minTarget: number | null;
  maxTarget: number;
  unit: 's' | 'dBA' | 'dB';
  frequencyScopeNote: string;
  authorityStatus: 'advisory-reference' | 'project-defined' | 'statutory-verified';
  jurisdictionOrStandard: string;
  applicabilityConditions: string;
  versionOrDate: string;
  provenance: AcousticEvidenceProvenance;
  sourceMetadata: AcousticSourceMetadata;
  verificationAndCompletenessNote: string;
}

/**
 * User-entered or observed background / environmental noise entry per P36 Section 7 Domain C.
 */
export type NoiseSourceCategory =
  | 'road-traffic'
  | 'rail-or-aircraft'
  | 'external-plant-equipment'
  | 'internal-hvac-equipment'
  | 'pumps-fans-lifts'
  | 'neighbouring-activities'
  | 'general-indoor-activity';

export interface NoiseObservationEntry {
  observationId: string;
  roomId: string;
  sourceCategory: NoiseSourceCategory;
  sourceDescription: string;
  receiverDescription: string;
  observationKind: 'measured-sound-level' | 'subjective-qualitative-observation' | 'illustrative-scenario';
  /** Measured or assumed level in dB (null if qualitative observation only) */
  soundLevelDb: number | null;
  metricAndUnit: 'LAeq (dBA)' | 'Lmax (dBA)' | 'LCeq (dBC)' | 'qualitative-only';
  timePeriod: 'daytime' | 'evening' | 'nighttime' | 'peak-hour' | 'continuous' | 'unspecified';
  measurementLocation: 'indoor-receiver-room' | 'outdoor-facade' | 'adjacent-source-room' | 'unspecified';
  qualitativeSeverity: 'low-barely-audible' | 'moderate-noticeable' | 'high-intrusive' | 'intermittent-impulsive';
  provenance: AcousticEvidenceProvenance;
  recordedAt: string;
  notes?: string;
}

/**
 * Optional on-site measured RT60 record for direct comparison against Sabine estimates.
 */
export interface MeasuredRoomRt60Record {
  measurementId: string;
  roomId: string;
  measuredBandRt60Seconds: OctaveBandCoefficients;
  measurementStandardNote: string; // e.g. 'Field survey per ISO 3382-2:2008 engineering method'
  measuredBy: string;
  measuredAt: string;
  provenance: 'measured-on-site' | 'user-entered';
}

/**
 * Room-specific acoustic configuration stored in ProjectAcousticPlannerData.
 */
export interface RoomAcousticConfig {
  roomId: string;
  functionalUseProfile: FunctionalRoomUseProfileId;
  acousticPriorities: AcousticPriorityTag[];
  /**
   * Room geometry shape. Plotify 2D floor plan rooms are rectangular;
   * if set to 'irregular-polygon-unsupported', rectangular volume assumptions are blocked unless polygonArea is supplied.
   */
  geometryShape: 'rectangle' | 'irregular-polygon-unsupported';
  /**
   * Explicit ceiling height in `heightUnit`. Null when unknown/unconfigured (Plotify 2D rooms do not store height by default).
   */
  ceilingHeight: number | null;
  heightUnit: MeasurementUnit;
  ceilingHeightProvenance: AcousticEvidenceProvenance;
  /**
   * Optional user-selected acoustic material overrides or assignments for the room's surfaces.
   * When omitted, P36 inspects the room's InteriorRoomConcept finishes if available.
   */
  ceilingAcousticMaterialId?: string;
  wallAcousticMaterialId?: string;
  floorAcousticMaterialId?: string;
  doorAcousticMaterialId?: string;
  windowAcousticMaterialId?: string;
  /**
   * Optional assembly assignments for Domain D & Domain E screening.
   */
  partitionAssemblyId?: string;
  floorSlabAssemblyId?: string;
  doorAssemblyId?: string;
  exteriorGlazingAssemblyId?: string;
  /**
   * Expected simultaneous occupant count (for functional use screening; not used to fabricate human sabins unless documented).
   */
  occupantCountAssumption: number | null;
  occupantProvenance: AcousticEvidenceProvenance;
  /**
   * Optional custom project-defined target overrides for this room.
   */
  customRt60TargetRangeSec?: {
    minSec: number;
    maxSec: number;
    sourceNote: string;
  };
  customBackgroundNoiseMaxDba?: {
    maxDba: number;
    sourceNote: string;
  };
  updatedAt: string;
}

/**
 * Validated room geometry and surface area breakdown in SI units (metres, m², m³) per P36 Section 5.2 & Section 9.
 */
export interface RoomAcousticGeometryValidation {
  roomId: string;
  roomName: string;
  roomType: string;
  floorLevel: number;
  projectUnit: MeasurementUnit;
  geometryShape: 'rectangle' | 'irregular-polygon-unsupported';
  isGeometryValidForVolume: boolean;
  rawWidthInProjectUnit: number;
  rawLengthInProjectUnit: number;
  rawCeilingHeightInHeightUnit: number | null;
  widthMetres: number | null;
  lengthMetres: number | null;
  ceilingHeightMetres: number | null;
   ceilingHeightProvenance: AcousticEvidenceProvenance;
  floorAreaM2: number | null;
  ceilingAreaM2: number | null;
  grossWallAreaM2: number | null;
  knownDoorAreaM2: number;
  knownWindowAreaM2: number;
  netWallAreaM2: number | null;
  totalBoundarySurfaceAreaM2: number | null;
  roomVolumeM3: number | null;
  placedFurnitureCount: number;
  placedFurnitureFootprintM2: number;
  validationIssues: string[];
  missingGeometryDisclosures: string[];
}

/**
 * Surface contribution to equivalent absorption area A (m² sabins) across octave bands.
 */
export interface SurfaceAbsorptionContribution {
  surfaceId: string;
  surfaceType: 'ceiling' | 'wall' | 'floor' | 'door' | 'window';
  surfaceLabel: string;
  areaM2: number;
  materialId: string | null;
  materialName: string;
  provenance: AcousticEvidenceProvenance;
  sourceCitation: string;
  coefficientsByBand: OctaveBandCoefficients;
  sabinsByBand: Record<OctaveBandHz, number | null>;
  shareOfMidFreqAbsorptionPercent: number | null;
}

/**
 * Per-octave-band Sabine calculation output.
 */
export interface OctaveBandSabineResult {
  bandHz: OctaveBandHz;
  isCompleteForBand: boolean;
  totalEquivalentAbsorptionSabinsM2: number | null;
  meanAbsorptionCoefficientAlphaBar: number | null;
  estimatedRt60Seconds: number | null;
  measuredRt60Seconds: number | null;
  isHighAbsorptionSabineQualified: boolean;
  qualificationNote?: string;
  missingSurfacesForBand: string[];
}

/**
 * Domain A — Room Reverberation and Sound Absorption Result.
 */
export interface ReverberationDomainResult {
  domainId: 'domain-a-reverberation-and-absorption';
  status: AcousticEvaluationStatus;
  confidenceState: AcousticConfidenceState;
  formulaUsed: string;
  volumeM3: number | null;
  totalSurfaceAreaM2: number | null;
  surfaceContributions: SurfaceAbsorptionContribution[];
  bandResults: Record<OctaveBandHz, OctaveBandSabineResult>;
  /** Mid-frequency (average of 500 Hz and 1000 Hz) estimated RT60 in seconds, when both bands are valid */
  midFrequencyEstimatedRt60Seconds: number | null;
  midFrequencyMeasuredRt60Seconds: number | null;
  activeCriterion: ConfiguredAcousticCriterion;
  meetsTargetRange: boolean | null;
  sabineDiffuseFieldAssumptions: string[];
  modelLimitations: string[];
  topAbsorbingSurfacesSummary: string[];
  topReflectiveSurfacesSummary: string[];
  furnitureAbsorptionExclusionNote: string;
  educationalScenarioPreview?: {
    isScenarioPreviewOnly: boolean;
    assumedHeightMetres: number;
    previewMidFreqRt60Seconds: number | null;
    previewNote: string;
  };
  explanation: string;
}

/**
 * Domain B — Speech, Communication, and Functional Use Result.
 */
export interface SpeechFunctionalDomainResult {
  domainId: 'domain-b-speech-and-functional-use';
  functionalProfileId: FunctionalRoomUseProfileId;
  functionalProfileLabel: string;
  isStatutoryClassClaimed: false; // Enforced invariant: never claims statutory classification
  status: AcousticEvaluationStatus;
  confidenceState: AcousticConfidenceState;
  prioritiesSelected: AcousticPriorityTag[];
  occupantCountAssumption: number | null;
  occupantProvenance: AcousticEvidenceProvenance;
  identifiedConcerns: string[];
  conflictingPrioritiesDetected: string[];
  stiAndAdvancedMetricsDisclosure: string;
  missingEvidenceForDetailedSpeechAssessment: string[];
  explanation: string;
}

/**
 * Domain C — Background and Environmental Noise Result.
 */
export interface BackgroundNoiseDomainResult {
  domainId: 'domain-c-background-and-environmental-noise';
  status: AcousticEvaluationStatus;
  confidenceState: AcousticConfidenceState;
  observations: NoiseObservationEntry[];
  hasMeasuredSoundLevels: boolean;
  /**
   * Combined energy-summed steady indoor noise level in dBA:
   * L_total = 10 * log10( sum( 10^(L_i / 10) ) )
   * Computed ONLY when >=1 compatible measured indoor LAeq (dBA) observations exist.
   * Never uses an arithmetic average of decibels!
   */
  combinedMeasuredIndoorLaeqDba: number | null;
  energyLogarithmicFormulaUsed: string;
  activeCriterion: ConfiguredAcousticCriterion;
  exceedsConfiguredTarget: boolean | null;
  qualitativeScreeningFindings: string[];
  whoGuidelinesScopeDisclosure: string;
  noLocationInferenceGuarantee: string;
  explanation: string;
}

/**
 * Shared wall or boundary adjacency record discovered from 2D floor plan geometry.
 */
export interface SharedRoomBoundaryItem {
  neighborRoomId: string;
  neighborRoomName: string;
  neighborRoomType: string;
  neighborUseProfile: FunctionalRoomUseProfileId;
  sharedEdgeLengthMetres: number;
  wallOrientation: 'north' | 'south' | 'east' | 'west';
  hasConnectingDoorOrPassage: boolean;
  isNoiseIncompatiblePair: boolean;
  incompatibilityReason?: string;
}

/**
 * Domain D — Airborne Sound Insulation and Privacy Screening Result.
 */
export interface AirborneInsulationDomainResult {
  domainId: 'domain-d-airborne-sound-insulation-and-privacy';
  status: AcousticEvaluationStatus;
  confidenceState: AcousticConfidenceState;
  sharedBoundaries: SharedRoomBoundaryItem[];
  partitionAssembly: AcousticAssemblyRecord | null;
  doorAssembly: AcousticAssemblyRecord | null;
  exteriorGlazingAssembly: AcousticAssemblyRecord | null;
  activeCriterion: ConfiguredAcousticCriterion;
  p30PrivacyRequired: boolean;
  p30AcousticIsolationRelationships: string[];
  componentVsAsBuiltDisclosure: string;
  flankingAndDetailingLimitations: string[];
  identifiedPrivacyConcerns: string[];
  explanation: string;
}

/**
 * Domain E — Impact, Structure-Borne Sound, and Vibration Screening Result.
 */
export interface ImpactStructureVibrationDomainResult {
  domainId: 'domain-e-impact-and-structure-borne';
  status: AcousticEvaluationStatus;
  confidenceState: AcousticConfidenceState;
  floorLevel: number;
  totalProjectFloors: number;
  verticallyAdjacentRoomsAbove: Array<{
    roomId: string;
    roomName: string;
    roomType: string;
    overlapAreaM2: number;
    floorFinishName: string;
  }>;
  verticallyAdjacentRoomsBelow: Array<{
    roomId: string;
    roomName: string;
    roomType: string;
    overlapAreaM2: number;
  }>;
  floorSlabAssembly: AcousticAssemblyRecord | null;
  structuralFramingSystem: string;
  screeningChecklist: Array<{
    itemId: string;
    checkTitle: string;
    status: 'flagged-concern' | 'checked-ok' | 'unverified-needs-specialist';
    finding: string;
  }>;
  specialistVibrationTestingRequiredNote: string;
  explanation: string;
}

/**
 * Domain F — Mechanical Services Noise and Vibration Result.
 */
export interface MechanicalNoiseDomainResult {
  domainId: 'domain-f-mechanical-services-noise';
  status: AcousticEvaluationStatus;
  confidenceState: AcousticConfidenceState;
  mepComponentsInspectedCount: number;
  nearbyOrInRoomMechanicalItems: Array<{
    componentId: string;
    componentName: string;
    subtype: string;
    relationToRoom: 'inside-room' | 'adjacent-within-3m' | 'duct-route-passing-through';
    distanceMetres: number;
    finding: string;
  }>;
  flaggedPathwaysAndConsiderations: string[];
  missingEquipmentAcousticData: string[];
  p37VentilationBoundaryNote: string;
  explanation: string;
}

/**
 * Domain G — Acoustic Zoning and Spatial Coordination Result.
 */
export interface AcousticZoningDomainResult {
  domainId: 'domain-g-acoustic-zoning-and-coordination';
  status: AcousticEvaluationStatus;
  confidenceState: AcousticConfidenceState;
  adjacencyConflicts: Array<{
    conflictId: string;
    sourceRoomName: string;
    targetRoomName: string;
    relationshipKind: 'shared-wall' | 'vertical-stack' | 'connecting-door' | 'p30-brief-isolation-rule';
    severity: 'high-concern' | 'moderate-review';
    explanation: string;
  }>;
  furnitureAndOpeningObservations: string[];
  p34AccessibilityCoordinationNotes: string[];
  noSimulatedPropagationDisclaimer: string;
  explanation: string;
}

/**
 * Domain H — Actionable Acoustic Improvement Recommendation per P36 Section 7 Domain H.
 * Includes all 9 mandatory explanation attributes plus optional supported project mutation payload.
 */
export type AcousticInterventionCategory =
  | 'surface-sound-absorption-treatment'
  | 'ceiling-or-wall-finish-upgrade'
  | 'partition-or-floor-assembly-review'
  | 'doors-seals-glazing-junction-detailing'
  | 'spatial-zoning-separation'
  | 'mechanical-equipment-isolation-review'
  | 'missing-material-or-measurement-data'
  | 'professional-acoustician-referral';

export interface AcousticImprovementRecommendation {
  recommendationId: string;
  roomId: string;
  roomName: string;
  category: AcousticInterventionCategory;
  priority: 'high' | 'medium' | 'advisory';
  title: string;
  /** 1. What issue it addresses */
  issueAddressed: string;
  /** 2. Which input or observation triggered it */
  triggeringInputOrObservation: string;
  /** 3. Why the proposed intervention is relevant */
  relevanceExplanation: string;
  /** 4. Which conditions must hold for it to work */
  requiredConditionsForEffectiveness: string[];
  /** 5. What evidence supports the proposal */
  supportingEvidence: string;
  /** 6. What remains unknown */
  remainingUnknowns: string[];
  /** 7. Whether the expected benefit is qualitative, estimated, or measured */
  expectedBenefitKind: 'qualitative' | 'estimated' | 'measured';
  /** Quantified or qualitative benefit description (only states estimated RT60 delta when Sabine calculation supports it) */
  expectedBenefitSummary: string;
  /** 8. Whether a change to the architectural design is required */
  requiresArchitecturalDesignChange: boolean;
  /** 9. Relevant trade-offs (space, appearance, cost, buildability, maintenance, moisture, fire, accessibility) */
  multidisciplinaryTradeOffs: {
    spaceAndClearance: string;
    appearanceAndStyle: string;
    costAndBuildability: string;
    moistureAndClimateCompatibility: string;
    fireAndMaintenance: string;
    accessibilityP34Impact: string;
  };
  p35MaterialSuitabilityStatus?: MaterialSuitabilityStatus;
  p35CompatibilityWarning?: string;
  canPreviewAndApplyInPlotify: boolean;
  proposedMutation?: {
    roomId: string;
    targetAlternativeId?: string;
    proposedInteriorWallFinish?: InteriorRoomConcept['wallFinish'];
    proposedInteriorFloorFinish?: InteriorRoomConcept['floorFinish'];
    proposedInteriorCeilingFinish?: InteriorRoomConcept['ceilingFinish'];
    proposedDesignPriority?: InteriorRoomConcept['designPriority'];
    proposedWallAcousticMaterialId?: string;
    proposedCeilingAcousticMaterialId?: string;
    proposedFloorAcousticMaterialId?: string;
    proposedPartitionAssemblyId?: string;
    proposedDoorAssemblyId?: string;
  };
}

/**
 * Complete room-level P36 acoustic assessment report.
 */
export interface RoomAcousticAssessmentReport {
  assessmentId: string;
  projectId: string;
  roomId: string;
  roomName: string;
  roomType: string;
  floorLevel: number;
  assessedAt: string;
  calculationModelVersion: string;
  inputFingerprint: string;
  overallStatus: AcousticEvaluationStatus;
  overallConfidenceState: AcousticConfidenceState;
  evidenceCoveragePercent: number;
  geometry: RoomAcousticGeometryValidation;
  domainA_Reverberation: ReverberationDomainResult;
  domainB_SpeechFunctional: SpeechFunctionalDomainResult;
  domainC_BackgroundNoise: BackgroundNoiseDomainResult;
  domainD_AirbornePrivacy: AirborneInsulationDomainResult;
  domainE_ImpactStructure: ImpactStructureVibrationDomainResult;
  domainF_MechanicalNoise: MechanicalNoiseDomainResult;
  domainG_AcousticZoning: AcousticZoningDomainResult;
  domainH_Recommendations: AcousticImprovementRecommendation[];
  missingInformationSummary: string[];
   influentialInputsSummary: string[];
}

/**
 * Non-destructive preview diff for applying a P36 acoustic recommendation or room configuration change.
 */
export interface AcousticProposalPreviewDiff {
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
  p35MoistureOrClimateWarnings: string[];
  p34AccessibilityPreserved: boolean;
  p33FurnitureGeometryPreserved: boolean;
  p30AndP32Preserved: boolean;
  beforeRt60MidSec: number | null;
  afterRt60MidSec: number | null;
  beforeStatus: AcousticEvaluationStatus;
  afterStatus: AcousticEvaluationStatus;
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
 * Read-only P36 summary exposed for P31 Multi-Option Design Comparison per P36 Section 11.
 */
export interface P36OptionAcousticComparisonSummary {
  optionId: string;
  optionName: string;
  calculationModelVersion: string;
  roomsEvaluatedCount: number;
  roomsWithSufficientRt60EvidenceCount: number;
  roomsWithinRt60TargetCount: number;
  roomsWithConcernsCount: number;
  roomsWithInsufficientEvidenceCount: number;
  averageEstimatedMidRt60Seconds: number | null;
  overallEvidenceState: AcousticConfidenceState;
  comparabilityStatus: 'comparable-preliminary' | 'incomplete-acoustic-data';
  summaryExplanation: string;
  caveats: string[];
}

/**
 * Persistent project-scoped P36 data stored on `Project.acousticPlanner`.
 */
export interface ProjectAcousticPlannerData {
  schemaVersion: string;
  calculationModelVersion: string;
  isConfigured: boolean;
  selectedRoomId?: string;
  roomConfigs: Record<string, RoomAcousticConfig>;
  noiseObservations: NoiseObservationEntry[];
  measuredRt60Records: Record<string, MeasuredRoomRt60Record>;
  customAcousticMaterials: AcousticSurfaceMaterialRecord[];
  customAcousticAssemblies: AcousticAssemblyRecord[];
  customCriteriaOverrides: ConfiguredAcousticCriterion[];
  lastEvaluatedAt?: string;
  lastSourceFingerprint?: string;
  lastPreApplySnapshotId?: string;
  requestSequenceId: number;
}

/**
 * Top-level P36 evaluation report across the project and active room.
 */
export interface AcousticComfortProjectEvaluationReport {
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
  activeRoomReport: RoomAcousticAssessmentReport | null;
  allRoomReports: RoomAcousticAssessmentReport[];
  availableMaterials: AcousticSurfaceMaterialRecord[];
  availableAssemblies: AcousticAssemblyRecord[];
  configuredCriteria: ConfiguredAcousticCriterion[];
  p30BriefIntegration: {
    hasBrief: boolean;
    confirmedAcousticRequirements: string[];
    unconfirmedAcousticAssumptions: string[];
    unresolvedAcousticConflicts: string[];
    acousticIsolatedRoomPairs: Array<{ sourceName: string; targetName: string; priority: string }>;
  };
  p31OptionComparisonSummaries: P36OptionAcousticComparisonSummary[];
  p32PersonalizationIntegration: {
    hasPersonalizationProfile: boolean;
    explicitPrivacyWeight: number | null;
    explicitAcousticPreferences: string[];
    unconfirmedSuggestionsHeld: string[];
  };
  p33FurnitureIntegration: {
    totalPlacedFurnitureCount: number;
    furnitureAbsorptionPolicyNote: string;
  };
  p34AccessibilityIntegration: {
    hasAccessibilityReview: boolean;
    clearancesAndDoorsPreservedNote: string;
  };
  p35MaterialIntegration: {
    climateIsConfigured: boolean;
    climateProfileName: string;
    moistureOrClimateMaterialWarnings: string[];
  };
  roadmapScopeBoundaries: Array<{
    roadmapId: string;
    title: string;
    boundaryStatement: string;
  }>;
  professionalDisclaimer: string;
}
