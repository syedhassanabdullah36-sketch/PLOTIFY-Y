# P39 — Biophilic & Indoor Plantscape Planner
**Engine Version:** `p39-biophilic-plantscape-v1.0.0`  
**Schema Version:** `1.0.0`  
**Target:** Plotify Account A (Phase 2 Feature Completion)

---

## 1. Architecture & Data Model
P39 is implemented through three cohesive modules integrated into Plotify's existing React + TypeScript architecture:
- **Type Contracts (`/src/types/biophilicPlanner.ts`)**: Defines `BiophilicCatalogItem`, `BiophilicPlacementRecord`, `PlacementSuitabilityEvaluation`, `BiophilicPlacementConflict`, `BiophilicMaintenanceTask`, `BiophilicScenario`, `BiophilicScenarioComparisonResult`, `BiophilicRecommendation`, `BiophilicProposalPreviewDiff`, `P39OptionBiophilicComparisonSummary`, `ProjectBiophilicPlannerData`, and `BiophilicPlannerProjectReport`.
- **Project State (`/src/types/project.ts`)**: Extends `Project` with `biophilicPlanner?: ProjectBiophilicPlannerData`.
- **Analytical Service (`/src/services/biophilicPlannerService.ts`)**: Pure, deterministic evaluation, spatial coordination, maintenance planning, scenario comparison, non-destructive preview, atomic apply, and snapshot rollback.
- **Workspace UI (`/src/components/biophilic/BiophilicPlannerWorkspace.tsx`)**: Interactive room plantscape planner, 2D SVG floor-plan & daylight overlay, catalog browser, placement editor, care planner, scenario comparator, and preview modal.

---

## 2. Suitability Logic, Catalog & Provenance Rules
### Epistemic Provenance Categories (`P39Provenance`)
Every catalog item, placement, and evaluation carries an explicit provenance tag:
- `authoritative_geometry`
- `user_entered_project_data`
- `derived_deterministic`
- `reference_assumption`
- `scenario_assumption`
- `measured_imported`
- `unsupported`

### Completeness States (`P39Completeness`)
- `complete`, `partial`, `incomplete`, `not_applicable`

### Suitability Outcomes (`BiophilicSuitabilityStatus`)
1. `suitable-based-on-available-evidence`: Plant or element fits room boundaries, clears P33/P34/P37 obstacles, matches P38 screened daylight regime, and satisfies pet-safety settings.
2. `potentially-suitable-additional-info-needed`: Marginal daylight, advisory density/moisture warning, or conceptual vertical living-wall requiring engineering sign-off.
3. `unsuitable-under-current-assumptions`: Blocking spatial collision, insufficient P38 daylight, direct solar beam on shade-sensitive species, or toxic species in a pet/child household.
4. `not-assessable-with-current-data`: Missing P38 Mode C daylight calculation for a living plant or unverified botanical light/size requirements.

---

## 3. Cross-Feature Integration (P30–P38)
- **P30 (Validation & Brief)**: Keeps plant suitability strictly separate from statutory building-code or brief compliance.
- **P31 (Multi-Option Comparison)**: `exportP39SummaryForP31(project)` exports normalized plantscape metrics (`P39OptionBiophilicComparisonSummary`).
- **P32 (Personalization)**: Reads interior design priorities (`biophilic-light`) read-only without mutating P32.
- **P33 (Furniture & Circulation)**: Checks container and mature footprints against room bounds, placed furniture AABBs, doorway swing arcs, and secondary passage widths.
- **P34 (Universal Accessibility)**: Flags placements that narrow accessible routes below `0.90 m` (`3.0 ft`) without claiming statutory ADA/ISO certification.
- **P35 (Climate Materials)**: Flags moisture-sensitive floor/wall installations requiring waterproof liners or membranes.
- **P36 (Acoustic Comfort)**: Tracks preserved moss and vegetated wall panels while disclaiming unverified acoustic absorption ($\alpha_w/\text{NRC}$) claims.
- **P37 (Natural Ventilation)**: Flags tall or wall-mounted placements that obstruct operable windows or hardware access without altering P37 geometry.
- **P38 (Daylight & Visual Comfort)**: Consumes room-level Mean Daylight Factor and work-plane point Daylight Factor / direct-sun flags read-only. Tracks `lastP38SourceFingerprint` to detect when P38 changes make P39 assessments stale.

---

## 4. Non-Destructive Preview, Atomic Apply, Rollback & Staleness
- **Preview (`previewBiophilicRecommendations`)**: Deep-clones the project, applies selected recommendations in memory, and returns `BiophilicProposalPreviewDiff` without mutating live project state.
- **Atomic Apply (`applyBiophilicProposalAtomically`)**: Validates the entire proposed state (rejecting stale previews or invalid dimensions without partial mutation), records a pre-apply snapshot via `createProjectSnapshot` + in-memory checkpoint, and commits P39 state while preserving all unrelated project fields.
- **Rollback (`rollbackLastBiophilicApply`)**: Restores P39 state from the pre-apply snapshot while preserving unrelated project changes made after the apply.

---

## 5. Known Limitations & Explicit Non-Claims
- **Daylight Non-Guarantee**: P38 analytical Daylight Factor estimates do not guarantee biological plant survival or growth.
- **No Unverified Structural or Waterproofing Certification**: Vertical living walls are labeled as conceptual proposals requiring structural load (`35–65 kg/m²` saturated), waterproof membrane, and plumbing verification by qualified engineers.
- **Unquantified Wellbeing / Air-Purification / Energy Outcomes**: Occupant wellbeing, workplace productivity, VOC/CO2 air purification, and HVAC energy savings are explicitly reported as `null` (`unquantified_unsupported_without_clinical_or_chamber_evidence`).
