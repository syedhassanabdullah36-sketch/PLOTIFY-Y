/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P33 — Furniture & Circulation Intelligence Workspace
 * Account A | Locked Roadmap: P33 of P30–P40
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  Armchair,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RotateCw,
  Move,
  Trash2,
  Copy,
  Plus,
  Sparkles,
  Eye,
  Save,
  RotateCcw,
  DoorOpen,
  Navigation,
  Sliders,
  Info,
  ShieldAlert,
  Lock,
  Unlock,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { Project } from '../../types/project';
import {
  FurnitureCategory,
  FurnitureCatalogTemplate,
  PlacedFurnitureInstance,
  KnownRoomOpening,
  CirculationClearanceThresholds,
  FurnitureLayoutSuggestion,
  FurnitureSuggestionPreviewDiff,
} from '../../types/furnitureIntelligence';
import {
  ensureProjectFurnitureLayoutData,
  getAllCatalogTemplates,
  createPlacedFurnitureInstance,
  moveFurnitureInstance,
  rotateFurnitureInstance,
  resizeFurnitureInstance,
  duplicateFurnitureInstance,
  evaluateFurnitureIntelligence,
  getInstanceFootprintRect,
  getInstanceFrontClearanceRect,
  getKnownOpeningZones,
  extractKnownFixedRoomObstacles,
  previewFurnitureSuggestion,
  saveProjectFurnitureLayoutSafely,
  rollbackProjectFurnitureLayout,
  getDefaultClearanceThresholds,
  P34_BOUNDARY_DISCLAIMER,
} from '../../services/furnitureIntelligenceService';

interface FurnitureIntelligenceWorkspaceProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onOpenFloorPlan?: () => void;
}

const CATEGORY_LABELS: Record<FurnitureCategory, string> = {
  sleeping: 'Sleeping',
  'seating-living': 'Seating & Living',
  dining: 'Dining',
  'work-office': 'Work & Study',
  'storage-cabinetry': 'Storage & Cabinetry',
  'kitchen-casework': 'Kitchen Casework',
  'bathroom-fixtures': 'Bathroom Fixtures',
  'utility-laundry': 'Utility & Laundry',
};

export const FurnitureIntelligenceWorkspace: React.FC<
  FurnitureIntelligenceWorkspaceProps
> = ({ project, onUpdateProject, onOpenFloorPlan }) => {
  const initialLayout = useMemo(
    () => ensureProjectFurnitureLayoutData(project),
    [project]
  );

  const [instances, setInstances] = useState<PlacedFurnitureInstance[]>(
    initialLayout.instances
  );
  const [knownOpenings, setKnownOpenings] = useState<KnownRoomOpening[]>(
    initialLayout.knownOpenings
  );
  const [clearanceThresholds, setClearanceThresholds] =
    useState<CirculationClearanceThresholds>(initialLayout.clearanceThresholds);
  const [customTemplates, setCustomTemplates] = useState<
    FurnitureCatalogTemplate[]
  >(initialLayout.customTemplates);
  const [requestSeq, setRequestSeq] = useState<number>(
    initialLayout.requestSequenceId || 1
  );

  useEffect(() => {
    const fresh = ensureProjectFurnitureLayoutData(project);
    setInstances(fresh.instances);
    setKnownOpenings(fresh.knownOpenings);
    setClearanceThresholds(fresh.clearanceThresholds);
    setCustomTemplates(fresh.customTemplates);
    setRequestSeq(fresh.requestSequenceId || 1);
  }, [project.id, project.updatedAt]);

  const rooms = project.floorPlan?.rooms || [];
  const availableFloors = useMemo(() => {
    const levels = Array.from(new Set(rooms.map((r) => r.floorLevel || 1))).sort(
      (a, b) => a - b
    );
    return levels.length > 0 ? levels : [1];
  }, [rooms]);

  const [activeFloor, setActiveFloor] = useState<number>(
    availableFloors[0] || 1
  );
  const floorRooms = useMemo(
    () => rooms.filter((r) => (r.floorLevel || 1) === activeFloor),
    [rooms, activeFloor]
  );

  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    floorRooms[0]?.id || rooms[0]?.id || ''
  );

  useEffect(() => {
    if (
      floorRooms.length > 0 &&
      !floorRooms.some((r) => r.id === selectedRoomId)
    ) {
      setSelectedRoomId(floorRooms[0].id);
    }
  }, [floorRooms, selectedRoomId]);

  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null
  );
  const [selectedCategory, setSelectedCategory] = useState<
    FurnitureCategory | 'all'
  >('all');
  const [showClearanceZones, setShowClearanceZones] = useState<boolean>(true);
  const [showDoorZones, setShowDoorZones] = useState<boolean>(true);
  const [showCirculationRoutes, setShowCirculationRoutes] =
    useState<boolean>(true);

  const [activeTab, setActiveTab] = useState<
    'catalog' | 'diagnostics' | 'circulation' | 'suggestions' | 'openings' | 'thresholds'
  >('catalog');

  const [previewDiff, setPreviewDiff] =
    useState<FurnitureSuggestionPreviewDiff | null>(null);
  const [previewSuggestion, setPreviewSuggestion] =
    useState<FurnitureLayoutSuggestion | null>(null);
  const [statusBanner, setStatusBanner] = useState<{
    kind: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  // New Door Opening form state
  const [newOpeningWall, setNewOpeningWall] = useState<
    'north' | 'south' | 'east' | 'west'
  >('south');
  const [newOpeningOffset, setNewOpeningOffset] = useState<number>(2.0);
  const [newOpeningWidth, setNewOpeningWidth] = useState<number>(
    project.unit === 'metres' ? 0.9 : 3.0
  );
  const [newOpeningSwing, setNewOpeningSwing] = useState<
    'inward-left' | 'inward-right' | 'outward' | 'sliding-or-none'
  >('inward-left');

  const unit = project.unit || 'feet';
  const stepIncrement = unit === 'metres' ? 0.15 : 0.5;

  const allTemplates = useMemo(() => {
    const base = getAllCatalogTemplates(project);
    const mergedMap = new Map<string, FurnitureCatalogTemplate>();
    for (const t of base) mergedMap.set(t.templateId, t);
    for (const t of customTemplates) mergedMap.set(t.templateId, t);
    return Array.from(mergedMap.values());
  }, [project, customTemplates]);

  const filteredTemplates = useMemo(() => {
    if (selectedCategory === 'all') return allTemplates;
    return allTemplates.filter((t) => t.category === selectedCategory);
  }, [allTemplates, selectedCategory]);

  // Run full deterministic P33 evaluation whenever working state changes
  const evaluation = useMemo(() => {
    return evaluateFurnitureIntelligence({
      project,
      instances,
      knownOpenings,
      clearanceThresholds,
      customRoutes: initialLayout.customRoutes,
      requestSequenceId: requestSeq,
    });
  }, [
    project,
    instances,
    knownOpenings,
    clearanceThresholds,
    initialLayout.customRoutes,
    requestSeq,
  ]);

  const fixedObstacles = useMemo(
    () => extractKnownFixedRoomObstacles(project),
    [project]
  );

  const selectedInstance = useMemo(
    () => instances.find((i) => i.instanceId === selectedInstanceId) || null,
    [instances, selectedInstanceId]
  );

  const hasUnsavedChanges = useMemo(() => {
    return (
      JSON.stringify(instances) !== JSON.stringify(initialLayout.instances) ||
      JSON.stringify(knownOpenings) !==
        JSON.stringify(initialLayout.knownOpenings) ||
      JSON.stringify(clearanceThresholds) !==
        JSON.stringify(initialLayout.clearanceThresholds)
    );
  }, [instances, knownOpenings, clearanceThresholds, initialLayout]);

  const handlePlaceTemplate = (tpl: FurnitureCatalogTemplate) => {
    const targetRoomId = selectedRoomId || floorRooms[0]?.id;
    if (!targetRoomId) {
      setStatusBanner({
        kind: 'warning',
        message: 'Select a valid room on the floor plan before placing furniture.',
      });
      return;
    }

    const placed = createPlacedFurnitureInstance({
      project,
      template: tpl,
      roomId: targetRoomId,
    });

    setInstances((prev) => [...prev, placed]);
    setSelectedInstanceId(placed.instanceId);
    setRequestSeq((s) => s + 1);
    setStatusBanner({
      kind: 'success',
      message: `Placed "${tpl.name}" in room. Review clearance and collision status below.`,
    });
  };

  const handleMoveSelected = (dx: number, dy: number) => {
    if (!selectedInstance || selectedInstance.isLocked) return;
    const updated = moveFurnitureInstance(
      selectedInstance,
      selectedInstance.x + dx,
      selectedInstance.y + dy
    );
    setInstances((prev) =>
      prev.map((i) => (i.instanceId === updated.instanceId ? updated : i))
    );
    setRequestSeq((s) => s + 1);
  };

  const handleRotateSelected = () => {
    if (!selectedInstance || selectedInstance.isLocked) return;
    const updated = rotateFurnitureInstance(
      selectedInstance,
      (selectedInstance.rotationDeg + 90) % 360
    );
    setInstances((prev) =>
      prev.map((i) => (i.instanceId === updated.instanceId ? updated : i))
    );
    setRequestSeq((s) => s + 1);
  };

  const handleResizeSelected = (newW: number, newD: number) => {
    if (!selectedInstance || selectedInstance.isLocked) return;
    if (!Number.isFinite(newW) || !Number.isFinite(newD) || newW <= 0 || newD <= 0)
      return;
    const updated = resizeFurnitureInstance(selectedInstance, newW, newD);
    setInstances((prev) =>
      prev.map((i) => (i.instanceId === updated.instanceId ? updated : i))
    );
    setRequestSeq((s) => s + 1);
  };

  const handleDuplicateSelected = () => {
    if (!selectedInstance) return;
    const copy = duplicateFurnitureInstance(
      selectedInstance,
      stepIncrement * 2,
      stepIncrement * 2
    );
    setInstances((prev) => [...prev, copy]);
    setSelectedInstanceId(copy.instanceId);
    setRequestSeq((s) => s + 1);
  };

  const handleToggleLockSelected = () => {
    if (!selectedInstance) return;
    setInstances((prev) =>
      prev.map((i) =>
        i.instanceId === selectedInstance.instanceId
          ? { ...i, isLocked: !i.isLocked }
          : i
      )
    );
  };

  const handleDeleteSelected = () => {
    if (!selectedInstance) return;
    setInstances((prev) =>
      prev.filter((i) => i.instanceId !== selectedInstance.instanceId)
    );
    setSelectedInstanceId(null);
    setRequestSeq((s) => s + 1);
  };

  const handleAddKnownOpening = () => {
    const room = rooms.find((r) => r.id === selectedRoomId);
    if (!room) return;
    const newOpening: KnownRoomOpening = {
      openingId: `door-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      roomId: room.id,
      floorLevel: room.floorLevel || 1,
      type: 'door',
      label: `${room.name} ${newOpeningWall.toUpperCase()} Door`,
      wallEdge: newOpeningWall,
      offsetAlongWall: Math.max(0, Number(newOpeningOffset) || 0),
      width: Math.max(0.5, Number(newOpeningWidth) || 3.0),
      swingDirection: newOpeningSwing,
      provenance: 'user-entered',
    };
    setKnownOpenings((prev) => [...prev, newOpening]);
    setRequestSeq((s) => s + 1);
    setStatusBanner({
      kind: 'success',
      message: `Added verified door opening "${newOpening.label}" on ${newOpeningWall} wall of "${room.name}". Doorway swing & route checks are now active for this room.`,
    });
  };

  const handleRemoveOpening = (openingId: string) => {
    setKnownOpenings((prev) => prev.filter((o) => o.openingId !== openingId));
    setRequestSeq((s) => s + 1);
  };

  const handleOpenPreview = (sug: FurnitureLayoutSuggestion) => {
    const diff = previewFurnitureSuggestion({
      project,
      currentInstances: instances,
      knownOpenings,
      thresholds: clearanceThresholds,
      customRoutes: initialLayout.customRoutes,
      suggestion: sug,
    });
    setPreviewSuggestion(sug);
    setPreviewDiff(diff);
  };

  const handleConfirmApplySuggestion = () => {
    if (!previewDiff || !previewSuggestion) return;
    setInstances(previewDiff.proposedInstances);
    setPreviewDiff(null);
    setPreviewSuggestion(null);
    setRequestSeq((s) => s + 1);
    setStatusBanner({
      kind: 'success',
      message: `Applied suggestion "${previewSuggestion.title}". Click "Save Layout" to persist with snapshot protection.`,
    });
  };

  const handleSaveLayout = () => {
    try {
      const { updatedProject, preSaveSnapshotId } =
        saveProjectFurnitureLayoutSafely({
          project,
          layoutData: {
            version: initialLayout.version,
            unit,
            customTemplates,
            instances,
            knownOpenings,
            clearanceThresholds,
            customRoutes: initialLayout.customRoutes,
            lastSavedAt: new Date().toISOString(),
            lastPreSaveSnapshotId: initialLayout.lastPreSaveSnapshotId,
            requestSequenceId: requestSeq,
          },
          actor: 'user',
          reason: 'Saved P33 Furniture & Circulation Layout',
        });
      onUpdateProject(updatedProject);
      setStatusBanner({
        kind: 'success',
        message: `Saved furniture layout (${instances.length} items) without modifying room geometry.${preSaveSnapshotId ? ` Pre-save snapshot checkpoint created (${preSaveSnapshotId}).` : ''}`,
      });
    } catch (err: any) {
      setStatusBanner({
        kind: 'error',
        message: err?.message || 'Failed to save furniture layout.',
      });
    }
  };

  const handleRollbackLayout = () => {
    try {
      const restored = rollbackProjectFurnitureLayout(project);
      onUpdateProject(restored);
      setStatusBanner({
        kind: 'success',
        message: 'Restored project to pre-save furniture snapshot.',
      });
    } catch (err: any) {
      setStatusBanner({
        kind: 'error',
        message: err?.message || 'No snapshot available for rollback.',
      });
    }
  };

  // Compute SVG viewport bounds for the active floor
  const canvasBounds = useMemo(() => {
    const pad = unit === 'metres' ? 1.5 : 4;
    let maxW = project.plotWidth || 40;
    let maxL = project.plotLength || 50;
    for (const r of floorRooms) {
      maxW = Math.max(maxW, r.x + r.width);
      maxL = Math.max(maxL, r.y + r.length);
    }
    return {
      minX: -pad,
      minY: -pad,
      width: maxW + pad * 2,
      height: maxL + pad * 2,
    };
  }, [floorRooms, project.plotWidth, project.plotLength, unit]);

  const conflictCount = evaluation.diagnostics.filter(
    (d) => d.severity === 'conflict'
  ).length;
  const warningCount = evaluation.diagnostics.filter(
    (d) => d.severity === 'warning'
  ).length;
  const unavailableCount = evaluation.diagnostics.filter(
    (d) => d.severity === 'unavailable'
  ).length;

  if (rooms.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 p-8 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-700 shrink-0">
            <Armchair className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-stone-900">
              P33 — Furniture &amp; Circulation Intelligence
            </h2>
            <p className="text-sm text-stone-600 mt-1">
              This project does not have a generated 2D room floor plan yet. Furniture
              placement, boundary containment, and circulation routing require rooms with
              explicit dimensions.
            </p>
            {onOpenFloorPlan && (
              <button
                onClick={onOpenFloorPlan}
                className="mt-4 px-4 py-2 rounded-xl bg-stone-900 text-white text-sm font-medium hover:bg-stone-800 transition-colors"
              >
                Open 2D Floor Plan Studio
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="px-2.5 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-semibold uppercase tracking-wider">
                P33 • Account A
              </span>
              <span className="text-xs text-stone-500 font-mono">
                {evaluation.engineVersion}
              </span>
              <span className="text-xs text-stone-500">
                • Units: <strong>{unit}</strong>
              </span>
            </div>
            <h1 className="text-2xl font-bold text-stone-900 mt-1 flex items-center gap-2">
              <Armchair className="w-6 h-6 text-indigo-600" />
              Furniture &amp; Circulation Intelligence
            </h1>
            <p className="text-sm text-stone-600 mt-1">
              Deterministic furniture placement, footprint collision &amp; boundary checks,
              known door-swing verification, and grid-based circulation path analysis.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {hasUnsavedChanges && (
              <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Unsaved layout edits
              </span>
            )}
            <button
              onClick={handleSaveLayout}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-sm"
            >
              <Save className="w-4 h-4" />
              Save Layout
            </button>
            {project.furnitureLayout?.lastPreSaveSnapshotId && (
              <button
                onClick={handleRollbackLayout}
                className="px-3.5 py-2 rounded-xl bg-stone-100 text-stone-700 text-sm font-medium hover:bg-stone-200 transition-colors flex items-center gap-1.5"
                title="Restore project to pre-save furniture snapshot"
              >
                <RotateCcw className="w-4 h-4" />
                Rollback Snapshot
              </button>
            )}
          </div>
        </div>

        {/* Non-Color-Only Status Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-5 border-t border-stone-100">
          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-3">
            <Armchair className="w-5 h-5 text-indigo-600 shrink-0" />
            <div>
              <div className="text-xs text-stone-500 font-medium">
                Placed Furniture
              </div>
              <div className="text-lg font-bold text-stone-900">
                {instances.length} items
              </div>
            </div>
          </div>

          <div
            className={`p-3 rounded-xl border flex items-center gap-3 ${
              conflictCount > 0
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            {conflictCount > 0 ? (
              <XCircle className="w-5 h-5 text-red-600 shrink-0" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            )}
            <div>
              <div className="text-xs font-medium opacity-80">
                Geometric Conflicts
              </div>
              <div className="text-lg font-bold">
                {conflictCount > 0
                  ? `${conflictCount} Conflict${conflictCount === 1 ? '' : 's'}`
                  : '0 Conflicts (Pass)'}
              </div>
            </div>
          </div>

          <div
            className={`p-3 rounded-xl border flex items-center gap-3 ${
              warningCount > 0
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-stone-50 border-stone-200 text-stone-800'
            }`}
          >
            <AlertTriangle
              className={`w-5 h-5 shrink-0 ${
                warningCount > 0 ? 'text-amber-600' : 'text-stone-400'
              }`}
            />
            <div>
              <div className="text-xs font-medium opacity-80">
                Clearance &amp; Pinch Warnings
              </div>
              <div className="text-lg font-bold">
                {warningCount} Warning{warningCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 flex items-center gap-3">
            <HelpCircle className="w-5 h-5 text-stone-600 shrink-0" />
            <div>
              <div className="text-xs text-stone-500 font-medium">
                Unassessed Door Checks
              </div>
              <div className="text-lg font-bold text-stone-900">
                {unavailableCount} Room{unavailableCount === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        </div>

        {/* P34 Boundary Disclosure */}
        <div className="mt-4 p-3 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-blue-900 flex items-start gap-2.5">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <strong>Methodological &amp; Roadmap Boundary (P33 vs P34):</strong>{' '}
            {P34_BOUNDARY_DISCLAIMER}
          </div>
        </div>

        {statusBanner && (
          <div
            role="status"
            className={`mt-4 p-3 rounded-xl border text-xs font-medium flex items-center justify-between ${
              statusBanner.kind === 'error'
                ? 'bg-red-50 border-red-200 text-red-800'
                : statusBanner.kind === 'warning'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
            }`}
          >
            <span>{statusBanner.message}</span>
            <button
              onClick={() => setStatusBanner(null)}
              className="underline ml-3"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Main Split Workspace: Left Interactive 2D Furniture & Circulation Canvas, Right Control Tabs */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Column: 2D Visual Canvas & Selected Item Inspector */}
        <div className="xl:col-span-7 space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-stone-500" />
                <span className="text-sm font-bold text-stone-800">
                  Floor Level:
                </span>
                {availableFloors.map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setActiveFloor(lvl)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      activeFloor === lvl
                        ? 'bg-stone-900 text-white'
                        : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                    }`}
                  >
                    Floor {lvl}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer bg-stone-50 px-2.5 py-1 rounded-lg border border-stone-200">
                  <input
                    type="checkbox"
                    checked={showClearanceZones}
                    onChange={(e) => setShowClearanceZones(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <span>Front Clearances</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer bg-stone-50 px-2.5 py-1 rounded-lg border border-stone-200">
                  <input
                    type="checkbox"
                    checked={showDoorZones}
                    onChange={(e) => setShowDoorZones(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <span>Known Doors &amp; Swings</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer bg-stone-50 px-2.5 py-1 rounded-lg border border-stone-200">
                  <input
                    type="checkbox"
                    checked={showCirculationRoutes}
                    onChange={(e) => setShowCirculationRoutes(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <span>Circulation Routes</span>
                </label>
              </div>
            </div>

            {/* Interactive SVG Room & Furniture Plan */}
            <div className="bg-stone-950 rounded-xl p-3 overflow-hidden border border-stone-800">
              <svg
                viewBox={`${canvasBounds.minX} ${canvasBounds.minY} ${canvasBounds.width} ${canvasBounds.height}`}
                className="w-full h-[440px]"
                aria-label="2D Furniture and Circulation Plan"
              >
                <defs>
                  <pattern
                    id="p33-conflict-hatch"
                    width="1"
                    height="1"
                    patternTransform="rotate(45 0 0)"
                    patternUnits="userSpaceOnUse"
                  >
                    <line
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                      stroke="#ef4444"
                      strokeWidth="0.25"
                    />
                  </pattern>
                </defs>

                {/* Rooms on active floor */}
                {floorRooms.map((room) => {
                  const isRoomSelected = room.id === selectedRoomId;
                  const metric = evaluation.roomMetrics.find(
                    (m) => m.roomId === room.id
                  );
                  return (
                    <g
                      key={room.id}
                      onClick={() => setSelectedRoomId(room.id)}
                      className="cursor-pointer"
                    >
                      <rect
                        x={room.x}
                        y={room.y}
                        width={room.width}
                        height={room.length}
                        fill={isRoomSelected ? '#1e293b' : '#0f172a'}
                        stroke={isRoomSelected ? '#818cf8' : '#475569'}
                        strokeWidth={isRoomSelected ? 0.35 : 0.2}
                      />
                      <text
                        x={room.x + 0.6}
                        y={room.y + 1.4}
                        fill="#e2e8f0"
                        fontSize="1.1"
                        fontWeight="bold"
                      >
                        {room.name} ({room.width}×{room.length} {unit})
                      </text>
                      {metric && (
                        <text
                          x={room.x + 0.6}
                          y={room.y + 2.6}
                          fill="#94a3b8"
                          fontSize="0.85"
                        >
                          Free floor: {metric.freeFloorRatioPercent}% •{' '}
                          {metric.placedInstanceCount} items
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Known Fixed Obstacles (Structural Columns / MEP) */}
                {fixedObstacles
                  .filter((o) => o.floorLevel === activeFloor)
                  .map((obs) => (
                    <g key={obs.obstacleId}>
                      <rect
                        x={obs.x}
                        y={obs.y}
                        width={obs.width}
                        height={obs.depth}
                        fill="#475569"
                        stroke="#f8fafc"
                        strokeWidth="0.12"
                      />
                      <title>{obs.label}</title>
                    </g>
                  ))}

                {/* Known Door Openings & Swing Zones */}
                {showDoorZones &&
                  knownOpenings
                    .filter((o) => o.floorLevel === activeFloor)
                    .map((op) => {
                      const room = floorRooms.find((r) => r.id === op.roomId);
                      if (!room) return null;
                      const { doorwayPoint, approachZone, swingZone } =
                        getKnownOpeningZones(room, op, clearanceThresholds);
                      return (
                        <g key={op.openingId}>
                          <rect
                            x={approachZone.x}
                            y={approachZone.y}
                            width={approachZone.width}
                            height={approachZone.length}
                            fill="rgba(56, 189, 248, 0.14)"
                            stroke="#38bdf8"
                            strokeDasharray="0.4 0.3"
                            strokeWidth="0.12"
                          />
                          {swingZone && (
                            <rect
                              x={swingZone.x}
                              y={swingZone.y}
                              width={swingZone.width}
                              height={swingZone.length}
                              fill="rgba(250, 204, 21, 0.16)"
                              stroke="#facc15"
                              strokeDasharray="0.25 0.25"
                              strokeWidth="0.15"
                            />
                          )}
                          <circle
                            cx={doorwayPoint.x}
                            cy={doorwayPoint.y}
                            r={0.35}
                            fill="#38bdf8"
                          />
                          <text
                            x={doorwayPoint.x + 0.45}
                            y={doorwayPoint.y + 0.3}
                            fill="#7dd3fc"
                            fontSize="0.8"
                          >
                            {op.label}
                          </text>
                        </g>
                      );
                    })}

                {/* Placed Furniture Instances & Front Clearances */}
                {instances
                  .filter((i) => i.floorLevel === activeFloor)
                  .map((inst) => {
                    const rect = getInstanceFootprintRect(inst, unit);
                    const frontRect = getInstanceFrontClearanceRect(
                      inst,
                      clearanceThresholds,
                      allTemplates,
                      unit
                    );
                    const isSelected = inst.instanceId === selectedInstanceId;
                    const hasConflict = evaluation.diagnostics.some(
                      (d) =>
                        d.severity === 'conflict' &&
                        d.affectedInstanceIds.includes(inst.instanceId)
                    );
                    const hasWarning = evaluation.diagnostics.some(
                      (d) =>
                        d.severity === 'warning' &&
                        d.affectedInstanceIds.includes(inst.instanceId)
                    );

                    return (
                      <g
                        key={inst.instanceId}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedInstanceId(inst.instanceId);
                          setSelectedRoomId(inst.roomId);
                        }}
                        className="cursor-pointer"
                      >
                        {showClearanceZones && (
                          <rect
                            x={frontRect.x}
                            y={frontRect.y}
                            width={frontRect.width}
                            height={frontRect.length}
                            fill="rgba(99, 102, 241, 0.15)"
                            stroke="#818cf8"
                            strokeDasharray="0.3 0.3"
                            strokeWidth="0.1"
                          />
                        )}
                        <rect
                          x={rect.x}
                          y={rect.y}
                          width={rect.width}
                          height={rect.length}
                          fill={
                            hasConflict
                              ? 'rgba(239, 68, 68, 0.35)'
                              : hasWarning
                                ? 'rgba(245, 158, 11, 0.32)'
                                : 'rgba(99, 102, 241, 0.38)'
                          }
                          stroke={
                            isSelected
                              ? '#ffffff'
                              : hasConflict
                                ? '#ef4444'
                                : hasWarning
                                  ? '#f59e0b'
                                  : '#818cf8'
                          }
                          strokeWidth={isSelected ? 0.3 : 0.18}
                        />
                        <text
                          x={rect.x + rect.width / 2}
                          y={rect.y + rect.length / 2}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#f8fafc"
                          fontSize="0.85"
                          fontWeight="600"
                        >
                          {inst.name} ({inst.rotationDeg}°)
                        </text>
                        <text
                          x={rect.x + rect.width / 2}
                          y={rect.y + rect.length / 2 + 0.95}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#cbd5e1"
                          fontSize="0.68"
                        >
                          {rect.width}×{rect.length} {unit}
                          {hasConflict
                            ? ' [CONFLICT]'
                            : hasWarning
                              ? ' [WARN]'
                              : ''}
                        </text>
                      </g>
                    );
                  })}

                {/* Collision Overlap Rectangles */}
                {evaluation.diagnostics
                  .filter(
                    (d) => d.floorLevel === activeFloor && d.collisionRect
                  )
                  .map((d) => (
                    <rect
                      key={d.id}
                      x={d.collisionRect!.x}
                      y={d.collisionRect!.y}
                      width={d.collisionRect!.width}
                      height={d.collisionRect!.length}
                      fill="url(#p33-conflict-hatch)"
                      stroke="#ef4444"
                      strokeWidth="0.2"
                    />
                  ))}

                {/* Evaluated Circulation Route Polylines */}
                {showCirculationRoutes &&
                  evaluation.roomMetrics
                    .filter((m) => m.floorLevel === activeFloor)
                    .flatMap((m) => m.routesEvaluated)
                    .filter((r) => r.pathWaypoints.length >= 2)
                    .map((route) => {
                      const pointsStr = route.pathWaypoints
                        .map((pt) => `${pt.x},${pt.y}`)
                        .join(' ');
                      const strokeColor =
                        route.status === 'blocked'
                          ? '#ef4444'
                          : route.status === 'passable-narrow'
                            ? '#f59e0b'
                            : '#10b981';
                      return (
                        <g key={route.routeId}>
                          <polyline
                            points={pointsStr}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth="0.22"
                            strokeDasharray={
                              route.status === 'passable-meets-threshold'
                                ? 'none'
                                : '0.4 0.25'
                            }
                          />
                          {route.bottleneckPoint && (
                            <circle
                              cx={route.bottleneckPoint.x}
                              cy={route.bottleneckPoint.y}
                              r={0.3}
                              fill={strokeColor}
                              stroke="#0f172a"
                              strokeWidth="0.1"
                            >
                              <title>
                                Bottleneck clearance:{' '}
                                {route.bottleneckPoint.clearance} {unit} (near{' '}
                                {route.bottleneckPoint.causedBy})
                              </title>
                            </circle>
                          )}
                        </g>
                      );
                    })}
              </svg>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-stone-600">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-indigo-500/50 border border-indigo-500 inline-block" />
                Valid Footprint
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-red-500/50 border border-red-500 inline-block" />
                Collision / Boundary Conflict
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-amber-500/50 border border-amber-500 inline-block" />
                Clearance / Pinch Warning
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm bg-sky-400/30 border border-sky-400 border-dashed inline-block" />
                Known Door Approach &amp; Swing
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-emerald-500 inline-block" />
                Passable Circulation Path
              </span>
            </div>
          </div>

          {/* Accessible Keyboard & Button Inspector for Selected Furniture Item */}
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
            {selectedInstance ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600">
                      Selected Furniture Item
                    </span>
                    <h3 className="text-base font-bold text-stone-900 flex items-center gap-2">
                      {selectedInstance.name}
                      <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 text-xs font-normal">
                        {selectedInstance.dimensionProvenance}
                      </span>
                    </h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRotateSelected}
                      disabled={selectedInstance.isLocked}
                      className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      Rotate +90° ({selectedInstance.rotationDeg}°)
                    </button>
                    <button
                      onClick={handleDuplicateSelected}
                      className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Duplicate
                    </button>
                    <button
                      onClick={handleToggleLockSelected}
                      className="px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold flex items-center gap-1.5"
                    >
                      {selectedInstance.isLocked ? (
                        <>
                          <Lock className="w-3.5 h-3.5 text-amber-600" />
                          Locked
                        </>
                      ) : (
                        <>
                          <Unlock className="w-3.5 h-3.5" />
                          Lock
                        </>
                      )}
                    </button>
                    <button
                      onClick={handleDeleteSelected}
                      className="px-3 py-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  </div>
                </div>

                {/* Accessible nudge buttons & numeric coordinate/dimension editors */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-stone-100">
                  <div>
                    <div className="text-xs font-semibold text-stone-700 mb-2 flex items-center gap-1.5">
                      <Move className="w-3.5 h-3.5 text-stone-500" />
                      Nudge Position ({stepIncrement} {unit} step)
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleMoveSelected(-stepIncrement, 0)}
                        disabled={selectedInstance.isLocked}
                        aria-label="Move Left"
                        className="p-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 disabled:opacity-40"
                      >
                        <ArrowLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveSelected(0, -stepIncrement)}
                        disabled={selectedInstance.isLocked}
                        aria-label="Move Up"
                        className="p-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 disabled:opacity-40"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveSelected(0, stepIncrement)}
                        disabled={selectedInstance.isLocked}
                        aria-label="Move Down"
                        className="p-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 disabled:opacity-40"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleMoveSelected(stepIncrement, 0)}
                        disabled={selectedInstance.isLocked}
                        aria-label="Move Right"
                        className="p-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-800 disabled:opacity-40"
                      >
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <span className="text-xs text-stone-600 ml-2 font-mono">
                        X={selectedInstance.x} {unit}, Y={selectedInstance.y}{' '}
                        {unit}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-stone-600">
                      Width ({unit})
                      <input
                        type="number"
                        step="0.25"
                        min="0.5"
                        value={selectedInstance.width}
                        disabled={selectedInstance.isLocked}
                        onChange={(e) =>
                          handleResizeSelected(
                            parseFloat(e.target.value),
                            selectedInstance.depth
                          )
                        }
                        className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-stone-300 text-stone-900 text-xs font-mono"
                      />
                    </label>
                    <label className="text-xs text-stone-600">
                      Depth ({unit})
                      <input
                        type="number"
                        step="0.25"
                        min="0.5"
                        value={selectedInstance.depth}
                        disabled={selectedInstance.isLocked}
                        onChange={(e) =>
                          handleResizeSelected(
                            selectedInstance.width,
                            parseFloat(e.target.value)
                          )
                        }
                        className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-stone-300 text-stone-900 text-xs font-mono"
                      />
                    </label>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-xs text-stone-500 flex items-center justify-between">
                <span>
                  Click any placed furniture item on the 2D plan to inspect, move,
                  rotate, resize, lock, or remove it.
                </span>
                <span className="font-medium text-stone-700">
                  Target Room:{' '}
                  {rooms.find((r) => r.id === selectedRoomId)?.name || 'None'}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Catalog, Diagnostics, Circulation Metrics, Suggestions, Known Openings, Thresholds */}
        <div className="xl:col-span-5 space-y-4">
          <div className="bg-white rounded-2xl border border-stone-200 p-5 shadow-sm">
            {/* Navigation Tabs */}
            <div className="flex flex-wrap gap-1.5 border-b border-stone-200 pb-3 mb-4">
              <button
                onClick={() => setActiveTab('catalog')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'catalog'
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <Plus className="w-3.5 h-3.5" />
                Catalog ({allTemplates.length})
              </button>
              <button
                onClick={() => setActiveTab('diagnostics')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'diagnostics'
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                Checks ({evaluation.diagnostics.length})
              </button>
              <button
                onClick={() => setActiveTab('circulation')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'circulation'
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <Navigation className="w-3.5 h-3.5" />
                Routes &amp; Density
              </button>
              <button
                onClick={() => setActiveTab('suggestions')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'suggestions'
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Suggestions ({evaluation.suggestions.length})
              </button>
              <button
                onClick={() => setActiveTab('openings')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'openings'
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <DoorOpen className="w-3.5 h-3.5" />
                Doors ({knownOpenings.length})
              </button>
              <button
                onClick={() => setActiveTab('thresholds')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  activeTab === 'thresholds'
                    ? 'bg-stone-900 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                Thresholds
              </button>
            </div>

            {/* TAB 1: Furniture Catalog */}
            {activeTab === 'catalog' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-stone-700">
                    Place into Room:
                  </label>
                  <select
                    value={selectedRoomId}
                    onChange={(e) => {
                      const r = rooms.find((rm) => rm.id === e.target.value);
                      setSelectedRoomId(e.target.value);
                      if (r) setActiveFloor(r.floorLevel || 1);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-stone-300 text-xs font-medium text-stone-900"
                  >
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        Floor {r.floorLevel || 1} — {r.name} ({r.width}×
                        {r.length} {unit})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Category Filter */}
                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                      selectedCategory === 'all'
                        ? 'bg-indigo-600 text-white'
                        : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                    }`}
                  >
                    All
                  </button>
                  {(Object.keys(CATEGORY_LABELS) as FurnitureCategory[]).map(
                    (cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-2.5 py-1 rounded-md text-xs font-medium ${
                          selectedCategory === cat
                            ? 'bg-indigo-600 text-white'
                            : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                        }`}
                      >
                        {CATEGORY_LABELS[cat]}
                      </button>
                    )
                  )}
                </div>

                <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
                  {filteredTemplates.map((tpl) => {
                    const dims =
                      unit === 'metres'
                        ? tpl.defaultDimensionsMetres
                        : tpl.defaultDimensionsFeet;
                    const clr =
                      unit === 'metres'
                        ? tpl.recommendedClearanceMetres
                        : tpl.recommendedClearanceFeet;
                    return (
                      <div
                        key={tpl.templateId}
                        className="p-3 rounded-xl border border-stone-200 hover:border-indigo-300 bg-stone-50/60 flex items-start justify-between gap-3"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-stone-900">
                              {tpl.name}
                            </span>
                            <span className="px-2 py-0.5 rounded bg-stone-200/80 text-stone-700 text-[10px] font-medium">
                              {CATEGORY_LABELS[tpl.category]}
                            </span>
                          </div>
                          <p className="text-xs text-stone-600 mt-0.5">
                            {tpl.description}
                          </p>
                          <div className="text-[11px] text-stone-500 mt-1 font-mono">
                            Footprint: {dims.width}×{dims.depth} {unit} • Front
                            clearance: {clr.front} {unit}
                          </div>
                          <div className="text-[10px] text-stone-500 mt-0.5 italic">
                            Provenance: {tpl.provenance}
                          </div>
                        </div>

                        <button
                          onClick={() => handlePlaceTemplate(tpl)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 shrink-0 flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Place
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB 2: Validation Diagnostics */}
            {activeTab === 'diagnostics' && (
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {evaluation.diagnostics.length === 0 ? (
                  <div className="p-6 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                    <div className="text-sm font-bold text-emerald-900">
                      No Furniture or Circulation Conflicts Detected
                    </div>
                    <p className="text-xs text-emerald-700 mt-1">
                      Place furniture items from the catalog to run real-time footprint,
                      boundary, doorway, and walkway checks.
                    </p>
                  </div>
                ) : (
                  evaluation.diagnostics.map((diag) => (
                    <div
                      key={diag.id}
                      className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                        diag.severity === 'conflict'
                          ? 'bg-red-50/80 border-red-200 text-red-950'
                          : diag.severity === 'warning'
                            ? 'bg-amber-50/80 border-amber-200 text-amber-950'
                            : 'bg-stone-100 border-stone-300 text-stone-800'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold uppercase tracking-wider flex items-center gap-1.5">
                          {diag.severity === 'conflict' ? (
                            <XCircle className="w-4 h-4 text-red-600 shrink-0" />
                          ) : diag.severity === 'warning' ? (
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                          ) : (
                            <HelpCircle className="w-4 h-4 text-stone-600 shrink-0" />
                          )}
                          [{diag.severity.toUpperCase()}] {diag.category}
                        </span>
                        {diag.roomName && (
                          <span className="px-2 py-0.5 rounded bg-white/80 text-stone-700 font-medium">
                            {diag.roomName}
                          </span>
                        )}
                      </div>
                      <p className="font-medium">{diag.explanation}</p>
                      <div className="text-[11px] opacity-85 font-mono">
                        Measured: {diag.measuredValue}
                        {diag.thresholdUsed
                          ? ` | Threshold: ${diag.thresholdUsed}`
                          : ''}
                      </div>
                      <div className="text-[11px] opacity-75">
                        Method: {diag.calculationMethod}
                      </div>
                      {diag.suggestedAdjustment && (
                        <div className="pt-1 font-semibold">
                          Remediation: {diag.suggestedAdjustment}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 3: Room Circulation & Density Metrics */}
            {activeTab === 'circulation' && (
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {evaluation.roomMetrics.map((m) => (
                  <div
                    key={m.roomId}
                    className="p-3.5 rounded-xl border border-stone-200 bg-stone-50/70 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-stone-900 text-sm">
                        {m.roomName}{' '}
                        <span className="text-xs font-normal text-stone-500">
                          (Floor {m.floorLevel})
                        </span>
                      </span>
                      <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-800 font-semibold">
                        Free Floor: {m.freeFloorRatioPercent}%
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] text-stone-600 font-mono">
                      <div>
                        Gross: {m.grossRoomArea} sq.{unit}
                      </div>
                      <div>
                        Occupied: {m.occupiedFurnitureArea} sq.{unit}
                      </div>
                      <div>
                        Net Free: {m.netFreeFloorArea} sq.{unit}
                      </div>
                    </div>

                    {m.routesEvaluated.length > 0 && (
                      <div className="pt-2 border-t border-stone-200 space-y-1.5">
                        <div className="font-semibold text-stone-700">
                          Evaluated Circulation Paths:
                        </div>
                        {m.routesEvaluated.map((rt) => (
                          <div
                            key={rt.routeId}
                            className="p-2 rounded-lg bg-white border border-stone-200 space-y-1"
                          >
                            <div className="flex items-center justify-between font-semibold">
                              <span>{rt.label}</span>
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${
                                  rt.status === 'passable-meets-threshold'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : rt.status === 'passable-narrow'
                                      ? 'bg-amber-100 text-amber-800'
                                      : rt.status === 'blocked'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-stone-200 text-stone-700'
                                }`}
                              >
                                {rt.status}
                              </span>
                            </div>
                            <p className="text-[11px] text-stone-600">
                              {rt.explanation}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* TAB 4: Layout Improvement Suggestions */}
            {activeTab === 'suggestions' && (
              <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
                {evaluation.suggestions.length === 0 ? (
                  <div className="p-5 rounded-xl bg-stone-50 border border-stone-200 text-xs text-stone-600">
                    No active layout suggestions. All furnished rooms are currently
                    within geometric bounds.
                  </div>
                ) : (
                  evaluation.suggestions.map((sug) => (
                    <div
                      key={sug.suggestionId}
                      className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/40 space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-bold text-stone-900">
                          {sug.title}
                        </span>
                        <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[10px] font-semibold shrink-0">
                          {sug.type}
                        </span>
                      </div>
                      <p className="text-stone-700">{sug.rationale}</p>
                      <div className="text-[11px] text-stone-600">
                        <strong>Expected Improvement:</strong>{' '}
                        {sug.expectedImprovementSummary}
                      </div>
                      <div className="flex items-center justify-end pt-1">
                        <button
                          onClick={() => handleOpenPreview(sug)}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 flex items-center gap-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Preview Before / After
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* TAB 5: Known Door Openings (Never Fabricated) */}
            {activeTab === 'openings' && (
              <div className="space-y-4">
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  <strong>Epistemic Honesty Rule:</strong> Plotify never invents door
                  locations or swing arcs when missing from the floor-plan model. Define
                  known room doors below to activate doorway approach, swing-zone, and
                  door-to-furniture path checks.
                </div>

                <div className="p-3.5 rounded-xl border border-stone-200 bg-stone-50 space-y-3 text-xs">
                  <div className="font-bold text-stone-900">
                    Add Verified Door Opening to{' '}
                    {rooms.find((r) => r.id === selectedRoomId)?.name || 'Room'}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <label className="text-stone-600">
                      Wall Edge
                      <select
                        value={newOpeningWall}
                        onChange={(e) =>
                          setNewOpeningWall(e.target.value as any)
                        }
                        className="mt-1 w-full px-2 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-900"
                      >
                        <option value="north">North Wall</option>
                        <option value="south">South Wall</option>
                        <option value="east">East Wall</option>
                        <option value="west">West Wall</option>
                      </select>
                    </label>
                    <label className="text-stone-600">
                      Swing Direction
                      <select
                        value={newOpeningSwing}
                        onChange={(e) =>
                          setNewOpeningSwing(e.target.value as any)
                        }
                        className="mt-1 w-full px-2 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-900"
                      >
                        <option value="inward-left">Inward Swing (Left)</option>
                        <option value="inward-right">
                          Inward Swing (Right)
                        </option>
                        <option value="outward">Outward Swing</option>
                        <option value="sliding-or-none">
                          Sliding / Open Passage
                        </option>
                      </select>
                    </label>
                    <label className="text-stone-600">
                      Offset Along Wall ({unit})
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={newOpeningOffset}
                        onChange={(e) =>
                          setNewOpeningOffset(parseFloat(e.target.value) || 0)
                        }
                        className="mt-1 w-full px-2 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-900 font-mono"
                      />
                    </label>
                    <label className="text-stone-600">
                      Opening Width ({unit})
                      <input
                        type="number"
                        step="0.25"
                        min="1.5"
                        value={newOpeningWidth}
                        onChange={(e) =>
                          setNewOpeningWidth(parseFloat(e.target.value) || 3.0)
                        }
                        className="mt-1 w-full px-2 py-1.5 rounded-lg border border-stone-300 bg-white text-stone-900 font-mono"
                      />
                    </label>
                  </div>
                  <button
                    onClick={handleAddKnownOpening}
                    className="w-full py-2 rounded-lg bg-stone-900 text-white font-semibold hover:bg-stone-800 flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Known Door Opening
                  </button>
                </div>

                <div className="space-y-2 max-h-[220px] overflow-y-auto">
                  {knownOpenings.map((op) => (
                    <div
                      key={op.openingId}
                      className="p-2.5 rounded-lg border border-stone-200 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-semibold text-stone-900">
                          {op.label}
                        </div>
                        <div className="text-[11px] text-stone-500">
                          Wall: {op.wallEdge} • Offset: {op.offsetAlongWall}{' '}
                          {unit} • Width: {op.width} {unit} • {op.swingDirection}
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveOpening(op.openingId)}
                        className="text-red-600 hover:underline font-medium"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB 6: Configurable Clearance Thresholds */}
            {activeTab === 'thresholds' && (
              <div className="space-y-4 text-xs">
                <div className="p-3 rounded-xl bg-stone-50 border border-stone-200 text-stone-700">
                  <strong>Threshold Provenance:</strong>{' '}
                  <span className="font-mono">
                    {clearanceThresholds.thresholdProvenance}
                  </span>
                  <p className="mt-1 text-[11px] text-stone-500">
                    These values are configurable planning heuristics for general
                    furniture circulation. They do not represent statutory accessibility
                    code verification (reserved for P34).
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block text-stone-700 font-medium">
                    Primary Walkway Width ({unit})
                    <input
                      type="number"
                      step="0.1"
                      min="1.0"
                      value={clearanceThresholds.primaryWalkwayWidth}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (Number.isFinite(val) && val > 0) {
                          setClearanceThresholds((prev) => ({
                            ...prev,
                            primaryWalkwayWidth: val,
                            thresholdProvenance: 'user-configured',
                          }));
                        }
                      }}
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-stone-300 font-mono"
                    />
                  </label>

                  <label className="block text-stone-700 font-medium">
                    Secondary Passage Minimum Width ({unit})
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      value={clearanceThresholds.secondaryPassageWidth}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (Number.isFinite(val) && val > 0) {
                          setClearanceThresholds((prev) => ({
                            ...prev,
                            secondaryPassageWidth: val,
                            thresholdProvenance: 'user-configured',
                          }));
                        }
                      }}
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-stone-300 font-mono"
                    />
                  </label>

                  <label className="block text-stone-700 font-medium">
                    Furniture Front Functional Clearance ({unit})
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      value={clearanceThresholds.furnitureFrontClearance}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (Number.isFinite(val) && val > 0) {
                          setClearanceThresholds((prev) => ({
                            ...prev,
                            furnitureFrontClearance: val,
                            thresholdProvenance: 'user-configured',
                          }));
                        }
                      }}
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-stone-300 font-mono"
                    />
                  </label>

                  <label className="block text-stone-700 font-medium">
                    Doorway Approach Clear Depth ({unit})
                    <input
                      type="number"
                      step="0.1"
                      min="0.5"
                      value={clearanceThresholds.doorwayApproachClearDepth}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (Number.isFinite(val) && val > 0) {
                          setClearanceThresholds((prev) => ({
                            ...prev,
                            doorwayApproachClearDepth: val,
                            thresholdProvenance: 'user-configured',
                          }));
                        }
                      }}
                      className="mt-1 w-full px-3 py-1.5 rounded-lg border border-stone-300 font-mono"
                    />
                  </label>

                  <button
                    onClick={() =>
                      setClearanceThresholds(getDefaultClearanceThresholds(unit))
                    }
                    className="w-full py-2 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold"
                  >
                    Reset to Illustrative Planning Defaults
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Non-Destructive Suggestion Before/After Preview Modal */}
      {previewDiff && previewSuggestion && (
        <div className="fixed inset-0 z-50 bg-stone-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-stone-200 max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-xs font-semibold">
                  Non-Destructive Preview
                </span>
                <h3 className="text-lg font-bold text-stone-900 mt-1">
                  {previewSuggestion.title}
                </h3>
              </div>
              <button
                onClick={() => {
                  setPreviewDiff(null);
                  setPreviewSuggestion(null);
                }}
                className="text-stone-400 hover:text-stone-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-stone-600">{previewSuggestion.rationale}</p>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-stone-50 border border-stone-200">
                <div className="font-bold text-stone-700 mb-1">Before</div>
                <div>Conflicts: {previewDiff.beforeConflictCount}</div>
                <div>Warnings: {previewDiff.beforeWarningCount}</div>
                <div>
                  Free Floor Ratio: {previewDiff.beforeFreeFloorRatioPercent}%
                </div>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="font-bold text-emerald-900 mb-1">
                  After Proposed Change
                </div>
                <div>Conflicts: {previewDiff.afterConflictCount}</div>
                <div>Warnings: {previewDiff.afterWarningCount}</div>
                <div>
                  Free Floor Ratio: {previewDiff.afterFreeFloorRatioPercent}%
                </div>
              </div>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="font-semibold text-stone-800">
                Proposed Furniture Adjustments:
              </div>
              {previewSuggestion.proposedChanges.map((ch) => (
                <div
                  key={ch.instanceId}
                  className="p-2.5 rounded-lg bg-stone-50 border border-stone-200 font-mono text-[11px]"
                >
                  <div>
                    <strong>{ch.instanceName}</strong> ({ch.action})
                  </div>
                  <div>Before: {ch.beforeSummary}</div>
                  <div>After: {ch.afterSummary}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-stone-200">
              <button
                onClick={() => {
                  setPreviewDiff(null);
                  setPreviewSuggestion(null);
                }}
                className="px-4 py-2 rounded-xl bg-stone-100 text-stone-700 text-xs font-semibold hover:bg-stone-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmApplySuggestion}
                className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
              >
                Confirm &amp; Apply to Working Layout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
