import {
  Currency,
  FacadeConcept,
  FloorPlanRoom,
  InteriorRoomConcept,
  MeasurementUnit,
} from './project';
import { SpaceCategory } from './brief';
import { ComparableDesignOption } from './designComparison';

export const P32_PERSONALIZATION_ENGINE_VERSION = 'p32-personalization-v1.0.0';

/**
 * Distinguishes the epistemic origin of a preference or constraint item per P32 Section 4A:
 * - 'explicit-user': Entered or directly confirmed by the user in the P32 preference profile.
 * - 'imported-project-fact': Obtained from existing saved project data or confirmed P30 brief requirements.
 * - 'inferred-suggestion': Proposed by the system from unconfirmed P30 inferences or narrative hints (NOT confirmed).
 * - 'unknown': Insufficient evidence in the project model to determine a preference or constraint.
 */
export type PreferenceOrigin =
  | 'explicit-user'
  | 'imported-project-fact'
  | 'inferred-suggestion'
  | 'unknown';

export type PreferenceConfirmationStatus =
  | 'confirmed'
  | 'unconfirmed-suggestion'
  | 'rejected'
  | 'unknown';

export type PersonalizationDimension =
  | 'architectural-style'
  | 'primary-material'
  | 'interior-style'
  | 'cost-tier'
  | 'shading-orientation'
  | 'spatial-priority'
  | 'room-priority'
  | 'budget-range'
  | 'storey-preference'
  | 'brief-requirement';

export type SpatialPriorityKey =
  | 'opennessAndLivingArea'
  | 'privacyAndZoneSeparation'
  | 'storageAndUtilityCapacity'
  | 'budgetPredictability'
  | 'lowCarbonMaterials'
  | 'compactPlotFootprint'
  | 'naturalLightAndShading';

export interface PersonalizationPreferenceItem {
  id: string;
  dimension: PersonalizationDimension;
  key: string;
  label: string;
  value: string | number | boolean | string[] | null;
  unit?: string;
  /** Importance weight from 0 (ignored) to 100 (critical preference) */
  weight: number;
  origin: PreferenceOrigin;
  confirmationStatus: PreferenceConfirmationStatus;
  /**
   * True ONLY when backed by a confirmed hard project constraint or confirmed P30 must-have requirement.
   * Soft preferences must never override hard constraints.
   */
  isHardConstraint: boolean;
  sourceReference: string;
  rationale: string;
  updatedAt: string;
}

export interface RoomCategoryPrioritySetting {
  category: SpaceCategory;
  label: string;
  importanceWeight: number; // 0 to 100
  minRequiredCount: number;
  origin: PreferenceOrigin;
  confirmationStatus: PreferenceConfirmationStatus;
}

export interface BudgetPreferenceRange {
  minBudget: number | null;
  targetBudget: number | null;
  maxBudget: number | null;
  currency: Currency;
  isHardCap: boolean;
  origin: PreferenceOrigin;
  confirmationStatus: PreferenceConfirmationStatus;
}

export interface ProjectPersonalizationProfile {
  id: string;
  projectId: string;
  version: string;
  createdAt: string;
  updatedAt: string;
  requestSequenceId: number;
  /** Deterministic fingerprint of project + P30 + P31 state used to detect stale recommendations */
  lastEvaluatedSourceFingerprint?: string;
  preferredFacadeStyles: Array<FacadeConcept['style']>;
  preferredPrimaryMaterials: Array<FacadeConcept['primaryMaterial']>;
  preferredCostTiers: Array<FacadeConcept['costTier']>;
  preferredInteriorStyles: Array<InteriorRoomConcept['style']>;
  preferredShadingStyles: Array<FacadeConcept['shadingStyle']>;
  preferredFloors: number | null;
  spatialPriorityWeights: Record<SpatialPriorityKey, number>;
  roomCategoryPriorities: RoomCategoryPrioritySetting[];
  budgetRange: BudgetPreferenceRange;
  items: PersonalizationPreferenceItem[];
  notes?: string;
}

export type PersonalizationConflictType =
  | 'competing-preferences'
  | 'preference-vs-hard-constraint'
  | 'preference-vs-budget'
  | 'preference-vs-site-envelope'
  | 'p30-brief-contradiction';

export interface PersonalizationConflictItem {
  id: string;
  type: PersonalizationConflictType;
  severity: 'conflict' | 'warning';
  title: string;
  explanation: string;
  affectedPreferenceIds: string[];
  isHardConstraintViolation: boolean;
  resolutionOptions: string[];
}

export interface PreferenceCriterionMatchDetail {
  preferenceId: string;
  label: string;
  dimension: PersonalizationDimension;
  origin: PreferenceOrigin;
  confirmationStatus: PreferenceConfirmationStatus;
  isHardConstraint: boolean;
  weight: number;
  status: 'satisfied' | 'partial' | 'unmet' | 'unconfirmed-ignored' | 'unknown-data';
  /** Normalized 0-100 match score when evaluable; null when unknown/missing */
  rawMatchScore: number | null;
  /** Weighted contribution where missing/unknown data contributes 0 while keeping weight in denominator */
  weightedContribution: number;
  measuredOrObservedValue: string;
  explanation: string;
}

export interface PersonalizedOptionRecommendation {
  optionId: string;
  optionName: string;
  optionKind: ComparableDesignOption['kind'];
  persistenceState: ComparableDesignOption['persistenceState'];
  sharesBaselineGeometry: boolean;
  /**
   * Overall soft preference match score (0–100) across confirmed/explicit preferences.
   * Null if no active weighted preferences or no evaluable data exist.
   */
  preferenceMatchScore: number | null;
  /**
   * Tracked strictly separately from soft preference scores so a high preference score
   * never masks a hard constraint violation.
   */
  hardConstraintsAllMet: boolean;
  hardConstraintsMetCount: number;
  hardConstraintsViolatedCount: number;
  hardConstraintsUnassessedCount: number;
  dataCoveragePercent: number;
  missingDataPenaltyApplied: boolean;
  evidenceBasis: 'measured-and-deterministic' | 'partial-data';
  criterionMatches: PreferenceCriterionMatchDetail[];
  satisfiedPreferences: string[];
  unmetRequirements: string[];
  tradeOffsIntroduced: string[];
  assumptionsAndMissingInputs: string[];
  whySuggestedExplanation: string;
  whatUserCanChangeGuidance: string[];
  canPreviewAndApply: boolean;
  applyBlockedReason?: string;
}

export interface PersonalizationPreviewDiff {
  optionId: string;
  optionName: string;
  optionKind: ComparableDesignOption['kind'];
  isSafeToApply: boolean;
  safetyBlockReasons: string[];
  parameterChanges: Array<{
    field: string;
    label: string;
    beforeValue: string;
    afterValue: string;
    changed: boolean;
  }>;
  proposedRooms: FloorPlanRoom[];
  proposedFloors: number;
  proposedBudget: number;
  proposedFacade?: FacadeConcept;
  proposedActiveAlternativeId?: string;
  proposedActiveScenarioId?: string;
  geometryValidation: {
    overlapCount: number;
    boundaryViolationCount: number;
    constraintConflictCount: number;
    isValid: boolean;
    validationMessages: string[];
  };
}

export interface PersonalizationEvaluationResult {
  evaluationId: string;
  engineVersion: string;
  projectId: string;
  projectName: string;
  evaluatedAt: string;
  requestSequenceId: number;
  sourceFingerprint: string;
  isStale: boolean;
  staleReason?: string;
  profile: ProjectPersonalizationProfile;
  explicitConfirmedCount: number;
  importedFactsCount: number;
  inferredUnconfirmedCount: number;
  unknownPreferencesCount: number;
  conflicts: PersonalizationConflictItem[];
  recommendations: PersonalizedOptionRecommendation[];
  isRankingTie: boolean;
  isRankingWeightSensitive: boolean;
  rankingSensitivityExplanation: string;
  p30CompatibilitySummary: {
    hasInterpretedBrief: boolean;
    confirmedRequirementsImported: number;
    unconfirmedInferencesHeldForReview: number;
    unresolvedBriefConflicts: number;
  };
  p31CompatibilitySummary: {
    p31EngineUsed: boolean;
    p31CalculationVersion: string;
    comparedOptionsCount: number;
  };
  unsupportedRoadmapCapabilities: Array<{
    roadmapId: string;
    title: string;
    reason: string;
  }>;
  complianceAndPrivacyDisclaimer: string;
}
