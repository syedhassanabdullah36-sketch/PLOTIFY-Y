import {
  DesignAlternative,
  FacadeConcept,
  FloorPlanRoom,
  InteriorRoomConcept,
  Project,
} from '../types/project';
import {
  AssemblyCompatibilityCheck,
  ClimateMaterialAdvisorEvaluationReport,
  ClimateMaterialCandidate,
  ComparedMaterialCandidateEntry,
  ExposureDomainEvaluation,
  MaterialApplicationCategory,
  MaterialCandidateSuitabilityReport,
  MaterialComparisonCriterionScore,
  MaterialEvidenceStatus,
  MaterialRankingWeights,
  MaterialSelectionApplyRequest,
  MaterialSelectionPreviewDiff,
  MaterialSideBySideComparisonResult,
  MaterialSuitabilityStatus,
  P35_MATERIAL_ADVISOR_ENGINE_VERSION,
  P35OptionMaterialComparisonSummary,
  ProjectClimateContext,
  ProjectMaterialAdvisorData,
  PropertyWithProvenance,
  ResistanceRating,
} from '../types/climateMaterialAdvisor';
import {
  evaluateSolarOrientation,
  initializeProjectSiteContext,
} from './siteIntelligenceService';
import { initializeProjectBrief } from './briefService';
import { initializePersonalizationProfile } from './designPersonalizationService';
import { extractComparableOptions } from './designComparisonService';
import {
  createProjectSnapshot,
  executeSafeRestore,
  getProjectSnapshots,
} from './versioningService';

export { P35_MATERIAL_ADVISOR_ENGINE_VERSION };

export const P35_COMPLIANCE_DISCLAIMER =
  'Climate-Responsive Material Advisor (P35) provides preliminary architectural material screening and comparative decision support based on declared climate exposure parameters and traceable generic or user-supplied material properties. It does NOT certify building-code compliance, fire resistance or flame-spread ratings, structural capacity, waterproofing or condensation-free hygrothermal performance, indoor energy savings, or manufacturer product warranties.';

/**
 * In-memory snapshot fallback store for headless / node test environments where localStorage may not persist all snapshots.
 */
const memoryMaterialSnapshots = new Map<string, Project>();

export const DEFAULT_MATERIAL_RANKING_WEIGHTS: MaterialRankingWeights = {
  climateSuitability: 35,
  durabilityAndWeathering: 20,
  lowMaintenance: 15,
  thermalAndMoistureFit: 15,
  costPredictability: 5,
  userPreferenceMatch: 5,
  embodiedCarbonReference: 5,
};

/**
 * Existing Plotify embodied carbon factors from src/services/scenarioCalculator.ts
 * (ICE Database & RICS Professional Standard WLC, kg CO2e / m2 of GFA).
 * Preserved verbatim to maintain 100% consistency with scenarioCalculator.ts.
 */
export const PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2: Record<
  FacadeConcept['primaryMaterial'],
  number
> = {
  timber: 180,
  plaster: 290,
  stone: 330,
  brick: 390,
  concrete: 490,
  glass: 530,
};

/**
 * Converts Fahrenheit to Celsius deterministically.
 */
export function fahrenheitToCelsius(tempF: number): number {
  return Math.round(((tempF - 32) * 5) / 9 * 10) / 10;
}

/**
 * Converts Celsius to Fahrenheit deterministically.
 */
export function celsiusToFahrenheit(tempC: number): number {
  return Math.round(((tempC * 9) / 5 + 32) * 10) / 10;
}

/**
 * Formats temperature in the active temperature unit ('C' or 'F') while preserving internal °C storage.
 */
export function formatTemperature(
  tempC: number | null | undefined,
  unit: 'C' | 'F' = 'C'
): string {
  if (tempC === null || tempC === undefined || !Number.isFinite(tempC)) {
    return 'Not specified';
  }
  if (unit === 'F') {
    return `${celsiusToFahrenheit(tempC).toFixed(1)} °F (${tempC.toFixed(1)} °C)`;
  }
  return `${tempC.toFixed(1)} °C`;
}

/**
 * Default unconfigured climate context when no climate data has been entered or selected.
 * Strictly adheres to P35 Section 4: never invents climate zones, temperatures, rainfall, or humidity from a bare city name.
 */
export function createUnconfiguredClimateContext(project?: Project): ProjectClimateContext {
  const site = project ? initializeProjectSiteContext(project) : undefined;
  const locationLabel =
    site?.cityRegion?.trim() || site?.address?.trim() || 'Unspecified project location';

  return {
    profileId: 'unconfigured-climate-context',
    profileName: 'Unconfigured Climate Context (Explicit Input Required)',
    isConfigured: false,
    sourceTier: 'unconfigured',
    statisticBasis: 'unconfigured',
    geographicCoverageNote: `Project location label "${locationLabel}" does not include verified meteorological design statistics. Climate exposure parameters must be explicitly selected from a documented reference profile or entered by the user.`,
    sourceCitation: 'No meteorological or climatic design dataset configured yet.',
    sourceVersionOrEdition: 'N/A',
    retrievalDateOrMethod: 'Awaiting user configuration',
    licenceAndUsageNote:
      'Plotify does not silently guess climate zones, temperatures, rainfall, or coastal salt exposure from unverified text.',
    temperatureUnit: project?.unit === 'feet' ? 'F' : 'C',
    summerDesignHighTempC: null,
    extremeMaxTempC: null,
    winterDesignLowTempC: null,
    diurnalTempSwingC: null,
    meanRelativeHumidityPct: null,
    humidityWettingRegime: 'unknown',
    annualPrecipitationMm: null,
    windDrivenRainExposure: 'unknown',
    freezeThawExposure: 'unknown',
    coastalSaltExposure: 'unknown',
    solarUvExposure: 'unknown',
    wildfireEmberExposure: 'unknown',
    airbornePollutantOrDustNote: site?.environmental?.dustOrExposureNotes || undefined,
    limitationsAndCaveats: [
      'Climate exposure parameters are currently unconfigured.',
      'Material suitability cannot be marked "suitable" without configured temperature, moisture, freeze–thaw, and coastal exposure inputs.',
    ],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Documented Reference Climate Screening Profiles grounded in ASHRAE Handbook — Fundamentals (Ch. 14),
 * UNEP Sustainable Buildings and Climate Initiative, EU Climate-Resilient Buildings Guidance, and US EPA Moisture Guidance.
 */
export const REFERENCE_CLIMATE_PROFILES: ProjectClimateContext[] = [
  {
    profileId: 'ref-hot-arid-solar',
    profileName: 'Hot-Arid High-Solar Exposure Screening Profile (ASHRAE 2B/3B Ref)',
    isConfigured: true,
    sourceTier: 'reference-screening-profile',
    statisticBasis: 'climatological-design-statistic',
    geographicCoverageNote:
      'Representative screening profile for hot-dry desert and semi-arid continental regions with intense solar radiation and wide diurnal temperature swings.',
    sourceCitation:
      'ASHRAE Handbook — Fundamentals (Chapter 14: Climatic Design Information) & UNEP Sustainable Building Design for Tropical/Arid Climates',
    sourceVersionOrEdition: '2021 ASHRAE Fundamentals / UNEP Screening Reference',
    retrievalDateOrMethod: 'Static curated reference screening profile',
    licenceAndUsageNote:
      'Reference screening values for preliminary material comparison; verify local station design temperatures for final engineering.',
    temperatureUnit: 'C',
    summerDesignHighTempC: 42.0,
    extremeMaxTempC: 46.5,
    winterDesignLowTempC: 3.0,
    diurnalTempSwingC: 16.5,
    meanRelativeHumidityPct: 24,
    humidityWettingRegime: 'arid-dry',
    annualPrecipitationMm: 180,
    windDrivenRainExposure: 'low',
    freezeThawExposure: 'none-frost-free',
    coastalSaltExposure: 'inland-none',
    solarUvExposure: 'severe',
    wildfireEmberExposure: 'low',
    airbornePollutantOrDustNote: 'Elevated abrasive windborne dust and high solar UV irradiance.',
    limitationsAndCaveats: [
      'Represents generic hot-arid climatological screening statistics, not a site-specific weather station record.',
      'High diurnal thermal swing requires expansion-joint and thermal-movement detailing on large facade runs.',
    ],
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    profileId: 'ref-hot-humid-monsoon',
    profileName: 'Hot-Humid & High Wind-Driven Rain Screening Profile (ASHRAE 1A/2A Ref)',
    isConfigured: true,
    sourceTier: 'reference-screening-profile',
    statisticBasis: 'climatological-design-statistic',
    geographicCoverageNote:
      'Representative screening profile for warm-humid, subtropical, and monsoon climates with persistent high relative humidity and intense rainfall.',
    sourceCitation:
      'ASHRAE Handbook — Fundamentals (Ch. 14) & US EPA Guidance for Moisture Control for Buildings (EPA 402-F-13053)',
    sourceVersionOrEdition: '2021 ASHRAE Fundamentals / EPA 402-F-13053',
    retrievalDateOrMethod: 'Static curated reference screening profile',
    licenceAndUsageNote:
      'Reference screening profile for moisture, mould, and wetting durability evaluation.',
    temperatureUnit: 'C',
    summerDesignHighTempC: 34.5,
    extremeMaxTempC: 38.0,
    winterDesignLowTempC: 12.0,
    diurnalTempSwingC: 7.0,
    meanRelativeHumidityPct: 82,
    humidityWettingRegime: 'tropical-wet-or-monsoon',
    annualPrecipitationMm: 1850,
    windDrivenRainExposure: 'severe',
    freezeThawExposure: 'none-frost-free',
    coastalSaltExposure: 'inland-none',
    solarUvExposure: 'high',
    wildfireEmberExposure: 'none-or-negligible',
    airbornePollutantOrDustNote: 'Persistent biological growth (algae/mould) potential on shaded damp surfaces.',
    limitationsAndCaveats: [
      'Vapour drive is predominantly inward; impermeable interior wall finishes (e.g. vinyl or low-perm barriers on interior side) can trap moisture.',
      'Requires drained and ventilated cladding cavities per US EPA Moisture Control Guidance.',
    ],
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    profileId: 'ref-cold-freeze-thaw-wet',
    profileName: 'Cold-Wet & Severe Freeze–Thaw Cycling Screening Profile (ASHRAE 5A/6A Ref)',
    isConfigured: true,
    sourceTier: 'reference-screening-profile',
    statisticBasis: 'climatological-design-statistic',
    geographicCoverageNote:
      'Representative screening profile for cold humid continental climates with frequent winter freeze–thaw transitions combined with rain/snow wetting.',
    sourceCitation:
      'ASHRAE Handbook — Fundamentals (Ch. 14) & European Commission Climate-Resilient Buildings Guidance (2023/C 275/01)',
    sourceVersionOrEdition: '2021 ASHRAE / EU 2023/C 275/01',
    retrievalDateOrMethod: 'Static curated reference screening profile',
    licenceAndUsageNote:
      'Reference screening profile for freeze–thaw spalling, winter condensation, and thermal envelope review.',
    temperatureUnit: 'C',
    summerDesignHighTempC: 29.0,
    extremeMaxTempC: 34.0,
    winterDesignLowTempC: -18.0,
    diurnalTempSwingC: 11.0,
    meanRelativeHumidityPct: 72,
    humidityWettingRegime: 'humid-subtropical-or-continental',
    annualPrecipitationMm: 1050,
    windDrivenRainExposure: 'high',
    freezeThawExposure: 'severe-frequent-freeze-thaw-wet',
    coastalSaltExposure: 'deicing-salt-runoff',
    solarUvExposure: 'moderate',
    wildfireEmberExposure: 'none-or-negligible',
    airbornePollutantOrDustNote: 'Winter de-icing salt splash risk at base-of-wall and ground-level masonry.',
    limitationsAndCaveats: [
      'Materials exposed to wetting prior to freezing must have verified freeze–thaw resistance (e.g. ASTM C67 / EN 771-1 F2 or air-entrained concrete).',
      'Does not replace a project-specific Glaser or transient hygrothermal (WUFI / ISO 13788) interstitial condensation analysis.',
    ],
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    profileId: 'ref-coastal-marine-salt',
    profileName: 'Nearshore Coastal Marine & Salt-Laden Wind Profile (ASHRAE 3C/4C Coastal Ref)',
    isConfigured: true,
    sourceTier: 'reference-screening-profile',
    statisticBasis: 'climatological-design-statistic',
    geographicCoverageNote:
      'Representative screening profile for coastal sites within 300 m to 1 km of marine shoreline exposed to airborne sea-salt aerosols and wind-driven rain.',
    sourceCitation:
      'ISO 9223 Corrosion of Metals and Alloys (Corrosivity Categories C4–C5M) & ASHRAE Handbook — Fundamentals (Ch. 14)',
    sourceVersionOrEdition: 'ISO 9223:2012 / 2021 ASHRAE Fundamentals',
    retrievalDateOrMethod: 'Static curated reference screening profile',
    licenceAndUsageNote:
      'Reference screening profile for marine chloride corrosion and salt-crystallization weathering.',
    temperatureUnit: 'C',
    summerDesignHighTempC: 26.0,
    extremeMaxTempC: 31.0,
    winterDesignLowTempC: 2.0,
    diurnalTempSwingC: 8.0,
    meanRelativeHumidityPct: 78,
    humidityWettingRegime: 'marine-persistent-damp',
    annualPrecipitationMm: 1120,
    windDrivenRainExposure: 'high',
    freezeThawExposure: 'occasional-freeze-dry-winter',
    coastalSaltExposure: 'coastal-nearshore-300m-to-1km',
    solarUvExposure: 'high',
    wildfireEmberExposure: 'none-or-negligible',
    airbornePollutantOrDustNote: 'High marine chloride deposition requiring 316 marine-grade stainless steel fixings.',
    limitationsAndCaveats: [
      'Salt crystallization in porous stone or under-fired brick can cause sub-florescence spalling.',
      'Reinforced concrete requires marine-exposure cover depth and low water-cement ratio per structural code.',
    ],
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    profileId: 'ref-temperate-mixed',
    profileName: 'Temperate Mixed Four-Season Screening Profile (ASHRAE 4A Ref)',
    isConfigured: true,
    sourceTier: 'reference-screening-profile',
    statisticBasis: 'climatological-design-statistic',
    geographicCoverageNote:
      'Representative screening profile for temperate four-season regions with warm summers, cool winters, moderate rainfall, and moderate freeze–thaw cycles.',
    sourceCitation:
      'ASHRAE Handbook — Fundamentals (Chapter 14: Climatic Design Information) & ISO 10456 Hygrothermal Reference',
    sourceVersionOrEdition: '2021 ASHRAE Fundamentals',
    retrievalDateOrMethod: 'Static curated reference screening profile',
    licenceAndUsageNote:
      'Reference screening profile for balanced temperate envelope evaluation.',
    temperatureUnit: 'C',
    summerDesignHighTempC: 31.0,
    extremeMaxTempC: 35.5,
    winterDesignLowTempC: -6.0,
    diurnalTempSwingC: 10.0,
    meanRelativeHumidityPct: 65,
    humidityWettingRegime: 'temperate-moderate-moisture',
    annualPrecipitationMm: 880,
    windDrivenRainExposure: 'moderate',
    freezeThawExposure: 'moderate-freeze-thaw-with-rain',
    coastalSaltExposure: 'inland-none',
    solarUvExposure: 'moderate',
    wildfireEmberExposure: 'none-or-negligible',
    limitationsAndCaveats: [
      'Moderate seasonal freeze–thaw with rain still requires frost-resistant exterior masonry and positive sill/coping drip detailing.',
    ],
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    profileId: 'ref-wildfire-interface-dry',
    profileName: 'Dry-Summer Wildland-Urban Interface (WUI) Ember Screening Profile',
    isConfigured: true,
    sourceTier: 'reference-screening-profile',
    statisticBasis: 'regional-screening-assumption',
    geographicCoverageNote:
      'Representative screening profile for Mediterranean / dry-summer regions with elevated seasonal wildfire ember and radiant heat exposure.',
    sourceCitation:
      'ASHRAE Handbook — Fundamentals (Ch. 14) & WUI Noncombustible Cladding Screening Guidance',
    sourceVersionOrEdition: '2021 Reference Screening',
    retrievalDateOrMethod: 'Static curated reference screening profile',
    licenceAndUsageNote:
      'Preliminary screening only; never substitutes for statutory WUI fire-resistance testing (e.g. ASTM E136 / EN 13501-1 / California Chapter 7A).',
    temperatureUnit: 'C',
    summerDesignHighTempC: 37.0,
    extremeMaxTempC: 42.0,
    winterDesignLowTempC: 1.0,
    diurnalTempSwingC: 14.0,
    meanRelativeHumidityPct: 35,
    humidityWettingRegime: 'semi-arid-seasonal',
    annualPrecipitationMm: 450,
    windDrivenRainExposure: 'moderate',
    freezeThawExposure: 'occasional-freeze-dry-winter',
    coastalSaltExposure: 'inland-none',
    solarUvExposure: 'high',
    wildfireEmberExposure: 'high',
    airbornePollutantOrDustNote: 'Seasonal wildfire smoke, dry winds, and airborne ember exposure.',
    limitationsAndCaveats: [
      'P35 screens general material combustibility class notes only and NEVER certifies statutory fire resistance, flame-spread rating, or WUI code compliance.',
    ],
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
];

/**
 * Built-in traceable generic material catalogue mapped to Plotify's architectural specifications.
 * Every numeric and qualitative property carries explicit provenance, units, source citations, and scope limitations.
 */
export const BUILTIN_CLIMATE_MATERIAL_CATALOGUE: ClimateMaterialCandidate[] = [
  // 1. Exterior / Accent: Thermally Modified Timber Rainscreen (`timber`)
  {
    materialId: 'mat-ext-thermowood-cedar',
    displayName: 'Thermally Modified Timber / Cedar Ventilated Rainscreen',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['exterior-primary-facade', 'exterior-accent-cladding'],
    mappedFacadeMaterial: 'timber',
    mappedCostTier: 'High-End Architectural',
    defaultHexColor: '#b4845c',
    materialClassSummary:
      'Kiln-modified softwood/cedar rainscreen cladding boards installed over a ventilated drainage cavity.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ISO 10456:2007 Table 3 & ASHRAE Handbook — Fundamentals Ch. 26 (Timber Cladding). Not a specific manufacturer product.',
    thermalConductivityWPerMK: {
      value: 0.12,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 / ASHRAE Fundamentals Ch. 26',
      testMethodOrStandard: 'ISO 8302 / ASTM C518',
      applicableConditions: 'Dry density ~420 kg/m³ at 20 °C, 50% RH; cladding board only.',
    },
    specificHeatJPerKgK: {
      value: 1600,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Standard hygrothermal reference for softwood timber.',
    },
    densityKgPerM3: {
      value: 420,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Seasoned / thermally modified timber board.',
    },
    solarReflectanceFraction: {
      value: 0.35,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26 Surface Solar Absorptance Tables',
      applicableConditions: 'Unweathered medium-tone wood; darkens or silvers with UV weathering.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26',
      applicableConditions: 'Non-metallic timber surface.',
    },
    maxServiceTempC: {
      value: 75,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282',
      applicableConditions: 'Prolonged surface temperatures above 65–75 °C accelerate surface checking and resin exudation.',
    },
    waterAbsorptionPctByWeight: {
      value: 14.0,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282 / EN 350',
      applicableConditions: 'Reduced equilibrium moisture uptake compared to untreated wood, but still hygroscopic.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 40,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Vapour-open timber board; must be paired with drained ventilated air cavity.',
    },
    moistureSensitivityRating: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'US EPA Moisture Control Guidance (EPA 402-F-13053)',
      applicableConditions: 'Requires >= 19 mm ventilated drainage cavity, insect mesh, and 200–300 mm ground clearance.',
    },
    dryingPotentialNote:
      'High drying potential ONLY when back-ventilated with continuous top and bottom air gap; trapped water causes fungal decay.',
    freezeThawResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282',
      applicableConditions: 'Low free-water pore saturation when installed as drained vertical siding.',
    },
    coastalSaltCorrosionResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 350 / ISO 9223 Fastener Guidance',
      applicableConditions: 'Timber matrix resists salt crystallization, but concealed fasteners MUST be 316 stainless steel.',
    },
    uvWeatheringResistance: {
      value: 'low-sensitive',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282 Ch. 16 (Finishing & Weathering of Wood)',
      applicableConditions: 'Surface lignin photodegrades under UV, turning silver-grey and developing micro-checks unless UV-pigmented oil is maintained.',
    },
    combustibilityOrWildfireNote: {
      value: 'Combustible organic timber cladding (typically Euroclass D-s2,d0 unless fire-retardant treated and tested). Vulnerable to wildfire embers and radiant heat.',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13501-1 Generic Reference / WUI Cladding Guidance',
      applicableConditions: 'Requires verified fire-retardant treatment test certificate or non-combustible substitution in WUI zones.',
    },
    maintenanceIntervalYears: {
      value: 3,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282',
      applicableConditions: 'Re-oiling / UV stain every 2–4 years to retain warm tone, or periodic cleaning if left to weather naturally.',
    },
    maintenanceRequirementsSummary:
      'Inspect ventilated cavity vents annually; recoat UV oil finish every 2–4 years on sun-exposed south/west elevations.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 25, maxYears: 40 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference Service Life Guidance',
      applicableConditions: 'Assumes proper ventilated rainscreen detailing and ground clearance; not a product warranty.',
    },
    relativeCostIndexPerM2Usd: {
      value: 195,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Indicative installed cladding rate excluding structural backup wall.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.timber,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify scenarioCalculator.ts (ICE Database / RICS WLC benchmark)',
      applicableConditions: 'Whole-building GFA benchmark factor for primary material = timber; not a product EPD.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: true,
    requiresProtectiveSealerOrCoatingInWetClimate: true,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Install over treated timber or aluminum sub-girts with a vapor-permeable water-resistive barrier (WRB) and 316 stainless steel fasteners.',
    knownIncompatibilities: [
      'Direct-applied zero-cavity installation over low-permeability sheathing in wet climates',
      'Direct contact with soil or horizontal ponding surfaces',
      'Galvanized carbon steel nails in coastal or high-tannin timber applications',
    ],
    sourceOrganisation: 'ISO / ASHRAE / USDA Forest Products Laboratory',
    sourceDocument: 'ISO 10456:2007, ASHRAE Fundamentals Ch. 26 & Wood Handbook FPL-GTR-282',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference (requires local climate exposure screening)',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Generic material properties; actual durability depends on wood species, thermal modification class, and rainscreen detailing.',
    ],
  },

  // 2. Exterior / Accent: Mineral Lime-Cement Stucco / Plaster (`plaster`)
  {
    materialId: 'mat-ext-mineral-plaster-render',
    displayName: 'Architectural Mineral Lime-Cement Stucco / Render',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['exterior-primary-facade', 'exterior-accent-cladding'],
    mappedFacadeMaterial: 'plaster',
    mappedCostTier: 'Balanced Mid-Range',
    defaultHexColor: '#f8fafc',
    materialClassSummary:
      'Light-colored breathable mineral lime-cement exterior plaster render with high solar reflectance.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ISO 10456:2007, EN 998-1 & ASHRAE Fundamentals Ch. 26.',
    thermalConductivityWPerMK: {
      value: 0.8,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 (Lime-cement mortar/render)',
      applicableConditions: 'Dry density ~1600 kg/m³; render coat provides weather finish, not thermal insulation.',
    },
    specificHeatJPerKgK: {
      value: 1000,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Mineral plaster render.',
    },
    densityKgPerM3: {
      value: 1600,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Cured mineral lime-cement plaster.',
    },
    solarReflectanceFraction: {
      value: 0.75,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26 (Light/white mineral stucco)',
      applicableConditions: 'Clean white/light mineral finish; reduces surface solar heat absorption in hot-arid climates.',
    },
    thermalEmissivityFraction: {
      value: 0.91,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26',
      applicableConditions: 'High-emissivity mineral surface.',
    },
    maxServiceTempC: {
      value: 95,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1 Mineral Render Specification',
      applicableConditions: 'Requires control joints every 4–5 m to accommodate diurnal thermal expansion/contraction.',
    },
    waterAbsorptionPctByWeight: {
      value: 9.5,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1 Capillary Water Absorption Class W1/W2 Reference',
      applicableConditions: 'Absorbs wind-driven rain unless finished with hydrophobic silicone-silicate equalizer coat.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 18,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Vapour-permeable mineral render facilitating outward drying.',
    },
    moistureSensitivityRating: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'US EPA Moisture Control Guidance (EPA 402-F-13053)',
      applicableConditions: 'In high wind-driven rain (>1000 mm/yr), requires drained stucco wrap / capillary break and roof overhang protection.',
    },
    dryingPotentialNote:
      'Good outward vapour permeability (μ ≈ 18), but susceptible to algae staining and hairline cracking under persistent heavy wetting.',
    freezeThawResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1 / EU Climate-Resilient Buildings Guidance',
      applicableConditions: 'Vulnerable to freeze–thaw delamination if saturated prior to hard freezes without drainage plane and drip flashings.',
    },
    coastalSaltCorrosionResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1 / ISO 9223',
      applicableConditions: 'Salt crystallization can cause surface blistering; lath/beads must be PVC or 316 stainless steel near coast.',
    },
    uvWeatheringResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1',
      applicableConditions: 'Inorganic mineral pigments resist UV degradation better than acrylic polymers.',
    },
    combustibilityOrWildfireNote: {
      value: 'Inorganic mineral render is non-combustible (typically Euroclass A1) when applied over non-combustible masonry or mineral wool.',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1 / EN 13501-1 Generic Reference',
      applicableConditions: 'If applied as EIFS over combustible foam insulation, fire performance is governed by the full tested assembly.',
    },
    maintenanceIntervalYears: {
      value: 7,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Periodic facade washing, crack inspection, and breathable mineral repainting every 6–8 years.',
    },
    maintenanceRequirementsSummary:
      'Inspect control joints and window perimeter sealants every 3 years; recoating with breathable silicate paint every 6–8 years.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 25, maxYears: 45 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Depends on substrate movement control and drainage detailing; not a warranty.',
    },
    relativeCostIndexPerM2Usd: {
      value: 115,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Indicative 3-coat mineral render rate.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.plaster,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify scenarioCalculator.ts (ICE Database / RICS WLC benchmark)',
      applicableConditions: 'Whole-building GFA benchmark factor for primary material = plaster.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: true,
    requiresProtectiveSealerOrCoatingInWetClimate: true,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Compatible with masonry blockwork, brick, or drained cement-board sheathing with alkali-resistant fiberglass mesh.',
    knownIncompatibilities: [
      'Non-breathable elastomeric paint over damp walls (traps moisture and causes peeling)',
      'Unprotected wood sheathing without capillary break / drainage mat in wet climates',
    ],
    sourceOrganisation: 'ISO / CEN / ASHRAE',
    sourceDocument: 'ISO 10456:2007, EN 998-1 & ASHRAE Fundamentals Ch. 26',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Render layer provides negligible thermal resistance (R-value); thermal performance depends on the wall insulation layer.',
    ],
  },

  // 3. Exterior / Accent: Kiln-Fired Severe-Weathering Clay Facing Brick (`brick`)
  {
    materialId: 'mat-ext-clay-brick-cavity',
    displayName: 'Kiln-Fired Clay Facing Brick (Drained Cavity Veneer)',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['exterior-primary-facade', 'exterior-accent-cladding'],
    mappedFacadeMaterial: 'brick',
    mappedCostTier: 'Balanced Mid-Range',
    defaultHexColor: '#b45309',
    materialClassSummary:
      'High-durability fired clay masonry veneer with drained air cavity, weep holes, and high thermal mass.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ASTM C216 Grade SW / EN 771-1 Category F2 & ISO 10456:2007.',
    thermalConductivityWPerMK: {
      value: 0.77,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 / ASHRAE Fundamentals Ch. 26 (Fired Clay Brick)',
      applicableConditions: 'Density ~1750 kg/m³; provides thermal mass lag rather than low thermal conductivity.',
    },
    specificHeatJPerKgK: {
      value: 840,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'High volumetric heat capacity when combined with 1750 kg/m³ density.',
    },
    densityKgPerM3: {
      value: 1750,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Solid/perforated clay facing brick.',
    },
    solarReflectanceFraction: {
      value: 0.32,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26 (Red/terracotta clay brick)',
      applicableConditions: 'Medium-dark terracotta tone; absorbs solar heat during day and releases slowly.',
    },
    thermalEmissivityFraction: {
      value: 0.93,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26',
      applicableConditions: 'Fired clay masonry surface.',
    },
    maxServiceTempC: {
      value: 400,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 771-1 / ASTM C216',
      applicableConditions: 'Kiln-fired ceramic body stable at high ambient and radiant temperatures.',
    },
    waterAbsorptionPctByWeight: {
      value: 7.5,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASTM C216 Grade SW (Severe Weathering)',
      applicableConditions: '5-hour boiling absorption <= 17% (typical low-absorption facing brick 6–9%).',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 10,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Vapour-permeable masonry leaf.',
    },
    moistureSensitivityRating: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'US EPA Moisture Control Guidance / BIA Technical Notes 7',
      applicableConditions: 'Requires unobstructed 25–50 mm drainage cavity, base flashing, and weep holes.',
    },
    dryingPotentialNote:
      'Dries both outward by evaporation and via ventilated cavity airflow when top/bottom vents are provided.',
    freezeThawResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASTM C216 Grade SW / EN 771-1 F2',
      applicableConditions: 'Valid ONLY when Grade SW / F2 brick and freeze-resistant Type N/S mortar are specified.',
    },
    coastalSaltCorrosionResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 771-1 / ISO 9223',
      applicableConditions: 'Severe marine salt spray can cause efflorescence/crypto-florescence; masonry wall ties MUST be 316 austenitic stainless steel.',
    },
    uvWeatheringResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASTM C216 / EN 771-1',
      applicableConditions: 'Vitrified clay color is completely UV-stable.',
    },
    combustibilityOrWildfireNote: {
      value: 'Non-combustible ceramic masonry (Euroclass A1). High resistance to wildfire ember ignition.',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 771-1 / EN 13501-1',
      applicableConditions: 'Cavity vents in wildfire zones require ember-resistant mesh.',
    },
    maintenanceIntervalYears: {
      value: 20,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 / BIA Technical Notes',
      applicableConditions: 'Periodic mortar joint inspection and repointing after 20–30 years.',
    },
    maintenanceRequirementsSummary:
      'Keep base weep holes clear of landscaping mulch; inspect movement joints every 5 years; repoint mortar after 20–30 years.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 60, maxYears: 100 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Subject to stainless steel tie durability and foundation stability; not a warranty.',
    },
    relativeCostIndexPerM2Usd: {
      value: 175,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Installed brick veneer cavity leaf.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.brick,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify scenarioCalculator.ts (ICE Database / RICS WLC benchmark)',
      applicableConditions: 'Whole-building GFA benchmark factor for primary material = brick.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: true,
    requiresProtectiveSealerOrCoatingInWetClimate: false,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Supported on concrete foundation ledge / stainless shelf angles with Austin 316 stainless cavity ties to structural backup wall.',
    knownIncompatibilities: [
      'Film-forming impermeable sealers on exterior brick in freeze–thaw zones (traps moisture and causes face spalling)',
      'Rigid high-cement mortar on soft historic/salvaged brick',
    ],
    sourceOrganisation: 'ASTM / CEN / Brick Industry Association',
    sourceDocument: 'ASTM C216, EN 771-1 & ISO 10456:2007',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Requires structural foundation support for masonry dead load.',
    ],
  },

  // 4. Exterior / Accent: Dense Honed Granite / Slate Ashlar Cladding (`stone`)
  {
    materialId: 'mat-ext-dense-ashlar-stone',
    displayName: 'Dense Honed Granite / Low-Absorption Stone Rainscreen',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['exterior-primary-facade', 'exterior-accent-cladding'],
    mappedFacadeMaterial: 'stone',
    mappedCostTier: 'High-End Architectural',
    defaultHexColor: '#d6d3d1',
    materialClassSummary:
      'Low-porosity dimension stone cladding mechanically anchored over a ventilated rainscreen cavity.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ASTM C615 / EN 1469 & ISO 10456:2007 (Dense Crystalline Dimension Stone).',
    thermalConductivityWPerMK: {
      value: 2.8,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 (Crystalline natural stone)',
      applicableConditions: 'Density ~2600 kg/m³; high thermal conductivity requires continuous thermal-break insulation behind cladding.',
    },
    specificHeatJPerKgK: {
      value: 1000,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Natural stone.',
    },
    densityKgPerM3: {
      value: 2600,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Dense granite/slate dimension stone.',
    },
    solarReflectanceFraction: {
      value: 0.45,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26',
      applicableConditions: 'Light-to-medium grey honed stone.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26',
      applicableConditions: 'Honed mineral surface.',
    },
    maxServiceTempC: {
      value: 300,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1469 Natural Stone Slabs for Cladding',
      applicableConditions: 'Dimensionally stable across ambient temperatures.',
    },
    waterAbsorptionPctByWeight: {
      value: 0.4,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASTM C615 (Granite Dimension Stone <= 0.40%)',
      applicableConditions: 'Very low capillary uptake in dense crystalline stone.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 1000,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Stone slab itself is vapour-tight; open joints and ventilated rear cavity provide drying.',
    },
    moistureSensitivityRating: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1469 / US EPA Moisture Control Guidance',
      applicableConditions: 'Must be installed as open-joint or drained rainscreen so vapour is not trapped behind low-permeability stone.',
    },
    dryingPotentialNote:
      'Relies on rear ventilated air cavity (min 25 mm) and open/baffled joints for wall drying.',
    freezeThawResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASTM C615 / EN 12371 Frost Resistance',
      applicableConditions: 'Low absorption (<0.5%) resists freeze–thaw spalling; anchor kerfs must drain freely so ice does not split kerf slots.',
    },
    coastalSaltCorrosionResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 14157 / ISO 9223',
      applicableConditions: 'Dense stone resists salt crystallization; mechanical stone anchors MUST be 316 stainless steel.',
    },
    uvWeatheringResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1469',
      applicableConditions: 'Immune to UV degradation.',
    },
    combustibilityOrWildfireNote: {
      value: 'Non-combustible natural stone (Euroclass A1).',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1469 / EN 13501-1',
      applicableConditions: 'Verify non-combustible sub-framing and cavity insulation in wildfire zones.',
    },
    maintenanceIntervalYears: {
      value: 15,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Periodic anchor/joint inspection and gentle water wash.',
    },
    maintenanceRequirementsSummary:
      'Inspect mechanical anchor joints and sealant perimeters every 5–10 years; low routine maintenance.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 60, maxYears: 100 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Governed by stainless anchor system and backup structure; not a warranty.',
    },
    relativeCostIndexPerM2Usd: {
      value: 265,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'High capital cost due to stone fabrication and stainless mechanical anchorage.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.stone,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify scenarioCalculator.ts (ICE Database / RICS WLC benchmark)',
      applicableConditions: 'Whole-building GFA benchmark factor for primary material = stone.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: true,
    requiresProtectiveSealerOrCoatingInWetClimate: false,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: true,
    compatibleSubstratesAndFixingsNote:
      'Requires structural backup wall verified for stone dead/seismic load and 316 stainless steel undercut or kerf anchors.',
    knownIncompatibilities: [
      'Direct mortar-bed adhesion over unventilated moisture-sensitive substrates in freeze–thaw or high-humidity climates',
      'Water-trapping horizontal stone kerf slots in freezing climates',
    ],
    sourceOrganisation: 'ASTM / CEN / ISO',
    sourceDocument: 'ASTM C615, EN 1469 & ISO 10456:2007',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Heavy cladding dead weight requires structural framing verification.',
    ],
  },

  // 5. Exterior / Accent: Porous Soft Limestone / Unverified Sandstone (`stone` with missing/sensitive freeze-thaw & salt data)
  {
    materialId: 'mat-ext-porous-limestone-unverified',
    displayName: 'Porous Soft Limestone / Sedimentary Cladding (Unverified Frost/Salt Data)',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['exterior-primary-facade', 'exterior-accent-cladding'],
    mappedFacadeMaterial: 'stone',
    mappedCostTier: 'Balanced Mid-Range',
    defaultHexColor: '#e7e5e4',
    materialClassSummary:
      'High-porosity sedimentary limestone/sandstone cladding where quarry-specific frost and salt-crystallization test data are not yet provided.',
    productManufacturerOrStandardNote:
      'Generic sedimentary stone screening record with intentionally unverified frost/salt resistance per P35 Section 6 & 7 missing-evidence rules.',
    thermalConductivityWPerMK: {
      value: 1.5,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 (Soft porous limestone)',
      applicableConditions: 'Dry density ~2000 kg/m³.',
    },
    specificHeatJPerKgK: {
      value: 1000,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Sedimentary limestone.',
    },
    densityKgPerM3: {
      value: 2000,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Porous limestone.',
    },
    solarReflectanceFraction: {
      value: 0.62,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26 (Light cream limestone)',
      applicableConditions: 'Reflective warm cream surface.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26',
      applicableConditions: 'Natural stone surface.',
    },
    maxServiceTempC: {
      value: 200,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1469',
      applicableConditions: 'Ambient architectural exposure.',
    },
    waterAbsorptionPctByWeight: {
      value: 8.5,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASTM C568 Category I Low-Density Limestone Reference',
      applicableConditions: 'High capillary water absorption (>7.5%).',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 35,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Porous stone matrix.',
    },
    moistureSensitivityRating: {
      value: 'low-sensitive',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASTM C568 / EN 1469',
      applicableConditions: 'Absorbs wind-driven rain readily; prone to biological staining and wet-frost damage.',
    },
    dryingPotentialNote:
      'Porous capillary structure retains moisture longer after rain events.',
    freezeThawResistance: {
      value: null,
      unit: 'rating',
      evidenceStatus: 'unavailable',
      sourceCitation: 'Quarry-specific EN 12371 / ASTM C666 freeze–thaw test report missing',
      applicableConditions: 'Cannot be assumed frost-resistant without quarry petrographic and freeze–thaw lab testing.',
    },
    coastalSaltCorrosionResistance: {
      value: 'low-sensitive',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 12370 Determination of Resistance to Salt Crystallization',
      applicableConditions: 'Porous sedimentary limestone is highly vulnerable to sodium chloride / sulfate sub-florescence spalling.',
    },
    uvWeatheringResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1469',
      applicableConditions: 'Inorganic mineral.',
    },
    combustibilityOrWildfireNote: {
      value: 'Non-combustible mineral stone (Euroclass A1).',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1469',
      applicableConditions: 'Inorganic stone.',
    },
    maintenanceIntervalYears: {
      value: 5,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Requires breathable hydrophobic consolidation and periodic gentle cleaning.',
    },
    maintenanceRequirementsSummary:
      'Inspect for salt/frost flaking; reapply vapour-permeable silane/siloxane water repellent every 5 years.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 20, maxYears: 50 },
      unit: 'years',
      evidenceStatus: 'requires-verification',
      sourceCitation: 'EN 1469',
      applicableConditions: 'Highly dependent on frost/salt exposure and quarry density.',
    },
    relativeCostIndexPerM2Usd: {
      value: 185,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Indicative installed cladding rate.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.stone,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify scenarioCalculator.ts (ICE Database / RICS WLC benchmark)',
      applicableConditions: 'Whole-building GFA benchmark factor for primary material = stone.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: true,
    requiresProtectiveSealerOrCoatingInWetClimate: true,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Requires drained rainscreen support and quarry-specific EN 12371 frost & EN 12370 salt test verification.',
    knownIncompatibilities: [
      'Coastal salt spray environments (salt crystallization spalling)',
      'Severe freeze–thaw wet climates without verified EN 12371 frost testing',
    ],
    sourceOrganisation: 'ASTM / CEN / ISO',
    sourceDocument: 'ASTM C568, EN 12370, EN 12371 & ISO 10456:2007',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'Warm-dry or sheltered climates unless lab-tested',
    overallEvidenceStatus: 'requires-verification',
    knownLimitations: [
      'Freeze–thaw resistance is intentionally unverified (null) until a quarry-specific EN 12371 test report is provided.',
    ],
  },

  // 6. Exterior / Accent: Architectural Fair-Faced Concrete (`concrete`)
  {
    materialId: 'mat-ext-architectural-concrete',
    displayName: 'Board-Formed / Architectural Precast Concrete Envelope',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['exterior-primary-facade', 'exterior-accent-cladding'],
    mappedFacadeMaterial: 'concrete',
    mappedCostTier: 'High-End Architectural',
    defaultHexColor: '#94a3b8',
    materialClassSummary:
      'High-density architectural concrete facade panels with high thermal mass, requiring thermal-break insulation and air-entrainment/cover specification.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ISO 10456:2007, ACI 318 / EN 206 Exposure Classes.',
    thermalConductivityWPerMK: {
      value: 1.75,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 (Reinforced concrete)',
      applicableConditions: 'Density ~2300 kg/m³; high thermal conductivity requires continuous exterior or sandwich insulation to prevent thermal bridging.',
    },
    specificHeatJPerKgK: {
      value: 1000,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'High thermal mass.',
    },
    densityKgPerM3: {
      value: 2300,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Normal-weight reinforced concrete.',
    },
    solarReflectanceFraction: {
      value: 0.4,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26 (Grey architectural concrete)',
      applicableConditions: 'Standard Portland cement grey.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26',
      applicableConditions: 'Concrete surface.',
    },
    maxServiceTempC: {
      value: 250,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 206 / ACI 318',
      applicableConditions: 'Requires movement joints for thermal expansion/shrinkage.',
    },
    waterAbsorptionPctByWeight: {
      value: 4.8,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 206 / ASTM C642',
      applicableConditions: 'Low water-to-cement ratio (w/c <= 0.45) architectural concrete.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 130,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'High vapour resistance; interior insulation assemblies require interstitial condensation verification.',
    },
    moistureSensitivityRating: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 206 / US EPA Moisture Control Guidance',
      applicableConditions: 'Concrete matrix resists liquid water, but panel joints require two-stage drained sealant detailing.',
    },
    dryingPotentialNote:
      'Slow construction moisture drying due to high vapour resistance (μ ≈ 130).',
    freezeThawResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ACI 318 Exposure Class F2/F3 & EN 206 XF3/XF4',
      applicableConditions: 'Requires 5–7% air entrainment and w/c <= 0.45 when exposed to wet freeze–thaw cycling.',
    },
    coastalSaltCorrosionResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ACI 318 Exposure Class C2 & EN 206 XS1–XS3',
      applicableConditions: 'Chloride ingress causes reinforcing bar corrosion spalling unless marine concrete cover (>= 50 mm), SCMs (slag/fly ash), or epoxy/stainless rebar are specified.',
    },
    uvWeatheringResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 206',
      applicableConditions: 'Concrete is UV-stable; elastomeric joint sealants require UV-resistant silicone/polyurethane.',
    },
    combustibilityOrWildfireNote: {
      value: 'Non-combustible mineral concrete (Euroclass A1). High wildfire ember resistance.',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 206 / EN 13501-1',
      applicableConditions: 'Non-combustible structural and cladding material.',
    },
    maintenanceIntervalYears: {
      value: 10,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Inspect panel sealants and reapply breathable silane water/chloride repellent every 10 years.',
    },
    maintenanceRequirementsSummary:
      'Inspect two-stage panel joint sealants every 5–10 years; apply silane/siloxane chloride barrier in coastal or de-icing salt zones.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 50, maxYears: 100 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1990 / ISO 15686-1',
      applicableConditions: 'Requires proper rebar cover and crack width control; not a warranty.',
    },
    relativeCostIndexPerM2Usd: {
      value: 230,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Architectural board-formed or insulated precast concrete wall.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.concrete,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify scenarioCalculator.ts (ICE Database / RICS WLC benchmark)',
      applicableConditions: 'Whole-building GFA benchmark factor for primary material = concrete (490 kg CO₂e/m²).',
    },
    requiresVentilatedRainscreenOrDrainageCavity: false,
    requiresProtectiveSealerOrCoatingInWetClimate: true,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: true,
    compatibleSubstratesAndFixingsNote:
      'Requires thermal-break connectors at slab edges/balconies to prevent interior condensation and heat loss.',
    knownIncompatibilities: [
      'Uninsulated concrete slab edges exposed in cold or hot-humid climates (severe thermal bridging and condensation)',
      'Standard carbon-steel rebar with shallow cover (<35 mm) in coastal marine salt spray zones',
    ],
    sourceOrganisation: 'ISO / ACI / CEN',
    sourceDocument: 'ISO 10456:2007, ACI 318 & EN 206',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'High upfront embodied carbon compared to biogenic or masonry alternatives unless low-carbon SCM concrete mix is verified via project EPD.',
    ],
  },

  // 7. Exterior / Glazing: Solar-Control Thermally Broken Curtain Wall / Glazing (`glass`)
  {
    materialId: 'mat-ext-solar-control-glazing',
    displayName: 'Double/Triple Low-E Solar-Control Glazing with Thermally Broken Frames',
    recordKind: 'traceable-generic-material',
    supportedApplications: [
      'exterior-primary-facade',
      'exterior-accent-cladding',
      'exterior-glazing-and-frames',
    ],
    mappedFacadeMaterial: 'glass',
    mappedWindowStyle: 'floor-to-ceiling',
    mappedCostTier: 'High-End Architectural',
    defaultHexColor: '#38bdf8',
    materialClassSummary:
      'Insulated architectural glazing unit (IGU) with low-emissivity solar-control coating and polyamide thermally broken aluminum framing.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ASHRAE Fundamentals Ch. 15 (Fenestration) & EN 673 / ISO 10077.',
    thermalConductivityWPerMK: {
      value: 1.0,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 (Soda-lime glass pane = 1.0 W/(m·K); typical double IGU U-value ≈ 1.4 W/(m²·K))',
      applicableConditions: 'Significantly higher heat transfer than insulated opaque walls; requires SHGC & U-factor coordination.',
    },
    specificHeatJPerKgK: {
      value: 750,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Architectural float glass.',
    },
    densityKgPerM3: {
      value: 2500,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Float glass.',
    },
    solarReflectanceFraction: {
      value: 0.28,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 15 (Spectrally selective Low-E IGU)',
      applicableConditions: 'Transmits solar radiation directly indoors (typical SHGC 0.25–0.38); requires external shading on West/South facades.',
    },
    thermalEmissivityFraction: {
      value: 0.84,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 673 (Uncoated outer glass surface 0.84; internal Low-E coat ~0.05)',
      applicableConditions: 'Exterior pane surface.',
    },
    maxServiceTempC: {
      value: 85,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'IGMA / EN 1279 Insulated Glazing Seal Durability',
      applicableConditions: 'High solar heating can stress polyisobutylene/silicone edge seals and cause thermal fracture if un-tempered.',
    },
    waterAbsorptionPctByWeight: {
      value: 0.0,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Glass pane is non-absorbent; water tightness depends entirely on pressure-equalized mullion gaskets and sill drainage.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 50000,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Impermeable glass pane.',
    },
    moistureSensitivityRating: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 15 / EN 1279',
      applicableConditions: 'Interior condensation occurs at frame/glass edge in cold or humid climates if thermal break or warm-edge spacer is inadequate.',
    },
    dryingPotentialNote:
      'Zero drying through glass; mullion drainage channels must weep infiltrated water to exterior.',
    freezeThawResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 15',
      applicableConditions: 'Severe cold requires triple glazing or high-performance thermally broken frames to prevent interior frost/condensation.',
    },
    coastalSaltCorrosionResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'AAMA 2605 / Qualicoat Seaside Class',
      applicableConditions: 'Aluminum mullions in coastal salt spray require PVDF fluoropolymer (AAMA 2605) or marine-grade anodizing (>= 25 μm) and 316 stainless hardware.',
    },
    uvWeatheringResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1279 / ASTM C1184 Structural Silicone',
      applicableConditions: 'Glass is UV-immune, but IGU edge seals and EPDM gaskets require UV protection under high solar exposure.',
    },
    combustibilityOrWildfireNote: {
      value: 'Glass and aluminum are non-combustible, but standard float glass cracks under radiant heat; wildfire zones require tempered multi-pane glazing.',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'WUI Fenestration Guidance',
      applicableConditions: 'Never equates standard curtain wall with fire-rated glazing (e.g. EI30/EI60).',
    },
    maintenanceIntervalYears: {
      value: 5,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Gasket/sealant inspection every 5 years; IGU sealed unit replacement typically 20–25 years.',
    },
    maintenanceRequirementsSummary:
      'Regular facade cleaning; inspect pressure-plate weep slots and EPDM gaskets every 3–5 years; plan for IGU seal replacement at 20–25 years.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 20, maxYears: 30 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1279 / ISO 15686-1',
      applicableConditions: 'Governed by IGU desiccant/edge-seal lifespan; framing lasts longer.',
    },
    relativeCostIndexPerM2Usd: {
      value: 340,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'High-performance thermally broken curtain wall / floor-to-ceiling glazing.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.glass,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify scenarioCalculator.ts (ICE Database / RICS WLC benchmark)',
      applicableConditions: 'Whole-building GFA benchmark factor for primary material = glass (530 kg CO₂e/m²).',
    },
    requiresVentilatedRainscreenOrDrainageCavity: true,
    requiresProtectiveSealerOrCoatingInWetClimate: false,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: true,
    compatibleSubstratesAndFixingsNote:
      'Requires exterior solar shading (deep overhangs, brise-soleil, or motorized louvers) in hot/high-solar orientations.',
    knownIncompatibilities: [
      'Unshaded all-glass primary facade in hot-arid or high-solar climates (severe solar heat gain and glare risk)',
      'Non-thermally broken aluminum frames in cold or humid climates (condensation risk)',
    ],
    sourceOrganisation: 'ASHRAE / CEN / ISO',
    sourceDocument: 'ASHRAE Fundamentals Ch. 15, EN 1279 & ISO 10077',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference (requires external solar shading in hot climates)',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Substantially lower thermal resistance and higher solar heat gain than insulated opaque wall assemblies.',
    ],
  },

  // 8. Roof Covering: High-Reflectance Standing-Seam Metal Roof (Cool Roof PVDF)
  {
    materialId: 'mat-roof-cool-standing-seam-metal',
    displayName: 'Standing-Seam Aluminum/Galvalume Roof with Cool-Roof PVDF Coating',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['roof-covering-and-trim'],
    mappedCostTier: 'High-End Architectural',
    defaultHexColor: '#475569',
    materialClassSummary:
      'Mechanically seamed architectural metal roofing with cool-pigment fluoropolymer (PVDF) coating over ventilated roof deck.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ASHRAE Fundamentals Ch. 26 & Cool Roof Rating Council (CRRC) / ISO 9223.',
    thermalConductivityWPerMK: {
      value: 160,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 (Aluminum alloy sheet)',
      applicableConditions: 'Metal sheet conducts heat rapidly; thermal insulation is provided by the underlying roof insulation assembly.',
    },
    specificHeatJPerKgK: {
      value: 880,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Metal roofing sheet.',
    },
    densityKgPerM3: {
      value: 2700,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Aluminum alloy.',
    },
    solarReflectanceFraction: {
      value: 0.65,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE 90.1 / CRRC Cool-Roof PVDF Reference',
      applicableConditions: 'Solar-reflective cool-pigment PVDF finish.',
    },
    thermalEmissivityFraction: {
      value: 0.85,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26 (PVDF coated metal)',
      applicableConditions: 'High infrared emittance.',
    },
    maxServiceTempC: {
      value: 100,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'AAMA 2605',
      applicableConditions: 'Requires sliding concealed clips to accommodate linear thermal expansion.',
    },
    waterAbsorptionPctByWeight: {
      value: 0.0,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Impervious metal sheet; requires minimum roof pitch (>= 3° / 1:20) and high-temp underlayment.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 100000,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Vapour-impermeable outer roof skin; requires ventilated batten cavity or verified warm-roof vapour control layer.',
    },
    moistureSensitivityRating: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'US EPA Moisture Control Guidance',
      applicableConditions: 'Requires condensation-control underlayment and ventilated batten space.',
    },
    dryingPotentialNote:
      'Impermeable outer layer; roof assembly must dry downward or through ventilated counter-batten cavity.',
    freezeThawResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'NRCA Roofing Manual',
      applicableConditions: 'Immune to freeze–thaw spalling; requires snow guards and eave ice-dam membrane in cold climates.',
    },
    coastalSaltCorrosionResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 9223 / AAMA 2605',
      applicableConditions: 'Marine-grade aluminum with PVDF coating resists coastal salt; avoid bare Galvalume cut edges within 1 km of surf.',
    },
    uvWeatheringResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'AAMA 2605 (70% PVDF Fluoropolymer)',
      applicableConditions: 'High UV chalking and fade resistance.',
    },
    combustibilityOrWildfireNote: {
      value: 'Non-combustible metal roof covering. High wildfire ember resistance when eave vents are ember-screened.',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13501-1 / WUI Roofing Guidance',
      applicableConditions: 'Verify non-combustible underlayment in WUI zones.',
    },
    maintenanceIntervalYears: {
      value: 10,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Clear gutters/valleys annually; inspect penetration flashings every 5–10 years.',
    },
    maintenanceRequirementsSummary:
      'Wash salt deposits in coastal zones; inspect pipe boots, ridge vents, and snow guards every 5 years.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 40, maxYears: 60 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Assumes sliding clip detailing and no galvanic contact with copper/untreated wood.',
    },
    relativeCostIndexPerM2Usd: {
      value: 165,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Standing-seam metal roof covering.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: null,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'unavailable',
      sourceCitation: 'Not separately parameterized in Plotify scenarioCalculator.ts',
      applicableConditions: 'Requires product-specific EPD for roof assembly LCA (P44 boundary).',
    },
    requiresVentilatedRainscreenOrDrainageCavity: true,
    requiresProtectiveSealerOrCoatingInWetClimate: false,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Install over high-temperature breathable synthetic underlayment and ventilated counter-battens with 316 stainless sliding clips.',
    knownIncompatibilities: [
      'Direct contact with copper flashing or ACQ-treated lumber (galvanic corrosion)',
      'Unventilated cold roof cavities without interior air/vapour barrier (underside condensation dripping)',
    ],
    sourceOrganisation: 'ASHRAE / AAMA / ISO',
    sourceDocument: 'ASHRAE Fundamentals Ch. 26, AAMA 2605 & ISO 10456',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Rain impact noise requires acoustic mineral wool insulation beneath roof deck.',
    ],
  },

  // 9. Roof Covering: Natural Clay / Terracotta Barrel Roof Tile
  {
    materialId: 'mat-roof-terracotta-clay-tile',
    displayName: 'Kiln-Fired Terracotta / Clay Interlocking Roof Tile',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['roof-covering-and-trim'],
    mappedCostTier: 'Balanced Mid-Range',
    defaultHexColor: '#9a3412',
    materialClassSummary:
      'High-thermal-mass ventilated clay roof tile assembly suited to hot-arid, Mediterranean, and coastal climates.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ASTM C1167 Grade 1 / EN 1304.',
    thermalConductivityWPerMK: {
      value: 1.0,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 (Clay roof tile)',
      applicableConditions: 'Sub-tile ventilation airflow reduces solar heat transfer to roof deck.',
    },
    specificHeatJPerKgK: {
      value: 800,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Fired clay tile.',
    },
    densityKgPerM3: {
      value: 2000,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Heavy roof dead load (~45–65 kg/m²).',
    },
    solarReflectanceFraction: {
      value: 0.44,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'CRRC / ASHRAE Fundamentals Ch. 26 (Natural terracotta clay tile)',
      applicableConditions: 'Moderate solar reflectance enhanced by above-sheathing ventilation.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26',
      applicableConditions: 'Ceramic surface.',
    },
    maxServiceTempC: {
      value: 400,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1304',
      applicableConditions: 'Kiln-fired clay.',
    },
    waterAbsorptionPctByWeight: {
      value: 6.0,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASTM C1167 Grade 1',
      applicableConditions: 'Grade 1 low-absorption tile required for freeze–thaw zones.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 40,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Lapped tile assembly is ventilated.',
    },
    moistureSensitivityRating: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1304',
      applicableConditions: 'Requires secondary water-shedding underlayment beneath battens for wind-driven rain.',
    },
    dryingPotentialNote:
      'High drying potential across ventilated batten and counter-batten airspace.',
    freezeThawResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASTM C1167 Grade 1 / EN 539-2',
      applicableConditions: 'Must specify ASTM C1167 Grade 1 frost-tested tile in freeze–thaw zones; Grade 3 tiles spall in frost.',
    },
    coastalSaltCorrosionResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1304',
      applicableConditions: 'Vitrified clay resists coastal salt; storm clips and nails must be 316 stainless steel or silicon bronze.',
    },
    uvWeatheringResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1304',
      applicableConditions: 'Permanent ceramic color; underlayment beneath tiles must be UV-stabilized.',
    },
    combustibilityOrWildfireNote: {
      value: 'Non-combustible clay tile (Euroclass A1). Bird-stops/eave closures required to block ember entry under barrel profiles.',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1304 / WUI Roofing Guidance',
      applicableConditions: 'Seal open barrel eave ends against windblown embers.',
    },
    maintenanceIntervalYears: {
      value: 10,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Inspect for cracked tiles and underlayment integrity every 10 years.',
    },
    maintenanceRequirementsSummary:
      'Replace individual wind/impact-cracked tiles; renew secondary roof underlayment at 25–30 years.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 50, maxYears: 75 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Tile outlasts underlayment; roof rafters must be engineered for tile dead load.',
    },
    relativeCostIndexPerM2Usd: {
      value: 145,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Installed clay roof tile on battens.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: null,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'unavailable',
      sourceCitation: 'Not separately parameterized in Plotify scenarioCalculator.ts',
      applicableConditions: 'Requires product EPD.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: true,
    requiresProtectiveSealerOrCoatingInWetClimate: false,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Requires pitched roof (>= 18°) with counter-battens, breathable waterproof sarking membrane, and structural rafter verification.',
    knownIncompatibilities: [
      'Low-slope or flat roofs (< 15° pitch)',
      'Lightweight roof framing not engineered for 50+ kg/m² dead weight',
    ],
    sourceOrganisation: 'ASTM / CEN / ISO',
    sourceDocument: 'ASTM C1167, EN 1304 & ISO 10456:2007',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Requires structural roof framing review due to high unit weight.',
    ],
  },

  // 10. Envelope Insulation & Moisture Control: High-Density Stone Wool / Mineral Wool Continuous Insulation
  {
    materialId: 'mat-insul-mineral-stone-wool',
    displayName: 'Hydrophobic High-Density Stone Wool / Mineral Fibre Board',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['envelope-insulation-and-moisture-control'],
    mappedCostTier: 'Balanced Mid-Range',
    defaultHexColor: '#cbd5e1',
    materialClassSummary:
      'Vapour-permeable, non-combustible mineral wool continuous exterior insulation board for rainscreen and cavity walls.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ISO 10456:2007, EN 13162 & ASHRAE Fundamentals Ch. 26.',
    thermalConductivityWPerMK: {
      value: 0.035,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 / EN 13162 (Mineral wool board)',
      applicableConditions: 'Low thermal conductivity insulation layer; whole-wall R/U-value depends on installed thickness and thermal bridging.',
    },
    specificHeatJPerKgK: {
      value: 1030,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Stone wool.',
    },
    densityKgPerM3: {
      value: 110,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13162 Semi-rigid facade insulation board',
      applicableConditions: 'Dual-density or rigid rainscreen board.',
    },
    solarReflectanceFraction: {
      value: null,
      unit: 'N/A (concealed layer)',
      evidenceStatus: 'unavailable',
      sourceCitation: 'Concealed behind exterior cladding',
      applicableConditions: 'Must not be left permanently exposed to UV or weather.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Concealed cavity layer.',
    },
    maxServiceTempC: {
      value: 750,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13162 / ASTM C612',
      applicableConditions: 'Basalt stone fibre melting point > 1000 °C.',
    },
    waterAbsorptionPctByWeight: {
      value: 1.5,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 1609 Short-term water absorption <= 1.0 kg/m²',
      applicableConditions: 'Hydrophobic-treated fibres drain liquid water while remaining vapour-open.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 1.2,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 (μ ≈ 1)',
      applicableConditions: 'Highly vapour-open; allows wall assembly to dry outward into ventilated rainscreen cavity.',
    },
    moistureSensitivityRating: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'US EPA Moisture Control Guidance',
      applicableConditions: 'Does not support mould growth or wick water by capillarity.',
    },
    dryingPotentialNote:
      'Exceptional outward drying potential (μ ≈ 1.2) when paired with a ventilated rainscreen cladding.',
    freezeThawResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13162',
      applicableConditions: 'Draining fibre structure resists freeze–thaw degradation.',
    },
    coastalSaltCorrosionResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13162',
      applicableConditions: 'Inorganic basalt fibre; insulation retaining pins must be stainless steel near coast.',
    },
    uvWeatheringResistance: {
      value: 'not-applicable',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13162',
      applicableConditions: 'Concealed envelope insulation layer protected by exterior cladding.',
    },
    combustibilityOrWildfireNote: {
      value: 'Non-combustible mineral stone wool (Euroclass A1). Suitable for fire-resilient cavity barriers.',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13162 / EN 13501-1',
      applicableConditions: 'Material property only; does not certify statutory wall fire-resistance rating.',
    },
    maintenanceIntervalYears: {
      value: 40,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Concealed behind cladding; inspected during cladding refurbishment.',
    },
    maintenanceRequirementsSummary:
      'Concealed layer requiring no routine maintenance if exterior rainscreen and flashings remain intact.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 50, maxYears: 75 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Dimensionally stable concealed mineral insulation.',
    },
    relativeCostIndexPerM2Usd: {
      value: 65,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Continuous exterior insulation layer (100–150 mm nominal).',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: null,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'unavailable',
      sourceCitation: 'Not separately parameterized in Plotify scenarioCalculator.ts',
      applicableConditions: 'Requires thickness-specific calculation.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: true,
    requiresProtectiveSealerOrCoatingInWetClimate: false,
    requiresMarineGradeFixingsNearCoast: true,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Compatible with timber, brick, stone, or metal ventilated rainscreens over a continuous air/water control barrier.',
    knownIncompatibilities: [
      'Below-grade submerged foundation walls with hydrostatic pressure (use closed-cell XPS/foam glass below grade)',
    ],
    sourceOrganisation: 'ISO / CEN / ASHRAE',
    sourceDocument: 'ISO 10456:2007, EN 13162 & ASHRAE Fundamentals Ch. 26',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Material thermal conductivity λ = 0.035 W/(m·K) alone does not define whole-wall U-value without specified thickness and thermal bridge fasteners.',
    ],
  },

  // 11. Interior Wall Finish: Artisanal Breathable Limewash / Mineral Plaster (`limewash-mineral` / `matte-plaster`)
  {
    materialId: 'mat-int-wall-breathable-limewash',
    displayName: 'Breathable Interior Mineral Limewash & Matte Lime Plaster',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['interior-wall-finish'],
    mappedInteriorWallFinish: 'limewash-mineral',
    mappedCostTier: 'Balanced Mid-Range',
    defaultHexColor: '#f1f5f9',
    materialClassSummary:
      'High-pH breathable mineral interior wall finish that buffers indoor humidity variations and resists mould on dry/semi-humid interior walls.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ISO 10456:2007 & EN 998-1 (Interior Lime Plaster).',
    thermalConductivityWPerMK: {
      value: 0.7,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Thin interior skim/finish coat.',
    },
    specificHeatJPerKgK: {
      value: 1000,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Interior mineral plaster.',
    },
    densityKgPerM3: {
      value: 1400,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Lime plaster.',
    },
    solarReflectanceFraction: {
      value: 0.8,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Daylight reflectance reference',
      applicableConditions: 'High interior daylight reflectance.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Interior wall.',
    },
    maxServiceTempC: {
      value: 80,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1',
      applicableConditions: 'Interior environment.',
    },
    waterAbsorptionPctByWeight: {
      value: 12.0,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1',
      applicableConditions: 'Hygroscopic moisture-buffering finish; not suitable for direct shower splash zones without tadelakt/tile waterproofing.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 10,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Very vapour-permeable; prevents trapping moisture at the interior face in hot-humid air-conditioned buildings.',
    },
    moistureSensitivityRating: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'US EPA Moisture Control Guidance',
      applicableConditions: 'High alkalinity inhibits surface mould in humid climates, but direct liquid water splash in bathrooms requires ceramic tile or waterproof membrane.',
    },
    dryingPotentialNote:
      'High vapour permeability allows inward/outward hygric buffering without blistering.',
    freezeThawResistance: {
      value: 'not-applicable',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Interior conditioned space application',
      applicableConditions: 'Conditioned interior use only.',
    },
    coastalSaltCorrosionResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1',
      applicableConditions: 'Interior mineral finish.',
    },
    uvWeatheringResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1',
      applicableConditions: 'Mineral pigments do not yellow indoors.',
    },
    combustibilityOrWildfireNote: {
      value: 'Non-combustible mineral interior finish (Euroclass A1).',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 998-1',
      applicableConditions: 'Interior surface finish.',
    },
    maintenanceIntervalYears: {
      value: 6,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Refresh limewash coat every 5–8 years in high-traffic rooms.',
    },
    maintenanceRequirementsSummary:
      'Spot-repairable with mineral limewash; avoid film-forming acrylic primers over lime.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 20, maxYears: 40 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Interior plaster base lasts 40+ years with periodic wash recoats.',
    },
    relativeCostIndexPerM2Usd: {
      value: 55,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Interior wall finish rate.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: null,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'unavailable',
      sourceCitation: 'Interior finish not separately parameterized in Plotify scenarioCalculator.ts',
      applicableConditions: 'Low-carbon mineral finish.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: false,
    requiresProtectiveSealerOrCoatingInWetClimate: false,
    requiresMarineGradeFixingsNearCoast: false,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Apply over mineral plasterboard or masonry with silicate/mineral primer; in wet rooms (bathrooms/showers), use waterproof membrane + tile in splash zones.',
    knownIncompatibilities: [
      'Direct unsealed shower or tub wet-zone splash walls',
      'Overcoating with impermeable vinyl wallpaper in hot-humid climates',
    ],
    sourceOrganisation: 'ISO / CEN / US EPA',
    sourceDocument: 'ISO 10456:2007, EN 998-1 & EPA 402-F-13053',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Not a waterproof wet-room membrane for shower enclosures.',
    ],
  },

  // 12. Interior Wall Finish: Acoustic White Oak Slats & Felt (`timber-slats` / `acoustic-felt`)
  {
    materialId: 'mat-int-wall-acoustic-timber-slats',
    displayName: 'Interior Acoustic White Oak Timber Slats on PET Felt Backing',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['interior-wall-finish'],
    mappedInteriorWallFinish: 'timber-slats',
    mappedCostTier: 'High-End Architectural',
    defaultHexColor: '#c2a679',
    materialClassSummary:
      'Decorative and sound-absorbing interior timber slat panelling on recycled PET felt backing for dry living, work, and bedroom spaces.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ISO 10456:2007 & Wood Handbook FPL-GTR-282.',
    thermalConductivityWPerMK: {
      value: 0.14,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 (Oak hardwood)',
      applicableConditions: 'Interior panelling.',
    },
    specificHeatJPerKgK: {
      value: 1600,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Timber panelling.',
    },
    densityKgPerM3: {
      value: 650,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'White oak veneer/slat.',
    },
    solarReflectanceFraction: {
      value: 0.45,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Interior daylight reflectance reference',
      applicableConditions: 'Warm oak tone.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Interior wood surface.',
    },
    maxServiceTempC: {
      value: 55,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282',
      applicableConditions: 'Conditioned indoor spaces.',
    },
    waterAbsorptionPctByWeight: {
      value: 18.0,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282',
      applicableConditions: 'Hygroscopic wood and porous felt trap moisture and mould in high-humidity or wet rooms.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 50,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Slatted panel.',
    },
    moistureSensitivityRating: {
      value: 'low-sensitive',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'US EPA Moisture Control Guidance (EPA 402-F-13053)',
      applicableConditions: 'Not suitable for bathrooms, laundries, or unconditioned high-humidity spaces (>70% RH) due to warping and mould risk behind felt.',
    },
    dryingPotentialNote:
      'Porous felt backing against cold exterior walls can accumulate condensation and mould in humid or cold climates.',
    freezeThawResistance: {
      value: 'not-applicable',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Conditioned interior use only',
      applicableConditions: 'Interior use only.',
    },
    coastalSaltCorrosionResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Interior conditioned use',
      applicableConditions: 'Indoor use.',
    },
    uvWeatheringResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282',
      applicableConditions: 'Oak amber/darkens slightly under direct window UV.',
    },
    combustibilityOrWildfireNote: {
      value: 'Combustible interior wood/polymer finish unless specified with verified flame-retardant treatment.',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13501-1 Generic Reference',
      applicableConditions: 'Check interior flame-spread code requirements for corridors/exits.',
    },
    maintenanceIntervalYears: {
      value: 10,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Dry vacuum/dusting only.',
    },
    maintenanceRequirementsSummary:
      'Dust with dry brush attachment; keep indoor RH between 35% and 60%.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 20, maxYears: 35 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Dry conditioned interior rooms.',
    },
    relativeCostIndexPerM2Usd: {
      value: 140,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Acoustic timber slat wall system.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: null,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'unavailable',
      sourceCitation: 'Interior finish not separately parameterized in Plotify scenarioCalculator.ts',
      applicableConditions: 'Interior finish.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: false,
    requiresProtectiveSealerOrCoatingInWetClimate: false,
    requiresMarineGradeFixingsNearCoast: false,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Install on dry interior partition walls; if mounted on exterior walls in cold/humid climates, mount on furring strips to allow air circulation.',
    knownIncompatibilities: [
      'Bathrooms, shower rooms, and wet laundry rooms (moisture swelling and mould behind felt)',
      'Unconditioned tropical/monsoon interiors without dehumidification',
    ],
    sourceOrganisation: 'ISO / USDA Forest Products Laboratory / US EPA',
    sourceDocument: 'ISO 10456:2007, Wood Handbook FPL-GTR-282 & EPA 402-F-13053',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'Conditioned dry interior spaces',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Strictly unsuitable for wet rooms (bathrooms/showers).',
    ],
  },

  // 13. Interior Floor Finish: Honed Architectural Concrete / Terrazzo (`polished-concrete` / `terrazzo-aggregate`)
  {
    materialId: 'mat-int-floor-honed-concrete-terrazzo',
    displayName: 'Honed Architectural Concrete & Mineral Terrazzo Flooring',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['interior-floor-finish'],
    mappedInteriorFloorFinish: 'polished-concrete',
    mappedCostTier: 'Balanced Mid-Range',
    defaultHexColor: '#94a3b8',
    materialClassSummary:
      'Moisture-tolerant, high-thermal-mass mineral slab/terrazzo flooring suited to humid, hot-arid passive solar, and wet-room interiors.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per ISO 10456:2007 & EN 13813 Screed/Terrazzo Reference.',
    thermalConductivityWPerMK: {
      value: 1.6,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'High thermal conductivity and thermal mass; ideal for radiant floor heating/cooling and passive solar heat storage.',
    },
    specificHeatJPerKgK: {
      value: 1000,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'High thermal capacity.',
    },
    densityKgPerM3: {
      value: 2200,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Dense mineral screed/terrazzo.',
    },
    solarReflectanceFraction: {
      value: 0.48,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ASHRAE Fundamentals Ch. 26',
      applicableConditions: 'Absorbs direct sun patch for passive thermal storage when uncarpeted.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Honed mineral floor.',
    },
    maxServiceTempC: {
      value: 120,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13813',
      applicableConditions: 'Compatible with underfloor hydronic radiant heating.',
    },
    waterAbsorptionPctByWeight: {
      value: 2.5,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13813 (Lithium-silicate densified and sealed)',
      applicableConditions: 'Moisture-tolerant mineral matrix; wet rooms still require code-compliant sub-screed waterproofing membrane and slip-resistant matte honing.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 100,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Mineral floor slab.',
    },
    moistureSensitivityRating: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'US EPA Moisture Control Guidance',
      applicableConditions: 'Will not cup, warp, or rot under high humidity or occasional wetting.',
    },
    dryingPotentialNote:
      'Requires sub-slab capillary break and vapour retarder over ground soil.',
    freezeThawResistance: {
      value: 'not-applicable',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Conditioned interior floor application',
      applicableConditions: 'Interior floor.',
    },
    coastalSaltCorrosionResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13813',
      applicableConditions: 'Resists tracked-in coastal sand and salt abrasion.',
    },
    uvWeatheringResistance: {
      value: 'high-resistant',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13813',
      applicableConditions: 'Cementitious/mineral binder is UV-stable (avoid non-UV epoxy binders in sun-drenched rooms).',
    },
    combustibilityOrWildfireNote: {
      value: 'Non-combustible mineral flooring (Euroclass A1fl).',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13813 / EN 13501-1',
      applicableConditions: 'Non-combustible floor finish.',
    },
    maintenanceIntervalYears: {
      value: 8,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Reapply penetrating stain-guard sealer every 5–10 years.',
    },
    maintenanceRequirementsSummary:
      'Neutral-pH damp mop cleaning; reapply penetrating lithium-silicate/stain sealer every 5–10 years.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 40, maxYears: 75 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'Long-life mineral floor surface.',
    },
    relativeCostIndexPerM2Usd: {
      value: 110,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Honed and densified architectural concrete flooring.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: null,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'unavailable',
      sourceCitation: 'Interior floor finish not separately parameterized in Plotify scenarioCalculator.ts',
      applicableConditions: 'Interior finish.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: false,
    requiresProtectiveSealerOrCoatingInWetClimate: true,
    requiresMarineGradeFixingsNearCoast: false,
    suitableForInteriorWetRooms: true,
    compatibleSubstratesAndFixingsNote:
      'Requires sub-slab polyethylene vapour retarder over granular capillary break; specify matte honed slip-resistant finish in bathrooms/kitchens.',
    knownIncompatibilities: [
      'Uninsulated ground slabs in cold climates without under-slab insulation (cold floor discomfort and surface condensation risk)',
    ],
    sourceOrganisation: 'ISO / CEN / US EPA',
    sourceDocument: 'ISO 10456:2007, EN 13813 & EPA 402-F-13053',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'International reference',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Hard acoustic and underfoot surface; requires under-slab thermal insulation in cold climates.',
    ],
  },

  // 14. Interior Floor Finish: Engineered White Oak Plank (`light-oak-plank` / `smoked-walnut`)
  {
    materialId: 'mat-int-floor-engineered-oak-plank',
    displayName: 'Engineered White Oak / Hardwood Timber Plank Flooring',
    recordKind: 'traceable-generic-material',
    supportedApplications: ['interior-floor-finish'],
    mappedInteriorFloorFinish: 'light-oak-plank',
    mappedCostTier: 'High-End Architectural',
    defaultHexColor: '#d4b996',
    materialClassSummary:
      'Multi-ply cross-laminated engineered hardwood plank with warm tactile underfoot comfort, sensitive to standing water and extreme humidity swings.',
    productManufacturerOrStandardNote:
      'Generic traceable dataset per EN 13489 / NWFA Technical Guidelines & ISO 10456:2007.',
    thermalConductivityWPerMK: {
      value: 0.15,
      unit: 'W/(m·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3 (Oak / plywood)',
      applicableConditions: 'Warm underfoot in cool climates; limits floor surface temperature to <= 27 °C over radiant heating.',
    },
    specificHeatJPerKgK: {
      value: 1600,
      unit: 'J/(kg·K)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Hardwood plank.',
    },
    densityKgPerM3: {
      value: 680,
      unit: 'kg/m³',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Engineered oak.',
    },
    solarReflectanceFraction: {
      value: 0.5,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Interior daylight reference',
      applicableConditions: 'Light oak matte oil finish.',
    },
    thermalEmissivityFraction: {
      value: 0.9,
      unit: 'fraction (0–1)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007',
      applicableConditions: 'Wood floor.',
    },
    maxServiceTempC: {
      value: 27,
      unit: '°C',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'NWFA / EN 13489 Radiant Heating Limit',
      applicableConditions: 'Surface temperatures > 27 °C cause delamination, gapping, and cupping.',
    },
    waterAbsorptionPctByWeight: {
      value: 16.0,
      unit: '% by weight',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282',
      applicableConditions: 'Hygroscopic wood; standing water or slab moisture > 75% RH causes cupping and buckling.',
    },
    vapourDiffusionResistanceFactorMu: {
      value: 70,
      unit: 'dimensionless (μ)',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 10456:2007 Table 3',
      applicableConditions: 'Engineered wood plank.',
    },
    moistureSensitivityRating: {
      value: 'low-sensitive',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'NWFA Installation Guidelines / US EPA Moisture Control Guidance',
      applicableConditions: 'Requires indoor RH control (30–55% RH) and subfloor moisture vapour retarder; not recommended for full bathrooms or wet laundries.',
    },
    dryingPotentialNote:
      'Traps subfloor slab moisture unless a tested subfloor vapour barrier is installed.',
    freezeThawResistance: {
      value: 'not-applicable',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Conditioned interior use only',
      applicableConditions: 'Interior floor.',
    },
    coastalSaltCorrosionResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'NWFA Guidelines',
      applicableConditions: 'Tracked-in coastal sand abrades matte oil finish unless entry walk-off mats are provided.',
    },
    uvWeatheringResistance: {
      value: 'moderate-conditional',
      unit: 'rating',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Wood Handbook FPL-GTR-282',
      applicableConditions: 'Color shifts under direct floor-to-ceiling window UV exposure unless Low-E UV-filtering glazing is used.',
    },
    combustibilityOrWildfireNote: {
      value: 'Combustible organic wood flooring (typically Euroclass Cfl-s1 or Dfl-s1).',
      unit: 'classification note',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'EN 13489 / EN 13501-1',
      applicableConditions: 'Interior floor finish.',
    },
    maintenanceIntervalYears: {
      value: 5,
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'NWFA / ISO 15686-1 Reference',
      applicableConditions: 'Maintenance oil/finish refresh every 3–5 years; full sand-and-refinish every 12–15 years.',
    },
    maintenanceRequirementsSummary:
      'Maintain indoor relative humidity 35–55%; wipe spills immediately; recoat hardwax oil every 3–5 years.',
    expectedServiceLifeYearsRange: {
      value: { minYears: 25, maxYears: 40 },
      unit: 'years',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'ISO 15686-1 Reference',
      applicableConditions: 'In dry conditioned rooms with >= 3.5 mm hardwood wear layer.',
    },
    relativeCostIndexPerM2Usd: {
      value: 135,
      unit: 'USD/m²',
      evidenceStatus: 'traceable-generic-data',
      sourceCitation: 'Plotify Cost Planning Reference Index',
      applicableConditions: 'Installed engineered European white oak plank.',
    },
    embodiedCarbonKgCo2ePerM2GfaRef: {
      value: null,
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: 'unavailable',
      sourceCitation: 'Interior finish not separately parameterized in Plotify scenarioCalculator.ts',
      applicableConditions: 'Interior finish.',
    },
    requiresVentilatedRainscreenOrDrainageCavity: false,
    requiresProtectiveSealerOrCoatingInWetClimate: true,
    requiresMarineGradeFixingsNearCoast: false,
    suitableForInteriorWetRooms: false,
    compatibleSubstratesAndFixingsNote:
      'Requires cured dry subfloor (ASTM F2170 concrete RH <= 75% or epoxy moisture barrier) and perimeter expansion gap.',
    knownIncompatibilities: [
      'Wet bathrooms, shower rooms, and unconditioned humid spaces (cupping, warping, and delamination)',
      'High-temperature hydronic floor heating exceeding 27 °C surface temperature',
    ],
    sourceOrganisation: 'NWFA / CEN / ISO',
    sourceDocument: 'EN 13489, NWFA Technical Guidelines & ISO 10456:2007',
    datasetVersion: '2021-v1',
    publicationDate: '2021',
    applicableGeography: 'Conditioned dry interior spaces',
    overallEvidenceStatus: 'traceable-generic-data',
    knownLimitations: [
      'Not suitable for wet rooms or unconditioned high-humidity environments.',
    ],
  },
];

/**
 * Validates and normalizes a user-supplied custom material candidate before adding it to a project catalogue.
 * Strictly enforces P35 Section 6 & Section 16:
 * - Rejects invalid/negative numeric properties or NaN
 * - Rejects duplicate material IDs
 * - Never promotes user-entered data to 'verified-product-data' merely because numeric validation passed
 */
export function validateAndNormalizeCustomMaterial(
  rawCandidate: Partial<ClimateMaterialCandidate>,
  existingCatalogue: ClimateMaterialCandidate[]
): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  normalizedCandidate?: ClimateMaterialCandidate;
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!rawCandidate || typeof rawCandidate !== 'object') {
    return {
      isValid: false,
      errors: ['Material candidate payload must be a valid object.'],
      warnings: [],
    };
  }

  const materialId = (rawCandidate.materialId || '').trim();
  const displayName = (rawCandidate.displayName || '').trim();

  if (!materialId) {
    errors.push('materialId is required.');
  } else if (existingCatalogue.some((m) => m.materialId === materialId)) {
    errors.push(`Duplicate materialId "${materialId}" already exists in the catalogue.`);
  }

  if (!displayName) {
    errors.push('displayName is required.');
  }

  if (
    !Array.isArray(rawCandidate.supportedApplications) ||
    rawCandidate.supportedApplications.length === 0
  ) {
    errors.push('At least one supportedApplication category must be specified.');
  }

  // Validate numeric property helper
  const checkNumericProp = (
    prop: PropertyWithProvenance<number> | undefined,
    fieldName: string,
    minVal: number,
    maxVal: number,
    expectedUnitHint: string
  ) => {
    if (!prop || prop.value === null || prop.value === undefined) return;
    if (typeof prop.value !== 'number' || !Number.isFinite(prop.value)) {
      errors.push(`${fieldName} must be a finite number or null (received ${String(prop.value)}).`);
      return;
    }
    if (prop.value < minVal || prop.value > maxVal) {
      errors.push(
        `${fieldName} value ${prop.value} is outside physically plausible range [${minVal}, ${maxVal}] (${expectedUnitHint}).`
      );
    }
    if (!prop.unit || typeof prop.unit !== 'string' || !prop.unit.trim()) {
      errors.push(`${fieldName} is missing a unit string (expected ${expectedUnitHint}).`);
    }
  };

  checkNumericProp(
    rawCandidate.thermalConductivityWPerMK,
    'thermalConductivityWPerMK',
    0.005,
    500,
    'W/(m·K)'
  );
  checkNumericProp(rawCandidate.densityKgPerM3, 'densityKgPerM3', 5, 20000, 'kg/m³');
  checkNumericProp(
    rawCandidate.waterAbsorptionPctByWeight,
    'waterAbsorptionPctByWeight',
    0,
    200,
    '% by weight'
  );
  checkNumericProp(
    rawCandidate.solarReflectanceFraction,
    'solarReflectanceFraction',
    0,
    1,
    'fraction (0–1)'
  );
  checkNumericProp(
    rawCandidate.maintenanceIntervalYears,
    'maintenanceIntervalYears',
    0.5,
    100,
    'years'
  );
  checkNumericProp(
    rawCandidate.relativeCostIndexPerM2Usd,
    'relativeCostIndexPerM2Usd',
    1,
    10000,
    'USD/m²'
  );

  if (
    rawCandidate.expectedServiceLifeYearsRange?.value &&
    (rawCandidate.expectedServiceLifeYearsRange.value.minYears <= 0 ||
      rawCandidate.expectedServiceLifeYearsRange.value.maxYears <
        rawCandidate.expectedServiceLifeYearsRange.value.minYears)
  ) {
    errors.push(
      'expectedServiceLifeYearsRange must have minYears > 0 and maxYears >= minYears.'
    );
  }

  if (errors.length > 0) {
    return { isValid: false, errors, warnings };
  }

  // Enforce epistemic provenance: user-supplied custom materials are NEVER promoted to 'verified-product-data'
  const sanitizeEvidence = <T>(
    prop: PropertyWithProvenance<T> | undefined,
    defaultUnit: string
  ): PropertyWithProvenance<T> => {
    if (!prop || prop.value === null || prop.value === undefined) {
      return {
        value: null,
        unit: prop?.unit || defaultUnit,
        evidenceStatus: 'unavailable',
        sourceCitation: prop?.sourceCitation || 'Not provided by user',
        applicableConditions: prop?.applicableConditions || 'Property value unavailable',
      };
    }
    if (prop.evidenceStatus === 'verified-product-data') {
      warnings.push(
        `User-entered property (${defaultUnit}) downgraded from 'verified-product-data' to 'user-entered' because unverified user input cannot be automatically certified as manufacturer product data.`
      );
    }
    return {
      ...prop,
      evidenceStatus: 'user-entered',
      sourceCitation: prop.sourceCitation || 'User-entered custom material specification',
      applicableConditions:
        prop.applicableConditions || 'User-declared assumption; requires product data sheet verification.',
    };
  };

  const normalizedCandidate: ClimateMaterialCandidate = {
    materialId,
    displayName,
    recordKind: 'user-custom-material',
    supportedApplications: rawCandidate.supportedApplications!,
    mappedFacadeMaterial: rawCandidate.mappedFacadeMaterial,
    mappedInteriorWallFinish: rawCandidate.mappedInteriorWallFinish,
    mappedInteriorFloorFinish: rawCandidate.mappedInteriorFloorFinish,
    mappedWindowStyle: rawCandidate.mappedWindowStyle,
    mappedCostTier: rawCandidate.mappedCostTier || 'Balanced Mid-Range',
    defaultHexColor: rawCandidate.defaultHexColor || '#64748b',
    materialClassSummary:
      rawCandidate.materialClassSummary || 'User-defined custom architectural material candidate.',
    productManufacturerOrStandardNote:
      rawCandidate.productManufacturerOrStandardNote ||
      'User-entered custom record (unverified; requires manufacturer technical data sheet verification).',
    thermalConductivityWPerMK: sanitizeEvidence(
      rawCandidate.thermalConductivityWPerMK,
      'W/(m·K)'
    ),
    specificHeatJPerKgK: sanitizeEvidence(rawCandidate.specificHeatJPerKgK, 'J/(kg·K)'),
    densityKgPerM3: sanitizeEvidence(rawCandidate.densityKgPerM3, 'kg/m³'),
    solarReflectanceFraction: sanitizeEvidence(
      rawCandidate.solarReflectanceFraction,
      'fraction (0–1)'
    ),
    thermalEmissivityFraction: sanitizeEvidence(
      rawCandidate.thermalEmissivityFraction,
      'fraction (0–1)'
    ),
    maxServiceTempC: sanitizeEvidence(rawCandidate.maxServiceTempC, '°C'),
    waterAbsorptionPctByWeight: sanitizeEvidence(
      rawCandidate.waterAbsorptionPctByWeight,
      '% by weight'
    ),
    vapourDiffusionResistanceFactorMu: sanitizeEvidence(
      rawCandidate.vapourDiffusionResistanceFactorMu,
      'dimensionless (μ)'
    ),
    moistureSensitivityRating: sanitizeEvidence(
      rawCandidate.moistureSensitivityRating,
      'rating'
    ),
    dryingPotentialNote:
      rawCandidate.dryingPotentialNote || 'Drying behaviour not yet verified by hygrothermal testing.',
    freezeThawResistance: sanitizeEvidence(rawCandidate.freezeThawResistance, 'rating'),
    coastalSaltCorrosionResistance: sanitizeEvidence(
      rawCandidate.coastalSaltCorrosionResistance,
      'rating'
    ),
    uvWeatheringResistance: sanitizeEvidence(rawCandidate.uvWeatheringResistance, 'rating'),
    combustibilityOrWildfireNote: sanitizeEvidence(
      rawCandidate.combustibilityOrWildfireNote,
      'classification note'
    ),
    maintenanceIntervalYears: sanitizeEvidence(rawCandidate.maintenanceIntervalYears, 'years'),
    maintenanceRequirementsSummary:
      rawCandidate.maintenanceRequirementsSummary ||
      'Verify maintenance schedule with manufacturer technical documentation.',
    expectedServiceLifeYearsRange: sanitizeEvidence(
      rawCandidate.expectedServiceLifeYearsRange,
      'years'
    ),
    relativeCostIndexPerM2Usd: sanitizeEvidence(
      rawCandidate.relativeCostIndexPerM2Usd,
      'USD/m²'
    ),
    embodiedCarbonKgCo2ePerM2GfaRef: sanitizeEvidence(
      rawCandidate.embodiedCarbonKgCo2ePerM2GfaRef,
      'kg CO₂e/m² GFA'
    ),
    requiresVentilatedRainscreenOrDrainageCavity: Boolean(
      rawCandidate.requiresVentilatedRainscreenOrDrainageCavity
    ),
    requiresProtectiveSealerOrCoatingInWetClimate: Boolean(
      rawCandidate.requiresProtectiveSealerOrCoatingInWetClimate
    ),
    requiresMarineGradeFixingsNearCoast: Boolean(
      rawCandidate.requiresMarineGradeFixingsNearCoast
    ),
    suitableForInteriorWetRooms: Boolean(rawCandidate.suitableForInteriorWetRooms),
    compatibleSubstratesAndFixingsNote:
      rawCandidate.compatibleSubstratesAndFixingsNote ||
      'Substrate and fixing compatibility requires engineering review.',
    knownIncompatibilities: Array.isArray(rawCandidate.knownIncompatibilities)
      ? [...rawCandidate.knownIncompatibilities]
      : [],
    sourceOrganisation: rawCandidate.sourceOrganisation || 'User-Entered Specification',
    sourceDocument: rawCandidate.sourceDocument || 'User Input (Unverified)',
    datasetVersion: rawCandidate.datasetVersion || 'custom-v1',
    publicationDate: rawCandidate.publicationDate || new Date().toISOString().slice(0, 10),
    applicableGeography: rawCandidate.applicableGeography || 'Project-specific user assumption',
    overallEvidenceStatus: 'user-entered',
    knownLimitations: [
      ...(rawCandidate.knownLimitations || []),
      'User-entered custom material record; properties are not certified manufacturer test data.',
    ],
  };

  return {
    isValid: true,
    errors: [],
    warnings,
    normalizedCandidate,
  };
}

/**
 * Returns the full merged catalogue (built-in immutable records + project custom material records).
 */
export function getAvailableMaterialCatalogue(project?: Project): ClimateMaterialCandidate[] {
  const builtInClones: ClimateMaterialCandidate[] = JSON.parse(
    JSON.stringify(BUILTIN_CLIMATE_MATERIAL_CATALOGUE)
  );
  const custom = project?.materialAdvisor?.customMaterialCatalogue || [];
  const customClones: ClimateMaterialCandidate[] = JSON.parse(JSON.stringify(custom));
  return [...builtInClones, ...customClones];
}

/**
 * Initializes or normalizes `ProjectMaterialAdvisorData` on a project without fabricating climate values.
 */
export function initializeProjectMaterialAdvisorData(
  project: Project
): ProjectMaterialAdvisorData {
  const existing = project.materialAdvisor;
  const defaultCompared: Partial<Record<MaterialApplicationCategory, string[]>> = {
    'exterior-primary-facade': [
      'mat-ext-thermowood-cedar',
      'mat-ext-mineral-plaster-render',
      'mat-ext-clay-brick-cavity',
      'mat-ext-dense-ashlar-stone',
      'mat-ext-architectural-concrete',
      'mat-ext-solar-control-glazing',
    ],
    'exterior-accent-cladding': [
      'mat-ext-dense-ashlar-stone',
      'mat-ext-thermowood-cedar',
      'mat-ext-clay-brick-cavity',
      'mat-ext-porous-limestone-unverified',
    ],
    'roof-covering-and-trim': [
      'mat-roof-cool-standing-seam-metal',
      'mat-roof-terracotta-clay-tile',
    ],
    'exterior-glazing-and-frames': ['mat-ext-solar-control-glazing'],
    'envelope-insulation-and-moisture-control': ['mat-insul-mineral-stone-wool'],
    'interior-wall-finish': [
      'mat-int-wall-breathable-limewash',
      'mat-int-wall-acoustic-timber-slats',
    ],
    'interior-floor-finish': [
      'mat-int-floor-honed-concrete-terrazzo',
      'mat-int-floor-engineered-oak-plank',
    ],
  };

  const firstRoomId = project.floorPlan?.rooms?.[0]?.id;

  if (existing) {
    return {
      version: P35_MATERIAL_ADVISOR_ENGINE_VERSION,
      climateContext: existing.climateContext || createUnconfiguredClimateContext(project),
      selectedApplication: existing.selectedApplication || 'exterior-primary-facade',
      selectedTargetRoomId: existing.selectedTargetRoomId || firstRoomId,
      comparedMaterialIdsByApplication: {
        ...defaultCompared,
        ...(existing.comparedMaterialIdsByApplication || {}),
      },
      customMaterialCatalogue: Array.isArray(existing.customMaterialCatalogue)
        ? existing.customMaterialCatalogue
        : [],
      savedEnvelopeSelections: existing.savedEnvelopeSelections || {
        roofCoveringMaterialId: 'mat-roof-cool-standing-seam-metal',
        glazingSpecificationMaterialId: 'mat-ext-solar-control-glazing',
        insulationMoistureMaterialId: 'mat-insul-mineral-stone-wool',
        updatedAt: new Date().toISOString(),
      },
      scoringEnabled: existing.scoringEnabled ?? true,
      rankingWeights: existing.rankingWeights || { ...DEFAULT_MATERIAL_RANKING_WEIGHTS },
      lastEvaluatedAt: existing.lastEvaluatedAt,
      lastSourceFingerprint: existing.lastSourceFingerprint,
      lastPreApplySnapshotId: existing.lastPreApplySnapshotId,
      requestSequenceId:
        typeof existing.requestSequenceId === 'number' ? existing.requestSequenceId : 1,
    };
  }

  return {
    version: P35_MATERIAL_ADVISOR_ENGINE_VERSION,
    climateContext: createUnconfiguredClimateContext(project),
    selectedApplication: 'exterior-primary-facade',
    selectedTargetRoomId: firstRoomId,
    comparedMaterialIdsByApplication: defaultCompared,
    customMaterialCatalogue: [],
    savedEnvelopeSelections: {
      roofCoveringMaterialId: 'mat-roof-cool-standing-seam-metal',
      glazingSpecificationMaterialId: 'mat-ext-solar-control-glazing',
      insulationMoistureMaterialId: 'mat-insul-mineral-stone-wool',
      updatedAt: new Date().toISOString(),
    },
    scoringEnabled: true,
    rankingWeights: { ...DEFAULT_MATERIAL_RANKING_WEIGHTS },
    requestSequenceId: 1,
  };
}

/**
 * Computes a deterministic source fingerprint over the project's climate context,
 * active facade/interior material specs, P30 brief requirements, P32 preferences, and custom catalogue.
 */
export function computeMaterialAdvisorFingerprint(
  project: Project,
  overrideAdvisor?: Partial<ProjectMaterialAdvisorData>
): string {
  const advisor = {
    ...initializeProjectMaterialAdvisorData(project),
    ...(overrideAdvisor || {}),
  };
  const climate = advisor.climateContext;
  const climateSig = `${climate.profileId}:${climate.isConfigured}:${climate.summerDesignHighTempC}:${climate.winterDesignLowTempC}:${climate.meanRelativeHumidityPct}:${climate.humidityWettingRegime}:${climate.annualPrecipitationMm}:${climate.windDrivenRainExposure}:${climate.freezeThawExposure}:${climate.coastalSaltExposure}:${climate.solarUvExposure}:${climate.wildfireEmberExposure}`;

  const altSig = (project.designAlternatives || [])
    .map((a) => {
      const intSig = Object.values(a.interiors || {})
        .map((i) => `${i.roomId}:${i.wallFinish}:${i.floorFinish}`)
        .sort()
        .join(';');
      return `${a.id}:${a.facade?.primaryMaterial}:${a.facade?.accentMaterial}:${a.facade?.shadingStyle}:${a.facade?.windowStyle}:${intSig}`;
    })
    .join('|');

  const roomsSig = (project.floorPlan?.rooms || [])
    .map((r) => `${r.id}:${r.name}:${r.type}`)
    .join(',');

  const p30Sig = (project.brief?.interpretedBrief?.requirements || [])
    .filter((r) => r.category === 'materials-sustainability' || r.category === 'site-orientation')
    .map((r) => `${r.id}:${r.reviewStatus}:${r.priority}:${r.normalizedValue}`)
    .join(',');

  const p32Sig = (project.designPersonalization?.preferredPrimaryMaterials || []).join(',') +
    '|' +
    (project.designPersonalization?.items || [])
      .filter((i) => i.dimension === 'primary-material')
      .map((i) => `${i.id}:${i.confirmationStatus}:${JSON.stringify(i.value)}`)
      .join(',');

  const customCatSig = (advisor.customMaterialCatalogue || [])
    .map((c) => `${c.materialId}:${c.thermalConductivityWPerMK.value}:${c.waterAbsorptionPctByWeight.value}`)
    .join(',');

  const envSelSig = JSON.stringify(advisor.savedEnvelopeSelections || {});
  const weightsSig = `${advisor.scoringEnabled}:${JSON.stringify(advisor.rankingWeights)}`;

  const raw = `${project.id}|${project.roadFacing}|${climateSig}|${altSig}|${roomsSig}|${p30Sig}|${p32Sig}|${customCatSig}|${envSelSig}|${weightsSig}`;
  let hash = 5381;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 33) ^ raw.charCodeAt(i);
  }
  return `p35-fp-${(hash >>> 0).toString(16)}`;
}

/**
 * Helper to determine if a room is a wet/high-humidity room (Bathroom, WC, Laundry, Shower, Kitchen).
 */
export function isWetInteriorRoom(room?: FloorPlanRoom): boolean {
  if (!room) return false;
  const text = `${room.type} ${room.name}`.toLowerCase();
  return (
    text.includes('bath') ||
    text.includes('wc') ||
    text.includes('toilet') ||
    text.includes('restroom') ||
    text.includes('shower') ||
    text.includes('laundry') ||
    text.includes('utility') ||
    text.includes('wet')
  );
}

/**
 * Extracts P30 confirmed material requirements vs unconfirmed AI assumptions.
 */
export function extractP30MaterialRequirements(project: Project): {
  hasBrief: boolean;
  confirmedMaterialRequirements: string[];
  confirmedMandatoryMaterialKeywords: string[];
  unconfirmedMaterialAssumptions: string[];
  briefMaterialConflicts: string[];
} {
  const briefData = initializeProjectBrief(project);
  const interpreted = project.brief?.interpretedBrief;
  const confirmedMaterialRequirements: string[] = [];
  const confirmedMandatoryMaterialKeywords: string[] = [];
  const unconfirmedMaterialAssumptions: string[] = [];
  const briefMaterialConflicts: string[] = [];

  if (briefData.preferences?.materialPreferences?.trim()) {
    confirmedMaterialRequirements.push(
      `Brief Material Preference: ${briefData.preferences.materialPreferences.trim()}`
    );
  }
  if (briefData.constraints?.sustainabilityGoals?.trim()) {
    confirmedMaterialRequirements.push(
      `Brief Sustainability Goal: ${briefData.constraints.sustainabilityGoals.trim()}`
    );
  }

  if (interpreted) {
    for (const req of interpreted.requirements || []) {
      if (req.category === 'materials-sustainability') {
        if (req.reviewStatus === 'confirmed') {
          confirmedMaterialRequirements.push(
            `Confirmed P30 Requirement (${req.priority}): ${req.description} [${String(
              req.normalizedValue
            )}]`
          );
          if (req.priority === 'must-have') {
            const valLower = `${req.description} ${String(req.normalizedValue)}`.toLowerCase();
            for (const mat of ['timber', 'brick', 'stone', 'plaster', 'concrete', 'glass']) {
              if (valLower.includes(mat)) {
                confirmedMandatoryMaterialKeywords.push(mat);
              }
            }
          }
        } else if (req.reviewStatus === 'needs-review') {
          unconfirmedMaterialAssumptions.push(
            `Unconfirmed P30 Inference (held for user review, not enforced): ${req.description}`
          );
        }
      }
    }

    for (const assump of interpreted.assumptions || []) {
      if (assump.category === 'materials-sustainability') {
        if (assump.status === 'confirmed') {
          confirmedMaterialRequirements.push(
            `Confirmed Brief Assumption: ${assump.description} (${String(assump.assumedValue)})`
          );
        } else if (assump.status === 'pending') {
          unconfirmedMaterialAssumptions.push(
            `Pending P30 Assumption (unconfirmed): ${assump.description}`
          );
        }
      }
    }

    for (const conflict of interpreted.conflicts || []) {
      if (!conflict.resolved) {
        briefMaterialConflicts.push(`${conflict.title}: ${conflict.description}`);
      }
    }
  }

  return {
    hasBrief: Boolean(project.brief),
    confirmedMaterialRequirements,
    confirmedMandatoryMaterialKeywords,
    unconfirmedMaterialAssumptions,
    briefMaterialConflicts,
  };
}

/**
 * Extracts P32 explicit confirmed material preferences vs unconfirmed suggestions.
 */
export function extractP32MaterialPreferences(project: Project): {
  hasPersonalizationProfile: boolean;
  explicitPreferredMaterials: Array<FacadeConcept['primaryMaterial']>;
  inferredUnconfirmedMaterials: Array<FacadeConcept['primaryMaterial']>;
  lowCarbonPriorityWeight: number;
} {
  if (!project.designPersonalization) {
    return {
      hasPersonalizationProfile: false,
      explicitPreferredMaterials: [],
      inferredUnconfirmedMaterials: [],
      lowCarbonPriorityWeight: 45,
    };
  }

  const profile = initializePersonalizationProfile(project);
  const explicitPreferredMaterials = new Set<FacadeConcept['primaryMaterial']>();
  const inferredUnconfirmedMaterials = new Set<FacadeConcept['primaryMaterial']>();

  const combinedItems = [
    ...(Array.isArray(project.designPersonalization.items)
      ? project.designPersonalization.items
      : []),
    ...(profile.items || []),
  ];

  for (const item of combinedItems) {
    if (item.dimension === 'primary-material') {
      const vals = Array.isArray(item.value) ? item.value : [item.value];
      for (const v of vals) {
        if (
          typeof v === 'string' &&
          (['timber', 'brick', 'stone', 'plaster', 'concrete', 'glass'] as string[]).includes(v)
        ) {
          const mat = v as FacadeConcept['primaryMaterial'];
          if (
            item.confirmationStatus === 'confirmed' &&
            (item.origin === 'explicit-user' || item.origin === 'imported-project-fact')
          ) {
            explicitPreferredMaterials.add(mat);
          } else if (item.confirmationStatus === 'unconfirmed-suggestion') {
            inferredUnconfirmedMaterials.add(mat);
          }
        }
      }
    }
  }

  if (explicitPreferredMaterials.size === 0 && Array.isArray(profile.preferredPrimaryMaterials)) {
    for (const m of profile.preferredPrimaryMaterials) {
      explicitPreferredMaterials.add(m);
    }
  }

  return {
    hasPersonalizationProfile: true,
    explicitPreferredMaterials: Array.from(explicitPreferredMaterials),
    inferredUnconfirmedMaterials: Array.from(inferredUnconfirmedMaterials),
    lowCarbonPriorityWeight: profile.spatialPriorityWeights?.lowCarbonMaterials ?? 45,
  };
}

/**
 * Evaluates a single material candidate for a specified building application and project climate context.
 * Strictly implements P35 Section 7 (Domains A–G) and Section 8 (Assembly & Substrate Compatibility).
 */
export function evaluateMaterialCandidateForClimate(
  project: Project,
  candidate: ClimateMaterialCandidate,
  application: MaterialApplicationCategory,
  climateContext: ProjectClimateContext,
  options?: {
    targetRoomId?: string;
    activeFacade?: FacadeConcept;
  }
): MaterialCandidateSuitabilityReport {
  const activeAlt =
    project.designAlternatives?.find((a) => a.id === project.activeAlternativeId) ||
    project.designAlternatives?.[0];
  const facade = options?.activeFacade || activeAlt?.facade;
  const rooms = project.floorPlan?.rooms || [];
  const targetRoom = options?.targetRoomId
    ? rooms.find((r) => r.id === options.targetRoomId)
    : rooms[0];
  const isInteriorApp =
    application === 'interior-wall-finish' || application === 'interior-floor-finish';
  const wetRoomContext = isInteriorApp && isWetInteriorRoom(targetRoom);

  const solarAnalysis = evaluateSolarOrientation(project);
  const highSolarFacades: string[] = [];
  if (solarAnalysis.facadeSunExposure.southFacade === 'direct-high-solar-gain') {
    highSolarFacades.push('South');
  }
  if (solarAnalysis.facadeSunExposure.westFacade === 'afternoon-heat-glare-risk') {
    highSolarFacades.push('West');
  }

  const domainEvaluations: ExposureDomainEvaluation[] = [];
  const missingEvidenceItems: string[] = [];
  const maintenanceAndDurabilityConcerns: string[] = [];
  const principalTradeOffs: string[] = [];
  const conditionsAndProfessionalChecksRequired: string[] = [];
  const supportingPropertiesSummary: string[] = [];

  // Check if candidate supports this application
  if (!candidate.supportedApplications.includes(application)) {
    return {
      materialId: candidate.materialId,
      displayName: candidate.displayName,
      recordKind: candidate.recordKind,
      application,
      targetRoomId: targetRoom?.id,
      targetRoomName: targetRoom?.name,
      overallStatus: 'not-recommended-for-screened-conditions',
      evaluationBasis: 'standards-or-handbook-rule',
      domainEvaluations: [],
      assemblyCheck: {
        application,
        targetRoomName: targetRoom?.name,
        isWetRoomContext: wetRoomContext,
        facadeShadingStyle: facade?.shadingStyle,
        assemblyDetailsCompleteInModel: false,
        status: 'not-recommended-for-screened-conditions',
        compatibilityFindings: [
          `"${candidate.displayName}" is not scoped for application "${application}". Supported applications: ${candidate.supportedApplications.join(
            ', '
          )}.`,
        ],
        missingAssemblyInputs: [],
        requiredDetailingRecommendations: [],
      },
      supportingPropertiesSummary: [],
      missingEvidenceItems: [],
      maintenanceAndDurabilityConcerns: [
        `Application mismatch: "${candidate.displayName}" cannot be used for "${application}".`,
      ],
      principalTradeOffs: [],
      conditionsAndProfessionalChecksRequired: [],
      p30BriefAlignment: {
        matchesConfirmedRequirements: false,
        conflictsWithConfirmedRequirements: [],
        unconfirmedBriefInferencesNoted: [],
      },
      p32PreferenceAlignment: {
        matchesExplicitUserPreference: false,
        preferenceExplanation: 'Not applicable due to application mismatch.',
      },
      whySuitableOrUnsuitableSummary: `"${candidate.displayName}" is not designed for "${application}".`,
    };
  }

  // If climate context is unconfigured, never claim suitability!
  if (!climateContext.isConfigured || climateContext.sourceTier === 'unconfigured') {
    missingEvidenceItems.push(
      'Project climate context is unconfigured (summer/winter design temperatures, humidity/wetting regime, freeze–thaw exposure, and coastal salt exposure are not specified).'
    );
  }

  // ============================================================================
  // DOMAIN A: Heat & High-Temperature Exposure
  // ============================================================================
  const highTempC = climateContext.summerDesignHighTempC;
  const diurnalSwingC = climateContext.diurnalTempSwingC;
  const lambdaVal = candidate.thermalConductivityWPerMK.value;
  const solarRefl = candidate.solarReflectanceFraction.value;
  const maxTemp = candidate.maxServiceTempC.value;

  const heatKnown: string[] = [];
  const heatMissing: string[] = [];
  if (lambdaVal !== null) {
    heatKnown.push(`Thermal conductivity λ = ${lambdaVal} ${candidate.thermalConductivityWPerMK.unit}`);
    supportingPropertiesSummary.push(
      `Thermal conductivity λ = ${lambdaVal} ${candidate.thermalConductivityWPerMK.unit} (${candidate.thermalConductivityWPerMK.evidenceStatus})`
    );
  } else {
    heatMissing.push('Thermal conductivity λ (W/(m·K))');
  }
  if (solarRefl !== null) {
    heatKnown.push(`Solar reflectance = ${solarRefl}`);
    supportingPropertiesSummary.push(`Solar reflectance = ${solarRefl}`);
  } else if (application !== 'envelope-insulation-and-moisture-control') {
    heatMissing.push('Solar reflectance fraction');
  }

  let heatStatus: MaterialSuitabilityStatus = 'suitable-for-screened-conditions';
  let heatExplanation = '';
  const heatConditions: string[] = [];

  if (!climateContext.isConfigured || highTempC === null) {
    heatStatus = 'insufficient-evidence';
    heatMissing.push('Summer design high temperature (°C/°F)');
    heatExplanation =
      'Cannot evaluate high-temperature and solar thermal suitability because summer design temperature is not configured.';
  } else if (lambdaVal === null) {
    heatStatus = 'insufficient-evidence';
    heatExplanation =
      'Material thermal conductivity λ is unavailable; thermal response cannot be verified.';
  } else if (highTempC >= 35) {
    // Hot climate screening
    if (
      candidate.mappedFacadeMaterial === 'glass' &&
      (application === 'exterior-primary-facade' || application === 'exterior-glazing-and-frames')
    ) {
      const hasExternalShading =
        facade?.shadingStyle && facade.shadingStyle !== 'none';
      if (application === 'exterior-primary-facade' && !hasExternalShading) {
        heatStatus = 'not-recommended-for-screened-conditions';
        heatExplanation = `Unshaded structural glass primary facade under summer design temperature ${formatTemperature(
          highTempC,
          climateContext.temperatureUnit
        )} and ${highSolarFacades.join('/')} solar exposure creates severe solar heat gain and glare risk.`;
        heatConditions.push(
          'Specify external solar shading (deep overhangs, brise-soleil, or motorized louvers) and low-SHGC spectrally selective glazing, or reduce glazing-to-wall ratio.'
        );
        maintenanceAndDurabilityConcerns.push(
          'High solar heat transmission through unshaded primary glass envelope in hot climate.'
        );
      } else {
        heatStatus = 'conditionally-suitable';
        heatExplanation = `Solar-control glazing under ${formatTemperature(
          highTempC,
          climateContext.temperatureUnit
        )} requires verified low SHGC (<= 0.28) and external shading (${
          facade?.shadingStyle || 'required'
        }) on ${highSolarFacades.join(' & ') || 'sun-exposed'} orientations.`;
        heatConditions.push(
          'Coordinate window SHGC, thermally broken frames, and exterior shading overhang projection.'
        );
      }
    } else if (
      candidate.mappedFacadeMaterial === 'timber' &&
      highTempC >= 39 &&
      (diurnalSwingC ?? 0) >= 14
    ) {
      heatStatus = 'concern-identified';
      heatExplanation = `Under extreme summer heat (${formatTemperature(
        highTempC,
        climateContext.temperatureUnit
      )}) and large diurnal temperature swing (${diurnalSwingC} °C), exterior timber cladding experiences surface drying, checking, and dimensional movement.`;
      heatConditions.push(
        'Provide deep roof overhangs, ventilated cavity airflow, and closer board fixing centres to control thermal/moisture cupping.'
      );
      maintenanceAndDurabilityConcerns.push(
        'Accelerated surface checking and finish degradation on sun-baked timber elevations.'
      );
    } else if (lambdaVal > 1.2 && !isInteriorApp) {
      heatStatus = 'conditionally-suitable';
      heatExplanation = `Material has high thermal conductivity (λ = ${lambdaVal} W/(m·K)) under ${formatTemperature(
        highTempC,
        climateContext.temperatureUnit
      )} summer heat; suitability depends on pairing with continuous exterior thermal insulation and thermal breaks.`;
      heatConditions.push(
        'Must be combined with continuous thermal insulation and thermal-break fixings; material λ alone does not insulate the envelope.'
      );
      principalTradeOffs.push(
        `High thermal mass (${candidate.densityKgPerM3.value ?? 'N/A'} kg/m³) dampens diurnal swings, but high λ (${lambdaVal} W/(m·K)) requires separate thermal insulation.`
      );
    } else {
      heatStatus = 'suitable-for-screened-conditions';
      heatExplanation = `Screened thermal properties (λ = ${lambdaVal} W/(m·K)${
        solarRefl !== null ? `, solar reflectance = ${solarRefl}` : ''
      }) are compatible with ${formatTemperature(
        highTempC,
        climateContext.temperatureUnit
      )} design high temperature when detailed within a complete insulated assembly.`;
    }
  } else {
    heatStatus = 'suitable-for-screened-conditions';
    heatExplanation = `Summer design high temperature (${formatTemperature(
      highTempC,
      climateContext.temperatureUnit
    )}) does not exceed material thermal service limits (max service temp ${
      maxTemp ?? 'N/A'
    } °C).`;
  }

  domainEvaluations.push({
    domainId: 'heat-and-solar-radiation',
    domainTitle: 'A. Heat, Diurnal Swing & Solar Radiation Exposure',
    climateExposureObserved: climateContext.isConfigured
      ? `Summer High: ${formatTemperature(
          highTempC,
          climateContext.temperatureUnit
        )}, Diurnal Swing: ${
          diurnalSwingC !== null ? `${diurnalSwingC} °C` : 'Unspecified'
        }, High-Gain Facades: ${highSolarFacades.join(', ') || 'Moderate'}`
      : 'Unconfigured summer temperature and solar exposure',
    requiredProperties: [
      'Thermal conductivity λ (W/(m·K))',
      'Solar reflectance (for exterior surfaces)',
      'Max service temperature (°C)',
    ],
    knownPropertyValues: heatKnown,
    missingProperties: heatMissing,
    status: heatStatus,
    evaluationBasis: climateContext.isConfigured
      ? 'standards-or-handbook-rule'
      : 'unassessed',
    explanation: heatExplanation,
    conditionsOrDetailingRequired: heatConditions,
    sourceReferences: [
      candidate.thermalConductivityWPerMK.sourceCitation,
      'ASHRAE Handbook — Fundamentals Ch. 15 & Ch. 26',
    ],
  });

  // ============================================================================
  // DOMAIN B: Humidity, Wetting, Rainfall & Moisture Control
  // ============================================================================
  const rhPct = climateContext.meanRelativeHumidityPct;
  const precipMm = climateContext.annualPrecipitationMm;
  const rainSev = climateContext.windDrivenRainExposure;
  const wetRegime = climateContext.humidityWettingRegime;
  const waterAbs = candidate.waterAbsorptionPctByWeight.value;
  const muVal = candidate.vapourDiffusionResistanceFactorMu.value;
  const moistRating = candidate.moistureSensitivityRating.value;

  const moistKnown: string[] = [];
  const moistMissing: string[] = [];
  if (waterAbs !== null) {
    moistKnown.push(`Water absorption = ${waterAbs}% by weight`);
    supportingPropertiesSummary.push(`Water absorption = ${waterAbs}% by weight`);
  } else {
    moistMissing.push('Water absorption (% by weight)');
  }
  if (muVal !== null) {
    moistKnown.push(`Vapour diffusion resistance factor μ = ${muVal}`);
    supportingPropertiesSummary.push(`Vapour resistance factor μ = ${muVal}`);
  } else {
    moistMissing.push('Vapour diffusion resistance factor μ');
  }
  if (moistRating !== null) {
    moistKnown.push(`Moisture sensitivity = ${moistRating}`);
  } else {
    moistMissing.push('Moisture sensitivity rating');
  }

  let moistStatus: MaterialSuitabilityStatus = 'suitable-for-screened-conditions';
  let moistExplanation = '';
  const moistConditions: string[] = [];

  if (!climateContext.isConfigured || wetRegime === 'unknown' || rainSev === 'unknown') {
    moistStatus = 'insufficient-evidence';
    moistMissing.push('Humidity/wetting regime & wind-driven rain exposure');
    moistExplanation =
      'Cannot evaluate moisture and wetting durability because humidity regime and wind-driven rain exposure are not configured.';
  } else if (waterAbs === null || moistRating === null) {
    moistStatus = 'insufficient-evidence';
    moistExplanation =
      'Material water absorption or moisture sensitivity rating is missing; moisture durability cannot be verified.';
  } else if (isInteriorApp && wetRoomContext && !candidate.suitableForInteriorWetRooms) {
    moistStatus = 'not-recommended-for-screened-conditions';
    moistExplanation = `Target room "${
      targetRoom?.name || 'Wet Room'
    }" is a wet/high-humidity room, and "${
      candidate.displayName
    }" (water absorption ${waterAbs}%, moisture rating ${moistRating}) is susceptible to moisture swelling, warping, or mould growth in wet rooms.`;
    moistConditions.push(
      'Select a moisture-tolerant mineral finish (e.g., honed concrete/terrazzo or ceramic tile over a tested waterproofing membrane) for bathrooms and laundries.'
    );
    maintenanceAndDurabilityConcerns.push(
      `Moisture damage risk in wet room "${targetRoom?.name}".`
    );
  } else {
    const isHighWetting =
      rainSev === 'high' ||
      rainSev === 'severe' ||
      wetRegime === 'tropical-wet-or-monsoon' ||
      wetRegime === 'marine-persistent-damp' ||
      (precipMm !== null && precipMm >= 1100) ||
      (rhPct !== null && rhPct >= 75);

    if (isHighWetting) {
      if (isInteriorApp && moistRating === 'low-sensitive') {
        moistStatus = 'concern-identified';
        moistExplanation = `Under high ambient humidity (${
          rhPct ?? 'high'
        }% RH, ${wetRegime}), moisture-sensitive interior finish "${
          candidate.displayName
        }" requires active indoor dehumidification (35–55% RH) and subfloor/wall vapour control to prevent cupping or mould behind panelling.`;
        moistConditions.push(
          'Maintain conditioned indoor RH <= 55% and install a verified subfloor/wall vapour retarder.'
        );
        maintenanceAndDurabilityConcerns.push(
          'Dimensional movement and mould sensitivity if indoor HVAC dehumidification is interrupted.'
        );
      } else if (!isInteriorApp && moistRating === 'low-sensitive') {
        moistStatus = 'concern-identified';
        moistExplanation = `High capillary water absorption (${waterAbs}%) under ${rainSev} wind-driven rain (${
          precipMm ?? 'high'
        } mm/yr) creates prolonged wetting, biological algae staining, and moisture retention.`;
        moistConditions.push(
          'Requires ventilated drainage cavity, breathable hydrophobic silane/siloxane consolidation, and deep roof overhang protection.'
        );
        maintenanceAndDurabilityConcerns.push(
          'High moisture uptake and biological staining in wet climate.'
        );
      } else if (
        !isInteriorApp &&
        (candidate.requiresVentilatedRainscreenOrDrainageCavity ||
          candidate.requiresProtectiveSealerOrCoatingInWetClimate)
      ) {
        moistStatus = 'conditionally-suitable';
        moistExplanation = `Under ${rainSev} wind-driven rain and ${wetRegime} regime, "${candidate.displayName}" is conditionally suitable ONLY when installed with a drained/ventilated cavity and flashing system per US EPA Moisture Control Guidance.`;
        moistConditions.push(
          'Provide >= 19–25 mm ventilated drainage cavity, continuous water-resistive barrier (WRB), and sill/head drip flashings (water resistance does not equal waterproof assembly).'
        );
      } else {
        moistStatus = 'suitable-for-screened-conditions';
        moistExplanation = `Low water absorption (${waterAbs}%) and moisture rating (${moistRating}) are well-suited to ${wetRegime} moisture exposure when standard assembly flashing is provided.`;
      }
    } else {
      moistStatus =
        candidate.requiresVentilatedRainscreenOrDrainageCavity && !isInteriorApp
          ? 'conditionally-suitable'
          : 'suitable-for-screened-conditions';
      moistExplanation = `Under ${wetRegime} and ${rainSev} rain exposure, moisture risk is manageable (${waterAbs}% absorption, μ = ${muVal}).${
        candidate.requiresVentilatedRainscreenOrDrainageCavity && !isInteriorApp
          ? ' Standard drained rainscreen cavity detailing still applies.'
          : ''
      }`;
      if (candidate.requiresVentilatedRainscreenOrDrainageCavity && !isInteriorApp) {
        moistConditions.push('Include standard drained cavity / water-resistive barrier behind cladding.');
      }
    }
  }

  domainEvaluations.push({
    domainId: 'humidity-wetting-and-moisture',
    domainTitle: 'B. Humidity, Wind-Driven Rain & Moisture Control',
    climateExposureObserved: climateContext.isConfigured
      ? `Regime: ${wetRegime}, RH: ${rhPct !== null ? `${rhPct}%` : 'Unspecified'}, Precip: ${
          precipMm !== null ? `${precipMm} mm/yr` : 'Unspecified'
        }, Wind-Driven Rain: ${rainSev}${wetRoomContext ? ` [Wet Room: ${targetRoom?.name}]` : ''}`
      : 'Unconfigured humidity and rainfall exposure',
    requiredProperties: [
      'Water absorption (% by weight)',
      'Vapour diffusion resistance factor μ',
      'Moisture sensitivity rating',
    ],
    knownPropertyValues: moistKnown,
    missingProperties: moistMissing,
    status: moistStatus,
    evaluationBasis: climateContext.isConfigured
      ? 'standards-or-handbook-rule'
      : 'unassessed',
    explanation: moistExplanation,
    conditionsOrDetailingRequired: moistConditions,
    sourceReferences: [
      candidate.moistureSensitivityRating.sourceCitation,
      'US EPA Guidance for Moisture Control for Buildings (EPA 402-F-13053)',
    ],
  });

  // ============================================================================
  // DOMAIN C: Freeze–Thaw Cycling & Cold Exposure
  // ============================================================================
  const ftExposure = climateContext.freezeThawExposure;
  const winterLowC = climateContext.winterDesignLowTempC;
  const ftRating = candidate.freezeThawResistance.value;

  const ftKnown: string[] = [];
  const ftMissing: string[] = [];
  if (ftRating !== null) {
    ftKnown.push(`Freeze–thaw resistance = ${ftRating}`);
    supportingPropertiesSummary.push(`Freeze–thaw resistance = ${ftRating}`);
  } else {
    ftMissing.push('Freeze–thaw resistance rating / EN 12371 / ASTM C666 test data');
  }

  let ftStatus: MaterialSuitabilityStatus = 'suitable-for-screened-conditions';
  let ftExplanation = '';
  const ftConditions: string[] = [];

  if (isInteriorApp) {
    ftStatus = 'suitable-for-screened-conditions';
    ftExplanation =
      'Interior conditioned space application is sheltered from exterior freeze–thaw cycling (verify under-slab/wall insulation in cold climates).';
  } else if (!climateContext.isConfigured || ftExposure === 'unknown') {
    ftStatus = 'insufficient-evidence';
    ftMissing.push('Climate freeze–thaw exposure level');
    ftExplanation =
      'Cannot evaluate freeze–thaw durability because project freeze–thaw exposure is not configured.';
  } else if (ftExposure === 'none-frost-free') {
    ftStatus = 'suitable-for-screened-conditions';
    ftExplanation = `Climate profile has frost-free winter exposure (${formatTemperature(
      winterLowC,
      climateContext.temperatureUnit
    )}); freeze–thaw spalling is not an active degradation mechanism.`;
  } else if (ftRating === null || candidate.freezeThawResistance.evidenceStatus === 'unavailable') {
    // CRITICAL P35 RULE: Never assume freeze-thaw suitability when freeze-thaw evidence is missing!
    ftStatus = 'insufficient-evidence';
    missingEvidenceItems.push(
      `Freeze–thaw resistance test data (EN 12371 / ASTM C666 / ASTM C216) is unavailable for "${candidate.displayName}" under ${ftExposure} exposure.`
    );
    ftExplanation = `Climate includes ${ftExposure} (winter low ${formatTemperature(
      winterLowC,
      climateContext.temperatureUnit
    )}), but freeze–thaw resistance data for "${
      candidate.displayName
    }" is unavailable (water absorption = ${
      waterAbs ?? 'unknown'
    }%). Suitability cannot be assumed from material name alone.`;
    ftConditions.push(
      'Obtain laboratory freeze–thaw test certification (e.g., EN 12371 or ASTM C666) for the exact quarry/product batch before specifying in freezing climates.'
    );
  } else if (
    ftExposure === 'severe-frequent-freeze-thaw-wet' ||
    ftExposure === 'moderate-freeze-thaw-with-rain'
  ) {
    if (ftRating === 'low-sensitive') {
      ftStatus = 'not-recommended-for-screened-conditions';
      ftExplanation = `"${candidate.displayName}" has low freeze–thaw resistance (${ftRating}, water absorption ${waterAbs}%) and is prone to frost spalling and delamination under ${ftExposure}.`;
      ftConditions.push('Substitute a frost-rated low-absorption material (e.g., Grade SW brick or dense granite).');
      maintenanceAndDurabilityConcerns.push('High risk of freeze–thaw face spalling and cracking.');
    } else if (ftRating === 'moderate-conditional') {
      ftStatus = 'conditionally-suitable';
      ftExplanation = `Under ${ftExposure} (winter low ${formatTemperature(
        winterLowC,
        climateContext.temperatureUnit
      )}), "${
        candidate.displayName
      }" is conditionally suitable ONLY when specified with frost-rated mix/grade and positive drainage away from copings and sills.`;
      ftConditions.push(
        candidate.freezeThawResistance.applicableConditions ||
          'Specify frost-resistant grade (e.g., 5–7% air-entrained concrete XF4 or ASTM C1167 Grade 1 tile) and capillary break.'
      );
    } else {
      ftStatus = 'suitable-for-screened-conditions';
      ftExplanation = `High freeze–thaw resistance (${ftRating}) and low capillary saturation support durability under ${ftExposure}.`;
    }
  } else {
    ftStatus = 'suitable-for-screened-conditions';
    ftExplanation = `Occasional dry-winter freeze exposure is compatible with "${candidate.displayName}" (${ftRating}).`;
  }

  domainEvaluations.push({
    domainId: 'freeze-thaw-and-cold',
    domainTitle: 'C. Freeze–Thaw Cycling & Winter Cold Exposure',
    climateExposureObserved: climateContext.isConfigured
      ? `Freeze–Thaw: ${ftExposure}, Winter Low: ${formatTemperature(
          winterLowC,
          climateContext.temperatureUnit
        )}`
      : 'Unconfigured freeze–thaw and winter low temperature',
    requiredProperties: ['Freeze–thaw resistance rating', 'Water absorption (% by weight)'],
    knownPropertyValues: ftKnown,
    missingProperties: ftMissing,
    status: ftStatus,
    evaluationBasis: climateContext.isConfigured
      ? 'standards-or-handbook-rule'
      : 'unassessed',
    explanation: ftExplanation,
    conditionsOrDetailingRequired: ftConditions,
    sourceReferences: [
      candidate.freezeThawResistance.sourceCitation,
      'European Commission Climate-Resilient Buildings Guidance (2023/C 275/01)',
    ],
  });

  // ============================================================================
  // DOMAIN D: Coastal Salt & Corrosive Exposure
  // ============================================================================
  const saltExp = climateContext.coastalSaltExposure;
  const saltRating = candidate.coastalSaltCorrosionResistance.value;

  const saltKnown: string[] = [];
  const saltMissing: string[] = [];
  if (saltRating !== null) {
    saltKnown.push(`Coastal salt / corrosion resistance = ${saltRating}`);
    supportingPropertiesSummary.push(`Coastal salt resistance = ${saltRating}`);
  } else {
    saltMissing.push('Coastal salt / corrosion resistance rating');
  }

  let saltStatus: MaterialSuitabilityStatus = 'suitable-for-screened-conditions';
  let saltExplanation = '';
  const saltConditions: string[] = [];

  if (!climateContext.isConfigured || saltExp === 'unknown') {
    saltStatus = 'insufficient-evidence';
    saltMissing.push('Coastal salt / chloride exposure level');
    saltExplanation =
      'Cannot evaluate salt crystallization and marine corrosion resistance because coastal salt exposure is not configured.';
  } else if (saltExp === 'inland-none') {
    saltStatus = 'suitable-for-screened-conditions';
    saltExplanation = 'Inland site with no coastal marine salt spray or de-icing salt exposure.';
  } else if (saltRating === null) {
    saltStatus = 'insufficient-evidence';
    missingEvidenceItems.push(
      `Coastal salt / chloride resistance data is unavailable for "${candidate.displayName}" under ${saltExp}.`
    );
    saltExplanation = `Site has ${saltExp}, but salt corrosion/crystallization resistance data is unavailable for "${candidate.displayName}".`;
  } else if (
    saltExp === 'severe-marine-surf-under-300m' ||
    saltExp === 'coastal-nearshore-300m-to-1km' ||
    saltExp === 'deicing-salt-runoff'
  ) {
    if (saltRating === 'low-sensitive' && !isInteriorApp) {
      saltStatus = 'not-recommended-for-screened-conditions';
      saltExplanation = `"${candidate.displayName}" has low salt resistance (${saltRating}) and is vulnerable to sub-florescence salt crystallization spalling under ${saltExp}.`;
      saltConditions.push(
        'Avoid high-porosity sedimentary stone or unverified masonry in nearshore coastal salt spray or de-icing splash zones.'
      );
      maintenanceAndDurabilityConcerns.push(
        'Severe salt crystallization spalling risk in coastal/salt environment.'
      );
    } else if (
      saltRating === 'moderate-conditional' ||
      candidate.requiresMarineGradeFixingsNearCoast
    ) {
      saltStatus = 'conditionally-suitable';
      saltExplanation = `Under ${saltExp}, "${candidate.displayName}" requires marine-grade corrosion protection (${candidate.coastalSaltCorrosionResistance.applicableConditions}).`;
      saltConditions.push(
        'Specify 316 austenitic stainless steel fasteners/ties/anchors and marine-grade protective coatings (e.g., AAMA 2605 PVDF or EN 206 XS marine concrete cover).'
      );
    } else {
      saltStatus = 'suitable-for-screened-conditions';
      saltExplanation = `Material resists salt degradation under ${saltExp}.`;
    }
  } else {
    // coastal-region-1km-to-10km
    saltStatus = candidate.requiresMarineGradeFixingsNearCoast
      ? 'conditionally-suitable'
      : 'suitable-for-screened-conditions';
    saltExplanation = `Moderate coastal region exposure (${saltExp}); specify corrosion-resistant 316 stainless steel exterior fixings.`;
    if (candidate.requiresMarineGradeFixingsNearCoast) {
      saltConditions.push('Use 304/316 stainless steel or hot-dip galvanized Class C4 fixings.');
    }
  }

  domainEvaluations.push({
    domainId: 'coastal-salt-and-corrosion',
    domainTitle: 'D. Coastal Salt, Chloride & Corrosive Exposure',
    climateExposureObserved: climateContext.isConfigured
      ? `Salt Exposure: ${saltExp}`
      : 'Unconfigured coastal salt exposure',
    requiredProperties: ['Coastal salt / chloride corrosion resistance rating'],
    knownPropertyValues: saltKnown,
    missingProperties: saltMissing,
    status: saltStatus,
    evaluationBasis: climateContext.isConfigured
      ? 'standards-or-handbook-rule'
      : 'unassessed',
    explanation: saltExplanation,
    conditionsOrDetailingRequired: saltConditions,
    sourceReferences: [
      candidate.coastalSaltCorrosionResistance.sourceCitation,
      'ISO 9223 Corrosion of Metals and Alloys',
    ],
  });

  // ============================================================================
  // DOMAIN E: Solar Radiation, UV & Weathering
  // ============================================================================
  const uvExp = climateContext.solarUvExposure;
  const uvRating = candidate.uvWeatheringResistance.value;

  const uvKnown: string[] = [];
  const uvMissing: string[] = [];
  if (uvRating !== null) {
    uvKnown.push(`UV weathering resistance = ${uvRating}`);
  } else {
    uvMissing.push('UV weathering resistance rating');
  }

  let uvStatus: MaterialSuitabilityStatus = 'suitable-for-screened-conditions';
  let uvExplanation = '';
  const uvConditions: string[] = [];

  if (!climateContext.isConfigured || uvExp === 'unknown') {
    uvStatus = 'insufficient-evidence';
    uvMissing.push('Solar UV exposure level');
    uvExplanation = 'Cannot evaluate UV weathering because solar UV exposure is not configured.';
  } else if (uvRating === null) {
    uvStatus = 'insufficient-evidence';
    uvExplanation = `UV weathering resistance is unavailable for "${candidate.displayName}".`;
  } else if ((uvExp === 'high' || uvExp === 'severe') && uvRating === 'low-sensitive') {
    uvStatus = 'concern-identified';
    uvExplanation = `Under ${uvExp} UV irradiance, "${candidate.displayName}" undergoes surface lignin photodegradation, silvering/fade, and micro-checking unless UV-pigmented finishes are recoated every ${
      candidate.maintenanceIntervalYears.value ?? 3
    } years.`;
    uvConditions.push(
      'Specify UV-stabilized pigmented finish and protective overhang shading, or explicitly accept natural silver-grey weathering patina.'
    );
    maintenanceAndDurabilityConcerns.push(
      `Frequent UV finish maintenance (every ${
        candidate.maintenanceIntervalYears.value ?? 3
      } yrs) required under ${uvExp} solar UV exposure.`
    );
  } else if ((uvExp === 'high' || uvExp === 'severe') && uvRating === 'moderate-conditional') {
    uvStatus = 'conditionally-suitable';
    uvExplanation = `Under ${uvExp} solar UV exposure, specify UV-resistant silicone sealants / Low-E UV glazing filtration (${candidate.uvWeatheringResistance.applicableConditions}).`;
    uvConditions.push(candidate.uvWeatheringResistance.applicableConditions);
  } else {
    uvStatus = 'suitable-for-screened-conditions';
    uvExplanation = `Material UV resistance (${uvRating}) is well-matched to ${uvExp} solar UV exposure.`;
  }

  domainEvaluations.push({
    domainId: 'uv-and-weathering',
    domainTitle: 'E. Solar Radiation, UV & Surface Weathering',
    climateExposureObserved: climateContext.isConfigured
      ? `Solar UV Exposure: ${uvExp}`
      : 'Unconfigured solar UV exposure',
    requiredProperties: ['UV weathering resistance rating'],
    knownPropertyValues: uvKnown,
    missingProperties: uvMissing,
    status: uvStatus,
    evaluationBasis: climateContext.isConfigured
      ? 'standards-or-handbook-rule'
      : 'unassessed',
    explanation: uvExplanation,
    conditionsOrDetailingRequired: uvConditions,
    sourceReferences: [candidate.uvWeatheringResistance.sourceCitation],
  });

  // ============================================================================
  // DOMAIN F: Wildfire / Ember Exposure (Specialized Screening)
  // ============================================================================
  const wfExp = climateContext.wildfireEmberExposure;
  const combNote = candidate.combustibilityOrWildfireNote.value;

  let wfStatus: MaterialSuitabilityStatus = 'not-assessed';
  let wfExplanation = '';
  const wfConditions: string[] = [];

  if (!climateContext.isConfigured || wfExp === 'unknown') {
    wfStatus = 'not-assessed';
    wfExplanation = 'Wildfire/ember exposure is not configured for this project.';
  } else if (wfExp === 'none-or-negligible' || wfExp === 'low') {
    wfStatus = 'suitable-for-screened-conditions';
    wfExplanation = `Wildfire ember exposure is ${wfExp}; specialized WUI ember screening is not a governing constraint (statutory building fire codes still apply).`;
  } else if (!combNote) {
    wfStatus = 'insufficient-evidence';
    wfExplanation = `Site has ${wfExp} wildfire ember exposure, but combustibility/ignition data is unavailable for "${candidate.displayName}".`;
  } else if (combNote.toLowerCase().includes('combustible organic')) {
    wfStatus = 'concern-identified';
    wfExplanation = `Site has ${wfExp} wildfire ember exposure, and "${candidate.displayName}" is a combustible organic material (${combNote}). P35 does NOT certify fire ratings; a licensed fire/building code review is mandatory.`;
    wfConditions.push(
      'Consult local WUI fire code (e.g. non-combustible Euroclass A1/A2 cladding or tested ignition-resistant assembly with ember-screened vents).'
    );
    maintenanceAndDurabilityConcerns.push(
      `Combustible material under ${wfExp} wildfire ember exposure; requires statutory WUI code verification.`
    );
    conditionsAndProfessionalChecksRequired.push(
      'Wildfire / WUI statutory fire-resistance and flame-spread verification by a qualified professional.'
    );
  } else {
    wfStatus = 'conditionally-suitable';
    wfExplanation = `Under ${wfExp} wildfire ember exposure, "${candidate.displayName}" provides a non-combustible mineral/metal base (${combNote}), subject to full assembly and ember-vent detailing verification.`;
    wfConditions.push(
      'Ensure cavity vents, eaves, and glazing are detailed for WUI ember and radiant heat resistance; P35 does not certify statutory fire compliance.'
    );
  }

  domainEvaluations.push({
    domainId: 'wildfire-and-specialized',
    domainTitle: 'F. Wildfire Ember & Specialized Hazard Screening',
    climateExposureObserved: climateContext.isConfigured
      ? `Wildfire Ember Exposure: ${wfExp}`
      : 'Unconfigured wildfire exposure',
    requiredProperties: ['Combustibility / WUI screening note'],
    knownPropertyValues: combNote ? [combNote] : [],
    missingProperties: combNote ? [] : ['Combustibility / WUI screening data'],
    status: wfStatus,
    evaluationBasis:
      climateContext.isConfigured && wfExp !== 'unknown'
        ? 'general-screening-advice'
        : 'unassessed',
    explanation: wfExplanation,
    conditionsOrDetailingRequired: wfConditions,
    sourceReferences: [candidate.combustibilityOrWildfireNote.sourceCitation],
  });

  // ============================================================================
  // DOMAIN G: General Durability, Maintenance & Service Life
  // ============================================================================
  const maintYrs = candidate.maintenanceIntervalYears.value;
  const serviceLife = candidate.expectedServiceLifeYearsRange.value;

  const durKnown: string[] = [];
  const durMissing: string[] = [];
  if (maintYrs !== null) {
    durKnown.push(`Maintenance interval = every ${maintYrs} years`);
    supportingPropertiesSummary.push(`Maintenance interval ≈ ${maintYrs} years`);
  } else {
    durMissing.push('Maintenance interval (years)');
  }
  if (serviceLife !== null) {
    durKnown.push(
      `Expected service life range = ${serviceLife.minYears}–${serviceLife.maxYears} years (reference estimate, not a warranty)`
    );
    supportingPropertiesSummary.push(
      `Reference service life = ${serviceLife.minYears}–${serviceLife.maxYears} yrs`
    );
  } else {
    durMissing.push('Expected service life range (years)');
  }

  let durStatus: MaterialSuitabilityStatus = 'suitable-for-screened-conditions';
  let durExplanation = '';
  if (maintYrs === null || serviceLife === null) {
    durStatus = 'insufficient-evidence';
    durExplanation =
      'Maintenance interval or reference service life range is missing; lifecycle durability cannot be fully compared.';
  } else if (maintYrs <= 4) {
    durStatus = 'conditionally-suitable';
    durExplanation = `"${candidate.displayName}" has a short maintenance cycle (every ${maintYrs} years: ${candidate.maintenanceRequirementsSummary}) to achieve its ${serviceLife.minYears}–${serviceLife.maxYears} year reference service life.`;
    principalTradeOffs.push(
      `Higher recurring maintenance commitment (every ${maintYrs} years) compared to masonry or stone.`
    );
  } else {
    durStatus = 'suitable-for-screened-conditions';
    durExplanation = `Routine maintenance interval of ~${maintYrs} years (${candidate.maintenanceRequirementsSummary}) with a ${serviceLife.minYears}–${serviceLife.maxYears} year reference service life range.`;
  }

  domainEvaluations.push({
    domainId: 'durability-and-maintenance',
    domainTitle: 'G. Durability, Maintenance Frequency & Service Life',
    climateExposureObserved: 'Lifecycle maintenance and replacement horizon',
    requiredProperties: ['Maintenance interval (years)', 'Reference service life range (years)'],
    knownPropertyValues: durKnown,
    missingProperties: durMissing,
    status: durStatus,
    evaluationBasis: 'standards-or-handbook-rule',
    explanation: durExplanation,
    conditionsOrDetailingRequired: [candidate.maintenanceRequirementsSummary],
    sourceReferences: [candidate.expectedServiceLifeYearsRange.sourceCitation],
  });

  // ============================================================================
  // SECTION 8: Assembly & Substrate Compatibility Check
  // ============================================================================
  const compatibilityFindings: string[] = [];
  const missingAssemblyInputs: string[] = [];
  const requiredDetailingRecommendations: string[] = [
    candidate.compatibleSubstratesAndFixingsNote,
  ];

  // Plotify models 2D room geometry and high-level FacadeConcept/InteriorRoomConcept,
  // NOT full multi-layer wall buildup sections (cavity depth mm, vapour control layer Sd value, flashing details).
  missingAssemblyInputs.push(
    'Detailed wall/roof multi-layer section (exact air cavity depth, water-resistive barrier perm rating, and flashing geometry) is not modeled in Plotify 2D/3D schematic state.'
  );

  let assemblyStatus: MaterialSuitabilityStatus = 'conditionally-suitable';
  if (isInteriorApp && wetRoomContext && !candidate.suitableForInteriorWetRooms) {
    assemblyStatus = 'not-recommended-for-screened-conditions';
    compatibilityFindings.push(
      `Incompatible with wet-room assembly in "${targetRoom?.name}": material absorbs moisture or traps condensation without a wet-area rated substrate.`
    );
  } else if (
    !isInteriorApp &&
    candidate.mappedFacadeMaterial === 'glass' &&
    facade?.shadingStyle === 'none' &&
    (climateContext.summerDesignHighTempC ?? 0) >= 32
  ) {
    assemblyStatus = 'concern-identified';
    compatibilityFindings.push(
      'Facade assembly currently has shadingStyle = "none" paired with high-glazing envelope in a warm climate.'
    );
    requiredDetailingRecommendations.push(
      'Update FacadeConcept.shadingStyle to "deep-overhangs", "brise-soleil", or "motorized-louvers".'
    );
  } else {
    assemblyStatus = 'conditionally-suitable';
    compatibilityFindings.push(
      `Compatible at schematic specification level, conditional on field detailing of: ${candidate.compatibleSubstratesAndFixingsNote}`
    );
    if (candidate.requiresVentilatedRainscreenOrDrainageCavity) {
      requiredDetailingRecommendations.push(
        'Provide a continuous ventilated drainage cavity and water-resistive barrier behind exterior cladding.'
      );
    }
    if (
      candidate.requiresMarineGradeFixingsNearCoast &&
      climateContext.coastalSaltExposure !== 'inland-none'
    ) {
      requiredDetailingRecommendations.push(
        'Specify 316 marine-grade stainless steel fasteners and ties to prevent galvanic/chloride corrosion.'
      );
    }
  }

  const assemblyCheck: AssemblyCompatibilityCheck = {
    application,
    targetRoomName: targetRoom?.name,
    isWetRoomContext: wetRoomContext,
    facadeShadingStyle: facade?.shadingStyle,
    facadeOrientationExposure: `Road facing ${project.roadFacing}; high solar gain on ${
      highSolarFacades.join(', ') || 'none'
    }`,
    assemblyDetailsCompleteInModel: false,
    status: assemblyStatus,
    compatibilityFindings,
    missingAssemblyInputs,
    requiredDetailingRecommendations,
  };

  domainEvaluations.push({
    domainId: 'assembly-and-substrate-compatibility',
    domainTitle: 'H. Envelope Assembly & Substrate Compatibility (Section 8)',
    climateExposureObserved: assemblyCheck.facadeOrientationExposure || 'Schematic assembly context',
    requiredProperties: [
      'Substrate & fixing compatibility',
      'Drainage cavity / vapour control coordination',
    ],
    knownPropertyValues: [candidate.compatibleSubstratesAndFixingsNote],
    missingProperties: missingAssemblyInputs,
    status: assemblyStatus,
    evaluationBasis: 'standards-or-handbook-rule',
    explanation: compatibilityFindings.join(' '),
    conditionsOrDetailingRequired: requiredDetailingRecommendations,
    sourceReferences: ['US EPA Moisture Control Guidance (EPA 402-F-13053)', 'ISO 13788'],
  });

  // ============================================================================
  // P30 Brief & P32 Personalization Alignment
  // ============================================================================
  const p30 = extractP30MaterialRequirements(project);
  const p32 = extractP32MaterialPreferences(project);

  const conflictsWithConfirmedRequirements: string[] = [];
  let matchesConfirmedRequirements = true;

  if (
    (application === 'exterior-primary-facade' || application === 'exterior-accent-cladding') &&
    p30.confirmedMandatoryMaterialKeywords.length > 0 &&
    candidate.mappedFacadeMaterial
  ) {
    if (!p30.confirmedMandatoryMaterialKeywords.includes(candidate.mappedFacadeMaterial)) {
      matchesConfirmedRequirements = false;
      conflictsWithConfirmedRequirements.push(
        `Confirmed P30 mandatory material requirement specifies [${p30.confirmedMandatoryMaterialKeywords.join(
          ', '
        )}], whereas this candidate maps to "${candidate.mappedFacadeMaterial}".`
      );
    }
  }

  const matchesExplicitUserPreference = Boolean(
    candidate.mappedFacadeMaterial &&
      p32.explicitPreferredMaterials.includes(candidate.mappedFacadeMaterial)
  );
  const matchesUnconfirmedSuggestion = Boolean(
    candidate.mappedFacadeMaterial &&
      p32.inferredUnconfirmedMaterials.includes(candidate.mappedFacadeMaterial)
  );

  let preferenceExplanation = 'No explicit P32 primary material preference configured.';
  if (matchesExplicitUserPreference) {
    preferenceExplanation = `Matches explicit confirmed user preference in P32 for "${candidate.mappedFacadeMaterial}".`;
  } else if (matchesUnconfirmedSuggestion) {
    preferenceExplanation = `Matches an unconfirmed P32 inferred suggestion for "${candidate.mappedFacadeMaterial}" (held for user review; not treated as confirmed preference).`;
  } else if (p32.explicitPreferredMaterials.length > 0) {
    preferenceExplanation = `Does not match explicit P32 preferred materials (${p32.explicitPreferredMaterials.join(
      ', '
    )}).`;
  }

  // Cost & Carbon Trade-off notes
  if (candidate.relativeCostIndexPerM2Usd.value !== null) {
    supportingPropertiesSummary.push(
      `Indicative cost index = $${candidate.relativeCostIndexPerM2Usd.value}/m² (${candidate.mappedCostTier})`
    );
    if (candidate.relativeCostIndexPerM2Usd.value >= 220) {
      principalTradeOffs.push(
        `Higher capital cost tier (${candidate.mappedCostTier}, ~$${candidate.relativeCostIndexPerM2Usd.value}/m²).`
      );
    }
  }
  if (candidate.embodiedCarbonKgCo2ePerM2GfaRef.value !== null) {
    supportingPropertiesSummary.push(
      `Upfront embodied carbon reference = ${candidate.embodiedCarbonKgCo2ePerM2GfaRef.value} kg CO₂e/m² GFA`
    );
    if (candidate.embodiedCarbonKgCo2ePerM2GfaRef.value >= 450) {
      principalTradeOffs.push(
        `Higher upfront embodied carbon intensity (${candidate.embodiedCarbonKgCo2ePerM2GfaRef.value} kg CO₂e/m² GFA in Plotify scenarioCalculator).`
      );
    }
  }

  // Collect all missing properties across domains
  for (const d of domainEvaluations) {
    if (d.domainId === 'assembly-and-substrate-compatibility') continue;
    for (const m of d.missingProperties) {
      if (!missingEvidenceItems.includes(m)) {
        missingEvidenceItems.push(m);
      }
    }
    for (const cond of d.conditionsOrDetailingRequired) {
      if (cond && !conditionsAndProfessionalChecksRequired.includes(cond)) {
        conditionsAndProfessionalChecksRequired.push(cond);
      }
    }
  }

  // Aggregate Overall Status deterministically
  // Order of precedence:
  // 1. If climate is unconfigured -> 'insufficient-evidence'
  // 2. If any domain is 'not-recommended-for-screened-conditions' -> 'not-recommended-for-screened-conditions'
  // 3. If any active climate domain has 'insufficient-evidence' -> 'insufficient-evidence'
  // 4. If any domain has 'concern-identified' -> 'concern-identified'
  // 5. If user-custom-material -> at best 'requires-professional-review' or 'conditionally-suitable'
  // 6. If any domain is 'conditionally-suitable' -> 'conditionally-suitable'
  // 7. Otherwise -> 'suitable-for-screened-conditions'
  const coreDomains = domainEvaluations.filter(
    (d) => d.domainId !== 'assembly-and-substrate-compatibility' && d.status !== 'not-assessed'
  );

  let overallStatus: MaterialSuitabilityStatus;
  if (!climateContext.isConfigured || climateContext.sourceTier === 'unconfigured') {
    overallStatus = 'insufficient-evidence';
  } else if (
    domainEvaluations.some((d) => d.status === 'not-recommended-for-screened-conditions')
  ) {
    overallStatus = 'not-recommended-for-screened-conditions';
  } else if (coreDomains.some((d) => d.status === 'insufficient-evidence')) {
    overallStatus = 'insufficient-evidence';
  } else if (domainEvaluations.some((d) => d.status === 'concern-identified')) {
    overallStatus = 'concern-identified';
  } else if (candidate.recordKind === 'user-custom-material') {
    overallStatus = 'requires-professional-review';
    conditionsAndProfessionalChecksRequired.push(
      'Custom user-entered material properties must be verified against official manufacturer technical data sheets.'
    );
  } else if (coreDomains.some((d) => d.status === 'conditionally-suitable')) {
    overallStatus = 'conditionally-suitable';
  } else {
    overallStatus = 'suitable-for-screened-conditions';
  }

  let whySuitableOrUnsuitableSummary = '';
  if (overallStatus === 'insufficient-evidence') {
    whySuitableOrUnsuitableSummary = `Insufficient evidence to confirm suitability of "${
      candidate.displayName
    }": ${missingEvidenceItems.slice(0, 2).join('; ')}.`;
  } else if (overallStatus === 'not-recommended-for-screened-conditions') {
    const failing = domainEvaluations.filter(
      (d) => d.status === 'not-recommended-for-screened-conditions'
    );
    whySuitableOrUnsuitableSummary = `Not recommended for screened conditions due to ${failing
      .map((f) => f.domainTitle)
      .join(', ')}: ${failing[0]?.explanation || ''}`;
  } else if (overallStatus === 'concern-identified') {
    const concerns = domainEvaluations.filter((d) => d.status === 'concern-identified');
    whySuitableOrUnsuitableSummary = `Climate/durability concern identified in ${concerns
      .map((c) => c.domainTitle)
      .join(', ')}: ${concerns[0]?.explanation || ''}`;
  } else if (overallStatus === 'conditionally-suitable') {
    whySuitableOrUnsuitableSummary = `Conditionally suitable under "${
      climateContext.profileName
    }" provided assembly detailing conditions are met (${conditionsAndProfessionalChecksRequired
      .slice(0, 2)
      .join(' ')}).`;
  } else if (overallStatus === 'requires-professional-review') {
    whySuitableOrUnsuitableSummary = `Requires professional verification of user-entered custom material properties and assembly detailing under "${climateContext.profileName}".`;
  } else {
    whySuitableOrUnsuitableSummary = `Suitable for screened climate conditions under "${climateContext.profileName}" when detailed within a complete building assembly.`;
  }

  return {
    materialId: candidate.materialId,
    displayName: candidate.displayName,
    recordKind: candidate.recordKind,
    application,
    targetRoomId: targetRoom?.id,
    targetRoomName: targetRoom?.name,
    overallStatus,
    evaluationBasis: !climateContext.isConfigured
      ? 'unassessed'
      : candidate.recordKind === 'user-custom-material'
      ? 'general-screening-advice'
      : 'standards-or-handbook-rule',
    domainEvaluations,
    assemblyCheck,
    supportingPropertiesSummary,
    missingEvidenceItems,
    maintenanceAndDurabilityConcerns,
    principalTradeOffs,
    conditionsAndProfessionalChecksRequired,
    p30BriefAlignment: {
      matchesConfirmedRequirements,
      conflictsWithConfirmedRequirements,
      unconfirmedBriefInferencesNoted: p30.unconfirmedMaterialAssumptions,
    },
    p32PreferenceAlignment: {
      matchesExplicitUserPreference,
      preferenceExplanation,
    },
    whySuitableOrUnsuitableSummary,
  };
}

/**
 * Compares 2+ material candidates side-by-side for a selected application and computes
 * explainable, weight-sensitive decision-support scores while keeping mandatory/climate blocks strictly separate.
 */
export function compareMaterialCandidatesForApplication(
  project: Project,
  application: MaterialApplicationCategory,
  climateContext: ProjectClimateContext,
  options?: {
    candidateIds?: string[];
    targetRoomId?: string;
    scoringEnabled?: boolean;
    weights?: MaterialRankingWeights;
  }
): MaterialSideBySideComparisonResult {
  const catalogue = getAvailableMaterialCatalogue(project);
  const advisor = initializeProjectMaterialAdvisorData(project);
  const requestedIds =
    options?.candidateIds ||
    advisor.comparedMaterialIdsByApplication[application] ||
    catalogue
      .filter((c) => c.supportedApplications.includes(application))
      .map((c) => c.materialId);

  const candidates = requestedIds
    .map((id) => catalogue.find((c) => c.materialId === id))
    .filter((c): c is ClimateMaterialCandidate => Boolean(c));

  // Fallback if fewer than 2 matched
  if (candidates.length === 0) {
    for (const c of catalogue) {
      if (c.supportedApplications.includes(application)) {
        candidates.push(c);
      }
    }
  }

  const scoringEnabled = options?.scoringEnabled ?? advisor.scoringEnabled ?? true;
  const weights: MaterialRankingWeights = {
    ...DEFAULT_MATERIAL_RANKING_WEIGHTS,
    ...(options?.weights || advisor.rankingWeights || {}),
  };

  const totalWeight =
    Math.max(0, weights.climateSuitability) +
    Math.max(0, weights.durabilityAndWeathering) +
    Math.max(0, weights.lowMaintenance) +
    Math.max(0, weights.thermalAndMoistureFit) +
    Math.max(0, weights.costPredictability) +
    Math.max(0, weights.userPreferenceMatch) +
    Math.max(0, weights.embodiedCarbonReference);

  const missingDataDisclosure: string[] = [];
  if (!climateContext.isConfigured) {
    missingDataDisclosure.push(
      'Climate context is unconfigured: climate suitability scores are withheld until climate exposure parameters are specified.'
    );
  }

  const entries: ComparedMaterialCandidateEntry[] = candidates.map((candidate) => {
    const suitability = evaluateMaterialCandidateForClimate(
      project,
      candidate,
      application,
      climateContext,
      { targetRoomId: options?.targetRoomId }
    );

    const mandatoryOrClimateBlockReasons: string[] = [];
    if (!suitability.p30BriefAlignment.matchesConfirmedRequirements) {
      mandatoryOrClimateBlockReasons.push(
        ...suitability.p30BriefAlignment.conflictsWithConfirmedRequirements
      );
    }
    if (suitability.overallStatus === 'not-recommended-for-screened-conditions') {
      mandatoryOrClimateBlockReasons.push(suitability.whySuitableOrUnsuitableSummary);
    }

    const meetsMandatoryAndClimateScreen =
      mandatoryOrClimateBlockReasons.length === 0 &&
      suitability.overallStatus !== 'insufficient-evidence';

    // Compute 7 explainable criterion scores
    // CRITICAL RULE: Missing data for an active criterion contributes 0 points while keeping its full weight in denominator.
    const criterionScores: MaterialComparisonCriterionScore[] = [];

    // 1. Climate Suitability Score
    let climateNorm: number | null = null;
    if (climateContext.isConfigured) {
      switch (suitability.overallStatus) {
        case 'suitable-for-screened-conditions':
          climateNorm = 95;
          break;
        case 'conditionally-suitable':
          climateNorm = 78;
          break;
        case 'requires-professional-review':
          climateNorm = 65;
          break;
        case 'concern-identified':
          climateNorm = 42;
          break;
        case 'not-recommended-for-screened-conditions':
          climateNorm = 10;
          break;
        default:
          climateNorm = null;
      }
    }
    criterionScores.push({
      criterionId: 'climateSuitability',
      label: 'Climate Exposure Suitability',
      rawValueDisplay: suitability.overallStatus.replace(/-/g, ' '),
      unit: 'status',
      evidenceStatus: candidate.overallEvidenceStatus,
      normalizedScore: climateNorm,
      weight: weights.climateSuitability,
      weightedPoints:
        climateNorm !== null && totalWeight > 0
          ? ((climateNorm * weights.climateSuitability) / totalWeight)
          : 0,
      isMissingData: climateNorm === null,
      explanation: suitability.whySuitableOrUnsuitableSummary,
    });

    // 2. Durability & Freeze-Thaw / Salt Weathering
    const ftVal = candidate.freezeThawResistance.value;
    const saltVal = candidate.coastalSaltCorrosionResistance.value;
    const uvVal = candidate.uvWeatheringResistance.value;
    let durNorm: number | null = null;
    const needsFt =
      !['interior-wall-finish', 'interior-floor-finish'].includes(application) &&
      climateContext.freezeThawExposure !== 'none-frost-free';

    if ((needsFt && ftVal === null) || saltVal === null || uvVal === null) {
      durNorm = null;
      missingDataDisclosure.push(
        `"${candidate.displayName}" is missing ${
          ftVal === null ? 'freeze–thaw ' : ''
        }${saltVal === null ? 'coastal salt ' : ''}durability data; 0 points awarded for Durability criterion.`
      );
    } else {
      const scoreRating = (r: ResistanceRating | null) =>
        r === 'high-resistant' || r === 'not-applicable'
          ? 95
          : r === 'moderate-conditional'
          ? 72
          : 35;
      durNorm = Math.round(
        (scoreRating(ftVal) + scoreRating(saltVal) + scoreRating(uvVal)) / 3
      );
    }
    criterionScores.push({
      criterionId: 'durabilityAndWeathering',
      label: 'Weathering, Frost & Salt Durability',
      rawValueDisplay: `Frost: ${ftVal ?? 'missing'}, Salt: ${saltVal ?? 'missing'}, UV: ${
        uvVal ?? 'missing'
      }`,
      unit: 'ratings',
      evidenceStatus:
        ftVal === null ? 'unavailable' : candidate.freezeThawResistance.evidenceStatus,
      normalizedScore: durNorm,
      weight: weights.durabilityAndWeathering,
      weightedPoints:
        durNorm !== null && totalWeight > 0
          ? (durNorm * weights.durabilityAndWeathering) / totalWeight
          : 0,
      isMissingData: durNorm === null,
      explanation:
        durNorm === null
          ? 'Missing frost/salt durability test data contributes 0 points.'
          : `Composite durability rating across freeze–thaw (${ftVal}), salt (${saltVal}), and UV (${uvVal}).`,
    });

    // 3. Low Maintenance & Service Life
    const maintYrs = candidate.maintenanceIntervalYears.value;
    const slRange = candidate.expectedServiceLifeYearsRange.value;
    let maintNorm: number | null = null;
    if (maintYrs !== null && slRange !== null) {
      const intervalScore = Math.min(100, Math.max(20, maintYrs * 6));
      const lifeScore = Math.min(100, Math.max(30, slRange.minYears * 1.6));
      maintNorm = Math.round(intervalScore * 0.55 + lifeScore * 0.45);
    }
    criterionScores.push({
      criterionId: 'lowMaintenance',
      label: 'Maintenance Interval & Service Life',
      rawValueDisplay:
        maintYrs !== null && slRange !== null
          ? `Every ${maintYrs} yrs / ${slRange.minYears}–${slRange.maxYears} yr life`
          : 'Unavailable',
      unit: 'years',
      evidenceStatus: candidate.maintenanceIntervalYears.evidenceStatus,
      normalizedScore: maintNorm,
      weight: weights.lowMaintenance,
      weightedPoints:
        maintNorm !== null && totalWeight > 0
          ? (maintNorm * weights.lowMaintenance) / totalWeight
          : 0,
      isMissingData: maintNorm === null,
      explanation:
        maintNorm !== null
          ? candidate.maintenanceRequirementsSummary
          : 'Missing maintenance or service life data contributes 0 points.',
    });

    // 4. Thermal & Moisture Hygrothermal Fit
    const lambda = candidate.thermalConductivityWPerMK.value;
    const wAbs = candidate.waterAbsorptionPctByWeight.value;
    let thermMoistNorm: number | null = null;
    if (lambda !== null && wAbs !== null) {
      const absScore = Math.max(20, Math.round(100 - wAbs * 4));
      const lambdaScore =
        lambda <= 0.2 ? 95 : lambda <= 0.9 ? 80 : lambda <= 2.0 ? 68 : 55;
      thermMoistNorm = Math.round(absScore * 0.6 + lambdaScore * 0.4);
    }
    criterionScores.push({
      criterionId: 'thermalAndMoistureFit',
      label: 'Thermal & Moisture Properties',
      rawValueDisplay:
        lambda !== null && wAbs !== null
          ? `λ = ${lambda} W/(m·K), Abs = ${wAbs}%`
          : 'Unavailable',
      unit: 'W/(m·K) & %',
      evidenceStatus: candidate.thermalConductivityWPerMK.evidenceStatus,
      normalizedScore: thermMoistNorm,
      weight: weights.thermalAndMoistureFit,
      weightedPoints:
        thermMoistNorm !== null && totalWeight > 0
          ? (thermMoistNorm * weights.thermalAndMoistureFit) / totalWeight
          : 0,
      isMissingData: thermMoistNorm === null,
      explanation:
        thermMoistNorm !== null
          ? `Thermal conductivity ${lambda} W/(m·K) and capillary absorption ${wAbs}%.`
          : 'Missing thermal conductivity or water absorption data contributes 0 points.',
    });

    // 5. Cost Predictability / Relative Index
    const costIdx = candidate.relativeCostIndexPerM2Usd.value;
    let costNorm: number | null = null;
    if (costIdx !== null) {
      costNorm = Math.max(20, Math.min(100, Math.round(115 - costIdx * 0.25)));
    }
    criterionScores.push({
      criterionId: 'costPredictability',
      label: 'Relative Installed Cost Index',
      rawValueDisplay:
        costIdx !== null
          ? `~$${costIdx}/m² (${candidate.mappedCostTier})`
          : 'Unavailable',
      unit: 'USD/m²',
      evidenceStatus: candidate.relativeCostIndexPerM2Usd.evidenceStatus,
      normalizedScore: costNorm,
      weight: weights.costPredictability,
      weightedPoints:
        costNorm !== null && totalWeight > 0
          ? (costNorm * weights.costPredictability) / totalWeight
          : 0,
      isMissingData: costNorm === null,
      explanation:
        costNorm !== null
          ? `Relative cost tier: ${candidate.mappedCostTier} (~$${costIdx}/m²).`
          : 'Missing cost index contributes 0 points.',
    });

    // 6. User Preference Match (P32 Explicit Preference)
    const prefNorm = suitability.p32PreferenceAlignment.matchesExplicitUserPreference
      ? 100
      : 60;
    criterionScores.push({
      criterionId: 'userPreferenceMatch',
      label: 'P32 Explicit Preference Alignment',
      rawValueDisplay: suitability.p32PreferenceAlignment.matchesExplicitUserPreference
        ? 'Matches Explicit Preference'
        : 'Neutral / Not Explicitly Preferred',
      unit: 'match',
      evidenceStatus: 'traceable-generic-data',
      normalizedScore: prefNorm,
      weight: weights.userPreferenceMatch,
      weightedPoints:
        totalWeight > 0 ? (prefNorm * weights.userPreferenceMatch) / totalWeight : 0,
      isMissingData: false,
      explanation: suitability.p32PreferenceAlignment.preferenceExplanation,
    });

    // 7. Embodied Carbon Intensity Reference (where applicable)
    const carbonVal = candidate.embodiedCarbonKgCo2ePerM2GfaRef.value;
    let carbonNorm: number | null = null;
    if (carbonVal !== null) {
      carbonNorm = Math.max(20, Math.min(100, Math.round(120 - carbonVal * 0.16)));
    }
    criterionScores.push({
      criterionId: 'embodiedCarbonReference',
      label: 'Embodied Carbon Benchmark Ref',
      rawValueDisplay:
        carbonVal !== null ? `${carbonVal} kg CO₂e/m² GFA` : 'Not parameterized',
      unit: 'kg CO₂e/m² GFA',
      evidenceStatus: candidate.embodiedCarbonKgCo2ePerM2GfaRef.evidenceStatus,
      normalizedScore: carbonNorm,
      weight: weights.embodiedCarbonReference,
      weightedPoints:
        carbonNorm !== null && totalWeight > 0
          ? (carbonNorm * weights.embodiedCarbonReference) / totalWeight
          : 0,
      isMissingData: carbonNorm === null,
      explanation:
        carbonNorm !== null
          ? `Plotify scenarioCalculator benchmark (${carbonVal} kg CO₂e/m² GFA); separate from climate suitability.`
          : 'Carbon reference not parameterized for this material layer; contributes 0 points when weighted.',
    });

    const activeCriteria = criterionScores.filter((c) => c.weight > 0);
    const availableActive = activeCriteria.filter((c) => !c.isMissingData);
    const dataCoveragePercent =
      activeCriteria.length > 0
        ? Math.round((availableActive.length / activeCriteria.length) * 100)
        : 100;
    const missingDataPenaltyApplied = availableActive.length < activeCriteria.length;

    const rawTotalScore = criterionScores.reduce((sum, c) => sum + c.weightedPoints, 0);
    const weightedPreferenceScore =
      scoringEnabled && climateContext.isConfigured && totalWeight > 0
        ? Math.round(rawTotalScore * 10) / 10
        : null;

    const leadingStrengths = suitability.supportingPropertiesSummary.slice(0, 3);
    const leadingTradeOffs = [
      ...suitability.maintenanceAndDurabilityConcerns,
      ...suitability.principalTradeOffs,
    ].slice(0, 3);

    return {
      candidate,
      suitability,
      meetsMandatoryAndClimateScreen,
      mandatoryOrClimateBlockReasons,
      weightedPreferenceScore,
      availableCriteriaCount: availableActive.length,
      totalActiveCriteriaCount: activeCriteria.length,
      dataCoveragePercent,
      missingDataPenaltyApplied,
      criterionScores,
      leadingStrengths,
      leadingTradeOffs,
    };
  });

  // Sort entries:
  // 1. Candidates that meet mandatory P30 & climate screen ALWAYS sort ahead of blocked candidates,
  //    proving a soft preference score never overrides a mandatory constraint or climate disqualification!
  // 2. Then by weightedPreferenceScore descending (when enabled)
  entries.sort((a, b) => {
    if (a.meetsMandatoryAndClimateScreen !== b.meetsMandatoryAndClimateScreen) {
      return a.meetsMandatoryAndClimateScreen ? -1 : 1;
    }
    const scoreA = a.weightedPreferenceScore ?? -1;
    const scoreB = b.weightedPreferenceScore ?? -1;
    if (Math.abs(scoreB - scoreA) > 1e-6) {
      return scoreB - scoreA;
    }
    return a.candidate.displayName.localeCompare(b.candidate.displayName);
  });

  // Check tie and weight sensitivity among eligible top candidates
  const eligible = entries.filter(
    (e) => e.meetsMandatoryAndClimateScreen && e.weightedPreferenceScore !== null
  );
  let isRankingTie = false;
  let isRankingSensitiveToWeights = false;
  let rankingSensitivityExplanation =
    'Only one eligible candidate or scoring disabled; ranking sensitivity not applicable.';

  if (eligible.length >= 2) {
    const top1 = eligible[0];
    const top2 = eligible[1];
    const gap = Math.abs(
      (top1.weightedPreferenceScore || 0) - (top2.weightedPreferenceScore || 0)
    );
    isRankingTie = gap < 1.0;
    isRankingSensitiveToWeights = gap < 6.0;
    if (isRankingTie) {
      rankingSensitivityExplanation = `Top candidates "${top1.candidate.displayName}" (${top1.weightedPreferenceScore} pts) and "${top2.candidate.displayName}" (${top2.weightedPreferenceScore} pts) are within 1.0 point (virtual tie). Inspect trade-offs directly rather than relying on rank order.`;
    } else if (isRankingSensitiveToWeights) {
      rankingSensitivityExplanation = `Ranking between "${top1.candidate.displayName}" (${top1.weightedPreferenceScore} pts) and "${top2.candidate.displayName}" (${top2.weightedPreferenceScore} pts) is narrow (${gap.toFixed(
        1
      )} pts) and sensitive to user weight adjustments between Maintenance, Cost, and Climate Durability.`;
    } else {
      rankingSensitivityExplanation = `Lead candidate "${top1.candidate.displayName}" holds a clear ${gap.toFixed(
        1
      )}-point margin over "${top2.candidate.displayName}" under current weights.`;
    }
  }

  const targetRoom = options?.targetRoomId
    ? (project.floorPlan?.rooms || []).find((r) => r.id === options.targetRoomId)
    : undefined;

  return {
    application,
    targetRoomId: targetRoom?.id,
    targetRoomName: targetRoom?.name,
    climateProfileName: climateContext.profileName,
    climateIsConfigured: climateContext.isConfigured,
    scoringEnabled,
    weights,
    entries,
    isRankingTie,
    isRankingSensitiveToWeights,
    rankingSensitivityExplanation,
    missingDataDisclosure,
    comparisonDisclaimer: P35_COMPLIANCE_DISCLAIMER,
  };
}

/**
 * Evaluates the materials currently assigned to the project's active design alternative and rooms.
 */
export function evaluateCurrentProjectMaterials(
  project: Project,
  climateContext: ProjectClimateContext
): MaterialCandidateSuitabilityReport[] {
  const catalogue = getAvailableMaterialCatalogue(project);
  const advisor = initializeProjectMaterialAdvisorData(project);
  const activeAlt =
    project.designAlternatives?.find((a) => a.id === project.activeAlternativeId) ||
    project.designAlternatives?.[0];

  const reports: MaterialCandidateSuitabilityReport[] = [];

  // 1. Primary Facade Material
  const primaryMatKey = activeAlt?.facade?.primaryMaterial || 'timber';
  const primaryCand =
    catalogue.find(
      (c) =>
        c.materialId === advisor.savedEnvelopeSelections.primaryFacadeMaterialId &&
        c.supportedApplications.includes('exterior-primary-facade')
    ) ||
    catalogue.find(
      (c) =>
        c.mappedFacadeMaterial === primaryMatKey &&
        c.supportedApplications.includes('exterior-primary-facade')
    );
  if (primaryCand) {
    reports.push(
      evaluateMaterialCandidateForClimate(
        project,
        primaryCand,
        'exterior-primary-facade',
        climateContext,
        { activeFacade: activeAlt?.facade }
      )
    );
  }

  // 2. Accent Facade Material
  const accentMatKey = activeAlt?.facade?.accentMaterial || 'stone';
  const accentCand =
    catalogue.find(
      (c) =>
        c.materialId === advisor.savedEnvelopeSelections.accentCladdingMaterialId &&
        c.supportedApplications.includes('exterior-accent-cladding')
    ) ||
    catalogue.find(
      (c) =>
        c.mappedFacadeMaterial === accentMatKey &&
        c.supportedApplications.includes('exterior-accent-cladding')
    );
  if (accentCand) {
    reports.push(
      evaluateMaterialCandidateForClimate(
        project,
        accentCand,
        'exterior-accent-cladding',
        climateContext,
        { activeFacade: activeAlt?.facade }
      )
    );
  }

  // 3. Roof Covering
  const roofCand =
    catalogue.find(
      (c) => c.materialId === advisor.savedEnvelopeSelections.roofCoveringMaterialId
    ) || catalogue.find((c) => c.supportedApplications.includes('roof-covering-and-trim'));
  if (roofCand) {
    reports.push(
      evaluateMaterialCandidateForClimate(
        project,
        roofCand,
        'roof-covering-and-trim',
        climateContext,
        { activeFacade: activeAlt?.facade }
      )
    );
  }

  // 4. First interior room wall & floor finish
  const firstRoom = project.floorPlan?.rooms?.[0];
  if (firstRoom) {
    const roomConcept = activeAlt?.interiors?.[firstRoom.id];
    const wallCand =
      catalogue.find((c) => c.mappedInteriorWallFinish === roomConcept?.wallFinish) ||
      catalogue.find((c) => c.supportedApplications.includes('interior-wall-finish'));
    if (wallCand) {
      reports.push(
        evaluateMaterialCandidateForClimate(
          project,
          wallCand,
          'interior-wall-finish',
          climateContext,
          { targetRoomId: firstRoom.id }
        )
      );
    }

    const floorCand =
      catalogue.find((c) => c.mappedInteriorFloorFinish === roomConcept?.floorFinish) ||
      catalogue.find((c) => c.supportedApplications.includes('interior-floor-finish'));
    if (floorCand) {
      reports.push(
        evaluateMaterialCandidateForClimate(
          project,
          floorCand,
          'interior-floor-finish',
          climateContext,
          { targetRoomId: firstRoom.id }
        )
      );
    }
  }

  return reports;
}

/**
 * Produces P31 Multi-Option Design Comparison material suitability summaries across all comparable project options.
 * Never alters P31 spatial, cost, or geometry formulas.
 */
export function getP35MaterialSummaryForOptionComparison(
  project: Project,
  optionId?: string
): P35OptionMaterialComparisonSummary[] {
  const advisor = initializeProjectMaterialAdvisorData(project);
  const climate = advisor.climateContext;
  const catalogue = getAvailableMaterialCatalogue(project);
  const options = extractComparableOptions(project);
  const filteredOptions = optionId
    ? options.filter((o) => o.optionId === optionId)
    : options;

  return filteredOptions.map((opt) => {
    const primaryMat = opt.facade?.primaryMaterial || 'timber';
    const accentMat = opt.facade?.accentMaterial;

    const primaryCand =
      catalogue.find(
        (c) =>
          c.mappedFacadeMaterial === primaryMat &&
          c.supportedApplications.includes('exterior-primary-facade')
      ) || catalogue[0];

    const primaryEval = evaluateMaterialCandidateForClimate(
      project,
      primaryCand,
      'exterior-primary-facade',
      climate,
      { activeFacade: opt.facade }
    );

    let accentEval: MaterialCandidateSuitabilityReport | undefined;
    if (accentMat) {
      const accentCand = catalogue.find(
        (c) =>
          c.mappedFacadeMaterial === accentMat &&
          c.supportedApplications.includes('exterior-accent-cladding')
      );
      if (accentCand) {
        accentEval = evaluateMaterialCandidateForClimate(
          project,
          accentCand,
          'exterior-accent-cladding',
          climate,
          { activeFacade: opt.facade }
        );
      }
    }

    const evals = [primaryEval, ...(accentEval ? [accentEval] : [])];
    const concernsOrNotRecommendedCount = evals.filter(
      (e) =>
        e.overallStatus === 'concern-identified' ||
        e.overallStatus === 'not-recommended-for-screened-conditions'
    ).length;
    const insufficientEvidenceCount = evals.filter(
      (e) => e.overallStatus === 'insufficient-evidence'
    ).length;

    const caveats: string[] = [
      `Evaluated against climate profile: "${climate.profileName}".`,
      'Material screening reflects envelope properties only and does not alter P31 geometry or cost metrics.',
    ];
    if (!climate.isConfigured) {
      caveats.push(
        'Climate context is unconfigured; configure climate exposure in P35 to complete suitability screening.'
      );
    }

    return {
      optionId: opt.optionId,
      optionName: opt.name,
      climateProfileName: climate.profileName,
      climateIsConfigured: climate.isConfigured,
      primaryFacadeMaterialId: primaryCand.materialId,
      primaryFacadeMaterialName: primaryCand.displayName,
      primaryFacadeSuitabilityStatus: primaryEval.overallStatus,
      accentFacadeMaterialId: accentMat,
      accentFacadeSuitabilityStatus: accentEval?.overallStatus,
      interiorFinishesEvaluatedCount: opt.interiorsConfiguredCount,
      concernsOrNotRecommendedCount,
      insufficientEvidenceCount,
      embodiedCarbonIntensityKgPerM2Ref:
        PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2[primaryMat] ?? null,
      summaryExplanation: primaryEval.whySuitableOrUnsuitableSummary,
      caveats,
    };
  });
}

/**
 * Full deterministic evaluation entry point for P35 Climate-Responsive Material Advisor.
 */
export function evaluateProjectMaterialAdvisor(
  project: Project,
  overrideAdvisor?: Partial<ProjectMaterialAdvisorData>
): ClimateMaterialAdvisorEvaluationReport {
  const advisor: ProjectMaterialAdvisorData = {
    ...initializeProjectMaterialAdvisorData(project),
    ...(overrideAdvisor || {}),
  };

  const currentFingerprint = computeMaterialAdvisorFingerprint(project, advisor);
  const storedFingerprint = project.materialAdvisor?.lastSourceFingerprint;
  const isStale = Boolean(
    storedFingerprint && storedFingerprint !== currentFingerprint
  );
  const staleReason = isStale
    ? 'Project climate exposure, facade/interior specifications, or P30/P32 material constraints changed since the last saved P35 evaluation.'
    : undefined;

  const catalogue = getAvailableMaterialCatalogue(project);
  const solarAnalysis = evaluateSolarOrientation(project);
  const highSolarExposureFacades: string[] = [];
  if (solarAnalysis.facadeSunExposure.southFacade === 'direct-high-solar-gain') {
    highSolarExposureFacades.push('South');
  }
  if (solarAnalysis.facadeSunExposure.westFacade === 'afternoon-heat-glare-risk') {
    highSolarExposureFacades.push('West');
  }
  if (solarAnalysis.facadeSunExposure.eastFacade === 'morning-sun-light') {
    highSolarExposureFacades.push('East (morning)');
  }

  const currentProjectMaterialEvaluations = evaluateCurrentProjectMaterials(
    project,
    advisor.climateContext
  );

  const activeCandidates = catalogue.filter((c) =>
    c.supportedApplications.includes(advisor.selectedApplication)
  );
  const activeApplicationEvaluations = activeCandidates.map((cand) =>
    evaluateMaterialCandidateForClimate(
      project,
      cand,
      advisor.selectedApplication,
      advisor.climateContext,
      { targetRoomId: advisor.selectedTargetRoomId }
    )
  );

  const comparisonResult = compareMaterialCandidatesForApplication(
    project,
    advisor.selectedApplication,
    advisor.climateContext,
    {
      candidateIds:
        advisor.comparedMaterialIdsByApplication[advisor.selectedApplication],
      targetRoomId: advisor.selectedTargetRoomId,
      scoringEnabled: advisor.scoringEnabled,
      weights: advisor.rankingWeights,
    }
  );

  const p30 = extractP30MaterialRequirements(project);
  const p32 = extractP32MaterialPreferences(project);
  const p31OptionSummaries = getP35MaterialSummaryForOptionComparison(project);

  return {
    evaluationId: `p35-eval-${project.id}-${advisor.requestSequenceId}`,
    engineVersion: P35_MATERIAL_ADVISOR_ENGINE_VERSION,
    projectId: project.id,
    projectName: project.name,
    evaluatedAt: new Date().toISOString(),
    requestSequenceId: advisor.requestSequenceId,
    sourceFingerprint: currentFingerprint,
    isStale,
    staleReason,
    climateContext: advisor.climateContext,
    solarOrientationSummary: {
      northOffsetDeg: solarAnalysis.northOrientationOffsetDeg,
      roadFacing: project.roadFacing,
      highSolarExposureFacades,
      orientationAdvisory: solarAnalysis.solarOrientationDescription,
    },
    activeApplication: advisor.selectedApplication,
    activeTargetRoomId: advisor.selectedTargetRoomId,
    availableCatalogue: catalogue,
    currentProjectMaterialEvaluations,
    activeApplicationEvaluations,
    comparisonResult,
    p30Compatibility: {
      hasBrief: p30.hasBrief,
      confirmedMaterialRequirements: p30.confirmedMaterialRequirements,
      unconfirmedMaterialAssumptions: p30.unconfirmedMaterialAssumptions,
      briefMaterialConflicts: p30.briefMaterialConflicts,
    },
    p31OptionSummaries,
    p32Compatibility: p32,
    carbonBoundaryDisclosure: {
      usesExistingScenarioCalculatorFormula: true,
      systemBoundaryNote:
        'Embodied carbon numbers shown in P35 reference Plotify’s existing scenarioCalculator.ts upfront benchmark (kg CO₂e/m² GFA by primary material) and are kept strictly separate from climate suitability.',
      p44IntegrationNote:
        'Full product-stage A1–A3 / whole-life LCA carbon accounting belongs to P44 (Embodied Carbon & Material Footprint Estimator) and is not fabricated in P35.',
    },
    roadmapScopeBoundaries: [
      {
        roadmapId: 'P36',
        title: 'Biophilic & Well-Being Design Advisor',
        boundaryStatement:
          'P35 evaluates physical climate, moisture, thermal, and weathering material performance; biophilic and occupant well-being scoring belongs to P36.',
      },
      {
        roadmapId: 'P37–P40',
        title: 'Acoustic, Structural, Cost-to-Build & Construction Phasing Engines',
        boundaryStatement:
          'P35 provides material-level cost tier and substrate compatibility notes without replacing dedicated acoustic (P37), structural (P38), or BOQ/phasing (P39–P40) engines.',
      },
      {
        roadmapId: 'P44–P46',
        title: 'Account B Sustainability, Water/Solar & Resilience Engines',
        boundaryStatement:
          'P35 does not duplicate whole-building LCA (P44), rainwater/solar PV sizing (P45), or hazard resilience certification (P46).',
      },
    ],
    complianceDisclaimer: P35_COMPLIANCE_DISCLAIMER,
  };
}

/**
 * Applies a material selection request to a deep-cloned Project copy in memory.
 * Preserves all project, room, scenario, and designAlternative IDs, 2D room coordinates, and P30/P32 data.
 */
function applyMaterialSelectionToClone(
  project: Project,
  request: MaterialSelectionApplyRequest,
  candidate: ClimateMaterialCandidate
): {
  clonedProject: Project;
  fieldChanges: MaterialSelectionPreviewDiff['fieldChanges'];
} {
  const cloned: Project = JSON.parse(JSON.stringify(project));
  const advisor = initializeProjectMaterialAdvisorData(cloned);
  const fieldChanges: MaterialSelectionPreviewDiff['fieldChanges'] = [];

  if (!Array.isArray(cloned.designAlternatives) || cloned.designAlternatives.length === 0) {
    const defaultAlt: DesignAlternative = {
      id: `alt-default-${cloned.id}`,
      name: 'Primary Architectural Specification',
      description: 'Baseline facade and interior specification.',
      createdAt: cloned.createdAt || new Date().toISOString(),
      facade: {
        style: 'Modern',
        primaryMaterial: 'timber',
        accentMaterial: 'stone',
        paletteName: 'Custom Climate-Responsive Palette',
        primaryColor: '#b4845c',
        accentColor: '#475569',
        windowTrimColor: '#1e293b',
        roofTrimColor: '#0f172a',
        windowStyle: 'floor-to-ceiling',
        entranceStyle: 'canopy-cantilever',
        shadingStyle: 'deep-overhangs',
        elevationView: 'perspective',
        costTier: 'Balanced Mid-Range',
        notes: '',
      },
      interiors: {},
    };
    cloned.designAlternatives = [defaultAlt];
    cloned.activeAlternativeId = defaultAlt.id;
  }

  const targetAltId =
    request.targetAlternativeId ||
    cloned.activeAlternativeId ||
    cloned.designAlternatives[0].id;
  const targetAlt =
    cloned.designAlternatives.find((a) => a.id === targetAltId) ||
    cloned.designAlternatives[0];

  if (request.application === 'exterior-primary-facade') {
    const beforeMat = targetAlt.facade.primaryMaterial;
    const afterMat = candidate.mappedFacadeMaterial || beforeMat;
    fieldChanges.push({
      fieldPath: `designAlternatives[${targetAlt.id}].facade.primaryMaterial`,
      label: `Primary Facade Material (${targetAlt.name})`,
      beforeValue: `${beforeMat} (${
        advisor.savedEnvelopeSelections.primaryFacadeMaterialId || 'default'
      })`,
      afterValue: `${afterMat} (${candidate.displayName})`,
      changed:
        beforeMat !== afterMat ||
        advisor.savedEnvelopeSelections.primaryFacadeMaterialId !== candidate.materialId,
    });
    targetAlt.facade.primaryMaterial = afterMat;
    targetAlt.facade.primaryColor = candidate.defaultHexColor || targetAlt.facade.primaryColor;
    targetAlt.facade.costTier = candidate.mappedCostTier || targetAlt.facade.costTier;
    advisor.savedEnvelopeSelections.primaryFacadeMaterialId = candidate.materialId;
  } else if (request.application === 'exterior-accent-cladding') {
    const beforeMat = targetAlt.facade.accentMaterial;
    const afterMat = candidate.mappedFacadeMaterial || beforeMat;
    fieldChanges.push({
      fieldPath: `designAlternatives[${targetAlt.id}].facade.accentMaterial`,
      label: `Accent Cladding Material (${targetAlt.name})`,
      beforeValue: `${beforeMat} (${
        advisor.savedEnvelopeSelections.accentCladdingMaterialId || 'default'
      })`,
      afterValue: `${afterMat} (${candidate.displayName})`,
      changed:
        beforeMat !== afterMat ||
        advisor.savedEnvelopeSelections.accentCladdingMaterialId !== candidate.materialId,
    });
    targetAlt.facade.accentMaterial = afterMat;
    targetAlt.facade.accentColor = candidate.defaultHexColor || targetAlt.facade.accentColor;
    advisor.savedEnvelopeSelections.accentCladdingMaterialId = candidate.materialId;
  } else if (request.application === 'roof-covering-and-trim') {
    const beforeId =
      advisor.savedEnvelopeSelections.roofCoveringMaterialId || 'unassigned';
    fieldChanges.push({
      fieldPath: 'materialAdvisor.savedEnvelopeSelections.roofCoveringMaterialId',
      label: 'Roof Covering & Trim Specification',
      beforeValue: beforeId,
      afterValue: `${candidate.materialId} (${candidate.displayName})`,
      changed: beforeId !== candidate.materialId,
    });
    advisor.savedEnvelopeSelections.roofCoveringMaterialId = candidate.materialId;
    targetAlt.facade.roofTrimColor = candidate.defaultHexColor || targetAlt.facade.roofTrimColor;
  } else if (request.application === 'exterior-glazing-and-frames') {
    const beforeId =
      advisor.savedEnvelopeSelections.glazingSpecificationMaterialId || 'unassigned';
    fieldChanges.push({
      fieldPath: 'materialAdvisor.savedEnvelopeSelections.glazingSpecificationMaterialId',
      label: 'Exterior Glazing & Frame Specification',
      beforeValue: beforeId,
      afterValue: `${candidate.materialId} (${candidate.displayName})`,
      changed: beforeId !== candidate.materialId,
    });
    advisor.savedEnvelopeSelections.glazingSpecificationMaterialId = candidate.materialId;
    if (candidate.mappedWindowStyle) {
      targetAlt.facade.windowStyle = candidate.mappedWindowStyle;
    }
  } else if (request.application === 'envelope-insulation-and-moisture-control') {
    const beforeId =
      advisor.savedEnvelopeSelections.insulationMoistureMaterialId || 'unassigned';
    fieldChanges.push({
      fieldPath: 'materialAdvisor.savedEnvelopeSelections.insulationMoistureMaterialId',
      label: 'Envelope Continuous Insulation & Moisture Control',
      beforeValue: beforeId,
      afterValue: `${candidate.materialId} (${candidate.displayName})`,
      changed: beforeId !== candidate.materialId,
    });
    advisor.savedEnvelopeSelections.insulationMoistureMaterialId = candidate.materialId;
  } else if (
    request.application === 'interior-wall-finish' ||
    request.application === 'interior-floor-finish'
  ) {
    const rooms = cloned.floorPlan?.rooms || [];
    const targetScope =
      request.targetRoomScope ||
      advisor.selectedTargetRoomId ||
      rooms[0]?.id ||
      'all-rooms';

    const matchedRooms = rooms.filter((r) => {
      if (targetScope === 'all-rooms') return true;
      if (targetScope === 'dry-rooms') return !isWetInteriorRoom(r);
      if (targetScope === 'wet-rooms') return isWetInteriorRoom(r);
      return r.id === targetScope;
    });

    if (!targetAlt.interiors) {
      targetAlt.interiors = {};
    }

    for (const room of matchedRooms) {
      const existingInterior: InteriorRoomConcept = targetAlt.interiors[room.id] || {
        roomId: room.id,
        roomName: room.name,
        style: 'Scandinavian',
        paletteName: 'Climate-Responsive Interior Palette',
        wallColor: '#f8fafc',
        wallFinish: 'limewash-mineral',
        floorFinish: 'light-oak-plank',
        ceilingFinish: 'smooth-white',
        furnitureStyle: 'scandinavian-clean',
        lightingMood: 'natural-zenithal',
        storageStyle: 'floor-to-ceiling-concealed',
        designPriority: 'functionality',
        notes: '',
      };

      if (request.application === 'interior-wall-finish' && candidate.mappedInteriorWallFinish) {
        const beforeFinish = existingInterior.wallFinish;
        const afterFinish = candidate.mappedInteriorWallFinish;
        fieldChanges.push({
          fieldPath: `designAlternatives[${targetAlt.id}].interiors[${room.id}].wallFinish`,
          label: `Interior Wall Finish — ${room.name}`,
          beforeValue: beforeFinish,
          afterValue: `${afterFinish} (${candidate.displayName})`,
          changed: beforeFinish !== afterFinish,
        });
        existingInterior.wallFinish = afterFinish;
        existingInterior.wallColor = candidate.defaultHexColor || existingInterior.wallColor;
      } else if (
        request.application === 'interior-floor-finish' &&
        candidate.mappedInteriorFloorFinish
      ) {
        const beforeFinish = existingInterior.floorFinish;
        const afterFinish = candidate.mappedInteriorFloorFinish;
        fieldChanges.push({
          fieldPath: `designAlternatives[${targetAlt.id}].interiors[${room.id}].floorFinish`,
          label: `Interior Floor Finish — ${room.name}`,
          beforeValue: beforeFinish,
          afterValue: `${afterFinish} (${candidate.displayName})`,
          changed: beforeFinish !== afterFinish,
        });
        existingInterior.floorFinish = afterFinish;
      }

      targetAlt.interiors[room.id] = existingInterior;
    }
  }

  advisor.savedEnvelopeSelections.updatedAt = new Date().toISOString();
  cloned.materialAdvisor = advisor;

  return { clonedProject: cloned, fieldChanges };
}

/**
 * Non-destructive preview of applying a material candidate to the project.
 * Never mutates the passed-in `project`.
 */
export function previewMaterialSelection(
  project: Project,
  request: MaterialSelectionApplyRequest
): MaterialSelectionPreviewDiff {
  const advisor = initializeProjectMaterialAdvisorData(project);
  const catalogue = getAvailableMaterialCatalogue(project);
  const candidate = catalogue.find((c) => c.materialId === request.materialId);

  if (!candidate) {
    return {
      request,
      candidateName: 'Unknown Material Candidate',
      suitabilityStatus: 'not-assessed',
      isSafeToApply: false,
      blockingReasons: [`Material candidate "${request.materialId}" was not found in catalogue.`],
      warningNotices: [],
      fieldChanges: [],
      preservesRoomGeometryAndIds: true,
      preservesP30AndP32Data: true,
      proposedProjectClone: {},
    };
  }

  const targetRoomId =
    request.targetRoomScope &&
    !['all-rooms', 'dry-rooms', 'wet-rooms'].includes(request.targetRoomScope)
      ? request.targetRoomScope
      : advisor.selectedTargetRoomId;

  const suitability = evaluateMaterialCandidateForClimate(
    project,
    candidate,
    request.application,
    advisor.climateContext,
    { targetRoomId }
  );

  const blockingReasons: string[] = [];
  const warningNotices: string[] = [];

  if (!candidate.supportedApplications.includes(request.application)) {
    blockingReasons.push(
      `"${candidate.displayName}" does not support application "${request.application}".`
    );
  }

  if (!suitability.p30BriefAlignment.matchesConfirmedRequirements) {
    blockingReasons.push(
      ...suitability.p30BriefAlignment.conflictsWithConfirmedRequirements
    );
  }

  if (suitability.overallStatus === 'not-recommended-for-screened-conditions') {
    blockingReasons.push(suitability.whySuitableOrUnsuitableSummary);
  }

  if (suitability.overallStatus === 'insufficient-evidence') {
    warningNotices.push(suitability.whySuitableOrUnsuitableSummary);
  } else if (
    suitability.overallStatus === 'concern-identified' ||
    suitability.overallStatus === 'conditionally-suitable' ||
    suitability.overallStatus === 'requires-professional-review'
  ) {
    warningNotices.push(suitability.whySuitableOrUnsuitableSummary);
    warningNotices.push(
      ...suitability.conditionsAndProfessionalChecksRequired.slice(0, 2)
    );
  }

  const { clonedProject, fieldChanges } = applyMaterialSelectionToClone(
    project,
    request,
    candidate
  );

  // Verify room geometry & IDs and P30/P32 data are 100% preserved
  const origRooms = JSON.stringify(project.floorPlan?.rooms || []);
  const nextRooms = JSON.stringify(clonedProject.floorPlan?.rooms || []);
  const preservesRoomGeometryAndIds =
    origRooms === nextRooms && clonedProject.id === project.id;
  const preservesP30AndP32Data =
    JSON.stringify(project.brief) === JSON.stringify(clonedProject.brief) &&
    JSON.stringify(project.designPersonalization) ===
      JSON.stringify(clonedProject.designPersonalization);

  if (!preservesRoomGeometryAndIds) {
    blockingReasons.push('Safety check failed: room geometry or IDs would be altered.');
  }

  return {
    request,
    candidateName: candidate.displayName,
    suitabilityStatus: suitability.overallStatus,
    isSafeToApply: blockingReasons.length === 0,
    blockingReasons,
    warningNotices,
    fieldChanges,
    preservesRoomGeometryAndIds,
    preservesP30AndP32Data,
    proposedProjectClone: clonedProject as unknown as Record<string, unknown>,
  };
}

/**
 * Atomically applies a confirmed material selection after creating a pre-apply snapshot checkpoint.
 */
export function applyMaterialSelectionSafely(
  project: Project,
  request: MaterialSelectionApplyRequest
): {
  updatedProject: Project;
  snapshotId: string;
  preview: MaterialSelectionPreviewDiff;
  postApplyReport: ClimateMaterialAdvisorEvaluationReport;
} {
  const preview = previewMaterialSelection(project, request);
  if (!preview.isSafeToApply) {
    throw new Error(
      `Cannot apply material "${request.materialId}" to "${
        request.application
      }": ${preview.blockingReasons.join(' ')}`
    );
  }

  const snapshot = createProjectSnapshot(project, {
    trigger: 'auto-checkpoint',
    label: `P35 Pre-Material Apply (${preview.candidateName})`,
    description: `Automatic pre-application checkpoint before applying "${preview.candidateName}" to ${request.application}.`,
  });
  memoryMaterialSnapshots.set(snapshot.id, JSON.parse(JSON.stringify(project)));

  const updatedProject: Project = JSON.parse(
    JSON.stringify(preview.proposedProjectClone)
  );
  const advisor = initializeProjectMaterialAdvisorData(updatedProject);
  advisor.lastPreApplySnapshotId = snapshot.id;
  advisor.requestSequenceId = (project.materialAdvisor?.requestSequenceId || 1) + 1;
  updatedProject.materialAdvisor = advisor;

  const postApplyReport = evaluateProjectMaterialAdvisor(updatedProject, advisor);
  updatedProject.materialAdvisor.lastEvaluatedAt = postApplyReport.evaluatedAt;
  updatedProject.materialAdvisor.lastSourceFingerprint =
    postApplyReport.sourceFingerprint;
  updatedProject.updatedAt = new Date().toISOString();

  return {
    updatedProject,
    snapshotId: snapshot.id,
    preview,
    postApplyReport,
  };
}

/**
 * Safely saves updated `ProjectMaterialAdvisorData` (climate context, weights, custom materials)
 * with monotonic `requestSequenceId` and optional pre-save snapshot.
 */
export function saveProjectMaterialAdvisorSafely(
  project: Project,
  nextAdvisorData: ProjectMaterialAdvisorData,
  createCheckpoint = true
): {
  updatedProject: Project;
  snapshotId?: string;
  report: ClimateMaterialAdvisorEvaluationReport;
} {
  let snapshotId = nextAdvisorData.lastPreApplySnapshotId;
  if (createCheckpoint) {
    const snap = createProjectSnapshot(project, {
      trigger: 'auto-checkpoint',
      label: 'P35 Material Advisor Configuration Update',
      description: 'Automatic checkpoint prior to saving P35 climate/material configuration.',
    });
    snapshotId = snap.id;
    memoryMaterialSnapshots.set(snap.id, JSON.parse(JSON.stringify(project)));
  }

  const nextSeq = Math.max(
    (project.materialAdvisor?.requestSequenceId || 0) + 1,
    nextAdvisorData.requestSequenceId || 1
  );

  const candidateProject: Project = {
    ...project,
    materialAdvisor: {
      ...nextAdvisorData,
      lastPreApplySnapshotId: snapshotId,
      requestSequenceId: nextSeq,
    },
  };

  const report = evaluateProjectMaterialAdvisor(
    candidateProject,
    candidateProject.materialAdvisor
  );
  candidateProject.materialAdvisor!.lastEvaluatedAt = report.evaluatedAt;
  candidateProject.materialAdvisor!.lastSourceFingerprint = report.sourceFingerprint;
  candidateProject.updatedAt = new Date().toISOString();

  return {
    updatedProject: candidateProject,
    snapshotId,
    report,
  };
}

/**
 * Rolls back P35 material or climate changes to a previous snapshot.
 */
export function rollbackMaterialAdvisorChanges(
  project: Project,
  snapshotId?: string
): Project {
  const targetId = snapshotId || project.materialAdvisor?.lastPreApplySnapshotId;
  if (!targetId) {
    throw new Error('No pre-apply snapshot ID available for P35 material advisor rollback.');
  }

  const snapshots = getProjectSnapshots(project);
  const found = snapshots.find((s) => s.id === targetId);
  if (found) {
    const restoreResult = executeSafeRestore(project, found);
    if (restoreResult.restoredProject) {
      return restoreResult.restoredProject;
    }
  }

  const memSnap = memoryMaterialSnapshots.get(targetId);
  if (memSnap) {
    return JSON.parse(JSON.stringify(memSnap));
  }

  throw new Error(`Snapshot "${targetId}" could not be located for P35 rollback.`);
}
