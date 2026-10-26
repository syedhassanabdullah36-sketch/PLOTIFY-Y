/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P37 — Natural Ventilation Scenario Analyzer Workspace
 * Account A | Locked Roadmap: P37 of P30–P40
 */

import React, { useState, useMemo } from 'react';
import {
  Wind,
  ArrowLeft,
  Compass,
  CheckCircle2,
  AlertTriangle,
  Info,
  Sliders,
  Layers,
  Eye,
  RotateCcw,
  Plus,
  Trash2,
  Scale,
  BookOpen,
  ShieldAlert,
  Volume2,
  Sun,
  Accessibility,
  Armchair,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { Project, MeasurementUnit } from '../../types/project';
import {
  NaturalVentilationScenario,
  OpeningBoundaryLocation,
  OpeningMechanismType,
  OpeningOperabilityStatus,
  ScenarioOpeningState,
  VentilationAssessmentMode,
  VentilationCompletenessState,
  VentilationEvaluationStatus,
  VentilationOpeningCategory,
  VentilationOpeningRecord,
  VentilationProposalPreviewDiff,
  WallCardinalEdge,
} from '../../types/naturalVentilation';
import {
  applyVentilationProposalAtomically,
  computeNaturalVentilationSourceFingerprint,
  evaluateProjectNaturalVentilation,
  initializeProjectNaturalVentilationData,
  P37_TECHNICAL_REFERENCES,
  previewVentilationRecommendation,
  rollbackLastVentilationApply,
  round2,
} from '../../services/naturalVentilationService';

interface NaturalVentilationWorkspaceProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onNavigateTab?: (tab: string) => void;
}

type WorkspaceSubTab =
  | 'overview-and-paths'
  | 'openings-and-geometry'
  | 'scenarios-and-comparison'
  | 'tradeoffs-and-recommendations'
  | 'technical-and-integrations';

export const NaturalVentilationWorkspace: React.FC<NaturalVentilationWorkspaceProps> = ({
  project,
  onUpdateProject,
  onNavigateTab,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<WorkspaceSubTab>('overview-and-paths');
  const [previewDiff, setPreviewDiff] = useState<VentilationProposalPreviewDiff | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // New opening form state
  const [newOpLabel, setNewOpLabel] = useState('New Exterior Casement Window');
  const [newOpCategory, setNewOpCategory] = useState<VentilationOpeningCategory>('window');
  const [newOpBoundary, setNewOpBoundary] = useState<OpeningBoundaryLocation>('exterior-envelope');
  const [newOpWallEdge, setNewOpWallEdge] = useState<WallCardinalEdge>('south');
  const [newOpOperability, setNewOpOperability] = useState<OpeningOperabilityStatus>('operable');
  const [newOpMechanism, setNewOpMechanism] = useState<OpeningMechanismType>('casement-side-hung');
  const [newOpWidth, setNewOpWidth] = useState<string>(project.unit === 'feet' ? '4.0' : '1.2');
  const [newOpHeight, setNewOpHeight] = useState<string>(project.unit === 'feet' ? '4.5' : '1.4');
  const [newOpFraction, setNewOpFraction] = useState<string>('0.65');
  const [newOpSill, setNewOpSill] = useState<string>(project.unit === 'feet' ? '3.0' : '0.9');
  const [newOpCd, setNewOpCd] = useState<string>('0.62');

  const report = useMemo(() => evaluateProjectNaturalVentilation(project), [project]);
  const nvData = useMemo(() => initializeProjectNaturalVentilationData(project), [project]);
  const rooms = project.floorPlan?.rooms || [];
  const activeRoomEval = report.activeRoomEvaluation;
  const activeScenario = report.activeScenario;
  const comparisonScenario = report.comparisonScenario;

  const commitNaturalVentilationData = (
    updater: (draft: ReturnType<typeof initializeProjectNaturalVentilationData>) => void,
    toastText?: string
  ) => {
    const draft = JSON.parse(
      JSON.stringify(initializeProjectNaturalVentilationData(project))
    ) as ReturnType<typeof initializeProjectNaturalVentilationData>;
    updater(draft);
    draft.isConfigured = true;
    draft.requestSequenceId = (draft.requestSequenceId || 1) + 1;
    draft.lastEvaluatedAt = new Date().toISOString();

    const updatedProject: Project = {
      ...project,
      naturalVentilation: draft,
      updatedAt: new Date().toISOString(),
    };
    draft.lastSourceFingerprint = computeNaturalVentilationSourceFingerprint(
      updatedProject,
      draft
    );
    onUpdateProject(updatedProject);
    if (toastText) {
      setBannerMessage({ type: 'success', text: toastText });
    }
  };

  const handleSelectRoom = (roomId: string) => {
    setPreviewDiff(null);
    commitNaturalVentilationData((draft) => {
      draft.selectedRoomId = roomId;
    });
  };

  const handleSelectActiveScenario = (scenarioId: string) => {
    setPreviewDiff(null);
    commitNaturalVentilationData((draft) => {
      draft.activeScenarioId = scenarioId;
    });
  };

  const handleSelectComparisonScenario = (scenarioId: string) => {
    commitNaturalVentilationData((draft) => {
      draft.comparisonScenarioId = scenarioId;
    });
  };

  const handleUpdateRoomCeilingHeight = (roomId: string, valStr: string) => {
    const parsed = valStr.trim() === '' ? null : Number(valStr);
    commitNaturalVentilationData(
      (draft) => {
        const existingCfg = draft.roomConfigs[roomId] || {
          roomId,
          ceilingHeight: null,
          heightUnit: project.unit,
          ceilingHeightProvenance: 'unavailable-or-unverified',
          occupancyCountAssumption: null,
          occupancyProvenance: 'unavailable-or-unverified',
          hasVerticalAtriumOrStackConnection: false,
          verticalStackOutletElevationMetres: null,
          verticalStackOutletFreeAreaM2: null,
          updatedAt: new Date().toISOString(),
        };
        draft.roomConfigs[roomId] = {
          ...existingCfg,
          ceilingHeight: parsed !== null && Number.isFinite(parsed) && parsed > 0 ? parsed : null,
          heightUnit: project.unit,
          ceilingHeightProvenance:
            parsed !== null && Number.isFinite(parsed) && parsed > 0
              ? 'user-entered'
              : 'unavailable-or-unverified',
          updatedAt: new Date().toISOString(),
        };
      },
      'Updated room ceiling height.'
    );
  };

  const handleUpdateRoomOccupancy = (roomId: string, valStr: string) => {
    const parsed = valStr.trim() === '' ? null : Number(valStr);
    commitNaturalVentilationData(
      (draft) => {
        if (!draft.roomConfigs[roomId]) return;
        draft.roomConfigs[roomId].occupancyCountAssumption =
          parsed !== null && Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
        draft.roomConfigs[roomId].occupancyProvenance =
          parsed !== null && Number.isFinite(parsed) && parsed > 0
            ? 'user-entered'
            : 'unavailable-or-unverified';
      },
      'Updated room design occupancy count.'
    );
  };

  const handleAddOpening = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoomEval) return;
    const w = Number(newOpWidth);
    const h = newOpHeight.trim() === '' ? null : Number(newOpHeight);
    const frac = newOpFraction.trim() === '' ? null : Number(newOpFraction);
    const sill = newOpSill.trim() === '' ? null : Number(newOpSill);
    const cd = newOpCd.trim() === '' ? null : Number(newOpCd);

    const newOp: VentilationOpeningRecord = {
      openingId: `p37-user-op-${Date.now()}`,
      roomId: activeRoomEval.roomId,
      label: newOpLabel.trim() || `${newOpWallEdge.toUpperCase()} ${newOpCategory}`,
      category: newOpCategory,
      boundaryLocation: newOpBoundary,
      wallEdge: newOpWallEdge,
      floorLevel: activeRoomEval.floorLevel,
      operabilityStatus: newOpOperability,
      operabilityProvenance: 'user-entered',
      mechanismType: newOpMechanism,
      grossWidth: Number.isFinite(w) && w > 0 ? w : null,
      grossHeight: h !== null && Number.isFinite(h) && h > 0 ? h : null,
      dimensionUnit: project.unit,
      dimensionProvenance: 'user-entered',
      explicitClearOpenableAreaInUnitSq: null,
      maxOpenableFraction:
        newOpOperability === 'fixed'
          ? 0
          : frac !== null && Number.isFinite(frac) && frac >= 0 && frac <= 1
          ? frac
          : null,
      openableFractionProvenance: 'user-entered',
      screenOrGrilleFactor: 0.9,
      obstructionFactor: 1.0,
      sillElevation: sill !== null && Number.isFinite(sill) && sill >= 0 ? sill : null,
      headElevation: null,
      elevationProvenance: 'user-entered',
      dischargeCoefficientCd:
        cd !== null && Number.isFinite(cd) && cd > 0 && cd <= 1 ? cd : null,
      cdProvenance: 'user-entered',
      defaultScenarioState: newOpOperability === 'operable' ? 'fully-open' : 'closed',
      defaultScenarioOpenFraction: newOpOperability === 'operable' ? 1.0 : 0.0,
      rainProtectionKind: 'protected-by-overhang-or-louvre',
      hasSecurityRestrictorOrNightLatch: true,
    };

    commitNaturalVentilationData((draft) => {
      draft.openings.push(newOp);
    }, `Added opening "${newOp.label}" to ${activeRoomEval.roomName}.`);
  };

  const handleDeleteOpening = (openingId: string) => {
    commitNaturalVentilationData((draft) => {
      draft.openings = draft.openings.filter((o) => o.openingId !== openingId);
    }, 'Removed opening record.');
  };

  const handleToggleOpeningScenarioState = (
    openingId: string,
    newState: ScenarioOpeningState
  ) => {
    commitNaturalVentilationData((draft) => {
      const scen = draft.scenarios.find((s) => s.scenarioId === draft.activeScenarioId);
      if (scen) {
        scen.openingStateOverrides[openingId] = {
          state: newState,
          openFraction:
            newState === 'closed' ? 0 : newState === 'partially-open' ? 0.5 : 1.0,
        };
      }
      const op = draft.openings.find((o) => o.openingId === openingId);
      if (op) {
        op.defaultScenarioState = newState;
        op.defaultScenarioOpenFraction =
          newState === 'closed' ? 0 : newState === 'partially-open' ? 0.5 : 1.0;
      }
    });
  };

  const handleQuickConfigureOpening = (openingId: string) => {
    commitNaturalVentilationData((draft) => {
      const op = draft.openings.find((o) => o.openingId === openingId);
      if (!op) return;
      op.operabilityStatus = 'operable';
      op.operabilityProvenance = 'user-entered';
      op.mechanismType = op.category === 'door' ? 'hinged-door' : 'casement-side-hung';
      if (op.grossHeight === null) {
        op.grossHeight =
          op.category === 'door'
            ? project.unit === 'feet'
              ? 6.8
              : 2.1
            : project.unit === 'feet'
            ? 4.5
            : 1.4;
        op.dimensionProvenance = 'user-entered';
      }
      if (op.maxOpenableFraction === null) {
        op.maxOpenableFraction = op.category === 'door' ? 0.9 : 0.65;
        op.openableFractionProvenance = 'user-entered';
      }
      if (op.sillElevation === null) {
        op.sillElevation = op.category === 'door' ? 0 : project.unit === 'feet' ? 3.0 : 0.9;
        op.elevationProvenance = 'user-entered';
      }
      if (op.dischargeCoefficientCd === null) {
        op.dischargeCoefficientCd = 0.62;
        op.cdProvenance = 'traceable-technical-reference';
      }
      op.defaultScenarioState = 'fully-open';
      op.defaultScenarioOpenFraction = 1.0;
    }, 'Configured 3D height, operability, and C_d for opening.');
  };

  const handleUpdateScenarioEnv = (
    patch: Partial<NaturalVentilationScenario['environmentalConditions']>
  ) => {
    commitNaturalVentilationData((draft) => {
      const scen = draft.scenarios.find((s) => s.scenarioId === draft.activeScenarioId);
      if (!scen) return;
      scen.environmentalConditions = {
        ...scen.environmentalConditions,
        ...patch,
      };
    });
  };

  const handlePreviewRecommendation = (recommendationId: string) => {
    const diff = previewVentilationRecommendation(project, recommendationId);
    setPreviewDiff(diff);
  };

  const handleApplyPreview = () => {
    if (!previewDiff) return;
    const res = applyVentilationProposalAtomically(project, previewDiff);
    if (res.applied) {
      onUpdateProject(res.updatedProject);
      setPreviewDiff(null);
      setBannerMessage({ type: 'success', text: res.message });
    } else {
      setBannerMessage({ type: 'error', text: res.message });
    }
  };

  const handleRollbackLastApply = () => {
    const res = rollbackLastVentilationApply(project);
    if (res.rolledBack) {
      onUpdateProject(res.restoredProject);
      setPreviewDiff(null);
      setBannerMessage({ type: 'warning', text: res.message });
    } else {
      setBannerMessage({ type: 'error', text: res.message });
    }
  };

  const getStatusBadgeStyle = (status: VentilationEvaluationStatus) => {
    switch (status) {
      case 'favorable-for-scenario':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'conditional-or-constrained':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'concern-identified':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      case 'insufficient-evidence':
      default:
        return 'bg-slate-100 text-slate-700 border-slate-300';
    }
  };

  const getModeLabel = (mode: VentilationAssessmentMode) => {
    switch (mode) {
      case 'mode-a-geometric-potential':
        return 'Mode A: Geometric Potential';
      case 'mode-b-qualitative-path-screening':
        return 'Mode B: Qualitative Path Screening';
      case 'mode-c-quantified-preliminary-estimate':
        return 'Mode C: Quantified Preliminary Estimate';
      case 'mode-d-scenario-comparison':
        return 'Mode D: Scenario Comparison';
      case 'mode-e-insufficient-data-guidance':
        return 'Mode E: Insufficient-Data Guidance';
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {onNavigateTab && (
              <button
                onClick={() => onNavigateTab('overview')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 mr-2 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Project Overview</span>
              </button>
            )}
            <span className="px-2 py-0.5 rounded-md bg-teal-100 text-teal-900 font-bold text-[10px] uppercase tracking-wider border border-teal-200">
              P37 Engine · Account A
            </span>
            <span className="text-xs text-slate-500 font-mono">
              {report.calculationModelVersion}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <Wind className="w-6 h-6 text-teal-600" />
            <span>Natural Ventilation Scenario Analyzer</span>
          </h1>
          <p className="text-xs text-slate-600 max-w-3xl">
            Evaluate room-level and multi-room airflow paths (single-sided, cross-ventilation, stack buoyancy), inspect gross vs. scenario-effective free opening area (<span className="font-mono">A_eff</span>), compute preliminary steady-state orifice airflow &amp; ACH under explicit scenario assumptions, and audit multidisciplinary constraints (P30–P36).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {nvData.lastPreApplySnapshotId && (
            <button
              onClick={handleRollbackLastApply}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              title="Restore project to pre-P37-apply checkpoint"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
              <span>Rollback Last Apply</span>
            </button>
          )}
          {onNavigateTab && (
            <>
              <button
                onClick={() => onNavigateTab('acoustic-comfort')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <Volume2 className="w-3.5 h-3.5 text-indigo-700" />
                <span>P36 Acoustics</span>
              </button>
              <button
                onClick={() => onNavigateTab('climate-material-advisor')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 rounded-lg text-xs font-semibold cursor-pointer"
              >
                <Sun className="w-3.5 h-3.5 text-teal-700" />
                <span>P35 Climate Materials</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {bannerMessage && (
        <div
          className={`p-3.5 rounded-xl border flex items-center justify-between text-xs font-medium ${
            bannerMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : bannerMessage.type === 'warning'
              ? 'bg-amber-50 border-amber-200 text-amber-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{bannerMessage.text}</span>
          </div>
          <button
            onClick={() => setBannerMessage(null)}
            className="text-[11px] underline ml-4 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Honest Scope & Anti-CFD Disclosure Banner */}
      <div className="bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed text-slate-300">
            <strong className="text-white">Engineering Scope &amp; Provenance Guarantee:</strong>{' '}
            {report.professionalDisclaimer}
          </div>
        </div>
        <span className="px-2.5 py-1 rounded-md bg-slate-800 text-teal-300 text-[11px] font-mono shrink-0 border border-slate-700">
          No CFD / No Weather Fabrication
        </span>
      </div>

      {/* Room & Scenario Selector Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Active Room Under Analysis
          </label>
          <select
            value={activeRoomEval?.roomId || ''}
            onChange={(e) => handleSelectRoom(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
          >
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (Floor {r.floorLevel} · {r.width}×{r.length} {project.unit})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Active Operating Scenario
          </label>
          <select
            value={activeScenario.scenarioId}
            onChange={(e) => handleSelectActiveScenario(e.target.value)}
            className="w-full px-3 py-2 bg-teal-50/60 border border-teal-300 rounded-lg text-xs font-semibold text-teal-950"
          >
            {report.allScenarios.map((scen) => (
              <option key={scen.scenarioId} value={scen.scenarioId}>
                {scen.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
            Comparison Scenario (Mode D)
          </label>
          <select
            value={comparisonScenario?.scenarioId || ''}
            onChange={(e) => handleSelectComparisonScenario(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800"
          >
            {report.allScenarios.map((scen) => (
              <option key={scen.scenarioId} value={scen.scenarioId}>
                {scen.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Active Room Summary Header Strip */}
      {activeRoomEval && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">
                  {activeRoomEval.roomName}
                </h2>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${getStatusBadgeStyle(
                    activeRoomEval.overallStatus
                  )}`}
                >
                  {activeRoomEval.overallStatus.replace(/-/g, ' ').toUpperCase()}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-teal-50 text-teal-800 border border-teal-200">
                  {getModeLabel(activeRoomEval.primaryAssessmentMode)}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-slate-100 text-slate-700 border border-slate-200">
                  Completeness: {activeRoomEval.completenessState} ({activeRoomEval.evidenceCoveragePercent}%)
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Dominant Strategy in <strong>{activeScenario.name}</strong>:{' '}
                <strong className="text-slate-800 uppercase">
                  {activeRoomEval.dominantStrategy.replace(/-/g, ' ')}
                </strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  'mode-a-geometric-potential',
                  'mode-b-qualitative-path-screening',
                  'mode-c-quantified-preliminary-estimate',
                  'mode-e-insufficient-data-guidance',
                ] as VentilationAssessmentMode[]
              ).map((m) => {
                const isActive = activeRoomEval.supportedModes.includes(m);
                return (
                  <span
                    key={m}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                      isActive
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : 'bg-slate-50 text-slate-400 border-slate-200'
                    }`}
                  >
                    {m.split('-').slice(0, 2).join(' ').toUpperCase()}: {isActive ? 'ACTIVE' : 'WITHHELD'}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Key Metric Highlights */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[10px] font-bold text-slate-400 uppercase">Floor Area &amp; Volume</div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                {activeRoomEval.geometry.floorAreaM2 ?? '—'} m²
              </div>
              <div className="text-[11px] text-slate-500">
                Volume V:{' '}
                {activeRoomEval.geometry.roomVolumeM3 !== null
                  ? `${activeRoomEval.geometry.roomVolumeM3} m³`
                  : 'Height unset'}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[10px] font-bold text-slate-400 uppercase">
                Effective Free Area (A_eff)
              </div>
              <div className="text-sm font-bold text-teal-800 mt-0.5 tabular-nums">
                {activeRoomEval.modeA_GeometricPotential.totalScenarioEffectiveFreeAreaM2 !== null
                  ? `${activeRoomEval.modeA_GeometricPotential.totalScenarioEffectiveFreeAreaM2} m²`
                  : 'Incomplete'}
              </div>
              <div className="text-[11px] text-slate-500">
                Max Openable:{' '}
                {activeRoomEval.modeA_GeometricPotential.totalMaxOpenableAreaM2 !== null
                  ? `${activeRoomEval.modeA_GeometricPotential.totalMaxOpenableAreaM2} m² (${activeRoomEval.modeA_GeometricPotential.maxOpenableToFloorAreaPercent}%)`
                  : 'N/A'}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[10px] font-bold text-slate-400 uppercase">
                Wind Flow (Q_wind)
              </div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                {activeRoomEval.modeC_QuantifiedEstimate.windDriven.flowRateLitresPerSec !== null
                  ? `${activeRoomEval.modeC_QuantifiedEstimate.windDriven.flowRateLitresPerSec} L/s`
                  : 'Withheld'}
              </div>
              <div className="text-[11px] text-slate-500">
                ΔP_wind:{' '}
                {activeRoomEval.modeC_QuantifiedEstimate.windDriven.deltaPWindPascals !== null
                  ? `${activeRoomEval.modeC_QuantifiedEstimate.windDriven.deltaPWindPascals} Pa`
                  : 'N/A'}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80">
              <div className="text-[10px] font-bold text-slate-400 uppercase">
                Stack Flow (Q_stack)
              </div>
              <div className="text-sm font-bold text-slate-900 mt-0.5 tabular-nums">
                {activeRoomEval.modeC_QuantifiedEstimate.stackDriven.flowRateLitresPerSec !== null
                  ? `${activeRoomEval.modeC_QuantifiedEstimate.stackDriven.flowRateLitresPerSec} L/s`
                  : 'Withheld'}
              </div>
              <div className="text-[11px] text-slate-500">
                ΔP_stack:{' '}
                {activeRoomEval.modeC_QuantifiedEstimate.stackDriven.deltaPStackPascals !== null
                  ? `${activeRoomEval.modeC_QuantifiedEstimate.stackDriven.deltaPStackPascals} Pa`
                  : 'No Δh / ΔT'}
              </div>
            </div>

            <div className="p-3 rounded-lg bg-teal-50/70 border border-teal-200">
              <div className="text-[10px] font-bold text-teal-800 uppercase">
                Combined Q &amp; Preliminary ACH
              </div>
              <div className="text-sm font-bold text-teal-950 mt-0.5 tabular-nums">
                {activeRoomEval.modeC_QuantifiedEstimate.estimatedAch !== null
                  ? `${activeRoomEval.modeC_QuantifiedEstimate.estimatedAch} ACH (h⁻¹)`
                  : activeRoomEval.modeC_QuantifiedEstimate.combinedFlowRateLitresPerSec !== null
                  ? `${activeRoomEval.modeC_QuantifiedEstimate.combinedFlowRateLitresPerSec} L/s (Need H)`
                  : 'Withheld'}
              </div>
              <div className="text-[11px] text-teal-800">
                {activeRoomEval.modeC_QuantifiedEstimate.combinedFlowRateM3PerSec !== null
                  ? `Q = ${activeRoomEval.modeC_QuantifiedEstimate.combinedFlowRateM3PerSec} m³/s`
                  : 'Configure openings & H'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {[
          {
            id: 'overview-and-paths' as WorkspaceSubTab,
            label: '1. Conceptual Path Diagram & Modes A–C',
            icon: Compass,
          },
          {
            id: 'openings-and-geometry' as WorkspaceSubTab,
            label: `2. Openings & Room Geometry (${activeRoomEval?.evaluatedOpenings.length || 0})`,
            icon: Sliders,
          },
          {
            id: 'scenarios-and-comparison' as WorkspaceSubTab,
            label: '3. Scenario Lab & Mode D Comparison',
            icon: Scale,
          },
          {
            id: 'tradeoffs-and-recommendations' as WorkspaceSubTab,
            label: `4. Trade-Offs & Recommendations (${activeRoomEval?.domainH_Recommendations.length || 0})`,
            icon: Sparkles,
          },
          {
            id: 'technical-and-integrations' as WorkspaceSubTab,
            label: '5. Equations, Citations & P30–P36 Ledger',
            icon: BookOpen,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                active
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${active ? 'text-teal-400' : 'text-slate-400'}`} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: Overview & Conceptual Path Diagram */}
      {activeSubTab === 'overview-and-paths' && activeRoomEval && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left 6 cols: Conceptual SVG Airflow Path Diagram */}
          <div className="lg:col-span-6 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Conceptual 2D Airflow Path Diagram
                </h3>
                <p className="text-[11px] text-slate-500">
                  Schematic representation of facade exposures, opening states, and candidate flow paths
                </p>
              </div>
              <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 text-[10px] font-bold">
                Conceptual Schematic — Not CFD
              </span>
            </div>

            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 flex flex-col items-center">
              <svg
                viewBox="0 0 400 280"
                className="w-full max-w-md h-64"
                role="img"
                aria-label="Conceptual Airflow Path Schematic"
              >
                <defs>
                  <marker
                    id="arrow-wind"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#2dd4bf" />
                  </marker>
                  <marker
                    id="arrow-stack"
                    viewBox="0 0 10 10"
                    refX="6"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
                  </marker>
                </defs>

                {/* Compass Indicator */}
                <g transform="translate(350, 40)">
                  <circle cx="0" cy="0" r="20" fill="#0f172a" stroke="#334155" strokeWidth="1.5" />
                  <text x="0" y="-7" textAnchor="middle" fill="#2dd4bf" fontSize="9" fontWeight="bold">
                    N ({activeRoomEval.geometry.northOrientationOffsetDeg}°)
                  </text>
                  <line x1="0" y1="10" x2="0" y2="-4" stroke="#2dd4bf" strokeWidth="1.5" />
                </g>

                {/* Wind Direction Indicator */}
                {activeScenario.environmentalConditions.windSpeedMetresPerSec !== null && (
                  <g transform="translate(55, 42)">
                    <rect
                      x="-45"
                      y="-18"
                      width="105"
                      height="34"
                      rx="6"
                      fill="#0f172a"
                      stroke="#1e293b"
                    />
                    <text x="-38" y="-3" fill="#94a3b8" fontSize="8" fontWeight="bold">
                      SCENARIO WIND
                    </text>
                    <text x="-38" y="9" fill="#2dd4bf" fontSize="9" fontWeight="bold">
                      {activeScenario.environmentalConditions.windSpeedMetresPerSec} m/s @{' '}
                      {activeScenario.environmentalConditions.windDirectionDegFromNorth ?? 0}°
                    </text>
                  </g>
                )}

                {/* Room Box (x=90..310, y=65..215) */}
                <rect
                  x="90"
                  y="65"
                  width="220"
                  height="150"
                  fill="#1e293b"
                  stroke="#475569"
                  strokeWidth="3"
                  rx="4"
                />

                {/* Highlight Exterior Wall Edges in Teal */}
                {activeRoomEval.geometry.exteriorWallEdges.includes('north') && (
                  <line x1="90" y1="65" x2="310" y2="65" stroke="#14b8a6" strokeWidth="5" />
                )}
                {activeRoomEval.geometry.exteriorWallEdges.includes('south') && (
                  <line x1="90" y1="215" x2="310" y2="215" stroke="#14b8a6" strokeWidth="5" />
                )}
                {activeRoomEval.geometry.exteriorWallEdges.includes('west') && (
                  <line x1="90" y1="65" x2="90" y2="215" stroke="#14b8a6" strokeWidth="5" />
                )}
                {activeRoomEval.geometry.exteriorWallEdges.includes('east') && (
                  <line x1="310" y1="65" x2="310" y2="215" stroke="#14b8a6" strokeWidth="5" />
                )}

                {/* Wall Labels */}
                <text x="200" y="55" textAnchor="middle" fill="#cbd5e1" fontSize="9">
                  NORTH ({activeRoomEval.geometry.exteriorWallEdges.includes('north') ? 'Exterior' : 'Shared Interior'})
                </text>
                <text x="200" y="232" textAnchor="middle" fill="#cbd5e1" fontSize="9">
                  SOUTH ({activeRoomEval.geometry.exteriorWallEdges.includes('south') ? 'Exterior' : 'Shared Interior'})
                </text>
                <text x="48" y="142" textAnchor="middle" fill="#cbd5e1" fontSize="9">
                  WEST
                </text>
                <text x="352" y="142" textAnchor="middle" fill="#cbd5e1" fontSize="9">
                  EAST
                </text>

                {/* Render Openings along Walls */}
                {activeRoomEval.evaluatedOpenings.map((op, idx) => {
                  const isOpen =
                    op.operabilityStatus === 'operable' &&
                    op.scenarioState !== 'closed' &&
                    op.scenarioOpenFraction > 0;
                  const color =
                    op.operabilityStatus === 'unknown'
                      ? '#f59e0b'
                      : isOpen
                      ? '#34d399'
                      : '#ef4444';

                  let cx = 200;
                  let cy = 65;
                  if (op.wallEdge === 'north') {
                    cx = 140 + (idx % 3) * 55;
                    cy = 65;
                  } else if (op.wallEdge === 'south') {
                    cx = 140 + (idx % 3) * 55;
                    cy = 215;
                  } else if (op.wallEdge === 'west') {
                    cx = 90;
                    cy = 105 + (idx % 3) * 35;
                  } else if (op.wallEdge === 'east') {
                    cx = 310;
                    cy = 105 + (idx % 3) * 35;
                  }

                  return (
                    <g key={op.openingId}>
                      <circle
                        cx={cx}
                        cy={cy}
                        r="8"
                        fill={color}
                        stroke="#0f172a"
                        strokeWidth="2"
                      />
                      <text
                        x={cx}
                        y={cy + 18}
                        textAnchor="middle"
                        fill="#e2e8f0"
                        fontSize="8"
                      >
                        {op.label.slice(0, 14)}
                      </text>
                    </g>
                  );
                })}

                {/* Conceptual Airflow Path Arrows */}
                {activeRoomEval.discoveredAirflowPaths.map((p, idx) => {
                  const yOffset = 115 + idx * 24;
                  const strokeColor = !p.isPathActiveInScenario
                    ? '#ef4444'
                    : p.strategyType === 'stack-buoyancy'
                    ? '#f59e0b'
                    : '#2dd4bf';
                  return (
                    <g key={p.pathId}>
                      <line
                        x1="120"
                        y1={yOffset}
                        x2="280"
                        y2={p.strategyType === 'stack-buoyancy' ? yOffset - 22 : yOffset}
                        stroke={strokeColor}
                        strokeWidth="2.5"
                        strokeDasharray={p.isPathActiveInScenario ? 'none' : '4 4'}
                        markerEnd={
                          p.strategyType === 'stack-buoyancy'
                            ? 'url(#arrow-stack)'
                            : 'url(#arrow-wind)'
                        }
                      />
                      <text
                        x="200"
                        y={yOffset - 6}
                        textAnchor="middle"
                        fill={strokeColor}
                        fontSize="8.5"
                        fontWeight="bold"
                      >
                        {p.strategyType.toUpperCase()} ({p.isPathActiveInScenario ? 'ACTIVE' : 'BLOCKED'})
                      </text>
                    </g>
                  );
                })}
              </svg>

              <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-slate-300 mt-2">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                  Operable &amp; Open in Scenario
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                  Unknown Operability / Missing Height
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
                  Closed or Fixed Opening
                </span>
              </div>
            </div>

            {/* Missing Evidence Guidance List (Mode E) */}
            {activeRoomEval.missingEvidenceGuidance.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-950">
                  <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                  <span>Missing Evidence &amp; Parameter Guidance (Mode E)</span>
                </div>
                <ul className="list-disc list-inside space-y-1 text-xs text-amber-900">
                  {activeRoomEval.missingEvidenceGuidance.map((msg, i) => (
                    <li key={i}>{msg}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Right 6 cols: Mode A, Mode B Paths, and Mode C Quantified Breakdown */}
          <div className="lg:col-span-6 space-y-4">
            {/* Mode A Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  Mode A — Geometric Ventilation Potential
                </h3>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getStatusBadgeStyle(
                    activeRoomEval.modeA_GeometricPotential.geometricPotentialStatus
                  )}`}
                >
                  {activeRoomEval.modeA_GeometricPotential.geometricPotentialStatus}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {activeRoomEval.modeA_GeometricPotential.explanation}
              </p>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">
                    Gross Opening Area
                  </div>
                  <div className="font-bold text-slate-800 mt-0.5">
                    {activeRoomEval.modeA_GeometricPotential.totalGrossOpeningAreaM2} m²
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">
                    Max Openable Ratio
                  </div>
                  <div className="font-bold text-slate-800 mt-0.5">
                    {activeRoomEval.modeA_GeometricPotential.maxOpenableToFloorAreaPercent !== null
                      ? `${activeRoomEval.modeA_GeometricPotential.maxOpenableToFloorAreaPercent}%`
                      : 'Incomplete'}
                  </div>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <div className="text-[10px] text-slate-400 font-semibold uppercase">
                    Max Vertical Δh
                  </div>
                  <div className="font-bold text-slate-800 mt-0.5">
                    {activeRoomEval.modeA_GeometricPotential.maxVerticalOpeningSeparationMetres !== null
                      ? `${activeRoomEval.modeA_GeometricPotential.maxVerticalOpeningSeparationMetres} m`
                      : '0 / Single level'}
                  </div>
                </div>
              </div>
            </div>

            {/* Mode B Discovered Airflow Paths */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                Mode B — Discovered Airflow Paths ({activeRoomEval.discoveredAirflowPaths.length})
              </h3>
              {activeRoomEval.discoveredAirflowPaths.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No active or candidate airflow paths identified yet. Configure operable exterior or internal openings in Tab 2 or apply a starter recommendation in Tab 4.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {activeRoomEval.discoveredAirflowPaths.map((path) => (
                    <div
                      key={path.pathId}
                      className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                        path.isPathActiveInScenario
                          ? 'bg-teal-50/40 border-teal-200'
                          : 'bg-rose-50/40 border-rose-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-900 uppercase">
                          {path.strategyType.replace(/-/g, ' ')}
                        </span>
                        <span className="font-mono text-[11px] text-slate-600">
                          Series (C_d·A_eff):{' '}
                          {path.effectiveSeriesConductanceCdAM2 !== null
                            ? `${path.effectiveSeriesConductanceCdAM2} m²`
                            : 'N/A'}
                        </span>
                      </div>
                      <p className="text-slate-700">{path.explanation}</p>
                      <p className="text-[11px] text-slate-500">{path.depthToHeightExplanation}</p>
                      {path.internalDoorPrivacyTradeOffWarning && (
                        <div className="p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                          <strong>P36 Privacy Note:</strong> {path.internalDoorPrivacyTradeOffWarning}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Mode C Quantified Preliminary Estimate Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900">
                  Mode C — Quantified Preliminary Orifice Airflow Estimate
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                  {activeRoomEval.modeC_QuantifiedEstimate.isQuantifiedEstimateAvailable
                    ? 'Active'
                    : 'Withheld'}
                </span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                {activeRoomEval.modeC_QuantifiedEstimate.explanation}
              </p>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-[11px] space-y-1 text-slate-600">
                <div>
                  <strong>Combination Method:</strong>{' '}
                  {activeRoomEval.modeC_QuantifiedEstimate.combinationMethodUsed}
                </div>
                <div>
                  <strong>Per-Occupant Flow:</strong>{' '}
                  {activeRoomEval.modeC_QuantifiedEstimate.estimatedLitresPerSecPerPerson !== null
                    ? `${activeRoomEval.modeC_QuantifiedEstimate.estimatedLitresPerSecPerPerson} L/(s·person) (Advisory target >= ${activeRoomEval.modeC_QuantifiedEstimate.perPersonCriterion.minTarget} L/(s·person))`
                    : 'Specify room occupancy count in Tab 2 to compute L/(s·person)'}
                </div>
                <div>
                  <strong>Per-Floor-Area Flow:</strong>{' '}
                  {activeRoomEval.modeC_QuantifiedEstimate.estimatedLitresPerSecPerM2 !== null
                    ? `${activeRoomEval.modeC_QuantifiedEstimate.estimatedLitresPerSecPerM2} L/(s·m²)`
                    : 'N/A'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Openings & Room Geometry Editor */}
      {activeSubTab === 'openings-and-geometry' && activeRoomEval && (
        <div className="space-y-6">
          {/* Room 3D Height & Occupancy Editor */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Room 3D Height &amp; Design Occupancy Configuration ({activeRoomEval.roomName})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ceiling Height ({project.unit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1"
                  value={nvData.roomConfigs[activeRoomEval.roomId]?.ceilingHeight ?? ''}
                  placeholder={`e.g. ${project.unit === 'feet' ? '9.5' : '2.9'}`}
                  onChange={(e) =>
                    handleUpdateRoomCeilingHeight(activeRoomEval.roomId, e.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
                <span className="text-[11px] text-slate-500 block mt-1">
                  Provenance:{' '}
                  <strong className="font-mono">
                    {activeRoomEval.geometry.ceilingHeightProvenance}
                  </strong>
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Expected Occupant Count (persons)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={nvData.roomConfigs[activeRoomEval.roomId]?.occupancyCountAssumption ?? ''}
                  placeholder="e.g. 2"
                  onChange={(e) =>
                    handleUpdateRoomOccupancy(activeRoomEval.roomId, e.target.value)
                  }
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                />
                <span className="text-[11px] text-slate-500 block mt-1">
                  Used for preliminary L/(s·person) screening.
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
                <div className="font-bold text-slate-800">Derived SI Room Geometry</div>
                <div>
                  Plan: {activeRoomEval.geometry.widthMetres} m ×{' '}
                  {activeRoomEval.geometry.lengthMetres} m ={' '}
                  <strong>{activeRoomEval.geometry.floorAreaM2} m²</strong>
                </div>
                <div>
                  Volume V:{' '}
                  <strong>
                    {activeRoomEval.geometry.roomVolumeM3 !== null
                      ? `${activeRoomEval.geometry.roomVolumeM3} m³`
                      : 'Requires ceiling height'}
                  </strong>
                </div>
                <div>
                  Exterior Walls:{' '}
                  <strong>
                    {activeRoomEval.geometry.exteriorWallEdges.join(', ').toUpperCase() || 'None'}
                  </strong>
                </div>
              </div>
            </div>
          </div>

          {/* Existing Openings Table for Active Room */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Configured &amp; P33-Synced Openings in {activeRoomEval.roomName}
                </h3>
                <p className="text-xs text-slate-500">
                  P37 strictly separates gross opening area from clear openable area and active scenario effective free area (A_eff).
                </p>
              </div>
            </div>

            {activeRoomEval.evaluatedOpenings.length === 0 ? (
              <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-500">
                No openings are defined for this room yet. Use the form below to add an exterior window, door, clerestory vent, or internal transfer grille.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] text-slate-500 uppercase">
                      <th className="py-2 pr-3">Opening &amp; Wall</th>
                      <th className="py-2 px-3">Operability &amp; Mechanism</th>
                      <th className="py-2 px-3">Gross &amp; Max Openable</th>
                      <th className="py-2 px-3">Scenario State &amp; A_eff</th>
                      <th className="py-2 px-3">Sill / Centroid / C_d</th>
                      <th className="py-2 pl-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeRoomEval.evaluatedOpenings.map((op) => (
                      <tr key={op.openingId} className="hover:bg-slate-50/80">
                        <td className="py-3 pr-3">
                          <div className="font-bold text-slate-900">{op.label}</div>
                          <div className="text-[11px] text-slate-500">
                            {op.wallEdge.toUpperCase()} ({op.compassAzimuthDeg}°) ·{' '}
                            {op.boundaryLocation}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              op.operabilityStatus === 'operable'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : op.operabilityStatus === 'fixed'
                                ? 'bg-slate-100 text-slate-700'
                                : 'bg-amber-50 text-amber-800 border border-amber-200'
                            }`}
                          >
                            {op.operabilityStatus}
                          </span>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {op.mechanismType}
                          </div>
                        </td>
                        <td className="py-3 px-3 tabular-nums">
                          <div>
                            Gross: {op.grossWidthMetres ?? '?'}×{op.grossHeightMetres ?? '?'} m (
                            {op.grossAreaM2 !== null ? `${op.grossAreaM2} m²` : 'Need H'})
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Max Openable:{' '}
                            {op.maxOpenableAreaM2 !== null ? `${op.maxOpenableAreaM2} m²` : 'N/A'}
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <select
                            value={op.scenarioState}
                            onChange={(e) =>
                              handleToggleOpeningScenarioState(
                                op.openingId,
                                e.target.value as ScenarioOpeningState
                              )
                            }
                            className="px-2 py-1 border border-slate-300 rounded text-xs font-semibold bg-white"
                          >
                            <option value="fully-open">Fully Open (100%)</option>
                            <option value="partially-open">Partially Open (50%)</option>
                            <option value="closed">Closed (0%)</option>
                          </select>
                          <div className="text-[11px] font-bold text-teal-800 mt-1 tabular-nums">
                            A_eff:{' '}
                            {op.effectiveScenarioFreeAreaM2 !== null
                              ? `${op.effectiveScenarioFreeAreaM2} m²`
                              : 'Unknown'}
                          </div>
                        </td>
                        <td className="py-3 px-3 tabular-nums text-[11px]">
                          <div>
                            Sill: {op.sillElevationMetres ?? '—'} m | z_c:{' '}
                            {op.centroidElevationAboveFloorMetres ?? '—'} m
                          </div>
                          <div>
                            C_d: {op.dischargeCoefficientCd ?? 'Unset'} | C_d·A_eff:{' '}
                            {op.cdTimesEffectiveAreaM2 ?? '—'} m²
                          </div>
                        </td>
                        <td className="py-3 pl-3 text-right space-x-2">
                          {(op.operabilityStatus === 'unknown' ||
                            op.grossHeightMetres === null ||
                            op.dischargeCoefficientCd === null) && (
                            <button
                              onClick={() => handleQuickConfigureOpening(op.openingId)}
                              className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-[11px] font-semibold cursor-pointer"
                            >
                              Complete 3D Specs
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteOpening(op.openingId)}
                            className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer"
                            title="Delete opening"
                          >
                            <Trash2 className="w-4 h-4 inline" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Add New Opening Form */}
          <form
            onSubmit={handleAddOpening}
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Plus className="w-4 h-4 text-teal-600" />
              <span>Add Ventilation Opening to {activeRoomEval.roomName}</span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Label</label>
                <input
                  type="text"
                  value={newOpLabel}
                  onChange={(e) => setNewOpLabel(e.target.value)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Category</label>
                <select
                  value={newOpCategory}
                  onChange={(e) =>
                    setNewOpCategory(e.target.value as VentilationOpeningCategory)
                  }
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="window">Window</option>
                  <option value="door">Door</option>
                  <option value="louvre">Louvre</option>
                  <option value="vent">High-Level Clerestory / Vent</option>
                  <option value="trickle-vent">Trickle Vent</option>
                  <option value="skylight">Operable Skylight</option>
                  <option value="stack-outlet">Stack Outlet</option>
                  <option value="internal-transfer-opening">Internal Transfer Grille / Undercut</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Boundary</label>
                <select
                  value={newOpBoundary}
                  onChange={(e) =>
                    setNewOpBoundary(e.target.value as OpeningBoundaryLocation)
                  }
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="exterior-envelope">Exterior Envelope</option>
                  <option value="interior-partition">Interior Partition (Multi-Room)</option>
                  <option value="roof-or-atrium">Roof / Atrium Stack</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Wall Orientation</label>
                <select
                  value={newOpWallEdge}
                  onChange={(e) => setNewOpWallEdge(e.target.value as WallCardinalEdge)}
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="north">North Wall</option>
                  <option value="south">South Wall</option>
                  <option value="east">East Wall</option>
                  <option value="west">West Wall</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Operability Status</label>
                <select
                  value={newOpOperability}
                  onChange={(e) =>
                    setNewOpOperability(e.target.value as OpeningOperabilityStatus)
                  }
                  className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="operable">Operable</option>
                  <option value="fixed">Fixed (Non-Operable)</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Gross Width &amp; Height ({project.unit})
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    step="0.1"
                    value={newOpWidth}
                    onChange={(e) => setNewOpWidth(e.target.value)}
                    placeholder="Width"
                    className="w-1/2 px-2 py-1.5 border border-slate-300 rounded-lg"
                  />
                  <input
                    type="number"
                    step="0.1"
                    value={newOpHeight}
                    onChange={(e) => setNewOpHeight(e.target.value)}
                    placeholder="Height"
                    className="w-1/2 px-2 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Openable Fraction (0–1) &amp; Sill ({project.unit})
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={newOpFraction}
                    onChange={(e) => setNewOpFraction(e.target.value)}
                    placeholder="Frac"
                    className="w-1/2 px-2 py-1.5 border border-slate-300 rounded-lg"
                  />
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={newOpSill}
                    onChange={(e) => setNewOpSill(e.target.value)}
                    placeholder="Sill"
                    className="w-1/2 px-2 py-1.5 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Discharge Coeff (C_d)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.1"
                    max="1.0"
                    value={newOpCd}
                    onChange={(e) => setNewOpCd(e.target.value)}
                    className="w-24 px-2 py-1.5 border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    className="flex-1 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg cursor-pointer"
                  >
                    + Add Opening
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* TAB 3: Scenario & Environmental Conditions Lab + Mode D Comparison */}
      {activeSubTab === 'scenarios-and-comparison' && activeRoomEval && (
        <div className="space-y-6">
          {/* Active Scenario Environmental Parameters Editor */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Scenario Environmental &amp; Operating Conditions: {activeScenario.name}
                </h3>
                <p className="text-xs text-slate-500">
                  All environmental inputs carry explicit provenance ({activeScenario.environmentalConditions.provenance}) and are never fabricated from city names or P35 climate regimes.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Wind Speed v (m/s)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  value={activeScenario.environmentalConditions.windSpeedMetresPerSec ?? ''}
                  onChange={(e) =>
                    handleUpdateScenarioEnv({
                      windSpeedMetresPerSec:
                        e.target.value === '' ? null : Number(e.target.value),
                      windSpeedProvenance: 'user-entered',
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Wind Direction (° from True North)
                </label>
                <input
                  type="number"
                  step="15"
                  min="0"
                  max="359"
                  value={activeScenario.environmentalConditions.windDirectionDegFromNorth ?? ''}
                  onChange={(e) =>
                    handleUpdateScenarioEnv({
                      windDirectionDegFromNorth:
                        e.target.value === '' ? null : Number(e.target.value),
                      windDirectionProvenance: 'user-entered',
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Indoor Temp T_in (°C)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={activeScenario.environmentalConditions.indoorTempCelsius ?? ''}
                  onChange={(e) =>
                    handleUpdateScenarioEnv({
                      indoorTempCelsius: e.target.value === '' ? null : Number(e.target.value),
                      temperatureProvenance: 'user-entered',
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Outdoor Temp T_out (°C)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={activeScenario.environmentalConditions.outdoorTempCelsius ?? ''}
                  onChange={(e) =>
                    handleUpdateScenarioEnv({
                      outdoorTempCelsius: e.target.value === '' ? null : Number(e.target.value),
                      temperatureProvenance: 'user-entered',
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Assumed ΔC_p (Windward–Leeward)
                </label>
                <input
                  type="number"
                  step="0.05"
                  min="0.05"
                  max="1.5"
                  value={activeScenario.environmentalConditions.assumedDeltaCp ?? ''}
                  onChange={(e) =>
                    handleUpdateScenarioEnv({
                      assumedDeltaCp: e.target.value === '' ? null : Number(e.target.value),
                      deltaCpProvenance: 'user-entered',
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Outdoor Noise Condition
                </label>
                <select
                  value={activeScenario.environmentalConditions.outdoorNoiseCondition}
                  onChange={(e) =>
                    handleUpdateScenarioEnv({
                      outdoorNoiseCondition: e.target
                        .value as NaturalVentilationScenario['environmentalConditions']['outdoorNoiseCondition'],
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="quiet">Quiet Rural / Courtyard</option>
                  <option value="moderate-urban">Moderate Urban Street</option>
                  <option value="high-traffic-or-plant-noise">High Traffic / Plant Noise</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Outdoor Air Quality (IAQ)
                </label>
                <select
                  value={activeScenario.environmentalConditions.outdoorAirQualityCondition}
                  onChange={(e) =>
                    handleUpdateScenarioEnv({
                      outdoorAirQualityCondition: e.target
                        .value as NaturalVentilationScenario['environmentalConditions']['outdoorAirQualityCondition'],
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="clean-ambient">Clean Ambient Air</option>
                  <option value="moderate-pollen-or-urban">Moderate Pollen / Urban</option>
                  <option value="poor-smoke-or-pollution-event">Poor (Smoke / Pollution Event)</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Wind + Stack Combination Rule
                </label>
                <select
                  value={activeScenario.environmentalConditions.combinedDrivingForceMethod}
                  onChange={(e) =>
                    handleUpdateScenarioEnv({
                      combinedDrivingForceMethod: e.target
                        .value as NaturalVentilationScenario['environmentalConditions']['combinedDrivingForceMethod'],
                    })
                  }
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                >
                  <option value="quadrature-flow-combination">
                    Quadrature Superposition: √(Q_wind² + Q_stack²)
                  </option>
                  <option value="dominant-mechanism-conservative">
                    Dominant Mechanism: max(Q_wind, Q_stack)
                  </option>
                </select>
              </div>
            </div>
          </div>

          {/* Mode D Side-by-Side Scenario Comparison */}
          {report.activeRoomScenarioComparison && report.comparisonRoomEvaluation && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Mode D — Side-by-Side Scenario Comparison ({activeRoomEval.roomName})
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {report.activeRoomScenarioComparison.comparisonSummaryExplanation}
                  </p>
                </div>
                <span className="px-2.5 py-1 rounded bg-teal-50 text-teal-900 border border-teal-200 text-xs font-bold">
                  Mode D Active
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] text-slate-500 uppercase">
                      <th className="py-2 pr-4">Ventilation Metric</th>
                      <th className="py-2 px-4 bg-teal-50/40">
                        Active: {report.activeRoomScenarioComparison.baselineScenarioName}
                      </th>
                      <th className="py-2 px-4 bg-slate-50">
                        Compared: {report.activeRoomScenarioComparison.comparedScenarioName}
                      </th>
                      <th className="py-2 pl-4">Delta / Shift</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-slate-700">
                        Dominant Airflow Strategy
                      </td>
                      <td className="py-2.5 px-4 font-bold text-slate-900 uppercase">
                        {report.activeRoomScenarioComparison.baselineStrategy}
                      </td>
                      <td className="py-2.5 px-4 font-bold text-slate-900 uppercase">
                        {report.activeRoomScenarioComparison.comparedStrategy}
                      </td>
                      <td className="py-2.5 pl-4">
                        {report.activeRoomScenarioComparison.strategyChanged ? (
                          <span className="text-teal-700 font-bold">Strategy Shifted</span>
                        ) : (
                          <span className="text-slate-500">Unchanged</span>
                        )}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-slate-700">
                        Effective Free Area (A_eff)
                      </td>
                      <td className="py-2.5 px-4 tabular-nums">
                        {report.activeRoomScenarioComparison.baselineEffectiveFreeAreaM2 ?? '—'} m²
                      </td>
                      <td className="py-2.5 px-4 tabular-nums">
                        {report.activeRoomScenarioComparison.comparedEffectiveFreeAreaM2 ?? '—'} m²
                      </td>
                      <td className="py-2.5 pl-4 font-mono">
                        {report.activeRoomScenarioComparison.deltaEffectiveFreeAreaM2 !== null
                          ? `${report.activeRoomScenarioComparison.deltaEffectiveFreeAreaM2 >= 0 ? '+' : ''}${report.activeRoomScenarioComparison.deltaEffectiveFreeAreaM2} m²`
                          : 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-slate-700">
                        Preliminary Airflow Rate (Q)
                      </td>
                      <td className="py-2.5 px-4 tabular-nums">
                        {report.activeRoomScenarioComparison.baselineCombinedFlowLitresPerSec ?? '—'}{' '}
                        L/s
                      </td>
                      <td className="py-2.5 px-4 tabular-nums">
                        {report.activeRoomScenarioComparison.comparedCombinedFlowLitresPerSec ?? '—'}{' '}
                        L/s
                      </td>
                      <td className="py-2.5 pl-4 font-mono font-bold text-teal-800">
                        {report.activeRoomScenarioComparison.deltaFlowLitresPerSec !== null
                          ? `${report.activeRoomScenarioComparison.deltaFlowLitresPerSec >= 0 ? '+' : ''}${report.activeRoomScenarioComparison.deltaFlowLitresPerSec} L/s`
                          : 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-slate-700">
                        Preliminary Air Change Rate (ACH)
                      </td>
                      <td className="py-2.5 px-4 tabular-nums">
                        {report.activeRoomScenarioComparison.baselineAch ?? '—'} h⁻¹
                      </td>
                      <td className="py-2.5 px-4 tabular-nums">
                        {report.activeRoomScenarioComparison.comparedAch ?? '—'} h⁻¹
                      </td>
                      <td className="py-2.5 pl-4 font-mono font-bold text-teal-800">
                        {report.activeRoomScenarioComparison.deltaAch !== null
                          ? `${report.activeRoomScenarioComparison.deltaAch >= 0 ? '+' : ''}${report.activeRoomScenarioComparison.deltaAch} h⁻¹`
                          : 'N/A'}
                      </td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-slate-700">
                        Overall Scenario Status
                      </td>
                      <td className="py-2.5 px-4">
                        {report.activeRoomScenarioComparison.baselineStatus}
                      </td>
                      <td className="py-2.5 px-4">
                        {report.activeRoomScenarioComparison.comparedStatus}
                      </td>
                      <td className="py-2.5 pl-4">
                        {report.activeRoomScenarioComparison.conditionDifferencesDisclosed.length}{' '}
                        condition diff(s)
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: Multidisciplinary Trade-Offs (Domain F) & Recommendations (Domain H) */}
      {activeSubTab === 'tradeoffs-and-recommendations' && activeRoomEval && (
        <div className="space-y-6">
          {/* Preview Diff Modal / Card when active */}
          {previewDiff && (
            <div className="bg-teal-950 text-white rounded-xl p-5 border-2 border-teal-400 shadow-lg space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-teal-400 text-slate-950">
                    Non-Destructive Preview Diff
                  </span>
                  <h3 className="text-base font-bold mt-1">{previewDiff.title}</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPreviewDiff(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
                  >
                    Cancel Preview
                  </button>
                  {previewDiff.isSafeToApply && (
                    <button
                      onClick={handleApplyPreview}
                      className="px-4 py-1.5 rounded-lg bg-teal-400 hover:bg-teal-300 text-slate-950 text-xs font-bold cursor-pointer"
                    >
                      Apply Atomically with Snapshot Checkpoint
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-900/90 p-3.5 rounded-lg border border-slate-800">
                <div>
                  <div className="text-slate-400">Strategy Shift</div>
                  <div className="font-bold text-teal-300 mt-0.5 uppercase">
                    {previewDiff.beforeStrategy} → {previewDiff.afterStrategy}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Effective Free Area (A_eff)</div>
                  <div className="font-bold text-teal-300 mt-0.5">
                    {previewDiff.beforeEffectiveFreeAreaM2 ?? 'null'} m² →{' '}
                    {previewDiff.afterEffectiveFreeAreaM2 ?? 'null'} m²
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Estimated Scenario ACH</div>
                  <div className="font-bold text-teal-300 mt-0.5">
                    {previewDiff.beforeEstimatedAch ?? 'null'} h⁻¹ →{' '}
                    {previewDiff.afterEstimatedAch ?? 'null'} h⁻¹
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="font-semibold text-teal-200">Exact Field Changes:</div>
                {previewDiff.fieldChanges.map((fc, idx) => (
                  <div
                    key={idx}
                    className="p-2 rounded bg-slate-900 border border-slate-800 font-mono text-[11px]"
                  >
                    <span className="text-slate-300">{fc.label}:</span>{' '}
                    <span className="text-rose-300">{fc.beforeValue}</span> →{' '}
                    <span className="text-emerald-300">{fc.afterValue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Domain F Constraints & Trade-Offs */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Domain F — Multidisciplinary Comfort, IAQ, Moisture (P35), Acoustic (P36) &amp; Accessibility (P34) Trade-Offs
            </h3>
            {activeRoomEval.domainF_ConstraintsAndTradeOffs.length === 0 ? (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                No adverse acoustic, thermal, moisture, rain, or accessibility conflicts detected for the active scenario in {activeRoomEval.roomName}.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {activeRoomEval.domainF_ConstraintsAndTradeOffs.map((item) => (
                  <div
                    key={item.tradeOffId}
                    className={`p-4 rounded-xl border text-xs space-y-1.5 ${
                      item.severity === 'blocking-or-high-concern'
                        ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                        : 'bg-amber-50/70 border-amber-200 text-amber-950'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{item.title}</span>
                      <span className="px-2 py-0.5 rounded bg-white/80 border border-slate-300 text-[10px] font-bold">
                        {item.linkedRoadmapFeature}
                      </span>
                    </div>
                    <p>{item.finding}</p>
                    <p className="text-[11px] opacity-85">
                      <strong>Mitigation:</strong> {item.mitigationGuidance}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Domain H Actionable Recommendations */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Domain H — Actionable Natural Ventilation Recommendations (9-Attribute Provenance Contract)
            </h3>
            {activeRoomEval.domainH_Recommendations.length === 0 ? (
              <p className="text-xs text-slate-500">
                No additional interventions required for {activeRoomEval.roomName} under the active scenario.
              </p>
            ) : (
              <div className="space-y-4">
                {activeRoomEval.domainH_Recommendations.map((rec) => (
                  <div
                    key={rec.recommendationId}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3 text-xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-200">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-900 font-bold text-[10px] uppercase">
                            {rec.priority} priority
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {rec.category}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold text-slate-900 mt-1">{rec.title}</h4>
                      </div>
                      {rec.canPreviewAndApplyInPlotify && (
                        <button
                          onClick={() => handlePreviewRecommendation(rec.recommendationId)}
                          className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer self-start"
                        >
                          Preview &amp; Apply Change
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <strong>1. Issue / Opportunity Addressed:</strong>{' '}
                        {rec.issueOrOpportunityAddressed}
                      </div>
                      <div>
                        <strong>2. Triggering Input:</strong> {rec.triggeringInputOrObservation}
                      </div>
                      <div>
                        <strong>3. Physical Relevance:</strong>{' '}
                        {rec.physicalRelevanceExplanation}
                      </div>
                      <div>
                        <strong>4. Required Operating Conditions:</strong>{' '}
                        {rec.requiredOperatingConditions.join('; ')}
                      </div>
                      <div>
                        <strong>5. Supporting Evidence:</strong> {rec.supportingEvidence}
                      </div>
                      <div>
                        <strong>6. Remaining Unknowns:</strong>{' '}
                        {rec.remainingUnknowns.join('; ')}
                      </div>
                      <div>
                        <strong>7. Expected Benefit ({rec.expectedBenefitKind}):</strong>{' '}
                        {rec.expectedBenefitSummary}
                      </div>
                      <div>
                        <strong>8. Architectural Design Change Required:</strong>{' '}
                        {rec.requiresArchitecturalDesignChange ? 'Yes' : 'No (Parameter / Operation completion)'}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-white border border-slate-200 text-[11px] space-y-1">
                      <div className="font-bold text-slate-800">
                        9. Multidisciplinary Trade-Offs (P30–P36):
                      </div>
                      <div>
                        <strong>P36 Acoustics:</strong>{' '}
                        {rec.multidisciplinaryTradeOffs.acousticsAndNoiseP36}
                      </div>
                      <div>
                        <strong>P30/P36 Speech Privacy:</strong>{' '}
                        {rec.multidisciplinaryTradeOffs.speechPrivacyP30P36}
                      </div>
                      <div>
                        <strong>P35 Moisture &amp; Materials:</strong>{' '}
                        {rec.multidisciplinaryTradeOffs.moistureAndMaterialsP35}
                      </div>
                      <div>
                        <strong>P34 Accessibility &amp; Reach:</strong>{' '}
                        {rec.multidisciplinaryTradeOffs.accessibilityAndReachP34}
                      </div>
                      <div>
                        <strong>P33 Furniture &amp; Circulation:</strong>{' '}
                        {rec.multidisciplinaryTradeOffs.furnitureAndCirculationP33}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 5: Technical Equations, Citations & P30–P36 Ledger */}
      {activeSubTab === 'technical-and-integrations' && (
        <div className="space-y-6">
          {/* Physical Equations & Validity Conditions */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              Documented Physical Equations &amp; Series Orifice Network Formulations (SI Units)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-mono text-[11px]">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="font-bold text-slate-900 font-sans mb-1">
                  1. Wind-Induced Pressure &amp; Orifice Flow
                </div>
                <div>ΔP_wind = 0.5 · ρ · v² · ΔC_p,eff (Pa)</div>
                <div>Q_wind = (C_d · A_eff)_series · √(2 · |ΔP_wind| / ρ) (m³/s)</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="font-bold text-slate-900 font-sans mb-1">
                  2. Hydrostatic Stack / Buoyancy Pressure &amp; Flow
                </div>
                <div>ΔP_stack = ρ · g · Δh · |T_in - T_out| / T_ref,K (Pa)</div>
                <div>Q_stack = (C_d · A_eff)_series · √(2 · |ΔP_stack| / ρ) (m³/s)</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="font-bold text-slate-900 font-sans mb-1">
                  3. Series Orifice Conductance (Two or Three Openings in Series)
                </div>
                <div>(C_d · A_eff)_series = 1 / √( Σ_k (1 / (C_d,k · A_eff,k)²) ) (m²)</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="font-bold text-slate-900 font-sans mb-1">
                  4. Combined Flow &amp; Air Changes Per Hour (ACH)
                </div>
                <div>Q_combined = √(Q_wind² + Q_stack²) (Quadrature — never linear sum)</div>
                <div>ACH = (Q_combined × 3600) / V (h⁻¹), where V = A_floor × H_room</div>
              </div>
            </div>
          </div>

          {/* P31 Option Comparison Export Table */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              P31 Multi-Option Design Comparison Export Summary
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] text-slate-500 uppercase">
                    <th className="py-2 pr-3">Option</th>
                    <th className="py-2 px-3">Cross/Stack Rooms</th>
                    <th className="py-2 px-3">Single-Sided Rooms</th>
                    <th className="py-2 px-3">Mean Openable Ratio</th>
                    <th className="py-2 px-3">Mean Scenario ACH</th>
                    <th className="py-2 pl-3">Comparability Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {report.p31OptionComparisonSummaries.map((sum) => (
                    <tr key={sum.optionId}>
                      <td className="py-2.5 pr-3 font-bold text-slate-900">{sum.optionName}</td>
                      <td className="py-2.5 px-3">
                        {sum.roomsWithCrossOrStackPotentialCount}/{sum.roomsEvaluatedCount}
                      </td>
                      <td className="py-2.5 px-3">{sum.roomsSingleSidedOnlyCount}</td>
                      <td className="py-2.5 px-3">
                        {sum.averageOpenableToFloorAreaPercent !== null
                          ? `${sum.averageOpenableToFloorAreaPercent}%`
                          : 'Incomplete'}
                      </td>
                      <td className="py-2.5 px-3">
                        {sum.averageEstimatedAch !== null
                          ? `${sum.averageEstimatedAch} h⁻¹`
                          : 'Need H / Q'}
                      </td>
                      <td className="py-2.5 pl-3 font-mono">{sum.comparabilityStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Auditable Technical References */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3 text-xs">
            <h3 className="text-sm font-bold text-slate-900">
              Auditable Technical References &amp; Scope Boundaries (P38–P40)
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.values(P37_TECHNICAL_REFERENCES).map((ref) => (
                <div
                  key={ref.sourceId}
                  className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1"
                >
                  <div className="font-bold text-slate-900">
                    {ref.publisher} ({ref.editionOrYear}) — {ref.title}
                  </div>
                  <div className="text-[11px] text-slate-600">{ref.applicabilityNote}</div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {ref.licenceOrUsageNote}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
              {report.roadmapScopeBoundaries.map((b) => (
                <div
                  key={b.roadmapId}
                  className="p-3 rounded-lg bg-slate-100 border border-slate-200 space-y-1"
                >
                  <div className="font-bold text-slate-800">
                    {b.roadmapId}: {b.title}
                  </div>
                  <p className="text-[11px] text-slate-600">{b.boundaryStatement}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
