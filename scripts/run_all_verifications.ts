/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'child_process';
import { runSystemVerification, computeGeometryFingerprint } from '../src/services/systemVerificationService';
import { INITIAL_SAMPLE_PROJECTS } from '../src/services/storage';

interface TestSuiteResult {
  name: string;
  command: string;
  status: 'passed' | 'failed';
  durationMs: number;
  outputSummary: string;
}

console.log('================================================================');
console.log('PLOTIFY — SYSTEM-WIDE VERIFICATION & RELEASE CONTROLS RUNNER');
console.log('================================================================\n');

const testSuites = [
  { name: '1. Security & Storage Persistence', script: 'test_security_persistence.ts' },
  { name: '2. Project Versions & Safe Rollback', script: 'test_versioning_engine.ts' },
  { name: '3. MEP Coordination & Clash Detection', script: 'test_mep_engine.ts' },
  { name: '4. Structural Framing & Column Grid', script: 'test_structural_engine.ts' },
  { name: '5. Building Regulations & Zoning Engine', script: 'test_regulatory_engine.ts' },
  { name: '6. Site Context & Solar Microclimate', script: 'test_site_engine.ts' },
  { name: '7. Architectural Brief & Space Program', script: 'test_brief_engine.ts' },
  { name: '8. Proof-Carrying Evidence Ledger', script: 'test_evidence_engine.ts' },
  { name: '9. Executive Documentation & Handoff', script: 'test_documentation_engine.ts' },
  { name: '10. Professional Review & Expert Validation', script: 'test_expert_review_engine.ts' },
  { name: '11. Controlled Pilot & Feedback System', script: 'test_pilot_system.ts' },
  { name: '12. Release Preparation & Operational Readiness', script: 'test_release_readiness.ts' },
  { name: '13. Multi-Option Design Comparison (P31)', script: 'test_p31_design_comparison.ts' },
  { name: '14. Adaptive Design Personalization (P32)', script: 'test_p32_adaptive_personalization.ts' },
  { name: '15. Furniture & Circulation Intelligence (P33)', script: 'test_p33_furniture_circulation.ts' },
  { name: '16. Universal Accessibility Review (P34)', script: 'test_p34_universal_accessibility.ts' },
  { name: '17. Climate-Responsive Material Advisor (P35)', script: 'test_p35_climate_material_advisor.ts' },
  { name: '18. Acoustic Comfort Planner (P36)', script: 'test_p36_acoustic_comfort_planner.ts' },
  { name: '19. Natural Ventilation Scenario Analyzer (P37)', script: 'test_p37_natural_ventilation_analyzer.ts' },
  { name: '20. Daylight & Visual Comfort Analyzer (P38)', script: 'test_p38_daylight_visual_comfort.ts' },
  { name: '21. Biophilic & Indoor Plantscape Planner (P39)', script: 'test_p39_biophilic_plantscape_planner.ts' },
];

const results: TestSuiteResult[] = [];
let allPassed = true;

for (const suite of testSuites) {
  process.stdout.write(`• Running ${suite.name}... `);
  const start = Date.now();
  try {
    const stdout = execSync(`npx tsx ${suite.script}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    const durationMs = Date.now() - start;
    results.push({
      name: suite.name,
      command: `npx tsx ${suite.script}`,
      status: 'passed',
      durationMs,
      outputSummary: 'All assertions verified successfully.',
    });
    console.log(`✓ PASSED (${durationMs} ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    allPassed = false;
    results.push({
      name: suite.name,
      command: `npx tsx ${suite.script}`,
      status: 'failed',
      durationMs,
      outputSummary: err.stderr || err.stdout || err.message,
    });
    console.log(`✗ FAILED (${durationMs} ms)`);
  }
}

// 13. Direct System Verification Evaluation on Sample Projects
console.log('\n• Running 13. Multi-Project System Verification & Release Gate Audit...');
const auditStart = Date.now();
let sampleAuditPassed = true;

for (const project of INITIAL_SAMPLE_PROJECTS) {
  const report = runSystemVerification(project);
  if (!report.overallPassed) {
    sampleAuditPassed = false;
    console.log(`  ✗ Project "${project.name}" blocked with ${report.summary.blockingDefects} defects.`);
  } else {
    console.log(`  ✓ Project "${project.name}": Health ${report.healthScore}%, Schematic Gate: ${report.releaseGates.concept_schematic.eligible ? 'CLEAR' : 'BLOCKED'}, DD Gate: ${report.releaseGates.design_development.eligible ? 'CLEAR' : 'BLOCKED'}`);
  }
}

const auditDuration = Date.now() - auditStart;
results.push({
  name: '13. System Verification & Release Gates',
  command: 'runSystemVerification(INITIAL_SAMPLE_PROJECTS)',
  status: sampleAuditPassed ? 'passed' : 'failed',
  durationMs: auditDuration,
  outputSummary: `Audited ${INITIAL_SAMPLE_PROJECTS.length} sample projects.`,
});

if (!sampleAuditPassed) allPassed = false;

// Summary Table
console.log('\n================================================================');
console.log('VERIFICATION MATRIX & RELEASE READINESS SUMMARY');
console.log('================================================================');

console.table(
  results.map((r) => ({
    'Test Discipline': r.name,
    Status: r.status.toUpperCase(),
    'Duration (ms)': r.durationMs,
  }))
);

const totalTime = results.reduce((acc, r) => acc + r.durationMs, 0);
console.log(`Total Verification Execution Time: ${(totalTime / 1000).toFixed(2)}s`);
console.log(`Overall System Health: ${allPassed ? 'ALL DISCIPLINE CHECKS PASSED' : 'DEFECTS DETECTED'}`);
console.log('================================================================\n');

if (!allPassed) {
  process.exit(1);
} else {
  console.log('✓ System-wide verification and release controls verified successfully!\n');
  process.exit(0);
}
