/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * P34 — Universal Accessibility Review Workspace
 * Account A | Locked Roadmap: P34 of P30–P40
 */

import React, { useState, useMemo } from 'react';
import {
  Accessibility,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Info,
  ArrowLeft,
  RotateCcw,
  Eye,
  Play,
  Plus,
  Trash2,
  Layers,
  DoorOpen,
  Compass,
  FileText,
  Scale,
  Sparkles,
  Armchair,
  PenTool,
  Sliders,
} from 'lucide-react';
import { Project } from '../../types/project';
import {
  AccessibilityRuleProfileId,
  AccessibilityResultStatus,
  BuildingOccupancyAccessibilityType,
  ConstructionAccessibilityScope,
  AccessibilitySuggestionPreview,
  AccessibleRampElement,
  AccessibleVerticalLiftElement,
  AccessibleStairElement,
  AccessibleFixtureMetadata,
  AccessibleOperableControlElement,
  AccessibleSensoryWayfindingElement,
} from '../../types/universalAccessibility';
import {
  ensureProjectAccessibilityReviewData,
  evaluateUniversalAccessibility,
  getAccessibilityRuleProfiles,
  previewAccessibilitySuggestion,
  applyAccessibilitySuggestionSafely,
  saveProjectAccessibilityReviewSafely,
  rollbackAccessibilityChanges,
  getP34SummaryForOptionComparison,
} from '../../services/universalAccessibilityService';
import {
  ensureProjectFurnitureLayoutData,
  getInstanceFootprintRect,
  getKnownOpeningZones,
} from '../../services/furnitureIntelligenceService';

interface UniversalAccessibilityWorkspaceProps {
  project: Project;
  onUpdateProject: (updated: Project) => void;
  onBack?: () => void;
  onOpenFloorPlan?: (project: Project) => void;
  onOpenBrief?: (project: Project) => void;
  onOpenDesignComparison?: (project: Project) => void;
  onOpenDesignPersonalization?: (project: Project) => void;
  onOpenFurnitureCirculation?: (project: Project) => void;
  showToast?: (message: string, type?: 'success' | 'error' | 'info') => void;
}

function getStatusBadgeConfig(status: AccessibilityResultStatus): {
  label: string;
  bg: string;
  text: string;
  border: string;
} {
  switch (status) {
    case 'meets-configured-criterion':
      return {
        label: 'Meets Criterion',
        bg: 'bg-emerald-50',
        text: 'text-emerald-800',
        border: 'border-emerald-200',
      };
    case 'does-not-meet-configured-criterion':
      return {
        label: 'Does Not Meet',
        bg: 'bg-rose-50',
        text: 'text-rose-800',
        border: 'border-rose-200',
      };
    case 'warning':
      return {
        label: 'Warning / Near Limit',
        bg: 'bg-amber-50',
        text: 'text-amber-900',
        border: 'border-amber-200',
      };
    case 'insufficient-data':
      return {
        label: 'Insufficient Data',
        bg: 'bg-slate-100',
        text: 'text-slate-700',
        border: 'border-slate-300',
      };
    case 'unassessed':
      return {
        label: 'Unassessed Topic',
        bg: 'bg-slate-100',
        text: 'text-slate-600',
        border: 'border-slate-200',
      };
    case 'requires-human-review':
      return {
        label: 'Requires Human Review',
        bg: 'bg-purple-50',
        text: 'text-purple-800',
        border: 'border-purple-200',
      };
    case 'not-applicable':
      return {
        label: 'Not Applicable',
        bg: 'bg-slate-50',
        text: 'text-slate-500',
        border: 'border-slate-200',
      };
  }
}

export const UniversalAccessibilityWorkspace: React.FC<
  UniversalAccessibilityWorkspaceProps
> = ({
  project,
  onUpdateProject,
  onBack,
  onOpenFloorPlan,
  onOpenBrief,
  onOpenDesignComparison,
  onOpenDesignPersonalization,
  onOpenFurnitureCirculation,
  showToast,
}) => {
  const [selectedFloor, setSelectedFloor] = useState<number>(1);
  const [activeSubTab, setActiveSubTab] = useState<
    'overview-canvas' | 'criteria-ledger' | 'elements-editor' | 'topics-coverage' | 'suggestions' | 'cross-engine'
  >('overview-canvas');
  const [statusFilter, setStatusFilter] = useState<AccessibilityResultStatus | 'all'>('all');
  const [activePreview, setActivePreview] = useState<AccessibilitySuggestionPreview | null>(null);

  // Element Editor local form states
  const [newRampName, setNewRampName] = useState('Main Entry Accessible Ramp');
  const [newRampRise, setNewRampRise] = useState('1.0');
  const [newRampRun, setNewRampRun] = useState('12.0');
  const [newRampWidth, setNewRampWidth] = useState('3.5');

  const [newLiftName, setNewLiftName] = useState('Passenger Accessible Lift');
  const [newLiftWidth, setNewLiftWidth] = useState('4.5');
  const [newLiftDepth, setNewLiftDepth] = useState('5.8');
  const [newLiftDoorWidth, setNewLiftDoorWidth] = useState('3.0');

  const [newFixtureRoomId, setNewFixtureRoomId] = useState<string>(
    project.floorPlan?.rooms?.[0]?.id || ''
  );
  const [newFixtureType, setNewFixtureType] =
    useState<AccessibleFixtureMetadata['fixtureType']>('wc-toilet');
  const [newFixtureGrabBars, setNewFixtureGrabBars] = useState(true);
  const [newFixtureTransfer, setNewFixtureTransfer] = useState(true);
  const [newFixtureKnee, setNewFixtureKnee] = useState(true);

  const [newControlRoomId, setNewControlRoomId] = useState<string>(
    project.floorPlan?.rooms?.[0]?.id || ''
  );
  const [newControlType, setNewControlType] =
    useState<AccessibleOperableControlElement['controlType']>('light-switch');
  const [newControlHeight, setNewControlHeight] = useState(
    project.unit === 'feet' ? '42' : '1050'
  );

  const reviewData = useMemo(
    () => ensureProjectAccessibilityReviewData(project),
    [project]
  );
  const furnitureData = useMemo(
    () => ensureProjectFurnitureLayoutData(project),
    [project]
  );
  const report = useMemo(
    () => evaluateUniversalAccessibility(project),
    [project]
  );
  const p31ComparisonSummary = useMemo(
    () => getP34SummaryForOptionComparison(project),
    [project]
  );
  const allProfiles = useMemo(
    () =>
      getAccessibilityRuleProfiles(
        project.unit,
        reviewData.buildingOccupancyType,
        reviewData.constructionScope,
        reviewData.customThresholds
      ),
    [project.unit, reviewData]
  );

  const unitSuffix = project.unit === 'feet' ? 'ft' : 'm';
  const minorUnitSuffix = project.unit === 'feet' ? 'in' : 'mm';
  const rooms = project.floorPlan?.rooms || [];
  const floorRooms = rooms.filter((r) => r.floorLevel === selectedFloor);

  const handleProfileChange = (nextProfileId: AccessibilityRuleProfileId) => {
    const nextReview = {
      ...reviewData,
      activeProfileId: nextProfileId,
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(
      project,
      nextReview,
      false
    );
    onUpdateProject(updatedProject);
    setActivePreview(null);
    showToast?.(
      `Switched accessibility review profile to "${allProfiles[nextProfileId].name}".`,
      'info'
    );
  };

  const handleOccupancyChange = (nextOccupancy: BuildingOccupancyAccessibilityType) => {
    const nextReview = {
      ...reviewData,
      buildingOccupancyType: nextOccupancy,
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(
      project,
      nextReview,
      false
    );
    onUpdateProject(updatedProject);
  };

  const handleScopeChange = (nextScope: ConstructionAccessibilityScope) => {
    const nextReview = {
      ...reviewData,
      constructionScope: nextScope,
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(
      project,
      nextReview,
      false
    );
    onUpdateProject(updatedProject);
  };

  const handlePreviewSuggestion = (suggestionId: string) => {
    const preview = previewAccessibilitySuggestion(project, suggestionId);
    setActivePreview(preview);
  };

  const handleApplySuggestion = (suggestionId: string) => {
    try {
      const { updatedProject, preview } = applyAccessibilitySuggestionSafely(
        project,
        suggestionId
      );
      onUpdateProject(updatedProject);
      setActivePreview(null);
      showToast?.(
        `Applied "${preview.suggestionTitle}" (resolved ${preview.resolvedCriterionIds.length} accessibility issue(s)). Pre-apply checkpoint saved.`,
        'success'
      );
    } catch (err: any) {
      showToast?.(err.message || 'Failed to apply suggestion.', 'error');
    }
  };

  const handleRollback = () => {
    try {
      const restored = rollbackAccessibilityChanges(project);
      onUpdateProject(restored);
      setActivePreview(null);
      showToast?.(
        'Rolled back project to pre-apply accessibility checkpoint.',
        'info'
      );
    } catch (err: any) {
      showToast?.(err.message || 'Rollback failed.', 'error');
    }
  };

  const handleUpdateDoorClearWidth = (openingId: string, clearWidthStr: string, thresholdStr: string) => {
    const cw = parseFloat(clearWidthStr);
    const th = parseFloat(thresholdStr);
    const nextDetails = { ...reviewData.elements.doorDetails };
    nextDetails[openingId] = {
      openingId,
      clearOpeningWidth: !isNaN(cw) && cw > 0 ? cw : undefined,
      thresholdHeightMinorUnit: !isNaN(th) && th >= 0 ? th : undefined,
      provenance: 'user-entered',
      updatedAt: new Date().toISOString(),
    };
    const nextReview = {
      ...reviewData,
      elements: {
        ...reviewData.elements,
        doorDetails: nextDetails,
      },
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(project, nextReview, false);
    onUpdateProject(updatedProject);
    showToast?.(`Updated door accessibility details for ${openingId}.`, 'success');
  };

  const handleAddRamp = () => {
    const rise = parseFloat(newRampRise) || 1.0;
    const run = parseFloat(newRampRun) || 12.0;
    const width = parseFloat(newRampWidth) || 3.5;
    const newRamp: AccessibleRampElement = {
      rampId: `ramp-${Date.now()}`,
      name: newRampName.trim() || 'Accessible Ramp',
      floorLevelStart: 1,
      floorLevelEnd: project.floors > 1 ? 2 : 1,
      connectsRoomOrExteriorIds: [],
      clearWidth: width,
      runLength: run,
      verticalRise: rise,
      topLandingLength: report.activeRuleProfile.thresholds.minRampLandingLength,
      bottomLandingLength: report.activeRuleProfile.thresholds.minRampLandingLength,
      hasHandrailsBothSides: true,
      hasEdgeProtection: true,
      provenance: 'user-entered',
      updatedAt: new Date().toISOString(),
    };
    const nextReview = {
      ...reviewData,
      elements: {
        ...reviewData.elements,
        ramps: [...reviewData.elements.ramps, newRamp],
      },
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(project, nextReview, false);
    onUpdateProject(updatedProject);
    showToast?.(`Added ramp "${newRamp.name}".`, 'success');
  };

  const handleDeleteRamp = (rampId: string) => {
    const nextReview = {
      ...reviewData,
      elements: {
        ...reviewData.elements,
        ramps: reviewData.elements.ramps.filter((r) => r.rampId !== rampId),
      },
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(project, nextReview, false);
    onUpdateProject(updatedProject);
  };

  const handleAddLift = () => {
    const servedFloors = Array.from({ length: Math.max(1, project.floors) }, (_, idx) => idx + 1);
    const newLift: AccessibleVerticalLiftElement = {
      liftId: `lift-${Date.now()}`,
      name: newLiftName.trim() || 'Accessible Lift',
      liftType: 'passenger-elevator',
      servedFloors,
      cabClearWidth: parseFloat(newLiftWidth) || 4.5,
      cabClearDepth: parseFloat(newLiftDepth) || 5.8,
      doorClearWidth: parseFloat(newLiftDoorWidth) || 3.0,
      hasTactileAndBrailleControls: true,
      hasAudibleAndVisualIndicators: true,
      provenance: 'user-entered',
      updatedAt: new Date().toISOString(),
    };
    const nextReview = {
      ...reviewData,
      elements: {
        ...reviewData.elements,
        verticalLifts: [...reviewData.elements.verticalLifts, newLift],
      },
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(project, nextReview, false);
    onUpdateProject(updatedProject);
    showToast?.(`Added vertical lift "${newLift.name}" serving Floors ${servedFloors.join(', ')}.`, 'success');
  };

  const handleDeleteLift = (liftId: string) => {
    const nextReview = {
      ...reviewData,
      elements: {
        ...reviewData.elements,
        verticalLifts: reviewData.elements.verticalLifts.filter((l) => l.liftId !== liftId),
      },
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(project, nextReview, false);
    onUpdateProject(updatedProject);
  };

  const handleAddStair = () => {
    const newStair: AccessibleStairElement = {
      stairId: `stair-${Date.now()}`,
      name: 'Main Internal Stairway',
      floorLevelStart: 1,
      floorLevelEnd: Math.max(2, project.floors),
      clearWidth: project.unit === 'feet' ? 3.5 : 1.1,
      hasContinuousHandrails: true,
      hasTactileWarningStrips: true,
      hasVisualContrastNosings: true,
      provenance: 'user-entered',
      updatedAt: new Date().toISOString(),
    };
    const nextReview = {
      ...reviewData,
      elements: {
        ...reviewData.elements,
        stairs: [...reviewData.elements.stairs, newStair],
      },
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(project, nextReview, false);
    onUpdateProject(updatedProject);
    showToast?.('Added ambulatory stairway record.', 'info');
  };

  const handleAddFixtureDetail = () => {
    if (!newFixtureRoomId) return;
    const room = rooms.find((r) => r.id === newFixtureRoomId);
    const newFix: AccessibleFixtureMetadata = {
      fixtureId: `fix-${Date.now()}`,
      roomId: newFixtureRoomId,
      floorLevel: room?.floorLevel || 1,
      fixtureType: newFixtureType,
      hasGrabBarsOrBlocking: newFixtureGrabBars,
      hasTransferSpace: newFixtureTransfer,
      hasKneeAndToeClearance: newFixtureKnee,
      provenance: 'user-entered',
      updatedAt: new Date().toISOString(),
    };
    const nextReview = {
      ...reviewData,
      elements: {
        ...reviewData.elements,
        fixtureDetails: [...reviewData.elements.fixtureDetails, newFix],
      },
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(project, nextReview, false);
    onUpdateProject(updatedProject);
    showToast?.(`Added fixture metadata (${newFixtureType}) for ${room?.name || newFixtureRoomId}.`, 'success');
  };

  const handleAddControlDetail = () => {
    if (!newControlRoomId) return;
    const room = rooms.find((r) => r.id === newControlRoomId);
    const newCtrl: AccessibleOperableControlElement = {
      controlId: `ctrl-${Date.now()}`,
      roomId: newControlRoomId,
      floorLevel: room?.floorLevel || 1,
      controlType: newControlType,
      mountingHeightMinorUnit: parseFloat(newControlHeight) || 42,
      hasClearFloorSpaceAtControl: true,
      isObstructedReach: false,
      operableSingleHandWithoutTwisting: true,
      provenance: 'user-entered',
      updatedAt: new Date().toISOString(),
    };
    const nextReview = {
      ...reviewData,
      elements: {
        ...reviewData.elements,
        operableControls: [...reviewData.elements.operableControls, newCtrl],
      },
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(project, nextReview, false);
    onUpdateProject(updatedProject);
    showToast?.(`Added operable control (${newControlType}) at ${newControlHeight} ${minorUnitSuffix}.`, 'success');
  };

  const handleAddSensoryProvision = (
    category: AccessibleSensoryWayfindingElement['category'],
    description: string
  ) => {
    const newElem: AccessibleSensoryWayfindingElement = {
      elementId: `sens-${Date.now()}`,
      floorLevel: selectedFloor,
      category,
      description,
      isProvided: true,
      provenance: 'user-entered',
      updatedAt: new Date().toISOString(),
    };
    const nextReview = {
      ...reviewData,
      elements: {
        ...reviewData.elements,
        sensoryAndWayfinding: [...reviewData.elements.sensoryAndWayfinding, newElem],
      },
    };
    const { updatedProject } = saveProjectAccessibilityReviewSafely(project, nextReview, false);
    onUpdateProject(updatedProject);
    showToast?.(`Recorded sensory/wayfinding provision: "${description}".`, 'success');
  };

  const filteredCriteria = useMemo(() => {
    if (statusFilter === 'all') return report.allCriterionResults;
    return report.allCriterionResults.filter((c) => c.status === statusFilter);
  }, [report.allCriterionResults, statusFilter]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Navigation & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Overview</span>
            </button>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-teal-900 text-teal-300 rounded">
                P34 Engine
              </span>
              <span className="text-xs font-semibold text-slate-500">
                Universal Accessibility Review · {report.engineVersion}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
              {project.name} — Universal Accessibility Review
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {reviewData.lastPreApplySnapshotId && (
            <button
              onClick={handleRollback}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors cursor-pointer"
              title="Restore project state to pre-apply checkpoint"
            >
              <RotateCcw className="w-3.5 h-3.5 text-amber-700" />
              <span>Rollback Last Change</span>
            </button>
          )}
          {onOpenFloorPlan && (
            <button
              onClick={() => onOpenFloorPlan(project)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <PenTool className="w-3.5 h-3.5 text-teal-700" />
              <span>2D Plan Editor</span>
            </button>
          )}
          {onOpenFurnitureCirculation && (
            <button
              onClick={() => onOpenFurnitureCirculation(project)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
            >
              <Armchair className="w-3.5 h-3.5 text-indigo-700" />
              <span>P33 Furniture & Circulation</span>
            </button>
          )}
        </div>
      </div>

      {/* Jurisdiction & Accessibility Rule Profile Governance Banner */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-3 border-b border-slate-100">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Accessibility className="w-4 h-4 text-teal-700" />
              <h2 className="text-sm font-bold text-slate-900">
                Active Accessibility Review Profile & Jurisdiction Basis
              </h2>
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${
                  report.activeRuleProfile.authorityClassification === 'general-screening-only'
                    ? 'bg-amber-50 text-amber-900 border-amber-200'
                    : report.activeRuleProfile.authorityClassification === 'statutory-standard'
                    ? 'bg-teal-50 text-teal-900 border-teal-200'
                    : 'bg-indigo-50 text-indigo-900 border-indigo-200'
                }`}
              >
                {report.activeRuleProfile.authorityClassification.replace(/-/g, ' ')}
              </span>
            </div>
            <p className="text-xs text-slate-600">
              <span className="font-semibold text-slate-800">
                {report.activeRuleProfile.standardName}
              </span>{' '}
              ({report.activeRuleProfile.editionOrVersion}) · Jurisdiction:{' '}
              <span className="font-medium text-slate-800">
                {report.activeRuleProfile.jurisdiction}
              </span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Rule Profile / Standard
              </label>
              <select
                value={reviewData.activeProfileId}
                onChange={(e) =>
                  handleProfileChange(e.target.value as AccessibilityRuleProfileId)
                }
                className="w-full text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5"
              >
                <option value="general-screening-configurable">
                  General Screening (Non-Statutory)
                </option>
                <option value="us-ada-2010-standards">
                  U.S. 2010 ADA Standards (DOJ)
                </option>
                <option value="iso-21542-2021-reference">
                  ISO 21542:2021 International Reference
                </option>
                <option value="custom-project-profile">
                  Custom Project Thresholds
                </option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Building Occupancy / Use
              </label>
              <select
                value={reviewData.buildingOccupancyType}
                onChange={(e) =>
                  handleOccupancyChange(
                    e.target.value as BuildingOccupancyAccessibilityType
                  )
                }
                className="w-full text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5"
              >
                <option value="residential-private">Private Single-Family Dwelling</option>
                <option value="multi-family-common">Multi-Family / Common Residential</option>
                <option value="public-accommodation">Public Accommodation / Commercial</option>
                <option value="commercial-workplace">Commercial Workplace / Office</option>
                <option value="mixed-use">Mixed-Use Building</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">
                Construction Scope
              </label>
              <select
                value={reviewData.constructionScope}
                onChange={(e) =>
                  handleScopeChange(e.target.value as ConstructionAccessibilityScope)
                }
                className="w-full text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5"
              >
                <option value="new-construction">New Construction</option>
                <option value="alteration">Alteration / Renovation</option>
                <option value="existing-facility">Existing Facility</option>
              </select>
            </div>
          </div>
        </div>

        {/* Active Profile Threshold Summary Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs">
          <div className="p-2 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-[10px] text-slate-500 font-semibold block uppercase">
              Turning Circle
            </span>
            <span className="font-bold text-slate-900 tabular-nums">
              {report.activeRuleProfile.thresholds.turningCircleDiameter} {unitSuffix}
            </span>
          </div>
          <div className="p-2 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-[10px] text-slate-500 font-semibold block uppercase">
              Clear Floor Space
            </span>
            <span className="font-bold text-slate-900 tabular-nums">
              {report.activeRuleProfile.thresholds.clearFloorSpaceWidth} ×{' '}
              {report.activeRuleProfile.thresholds.clearFloorSpaceLength} {unitSuffix}
            </span>
          </div>
          <div className="p-2 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-[10px] text-slate-500 font-semibold block uppercase">
              Min Door Clear Width
            </span>
            <span className="font-bold text-slate-900 tabular-nums">
              {report.activeRuleProfile.thresholds.minDoorClearOpeningWidth} {unitSuffix}
            </span>
          </div>
          <div className="p-2 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-[10px] text-slate-500 font-semibold block uppercase">
              Min Route Width
            </span>
            <span className="font-bold text-slate-900 tabular-nums">
              {report.activeRuleProfile.thresholds.minAccessibleRouteClearWidth} {unitSuffix}
            </span>
          </div>
          <div className="p-2 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-[10px] text-slate-500 font-semibold block uppercase">
              Max Ramp Slope
            </span>
            <span className="font-bold text-slate-900 tabular-nums">
              1:{Math.round(1 / report.activeRuleProfile.thresholds.maxRampSlopeRatio)}
            </span>
          </div>
          <div className="p-2 bg-slate-50 rounded-lg border border-slate-200">
            <span className="text-[10px] text-slate-500 font-semibold block uppercase">
              Reach Height Range
            </span>
            <span className="font-bold text-slate-900 tabular-nums">
              {report.activeRuleProfile.thresholds.minReachHeightMinorUnit}–
              {report.activeRuleProfile.thresholds.maxReachHeightMinorUnit} {minorUnitSuffix}
            </span>
          </div>
        </div>

        {/* Statutory Boundary Disclaimer */}
        <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-lg flex items-start gap-2.5 text-xs text-amber-950">
          <Info className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">
              Compliance & Screening Boundary Notice:
            </p>
            <p className="text-amber-900 leading-relaxed">
              {report.complianceBoundaryDisclaimer} {report.gridResolutionNotice}
            </p>
          </div>
        </div>
      </div>

      {/* Distinct Status Scorecards (Never collapsing Unassessed into Meets) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-emerald-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase text-emerald-700">
              Meets Criterion
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-bold text-emerald-900 tabular-nums mt-1">
            {report.summaryCounts.meetsConfiguredCriterion}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Verified against active profile
          </div>
        </div>

        <div className="bg-white rounded-xl border border-rose-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase text-rose-700">
              Does Not Meet
            </span>
            <ShieldAlert className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-2xl font-bold text-rose-900 tabular-nums mt-1">
            {report.summaryCounts.doesNotMeetConfiguredCriterion}
          </div>
          <div className="text-[11px] text-rose-700 font-medium mt-0.5">
            {report.summaryCounts.mandatoryFailuresCount > 0
              ? `${report.summaryCounts.mandatoryFailuresCount} Mandatory Brief Failure(s)`
              : 'Configured threshold conflicts'}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-amber-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase text-amber-800">
              Warnings / Near Limit
            </span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-bold text-amber-900 tabular-nums mt-1">
            {report.summaryCounts.warning}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            T-turn fallback or unverified leaf margin
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-300 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase text-slate-700">
              Unassessed / Missing Data
            </span>
            <HelpCircle className="w-4 h-4 text-slate-500" />
          </div>
          <div className="text-2xl font-bold text-slate-800 tabular-nums mt-1">
            {report.summaryCounts.unassessed + report.summaryCounts.insufficientData}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {report.summaryCounts.insufficientData} insufficient data ·{' '}
            {report.summaryCounts.unassessed} unmodeled
          </div>
        </div>

        <div className="bg-white rounded-xl border border-purple-200 p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase text-purple-800">
              Human Review Needed
            </span>
            <Info className="w-4 h-4 text-purple-600" />
          </div>
          <div className="text-2xl font-bold text-purple-900 tabular-nums mt-1">
            {report.summaryCounts.requiresHumanReview}
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Specialist / AHJ field check required
          </div>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
        {[
          { id: 'overview-canvas', label: '1. 2D Turning & Clearance Map' },
          {
            id: 'criteria-ledger',
            label: `2. Criteria Ledger (${report.allCriterionResults.length})`,
          },
          { id: 'elements-editor', label: '3. Doors, Ramps, Lifts & Fixtures' },
          {
            id: 'topics-coverage',
            label: `4. Topic Coverage & Unassessed (${report.topicCoverage.length})`,
          },
          {
            id: 'suggestions',
            label: `5. Improvement Suggestions (${report.improvementSuggestions.length})`,
          },
          { id: 'cross-engine', label: '6. P30 / P31 / P32 / P33 Alignment' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeSubTab === tab.id
                ? 'bg-white text-teal-950 shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: 2D Turning & Clearance Map + Room Diagnostics */}
      {activeSubTab === 'overview-canvas' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Interactive 2D SVG Plan with Turning Circles & Clear Floor Overlays */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Floor {selectedFloor} — Wheelchair Turning Circles & Clear Floor Overlays
                </h3>
                <p className="text-xs text-slate-500">
                  Continuous 2D inscribed turning circle ({report.activeRuleProfile.thresholds.turningCircleDiameter}{' '}
                  {unitSuffix} target) and fixture approach clearance envelopes.
                </p>
              </div>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.max(1, project.floors) }, (_, idx) => idx + 1).map(
                  (fl) => (
                    <button
                      key={fl}
                      onClick={() => setSelectedFloor(fl)}
                      className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer ${
                        selectedFloor === fl
                          ? 'bg-teal-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Floor {fl}
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex items-center justify-center overflow-auto">
              <svg
                viewBox={`-2 -2 ${project.plotWidth + 4} ${project.plotLength + 4}`}
                className="w-full max-h-[440px] bg-white rounded border border-slate-200"
              >
                {/* Plot Boundary */}
                <rect
                  x={0}
                  y={0}
                  width={project.plotWidth}
                  height={project.plotLength}
                  fill="#f8fafc"
                  stroke="#94a3b8"
                  strokeWidth={0.25}
                  strokeDasharray="0.8 0.5"
                />

                {/* Rooms on selected floor */}
                {floorRooms.map((room) => {
                  const diag = report.roomDiagnostics.find((d) => d.roomId === room.id);
                  const isFailing =
                    diag?.turningSpaceStatus === 'does-not-meet-configured-criterion';
                  const isWarning = diag?.turningSpaceStatus === 'warning';
                  const roomFill = isFailing
                    ? '#fff1f2'
                    : isWarning
                    ? '#fffbeb'
                    : '#f0fdf4';
                  const roomStroke = isFailing
                    ? '#e11d48'
                    : isWarning
                    ? '#d97706'
                    : '#16a34a';

                  return (
                    <g key={room.id}>
                      <rect
                        x={room.x}
                        y={room.y}
                        width={room.width}
                        height={room.length}
                        fill={roomFill}
                        stroke={roomStroke}
                        strokeWidth={0.22}
                      />
                      <text
                        x={room.x + 0.6}
                        y={room.y + 1.4}
                        fontSize={0.95}
                        fontWeight="bold"
                        fill="#0f172a"
                      >
                        {room.name}
                      </text>
                      <text
                        x={room.x + 0.6}
                        y={room.y + 2.5}
                        fontSize={0.75}
                        fill="#475569"
                      >
                        {room.width}×{room.length} {unitSuffix} · Max Turn:{' '}
                        {diag?.maxClearInscribedCircleDiameter ?? 0} {unitSuffix}
                      </text>
                    </g>
                  );
                })}

                {/* Placed Furniture Footprints on selected floor */}
                {furnitureData.instances
                  .filter((inst) => inst.floorLevel === selectedFloor)
                  .map((inst) => {
                    const foot = getInstanceFootprintRect(inst);
                    return (
                      <g key={inst.instanceId}>
                        <rect
                          x={foot.x}
                          y={foot.y}
                          width={foot.width}
                          height={foot.length}
                          fill="#cbd5e1"
                          stroke="#475569"
                          strokeWidth={0.12}
                        />
                        <text
                          x={foot.x + foot.width / 2}
                          y={foot.y + foot.length / 2 + 0.25}
                          fontSize={0.65}
                          textAnchor="middle"
                          fill="#1e293b"
                        >
                          {inst.name}
                        </text>
                      </g>
                    );
                  })}

                {/* Door Openings & Swing Arcs on selected floor */}
                {furnitureData.knownOpenings
                  .filter((op) => op.floorLevel === selectedFloor)
                  .map((op) => {
                    const room = floorRooms.find((r) => r.id === op.roomId);
                    if (!room) return null;
                    const geom = getKnownOpeningZones(
                      room,
                      op,
                      furnitureData.clearanceThresholds
                    );
                    return (
                      <g key={op.openingId}>
                        <rect
                          x={geom.approachZone.x}
                          y={geom.approachZone.y}
                          width={geom.approachZone.width}
                          height={geom.approachZone.length}
                          fill="rgba(56, 189, 248, 0.14)"
                          stroke="#0284c7"
                          strokeWidth={0.1}
                          strokeDasharray="0.3 0.3"
                        />
                        {geom.swingZone && (
                          <rect
                            x={geom.swingZone.x}
                            y={geom.swingZone.y}
                            width={geom.swingZone.width}
                            height={geom.swingZone.length}
                            fill="rgba(244, 63, 94, 0.16)"
                            stroke="#e11d48"
                            strokeWidth={0.12}
                          />
                        )}
                      </g>
                    );
                  })}

                {/* Inscribed Wheelchair Turning Circles on selected floor */}
                {report.geometricOverlays
                  .filter(
                    (ov) => ov.floorLevel === selectedFloor && ov.kind === 'turning-circle' && ov.circle
                  )
                  .map((ov) => {
                    const c = ov.circle!;
                    const passes = ov.status === 'meets-configured-criterion';
                    return (
                      <g key={ov.overlayId}>
                        <circle
                          cx={c.cx}
                          cy={c.cy}
                          r={c.diameter / 2}
                          fill={
                            passes
                              ? 'rgba(16, 185, 129, 0.18)'
                              : 'rgba(244, 63, 94, 0.20)'
                          }
                          stroke={passes ? '#059669' : '#e11d48'}
                          strokeWidth={0.18}
                          strokeDasharray="0.4 0.3"
                        />
                        <text
                          x={c.cx}
                          y={c.cy + 0.25}
                          fontSize={0.7}
                          fontWeight="bold"
                          textAnchor="middle"
                          fill={passes ? '#065f46' : '#9f1239'}
                        >
                          Ø {ov.measuredDisplay}
                        </text>
                      </g>
                    );
                  })}
              </svg>
            </div>
          </div>

          {/* Right: Room-by-Room Turning & Accessibility Diagnostic Table */}
          <div className="lg:col-span-5 bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Room-by-Room Accessibility Diagnostics
            </h3>
            <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
              {report.roomDiagnostics.map((diag) => {
                const badge = getStatusBadgeConfig(diag.overallRoomStatus);
                return (
                  <div
                    key={diag.roomId}
                    className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900">
                            {diag.roomName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-semibold">
                            Floor {diag.floorLevel}
                          </span>
                          {diag.isMandatoryWheelchairAccessibleInBrief && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-teal-100 text-teal-900 font-bold">
                              P30 Mandatory
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Room Size: {diag.roomWidth} × {diag.roomLength} {unitSuffix}
                        </div>
                      </div>
                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        {badge.label}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div className="p-2 bg-white rounded border border-slate-200">
                        <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                          Turning Circle
                        </span>
                        <span
                          className={`font-bold tabular-nums ${
                            diag.turningSpaceStatus === 'meets-configured-criterion'
                              ? 'text-emerald-700'
                              : 'text-rose-700'
                          }`}
                        >
                          {diag.maxClearInscribedCircleDiameter} /{' '}
                          {diag.requiredTurningCircleDiameter} {unitSuffix}
                        </span>
                      </div>
                      <div className="p-2 bg-white rounded border border-slate-200">
                        <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                          Clear Floor
                        </span>
                        <span className="font-bold text-slate-800 tabular-nums">
                          {diag.clearFloorSpacesPassing}/{diag.clearFloorSpacesEvaluated} Pass
                        </span>
                      </div>
                      <div className="p-2 bg-white rounded border border-slate-200">
                        <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                          Doors
                        </span>
                        <span className="font-bold text-slate-800 tabular-nums">
                          {diag.doorsEvaluated === 0
                            ? '0 Recorded'
                            : `${diag.doorsPassing}/${diag.doorsEvaluated} Pass`}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Full Criteria Ledger */}
      {activeSubTab === 'criteria-ledger' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Complete Accessibility Criteria Evaluation Ledger
              </h3>
              <p className="text-xs text-slate-500">
                Every criterion records its measured value, required threshold, provenance, and explicit status.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  'all',
                  'meets-configured-criterion',
                  'does-not-meet-configured-criterion',
                  'warning',
                  'insufficient-data',
                  'unassessed',
                  'requires-human-review',
                ] as const
              ).map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer ${
                    statusFilter === st
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {st === 'all' ? 'All Criteria' : getStatusBadgeConfig(st).label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredCriteria.map((crit) => {
              const badge = getStatusBadgeConfig(crit.status);
              return (
                <div
                  key={crit.criterionId}
                  className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        {crit.title}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                        {crit.clauseOrRuleReference}
                      </span>
                      {crit.isMandatoryFromBrief && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-teal-100 text-teal-900 border border-teal-200">
                          P30 Mandatory Requirement
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full border self-start ${badge.bg} ${badge.text} ${badge.border}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <p className="text-xs text-slate-700 leading-relaxed">
                    {crit.explanation}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-[11px]">
                    <div className="p-2 bg-white rounded border border-slate-200">
                      <span className="text-slate-400 font-semibold uppercase text-[10px] block">
                        Measured Value
                      </span>
                      <span className="font-bold text-slate-900">
                        {crit.measuredValue !== null
                          ? `${crit.measuredValue} ${crit.unit}`
                          : 'Not Available / Unmodeled'}
                      </span>
                    </div>
                    <div className="p-2 bg-white rounded border border-slate-200">
                      <span className="text-slate-400 font-semibold uppercase text-[10px] block">
                        Required Threshold
                      </span>
                      <span className="font-bold text-slate-900">
                        {crit.requiredValue !== null
                          ? `${crit.requiredValue} ${crit.unit}`
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="p-2 bg-white rounded border border-slate-200">
                      <span className="text-slate-400 font-semibold uppercase text-[10px] block">
                        Input Provenance
                      </span>
                      <span className="font-medium text-slate-700">
                        {crit.inputProvenance.join(', ')}
                      </span>
                    </div>
                  </div>

                  {crit.remediationGuidance && (
                    <div className="p-2.5 bg-teal-50/80 border border-teal-200 rounded-lg text-xs text-teal-950">
                      <span className="font-bold">Remediation Guidance: </span>
                      {crit.remediationGuidance}
                    </div>
                  )}

                  {crit.missingInputsRequired && crit.missingInputsRequired.length > 0 && (
                    <div className="p-2.5 bg-slate-100 border border-slate-300 rounded-lg text-xs text-slate-700">
                      <span className="font-bold">Missing Inputs Required to Assess: </span>
                      {crit.missingInputsRequired.join(' · ')}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: Elements & Metadata Editor */}
      {activeSubTab === 'elements-editor' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Doorway Accessibility Metadata */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center gap-2">
              <DoorOpen className="w-4 h-4 text-teal-700" />
              <h3 className="text-sm font-bold text-slate-900">
                Doorway Clear Width & Threshold Metadata
              </h3>
            </div>
            <p className="text-xs text-slate-600">
              Supplement P33 room openings with verified 90°-open clear width and threshold height.
            </p>
            {furnitureData.knownOpenings.length === 0 ? (
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600">
                No doorway openings recorded yet. Open P33 Furniture & Circulation to place doorways on room walls.
              </div>
            ) : (
              <div className="space-y-2.5 max-h-80 overflow-y-auto">
                {furnitureData.knownOpenings.map((op) => {
                  const room = rooms.find((r) => r.id === op.roomId);
                  const meta = reviewData.elements.doorDetails[op.openingId];
                  return (
                    <div
                      key={op.openingId}
                      className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between font-bold text-slate-800">
                        <span>
                          {room?.name || op.roomId} ({op.wallEdge} wall · {op.swingDirection})
                        </span>
                        <span>
                          Nominal: {op.width} {unitSuffix}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block">
                            Verified Clear Width ({unitSuffix})
                          </label>
                          <input
                            type="number"
                            step="0.05"
                            defaultValue={meta?.clearOpeningWidth ?? ''}
                            placeholder={`e.g. ${report.activeRuleProfile.thresholds.minDoorClearOpeningWidth}`}
                            onBlur={(e) =>
                              handleUpdateDoorClearWidth(
                                op.openingId,
                                e.target.value,
                                String(meta?.thresholdHeightMinorUnit ?? '')
                              )
                            }
                            className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-semibold text-slate-500 block">
                            Threshold Height ({minorUnitSuffix})
                          </label>
                          <input
                            type="number"
                            step="0.1"
                            defaultValue={meta?.thresholdHeightMinorUnit ?? ''}
                            placeholder={`Max ${report.activeRuleProfile.thresholds.maxDoorThresholdHeightMinorUnit}`}
                            onBlur={(e) =>
                              handleUpdateDoorClearWidth(
                                op.openingId,
                                String(meta?.clearOpeningWidth ?? ''),
                                e.target.value
                              )
                            }
                            className="w-full px-2 py-1 bg-white border border-slate-300 rounded text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Vertical Circulation: Ramps, Lifts & Stairs */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Vertical Access: Ramps, Lifts / Elevators & Stairs
            </h3>
            <p className="text-xs text-slate-600">
              Model ramps and passenger lifts/elevators. Note: Stairs never satisfy wheelchair vertical access.
            </p>

            {/* Add Ramp */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs">
              <div className="font-bold text-slate-800">Add Accessible Ramp</div>
              <div className="grid grid-cols-4 gap-2">
                <input
                  type="text"
                  value={newRampName}
                  onChange={(e) => setNewRampName(e.target.value)}
                  placeholder="Ramp Name"
                  className="col-span-2 px-2 py-1 bg-white border border-slate-300 rounded"
                />
                <input
                  type="number"
                  step="0.1"
                  value={newRampRise}
                  onChange={(e) => setNewRampRise(e.target.value)}
                  placeholder={`Rise (${unitSuffix})`}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                />
                <input
                  type="number"
                  step="0.5"
                  value={newRampRun}
                  onChange={(e) => setNewRampRun(e.target.value)}
                  placeholder={`Run (${unitSuffix})`}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500">Width ({unitSuffix}):</span>
                  <input
                    type="number"
                    step="0.1"
                    value={newRampWidth}
                    onChange={(e) => setNewRampWidth(e.target.value)}
                    className="w-20 px-2 py-1 bg-white border border-slate-300 rounded"
                  />
                </div>
                <button
                  onClick={handleAddRamp}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-teal-900 text-white rounded-lg font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Ramp</span>
                </button>
              </div>
            </div>

            {/* Add Lift */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs">
              <div className="font-bold text-slate-800">
                Add Passenger Lift / Elevator (Serves Floors 1–{project.floors})
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={newLiftWidth}
                  onChange={(e) => setNewLiftWidth(e.target.value)}
                  placeholder={`Cab W (${unitSuffix})`}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                />
                <input
                  type="number"
                  step="0.1"
                  value={newLiftDepth}
                  onChange={(e) => setNewLiftDepth(e.target.value)}
                  placeholder={`Cab D (${unitSuffix})`}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                />
                <input
                  type="number"
                  step="0.1"
                  value={newLiftDoorWidth}
                  onChange={(e) => setNewLiftDoorWidth(e.target.value)}
                  placeholder={`Door W (${unitSuffix})`}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                />
              </div>
              <div className="flex items-center justify-between">
                <button
                  onClick={handleAddStair}
                  className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-semibold cursor-pointer"
                >
                  + Record Stairway Only
                </button>
                <button
                  onClick={handleAddLift}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-teal-900 text-white rounded-lg font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Lift / Elevator</span>
                </button>
              </div>
            </div>

            {/* List Modeled Ramps & Lifts */}
            <div className="space-y-1.5 text-xs">
              {reviewData.elements.ramps.map((r) => (
                <div
                  key={r.rampId}
                  className="flex items-center justify-between p-2 bg-white border border-slate-200 rounded"
                >
                  <span>
                    <strong>{r.name}</strong> · Rise {r.verticalRise} {unitSuffix} / Run{' '}
                    {r.runLength} {unitSuffix} · Width {r.clearWidth} {unitSuffix}
                  </span>
                  <button
                    onClick={() => handleDeleteRamp(r.rampId)}
                    className="text-rose-600 hover:text-rose-800 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {reviewData.elements.verticalLifts.map((l) => (
                <div
                  key={l.liftId}
                  className="flex items-center justify-between p-2 bg-white border border-slate-200 rounded"
                >
                  <span>
                    <strong>{l.name}</strong> · Cab {l.cabClearWidth}×{l.cabClearDepth}{' '}
                    {unitSuffix} · Floors {l.servedFloors.join(',')}
                  </span>
                  <button
                    onClick={() => handleDeleteLift(l.liftId)}
                    className="text-rose-600 hover:text-rose-800 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Sanitary & Kitchen Fixtures + Operable Controls + Sensory */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Sanitary / Kitchen Fixture Attributes & Operable Controls
            </h3>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs">
              <div className="font-bold text-slate-800">
                Record Sanitary or Kitchen Fixture Accessibility Metadata
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newFixtureRoomId}
                  onChange={(e) => setNewFixtureRoomId(e.target.value)}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} (Floor {r.floorLevel})
                    </option>
                  ))}
                </select>
                <select
                  value={newFixtureType}
                  onChange={(e) => setNewFixtureType(e.target.value as any)}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                >
                  <option value="wc-toilet">WC / Water Closet</option>
                  <option value="lavatory-sink">Lavatory Sink</option>
                  <option value="roll-in-shower">Roll-In Shower</option>
                  <option value="kitchen-sink">Kitchen Sink</option>
                  <option value="work-surface">Kitchen Work Surface</option>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={newFixtureGrabBars}
                    onChange={(e) => setNewFixtureGrabBars(e.target.checked)}
                  />
                  <span>Grab Bars</span>
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={newFixtureTransfer}
                    onChange={(e) => setNewFixtureTransfer(e.target.checked)}
                  />
                  <span>Transfer Space</span>
                </label>
                <label className="inline-flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={newFixtureKnee}
                    onChange={(e) => setNewFixtureKnee(e.target.checked)}
                  />
                  <span>Knee/Toe Clearance</span>
                </label>
                <button
                  onClick={handleAddFixtureDetail}
                  className="ml-auto px-3 py-1 bg-teal-900 text-white rounded-lg font-semibold cursor-pointer"
                >
                  + Add Fixture Record
                </button>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2 text-xs">
              <div className="font-bold text-slate-800">
                Record Operable Control Height ({minorUnitSuffix} AFF)
              </div>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={newControlRoomId}
                  onChange={(e) => setNewControlRoomId(e.target.value)}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select
                  value={newControlType}
                  onChange={(e) => setNewControlType(e.target.value as any)}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                >
                  <option value="light-switch">Light Switch</option>
                  <option value="thermostat">Thermostat</option>
                  <option value="power-outlet">Power Outlet</option>
                  <option value="emergency-pull-cord">Emergency Pull Cord</option>
                </select>
                <input
                  type="number"
                  value={newControlHeight}
                  onChange={(e) => setNewControlHeight(e.target.value)}
                  placeholder={`Height (${minorUnitSuffix})`}
                  className="px-2 py-1 bg-white border border-slate-300 rounded"
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleAddControlDetail}
                  className="px-3 py-1 bg-teal-900 text-white rounded-lg font-semibold cursor-pointer"
                >
                  + Add Operable Control
                </button>
              </div>
            </div>
          </div>

          {/* Wayfinding & Emergency Notification Provisions */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Wayfinding, Tactile Signage & Visual/Audible Alarms
            </h3>
            <p className="text-xs text-slate-600">
              Until explicitly recorded, sensory and wayfinding dimensions remain marked as Unassessed / Requires Human Review.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() =>
                  handleAddSensoryProvision(
                    'tactile-braille-signage',
                    'Raised tactile characters & Grade 2 Braille signage at permanent rooms'
                  )
                }
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold cursor-pointer"
              >
                + Record Tactile/Braille Signage
              </button>
              <button
                onClick={() =>
                  handleAddSensoryProvision(
                    'visual-audible-alarm',
                    'Synchronized visual strobe & audible fire notification appliances'
                  )
                }
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold cursor-pointer"
              >
                + Record Visual/Audible Alarms
              </button>
            </div>
            <div className="space-y-1.5 text-xs">
              {reviewData.elements.sensoryAndWayfinding.map((s) => (
                <div
                  key={s.elementId}
                  className="p-2 bg-emerald-50 border border-emerald-200 rounded text-emerald-900 font-medium"
                >
                  ✓ {s.description} ({s.category})
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: Multi-Dimensional Topic Coverage & Unassessed Inventory */}
      {activeSubTab === 'topics-coverage' && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Multi-Dimensional Accessibility Coverage & Unassessed Topics Inventory
            </h3>
            <p className="text-xs text-slate-600">
              Universal accessibility spans mobility, vertical access, fixtures, reach controls, wayfinding, and sensory communication. Topics lacking project data are explicitly reported as Unassessed rather than assumed compliant.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {report.topicCoverage.map((topic) => (
              <div
                key={topic.topicId}
                className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      {topic.topicTitle}
                    </h4>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      {topic.description}
                    </p>
                  </div>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border shrink-0 ${
                      topic.coverageState === 'evaluated'
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                        : topic.coverageState === 'partially-evaluated'
                        ? 'bg-amber-50 text-amber-900 border-amber-200'
                        : 'bg-slate-200 text-slate-700 border-slate-300'
                    }`}
                  >
                    {topic.coverageState.replace(/-/g, ' ')}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1.5 text-[11px] text-center">
                  <div className="p-1.5 bg-white rounded border border-slate-200">
                    <span className="text-[9px] text-emerald-700 font-bold uppercase block">
                      Meets
                    </span>
                    <span className="font-bold text-emerald-900">{topic.meetsCount}</span>
                  </div>
                  <div className="p-1.5 bg-white rounded border border-slate-200">
                    <span className="text-[9px] text-rose-700 font-bold uppercase block">
                      Fails
                    </span>
                    <span className="font-bold text-rose-900">{topic.failsCount}</span>
                  </div>
                  <div className="p-1.5 bg-white rounded border border-slate-200">
                    <span className="text-[9px] text-amber-700 font-bold uppercase block">
                      Warn
                    </span>
                    <span className="font-bold text-amber-900">{topic.warningCount}</span>
                  </div>
                  <div className="p-1.5 bg-white rounded border border-slate-200">
                    <span className="text-[9px] text-slate-600 font-bold uppercase block">
                      Unassessed
                    </span>
                    <span className="font-bold text-slate-800">
                      {topic.unassessedOrInsufficientCount + topic.requiresHumanReviewCount}
                    </span>
                  </div>
                </div>

                <div className="space-y-1 text-[11px]">
                  <div className="font-semibold text-teal-900">Evaluated by P34:</div>
                  <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                    {topic.whatIsEvaluated.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                  <div className="font-semibold text-amber-900 pt-1">
                    Remains Unassessed / Requires Specialist Review:
                  </div>
                  <ul className="list-disc list-inside text-slate-600 space-y-0.5">
                    {topic.whatRemainsUnassessed.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 5: Explainable Improvement Suggestions & Non-Destructive Preview */}
      {activeSubTab === 'suggestions' && (
        <div className="space-y-4">
          {activePreview && (
            <div className="bg-teal-950 text-white rounded-xl p-5 shadow-md space-y-3 border border-teal-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-teal-300" />
                  <h4 className="text-sm font-bold">
                    Non-Destructive Preview: {activePreview.suggestionTitle}
                  </h4>
                </div>
                <button
                  onClick={() => setActivePreview(null)}
                  className="text-xs text-teal-200 hover:text-white cursor-pointer"
                >
                  Close Preview
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-2.5 bg-teal-900/70 rounded-lg border border-teal-700">
                  <span className="text-teal-300 block text-[10px] uppercase font-bold">
                    Failures Before → After
                  </span>
                  <span className="text-base font-bold">
                    {activePreview.beforeSummary.failsCount} →{' '}
                    {activePreview.afterSummary.failsCount}
                  </span>
                </div>
                <div className="p-2.5 bg-teal-900/70 rounded-lg border border-teal-700">
                  <span className="text-teal-300 block text-[10px] uppercase font-bold">
                    Meets Before → After
                  </span>
                  <span className="text-base font-bold">
                    {activePreview.beforeSummary.meetsCount} →{' '}
                    {activePreview.afterSummary.meetsCount}
                  </span>
                </div>
                <div className="p-2.5 bg-teal-900/70 rounded-lg border border-teal-700">
                  <span className="text-teal-300 block text-[10px] uppercase font-bold">
                    Resolved Criteria
                  </span>
                  <span className="text-base font-bold text-emerald-300">
                    +{activePreview.resolvedCriterionIds.length}
                  </span>
                </div>
                <div className="p-2.5 bg-teal-900/70 rounded-lg border border-teal-700">
                  <span className="text-teal-300 block text-[10px] uppercase font-bold">
                    New Failures Introduced
                  </span>
                  <span className="text-base font-bold">
                    {activePreview.newlyIntroducedFailureIds.length}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-teal-200">
                  {activePreview.previewNotes.join(' ')}
                </span>
                {activePreview.isSafeToApply && (
                  <button
                    onClick={() => handleApplySuggestion(activePreview.suggestionId)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Confirm & Apply with Checkpoint</span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900">
              Explainable Accessibility Improvement Suggestions
            </h3>
            {report.improvementSuggestions.length === 0 ? (
              <div className="p-6 text-center bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
                No automated layout or doorway remediation suggestions are currently triggered. Check the Criteria Ledger for any unassessed or human-review items.
              </div>
            ) : (
              <div className="space-y-3">
                {report.improvementSuggestions.map((sug) => (
                  <div
                    key={sug.suggestionId}
                    className="p-4 rounded-xl border border-slate-200 bg-slate-50/70 space-y-2.5"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-bold text-slate-900">
                          {sug.title}
                        </span>
                        <span className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-200 text-slate-700">
                          {sug.actionType}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {sug.canAutoPreviewAndApply ? (
                          <>
                            <button
                              onClick={() => handlePreviewSuggestion(sug.suggestionId)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 rounded-lg cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Preview Impact</span>
                            </button>
                            <button
                              onClick={() => handleApplySuggestion(sug.suggestionId)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                            >
                              <Play className="w-3.5 h-3.5 text-teal-400" />
                              <span>Apply Safely</span>
                            </button>
                          </>
                        ) : (
                          onOpenFloorPlan && (
                            <button
                              onClick={() => onOpenFloorPlan(project)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-300 rounded-lg cursor-pointer"
                            >
                              <PenTool className="w-3.5 h-3.5" />
                              <span>Resize in 2D Plan Editor</span>
                            </button>
                          )
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-700">{sug.rationale}</p>
                    <p className="text-xs font-medium text-emerald-800">
                      Expected Improvement: {sug.expectedAccessibilityImprovement}
                    </p>
                    <div className="text-[11px] text-slate-500">
                      <strong>Trade-offs:</strong> {sug.tradeOffsAndDownstreamImpact.join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 6: P30 / P31 / P32 / P33 Cross-Engine Alignment */}
      {activeSubTab === 'cross-engine' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                P30 Brief & P32 Personalization Alignment
              </h3>
              {onOpenBrief && (
                <button
                  onClick={() => onOpenBrief(project)}
                  className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                >
                  Open P30 Brief →
                </button>
              )}
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5">
              <div>
                <strong>Mandatory Brief Accessibility Flag:</strong>{' '}
                {report.p30P32Alignment.hasMandatoryBriefAccessibilityFlag
                  ? 'YES (Mandatory across space program)'
                  : 'No global mandatory flag set'}
              </div>
              <div>
                <strong>Spaces Requiring Wheelchair Access:</strong>{' '}
                {report.p30P32Alignment.briefSpacesRequiringWheelchairAccess.length}
              </div>
              <div>
                <strong>Confirmed P30 Accessibility Requirements:</strong>{' '}
                {report.p30P32Alignment.confirmedInterpretedAccessibilityRequirements.length}
              </div>
              <div>
                <strong>Unconfirmed P30 Accessibility Assumptions:</strong>{' '}
                {report.p30P32Alignment.unconfirmedAccessibilityAssumptions.length} (kept distinct from confirmed constraints)
              </div>
            </div>

            <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-lg text-xs text-emerald-950">
              <div className="font-bold">P32 Personalization Guardrail Verified:</div>
              <p className="mt-0.5">
                {report.p30P32Alignment.p32SoftPreferenceGuardrailCheck.guardrailExplanation}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                P31 Multi-Option Comparison Export Summary
              </h3>
              {onOpenDesignComparison && (
                <button
                  onClick={() => onOpenDesignComparison(project)}
                  className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                >
                  Open P31 Comparison →
                </button>
              )}
            </div>
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5">
              <div>
                <strong>Comparison Status Badge:</strong>{' '}
                <span className="font-bold text-teal-900">
                  {p31ComparisonSummary.overallStatusBadge}
                </span>
              </div>
              <div>
                <strong>Rooms Passing Turning Circle:</strong>{' '}
                {p31ComparisonSummary.roomsWithTurningCircleCount} /{' '}
                {p31ComparisonSummary.totalRoomsEvaluated}
              </div>
              <div>
                <strong>Criteria Summary:</strong> {p31ComparisonSummary.meetsCount} Meets ·{' '}
                {p31ComparisonSummary.failsCount} Fails ·{' '}
                {p31ComparisonSummary.unassessedOrInsufficientCount} Unassessed/Insufficient
              </div>
              <div className="pt-1 text-slate-600">
                <strong>Comparison Caveats:</strong>
                <ul className="list-disc list-inside mt-0.5">
                  {p31ComparisonSummary.caveats.map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
