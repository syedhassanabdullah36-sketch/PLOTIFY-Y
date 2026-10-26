import {
  FacadeConcept,
  FloorPlanRoom,
  InteriorRoomConcept,
  Project,
} from '../types/project';
import {
  BudgetPreferenceRange,
  P32_PERSONALIZATION_ENGINE_VERSION,
  PersonalizationConflictItem,
  PersonalizationEvaluationResult,
  PersonalizationPreferenceItem,
  PersonalizationPreviewDiff,
  PersonalizedOptionRecommendation,
  PreferenceCriterionMatchDetail,
  ProjectPersonalizationProfile,
  RoomCategoryPrioritySetting,
  SpatialPriorityKey,
} from '../types/designPersonalization';
import {
  P31_COMPARISON_CALCULATION_VERSION,
  ComparableDesignOption,
} from '../types/designComparison';
import {
  compareDesignOptions,
  extractComparableOptions,
  roundToStep,
} from './designComparisonService';
import { initializeProjectBrief } from './briefService';
import { initializeProjectSiteContext } from './siteIntelligenceService';
import { validateFloorPlan } from '../utils/geometry';
import { evaluateConstraintGraph } from './constraintGraphService';
import {
  createProjectSnapshot,
  executeSafeRestore,
} from './versioningService';
import { ProjectSnapshot } from '../types/versioning';
import { formatCurrency } from '../utils/formatters';

export { P32_PERSONALIZATION_ENGINE_VERSION };

export const P32_COMPLIANCE_AND_PRIVACY_DISCLAIMER =
  'Adaptive Design Personalization (P32) matches explicitly stated project preferences and confirmed P30 brief requirements against real project options using deterministic rules. It does not infer sensitive personal attributes, build hidden behavioral profiles, silently modify saved designs, or certify structural, accessibility, environmental, or regulatory code compliance.';

export const SUPPORTED_FACADE_STYLES: Array<FacadeConcept['style']> = [
  'Modern',
  'Contemporary',
  'Minimalist',
  'Traditional',
  'Industrial',
  'Mediterranean',
];

export const SUPPORTED_PRIMARY_MATERIALS: Array<FacadeConcept['primaryMaterial']> = [
  'timber',
  'brick',
  'stone',
  'plaster',
  'concrete',
  'glass',
];

export const SUPPORTED_COST_TIERS: Array<FacadeConcept['costTier']> = [
  'Economic',
  'Balanced Mid-Range',
  'High-End Architectural',
  'Ultra Luxury',
];

export const SUPPORTED_INTERIOR_STYLES: Array<InteriorRoomConcept['style']> = [
  'Scandinavian',
  'Minimalist',
  'Modern Luxury',
  'Japandi',
  'Industrial Chic',
  'Warm Contemporary',
];

export const SUPPORTED_SHADING_STYLES: Array<FacadeConcept['shadingStyle']> = [
  'deep-overhangs',
  'motorized-louvers',
  'timber-pergola',
  'brise-soleil',
  'none',
];

export const SPATIAL_PRIORITY_DEFINITIONS: Array<{
  key: SpatialPriorityKey;
  label: string;
  description: string;
  defaultWeight: number;
}> = [
  {
    key: 'opennessAndLivingArea',
    label: 'Openness & Generous Living Space',
    description:
      'Prioritizes larger net usable living/dining area and higher living-to-total floor area proportion.',
    defaultWeight: 50,
  },
  {
    key: 'privacyAndZoneSeparation',
    label: 'Acoustic & Visual Zone Privacy',
    description:
      'Prioritizes multi-room separation between private sleeping/work spaces and public living areas.',
    defaultWeight: 50,
  },
  {
    key: 'storageAndUtilityCapacity',
    label: 'Dedicated Storage & Service Utility',
    description:
      'Prioritizes explicit storage, laundry, garage, or utility room provision in the layout.',
    defaultWeight: 40,
  },
  {
    key: 'budgetPredictability',
    label: 'Budget Predictability & Cost Control',
    description:
      'Prioritizes options whose parametric construction cost remains comfortably within the declared target budget.',
    defaultWeight: 60,
  },
  {
    key: 'lowCarbonMaterials',
    label: 'Low Embodied Carbon & Biogenic Materials',
    description:
      'Prioritizes lower A1–A3 upfront embodied carbon and timber/mineral envelope specifications.',
    defaultWeight: 45,
  },
  {
    key: 'compactPlotFootprint',
    label: 'Compact Ground Footprint & Garden Preservation',
    description:
      'Prioritizes lower ground-floor plot coverage ratio to preserve open yard and permeable site area.',
    defaultWeight: 40,
  },
  {
    key: 'naturalLightAndShading',
    label: 'Passive Solar Shading & Daylight Glazing',
    description:
      'Prioritizes passive solar shading devices (deep overhangs, louvers, brise-soleil) appropriate to road/solar orientation.',
    defaultWeight: 45,
  },
];

/**
 * Computes a deterministic source fingerprint over the project's options, floorPlan,
 * P30 brief state, and P32 preference profile so stale recommendations are reliably detected.
 */
export function computePersonalizationSourceFingerprint(
  project: Project,
  profile?: Partial<ProjectPersonalizationProfile>
): string {
  const roomsSig = (project.floorPlan?.rooms || [])
    .map((r) => `${r.id}:${r.width}x${r.length}@${r.floorLevel}`)
    .join(',');
  const scenSig = (project.scenarios || [])
    .map((s) => `${s.id}:${s.floors}:${s.budget}:${s.rooms?.length || 0}`)
    .join(',');
  const altSig = (project.designAlternatives || [])
    .map(
      (a) =>
        `${a.id}:${a.facade?.style}:${a.facade?.primaryMaterial}:${a.facade?.costTier}`
    )
    .join(',');
  const briefReqsSig = (project.brief?.interpretedBrief?.requirements || [])
    .map((r) => `${r.id}:${r.reviewStatus}:${r.priority}:${r.normalizedValue}`)
    .join(',');
  const prefSig = profile
    ? JSON.stringify({
        styles: profile.preferredFacadeStyles,
        mats: profile.preferredPrimaryMaterials,
        tiers: profile.preferredCostTiers,
        interiors: profile.preferredInteriorStyles,
        shading: profile.preferredShadingStyles,
        floors: profile.preferredFloors,
        weights: profile.spatialPriorityWeights,
        budget: profile.budgetRange,
        items: (profile.items || []).map(
          (i) => `${i.id}:${i.confirmationStatus}:${i.weight}:${JSON.stringify(i.value)}`
        ),
      })
    : 'no-profile';

  const raw = `${project.id}|${project.floors}|${project.budget}|${project.unit}|${project.currency}|${roomsSig}|${scenSig}|${altSig}|${briefReqsSig}|${prefSig}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 33) ^ raw.charCodeAt(i);
  }
  return `p32-fp-${(hash >>> 0).toString(16)}`;
}

/**
 * Initializes or normalizes a project-scoped ProjectPersonalizationProfile.
 * Strictly separates:
 * - 'explicit-user' (confirmed by user in P32)
 * - 'imported-project-fact' (imported from saved project or confirmed P30 brief)
 * - 'inferred-suggestion' (proposed from unconfirmed P30 inferences or site orientation; kept 'unconfirmed-suggestion')
 * - 'unknown' (missing data)
 */
export function initializePersonalizationProfile(
  project: Project
): ProjectPersonalizationProfile {
  const now = new Date().toISOString();
  const existing = project.designPersonalization;

  const briefData = initializeProjectBrief(project);
  const interpretedBrief = project.brief?.interpretedBrief || briefData.interpretedBrief;
  const siteContext = initializeProjectSiteContext(project);

  const activeAlt =
    project.designAlternatives?.find((a) => a.id === project.activeAlternativeId) ||
    project.designAlternatives?.[0];

  // Default spatial priority weights
  const defaultSpatialWeights: Record<SpatialPriorityKey, number> = {
    opennessAndLivingArea: 50,
    privacyAndZoneSeparation: 50,
    storageAndUtilityCapacity: 40,
    budgetPredictability: 60,
    lowCarbonMaterials: 45,
    compactPlotFootprint: 40,
    naturalLightAndShading: 45,
  };

  const spatialPriorityWeights: Record<SpatialPriorityKey, number> = {
    ...defaultSpatialWeights,
    ...(existing?.spatialPriorityWeights || {}),
  };
  // Clamp weights to [0, 100]
  for (const k of Object.keys(spatialPriorityWeights) as SpatialPriorityKey[]) {
    const val = spatialPriorityWeights[k];
    spatialPriorityWeights[k] =
      typeof val === 'number' && Number.isFinite(val)
        ? Math.max(0, Math.min(100, Math.round(val)))
        : defaultSpatialWeights[k];
  }

  // Room category priorities derived from project.rooms and brief.spaces
  const defaultRoomCategories: RoomCategoryPrioritySetting[] = [
    {
      category: 'living',
      label: 'Living & Social Spaces',
      importanceWeight: 85,
      minRequiredCount: Math.max(1, project.rooms?.livingRoom || 1),
      origin: 'imported-project-fact',
      confirmationStatus: 'confirmed',
    },
    {
      category: 'sleeping',
      label: 'Bedrooms & Private Suites',
      importanceWeight: 90,
      minRequiredCount: Math.max(0, project.rooms?.bedrooms || 0),
      origin: 'imported-project-fact',
      confirmationStatus: 'confirmed',
    },
    {
      category: 'hygiene',
      label: 'Bathrooms & Sanitary Spaces',
      importanceWeight: 90,
      minRequiredCount: Math.max(0, project.rooms?.bathrooms || 0),
      origin: 'imported-project-fact',
      confirmationStatus: 'confirmed',
    },
    {
      category: 'service',
      label: 'Kitchen, Laundry, Garage & Storage',
      importanceWeight: 75,
      minRequiredCount:
        (project.rooms?.kitchen || 0) +
        (project.rooms?.laundry || 0) +
        (project.rooms?.storage || 0) +
        (project.rooms?.garage || 0),
      origin: 'imported-project-fact',
      confirmationStatus: 'confirmed',
    },
    {
      category: 'work',
      label: 'Home Office / Study Workspace',
      importanceWeight: (project.rooms?.homeOffice || 0) > 0 ? 75 : 30,
      minRequiredCount: project.rooms?.homeOffice || 0,
      origin:
        (project.rooms?.homeOffice || 0) > 0 ? 'imported-project-fact' : 'unknown',
      confirmationStatus:
        (project.rooms?.homeOffice || 0) > 0 ? 'confirmed' : 'unknown',
    },
    {
      category: 'outdoor',
      label: 'Balcony / Terrace / Outdoor Connection',
      importanceWeight: (project.rooms?.balcony || 0) > 0 ? 65 : 30,
      minRequiredCount: project.rooms?.balcony || 0,
      origin:
        (project.rooms?.balcony || 0) > 0 ? 'imported-project-fact' : 'unknown',
      confirmationStatus:
        (project.rooms?.balcony || 0) > 0 ? 'confirmed' : 'unknown',
    },
  ];

  const roomCategoryPriorities =
    existing?.roomCategoryPriorities && Array.isArray(existing.roomCategoryPriorities) && existing.roomCategoryPriorities.length > 0
      ? existing.roomCategoryPriorities
      : defaultRoomCategories;

  // Budget preference range
  const hasKnownBudget = typeof project.budget === 'number' && project.budget > 0;
  const defaultBudgetRange: BudgetPreferenceRange = {
    minBudget: hasKnownBudget ? Math.round(project.budget * 0.8) : null,
    targetBudget: hasKnownBudget ? project.budget : null,
    maxBudget: hasKnownBudget ? project.budget : null,
    currency: project.currency || 'USD',
    isHardCap: hasKnownBudget,
    origin: hasKnownBudget ? 'imported-project-fact' : 'unknown',
    confirmationStatus: hasKnownBudget ? 'confirmed' : 'unknown',
  };

  const budgetRange: BudgetPreferenceRange = existing?.budgetRange
    ? {
        ...defaultBudgetRange,
        ...existing.budgetRange,
        currency: project.currency || existing.budgetRange.currency || 'USD',
      }
    : defaultBudgetRange;

  // Build canonical preference items list while preserving any explicit user items or confirmations
  const existingItemMap = new Map<string, PersonalizationPreferenceItem>();
  if (Array.isArray(existing?.items)) {
    for (const item of existing.items) {
      if (item && item.id) {
        existingItemMap.set(item.id, item);
      }
    }
  }

  const preferredFacadeStyles = Array.isArray(existing?.preferredFacadeStyles)
    ? existing.preferredFacadeStyles.filter((s) => SUPPORTED_FACADE_STYLES.includes(s))
    : activeAlt?.facade?.style
    ? [activeAlt.facade.style]
    : [];

  const preferredPrimaryMaterials = Array.isArray(existing?.preferredPrimaryMaterials)
    ? existing.preferredPrimaryMaterials.filter((m) =>
        SUPPORTED_PRIMARY_MATERIALS.includes(m)
      )
    : activeAlt?.facade?.primaryMaterial
    ? [activeAlt.facade.primaryMaterial]
    : [];

  const preferredCostTiers = Array.isArray(existing?.preferredCostTiers)
    ? existing.preferredCostTiers.filter((t) => SUPPORTED_COST_TIERS.includes(t))
    : activeAlt?.facade?.costTier
    ? [activeAlt.facade.costTier]
    : [];

  const preferredInteriorStyles = Array.isArray(existing?.preferredInteriorStyles)
    ? existing.preferredInteriorStyles.filter((s) =>
        SUPPORTED_INTERIOR_STYLES.includes(s)
      )
    : [];

  const preferredShadingStyles = Array.isArray(existing?.preferredShadingStyles)
    ? existing.preferredShadingStyles.filter((s) =>
        SUPPORTED_SHADING_STYLES.includes(s)
      )
    : activeAlt?.facade?.shadingStyle && activeAlt.facade.shadingStyle !== 'none'
    ? [activeAlt.facade.shadingStyle]
    : [];

  const preferredFloors =
    existing?.preferredFloors !== undefined
      ? existing.preferredFloors
      : project.floors > 0
      ? project.floors
      : null;

  const items: PersonalizationPreferenceItem[] = [];

  // 1. Architectural Style Item
  const styleItemId = 'pref-facade-style';
  const prevStyleItem = existingItemMap.get(styleItemId);
  items.push({
    id: styleItemId,
    dimension: 'architectural-style',
    key: 'preferredFacadeStyles',
    label: 'Preferred Architectural Facade Style',
    value: preferredFacadeStyles.length > 0 ? preferredFacadeStyles : null,
    weight: prevStyleItem?.weight ?? 65,
    origin:
      prevStyleItem?.origin === 'explicit-user'
        ? 'explicit-user'
        : preferredFacadeStyles.length > 0
        ? 'imported-project-fact'
        : 'unknown',
    confirmationStatus:
      prevStyleItem?.confirmationStatus ||
      (preferredFacadeStyles.length > 0 ? 'confirmed' : 'unknown'),
    isHardConstraint: false,
    sourceReference:
      prevStyleItem?.origin === 'explicit-user'
        ? 'User preference selection (P32)'
        : activeAlt
        ? `project.designAlternatives[${activeAlt.id}].facade.style`
        : 'Not specified',
    rationale:
      preferredFacadeStyles.length > 0
        ? `Matches options with ${preferredFacadeStyles.join(' or ')} architectural character.`
        : 'No facade style preference selected yet.',
    updatedAt: prevStyleItem?.updatedAt || now,
  });

  // 2. Primary Envelope Material Item
  const matItemId = 'pref-primary-material';
  const prevMatItem = existingItemMap.get(matItemId);
  items.push({
    id: matItemId,
    dimension: 'primary-material',
    key: 'preferredPrimaryMaterials',
    label: 'Preferred Envelope & Structural Material',
    value: preferredPrimaryMaterials.length > 0 ? preferredPrimaryMaterials : null,
    weight: prevMatItem?.weight ?? 60,
    origin:
      prevMatItem?.origin === 'explicit-user'
        ? 'explicit-user'
        : preferredPrimaryMaterials.length > 0
        ? 'imported-project-fact'
        : 'unknown',
    confirmationStatus:
      prevMatItem?.confirmationStatus ||
      (preferredPrimaryMaterials.length > 0 ? 'confirmed' : 'unknown'),
    isHardConstraint: false,
    sourceReference:
      prevMatItem?.origin === 'explicit-user'
        ? 'User preference selection (P32)'
        : activeAlt
        ? `project.designAlternatives[${activeAlt.id}].facade.primaryMaterial`
        : 'Not specified',
    rationale:
      preferredPrimaryMaterials.length > 0
        ? `Matches options using ${preferredPrimaryMaterials.join(', ')} primary envelope material.`
        : 'No envelope material preference selected yet.',
    updatedAt: prevMatItem?.updatedAt || now,
  });

  // 3. Cost Tier & Budget Target Item
  const budgetItemId = 'pref-budget-cap';
  const prevBudgetItem = existingItemMap.get(budgetItemId);
  items.push({
    id: budgetItemId,
    dimension: 'budget-range',
    key: 'budgetRange',
    label: 'Target Construction Budget & Cost Cap',
    value: budgetRange.maxBudget,
    unit: budgetRange.currency,
    weight: prevBudgetItem?.weight ?? 85,
    origin: budgetRange.origin,
    confirmationStatus: budgetRange.confirmationStatus,
    isHardConstraint: budgetRange.isHardCap && budgetRange.maxBudget !== null && budgetRange.maxBudget > 0,
    sourceReference:
      budgetRange.origin === 'explicit-user'
        ? 'User budget range configuration (P32)'
        : 'project.budget',
    rationale:
      budgetRange.maxBudget && budgetRange.maxBudget > 0
        ? `Evaluates whether parametric construction cost stays within ${formatCurrency(
            budgetRange.maxBudget,
            budgetRange.currency
          )}.`
        : 'Project budget is currently unspecified (<= 0).',
    updatedAt: prevBudgetItem?.updatedAt || now,
  });

  // 4. Storey Preference Item
  const storeyItemId = 'pref-storey-count';
  const prevStoreyItem = existingItemMap.get(storeyItemId);
  items.push({
    id: storeyItemId,
    dimension: 'storey-preference',
    key: 'preferredFloors',
    label: 'Preferred Building Storey Count',
    value: preferredFloors,
    unit: 'storeys',
    weight: prevStoreyItem?.weight ?? 70,
    origin:
      prevStoreyItem?.origin === 'explicit-user'
        ? 'explicit-user'
        : preferredFloors !== null
        ? 'imported-project-fact'
        : 'unknown',
    confirmationStatus:
      prevStoreyItem?.confirmationStatus ||
      (preferredFloors !== null ? 'confirmed' : 'unknown'),
    isHardConstraint: prevStoreyItem?.isHardConstraint ?? false,
    sourceReference:
      prevStoreyItem?.origin === 'explicit-user'
        ? 'User storey preference (P32)'
        : 'project.floors',
    rationale:
      preferredFloors !== null
        ? `Prefers ${preferredFloors}-storey massing configuration.`
        : 'Storey preference not specified.',
    updatedAt: prevStoreyItem?.updatedAt || now,
  });

  // 5. Inferred Solar Shading Suggestion from Site Context (never auto-confirmed!)
  const solarSuggestionId = 'pref-inferred-solar-shading';
  const prevSolarItem = existingItemMap.get(solarSuggestionId);
  const roadFacing = project.roadFacing || siteContext.environmental?.prevailingWindDirection || 'South';
  const recommendedShading: FacadeConcept['shadingStyle'] =
    roadFacing.includes('South') || roadFacing.includes('West')
      ? 'deep-overhangs'
      : 'brise-soleil';

  items.push({
    id: solarSuggestionId,
    dimension: 'shading-orientation',
    key: 'inferredSolarShading',
    label: `Passive Solar Shading for ${roadFacing}-Facing Parcel`,
    value: prevSolarItem?.value ?? recommendedShading,
    weight: prevSolarItem?.weight ?? 45,
    origin: prevSolarItem?.origin || 'inferred-suggestion',
    confirmationStatus: prevSolarItem?.confirmationStatus || 'unconfirmed-suggestion',
    isHardConstraint: false,
    sourceReference: `project.roadFacing (${roadFacing}) & project.siteContext`,
    rationale: `System suggestion based on ${roadFacing} orientation: "${recommendedShading}" helps mitigate solar heat gain. Remains inactive until explicitly confirmed by the user.`,
    updatedAt: prevSolarItem?.updatedAt || now,
  });

  // 6. Import P30 Interpreted Brief Requirements (confirmed vs unconfirmed kept strictly distinct)
  if (interpretedBrief && Array.isArray(interpretedBrief.requirements)) {
    for (const req of interpretedBrief.requirements) {
      if (!req || !req.id || req.reviewStatus === 'rejected') continue;
      const itemId = `p30-req-${req.id}`;
      const prevReqItem = existingItemMap.get(itemId);

      const isConfirmedInP30 = req.reviewStatus === 'confirmed';
      const isUserConfirmedInP32 = prevReqItem?.confirmationStatus === 'confirmed';
      const effectiveConfirmed = isConfirmedInP30 || isUserConfirmedInP32;

      const origin = isConfirmedInP30
        ? 'imported-project-fact'
        : isUserConfirmedInP32
        ? 'explicit-user'
        : 'inferred-suggestion';

      const confirmationStatus =
        prevReqItem?.confirmationStatus === 'rejected'
          ? 'rejected'
          : effectiveConfirmed
          ? 'confirmed'
          : 'unconfirmed-suggestion';

      // CRITICAL P30/P32 RULE: Confirmed must-have requirements from P30 are hard constraints
      // and must NEVER be silently downgraded to soft preferences without explicit user action.
      const isHardConstraint =
        prevReqItem?.isHardConstraint !== undefined
          ? prevReqItem.isHardConstraint
          : effectiveConfirmed && req.priority === 'must-have';

      items.push({
        id: itemId,
        dimension: 'brief-requirement',
        key: req.category,
        label: req.description,
        value: req.normalizedValue,
        unit: req.unit,
        weight:
          prevReqItem?.weight ??
          (req.priority === 'must-have' ? 95 : req.priority === 'preferred' ? 70 : 40),
        origin,
        confirmationStatus,
        isHardConstraint,
        sourceReference: `project.brief.interpretedBrief.requirements[${req.id}] (P30 ${req.source})`,
        rationale: isConfirmedInP30
          ? `Confirmed P30 brief requirement (${req.priority}).`
          : `Unconfirmed P30 AI-interpreted requirement (${req.source}); awaiting user confirmation before affecting personalization ranking.`,
        updatedAt: prevReqItem?.updatedAt || now,
      });
    }
  }

  // 7. Import P30 Brief Assumptions as unconfirmed suggestions if not rejected
  if (interpretedBrief && Array.isArray(interpretedBrief.assumptions)) {
    for (const assump of interpretedBrief.assumptions) {
      if (!assump || !assump.id || assump.status === 'rejected') continue;
      const itemId = `p30-assump-${assump.id}`;
      const prevAssumpItem = existingItemMap.get(itemId);

      const isConfirmed =
        assump.status === 'confirmed' ||
        prevAssumpItem?.confirmationStatus === 'confirmed';

      items.push({
        id: itemId,
        dimension: 'brief-requirement',
        key: assump.category,
        label: `Assumption: ${assump.description}`,
        value: assump.assumedValue,
        unit: assump.unit,
        weight: prevAssumpItem?.weight ?? 45,
        origin: isConfirmed ? 'explicit-user' : 'inferred-suggestion',
        confirmationStatus:
          prevAssumpItem?.confirmationStatus === 'rejected'
            ? 'rejected'
            : isConfirmed
            ? 'confirmed'
            : 'unconfirmed-suggestion',
        isHardConstraint: false,
        sourceReference: `project.brief.interpretedBrief.assumptions[${assump.id}]`,
        rationale: assump.rationale,
        updatedAt: prevAssumpItem?.updatedAt || now,
      });
    }
  }

  const profile: ProjectPersonalizationProfile = {
    id: existing?.id || `p32-prof-${project.id}`,
    projectId: project.id,
    version: P32_PERSONALIZATION_ENGINE_VERSION,
    createdAt: existing?.createdAt || now,
    updatedAt: existing?.updatedAt || now,
    requestSequenceId: existing?.requestSequenceId || 1,
    lastEvaluatedSourceFingerprint: existing?.lastEvaluatedSourceFingerprint,
    preferredFacadeStyles,
    preferredPrimaryMaterials,
    preferredCostTiers,
    preferredInteriorStyles,
    preferredShadingStyles,
    preferredFloors,
    spatialPriorityWeights,
    roomCategoryPriorities,
    budgetRange,
    items,
    notes: existing?.notes,
  };

  return profile;
}

/**
 * Updates user-controlled preferences on a ProjectPersonalizationProfile and marks
 * modified fields as 'explicit-user' + 'confirmed'. Never mutates the input profile.
 */
export function updatePersonalizationProfile(
  project: Project,
  currentProfile: ProjectPersonalizationProfile,
  updates: {
    preferredFacadeStyles?: Array<FacadeConcept['style']>;
    preferredPrimaryMaterials?: Array<FacadeConcept['primaryMaterial']>;
    preferredCostTiers?: Array<FacadeConcept['costTier']>;
    preferredInteriorStyles?: Array<InteriorRoomConcept['style']>;
    preferredShadingStyles?: Array<FacadeConcept['shadingStyle']>;
    preferredFloors?: number | null;
    spatialPriorityWeights?: Partial<Record<SpatialPriorityKey, number>>;
    budgetRange?: Partial<BudgetPreferenceRange>;
    notes?: string;
  }
): ProjectPersonalizationProfile {
  const now = new Date().toISOString();
  const nextSeq = (currentProfile.requestSequenceId || 1) + 1;

  const nextFacadeStyles =
    updates.preferredFacadeStyles !== undefined
      ? updates.preferredFacadeStyles.filter((s) => SUPPORTED_FACADE_STYLES.includes(s))
      : [...currentProfile.preferredFacadeStyles];

  const nextMaterials =
    updates.preferredPrimaryMaterials !== undefined
      ? updates.preferredPrimaryMaterials.filter((m) =>
          SUPPORTED_PRIMARY_MATERIALS.includes(m)
        )
      : [...currentProfile.preferredPrimaryMaterials];

  const nextCostTiers =
    updates.preferredCostTiers !== undefined
      ? updates.preferredCostTiers.filter((t) => SUPPORTED_COST_TIERS.includes(t))
      : [...currentProfile.preferredCostTiers];

  const nextInteriorStyles =
    updates.preferredInteriorStyles !== undefined
      ? updates.preferredInteriorStyles.filter((s) =>
          SUPPORTED_INTERIOR_STYLES.includes(s)
        )
      : [...currentProfile.preferredInteriorStyles];

  const nextShadingStyles =
    updates.preferredShadingStyles !== undefined
      ? updates.preferredShadingStyles.filter((s) =>
          SUPPORTED_SHADING_STYLES.includes(s)
        )
      : [...currentProfile.preferredShadingStyles];

  const nextFloors =
    updates.preferredFloors !== undefined
      ? updates.preferredFloors
      : currentProfile.preferredFloors;

  const nextSpatialWeights: Record<SpatialPriorityKey, number> = {
    ...currentProfile.spatialPriorityWeights,
  };
  if (updates.spatialPriorityWeights) {
    for (const [k, v] of Object.entries(updates.spatialPriorityWeights)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        nextSpatialWeights[k as SpatialPriorityKey] = Math.max(
          0,
          Math.min(100, Math.round(v))
        );
      }
    }
  }

  const nextBudgetRange: BudgetPreferenceRange = updates.budgetRange
    ? {
        ...currentProfile.budgetRange,
        ...updates.budgetRange,
        origin: 'explicit-user',
        confirmationStatus:
          updates.budgetRange.maxBudget !== undefined &&
          updates.budgetRange.maxBudget !== null &&
          updates.budgetRange.maxBudget > 0
            ? 'confirmed'
            : currentProfile.budgetRange.confirmationStatus,
      }
    : { ...currentProfile.budgetRange };

  const updatedItems = currentProfile.items.map((item) => {
    if (
      item.id === 'pref-facade-style' &&
      updates.preferredFacadeStyles !== undefined
    ) {
      return {
        ...item,
        value: nextFacadeStyles.length > 0 ? nextFacadeStyles : null,
        origin: 'explicit-user' as const,
        confirmationStatus:
          nextFacadeStyles.length > 0
            ? ('confirmed' as const)
            : ('unknown' as const),
        sourceReference: 'User preference selection (P32)',
        updatedAt: now,
      };
    }
    if (
      item.id === 'pref-primary-material' &&
      updates.preferredPrimaryMaterials !== undefined
    ) {
      return {
        ...item,
        value: nextMaterials.length > 0 ? nextMaterials : null,
        origin: 'explicit-user' as const,
        confirmationStatus:
          nextMaterials.length > 0 ? ('confirmed' as const) : ('unknown' as const),
        sourceReference: 'User preference selection (P32)',
        updatedAt: now,
      };
    }
    if (item.id === 'pref-budget-cap' && updates.budgetRange !== undefined) {
      return {
        ...item,
        value: nextBudgetRange.maxBudget,
        origin: 'explicit-user' as const,
        confirmationStatus:
          nextBudgetRange.maxBudget && nextBudgetRange.maxBudget > 0
            ? ('confirmed' as const)
            : ('unknown' as const),
        isHardConstraint:
          Boolean(nextBudgetRange.isHardCap) &&
          Boolean(nextBudgetRange.maxBudget && nextBudgetRange.maxBudget > 0),
        sourceReference: 'User budget range configuration (P32)',
        updatedAt: now,
      };
    }
    if (
      item.id === 'pref-storey-count' &&
      updates.preferredFloors !== undefined
    ) {
      return {
        ...item,
        value: nextFloors,
        origin: 'explicit-user' as const,
        confirmationStatus:
          nextFloors !== null ? ('confirmed' as const) : ('unknown' as const),
        sourceReference: 'User storey preference (P32)',
        updatedAt: now,
      };
    }
    return { ...item };
  });

  const updatedProfile: ProjectPersonalizationProfile = {
    ...currentProfile,
    updatedAt: now,
    requestSequenceId: nextSeq,
    preferredFacadeStyles: nextFacadeStyles,
    preferredPrimaryMaterials: nextMaterials,
    preferredCostTiers: nextCostTiers,
    preferredInteriorStyles: nextInteriorStyles,
    preferredShadingStyles: nextShadingStyles,
    preferredFloors: nextFloors,
    spatialPriorityWeights: nextSpatialWeights,
    budgetRange: nextBudgetRange,
    items: updatedItems,
    notes: updates.notes !== undefined ? updates.notes : currentProfile.notes,
  };

  return updatedProfile;
}

/**
 * Explicitly confirms or rejects an inferred preference item or adjusts its weight/constraint status.
 * An inferred suggestion ONLY becomes active when `newStatus === 'confirmed'` via explicit user action.
 */
export function reviewPersonalizationPreferenceItem(
  currentProfile: ProjectPersonalizationProfile,
  itemId: string,
  action: {
    confirmationStatus?: 'confirmed' | 'unconfirmed-suggestion' | 'rejected';
    weight?: number;
    isHardConstraint?: boolean;
  }
): ProjectPersonalizationProfile {
  const now = new Date().toISOString();
  const nextSeq = (currentProfile.requestSequenceId || 1) + 1;

  let nextShadingStyles = [...currentProfile.preferredShadingStyles];

  const nextItems = currentProfile.items.map((item) => {
    if (item.id !== itemId) return { ...item };

    const nextStatus = action.confirmationStatus ?? item.confirmationStatus;
    const nextOrigin =
      action.confirmationStatus === 'confirmed' &&
      item.origin === 'inferred-suggestion'
        ? ('explicit-user' as const)
        : item.origin;

    const nextWeight =
      action.weight !== undefined && Number.isFinite(action.weight)
        ? Math.max(0, Math.min(100, Math.round(action.weight)))
        : item.weight;

    const nextHard =
      action.isHardConstraint !== undefined
        ? action.isHardConstraint
        : item.isHardConstraint;

    // If confirming the solar shading suggestion, sync into preferredShadingStyles
    if (
      item.id === 'pref-inferred-solar-shading' &&
      nextStatus === 'confirmed' &&
      typeof item.value === 'string' &&
      SUPPORTED_SHADING_STYLES.includes(item.value as FacadeConcept['shadingStyle'])
    ) {
      const sh = item.value as FacadeConcept['shadingStyle'];
      if (!nextShadingStyles.includes(sh)) {
        nextShadingStyles.push(sh);
      }
    }

    return {
      ...item,
      origin: nextOrigin,
      confirmationStatus: nextStatus,
      weight: nextWeight,
      isHardConstraint: nextHard,
      updatedAt: now,
    };
  });

  return {
    ...currentProfile,
    updatedAt: now,
    requestSequenceId: nextSeq,
    preferredShadingStyles: nextShadingStyles,
    items: nextItems,
  };
}

/**
 * Resets a project's personalization profile back to initial imported facts and unconfirmed suggestions.
 */
export function resetPersonalizationProfile(
  project: Project
): ProjectPersonalizationProfile {
  const cleanProject: Project = {
    ...project,
    designPersonalization: undefined,
  };
  return initializePersonalizationProfile(cleanProject);
}

/**
 * Saves a personalization profile onto a clone of the Project without mutating any
 * floorPlan rooms, scenarios, designAlternatives, or P30 brief data.
 */
export function savePersonalizationProfileToProject(
  project: Project,
  profile: ProjectPersonalizationProfile
): Project {
  const now = new Date().toISOString();
  const fp = computePersonalizationSourceFingerprint(project, profile);
  return {
    ...project,
    designPersonalization: {
      ...profile,
      lastEvaluatedSourceFingerprint: fp,
      updatedAt: now,
    },
    updatedAt: now,
  };
}

/**
 * Removes saved project preferences while preserving all other project data intact.
 */
export function removePersonalizationProfileFromProject(project: Project): Project {
  const clone: Project = {
    ...project,
    updatedAt: new Date().toISOString(),
  };
  delete clone.designPersonalization;
  return clone;
}

/**
 * Detects conflicts between preferences, project constraints, and confirmed P30 brief requirements
 * (Section 4B of P32).
 */
export function detectPersonalizationConflicts(
  project: Project,
  profile: ProjectPersonalizationProfile
): PersonalizationConflictItem[] {
  const conflicts: PersonalizationConflictItem[] = [];

  // 1. Competing Spatial Priorities: Openness/Generous Living vs Compact Ground Footprint on 1 storey
  const opennessWeight = profile.spatialPriorityWeights.opennessAndLivingArea ?? 50;
  const compactWeight = profile.spatialPriorityWeights.compactPlotFootprint ?? 40;
  const effectiveFloors = profile.preferredFloors ?? project.floors;

  if (opennessWeight >= 70 && compactWeight >= 70 && effectiveFloors <= 1) {
    conflicts.push({
      id: 'p32-conflict-openness-vs-compact-single-storey',
      type: 'competing-preferences',
      severity: 'warning',
      title: 'Competing Priorities: Maximum Living Area vs. Compact Single-Storey Footprint',
      explanation: `Both "Openness & Generous Living Space" (weight ${opennessWeight}/100) and "Compact Ground Footprint" (weight ${compactWeight}/100) are set to high priority while preferring a 1-storey building. Expanding floor area on a single level directly increases ground plot coverage.`,
      affectedPreferenceIds: ['pref-storey-count'],
      isHardConstraintViolation: false,
      resolutionOptions: [
        'Allow 2+ storeys so upper-level rooms can increase floor area without expanding ground footprint.',
        'Reduce the weight on either "Openness & Generous Living Space" or "Compact Ground Footprint".',
      ],
    });
  }

  // 2. High-End / Ultra Luxury Cost Tier vs Tight Budget Cap / High Budget Predictability
  const hasLuxuryPreference = profile.preferredCostTiers.some(
    (t) => t === 'High-End Architectural' || t === 'Ultra Luxury'
  );
  const budgetWeight = profile.spatialPriorityWeights.budgetPredictability ?? 60;
  const maxBudget = profile.budgetRange.maxBudget;

  if (hasLuxuryPreference && budgetWeight >= 75) {
    conflicts.push({
      id: 'p32-conflict-luxury-tier-vs-budget-priority',
      type: 'preference-vs-budget',
      severity: maxBudget && maxBudget > 0 && profile.budgetRange.isHardCap ? 'conflict' : 'warning',
      title: 'Specification Tier vs. Budget Control Tension',
      explanation: `Preferred specification tier includes "${profile.preferredCostTiers.join(
        ', '
      )}" while "Budget Predictability & Cost Control" is weighted at ${budgetWeight}/100${
        maxBudget && maxBudget > 0
          ? ` with a budget cap of ${formatCurrency(maxBudget, profile.budgetRange.currency)}`
          : ''
      }. High-end/luxury facade assemblies carry a 45–115% higher parametric unit cost rate.`,
      affectedPreferenceIds: ['pref-budget-cap'],
      isHardConstraintViolation: Boolean(
        maxBudget && maxBudget > 0 && profile.budgetRange.isHardCap
      ),
      resolutionOptions: [
        'Include "Balanced Mid-Range" or "Economic" in preferred specification tiers.',
        'Increase the target budget cap if luxury finishes are mandatory.',
      ],
    });
  }

  // 3. High-Carbon Material Preference vs Low-Carbon Priority
  const lowCarbonWeight = profile.spatialPriorityWeights.lowCarbonMaterials ?? 45;
  const hasHighCarbonMaterial =
    profile.preferredPrimaryMaterials.length > 0 &&
    profile.preferredPrimaryMaterials.every(
      (m) => m === 'concrete' || m === 'glass'
    );

  if (lowCarbonWeight >= 70 && hasHighCarbonMaterial) {
    conflicts.push({
      id: 'p32-conflict-material-vs-low-carbon',
      type: 'competing-preferences',
      severity: 'warning',
      title: 'Material Selection vs. Low Embodied Carbon Priority',
      explanation: `Preferred primary materials are restricted to "${profile.preferredPrimaryMaterials.join(
        ', '
      )}" (490–530 kg CO₂e/m²) while "Low Embodied Carbon" is weighted at ${lowCarbonWeight}/100.`,
      affectedPreferenceIds: ['pref-primary-material'],
      isHardConstraintViolation: false,
      resolutionOptions: [
        'Add "timber" (180 kg CO₂e/m²), "plaster" (290 kg CO₂e/m²), or "stone" (330 kg CO₂e/m²) to preferred materials.',
        'Lower the "Low Embodied Carbon" priority weight if concrete/glass expression is primary.',
      ],
    });
  }

  // 4. Preference vs Confirmed P30 Must-Have Requirements
  const interpretedBrief = project.brief?.interpretedBrief;
  if (interpretedBrief && Array.isArray(interpretedBrief.requirements)) {
    for (const req of interpretedBrief.requirements) {
      if (req.reviewStatus !== 'confirmed') continue;

      if (
        req.category === 'floors-circulation' &&
        typeof req.normalizedValue === 'number' &&
        profile.preferredFloors !== null &&
        profile.preferredFloors !== req.normalizedValue
      ) {
        conflicts.push({
          id: `p32-conflict-floors-vs-p30-${req.id}`,
          type: 'preference-vs-hard-constraint',
          severity: 'conflict',
          title: 'Storey Preference Conflicts with Confirmed P30 Brief Requirement',
          explanation: `Personalization profile prefers ${profile.preferredFloors} storey(s), but confirmed P30 brief requirement "${req.description}" specifies ${req.normalizedValue} storey(s). Hard brief constraints are never silently overridden.`,
          affectedPreferenceIds: ['pref-storey-count', `p30-req-${req.id}`],
          isHardConstraintViolation: req.priority === 'must-have',
          resolutionOptions: [
            `Align preferred storeys in P32 to ${req.normalizedValue} storey(s).`,
            'Or update the requirement in the P30 Architectural Brief Workspace first.',
          ],
        });
      }
    }

    // 5. Surface Unresolved P30 Brief Contradictions
    for (const c of interpretedBrief.conflicts || []) {
      if (!c.resolved && c.disposition === 'confirmed-contradiction') {
        conflicts.push({
          id: `p32-p30-contradiction-${c.id}`,
          type: 'p30-brief-contradiction',
          severity: 'conflict',
          title: `Unresolved P30 Brief Contradiction: ${c.title}`,
          explanation: c.description,
          affectedPreferenceIds: c.affectedRequirementIds.map((id) => `p30-req-${id}`),
          isHardConstraintViolation: true,
          resolutionOptions: [
            c.resolutionSuggestion ||
              'Resolve the contradiction in the P30 Architectural Brief Interpreter.',
          ],
        });
      }
    }
  }

  return conflicts;
}

/**
 * Core deterministic P32 Adaptive Design Personalization engine.
 * Reuses P31 Multi-Option Design Comparison (`extractComparableOptions` & `compareDesignOptions`)
 * and P30 (`project.brief.interpretedBrief`) without duplicating calculation logic or mutating project state.
 */
export function evaluateDesignPersonalization(
  project: Project,
  inputProfile?: ProjectPersonalizationProfile,
  options?: {
    requestSequenceId?: number;
  }
): PersonalizationEvaluationResult {
  const profile = inputProfile
    ? { ...inputProfile }
    : initializePersonalizationProfile(project);

  const currentFingerprint = computePersonalizationSourceFingerprint(project, profile);
  const isStale = Boolean(
    profile.lastEvaluatedSourceFingerprint &&
      profile.lastEvaluatedSourceFingerprint !== currentFingerprint
  );
  const staleReason = isStale
    ? 'Underlying project options, floor-plan geometry, P30 brief requirements, or personalization weights have changed since the profile was last saved.'
    : undefined;

  // Reuse P31 option extraction and comparison calculation engine directly
  const comparableOptions = extractComparableOptions(project);
  const allOptionIds = comparableOptions.map((o) => o.optionId);
  const p31Result = compareDesignOptions(project, {
    selectedOptionIds: allOptionIds,
    scoringEnabled: false,
  });

  // Map P31 criterion rows by ID for fast lookup
  const p31CriteriaMap = new Map(
    p31Result.criteriaComparisons.map((c) => [c.criterion.id, c])
  );

  // Detect preference & constraint conflicts
  const conflicts = detectPersonalizationConflicts(project, profile);

  // Count epistemic categories in profile.items
  const explicitConfirmedCount = profile.items.filter(
    (i) => i.origin === 'explicit-user' && i.confirmationStatus === 'confirmed'
  ).length;
  const importedFactsCount = profile.items.filter(
    (i) => i.origin === 'imported-project-fact' && i.confirmationStatus === 'confirmed'
  ).length;
  const inferredUnconfirmedCount = profile.items.filter(
    (i) => i.confirmationStatus === 'unconfirmed-suggestion'
  ).length;
  const unknownPreferencesCount = profile.items.filter(
    (i) => i.origin === 'unknown' || i.confirmationStatus === 'unknown'
  ).length;

  // Pre-compute min/max across options for relative spatial priority normalization
  const netAreaRow = p31CriteriaMap.get('net-usable-room-area');
  const plotCoverageRow = p31CriteriaMap.get('plot-ground-coverage');
  const estCostRow = p31CriteriaMap.get('estimated-construction-cost');
  const carbonRow = p31CriteriaMap.get('upfront-embodied-carbon');
  const mandatorySpaceRow = p31CriteriaMap.get('mandatory-space-placement');
  const confirmedBriefRow = p31CriteriaMap.get('confirmed-brief-fit');
  const geomConflictRow = p31CriteriaMap.get('geometry-boundary-conflicts');

  const getNumVal = (
    row: typeof netAreaRow,
    optId: string
  ): number | null => {
    const v = row?.valuesByOptionId[optId]?.rawValue;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  // Evaluate each option
  const recommendations: PersonalizedOptionRecommendation[] = comparableOptions.map(
    (opt) => {
      const criterionMatches: PreferenceCriterionMatchDetail[] = [];
      const satisfiedPreferences: string[] = [];
      const unmetRequirements: string[] = [];
      const tradeOffsIntroduced: string[] = [];
      const assumptionsAndMissingInputs: string[] = [];
      const whatUserCanChangeGuidance: string[] = [];

      let hardConstraintsMetCount = 0;
      let hardConstraintsViolatedCount = 0;
      let hardConstraintsUnassessedCount = 0;

      // Helper to record a match detail
      const addMatch = (detail: PreferenceCriterionMatchDetail) => {
        criterionMatches.push(detail);
        if (detail.isHardConstraint) {
          if (detail.status === 'satisfied') {
            hardConstraintsMetCount += 1;
          } else if (detail.status === 'unmet') {
            hardConstraintsViolatedCount += 1;
            unmetRequirements.push(
              `Hard Constraint Unmet — ${detail.label}: ${detail.explanation}`
            );
          } else if (detail.status === 'unknown-data') {
            hardConstraintsUnassessedCount += 1;
            assumptionsAndMissingInputs.push(
              `Unverified Hard Constraint — ${detail.label}: ${detail.explanation}`
            );
          }
        } else if (detail.confirmationStatus === 'confirmed' && detail.weight > 0) {
          if (detail.status === 'satisfied') {
            satisfiedPreferences.push(`${detail.label} (${detail.measuredOrObservedValue})`);
          } else if (detail.status === 'unmet') {
            unmetRequirements.push(`${detail.label} (${detail.explanation})`);
          } else if (detail.status === 'partial') {
            tradeOffsIntroduced.push(`${detail.label}: ${detail.explanation}`);
          } else if (detail.status === 'unknown-data') {
            assumptionsAndMissingInputs.push(`${detail.label}: ${detail.explanation}`);
          }
        } else if (detail.confirmationStatus === 'unconfirmed-suggestion') {
          assumptionsAndMissingInputs.push(
            `Unconfirmed Suggestion (Excluded from Score) — ${detail.label}: ${detail.explanation}`
          );
        }
      };

      // -----------------------------------------------------------------------
      // HARD CONSTRAINT 1: 2D Geometry & Parcel Boundary Integrity (via P31)
      // -----------------------------------------------------------------------
      const geomConflicts = getNumVal(geomConflictRow, opt.optionId);
      addMatch({
        preferenceId: 'hc-geometry-integrity',
        label: '2D Geometry, Parcel Boundary & Adjacency Integrity',
        dimension: 'spatial-priority',
        origin: 'imported-project-fact',
        confirmationStatus: 'confirmed',
        isHardConstraint: true,
        weight: 100,
        status:
          geomConflicts === null
            ? 'unknown-data'
            : geomConflicts === 0
            ? 'satisfied'
            : 'unmet',
        rawMatchScore:
          geomConflicts === null
            ? null
            : Math.max(0, 100 - geomConflicts * 25),
        weightedContribution: 0,
        measuredOrObservedValue:
          geomConflictRow?.valuesByOptionId[opt.optionId]?.formattedValue ||
          'Unavailable',
        explanation:
          geomConflictRow?.valuesByOptionId[opt.optionId]?.explanation ||
          'Geometry validation requires placed rooms.',
      });

      // -----------------------------------------------------------------------
      // HARD CONSTRAINT 2: Mandatory Programmed Spaces Placed (via P31)
      // -----------------------------------------------------------------------
      const mandatoryPct = getNumVal(mandatorySpaceRow, opt.optionId);
      if (mandatorySpaceRow) {
        addMatch({
          preferenceId: 'hc-mandatory-spaces',
          label: 'Mandatory Space Program Placement',
          dimension: 'room-priority',
          origin: 'imported-project-fact',
          confirmationStatus: 'confirmed',
          isHardConstraint: true,
          weight: 95,
          status:
            mandatoryPct === null
              ? 'unknown-data'
              : mandatoryPct >= 100
              ? 'satisfied'
              : 'unmet',
          rawMatchScore: mandatoryPct,
          weightedContribution: 0,
          measuredOrObservedValue:
            mandatorySpaceRow.valuesByOptionId[opt.optionId]?.formattedValue ||
            'Unavailable',
          explanation:
            mandatorySpaceRow.valuesByOptionId[opt.optionId]?.explanation ||
            'Mandatory space check unavailable.',
        });
      }

      // -----------------------------------------------------------------------
      // HARD CONSTRAINT 3: Confirmed P30 Brief Requirements Fit (via P31)
      // -----------------------------------------------------------------------
      if (p31Result.p30BriefSummary.confirmedRequirementsCount > 0 && confirmedBriefRow) {
        const p30FitPct = getNumVal(confirmedBriefRow, opt.optionId);
        addMatch({
          preferenceId: 'hc-p30-confirmed-brief',
          label: 'Confirmed P30 Brief Requirements Compliance',
          dimension: 'brief-requirement',
          origin: 'imported-project-fact',
          confirmationStatus: 'confirmed',
          isHardConstraint: true,
          weight: 100,
          status:
            p30FitPct === null
              ? 'unknown-data'
              : p30FitPct >= 100
              ? 'satisfied'
              : 'unmet',
          rawMatchScore: p30FitPct,
          weightedContribution: 0,
          measuredOrObservedValue:
            confirmedBriefRow.valuesByOptionId[opt.optionId]?.formattedValue ||
            'Unavailable',
          explanation:
            confirmedBriefRow.valuesByOptionId[opt.optionId]?.explanation ||
            'Evaluated against confirmed P30 brief requirements.',
        });
      }

      // -----------------------------------------------------------------------
      // PREFERENCE 1: Architectural Facade Style
      // -----------------------------------------------------------------------
      const styleItem = profile.items.find((i) => i.id === 'pref-facade-style');
      if (styleItem && styleItem.confirmationStatus === 'confirmed' && profile.preferredFacadeStyles.length > 0) {
        const optStyle = opt.facade?.style;
        const matched = optStyle ? profile.preferredFacadeStyles.includes(optStyle) : false;
        addMatch({
          preferenceId: styleItem.id,
          label: styleItem.label,
          dimension: 'architectural-style',
          origin: styleItem.origin,
          confirmationStatus: styleItem.confirmationStatus,
          isHardConstraint: styleItem.isHardConstraint,
          weight: styleItem.weight,
          status: !optStyle ? 'unknown-data' : matched ? 'satisfied' : 'unmet',
          rawMatchScore: !optStyle ? null : matched ? 100 : 20,
          weightedContribution: 0,
          measuredOrObservedValue: optStyle || 'Unspecified style',
          explanation: !optStyle
            ? 'Option does not specify a facade architectural style.'
            : matched
            ? `Option facade style "${optStyle}" matches preferred style (${profile.preferredFacadeStyles.join(', ')}).`
            : `Option uses "${optStyle}" facade style rather than preferred (${profile.preferredFacadeStyles.join(', ')}).`,
        });
      }

      // -----------------------------------------------------------------------
      // PREFERENCE 2: Primary Envelope Material
      // -----------------------------------------------------------------------
      const matItem = profile.items.find((i) => i.id === 'pref-primary-material');
      if (matItem && matItem.confirmationStatus === 'confirmed' && profile.preferredPrimaryMaterials.length > 0) {
        const optMat = opt.facade?.primaryMaterial;
        const optAccent = opt.facade?.accentMaterial;
        const exactMatch = optMat ? profile.preferredPrimaryMaterials.includes(optMat) : false;
        const accentMatch =
          !exactMatch && optAccent
            ? profile.preferredPrimaryMaterials.includes(optAccent)
            : false;

        addMatch({
          preferenceId: matItem.id,
          label: matItem.label,
          dimension: 'primary-material',
          origin: matItem.origin,
          confirmationStatus: matItem.confirmationStatus,
          isHardConstraint: matItem.isHardConstraint,
          weight: matItem.weight,
          status: !optMat
            ? 'unknown-data'
            : exactMatch
            ? 'satisfied'
            : accentMatch
            ? 'partial'
            : 'unmet',
          rawMatchScore: !optMat ? null : exactMatch ? 100 : accentMatch ? 65 : 20,
          weightedContribution: 0,
          measuredOrObservedValue: optMat
            ? `${optMat}${optAccent ? ` (accent: ${optAccent})` : ''}`
            : 'Unspecified material',
          explanation: !optMat
            ? 'Option does not specify a primary facade material.'
            : exactMatch
            ? `Primary material "${optMat}" matches preferred material (${profile.preferredPrimaryMaterials.join(', ')}).`
            : accentMatch
            ? `Primary material is "${optMat}", but preferred material appears as accent "${optAccent}".`
            : `Option uses "${optMat}" instead of preferred (${profile.preferredPrimaryMaterials.join(', ')}).`,
        });
      }

      // -----------------------------------------------------------------------
      // PREFERENCE 3: Target Budget Range & Cost Cap
      // -----------------------------------------------------------------------
      const budgetItem = profile.items.find((i) => i.id === 'pref-budget-cap');
      const estCost = getNumVal(estCostRow, opt.optionId);
      const maxBudget = profile.budgetRange.maxBudget;
      if (budgetItem && budgetItem.confirmationStatus === 'confirmed' && maxBudget && maxBudget > 0) {
        const currencyMatch = opt.currency === profile.budgetRange.currency;
        if (!currencyMatch || estCost === null) {
          addMatch({
            preferenceId: budgetItem.id,
            label: budgetItem.label,
            dimension: 'budget-range',
            origin: budgetItem.origin,
            confirmationStatus: budgetItem.confirmationStatus,
            isHardConstraint: budgetItem.isHardConstraint,
            weight: budgetItem.weight,
            status: 'unknown-data',
            rawMatchScore: null,
            weightedContribution: 0,
            measuredOrObservedValue: 'Cost Unavailable',
            explanation: !currencyMatch
              ? `Currency mismatch (${opt.currency} vs ${profile.budgetRange.currency}).`
              : 'Parametric construction cost is unavailable (missing valid room geometry or cost tier).',
          });
        } else {
          const withinCap = estCost <= maxBudget;
          const overPct = ((estCost - maxBudget) / maxBudget) * 100;
          const score = withinCap
            ? Math.min(100, Math.round(85 + ((maxBudget - estCost) / maxBudget) * 30))
            : Math.max(0, Math.round(60 - overPct * 2));

          addMatch({
            preferenceId: budgetItem.id,
            label: budgetItem.label,
            dimension: 'budget-range',
            origin: budgetItem.origin,
            confirmationStatus: budgetItem.confirmationStatus,
            isHardConstraint: budgetItem.isHardConstraint,
            weight: budgetItem.weight,
            status: withinCap ? 'satisfied' : overPct <= 10 ? 'partial' : 'unmet',
            rawMatchScore: score,
            weightedContribution: 0,
            measuredOrObservedValue: `${formatCurrency(estCost, opt.currency)} vs cap ${formatCurrency(maxBudget, opt.currency)}`,
            explanation: withinCap
              ? `Estimated cost (${formatCurrency(estCost, opt.currency)}) is within the ${formatCurrency(maxBudget, opt.currency)} budget cap.`
              : `Estimated cost (${formatCurrency(estCost, opt.currency)}) exceeds the ${formatCurrency(maxBudget, opt.currency)} budget cap by ${overPct.toFixed(1)}%.`,
          });
        }
      }

      // -----------------------------------------------------------------------
      // PREFERENCE 4: Storey Count Preference
      // -----------------------------------------------------------------------
      const storeyItem = profile.items.find((i) => i.id === 'pref-storey-count');
      if (
        storeyItem &&
        storeyItem.confirmationStatus === 'confirmed' &&
        profile.preferredFloors !== null
      ) {
        const matchesFloors = opt.floors === profile.preferredFloors;
        addMatch({
          preferenceId: storeyItem.id,
          label: storeyItem.label,
          dimension: 'storey-preference',
          origin: storeyItem.origin,
          confirmationStatus: storeyItem.confirmationStatus,
          isHardConstraint: storeyItem.isHardConstraint,
          weight: storeyItem.weight,
          status: matchesFloors ? 'satisfied' : 'unmet',
          rawMatchScore: matchesFloors ? 100 : Math.max(20, 100 - Math.abs(opt.floors - profile.preferredFloors) * 40),
          weightedContribution: 0,
          measuredOrObservedValue: `${opt.floors} storey(s)`,
          explanation: matchesFloors
            ? `Option has ${opt.floors} storey(s), matching the preferred storey count.`
            : `Option has ${opt.floors} storey(s) vs preferred ${profile.preferredFloors} storey(s).`,
        });
      }

      // -----------------------------------------------------------------------
      // PREFERENCE 5: Solar Shading Suggestion (Tracked as Unconfirmed Until Confirmed)
      // -----------------------------------------------------------------------
      const solarItem = profile.items.find(
        (i) => i.id === 'pref-inferred-solar-shading'
      );
      if (solarItem && solarItem.confirmationStatus !== 'rejected') {
        const optShading = opt.facade?.shadingStyle;
        const matchedShading =
          optShading &&
          (profile.preferredShadingStyles.includes(optShading) ||
            optShading === solarItem.value);

        addMatch({
          preferenceId: solarItem.id,
          label: solarItem.label,
          dimension: 'shading-orientation',
          origin: solarItem.origin,
          confirmationStatus: solarItem.confirmationStatus,
          isHardConstraint: false,
          weight: solarItem.weight,
          status:
            solarItem.confirmationStatus === 'unconfirmed-suggestion'
              ? 'unconfirmed-ignored'
              : !optShading
              ? 'unknown-data'
              : matchedShading
              ? 'satisfied'
              : 'unmet',
          rawMatchScore:
            solarItem.confirmationStatus === 'unconfirmed-suggestion' || !optShading
              ? null
              : matchedShading
              ? 100
              : 30,
          weightedContribution: 0,
          measuredOrObservedValue: optShading || 'Unspecified shading',
          explanation:
            solarItem.confirmationStatus === 'unconfirmed-suggestion'
              ? `Inferred suggestion (${solarItem.value}); not confirmed by user so it does not affect the option's score.`
              : matchedShading
              ? `Shading "${optShading}" matches confirmed passive solar preference.`
              : `Option uses "${optShading || 'none'}" rather than confirmed "${solarItem.value}".`,
        });
      }

      // -----------------------------------------------------------------------
      // SPATIAL PRIORITIES (Evaluated Deterministically Using P31 & Room Geometry)
      // -----------------------------------------------------------------------
      const validRooms = (opt.rooms || []).filter(
        (r) => r && r.width > 0 && r.length > 0
      );
      const totalRoomArea = validRooms.reduce(
        (acc, r) => acc + r.width * r.length,
        0
      );

      // 1. Openness & Generous Living Area
      const opennessWeight = profile.spatialPriorityWeights.opennessAndLivingArea;
      if (opennessWeight > 0) {
        const livingArea = validRooms
          .filter((r) => {
            const t = (r.type || '').toLowerCase();
            const n = (r.name || '').toLowerCase();
            return (
              t === 'living' ||
              t === 'dining' ||
              t === 'kitchen' ||
              n.includes('living') ||
              n.includes('dining') ||
              n.includes('lounge')
            );
          })
          .reduce((acc, r) => acc + r.width * r.length, 0);

        const optNetArea = getNumVal(netAreaRow, opt.optionId);
        if (validRooms.length === 0 || optNetArea === null || totalRoomArea <= 0) {
          addMatch({
            preferenceId: 'spatial-openness',
            label: 'Spatial Priority: Openness & Generous Living Space',
            dimension: 'spatial-priority',
            origin: 'explicit-user',
            confirmationStatus: 'confirmed',
            isHardConstraint: false,
            weight: opennessWeight,
            status: 'unknown-data',
            rawMatchScore: null,
            weightedContribution: 0,
            measuredOrObservedValue: 'Unavailable (0 rooms)',
            explanation:
              'Cannot evaluate living space openness because no valid rooms are placed.',
          });
        } else {
          const livingSharePct = (livingArea / totalRoomArea) * 100;
          const minNet = netAreaRow?.minNumericValue ?? optNetArea;
          const maxNet = netAreaRow?.maxNumericValue ?? optNetArea;
          const areaNorm =
            maxNet > minNet
              ? 50 + ((optNetArea - minNet) / (maxNet - minNet)) * 50
              : 80;
          const shareScore = Math.min(100, Math.max(30, livingSharePct * 2.2));
          const combinedScore = Math.round(areaNorm * 0.6 + shareScore * 0.4);

          addMatch({
            preferenceId: 'spatial-openness',
            label: 'Spatial Priority: Openness & Generous Living Space',
            dimension: 'spatial-priority',
            origin: 'explicit-user',
            confirmationStatus: 'confirmed',
            isHardConstraint: false,
            weight: opennessWeight,
            status:
              combinedScore >= 70
                ? 'satisfied'
                : combinedScore >= 50
                ? 'partial'
                : 'unmet',
            rawMatchScore: combinedScore,
            weightedContribution: 0,
            measuredOrObservedValue: `${optNetArea.toFixed(1)} ${
              project.unit === 'metres' ? 'm²' : 'sq ft'
            } net (${livingSharePct.toFixed(0)}% living/social)`,
            explanation: `Provides ${optNetArea.toFixed(1)} ${
              project.unit === 'metres' ? 'm²' : 'sq ft'
            } net usable area with ${livingSharePct.toFixed(
              1
            )}% allocated to living, dining, and kitchen spaces.`,
          });
        }
      }

      // 2. Storage & Utility Capacity
      const storageWeight = profile.spatialPriorityWeights.storageAndUtilityCapacity;
      if (storageWeight > 0) {
        if (validRooms.length === 0) {
          addMatch({
            preferenceId: 'spatial-storage',
            label: 'Spatial Priority: Dedicated Storage & Service Utility',
            dimension: 'spatial-priority',
            origin: 'explicit-user',
            confirmationStatus: 'confirmed',
            isHardConstraint: false,
            weight: storageWeight,
            status: 'unknown-data',
            rawMatchScore: null,
            weightedContribution: 0,
            measuredOrObservedValue: 'Unavailable',
            explanation: 'No placed rooms to evaluate storage/utility capacity.',
          });
        } else {
          const utilityRooms = validRooms.filter((r) => {
            const t = (r.type || '').toLowerCase();
            const n = (r.name || '').toLowerCase();
            return (
              t === 'storage' ||
              t === 'laundry' ||
              t === 'garage' ||
              n.includes('storage') ||
              n.includes('utility') ||
              n.includes('laundry') ||
              n.includes('pantry') ||
              n.includes('garage')
            );
          });
          const utilArea = utilityRooms.reduce(
            (acc, r) => acc + r.width * r.length,
            0
          );
          const score =
            utilityRooms.length >= 2
              ? 95
              : utilityRooms.length === 1
              ? 75
              : 35;

          addMatch({
            preferenceId: 'spatial-storage',
            label: 'Spatial Priority: Dedicated Storage & Service Utility',
            dimension: 'spatial-priority',
            origin: 'explicit-user',
            confirmationStatus: 'confirmed',
            isHardConstraint: false,
            weight: storageWeight,
            status:
              utilityRooms.length >= 1 ? 'satisfied' : 'partial',
            rawMatchScore: score,
            weightedContribution: 0,
            measuredOrObservedValue: `${utilityRooms.length} utility/storage room(s) (${utilArea.toFixed(
              1
            )} ${project.unit === 'metres' ? 'm²' : 'sq ft'})`,
            explanation:
              utilityRooms.length > 0
                ? `Includes ${utilityRooms.length} dedicated storage/utility/garage space(s).`
                : 'No dedicated storage/utility room is explicitly separated in the 2D layout.',
          });
        }
      }

      // 3. Low Embodied Carbon & Biogenic Materials
      const carbonWeight = profile.spatialPriorityWeights.lowCarbonMaterials;
      if (carbonWeight > 0) {
        const optCarbon = getNumVal(carbonRow, opt.optionId);
        if (optCarbon === null) {
          addMatch({
            preferenceId: 'spatial-low-carbon',
            label: 'Spatial Priority: Low Embodied Carbon & Biogenic Materials',
            dimension: 'spatial-priority',
            origin: 'explicit-user',
            confirmationStatus: 'confirmed',
            isHardConstraint: false,
            weight: carbonWeight,
            status: 'unknown-data',
            rawMatchScore: null,
            weightedContribution: 0,
            measuredOrObservedValue: 'Unavailable',
            explanation:
              'Embodied carbon estimate is unavailable (missing room geometry or primary material).',
          });
        } else {
          const minC = carbonRow?.minNumericValue ?? optCarbon;
          const maxC = carbonRow?.maxNumericValue ?? optCarbon;
          const normC =
            maxC > minC
              ? 45 + ((maxC - optCarbon) / (maxC - minC)) * 55
              : opt.facade?.primaryMaterial === 'timber'
              ? 95
              : 75;
          const score = Math.round(normC);

          addMatch({
            preferenceId: 'spatial-low-carbon',
            label: 'Spatial Priority: Low Embodied Carbon & Biogenic Materials',
            dimension: 'spatial-priority',
            origin: 'explicit-user',
            confirmationStatus: 'confirmed',
            isHardConstraint: false,
            weight: carbonWeight,
            status: score >= 75 ? 'satisfied' : score >= 55 ? 'partial' : 'unmet',
            rawMatchScore: score,
            weightedContribution: 0,
            measuredOrObservedValue:
              carbonRow?.valuesByOptionId[opt.optionId]?.formattedValue ||
              `${optCarbon} t CO₂e`,
            explanation:
              carbonRow?.valuesByOptionId[opt.optionId]?.explanation ||
              `Estimated A1–A3 upfront carbon is ${optCarbon} t CO₂e.`,
          });
        }
      }

      // 4. Compact Ground Footprint
      const compactWeight = profile.spatialPriorityWeights.compactPlotFootprint;
      if (compactWeight > 0) {
        const covPct = getNumVal(plotCoverageRow, opt.optionId);
        if (covPct === null) {
          addMatch({
            preferenceId: 'spatial-compact-footprint',
            label: 'Spatial Priority: Compact Ground Footprint & Garden Preservation',
            dimension: 'spatial-priority',
            origin: 'explicit-user',
            confirmationStatus: 'confirmed',
            isHardConstraint: false,
            weight: compactWeight,
            status: 'unknown-data',
            rawMatchScore: null,
            weightedContribution: 0,
            measuredOrObservedValue: 'Unavailable',
            explanation: 'Ground plot coverage ratio is unavailable.',
          });
        } else {
          const score = Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, covPct - 25) * 1.2)));
          addMatch({
            preferenceId: 'spatial-compact-footprint',
            label: 'Spatial Priority: Compact Ground Footprint & Garden Preservation',
            dimension: 'spatial-priority',
            origin: 'explicit-user',
            confirmationStatus: 'confirmed',
            isHardConstraint: false,
            weight: compactWeight,
            status: covPct <= 50 ? 'satisfied' : covPct <= 65 ? 'partial' : 'unmet',
            rawMatchScore: score,
            weightedContribution: 0,
            measuredOrObservedValue: `${covPct.toFixed(1)}% plot coverage`,
            explanation: `Ground-floor rooms occupy ${covPct.toFixed(1)}% of the total plot area, leaving ${Math.max(0, 100 - covPct).toFixed(1)}% open site/garden area.`,
          });
        }
      }

      // -----------------------------------------------------------------------
      // COMPUTE AGGREGATE SOFT PREFERENCE MATCH SCORE (WITH MISSING-DATA PENALTY)
      // -----------------------------------------------------------------------
      const activeSoftItems = criterionMatches.filter(
        (m) =>
          !m.isHardConstraint &&
          m.confirmationStatus === 'confirmed' &&
          m.weight > 0
      );

      const totalSoftWeight = activeSoftItems.reduce((s, m) => s + m.weight, 0);
      let availableSoftCount = 0;

      for (const m of activeSoftItems) {
        if (m.rawMatchScore !== null && Number.isFinite(m.rawMatchScore)) {
          availableSoftCount += 1;
          m.weightedContribution =
            totalSoftWeight > 0
              ? roundToStep((m.rawMatchScore * m.weight) / totalSoftWeight, 0.1)
              : 0;
        } else {
          // CRITICAL P32 SECTION 6 FAIRNESS RULE:
          // Missing/unknown data contributes 0 points while keeping its full weight in the denominator
          m.weightedContribution = 0;
        }
      }

      const dataCoveragePercent =
        activeSoftItems.length > 0
          ? roundToStep((availableSoftCount / activeSoftItems.length) * 100, 1)
          : 0;

      const missingDataPenaltyApplied = availableSoftCount < activeSoftItems.length;

      const preferenceMatchScore =
        totalSoftWeight > 0 && availableSoftCount > 0
          ? Math.round(
              activeSoftItems.reduce((s, m) => s + m.weightedContribution, 0)
            )
          : null;

      const hardConstraintsAllMet =
        hardConstraintsViolatedCount === 0 &&
        hardConstraintsUnassessedCount === 0 &&
        hardConstraintsMetCount > 0;

      // Explain trade-offs if option shares baseline geometry
      if (opt.sharesBaselineGeometry) {
        tradeOffsIntroduced.push(
          'Specification Alternative shares the baseline 2D room layout; applying it updates facade/interior finishes without altering room dimensions.'
        );
      }

      // Actionable "What User Can Change" sensitivity guidance
      if (unmetRequirements.length > 0) {
        whatUserCanChangeGuidance.push(
          `Resolve or adjust the ${unmetRequirements.length} unmet requirement(s) (${unmetRequirements[0]}) to improve fit.`
        );
      }
      if (inferredUnconfirmedCount > 0) {
        whatUserCanChangeGuidance.push(
          `Review ${inferredUnconfirmedCount} unconfirmed suggestion(s) in the Preference Editor; confirming or rejecting them will update the personalization match.`
        );
      }
      whatUserCanChangeGuidance.push(
        'Adjust spatial priority weights (e.g., Openness vs. Budget Control vs. Low Carbon) to test how the option ranking responds.'
      );

      // Build human-readable "Why Suggested" explanation
      let whySuggestedExplanation = '';
      if (preferenceMatchScore === null) {
        whySuggestedExplanation = `"${opt.name}" lacks sufficient evaluable data (${dataCoveragePercent}% coverage) to compute a preference match score.`;
      } else if (!hardConstraintsAllMet) {
        whySuggestedExplanation = `"${opt.name}" achieves a ${preferenceMatchScore}/100 soft preference match (${
          satisfiedPreferences.slice(0, 2).join('; ') || 'partial alignment'
        }), but has ${hardConstraintsViolatedCount} hard-constraint conflict(s) and ${hardConstraintsUnassessedCount} unverified hard constraint(s) that must be resolved before adoption.`;
      } else {
        whySuggestedExplanation = `"${opt.name}" satisfies all ${hardConstraintsMetCount} evaluated hard constraints and achieves a ${preferenceMatchScore}/100 preference match, driven by ${
          satisfiedPreferences.slice(0, 3).join('; ') || 'balanced alignment across active priorities'
        }.`;
      }

      const canPreviewAndApply =
        opt.rooms.length > 0 && hardConstraintsViolatedCount === 0;
      const applyBlockedReason =
        opt.rooms.length === 0
          ? 'Cannot apply an option with zero placed rooms.'
          : hardConstraintsViolatedCount > 0
          ? `Option has ${hardConstraintsViolatedCount} hard-constraint conflict(s). Review the preview diagnostics before applying.`
          : undefined;

      return {
        optionId: opt.optionId,
        optionName: opt.name,
        optionKind: opt.kind,
        persistenceState: opt.persistenceState,
        sharesBaselineGeometry: opt.sharesBaselineGeometry,
        preferenceMatchScore,
        hardConstraintsAllMet,
        hardConstraintsMetCount,
        hardConstraintsViolatedCount,
        hardConstraintsUnassessedCount,
        dataCoveragePercent,
        missingDataPenaltyApplied,
        evidenceBasis:
          dataCoveragePercent === 100 ? 'measured-and-deterministic' : 'partial-data',
        criterionMatches,
        satisfiedPreferences,
        unmetRequirements,
        tradeOffsIntroduced,
        assumptionsAndMissingInputs,
        whySuggestedExplanation,
        whatUserCanChangeGuidance,
        canPreviewAndApply,
        applyBlockedReason,
      };
    }
  );

  // Sort recommendations:
  // 1. Options that satisfy all hard constraints come first! Hard constraints are never overridden by a higher soft preference score.
  // 2. Then by preferenceMatchScore descending.
  recommendations.sort((a, b) => {
    if (a.hardConstraintsAllMet !== b.hardConstraintsAllMet) {
      return a.hardConstraintsAllMet ? -1 : 1;
    }
    if (a.hardConstraintsViolatedCount !== b.hardConstraintsViolatedCount) {
      return a.hardConstraintsViolatedCount - b.hardConstraintsViolatedCount;
    }
    return (b.preferenceMatchScore ?? -1) - (a.preferenceMatchScore ?? -1);
  });

  // Ranking sensitivity & tie analysis
  const scoredRecs = recommendations.filter((r) => r.preferenceMatchScore !== null);
  let isRankingTie = false;
  let isRankingWeightSensitive = false;
  let rankingSensitivityExplanation = '';

  if (scoredRecs.length < 2) {
    rankingSensitivityExplanation =
      'Fewer than two options have evaluable preference scores; inspect the individual match details directly.';
  } else {
    const first = scoredRecs[0];
    const second = scoredRecs[1];
    const gap = (first.preferenceMatchScore || 0) - (second.preferenceMatchScore || 0);
    if (gap === 0 && first.hardConstraintsAllMet === second.hardConstraintsAllMet) {
      isRankingTie = true;
      isRankingWeightSensitive = true;
      rankingSensitivityExplanation = `Tie detected: "${first.optionName}" and "${second.optionName}" are tied at ${first.preferenceMatchScore}/100. Changing any active preference weight will break the tie.`;
    } else if (gap <= 5 && first.hardConstraintsAllMet === second.hardConstraintsAllMet) {
      isRankingWeightSensitive = true;
      rankingSensitivityExplanation = `Ranking is sensitive to subjective weights: "${first.optionName}" leads "${second.optionName}" by only ${gap} point(s) (${first.preferenceMatchScore} vs ${second.preferenceMatchScore}). Adjusting priority sliders by ±15–20 pts can reverse the top recommendation.`;
    } else {
      rankingSensitivityExplanation = `"${first.optionName}" leads "${second.optionName}" (${first.preferenceMatchScore}/100 vs ${second.preferenceMatchScore}/100). Hard-constraint compliance is enforced prior to soft preference ranking.`;
    }
  }

  return {
    evaluationId: `p32-eval-${project.id}-${Date.now()}`,
    engineVersion: P32_PERSONALIZATION_ENGINE_VERSION,
    projectId: project.id,
    projectName: project.name,
    evaluatedAt: new Date().toISOString(),
    requestSequenceId: options?.requestSequenceId ?? profile.requestSequenceId ?? 1,
    sourceFingerprint: currentFingerprint,
    isStale,
    staleReason,
    profile,
    explicitConfirmedCount,
    importedFactsCount,
    inferredUnconfirmedCount,
    unknownPreferencesCount,
    conflicts,
    recommendations,
    isRankingTie,
    isRankingWeightSensitive,
    rankingSensitivityExplanation,
    p30CompatibilitySummary: {
      hasInterpretedBrief: p31Result.p30BriefSummary.hasP30InterpretedBrief,
      confirmedRequirementsImported:
        p31Result.p30BriefSummary.confirmedRequirementsCount,
      unconfirmedInferencesHeldForReview:
        p31Result.p30BriefSummary.unconfirmedAssumptionsCount,
      unresolvedBriefConflicts:
        p31Result.p30BriefSummary.unresolvedBriefConflictsCount,
    },
    p31CompatibilitySummary: {
      p31EngineUsed: true,
      p31CalculationVersion: P31_COMPARISON_CALCULATION_VERSION,
      comparedOptionsCount: comparableOptions.length,
    },
    unsupportedRoadmapCapabilities: [
      {
        roadmapId: 'P33',
        title: 'Furniture & Circulation Intelligence',
        reason:
          'Detailed furniture placement and doorway swing paths are reserved for P33 and are not fabricated in P32.',
      },
      {
        roadmapId: 'P34',
        title: 'Universal Accessibility Review',
        reason:
          'Step-free routing and wheelchair turning circle verification belong to P34.',
      },
      {
        roadmapId: 'P35–P38',
        title: 'Climate, Acoustic, Ventilation & Daylight Analyzers',
        reason:
          'Specialized environmental simulation engines belong to P35–P38.',
      },
    ],
    complianceAndPrivacyDisclaimer: P32_COMPLIANCE_AND_PRIVACY_DISCLAIMER,
  };
}

/**
 * Stale-response guard so an older personalization calculation never overwrites a newer request.
 */
export function shouldApplyPersonalizationResult(
  currentResult: PersonalizationEvaluationResult | null | undefined,
  incomingResult: PersonalizationEvaluationResult
): boolean {
  if (!currentResult) return true;
  return incomingResult.requestSequenceId >= currentResult.requestSequenceId;
}

/**
 * Stage E (Part 1): Builds a non-destructive preview of applying a recommended option,
 * validating the resulting 2D geometry and Living Constraint Graph before any state change.
 */
export function buildPersonalizationPreview(
  project: Project,
  optionId: string
): PersonalizationPreviewDiff | null {
  const options = extractComparableOptions(project);
  const target = options.find((o) => o.optionId === optionId);
  if (!target) return null;

  const validRooms = (target.rooms || []).filter(
    (r) => r && typeof r.width === 'number' && typeof r.length === 'number' && r.width > 0 && r.length > 0
  );

  // Validate 2D geometry on proposed rooms
  const floorLevels = Array.from(
    new Set(validRooms.map((r) => r.floorLevel || 1))
  );
  let overlapCount = 0;
  for (const fl of floorLevels) {
    const roomsOnFloor = validRooms.filter((r) => (r.floorLevel || 1) === fl);
    const val = validateFloorPlan(
      {
        version: 1,
        floorNumber: fl,
        rooms: roomsOnFloor as any,
        walls: [],
        openings: [],
        updatedAt: '',
      },
      target.plotWidth,
      target.plotLength,
      target.unit
    );
    overlapCount += val.overlapViolations.length;
  }

  const boundaryVal = validateFloorPlan(
    {
      version: 1,
      floorNumber: 1,
      rooms: validRooms as any,
      walls: [],
      openings: [],
      updatedAt: '',
    },
    target.plotWidth,
    target.plotLength,
    target.unit
  );
  const boundaryViolationCount = boundaryVal.boundaryViolations.length;

  // Also compute baseline overlaps/boundary overflows so pre-existing baseline geometry issues are distinguished from newly introduced ones
  const baselineRooms = (project.floorPlan?.rooms || []).filter(
    (r) => r && typeof r.width === 'number' && typeof r.length === 'number' && r.width > 0 && r.length > 0
  );
  const baselineFloorLevels = Array.from(
    new Set(baselineRooms.map((r) => r.floorLevel || 1))
  );
  let baselineOverlapCount = 0;
  for (const fl of baselineFloorLevels) {
    const roomsOnFloor = baselineRooms.filter((r) => (r.floorLevel || 1) === fl);
    const val = validateFloorPlan(
      {
        version: 1,
        floorNumber: fl,
        rooms: roomsOnFloor as any,
        walls: [],
        openings: [],
        updatedAt: '',
      },
      project.plotWidth,
      project.plotLength,
      project.unit
    );
    baselineOverlapCount += val.overlapViolations.length;
  }
  const baselineBoundaryVal = validateFloorPlan(
    {
      version: 1,
      floorNumber: 1,
      rooms: baselineRooms as any,
      walls: [],
      openings: [],
      updatedAt: '',
    },
    project.plotWidth,
    project.plotLength,
    project.unit
  );
  const baselineBoundaryViolationCount = baselineBoundaryVal.boundaryViolations.length;

  // Evaluate Living Constraint Graph on hypothetical state
  const previewProject: Project = {
    ...project,
    floors: target.floors,
    budget: target.budget,
    floorPlan: {
      ...(project.floorPlan || {}),
      rooms: validRooms.map((r) => ({ ...r })),
    },
  };
  const cg = evaluateConstraintGraph(previewProject);

  const safetyBlockReasons: string[] = [];
  if (validRooms.length === 0) {
    safetyBlockReasons.push(
      'Target option contains zero valid placed rooms; applying it would erase the project floor plan.'
    );
  }
  if (overlapCount > baselineOverlapCount) {
    safetyBlockReasons.push(
      `Target option introduces ${overlapCount - baselineOverlapCount} new same-floor room overlap(s) (${overlapCount} total).`
    );
  }
  if (boundaryViolationCount > baselineBoundaryViolationCount) {
    safetyBlockReasons.push(
      `Target option introduces ${boundaryViolationCount - baselineBoundaryViolationCount} new plot boundary overflow(s) (${boundaryViolationCount} total).`
    );
  }

  const activeAlt =
    project.designAlternatives?.find((a) => a.id === project.activeAlternativeId) ||
    project.designAlternatives?.[0];

  const parameterChanges = [
    {
      field: 'floors',
      label: 'Building Storeys',
      beforeValue: `${project.floors} storey(s)`,
      afterValue: `${target.floors} storey(s)`,
      changed: project.floors !== target.floors,
    },
    {
      field: 'roomsCount',
      label: 'Placed 2D Floor-Plan Rooms',
      beforeValue: `${project.floorPlan?.rooms?.length || 0} rooms`,
      afterValue: `${validRooms.length} rooms`,
      changed: (project.floorPlan?.rooms?.length || 0) !== validRooms.length || !target.sharesBaselineGeometry,
    },
    {
      field: 'budget',
      label: 'Target Budget',
      beforeValue:
        project.budget > 0
          ? formatCurrency(project.budget, project.currency)
          : 'Unspecified',
      afterValue:
        target.budget > 0
          ? formatCurrency(target.budget, target.currency)
          : 'Unspecified',
      changed: project.budget !== target.budget,
    },
    {
      field: 'facadeStyle',
      label: 'Facade Style & Primary Material',
      beforeValue: activeAlt?.facade
        ? `${activeAlt.facade.style} · ${activeAlt.facade.primaryMaterial} (${activeAlt.facade.costTier})`
        : 'Default',
      afterValue: target.facade
        ? `${target.facade.style} · ${target.facade.primaryMaterial} (${target.facade.costTier})`
        : 'Default',
      changed:
        activeAlt?.facade?.style !== target.facade?.style ||
        activeAlt?.facade?.primaryMaterial !== target.facade?.primaryMaterial ||
        activeAlt?.facade?.costTier !== target.facade?.costTier,
    },
  ];

  const validationMessages: string[] = [];
  if (overlapCount === 0 && boundaryViolationCount === 0 && validRooms.length > 0) {
    validationMessages.push(
      `Geometry verified: ${validRooms.length} placed rooms with 0 overlaps and 0 boundary overflows.`
    );
  }
  validationMessages.push(
    `Living Constraint Graph: ${cg.summary.passing} passing, ${cg.summary.conflicts} conflict(s).`
  );

  return {
    optionId: target.optionId,
    optionName: target.name,
    optionKind: target.kind,
    isSafeToApply: safetyBlockReasons.length === 0,
    safetyBlockReasons,
    parameterChanges,
    proposedRooms: validRooms.map((r) => ({ ...r })),
    proposedFloors: target.floors,
    proposedBudget: target.budget,
    proposedFacade: target.facade ? { ...target.facade } : undefined,
    proposedActiveAlternativeId:
      target.kind === 'design-alternative' ? target.sourceId : project.activeAlternativeId,
    proposedActiveScenarioId:
      target.kind === 'design-scenario' ? target.sourceId : project.activeScenarioId,
    geometryValidation: {
      overlapCount,
      boundaryViolationCount,
      constraintConflictCount: cg.summary.conflicts,
      isValid: safetyBlockReasons.length === 0,
      validationMessages,
    },
  };
}

/**
 * Stage E (Part 2): Safely and atomically applies a previewed option to a clone of the Project
 * after creating an automatic pre-application safety checkpoint via `createProjectSnapshot`.
 * Never mutates the original `project` object in place.
 */
export function applyPersonalizedOptionSafely(
  project: Project,
  profile: ProjectPersonalizationProfile,
  optionId: string
): {
  success: boolean;
  error?: string;
  preview?: PersonalizationPreviewDiff;
  safetySnapshot?: ProjectSnapshot;
  updatedProject?: Project;
} {
  const preview = buildPersonalizationPreview(project, optionId);
  if (!preview) {
    return {
      success: false,
      error: `Option "${optionId}" was not found in the project.`,
    };
  }

  if (!preview.isSafeToApply) {
    return {
      success: false,
      preview,
      error: `Cannot safely apply "${preview.optionName}": ${preview.safetyBlockReasons.join(
        ' '
      )}`,
    };
  }

  // 1. Create automatic safety checkpoint before applying any changes
  const safetySnapshot = createProjectSnapshot(project, {
    trigger: 'auto-checkpoint',
    label: `Pre-P32 Personalization Checkpoint (Before ${preview.optionName})`,
    description: `Automated safety snapshot created by P32 Adaptive Design Personalization prior to applying "${preview.optionName}" (${preview.optionId}).`,
    versionTag: `p32-safe-${Date.now().toString(36).slice(-4)}`,
  });

  // 2. Clone project and apply changes atomically while preserving all unrelated project fields
  const now = new Date().toISOString();
  const clonedProject: Project = JSON.parse(JSON.stringify(project));

  clonedProject.floors = preview.proposedFloors;
  clonedProject.budget = preview.proposedBudget;
  clonedProject.floorPlan = {
    ...(clonedProject.floorPlan || {}),
    rooms: preview.proposedRooms.map((r) => ({ ...r })),
  };

  if (preview.optionKind === 'design-alternative' && preview.proposedActiveAlternativeId) {
    clonedProject.activeAlternativeId = preview.proposedActiveAlternativeId;
  } else if (preview.optionKind === 'design-scenario' && preview.proposedActiveScenarioId) {
    clonedProject.activeScenarioId = preview.proposedActiveScenarioId;
    // Also sync facade onto active designAlternative if present
    if (
      preview.proposedFacade &&
      Array.isArray(clonedProject.designAlternatives) &&
      clonedProject.designAlternatives.length > 0
    ) {
      const targetAltIdx = clonedProject.designAlternatives.findIndex(
        (a) => a.id === clonedProject.activeAlternativeId
      );
      const idx = targetAltIdx >= 0 ? targetAltIdx : 0;
      clonedProject.designAlternatives[idx] = {
        ...clonedProject.designAlternatives[idx],
        facade: { ...preview.proposedFacade },
      };
    }
  }

  const nextFp = computePersonalizationSourceFingerprint(clonedProject, profile);
  clonedProject.designPersonalization = {
    ...profile,
    lastEvaluatedSourceFingerprint: nextFp,
    updatedAt: now,
  };
  clonedProject.updatedAt = now;

  return {
    success: true,
    preview,
    safetySnapshot,
    updatedProject: clonedProject,
  };
}

/**
 * Stage E (Part 3): Rolls back a personalization application using the safety checkpoint
 * via the existing `executeSafeRestore` mechanism in `versioningService.ts`.
 */
export function rollbackPersonalizationToSnapshot(
  currentProject: Project,
  safetySnapshot: ProjectSnapshot
): {
  success: boolean;
  restoredProject?: Project;
  error?: string;
} {
  const res = executeSafeRestore(currentProject, safetySnapshot);
  if (!res.success || !res.restoredProject) {
    return {
      success: false,
      error:
        res.validation.errors.join('; ') ||
        'Failed to restore pre-personalization safety snapshot.',
    };
  }
  return {
    success: true,
    restoredProject: res.restoredProject,
  };
}
