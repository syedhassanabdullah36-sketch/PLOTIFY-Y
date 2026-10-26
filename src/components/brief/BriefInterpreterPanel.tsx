/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { Project } from '../../types/project';
import {
  ArchitecturalBrief,
  ArchitecturalBriefData,
  RequirementCategory,
  RequirementPriority,
  ProjectRequirement,
  SpaceCategory,
} from '../../types/brief';
import {
  VALID_REQUIREMENT_CATEGORIES,
  interpretDesignBrief,
  interpretDesignBriefAsync,
  shouldApplyInterpretationResponse,
  updateInterpretedRequirement,
  addManualInterpretedRequirement,
  removeInterpretedRequirement,
  reviewBriefAssumption,
  answerClarificationQuestion,
  integrateInterpretedBriefIntoProject,
} from '../../services/briefService';
import {
  Sparkles,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  HelpCircle,
  Plus,
  Trash2,
  Check,
  X,
  FileText,
  ShieldAlert,
  ArrowRight,
  RotateCcw,
  Save,
  Layers,
} from 'lucide-react';

interface BriefInterpreterPanelProps {
  project: Project;
  briefData: ArchitecturalBriefData;
  isLocked: boolean;
  onSaveBriefData: (updatedBrief: ArchitecturalBriefData, toastMsg?: string) => void;
  onSwitchToSpacesTab: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

const CATEGORY_LABELS: Record<RequirementCategory, string> = {
  'project-identity': 'Project Identity & Building Use',
  'occupancy-household': 'Occupancy & Household Needs',
  'spaces-program': 'Spaces & Room Program',
  'area-dimensions': 'Area & Dimensional Constraints',
  'floors-circulation': 'Floors & Vertical Circulation',
  'privacy-circulation': 'Privacy & Circulation',
  accessibility: 'Accessibility',
  'daylight-ventilation': 'Daylight & Ventilation Preferences',
  'site-orientation': 'Site & Orientation',
  'budget-cost': 'Budget & Cost Constraints',
  'materials-sustainability': 'Materials & Sustainability',
  'regulatory-safety': 'Regulatory & Safety Constraints',
  'other-unclassified': 'Other / Unclassified Requirements',
};

const SAMPLE_PROMPTS = [
  {
    label: 'Two-Storey Family House (Spec Example)',
    text: 'I want a two-storey family house for six people, with four bedrooms, a separate guest area, an open kitchen, good natural light, privacy from the street, parking for two cars, and a moderate construction budget.',
  },
  {
    label: 'Accessible Compact Residence with Explicit Budget',
    text: 'Single-storey residence for 3 people on a 50x80 ft plot. Must have 2 bedrooms, 2 bathrooms, a home office, step-free wheelchair accessible entrance, south-facing garden patio, and a budget of $420,000 USD.',
  },
  {
    label: 'Conflict & Ambiguity Stress Test',
    text: 'I want a single-storey house with two floors, 1 bedroom and 4 bedrooms, total area of 450, completely open-plan with no interior walls and strict acoustic separation, budget of 300000.',
  },
];

export const BriefInterpreterPanel: React.FC<BriefInterpreterPanelProps> = ({
  project,
  briefData,
  isLocked,
  onSaveBriefData,
  onSwitchToSpacesTab,
  showToast,
}) => {
  const [inputText, setInputText] = useState<string>(
    briefData.interpretedBrief?.rawInputText ||
      project.notes ||
      SAMPLE_PROMPTS[0].text
  );
  const [interpreted, setInterpreted] = useState<ArchitecturalBrief | undefined>(
    briefData.interpretedBrief
  );
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [replaceExistingSpaces, setReplaceExistingSpaces] = useState(false);
  const [isConfirmIntegrationOpen, setIsConfirmIntegrationOpen] = useState(false);

  // Manual requirement modal / inline state
  const [isAddReqOpen, setIsAddReqOpen] = useState(false);
  const [manualCategory, setManualCategory] = useState<RequirementCategory>('spaces-program');
  const [manualDesc, setManualDesc] = useState('');
  const [manualValue, setManualValue] = useState('');
  const [manualUnit, setManualUnit] = useState(project.unit === 'feet' ? 'sq ft' : 'm²');
  const [manualPriority, setManualPriority] = useState<RequirementPriority>('must-have');
  const [manualSpaceCategory, setManualSpaceCategory] = useState<SpaceCategory>('living');
  const [manualQty, setManualQty] = useState(1);

  const abortControllerRef = useRef<AbortController | null>(null);
  const seqCounterRef = useRef<number>(briefData.interpretedBrief?.requestSequenceId || 0);
  const latestBriefRef = useRef<ArchitecturalBrief | undefined>(briefData.interpretedBrief);
  latestBriefRef.current = interpreted;

  const updateLocalInterpreted = (next: ArchitecturalBrief) => {
    latestBriefRef.current = next;
    setInterpreted(next);
  };

  // Trigger interpretation (prevents duplicate submissions & protects against stale overwrites)
  const handleRunInterpretation = async (useLocalOnly = false) => {
    if (isLocked || isInterpreting) return;
    setErrorMessage(null);

    if (!inputText.trim()) {
      setErrorMessage('Please enter a project description in ordinary language before interpreting.');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const nextSeq = seqCounterRef.current + 1;
    seqCounterRef.current = nextSeq;
    const startedAt = new Date().toISOString();

    setIsInterpreting(true);
    try {
      const result = useLocalOnly
        ? interpretDesignBrief(inputText, project, {
            requestSequenceId: nextSeq,
            existingBrief: latestBriefRef.current,
          })
        : await interpretDesignBriefAsync(inputText, project, {
            requestSequenceId: nextSeq,
            existingBrief: latestBriefRef.current,
            signal: controller.signal,
            preferAi: true,
          });

      if (!shouldApplyInterpretationResponse(latestBriefRef.current, result, startedAt)) {
        showToast(
          'Discarded a stale interpretation response because newer edits were made.',
          'info'
        );
        return;
      }

      updateLocalInterpreted(result);
      showToast(
        `Extracted ${result.requirements.length} requirements and ${result.assumptions.length} assumptions for review.`,
        'success'
      );
    } catch (err: any) {
      if (err?.message?.includes('cancelled')) {
        showToast('Brief interpretation cancelled. Your draft was preserved.', 'info');
      } else {
        setErrorMessage(err?.message || 'Failed to interpret brief description.');
      }
    } finally {
      setIsInterpreting(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelInterpretation = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsInterpreting(false);
  };

  // Save draft without overwriting downstream project spaces
  const handleSaveDraft = () => {
    if (!interpreted) return;
    const updatedBriefData: ArchitecturalBriefData = {
      ...briefData,
      lastUpdated: new Date().toISOString(),
      interpretedBrief: interpreted,
    };
    onSaveBriefData(updatedBriefData, 'Interpreted brief draft saved to project');
  };

  // Confirm and integrate into Project Space Schedule
  const handleConfirmAndIntegrate = () => {
    if (!interpreted || isLocked) return;
    const { updatedBriefData, syncedSpacesCount } = integrateInterpretedBriefIntoProject(
      project,
      briefData,
      interpreted,
      { replaceExistingSpaces }
    );
    if (updatedBriefData.interpretedBrief) {
      updateLocalInterpreted(updatedBriefData.interpretedBrief);
    }
    onSaveBriefData(
      updatedBriefData,
      `Integrated confirmed brief (${syncedSpacesCount} space definitions synced to Space Schedule)`
    );
    setIsConfirmIntegrationOpen(false);
  };

  // Requirement inline handlers
  const handleUpdateReq = (reqId: string, updates: Partial<ProjectRequirement>) => {
    if (!interpreted || isLocked) return;
    const next = updateInterpretedRequirement(interpreted, reqId, updates, project);
    updateLocalInterpreted(next);
  };

  const handleDeleteReq = (reqId: string) => {
    if (!interpreted || isLocked) return;
    const next = removeInterpretedRequirement(interpreted, reqId, project);
    updateLocalInterpreted(next);
    showToast('Removed requirement from structured brief', 'info');
  };

  const handleAddManualReq = () => {
    if (!interpreted || isLocked) return;
    if (!manualDesc.trim()) {
      showToast('Please enter a requirement description', 'error');
      return;
    }
    const parsedNum = Number(manualValue);
    const normVal =
      manualValue.trim() !== '' && Number.isFinite(parsedNum)
        ? parsedNum
        : manualValue.trim() || manualDesc.trim();

    const next = addManualInterpretedRequirement(
      interpreted,
      {
        category: manualCategory,
        description: manualDesc.trim(),
        normalizedValue: normVal,
        unit: manualUnit.trim() || undefined,
        priority: manualPriority,
        quantity: manualCategory === 'spaces-program' ? manualQty : undefined,
        targetSpaceCategory: manualCategory === 'spaces-program' ? manualSpaceCategory : undefined,
      },
      project
    );
    updateLocalInterpreted(next);
    setManualDesc('');
    setManualValue('');
    setIsAddReqOpen(false);
    showToast('Added manual requirement to brief', 'success');
  };

  // Assumption review handler
  const handleAssumptionDecision = (
    assumptionId: string,
    decision: 'confirmed' | 'rejected'
  ) => {
    if (!interpreted || isLocked) return;
    const next = reviewBriefAssumption(
      interpreted,
      assumptionId,
      decision,
      undefined,
      undefined,
      project
    );
    updateLocalInterpreted(next);
    showToast(
      decision === 'confirmed'
        ? 'Assumption confirmed and linked requirement marked verified'
        : 'Assumption rejected',
      'info'
    );
  };

  // Clarification question handler
  const handleAnswerQuestion = (
    questionId: string,
    mode: 'answered' | 'proceed-with-assumption'
  ) => {
    if (!interpreted || isLocked) return;
    const ans =
      questionAnswers[questionId]?.trim() ||
      (mode === 'proceed-with-assumption'
        ? 'Proceeding with labelled architectural assumption'
        : '');
    if (mode === 'answered' && !ans) {
      showToast('Please enter a clarification response before submitting', 'error');
      return;
    }
    const next = answerClarificationQuestion(
      interpreted,
      questionId,
      ans,
      mode,
      project
    );
    updateLocalInterpreted(next);
    showToast('Recorded clarification response', 'success');
  };

  const filteredRequirements = (interpreted?.requirements || []).filter((r) => {
    if (categoryFilter !== 'all' && r.category !== categoryFilter) return false;
    if (sourceFilter !== 'all' && r.source !== sourceFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6" aria-label="AI Design Brief Interpreter Workspace">
      {/* Professional & Code Compliance Disclaimer Banner */}
      <div className="bg-slate-900 text-slate-100 rounded-xl p-4 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-teal-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-teal-400">
              P30 — Architectural Requirements Interpretation Layer
            </div>
            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
              Converts natural-language project descriptions into a traceable, editable architectural brief. Inferred assumptions are never silently treated as confirmed requirements. An interpreted brief is not a substitute for a licensed architect, structural engineer, or statutory building-code review.
            </p>
          </div>
        </div>
        {interpreted && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isLocked}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5 text-teal-400" />
              <span>Save Draft</span>
            </button>
            <button
              type="button"
              onClick={() => setIsConfirmIntegrationOpen(true)}
              disabled={isLocked || !interpreted.validation.readyForIntegration}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              title={
                interpreted.validation.readyForIntegration
                  ? 'Confirm and send confirmed spaces to Project Space Schedule'
                  : 'Resolve blocking contradictions before integrating into the project space program'
              }
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Confirm & Send to Space Program</span>
            </button>
          </div>
        )}
      </div>

      {/* STEP A: Natural Language Input Area */}
      <section
        aria-labelledby="p30-input-heading"
        className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
          <div>
            <h2
              id="p30-input-heading"
              className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-teal-700" />
              <span>Step 1 — Describe Project Requirements in Ordinary Language</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Include building use, occupants, rooms, floors, daylight/privacy preferences, parking, plot size, and budget. Every field is optional.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400">Load sample:</span>
            {SAMPLE_PROMPTS.map((sp, i) => (
              <button
                key={i}
                type="button"
                disabled={isLocked || isInterpreting}
                onClick={() => {
                  setInputText(sp.text);
                  setErrorMessage(null);
                }}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-slate-100 hover:bg-teal-50 text-slate-700 hover:text-teal-800 border border-slate-200 transition-colors cursor-pointer disabled:opacity-50"
              >
                {sp.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="p30-brief-textarea"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Natural-Language Architectural Description
          </label>
          <textarea
            id="p30-brief-textarea"
            rows={4}
            disabled={isLocked}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              if (errorMessage) setErrorMessage(null);
            }}
            placeholder="Example: I want a two-storey family house for six people, with four bedrooms, a separate guest area, an open kitchen, good natural light, privacy from the street, parking for two cars, and a moderate construction budget."
            className="w-full text-xs leading-relaxed p-3 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:bg-white focus:outline-teal-600 transition-colors"
          />
          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
            <span>
              Original wording is preserved for requirement traceability and revision comparison.
            </span>
            <span>{inputText.length.toLocaleString()} / 15,000 chars</span>
          </div>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-between gap-3 text-xs text-rose-800"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-600 hover:text-rose-900 font-semibold text-xs cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleRunInterpretation(false)}
              disabled={isLocked || isInterpreting}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold bg-teal-700 hover:bg-teal-800 text-white rounded-lg shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>
                {isInterpreting
                  ? 'Interpreting Brief...'
                  : interpreted
                  ? 'Re-Interpret Description'
                  : 'Interpret Brief Requirements'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleRunInterpretation(true)}
              disabled={isLocked || isInterpreting}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              title="Run deterministic local architectural parser directly"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-600" />
              <span>Deterministic Local Parse</span>
            </button>

            {isInterpreting && (
              <button
                type="button"
                onClick={handleCancelInterpretation}
                className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={isLocked || isInterpreting || !inputText}
            onClick={() => {
              setInputText('');
              setErrorMessage(null);
            }}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer disabled:opacity-40"
          >
            Clear Input Text
          </button>
        </div>
      </section>

      {/* EMPTY STATE IF NOT YET INTERPRETED */}
      {!interpreted && !isInterpreting && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 mx-auto flex items-center justify-center">
            <FileText className="w-5 h-5" />
          </div>
          <div className="text-sm font-bold text-slate-900">
            Ready to Interpret Architectural Brief
          </div>
          <p className="text-xs text-slate-500 max-w-lg mx-auto">
            Enter your project requirements above and click <strong>Interpret Brief Requirements</strong> to extract classified requirements, surface inferred assumptions, and detect spatial or budget conflicts.
          </p>
        </div>
      )}

      {/* STRUCTURED INTERPRETATION RESULTS */}
      {interpreted && (
        <div className="space-y-6">
          {/* Summary & Mode Notice */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Interpreted Project Summary
                </span>
                <span
                  className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                    interpreted.interpreterMode === 'ai-assisted'
                      ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                      : 'bg-teal-50 text-teal-800 border-teal-200'
                  }`}
                >
                  {interpreted.interpreterMode === 'ai-assisted'
                    ? 'AI-Assisted + Deterministic Validation'
                    : 'Deterministic Local Engine'}
                </span>
              </div>
              <span className="text-[11px] text-slate-400">
                Seq #{interpreted.requestSequenceId} • Last interpreted{' '}
                {new Date(interpreted.interpretedAt).toLocaleTimeString()}
              </span>
            </div>

            <p className="text-xs font-medium text-slate-800 bg-slate-50 p-3 rounded-lg border border-slate-200">
              {interpreted.projectSummary}
            </p>

            {interpreted.aiProviderNotice && (
              <div className="flex items-center gap-2 text-[11px] text-slate-600 bg-slate-100/80 px-3 py-1.5 rounded-lg">
                <Info className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                <span>{interpreted.aiProviderNotice}</span>
              </div>
            )}
          </div>

          {/* STEP D: Inferred Assumptions & Conflicts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Inferred Assumptions Requiring Review */}
            <section
              aria-labelledby="p30-assumptions-heading"
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3"
            >
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-amber-600" />
                  <h3
                    id="p30-assumptions-heading"
                    className="text-xs font-bold text-slate-900 uppercase tracking-wider"
                  >
                    Inferred Assumptions Requiring Review ({interpreted.assumptions.length})
                  </h3>
                </div>
                <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                  {interpreted.assumptions.filter((a) => a.status === 'pending').length} Pending
                </span>
              </div>

              <p className="text-[11px] text-slate-500">
                Assumptions are inferred where details were omitted. They are never treated as confirmed requirements unless you explicitly confirm them.
              </p>

              <div className="space-y-2.5">
                {interpreted.assumptions.map((assump) => (
                  <div
                    key={assump.id}
                    className={`p-3 rounded-xl border text-xs space-y-2 ${
                      assump.status === 'confirmed'
                        ? 'bg-teal-50/40 border-teal-200'
                        : assump.status === 'rejected'
                        ? 'bg-slate-100 border-slate-200 opacity-60'
                        : 'bg-amber-50/50 border-amber-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-900">{assump.description}</div>
                      <span
                        className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded shrink-0 ${
                          assump.status === 'confirmed'
                            ? 'bg-teal-100 text-teal-800'
                            : assump.status === 'rejected'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-900'
                        }`}
                      >
                        {assump.status}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-600">{assump.rationale}</div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] font-mono text-slate-700">
                        Assumed: <strong>{String(assump.assumedValue)}</strong>{' '}
                        {assump.unit || ''}
                      </span>

                      {!isLocked && (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleAssumptionDecision(assump.id, 'confirmed')}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                              assump.status === 'confirmed'
                                ? 'bg-teal-700 text-white'
                                : 'bg-white hover:bg-teal-50 text-teal-800 border border-teal-300'
                            }`}
                          >
                            <Check className="w-3 h-3" />
                            <span>Confirm</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAssumptionDecision(assump.id, 'rejected')}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                              assump.status === 'rejected'
                                ? 'bg-rose-700 text-white'
                                : 'bg-white hover:bg-rose-50 text-rose-700 border border-rose-200'
                            }`}
                          >
                            <X className="w-3 h-3" />
                            <span>Reject</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Ambiguities, Conflicts & Clarification Questions */}
            <section
              aria-labelledby="p30-conflicts-heading"
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3"
            >
              <div className="flex items-center justify-between pb-2.5 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <h3
                    id="p30-conflicts-heading"
                    className="text-xs font-bold text-slate-900 uppercase tracking-wider"
                  >
                    Conflicts, Missing Info & Clarifications ({interpreted.conflicts.length})
                  </h3>
                </div>
              </div>

              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {interpreted.conflicts.map((conf) => (
                  <div
                    key={conf.id}
                    className={`p-3 rounded-xl border text-xs space-y-1.5 ${
                      conf.disposition === 'confirmed-contradiction'
                        ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                        : conf.disposition === 'potential-conflict-professional-review'
                        ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                        : conf.disposition === 'missing-information'
                        ? 'bg-sky-50/70 border-sky-200 text-sky-950'
                        : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold">{conf.title}</span>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/80 border border-black/10 shrink-0">
                        {conf.disposition.replace(/-/g, ' ')}
                      </span>
                    </div>
                    <p className="text-[11px] opacity-90">{conf.description}</p>
                    <div className="text-[11px] font-semibold pt-1 border-t border-black/5">
                      Suggested Action: {conf.resolutionSuggestion}
                    </div>
                  </div>
                ))}

                {/* Clarification Questions */}
                {interpreted.clarificationQuestions.map((q) => (
                  <div
                    key={q.id}
                    className="p-3 rounded-xl border border-indigo-200 bg-indigo-50/40 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-indigo-950">
                        Clarification Needed: {q.question}
                      </span>
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-indigo-100 text-indigo-800">
                        {q.status}
                      </span>
                    </div>
                    <p className="text-[11px] text-indigo-900/80">{q.reason}</p>

                    {q.status !== 'open' && q.userAnswer && (
                      <div className="text-[11px] font-semibold text-teal-800 bg-teal-50 px-2.5 py-1 rounded border border-teal-200">
                        Recorded Response: {q.userAnswer}
                      </div>
                    )}

                    {!isLocked && (
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                        <input
                          type="text"
                          aria-label={`Answer for ${q.question}`}
                          placeholder="Enter clarification (e.g., sq ft, USD 450000, 50x80 ft)..."
                          value={questionAnswers[q.id] ?? q.userAnswer ?? ''}
                          onChange={(e) =>
                            setQuestionAnswers((prev) => ({
                              ...prev,
                              [q.id]: e.target.value,
                            }))
                          }
                          className="flex-1 text-xs px-2.5 py-1.5 bg-white border border-indigo-200 rounded-lg text-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => handleAnswerQuestion(q.id, 'answered')}
                          className="px-2.5 py-1.5 text-[11px] font-semibold bg-indigo-700 hover:bg-indigo-800 text-white rounded-lg cursor-pointer"
                        >
                          Submit Answer
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleAnswerQuestion(q.id, 'proceed-with-assumption')
                          }
                          className="px-2.5 py-1.5 text-[11px] font-semibold bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg cursor-pointer"
                        >
                          Use Assumption
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* STEP E: Editable Structured Requirements Table */}
          <section
            aria-labelledby="p30-requirements-heading"
            className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs"
          >
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3
                  id="p30-requirements-heading"
                  className="text-xs font-bold text-slate-900 uppercase tracking-wider"
                >
                  Step 2 — Review & Edit Extracted Architectural Requirements (
                  {filteredRequirements.length})
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Confirmed user statements are badged in Teal; inferred requirements are badged in Amber and require explicit confirmation.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Filter requirements by category"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700"
                >
                  <option value="all">All Categories</option>
                  {VALID_REQUIREMENT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter requirements by source"
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700"
                >
                  <option value="all">All Sources</option>
                  <option value="explicit">Explicit User Statement</option>
                  <option value="inferred">Inferred Interpretation</option>
                  <option value="user-edited">User Edited / Added</option>
                </select>

                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setIsAddReqOpen(!isAddReqOpen)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Requirement</span>
                </button>
              </div>
            </div>

            {/* Inline Add Requirement Form */}
            {isAddReqOpen && !isLocked && (
              <div className="p-4 bg-teal-50/50 border-b border-teal-200 space-y-3">
                <div className="text-xs font-bold text-teal-950 uppercase tracking-wider">
                  Add Manual Architectural Requirement
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-6 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Category
                    </label>
                    <select
                      value={manualCategory}
                      onChange={(e) =>
                        setManualCategory(e.target.value as RequirementCategory)
                      }
                      className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      {VALID_REQUIREMENT_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {CATEGORY_LABELS[cat]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Requirement Description
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., Dedicated Walk-in Pantry"
                      value={manualDesc}
                      onChange={(e) => setManualDesc(e.target.value)}
                      className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Target Value & Unit
                    </label>
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        placeholder="80"
                        value={manualValue}
                        onChange={(e) => setManualValue(e.target.value)}
                        className="w-16 text-xs px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                      <input
                        type="text"
                        placeholder="sq ft"
                        value={manualUnit}
                        onChange={(e) => setManualUnit(e.target.value)}
                        className="w-16 text-xs px-2 py-1.5 bg-white border border-slate-300 rounded-lg"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      Priority
                    </label>
                    <select
                      value={manualPriority}
                      onChange={(e) =>
                        setManualPriority(e.target.value as RequirementPriority)
                      }
                      className="w-full text-xs px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg"
                    >
                      <option value="must-have">Must-Have</option>
                      <option value="preferred">Preferred</option>
                      <option value="optional">Optional</option>
                    </select>
                  </div>
                </div>

                {manualCategory === 'spaces-program' && (
                  <div className="flex flex-wrap items-center gap-4 pt-1">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-semibold text-slate-600">
                        Space Function:
                      </label>
                      <select
                        value={manualSpaceCategory}
                        onChange={(e) =>
                          setManualSpaceCategory(e.target.value as SpaceCategory)
                        }
                        className="text-xs px-2 py-1 bg-white border border-slate-300 rounded-md"
                      >
                        <option value="living">Living</option>
                        <option value="sleeping">Sleeping</option>
                        <option value="service">Service / Kitchen</option>
                        <option value="hygiene">Bathroom / Hygiene</option>
                        <option value="work">Work / Study</option>
                        <option value="outdoor">Outdoor</option>
                        <option value="circulation">Circulation</option>
                        <option value="specialized">Specialized</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-semibold text-slate-600">
                        Quantity:
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={manualQty}
                        onChange={(e) => setManualQty(Number(e.target.value) || 1)}
                        className="w-14 text-xs px-2 py-1 bg-white border border-slate-300 rounded-md"
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsAddReqOpen(false)}
                    className="px-3 py-1 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddManualReq}
                    className="px-3 py-1 text-xs font-semibold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
                  >
                    Save Requirement
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold text-[11px]">
                  <tr>
                    <th className="py-2.5 px-3">Requirement & Traceability Excerpt</th>
                    <th className="py-2.5 px-3">Category</th>
                    <th className="py-2.5 px-3">Value & Unit</th>
                    <th className="py-2.5 px-3">Priority</th>
                    <th className="py-2.5 px-3">Source</th>
                    <th className="py-2.5 px-3">Review Status</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-800">
                  {filteredRequirements.map((req) => (
                    <tr
                      key={req.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        req.reviewStatus === 'rejected' ? 'opacity-50 bg-slate-50' : ''
                      }`}
                    >
                      <td className="py-2.5 px-3">
                        {isLocked ? (
                          <div className="font-semibold text-slate-900">{req.description}</div>
                        ) : (
                          <input
                            type="text"
                            aria-label={`Edit description for ${req.id}`}
                            value={req.description}
                            onChange={(e) =>
                              handleUpdateReq(req.id, { description: e.target.value })
                            }
                            className="w-full font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-teal-600 focus:bg-white px-1 py-0.5 rounded focus:outline-none"
                          />
                        )}
                        <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                          <span className="font-mono text-[10px]">{req.id}</span>
                          {req.sourceExcerpt && (
                            <span className="italic text-slate-500">
                              Excerpt: &ldquo;{req.sourceExcerpt}&rdquo;
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <select
                          aria-label={`Category for ${req.description}`}
                          disabled={isLocked}
                          value={req.category}
                          onChange={(e) =>
                            handleUpdateReq(req.id, {
                              category: e.target.value as RequirementCategory,
                            })
                          }
                          className="text-[11px] bg-slate-100 border border-slate-200 rounded px-2 py-1 text-slate-700"
                        >
                          {VALID_REQUIREMENT_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {CATEGORY_LABELS[cat]}
                            </option>
                          ))}
                        </select>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            aria-label={`Normalized value for ${req.description}`}
                            disabled={isLocked}
                            value={String(req.normalizedValue)}
                            onChange={(e) => {
                              const raw = e.target.value;
                              const num = Number(raw);
                              handleUpdateReq(req.id, {
                                normalizedValue:
                                  raw.trim() !== '' && Number.isFinite(num) ? num : raw,
                              });
                            }}
                            className="w-20 text-xs px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded font-mono"
                          />
                          <input
                            type="text"
                            aria-label={`Unit for ${req.description}`}
                            disabled={isLocked}
                            placeholder="unit"
                            value={req.unit || ''}
                            onChange={(e) =>
                              handleUpdateReq(req.id, {
                                unit: e.target.value.trim() || undefined,
                              })
                            }
                            className={`w-16 text-[11px] px-1.5 py-0.5 border rounded font-mono ${
                              req.validationStatus === 'missing-unit'
                                ? 'bg-amber-50 border-amber-300 text-amber-900'
                                : 'bg-slate-50 border-slate-200 text-slate-600'
                            }`}
                          />
                        </div>
                      </td>

                      <td className="py-2.5 px-3">
                        <select
                          aria-label={`Priority for ${req.description}`}
                          disabled={isLocked}
                          value={req.priority}
                          onChange={(e) =>
                            handleUpdateReq(req.id, {
                              priority: e.target.value as RequirementPriority,
                            })
                          }
                          className={`text-[11px] font-bold uppercase px-2 py-1 rounded border ${
                            req.priority === 'must-have'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : req.priority === 'preferred'
                              ? 'bg-teal-50 text-teal-800 border-teal-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          <option value="must-have">Must-Have</option>
                          <option value="preferred">Preferred</option>
                          <option value="optional">Optional</option>
                        </select>
                      </td>

                      <td className="py-2.5 px-3">
                        <span
                          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                            req.source === 'explicit'
                              ? 'bg-teal-50 text-teal-800 border-teal-200'
                              : req.source === 'inferred'
                              ? 'bg-amber-50 text-amber-900 border-amber-300'
                              : 'bg-indigo-50 text-indigo-800 border-indigo-200'
                          }`}
                        >
                          {req.source}
                        </span>
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-1">
                          <span
                            className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                              req.reviewStatus === 'confirmed'
                                ? 'bg-emerald-100 text-emerald-800'
                                : req.reviewStatus === 'rejected'
                                ? 'bg-rose-100 text-rose-800'
                                : 'bg-amber-100 text-amber-900'
                            }`}
                          >
                            {req.reviewStatus}
                          </span>
                          {!isLocked && req.reviewStatus !== 'confirmed' && (
                            <button
                              type="button"
                              onClick={() =>
                                handleUpdateReq(req.id, { reviewStatus: 'confirmed' })
                              }
                              className="p-1 text-teal-700 hover:bg-teal-50 rounded cursor-pointer"
                              title="Confirm this requirement"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right">
                        {!isLocked && (
                          <button
                            type="button"
                            onClick={() => handleDeleteReq(req.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-slate-100 cursor-pointer"
                            title="Remove Requirement"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* STEP F & G: Validation Summary & Downstream Workflow Readiness */}
          <section
            aria-labelledby="p30-validation-heading"
            className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3
                  id="p30-validation-heading"
                  className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 text-teal-700" />
                  <span>
                    Step 3 — Pre-Integration Validation & Downstream Workflow Compatibility
                  </span>
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {interpreted.validation.complianceDisclaimer}
                </p>
              </div>
              <span
                className={`text-xs font-bold uppercase px-3 py-1 rounded-full ${
                  interpreted.validation.readyForIntegration
                    ? 'bg-teal-100 text-teal-900 border border-teal-300'
                    : 'bg-rose-100 text-rose-900 border border-rose-300'
                }`}
              >
                {interpreted.validation.readyForIntegration
                  ? 'Ready for Project Integration'
                  : 'Action Required: Resolve Blocking Contradictions'}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="font-bold text-slate-900 uppercase text-[11px]">
                  Confirmed vs Unverified State
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Confirmed Requirements:</span>
                  <strong className="text-teal-800">
                    {interpreted.validation.confirmedRequirementsCount}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Unverified Assumptions:</span>
                  <strong className="text-amber-800">
                    {interpreted.validation.unverifiedAssumptionsCount}
                  </strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Blocking Contradictions:</span>
                  <strong className="text-rose-700">
                    {interpreted.validation.unresolvedConflicts.length}
                  </strong>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="font-bold text-slate-900 uppercase text-[11px]">
                  Items Requiring External Professional / Authority Review
                </div>
                <ul className="list-disc list-inside text-[11px] text-slate-600 space-y-1">
                  {interpreted.validation.professionalVerificationItems.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
                <div className="font-bold text-slate-900 uppercase text-[11px]">
                  Downstream Plotify Workflow Consumers
                </div>
                <div className="space-y-1.5">
                  {interpreted.validation.downstreamCompatibility.map((wf) => (
                    <div
                      key={wf.workflowId}
                      className="flex items-center justify-between text-[11px]"
                    >
                      <span className="text-slate-700 font-medium">{wf.workflowName}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold uppercase text-[10px] ${
                          wf.canConsume
                            ? 'bg-teal-100 text-teal-800'
                            : 'bg-slate-200 text-slate-600'
                        }`}
                      >
                        {wf.canConsume ? 'Compatible' : 'Needs Input'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* MODAL: EXPLICIT USER CONFIRMATION BEFORE INTEGRATING INTO PROJECT BRIEF */}
      {isConfirmIntegrationOpen && interpreted && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="p30-confirm-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-2xl max-w-lg w-full border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="p-5 border-b border-slate-200">
              <h3 id="p30-confirm-modal-title" className="text-base font-bold text-slate-900">
                Confirm Integration into Project Brief & Space Schedule
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                This action updates the structured project brief and space program. It will NOT overwrite or regenerate your 2D Floor Plan geometry.
              </p>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1">
                <div>
                  <strong>Confirmed Requirements to Integrate:</strong>{' '}
                  {interpreted.validation.confirmedRequirementsCount}
                </div>
                <div>
                  <strong>Unverified Assumptions Remaining:</strong>{' '}
                  {interpreted.validation.unverifiedAssumptionsCount} (will not be promoted to confirmed spaces unless confirmed)
                </div>
              </div>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExistingSpaces}
                  onChange={(e) => setReplaceExistingSpaces(e.target.checked)}
                  className="mt-0.5 accent-teal-700"
                />
                <span className="text-slate-700">
                  <strong>Replace existing Space Schedule entries</strong> with the newly confirmed spaces (leave unchecked to merge with existing spaces).
                </span>
              </label>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsConfirmIntegrationOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  handleConfirmAndIntegrate();
                  onSwitchToSpacesTab();
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-teal-700 hover:bg-teal-800 text-white rounded-lg cursor-pointer"
              >
                <span>Confirm & Update Space Schedule</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
