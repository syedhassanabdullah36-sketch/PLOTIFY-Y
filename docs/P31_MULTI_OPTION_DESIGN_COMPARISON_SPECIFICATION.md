# P31 — MULTI-OPTION DESIGN COMPARISON SPECIFICATION

**Account A | Locked Roadmap: P31 of P30–P40**  
**Calculation Engine Version:** `p31-comparison-engine-v1.0.0`

---

## 1. Purpose and Scope

**P31 — Multi-Option Design Comparison** provides an evidence-bounded, deterministic comparison engine and workspace within Plotify. It enables architects and project stakeholders to evaluate two or more real architectural design options side-by-side across consistent geometric measurements, P30 brief requirements, cost and carbon estimates, and validation diagnostics.

### Scope Boundaries
- **In Scope (P31):**
  - Extraction of real comparable options from a `Project` (`baseline-project`, `design-scenario` options in `project.scenarios`, and `design-alternative` options in `project.designAlternatives`).
  - Stable option-ID selection and validation (minimum 2 valid options required).
  - Unit and currency normalization across options.
  - Explicit provenance classification (`measured`, `derived`, `estimated`, `user-declared`, `inferred`, `unavailable`) and evaluation status (`evaluated`, `partial`, `conflict`, `assumed`, `unavailable`) for every metric cell.
  - Full integration with P30 (`project.brief.interpretedBrief`): confirmed requirements (`reviewStatus: 'confirmed'`) are evaluated as binding constraints, while unconfirmed AI inferences (`reviewStatus: 'needs-review'`) are surfaced as assumptions and never silently treated as hard facts.
  - Optional, user-controlled preference weighting where missing data contributes `0` points while retaining its full weight in the denominator so missing data never inflates an option's score.
  - Non-destructive persistence of comparison configurations (`project.designComparison`).
- **Out of Scope (Reserved for P32–P40):**
  - P32 Adaptive Design Personalization
  - P33 Furniture & Circulation Clearance Intelligence (`furniture_circulation_clearance` is explicitly marked `unavailable`)
  - P34 Universal Accessibility Review (`accessibility_compliance_review` is explicitly marked `unavailable`)
  - P35–P38 Climate, Acoustic, Ventilation, and Daylight Comfort (`environmental_comfort_index` is explicitly marked `unavailable`)
  - P39–P40 Design Rationale History & Quality Benchmark Loop

---

## 2. Option Representation in the Codebase

Each comparable option is normalized into a `ComparableDesignOption` (`/src/types/designComparison.ts`) via `extractComparableOptions(project)`:

| Option Kind | Stable ID Format | Source in `Project` | 2D Room Geometry Source |
|---|---|---|---|
| `baseline-project` | `baseline:${project.id}` | Root `project` | `project.floorPlan.rooms` |
| `design-scenario` | `scenario:${scenario.id}` | `project.scenarios[]` | `scenario.rooms` (independent 2D layout & storeys) |
| `design-alternative` | `alternative:${alt.id}` | `project.designAlternatives[]` | `project.floorPlan.rooms` (`sharesBaselineGeometry: true`, varies facade/interior specifications) |

When two or more selected options share baseline 2D geometry (`sharesBaselineGeometry === true`), the comparison engine emits an explicit global warning so users understand why geometric metrics match while specification/cost/carbon metrics differ.

---

## 3. Supported Comparison Criteria, Units, Formulas, and Provenance

| Criterion ID | Category | Unit | Direction | Formula / Derivation | Default Provenance |
|---|---|---|---|---|---|
| `net_habitable_area` | `spatial` | `m²` / `sq ft` | `higher-is-better` | $\sum (\text{width} \times \text{length})$ for non-circulation rooms | `measured` |
| `gross_floor_area` | `spatial` | `m²` / `sq ft` | `target-match` | $\sum_{i=1}^{N} (\text{width}_i \times \text{length}_i)$ across all modeled rooms | `measured` |
| `space_efficiency_ratio` | `efficiency` | `%` | `higher-is-better` | $(\text{Net Habitable Area} / \text{Total Modeled Area}) \times 100$ | `derived` |
| `circulation_ratio` | `efficiency` | `%` | `lower-is-better` | $(\text{Circulation Area} / \text{Total Modeled Area}) \times 100$ | `derived` |
| `storeys_count` | `spatial` | `storeys` | `target-match` | $\max(\text{declared stories}, \max(\text{room.floor}))$ | `measured` / `user-declared` |
| `room_count` | `program` | `rooms` | `target-match` | Count of modeled `FloorPlanRoom` entities | `measured` |
| `brief_space_fit` | `program` | `%` | `higher-is-better` | $(\text{Matched Brief Spaces} / \text{Total Brief Spaces}) \times 100$ | `derived` |
| `brief_area_delta` | `program` | `%` | `target-match` | $((\text{Modeled Net} - \text{Brief Target Net}) / \text{Brief Target Net}) \times 100$ | `derived` |
| `estimated_construction_cost` | `cost` | `Project Currency` | `lower-is-better` | Parametric floor-area + room complexity + facade/glazing multiplier (`calculateEstimatedCost`) | `estimated` |
| `budget_Delta_or_fit` | `cost` | `%` | `lower-is-better` | $((\text{Estimated Cost} - \text{Declared Budget}) / \text{Declared Budget}) \times 100$ (`unavailable` if budget $\le 0$) | `estimated` / `unavailable` |
| `validation_conflicts` | `validation` | `conflicts` | `lower-is-better` | Geometry overlaps + out-of-bounds + site conflicts + missing mandatory brief spaces | `derived` |
| `site_coverage_pct` | `spatial` | `%` | `lower-is-better` | $(\text{Ground Floor Area} / (\text{plotWidth} \times \text{plotLength})) \times 100$ | `derived` |
| `structural_feasibility_score` | `structural` | `score / 100` | `higher-is-better` | Preliminary 2D span & aspect-ratio heuristic (non-certified) | `estimated` |
| `embodied_carbon_total` | `environmental` | `kgCO₂e` | `lower-is-better` | Preliminary material + envelope embodied carbon (`calculateEmbodiedCarbon`) | `estimated` |

---

## 4. P30 Brief Integration Behavior

1. **Confirmed Requirements (`reviewStatus === 'confirmed'`):**
   - Treated as binding constraints in `evaluateBriefConstraintsAcrossOptions`.
   - Violations increment `hardConstraintsViolated` in the option summary.
2. **Unconfirmed AI Inferences (`reviewStatus === 'needs-review'` or `source === 'inferred'`):**
   - Explicitly labeled as `Unconfirmed Assumption` (`status: 'assumed-unconfirmed'` when not matched).
   - Never counted as hard constraint violations until confirmed by the user in the P30 Brief Workspace.
3. **Unresolved P30 Brief Conflicts:**
   - Surfaced in `briefSummary.unresolvedBriefConflictsCount` and in `globalNotices`.

---

## 5. Missing Data and Optional Preference Scoring Rules

- **Missing Data Rule:** Unavailable metrics return `rawValue: null`, `status: 'unavailable'`, and `provenance: 'unavailable'`. Missing values are never replaced with `0`.
- **Optional Weighted Preference Formula:**
  - When enabled by the user, each selected criterion $c$ with user weight $w_c \in [0, 5]$ is normalized across evaluated options to $s_{o,c} \in [0, 100]$.
  - If an option is missing data for criterion $c$, its contribution is $0$ points while $w_c$ remains in the denominator $\sum w_c$, setting `missingDataPenaltyApplied = true`.
  - Options within $1.5$ points of each other are reported as a tie (`tieGroupWithOptionIds`).
  - Hard constraints (`hardConstraintsSatisfied`, `hardConstraintsViolated`, `hardConstraintsUnevaluable`) are always reported separately and are never masked by soft preference scores.

---

## 6. Known Limitations and Future Roadmap Integration Points

- P31 evaluates 2D room bounding boxes, declared storey counts, P30 brief space programs, and parametric cost/carbon models.
- Detailed furniture clearance paths (P33), wheelchair turning circles and accessible route continuity (P34), and climate/acoustic/ventilation/daylight simulations (P35–P38) are registered in the catalog with `isSupportedInCurrentEngine: false` so future roadmap prompts can activate them without breaking the P31 contract.
