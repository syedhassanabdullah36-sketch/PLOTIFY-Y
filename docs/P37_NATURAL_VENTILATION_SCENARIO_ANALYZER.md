# P37 — Natural Ventilation Scenario Analyzer

**Account A | Locked Roadmap Item: P37 of P30–P40**  
**Engine Version:** `p37-natural-ventilation-analyzer-v1.0.0`  
**Schema Version:** `1.0.0`

---

## 1. Purpose & Engineering Scope

The **Natural Ventilation Scenario Analyzer (P37)** enables architects and homeowners to examine natural ventilation opportunities, evaluate room-level and multi-room airflow paths (single-sided, cross-ventilation, stack buoyancy, combined wind+stack, and internal-transfer-assisted paths), compare operating scenarios side-by-side, and identify multidisciplinary constraints (outdoor noise, speech privacy, moisture-sensitive finishes, rain ingress, accessibility reach, and furniture obstructions).

### Explicit Non-Claims & Honesty Boundaries
- **Not a CFD or Wind-Tunnel Solver**: P37 uses macroscopic steady-state orifice equations and geometric depth-to-height heuristics. Visual diagrams are explicitly labeled *"Conceptual Schematic — Not CFD"*.
- **No Fabricated Weather or Location Inference**: P37 never infers site wind speed, wind direction, outdoor temperature, humidity, or air quality from a city name or P35 climate profile.
- **No Assumed Operability**: P37 never assumes windows or doors are operable from generic labels or 2D widths alone; operability status (`operable` | `fixed` | `unknown`), height, and openable fraction carry explicit provenance.
- **Not a Statutory Compliance Certification Engine**: Preliminary Air Changes Per Hour (ACH) or openable-to-floor-area ratios do not constitute automatic compliance with ANSI/ASHRAE Standard 62.1, ANSI/ASHRAE Standard 62.2, or local building codes.

---

## 2. Quantitative Equations & Series Orifice Formulations

All internal calculations are performed in SI units ($\text{m}, \text{m}^2, \text{m}^3, \text{m}^3/\text{s}, \text{L/s}, \text{Pa}, \text{kg/m}^3$), with exact conversion from `feet` ($1\text{ ft} = 0.3048\text{ m}$).

1. **Effective Scenario Free Area ($A_{\text{eff}}$)**:
   $$A_{\text{openable,max}} = A_{\text{gross}} \times f_{\text{maxOpenable}}$$
   $$A_{\text{eff}} = A_{\text{openable,max}} \times f_{\text{scenarioOpen}} \times f_{\text{screen}} \times f_{\text{obstruction}}$$

2. **Series Orifice Conductance for Multi-Opening Paths**:
   For $k$ opening groups in series along a single flow path (each with conductance $G_k = \sum C_{d,i} A_{\text{eff},i}$):
   $$(C_d A_{\text{eff}})_{\text{series}} = \frac{1}{\sqrt{\sum_k \frac{1}{G_k^2}}}$$

3. **Wind-Induced Pressure & Orifice Flow**:
   $$\Delta P_{\text{wind}} = 0.5 \cdot \rho \cdot v^2 \cdot \Delta C_{p,\text{eff}} \quad (\text{Pa})$$
   $$Q_{\text{wind}} = (C_d A_{\text{eff}})_{\text{series}} \cdot \sqrt{\frac{2 \cdot |\Delta P_{\text{wind}}|}{\rho}} \quad (\text{m}^3/\text{s})$$

4. **Hydrostatic Buoyancy / Stack Pressure & Orifice Flow**:
   $$\Delta P_{\text{stack}} = \rho \cdot g \cdot \Delta h \cdot \frac{|T_{\text{in}} - T_{\text{out}}|}{T_{\text{ref,K}}} \quad (\text{Pa})$$
   $$Q_{\text{stack}} = (C_d A_{\text{eff}})_{\text{series}} \cdot \sqrt{\frac{2 \cdot |\Delta P_{\text{stack}}|}{\rho}} \quad (\text{m}^3/\text{s})$$

5. **Combined Wind & Stack Superposition**:
   Uses ASHRAE Fundamentals Ch. 16 quadrature superposition:
   $$Q_{\text{combined}} = \sqrt{Q_{\text{wind}}^2 + Q_{\text{stack}}^2}$$
   (or conservative dominant mechanism $\max(Q_{\text{wind}}, Q_{\text{stack}})$) — **never** blind linear addition $Q_{\text{wind}} + Q_{\text{stack}}$.

6. **Air Changes Per Hour (ACH)**:
   $$\text{ACH} = \frac{Q_{\text{combined}} \times 3600}{V} \quad (\text{h}^{-1}), \quad V = A_{\text{floor}} \times H_{\text{room}}$$
   Withheld whenever room ceiling height $H_{\text{room}}$ is unspecified.
