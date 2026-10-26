/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * PLOTIFY — P35: Climate-Responsive Material Advisor Workspace
 * Account A | Locked Roadmap: P35 of P30–P40
 */

import React, { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Sun,
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  Sliders,
  Layers,
  Scale,
  Sparkles,
  FileText,
  RotateCcw,
  Plus,
  Trash2,
  Eye,
  Check,
  X,
  Info,
  Building2,
  Accessibility,
} from 'lucide-react';
import { Project, FacadeMaterial } from '../../types/project';
import {
  MaterialApplicationCategory,
  MaterialSuitabilityStatus,
  MaterialEvidenceStatus,
  HumidityWettingRegime,
  FreezeThawExposureLevel,
  CoastalSaltExposureLevel,
  ExposureSeverityLevel,
  MaterialRankingWeights,
  MaterialSelectionPreviewDiff,
  ResistanceRating,
} from '../../types/climateMaterialAdvisor';
import {
  DEFAULT_MATERIAL_RANKING_WEIGHTS,
  REFERENCE_CLIMATE_PROFILES,
  initializeProjectMaterialAdvisorData,
  evaluateProjectMaterialAdvisor,
  previewMaterialSelection,
  applyMaterialSelectionSafely,
  saveProjectMaterialAdvisorSafely,
  rollbackMaterialAdvisorChanges,
  validateAndNormalizeCustomMaterial,
  formatTemperature,
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  createUnconfiguredClimateContext,
  getAvailableMaterialCatalogue,
} from '../../services/climateMaterialAdvisorService';

interface ClimateMaterialAdvisorWorkspaceProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onBack: () => void;
  onOpenBrief?: (project: Project) => void;
  onOpenDesignComparison?: (project: Project) => void;
  onOpenDesignPersonalization?: (project: Project) => void;
  onOpenUniversalAccessibility?: (project: Project) => void;
  onOpenDesignStudio?: (project: Project) => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const APPLICATION_LABELS: Record<MaterialApplicationCategory, string> = {
  'exterior-primary-facade': 'Exterior Primary Facade Cladding',
  'exterior-accent-cladding': 'Exterior Accent & Secondary Cladding',
  'roof-covering-and-trim': 'Roof Covering & Coping Trim',
  'exterior-glazing-and-frames': 'Exterior Glazing & Window Frames',
  'envelope-insulation-and-moisture-control': 'Envelope Insulation & Weather Barrier',
  'interior-wall-finish': 'Interior Wall Finish',
  'interior-floor-finish': 'Interior Floor Finish',
};

export const ClimateMaterialAdvisorWorkspace: React.FC<ClimateMaterialAdvisorWorkspaceProps> = ({
  project,
  onUpdateProject,
  onBack,
  onOpenBrief,
  onOpenDesignComparison,
  onOpenDesignPersonalization,
  onOpenUniversalAccessibility,
  onOpenDesignStudio,
  showToast,
}) => {
  const advisorData = useMemo(() => initializeProjectMaterialAdvisorData(project), [project]);

  const [selectedApplication, setSelectedApplication] = useState<MaterialApplicationCategory>(
    advisorData.selectedApplication || 'exterior-primary-facade'
  );
  const [selectedTargetRoomId, setSelectedTargetRoomId] = useState<string | undefined>(
    advisorData.selectedTargetRoomId || project.floorPlan?.rooms?.[0]?.id
  );
  const [activeSubTab, setActiveSubTab] = useState<
    'suitability' | 'comparison' | 'custom-materials' | 'options-summary'
  >('suitability');
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [showClimateEditor, setShowClimateEditor] = useState<boolean>(false);
  const [previewDiff, setPreviewDiff] = useState<MaterialSelectionPreviewDiff | null>(null);

  const climate = advisorData.climateContext;
  const displayUnit = climate.temperatureUnit || 'C';

  // Evaluate full P35 report deterministically
  const report = useMemo(
    () =>
      evaluateProjectMaterialAdvisor(project, {
        ...advisorData,
        selectedApplication,
        selectedTargetRoomId,
      }),
    [project, advisorData, selectedApplication, selectedTargetRoomId]
  );

  const comparisonResult = report.comparisonResult;
  const p31MaterialSummaries = report.p31OptionSummaries;

  const activeCandidateReport = useMemo(() => {
    if (report.activeApplicationEvaluations.length === 0) return null;
    if (selectedCandidateId) {
      const found = report.activeApplicationEvaluations.find(
        (c) => c.materialId === selectedCandidateId
      );
      if (found) return found;
    }
    return report.activeApplicationEvaluations[0];
  }, [report.activeApplicationEvaluations, selectedCandidateId]);

  const activeCandidateRecord = useMemo(() => {
    if (!activeCandidateReport) return null;
    return (
      report.availableCatalogue.find((c) => c.materialId === activeCandidateReport.materialId) ||
      null
    );
  }, [report.availableCatalogue, activeCandidateReport]);

  // Custom material form state
  const [customMatId, setCustomMatId] = useState('');
  const [customMatName, setCustomMatName] = useState('');
  const [customMatSummary, setCustomMatSummary] = useState(
    'Custom stone/ceramic rainscreen cladding panel'
  );
  const [customMatApp, setCustomMatApp] = useState<MaterialApplicationCategory>(
    'exterior-primary-facade'
  );
  const [customMatFacadeMap, setCustomMatFacadeMap] = useState<FacadeMaterial>('stone');
  const [customMatLambda, setCustomMatLambda] = useState<string>('1.4');
  const [customMatSolarRefl, setCustomMatSolarRefl] = useState<string>('0.55');
  const [customMatWaterAbs, setCustomMatWaterAbs] = useState<string>('3.2');
  const [customMatFreezeThaw, setCustomMatFreezeThaw] =
    useState<ResistanceRating>('high-resistant');
  const [customMatIncludeFreezeThaw, setCustomMatIncludeFreezeThaw] = useState<boolean>(true);
  const [customMatSalt, setCustomMatSalt] = useState<ResistanceRating>('moderate-conditional');
  const [customMatUV, setCustomMatUV] = useState<ResistanceRating>('high-resistant');
  const [customMatWetRoom, setCustomMatWetRoom] = useState<boolean>(false);
  const [customMatMaintYears, setCustomMatMaintYears] = useState<string>('20');
  const [customMatCostUsd, setCustomMatCostUsd] = useState<string>('175');
  const [customMatSourceCitation, setCustomMatSourceCitation] = useState(
    'Project team preliminary datasheet entry'
  );
  const [customMatErrors, setCustomMatErrors] = useState<string[]>([]);
  const [customMatWarnings, setCustomMatWarnings] = useState<string[]>([]);

  const rooms = project.floorPlan?.rooms || [];

  // Handlers
  const handleSelectReferenceProfile = (profileId: string) => {
    if (profileId === 'unconfigured-climate-context') {
      const resetCtx = createUnconfiguredClimateContext(project);
      const { updatedProject } = saveProjectMaterialAdvisorSafely(project, {
        ...advisorData,
        climateContext: resetCtx,
      });
      onUpdateProject(updatedProject);
      showToast?.('Climate context reset to Unconfigured state.', 'info');
      return;
    }

    const refProfile = REFERENCE_CLIMATE_PROFILES.find((p) => p.profileId === profileId);
    if (!refProfile) return;

    const { updatedProject } = saveProjectMaterialAdvisorSafely(project, {
      ...advisorData,
      climateContext: {
        ...refProfile,
        temperatureUnit: displayUnit,
        updatedAt: new Date().toISOString(),
      },
    });
    onUpdateProject(updatedProject);
    showToast?.(`Loaded reference screening profile: ${refProfile.profileName}`, 'success');
  };

  const handleToggleTempUnit = (unit: 'C' | 'F') => {
    const { updatedProject } = saveProjectMaterialAdvisorSafely(
      project,
      {
        ...advisorData,
        climateContext: {
          ...climate,
          temperatureUnit: unit,
          updatedAt: new Date().toISOString(),
        },
      },
      false
    );
    onUpdateProject(updatedProject);
  };

  const handleUpdateClimateField = (patch: Partial<typeof climate>) => {
    const { updatedProject } = saveProjectMaterialAdvisorSafely(
      project,
      {
        ...advisorData,
        climateContext: {
          ...climate,
          ...patch,
          isConfigured: true,
          sourceTier: 'user-entered-assumption',
          statisticBasis: 'local-observation',
          updatedAt: new Date().toISOString(),
        },
      },
      false
    );
    onUpdateProject(updatedProject);
  };

  const handleUpdateWeight = (key: keyof MaterialRankingWeights, value: number) => {
    const updatedWeights: MaterialRankingWeights = {
      ...advisorData.rankingWeights,
      [key]: value,
    };
    const { updatedProject } = saveProjectMaterialAdvisorSafely(
      project,
      {
        ...advisorData,
        rankingWeights: updatedWeights,
      },
      false
    );
    onUpdateProject(updatedProject);
  };

  const handleResetWeights = () => {
    const { updatedProject } = saveProjectMaterialAdvisorSafely(
      project,
      {
        ...advisorData,
        rankingWeights: { ...DEFAULT_MATERIAL_RANKING_WEIGHTS },
      },
      false
    );
    onUpdateProject(updatedProject);
    showToast?.('Ranking weights reset to balanced defaults.', 'info');
  };

  const handleReEvaluate = () => {
    const { updatedProject } = saveProjectMaterialAdvisorSafely(
      project,
      {
        ...advisorData,
        selectedApplication,
        selectedTargetRoomId,
      },
      false
    );
    onUpdateProject(updatedProject);
    showToast?.(
      'Climate-responsive material evaluations synchronized with current project state.',
      'success'
    );
  };

  const handleOpenPreview = (materialId: string) => {
    const diff = previewMaterialSelection(project, {
      application: selectedApplication,
      materialId,
      targetAlternativeId: project.activeAlternativeId,
      targetRoomScope: selectedTargetRoomId,
    });
    setPreviewDiff(diff);
  };

  const handleConfirmApply = () => {
    if (!previewDiff) return;
    try {
      const result = applyMaterialSelectionSafely(project, previewDiff.request);
      onUpdateProject(result.updatedProject);
      setPreviewDiff(null);
      showToast?.(
        `Applied "${previewDiff.candidateName}" with automatic pre-apply checkpoint.`,
        'success'
      );
    } catch (err: any) {
      showToast?.(err.message || 'Failed to apply material selection.', 'error');
    }
  };

  const handleRollback = () => {
    try {
      const restored = rollbackMaterialAdvisorChanges(project);
      onUpdateProject(restored);
      showToast?.('Rolled back project to pre-apply material checkpoint.', 'info');
    } catch (err: any) {
      showToast?.(err.message || 'Rollback failed.', 'error');
    }
  };

  const handleAddCustomMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomMatErrors([]);
    setCustomMatWarnings([]);

    const catalogue = getAvailableMaterialCatalogue(project);
    const lambdaNum = customMatLambda.trim() !== '' ? Number(customMatLambda) : null;
    const solarNum = customMatSolarRefl.trim() !== '' ? Number(customMatSolarRefl) : null;
    const waterAbsNum = customMatWaterAbs.trim() !== '' ? Number(customMatWaterAbs) : null;
    const maintNum = customMatMaintYears.trim() !== '' ? Number(customMatMaintYears) : null;
    const costNum = customMatCostUsd.trim() !== '' ? Number(customMatCostUsd) : null;

    const generatedId =
      customMatId.trim() ||
      `mat-custom-${customMatName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')}`;

    const validation = validateAndNormalizeCustomMaterial(
      {
        materialId: generatedId,
        displayName: customMatName,
        supportedApplications: [customMatApp],
        mappedFacadeMaterial: customMatFacadeMap,
        mappedInteriorWallFinish: 'limewash-mineral',
        mappedInteriorFloorFinish: 'polished-concrete',
        mappedCostTier: 'Balanced Mid-Range',
        materialClassSummary: customMatSummary,
        thermalConductivityWPerMK: {
          value: lambdaNum,
          unit: 'W/(m·K)',
          evidenceStatus: lambdaNum !== null ? 'user-entered' : 'unavailable',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'User-entered thermal conductivity',
        },
        solarReflectanceFraction: {
          value: solarNum,
          unit: 'fraction (0–1)',
          evidenceStatus: solarNum !== null ? 'user-entered' : 'unavailable',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'User-entered solar reflectance fraction',
        },
        waterAbsorptionPctByWeight: {
          value: waterAbsNum,
          unit: '% by weight',
          evidenceStatus: waterAbsNum !== null ? 'user-entered' : 'unavailable',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'User-entered capillary water absorption',
        },
        moistureSensitivityRating: {
          value: 'moderate-conditional',
          unit: 'rating',
          evidenceStatus: 'user-entered',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'User-entered moisture rating',
        },
        freezeThawResistance: {
          value: customMatIncludeFreezeThaw ? customMatFreezeThaw : null,
          unit: 'rating',
          evidenceStatus: customMatIncludeFreezeThaw ? 'user-entered' : 'unavailable',
          sourceCitation: customMatIncludeFreezeThaw
            ? customMatSourceCitation
            : 'Freeze-thaw test data not provided',
          applicableConditions: 'User-entered freeze-thaw rating',
        },
        coastalSaltCorrosionResistance: {
          value: customMatSalt,
          unit: 'rating',
          evidenceStatus: 'user-entered',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'User-entered coastal salt resistance',
        },
        uvWeatheringResistance: {
          value: customMatUV,
          unit: 'rating',
          evidenceStatus: 'user-entered',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'User-entered UV resistance',
        },
        combustibilityOrWildfireNote: {
          value: 'User-entered custom material; statutory fire testing required.',
          unit: 'classification note',
          evidenceStatus: 'user-entered',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'Preliminary screening only',
        },
        maintenanceIntervalYears: {
          value: maintNum,
          unit: 'years',
          evidenceStatus: maintNum !== null ? 'user-entered' : 'unavailable',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'User-entered maintenance interval',
        },
        expectedServiceLifeYearsRange: {
          value: { minYears: 25, maxYears: 45 },
          unit: 'years',
          evidenceStatus: 'user-entered',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'User-entered service life range',
        },
        relativeCostIndexPerM2Usd: {
          value: costNum,
          unit: 'USD/m²',
          evidenceStatus: costNum !== null ? 'user-entered' : 'unavailable',
          sourceCitation: customMatSourceCitation,
          applicableConditions: 'User-entered installed cost index',
        },
        suitableForInteriorWetRooms: customMatWetRoom,
      },
      catalogue
    );

    if (!validation.isValid || !validation.normalizedCandidate) {
      setCustomMatErrors(validation.errors);
      setCustomMatWarnings(validation.warnings);
      return;
    }

    setCustomMatWarnings(validation.warnings);

    const { updatedProject } = saveProjectMaterialAdvisorSafely(project, {
      ...advisorData,
      customMaterialCatalogue: [
        ...advisorData.customMaterialCatalogue,
        validation.normalizedCandidate,
      ],
    });
    onUpdateProject(updatedProject);
    setSelectedApplication(customMatApp);
    setSelectedCandidateId(validation.normalizedCandidate.materialId);
    setCustomMatId('');
    setCustomMatName('');
    showToast?.(
      `Added custom material "${validation.normalizedCandidate.displayName}" with user-entered provenance.`,
      'success'
    );
  };

  const handleDeleteCustomMaterial = (materialId: string) => {
    const { updatedProject } = saveProjectMaterialAdvisorSafely(project, {
      ...advisorData,
      customMaterialCatalogue: advisorData.customMaterialCatalogue.filter(
        (m) => m.materialId !== materialId
      ),
    });
    onUpdateProject(updatedProject);
    showToast?.('Removed custom material candidate.', 'info');
  };

  // Status badge helper
  const renderSuitabilityBadge = (status: MaterialSuitabilityStatus, size: 'sm' | 'md' = 'sm') => {
    const styles: Record<
      MaterialSuitabilityStatus,
      { bg: string; text: string; border: string; label: string; icon: React.ReactNode }
    > = {
      'suitable-for-screened-conditions': {
        bg: 'bg-emerald-50',
        text: 'text-emerald-800',
        border: 'border-emerald-200',
        label: 'Suitable (Screened)',
        icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />,
      },
      'conditionally-suitable': {
        bg: 'bg-teal-50',
        text: 'text-teal-800',
        border: 'border-teal-200',
        label: 'Conditionally Suitable',
        icon: <ShieldCheck className="w-3.5 h-3.5 text-teal-600 shrink-0" />,
      },
      'concern-identified': {
        bg: 'bg-amber-50',
        text: 'text-amber-800',
        border: 'border-amber-200',
        label: 'Concern Identified',
        icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />,
      },
      'not-recommended-for-screened-conditions': {
        bg: 'bg-rose-50',
        text: 'text-rose-800',
        border: 'border-rose-200',
        label: 'Not Recommended',
        icon: <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />,
      },
      'insufficient-evidence': {
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        border: 'border-slate-300',
        label: 'Insufficient Evidence',
        icon: <HelpCircle className="w-3.5 h-3.5 text-slate-500 shrink-0" />,
      },
      'not-assessed': {
        bg: 'bg-slate-50',
        text: 'text-slate-500',
        border: 'border-slate-200',
        label: 'Not Assessed',
        icon: <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />,
      },
      'requires-professional-review': {
        bg: 'bg-indigo-50',
        text: 'text-indigo-800',
        border: 'border-indigo-200',
        label: 'Requires Professional Review',
        icon: <Info className="w-3.5 h-3.5 text-indigo-600 shrink-0" />,
      },
    };
    const st = styles[status] || styles['insufficient-evidence'];
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${st.bg} ${st.text} ${st.border} ${
          size === 'md' ? 'px-3 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'
        }`}
      >
        {st.icon}
        <span>{st.label}</span>
      </span>
    );
  };

  const renderEvidenceBadge = (status: MaterialEvidenceStatus) => {
    const labels: Record<MaterialEvidenceStatus, { label: string; cls: string }> = {
      'verified-product-data': {
        label: 'Verified Product Data',
        cls: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      },
      'traceable-generic-data': {
        label: 'Traceable Generic Data',
        cls: 'bg-teal-50 text-teal-800 border-teal-200',
      },
      'user-entered': {
        label: 'User-Entered (Unverified)',
        cls: 'bg-amber-50 text-amber-800 border-amber-200',
      },
      'illustrative-default': {
        label: 'Illustrative Default',
        cls: 'bg-sky-50 text-sky-800 border-sky-200',
      },
      unavailable: {
        label: 'Data Unavailable',
        cls: 'bg-rose-50 text-rose-800 border-rose-200',
      },
      'requires-verification': {
        label: 'Requires Verification',
        cls: 'bg-slate-100 text-slate-700 border-slate-300',
      },
    };
    const item = labels[status] || labels['requires-verification'];
    return (
      <span
        className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded border ${item.cls}`}
      >
        {item.label}
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Navigation & Cross-Module Links */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Project</span>
          </button>
          <span className="text-slate-300">|</span>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-teal-900 text-teal-300 font-bold text-[10px] tracking-wider uppercase">
              P35 Engine
            </span>
            <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              Climate-Responsive Material Advisor
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {advisorData.lastPreApplySnapshotId && (
            <button
              onClick={handleRollback}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors cursor-pointer"
              title="Rollback material specification to pre-apply checkpoint"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
              <span>Rollback Last Apply</span>
            </button>
          )}

          {onOpenBrief && (
            <button
              onClick={() => onOpenBrief(project)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <FileText className="w-3.5 h-3.5 text-teal-700" />
              <span>Brief (P30)</span>
            </button>
          )}

          {onOpenDesignComparison && (
            <button
              onClick={() => onOpenDesignComparison(project)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Scale className="w-3.5 h-3.5 text-teal-700" />
              <span>Compare (P31)</span>
            </button>
          )}

          {onOpenDesignPersonalization && (
            <button
              onClick={() => onOpenDesignPersonalization(project)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-700" />
              <span>Personalize (P32)</span>
            </button>
          )}

          {onOpenUniversalAccessibility && (
            <button
              onClick={() => onOpenUniversalAccessibility(project)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Accessibility className="w-3.5 h-3.5 text-teal-700" />
              <span>Accessibility (P34)</span>
            </button>
          )}

          {onOpenDesignStudio && (
            <button
              onClick={() => onOpenDesignStudio(project)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5 text-teal-700" />
              <span>Design Studio</span>
            </button>
          )}
        </div>
      </div>

      {/* Stale Fingerprint Banner */}
      {report.isStale && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-900">
              <span className="font-bold">Stale Evaluation Fingerprint Detected: </span>
              {report.staleReason ||
                'Project climate context, brief constraints, or material specifications have changed since the last saved snapshot.'}
            </div>
          </div>
          <button
            onClick={handleReEvaluate}
            className="px-3 py-1.5 bg-amber-800 hover:bg-amber-900 text-white rounded-lg text-xs font-semibold shrink-0 cursor-pointer transition-colors"
          >
            Synchronize & Re-Evaluate
          </button>
        </div>
      )}

      {/* Climate Context & Exposure Control Panel */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Sun className="w-4 h-4 text-teal-700" />
              <h2 className="text-sm font-bold text-slate-900">
                Project Climate Exposure & Microclimate Context
              </h2>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                  !climate.isConfigured
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : climate.sourceTier === 'user-entered-assumption'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-teal-50 text-teal-800 border-teal-200'
                }`}
              >
                Source: {climate.sourceTier.replace(/-/g, ' ')}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              {climate.sourceCitation} · Solar orientation:{' '}
              <strong>{report.solarOrientationSummary.northOffsetDeg}° True North</strong>, Road
              Facing: <strong>{report.solarOrientationSummary.roadFacing}</strong>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Reference Profile Selector */}
            <select
              value={
                !climate.isConfigured
                  ? 'unconfigured-climate-context'
                  : REFERENCE_CLIMATE_PROFILES.some((p) => p.profileId === climate.profileId)
                  ? climate.profileId
                  : 'custom'
              }
              onChange={(e) => {
                if (e.target.value !== 'custom') {
                  handleSelectReferenceProfile(e.target.value);
                }
              }}
              aria-label="Select Climate Reference Profile"
              className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg"
            >
              <option value="unconfigured-climate-context">
                -- Unconfigured Climate (Explicit Missing Data) --
              </option>
              {REFERENCE_CLIMATE_PROFILES.map((prof) => (
                <option key={prof.profileId} value={prof.profileId}>
                  Profile: {prof.profileName}
                </option>
              ))}
              {climate.sourceTier === 'user-entered-assumption' && (
                <option value="custom">Custom User-Entered Climate Exposure</option>
              )}
            </select>

            {/* Temperature Unit Toggle */}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
              <button
                onClick={() => handleToggleTempUnit('C')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md cursor-pointer transition-colors ${
                  displayUnit === 'C'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                °C (SI)
              </button>
              <button
                onClick={() => handleToggleTempUnit('F')}
                className={`px-2.5 py-1 text-xs font-bold rounded-md cursor-pointer transition-colors ${
                  displayUnit === 'F'
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                °F (IP)
              </button>
            </div>

            <button
              onClick={() => setShowClimateEditor(!showClimateEditor)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer transition-colors"
            >
              <Sliders className="w-3.5 h-3.5 text-teal-700" />
              <span>{showClimateEditor ? 'Hide Climate Controls' : 'Edit Exposure Parameters'}</span>
            </button>
          </div>
        </div>

        {/* Unconfigured Climate Alert */}
        {!climate.isConfigured ? (
          <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200 flex items-start gap-3">
            <HelpCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs text-amber-950">
              <div className="font-bold">
                Climate Exposure Parameters Not Configured (Epistemic Integrity Mode Active)
              </div>
              <p className="text-amber-800 leading-relaxed">
                Plotify does not fabricate ASHRAE climate zone numbers, design temperatures, rainfall, or coastal salt exposure from a bare project name. Select one of the documented reference climate screening profiles above or click <strong>Edit Exposure Parameters</strong> to enter site-specific conditions. Until configured, climate exposure domains report <code>insufficient-evidence</code>.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5 text-xs">
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                Profile
              </span>
              <span className="font-bold text-slate-800 block truncate" title={climate.profileName}>
                {climate.profileName}
              </span>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                Summer High
              </span>
              <span className="font-bold text-slate-900 tabular-nums">
                {formatTemperature(climate.summerDesignHighTempC, displayUnit)}
              </span>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                Winter Low
              </span>
              <span className="font-bold text-slate-900 tabular-nums">
                {formatTemperature(climate.winterDesignLowTempC, displayUnit)}
              </span>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                Humidity / Rain
              </span>
              <span className="font-bold text-slate-800 capitalize block truncate">
                {climate.humidityWettingRegime.replace(/-/g, ' ')}
              </span>
              <span className="text-[10px] text-slate-500 capitalize">
                WDR: {climate.windDrivenRainExposure}
              </span>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                Freeze–Thaw
              </span>
              <span className="font-bold text-slate-800 capitalize">
                {climate.freezeThawExposure.replace(/-/g, ' ')}
              </span>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                Coastal Salt
              </span>
              <span className="font-bold text-slate-800 capitalize">
                {climate.coastalSaltExposure.replace(/-/g, ' ')}
              </span>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                Solar UV
              </span>
              <span className="font-bold text-slate-800 capitalize">
                {climate.solarUvExposure}
              </span>
            </div>
            <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200/80">
              <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                Wildfire / WUI
              </span>
              <span className="font-bold text-slate-800 capitalize">
                {climate.wildfireEmberExposure.replace(/-/g, ' ')}
              </span>
            </div>
          </div>
        )}

        {/* Interactive User-Entered Climate Editor */}
        {showClimateEditor && (
          <div className="pt-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-slate-50/70 p-4 rounded-xl">
            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Summer Design High ({displayUnit === 'F' ? '°F' : '°C'})
              </label>
              <input
                type="number"
                value={
                  climate.summerDesignHighTempC === null
                    ? ''
                    : displayUnit === 'F'
                    ? celsiusToFahrenheit(climate.summerDesignHighTempC)
                    : climate.summerDesignHighTempC
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    handleUpdateClimateField({ summerDesignHighTempC: null });
                  } else {
                    const num = Number(raw);
                    const valC = displayUnit === 'F' ? fahrenheitToCelsius(num) : num;
                    handleUpdateClimateField({ summerDesignHighTempC: valC });
                  }
                }}
                placeholder="e.g. 38"
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Winter Design Low ({displayUnit === 'F' ? '°F' : '°C'})
              </label>
              <input
                type="number"
                value={
                  climate.winterDesignLowTempC === null
                    ? ''
                    : displayUnit === 'F'
                    ? celsiusToFahrenheit(climate.winterDesignLowTempC)
                    : climate.winterDesignLowTempC
                }
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    handleUpdateClimateField({ winterDesignLowTempC: null });
                  } else {
                    const num = Number(raw);
                    const valC = displayUnit === 'F' ? fahrenheitToCelsius(num) : num;
                    handleUpdateClimateField({ winterDesignLowTempC: valC });
                  }
                }}
                placeholder="e.g. -12"
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Humidity & Wetting Regime
              </label>
              <select
                value={climate.humidityWettingRegime}
                onChange={(e) =>
                  handleUpdateClimateField({
                    humidityWettingRegime: e.target.value as HumidityWettingRegime,
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="unknown">Unknown</option>
                <option value="arid-dry">Arid / Dry</option>
                <option value="semi-arid-seasonal">Semi-Arid Seasonal</option>
                <option value="temperate-moderate-moisture">Temperate Moderate Moisture</option>
                <option value="humid-subtropical-or-continental">Humid Subtropical / Continental</option>
                <option value="tropical-wet-or-monsoon">Tropical Wet / Monsoon</option>
                <option value="marine-persistent-damp">Marine Persistent Damp</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Freeze–Thaw Cycling Exposure
              </label>
              <select
                value={climate.freezeThawExposure}
                onChange={(e) =>
                  handleUpdateClimateField({
                    freezeThawExposure: e.target.value as FreezeThawExposureLevel,
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="unknown">Unknown</option>
                <option value="none-frost-free">None (Frost-Free)</option>
                <option value="occasional-freeze-dry-winter">Occasional Freeze (Dry Winter)</option>
                <option value="moderate-freeze-thaw-with-rain">Moderate Freeze–Thaw w/ Rain</option>
                <option value="severe-frequent-freeze-thaw-wet">Severe Frequent Freeze–Thaw (Wet)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Coastal Salt-Spray Exposure
              </label>
              <select
                value={climate.coastalSaltExposure}
                onChange={(e) =>
                  handleUpdateClimateField({
                    coastalSaltExposure: e.target.value as CoastalSaltExposureLevel,
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="unknown">Unknown</option>
                <option value="inland-none">Inland / None</option>
                <option value="coastal-region-1km-to-10km">Coastal Region (1–10 km)</option>
                <option value="coastal-nearshore-300m-to-1km">Coastal Nearshore (300m–1km)</option>
                <option value="severe-marine-surf-under-300m">Severe Marine Surf (&lt; 300m)</option>
                <option value="deicing-salt-runoff">De-icing Salt Runoff</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Wind-Driven Rain Exposure
              </label>
              <select
                value={climate.windDrivenRainExposure}
                onChange={(e) =>
                  handleUpdateClimateField({
                    windDrivenRainExposure: e.target.value as ExposureSeverityLevel,
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="unknown">Unknown</option>
                <option value="none-or-negligible">None or Negligible</option>
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
                <option value="severe">Severe</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Solar UV Exposure
              </label>
              <select
                value={climate.solarUvExposure}
                onChange={(e) =>
                  handleUpdateClimateField({
                    solarUvExposure: e.target.value as ExposureSeverityLevel,
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="unknown">Unknown</option>
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
                <option value="severe">Severe</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-700 mb-1">
                Wildfire / WUI Ember Exposure
              </label>
              <select
                value={climate.wildfireEmberExposure}
                onChange={(e) =>
                  handleUpdateClimateField({
                    wildfireEmberExposure: e.target.value as ExposureSeverityLevel,
                  })
                }
                className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg"
              >
                <option value="unknown">Unknown</option>
                <option value="none-or-negligible">None or Negligible</option>
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
                <option value="severe">Severe</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* P30 Brief & P32 Personalization Alignment Bar */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900">
              P30 Architectural Brief Material Constraints
            </span>
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-teal-50 text-teal-800 border border-teal-200">
              {report.p30Compatibility.confirmedMaterialRequirements.length} Confirmed ·{' '}
              {report.p30Compatibility.unconfirmedMaterialAssumptions.length} Unconfirmed
            </span>
          </div>
          {report.p30Compatibility.confirmedMaterialRequirements.length > 0 ? (
            <ul className="text-xs text-slate-600 space-y-1">
              {report.p30Compatibility.confirmedMaterialRequirements.slice(0, 2).map((req, idx) => (
                <li key={idx} className="flex items-center gap-1.5 truncate">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">{req}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">
              No mandatory confirmed P30 material exclusions active. Unconfirmed AI brief inferences are never treated as hard exclusions.
            </p>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900">
              P32 Adaptive Personalization Material Signals
            </span>
            <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
              {report.p32Compatibility.explicitPreferredMaterials.length} Explicit ·{' '}
              {report.p32Compatibility.inferredUnconfirmedMaterials.length} Inferred
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Explicitly Confirmed Cladding:{' '}
            <strong className="text-slate-900">
              {report.p32Compatibility.explicitPreferredMaterials.length > 0
                ? report.p32Compatibility.explicitPreferredMaterials.join(', ')
                : 'None set'}
            </strong>{' '}
            · Low-Carbon Priority Weight:{' '}
            <strong className="text-slate-900">
              {report.p32Compatibility.lowCarbonPriorityWeight}%
            </strong>
          </p>
        </div>
      </div>

      {/* Main Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl border border-slate-200 shadow-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setActiveSubTab('suitability')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              activeSubTab === 'suitability'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            1. Suitability Matrix & Domain Inspector
          </button>
          <button
            onClick={() => setActiveSubTab('comparison')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              activeSubTab === 'comparison'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            2. Side-by-Side Comparison & Weighted Ranking
          </button>
          <button
            onClick={() => setActiveSubTab('custom-materials')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              activeSubTab === 'custom-materials'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            3. Custom Material Registration ({advisorData.customMaterialCatalogue.length})
          </button>
          <button
            onClick={() => setActiveSubTab('options-summary')}
            className={`px-3.5 py-2 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              activeSubTab === 'options-summary'
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            4. P31 Option Comparison & Disclaimers
          </button>
        </div>

        {/* Application Filter */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold text-slate-600">Application:</label>
          <select
            value={selectedApplication}
            onChange={(e) => {
              setSelectedApplication(e.target.value as MaterialApplicationCategory);
              setSelectedCandidateId(null);
            }}
            aria-label="Select Material Application Scope"
            className="px-3 py-1.5 text-xs font-bold text-teal-950 bg-teal-50 border border-teal-300 rounded-lg"
          >
            {(Object.keys(APPLICATION_LABELS) as MaterialApplicationCategory[]).map((appKey) => (
              <option key={appKey} value={appKey}>
                {APPLICATION_LABELS[appKey]}
              </option>
            ))}
          </select>

          {(selectedApplication === 'interior-wall-finish' ||
            selectedApplication === 'interior-floor-finish') &&
            rooms.length > 0 && (
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-semibold text-slate-600">Target Room:</label>
                <select
                  value={selectedTargetRoomId || rooms[0]?.id}
                  onChange={(e) => setSelectedTargetRoomId(e.target.value)}
                  aria-label="Select Target Room for Interior Finish"
                  className="px-2.5 py-1.5 text-xs font-bold text-indigo-950 bg-indigo-50 border border-indigo-300 rounded-lg"
                >
                  {rooms.map((rm) => (
                    <option key={rm.id} value={rm.id}>
                      {rm.name} ({rm.type})
                    </option>
                  ))}
                </select>
              </div>
            )}
        </div>
      </div>

      {/* TAB 1: SUITABILITY MATRIX & DOMAIN INSPECTOR */}
      {activeSubTab === 'suitability' && (
        <div className="space-y-6">
          {/* Current Project Baseline Material Evaluations */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-teal-700" />
                <h3 className="text-sm font-bold text-slate-900">
                  Current Active Design Specification Audit
                </h3>
              </div>
              <span className="text-xs text-slate-500">
                Evaluated against {climate.profileName}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {report.currentProjectMaterialEvaluations.map((ev, idx) => (
                <div
                  key={`${ev.application}-${ev.materialId}-${idx}`}
                  className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1.5"
                >
                  <div className="text-[10px] font-bold text-slate-400 uppercase truncate">
                    {APPLICATION_LABELS[ev.application]}
                  </div>
                  <div className="text-xs font-bold text-slate-900 truncate">{ev.displayName}</div>
                  <div>{renderSuitabilityBadge(ev.overallStatus)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Candidate List (Left 5 cols) + Detailed Domain Inspector (Right 7 cols) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 space-y-3">
              <div className="text-xs font-bold text-slate-700 uppercase tracking-wider px-1">
                Candidates for {APPLICATION_LABELS[selectedApplication]} (
                {report.activeApplicationEvaluations.length})
              </div>

              {report.activeApplicationEvaluations.map((ev) => {
                const isSelected = activeCandidateReport?.materialId === ev.materialId;
                const cand = report.availableCatalogue.find((c) => c.materialId === ev.materialId);
                return (
                  <div
                    key={ev.materialId}
                    onClick={() => setSelectedCandidateId(ev.materialId)}
                    className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2.5 ${
                      isSelected
                        ? 'bg-teal-50/50 border-teal-500 shadow-xs ring-1 ring-teal-500'
                        : 'bg-white border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-semibold text-slate-400 uppercase block">
                          {ev.recordKind.replace(/-/g, ' ')}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900">{ev.displayName}</h4>
                      </div>
                      {renderSuitabilityBadge(ev.overallStatus)}
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-2">
                      {ev.whySuitableOrUnsuitableSummary}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">
                          Cost:{' '}
                          <strong className="text-slate-800">
                            {cand?.relativeCostIndexPerM2Usd.value !== null
                              ? `~$${cand?.relativeCostIndexPerM2Usd.value}/m²`
                              : 'Unknown'}
                          </strong>
                        </span>
                        {cand?.embodiedCarbonKgCo2ePerM2GfaRef.value !== null && (
                          <span className="text-slate-500">
                            · Carbon Ref:{' '}
                            <strong className="text-slate-800">
                              {cand?.embodiedCarbonKgCo2ePerM2GfaRef.value} kg/m²
                            </strong>
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenPreview(ev.materialId);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-[11px] font-semibold cursor-pointer"
                      >
                        <Eye className="w-3 h-3 text-teal-400" />
                        <span>Preview & Apply</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Detailed Candidate Inspector (7 cols) */}
            <div className="lg:col-span-7">
              {activeCandidateReport && activeCandidateRecord ? (
                <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-4 border-b border-slate-200">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        {renderEvidenceBadge(activeCandidateRecord.overallEvidenceStatus)}
                        <span className="text-slate-300">·</span>
                        <span className="text-xs text-slate-500 font-mono">
                          ID: {activeCandidateReport.materialId}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-slate-900">
                        {activeCandidateReport.displayName}
                      </h3>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        {activeCandidateRecord.materialClassSummary}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {renderSuitabilityBadge(activeCandidateReport.overallStatus, 'md')}
                      <button
                        onClick={() => handleOpenPreview(activeCandidateReport.materialId)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview & Apply Selection</span>
                      </button>
                    </div>
                  </div>

                  {/* Summary Rationale */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <div className="text-[11px] font-bold text-slate-800 uppercase">
                      Suitability Rationale & Evaluation Basis ({activeCandidateReport.evaluationBasis})
                    </div>
                    <p className="text-xs text-slate-700 leading-relaxed">
                      {activeCandidateReport.whySuitableOrUnsuitableSummary}
                    </p>
                  </div>

                  {/* Missing Evidence & Required Conditions */}
                  {(activeCandidateReport.missingEvidenceItems.length > 0 ||
                    activeCandidateReport.conditionsAndProfessionalChecksRequired.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {activeCandidateReport.missingEvidenceItems.length > 0 && (
                        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1.5">
                          <div className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                            <HelpCircle className="w-4 h-4 text-amber-700" />
                            <span>Missing Evidence / Unverified Properties</span>
                          </div>
                          <ul className="text-xs text-amber-800 list-disc list-inside space-y-1">
                            {activeCandidateReport.missingEvidenceItems.map((item, idx) => (
                              <li key={idx}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {activeCandidateReport.conditionsAndProfessionalChecksRequired.length > 0 && (
                        <div className="p-3.5 rounded-xl bg-sky-50 border border-sky-200 space-y-1.5">
                          <div className="text-xs font-bold text-sky-900 flex items-center gap-1.5">
                            <ShieldCheck className="w-4 h-4 text-sky-700" />
                            <span>Required Assembly Conditions</span>
                          </div>
                          <ul className="text-xs text-sky-800 list-disc list-inside space-y-1">
                            {activeCandidateReport.conditionsAndProfessionalChecksRequired.map(
                              (cond, idx) => (
                                <li key={idx}>{cond}</li>
                              )
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Climate Exposure Domains Evaluation */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Domain-by-Domain Climate & Assembly Evaluation
                    </h4>
                    <div className="space-y-2.5">
                      {activeCandidateReport.domainEvaluations.map((dom) => (
                        <div
                          key={dom.domainId}
                          className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 space-y-1.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-900">
                              {dom.domainTitle}
                            </span>
                            {renderSuitabilityBadge(dom.status)}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            <strong>Observed Exposure:</strong> {dom.climateExposureObserved}
                          </div>
                          <p className="text-xs text-slate-700 leading-relaxed">
                            {dom.explanation}
                          </p>
                          {dom.conditionsOrDetailingRequired.length > 0 && (
                            <div className="text-[11px] text-teal-800 bg-teal-50/80 px-2.5 py-1 rounded border border-teal-200">
                              <strong>Conditions:</strong>{' '}
                              {dom.conditionsOrDetailingRequired.join(' · ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SIDE-BY-SIDE COMPARISON & WEIGHTED RANKING */}
      {activeSubTab === 'comparison' && (
        <div className="space-y-6">
          {/* Adjustable Ranking Weights Panel */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Deterministic Multi-Criteria Ranking Weights
                </h3>
                <p className="text-xs text-slate-600">
                  Hard climate disqualifications and confirmed P30 exclusions are tracked strictly separately from weighted preference scores. Missing evidence contributes 0 points while keeping full criterion weight in the denominator.
                </p>
              </div>
              <button
                onClick={handleResetWeights}
                className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer self-start"
              >
                Reset Weights
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {(
                [
                  { key: 'climateSuitability', label: 'Climate Exposure Suitability' },
                  { key: 'durabilityAndWeathering', label: 'Durability & Weathering' },
                  { key: 'lowMaintenance', label: 'Low Maintenance Frequency' },
                  { key: 'thermalAndMoistureFit', label: 'Thermal & Moisture Control' },
                  { key: 'costPredictability', label: 'Cost Index Sensitivity' },
                  { key: 'userPreferenceMatch', label: 'P32 Explicit Preference Match' },
                  { key: 'embodiedCarbonReference', label: 'Embodied Carbon Benchmark' },
                ] as { key: keyof MaterialRankingWeights; label: string }[]
              ).map((item) => (
                <div
                  key={item.key}
                  className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">{item.label}</span>
                    <span className="font-bold text-teal-800 tabular-nums">
                      {advisorData.rankingWeights[item.key]}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    step={5}
                    value={advisorData.rankingWeights[item.key]}
                    onChange={(e) => handleUpdateWeight(item.key, Number(e.target.value))}
                    className="w-full accent-teal-700 cursor-pointer"
                  />
                </div>
              ))}
            </div>

            <div className="p-3 rounded-lg bg-teal-50/70 border border-teal-200 text-xs text-teal-900">
              <strong>Weight Sensitivity & Tie-Break Notice:</strong>{' '}
              {comparisonResult.rankingSensitivityExplanation}
            </div>
          </div>

          {/* Side-by-Side Comparison Matrix */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                Side-by-Side Comparison: {APPLICATION_LABELS[selectedApplication]}
              </h3>
              <span className="text-xs text-slate-500">
                {comparisonResult.entries.length} Candidates Ranked
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                    <th className="py-3 px-4">Rank & Material Candidate</th>
                    <th className="py-3 px-4">Climate Status</th>
                    <th className="py-3 px-4">Hard Screen (Mandatory / Climate)</th>
                    <th className="py-3 px-4">Preference Score</th>
                    <th className="py-3 px-4">Data Coverage</th>
                    <th className="py-3 px-4">Strengths & Trade-offs</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {comparisonResult.entries.map((entry, index) => (
                    <tr key={entry.candidate.materialId} className="hover:bg-slate-50/80 align-top">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                            {index + 1}
                          </span>
                          <div>
                            <div className="font-bold text-slate-900">
                              {entry.candidate.displayName}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {entry.candidate.mappedCostTier}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        {renderSuitabilityBadge(entry.suitability.overallStatus)}
                      </td>
                      <td className="py-3.5 px-4">
                        {entry.meetsMandatoryAndClimateScreen ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[11px] font-semibold">
                            <Check className="w-3 h-3" /> Passes Screen
                          </span>
                        ) : (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200 text-[11px] font-semibold">
                              <X className="w-3 h-3" /> Screen Held
                            </span>
                            {entry.mandatoryOrClimateBlockReasons.map((r, i) => (
                              <div key={i} className="text-[10px] text-rose-700 max-w-xs">
                                • {r}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="text-sm font-bold text-slate-900 tabular-nums">
                          {entry.weightedPreferenceScore !== null
                            ? `${entry.weightedPreferenceScore} / 100`
                            : 'Unconfigured'}
                        </div>
                        {entry.missingDataPenaltyApplied && (
                          <span className="text-[10px] text-amber-700 font-semibold block">
                            0 pts on missing fields
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-bold text-slate-800 tabular-nums">
                          {entry.dataCoveragePercent}% ({entry.availableCriteriaCount}/
                          {entry.totalActiveCriteriaCount})
                        </span>
                      </td>
                      <td className="py-3.5 px-4 max-w-xs space-y-1">
                        {entry.leadingStrengths.slice(0, 2).map((p, i) => (
                          <div key={i} className="text-[11px] text-emerald-800">
                            + {p}
                          </div>
                        ))}
                        {entry.leadingTradeOffs.slice(0, 2).map((r, i) => (
                          <div key={i} className="text-[11px] text-amber-800">
                            ! {r}
                          </div>
                        ))}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleOpenPreview(entry.candidate.materialId)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5 text-teal-400" />
                          <span>Preview</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: CUSTOM MATERIAL REGISTRATION */}
      {activeSubTab === 'custom-materials' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Register Custom Project Material Candidate
              </h3>
              <p className="text-xs text-slate-600 mt-0.5">
                Custom material properties are validated and strictly labeled as{' '}
                <code>user-entered</code> (never promoted to verified manufacturer test data). Leaving a property blank marks it <code>unavailable</code> so missing evidence is transparently surfaced.
              </p>
            </div>

            {customMatErrors.length > 0 && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 space-y-1">
                <div className="font-bold">Validation Errors:</div>
                <ul className="list-disc list-inside">
                  {customMatErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {customMatWarnings.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                <div className="font-bold">Provenance Notices:</div>
                <ul className="list-disc list-inside">
                  {customMatWarnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <form onSubmit={handleAddCustomMaterial} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Material Display Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={customMatName}
                    onChange={(e) => setCustomMatName(e.target.value)}
                    placeholder="e.g. Honed Basalt Rainscreen Tile"
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Application Scope *
                  </label>
                  <select
                    value={customMatApp}
                    onChange={(e) => setCustomMatApp(e.target.value as MaterialApplicationCategory)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    {(Object.keys(APPLICATION_LABELS) as MaterialApplicationCategory[]).map((k) => (
                      <option key={k} value={k}>
                        {APPLICATION_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Mapped Plotify Facade Family
                  </label>
                  <select
                    value={customMatFacadeMap}
                    onChange={(e) => setCustomMatFacadeMap(e.target.value as FacadeMaterial)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="stone">stone (330 kg CO₂e/m²)</option>
                    <option value="brick">brick (390 kg CO₂e/m²)</option>
                    <option value="timber">timber (180 kg CO₂e/m²)</option>
                    <option value="plaster">plaster (290 kg CO₂e/m²)</option>
                    <option value="concrete">concrete (490 kg CO₂e/m²)</option>
                    <option value="glass">glass (530 kg CO₂e/m²)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Thermal Conductivity λ (W/(m·K))
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={customMatLambda}
                    onChange={(e) => setCustomMatLambda(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Solar Reflectance (0–1 fraction, blank if unknown)
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    value={customMatSolarRefl}
                    onChange={(e) => setCustomMatSolarRefl(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Water Absorption (% by weight, blank if unknown)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={customMatWaterAbs}
                    onChange={(e) => setCustomMatWaterAbs(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Freeze–Thaw Resistance
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={customMatIncludeFreezeThaw}
                      onChange={(e) => setCustomMatIncludeFreezeThaw(e.target.checked)}
                    />
                    <span className="text-[11px] text-slate-600">Known</span>
                    {customMatIncludeFreezeThaw && (
                      <select
                        value={customMatFreezeThaw}
                        onChange={(e) => setCustomMatFreezeThaw(e.target.value as ResistanceRating)}
                        className="flex-1 px-2 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="high-resistant">High Resistant</option>
                        <option value="moderate-conditional">Moderate Conditional</option>
                        <option value="low-sensitive">Low / Sensitive</option>
                      </select>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Coastal Salt Corrosion Resistance
                  </label>
                  <select
                    value={customMatSalt}
                    onChange={(e) => setCustomMatSalt(e.target.value as ResistanceRating)}
                    className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  >
                    <option value="high-resistant">High Resistant</option>
                    <option value="moderate-conditional">Moderate Conditional</option>
                    <option value="low-sensitive">Low / Sensitive</option>
                  </select>
                </div>
              </div>

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                <Plus className="w-4 h-4 text-teal-400" />
                <span>Validate & Add Custom Material Candidate</span>
              </button>
            </form>
          </div>

          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Registered Custom Materials ({advisorData.customMaterialCatalogue.length})
            </h3>
            {advisorData.customMaterialCatalogue.length === 0 ? (
              <p className="text-xs text-slate-500">
                No custom materials registered for this project yet. Built-in reference materials are always available.
              </p>
            ) : (
              <div className="space-y-3">
                {advisorData.customMaterialCatalogue.map((cm) => (
                  <div
                    key={cm.materialId}
                    className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="text-xs font-bold text-slate-900">{cm.displayName}</div>
                      <div className="text-[11px] text-slate-500">
                        {cm.supportedApplications.map((a) => APPLICATION_LABELS[a]).join(', ')}
                      </div>
                      {renderEvidenceBadge(cm.overallEvidenceStatus)}
                    </div>
                    <button
                      onClick={() => handleDeleteCustomMaterial(cm.materialId)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg cursor-pointer"
                      title="Remove custom material"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: P31 OPTION MATERIAL COMPARISON & DISCLAIMERS */}
      {activeSubTab === 'options-summary' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  P31 Multi-Option Climate Material Comparison Summary
                </h3>
                <p className="text-xs text-slate-600">
                  Deterministic evaluation of all saved DesignAlternatives against the active project climate context ({climate.profileName}).
                </p>
              </div>
              {onOpenDesignComparison && (
                <button
                  onClick={() => onOpenDesignComparison(project)}
                  className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-200 rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Open P31 Comparison Workspace →
                </button>
              )}
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                    <th className="py-3 px-4">Design Option</th>
                    <th className="py-3 px-4">Primary Cladding</th>
                    <th className="py-3 px-4">Primary Climate Status</th>
                    <th className="py-3 px-4">Concerns / Insufficient</th>
                    <th className="py-3 px-4">Ref Embodied Carbon</th>
                    <th className="py-3 px-4">Summary Explanation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {p31MaterialSummaries.map((opt) => (
                    <tr key={opt.optionId} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-bold text-slate-900">{opt.optionName}</td>
                      <td className="py-3 px-4 text-slate-700">{opt.primaryFacadeMaterialName}</td>
                      <td className="py-3 px-4">
                        {renderSuitabilityBadge(opt.primaryFacadeSuitabilityStatus)}
                      </td>
                      <td className="py-3 px-4 font-mono">
                        <span className="text-rose-700 font-bold">
                          {opt.concernsOrNotRecommendedCount}
                        </span>{' '}
                        /{' '}
                        <span className="text-amber-700 font-bold">
                          {opt.insufficientEvidenceCount}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-800">
                        {opt.embodiedCarbonIntensityKgPerM2Ref ?? 'N/A'} kg CO₂e/m²
                      </td>
                      <td className="py-3 px-4 text-slate-600">{opt.summaryExplanation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Explicit P35 Scope & Compliance Disclaimers */}
          <div className="bg-slate-900 text-slate-200 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2 text-teal-400 font-bold text-xs uppercase tracking-wider">
              <Info className="w-4 h-4" />
              <span>P35 Architectural & Engineering Scope Disclaimers</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">{report.complianceDisclaimer}</p>
            <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
              {report.roadmapScopeBoundaries.map((b) => (
                <li key={b.roadmapId}>
                  <strong>
                    {b.roadmapId} ({b.title}):
                  </strong>{' '}
                  {b.boundaryStatement}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* NON-DESTRUCTIVE PREVIEW & ATOMIC APPLY MODAL */}
      {previewDiff && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200">
              <div>
                <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-900 text-[10px] font-bold uppercase">
                  Non-Destructive Preview & Safety Check
                </span>
                <h3 className="text-base font-bold text-slate-900 mt-1">
                  Apply "{previewDiff.candidateName}" ({APPLICATION_LABELS[previewDiff.request.application]})
                </h3>
              </div>
              <button
                onClick={() => setPreviewDiff(null)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
              <span className="text-xs font-semibold text-slate-700">
                Evaluated Climate Suitability Status:
              </span>
              {renderSuitabilityBadge(previewDiff.suitabilityStatus, 'md')}
            </div>

            {/* Proposed Field Changes */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-800 uppercase">
                Proposed Specification Field Changes
              </h4>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                      <th className="py-2 px-3">Field</th>
                      <th className="py-2 px-3">Before (Saved)</th>
                      <th className="py-2 px-3">After (Proposed)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {previewDiff.fieldChanges.map((fc, i) => (
                      <tr key={i}>
                        <td className="py-2 px-3 font-semibold text-slate-800">{fc.label}</td>
                        <td className="py-2 px-3 font-mono text-slate-500">{fc.beforeValue}</td>
                        <td className="py-2 px-3 font-mono font-bold text-teal-800">
                          {fc.afterValue}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {previewDiff.warningNotices.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
                <div className="text-xs font-bold text-amber-900">Warnings & Conditions:</div>
                <ul className="text-xs text-amber-800 list-disc list-inside space-y-1">
                  {previewDiff.warningNotices.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {!previewDiff.isSafeToApply && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900">
                <strong>Application Blocked:</strong> {previewDiff.blockingReasons.join(' ')}
              </div>
            )}

            <div className="text-[11px] text-slate-500">
              Applying this material creates an automatic pre-apply checkpoint snapshot via Plotify Versioning Service so you can rollback at any time. Saved 2D room dimensions and floor-plan geometry are never altered.
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
              <button
                onClick={() => setPreviewDiff(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Cancel (Keep Preview Only)
              </button>
              <button
                disabled={!previewDiff.isSafeToApply}
                onClick={handleConfirmApply}
                className={`px-4 py-2 text-xs font-bold rounded-lg inline-flex items-center gap-1.5 ${
                  previewDiff.isSafeToApply
                    ? 'bg-teal-700 hover:bg-teal-800 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Check className="w-4 h-4" />
                <span>Confirm & Apply Specification</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
