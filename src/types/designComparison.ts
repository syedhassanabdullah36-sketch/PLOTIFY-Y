import {
  Currency,
  FacadeConcept,
  FloorPlanRoom,
  MeasurementUnit,
} from './project';

export const P31_COMPARISON_CALCULATION_VERSION = 'p31-comparison-v1.0.0';

export type DesignOptionSourceKind =
  | 'baseline-project'
  | 'design-scenario'
  | 'design-alternative'
  | 'unsaved-draft';

export type DesignOptionPersistenceState =
  | 'baseline'
  | 'saved'
  | 'unsaved-preview';

export interface ComparableDesignOption {
  /** Stable unique option identifier (e.g. "baseline:proj-001", "scenario:scen-1", "alternative:alt-1") */
  optionId: string;
  /** Underlying entity ID in project state */
  sourceId: string;
  name: string;
  description: string;
  kind: DesignOptionSourceKind;
  persistenceState: DesignOptionPersistenceState;
  createdAt: string;
  updatedAt: string;
  unit: MeasurementUnit;
  currency: Currency;
  plotWidth: number;
  plotLength: number;
  floors: number;
  budget: number;
  rooms: FloorPlanRoom[];
  facade?: FacadeConcept;
  interiorsConfiguredCount: number;
  /**
   * True when the option represents a facade/interior concept alternative that shares
   * the baseline project's 2D room layout rather than defining independent room geometry.
   */
  sharesBaselineGeometry: boolean;
  notes?: string;
}

export type ComparisonCriterionCategory =
  | 'space-program-fit'
  | 'floor-area-dimensions'
  | 'space-efficiency'
  | 'functional-circulation'
  | 'budget-cost'
  | 'technical-environmental';

export type ValueProvenanceType =
  | 'measured'
  | 'calculated'
  | 'estimated'
  | 'user-entered'
  | 'unavailable';

export type CriterionEvaluationStatus =
  | 'meets'
  | 'conflict'
  | 'warning'
  | 'neutral'
  | 'unavailable';

export type PreferenceDirection =
  | 'higher-is-better'
  | 'lower-is-better'
  | 'target-match'
  | 'informational';

export interface ComparisonCriterionDefinition {
  id: string;
  name: string;
  category: ComparisonCriterionCategory;
  plainLanguageMeaning: string;
  formula: string;
  requiredSourceFields: string[];
  unit: string;
  defaultSelected: boolean;
  /**
   * False for future roadmap capabilities (P33–P38) that are transparently shown
   * as unavailable in the catalog rather than silently fabricated.
   */
  isAvailableInCodebase: boolean;
  unavailableCodebaseReason?: string;
  preferenceDirection: PreferenceDirection;
  isHardConstraint: boolean;
  defaultWeight: number;
  roundingStep: number;
  toleranceNote: string;
  assumptions: string[];
  limitations: string[];
  missingDataBehavior: string;
}

export interface OptionCriterionValue {
  optionId: string;
  criterionId: string;
  rawValue: number | string | boolean | null;
  formattedValue: string;
  unit: string;
  provenance: ValueProvenanceType;
  status: CriterionEvaluationStatus;
  explanation: string;
  sourceReferences: string[];
  assumptionsUsed: string[];
  uncertaintyNotes: string[];
  unavailableReason?: string;
}

export interface CriterionCrossOptionComparison {
  criterion: ComparisonCriterionDefinition;
  valuesByOptionId: Record<string, OptionCriterionValue>;
  isComparableAcrossSelected: boolean;
  incomparabilityReason?: string;
  minNumericValue: number | null;
  maxNumericValue: number | null;
  rangeSpread: number | null;
  rangeSpreadFormatted: string;
  meaningfulDifferenceSummary: string;
}

export interface BriefConstraintOptionOutcome {
  optionId: string;
  status:
    | 'meets'
    | 'conflict'
    | 'partial'
    | 'insufficient-data'
    | 'assumption-only';
  measuredDisplay: string;
  explanation: string;
}

export interface BriefConstraintCheckItem {
  requirementId: string;
  category: string;
  description: string;
  targetDisplay: string;
  priority: string;
  source: 'explicit' | 'inferred' | 'user-edited' | 'space-schedule';
  reviewStatus: 'confirmed' | 'needs-review' | 'rejected';
  /**
   * True ONLY for confirmed user requirements or mandatory programmed spaces.
   * False for unconfirmed P30 AI assumptions ('needs-review' / 'inferred').
   */
  isBindingConstraint: boolean;
  outcomesByOptionId: Record<string, BriefConstraintOptionOutcome>;
}

export interface CriterionScoreContribution {
  criterionId: string;
  criterionName: string;
  rawValue: number | null;
  normalizedScore: number | null; // 0-100 when available, null when unavailable
  weight: number;
  weightedPoints: number;
  isMissingData: boolean;
  explanation: string;
}

export interface WeightedOptionScoreSummary {
  optionId: string;
  optionName: string;
  /**
   * Optional weighted preference score (0-100).
   * Missing data for any active weighted criterion contributes 0 points while keeping
   * the full weight in the denominator so missing data never inflates an option's score.
   */
  aggregatePreferenceScore: number | null;
  hardConstraintsMetCount: number;
  hardConstraintsConflictCount: number;
  hardConstraintsUnassessedCount: number;
  meetsAllAssessedHardConstraints: boolean;
  availableWeightedCriteriaCount: number;
  totalWeightedCriteriaCount: number;
  dataCoveragePercent: number;
  contributions: CriterionScoreContribution[];
  strengths: string[];
  tradeOffs: string[];
  missingOrUncertainItems: string[];
}

export interface OptionValidationDiagnostics {
  validSelectedOptions: ComparableDesignOption[];
  rejectedDuplicateIds: string[];
  missingOrDeletedIds: string[];
  hasMinimumTwoOptions: boolean;
  validationErrors: string[];
  validationWarnings: string[];
}

export interface P30BriefComparisonSummary {
  hasBrief: boolean;
  hasP30InterpretedBrief: boolean;
  confirmedRequirementsCount: number;
  unconfirmedAssumptionsCount: number;
  unresolvedBriefConflictsCount: number;
  openClarificationQuestionsCount: number;
  briefConflictTitles: string[];
  briefNotes: string[];
}

export interface MultiOptionComparisonResult {
  comparisonId: string;
  calculationVersion: string;
  projectId: string;
  projectName: string;
  computedAt: string;
  requestSequenceId: number;
  optionDiagnostics: OptionValidationDiagnostics;
  selectedOptions: ComparableDesignOption[];
  selectedCriterionIds: string[];
  criteriaComparisons: CriterionCrossOptionComparison[];
  briefConstraintChecks: BriefConstraintCheckItem[];
  p30BriefSummary: P30BriefComparisonSummary;
  scoringEnabled: boolean;
  weights: Record<string, number>;
  optionScores: WeightedOptionScoreSummary[];
  isRankingTie: boolean;
  isRankingSensitiveToWeights: boolean;
  rankingStabilityExplanation: string;
  decisionSupportNarrative: string;
  globalWarnings: string[];
  complianceDisclaimer: string;
}

export interface SavedDesignComparisonConfig {
  id: string;
  calculationVersion: string;
  updatedAt: string;
  selectedOptionIds: string[];
  selectedCriterionIds: string[];
  scoringEnabled: boolean;
  customWeights: Record<string, number>;
  notes?: string;
}
