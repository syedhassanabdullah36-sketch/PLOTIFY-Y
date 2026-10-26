import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Info,
  Layers,
  Scale,
  Eye,
  Save,
  RotateCcw,
  Trash2,
  PenTool,
  Palette,
  RefreshCw,
  ShieldAlert,
  X,
  Lock,
  Check,
  History,
} from 'lucide-react';
import {
  FacadeConcept,
  Project,
} from '../../types/project';
import {
  P32_PERSONALIZATION_ENGINE_VERSION,
  PersonalizationEvaluationResult,
  PersonalizationPreviewDiff,
  PersonalizedOptionRecommendation,
  PreferenceConfirmationStatus,
  PreferenceOrigin,
  ProjectPersonalizationProfile,
  SpatialPriorityKey,
} from '../../types/designPersonalization';
import {
  P32_COMPLIANCE_AND_PRIVACY_DISCLAIMER,
  SPATIAL_PRIORITY_DEFINITIONS,
  SUPPORTED_COST_TIERS,
  SUPPORTED_FACADE_STYLES,
  SUPPORTED_PRIMARY_MATERIALS,
  applyPersonalizedOptionSafely,
  buildPersonalizationPreview,
  evaluateDesignPersonalization,
  initializePersonalizationProfile,
  removePersonalizationProfileFromProject,
  resetPersonalizationProfile,
  reviewPersonalizationPreferenceItem,
  rollbackPersonalizationToSnapshot,
  savePersonalizationProfileToProject,
  shouldApplyPersonalizationResult,
  updatePersonalizationProfile,
} from '../../services/designPersonalizationService';
import { initializeProjectScenarios } from '../../services/scenarioCalculator';
import { ProjectSnapshot } from '../../types/versioning';
import { formatCurrency } from '../../utils/formatters';

interface AdaptivePersonalizationWorkspaceProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onBack: () => void;
  onOpenBrief?: (project: Project) => void;
  onOpenDesignComparison?: (project: Project) => void;
  onOpenFloorPlan?: (project: Project) => void;
  onOpenDesignStudio?: (project: Project) => void;
  onOpenVersionWorkspace?: (
    project: Project,
    tab?: 'timeline' | 'diff' | 'recovery' | 'collaboration'
  ) => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const AdaptivePersonalizationWorkspace: React.FC<
  AdaptivePersonalizationWorkspaceProps
> = ({
  project,
  onUpdateProject,
  onBack,
  onOpenBrief,
  onOpenDesignComparison,
  onOpenFloorPlan,
  onOpenDesignStudio,
  onOpenVersionWorkspace,
  showToast,
}) => {
  const [profile, setProfile] = useState<ProjectPersonalizationProfile>(() =>
    initializePersonalizationProfile(project)
  );
  const [activeTab, setActiveTab] = useState<
    'recommendations' | 'preferences' | 'provenance-review' | 'conflicts'
  >('recommendations');
  const [inspectedRecommendation, setInspectedRecommendation] =
    useState<PersonalizedOptionRecommendation | null>(null);
  const [previewProposal, setPreviewProposal] =
    useState<PersonalizationPreviewDiff | null>(null);
  const [lastAppliedCheckpoint, setLastAppliedCheckpoint] = useState<{
    snapshot: ProjectSnapshot;
    optionName: string;
  } | null>(null);

  // Sync profile if project changes externally
  useEffect(() => {
    setProfile(initializePersonalizationProfile(project));
  }, [project.id]);

  const requestSequenceRef = useRef<number>(1);
  const lastEvaluationRef = useRef<PersonalizationEvaluationResult | null>(null);

  const evaluation = useMemo(() => {
    requestSequenceRef.current += 1;
    const seq = requestSequenceRef.current;
    const computed = evaluateDesignPersonalization(project, profile, {
      requestSequenceId: seq,
    });
    if (shouldApplyPersonalizationResult(lastEvaluationRef.current, computed)) {
      lastEvaluationRef.current = computed;
      return computed;
    }
    return lastEvaluationRef.current || computed;
  }, [project, profile]);

  const handleToggleStyle = (style: FacadeConcept['style']) => {
    const current = profile.preferredFacadeStyles;
    const next = current.includes(style)
      ? current.filter((s) => s !== style)
      : [...current, style];
    setProfile(
      updatePersonalizationProfile(project, profile, {
        preferredFacadeStyles: next,
      })
    );
  };

  const handleToggleMaterial = (mat: FacadeConcept['primaryMaterial']) => {
    const current = profile.preferredPrimaryMaterials;
    const next = current.includes(mat)
      ? current.filter((m) => m !== mat)
      : [...current, mat];
    setProfile(
      updatePersonalizationProfile(project, profile, {
        preferredPrimaryMaterials: next,
      })
    );
  };

  const handleToggleCostTier = (tier: FacadeConcept['costTier']) => {
    const current = profile.preferredCostTiers;
    const next = current.includes(tier)
      ? current.filter((t) => t !== tier)
      : [...current, tier];
    setProfile(
      updatePersonalizationProfile(project, profile, {
        preferredCostTiers: next,
      })
    );
  };

  const handleStoreyChange = (floors: number | null) => {
    setProfile(
      updatePersonalizationProfile(project, profile, {
        preferredFloors: floors,
      })
    );
  };

  const handlePriorityWeightChange = (key: SpatialPriorityKey, weight: number) => {
    setProfile(
      updatePersonalizationProfile(project, profile, {
        spatialPriorityWeights: { [key]: weight },
      })
    );
  };

  const handleBudgetCapChange = (maxBudgetStr: string, isHardCap: boolean) => {
    const parsed = Number(maxBudgetStr);
    const maxBudget =
      maxBudgetStr.trim() === '' || !Number.isFinite(parsed) || parsed <= 0
        ? null
        : Math.round(parsed);
    setProfile(
      updatePersonalizationProfile(project, profile, {
        budgetRange: {
          maxBudget,
          targetBudget: maxBudget,
          isHardCap,
        },
      })
    );
  };

  const handleReviewItem = (
    itemId: string,
    status: 'confirmed' | 'unconfirmed-suggestion' | 'rejected'
  ) => {
    setProfile((prev) =>
      reviewPersonalizationPreferenceItem(prev, itemId, {
        confirmationStatus: status,
      })
    );
    showToast?.(
      status === 'confirmed'
        ? 'Confirmed preference item for personalization matching.'
        : status === 'rejected'
        ? 'Excluded preference item from personalization.'
        : 'Marked item as unconfirmed suggestion.',
      'info'
    );
  };

  const handleSavePreferences = () => {
    const updatedProject = savePersonalizationProfileToProject(project, profile);
    setProfile(updatedProject.designPersonalization!);
    onUpdateProject(updatedProject);
    showToast?.(
      'Saved project personalization preferences without modifying underlying designs.',
      'success'
    );
  };

  const handleResetPreferences = () => {
    const fresh = resetPersonalizationProfile(project);
    setProfile(fresh);
    showToast?.('Reset preferences to imported project facts.', 'info');
  };

  const handleRemovePreferences = () => {
    const cleaned = removePersonalizationProfileFromProject(project);
    setProfile(initializePersonalizationProfile(cleaned));
    onUpdateProject(cleaned);
    showToast?.('Removed saved personalization profile from project.', 'info');
  };

  const handleInitializeScenarios = () => {
    const initialized = initializeProjectScenarios(project);
    const updatedProject: Project = {
      ...project,
      scenarios: initialized,
      updatedAt: new Date().toISOString(),
    };
    onUpdateProject(updatedProject);
    showToast?.(
      `Loaded ${initialized.length} spatial design scenarios for personalization evaluation.`,
      'success'
    );
  };

  const handleOpenPreview = (optionId: string) => {
    const preview = buildPersonalizationPreview(project, optionId);
    if (!preview) {
      showToast?.('Could not build preview for the selected option.', 'error');
      return;
    }
    setPreviewProposal(preview);
  };

  const handleConfirmApplyOption = () => {
    if (!previewProposal) return;
    const res = applyPersonalizedOptionSafely(
      project,
      profile,
      previewProposal.optionId
    );
    if (!res.success || !res.updatedProject || !res.safetySnapshot) {
      showToast?.(res.error || 'Failed to apply option safely.', 'error');
      return;
    }

    setLastAppliedCheckpoint({
      snapshot: res.safetySnapshot,
      optionName: previewProposal.optionName,
    });
    setPreviewProposal(null);
    onUpdateProject(res.updatedProject);
    showToast?.(
      `Applied "${previewProposal.optionName}" with safety checkpoint (${res.safetySnapshot.versionTag}).`,
      'success'
    );
  };

  const handleRollbackLastApply = () => {
    if (!lastAppliedCheckpoint) return;
    const res = rollbackPersonalizationToSnapshot(
      project,
      lastAppliedCheckpoint.snapshot
    );
    if (!res.success || !res.restoredProject) {
      showToast?.(res.error || 'Rollback failed.', 'error');
      return;
    }
    onUpdateProject(res.restoredProject);
    const rolledBackFrom = lastAppliedCheckpoint.optionName;
    setLastAppliedCheckpoint(null);
    showToast?.(
      `Rolled back project to pre-application safety checkpoint (before "${rolledBackFrom}").`,
      'success'
    );
  };

  const renderOriginText = (
    origin: PreferenceOrigin,
    status: PreferenceConfirmationStatus
  ) => {
    if (origin === 'explicit-user' && status === 'confirmed') {
      return (
        <span className="text-[11px] font-semibold text-teal-800">
          Explicit User Preference · Confirmed
        </span>
      );
    }
    if (origin === 'imported-project-fact' && status === 'confirmed') {
      return (
        <span className="text-[11px] font-semibold text-slate-700">
          Imported Project Fact · Confirmed
        </span>
      );
    }
    if (status === 'unconfirmed-suggestion' || origin === 'inferred-suggestion') {
      return (
        <span className="text-[11px] font-semibold text-amber-800">
          Inferred Suggestion · Awaiting Confirmation
        </span>
      );
    }
    if (status === 'rejected') {
      return (
        <span className="text-[11px] font-medium text-rose-700">
          Rejected by User
        </span>
      );
    }
    return (
      <span className="text-[11px] font-medium text-slate-500">
        Unknown / Unspecified
      </span>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="space-y-1">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Project Overview</span>
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Sliders className="w-5 h-5 text-teal-700" />
              <span>Adaptive Design Personalization</span>
            </h1>
            <span className="text-xs text-slate-500 font-mono">
              P32 · {P32_PERSONALIZATION_ENGINE_VERSION}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Discover and evaluate real project design options matched to your explicit preferences, priorities, and confirmed P30 brief constraints.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenBrief && (
            <button
              onClick={() => onOpenBrief(project)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Layers className="w-3.5 h-3.5 text-teal-700" />
              <span>
                P30 Brief ({evaluation.p30CompatibilitySummary.confirmedRequirementsImported} Confirmed)
              </span>
            </button>
          )}
          {onOpenDesignComparison && (
            <button
              onClick={() => onOpenDesignComparison(project)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Scale className="w-3.5 h-3.5 text-teal-700" />
              <span>P31 Comparison Matrix</span>
            </button>
          )}
          {onOpenFloorPlan && (
            <button
              onClick={() => onOpenFloorPlan(project)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <PenTool className="w-3.5 h-3.5 text-teal-700" />
              <span>2D Plan</span>
            </button>
          )}
          {onOpenDesignStudio && (
            <button
              onClick={() => onOpenDesignStudio(project)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Palette className="w-3.5 h-3.5 text-teal-700" />
              <span>Design Studio</span>
            </button>
          )}
          <button
            onClick={handleSavePreferences}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
          >
            <Save className="w-3.5 h-3.5 text-teal-400" />
            <span>Save Preferences</span>
          </button>
        </div>
      </div>

      {/* Privacy, Non-Mutation & Scope Disclaimer */}
      <div
        role="region"
        aria-label="Personalization privacy and methodology notice"
        className="bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed text-slate-200">
            <span className="font-bold text-white">
              User-Controlled & Evidence-Bounded:{' '}
            </span>
            {P32_COMPLIANCE_AND_PRIVACY_DISCLAIMER}
          </div>
        </div>
        <div className="text-[11px] text-slate-300 font-mono shrink-0">
          {evaluation.explicitConfirmedCount} Explicit · {evaluation.importedFactsCount} Imported ·{' '}
          {evaluation.inferredUnconfirmedCount} Unconfirmed
        </div>
      </div>

      {/* Safety Checkpoint & One-Click Rollback Banner (shown after an option is applied) */}
      {lastAppliedCheckpoint && (
        <div
          role="status"
          aria-live="polite"
          className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3 text-xs text-emerald-950">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold">
                Applied &ldquo;{lastAppliedCheckpoint.optionName}&rdquo; with Safety Checkpoint ({lastAppliedCheckpoint.snapshot.versionTag})
              </div>
              <p className="text-emerald-800 mt-0.5">
                A full pre-application snapshot was recorded. You can revert to the exact prior project state at any time.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRollbackLastApply}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-800 hover:bg-emerald-900 rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Rollback to Safety Checkpoint</span>
            </button>
            {onOpenVersionWorkspace && (
              <button
                onClick={() => onOpenVersionWorkspace(project, 'timeline')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-white hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors cursor-pointer"
              >
                <History className="w-3.5 h-3.5" />
                <span>View Revision History</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Stale Personalization Notice */}
      {evaluation.isStale && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs text-amber-950">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              <strong>Updated State Detected:</strong> {evaluation.staleReason} Recommendations below have been automatically recomputed against current project data.
            </span>
          </div>
          <button
            onClick={handleSavePreferences}
            className="px-3 py-1 bg-amber-900 text-white rounded-lg font-semibold cursor-pointer shrink-0"
          >
            Save Updated Profile
          </button>
        </div>
      )}

      {/* Workspace Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
        <div
          role="tablist"
          aria-label="Personalization workspace views"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'recommendations'}
            onClick={() => setActiveTab('recommendations')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'recommendations'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>
              Ranked Option Suggestions ({evaluation.recommendations.length})
            </span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'preferences'}
            onClick={() => setActiveTab('preferences')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'preferences'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Capture & Edit Preferences</span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'provenance-review'}
            onClick={() => setActiveTab('provenance-review')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'provenance-review'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>
              Assumptions & Provenance Ledger ({evaluation.inferredUnconfirmedCount} Unconfirmed)
            </span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'conflicts'}
            onClick={() => setActiveTab('conflicts')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'conflicts'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>
              Conflicts & Roadmap Scope ({evaluation.conflicts.length})
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleInitializeScenarios}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5 text-teal-700" />
            <span>
              {project.scenarios && project.scenarios.length > 0
                ? 'Refresh Spatial Scenarios'
                : 'Load Spatial Scenarios'}
            </span>
          </button>
          <button
            onClick={handleResetPreferences}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            title="Reset preferences to imported project facts"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
          {project.designPersonalization && (
            <button
              onClick={handleRemovePreferences}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 border border-rose-200 rounded-lg transition-colors cursor-pointer"
              title="Remove saved project personalization preferences"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Remove Profile</span>
            </button>
          )}
        </div>
      </div>

      {/* TAB 1: Ranked Option Suggestions & Explanations */}
      {activeTab === 'recommendations' && (
        <div className="space-y-5">
          {/* Sensitivity & Conflict Summary Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="font-bold text-slate-900">
                Deterministic Matching & Ranking Basis (P31 + P32 Engine)
              </div>
              <p className="text-slate-600">
                {evaluation.rankingSensitivityExplanation}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0 text-slate-600">
              <span>
                Options Evaluated: <strong>{evaluation.recommendations.length}</strong>
              </span>
              <span>·</span>
              <span>
                Active Conflicts: <strong>{evaluation.conflicts.length}</strong>
              </span>
            </div>
          </div>

          {/* Option Cards */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {evaluation.recommendations.map((rec, idx) => (
              <div
                key={rec.optionId}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4"
              >
                <div className="space-y-3">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
                    <div>
                      <div className="text-[11px] font-semibold text-teal-800">
                        Rank #{idx + 1} ·{' '}
                        {rec.optionKind === 'baseline-project'
                          ? 'Baseline Project'
                          : rec.optionKind === 'design-scenario'
                          ? 'Spatial Scenario'
                          : 'Specification Alternative'}
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-0.5">
                        {rec.optionName}
                      </h3>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        {rec.optionId} · Data Coverage: {rec.dataCoveragePercent}%
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xl font-bold text-slate-900 tabular-nums">
                        {rec.preferenceMatchScore !== null
                          ? `${rec.preferenceMatchScore} / 100`
                          : 'N/A'}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Soft Preference Match
                      </div>
                    </div>
                  </div>

                  {/* Hard Constraint Status (Strictly Separated from Soft Score) */}
                  <div
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-2 ${
                      rec.hardConstraintsAllMet
                        ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                        : 'bg-rose-50/80 border-rose-200 text-rose-950'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      {rec.hardConstraintsAllMet ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-700 shrink-0" />
                      )}
                      <span>
                        Hard Constraints:{' '}
                        {rec.hardConstraintsAllMet
                          ? `All ${rec.hardConstraintsMetCount} Satisfied`
                          : `${rec.hardConstraintsViolatedCount} Conflict(s), ${rec.hardConstraintsUnassessedCount} Unverified`}
                      </span>
                    </div>
                    <span className="text-[11px]">
                      {rec.hardConstraintsMetCount} Met
                    </span>
                  </div>

                  {/* Why Suggested */}
                  <div className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <strong className="text-slate-900">Why Suggested: </strong>
                    {rec.whySuggestedExplanation}
                  </div>

                  {/* Satisfied Preferences & Unmet Requirements */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="font-bold text-emerald-900">
                        Confirmed Preferences Satisfied ({rec.satisfiedPreferences.length})
                      </div>
                      {rec.satisfiedPreferences.length === 0 ? (
                        <p className="text-[11px] text-slate-500">
                          No confirmed preferences matched yet.
                        </p>
                      ) : (
                        <ul className="space-y-1 text-[11px] text-slate-700 list-disc pl-4">
                          {rec.satisfiedPreferences.slice(0, 4).map((s, i) => (
                            <li key={i}>{s}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="font-bold text-rose-900">
                        Unmet Requirements ({rec.unmetRequirements.length})
                      </div>
                      {rec.unmetRequirements.length === 0 ? (
                        <p className="text-[11px] text-emerald-700">
                          None — all evaluated requirements met.
                        </p>
                      ) : (
                        <ul className="space-y-1 text-[11px] text-rose-800 list-disc pl-4">
                          {rec.unmetRequirements.slice(0, 4).map((u, i) => (
                            <li key={i}>{u}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {/* Trade-offs & Missing Inputs */}
                  {(rec.tradeOffsIntroduced.length > 0 ||
                    rec.assumptionsAndMissingInputs.length > 0) && (
                    <div className="space-y-1.5 pt-2 border-t border-slate-100 text-[11px] text-slate-600">
                      {rec.tradeOffsIntroduced.length > 0 && (
                        <div>
                          <strong className="text-slate-800">Trade-Offs: </strong>
                          {rec.tradeOffsIntroduced.slice(0, 2).join(' · ')}
                        </div>
                      )}
                      {rec.assumptionsAndMissingInputs.length > 0 && (
                        <div>
                          <strong className="text-amber-900">
                            Assumptions & Unconfirmed Inputs:{' '}
                          </strong>
                          {rec.assumptionsAndMissingInputs.slice(0, 2).join(' · ')}
                        </div>
                      )}
                    </div>
                  )}

                  {/* What User Can Change */}
                  <div className="text-[11px] text-slate-600 pt-1">
                    <strong className="text-slate-800">
                      What You Can Change:{' '}
                    </strong>
                    {rec.whatUserCanChangeGuidance[0]}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                  <button
                    onClick={() => setInspectedRecommendation(rec)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-teal-700" />
                    <span>Inspect Match Breakdown</span>
                  </button>

                  {rec.optionKind === 'baseline-project' ? (
                    <span className="text-xs font-semibold text-slate-500">
                      Active Baseline Reference
                    </span>
                  ) : (
                    <button
                      onClick={() => handleOpenPreview(rec.optionId)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-teal-800 hover:bg-teal-900 rounded-lg transition-colors cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Preview & Apply Option</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: Capture & Edit Preferences */}
      {activeTab === 'preferences' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Style, Materials, Storeys, Budget */}
          <div className="lg:col-span-6 space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <h2 className="text-sm font-bold text-slate-900">
                1. Architectural Style & Material Preferences
              </h2>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-800 block">
                  Preferred Facade Architectural Styles
                </span>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_FACADE_STYLES.map((style) => {
                    const active = profile.preferredFacadeStyles.includes(style);
                    return (
                      <button
                        key={style}
                        type="button"
                        onClick={() => handleToggleStyle(style)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          active
                            ? 'bg-teal-900 text-white border-teal-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {style}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-slate-800 block">
                  Preferred Primary Envelope Materials
                </span>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_PRIMARY_MATERIALS.map((mat) => {
                    const active = profile.preferredPrimaryMaterials.includes(mat);
                    return (
                      <button
                        key={mat}
                        type="button"
                        onClick={() => handleToggleMaterial(mat)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border capitalize transition-colors cursor-pointer ${
                          active
                            ? 'bg-teal-900 text-white border-teal-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {mat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <span className="text-xs font-semibold text-slate-800 block">
                  Preferred Specification Cost Tiers
                </span>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_COST_TIERS.map((tier) => {
                    const active = profile.preferredCostTiers.includes(tier);
                    return (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => handleToggleCostTier(tier)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          active
                            ? 'bg-teal-900 text-white border-teal-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {tier}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <h2 className="text-sm font-bold text-slate-900">
                2. Storey Massing & Target Budget Range
              </h2>

              <div className="space-y-2">
                <span className="text-xs font-semibold text-slate-800 block">
                  Preferred Number of Storeys
                </span>
                <div className="flex flex-wrap gap-2">
                  {[null, 1, 2, 3, 4].map((fl) => {
                    const active = profile.preferredFloors === fl;
                    return (
                      <button
                        key={String(fl)}
                        type="button"
                        onClick={() => handleStoreyChange(fl)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {fl === null ? 'Any Storeys' : `${fl} Storey${fl > 1 ? 's' : ''}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <label
                  htmlFor="p32-budget-cap-input"
                  className="text-xs font-semibold text-slate-800 block"
                >
                  Maximum Target Budget ({profile.budgetRange.currency})
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    id="p32-budget-cap-input"
                    type="number"
                    min={0}
                    step={10000}
                    value={profile.budgetRange.maxBudget ?? ''}
                    onChange={(e) =>
                      handleBudgetCapChange(
                        e.target.value,
                        profile.budgetRange.isHardCap
                      )
                    }
                    placeholder="Enter target budget cap"
                    className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 w-full sm:w-56"
                  />
                  <label
                    htmlFor="p32-budget-hard-cap"
                    className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                  >
                    <input
                      id="p32-budget-hard-cap"
                      type="checkbox"
                      checked={profile.budgetRange.isHardCap}
                      onChange={(e) =>
                        handleBudgetCapChange(
                          String(profile.budgetRange.maxBudget ?? ''),
                          e.target.checked
                        )
                      }
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>Treat budget cap as a hard constraint</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Spatial Priority Weights */}
          <div className="lg:col-span-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  3. Spatial & Environmental Priority Weights (0–100)
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Adjust the relative importance of each supported architectural priority. Setting a weight to 0 ignores that criterion in soft preference scoring.
                </p>
              </div>

              <div className="space-y-3">
                {SPATIAL_PRIORITY_DEFINITIONS.map((def) => {
                  const val = profile.spatialPriorityWeights[def.key] ?? def.defaultWeight;
                  return (
                    <div
                      key={def.key}
                      className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1.5"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <label
                          htmlFor={`p32-slider-${def.key}`}
                          className="font-bold text-slate-900"
                        >
                          {def.label}
                        </label>
                        <span className="font-mono font-bold text-teal-800">
                          Weight: {val} / 100
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600">{def.description}</p>
                      <input
                        id={`p32-slider-${def.key}`}
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={val}
                        onChange={(e) =>
                          handlePriorityWeightChange(def.key, Number(e.target.value))
                        }
                        className="w-full accent-teal-700 cursor-pointer"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Assumptions & Epistemic Provenance Ledger */}
      {activeTab === 'provenance-review' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-2">
            <h2 className="text-sm font-bold text-slate-900">
              Epistemic Provenance & Inferred Suggestion Review Ledger
            </h2>
            <p className="text-xs text-slate-600">
              Inferred suggestions (from P30 brief interpretation or site solar orientation) remain inactive until you explicitly confirm them. Confirmed P30 must-have requirements act as hard constraints.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th scope="col" className="p-3.5 font-bold">
                      Preference / Requirement Item
                    </th>
                    <th scope="col" className="p-3.5 font-bold border-l border-slate-800">
                      Value
                    </th>
                    <th scope="col" className="p-3.5 font-bold border-l border-slate-800">
                      Epistemic Origin & Status
                    </th>
                    <th scope="col" className="p-3.5 font-bold border-l border-slate-800">
                      Constraint Role
                    </th>
                    <th scope="col" className="p-3.5 font-bold border-l border-slate-800">
                      User Confirmation Controls
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {profile.items.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80 align-top">
                      <th scope="row" className="p-3.5 font-semibold text-slate-900">
                        <div>{item.label}</div>
                        <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                          {item.rationale}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                          Source: {item.sourceReference}
                        </div>
                      </th>
                      <td className="p-3.5 border-l border-slate-100 font-mono text-slate-800">
                        {item.value === null
                          ? 'Unspecified'
                          : Array.isArray(item.value)
                          ? item.value.join(', ')
                          : `${item.value}${item.unit ? ` ${item.unit}` : ''}`}
                      </td>
                      <td className="p-3.5 border-l border-slate-100">
                        {renderOriginText(item.origin, item.confirmationStatus)}
                      </td>
                      <td className="p-3.5 border-l border-slate-100">
                        {item.isHardConstraint ? (
                          <span className="font-bold text-rose-800">
                            Hard Constraint
                          </span>
                        ) : (
                          <span className="text-slate-600">
                            Soft Preference (Weight {item.weight})
                          </span>
                        )}
                      </td>
                      <td className="p-3.5 border-l border-slate-100">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {item.confirmationStatus !== 'confirmed' && (
                            <button
                              onClick={() => handleReviewItem(item.id, 'confirmed')}
                              className="px-2.5 py-1 bg-teal-800 hover:bg-teal-900 text-white rounded text-[11px] font-semibold cursor-pointer"
                            >
                              Confirm
                            </button>
                          )}
                          {item.confirmationStatus !== 'unconfirmed-suggestion' &&
                            item.origin === 'inferred-suggestion' && (
                              <button
                                onClick={() =>
                                  handleReviewItem(item.id, 'unconfirmed-suggestion')
                                }
                                className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[11px] font-semibold cursor-pointer"
                              >
                                Hold as Suggestion
                              </button>
                            )}
                          {item.confirmationStatus !== 'rejected' &&
                            !item.isHardConstraint && (
                              <button
                                onClick={() => handleReviewItem(item.id, 'rejected')}
                                className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-200 rounded text-[11px] font-semibold cursor-pointer"
                              >
                                Exclude
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Conflicts & Future Roadmap Boundaries */}
      {activeTab === 'conflicts' && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h2 className="text-sm font-bold text-slate-900">
              Preference vs. Constraint Conflicts ({evaluation.conflicts.length})
            </h2>
            {evaluation.conflicts.length === 0 ? (
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>
                  No competing preference conflicts or P30 hard-constraint contradictions detected.
                </span>
              </div>
            ) : (
              <div className="space-y-3">
                {evaluation.conflicts.map((c) => (
                  <div
                    key={c.id}
                    className={`p-4 rounded-xl border text-xs space-y-2 ${
                      c.severity === 'conflict'
                        ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                        : 'bg-amber-50/80 border-amber-200 text-amber-950'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-bold">
                      <span>{c.title}</span>
                      <span className="uppercase text-[10px]">
                        {c.isHardConstraintViolation
                          ? 'Hard Constraint Conflict'
                          : 'Preference Trade-Off Warning'}
                      </span>
                    </div>
                    <p className="leading-relaxed">{c.explanation}</p>
                    <div>
                      <strong>Recommended Resolution Options:</strong>
                      <ul className="list-disc pl-4 mt-1 space-y-0.5">
                        {c.resolutionOptions.map((ro, idx) => (
                          <li key={idx}>{ro}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-slate-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Future Roadmap Capabilities (Not Fabricated in P32)
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {evaluation.unsupportedRoadmapCapabilities.map((cap) => (
                <div
                  key={cap.roadmapId}
                  className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1 text-xs"
                >
                  <div className="font-bold text-slate-900">
                    {cap.roadmapId} — {cap.title}
                  </div>
                  <p className="text-[11px] text-slate-600">{cap.reason}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal 1: Match Breakdown Inspector */}
      {inspectedRecommendation && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="p32-breakdown-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
                  Personalization Criterion Breakdown
                </span>
                <h3
                  id="p32-breakdown-modal-title"
                  className="text-base font-bold text-slate-900 mt-0.5"
                >
                  {inspectedRecommendation.optionName}
                </h3>
              </div>
              <button
                onClick={() => setInspectedRecommendation(null)}
                aria-label="Close match breakdown"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th scope="col" className="p-2.5 font-bold">
                      Criterion
                    </th>
                    <th scope="col" className="p-2.5 font-bold border-l border-slate-800">
                      Origin & Role
                    </th>
                    <th scope="col" className="p-2.5 font-bold border-l border-slate-800">
                      Observed Value
                    </th>
                    <th scope="col" className="p-2.5 font-bold border-l border-slate-800">
                      Status & Score
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {inspectedRecommendation.criterionMatches.map((m) => (
                    <tr key={m.preferenceId} className="align-top">
                      <th scope="row" className="p-2.5 font-semibold text-slate-900">
                        <div>{m.label}</div>
                        <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                          {m.explanation}
                        </div>
                      </th>
                      <td className="p-2.5 border-l border-slate-100 text-[11px]">
                        <div>{m.origin}</div>
                        <div className="text-slate-500">
                          {m.isHardConstraint
                            ? 'Hard Constraint'
                            : `Weight: ${m.weight}`}
                        </div>
                      </td>
                      <td className="p-2.5 border-l border-slate-100 font-mono text-[11px]">
                        {m.measuredOrObservedValue}
                      </td>
                      <td className="p-2.5 border-l border-slate-100">
                        <div className="font-bold capitalize">
                          {m.status.replace(/-/g, ' ')}
                        </div>
                        {!m.isHardConstraint && (
                          <div className="text-[11px] text-slate-500 font-mono">
                            Match: {m.rawMatchScore !== null ? `${m.rawMatchScore}/100` : 'N/A'} (+
                            {m.weightedContribution} pts)
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setInspectedRecommendation(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Close Breakdown
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Non-Destructive Preview & Atomic Apply Modal */}
      {previewProposal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="p32-preview-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
                  Preview & Safety Checkpoint Validation
                </span>
                <h3
                  id="p32-preview-modal-title"
                  className="text-base font-bold text-slate-900 mt-0.5"
                >
                  Apply &ldquo;{previewProposal.optionName}&rdquo;
                </h3>
              </div>
              <button
                onClick={() => setPreviewProposal(null)}
                aria-label="Close preview"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <p className="text-slate-600">
                Review the exact proposed changes before updating the project. An automatic safety snapshot will be created prior to applying so you can roll back in one click.
              </p>

              <div className="bg-slate-50 rounded-xl border border-slate-200 p-3.5 space-y-2">
                <div className="font-bold text-slate-900">
                  Proposed Project Parameter Changes
                </div>
                {previewProposal.parameterChanges.map((pc) => (
                  <div
                    key={pc.field}
                    className="flex items-center justify-between gap-2 py-1 border-b border-slate-200/70 last:border-0"
                  >
                    <span className="text-slate-600">{pc.label}:</span>
                    <span className="font-semibold text-slate-900">
                      {pc.beforeValue} →{' '}
                      <span className="text-teal-800">{pc.afterValue}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* Validation Outcome */}
              <div
                className={`p-3.5 rounded-xl border ${
                  previewProposal.isSafeToApply
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                    : 'bg-rose-50 border-rose-200 text-rose-950'
                }`}
              >
                <div className="font-bold">
                  {previewProposal.isSafeToApply
                    ? 'Geometry & Constraint Pre-Check Passed'
                    : 'Safe Application Blocked — Preview Only'}
                </div>
                <ul className="list-disc pl-4 mt-1 space-y-0.5 text-[11px]">
                  {previewProposal.isSafeToApply
                    ? previewProposal.geometryValidation.validationMessages.map(
                        (msg, i) => <li key={i}>{msg}</li>
                      )
                    : previewProposal.safetyBlockReasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                </ul>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                onClick={() => setPreviewProposal(null)}
                className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
              >
                Keep as Preview (Cancel)
              </button>
              <button
                onClick={handleConfirmApplyOption}
                disabled={!previewProposal.isSafeToApply}
                className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${
                  previewProposal.isSafeToApply
                    ? 'bg-teal-800 hover:bg-teal-900 text-white cursor-pointer'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>Create Checkpoint & Apply</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
