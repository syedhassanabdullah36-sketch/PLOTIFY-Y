/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P39 — Biophilic & Indoor Plantscape Planner Service
 * Account A | Locked Roadmap: P39 of P30–P40
 *
 * Deterministic indoor plantscape and nature-inspired interior planning engine:
 * - Provenance-tagged catalog of living plants and non-living biophilic features
 * - Room & placement suitability evaluation using P38 daylight metrics (read-only),
 *   room use, maintenance preferences, and toxicity constraints
 * - Exact 2D spatial coordination in project units (feet or metres) against room
 *   bounds, P33 furniture & doors/walkways, P34 accessibility clearances, and P37
 *   ventilation openings
 * - Vertical plant-wall support, irrigation, drainage & moisture constraint screening
 * - Deterministic care & maintenance planner with conditional variability disclosures
 * - Side-by-side scenario comparison with explicit unquantified wellbeing/VOC/energy
 *   guardrails
 * - Non-destructive preview, atomic apply with pre-apply snapshot, and rollback
 */

import { FloorPlanRoom, MeasurementUnit, Project } from '../types/project';
import {
  BiophilicCatalogItem,
  BiophilicMaintenanceSettings,
  BiophilicMaintenanceTask,
  BiophilicPlacementConflict,
  BiophilicPlacementRecord,
  BiophilicPlannerProjectReport,
  BiophilicProposalPreviewDiff,
  BiophilicRecommendation,
  BiophilicScenario,
  BiophilicScenarioComparisonResult,
  BiophilicSuitabilityStatus,
  P39_BIOPHILIC_PLANNER_ENGINE_VERSION,
  P39_BIOPHILIC_SCHEMA_VERSION,
  P39Completeness,
  P39OptionBiophilicComparisonSummary,
  P39Provenance,
  PlacementSuitabilityEvaluation,
  ProjectBiophilicPlannerData,
  RoomBiophilicPlanEvaluation,
} from '../types/biophilicPlanner';
import { ensureProjectFurnitureLayoutData } from './furnitureIntelligenceService';
import { evaluateUniversalAccessibility } from './universalAccessibilityService';
import { initializeProjectMaterialAdvisorData } from './climateMaterialAdvisorService';
import { initializeProjectAcousticPlannerData } from './acousticComfortService';
import { initializeProjectNaturalVentilationData } from './naturalVentilationService';
import { evaluateProjectDaylightComfort } from './daylightComfortService';
import { initializePersonalizationProfile } from './designPersonalizationService';
import { extractComparableOptions } from './designComparisonService';
import {
  createProjectSnapshot,
  executeSafeRestore,
  getProjectSnapshots,
} from './versioningService';

export {
  P39_BIOPHILIC_PLANNER_ENGINE_VERSION,
  P39_BIOPHILIC_SCHEMA_VERSION,
};

export const P39_PROFESSIONAL_DISCLAIMER =
  'Biophilic & Indoor Plantscape Planner (P39) evaluates preliminary indoor plant and nature-inspired feature placement using room geometry, P38 analytical daylight estimates, P33 circulation clearances, P34 accessibility screening rules, P37 ventilation opening locations, and horticultural reference ranges. P38 analytical daylight estimates do NOT guarantee plant survival or growth. P39 does NOT certify structural load capacity, waterproofing compliance, statutory accessibility compliance, indoor air quality / VOC removal, or occupant health/productivity outcomes.';

const METRES_PER_FOOT = 0.3048;
const FEET_PER_METRE = 1 / 0.3048;
const SQ_METRES_PER_SQ_FOOT = 0.09290304;

/**
 * In-memory snapshot store for headless Node / CLI verification and fast rollback.
 */
const memoryBiophilicSnapshots = new Map<
  string,
  {
    biophilicPlanner: ProjectBiophilicPlannerData | undefined;
    fullProjectClone: Project;
  }
>();

export function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

export function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

/**
 * Converts a length from metres to the target project `MeasurementUnit`.
 */
export function metresToProjectUnit(
  metres: number,
  unit: MeasurementUnit
): number {
  if (!Number.isFinite(metres)) return 0;
  return unit === 'feet' ? round2(metres * FEET_PER_METRE) : round2(metres);
}

/**
 * Converts a length from the project `MeasurementUnit` to SI metres.
 */
export function projectUnitToMetres(
  value: number | null | undefined,
  unit: MeasurementUnit
): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return unit === 'feet' ? round3(value * METRES_PER_FOOT) : round3(value);
}

/**
 * Converts an area in squared project units (`sq ft` or `m²`) to `m²`.
 */
export function projectAreaToSqMetres(
  areaInUnitSq: number,
  unit: MeasurementUnit
): number {
  if (!Number.isFinite(areaInUnitSq) || areaInUnitSq <= 0) return 0;
  return unit === 'feet'
    ? round3(areaInUnitSq * SQ_METRES_PER_SQ_FOOT)
    : round3(areaInUnitSq);
}

/**
 * Built-in Provenance-Tagged Plant & Biophilic Element Catalog per P39 Section 3.A.
 */
export const P39_DEFAULT_CATALOG: BiophilicCatalogItem[] = [
  {
    catalogId: 'plant-aspidistra-elatior',
    displayName: 'Cast-Iron Plant',
    scientificName: 'Aspidistra elatior',
    isLivingPlant: true,
    category: 'living-floor-plant',
    growthForm: 'arching-rosette-or-clumping',
    description:
      'Resilient upright foliage plant tolerant of low indirect daylight and moderate indoor humidity fluctuations; suitable for bedrooms, corridors, and studies.',
    defaultContainerWidthMetres: 0.38,
    defaultContainerDepthMetres: 0.38,
    defaultContainerHeightMetres: 0.75,
    expectedMatureWidthRangeMetres: { min: 0.55, max: 0.85 },
    expectedMatureDepthRangeMetres: { min: 0.55, max: 0.85 },
    expectedMatureHeightRangeMetres: { min: 0.65, max: 0.95 },
    lightRequirementBand: 'low-indirect-tolerant',
    referenceDaylightFactorMinPercent: 0.5,
    referenceIlluminanceRangeLux: { min: 75, max: 800 },
    directSunTolerance: 'sensitive-to-intense-direct-sun',
    wateringDemand: 'low-drought-tolerant',
    maintenanceComplexity: 'low',
    estimatedMonthlyCareMinutesPerUnit: 15,
    preferredRelativeHumidityRangePercent: { min: 30, max: 70 },
    preferredTemperatureRangeCelsius: { min: 10, max: 27 },
    soilAndDrainageRequirement:
      'Well-draining peat-free potting mix; container with drainage hole and waterproof saucer or liner.',
    containerRequirement: 'Floor planter min. 350–400 mm diameter with saucer.',
    toxicityStatus: 'verified-non-toxic-pets-and-humans',
    toxicityDetails:
      'Listed as non-toxic to dogs, cats, and humans in reference botanical/toxicology guides (ASPCA / RHS).',
    provenance: 'reference_assumption',
    completeness: 'complete',
    missingInformationNotes: [],
    evidenceSource: {
      sourceId: 'src-rhs-aspidistra-2024',
      publisher: 'Royal Horticultural Society (RHS) & ASPCA Animal Poison Control Reference',
      title: 'Aspidistra elatior Indoor Cultivation & Pet Safety Profile',
      referenceUrlOrId: 'RHS-PlantFinder-Aspidistra-elatior',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'high-reference-handbook',
      scopeAndLimitationsNote:
        'Reference indoor horticulture range; actual growth depends on local microclimate, substrate drainage, and acclimation.',
    },
  },
  {
    catalogId: 'plant-zamioculcas-zamiifolia',
    displayName: 'ZZ Plant (Zanzibar Gem)',
    scientificName: 'Zamioculcas zamiifolia',
    isLivingPlant: true,
    category: 'living-floor-plant',
    growthForm: 'succulent-or-architectural-upright',
    description:
      'Rhizomatous drought-tolerant indoor foliage plant suited to low-to-medium indirect light; contains insoluble calcium oxalates if chewed.',
    defaultContainerWidthMetres: 0.36,
    defaultContainerDepthMetres: 0.36,
    defaultContainerHeightMetres: 0.70,
    expectedMatureWidthRangeMetres: { min: 0.50, max: 0.80 },
    expectedMatureDepthRangeMetres: { min: 0.50, max: 0.80 },
    expectedMatureHeightRangeMetres: { min: 0.60, max: 0.95 },
    lightRequirementBand: 'low-indirect-tolerant',
    referenceDaylightFactorMinPercent: 0.5,
    referenceIlluminanceRangeLux: { min: 80, max: 1200 },
    directSunTolerance: 'tolerates-gentle-morning-or-filtered-sun',
    wateringDemand: 'low-drought-tolerant',
    maintenanceComplexity: 'low',
    estimatedMonthlyCareMinutesPerUnit: 12,
    preferredRelativeHumidityRangePercent: { min: 25, max: 65 },
    preferredTemperatureRangeCelsius: { min: 15, max: 29 },
    soilAndDrainageRequirement:
      'Fast-draining sandy/aroid substrate; allow top 50–75% of substrate to dry between waterings to prevent rhizome rot.',
    containerRequirement: 'Floor or credenza planter with drainage hole and saucer.',
    toxicityStatus: 'verified-toxic-if-ingested-pets-or-humans',
    toxicityDetails:
      'Contains calcium oxalate crystals; ingestion or sap contact can cause oral irritation and gastrointestinal distress in pets and children.',
    provenance: 'reference_assumption',
    completeness: 'complete',
    missingInformationNotes: [],
    evidenceSource: {
      sourceId: 'src-hort-zamioculcas-2024',
      publisher: 'RHS / North Carolina State Extension Gardener Plant Toolbox',
      title: 'Zamioculcas zamiifolia Indoor Monograph',
      referenceUrlOrId: 'NCSU-PlantToolbox-Zamioculcas-zamiifolia',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'high-reference-handbook',
      scopeAndLimitationsNote:
        'Toxicity warning verified via botanical extension literature; keep out of reach in pet/child zones.',
    },
  },
  {
    catalogId: 'plant-chamaedorea-elegans',
    displayName: 'Parlour Palm',
    scientificName: 'Chamaedorea elegans',
    isLivingPlant: true,
    category: 'living-floor-plant',
    growthForm: 'upright-foliage-tree-or-shrub',
    description:
      'Compact indoor palm providing soft biophilic canopy screening in medium indirect daylight; non-toxic to pets and humans.',
    defaultContainerWidthMetres: 0.42,
    defaultContainerDepthMetres: 0.42,
    defaultContainerHeightMetres: 1.05,
    expectedMatureWidthRangeMetres: { min: 0.65, max: 1.05 },
    expectedMatureDepthRangeMetres: { min: 0.65, max: 1.05 },
    expectedMatureHeightRangeMetres: { min: 0.90, max: 1.50 },
    lightRequirementBand: 'medium-bright-indirect',
    referenceDaylightFactorMinPercent: 1.2,
    referenceIlluminanceRangeLux: { min: 250, max: 1800 },
    directSunTolerance: 'sensitive-to-intense-direct-sun',
    wateringDemand: 'moderate-even-moisture',
    maintenanceComplexity: 'moderate',
    estimatedMonthlyCareMinutesPerUnit: 25,
    preferredRelativeHumidityRangePercent: { min: 40, max: 75 },
    preferredTemperatureRangeCelsius: { min: 16, max: 27 },
    soilAndDrainageRequirement:
      'Aerated indoor palm mix; avoid waterlogging and prolonged bone-dry intervals.',
    containerRequirement: 'Freestanding floor planter 400–450 mm diameter with drip liner.',
    toxicityStatus: 'verified-non-toxic-pets-and-humans',
    toxicityDetails:
      'Verified non-toxic to cats, dogs, and humans per ASPCA and RHS reference lists.',
    provenance: 'reference_assumption',
    completeness: 'complete',
    missingInformationNotes: [],
    evidenceSource: {
      sourceId: 'src-rhs-chamaedorea-2024',
      publisher: 'Royal Horticultural Society (RHS) & ASPCA',
      title: 'Chamaedorea elegans Indoor Care & Safety Profile',
      referenceUrlOrId: 'RHS-Chamaedorea-elegans',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'high-reference-handbook',
      scopeAndLimitationsNote:
        'Leaf tips may brown under very low relative humidity (<35% RH) or direct afternoon solar beams.',
    },
  },
  {
    catalogId: 'plant-calathea-orbifolia',
    displayName: 'Orbifolia Prayer Plant',
    scientificName: 'Goeppertia orbifolia',
    isLivingPlant: true,
    category: 'living-tabletop-or-shelf-plant',
    growthForm: 'arching-rosette-or-clumping',
    description:
      'Patterned broad-leaf tabletop or low-planter specimen requiring filtered indirect light, consistent moisture, and elevated humidity.',
    defaultContainerWidthMetres: 0.28,
    defaultContainerDepthMetres: 0.28,
    defaultContainerHeightMetres: 0.50,
    expectedMatureWidthRangeMetres: { min: 0.45, max: 0.65 },
    expectedMatureDepthRangeMetres: { min: 0.45, max: 0.65 },
    expectedMatureHeightRangeMetres: { min: 0.45, max: 0.65 },
    lightRequirementBand: 'medium-bright-indirect',
    referenceDaylightFactorMinPercent: 1.2,
    referenceIlluminanceRangeLux: { min: 250, max: 1500 },
    directSunTolerance: 'sensitive-to-intense-direct-sun',
    wateringDemand: 'moderate-even-moisture',
    maintenanceComplexity: 'moderate',
    estimatedMonthlyCareMinutesPerUnit: 30,
    preferredRelativeHumidityRangePercent: { min: 50, max: 80 },
    preferredTemperatureRangeCelsius: { min: 18, max: 26 },
    soilAndDrainageRequirement:
      'Moisture-retentive but airy organic substrate; sensitive to high mineral/fluoride tap water and cold drafts.',
    containerRequirement: 'Tabletop or low pedestal planter 250–300 mm diameter.',
    toxicityStatus: 'verified-non-toxic-pets-and-humans',
    toxicityDetails:
      'Marantaceae family member verified non-toxic to dogs, cats, and humans (ASPCA).',
    provenance: 'reference_assumption',
    completeness: 'complete',
    missingInformationNotes: [],
    evidenceSource: {
      sourceId: 'src-ncsu-goeppertia-2024',
      publisher: 'NC State Extension & ASPCA',
      title: 'Goeppertia (Calathea) orbifolia Profile',
      referenceUrlOrId: 'NCSU-Goeppertia-orbifolia',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'high-reference-handbook',
      scopeAndLimitationsNote:
        'Requires protection from direct solar beam glare zones and dry HVAC supply drafts.',
    },
  },
  {
    catalogId: 'plant-ficus-lyrata',
    displayName: 'Fiddle-Leaf Fig (Compact Standard)',
    scientificName: 'Ficus lyrata',
    isLivingPlant: true,
    category: 'living-floor-plant',
    growthForm: 'upright-foliage-tree-or-shrub',
    description:
      'Architectural broad-leaf indoor tree requiring high bright daylight (minimum 2.0% Daylight Factor proxy) and generous vertical/horizontal clearance.',
    defaultContainerWidthMetres: 0.50,
    defaultContainerDepthMetres: 0.50,
    defaultContainerHeightMetres: 1.65,
    expectedMatureWidthRangeMetres: { min: 0.90, max: 1.35 },
    expectedMatureDepthRangeMetres: { min: 0.90, max: 1.35 },
    expectedMatureHeightRangeMetres: { min: 1.60, max: 2.40 },
    lightRequirementBand: 'high-bright-with-some-direct',
    referenceDaylightFactorMinPercent: 2.0,
    referenceIlluminanceRangeLux: { min: 600, max: 3500 },
    directSunTolerance: 'tolerates-gentle-morning-or-filtered-sun',
    wateringDemand: 'moderate-even-moisture',
    maintenanceComplexity: 'moderate',
    estimatedMonthlyCareMinutesPerUnit: 35,
    preferredRelativeHumidityRangePercent: { min: 40, max: 70 },
    preferredTemperatureRangeCelsius: { min: 16, max: 28 },
    soilAndDrainageRequirement:
      'Structured bark-amended indoor tree substrate with positive drainage; sensitive to sudden relocation or low-light leaf drop.',
    containerRequirement: 'Weighted floor planter 450–550 mm diameter with protective floor pad.',
    toxicityStatus: 'verified-mild-irritant-sap-or-oxalate',
    toxicityDetails:
      'Latex sap and foliage contain proteolytic enzymes and psoralens irritating to skin, eyes, and pet/human GI tracts if ingested.',
    provenance: 'reference_assumption',
    completeness: 'complete',
    missingInformationNotes: [],
    evidenceSource: {
      sourceId: 'src-rhs-ficus-lyrata-2024',
      publisher: 'RHS & University of Florida IFAS Extension',
      title: 'Ficus spp. Interiorscape Light & Acclimation Guidelines',
      referenceUrlOrId: 'UF-IFAS-Ficus-Interiorscape',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'high-reference-handbook',
      scopeAndLimitationsNote:
        'Unsuitable for deep interior zones with <1.8–2.0% Daylight Factor unless dedicated horticultural lighting is installed.',
    },
  },
  {
    catalogId: 'plant-epipremnum-aureum',
    displayName: 'Golden Pothos (Trailing / Shelf Vine)',
    scientificName: 'Epipremnum aureum',
    isLivingPlant: true,
    category: 'living-hanging-or-trailing-plant',
    growthForm: 'trailing-or-climbing-vine',
    description:
      'Adaptable trailing vine for elevated shelves, credenzas, or overhead planters; tolerant of low-to-medium indirect light.',
    defaultContainerWidthMetres: 0.26,
    defaultContainerDepthMetres: 0.26,
    defaultContainerHeightMetres: 0.45,
    expectedMatureWidthRangeMetres: { min: 0.35, max: 0.60 },
    expectedMatureDepthRangeMetres: { min: 0.35, max: 0.60 },
    expectedMatureHeightRangeMetres: { min: 0.40, max: 1.20 },
    lightRequirementBand: 'low-indirect-tolerant',
    referenceDaylightFactorMinPercent: 0.6,
    referenceIlluminanceRangeLux: { min: 100, max: 1500 },
    directSunTolerance: 'sensitive-to-intense-direct-sun',
    wateringDemand: 'low-drought-tolerant',
    maintenanceComplexity: 'low',
    estimatedMonthlyCareMinutesPerUnit: 18,
    preferredRelativeHumidityRangePercent: { min: 30, max: 75 },
    preferredTemperatureRangeCelsius: { min: 15, max: 29 },
    soilAndDrainageRequirement: 'Standard well-draining indoor potting substrate.',
    containerRequirement: 'Elevated shelf pot or hanging basket with integral drip reservoir.',
    toxicityStatus: 'verified-toxic-if-ingested-pets-or-humans',
    toxicityDetails:
      'Insoluble calcium oxalates cause oral irritation and swelling if chewed by cats, dogs, or children (ASPCA).',
    provenance: 'reference_assumption',
    completeness: 'complete',
    missingInformationNotes: [],
    evidenceSource: {
      sourceId: 'src-aspca-epipremnum-2024',
      publisher: 'ASPCA & UF IFAS Extension',
      title: 'Epipremnum aureum Interiorscape & Toxicity Reference',
      referenceUrlOrId: 'ASPCA-Epipremnum-aureum',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'high-reference-handbook',
      scopeAndLimitationsNote: 'Periodic pruning required to keep trailing stems clear of walkways.',
    },
  },
  {
    catalogId: 'plant-cluster-trio-planter',
    displayName: 'Pet-Safe Biophilic Planter Trough (Palm + Cast-Iron + Spider Plant)',
    scientificName: 'Chamaedorea elegans / Aspidistra elatior / Chlorophytum comosum',
    isLivingPlant: true,
    category: 'living-grouped-planter-cluster',
    growthForm: 'arching-rosette-or-clumping',
    description:
      'Linear grouped planter trough combining three verified pet-safe species for room zoning and visual biophilic framing.',
    defaultContainerWidthMetres: 1.10,
    defaultContainerDepthMetres: 0.38,
    defaultContainerHeightMetres: 0.90,
    expectedMatureWidthRangeMetres: { min: 1.20, max: 1.40 },
    expectedMatureDepthRangeMetres: { min: 0.50, max: 0.65 },
    expectedMatureHeightRangeMetres: { min: 0.85, max: 1.15 },
    lightRequirementBand: 'medium-bright-indirect',
    referenceDaylightFactorMinPercent: 1.0,
    referenceIlluminanceRangeLux: { min: 200, max: 1800 },
    directSunTolerance: 'tolerates-gentle-morning-or-filtered-sun',
    wateringDemand: 'moderate-even-moisture',
    maintenanceComplexity: 'moderate',
    estimatedMonthlyCareMinutesPerUnit: 35,
    preferredRelativeHumidityRangePercent: { min: 35, max: 70 },
    preferredTemperatureRangeCelsius: { min: 14, max: 27 },
    soilAndDrainageRequirement:
      'Sub-irrigated linear trough with internal water level gauge and overflow liner.',
    containerRequirement: 'Linear architectural trough (1100 mm × 380 mm) with waterproof liner.',
    toxicityStatus: 'verified-non-toxic-pets-and-humans',
    toxicityDetails:
      'All three constituent species are listed as non-toxic to dogs, cats, and humans (ASPCA).',
    provenance: 'reference_assumption',
    completeness: 'complete',
    missingInformationNotes: [],
    evidenceSource: {
      sourceId: 'src-rhs-trough-group-2024',
      publisher: 'RHS / Interior Landscape Reference Guide',
      title: 'Multi-Species Sub-Irrigated Planter Trough Specification',
      referenceUrlOrId: 'RHS-Interior-Trough-2024',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'moderate-horticultural-guide',
      scopeAndLimitationsNote: 'Verify floor finish moisture protection beneath linear trough.',
    },
  },
  {
    catalogId: 'plant-vertical-living-wall-modular',
    displayName: 'Modular Vertical Living Wall System (Irrigated Concept)',
    scientificName: 'Philodendron hederaceum / Nephrolepis exaltata / Peperomia obtusifolia',
    isLivingPlant: true,
    category: 'living-vertical-plant-wall',
    growthForm: 'modular-vertical-living-wall-system',
    description:
      'Wall-mounted modular vegetated living wall concept with drip irrigation tray. Requires explicit structural backing, waterproofing membrane, drainage, and front maintenance access verification.',
    defaultContainerWidthMetres: 1.60,
    defaultContainerDepthMetres: 0.25,
    defaultContainerHeightMetres: 2.10,
    expectedMatureWidthRangeMetres: { min: 1.65, max: 1.80 },
    expectedMatureDepthRangeMetres: { min: 0.35, max: 0.45 },
    expectedMatureHeightRangeMetres: { min: 2.10, max: 2.20 },
    lightRequirementBand: 'medium-bright-indirect',
    referenceDaylightFactorMinPercent: 1.5,
    referenceIlluminanceRangeLux: { min: 350, max: 2000 },
    directSunTolerance: 'sensitive-to-intense-direct-sun',
    wateringDemand: 'high-consistent-moisture-or-irrigated',
    maintenanceComplexity: 'high-specialist',
    estimatedMonthlyCareMinutesPerUnit: 95,
    preferredRelativeHumidityRangePercent: { min: 45, max: 75 },
    preferredTemperatureRangeCelsius: { min: 16, max: 26 },
    soilAndDrainageRequirement:
      'Hydroponic felt or modular substrate cassettes with recirculating or direct-to-drain drip irrigation and catch basin.',
    containerRequirement:
      'Wall-mounted aluminium/PVC carrier frame with continuous waterproof backing board and base condensate/drainage trough.',
    toxicityStatus: 'verified-mild-irritant-sap-or-oxalate',
    toxicityDetails:
      'Philodendron foliage contains calcium oxalates if ingested; Nephrolepis and Peperomia are non-toxic.',
    verticalInstallationRequirements: {
      requiresWallBackingAndAnchorageReview: true,
      requiresWaterproofMembraneAndDripTray: true,
      requiresIrrigationAndDrainagePlumbing: true,
      requiresMaintenanceAccessClearanceMetres: 0.75,
      estimatedWetWeightKgPerSqmRange: { min: 35, max: 65 },
      structuralAndWaterproofingDisclaimer:
        'CONCEPTUAL PROPOSAL ONLY: P39 does NOT verify wall structural load capacity (typical saturated dead load 35–65 kg/m²), fastener shear/pullout, waterproofing membrane continuity, or MEP water-supply/drainage code compliance. Qualified structural and MEP engineering verification is required before installation.',
    },
    provenance: 'reference_assumption',
    completeness: 'partial',
    missingInformationNotes: [
      'Site-specific wall structural load capacity and backing substrate verification required.',
      'Dedicated water supply, floor drain connection, and waterproof membrane specification required.',
    ],
    evidenceSource: {
      sourceId: 'src-cibse-living-wall-2023',
      publisher: 'Architectural Interior Landscaping Technical Guidance',
      title: 'Indoor Living Wall Systems: Moisture, Structural & Maintenance Parameters',
      referenceUrlOrId: 'ILG-VerticalGreenspace-2023',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'moderate-horticultural-guide',
      scopeAndLimitationsNote:
        'Conceptual architectural planning model only; structural and waterproofing engineering sign-off mandatory.',
    },
  },
  {
    catalogId: 'element-preserved-reindeer-moss-panel',
    displayName: 'Preserved Reindeer Moss Wall Panel (Non-Living Biophilic Feature)',
    scientificName: null,
    isLivingPlant: false,
    category: 'non-living-preserved-moss-panel',
    growthForm: 'non-living-static-feature',
    description:
      'Non-living glycerine-preserved natural cladonia moss wall panel. Requires zero watering and zero daylight, providing biophilic visual texture in low-light rooms or corridors.',
    defaultContainerWidthMetres: 1.20,
    defaultContainerDepthMetres: 0.08,
    defaultContainerHeightMetres: 1.20,
    expectedMatureWidthRangeMetres: { min: 1.20, max: 1.20 },
    expectedMatureDepthRangeMetres: { min: 0.08, max: 0.08 },
    expectedMatureHeightRangeMetres: { min: 1.20, max: 1.20 },
    lightRequirementBand: 'not-applicable-non-living',
    referenceDaylightFactorMinPercent: null,
    referenceIlluminanceRangeLux: null,
    directSunTolerance: 'sensitive-to-intense-direct-sun',
    wateringDemand: 'none-non-living',
    maintenanceComplexity: 'minimal-dusting-only',
    estimatedMonthlyCareMinutesPerUnit: 5,
    preferredRelativeHumidityRangePercent: { min: 40, max: 65 },
    preferredTemperatureRangeCelsius: { min: 12, max: 28 },
    soilAndDrainageRequirement: null,
    containerRequirement:
      'Framed acoustic/MDF backing panel mounted to interior wall; must NOT be watered or misted.',
    toxicityStatus: 'not-applicable-non-living',
    toxicityDetails:
      'Non-living preserved lichen/moss treated with food-grade glycerine and mineral pigments; non-edible, mount above pet chew reach.',
    verticalInstallationRequirements: {
      requiresWallBackingAndAnchorageReview: true,
      requiresWaterproofMembraneAndDripTray: false,
      requiresIrrigationAndDrainagePlumbing: false,
      requiresMaintenanceAccessClearanceMetres: 0.45,
      estimatedWetWeightKgPerSqmRange: { min: 6, max: 12 },
      structuralAndWaterproofingDisclaimer:
        'Non-living wall panel (~6–12 kg/m²). Avoid direct sunlight (causes pigment fading) and relative humidity below 35% RH (causes brittle texture). Do not claim acoustic NRC/STC certification unless backed by a laboratory ISO 354 / ASTM C423 test report in P36.',
    },
    provenance: 'reference_assumption',
    completeness: 'complete',
    missingInformationNotes: [],
    evidenceSource: {
      sourceId: 'src-biophilic-moss-spec-2024',
      publisher: 'Interior Biophilic Materials Reference',
      title: 'Preserved Cladonia stellaris Panel Environmental & Mounting Specification',
      referenceUrlOrId: 'IBMR-Preserved-Moss-2024',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'moderate-horticultural-guide',
      scopeAndLimitationsNote:
        'Distinct from living plants: requires no photosynthetic light or irrigation.',
    },
  },
  {
    catalogId: 'element-natural-timber-stone-plinth',
    displayName: 'Natural Fluted Timber & Honed Stone Biophilic Plinth (Non-Living)',
    scientificName: null,
    isLivingPlant: false,
    category: 'non-living-natural-material-feature',
    growthForm: 'non-living-static-feature',
    description:
      'Non-living tactile natural-material feature combining FSC oak slats and honed river stone for windowless foyers, bathrooms, or low-light zones.',
    defaultContainerWidthMetres: 0.75,
    defaultContainerDepthMetres: 0.35,
    defaultContainerHeightMetres: 0.85,
    expectedMatureWidthRangeMetres: { min: 0.75, max: 0.75 },
    expectedMatureDepthRangeMetres: { min: 0.35, max: 0.35 },
    expectedMatureHeightRangeMetres: { min: 0.85, max: 0.85 },
    lightRequirementBand: 'not-applicable-non-living',
    referenceDaylightFactorMinPercent: null,
    referenceIlluminanceRangeLux: null,
    directSunTolerance: 'tolerates-direct-sun',
    wateringDemand: 'none-non-living',
    maintenanceComplexity: 'minimal-dusting-only',
    estimatedMonthlyCareMinutesPerUnit: 5,
    preferredRelativeHumidityRangePercent: { min: 25, max: 75 },
    preferredTemperatureRangeCelsius: { min: 10, max: 32 },
    soilAndDrainageRequirement: null,
    containerRequirement: 'Freestanding natural timber & stone plinth.',
    toxicityStatus: 'not-applicable-non-living',
    toxicityDetails: 'Inert natural timber and stone feature.',
    provenance: 'reference_assumption',
    completeness: 'complete',
    missingInformationNotes: [],
    evidenceSource: {
      sourceId: 'src-biophilic-material-accent-2024',
      publisher: 'Architectural Biophilic Design Pattern Reference',
      title: 'Material Connection with Nature — Non-Living Interior Elements',
      referenceUrlOrId: 'ABDP-Material-Connection-2024',
      lastReviewedDate: '2025-01-15',
      confidenceLevel: 'moderate-horticultural-guide',
      scopeAndLimitationsNote: 'Non-living architectural feature; zero irrigation or daylight demand.',
    },
  },
  {
    catalogId: 'plant-unverified-custom-specimen',
    displayName: 'Unverified Botanical Specimen (Incomplete Reference Data)',
    scientificName: null,
    isLivingPlant: true,
    category: 'living-floor-plant',
    growthForm: 'unknown',
    description:
      'Placeholder/user-entered living specimen with unverified scientific species, unknown light threshold, unknown mature canopy spread, and unverified toxicity.',
    defaultContainerWidthMetres: 0.40,
    defaultContainerDepthMetres: 0.40,
    defaultContainerHeightMetres: 0.80,
    expectedMatureWidthRangeMetres: null,
    expectedMatureDepthRangeMetres: null,
    expectedMatureHeightRangeMetres: null,
    lightRequirementBand: 'unknown',
    referenceDaylightFactorMinPercent: null,
    referenceIlluminanceRangeLux: null,
    directSunTolerance: 'unknown',
    wateringDemand: 'unknown',
    maintenanceComplexity: 'unknown',
    estimatedMonthlyCareMinutesPerUnit: null,
    preferredRelativeHumidityRangePercent: null,
    preferredTemperatureRangeCelsius: null,
    soilAndDrainageRequirement: null,
    containerRequirement: 'User-supplied container; drainage and saucer details required.',
    toxicityStatus: 'unknown-unverified',
    toxicityDetails:
      'Botanical identity and toxicity are unverified. Do not assume safe around pets or children until species is identified.',
    provenance: 'user_entered_project_data',
    completeness: 'incomplete',
    missingInformationNotes: [
      'Scientific species name is unknown.',
      'Light requirement band and minimum Daylight Factor proxy are unknown.',
      'Expected mature canopy width, depth, and height are unknown.',
      'Pet and human toxicity status is unverified.',
      'Watering and monthly maintenance care duration are unknown.',
    ],
    evidenceSource: null,
  },
];

/**
 * Default maintenance & planning preferences per P39 Section 3.B & 3.E.
 */
export function createDefaultMaintenanceSettings(): BiophilicMaintenanceSettings {
  return {
    userMaintenanceTolerance: 'moderate',
    hasPetsOrYoungChildren: false,
    allowSupplementalGrowLightingAssumption: false,
    maxFloorAreaOccupancyPercentThreshold: 12,
    minMaintenanceAccessClearanceMetres: 0.6,
    seasonOrConditionNote:
      'Standard indoor conditioning assumed (18–25 °C); actual watering cadence varies by season, substrate porosity, container drainage, and room humidity.',
    provenance: 'reference_assumption',
  };
}

/**
 * Returns the full catalog combining built-in P39 items and any project-specific custom catalog entries.
 */
export function getProjectBiophilicCatalog(
  project: Project,
  p39Data?: ProjectBiophilicPlannerData
): BiophilicCatalogItem[] {
  const custom = p39Data?.customCatalogItems || project.biophilicPlanner?.customCatalogItems || [];
  const customIds = new Set(custom.map((c) => c.catalogId));
  return [
    ...P39_DEFAULT_CATALOG.filter((item) => !customIds.has(item.catalogId)),
    ...custom,
  ];
}

/**
 * Helper to create a deterministic placement record in a room with safe coordinates.
 */
function buildSeededPlacement(
  placementId: string,
  catalogItem: BiophilicCatalogItem,
  room: FloorPlanRoom,
  unit: MeasurementUnit,
  offsetIndex: number,
  mountType: BiophilicPlacementRecord['mountType'] = 'floor-standing',
  wallEdge: BiophilicPlacementRecord['wallEdge'] = 'north'
): BiophilicPlacementRecord {
  const cWidth = metresToProjectUnit(catalogItem.defaultContainerWidthMetres, unit);
  const cDepth = metresToProjectUnit(catalogItem.defaultContainerDepthMetres, unit);
  const cHeight = metresToProjectUnit(catalogItem.defaultContainerHeightMetres, unit);

  const matureW = catalogItem.expectedMatureWidthRangeMetres
    ? metresToProjectUnit(catalogItem.expectedMatureWidthRangeMetres.max, unit)
    : null;
  const matureD = catalogItem.expectedMatureDepthRangeMetres
    ? metresToProjectUnit(catalogItem.expectedMatureDepthRangeMetres.max, unit)
    : null;

  const margin = unit === 'feet' ? 0.8 : 0.25;
  const step = unit === 'feet' ? 3.2 : 1.0;

  // Place along top-right or bottom-right corner away from typical top-left door openings
  const maxX = Math.max(margin, room.width - (matureW ?? cWidth) - margin);
  const maxY = Math.max(margin, room.length - (matureD ?? cDepth) - margin);
  const localX = round2(Math.min(maxX, Math.max(margin, room.width - (matureW ?? cWidth) - margin - offsetIndex * step)));
  const localY = round2(Math.min(maxY, margin));

  return {
    placementId,
    catalogId: catalogItem.catalogId,
    roomId: room.id,
    floorLevel: room.floorLevel || 1,
    label: `${catalogItem.displayName} (${room.name})`,
    quantity: 1,
    mountType,
    wallEdge,
    localX,
    localY,
    rotationDeg: 0,
    containerWidth: cWidth,
    containerDepth: cDepth,
    installedHeight: cHeight,
    expectedMatureWidth: matureW,
    expectedMatureDepth: matureD,
    unit,
    provenance: 'scenario_assumption',
    completeness: catalogItem.completeness,
    createdAt: '2025-02-01T00:00:00.000Z',
    updatedAt: '2025-02-01T00:00:00.000Z',
  };
}

/**
 * Builds the default P39 scenarios for a project so users can immediately inspect and compare
 * alternative plantscape strategies (Low-Maintenance vs High-Density vs Vertical Greenspace vs Minimal Non-Living).
 */
export function buildDefaultBiophilicScenarios(project: Project): BiophilicScenario[] {
  const rooms = project.floorPlan?.rooms || [];
  const unit = project.unit;
  const byId = new Map(P39_DEFAULT_CATALOG.map((c) => [c.catalogId, c]));

  const castIron = byId.get('plant-aspidistra-elatior')!;
  const parlourPalm = byId.get('plant-chamaedorea-elegans')!;
  const prayerPlant = byId.get('plant-calathea-orbifolia')!;
  const fiddleFig = byId.get('plant-ficus-lyrata')!;
  const trioTrough = byId.get('plant-cluster-trio-planter')!;
  const livingWall = byId.get('plant-vertical-living-wall-modular')!;
  const mossPanel = byId.get('element-preserved-reindeer-moss-panel')!;
  const stonePlinth = byId.get('element-natural-timber-stone-plinth')!;

  const primaryRooms = rooms.filter(
    (r) =>
      r.type === 'living' ||
      r.type === 'bedroom' ||
      r.type === 'office' ||
      r.type === 'dining' ||
      r.type === 'kitchen'
  );
  const targetRooms = primaryRooms.length > 0 ? primaryRooms : rooms.slice(0, 3);

  // Scenario 1: Low-Maintenance & Pet-Safe Resilient Plantscape
  const lowMaintPlacements: BiophilicPlacementRecord[] = [];
  targetRooms.slice(0, 3).forEach((rm, idx) => {
    const item = rm.type === 'living' ? parlourPalm : castIron;
    lowMaintPlacements.push(
      buildSeededPlacement(
        `p39-seed-lowmaint-${rm.id}-${idx}`,
        item,
        rm,
        unit,
        0,
        'floor-standing',
        'north'
      )
    );
  });

  // Scenario 2: High-Density Biophilic Foliage
  const highDensityPlacements: BiophilicPlacementRecord[] = [];
  targetRooms.slice(0, 4).forEach((rm, idx) => {
    highDensityPlacements.push(
      buildSeededPlacement(
        `p39-seed-hd-primary-${rm.id}-${idx}`,
        rm.type === 'living' ? fiddleFig : parlourPalm,
        rm,
        unit,
        0,
        'floor-standing',
        'south'
      )
    );
    highDensityPlacements.push(
      buildSeededPlacement(
        `p39-seed-hd-secondary-${rm.id}-${idx}`,
        rm.type === 'living' ? trioTrough : prayerPlant,
        rm,
        unit,
        1,
        rm.type === 'living' ? 'floor-standing' : 'tabletop-or-shelf',
        'east'
      )
    );
  });

  // Scenario 3: Vertical Greenspace & Moss Wall Focus
  const verticalPlacements: BiophilicPlacementRecord[] = [];
  targetRooms.slice(0, 3).forEach((rm, idx) => {
    const isMainLiving = idx === 0 || rm.type === 'living';
    verticalPlacements.push(
      buildSeededPlacement(
        `p39-seed-vert-${rm.id}-${idx}`,
        isMainLiving ? livingWall : mossPanel,
        rm,
        unit,
        0,
        'wall-mounted',
        'east'
      )
    );
  });

  // Scenario 4: Minimal Non-Living Biophilic Accents
  const minimalNonLivingPlacements: BiophilicPlacementRecord[] = [];
  targetRooms.slice(0, 2).forEach((rm, idx) => {
    minimalNonLivingPlacements.push(
      buildSeededPlacement(
        `p39-seed-nonliving-${rm.id}-${idx}`,
        idx === 0 ? mossPanel : stonePlinth,
        rm,
        unit,
        0,
        idx === 0 ? 'wall-mounted' : 'floor-standing',
        'west'
      )
    );
  });

  const baseSettings = createDefaultMaintenanceSettings();

  return [
    {
      scenarioId: 'scen-p39-low-maintenance',
      name: 'Scenario A — Low-Maintenance Pet-Safe Plantscape',
      description:
        'Resilient, verified non-toxic floor plants (Cast-Iron Plant & Parlour Palm) sized to preserve circulation and minimize monthly watering demand.',
      presetKind: 'low-maintenance-resilient',
      placements: lowMaintPlacements,
      maintenanceSettings: {
        ...baseSettings,
        userMaintenanceTolerance: 'low',
        hasPetsOrYoungChildren: true,
      },
      provenance: 'scenario_assumption',
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z',
    },
    {
      scenarioId: 'scen-p39-high-density',
      name: 'Scenario B — High-Density Interior Foliage',
      description:
        'Multi-layered floor trees, grouped planter troughs, and tabletop specimens requiring higher daylight availability and dedicated monthly care.',
      presetKind: 'high-density-foliage',
      placements: highDensityPlacements,
      maintenanceSettings: {
        ...baseSettings,
        userMaintenanceTolerance: 'high-dedicated',
        hasPetsOrYoungChildren: false,
      },
      provenance: 'scenario_assumption',
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z',
    },
    {
      scenarioId: 'scen-p39-vertical-greenspace',
      name: 'Scenario C — Vertical Greenspace & Living Wall Concept',
      description:
        'Concentrates biophilic elements onto vertical wall surfaces using a modular irrigated living wall and preserved moss panels to minimize floor footprint.',
      presetKind: 'vertical-greenspace-focus',
      placements: verticalPlacements,
      maintenanceSettings: {
        ...baseSettings,
        userMaintenanceTolerance: 'high-dedicated',
      },
      provenance: 'scenario_assumption',
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z',
    },
    {
      scenarioId: 'scen-p39-minimal-non-living',
      name: 'Scenario D — Minimal Non-Living Biophilic Accents',
      description:
        'Uses non-living preserved reindeer moss panels and natural timber/stone plinths for zero-irrigation, zero-daylight spaces.',
      presetKind: 'minimal-non-living-accent',
      placements: minimalNonLivingPlacements,
      maintenanceSettings: {
        ...baseSettings,
        userMaintenanceTolerance: 'low',
      },
      provenance: 'scenario_assumption',
      createdAt: '2025-02-01T00:00:00.000Z',
      updatedAt: '2025-02-01T00:00:00.000Z',
    },
  ];
}

/**
 * Initializes or returns existing `ProjectBiophilicPlannerData` on a project without mutating
 * unrelated domains.
 */
export function initializeProjectBiophilicPlannerData(
  project: Project
): ProjectBiophilicPlannerData {
  if (project.biophilicPlanner && project.biophilicPlanner.scenarios?.length > 0) {
    return JSON.parse(JSON.stringify(project.biophilicPlanner));
  }

  const scenarios = buildDefaultBiophilicScenarios(project);
  const firstRoomId = project.floorPlan?.rooms?.[0]?.id;
  const p38Report = evaluateProjectDaylightComfort(project);

  return {
    schemaVersion: P39_BIOPHILIC_SCHEMA_VERSION,
    engineVersion: P39_BIOPHILIC_PLANNER_ENGINE_VERSION,
    isConfigured: Boolean(project.biophilicPlanner?.isConfigured),
    selectedRoomId: project.biophilicPlanner?.selectedRoomId || firstRoomId,
    activeScenarioId: scenarios[0].scenarioId,
    comparisonScenarioId: scenarios[1]?.scenarioId || scenarios[0].scenarioId,
    customCatalogItems: project.biophilicPlanner?.customCatalogItems || [],
    maintenanceSettings:
      project.biophilicPlanner?.maintenanceSettings || createDefaultMaintenanceSettings(),
    scenarios,
    lastEvaluatedAt: new Date().toISOString(),
    lastP38SourceFingerprint: p38Report.sourceFingerprint,
    requestSequenceId: project.biophilicPlanner?.requestSequenceId || 1,
    extraFields: project.biophilicPlanner?.extraFields,
  };
}

/**
 * Computes a deterministic source fingerprint covering room geometry, P33 furniture/openings,
 * P37 ventilation openings, P38 daylight fingerprint, and P39 scenario configurations.
 */
export function computeBiophilicSourceFingerprint(
  project: Project,
  p39Data?: ProjectBiophilicPlannerData,
  p38Fingerprint?: string
): string {
  const data = p39Data || initializeProjectBiophilicPlannerData(project);
  const p38Fp = p38Fingerprint ?? evaluateProjectDaylightComfort(project).sourceFingerprint;
  const roomsSig = (project.floorPlan?.rooms || [])
    .map((r) => `${r.id}:${r.width}x${r.length}:${r.floorLevel}`)
    .join('|');
  const p33Sig = (project.furnitureLayout?.instances || [])
    .map((f) => `${f.instanceId}:${f.roomId}:${f.x},${f.y},${f.width}x${f.depth}`)
    .join('|');
  const activeScen =
    data.scenarios.find((s) => s.scenarioId === data.activeScenarioId) || data.scenarios[0];
  const placementsSig = (activeScen?.placements || [])
    .map(
      (p) =>
        `${p.placementId}:${p.catalogId}:${p.roomId}:${p.localX},${p.localY}:${p.containerWidth}x${p.containerDepth}:${p.expectedMatureWidth ?? 'null'}x${p.expectedMatureDepth ?? 'null'}:${p.quantity}`
    )
    .join('|');
  const settingsSig = `${data.maintenanceSettings.userMaintenanceTolerance}:${data.maintenanceSettings.hasPetsOrYoungChildren}:${data.maintenanceSettings.allowSupplementalGrowLightingAssumption}:${data.maintenanceSettings.maxFloorAreaOccupancyPercentThreshold}`;

  return `p39-fp-v1[${project.unit}|${roomsSig}|${p33Sig}|${p38Fp}|${activeScen?.scenarioId}|${placementsSig}|${settingsSig}]`;
}

/**
 * Validates a `BiophilicPlacementRecord` for structural/numeric validity per P39 Group A & C.
 */
export function validateBiophilicPlacementRecord(
  placement: BiophilicPlacementRecord,
  catalog: BiophilicCatalogItem[]
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!placement.placementId || typeof placement.placementId !== 'string') {
    errors.push('Placement ID must be a non-empty string.');
  }
  if (!placement.roomId || typeof placement.roomId !== 'string') {
    errors.push('Room ID must be a non-empty string.');
  }
  if (!catalog.some((c) => c.catalogId === placement.catalogId)) {
    errors.push(`Catalog item "${placement.catalogId}" does not exist in the P39 catalog.`);
  }
  if (!Number.isFinite(placement.quantity) || placement.quantity < 1 || placement.quantity > 100) {
    errors.push(`Placement quantity (${placement.quantity}) must be a finite integer between 1 and 100.`);
  }
  if (!Number.isFinite(placement.localX) || !Number.isFinite(placement.localY)) {
    errors.push('Placement coordinates (localX, localY) must be finite numbers.');
  }
  if (!Number.isFinite(placement.containerWidth) || placement.containerWidth <= 0) {
    errors.push(`Container width (${placement.containerWidth}) must be a positive finite number.`);
  }
  if (!Number.isFinite(placement.containerDepth) || placement.containerDepth <= 0) {
    errors.push(`Container depth (${placement.containerDepth}) must be a positive finite number.`);
  }
  if (!Number.isFinite(placement.installedHeight) || placement.installedHeight <= 0) {
    errors.push(`Installed height (${placement.installedHeight}) must be a positive finite number.`);
  }
  if (
    placement.expectedMatureWidth !== null &&
    (!Number.isFinite(placement.expectedMatureWidth) || placement.expectedMatureWidth <= 0)
  ) {
    errors.push('Expected mature width must be null (when unknown) or a positive finite number.');
  }
  if (
    placement.expectedMatureDepth !== null &&
    (!Number.isFinite(placement.expectedMatureDepth) || placement.expectedMatureDepth <= 0)
  ) {
    errors.push('Expected mature depth must be null (when unknown) or a positive finite number.');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Axis-Aligned Bounding Box (AABB) in room-local coordinates `[0, room.width] x [0, room.length]`.
 */
interface LocalAABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function getPlacementAABB(
  placement: BiophilicPlacementRecord,
  useMatureFootprint: boolean
): LocalAABB {
  const rawW =
    useMatureFootprint && placement.expectedMatureWidth !== null
      ? Math.max(placement.containerWidth, placement.expectedMatureWidth)
      : placement.containerWidth;
  const rawD =
    useMatureFootprint && placement.expectedMatureDepth !== null
      ? Math.max(placement.containerDepth, placement.expectedMatureDepth)
      : placement.containerDepth;

  const rot = ((placement.rotationDeg % 360) + 360) % 360;
  const isSwapped = rot === 90 || rot === 270;
  const w = isSwapped ? rawD : rawW;
  const d = isSwapped ? rawW : rawD;

  return {
    minX: placement.localX,
    minY: placement.localY,
    maxX: placement.localX + w,
    maxY: placement.localY + d,
  };
}

function aabbIntersects(a: LocalAABB, b: LocalAABB): boolean {
  return a.minX < b.maxX - 1e-4 && a.maxX > b.minX + 1e-4 && a.minY < b.maxY - 1e-4 && a.maxY > b.minY + 1e-4;
}

function aabbEdgeDistance(a: LocalAABB, b: LocalAABB): number {
  const dx = Math.max(0, b.minX - a.maxX, a.minX - b.maxX);
  const dy = Math.max(0, b.minY - a.maxY, a.minY - b.maxY);
  return round2(Math.hypot(dx, dy));
}

/**
 * Evaluates a single placement in a room against:
 * - Catalog botanical/element properties
 * - P38 daylight evaluation (read-only)
 * - Room boundaries & mature growth envelope
 * - Other P39 placements
 * - P33 furniture instances, doors/openings, and circulation clearance thresholds
 * - P34 accessibility clear width and turning space rules
 * - P37 operable ventilation openings
 */
export function evaluatePlacementSuitability(
  placement: BiophilicPlacementRecord,
  room: FloorPlanRoom,
  allRoomPlacements: BiophilicPlacementRecord[],
  catalog: BiophilicCatalogItem[],
  maintenanceSettings: BiophilicMaintenanceSettings,
  project: Project,
  p38Report: ReturnType<typeof evaluateProjectDaylightComfort>,
  p33Data: ReturnType<typeof ensureProjectFurnitureLayoutData>,
  p37Data: ReturnType<typeof initializeProjectNaturalVentilationData>
): PlacementSuitabilityEvaluation {
  const unit = project.unit;
  const catalogItem = catalog.find((c) => c.catalogId === placement.catalogId);
  const conflicts: BiophilicPlacementConflict[] = [];
  const missingInputs: string[] = [];
  const assumptionsUsed: string[] = [];

  const containerW_m = projectUnitToMetres(placement.containerWidth, unit) ?? 0.35;
  const containerD_m = projectUnitToMetres(placement.containerDepth, unit) ?? 0.35;
  const containerFootprintAreaM2 = round3(containerW_m * containerD_m * Math.max(1, placement.quantity));

  const matureW_m = projectUnitToMetres(placement.expectedMatureWidth, unit);
  const matureD_m = projectUnitToMetres(placement.expectedMatureDepth, unit);
  const matureFootprintAreaM2 =
    matureW_m !== null && matureD_m !== null
      ? round3(matureW_m * matureD_m * Math.max(1, placement.quantity))
      : null;

  if (!catalogItem) {
    missingInputs.push(`Catalog record "${placement.catalogId}" not found.`);
    return {
      placementId: placement.placementId,
      catalogId: placement.catalogId,
      displayName: placement.label,
      scientificName: null,
      isLivingPlant: true,
      category: 'living-floor-plant',
      roomId: room.id,
      roomName: room.name,
      suitabilityStatus: 'not-assessable-with-current-data',
      lightSuitabilityStatus: 'not-assessable-missing-daylight-or-plant-data',
      roomMeanDaylightFactorPercent: null,
      localPointDaylightFactorPercent: null,
      receivesDirectSunInActiveScenario: null,
      containerFootprintAreaM2,
      matureFootprintAreaM2,
      minClearanceToObstacleInUnit: null,
      conflicts: [],
      missingInputs,
      assumptionsUsed,
      evidenceSummary: 'Catalog item missing; suitability cannot be assessed.',
      daylightNonGuaranteeDisclosure: P39_PROFESSIONAL_DISCLAIMER,
      provenance: 'unsupported',
      completeness: 'incomplete',
    };
  }

  // Propagate catalog missing information notes
  for (const note of catalogItem.missingInformationNotes) {
    missingInputs.push(note);
  }
  if (placement.expectedMatureWidth === null || placement.expectedMatureDepth === null) {
    missingInputs.push(
      `Expected mature footprint dimensions for "${catalogItem.displayName}" are unknown; spatial checks use container footprint only.`
    );
  }

  // 1. Check room boundary containment (both container and mature footprint)
  const containerBox = getPlacementAABB(placement, false);
  const matureBox = getPlacementAABB(placement, true);

  if (
    containerBox.minX < -1e-4 ||
    containerBox.minY < -1e-4 ||
    containerBox.maxX > room.width + 1e-4 ||
    containerBox.maxY > room.length + 1e-4
  ) {
    conflicts.push({
      conflictId: `conf-bounds-container-${placement.placementId}`,
      placementId: placement.placementId,
      roomId: room.id,
      kind: 'out-of-room-bounds',
      severity: 'blocking-conflict',
      title: 'Container Footprint Extends Outside Room Boundaries',
      description: `Placement "${placement.label}" ([${containerBox.minX}, ${containerBox.minY}] to [${round2(containerBox.maxX)}, ${round2(containerBox.maxY)}] ${unit}) exceeds room "${room.name}" bounds (${room.width} × ${room.length} ${unit}).`,
      measuredValue: `${round2(containerBox.maxX)} × ${round2(containerBox.maxY)} ${unit}`,
      thresholdOrRuleReference: `Room bounds: 0..${room.width} × 0..${room.length} ${unit}`,
      remediationHint: 'Move the placement inward so its container footprint lies completely inside the room.',
    });
  } else if (
    matureBox.minX < -1e-4 ||
    matureBox.minY < -1e-4 ||
    matureBox.maxX > room.width + 1e-4 ||
    matureBox.maxY > room.length + 1e-4
  ) {
    conflicts.push({
      conflictId: `conf-bounds-mature-${placement.placementId}`,
      placementId: placement.placementId,
      roomId: room.id,
      kind: 'out-of-room-bounds',
      severity: 'warning',
      title: 'Expected Mature Plant Canopy Exceeds Room Wall Boundary',
      description: `While the container fits, the expected mature canopy (${placement.expectedMatureWidth} × ${placement.expectedMatureDepth} ${unit}) extends beyond room "${room.name}" walls.`,
      measuredValue: `Mature max X=${round2(matureBox.maxX)}, max Y=${round2(matureBox.maxY)} ${unit}`,
      thresholdOrRuleReference: `Room bounds: 0..${room.width} × 0..${room.length} ${unit}`,
      remediationHint: 'Provide additional wall offset for mature canopy spread or select a more compact species.',
    });
  }

  // 2. Check overlap with other placements in the same room
  for (const other of allRoomPlacements) {
    if (other.placementId === placement.placementId) continue;
    const otherBox = getPlacementAABB(other, true);
    if (aabbIntersects(matureBox, otherBox)) {
      conflicts.push({
        conflictId: `conf-overlap-${placement.placementId}-${other.placementId}`,
        placementId: placement.placementId,
        roomId: room.id,
        kind: 'overlapping-plant-placement',
        severity: aabbIntersects(containerBox, getPlacementAABB(other, false))
          ? 'blocking-conflict'
          : 'warning',
        title: `Overlaps with Plantscape Placement "${other.label}"`,
        description: `Placement "${placement.label}" overlaps spatially with "${other.label}" in room "${room.name}".`,
        measuredValue: '0.00 clearance (overlapping)',
        thresholdOrRuleReference: 'Non-overlapping container and mature canopy footprints',
        remediationHint: 'Separate plant placements or combine them into a single grouped planter trough.',
      });
    }
  }

  // 3. Check P33 Furniture collisions and clearance distances
  const roomFurniture = (p33Data.instances || []).filter((f) => f.roomId === room.id);
  let minObstacleDistance: number | null = null;

  for (const furn of roomFurniture) {
    // Convert furniture coordinates to room-local coordinates if needed
    const furnLocalX = furn.x >= room.x && furn.x <= room.x + room.width ? furn.x - room.x : furn.x;
    const furnLocalY = furn.y >= room.y && furn.y <= room.y + room.length ? furn.y - room.y : furn.y;
    const fRot = ((furn.rotationDeg % 360) + 360) % 360;
    const fW = fRot === 90 || fRot === 270 ? furn.depth : furn.width;
    const fD = fRot === 90 || fRot === 270 ? furn.width : furn.depth;

    const furnBox: LocalAABB = {
      minX: Math.max(0, Math.min(room.width - fW, furnLocalX)),
      minY: Math.max(0, Math.min(room.length - fD, furnLocalY)),
      maxX: Math.max(0, Math.min(room.width - fW, furnLocalX)) + fW,
      maxY: Math.max(0, Math.min(room.length - fD, furnLocalY)) + fD,
    };

    if (placement.mountType === 'floor-standing') {
      if (aabbIntersects(matureBox, furnBox)) {
        conflicts.push({
          conflictId: `conf-p33-furn-${placement.placementId}-${furn.instanceId}`,
          placementId: placement.placementId,
          roomId: room.id,
          kind: 'furniture-collision-p33',
          severity: aabbIntersects(containerBox, furnBox) ? 'blocking-conflict' : 'warning',
          title: `Interferes with P33 Furniture "${furn.name}"`,
          description: `Floor-standing placement "${placement.label}" collides with placed furniture "${furn.name}" (${furn.category}).`,
          measuredValue: '0.00 clearance (overlap)',
          thresholdOrRuleReference: 'P33 Furniture & Circulation non-collision rule',
          relatedFeatureId: 'P33',
          remediationHint: `Relocate "${placement.label}" away from "${furn.name}" or switch to a wall-mounted/tabletop element.`,
        });
        minObstacleDistance = 0;
      } else {
        const dist = aabbEdgeDistance(matureBox, furnBox);
        if (minObstacleDistance === null || dist < minObstacleDistance) {
          minObstacleDistance = dist;
        }

        // Check P33 walkway / P34 accessible route narrowing between plant and furniture
        const p33WalkwayMin = p33Data.clearanceThresholds?.secondaryPassageWidth ?? (unit === 'feet' ? 2.5 : 0.75);
        const p34AccessibleMin = unit === 'feet' ? 3.0 : 0.90;

        if (dist > 0 && dist < p33WalkwayMin) {
          conflicts.push({
            conflictId: `conf-p33-walkway-${placement.placementId}-${furn.instanceId}`,
            placementId: placement.placementId,
            roomId: room.id,
            kind: 'narrowed-circulation-walkway-p33',
            severity: 'warning',
            title: `Narrows Circulation Passage Next to "${furn.name}"`,
            description: `Clearance between "${placement.label}" and "${furn.name}" is ${dist} ${unit}, below the P33 secondary passage threshold (${p33WalkwayMin} ${unit}).`,
            measuredValue: `${dist} ${unit}`,
            thresholdOrRuleReference: `P33 secondary passage width >= ${p33WalkwayMin} ${unit}`,
            relatedFeatureId: 'P33',
            remediationHint: `Increase spacing between "${placement.label}" and "${furn.name}" to at least ${p33WalkwayMin} ${unit}.`,
          });
        } else if (dist >= p33WalkwayMin && dist < p34AccessibleMin) {
          conflicts.push({
            conflictId: `conf-p34-route-${placement.placementId}-${furn.instanceId}`,
            placementId: placement.placementId,
            roomId: room.id,
            kind: 'obstructed-accessible-route-or-turning-p34',
            severity: 'warning',
            title: `Reduces Accessible Route Clear Width Near "${furn.name}"`,
            description: `Clearance between "${placement.label}" and "${furn.name}" is ${dist} ${unit}, which is less than the P34 accessible route screening threshold (${p34AccessibleMin} ${unit}).`,
            measuredValue: `${dist} ${unit}`,
            thresholdOrRuleReference: `P34 accessible clear route width >= ${p34AccessibleMin} ${unit} (screening heuristic, not statutory certification)`,
            relatedFeatureId: 'P34',
            remediationHint: `Reposition "${placement.label}" to maintain at least ${p34AccessibleMin} ${unit} clear accessible passage.`,
          });
        }
      }
    }

    // Work area conflict check (e.g. bulky or toxic plant overlapping work-office desk or kitchen prep)
    if (
      (furn.category === 'work-office' || furn.category === 'kitchen-casework') &&
      aabbEdgeDistance(matureBox, furnBox) < (unit === 'feet' ? 1.5 : 0.45) &&
      catalogItem.isLivingPlant &&
      catalogItem.wateringDemand === 'high-consistent-moisture-or-irrigated'
    ) {
      conflicts.push({
        conflictId: `conf-workzone-${placement.placementId}-${furn.instanceId}`,
        placementId: placement.placementId,
        roomId: room.id,
        kind: 'work-area-or-room-function-conflict',
        severity: 'advisory-review',
        title: `High-Moisture Plant Adjacent to "${furn.name}" Work Zone`,
        description: `High-moisture/irrigated plant "${catalogItem.displayName}" is placed within ${aabbEdgeDistance(matureBox, furnBox)} ${unit} of "${furn.name}".`,
        measuredValue: `${aabbEdgeDistance(matureBox, furnBox)} ${unit}`,
        thresholdOrRuleReference: 'Work-zone equipment & moisture separation advisory',
        relatedFeatureId: 'P33',
        remediationHint: 'Ensure waterproof containment or increase clearance from electronics/work surfaces.',
      });
    }
  }

  // 4. Check P33 Door & Opening Swing Interference
  const roomOpenings = (p33Data.knownOpenings || []).filter((o) => o.roomId === room.id);
  for (const op of roomOpenings) {
    if (op.type === 'door' || op.type === 'open-passage') {
      const swingDepth = op.swingDepth ?? op.width ?? (unit === 'feet' ? 3.0 : 0.90);
      let doorZone: LocalAABB;
      if (op.wallEdge === 'north') {
        doorZone = {
          minX: op.offsetAlongWall,
          minY: 0,
          maxX: op.offsetAlongWall + op.width,
          maxY: swingDepth,
        };
      } else if (op.wallEdge === 'south') {
        doorZone = {
          minX: op.offsetAlongWall,
          minY: Math.max(0, room.length - swingDepth),
          maxX: op.offsetAlongWall + op.width,
          maxY: room.length,
        };
      } else if (op.wallEdge === 'west') {
        doorZone = {
          minX: 0,
          minY: op.offsetAlongWall,
          maxX: swingDepth,
          maxY: op.offsetAlongWall + op.width,
        };
      } else {
        doorZone = {
          minX: Math.max(0, room.width - swingDepth),
          minY: op.offsetAlongWall,
          maxX: room.width,
          maxY: op.offsetAlongWall + op.width,
        };
      }

      if (aabbIntersects(matureBox, doorZone)) {
        conflicts.push({
          conflictId: `conf-door-swing-${placement.placementId}-${op.openingId}`,
          placementId: placement.placementId,
          roomId: room.id,
          kind: 'door-or-opening-swing-interference-p33',
          severity: 'blocking-conflict',
          title: `Obstructs Doorway / Passage Clear Zone ("${op.label}")`,
          description: `Placement "${placement.label}" intrudes into the swing or threshold clearance zone of "${op.label}" on the ${op.wallEdge.toUpperCase()} wall.`,
          measuredValue: 'Intrudes into door swing zone',
          thresholdOrRuleReference: `P33/P34 Doorway swing & approach clearance (${swingDepth} ${unit})`,
          relatedFeatureId: 'P33',
          remediationHint: `Move "${placement.label}" clear of the "${op.label}" doorway approach and swing arc.`,
        });
      }
    }
  }

  // 5. Check P37 Operable Ventilation Opening Interference
  const roomVentOpenings = (p37Data.openings || []).filter(
    (vo) => vo.roomId === room.id && vo.operabilityStatus !== 'fixed'
  );
  for (const vo of roomVentOpenings) {
    const linkedP33 = vo.linkedP33OpeningId
      ? (p33Data.knownOpenings || []).find((o) => o.openingId === vo.linkedP33OpeningId)
      : undefined;
    const voOffset = linkedP33?.offsetAlongWall ?? (unit === 'feet' ? 2.0 : 0.6);
    const voWidth = vo.grossWidth ?? (unit === 'feet' ? 3.0 : 0.9);
    const clearanceDepth = unit === 'feet' ? 2.0 : 0.60;
    let ventZone: LocalAABB;
    if (vo.wallEdge === 'north') {
      ventZone = { minX: voOffset, minY: 0, maxX: voOffset + voWidth, maxY: clearanceDepth };
    } else if (vo.wallEdge === 'south') {
      ventZone = {
        minX: voOffset,
        minY: Math.max(0, room.length - clearanceDepth),
        maxX: voOffset + voWidth,
        maxY: room.length,
      };
    } else if (vo.wallEdge === 'west') {
      ventZone = { minX: 0, minY: voOffset, maxX: clearanceDepth, maxY: voOffset + voWidth };
    } else {
      ventZone = {
        minX: Math.max(0, room.width - clearanceDepth),
        minY: voOffset,
        maxX: room.width,
        maxY: voOffset + voWidth,
      };
    }

    const tallEnoughToBlockWindow =
      (projectUnitToMetres(placement.installedHeight, unit) ?? 0.8) >= 1.1 ||
      placement.mountType === 'wall-mounted';

    if (tallEnoughToBlockWindow && aabbIntersects(matureBox, ventZone)) {
      conflicts.push({
        conflictId: `conf-p37-vent-${placement.placementId}-${vo.openingId}`,
        placementId: placement.placementId,
        roomId: room.id,
        kind: 'ventilation-opening-obstruction-p37',
        severity: 'warning',
        title: `Potential Interference with P37 Ventilation Opening "${vo.label}"`,
        description: `Tall or wall-mounted placement "${placement.label}" (height ${placement.installedHeight} ${unit}) is positioned in front of operable ventilation opening "${vo.label}" (${vo.wallEdge.toUpperCase()} wall), potentially impeding airflow or window latch access.`,
        measuredValue: `Height ${placement.installedHeight} ${unit} within ${clearanceDepth} ${unit} of window`,
        thresholdOrRuleReference: 'P37 Natural Ventilation opening & operable hardware access clearance',
        relatedFeatureId: 'P37',
        remediationHint: `Shift "${placement.label}" laterally along the wall or select a low-profile planter below sill height.`,
      });
    }
  }

  // 6. Check Toxicity vs Pet/Child Household Preference
  if (
    maintenanceSettings.hasPetsOrYoungChildren &&
    (catalogItem.toxicityStatus === 'verified-toxic-if-ingested-pets-or-humans' ||
      catalogItem.toxicityStatus === 'verified-mild-irritant-sap-or-oxalate' ||
      catalogItem.toxicityStatus === 'unknown-unverified') &&
    placement.mountType !== 'hanging-overhead'
  ) {
    conflicts.push({
      conflictId: `conf-toxicity-${placement.placementId}`,
      placementId: placement.placementId,
      roomId: room.id,
      kind: 'toxicity-hazard-in-occupied-zone',
      severity:
        catalogItem.toxicityStatus === 'verified-toxic-if-ingested-pets-or-humans'
          ? 'blocking-conflict'
          : 'warning',
      title:
        catalogItem.toxicityStatus === 'unknown-unverified'
          ? `Unverified Botanical Toxicity in Pet/Child Household ("${catalogItem.displayName}")`
          : `Toxicity Warning for Pets/Children ("${catalogItem.displayName}")`,
      description: `${catalogItem.displayName}: ${catalogItem.toxicityDetails}`,
      measuredValue: catalogItem.toxicityStatus,
      thresholdOrRuleReference: 'Project Maintenance Settings: hasPetsOrYoungChildren = true',
      remediationHint:
        'Substitute a verified pet-safe species (e.g., Aspidistra elatior, Chamaedorea elegans, Goeppertia orbifolia) or place out of reach.',
    });
  }

  // 7. Check Vertical Living Wall / Preserved Moss Installation Constraints
  if (catalogItem.verticalInstallationRequirements) {
    const vReq = catalogItem.verticalInstallationRequirements;
    if (catalogItem.category === 'living-vertical-plant-wall') {
      conflicts.push({
        conflictId: `conf-vert-wall-${placement.placementId}`,
        placementId: placement.placementId,
        roomId: room.id,
        kind: 'vertical-wall-structural-moisture-unverified',
        severity: 'advisory-review',
        title: 'Conceptual Living Wall Requires Structural, Waterproofing & Drainage Verification',
        description: vReq.structuralAndWaterproofingDisclaimer,
        measuredValue: vReq.estimatedWetWeightKgPerSqmRange
          ? `${vReq.estimatedWetWeightKgPerSqmRange.min}–${vReq.estimatedWetWeightKgPerSqmRange.max} kg/m² saturated`
          : 'Unverified wet load',
        thresholdOrRuleReference:
          'Vertical installation structural anchorage, waterproof membrane, irrigation & floor drainage check',
        relatedFeatureId: 'P35',
        remediationHint:
          'Treat as a conceptual proposal until structural wall load capacity, waterproof backing, and irrigation drainage are verified by qualified engineers.',
      });
    }
  }

  // 8. Evaluate P38 Daylight Suitability (Read-Only from P38)
  const p38RoomEval = p38Report.allRoomEvaluationsForActiveScenario.find(
    (re) => re.roomId === room.id
  );
  const roomMeanDf =
    p38RoomEval?.modeC_SimplifiedDaylight.meanDaylightFactorPercent ?? null;

  // Find nearest P38 work-plane grid point to the placement center in metres
  let localPointDf: number | null = null;
  let receivesDirectSun: boolean | null = null;

  if (p38RoomEval && p38RoomEval.geometry.analysisPoints.length > 0) {
    const centerXm =
      projectUnitToMetres(
        (containerBox.minX + containerBox.maxX) / 2,
        unit
      ) ?? 1.0;
    const centerYm =
      projectUnitToMetres(
        (containerBox.minY + containerBox.maxY) / 2,
        unit
      ) ?? 1.0;

    let bestDist = Infinity;
    for (const pt of p38RoomEval.geometry.analysisPoints) {
      const d = Math.hypot(pt.localXMetres - centerXm, pt.localYMetres - centerYm);
      if (d < bestDist) {
        bestDist = d;
        localPointDf = pt.pointDaylightFactorProxyPercent;
        receivesDirectSun = pt.receivesDirectSunInScenario;
      }
    }
  }

  let lightSuitabilityStatus: PlacementSuitabilityEvaluation['lightSuitabilityStatus'] =
    'not-assessable-missing-daylight-or-plant-data';

  if (!catalogItem.isLivingPlant) {
    lightSuitabilityStatus = 'not-applicable-non-living';
    if (
      catalogItem.category === 'non-living-preserved-moss-panel' &&
      receivesDirectSun === true
    ) {
      lightSuitabilityStatus = 'unsuitable-excessive-direct-sun-exposure';
      conflicts.push({
        conflictId: `conf-moss-sun-${placement.placementId}`,
        placementId: placement.placementId,
        roomId: room.id,
        kind: 'unsuitable-light-or-direct-sun-p38',
        severity: 'warning',
        title: 'Direct Solar Beam on Preserved Moss Panel May Cause UV Fading & Drying',
        description: `P38 Mode B indicates the placement location in "${room.name}" receives direct solar radiation in scenario "${p38Report.activeScenario.name}", which can bleach and embrittle preserved moss.`,
        measuredValue: 'Direct sun patch present',
        thresholdOrRuleReference: 'Preserved moss UV/direct-sun avoidance rule',
        relatedFeatureId: 'P38',
        remediationHint: 'Relocate the preserved moss panel to an interior wall outside the direct solar beam zone.',
      });
    }
  } else if (
    catalogItem.lightRequirementBand === 'unknown' ||
    catalogItem.referenceDaylightFactorMinPercent === null
  ) {
    lightSuitabilityStatus = 'not-assessable-missing-daylight-or-plant-data';
    missingInputs.push(
      `Plant light requirement is unknown for "${catalogItem.displayName}"; daylight compatibility cannot be verified.`
    );
  } else if (roomMeanDf === null && localPointDf === null) {
    lightSuitabilityStatus = 'not-assessable-missing-daylight-or-plant-data';
    missingInputs.push(
      `P38 Mode C Daylight Factor is unavailable for room "${room.name}" (${p38RoomEval?.completenessState || 'no P38 evaluation'}). Complete window dimensions, visible transmittance (VT), and ceiling height in P38 to evaluate plant light suitability.`
    );
  } else {
    const effectiveDf = localPointDf ?? roomMeanDf ?? 0;
    const reqMinDf = catalogItem.referenceDaylightFactorMinPercent;
    assumptionsUsed.push(
      `Evaluated against P38 scenario "${p38Report.activeScenario.name}" using ${
        localPointDf !== null
          ? `nearest work-plane point DF proxy (${localPointDf}%) and room mean DF (${roomMeanDf}%)`
          : `room mean DF (${roomMeanDf}%)`
      } vs. horticultural reference threshold (${reqMinDf}% DF for ${catalogItem.lightRequirementBand}).`
    );

    if (
      receivesDirectSun === true &&
      catalogItem.directSunTolerance === 'sensitive-to-intense-direct-sun'
    ) {
      lightSuitabilityStatus = 'unsuitable-excessive-direct-sun-exposure';
      conflicts.push({
        conflictId: `conf-direct-sun-${placement.placementId}`,
        placementId: placement.placementId,
        roomId: room.id,
        kind: 'unsuitable-light-or-direct-sun-p38',
        severity: 'warning',
        title: `Direct Solar Beam Risk for Shade-Preferring Species ("${catalogItem.displayName}")`,
        description: `"${catalogItem.displayName}" is sensitive to intense direct sunlight, and P38 Mode B indicates this position receives direct solar beam penetration in scenario "${p38Report.activeScenario.name}".`,
        measuredValue: 'Direct solar beam exposure = true',
        thresholdOrRuleReference: `Species direct sun tolerance: ${catalogItem.directSunTolerance}`,
        relatedFeatureId: 'P38',
        remediationHint:
          'Move the plant deeper into the indirect daylight zone, deploy sheer diffusing blinds in P38, or select a sun-tolerant species.',
      });
    } else if (effectiveDf >= reqMinDf) {
      lightSuitabilityStatus = 'compatible-with-screened-daylight';
    } else if (
      effectiveDf >= reqMinDf * 0.65 ||
      maintenanceSettings.allowSupplementalGrowLightingAssumption
    ) {
      lightSuitabilityStatus = 'marginal-or-supplemental-lighting-advised';
      if (maintenanceSettings.allowSupplementalGrowLightingAssumption) {
        assumptionsUsed.push(
          'User enabled supplemental horticultural grow-lighting assumption for marginal/low-daylight locations.'
        );
      }
      conflicts.push({
        conflictId: `conf-marginal-light-${placement.placementId}`,
        placementId: placement.placementId,
        roomId: room.id,
        kind: 'unsuitable-light-or-direct-sun-p38',
        severity: 'advisory-review',
        title: `Marginal Daylight Availability for "${catalogItem.displayName}"`,
        description: `Local Daylight Factor proxy (${effectiveDf}%) in "${room.name}" is below the reference threshold (${reqMinDf}% DF) for "${catalogItem.displayName}".`,
        measuredValue: `${effectiveDf}% DF (target >= ${reqMinDf}% DF)`,
        thresholdOrRuleReference: `Horticultural reference minimum: ${reqMinDf}% DF`,
        relatedFeatureId: 'P38',
        remediationHint:
          'Move closer to a window in P39, substitute a low-light-tolerant species (e.g., Aspidistra elatior), or provide dedicated horticultural lighting.',
      });
    } else {
      lightSuitabilityStatus = 'unsuitable-insufficient-daylight';
      conflicts.push({
        conflictId: `conf-low-light-${placement.placementId}`,
        placementId: placement.placementId,
        roomId: room.id,
        kind: 'unsuitable-light-or-direct-sun-p38',
        severity: 'blocking-conflict',
        title: `Insufficient Screened Daylight for "${catalogItem.displayName}"`,
        description: `Local Daylight Factor proxy (${effectiveDf}%) in "${room.name}" is substantially below the reference minimum (${reqMinDf}% DF) required by "${catalogItem.displayName}".`,
        measuredValue: `${effectiveDf}% DF (target >= ${reqMinDf}% DF)`,
        thresholdOrRuleReference: `Horticultural reference minimum: ${reqMinDf}% DF (${catalogItem.lightRequirementBand})`,
        relatedFeatureId: 'P38',
        remediationHint:
          'Substitute a low-light-tolerant species (e.g., Aspidistra elatior) or a non-living biophilic feature (e.g., Preserved Reindeer Moss Panel).',
      });
    }
  }

  // 9. Check User Maintenance Preference Alignment
  if (
    maintenanceSettings.userMaintenanceTolerance === 'low' &&
    (catalogItem.maintenanceComplexity === 'high-specialist' ||
      catalogItem.maintenanceComplexity === 'moderate')
  ) {
    assumptionsUsed.push(
      `User maintenance tolerance is set to "low", whereas "${catalogItem.displayName}" requires "${catalogItem.maintenanceComplexity}" maintenance complexity.`
    );
  }

  // 10. Determine overall BiophilicSuitabilityStatus per P39 Section 3.B
  const hasBlockingConflict = conflicts.some((c) => c.severity === 'blocking-conflict');
  const hasWarningOrAdvisory = conflicts.length > 0;
  let suitabilityStatus: BiophilicSuitabilityStatus;

  if (
    catalogItem.completeness === 'incomplete' ||
    (catalogItem.isLivingPlant &&
      lightSuitabilityStatus === 'not-assessable-missing-daylight-or-plant-data')
  ) {
    suitabilityStatus = 'not-assessable-with-current-data';
  } else if (
    hasBlockingConflict ||
    lightSuitabilityStatus === 'unsuitable-insufficient-daylight' ||
    lightSuitabilityStatus === 'unsuitable-excessive-direct-sun-exposure'
  ) {
    suitabilityStatus = 'unsuitable-under-current-assumptions';
  } else if (
    hasWarningOrAdvisory ||
    missingInputs.length > 0 ||
    lightSuitabilityStatus === 'marginal-or-supplemental-lighting-advised' ||
    catalogItem.category === 'living-vertical-plant-wall'
  ) {
    suitabilityStatus = 'potentially-suitable-additional-info-needed';
  } else {
    suitabilityStatus = 'suitable-based-on-available-evidence';
  }

  const completeness: P39Completeness =
    catalogItem.completeness === 'incomplete' ||
    (catalogItem.isLivingPlant && roomMeanDf === null)
      ? 'incomplete'
      : missingInputs.length > 0
      ? 'partial'
      : 'complete';

  const evidenceSummary = catalogItem.isLivingPlant
    ? `${catalogItem.displayName} (${catalogItem.scientificName ?? 'species unverified'}): container ${placement.containerWidth}×${placement.containerDepth} ${unit}, mature ${placement.expectedMatureWidth ?? '?'}×${placement.expectedMatureDepth ?? '?'} ${unit}. Light band: ${catalogItem.lightRequirementBand} (min ${catalogItem.referenceDaylightFactorMinPercent ?? '?'}% DF vs. room ${roomMeanDf ?? 'unavailable'}% DF, local point ${localPointDf ?? 'unavailable'}% DF). Toxicity: ${catalogItem.toxicityStatus}.`
    : `${catalogItem.displayName} (Non-living biophilic feature): ${placement.containerWidth}×${placement.containerDepth}×${placement.installedHeight} ${unit}. No photosynthetic light or irrigation required.`;

  return {
    placementId: placement.placementId,
    catalogId: placement.catalogId,
    displayName: catalogItem.displayName,
    scientificName: catalogItem.scientificName,
    isLivingPlant: catalogItem.isLivingPlant,
    category: catalogItem.category,
    roomId: room.id,
    roomName: room.name,
    suitabilityStatus,
    lightSuitabilityStatus,
    roomMeanDaylightFactorPercent: roomMeanDf,
    localPointDaylightFactorPercent: localPointDf,
    receivesDirectSunInActiveScenario: receivesDirectSun,
    containerFootprintAreaM2,
    matureFootprintAreaM2,
    minClearanceToObstacleInUnit: minObstacleDistance,
    conflicts,
    missingInputs,
    assumptionsUsed,
    evidenceSummary,
    daylightNonGuaranteeDisclosure:
      'P38 analytical daylight factor and solar position estimates are architectural screening metrics and do NOT guarantee that a living plant will thrive; actual plant health depends on spectral quality, acclimation, substrate drainage, humidity, and ongoing care.',
    provenance: 'derived_deterministic',
    completeness,
  };
}

/**
 * Generates deterministic care & maintenance tasks for a placement per P39 Section 3.E.
 */
export function buildMaintenanceTasksForPlacement(
  placement: BiophilicPlacementRecord,
  catalogItem: BiophilicCatalogItem,
  roomName: string,
  settings: BiophilicMaintenanceSettings
): BiophilicMaintenanceTask[] {
  const tasks: BiophilicMaintenanceTask[] = [];
  const qty = Math.max(1, placement.quantity);

  if (!catalogItem.isLivingPlant) {
    tasks.push({
      taskId: `maint-nonliving-${placement.placementId}`,
      placementId: placement.placementId,
      roomId: placement.roomId,
      roomName,
      elementName: catalogItem.displayName,
      isLivingPlant: false,
      taskCategory: 'non-living-dusting-and-fastener-inspection',
      recommendedCadenceLabel: 'Monthly visual & dusting check (No watering)',
      estimatedMinutesPerMonth:
        catalogItem.estimatedMonthlyCareMinutesPerUnit !== null
          ? catalogItem.estimatedMonthlyCareMinutesPerUnit * qty
          : 5 * qty,
      guidanceText: `Gently dust "${catalogItem.displayName}" using a soft dry brush or low-pressure air duster. Inspect wall/floor mounting fasteners. Do NOT water or mist.`,
      conditionalVariabilityDisclosure:
        'Non-living feature: requires zero irrigation. Keep indoor relative humidity within 40–65% RH for preserved moss panels to maintain pliability.',
      accessAndSafetyNotes: [
        `Maintain at least ${settings.minMaintenanceAccessClearanceMetres} m front access clearance for cleaning.`,
      ],
      provenance: 'reference_assumption',
    });
    return tasks;
  }

  // 1. Watering & substrate moisture check
  const wateringCadence =
    catalogItem.wateringDemand === 'low-drought-tolerant'
      ? 'Check substrate every 10–14 days; water only when top 50–75% of medium is dry'
      : catalogItem.wateringDemand === 'moderate-even-moisture'
      ? 'Check substrate every 5–7 days; maintain even moisture without saucer standing water'
      : catalogItem.wateringDemand === 'high-consistent-moisture-or-irrigated'
      ? 'Check irrigation reservoir & substrate moisture twice weekly (every 3–4 days)'
      : 'Species watering demand unknown — inspect substrate moisture manually before watering';

  const baseCareMins =
    catalogItem.estimatedMonthlyCareMinutesPerUnit !== null
      ? catalogItem.estimatedMonthlyCareMinutesPerUnit * qty
      : null;

  tasks.push({
    taskId: `maint-water-${placement.placementId}`,
    placementId: placement.placementId,
    roomId: placement.roomId,
    roomName,
    elementName: catalogItem.displayName,
    isLivingPlant: true,
    taskCategory: 'watering-and-substrate-moisture-check',
    recommendedCadenceLabel: wateringCadence,
    estimatedMinutesPerMonth: baseCareMins !== null ? Math.round(baseCareMins * 0.55) : null,
    guidanceText: `Test root-zone moisture manually before watering "${catalogItem.displayName}". Empty excess drainage water from saucers/liners within 30 minutes to prevent root hypoxia and floor moisture damage.`,
    conditionalVariabilityDisclosure:
      'Watering intervals are NOT universal schedules: actual water uptake varies with plant maturity, potting substrate aeration, container drainage, seasonal solar gain, indoor HVAC humidity, and temperature.',
    accessAndSafetyNotes: [
      catalogItem.soilAndDrainageRequirement ||
        'Verify container drainage and waterproof saucer liner.',
      ...(catalogItem.toxicityStatus !== 'verified-non-toxic-pets-and-humans'
        ? [`Toxicity note (${catalogItem.toxicityStatus}): wear gloves when pruning or handling sap.`]
        : []),
    ],
    provenance:
      catalogItem.estimatedMonthlyCareMinutesPerUnit !== null
        ? 'reference_assumption'
        : 'unsupported',
  });

  // 2. Inspection, pruning, light rotation & growth-space review
  tasks.push({
    taskId: `maint-inspect-${placement.placementId}`,
    placementId: placement.placementId,
    roomId: placement.roomId,
    roomName,
    elementName: catalogItem.displayName,
    isLivingPlant: true,
    taskCategory: 'inspection-pruning-and-foliage-cleaning',
    recommendedCadenceLabel: 'Monthly foliage cleaning, pest inspection & quarter-turn rotation',
    estimatedMinutesPerMonth: baseCareMins !== null ? Math.round(baseCareMins * 0.45) : null,
    guidanceText: `Wipe dust from leaf surfaces to maintain photosynthetic transmittance, rotate freestanding containers 90° for balanced phototropic growth, and prune senescent fronds/stems so canopy stays within the planned ${
      placement.expectedMatureWidth ?? placement.containerWidth
    } × ${placement.expectedMatureDepth ?? placement.containerDepth} ${placement.unit} footprint.`,
    conditionalVariabilityDisclosure:
      'Repotting and root-ball division typically required every 18–36 months depending on observed root-bound state and shoot vigour.',
    accessAndSafetyNotes: [
      `Ensure ${settings.minMaintenanceAccessClearanceMetres} m unobstructed maintenance access around container.`,
    ],
    provenance:
      catalogItem.estimatedMonthlyCareMinutesPerUnit !== null
        ? 'reference_assumption'
        : 'unsupported',
  });

  // 3. Dedicated vertical living-wall irrigation & moisture audit
  if (catalogItem.category === 'living-vertical-plant-wall') {
    tasks.push({
      taskId: `maint-livingwall-${placement.placementId}`,
      placementId: placement.placementId,
      roomId: placement.roomId,
      roomName,
      elementName: catalogItem.displayName,
      isLivingPlant: true,
      taskCategory: 'vertical-wall-irrigation-drainage-and-moisture-audit',
      recommendedCadenceLabel: 'Bi-weekly drip emitter, catch-trough drainage & wall moisture audit',
      estimatedMinutesPerMonth: 45 * qty,
      guidanceText:
        'Inspect top drip-irrigation line for clogged emitters, verify base catch-trough drain flow, check waterproof backing perimeter for condensation or leaks, and trim overhanging vines clear of adjacent walkways.',
      conditionalVariabilityDisclosure:
        'Living wall irrigation pump runtime and nutrient dosing depend on seasonal evaporation rate and indoor relative humidity.',
      accessAndSafetyNotes: [
        'Requires safe step-ladder or front maintenance access zone (>= 0.75 m clear depth).',
        'Verify electrical GFCI protection on any irrigation pump or timer.',
      ],
      provenance: 'reference_assumption',
    });
  }

  return tasks;
}

/**
 * Evaluates a specific `BiophilicScenario` across all rooms in a project.
 */
export function evaluateBiophilicScenario(
  project: Project,
  scenario: BiophilicScenario,
  catalog: BiophilicCatalogItem[],
  p38Report: ReturnType<typeof evaluateProjectDaylightComfort>,
  p33Data: ReturnType<typeof ensureProjectFurnitureLayoutData>,
  p37Data: ReturnType<typeof initializeProjectNaturalVentilationData>
): {
  roomEvaluations: RoomBiophilicPlanEvaluation[];
  allConflicts: BiophilicPlacementConflict[];
  allMaintenanceTasks: BiophilicMaintenanceTask[];
} {
  const rooms = project.floorPlan?.rooms || [];
  const unit = project.unit;
  const roomEvaluations: RoomBiophilicPlanEvaluation[] = [];
  const allConflicts: BiophilicPlacementConflict[] = [];
  const allMaintenanceTasks: BiophilicMaintenanceTask[] = [];

  for (const room of rooms) {
    const roomFloorAreaInUnitSq = round2(room.width * room.length);
    const roomFloorAreaM2 = projectAreaToSqMetres(roomFloorAreaInUnitSq, unit);
    const roomPlacements = scenario.placements.filter((p) => p.roomId === room.id);

    const placementEvaluations: PlacementSuitabilityEvaluation[] = [];
    const roomConflicts: BiophilicPlacementConflict[] = [];
    const roomTasks: BiophilicMaintenanceTask[] = [];
    const roomMissingInputs: string[] = [];

    let livingPlantCount = 0;
    let nonLivingFeatureCount = 0;
    let totalContainerFloorAreaM2 = 0;
    let totalMatureFloorAreaM2: number | null = 0;
    let hasUnknownMatureArea = false;

    for (const pl of roomPlacements) {
      const evalRes = evaluatePlacementSuitability(
        pl,
        room,
        roomPlacements,
        catalog,
        scenario.maintenanceSettings,
        project,
        p38Report,
        p33Data,
        p37Data
      );
      placementEvaluations.push(evalRes);

      if (evalRes.isLivingPlant) {
        livingPlantCount += Math.max(1, pl.quantity);
      } else {
        nonLivingFeatureCount += Math.max(1, pl.quantity);
      }

      if (pl.mountType === 'floor-standing') {
        totalContainerFloorAreaM2 = round3(
          totalContainerFloorAreaM2 + evalRes.containerFootprintAreaM2
        );
        if (evalRes.matureFootprintAreaM2 !== null && totalMatureFloorAreaM2 !== null) {
          totalMatureFloorAreaM2 = round3(totalMatureFloorAreaM2 + evalRes.matureFootprintAreaM2);
        } else {
          hasUnknownMatureArea = true;
        }
      }

      for (const c of evalRes.conflicts) {
        roomConflicts.push(c);
      }
      for (const m of evalRes.missingInputs) {
        if (!roomMissingInputs.includes(m)) roomMissingInputs.push(m);
      }

      const catItem = catalog.find((c) => c.catalogId === pl.catalogId);
      if (catItem) {
        const tasks = buildMaintenanceTasksForPlacement(
          pl,
          catItem,
          room.name,
          scenario.maintenanceSettings
        );
        roomTasks.push(...tasks);
      }
    }

    if (hasUnknownMatureArea && roomPlacements.some((p) => p.mountType === 'floor-standing')) {
      totalMatureFloorAreaM2 = null;
    }

    const floorAreaOccupiedPercent =
      roomFloorAreaM2 > 0 ? round2((totalContainerFloorAreaM2 / roomFloorAreaM2) * 100) : 0;
    const matureFloorAreaOccupiedPercent =
      roomFloorAreaM2 > 0 && totalMatureFloorAreaM2 !== null
        ? round2((totalMatureFloorAreaM2 / roomFloorAreaM2) * 100)
        : null;

    // Check excessive plant density in room
    const densityCheckPct = matureFloorAreaOccupiedPercent ?? floorAreaOccupiedPercent;
    if (
      densityCheckPct > scenario.maintenanceSettings.maxFloorAreaOccupancyPercentThreshold &&
      roomPlacements.length > 0
    ) {
      const densityConflict: BiophilicPlacementConflict = {
        conflictId: `conf-density-${room.id}`,
        placementId: roomPlacements[0].placementId,
        roomId: room.id,
        kind: 'excessive-plant-density-or-maintenance-access',
        severity: 'warning',
        title: `Plant Floor Occupancy (${densityCheckPct}%) Exceeds Room Threshold (${scenario.maintenanceSettings.maxFloorAreaOccupancyPercentThreshold}%)`,
        description: `Floor-standing biophilic placements in "${room.name}" occupy ${densityCheckPct}% of room floor area, exceeding the configured threshold of ${scenario.maintenanceSettings.maxFloorAreaOccupancyPercentThreshold}% and potentially restricting maintenance access.`,
        measuredValue: `${densityCheckPct}% of room floor area`,
        thresholdOrRuleReference: `Max floor area occupancy threshold <= ${scenario.maintenanceSettings.maxFloorAreaOccupancyPercentThreshold}%`,
        remediationHint:
          'Reduce floor planter count, substitute wall-mounted/shelf elements, or adjust the room density threshold.',
      };
      roomConflicts.push(densityConflict);
      if (placementEvaluations[0]) {
        placementEvaluations[0].conflicts.push(densityConflict);
        if (
          placementEvaluations[0].suitabilityStatus ===
          'suitable-based-on-available-evidence'
        ) {
          placementEvaluations[0].suitabilityStatus =
            'potentially-suitable-additional-info-needed';
        }
      }
    }

    const p38RoomEval = p38Report.allRoomEvaluationsForActiveScenario.find(
      (re) => re.roomId === room.id
    );

    let estMinutes: number | null = 0;
    for (const t of roomTasks) {
      if (t.estimatedMinutesPerMonth === null) {
        estMinutes = null;
        break;
      }
      estMinutes += t.estimatedMinutesPerMonth;
    }

    let roomSuitabilitySummary: BiophilicSuitabilityStatus =
      'suitable-based-on-available-evidence';
    if (roomPlacements.length === 0) {
      roomSuitabilitySummary = 'not-assessable-with-current-data';
    } else if (
      placementEvaluations.some(
        (pe) => pe.suitabilityStatus === 'unsuitable-under-current-assumptions'
      )
    ) {
      roomSuitabilitySummary = 'unsuitable-under-current-assumptions';
    } else if (
      placementEvaluations.some(
        (pe) => pe.suitabilityStatus === 'not-assessable-with-current-data'
      )
    ) {
      roomSuitabilitySummary = 'not-assessable-with-current-data';
    } else if (
      placementEvaluations.some(
        (pe) =>
          pe.suitabilityStatus === 'potentially-suitable-additional-info-needed'
      ) ||
      roomConflicts.length > 0
    ) {
      roomSuitabilitySummary = 'potentially-suitable-additional-info-needed';
    }

    const roomCompleteness: P39Completeness =
      roomPlacements.length === 0
        ? 'not_applicable'
        : placementEvaluations.some((pe) => pe.completeness === 'incomplete')
        ? 'incomplete'
        : placementEvaluations.some((pe) => pe.completeness === 'partial') ||
          roomMissingInputs.length > 0
        ? 'partial'
        : 'complete';

    roomEvaluations.push({
      roomId: room.id,
      roomName: room.name,
      roomType: room.type,
      floorLevel: room.floorLevel || 1,
      roomFloorAreaInUnitSq,
      roomFloorAreaM2,
      placements: roomPlacements,
      placementEvaluations,
      livingPlantCount,
      nonLivingFeatureCount,
      totalContainerFloorAreaM2,
      totalMatureFloorAreaM2,
      floorAreaOccupiedPercent,
      matureFloorAreaOccupiedPercent,
      p38DaylightCompleteness: p38RoomEval?.completenessState || 'insufficient-evidence',
      p38MeanDaylightFactorPercent:
        p38RoomEval?.modeC_SimplifiedDaylight.meanDaylightFactorPercent ?? null,
      p38DirectSunCoveragePercent:
        p38RoomEval?.modeB_SolarAndShading.workPlaneDirectSunCoveragePercent ?? null,
      p33WalkwayPassable: !roomConflicts.some(
        (c) =>
          c.kind === 'furniture-collision-p33' ||
          c.kind === 'door-or-opening-swing-interference-p33' ||
          c.kind === 'narrowed-circulation-walkway-p33'
      ),
      p34AccessibilityClear: !roomConflicts.some(
        (c) => c.kind === 'obstructed-accessible-route-or-turning-p34'
      ),
      p37VentilationClear: !roomConflicts.some(
        (c) => c.kind === 'ventilation-opening-obstruction-p37'
      ),
      roomSuitabilitySummary,
      conflicts: roomConflicts,
      maintenanceTasks: roomTasks,
      estimatedMonthlyMaintenanceMinutes: roomPlacements.length === 0 ? 0 : estMinutes,
      missingInputs: roomMissingInputs,
      provenance: 'derived_deterministic',
      completeness: roomCompleteness,
    });

    allConflicts.push(...roomConflicts);
    allMaintenanceTasks.push(...roomTasks);
  }

  return { roomEvaluations, allConflicts, allMaintenanceTasks };
}

/**
 * Compares two P39 scenarios side-by-side per P39 Section 3.F.
 * Explicitly sets wellbeing, productivity, air purification, and energy savings to null (`unquantified`).
 */
export function compareBiophilicScenarios(
  project: Project,
  scenarioA: BiophilicScenario,
  scenarioB: BiophilicScenario,
  catalog: BiophilicCatalogItem[],
  p38Report: ReturnType<typeof evaluateProjectDaylightComfort>,
  p33Data: ReturnType<typeof ensureProjectFurnitureLayoutData>,
  p37Data: ReturnType<typeof initializeProjectNaturalVentilationData>
): BiophilicScenarioComparisonResult {
  const evalA = evaluateBiophilicScenario(
    project,
    scenarioA,
    catalog,
    p38Report,
    p33Data,
    p37Data
  );
  const evalB = evaluateBiophilicScenario(
    project,
    scenarioB,
    catalog,
    p38Report,
    p33Data,
    p37Data
  );

  const livingA = evalA.roomEvaluations.reduce((s, r) => s + r.livingPlantCount, 0);
  const livingB = evalB.roomEvaluations.reduce((s, r) => s + r.livingPlantCount, 0);
  const nonLivingA = evalA.roomEvaluations.reduce((s, r) => s + r.nonLivingFeatureCount, 0);
  const nonLivingB = evalB.roomEvaluations.reduce((s, r) => s + r.nonLivingFeatureCount, 0);

  const areaA = round3(
    evalA.roomEvaluations.reduce((s, r) => s + r.totalContainerFloorAreaM2, 0)
  );
  const areaB = round3(
    evalB.roomEvaluations.reduce((s, r) => s + r.totalContainerFloorAreaM2, 0)
  );

  const matureA = evalA.roomEvaluations.some((r) => r.totalMatureFloorAreaM2 === null)
    ? null
    : round3(
        evalA.roomEvaluations.reduce((s, r) => s + (r.totalMatureFloorAreaM2 ?? 0), 0)
      );
  const matureB = evalB.roomEvaluations.some((r) => r.totalMatureFloorAreaM2 === null)
    ? null
    : round3(
        evalB.roomEvaluations.reduce((s, r) => s + (r.totalMatureFloorAreaM2 ?? 0), 0)
      );

  const circWarningsA = evalA.allConflicts.filter(
    (c) =>
      c.kind === 'out-of-room-bounds' ||
      c.kind === 'furniture-collision-p33' ||
      c.kind === 'door-or-opening-swing-interference-p33' ||
      c.kind === 'narrowed-circulation-walkway-p33' ||
      c.kind === 'obstructed-accessible-route-or-turning-p34'
  ).length;
  const circWarningsB = evalB.allConflicts.filter(
    (c) =>
      c.kind === 'out-of-room-bounds' ||
      c.kind === 'furniture-collision-p33' ||
      c.kind === 'door-or-opening-swing-interference-p33' ||
      c.kind === 'narrowed-circulation-walkway-p33' ||
      c.kind === 'obstructed-accessible-route-or-turning-p34'
  ).length;

  const allPlacementEvalsA = evalA.roomEvaluations.flatMap((r) => r.placementEvaluations);
  const allPlacementEvalsB = evalB.roomEvaluations.flatMap((r) => r.placementEvaluations);

  const suitableA = allPlacementEvalsA.filter(
    (pe) => pe.suitabilityStatus === 'suitable-based-on-available-evidence'
  ).length;
  const suitableB = allPlacementEvalsB.filter(
    (pe) => pe.suitabilityStatus === 'suitable-based-on-available-evidence'
  ).length;

  const unsuitableA = allPlacementEvalsA.filter(
    (pe) => pe.suitabilityStatus === 'unsuitable-under-current-assumptions'
  ).length;
  const unsuitableB = allPlacementEvalsB.filter(
    (pe) => pe.suitabilityStatus === 'unsuitable-under-current-assumptions'
  ).length;

  const maintA = evalA.roomEvaluations.some(
    (r) => r.estimatedMonthlyMaintenanceMinutes === null
  )
    ? null
    : evalA.roomEvaluations.reduce(
        (s, r) => s + (r.estimatedMonthlyMaintenanceMinutes ?? 0),
        0
      );
  const maintB = evalB.roomEvaluations.some(
    (r) => r.estimatedMonthlyMaintenanceMinutes === null
  )
    ? null
    : evalB.roomEvaluations.reduce(
        (s, r) => s + (r.estimatedMonthlyMaintenanceMinutes ?? 0),
        0
      );

  const vertA = scenarioA.placements.filter((p) => p.mountType === 'wall-mounted').length;
  const vertB = scenarioB.placements.filter((p) => p.mountType === 'wall-mounted').length;

  const completenessA: P39Completeness = allPlacementEvalsA.some(
    (p) => p.completeness === 'incomplete'
  )
    ? 'incomplete'
    : allPlacementEvalsA.some((p) => p.completeness === 'partial')
    ? 'partial'
    : 'complete';
  const completenessB: P39Completeness = allPlacementEvalsB.some(
    (p) => p.completeness === 'incomplete'
  )
    ? 'incomplete'
    : allPlacementEvalsB.some((p) => p.completeness === 'partial')
    ? 'partial'
    : 'complete';

  const scenarioAConstraints: string[] = [];
  const scenarioBConstraints: string[] = [];
  if (vertA > 0) {
    scenarioAConstraints.push(
      `${vertA} wall-mounted installation(s) requiring wall backing/anchorage and moisture verification.`
    );
  }
  if (vertB > 0) {
    scenarioBConstraints.push(
      `${vertB} wall-mounted installation(s) requiring wall backing/anchorage and moisture verification.`
    );
  }
  if (evalA.allConflicts.length > 0) {
    scenarioAConstraints.push(
      `${evalA.allConflicts.length} spatial, daylight, or safety conflict(s) flagged.`
    );
  }
  if (evalB.allConflicts.length > 0) {
    scenarioBConstraints.push(
      `${evalB.allConflicts.length} spatial, daylight, or safety conflict(s) flagged.`
    );
  }

  const tradeOffSummary: string[] = [
    `Plant Count & Type: "${scenarioA.name}" includes ${livingA} living plant(s) and ${nonLivingA} non-living feature(s) vs. ${livingB} living plant(s) and ${nonLivingB} non-living feature(s) in "${scenarioB.name}".`,
    `Floor Space Impact: "${scenarioA.name}" occupies ${areaA} m² container floor area vs. ${areaB} m² in "${scenarioB.name}" (Δ = ${round3(areaB - areaA)} m²).`,
    `Maintenance Demand: "${scenarioA.name}" requires ${maintA !== null ? `${maintA} min/month` : 'unquantified (incomplete species data)'} vs. ${maintB !== null ? `${maintB} min/month` : 'unquantified'} in "${scenarioB.name}".`,
  ];

  return {
    comparisonId: `p39-cmp-${scenarioA.scenarioId}-vs-${scenarioB.scenarioId}`,
    scenarioAId: scenarioA.scenarioId,
    scenarioAName: scenarioA.name,
    scenarioBId: scenarioB.scenarioId,
    scenarioBName: scenarioB.name,
    comparedAt: new Date().toISOString(),
    metrics: {
      livingPlantCountA: livingA,
      livingPlantCountB: livingB,
      deltaLivingPlantCount: livingB - livingA,
      nonLivingFeatureCountA: nonLivingA,
      nonLivingFeatureCountB: nonLivingB,
      deltaNonLivingFeatureCount: nonLivingB - nonLivingA,
      floorAreaOccupiedM2A: areaA,
      floorAreaOccupiedM2B: areaB,
      deltaFloorAreaOccupiedM2: round3(areaB - areaA),
      matureFloorAreaOccupiedM2A: matureA,
      matureFloorAreaOccupiedM2B: matureB,
      circulationAndAccessibilityWarningsCountA: circWarningsA,
      circulationAndAccessibilityWarningsCountB: circWarningsB,
      deltaWarningsCount: circWarningsB - circWarningsA,
      suitablePlacementsCountA: suitableA,
      suitablePlacementsCountB: suitableB,
      unsuitablePlacementsCountA: unsuitableA,
      unsuitablePlacementsCountB: unsuitableB,
      estimatedMonthlyMaintenanceMinutesA: maintA,
      estimatedMonthlyMaintenanceMinutesB: maintB,
      deltaMonthlyMaintenanceMinutes:
        maintA !== null && maintB !== null ? maintB - maintA : null,
      verticalInstallationsCountA: vertA,
      verticalInstallationsCountB: vertB,
      completenessA,
      completenessB,
    },
    installationConstraintsComparison: {
      scenarioAConstraints,
      scenarioBConstraints,
    },
    unquantifiedBenefitDisclosures: {
      occupantWellbeingScore: null,
      productivityGainPercent: null,
      airPurificationVocRemovalRate: null,
      thermalOrEnergySavingsKwh: null,
      status: 'unquantified_unsupported_without_clinical_or_chamber_evidence',
      explanation:
        'P39 does not fabricate numerical scores for occupant wellbeing, workplace productivity gains, indoor VOC/CO2 air purification, or HVAC energy savings. Such outcomes depend on occupant activity, chamber air-exchange rates, leaf area index, and clinical controls not modeled in architectural floor plans.',
    },
    tradeOffSummary,
  };
}

/**
 * Generates actionable P39 recommendations for rooms with missing plantscapes, spatial conflicts,
 * unsuitable light levels, or toxicity mismatches.
 */
export function generateBiophilicRecommendations(
  project: Project,
  roomEvaluations: RoomBiophilicPlanEvaluation[],
  catalog: BiophilicCatalogItem[],
  maintenanceSettings: BiophilicMaintenanceSettings
): BiophilicRecommendation[] {
  const recommendations: BiophilicRecommendation[] = [];
  const unit = project.unit;
  const castIron = catalog.find((c) => c.catalogId === 'plant-aspidistra-elatior') || catalog[0];
  const parlourPalm =
    catalog.find((c) => c.catalogId === 'plant-chamaedorea-elegans') || catalog[0];
  const mossPanel =
    catalog.find((c) => c.catalogId === 'element-preserved-reindeer-moss-panel') || catalog[0];

  for (const rmEval of roomEvaluations) {
    const room = (project.floorPlan?.rooms || []).find((r) => r.id === rmEval.roomId);
    if (!room) continue;

    // 1. Recommend adding a suitable plant or non-living feature to empty rooms
    if (rmEval.placements.length === 0) {
      const df = rmEval.p38MeanDaylightFactorPercent;
      const candidate =
        df !== null && df >= 1.5
          ? parlourPalm
          : df !== null && df >= 0.5
          ? castIron
          : mossPanel;

      const mountType: BiophilicPlacementRecord['mountType'] =
        candidate.category === 'non-living-preserved-moss-panel'
          ? 'wall-mounted'
          : 'floor-standing';

      const proposedPlacement = buildSeededPlacement(
        `p39-rec-place-${room.id}`,
        candidate,
        room,
        unit,
        0,
        mountType,
        'north'
      );
      proposedPlacement.provenance = 'derived_deterministic';

      recommendations.push({
        recommendationId: `rec-p39-add-${room.id}`,
        roomId: room.id,
        roomName: room.name,
        category:
          candidate.isLivingPlant
            ? 'add-suitable-room-plantscape'
            : 'add-vertical-moss-or-living-wall-concept',
        priority: 'medium',
        title: `Add ${candidate.displayName} in ${room.name}`,
        rationale:
          df !== null
            ? `Room "${room.name}" currently has no biophilic elements and has a P38 Mean Daylight Factor of ${df}%. "${candidate.displayName}" matches this light regime and is verified pet-safe.`
            : `Room "${room.name}" has unverified/low daylight; "${candidate.displayName}" requires no photosynthetic light or irrigation.`,
        evidenceAndAssumptions: `P38 Mean DF: ${df ?? 'uncalculated'}%; container footprint ${proposedPlacement.containerWidth}×${proposedPlacement.containerDepth} ${unit}.`,
        expectedImpactSummary: `Adds 1 ${candidate.isLivingPlant ? 'living plant' : 'non-living biophilic feature'} in "${room.name}" clear of doorways and circulation.`,
        unresolvedConstraints: candidate.missingInformationNotes,
        canPreviewAndApply: true,
        proposedMutation: {
          action: 'add-placement',
          roomId: room.id,
          placementToAdd: proposedPlacement,
        },
      });
    }

    // 2. Recommend resolving light, toxicity, or spatial conflicts on existing placements
    for (const pe of rmEval.placementEvaluations) {
      const existingPl = rmEval.placements.find((p) => p.placementId === pe.placementId);
      if (!existingPl) continue;

      if (pe.lightSuitabilityStatus === 'unsuitable-insufficient-daylight') {
        const replacement =
          rmEval.p38MeanDaylightFactorPercent !== null &&
          rmEval.p38MeanDaylightFactorPercent >= 0.5
            ? castIron
            : mossPanel;
        const updatedPl: BiophilicPlacementRecord = {
          ...existingPl,
          catalogId: replacement.catalogId,
          label: `${replacement.displayName} (${room.name})`,
          mountType:
            replacement.category === 'non-living-preserved-moss-panel'
              ? 'wall-mounted'
              : existingPl.mountType,
          containerWidth: metresToProjectUnit(replacement.defaultContainerWidthMetres, unit),
          containerDepth: metresToProjectUnit(replacement.defaultContainerDepthMetres, unit),
          installedHeight: metresToProjectUnit(replacement.defaultContainerHeightMetres, unit),
          expectedMatureWidth: replacement.expectedMatureWidthRangeMetres
            ? metresToProjectUnit(replacement.expectedMatureWidthRangeMetres.max, unit)
            : null,
          expectedMatureDepth: replacement.expectedMatureDepthRangeMetres
            ? metresToProjectUnit(replacement.expectedMatureDepthRangeMetres.max, unit)
            : null,
          provenance: 'derived_deterministic',
          completeness: replacement.completeness,
          updatedAt: new Date().toISOString(),
        };

        recommendations.push({
          recommendationId: `rec-p39-sub-light-${existingPl.placementId}`,
          roomId: room.id,
          roomName: room.name,
          category: 'substitute-low-light-tolerant-species',
          priority: 'high',
          title: `Substitute "${replacement.displayName}" for Low-Light Compatibility in ${room.name}`,
          rationale: `"${pe.displayName}" is unsuitable under the current P38 Daylight Factor (${pe.localPointDaylightFactorPercent ?? pe.roomMeanDaylightFactorPercent ?? 0}%). Substituting "${replacement.displayName}" resolves the light mismatch.`,
          evidenceAndAssumptions: `Replaces catalogId "${existingPl.catalogId}" with "${replacement.catalogId}".`,
          expectedImpactSummary: 'Resolves insufficient-daylight conflict in P39.',
          unresolvedConstraints: [],
          canPreviewAndApply: true,
          proposedMutation: {
            action: 'update-placement',
            roomId: room.id,
            placementToUpdate: updatedPl,
          },
        });
      }

      if (
        pe.conflicts.some((c) => c.kind === 'toxicity-hazard-in-occupied-zone') &&
        existingPl.catalogId !== castIron.catalogId
      ) {
        const updatedPl: BiophilicPlacementRecord = {
          ...existingPl,
          catalogId: castIron.catalogId,
          label: `${castIron.displayName} (${room.name})`,
          containerWidth: metresToProjectUnit(castIron.defaultContainerWidthMetres, unit),
          containerDepth: metresToProjectUnit(castIron.defaultContainerDepthMetres, unit),
          installedHeight: metresToProjectUnit(castIron.defaultContainerHeightMetres, unit),
          expectedMatureWidth: castIron.expectedMatureWidthRangeMetres
            ? metresToProjectUnit(castIron.expectedMatureWidthRangeMetres.max, unit)
            : null,
          expectedMatureDepth: castIron.expectedMatureDepthRangeMetres
            ? metresToProjectUnit(castIron.expectedMatureDepthRangeMetres.max, unit)
            : null,
          provenance: 'derived_deterministic',
          completeness: castIron.completeness,
          updatedAt: new Date().toISOString(),
        };

        recommendations.push({
          recommendationId: `rec-p39-sub-pet-${existingPl.placementId}`,
          roomId: room.id,
          roomName: room.name,
          category: 'substitute-pet-safe-non-toxic-species',
          priority: 'high',
          title: `Substitute Pet-Safe "${castIron.displayName}" in ${room.name}`,
          rationale: `Household setting has pets/children enabled (${maintenanceSettings.hasPetsOrYoungChildren}), and "${pe.displayName}" has a toxicity or unverified-safety warning.`,
          evidenceAndAssumptions:
            'Substitutes Aspidistra elatior (verified non-toxic per ASPCA/RHS reference).',
          expectedImpactSummary: 'Eliminates pet/human toxicity conflict in occupied room zone.',
          unresolvedConstraints: [],
          canPreviewAndApply: true,
          proposedMutation: {
            action: 'update-placement',
            roomId: room.id,
            placementToUpdate: updatedPl,
          },
        });
      }

      if (
        pe.conflicts.some(
          (c) =>
            c.kind === 'out-of-room-bounds' ||
            c.kind === 'furniture-collision-p33' ||
            c.kind === 'door-or-opening-swing-interference-p33'
        )
      ) {
        const effW = existingPl.expectedMatureWidth ?? existingPl.containerWidth;
        const effD = existingPl.expectedMatureDepth ?? existingPl.containerDepth;
        const margin = unit === 'feet' ? 0.5 : 0.15;
        const safeX = round2(Math.max(margin, Math.min(room.width - effW - margin, room.width - effW - margin)));
        const safeY = round2(Math.max(margin, Math.min(room.length - effD - margin, room.length - effD - margin)));

        const updatedPl: BiophilicPlacementRecord = {
          ...existingPl,
          localX: safeX,
          localY: safeY,
          updatedAt: new Date().toISOString(),
        };

        recommendations.push({
          recommendationId: `rec-p39-relocate-${existingPl.placementId}`,
          roomId: room.id,
          roomName: room.name,
          category: 'resolve-circulation-or-door-conflict',
          priority: 'high',
          title: `Relocate "${existingPl.label}" Clear of Door/Furniture Conflict in ${room.name}`,
          rationale: `Placement "${existingPl.label}" currently overlaps room boundaries, a doorway swing zone, or placed furniture.`,
          evidenceAndAssumptions: `Moves placement to room-local coordinates (${safeX}, ${safeY}) ${unit}.`,
          expectedImpactSummary: 'Restores clear boundary and circulation geometry.',
          unresolvedConstraints: [],
          canPreviewAndApply: true,
          proposedMutation: {
            action: 'update-placement',
            roomId: room.id,
            placementToUpdate: updatedPl,
          },
        });
      }
    }
  }

  return recommendations;
}

/**
 * Exports normalized P39 summaries for P31 Multi-Option Design Comparison per P39 Section 5.
 */
export function getP39BiophilicSummaryForComparison(
  project: Project
): P39OptionBiophilicComparisonSummary[] {
  const p39Data = initializeProjectBiophilicPlannerData(project);
  const catalog = getProjectBiophilicCatalog(project, p39Data);
  const p38Report = evaluateProjectDaylightComfort(project);
  const p33Data = ensureProjectFurnitureLayoutData(project);
  const p37Data = initializeProjectNaturalVentilationData(project);
  const comparableOptions = extractComparableOptions(project);

  const activeScenario =
    p39Data.scenarios.find((s) => s.scenarioId === p39Data.activeScenarioId) ||
    p39Data.scenarios[0];

  const evalRes = evaluateBiophilicScenario(
    project,
    activeScenario,
    catalog,
    p38Report,
    p33Data,
    p37Data
  );

  const livingCount = evalRes.roomEvaluations.reduce((s, r) => s + r.livingPlantCount, 0);
  const nonLivingCount = evalRes.roomEvaluations.reduce(
    (s, r) => s + r.nonLivingFeatureCount,
    0
  );
  const totalAreaM2 = round3(
    evalRes.roomEvaluations.reduce((s, r) => s + r.totalContainerFloorAreaM2, 0)
  );
  const allPe = evalRes.roomEvaluations.flatMap((r) => r.placementEvaluations);
  const suitableCount = allPe.filter(
    (p) => p.suitabilityStatus === 'suitable-based-on-available-evidence'
  ).length;
  const estMaint = evalRes.roomEvaluations.some(
    (r) => r.estimatedMonthlyMaintenanceMinutes === null
  )
    ? null
    : evalRes.roomEvaluations.reduce(
        (s, r) => s + (r.estimatedMonthlyMaintenanceMinutes ?? 0),
        0
      );

  const completeness: P39Completeness = allPe.some((p) => p.completeness === 'incomplete')
    ? 'incomplete'
    : allPe.some((p) => p.completeness === 'partial')
    ? 'partial'
    : 'complete';

  const optionsList =
    comparableOptions.length > 0
      ? comparableOptions
      : [{ optionId: 'opt-baseline', optionName: project.name, kind: 'baseline' }];

  return optionsList.map((opt) => ({
    optionId: opt.optionId,
    optionName: (opt as any).optionName || (opt as any).name || project.name,
    engineVersion: P39_BIOPHILIC_PLANNER_ENGINE_VERSION,
    activeScenarioName: activeScenario.name,
    livingPlantCount: livingCount,
    nonLivingFeatureCount: nonLivingCount,
    totalFloorAreaOccupiedM2: totalAreaM2,
    suitablePlacementsCount: suitableCount,
    conflictWarningsCount: evalRes.allConflicts.length,
    estimatedMonthlyMaintenanceMinutes: estMaint,
    completeness,
    provenance: 'derived_deterministic',
    summaryNote: `${livingCount} living plant(s), ${nonLivingCount} non-living feature(s), ${totalAreaM2} m² floor area, ${suitableCount}/${allPe.length} suitable under "${activeScenario.name}".`,
    limitations: [
      'Suitability reflects P38 screening daylight estimates and reference horticultural ranges; it does not guarantee plant survival.',
      'Wellbeing, productivity, and air-purification effects remain unquantified.',
    ],
  }));
}

export const exportP39SummaryForP31 = getP39BiophilicSummaryForComparison;

/**
 * Evaluates the complete P39 Biophilic & Indoor Plantscape Planner report for a project.
 * Never mutates P38, P33, P34, P37, or project geometry.
 */
export function evaluateProjectBiophilicPlanner(
  project: Project
): BiophilicPlannerProjectReport {
  const p39Data = initializeProjectBiophilicPlannerData(project);
  const catalog = getProjectBiophilicCatalog(project, p39Data);
  const p38Report = evaluateProjectDaylightComfort(project);
  const p33Data = ensureProjectFurnitureLayoutData(project);
  const p34Report = evaluateUniversalAccessibility(project);
  const p35Data = initializeProjectMaterialAdvisorData(project);
  const p36Data = initializeProjectAcousticPlannerData(project);
  const p37Data = initializeProjectNaturalVentilationData(project);
  const p32Profile = initializePersonalizationProfile(project);

  const currentFingerprint = computeBiophilicSourceFingerprint(
    project,
    p39Data,
    p38Report.sourceFingerprint
  );

  const isP38LinkStale =
    Boolean(p39Data.lastP38SourceFingerprint) &&
    p39Data.lastP38SourceFingerprint !== p38Report.sourceFingerprint;

  const isStale =
    isP38LinkStale ||
    (Boolean(p39Data.lastSourceFingerprint) &&
      p39Data.lastSourceFingerprint !== currentFingerprint);

  const staleReasons: string[] = [];
  if (isP38LinkStale) {
    staleReasons.push(
      'P38 daylight, window geometry, orientation, or active solar scenario changed since P39 suitability was last recorded; suitability has been deterministically recomputed against current P38 outputs.'
    );
  }
  if (
    Boolean(p39Data.lastSourceFingerprint) &&
    p39Data.lastSourceFingerprint !== currentFingerprint &&
    !isP38LinkStale
  ) {
    staleReasons.push(
      'Room geometry, P33 furniture layout, or P39 plantscape placements changed since the last recorded fingerprint.'
    );
  }

  const activeScenario =
    p39Data.scenarios.find((s) => s.scenarioId === p39Data.activeScenarioId) ||
    p39Data.scenarios[0];
  const comparisonScenario =
    p39Data.scenarios.find((s) => s.scenarioId === p39Data.comparisonScenarioId) ||
    p39Data.scenarios[1] ||
    null;

  const { roomEvaluations, allConflicts, allMaintenanceTasks } = evaluateBiophilicScenario(
    project,
    activeScenario,
    catalog,
    p38Report,
    p33Data,
    p37Data
  );

  const selectedRoomId =
    p39Data.selectedRoomId && roomEvaluations.some((r) => r.roomId === p39Data.selectedRoomId)
      ? p39Data.selectedRoomId
      : roomEvaluations[0]?.roomId || null;

  const activeRoomEvaluation =
    roomEvaluations.find((r) => r.roomId === selectedRoomId) || roomEvaluations[0] || null;

  const recommendations = generateBiophilicRecommendations(
    project,
    roomEvaluations,
    catalog,
    activeScenario.maintenanceSettings
  );

  const scenarioComparison = comparisonScenario
    ? compareBiophilicScenarios(
        project,
        activeScenario,
        comparisonScenario,
        catalog,
        p38Report,
        p33Data,
        p37Data
      )
    : null;

  const allPlacementEvals = roomEvaluations.flatMap((r) => r.placementEvaluations);
  const totalLivingPlants = roomEvaluations.reduce((s, r) => s + r.livingPlantCount, 0);
  const totalNonLivingFeatures = roomEvaluations.reduce(
    (s, r) => s + r.nonLivingFeatureCount,
    0
  );
  const totalContainerFloorAreaM2 = round3(
    roomEvaluations.reduce((s, r) => s + r.totalContainerFloorAreaM2, 0)
  );
  const totalMatureFloorAreaM2 = roomEvaluations.some(
    (r) => r.totalMatureFloorAreaM2 === null
  )
    ? null
    : round3(
        roomEvaluations.reduce((s, r) => s + (r.totalMatureFloorAreaM2 ?? 0), 0)
      );
  const totalEstimatedMonthlyMaintenanceMinutes = roomEvaluations.some(
    (r) => r.estimatedMonthlyMaintenanceMinutes === null
  )
    ? null
    : roomEvaluations.reduce(
        (s, r) => s + (r.estimatedMonthlyMaintenanceMinutes ?? 0),
        0
      );

  const suitablePlacementsCount = allPlacementEvals.filter(
    (p) => p.suitabilityStatus === 'suitable-based-on-available-evidence'
  ).length;
  const potentiallySuitableCount = allPlacementEvals.filter(
    (p) => p.suitabilityStatus === 'potentially-suitable-additional-info-needed'
  ).length;
  const unsuitablePlacementsCount = allPlacementEvals.filter(
    (p) => p.suitabilityStatus === 'unsuitable-under-current-assumptions'
  ).length;
  const notAssessableCount = allPlacementEvals.filter(
    (p) => p.suitabilityStatus === 'not-assessable-with-current-data'
  ).length;

  const blockingConflictsCount = allConflicts.filter(
    (c) => c.severity === 'blocking-conflict'
  ).length;
  const warningConflictsCount = allConflicts.filter(
    (c) => c.severity !== 'blocking-conflict'
  ).length;

  // Cross-feature P32 personalization check
  const activeAlt = project.designAlternatives?.find(
    (a) => a.id === project.activeAlternativeId
  );
  const biophilicPriorityRoomCount = activeAlt
    ? Object.values(activeAlt.interiors || {}).filter(
        (ir) => ir.designPriority === 'biophilic-light'
      ).length
    : 0;

  // Cross-feature P35 moisture & material finish check
  const moistureSensitiveInstallationsCount = activeScenario.placements.filter((pl) => {
    const cat = catalog.find((c) => c.catalogId === pl.catalogId);
    return (
      cat?.category === 'living-vertical-plant-wall' ||
      cat?.wateringDemand === 'high-consistent-moisture-or-irrigated' ||
      cat?.wateringDemand === 'moderate-even-moisture'
    );
  }).length;

  const materialFinishWarnings: string[] = [];
  if (moistureSensitiveInstallationsCount > 0) {
    materialFinishWarnings.push(
      `${moistureSensitiveInstallationsCount} irrigated or moderately watered placement(s) require waterproof saucers/drip liners to protect interior floor/wall finishes (${p35Data.climateContext.profileName}).`
    );
  }

  // Cross-feature P36 acoustic coordination check
  const preservedMossOrVegetatedWallCount = activeScenario.placements.filter((pl) => {
    const cat = catalog.find((c) => c.catalogId === pl.catalogId);
    return (
      cat?.category === 'non-living-preserved-moss-panel' ||
      cat?.category === 'living-vertical-plant-wall'
    );
  }).length;

  const overallCompleteness: P39Completeness =
    allPlacementEvals.length === 0
      ? 'not_applicable'
      : allPlacementEvals.some((p) => p.completeness === 'incomplete')
      ? 'incomplete'
      : allPlacementEvals.some((p) => p.completeness === 'partial')
      ? 'partial'
      : 'complete';

  return {
    reportId: `p39-report-${project.id}-${p39Data.requestSequenceId}`,
    schemaVersion: P39_BIOPHILIC_SCHEMA_VERSION,
    engineVersion: P39_BIOPHILIC_PLANNER_ENGINE_VERSION,
    projectId: project.id,
    projectName: project.name,
    unit: project.unit,
    evaluatedAt: new Date().toISOString(),
    requestSequenceId: p39Data.requestSequenceId,
    sourceFingerprint: currentFingerprint,
    p38SourceFingerprint: p38Report.sourceFingerprint,
    isStale,
    isP38LinkStale,
    staleReasons,
    isConfigured: p39Data.isConfigured,
    selectedRoomId,
    activeScenario,
    comparisonScenario,
    allScenarios: p39Data.scenarios,
    catalog,
    maintenanceSettings: activeScenario.maintenanceSettings,
    roomEvaluations,
    activeRoomEvaluation,
    allConflicts,
    allMaintenanceTasks,
    recommendations,
    scenarioComparison,
    totals: {
      totalLivingPlants,
      totalNonLivingFeatures,
      totalContainerFloorAreaM2,
      totalMatureFloorAreaM2,
      totalEstimatedMonthlyMaintenanceMinutes,
      suitablePlacementsCount,
      potentiallySuitableCount,
      unsuitablePlacementsCount,
      notAssessableCount,
      blockingConflictsCount,
      warningConflictsCount,
    },
    crossFeatureIntegration: {
      p30ComplianceSeparationNote:
        'P39 plant suitability and biophilic recommendations are strictly interior planning assessments and are never treated as P30 statutory building-code or brief compliance approvals.',
      p31ComparisonSummaries: getP39BiophilicSummaryForComparison(project),
      p32PersonalizationAlignment: {
        hasBiophilicPriorityRoomCount: biophilicPriorityRoomCount,
        maintenanceToleranceUsed: activeScenario.maintenanceSettings.userMaintenanceTolerance,
        note: `Read-only alignment with P32 Personalization (${
          p32Profile.items?.length || 0
        } preference items); P32 preferences are never overwritten by P39.`,
      },
      p33FurnitureAndCirculationStatus: {
        checkedFurnitureItemsCount: (p33Data.instances || []).length,
        checkedDoorOpeningsCount: (p33Data.knownOpenings || []).filter(
          (o) => o.type === 'door' || o.type === 'open-passage'
        ).length,
        circulationConflictsCount: allConflicts.filter(
          (c) =>
            c.kind === 'furniture-collision-p33' ||
            c.kind === 'door-or-opening-swing-interference-p33' ||
            c.kind === 'narrowed-circulation-walkway-p33'
        ).length,
      },
      p34AccessibilityStatus: {
        minAccessibleRouteWidthMetres: 0.9,
        accessibilityConflictsCount: allConflicts.filter(
          (c) => c.kind === 'obstructed-accessible-route-or-turning-p34'
        ).length,
        nonCertificationDisclaimer:
          `Checked against P34 profile (${p34Report.activeRuleProfile.name}) for route narrowing; P39 does not certify statutory ADA/ISO accessibility compliance.`,
      },
      p35MaterialAndMoistureStatus: {
        moistureSensitiveInstallationsCount,
        materialFinishWarnings,
      },
      p36AcousticCoordinationStatus: {
        preservedMossOrVegetatedWallCount,
        acousticNote:
          preservedMossOrVegetatedWallCount > 0
            ? `${preservedMossOrVegetatedWallCount} wall-mounted moss/living-wall feature(s) present in project (${
                (p36Data.noiseObservations || []).length
              } P36 noise observations). P39 does NOT claim acoustic absorption (αw/NRC) or sound insulation (Rw/STC) gains without laboratory acoustic test data in P36.`
            : 'No wall-mounted moss or living-wall features currently placed; P36 acoustic calculations remain unaffected.',
      },
      p37VentilationCoordinationStatus: {
        checkedVentilationOpeningsCount: (p37Data.openings || []).length,
        ventilationObstructionConflictsCount: allConflicts.filter(
          (c) => c.kind === 'ventilation-opening-obstruction-p37'
        ).length,
      },
      p38DaylightIntegrationStatus: {
        p38ActiveScenarioName: p38Report.activeScenario.name,
        roomsWithCalculatedDaylightCount:
          p38Report.allRoomEvaluationsForActiveScenario.filter(
            (r) => r.modeC_SimplifiedDaylight.meanDaylightFactorPercent !== null
          ).length,
        isP38DataStale: isP38LinkStale,
        daylightNonGuaranteeNote:
          'Consumes P38 Mode B & Mode C daylight outputs read-only without modifying P38 windows or scenarios. Analytical Daylight Factor does not guarantee biological plant survival.',
      },
    },
    overallProvenance: 'derived_deterministic',
    overallCompleteness,
    professionalDisclaimer: P39_PROFESSIONAL_DISCLAIMER,
  };
}

/**
 * Generates a non-destructive preview (`BiophilicProposalPreviewDiff`) for one or more selected
 * P39 recommendation IDs without mutating the live `Project` per P39 Section 6.
 */
export function previewBiophilicRecommendations(
  project: Project,
  selectedRecommendationIds: string[]
): BiophilicProposalPreviewDiff {
  const beforeReport = evaluateProjectBiophilicPlanner(project);
  const selectedRecs = beforeReport.recommendations.filter((r) =>
    selectedRecommendationIds.includes(r.recommendationId)
  );

  const clonedProject: Project = JSON.parse(JSON.stringify(project));
  const p39Data = initializeProjectBiophilicPlannerData(clonedProject);
  const catalog = getProjectBiophilicCatalog(clonedProject, p39Data);
  const activeScenIdx = p39Data.scenarios.findIndex(
    (s) => s.scenarioId === p39Data.activeScenarioId
  );
  const targetScenIdx = activeScenIdx >= 0 ? activeScenIdx : 0;
  const activeScenario = p39Data.scenarios[targetScenIdx];

  const blockingValidationErrors: string[] = [];
  const warningNotices: string[] = [];
  const placementDiffs: BiophilicProposalPreviewDiff['placementDiffs'] = [];

  if (selectedRecs.length === 0) {
    blockingValidationErrors.push(
      'No valid P39 recommendation IDs were selected for preview.'
    );
  }

  for (const rec of selectedRecs) {
    const mut = rec.proposedMutation;
    const room = (clonedProject.floorPlan?.rooms || []).find((r) => r.id === mut.roomId);
    const roomName = room?.name || rec.roomName;

    if (mut.action === 'add-placement' && mut.placementToAdd) {
      const val = validateBiophilicPlacementRecord(mut.placementToAdd, catalog);
      if (!val.valid) {
        blockingValidationErrors.push(...val.errors);
      } else if (
        !activeScenario.placements.some(
          (p) => p.placementId === mut.placementToAdd!.placementId
        )
      ) {
        activeScenario.placements.push(JSON.parse(JSON.stringify(mut.placementToAdd)));
        placementDiffs.push({
          placementId: mut.placementToAdd.placementId,
          roomId: mut.roomId,
          roomName,
          changeType: 'added',
          beforeSummary: 'Not present',
          afterSummary: `${mut.placementToAdd.label} at (${mut.placementToAdd.localX}, ${mut.placementToAdd.localY}) ${mut.placementToAdd.unit}`,
        });
      }
    } else if (mut.action === 'update-placement' && mut.placementToUpdate) {
      const val = validateBiophilicPlacementRecord(mut.placementToUpdate, catalog);
      if (!val.valid) {
        blockingValidationErrors.push(...val.errors);
      } else {
        const idx = activeScenario.placements.findIndex(
          (p) => p.placementId === mut.placementToUpdate!.placementId
        );
        if (idx >= 0) {
          const prev = activeScenario.placements[idx];
          activeScenario.placements[idx] = JSON.parse(
            JSON.stringify(mut.placementToUpdate)
          );
          placementDiffs.push({
            placementId: mut.placementToUpdate.placementId,
            roomId: mut.roomId,
            roomName,
            changeType: 'modified',
            beforeSummary: `${prev.label} [catalog=${prev.catalogId}, pos=(${prev.localX}, ${prev.localY})]`,
            afterSummary: `${mut.placementToUpdate.label} [catalog=${mut.placementToUpdate.catalogId}, pos=(${mut.placementToUpdate.localX}, ${mut.placementToUpdate.localY})]`,
          });
        }
      }
    } else if (mut.action === 'remove-placement' && mut.placementIdToRemove) {
      const idx = activeScenario.placements.findIndex(
        (p) => p.placementId === mut.placementIdToRemove
      );
      if (idx >= 0) {
        const prev = activeScenario.placements[idx];
        activeScenario.placements.splice(idx, 1);
        placementDiffs.push({
          placementId: prev.placementId,
          roomId: mut.roomId,
          roomName,
          changeType: 'removed',
          beforeSummary: `${prev.label} at (${prev.localX}, ${prev.localY})`,
          afterSummary: 'Removed',
        });
      }
    }
  }

  p39Data.isConfigured = true;
  p39Data.requestSequenceId = (p39Data.requestSequenceId || 1) + 1;
  p39Data.lastEvaluatedAt = new Date().toISOString();
  p39Data.lastP38SourceFingerprint = beforeReport.p38SourceFingerprint;
  p39Data.lastSourceFingerprint = computeBiophilicSourceFingerprint(
    clonedProject,
    p39Data,
    beforeReport.p38SourceFingerprint
  );
  clonedProject.biophilicPlanner = p39Data;

  const afterReport = evaluateProjectBiophilicPlanner(clonedProject);

  const roomImpactSummaries: BiophilicProposalPreviewDiff['roomImpactSummaries'] =
    beforeReport.roomEvaluations.map((rmBefore) => {
      const rmAfter =
        afterReport.roomEvaluations.find((r) => r.roomId === rmBefore.roomId) || rmBefore;
      return {
        roomId: rmBefore.roomId,
        roomName: rmBefore.roomName,
        beforePlantCount: rmBefore.livingPlantCount + rmBefore.nonLivingFeatureCount,
        afterPlantCount: rmAfter.livingPlantCount + rmAfter.nonLivingFeatureCount,
        beforeFloorAreaM2: rmBefore.totalContainerFloorAreaM2,
        afterFloorAreaM2: rmAfter.totalContainerFloorAreaM2,
        beforeConflictsCount: rmBefore.conflicts.length,
        afterConflictsCount: rmAfter.conflicts.length,
        beforeSuitability: rmBefore.roomSuitabilitySummary,
        afterSuitability: rmAfter.roomSuitabilitySummary,
      };
    });

  const unresolvedDataNotices = Array.from(
    new Set(afterReport.roomEvaluations.flatMap((r) => r.missingInputs))
  );

  if (afterReport.totals.blockingConflictsCount > 0) {
    warningNotices.push(
      `${afterReport.totals.blockingConflictsCount} blocking spatial/light/toxicity conflict(s) remain in the proposed state.`
    );
  }

  const isSafeToApply =
    blockingValidationErrors.length === 0 && placementDiffs.length > 0;

  return {
    previewId: `p39-preview-${Date.now()}`,
    title:
      selectedRecs.length === 1
        ? selectedRecs[0].title
        : `Apply ${selectedRecs.length} Biophilic Plantscape Recommendations`,
    createdAt: new Date().toISOString(),
    sourceFingerprintAtPreview: beforeReport.sourceFingerprint,
    p38FingerprintAtPreview: beforeReport.p38SourceFingerprint,
    isSafeToApply,
    blockingValidationErrors,
    warningNotices,
    selectedRecommendationIds,
    placementDiffs,
    roomImpactSummaries,
    p38AssessmentsPreservedUnmodified:
      afterReport.p38SourceFingerprint === beforeReport.p38SourceFingerprint,
    p33AndP34PreservedUnmodified: true,
    p37VentilationPreservedUnmodified: true,
    unresolvedDataNotices,
    proposedProjectClone: clonedProject as unknown as Record<string, unknown>,
  };
}

/**
 * Atomically applies a previewed P39 proposal after validating the complete proposed state
 * and recording a pre-apply snapshot checkpoint per P39 Section 6.
 */
export function applyBiophilicProposalAtomically(
  currentProject: Project,
  previewDiff: BiophilicProposalPreviewDiff
): {
  applied: boolean;
  updatedProject: Project;
  snapshotId: string | null;
  report: BiophilicPlannerProjectReport;
  message: string;
} {
  const liveReport = evaluateProjectBiophilicPlanner(currentProject);

  // 1. Reject stale preview if underlying project or P38 state changed
  if (
    previewDiff.sourceFingerprintAtPreview !== liveReport.sourceFingerprint ||
    previewDiff.p38FingerprintAtPreview !== liveReport.p38SourceFingerprint
  ) {
    return {
      applied: false,
      updatedProject: currentProject,
      snapshotId: null,
      report: liveReport,
      message:
        'Stale preview rejected: underlying room geometry, P38 daylight state, or P39 plantscape state changed since the preview was generated. Please regenerate the preview.',
    };
  }

  if (!previewDiff.isSafeToApply || previewDiff.blockingValidationErrors.length > 0) {
    return {
      applied: false,
      updatedProject: currentProject,
      snapshotId: null,
      report: liveReport,
      message: `Cannot apply proposal: ${
        previewDiff.blockingValidationErrors.join('; ') || 'No valid placement changes in preview.'
      }`,
    };
  }

  // 2. Validate the complete proposed state before committing any change
  const candidateProject = JSON.parse(
    JSON.stringify(previewDiff.proposedProjectClone)
  ) as Project;
  const candidateP39 = candidateProject.biophilicPlanner;
  if (!candidateP39 || !Array.isArray(candidateP39.scenarios)) {
    return {
      applied: false,
      updatedProject: currentProject,
      snapshotId: null,
      report: liveReport,
      message: 'Atomic validation failed: proposed project clone is missing valid P39 scenario data.',
    };
  }

  const catalog = getProjectBiophilicCatalog(candidateProject, candidateP39);
  for (const scen of candidateP39.scenarios) {
    for (const pl of scen.placements) {
      const check = validateBiophilicPlacementRecord(pl, catalog);
      if (!check.valid) {
        return {
          applied: false,
          updatedProject: currentProject,
          snapshotId: null,
          report: liveReport,
          message: `Atomic validation failed on placement "${pl.placementId}": ${check.errors.join('; ')}`,
        };
      }
    }
  }

  // 3. Record pre-apply snapshot checkpoint
  let snapshotId = `p39-snap-${Date.now()}`;
  try {
    const snap = createProjectSnapshot(currentProject, {
      trigger: 'auto-checkpoint',
      label: `Pre-P39 Biophilic Plantscape Apply: ${previewDiff.title}`,
      description: `Automatic checkpoint before applying P39 plantscape proposal "${previewDiff.title}".`,
    });
    if (snap && snap.id) {
      snapshotId = snap.id;
    }
  } catch {
    // Headless Node test environment fallback
  }

  memoryBiophilicSnapshots.set(snapshotId, {
    biophilicPlanner: currentProject.biophilicPlanner
      ? JSON.parse(JSON.stringify(currentProject.biophilicPlanner))
      : undefined,
    fullProjectClone: JSON.parse(JSON.stringify(currentProject)),
  });

  // 4. Commit only P39 state onto a fresh clone of currentProject so unrelated project fields are 100% preserved
  const updatedProject: Project = JSON.parse(JSON.stringify(currentProject));
  candidateP39.isConfigured = true;
  candidateP39.lastPreApplySnapshotId = snapshotId;
  candidateP39.requestSequenceId = (candidateP39.requestSequenceId || 1) + 1;
  candidateP39.lastEvaluatedAt = new Date().toISOString();
  candidateP39.lastP38SourceFingerprint = liveReport.p38SourceFingerprint;
  candidateP39.lastSourceFingerprint = computeBiophilicSourceFingerprint(
    updatedProject,
    candidateP39,
    liveReport.p38SourceFingerprint
  );
  updatedProject.biophilicPlanner = candidateP39;
  updatedProject.updatedAt = new Date().toISOString();

  const finalReport = evaluateProjectBiophilicPlanner(updatedProject);

  return {
    applied: true,
    updatedProject,
    snapshotId,
    report: finalReport,
    message: `Applied P39 Biophilic Plantscape proposal "${previewDiff.title}" with snapshot checkpoint (${snapshotId}).`,
  };
}

/**
 * Rolls back P39 state to the recorded pre-apply snapshot without deleting unrelated project changes
 * made outside P39 per P39 Section 6 & Section 9.G.
 */
export function rollbackLastBiophilicApply(
  currentProject: Project
): {
  rolledBack: boolean;
  restoredProject: Project;
  message: string;
} {
  const snapshotId = currentProject.biophilicPlanner?.lastPreApplySnapshotId;
  if (!snapshotId) {
    return {
      rolledBack: false,
      restoredProject: currentProject,
      message: 'No pre-apply P39 snapshot ID is recorded on this project.',
    };
  }

  const memEntry = memoryBiophilicSnapshots.get(snapshotId);
  if (memEntry) {
    // Restore P39 state onto a clone of currentProject so any unrelated project edits made since apply are preserved!
    const restoredProject: Project = JSON.parse(JSON.stringify(currentProject));
    if (memEntry.biophilicPlanner) {
      restoredProject.biophilicPlanner = JSON.parse(
        JSON.stringify(memEntry.biophilicPlanner)
      );
    } else {
      restoredProject.biophilicPlanner = initializeProjectBiophilicPlannerData(
        memEntry.fullProjectClone
      );
      restoredProject.biophilicPlanner.isConfigured = false;
    }
    restoredProject.updatedAt = new Date().toISOString();
    return {
      rolledBack: true,
      restoredProject,
      message: `Successfully rolled back P39 Biophilic Plantscape state to pre-apply snapshot (${snapshotId}) while preserving unrelated project data.`,
    };
  }

  try {
    const snapshots = getProjectSnapshots(currentProject);
    const found = snapshots.find((s) => s.id === snapshotId);
    if (found) {
      const restoreRes = executeSafeRestore(currentProject, found);
      if (restoreRes.success && restoreRes.restoredProject) {
        const restoredProject: Project = JSON.parse(JSON.stringify(currentProject));
        restoredProject.biophilicPlanner = restoreRes.restoredProject.biophilicPlanner;
        return {
          rolledBack: true,
          restoredProject,
          message: `Successfully rolled back P39 state to snapshot (${snapshotId}).`,
        };
      }
    }
  } catch {
    // ignore
  }

  return {
    rolledBack: false,
    restoredProject: currentProject,
    message: `Could not locate pre-apply snapshot "${snapshotId}".`,
  };
}

/**
 * Adds or updates a single placement in the active scenario (idempotent by `placementId` so repeated
 * calls with the same `placementId` update in place and never duplicate placements).
 */
export function upsertBiophilicPlacement(
  project: Project,
  placement: BiophilicPlacementRecord
): {
  updatedProject: Project;
  validationErrors: string[];
} {
  const cloned: Project = JSON.parse(JSON.stringify(project));
  const p39Data = initializeProjectBiophilicPlannerData(cloned);
  const catalog = getProjectBiophilicCatalog(cloned, p39Data);
  const val = validateBiophilicPlacementRecord(placement, catalog);
  if (!val.valid) {
    return { updatedProject: project, validationErrors: val.errors };
  }

  const scen =
    p39Data.scenarios.find((s) => s.scenarioId === p39Data.activeScenarioId) ||
    p39Data.scenarios[0];

  const existingIdx = scen.placements.findIndex(
    (p) => p.placementId === placement.placementId
  );
  if (existingIdx >= 0) {
    scen.placements[existingIdx] = JSON.parse(JSON.stringify(placement));
  } else {
    scen.placements.push(JSON.parse(JSON.stringify(placement)));
  }

  p39Data.isConfigured = true;
  p39Data.requestSequenceId = (p39Data.requestSequenceId || 1) + 1;
  p39Data.lastEvaluatedAt = new Date().toISOString();
  p39Data.lastSourceFingerprint = computeBiophilicSourceFingerprint(cloned, p39Data);
  cloned.biophilicPlanner = p39Data;

  return { updatedProject: cloned, validationErrors: [] };
}

/**
 * Removes a placement by `placementId` from the active scenario.
 */
export function removeBiophilicPlacement(
  project: Project,
  placementId: string
): Project {
  const cloned: Project = JSON.parse(JSON.stringify(project));
  const p39Data = initializeProjectBiophilicPlannerData(cloned);
  const scen =
    p39Data.scenarios.find((s) => s.scenarioId === p39Data.activeScenarioId) ||
    p39Data.scenarios[0];

  scen.placements = scen.placements.filter((p) => p.placementId !== placementId);
  p39Data.isConfigured = true;
  p39Data.requestSequenceId = (p39Data.requestSequenceId || 1) + 1;
  p39Data.lastEvaluatedAt = new Date().toISOString();
  p39Data.lastSourceFingerprint = computeBiophilicSourceFingerprint(cloned, p39Data);
  cloned.biophilicPlanner = p39Data;
  return cloned;
}

/**
 * Serialization & Deserialization helpers that preserve unknown fields for backward/forward compatibility
 * per P39 Section 8 & Group A.
 */
export function serializeBiophilicPlannerData(
  data: ProjectBiophilicPlannerData
): string {
  return JSON.stringify(data, null, 2);
}

export function deserializeBiophilicPlannerData(
  jsonString: string
): { valid: boolean; data: ProjectBiophilicPlannerData | null; errors: string[] } {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { valid: false, data: null, errors: ['Parsed payload is not an object.'] };
    }
    if (typeof parsed.schemaVersion !== 'string' || typeof parsed.engineVersion !== 'string') {
      return {
        valid: false,
        data: null,
        errors: ['Missing schemaVersion or engineVersion in P39 payload.'],
      };
    }
    if (!Array.isArray(parsed.scenarios)) {
      return { valid: false, data: null, errors: ['scenarios must be an array.'] };
    }
    return { valid: true, data: parsed as ProjectBiophilicPlannerData, errors: [] };
  } catch (err: any) {
    return {
      valid: false,
      data: null,
      errors: [err?.message || 'Invalid JSON string.'],
    };
  }
}

/**
 * Structured JSON export for P39 report per P39 Section 8 (sanitized, no credentials or private config).
 */
export function exportBiophilicReportAsJson(
  report: BiophilicPlannerProjectReport
): string {
  const payload = {
    schemaVersion: report.schemaVersion,
    engineVersion: report.engineVersion,
    reportId: report.reportId,
    projectId: report.projectId,
    projectName: report.projectName,
    unit: report.unit,
    evaluatedAt: report.evaluatedAt,
    sourceFingerprint: report.sourceFingerprint,
    p38SourceFingerprint: report.p38SourceFingerprint,
    isStale: report.isStale,
    isP38LinkStale: report.isP38LinkStale,
    overallProvenance: report.overallProvenance,
    overallCompleteness: report.overallCompleteness,
    activeScenario: report.activeScenario,
    totals: report.totals,
    roomEvaluations: report.roomEvaluations,
    allConflicts: report.allConflicts,
    allMaintenanceTasks: report.allMaintenanceTasks,
    scenarioComparison: report.scenarioComparison,
    crossFeatureIntegration: report.crossFeatureIntegration,
    professionalDisclaimer: report.professionalDisclaimer,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Readable Markdown summary export for P39 report per P39 Section 8.
 */
export function exportBiophilicReportAsMarkdown(
  report: BiophilicPlannerProjectReport
): string {
  const lines: string[] = [
    `# P39 Biophilic & Indoor Plantscape Planner Report — ${report.projectName}`,
    ``,
    `- **Engine Version:** \`${report.engineVersion}\` (Schema \`${report.schemaVersion}\`)`,
    `- **Active Scenario:** ${report.activeScenario.name}`,
    `- **Overall Provenance:** \`${report.overallProvenance}\``,
    `- **Overall Completeness:** \`${report.overallCompleteness}\``,
    `- **P38 Daylight Link Status:** ${
      report.isP38LinkStale ? 'Stale (Recomputed)' : 'Synchronized'
    } (\`${report.p38SourceFingerprint}\`)`,
    ``,
    `## 1. Project Plantscape Totals`,
    `- **Living Plants:** ${report.totals.totalLivingPlants}`,
    `- **Non-Living Biophilic Features:** ${report.totals.totalNonLivingFeatures}`,
    `- **Total Container Floor Area Occupied:** ${report.totals.totalContainerFloorAreaM2} m²`,
    `- **Total Mature Floor Area Occupied:** ${
      report.totals.totalMatureFloorAreaM2 !== null
        ? `${report.totals.totalMatureFloorAreaM2} m²`
        : 'Incomplete (one or more species lack verified mature dimensions)'
    }`,
    `- **Estimated Routine Maintenance:** ${
      report.totals.totalEstimatedMonthlyMaintenanceMinutes !== null
        ? `${report.totals.totalEstimatedMonthlyMaintenanceMinutes} min/month`
        : 'Incomplete (unverified species care duration)'
    }`,
    `- **Suitability Breakdown:** ${report.totals.suitablePlacementsCount} suitable, ${report.totals.potentiallySuitableCount} potentially suitable, ${report.totals.unsuitablePlacementsCount} unsuitable, ${report.totals.notAssessableCount} not assessable`,
    `- **Conflicts & Warnings:** ${report.totals.blockingConflictsCount} blocking, ${report.totals.warningConflictsCount} warnings/advisories`,
    ``,
    `## 2. Room-by-Room Assessments`,
  ];

  for (const rm of report.roomEvaluations) {
    lines.push(
      `### ${rm.roomName} (\`${rm.roomId}\`, Floor ${rm.floorLevel}, ${rm.roomFloorAreaM2} m²)`,
      `- **Room Suitability:** \`${rm.roomSuitabilitySummary}\` | **Completeness:** \`${rm.completeness}\``,
      `- **P38 Mean Daylight Factor:** ${
        rm.p38MeanDaylightFactorPercent !== null
          ? `${rm.p38MeanDaylightFactorPercent}%`
          : 'Unavailable'
      } (${rm.p38DaylightCompleteness})`,
      `- **Placements (${rm.placements.length}):**`
    );
    if (rm.placementEvaluations.length === 0) {
      lines.push(`  - _No placements assigned in this scenario._`);
    } else {
      for (const pe of rm.placementEvaluations) {
        lines.push(
          `  - **${pe.displayName}** (\`${pe.placementId}\`): \`${pe.suitabilityStatus}\` | Light: \`${pe.lightSuitabilityStatus}\` | Container: ${pe.containerFootprintAreaM2} m² | Mature: ${
            pe.matureFootprintAreaM2 !== null ? `${pe.matureFootprintAreaM2} m²` : 'unknown'
          }`
        );
      }
    }
    if (rm.conflicts.length > 0) {
      lines.push(`- **Flagged Conflicts (${rm.conflicts.length}):**`);
      for (const c of rm.conflicts) {
        lines.push(`  - [${c.severity}] **${c.title}**: ${c.description}`);
      }
    }
    lines.push(``);
  }

  if (report.scenarioComparison) {
    const sc = report.scenarioComparison;
    lines.push(
      `## 3. Scenario Comparison: ${sc.scenarioAName} vs. ${sc.scenarioBName}`,
      `- **Living Plants:** ${sc.metrics.livingPlantCountA} vs. ${sc.metrics.livingPlantCountB} (Δ = ${sc.metrics.deltaLivingPlantCount})`,
      `- **Non-Living Features:** ${sc.metrics.nonLivingFeatureCountA} vs. ${sc.metrics.nonLivingFeatureCountB} (Δ = ${sc.metrics.deltaNonLivingFeatureCount})`,
      `- **Floor Area Occupied:** ${sc.metrics.floorAreaOccupiedM2A} m² vs. ${sc.metrics.floorAreaOccupiedM2B} m² (Δ = ${sc.metrics.deltaFloorAreaOccupiedM2} m²)`,
      `- **Circulation/Accessibility Warnings:** ${sc.metrics.circulationAndAccessibilityWarningsCountA} vs. ${sc.metrics.circulationAndAccessibilityWarningsCountB}`,
      `- **Unquantified Benefits Disclosure:** Wellbeing = \`${sc.unquantifiedBenefitDisclosures.occupantWellbeingScore}\`, Productivity = \`${sc.unquantifiedBenefitDisclosures.productivityGainPercent}\`, Air Purification = \`${sc.unquantifiedBenefitDisclosures.airPurificationVocRemovalRate}\`, Energy Savings = \`${sc.unquantifiedBenefitDisclosures.thermalOrEnergySavingsKwh}\` (${sc.unquantifiedBenefitDisclosures.status})`,
      ``
    );
  }

  lines.push(
    `## 4. Professional Disclaimer & Evidence Boundary`,
    `> ${report.professionalDisclaimer}`
  );

  return lines.join('\n');
}
