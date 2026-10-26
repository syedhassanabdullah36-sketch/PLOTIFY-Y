import { Project } from './src/types/project';
import {
  initializeProjectBrief,
  calculateSpaceProgramSummary,
  compareBriefWithFloorPlan,
  validateBrief,
  getBriefTemplates,
  recordBriefRevision,
  interpretDesignBrief,
  interpretDesignBriefAsync,
  validateExternalBriefOutput,
  normalizeRequirementCategory,
  updateInterpretedRequirement,
  addManualInterpretedRequirement,
  removeInterpretedRequirement,
  reviewBriefAssumption,
  answerClarificationQuestion,
  shouldApplyInterpretationResponse,
  integrateInterpretedBriefIntoProject,
} from './src/services/briefService';
import { generateProjectEvidenceRecords } from './src/services/evidenceEngine';
import {
  generateBriefSpaceProgramCSV,
  generateBriefDocumentMarkdown,
} from './src/services/documentationEngine';

console.log('================================================================');
console.log('PLOTIFY PROMPT 12 & P30: ARCHITECTURAL BRIEF & AI INTERPRETER TEST');
console.log('================================================================\n');

const testProject: Project = {
  id: 'proj-brief-test-01',
  name: 'Nordic Passive Villa',
  projectType: 'house',
  plotWidth: 50,
  plotLength: 80,
  unit: 'feet',
  roadFacing: 'North',
  floors: 2,
  rooms: {
    livingRoom: 1,
    bedrooms: 3,
    bathrooms: 2,
    kitchen: 1,
    diningRoom: 1,
    balcony: 1,
    garage: 1,
    customRooms: [],
  },
  budget: 450000,
  currency: 'USD',
  notes: 'Prompt 12 Acceptance Testing Project',
  status: 'Schematic Design',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  floorPlan: {
    rooms: [
      {
        id: 'r-liv-1',
        name: 'Living Room',
        type: 'living',
        x: 5,
        y: 5,
        width: 18,
        length: 20, // 360 sq ft
        floorLevel: 1,
      },
      {
        id: 'r-kit-1',
        name: 'Kitchen',
        type: 'kitchen',
        x: 25,
        y: 5,
        width: 12,
        length: 15, // 180 sq ft
        floorLevel: 1,
      },
      {
        id: 'r-bed-1',
        name: 'Master Suite',
        type: 'bedroom',
        x: 5,
        y: 5,
        width: 15,
        length: 16, // 240 sq ft
        floorLevel: 2,
      },
    ],
    gridSnap: 0.5,
    showGrid: true,
  },
};

// -------------------------------------------------------------------------
// TEST 1: Brief Initialization & Synthesis from Project Parameters
// -------------------------------------------------------------------------
console.log('Test 1: Brief Initialization & Synthesis...');
const brief = initializeProjectBrief(testProject);

if (!brief || !brief.spaces || brief.spaces.length === 0) {
  throw new Error('Test 1 Failed: Brief spaces were not synthesized');
}
if (brief.approvalStatus !== 'draft') {
  throw new Error(`Test 1 Failed: Expected initial status 'draft', got ${brief.approvalStatus}`);
}
if (!brief.objectives.primaryPurpose.includes('Nordic Passive Villa')) {
  throw new Error('Test 1 Failed: Brief objectives did not synthesize project name');
}

// Check that bedrooms and living room were generated
const livingSpace = brief.spaces.find((s) => s.category === 'living');
const bedSpaces = brief.spaces.filter((s) => s.category === 'sleeping');

if (!livingSpace || livingSpace.priority !== 'mandatory') {
  throw new Error('Test 1 Failed: Living room must be generated with mandatory priority');
}
if (bedSpaces.length === 0) {
  throw new Error('Test 1 Failed: Bedrooms were not synthesized');
}

console.log(`✓ Test 1 Passed: Initialized ${brief.spaces.length} spaces, objectives, and occupancy profile cleanly.`);

// -------------------------------------------------------------------------
// TEST 2: Deterministic Space Program Totals & Circulation Allowance
// -------------------------------------------------------------------------
console.log('\nTest 2: Space Program Calculations & Circulation Allowances...');
const summary = calculateSpaceProgramSummary(testProject, brief);

if (summary.totalTargetNetArea <= 0) {
  throw new Error('Test 2 Failed: Target net area must be positive');
}
if (summary.mandatoryTargetArea <= 0 || summary.mandatoryTargetArea > summary.totalTargetNetArea) {
  throw new Error('Test 2 Failed: Mandatory target area out of bounds');
}
const expectedGIA = Math.round(
  summary.totalTargetNetArea * (1 + summary.circulationWallAllowancePercent / 100)
);
if (Math.abs(summary.estimatedGrossInternalArea - expectedGIA) > 2) {
  throw new Error(
    `Test 2 Failed: GIA formula mismatch. Expected ${expectedGIA}, got ${summary.estimatedGrossInternalArea}`
  );
}

console.log(
  `✓ Test 2 Passed: Net Target: ${summary.totalTargetNetArea} sq ft, GIA: ${summary.estimatedGrossInternalArea} sq ft (+${summary.circulationWallAllowancePercent}% circulation).`
);

// -------------------------------------------------------------------------
// TEST 3: Plot Fit Feasibility Evaluation
// -------------------------------------------------------------------------
console.log('\nTest 3: Site Capacity & Footprint Feasibility...');
// Plot: 50 * 80 = 4000 sq ft. 60% coverage = 2400 sq ft. 2 floors = 4800 sq ft allowable gross area.
if (summary.availablePlotArea !== 4000) {
  throw new Error(`Test 3 Failed: Expected plot area 4000, got ${summary.availablePlotArea}`);
}
if (summary.maxAllowableGrossArea !== 4800) {
  throw new Error(
    `Test 3 Failed: Expected max allowable gross area 4800 sq ft, got ${summary.maxAllowableGrossArea}`
  );
}
if (summary.footprintFitStatus !== 'fits') {
  throw new Error(
    `Test 3 Failed: Program should fit easily within 4800 sq ft capacity, got ${summary.footprintFitStatus}`
  );
}

// Test intentional capacity exceedance
const oversizedProject: Project = {
  ...testProject,
  plotWidth: 15,
  plotLength: 15, // 225 sq ft plot!
  floors: 1,
};
const oversizedSummary = calculateSpaceProgramSummary(oversizedProject, brief);
if (oversizedSummary.footprintFitStatus !== 'exceeds') {
  throw new Error(
    `Test 3 Failed: Oversized program should flag 'exceeds' on tiny plot, got ${oversizedSummary.footprintFitStatus}`
  );
}

console.log('✓ Test 3 Passed: Site footprint capacity and over-allocation evaluated accurately.');

// -------------------------------------------------------------------------
// TEST 4: 2D Floor Plan Reconciliation & Area Variances
// -------------------------------------------------------------------------
console.log('\nTest 4: 2D Floor Plan Reconciliation...');
const comparisons = compareBriefWithFloorPlan(testProject, brief);

const livingComp = comparisons.find((c) => c.category === 'living');
if (!livingComp || livingComp.placedQuantity !== 1) {
  throw new Error('Test 4 Failed: Placed living room should be matched on 2D floor plan');
}
if (livingComp.actualPlacedTotalArea !== 360) {
  throw new Error(
    `Test 4 Failed: Expected placed living area 360 sq ft, got ${livingComp.actualPlacedTotalArea}`
  );
}

// Bathrooms: 2 required in brief, 0 placed on 2D plan
const bathComp = comparisons.find((c) => c.category === 'hygiene');
if (!bathComp || bathComp.placedQuantity !== 0 || bathComp.placementStatus !== 'unplaced') {
  throw new Error('Test 4 Failed: Bathrooms should be detected as unplaced');
}

// Validation notices should detect unplaced mandatory bathroom
const notices = validateBrief(testProject, brief);
const unplacedMandatoryNotice = notices.find(
  (n) => n.type === 'unplaced-mandatory' && n.title.includes('Bathroom')
);
if (!unplacedMandatoryNotice) {
  throw new Error('Test 4 Failed: Expected validation notice for unplaced mandatory bathroom');
}

console.log(
  `✓ Test 4 Passed: 2D plan reconciliation detected placed vs unplaced spaces and flagged unplaced mandatory bathrooms.`
);

// -------------------------------------------------------------------------
// TEST 5: Spatial Relationship Adjacency Checks
// -------------------------------------------------------------------------
console.log('\nTest 5: Spatial Relationship Adjacency Rules...');
const briefWithRules = {
  ...brief,
  relationships: [
    {
      id: 'rel-test-floor-mismatch',
      sourceSpaceId: brief.spaces.find((s) => s.category === 'living')?.id || '',
      targetSpaceId: brief.spaces.find((s) => s.category === 'sleeping')?.id || '',
      relationType: 'direct-access' as const,
      priority: 'mandatory' as const,
    },
  ],
};
const ruleNotices = validateBrief(testProject, briefWithRules);
const floorMismatchNotice = ruleNotices.find((n) => n.type === 'adjacency-conflict');
if (!floorMismatchNotice) {
  throw new Error('Test 5 Failed: Direct access across different floor levels should flag an adjacency conflict');
}
console.log('✓ Test 5 Passed: Multi-level spatial relationship conflict detected successfully.');

// -------------------------------------------------------------------------
// TEST 6: Proof-Carrying Evidence Ledger Integration (Section 9)
// -------------------------------------------------------------------------
console.log('\nTest 6: Proof-Carrying Evidence Ledger Integration (Section 9)...');
const evidenceSummary = generateProjectEvidenceRecords(testProject);

const programAreaEvidence = evidenceSummary.records.find((r) => r.id === 'ev-brief-program-area');
if (!programAreaEvidence || programAreaEvidence.module !== 'brief-programming') {
  throw new Error('Test 6 Failed: Missing ev-brief-program-area evidence record');
}

const mandatoryFulfillmentEvidence = evidenceSummary.records.find(
  (r) => r.id === 'ev-brief-mandatory-compliance'
);
if (!mandatoryFulfillmentEvidence || mandatoryFulfillmentEvidence.module !== 'brief-programming') {
  throw new Error('Test 6 Failed: Missing ev-brief-mandatory-compliance evidence record');
}
// Because bathrooms are unplaced, mandatory compliance should be conflict!
if (mandatoryFulfillmentEvidence.validationStatus !== 'conflict') {
  throw new Error(
    `Test 6 Failed: Mandatory compliance should be 'conflict' with unplaced bathrooms, got ${mandatoryFulfillmentEvidence.validationStatus}`
  );
}

const governanceEvidence = evidenceSummary.records.find((r) => r.id === 'ev-brief-governance-status');
if (!governanceEvidence) {
  throw new Error('Test 6 Failed: Missing ev-brief-governance-status record');
}

console.log('✓ Test 6 Passed: Section 9 Evidence records verified with exact status evaluation.');

// -------------------------------------------------------------------------
// TEST 7: Documentation & Export Engine Consistency
// -------------------------------------------------------------------------
console.log('\nTest 7: Documentation & Export Engine Output...');
const csv = generateBriefSpaceProgramCSV(testProject);
if (!csv.includes('Space ID,Space Name,Category,Priority')) {
  throw new Error('Test 7 Failed: CSV export header is missing');
}
if (!csv.includes('Living Lounge')) {
  throw new Error('Test 7 Failed: CSV export missing programmed living space');
}

const markdown = generateBriefDocumentMarkdown(testProject);
if (!markdown.includes('# PLOTIFY — ARCHITECTURAL BRIEF & SPACE PROGRAM SPECIFICATION')) {
  throw new Error('Test 7 Failed: Markdown report missing title banner');
}
if (!markdown.includes('## 4. Space Program Totals & Plot Capacity Analysis')) {
  throw new Error('Test 7 Failed: Markdown report missing capacity analysis section');
}

console.log('✓ Test 7 Passed: Space program CSV and Markdown specifications generated cleanly.');

// =========================================================================
// P30 — AI DESIGN BRIEF INTERPRETER ACCEPTANCE TESTS (TESTS 8–22)
// =========================================================================
console.log('\n================================================================');
console.log('PLOTIFY P30: AI DESIGN BRIEF INTERPRETER ACCEPTANCE TESTS');
console.log('================================================================\n');

// -------------------------------------------------------------------------
// TEST 8 (P30 #1): Complete Residential Brief (Spec Canonical Example)
// -------------------------------------------------------------------------
console.log('Test 8 (P30 #1): Complete Residential Brief Interpretation...');
const canonicalPrompt =
  'I want a two-storey family house for six people, with four bedrooms, a separate guest area, an open kitchen, good natural light, privacy from the street, parking for two cars, and a moderate construction budget.';

const p30Brief1 = interpretDesignBrief(canonicalPrompt, testProject);

if (p30Brief1.rawInputText !== canonicalPrompt) {
  throw new Error('Test 8 Failed: Source description (rawInputText) not preserved');
}
const hasHouseType = p30Brief1.requirements.some(
  (r) => r.category === 'project-identity' && r.normalizedValue === 'residential' && r.source === 'explicit'
);
const hasSixOccupants = p30Brief1.requirements.some(
  (r) => r.category === 'occupancy-household' && r.normalizedValue === 6 && r.source === 'explicit'
);
const hasTwoFloors = p30Brief1.requirements.some(
  (r) => r.category === 'floors-circulation' && r.normalizedValue === 2 && r.source === 'explicit'
);
const hasFourBedrooms = p30Brief1.requirements.some(
  (r) => r.category === 'spaces-program' && r.description.includes('4 Bedroom') && r.quantity === 4
);
const hasGuestArea = p30Brief1.requirements.some(
  (r) => r.category === 'spaces-program' && r.description.toLowerCase().includes('guest')
);
const hasOpenKitchen = p30Brief1.requirements.some(
  (r) => r.category === 'spaces-program' && r.description.toLowerCase().includes('kitchen')
);
const hasDaylight = p30Brief1.requirements.some((r) => r.category === 'daylight-ventilation');
const hasStreetPrivacy = p30Brief1.requirements.some((r) => r.category === 'privacy-circulation');
const hasTwoCarParking = p30Brief1.requirements.some(
  (r) => r.category === 'spaces-program' && r.description.toLowerCase().includes('parking') && r.description.includes('2')
);
const hasModerateBudget = p30Brief1.requirements.some((r) => r.category === 'budget-cost');

if (
  !hasHouseType ||
  !hasSixOccupants ||
  !hasTwoFloors ||
  !hasFourBedrooms ||
  !hasGuestArea ||
  !hasOpenKitchen ||
  !hasDaylight ||
  !hasStreetPrivacy ||
  !hasTwoCarParking ||
  !hasModerateBudget
) {
  throw new Error('Test 8 Failed: Missing expected requirements from canonical residential prompt');
}
if (!p30Brief1.validation.complianceDisclaimer.includes('does NOT certify')) {
  throw new Error('Test 8 Failed: Missing mandatory compliance disclaimer in validation result');
}
console.log(
  `✓ Test 8 Passed: Extracted ${p30Brief1.requirements.length} structured requirements, ${p30Brief1.assumptions.length} traceable assumptions, and ${p30Brief1.conflicts.length} findings.`
);

// -------------------------------------------------------------------------
// TEST 9 (P30 #2): Brief with Optional Fields Omitted
// -------------------------------------------------------------------------
console.log('\nTest 9 (P30 #2): Brief with Optional Fields Omitted...');
const minimalBrief = interpretDesignBrief('A simple 2 bedroom house with a kitchen and living room.');
if (minimalBrief.requirements.length < 3) {
  throw new Error('Test 9 Failed: Minimal brief should still extract explicit room and type requirements');
}
// Inferred bathroom should be marked as 'inferred' and 'needs-review', never 'explicit'/'confirmed'
const inferredBath = minimalBrief.requirements.find(
  (r) => r.category === 'spaces-program' && r.description.includes('Bathroom')
);
if (!inferredBath || inferredBath.source !== 'inferred' || inferredBath.reviewStatus !== 'needs-review') {
  throw new Error('Test 9 Failed: Omitted bathroom must be flagged as inferred and needs-review');
}
console.log('✓ Test 9 Passed: Optional fields omitted gracefully; inferred items explicitly separated from user facts.');

// -------------------------------------------------------------------------
// TEST 10 (P30 #3): Missing Plot Dimensions
// -------------------------------------------------------------------------
console.log('\nTest 10 (P30 #3): Missing Plot Dimensions Detection...');
const projectWithoutPlot: Project = {
  ...testProject,
  plotWidth: 0,
  plotLength: 0,
};
const missingPlotBrief = interpretDesignBrief(
  'Three bedroom family house with two bathrooms and a study.',
  projectWithoutPlot
);
const missingPlotConflict = missingPlotBrief.conflicts.find(
  (c) => c.disposition === 'missing-information' && c.title.toLowerCase().includes('plot')
);
const missingPlotQuestion = missingPlotBrief.clarificationQuestions.find((q) =>
  q.question.toLowerCase().includes('plot')
);
if (!missingPlotConflict || !missingPlotQuestion) {
  throw new Error('Test 10 Failed: Missing plot dimensions should produce a missing-information disposition and clarification question');
}
console.log('✓ Test 10 Passed: Missing plot dimensions flagged with missing-information disposition and clarification prompt.');

// -------------------------------------------------------------------------
// TEST 11 (P30 #4): Conflicting Room / Floor / Area Requirements
// -------------------------------------------------------------------------
console.log('\nTest 11 (P30 #4): Conflicting Requirements Detection...');
const conflictingBrief = interpretDesignBrief(
  'I want a one-storey house that is also a two-storey house, with 2 bedrooms and 5 bedrooms, and a 300 sq ft floor area.',
  testProject
);
const floorContradiction = conflictingBrief.conflicts.find(
  (c) => c.disposition === 'confirmed-contradiction' && c.title.toLowerCase().includes('floor')
);
const bedroomContradiction = conflictingBrief.conflicts.find(
  (c) => c.disposition === 'confirmed-contradiction' && c.title.toLowerCase().includes('bedroom')
);
const areaProgramConflict = conflictingBrief.conflicts.find(
  (c) =>
    c.disposition === 'confirmed-contradiction' &&
    c.title.toLowerCase().includes('target total area too small')
);
if (!floorContradiction || !bedroomContradiction || !areaProgramConflict) {
  throw new Error('Test 11 Failed: Expected confirmed-contradiction dispositions for floors, bedrooms, and area vs program');
}
if (conflictingBrief.validation.isStructurallyValid) {
  throw new Error('Test 11 Failed: Brief with unresolved confirmed contradictions must not be marked structurally valid');
}
console.log('✓ Test 11 Passed: Confirmed contradictions detected for conflicting floors, bedrooms, and area-to-program mismatch.');

// -------------------------------------------------------------------------
// TEST 12 (P30 #5): Ambiguous Units & Mixed Imperial/Metric Units
// -------------------------------------------------------------------------
console.log('\nTest 12 (P30 #5): Ambiguous Units & Mixed Measurement Systems...');
const ambiguousUnitBrief = interpretDesignBrief(
  'House on a 40 x 60 plot with 3 bedrooms and a total area of 2200.',
  projectWithoutPlot
);
const unitLessConflict = ambiguousUnitBrief.conflicts.find((c) =>
  c.title.toLowerCase().includes('unspecified measurement unit')
);
if (!unitLessConflict) {
  throw new Error('Test 12 Failed: Unit-less plot dimensions/area must trigger an unspecified measurement unit warning');
}

const mixedUnitsBrief = interpretDesignBrief(
  'A 250 m2 house on a 50 x 80 feet plot with 3 bedrooms.',
  testProject
);
const mixedUnitConflict = mixedUnitsBrief.conflicts.find(
  (c) =>
    c.disposition === 'confirmed-contradiction' &&
    c.title.toLowerCase().includes('mixed imperial and metric')
);
if (!mixedUnitConflict) {
  throw new Error('Test 12 Failed: Mixed metric (m²) and imperial (feet) units must be flagged as a conflict');
}
console.log('✓ Test 12 Passed: Unit-less dimensions and mixed metric/imperial systems accurately detected.');

// -------------------------------------------------------------------------
// TEST 13 (P30 #6): Unspecified Budget Currency & Qualitative Budget
// -------------------------------------------------------------------------
console.log('\nTest 13 (P30 #6): Unspecified Budget Currency...');
const currencyLessBudgetBrief = interpretDesignBrief(
  'A 3 bedroom house with a budget of 350,000 on a 50 x 80 feet plot.'
);
const currencyMissingConflict = currencyLessBudgetBrief.conflicts.find(
  (c) => c.disposition === 'missing-information' && c.title.toLowerCase().includes('unspecified budget currency')
);
if (!currencyMissingConflict) {
  throw new Error('Test 13 Failed: Numeric budget without currency must flag missing currency');
}
console.log('✓ Test 13 Passed: Unspecified budget currency flagged as missing-information without silent fabrication.');

// -------------------------------------------------------------------------
// TEST 14 (P30 #7 & #8): Malformed AI Output & Unknown Requirement Categories
// -------------------------------------------------------------------------
console.log('\nTest 14 (P30 #7 & #8): Malformed AI Output & Unknown Category Normalization...');
const mappedCategory = normalizeRequirementCategory('spaceship-landing-pad-category');
if (mappedCategory !== 'other-unclassified') {
  throw new Error(`Test 14 Failed: Unknown category should map to 'other-unclassified', got ${mappedCategory}`);
}

const malformedValidation = validateExternalBriefOutput('not-an-object', canonicalPrompt, testProject);
if (malformedValidation.isValid) {
  throw new Error('Test 14 Failed: Non-object AI payload must be rejected');
}

const sanitizedPayload = validateExternalBriefOutput(
  {
    projectSummary: 'Valid summary',
    requirements: [
      {
        category: 'unknown-quantum-category',
        description: 'Solar Roof Array',
        normalizedValue: '5kW',
        priority: 'invalid-priority',
        source: 'explicit',
        reviewStatus: 'confirmed',
      },
      null,
      { description: '' }, // invalid item without description should be filtered out
    ],
    assumptions: [
      {
        description: 'Standard Ceiling Height',
        assumedValue: '2.7m',
        category: 'invalid-cat',
        rationale: 'Standard residential ceiling height',
      },
    ],
  },
  canonicalPrompt,
  testProject
);

if (!sanitizedPayload.isValid || sanitizedPayload.requirements.length !== 1) {
  throw new Error('Test 14 Failed: Validated payload should sanitize valid items and drop malformed items');
}
if (sanitizedPayload.requirements[0].category !== 'other-unclassified') {
  throw new Error('Test 14 Failed: Unknown category in AI output was not mapped to other-unclassified');
}
if (sanitizedPayload.requirements[0].priority !== 'must-have') {
  throw new Error('Test 14 Failed: Invalid priority should default safely to must-have');
}
console.log('✓ Test 14 Passed: Malformed AI payloads rejected or safely sanitized; unknown categories mapped to other-unclassified.');

// -------------------------------------------------------------------------
// TEST 15 (P30 #9): Editing and Confirming an Assumption & Requirement
// -------------------------------------------------------------------------
console.log('\nTest 15 (P30 #9): Editing Requirements & Confirming Assumptions...');
let editableBrief = interpretDesignBrief(canonicalPrompt, testProject);
const firstAssumption = editableBrief.assumptions[0];
if (!firstAssumption) {
  throw new Error('Test 15 Failed: Expected at least one assumption to confirm');
}
editableBrief = reviewBriefAssumption(editableBrief, firstAssumption.id, 'confirmed', 3, 'spaces', testProject);
const confirmedAssumption = editableBrief.assumptions.find((a) => a.id === firstAssumption.id);
if (!confirmedAssumption || confirmedAssumption.status !== 'confirmed') {
  throw new Error('Test 15 Failed: Assumption status was not updated to confirmed');
}

const firstReq = editableBrief.requirements[0];
editableBrief = updateInterpretedRequirement(
  editableBrief,
  firstReq.id,
  {
    reviewStatus: 'confirmed',
    notes: 'Verified by lead architect',
  },
  testProject
);
if (editableBrief.requirements[0].source !== 'user-edited' || editableBrief.requirements[0].notes !== 'Verified by lead architect') {
  throw new Error('Test 15 Failed: Requirement edit did not persist');
}

editableBrief = addManualInterpretedRequirement(
  editableBrief,
  {
    category: 'accessibility',
    description: 'Ground Floor Step-Free Entry',
    normalizedValue: true,
    priority: 'must-have',
  },
  testProject
);
const addedManual = editableBrief.requirements.find((r) => r.description === 'Ground Floor Step-Free Entry');
if (!addedManual || addedManual.source !== 'user-edited') {
  throw new Error('Test 15 Failed: Manual requirement addition failed');
}
editableBrief = removeInterpretedRequirement(editableBrief, addedManual.id, testProject);
if (editableBrief.requirements.some((r) => r.id === addedManual.id)) {
  throw new Error('Test 15 Failed: Requirement removal failed');
}
console.log('✓ Test 15 Passed: Confirming assumptions, editing requirements, adding manual requirements, and removing requirements verified.');

// -------------------------------------------------------------------------
// TEST 16 (P30 #10 & #11): Saving/Reloading Brief & Preserving Unrelated Project Data
// -------------------------------------------------------------------------
console.log('\nTest 16 (P30 #10 & #11): Saving/Reloading & Preserving Unrelated Project Data...');
const projectWithBrief: Project = {
  ...testProject,
  brief: {
    ...brief,
    interpretedBrief: editableBrief,
  },
};
// Simulate reload & re-initialization
const reloadedBriefData = initializeProjectBrief(projectWithBrief);
if (!reloadedBriefData.interpretedBrief || reloadedBriefData.interpretedBrief.id !== editableBrief.id) {
  throw new Error('Test 16 Failed: Reloaded project brief lost interpretedBrief state');
}

// Integrate into project and ensure unrelated fields (id, floorPlan, status, notes) are preserved
const integrationResult = integrateInterpretedBriefIntoProject(
  projectWithBrief,
  reloadedBriefData,
  editableBrief
);
const updatedProject = integrationResult.updatedProject;
if (updatedProject.id !== testProject.id) {
  throw new Error('Test 16 Failed: Project ID mutated during brief integration');
}
if (updatedProject.floorPlan?.rooms.length !== testProject.floorPlan?.rooms.length) {
  throw new Error('Test 16 Failed: Existing 2D floorPlan rooms were overwritten or lost');
}
if (integrationResult.syncedSpacesCount < 3) {
  throw new Error(`Test 16 Failed: Expected at least 3 programmed space groups synced, got ${integrationResult.syncedSpacesCount}`);
}
console.log('✓ Test 16 Passed: Brief saved/reloaded cleanly and integrated into project without losing unrelated project data.');

// -------------------------------------------------------------------------
// TEST 17 (P30 #12): Preventing Stale Responses from Overwriting Newer Edits
// -------------------------------------------------------------------------
console.log('\nTest 17 (P30 #12): Stale Response Protection...');
const newerBriefState = {
  ...editableBrief,
  requestSequenceId: 5,
  lastUserEditAt: new Date(Date.now() + 5000).toISOString(),
};
const staleIncomingBrief = {
  ...editableBrief,
  requestSequenceId: 3,
};
if (shouldApplyInterpretationResponse(newerBriefState, staleIncomingBrief)) {
  throw new Error('Test 17 Failed: Lower sequence ID must not overwrite newer brief state');
}

const editedDuringFlightIncoming = {
  ...editableBrief,
  requestSequenceId: 5,
};
if (
  shouldApplyInterpretationResponse(
    newerBriefState,
    editedDuringFlightIncoming,
    new Date(Date.now() - 5000).toISOString()
  )
) {
  throw new Error('Test 17 Failed: Response started before user edit must not overwrite newer user edit');
}

const validIncomingBrief = {
  ...editableBrief,
  requestSequenceId: 6,
};
if (!shouldApplyInterpretationResponse(editableBrief, validIncomingBrief)) {
  throw new Error('Test 17 Failed: Newer sequence ID without intervening user edits should be allowed');
}
console.log('✓ Test 17 Passed: Stale and out-of-order asynchronous responses are blocked from overwriting newer edits.');

// -------------------------------------------------------------------------
// TEST 18 (P30 #13): Integration with Space-Program & Floor Plan Services
// -------------------------------------------------------------------------
console.log('\nTest 18 (P30 #13): Integration with Space Program & Floor Plan Reconciliation...');
const integratedSpaceSummary = calculateSpaceProgramSummary(
  updatedProject,
  integrationResult.updatedBriefData
);
if (integratedSpaceSummary.totalSpaceCount < 4) {
  throw new Error('Test 18 Failed: Integrated brief did not populate space program units');
}
const integratedComparisons = compareBriefWithFloorPlan(
  updatedProject,
  integrationResult.updatedBriefData
);
if (integratedComparisons.length === 0) {
  throw new Error('Test 18 Failed: Integrated brief failed floor plan comparison');
}
console.log(
  `✓ Test 18 Passed: Integrated P30 brief flows seamlessly into Prompt 12 space programming (${integratedSpaceSummary.totalTargetNetArea} sq ft net target).`
);

// -------------------------------------------------------------------------
// TEST 19 (P30 #14 & #15): Empty Input, Cancellation, Fallback & Clarification Resolution
// -------------------------------------------------------------------------
console.log('\nTest 19 (P30 #14 & #15): Empty Input, Cancellation & Clarification Question Resolution...');
let emptyErrorThrown = false;
try {
  interpretDesignBrief('   ', testProject);
} catch (err: any) {
  if (err?.message?.includes('Cannot interpret an empty brief description')) {
    emptyErrorThrown = true;
  }
}
if (!emptyErrorThrown) {
  throw new Error('Test 19 Failed: Empty input must throw a clear validation error');
}

// Test answering a clarification question
const questionToAnswer = missingPlotBrief.clarificationQuestions[0];
const answeredBrief = answerClarificationQuestion(
  missingPlotBrief,
  questionToAnswer.id,
  '60 x 90 feet',
  'answered',
  projectWithoutPlot
);
const updatedQuestion = answeredBrief.clarificationQuestions.find(
  (q) => q.id === questionToAnswer.id
);
if (!updatedQuestion || updatedQuestion.status !== 'answered' || updatedQuestion.userAnswer !== '60 x 90 feet') {
  throw new Error('Test 19 Failed: Answering clarification question did not resolve it and record userAnswer');
}

// Test AbortController cancellation on async interpreter
const abortController = new AbortController();
abortController.abort();
let abortCaught = false;
try {
  await interpretDesignBriefAsync(canonicalPrompt, testProject, {
    signal: abortController.signal,
  });
} catch (err: any) {
  if (err?.message?.includes('cancelled') || err?.name === 'AbortError') {
    abortCaught = true;
  }
}
if (!abortCaught) {
  throw new Error('Test 19 Failed: Aborted signal must throw cancellation error cleanly');
}

console.log('✓ Test 19 Passed: Empty input validation, clarification resolution, and request cancellation verified.');

console.log('\n================================================================');
console.log('ALL 19 ACCEPTANCE TESTS (PROMPT 12 + P30 INTERPRETER) PASSED (100%)');
console.log('================================================================\n');

