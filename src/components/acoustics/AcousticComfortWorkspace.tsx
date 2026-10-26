import React, { useState, useMemo, useEffect } from 'react';
import {
  Volume2,
  CheckCircle2,
  AlertTriangle,
  Info,
  Eye,
  RotateCcw,
  RefreshCw,
  Plus,
  Trash2,
  Sparkles,
  Lock
} from 'lucide-react';
import { Project } from '../../types/project';
import {
  AcousticConfidenceState,
  AcousticEvaluationStatus,
  AcousticEvidenceProvenance,
  AcousticPriorityTag,
  AcousticProposalPreviewDiff,
  FunctionalRoomUseProfileId,
  NoiseObservationEntry,
  NoiseSourceCategory,
  OCTAVE_BANDS_HZ,
  OctaveBandCoefficients,
  RoomAcousticConfig
} from '../../types/acousticComfort';
import {
  applyAcousticProposalSafely,
  createDefaultRoomAcousticConfig,
  evaluateProjectAcousticComfort,
  getAllAcousticAssemblies,
  getAllAcousticSurfaceMaterials,
  getFunctionalProfileLabel,
  initializeProjectAcousticPlannerData,
  previewAcousticProposal,
  rollbackAcousticPlannerChanges,
  saveProjectAcousticPlannerSafely,
  validateAndNormalizeCustomAcousticMaterial,
  validateNoiseObservationInput
} from '../../services/acousticComfortService';

interface AcousticComfortWorkspaceProps {
  project: Project;
  onUpdateProject: (updatedProject: Project) => void;
  onNavigateTab?: (tab: string) => void;
}

const STATUS_BADGE_CONFIG: Record<
  AcousticEvaluationStatus,
  { label: string; bg: string; text: string; border: string }
> = {
  'estimated-within-target': {
    label: 'Estimated Within Target',
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    border: 'border-emerald-500/30'
  },
  'measured-within-target': {
    label: 'Measured Within Target',
    bg: 'bg-teal-500/15',
    text: 'text-teal-300',
    border: 'border-teal-500/30'
  },
  'needs-review': {
    label: 'Needs Review',
    bg: 'bg-amber-500/10',
    text: 'text-amber-300',
    border: 'border-amber-500/30'
  },
  'concern-identified': {
    label: 'Concern Identified',
    bg: 'bg-rose-500/10',
    text: 'text-rose-300',
    border: 'border-rose-500/30'
  },
  'insufficient-evidence': {
    label: 'Insufficient Evidence',
    bg: 'bg-slate-500/15',
    text: 'text-slate-300',
    border: 'border-slate-500/30'
  },
  'unconfigured': {
    label: 'Unconfigured (2D Only)',
    bg: 'bg-slate-800/70',
    text: 'text-slate-400',
    border: 'border-slate-700'
  }
};

const CONFIDENCE_LABELS: Record<AcousticConfidenceState, { label: string; color: string }> = {
  'verified-measurement-or-test-evidence': {
    label: 'Verified Measurement / Lab Test Evidence',
    color: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
  },
  'sufficient-for-preliminary-calculation': {
    label: 'Sufficient for Preliminary Calculation',
    color: 'text-sky-300 border-sky-500/30 bg-sky-500/10'
  },
  'incomplete-evidence-requires-caution': {
    label: 'Incomplete Evidence — Requires Caution',
    color: 'text-amber-300 border-amber-500/30 bg-amber-500/10'
  },
  'insufficient-evidence': {
    label: 'Insufficient Evidence',
    color: 'text-slate-300 border-slate-600 bg-slate-800/60'
  }
};

const PROVENANCE_LABELS: Record<AcousticEvidenceProvenance, { label: string; color: string }> = {
  'measured-on-site': {
    label: 'Measured On-Site',
    color: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
  },
  'manufacturer-or-lab-test': {
    label: 'Lab Test (ISO 354 / ISO 10140)',
    color: 'text-teal-300 border-teal-500/30 bg-teal-500/10'
  },
  'traceable-generic-reference': {
    label: 'Traceable Reference (ASHRAE Ch. 8)',
    color: 'text-sky-300 border-sky-500/30 bg-sky-500/10'
  },
  'user-entered': {
    label: 'User-Entered Input',
    color: 'text-indigo-300 border-indigo-500/30 bg-indigo-500/10'
  },
  'illustrative-assumption': {
    label: 'Illustrative Assumption',
    color: 'text-amber-300 border-amber-500/30 bg-amber-500/10'
  },
  'unavailable-or-unverified': {
    label: 'Unavailable / Unverified',
    color: 'text-slate-400 border-slate-600 bg-slate-800/60'
  }
};

const PROFILE_IDS: FunctionalRoomUseProfileId[] = [
  'bedroom-residential',
  'living-residential',
  'home-office-focused',
  'meeting-room',
  'classroom-learning',
  'healthcare-consultation',
  'restaurant-communal-dining',
  'reception-circulation',
  'music-performance',
  'service-utility-wet'
];

const PRIORITY_OPTIONS: Array<{ id: AcousticPriorityTag; label: string; desc: string }> = [
  { id: 'speech-clarity', label: 'Speech Clarity', desc: 'Controlled mid-high RT60 for intelligible dialogue' },
  { id: 'sleep-and-quiet-rest', label: 'Sleep & Quiet Rest', desc: 'Low ambient noise & intrusion prevention' },
  { id: 'confidential-speech-privacy', label: 'Speech Privacy', desc: 'High partition Rw/STC & sealed doors' },
  { id: 'focused-concentration', label: 'Focused Work', desc: 'Low distraction & controlled reverberation' },
  { id: 'lively-musical-warmth', label: 'Musical Warmth', desc: 'Longer reverberant sustain (0.6–1.1 s)' },
  { id: 'reverberation-control', label: 'Echo & Glare Control', desc: 'Suppress flutter echo between hard walls' },
  { id: 'impact-footfall-control', label: 'Footfall Isolation', desc: 'Mitigate structure-borne floor impact' },
  { id: 'hvac-plant-quietness', label: 'HVAC Quietness', desc: 'Control mechanical plant & duct noise' }
];

export const AcousticComfortWorkspace: React.FC<AcousticComfortWorkspaceProps> = ({
  project,
  onUpdateProject
}) => {
  const plannerData = useMemo(() => initializeProjectAcousticPlannerData(project), [project]);
  const evaluation = useMemo(
    () => evaluateProjectAcousticComfort(project, plannerData),
    [project, plannerData]
  );
  const availableMaterials = useMemo(
    () => getAllAcousticSurfaceMaterials(project, plannerData),
    [project, plannerData]
  );
  const availableAssemblies = useMemo(
    () => getAllAcousticAssemblies(project, plannerData),
    [project, plannerData]
  );

  const rooms = project.floorPlan?.rooms || [];
  const [selectedRoomId, setSelectedRoomId] = useState<string>(
    plannerData.selectedRoomId || rooms[0]?.id || ''
  );
  const [activeDomainTab, setActiveDomainTab] = useState<
    | 'domain-a'
    | 'domain-b'
    | 'domain-c'
    | 'domain-d'
    | 'domain-e'
    | 'domain-f'
    | 'domain-g'
    | 'domain-h'
    | 'comparison'
  >('domain-a');
  const [activePreview, setActivePreview] = useState<AcousticProposalPreviewDiff | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  // Noise observation form state
  const [noiseCategory, setNoiseCategory] = useState<NoiseSourceCategory>('road-traffic');
  const [noiseDescription, setNoiseDescription] = useState<string>('');
  const [noiseKind, setNoiseKind] = useState<NoiseObservationEntry['observationKind']>(
    'subjective-qualitative-observation'
  );
  const [noiseDbaInput, setNoiseDbaInput] = useState<string>('38');
  const [noiseLocation, setNoiseLocation] = useState<NoiseObservationEntry['measurementLocation']>(
    'indoor-receiver-room'
  );
  const [noiseSeverity, setNoiseSeverity] = useState<NoiseObservationEntry['qualitativeSeverity']>(
    'moderate-noticeable'
  );

  // Custom Material Form State
  const [customMatName, setCustomMatName] = useState<string>('');
  const [customMatSurface, setCustomMatSurface] = useState<'wall' | 'ceiling' | 'floor'>('wall');
  const [customAlpha500, setCustomAlpha500] = useState<string>('0.60');
  const [customAlpha1000, setCustomAlpha1000] = useState<string>('0.70');

  useEffect(() => {
    if (rooms.length > 0 && !rooms.some((r) => r.id === selectedRoomId)) {
      setSelectedRoomId(rooms[0].id);
    }
  }, [rooms, selectedRoomId]);

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) || rooms[0],
    [rooms, selectedRoomId]
  );

  const selectedRoomConfig: RoomAcousticConfig | undefined = useMemo(() => {
    if (!activeRoom) return undefined;
    return (
      plannerData.roomConfigs[activeRoom.id] ||
      createDefaultRoomAcousticConfig(project, activeRoom)
    );
  }, [plannerData.roomConfigs, activeRoom, project]);

  const selectedRoomReport = useMemo(() => {
    if (!activeRoom) return null;
    return (
      evaluation.allRoomReports.find((r) => r.roomId === activeRoom.id) ||
      evaluation.activeRoomReport
    );
  }, [evaluation, activeRoom]);

  const commitPlannerUpdate = (
    nextData: typeof plannerData,
    bannerMsg?: string,
    createCheckpoint = false
  ) => {
    const saved = saveProjectAcousticPlannerSafely(project, nextData, createCheckpoint);
    onUpdateProject(saved.updatedProject);
    if (bannerMsg) {
      setStatusBanner(bannerMsg);
      setTimeout(() => setStatusBanner(null), 4500);
    }
  };

  const updateRoomConfig = (
    roomId: string,
    updater: (cfg: RoomAcousticConfig) => RoomAcousticConfig,
    msg?: string
  ) => {
    const targetRoom = rooms.find((r) => r.id === roomId);
    if (!targetRoom) return;
    const baseCfg =
      plannerData.roomConfigs[roomId] || createDefaultRoomAcousticConfig(project, targetRoom);
    const updatedCfg = {
      ...updater(baseCfg),
      roomId,
      updatedAt: new Date().toISOString()
    };
    commitPlannerUpdate(
      {
        ...plannerData,
        isConfigured: true,
        selectedRoomId: roomId,
        roomConfigs: {
          ...plannerData.roomConfigs,
          [roomId]: updatedCfg
        }
      },
      msg
    );
  };

  const handleSetAllCeilingHeights = (heightInProjectUnit: number) => {
    const nextConfigs = { ...plannerData.roomConfigs };
    for (const rm of rooms) {
      const base = nextConfigs[rm.id] || createDefaultRoomAcousticConfig(project, rm);
      nextConfigs[rm.id] = {
        ...base,
        ceilingHeight: heightInProjectUnit,
        heightUnit: project.unit,
        ceilingHeightProvenance: 'user-entered',
        updatedAt: new Date().toISOString()
      };
    }
    commitPlannerUpdate(
      {
        ...plannerData,
        isConfigured: true,
        roomConfigs: nextConfigs
      },
      `Confirmed ceiling height (${heightInProjectUnit} ${project.unit}) across all ${rooms.length} rooms.`,
      true
    );
  };

  const handleTogglePriority = (roomId: string, tag: AcousticPriorityTag) => {
    updateRoomConfig(roomId, (cfg) => {
      const exists = cfg.acousticPriorities.includes(tag);
      const next = exists
        ? cfg.acousticPriorities.filter((t) => t !== tag)
        : [...cfg.acousticPriorities, tag];
      return {
        ...cfg,
        acousticPriorities: next.length > 0 ? next : ['speech-clarity']
      };
    });
  };

  const handleAddNoiseObservation = (roomId: string) => {
    const parsedDb =
      noiseKind === 'measured-sound-level' || noiseKind === 'illustrative-scenario'
        ? Number(noiseDbaInput)
        : null;
    const validation = validateNoiseObservationInput({
      roomId,
      sourceCategory: noiseCategory,
      sourceDescription:
        noiseDescription.trim() || `${noiseCategory.replace(/-/g, ' ')} observation`,
      observationKind: noiseKind,
      soundLevelDb: parsedDb !== null && Number.isFinite(parsedDb) ? parsedDb : null,
      metricAndUnit: parsedDb !== null ? 'LAeq (dBA)' : 'qualitative-only',
      measurementLocation: noiseLocation,
      qualitativeSeverity: noiseSeverity,
      timePeriod: 'daytime',
      provenance: 'user-entered'
    });

    if (!validation.isValid || !validation.normalizedObservation) {
      setStatusBanner(`Validation Error: ${validation.errors.join(' ')}`);
      return;
    }

    commitPlannerUpdate(
      {
        ...plannerData,
        isConfigured: true,
        noiseObservations: [
          ...plannerData.noiseObservations,
          validation.normalizedObservation
        ]
      },
      'Added background noise observation.'
    );
    setNoiseDescription('');
  };

  const handleRemoveNoiseObservation = (observationId: string) => {
    commitPlannerUpdate(
      {
        ...plannerData,
        noiseObservations: plannerData.noiseObservations.filter(
          (o) => o.observationId !== observationId
        )
      },
      'Removed background noise observation.'
    );
  };

  const handleAddCustomMaterial = () => {
    if (!customMatName.trim()) {
      setStatusBanner('Enter a display name for the custom acoustic material.');
      return;
    }
    const a500 = Number(customAlpha500);
    const a1000 = Number(customAlpha1000);
    const val = validateAndNormalizeCustomAcousticMaterial(
      {
        acousticMaterialId: `custom-mat-${Date.now()}`,
        displayName: customMatName.trim(),
        targetSurfaceTypes: [customMatSurface],
        octaveBandAbsorption: {
          125: 0.2,
          250: 0.4,
          500: Number.isFinite(a500) ? a500 : 0.6,
          1000: Number.isFinite(a1000) ? a1000 : 0.7,
          2000: Number.isFinite(a1000) ? a1000 : 0.7,
          4000: 0.65
        },
        provenance: 'user-entered'
      },
      availableMaterials
    );

    if (!val.isValid || !val.normalizedMaterial) {
      setStatusBanner(`Material Validation Error: ${val.errors.join(' ')}`);
      return;
    }

    commitPlannerUpdate(
      {
        ...plannerData,
        isConfigured: true,
        customAcousticMaterials: [
          ...plannerData.customAcousticMaterials,
          val.normalizedMaterial
        ]
      },
      `Registered user-entered acoustic material "${val.normalizedMaterial.displayName}".`
    );
    setCustomMatName('');
  };

  const handlePreviewRecommendation = (recommendationId: string, roomId: string) => {
    const diff = previewAcousticProposal(project, recommendationId, roomId);
    setActivePreview(diff);
  };

  const handleApplyRecommendation = (previewDiff: AcousticProposalPreviewDiff) => {
    try {
      const res = applyAcousticProposalSafely(project, previewDiff);
      onUpdateProject(res.updatedProject);
      setActivePreview(null);
      setStatusBanner(
        `Applied "${previewDiff.title}" atomically (Snapshot checkpoint: ${res.snapshotId}).`
      );
    } catch (err: any) {
      setStatusBanner(`Apply Blocked: ${err?.message || 'Unknown error'}`);
    }
  };

  const handleRollback = () => {
    try {
      const restored = rollbackAcousticPlannerChanges(project);
      onUpdateProject(restored);
      setActivePreview(null);
      setStatusBanner('Restored project to pre-apply P36 acoustic snapshot.');
    } catch (err: any) {
      setStatusBanner(`Rollback Error: ${err?.message || 'No snapshot available'}`);
    }
  };

  const roomsWithVolumeCount = evaluation.allRoomReports.filter(
    (r) => r.geometry.roomVolumeM3 !== null
  ).length;
  const roomsWithinTargetCount = evaluation.allRoomReports.filter(
    (r) =>
      r.overallStatus === 'estimated-within-target' ||
      r.overallStatus === 'measured-within-target'
  ).length;
  const roomsWithConcernCount = evaluation.allRoomReports.filter(
    (r) => r.overallStatus === 'concern-identified'
  ).length;
  const totalRecommendationsCount = evaluation.allRoomReports.reduce(
    (sum, r) => sum + r.domainH_Recommendations.length,
    0
  );

  if (rooms.length === 0) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center">
          <Volume2 className="w-12 h-12 text-indigo-400 mx-auto mb-3" />
          <h2 className="text-xl font-bold text-white mb-2">P36 — Acoustic Comfort Planner</h2>
          <p className="text-sm text-slate-400">
            No floor plan rooms are currently defined in this project. Create or generate a floor plan first to evaluate room reverberation, sound insulation, and acoustic zoning.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-slate-900/90 border border-slate-800 rounded-xl p-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-9 h-9 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Volume2 className="w-5 h-5" />
            </div>
            <span className="text-xs font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
              P36 • Acoustic Comfort Planner
            </span>
            {selectedRoomReport && (
              <span
                className={`text-xs font-medium px-2.5 py-0.5 rounded border ${
                  STATUS_BADGE_CONFIG[selectedRoomReport.overallStatus].bg
                } ${STATUS_BADGE_CONFIG[selectedRoomReport.overallStatus].text} ${
                  STATUS_BADGE_CONFIG[selectedRoomReport.overallStatus].border
                }`}
              >
                {STATUS_BADGE_CONFIG[selectedRoomReport.overallStatus].label}
              </span>
            )}
            <span className="text-xs font-mono text-slate-400">
              Engine: {evaluation.calculationModelVersion}
            </span>
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            Architectural Acoustics — Sabine Reverberation, Privacy Screening & Spatial Zoning
          </h1>
          <p className="text-xs text-slate-400 max-w-3xl">
            {evaluation.professionalDisclaimer}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={() =>
              commitPlannerUpdate(plannerData, 'Synchronized P36 acoustic evaluation.')
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 border border-slate-700 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Re-Evaluate
          </button>

          {plannerData.lastPreApplySnapshotId && (
            <button
              onClick={handleRollback}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-xs font-medium text-amber-300 border border-amber-500/30 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Rollback Last Apply
            </button>
          )}
        </div>
      </div>

      {/* Stale Banner */}
      {evaluation.isStale && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-xs text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Stale Acoustic Fingerprint Detected:</strong>{' '}
              {evaluation.staleReasons.join(' ')}
            </span>
          </div>
          <button
            onClick={() =>
              commitPlannerUpdate(plannerData, 'Updated P36 acoustic fingerprint.')
            }
            className="px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-medium border border-amber-500/40"
          >
            Sync Now
          </button>
        </div>
      )}

      {statusBanner && (
        <div className="bg-indigo-500/15 border border-indigo-500/40 rounded-xl p-3.5 flex items-center justify-between text-xs text-indigo-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
            <span>{statusBanner}</span>
          </div>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-slate-400 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Evaluated Rooms
          </div>
          <div className="text-2xl font-bold font-mono text-white mt-1">
            {evaluation.allRoomReports.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {roomsWithinTargetCount} within target • {roomsWithConcernCount} concern(s)
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            3D Volume Readiness
          </div>
          <div className="text-2xl font-bold font-mono text-sky-400 mt-1">
            {roomsWithVolumeCount}/{evaluation.allRoomReports.length}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {roomsWithVolumeCount < evaluation.allRoomReports.length
              ? `${evaluation.allRoomReports.length - roomsWithVolumeCount} awaiting ceiling height`
              : 'All room volumes verified'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Selected Room Mid RT60
          </div>
          <div className="text-2xl font-bold font-mono text-indigo-300 mt-1">
            {selectedRoomReport?.domainA_Reverberation.midFrequencyEstimatedRt60Seconds !==
              null &&
            selectedRoomReport?.domainA_Reverberation.midFrequencyEstimatedRt60Seconds !==
              undefined
              ? `${selectedRoomReport.domainA_Reverberation.midFrequencyEstimatedRt60Seconds.toFixed(
                  2
                )} s`
              : '2D Only'}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Target:{' '}
            {selectedRoomReport?.domainA_Reverberation.activeCriterion.minTarget ?? 0}–
            {selectedRoomReport?.domainA_Reverberation.activeCriterion.maxTarget ?? 0.6} s
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Evidence Coverage
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">
            {selectedRoomReport?.evidenceCoveragePercent ?? 0}%
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {selectedRoomReport
              ? CONFIDENCE_LABELS[selectedRoomReport.overallConfidenceState].label
              : '—'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5">
          <div className="text-[11px] uppercase tracking-wider text-slate-400">
            Domain H Proposals
          </div>
          <div className="text-2xl font-bold font-mono text-amber-300 mt-1">
            {totalRecommendationsCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            Previewable & rollback-safe
          </div>
        </div>
      </div>

      {/* Quick Ceiling Height Callout when 2D rooms lack ceiling height */}
      {roomsWithVolumeCount < evaluation.allRoomReports.length && (
        <div className="bg-sky-500/10 border border-sky-500/30 rounded-xl p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
              <Info className="w-4 h-4 shrink-0" />
              <span>
                2D Floor Plan Geometry Detected — Ceiling Height Required for Quantitative Sabine RT60
              </span>
            </div>
            <p className="text-xs text-slate-300">
              Plotify 2D room rectangles define width and length, but Sabine reverberation (RT60 ≈ 0.161 × V / A) requires verified 3D room volume V (m³). Confirm a ceiling height below or per room:
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() =>
                handleSetAllCeilingHeights(project.unit === 'feet' ? 9.0 : 2.7)
              }
              className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium transition-colors"
            >
              Confirm {project.unit === 'feet' ? '9.0 ft' : '2.70 m'} All Rooms
            </button>
            <button
              onClick={() =>
                handleSetAllCeilingHeights(project.unit === 'feet' ? 10.0 : 3.0)
              }
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
            >
              Confirm {project.unit === 'feet' ? '10.0 ft' : '3.00 m'} All Rooms
            </button>
          </div>
        </div>
      )}

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Room Selector & Configuration */}
        <div className="lg:col-span-4 space-y-5">
          {/* Room Selector */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                1. Select Room ({evaluation.allRoomReports.length})
              </h2>
              <span className="text-[11px] font-mono text-slate-400">Sabine 500–1000 Hz</span>
            </div>

            <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
              {evaluation.allRoomReports.map((rep) => {
                const isSelected = rep.roomId === selectedRoomReport?.roomId;
                const badge = STATUS_BADGE_CONFIG[rep.overallStatus];
                const midRt = rep.domainA_Reverberation.midFrequencyEstimatedRt60Seconds;
                return (
                  <button
                    key={rep.roomId}
                    onClick={() => setSelectedRoomId(rep.roomId)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-all flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-indigo-600/15 border-indigo-500/50 text-white'
                        : 'bg-slate-950/70 border-slate-800/80 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                        <span>{rep.roomName}</span>
                        <span className="text-[10px] font-mono text-slate-400">
                          L{rep.floorLevel}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 truncate">
                        {rep.domainB_SpeechFunctional.functionalProfileLabel}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-mono text-slate-200">
                        {midRt !== null ? `${midRt.toFixed(2)}s` : '2D Only'}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded border ${badge.bg} ${badge.text} ${badge.border}`}
                      >
                        {badge.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Room Acoustic Configuration */}
          {selectedRoomConfig && selectedRoomReport && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {selectedRoomReport.roomName} — Inputs
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Floor Area: {selectedRoomReport.geometry.floorAreaM2 ?? '—'} m² • Volume:{' '}
                    {selectedRoomReport.geometry.roomVolumeM3 !== null
                      ? `${selectedRoomReport.geometry.roomVolumeM3} m³`
                      : 'Unset'}
                  </p>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded border ${
                    PROVENANCE_LABELS[selectedRoomConfig.ceilingHeightProvenance].color
                  }`}
                >
                  {PROVENANCE_LABELS[selectedRoomConfig.ceilingHeightProvenance].label}
                </span>
              </div>

              {/* Ceiling Height */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300 flex items-center justify-between">
                  <span>Ceiling Height ({selectedRoomConfig.heightUnit})</span>
                  <span className="text-[11px] font-mono text-slate-400">
                    {selectedRoomReport.geometry.ceilingHeightMetres !== null
                      ? `${selectedRoomReport.geometry.ceilingHeightMetres} m`
                      : 'Not set'}
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.1"
                    min="1.8"
                    max="20"
                    value={selectedRoomConfig.ceilingHeight ?? ''}
                    placeholder={project.unit === 'feet' ? '9.0' : '2.7'}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : Number(e.target.value);
                      updateRoomConfig(selectedRoomConfig.roomId, (cfg) => ({
                        ...cfg,
                        ceilingHeight: val !== null && Number.isFinite(val) ? val : null,
                        ceilingHeightProvenance:
                          val !== null && val > 0
                            ? 'user-entered'
                            : 'unavailable-or-unverified'
                      }));
                    }}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    onClick={() =>
                      updateRoomConfig(
                        selectedRoomConfig.roomId,
                        (cfg) => ({
                          ...cfg,
                          ceilingHeight: project.unit === 'feet' ? 9.0 : 2.7,
                          ceilingHeightProvenance: 'user-entered'
                        }),
                        `Set ${selectedRoomReport.roomName} ceiling height.`
                      )
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-200 border border-slate-700 shrink-0"
                  >
                    {project.unit === 'feet' ? '9ft' : '2.7m'}
                  </button>
                </div>
              </div>

              {/* Functional Room Use Profile */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Functional Room Use Profile (Domain B)
                </label>
                <select
                  value={selectedRoomConfig.functionalUseProfile}
                  onChange={(e) =>
                    updateRoomConfig(selectedRoomConfig.roomId, (cfg) => ({
                      ...cfg,
                      functionalUseProfile: e.target.value as FunctionalRoomUseProfileId
                    }))
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white"
                >
                  {PROFILE_IDS.map((pid) => (
                    <option key={pid} value={pid}>
                      {getFunctionalProfileLabel(pid)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Occupant Count Assumption */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Simultaneous Occupant Assumption
                </label>
                <input
                  type="number"
                  min="0"
                  max="200"
                  value={selectedRoomConfig.occupantCountAssumption ?? ''}
                  placeholder="Optional (e.g. 4)"
                  onChange={(e) => {
                    const val = e.target.value === '' ? null : Number(e.target.value);
                    updateRoomConfig(selectedRoomConfig.roomId, (cfg) => ({
                      ...cfg,
                      occupantCountAssumption:
                        val !== null && Number.isFinite(val) ? val : null,
                      occupantProvenance:
                        val !== null ? 'user-entered' : 'unavailable-or-unverified'
                    }));
                  }}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-white"
                />
              </div>

              {/* Priority Tags */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Acoustic Priorities (Detects Trade-Offs)
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRIORITY_OPTIONS.map((opt) => {
                    const active = selectedRoomConfig.acousticPriorities.includes(opt.id);
                    return (
                      <button
                        key={opt.id}
                        onClick={() =>
                          handleTogglePriority(selectedRoomConfig.roomId, opt.id)
                        }
                        className={`p-2 rounded-lg border text-left transition-colors ${
                          active
                            ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-200'
                            : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="text-[11px] font-semibold">{opt.label}</div>
                        <div className="text-[10px] opacity-80 truncate">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Surface Materials */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Boundary Surface Materials (Domain A)
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-300">Ceiling Surface</label>
                  <select
                    value={selectedRoomConfig.ceilingAcousticMaterialId || ''}
                    onChange={(e) =>
                      updateRoomConfig(selectedRoomConfig.roomId, (cfg) => ({
                        ...cfg,
                        ceilingAcousticMaterialId: e.target.value || undefined
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    <option value="">Default from Interior Concept</option>
                    {availableMaterials
                      .filter((m) => m.targetSurfaceTypes.includes('ceiling'))
                      .map((m) => (
                        <option key={m.acousticMaterialId} value={m.acousticMaterialId}>
                          {m.displayName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-300">Wall Surface</label>
                  <select
                    value={selectedRoomConfig.wallAcousticMaterialId || ''}
                    onChange={(e) =>
                      updateRoomConfig(selectedRoomConfig.roomId, (cfg) => ({
                        ...cfg,
                        wallAcousticMaterialId: e.target.value || undefined
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    <option value="">Default from Interior Concept</option>
                    {availableMaterials
                      .filter((m) => m.targetSurfaceTypes.includes('wall'))
                      .map((m) => (
                        <option key={m.acousticMaterialId} value={m.acousticMaterialId}>
                          {m.displayName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-300">Floor Surface</label>
                  <select
                    value={selectedRoomConfig.floorAcousticMaterialId || ''}
                    onChange={(e) =>
                      updateRoomConfig(selectedRoomConfig.roomId, (cfg) => ({
                        ...cfg,
                        floorAcousticMaterialId: e.target.value || undefined
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    <option value="">Default from Interior Concept</option>
                    {availableMaterials
                      .filter((m) => m.targetSurfaceTypes.includes('floor'))
                      .map((m) => (
                        <option key={m.acousticMaterialId} value={m.acousticMaterialId}>
                          {m.displayName}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Partition & Door Assemblies */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Sound Insulation Assemblies (Domains D & E)
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-300">Interior Partition</label>
                  <select
                    value={selectedRoomConfig.partitionAssemblyId || ''}
                    onChange={(e) =>
                      updateRoomConfig(selectedRoomConfig.roomId, (cfg) => ({
                        ...cfg,
                        partitionAssemblyId: e.target.value || undefined
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    {availableAssemblies
                      .filter((a) => a.elementKind === 'interior-partition')
                      .map((a) => (
                        <option key={a.assemblyId} value={a.assemblyId}>
                          {a.displayName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-300">Interior Door Assembly</label>
                  <select
                    value={selectedRoomConfig.doorAssemblyId || ''}
                    onChange={(e) =>
                      updateRoomConfig(selectedRoomConfig.roomId, (cfg) => ({
                        ...cfg,
                        doorAssemblyId: e.target.value || undefined
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    {availableAssemblies
                      .filter((a) => a.elementKind === 'interior-door')
                      .map((a) => (
                        <option key={a.assemblyId} value={a.assemblyId}>
                          {a.displayName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] text-slate-300">Floor/Ceiling Slab</label>
                  <select
                    value={selectedRoomConfig.floorSlabAssemblyId || ''}
                    onChange={(e) =>
                      updateRoomConfig(selectedRoomConfig.roomId, (cfg) => ({
                        ...cfg,
                        floorSlabAssemblyId: e.target.value || undefined
                      }))
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200"
                  >
                    {availableAssemblies
                      .filter((a) => a.elementKind === 'floor-ceiling-slab')
                      .map((a) => (
                        <option key={a.assemblyId} value={a.assemblyId}>
                          {a.displayName}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: 8-Domain Results Inspector */}
        <div className="lg:col-span-8 space-y-5">
          {/* Domain Tab Bar */}
          <div className="flex flex-wrap gap-1.5 bg-slate-900 border border-slate-800 rounded-xl p-2">
            {[
              { id: 'domain-a', label: 'A. Sabine RT60 & Absorption' },
              { id: 'domain-b', label: 'B. Speech & Function' },
              { id: 'domain-c', label: 'C. Background Noise' },
              { id: 'domain-d', label: 'D. Airborne Privacy' },
              { id: 'domain-e', label: 'E. Impact & Vibration' },
              { id: 'domain-f', label: 'F. Mechanical (MEP)' },
              { id: 'domain-g', label: 'G. Spatial Zoning' },
              {
                id: 'domain-h',
                label: `H. Improvements (${selectedRoomReport?.domainH_Recommendations.length ?? 0})`
              },
              { id: 'comparison', label: 'P30–P35 & Option Compare' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveDomainTab(tab.id as typeof activeDomainTab)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  activeDomainTab === tab.id
                    ? 'bg-indigo-600 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Domain A: Reverberation & Absorption */}
          {activeDomainTab === 'domain-a' && selectedRoomReport && selectedRoomConfig && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono uppercase text-indigo-400">Domain A</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded border ${
                        STATUS_BADGE_CONFIG[selectedRoomReport.domainA_Reverberation.status].bg
                      } ${STATUS_BADGE_CONFIG[selectedRoomReport.domainA_Reverberation.status].text} ${
                        STATUS_BADGE_CONFIG[selectedRoomReport.domainA_Reverberation.status].border
                      }`}
                    >
                      {STATUS_BADGE_CONFIG[selectedRoomReport.domainA_Reverberation.status].label}
                    </span>
                  </div>
                  <h3 className="text-base font-bold text-white mt-1">
                    Room Reverberation (RT60) & Equivalent Absorption Area (A) — {selectedRoomReport.roomName}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selectedRoomReport.domainA_Reverberation.formulaUsed}
                  </p>
                </div>

                <div className="text-right font-mono">
                  <div className="text-xs text-slate-400">Estimated Mid-Freq RT60</div>
                  <div className="text-2xl font-bold text-indigo-300">
                    {selectedRoomReport.domainA_Reverberation.midFrequencyEstimatedRt60Seconds !== null
                      ? `${selectedRoomReport.domainA_Reverberation.midFrequencyEstimatedRt60Seconds.toFixed(
                          2
                        )} s`
                      : 'Insufficient 3D Data'}
                  </div>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs text-slate-200">
                {selectedRoomReport.domainA_Reverberation.explanation}
              </div>

              {/* Educational Scenario Preview when ceiling height is unset */}
              {selectedRoomReport.domainA_Reverberation.educationalScenarioPreview && (
                <div className="bg-sky-500/10 border border-sky-500/30 rounded-lg p-4 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-sky-300">
                      Educational Scenario Preview (Illustrative{' '}
                      {selectedRoomReport.domainA_Reverberation.educationalScenarioPreview.assumedHeightMetres.toFixed(
                        2
                      )}{' '}
                      m Height)
                    </span>
                    <span className="text-xs font-mono text-sky-200">
                      Illustrative Mid-Freq RT60:{' '}
                      {selectedRoomReport.domainA_Reverberation.educationalScenarioPreview
                        .previewMidFreqRt60Seconds !== null
                        ? `${selectedRoomReport.domainA_Reverberation.educationalScenarioPreview.previewMidFreqRt60Seconds.toFixed(
                            2
                          )} s`
                        : '—'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    {selectedRoomReport.domainA_Reverberation.educationalScenarioPreview.previewNote}
                  </p>
                </div>
              )}

              {/* Octave Band Table */}
              {selectedRoomReport.domainA_Reverberation.volumeM3 !== null && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono">
                        <th className="py-2 pr-3">Metric / Octave Band</th>
                        {OCTAVE_BANDS_HZ.map((hz) => (
                          <th key={hz} className="py-2 px-3 text-right">
                            {hz} Hz
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 font-mono">
                      <tr>
                        <td className="py-2.5 pr-3 text-slate-300 font-sans font-medium">
                          Equivalent Absorption A(f) [m² sabins]
                        </td>
                        {OCTAVE_BANDS_HZ.map((hz) => {
                          const b = selectedRoomReport.domainA_Reverberation.bandResults[hz];
                          return (
                            <td key={hz} className="py-2.5 px-3 text-right text-slate-200">
                              {b.totalEquivalentAbsorptionSabinsM2 !== null
                                ? b.totalEquivalentAbsorptionSabinsM2.toFixed(2)
                                : '—'}
                            </td>
                          );
                        })}
                      </tr>
                      <tr>
                        <td className="py-2.5 pr-3 text-slate-300 font-sans font-medium">
                          Mean Absorption Coefficient ᾱ(f)
                        </td>
                        {OCTAVE_BANDS_HZ.map((hz) => {
                          const b = selectedRoomReport.domainA_Reverberation.bandResults[hz];
                          return (
                            <td
                              key={hz}
                              className={`py-2.5 px-3 text-right ${
                                b.isHighAbsorptionSabineQualified
                                  ? 'text-amber-300 font-bold'
                                  : 'text-slate-300'
                              }`}
                            >
                              {b.meanAbsorptionCoefficientAlphaBar !== null
                                ? b.meanAbsorptionCoefficientAlphaBar.toFixed(2)
                                : '—'}
                            </td>
                          );
                        })}
                      </tr>
                      <tr className="bg-indigo-500/5">
                        <td className="py-2.5 pr-3 text-indigo-300 font-sans font-semibold">
                          Estimated Sabine RT60(f) [seconds]
                        </td>
                        {OCTAVE_BANDS_HZ.map((hz) => {
                          const b = selectedRoomReport.domainA_Reverberation.bandResults[hz];
                          return (
                            <td key={hz} className="py-2.5 px-3 text-right font-bold text-indigo-300">
                              {b.estimatedRt60Seconds !== null
                                ? `${b.estimatedRt60Seconds.toFixed(2)} s`
                                : '—'}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Surface Breakdown */}
              {selectedRoomReport.domainA_Reverberation.surfaceContributions.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      Surface Area & Opening Subtraction Ledger (No Double-Counting)
                    </h4>
                    <span className="text-[11px] font-mono text-slate-400">
                      Gross Wall: {selectedRoomReport.geometry.grossWallAreaM2 ?? 0} m² → Net Wall:{' '}
                      {selectedRoomReport.geometry.netWallAreaM2 ?? 0} m²
                    </span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-400">
                          <th className="py-1.5 pr-2">Surface Element</th>
                          <th className="py-1.5 px-2">Assigned Material</th>
                          <th className="py-1.5 px-2 text-right">Net Area (m²)</th>
                          <th className="py-1.5 px-2 text-right">500 Hz Sabins</th>
                          <th className="py-1.5 pl-2 text-right">Mid Share</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {selectedRoomReport.domainA_Reverberation.surfaceContributions.map((s) => (
                          <tr key={s.surfaceId} className="text-slate-300">
                            <td className="py-1.5 pr-2 font-medium">{s.surfaceLabel}</td>
                            <td className="py-1.5 px-2 text-slate-400">{s.materialName}</td>
                            <td className="py-1.5 px-2 text-right font-mono">
                              {s.areaM2.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono text-indigo-300">
                              {s.sabinsByBand[500] !== null ? s.sabinsByBand[500]!.toFixed(2) : '—'}
                            </td>
                            <td className="py-1.5 pl-2 text-right font-mono text-emerald-300">
                              {s.shareOfMidFreqAbsorptionPercent !== null
                                ? `${s.shareOfMidFreqAbsorptionPercent.toFixed(1)}%`
                                : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Custom Material Input */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Register Custom User-Entered Surface Material (Provenance: user-entered)
                </div>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <input
                    type="text"
                    value={customMatName}
                    onChange={(e) => setCustomMatName(e.target.value)}
                    placeholder="Material name"
                    className="md:col-span-2 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                  <select
                    value={customMatSurface}
                    onChange={(e) =>
                      setCustomMatSurface(e.target.value as 'wall' | 'ceiling' | 'floor')
                    }
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="wall">Wall Surface</option>
                    <option value="ceiling">Ceiling Surface</option>
                    <option value="floor">Floor Surface</option>
                  </select>
                  <input
                    type="number"
                    step="0.05"
                    min="0"
                    max="1"
                    value={customAlpha500}
                    onChange={(e) => setCustomAlpha500(e.target.value)}
                    placeholder="α 500Hz"
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                  />
                  <button
                    onClick={handleAddCustomMaterial}
                    className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
                  >
                    + Add Material
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Domain B: Speech & Functional Use */}
          {activeDomainTab === 'domain-b' && selectedRoomReport && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-xs font-mono uppercase text-indigo-400">Domain B</span>
                  <h3 className="text-base font-bold text-white">
                    Speech, Communication & Functional Use —{' '}
                    {selectedRoomReport.domainB_SpeechFunctional.functionalProfileLabel}
                  </h3>
                </div>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded border ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainB_SpeechFunctional.status].bg
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainB_SpeechFunctional.status].text
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainB_SpeechFunctional.status].border
                  }`}
                >
                  {STATUS_BADGE_CONFIG[selectedRoomReport.domainB_SpeechFunctional.status].label}
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 text-xs text-slate-200">
                {selectedRoomReport.domainB_SpeechFunctional.explanation}
              </div>

              {selectedRoomReport.domainB_SpeechFunctional.conflictingPrioritiesDetected.length >
                0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    Conflicting Priority Goals Detected
                  </h4>
                  {selectedRoomReport.domainB_SpeechFunctional.conflictingPrioritiesDetected.map(
                    (c, idx) => (
                      <div
                        key={idx}
                        className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-200"
                      >
                        {c}
                      </div>
                    )
                  )}
                </div>
              )}

              <div className="bg-slate-950/90 border border-slate-800 rounded-lg p-3.5 flex items-start gap-2.5 text-xs text-slate-400">
                <Lock className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-300">
                    Scientific Guardrail — No Fabricated STI / C50 / D50 / %ALcons
                  </div>
                  <p className="mt-0.5">
                    {selectedRoomReport.domainB_SpeechFunctional.stiAndAdvancedMetricsDisclosure}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Domain C: Background & Environmental Noise */}
          {activeDomainTab === 'domain-c' && selectedRoomReport && selectedRoomConfig && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-xs font-mono uppercase text-indigo-400">Domain C</span>
                  <h3 className="text-base font-bold text-white">
                    Background & Environmental Noise — {selectedRoomReport.roomName}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Target: ≤{' '}
                    {selectedRoomReport.domainC_BackgroundNoise.activeCriterion.maxTarget} dBA (
                    {selectedRoomReport.domainC_BackgroundNoise.activeCriterion.authorityStatus})
                  </p>
                </div>
                <div className="text-right font-mono">
                  <div className="text-xs text-slate-400">Combined Energetic Sum (L_total)</div>
                  <div className="text-xl font-bold text-indigo-300">
                    {selectedRoomReport.domainC_BackgroundNoise.combinedMeasuredIndoorLaeqDba !==
                    null
                      ? `${selectedRoomReport.domainC_BackgroundNoise.combinedMeasuredIndoorLaeqDba.toFixed(
                          1
                        )} dBA`
                      : 'No Measured Indoor dBA'}
                  </div>
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300 space-y-1.5">
                <div>
                  <strong>Formula:</strong>{' '}
                  <code className="text-indigo-300 font-mono">
                    {selectedRoomReport.domainC_BackgroundNoise.energyLogarithmicFormulaUsed}
                  </code>
                </div>
                <div className="text-slate-400">
                  {selectedRoomReport.domainC_BackgroundNoise.whoGuidelinesScopeDisclosure}
                </div>
                <div className="text-slate-400">
                  {selectedRoomReport.domainC_BackgroundNoise.noLocationInferenceGuarantee}
                </div>
              </div>

              {/* Add Noise Observation */}
              <div className="bg-slate-950/70 border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Add User-Declared Noise Observation
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <select
                    value={noiseCategory}
                    onChange={(e) => setNoiseCategory(e.target.value as NoiseSourceCategory)}
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="road-traffic">Road Traffic</option>
                    <option value="rail-or-aircraft">Rail or Aircraft</option>
                    <option value="external-plant-equipment">External Plant Equipment</option>
                    <option value="internal-hvac-equipment">Internal HVAC Equipment</option>
                    <option value="pumps-fans-lifts">Pumps / Fans / Lifts</option>
                    <option value="neighbouring-activities">Neighbouring Activities</option>
                    <option value="general-indoor-activity">General Indoor Activity</option>
                  </select>

                  <select
                    value={noiseKind}
                    onChange={(e) =>
                      setNoiseKind(
                        e.target.value as NoiseObservationEntry['observationKind']
                      )
                    }
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="subjective-qualitative-observation">
                      Qualitative Observation Only
                    </option>
                    <option value="measured-sound-level">Measured Sound Level (LAeq dBA)</option>
                  </select>

                  {noiseKind === 'measured-sound-level' ? (
                    <input
                      type="number"
                      step="0.5"
                      value={noiseDbaInput}
                      onChange={(e) => setNoiseDbaInput(e.target.value)}
                      placeholder="dBA (e.g. 38)"
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white"
                    />
                  ) : (
                    <select
                      value={noiseSeverity}
                      onChange={(e) =>
                        setNoiseSeverity(
                          e.target.value as NoiseObservationEntry['qualitativeSeverity']
                        )
                      }
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                    >
                      <option value="low-barely-audible">Low — Barely Audible</option>
                      <option value="moderate-noticeable">Moderate — Noticeable</option>
                      <option value="high-intrusive">High — Intrusive</option>
                      <option value="intermittent-impulsive">Intermittent / Impulsive</option>
                    </select>
                  )}
                </div>

                <div className="flex flex-col md:flex-row gap-2.5">
                  <select
                    value={noiseLocation}
                    onChange={(e) =>
                      setNoiseLocation(
                        e.target.value as NoiseObservationEntry['measurementLocation']
                      )
                    }
                    className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  >
                    <option value="indoor-receiver-room">Indoor Receiver Room</option>
                    <option value="outdoor-facade">Outdoor Facade Exposure</option>
                    <option value="adjacent-source-room">Adjacent Source Room</option>
                  </select>
                  <input
                    type="text"
                    value={noiseDescription}
                    onChange={(e) => setNoiseDescription(e.target.value)}
                    placeholder="Source description"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                  />
                  <button
                    onClick={() => handleAddNoiseObservation(selectedRoomConfig.roomId)}
                    className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Observation
                  </button>
                </div>
              </div>

              {/* Observations List */}
              <div className="space-y-2">
                {selectedRoomReport.domainC_BackgroundNoise.observations.map((obs) => (
                  <div
                    key={obs.observationId}
                    className="flex items-center justify-between bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        {obs.sourceDescription}{' '}
                        <span className="text-slate-400 font-mono">
                          ({obs.measurementLocation})
                        </span>
                      </div>
                      <div className="text-slate-400 mt-0.5">
                        {obs.soundLevelDb !== null
                          ? `${obs.soundLevelDb} ${obs.metricAndUnit}`
                          : obs.qualitativeSeverity}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveNoiseObservation(obs.observationId)}
                      className="text-slate-400 hover:text-rose-400 p-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Domain D: Airborne Privacy */}
          {activeDomainTab === 'domain-d' && selectedRoomReport && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-xs font-mono uppercase text-indigo-400">Domain D</span>
                  <h3 className="text-base font-bold text-white">
                    Airborne Sound Insulation & Privacy — {selectedRoomReport.roomName}
                  </h3>
                </div>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded border ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainD_AirbornePrivacy.status].bg
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainD_AirbornePrivacy.status].text
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainD_AirbornePrivacy.status].border
                  }`}
                >
                  {STATUS_BADGE_CONFIG[selectedRoomReport.domainD_AirbornePrivacy.status].label}
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs text-slate-300 space-y-1.5">
                <div className="font-semibold text-indigo-300">
                  ISO 12354-1:2017 & ISO 717-1:2020 Component vs. As-Built Disclosure:
                </div>
                <p>{selectedRoomReport.domainD_AirbornePrivacy.componentVsAsBuiltDisclosure}</p>
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Shared 2D Perimeter Walls (
                  {selectedRoomReport.domainD_AirbornePrivacy.sharedBoundaries.length})
                </h4>
                {selectedRoomReport.domainD_AirbornePrivacy.sharedBoundaries.map((b, i) => (
                  <div
                    key={i}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        {selectedRoomReport.roomName} ↔ {b.neighborRoomName} ({b.wallOrientation} wall,{' '}
                        {b.sharedEdgeLengthMetres} m)
                      </div>
                      <div className="text-slate-400">
                        {b.incompatibilityReason || 'Compatible adjacent activity'}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded border ${
                        b.isNoiseIncompatiblePair
                          ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                          : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                      }`}
                    >
                      {b.isNoiseIncompatiblePair ? 'Incompatible Pair' : 'Compatible'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Domain E: Impact & Vibration */}
          {activeDomainTab === 'domain-e' && selectedRoomReport && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-xs font-mono uppercase text-indigo-400">Domain E</span>
                  <h3 className="text-base font-bold text-white">
                    Impact, Structure-Borne Sound & Vibration — {selectedRoomReport.roomName}
                  </h3>
                </div>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded border ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainE_ImpactStructure.status].bg
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainE_ImpactStructure.status].text
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainE_ImpactStructure.status].border
                  }`}
                >
                  {STATUS_BADGE_CONFIG[selectedRoomReport.domainE_ImpactStructure.status].label}
                </span>
              </div>

              <div className="space-y-2">
                {selectedRoomReport.domainE_ImpactStructure.screeningChecklist.map((item) => (
                  <div
                    key={item.itemId}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs space-y-1"
                  >
                    <div className="font-semibold text-white">{item.checkTitle}</div>
                    <div className="text-slate-300">{item.finding}</div>
                  </div>
                ))}
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-400">
                {selectedRoomReport.domainE_ImpactStructure.specialistVibrationTestingRequiredNote}
              </div>
            </div>
          )}

          {/* Domain F: Mechanical Services */}
          {activeDomainTab === 'domain-f' && selectedRoomReport && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-xs font-mono uppercase text-indigo-400">Domain F</span>
                  <h3 className="text-base font-bold text-white">
                    Mechanical Services (MEP) Noise & Vibration — {selectedRoomReport.roomName}
                  </h3>
                </div>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded border ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainF_MechanicalNoise.status].bg
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainF_MechanicalNoise.status].text
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainF_MechanicalNoise.status].border
                  }`}
                >
                  {STATUS_BADGE_CONFIG[selectedRoomReport.domainF_MechanicalNoise.status].label}
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs text-slate-200">
                {selectedRoomReport.domainF_MechanicalNoise.explanation}
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-400">
                {selectedRoomReport.domainF_MechanicalNoise.p37VentilationBoundaryNote}
              </div>
            </div>
          )}

          {/* Domain G: Spatial Zoning */}
          {activeDomainTab === 'domain-g' && selectedRoomReport && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <span className="text-xs font-mono uppercase text-indigo-400">Domain G</span>
                  <h3 className="text-base font-bold text-white">
                    Acoustic Zoning & Spatial Coordination — {selectedRoomReport.roomName}
                  </h3>
                </div>
                <span
                  className={`text-xs px-2.5 py-0.5 rounded border ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainG_AcousticZoning.status].bg
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainG_AcousticZoning.status].text
                  } ${
                    STATUS_BADGE_CONFIG[selectedRoomReport.domainG_AcousticZoning.status].border
                  }`}
                >
                  {STATUS_BADGE_CONFIG[selectedRoomReport.domainG_AcousticZoning.status].label}
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 text-xs text-slate-200">
                {selectedRoomReport.domainG_AcousticZoning.explanation}
              </div>

              {selectedRoomReport.domainG_AcousticZoning.adjacencyConflicts.map((c) => (
                <div
                  key={c.conflictId}
                  className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-3.5 text-xs space-y-1"
                >
                  <div className="font-semibold text-rose-200">
                    {c.sourceRoomName} ↔ {c.targetRoomName} ({c.relationshipKind})
                  </div>
                  <div className="text-slate-200">{c.explanation}</div>
                </div>
              ))}
            </div>
          )}

          {/* Domain H: Actionable Improvements */}
          {activeDomainTab === 'domain-h' && selectedRoomReport && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5">
              <div className="border-b border-slate-800 pb-3">
                <span className="text-xs font-mono uppercase text-indigo-400">Domain H</span>
                <h3 className="text-base font-bold text-white">
                  Actionable Acoustic Improvements — {selectedRoomReport.roomName}
                </h3>
              </div>

              <div className="space-y-3">
                {selectedRoomReport.domainH_Recommendations.map((rec) => (
                  <div
                    key={rec.recommendationId}
                    className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3 text-xs"
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <div className="font-bold text-white text-sm">{rec.title}</div>
                        <div className="text-slate-400 mt-0.5">{rec.issueAddressed}</div>
                      </div>
                      {rec.canPreviewAndApplyInPlotify && (
                        <button
                          onClick={() =>
                            handlePreviewRecommendation(rec.recommendationId, rec.roomId)
                          }
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium shrink-0"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Preview & Apply
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 bg-slate-900/90 border border-slate-800 rounded-lg p-3">
                      <div>
                        <span className="text-slate-400">Expected Benefit ({rec.expectedBenefitKind}):</span>{' '}
                        <span className="text-emerald-300">{rec.expectedBenefitSummary}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">Supporting Evidence:</span>{' '}
                        <span className="text-slate-200">{rec.supportingEvidence}</span>
                      </div>
                      <div>
                        <span className="text-slate-400">P35 Moisture/Climate:</span>{' '}
                        <span className="text-amber-200">
                          {rec.multidisciplinaryTradeOffs.moistureAndClimateCompatibility}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400">P34 Accessibility:</span>{' '}
                        <span className="text-sky-300">
                          {rec.multidisciplinaryTradeOffs.accessibilityP34Impact}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Active Non-Destructive Preview */}
              {activePreview && (
                <div className="bg-indigo-950/30 border-2 border-indigo-500/50 rounded-xl p-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="font-bold text-white text-sm">
                      Non-Destructive Preview: {activePreview.title} ({activePreview.roomName})
                    </div>
                    <button
                      onClick={() => setActivePreview(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      Close
                    </button>
                  </div>

                  <div className="font-mono text-indigo-200">
                    Mid-Freq RT60: {activePreview.beforeRt60MidSec ?? '—'} s →{' '}
                    {activePreview.afterRt60MidSec ?? '—'} s
                  </div>

                  <div className="space-y-1">
                    {activePreview.fieldChanges.map((fc, i) => (
                      <div key={i} className="text-slate-300">
                        • <strong>{fc.label}:</strong> {fc.beforeValue} →{' '}
                        <span className="text-emerald-300">{fc.afterValue}</span>
                      </div>
                    ))}
                  </div>

                  {activePreview.isSafeToApply && (
                    <button
                      onClick={() => handleApplyRecommendation(activePreview)}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      Confirm Atomic Apply (Creates Snapshot Checkpoint)
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Cross-Phase Integration & P31 Option Comparison */}
          {activeDomainTab === 'comparison' && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-5 text-xs">
              <div className="border-b border-slate-800 pb-3">
                <span className="text-xs font-mono uppercase text-indigo-400">
                  Cross-Phase Integration
                </span>
                <h3 className="text-base font-bold text-white">
                  P30–P35 Integration & P31 Multi-Option Acoustic Comparison
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
                  <div className="font-bold text-indigo-300">P30 Brief Requirements</div>
                  {evaluation.p30BriefIntegration.confirmedAcousticRequirements.map((r, i) => (
                    <div key={i} className="text-slate-300">
                      • {r}
                    </div>
                  ))}
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3.5 space-y-1">
                  <div className="font-bold text-indigo-300">P33 & P34 Guardrails</div>
                  <div className="text-slate-300">
                    • {evaluation.p33FurnitureIntegration.furnitureAbsorptionPolicyNote}
                  </div>
                  <div className="text-sky-300">
                    • {evaluation.p34AccessibilityIntegration.clearancesAndDoorsPreservedNote}
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-800">
                <h4 className="font-bold uppercase tracking-wider text-slate-400">
                  P31 Option Acoustic Comparison Summaries
                </h4>
                {evaluation.p31OptionComparisonSummaries.map((opt) => (
                  <div
                    key={opt.optionId}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-white">{opt.optionName}</div>
                      <div className="text-slate-400">{opt.summaryExplanation}</div>
                    </div>
                    <span className="font-mono text-indigo-300">
                      {opt.averageEstimatedMidRt60Seconds !== null
                        ? `${opt.averageEstimatedMidRt60Seconds} s avg`
                        : 'Incomplete'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AcousticComfortWorkspace;
