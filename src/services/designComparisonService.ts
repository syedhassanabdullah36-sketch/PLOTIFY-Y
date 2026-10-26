import {
  Currency,
  FloorPlanRoom,
  MeasurementUnit,
  Project,
} from '../types/project';
import {
  BriefConstraintCheckItem,
  BriefConstraintOptionOutcome,
  ComparableDesignOption,
  ComparisonCriterionDefinition,
  CriterionCrossOptionComparison,
  CriterionEvaluationStatus,
  CriterionScoreContribution,
  MultiOptionComparisonResult,
  OptionCriterionValue,
  OptionValidationDiagnostics,
  P31_COMPARISON_CALCULATION_VERSION,
  P30BriefComparisonSummary,
  SavedDesignComparisonConfig,
  WeightedOptionScoreSummary,
} from '../types/designComparison';
import {
  calculateSpaceProgramSummary,
  compareBriefWithFloorPlan,
  initializeProjectBrief,
  validateBrief,
} from './briefService';
import {
  calculateEmbodiedCarbon,
  calculateEstimatedCost,
} from './scenarioCalculator';
import { validateFloorPlan } from '../utils/geometry';
import { evaluateConstraintGraph } from './constraintGraphService';
import { evaluateSiteConstraints } from './siteIntelligenceService';
import { formatCurrency } from '../utils/formatters';

export { P31_COMPARISON_CALCULATION_VERSION };

export const P31_COMPLIANCE_DISCLAIMER =
  'Multi-option comparison provides deterministic decision support based solely on modeled 2D geometry, declared parameters, and confirmed brief requirements. It does NOT certify regulatory code compliance, structural engineering safety, universal accessibility compliance, or contractor tender pricing.';

const SQM_TO_SQFT = 10.7639104;
const M_TO_FT = 3.2808399;

/**
 * Deep-clones a FloorPlanRoom array so comparison operations never mutate source designs.
 */
function cloneRooms(rooms: FloorPlanRoom[] | undefined): FloorPlanRoom[] {
  if (!Array.isArray(rooms)) return [];
  return rooms.map((r) => ({ ...r }));
}

/**
 * Rounds a number to a specified step (e.g. 0.1 or 1).
 */
export function roundToStep(value: number, step: number = 0.1): number {
  if (!Number.isFinite(value) || step <= 0) return value;
  const inv = Math.round(1 / step);
  if (inv > 0 && Math.abs(1 / step - inv) < 1e-6) {
    return Math.round(value * inv) / inv;
  }
  return Math.round(value / step) * step;
}

/**
 * Converts a linear or area measurement into the target unit system when two options
 * use different measurement units ('feet' vs 'metres').
 */
export function convertMeasurementUnit(
  value: number,
  fromUnit: MeasurementUnit,
  toUnit: MeasurementUnit,
  dimensionType: 'linear' | 'area'
): number {
  if (fromUnit === toUnit) return value;
  if (dimensionType === 'area') {
    return fromUnit === 'metres' && toUnit === 'feet'
      ? value * SQM_TO_SQFT
      : value / SQM_TO_SQFT;
  }
  return fromUnit === 'metres' && toUnit === 'feet'
    ? value * M_TO_FT
    : value / M_TO_FT;
}

/**
 * Extracts all real, existing design options from a Project without fabricating fake options.
 * Supports:
 * 1. The Baseline Project Design (`baseline:<project.id>`)
 * 2. Saved or draft DesignScenarios in `project.scenarios` (`scenario:<scenario.id>`)
 * 3. Saved DesignAlternatives in `project.designAlternatives` (`alternative:<alt.id>`)
 * 4. Optional unsaved preview draft passed explicitly by caller (`draft:<id>`)
 */
export function extractComparableOptions(
  project: Project,
  options?: {
    includeScenarios?: boolean;
    includeAlternatives?: boolean;
    unsavedDraftOption?: ComparableDesignOption;
  }
): ComparableDesignOption[] {
  if (!project || typeof project !== 'object') return [];

  const includeScenarios = options?.includeScenarios ?? true;
  const includeAlternatives = options?.includeAlternatives ?? true;

  const result: ComparableDesignOption[] = [];
  const seenIds = new Set<string>();

  const baselineAlt =
    project.designAlternatives?.find((a) => a.id === project.activeAlternativeId) ||
    project.designAlternatives?.[0];

  // 1. Authoritative Baseline Project Design
  const baselineOptionId = `baseline:${project.id}`;
  seenIds.add(baselineOptionId);
  result.push({
    optionId: baselineOptionId,
    sourceId: project.id,
    name: `${project.name} (Baseline Design)`,
    description:
      'Authoritative baseline project configuration reflecting current 2D floor plan, storeys, and target budget.',
    kind: 'baseline-project',
    persistenceState: 'baseline',
    createdAt: project.createdAt || new Date().toISOString(),
    updatedAt: project.updatedAt || new Date().toISOString(),
    unit: project.unit || 'feet',
    currency: project.currency || 'USD',
    plotWidth: typeof project.plotWidth === 'number' ? project.plotWidth : 0,
    plotLength: typeof project.plotLength === 'number' ? project.plotLength : 0,
    floors: typeof project.floors === 'number' ? project.floors : 1,
    budget: typeof project.budget === 'number' ? project.budget : 0,
    rooms: cloneRooms(project.floorPlan?.rooms),
    facade: baselineAlt?.facade ? { ...baselineAlt.facade } : undefined,
    interiorsConfiguredCount: baselineAlt?.interiors
      ? Object.keys(baselineAlt.interiors).length
      : 0,
    sharesBaselineGeometry: false,
    notes: project.notes,
  });

  // 2. Existing Design Scenarios (if present on project)
  if (includeScenarios && Array.isArray(project.scenarios)) {
    for (const scen of project.scenarios) {
      if (!scen || !scen.id || scen.isBaseline) continue;
      const optId = `scenario:${scen.id}`;
      if (seenIds.has(optId)) continue;
      seenIds.add(optId);

      result.push({
        optionId: optId,
        sourceId: scen.id,
        name: scen.name || `Scenario ${scen.id}`,
        description:
          scen.description ||
          'Spatial and massing scenario with independent room geometry, storey count, and budget target.',
        kind: 'design-scenario',
        persistenceState: scen.status === 'draft' ? 'unsaved-preview' : 'saved',
        createdAt: scen.createdAt || project.createdAt,
        updatedAt: scen.updatedAt || project.updatedAt,
        unit: project.unit || 'feet',
        currency: project.currency || 'USD',
        plotWidth: typeof project.plotWidth === 'number' ? project.plotWidth : 0,
        plotLength: typeof project.plotLength === 'number' ? project.plotLength : 0,
        floors: typeof scen.floors === 'number' ? scen.floors : project.floors,
        budget: typeof scen.budget === 'number' ? scen.budget : project.budget,
        rooms: cloneRooms(scen.rooms),
        facade: scen.facade
          ? { ...scen.facade }
          : baselineAlt?.facade
          ? { ...baselineAlt.facade }
          : undefined,
        interiorsConfiguredCount: baselineAlt?.interiors
          ? Object.keys(baselineAlt.interiors).length
          : 0,
        sharesBaselineGeometry: false,
        notes: scen.notes,
      });
    }
  }

  // 3. Existing Design Studio Alternatives (if present on project)
  if (includeAlternatives && Array.isArray(project.designAlternatives)) {
    for (const alt of project.designAlternatives) {
      if (!alt || !alt.id) continue;
      const optId = `alternative:${alt.id}`;
      if (seenIds.has(optId)) continue;
      seenIds.add(optId);

      result.push({
        optionId: optId,
        sourceId: alt.id,
        name: alt.name || `Alternative ${alt.id}`,
        description:
          alt.description ||
          'Architectural facade, material palette, and interior specification alternative sharing the baseline 2D floor plan.',
        kind: 'design-alternative',
        persistenceState: 'saved',
        createdAt: alt.createdAt || project.createdAt,
        updatedAt: alt.createdAt || project.updatedAt,
        unit: project.unit || 'feet',
        currency: project.currency || 'USD',
        plotWidth: typeof project.plotWidth === 'number' ? project.plotWidth : 0,
        plotLength: typeof project.plotLength === 'number' ? project.plotLength : 0,
        floors: typeof project.floors === 'number' ? project.floors : 1,
        budget: typeof project.budget === 'number' ? project.budget : 0,
        rooms: cloneRooms(project.floorPlan?.rooms),
        facade: alt.facade ? { ...alt.facade } : undefined,
        interiorsConfiguredCount: alt.interiors ? Object.keys(alt.interiors).length : 0,
        sharesBaselineGeometry: true,
        notes: alt.facade?.notes,
      });
    }
  }

  // 4. Optional unsaved preview draft option
  if (options?.unsavedDraftOption && options.unsavedDraftOption.optionId) {
    const draft = options.unsavedDraftOption;
    if (!seenIds.has(draft.optionId)) {
      seenIds.add(draft.optionId);
      result.push({
        ...draft,
        persistenceState: 'unsaved-preview',
        rooms: cloneRooms(draft.rooms),
      });
    }
  }

  return result;
}

/**
 * Validates user-selected option IDs against the available options list.
 * Rejects duplicates, identifies missing/deleted option IDs, and requires >= 2 valid options.
 */
export function validateSelectedOptionIds(
  availableOptions: ComparableDesignOption[],
  requestedOptionIds: string[]
): OptionValidationDiagnostics {
  const availableMap = new Map<string, ComparableDesignOption>();
  for (const opt of availableOptions) {
    if (opt && opt.optionId) {
      availableMap.set(opt.optionId, opt);
    }
  }

  const validSelectedOptions: ComparableDesignOption[] = [];
  const rejectedDuplicateIds: string[] = [];
  const missingOrDeletedIds: string[] = [];
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];
  const seen = new Set<string>();

  for (const rawId of requestedOptionIds || []) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id) continue;

    if (seen.has(id)) {
      rejectedDuplicateIds.push(id);
      validationWarnings.push(
        `Duplicate option identifier "${id}" was ignored so the same option is not compared against itself.`
      );
      continue;
    }
    seen.add(id);

    const found = availableMap.get(id);
    if (!found) {
      missingOrDeletedIds.push(id);
      validationWarnings.push(
        `Option "${id}" is no longer available in the project (deleted or stale reference) and was excluded.`
      );
      continue;
    }

    validSelectedOptions.push(found);
  }

  const hasMinimumTwoOptions = validSelectedOptions.length >= 2;
  if (!hasMinimumTwoOptions) {
    validationErrors.push(
      `At least 2 distinct valid design options are required for comparison (currently ${validSelectedOptions.length} selected).`
    );
  }

  // Check if all selected options are DesignAlternatives that share identical baseline 2D geometry
  if (
    validSelectedOptions.length >= 2 &&
    validSelectedOptions.every((o) => o.sharesBaselineGeometry || o.kind === 'baseline-project') &&
    validSelectedOptions.some((o) => o.sharesBaselineGeometry)
  ) {
    const allSameRoomCount = new Set(validSelectedOptions.map((o) => o.rooms.length)).size === 1;
    if (allSameRoomCount) {
      validationWarnings.push(
        'One or more selected Design Studio Alternatives share the baseline 2D room layout; spatial geometry metrics will match the baseline while facade cost tier, primary material, and embodied carbon differ.'
      );
    }
  }

  return {
    validSelectedOptions,
    rejectedDuplicateIds,
    missingOrDeletedIds,
    hasMinimumTwoOptions,
    validationErrors,
    validationWarnings,
  };
}

/**
 * Returns the full catalog of comparison criteria, including both supported P31 metrics
 * and explicitly unavailable future roadmap criteria (P33–P38) so availability is transparent.
 */
export function getComparisonCriteriaCatalog(
  project?: Partial<Project>
): ComparisonCriterionDefinition[] {
  const areaUnit = project?.unit === 'metres' ? 'm²' : 'sq ft';
  const currencyUnit = project?.currency || 'USD';

  return [
    // =========================================================================
    // CATEGORY A: SPACE-PROGRAM & P30 BRIEF FIT
    // =========================================================================
    {
      id: 'confirmed-brief-fit',
      name: 'Confirmed P30 Brief Requirements Met',
      category: 'space-program-fit',
      plainLanguageMeaning:
        'Percentage of explicitly user-confirmed P30 brief requirements satisfied by the design option.',
      formula:
        '(Confirmed P30 Requirements Satisfied / Total Evaluable Confirmed P30 Requirements) × 100',
      requiredSourceFields: [
        'project.brief.interpretedBrief.requirements',
        'option.rooms',
        'option.floors',
        'option.budget',
      ],
      unit: '%',
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'higher-is-better',
      isHardConstraint: true,
      defaultWeight: 20,
      roundingStep: 1,
      toleranceNote: '±5% area tolerance on numeric target area requirements.',
      assumptions: [
        'Only requirements with reviewStatus === "confirmed" are treated as binding constraints.',
        'Unconfirmed AI-inferred requirements (reviewStatus === "needs-review") are tracked separately as assumptions and excluded from this score.',
      ],
      limitations: [
        'Does not prove overall architectural quality or statutory code compliance.',
        'Qualitative aesthetic preferences cannot be verified geometrically.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if no P30 interpreted brief or confirmed requirements exist on the project.',
    },
    {
      id: 'mandatory-space-placement',
      name: 'Mandatory Programmed Spaces Placed',
      category: 'space-program-fit',
      plainLanguageMeaning:
        'Proportion of mandatory room instances from the Space Program Schedule that are placed on the option’s 2D floor plan.',
      formula:
        '(Placed Mandatory Room Instances / Total Required Mandatory Room Instances) × 100',
      requiredSourceFields: ['project.brief.spaces', 'option.rooms'],
      unit: '%',
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'higher-is-better',
      isHardConstraint: true,
      defaultWeight: 20,
      roundingStep: 1,
      toleranceNote: 'Exact room instance count matching via compareBriefWithFloorPlan.',
      assumptions: [
        'Matches placed 2D rooms to programmed spaces by room category and name keywords.',
      ],
      limitations: [
        'Checks room presence and count; room shape and furniture fit are not evaluated here.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if the project has no programmed mandatory spaces or if the option has zero placed rooms.',
    },
    {
      id: 'program-net-area-delta',
      name: 'Net Area vs. Programmed Target Area',
      category: 'space-program-fit',
      plainLanguageMeaning:
        'Difference between the option’s net usable room area and the Space Program Schedule’s total target net area.',
      formula: 'Option Net Usable Room Area − Brief Total Target Net Area',
      requiredSourceFields: ['project.brief.spaces', 'option.rooms'],
      unit: areaUnit,
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'target-match',
      isHardConstraint: false,
      defaultWeight: 10,
      roundingStep: 0.1,
      toleranceNote: 'Within ±10% of target net area is considered well-aligned.',
      assumptions: [
        'Target net area is the sum of (targetArea × quantity) across all programmed spaces in project.brief.spaces.',
      ],
      limitations: [
        'Aggregate net area match does not guarantee every individual room meets its specific target area.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if the option has no valid placed rooms or no brief space program.',
    },

    // =========================================================================
    // CATEGORY B: FLOOR AREA & DIMENSIONS
    // =========================================================================
    {
      id: 'net-usable-room-area',
      name: 'Net Usable Interior Room Area',
      category: 'floor-area-dimensions',
      plainLanguageMeaning:
        'Total interior floor area summed across all valid placed rooms on all storeys.',
      formula: 'Σ (room.width × room.length) for all rooms with width > 0 and length > 0',
      requiredSourceFields: ['option.rooms[].width', 'option.rooms[].length', 'option.unit'],
      unit: areaUnit,
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'higher-is-better',
      isHardConstraint: false,
      defaultWeight: 15,
      roundingStep: 0.1,
      toleranceNote: '0.1 area unit rounding; rooms with non-positive dimensions are flagged as invalid.',
      assumptions: [
        'Represents net interior room dimensions excluding interior/exterior wall thickness and unmodeled corridors.',
      ],
      limitations: [
        'If two rooms overlap geometrically, raw sum includes both rooms until overlaps are resolved (overlaps are flagged in Geometry Conflicts).',
      ],
      missingDataBehavior:
        'Marked "unavailable" (never 0) if no valid rooms are placed in the option.',
    },
    {
      id: 'estimated-gross-floor-area',
      name: 'Estimated Gross Floor Area (GFA)',
      category: 'floor-area-dimensions',
      plainLanguageMeaning:
        'Estimated total building floor area including net room areas plus circulation and structural wall allowance.',
      formula:
        'Net Usable Room Area × (1 + Circulation & Wall Allowance % / 100) [scaled by storeys only if upper floors have no explicit rooms]',
      requiredSourceFields: [
        'option.rooms',
        'option.floors',
        'project.brief.circulationWallAllowancePercent',
      ],
      unit: areaUnit,
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'informational',
      isHardConstraint: false,
      defaultWeight: 0,
      roundingStep: 0.1,
      toleranceNote: '0.1 area unit rounding.',
      assumptions: [
        'Uses the project brief circulation/wall allowance (default 15%) when corridors and wall thicknesses are not explicitly drawn.',
        'Avoids double-counting storeys when rooms already carry explicit floorLevel > 1 tags.',
      ],
      limitations: [
        'Parametric gross estimate rather than an external wall polygon boundary measurement.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if net usable room area is unavailable.',
    },
    {
      id: 'plot-ground-coverage',
      name: 'Ground-Floor Plot Coverage Ratio',
      category: 'floor-area-dimensions',
      plainLanguageMeaning:
        'Percentage of the site parcel area occupied by ground-floor (Level 1) rooms.',
      formula: '(Ground Floor Room Area / (plotWidth × plotLength)) × 100',
      requiredSourceFields: ['option.rooms', 'option.plotWidth', 'option.plotLength'],
      unit: '%',
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'lower-is-better',
      isHardConstraint: false,
      defaultWeight: 5,
      roundingStep: 0.1,
      toleranceNote: '±0.1% coverage ratio.',
      assumptions: [
        'Ground footprint is the sum of Level 1 rooms.',
        'Coverage above 60–80% typically triggers municipal setback or impervious surface warnings.',
      ],
      limitations: [
        'Does not include roof overhangs or cantilevered upper floors unless supported on Level 1.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if plotWidth <= 0, plotLength <= 0, or no valid rooms exist.',
    },
    {
      id: 'building-storey-count',
      name: 'Building Storeys & Placed Room Count',
      category: 'floor-area-dimensions',
      plainLanguageMeaning:
        'Number of vertical building storeys and total number of placed functional rooms.',
      formula: 'option.floors storeys | count(valid option.rooms) rooms',
      requiredSourceFields: ['option.floors', 'option.rooms'],
      unit: 'storeys',
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'informational',
      isHardConstraint: false,
      defaultWeight: 0,
      roundingStep: 1,
      toleranceNote: 'Exact integer counts.',
      assumptions: [
        'Flags a warning if any room is assigned to a floorLevel exceeding option.floors.',
      ],
      limitations: ['Does not measure floor-to-ceiling height in 2D plan.'],
      missingDataBehavior: 'Marked "unavailable" if floors <= 0.',
    },

    // =========================================================================
    // CATEGORY C: SPACE EFFICIENCY
    // =========================================================================
    {
      id: 'buildable-envelope-efficiency',
      name: 'Buildable Setback Envelope Utilization',
      category: 'space-efficiency',
      plainLanguageMeaning:
        'Ratio of ground-floor building footprint to the legal buildable site envelope after subtracting front, rear, and side setbacks.',
      formula:
        '(Ground Floor Footprint / ((plotWidth − sideLeft − sideRight) × (plotLength − front − rear))) × 100',
      requiredSourceFields: [
        'option.rooms',
        'option.plotWidth',
        'option.plotLength',
        'project.siteContext.setbacks',
      ],
      unit: '%',
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'target-match',
      isHardConstraint: false,
      defaultWeight: 5,
      roundingStep: 0.1,
      toleranceNote: '≤ 100% fits within buildable setback envelope Area; > 100% exceeds envelope.',
      assumptions: [
        'Requires valid plot dimensions and site setback distances.',
        'Does not invent an arbitrary industry benchmark; >100% indicates footprint exceeds the setback-adjusted buildable area.',
      ],
      limitations: [
        'Evaluates area ratio against setback envelope; exact coordinate encroachment is checked in Geometry & Boundary Conflicts.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if plot dimensions or site setback definitions are missing.',
    },
    {
      id: 'net-to-gross-area-ratio',
      name: 'Net-to-Gross Floor Area Ratio',
      category: 'space-efficiency',
      plainLanguageMeaning:
        'Ratio of net usable interior room area to estimated Gross Floor Area (GFA).',
      formula: '(Net Usable Room Area / Estimated GFA) × 100',
      requiredSourceFields: [
        'option.rooms',
        'project.brief.circulationWallAllowancePercent',
      ],
      unit: '%',
      defaultSelected: false,
      isAvailableInCodebase: true,
      preferenceDirection: 'informational',
      isHardConstraint: false,
      defaultWeight: 0,
      roundingStep: 0.1,
      toleranceNote: 'Derived directly from the active circulation/wall allowance.',
      assumptions: [
        'When GFA is calculated using a uniform circulation allowance (e.g. 15%), Net/Gross equals 1 / (1 + allowance) (e.g. 87.0%) unless explicit hallway rooms are modeled.',
        'Explicitly separated from corridor/hallway room area so options are not artificially differentiated when sharing the same allowance factor.',
      ],
      limitations: [
        'Does not measure physical corridor routing efficiency (reserved for P33).',
      ],
      missingDataBehavior:
        'Marked "unavailable" if net or gross floor area is unavailable.',
    },

    // =========================================================================
    // CATEGORY D: FUNCTIONAL & GEOMETRY INTEGRITY
    // =========================================================================
    {
      id: 'geometry-boundary-conflicts',
      name: '2D Geometry, Boundary & Adjacency Conflicts',
      category: 'functional-circulation',
      plainLanguageMeaning:
        'Total count of measurable 2D room-to-room overlaps, parcel boundary overflows, and spatial adjacency rule violations.',
      formula:
        'count(AABB Room Overlaps > 0.05) + count(Parcel Boundary Overflows > 0.01) + count(Brief Adjacency Conflicts)',
      requiredSourceFields: [
        'option.rooms',
        'option.plotWidth',
        'option.plotLength',
        'project.brief.relationships',
      ],
      unit: 'conflicts',
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'lower-is-better',
      isHardConstraint: true,
      defaultWeight: 15,
      roundingStep: 1,
      toleranceNote: '0.05 linear unit overlap tolerance; 0.01 boundary tolerance.',
      assumptions: [
        'Uses deterministic Axis-Aligned Bounding Box (AABB) intersection checks on the same floorLevel.',
      ],
      limitations: [
        'Checks rectangular room bounding boxes and programmed adjacency rules; does not verify door swing clearances (reserved for P33/P34).',
      ],
      missingDataBehavior:
        'Marked "unavailable" if the option has no placed rooms or plot dimensions are missing.',
    },
    {
      id: 'corridor-furniture-circulation',
      name: 'Furniture Clearances & Corridor Path Efficiency (P33)',
      category: 'functional-circulation',
      plainLanguageMeaning:
        'Detailed furniture layout clearances, doorway swing paths, and travel-distance circulation analysis.',
      formula: 'Not available — reserved for P33 Furniture & Circulation Intelligence',
      requiredSourceFields: ['furnitureLayout', 'circulationPaths', 'doorways'],
      unit: 'N/A',
      defaultSelected: false,
      isAvailableInCodebase: false,
      unavailableCodebaseReason:
        'Unimplemented in P31 by scope lock: detailed furniture placement and circulation path geometry belong to P33 (Furniture & Circulation Intelligence).',
      preferenceDirection: 'informational',
      isHardConstraint: false,
      defaultWeight: 0,
      roundingStep: 1,
      toleranceNote: 'N/A',
      assumptions: [],
      limitations: ['Not evaluated in P31.'],
      missingDataBehavior: 'Always marked "unavailable" with explicit scope boundary explanation.',
    },

    // =========================================================================
    // CATEGORY E: BUDGET & COST COMPARISON
    // =========================================================================
    {
      id: 'estimated-construction-cost',
      name: 'Parametric Estimated Construction Cost',
      category: 'budget-cost',
      plainLanguageMeaning:
        'Preliminary parametric construction cost estimate derived from Gross Floor Area, facade specification tier, and multi-storey complexity.',
      formula:
        'Estimated GFA × Base Unit Rate(unit, facade.costTier) × (1 + max(0, floors − 1) × 0.06)',
      requiredSourceFields: [
        'option.rooms',
        'option.floors',
        'option.facade.costTier',
        'option.currency',
      ],
      unit: currencyUnit,
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'lower-is-better',
      isHardConstraint: false,
      defaultWeight: 10,
      roundingStep: 1,
      toleranceNote: 'Rounded to nearest whole currency unit.',
      assumptions: [
        'Uses deterministic parametric unit rates by costTier (Economic, Balanced Mid-Range, High-End Architectural, Ultra Luxury) and +6% per upper storey.',
        'If option.facade.costTier is not specified, cost cannot be estimated without assuming a tier and is marked "unavailable".',
      ],
      limitations: [
        'Preliminary order-of-magnitude estimate; does not replace a Quantity Surveyor tender or itemized contractor quote.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if GFA is unavailable, facade costTier is unspecified, or currencies are incomparable.',
    },
    {
      id: 'budget-surplus-deficit',
      name: 'Declared Budget Surplus / (Deficit)',
      category: 'budget-cost',
      plainLanguageMeaning:
        'Difference between the option’s declared target budget and its parametric estimated construction cost.',
      formula: 'Declared Option Budget − Parametric Estimated Construction Cost',
      requiredSourceFields: [
        'option.budget',
        'option.currency',
        'estimated-construction-cost',
      ],
      unit: currencyUnit,
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'higher-is-better',
      isHardConstraint: true,
      defaultWeight: 10,
      roundingStep: 1,
      toleranceNote: '≥ 0 indicates within declared budget; < 0 indicates projected budget deficit.',
      assumptions: [
        'Requires both a positive user-declared budget (budget > 0) and a valid parametric cost estimate in the same currency.',
      ],
      limitations: [
        'Depends on preliminary parametric cost rates and user-entered budget cap.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if option.budget <= 0 or if estimated construction cost is unavailable.',
    },

    // =========================================================================
    // CATEGORY F: ACCESSIBILITY, STRUCTURAL, ENVIRONMENTAL & REGULATORY
    // =========================================================================
    {
      id: 'constraint-graph-pass-rate',
      name: 'Living Constraint Graph Passing Rate',
      category: 'technical-environmental',
      plainLanguageMeaning:
        'Percentage of evaluable rules in the Plotify Living Constraint Graph that pass for this option.',
      formula: '(Passing Constraint Nodes / Total Evaluated Constraint Nodes) × 100',
      requiredSourceFields: ['option.rooms', 'option.floors', 'option.budget', 'project.plotWidth'],
      unit: '%',
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'higher-is-better',
      isHardConstraint: false,
      defaultWeight: 5,
      roundingStep: 1,
      toleranceNote: '1% rounding step.',
      assumptions: [
        'Evaluates the existing deterministic Living Constraint Graph (parcel containment, program completeness, multi-level rules, budget alignment).',
      ],
      limitations: [
        'Internal constraint graph pass rate is not a substitute for municipal building permit approval or licensed structural engineering sign-off.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if the option has no placed rooms.',
    },
    {
      id: 'upfront-embodied-carbon',
      name: 'Upfront Embodied Carbon Estimate (A1–A3)',
      category: 'technical-environmental',
      plainLanguageMeaning:
        'Estimated cradle-to-gate (A1–A3) upfront embodied carbon based on Gross Floor Area and primary facade/envelope material.',
      formula: '(Estimated GFA in m² × Material Carbon Factor kg CO₂e/m²) / 1000',
      requiredSourceFields: ['option.rooms', 'option.facade.primaryMaterial'],
      unit: 't CO₂e',
      defaultSelected: true,
      isAvailableInCodebase: true,
      preferenceDirection: 'lower-is-better',
      isHardConstraint: false,
      defaultWeight: 5,
      roundingStep: 0.1,
      toleranceNote: '0.1 t CO₂e rounding.',
      assumptions: [
        'Uses ICE / RICS benchmark factors by primaryMaterial (timber: 180, plaster: 290, stone: 330, brick: 390, concrete: 490, glass: 530 kg CO₂e/m²).',
        'Requires an explicit facade.primaryMaterial on the option; never silently guesses concrete when material is unspecified.',
      ],
      limitations: [
        'Early-stage envelope/material screening metric; does not replace a full Whole Life Carbon (WLC) LCA or P35 Climate-Responsive Material Advisor.',
      ],
      missingDataBehavior:
        'Marked "unavailable" if GFA is unavailable or option.facade.primaryMaterial is not specified.',
    },
    {
      id: 'universal-accessibility-audit',
      name: 'Universal Accessibility Review (P34)',
      category: 'technical-environmental',
      plainLanguageMeaning:
        'Comprehensive step-free routing, wheelchair turning circles, door clear widths, and sanitary accessibility audit.',
      formula: 'Not available — reserved for P34 Universal Accessibility Review',
      requiredSourceFields: ['accessibilityGraph', 'turningCircles', 'thresholdHeights'],
      unit: 'N/A',
      defaultSelected: false,
      isAvailableInCodebase: false,
      unavailableCodebaseReason:
        'Unimplemented in P31 by scope lock: comprehensive accessibility auditing belongs to P34 (Universal Accessibility Review). A missing accessibility analysis is never treated as a pass.',
      preferenceDirection: 'informational',
      isHardConstraint: false,
      defaultWeight: 0,
      roundingStep: 1,
      toleranceNote: 'N/A',
      assumptions: [],
      limitations: ['Not evaluated in P31.'],
      missingDataBehavior: 'Always marked "unavailable".',
    },
    {
      id: 'environmental-comfort-simulations',
      name: 'Climate, Acoustic, Ventilation & Daylight Analyzers (P35–P38)',
      category: 'technical-environmental',
      plainLanguageMeaning:
        'Specialized climate-responsive material advising (P35), acoustic isolation planning (P36), natural ventilation scenarios (P37), and daylight factor simulations (P38).',
      formula: 'Not available — reserved for P35, P36, P37, and P38',
      requiredSourceFields: ['fenestrationGeometry', 'acousticPartitions', 'windRose'],
      unit: 'N/A',
      defaultSelected: false,
      isAvailableInCodebase: false,
      unavailableCodebaseReason:
        'Unimplemented in P31 by scope lock: dedicated environmental comfort simulation engines belong to P35–P38.',
      preferenceDirection: 'informational',
      isHardConstraint: false,
      defaultWeight: 0,
      roundingStep: 1,
      toleranceNote: 'N/A',
      assumptions: [],
      limitations: ['Not evaluated in P31.'],
      missingDataBehavior: 'Always marked "unavailable".',
    },
  ];
}

/**
 * Helper to inspect valid vs invalid rooms in a design option.
 */
function analyzeOptionRooms(
  option: ComparableDesignOption,
  targetUnit: MeasurementUnit
): {
  validRooms: FloorPlanRoom[];
  invalidRooms: FloorPlanRoom[];
  netUsableAreaInTargetUnit: number;
  groundFootprintInTargetUnit: number;
  explicitHallwayAreaInTargetUnit: number;
  maxRoomFloorLevel: number;
  storeyMismatchRooms: FloorPlanRoom[];
  unitConverted: boolean;
} {
  const validRooms: FloorPlanRoom[] = [];
  const invalidRooms: FloorPlanRoom[] = [];
  const storeyMismatchRooms: FloorPlanRoom[] = [];

  for (const r of option.rooms || []) {
    if (
      !r ||
      typeof r.width !== 'number' ||
      typeof r.length !== 'number' ||
      !Number.isFinite(r.width) ||
      !Number.isFinite(r.length) ||
      r.width <= 0 ||
      r.length <= 0
    ) {
      invalidRooms.push(r);
      continue;
    }
    validRooms.push(r);
    if ((r.floorLevel || 1) > Math.max(1, option.floors)) {
      storeyMismatchRooms.push(r);
    }
  }

  const unitConverted = option.unit !== targetUnit;
  let netRaw = 0;
  let groundRaw = 0;
  let hallwayRaw = 0;
  let maxRoomFloorLevel = 1;

  for (const r of validRooms) {
    const area = r.width * r.length;
    netRaw += area;
    const fl = r.floorLevel || 1;
    if (fl > maxRoomFloorLevel) maxRoomFloorLevel = fl;
    if (fl === 1) {
      groundRaw += area;
    }
    if (
      r.type === 'hallway' ||
      /hallway|corridor|foyer|circulation/i.test(r.name || '')
    ) {
      hallwayRaw += area;
    }
  }

  const netUsableAreaInTargetUnit = convertMeasurementUnit(
    netRaw,
    option.unit,
    targetUnit,
    'area'
  );
  const groundFootprintInTargetUnit = convertMeasurementUnit(
    groundRaw,
    option.unit,
    targetUnit,
    'area'
  );
  const explicitHallwayAreaInTargetUnit = convertMeasurementUnit(
    hallwayRaw,
    option.unit,
    targetUnit,
    'area'
  );

  return {
    validRooms,
    invalidRooms,
    netUsableAreaInTargetUnit: roundToStep(netUsableAreaInTargetUnit, 0.1),
    groundFootprintInTargetUnit: roundToStep(groundFootprintInTargetUnit, 0.1),
    explicitHallwayAreaInTargetUnit: roundToStep(explicitHallwayAreaInTargetUnit, 0.1),
    maxRoomFloorLevel,
    storeyMismatchRooms,
    unitConverted,
  };
}

/**
 * Computes estimated Gross Floor Area (GFA) for an option using consistent rules:
 * - Never double-counts rooms that are already distributed across multiple floorLevels.
 * - Applies the brief's circulationWallAllowancePercent (default 15%).
 */
function computeOptionEstimatedGFA(
  netAreaInTargetUnit: number,
  validRooms: FloorPlanRoom[],
  floors: number,
  circulationWallAllowancePercent: number
): { gfa: number; multiFloorScaled: boolean; allowancePercent: number } {
  const safeAllowance =
    typeof circulationWallAllowancePercent === 'number' &&
    circulationWallAllowancePercent >= 0
      ? circulationWallAllowancePercent
      : 15;
  const hasExplicitUpperRooms = validRooms.some((r) => (r.floorLevel || 1) > 1);
  const effectiveFloors = Math.max(1, floors);
  const multiFloorScaled = effectiveFloors > 1 && !hasExplicitUpperRooms;
  const baseArea = multiFloorScaled
    ? netAreaInTargetUnit * effectiveFloors
    : netAreaInTargetUnit;
  const gfa = roundToStep(baseArea * (1 + safeAllowance / 100), 0.1);
  return { gfa, multiFloorScaled, allowancePercent: safeAllowance };
}

/**
 * Evaluates P30 Brief Requirements and Space Schedule constraints across all selected options.
 * Strictly separates confirmed user requirements from unconfirmed P30 AI assumptions.
 */
export function evaluateBriefConstraintsAcrossOptions(
  project: Project,
  selectedOptions: ComparableDesignOption[]
): {
  summary: P30BriefComparisonSummary;
  checks: BriefConstraintCheckItem[];
  confirmedFitPercentByOptionId: Record<
    string,
    {
      percent: number | null;
      satisfiedCount: number;
      evaluableConfirmedCount: number;
      explanation: string;
    }
  >;
} {
  const briefData = project.brief;
  const interpreted = briefData?.interpretedBrief;

  const hasBrief = Boolean(briefData && Array.isArray(briefData.spaces) && briefData.spaces.length > 0);
  const hasP30InterpretedBrief = Boolean(
    interpreted && Array.isArray(interpreted.requirements)
  );

  const p30Reqs = interpreted?.requirements || [];
  const confirmedReqs = p30Reqs.filter((r) => r.reviewStatus === 'confirmed');
  const unconfirmedReqs = p30Reqs.filter(
    (r) => r.reviewStatus === 'needs-review' || (r.source === 'inferred' && r.reviewStatus !== 'confirmed')
  );
  const pendingAssumptions = (interpreted?.assumptions || []).filter(
    (a) => a.status === 'pending'
  );
  const unresolvedBriefConflicts = (interpreted?.conflicts || []).filter(
    (c) => !c.resolved && c.disposition === 'confirmed-contradiction'
  );
  const openQuestions = (interpreted?.clarificationQuestions || []).filter(
    (q) => q.status === 'open'
  );

  const conflictedReqIds = new Set<string>();
  for (const c of unresolvedBriefConflicts) {
    for (const rid of c.affectedRequirementIds || []) {
      conflictedReqIds.add(rid);
    }
  }

  const briefNotes: string[] = [];
  if (!hasP30InterpretedBrief && hasBrief) {
    briefNotes.push(
      'No P30 natural-language interpretation is stored yet; evaluating against the Space Program Schedule in project.brief.spaces.'
    );
  }
  if (unconfirmedReqs.length > 0 || pendingAssumptions.length > 0) {
    briefNotes.push(
      `${unconfirmedReqs.length} unconfirmed P30 requirement(s) and ${pendingAssumptions.length} pending assumption(s) are displayed for awareness only and are NOT treated as binding constraints.`
    );
  }
  if (unresolvedBriefConflicts.length > 0) {
    briefNotes.push(
      `The P30 brief contains ${unresolvedBriefConflicts.length} unresolved confirmed contradiction(s). Conflicting requirements are flagged rather than silently choosing one.`
    );
  }

  const summary: P30BriefComparisonSummary = {
    hasBrief,
    hasP30InterpretedBrief,
    confirmedRequirementsCount: confirmedReqs.length,
    unconfirmedAssumptionsCount: unconfirmedReqs.length + pendingAssumptions.length,
    unresolvedBriefConflictsCount: unresolvedBriefConflicts.length,
    openClarificationQuestionsCount: openQuestions.length,
    briefConflictTitles: unresolvedBriefConflicts.map((c) => c.title),
    briefNotes,
  };

  const checks: BriefConstraintCheckItem[] = [];
  const statsByOptionId: Record<
    string,
    { satisfied: number; evaluableConfirmed: number }
  > = {};
  for (const opt of selectedOptions) {
    statsByOptionId[opt.optionId] = { satisfied: 0, evaluableConfirmed: 0 };
  }

  // 1. Evaluate P30 Interpreted Requirements (both confirmed and unconfirmed)
  for (const req of p30Reqs) {
    if (req.reviewStatus === 'rejected') continue;

    const isConfirmed = req.reviewStatus === 'confirmed';
    const isConflictedInBrief = conflictedReqIds.has(req.id);

    const outcomesByOptionId: Record<string, BriefConstraintOptionOutcome> = {};

    for (const opt of selectedOptions) {
      const roomAnalysis = analyzeOptionRooms(opt, project.unit);
      const validRooms = roomAnalysis.validRooms;

      // If this requirement is part of an unresolved contradiction in the P30 brief itself:
      if (isConflictedInBrief) {
        outcomesByOptionId[opt.optionId] = {
          optionId: opt.optionId,
          status: 'conflict',
          measuredDisplay: 'Brief Contradiction',
          explanation:
            'This requirement is part of an unresolved contradiction in the P30 brief. Resolve the contradiction in the P30 Brief Interpreter before treating it as satisfied.',
        };
        if (isConfirmed) {
          statsByOptionId[opt.optionId].evaluableConfirmed += 1;
        }
        continue;
      }

      // If unconfirmed AI inference / needs-review assumption:
      if (!isConfirmed) {
        outcomesByOptionId[opt.optionId] = {
          optionId: opt.optionId,
          status: 'assumption-only',
          measuredDisplay: 'Unconfirmed Assumption',
          explanation:
            'Unconfirmed P30 assumption (needs-review). Not enforced as a binding constraint until confirmed by the user.',
        };
        continue;
      }

      // Evaluate confirmed requirement by category
      if (req.category === 'floors-circulation' && typeof req.normalizedValue === 'number') {
        statsByOptionId[opt.optionId].evaluableConfirmed += 1;
        const reqFloors = Number(req.normalizedValue);
        const matches = opt.floors === reqFloors;
        if (matches) statsByOptionId[opt.optionId].satisfied += 1;
        outcomesByOptionId[opt.optionId] = {
          optionId: opt.optionId,
          status: matches ? 'meets' : 'conflict',
          measuredDisplay: `${opt.floors} floor(s)`,
          explanation: matches
            ? `Option has ${opt.floors} floor(s), matching confirmed requirement (${reqFloors}).`
            : `Option has ${opt.floors} floor(s), which conflicts with confirmed requirement (${reqFloors} floor(s)).`,
        };
      } else if (req.category === 'spaces-program') {
        statsByOptionId[opt.optionId].evaluableConfirmed += 1;
        const reqQty = req.quantity && req.quantity > 0 ? req.quantity : 1;
        const descLower = req.description.toLowerCase();

        const matchingRooms = validRooms.filter((r) => {
          const rName = (r.name || '').toLowerCase();
          const rType = (r.type || '').toLowerCase();
          if (descLower.includes('bedroom') && !descLower.includes('guest')) {
            return rType.includes('bed') || (rName.includes('bed') && !rName.includes('guest'));
          }
          if (descLower.includes('guest')) {
            return rName.includes('guest') || rType.includes('bed');
          }
          if (descLower.includes('kitchen')) {
            return rType.includes('kitchen') || rName.includes('kitchen');
          }
          if (descLower.includes('bath') || descLower.includes('restroom') || descLower.includes('wc')) {
            return rType.includes('bath') || rName.includes('bath') || rName.includes('wc');
          }
          if (descLower.includes('living') || descLower.includes('lounge')) {
            return rType.includes('living') || rName.includes('living') || rName.includes('lounge');
          }
          if (descLower.includes('dining')) {
            return rType.includes('dining') || rName.includes('dining');
          }
          if (descLower.includes('office') || descLower.includes('study')) {
            return rType.includes('office') || rName.includes('office') || rName.includes('study');
          }
          if (descLower.includes('parking') || descLower.includes('garage') || descLower.includes('car')) {
            return rType.includes('garage') || rName.includes('garage') || rName.includes('parking');
          }
          if (descLower.includes('balcony') || descLower.includes('terrace') || descLower.includes('garden') || descLower.includes('patio')) {
            return (
              rType.includes('balcony') ||
              rName.includes('balcony') ||
              rName.includes('terrace') ||
              rName.includes('patio')
            );
          }
          return rName.includes(descLower) || descLower.includes(rName);
        });

        const placedCount = matchingRooms.length;
        if (placedCount >= reqQty) {
          statsByOptionId[opt.optionId].satisfied += 1;
          outcomesByOptionId[opt.optionId] = {
            optionId: opt.optionId,
            status: 'meets',
            measuredDisplay: `${placedCount} / ${reqQty} placed`,
            explanation: `Placed ${placedCount} matching room(s) (${matchingRooms
              .map((m) => m.name)
              .join(', ')}) satisfying required quantity of ${reqQty}.`,
          };
        } else if (placedCount > 0) {
          outcomesByOptionId[opt.optionId] = {
            optionId: opt.optionId,
            status: 'partial',
            measuredDisplay: `${placedCount} / ${reqQty} placed`,
            explanation: `Only ${placedCount} of ${reqQty} required room instance(s) placed in 2D floor plan.`,
          };
        } else {
          outcomesByOptionId[opt.optionId] = {
            optionId: opt.optionId,
            status: 'conflict',
            measuredDisplay: `0 / ${reqQty} placed`,
            explanation: `No matching room placed in 2D floor plan for confirmed requirement "${req.description}".`,
          };
        }
      } else if (
        req.category === 'area-dimensions' &&
        typeof req.normalizedValue === 'number' &&
        req.unit
      ) {
        statsByOptionId[opt.optionId].evaluableConfirmed += 1;
        const reqUnit: MeasurementUnit =
          req.unit.includes('m') ? 'metres' : 'feet';
        const targetAreaInProjectUnit = convertMeasurementUnit(
          Number(req.normalizedValue),
          reqUnit,
          project.unit,
          'area'
        );
        const measuredArea = roomAnalysis.netUsableAreaInTargetUnit;
        if (validRooms.length === 0) {
          outcomesByOptionId[opt.optionId] = {
            optionId: opt.optionId,
            status: 'insufficient-data',
            measuredDisplay: 'Unavailable',
            explanation: 'Option has no valid placed rooms to measure floor area.',
          };
        } else {
          const ratio =
            targetAreaInProjectUnit > 0
              ? Math.abs(measuredArea - targetAreaInProjectUnit) / targetAreaInProjectUnit
              : 1;
          const meets = ratio <= 0.15;
          if (meets) statsByOptionId[opt.optionId].satisfied += 1;
          outcomesByOptionId[opt.optionId] = {
            optionId: opt.optionId,
            status: meets ? 'meets' : 'conflict',
            measuredDisplay: `${measuredArea.toFixed(1)} ${project.unit === 'feet' ? 'sq ft' : 'm²'}`,
            explanation: meets
              ? `Measured net area (${measuredArea.toFixed(1)}) aligns within 15% of target (${targetAreaInProjectUnit.toFixed(1)}).`
              : `Measured net area (${measuredArea.toFixed(1)}) deviates by ${(ratio * 100).toFixed(1)}% from target (${targetAreaInProjectUnit.toFixed(1)}).`,
          };
        }
      } else if (
        req.category === 'budget-cost' &&
        typeof req.normalizedValue === 'number' &&
        req.unit
      ) {
        statsByOptionId[opt.optionId].evaluableConfirmed += 1;
        if (req.unit !== opt.currency) {
          outcomesByOptionId[opt.optionId] = {
            optionId: opt.optionId,
            status: 'insufficient-data',
            measuredDisplay: `Currency mismatch (${opt.currency} vs ${req.unit})`,
            explanation: `Brief budget currency (${req.unit}) differs from option currency (${opt.currency}); cannot compare without an explicit exchange rate.`,
          };
        } else {
          const gfaInfo = computeOptionEstimatedGFA(
            roomAnalysis.netUsableAreaInTargetUnit,
            validRooms,
            opt.floors,
            briefData?.circulationWallAllowancePercent ?? 15
          );
          const costTier = opt.facade?.costTier;
          if (!costTier || validRooms.length === 0) {
            outcomesByOptionId[opt.optionId] = {
              optionId: opt.optionId,
              status: 'insufficient-data',
              measuredDisplay: 'Unavailable',
              explanation:
                'Estimated cost is unavailable because room geometry or facade cost tier is missing.',
            };
          } else {
            const estCost = calculateEstimatedCost(
              gfaInfo.gfa,
              opt.floors,
              project.unit,
              costTier
            );
            const cap = Number(req.normalizedValue);
            const meets = estCost <= cap;
            if (meets) statsByOptionId[opt.optionId].satisfied += 1;
            outcomesByOptionId[opt.optionId] = {
              optionId: opt.optionId,
              status: meets ? 'meets' : 'conflict',
              measuredDisplay: formatCurrency(estCost, opt.currency),
              explanation: meets
                ? `Estimated cost (${formatCurrency(estCost, opt.currency)}) is within confirmed brief cap (${formatCurrency(cap, opt.currency)}).`
                : `Estimated cost (${formatCurrency(estCost, opt.currency)}) exceeds confirmed brief cap (${formatCurrency(cap, opt.currency)}).`,
            };
          }
        }
      } else if (req.category === 'materials-sustainability') {
        statsByOptionId[opt.optionId].evaluableConfirmed += 1;
        const mat = opt.facade?.primaryMaterial?.toLowerCase();
        const reqVal = String(req.normalizedValue).toLowerCase();
        if (!mat) {
          outcomesByOptionId[opt.optionId] = {
            optionId: opt.optionId,
            status: 'insufficient-data',
            measuredDisplay: 'Material unspecified',
            explanation: 'Option does not specify a primary facade material.',
          };
        } else {
          const matches = reqVal.includes(mat) || mat.includes(reqVal);
          if (matches) statsByOptionId[opt.optionId].satisfied += 1;
          outcomesByOptionId[opt.optionId] = {
            optionId: opt.optionId,
            status: matches ? 'meets' : 'conflict',
            measuredDisplay: mat,
            explanation: matches
              ? `Option primary material (${mat}) matches brief preference (${reqVal}).`
              : `Option primary material (${mat}) differs from brief preference (${reqVal}).`,
          };
        }
      } else {
        // Qualitative or non-geometric requirement (e.g., project-identity, occupancy, privacy, daylight, regulatory)
        outcomesByOptionId[opt.optionId] = {
          optionId: opt.optionId,
          status: 'insufficient-data',
          measuredDisplay: 'Requires Manual / Specialist Review',
          explanation: `Requirement "${req.description}" (${req.category}) cannot be verified purely from 2D room rectangles and requires architect or specialist verification.`,
        };
      }
    }

    checks.push({
      requirementId: req.id,
      category: req.category,
      description: req.description,
      targetDisplay: `${req.normalizedValue}${req.unit ? ` ${req.unit}` : ''}`,
      priority: req.priority,
      source: req.source,
      reviewStatus: req.reviewStatus,
      isBindingConstraint: isConfirmed && !isConflictedInBrief,
      outcomesByOptionId,
    });
  }

  // 2. If no P30 interpretedBrief exists, populate checks from mandatory Space Program Schedule items
  if (p30Reqs.length === 0 && briefData && Array.isArray(briefData.spaces)) {
    for (const sp of briefData.spaces) {
      const isMandatory = sp.priority === 'mandatory';
      const outcomesByOptionId: Record<string, BriefConstraintOptionOutcome> = {};

      for (const opt of selectedOptions) {
        const mockProj: Project = {
          ...project,
          floors: opt.floors,
          budget: opt.budget,
          floorPlan: { rooms: opt.rooms },
        };
        const comps = compareBriefWithFloorPlan(mockProj, briefData);
        const match = comps.find((c) => c.spaceRequirementId === sp.id);
        const placed = match?.placedQuantity || 0;

        if (isMandatory) {
          statsByOptionId[opt.optionId].evaluableConfirmed += 1;
          if (placed >= sp.quantity) {
            statsByOptionId[opt.optionId].satisfied += 1;
          }
        }

        outcomesByOptionId[opt.optionId] = {
          optionId: opt.optionId,
          status:
            placed >= sp.quantity
              ? 'meets'
              : placed > 0
              ? 'partial'
              : isMandatory
              ? 'conflict'
              : 'insufficient-data',
          measuredDisplay: `${placed} / ${sp.quantity} placed (${match?.actualPlacedTotalArea || 0} ${
            project.unit === 'feet' ? 'sq ft' : 'm²'
          })`,
          explanation:
            placed >= sp.quantity
              ? `All ${sp.quantity} programmed instance(s) of "${sp.name}" are placed on the floor plan.`
              : `Missing ${sp.quantity - placed} programmed instance(s) of "${sp.name}".`,
        };
      }

      checks.push({
        requirementId: sp.id,
        category: `space-schedule:${sp.category}`,
        description: `${sp.name} (${sp.quantity} × ${sp.targetArea} ${
          project.unit === 'feet' ? 'sq ft' : 'm²'
        })`,
        targetDisplay: `${sp.quantity} space(s)`,
        priority: sp.priority,
        source: 'space-schedule',
        reviewStatus: 'confirmed',
        isBindingConstraint: isMandatory,
        outcomesByOptionId,
      });
    }
  }

  const confirmedFitPercentByOptionId: Record<
    string,
    {
      percent: number | null;
      satisfiedCount: number;
      evaluableConfirmedCount: number;
      explanation: string;
    }
  > = {};

  for (const opt of selectedOptions) {
    const st = statsByOptionId[opt.optionId];
    if (!st || st.evaluableConfirmed === 0) {
      confirmedFitPercentByOptionId[opt.optionId] = {
        percent: null,
        satisfiedCount: 0,
        evaluableConfirmedCount: 0,
        explanation:
          'No evaluable confirmed brief requirements exist to compute a percentage fit.',
      };
    } else {
      const pct = roundToStep((st.satisfied / st.evaluableConfirmed) * 100, 1);
      confirmedFitPercentByOptionId[opt.optionId] = {
        percent: pct,
        satisfiedCount: st.satisfied,
        evaluableConfirmedCount: st.evaluableConfirmed,
        explanation: `Satisfies ${st.satisfied} of ${st.evaluableConfirmed} evaluable confirmed brief requirement(s) (${pct}%). Unconfirmed AI assumptions are excluded.`,
      };
    }
  }

  return {
    summary,
    checks,
    confirmedFitPercentByOptionId,
  };
}

/**
 * Evaluates a single criterion for a single design option with full provenance and uncertainty tracking.
 */
function evaluateCriterionForOption(
  criterion: ComparisonCriterionDefinition,
  option: ComparableDesignOption,
  project: Project,
  briefEval: ReturnType<typeof evaluateBriefConstraintsAcrossOptions>
): OptionCriterionValue {
  const canonicalUnit = project.unit || 'feet';
  const areaUnitLabel = canonicalUnit === 'metres' ? 'm²' : 'sq ft';
  const linearUnitLabel = canonicalUnit === 'metres' ? 'm' : 'ft';

  // 0. If criterion is not available in the codebase (e.g., P33, P34, P35–P38)
  if (!criterion.isAvailableInCodebase) {
    return {
      optionId: option.optionId,
      criterionId: criterion.id,
      rawValue: null,
      formattedValue: 'Unavailable (Future Roadmap)',
      unit: criterion.unit,
      provenance: 'unavailable',
      status: 'unavailable',
      explanation:
        criterion.unavailableCodebaseReason ||
        'This analysis capability is not implemented in P31.',
      sourceReferences: [],
      assumptionsUsed: [],
      uncertaintyNotes: [
        criterion.unavailableCodebaseReason ||
          'Not assessed; missing analysis is never treated as a pass.',
      ],
      unavailableReason:
        criterion.unavailableCodebaseReason || 'Unimplemented analysis capability.',
    };
  }

  const roomAnalysis = analyzeOptionRooms(option, canonicalUnit);
  const {
    validRooms,
    invalidRooms,
    netUsableAreaInTargetUnit,
    groundFootprintInTargetUnit,
    storeyMismatchRooms,
    unitConverted,
  } = roomAnalysis;

  const briefData = project.brief || initializeProjectBrief(project);
  const circAllowance = briefData.circulationWallAllowancePercent ?? 15;
  const gfaResult = computeOptionEstimatedGFA(
    netUsableAreaInTargetUnit,
    validRooms,
    option.floors,
    circAllowance
  );

  const uncertaintyNotes: string[] = [];
  if (invalidRooms.length > 0) {
    uncertaintyNotes.push(
      `${invalidRooms.length} room(s) have invalid/non-positive dimensions and were excluded from area totals.`
    );
  }
  if (storeyMismatchRooms.length > 0) {
    uncertaintyNotes.push(
      `${storeyMismatchRooms.length} room(s) are assigned to a floorLevel greater than option.floors (${option.floors}).`
    );
  }
  if (unitConverted) {
    uncertaintyNotes.push(
      `Converted option measurements from ${option.unit} to project canonical unit (${canonicalUnit}).`
    );
  }
  if (option.sharesBaselineGeometry) {
    uncertaintyNotes.push(
      'This Design Studio Alternative shares 2D room geometry with the baseline project.'
    );
  }

  switch (criterion.id) {
    // 1. Confirmed P30 Brief Requirements Met
    case 'confirmed-brief-fit': {
      const fit = briefEval.confirmedFitPercentByOptionId[option.optionId];
      if (!fit || fit.percent === null) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: '%',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            fit?.explanation ||
            'No evaluable confirmed P30 brief requirements exist.',
          sourceReferences: ['project.brief.interpretedBrief.requirements'],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason:
            'No evaluable confirmed brief requirements found on project.',
        };
      }
      const status: CriterionEvaluationStatus =
        fit.percent === 100
          ? 'meets'
          : fit.percent >= 75
          ? 'warning'
          : 'conflict';
      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: fit.percent,
        formattedValue: `${fit.percent}% (${fit.satisfiedCount}/${fit.evaluableConfirmedCount})`,
        unit: '%',
        provenance: 'calculated',
        status,
        explanation: fit.explanation,
        sourceReferences: [
          'project.brief.interpretedBrief.requirements',
          `option:${option.optionId}.rooms`,
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 2. Mandatory Programmed Spaces Placed
    case 'mandatory-space-placement': {
      const mandatorySpaces = (briefData.spaces || []).filter(
        (s) => s.priority === 'mandatory'
      );
      if (mandatorySpaces.length === 0 || validRooms.length === 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: '%',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            validRooms.length === 0
              ? 'Option has no valid placed rooms on the 2D floor plan.'
              : 'Project brief contains no mandatory programmed spaces.',
          sourceReferences: ['project.brief.spaces', `option:${option.optionId}.rooms`],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason:
            validRooms.length === 0
              ? 'No valid placed rooms in option.'
              : 'No mandatory spaces defined in brief.',
        };
      }

      const optionProjectView: Project = {
        ...project,
        floors: option.floors,
        budget: option.budget,
        floorPlan: { rooms: validRooms },
      };
      const comparisons = compareBriefWithFloorPlan(optionProjectView, briefData);
      const mandatoryComps = comparisons.filter((c) => c.priority === 'mandatory');
      const requiredTotal = mandatoryComps.reduce(
        (sum, c) => sum + c.requiredQuantity,
        0
      );
      const placedTotal = mandatoryComps.reduce(
        (sum, c) => sum + Math.min(c.placedQuantity, c.requiredQuantity),
        0
      );

      if (requiredTotal <= 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: '%',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation: 'Required mandatory space count is zero.',
          sourceReferences: ['project.brief.spaces'],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'Zero required mandatory spaces.',
        };
      }

      const pct = roundToStep((placedTotal / requiredTotal) * 100, 1);
      const status: CriterionEvaluationStatus =
        pct === 100 ? 'meets' : pct >= 70 ? 'warning' : 'conflict';

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: pct,
        formattedValue: `${pct}% (${placedTotal}/${requiredTotal} spaces)`,
        unit: '%',
        provenance: 'calculated',
        status,
        explanation: `Placed ${placedTotal} of ${requiredTotal} mandatory programmed space instance(s) on the 2D plan.`,
        sourceReferences: ['project.brief.spaces', `option:${option.optionId}.rooms`],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 3. Net Area vs. Programmed Target Area
    case 'program-net-area-delta': {
      const summary = calculateSpaceProgramSummary(project, briefData);
      if (validRooms.length === 0 || summary.totalTargetNetArea <= 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: areaUnitLabel,
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            validRooms.length === 0
              ? 'Option has no valid placed rooms.'
              : 'Space program target net area is not defined.',
          sourceReferences: ['project.brief.spaces', `option:${option.optionId}.rooms`],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'Missing valid placed rooms or target net area.',
        };
      }

      const delta = roundToStep(
        netUsableAreaInTargetUnit - summary.totalTargetNetArea,
        0.1
      );
      const pctVariance = roundToStep(
        (delta / summary.totalTargetNetArea) * 100,
        1
      );
      const sign = delta > 0 ? '+' : '';
      const absPct = Math.abs(pctVariance);
      const status: CriterionEvaluationStatus =
        absPct <= 10 ? 'meets' : absPct <= 25 ? 'warning' : 'conflict';

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: delta,
        formattedValue: `${sign}${delta.toFixed(1)} ${areaUnitLabel} (${sign}${pctVariance}%)`,
        unit: areaUnitLabel,
        provenance: 'calculated',
        status,
        explanation: `Option net area (${netUsableAreaInTargetUnit.toFixed(
          1
        )} ${areaUnitLabel}) minus programmed target (${summary.totalTargetNetArea.toFixed(
          1
        )} ${areaUnitLabel}) = ${sign}${delta.toFixed(1)} ${areaUnitLabel}.`,
        sourceReferences: ['project.brief.spaces', `option:${option.optionId}.rooms`],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 4. Net Usable Interior Room Area
    case 'net-usable-room-area': {
      if (validRooms.length === 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable (No Valid Rooms)',
          unit: areaUnitLabel,
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            'No valid rooms with positive width and length exist on this option; missing room geometry is reported as unavailable rather than 0.',
          sourceReferences: [`option:${option.optionId}.rooms`],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'No valid rooms with positive dimensions.',
        };
      }

      const status: CriterionEvaluationStatus =
        invalidRooms.length > 0 ? 'warning' : 'neutral';

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: netUsableAreaInTargetUnit,
        formattedValue: `${netUsableAreaInTargetUnit.toFixed(1)} ${areaUnitLabel}`,
        unit: areaUnitLabel,
        provenance: 'measured',
        status,
        explanation: `Measured across ${validRooms.length} valid room(s) (${
          invalidRooms.length > 0
            ? `${invalidRooms.length} invalid room(s) excluded`
            : 'all rooms valid'
        }). Excludes partition wall thickness.`,
        sourceReferences: [`option:${option.optionId}.rooms`],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 5. Estimated Gross Floor Area (GFA)
    case 'estimated-gross-floor-area': {
      if (validRooms.length === 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: areaUnitLabel,
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            'Cannot calculate Gross Floor Area without valid placed rooms.',
          sourceReferences: [`option:${option.optionId}.rooms`],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'No valid placed rooms.',
        };
      }

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: gfaResult.gfa,
        formattedValue: `${gfaResult.gfa.toFixed(1)} ${areaUnitLabel}`,
        unit: areaUnitLabel,
        provenance: 'calculated',
        status: 'neutral',
        explanation: `Calculated from ${netUsableAreaInTargetUnit.toFixed(
          1
        )} ${areaUnitLabel} net area + ${
          gfaResult.allowancePercent
        }% circulation/wall allowance${
          gfaResult.multiFloorScaled
            ? ` (scaled across ${option.floors} floors because no upper-level rooms were explicitly tagged)`
            : ' (summed directly across explicitly tagged floor levels without double-counting)'
        }.`,
        sourceReferences: [
          `option:${option.optionId}.rooms`,
          `option:${option.optionId}.floors`,
          'project.brief.circulationWallAllowancePercent',
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 6. Ground-Floor Plot Coverage Ratio
    case 'plot-ground-coverage': {
      const plotW = convertMeasurementUnit(
        option.plotWidth,
        option.unit,
        canonicalUnit,
        'linear'
      );
      const plotL = convertMeasurementUnit(
        option.plotLength,
        option.unit,
        canonicalUnit,
        'linear'
      );
      const plotArea = plotW * plotL;

      if (plotW <= 0 || plotL <= 0 || validRooms.length === 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: '%',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            plotW <= 0 || plotL <= 0
              ? 'Plot boundary dimensions (plotWidth × plotLength) are missing or non-positive.'
              : 'No valid placed rooms to compute ground-floor footprint.',
          sourceReferences: [
            `option:${option.optionId}.plotWidth`,
            `option:${option.optionId}.plotLength`,
            `option:${option.optionId}.rooms`,
          ],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason:
            plotW <= 0 || plotL <= 0
              ? 'Missing or non-positive plot dimensions.'
              : 'No valid placed rooms.',
        };
      }

      const ratio = roundToStep((groundFootprintInTargetUnit / plotArea) * 100, 0.1);
      const status: CriterionEvaluationStatus =
        ratio > 80 ? 'conflict' : ratio > 60 ? 'warning' : 'meets';

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: ratio,
        formattedValue: `${ratio.toFixed(1)}% (${groundFootprintInTargetUnit.toFixed(
          1
        )} / ${plotArea.toFixed(0)} ${areaUnitLabel})`,
        unit: '%',
        provenance: 'calculated',
        status,
        explanation: `Ground-level room footprint (${groundFootprintInTargetUnit.toFixed(
          1
        )} ${areaUnitLabel}) covers ${ratio.toFixed(1)}% of total plot area (${plotArea.toFixed(
          0
        )} ${areaUnitLabel}).`,
        sourceReferences: [
          `option:${option.optionId}.rooms`,
          `option:${option.optionId}.plotWidth`,
          `option:${option.optionId}.plotLength`,
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 7. Building Storeys & Placed Room Count
    case 'building-storey-count': {
      if (typeof option.floors !== 'number' || option.floors <= 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: 'storeys',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation: 'Building storey count is missing or non-positive.',
          sourceReferences: [`option:${option.optionId}.floors`],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'Invalid or missing floor count.',
        };
      }

      const status: CriterionEvaluationStatus =
        storeyMismatchRooms.length > 0 ? 'warning' : 'neutral';

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: option.floors,
        formattedValue: `${option.floors} ${
          option.floors === 1 ? 'Storey' : 'Storeys'
        } · ${validRooms.length} ${validRooms.length === 1 ? 'Room' : 'Rooms'}`,
        unit: 'storeys',
        provenance: 'user-entered',
        status,
        explanation: `${option.floors} configured building storey(s) and ${
          validRooms.length
        } valid placed room(s) across levels 1–${roomAnalysis.maxRoomFloorLevel}.`,
        sourceReferences: [
          `option:${option.optionId}.floors`,
          `option:${option.optionId}.rooms`,
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 8. Buildable Setback Envelope Utilization
    case 'buildable-envelope-efficiency': {
      const setbacks = project.siteContext?.setbacks;
      const plotW = convertMeasurementUnit(
        option.plotWidth,
        option.unit,
        canonicalUnit,
        'linear'
      );
      const plotL = convertMeasurementUnit(
        option.plotLength,
        option.unit,
        canonicalUnit,
        'linear'
      );

      if (!setbacks || plotW <= 0 || plotL <= 0 || validRooms.length === 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: '%',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation: !setbacks
            ? 'Site setback dimensions (project.siteContext.setbacks) are not configured on this project.'
            : plotW <= 0 || plotL <= 0
            ? 'Plot boundary dimensions are missing or non-positive.'
            : 'No valid placed rooms to measure ground footprint.',
          sourceReferences: [
            'project.siteContext.setbacks',
            `option:${option.optionId}.rooms`,
          ],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: !setbacks
            ? 'Site setbacks not configured.'
            : 'Missing plot dimensions or valid rooms.',
        };
      }

      const buildableW = Math.max(
        0,
        plotW - (setbacks.sideLeft + setbacks.sideRight)
      );
      const buildableL = Math.max(0, plotL - (setbacks.front + setbacks.rear));
      const envelopeArea = buildableW * buildableL;

      if (envelopeArea <= 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable (Zero Envelope)',
          unit: '%',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            'Configured setbacks leave zero positive buildable envelope area.',
          sourceReferences: ['project.siteContext.setbacks'],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'Non-positive buildable setback envelope.',
        };
      }

      const utilPct = roundToStep(
        (groundFootprintInTargetUnit / envelopeArea) * 100,
        0.1
      );
      const status: CriterionEvaluationStatus =
        utilPct > 100 ? 'conflict' : utilPct > 90 ? 'warning' : 'meets';

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: utilPct,
        formattedValue: `${utilPct.toFixed(1)}% (${groundFootprintInTargetUnit.toFixed(
          1
        )} / ${envelopeArea.toFixed(1)} ${areaUnitLabel})`,
        unit: '%',
        provenance: 'calculated',
        status,
        explanation: `Ground footprint (${groundFootprintInTargetUnit.toFixed(
          1
        )} ${areaUnitLabel}) uses ${utilPct.toFixed(
          1
        )}% of the legal setback envelope (${buildableW.toFixed(
          1
        )} × ${buildableL.toFixed(1)} ${linearUnitLabel} = ${envelopeArea.toFixed(
          1
        )} ${areaUnitLabel}).`,
        sourceReferences: [
          'project.siteContext.setbacks',
          `option:${option.optionId}.rooms`,
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 9. Net-to-Gross Floor Area Ratio
    case 'net-to-gross-area-ratio': {
      if (validRooms.length === 0 || gfaResult.gfa <= 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: '%',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            'Net or Gross Floor Area is unavailable because no valid rooms are placed.',
          sourceReferences: [`option:${option.optionId}.rooms`],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'No valid placed rooms.',
        };
      }

      const effectiveNet = gfaResult.multiFloorScaled
        ? netUsableAreaInTargetUnit * Math.max(1, option.floors)
        : netUsableAreaInTargetUnit;
      const netGrossPct = roundToStep((effectiveNet / gfaResult.gfa) * 100, 0.1);

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: netGrossPct,
        formattedValue: `${netGrossPct.toFixed(1)}%`,
        unit: '%',
        provenance: 'calculated',
        status: 'neutral',
        explanation: `Net room area (${effectiveNet.toFixed(
          1
        )} ${areaUnitLabel}) divided by estimated GFA (${gfaResult.gfa.toFixed(
          1
        )} ${areaUnitLabel}) = ${netGrossPct.toFixed(
          1
        )}% (reflecting the ${circAllowance}% circulation/wall factor).`,
        sourceReferences: [
          `option:${option.optionId}.rooms`,
          'project.brief.circulationWallAllowancePercent',
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 10. 2D Geometry, Boundary & Adjacency Conflicts
    case 'geometry-boundary-conflicts': {
      if (
        validRooms.length === 0 ||
        option.plotWidth <= 0 ||
        option.plotLength <= 0
      ) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: 'conflicts',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            validRooms.length === 0
              ? 'No valid placed rooms to check for geometry collisions.'
              : 'Plot boundary dimensions are missing or non-positive.',
          sourceReferences: [`option:${option.optionId}.rooms`],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'Missing valid rooms or plot dimensions.',
        };
      }

      // Check overlaps per floorLevel (validateFloorPlan checks across rooms on same floorLevel)
      const floorLevels = Array.from(
        new Set(validRooms.map((r) => r.floorLevel || 1))
      );
      let overlapCount = 0;
      let boundaryCount = 0;

      for (const fl of floorLevels) {
        const roomsOnFloor = validRooms.filter((r) => (r.floorLevel || 1) === fl);
        const val = validateFloorPlan(
          { version: 1, floorNumber: fl, rooms: roomsOnFloor as any, walls: [], openings: [], updatedAt: '' },
          option.plotWidth,
          option.plotLength,
          option.unit
        );
        overlapCount += val.overlapViolations.length;
        if (fl === floorLevels[0]) {
          // Count boundary violations across all valid rooms
        }
      }
      const allBoundaryVal = validateFloorPlan(
        { version: 1, floorNumber: 1, rooms: validRooms as any, walls: [], openings: [], updatedAt: '' },
        option.plotWidth,
        option.plotLength,
        option.unit
      );
      boundaryCount = allBoundaryVal.boundaryViolations.length;

      // Also check brief spatial relationship adjacency conflicts
      const optionProjectView: Project = {
        ...project,
        floors: option.floors,
        budget: option.budget,
        floorPlan: { rooms: validRooms },
      };
      const briefNotices = validateBrief(optionProjectView, briefData);
      const adjacencyConflicts = briefNotices.filter(
        (n) => n.type === 'adjacency-conflict'
      ).length;

      const totalConflicts =
        overlapCount +
        boundaryCount +
        adjacencyConflicts +
        invalidRooms.length +
        storeyMismatchRooms.length;

      const status: CriterionEvaluationStatus =
        totalConflicts === 0 ? 'meets' : 'conflict';

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: totalConflicts,
        formattedValue:
          totalConflicts === 0
            ? '0 conflicts'
            : `${totalConflicts} conflict${totalConflicts === 1 ? '' : 's'}`,
        unit: 'conflicts',
        provenance: 'measured',
        status,
        explanation:
          totalConflicts === 0
            ? 'Zero room overlaps, zero plot boundary overflows, and zero brief adjacency conflicts.'
            : `Detected ${boundaryCount} boundary overflow(s), ${overlapCount} same-floor room overlap(s), ${adjacencyConflicts} adjacency conflict(s), ${invalidRooms.length} invalid-dimension room(s), and ${storeyMismatchRooms.length} storey-mismatch room(s).`,
        sourceReferences: [
          `option:${option.optionId}.rooms`,
          `option:${option.optionId}.plotWidth`,
          `option:${option.optionId}.plotLength`,
          'project.brief.relationships',
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 11. Parametric Estimated Construction Cost
    case 'estimated-construction-cost': {
      const costTier = option.facade?.costTier;
      if (validRooms.length === 0 || gfaResult.gfa <= 0 || !costTier) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: option.currency || project.currency,
          provenance: 'unavailable',
          status: 'unavailable',
          explanation: !costTier
            ? 'Facade specification cost tier (option.facade.costTier) is not defined on this option; P31 never fabricates a default cost tier when missing.'
            : 'Gross Floor Area is unavailable because no valid rooms are placed.',
          sourceReferences: [
            `option:${option.optionId}.rooms`,
            `option:${option.optionId}.facade.costTier`,
          ],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: !costTier
            ? 'Missing facade costTier.'
            : 'Missing valid room geometry.',
        };
      }

      const estCost = calculateEstimatedCost(
        gfaResult.gfa,
        option.floors,
        canonicalUnit,
        costTier
      );

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: estCost,
        formattedValue: formatCurrency(estCost, option.currency),
        unit: option.currency,
        provenance: 'estimated',
        status:
          option.budget > 0 && estCost > option.budget ? 'warning' : 'neutral',
        explanation: `Parametric estimate for ${gfaResult.gfa.toFixed(
          1
        )} ${areaUnitLabel} GFA at "${costTier}" specification across ${
          option.floors
        } storey(s) in ${option.currency}.`,
        sourceReferences: [
          `option:${option.optionId}.rooms`,
          `option:${option.optionId}.floors`,
          `option:${option.optionId}.facade.costTier`,
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes: [
          ...uncertaintyNotes,
          'Order-of-magnitude parametric estimate; not a binding contractor tender.',
        ],
      };
    }

    // 12. Declared Budget Surplus / (Deficit)
    case 'budget-surplus-deficit': {
      const costTier = option.facade?.costTier;
      if (
        typeof option.budget !== 'number' ||
        option.budget <= 0 ||
        validRooms.length === 0 ||
        gfaResult.gfa <= 0 ||
        !costTier
      ) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: option.currency || project.currency,
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            option.budget <= 0
              ? 'Declared target budget is not specified (<= 0); missing budget is never substituted with zero.'
              : 'Parametric construction cost is unavailable (missing room geometry or facade cost tier).',
          sourceReferences: [
            `option:${option.optionId}.budget`,
            `option:${option.optionId}.facade.costTier`,
          ],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason:
            option.budget <= 0
              ? 'Target budget not specified.'
              : 'Estimated construction cost unavailable.',
        };
      }

      const estCost = calculateEstimatedCost(
        gfaResult.gfa,
        option.floors,
        canonicalUnit,
        costTier
      );
      const variance = roundToStep(option.budget - estCost, 1);
      const sign = variance >= 0 ? '+' : '';
      const status: CriterionEvaluationStatus =
        variance >= 0 ? 'meets' : 'conflict';

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: variance,
        formattedValue: `${sign}${formatCurrency(variance, option.currency)}`,
        unit: option.currency,
        provenance: 'calculated',
        status,
        explanation:
          variance >= 0
            ? `Declared budget (${formatCurrency(
                option.budget,
                option.currency
              )}) has a surplus of +${formatCurrency(
                variance,
                option.currency
              )} over estimated cost (${formatCurrency(estCost, option.currency)}).`
            : `Estimated cost (${formatCurrency(
                estCost,
                option.currency
              )}) exceeds declared budget (${formatCurrency(
                option.budget,
                option.currency
              )}) by ${formatCurrency(Math.abs(variance), option.currency)}.`,
        sourceReferences: [
          `option:${option.optionId}.budget`,
          `option:${option.optionId}.facade.costTier`,
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes,
      };
    }

    // 13. Living Constraint Graph Passing Rate
    case 'constraint-graph-pass-rate': {
      if (validRooms.length === 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: '%',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation:
            'Constraint graph evaluation requires placed rooms in the 2D floor plan.',
          sourceReferences: [`option:${option.optionId}.rooms`],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'No valid placed rooms.',
        };
      }

      const optionProjectView: Project = {
        ...project,
        floors: option.floors,
        budget: option.budget,
        floorPlan: { rooms: validRooms },
      };
      const graph = evaluateConstraintGraph(optionProjectView);
      const evaluableTotal =
        graph.summary.passing + graph.summary.conflicts + graph.summary.pending;
      if (evaluableTotal <= 0) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: '%',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation: 'No evaluable constraint graph nodes.',
          sourceReferences: ['constraintGraphService'],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: 'Zero evaluable constraint nodes.',
        };
      }

      const passPct = roundToStep(
        (graph.summary.passing / evaluableTotal) * 100,
        1
      );
      const status: CriterionEvaluationStatus =
        graph.summary.conflicts > 0
          ? 'conflict'
          : graph.summary.pending > 0
          ? 'warning'
          : 'meets';

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: passPct,
        formattedValue: `${passPct}% (${graph.summary.passing}/${evaluableTotal} pass, ${graph.summary.conflicts} conflict)`,
        unit: '%',
        provenance: 'calculated',
        status,
        explanation: `${graph.summary.passing} passing, ${graph.summary.conflicts} conflicting, and ${graph.summary.pending} pending constraint node(s).`,
        sourceReferences: ['constraintGraphService', `option:${option.optionId}.rooms`],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes: [
          ...uncertaintyNotes,
          'Internal constraint pass rate does not certify statutory code compliance.',
        ],
      };
    }

    // 14. Upfront Embodied Carbon Estimate (A1–A3)
    case 'upfront-embodied-carbon': {
      const primaryMat = option.facade?.primaryMaterial;
      if (validRooms.length === 0 || gfaResult.gfa <= 0 || !primaryMat) {
        return {
          optionId: option.optionId,
          criterionId: criterion.id,
          rawValue: null,
          formattedValue: 'Unavailable',
          unit: 't CO₂e',
          provenance: 'unavailable',
          status: 'unavailable',
          explanation: !primaryMat
            ? 'Primary structural/facade material (option.facade.primaryMaterial) is not specified; P31 does not silently guess a material.'
            : 'Gross Floor Area is unavailable because no valid rooms are placed.',
          sourceReferences: [
            `option:${option.optionId}.facade.primaryMaterial`,
            `option:${option.optionId}.rooms`,
          ],
          assumptionsUsed: criterion.assumptions,
          uncertaintyNotes,
          unavailableReason: !primaryMat
            ? 'Primary material not specified.'
            : 'No valid placed rooms.',
        };
      }

      const carbon = calculateEmbodiedCarbon(
        gfaResult.gfa,
        canonicalUnit,
        primaryMat
      );

      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: carbon.totalTonnes,
        formattedValue: `${carbon.totalTonnes.toFixed(1)} t CO₂e (${
          carbon.intensityKgPerM2
        } kg/m² · ${primaryMat})`,
        unit: 't CO₂e',
        provenance: 'estimated',
        status: 'neutral',
        explanation: `Estimated A1–A3 upfront embodied carbon for ${gfaResult.gfa.toFixed(
          1
        )} ${areaUnitLabel} GFA with primary material "${primaryMat}" (${
          carbon.intensityKgPerM2
        } kg CO₂e/m²).`,
        sourceReferences: [
          `option:${option.optionId}.facade.primaryMaterial`,
          `option:${option.optionId}.rooms`,
        ],
        assumptionsUsed: criterion.assumptions,
        uncertaintyNotes: [
          ...uncertaintyNotes,
          'Early-stage screening factor; not a full ISO 14040 / EN 15978 LCA.',
        ],
      };
    }

    default:
      return {
        optionId: option.optionId,
        criterionId: criterion.id,
        rawValue: null,
        formattedValue: 'Unavailable',
        unit: criterion.unit,
        provenance: 'unavailable',
        status: 'unavailable',
        explanation: `Criterion "${criterion.id}" is not supported.`,
        sourceReferences: [],
        assumptionsUsed: [],
        uncertaintyNotes: [],
        unavailableReason: 'Unsupported criterion ID.',
      };
  }
}

/**
 * Normalizes a numeric criterion value onto a 0–100 scale across the compared options
 * using a documented, deterministic formula.
 */
function computeNormalizedCriterionScore(
  criterion: ComparisonCriterionDefinition,
  rawValue: number | null,
  allNumericValues: number[]
): { score: number | null; explanation: string } {
  if (rawValue === null || !Number.isFinite(rawValue)) {
    return {
      score: null,
      explanation:
        'Value is unavailable; contributes 0 weighted points while retaining criterion weight in denominator so missing data cannot inflate the score.',
    };
  }

  // Absolute-scale criteria (percentages or conflict counts)
  if (
    criterion.id === 'confirmed-brief-fit' ||
    criterion.id === 'mandatory-space-placement' ||
    criterion.id === 'constraint-graph-pass-rate'
  ) {
    const clamped = Math.max(0, Math.min(100, Math.round(rawValue)));
    return {
      score: clamped,
      explanation: `Direct percentage score (${clamped}/100).`,
    };
  }

  if (criterion.id === 'geometry-boundary-conflicts') {
    const score = Math.max(0, 100 - Math.round(rawValue * 25));
    return {
      score,
      explanation: `Starts at 100 for 0 conflicts, minus 25 pts per conflict (${rawValue} conflict(s) → ${score}/100).`,
    };
  }

  if (criterion.id === 'program-net-area-delta') {
    // Closer to 0 delta is better
    const maxAbs = Math.max(...allNumericValues.map((v) => Math.abs(v)), 1);
    const score = Math.round(
      Math.max(0, Math.min(100, 100 * (1 - Math.abs(rawValue) / (maxAbs * 1.25))))
    );
    return {
      score,
      explanation: `Target-alignment score based on proximity to 0 area variance (${score}/100).`,
    };
  }

  if (criterion.id === 'buildable-envelope-efficiency') {
    // Ideal utilization is <= 100% (penalize exceeding 100% envelope)
    if (rawValue > 100) {
      const over = rawValue - 100;
      const score = Math.max(0, Math.round(60 - over * 2));
      return {
        score,
        explanation: `Exceeds buildable setback envelope (${rawValue.toFixed(1)}% > 100%) → penalized to ${score}/100.`,
      };
    }
    const score = Math.round(Math.max(40, Math.min(100, rawValue)));
    return {
      score,
      explanation: `Within buildable setback envelope (${rawValue.toFixed(1)}%) → ${score}/100.`,
    };
  }

  // Relative min-max across compared options for continuous metrics (area, cost, budget surplus, carbon, coverage)
  const minVal = Math.min(...allNumericValues);
  const maxVal = Math.max(...allNumericValues);

  if (Math.abs(maxVal - minVal) < 1e-6) {
    return {
      score: 85,
      explanation:
        'All compared options have an identical measurement for this criterion (85/100 tie baseline).',
    };
  }

  if (criterion.preferenceDirection === 'higher-is-better') {
    const norm = 40 + ((rawValue - minVal) / (maxVal - minVal)) * 60;
    const score = Math.round(Math.max(0, Math.min(100, norm)));
    return {
      score,
      explanation: `Min-max normalized across compared options [min ${minVal.toFixed(
        1
      )} → 40, max ${maxVal.toFixed(1)} → 100] = ${score}/100.`,
    };
  }

  if (criterion.preferenceDirection === 'lower-is-better') {
    const norm = 40 + ((maxVal - rawValue) / (maxVal - minVal)) * 60;
    const score = Math.round(Math.max(0, Math.min(100, norm)));
    return {
      score,
      explanation: `Inverse min-max normalized across compared options [lowest ${minVal.toFixed(
        1
      )} → 100, highest ${maxVal.toFixed(1)} → 40] = ${score}/100.`,
    };
  }

  return {
    score: 75,
    explanation: 'Informational criterion.',
  };
}

/**
 * Core pure, non-mutating P31 Multi-Option Design Comparison engine.
 */
export function compareDesignOptions(
  project: Project,
  config?: {
    selectedOptionIds?: string[];
    selectedCriterionIds?: string[];
    scoringEnabled?: boolean;
    customWeights?: Record<string, number>;
    candidateOptions?: ComparableDesignOption[];
    requestSequenceId?: number;
  }
): MultiOptionComparisonResult {
  const catalog = getComparisonCriteriaCatalog(project);
  const availableOptions =
    config?.candidateOptions || extractComparableOptions(project);

  // Default to first 2-3 available options if none specified
  const requestedOptionIds =
    config?.selectedOptionIds && config.selectedOptionIds.length > 0
      ? config.selectedOptionIds
      : availableOptions.slice(0, Math.min(3, availableOptions.length)).map((o) => o.optionId);

  const optionDiagnostics = validateSelectedOptionIds(
    availableOptions,
    requestedOptionIds
  );
  const selectedOptions = optionDiagnostics.validSelectedOptions;

  // Default to criteria marked defaultSelected
  const requestedCriterionIds =
    config?.selectedCriterionIds && config.selectedCriterionIds.length > 0
      ? config.selectedCriterionIds
      : catalog.filter((c) => c.defaultSelected).map((c) => c.id);

  const selectedCriteria = catalog.filter((c) =>
    requestedCriterionIds.includes(c.id)
  );

  // Evaluate P30 brief & space schedule constraints
  const briefEval = evaluateBriefConstraintsAcrossOptions(
    project,
    selectedOptions
  );

  // Build weights map
  const weights: Record<string, number> = {};
  for (const c of catalog) {
    const customW = config?.customWeights?.[c.id];
    weights[c.id] =
      typeof customW === 'number' && Number.isFinite(customW) && customW >= 0
        ? Math.min(100, Math.round(customW))
        : c.defaultWeight;
  }

  // Evaluate each selected criterion across all selected options
  const criteriaComparisons: CriterionCrossOptionComparison[] = [];

  for (const criterion of selectedCriteria) {
    const valuesByOptionId: Record<string, OptionCriterionValue> = {};
    const numericValues: number[] = [];
    const unitsSeen = new Set<string>();

    for (const opt of selectedOptions) {
      const val = evaluateCriterionForOption(
        criterion,
        opt,
        project,
        briefEval
      );
      valuesByOptionId[opt.optionId] = val;
      if (typeof val.rawValue === 'number' && Number.isFinite(val.rawValue)) {
        numericValues.push(val.rawValue);
        if (val.unit) unitsSeen.add(val.unit);
      }
    }

    // Check if currency/units differ across options for this criterion
    let isComparableAcrossSelected =
      criterion.isAvailableInCodebase &&
      selectedOptions.length >= 2 &&
      numericValues.length >= 2;
    let incomparabilityReason: string | undefined;

    if (!criterion.isAvailableInCodebase) {
      isComparableAcrossSelected = false;
      incomparabilityReason = criterion.unavailableCodebaseReason;
    } else if (unitsSeen.size > 1) {
      isComparableAcrossSelected = false;
      incomparabilityReason = `Options use incompatible units or currencies (${Array.from(
        unitsSeen
      ).join(' vs ')}) that cannot be directly compared without normalization.`;
      // Mark values as not directly comparable
      for (const opt of selectedOptions) {
        const existing = valuesByOptionId[opt.optionId];
        if (existing) {
          existing.uncertaintyNotes.push(incomparabilityReason);
        }
      }
    } else if (numericValues.length < 2) {
      isComparableAcrossSelected = false;
      incomparabilityReason =
        'Insufficient options with available numeric data to compare this criterion side by side.';
    }

    const minNumericValue =
      isComparableAcrossSelected && numericValues.length > 0
        ? Math.min(...numericValues)
        : null;
    const maxNumericValue =
      isComparableAcrossSelected && numericValues.length > 0
        ? Math.max(...numericValues)
        : null;
    const rangeSpread =
      minNumericValue !== null && maxNumericValue !== null
        ? roundToStep(maxNumericValue - minNumericValue, criterion.roundingStep)
        : null;

    let rangeSpreadFormatted = 'N/A';
    let meaningfulDifferenceSummary = '';

    if (!isComparableAcrossSelected) {
      meaningfulDifferenceSummary =
        incomparabilityReason || 'Criterion cannot be fairly compared across the selected options.';
    } else if (rangeSpread !== null) {
      if (Math.abs(rangeSpread) < 1e-5) {
        rangeSpreadFormatted = `0 ${criterion.unit} (Identical)`;
        meaningfulDifferenceSummary = `No difference across selected options (all measure ${valuesByOptionId[selectedOptions[0].optionId]?.formattedValue}).`;
      } else {
        rangeSpreadFormatted =
          criterion.unit === project.currency
            ? formatCurrency(rangeSpread, project.currency)
            : `${rangeSpread} ${criterion.unit}`;
        // Identify highest and lowest option names
        const sortedOpts = [...selectedOptions]
          .filter((o) => typeof valuesByOptionId[o.optionId]?.rawValue === 'number')
          .sort(
            (a, b) =>
              (valuesByOptionId[b.optionId].rawValue as number) -
              (valuesByOptionId[a.optionId].rawValue as number)
          );
        const highestOpt = sortedOpts[0];
        const lowestOpt = sortedOpts[sortedOpts.length - 1];
        meaningfulDifferenceSummary = `Spans ${rangeSpreadFormatted} between "${highestOpt.name}" (${
          valuesByOptionId[highestOpt.optionId].formattedValue
        }) and "${lowestOpt.name}" (${
          valuesByOptionId[lowestOpt.optionId].formattedValue
        }).`;
      }
    }

    criteriaComparisons.push({
      criterion,
      valuesByOptionId,
      isComparableAcrossSelected,
      incomparabilityReason,
      minNumericValue,
      maxNumericValue,
      rangeSpread,
      rangeSpreadFormatted,
      meaningfulDifferenceSummary,
    });
  }

  // =========================================================================
  // FAIR, EXPLAINABLE WEIGHTED PREFERENCE SCORING & HARD-CONSTRAINT TRACKING
  // =========================================================================
  const scoringEnabled = config?.scoringEnabled ?? true;
  const activeWeightedComparisons = criteriaComparisons.filter(
    (cc) =>
      cc.criterion.isAvailableInCodebase &&
      cc.criterion.preferenceDirection !== 'informational' &&
      (weights[cc.criterion.id] || 0) > 0 &&
      // If currencies are incompatible across options, do not include in aggregate score
      !(cc.incomparabilityReason && cc.incomparabilityReason.includes('incompatible'))
  );

  const totalActiveWeight = activeWeightedComparisons.reduce(
    (sum, cc) => sum + (weights[cc.criterion.id] || 0),
    0
  );

  const optionScores: WeightedOptionScoreSummary[] = selectedOptions.map(
    (opt) => {
      let hardConstraintsMetCount = 0;
      let hardConstraintsConflictCount = 0;
      let hardConstraintsUnassessedCount = 0;

      const strengths: string[] = [];
      const tradeOffs: string[] = [];
      const missingOrUncertainItems: string[] = [];

      // Check hard constraints across all selected criteria
      for (const cc of criteriaComparisons) {
        const val = cc.valuesByOptionId[opt.optionId];
        if (!val) continue;

        if (val.status === 'unavailable') {
          missingOrUncertainItems.push(
            `${cc.criterion.name}: ${val.unavailableReason || 'Data unavailable'}`
          );
        }

        if (cc.criterion.isHardConstraint) {
          if (val.status === 'meets') {
            hardConstraintsMetCount += 1;
          } else if (val.status === 'conflict') {
            hardConstraintsConflictCount += 1;
            tradeOffs.push(
              `Hard constraint conflict on "${cc.criterion.name}": ${val.formattedValue} (${val.explanation})`
            );
          } else {
            hardConstraintsUnassessedCount += 1;
          }
        }
      }

      const contributions: CriterionScoreContribution[] = [];
      let availableWeightedCriteriaCount = 0;

      for (const cc of activeWeightedComparisons) {
        const w = weights[cc.criterion.id] || 0;
        const val = cc.valuesByOptionId[opt.optionId];
        const rawNum =
          typeof val?.rawValue === 'number' && Number.isFinite(val.rawValue)
            ? val.rawValue
            : null;

        const allNums = selectedOptions
          .map((o) => cc.valuesByOptionId[o.optionId]?.rawValue)
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

        const norm = computeNormalizedCriterionScore(
          cc.criterion,
          rawNum,
          allNums
        );

        const isMissing = norm.score === null;
        if (!isMissing) {
          availableWeightedCriteriaCount += 1;
        }

        // CRITICAL FAIRNESS RULE: Missing data contributes 0 points while keeping
        // the full weight `w` in `totalActiveWeight`, so missing data NEVER inflates an option's score.
        const weightedPoints =
          !isMissing && totalActiveWeight > 0 && norm.score !== null
            ? roundToStep((norm.score * w) / totalActiveWeight, 0.1)
            : 0;

        if (!isMissing && norm.score !== null) {
          if (norm.score >= 85 && cc.rangeSpread && cc.rangeSpread > 0) {
            strengths.push(
              `${cc.criterion.name}: ${val.formattedValue}`
            );
          } else if (norm.score <= 50 && cc.rangeSpread && cc.rangeSpread > 0) {
            tradeOffs.push(
              `${cc.criterion.name}: ${val.formattedValue} (lower relative performance)`
            );
          }
        }

        contributions.push({
          criterionId: cc.criterion.id,
          criterionName: cc.criterion.name,
          rawValue: rawNum,
          normalizedScore: norm.score,
          weight: w,
          weightedPoints,
          isMissingData: isMissing,
          explanation: norm.explanation,
        });
      }

      const totalWeightedCriteriaCount = activeWeightedComparisons.length;
      const dataCoveragePercent =
        totalWeightedCriteriaCount > 0
          ? roundToStep(
              (availableWeightedCriteriaCount / totalWeightedCriteriaCount) * 100,
              1
            )
          : 0;

      const aggregatePreferenceScore =
        scoringEnabled &&
        totalActiveWeight > 0 &&
        availableWeightedCriteriaCount > 0
          ? Math.round(
              contributions.reduce((sum, item) => sum + item.weightedPoints, 0)
            )
          : null;

      const meetsAllAssessedHardConstraints =
        hardConstraintsConflictCount === 0 && hardConstraintsMetCount > 0;

      return {
        optionId: opt.optionId,
        optionName: opt.name,
        aggregatePreferenceScore,
        hardConstraintsMetCount,
        hardConstraintsConflictCount,
        hardConstraintsUnassessedCount,
        meetsAllAssessedHardConstraints,
        availableWeightedCriteriaCount,
        totalWeightedCriteriaCount,
        dataCoveragePercent,
        contributions,
        strengths,
        tradeOffs,
        missingOrUncertainItems,
      };
    }
  );

  // Sensitivity & Tie Analysis
  const validScoredOptions = optionScores.filter(
    (s) => s.aggregatePreferenceScore !== null
  );
  const sortedByScore = [...validScoredOptions].sort(
    (a, b) =>
      (b.aggregatePreferenceScore || 0) - (a.aggregatePreferenceScore || 0)
  );

  let isRankingTie = false;
  let isRankingSensitiveToWeights = false;
  let rankingStabilityExplanation = '';

  if (!scoringEnabled || sortedByScore.length < 2) {
    rankingStabilityExplanation =
      'Aggregate preference scoring is disabled or fewer than two options have comparable data; inspect the criteria-level measurements directly.';
  } else {
    const top = sortedByScore[0];
    const second = sortedByScore[1];
    const scoreGap =
      (top.aggregatePreferenceScore || 0) -
      (second.aggregatePreferenceScore || 0);

    if (scoreGap === 0) {
      isRankingTie = true;
      isRankingSensitiveToWeights = true;
      rankingStabilityExplanation = `Tie detected: "${top.optionName}" and "${second.optionName}" have an identical aggregate preference score (${top.aggregatePreferenceScore}/100). Any weight adjustment on differentiating criteria will change the order.`;
    } else if (scoreGap <= 4) {
      isRankingSensitiveToWeights = true;
      rankingStabilityExplanation = `Ranking is sensitive to weight assumptions: "${top.optionName}" leads "${second.optionName}" by only ${scoreGap} point(s) (${top.aggregatePreferenceScore} vs ${second.aggregatePreferenceScore}). Shifting criterion weights by ±15–20% can reverse the ranking.`;
    } else {
      rankingStabilityExplanation = `"${top.optionName}" leads "${second.optionName}" by ${scoreGap} points (${top.aggregatePreferenceScore} vs ${second.aggregatePreferenceScore}) under the current weights. Hard-constraint conflicts and missing data must still be reviewed independently.`;
    }
  }

  // Decision Support Narrative (never claims an option is "best", "compliant", or "safe")
  let decisionSupportNarrative = '';
  if (selectedOptions.length < 2) {
    decisionSupportNarrative =
      'Select at least two distinct design options to generate a side-by-side comparison.';
  } else if (sortedByScore.length >= 2) {
    const leader = sortedByScore[0];
    const hardConflictWarning =
      leader.hardConstraintsConflictCount > 0
        ? ` Note: "${leader.optionName}" has ${leader.hardConstraintsConflictCount} hard-constraint conflict(s) that must be resolved regardless of its preference score.`
        : '';
    const coverageNote =
      leader.dataCoveragePercent < 100
        ? ` Data coverage is ${leader.dataCoveragePercent}% (${
            leader.totalWeightedCriteriaCount -
            leader.availableWeightedCriteriaCount
          } weighted criterion/criteria unavailable).`
        : '';
    decisionSupportNarrative = `Decision Support Summary: Under the selected weights, "${leader.optionName}" has the highest weighted preference index (${leader.aggregatePreferenceScore}/100), driven by ${
      leader.strengths.slice(0, 2).join('; ') || 'balanced performance'
    }.${hardConflictWarning}${coverageNote} Review individual trade-offs and unassessed criteria before making an architectural decision.`;
  } else {
    decisionSupportNarrative =
      'Review the side-by-side measurements, brief constraint checks, and data availability notes across the selected options.';
  }

  const globalWarnings: string[] = [
    ...optionDiagnostics.validationErrors,
    ...optionDiagnostics.validationWarnings,
    ...briefEval.summary.briefNotes,
  ];

  return {
    comparisonId: `cmp-p31-${project.id}-${Date.now()}`,
    calculationVersion: P31_COMPARISON_CALCULATION_VERSION,
    projectId: project.id,
    projectName: project.name,
    computedAt: new Date().toISOString(),
    requestSequenceId: config?.requestSequenceId ?? 1,
    optionDiagnostics,
    selectedOptions,
    selectedCriterionIds: selectedCriteria.map((c) => c.id),
    criteriaComparisons,
    briefConstraintChecks: briefEval.checks,
    p30BriefSummary: briefEval.summary,
    scoringEnabled,
    weights,
    optionScores,
    isRankingTie,
    isRankingSensitiveToWeights,
    rankingStabilityExplanation,
    decisionSupportNarrative,
    globalWarnings,
    complianceDisclaimer: P31_COMPLIANCE_DISCLAIMER,
  };
}

/**
 * Stale-response guard so an older comparison calculation never overwrites a newer request.
 */
export function shouldApplyComparisonResult(
  currentResult: MultiOptionComparisonResult | null | undefined,
  incomingResult: MultiOptionComparisonResult
): boolean {
  if (!currentResult) return true;
  return incomingResult.requestSequenceId >= currentResult.requestSequenceId;
}

/**
 * Creates a saved comparison configuration on a clone of the Project without mutating
 * any design options, 2D floor plans, scenarios, alternatives, or P30 brief data.
 */
export function saveComparisonConfigToProject(
  project: Project,
  config: {
    selectedOptionIds: string[];
    selectedCriterionIds: string[];
    scoringEnabled: boolean;
    customWeights: Record<string, number>;
    notes?: string;
  }
): Project {
  const now = new Date().toISOString();
  const savedConfig: SavedDesignComparisonConfig = {
    id: project.designComparison?.id || `saved-cmp-${project.id}`,
    calculationVersion: P31_COMPARISON_CALCULATION_VERSION,
    updatedAt: now,
    selectedOptionIds: [...config.selectedOptionIds],
    selectedCriterionIds: [...config.selectedCriterionIds],
    scoringEnabled: config.scoringEnabled,
    customWeights: { ...config.customWeights },
    notes: config.notes,
  };

  return {
    ...project,
    designComparison: savedConfig,
    updatedAt: now,
  };
}
