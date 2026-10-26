import React, { useState, useMemo } from 'react';
import {
  Sun,
  Eye,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Plus,
  Trash2,
  ArrowRight,
  RotateCcw,
  Download,
  FileText,
  ShieldAlert,
  Check,
  X,
} from 'lucide-react';
import { Project } from '../../types/project';
import { ActiveTab } from '../Sidebar';
import { WallCardinalEdge } from '../../types/naturalVentilation';
import {
  DaylightAssessmentMode,
  DaylightEvidenceProvenance,
  DaylightCompletenessState,
  DaylightWindowRecord,
  DaylightProposalPreviewDiff,
  DaylightRecommendation,
  InteriorShadingDeviceType,
  MovableShadingDeploymentState,
  ExteriorShadingDeviceType,
} from '../../types/daylightComfort';
import {
  initializeProjectDaylightComfortData,
  evaluateProjectDaylightComfort,
  previewDaylightRecommendation,
  applyDaylightProposalAtomically,
  rollbackLastDaylightApply,
  computeDaylightComfortSourceFingerprint,
  P38_TECHNICAL_REFERENCES,
} from '../../services/daylightComfortService';

interface DaylightComfortWorkspaceProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onNavigateTab?: (tab: ActiveTab) => void;
}

const PROVENANCE_BADGE_STYLES: Record<
  DaylightEvidenceProvenance,
  { bg: string; text: string; border: string; label: string }
> = {
  'measured-on-site': {
    bg: 'bg-sky-50',
    text: 'text-sky-800',
    border: 'border-sky-200',
    label: 'Measured on Site',
  },
  'manufacturer-or-lab-test': {
    bg: 'bg-emerald-50',
    text: 'text-emerald-800',
    border: 'border-emerald-200',
    label: 'Manufacturer / Lab Test',
  },
  'traceable-generic-reference': {
    bg: 'bg-indigo-50',
    text: 'text-indigo-800',
    border: 'border-indigo-200',
    label: 'Traceable Generic Reference',
  },
  'derived-from-project-geometry': {
    bg: 'bg-teal-50',
    text: 'text-teal-800',
    border: 'border-teal-200',
    label: 'Derived from Project Geometry',
  },
  'user-entered': {
    bg: 'bg-emerald-50',
    text: 'text-emerald-900',
    border: 'border-emerald-300',
    label: 'User-Entered',
  },
  'imported-weather-or-sky': {
    bg: 'bg-cyan-50',
    text: 'text-cyan-800',
    border: 'border-cyan-200',
    label: 'Imported Sky / Weather',
  },
  'illustrative-scenario-assumption': {
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    border: 'border-amber-300',
    label: 'Illustrative Scenario Assumption',
  },
  'calculated-result': {
    bg: 'bg-slate-100',
    text: 'text-slate-800',
    border: 'border-slate-300',
    label: 'Calculated Analytical Result',
  },
  'unavailable-or-unverified': {
    bg: 'bg-rose-50',
    text: 'text-rose-800',
    border: 'border-rose-200',
    label: 'Unavailable / Unverified',
  },
};

const COMPLETENESS_BADGE_STYLES: Record<
  DaylightCompletenessState,
  { bg: string; text: string; border: string; label: string }
> = {
  'sufficient-for-geometric-screening': {
    bg: 'bg-teal-50',
    text: 'text-teal-900',
    border: 'border-teal-200',
    label: 'Sufficient for Geometric Screening',
  },
  'sufficient-for-solar-position-screening': {
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    border: 'border-amber-300',
    label: 'Sufficient for Solar Screening',
  },
  'sufficient-for-simplified-calculation': {
    bg: 'bg-emerald-50',
    text: 'text-emerald-900',
    border: 'border-emerald-200',
    label: 'Complete — Simplified DF Ready',
  },
  'sufficient-for-climate-based-simulation': {
    bg: 'bg-indigo-50',
    text: 'text-indigo-900',
    border: 'border-indigo-200',
    label: 'Climate Simulation Ready',
  },
  'insufficient-evidence': {
    bg: 'bg-rose-50',
    text: 'text-rose-900',
    border: 'border-rose-200',
    label: 'Insufficient Evidence',
  },
  'unsupported-model-or-geometry': {
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    border: 'border-amber-300',
    label: 'Unsupported Model / Geometry',
  },
  'invalid-input': {
    bg: 'bg-rose-50',
    text: 'text-rose-900',
    border: 'border-rose-200',
    label: 'Invalid Input',
  },
  'stale-result': {
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    border: 'border-amber-200',
    label: 'Stale Result',
  },
  'calculation-failed': {
    bg: 'bg-rose-50',
    text: 'text-rose-900',
    border: 'border-rose-200',
    label: 'Calculation Failed',
  },
  'awaiting-required-environmental-data': {
    bg: 'bg-amber-50',
    text: 'text-amber-900',
    border: 'border-amber-200',
    label: 'Awaiting Environmental Data',
  },
};

export const DaylightComfortWorkspace: React.FC<DaylightComfortWorkspaceProps> = ({
  project,
  onUpdateProject,
}) => {
  const daylightData = useMemo(
    () => initializeProjectDaylightComfortData(project),
    [project]
  );

  const evaluationReport = useMemo(
    () => evaluateProjectDaylightComfort(project),
    [project]
  );

  const rooms = project.floorPlan?.rooms || [];
  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    daylightData.selectedRoomId || rooms[0]?.id || ''
  );
  const [activeMode, setActiveMode] = useState<DaylightAssessmentMode>(
    daylightData.selectedAssessmentMode || 'mode-c-simplified-daylight-calculation'
  );
  const [activeEditorTab, setActiveEditorTab] = useState<
    'windows' | 'surfaces' | 'solar' | 'integrations' | 'references'
  >('windows');
  const [activePreviewDiff, setActivePreviewDiff] =
    useState<DaylightProposalPreviewDiff | null>(null);
  const [statusBannerMessage, setStatusBannerMessage] = useState<{
    text: string;
    type: 'success' | 'warning' | 'error';
  } | null>(null);

  const unitLabel = project.unit === 'feet' ? 'ft' : 'm';

  // New window form state
  const [newWinWall, setNewWinWall] = useState<WallCardinalEdge>('south');
  const [newWinWidth, setNewWinWidth] = useState<string>(
    project.unit === 'feet' ? '5.0' : '1.5'
  );
  const [newWinHeight, setNewWinHeight] = useState<string>(
    project.unit === 'feet' ? '4.8' : '1.5'
  );
  const [newWinSill, setNewWinSill] = useState<string>(
    project.unit === 'feet' ? '2.8' : '0.85'
  );
  const [newWinVT, setNewWinVT] = useState<string>('0.70');
  const [newWinOverhang, setNewWinOverhang] = useState<string>('0');

  // New external obstruction state
  const [newObsWall, setNewObsWall] = useState<WallCardinalEdge>('south');
  const [newObsLabel, setNewObsLabel] = useState<string>('Opposite Building');
  const [newObsHeight, setNewObsHeight] = useState<string>(
    project.unit === 'feet' ? '26' : '8.0'
  );
  const [newObsDistance, setNewObsDistance] = useState<string>(
    project.unit === 'feet' ? '32' : '10.0'
  );

  // New measured illuminance state
  const [newMeasInteriorLux, setNewMeasInteriorLux] = useState<string>('320');
  const [newMeasExteriorLux, setNewMeasExteriorLux] = useState<string>('10000');

  const selectedRoomEval = useMemo(() => {
    return (
      evaluationReport.allRoomEvaluationsForActiveScenario.find(
        (r) => r.roomId === selectedRoomId
      ) ||
      evaluationReport.activeRoomEvaluation ||
      evaluationReport.allRoomEvaluationsForActiveScenario[0] ||
      null
    );
  }, [evaluationReport, selectedRoomId]);

  const selectedRoomConfig = useMemo(() => {
    const targetId = selectedRoomEval?.roomId || selectedRoomId;
    return daylightData.roomConfigs[targetId] || null;
  }, [daylightData, selectedRoomEval, selectedRoomId]);

  const selectedRoomWindows = useMemo(() => {
    const targetId = selectedRoomEval?.roomId || selectedRoomId;
    return (daylightData.windows || []).filter((w) => w.roomId === targetId);
  }, [daylightData, selectedRoomEval, selectedRoomId]);

  const activeScenario = evaluationReport.activeScenario;
  const comparisonScenario = evaluationReport.comparisonScenario;

  const commitDaylightDataUpdate = (
    mutator: (draftData: typeof daylightData, draftProject: Project) => void,
    message?: string
  ) => {
    const clonedProject: Project = JSON.parse(JSON.stringify(project));
    const dData = initializeProjectDaylightComfortData(clonedProject);
    mutator(dData, clonedProject);
    dData.isConfigured = true;
    dData.requestSequenceId = (dData.requestSequenceId || 1) + 1;
    dData.lastEvaluatedAt = new Date().toISOString();
    dData.lastSourceFingerprint = computeDaylightComfortSourceFingerprint(
      clonedProject,
      dData
    );
    clonedProject.daylightComfort = dData;
    clonedProject.updatedAt = new Date().toISOString();
    onUpdateProject(clonedProject);
    if (message) {
      setStatusBannerMessage({ text: message, type: 'success' });
    }
  };

  const handleSelectRoom = (roomId: string) => {
    setSelectedRoomId(roomId);
    commitDaylightDataUpdate((d) => {
      d.selectedRoomId = roomId;
    });
  };

  const handleModeChange = (mode: DaylightAssessmentMode) => {
    setActiveMode(mode);
    commitDaylightDataUpdate((d) => {
      d.selectedAssessmentMode = mode;
    });
  };

  const handleScenarioChange = (scenarioId: string, isComparison = false) => {
    commitDaylightDataUpdate((d) => {
      if (isComparison) {
        d.comparisonScenarioId = scenarioId;
      } else {
        d.activeScenarioId = scenarioId;
      }
    });
  };

  const handleAddWindow = () => {
    if (!selectedRoomEval) return;
    const widthVal = parseFloat(newWinWidth);
    const heightVal =
      newWinHeight.trim() === '' ? null : parseFloat(newWinHeight);
    const sillVal = parseFloat(newWinSill);
    const vtVal = newWinVT.trim() === '' ? null : parseFloat(newWinVT);
    const ovhVal = parseFloat(newWinOverhang) || 0;

    if (!Number.isFinite(widthVal) || widthVal <= 0) {
      setStatusBannerMessage({
        text: 'Window width must be a positive number.',
        type: 'error',
      });
      return;
    }

    commitDaylightDataUpdate((d) => {
      const validH =
        heightVal !== null && Number.isFinite(heightVal) && heightVal > 0
          ? heightVal
          : null;
      const validSill =
        Number.isFinite(sillVal) && sillVal >= 0 ? sillVal : 0.85;
      const newWin: DaylightWindowRecord = {
        windowId: `win-${selectedRoomEval.roomId}-${Date.now()}`,
        roomId: selectedRoomEval.roomId,
        label: `${newWinWall.toUpperCase()} Window ${selectedRoomWindows.length + 1}`,
        wallEdge: newWinWall,
        floorLevel: selectedRoomEval.floorLevel || 1,
        offsetAlongWall: 1.0,
        grossWidth: widthVal,
        grossHeight: validH,
        sillHeight: validSill,
        headHeight: validH !== null ? Number((validSill + validH).toFixed(2)) : null,
        dimensionUnit: project.unit,
        dimensionProvenance: 'user-entered',
        frameFraction: 0.15,
        frameFractionProvenance: 'traceable-generic-reference',
        explicitGlazedAreaInUnitSq: null,
        visibleTransmittanceVT:
          vtVal !== null && Number.isFinite(vtVal) && vtVal > 0 && vtVal <= 1
            ? vtVal
            : null,
        vtProvenance:
          vtVal !== null && Number.isFinite(vtVal) && vtVal > 0 && vtVal <= 1
            ? 'user-entered'
            : 'unavailable-or-unverified',
        glazingAssemblyKind: 'double-clear-igu',
        maintenanceFactorM: 0.9,
        maintenanceProvenance: 'traceable-generic-reference',
        revealDepth: project.unit === 'feet' ? 0.5 : 0.15,
        exteriorShadingType: ovhVal > 0 ? 'horizontal-overhang' : 'none',
        overhangProjectionDepth: ovhVal > 0 ? ovhVal : null,
        overhangHeightAboveWindowHead: 0,
        sideFinProjectionDepth: null,
        exteriorLouverCutoffAngleDeg: null,
        interiorShadingType: 'sheer-diffusing-roller-blind',
        defaultBlindState: 'retracted-open',
        interiorBlindTransmittanceMultiplier: 0.35,
        interiorBlindProvenance: 'illustrative-scenario-assumption',
        operabilityStatus: 'operable',
      };
      d.windows.push(newWin);
    }, `Added window to ${selectedRoomEval.roomName}.`);
  };

  const handleUpdateWindowField = (
    windowId: string,
    updater: (win: DaylightWindowRecord) => void
  ) => {
    commitDaylightDataUpdate((d) => {
      const win = d.windows.find((w) => w.windowId === windowId);
      if (win) updater(win);
    });
  };

  const handleDeleteWindow = (windowId: string) => {
    commitDaylightDataUpdate((d) => {
      d.windows = d.windows.filter((w) => w.windowId !== windowId);
    }, 'Removed window opening.');
  };

  const handleAddObstruction = () => {
    const hVal = parseFloat(newObsHeight);
    const dVal = parseFloat(newObsDistance);
    if (
      !Number.isFinite(hVal) ||
      hVal <= 0 ||
      !Number.isFinite(dVal) ||
      dVal <= 0
    ) {
      setStatusBannerMessage({
        text: 'Obstruction height and horizontal distance must be positive numbers.',
        type: 'error',
      });
      return;
    }
    commitDaylightDataUpdate((d) => {
      d.externalObstructions.push({
        obstructionId: `obs-${Date.now()}`,
        label: newObsLabel.trim() || 'External Obstruction',
        wallEdge: newObsWall,
        horizontalDistance: dVal,
        obstructionTopElevation: hVal,
        dimensionUnit: project.unit,
        provenance: 'user-entered',
        sourceNote: 'User-entered external obstruction in P38 workspace.',
      });
    }, `Added external obstruction on ${newObsWall} facade.`);
  };

  const handleDeleteObstruction = (obstructionId: string) => {
    commitDaylightDataUpdate((d) => {
      d.externalObstructions = d.externalObstructions.filter(
        (o) => o.obstructionId !== obstructionId
      );
    }, 'Removed external obstruction.');
  };

  const handleAddMeasuredRecord = () => {
    if (!selectedRoomEval) return;
    const intLux = parseFloat(newMeasInteriorLux);
    const extLux =
      newMeasExteriorLux.trim() === '' ? null : parseFloat(newMeasExteriorLux);
    if (!Number.isFinite(intLux) || intLux < 0) {
      setStatusBannerMessage({
        text: 'Measured interior illuminance must be a non-negative number (lux).',
        type: 'error',
      });
      return;
    }
    commitDaylightDataUpdate((d) => {
      d.measuredIlluminanceRecords[selectedRoomEval.roomId] = {
        measurementId: `meas-${Date.now()}`,
        roomId: selectedRoomEval.roomId,
        measuredMeanIlluminanceLux: intLux,
        measuredMinIlluminanceLux: Number((intLux * 0.6).toFixed(0)),
        measuredOutdoorHorizontalLux:
          extLux !== null && Number.isFinite(extLux) && extLux > 0
            ? extLux
            : null,
        measuredAtDateTime: new Date().toISOString(),
        skyConditionDescription: 'Field sensor measurement',
        instrumentAndMethodNote: 'Calibrated handheld lux meter at work-plane height',
        provenance: 'measured-on-site',
      };
    }, `Saved field-measured illuminance record for ${selectedRoomEval.roomName}.`);
  };

  const handlePreviewRecommendation = (rec: DaylightRecommendation) => {
    const diff = previewDaylightRecommendation(project, rec.recommendationId);
    setActivePreviewDiff(diff);
  };

  const handleApplyPreview = () => {
    if (!activePreviewDiff) return;
    const result = applyDaylightProposalAtomically(project, activePreviewDiff);
    if (result.applied) {
      onUpdateProject(result.updatedProject);
      setActivePreviewDiff(null);
      setStatusBannerMessage({
        text: result.message,
        type: 'success',
      });
    } else {
      setStatusBannerMessage({
        text: result.message,
        type: 'error',
      });
    }
  };

  const handleRollbackLastApply = () => {
    const res = rollbackLastDaylightApply(project);
    if (res.rolledBack) {
      onUpdateProject(res.restoredProject);
      setActivePreviewDiff(null);
      setStatusBannerMessage({
        text: res.message,
        type: 'success',
      });
    } else {
      setStatusBannerMessage({
        text: res.message,
        type: 'warning',
      });
    }
  };

  const handleExportReport = (format: 'json' | 'md') => {
    if (format === 'json') {
      const blob = new Blob([JSON.stringify(evaluationReport, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name
        .toLowerCase()
        .replace(/\s+/g, '-')}-p38-daylight-report.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const lines: string[] = [
        `# P38 Daylight & Visual Comfort Evaluation Report — ${project.name}`,
        ``,
        `- **Engine Version**: ${evaluationReport.calculationMethodVersion}`,
        `- **Evaluated At**: ${evaluationReport.evaluatedAt}`,
        `- **Active Scenario**: ${activeScenario.name}`,
        ``,
        `## Room Evaluations`,
      ];
      for (const rm of evaluationReport.allRoomEvaluationsForActiveScenario) {
        lines.push(
          `### ${rm.roomName} (${rm.roomType})`,
          `- Completeness: ${rm.completenessState}`,
          `- Floor Area: ${rm.geometry.floorAreaM2 ?? 'N/A'} m² | Ceiling Height: ${
            rm.geometry.ceilingHeightMetres !== null
              ? `${rm.geometry.ceilingHeightMetres} m`
              : 'Unverified'
          }`,
          `- Mode A Net Glazed-to-Floor Ratio: ${
            rm.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent !== null
              ? `${rm.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent}%`
              : 'Incomplete'
          }`,
          `- Mode B Direct-Sun Work-Plane Coverage: ${
            rm.modeB_SolarAndShading.workPlaneDirectSunCoveragePercent !== null
              ? `${rm.modeB_SolarAndShading.workPlaneDirectSunCoveragePercent}%`
              : 'Incomplete'
          }`,
          `- Mode C Mean Daylight Factor (BRE Split-Flux): ${
            rm.modeC_SimplifiedDaylight.meanDaylightFactorPercent !== null
              ? `${rm.modeC_SimplifiedDaylight.meanDaylightFactorPercent}%`
              : 'Incomplete'
          }`,
          `- Mode D Annual Climate Metrics (sDA / ASE / DA / UDI): Explicitly Unsupported (null)`,
          `- Mode E Qualitative Glare Risk: ${rm.modeE_VisualComfortGlareView.qualitativeGlareRiskLevel} | Horizontal View Angle: ${
            rm.modeE_VisualComfortGlareView.viewOutAssessment
              .horizontalViewAngleFromRoomCentreDeg !== null
              ? `${rm.modeE_VisualComfortGlareView.viewOutAssessment.horizontalViewAngleFromRoomCentreDeg}°`
              : 'N/A'
          }`,
          ``
        );
      }
      const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name
        .toLowerCase()
        .replace(/\s+/g, '-')}-p38-daylight-report.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const allRooms = evaluationReport.allRoomEvaluationsForActiveScenario;
  const roomsWithDf = allRooms.filter(
    (r) => r.modeC_SimplifiedDaylight.meanDaylightFactorPercent !== null
  );
  const meanProjectDf =
    roomsWithDf.length > 0
      ? roomsWithDf.reduce(
          (acc, r) =>
            acc + (r.modeC_SimplifiedDaylight.meanDaylightFactorPercent || 0),
          0
        ) / roomsWithDf.length
      : null;

  return (
    <div className="space-y-6 pb-12">
      {/* Top Workspace Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold bg-amber-50 text-amber-900 border border-amber-300">
                <Sun className="w-3.5 h-3.5 text-amber-600" />
                P38 Engine · {evaluationReport.calculationMethodVersion}
              </span>
              {selectedRoomEval && (
                <span
                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-md border ${
                    COMPLETENESS_BADGE_STYLES[selectedRoomEval.completenessState]
                      .bg
                  } ${
                    COMPLETENESS_BADGE_STYLES[selectedRoomEval.completenessState]
                      .text
                  } ${
                    COMPLETENESS_BADGE_STYLES[selectedRoomEval.completenessState]
                      .border
                  }`}
                >
                  {
                    COMPLETENESS_BADGE_STYLES[selectedRoomEval.completenessState]
                      .label
                  }
                </span>
              )}
              {evaluationReport.isStale && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Stale Fingerprint — Upstream Geometry Modified
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Daylight &amp; Visual Comfort Analyzer
            </h1>
            <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
              Multi-mode architectural daylighting, analytical solar position &amp;
              overhang shadow screening, simplified BRE Split-Flux Mean Daylight
              Factor (<span className="font-mono">CIE Standard Overcast Sky</span>),
              and qualitative glare &amp; view-out assessment with strict evidence
              provenance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 self-start">
            {daylightData.lastPreApplySnapshotId && (
              <button
                onClick={handleRollbackLastApply}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors cursor-pointer"
                title="Restore project to pre-P38 apply checkpoint"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Rollback Last Apply</span>
              </button>
            )}
            <button
              onClick={() =>
                commitDaylightDataUpdate(
                  () => {},
                  'Synchronized P38 fingerprint and recalculated all rooms.'
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-teal-700" />
              <span>Recalculate &amp; Sync</span>
            </button>
            <button
              onClick={() => handleExportReport('json')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>JSON</span>
            </button>
            <button
              onClick={() => handleExportReport('md')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              <span>Markdown</span>
            </button>
          </div>
        </div>

        {/* Status Message Banner */}
        {statusBannerMessage && (
          <div
            className={`mt-4 p-3 rounded-lg border flex items-center justify-between text-xs font-medium ${
              statusBannerMessage.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : statusBannerMessage.type === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusBannerMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              )}
              <span>{statusBannerMessage.text}</span>
            </div>
            <button
              onClick={() => setStatusBannerMessage(null)}
              className="text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Project-Level KPI Strip */}
        <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">
              Rooms with DF Ready
            </div>
            <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {roomsWithDf.length} / {allRooms.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {allRooms.length - roomsWithDf.length} awaiting height/VT
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">
              Mean Daylight Factor
            </div>
            <div className="text-lg font-bold text-teal-900 tabular-nums mt-0.5">
              {meanProjectDf !== null
                ? `${meanProjectDf.toFixed(2)}%`
                : 'Incomplete'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              CIE Overcast Split-Flux
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">
              Total Windows Tracked
            </div>
            <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {daylightData.windows.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {
                evaluationReport.p37NaturalVentilationIntegration
                  .sharedWindowIdsCount
              }{' '}
              shared with P37
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">
              Solar Altitude (αs)
            </div>
            <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
              {selectedRoomEval?.modeB_SolarAndShading.solarAltitudeDeg !==
                null &&
              selectedRoomEval?.modeB_SolarAndShading.solarAltitudeDeg !==
                undefined
                ? `${selectedRoomEval.modeB_SolarAndShading.solarAltitudeDeg.toFixed(
                    1
                  )}°`
                : '—'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {activeScenario.environmentalConditions.analysisDateIso}{' '}
              {activeScenario.environmentalConditions.analysisLocalTime24h}
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">
              Annual sDA / ASE
            </div>
            <div className="text-sm font-bold text-slate-700 font-mono mt-1">
              null (Unsupported)
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Mode D Scope Gate
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/80">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">
              Luminance DGP
            </div>
            <div className="text-sm font-bold text-slate-700 font-mono mt-1">
              null (Unsupported)
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              Mode E HDR Gate
            </div>
          </div>
        </div>
      </div>

      {/* Mode Selector + Scenario Bar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              {
                id: 'mode-a-geometric-potential',
                label: 'Mode A: Geometric Potential',
              },
              {
                id: 'mode-b-solar-position-and-shading',
                label: 'Mode B: Solar & Shadow',
              },
              {
                id: 'mode-c-simplified-daylight-calculation',
                label: 'Mode C: BRE Split-Flux DF',
              },
              {
                id: 'mode-d-climate-based-annual-simulation',
                label: 'Mode D: Annual Metrics (Scope)',
              },
              {
                id: 'mode-e-visual-comfort-glare-and-view',
                label: 'Mode E: Glare & View Out',
              },
              {
                id: 'mode-f-scenario-comparison',
                label: 'Mode F: Scenario Comparison',
              },
            ] as { id: DaylightAssessmentMode; label: string }[]
          ).map((m) => (
            <button
              key={m.id}
              onClick={() => handleModeChange(m.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                activeMode === m.id
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-600">Active Scenario:</span>
            <select
              value={daylightData.activeScenarioId}
              onChange={(e) => handleScenarioChange(e.target.value, false)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
            >
              {daylightData.scenarios.map((sc) => (
                <option key={sc.scenarioId} value={sc.scenarioId}>
                  {sc.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-600">Compare With:</span>
            <select
              value={daylightData.comparisonScenarioId || ''}
              onChange={(e) => handleScenarioChange(e.target.value, true)}
              className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-900"
            >
              {daylightData.scenarios.map((sc) => (
                <option key={sc.scenarioId} value={sc.scenarioId}>
                  {sc.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Room Selector + Interactive 2D SVG Plan Diagram */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900">
                Room Daylight Inventory ({allRooms.length})
              </h2>
              <span className="text-[11px] text-slate-500">
                Select a room to inspect &amp; edit
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] text-slate-500 uppercase">
                    <th className="py-2 pr-2">Room</th>
                    <th className="py-2 px-2 text-right">Win</th>
                    <th className="py-2 px-2 text-right">GFR</th>
                    <th className="py-2 px-2 text-right">Mean DF</th>
                    <th className="py-2 pl-2">Glare</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {allRooms.map((rm) => {
                    const isSelected = rm.roomId === selectedRoomEval?.roomId;
                    return (
                      <tr
                        key={rm.roomId}
                        onClick={() => handleSelectRoom(rm.roomId)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-teal-50/80 font-semibold text-teal-950'
                            : 'hover:bg-slate-50 text-slate-700'
                        }`}
                      >
                        <td className="py-2.5 pr-2">
                          <div className="font-semibold text-slate-900">
                            {rm.roomName}
                          </div>
                          <div className="text-[10px] text-slate-500 capitalize">
                            {rm.roomType} ·{' '}
                            {rm.geometry.floorAreaM2?.toFixed(1) ?? '—'} m²
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right tabular-nums">
                          {rm.evaluatedWindows.length}
                        </td>
                        <td className="py-2.5 px-2 text-right tabular-nums">
                          {rm.modeA_GeometricPotential
                            .netGlazedToFloorAreaRatioPercent !== null
                            ? `${rm.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent.toFixed(
                                1
                              )}%`
                            : '—'}
                        </td>
                        <td className="py-2.5 px-2 text-right tabular-nums font-semibold">
                          {rm.modeC_SimplifiedDaylight.meanDaylightFactorPercent !==
                          null
                            ? `${rm.modeC_SimplifiedDaylight.meanDaylightFactorPercent.toFixed(
                                2
                              )}%`
                            : 'Incomp.'}
                        </td>
                        <td className="py-2.5 pl-2">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              rm.modeE_VisualComfortGlareView
                                .qualitativeGlareRiskLevel ===
                              'high-direct-sun-or-low-angle-concern'
                                ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                : rm.modeE_VisualComfortGlareView
                                    .qualitativeGlareRiskLevel ===
                                  'moderate-conditional-concern'
                                ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                : rm.modeE_VisualComfortGlareView
                                    .qualitativeGlareRiskLevel ===
                                  'low-screened-concern'
                                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {rm.modeE_VisualComfortGlareView.qualitativeGlareRiskLevel.replace(
                              /-/g,
                              ' '
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 2D SVG Plan & Work-Plane Grid Diagram */}
          {selectedRoomEval && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    2D Work-Plane Grid &amp; View Cone —{' '}
                    {selectedRoomEval.roomName}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {selectedRoomEval.geometry.widthMetres?.toFixed(2) ?? '—'} m ×{' '}
                    {selectedRoomEval.geometry.lengthMetres?.toFixed(2) ?? '—'} m ·
                    Grid: {selectedRoomEval.geometry.analysisPoints.length} pts at
                    z ={' '}
                    {selectedRoomEval.geometry.workPlaneHeightMetres?.toFixed(
                      2
                    ) ?? '0.80'}{' '}
                    m
                  </p>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                  αs={' '}
                  {selectedRoomEval.modeB_SolarAndShading.solarAltitudeDeg?.toFixed(
                    1
                  ) ?? '—'}
                  ° · γs={' '}
                  {selectedRoomEval.modeB_SolarAndShading.solarAzimuthDegFromNorth?.toFixed(
                    1
                  ) ?? '—'}
                  °
                </span>
              </div>

              <div className="bg-slate-950 rounded-xl p-4 border border-slate-800">
                <svg
                  viewBox="0 0 360 250"
                  className="w-full h-auto"
                  role="img"
                  aria-label={`Daylight and solar penetration plan diagram for ${selectedRoomEval.roomName}`}
                >
                  <g transform="translate(325, 28)">
                    <circle
                      cx="0"
                      cy="0"
                      r="14"
                      fill="#0f172a"
                      stroke="#334155"
                      strokeWidth="1.2"
                    />
                    <polygon points="0,-10 -4,4 0,1 4,4" fill="#2dd4bf" />
                    <text
                      x="0"
                      y="11"
                      textAnchor="middle"
                      fill="#94a3b8"
                      fontSize="7"
                      fontWeight="bold"
                    >
                      N ({selectedRoomEval.geometry.northOrientationOffsetDeg}°)
                    </text>
                  </g>

                  {(() => {
                    const wM = Math.max(
                      1.5,
                      selectedRoomEval.geometry.widthMetres || 4.0
                    );
                    const lM = Math.max(
                      1.5,
                      selectedRoomEval.geometry.lengthMetres || 4.0
                    );
                    const scale = Math.min(220 / wM, 150 / lM);
                    const rectW = wM * scale;
                    const rectH = lM * scale;
                    const originX = (340 - rectW) / 2;
                    const originY = (230 - rectH) / 2 + 5;

                    return (
                      <g>
                        <rect
                          x={originX}
                          y={originY}
                          width={rectW}
                          height={rectH}
                          fill="#1e293b"
                          stroke="#94a3b8"
                          strokeWidth="2"
                        />

                        {selectedRoomEval.geometry.analysisPoints.map((pt) => {
                          const cx = originX + pt.localXMetres * scale;
                          const cy = originY + pt.localYMetres * scale;
                          const dfVal = pt.pointDaylightFactorProxyPercent ?? 0;
                          const fill = pt.receivesDirectSunInScenario
                            ? '#fbbf24'
                            : dfVal >= 3.0
                            ? '#2dd4bf'
                            : dfVal >= 1.5
                            ? '#38bdf8'
                            : '#64748b';
                          return (
                            <g key={pt.pointId}>
                              <circle
                                cx={cx}
                                cy={cy}
                                r={4.5}
                                fill={fill}
                                fillOpacity={0.85}
                                stroke="#0f172a"
                                strokeWidth="1"
                              />
                              <title>
                                {pt.pointId}: DF Proxy ≈ {dfVal.toFixed(2)}% |
                                Direct Sun:{' '}
                                {pt.receivesDirectSunInScenario ? 'Yes' : 'No'}
                              </title>
                            </g>
                          );
                        })}

                        <circle
                          cx={originX + rectW / 2}
                          cy={originY + rectH / 2}
                          r={3.5}
                          fill="#f8fafc"
                          stroke="#0f172a"
                          strokeWidth="1.2"
                        />

                        {selectedRoomEval.evaluatedWindows.map((win) => {
                          const winW = win.grossWidthMetres || 1.2;
                          const winLenPx = Math.min(
                            win.wallEdge === 'north' || win.wallEdge === 'south'
                              ? rectW * 0.85
                              : rectH * 0.85,
                            Math.max(16, winW * scale)
                          );
                          let x1 = originX;
                          let y1 = originY;
                          let x2 = originX;
                          let y2 = originY;

                          if (win.wallEdge === 'north') {
                            x1 = originX + (rectW - winLenPx) / 2;
                            y1 = originY;
                            x2 = x1 + winLenPx;
                            y2 = originY;
                          } else if (win.wallEdge === 'south') {
                            x1 = originX + (rectW - winLenPx) / 2;
                            y1 = originY + rectH;
                            x2 = x1 + winLenPx;
                            y2 = originY + rectH;
                          } else if (win.wallEdge === 'west') {
                            x1 = originX;
                            y1 = originY + (rectH - winLenPx) / 2;
                            x2 = originX;
                            y2 = y1 + winLenPx;
                          } else {
                            x1 = originX + rectW;
                            y1 = originY + (rectH - winLenPx) / 2;
                            x2 = originX + rectW;
                            y2 = y1 + winLenPx;
                          }

                          return (
                            <g key={win.windowId}>
                              <polygon
                                points={`${originX + rectW / 2},${
                                  originY + rectH / 2
                                } ${x1},${y1} ${x2},${y2}`}
                                fill="#38bdf8"
                                fillOpacity="0.12"
                                stroke="#38bdf8"
                                strokeWidth="0.75"
                                strokeDasharray="3 2"
                              />
                              <line
                                x1={x1}
                                y1={y1}
                                x2={x2}
                                y2={y2}
                                stroke="#38bdf8"
                                strokeWidth="5"
                                strokeLinecap="round"
                              />
                            </g>
                          );
                        })}

                        <text
                          x={originX + rectW / 2}
                          y={originY - 8}
                          textAnchor="middle"
                          fill="#cbd5e1"
                          fontSize="9"
                        >
                          North Wall · {wM.toFixed(2)} m
                        </text>
                        <text
                          x={originX + rectW / 2}
                          y={originY + rectH + 15}
                          textAnchor="middle"
                          fill="#cbd5e1"
                          fontSize="9"
                        >
                          South Wall · View Angle:{' '}
                          {selectedRoomEval.modeE_VisualComfortGlareView
                            .viewOutAssessment
                            .horizontalViewAngleFromRoomCentreDeg !== null
                            ? `${selectedRoomEval.modeE_VisualComfortGlareView.viewOutAssessment.horizontalViewAngleFromRoomCentreDeg.toFixed(
                                1
                              )}°`
                            : '0°'}
                        </text>
                      </g>
                    );
                  })()}
                </svg>
              </div>

              {/* Missing Inputs Guidance */}
              {selectedRoomEval.missingInputsGuidance.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 space-y-1">
                  <div className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      Missing or Unverified Inputs (
                      {selectedRoomEval.missingInputsGuidance.length})
                    </span>
                  </div>
                  <ul className="list-disc list-inside text-[11px] text-amber-900 space-y-0.5">
                    {selectedRoomEval.missingInputsGuidance.map((msg, idx) => (
                      <li key={idx}>{msg}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Actionable Recommendations */}
              <div className="space-y-2.5 pt-2 border-t border-slate-100">
                <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                  <span>
                    Actionable Remediation Proposals (
                    {selectedRoomEval.recommendations.length})
                  </span>
                  <span className="text-[10px] text-teal-700 font-semibold">
                    Non-destructive preview before apply
                  </span>
                </div>

                {selectedRoomEval.recommendations.map((rec) => (
                  <div
                    key={rec.recommendationId}
                    className="p-3 rounded-lg border border-slate-200 bg-slate-50/70 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span
                          className={`inline-block text-[10px] font-bold uppercase px-1.5 py-0.5 rounded mr-1.5 ${
                            rec.priority === 'high'
                              ? 'bg-rose-100 text-rose-800'
                              : rec.priority === 'medium'
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-teal-100 text-teal-800'
                          }`}
                        >
                          {rec.priority}
                        </span>
                        <span className="text-xs font-bold text-slate-900">
                          {rec.title}
                        </span>
                      </div>
                      {rec.canPreviewAndApplyInPlotify && (
                        <button
                          onClick={() => handlePreviewRecommendation(rec)}
                          className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-[11px] font-semibold cursor-pointer transition-colors"
                        >
                          <span>Preview Diff</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      {rec.physicalRationale}
                    </p>
                    <div className="text-[11px] font-medium text-teal-900 bg-teal-50/80 px-2.5 py-1 rounded border border-teal-200/70">
                      Expected Effect: {rec.expectedDaylightAndGlareEffect}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Mode Results + Editors */}
        <div className="lg:col-span-7 space-y-6">
          {selectedRoomEval && (
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
              {/* MODE A */}
              {activeMode === 'mode-a-geometric-potential' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-teal-700">
                        Assessment Mode A
                      </span>
                      <h2 className="text-lg font-bold text-slate-900">
                        Geometric Daylight Potential &amp; Room Depth Screening
                      </h2>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Gross Window Area
                      </div>
                      <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeA_GeometricPotential
                          .totalGrossWindowAreaM2 !== null
                          ? `${selectedRoomEval.modeA_GeometricPotential.totalGrossWindowAreaM2.toFixed(
                              2
                            )} m²`
                          : 'Missing Height'}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Net Glazed Area (Ag)
                      </div>
                      <div className="text-base font-bold text-teal-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeA_GeometricPotential
                          .totalNetGlazedAreaM2 !== null
                          ? `${selectedRoomEval.modeA_GeometricPotential.totalNetGlazedAreaM2.toFixed(
                              2
                            )} m²`
                          : 'Incomplete'}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Net Glazed / Floor (GFR)
                      </div>
                      <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeA_GeometricPotential
                          .netGlazedToFloorAreaRatioPercent !== null
                          ? `${selectedRoomEval.modeA_GeometricPotential.netGlazedToFloorAreaRatioPercent.toFixed(
                              2
                            )}%`
                          : 'Incomplete'}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Depth / Head Ratio
                      </div>
                      <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeA_GeometricPotential
                          .depthToWindowHeadRatio !== null
                          ? `${selectedRoomEval.modeA_GeometricPotential.depthToWindowHeadRatio.toFixed(
                              2
                            )}×`
                          : 'Incomplete'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        Max ref:{' '}
                        {
                          selectedRoomEval.modeA_GeometricPotential
                            .limitingDepthHeuristicThreshold
                        }
                        × H_head
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600">
                    {selectedRoomEval.modeA_GeometricPotential.explanation}
                  </p>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-600">
                    {
                      selectedRoomEval.modeA_GeometricPotential
                        .nonComplianceAndProxyDisclosure
                    }
                  </div>
                </div>
              )}

              {/* MODE B */}
              {activeMode === 'mode-b-solar-position-and-shading' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-amber-700">
                        Assessment Mode B
                      </span>
                      <h2 className="text-lg font-bold text-slate-900">
                        Analytical Solar Position &amp; Overhang Shadow Screening
                      </h2>
                    </div>
                    <span
                      className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                        PROVENANCE_BADGE_STYLES[
                          selectedRoomEval.modeB_SolarAndShading
                            .locationAndTimeProvenance
                        ].bg
                      } ${
                        PROVENANCE_BADGE_STYLES[
                          selectedRoomEval.modeB_SolarAndShading
                            .locationAndTimeProvenance
                        ].text
                      } ${
                        PROVENANCE_BADGE_STYLES[
                          selectedRoomEval.modeB_SolarAndShading
                            .locationAndTimeProvenance
                        ].border
                      }`}
                    >
                      {
                        PROVENANCE_BADGE_STYLES[
                          selectedRoomEval.modeB_SolarAndShading
                            .locationAndTimeProvenance
                        ].label
                      }
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Solar Altitude (αs)
                      </div>
                      <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeB_SolarAndShading
                          .solarAltitudeDeg !== null
                          ? `${selectedRoomEval.modeB_SolarAndShading.solarAltitudeDeg.toFixed(
                              2
                            )}°`
                          : '—'}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Solar Azimuth (γs)
                      </div>
                      <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeB_SolarAndShading
                          .solarAzimuthDegFromNorth !== null
                          ? `${selectedRoomEval.modeB_SolarAndShading.solarAzimuthDegFromNorth.toFixed(
                              2
                            )}°`
                          : '—'}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Work-Plane Direct Sun
                      </div>
                      <div className="text-base font-bold text-amber-800 tabular-nums mt-0.5">
                        {selectedRoomEval.modeB_SolarAndShading
                          .workPlaneDirectSunCoveragePercent !== null
                          ? `${selectedRoomEval.modeB_SolarAndShading.workPlaneDirectSunCoveragePercent.toFixed(
                              1
                            )}%`
                          : '—'}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Max Sun Depth
                      </div>
                      <div className="text-base font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeB_SolarAndShading
                          .maxDirectSunPenetrationDepthMetres !== null
                          ? `${selectedRoomEval.modeB_SolarAndShading.maxDirectSunPenetrationDepthMetres.toFixed(
                              2
                            )} m`
                          : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                          <th className="py-2 pr-2">Window</th>
                          <th className="py-2 px-2">Azimuth</th>
                          <th className="py-2 px-2">Profile Ωv</th>
                          <th className="py-2 px-2">Overhang Shadow</th>
                          <th className="py-2 px-2">Sunlit Glass</th>
                          <th className="py-2 pl-2">Floor Depth</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedRoomEval.modeB_SolarAndShading.windowSolarExposures.map(
                          (we) => (
                            <tr key={we.windowId}>
                              <td className="py-2 pr-2 font-semibold text-slate-900">
                                {we.label}
                              </td>
                              <td className="py-2 px-2 tabular-nums">
                                {we.wallAzimuthDeg.toFixed(0)}° (Δγ=
                                {we.surfaceSolarAzimuthDiffDeg.toFixed(1)}°)
                              </td>
                              <td className="py-2 px-2 tabular-nums">
                                {we.verticalProfileAngleDeg !== null
                                  ? `${we.verticalProfileAngleDeg.toFixed(1)}°`
                                  : 'Shaded'}
                              </td>
                              <td className="py-2 px-2 tabular-nums">
                                {we.overhangVerticalShadowMetres.toFixed(2)} m
                              </td>
                              <td className="py-2 px-2 tabular-nums font-semibold">
                                {(we.directSunlitGlazedFraction * 100).toFixed(
                                  0
                                )}
                                %
                              </td>
                              <td className="py-2 pl-2 tabular-nums">
                                {we.directSunPenetrationDepthMetres.toFixed(2)} m
                              </td>
                            </tr>
                          )
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* MODE C */}
              {activeMode === 'mode-c-simplified-daylight-calculation' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-teal-700">
                        Assessment Mode C · BRE / CIBSE Split-Flux
                      </span>
                      <h2 className="text-lg font-bold text-slate-900">
                        Simplified Daylight Factor &amp; Illuminance (CIE Overcast
                        Sky)
                      </h2>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-teal-50/60 rounded-lg border border-teal-200">
                      <div className="text-[10px] font-semibold text-teal-800 uppercase">
                        Mean Daylight Factor
                      </div>
                      <div className="text-xl font-bold text-teal-950 tabular-nums mt-0.5">
                        {selectedRoomEval.modeC_SimplifiedDaylight
                          .meanDaylightFactorPercent !== null
                          ? `${selectedRoomEval.modeC_SimplifiedDaylight.meanDaylightFactorPercent.toFixed(
                              2
                            )}%`
                          : 'Incomplete'}
                      </div>
                      <div className="text-[10px] text-teal-800">
                        Advisory range: 2.0%–5.0%
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Est. Mean Illuminance
                      </div>
                      <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeC_SimplifiedDaylight
                          .estimatedOvercastMeanIlluminanceLux !== null
                          ? `${selectedRoomEval.modeC_SimplifiedDaylight.estimatedOvercastMeanIlluminanceLux.toFixed(
                              0
                            )} lux`
                          : '—'}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Uniformity Proxy (U0)
                      </div>
                      <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeC_SimplifiedDaylight
                          .uniformityRatioProxy !== null
                          ? selectedRoomEval.modeC_SimplifiedDaylight.uniformityRatioProxy.toFixed(
                              2
                            )
                          : '—'}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Area-Weighted R
                      </div>
                      <div className="text-xl font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeC_SimplifiedDaylight
                          .areaWeightedAverageReflectanceR !== null
                          ? selectedRoomEval.modeC_SimplifiedDaylight.areaWeightedAverageReflectanceR.toFixed(
                              3
                            )
                          : '—'}
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] space-y-1">
                    <div className="text-teal-300 font-bold">
                      {selectedRoomEval.modeC_SimplifiedDaylight.modelName}
                    </div>
                    <div>
                      {
                        selectedRoomEval.modeC_SimplifiedDaylight
                          .formulaDocumented
                      }
                    </div>
                    <div className="text-slate-300">
                      {selectedRoomEval.modeC_SimplifiedDaylight.explanation}
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
                    <strong>Scope &amp; Non-Equivalence Notice:</strong>{' '}
                    {
                      selectedRoomEval.modeC_SimplifiedDaylight
                        .en17037NonEquivalenceDisclosure
                    }
                  </div>
                </div>
              )}

              {/* MODE D */}
              {activeMode === 'mode-d-climate-based-annual-simulation' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-indigo-700">
                        Assessment Mode D · Scope &amp; Provenance Gate
                      </span>
                      <h2 className="text-lg font-bold text-slate-900">
                        Climate-Based Annual Daylight Metrics (sDA / ASE / DA /
                        UDI)
                      </h2>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-amber-50 text-amber-900 border border-amber-300">
                      Explicitly Unsupported in Analytical Engine
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      {
                        label: 'Spatial Daylight Autonomy (sDA 300/50%)',
                        val: selectedRoomEval.modeD_AnnualSimulationStatus
                          .sDA_300_50_Percent,
                      },
                      {
                        label: 'Annual Sunlight Exposure (ASE 1000,250h)',
                        val: selectedRoomEval.modeD_AnnualSimulationStatus
                          .ASE_1000_250_Percent,
                      },
                      {
                        label: 'Daylight Autonomy (DA)',
                        val: selectedRoomEval.modeD_AnnualSimulationStatus
                          .daylightAutonomyPercent,
                      },
                      {
                        label: 'Useful Daylight Illuminance (UDI)',
                        val: selectedRoomEval.modeD_AnnualSimulationStatus
                          .usefulDaylightIlluminancePercent,
                      },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="p-3 bg-slate-50 rounded-lg border border-slate-200"
                      >
                        <div className="text-[10px] font-semibold text-slate-500 uppercase">
                          {item.label}
                        </div>
                        <div className="text-sm font-bold text-slate-700 font-mono mt-1">
                          {item.val === null ? 'null (Unsupported)' : `${item.val}%`}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="p-4 bg-amber-50/80 border border-amber-200 rounded-lg space-y-2 text-xs text-amber-950">
                    <div className="font-bold flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-amber-700" />
                      <span>Why P38 Does Not Fabricate Annual Climate Metrics</span>
                    </div>
                    <p className="leading-relaxed">
                      {
                        selectedRoomEval.modeD_AnnualSimulationStatus
                          .whyUnavailableExplanation
                      }
                    </p>
                    <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                      {selectedRoomEval.modeD_AnnualSimulationStatus.requiredForValidatedAnnualSimulation.map(
                        (cap, i) => (
                          <li key={i}>{cap}</li>
                        )
                      )}
                    </ul>
                  </div>
                </div>
              )}

              {/* MODE E */}
              {activeMode === 'mode-e-visual-comfort-glare-and-view' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-indigo-700">
                        Assessment Mode E
                      </span>
                      <h2 className="text-lg font-bold text-slate-900">
                        Visual Comfort, Glare Risk &amp; View-Out Screening
                      </h2>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Horizontal View Angle
                      </div>
                      <div className="text-lg font-bold text-slate-900 tabular-nums mt-0.5">
                        {selectedRoomEval.modeE_VisualComfortGlareView
                          .viewOutAssessment
                          .horizontalViewAngleFromRoomCentreDeg !== null
                          ? `${selectedRoomEval.modeE_VisualComfortGlareView.viewOutAssessment.horizontalViewAngleFromRoomCentreDeg.toFixed(
                              1
                            )}°`
                          : '0.0°'}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        From room centre (Ref ≥ 14°)
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Qualitative Glare Risk
                      </div>
                      <div className="text-sm font-bold text-slate-900 capitalize mt-1">
                        {selectedRoomEval.modeE_VisualComfortGlareView.qualitativeGlareRiskLevel.replace(
                          /-/g,
                          ' '
                        )}
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                      <div className="text-[10px] font-semibold text-slate-500 uppercase">
                        Luminance DGP Metric
                      </div>
                      <div className="text-xs font-bold text-slate-700 font-mono mt-1">
                        null (Unsupported)
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Requires HDR eye-level field
                      </div>
                    </div>
                  </div>

                  <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5">
                    <div className="font-bold text-slate-900">
                      Glare &amp; View-Out Screening Findings
                    </div>
                    {selectedRoomEval.modeE_VisualComfortGlareView.identifiedComfortAndGlareFindings.map(
                      (f) => (
                        <div key={f.findingId} className="text-slate-700">
                          • <strong>{f.title}:</strong> {f.explanation}
                        </div>
                      )
                    )}
                    <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                      {
                        selectedRoomEval.modeE_VisualComfortGlareView
                          .dgpLimitationDisclosure
                      }
                    </div>
                  </div>
                </div>
              )}

              {/* MODE F */}
              {activeMode === 'mode-f-scenario-comparison' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <span className="text-[11px] font-bold uppercase text-teal-700">
                        Assessment Mode F
                      </span>
                      <h2 className="text-lg font-bold text-slate-900">
                        Side-by-Side Daylight &amp; Solar Scenario Comparison
                      </h2>
                    </div>
                  </div>

                  {evaluationReport.modeF_ScenarioComparison ? (
                    <div className="space-y-4 text-xs">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">
                            Baseline Scenario
                          </div>
                          <div className="font-bold text-slate-900 mt-0.5">
                            {
                              evaluationReport.modeF_ScenarioComparison
                                .baselineScenarioName
                            }
                          </div>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                          <div className="text-[10px] text-slate-500 uppercase font-semibold">
                            Compared Scenario
                          </div>
                          <div className="font-bold text-slate-900 mt-0.5">
                            {
                              evaluationReport.modeF_ScenarioComparison
                                .comparedScenarioName
                            }
                          </div>
                        </div>
                        <div className="p-3 bg-teal-50 rounded-lg border border-teal-200">
                          <div className="text-[10px] text-teal-800 uppercase font-semibold">
                            Direct-Sun Coverage Delta
                          </div>
                          <div className="text-base font-bold text-teal-950 tabular-nums mt-0.5">
                            {evaluationReport.modeF_ScenarioComparison
                              .deltaDirectSunCoveragePercent !== null
                              ? `${
                                  evaluationReport.modeF_ScenarioComparison
                                    .deltaDirectSunCoveragePercent > 0
                                    ? '+'
                                    : ''
                                }${evaluationReport.modeF_ScenarioComparison.deltaDirectSunCoveragePercent.toFixed(
                                  1
                                )}%`
                              : '—'}
                          </div>
                        </div>
                      </div>

                      <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
                        <div className="font-bold text-slate-900">
                          Trade-Off &amp; Delta Summary
                        </div>
                        <p className="text-slate-700">
                          {
                            evaluationReport.modeF_ScenarioComparison
                              .daylightVsSolarControlTradeOffSummary
                          }
                        </p>
                        {evaluationReport.modeF_ScenarioComparison.changedInputsSummary.map(
                          (ci, i) => (
                            <div key={i} className="text-slate-600">
                              • {ci}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">
                      Select a comparison scenario above to inspect side-by-side
                      deltas.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tabbed Editors & Cross-Feature Ledger */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="flex flex-wrap border-b border-slate-200 bg-slate-50 px-4 pt-2 gap-1">
              {[
                { id: 'windows', label: 'Windows & Shading' },
                { id: 'surfaces', label: 'Surfaces, Grid & Sensors' },
                { id: 'solar', label: 'Solar & Sky Scenario' },
                { id: 'integrations', label: 'P30–P37 Integrations' },
                { id: 'references', label: 'Formulas & Standards' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveEditorTab(tab.id as any)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg border-t border-x transition-colors cursor-pointer ${
                    activeEditorTab === tab.id
                      ? 'bg-white text-slate-900 border-slate-200 -mb-px'
                      : 'bg-transparent text-slate-600 border-transparent hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="p-5 space-y-5">
              {/* TAB 1: Windows */}
              {activeEditorTab === 'windows' && selectedRoomEval && (
                <div className="space-y-5">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Window &amp; Glazing Schedule — {selectedRoomEval.roomName}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Configure aperture width, gross height, sill height, visible
                      light transmittance (VT), overhangs, and interior blinds.
                    </p>
                  </div>

                  {selectedRoomWindows.length === 0 ? (
                    <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-900">
                      No exterior windows configured for {selectedRoomEval.roomName}.
                      Add a window below to evaluate daylight and view out.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedRoomWindows.map((win) => (
                        <div
                          key={win.windowId}
                          className="p-3.5 rounded-lg border border-slate-200 bg-slate-50/60 space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-slate-900">
                                {win.label}
                              </span>
                              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-slate-200 text-slate-800">
                                {win.wallEdge} wall
                              </span>
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                                  PROVENANCE_BADGE_STYLES[win.vtProvenance].bg
                                } ${
                                  PROVENANCE_BADGE_STYLES[win.vtProvenance].text
                                } ${
                                  PROVENANCE_BADGE_STYLES[win.vtProvenance]
                                    .border
                                }`}
                              >
                                VT: {PROVENANCE_BADGE_STYLES[win.vtProvenance].label}
                              </span>
                            </div>
                            <button
                              onClick={() => handleDeleteWindow(win.windowId)}
                              className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                              title="Delete window"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5 text-xs">
                            <div>
                              <label className="text-[10px] font-semibold text-slate-500 block">
                                Wall Edge
                              </label>
                              <select
                                value={win.wallEdge}
                                onChange={(e) =>
                                  handleUpdateWindowField(win.windowId, (w) => {
                                    w.wallEdge = e.target.value as WallCardinalEdge;
                                  })
                                }
                                className="mt-0.5 w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                              >
                                <option value="north">North</option>
                                <option value="south">South</option>
                                <option value="east">East</option>
                                <option value="west">West</option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[10px] font-semibold text-slate-500 block">
                                Width ({unitLabel})
                              </label>
                              <input
                                type="number"
                                step="0.1"
                                min="0.2"
                                value={win.grossWidth ?? ''}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  handleUpdateWindowField(win.windowId, (w) => {
                                    w.grossWidth =
                                      Number.isFinite(v) && v > 0 ? v : null;
                                    w.dimensionProvenance = 'user-entered';
                                  });
                                }}
                                className="mt-0.5 w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs tabular-nums"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-semibold text-slate-500 block">
                                Height ({unitLabel})
                              </label>
                              <input
                                type="number"
                                step="0.1"
                                min="0.2"
                                placeholder="Missing"
                                value={win.grossHeight ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  const v = raw === '' ? null : parseFloat(raw);
                                  handleUpdateWindowField(win.windowId, (w) => {
                                    w.grossHeight =
                                      v !== null && Number.isFinite(v) && v > 0
                                        ? v
                                        : null;
                                    w.dimensionProvenance =
                                      w.grossHeight !== null
                                        ? 'user-entered'
                                        : 'unavailable-or-unverified';
                                  });
                                }}
                                className="mt-0.5 w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs tabular-nums"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-semibold text-slate-500 block">
                                Sill ({unitLabel})
                              </label>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={win.sillHeight ?? ''}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  if (Number.isFinite(v) && v >= 0) {
                                    handleUpdateWindowField(win.windowId, (w) => {
                                      w.sillHeight = v;
                                    });
                                  }
                                }}
                                className="mt-0.5 w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs tabular-nums"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-semibold text-slate-500 block">
                                Glazing VT (0–1)
                              </label>
                              <input
                                type="number"
                                step="0.02"
                                min="0.05"
                                max="0.95"
                                placeholder="Unverified"
                                value={win.visibleTransmittanceVT ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value.trim();
                                  const v = raw === '' ? null : parseFloat(raw);
                                  handleUpdateWindowField(win.windowId, (w) => {
                                    w.visibleTransmittanceVT =
                                      v !== null &&
                                      Number.isFinite(v) &&
                                      v > 0 &&
                                      v <= 1
                                        ? v
                                        : null;
                                    w.vtProvenance =
                                      w.visibleTransmittanceVT !== null
                                        ? 'user-entered'
                                        : 'unavailable-or-unverified';
                                  });
                                }}
                                className="mt-0.5 w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs tabular-nums"
                              />
                            </div>

                            <div>
                              <label className="text-[10px] font-semibold text-slate-500 block">
                                Overhang ({unitLabel})
                              </label>
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={win.overhangProjectionDepth ?? 0}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  handleUpdateWindowField(win.windowId, (w) => {
                                    if (Number.isFinite(v) && v > 0) {
                                      w.overhangProjectionDepth = v;
                                      w.exteriorShadingType =
                                        'horizontal-overhang';
                                    } else {
                                      w.overhangProjectionDepth = null;
                                      w.exteriorShadingType = 'none';
                                    }
                                  });
                                }}
                                className="mt-0.5 w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs tabular-nums"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs pt-1">
                            <div>
                              <label className="text-[10px] font-semibold text-slate-500 block">
                                Interior Blind Type
                              </label>
                              <select
                                value={win.interiorShadingType}
                                onChange={(e) =>
                                  handleUpdateWindowField(win.windowId, (w) => {
                                    w.interiorShadingType =
                                      e.target.value as InteriorShadingDeviceType;
                                  })
                                }
                                className="mt-0.5 w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                              >
                                <option value="none">None</option>
                                <option value="sheer-diffusing-roller-blind">
                                  Sheer Diffusing Roller Blind
                                </option>
                                <option value="venetian-slat-blind">
                                  Venetian Slat Blind
                                </option>
                                <option value="blackout-opaque-roller-shade">
                                  Blackout Opaque Roller Shade
                                </option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[10px] font-semibold text-slate-500 block">
                                Blind Deployment State
                              </label>
                              <select
                                value={win.defaultBlindState}
                                onChange={(e) =>
                                  handleUpdateWindowField(win.windowId, (w) => {
                                    w.defaultBlindState =
                                      e.target.value as MovableShadingDeploymentState;
                                  })
                                }
                                className="mt-0.5 w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                              >
                                <option value="retracted-open">
                                  Retracted (Open)
                                </option>
                                <option value="partially-deployed">
                                  Partially Deployed (50%)
                                </option>
                                <option value="fully-deployed-closed">
                                  Fully Deployed (Closed)
                                </option>
                              </select>
                            </div>

                            <div>
                              <label className="text-[10px] font-semibold text-slate-500 block">
                                Frame Fraction (0–0.85)
                              </label>
                              <input
                                type="number"
                                step="0.05"
                                min="0"
                                max="0.85"
                                value={win.frameFraction ?? 0.15}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  if (Number.isFinite(v) && v >= 0 && v < 0.9) {
                                    handleUpdateWindowField(win.windowId, (w) => {
                                      w.frameFraction = v;
                                      w.frameFractionProvenance = 'user-entered';
                                    });
                                  }
                                }}
                                className="mt-0.5 w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs tabular-nums"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add New Window Form */}
                  <div className="p-3.5 rounded-lg border border-dashed border-slate-300 bg-slate-50/50 space-y-2.5">
                    <div className="text-xs font-bold text-slate-800">
                      + Add Window Opening to {selectedRoomEval.roomName}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
                      <select
                        value={newWinWall}
                        onChange={(e) =>
                          setNewWinWall(e.target.value as WallCardinalEdge)
                        }
                        className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs"
                      >
                        <option value="south">South Wall</option>
                        <option value="north">North Wall</option>
                        <option value="east">East Wall</option>
                        <option value="west">West Wall</option>
                      </select>
                      <input
                        type="number"
                        step="0.1"
                        value={newWinWidth}
                        onChange={(e) => setNewWinWidth(e.target.value)}
                        placeholder={`Width (${unitLabel})`}
                        className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs tabular-nums"
                      />
                      <input
                        type="number"
                        step="0.1"
                        value={newWinHeight}
                        onChange={(e) => setNewWinHeight(e.target.value)}
                        placeholder={`Height (${unitLabel})`}
                        className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs tabular-nums"
                      />
                      <input
                        type="number"
                        step="0.1"
                        value={newWinSill}
                        onChange={(e) => setNewWinSill(e.target.value)}
                        placeholder={`Sill (${unitLabel})`}
                        className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs tabular-nums"
                      />
                      <input
                        type="number"
                        step="0.02"
                        value={newWinVT}
                        onChange={(e) => setNewWinVT(e.target.value)}
                        placeholder="VT (e.g. 0.70)"
                        className="px-2 py-1.5 bg-white border border-slate-300 rounded text-xs tabular-nums"
                      />
                      <button
                        onClick={handleAddWindow}
                        className="inline-flex items-center justify-center gap-1 px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded text-xs font-semibold cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Surfaces, Grid, Obstructions & Sensors */}
              {activeEditorTab === 'surfaces' &&
                selectedRoomEval &&
                selectedRoomConfig && (
                  <div className="space-y-5 text-xs">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 block">
                          Ceiling Height ({unitLabel})
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="2.0"
                          value={selectedRoomConfig.ceilingHeight ?? ''}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            commitDaylightDataUpdate((d) => {
                              const rc = d.roomConfigs[selectedRoomEval.roomId];
                              if (rc) {
                                rc.ceilingHeight =
                                  Number.isFinite(v) && v > 0 ? v : null;
                                rc.ceilingHeightProvenance =
                                  rc.ceilingHeight !== null
                                    ? 'user-entered'
                                    : 'unavailable-or-unverified';
                              }
                            });
                          }}
                          className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 block">
                          Ceiling Reflectance (ρc)
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="0.95"
                          value={selectedRoomConfig.ceilingReflectance ?? 0.8}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (Number.isFinite(v) && v >= 0.05 && v < 1.0) {
                              commitDaylightDataUpdate((d) => {
                                const rc = d.roomConfigs[selectedRoomEval.roomId];
                                if (rc) {
                                  rc.ceilingReflectance = v;
                                  rc.ceilingReflectanceProvenance =
                                    'user-entered';
                                }
                              });
                            }
                          }}
                          className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 block">
                          Wall Reflectance (ρw)
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="0.95"
                          value={selectedRoomConfig.wallReflectance ?? 0.6}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (Number.isFinite(v) && v >= 0.05 && v < 1.0) {
                              commitDaylightDataUpdate((d) => {
                                const rc = d.roomConfigs[selectedRoomEval.roomId];
                                if (rc) {
                                  rc.wallReflectance = v;
                                  rc.wallReflectanceProvenance = 'user-entered';
                                }
                              });
                            }
                          }}
                          className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-semibold text-slate-500 block">
                          Floor Reflectance (ρf)
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min="0.05"
                          max="0.85"
                          value={selectedRoomConfig.floorReflectance ?? 0.25}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (Number.isFinite(v) && v >= 0.05 && v < 1.0) {
                              commitDaylightDataUpdate((d) => {
                                const rc = d.roomConfigs[selectedRoomEval.roomId];
                                if (rc) {
                                  rc.floorReflectance = v;
                                  rc.floorReflectanceProvenance = 'user-entered';
                                }
                              });
                            }
                          }}
                          className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                        />
                      </div>
                    </div>

                    {/* External Obstructions */}
                    <div className="pt-3 border-t border-slate-100 space-y-2.5">
                      <div className="font-bold text-slate-900">
                        External Obstructions (
                        {daylightData.externalObstructions.length})
                      </div>
                      {daylightData.externalObstructions.map((obs) => (
                        <div
                          key={obs.obstructionId}
                          className="flex items-center justify-between p-2.5 bg-slate-50 rounded border border-slate-200"
                        >
                          <div>
                            <span className="font-semibold text-slate-900">
                              {obs.label}
                            </span>{' '}
                            <span className="text-slate-500">
                              ({obs.wallEdge} facade · H=
                              {obs.obstructionTopElevation} {obs.dimensionUnit},
                              D={obs.horizontalDistance} {obs.dimensionUnit})
                            </span>
                          </div>
                          <button
                            onClick={() =>
                              handleDeleteObstruction(obs.obstructionId)
                            }
                            className="text-slate-400 hover:text-rose-600 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}

                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <input
                          type="text"
                          value={newObsLabel}
                          onChange={(e) => setNewObsLabel(e.target.value)}
                          placeholder="Obstruction label"
                          className="px-2 py-1.5 bg-white border border-slate-300 rounded"
                        />
                        <select
                          value={newObsWall}
                          onChange={(e) =>
                            setNewObsWall(e.target.value as WallCardinalEdge)
                          }
                          className="px-2 py-1.5 bg-white border border-slate-300 rounded"
                        >
                          <option value="south">South</option>
                          <option value="north">North</option>
                          <option value="east">East</option>
                          <option value="west">West</option>
                        </select>
                        <input
                          type="number"
                          value={newObsHeight}
                          onChange={(e) => setNewObsHeight(e.target.value)}
                          placeholder={`Height (${unitLabel})`}
                          className="px-2 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                        />
                        <input
                          type="number"
                          value={newObsDistance}
                          onChange={(e) => setNewObsDistance(e.target.value)}
                          placeholder={`Distance (${unitLabel})`}
                          className="px-2 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                        />
                        <button
                          onClick={handleAddObstruction}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded font-semibold cursor-pointer"
                        >
                          + Obstruction
                        </button>
                      </div>
                    </div>

                    {/* Field-Measured Illuminance Sensor */}
                    <div className="pt-3 border-t border-slate-100 space-y-2.5">
                      <div className="font-bold text-slate-900">
                        Field-Measured Illuminance Record for{' '}
                        {selectedRoomEval.roomName}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input
                          type="number"
                          value={newMeasInteriorLux}
                          onChange={(e) => setNewMeasInteriorLux(e.target.value)}
                          placeholder="Measured Interior Mean Lux"
                          className="px-2 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                        />
                        <input
                          type="number"
                          value={newMeasExteriorLux}
                          onChange={(e) => setNewMeasExteriorLux(e.target.value)}
                          placeholder="Simultaneous Outdoor Lux"
                          className="px-2 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                        />
                        <button
                          onClick={handleAddMeasuredRecord}
                          className="px-3 py-1.5 bg-teal-700 text-white rounded font-semibold cursor-pointer"
                        >
                          Save Sensor Reading
                        </button>
                      </div>
                    </div>
                  </div>
                )}

              {/* TAB 3: Solar & Sky Scenario Editor */}
              {activeEditorTab === 'solar' && activeScenario && (
                <div className="space-y-4 text-xs">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Edit Active Scenario: {activeScenario.name}
                    </h3>
                    <p className="text-[11px] text-slate-500">
                      Coordinates are never guessed from city or project name.
                      Enter explicit site latitude/longitude to mark provenance as
                      user-entered.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 block">
                        Latitude (°N, -90 to 90)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="-90"
                        max="90"
                        value={
                          activeScenario.environmentalConditions.latitudeDeg ?? ''
                        }
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          commitDaylightDataUpdate((d) => {
                            const sc = d.scenarios.find(
                              (s) => s.scenarioId === activeScenario.scenarioId
                            );
                            if (
                              sc &&
                              Number.isFinite(v) &&
                              v >= -90 &&
                              v <= 90
                            ) {
                              sc.environmentalConditions.latitudeDeg = v;
                              sc.environmentalConditions.locationProvenance =
                                'user-entered';
                            }
                          });
                        }}
                        className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 block">
                        Longitude (°E, -180 to 180)
                      </label>
                      <input
                        type="number"
                        step="0.1"
                        min="-180"
                        max="180"
                        value={
                          activeScenario.environmentalConditions.longitudeDeg ?? ''
                        }
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          commitDaylightDataUpdate((d) => {
                            const sc = d.scenarios.find(
                              (s) => s.scenarioId === activeScenario.scenarioId
                            );
                            if (
                              sc &&
                              Number.isFinite(v) &&
                              v >= -180 &&
                              v <= 180
                            ) {
                              sc.environmentalConditions.longitudeDeg = v;
                              sc.environmentalConditions.locationProvenance =
                                'user-entered';
                            }
                          });
                        }}
                        className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 block">
                        Date (YYYY-MM-DD)
                      </label>
                      <input
                        type="date"
                        value={
                          activeScenario.environmentalConditions.analysisDateIso
                        }
                        onChange={(e) => {
                          commitDaylightDataUpdate((d) => {
                            const sc = d.scenarios.find(
                              (s) => s.scenarioId === activeScenario.scenarioId
                            );
                            if (sc && e.target.value) {
                              sc.environmentalConditions.analysisDateIso =
                                e.target.value;
                              sc.environmentalConditions.dateTimeProvenance =
                                'user-entered';
                            }
                          });
                        }}
                        className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-slate-500 block">
                        Local Time (24h)
                      </label>
                      <input
                        type="time"
                        value={
                          activeScenario.environmentalConditions
                            .analysisLocalTime24h
                        }
                        onChange={(e) => {
                          commitDaylightDataUpdate((d) => {
                            const sc = d.scenarios.find(
                              (s) => s.scenarioId === activeScenario.scenarioId
                            );
                            if (sc && e.target.value) {
                              sc.environmentalConditions.analysisLocalTime24h =
                                e.target.value;
                              sc.environmentalConditions.dateTimeProvenance =
                                'user-entered';
                            }
                          });
                        }}
                        className="mt-1 w-full px-2.5 py-1.5 bg-white border border-slate-300 rounded tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: P30–P37 Cross-Feature Integrations */}
              {activeEditorTab === 'integrations' && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
                      <div className="font-bold text-slate-900">
                        P30 Brief &amp; P32 Personalization Alignment
                      </div>
                      <p className="text-slate-600">
                        Confirmed Daylight Spaces:{' '}
                        <strong>
                          {evaluationReport.p30BriefIntegration
                            .confirmedNaturalLightRooms.length || '0'}
                        </strong>{' '}
                        | P32 Shading Styles:{' '}
                        <strong>
                          {evaluationReport.p32PersonalizationIntegration.explicitPreferredShadingStyles.join(
                            ', '
                          ) || 'Default'}
                        </strong>
                      </p>
                    </div>

                    <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
                      <div className="font-bold text-slate-900">
                        P31 Multi-Option Comparison Export (
                        {evaluationReport.p31OptionComparisonSummaries.length}{' '}
                        Options)
                      </div>
                      {evaluationReport.p31OptionComparisonSummaries.map(
                        (opt) => (
                          <div key={opt.optionId} className="text-[11px] text-slate-600">
                            • <strong>{opt.optionName}</strong>:{' '}
                            {opt.summaryExplanation}
                          </div>
                        )
                      )}
                    </div>

                    <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
                      <div className="font-bold text-slate-900">
                        P33 Furniture &amp; P34 Universal Accessibility
                      </div>
                      <p className="text-slate-600">
                        P33 Windows Synced:{' '}
                        <strong>
                          {
                            evaluationReport.p33FurnitureAndOpeningsIntegration
                              .syncedP33WindowOpeningsCount
                          }
                        </strong>{' '}
                        | P34 Warnings:{' '}
                        <strong>
                          {
                            evaluationReport.p34AccessibilityIntegration
                              .windowAndShadeControlReachWarnings.length
                          }
                        </strong>
                      </p>
                    </div>

                    <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
                      <div className="font-bold text-slate-900">
                        P35 Material, P36 Acoustics &amp; P37 Ventilation
                      </div>
                      <p className="text-slate-600">
                        P35 Climate:{' '}
                        <strong>
                          {
                            evaluationReport.p35MaterialIntegration
                              .climateProfileName
                          }
                        </strong>{' '}
                        | P37 Shared Windows:{' '}
                        <strong>
                          {
                            evaluationReport.p37NaturalVentilationIntegration
                              .sharedWindowIdsCount
                          }
                        </strong>
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {
                          evaluationReport.p37NaturalVentilationIntegration
                            .p37StaleIfWindowModifiedNote
                        }
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: Technical Reference & Standards Ledger */}
              {activeEditorTab === 'references' && (
                <div className="space-y-3 text-xs">
                  {Object.values(P38_TECHNICAL_REFERENCES).map((ref) => (
                    <div
                      key={ref.sourceId}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-1"
                    >
                      <div className="font-bold text-slate-900">
                        {ref.title} ({ref.editionOrVersion})
                      </div>
                      <div className="text-[11px] text-slate-600">
                        <strong>Publisher:</strong> {ref.publisher} |{' '}
                        <strong>Units:</strong> {ref.unitsNote}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {ref.applicabilityAndScopeNote}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Non-Destructive Proposal Preview Modal */}
      {activePreviewDiff && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200">
                  Non-Destructive Proposal Preview
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-1">
                  {activePreviewDiff.title}
                </h3>
                <p className="text-xs text-slate-500">
                  Target Room: {activePreviewDiff.roomName} · Fingerprint:{' '}
                  {activePreviewDiff.sourceFingerprintAtPreview}
                </p>
              </div>
              <button
                onClick={() => setActivePreviewDiff(null)}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">
                  Glazed-to-Floor Ratio
                </div>
                <div className="font-bold text-slate-900 tabular-nums mt-0.5">
                  {activePreviewDiff.beforeGlazedToFloorRatioPercent !== null
                    ? `${activePreviewDiff.beforeGlazedToFloorRatioPercent.toFixed(
                        1
                      )}%`
                    : '—'}{' '}
                  →{' '}
                  <span className="text-teal-700">
                    {activePreviewDiff.afterGlazedToFloorRatioPercent !== null
                      ? `${activePreviewDiff.afterGlazedToFloorRatioPercent.toFixed(
                          1
                        )}%`
                      : '—'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">
                  Mean Daylight Factor
                </div>
                <div className="font-bold text-slate-900 tabular-nums mt-0.5">
                  {activePreviewDiff.beforeMeanDaylightFactorPercent !== null
                    ? `${activePreviewDiff.beforeMeanDaylightFactorPercent.toFixed(
                        2
                      )}%`
                    : '—'}{' '}
                  →{' '}
                  <span className="text-teal-700">
                    {activePreviewDiff.afterMeanDaylightFactorPercent !== null
                      ? `${activePreviewDiff.afterMeanDaylightFactorPercent.toFixed(
                          2
                        )}%`
                      : '—'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">
                  Direct-Sun Area
                </div>
                <div className="font-bold text-slate-900 tabular-nums mt-0.5">
                  {activePreviewDiff.beforeDirectSunCoveragePercent !== null
                    ? `${activePreviewDiff.beforeDirectSunCoveragePercent.toFixed(
                        1
                      )}%`
                    : '—'}{' '}
                  →{' '}
                  <span className="text-teal-700">
                    {activePreviewDiff.afterDirectSunCoveragePercent !== null
                      ? `${activePreviewDiff.afterDirectSunCoveragePercent.toFixed(
                          1
                        )}%`
                      : '—'}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">
                  Glare Risk Level
                </div>
                <div className="font-bold text-slate-900 capitalize mt-0.5">
                  {activePreviewDiff.beforeGlareRisk.replace(/-/g, ' ')} →{' '}
                  <span className="text-teal-700">
                    {activePreviewDiff.afterGlareRisk.replace(/-/g, ' ')}
                  </span>
                </div>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5 text-xs">
              <div className="font-bold text-slate-900">Exact Field Changes</div>
              {activePreviewDiff.fieldChanges.map((fc, i) => (
                <div key={i} className="flex items-center justify-between gap-2">
                  <span className="text-slate-600">{fc.label}:</span>
                  <span className="font-mono font-semibold text-slate-900">
                    {fc.beforeValue} → {fc.afterValue}
                  </span>
                </div>
              ))}
              <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-200">
                Cross-Feature Safety: {activePreviewDiff.p37StaleDisclosureNote}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setActivePreviewDiff(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Cancel Preview
              </button>
              <button
                onClick={handleApplyPreview}
                disabled={!activePreviewDiff.isSafeToApply}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                <Check className="w-4 h-4" />
                <span>Apply Atomically (Create Snapshot)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
