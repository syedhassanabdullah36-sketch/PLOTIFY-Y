/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P34 — Universal Accessibility Review
 * Account A | Locked Roadmap: P34 of P30–P40
 *
 * Strict provenance, jurisdiction/profile awareness, explicit result status
 * differentiation, and honest multi-dimensional accessibility evaluation.
 */

import { MeasurementUnit } from './project';

export const P34_ACCESSIBILITY_ENGINE_VERSION = 'p34-universal-accessibility-v1.0.0';

/**
 * Distinct accessibility evaluation states.
 * Never collapse unassessed or insufficient-data into 'meets-configured-criterion'.
 */
export type AccessibilityResultStatus =
  | 'meets-configured-criterion'
  | 'does-not-meet-configured-criterion'
  | 'warning'
  | 'unassessed'
  | 'insufficient-data'
  | 'not-applicable'
  | 'requires-human-review';

export type AccessibilityRuleProfileId =
  | 'general-screening-configurable'
  | 'us-ada-2010-standards'
  | 'iso-21542-2021-reference'
  | 'custom-project-profile';

export type BuildingOccupancyAccessibilityType =
  | 'residential-private'
  | 'multi-family-common'
  | 'public-accommodation'
  | 'commercial-workplace'
  | 'mixed-use'
  | 'unknown';

export type ConstructionAccessibilityScope =
  | 'new-construction'
  | 'alteration'
  | 'existing-facility'
  | 'unknown';

export type AccessibilityInputProvenance =
  | 'measured-project-geometry'
  | 'user-entered'
  | 'confirmed-p30-brief'
  | 'imported-p33-furniture-layout'
  | 'assumed-requires-verification'
  | 'missing-unmodeled';

export type AccessibilityTopicId =
  | 'mobility-turning-and-clear-floor'
  | 'accessible-routes-and-corridors'
  | 'doors-and-thresholds'
  | 'vertical-circulation-ramps-lifts-stairs'
  | 'sanitary-and-kitchen-fixtures'
  | 'reach-ranges-and-operable-parts'
  | 'wayfinding-tactile-and-signage'
  | 'visual-audible-alarms-and-communication'
  | 'site-approach-and-parking';

export interface AccessibilityProfileThresholds {
  unit: MeasurementUnit;
  /** Circular wheelchair turning space diameter (e.g., 5.0 ft / 60 in or 1.50 m / 1500 mm) */
  turningCircleDiameter: number;
  /** T-shaped turning space arm width (e.g., 3.0 ft / 36 in or 0.90 m / 900 mm) */
  tTurnArmWidth: number;
  /** T-shaped turning space overall span (e.g., 5.0 ft / 60 in or 1.50 m / 1500 mm) */
  tTurnTotalSpan: number;
  /** Stationary wheelchair clear floor space width (e.g., 2.5 ft / 30 in or 0.80 m / 800 mm) */
  clearFloorSpaceWidth: number;
  /** Stationary wheelchair clear floor space length/depth (e.g., 4.0 ft / 48 in or 1.30 m / 1300 mm) */
  clearFloorSpaceLength: number;
  /** Minimum clear opening width of accessible doorways when door is open 90 degrees (e.g., 2.67 ft / 32 in or 0.85 m) */
  minDoorClearOpeningWidth: number;
  /** Front approach pull-side maneuvering clearance depth perpendicular to doorway (e.g., 5.0 ft / 60 in or 1.50 m) */
  doorPullSideManeuverDepth: number;
  /** Front approach pull-side clearance beyond latch side (e.g., 1.5 ft / 18 in or 0.50 m) */
  doorPullSideLatchClearance: number;
  /** Front approach push-side maneuvering clearance depth perpendicular to doorway (e.g., 4.0 ft / 48 in or 1.20 m) */
  doorPushSideManeuverDepth: number;
  /** Maximum doorway threshold height in inches (when unit='feet') or mm (when unit='metres') */
  maxDoorThresholdHeightMinorUnit: number;
  /** Minimum continuous accessible route clear width (e.g., 3.0 ft / 36 in or 0.90 m / 900 mm) */
  minAccessibleRouteClearWidth: number;
  /** Minimum passing space width along accessible routes (e.g., 5.0 ft / 60 in or 1.50 m / 1500 mm) */
  minRoutePassingWidth: number;
  /** Maximum running slope ratio for accessible ramps (e.g., 1/12 = 0.08333) */
  maxRampSlopeRatio: number;
  /** Maximum cross slope ratio for accessible ramps and walking surfaces (e.g., 1/48 = 0.02083) */
  maxRampCrossSlopeRatio: number;
  /** Minimum clear width between handrails on an accessible ramp (e.g., 3.0 ft / 36 in or 1.00 m) */
  minRampClearWidth: number;
  /** Minimum unobstructed landing length at top and bottom of ramp run (e.g., 5.0 ft / 60 in or 1.50 m) */
  minRampLandingLength: number;
  /** Minimum clear width of stairs (e.g., 3.0 ft / 36 in or 1.00 m) */
  minStairClearWidth: number;
  /** Minimum internal width of accessible lift/elevator car (e.g., 4.25 ft / 51 in or 1.10 m) */
  minLiftCabWidth: number;
  /** Minimum internal depth of accessible lift/elevator car (e.g., 5.67 ft / 68 in or 1.40 m) */
  minLiftCabDepth: number;
  /** Minimum unobstructed forward/side reach height in inches (feet) or mm (metres) */
  minReachHeightMinorUnit: number;
  /** Maximum unobstructed forward/side reach height in inches (feet) or mm (metres) */
  maxReachHeightMinorUnit: number;
}

export interface AccessibilityRuleProfile {
  profileId: AccessibilityRuleProfileId;
  name: string;
  jurisdiction: string;
  standardName: string;
  editionOrVersion: string;
  sourceUrlOrCitation: string;
  authorityClassification:
    | 'general-screening-only'
    | 'statutory-standard'
    | 'international-reference'
    | 'user-configured';
  buildingOccupancyType: BuildingOccupancyAccessibilityType;
  constructionScope: ConstructionAccessibilityScope;
  thresholds: AccessibilityProfileThresholds;
  applicabilityNotes: string;
  statutoryDisclaimer: string;
}

/**
 * Optional door/opening accessibility metadata supplementing P33 KnownRoomOpening.
 * When fields are omitted, P34 reports them as unassessed / insufficient-data rather than inventing values.
 */
export interface DoorAccessibilityMetadata {
  openingId: string;
  /** Actual clear opening width when door leaf is open 90 degrees (distinct from rough/nominal width) */
  clearOpeningWidth?: number;
  /** Threshold height in inches (when project.unit='feet') or mm (when project.unit='metres') */
  thresholdHeightMinorUnit?: number;
  /** Available latch-side clearance on pull side in project.unit */
  pullSideLatchClearance?: number;
  /** Available maneuvering depth perpendicular to door on pull side in project.unit */
  pullSidePerpendicularDepth?: number;
  /** Available maneuvering depth perpendicular to door on push side in project.unit */
  pushSidePerpendicularDepth?: number;
  /** Whether door hardware is operable with one hand without tight grasping/pinching/twisting */
  hardwareOperableSingleHand?: boolean;
  /** Whether an automatic door opener or compliant closer delay is installed */
  hasCompliantCloserOrOpener?: boolean;
  provenance: AccessibilityInputProvenance;
  notes?: string;
  updatedAt: string;
}

export interface AccessibleRampElement {
  rampId: string;
  name: string;
  floorLevelStart: number;
  floorLevelEnd: number;
  connectsRoomOrExteriorIds: string[];
  clearWidth: number; // in project.unit
  runLength: number; // in project.unit
  verticalRise: number; // in project.unit
  crossSlopeRatio?: number;
  topLandingLength?: number; // in project.unit
  bottomLandingLength?: number; // in project.unit
  hasHandrailsBothSides?: boolean;
  hasEdgeProtection?: boolean;
  provenance: AccessibilityInputProvenance;
  updatedAt: string;
}

export interface AccessibleStairElement {
  stairId: string;
  name: string;
  floorLevelStart: number;
  floorLevelEnd: number;
  clearWidth: number; // in project.unit
  riserHeightMinorUnit?: number; // inches or mm
  treadDepthMinorUnit?: number; // inches or mm
  hasContinuousHandrails?: boolean;
  hasTactileWarningStrips?: boolean;
  hasVisualContrastNosings?: boolean;
  provenance: AccessibilityInputProvenance;
  updatedAt: string;
}

export interface AccessibleVerticalLiftElement {
  liftId: string;
  name: string;
  liftType: 'passenger-elevator' | 'platform-lift' | 'limited-use-elevator';
  servedFloors: number[];
  cabClearWidth: number; // in project.unit
  cabClearDepth: number; // in project.unit
  doorClearWidth: number; // in project.unit
  hasTactileAndBrailleControls?: boolean;
  hasAudibleAndVisualIndicators?: boolean;
  provenance: AccessibilityInputProvenance;
  updatedAt: string;
}

export interface AccessibleFixtureMetadata {
  fixtureId: string;
  /** Links to P33 PlacedFurnitureInstance.instanceId if associated with a placed item */
  linkedFurnitureInstanceId?: string;
  roomId: string;
  floorLevel: number;
  fixtureType: 'wc-toilet' | 'lavatory-sink' | 'roll-in-shower' | 'transfer-shower' | 'bathtub' | 'kitchen-sink' | 'work-surface';
  hasKneeAndToeClearance?: boolean;
  hasTransferSpace?: boolean;
  transferSpaceWidth?: number; // in project.unit
  transferSpaceDepth?: number; // in project.unit
  hasGrabBarsOrBlocking?: boolean;
  rimOrCounterHeightMinorUnit?: number; // inches or mm
  provenance: AccessibilityInputProvenance;
  updatedAt: string;
}

export interface AccessibleOperableControlElement {
  controlId: string;
  roomId: string;
  floorLevel: number;
  controlType: 'light-switch' | 'thermostat' | 'power-outlet' | 'intercom-panel' | 'emergency-pull-cord' | 'window-operator';
  mountingHeightMinorUnit: number; // inches or mm above finished floor
  hasClearFloorSpaceAtControl: boolean;
  isObstructedReach: boolean;
  obstructionDepthMinorUnit?: number; // inches or mm
  operableSingleHandWithoutTwisting?: boolean;
  provenance: AccessibilityInputProvenance;
  updatedAt: string;
}

export interface AccessibleSensoryWayfindingElement {
  elementId: string;
  roomId?: string;
  floorLevel: number;
  category: 'tactile-braille-signage' | 'visual-audible-alarm' | 'assistive-listening-loop' | 'high-contrast-wayfinding';
  description: string;
  isProvided: boolean;
  provenance: AccessibilityInputProvenance;
  updatedAt: string;
}

export interface ProjectAccessibilityElements {
  doorDetails: Record<string, DoorAccessibilityMetadata>;
  ramps: AccessibleRampElement[];
  stairs: AccessibleStairElement[];
  verticalLifts: AccessibleVerticalLiftElement[];
  fixtureDetails: AccessibleFixtureMetadata[];
  operableControls: AccessibleOperableControlElement[];
  sensoryAndWayfinding: AccessibleSensoryWayfindingElement[];
}

export interface AccessibilityGeometricOverlayItem {
  overlayId: string;
  floorLevel: number;
  roomId?: string;
  kind: 'turning-circle' | 't-turn-space' | 'clear-floor-space' | 'door-maneuvering-zone' | 'route-bottleneck';
  status: AccessibilityResultStatus;
  label: string;
  /** Center and diameter for circular turning space */
  circle?: {
    cx: number;
    cy: number;
    diameter: number;
  };
  /** Axis-aligned rectangle for clear floor space, maneuvering zone, or bounding box */
  rect?: {
    x: number;
    y: number;
    width: number;
    length: number;
  };
  measuredDisplay: string;
  requiredDisplay: string;
}

export interface AccessibilityCriterionResult {
  criterionId: string;
  topicId: AccessibilityTopicId;
  title: string;
  clauseOrRuleReference: string;
  ruleProfileId: AccessibilityRuleProfileId;
  targetScope: 'project' | 'floor' | 'room' | 'opening' | 'fixture' | 'vertical-element' | 'control' | 'sensory';
  targetId: string;
  targetName: string;
  floorLevel?: number;
  status: AccessibilityResultStatus;
  isMandatoryFromBrief: boolean;
  measuredValue: number | string | null;
  requiredValue: number | string | null;
  unit: string;
  inputProvenance: AccessibilityInputProvenance[];
  explanation: string;
  remediationGuidance?: string;
  missingInputsRequired?: string[];
  geometricOverlay?: AccessibilityGeometricOverlayItem;
}

export interface AccessibilityTopicCoverageItem {
  topicId: AccessibilityTopicId;
  topicTitle: string;
  description: string;
  coverageState: 'evaluated' | 'partially-evaluated' | 'unassessed-missing-data' | 'not-applicable';
  totalCriteriaCount: number;
  meetsCount: number;
  failsCount: number;
  warningCount: number;
  unassessedOrInsufficientCount: number;
  requiresHumanReviewCount: number;
  whatIsEvaluated: string[];
  whatRemainsUnassessed: string[];
}

export interface RoomAccessibilityDiagnostic {
  roomId: string;
  roomName: string;
  roomType: string;
  floorLevel: number;
  isMandatoryWheelchairAccessibleInBrief: boolean;
  roomWidth: number;
  roomLength: number;
  /** Exact maximum unobstructed square/circle diameter inside room after subtracting furniture & fixed obstacles */
  maxClearInscribedCircleDiameter: number;
  requiredTurningCircleDiameter: number;
  turningCircleCenter?: { cx: number; cy: number };
  turningSpaceStatus: AccessibilityResultStatus;
  tTurnSpaceAvailable: boolean;
  clearFloorSpacesEvaluated: number;
  clearFloorSpacesPassing: number;
  clearFloorSpacesFailing: number;
  doorsEvaluated: number;
  doorsPassing: number;
  doorsFailing: number;
  doorsInsufficientData: number;
  routeConnectionStatus: AccessibilityResultStatus;
  overallRoomStatus: AccessibilityResultStatus;
  criterionResults: AccessibilityCriterionResult[];
}

export interface AccessibilityImprovementSuggestion {
  suggestionId: string;
  title: string;
  targetRoomId?: string;
  targetElementId?: string;
  affectedCriterionIds: string[];
  actionType:
    | 'reposition-blocking-furniture'
    | 'remove-blocking-furniture'
    | 'widen-door-opening-record'
    | 'flip-inward-door-swing-outward'
    | 'expand-room-dimension-advisory';
  canAutoPreviewAndApply: boolean;
  rationale: string;
  expectedAccessibilityImprovement: string;
  tradeOffsAndDownstreamImpact: string[];
  proposedMutationSummary: string;
  mutationPayload?: {
    furnitureInstanceId?: string;
    proposedFurnitureX?: number;
    proposedFurnitureY?: number;
    proposedFurnitureRotation?: 0 | 90 | 180 | 270;
    removeFurnitureInstanceId?: string;
    openingId?: string;
    proposedOpeningWidth?: number;
    proposedClearOpeningWidth?: number;
    proposedSwingDirection?: 'outward' | 'sliding-or-none';
  };
}

export interface AccessibilitySuggestionPreview {
  suggestionId: string;
  suggestionTitle: string;
  evaluatedAt: string;
  beforeSummary: {
    meetsCount: number;
    failsCount: number;
    warningCount: number;
    unassessedOrInsufficientCount: number;
  };
  afterSummary: {
    meetsCount: number;
    failsCount: number;
    warningCount: number;
    unassessedOrInsufficientCount: number;
  };
  resolvedCriterionIds: string[];
  newlyIntroducedFailureIds: string[];
  netFailureDelta: number;
  isSafeToApply: boolean;
  previewNotes: string[];
  proposedProjectState: {
    furnitureLayout?: unknown;
    accessibilityReview?: ProjectAccessibilityReviewData;
  };
}

export interface P30P32AccessibilityAlignmentReport {
  hasMandatoryBriefAccessibilityFlag: boolean;
  briefAccessibilityNotes: string;
  briefSpacesRequiringWheelchairAccess: Array<{
    spaceId: string;
    spaceName: string;
    matchedRoomId?: string;
    matchedRoomName?: string;
    roomAccessibilityStatus: AccessibilityResultStatus;
  }>;
  confirmedInterpretedAccessibilityRequirements: Array<{
    requirementId: string;
    text: string;
    source: string;
  }>;
  unconfirmedAccessibilityAssumptions: Array<{
    assumptionId: string;
    text: string;
    status: string;
  }>;
  p32SoftPreferenceGuardrailCheck: {
    softPreferencesInspected: number;
    mandatoryCriteriaOverriddenByPreferences: number; // Always 0 — enforced invariant
    guardrailExplanation: string;
  };
}

export interface UniversalAccessibilityEvaluationReport {
  engineVersion: string;
  evaluatedAt: string;
  sourceFingerprint: string;
  isStale: boolean;
  staleReasons: string[];
  unit: MeasurementUnit;
  activeRuleProfile: AccessibilityRuleProfile;
  summaryCounts: {
    totalCriteria: number;
    meetsConfiguredCriterion: number;
    doesNotMeetConfiguredCriterion: number;
    warning: number;
    unassessed: number;
    insufficientData: number;
    notApplicable: number;
    requiresHumanReview: number;
    mandatoryFailuresCount: number;
  };
  overallReviewState:
    | 'meets-evaluated-criteria-with-unassessed-areas'
    | 'all-evaluated-criteria-met'
    | 'mandatory-or-configured-criteria-failing'
    | 'review-incomplete-insufficient-data';
  topicCoverage: AccessibilityTopicCoverageItem[];
  roomDiagnostics: RoomAccessibilityDiagnostic[];
  allCriterionResults: AccessibilityCriterionResult[];
  geometricOverlays: AccessibilityGeometricOverlayItem[];
  p30P32Alignment: P30P32AccessibilityAlignmentReport;
  improvementSuggestions: AccessibilityImprovementSuggestion[];
  gridResolutionNotice: string;
  complianceBoundaryDisclaimer: string;
}

export interface P34OptionComparisonSummary {
  optionId: string;
  optionName: string;
  activeRuleProfileName: string;
  meetsCount: number;
  failsCount: number;
  warningCount: number;
  unassessedOrInsufficientCount: number;
  requiresHumanReviewCount: number;
  mandatoryFailuresCount: number;
  roomsWithTurningCircleCount: number;
  totalRoomsEvaluated: number;
  hasMultiStoreyVerticalAccessGap: boolean;
  overallStatusBadge:
    | 'Evaluated Criteria Met (Unassessed Topics Remain)'
    | 'Fails Configured Accessibility Criteria'
    | 'Mandatory Accessibility Conflict'
    | 'Insufficient Data for Review';
  caveats: string[];
}

export interface ProjectAccessibilityReviewData {
  activeProfileId: AccessibilityRuleProfileId;
  buildingOccupancyType: BuildingOccupancyAccessibilityType;
  constructionScope: ConstructionAccessibilityScope;
  customThresholds?: Partial<AccessibilityProfileThresholds>;
  elements: ProjectAccessibilityElements;
  lastEvaluatedAt?: string;
  lastSourceFingerprint?: string;
  lastPreApplySnapshotId?: string;
  requestSequenceId: number;
}
