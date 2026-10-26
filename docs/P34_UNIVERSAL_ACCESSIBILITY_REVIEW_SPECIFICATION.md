# PLOTIFY — PROMPT 34 (P34)
## UNIVERSAL ACCESSIBILITY REVIEW SPECIFICATION
**Account A | Locked Roadmap: P34 of P30–P40**  
**Engine Version:** `p34-universal-accessibility-v1.0.0`

---

### 1. Mission & Architectural Scope

P34 implements **Universal Accessibility Review** in the Plotify Account A codebase. Its objective is to help architects, designers, and project owners evaluate architectural layouts against transparent, jurisdiction-aware accessibility criteria while maintaining strict separation between:
1. **Verified geometric and element checks** (`meets-configured-criterion`, `does-not-meet-configured-criterion`, `warning`),
2. **Missing inputs and unmodeled accessibility dimensions** (`insufficient-data`, `unassessed`), and
3. **Areas requiring licensed accessibility specialist or Authority Having Jurisdiction (AHJ) review** (`requires-human-review`).

P34 never labels a building or room as legally "ADA Compliant" or "Code Certified" from incomplete 2D schematic geometry, and never collapses unassessed criteria into passing counts.

---

### 2. Jurisdiction & Accessibility Rule Profile Governance

Rather than applying one country's numeric rules universally without context, P34 requires an explicit **Accessibility Rule Profile** (`AccessibilityRuleProfile`):

| Profile ID | Standard & Authority Citation | Classification | Canonical Thresholds |
| :--- | :--- | :--- | :--- |
| `general-screening-configurable` | Plotify Configurable Accessibility Screening Thresholds (Non-Statutory) | `general-screening-only` | `5.0 ft` (`1.50 m`) turning circle, `2.5 × 4.0 ft` (`0.80 × 1.30 m`) clear floor space, `2.67 ft` (`0.85 m`) door clear width, `3.0 ft` (`0.90 m`) route width, `1:12` max ramp slope |
| `us-ada-2010-standards` | U.S. DOJ 2010 ADA Standards for Accessible Design (36 CFR Part 1191, Chapters 3–6) | `statutory-standard` | `60 in` (`5.0 ft`) turning circle (§304.3.1), `30 × 48 in` (`2.5 × 4.0 ft`) clear floor space (§305.3), `32 in` (`2.67 ft`) min door clear width (§404.2.3), `36 in` (`3.0 ft`) route width (§403.5.1), `1/2 in` threshold (§404.2.5), `1:12` ramp slope (§405.2), `15–48 in` reach range (§308) |
| `iso-21542-2021-reference` | ISO 21542:2021 Building construction — Accessibility and usability of the built environment | `international-reference` | `1500 mm` (`1.50 m`) turning circle, `800 × 1300 mm` (`0.80 × 1.30 m`) clear floor space, `850 mm` (`0.85 m`) door clear width, `900 mm` (`0.90 m`) route width, `13 mm` max threshold, `1:12` ramp slope, `400–1200 mm` reach range |
| `custom-project-profile` | User-Configured Project Accessibility Thresholds | `user-configured` | User-overridden thresholds converted cleanly to `project.unit` (`feet` or `metres`) |

Each profile records `buildingOccupancyType` (`residential-private`, `multi-family-common`, `public-accommodation`, `commercial-workplace`, `mixed-use`, `unknown`) and `constructionScope` (`new-construction`, `alteration`, `existing-facility`, `unknown`).

---

### 3. Exact Continuous 2D Geometric Algorithms vs. P33 Discretized Grid

- **Continuous Wheelchair Turning Space (`findMaxInscribedTurningCircle`)**:
  - Uses exact critical obstacle boundary coordinates (`X` and `Y` tangency anchors from room walls, placed furniture footprints, structural columns, MEP risers, and inward door-swing arcs) combined with continuous circle-to-rectangle Euclidean distance verification and binary search (`18` iterations, `< 0.01` unit precision).
  - Does **not** rely on P33's `0.5 ft` (`6 in`) / `0.15 m` (`150 mm`) discretized pathfinding grid for turning circles or fixture clear floor spaces.
- **T-Shaped Turning Space (`checkTTurnSpaceInRoom`)**:
  - Evaluates all 4 cardinal orientations of a T-shaped turning space (`tTurnTotalSpan × tTurnTotalSpan` bounding box with orthogonal arms of width `tTurnArmWidth`) against room boundaries and solid obstacles.
- **Stationary Clear Floor Space (`checkClearFloorSpaceForRect`)**:
  - Evaluates `30 in × 48 in` (`2.5 ft × 4.0 ft`) or `800 mm × 1300 mm` (`0.80 m × 1.30 m`) approach boxes at placed furniture and fixtures.
- **Doorway Clear Width, Swing Encroachment & Maneuvering Clearance**:
  - Distinguishes `clearOpeningWidth` (actual 90°-open clear width) from nominal rough opening `width`.
  - Evaluates inward door swing arc interference with room turning circles, pull-side latch clearance (`>= 18 in` / `1.5 ft` or `500 mm`), and threshold height (`<= 0.5 in` or `13 mm`).
  - When a room has zero recorded openings, reports `insufficient-data` rather than assuming doorways pass.
- **Multi-Storey Vertical Circulation**:
  - Strictly distinguishes ambulatory `stairs` from wheelchair-accessible `verticalLifts` (passenger elevators / platform lifts) and floor-to-floor `ramps`.
  - Stairs **never** satisfy floor-to-floor wheelchair accessibility.

---

### 4. Multi-Dimensional Accessibility Topic Inventory

P34 tracks 9 distinct accessibility domains and explicitly lists what is evaluated and what remains unassessed:
1. `mobility-turning-and-clear-floor`
2. `accessible-routes-and-corridors`
3. `doors-and-thresholds`
4. `vertical-circulation-ramps-lifts-stairs`
5. `sanitary-and-kitchen-fixtures`
6. `reach-ranges-and-operable-parts`
7. `wayfinding-tactile-and-signage`
8. `visual-audible-alarms-and-communication`
9. `site-approach-and-parking`

---

### 5. Non-Destructive Preview, Safe Apply & Snapshot Rollback

- `previewAccessibilitySuggestion(project, suggestionId)` clones the project in memory, applies the candidate furniture reposition, furniture removal, door widening, or door swing reversal, runs `evaluateUniversalAccessibility` on the proposed state, and reports resolved criteria and any newly introduced failures without mutating the saved project.
- `applyAccessibilitySuggestionSafely(project, suggestionId)` creates an automatic pre-apply checkpoint via `createProjectSnapshot` before applying the verified change and increments `requestSequenceId`.
- `rollbackAccessibilityChanges(project, snapshotId?)` restores the project state to the pre-apply snapshot.
