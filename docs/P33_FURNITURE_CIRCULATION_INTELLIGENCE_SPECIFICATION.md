# P33 — Furniture & Circulation Intelligence Specification
**Account A | Locked Roadmap: P33 of P30–P40**

## 1. Purpose & Scope
P33 — Furniture & Circulation Intelligence enables users to place, move, rotate, resize, duplicate, and validate furniture templates and instances inside Plotify's 2D room layouts, evaluate functional clearance envelopes, check known doorway and door-swing zones, compute grid-based circulation routes, and preview/apply explainable layout improvements without silently altering room walls or floors.

### Roadmap & Boundary Lock
- **Implemented Scope**: P33 Furniture & Circulation Intelligence only.
- **Preserved Features**: P30 AI Design Brief Interpreter, P31 Multi-Option Design Comparison, and P32 Adaptive Design Personalization remain intact.
- **P34 Boundary**: P33 evaluates general furniture fit, user-configurable planning clearances, and circulation route passability. It explicitly does **not** perform Universal Accessibility Review (wheelchair turning radii, accessible fixture transfer spaces, or statutory accessibility code compliance), which belongs to **P34 — Universal Accessibility Review**.

---

## 2. Coordinate System, Units & Footprint Representation
- **Coordinate System**: Plotify's 2D floor plan uses top-left origin `(0, 0)` with `+X` (East) and `+Y` (South) in the project's active `MeasurementUnit` (`'feet' | 'metres'`).
- **Unit Conversion**: `convertMeasurement(value, fromUnit, toUnit)` converts deterministically using `1 m = 3.28084 ft` (`1 ft = 0.3048 m`).
- **Footprint Shapes**: Rectangles (`'rectangle'`) at `0°`, `90°`, `180°`, `270°` (or finite rotation angles) with exact axis-aligned bounding boxes (`getInstanceFootprintRect`) and oriented front functional clearance envelopes (`getInstanceFrontClearanceRect`).
- **Dimension Provenance**:
  - `'illustrative-template-default'`: Generic starter planning dimensions across 8 categories (`sleeping`, `seating-living`, `dining`, `work-office`, `storage-cabinetry`, `kitchen-casework`, `bathroom-fixtures`, `utility-laundry`). Explicitly disclosed as non-manufacturer-verified defaults.
  - `'user-edited-custom'`: User-resized or custom furniture dimensions.
  - `'user-verified-spec'`: User-verified specification dimensions.

---

## 3. Geometric Validation & Epistemic Honesty
`validateFurnitureLayout` evaluates:
1. **Invalid Dimensions or Coordinates (`invalid-dimensions-or-coords`)**: Rejects zero, negative, `NaN`, or `Infinity` widths, depths, coordinates, or rotation angles.
2. **Invalid Room or Floor Assignment (`invalid-room-or-floor`)**: Flags instances assigned to a non-existent `roomId` or mismatched `floorLevel`.
3. **Room Boundary Containment (`room-boundary-overflow`)**: Exact 2D AABB containment check against room interior bounds `[room.x, room.x + room.width] × [room.y, room.y + room.length]`.
4. **Furniture-to-Furniture Collision (`furniture-collision`)**: Pairwise 2D AABB intersection isolated per `floorLevel`.
5. **Fixed Building Obstacle Collision (`fixed-object-collision`)**: Checks against structural columns (`project.structuralCoordination.columns` centered at `(x, y)` with `[x - width/2, x + width/2] × [y - depth/2, y + depth/2]`) and floor-mounted MEP equipment (`project.mepCoordination.components`).
6. **Known Door Opening & Swing Zone Checks (`door-opening-obstruction`, `door-swing-obstruction`, `missing-opening-or-route-data`)**:
   - **Never Fabricated**: Because standard `FloorPlanRoom` records do not include door coordinates by default, P33 **never** guesses or fabricates door positions or swing directions. When `knownOpenings` is empty for a furnished room, P33 emits `category: 'missing-opening-or-route-data'` (`severity: 'unavailable'`, `isCompleteData: false`, `missingInputs: ['room.knownOpenings']`).
   - When `KnownRoomOpening` records are defined, P33 checks both doorway approach depth and inward door-swing envelopes.

---

## 4. Circulation & Route Analysis Method
`evaluateSingleCirculationRoute` and `evaluateRoomCirculationAndRoutes` discretize each room into an 8-connected occupancy grid (`0.5 ft` or `0.15 m` cell resolution):
- Marks cells occupied by furniture footprints or fixed structural/MEP obstacles as blocked.
- Measures local horizontal and vertical passage spans at every free cell to compute effective corridor width.
- Runs clearance-aware Dijkstra/A* pathfinding between verified access points (known doorways, furniture fronts, or user-selected route points).
- Identifies the minimum measured clearance along the path, the bottleneck coordinates, and the specific blocking furniture instance(s).
- Does **not** use straight-line distance as route passability.

---

## 5. Non-Destructive Suggestions, Persistence & Rollback
- Suggestions (`generateFurnitureLayoutSuggestions`) are computed from geometric diagnostics plus confirmed P30 requirements and confirmed P32 preferences (unconfirmed P30/P32 inferences are ignored and never promoted to hard facts).
- `previewFurnitureSuggestion` computes a non-destructive before/after diff (`conflicts`, `warnings`, `freeFloorRatioPercent`) without mutating saved state.
- `saveProjectFurnitureLayoutSafely` and `applyFurnitureSuggestionWithConfirmation` create an automatic pre-save project snapshot via `createProjectSnapshot` and store furniture data in `project.furnitureLayout` without modifying `project.floorPlan.rooms`.
- `rollbackProjectFurnitureLayout` restores the pre-save snapshot via `executeSafeRestore`.
