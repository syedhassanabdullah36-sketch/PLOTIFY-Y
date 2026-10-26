# P32 — ADAPTIVE DESIGN PERSONALIZATION SPECIFICATION

**Account A | Locked Roadmap: P32 of P30–P40**  
**Engine Version:** `p32-personalization-v1.0.0`

---

## 1. Purpose & Architectural Scope

**P32 — Adaptive Design Personalization** helps users discover, evaluate, preview, and safely apply architectural design options that align with their explicitly stated project requirements, aesthetic and material preferences, spatial priorities, and budget constraints.

Core principle:
> **Personalize the design decision process without silently changing the user's saved design or treating uncertain assumptions as facts.**

---

## 2. Preference Categories & Epistemic Provenance Model

All personalization data is strictly **project-scoped** (`project.designPersonalization?: ProjectPersonalizationProfile`) and can be inspected, edited, reset, or removed at any time. No cross-project hidden user profiling or sensitive personal attribute inference is performed.

### 2.1 Supported Preference Categories

| Category | Profile Field / Source | Supported Values / Units |
| :--- | :--- | :--- |
| **Architectural Facade Style** | `preferredFacadeStyles` | `Modern`, `Contemporary`, `Minimalist`, `Traditional`, `Industrial`, `Mediterranean` |
| **Primary Envelope Material** | `preferredPrimaryMaterials` | `timber`, `brick`, `stone`, `plaster`, `concrete`, `glass` |
| **Material Cost & Specification Tier** | `preferredCostTiers` | `Economic`, `Balanced Mid-Range`, `High-End Architectural`, `Ultra Luxury` |
| **Interior Style Preset** | `preferredInteriorStyles` | `Scandinavian`, `Minimalist`, `Modern Luxury`, `Japandi`, `Industrial Chic`, `Warm Contemporary` |
| **Solar Shading Strategy** | `preferredShadingStyles` | `deep-overhangs`, `motorized-louvers`, `timber-pergola`, `brise-soleil`, `none` |
| **Storey Count Preference** | `preferredFloors` | `number \| null` (e.g., `1`, `2`, `3` storeys) |
| **Spatial & Decision Priority Weights** | `spatialPriorityWeights` | `0–100` user-controlled weights for `opennessAndLivingArea`, `privacyAndZoneSeparation`, `storageAndUtilityCapacity`, `budgetPredictability`, `lowCarbonMaterials`, `compactPlotFootprint`, `naturalLightAndShading` |
| **Room Category Priorities** | `roomCategoryPriorities` | `living`, `sleeping`, `hygiene`, `service`, `work`, `outdoor` (`importanceWeight`, `minRequiredCount`) |
| **Budget Comfort & Ceiling** | `budgetRange` | `minBudget`, `targetBudget`, `maxBudget`, `isHardCap` in `project.currency` |
| **P30 Brief Requirements & Assumptions** | `items` | Synchronized from `project.brief.interpretedBrief` and project specification facts |

### 2.2 Epistemic Origin & Confirmation Status

Every item in `profile.items` carries explicit provenance and confirmation state:

| `origin` (`PreferenceOrigin`) | `confirmationStatus` | Meaning & Scoring Rule |
| :--- | :--- | :--- |
| `'explicit-user'` | `'confirmed'` | Directly entered or confirmed by the user in P32 or P30 (`reviewStatus: 'confirmed'`). Active in personalization scoring. |
| `'imported-project-fact'` | `'confirmed'` | Derived from saved project facts (e.g., `project.budget`, `project.floors`, confirmed P30 requirements). Active in personalization scoring. |
| `'inferred-suggestion'` | `'unconfirmed-suggestion'` | Unconfirmed P30 inference (`reviewStatus: 'needs-review'`), P30 assumption, or site-orientation shading suggestion. **Never** treated as an active confirmed preference until the user explicitly clicks **Confirm**. |
| `'unknown'` | `'unknown'` | Missing or unspecified project input (e.g., no target budget entered). Contributes `0` points while retaining its full weight in the denominator so unknown data never inflates an option's score. |

---

## 3. Reuse of P30 Brief Interpreter & P31 Multi-Option Comparison

P32 builds directly on existing Account A modules without duplicating calculation logic:

1. **P30 AI Design Brief Interpreter (`/src/services/briefService.ts` & `/src/types/brief.ts`)**:
   - Reads `project.brief.interpretedBrief` (`requirements`, `assumptions`, `conflicts`).
   - Confirmed P30 requirements (`reviewStatus === 'confirmed'`) become confirmed preference/constraint items (`isHardConstraint: true` when `priority === 'must-have'`); unconfirmed P30 items (`reviewStatus === 'needs-review'`) and assumptions are imported strictly as `'inferred-suggestion'` (`'unconfirmed-suggestion'`) until explicitly confirmed or rejected by the user.
2. **P31 Multi-Option Design Comparison (`/src/services/designComparisonService.ts`)**:
   - Reuses `extractComparableOptions(project)` and `compareDesignOptions(project, config)` to evaluate all selected options (`baseline:${id}`, `scenario:${id}`, `alternative:${id}`) across consistent spatial, brief, site, carbon, and cost criteria.

---

## 4. Separation of Hard Constraints vs. Soft Preference Fit

1. **Hard Constraints Never Overridden by Soft Scores**:
   - Every `PersonalizedOptionRecommendation` tracks `hardConstraintsAllMet`, `hardConstraintsMetCount`, `hardConstraintsViolatedCount`, and `hardConstraintsUnassessedCount` strictly separately from `preferenceMatchScore` (`0–100`).
   - Options that violate hard constraints are explicitly flagged and sorted **below** options that satisfy all hard constraints (`a.hardConstraintsAllMet !== b.hardConstraintsAllMet`), regardless of how high their soft preference score is.
2. **Missing Data Never Inflates Scores**:
   - Let $W_{\text{total}} = \sum_{m} w_m$ be the sum of weights for all active confirmed soft preference items.
   - For any criterion where data is `'unknown-data'` (`rawMatchScore === null`), its `weightedContribution` is $0$, while $w_m$ remains in $W_{\text{total}}$:
     $$\text{preferenceMatchScore} = \text{round}\left(\sum_{m \in \text{available}} \frac{w_m \cdot s_m}{W_{\text{total}}}\right)$$
   - `missingDataPenaltyApplied` is set to `true` and `dataCoveragePercent` reports the percentage of active soft criteria with verified data.
3. **Preference Conflict Detection (`detectPersonalizationConflicts`)**:
   - Detects and explains conflicts between competing user preferences or between preferences and project constraints:
     - `p32-conflict-openness-vs-compact-single-storey`: High priority on both generous living area and compact ground footprint while restricting building height to 1 storey.
     - `p32-conflict-luxury-tier-vs-budget-priority`: Selecting `'High-End Architectural'` or `'Ultra Luxury'` cost tier while weighting budget predictability/cap highly.
     - `p32-conflict-material-vs-low-carbon`: Restricting primary materials to `'concrete'` or `'glass'` while weighting `'lowCarbonMaterials'` highly.
     - `p32-conflict-floors-vs-p30-*`: Storey preference contradicting a confirmed P30 brief requirement.
     - `p32-p30-contradiction-*`: Propagating unresolved P30 brief contradictions.

---

## 5. Non-Destructive Preview, Safety Checkpoint Apply & One-Click Rollback

1. **Read-Only Evaluation & Preview (`evaluateDesignPersonalization` & `buildPersonalizationPreview`)**:
   - Evaluating preferences or inspecting a recommendation never mutates `project.floorPlan.rooms`, `project.floors`, `project.budget`, or `project.designAlternatives`.
   - `buildPersonalizationPreview(project, optionId)` computes a complete diff (`PersonalizationPreviewDiff`) showing before/after parameter changes and running `validateFloorPlan` + `evaluateConstraintGraph` on the hypothetical state before any mutation.
2. **Atomic Application with Safety Checkpoint (`applyPersonalizedOptionSafely`)**:
   - Requires explicit user confirmation (`Apply Option with Safety Checkpoint`).
   - Automatically creates a version snapshot via `createProjectSnapshot(project, { trigger: 'auto-checkpoint', ... })` before applying changes.
3. **One-Click Rollback (`rollbackPersonalizationToSnapshot`)**:
   - Uses `executeSafeRestore(currentProject, safetySnapshot)` from `/src/services/versioningService.ts` to restore exact pre-application geometry, storey count, budget, and studio finishes while preserving the revision audit trail.

---

## 6. Deferred Roadmap Boundaries (P33–P40)

P32 explicitly documents and enforces boundaries for unimplemented downstream roadmap modules:
- **P33 — Furniture & Circulation Intelligence**: Detailed furniture placement and doorway swing paths are reserved for P33.
- **P34 — Universal Accessibility Review**: Step-free routing and wheelchair turning circle verification belong to P34.
- **P35–P38 — Climate, Acoustic, Ventilation & Daylight Analyzers**: Specialized environmental simulation engines belong to P35–P38.
- **P39–P40 — Design Rationale & Quality Benchmark Loop**: Reserved for P39–P40.
