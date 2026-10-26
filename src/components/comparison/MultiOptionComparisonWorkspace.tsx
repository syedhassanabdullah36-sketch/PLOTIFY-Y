import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ArrowLeft,
  Scale,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Info,
  Sliders,
  Layers,
  Eye,
  Save,
  Sparkles,
  FileText,
  PenTool,
  Palette,
  RefreshCw,
  ShieldAlert,
  X,
  Lock,
  Check,
  Minus,
} from 'lucide-react';
import { Project } from '../../types/project';
import {
  CriterionCrossOptionComparison,
  OptionCriterionValue,
  ValueProvenanceType,
  CriterionEvaluationStatus,
  P31_COMPARISON_CALCULATION_VERSION,
  MultiOptionComparisonResult,
} from '../../types/designComparison';
import {
  P31_COMPLIANCE_DISCLAIMER,
  compareDesignOptions,
  extractComparableOptions,
  getComparisonCriteriaCatalog,
  saveComparisonConfigToProject,
  shouldApplyComparisonResult,
} from '../../services/designComparisonService';
import { initializeProjectScenarios } from '../../services/scenarioCalculator';

interface MultiOptionComparisonWorkspaceProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onBack: () => void;
  onOpenBrief?: (project: Project) => void;
  onOpenFloorPlan?: (project: Project) => void;
  onOpenDesignStudio?: (project: Project) => void;
  onOpenImpactSimulator?: (project: Project) => void;
  onOpenDesignPersonalization?: (project: Project) => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export const MultiOptionComparisonWorkspace: React.FC<MultiOptionComparisonWorkspaceProps> = ({
  project,
  onUpdateProject,
  onBack,
  onOpenBrief,
  onOpenFloorPlan,
  onOpenDesignStudio,
  onOpenImpactSimulator,
  onOpenDesignPersonalization,
  showToast,
}) => {
  const allOptions = useMemo(() => extractComparableOptions(project), [project]);
  const criteriaCatalog = useMemo(() => getComparisonCriteriaCatalog(project), [project]);

  const defaultCriterionIds = useMemo(
    () => criteriaCatalog.filter((c) => c.defaultSelected).map((c) => c.id),
    [criteriaCatalog]
  );

  // Initialize from saved config or default to first 3 available options
  const initialOptionIds = useMemo(() => {
    if (
      project.designComparison?.selectedOptionIds &&
      project.designComparison.selectedOptionIds.length >= 2
    ) {
      const validSaved = project.designComparison.selectedOptionIds.filter((id) =>
        allOptions.some((o) => o.optionId === id)
      );
      if (validSaved.length >= 2) return validSaved;
    }
    return allOptions.slice(0, Math.min(3, allOptions.length)).map((o) => o.optionId);
  }, [project.designComparison, allOptions]);

  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(initialOptionIds);
  const [selectedCriterionIds, setSelectedCriterionIds] = useState<string[]>(
    project.designComparison?.selectedCriterionIds?.length
      ? project.designComparison.selectedCriterionIds
      : defaultCriterionIds
  );
  const [scoringEnabled, setScoringEnabled] = useState<boolean>(
    project.designComparison?.scoringEnabled ?? false
  );
  const [customWeights, setCustomWeights] = useState<Record<string, number>>(() => {
    if (project.designComparison?.customWeights) {
      return { ...project.designComparison.customWeights };
    }
    const defaults: Record<string, number> = {};
    for (const c of criteriaCatalog) {
      defaults[c.id] = c.defaultWeight;
    }
    return defaults;
  });
  const [showDifferencesOnly, setShowDifferencesOnly] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<
    'matrix' | 'brief-constraints' | 'scoring' | 'criteria-setup'
  >('matrix');
  const [inspectedCell, setInspectedCell] = useState<{
    criterionRow: CriterionCrossOptionComparison;
    optionCell: OptionCriterionValue;
    optionName: string;
  } | null>(null);

  // Sync selectedOptionIds when project options change
  useEffect(() => {
    setSelectedOptionIds((prev) => {
      const valid = prev.filter((id) => allOptions.some((o) => o.optionId === id));
      if (valid.length >= 2) return valid;
      return allOptions.slice(0, Math.min(3, allOptions.length)).map((o) => o.optionId);
    });
  }, [allOptions]);

  const requestSequenceRef = useRef<number>(1);
  const lastResultRef = useRef<MultiOptionComparisonResult | null>(null);

  const comparisonResult = useMemo(() => {
    requestSequenceRef.current += 1;
    const seq = requestSequenceRef.current;
    const computed = compareDesignOptions(project, {
      selectedOptionIds,
      selectedCriterionIds,
      scoringEnabled,
      customWeights,
      requestSequenceId: seq,
    });
    if (shouldApplyComparisonResult(lastResultRef.current, computed)) {
      lastResultRef.current = computed;
      return computed;
    }
    return lastResultRef.current || computed;
  }, [project, selectedOptionIds, selectedCriterionIds, scoringEnabled, customWeights]);

  const handleToggleOption = (optionId: string) => {
    setSelectedOptionIds((prev) => {
      if (prev.includes(optionId)) {
        return prev.filter((id) => id !== optionId);
      }
      return [...prev, optionId];
    });
  };

  const handleToggleCriterion = (criterionId: string) => {
    setSelectedCriterionIds((prev) => {
      if (prev.includes(criterionId)) {
        if (prev.length <= 1) return prev;
        return prev.filter((id) => id !== criterionId);
      }
      return [...prev, criterionId];
    });
  };

  const handleWeightChange = (criterionId: string, weight: number) => {
    setCustomWeights((prev) => ({
      ...prev,
      [criterionId]: Math.max(0, Math.min(100, weight)),
    }));
  };

  const handleInitializeScenarios = () => {
    const initialized = initializeProjectScenarios(project);
    const updatedProject: Project = {
      ...project,
      scenarios: initialized,
      updatedAt: new Date().toISOString(),
    };
    onUpdateProject(updatedProject);
    const updatedOptions = extractComparableOptions(updatedProject);
    const scenarioOptionIds = updatedOptions
      .filter((o) => o.kind === 'baseline-project' || o.kind === 'design-scenario')
      .slice(0, 4)
      .map((o) => o.optionId);
    setSelectedOptionIds(scenarioOptionIds);
    showToast?.(
      `Loaded ${initialized.length} spatial design scenarios for multi-option comparison.`,
      'success'
    );
  };

  const handleSaveConfiguration = () => {
    const updatedProject = saveComparisonConfigToProject(project, {
      selectedOptionIds,
      selectedCriterionIds,
      scoringEnabled,
      customWeights,
    });
    onUpdateProject(updatedProject);
    showToast?.('Saved multi-option comparison configuration to project.', 'success');
  };

  const renderProvenanceBadge = (provenance: ValueProvenanceType) => {
    switch (provenance) {
      case 'measured':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600 shrink-0" />
            <span>Measured</span>
          </span>
        );
      case 'calculated':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-50 text-teal-800 border border-teal-200">
            <Scale className="w-2.5 h-2.5 text-teal-600 shrink-0" />
            <span>Calculated</span>
          </span>
        );
      case 'estimated':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-50 text-sky-800 border border-sky-200">
            <Info className="w-2.5 h-2.5 text-sky-600 shrink-0" />
            <span>Estimated</span>
          </span>
        );
      case 'user-entered':
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200">
            <FileText className="w-2.5 h-2.5 text-indigo-600 shrink-0" />
            <span>User-Declared</span>
          </span>
        );
      case 'unavailable':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
            <HelpCircle className="w-2.5 h-2.5 text-slate-500 shrink-0" />
            <span>Unavailable</span>
          </span>
        );
    }
  };

  const renderStatusBadge = (status: CriterionEvaluationStatus) => {
    switch (status) {
      case 'meets':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-700">
            <Check className="w-3 h-3" />
            <span>Meets</span>
          </span>
        );
      case 'warning':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700">
            <AlertTriangle className="w-3 h-3" />
            <span>Warning</span>
          </span>
        );
      case 'conflict':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700">
            <AlertCircle className="w-3 h-3" />
            <span>Conflict</span>
          </span>
        );
      case 'neutral':
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600">
            <Info className="w-3 h-3" />
            <span>Evaluated</span>
          </span>
        );
      case 'unavailable':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
            <Minus className="w-3 h-3" />
            <span>No Data</span>
          </span>
        );
    }
  };

  const filteredCriteriaRows = useMemo(() => {
    if (!showDifferencesOnly) return comparisonResult.criteriaComparisons;
    return comparisonResult.criteriaComparisons.filter(
      (row) => row.rangeSpread !== null && Math.abs(row.rangeSpread) > 1e-5
    );
  }, [comparisonResult.criteriaComparisons, showDifferencesOnly]);

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-12">
      {/* Top Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="space-y-1">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Project Overview</span>
          </button>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Scale className="w-5 h-5 text-teal-700" />
              <span>Multi-Option Design Comparison</span>
            </h1>
            <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-teal-50 text-teal-900 border border-teal-200 rounded-md">
              P31 Engine · {P31_COMPARISON_CALCULATION_VERSION}
            </span>
          </div>
          <p className="text-xs text-slate-600">
            Compare architectural options across consistent geometry, P30 brief requirements, cost estimates, and explicit provenance indicators.
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
                P30 Brief ({comparisonResult.p30BriefSummary.confirmedRequirementsCount} Confirmed)
              </span>
            </button>
          )}
          {onOpenFloorPlan && (
            <button
              onClick={() => onOpenFloorPlan(project)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <PenTool className="w-3.5 h-3.5 text-teal-700" />
              <span>2D Floor Plan</span>
            </button>
          )}
          {onOpenImpactSimulator && (
            <button
              onClick={() => onOpenImpactSimulator(project)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5 text-teal-700" />
              <span>Scenario Editor</span>
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
          {onOpenDesignPersonalization && (
            <button
              onClick={() => onOpenDesignPersonalization(project)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-teal-700" />
              <span>Personalize Options (P32)</span>
            </button>
          )}
          <button
            onClick={handleSaveConfiguration}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer shadow-xs"
          >
            <Save className="w-3.5 h-3.5 text-teal-400" />
            <span>Save Comparison Setup</span>
          </button>
        </div>
      </div>

      {/* Non-Overclaiming Compliance & Provenance Disclaimer */}
      <div
        role="region"
        aria-label="Comparison methodology and limitations notice"
        className="bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed text-slate-200">
            <span className="font-bold text-white">Evidence-Bounded Decision Support: </span>
            {P31_COMPLIANCE_DISCLAIMER}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 text-[11px] text-slate-300 font-mono">
          <span>Unit: {project.unit}</span>
          <span>·</span>
          <span>Currency: {project.currency}</span>
        </div>
      </div>

      {/* Stage A: Select Options to Compare */}
      <section
        aria-labelledby="stage-a-heading"
        className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <h2
              id="stage-a-heading"
              className="text-sm font-bold text-slate-900 flex items-center gap-2"
            >
              <span className="w-5 h-5 rounded-full bg-teal-900 text-white text-[11px] flex items-center justify-center font-bold">
                1
              </span>
              <span>
                Select Design Options to Compare ({selectedOptionIds.length} of {allOptions.length}{' '}
                selected)
              </span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Select at least 2 options using stable option identifiers. Spatial Scenarios contain distinct 2D room layouts; Specification Alternatives vary facade and interior finishes on the baseline layout.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleInitializeScenarios}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg transition-colors cursor-pointer"
              title="Generate or refresh spatial design scenarios (Baseline, Compact & Cost-Savvy, Spacious Living, Eco-Optimized) from current project floor plan"
            >
              <RefreshCw className="w-3.5 h-3.5 text-teal-700" />
              <span>
                {project.scenarios && project.scenarios.length > 0
                  ? 'Refresh Spatial Scenarios'
                  : 'Load Spatial Scenarios (4 Options)'}
              </span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {allOptions.map((opt) => {
            const isSelected = selectedOptionIds.includes(opt.optionId);
            return (
              <label
                key={opt.optionId}
                htmlFor={`select-opt-${opt.optionId}`}
                className={`flex flex-col justify-between p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-teal-50/60 border-teal-400 shadow-xs'
                    : 'bg-slate-50/60 border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        id={`select-opt-${opt.optionId}`}
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleToggleOption(opt.optionId)}
                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-600 mt-0.5"
                      />
                      <span className="text-xs font-bold text-slate-900 leading-snug">
                        {opt.name}
                      </span>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 ${
                        opt.kind === 'baseline-project'
                          ? 'bg-slate-900 text-white'
                          : opt.kind === 'design-scenario'
                          ? 'bg-teal-100 text-teal-900 border border-teal-200'
                          : 'bg-indigo-50 text-indigo-900 border border-indigo-200'
                      }`}
                    >
                      {opt.kind === 'baseline-project'
                        ? 'Baseline'
                        : opt.kind === 'design-scenario'
                        ? 'Spatial Scenario'
                        : 'Spec Alternative'}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-600 line-clamp-2">{opt.description}</p>
                </div>

                <div className="pt-2.5 mt-2.5 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-1 text-[10px] text-slate-500">
                  <span>
                    {opt.rooms.length} rooms · {opt.floors} flr{opt.floors !== 1 ? 's' : ''}
                  </span>
                  <span className="font-mono text-[9px] text-slate-400">{opt.optionId}</span>
                </div>

                {opt.sharesBaselineGeometry && (
                  <div className="mt-1.5 text-[10px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                    Shares baseline 2D room layout (varies facade/interior specs)
                  </div>
                )}
              </label>
            );
          })}
        </div>

        {/* Global Warnings & Notices */}
        {comparisonResult.globalWarnings.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {comparisonResult.globalWarnings.map((notice, idx) => (
              <div
                key={idx}
                className="flex items-start gap-2 text-xs bg-amber-50/90 text-amber-950 border border-amber-200 rounded-lg px-3 py-2"
              >
                <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{notice}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Navigation Tabs for Stage B, C, D */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
        <div
          role="tablist"
          aria-label="Comparison workspace views"
          className="flex flex-wrap items-center gap-1.5"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'matrix'}
            onClick={() => setActiveTab('matrix')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'matrix'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Scale className="w-3.5 h-3.5" />
            <span>Side-by-Side Comparison Matrix ({filteredCriteriaRows.length})</span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'brief-constraints'}
            onClick={() => setActiveTab('brief-constraints')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'brief-constraints'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>
              P30 Brief & Constraint Alignment ({comparisonResult.briefConstraintChecks.length})
            </span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'scoring'}
            onClick={() => setActiveTab('scoring')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'scoring'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Optional Preference Weighting {scoringEnabled ? '(Active)' : '(Off)'}</span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'criteria-setup'}
            onClick={() => setActiveTab('criteria-setup')}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'criteria-setup'
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Criteria & Roadmap Scope ({selectedCriterionIds.length} active)</span>
          </button>
        </div>

        {activeTab === 'matrix' && (
          <div className="flex items-center gap-3">
            <label
              htmlFor="toggle-diff-only"
              className="inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer"
            >
              <input
                id="toggle-diff-only"
                type="checkbox"
                checked={showDifferencesOnly}
                onChange={(e) => setShowDifferencesOnly(e.target.checked)}
                className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
              />
              <span>Show only criteria with differences across options</span>
            </label>
          </div>
        )}
      </div>

      {/* Guard if fewer than 2 options are selected */}
      {!comparisonResult.optionDiagnostics.hasMinimumTwoOptions ? (
        <div className="bg-white rounded-xl border border-amber-300 p-8 text-center space-y-3 shadow-xs">
          <AlertTriangle className="w-8 h-8 text-amber-600 mx-auto" />
          <h3 className="text-base font-bold text-slate-900">
            Select at Least Two Design Options to Compare
          </h3>
          <p className="text-xs text-slate-600 max-w-lg mx-auto">
            {comparisonResult.optionDiagnostics.validationErrors[0] ||
              'Multi-option comparison requires at least two selected options. Check two or more options above, or click "Load Spatial Scenarios (4 Options)" to generate spatial design options.'}
          </p>
          <button
            onClick={handleInitializeScenarios}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Load Spatial Scenarios Now</span>
          </button>
        </div>
      ) : (
        <>
          {/* TAB 1: Side-by-Side Comparison Matrix */}
          {activeTab === 'matrix' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-900 text-white border-b border-slate-800">
                        <th
                          scope="col"
                          className="p-3.5 text-xs font-bold uppercase tracking-wider min-w-[230px]"
                        >
                          Criterion / Metric & Unit
                        </th>
                        {comparisonResult.selectedOptions.map((opt, idx) => (
                          <th
                            key={opt.optionId}
                            scope="col"
                            className="p-3.5 text-xs font-bold min-w-[210px] border-l border-slate-800"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate">{opt.name}</span>
                              {idx === 0 && (
                                <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase bg-teal-500/20 text-teal-300 border border-teal-400/30 rounded">
                                  Reference
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-normal text-slate-300 mt-0.5">
                              {opt.kind === 'baseline-project'
                                ? 'Baseline Model'
                                : opt.kind === 'design-scenario'
                                ? 'Spatial Scenario'
                                : 'Spec Alternative'}{' '}
                              · {opt.rooms.length} rooms
                            </div>
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="p-3.5 text-xs font-bold uppercase tracking-wider min-w-[260px] border-l border-slate-800"
                        >
                          Trade-Off & Variance Analysis
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {filteredCriteriaRows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={comparisonResult.selectedOptions.length + 2}
                            className="p-8 text-center text-slate-500"
                          >
                            All selected options have identical values across the active criteria. Uncheck &ldquo;Show only criteria with differences&rdquo; or load distinct spatial scenarios.
                          </td>
                        </tr>
                      ) : (
                        filteredCriteriaRows.map((row) => {
                          const { criterion, valuesByOptionId } = row;

                          return (
                            <tr
                              key={criterion.id}
                              className="hover:bg-slate-50/80 transition-colors align-top"
                            >
                              <th
                                scope="row"
                                className="p-3.5 font-semibold text-slate-900 bg-slate-50/50"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="text-xs font-bold text-slate-900">
                                      {criterion.name}
                                    </div>
                                    <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                                      {criterion.plainLanguageMeaning}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-500">
                                  <span className="px-1.5 py-0.5 bg-slate-100 rounded font-mono text-slate-700">
                                    Unit: {criterion.unit}
                                  </span>
                                  <span className="px-1.5 py-0.5 bg-slate-100 rounded capitalize">
                                    {criterion.preferenceDirection.replace(/-/g, ' ')}
                                  </span>
                                </div>
                              </th>

                              {comparisonResult.selectedOptions.map((opt) => {
                                const cell = valuesByOptionId[opt.optionId];
                                if (!cell) return <td key={opt.optionId} className="p-3.5" />;

                                return (
                                  <td
                                    key={opt.optionId}
                                    className="p-3.5 border-l border-slate-100"
                                  >
                                    <div className="space-y-1.5">
                                      <div className="flex items-baseline justify-between gap-2">
                                        <span
                                          className={`text-sm font-bold tabular-nums ${
                                            cell.status === 'unavailable'
                                              ? 'text-slate-400 italic font-normal text-xs'
                                              : cell.status === 'conflict'
                                              ? 'text-rose-800'
                                              : 'text-slate-900'
                                          }`}
                                        >
                                          {cell.formattedValue}
                                        </span>
                                      </div>

                                      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                        {renderProvenanceBadge(cell.provenance)}
                                        {renderStatusBadge(cell.status)}
                                      </div>

                                      <p className="text-[11px] text-slate-500 leading-snug pt-0.5">
                                        {cell.explanation}
                                      </p>

                                      <button
                                        onClick={() =>
                                          setInspectedCell({
                                            criterionRow: row,
                                            optionCell: cell,
                                            optionName: opt.name,
                                          })
                                        }
                                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-800 hover:text-teal-950 underline underline-offset-2 pt-1 cursor-pointer"
                                      >
                                        <Eye className="w-3 h-3" />
                                        <span>Inspect Formula & Evidence</span>
                                      </button>
                                    </div>
                                  </td>
                                );
                              })}

                              <td className="p-3.5 border-l border-slate-100 bg-slate-50/30">
                                <p className="text-xs text-slate-700 leading-relaxed">
                                  {row.meaningfulDifferenceSummary}
                                </p>
                                {row.minNumericValue !== null && row.maxNumericValue !== null && (
                                  <div className="mt-2 text-[10px] font-mono text-slate-500">
                                    Spread: {row.rangeSpreadFormatted} (Min: {row.minNumericValue} · Max:{' '}
                                    {row.maxNumericValue})
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Decision Support Summary Card */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-2">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Cross-Option Trade-Off Summary
                </h3>
                <p className="text-xs text-slate-700 leading-relaxed">
                  {comparisonResult.decisionSupportNarrative}
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: P30 Brief & Confirmed Requirement Alignment */}
          {activeTab === 'brief-constraints' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      P30 Architectural Brief & Requirement Traceability
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Confirmed requirements (`reviewStatus: confirmed`) act as binding comparison constraints. Unconfirmed AI inferences (`needs-review`) are surfaced transparently as assumptions and never silently treated as verified facts.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-900 border border-emerald-200 font-semibold">
                      {comparisonResult.p30BriefSummary.confirmedRequirementsCount} Confirmed Constraints
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-200 font-semibold">
                      {comparisonResult.p30BriefSummary.unconfirmedAssumptionsCount} Unconfirmed Assumptions
                    </span>
                    {comparisonResult.p30BriefSummary.unresolvedBriefConflictsCount > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-900 border border-rose-200 font-semibold">
                        {comparisonResult.p30BriefSummary.unresolvedBriefConflictsCount} Brief Contradictions
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-900 text-white">
                        <th scope="col" className="p-3.5 font-bold min-w-[220px]">
                          Brief Requirement / Target
                        </th>
                        <th
                          scope="col"
                          className="p-3.5 font-bold min-w-[160px] border-l border-slate-800"
                        >
                          P30 Review & Provenance
                        </th>
                        {comparisonResult.selectedOptions.map((opt) => (
                          <th
                            key={opt.optionId}
                            scope="col"
                            className="p-3.5 font-bold min-w-[200px] border-l border-slate-800"
                          >
                            {opt.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {comparisonResult.briefConstraintChecks.map((item) => (
                        <tr key={item.requirementId} className="hover:bg-slate-50/70 align-top">
                          <th scope="row" className="p-3.5 font-semibold text-slate-900">
                            <div>{item.description}</div>
                            <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                              Target: {item.targetDisplay}
                            </div>
                          </th>
                          <td className="p-3.5 border-l border-slate-100">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${
                                item.isBindingConstraint
                                  ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-900 border border-amber-200'
                              }`}
                            >
                              {item.isBindingConstraint
                                ? 'Confirmed Constraint'
                                : 'Unconfirmed Assumption'}
                            </span>
                            <div className="text-[10px] text-slate-500 mt-1 capitalize">
                              Priority: {item.priority.replace(/-/g, ' ')} · Source: {item.source}
                            </div>
                          </td>
                          {comparisonResult.selectedOptions.map((opt) => {
                            const outcome = item.outcomesByOptionId[opt.optionId];
                            if (!outcome) return <td key={opt.optionId} className="p-3.5" />;
                            return (
                              <td key={opt.optionId} className="p-3.5 border-l border-slate-100">
                                <span
                                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                    outcome.status === 'meets'
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                      : outcome.status === 'conflict'
                                      ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                      : outcome.status === 'assumption-only'
                                      ? 'bg-amber-50 text-amber-900 border border-amber-200'
                                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                                  }`}
                                >
                                  {outcome.status === 'meets' && (
                                    <CheckCircle2 className="w-3 h-3" />
                                  )}
                                  {outcome.status === 'conflict' && (
                                    <AlertCircle className="w-3 h-3" />
                                  )}
                                  {outcome.status === 'assumption-only' && (
                                    <Sparkles className="w-3 h-3" />
                                  )}
                                  {outcome.status === 'insufficient-data' && (
                                    <HelpCircle className="w-3 h-3" />
                                  )}
                                  <span className="capitalize">
                                    {outcome.status.replace(/-/g, ' ')}
                                  </span>
                                </span>
                                <p className="text-[11px] text-slate-600 mt-1 leading-snug">
                                  {outcome.explanation}
                                </p>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Optional Preference Weighting */}
          {activeTab === 'scoring' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Optional User-Controlled Preference Weighting
                    </h3>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Soft preference weights never override hard constraints. Missing or unavailable criteria contribute 0 points while keeping their full weight in the denominator so missing data never inflates an option&apos;s score.
                    </p>
                  </div>
                  <label
                    htmlFor="enable-weighted-scoring"
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-teal-50 border border-teal-200 text-xs font-bold text-teal-950 cursor-pointer"
                  >
                    <input
                      id="enable-weighted-scoring"
                      type="checkbox"
                      checked={scoringEnabled}
                      onChange={(e) => setScoringEnabled(e.target.checked)}
                      className="rounded border-teal-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>Enable Weighted Preference Index</span>
                  </label>
                </div>

                {/* Weight Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {criteriaCatalog
                    .filter(
                      (c) =>
                        c.isAvailableInCodebase &&
                        c.preferenceDirection !== 'informational' &&
                        selectedCriterionIds.includes(c.id)
                    )
                    .map((criterion) => {
                      const currentWeight =
                        customWeights[criterion.id] ?? criterion.defaultWeight;
                      return (
                        <div
                          key={criterion.id}
                          className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 space-y-1.5"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <label
                              htmlFor={`weight-slider-${criterion.id}`}
                              className="font-semibold text-slate-800"
                            >
                              {criterion.name}
                            </label>
                            <span className="font-mono font-bold text-teal-800">
                              Weight: {currentWeight}
                            </span>
                          </div>
                          <input
                            id={`weight-slider-${criterion.id}`}
                            type="range"
                            min={0}
                            max={50}
                            step={5}
                            value={currentWeight}
                            onChange={(e) =>
                              handleWeightChange(criterion.id, Number(e.target.value))
                            }
                            className="w-full accent-teal-700 cursor-pointer"
                          />
                          <div className="flex justify-between text-[10px] text-slate-400">
                            <span>0 (Ignore)</span>
                            <span>25 (Balanced)</span>
                            <span>50 (High Priority)</span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>

              {/* Weighted Results */}
              {scoringEnabled && comparisonResult.optionScores.length > 0 && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-slate-900 text-slate-100 text-xs">
                    <strong>Sensitivity & Tie Analysis: </strong>
                    {comparisonResult.rankingStabilityExplanation}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {comparisonResult.optionScores.map((score) => (
                      <div
                        key={score.optionId}
                        className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3"
                      >
                        <div className="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
                          <div>
                            <h4 className="text-sm font-bold text-slate-900">
                              {score.optionName}
                            </h4>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {score.optionId}
                            </span>
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-bold text-teal-800 tabular-nums">
                              {score.aggregatePreferenceScore !== null
                                ? `${score.aggregatePreferenceScore} / 100`
                                : 'N/A'}
                            </div>
                            <div className="text-[10px] text-slate-500">
                              Soft Preference Index
                            </div>
                          </div>
                        </div>

                        {/* Hard Constraint separation */}
                        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] space-y-1">
                          <div className="font-bold text-slate-800">
                            Hard Constraints (Tracked Separately):
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="text-emerald-700 font-semibold">
                              {score.hardConstraintsMetCount} Met
                            </span>
                            <span>·</span>
                            <span
                              className={
                                score.hardConstraintsConflictCount > 0
                                  ? 'text-rose-700 font-bold'
                                  : 'text-slate-600'
                              }
                            >
                              {score.hardConstraintsConflictCount} Conflicts
                            </span>
                            <span>·</span>
                            <span className="text-slate-500">
                              {score.hardConstraintsUnassessedCount} Unassessed
                            </span>
                          </div>
                        </div>

                        {score.dataCoveragePercent < 100 && (
                          <div className="p-2 rounded bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                            <strong>Missing Data Penalty Applied:</strong> Data coverage is{' '}
                            {score.dataCoveragePercent}% ({score.availableWeightedCriteriaCount}/
                            {score.totalWeightedCriteriaCount} weighted criteria available). Missing criteria contributed 0 points while retaining denominator weight.
                          </div>
                        )}

                        {score.strengths.length > 0 && (
                          <div className="text-[11px] text-slate-600">
                            <strong className="text-slate-800">Relative Strengths:</strong>
                            <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                              {score.strengths.map((s, idx) => (
                                <li key={idx}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {score.tradeOffs.length > 0 && (
                          <div className="text-[11px] text-slate-600">
                            <strong className="text-slate-800">Trade-Offs / Conflicts:</strong>
                            <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                              {score.tradeOffs.map((t, idx) => (
                                <li key={idx}>{t}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Criteria Selection & Locked Roadmap Boundaries */}
          {activeTab === 'criteria-setup' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-slate-900">
                  Implemented P31 Comparison Criteria
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {criteriaCatalog
                    .filter((c) => c.isAvailableInCodebase)
                    .map((c) => {
                      const checked = selectedCriterionIds.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          htmlFor={`crit-toggle-${c.id}`}
                          className={`p-3 rounded-xl border flex items-start gap-3 cursor-pointer ${
                            checked
                              ? 'bg-teal-50/50 border-teal-300'
                              : 'bg-white border-slate-200'
                          }`}
                        >
                          <input
                            id={`crit-toggle-${c.id}`}
                            type="checkbox"
                            checked={checked}
                            onChange={() => handleToggleCriterion(c.id)}
                            className="mt-1 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                          />
                          <div className="space-y-1 text-xs">
                            <div className="font-bold text-slate-900">
                              {c.name}{' '}
                              <span className="text-[10px] font-mono text-slate-500">
                                ({c.unit})
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-600">
                              {c.plainLanguageMeaning}
                            </p>
                            <div className="text-[10px] font-mono text-slate-500">
                              Formula: {c.formula}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="bg-slate-50 rounded-xl border border-slate-200 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-slate-600" />
                  <h3 className="text-sm font-bold text-slate-900">
                    Future Roadmap Criteria (Explicitly Unavailable in P31 — Not Fabricated)
                  </h3>
                </div>
                <p className="text-xs text-slate-600">
                  In accordance with P31 honesty rules, criteria belonging to future roadmap milestones (P33–P38) are never fabricated or guessed when underlying geometric or environmental engines are not yet active.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {criteriaCatalog
                    .filter((c) => !c.isAvailableInCodebase)
                    .map((c) => (
                      <div
                        key={c.id}
                        className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1.5 opacity-85"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-800">{c.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                            Unavailable
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-600">
                          {c.unavailableCodebaseReason}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Accessible Metric Formula & Provenance Inspector Modal */}
      {inspectedCell && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="metric-inspector-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-200">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700">
                  Metric Provenance & Formula Inspector
                </span>
                <h3
                  id="metric-inspector-title"
                  className="text-base font-bold text-slate-900 mt-0.5"
                >
                  {inspectedCell.criterionRow.criterion.name} — {inspectedCell.optionName}
                </h3>
              </div>
              <button
                onClick={() => setInspectedCell(null)}
                aria-label="Close inspector"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">
                    Evaluated Value
                  </div>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">
                    {inspectedCell.optionCell.formattedValue}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">
                    Provenance & Status
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {renderProvenanceBadge(inspectedCell.optionCell.provenance)}
                    {renderStatusBadge(inspectedCell.optionCell.status)}
                  </div>
                </div>
              </div>

              <div>
                <div className="font-bold text-slate-800">Mathematical Formula / Rule:</div>
                <div className="p-2.5 mt-1 rounded-lg bg-slate-900 text-teal-300 font-mono text-[11px]">
                  {inspectedCell.criterionRow.criterion.formula}
                </div>
              </div>

              <div>
                <div className="font-bold text-slate-800">Captured Source Inputs:</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {inspectedCell.optionCell.sourceReferences.map((sf: string, i: number) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono text-[10px]"
                    >
                      {sf}
                    </span>
                  ))}
                </div>
              </div>

              {inspectedCell.optionCell.assumptionsUsed.length > 0 && (
                <div>
                  <div className="font-bold text-slate-800">Assumptions & Notes:</div>
                  <ul className="mt-1 space-y-1 text-slate-600 list-disc pl-4">
                    {inspectedCell.optionCell.assumptionsUsed.map((n: string, i: number) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="font-bold text-slate-800">Cross-Option Trade-Off Context:</div>
                <p className="mt-1 text-slate-600 leading-relaxed">
                  {inspectedCell.criterionRow.meaningfulDifferenceSummary}
                </p>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setInspectedCell(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
