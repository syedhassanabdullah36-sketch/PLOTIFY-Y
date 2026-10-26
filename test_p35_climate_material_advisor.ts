/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLOTIFY — P35: Climate-Responsive Material Advisor Verification Suite
 * Account A | Locked Roadmap: P35 of P30–P40
 */

import assert from 'assert';
import { INITIAL_SAMPLE_PROJECTS } from './src/services/storage';
import {
  DEFAULT_MATERIAL_RANKING_WEIGHTS,
  fahrenheitToCelsius,
  celsiusToFahrenheit,
  formatTemperature,
  createUnconfiguredClimateContext,
  REFERENCE_CLIMATE_PROFILES,
  BUILTIN_CLIMATE_MATERIAL_CATALOGUE,
  PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2,
  validateAndNormalizeCustomMaterial,
  initializeProjectMaterialAdvisorData,
  extractP30MaterialRequirements,
  extractP32MaterialPreferences,
  evaluateMaterialCandidateForClimate,
  compareMaterialCandidatesForApplication,
  getP35MaterialSummaryForOptionComparison,
  evaluateProjectMaterialAdvisor,
  previewMaterialSelection,
  applyMaterialSelectionSafely,
  saveProjectMaterialAdvisorSafely,
  rollbackMaterialAdvisorChanges,
} from './src/services/climateMaterialAdvisorService';
import { Project } from './src/types/project';

console.log('================================================================');
console.log('PLOTIFY P35 — CLIMATE-RESPONSIVE MATERIAL ADVISOR VERIFICATION');
console.log('================================================================\n');

function cloneProject(proj: Project): Project {
  return JSON.parse(JSON.stringify(proj));
}

const baseSampleProject = cloneProject(INITIAL_SAMPLE_PROJECTS[0]);

// 1. Unit Conversion & Climate Context Normalization
console.log('1. Verifying temperature unit conversions and unconfigured climate defaults...');
assert.strictEqual(celsiusToFahrenheit(0), 32, '0°C should equal 32°F');
assert.strictEqual(celsiusToFahrenheit(100), 212, '100°C should equal 212°F');
assert.strictEqual(fahrenheitToCelsius(32), 0, '32°F should equal 0°C');
assert.strictEqual(fahrenheitToCelsius(104), 40, '104°F should equal 40°C');
assert.strictEqual(formatTemperature(35, 'C'), '35.0 °C');
assert.strictEqual(formatTemperature(35, 'F'), '95.0 °F (35.0 °C)');
assert.strictEqual(formatTemperature(null, 'C'), 'Not specified');

const unconfiguredCtx = createUnconfiguredClimateContext(baseSampleProject);
assert.strictEqual(unconfiguredCtx.isConfigured, false);
assert.strictEqual(unconfiguredCtx.sourceTier, 'unconfigured');
assert.strictEqual(unconfiguredCtx.statisticBasis, 'unconfigured');
assert.strictEqual(unconfiguredCtx.summerDesignHighTempC, null);
console.log('  ✓ Temperature conversions and unconfigured climate state verified.');

// 2. Unconfigured Climate Evaluation (No Fabricated Climate Data)
console.log(
  '2. Verifying unconfigured climate returns insufficient-evidence without fabricating weather data...'
);
const unconfiguredProj = cloneProject(baseSampleProject);
delete unconfiguredProj.materialAdvisor;
const unconfiguredReport = evaluateProjectMaterialAdvisor(unconfiguredProj);
assert.strictEqual(
  unconfiguredReport.climateContext.isConfigured,
  false,
  'Default project without configured climate must remain unconfigured'
);
const brickUnderUnconfigured = unconfiguredReport.activeApplicationEvaluations.find(
  (c) => c.materialId === 'mat-ext-clay-brick-cavity'
);
assert(brickUnderUnconfigured, 'Brick candidate must exist');
assert.strictEqual(
  brickUnderUnconfigured.overallStatus,
  'insufficient-evidence',
  'Unconfigured climate must yield insufficient-evidence rather than silently passing'
);
assert(
  brickUnderUnconfigured.missingEvidenceItems.length > 0,
  'Unconfigured climate must list missing climate exposure evidence'
);
console.log('  ✓ Unconfigured climate epistemic integrity verified.');

// 3. Hot-Arid High-Solar Exposure Screening
console.log('3. Verifying Hot-Arid high-solar exposure material suitability...');
const hotAridProfile = REFERENCE_CLIMATE_PROFILES.find(
  (p) => p.profileId === 'ref-hot-arid-solar'
)!;
const { updatedProject: hotAridProj, report: hotAridReport } =
  saveProjectMaterialAdvisorSafely(cloneProject(baseSampleProject), {
    ...initializeProjectMaterialAdvisorData(baseSampleProject),
    climateContext: hotAridProfile,
    selectedApplication: 'exterior-primary-facade',
  });
const plasterHotArid = hotAridReport.activeApplicationEvaluations.find(
  (c) => c.materialId === 'mat-ext-mineral-plaster-render'
)!;
const timberHotArid = hotAridReport.activeApplicationEvaluations.find(
  (c) => c.materialId === 'mat-ext-thermowood-cedar'
)!;
assert(
  plasterHotArid.overallStatus === 'suitable-for-screened-conditions' ||
    plasterHotArid.overallStatus === 'conditionally-suitable',
  `High-reflectance mineral render should be suitable/conditional in hot-arid climate, got ${plasterHotArid.overallStatus}`
);
const timberHeatDomain = timberHotArid.domainEvaluations.find(
  (d) => d.domainId === 'heat-and-solar-radiation'
)!;
assert.strictEqual(
  timberHeatDomain.status,
  'concern-identified',
  'Timber cladding under 42°C summer heat and 16.5°C diurnal swing must flag concern-identified'
);
console.log('  ✓ Hot-Arid high-solar suitability verified.');

// 4. Hot-Humid & Severe Wind-Driven Rain Exposure Screening
console.log('4. Verifying Hot-Humid & severe wind-driven rain exposure suitability...');
const hotHumidProfile = REFERENCE_CLIMATE_PROFILES.find(
  (p) => p.profileId === 'ref-hot-humid-monsoon'
)!;
const { report: hotHumidReport } = saveProjectMaterialAdvisorSafely(
  cloneProject(baseSampleProject),
  {
    ...initializeProjectMaterialAdvisorData(baseSampleProject),
    climateContext: hotHumidProfile,
    selectedApplication: 'exterior-accent-cladding',
  }
);
const porousStoneHumid = hotHumidReport.activeApplicationEvaluations.find(
  (c) => c.materialId === 'mat-ext-porous-limestone-unverified'
)!;
const moistDomain = porousStoneHumid.domainEvaluations.find(
  (d) => d.domainId === 'humidity-wetting-and-moisture'
)!;
assert.strictEqual(
  moistDomain.status,
  'concern-identified',
  'High-absorption porous limestone must flag concern-identified under severe wind-driven rain'
);
console.log('  ✓ Hot-Humid & driving rain suitability verified.');

// 5. Cold / Severe Freeze–Thaw Exposure & Missing Evidence Rule
console.log(
  '5. Verifying Cold Freeze–Thaw exposure and missing freeze–thaw evidence handling...'
);
const coldProfile = REFERENCE_CLIMATE_PROFILES.find(
  (p) => p.profileId === 'ref-cold-freeze-thaw-wet'
)!;
const { updatedProject: coldProj, report: coldReport } =
  saveProjectMaterialAdvisorSafely(cloneProject(baseSampleProject), {
    ...initializeProjectMaterialAdvisorData(baseSampleProject),
    climateContext: coldProfile,
    selectedApplication: 'exterior-accent-cladding',
  });
const unverifiedLimestoneCold = coldReport.activeApplicationEvaluations.find(
  (c) => c.materialId === 'mat-ext-porous-limestone-unverified'
)!;
const freezeDomain = unverifiedLimestoneCold.domainEvaluations.find(
  (d) => d.domainId === 'freeze-thaw-and-cold'
)!;
assert.strictEqual(
  freezeDomain.status,
  'insufficient-evidence',
  'Unverified porous limestone with null freeze-thaw data must return insufficient-evidence in severe freeze-thaw climate'
);

// When tested in an inland freeze-thaw climate (no de-icing salt disqualification), overallStatus must be 'insufficient-evidence'
const inlandColdProfile = {
  ...coldProfile,
  coastalSaltExposure: 'inland-none' as const,
};
const unverifiedLimestoneInlandCold = evaluateMaterialCandidateForClimate(
  coldProj,
  BUILTIN_CLIMATE_MATERIAL_CATALOGUE.find(
    (c) => c.materialId === 'mat-ext-porous-limestone-unverified'
  )!,
  'exterior-accent-cladding',
  inlandColdProfile
);
assert.strictEqual(
  unverifiedLimestoneInlandCold.overallStatus,
  'insufficient-evidence',
  'Overall status must surface insufficient-evidence when critical freeze-thaw data is missing and no other domain is disqualified'
);
const brickCold = coldReport.activeApplicationEvaluations.find(
  (c) => c.materialId === 'mat-ext-clay-brick-cavity'
)!;
assert(
  brickCold.overallStatus === 'suitable-for-screened-conditions' ||
    brickCold.overallStatus === 'conditionally-suitable',
  'Frost-resistant clay brick should be suitable/conditional in freeze-thaw climate'
);
console.log('  ✓ Freeze–thaw evaluation and missing-evidence protection verified.');

// 6. Coastal Marine Salt-Spray Exposure Screening
console.log('6. Verifying Coastal Marine salt-spray corrosion resistance...');
const coastalProfile = REFERENCE_CLIMATE_PROFILES.find(
  (p) => p.profileId === 'ref-coastal-marine-salt'
)!;
const { report: coastalReport } = saveProjectMaterialAdvisorSafely(
  cloneProject(baseSampleProject),
  {
    ...initializeProjectMaterialAdvisorData(baseSampleProject),
    climateContext: coastalProfile,
    selectedApplication: 'exterior-accent-cladding',
  }
);
const porousStoneCoastal = coastalReport.activeApplicationEvaluations.find(
  (c) => c.materialId === 'mat-ext-porous-limestone-unverified'
)!;
const saltDomain = porousStoneCoastal.domainEvaluations.find(
  (d) => d.domainId === 'coastal-salt-and-corrosion'
)!;
assert.strictEqual(
  saltDomain.status,
  'not-recommended-for-screened-conditions',
  'High-porosity salt-sensitive limestone must be not-recommended in nearshore coastal salt exposure'
);
console.log('  ✓ Coastal salt-spray corrosion screening verified.');

// 7. Wildfire WUI Ember Exposure Screening
console.log('7. Verifying Wildfire WUI ember exposure screening...');
const wuiProfile = REFERENCE_CLIMATE_PROFILES.find(
  (p) => p.profileId === 'ref-wildfire-interface-dry'
)!;
const { report: wuiReport } = saveProjectMaterialAdvisorSafely(
  cloneProject(baseSampleProject),
  {
    ...initializeProjectMaterialAdvisorData(baseSampleProject),
    climateContext: wuiProfile,
    selectedApplication: 'exterior-primary-facade',
  }
);
const timberWui = wuiReport.activeApplicationEvaluations.find(
  (c) => c.materialId === 'mat-ext-thermowood-cedar'
)!;
const wfDomain = timberWui.domainEvaluations.find(
  (d) => d.domainId === 'wildfire-and-specialized'
)!;
assert.strictEqual(
  wfDomain.status,
  'concern-identified',
  'Combustible organic timber cladding in high wildfire ember exposure must flag concern-identified'
);
console.log('  ✓ Wildfire WUI ember screening verified.');

// 8. Interior Wet Room vs Dry Room Finish Screening
console.log('8. Verifying Interior Wet Room vs Dry Room assembly compatibility...');
const temperateProfile = REFERENCE_CLIMATE_PROFILES.find(
  (p) => p.profileId === 'ref-temperate-mixed'
)!;
const interiorProj = cloneProject(baseSampleProject);
const bathroomRoom = interiorProj.floorPlan?.rooms?.find((r) =>
  r.name.toLowerCase().includes('bath')
)!;
const livingRoom = interiorProj.floorPlan?.rooms?.find((r) =>
  r.name.toLowerCase().includes('living')
)!;
assert(bathroomRoom && livingRoom, 'Sample project must have a bathroom and living room');

const oakPlankCandidate = BUILTIN_CLIMATE_MATERIAL_CATALOGUE.find(
  (c) => c.materialId === 'mat-int-floor-engineered-oak-plank'
)!;
const concreteFloorCandidate = BUILTIN_CLIMATE_MATERIAL_CATALOGUE.find(
  (c) => c.materialId === 'mat-int-floor-honed-concrete-terrazzo'
)!;

const oakInBathroom = evaluateMaterialCandidateForClimate(
  interiorProj,
  oakPlankCandidate,
  'interior-floor-finish',
  temperateProfile,
  { targetRoomId: bathroomRoom.id }
);
const concreteInBathroom = evaluateMaterialCandidateForClimate(
  interiorProj,
  concreteFloorCandidate,
  'interior-floor-finish',
  temperateProfile,
  { targetRoomId: bathroomRoom.id }
);
const oakInLivingRoom = evaluateMaterialCandidateForClimate(
  interiorProj,
  oakPlankCandidate,
  'interior-floor-finish',
  temperateProfile,
  { targetRoomId: livingRoom.id }
);

assert.strictEqual(
  oakInBathroom.overallStatus,
  'not-recommended-for-screened-conditions',
  'Moisture-sensitive engineered oak plank must be not-recommended in a Bathroom wet zone'
);
assert(
  concreteInBathroom.overallStatus === 'suitable-for-screened-conditions' ||
    concreteInBathroom.overallStatus === 'conditionally-suitable',
  'Honed concrete/terrazzo floor should be suitable in a Bathroom wet zone'
);
assert(
  oakInLivingRoom.overallStatus === 'suitable-for-screened-conditions' ||
    oakInLivingRoom.overallStatus === 'conditionally-suitable',
  'Engineered oak plank should be suitable in a dry conditioned Living Room'
);
console.log('  ✓ Interior wet vs dry room compatibility verified.');

// 9. Custom Material Registration Validation & Provenance Enforcement
console.log('9. Verifying custom material validation and provenance enforcement...');
const invalidResult = validateAndNormalizeCustomMaterial(
  {
    materialId: '',
    displayName: '',
    supportedApplications: [],
    solarReflectanceFraction: {
      value: 1.5, // invalid > 1
      unit: 'fraction',
      evidenceStatus: 'verified-product-data',
      sourceCitation: 'Test',
      applicableConditions: 'Test',
    },
    waterAbsorptionPctByWeight: {
      value: -5, // invalid negative
      unit: '%',
      evidenceStatus: 'user-entered',
      sourceCitation: 'Test',
      applicableConditions: 'Test',
    },
  },
  BUILTIN_CLIMATE_MATERIAL_CATALOGUE
);
assert.strictEqual(invalidResult.isValid, false, 'Invalid custom material must be rejected');
assert(invalidResult.errors.length >= 4, 'Must report specific validation errors');

const validCustomResult = validateAndNormalizeCustomMaterial(
  {
    materialId: 'mat-custom-terracotta-01',
    displayName: 'Custom Terracotta Louver Rainscreen',
    supportedApplications: ['exterior-primary-facade'],
    mappedFacadeMaterial: 'brick',
    solarReflectanceFraction: {
      value: 0.52,
      unit: 'fraction (0–1)',
      // Attempt to pass verified-product-data; service must downgrade to user-entered
      evidenceStatus: 'verified-product-data',
      sourceCitation: 'User entry',
      applicableConditions: 'User entry',
    },
  },
  BUILTIN_CLIMATE_MATERIAL_CATALOGUE
);
assert.strictEqual(validCustomResult.isValid, true, 'Valid custom material should pass');
assert(validCustomResult.normalizedCandidate, 'Normalized candidate must be returned');
assert.strictEqual(
  validCustomResult.normalizedCandidate.solarReflectanceFraction.evidenceStatus,
  'user-entered',
  'Custom material properties must never be promoted to verified-product-data without verification'
);
assert.strictEqual(
  validCustomResult.normalizedCandidate.freezeThawResistance.evidenceStatus,
  'unavailable',
  'Unspecified custom material properties must default to unavailable'
);
console.log('  ✓ Custom material validation and provenance enforcement verified.');

// 10. P30 Brief Confirmed vs Unconfirmed Requirement Separation & P32 Preference Signals
console.log(
  '10. Verifying P30 confirmed vs unconfirmed brief requirements and P32 preference separation...'
);
const briefTestProj = cloneProject(coldProj);
briefTestProj.brief = {
  ...briefTestProj.brief!,
  interpretedBrief: {
    version: '1.0',
    interpretedAt: new Date().toISOString(),
    rawBriefSnippet: 'Brick facade required',
    requirements: [
      {
        id: 'req-confirmed-brick',
        category: 'materials-sustainability',
        description: 'Primary facade must be clay brick masonry',
        rawValue: 'brick',
        normalizedValue: 'brick',
        priority: 'must-have',
        provenance: 'explicit-user-input',
        reviewStatus: 'confirmed',
      },
      {
        id: 'req-unconfirmed-glass',
        category: 'materials-sustainability',
        description: 'AI inferred glass facade requirement',
        rawValue: 'glass',
        normalizedValue: 'glass',
        priority: 'must-have',
        provenance: 'ai-inferred',
        reviewStatus: 'needs-review',
      },
    ],
    assumptions: [],
    conflicts: [],
  },
} as any;

const p30Extracted = extractP30MaterialRequirements(briefTestProj);
assert(
  p30Extracted.confirmedMandatoryMaterialKeywords.includes('brick'),
  'Confirmed P30 must-have brick requirement must be extracted'
);
assert(
  !p30Extracted.confirmedMandatoryMaterialKeywords.includes('glass'),
  'Unconfirmed needs-review AI inference for glass must NEVER be treated as a confirmed mandatory keyword'
);
assert.strictEqual(
  p30Extracted.unconfirmedMaterialAssumptions.length,
  1,
  'Needs-review AI inferences must remain in unconfirmedMaterialAssumptions'
);

const timberCandidate = BUILTIN_CLIMATE_MATERIAL_CATALOGUE.find(
  (c) => c.materialId === 'mat-ext-thermowood-cedar'
)!;
const brickCandidate = BUILTIN_CLIMATE_MATERIAL_CATALOGUE.find(
  (c) => c.materialId === 'mat-ext-clay-brick-cavity'
)!;

const timberEvalWithP30 = evaluateMaterialCandidateForClimate(
  briefTestProj,
  timberCandidate,
  'exterior-primary-facade',
  coldProfile
);
const brickEvalWithP30 = evaluateMaterialCandidateForClimate(
  briefTestProj,
  brickCandidate,
  'exterior-primary-facade',
  coldProfile
);
assert.strictEqual(
  timberEvalWithP30.p30BriefAlignment.matchesConfirmedRequirements,
  false,
  'Confirmed P30 brick requirement must flag non-match on timber'
);
assert.strictEqual(
  brickEvalWithP30.p30BriefAlignment.matchesConfirmedRequirements,
  true,
  'Confirmed P30 brick requirement must match brick and ignore unconfirmed glass inference'
);

// Verify P32 explicit vs unconfirmed suggestion separation
briefTestProj.designPersonalization = {
  profileId: 'pers-1',
  projectId: briefTestProj.id,
  version: '1.0',
  updatedAt: new Date().toISOString(),
  preferredStyles: [],
  preferredPrimaryMaterials: [],
  items: [
    {
      id: 'item-1',
      dimension: 'primary-material',
      label: 'Preferred Primary Material',
      value: ['brick'],
      weight: 80,
      origin: 'explicit-user',
      confirmationStatus: 'confirmed',
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'item-2',
      dimension: 'primary-material',
      label: 'Suggested Glass',
      value: ['glass'],
      weight: 80,
      origin: 'inferred-suggestion',
      confirmationStatus: 'unconfirmed-suggestion',
      updatedAt: new Date().toISOString(),
    },
  ],
  roomPriorities: {},
  spatialPriorityWeights: {
    openness: 50,
    privacy: 50,
    storageAndUtility: 50,
    daylightAndViews: 50,
    compactCirculation: 50,
    budgetControl: 50,
    lowCarbonMaterials: 75,
  },
  matchingCategoryWeights: {
    styleAndCharacter: 20,
    roomProgramFit: 25,
    spatialPriorities: 20,
    budgetFit: 15,
    siteAndClimateFit: 10,
    materialAndFeatureFit: 10,
  },
} as any;

const p32Signals = extractP32MaterialPreferences(briefTestProj);
assert(
  p32Signals.explicitPreferredMaterials.includes('brick'),
  'Explicit P32 preference for brick must be recognized'
);
assert(
  !p32Signals.explicitPreferredMaterials.includes('glass'),
  'Unconfirmed P32 suggestion for glass must not be promoted to explicitPreferredMaterials'
);
assert(
  p32Signals.inferredUnconfirmedMaterials.includes('glass'),
  'Unconfirmed P32 suggestion for glass must be tracked in inferredUnconfirmedMaterials'
);
console.log('  ✓ P30 Brief and P32 Personalization provenance separation verified.');

// 11. Side-by-Side Comparison, Hard Screen Separation & Missing-Data Penalty
console.log(
  '11. Verifying side-by-side comparison, hard screen separation, and missing-data scoring...'
);
const compResult = compareMaterialCandidatesForApplication(
  briefTestProj,
  'exterior-accent-cladding',
  coldProfile,
  {
    scoringEnabled: true,
    weights: DEFAULT_MATERIAL_RANKING_WEIGHTS,
  }
);
assert(compResult.entries.length >= 4, 'Should compare exterior accent cladding candidates');

const brickComp = compResult.entries.find(
  (c) => c.candidate.materialId === 'mat-ext-clay-brick-cavity'
)!;
const timberComp = compResult.entries.find(
  (c) => c.candidate.materialId === 'mat-ext-thermowood-cedar'
)!;
const unverifiedStoneComp = compResult.entries.find(
  (c) => c.candidate.materialId === 'mat-ext-porous-limestone-unverified'
)!;

assert.strictEqual(
  brickComp.meetsMandatoryAndClimateScreen,
  true,
  'Brick should pass mandatory P30 and cold climate screen'
);
assert.strictEqual(
  timberComp.meetsMandatoryAndClimateScreen,
  false,
  'Timber excluded by confirmed P30 requirement must fail mandatory screen'
);
assert.strictEqual(
  unverifiedStoneComp.meetsMandatoryAndClimateScreen,
  false,
  'Unverified stone with insufficient-evidence must not pass mandatory climate screen'
);
assert.strictEqual(
  unverifiedStoneComp.missingDataPenaltyApplied,
  true,
  'Missing freeze-thaw data must trigger missingDataPenaltyApplied (0 points contributed, weight kept in denominator)'
);
console.log('  ✓ Side-by-side comparison and missing-data denominator rules verified.');

// 12. Embodied Carbon Factor Alignment & P31 Option Comparison Summary
console.log(
  '12. Verifying embodied carbon factor preservation and P31 option comparison summary...'
);
assert.strictEqual(PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.timber, 180);
assert.strictEqual(PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.plaster, 290);
assert.strictEqual(PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.stone, 330);
assert.strictEqual(PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.brick, 390);
assert.strictEqual(PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.concrete, 490);
assert.strictEqual(PLOTIFY_SCENARIO_CARBON_FACTORS_KG_PER_M2.glass, 530);

const p31Summaries = getP35MaterialSummaryForOptionComparison(coldProj);
assert(p31Summaries.length >= 1, 'P31 summary must evaluate comparable options');
assert(
  (p31Summaries[0].embodiedCarbonIntensityKgPerM2Ref || 0) > 0,
  'P31 summary must report reference embodied carbon factor'
);
console.log('  ✓ Embodied carbon factor preservation and P31 option summary verified.');

// 13. Non-Destructive Preview, Atomic Apply, Snapshot Creation & Rollback
console.log(
  '13. Verifying non-destructive preview, atomic apply with pre-apply snapshot, and rollback...'
);
const applyTestProj = cloneProject(coldProj);
const originalRoomsJson = JSON.stringify(applyTestProj.floorPlan?.rooms || []);
const activeAltBefore = applyTestProj.designAlternatives![0];
const originalPrimaryMaterial = activeAltBefore.facade.primaryMaterial;

const targetCandidateId =
  originalPrimaryMaterial === 'brick'
    ? 'mat-ext-dense-ashlar-stone'
    : 'mat-ext-clay-brick-cavity';

const preview = previewMaterialSelection(applyTestProj, {
  application: 'exterior-primary-facade',
  materialId: targetCandidateId,
  targetAlternativeId: activeAltBefore.id,
});

assert.strictEqual(
  applyTestProj.designAlternatives![0].facade.primaryMaterial,
  originalPrimaryMaterial,
  'Previewing a material selection must NOT mutate the project in place'
);
assert.strictEqual(preview.isSafeToApply, true, 'Suitable material should be safely applicable');
assert.strictEqual(
  preview.preservesRoomGeometryAndIds,
  true,
  'Preview must verify room geometry and IDs are preserved'
);
assert(
  preview.fieldChanges.length >= 1,
  'Preview must show explicit field-by-field before/after diff'
);

// Apply selection atomically
const applyRes = applyMaterialSelectionSafely(applyTestProj, {
  application: 'exterior-primary-facade',
  materialId: targetCandidateId,
  targetAlternativeId: activeAltBefore.id,
});
assert(applyRes.snapshotId, 'Atomic apply must create a pre-apply safety snapshot');
assert.strictEqual(
  applyRes.updatedProject.materialAdvisor?.lastPreApplySnapshotId,
  applyRes.snapshotId,
  'Updated project must record lastPreApplySnapshotId'
);
assert.strictEqual(
  JSON.stringify(applyRes.updatedProject.floorPlan?.rooms || []),
  originalRoomsJson,
  'Applying a material specification must NEVER alter 2D room dimensions or floorPlan geometry'
);

// Verify stale fingerprint detection when facade material is externally mutated
const mutatedProj = cloneProject(applyRes.updatedProject);
mutatedProj.designAlternatives![0].facade.primaryMaterial = 'glass';
const staleReport = evaluateProjectMaterialAdvisor(mutatedProj);
assert.strictEqual(
  staleReport.isStale,
  true,
  'External mutation to facade material must mark saved P35 fingerprint as stale'
);

// Rollback to pre-apply checkpoint
const restoredProject = rollbackMaterialAdvisorChanges(applyRes.updatedProject);
assert.strictEqual(
  restoredProject.designAlternatives![0].facade.primaryMaterial,
  originalPrimaryMaterial,
  'Rolled back project must restore exact original facade primaryMaterial'
);
console.log('  ✓ Non-destructive preview, atomic apply, stale detection, and rollback verified.');

console.log('\n================================================================');
console.log('ALL P35 CLIMATE-RESPONSIVE MATERIAL ADVISOR CHECKS PASSED');
console.log('================================================================\n');
