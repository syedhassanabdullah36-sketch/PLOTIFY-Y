import assert from 'node:assert/strict';
import { INITIAL_SAMPLE_PROJECTS } from './src/services/storage';
import { initializeProjectScenarios } from './src/services/scenarioCalculator';
import { initializeProjectSiteContext } from './src/services/siteIntelligenceService';
import {
  initializeProjectBrief,
  interpretDesignBrief,
  integrateInterpretedBriefIntoProject,
  updateInterpretedRequirement,
} from './src/services/briefService';
import {
  P31_COMPARISON_CALCULATION_VERSION,
  P31_COMPLIANCE_DISCLAIMER,
  compareDesignOptions,
  convertMeasurementUnit,
  extractComparableOptions,
  getComparisonCriteriaCatalog,
  roundToStep,
  saveComparisonConfigToProject,
  shouldApplyComparisonResult,
  validateSelectedOptionIds,
} from './src/services/designComparisonService';
import { Project } from './src/types/project';

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

console.log('==========================================================');
console.log('PLOTIFY P31 — MULTI-OPTION DESIGN COMPARISON TEST SUITE');
console.log('==========================================================');

const baseSample: Project = JSON.parse(JSON.stringify(INITIAL_SAMPLE_PROJECTS[0]));
baseSample.scenarios = initializeProjectScenarios(baseSample);
baseSample.siteContext = initializeProjectSiteContext(baseSample);

// 1. Option Extraction & Selection Validation
runTest('1. Extracts baseline, spatial scenarios, and design alternatives with stable IDs', () => {
  const options = extractComparableOptions(baseSample);
  assert.ok(options.length >= 4, `Expected at least 4 options, got ${options.length}`);
  assert.equal(options[0].optionId, `baseline:${baseSample.id}`);
  assert.equal(options[0].kind, 'baseline-project');

  const scenarioOptions = options.filter((o) => o.kind === 'design-scenario');
  assert.ok(scenarioOptions.length >= 2, 'Expected non-baseline spatial scenario options');
  for (const s of scenarioOptions) {
    assert.ok(s.optionId.startsWith('scenario:'));
    assert.equal(s.sharesBaselineGeometry, false);
  }
});

runTest('2. Rejects fewer than 2 options, duplicate IDs, or non-existent option IDs cleanly', () => {
  const options = extractComparableOptions(baseSample);
  const singleCheck = validateSelectedOptionIds(options, [options[0].optionId]);
  assert.equal(singleCheck.hasMinimumTwoOptions, false);
  assert.ok(singleCheck.validationErrors[0]?.includes('At least 2'));

  const duplicateCheck = validateSelectedOptionIds(options, [
    options[0].optionId,
    options[0].optionId,
  ]);
  assert.equal(duplicateCheck.hasMinimumTwoOptions, false);
  assert.equal(duplicateCheck.validSelectedOptions.length, 1);
  assert.ok(duplicateCheck.rejectedDuplicateIds.includes(options[0].optionId));

  const missingIdCheck = validateSelectedOptionIds(options, [
    options[0].optionId,
    'scenario:non-existent-id-999',
  ]);
  assert.equal(missingIdCheck.hasMinimumTwoOptions, false);
  assert.ok(missingIdCheck.missingOrDeletedIds.includes('scenario:non-existent-id-999'));
});

// 2. Deterministic Metric Calculation
runTest('3. Computes deterministic spatial, efficiency, cost, and validation metrics across options', () => {
  const options = extractComparableOptions(baseSample);
  const selectedIds = options
    .filter((o) => o.kind === 'baseline-project' || o.kind === 'design-scenario')
    .slice(0, 3)
    .map((o) => o.optionId);

  const res1 = compareDesignOptions(baseSample, { selectedOptionIds: selectedIds });
  const res2 = compareDesignOptions(baseSample, { selectedOptionIds: selectedIds });

  assert.equal(res1.calculationVersion, P31_COMPARISON_CALCULATION_VERSION);
  assert.equal(res1.optionDiagnostics.hasMinimumTwoOptions, true);
  assert.equal(res1.selectedOptions.length, 3);

  // Verify deterministic repeatability
  for (let i = 0; i < res1.criteriaComparisons.length; i++) {
    const row1 = res1.criteriaComparisons[i];
    const row2 = res2.criteriaComparisons[i];
    assert.equal(row1.criterion.id, row2.criterion.id);
    for (const optId of selectedIds) {
      assert.equal(
        row1.valuesByOptionId[optId].rawValue,
        row2.valuesByOptionId[optId].rawValue
      );
      assert.equal(
        row1.valuesByOptionId[optId].formattedValue,
        row2.valuesByOptionId[optId].formattedValue
      );
    }
  }

  // Verify Compact vs Spacious scenario differences
  const gfaRow = res1.criteriaComparisons.find(
    (r) => r.criterion.id === 'estimated-gross-floor-area'
  );
  assert.ok(gfaRow, 'Expected estimated-gross-floor-area row');
  assert.ok(gfaRow.rangeSpread !== null && gfaRow.rangeSpread > 0);
});

// 3. Unit Consistency & Conversion
runTest('4. Normalizes area and linear units accurately between metres and feet', () => {
  const areaSqFt = convertMeasurementUnit(100, 'metres', 'feet', 'area');
  assert.ok(Math.abs(areaSqFt - 1076.391) < 0.01);
  const backToSqM = convertMeasurementUnit(areaSqFt, 'feet', 'metres', 'area');
  assert.ok(Math.abs(backToSqM - 100) < 0.01);

  const lenFt = convertMeasurementUnit(10, 'metres', 'feet', 'linear');
  assert.ok(Math.abs(lenFt - 32.8084) < 0.01);
  assert.equal(roundToStep(14.236, 0.1), 14.2);
});

// 4. Missing Data Handling (Never Fabricated as 0)
runTest('5. Marks missing budget and empty geometry as unavailable (null) rather than 0', () => {
  const noBudgetProject: Project = JSON.parse(JSON.stringify(baseSample));
  noBudgetProject.budget = 0;
  // Note: scenarios[0] is baseline (skipped in scenario loop), scenarios[1] and scenarios[2] are non-baseline
  noBudgetProject.scenarios = noBudgetProject.scenarios?.map((s, idx) =>
    idx === 2 ? { ...s, budget: 0, rooms: [] } : { ...s, budget: 0 }
  );

  const options = extractComparableOptions(noBudgetProject);
  const scenIds = options
    .filter((o) => o.kind === 'design-scenario')
    .slice(0, 2)
    .map((o) => o.optionId);

  const result = compareDesignOptions(noBudgetProject, { selectedOptionIds: scenIds });

  const budgetFitRow = result.criteriaComparisons.find(
    (r) => r.criterion.id === 'budget-surplus-deficit'
  );
  assert.ok(budgetFitRow);
  for (const id of scenIds) {
    assert.equal(budgetFitRow.valuesByOptionId[id].rawValue, null);
    assert.equal(budgetFitRow.valuesByOptionId[id].status, 'unavailable');
    assert.equal(budgetFitRow.valuesByOptionId[id].provenance, 'unavailable');
  }

  // Empty rooms on second non-baseline scenario must produce null area, not 0
  const emptyOptId = scenIds[1];
  const gfaRow = result.criteriaComparisons.find(
    (r) => r.criterion.id === 'net-usable-room-area'
  );
  assert.ok(gfaRow);
  assert.equal(gfaRow.valuesByOptionId[emptyOptId].rawValue, null);
  assert.equal(gfaRow.valuesByOptionId[emptyOptId].status, 'unavailable');
});

// 5. Provenance & Roadmap Scope Lock
runTest('6. Assigns accurate provenance badges and keeps P33/P34/P35-P38 criteria explicitly unavailable', () => {
  const catalog = getComparisonCriteriaCatalog(baseSample);
  const p33 = catalog.find((c) => c.id === 'corridor-furniture-circulation');
  const p34 = catalog.find((c) => c.id === 'universal-accessibility-audit');
  const p35 = catalog.find((c) => c.id === 'environmental-comfort-simulations');

  assert.equal(p33?.isAvailableInCodebase, false);
  assert.equal(p34?.isAvailableInCodebase, false);
  assert.equal(p35?.isAvailableInCodebase, false);

  const options = extractComparableOptions(baseSample);
  const selectedIds = options.slice(0, 2).map((o) => o.optionId);
  const result = compareDesignOptions(baseSample, {
    selectedOptionIds: selectedIds,
    selectedCriterionIds: [
      'net-usable-room-area',
      'buildable-envelope-efficiency',
      'estimated-construction-cost',
      'corridor-furniture-circulation',
    ],
  });

  const netRow = result.criteriaComparisons.find(
    (r) => r.criterion.id === 'net-usable-room-area'
  );
  const effRow = result.criteriaComparisons.find(
    (r) => r.criterion.id === 'buildable-envelope-efficiency'
  );
  const costRow = result.criteriaComparisons.find(
    (r) => r.criterion.id === 'estimated-construction-cost'
  );
  const furnRow = result.criteriaComparisons.find(
    (r) => r.criterion.id === 'corridor-furniture-circulation'
  );

  assert.equal(netRow?.valuesByOptionId[selectedIds[0]].provenance, 'measured');
  assert.equal(effRow?.valuesByOptionId[selectedIds[0]].provenance, 'calculated');
  assert.equal(costRow?.valuesByOptionId[selectedIds[0]].provenance, 'estimated');
  assert.equal(furnRow?.valuesByOptionId[selectedIds[0]].provenance, 'unavailable');
  assert.equal(furnRow?.valuesByOptionId[selectedIds[0]].rawValue, null);
});

// 6. P30 Brief Integration (Confirmed Constraints vs Unconfirmed AI Assumptions)
runTest('7. Distinguishes P30 confirmed requirements from unconfirmed AI inferences', () => {
  const p30Project: Project = JSON.parse(JSON.stringify(baseSample));
  const briefData = initializeProjectBrief(p30Project);
  let interpreted = interpretDesignBrief(
    'Two-storey house for 6 people with 4 bedrooms, 3 bathrooms, an open kitchen, and a moderate construction budget.',
    p30Project
  );

  // Confirm first requirement, keep inferred requirements as 'needs-review'
  if (interpreted.requirements.length > 0) {
    interpreted = updateInterpretedRequirement(
      interpreted,
      interpreted.requirements[0].id,
      { reviewStatus: 'confirmed' },
      p30Project
    );
  }

  const integration = integrateInterpretedBriefIntoProject(
    p30Project,
    briefData,
    interpreted
  );

  const options = extractComparableOptions(integration.updatedProject);
  const selectedIds = options.slice(0, 2).map((o) => o.optionId);
  const result = compareDesignOptions(integration.updatedProject, {
    selectedOptionIds: selectedIds,
  });

  assert.equal(result.p30BriefSummary.hasP30InterpretedBrief, true);
  assert.ok(result.p30BriefSummary.confirmedRequirementsCount >= 1);

  const unconfirmedChecks = result.briefConstraintChecks.filter((c) => !c.isBindingConstraint);
  assert.ok(unconfirmedChecks.length >= 1, 'Expected unconfirmed assumptions in briefConstraintChecks');
  for (const uc of unconfirmedChecks) {
    assert.equal(uc.outcomesByOptionId[selectedIds[0]].status, 'assumption-only');
  }
});

// 7. Optional Weighted Preference Scoring & Missing Data Penalty
runTest('8. Computes weighted preference scores fairly and penalizes missing data instead of inflating scores', () => {
  const testProject: Project = JSON.parse(JSON.stringify(baseSample));
  testProject.scenarios = initializeProjectScenarios(testProject);
  // scenarios[1] is Compact, scenarios[2] is Spacious; clear rooms on scenarios[2]
  testProject.scenarios[2].rooms = [];

  const options = extractComparableOptions(testProject);
  const scenCompact = options.find(
    (o) => o.optionId === `scenario:${testProject.scenarios![1].id}`
  )!;
  const scenEmpty = options.find(
    (o) => o.optionId === `scenario:${testProject.scenarios![2].id}`
  )!;

  const result = compareDesignOptions(testProject, {
    selectedOptionIds: [scenCompact.optionId, scenEmpty.optionId],
    selectedCriterionIds: ['net-usable-room-area', 'buildable-envelope-efficiency'],
    scoringEnabled: true,
    customWeights: {
      'net-usable-room-area': 50,
      'buildable-envelope-efficiency': 50,
    },
  });

  const scoreCompact = result.optionScores.find((s) => s.optionId === scenCompact.optionId)!;
  const scoreEmpty = result.optionScores.find((s) => s.optionId === scenEmpty.optionId)!;

  assert.equal(scoreCompact.dataCoveragePercent, 100);
  assert.equal(scoreEmpty.dataCoveragePercent, 0);
  assert.equal(scoreEmpty.aggregatePreferenceScore, null);
  assert.ok((scoreCompact.aggregatePreferenceScore ?? 0) > 0);
});

// 8. Stale Request Guard & Non-Destructive Persistence
runTest('9. Prevents stale comparison overwrites and saves configuration without mutating design options', () => {
  const resSeq5 = compareDesignOptions(baseSample, { requestSequenceId: 5 });
  const resSeq3 = compareDesignOptions(baseSample, { requestSequenceId: 3 });
  const resSeq6 = compareDesignOptions(baseSample, { requestSequenceId: 6 });

  assert.equal(shouldApplyComparisonResult(resSeq5, resSeq3), false);
  assert.equal(shouldApplyComparisonResult(resSeq5, resSeq5), true);
  assert.equal(shouldApplyComparisonResult(resSeq5, resSeq6), true);

  const beforeRoomsJson = JSON.stringify(baseSample.floorPlan?.rooms);
  const beforeScenariosJson = JSON.stringify(baseSample.scenarios);

  const savedProject = saveComparisonConfigToProject(baseSample, {
    selectedOptionIds: [`baseline:${baseSample.id}`, `scenario:${baseSample.scenarios![1].id}`],
    selectedCriterionIds: ['net-usable-room-area', 'estimated-construction-cost'],
    customWeights: { 'net-usable-room-area': 40 },
    scoringEnabled: true,
  });

  assert.ok(savedProject.designComparison);
  assert.equal(
    savedProject.designComparison.calculationVersion,
    P31_COMPARISON_CALCULATION_VERSION
  );
  assert.equal(JSON.stringify(savedProject.floorPlan?.rooms), beforeRoomsJson);
  assert.equal(JSON.stringify(savedProject.scenarios), beforeScenariosJson);
  assert.ok(P31_COMPLIANCE_DISCLAIMER.includes('does NOT certify'));
});

console.log('----------------------------------------------------------');
console.log(`P31 Test Summary: ${passed} passed, ${failed} failed`);
console.log('----------------------------------------------------------');

if (failed > 0) {
  process.exit(1);
}
