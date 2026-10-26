/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P36 — Acoustic Comfort Planner Service
 * Account A | Locked Roadmap: P36 of P30–P40
 *
 * Deterministic, unit-safe, provenance-aware acoustic calculation and screening engine:
 * - Room geometry validation & SI unit conversion (m, m², m³)
 * - Octave-band Sabine reverberation estimation (RT60 ≈ 0.161 × V / A)
 * - Speech & functional use screening (no fabricated STI / clarity metrics)
 * - Background & environmental noise screening with logarithmic energy addition
 * - Airborne sound insulation & privacy screening (ISO 12354-1 / ISO 717-1 concepts)
 * - Impact & structure-borne sound checklist
 * - Mechanical services (MEP/HVAC) noise & vibration coordination
 * - Geometry-aware 2D & multi-storey acoustic zoning conflict detection
 * - Actionable recommendations with P30–P35 integration, preview, atomic apply & rollback
 */

import {
  DesignAlternative,
  FloorPlanRoom,
  InteriorRoomConcept,
  MeasurementUnit,
  Project,
} from '../types/project';
import {
  AcousticAssemblyRecord,
  AcousticComfortProjectEvaluationReport,
  AcousticConfidenceState,
  AcousticEvaluationStatus,
  AcousticEvidenceProvenance,
  AcousticImprovementRecommendation,
  AcousticPriorityTag,
  AcousticProposalPreviewDiff,
  AcousticSourceMetadata,
  AcousticSurfaceMaterialRecord,
  AcousticZoningDomainResult,
  AirborneInsulationDomainResult,
  BackgroundNoiseDomainResult,
  ConfiguredAcousticCriterion,
  FunctionalRoomUseProfileId,
  ImpactStructureVibrationDomainResult,
  MeasuredRoomRt60Record,
  MechanicalNoiseDomainResult,
  NoiseObservationEntry,
  OCTAVE_BANDS_HZ,
  OctaveBandCoefficients,
  OctaveBandHz,
  OctaveBandSabineResult,
  P36_ACOUSTIC_PLANNER_ENGINE_VERSION,
  P36_ACOUSTIC_SCHEMA_VERSION,
  P36OptionAcousticComparisonSummary,
  ProjectAcousticPlannerData,
  ReverberationDomainResult,
  RoomAcousticAssessmentReport,
  RoomAcousticConfig,
  RoomAcousticGeometryValidation,
  SharedRoomBoundaryItem,
  SpeechFunctionalDomainResult,
  SurfaceAbsorptionContribution,
} from '../types/acousticComfort';
import { initializeProjectBrief } from './briefService';
import { extractComparableOptions } from './designComparisonService';
import { initializePersonalizationProfile } from './designPersonalizationService';
import { ensureProjectFurnitureLayoutData } from './furnitureIntelligenceService';
import {
  BUILTIN_CLIMATE_MATERIAL_CATALOGUE,
  evaluateMaterialCandidateForClimate,
  initializeProjectMaterialAdvisorData,
} from './climateMaterialAdvisorService';
import {
  createProjectSnapshot,
  executeSafeRestore,
  getProjectSnapshots,
} from './versioningService';

export {
  P36_ACOUSTIC_PLANNER_ENGINE_VERSION,
  P36_ACOUSTIC_SCHEMA_VERSION,
  OCTAVE_BANDS_HZ,
};

export const P36_PROFESSIONAL_DISCLAIMER =
  'Acoustic Comfort Planner (P36) provides preliminary architectural acoustic screening, Sabine reverberation estimates, and design coordination guidance based on available room geometry, declared surface finishes, and user-supplied observations. It does NOT replace a qualified acoustician, ISO 3382-2 on-site reverberation measurements, ISO 12354-1 detailed flanking-transmission modelling, ray-tracing/wave-based acoustic simulation, or statutory building-code certification.';

const METRES_PER_FOOT = 0.3048;
const SQ_METRES_PER_SQ_FOOT = 0.09290304;
const SABINE_CONSTANT_SI = 0.161; // s / m in SI units at 20 °C

/**
 * In-memory snapshot fallback for headless Node.js / CLI verification environments.
 */
const memoryAcousticSnapshots = new Map<string, Project>();

export function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

export function round3(val: number): number {
  return Math.round(val * 1000) / 1000;
}

/**
 * Converts a linear dimension to metres with strict finite/positive validation.
 */
export function convertLengthToMetres(
  value: number | null | undefined,
  unit: MeasurementUnit
): number | null {
  if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return unit === 'feet' ? value * METRES_PER_FOOT : value;
}

/**
 * Converts metres back to the requested display unit.
 */
export function convertMetresToUnit(
  metres: number,
  targetUnit: MeasurementUnit
): number {
  if (!Number.isFinite(metres)) return 0;
  return targetUnit === 'feet' ? metres / METRES_PER_FOOT : metres;
}

/**
 * Converts an area in project units (sq ft or m²) to square metres (m²).
 */
export function convertAreaToSquareMetres(
  area: number | null | undefined,
  unit: MeasurementUnit
): number | null {
  if (area === null || area === undefined || typeof area !== 'number' || !Number.isFinite(area) || area < 0) {
    return null;
  }
  return unit === 'feet' ? area * SQ_METRES_PER_SQ_FOOT : area;
}

/**
 * Logarithmic energy addition of independent steady sound pressure levels (dB):
 * L_total = 10 * log10( sum_{i=1..n} 10^(L_i / 10) )
 *
 * CRITICAL P36 SECTION 9 RULE:
 * Never take an ordinary arithmetic average of decibel values when energy summation is required.
 */
export function combineDecibelLevelsLogarithmic(levelsDb: number[]): number | null {
  const valid = levelsDb.filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 160);
  if (valid.length === 0) return null;
  const energySum = valid.reduce((sum, lvl) => sum + Math.pow(10, lvl / 10), 0);
  if (energySum <= 0 || !Number.isFinite(energySum)) return null;
  return round2(10 * Math.log10(energySum));
}

/**
 * Logarithmic energy average of decibel levels over equal time/space intervals:
 * L_avg = 10 * log10( (1/n) * sum_{i=1..n} 10^(L_i / 10) )
 */
export function averageDecibelLevelsLogarithmic(levelsDb: number[]): number | null {
  const valid = levelsDb.filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 160);
  if (valid.length === 0) return null;
  const meanEnergy = valid.reduce((sum, lvl) => sum + Math.pow(10, lvl / 10), 0) / valid.length;
  if (meanEnergy <= 0 || !Number.isFinite(meanEnergy)) return null;
  return round2(10 * Math.log10(meanEnergy));
}

/**
 * Auditable technical reference sources per P36 Section 17.
 */
export const P36_TECHNICAL_REFERENCES: Record<string, AcousticSourceMetadata> = {
  ISO_3382_2_2008: {
    sourceId: 'iso-3382-2-2008',
    publisher: 'International Organization for Standardization (ISO)',
    title: 'ISO 3382-2:2008 Acoustics — Measurement of room acoustic parameters — Part 2: Reverberation time in ordinary rooms',
    editionOrYear: '2008 (Confirmed current published edition)',
    urlOrIdentifier: 'https://www.iso.org/standard/36201.html',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Defines physical field measurement procedures (survey, engineering, precision) for reverberation time in ordinary rooms. Sabine calculations in P36 are preliminary screening predictions, NOT physical ISO 3382-2 measurements.',
    licenceOrUsageNote: 'Metadata citation and public scope reference only; no copyrighted standard text reproduced.',
  },
  ISO_12354_1_2017: {
    sourceId: 'iso-12354-1-2017',
    publisher: 'International Organization for Standardization (ISO)',
    title: 'ISO 12354-1:2017 Building acoustics — Estimation of acoustic performance of buildings from the performance of elements — Part 1: Airborne sound insulation between rooms',
    editionOrYear: '2017 (Published edition)',
    urlOrIdentifier: 'https://www.iso.org/standard/70242.html',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Establishes that in-situ airborne sound insulation between rooms depends on direct transmission plus structural flanking paths, junctions, and leakage—laboratory element ratings alone do not prove as-built performance.',
    licenceOrUsageNote: 'Metadata citation and engineering principle summary only.',
  },
  ISO_717_1_2020: {
    sourceId: 'iso-717-1-2020',
    publisher: 'International Organization for Standardization (ISO)',
    title: 'ISO 717-1:2020 Acoustics — Rating of sound insulation in buildings and of building elements — Part 1: Airborne sound insulation',
    editionOrYear: '2020 (3rd Edition)',
    urlOrIdentifier: 'https://committee.iso.org/cms/live/live/en/sites/isoorg/contents/data/standard/07/74/77435.html',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Defines single-number quantities (such as Rw and DnT,w) and spectrum adaptation terms for rating airborne sound insulation.',
    licenceOrUsageNote: 'Metadata citation only.',
  },
  ASHRAE_FUNDAMENTALS_CH08: {
    sourceId: 'ashrae-fundamentals-ch08-2025',
    publisher: 'ASHRAE',
    title: 'ASHRAE Handbook — Fundamentals, Chapter 8: Sound and Vibration',
    editionOrYear: '2025',
    urlOrIdentifier: 'https://handbook.ashrae.org/Handbooks/F25/IP/F25_Ch08/F25_Ch08_ip.aspx',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Provides fundamental acoustic equations (Sabine equation, logarithmic decibel addition), generic architectural surface absorption coefficients, and HVAC mechanical noise screening guidance.',
    licenceOrUsageNote: 'Traceable handbook reference for generic screening coefficients and formulas.',
  },
  WHO_NOISE_GUIDELINES_2018: {
    sourceId: 'who-environmental-noise-2018',
    publisher: 'World Health Organization (WHO) Regional Office for Europe',
    title: 'Environmental Noise Guidelines for the European Region',
    editionOrYear: '2018',
    urlOrIdentifier: 'https://www.who.int/publications/i/item/9789289053563',
    accessOrReviewDate: '2026-10-26',
    applicabilityNote:
      'Public-health guidance for outdoor population exposure (Lden, Lnight) from road, rail, aircraft, and wind turbine sources. Not an indoor architectural room pass/fail specification.',
    licenceOrUsageNote: 'Public health publication citation; scope distinction enforced in Domain C.',
  },
};

/**
 * Curated catalogue of acoustic surface materials mapped to Plotify's InteriorRoomConcept finishes
 * and P35 ClimateMaterialCandidate records.
 * Includes an explicitly unverified/incomplete material ('ac-mat-unverified-custom-finish') to test
 * incomplete absorption data handling without fabricating coefficients.
 */
export const REFERENCE_ACOUSTIC_SURFACE_MATERIALS: AcousticSurfaceMaterialRecord[] = [
  // Wall Finishes (mapped to InteriorRoomConcept['wallFinish'])
  {
    acousticMaterialId: 'ac-wall-matte-plaster',
    displayName: 'Gypsum Plaster / Painted Drywall on Masonry or Studs',
    targetSurfaceTypes: ['wall', 'ceiling'],
    mappedInteriorWallFinish: 'matte-plaster',
    mappedInteriorCeilingFinish: 'smooth-white',
    linkedP35MaterialId: 'mat-int-gypsum-plaster-dry',
    octaveBandAbsorption: {
      125: 0.08,
      250: 0.06,
      500: 0.05,
      1000: 0.04,
      2000: 0.04,
      4000: 0.05,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Standard smooth painted gypsum plaster/board over solid backing or stud cavity.',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Non-combustible gypsum core; standard wipeable painted finish.',
    knownLimitations: [
      'Highly sound-reflective across mid and high frequencies (alpha 0.04–0.05 at 500–2000 Hz).',
      'Standard paper-faced gypsum is not suitable for unlined wet-room splash zones (see P35).',
    ],
  },
  {
    acousticMaterialId: 'ac-wall-limewash-mineral',
    displayName: 'Breathable Mineral Limewash on Lime Plaster',
    targetSurfaceTypes: ['wall'],
    mappedInteriorWallFinish: 'limewash-mineral',
    linkedP35MaterialId: 'mat-int-limewash-mineral-plaster',
    octaveBandAbsorption: {
      125: 0.04,
      250: 0.05,
      500: 0.06,
      1000: 0.07,
      2000: 0.07,
      4000: 0.08,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Two-coat mineral lime plaster with microporous limewash finish.',
    moistureAndWetRoomSuitable: true,
    fireAndMaintenanceNote: 'Inorganic mineral finish (Class A1 non-combustible); high vapor permeability.',
    knownLimitations: [
      'Provides minimal sound absorption (alpha ~0.06–0.07 at speech frequencies); requires complementary ceiling or soft absorption in reverberant rooms.',
    ],
  },
  {
    acousticMaterialId: 'ac-wall-timber-slats-absorber',
    displayName: 'Slatted Timber Wall System over 40 mm Mineral Wool Backing',
    targetSurfaceTypes: ['wall', 'ceiling'],
    mappedInteriorWallFinish: 'timber-slats',
    mappedInteriorCeilingFinish: 'timber-coffered',
    linkedP35MaterialId: 'mat-int-timber-slat-wall',
    octaveBandAbsorption: {
      125: 0.25,
      250: 0.55,
      500: 0.75,
      1000: 0.70,
      2000: 0.60,
      4000: 0.50,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: '25% open area timber slats mounted over 40–50 mm acoustic mineral wool fleece cavity (ISO 354 Type E mounting).',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Requires fire-retardant treated timber slats and encapsulated mineral wool where flame-spread limits apply.',
    knownLimitations: [
      'High mid-frequency absorption depends critically on the porous mineral-wool backing behind the slats; solid timber slats glued directly to drywall will NOT achieve these coefficients.',
      'Not suitable for high-moisture wet rooms (bathrooms/laundries) due to timber dimensional warping and backing moisture retention (P35 warning).',
    ],
  },
  {
    acousticMaterialId: 'ac-wall-exposed-brick',
    displayName: 'Unglazed Exposed Masonry Brick Wall',
    targetSurfaceTypes: ['wall'],
    mappedInteriorWallFinish: 'exposed-brick',
    linkedP35MaterialId: 'mat-ext-clay-brick-cavity',
    octaveBandAbsorption: {
      125: 0.03,
      250: 0.03,
      500: 0.03,
      1000: 0.04,
      2000: 0.05,
      4000: 0.07,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Dense mortared clay brick masonry wall, unsealed or lightly sealed.',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Non-combustible masonry; mortar joints require dust sealing.',
    knownLimitations: [
      'Extremely reflective (alpha 0.03–0.05); parallel exposed brick walls can cause flutter echo and long reverberation times.',
    ],
  },
  {
    acousticMaterialId: 'ac-wall-acoustic-felt-panels',
    displayName: '24 mm Recycled PET Acoustic Felt Wall Panels',
    targetSurfaceTypes: ['wall', 'ceiling'],
    mappedInteriorWallFinish: 'acoustic-felt',
    linkedP35MaterialId: 'mat-int-acoustic-pet-felt',
    octaveBandAbsorption: {
      125: 0.12,
      250: 0.35,
      500: 0.65,
      1000: 0.85,
      2000: 0.90,
      4000: 0.90,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'manufacturer-or-lab-test',
    dataVersion: '2025.1',
    sourceMetadata: {
      ...P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
      title: 'Laboratory Reverberation Room Test Dataset — 24 mm High-Density Polyester Acoustic Felt (ISO 354 / ASTM C423)',
      testStandardOrConditions: 'ISO 354 Type A / E-50 mounting',
    },
    mountingOrTestConditions: '24 mm high-density (2400 g/m²) PET felt panel with 25 mm air gap.',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Requires verified ASTM E84 Class A / EN 13501-1 B-s1,d0 certification; vacuum maintenance.',
    knownLimitations: [
      'Lower absorption at 125 Hz unless mounted with a deep cavity or bass trap backing.',
      'Not recommended for direct splash zones in wet rooms (bathrooms/kitchens) where fibrous pores can trap moisture or grease (P35 compatibility constraint).',
    ],
  },

  // Floor Finishes (mapped to InteriorRoomConcept['floorFinish'])
  {
    acousticMaterialId: 'ac-floor-timber-plank',
    displayName: 'Engineered Oak / Walnut Timber Plank Flooring',
    targetSurfaceTypes: ['floor'],
    mappedInteriorFloorFinish: 'light-oak-plank',
    linkedP35MaterialId: 'mat-int-engineered-oak-floor',
    octaveBandAbsorption: {
      125: 0.10,
      250: 0.07,
      500: 0.06,
      1000: 0.06,
      2000: 0.06,
      4000: 0.06,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Tongue-and-groove timber flooring over underlayment on subfloor.',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Combustible timber wear layer; dry mop maintenance.',
    knownLimitations: [
      'Low airborne sound absorption; transmits footfall impact noise to rooms below unless paired with a tested acoustic underlayment.',
      'Unsuitable for wet rooms with standing water (see P35).',
    ],
  },
  {
    acousticMaterialId: 'ac-floor-smoked-walnut',
    displayName: 'Smoked Walnut Hardwood Flooring',
    targetSurfaceTypes: ['floor'],
    mappedInteriorFloorFinish: 'smoked-walnut',
    linkedP35MaterialId: 'mat-int-engineered-oak-floor',
    octaveBandAbsorption: {
      125: 0.09,
      250: 0.07,
      500: 0.06,
      1000: 0.06,
      2000: 0.06,
      4000: 0.06,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Hardwood plank floor over acoustic mat.',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Standard residential timber floor care.',
    knownLimitations: [
      'Reflective at speech frequencies; requires soft furnishings or ceiling treatment to control reverberation.',
    ],
  },
  {
    acousticMaterialId: 'ac-floor-polished-concrete',
    displayName: 'Power-Trowelled Polished Concrete Slab',
    targetSurfaceTypes: ['floor'],
    mappedInteriorFloorFinish: 'polished-concrete',
    linkedP35MaterialId: 'mat-int-polished-concrete-slab',
    octaveBandAbsorption: {
      125: 0.01,
      250: 0.01,
      500: 0.02,
      1000: 0.02,
      2000: 0.02,
      4000: 0.02,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Dense monolithic concrete floor slab.',
    moistureAndWetRoomSuitable: true,
    fireAndMaintenanceNote: 'Non-combustible; high durability; requires slip-resistance treatment in wet rooms.',
    knownLimitations: [
      'Near-total sound reflection (alpha 0.01–0.02) and high footfall click/impact noise without area rugs or ceiling absorption.',
    ],
  },
  {
    acousticMaterialId: 'ac-floor-honed-travertine-stone',
    displayName: 'Honed Travertine / Porcelain Stone Tile',
    targetSurfaceTypes: ['floor'],
    mappedInteriorFloorFinish: 'honed-travertine',
    linkedP35MaterialId: 'mat-int-porcelain-stone-tile',
    octaveBandAbsorption: {
      125: 0.02,
      250: 0.02,
      500: 0.02,
      1000: 0.03,
      2000: 0.03,
      4000: 0.03,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Mortar-set stone or porcelain tile on rigid slab.',
    moistureAndWetRoomSuitable: true,
    fireAndMaintenanceNote: 'Non-combustible Class A1; suitable for wet rooms.',
    knownLimitations: [
      'Very low sound absorption (alpha 0.02–0.03) and high impact noise transmission if unisolated on upper floors.',
    ],
  },
  {
    acousticMaterialId: 'ac-floor-terrazzo-aggregate',
    displayName: 'Resin or Cementitious Terrazzo Flooring',
    targetSurfaceTypes: ['floor'],
    mappedInteriorFloorFinish: 'terrazzo-aggregate',
    linkedP35MaterialId: 'mat-int-porcelain-stone-tile',
    octaveBandAbsorption: {
      125: 0.01,
      250: 0.01,
      500: 0.02,
      1000: 0.02,
      2000: 0.02,
      4000: 0.02,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Ground and polished terrazzo over concrete screed.',
    moistureAndWetRoomSuitable: true,
    fireAndMaintenanceNote: 'Non-combustible mineral aggregate; long service life.',
    knownLimitations: [
      'Highly reflective hard floor surface (alpha 0.01–0.02).',
    ],
  },
  {
    acousticMaterialId: 'ac-floor-tufted-carpet-underlay',
    displayName: 'Heavy Tufted Acoustic Carpet on Felt/Rubber Underlay',
    targetSurfaceTypes: ['floor'],
    octaveBandAbsorption: {
      125: 0.08,
      250: 0.22,
      500: 0.50,
      1000: 0.65,
      2000: 0.70,
      4000: 0.75,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Heavy pile carpet over hair-felt or high-density crumb-rubber underlay on concrete.',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Requires critical radiant flux fire test compliance; unsuitable for wet rooms.',
    knownLimitations: [
      'Incompatible with bathrooms, kitchens, and humid unconditioned spaces due to mold risk; high pile can increase wheelchair rolling resistance (P34 consideration).',
    ],
  },

  // Ceiling Treatments
  {
    acousticMaterialId: 'ac-ceil-exposed-joists',
    displayName: 'Exposed Timber Joists & Decking Ceiling',
    targetSurfaceTypes: ['ceiling'],
    mappedInteriorCeilingFinish: 'exposed-joists',
    octaveBandAbsorption: {
      125: 0.12,
      250: 0.09,
      500: 0.07,
      1000: 0.06,
      2000: 0.06,
      4000: 0.06,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Unlined timber joists and boarding.',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Requires char-rate/fire-protection review on multi-storey structures.',
    knownLimitations: [
      'Low sound absorption and poor floor-to-floor airborne/impact sound insulation unless an isolated acoustic ceiling is suspended.',
    ],
  },
  {
    acousticMaterialId: 'ac-ceil-recessed-cove-gypsum',
    displayName: 'Recessed Perimeter Cove Gypsum Ceiling',
    targetSurfaceTypes: ['ceiling'],
    mappedInteriorCeilingFinish: 'recessed-cove',
    octaveBandAbsorption: {
      125: 0.10,
      250: 0.08,
      500: 0.06,
      1000: 0.05,
      2000: 0.05,
      4000: 0.05,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Suspended gypsum board ceiling with plenum airspace.',
    moistureAndWetRoomSuitable: true,
    fireAndMaintenanceNote: 'Non-combustible gypsum board; use moisture-resistant green/cement board in wet rooms.',
    knownLimitations: [
      'Smooth gypsum remains acoustically reflective at mid/high frequencies unless perforated with acoustic fleece backing.',
    ],
  },
  {
    acousticMaterialId: 'ac-ceil-mineral-fiber-tile',
    displayName: 'Suspended High-Absorption Mineral Fiber Acoustic Ceiling Tile',
    targetSurfaceTypes: ['ceiling'],
    octaveBandAbsorption: {
      125: 0.35,
      250: 0.60,
      500: 0.80,
      1000: 0.85,
      2000: 0.85,
      4000: 0.80,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'manufacturer-or-lab-test',
    dataVersion: '2025.1',
    sourceMetadata: {
      ...P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
      title: 'Laboratory Reverberation Room Test Dataset — 20 mm Wet-Felted Mineral Fiber Ceiling Board (E-200 plenum mounting)',
      testStandardOrConditions: 'ISO 354 Type E-200 mounting (200 mm plenum)',
    },
    mountingOrTestConditions: '20 mm mineral fiber tile in T-grid with 200 mm plenum depth.',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Class A fire performance; standard tiles sag in high humidity unless humidity-resistant grade is specified.',
    knownLimitations: [
      'Requires 150–200 mm ceiling plenum height (reduces net clear ceiling height).',
      'Standard mineral fiber is not suitable for unventilated wet rooms with steam/condensation.',
    ],
  },
  {
    acousticMaterialId: 'ac-ceil-moisture-resistant-perforated-gypsum',
    displayName: 'Moisture-Resistant Perforated Gypsum Board with Hydrophobic Acoustic Fleece',
    targetSurfaceTypes: ['ceiling', 'wall'],
    octaveBandAbsorption: {
      125: 0.30,
      250: 0.55,
      500: 0.70,
      1000: 0.65,
      2000: 0.55,
      4000: 0.45,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'manufacturer-or-lab-test',
    dataVersion: '2025.1',
    sourceMetadata: {
      ...P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
      title: 'Laboratory Test Dataset — Perforated Moisture-Resistant Gypsum Ceiling with Acoustic Fleece Backing',
      testStandardOrConditions: 'ISO 354 Type E-100 mounting',
    },
    mountingOrTestConditions: '12.5 mm perforated moisture-resistant gypsum board with non-woven acoustic fleece over 100 mm cavity.',
    moistureAndWetRoomSuitable: true,
    fireAndMaintenanceNote: 'Non-combustible gypsum; suitable for humid climates, kitchens, and bathrooms with mechanical extraction.',
    knownLimitations: [
      'Requires 100 mm suspension cavity; painting must use roller only so perforations and acoustic fleece are not clogged.',
    ],
  },

  // Doors and Windows (for opening surface accounting in Sabine equation)
  {
    acousticMaterialId: 'ac-open-solid-timber-door',
    displayName: 'Solid-Core Timber Interior Door Leaf',
    targetSurfaceTypes: ['door'],
    octaveBandAbsorption: {
      125: 0.14,
      250: 0.10,
      500: 0.06,
      1000: 0.08,
      2000: 0.10,
      4000: 0.10,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Closed solid timber door leaf in frame.',
    moistureAndWetRoomSuitable: true,
    fireAndMaintenanceNote: 'Verify fire-door self-closer and perimeter seal compatibility with P34 opening force limits.',
    knownLimitations: [
      'Sound insulation depends heavily on perimeter compression seals and drop-down threshold seals.',
    ],
  },
  {
    acousticMaterialId: 'ac-open-double-glazing-window',
    displayName: 'Double-Glazed Insulated Glass Unit (IGU)',
    targetSurfaceTypes: ['window'],
    linkedP35MaterialId: 'mat-glaze-double-lowe-thermally-broken',
    octaveBandAbsorption: {
      125: 0.15,
      250: 0.08,
      500: 0.04,
      1000: 0.03,
      2000: 0.02,
      4000: 0.02,
    },
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands',
    provenance: 'traceable-generic-reference',
    dataVersion: '2025.1',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    mountingOrTestConditions: 'Sealed double-glazed window assembly.',
    moistureAndWetRoomSuitable: true,
    fireAndMaintenanceNote: 'Tempering/lamination required near floor level.',
    knownLimitations: [
      'Highly reflective at mid and high frequencies (alpha 0.02–0.04); large floor-to-ceiling glazing significantly increases room reverberation.',
    ],
  },

  // Explicitly Unverified / Missing-Coefficient Record (enforces Section 5.3 & 7A rule: never fabricate coefficients)
  {
    acousticMaterialId: 'ac-mat-unverified-custom-finish',
    displayName: 'Unverified Architectural Surface (No Documented Absorption Data)',
    targetSurfaceTypes: ['ceiling', 'wall', 'floor'],
    octaveBandAbsorption: {
      125: null,
      250: null,
      500: null,
      1000: null,
      2000: null,
      4000: null,
    },
    applicableFrequencyRange: 'Unavailable — requires laboratory test report (ISO 354 / ASTM C423)',
    provenance: 'unavailable-or-unverified',
    dataVersion: '2025.1',
    sourceMetadata: {
      sourceId: 'unverified-surface-placeholder',
      publisher: 'Plotify Epistemic Integrity Guard',
      title: 'Undocumented Material Record',
      editionOrYear: '2026',
      urlOrIdentifier: 'internal://unverified-acoustic-property',
      accessOrReviewDate: '2026-10-26',
      applicabilityNote:
        'Used when a surface material has no documented frequency-dependent absorption coefficients. Prevents silent substitution of fabricated numbers.',
      licenceOrUsageNote: 'Internal safeguard.',
    },
    mountingOrTestConditions: 'Unknown mounting and backing conditions.',
    moistureAndWetRoomSuitable: false,
    fireAndMaintenanceNote: 'Requires manufacturer specification sheet.',
    knownLimitations: [
      'No octave-band absorption coefficients are documented; Sabine reverberation cannot be calculated with confidence until verified data is supplied.',
    ],
  },
];

/**
 * Curated catalogue of partition, floor/ceiling slab, door, and glazing assemblies for Domain D & Domain E.
 * Enforces Section 7 Domain D rule:
 * "Never assign a tested STC, Rw, or other sound-insulation rating from a generic label such as 'brick wall,' 'double glazing,' or 'acoustic panel.'
 *  Never treat a laboratory rating of one component as proof of complete as-built building performance."
 */
export const REFERENCE_ACOUSTIC_ASSEMBLIES: AcousticAssemblyRecord[] = [
  {
    assemblyId: 'asm-part-generic-unverified-wall',
    displayName: 'Generic Interior Wall / Partition (No Verified Acoustic Test Rating)',
    elementKind: 'interior-partition',
    constructionDescription: 'Generic architectural wall label (e.g. "brick wall" or "stud wall") without a specific assembly test report, mass per unit area, cavity insulation spec, or junction detail.',
    labAirborneRatingDb: null,
    airborneRatingMetric: 'unavailable',
    labImpactRatingDb: null,
    impactRatingMetric: 'unavailable',
    provenance: 'unavailable-or-unverified',
    isComponentLabRatingOnly: true,
    hasVerifiedPerimeterAcousticSeals: false,
    hasVerifiedJunctionFlankingDetails: false,
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_12354_1_2017,
    limitationsAndFlankingNotes: [
      'Plotify refuses to invent an STC or Rw rating from a generic wall label.',
      'Actual airborne sound insulation requires full assembly specification (board layers, stud decoupling, cavity density, perimeter sealant, and flanking junction details).',
    ],
  },
  {
    assemblyId: 'asm-part-single-stud-uninsulated-lab',
    displayName: 'Single Steel/Timber Stud Partition — 1×12.5 mm Gypsum Each Side (Uninsulated Cavity)',
    elementKind: 'interior-partition',
    constructionDescription: '70–90 mm single stud frame with single layer 12.5 mm gypsum board each side, empty cavity, perimeter caulked in laboratory test frame.',
    labAirborneRatingDb: 35,
    airborneRatingMetric: 'Rw',
    labImpactRatingDb: null,
    impactRatingMetric: 'unavailable',
    provenance: 'traceable-generic-reference',
    isComponentLabRatingOnly: true,
    hasVerifiedPerimeterAcousticSeals: false,
    hasVerifiedJunctionFlankingDetails: false,
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_717_1_2020,
    limitationsAndFlankingNotes: [
      'Laboratory element rating only (Rw ≈ 35 dB); in-situ field performance (DnT,w / ASTC) is typically 3–8 dB lower due to flanking transmission at continuous floors/ceilings and back-to-back electrical outlets.',
      'Insufficient for confidential speech privacy or bedroom-to-living acoustic separation.',
    ],
  },
  {
    assemblyId: 'asm-part-double-stud-insulated-lab',
    displayName: 'Staggered/Double Stud Acoustic Partition — 2×12.5 mm Gypsum Each Side + 100 mm Mineral Wool',
    elementKind: 'interior-partition',
    constructionDescription: 'Decoupled double stud frame with two layers of 12.5 mm acoustic gypsum board each side, 100 mm mineral wool cavity absorption, and flexible perimeter acoustic sealant.',
    labAirborneRatingDb: 54,
    airborneRatingMetric: 'Rw',
    labImpactRatingDb: null,
    impactRatingMetric: 'unavailable',
    provenance: 'manufacturer-or-lab-test',
    isComponentLabRatingOnly: true,
    hasVerifiedPerimeterAcousticSeals: true,
    hasVerifiedJunctionFlankingDetails: false,
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_12354_1_2017,
    limitationsAndFlankingNotes: [
      'Laboratory component rating (Rw 54 dB) does NOT guarantee as-built building performance unless partition extends slab-to-slab (or plenum barriers are installed), flanking junctions are isolated, and penetrations are sealed.',
      'If a hollow-core or unsealed door is installed in this wall, the composite wall+door insulation drops drastically (often below 25–30 dB).',
    ],
  },
  {
    assemblyId: 'asm-door-generic-unsealed',
    displayName: 'Standard Interior Door with Threshold Undercut (No Acoustic Seals)',
    elementKind: 'interior-door',
    constructionDescription: 'Standard hollow or light core interior door with a 10–15 mm bottom air gap/undercut and unsealed frame.',
    labAirborneRatingDb: null,
    airborneRatingMetric: 'unavailable',
    labImpactRatingDb: null,
    impactRatingMetric: 'unavailable',
    provenance: 'unavailable-or-unverified',
    isComponentLabRatingOnly: true,
    hasVerifiedPerimeterAcousticSeals: false,
    hasAcousticDoorDropSeal: false,
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_12354_1_2017,
    limitationsAndFlankingNotes: [
      'Unsealed perimeter gaps and bottom door undercuts provide a direct airborne sound leakage path that bypasses high-performance partitions.',
    ],
  },
  {
    assemblyId: 'asm-door-solid-core-drop-seal-lab',
    displayName: 'Acoustic Solid-Core Timber Door Set with Perimeter Seals & Automatic Drop Threshold Seal',
    elementKind: 'interior-door',
    constructionDescription: '44 mm solid engineered acoustic core door leaf with continuous perimeter compression gaskets and automatic mechanical bottom drop seal.',
    labAirborneRatingDb: 35,
    airborneRatingMetric: 'Rw',
    labImpactRatingDb: null,
    impactRatingMetric: 'unavailable',
    provenance: 'manufacturer-or-lab-test',
    isComponentLabRatingOnly: true,
    hasVerifiedPerimeterAcousticSeals: true,
    hasAcousticDoorDropSeal: true,
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_717_1_2020,
    limitationsAndFlankingNotes: [
      'Component laboratory rating (Rw 35 dB) requires flush threshold contact for the drop seal and grouted/sealed door frame.',
      'Coordinate door closer latch force and threshold profile with P34 Universal Accessibility requirements (max threshold height and single-hand operable hardware).',
    ],
  },
  {
    assemblyId: 'asm-glaze-generic-double-unverified',
    displayName: 'Generic Exterior Double Glazing (No Verified Acoustic Rw/STC Test Data)',
    elementKind: 'exterior-facade-glazing',
    constructionDescription: 'Generic "double glazing" label without glass pane thicknesses, acoustic PVB interlayer specification, or trickle-vent attenuation data.',
    labAirborneRatingDb: null,
    airborneRatingMetric: 'unavailable',
    labImpactRatingDb: null,
    impactRatingMetric: 'unavailable',
    provenance: 'unavailable-or-unverified',
    isComponentLabRatingOnly: true,
    hasVerifiedPerimeterAcousticSeals: false,
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_12354_1_2017,
    limitationsAndFlankingNotes: [
      'Never assume a specific STC or Rw rating from the generic phrase "double glazing"; symmetrical thin panes suffer from coincidence dip and mass-air-mass resonance.',
    ],
  },
  {
    assemblyId: 'asm-glaze-asymmetric-laminated-acoustic-lab',
    displayName: 'Asymmetric Laminated Acoustic Glazing (10.8 mm Acoustic PVB / 16 mm Argon / 6 mm)',
    elementKind: 'exterior-facade-glazing',
    constructionDescription: 'Thermally broken frame with asymmetric laminated outer pane (acoustic damping interlayer) and compression-gasketed operable sashes.',
    labAirborneRatingDb: 41,
    airborneRatingMetric: 'Rw',
    labImpactRatingDb: null,
    impactRatingMetric: 'unavailable',
    provenance: 'manufacturer-or-lab-test',
    isComponentLabRatingOnly: true,
    hasVerifiedPerimeterAcousticSeals: true,
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_717_1_2020,
    limitationsAndFlankingNotes: [
      'Laboratory window rating (Rw 41 dB) applies ONLY when windows are closed and latched; unattenuated facade trickle vents or open windows for natural ventilation will bypass glazing sound insulation.',
    ],
  },
  {
    assemblyId: 'asm-slab-generic-unverified-floor',
    displayName: 'Standard Floor/Ceiling Slab (No Verified Impact or Airborne Test Data)',
    elementKind: 'floor-ceiling-slab',
    constructionDescription: 'Floor structure without documented impact insulation mat, floating screed, or suspended isolation ceiling details.',
    labAirborneRatingDb: null,
    airborneRatingMetric: 'unavailable',
    labImpactRatingDb: null,
    impactRatingMetric: 'unavailable',
    provenance: 'unavailable-or-unverified',
    isComponentLabRatingOnly: true,
    hasVerifiedJunctionFlankingDetails: false,
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_12354_1_2017,
    limitationsAndFlankingNotes: [
      'Hard floor finishes (concrete, stone, timber) installed directly on an unisolated slab transmit footfall impact and structure-borne sound to rooms below.',
    ],
  },
  {
    assemblyId: 'asm-slab-floating-screed-resilient-mat-lab',
    displayName: '200 mm RC Slab + Floating Screed on 10 mm Elastomeric Acoustic Mat + Suspended Ceiling',
    elementKind: 'floor-ceiling-slab',
    constructionDescription: '200 mm reinforced concrete structural slab with perimeter-isolated floating screed over resilient acoustic underlayment and resilient-hanger gypsum ceiling below.',
    labAirborneRatingDb: 58,
    airborneRatingMetric: 'Rw',
    labImpactRatingDb: 46,
    impactRatingMetric: 'Ln,w',
    provenance: 'manufacturer-or-lab-test',
    isComponentLabRatingOnly: true,
    hasVerifiedPerimeterAcousticSeals: true,
    hasVerifiedJunctionFlankingDetails: false,
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_12354_1_2017,
    limitationsAndFlankingNotes: [
      'Note: For weighted normalized impact sound pressure level (Ln,w), lower dB values indicate quieter impact transmission. Field performance depends strictly on avoiding mortar bridges or skirting-board contact across the perimeter isolation strip.',
    ],
  },
];

/**
 * Configurable reference criteria per functional room use profile (P36 Section 8).
 * Explicitly marked as 'advisory-reference' — never falsely presented as universal statutory building regulations.
 */
export const DEFAULT_CONFIGURED_ACOUSTIC_CRITERIA: ConfiguredAcousticCriterion[] = [
  {
    criterionId: 'crit-rt60-bedroom-residential',
    roomUseProfileId: 'bedroom-residential',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Bedroom / Sleeping Space — Mid-Frequency Reverberation Target (500–1000 Hz)',
    minTarget: 0.3,
    maxTarget: 0.5,
    unit: 's',
    frequencyScopeNote: 'Arithmetic mean of 500 Hz and 1000 Hz octave-band Sabine RT60 estimates',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Architectural Acoustic Reference Profile (ASHRAE Ch. 8 / ISO 3382-2 context)',
    applicabilityConditions: 'Furnished residential bedroom of ordinary volume (25–80 m³)',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory design guidance for restful domestic acoustics; not a mandatory building code limit unless adopted by local jurisdiction.',
  },
  {
    criterionId: 'crit-noise-bedroom-residential',
    roomUseProfileId: 'bedroom-residential',
    metric: 'background-noise-laeq-dba',
    label: 'Bedroom / Sleeping Space — Indoor Steady Background Noise Reference',
    minTarget: null,
    maxTarget: 30,
    unit: 'dBA',
    frequencyScopeNote: 'Broadband A-weighted equivalent continuous sound level (LAeq)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Interior Acoustic Comfort Reference (ASHRAE Ch. 8)',
    applicabilityConditions: 'Unoccupied indoor sleeping space with HVAC operating at design flow and windows closed',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory indoor comfort target (30 dBA). Distinct from WHO outdoor environmental noise exposure guidelines.',
  },
  {
    criterionId: 'crit-rt60-living-residential',
    roomUseProfileId: 'living-residential',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Residential Living / Lounge — Mid-Frequency Reverberation Target',
    minTarget: 0.35,
    maxTarget: 0.6,
    unit: 's',
    frequencyScopeNote: '500–1000 Hz octave-band mean Sabine RT60',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Architectural Acoustic Reference Profile',
    applicabilityConditions: 'Domestic living, family, or lounge room (40–150 m³)',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory comfort range balancing conversational clarity and domestic warmth.',
  },
  {
    criterionId: 'crit-noise-living-residential',
    roomUseProfileId: 'living-residential',
    metric: 'background-noise-laeq-dba',
    label: 'Residential Living / Lounge — Indoor Background Noise Reference',
    minTarget: null,
    maxTarget: 35,
    unit: 'dBA',
    frequencyScopeNote: 'Indoor steady LAeq (dBA)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Interior Acoustic Comfort Reference (ASHRAE Ch. 8)',
    applicabilityConditions: 'Indoor residential living room during daytime/evening occupancy',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory comfort target.',
  },
  {
    criterionId: 'crit-rt60-home-office-focused',
    roomUseProfileId: 'home-office-focused',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Home Office / Focused Work — Mid-Frequency Reverberation Target',
    minTarget: 0.25,
    maxTarget: 0.5,
    unit: 's',
    frequencyScopeNote: '500–1000 Hz octave-band mean Sabine RT60',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Architectural Acoustic Reference Profile',
    applicabilityConditions: 'Private study, home office, or video-conferencing room',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target to minimize hollow room coloration on voice calls and support concentration.',
  },
  {
    criterionId: 'crit-noise-home-office-focused',
    roomUseProfileId: 'home-office-focused',
    metric: 'background-noise-laeq-dba',
    label: 'Home Office / Focused Work — Indoor Background Noise Reference',
    minTarget: null,
    maxTarget: 35,
    unit: 'dBA',
    frequencyScopeNote: 'Indoor steady LAeq (dBA)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Interior Acoustic Comfort Reference (ASHRAE Ch. 8)',
    applicabilityConditions: 'Private office or study room',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target.',
  },
  {
    criterionId: 'crit-rt60-meeting-room',
    roomUseProfileId: 'meeting-room',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Meeting / Conference Room — Mid-Frequency Reverberation Target',
    minTarget: 0.3,
    maxTarget: 0.5,
    unit: 's',
    frequencyScopeNote: '500–1000 Hz octave-band mean Sabine RT60',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Architectural Acoustic Reference Profile',
    applicabilityConditions: 'Small-to-medium meeting or conference room (<150 m³)',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target for clear multi-person speech communication.',
  },
  {
    criterionId: 'crit-noise-meeting-room',
    roomUseProfileId: 'meeting-room',
    metric: 'background-noise-laeq-dba',
    label: 'Meeting / Conference Room — Indoor Background Noise Reference',
    minTarget: null,
    maxTarget: 35,
    unit: 'dBA',
    frequencyScopeNote: 'Indoor steady LAeq (dBA)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Interior Acoustic Comfort Reference (ASHRAE Ch. 8)',
    applicabilityConditions: 'Enclosed meeting room',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target.',
  },
  {
    criterionId: 'crit-rt60-classroom-learning',
    roomUseProfileId: 'classroom-learning',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Classroom / Learning Space — Mid-Frequency Reverberation Target',
    minTarget: 0.35,
    maxTarget: 0.55,
    unit: 's',
    frequencyScopeNote: '500–1000 Hz octave-band mean Sabine RT60',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Educational Acoustic Reference Profile',
    applicabilityConditions: 'General learning or seminar room up to 250 m³',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory screening target; check local educational building standards (e.g. ANSI/ASA S12.60 or BB93) where legally mandated.',
  },
  {
    criterionId: 'crit-noise-classroom-learning',
    roomUseProfileId: 'classroom-learning',
    metric: 'background-noise-laeq-dba',
    label: 'Classroom / Learning Space — Indoor Background Noise Reference',
    minTarget: null,
    maxTarget: 35,
    unit: 'dBA',
    frequencyScopeNote: 'Unoccupied indoor steady LAeq (dBA)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Educational Acoustic Reference Profile',
    applicabilityConditions: 'Unoccupied classroom with building services running',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target.',
  },
  {
    criterionId: 'crit-rt60-healthcare-consultation',
    roomUseProfileId: 'healthcare-consultation',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Healthcare / Consultation Room — Mid-Frequency Reverberation Target',
    minTarget: 0.3,
    maxTarget: 0.5,
    unit: 's',
    frequencyScopeNote: '500–1000 Hz octave-band mean Sabine RT60',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Healthcare Consultation Reference Profile',
    applicabilityConditions: 'Clinical examination or private consultation room',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target supporting speech clarity and low patient stress; coordinate with infection-control cleanability requirements.',
  },
  {
    criterionId: 'crit-noise-healthcare-consultation',
    roomUseProfileId: 'healthcare-consultation',
    metric: 'background-noise-laeq-dba',
    label: 'Healthcare / Consultation Room — Indoor Background Noise Reference',
    minTarget: null,
    maxTarget: 35,
    unit: 'dBA',
    frequencyScopeNote: 'Indoor steady LAeq (dBA)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Healthcare Reference Profile',
    applicabilityConditions: 'Private consultation room',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target.',
  },
  {
    criterionId: 'crit-rt60-restaurant-communal-dining',
    roomUseProfileId: 'restaurant-communal-dining',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Dining / Communal Area — Mid-Frequency Reverberation Target',
    minTarget: 0.4,
    maxTarget: 0.7,
    unit: 's',
    frequencyScopeNote: '500–1000 Hz octave-band mean Sabine RT60',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Dining Acoustic Reference Profile',
    applicabilityConditions: 'Residential dining room, café, or communal dining space',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target to mitigate Lombard effect (progressive vocal effort escalation in reverberant dining spaces).',
  },
  {
    criterionId: 'crit-noise-restaurant-communal-dining',
    roomUseProfileId: 'restaurant-communal-dining',
    metric: 'background-noise-laeq-dba',
    label: 'Dining / Communal Area — Unoccupied Background Services Noise Reference',
    minTarget: null,
    maxTarget: 42,
    unit: 'dBA',
    frequencyScopeNote: 'Indoor steady HVAC/appliance LAeq (dBA)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Dining Reference Profile',
    applicabilityConditions: 'Unoccupied dining area with kitchen extraction/HVAC active',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target.',
  },
  {
    criterionId: 'crit-rt60-reception-circulation',
    roomUseProfileId: 'reception-circulation',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Reception / Circulation / Lobby — Mid-Frequency Reverberation Target',
    minTarget: 0.4,
    maxTarget: 0.8,
    unit: 's',
    frequencyScopeNote: '500–1000 Hz octave-band mean Sabine RT60',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Circulation Reference Profile',
    applicabilityConditions: 'Entry lobby, corridor, or reception zone',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target.',
  },
  {
    criterionId: 'crit-noise-reception-circulation',
    roomUseProfileId: 'reception-circulation',
    metric: 'background-noise-laeq-dba',
    label: 'Reception / Circulation — Background Noise Reference',
    minTarget: null,
    maxTarget: 45,
    unit: 'dBA',
    frequencyScopeNote: 'Indoor steady LAeq (dBA)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Circulation Reference Profile',
    applicabilityConditions: 'Reception or circulation zone',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target.',
  },
  {
    criterionId: 'crit-rt60-music-performance',
    roomUseProfileId: 'music-performance',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Music Practice / Chamber Rehearsal — Mid-Frequency Reverberation Target',
    minTarget: 0.6,
    maxTarget: 1.1,
    unit: 's',
    frequencyScopeNote: '500–1000 Hz octave-band mean Sabine RT60',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Music Room Reference Profile',
    applicabilityConditions: 'Small acoustic music rehearsal or listening room (requires specialist modal & bass-ratio review)',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory screening range; small music rooms are strongly governed by low-frequency room modes below the Schroeder frequency where Sabine equations do not apply.',
  },
  {
    criterionId: 'crit-noise-music-performance',
    roomUseProfileId: 'music-performance',
    metric: 'background-noise-laeq-dba',
    label: 'Music Practice / Performance — Background Noise Reference',
    minTarget: null,
    maxTarget: 28,
    unit: 'dBA',
    frequencyScopeNote: 'Indoor steady LAeq (dBA)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Music Room Reference Profile',
    applicabilityConditions: 'Unoccupied music space',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target.',
  },
  {
    criterionId: 'crit-rt60-service-utility-wet',
    roomUseProfileId: 'service-utility-wet',
    metric: 'mid-frequency-rt60-seconds',
    label: 'Kitchen / Bathroom / Utility Wet Room — Mid-Frequency Reverberation Reference',
    minTarget: 0.4,
    maxTarget: 0.85,
    unit: 's',
    frequencyScopeNote: '500–1000 Hz octave-band mean Sabine RT60',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Wet/Service Room Reference Profile',
    applicabilityConditions: 'Bathroom, kitchen, laundry, or utility room',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory reference; moisture resistance and hygiene take precedence over porous absorption in wet zones.',
  },
  {
    criterionId: 'crit-noise-service-utility-wet',
    roomUseProfileId: 'service-utility-wet',
    metric: 'background-noise-laeq-dba',
    label: 'Kitchen / Bathroom / Utility — Background Noise Reference',
    minTarget: null,
    maxTarget: 45,
    unit: 'dBA',
    frequencyScopeNote: 'Indoor steady LAeq (dBA)',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Service Room Reference Profile',
    applicabilityConditions: 'Service or wet room with intermittent exhaust extraction',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
    verificationAndCompletenessNote: 'Advisory target.',
  },
  {
    criterionId: 'crit-insulation-default-partition',
    roomUseProfileId: 'bedroom-residential',
    metric: 'partition-airborne-insulation-db',
    label: 'Privacy-Sensitive Partition — Minimum Airborne Sound Insulation Screening Target',
    minTarget: 45,
    maxTarget: 65,
    unit: 'dB',
    frequencyScopeNote: 'Weighted sound reduction index Rw / STC screening reference',
    authorityStatus: 'advisory-reference',
    jurisdictionOrStandard: 'Non-statutory Acoustic Privacy Screening Target (ISO 717-1 / ASHRAE Ch. 8)',
    applicabilityConditions: 'Partitions separating bedrooms, offices, meeting rooms, or consultation rooms from active zones',
    versionOrDate: '2025.1',
    provenance: 'traceable-generic-reference',
    sourceMetadata: P36_TECHNICAL_REFERENCES.ISO_717_1_2020,
    verificationAndCompletenessNote: 'Screening target only; laboratory Rw/STC must be derated for in-situ flanking transmission per ISO 12354-1.',
  },
];

/**
 * Infers an initial functional room-use profile from Plotify's FloorPlanRoom type/name.
 */
export function inferDefaultFunctionalUseProfile(
  room: FloorPlanRoom
): FunctionalRoomUseProfileId {
  const t = `${room.type} ${room.name}`.toLowerCase();
  if (t.includes('bed') || t.includes('master') || t.includes('guest') || t.includes('nursery')) {
    return 'bedroom-residential';
  }
  if (t.includes('office') || t.includes('study') || t.includes('library') || t.includes('work')) {
    return 'home-office-focused';
  }
  if (t.includes('meet') || t.includes('conference') || t.includes('board')) {
    return 'meeting-room';
  }
  if (t.includes('class') || t.includes('seminar') || t.includes('lecture')) {
    return 'classroom-learning';
  }
  if (t.includes('clinic') || t.includes('consult') || t.includes('exam') || t.includes('medical')) {
    return 'healthcare-consultation';
  }
  if (t.includes('music') || t.includes('studio') || t.includes('rehearsal') || t.includes('theater') || t.includes('cinema')) {
    return 'music-performance';
  }
  if (t.includes('dining') || t.includes('cafe') || t.includes('restaurant')) {
    return 'restaurant-communal-dining';
  }
  if (t.includes('bath') || t.includes('wc') || t.includes('toilet') || t.includes('kitchen') || t.includes('laundry') || t.includes('utility') || t.includes('garage')) {
    return 'service-utility-wet';
  }
  if (t.includes('foyer') || t.includes('lobby') || t.includes('hall') || t.includes('corridor') || t.includes('entry') || t.includes('reception')) {
    return 'reception-circulation';
  }
  return 'living-residential';
}

export function getFunctionalProfileLabel(profileId: FunctionalRoomUseProfileId): string {
  switch (profileId) {
    case 'bedroom-residential':
      return 'Bedroom / Quiet Sleeping Space';
    case 'living-residential':
      return 'Residential Living / Family Lounge';
    case 'home-office-focused':
      return 'Home Office / Focused Study';
    case 'meeting-room':
      return 'Meeting / Conference Room';
    case 'classroom-learning':
      return 'Classroom / Learning Space';
    case 'healthcare-consultation':
      return 'Healthcare / Consultation Room';
    case 'restaurant-communal-dining':
      return 'Dining / Communal Gathering Area';
    case 'reception-circulation':
      return 'Reception / Circulation / Lobby';
    case 'music-performance':
      return 'Music Practice / Performance Space';
    case 'service-utility-wet':
      return 'Kitchen / Bathroom / Service Wet Zone';
  }
}

export function isNoiseSensitiveProfile(profileId: FunctionalRoomUseProfileId): boolean {
  return (
    profileId === 'bedroom-residential' ||
    profileId === 'home-office-focused' ||
    profileId === 'meeting-room' ||
    profileId === 'classroom-learning' ||
    profileId === 'healthcare-consultation' ||
    profileId === 'music-performance'
  );
}

export function isNoisyActivityProfile(profileId: FunctionalRoomUseProfileId): boolean {
  return (
    profileId === 'service-utility-wet' ||
    profileId === 'restaurant-communal-dining' ||
    profileId === 'reception-circulation' ||
    profileId === 'living-residential' ||
    profileId === 'music-performance'
  );
}

/**
 * Creates a default RoomAcousticConfig for a given room.
 * Note: Plotify's 2D FloorPlanRoom does NOT store ceilingHeight, so ceilingHeight defaults to null
 * ('unavailable-or-unverified') until configured by the user, preserving strict epistemic honesty.
 */
export function createDefaultRoomAcousticConfig(
  project: Project,
  room: FloorPlanRoom
): RoomAcousticConfig {
  const profile = inferDefaultFunctionalUseProfile(room);
  const priorities: AcousticPriorityTag[] = [];
  if (profile === 'bedroom-residential') {
    priorities.push('sleep-and-quiet-rest', 'hvac-plant-quietness');
  } else if (profile === 'home-office-focused' || profile === 'meeting-room') {
    priorities.push('speech-clarity', 'confidential-speech-privacy', 'focused-concentration');
  } else if (profile === 'classroom-learning' || profile === 'healthcare-consultation') {
    priorities.push('speech-clarity', 'confidential-speech-privacy');
  } else if (profile === 'music-performance') {
    priorities.push('lively-musical-warmth', 'reverberation-control');
  } else {
    priorities.push('reverberation-control', 'speech-clarity');
  }

  return {
    roomId: room.id,
    functionalUseProfile: profile,
    acousticPriorities: priorities,
    geometryShape: 'rectangle',
    ceilingHeight: null,
    heightUnit: project.unit,
    ceilingHeightProvenance: 'unavailable-or-unverified',
    occupantCountAssumption: null,
    occupantProvenance: 'unavailable-or-unverified',
    updatedAt: project.updatedAt || new Date().toISOString(),
  };
}

/**
 * Initializes or normalizes `ProjectAcousticPlannerData` on a project without mutating upstream data.
 * New or unconfigured projects start with `isConfigured: false` and `ceilingHeight: null` so
 * missing inputs are transparently disclosed rather than silently fabricated.
 */
export function initializeProjectAcousticPlannerData(
  project: Project
): ProjectAcousticPlannerData {
  const rooms = project.floorPlan?.rooms || [];
  const existing = project.acousticPlanner;

  const roomConfigs: Record<string, RoomAcousticConfig> = {};
  for (const room of rooms) {
    const saved = existing?.roomConfigs?.[room.id];
    if (saved && typeof saved === 'object') {
      roomConfigs[room.id] = {
        ...createDefaultRoomAcousticConfig(project, room),
        ...saved,
        roomId: room.id,
        geometryShape:
          saved.geometryShape === 'irregular-polygon-unsupported'
            ? 'irregular-polygon-unsupported'
            : 'rectangle',
        heightUnit: saved.heightUnit === 'feet' || saved.heightUnit === 'metres' ? saved.heightUnit : project.unit,
      };
    } else {
      roomConfigs[room.id] = createDefaultRoomAcousticConfig(project, room);
    }
  }

  // Also preserve any explicitly saved roomConfigs for custom test rooms
  if (existing?.roomConfigs) {
    for (const [rId, cfg] of Object.entries(existing.roomConfigs)) {
      if (!roomConfigs[rId] && cfg && typeof cfg === 'object') {
        roomConfigs[rId] = cfg;
      }
    }
  }

  const firstRoomId = rooms[0]?.id;
  const selectedRoomId =
    existing?.selectedRoomId && rooms.some((r) => r.id === existing.selectedRoomId)
      ? existing.selectedRoomId
      : firstRoomId;

  return {
    schemaVersion: P36_ACOUSTIC_SCHEMA_VERSION,
    calculationModelVersion: P36_ACOUSTIC_PLANNER_ENGINE_VERSION,
    isConfigured: Boolean(existing?.isConfigured),
    selectedRoomId,
    roomConfigs,
    noiseObservations: Array.isArray(existing?.noiseObservations)
      ? existing.noiseObservations.filter((n) => n && typeof n.observationId === 'string')
      : [],
    measuredRt60Records:
      existing?.measuredRt60Records && typeof existing.measuredRt60Records === 'object'
        ? { ...existing.measuredRt60Records }
        : {},
    customAcousticMaterials: Array.isArray(existing?.customAcousticMaterials)
      ? existing.customAcousticMaterials
      : [],
    customAcousticAssemblies: Array.isArray(existing?.customAcousticAssemblies)
      ? existing.customAcousticAssemblies
      : [],
    customCriteriaOverrides: Array.isArray(existing?.customCriteriaOverrides)
      ? existing.customCriteriaOverrides
      : [],
    lastEvaluatedAt: existing?.lastEvaluatedAt,
    lastSourceFingerprint: existing?.lastSourceFingerprint,
    lastPreApplySnapshotId: existing?.lastPreApplySnapshotId,
    requestSequenceId:
      typeof existing?.requestSequenceId === 'number' && Number.isFinite(existing.requestSequenceId)
        ? existing.requestSequenceId
        : 1,
  };
}

/**
 * Returns all available acoustic surface materials (reference catalogue + validated custom materials).
 */
export function getAllAcousticSurfaceMaterials(
  project?: Project,
  plannerData?: ProjectAcousticPlannerData
): AcousticSurfaceMaterialRecord[] {
  const custom = plannerData?.customAcousticMaterials || project?.acousticPlanner?.customAcousticMaterials || [];
  return [...REFERENCE_ACOUSTIC_SURFACE_MATERIALS, ...custom];
}

/**
 * Returns all available acoustic assemblies (reference catalogue + custom assemblies).
 */
export function getAllAcousticAssemblies(
  project?: Project,
  plannerData?: ProjectAcousticPlannerData
): AcousticAssemblyRecord[] {
  const custom = plannerData?.customAcousticAssemblies || project?.acousticPlanner?.customAcousticAssemblies || [];
  return [...REFERENCE_ACOUSTIC_ASSEMBLIES, ...custom];
}

/**
 * Validates and normalizes a user-submitted custom acoustic surface material.
 * Enforces P36 Section 6:
 * - Rejects non-finite, negative, or >1.0 absorption coefficients.
 * - Forces provenance to 'user-entered' (never promotes user input to 'manufacturer-or-lab-test').
 */
export function validateAndNormalizeCustomAcousticMaterial(
  input: Partial<AcousticSurfaceMaterialRecord>,
  existingMaterials: AcousticSurfaceMaterialRecord[] = REFERENCE_ACOUSTIC_SURFACE_MATERIALS
): {
  isValid: boolean;
  errors: string[];
  normalizedMaterial?: AcousticSurfaceMaterialRecord;
} {
  const errors: string[] = [];

  const id = (input.acousticMaterialId || '').trim();
  const name = (input.displayName || '').trim();

  if (!id) {
    errors.push('Material ID is required.');
  } else if (existingMaterials.some((m) => m.acousticMaterialId === id)) {
    errors.push(`A material with ID "${id}" already exists in the catalogue.`);
  }

  if (!name || name.length > 140) {
    errors.push('Display name is required and must be 1–140 characters.');
  }

  const surfaceTypes = Array.isArray(input.targetSurfaceTypes)
    ? input.targetSurfaceTypes.filter((t) =>
        ['ceiling', 'wall', 'floor', 'door', 'window'].includes(t)
      )
    : [];
  if (surfaceTypes.length === 0) {
    errors.push('At least one valid target surface type (ceiling, wall, floor, door, window) is required.');
  }

  const normalizedBands: OctaveBandCoefficients = {
    125: null,
    250: null,
    500: null,
    1000: null,
    2000: null,
    4000: null,
  };

  if (input.octaveBandAbsorption && typeof input.octaveBandAbsorption === 'object') {
    for (const band of OCTAVE_BANDS_HZ) {
      const rawVal = input.octaveBandAbsorption[band];
      if (rawVal !== null && rawVal !== undefined) {
        if (typeof rawVal !== 'number' || !Number.isFinite(rawVal) || rawVal < 0 || rawVal > 1) {
          errors.push(
            `Absorption coefficient at ${band} Hz must be a finite number between 0.00 and 1.00 (received ${String(
              rawVal
            )}).`
          );
        } else {
          normalizedBands[band] = round2(rawVal);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  // Enforce Section 6 provenance rule: user-entered values remain 'user-entered'
  const enforcedProvenance: AcousticEvidenceProvenance =
    input.provenance === 'illustrative-assumption' || input.provenance === 'unavailable-or-unverified'
      ? input.provenance
      : 'user-entered';

  const normalizedMaterial: AcousticSurfaceMaterialRecord = {
    acousticMaterialId: id,
    displayName: name,
    targetSurfaceTypes: surfaceTypes,
    mappedInteriorWallFinish: input.mappedInteriorWallFinish,
    mappedInteriorFloorFinish: input.mappedInteriorFloorFinish,
    mappedInteriorCeilingFinish: input.mappedInteriorCeilingFinish,
    linkedP35MaterialId: input.linkedP35MaterialId,
    octaveBandAbsorption: normalizedBands,
    applicableFrequencyRange: '125 Hz – 4000 Hz octave bands (user-entered)',
    provenance: enforcedProvenance,
    dataVersion: input.dataVersion || 'user-custom-1.0',
    sourceMetadata: {
      sourceId: `user-source-${id}`,
      publisher: input.sourceMetadata?.publisher?.trim() || 'User-Entered Project Data',
      title: input.sourceMetadata?.title?.trim() || `User-submitted acoustic data for ${name}`,
      editionOrYear: input.sourceMetadata?.editionOrYear?.trim() || new Date().getFullYear().toString(),
      urlOrIdentifier: input.sourceMetadata?.urlOrIdentifier?.trim() || 'user-entered-record',
      accessOrReviewDate: new Date().toISOString().slice(0, 10),
      applicabilityNote:
        'User-supplied acoustic absorption values; not independently verified by Plotify against an ISO 354 laboratory test certificate.',
      licenceOrUsageNote: 'Project-scoped user input.',
    },
    mountingOrTestConditions:
      input.mountingOrTestConditions?.trim() || 'User-specified mounting condition (unverified)',
    moistureAndWetRoomSuitable: Boolean(input.moistureAndWetRoomSuitable),
    fireAndMaintenanceNote:
      input.fireAndMaintenanceNote?.trim() || 'Verify fire and maintenance ratings with manufacturer.',
    knownLimitations:
      Array.isArray(input.knownLimitations) && input.knownLimitations.length > 0
        ? input.knownLimitations
        : ['User-entered absorption coefficients require verification against laboratory test reports prior to construction specification.'],
  };

  return {
    isValid: true,
    errors: [],
    normalizedMaterial,
  };
}

/**
 * Validates a user-entered background/environmental noise observation (Domain C).
 */
export function validateNoiseObservationInput(
  input: Partial<NoiseObservationEntry>
): {
  isValid: boolean;
  errors: string[];
  normalizedObservation?: NoiseObservationEntry;
} {
  const errors: string[] = [];

  if (!input.roomId || typeof input.roomId !== 'string') {
    errors.push('Target room ID is required.');
  }
  const desc = (input.sourceDescription || '').trim();
  if (!desc || desc.length > 240) {
    errors.push('Source description is required and must be under 240 characters.');
  }

  const kind = input.observationKind || 'subjective-qualitative-observation';
  let levelDb: number | null = null;

  if (kind === 'measured-sound-level' || (input.soundLevelDb !== null && input.soundLevelDb !== undefined)) {
    const raw = input.soundLevelDb;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 150) {
      errors.push('Sound level (dB) must be a finite number between 0 and 150 dB.');
    } else {
      levelDb = round2(raw);
    }
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  const provenance: AcousticEvidenceProvenance =
    kind === 'measured-sound-level'
      ? input.provenance === 'measured-on-site'
        ? 'measured-on-site'
        : 'user-entered'
      : kind === 'illustrative-scenario'
      ? 'illustrative-assumption'
      : 'user-entered';

  const normalizedObservation: NoiseObservationEntry = {
    observationId: input.observationId || `noise-obs-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    roomId: input.roomId!,
    sourceCategory: input.sourceCategory || 'road-traffic',
    sourceDescription: desc,
    receiverDescription: (input.receiverDescription || 'Interior room occupant zone').trim(),
    observationKind: kind,
    soundLevelDb: levelDb,
    metricAndUnit:
      levelDb !== null
        ? input.metricAndUnit && input.metricAndUnit !== 'qualitative-only'
          ? input.metricAndUnit
          : 'LAeq (dBA)'
        : 'qualitative-only',
    timePeriod: input.timePeriod || 'daytime',
    measurementLocation: input.measurementLocation || 'indoor-receiver-room',
    qualitativeSeverity: input.qualitativeSeverity || 'moderate-noticeable',
    provenance,
    recordedAt: input.recordedAt || new Date().toISOString(),
    notes: input.notes?.trim(),
  };

  return {
    isValid: true,
    errors: [],
    normalizedObservation,
  };
}

/**
 * Validates room geometry and computes SI surface areas and volume (P36 Section 5.2 & Section 9).
 *
 * Rules enforced:
 * 1. Coordinates x=0 or y=0 are valid and never rejected for being zero.
 * 2. Width, length, and ceilingHeight must be finite and strictly positive (> 0).
 * 3. If geometryShape === 'irregular-polygon-unsupported', rectangular volume L × W × H is NOT applied.
 * 4. If ceilingHeight is null (unconfigured), roomVolumeM3 and grossWallAreaM2 are null and missing height is disclosed.
 * 5. Known doors and windows (from P33 knownOpenings) are subtracted from gross wall area so surfaces and openings are never double-counted.
 */
export function validateAndComputeRoomAcousticGeometry(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig
): RoomAcousticGeometryValidation {
  const validationIssues: string[] = [];
  const missingGeometryDisclosures: string[] = [];
  const projectUnit = project.unit;

  // Validate coordinates (0 is valid; negative or non-finite is flagged)
  if (typeof room.x !== 'number' || !Number.isFinite(room.x) || room.x < 0) {
    validationIssues.push(`Room X coordinate (${String(room.x)}) is non-finite or negative.`);
  }
  if (typeof room.y !== 'number' || !Number.isFinite(room.y) || room.y < 0) {
    validationIssues.push(`Room Y coordinate (${String(room.y)}) is non-finite or negative.`);
  }

  const widthMetres = convertLengthToMetres(room.width, projectUnit);
  const lengthMetres = convertLengthToMetres(room.length, projectUnit);

  if (widthMetres === null) {
    validationIssues.push(`Room width (${String(room.width)} ${projectUnit}) must be a finite positive number.`);
  }
  if (lengthMetres === null) {
    validationIssues.push(`Room length (${String(room.length)} ${projectUnit}) must be a finite positive number.`);
  }

  if (roomConfig.geometryShape === 'irregular-polygon-unsupported') {
    validationIssues.push(
      'Room geometry is marked as an irregular polygon without a verified polygon area/volume mesh. Plotify does not silently apply rectangular length × width × height assumptions to irregular polygons.'
    );
  }

  const heightUnit = roomConfig.heightUnit || projectUnit;
  const ceilingHeightMetres = convertLengthToMetres(roomConfig.ceilingHeight, heightUnit);

  if (roomConfig.ceilingHeight === null || roomConfig.ceilingHeight === undefined) {
    missingGeometryDisclosures.push(
      'Room ceiling height is not yet specified in the 2D floor-plan model. Enter a confirmed or assumed ceiling height to enable Sabine room volume (V) and reverberation time (RT60) calculations.'
    );
  } else if (ceilingHeightMetres === null) {
    validationIssues.push(
      `Configured ceiling height (${String(roomConfig.ceilingHeight)} ${heightUnit}) is invalid; height must be a finite positive number.`
    );
  } else if (ceilingHeightMetres < 1.8 || ceilingHeightMetres > 20.0) {
    missingGeometryDisclosures.push(
      `Configured ceiling height (${round2(ceilingHeightMetres)} m) is outside typical ordinary-room bounds (1.8 m – 20.0 m); verify room dimensions and diffuse-field applicability.`
    );
  }

  // Inspect P33 known openings and furniture for this room
  const furnitureData = ensureProjectFurnitureLayoutData(project);
  const roomOpenings = (furnitureData.knownOpenings || []).filter((o) => o.roomId === room.id);
  const roomFurniture = (furnitureData.instances || []).filter((i) => i.roomId === room.id);

  if (roomOpenings.length === 0) {
    missingGeometryDisclosures.push(
      'No explicit door or window openings are recorded for this room in P33/P36; wall surface area is evaluated as continuous boundary walls until openings are added.'
    );
  }

  let placedFurnitureFootprintM2 = 0;
  for (const inst of roomFurniture) {
    const wM = convertLengthToMetres(inst.width, inst.unit || projectUnit) || 0;
    const dM = convertLengthToMetres(inst.depth, inst.unit || projectUnit) || 0;
    placedFurnitureFootprintM2 += wM * dM;
  }
  placedFurnitureFootprintM2 = round2(placedFurnitureFootprintM2);

  const isRectangularValid =
    roomConfig.geometryShape === 'rectangle' &&
    widthMetres !== null &&
    lengthMetres !== null &&
    validationIssues.length === 0;

  const floorAreaM2 = isRectangularValid ? round2(widthMetres * lengthMetres) : null;
  const ceilingAreaM2 = floorAreaM2;

  const isVolumeValid =
    isRectangularValid &&
    ceilingHeightMetres !== null &&
    floorAreaM2 !== null &&
    floorAreaM2 > 0;

  const grossWallAreaM2 =
    isVolumeValid && widthMetres !== null && lengthMetres !== null && ceilingHeightMetres !== null
      ? round2(2 * (widthMetres + lengthMetres) * ceilingHeightMetres)
      : null;

  // Compute known door and window areas in m² (capped so openings never exceed gross wall area)
  let rawDoorAreaM2 = 0;
  let rawWindowAreaM2 = 0;
  const effectiveDoorHeightM = ceilingHeightMetres !== null ? Math.min(2.1, ceilingHeightMetres) : 2.1;
  const effectiveWindowHeightM = ceilingHeightMetres !== null ? Math.min(1.5, ceilingHeightMetres * 0.6) : 1.5;

  for (const op of roomOpenings) {
    const opWidthM = convertLengthToMetres(op.width, furnitureData.unit || projectUnit);
    if (opWidthM !== null) {
      if (op.type === 'door') {
        rawDoorAreaM2 += opWidthM * effectiveDoorHeightM;
      } else if (op.type === 'window') {
        rawWindowAreaM2 += opWidthM * effectiveWindowHeightM;
      }
    }
  }

  let knownDoorAreaM2 = round2(rawDoorAreaM2);
  let knownWindowAreaM2 = round2(rawWindowAreaM2);
  let netWallAreaM2: number | null = null;
  let totalBoundarySurfaceAreaM2: number | null = null;

  if (grossWallAreaM2 !== null && floorAreaM2 !== null && ceilingAreaM2 !== null) {
    const totalOpenings = knownDoorAreaM2 + knownWindowAreaM2;
    if (totalOpenings > grossWallAreaM2) {
      const scale = grossWallAreaM2 / totalOpenings;
      knownDoorAreaM2 = round2(knownDoorAreaM2 * scale);
      knownWindowAreaM2 = round2(knownWindowAreaM2 * scale);
    }
    netWallAreaM2 = round2(Math.max(0, grossWallAreaM2 - knownDoorAreaM2 - knownWindowAreaM2));
    totalBoundarySurfaceAreaM2 = round2(
      floorAreaM2 + ceilingAreaM2 + netWallAreaM2 + knownDoorAreaM2 + knownWindowAreaM2
    );
  }

  const roomVolumeM3 =
    isVolumeValid && floorAreaM2 !== null && ceilingHeightMetres !== null
      ? round2(floorAreaM2 * ceilingHeightMetres)
      : null;

  return {
    roomId: room.id,
    roomName: room.name,
    roomType: room.type,
    floorLevel: room.floorLevel,
    projectUnit,
    geometryShape: roomConfig.geometryShape,
    isGeometryValidForVolume: isVolumeValid,
    rawWidthInProjectUnit: room.width,
    rawLengthInProjectUnit: room.length,
    rawCeilingHeightInHeightUnit: roomConfig.ceilingHeight,
    widthMetres: widthMetres !== null ? round2(widthMetres) : null,
    lengthMetres: lengthMetres !== null ? round2(lengthMetres) : null,
    ceilingHeightMetres: ceilingHeightMetres !== null ? round2(ceilingHeightMetres) : null,
    ceilingHeightProvenance: roomConfig.ceilingHeightProvenance,
    floorAreaM2,
    ceilingAreaM2,
    grossWallAreaM2,
    knownDoorAreaM2,
    knownWindowAreaM2,
    netWallAreaM2,
    totalBoundarySurfaceAreaM2,
    roomVolumeM3,
    placedFurnitureCount: roomFurniture.length,
    placedFurnitureFootprintM2,
    validationIssues,
    missingGeometryDisclosures,
  };
}

/**
 * Resolves the active InteriorRoomConcept for a room from the project's active DesignAlternative (if any).
 */
export function resolveActiveInteriorRoomConcept(
  project: Project,
  roomId: string
): InteriorRoomConcept | null {
  const alts = project.designAlternatives || [];
  if (alts.length === 0) return null;
  const activeAlt: DesignAlternative =
    alts.find((a) => a.id === project.activeAlternativeId) || alts[0];
  return activeAlt?.interiors?.[roomId] || null;
}

/**
 * Resolves the acoustic surface material for ceiling, wall, floor, door, and window surfaces of a room.
 */
export function resolveRoomSurfaceMaterials(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig,
  availableMaterials: AcousticSurfaceMaterialRecord[]
): {
  ceiling: AcousticSurfaceMaterialRecord;
  wall: AcousticSurfaceMaterialRecord;
  floor: AcousticSurfaceMaterialRecord;
  door: AcousticSurfaceMaterialRecord;
  window: AcousticSurfaceMaterialRecord;
} {
  const interior = resolveActiveInteriorRoomConcept(project, room.id);
  const byId = (id?: string) => availableMaterials.find((m) => m.acousticMaterialId === id);

  // Ceiling
  let ceiling = byId(roomConfig.ceilingAcousticMaterialId);
  if (!ceiling && interior?.ceilingFinish) {
    ceiling = availableMaterials.find((m) => m.mappedInteriorCeilingFinish === interior.ceilingFinish);
  }
  if (!ceiling) {
    ceiling = availableMaterials.find((m) => m.acousticMaterialId === 'ac-wall-matte-plaster')!;
  }

  // Wall
  let wall = byId(roomConfig.wallAcousticMaterialId);
  if (!wall && interior?.wallFinish) {
    wall = availableMaterials.find((m) => m.mappedInteriorWallFinish === interior.wallFinish);
  }
  if (!wall) {
    wall = availableMaterials.find((m) => m.acousticMaterialId === 'ac-wall-matte-plaster')!;
  }

  // Floor
  let floor = byId(roomConfig.floorAcousticMaterialId);
  if (!floor && interior?.floorFinish) {
    floor = availableMaterials.find((m) => m.mappedInteriorFloorFinish === interior.floorFinish);
  }
  if (!floor) {
    floor = availableMaterials.find((m) => m.acousticMaterialId === 'ac-floor-timber-plank')!;
  }

  // Door & Window
  const door =
    byId(roomConfig.doorAcousticMaterialId) ||
    availableMaterials.find((m) => m.acousticMaterialId === 'ac-open-solid-timber-door')!;
  const windowMat =
    byId(roomConfig.windowAcousticMaterialId) ||
    availableMaterials.find((m) => m.acousticMaterialId === 'ac-open-double-glazing-window')!;

  return {
    ceiling,
    wall,
    floor,
    door,
    window: windowMat,
  };
}

/**
 * Resolves the active criterion for a given room profile and metric, honoring user custom overrides when present.
 */
export function resolveActiveCriterion(
  profileId: FunctionalRoomUseProfileId,
  metric: ConfiguredAcousticCriterion['metric'],
  roomConfig?: RoomAcousticConfig,
  customCriteriaOverrides: ConfiguredAcousticCriterion[] = []
): ConfiguredAcousticCriterion {
  // Check room-level custom override first
  if (metric === 'mid-frequency-rt60-seconds' && roomConfig?.customRt60TargetRangeSec) {
    const custom = roomConfig.customRt60TargetRangeSec;
    return {
      criterionId: `custom-rt60-${roomConfig.roomId}`,
      roomUseProfileId: profileId,
      metric: 'mid-frequency-rt60-seconds',
      label: `Project-Defined Custom RT60 Target (${getFunctionalProfileLabel(profileId)})`,
      minTarget: custom.minSec,
      maxTarget: custom.maxSec,
      unit: 's',
      frequencyScopeNote: '500–1000 Hz mean Sabine RT60 (project-defined target)',
      authorityStatus: 'project-defined',
      jurisdictionOrStandard: custom.sourceNote || 'User-defined project acoustic target',
      applicabilityConditions: 'Project-defined room criterion',
      versionOrDate: new Date().toISOString().slice(0, 10),
      provenance: 'user-entered',
      sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
      verificationAndCompletenessNote: 'Custom user-configured target; kept distinct from reference guidance.',
    };
  }

  if (metric === 'background-noise-laeq-dba' && roomConfig?.customBackgroundNoiseMaxDba) {
    const custom = roomConfig.customBackgroundNoiseMaxDba;
    return {
      criterionId: `custom-noise-${roomConfig.roomId}`,
      roomUseProfileId: profileId,
      metric: 'background-noise-laeq-dba',
      label: `Project-Defined Maximum Background Noise Target (${getFunctionalProfileLabel(profileId)})`,
      minTarget: null,
      maxTarget: custom.maxDba,
      unit: 'dBA',
      frequencyScopeNote: 'Indoor steady LAeq (dBA) (project-defined target)',
      authorityStatus: 'project-defined',
      jurisdictionOrStandard: custom.sourceNote || 'User-defined project background noise target',
      applicabilityConditions: 'Project-defined room criterion',
      versionOrDate: new Date().toISOString().slice(0, 10),
      provenance: 'user-entered',
      sourceMetadata: P36_TECHNICAL_REFERENCES.ASHRAE_FUNDAMENTALS_CH08,
      verificationAndCompletenessNote: 'Custom user-configured target.',
    };
  }

  const override = customCriteriaOverrides.find(
    (c) => c.roomUseProfileId === profileId && c.metric === metric
  );
  if (override) return override;

  const found = DEFAULT_CONFIGURED_ACOUSTIC_CRITERIA.find(
    (c) => c.roomUseProfileId === profileId && c.metric === metric
  );
  if (found) return found;

  return DEFAULT_CONFIGURED_ACOUSTIC_CRITERIA.find((c) => c.metric === metric)!;
}

/**
 * Domain A — Room Reverberation and Sound Absorption (Sabine equation in SI units):
 *
 * RT60(f) ≈ 0.161 × V / A(f)
 * A(f) = Σ (αᵢ(f) × Sᵢ)
 *
 * Strictly enforces P36 Section 7 Domain A:
 * 1. Calculates each octave band (125–4000 Hz) independently.
 * 2. Never fabricates material absorption coefficients (null coefficients flag incomplete band evidence).
 * 3. Avoids double-counting surfaces, openings, or furniture.
 * 4. Flags high-absorption / non-uniform cases where Sabine diffuse-field assumptions lose accuracy.
 * 5. Distinguishes estimated Sabine RT60 from on-site measured RT60 records.
 */
export function evaluateReverberationDomain(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig,
  geometry: RoomAcousticGeometryValidation,
  availableMaterials: AcousticSurfaceMaterialRecord[],
  measuredRecord?: MeasuredRoomRt60Record,
  customCriteriaOverrides: ConfiguredAcousticCriterion[] = []
): ReverberationDomainResult {
  const activeCriterion = resolveActiveCriterion(
    roomConfig.functionalUseProfile,
    'mid-frequency-rt60-seconds',
    roomConfig,
    customCriteriaOverrides
  );
  const resolvedMats = resolveRoomSurfaceMaterials(project, room, roomConfig, availableMaterials);

  const sabineDiffuseFieldAssumptions = [
    'Sabine equation (RT60 ≈ 0.161 × V / A) assumes an adequately diffuse sound field with uniform directional energy distribution at 20 °C (speed of sound ≈ 343 m/s).',
    'Boundary surfaces (ceiling, net walls, floor, and known doors/windows) are accounted for without double-counting opening areas.',
    'Placed P33 furniture footprints are NOT assigned fabricated acoustic absorption coefficients (Sabins) unless backed by verified product test data.',
    'Low-frequency octave bands (125 Hz and 250 Hz) in small-to-medium rooms are subject to discrete axial/tangential/oblique room modes below the Schroeder frequency.',
  ];

  const furnitureAbsorptionExclusionNote =
    geometry.placedFurnitureCount > 0
      ? `${geometry.placedFurnitureCount} furniture item(s) (${geometry.placedFurnitureFootprintM2} m² footprint) are placed in P33. Per P36 Section 11, Plotify does not invent acoustic absorption Sabins from generic furniture geometry alone; unoccupied boundary-surface RT60 represents a conservative baseline.`
      : 'No P33 furniture items placed in this room; calculation reflects bare boundary surfaces.';

  // Build surface contribution list when surface areas are known, or educational preview if ceiling height is missing
  const buildContributions = (
    ceilArea: number,
    netWallArea: number,
    flrArea: number,
    doorArea: number,
    winArea: number
  ): SurfaceAbsorptionContribution[] => {
    const rawSurfaces: Array<{
      surfaceId: string;
      surfaceType: SurfaceAbsorptionContribution['surfaceType'];
      surfaceLabel: string;
      areaM2: number;
      mat: AcousticSurfaceMaterialRecord;
    }> = [
      {
        surfaceId: `${room.id}-ceiling`,
        surfaceType: 'ceiling',
        surfaceLabel: 'Ceiling Surface',
        areaM2: ceilArea,
        mat: resolvedMats.ceiling,
      },
      {
        surfaceId: `${room.id}-walls-net`,
        surfaceType: 'wall',
        surfaceLabel: 'Net Interior Walls (Gross minus Known Openings)',
        areaM2: netWallArea,
        mat: resolvedMats.wall,
      },
      {
        surfaceId: `${room.id}-floor`,
        surfaceType: 'floor',
        surfaceLabel: 'Floor Surface',
        areaM2: flrArea,
        mat: resolvedMats.floor,
      },
    ];

    if (doorArea > 0) {
      rawSurfaces.push({
        surfaceId: `${room.id}-doors`,
        surfaceType: 'door',
        surfaceLabel: 'Known Door Openings',
        areaM2: doorArea,
        mat: resolvedMats.door,
      });
    }
    if (winArea > 0) {
      rawSurfaces.push({
        surfaceId: `${room.id}-windows`,
        surfaceType: 'window',
        surfaceLabel: 'Known Window Glazing',
        areaM2: winArea,
        mat: resolvedMats.window,
      });
    }

    const items: SurfaceAbsorptionContribution[] = rawSurfaces.map((s) => {
      const sabinsByBand: Record<OctaveBandHz, number | null> = {
        125: null,
        250: null,
        500: null,
        1000: null,
        2000: null,
        4000: null,
      };
      for (const band of OCTAVE_BANDS_HZ) {
        const alpha = s.mat.octaveBandAbsorption[band];
        if (alpha !== null && alpha !== undefined && Number.isFinite(alpha) && alpha >= 0 && alpha <= 1) {
          sabinsByBand[band] = round3(alpha * s.areaM2);
        }
      }
      return {
        surfaceId: s.surfaceId,
        surfaceType: s.surfaceType,
        surfaceLabel: s.surfaceLabel,
        areaM2: round2(s.areaM2),
        materialId: s.mat.acousticMaterialId,
        materialName: s.mat.displayName,
        provenance: s.mat.provenance,
        sourceCitation: `${s.mat.sourceMetadata.publisher} — ${s.mat.sourceMetadata.title} (${s.mat.sourceMetadata.editionOrYear})`,
        coefficientsByBand: { ...s.mat.octaveBandAbsorption },
        sabinsByBand,
        shareOfMidFreqAbsorptionPercent: null,
      };
    });

    // Compute mid-frequency (500–1000 Hz) absorption share %
    const allHaveMid = items.every(
      (i) => i.sabinsByBand[500] !== null && i.sabinsByBand[1000] !== null
    );
    if (allHaveMid) {
      const totalMidSabins = items.reduce(
        (sum, i) => sum + ((i.sabinsByBand[500]! + i.sabinsByBand[1000]!) / 2),
        0
      );
      if (totalMidSabins > 0) {
        for (const item of items) {
          const itemMid = (item.sabinsByBand[500]! + item.sabinsByBand[1000]!) / 2;
          item.shareOfMidFreqAbsorptionPercent = round2((itemMid / totalMidSabins) * 100);
        }
      }
    }

    return items;
  };

  // Case 1: Room volume is unavailable (e.g. missing ceiling height or invalid/irregular geometry)
  if (!geometry.isGeometryValidForVolume || geometry.roomVolumeM3 === null || geometry.totalBoundarySurfaceAreaM2 === null) {
    const emptyBands = {} as Record<OctaveBandHz, OctaveBandSabineResult>;
    for (const band of OCTAVE_BANDS_HZ) {
      emptyBands[band] = {
        bandHz: band,
        isCompleteForBand: false,
        totalEquivalentAbsorptionSabinsM2: null,
        meanAbsorptionCoefficientAlphaBar: null,
        estimatedRt60Seconds: null,
        measuredRt60Seconds: measuredRecord?.measuredBandRt60Seconds?.[band] ?? null,
        isHighAbsorptionSabineQualified: false,
        qualificationNote: 'Room volume (V) is unavailable; Sabine RT60 cannot be computed.',
        missingSurfacesForBand: ['Room volume V (m³) and wall height H (m)'],
      };
    }

    // If floorAreaM2 is valid (only ceiling height is missing), provide an explicitly labelled educational scenario preview at 2.7 m height
    let educationalScenarioPreview: ReverberationDomainResult['educationalScenarioPreview'];
    if (
      geometry.geometryShape === 'rectangle' &&
      geometry.floorAreaM2 !== null &&
      geometry.widthMetres !== null &&
      geometry.lengthMetres !== null &&
      geometry.validationIssues.length === 0
    ) {
      const assumedH = 2.7;
      const previewVol = geometry.floorAreaM2 * assumedH;
      const previewGrossWall = 2 * (geometry.widthMetres + geometry.lengthMetres) * assumedH;
      const previewNetWall = Math.max(0, previewGrossWall - geometry.knownDoorAreaM2 - geometry.knownWindowAreaM2);
      const previewSurfaces = buildContributions(
        geometry.floorAreaM2,
        previewNetWall,
        geometry.floorAreaM2,
        geometry.knownDoorAreaM2,
        geometry.knownWindowAreaM2
      );
      const canPreview500 = previewSurfaces.every((s) => s.sabinsByBand[500] !== null);
      const canPreview1000 = previewSurfaces.every((s) => s.sabinsByBand[1000] !== null);
      let previewRt60: number | null = null;
      if (canPreview500 && canPreview1000) {
        const a500 = previewSurfaces.reduce((sum, s) => sum + s.sabinsByBand[500]!, 0);
        const a1000 = previewSurfaces.reduce((sum, s) => sum + s.sabinsByBand[1000]!, 0);
        if (a500 > 0 && a1000 > 0) {
          const rt500 = (SABINE_CONSTANT_SI * previewVol) / a500;
          const rt1000 = (SABINE_CONSTANT_SI * previewVol) / a1000;
          previewRt60 = round2((rt500 + rt1000) / 2);
        }
      }
      educationalScenarioPreview = {
        isScenarioPreviewOnly: true,
        assumedHeightMetres: assumedH,
        previewMidFreqRt60Seconds: previewRt60,
        previewNote:
          'Educational Scenario Preview ONLY (illustrative 2.70 m ceiling height). This preview is NOT an active room estimate until you enter or confirm the room ceiling height.',
      };
    }

    return {
      domainId: 'domain-a-reverberation-and-absorption',
      status: 'insufficient-evidence',
      confidenceState: 'insufficient-evidence',
      formulaUsed: 'RT60 ≈ 0.161 × V / A (SI units: V in m³, A = Σ(αᵢ × Sᵢ) in m² sabins)',
      volumeM3: null,
      totalSurfaceAreaM2: null,
      surfaceContributions: [],
      bandResults: emptyBands,
      midFrequencyEstimatedRt60Seconds: null,
      midFrequencyMeasuredRt60Seconds: null,
      activeCriterion,
      meetsTargetRange: null,
      sabineDiffuseFieldAssumptions,
      modelLimitations: [
        ...geometry.validationIssues,
        ...geometry.missingGeometryDisclosures,
      ],
      topAbsorbingSurfacesSummary: [],
      topReflectiveSurfacesSummary: [],
      furnitureAbsorptionExclusionNote,
      educationalScenarioPreview,
      explanation:
        geometry.validationIssues.length > 0
          ? `Insufficient geometric evidence to calculate reverberation time for "${room.name}": ${geometry.validationIssues.join(' ')}`
          : `Room ceiling height is not specified for "${room.name}", so room volume (V) and wall surface area cannot be determined with confidence. Specify the ceiling height to calculate octave-band Sabine RT60 estimates.`,
    };
  }

  // Case 2: Valid 3D rectangular room volume — evaluate surface contributions and octave-band Sabine RT60
  const surfaceContributions = buildContributions(
    geometry.ceilingAreaM2!,
    geometry.netWallAreaM2!,
    geometry.floorAreaM2!,
    geometry.knownDoorAreaM2,
    geometry.knownWindowAreaM2
  );

  const volumeM3 = geometry.roomVolumeM3;
  const totalSurfaceAreaM2 = geometry.totalBoundarySurfaceAreaM2;

  const bandResults = {} as Record<OctaveBandHz, OctaveBandSabineResult>;
  const modelLimitations: string[] = [...geometry.missingGeometryDisclosures];
  let anyHighAbsorptionQualification = false;

  for (const band of OCTAVE_BANDS_HZ) {
    const missingSurfacesForBand: string[] = [];
    let totalSabins = 0;

    for (const s of surfaceContributions) {
      if (s.areaM2 > 0) {
        const sab = s.sabinsByBand[band];
        if (sab === null || sab === undefined || !Number.isFinite(sab)) {
          missingSurfacesForBand.push(`${s.surfaceLabel} (${s.materialName})`);
        } else {
          totalSabins += sab;
        }
      }
    }

    const isCompleteForBand = missingSurfacesForBand.length === 0 && totalSabins > 0;
    const alphaBar =
      isCompleteForBand && totalSurfaceAreaM2 > 0
        ? round3(totalSabins / totalSurfaceAreaM2)
        : null;

    // Check if Sabine diffuse-field assumption is strained (mean alpha > 0.30 or highly asymmetric)
    const isHighAbsorptionSabineQualified = Boolean(alphaBar !== null && alphaBar > 0.3);
    if (isHighAbsorptionSabineQualified) {
      anyHighAbsorptionQualification = true;
    }

    const estimatedRt60 =
      isCompleteForBand && totalSabins > 0
        ? round2((SABINE_CONSTANT_SI * volumeM3) / totalSabins)
        : null;

    const measuredVal = measuredRecord?.measuredBandRt60Seconds?.[band] ?? null;

    bandResults[band] = {
      bandHz: band,
      isCompleteForBand,
      totalEquivalentAbsorptionSabinsM2: isCompleteForBand ? round2(totalSabins) : null,
      meanAbsorptionCoefficientAlphaBar: alphaBar,
      estimatedRt60Seconds: estimatedRt60,
      measuredRt60Seconds: measuredVal !== null ? round2(measuredVal) : null,
      isHighAbsorptionSabineQualified,
      qualificationNote: !isCompleteForBand
        ? missingSurfacesForBand.length > 0
          ? `Missing documented absorption coefficient at ${band} Hz for: ${missingSurfacesForBand.join(', ')}.`
          : `Total absorption A at ${band} Hz is zero or invalid.`
        : isHighAbsorptionSabineQualified
        ? `Mean surface absorption coefficient ᾱ = ${alphaBar} (> 0.30) at ${band} Hz. Under high-absorption or single-surface concentration, the classical Sabine formula overestimates RT60 relative to Eyring/physical decay; treat as a qualified screening estimate.`
        : undefined,
      missingSurfacesForBand,
    };
  }

  if (anyHighAbsorptionQualification) {
    modelLimitations.push(
      'One or more octave bands have mean surface absorption coefficient ᾱ > 0.30. In rooms with high absorption or absorption concentrated on a single surface (e.g. acoustic ceiling over reflective floor/walls), the diffuse-field assumption of the Sabine equation breaks down and grazing/flutter modes between untreated parallel surfaces may persist.'
    );
  }

  // Check if all bands or mid-frequency bands (500 & 1000 Hz) are complete
  const rt500 = bandResults[500].estimatedRt60Seconds;
  const rt1000 = bandResults[1000].estimatedRt60Seconds;
  const midFrequencyEstimatedRt60Seconds =
    rt500 !== null && rt1000 !== null ? round2((rt500 + rt1000) / 2) : null;

  const meas500 = bandResults[500].measuredRt60Seconds;
  const meas1000 = bandResults[1000].measuredRt60Seconds;
  const midFrequencyMeasuredRt60Seconds =
    meas500 !== null && meas1000 !== null ? round2((meas500 + meas1000) / 2) : null;

  // Identify top absorbing and top reflective surfaces
  const sortedByShare = [...surfaceContributions]
    .filter((s) => s.areaM2 > 0 && s.shareOfMidFreqAbsorptionPercent !== null)
    .sort((a, b) => (b.shareOfMidFreqAbsorptionPercent || 0) - (a.shareOfMidFreqAbsorptionPercent || 0));

  const topAbsorbingSurfacesSummary = sortedByShare.map(
    (s) =>
      `${s.surfaceLabel} (${s.materialName}, ${s.areaM2} m²): ${s.shareOfMidFreqAbsorptionPercent}% of mid-frequency absorption`
  );

  const topReflectiveSurfacesSummary = surfaceContributions
    .filter((s) => {
      const a500 = s.coefficientsByBand[500];
      const a1000 = s.coefficientsByBand[1000];
      return s.areaM2 > 0 && a500 !== null && a1000 !== null && (a500 + a1000) / 2 <= 0.08;
    })
    .map(
      (s) =>
        `${s.surfaceLabel} (${s.materialName}, ${s.areaM2} m²) is highly sound-reflective (α_mid ≈ ${round2(
          ((s.coefficientsByBand[500] || 0) + (s.coefficientsByBand[1000] || 0)) / 2
        )})`
    );

  // Determine confidence state and status
  const hasUnavailableSurface = surfaceContributions.some(
    (s) => s.areaM2 > 0 && s.provenance === 'unavailable-or-unverified'
  );
  const hasIllustrativeOrUser =
    roomConfig.ceilingHeightProvenance === 'illustrative-assumption' ||
    roomConfig.ceilingHeightProvenance === 'user-entered' ||
    surfaceContributions.some(
      (s) => s.provenance === 'illustrative-assumption' || s.provenance === 'user-entered'
    );

  if (midFrequencyEstimatedRt60Seconds === null || hasUnavailableSurface) {
    return {
      domainId: 'domain-a-reverberation-and-absorption',
      status: 'insufficient-evidence',
      confidenceState: 'insufficient-evidence',
      formulaUsed: 'RT60 ≈ 0.161 × V / A (SI units: V in m³, A = Σ(αᵢ × Sᵢ) in m² sabins)',
      volumeM3,
      totalSurfaceAreaM2,
      surfaceContributions,
      bandResults,
      midFrequencyEstimatedRt60Seconds: null,
      midFrequencyMeasuredRt60Seconds,
      activeCriterion,
      meetsTargetRange: null,
      sabineDiffuseFieldAssumptions,
      modelLimitations: [
        ...modelLimitations,
        'One or more room boundary surfaces use an unverified material lacking documented octave-band absorption coefficients.',
      ],
      topAbsorbingSurfacesSummary,
      topReflectiveSurfacesSummary,
      furnitureAbsorptionExclusionNote,
      explanation: `Cannot produce a valid Sabine RT60 estimate for "${room.name}" because at least one boundary surface has undocumented sound absorption coefficients. Plotify does not substitute fabricated coefficients for unknown materials.`,
    };
  }

  const governingRt60 = midFrequencyMeasuredRt60Seconds ?? midFrequencyEstimatedRt60Seconds;
  const minT = activeCriterion.minTarget ?? 0;
  const maxT = activeCriterion.maxTarget;
  const meetsTargetRange = governingRt60 >= minT - 1e-4 && governingRt60 <= maxT + 1e-4;

  let status: AcousticEvaluationStatus;
  if (midFrequencyMeasuredRt60Seconds !== null && meetsTargetRange) {
    status = 'measured-within-target';
  } else if (meetsTargetRange) {
    status = anyHighAbsorptionQualification ? 'needs-review' : 'estimated-within-target';
  } else if (governingRt60 > maxT + 0.25) {
    status = 'concern-identified';
  } else {
    status = 'needs-review';
  }

  const confidenceState: AcousticConfidenceState =
    midFrequencyMeasuredRt60Seconds !== null && measuredRecord?.provenance === 'measured-on-site'
      ? 'verified-measurement-or-test-evidence'
      : anyHighAbsorptionQualification || hasIllustrativeOrUser
      ? 'incomplete-evidence-requires-caution'
      : 'sufficient-for-preliminary-calculation';

  const explanation = meetsTargetRange
    ? `Estimated mid-frequency Sabine RT60 for "${room.name}" (V = ${volumeM3} m³) is ${midFrequencyEstimatedRt60Seconds} s, which falls within the configured ${activeCriterion.authorityStatus} range (${minT}–${maxT} s) for ${getFunctionalProfileLabel(
        roomConfig.functionalUseProfile
      )}.${
        anyHighAbsorptionQualification
          ? ' Note: High surface absorption (ᾱ > 0.30) qualifies the classical Sabine diffuse-field approximation.'
          : ''
      }`
    : governingRt60 > maxT
    ? `Estimated mid-frequency Sabine RT60 for "${room.name}" (V = ${volumeM3} m³) is ${midFrequencyEstimatedRt60Seconds} s, exceeding the configured ${activeCriterion.authorityStatus} upper target of ${maxT} s for ${getFunctionalProfileLabel(
        roomConfig.functionalUseProfile
      )} by ${round2(governingRt60 - maxT)} s. Reflective boundary surfaces dominate the room envelope.`
    : `Estimated mid-frequency Sabine RT60 for "${room.name}" (V = ${volumeM3} m³) is ${midFrequencyEstimatedRt60Seconds} s, below the configured lower target of ${minT} s (room may sound overly dry/dead for ${getFunctionalProfileLabel(
        roomConfig.functionalUseProfile
      )}).`;

  return {
    domainId: 'domain-a-reverberation-and-absorption',
    status,
    confidenceState,
    formulaUsed: 'RT60 ≈ 0.161 × V / A (SI units: V in m³, A = Σ(αᵢ × Sᵢ) in m² sabins)',
    volumeM3,
    totalSurfaceAreaM2,
    surfaceContributions,
    bandResults,
    midFrequencyEstimatedRt60Seconds,
    midFrequencyMeasuredRt60Seconds,
    activeCriterion,
    meetsTargetRange,
    sabineDiffuseFieldAssumptions,
    modelLimitations,
    topAbsorbingSurfacesSummary,
    topReflectiveSurfacesSummary,
    furnitureAbsorptionExclusionNote,
    explanation,
  };
}

/**
 * Domain B — Speech, Communication, and Functional Use Screening.
 * Never claims statutory classification or fabricates STI / C50 / D50 / %ALcons metrics.
 */
export function evaluateSpeechAndFunctionalUse(
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig,
  geometry: RoomAcousticGeometryValidation,
  domainA: ReverberationDomainResult
): SpeechFunctionalDomainResult {
  const profileId = roomConfig.functionalUseProfile;
  const profileLabel = getFunctionalProfileLabel(profileId);
  const priorities = roomConfig.acousticPriorities || [];
  const identifiedConcerns: string[] = [];
  const conflictingPrioritiesDetected: string[] = [];
  const missingEvidence: string[] = [];

  // Check conflicting acoustic priorities
  if (
    priorities.includes('lively-musical-warmth') &&
    (priorities.includes('speech-clarity') || priorities.includes('confidential-speech-privacy'))
  ) {
    conflictingPrioritiesDetected.push(
      'Conflicting acoustic priorities selected: "Lively musical warmth" favors longer reverberation (0.6–1.1 s), whereas "Speech clarity" and "Confidential speech privacy" require shorter reverberation (0.3–0.5 s) and high sound absorption.'
    );
  }

  if (domainA.midFrequencyEstimatedRt60Seconds === null) {
    missingEvidence.push(
      'Valid room volume (ceiling height) and complete surface absorption data are required to evaluate reverberation impact on speech communication.'
    );
  } else {
    const rtMid = domainA.midFrequencyEstimatedRt60Seconds;
    const rt125 = domainA.bandResults[125]?.estimatedRt60Seconds;
    const rt250 = domainA.bandResults[250]?.estimatedRt60Seconds;

    if (
      (profileId === 'home-office-focused' ||
        profileId === 'meeting-room' ||
        profileId === 'classroom-learning' ||
        profileId === 'healthcare-consultation') &&
      rtMid > domainA.activeCriterion.maxTarget
    ) {
      identifiedConcerns.push(
        `Mid-frequency reverberation (${rtMid} s) exceeds the ${domainA.activeCriterion.maxTarget} s functional target for ${profileLabel}, increasing syllable masking and vocal fatigue during speech communication.`
      );
    }

    if (profileId === 'restaurant-communal-dining' && rtMid > 0.7) {
      identifiedConcerns.push(
        `Estimated reverberation (${rtMid} s) in "${room.name}" creates a high risk of the Lombard effect (diners raising their voices to be heard over reverberant background chatter).`
      );
    }

    if (profileId === 'bedroom-residential' && rtMid > 0.55) {
      identifiedConcerns.push(
        `Estimated reverberation (${rtMid} s) in bedroom "${room.name}" is higher than typical restful domestic targets (≤ 0.50 s), amplifying transient sounds.`
      );
    }

    if (rt125 !== null && rt250 !== null && (rt125 + rt250) / 2 > rtMid * 1.45) {
      identifiedConcerns.push(
        `Low-frequency reverberation (125–250 Hz average = ${round2(
          (rt125 + rt250) / 2
        )} s) is significantly longer than mid-frequency RT60 (${rtMid} s), which can cause a "boomy" vocal quality masking consonant clarity.`
      );
    }
  }

  // Check occupant assumptions
  if (roomConfig.occupantCountAssumption === null) {
    missingEvidence.push(
      'Simultaneous occupant count assumption is not specified; multi-talker vocal noise buildup cannot be screened.'
    );
  } else if (
    geometry.floorAreaM2 !== null &&
    roomConfig.occupantCountAssumption > 0 &&
    geometry.floorAreaM2 / roomConfig.occupantCountAssumption < 2.5 &&
    (profileId === 'meeting-room' || profileId === 'classroom-learning' || profileId === 'restaurant-communal-dining')
  ) {
    identifiedConcerns.push(
      `High occupant density (${roomConfig.occupantCountAssumption} occupants in ${geometry.floorAreaM2} m², or ${round2(
        geometry.floorAreaM2 / roomConfig.occupantCountAssumption
      )} m²/person) increases simultaneous vocal sound power requires additional ceiling/wall sound absorption.`
    );
  }

  const stiAndAdvancedMetricsDisclosure =
    'Plotify does NOT fabricate Speech Transmission Index (STI), C50/D50 clarity ratios, or %ALcons intelligibility percentages. Validated STI prediction requires 3D source-receiver directivity, impulse-response modulation transfer functions (IEC 60268-16), and octave-band signal-to-noise ratios at specific listener seats.';

  let status: AcousticEvaluationStatus = 'estimated-within-target';
  let confidenceState: AcousticConfidenceState = domainA.confidenceState;

  if (domainA.status === 'insufficient-evidence') {
    status = 'insufficient-evidence';
    confidenceState = 'insufficient-evidence';
  } else if (identifiedConcerns.length > 0 || conflictingPrioritiesDetected.length > 0) {
    status = identifiedConcerns.length > 0 ? 'concern-identified' : 'needs-review';
  }

  const explanation =
    status === 'insufficient-evidence'
      ? `Speech and functional acoustic suitability for "${room.name}" (${profileLabel}) cannot be determined until room ceiling height and surface absorption data are complete.`
      : identifiedConcerns.length === 0 && conflictingPrioritiesDetected.length === 0
      ? `Functional screening for "${room.name}" (${profileLabel}) indicates that estimated reverberation (${domainA.midFrequencyEstimatedRt60Seconds} s) aligns with selected priorities (${priorities.join(', ') || 'general comfort'}).`
      : `Functional screening for "${room.name}" (${profileLabel}) identified ${
          identifiedConcerns.length + conflictingPrioritiesDetected.length
        } concern(s): ${[...identifiedConcerns, ...conflictingPrioritiesDetected].join(' ')}`;

  return {
    domainId: 'domain-b-speech-and-functional-use',
    functionalProfileId: profileId,
    functionalProfileLabel: profileLabel,
    isStatutoryClassClaimed: false,
    status,
    confidenceState,
    prioritiesSelected: priorities,
    occupantCountAssumption: roomConfig.occupantCountAssumption,
    occupantProvenance: roomConfig.occupantProvenance,
    identifiedConcerns,
    conflictingPrioritiesDetected,
    stiAndAdvancedMetricsDisclosure,
    missingEvidenceForDetailedSpeechAssessment: missingEvidence,
    explanation,
  };
}

/**
 * Domain C — Background and Environmental Noise Screening.
 * Enforces P36 Section 7 Domain C & Section 9:
 * - Never infers external or indoor noise levels from a city name, map pin, climate record, or project title.
 * - Uses logarithmic energy addition L_total = 10 * log10(sum 10^(L_i / 10)) for compatible measured indoor steady LAeq (dBA) sources.
 * - Distinguishes WHO outdoor population exposure guidelines from indoor room comfort targets.
 */
export function evaluateBackgroundAndEnvironmentalNoise(
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig,
  roomObservations: NoiseObservationEntry[],
  customCriteriaOverrides: ConfiguredAcousticCriterion[] = []
): BackgroundNoiseDomainResult {
  const activeCriterion = resolveActiveCriterion(
    roomConfig.functionalUseProfile,
    'background-noise-laeq-dba',
    roomConfig,
    customCriteriaOverrides
  );

  const whoGuidelinesScopeDisclosure =
    'WHO Environmental Noise Guidelines for the European Region (2018) address outdoor population health exposure (Lden, Lnight) from specific environmental sources (road, rail, aircraft, wind turbines) and are NOT indoor room pass/fail specifications. Plotify evaluates indoor room background noise against configurable interior room reference criteria (ASHRAE Handbook Ch. 8) or project-defined targets.';

  const noLocationInferenceGuarantee =
    'Plotify never fabricates or infers outdoor or indoor decibel levels from a project title, city name, site orientation, or P35 climate profile.';

  const indoorSteadyLaeqObservations = roomObservations.filter(
    (o) =>
      o.soundLevelDb !== null &&
      Number.isFinite(o.soundLevelDb) &&
      o.metricAndUnit === 'LAeq (dBA)' &&
      o.measurementLocation === 'indoor-receiver-room'
  );

  const combinedMeasuredIndoorLaeqDba =
    indoorSteadyLaeqObservations.length > 0
      ? combineDecibelLevelsLogarithmic(
          indoorSteadyLaeqObservations.map((o) => o.soundLevelDb as number)
        )
      : null;

  const qualitativeScreeningFindings: string[] = [];
  for (const obs of roomObservations) {
    if (obs.soundLevelDb !== null) {
      qualitativeScreeningFindings.push(
        `[${obs.observationKind === 'measured-sound-level' ? 'Measured' : 'Assumed'} ${obs.soundLevelDb} ${
          obs.metricAndUnit
        }, ${obs.measurementLocation}, ${obs.timePeriod}] ${obs.sourceCategory}: ${obs.sourceDescription}`
      );
    } else {
      qualitativeScreeningFindings.push(
        `[Qualitative observation — ${obs.qualitativeSeverity}, ${obs.timePeriod}] ${obs.sourceCategory}: ${obs.sourceDescription}`
      );
    }
  }

  const hasHighQualitativeNoise = roomObservations.some(
    (o) => o.qualitativeSeverity === 'high-intrusive' || o.qualitativeSeverity === 'intermittent-impulsive'
  );

  const exceedsConfiguredTarget =
    combinedMeasuredIndoorLaeqDba !== null
      ? combinedMeasuredIndoorLaeqDba > activeCriterion.maxTarget
      : null;

  let status: AcousticEvaluationStatus;
  let confidenceState: AcousticConfidenceState;

  if (roomObservations.length === 0) {
    status = 'insufficient-evidence';
    confidenceState = 'insufficient-evidence';
  } else if (combinedMeasuredIndoorLaeqDba !== null) {
    const allMeasuredOnSite = indoorSteadyLaeqObservations.every(
      (o) => o.provenance === 'measured-on-site'
    );
    confidenceState = allMeasuredOnSite
      ? 'verified-measurement-or-test-evidence'
      : 'sufficient-for-preliminary-calculation';
    status = exceedsConfiguredTarget
      ? 'concern-identified'
      : allMeasuredOnSite
      ? 'measured-within-target'
      : 'estimated-within-target';
  } else {
    confidenceState = 'incomplete-evidence-requires-caution';
    status = hasHighQualitativeNoise ? 'concern-identified' : 'needs-review';
  }

  const explanation =
    roomObservations.length === 0
      ? `No measured sound levels or qualitative noise observations have been recorded for "${room.name}". Plotify does not infer background noise from project location; add on-site sound level measurements or qualitative source observations to screen background noise against the ${activeCriterion.maxTarget} dBA target.`
      : combinedMeasuredIndoorLaeqDba !== null
      ? exceedsConfiguredTarget
        ? `Energy-summed indoor steady background noise in "${room.name}" is ${combinedMeasuredIndoorLaeqDba} dBA (from ${indoorSteadyLaeqObservations.length} source(s)), which exceeds the configured ${activeCriterion.authorityStatus} limit of ${activeCriterion.maxTarget} dBA for ${getFunctionalProfileLabel(
            roomConfig.functionalUseProfile
          )} by ${round2(combinedMeasuredIndoorLaeqDba - activeCriterion.maxTarget)} dB.`
        : `Energy-summed indoor steady background noise in "${room.name}" is ${combinedMeasuredIndoorLaeqDba} dBA, which is within the configured ${activeCriterion.authorityStatus} target of ≤ ${activeCriterion.maxTarget} dBA.`
      : `Qualitative noise screening for "${room.name}" recorded ${roomObservations.length} subjective/external observation(s) without indoor LAeq (dBA) measurements.${
          hasHighQualitativeNoise
            ? ' High/intrusive or impulsive noise sources were flagged; on-site sound level meter measurements and envelope attenuation review are recommended.'
            : ' Add indoor LAeq (dBA) measurements to verify compliance with the ' +
              activeCriterion.maxTarget +
              ' dBA target.'
        }`;

  return {
    domainId: 'domain-c-background-and-environmental-noise',
    status,
    confidenceState,
    observations: roomObservations,
    hasMeasuredSoundLevels: combinedMeasuredIndoorLaeqDba !== null,
    combinedMeasuredIndoorLaeqDba,
    energyLogarithmicFormulaUsed:
      'L_total = 10 × log10( Σ 10^(Lᵢ / 10) ) dBA (logarithmic energy addition; never arithmetic mean of decibels)',
    activeCriterion,
    exceedsConfiguredTarget,
    qualitativeScreeningFindings,
    whoGuidelinesScopeDisclosure,
    noLocationInferenceGuarantee,
    explanation,
  };
}

/**
 * Discovers shared wall boundaries between `room` and all other rooms on the same floor level
 * using exact 2D axis-aligned bounding-box edge overlap geometry.
 */
export function discoverSharedRoomBoundaries(
  project: Project,
  room: FloorPlanRoom,
  allRoomConfigs: Record<string, RoomAcousticConfig>
): SharedRoomBoundaryItem[] {
  const rooms = (project.floorPlan?.rooms || []).filter(
    (r) => r.id !== room.id && r.floorLevel === room.floorLevel
  );
  const furnitureData = ensureProjectFurnitureLayoutData(project);
  const roomOpenings = (furnitureData.knownOpenings || []).filter((o) => o.roomId === room.id);

  const EPS = 0.15; // tolerance in project units for touching walls
  const shared: SharedRoomBoundaryItem[] = [];
  const roomProfile = allRoomConfigs[room.id]?.functionalUseProfile || inferDefaultFunctionalUseProfile(room);

  const rLeft = room.x;
  const rRight = room.x + room.width;
  const rTop = room.y;
  const rBottom = room.y + room.length;

  for (const other of rooms) {
    const oLeft = other.x;
    const oRight = other.x + other.width;
    const oTop = other.y;
    const oBottom = other.y + other.length;

    let wallOrientation: SharedRoomBoundaryItem['wallOrientation'] | null = null;
    let overlapLenInProjectUnits = 0;

    // North wall of `room` touches South wall of `other`
    if (Math.abs(rTop - oBottom) <= EPS) {
      const xOverlap = Math.min(rRight, oRight) - Math.max(rLeft, oLeft);
      if (xOverlap > EPS) {
        wallOrientation = 'north';
        overlapLenInProjectUnits = xOverlap;
      }
    }
    // South wall of `room` touches North wall of `other`
    else if (Math.abs(rBottom - oTop) <= EPS) {
      const xOverlap = Math.min(rRight, oRight) - Math.max(rLeft, oLeft);
      if (xOverlap > EPS) {
        wallOrientation = 'south';
        overlapLenInProjectUnits = xOverlap;
      }
    }
    // West wall of `room` touches East wall of `other`
    else if (Math.abs(rLeft - oRight) <= EPS) {
      const yOverlap = Math.min(rBottom, oBottom) - Math.max(rTop, oTop);
      if (yOverlap > EPS) {
        wallOrientation = 'west';
        overlapLenInProjectUnits = yOverlap;
      }
    }
    // East wall of `room` touches West wall of `other`
    else if (Math.abs(rRight - oLeft) <= EPS) {
      const yOverlap = Math.min(rBottom, oBottom) - Math.max(rTop, oTop);
      if (yOverlap > EPS) {
        wallOrientation = 'east';
        overlapLenInProjectUnits = yOverlap;
      }
    }

    if (wallOrientation && overlapLenInProjectUnits > 0) {
      const sharedEdgeLengthMetres = round2(
        convertLengthToMetres(overlapLenInProjectUnits, project.unit) || 0
      );
      const neighborProfile =
        allRoomConfigs[other.id]?.functionalUseProfile || inferDefaultFunctionalUseProfile(other);
      const hasConnectingDoorOrPassage = roomOpenings.some(
        (op) =>
          op.wallEdge === wallOrientation &&
          (op.type === 'door' || op.type === 'open-passage')
      );

      const isNoiseIncompatiblePair =
        (isNoiseSensitiveProfile(roomProfile) && isNoisyActivityProfile(neighborProfile)) ||
        (isNoiseSensitiveProfile(neighborProfile) && isNoisyActivityProfile(roomProfile)) ||
        (roomProfile === 'meeting-room' && isNoiseSensitiveProfile(neighborProfile)) ||
        (roomProfile === 'healthcare-consultation' && neighborProfile !== 'service-utility-wet');

      shared.push({
        neighborRoomId: other.id,
        neighborRoomName: other.name,
        neighborRoomType: other.type,
        neighborUseProfile: neighborProfile,
        sharedEdgeLengthMetres,
        wallOrientation,
        hasConnectingDoorOrPassage,
        isNoiseIncompatiblePair,
        incompatibilityReason: isNoiseIncompatiblePair
          ? `"${room.name}" (${getFunctionalProfileLabel(roomProfile)}) shares a ${sharedEdgeLengthMetres} m ${wallOrientation} partition with "${other.name}" (${getFunctionalProfileLabel(
              neighborProfile
            )}).`
          : undefined,
      });
    }
  }

  return shared;
}

/**
 * Domain D — Airborne Sound Insulation and Privacy Screening.
 * Enforces P36 Section 7 Domain D:
 * - Never assigns a tested STC, Rw, or sound-insulation rating from a generic label.
 * - Never treats a laboratory rating of one component as proof of complete as-built building performance.
 * - Flags missing junction details, door seals, flanking transmission, and penetrations.
 */
export function evaluateAirborneInsulationAndPrivacy(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig,
  allRoomConfigs: Record<string, RoomAcousticConfig>,
  availableAssemblies: AcousticAssemblyRecord[],
  customCriteriaOverrides: ConfiguredAcousticCriterion[] = []
): AirborneInsulationDomainResult {
  const sharedBoundaries = discoverSharedRoomBoundaries(project, room, allRoomConfigs);
  const activeCriterion = resolveActiveCriterion(
    roomConfig.functionalUseProfile,
    'partition-airborne-insulation-db',
    roomConfig,
    customCriteriaOverrides
  );

  const byAsmId = (id?: string) => availableAssemblies.find((a) => a.assemblyId === id) || null;
  const partitionAssembly =
    byAsmId(roomConfig.partitionAssemblyId) ||
    availableAssemblies.find((a) => a.assemblyId === 'asm-part-generic-unverified-wall') ||
    null;
  const doorAssembly =
    byAsmId(roomConfig.doorAssemblyId) ||
    availableAssemblies.find((a) => a.assemblyId === 'asm-door-generic-unsealed') ||
    null;
  const exteriorGlazingAssembly =
    byAsmId(roomConfig.exteriorGlazingAssemblyId) ||
    availableAssemblies.find((a) => a.assemblyId === 'asm-glaze-generic-double-unverified') ||
    null;

  // Check P30 Brief acoustic privacy requirements for this room
  const brief = initializeProjectBrief(project);
  const matchedBriefSpaces = (brief.spaces || []).filter(
    (s) =>
      s.name.toLowerCase().includes(room.name.toLowerCase()) ||
      room.name.toLowerCase().includes(s.name.toLowerCase()) ||
      s.category === room.type
  );
  const p30PrivacyRequired = matchedBriefSpaces.some((s) => s.acousticPrivacyRequired);

  const p30AcousticIsolationRelationships: string[] = [];
  for (const rel of brief.relationships || []) {
    if (rel.relationType === 'acoustic-isolated') {
      const srcSpace = brief.spaces.find((s) => s.id === rel.sourceSpaceId);
      const tgtSpace = brief.spaces.find((s) => s.id === rel.targetSpaceId);
      if (srcSpace && tgtSpace) {
        const matchesRoom =
          room.name.toLowerCase().includes(srcSpace.name.toLowerCase()) ||
          room.name.toLowerCase().includes(tgtSpace.name.toLowerCase()) ||
          srcSpace.name.toLowerCase().includes(room.name.toLowerCase()) ||
          tgtSpace.name.toLowerCase().includes(room.name.toLowerCase());
        if (matchesRoom) {
          p30AcousticIsolationRelationships.push(
            `P30 Brief Rule (${rel.priority}): "${srcSpace.name}" and "${tgtSpace.name}" require acoustic isolation.`
          );
        }
      }
    }
  }

  const componentVsAsBuiltDisclosure =
    'Simplified Airborne Privacy Screening (ISO 12354-1:2017 & ISO 717-1:2020 principles): A laboratory rating (STC or Rw) of an isolated wall or door component NEVER proves as-built field performance (DnT,w / ASTC). In-situ airborne sound insulation is governed by composite weak links (doors, glazing, unsealed gaps), structural flanking paths at wall/floor junctions, plenum bypass above suspended ceilings, and service penetrations.';

  const flankingAndDetailingLimitations: string[] = [];
  const identifiedPrivacyConcerns: string[] = [];

  if (!partitionAssembly || partitionAssembly.labAirborneRatingDb === null) {
    flankingAndDetailingLimitations.push(
      'Interior partition assembly has no verified laboratory sound-insulation test rating (STC/Rw); Plotify does not assign ratings from generic wall labels.'
    );
  } else {
    if (!partitionAssembly.hasVerifiedJunctionFlankingDetails) {
      flankingAndDetailingLimitations.push(
        `Partition "${partitionAssembly.displayName}" supplies a laboratory element rating (${partitionAssembly.labAirborneRatingDb} dB ${partitionAssembly.airborneRatingMetric}), but structural junction flanking details are unverified (expect 3–8 dB field derating per ISO 12354-1).`
      );
    }
    if (!partitionAssembly.hasVerifiedPerimeterAcousticSeals) {
      flankingAndDetailingLimitations.push(
        'Perimeter acoustic sealant at head, base, and abutment joints is not verified.'
      );
    }
  }

  if (!doorAssembly || !doorAssembly.hasAcousticDoorDropSeal) {
    flankingAndDetailingLimitations.push(
      'Interior door assembly lacks a verified perimeter acoustic seal and automatic bottom drop seal; doorway air gaps severely limit composite partition privacy.'
    );
  }

  const incompatibleNeighbors = sharedBoundaries.filter((b) => b.isNoiseIncompatiblePair);
  for (const nb of incompatibleNeighbors) {
    if (nb.incompatibilityReason) {
      identifiedPrivacyConcerns.push(nb.incompatibilityReason);
    }
    if (nb.hasConnectingDoorOrPassage && (!doorAssembly || doorAssembly.labAirborneRatingDb === null)) {
      identifiedPrivacyConcerns.push(
        `Direct connecting door or passage on shared ${nb.wallOrientation} wall between "${room.name}" and "${nb.neighborRoomName}" creates an immediate airborne sound transmission weak link.`
      );
    }
  }

  const requiresHighPrivacy =
    isNoiseSensitiveProfile(roomConfig.functionalUseProfile) ||
    roomConfig.acousticPriorities.includes('confidential-speech-privacy') ||
    p30PrivacyRequired ||
    p30AcousticIsolationRelationships.length > 0;

  if (
    requiresHighPrivacy &&
    partitionAssembly?.labAirborneRatingDb !== null &&
    partitionAssembly !== null &&
    partitionAssembly.labAirborneRatingDb < (activeCriterion.minTarget ?? 45)
  ) {
    identifiedPrivacyConcerns.push(
      `Assigned partition assembly "${partitionAssembly.displayName}" (${partitionAssembly.labAirborneRatingDb} dB ${partitionAssembly.airborneRatingMetric}) is below the ${
        activeCriterion.minTarget ?? 45
      } dB screening target for privacy-sensitive room "${room.name}".`
    );
  }

  let status: AcousticEvaluationStatus;
  let confidenceState: AcousticConfidenceState;

  if (!partitionAssembly || partitionAssembly.labAirborneRatingDb === null) {
    status = incompatibleNeighbors.length > 0 || requiresHighPrivacy ? 'concern-identified' : 'insufficient-evidence';
    confidenceState = 'insufficient-evidence';
  } else if (identifiedPrivacyConcerns.length > 0) {
    status = 'concern-identified';
    confidenceState = 'incomplete-evidence-requires-caution';
  } else {
    status = 'needs-review';
    confidenceState = 'incomplete-evidence-requires-caution';
  }

  const explanation =
    !partitionAssembly || partitionAssembly.labAirborneRatingDb === null
      ? `Airborne sound-insulation rating for "${room.name}" is unverified because no laboratory-tested partition assembly has been assigned (${sharedBoundaries.length} shared boundary wall(s) detected in 2D plan${
          incompatibleNeighbors.length > 0
            ? `, including ${incompatibleNeighbors.length} noise-incompatible adjacency`
            : ''
        }).`
      : identifiedPrivacyConcerns.length > 0
      ? `Airborne privacy screening for "${room.name}" identified ${identifiedPrivacyConcerns.length} concern(s) across ${sharedBoundaries.length} shared wall(s): ${identifiedPrivacyConcerns.join(' ')}`
      : `Partition assembly "${partitionAssembly.displayName}" (${partitionAssembly.labAirborneRatingDb} dB ${partitionAssembly.airborneRatingMetric} lab element rating) meets preliminary screening, but in-situ field performance requires verification of junction flanking, door seals, and service penetrations.`;

  return {
    domainId: 'domain-d-airborne-sound-insulation-and-privacy',
    status,
    confidenceState,
    sharedBoundaries,
    partitionAssembly,
    doorAssembly,
    exteriorGlazingAssembly,
    activeCriterion,
    p30PrivacyRequired,
    p30AcousticIsolationRelationships,
    componentVsAsBuiltDisclosure,
    flankingAndDetailingLimitations,
    identifiedPrivacyConcerns,
    explanation,
  };
}

/**
 * Domain E — Impact, Structure-Borne Sound, and Vibration Screening.
 * Inspects multi-storey room stacking across floor levels and structural framing without fabricating IIC/Ln,w or FEM vibration levels.
 */
export function evaluateImpactAndStructureBorne(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig,
  availableMaterials: AcousticSurfaceMaterialRecord[],
  availableAssemblies: AcousticAssemblyRecord[]
): ImpactStructureVibrationDomainResult {
  const allRooms = project.floorPlan?.rooms || [];
  const totalProjectFloors = Math.max(
    project.floors || 1,
    allRooms.reduce((m, r) => Math.max(m, r.floorLevel || 1), 1)
  );
  const framingSystem =
    project.structuralCoordination?.framingSystem || 'unspecified-structural-framing';
  const floorSlabAssembly =
    availableAssemblies.find((a) => a.assemblyId === roomConfig.floorSlabAssemblyId) ||
    availableAssemblies.find((a) => a.assemblyId === 'asm-slab-generic-unverified-floor') ||
    null;

  // Detect 2D horizontal overlap with rooms on Floor + 1 (above) and Floor - 1 (below)
  const verticallyAdjacentRoomsAbove: ImpactStructureVibrationDomainResult['verticallyAdjacentRoomsAbove'] = [];
  const verticallyAdjacentRoomsBelow: ImpactStructureVibrationDomainResult['verticallyAdjacentRoomsBelow'] = [];

  for (const other of allRooms) {
    if (other.id === room.id) continue;
    const xOverlap = Math.min(room.x + room.width, other.x + other.width) - Math.max(room.x, other.x);
    const yOverlap = Math.min(room.y + room.length, other.y + other.length) - Math.max(room.y, other.y);
    if (xOverlap > 0.1 && yOverlap > 0.1) {
      const overlapAreaM2 = round2(
        convertAreaToSquareMetres(xOverlap * yOverlap, project.unit) || 0
      );
      if (other.floorLevel === room.floorLevel + 1) {
        const otherCfg =
          project.acousticPlanner?.roomConfigs?.[other.id] ||
          createDefaultRoomAcousticConfig(project, other);
        const otherMats = resolveRoomSurfaceMaterials(project, other, otherCfg, availableMaterials);
        verticallyAdjacentRoomsAbove.push({
          roomId: other.id,
          roomName: other.name,
          roomType: other.type,
          overlapAreaM2,
          floorFinishName: otherMats.floor.displayName,
        });
      } else if (other.floorLevel === room.floorLevel - 1) {
        verticallyAdjacentRoomsBelow.push({
          roomId: other.id,
          roomName: other.name,
          roomType: other.type,
          overlapAreaM2,
        });
      }
    }
  }

  const resolvedMats = resolveRoomSurfaceMaterials(project, room, roomConfig, availableMaterials);
  const isHardFloorInThisRoom =
    resolvedMats.floor.acousticMaterialId.includes('concrete') ||
    resolvedMats.floor.acousticMaterialId.includes('stone') ||
    resolvedMats.floor.acousticMaterialId.includes('terrazzo') ||
    resolvedMats.floor.acousticMaterialId.includes('timber') ||
    resolvedMats.floor.acousticMaterialId.includes('walnut');

  const screeningChecklist: ImpactStructureVibrationDomainResult['screeningChecklist'] = [
    {
      itemId: 'chk-footfall-above',
      checkTitle: 'Overhead Footfall & Impact Transmission into This Room',
      status:
        verticallyAdjacentRoomsAbove.length === 0
          ? 'checked-ok'
          : floorSlabAssembly?.labImpactRatingDb !== null
          ? 'checked-ok'
          : 'flagged-concern',
      finding:
        verticallyAdjacentRoomsAbove.length === 0
          ? `No upper-storey rooms are stacked directly above "${room.name}" on Floor ${room.floorLevel + 1}.`
          : `${verticallyAdjacentRoomsAbove.length} room(s) on Floor ${
              room.floorLevel + 1
            } (${verticallyAdjacentRoomsAbove.map((r) => `${r.roomName} [${r.floorFinishName}]`).join(', ')}) overlap "${
              room.name
            }". ${
              floorSlabAssembly?.labImpactRatingDb !== null
                ? `Assigned slab assembly has laboratory impact rating ${floorSlabAssembly?.labImpactRatingDb} dB (${floorSlabAssembly?.impactRatingMetric}).`
                : 'No verified resilient acoustic underlayment or floating floor slab assembly is assigned; high footfall impact risk.'
            }`,
    },
    {
      itemId: 'chk-footfall-below',
      checkTitle: 'Footfall Impact Generated by This Room into Spaces Below',
      status:
        verticallyAdjacentRoomsBelow.length === 0
          ? 'checked-ok'
          : isHardFloorInThisRoom && (!floorSlabAssembly || floorSlabAssembly.labImpactRatingDb === null)
          ? 'flagged-concern'
          : 'unverified-needs-specialist',
      finding:
        verticallyAdjacentRoomsBelow.length === 0
          ? `Room "${room.name}" is on Floor ${room.floorLevel} with no modeled rooms directly beneath it.`
          : `"${room.name}" sits above ${verticallyAdjacentRoomsBelow
              .map((r) => r.roomName)
              .join(', ')} on Floor ${room.floorLevel - 1} with finish "${resolvedMats.floor.displayName}". ${
              isHardFloorInThisRoom && (!floorSlabAssembly || floorSlabAssembly.labImpactRatingDb === null)
                ? 'Hard floor finish over an unverified slab risks transmitting footfall and furniture-scraping impact noise below.'
                : 'Verify perimeter isolation strips to prevent flanking bridge transmission.'
            }`,
    },
    {
      itemId: 'chk-structural-framing-path',
      checkTitle: 'Structural Framing System & Low-Frequency Vibration Path',
      status:
        framingSystem === 'mass-timber-post-beam' || framingSystem === 'light-timber-framing'
          ? 'flagged-concern'
          : 'unverified-needs-specialist',
      finding: `Project structural framing is "${framingSystem.replace(/-/g, ' ')}". ${
        framingSystem.includes('timber')
          ? 'Lightweight or mass-timber floor assemblies are particularly sensitive to low-frequency footfall thud (50–100 Hz) and require ballast mass, resilient topping, or decoupled ceilings.'
          : 'Structure-borne vibration propagation across rigid frame junctions requires specialist acoustic/structural review where rotating plant or gym/music uses are present.'
      }`,
    },
  ];

  const hasFlagged = screeningChecklist.some((c) => c.status === 'flagged-concern');
  const status: AcousticEvaluationStatus = hasFlagged ? 'concern-identified' : 'needs-review';
  const confidenceState: AcousticConfidenceState =
    floorSlabAssembly?.labImpactRatingDb !== null
      ? 'incomplete-evidence-requires-caution'
      : 'insufficient-evidence';

  return {
    domainId: 'domain-e-impact-and-structure-borne',
    status,
    confidenceState,
    floorLevel: room.floorLevel,
    totalProjectFloors,
    verticallyAdjacentRoomsAbove,
    verticallyAdjacentRoomsBelow,
    floorSlabAssembly,
    structuralFramingSystem: framingSystem,
    screeningChecklist,
    specialistVibrationTestingRequiredNote:
      'Plotify does NOT invent impact sound insulation ratings (IIC / Ln,w) or perform structural finite-element vibration analysis. In-situ impact testing (ISO 16283-2 / ASTM E1007) and structural dynamics review are required for critical spaces.',
    explanation: hasFlagged
      ? `Impact and structure-borne screening for "${room.name}" flagged potential footfall or structural framing transmission concerns involving vertically stacked spaces or lightweight framing.`
      : `Preliminary impact checklist for "${room.name}" completed; verify resilient floor underlayment and structural isolation details with an acoustician.`,
  };
}

/**
 * Domain F — Mechanical Services Noise and Vibration Screening.
 * Inspects `project.mepCoordination?.components` (HVAC air handlers, heat pumps, rooftop units, exhaust fans, ducts, pumps).
 * Never runs airflow simulation or introduces P37's Natural Ventilation Scenario Analyzer.
 */
export function evaluateMechanicalServicesNoise(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig
): MechanicalNoiseDomainResult {
  const mepComponents = project.mepCoordination?.components || [];
  const nearbyOrInRoomMechanicalItems: MechanicalNoiseDomainResult['nearbyOrInRoomMechanicalItems'] = [];
  const flaggedPathwaysAndConsiderations: string[] = [];
  const missingEquipmentAcousticData: string[] = [
    'Octave-band sound power levels (Lw in dB re 10⁻¹² W) for HVAC fans, heat pumps, and terminal diffusers are not present in the architectural model.',
    'Ductwork acoustic lining thickness, insertion loss of duct attenuators/silencers, and airflow regeneration velocity are not modeled.',
    'Anti-vibration spring/neoprene isolator deflection specifications for mechanical plant are not modeled.',
  ];

  const rLeft = room.x;
  const rRight = room.x + room.width;
  const rTop = room.y;
  const rBottom = room.y + room.length;
  const nearThresholdMetres = 3.0;

  for (const comp of mepComponents) {
    if (comp.floorLevel !== room.floorLevel) continue;

    // Check localized equipment with `location`
    if (comp.location) {
      const cLeft = comp.location.x;
      const cRight = comp.location.x + (comp.location.width || 1);
      const cTop = comp.location.y;
      const cBottom = comp.location.y + (comp.location.length || 1);

      const dx = Math.max(0, Math.max(rLeft - cRight, cLeft - rRight));
      const dy = Math.max(0, Math.max(rTop - cBottom, cTop - rBottom));
      const distProjectUnits = Math.hypot(dx, dy);
      const distMetres = round2(
        distProjectUnits === 0
          ? 0
          : convertLengthToMetres(distProjectUnits, project.unit) || 0
      );

      if (distMetres === 0) {
        nearbyOrInRoomMechanicalItems.push({
          componentId: comp.id,
          componentName: comp.name,
          subtype: comp.subtype,
          relationToRoom: 'inside-room',
          distanceMetres: 0,
          finding: `MEP equipment "${comp.name}" (${comp.subtype}) is located inside "${room.name}" on Floor ${room.floorLevel}.`,
        });
      } else if (distMetres <= nearThresholdMetres) {
        nearbyOrInRoomMechanicalItems.push({
          componentId: comp.id,
          componentName: comp.name,
          subtype: comp.subtype,
          relationToRoom: 'adjacent-within-3m',
          distanceMetres: distMetres,
          finding: `MEP equipment "${comp.name}" (${comp.subtype}) is located ${distMetres} m from "${room.name}" on Floor ${room.floorLevel}.`,
        });
      }
    }

    // Check linear duct/pipe segments passing through the room
    const segments = comp.segments || comp.routeSegments || [];
    for (const seg of segments) {
      const minX = Math.min(seg.startX, seg.endX);
      const maxX = Math.max(seg.startX, seg.endX);
      const minY = Math.min(seg.startY, seg.endY);
      const maxY = Math.max(seg.startY, seg.endY);
      const xOverlap = Math.min(rRight, maxX) - Math.max(rLeft, minX);
      const yOverlap = Math.min(rBottom, maxY) - Math.max(rTop, minY);

      if (xOverlap >= 0 && yOverlap >= 0) {
        if (!nearbyOrInRoomMechanicalItems.some((i) => i.componentId === comp.id)) {
          nearbyOrInRoomMechanicalItems.push({
            componentId: comp.id,
            componentName: comp.name,
            subtype: comp.subtype,
            relationToRoom: 'duct-route-passing-through',
            distanceMetres: 0,
            finding: `Linear MEP route "${comp.name}" (${comp.subtype}) passes through or above "${room.name}".`,
          });
        }
      }
    }
  }

  const isSensitive = isNoiseSensitiveProfile(roomConfig.functionalUseProfile);
  for (const item of nearbyOrInRoomMechanicalItems) {
    if (
      item.subtype.includes('hvac') ||
      item.subtype.includes('heat-pump') ||
      item.subtype.includes('air-handler') ||
      item.subtype.includes('exhaust-fan') ||
      item.subtype.includes('transformer')
    ) {
      flaggedPathwaysAndConsiderations.push(
        `Active mechanical/electrical equipment "${item.componentName}" (${item.subtype}) is ${
          item.relationToRoom === 'inside-room' ? 'inside' : `${item.distanceMetres} m from`
        } ${isSensitive ? 'noise-sensitive room' : 'room'} "${
          room.name
        }". Verify acoustic enclosure, resilient mounts, and flexible duct/pipe connectors.`
      );
    } else if (item.subtype.includes('duct')) {
      flaggedPathwaysAndConsiderations.push(
        `Ductwork route "${item.componentName}" serving or traversing "${room.name}" can create "crosstalk" airborne sound transfer between adjacent rooms and breakout fan noise unless lined or fitted with crosstalk attenuators.`
      );
    } else if (item.subtype.includes('sanitary-soil-pipe')) {
      flaggedPathwaysAndConsiderations.push(
        `Sanitary soil stack "${item.componentName}" near "${room.name}" requires acoustic pipe lagging and boxedchase isolation to prevent water-flush noise intrusion.`
      );
    }
  }

  const p37VentilationBoundaryNote =
    'Scope Lock Boundary: P36 screens mechanical equipment proximity, duct crosstalk pathways, and vibration isolation requirements. It does NOT perform airflow simulation or natural ventilation scenario analysis (reserved for P37 — Natural Ventilation Scenario Analyzer).';

  const status: AcousticEvaluationStatus =
    flaggedPathwaysAndConsiderations.length > 0 && isSensitive
      ? 'concern-identified'
      : mepComponents.length === 0
      ? 'insufficient-evidence'
      : 'needs-review';

  const confidenceState: AcousticConfidenceState =
    mepComponents.length === 0
      ? 'insufficient-evidence'
      : 'incomplete-evidence-requires-caution';

  const explanation =
    mepComponents.length === 0
      ? `No MEP components are currently placed in the project's MEP Coordination register; mechanical services noise cannot be screened until HVAC/plumbing elements are defined.`
      : flaggedPathwaysAndConsiderations.length > 0
      ? `Mechanical services screening for "${room.name}" identified ${flaggedPathwaysAndConsiderations.length} coordination item(s) across ${nearbyOrInRoomMechanicalItems.length} nearby/in-room MEP component(s). Plotify does not claim compliance with a room NC/NR/dBA mechanical noise limit without manufacturer octave-band sound power data.`
      : `Inspected ${mepComponents.length} project MEP component(s); none are placed directly inside or within 3.0 m of "${room.name}". Verify HVAC terminal diffuser noise and duct attenuators during detailed MEP design.`;

  return {
    domainId: 'domain-f-mechanical-services-noise',
    status,
    confidenceState,
    mepComponentsInspectedCount: mepComponents.length,
    nearbyOrInRoomMechanicalItems,
    flaggedPathwaysAndConsiderations,
    missingEquipmentAcousticData,
    p37VentilationBoundaryNote,
    explanation,
  };
}

/**
 * Domain G — Acoustic Zoning and Spatial Coordination.
 * Synthesizes 2D room adjacency, vertical stacking, connecting doors, P30 isolation rules,
 * P33 furniture placement, and P34 accessibility coordination.
 */
export function evaluateAcousticZoningAndCoordination(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig,
  domainD: AirborneInsulationDomainResult,
  domainE: ImpactStructureVibrationDomainResult,
  domainF: MechanicalNoiseDomainResult
): AcousticZoningDomainResult {
  const adjacencyConflicts: AcousticZoningDomainResult['adjacencyConflicts'] = [];
  const furnitureAndOpeningObservations: string[] = [];
  const p34AccessibilityCoordinationNotes: string[] = [];

  for (const b of domainD.sharedBoundaries) {
    if (b.isNoiseIncompatiblePair) {
      adjacencyConflicts.push({
        conflictId: `zoning-shared-${room.id}-${b.neighborRoomId}`,
        sourceRoomName: room.name,
        targetRoomName: b.neighborRoomName,
        relationshipKind: b.hasConnectingDoorOrPassage ? 'connecting-door' : 'shared-wall',
        severity: b.hasConnectingDoorOrPassage ? 'high-concern' : 'moderate-review',
        explanation: `${b.incompatibilityReason || ''}${
          b.hasConnectingDoorOrPassage
            ? ' A direct doorway or open passage connects these acoustically incompatible spaces.'
            : ' Consider buffer storage/corridor zoning or an upgraded decoupled partition.'
        }`,
      });
    }
  }

  if (isNoiseSensitiveProfile(roomConfig.functionalUseProfile)) {
    for (const above of domainE.verticallyAdjacentRoomsAbove) {
      const aboveType = `${above.roomType} ${above.roomName}`.toLowerCase();
      if (
        aboveType.includes('living') ||
        aboveType.includes('kitchen') ||
        aboveType.includes('dining') ||
        aboveType.includes('bath') ||
        aboveType.includes('laundry') ||
        aboveType.includes('gym')
      ) {
        adjacencyConflicts.push({
          conflictId: `zoning-vertical-${room.id}-${above.roomId}`,
          sourceRoomName: room.name,
          targetRoomName: above.roomName,
          relationshipKind: 'vertical-stack',
          severity: 'high-concern',
          explanation: `Active/wet room "${above.roomName}" (Floor ${room.floorLevel + 1}) is stacked directly over noise-sensitive room "${room.name}" (Floor ${room.floorLevel}, ${above.overlapAreaM2} m² overlap).`,
        });
      }
    }
  }

  for (let idx = 0; idx < domainD.p30AcousticIsolationRelationships.length; idx++) {
    const relText = domainD.p30AcousticIsolationRelationships[idx];
    adjacencyConflicts.push({
      conflictId: `zoning-p30-${room.id}-${idx}`,
      sourceRoomName: room.name,
      targetRoomName: 'P30 Brief Programmed Space',
      relationshipKind: 'p30-brief-isolation-rule',
      severity: 'high-concern',
      explanation: relText,
    });
  }

  // Inspect P33 furniture placement relative to shared walls & doorways (without claiming dB reductions)
  const furnitureData = ensureProjectFurnitureLayoutData(project);
  const roomFurniture = (furnitureData.instances || []).filter((i) => i.roomId === room.id);
  const storageOrBookcaseItems = roomFurniture.filter((i) => i.category === 'storage-cabinetry');
  const sleepingOrWorkItems = roomFurniture.filter(
    (i) => i.category === 'sleeping' || i.category === 'work-office'
  );

  if (sleepingOrWorkItems.length > 0 && domainD.sharedBoundaries.some((b) => b.isNoiseIncompatiblePair)) {
    furnitureAndOpeningObservations.push(
      `Room "${room.name}" contains ${sleepingOrWorkItems.length} sleeping/work furniture item(s) (${sleepingOrWorkItems
        .map((i) => i.name)
        .join(', ')}) while sharing a wall with an active/noisy space. Review bed headboard and desk placement so occupants are not positioned directly against the shared noisy partition.`
    );
  }
  if (storageOrBookcaseItems.length > 0) {
    furnitureAndOpeningObservations.push(
      `Placed storage cabinetry (${storageOrBookcaseItems.map((i) => i.name).join(', ')}) can serve as a spatial buffer along shared partitions, though Plotify does NOT claim a decibel sound-insulation bonus from furniture alone.`
    );
  }

  // P34 Universal Accessibility coordination notes
  p34AccessibilityCoordinationNotes.push(
    'P34 Universal Accessibility Coordination: Acoustic wall linings, double-stud partition thickening, or acoustic door seals must NOT encroach upon required 1.50 m (60 in) wheelchair turning circles, 0.90 m (36 in) clear accessible routes, or 0.85 m (32 in) minimum clear door opening widths.'
  );
  if (domainD.doorAssembly?.hasAcousticDoorDropSeal) {
    p34AccessibilityCoordinationNotes.push(
      'Acoustic door drop seals must be flush-mounted automatic plunger seals rather than raised rigid floor thresholds, preserving P34 step-free doorway threshold limits.'
    );
  }

  const hasHighConflict =
    adjacencyConflicts.some((c) => c.severity === 'high-concern') ||
    domainF.nearbyOrInRoomMechanicalItems.some((m) => m.relationToRoom === 'inside-room');

  const status: AcousticEvaluationStatus = hasHighConflict
    ? 'concern-identified'
    : adjacencyConflicts.length > 0
    ? 'needs-review'
    : 'estimated-within-target';

  const confidenceState: AcousticConfidenceState =
    (project.floorPlan?.rooms?.length || 0) > 1
      ? 'sufficient-for-preliminary-calculation'
      : 'incomplete-evidence-requires-caution';

  return {
    domainId: 'domain-g-acoustic-zoning-and-coordination',
    status,
    confidenceState,
    adjacencyConflicts,
    furnitureAndOpeningObservations,
    p34AccessibilityCoordinationNotes,
    noSimulatedPropagationDisclaimer:
      'These observations are geometry-aware architectural zoning checks based on 2D shared boundaries and vertical floor stacking; they do not represent 3D wave-propagation simulation or promise decibel reductions from furniture placement.',
    explanation:
      adjacencyConflicts.length === 0
        ? `Spatial acoustic zoning check for "${room.name}" found no direct shared-wall or vertical-stacking conflicts with incompatible room activities.`
        : `Spatial acoustic zoning check for "${room.name}" identified ${adjacencyConflicts.length} adjacency/stacking coordination conflict(s) requiring buffer zoning or assembly upgrades.`,
  };
}

/**
 * Domain H — Actionable Acoustic Improvements Generator (P36 Section 7 Domain H).
 * Every recommendation includes all 9 required attributes, P35 moisture/climate compatibility checks,
 * P34 accessibility impact notes, and a previewable/applicable mutation payload where supported.
 */
export function generateAcousticRecommendations(
  project: Project,
  room: FloorPlanRoom,
  roomConfig: RoomAcousticConfig,
  geometry: RoomAcousticGeometryValidation,
  domainA: ReverberationDomainResult,
  domainB: SpeechFunctionalDomainResult,
  domainC: BackgroundNoiseDomainResult,
  domainD: AirborneInsulationDomainResult,
  domainE: ImpactStructureVibrationDomainResult,
  domainF: MechanicalNoiseDomainResult,
  domainG: AcousticZoningDomainResult,
  availableMaterials: AcousticSurfaceMaterialRecord[]
): AcousticImprovementRecommendation[] {
  const recommendations: AcousticImprovementRecommendation[] = [];
  const p35Advisor = initializeProjectMaterialAdvisorData(project);
  const p35Catalogue = BUILTIN_CLIMATE_MATERIAL_CATALOGUE;

  const isWetRoom =
    roomConfig.functionalUseProfile === 'service-utility-wet' ||
    /bath|wc|toilet|shower|kitchen|laundry|wet/i.test(`${room.type} ${room.name}`);

  // 1. Missing Geometry / Ceiling Height or Missing Absorption Data Recommendation
  if (domainA.status === 'insufficient-evidence') {
    recommendations.push({
      recommendationId: `rec-data-completeness-${room.id}`,
      roomId: room.id,
      roomName: room.name,
      category: 'missing-material-or-measurement-data',
      priority: 'high',
      title: 'Supply Missing Room Ceiling Height & Verified Surface Absorption Data',
      issueAddressed:
        'Sabine reverberation time (RT60) cannot be calculated with confidence because room ceiling height or surface absorption coefficients are missing.',
      triggeringInputOrObservation:
        geometry.ceilingHeightMetres === null
          ? `Room "${room.name}" has 2D floor dimensions (${room.width} × ${room.length} ${project.unit}) but ceilingHeight is null.`
          : `One or more surfaces in "${room.name}" use an unverified material lacking octave-band absorption coefficients.`,
      relevanceExplanation:
        'Sabine reverberation prediction (RT60 ≈ 0.161 × V / A) requires both accurate 3D room volume V (m³) and documented octave-band absorption coefficients αᵢ for all boundary surfaces.',
      requiredConditionsForEffectiveness: [
        'Verify clear floor-to-ceiling height from architectural section drawings or on-site laser measurement.',
        'Select materials backed by ISO 354 / ASTM C423 reverberation-room test reports or ASHRAE Ch. 8 reference tables.',
      ],
      supportingEvidence:
        'ISO 3382-2:2008 & ASHRAE Handbook — Fundamentals Ch. 8 input requirements for room acoustic calculation.',
      remainingUnknowns: [
        'Actual room ceiling height and plenum depth.',
        'Exact product-specific absorption coefficients if custom finishes are specified.',
      ],
      expectedBenefitKind: 'qualitative',
      expectedBenefitSummary:
        'Enables deterministic octave-band (125–4000 Hz) Sabine RT60 estimation and surface absorption breakdown without fabricated assumptions.',
      requiresArchitecturalDesignChange: false,
      multidisciplinaryTradeOffs: {
        spaceAndClearance: 'None — data entry and specification verification only.',
        appearanceAndStyle: 'None.',
        costAndBuildability: 'No construction cost impact.',
        moistureAndClimateCompatibility: 'Allows cross-checking selected finishes against P35 climate/moisture rules.',
        fireAndMaintenance: 'Clarifies required fire and maintenance documentation.',
        accessibilityP34Impact: 'None — preserves all P34 clearances.',
      },
      canPreviewAndApplyInPlotify: false,
    });
  }

  // 2. Excessive Reverberation (RT60 > maxTarget) — Recommend Surface Sound Absorption Upgrade
  if (
    domainA.midFrequencyEstimatedRt60Seconds !== null &&
    domainA.midFrequencyEstimatedRt60Seconds > domainA.activeCriterion.maxTarget &&
    geometry.roomVolumeM3 !== null &&
    geometry.netWallAreaM2 !== null &&
    geometry.ceilingAreaM2 !== null &&
    geometry.floorAreaM2 !== null
  ) {
    const currentRt60 = domainA.midFrequencyEstimatedRt60Seconds;
    const targetMax = domainA.activeCriterion.maxTarget;

    if (!isWetRoom) {
      // For dry habitable rooms, calculate exact estimated RT60 after upgrading wall finish to acoustic felt or slatted timber
      const feltMat = availableMaterials.find(
        (m) => m.acousticMaterialId === 'ac-wall-acoustic-felt-panels'
      );
      const p35FeltCandidate = p35Catalogue.find((c) => c.materialId === 'mat-int-acoustic-pet-felt');
      const p35FeltEval = p35FeltCandidate
        ? evaluateMaterialCandidateForClimate(
            project,
            p35FeltCandidate,
            'interior-wall-finish',
            p35Advisor.climateContext,
            { targetRoomId: room.id }
          )
        : undefined;

      // Calculate exact projected RT60 at 500–1000 Hz with felt wall panels using Sabine formula
      const resolvedMats = resolveRoomSurfaceMaterials(project, room, roomConfig, availableMaterials);
      let projectedRt60: number | null = null;
      if (feltMat) {
        const calcBandRt = (band: 500 | 1000) => {
          const aCeil = (resolvedMats.ceiling.octaveBandAbsorption[band] || 0.05) * geometry.ceilingAreaM2!;
          const aWall = (feltMat.octaveBandAbsorption[band] || 0.75) * geometry.netWallAreaM2!;
          const aFlr = (resolvedMats.floor.octaveBandAbsorption[band] || 0.05) * geometry.floorAreaM2!;
          const aDoor = (resolvedMats.door.octaveBandAbsorption[band] || 0.06) * geometry.knownDoorAreaM2;
          const aWin = (resolvedMats.window.octaveBandAbsorption[band] || 0.03) * geometry.knownWindowAreaM2;
          const totalA = aCeil + aWall + aFlr + aDoor + aWin;
          return totalA > 0 ? (SABINE_CONSTANT_SI * geometry.roomVolumeM3!) / totalA : null;
        };
        const r500 = calcBandRt(500);
        const r1000 = calcBandRt(1000);
        if (r500 !== null && r1000 !== null) {
          projectedRt60 = round2((r500 + r1000) / 2);
        }
      }

      recommendations.push({
        recommendationId: `rec-wall-absorption-felt-${room.id}`,
        roomId: room.id,
        roomName: room.name,
        category: 'surface-sound-absorption-treatment',
        priority: 'high',
        title: 'Apply Acoustic PET Felt Wall Treatment to Reduce Reverberation',
        issueAddressed: `Mid-frequency reverberation time in "${room.name}" is estimated at ${currentRt60} s, exceeding the configured ${targetMax} s upper target for ${getFunctionalProfileLabel(
          roomConfig.functionalUseProfile
        )}.`,
        triggeringInputOrObservation: `Net wall area (${geometry.netWallAreaM2} m²) and ceiling (${geometry.ceilingAreaM2} m²) are dominated by sound-reflective finishes (${domainA.topReflectiveSurfacesSummary.join('; ') || 'low α coefficients'}).`,
        relevanceExplanation:
          'Adding porous sound absorption (24 mm high-density PET acoustic felt panels, α_500 = 0.65, α_1000 = 0.85) to wall surfaces increases equivalent absorption area A (m² sabins) and directly lowers reverberation time and flutter echo.',
        requiredConditionsForEffectiveness: [
          'Install 24 mm high-density (≥ 2400 g/m²) PET felt panels with a 25 mm rear air cavity over the treated wall area.',
          'Distribute panels across orthogonal walls to suppress parallel-wall flutter echo.',
          'Keep room dry and conditioned (do not install fibrous felt in wet splash zones).',
        ],
        supportingEvidence:
          'Sabine calculation (RT60 ≈ 0.161 × V / A) using ISO 354 laboratory absorption data for 24 mm acoustic PET felt (ac-wall-acoustic-felt-panels).',
        remainingUnknowns: [
          'Exact fraction of wall area covered if partial feature-wall panels are used instead of full wall coverage.',
          'Low-frequency modal decay below 250 Hz.',
        ],
        expectedBenefitKind: projectedRt60 !== null ? 'estimated' : 'qualitative',
        expectedBenefitSummary:
          projectedRt60 !== null
            ? `Estimated Sabine mid-frequency RT60 reduces from ${currentRt60} s to ${projectedRt60} s (note: high surface absorption qualifies the classical Sabine diffuse-field approximation).`
            : 'Substantially increases mid- and high-frequency sound absorption to control reverberation.',
        requiresArchitecturalDesignChange: true,
        multidisciplinaryTradeOffs: {
          spaceAndClearance: 'Adds ~25–50 mm surface build-up on walls; does not reduce P34 floor turning circles when kept clear of tight doorway latch clearances.',
          appearanceAndStyle: 'Changes interior wall finish to textured acoustic felt panels (`acoustic-felt`).',
          costAndBuildability: 'Moderate interior finish cost uplift compared to painted drywall; simple clip/batten installation.',
          moistureAndClimateCompatibility:
            p35FeltEval?.overallStatus === 'not-recommended-for-screened-conditions'
              ? `P35 Warning: ${p35FeltEval.whySuitableOrUnsuitableSummary}`
              : 'Suitable for dry interior habitable rooms; NOT suitable for wet rooms (bathrooms/kitchens) per P35.',
          fireAndMaintenance: 'Specify ASTM E84 Class A / EN 13501-1 B-s1,d0 fire-rated panels; requires periodic vacuuming.',
          accessibilityP34Impact: 'Preserves 2D floor clearances and 1.50 m turning circles.',
        },
        p35MaterialSuitabilityStatus: p35FeltEval?.overallStatus,
        p35CompatibilityWarning:
          p35FeltEval && p35FeltEval.overallStatus !== 'suitable-for-screened-conditions'
            ? p35FeltEval.whySuitableOrUnsuitableSummary
            : undefined,
        canPreviewAndApplyInPlotify: true,
        proposedMutation: {
          roomId: room.id,
          proposedInteriorWallFinish: 'acoustic-felt',
          proposedDesignPriority: 'acoustic-warmth',
          proposedWallAcousticMaterialId: 'ac-wall-acoustic-felt-panels',
        },
      });
    } else {
      // Wet room with excessive reverberation: Explicitly warn against moisture-sensitive felt/timber and recommend moisture-resistant perforated gypsum ceiling!
      const wetCeilingMat = availableMaterials.find(
        (m) => m.acousticMaterialId === 'ac-ceil-moisture-resistant-perforated-gypsum'
      );
      const resolvedMats = resolveRoomSurfaceMaterials(project, room, roomConfig, availableMaterials);
      let projectedWetRt60: number | null = null;
      if (wetCeilingMat) {
        const calcWetBand = (band: 500 | 1000) => {
          const aCeil = (wetCeilingMat.octaveBandAbsorption[band] || 0.65) * geometry.ceilingAreaM2!;
          const aWall = (resolvedMats.wall.octaveBandAbsorption[band] || 0.05) * geometry.netWallAreaM2!;
          const aFlr = (resolvedMats.floor.octaveBandAbsorption[band] || 0.02) * geometry.floorAreaM2!;
          const totalA = aCeil + aWall + aFlr;
          return totalA > 0 ? (SABINE_CONSTANT_SI * geometry.roomVolumeM3!) / totalA : null;
        };
        const r500 = calcWetBand(500);
        const r1000 = calcWetBand(1000);
        if (r500 !== null && r1000 !== null) {
          projectedWetRt60 = round2((r500 + r1000) / 2);
        }
      }

      recommendations.push({
        recommendationId: `rec-wet-room-ceiling-absorption-${room.id}`,
        roomId: room.id,
        roomName: room.name,
        category: 'ceiling-or-wall-finish-upgrade',
        priority: 'high',
        title: 'Use Moisture-Resistant Perforated Gypsum Acoustic Ceiling (Wet-Room Safe)',
        issueAddressed: `Wet/service room "${room.name}" has an estimated mid-frequency RT60 of ${currentRt60} s (target ≤ ${targetMax} s), and standard porous felt or untreated timber slats are incompatible with wet-room moisture (P35 constraint).`,
        triggeringInputOrObservation: `Room "${room.name}" is classified as a wet/service space with hard water-resistant wall/floor finishes.`,
        relevanceExplanation:
          'In wet rooms (bathrooms, kitchens, laundries), P35 prohibits moisture-sensitive fibrous wall felts and untreated timber slats in splash zones. Installing a moisture-resistant perforated gypsum ceiling backed by hydrophobic acoustic fleece absorbs overhead sound while preserving wipeable, water-resistant lower walls and floors.',
        requiredConditionsForEffectiveness: [
          'Provide a 100 mm ceiling suspension cavity with hydrophobic non-woven acoustic fleece.',
          'Maintain mechanical exhaust extraction to control peak humidity.',
          'Do NOT install standard PET felt or untreated timber slats in wet splash zones.',
        ],
        supportingEvidence:
          'P35 Envelope & Wet-Room Compatibility Rules + ISO 354 perforated gypsum absorption dataset (ac-ceil-moisture-resistant-perforated-gypsum).',
        remainingUnknowns: [
          'Available structural slab-to-ceiling plenum height for 100 mm suspension.',
        ],
        expectedBenefitKind: projectedWetRt60 !== null ? 'estimated' : 'qualitative',
        expectedBenefitSummary:
          projectedWetRt60 !== null
            ? `Estimated Sabine mid-frequency RT60 reduces from ${currentRt60} s to ${projectedWetRt60} s while preserving wet-room moisture compatibility.`
            : 'Reduces reverberant clatter in wet/service rooms without introducing mold-prone wall fabrics.',
        requiresArchitecturalDesignChange: true,
        multidisciplinaryTradeOffs: {
          spaceAndClearance: 'Requires 100 mm ceiling plenum drop; zero impact on floor circulation.',
          appearanceAndStyle: 'Perforated architectural gypsum ceiling with recessed perimeter detail.',
          costAndBuildability: 'Moderate ceiling suspension cost.',
          moistureAndClimateCompatibility:
            'Preserves P35 wet-room moisture durability (avoids mold/warping of porous wall felts or timber slats).',
          fireAndMaintenance: 'Non-combustible gypsum core; repaint with short-nap roller only to avoid plugging perforations.',
          accessibilityP34Impact: 'Zero impact on wheelchair turning space or fixture transfer clearances.',
        },
        p35MaterialSuitabilityStatus: 'suitable-for-screened-conditions',
        canPreviewAndApplyInPlotify: true,
        proposedMutation: {
          roomId: room.id,
          proposedInteriorCeilingFinish: 'recessed-cove',
          proposedCeilingAcousticMaterialId: 'ac-ceil-moisture-resistant-perforated-gypsum',
        },
      });
    }
  }

  // 3. Airborne Sound Insulation & Door Seal Upgrade (Domain D / Domain G)
  if (
    domainD.status === 'concern-identified' ||
    domainG.adjacencyConflicts.length > 0 ||
    domainD.partitionAssembly?.labAirborneRatingDb === null
  ) {
    recommendations.push({
      recommendationId: `rec-partition-and-door-privacy-${room.id}`,
      roomId: room.id,
      roomName: room.name,
      category: 'partition-or-floor-assembly-review',
      priority: 'high',
      title: 'Specify Decoupled Double-Stud Insulated Partition & Acoustic Sealed Door Set',
      issueAddressed:
        domainD.identifiedPrivacyConcerns.length > 0
          ? domainD.identifiedPrivacyConcerns.join(' ')
          : `Partition and doorway sound insulation for "${room.name}" are unverified across ${domainD.sharedBoundaries.length} shared boundary wall(s).`,
      triggeringInputOrObservation: `Room "${room.name}" (${getFunctionalProfileLabel(
        roomConfig.functionalUseProfile
      )}) has ${domainD.sharedBoundaries.length} shared boundary wall(s) and partition assembly "${
        domainD.partitionAssembly?.displayName || 'Unverified'
      }".`,
      relevanceExplanation:
        'Replacing a generic or single-stud wall with a decoupled double-stud partition (2×12.5 mm gypsum each side + 100 mm mineral wool, lab Rw 54 dB) and sealing interior doorways with solid-core leaves and automatic drop seals (lab Rw 35 dB) addresses both partition transmission and doorway air-gap leakage.',
      requiredConditionsForEffectiveness: [
        'Extend acoustic partition from structural slab to structural slab (or install plenum sound barriers above suspended ceilings).',
        'Seal all perimeter junctions with flexible acoustic mastic and avoid back-to-back electrical outlet boxes.',
        'Install continuous perimeter compression gaskets and a flush automatic bottom drop seal on connecting doors.',
      ],
      supportingEvidence:
        'ISO 12354-1:2017 flanking transmission principles & ISO 717-1:2020 laboratory assembly datasets (asm-part-double-stud-insulated-lab, asm-door-solid-core-drop-seal-lab).',
      remainingUnknowns: [
        'In-situ flanking transmission loss at structural slab/facade junctions (typically reduces field DnT,w by 3–8 dB below component lab Rw).',
        'HVAC duct crosstalk paths between adjacent rooms.',
      ],
      expectedBenefitKind: 'qualitative',
      expectedBenefitSummary:
        'Establishes a documented laboratory component baseline (partition Rw 54 dB, door set Rw 35 dB) and flags mandatory junction/seal conditions for field privacy.',
      requiresArchitecturalDesignChange: true,
      multidisciplinaryTradeOffs: {
        spaceAndClearance:
          'Double-stud partition increases wall thickness by ~50–75 mm; verify in P33/P34 that net room width still satisfies wheelchair turning circle requirements.',
        appearanceAndStyle: 'Concealed within partition cavity; flush door frame gaskets.',
        costAndBuildability: 'Higher framing, drywall, and acoustic door hardware cost; requires careful contractor sealing QA.',
        moistureAndClimateCompatibility: 'Use moisture-resistant gypsum board on wet-room sides of shared partitions (P35).',
        fireAndMaintenance: 'Double-layer gypsum improves fire resistance; periodically inspect door drop-seal actuation.',
        accessibilityP34Impact:
          'Automatic plunger drop seals maintain a flush step-free threshold (≤ 0.5 in / 12 mm per P34), but door closer latch weight must remain operable with one hand.',
      },
      canPreviewAndApplyInPlotify: true,
      proposedMutation: {
        roomId: room.id,
        proposedPartitionAssemblyId: 'asm-part-double-stud-insulated-lab',
        proposedDoorAssemblyId: 'asm-door-solid-core-drop-seal-lab',
      },
    });
  }

  // 4. Mechanical Services (MEP) Noise & Vibration Coordination (Domain F)
  if (domainF.flaggedPathwaysAndConsiderations.length > 0) {
    recommendations.push({
      recommendationId: `rec-mep-isolation-${room.id}`,
      roomId: room.id,
      roomName: room.name,
      category: 'mechanical-equipment-isolation-review',
      priority: isNoiseSensitiveProfile(roomConfig.functionalUseProfile) ? 'high' : 'medium',
      title: 'Specify HVAC Duct Attenuators, Acoustic Pipe Lagging & Anti-Vibration Mounts',
      issueAddressed: domainF.flaggedPathwaysAndConsiderations.join(' '),
      triggeringInputOrObservation: `${domainF.nearbyOrInRoomMechanicalItems.length} MEP component(s) (${domainF.nearbyOrInRoomMechanicalItems
        .map((m) => m.componentName)
        .join(', ')}) detected inside or within 3.0 m of "${room.name}".`,
      relevanceExplanation:
        'Mechanical equipment and unlined ductwork near quiet rooms transmit both airborne fan/flow noise and structure-borne vibration into room boundary surfaces.',
      requiredConditionsForEffectiveness: [
        'Obtain manufacturer octave-band sound power levels (Lw, 63 Hz – 8000 Hz) for all HVAC fans and heat pumps.',
        'Install flexible canvas/elastomeric duct connectors and rated spring/neoprene vibration isolators on rotating equipment.',
        'Fit crosstalk attenuators on supply/return branches serving adjacent private rooms.',
      ],
      supportingEvidence:
        'ASHRAE Handbook — Fundamentals Ch. 8 & ASHRAE Applications Ch. 49 (Noise and Vibration Control).',
      remainingUnknowns: [
        'Equipment operating static pressure, airflow velocity, and octave-band sound power spectra.',
      ],
      expectedBenefitKind: 'qualitative',
      expectedBenefitSummary:
        'Mitigates mechanical hum, duct crosstalk, and structure-borne plant vibration before construction.',
      requiresArchitecturalDesignChange: true,
      multidisciplinaryTradeOffs: {
        spaceAndClearance: 'Duct silencers and acoustic lagging require additional ceiling plenum or riser shaft clearance (check MEP Clash Engine).',
        appearanceAndStyle: 'Concealed above ceilings or within service risers.',
        costAndBuildability: 'Requires coordination between architectural layout, structural supports, and MEP subcontractor submittals.',
        moistureAndClimateCompatibility: 'Use closed-cell or foil-faced antimicrobial acoustic duct lining where condensation risk exists.',
        fireAndMaintenance: 'Ensure fire dampers and access panels remain accessible.',
        accessibilityP34Impact: 'None when installed within mechanical risers/plenums.',
      },
      canPreviewAndApplyInPlotify: false,
    });
  }

  // 5. Professional Acoustician Referral (when high-priority privacy, music use, or unresolved conflicts exist)
  if (
    roomConfig.functionalUseProfile === 'music-performance' ||
    roomConfig.functionalUseProfile === 'healthcare-consultation' ||
    roomConfig.functionalUseProfile === 'classroom-learning' ||
    domainD.p30PrivacyRequired ||
    domainC.exceedsConfiguredTarget === true
  ) {
    recommendations.push({
      recommendationId: `rec-professional-acoustician-${room.id}`,
      roomId: room.id,
      roomName: room.name,
      category: 'professional-acoustician-referral',
      priority: 'advisory',
      title: 'Refer Critical Room Acoustic & Flanking Design to a Qualified Acoustician',
      issueAddressed: `Room "${room.name}" (${getFunctionalProfileLabel(
        roomConfig.functionalUseProfile
      )}) has specialized acoustic performance or statutory/brief privacy requirements that exceed simplified Sabine and element-level screening.`,
      triggeringInputOrObservation: `Functional profile "${roomConfig.functionalUseProfile}", P30 privacy flag = ${String(
        domainD.p30PrivacyRequired
      )}, or measured background noise exceedance.`,
      relevanceExplanation:
        'Simplified Sabine screening cannot model 3D wave/modal acoustics, STI speech intelligibility, or ISO 12354-1 junction flanking transmission.',
      requiredConditionsForEffectiveness: [
        'Commission pre-construction acoustic design review and post-completion field testing (ISO 3382-2 for RT60; ISO 16283-1/2 for airborne/impact insulation).',
      ],
      supportingEvidence:
        'ISO 3382-2:2008, ISO 12354-1:2017, and Plotify Professional Review Register governance.',
      remainingUnknowns: [
        'Local jurisdictional statutory acoustic code limits and field construction tolerances.',
      ],
      expectedBenefitKind: 'qualitative',
      expectedBenefitSummary:
        'Provides certified engineering sign-off, 3D ray-tracing/modal analysis where needed, and verified field commissioning.',
      requiresArchitecturalDesignChange: false,
      multidisciplinaryTradeOffs: {
        spaceAndClearance: 'To be determined by specialist acoustic consultant.',
        appearanceAndStyle: 'Coordinated with architectural interior concept.',
        costAndBuildability: 'Professional consulting fee + verified assembly specification.',
        moistureAndClimateCompatibility: 'Coordinate specialist specifications with P35 climate context.',
        fireAndMaintenance: 'Coordinate with fire engineering sign-off.',
        accessibilityP34Impact: 'Coordinate with P34 accessibility review.',
      },
      canPreviewAndApplyInPlotify: false,
    });
  }

  return recommendations;
}

/**
 * Computes a deterministic fingerprint over all project, room, material, P30–P35, and P36 inputs
 * that affect the acoustic assessment.
 */
export function computeAcousticPlannerFingerprint(
  project: Project,
  plannerData?: ProjectAcousticPlannerData
): string {
  const data = plannerData || initializeProjectAcousticPlannerData(project);
  const activeAlt =
    (project.designAlternatives || []).find((a) => a.id === project.activeAlternativeId) ||
    project.designAlternatives?.[0];

  const payload = {
    engineVersion: P36_ACOUSTIC_PLANNER_ENGINE_VERSION,
    projectId: project.id,
    unit: project.unit,
    floors: project.floors,
    rooms: (project.floorPlan?.rooms || []).map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      x: r.x,
      y: r.y,
      width: r.width,
      length: r.length,
      floorLevel: r.floorLevel,
    })),
    activeAltId: activeAlt?.id || null,
    activeInteriors: activeAlt?.interiors || {},
    roomConfigs: Object.keys(data.roomConfigs)
      .sort()
      .map((k) => ({
        ...data.roomConfigs[k],
        updatedAt: undefined,
      })),
    noiseObservations: data.noiseObservations.map((n) => ({
      id: n.observationId,
      roomId: n.roomId,
      cat: n.sourceCategory,
      kind: n.observationKind,
      db: n.soundLevelDb,
      metric: n.metricAndUnit,
      loc: n.measurementLocation,
      sev: n.qualitativeSeverity,
    })),
    measuredRt60: data.measuredRt60Records,
    customMaterialsCount: data.customAcousticMaterials.length,
    customAssembliesCount: data.customAcousticAssemblies.length,
    customCriteriaCount: data.customCriteriaOverrides.length,
    p30SpacesCount: project.brief?.spaces?.length || 0,
    p30RelationshipsCount: project.brief?.relationships?.length || 0,
    p30ReqCount: project.brief?.interpretedBrief?.requirements?.length || 0,
    p33FurnitureCount: project.furnitureLayout?.instances?.length || 0,
    p33OpeningsCount: project.furnitureLayout?.knownOpenings?.length || 0,
    p35ClimateProfile: project.materialAdvisor?.climateContext?.profileId || 'unconfigured',
    mepComponentsCount: project.mepCoordination?.components?.length || 0,
    structuralFraming: project.structuralCoordination?.framingSystem || 'none',
  };

  const raw = JSON.stringify(payload);
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `p36-fp-${(hash >>> 0).toString(16)}`;
}

/**
 * Evaluates a single room across all 8 acoustic domains (Domains A–H).
 */
export function evaluateSingleRoomAcousticComfort(
  project: Project,
  room: FloorPlanRoom,
  plannerData?: ProjectAcousticPlannerData
): RoomAcousticAssessmentReport {
  const data = plannerData || initializeProjectAcousticPlannerData(project);
  const roomConfig =
    data.roomConfigs[room.id] || createDefaultRoomAcousticConfig(project, room);
  const availableMaterials = getAllAcousticSurfaceMaterials(project, data);
  const availableAssemblies = getAllAcousticAssemblies(project, data);
  const measuredRecord = data.measuredRt60Records[room.id];
  const roomObservations = data.noiseObservations.filter((o) => o.roomId === room.id);

  const geometry = validateAndComputeRoomAcousticGeometry(project, room, roomConfig);
  const domainA = evaluateReverberationDomain(
    project,
    room,
    roomConfig,
    geometry,
    availableMaterials,
    measuredRecord,
    data.customCriteriaOverrides
  );
  const domainB = evaluateSpeechAndFunctionalUse(room, roomConfig, geometry, domainA);
  const domainC = evaluateBackgroundAndEnvironmentalNoise(
    room,
    roomConfig,
    roomObservations,
    data.customCriteriaOverrides
  );
  const domainD = evaluateAirborneInsulationAndPrivacy(
    project,
    room,
    roomConfig,
    data.roomConfigs,
    availableAssemblies,
    data.customCriteriaOverrides
  );
  const domainE = evaluateImpactAndStructureBorne(
    project,
    room,
    roomConfig,
    availableMaterials,
    availableAssemblies
  );
  const domainF = evaluateMechanicalServicesNoise(project, room, roomConfig);
  const domainG = evaluateAcousticZoningAndCoordination(
    project,
    room,
    roomConfig,
    domainD,
    domainE,
    domainF
  );
  const domainH = generateAcousticRecommendations(
    project,
    room,
    roomConfig,
    geometry,
    domainA,
    domainB,
    domainC,
    domainD,
    domainE,
    domainF,
    domainG,
    availableMaterials
  );

  // Compute evidence coverage percentage across key room acoustic inputs
  let checksTotal = 6;
  let checksPresent = 0;
  if (geometry.isGeometryValidForVolume && geometry.roomVolumeM3 !== null) checksPresent++;
  if (domainA.midFrequencyEstimatedRt60Seconds !== null) checksPresent++;
  if (roomConfig.occupantCountAssumption !== null) checksPresent++;
  if (roomObservations.length > 0) checksPresent++;
  if (domainD.partitionAssembly && domainD.partitionAssembly.labAirborneRatingDb !== null) checksPresent++;
  if ((project.furnitureLayout?.knownOpenings || []).some((o) => o.roomId === room.id)) checksPresent++;
  const evidenceCoveragePercent = Math.round((checksPresent / checksTotal) * 100);

  // Determine overall status — never allow a high score or partial pass to conceal missing volume/RT60 evidence or a critical concern
  let overallStatus: AcousticEvaluationStatus;
  if (!data.isConfigured && geometry.roomVolumeM3 === null) {
    overallStatus = 'unconfigured';
  } else if (domainA.status === 'insufficient-evidence') {
    overallStatus = 'insufficient-evidence';
  } else if (
    domainA.status === 'concern-identified' ||
    domainB.status === 'concern-identified' ||
    domainC.status === 'concern-identified' ||
    domainD.status === 'concern-identified' ||
    domainE.status === 'concern-identified' ||
    domainF.status === 'concern-identified' ||
    domainG.status === 'concern-identified'
  ) {
    overallStatus = 'concern-identified';
  } else if (
    domainA.status === 'needs-review' ||
    domainB.status === 'needs-review' ||
    domainC.status === 'insufficient-evidence' ||
    domainD.status === 'insufficient-evidence'
  ) {
    overallStatus = 'needs-review';
  } else if (domainA.status === 'measured-within-target') {
    overallStatus = 'measured-within-target';
  } else {
    overallStatus = 'estimated-within-target';
  }

  let overallConfidenceState: AcousticConfidenceState;
  if (domainA.confidenceState === 'insufficient-evidence') {
    overallConfidenceState = 'insufficient-evidence';
  } else if (
    domainA.confidenceState === 'verified-measurement-or-test-evidence' &&
    domainC.confidenceState === 'verified-measurement-or-test-evidence'
  ) {
    overallConfidenceState = 'verified-measurement-or-test-evidence';
  } else if (evidenceCoveragePercent >= 65) {
    overallConfidenceState = 'sufficient-for-preliminary-calculation';
  } else {
    overallConfidenceState = 'incomplete-evidence-requires-caution';
  }

  const missingInformationSummary: string[] = [
    ...geometry.validationIssues,
    ...geometry.missingGeometryDisclosures,
    ...domainB.missingEvidenceForDetailedSpeechAssessment,
  ];
  if (roomObservations.length === 0) {
    missingInformationSummary.push(
      'No background or environmental noise observations recorded for this room (Domain C).'
    );
  }
  if (!domainD.partitionAssembly || domainD.partitionAssembly.labAirborneRatingDb === null) {
    missingInformationSummary.push(
      'No laboratory-tested airborne sound insulation rating (STC/Rw) assigned to room partitions (Domain D).'
    );
  }

  const influentialInputsSummary: string[] = [
    `Room Geometry: ${room.width} × ${room.length} ${project.unit} (${
      geometry.floorAreaM2 ?? 'N/A'
    } m² floor area), Ceiling Height: ${
      geometry.ceilingHeightMetres !== null
        ? `${geometry.ceilingHeightMetres} m (${geometry.ceilingHeightProvenance})`
        : 'Not specified'
    }, Volume V = ${geometry.roomVolumeM3 !== null ? `${geometry.roomVolumeM3} m³` : 'Unavailable'}`,
    `Functional Use Profile: ${getFunctionalProfileLabel(roomConfig.functionalUseProfile)} (Target RT60: ${
      domainA.activeCriterion.minTarget ?? 0
    }–${domainA.activeCriterion.maxTarget} s [${domainA.activeCriterion.authorityStatus}])`,
    ...domainA.topAbsorbingSurfacesSummary.slice(0, 2),
    ...domainA.topReflectiveSurfacesSummary.slice(0, 2),
  ];

  const roomFp = computeAcousticPlannerFingerprint(project, data);

  return {
    assessmentId: `p36-room-assess-${project.id}-${room.id}`,
    projectId: project.id,
    roomId: room.id,
    roomName: room.name,
    roomType: room.type,
    floorLevel: room.floorLevel,
    assessedAt: new Date().toISOString(),
    calculationModelVersion: P36_ACOUSTIC_PLANNER_ENGINE_VERSION,
    inputFingerprint: `${roomFp}:${room.id}`,
    overallStatus,
    overallConfidenceState,
    evidenceCoveragePercent,
    geometry,
    domainA_Reverberation: domainA,
    domainB_SpeechFunctional: domainB,
    domainC_BackgroundNoise: domainC,
    domainD_AirbornePrivacy: domainD,
    domainE_ImpactStructure: domainE,
    domainF_MechanicalNoise: domainF,
    domainG_AcousticZoning: domainG,
    domainH_Recommendations: domainH,
    missingInformationSummary,
    influentialInputsSummary,
  };
}

/**
 * Generates read-only P36 acoustic comparison summaries for P31 comparable design options (P36 Section 11).
 */
export function getP36AcousticSummaryForOptionComparison(
  project: Project,
  plannerData?: ProjectAcousticPlannerData
): P36OptionAcousticComparisonSummary[] {
  const data = plannerData || initializeProjectAcousticPlannerData(project);
  const options = extractComparableOptions(project);

  return options.map((opt) => {
    // Build a temporary project clone representing this option's rooms and active alternative/facade
    const optProject: Project = {
      ...project,
      floorPlan: {
        ...(project.floorPlan || { rooms: [] }),
        rooms: opt.rooms || [],
      },
      activeAlternativeId:
        opt.kind === 'design-alternative' ? opt.sourceId : project.activeAlternativeId,
    };

    const rooms = optProject.floorPlan?.rooms || [];
    const reports = rooms.map((r) => evaluateSingleRoomAcousticComfort(optProject, r, data));

    const roomsEvaluatedCount = reports.length;
    const withRt60 = reports.filter(
      (r) => r.domainA_Reverberation.midFrequencyEstimatedRt60Seconds !== null
    );
    const roomsWithSufficientRt60EvidenceCount = withRt60.length;
    const roomsWithinRt60TargetCount = withRt60.filter(
      (r) => r.domainA_Reverberation.meetsTargetRange === true
    ).length;
    const roomsWithConcernsCount = reports.filter(
      (r) => r.overallStatus === 'concern-identified'
    ).length;
    const roomsWithInsufficientEvidenceCount = reports.filter(
      (r) => r.overallStatus === 'insufficient-evidence' || r.overallStatus === 'unconfigured'
    ).length;

    const averageEstimatedMidRt60Seconds =
      withRt60.length > 0
        ? round2(
            withRt60.reduce(
              (sum, r) => sum + (r.domainA_Reverberation.midFrequencyEstimatedRt60Seconds || 0),
              0
            ) / withRt60.length
          )
        : null;

    const isComplete =
      roomsEvaluatedCount > 0 && roomsWithSufficientRt60EvidenceCount === roomsEvaluatedCount;

    const caveats: string[] = [];
    if (!isComplete) {
      caveats.push(
        `${roomsEvaluatedCount - roomsWithSufficientRt60EvidenceCount} of ${roomsEvaluatedCount} room(s) lack ceiling height or verified surface absorption data; missing data is disclosed rather than fabricated.`
      );
    }
    caveats.push(
      'P36 option summary reflects preliminary Sabine reverberation and adjacency screening; it does not establish total design superiority.'
    );

    return {
      optionId: opt.optionId,
      optionName: opt.name,
      calculationModelVersion: P36_ACOUSTIC_PLANNER_ENGINE_VERSION,
      roomsEvaluatedCount,
      roomsWithSufficientRt60EvidenceCount,
      roomsWithinRt60TargetCount,
      roomsWithConcernsCount,
      roomsWithInsufficientEvidenceCount,
      averageEstimatedMidRt60Seconds,
      overallEvidenceState: isComplete
        ? 'sufficient-for-preliminary-calculation'
        : 'insufficient-evidence',
      comparabilityStatus: isComplete ? 'comparable-preliminary' : 'incomplete-acoustic-data',
      summaryExplanation: isComplete
        ? `${roomsWithinRt60TargetCount}/${roomsEvaluatedCount} room(s) within target RT60 (mean estimated mid-freq RT60 = ${averageEstimatedMidRt60Seconds} s); ${roomsWithConcernsCount} room(s) with acoustic concerns.`
        : `Incomplete acoustic evidence (${roomsWithSufficientRt60EvidenceCount}/${roomsEvaluatedCount} rooms have volume & absorption data). Configure ceiling heights in P36 for full cross-option comparison.`,
      caveats,
    };
  });
}

/**
 * Evaluates the entire project for P36 Acoustic Comfort Planner, including P30–P35 read-only integration.
 */
export function evaluateProjectAcousticComfort(
  project: Project,
  overridePlannerData?: ProjectAcousticPlannerData
): AcousticComfortProjectEvaluationReport {
  const data = overridePlannerData || initializeProjectAcousticPlannerData(project);
  const currentFingerprint = computeAcousticPlannerFingerprint(project, data);
  const savedFingerprint = project.acousticPlanner?.lastSourceFingerprint;

  const isStale = Boolean(savedFingerprint && savedFingerprint !== currentFingerprint);
  const staleReasons: string[] = [];
  if (isStale) {
    staleReasons.push(
      'Underlying room geometry, interior finishes, MEP components, or acoustic inputs have changed since the last saved P36 evaluation.'
    );
  }

  const rooms = project.floorPlan?.rooms || [];
  const allRoomReports = rooms.map((r) => evaluateSingleRoomAcousticComfort(project, r, data));
  const selectedRoomId =
    data.selectedRoomId && rooms.some((r) => r.id === data.selectedRoomId)
      ? data.selectedRoomId
      : rooms[0]?.id || null;
  const activeRoomReport =
    allRoomReports.find((r) => r.roomId === selectedRoomId) || allRoomReports[0] || null;

  // 1. P30 Brief Integration (distinguishing confirmed requirements from unconfirmed assumptions & conflicts)
  const brief = initializeProjectBrief(project);
  const confirmedAcousticRequirements: string[] = [];
  const unconfirmedAcousticAssumptions: string[] = [];
  const unresolvedAcousticConflicts: string[] = [];
  const acousticIsolatedRoomPairs: Array<{ sourceName: string; targetName: string; priority: string }> = [];

  for (const sp of brief.spaces || []) {
    if (sp.acousticPrivacyRequired) {
      confirmedAcousticRequirements.push(
        `Programmed space "${sp.name}" (${sp.priority}) requires acoustic privacy.`
      );
    }
  }
  for (const rel of brief.relationships || []) {
    if (rel.relationType === 'acoustic-isolated') {
      const s1 = brief.spaces.find((s) => s.id === rel.sourceSpaceId)?.name || rel.sourceSpaceId;
      const s2 = brief.spaces.find((s) => s.id === rel.targetSpaceId)?.name || rel.targetSpaceId;
      acousticIsolatedRoomPairs.push({
        sourceName: s1,
        targetName: s2,
        priority: rel.priority,
      });
      confirmedAcousticRequirements.push(
        `Spatial relationship rule (${rel.priority}): "${s1}" must be acoustically isolated from "${s2}".`
      );
    }
  }

  if (brief.interpretedBrief) {
    for (const req of brief.interpretedBrief.requirements || []) {
      const text = `${req.description} ${String(req.normalizedValue)}`.toLowerCase();
      if (
        req.category === 'privacy-circulation' ||
        text.includes('acoustic') ||
        text.includes('quiet') ||
        text.includes('sound') ||
        text.includes('noise') ||
        text.includes('privacy')
      ) {
        if (req.reviewStatus === 'confirmed' && req.source !== 'inferred') {
          confirmedAcousticRequirements.push(
            `Confirmed P30 Requirement (${req.priority}): ${req.description}`
          );
        } else if (req.reviewStatus !== 'rejected') {
          unconfirmedAcousticAssumptions.push(
            `Unconfirmed P30 Interpretation (${req.source} / ${req.reviewStatus}): ${req.description}`
          );
        }
      }
    }
    for (const assump of brief.interpretedBrief.assumptions || []) {
      const text = `${assump.description} ${String(assump.assumedValue)}`.toLowerCase();
      if (
        assump.category === 'privacy-circulation' ||
        text.includes('acoustic') ||
        text.includes('quiet') ||
        text.includes('sound') ||
        text.includes('noise')
      ) {
        if (assump.status === 'confirmed') {
          confirmedAcousticRequirements.push(`Confirmed P30 Brief Assumption: ${assump.description}`);
        } else if (assump.status === 'pending') {
          unconfirmedAcousticAssumptions.push(
            `Pending P30 Assumption (not treated as mandatory): ${assump.description}`
          );
        }
      }
    }
    for (const conf of brief.interpretedBrief.conflicts || []) {
      if (!conf.resolved) {
        unresolvedAcousticConflicts.push(`${conf.title}: ${conf.description}`);
      }
    }
  }

  // 2. P32 Adaptive Design Personalization Integration
  const p32Profile = initializePersonalizationProfile(project);
  const rawP32Items = [
    ...(project.designPersonalization?.items || []),
    ...(p32Profile.items || []),
  ];
  const seenP32Ids = new Set<string>();
  const explicitAcousticPreferences: string[] = [];
  const unconfirmedSuggestionsHeld: string[] = [];

  const explicitPrivacyWeight =
    p32Profile.spatialPriorityWeights?.privacyAndZoneSeparation ?? null;
  if (explicitPrivacyWeight !== null && explicitPrivacyWeight >= 60) {
    explicitAcousticPreferences.push(
      `Explicit P32 Spatial Priority: Privacy & Zone Separation weight = ${explicitPrivacyWeight}/100.`
    );
  }

  for (const item of rawP32Items) {
    if (!item || seenP32Ids.has(item.id)) continue;
    seenP32Ids.add(item.id);
    const labelText = `${item.label} ${String(item.value)} ${item.rationale}`.toLowerCase();
    if (
      labelText.includes('acoustic') ||
      labelText.includes('privacy') ||
      labelText.includes('quiet') ||
      labelText.includes('timber') ||
      labelText.includes('felt')
    ) {
      if (
        (item.origin === 'explicit-user' || item.origin === 'imported-project-fact') &&
        item.confirmationStatus === 'confirmed'
      ) {
        explicitAcousticPreferences.push(
          `Confirmed P32 Preference (${item.origin}): ${item.label} = ${String(item.value)}`
        );
      } else if (
        item.origin === 'inferred-suggestion' ||
        item.confirmationStatus === 'unconfirmed-suggestion'
      ) {
        unconfirmedSuggestionsHeld.push(
          `Unconfirmed P32 Suggestion (held for review, never promoted to confirmed preference): ${item.label} = ${String(
            item.value
          )}`
        );
      }
    }
  }

  // 3. P33 Furniture Integration
  const furnitureData = ensureProjectFurnitureLayoutData(project);
  const totalPlacedFurnitureCount = furnitureData.instances?.length || 0;

  // 4. P35 Material Advisor Integration
  const p35Advisor = initializeProjectMaterialAdvisorData(project);
  const moistureOrClimateMaterialWarnings: string[] = [];
  for (const rep of allRoomReports) {
    for (const rec of rep.domainH_Recommendations) {
      if (rec.p35CompatibilityWarning) {
        moistureOrClimateMaterialWarnings.push(
          `${rep.roomName}: ${rec.p35CompatibilityWarning}`
        );
      }
    }
  }

  const p31OptionComparisonSummaries = getP36AcousticSummaryForOptionComparison(project, data);

  return {
    evaluationId: `p36-eval-${project.id}-${data.requestSequenceId}`,
    schemaVersion: P36_ACOUSTIC_SCHEMA_VERSION,
    calculationModelVersion: P36_ACOUSTIC_PLANNER_ENGINE_VERSION,
    projectId: project.id,
    projectName: project.name,
    unit: project.unit,
    evaluatedAt: new Date().toISOString(),
    requestSequenceId: data.requestSequenceId,
    sourceFingerprint: currentFingerprint,
    isStale,
    staleReasons,
    isConfigured: data.isConfigured,
    selectedRoomId,
    activeRoomReport,
    allRoomReports,
    availableMaterials: getAllAcousticSurfaceMaterials(project, data),
    availableAssemblies: getAllAcousticAssemblies(project, data),
    configuredCriteria: [
      ...DEFAULT_CONFIGURED_ACOUSTIC_CRITERIA,
      ...data.customCriteriaOverrides,
    ],
    p30BriefIntegration: {
      hasBrief: Boolean(project.brief),
      confirmedAcousticRequirements,
      unconfirmedAcousticAssumptions,
      unresolvedAcousticConflicts,
      acousticIsolatedRoomPairs,
    },
    p31OptionComparisonSummaries,
    p32PersonalizationIntegration: {
      hasPersonalizationProfile: Boolean(project.designPersonalization),
      explicitPrivacyWeight,
      explicitAcousticPreferences,
      unconfirmedSuggestionsHeld,
    },
    p33FurnitureIntegration: {
      totalPlacedFurnitureCount,
      furnitureAbsorptionPolicyNote:
        'P33 furniture footprints and circulation routes are preserved intact. Plotify never invents acoustic absorption coefficients (Sabins) or decibel reductions from generic furniture geometry alone.',
    },
    p34AccessibilityIntegration: {
      hasAccessibilityReview: Boolean(project.accessibilityReview),
      clearancesAndDoorsPreservedNote:
        'P34 accessible routes, 1.50 m turning circles, clear door opening widths, and step-free thresholds are preserved; acoustic recommendations never narrow accessible clear widths.',
    },
    p35MaterialIntegration: {
      climateIsConfigured: p35Advisor.climateContext.isConfigured,
      climateProfileName: p35Advisor.climateContext.profileName,
      moistureOrClimateMaterialWarnings,
    },
    roadmapScopeBoundaries: [
      {
        roadmapId: 'P37',
        title: 'Natural Ventilation Scenario Analyzer (Future Scope)',
        boundaryStatement:
          'P36 screens mechanical equipment proximity and facade glazing insulation, but does NOT simulate natural ventilation airflow or window-opening thermal/airflow scenarios (reserved for P37).',
      },
      {
        roadmapId: 'P38',
        title: 'Daylight & Visual Comfort Analyzer (Future Scope)',
        boundaryStatement:
          'P36 accounts for window glazing surface area in Sabine reverberation, but does NOT compute daylight factor, sDA, ASE, or visual glare (reserved for P38).',
      },
      {
        roadmapId: 'P39',
        title: 'Design Rationale & Decision History (Future Scope)',
        boundaryStatement:
          'P36 uses Plotify snapshots for safe apply/rollback, without implementing the cross-module P39 decision-rationale engine.',
      },
      {
        roadmapId: 'P40',
        title: 'Design Quality Benchmark & Improvement Loop (Future Scope)',
        boundaryStatement:
          'P36 provides room-specific acoustic evaluations and P31 option summaries, without implementing P40 portfolio benchmarking.',
      },
    ],
    professionalDisclaimer: P36_PROFESSIONAL_DISCLAIMER,
  };
}

/**
 * Generates a non-destructive preview diff for a proposed P36 acoustic intervention (P36 Section 13).
 * Never mutates the passed `project` object.
 */
export function previewAcousticProposal(
  project: Project,
  recommendationId: string,
  targetRoomId?: string
): AcousticProposalPreviewDiff {
  const data = initializeProjectAcousticPlannerData(project);
  const currentFp = computeAcousticPlannerFingerprint(project, data);
  const rooms = project.floorPlan?.rooms || [];
  const room =
    rooms.find((r) => r.id === (targetRoomId || data.selectedRoomId)) || rooms[0];

  if (!room) {
    return {
      proposalId: `p36-preview-err-${Date.now()}`,
      recommendationId,
      roomId: targetRoomId || 'unknown',
      roomName: 'Unknown Room',
      title: 'Invalid Room Selection',
      createdAt: new Date().toISOString(),
      sourceFingerprintAtPreview: currentFp,
      isSafeToApply: false,
      blockingReasons: ['Selected room does not exist in project floor plan.'],
      warningNotices: [],
      p35MoistureOrClimateWarnings: [],
      p34AccessibilityPreserved: true,
      p33FurnitureGeometryPreserved: true,
      p30AndP32Preserved: true,
      beforeRt60MidSec: null,
      afterRt60MidSec: null,
      beforeStatus: 'insufficient-evidence',
      afterStatus: 'insufficient-evidence',
      fieldChanges: [],
      proposedProjectClone: {},
    };
  }

  const beforeRoomReport = evaluateSingleRoomAcousticComfort(project, room, data);
  const rec = beforeRoomReport.domainH_Recommendations.find(
    (r) => r.recommendationId === recommendationId
  );

  if (!rec || !rec.canPreviewAndApplyInPlotify || !rec.proposedMutation) {
    return {
      proposalId: `p36-preview-blocked-${Date.now()}`,
      recommendationId,
      roomId: room.id,
      roomName: room.name,
      title: rec?.title || 'Advisory Recommendation (Manual / Specialist Action)',
      createdAt: new Date().toISOString(),
      sourceFingerprintAtPreview: currentFp,
      isSafeToApply: false,
      blockingReasons: [
        rec
          ? `Recommendation "${rec.title}" requires manual architectural/engineering coordination and cannot be auto-applied.`
          : `Recommendation "${recommendationId}" was not found for room "${room.name}".`,
      ],
      warningNotices: [],
      p35MoistureOrClimateWarnings: [],
      p34AccessibilityPreserved: true,
      p33FurnitureGeometryPreserved: true,
      p30AndP32Preserved: true,
      beforeRt60MidSec: beforeRoomReport.domainA_Reverberation.midFrequencyEstimatedRt60Seconds,
      afterRt60MidSec: beforeRoomReport.domainA_Reverberation.midFrequencyEstimatedRt60Seconds,
      beforeStatus: beforeRoomReport.overallStatus,
      afterStatus: beforeRoomReport.overallStatus,
      fieldChanges: [],
      proposedProjectClone: {},
    };
  }

  // Deep clone project to construct the proposed state without mutating the original
  const clonedProject: Project = JSON.parse(JSON.stringify(project));
  const clonedPlanner = initializeProjectAcousticPlannerData(clonedProject);
  const roomCfg =
    clonedPlanner.roomConfigs[room.id] || createDefaultRoomAcousticConfig(clonedProject, room);
  const mut = rec.proposedMutation;

  const fieldChanges: AcousticProposalPreviewDiff['fieldChanges'] = [];
  const blockingReasons: string[] = [];
  const warningNotices: string[] = [];
  const p35MoistureOrClimateWarnings: string[] = [];

  // Check P35 wet-room & moisture compatibility before applying
  const isWetRoom =
    roomCfg.functionalUseProfile === 'service-utility-wet' ||
    /bath|wc|toilet|shower|kitchen|laundry|wet/i.test(`${room.type} ${room.name}`);

  if (isWetRoom && mut.proposedWallAcousticMaterialId === 'ac-wall-acoustic-felt-panels') {
    blockingReasons.push(
      `P35 Compatibility Block: Acoustic PET Felt Wall Panels are moisture-sensitive and cannot be unconditionally applied to wet/service room "${room.name}".`
    );
  }
  if (rec.p35CompatibilityWarning) {
    p35MoistureOrClimateWarnings.push(rec.p35CompatibilityWarning);
    warningNotices.push(rec.p35CompatibilityWarning);
  }

  // Apply acoustic material / assembly assignments on clonedPlanner.roomConfigs[room.id]
  if (mut.proposedWallAcousticMaterialId && mut.proposedWallAcousticMaterialId !== roomCfg.wallAcousticMaterialId) {
    fieldChanges.push({
      fieldPath: `acousticPlanner.roomConfigs.${room.id}.wallAcousticMaterialId`,
      label: `${room.name} — Wall Acoustic Surface Treatment`,
      beforeValue: roomCfg.wallAcousticMaterialId || 'Default from Interior Concept (matte-plaster)',
      afterValue: mut.proposedWallAcousticMaterialId,
      changed: true,
    });
    roomCfg.wallAcousticMaterialId = mut.proposedWallAcousticMaterialId;
  }

  if (
    mut.proposedCeilingAcousticMaterialId &&
    mut.proposedCeilingAcousticMaterialId !== roomCfg.ceilingAcousticMaterialId
  ) {
    fieldChanges.push({
      fieldPath: `acousticPlanner.roomConfigs.${room.id}.ceilingAcousticMaterialId`,
      label: `${room.name} — Ceiling Acoustic Treatment`,
      beforeValue: roomCfg.ceilingAcousticMaterialId || 'Default from Interior Concept (smooth-white)',
      afterValue: mut.proposedCeilingAcousticMaterialId,
      changed: true,
    });
    roomCfg.ceilingAcousticMaterialId = mut.proposedCeilingAcousticMaterialId;
  }

  if (
    mut.proposedFloorAcousticMaterialId &&
    mut.proposedFloorAcousticMaterialId !== roomCfg.floorAcousticMaterialId
  ) {
    fieldChanges.push({
      fieldPath: `acousticPlanner.roomConfigs.${room.id}.floorAcousticMaterialId`,
      label: `${room.name} — Floor Acoustic Treatment`,
      beforeValue: roomCfg.floorAcousticMaterialId || 'Default from Interior Concept',
      afterValue: mut.proposedFloorAcousticMaterialId,
      changed: true,
    });
    roomCfg.floorAcousticMaterialId = mut.proposedFloorAcousticMaterialId;
  }

  if (
    mut.proposedPartitionAssemblyId &&
    mut.proposedPartitionAssemblyId !== roomCfg.partitionAssemblyId
  ) {
    fieldChanges.push({
      fieldPath: `acousticPlanner.roomConfigs.${room.id}.partitionAssemblyId`,
      label: `${room.name} — Partition Sound Insulation Assembly`,
      beforeValue: roomCfg.partitionAssemblyId || 'asm-part-generic-unverified-wall',
      afterValue: mut.proposedPartitionAssemblyId,
      changed: true,
    });
    roomCfg.partitionAssemblyId = mut.proposedPartitionAssemblyId;
  }

  if (mut.proposedDoorAssemblyId && mut.proposedDoorAssemblyId !== roomCfg.doorAssemblyId) {
    fieldChanges.push({
      fieldPath: `acousticPlanner.roomConfigs.${room.id}.doorAssemblyId`,
      label: `${room.name} — Interior Door Acoustic Assembly`,
      beforeValue: roomCfg.doorAssemblyId || 'asm-door-generic-unsealed',
      afterValue: mut.proposedDoorAssemblyId,
      changed: true,
    });
    roomCfg.doorAssemblyId = mut.proposedDoorAssemblyId;
  }

  // Also synchronize with the active DesignAlternative's InteriorRoomConcept when applicable
  if (
    mut.proposedInteriorWallFinish ||
    mut.proposedInteriorCeilingFinish ||
    mut.proposedInteriorFloorFinish ||
    mut.proposedDesignPriority
  ) {
    if (!Array.isArray(clonedProject.designAlternatives) || clonedProject.designAlternatives.length === 0) {
      clonedProject.designAlternatives = [
        {
          id: 'alt-default-p36',
          name: 'Option A — Baseline Architectural Concept',
          createdAt: new Date().toISOString(),
          facade: {
            style: 'Modern',
            primaryMaterial: 'plaster',
            accentMaterial: 'timber',
            paletteName: 'Warm Architectural Neutral',
            primaryColor: '#f8fafc',
            accentColor: '#b45309',
            windowTrimColor: '#1e293b',
            roofTrimColor: '#334155',
            windowStyle: 'floor-to-ceiling',
            entranceStyle: 'minimal-pivot',
            shadingStyle: 'deep-overhangs',
            elevationView: 'perspective',
            costTier: 'Balanced Mid-Range',
            notes: '',
          },
          interiors: {},
        },
      ];
      clonedProject.activeAlternativeId = 'alt-default-p36';
    }

    const activeAlt =
      clonedProject.designAlternatives.find((a) => a.id === clonedProject.activeAlternativeId) ||
      clonedProject.designAlternatives[0];
    if (!activeAlt.interiors) activeAlt.interiors = {};

    const existingInterior: InteriorRoomConcept = activeAlt.interiors[room.id] || {
      roomId: room.id,
      roomName: room.name,
      style: 'Warm Contemporary',
      paletteName: 'Quiet Natural',
      wallColor: '#f1f5f9',
      wallFinish: 'matte-plaster',
      floorFinish: 'light-oak-plank',
      ceilingFinish: 'smooth-white',
      furnitureStyle: 'scandinavian-clean',
      lightingMood: 'warm-ambient-2700k',
      storageStyle: 'floor-to-ceiling-concealed',
      designPriority: 'functionality',
      notes: '',
    };

    if (mut.proposedInteriorWallFinish && mut.proposedInteriorWallFinish !== existingInterior.wallFinish) {
      fieldChanges.push({
        fieldPath: `designAlternatives.${activeAlt.id}.interiors.${room.id}.wallFinish`,
        label: `${room.name} — Interior Concept Wall Finish`,
        beforeValue: existingInterior.wallFinish,
        afterValue: mut.proposedInteriorWallFinish,
        changed: true,
      });
      existingInterior.wallFinish = mut.proposedInteriorWallFinish;
    }

    if (
      mut.proposedInteriorCeilingFinish &&
      mut.proposedInteriorCeilingFinish !== existingInterior.ceilingFinish
    ) {
      fieldChanges.push({
        fieldPath: `designAlternatives.${activeAlt.id}.interiors.${room.id}.ceilingFinish`,
        label: `${room.name} — Interior Concept Ceiling Finish`,
        beforeValue: existingInterior.ceilingFinish,
        afterValue: mut.proposedInteriorCeilingFinish,
        changed: true,
      });
      existingInterior.ceilingFinish = mut.proposedInteriorCeilingFinish;
    }

    if (
      mut.proposedInteriorFloorFinish &&
      mut.proposedInteriorFloorFinish !== existingInterior.floorFinish
    ) {
      fieldChanges.push({
        fieldPath: `designAlternatives.${activeAlt.id}.interiors.${room.id}.floorFinish`,
        label: `${room.name} — Interior Concept Floor Finish`,
        beforeValue: existingInterior.floorFinish,
        afterValue: mut.proposedInteriorFloorFinish,
        changed: true,
      });
      existingInterior.floorFinish = mut.proposedInteriorFloorFinish;
    }

    if (mut.proposedDesignPriority && mut.proposedDesignPriority !== existingInterior.designPriority) {
      fieldChanges.push({
        fieldPath: `designAlternatives.${activeAlt.id}.interiors.${room.id}.designPriority`,
        label: `${room.name} — Interior Design Priority`,
        beforeValue: existingInterior.designPriority,
        afterValue: mut.proposedDesignPriority,
        changed: true,
      });
      existingInterior.designPriority = mut.proposedDesignPriority;
    }

    activeAlt.interiors[room.id] = existingInterior;
  }

  roomCfg.updatedAt = new Date().toISOString();
  clonedPlanner.roomConfigs[room.id] = roomCfg;
  clonedPlanner.isConfigured = true;
  clonedProject.acousticPlanner = clonedPlanner;

  const afterRoomReport = evaluateSingleRoomAcousticComfort(clonedProject, room, clonedPlanner);

  // Verify upstream invariants (P30, P32, P33, P34, and 2D room geometry)
  const p30AndP32Preserved =
    JSON.stringify(project.brief) === JSON.stringify(clonedProject.brief) &&
    JSON.stringify(project.designPersonalization) ===
      JSON.stringify(clonedProject.designPersonalization);
  const p33FurnitureGeometryPreserved =
    JSON.stringify(project.floorPlan?.rooms) === JSON.stringify(clonedProject.floorPlan?.rooms) &&
    JSON.stringify(project.furnitureLayout) === JSON.stringify(clonedProject.furnitureLayout);
  const p34AccessibilityPreserved =
    JSON.stringify(project.accessibilityReview) ===
    JSON.stringify(clonedProject.accessibilityReview);

  if (!p30AndP32Preserved || !p33FurnitureGeometryPreserved || !p34AccessibilityPreserved) {
    blockingReasons.push(
      'Safety invariant failed: proposed change would alter upstream P30/P32/P33/P34 or 2D room geometry records.'
    );
  }

  return {
    proposalId: `p36-preview-${room.id}-${recommendationId}`,
    recommendationId,
    roomId: room.id,
    roomName: room.name,
    title: rec.title,
    createdAt: new Date().toISOString(),
    sourceFingerprintAtPreview: currentFp,
    isSafeToApply: blockingReasons.length === 0 && fieldChanges.length > 0,
    blockingReasons,
    warningNotices,
    p35MoistureOrClimateWarnings,
    p34AccessibilityPreserved,
    p33FurnitureGeometryPreserved,
    p30AndP32Preserved,
    beforeRt60MidSec: beforeRoomReport.domainA_Reverberation.midFrequencyEstimatedRt60Seconds,
    afterRt60MidSec: afterRoomReport.domainA_Reverberation.midFrequencyEstimatedRt60Seconds,
    beforeStatus: beforeRoomReport.overallStatus,
    afterStatus: afterRoomReport.overallStatus,
    fieldChanges,
    proposedProjectClone: clonedProject as unknown as Record<string, unknown>,
  };
}

/**
 * Atomically applies a previewed P36 acoustic proposal after verifying that the underlying
 * project fingerprint has not become stale and creating a pre-apply snapshot checkpoint (P36 Section 13).
 * If any validation or application step fails, restores the prior state and throws a descriptive error.
 */
export function applyAcousticProposalSafely(
  project: Project,
  preview: AcousticProposalPreviewDiff,
  options?: { simulateStepFailure?: boolean }
): {
  updatedProject: Project;
  snapshotId: string;
  postApplyReport: AcousticComfortProjectEvaluationReport;
} {
  const currentFp = computeAcousticPlannerFingerprint(project);
  if (preview.sourceFingerprintAtPreview !== currentFp) {
    throw new Error(
      'Stale preview detected: The underlying project geometry, materials, or acoustic inputs have changed since this preview was generated. Please regenerate the preview before applying.'
    );
  }

  if (!preview.isSafeToApply) {
    throw new Error(
      `Cannot apply acoustic proposal "${preview.title}": ${preview.blockingReasons.join(' ')}`
    );
  }

  // 1. Create pre-apply safety checkpoint snapshot
  const priorStateBackup: Project = JSON.parse(JSON.stringify(project));
  const snapshot = createProjectSnapshot(project, {
    trigger: 'auto-checkpoint',
    label: `P36 Pre-Acoustic Apply (${preview.roomName}: ${preview.title})`,
    description: `Automatic pre-application checkpoint created by P36 Acoustic Comfort Planner prior to applying "${preview.title}" in ${preview.roomName}.`,
  });
  memoryAcousticSnapshots.set(snapshot.id, priorStateBackup);

  try {
    if (options?.simulateStepFailure) {
      throw new Error('Simulated atomic application failure during P36 mutation commit.');
    }

    const updatedProject: Project = JSON.parse(
      JSON.stringify(preview.proposedProjectClone)
    );
    if (!updatedProject || updatedProject.id !== project.id) {
      throw new Error('Proposed project state failed identity validation.');
    }

    const planner = initializeProjectAcousticPlannerData(updatedProject);
    planner.isConfigured = true;
    planner.lastPreApplySnapshotId = snapshot.id;
    planner.requestSequenceId = (project.acousticPlanner?.requestSequenceId || 1) + 1;
    updatedProject.acousticPlanner = planner;

    const postApplyReport = evaluateProjectAcousticComfort(updatedProject, planner);
    updatedProject.acousticPlanner.lastEvaluatedAt = postApplyReport.evaluatedAt;
    updatedProject.acousticPlanner.lastSourceFingerprint = postApplyReport.sourceFingerprint;
    updatedProject.updatedAt = new Date().toISOString();

    return {
      updatedProject,
      snapshotId: snapshot.id,
      postApplyReport,
    };
  } catch (err: any) {
    // Restore prior state on failure
    Object.assign(project, JSON.parse(JSON.stringify(priorStateBackup)));
    throw new Error(
      `Atomic apply failed and prior project state was restored: ${err?.message || 'Unknown error'}`
    );
  }
}

/**
 * Safely saves updated `ProjectAcousticPlannerData` (room ceiling height, functional profile,
 * noise observations, custom materials, criteria overrides) with pre-save snapshot creation.
 */
export function saveProjectAcousticPlannerSafely(
  project: Project,
  nextPlannerData: ProjectAcousticPlannerData,
  createCheckpoint = true
): {
  updatedProject: Project;
  snapshotId?: string;
  report: AcousticComfortProjectEvaluationReport;
} {
  let snapshotId = nextPlannerData.lastPreApplySnapshotId;
  if (createCheckpoint) {
    const snap = createProjectSnapshot(project, {
      trigger: 'auto-checkpoint',
      label: 'P36 Acoustic Comfort Configuration Update',
      description: 'Automatic checkpoint prior to saving P36 acoustic comfort configuration.',
    });
    snapshotId = snap.id;
    memoryAcousticSnapshots.set(snap.id, JSON.parse(JSON.stringify(project)));
  }

  const nextSeq = Math.max(
    (project.acousticPlanner?.requestSequenceId || 0) + 1,
    nextPlannerData.requestSequenceId || 1
  );

  const candidateProject: Project = {
    ...project,
    acousticPlanner: {
      ...nextPlannerData,
      isConfigured: true,
      lastPreApplySnapshotId: snapshotId,
      requestSequenceId: nextSeq,
    },
  };

  const report = evaluateProjectAcousticComfort(
    candidateProject,
    candidateProject.acousticPlanner
  );
  candidateProject.acousticPlanner!.lastEvaluatedAt = report.evaluatedAt;
  candidateProject.acousticPlanner!.lastSourceFingerprint = report.sourceFingerprint;
  candidateProject.updatedAt = new Date().toISOString();

  return {
    updatedProject: candidateProject,
    snapshotId,
    report,
  };
}

/**
 * Rolls back P36 acoustic changes using the existing project snapshot/version service.
 */
export function rollbackAcousticPlannerChanges(
  project: Project,
  snapshotId?: string
): Project {
  const targetId = snapshotId || project.acousticPlanner?.lastPreApplySnapshotId;
  if (!targetId) {
    throw new Error('No pre-apply snapshot ID available for P36 acoustic planner rollback.');
  }

  const snapshots = getProjectSnapshots(project);
  const found = snapshots.find((s) => s.id === targetId);
  if (found) {
    const restoreResult = executeSafeRestore(project, found);
    if (restoreResult.restoredProject) {
      return restoreResult.restoredProject;
    }
  }

  const memSnap = memoryAcousticSnapshots.get(targetId);
  if (memSnap) {
    return JSON.parse(JSON.stringify(memSnap));
  }

  throw new Error(`Snapshot "${targetId}" could not be located for P36 rollback.`);
}
