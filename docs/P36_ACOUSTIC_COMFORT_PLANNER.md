# P36 — Acoustic Comfort Planner (`P30–P40` Roadmap)

## 1. Purpose & Architectural Scope
**P36 — Acoustic Comfort Planner** provides deterministic, room-by-room and boundary-by-boundary architectural acoustic comfort planning, octave-band Sabine reverberation estimation (`125, 250, 500, 1000, 2000, 4000 Hz`), functional speech/privacy target screening, background noise logarithmic combination, airborne/impact assembly tracking, mechanical services proximity screening, spatial acoustic zoning, and non-destructive treatment previews with atomic apply and rollback.

## 2. Authoritative Standards & Scientific Basis
- **ISO 3382-1:2009 & ISO 3382-2:2008**: Room acoustic parameters and reverberation time ($RT_{60}$) in ordinary rooms:
  $$RT_{60}(f) = \frac{0.161 \cdot V}{A(f)} \quad (\text{SI: } V \text{ in m}^3, A \text{ in metric sabins m}^2)$$
  $$RT_{60}(f) = \frac{0.049 \cdot V_{\text{ft}^3}}{A_{\text{ft}^2}(f)} \quad (\text{IP: } V \text{ in ft}^3, A \text{ in imperial sabins ft}^2)$$
  $$A(f) = \sum_i S_i \cdot \alpha_i(f)$$
- **ISO 11654:1997 & ASTM C423**: Sound absorbers for use in buildings ($\alpha_w$, NRC, SAA).
- **ISO 717-1:2020 & ASTM E90 / ASTM E413**: Airborne sound insulation ($R_w$, STC) and field vs. laboratory rating distinction.
- **ISO 717-2:2020 & ASTM E492 / ASTM E989**: Impact sound insulation ($L'_{n,w}$, $L'_{nT,w}$, IIC).
- **ISO 12354-1:2017 & ISO 12354-2:2017**: Estimation of field acoustic performance ($D_{nT,w}$) from element performance and flanking transmission paths.
- **ANSI/ASA S12.60**: Classroom and learning space acoustics ($RT_{60} \le 0.60\text{ s}$, background noise $\le 35\text{ dBA}$).
- **WHO Environmental Noise Guidelines (2018) & BS 8233:2014**: Indoor residential ambient targets ($30\text{ dBA}$ sleeping, $35\text{ dBA}$ living/resting) separated from outdoor facade exposure limits.
- **ASHRAE Handbook — HVAC Applications, Chapter 49**: Mechanical noise and vibration control (NC/RC/dBA targets).

## 3. Eight Assessment Domains (Domains A–H)
1. **Domain A — Room Reverberation & Sound Absorption**:
   - Computes octave-band absorption $A(f)$ and $RT_{60}(f)$ across `125–4000 Hz`.
   - Subtracts door and window areas from gross perimeter wall area before multiplying by opaque wall $\alpha(f)$ to prevent double-counting.
   - Requires verified 3D ceiling height ($H > 0$). When 2D floor plan rooms have no confirmed ceiling height, returns `insufficient-evidence` and provides a clearly labelled illustrative scenario preview at `2.70 m`.
   - Flags Sabine diffuse-field assumption limitations when mean absorption coefficient $\bar{\alpha}(f) > 0.30$.
2. **Domain B — Speech, Communication & Functional Use**:
   - Evaluates 10 functional room profiles (`sleep-resting`, `living-conversational`, `home-office-focus`, `meeting-conference`, `classroom-learning`, `healthcare-patient-consult`, `open-plan-collaborative`, `corridor-circulation`, `music-media-rehearsal`, `service-utility-wet`).
   - Detects competing priority trade-offs (e.g., `musical-warmth-liveness` vs. `speech-clarity-intelligibility`).
   - Never fabricates STI, C50, D50, or %ALcons without impulse-response and SNR inputs.
3. **Domain C — Background & Environmental Noise**:
   - Combines multiple user-measured decibel sources energetically:
     $$L_{\text{total}} = 10 \log_{10}\left(\sum_{i=1}^n 10^{L_i / 10}\right)$$
   - Never computes arithmetic averages of decibels and never infers outdoor noise from city names or coordinates.
4. **Domain D — Airborne Sound Insulation & Privacy Screening**:
   - Discovers 2D shared wall segments and connecting doors on the same floor level.
   - Refuses to assign STC or $R_w$ numbers to generic unverified labels (`"brick wall"`, `"double glazing"`).
   - Discloses laboratory component ratings vs. field $D_{nT,w}$ performance and flanking transmission (ISO 12354-1).
5. **Domain E — Impact, Structure-Borne Sound & Vibration**:
   - Detects multi-storey floor-to-ceiling vertical overlaps across floor levels (`floorLevel` stacking) and evaluates structural framing context without fabricating IIC or $L'_{n,w}$ numbers.
6. **Domain F — Mechanical Services Noise & Vibration**:
   - Reads `project.mepCoordination.components` to flag HVAC, plumbing, and electrical equipment inside or within `3.0 m` of sensitive rooms.
7. **Domain G — Acoustic Zoning & Spatial Coordination**:
   - Evaluates project-wide noisy-to-quiet adjacencies, P30 `'acoustic-isolated'` brief rules, P33 furniture placement observations (without claiming verified dB transmission loss from furniture), and P34 accessible route clearances.
8. **Domain H — Actionable Acoustic Improvements**:
   - Generates structured recommendations with all 9 required attributes, cross-checked against P35 wet-room moisture durability (blocking moisture-sensitive porous felt in wet rooms in favor of moisture-resistant perforated gypsum) and P34 accessible clear widths.
   - Supports non-destructive preview, atomic apply with pre-apply snapshot checkpoint, stale fingerprint detection, and one-click rollback.
