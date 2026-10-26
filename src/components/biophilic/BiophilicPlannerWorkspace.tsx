/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P39 — Biophilic & Indoor Plantscape Planner Workspace
 * Account A | Locked Roadmap: P39 of P30–P40
 */

import React, { useMemo, useState } from 'react';
import {
  Sprout,
  Sun,
  AlertTriangle,
  CheckCircle2,
  Download,
  RotateCcw,
  Eye,
  Plus,
  Trash2,
  Layers,
  Calendar,
  Scale,
  ArrowRight,
  Info,
  ShieldAlert,
  Droplets,
  Wind,
  Armchair,
  Accessibility,
} from 'lucide-react';
import { Project } from '../../types/project';
import {
  BiophilicCatalogItem,
  BiophilicElementCategory,
  BiophilicPlacementRecord,
  BiophilicProposalPreviewDiff,
  BiophilicSuitabilityStatus,
  PlantLightRequirementBand,
  ToxicitySafetyStatus,
} from '../../types/biophilicPlanner';
import {
  applyBiophilicProposalAtomically,
  evaluateProjectBiophilicPlanner,
  exportBiophilicReportAsJson,
  exportBiophilicReportAsMarkdown,
  initializeProjectBiophilicPlannerData,
  metresToProjectUnit,
  previewBiophilicRecommendations,
  removeBiophilicPlacement,
  rollbackLastBiophilicApply,
  upsertBiophilicPlacement,
} from '../../services/biophilicPlannerService';
import { ensureProjectFurnitureLayoutData } from '../../services/furnitureIntelligenceService';
import { evaluateProjectDaylightComfort } from '../../services/daylightComfortService';

interface BiophilicPlannerWorkspaceProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onNavigateTab?: (tab: string) => void;
}

type InspectorTab =
  | 'placements'
  | 'catalog'
  | 'maintenance'
  | 'comparison'
  | 'integration';

export const BiophilicPlannerWorkspace: React.FC<BiophilicPlannerWorkspaceProps> = ({
  project,
  onUpdateProject,
  onNavigateTab,
}) => {
  const report = useMemo(() => evaluateProjectBiophilicPlanner(project), [project]);
  const p38Report = useMemo(() => evaluateProjectDaylightComfort(project), [project]);
  const p33Data = useMemo(() => ensureProjectFurnitureLayoutData(project), [project]);

  const [activeTab, setActiveTab] = useState<InspectorTab>('placements');
  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    report.selectedRoomId || report.roomEvaluations[0]?.roomId || ''
  );
  const [selectedPlacementId, setSelectedPlacementId] = useState<string | null>(null);
  const [selectedRecIds, setSelectedRecIds] = useState<string[]>([]);
  const [previewDiff, setPreviewDiff] = useState<BiophilicProposalPreviewDiff | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    text: string;
    kind: 'success' | 'error' | 'info';
  } | null>(null);

  // Catalog filter states
  const [catalogLivingFilter, setCatalogLivingFilter] = useState<'all' | 'living' | 'non-living'>('all');
  const [catalogLightFilter, setCatalogLightFilter] = useState<string>('all');
  const [catalogPetSafeOnly, setCatalogPetSafeOnly] = useState<boolean>(false);

  // Custom catalog entry form state
  const [newSpeciesName, setNewSpeciesName] = useState('');
  const [newScientificName, setNewScientificName] = useState('');
  const [newIsLiving, setNewIsLiving] = useState(true);
  const [newLightBand, setNewLightBand] = useState<PlantLightRequirementBand>('medium-bright-indirect');
  const [newToxicity, setNewToxicity] = useState<ToxicitySafetyStatus>('unknown-unverified');

  const unitSuffix = project.unit === 'feet' ? 'ft' : 'm';
  const areaSuffix = project.unit === 'feet' ? 'sq ft' : 'm²';

  const activeRoomEval =
    report.roomEvaluations.find((r) => r.roomId === selectedRoomId) ||
    report.roomEvaluations[0] ||
    null;

  const activeFloorPlanRoom =
    (project.floorPlan?.rooms || []).find((r) => r.id === activeRoomEval?.roomId) ||
    project.floorPlan?.rooms?.[0] ||
    null;

  const p38ActiveRoomEval =
    p38Report.allRoomEvaluationsForActiveScenario.find(
      (r) => r.roomId === activeRoomEval?.roomId
    ) || null;

  const selectedPlacement =
    activeRoomEval?.placements.find((p) => p.placementId === selectedPlacementId) ||
    activeRoomEval?.placements[0] ||
    null;

  const selectedPlacementEval =
    activeRoomEval?.placementEvaluations.find(
      (pe) => pe.placementId === selectedPlacement?.placementId
    ) || null;

  const filteredCatalog = useMemo(() => {
    return report.catalog.filter((item) => {
      if (catalogLivingFilter === 'living' && !item.isLivingPlant) return false;
      if (catalogLivingFilter === 'non-living' && item.isLivingPlant) return false;
      if (catalogLightFilter !== 'all' && item.lightRequirementBand !== catalogLightFilter) {
        return false;
      }
      if (
        catalogPetSafeOnly &&
        item.toxicityStatus !== 'verified-non-toxic-pets-and-humans' &&
        item.toxicityStatus !== 'not-applicable-non-living'
      ) {
        return false;
      }
      return true;
    });
  }, [report.catalog, catalogLivingFilter, catalogLightFilter, catalogPetSafeOnly]);

  const handleSelectScenario = (scenarioId: string) => {
    const cloned: Project = JSON.parse(JSON.stringify(project));
    const p39Data = initializeProjectBiophilicPlannerData(cloned);
    p39Data.activeScenarioId = scenarioId;
    p39Data.isConfigured = true;
    p39Data.requestSequenceId = (p39Data.requestSequenceId || 1) + 1;
    cloned.biophilicPlanner = p39Data;
    onUpdateProject(cloned);
    setPreviewDiff(null);
    setStatusMessage({
      text: `Switched active scenario to "${
        p39Data.scenarios.find((s) => s.scenarioId === scenarioId)?.name || scenarioId
      }".`,
      kind: 'info',
    });
  };

  const handleSelectComparisonScenario = (scenarioId: string) => {
    const cloned: Project = JSON.parse(JSON.stringify(project));
    const p39Data = initializeProjectBiophilicPlannerData(cloned);
    p39Data.comparisonScenarioId = scenarioId;
    cloned.biophilicPlanner = p39Data;
    onUpdateProject(cloned);
  };

  const handleAddCatalogItemToRoom = (item: BiophilicCatalogItem) => {
    if (!activeFloorPlanRoom) return;
    const unit = project.unit;
    const cW = metresToProjectUnit(item.defaultContainerWidthMetres, unit);
    const cD = metresToProjectUnit(item.defaultContainerDepthMetres, unit);
    const cH = metresToProjectUnit(item.defaultContainerHeightMetres, unit);
    const mW = item.expectedMatureWidthRangeMetres
      ? metresToProjectUnit(item.expectedMatureWidthRangeMetres.max, unit)
      : null;
    const mD = item.expectedMatureDepthRangeMetres
      ? metresToProjectUnit(item.expectedMatureDepthRangeMetres.max, unit)
      : null;

    const existingCount = activeRoomEval?.placements.length || 0;
    const margin = unit === 'feet' ? 1.0 : 0.3;
    const step = unit === 'feet' ? 2.5 : 0.8;
    const localX = Math.max(
      margin,
      Math.min(
        activeFloorPlanRoom.width - cW - margin,
        margin + ((existingCount * step) % Math.max(1, activeFloorPlanRoom.width - cW - margin * 2))
      )
    );
    const localY = Math.max(
      margin,
      Math.min(activeFloorPlanRoom.length - cD - margin, margin)
    );

    const mountType: BiophilicPlacementRecord['mountType'] =
      item.category === 'living-vertical-plant-wall' ||
      item.category === 'non-living-preserved-moss-panel'
        ? 'wall-mounted'
        : item.category === 'living-tabletop-or-shelf-plant'
        ? 'tabletop-or-shelf'
        : item.category === 'living-hanging-or-trailing-plant'
        ? 'hanging-overhead'
        : 'floor-standing';

    const newPlacement: BiophilicPlacementRecord = {
      placementId: `p39-place-${activeFloorPlanRoom.id}-${Date.now()}`,
      catalogId: item.catalogId,
      roomId: activeFloorPlanRoom.id,
      floorLevel: activeFloorPlanRoom.floorLevel || 1,
      label: `${item.displayName} (${activeFloorPlanRoom.name})`,
      quantity: 1,
      mountType,
      wallEdge: mountType === 'wall-mounted' ? 'north' : null,
      localX: Math.round(localX * 100) / 100,
      localY: Math.round(localY * 100) / 100,
      rotationDeg: 0,
      containerWidth: cW,
      containerDepth: cD,
      installedHeight: cH,
      expectedMatureWidth: mW,
      expectedMatureDepth: mD,
      unit,
      provenance: 'user_entered_project_data',
      completeness: item.completeness,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const res = upsertBiophilicPlacement(project, newPlacement);
    if (res.validationErrors.length > 0) {
      setStatusMessage({
        text: `Validation error: ${res.validationErrors.join('; ')}`,
        kind: 'error',
      });
      return;
    }
    onUpdateProject(res.updatedProject);
    setSelectedPlacementId(newPlacement.placementId);
    setActiveTab('placements');
    setStatusMessage({
      text: `Added "${item.displayName}" to "${activeFloorPlanRoom.name}".`,
      kind: 'success',
    });
  };

  const handleUpdatePlacementField = (
    placement: BiophilicPlacementRecord,
    patch: Partial<BiophilicPlacementRecord>
  ) => {
    const updated: BiophilicPlacementRecord = {
      ...placement,
      ...patch,
      provenance: 'user_entered_project_data',
      updatedAt: new Date().toISOString(),
    };
    const res = upsertBiophilicPlacement(project, updated);
    if (res.validationErrors.length > 0) {
      setStatusMessage({
        text: `Invalid placement value: ${res.validationErrors.join('; ')}`,
        kind: 'error',
      });
      return;
    }
    onUpdateProject(res.updatedProject);
  };

  const handleDeletePlacement = (placementId: string) => {
    const updated = removeBiophilicPlacement(project, placementId);
    onUpdateProject(updated);
    if (selectedPlacementId === placementId) {
      setSelectedPlacementId(null);
    }
    setStatusMessage({
      text: 'Removed placement from active scenario.',
      kind: 'info',
    });
  };

  const handleAddCustomCatalogEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSpeciesName.trim()) return;
    const cloned: Project = JSON.parse(JSON.stringify(project));
    const p39Data = initializeProjectBiophilicPlannerData(cloned);
    const customItem: BiophilicCatalogItem = {
      catalogId: `custom-p39-${Date.now()}`,
      displayName: newSpeciesName.trim(),
      scientificName: newScientificName.trim() ? newScientificName.trim() : null,
      isLivingPlant: newIsLiving,
      category: newIsLiving ? 'living-floor-plant' : 'non-living-natural-material-feature',
      growthForm: newIsLiving ? 'upright-foliage-tree-or-shrub' : 'non-living-static-feature',
      description: 'User-entered custom catalog record.',
      defaultContainerWidthMetres: 0.4,
      defaultContainerDepthMetres: 0.4,
      defaultContainerHeightMetres: 0.85,
      expectedMatureWidthRangeMetres: null,
      expectedMatureDepthRangeMetres: null,
      expectedMatureHeightRangeMetres: null,
      lightRequirementBand: newIsLiving ? newLightBand : 'not-applicable-non-living',
      referenceDaylightFactorMinPercent:
        !newIsLiving
          ? null
          : newLightBand === 'low-indirect-tolerant'
          ? 0.5
          : newLightBand === 'medium-bright-indirect'
          ? 1.2
          : newLightBand === 'high-bright-with-some-direct'
          ? 2.0
          : null,
      referenceIlluminanceRangeLux: null,
      directSunTolerance: 'unknown',
      wateringDemand: newIsLiving ? 'moderate-even-moisture' : 'none-non-living',
      maintenanceComplexity: newIsLiving ? 'moderate' : 'minimal-dusting-only',
      estimatedMonthlyCareMinutesPerUnit: newIsLiving ? 20 : 5,
      preferredRelativeHumidityRangePercent: null,
      preferredTemperatureRangeCelsius: null,
      soilAndDrainageRequirement: newIsLiving
        ? 'User-specified container drainage required.'
        : null,
      containerRequirement: 'User-entered container specification.',
      toxicityStatus: newIsLiving ? newToxicity : 'not-applicable-non-living',
      toxicityDetails:
        newToxicity === 'unknown-unverified'
          ? 'User-entered species with unverified toxicity.'
          : `User-classified toxicity: ${newToxicity}`,
      provenance: 'user_entered_project_data',
      completeness:
        newLightBand === 'unknown' || newToxicity === 'unknown-unverified'
          ? 'incomplete'
          : 'partial',
      missingInformationNotes: [
        'Expected mature canopy width and depth are not specified.',
        ...(newToxicity === 'unknown-unverified'
          ? ['Botanical toxicity status is unverified.']
          : []),
      ],
      evidenceSource: null,
      isCustomUserEntry: true,
    };

    p39Data.customCatalogItems.push(customItem);
    p39Data.isConfigured = true;
    cloned.biophilicPlanner = p39Data;
    onUpdateProject(cloned);
    setNewSpeciesName('');
    setNewScientificName('');
    setStatusMessage({
      text: `Added custom catalog item "${customItem.displayName}".`,
      kind: 'success',
    });
  };

  const handleUpdateMaintenanceSettings = (
    patch: Partial<typeof report.maintenanceSettings>
  ) => {
    const cloned: Project = JSON.parse(JSON.stringify(project));
    const p39Data = initializeProjectBiophilicPlannerData(cloned);
    const activeScen =
      p39Data.scenarios.find((s) => s.scenarioId === p39Data.activeScenarioId) ||
      p39Data.scenarios[0];

    activeScen.maintenanceSettings = {
      ...activeScen.maintenanceSettings,
      ...patch,
      provenance: 'user_entered_project_data',
    };
    p39Data.maintenanceSettings = activeScen.maintenanceSettings;
    p39Data.isConfigured = true;
    p39Data.requestSequenceId = (p39Data.requestSequenceId || 1) + 1;
    cloned.biophilicPlanner = p39Data;
    onUpdateProject(cloned);
  };

  const handleToggleRecSelection = (recId: string) => {
    setSelectedRecIds((prev) =>
      prev.includes(recId) ? prev.filter((id) => id !== recId) : [...prev, recId]
    );
  };

  const handleGeneratePreview = (recIdsToPreview?: string[]) => {
    const targetIds =
      recIdsToPreview && recIdsToPreview.length > 0
        ? recIdsToPreview
        : selectedRecIds.length > 0
        ? selectedRecIds
        : report.recommendations.slice(0, 1).map((r) => r.recommendationId);

    if (targetIds.length === 0) {
      setStatusMessage({
        text: 'No recommendations available to preview.',
        kind: 'info',
      });
      return;
    }

    const diff = previewBiophilicRecommendations(project, targetIds);
    setPreviewDiff(diff);
  };

  const handleApplyPreview = () => {
    if (!previewDiff) return;
    const res = applyBiophilicProposalAtomically(project, previewDiff);
    setStatusMessage({
      text: res.message,
      kind: res.applied ? 'success' : 'error',
    });
    if (res.applied) {
      onUpdateProject(res.updatedProject);
      setPreviewDiff(null);
      setSelectedRecIds([]);
    }
  };

  const handleRollback = () => {
    const res = rollbackLastBiophilicApply(project);
    setStatusMessage({
      text: res.message,
      kind: res.rolledBack ? 'success' : 'error',
    });
    if (res.rolledBack) {
      onUpdateProject(res.restoredProject);
      setPreviewDiff(null);
    }
  };

  const handleDownloadExport = (format: 'json' | 'md') => {
    const content =
      format === 'json'
        ? exportBiophilicReportAsJson(report)
        : exportBiophilicReportAsMarkdown(report);
    const blob = new Blob([content], {
      type: format === 'json' ? 'application/json' : 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.toLowerCase().replace(/\s+/g, '-')}-p39-biophilic-report.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatSuitabilityLabel = (status: BiophilicSuitabilityStatus) => {
    switch (status) {
      case 'suitable-based-on-available-evidence':
        return 'Suitable (Evidence-Backed)';
      case 'potentially-suitable-additional-info-needed':
        return 'Potentially Suitable · Info Needed';
      case 'unsuitable-under-current-assumptions':
        return 'Unsuitable Under Assumptions';
      case 'not-assessable-with-current-data':
        return 'Not Assessable · Missing Data';
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Top Workspace Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-semibold text-emerald-800">P39 Workspace</span>
              <span aria-hidden="true">·</span>
              <span>Engine {report.engineVersion}</span>
              <span aria-hidden="true">·</span>
              <span>Provenance: {report.overallProvenance}</span>
              <span aria-hidden="true">·</span>
              <span>Completeness: {report.overallCompleteness}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <Sprout className="w-6 h-6 text-emerald-700 shrink-0" />
              <span>Biophilic &amp; Indoor Plantscape Planner</span>
            </h1>
            <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
              Coordinates indoor plantscapes, grouped troughs, vertical living-wall concepts, and
              non-living biophilic features against P38 room daylight availability, P33 furniture &amp;
              doorway clearances, P34 accessible routes, P37 operable windows, and deterministic
              care requirements.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {report.recommendations.length > 0 && (
              <button
                onClick={() => handleGeneratePreview()}
                className="px-3.5 py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>
                  Preview &amp; Apply ({selectedRecIds.length || 1})
                </span>
              </button>
            )}

            {project.biophilicPlanner?.lastPreApplySnapshotId && (
              <button
                onClick={handleRollback}
                className="px-3.5 py-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                title="Rollback to pre-apply P39 snapshot"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-800" />
                <span>Rollback Last Apply</span>
              </button>
            )}

            <button
              onClick={() => handleDownloadExport('json')}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>Export JSON</span>
            </button>

            <button
              onClick={() => handleDownloadExport('md')}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-slate-600" />
              <span>Export Markdown</span>
            </button>
          </div>
        </div>

        {/* Scenario Selectors & Summary Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 pt-4 border-t border-slate-100 items-end">
          <div className="md:col-span-4">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Active Plantscape Scenario
            </label>
            <select
              value={report.activeScenario.scenarioId}
              onChange={(e) => handleSelectScenario(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-900"
            >
              {report.allScenarios.map((scen) => (
                <option key={scen.scenarioId} value={scen.scenarioId}>
                  {scen.name} ({scen.placements.length} placements)
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4">
            <label className="block text-[11px] font-semibold text-slate-600 mb-1">
              Comparison Scenario (Side-by-Side)
            </label>
            <select
              value={report.comparisonScenario?.scenarioId || ''}
              onChange={(e) => handleSelectComparisonScenario(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-medium text-slate-900"
            >
              {report.allScenarios.map((scen) => (
                <option key={scen.scenarioId} value={scen.scenarioId}>
                  {scen.name}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-4 grid grid-cols-3 gap-2 text-xs">
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[10px] text-slate-500 font-medium">Living / Non-Living</div>
              <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                {report.totals.totalLivingPlants} / {report.totals.totalNonLivingFeatures}
              </div>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[10px] text-slate-500 font-medium">Floor Area</div>
              <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                {report.totals.totalContainerFloorAreaM2} m²
              </div>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[10px] text-slate-500 font-medium">Care Demand</div>
              <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                {report.totals.totalEstimatedMonthlyMaintenanceMinutes !== null
                  ? `${report.totals.totalEstimatedMonthlyMaintenanceMinutes} m/mo`
                  : 'Incomplete'}
              </div>
            </div>
          </div>
        </div>

        {/* Status Toast / Stale Notice */}
        {statusMessage && (
          <div
            className={`p-3 rounded-lg border text-xs flex items-center justify-between ${
              statusMessage.kind === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : statusMessage.kind === 'error'
                ? 'bg-rose-50 border-rose-200 text-rose-900'
                : 'bg-sky-50 border-sky-200 text-sky-900'
            }`}
          >
            <span>{statusMessage.text}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="text-xs font-semibold underline ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {report.isP38LinkStale && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">P38 Daylight Change Detected:</span>{' '}
              {report.staleReasons.join(' ')}
            </div>
          </div>
        )}
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (5 cols): Room Inventory & 2D Floor-Plan Coordination Diagram */}
        <div className="lg:col-span-5 space-y-6">
          {/* Room Inventory Table */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">Room Plantscape Inventory</h2>
              <span className="text-xs text-slate-500">
                {report.roomEvaluations.length} Rooms Evaluated
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] text-slate-500">
                    <th className="py-2 pr-2 font-semibold">Room</th>
                    <th className="py-2 px-2 font-semibold">P38 Mean DF</th>
                    <th className="py-2 px-2 font-semibold">Elements</th>
                    <th className="py-2 pl-2 font-semibold">Suitability</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.roomEvaluations.map((rm) => {
                    const isSelected = rm.roomId === activeRoomEval?.roomId;
                    return (
                      <tr
                        key={rm.roomId}
                        onClick={() => {
                          setSelectedRoomId(rm.roomId);
                          setSelectedPlacementId(rm.placements[0]?.placementId || null);
                        }}
                        className={`cursor-pointer transition-colors ${
                          isSelected ? 'bg-emerald-50/80 font-medium' : 'hover:bg-slate-50'
                        }`}
                      >
                        <td className="py-2.5 pr-2 text-slate-900">
                          <div>{rm.roomName}</div>
                          <div className="text-[10px] text-slate-500">
                            {rm.roomFloorAreaM2} m² · Fl {rm.floorLevel}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 tabular-nums text-slate-700">
                          {rm.p38MeanDaylightFactorPercent !== null
                            ? `${rm.p38MeanDaylightFactorPercent}%`
                            : 'Missing'}
                        </td>
                        <td className="py-2.5 px-2 tabular-nums text-slate-700">
                          {rm.livingPlantCount}L / {rm.nonLivingFeatureCount}NL
                          {rm.conflicts.length > 0 && (
                            <span className="block text-[10px] text-amber-700">
                              {rm.conflicts.length} warning(s)
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 pl-2 text-[11px] text-slate-700">
                          {formatSuitabilityLabel(rm.roomSuitabilitySummary)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2D Room Floor-Plan & Plantscape Coordination SVG */}
          {activeFloorPlanRoom && activeRoomEval && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-slate-900">
                    2D Spatial &amp; Daylight Coordination — {activeFloorPlanRoom.name}
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    {activeFloorPlanRoom.width} × {activeFloorPlanRoom.length} {unitSuffix} ·
                    Shows P38 daylight points, P33 furniture/doors, and P39 container + mature
                    footprints
                  </p>
                </div>
              </div>

              <div className="bg-slate-50 rounded-lg border border-slate-200 p-3 flex items-center justify-center">
                {(() => {
                  const svgW = 360;
                  const svgH = 260;
                  const pad = 28;
                  const rW = Math.max(1, activeFloorPlanRoom.width);
                  const rL = Math.max(1, activeFloorPlanRoom.length);
                  const scale = Math.min((svgW - pad * 2) / rW, (svgH - pad * 2) / rL);
                  const drawW = rW * scale;
                  const drawH = rL * scale;
                  const ox = (svgW - drawW) / 2;
                  const oy = (svgH - drawH) / 2;

                  const roomFurn = (p33Data.instances || []).filter(
                    (f) => f.roomId === activeFloorPlanRoom.id
                  );
                  const roomDoors = (p33Data.knownOpenings || []).filter(
                    (o) =>
                      o.roomId === activeFloorPlanRoom.id &&
                      (o.type === 'door' || o.type === 'open-passage')
                  );

                  return (
                    <svg
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      className="w-full h-auto max-h-72 select-none"
                      role="img"
                      aria-label={`2D plantscape coordination plan for ${activeFloorPlanRoom.name}`}
                    >
                      {/* Room Boundary */}
                      <rect
                        x={ox}
                        y={oy}
                        width={drawW}
                        height={drawH}
                        fill="#ffffff"
                        stroke="#334155"
                        strokeWidth={2}
                      />

                      {/* P38 Daylight Grid Points */}
                      {(p38ActiveRoomEval?.geometry.analysisPoints || []).map((pt) => {
                        const px =
                          ox +
                          metresToProjectUnit(pt.localXMetres, project.unit) * scale;
                        const py =
                          oy +
                          metresToProjectUnit(pt.localYMetres, project.unit) * scale;
                        const df = pt.pointDaylightFactorProxyPercent ?? 0;
                        const color = pt.receivesDirectSunInScenario
                          ? '#f59e0b'
                          : df >= 2.0
                          ? '#38bdf8'
                          : df >= 0.8
                          ? '#93c5fd'
                          : '#cbd5e1';
                        return (
                          <circle
                            key={pt.pointId}
                            cx={px}
                            cy={py}
                            r={3.5}
                            fill={color}
                            opacity={0.75}
                          >
                            <title>
                              P38 Point DF: {pt.pointDaylightFactorProxyPercent ?? 'N/A'}% | Direct Sun:{' '}
                              {pt.receivesDirectSunInScenario ? 'Yes' : 'No'}
                            </title>
                          </circle>
                        );
                      })}

                      {/* P33 Door Swing Zones */}
                      {roomDoors.map((op) => {
                        const swing =
                          op.swingDepth ?? op.width ?? (project.unit === 'feet' ? 3 : 0.9);
                        let dx = ox;
                        let dy = oy;
                        let dw = op.width * scale;
                        let dh = swing * scale;
                        if (op.wallEdge === 'north') {
                          dx = ox + op.offsetAlongWall * scale;
                          dy = oy;
                        } else if (op.wallEdge === 'south') {
                          dx = ox + op.offsetAlongWall * scale;
                          dy = oy + Math.max(0, rL - swing) * scale;
                        } else if (op.wallEdge === 'west') {
                          dx = ox;
                          dy = oy + op.offsetAlongWall * scale;
                          dw = swing * scale;
                          dh = op.width * scale;
                        } else {
                          dx = ox + Math.max(0, rW - swing) * scale;
                          dy = oy + op.offsetAlongWall * scale;
                          dw = swing * scale;
                          dh = op.width * scale;
                        }
                        return (
                          <rect
                            key={op.openingId}
                            x={dx}
                            y={dy}
                            width={dw}
                            height={dh}
                            fill="#fef3c7"
                            stroke="#d97706"
                            strokeDasharray="3 2"
                            strokeWidth={1}
                            opacity={0.7}
                          >
                            <title>P33 Door/Opening Zone: {op.label}</title>
                          </rect>
                        );
                      })}

                      {/* P33 Placed Furniture */}
                      {roomFurn.map((f) => {
                        const fxLocal =
                          f.x >= activeFloorPlanRoom.x &&
                          f.x <= activeFloorPlanRoom.x + rW
                            ? f.x - activeFloorPlanRoom.x
                            : f.x;
                        const fyLocal =
                          f.y >= activeFloorPlanRoom.y &&
                          f.y <= activeFloorPlanRoom.y + rL
                            ? f.y - activeFloorPlanRoom.y
                            : f.y;
                        const fx = ox + Math.max(0, Math.min(rW - f.width, fxLocal)) * scale;
                        const fy = oy + Math.max(0, Math.min(rL - f.depth, fyLocal)) * scale;
                        return (
                          <g key={f.instanceId}>
                            <rect
                              x={fx}
                              y={fy}
                              width={f.width * scale}
                              height={f.depth * scale}
                              fill="#e2e8f0"
                              stroke="#64748b"
                              strokeWidth={1}
                            />
                            <text
                              x={fx + (f.width * scale) / 2}
                              y={fy + (f.depth * scale) / 2 + 3}
                              textAnchor="middle"
                              fontSize="8"
                              fill="#334155"
                            >
                              {f.name.slice(0, 12)}
                            </text>
                          </g>
                        );
                      })}

                      {/* P39 Plantscape Placements (Mature dashed envelope + Container solid box) */}
                      {activeRoomEval.placements.map((pl) => {
                        const pe = activeRoomEval.placementEvaluations.find(
                          (e) => e.placementId === pl.placementId
                        );
                        const isSel = pl.placementId === selectedPlacement?.placementId;
                        const hasConflict = (pe?.conflicts.length || 0) > 0;
                        const cX = ox + pl.localX * scale;
                        const cY = oy + pl.localY * scale;
                        const cW = pl.containerWidth * scale;
                        const cD = pl.containerDepth * scale;
                        const mW = (pl.expectedMatureWidth ?? pl.containerWidth) * scale;
                        const mD = (pl.expectedMatureDepth ?? pl.containerDepth) * scale;

                        return (
                          <g
                            key={pl.placementId}
                            onClick={() => setSelectedPlacementId(pl.placementId)}
                            className="cursor-pointer"
                          >
                            {/* Expected Mature Canopy Envelope */}
                            <rect
                              x={cX}
                              y={cY}
                              width={mW}
                              height={mD}
                              fill={hasConflict ? '#fecdd3' : '#d1fae5'}
                              fillOpacity={0.45}
                              stroke={hasConflict ? '#e11d48' : '#059669'}
                              strokeDasharray="3 2"
                              strokeWidth={isSel ? 2 : 1}
                            />
                            {/* Container Footprint */}
                            <rect
                              x={cX}
                              y={cY}
                              width={cW}
                              height={cD}
                              fill={
                                pe?.isLivingPlant === false
                                  ? '#0d9488'
                                  : hasConflict
                                  ? '#be123c'
                                  : '#047857'
                              }
                              stroke={isSel ? '#0f172a' : '#ffffff'}
                              strokeWidth={isSel ? 2 : 1}
                              rx={2}
                            />
                            <text
                              x={cX + mW / 2}
                              y={cY + mD / 2 + 3}
                              textAnchor="middle"
                              fontSize="8"
                              fontWeight="bold"
                              fill="#064e3b"
                            >
                              {pl.label.slice(0, 14)}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  );
                })()}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-600">
                <span>Solid green: Container footprint</span>
                <span>·</span>
                <span>Dashed green: Mature canopy allowance</span>
                <span>·</span>
                <span>Grey: P33 furniture</span>
                <span>·</span>
                <span>Amber dashed: P33 door swing</span>
                <span>·</span>
                <span>Blue/Amber dots: P38 daylight &amp; direct sun</span>
              </div>
            </div>
          )}
        </div>

        {/* Right Column (7 cols): Tabbed Inspector */}
        <div className="lg:col-span-7 space-y-4">
          {/* Segmented Tab Controls */}
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg border border-slate-200">
            {(
              [
                { id: 'placements', label: '1. Room Placements & Suitability' },
                { id: 'catalog', label: '2. Plant & Element Catalog' },
                { id: 'maintenance', label: '3. Care & Maintenance' },
                { id: 'comparison', label: '4. Scenario Comparison' },
                { id: 'integration', label: '5. P30–P38 Coordination' },
              ] as Array<{ id: InspectorTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-2 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* TAB 1: ROOM PLACEMENTS & SUITABILITY */}
          {activeTab === 'placements' && activeRoomEval && (
            <div className="space-y-4">
              {/* Room Header & Quick Add */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      {activeRoomEval.roomName} — Plantscape Plan
                    </h2>
                    <div className="text-xs text-slate-500 mt-0.5">
                      P38 Mean DF:{' '}
                      {activeRoomEval.p38MeanDaylightFactorPercent !== null
                        ? `${activeRoomEval.p38MeanDaylightFactorPercent}%`
                        : 'Unavailable'}{' '}
                      · Direct Sun Coverage:{' '}
                      {activeRoomEval.p38DirectSunCoveragePercent !== null
                        ? `${activeRoomEval.p38DirectSunCoveragePercent}%`
                        : 'Unavailable'}{' '}
                      · Floor Occupied: {activeRoomEval.floorAreaOccupiedPercent}%
                    </div>
                  </div>
                  <button
                    onClick={() => setActiveTab('catalog')}
                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-200 rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 self-start"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add from Catalog</span>
                  </button>
                </div>

                {/* Placement Selector List */}
                {activeRoomEval.placements.length === 0 ? (
                  <div className="p-6 text-center bg-slate-50 rounded-lg border border-slate-200 space-y-2">
                    <p className="text-xs font-medium text-slate-700">
                      No plants or biophilic features placed in {activeRoomEval.roomName} under
                      this scenario.
                    </p>
                    <button
                      onClick={() => setActiveTab('catalog')}
                      className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Browse Plant &amp; Biophilic Catalog
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {activeRoomEval.placements.map((pl) => {
                        const isSel = pl.placementId === selectedPlacement?.placementId;
                        return (
                          <button
                            key={pl.placementId}
                            onClick={() => setSelectedPlacementId(pl.placementId)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                              isSel
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                            }`}
                          >
                            {pl.label} (×{pl.quantity})
                          </button>
                        );
                      })}
                    </div>

                    {/* Selected Placement Editor & Suitability Details */}
                    {selectedPlacement && selectedPlacementEval && (
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs text-slate-500">
                              {selectedPlacementEval.isLivingPlant
                                ? `Living Plant · ${selectedPlacementEval.scientificName || 'Species unverified'}`
                                : 'Non-Living Biophilic Feature'}{' '}
                              · Provenance: {selectedPlacement.provenance}
                            </div>
                            <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                              {selectedPlacement.label}
                            </h3>
                            <div className="text-xs font-semibold text-emerald-800 mt-1">
                              Suitability: {formatSuitabilityLabel(selectedPlacementEval.suitabilityStatus)} · Light:{' '}
                              {selectedPlacementEval.lightSuitabilityStatus}
                            </div>
                          </div>

                          <button
                            onClick={() => handleDeletePlacement(selectedPlacement.placementId)}
                            className="p-1.5 text-rose-700 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer"
                            title="Remove placement"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        {/* Coordinate & Dimension Controls */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Local X ({unitSuffix})
                            </label>
                            <input
                              type="number"
                              step="0.25"
                              value={selectedPlacement.localX}
                              onChange={(e) =>
                                handleUpdatePlacementField(selectedPlacement, {
                                  localX: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md tabular-nums"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Local Y ({unitSuffix})
                            </label>
                            <input
                              type="number"
                              step="0.25"
                              value={selectedPlacement.localY}
                              onChange={(e) =>
                                handleUpdatePlacementField(selectedPlacement, {
                                  localY: parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md tabular-nums"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Container W ({unitSuffix})
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={selectedPlacement.containerWidth}
                              onChange={(e) =>
                                handleUpdatePlacementField(selectedPlacement, {
                                  containerWidth: Math.max(0.1, parseFloat(e.target.value) || 0.5),
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md tabular-nums"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Container D ({unitSuffix})
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              min="0.1"
                              value={selectedPlacement.containerDepth}
                              onChange={(e) =>
                                handleUpdatePlacementField(selectedPlacement, {
                                  containerDepth: Math.max(0.1, parseFloat(e.target.value) || 0.5),
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md tabular-nums"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Mature W ({unitSuffix})
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              placeholder="Unknown"
                              value={selectedPlacement.expectedMatureWidth ?? ''}
                              onChange={(e) =>
                                handleUpdatePlacementField(selectedPlacement, {
                                  expectedMatureWidth:
                                    e.target.value === ''
                                      ? null
                                      : Math.max(0.1, parseFloat(e.target.value) || 0.5),
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md tabular-nums"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Mature D ({unitSuffix})
                            </label>
                            <input
                              type="number"
                              step="0.1"
                              placeholder="Unknown"
                              value={selectedPlacement.expectedMatureDepth ?? ''}
                              onChange={(e) =>
                                handleUpdatePlacementField(selectedPlacement, {
                                  expectedMatureDepth:
                                    e.target.value === ''
                                      ? null
                                      : Math.max(0.1, parseFloat(e.target.value) || 0.5),
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md tabular-nums"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Quantity
                            </label>
                            <input
                              type="number"
                              min="1"
                              max="50"
                              value={selectedPlacement.quantity}
                              onChange={(e) =>
                                handleUpdatePlacementField(selectedPlacement, {
                                  quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md tabular-nums"
                            />
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 mb-1">
                              Rotation
                            </label>
                            <select
                              value={selectedPlacement.rotationDeg}
                              onChange={(e) =>
                                handleUpdatePlacementField(selectedPlacement, {
                                  rotationDeg: parseInt(e.target.value, 10) || 0,
                                })
                              }
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded-md"
                            >
                              <option value={0}>0°</option>
                              <option value={90}>90°</option>
                              <option value={180}>180°</option>
                              <option value={270}>270°</option>
                            </select>
                          </div>
                        </div>

                        {/* Evidence & Non-Guarantee Disclosure */}
                        <div className="text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-200">
                          <div>
                            <span className="font-semibold text-slate-800">Evidence Summary:</span>{' '}
                            {selectedPlacementEval.evidenceSummary}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {selectedPlacementEval.daylightNonGuaranteeDisclosure}
                          </div>
                        </div>

                        {/* Missing Inputs & Conflicts on Selected Placement */}
                        {selectedPlacementEval.missingInputs.length > 0 && (
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
                            <div className="font-semibold">Incomplete / Missing Inputs:</div>
                            <ul className="list-disc pl-4 space-y-0.5">
                              {selectedPlacementEval.missingInputs.map((m, i) => (
                                <li key={i}>{m}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {selectedPlacementEval.conflicts.length > 0 && (
                          <div className="space-y-2">
                            <div className="text-xs font-bold text-slate-800">
                              Spatial, Daylight &amp; Safety Warnings (
                              {selectedPlacementEval.conflicts.length})
                            </div>
                            {selectedPlacementEval.conflicts.map((conf) => (
                              <div
                                key={conf.conflictId}
                                className={`p-3 rounded-lg border text-xs space-y-1 ${
                                  conf.severity === 'blocking-conflict'
                                    ? 'bg-rose-50 border-rose-200 text-rose-950'
                                    : 'bg-amber-50 border-amber-200 text-amber-950'
                                }`}
                              >
                                <div className="font-semibold flex items-center justify-between">
                                  <span>{conf.title}</span>
                                  <span className="text-[10px] uppercase">
                                    {conf.severity}
                                    {conf.relatedFeatureId ? ` · ${conf.relatedFeatureId}` : ''}
                                  </span>
                                </div>
                                <p>{conf.description}</p>
                                <div className="text-[11px] opacity-85">
                                  <span className="font-semibold">Remediation:</span>{' '}
                                  {conf.remediationHint}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Actionable Recommendations Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">
                    Actionable Plantscape Recommendations ({report.recommendations.length})
                  </h3>
                  {selectedRecIds.length > 0 && (
                    <button
                      onClick={() => handleGeneratePreview(selectedRecIds)}
                      className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
                    >
                      Preview Selected ({selectedRecIds.length})
                    </button>
                  )}
                </div>

                {report.recommendations.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    All rooms have suitable plantscape placements without active conflicts.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {report.recommendations.map((rec) => {
                      const checked = selectedRecIds.includes(rec.recommendationId);
                      return (
                        <div
                          key={rec.recommendationId}
                          className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 flex items-start justify-between gap-3 text-xs"
                        >
                          <label className="flex items-start gap-2.5 cursor-pointer flex-1">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleRecSelection(rec.recommendationId)}
                              className="mt-0.5 rounded border-slate-300"
                            />
                            <div className="space-y-1">
                              <div className="font-semibold text-slate-900">
                                {rec.title} · <span className="text-slate-500">{rec.roomName}</span>
                              </div>
                              <p className="text-slate-600">{rec.rationale}</p>
                              <div className="text-[11px] text-slate-500">
                                {rec.evidenceAndAssumptions}
                              </div>
                            </div>
                          </label>

                          <button
                            onClick={() => handleGeneratePreview([rec.recommendationId])}
                            className="px-2.5 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded-md text-xs font-semibold shrink-0 cursor-pointer"
                          >
                            Preview
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: PLANT & BIOPHILIC ELEMENT CATALOG */}
          {activeTab === 'catalog' && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Plant &amp; Biophilic Element Catalog ({filteredCatalog.length})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Distinguishes verified botanical records, non-living biophilic features, and
                    unverified user entries.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <select
                    value={catalogLivingFilter}
                    onChange={(e) => setCatalogLivingFilter(e.target.value as any)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md"
                  >
                    <option value="all">All Elements</option>
                    <option value="living">Living Plants Only</option>
                    <option value="non-living">Non-Living Features Only</option>
                  </select>

                  <select
                    value={catalogLightFilter}
                    onChange={(e) => setCatalogLightFilter(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md"
                  >
                    <option value="all">All Light Bands</option>
                    <option value="low-indirect-tolerant">Low Indirect Tolerant</option>
                    <option value="medium-bright-indirect">Medium Bright Indirect</option>
                    <option value="high-bright-with-some-direct">High Bright Daylight</option>
                    <option value="not-applicable-non-living">Non-Living (Zero Light)</option>
                  </select>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={catalogPetSafeOnly}
                      onChange={(e) => setCatalogPetSafeOnly(e.target.checked)}
                    />
                    <span>Verified Pet-Safe Only</span>
                  </label>
                </div>
              </div>

              <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
                {filteredCatalog.map((item) => (
                  <div
                    key={item.catalogId}
                    className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[11px] text-slate-500">
                          {item.isLivingPlant ? 'Living Botanical Specimen' : 'Non-Living Feature'} ·{' '}
                          {item.scientificName ? (
                            <span className="italic">{item.scientificName}</span>
                          ) : (
                            'Scientific name N/A or unverified'
                          )}{' '}
                          · Provenance: {item.provenance} · Completeness: {item.completeness}
                        </div>
                        <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                          {item.displayName}
                        </h3>
                      </div>

                      <button
                        onClick={() => handleAddCatalogItemToRoom(item)}
                        className="px-3 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg text-xs font-semibold shrink-0 cursor-pointer flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add to {activeFloorPlanRoom?.name || 'Room'}</span>
                      </button>
                    </div>

                    <p className="text-slate-600 leading-relaxed">{item.description}</p>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[11px] text-slate-700">
                      <div>
                        <span className="text-slate-500 block">Container (m):</span>
                        <span className="font-semibold">
                          {item.defaultContainerWidthMetres}×{item.defaultContainerDepthMetres}×
                          {item.defaultContainerHeightMetres} m
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Mature Spread (m):</span>
                        <span className="font-semibold">
                          {item.expectedMatureWidthRangeMetres
                            ? `${item.expectedMatureWidthRangeMetres.min}–${item.expectedMatureWidthRangeMetres.max} m`
                            : 'Unknown'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Light &amp; Min DF:</span>
                        <span className="font-semibold">
                          {item.lightRequirementBand} (
                          {item.referenceDaylightFactorMinPercent !== null
                            ? `>= ${item.referenceDaylightFactorMinPercent}% DF`
                            : 'N/A'}
                          )
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Safety / Toxicity:</span>
                        <span className="font-semibold">{item.toxicityStatus}</span>
                      </div>
                    </div>

                    {item.verticalInstallationRequirements && (
                      <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-950">
                        <span className="font-semibold">Vertical Installation Notice:</span>{' '}
                        {
                          item.verticalInstallationRequirements
                            .structuralAndWaterproofingDisclaimer
                        }
                      </div>
                    )}

                    {item.evidenceSource && (
                      <div className="text-[11px] text-slate-500">
                        Source: {item.evidenceSource.publisher} — {item.evidenceSource.title} (Reviewed{' '}
                        {item.evidenceSource.lastReviewedDate})
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Custom User Catalog Item Form */}
              <form
                onSubmit={handleAddCustomCatalogEntry}
                className="pt-4 border-t border-slate-200 space-y-3 text-xs"
              >
                <h3 className="text-xs font-bold text-slate-900">
                  Add User-Provided Plant or Element Record
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <input
                    type="text"
                    placeholder="Display Name (required)"
                    value={newSpeciesName}
                    onChange={(e) => setNewSpeciesName(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md"
                  />
                  <input
                    type="text"
                    placeholder="Scientific Name (if known)"
                    value={newScientificName}
                    onChange={(e) => setNewScientificName(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md"
                  />
                  <select
                    value={newLightBand}
                    onChange={(e) => setNewLightBand(e.target.value as PlantLightRequirementBand)}
                    className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-md"
                  >
                    <option value="low-indirect-tolerant">Low Indirect Light</option>
                    <option value="medium-bright-indirect">Medium Bright Light</option>
                    <option value="high-bright-with-some-direct">High Bright Light</option>
                    <option value="unknown">Unknown Light Need</option>
                  </select>
                  <button
                    type="submit"
                    className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-md font-semibold cursor-pointer"
                  >
                    Add Custom Record
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: CARE & MAINTENANCE PLANNER */}
          {activeTab === 'maintenance' && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-5">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Care &amp; Maintenance Planner
                </h2>
                <p className="text-xs text-slate-500">
                  Deterministic care guidance based on verified catalog requirements and project
                  settings. Watering is never prescribed as a rigid universal schedule.
                </p>
              </div>

              {/* Project Maintenance Settings */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Occupant Maintenance Tolerance
                  </label>
                  <select
                    value={report.maintenanceSettings.userMaintenanceTolerance}
                    onChange={(e) =>
                      handleUpdateMaintenanceSettings({
                        userMaintenanceTolerance: e.target.value as any,
                      })
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-md"
                  >
                    <option value="low">Low (Drought-tolerant &amp; non-living preferred)</option>
                    <option value="moderate">Moderate (Weekly/bi-weekly substrate checks)</option>
                    <option value="high-dedicated">
                      High / Dedicated Specialist (Supports living walls)
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Max Room Floor Occupancy Threshold (%)
                  </label>
                  <input
                    type="number"
                    min="2"
                    max="40"
                    value={report.maintenanceSettings.maxFloorAreaOccupancyPercentThreshold}
                    onChange={(e) =>
                      handleUpdateMaintenanceSettings({
                        maxFloorAreaOccupancyPercentThreshold:
                          parseFloat(e.target.value) || 12,
                      })
                    }
                    className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-md tabular-nums"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={report.maintenanceSettings.hasPetsOrYoungChildren}
                    onChange={(e) =>
                      handleUpdateMaintenanceSettings({
                        hasPetsOrYoungChildren: e.target.checked,
                      })
                    }
                  />
                  <span className="font-medium text-slate-800">
                    Household / Space Includes Pets or Young Children (Flag toxic species)
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      report.maintenanceSettings.allowSupplementalGrowLightingAssumption
                    }
                    onChange={(e) =>
                      handleUpdateMaintenanceSettings({
                        allowSupplementalGrowLightingAssumption: e.target.checked,
                      })
                    }
                  />
                  <span className="font-medium text-slate-800">
                    Assume Supplemental Grow Lighting in Low-Daylight Rooms
                  </span>
                </label>
              </div>

              {/* Task List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-900">
                    Scheduled Care &amp; Inspection Tasks ({report.allMaintenanceTasks.length})
                  </span>
                  <span className="text-slate-600">
                    Total Est. Time:{' '}
                    <strong>
                      {report.totals.totalEstimatedMonthlyMaintenanceMinutes !== null
                        ? `${report.totals.totalEstimatedMonthlyMaintenanceMinutes} min/month`
                        : 'Incomplete (unverified species)'}
                    </strong>
                  </span>
                </div>

                {report.allMaintenanceTasks.map((task) => (
                  <div
                    key={task.taskId}
                    className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900">
                        {task.elementName} · {task.roomName}
                      </span>
                      <span className="text-[11px] text-slate-600 tabular-nums">
                        {task.estimatedMinutesPerMonth !== null
                          ? `~${task.estimatedMinutesPerMonth} min/mo`
                          : 'Duration unknown'}
                      </span>
                    </div>
                    <div className="text-emerald-800 font-medium">
                      {task.recommendedCadenceLabel}
                    </div>
                    <p className="text-slate-700">{task.guidanceText}</p>
                    <div className="text-[11px] text-slate-500">
                      <span className="font-semibold">Condition Variability:</span>{' '}
                      {task.conditionalVariabilityDisclosure}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 4: SCENARIO COMPARISON */}
          {activeTab === 'comparison' && report.scenarioComparison && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Side-by-Side Plantscape Scenario Comparison
                </h2>
                <p className="text-xs text-slate-500">
                  Comparing <strong>{report.scenarioComparison.scenarioAName}</strong> vs.{' '}
                  <strong>{report.scenarioComparison.scenarioBName}</strong>
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 pr-3 font-semibold">Metric</th>
                      <th className="py-2 px-3 font-semibold">
                        {report.scenarioComparison.scenarioAName}
                      </th>
                      <th className="py-2 px-3 font-semibold">
                        {report.scenarioComparison.scenarioBName}
                      </th>
                      <th className="py-2 pl-3 font-semibold">Delta (B − A)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 tabular-nums">
                    <tr>
                      <td className="py-2 pr-3 font-medium text-slate-800">Living Plants Count</td>
                      <td className="py-2 px-3">{report.scenarioComparison.metrics.livingPlantCountA}</td>
                      <td className="py-2 px-3">{report.scenarioComparison.metrics.livingPlantCountB}</td>
                      <td className="py-2 pl-3 font-semibold">
                        {report.scenarioComparison.metrics.deltaLivingPlantCount >= 0 ? '+' : ''}
                        {report.scenarioComparison.metrics.deltaLivingPlantCount}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        Non-Living Biophilic Features
                      </td>
                      <td className="py-2 px-3">
                        {report.scenarioComparison.metrics.nonLivingFeatureCountA}
                      </td>
                      <td className="py-2 px-3">
                        {report.scenarioComparison.metrics.nonLivingFeatureCountB}
                      </td>
                      <td className="py-2 pl-3 font-semibold">
                        {report.scenarioComparison.metrics.deltaNonLivingFeatureCount >= 0
                          ? '+'
                          : ''}
                        {report.scenarioComparison.metrics.deltaNonLivingFeatureCount}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        Container Floor Area Occupied (m²)
                      </td>
                      <td className="py-2 px-3">
                        {report.scenarioComparison.metrics.floorAreaOccupiedM2A} m²
                      </td>
                      <td className="py-2 px-3">
                        {report.scenarioComparison.metrics.floorAreaOccupiedM2B} m²
                      </td>
                      <td className="py-2 pl-3 font-semibold">
                        {report.scenarioComparison.metrics.deltaFloorAreaOccupiedM2 >= 0
                          ? '+'
                          : ''}
                        {report.scenarioComparison.metrics.deltaFloorAreaOccupiedM2} m²
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        Circulation &amp; Accessibility Warnings
                      </td>
                      <td className="py-2 px-3">
                        {
                          report.scenarioComparison.metrics
                            .circulationAndAccessibilityWarningsCountA
                        }
                      </td>
                      <td className="py-2 px-3">
                        {
                          report.scenarioComparison.metrics
                            .circulationAndAccessibilityWarningsCountB
                        }
                      </td>
                      <td className="py-2 pl-3 font-semibold">
                        {report.scenarioComparison.metrics.deltaWarningsCount}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        Suitable Placements Count
                      </td>
                      <td className="py-2 px-3">
                        {report.scenarioComparison.metrics.suitablePlacementsCountA}
                      </td>
                      <td className="py-2 px-3">
                        {report.scenarioComparison.metrics.suitablePlacementsCountB}
                      </td>
                      <td className="py-2 pl-3">
                        {report.scenarioComparison.metrics.suitablePlacementsCountB -
                          report.scenarioComparison.metrics.suitablePlacementsCountA}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-3 font-medium text-slate-800">
                        Estimated Care Demand (min/month)
                      </td>
                      <td className="py-2 px-3">
                        {report.scenarioComparison.metrics.estimatedMonthlyMaintenanceMinutesA ??
                          'Incomplete'}
                      </td>
                      <td className="py-2 px-3">
                        {report.scenarioComparison.metrics.estimatedMonthlyMaintenanceMinutesB ??
                          'Incomplete'}
                      </td>
                      <td className="py-2 pl-3 font-semibold">
                        {report.scenarioComparison.metrics.deltaMonthlyMaintenanceMinutes !== null
                          ? `${report.scenarioComparison.metrics.deltaMonthlyMaintenanceMinutes} min/mo`
                          : 'N/A'}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Explicit Unquantified Benefits Guardrail Box */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1.5">
                <div className="font-bold text-slate-900">
                  Unquantified Outcomes Disclosure (Anti-Overclaim Guardrail)
                </div>
                <p className="text-slate-600">
                  {report.scenarioComparison.unquantifiedBenefitDisclosures.explanation}
                </p>
                <div className="text-[11px] text-slate-500">
                  Wellbeing Score: <code>null (unquantified)</code> · Productivity Gain:{' '}
                  <code>null (unquantified)</code> · Air Purification VOC Rate:{' '}
                  <code>null (unquantified)</code> · Energy Savings:{' '}
                  <code>null (unquantified)</code>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: P30–P38 CROSS-FEATURE COORDINATION */}
          {activeTab === 'integration' && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4 text-xs">
              <h2 className="text-base font-bold text-slate-900">
                P30–P38 Cross-System Coordination Status
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900">P38 Daylight &amp; Visual Comfort</div>
                  <p className="text-slate-600">
                    Scenario: {report.crossFeatureIntegration.p38DaylightIntegrationStatus.p38ActiveScenarioName} ·{' '}
                    {report.crossFeatureIntegration.p38DaylightIntegrationStatus.roomsWithCalculatedDaylightCount} rooms with Mode C DF.
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {report.crossFeatureIntegration.p38DaylightIntegrationStatus.daylightNonGuaranteeNote}
                  </p>
                  {onNavigateTab && (
                    <button
                      onClick={() => onNavigateTab('daylight-comfort')}
                      className="text-emerald-800 font-semibold underline cursor-pointer mt-1"
                    >
                      Open P38 Daylight Analyzer →
                    </button>
                  )}
                </div>

                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900">P33 Furniture &amp; Circulation</div>
                  <p className="text-slate-600">
                    Checked {report.crossFeatureIntegration.p33FurnitureAndCirculationStatus.checkedFurnitureItemsCount} furniture items &amp;{' '}
                    {report.crossFeatureIntegration.p33FurnitureAndCirculationStatus.checkedDoorOpeningsCount} door openings ·{' '}
                    {report.crossFeatureIntegration.p33FurnitureAndCirculationStatus.circulationConflictsCount} conflict(s).
                  </p>
                  {onNavigateTab && (
                    <button
                      onClick={() => onNavigateTab('furniture-circulation')}
                      className="text-emerald-800 font-semibold underline cursor-pointer mt-1"
                    >
                      Open P33 Furniture &amp; Circulation →
                    </button>
                  )}
                </div>

                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900">P34 Universal Accessibility</div>
                  <p className="text-slate-600">
                    {report.crossFeatureIntegration.p34AccessibilityStatus.nonCertificationDisclaimer}
                  </p>
                  <div className="text-[11px] text-slate-500">
                    Flagged route conflicts:{' '}
                    {report.crossFeatureIntegration.p34AccessibilityStatus.accessibilityConflictsCount}
                  </div>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900">P37 Natural Ventilation</div>
                  <p className="text-slate-600">
                    Checked {report.crossFeatureIntegration.p37VentilationCoordinationStatus.checkedVentilationOpeningsCount} ventilation openings ·{' '}
                    {report.crossFeatureIntegration.p37VentilationCoordinationStatus.ventilationObstructionConflictsCount} obstruction warning(s).
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900">P35 Materials &amp; P36 Acoustics</div>
                  <p className="text-slate-600">
                    {report.crossFeatureIntegration.p36AcousticCoordinationStatus.acousticNote}
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
                  <div className="font-bold text-slate-900">P30 Evidence &amp; P31 Comparison</div>
                  <p className="text-slate-600">
                    {report.crossFeatureIntegration.p30ComplianceSeparationNote}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Non-Destructive Preview Modal */}
      {previewDiff && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full p-6 shadow-xl space-y-4 max-h-[85vh] overflow-y-auto text-xs">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <div className="text-[11px] font-semibold text-emerald-800">
                  Non-Destructive Preview Diff
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  {previewDiff.title}
                </h3>
              </div>
              <button
                onClick={() => setPreviewDiff(null)}
                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-md font-semibold cursor-pointer"
              >
                Close
              </button>
            </div>

            {previewDiff.placementDiffs.length > 0 && (
              <div className="space-y-2">
                <div className="font-bold text-slate-900">Proposed Placement Changes:</div>
                {previewDiff.placementDiffs.map((pd) => (
                  <div
                    key={pd.placementId}
                    className="p-2.5 bg-slate-50 rounded-lg border border-slate-200"
                  >
                    <div className="font-semibold text-slate-800">
                      [{pd.changeType.toUpperCase()}] {pd.roomName}
                    </div>
                    <div className="text-slate-600">
                      Before: {pd.beforeSummary} → After: {pd.afterSummary}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <div className="font-bold text-slate-900">Room Impact Summary:</div>
              {previewDiff.roomImpactSummaries
                .filter(
                  (ri) =>
                    ri.beforePlantCount !== ri.afterPlantCount ||
                    ri.beforeConflictsCount !== ri.afterConflictsCount ||
                    ri.beforeSuitability !== ri.afterSuitability
                )
                .map((ri) => (
                  <div
                    key={ri.roomId}
                    className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 flex items-center justify-between"
                  >
                    <span className="font-semibold text-slate-800">{ri.roomName}</span>
                    <span className="text-slate-600">
                      Elements: {ri.beforePlantCount} → {ri.afterPlantCount} · Conflicts:{' '}
                      {ri.beforeConflictsCount} → {ri.afterConflictsCount}
                    </span>
                  </div>
                ))}
            </div>

            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-950">
              P38 Daylight Preserved Unmodified:{' '}
              <strong>{previewDiff.p38AssessmentsPreservedUnmodified ? 'Yes' : 'No'}</strong> · P33/P34
              Preserved: <strong>{previewDiff.p33AndP34PreservedUnmodified ? 'Yes' : 'No'}</strong> ·
              Pre-apply snapshot checkpoint will be recorded before atomic apply.
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                onClick={() => setPreviewDiff(null)}
                className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyPreview}
                disabled={!previewDiff.isSafeToApply}
                className="px-4 py-2 bg-emerald-800 hover:bg-emerald-900 disabled:opacity-50 text-white rounded-lg font-semibold cursor-pointer"
              >
                Confirm Atomic Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
