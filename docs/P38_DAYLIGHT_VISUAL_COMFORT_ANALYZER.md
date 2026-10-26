# P38 — Daylight & Visual Comfort Analyzer

## 1. Purpose & Scope
The **P38 Daylight & Visual Comfort Analyzer** provides a deterministic, multi-mode architectural daylighting, solar geometry, overhang shadow projection, simplified CIE Overcast Sky Daylight Factor, and visual comfort (glare & view-out) screening engine inside **Plotify (Account A)**.

It bridges 2D floor-plan room geometry, site orientation, P30 brief targets, P31 option comparison, P32 personalization preferences, P33 window/furniture coordinates, P34 accessibility clearances, P35 solar/envelope properties, P36 acoustic facade constraints, and P37 operable ventilation openings without fabricating missing physical dimensions or unverified climate-based raytracing metrics.

---

## 2. Supported Assessment Modes (Modes A–F)

| Mode | Identifier | Description | Governing Equations / Method |
| :--- | :--- | :--- | :--- |
| **Mode A** | `mode-a-geometric-potential` | Geometric Daylight Potential & Room Depth Screening | Gross window area $A_{w,\text{gross}} = w \cdot h$, net glazed area $A_g = A_{w,\text{gross}}(1 - f_{\text{frame}})$, Glazed-to-Floor Ratio $\text{GFR} = 100 \cdot \sum A_g / A_{\text{floor}}$, and single-sided room depth ratio $L_{\text{depth}} / H_{\text{head}}$ (compared against advisory $2.5 H_{\text{head}}$). |
| **Mode B** | `mode-b-solar-and-shading` | Analytical Solar Position & Direct-Sun / Overhang Shadow Screening | Solar declination $\delta$, equation of time, hour angle $\omega$, solar altitude $\alpha_s$, solar azimuth $\gamma_s$, facade incidence angle $\theta_{\text{inc}}$, vertical profile angle $\Omega_v = \arctan(\tan \alpha_s / \cos \Delta\gamma)$, overhang shadow drop $\Delta z_{\text{shadow}} = P_{\text{ovh}} \tan \Omega_v - g_{\text{ovh}}$, and direct-sun work-plane penetration depth $d_{\text{sun}} = (z_{\text{sun,top}} - z_{\text{wp}}) / \tan \Omega_v$. |
| **Mode C** | `mode-c-simplified-daylight` | Simplified BRE / CIBSE Split-Flux Daylight Factor & Illuminance | Mean Daylight Factor under CIE Standard Overcast Sky: $$\overline{DF}\;(\%) = \frac{\sum_{i=1}^{N} (T_{i,\text{eff}} \cdot A_{g,i} \cdot \theta_i \cdot M_i)}{A_{\text{total}} \cdot (1 - R^2)}$$ plus work-plane grid point Daylight Factor proxies, uniformity ratio proxy $U_0 = DF_{\min} / \overline{DF}$, and reference interior illuminance $E_{\text{int}} = E_{\text{ext,ref}} \cdot (\overline{DF}/100)$. |
| **Mode D** | `mode-d-annual-simulation-status` | Climate-Based Annual Daylight Simulation Status (Scope Gate) | Explicitly reports `sDA_300_50_Percent: null`, `ASE_1000_250_Percent: null`, `daylightAutonomyPercent: null`, and `usefulDaylightIlluminancePercent: null` with `isSupportedInCurrentEngine: false` because hourly TMY/EPW radiative transfer simulation is not embedded. |
| **Mode E** | `mode-e-visual-comfort-glare-view` | Visual Comfort, Glare Risk & View-Out Screening | Screens qualitative direct-sun and contrast glare risk (`low`, `moderate`, `high`, `insufficient-evidence`), reports luminance-based `daylightGlareProbabilityDGP: null` (requires HDR eye-level luminance field), and computes exact 2D horizontal view-out sight angle $\theta_{\text{view,h}}$ subtended by exterior windows from the room centre. |
| **Mode F** | `mode-f-scenario-comparison` | Side-by-Side Scenario Comparison | Compares any two `DaylightScenario` configurations (e.g., Baseline vs. Solar Control Overhang + Shade, or Vernal Equinox vs. Summer/Winter Solstice) across $\Delta A_g$, $\Delta \text{GFR}$, $\Delta \overline{DF}$, $\Delta$ direct-sun work-plane coverage %, glare transition, and view-out transition. |

---

## 3. Provenance & Completeness Taxonomy

### Provenance States (`DaylightProvenanceState`)
- `project-derived-geometry`: Derived directly from 2D floor-plan room dimensions, site north orientation, or P33/P36/P37 room geometry.
- `user-entered`: Explicitly entered or edited by the user in the P38 workspace.
- `measured-input`: Field-measured interior/exterior illuminance sensor records entered by the user.
- `traceable-generic-reference`: Documented engineering screening constants (e.g., BRE Split-Flux reflectance/maintenance defaults) with full bibliographic source metadata.
- `illustrative-scenario-assumption`: Exploratory scenario parameters (e.g., default 40°N reference latitude when `project.siteContext` has no coordinates).
- `calculated-analytical`: Deterministically computed outputs from Modes A, B, C, E, and F.
- `missing-unverified`: Required physical or optical input is missing; blocks downstream calculation rather than fabricating values.

### Completeness States (`DaylightCompletenessState`)
- `complete-screening-ready`
- `partial-geometric-only`
- `incomplete-window-geometry`
- `incomplete-optical-properties`
- `incomplete-solar-context`
- `insufficient-evidence`

---

## 4. Non-Fabrication & Anti-Overclaim Guarantees
1. **No Fabricated Window Height**: P33 `KnownRoomOpening` stores opening width and wall offset, not window height. When imported from P33 without a P37 height, P38 sets `grossHeight: null` (`missing-unverified`) and reports `incomplete-window-geometry`.
2. **No Inferred Visible Transmittance (VT)**: P38 never guesses $T_{\text{vis}}$ from thermal U-factor, SHGC, or generic material strings. If VT is cleared or missing, Mode C blocks Mean Daylight Factor calculation (`meanDaylightFactorPercent: null`) and transitions to `incomplete-optical-properties`.
3. **No Guessed Geographic Coordinates**: P38 never infers latitude or longitude from project name or city string. If `project.siteContext` lacks valid numeric coordinates, solar scenarios explicitly label location provenance as `illustrative-scenario-assumption`.
4. **No Fake Annual or Luminance Glare Metrics**: `sDA`, `ASE`, `DA`, `UDI`, and `DGP` are always `null` with explicit explanations of the required external simulation/HDR inputs.
5. **No Statutory Compliance Overclaims**: All criteria carry `authorityStatus: 'advisory-reference'` and `verificationStatus: 'unverified-screening-benchmark'`.

---

## 5. Cross-Feature Integration (P30–P37) & Safe Apply / Rollback
- **P30 & P32**: Reads programmed space types and daylight/glare preferences read-only.
- **P31**: Exports `getP38DaylightSummaryForComparison(project)` for side-by-side option comparison without collapsing into an unweighted composite score.
- **P33 & P34**: Checks furniture obstructions near windows and wheelchair sill reach / maneuvering clearances.
- **P35, P36 & P37**: Evaluates solar heat gain vs. high-VT glazing, acoustic facade insulation vs. glazing area, and operable ventilation openings. When a P38 proposal modifies physical window dimensions, `naturalVentilation.lastSourceFingerprint` is invalidated so P37 detects staleness.
- **Atomic Apply & Rollback**: `previewDaylightRecommendation` clones the project without mutating live state; `applyDaylightProposalAtomically` validates the source fingerprint, creates a pre-apply snapshot checkpoint (`lastPreApplySnapshotId`), and applies changes atomically; `rollbackLastDaylightApply` restores the exact pre-apply state.

---

## 6. Out-of-Scope Boundaries
- **P39 (Design Rationale & Decision History)** and **P40 (Design Quality Benchmark & Improvement Loop)** are intentionally out of scope and unimplemented.
- **Account B** remains untouched.
