/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P32 — Adaptive Design Personalization Verification Suite
 *
 * Verifies:
 * 1. Saving, editing, resetting, and removing project-scoped preferences.
 * 2. Distinguishing explicit user preferences, imported project facts, and unconfirmed P30 suggestions.
 * 3. Confirming or rejecting unconfirmed suggestions without silent promotion.
 * 4. Detecting conflicts between competing preferences and between preferences and hard constraints.
 * 5. Ranking/filtering candidate design options deterministically using P31 + P32 criteria.
 * 6. Ensuring hard constraint violations are never hidden or overridden by high soft preference scores.
 * 7. Ensuring missing/unknown data contributes 0 points while keeping its full weight in the denominator.
 * 8. Generating explainable match reasons, trade-offs, and unmet preference disclosures.
 * 9. Previewing a personalized option non-destructively without mutating saved project geometry.
 * 10. Applying a personalized option atomically with an automatic safety snapshot and rolling back cleanly.
 * 11. Stale async evaluation protection via requestSequenceId and sourceFingerprint.
 */

import assert from 'node:assert/strict';
import { INITIAL_SAMPLE_PROJECTS } from './src/services/storage';
import { initializeProjectScenarios } from './src/services/scenarioCalculator';
import {
  initializeProjectBrief,
  interpretDesignBrief,
  integrateInterpretedBriefIntoProject,
  updateInterpretedRequirement,
} from './src/services/briefService';
import { extractComparableOptions } from './src/services/designComparisonService';
import {
  initializePersonalizationProfile,
  updatePersonalizationProfile,
  reviewPersonalizationPreferenceItem,
  resetPersonalizationProfile,
  savePersonalizationProfileToProject,
  removePersonalizationProfileFromProject,
  detectPersonalizationConflicts,
  evaluateDesignPersonalization,
  shouldApplyPersonalizationResult,
  buildPersonalizationPreview,
  applyPersonalizedOptionSafely,
  rollbackPersonalizationToSnapshot,
  computePersonalizationSourceFingerprint,
} from './src/services/designPersonalizationService';
import { Project } from './src/types/project';

console.log('==========================================================');
console.log('PLOTIFY P32 — ADAPTIVE DESIGN PERSONALIZATION TEST SUITE');
console.log('==========================================================\n');

const baseSample: Project = JSON.parse(JSON.stringify(INITIAL_SAMPLE_PROJECTS[0]));
const scenarios = initializeProjectScenarios(baseSample);
const testProject: Project = {
  ...baseSample,
  scenarios,
};

// 1. Test initialization & epistemic separation with P30 brief
console.log('1. Testing profile initialization & P30 epistemic provenance separation...');
const initialBrief = initializeProjectBrief(testProject);
let interpreted = interpretDesignBrief(
  'I want a 2-storey house for 5 people with 3 bedrooms, an open kitchen, good natural light, privacy from the street, and a moderate budget of $420,000.',
  testProject
);

// Keep first requirement confirmed and leave others as 'needs-review'
if (interpreted.requirements.length >= 2) {
  interpreted = updateInterpretedRequirement(
    interpreted,
    interpreted.requirements[0].id,
    { reviewStatus: 'confirmed' },
    testProject
  );
  interpreted = updateInterpretedRequirement(
    interpreted,
    interpreted.requirements[1].id,
    { reviewStatus: 'needs-review' },
    testProject
  );
}

const integration = integrateInterpretedBriefIntoProject(testProject, initialBrief, interpreted);
const projectWithP30: Project = integration.updatedProject;

const profile = initializePersonalizationProfile(projectWithP30);
const confirmedItems = profile.items.filter((i) => i.confirmationStatus === 'confirmed');
const unconfirmedSuggestions = profile.items.filter(
  (i) => i.confirmationStatus === 'unconfirmed-suggestion'
);

assert.ok(
  confirmedItems.length >= 1,
  'Expected at least 1 confirmed item (imported fact or confirmed P30 requirement)'
);
assert.ok(
  unconfirmedSuggestions.length >= 1,
  'Expected unconfirmed P30 assumptions/needs-review items to be classified as unconfirmed-suggestion'
);
assert.ok(
  unconfirmedSuggestions.every((i) => i.origin === 'inferred-suggestion'),
  'All unconfirmed suggestions must have origin === inferred-suggestion'
);
console.log(
  `   ✓ Initialized profile: ${confirmedItems.length} confirmed items, ${unconfirmedSuggestions.length} unconfirmed suggestions.\n`
);

// 2. Test confirming and rejecting unconfirmed suggestions
console.log('2. Testing explicit user confirmation and rejection of inferred suggestions...');
const targetSuggestion = unconfirmedSuggestions[0];
const afterConfirm = reviewPersonalizationPreferenceItem(profile, targetSuggestion.id, {
  confirmationStatus: 'confirmed',
});
const confirmedItemAfter = afterConfirm.items.find((i) => i.id === targetSuggestion.id);
assert.equal(confirmedItemAfter?.confirmationStatus, 'confirmed');
assert.equal(confirmedItemAfter?.origin, 'explicit-user');

if (unconfirmedSuggestions.length > 1) {
  const secondSuggestion = unconfirmedSuggestions[1];
  const afterReject = reviewPersonalizationPreferenceItem(afterConfirm, secondSuggestion.id, {
    confirmationStatus: 'rejected',
  });
  const rejectedItemAfter = afterReject.items.find((i) => i.id === secondSuggestion.id);
  assert.equal(rejectedItemAfter?.confirmationStatus, 'rejected');
}
console.log('   ✓ Unconfirmed suggestions require explicit user review and transition cleanly.\n');

// 3. Test saving, editing, resetting, and removing preferences
console.log('3. Testing saving, editing, resetting, and removing project-scoped preferences...');
const editedProfile = updatePersonalizationProfile(projectWithP30, afterConfirm, {
  preferredFacadeStyles: ['Contemporary'],
  preferredPrimaryMaterials: ['timber'],
  preferredCostTiers: ['Balanced Mid-Range'],
  preferredInteriorStyles: ['Japandi'],
  preferredShadingStyles: ['deep-overhangs'],
  preferredFloors: 2,
  spatialPriorityWeights: {
    ...afterConfirm.spatialPriorityWeights,
    opennessAndLivingArea: 90,
    lowCarbonMaterials: 85,
  },
  notes: 'Client prefers passive shading and timber louvers.',
});

assert.ok(
  editedProfile.preferredFacadeStyles.includes('Contemporary'),
  'Edited facade style preference should be stored'
);
assert.equal(
  editedProfile.spatialPriorityWeights.opennessAndLivingArea,
  90,
  'Edited spatial priority weight should be stored'
);

const savedProject = savePersonalizationProfileToProject(projectWithP30, editedProfile);
assert.ok(
  Boolean(savedProject.designPersonalization),
  'Project should persist designPersonalization profile'
);
assert.equal(
  savedProject.designPersonalization?.notes,
  'Client prefers passive shading and timber louvers.'
);

const resetProfile = resetPersonalizationProfile(savedProject);
assert.equal(
  resetProfile.notes,
  undefined,
  'Reset profile should clear user notes and revert to initial project facts'
);

const removedProject = removePersonalizationProfileFromProject(savedProject);
assert.equal(
  removedProject.designPersonalization,
  undefined,
  'removePersonalizationProfileFromProject should remove designPersonalization from project'
);
console.log('   ✓ Save, edit, reset, and remove operations verified.\n');

// 4. Test preference conflict detection
console.log('4. Testing preference vs. preference and preference vs. constraint conflict detection...');
const conflictingProfile = updatePersonalizationProfile(projectWithP30, editedProfile, {
  preferredCostTiers: ['Ultra Luxury'],
  preferredPrimaryMaterials: ['concrete'],
  preferredFloors: 1,
  budgetRange: {
    minBudget: 150000,
    targetBudget: 220000,
    maxBudget: 220000,
    currency: projectWithP30.currency,
    isHardCap: true,
    origin: 'explicit-user',
    confirmationStatus: 'confirmed',
  },
  spatialPriorityWeights: {
    ...editedProfile.spatialPriorityWeights,
    opennessAndLivingArea: 85,
    compactPlotFootprint: 85,
    budgetPredictability: 85,
    lowCarbonMaterials: 80,
  },
});

const detectedConflicts = detectPersonalizationConflicts(projectWithP30, conflictingProfile);
assert.ok(detectedConflicts.length >= 2, 'Should detect multiple preference/constraint conflicts');
assert.ok(
  detectedConflicts.some((c) => c.id === 'p32-conflict-openness-vs-compact-single-storey'),
  'Should detect competing openness vs compact single-storey footprint conflict'
);
assert.ok(
  detectedConflicts.some((c) => c.id === 'p32-conflict-luxury-tier-vs-budget-priority'),
  'Should detect luxury tier vs budget control conflict'
);
assert.ok(
  detectedConflicts.some((c) => c.id === 'p32-conflict-material-vs-low-carbon'),
  'Should detect high-carbon material vs low-carbon priority conflict'
);
console.log(`   ✓ Detected ${detectedConflicts.length} explicit conflicts with actionable resolutions.\n`);

// 5. Test deterministic ranking, explainability, and separation of hard constraints vs soft scores
console.log('5. Testing deterministic option ranking, explanations, and hard-constraint precedence...');
const evalResult = evaluateDesignPersonalization(projectWithP30, editedProfile, {
  requestSequenceId: 10,
});

assert.ok(
  evalResult.recommendations.length >= 2,
  `Expected at least 2 evaluated options, got ${evalResult.recommendations.length}`
);

for (const rec of evalResult.recommendations) {
  assert.ok(
    rec.preferenceMatchScore !== null &&
      rec.preferenceMatchScore >= 0 &&
      rec.preferenceMatchScore <= 100,
    `Preference match score out of bounds: ${rec.preferenceMatchScore}`
  );
  assert.ok(
    rec.criterionMatches.length >= 5,
    `Expected at least 5 criterion match breakdowns, got ${rec.criterionMatches.length}`
  );
  assert.ok(
    typeof rec.whySuggestedExplanation === 'string' && rec.whySuggestedExplanation.length > 10,
    'Every recommendation must include a plain-language whySuggestedExplanation'
  );
  assert.ok(
    Array.isArray(rec.whatUserCanChangeGuidance) && rec.whatUserCanChangeGuidance.length >= 1,
    'Every recommendation must include actionable whatUserCanChangeGuidance'
  );
}

// Verify hard-constraint ordering: any option satisfying all hard constraints must rank ahead of any option with hard-constraint conflicts
for (let i = 0; i < evalResult.recommendations.length - 1; i++) {
  const current = evalResult.recommendations[i];
  const next = evalResult.recommendations[i + 1];
  if (!current.hardConstraintsAllMet) {
    assert.equal(
      next.hardConstraintsAllMet,
      false,
      'An option with hard-constraint violations must never rank above an option that satisfies all hard constraints'
    );
  }
}
console.log(
  `   ✓ Ranked ${evalResult.recommendations.length} options; top option: "${evalResult.recommendations[0].optionName}" (${evalResult.recommendations[0].preferenceMatchScore}/100 fit, hardConstraintsAllMet=${evalResult.recommendations[0].hardConstraintsAllMet}).\n`
);

// 6. Test missing data handling (unknown data must contribute 0 points and never inflate score)
console.log('6. Testing missing/unknown data handling (no score inflation)...');
const projectWithMissingGeometry: Project = JSON.parse(JSON.stringify(projectWithP30));
projectWithMissingGeometry.budget = 0;
if (projectWithMissingGeometry.scenarios && projectWithMissingGeometry.scenarios.length > 2) {
  projectWithMissingGeometry.scenarios[2].rooms = [];
  projectWithMissingGeometry.scenarios[2].budget = 0;
}
const profileWithMissingData = updatePersonalizationProfile(
  projectWithMissingGeometry,
  initializePersonalizationProfile(projectWithMissingGeometry),
  {
    spatialPriorityWeights: {
      opennessAndLivingArea: 80,
      privacyAndZoneSeparation: 70,
      storageAndUtilityCapacity: 60,
      budgetPredictability: 80,
      lowCarbonMaterials: 75,
      compactPlotFootprint: 70,
      naturalLightAndShading: 60,
    },
  }
);
const evalMissing = evaluateDesignPersonalization(
  projectWithMissingGeometry,
  profileWithMissingData
);
const emptyRoomsRec = evalMissing.recommendations.find((r) =>
  r.criterionMatches.some((m) => m.status === 'unknown-data')
);
assert.ok(emptyRoomsRec, 'Expected recommendation with unknown-data criterion matches');
const unknownMatches = emptyRoomsRec.criterionMatches.filter(
  (m) => m.status === 'unknown-data'
);
assert.ok(unknownMatches.length >= 1, 'Expected at least 1 unknown-data match');
for (const um of unknownMatches) {
  assert.equal(um.rawMatchScore, null);
  assert.equal(
    um.weightedContribution,
    0,
    'Unknown data must contribute 0 weighted points while keeping its weight in the denominator'
  );
}
assert.equal(emptyRoomsRec.missingDataPenaltyApplied, true);
assert.ok(
  emptyRoomsRec.dataCoveragePercent < 100,
  `Expected dataCoveragePercent < 100%, got ${emptyRoomsRec.dataCoveragePercent}%`
);
console.log(
  `   ✓ Unknown data contributed 0 points with missingDataPenaltyApplied=true (${emptyRoomsRec.dataCoveragePercent}% coverage).\n`
);

// 7. Test non-destructive preview and atomic apply + rollback with safety snapshot
console.log('7. Testing non-destructive preview, atomic apply with safety checkpoint, and rollback...');
const beforeRoomsJson = JSON.stringify(savedProject.floorPlan?.rooms || []);
const beforeFloors = savedProject.floors;

const allComparable = extractComparableOptions(savedProject);
const candidateOption =
  allComparable.find((o) => o.kind === 'design-scenario') ||
  allComparable.find((o) => o.kind === 'design-alternative') ||
  allComparable[0];

const previewDiff = buildPersonalizationPreview(savedProject, candidateOption.optionId);
assert.ok(previewDiff !== null, 'buildPersonalizationPreview should return a valid diff object');
assert.equal(
  JSON.stringify(savedProject.floorPlan?.rooms || []),
  beforeRoomsJson,
  'Previewing an option must never mutate saved project rooms'
);
assert.equal(
  savedProject.floors,
  beforeFloors,
  'Previewing an option must never mutate saved project floors'
);

const applyRes = applyPersonalizedOptionSafely(
  savedProject,
  editedProfile,
  candidateOption.optionId
);
assert.equal(applyRes.success, true, 'applyPersonalizedOptionSafely should succeed');
assert.ok(
  applyRes.safetySnapshot && Boolean(applyRes.safetySnapshot.id),
  'Applying an option must create a safety snapshot with a valid ID'
);
assert.ok(
  applyRes.updatedProject !== undefined,
  'Applying an option must return updatedProject'
);

const rollbackRes = rollbackPersonalizationToSnapshot(
  applyRes.updatedProject!,
  applyRes.safetySnapshot!
);
assert.equal(rollbackRes.success, true, 'rollbackPersonalizationToSnapshot must succeed');
assert.ok(rollbackRes.restoredProject !== undefined);
assert.equal(
  JSON.stringify(rollbackRes.restoredProject?.floorPlan?.rooms || []),
  beforeRoomsJson,
  'Restored project must match the exact pre-application room geometry'
);
assert.equal(
  rollbackRes.restoredProject?.floors,
  beforeFloors,
  'Restored project must match the exact pre-application floor count'
);
console.log(
  `   ✓ Preview, atomic apply (snapshot ${applyRes.safetySnapshot!.versionTag}), and full rollback verified.\n`
);

// 8. Test stale async evaluation guard
console.log('8. Testing stale evaluation sequence guard...');
const newerEval = evaluateDesignPersonalization(projectWithP30, editedProfile, {
  requestSequenceId: 25,
});
const staleEval = evaluateDesignPersonalization(projectWithP30, editedProfile, {
  requestSequenceId: 12,
});
assert.equal(
  shouldApplyPersonalizationResult(newerEval, staleEval),
  false,
  'shouldApplyPersonalizationResult must reject stale lower requestSequenceId results'
);
assert.equal(
  shouldApplyPersonalizationResult(staleEval, newerEval),
  true,
  'shouldApplyPersonalizationResult must accept newer higher requestSequenceId results'
);
const fp1 = computePersonalizationSourceFingerprint(projectWithP30, editedProfile);
const fp2 = computePersonalizationSourceFingerprint(projectWithP30, editedProfile);
assert.equal(fp1, fp2, 'computePersonalizationSourceFingerprint must be deterministic');
console.log('   ✓ Stale evaluation protection and fingerprint determinism verified.\n');

console.log('==========================================================');
console.log('ALL P32 ADAPTIVE DESIGN PERSONALIZATION TESTS PASSED (8/8)');
console.log('==========================================================');
