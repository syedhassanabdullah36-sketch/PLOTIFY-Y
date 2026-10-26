import { Project, FloorPlanRoom, MeasurementUnit, Currency } from '../types/project';
import {
  ArchitecturalBriefData,
  SpaceRequirement,
  SpatialRelationshipRule,
  SpaceProgramSummary,
  SpacePlacementComparison,
  BriefValidationNotice,
  BriefApprovalStatus,
  BriefRevisionRecord,
  BuildingUseClassification,
  SpaceCategory,
  BriefPriority,
  PrivacyLevel,
  RequirementCategory,
  RequirementPriority,
  RequirementSource,
  RequirementReviewStatus,
  ConflictDisposition,
  ProjectRequirement,
  BriefAssumption,
  BriefConflict,
  ClarificationQuestion,
  BriefValidationResult,
  DownstreamWorkflowCompatibility,
  ArchitecturalBrief,
} from '../types/brief';

export const BRIEF_ENGINE_VERSION = 'v1.0.0';

/**
 * Standard baseline unit-aware space definitions
 */
function getDefaultSpaceAreas(unit: MeasurementUnit) {
  const isFeet = unit === 'feet';
  return {
    living: isFeet ? 260 : 24,
    dining: isFeet ? 160 : 15,
    kitchen: isFeet ? 150 : 14,
    masterBedroom: isFeet ? 200 : 19,
    bedroom: isFeet ? 140 : 13,
    ensuiteBath: isFeet ? 60 : 5.5,
    familyBath: isFeet ? 50 : 4.5,
    powderRoom: isFeet ? 30 : 2.8,
    homeOffice: isFeet ? 120 : 11,
    laundry: isFeet ? 45 : 4.2,
    storage: isFeet ? 40 : 3.7,
    garage: isFeet ? 240 : 22,
    balcony: isFeet ? 80 : 7.5,
    entryVestibule: isFeet ? 50 : 4.6,
  };
}

/**
 * Pre-configured Architectural Brief Templates
 */
export function getBriefTemplates(unit: MeasurementUnit): Array<{
  id: string;
  name: string;
  category: BuildingUseClassification;
  description: string;
  brief: Partial<ArchitecturalBriefData>;
}> {
  const areas = getDefaultSpaceAreas(unit);

  return [
    {
      id: 'family-residence-4bed',
      name: 'Contemporary Family Residence (4 Bed)',
      category: 'residential',
      description: 'Balanced family living with dedicated master suite, guest room, study, and seamless indoor-outdoor connectivity.',
      brief: {
        objectives: {
          primaryPurpose: 'Single-family primary residence with multi-generational flexibility',
          buildingUse: 'residential',
          intendedUsers: 'Family of 4-5 plus occasional visiting grandparents',
          mainActivities: 'Daily cooking, gathering, quiet homework/study, remote work, garden recreation',
          desiredOutcomes: 'High daylight quality, acoustic isolation for bedrooms, low thermal bridging',
          projectStage: 'Schematic Design',
          designLifeYears: 60,
        },
        occupancy: {
          regularOccupants: 4,
          occasionalVisitors: 2,
          occupancyPattern: 'Full-time family occupancy, weekday school/work schedule, weekend hosting',
          userGroupNeeds: 'Separate work-from-home study; step-free ground floor powder room; safe play line-of-sight',
          futureExpansionNeeds: 'Potential loft or attic conversion in 8-10 years',
          accessibilityNotes: 'Step-free ground level entrance and wide 36-inch (910mm) circulation doors',
        },
        preferences: {
          spatialCharacter: 'Warm contemporary open-plan kitchen and dining with sunken or acoustic-separated formal lounge',
          indoorOutdoorRelationship: 'Expansive sliding glazed doors opening directly onto sheltered south-facing garden patio',
          naturalLightPriorities: 'Morning light in kitchen and breakfast nook; soft diffused north light for home office',
          storagePriorities: 'Concealed hallway cloakroom, walk-in kitchen pantry, built-in bedroom wardrobes',
          circulationPreferences: 'Compact central stair core to minimise wasted hallway area (<12%)',
          materialPreferences: 'Natural timber accents, lime-wash plastered walls, energy-efficient triple glazing',
        },
        constraints: {
          siteRestrictionsSummary: 'Governed by local zoning setbacks and solar shading envelope',
          structuralAssumptions: 'Engineered timber framing or reinforced masonry ground floor',
          knownMandatoryRequirements: [
            'All habitable bedrooms must have direct exterior daylight and operable ventilation',
            'Minimum 2 dedicated parking bays on site',
            'Full acoustic barrier between living room and ground floor guest room',
          ],
          accessibilityMandatory: true,
          unresolvedQuestions: [
            'Client confirmation on ground-floor vs first-floor master suite preference',
            'Local council maximum roof ridgeline height restriction',
          ],
        },
        circulationWallAllowancePercent: 15,
        spaces: [
          {
            id: 'sp-entry',
            name: 'Entry Foyer & Cloaks',
            category: 'circulation',
            targetArea: areas.entryVestibule,
            minArea: Math.round(areas.entryVestibule * 0.8),
            maxArea: Math.round(areas.entryVestibule * 1.3),
            quantity: 1,
            floorPreference: 1,
            priority: 'mandatory',
            privacyLevel: 'public',
            occupantCapacity: 3,
            naturalLightRequired: true,
            plumbingRequired: false,
            outdoorAccessRequired: true,
            acousticPrivacyRequired: false,
            wheelchairAccessible: true,
            notes: 'Welcoming transition with integrated shoe bench and coat storage',
          },
          {
            id: 'sp-living',
            name: 'Main Living Lounge',
            category: 'living',
            targetArea: areas.living,
            minArea: Math.round(areas.living * 0.85),
            maxArea: Math.round(areas.living * 1.35),
            quantity: 1,
            floorPreference: 1,
            priority: 'mandatory',
            privacyLevel: 'public',
            occupantCapacity: 8,
            naturalLightRequired: true,
            plumbingRequired: false,
            outdoorAccessRequired: true,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Comfortable family gathering, garden views, media wall',
          },
          {
            id: 'sp-kitchen-dining',
            name: 'Open Kitchen & Dining Area',
            category: 'service',
            targetArea: areas.kitchen + areas.dining,
            minArea: Math.round((areas.kitchen + areas.dining) * 0.85),
            maxArea: Math.round((areas.kitchen + areas.dining) * 1.3),
            quantity: 1,
            floorPreference: 1,
            priority: 'mandatory',
            privacyLevel: 'semi-private',
            occupantCapacity: 8,
            naturalLightRequired: true,
            plumbingRequired: true,
            outdoorAccessRequired: true,
            acousticPrivacyRequired: false,
            wheelchairAccessible: true,
            notes: 'Central island bench, pantry zone, table seating for 8',
          },
          {
            id: 'sp-master-suite',
            name: 'Master Suite & Ensuite',
            category: 'sleeping',
            targetArea: areas.masterBedroom + areas.ensuiteBath,
            minArea: Math.round((areas.masterBedroom + areas.ensuiteBath) * 0.85),
            maxArea: Math.round((areas.masterBedroom + areas.ensuiteBath) * 1.3),
            quantity: 1,
            floorPreference: 'any',
            priority: 'mandatory',
            privacyLevel: 'private',
            occupantCapacity: 2,
            naturalLightRequired: true,
            plumbingRequired: true,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Private acoustic haven, walk-through wardrobe, private bathroom',
          },
          {
            id: 'sp-secondary-beds',
            name: 'Secondary Bedrooms',
            category: 'sleeping',
            targetArea: areas.bedroom,
            minArea: Math.round(areas.bedroom * 0.85),
            maxArea: Math.round(areas.bedroom * 1.25),
            quantity: 3,
            floorPreference: 'any',
            priority: 'mandatory',
            privacyLevel: 'private',
            occupantCapacity: 1,
            naturalLightRequired: true,
            plumbingRequired: false,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Children / guest rooms with study desk space and built-in closet',
          },
          {
            id: 'sp-family-bath',
            name: 'Family Bathroom',
            category: 'hygiene',
            targetArea: areas.familyBath,
            minArea: Math.round(areas.familyBath * 0.85),
            maxArea: Math.round(areas.familyBath * 1.3),
            quantity: 1,
            floorPreference: 'any',
            priority: 'mandatory',
            privacyLevel: 'private',
            occupantCapacity: 1,
            naturalLightRequired: true,
            plumbingRequired: true,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Full bathtub, walk-in shower, double basin vanity',
          },
          {
            id: 'sp-powder',
            name: 'Ground Guest Powder Room',
            category: 'hygiene',
            targetArea: areas.powderRoom,
            minArea: Math.round(areas.powderRoom * 0.8),
            maxArea: Math.round(areas.powderRoom * 1.4),
            quantity: 1,
            floorPreference: 1,
            priority: 'high-priority',
            privacyLevel: 'semi-private',
            occupantCapacity: 1,
            naturalLightRequired: false,
            plumbingRequired: true,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Accessible guest WC near entrance and living zones',
          },
          {
            id: 'sp-home-office',
            name: 'Dedicated Home Office / Library',
            category: 'work',
            targetArea: areas.homeOffice,
            minArea: Math.round(areas.homeOffice * 0.8),
            maxArea: Math.round(areas.homeOffice * 1.3),
            quantity: 1,
            floorPreference: 'any',
            priority: 'high-priority',
            privacyLevel: 'private',
            occupantCapacity: 2,
            naturalLightRequired: true,
            plumbingRequired: false,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Quiet video-conferencing zone with direct daylight',
          },
          {
            id: 'sp-utility-laundry',
            name: 'Utility, Laundry & Storage',
            category: 'service',
            targetArea: areas.laundry + areas.storage,
            minArea: Math.round((areas.laundry + areas.storage) * 0.8),
            maxArea: Math.round((areas.laundry + areas.storage) * 1.3),
            quantity: 1,
            floorPreference: 1,
            priority: 'preferred',
            privacyLevel: 'private',
            occupantCapacity: 1,
            naturalLightRequired: false,
            plumbingRequired: true,
            outdoorAccessRequired: true,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Direct exterior side yard access for clothes drying and muddy boots',
          },
        ],
        relationships: [
          {
            id: 'rel-1',
            sourceSpaceId: 'sp-entry',
            targetSpaceId: 'sp-living',
            relationType: 'direct-access',
            priority: 'mandatory',
            notes: 'Direct welcoming flow from entry to living',
          },
          {
            id: 'rel-2',
            sourceSpaceId: 'sp-kitchen-dining',
            targetSpaceId: 'sp-living',
            relationType: 'adjacent',
            priority: 'high-priority',
            notes: 'Visual connectivity between culinary preparation and social areas',
          },
          {
            id: 'rel-3',
            sourceSpaceId: 'sp-master-suite',
            targetSpaceId: 'sp-living',
            relationType: 'separated',
            priority: 'mandatory',
            notes: 'Sleeping quarters must be acoustically and visually buffered from living spaces',
          },
          {
            id: 'rel-4',
            sourceSpaceId: 'sp-kitchen-dining',
            targetSpaceId: 'sp-utility-laundry',
            relationType: 'adjacent',
            priority: 'preferred',
            notes: 'Convenient back-of-house service connection',
          },
        ],
      },
    },
    {
      id: 'urban-townhouse-livework',
      name: 'Urban Live-Work Townhouse',
      category: 'mixed-use',
      description: 'Vertical urban living featuring ground floor client-facing studio / office and upper private duplex residence.',
      brief: {
        objectives: {
          primaryPurpose: 'Live-work hybrid with street-facing professional studio and secluded upper home',
          buildingUse: 'mixed-use',
          intendedUsers: 'Creative professional / consultant couple with client appointments',
          mainActivities: 'Client meetings, digital production, residential cooking and relaxation',
          desiredOutcomes: 'Clear zoning between professional visitor access and private residential sanctuary',
          projectStage: 'Concept Feasibility',
          designLifeYears: 50,
        },
        occupancy: {
          regularOccupants: 2,
          occasionalVisitors: 5,
          occupancyPattern: 'Business hours weekday client visits on ground level; private residence evening and weekends',
          userGroupNeeds: 'Separate business entrance and client restroom',
          futureExpansionNeeds: 'Flexibility to convert studio into ground-floor suite or commercial rental',
          accessibilityNotes: 'Ground floor meeting space and restroom must meet universal accessibility standards',
        },
        preferences: {
          spatialCharacter: 'Industrial-minimalist high ceilings, polished concrete ground floor, warm timber upper levels',
          indoorOutdoorRelationship: 'Private rooftop terrace and small internal ground-floor lightwell courtyard',
          naturalLightPriorities: 'Zenithal roof skylights for upper stairwell; storefront glazing for studio',
          storagePriorities: 'Secure archive and equipment storage on ground floor',
          circulationPreferences: 'Acoustically isolated secure stairwell connecting studio to residence',
          materialPreferences: 'Exposed steel structural beams, acoustic felt paneling, dark bronze window frames',
        },
        constraints: {
          siteRestrictionsSummary: 'Narrow urban lot with party walls on both flanks; strict height ceiling',
          structuralAssumptions: 'Steel post-and-beam frame or precast concrete floor slabs for fire separation',
          knownMandatoryRequirements: [
            'Fire-rated 60-minute separation floor between commercial studio and residential level',
            'Independent emergency egress paths',
          ],
          accessibilityMandatory: true,
          unresolvedQuestions: [
            'Zoning approval required for mixed-use commercial occupancy classification',
          ],
        },
        circulationWallAllowancePercent: 18,
        spaces: [
          {
            id: 'sp-commercial-studio',
            name: 'Client Studio & Meeting Room',
            category: 'work',
            targetArea: areas.living,
            minArea: Math.round(areas.living * 0.85),
            maxArea: Math.round(areas.living * 1.3),
            quantity: 1,
            floorPreference: 1,
            priority: 'mandatory',
            privacyLevel: 'public',
            occupantCapacity: 6,
            naturalLightRequired: true,
            plumbingRequired: false,
            outdoorAccessRequired: true,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Street-facing commercial presentation space',
          },
          {
            id: 'sp-client-wc',
            name: 'Accessible Studio Restroom',
            category: 'hygiene',
            targetArea: areas.powderRoom * 1.5,
            minArea: Math.round(areas.powderRoom * 1.2),
            quantity: 1,
            floorPreference: 1,
            priority: 'mandatory',
            privacyLevel: 'public',
            occupantCapacity: 1,
            naturalLightRequired: false,
            plumbingRequired: true,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Universal accessibility compliance for commercial visitors',
          },
          {
            id: 'sp-upper-living',
            name: 'Private Residential Living & Kitchen',
            category: 'living',
            targetArea: areas.living + areas.kitchen,
            quantity: 1,
            floorPreference: 2,
            priority: 'mandatory',
            privacyLevel: 'private',
            occupantCapacity: 4,
            naturalLightRequired: true,
            plumbingRequired: true,
            outdoorAccessRequired: true,
            acousticPrivacyRequired: true,
            wheelchairAccessible: false,
            notes: 'Upper private living with direct access to terrace',
          },
          {
            id: 'sp-upper-bedroom',
            name: 'Upper Bedroom Suites',
            category: 'sleeping',
            targetArea: areas.masterBedroom,
            quantity: 2,
            floorPreference: 2,
            priority: 'mandatory',
            privacyLevel: 'private',
            occupantCapacity: 2,
            naturalLightRequired: true,
            plumbingRequired: false,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: true,
            wheelchairAccessible: false,
            notes: 'Quiet top-floor retreat',
          },
        ],
        relationships: [
          {
            id: 'rel-tw-1',
            sourceSpaceId: 'sp-commercial-studio',
            targetSpaceId: 'sp-upper-living',
            relationType: 'separated',
            priority: 'mandatory',
            notes: 'Strict physical and acoustic separation between work clients and private home',
          },
        ],
      },
    },
    {
      id: 'boutique-office',
      name: 'Creative Collaborative Office',
      category: 'workplace-office',
      description: 'Flexible agile workspace designed for 10-15 knowledge workers with focus pods, boardroom, and social kitchen.',
      brief: {
        objectives: {
          primaryPurpose: 'Headquarters for an architecture/design consultancy',
          buildingUse: 'workplace-office',
          intendedUsers: '12 core team members plus rotating clients and collaborators',
          mainActivities: 'Design modeling, collaborative workshops, client presentations, video calls',
          desiredOutcomes: 'Acoustic comfort, biophilic elements, agile hot-desking, showcase brand identity',
          projectStage: 'Schematic Design',
          designLifeYears: 40,
        },
        occupancy: {
          regularOccupants: 12,
          occasionalVisitors: 8,
          occupancyPattern: 'Weekdays 8am-7pm; occasional weekend events',
          userGroupNeeds: 'Dedicated pin-up walls, sample library storage, acoustic telephone booths',
          futureExpansionNeeds: 'Ability to accommodate 18 workstations via reconfigurable furniture',
          accessibilityNotes: 'Full DDA / ADA barrier-free accessibility throughout ground floor and meeting rooms',
        },
        preferences: {
          spatialCharacter: 'Loft-like open ceiling, acoustic baffles, perimeter desks with central collaboration tables',
          indoorOutdoorRelationship: 'Spill-out courtyard for outdoor lunch and Friday social events',
          naturalLightPriorities: 'Glare-free diffuse illumination on work surfaces; automated shading on south facade',
          storagePriorities: 'Extensive physical material library shelving and 3D print workshop enclosure',
          circulationPreferences: 'Active circulation loop encouraging casual cross-disciplinary interaction',
          materialPreferences: 'Recycled acoustic felt, sustainably harvested timber, low-VOC finishes',
        },
        constraints: {
          siteRestrictionsSummary: 'Commercial zoning compliance, required parking ratio of 1 stall per 300 sq ft',
          structuralAssumptions: 'Exposed structural mass timber or concrete flat slab',
          knownMandatoryRequirements: [
            'Dual compliant fire exit routes',
            'Minimum fresh-air ventilation of 10 L/s per person',
          ],
          accessibilityMandatory: true,
          unresolvedQuestions: [
            'Server room dedicated HVAC unit placement and power load confirmation',
          ],
        },
        circulationWallAllowancePercent: 20,
        spaces: [
          {
            id: 'sp-open-work',
            name: 'Open Studio Workstations (12 Desks)',
            category: 'work',
            targetArea: areas.living * 2,
            quantity: 1,
            floorPreference: 1,
            priority: 'mandatory',
            privacyLevel: 'semi-private',
            occupantCapacity: 14,
            naturalLightRequired: true,
            plumbingRequired: false,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: false,
            wheelchairAccessible: true,
            notes: 'Ergonomic sit-stand desk clusters with perimeter natural lighting',
          },
          {
            id: 'sp-boardroom',
            name: 'Boardroom / Presentation Suite',
            category: 'work',
            targetArea: areas.living,
            quantity: 1,
            floorPreference: 1,
            priority: 'mandatory',
            privacyLevel: 'semi-private',
            occupantCapacity: 10,
            naturalLightRequired: true,
            plumbingRequired: false,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'High-spec acoustic attenuation (STC 50+), presentation screen, conference audio',
          },
          {
            id: 'sp-kitchen-social',
            name: 'Staff Cafe & Social Hub',
            category: 'service',
            targetArea: areas.kitchen + areas.dining,
            quantity: 1,
            floorPreference: 1,
            priority: 'high-priority',
            privacyLevel: 'public',
            occupantCapacity: 12,
            naturalLightRequired: true,
            plumbingRequired: true,
            outdoorAccessRequired: true,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Coffee bar, dining bench, informal team breakout zone',
          },
          {
            id: 'sp-focus-pods',
            name: 'Acoustic Phone & Focus Pods',
            category: 'work',
            targetArea: areas.powderRoom * 2,
            quantity: 2,
            floorPreference: 1,
            priority: 'high-priority',
            privacyLevel: 'private',
            occupantCapacity: 1,
            naturalLightRequired: false,
            plumbingRequired: false,
            outdoorAccessRequired: false,
            acousticPrivacyRequired: true,
            wheelchairAccessible: true,
            notes: 'Acoustically sealed single-person video call booths',
          },
        ],
        relationships: [
          {
            id: 'rel-off-1',
            sourceSpaceId: 'sp-kitchen-social',
            targetSpaceId: 'sp-boardroom',
            relationType: 'acoustic-isolated',
            priority: 'mandatory',
            notes: 'Social hub noise must not intrude into client board presentations',
          },
        ],
      },
    },
  ];
}

/**
 * Initializes or normalizes the architectural brief on a project.
 * Preserves existing user inputs and provides intelligent baseline defaults.
 */
export function initializeProjectBrief(project: Project): ArchitecturalBriefData {
  const existing = project.brief;
  const unit = project.unit;
  const areas = getDefaultSpaceAreas(unit);

  // If already present, ensure all structured fields exist cleanly
  if (existing && existing.spaces && existing.spaces.length > 0) {
    return {
      version: existing.version || BRIEF_ENGINE_VERSION,
      lastUpdated: existing.lastUpdated || project.updatedAt || new Date().toISOString(),
      approvalStatus: existing.approvalStatus || 'draft',
      approvalSignoff: existing.approvalSignoff,
      objectives: {
        primaryPurpose: existing.objectives?.primaryPurpose || `${project.name} Architectural Program`,
        buildingUse: existing.objectives?.buildingUse || (project.projectType === 'apartment' ? 'residential' : 'residential'),
        customBuildingUse: existing.objectives?.customBuildingUse,
        intendedUsers: existing.objectives?.intendedUsers || 'Occupants and invited guests',
        mainActivities: existing.objectives?.mainActivities || 'Residential living, relaxation, cooking, sleeping',
        desiredOutcomes: existing.objectives?.desiredOutcomes || 'Optimised spatial efficiency, high environmental comfort, compliance with zoning constraints',
        targetBudget: existing.objectives?.targetBudget ?? project.budget,
        projectStage: existing.objectives?.projectStage || 'Schematic Design',
        designLifeYears: existing.objectives?.designLifeYears ?? 50,
      },
      occupancy: {
        regularOccupants: existing.occupancy?.regularOccupants ?? (project.rooms.bedrooms ? project.rooms.bedrooms * 2 : 4),
        occasionalVisitors: existing.occupancy?.occasionalVisitors ?? 2,
        occupancyPattern: existing.occupancy?.occupancyPattern || 'Permanent year-round residential occupancy',
        userGroupNeeds: existing.occupancy?.userGroupNeeds || 'Family multi-generational accommodation with dedicated private zones',
        futureExpansionNeeds: existing.occupancy?.futureExpansionNeeds || 'Adaptable spatial layout to allow future re-partitioning',
        accessibilityNotes: existing.occupancy?.accessibilityNotes || 'Standard level access on ground floor and accessible circulation paths',
      },
      preferences: {
        spatialCharacter: existing.preferences?.spatialCharacter || 'Contemporary open-plan living with distinct quiet zones',
        indoorOutdoorRelationship: existing.preferences?.indoorOutdoorRelationship || 'Seamless threshold connection to garden and outdoor living areas',
        naturalLightPriorities: existing.preferences?.naturalLightPriorities || 'Direct solar ingress in living rooms; diffuse natural daylight in workspaces',
        storagePriorities: existing.preferences?.storagePriorities || 'Integrated built-in cabinetry to maximise usable floor clear space',
        circulationPreferences: existing.preferences?.circulationPreferences || 'Compact central circulation core to reduce dedicated corridor area',
        materialPreferences: existing.preferences?.materialPreferences || 'Durable, natural, low-maintenance architectural materials',
      },
      constraints: {
        siteRestrictionsSummary: existing.constraints?.siteRestrictionsSummary || (project.siteContext?.generalNotes || project.siteContext?.setbacks?.notes || 'Governed by project plot boundary and setback allowances'),
        structuralAssumptions: existing.constraints?.structuralAssumptions || 'Engineered timber or reinforced concrete frame construction',
        knownMandatoryRequirements: existing.constraints?.knownMandatoryRequirements || [
          'Habitable rooms must receive direct natural light and ventilation',
          'Sanitary facilities must have accessible clearances',
        ],
        budgetCapKnown: existing.constraints?.budgetCapKnown ?? project.budget,
        accessibilityMandatory: existing.constraints?.accessibilityMandatory ?? true,
        sustainabilityGoals: existing.constraints?.sustainabilityGoals || 'Energy efficient thermal envelope and low-carbon construction materials',
        unresolvedQuestions: existing.constraints?.unresolvedQuestions || [],
      },
      spaces: existing.spaces.map((sp, idx) => ({
        ...sp,
        id: sp.id || `space-${idx + 1}`,
        quantity: typeof sp.quantity === 'number' && sp.quantity > 0 ? sp.quantity : 1,
        priority: sp.priority || 'mandatory',
        privacyLevel: sp.privacyLevel || 'semi-private',
      })),
      relationships: existing.relationships || [],
      circulationWallAllowancePercent: existing.circulationWallAllowancePercent ?? 15,
      revisions: existing.revisions || [
        {
          id: 'rev-init',
          versionNumber: 1,
          timestamp: project.createdAt || new Date().toISOString(),
          author: 'Plotify Architecture Engine',
          summaryOfChanges: 'Initial baseline brief synthesis',
          approvalStatus: existing.approvalStatus || 'draft',
        },
      ],
      interpretedBrief: existing.interpretedBrief,
    };
  }

  // Generate intelligent initial brief based on project's room config and type
  const generatedSpaces: SpaceRequirement[] = [];
  let spaceIndex = 1;

  // Living Room
  const livingQty = project.rooms.livingRoom || 1;
  generatedSpaces.push({
    id: `req-living-${spaceIndex++}`,
    name: 'Living Lounge & Gathering',
    category: 'living',
    targetArea: areas.living,
    minArea: Math.round(areas.living * 0.8),
    maxArea: Math.round(areas.living * 1.3),
    quantity: livingQty,
    floorPreference: 1,
    priority: 'mandatory',
    privacyLevel: 'public',
    occupantCapacity: 6,
    naturalLightRequired: true,
    plumbingRequired: false,
    outdoorAccessRequired: true,
    acousticPrivacyRequired: true,
    wheelchairAccessible: true,
    notes: 'Primary social hub with outdoor visual connection',
  });

  // Kitchen
  const kitchenQty = project.rooms.kitchen || 1;
  generatedSpaces.push({
    id: `req-kitchen-${spaceIndex++}`,
    name: 'Kitchen & Meal Preparation',
    category: 'service',
    targetArea: areas.kitchen,
    minArea: Math.round(areas.kitchen * 0.85),
    maxArea: Math.round(areas.kitchen * 1.25),
    quantity: kitchenQty,
    floorPreference: 1,
    priority: 'mandatory',
    privacyLevel: 'semi-private',
    occupantCapacity: 4,
    naturalLightRequired: true,
    plumbingRequired: true,
    outdoorAccessRequired: false,
    acousticPrivacyRequired: false,
    wheelchairAccessible: true,
    notes: 'Culinary prep, cooktop ventilation, food storage pantry zone',
  });

  // Dining Room
  if (project.rooms.diningRoom && project.rooms.diningRoom > 0) {
    generatedSpaces.push({
      id: `req-dining-${spaceIndex++}`,
      name: 'Formal Dining Area',
      category: 'living',
      targetArea: areas.dining,
      minArea: Math.round(areas.dining * 0.85),
      maxArea: Math.round(areas.dining * 1.3),
      quantity: project.rooms.diningRoom,
      floorPreference: 1,
      priority: 'high-priority',
      privacyLevel: 'semi-private',
      occupantCapacity: 8,
      naturalLightRequired: true,
      plumbingRequired: false,
      outdoorAccessRequired: false,
      acousticPrivacyRequired: false,
      wheelchairAccessible: true,
      notes: 'Dedicated seating area for family and guest meals',
    });
  }

  // Master Bedroom
  const totalBedrooms = project.rooms.bedrooms || 3;
  generatedSpaces.push({
    id: `req-masterbed-${spaceIndex++}`,
    name: 'Master Bedroom Suite',
    category: 'sleeping',
    targetArea: areas.masterBedroom,
    minArea: Math.round(areas.masterBedroom * 0.85),
    maxArea: Math.round(areas.masterBedroom * 1.3),
    quantity: 1,
    floorPreference: project.floors > 1 ? 2 : 1,
    priority: 'mandatory',
    privacyLevel: 'private',
    occupantCapacity: 2,
    naturalLightRequired: true,
    plumbingRequired: false,
    outdoorAccessRequired: false,
    acousticPrivacyRequired: true,
    wheelchairAccessible: true,
    notes: 'Principal retreat with wardrobe space and acoustic separation',
  });

  // Secondary Bedrooms
  if (totalBedrooms > 1) {
    generatedSpaces.push({
      id: `req-secbeds-${spaceIndex++}`,
      name: 'Secondary Bedrooms',
      category: 'sleeping',
      targetArea: areas.bedroom,
      minArea: Math.round(areas.bedroom * 0.85),
      maxArea: Math.round(areas.bedroom * 1.25),
      quantity: totalBedrooms - 1,
      floorPreference: project.floors > 1 ? 2 : 'any',
      priority: 'mandatory',
      privacyLevel: 'private',
      occupantCapacity: 1,
      naturalLightRequired: true,
      plumbingRequired: false,
      outdoorAccessRequired: false,
      acousticPrivacyRequired: true,
      wheelchairAccessible: true,
      notes: 'Bedrooms for children, family members or guests',
    });
  }

  // Bathrooms
  const totalBaths = project.rooms.bathrooms || 2;
  generatedSpaces.push({
    id: `req-bathrooms-${spaceIndex++}`,
    name: 'Full Bathroom',
    category: 'hygiene',
    targetArea: areas.familyBath,
    minArea: Math.round(areas.familyBath * 0.85),
    maxArea: Math.round(areas.familyBath * 1.3),
    quantity: totalBaths,
    floorPreference: 'any',
    priority: 'mandatory',
    privacyLevel: 'private',
    occupantCapacity: 1,
    naturalLightRequired: true,
    plumbingRequired: true,
    outdoorAccessRequired: false,
    acousticPrivacyRequired: true,
    wheelchairAccessible: true,
    notes: 'Sanitary facilities with water closets, washbasins, and shower/tub',
  });

  // Home Office / Study
  if (project.rooms.homeOffice && project.rooms.homeOffice > 0) {
    generatedSpaces.push({
      id: `req-office-${spaceIndex++}`,
      name: 'Home Office / Study',
      category: 'work',
      targetArea: areas.homeOffice,
      minArea: Math.round(areas.homeOffice * 0.8),
      maxArea: Math.round(areas.homeOffice * 1.3),
      quantity: project.rooms.homeOffice,
      floorPreference: 'any',
      priority: 'high-priority',
      privacyLevel: 'private',
      occupantCapacity: 2,
      naturalLightRequired: true,
      plumbingRequired: false,
      outdoorAccessRequired: false,
      acousticPrivacyRequired: true,
      wheelchairAccessible: true,
      notes: 'Quiet workspace with natural daylight and power/data',
    });
  }

  // Balcony / Terrace
  if (project.rooms.balcony && project.rooms.balcony > 0) {
    generatedSpaces.push({
      id: `req-balcony-${spaceIndex++}`,
      name: 'Balcony / Covered Terrace',
      category: 'outdoor',
      targetArea: areas.balcony,
      minArea: Math.round(areas.balcony * 0.75),
      maxArea: Math.round(areas.balcony * 1.5),
      quantity: project.rooms.balcony,
      floorPreference: project.floors > 1 ? 2 : 1,
      priority: 'preferred',
      privacyLevel: 'semi-private',
      occupantCapacity: 4,
      naturalLightRequired: true,
      plumbingRequired: false,
      outdoorAccessRequired: true,
      acousticPrivacyRequired: false,
      wheelchairAccessible: true,
      notes: 'Outdoor amenity space with parapet or safety railing',
    });
  }

  // Garage
  if (project.rooms.garage && project.rooms.garage > 0) {
    generatedSpaces.push({
      id: `req-garage-${spaceIndex++}`,
      name: 'Enclosed Garage / Vehicle Bay',
      category: 'service',
      targetArea: areas.garage,
      minArea: Math.round(areas.garage * 0.9),
      maxArea: Math.round(areas.garage * 1.4),
      quantity: project.rooms.garage,
      floorPreference: 1,
      priority: 'high-priority',
      privacyLevel: 'service-access' as any,
      occupantCapacity: 1,
      naturalLightRequired: false,
      plumbingRequired: false,
      outdoorAccessRequired: true,
      acousticPrivacyRequired: true,
      wheelchairAccessible: true,
      notes: 'Secure vehicle storage and workshop area',
    });
  }

  // Storage / Laundry
  if (project.rooms.laundry && project.rooms.laundry > 0) {
    generatedSpaces.push({
      id: `req-laundry-${spaceIndex++}`,
      name: 'Laundry & Utility Room',
      category: 'service',
      targetArea: areas.laundry,
      minArea: Math.round(areas.laundry * 0.8),
      maxArea: Math.round(areas.laundry * 1.3),
      quantity: project.rooms.laundry,
      floorPreference: 1,
      priority: 'preferred',
      privacyLevel: 'private',
      occupantCapacity: 1,
      naturalLightRequired: false,
      plumbingRequired: true,
      outdoorAccessRequired: false,
      acousticPrivacyRequired: true,
      wheelchairAccessible: true,
      notes: 'Washing machine, dryer, linen sorting and sink',
    });
  }

  // Custom rooms if any
  if (project.rooms.customRooms && project.rooms.customRooms.length > 0) {
    for (const cr of project.rooms.customRooms) {
      if (cr.count > 0) {
        generatedSpaces.push({
          id: `req-custom-${spaceIndex++}`,
          name: cr.name,
          category: 'specialized',
          targetArea: areas.homeOffice,
          quantity: cr.count,
          floorPreference: 'any',
          priority: 'preferred',
          privacyLevel: 'semi-private',
          naturalLightRequired: true,
          plumbingRequired: false,
          outdoorAccessRequired: false,
          acousticPrivacyRequired: false,
          wheelchairAccessible: true,
          notes: 'User-specified project space requirement',
        });
      }
    }
  }

  // Basic relationships
  const relationships: SpatialRelationshipRule[] = [
    {
      id: 'rel-gen-1',
      sourceSpaceId: generatedSpaces[0]?.id || 'req-living-1',
      targetSpaceId: generatedSpaces[1]?.id || 'req-kitchen-2',
      relationType: 'adjacent',
      priority: 'high-priority',
      notes: 'Proximity between living social zone and meal preparation',
    },
  ];

  return {
    version: BRIEF_ENGINE_VERSION,
    lastUpdated: new Date().toISOString(),
    approvalStatus: 'draft',
    objectives: {
      primaryPurpose: `${project.name} Architectural Program`,
      buildingUse: project.projectType === 'apartment' ? 'residential' : 'residential',
      intendedUsers: `Family of ${totalBedrooms + 1} occupants`,
      mainActivities: 'Residential family living, cooking, sleeping, studying, gathering',
      desiredOutcomes: 'Generous natural light, functional room proportions, seamless spatial flow',
      targetBudget: project.budget,
      projectStage: project.status || 'Schematic Design',
      designLifeYears: 50,
    },
    occupancy: {
      regularOccupants: totalBedrooms + 1,
      occasionalVisitors: 2,
      occupancyPattern: 'Year-round full-time residential use',
      userGroupNeeds: 'Private sleeping quarters paired with expansive communal social zones',
      futureExpansionNeeds: 'Flexible rooms to accommodate growing family lifecycle',
      accessibilityNotes: 'Step-free ground floor access and universal circulation clearances',
    },
    preferences: {
      spatialCharacter: 'Balanced contemporary layout with distinct public social and private rest zones',
      indoorOutdoorRelationship: 'Living spaces oriented toward prime garden or courtyard aspects',
      naturalLightPriorities: 'Primary living areas positioned for direct sunlight ingress',
      storagePriorities: 'Adequate built-in closet and pantry storage to keep living spaces clear',
      circulationPreferences: 'Efficient hallway layout to preserve net room areas',
      materialPreferences: 'Modern architectural finishes with acoustic comfort',
    },
    constraints: {
      siteRestrictionsSummary: `Plot dimensions: ${project.plotWidth} x ${project.plotLength} ${project.unit}. Street frontage: ${project.roadFacing}.`,
      structuralAssumptions: 'Standard residential frame construction suitable for local climate',
      knownMandatoryRequirements: [
        'Habitable bedrooms must provide operable windows and exterior daylight',
        'Wet areas must include compliant drainage and moisture sealing',
      ],
      budgetCapKnown: project.budget,
      accessibilityMandatory: true,
      sustainabilityGoals: 'Good thermal envelope performance and cross-ventilation',
      unresolvedQuestions: [],
    },
    spaces: generatedSpaces,
    relationships,
    circulationWallAllowancePercent: 15,
    revisions: [
      {
        id: 'rev-init',
        versionNumber: 1,
        timestamp: new Date().toISOString(),
        author: 'Plotify Architecture Engine',
        summaryOfChanges: 'Synthesized architectural brief and space schedule from project parameters',
        approvalStatus: 'draft',
      },
    ],
  };
}

/**
 * Calculates deterministic space program totals and verifies footprint fit against plot bounds.
 */
export function calculateSpaceProgramSummary(
  project: Project,
  brief: ArchitecturalBriefData
): SpaceProgramSummary {
  let totalTargetNetArea = 0;
  let minProgramArea = 0;
  let maxProgramArea = 0;
  let mandatoryTargetArea = 0;
  let highPriorityTargetArea = 0;
  let preferredTargetArea = 0;
  let optionalTargetArea = 0;
  let mandatorySpaceCount = 0;

  const spaces = brief.spaces || [];

  for (const sp of spaces) {
    const qty = sp.quantity > 0 ? sp.quantity : 1;
    const spaceNetTarget = sp.targetArea * qty;
    const spaceMin = (sp.minArea ?? sp.targetArea * 0.85) * qty;
    const spaceMax = (sp.maxArea ?? sp.targetArea * 1.25) * qty;

    totalTargetNetArea += spaceNetTarget;
    minProgramArea += spaceMin;
    maxProgramArea += spaceMax;

    switch (sp.priority) {
      case 'mandatory':
        mandatoryTargetArea += spaceNetTarget;
        mandatorySpaceCount += qty;
        break;
      case 'high-priority':
        highPriorityTargetArea += spaceNetTarget;
        break;
      case 'preferred':
        preferredTargetArea += spaceNetTarget;
        break;
      case 'optional':
        optionalTargetArea += spaceNetTarget;
        break;
    }
  }

  const circPercent = brief.circulationWallAllowancePercent ?? 15;
  const estimatedCirculationWallArea = Math.round(totalTargetNetArea * (circPercent / 100));
  const estimatedGrossInternalArea = totalTargetNetArea + estimatedCirculationWallArea;

  const plotArea = project.plotWidth * project.plotLength;
  const floors = project.floors > 0 ? project.floors : 1;

  // Compute allowable footprint based on site setback envelope or standard 60% ground coverage rule
  let maxCoverageRatio = 0.60;
  if (project.siteContext?.setbacks && project.plotWidth > 0 && project.plotLength > 0) {
    const sb = project.siteContext.setbacks;
    const buildableW = Math.max(0, project.plotWidth - (sb.sideLeft + sb.sideRight));
    const buildableL = Math.max(0, project.plotLength - (sb.front + sb.rear));
    const envelopeArea = buildableW * buildableL;
    if (envelopeArea > 0 && plotArea > 0) {
      maxCoverageRatio = Math.min(0.70, envelopeArea / plotArea);
    }
  }

  const maxAllowableFootprintArea = Math.round(plotArea * maxCoverageRatio);
  const maxAllowableGrossArea = maxAllowableFootprintArea * floors;

  // Footprint fit status
  let footprintFitStatus: 'fits' | 'tight' | 'exceeds' | 'unverified' = 'fits';
  if (plotArea <= 0) {
    footprintFitStatus = 'unverified';
  } else if (estimatedGrossInternalArea > maxAllowableGrossArea) {
    footprintFitStatus = 'exceeds';
  } else if (estimatedGrossInternalArea > maxAllowableGrossArea * 0.90) {
    footprintFitStatus = 'tight';
  } else {
    footprintFitStatus = 'fits';
  }

  return {
    totalTargetNetArea: Math.round(totalTargetNetArea * 10) / 10,
    minProgramArea: Math.round(minProgramArea * 10) / 10,
    maxProgramArea: Math.round(maxProgramArea * 10) / 10,
    mandatoryTargetArea: Math.round(mandatoryTargetArea * 10) / 10,
    highPriorityTargetArea: Math.round(highPriorityTargetArea * 10) / 10,
    preferredTargetArea: Math.round(preferredTargetArea * 10) / 10,
    optionalTargetArea: Math.round(optionalTargetArea * 10) / 10,
    circulationWallAllowancePercent: circPercent,
    estimatedCirculationWallArea,
    estimatedGrossInternalArea,
    availablePlotArea: plotArea,
    maxAllowableFootprintArea,
    maxAllowableGrossArea,
    footprintFitStatus,
    totalSpaceCount: spaces.reduce((acc, s) => acc + (s.quantity || 1), 0),
    mandatorySpaceCount,
  };
}

/**
 * Reconciles architectural brief requirements against placed 2D floor plan rooms.
 * Deterministically maps placed rooms by type/category and calculates area variances.
 */
export function compareBriefWithFloorPlan(
  project: Project,
  brief: ArchitecturalBriefData
): SpacePlacementComparison[] {
  const placedRooms: FloorPlanRoom[] = project.floorPlan?.rooms || [];
  const comparisons: SpacePlacementComparison[] = [];
  const assignedRoomIds = new Set<string>();

  // Map each brief space
  for (const sp of brief.spaces) {
    const requiredQty = sp.quantity || 1;
    const targetAreaEach = sp.targetArea;
    const targetTotalArea = targetAreaEach * requiredQty;

    // Find placed rooms matching this space category or name keyword
    const matched: FloorPlanRoom[] = [];
    const nameLower = sp.name.toLowerCase();

    for (const room of placedRooms) {
      if (assignedRoomIds.has(room.id)) continue;

      const roomNameLower = room.name.toLowerCase();
      const roomTypeLower = room.type.toLowerCase();

      let isMatch = false;

      // Exact or sub-phrase match in name
      if (
        roomNameLower.includes(nameLower) ||
        nameLower.includes(roomNameLower)
      ) {
        isMatch = true;
      }
      // Category match
      else if (sp.category === 'sleeping' && (roomTypeLower.includes('bed') || roomNameLower.includes('bed'))) {
        isMatch = true;
      } else if (sp.category === 'living' && (roomTypeLower.includes('liv') || roomNameLower.includes('liv'))) {
        isMatch = true;
      } else if (sp.category === 'hygiene' && (roomTypeLower.includes('bath') || roomTypeLower.includes('wc') || roomNameLower.includes('bath'))) {
        isMatch = true;
      } else if (sp.category === 'service' && (roomTypeLower.includes('kitchen') || roomNameLower.includes('kitchen') || roomTypeLower.includes('garage') || roomTypeLower.includes('laundry'))) {
        if (nameLower.includes(roomTypeLower) || roomNameLower.includes(nameLower)) {
          isMatch = true;
        }
      } else if (sp.category === 'work' && (roomTypeLower.includes('office') || roomNameLower.includes('office') || roomNameLower.includes('study'))) {
        isMatch = true;
      } else if (sp.category === 'outdoor' && (roomTypeLower.includes('balcony') || roomNameLower.includes('balcony') || roomNameLower.includes('terrace'))) {
        isMatch = true;
      }

      if (isMatch) {
        matched.push(room);
        assignedRoomIds.add(room.id);
        if (matched.length >= requiredQty) {
          break; // Matched enough for this specification
        }
      }
    }

    const placedQuantity = matched.length;
    const actualPlacedTotalArea = matched.reduce((sum, r) => sum + r.width * r.length, 0);
    const areaDelta = Math.round((actualPlacedTotalArea - targetTotalArea) * 10) / 10;
    const areaVariancePercent = targetTotalArea > 0
      ? Math.round(((actualPlacedTotalArea - targetTotalArea) / targetTotalArea) * 100)
      : 0;

    let placementStatus: 'unplaced' | 'partially-placed' | 'fully-placed' | 'over-allocated' = 'unplaced';
    if (placedQuantity === 0) {
      placementStatus = 'unplaced';
    } else if (placedQuantity < requiredQty) {
      placementStatus = 'partially-placed';
    } else if (placedQuantity === requiredQty) {
      placementStatus = 'fully-placed';
    } else {
      placementStatus = 'over-allocated';
    }

    comparisons.push({
      spaceRequirementId: sp.id,
      name: sp.name,
      category: sp.category,
      priority: sp.priority,
      requiredQuantity: requiredQty,
      placedQuantity,
      targetAreaEach,
      targetTotalArea,
      actualPlacedTotalArea: Math.round(actualPlacedTotalArea * 10) / 10,
      areaDelta,
      areaVariancePercent,
      placementStatus,
      matchedRoomIds: matched.map((r) => r.id),
    });
  }

  return comparisons;
}

/**
 * Validates the architectural brief against spatial geometry, site limits, and relationships.
 */
export function validateBrief(
  project: Project,
  brief: ArchitecturalBriefData
): BriefValidationNotice[] {
  const notices: BriefValidationNotice[] = [];
  const summary = calculateSpaceProgramSummary(project, brief);
  const comparisons = compareBriefWithFloorPlan(project, brief);
  const placedRooms = project.floorPlan?.rooms || [];

  // 1. Mandatory unplaced rooms
  for (const comp of comparisons) {
    if (comp.priority === 'mandatory' && comp.placedQuantity === 0) {
      notices.push({
        id: `notice-unplaced-${comp.spaceRequirementId}`,
        type: 'unplaced-mandatory',
        severity: 'conflict',
        title: `Mandatory Space Missing: ${comp.name}`,
        message: `The brief designates "${comp.name}" as Mandatory, but no corresponding room is placed on the 2D floor plan.`,
        affectedSpaceIds: [comp.spaceRequirementId],
        suggestedAction: `Open the 2D Floor Plan editor and place ${comp.requiredQuantity} room(s) for "${comp.name}", or adjust brief priority if requirements have changed.`,
      });
    } else if (comp.priority === 'mandatory' && comp.placedQuantity < comp.requiredQuantity) {
      notices.push({
        id: `notice-partial-${comp.spaceRequirementId}`,
        type: 'unplaced-mandatory',
        severity: 'warning',
        title: `Partial Mandatory Placement: ${comp.name}`,
        message: `Required quantity is ${comp.requiredQuantity}, but only ${comp.placedQuantity} room(s) have been placed on the floor plan.`,
        affectedSpaceIds: [comp.spaceRequirementId],
        suggestedAction: `Place the remaining ${comp.requiredQuantity - comp.placedQuantity} space(s) on the 2D floor plan.`,
      });
    }
  }

  // 2. Significant Area Discrepancies on Placed Rooms
  for (const comp of comparisons) {
    if (comp.placedQuantity > 0 && comp.targetTotalArea > 0) {
      if (comp.areaVariancePercent < -20) {
        notices.push({
          id: `notice-area-shortfall-${comp.spaceRequirementId}`,
          type: 'area-shortfall',
          severity: comp.priority === 'mandatory' ? 'conflict' : 'warning',
          title: `Area Shortfall: ${comp.name} (${comp.areaVariancePercent}%)`,
          message: `Placed room total area is ${comp.actualPlacedTotalArea} ${project.unit === 'feet' ? 'sq ft' : 'm²'}, which is ${Math.abs(comp.areaVariancePercent)}% smaller than the target ${comp.targetTotalArea} ${project.unit === 'feet' ? 'sq ft' : 'm²'}.`,
          affectedSpaceIds: [comp.spaceRequirementId],
          suggestedAction: `Resize placed room geometry in the 2D editor to meet the minimum usable threshold.`,
        });
      } else if (comp.areaVariancePercent > 35) {
        notices.push({
          id: `notice-area-excess-${comp.spaceRequirementId}`,
          type: 'area-excess',
          severity: 'info',
          title: `Area Surplus: ${comp.name} (+${comp.areaVariancePercent}%)`,
          message: `Placed area is ${comp.actualPlacedTotalArea} ${project.unit === 'feet' ? 'sq ft' : 'm²'}, exceeding the target by ${comp.areaVariancePercent}%. Verify if this allocation impacts other programmed spaces.`,
          affectedSpaceIds: [comp.spaceRequirementId],
          suggestedAction: `Review room dimensions against project budget and overall allowable floor area.`,
        });
      }
    }
  }

  // 3. Program Gross Area vs Allowable Site Capacity
  if (summary.footprintFitStatus === 'exceeds' && summary.maxAllowableGrossArea) {
    notices.push({
      id: 'notice-capacity-exceeded',
      type: 'capacity-exceeded',
      severity: 'conflict',
      title: 'Program Exceeds Site Allowable Floor Area',
      message: `The estimated Gross Internal Area (${summary.estimatedGrossInternalArea} ${project.unit === 'feet' ? 'sq ft' : 'm²'}) exceeds the maximum allowable building area (${summary.maxAllowableGrossArea} ${project.unit === 'feet' ? 'sq ft' : 'm²'}) across ${project.floors} floor(s).`,
      suggestedAction: `Consider reducing optional/preferred space targets, increasing floor count, or verifying local zoning FAR limits.`,
    });
  } else if (summary.footprintFitStatus === 'tight' && summary.maxAllowableGrossArea) {
    notices.push({
      id: 'notice-capacity-tight',
      type: 'capacity-exceeded',
      severity: 'warning',
      title: 'Program Approaches Allowable Floor Area Limit',
      message: `The estimated Gross Internal Area is within 10% of maximum allowable building capacity (${summary.estimatedGrossInternalArea} / ${summary.maxAllowableGrossArea} ${project.unit === 'feet' ? 'sq ft' : 'm²'}).`,
      suggestedAction: `Carefully manage circulation and wall thickness allowances during detailed floor plan layout.`,
    });
  }

  // 4. Spatial Relationship and Separation Checks
  if (brief.relationships && brief.relationships.length > 0 && placedRooms.length > 1) {
    const spaceIdToRoom = new Map<string, FloorPlanRoom>();
    for (const comp of comparisons) {
      if (comp.matchedRoomIds.length > 0) {
        const room = placedRooms.find((r) => r.id === comp.matchedRoomIds[0]);
        if (room) spaceIdToRoom.set(comp.spaceRequirementId, room);
      }
    }

    for (const rel of brief.relationships) {
      const roomA = spaceIdToRoom.get(rel.sourceSpaceId);
      const roomB = spaceIdToRoom.get(rel.targetSpaceId);

      if (roomA && roomB) {
        // Direct Access or Adjacent requires same floor level
        if (
          (rel.relationType === 'direct-access' || rel.relationType === 'adjacent') &&
          roomA.floorLevel !== roomB.floorLevel
        ) {
          notices.push({
            id: `notice-rel-floor-${rel.id}`,
            type: 'adjacency-conflict',
            severity: rel.priority === 'mandatory' ? 'conflict' : 'warning',
            title: `Adjacency Floor Mismatch`,
            message: `"${roomA.name}" (Floor ${roomA.floorLevel}) and "${roomB.name}" (Floor ${roomB.floorLevel}) are marked as ${rel.relationType.toUpperCase()}, but placed on different levels.`,
            affectedSpaceIds: [rel.sourceSpaceId, rel.targetSpaceId],
            suggestedAction: `Move both rooms to the same floor or adjust the brief relationship to reflect multi-level vertical connection.`,
          });
        }

        // Separated / Acoustic Isolated rooms placed touching or overlapping
        if (
          (rel.relationType === 'separated' || rel.relationType === 'acoustic-isolated') &&
          roomA.floorLevel === roomB.floorLevel
        ) {
          // Check Euclidean distance between room centers
          const centerAX = roomA.x + roomA.width / 2;
          const centerAY = roomA.y + roomA.length / 2;
          const centerBX = roomB.x + roomB.width / 2;
          const centerBY = roomB.y + roomB.length / 2;
          const dist = Math.sqrt(Math.pow(centerAX - centerBX, 2) + Math.pow(centerAY - centerBY, 2));
          const threshold = (Math.max(roomA.width, roomA.length) + Math.max(roomB.width, roomB.length)) * 0.45;

          if (dist < threshold) {
            notices.push({
              id: `notice-rel-proximity-${rel.id}`,
              type: 'adjacency-conflict',
              severity: 'warning',
              title: `Acoustic / Visual Separation Required`,
              message: `"${roomA.name}" and "${roomB.name}" are placed directly adjacent on Floor ${roomA.floorLevel}, but the brief specifies ${rel.relationType.toUpperCase()}.`,
              affectedSpaceIds: [rel.sourceSpaceId, rel.targetSpaceId],
              suggestedAction: `Introduce a buffer corridor, utility zone, or acoustic-rated partition wall.`,
            });
          }
        }
      }
    }
  }

  // 5. Unresolved brief questions
  if (brief.constraints?.unresolvedQuestions && brief.constraints.unresolvedQuestions.length > 0) {
    for (let i = 0; i < brief.constraints.unresolvedQuestions.length; i++) {
      const q = brief.constraints.unresolvedQuestions[i];
      if (q.trim()) {
        notices.push({
          id: `notice-unresolved-${i}`,
          type: 'unresolved-question',
          severity: 'info',
          title: `Unresolved Clarification`,
          message: q,
          suggestedAction: `Confirm this design requirement with the client or local authorities before freezing the brief.`,
        });
      }
    }
  }

  // 6. Regulatory Code Minimum Space Checks (Prompt 13 Integration)
  const minHabitableArea = project.unit === 'metres' ? 6.5 : 70;
  for (const sp of brief.spaces) {
    if (
      (sp.category === 'sleeping' || sp.category === 'living') &&
      sp.targetArea > 0 &&
      sp.targetArea < minHabitableArea
    ) {
      notices.push({
        id: `notice-reg-min-area-${sp.id}`,
        type: 'regulatory-code-notice',
        severity: 'conflict',
        title: `Brief Target Below Statutory Minimum (IRC R304.1)`,
        message: `Space "${sp.name}" has target area of ${sp.targetArea} ${project.unit === 'feet' ? 'sq ft' : 'm²'}, which is below the statutory ${minHabitableArea} ${project.unit === 'feet' ? 'sq ft' : 'm²'} minimum for habitable living spaces.`,
        affectedSpaceIds: [sp.id],
        suggestedAction: `Increase target area to at least ${minHabitableArea} ${project.unit === 'feet' ? 'sq ft' : 'm²'} to ensure building regulation compliance.`,
      });
    }
  }

  return notices;
}

/**
 * Creates a new revision record in the brief history.
 */
export function recordBriefRevision(
  brief: ArchitecturalBriefData,
  author: string,
  summaryOfChanges: string,
  status: BriefApprovalStatus
): ArchitecturalBriefData {
  const currentRevs = brief.revisions || [];
  const nextVersion = currentRevs.length + 1;
  const newRev: BriefRevisionRecord = {
    id: `rev-${Date.now()}`,
    versionNumber: nextVersion,
    timestamp: new Date().toISOString(),
    author: author.trim() || 'Project Architect',
    summaryOfChanges: summaryOfChanges.trim() || 'Updated space schedule and project constraints',
    approvalStatus: status,
  };

  return {
    ...brief,
    version: `v${nextVersion}.0`,
    lastUpdated: newRev.timestamp,
    approvalStatus: status,
    revisions: [newRev, ...currentRevs],
  };
}

// ============================================================================
// P30 — AI DESIGN BRIEF INTERPRETER & DETERMINISTIC REQUIREMENTS ENGINE
// ============================================================================

export const VALID_REQUIREMENT_CATEGORIES: RequirementCategory[] = [
  'project-identity',
  'occupancy-household',
  'spaces-program',
  'area-dimensions',
  'floors-circulation',
  'privacy-circulation',
  'accessibility',
  'daylight-ventilation',
  'site-orientation',
  'budget-cost',
  'materials-sustainability',
  'regulatory-safety',
  'other-unclassified',
];

export const P30_COMPLIANCE_DISCLAIMER =
  'Structural validation of this architectural brief confirms internal requirement formatting and completeness only. It does NOT certify that the overall building design complies with statutory building codes, zoning bylaws, structural engineering safety, or contractor tender pricing.';

const WORD_TO_NUM: Record<string, number> = {
  one: 1,
  single: 1,
  a: 1,
  an: 1,
  two: 2,
  double: 2,
  couple: 2,
  twin: 2,
  three: 3,
  triple: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function parseNumberToken(token: string | undefined): number | null {
  if (!token) return null;
  const cleaned = token.trim().toLowerCase().replace(/,/g, '');
  if (WORD_TO_NUM[cleaned] !== undefined) return WORD_TO_NUM[cleaned];
  const num = Number(cleaned);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * Normalizes an arbitrary category string into a valid RequirementCategory.
 * Unknown or unsupported categories safely fall back to 'other-unclassified'.
 */
export function normalizeRequirementCategory(rawCategory: unknown): RequirementCategory {
  if (typeof rawCategory !== 'string') return 'other-unclassified';
  const normalized = rawCategory.trim().toLowerCase() as RequirementCategory;
  if (VALID_REQUIREMENT_CATEGORIES.includes(normalized)) {
    return normalized;
  }
  return 'other-unclassified';
}

/**
 * Stage 1: Input Normalization & Sanitization
 * Removes unsafe HTML/script tags and control characters while preserving user text.
 */
export function normalizeBriefInput(rawText: string): string {
  if (typeof rawText !== 'string') return '';
  return rawText
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectSentencePriority(clause: string): RequirementPriority {
  const lower = clause.toLowerCase();
  if (
    /\b(optional|nice to have|nice-to-have|if budget allows|if space allows|bonus)\b/.test(lower)
  ) {
    return 'optional';
  }
  if (
    /\b(prefer|preferred|ideally|would like|desirable|wish|good to have)\b/.test(lower)
  ) {
    return 'preferred';
  }
  return 'must-have';
}

/**
 * Maps P30 RequirementPriority to existing Plotify BriefPriority.
 */
export function mapToBriefPriority(priority: RequirementPriority): BriefPriority {
  switch (priority) {
    case 'must-have':
      return 'mandatory';
    case 'preferred':
      return 'preferred';
    case 'optional':
      return 'optional';
    default:
      return 'mandatory';
  }
}

/**
 * Stage 2: Deterministic Requirement Extraction from Natural Language
 */
export function extractBriefRequirementsDeterministically(
  rawText: string,
  project?: Partial<Project>
): {
  projectSummary: string;
  requirements: ProjectRequirement[];
  assumptions: BriefAssumption[];
} {
  const normalized = normalizeBriefInput(rawText);
  if (!normalized) {
    throw new Error('Please enter a non-empty project description to interpret.');
  }

  const requirements: ProjectRequirement[] = [];
  const assumptions: BriefAssumption[] = [];
  const defaultUnit = project?.unit === 'metres' ? 'm²' : 'sq ft';
  const defaultLinearUnit = project?.unit === 'metres' ? 'm' : 'ft';
  const areas = getDefaultSpaceAreas(project?.unit || 'feet');

  let reqCounter = 1;
  let assumpCounter = 1;
  const nextReqId = (slug: string) => `req-p30-${slug}-${reqCounter++}`;
  const nextAssumpId = (slug: string) => `assump-p30-${slug}-${assumpCounter++}`;

  const sentences = normalized
    .split(/(?<=[.!?;])\s+|\s*,\s*(?=(?:with|and\s+a|plus|including|featuring|budget|parking|privacy|good|open|separate)\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const lowerFull = normalized.toLowerCase();

  // 1. Project Identity & Building Use
  const buildingTypePatterns: Array<{ regex: RegExp; label: string; use: BuildingUseClassification }> = [
    { regex: /\b(family\s+house|family\s+home|residence|villa|detached\s+house|bungalow|cottage|house|home)\b/i, label: 'Single-Family Residence / House', use: 'residential' },
    { regex: /\b(townhouse|duplex|row\s+house)\b/i, label: 'Townhouse / Multi-Level Residence', use: 'residential' },
    { regex: /\b(apartment|penthouse|flat|condo|studio\s+apartment)\b/i, label: 'Apartment / Multi-Family Unit', use: 'residential' },
    { regex: /\b(live[-\s]?work|mixed[-\s]?use)\b/i, label: 'Mixed-Use / Live-Work Building', use: 'mixed-use' },
    { regex: /\b(office\s+building|headquarters|coworking|workspace|commercial\s+office)\b/i, label: 'Workplace / Office Building', use: 'workplace-office' },
    { regex: /\b(retail|shop|showroom|boutique|cafe|restaurant)\b/i, label: 'Retail / Commercial Space', use: 'retail-commercial' },
    { regex: /\b(school|library|gallery|museum|community\s+center|clinic)\b/i, label: 'Cultural / Educational / Civic Facility', use: 'cultural-educational' },
  ];

  let matchedBuildingLabel = '';
  for (const pat of buildingTypePatterns) {
    const m = normalized.match(pat.regex);
    if (m) {
      matchedBuildingLabel = pat.label;
      requirements.push({
        id: nextReqId('use'),
        category: 'project-identity',
        description: `Building Typology: ${pat.label}`,
        normalizedValue: pat.use,
        priority: 'must-have',
        source: 'explicit',
        reviewStatus: 'confirmed',
        confidence: 'high',
        sourceExcerpt: m[0],
        validationStatus: 'valid',
      });
      break;
    }
  }

  // 2. Floors / Storeys
  const floorMatches = [
    ...normalized.matchAll(
      /\b(one|single|two|double|three|triple|four|1|2|3|4)[-\s]*(storey|story|storeys|stories|floor|floors|level|levels)\b/gi
    ),
  ];
  if (/\bbungalow\b/i.test(normalized) && floorMatches.length === 0) {
    requirements.push({
      id: nextReqId('floors'),
      category: 'floors-circulation',
      description: 'Single-storey (1 floor) bungalow configuration',
      normalizedValue: 1,
      unit: 'floors',
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: 'bungalow',
      validationStatus: 'valid',
    });
  } else {
    for (const fm of floorMatches) {
      const count = parseNumberToken(fm[1]) || 1;
      requirements.push({
        id: nextReqId('floors'),
        category: 'floors-circulation',
        description: `Building height of ${count} floor level(s)`,
        normalizedValue: count,
        unit: 'floors',
        priority: 'must-have',
        source: 'explicit',
        reviewStatus: 'confirmed',
        confidence: 'high',
        sourceExcerpt: fm[0],
        validationStatus: 'valid',
      });
    }
  }

  // 3. Occupants & Household Needs
  const occupantMatch = normalized.match(
    /\b(?:for|accommodating|housing|family\s+of|household\s+of)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(people|persons|occupants|residents|members|adults|workers|employees)\b/i
  ) || normalized.match(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s+(people|persons|occupants|residents|family\s+members)\b/i
  );
  if (occupantMatch) {
    const occCount = parseNumberToken(occupantMatch[1]) || 4;
    requirements.push({
      id: nextReqId('occupants'),
      category: 'occupancy-household',
      description: `Primary occupancy capacity for ${occCount} ${occupantMatch[2].toLowerCase()}`,
      normalizedValue: occCount,
      unit: 'occupants',
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: occupantMatch[0],
      validationStatus: 'valid',
    });
  }

  // 4. Bedrooms (capture all mentions to detect conflicts if multiple different bedroom counts are stated)
  const bedroomMatches = [
    ...normalized.matchAll(
      /\b(one|single|two|three|four|five|six|seven|eight|\d+)[-\s]*(?:bed(?:room)?s?)\b/gi
    ),
  ];
  let totalExplicitBedrooms = 0;
  for (const bm of bedroomMatches) {
    const count = parseNumberToken(bm[1]) || 1;
    totalExplicitBedrooms = count;
    const reqId = nextReqId('bedrooms');
    requirements.push({
      id: reqId,
      category: 'spaces-program',
      description: `${count} Bedroom(s)`,
      normalizedValue: count * areas.bedroom,
      unit: defaultUnit,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: bm[0],
      targetSpaceCategory: 'sleeping',
      quantity: count,
      floorPreference: 'any',
      validationStatus: 'valid',
    });
  }

  // Separate guest area / guest room / guest suite
  const guestMatch = normalized.match(
    /\b(separate\s+guest\s+(?:area|suite|room|wing|quarters)|guest\s+(?:area|suite|room|bedroom))\b/i
  );
  if (guestMatch) {
    const reqId = nextReqId('guest-area');
    requirements.push({
      id: reqId,
      category: 'spaces-program',
      description: 'Separate Guest Area / Suite',
      normalizedValue: areas.bedroom,
      unit: defaultUnit,
      priority: detectSentencePriority(guestMatch[0]),
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: guestMatch[0],
      targetSpaceCategory: 'sleeping',
      quantity: 1,
      floorPreference: 1,
      validationStatus: 'valid',
    });
  }

  // Open kitchen / kitchen
  const kitchenMatch = normalized.match(
    /\b(open[-\s]*plan\s+kitchen|open\s+kitchen|closed\s+kitchen|chef'?s?\s+kitchen|modern\s+kitchen|kitchen(?:\s+and\s+dining)?)\b/i
  );
  if (kitchenMatch) {
    const isOpen = /open/i.test(kitchenMatch[0]);
    const reqId = nextReqId('kitchen');
    requirements.push({
      id: reqId,
      category: 'spaces-program',
      description: isOpen ? 'Open-Plan Kitchen & Culinary Zone' : 'Kitchen & Meal Preparation Area',
      normalizedValue: areas.kitchen,
      unit: defaultUnit,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: kitchenMatch[0],
      targetSpaceCategory: 'service',
      quantity: 1,
      floorPreference: 1,
      validationStatus: 'valid',
    });
  }

  // Living / lounge / family room
  const livingMatch = normalized.match(
    /\b(main\s+living\s+room|living\s+room|family\s+lounge|living\s+area|lounge|great\s+room)\b/i
  );
  if (livingMatch) {
    requirements.push({
      id: nextReqId('living'),
      category: 'spaces-program',
      description: 'Living Room & Social Gathering Space',
      normalizedValue: areas.living,
      unit: defaultUnit,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: livingMatch[0],
      targetSpaceCategory: 'living',
      quantity: 1,
      floorPreference: 1,
      validationStatus: 'valid',
    });
  } else if (matchedBuildingLabel.includes('Residence') || totalExplicitBedrooms > 0) {
    // Infer a living room if a residential house with bedrooms is requested without explicitly naming a living room
    const infLivingId = nextReqId('inferred-living');
    requirements.push({
      id: infLivingId,
      category: 'spaces-program',
      description: 'Inferred Main Living Lounge (Standard Residential Program)',
      normalizedValue: areas.living,
      unit: defaultUnit,
      priority: 'must-have',
      source: 'inferred',
      reviewStatus: 'needs-review',
      confidence: 'medium',
      targetSpaceCategory: 'living',
      quantity: 1,
      floorPreference: 1,
      validationStatus: 'valid',
      clarificationQuestion: 'Should a primary living lounge be included on the ground floor?',
    });
    assumptions.push({
      id: nextAssumpId('living'),
      category: 'spaces-program',
      description: `Assumed 1 Main Living Lounge (${areas.living} ${defaultUnit}) for residential household program.`,
      assumedValue: areas.living,
      unit: defaultUnit,
      rationale: 'Residential family homes typically require a primary communal living space.',
      status: 'pending',
      relatedRequirementId: infLivingId,
    });
  }

  // Dining room
  const diningMatch = normalized.match(/\b(formal\s+dining|dining\s+room|dining\s+area|dining\s+hall)\b/i);
  if (diningMatch) {
    requirements.push({
      id: nextReqId('dining'),
      category: 'spaces-program',
      description: 'Dedicated Dining Area',
      normalizedValue: areas.dining,
      unit: defaultUnit,
      priority: detectSentencePriority(diningMatch[0]),
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: diningMatch[0],
      targetSpaceCategory: 'living',
      quantity: 1,
      floorPreference: 1,
      validationStatus: 'valid',
    });
  }

  // Bathrooms
  const bathMatch = normalized.match(
    /\b(one|two|three|four|five|six|\d+)[-\s]*(?:full\s+)?(?:bath(?:room)?s?|restrooms?|wcs?|ensuites?)\b/i
  );
  if (bathMatch) {
    const bathCount = parseNumberToken(bathMatch[1]) || 2;
    requirements.push({
      id: nextReqId('bathrooms'),
      category: 'spaces-program',
      description: `${bathCount} Bathroom(s)`,
      normalizedValue: bathCount * areas.familyBath,
      unit: defaultUnit,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: bathMatch[0],
      targetSpaceCategory: 'hygiene',
      quantity: bathCount,
      floorPreference: 'any',
      validationStatus: 'valid',
    });
  } else if (totalExplicitBedrooms > 0) {
    const inferredBathCount = Math.max(2, Math.ceil(totalExplicitBedrooms * 0.75));
    const infBathId = nextReqId('inferred-bathrooms');
    requirements.push({
      id: infBathId,
      category: 'spaces-program',
      description: `Inferred ${inferredBathCount} Bathrooms (scaled to ${totalExplicitBedrooms} bedrooms)`,
      normalizedValue: inferredBathCount * areas.familyBath,
      unit: defaultUnit,
      priority: 'must-have',
      source: 'inferred',
      reviewStatus: 'needs-review',
      confidence: 'medium',
      targetSpaceCategory: 'hygiene',
      quantity: inferredBathCount,
      floorPreference: 'any',
      validationStatus: 'valid',
      clarificationQuestion: `How many full bathrooms and powder rooms are required for the ${totalExplicitBedrooms}-bedroom program?`,
    });
    assumptions.push({
      id: nextAssumpId('bathrooms'),
      category: 'spaces-program',
      description: `Assumed ${inferredBathCount} full bathrooms (${areas.familyBath} ${defaultUnit} each) based on ${totalExplicitBedrooms} bedrooms.`,
      assumedValue: inferredBathCount,
      unit: 'spaces',
      rationale: 'Bathroom count was not explicitly stated in the description; inferred from bedroom count.',
      status: 'pending',
      relatedRequirementId: infBathId,
    });
  }

  // Home office / study
  const officeMatch = normalized.match(
    /\b((?:one|two|1|2)\s+)?(home\s+office|study\s+room|dedicated\s+study|library|work\s+studio|office)s?\b/i
  );
  if (officeMatch && !/office\s+building|commercial\s+office/i.test(officeMatch[0])) {
    const qty = parseNumberToken(officeMatch[1]) || 1;
    requirements.push({
      id: nextReqId('office'),
      category: 'spaces-program',
      description: `Home Office / Study (${qty})`,
      normalizedValue: qty * areas.homeOffice,
      unit: defaultUnit,
      priority: detectSentencePriority(officeMatch[0]),
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: officeMatch[0],
      targetSpaceCategory: 'work',
      quantity: qty,
      floorPreference: 'any',
      validationStatus: 'valid',
    });
  }

  // Parking / Garage
  const parkingMatch =
    normalized.match(
      /\b(?:parking(?:\s+for)?|garage\s+for|carport\s+for)\s+(one|two|three|four|\d+)\s+(?:cars?|vehicles?|stalls?|bays?)\b/i
    ) ||
    normalized.match(
      /\b(one|single|two|double|three|triple|\d+)[-\s]*car\s+(?:garage|parking|carport)\b/i
    );
  if (parkingMatch) {
    const carCount = parseNumberToken(parkingMatch[1]) || 2;
    const perCarArea = Math.round(areas.garage * 0.85);
    requirements.push({
      id: nextReqId('parking'),
      category: 'spaces-program',
      description: `Parking / Garage for ${carCount} car(s)`,
      normalizedValue: carCount * perCarArea,
      unit: defaultUnit,
      priority: detectSentencePriority(parkingMatch[0]),
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: parkingMatch[0],
      targetSpaceCategory: 'service',
      quantity: 1,
      floorPreference: 1,
      validationStatus: 'valid',
    });
  }

  // Outdoor spaces (garden, patio, balcony, terrace, courtyard)
  const outdoorMatch = normalized.match(
    /\b(rear\s+garden|private\s+garden|garden\s+patio|courtyard|covered\s+terrace|rooftop\s+terrace|balcony|patio|veranda|outdoor\s+deck)\b/i
  );
  if (outdoorMatch) {
    requirements.push({
      id: nextReqId('outdoor'),
      category: 'spaces-program',
      description: `Outdoor Amenity: ${outdoorMatch[0]}`,
      normalizedValue: areas.balcony,
      unit: defaultUnit,
      priority: detectSentencePriority(outdoorMatch[0]),
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: outdoorMatch[0],
      targetSpaceCategory: 'outdoor',
      quantity: 1,
      floorPreference: 'any',
      validationStatus: 'valid',
    });
  }

  // 5. Area & Dimensional Constraints (including ambiguous unit detection!)
  const plotDimMatch = normalized.match(
    /\bplot(?:\s+of|\s+size|\s+dimensions?)?\s*:?\s*(\d+(?:\.\d+)?)\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*(feet|ft|metres|meters|m)?\b/i
  ) || normalized.match(
    /\b(\d+(?:\.\d+)?)\s*(feet|ft|metres|meters|m)?\s*(?:x|by|×)\s*(\d+(?:\.\d+)?)\s*(feet|ft|metres|meters|m)?\s+(?:plot|lot|site)\b/i
  );

  if (plotDimMatch) {
    const isFirstPattern = /plot/i.test(plotDimMatch[0].slice(0, 15));
    const w = Number(plotDimMatch[1]);
    const l = Number(isFirstPattern ? plotDimMatch[2] : plotDimMatch[3]);
    const rawUnit = (isFirstPattern ? plotDimMatch[3] : plotDimMatch[2] || plotDimMatch[4]) || '';
    const hasExplicitUnit = Boolean(rawUnit.trim());
    const normalizedPlotUnit = /m/i.test(rawUnit) ? 'm' : /f/i.test(rawUnit) ? 'ft' : undefined;

    requirements.push({
      id: nextReqId('plot-dims'),
      category: 'site-orientation',
      description: `Plot Boundary Dimensions: ${w} × ${l}${normalizedPlotUnit ? ` ${normalizedPlotUnit}` : ' (unit unspecified)'}`,
      normalizedValue: `${w}x${l}`,
      unit: normalizedPlotUnit,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: hasExplicitUnit ? 'confirmed' : 'needs-review',
      confidence: hasExplicitUnit ? 'high' : 'low',
      sourceExcerpt: plotDimMatch[0],
      validationStatus: hasExplicitUnit ? 'valid' : 'missing-unit',
      clarificationQuestion: hasExplicitUnit
        ? undefined
        : `Are the plot dimensions (${w} × ${l}) measured in feet (ft) or metres (m)?`,
    });
  }

  // Total floor area mentions (with or without explicit unit)
  const areaWithUnitMatches = [
    ...normalized.matchAll(
      /\b(\d{3,5}(?:,\d{3})*(?:\.\d+)?)\s*(sq\.?\s*ft\.?|square\s+feet|sqft|m2|m²|sq\.?\s*m\.?|square\s+metres|square\s+meters)\b/gi
    ),
  ];
  for (const am of areaWithUnitMatches) {
    const val = Number(am[1].replace(/,/g, ''));
    const uRaw = am[2].toLowerCase();
    const uNorm = uRaw.includes('m') ? 'm²' : 'sq ft';
    requirements.push({
      id: nextReqId('area'),
      category: 'area-dimensions',
      description: `Target Floor / Building Area: ${val.toLocaleString()} ${uNorm}`,
      normalizedValue: val,
      unit: uNorm,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: am[0],
      validationStatus: 'valid',
    });
  }

  // Detect ambiguous area without units (e.g. "total area of 2200" or "floor area 180")
  const ambiguousAreaMatch = normalized.match(
    /\b(?:total\s+area|floor\s+area|size|footprint|built\s+area)\s+(?:of\s+|around\s+|approximately\s+)?(\d{2,5})\b(?!\s*(?:sq|ft|m|feet|metres|meters|people|cars|bedrooms|rooms|USD|EUR|GBP|\$|€|£))/i
  );
  if (ambiguousAreaMatch) {
    const val = Number(ambiguousAreaMatch[1]);
    requirements.push({
      id: nextReqId('ambiguous-area'),
      category: 'area-dimensions',
      description: `Target Area of ${val} (measurement unit not specified)`,
      normalizedValue: val,
      unit: undefined,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'needs-review',
      confidence: 'low',
      sourceExcerpt: ambiguousAreaMatch[0],
      validationStatus: 'missing-unit',
      clarificationQuestion: `Is the specified area of ${val} in square feet (sq ft) or square metres (m²)?`,
    });
  }

  // 6. Privacy & Circulation Preferences
  if (/\b(privacy\s+from\s+(?:the\s+)?street|street\s+privacy|screened\s+from\s+street|secluded\s+from\s+road)\b/i.test(normalized)) {
    const m = normalized.match(/\b(privacy\s+from\s+(?:the\s+)?street|street\s+privacy|screened\s+from\s+street|secluded\s+from\s+road)\b/i)!;
    requirements.push({
      id: nextReqId('privacy-street'),
      category: 'privacy-circulation',
      description: 'Visual and acoustic privacy from the street frontage',
      normalizedValue: 'street-frontage-privacy',
      priority: detectSentencePriority(m[0]),
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: m[0],
      validationStatus: 'valid',
    });
  }

  if (/\b(separate\s+guest\s+area|private\s+bedroom\s+wing|acoustic\s+separation|soundproof)\b/i.test(normalized)) {
    const m = normalized.match(/\b(separate\s+guest\s+area|private\s+bedroom\s+wing|acoustic\s+separation|soundproof)\b/i)!;
    requirements.push({
      id: nextReqId('privacy-zoning'),
      category: 'privacy-circulation',
      description: `Spatial zoning & acoustic separation (${m[0]})`,
      normalizedValue: 'zoned-privacy-separation',
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: m[0],
      validationStatus: 'valid',
    });
  }

  if (/\b(completely\s+open[-\s]*plan\s+with\s+no\s+(?:interior\s+)?walls|zero\s+interior\s+partitions)\b/i.test(normalized)) {
    const m = normalized.match(/\b(completely\s+open[-\s]*plan\s+with\s+no\s+(?:interior\s+)?walls|zero\s+interior\s+partitions)\b/i)!;
    requirements.push({
      id: nextReqId('circulation-open-all'),
      category: 'privacy-circulation',
      description: 'Unpartitioned open-plan interior layout',
      normalizedValue: 'unpartitioned-open-plan',
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: m[0],
      validationStatus: 'valid',
    });
  }

  if (/\b(full\s+street[-\s]*facing\s+glass\s+facade|unscreened\s+street\s+glazing)\b/i.test(normalized)) {
    const m = normalized.match(/\b(full\s+street[-\s]*facing\s+glass\s+facade|unscreened\s+street\s+glazing)\b/i)!;
    requirements.push({
      id: nextReqId('street-glazing'),
      category: 'privacy-circulation',
      description: 'Full transparent street-facing glass facade',
      normalizedValue: 'transparent-street-facade',
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: m[0],
      validationStatus: 'valid',
    });
  }

  // 7. Daylight, Ventilation & Orientation
  const daylightMatch = normalized.match(
    /\b(good\s+natural\s+light|abundant\s+daylight|natural\s+daylight|natural\s+light|maximise\s+sunlight|morning\s+sun|cross[-\s]*ventilation|natural\s+ventilation|passive\s+cooling)\b/i
  );
  if (daylightMatch) {
    requirements.push({
      id: nextReqId('daylight'),
      category: 'daylight-ventilation',
      description: `Daylight & Ventilation Priority: ${daylightMatch[0]}`,
      normalizedValue: daylightMatch[0].toLowerCase(),
      priority: detectSentencePriority(daylightMatch[0]),
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: daylightMatch[0],
      validationStatus: 'valid',
    });
  }

  const orientationMatch = normalized.match(
    /\b(north|south|east|west)[-\s]*(facing|oriented|orientation|frontage|aspect)\b/i
  );
  if (orientationMatch) {
    requirements.push({
      id: nextReqId('orientation'),
      category: 'site-orientation',
      description: `Site / Facade Orientation Preference: ${orientationMatch[0]}`,
      normalizedValue: orientationMatch[1].toUpperCase(),
      priority: 'preferred',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: orientationMatch[0],
      validationStatus: 'valid',
    });
  }

  // 8. Accessibility Needs
  const accessMatch = normalized.match(
    /\b(wheelchair\s+accessible|step[-\s]*free|barrier[-\s]*free|accessible\s+ground\s+floor|ada\s+compliant|universal\s+accessibility|elderly\s+access|ramp\s+access|elevator|lift)\b/i
  );
  if (accessMatch) {
    requirements.push({
      id: nextReqId('accessibility'),
      category: 'accessibility',
      description: `Accessibility Requirement: ${accessMatch[0]}`,
      normalizedValue: true,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: accessMatch[0],
      validationStatus: 'valid',
    });
  }

  // 9. Budget & Cost Constraints (explicit amount + currency, numeric without currency, or qualitative tier)
  const explicitCurrencyBudget =
    normalized.match(
      /(?:\b(?:budget|cost|cap)\s*(?:of|around|under|up\s+to)?\s*)?(\$|€|£|₹|USD|EUR|GBP|CAD|AUD|INR|AED|CHF)\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?\b/i
    ) ||
    normalized.match(
      /\b(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?\s*(USD|EUR|GBP|CAD|AUD|INR|AED|CHF|dollars|euros|pounds)\b/i
    );

  const numericBudgetNoCurrency =
    !explicitCurrencyBudget &&
    normalized.match(
      /\b(?:budget|cost\s+cap|construction\s+budget)\s+(?:of\s+|around\s+|is\s+|under\s+)?(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)?\b(?!\s*(?:USD|EUR|GBP|CAD|AUD|INR|AED|CHF|dollars|euros|pounds|\$|€|£))/i
    );

  const qualitativeBudgetMatch = normalized.match(
    /\b(moderate|modest|tight|low|economical|minimal|high[-\s]*end|luxury|generous)\s+(?:construction\s+)?budget\b/i
  );

  if (explicitCurrencyBudget) {
    let rawSym = '';
    let numStr = '';
    let multStr = '';
    if (/^(\$|€|£|₹|USD|EUR|GBP|CAD|AUD|INR|AED|CHF)$/i.test(explicitCurrencyBudget[1])) {
      rawSym = explicitCurrencyBudget[1];
      numStr = explicitCurrencyBudget[2];
      multStr = explicitCurrencyBudget[3] || '';
    } else {
      numStr = explicitCurrencyBudget[1];
      multStr = explicitCurrencyBudget[2] || '';
      rawSym = explicitCurrencyBudget[3];
    }

    let amount = Number(numStr.replace(/,/g, ''));
    if (/^k|thousand$/i.test(multStr)) amount *= 1000;
    if (/^m|million$/i.test(multStr)) amount *= 1000000;

    const symUpper = rawSym.toUpperCase();
    const currencyCode: Currency =
      symUpper === '$' || symUpper === 'DOLLARS' || symUpper === 'USD'
        ? 'USD'
        : symUpper === '€' || symUpper === 'EUROS' || symUpper === 'EUR'
        ? 'EUR'
        : symUpper === '£' || symUpper === 'POUNDS' || symUpper === 'GBP'
        ? 'GBP'
        : symUpper === '₹' || symUpper === 'INR'
        ? 'INR'
        : (['CAD', 'AUD', 'AED', 'CHF'].includes(symUpper) ? (symUpper as Currency) : 'USD');

    requirements.push({
      id: nextReqId('budget-explicit'),
      category: 'budget-cost',
      description: `Target Construction Budget: ${currencyCode} ${amount.toLocaleString()}`,
      normalizedValue: amount,
      unit: currencyCode,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: explicitCurrencyBudget[0],
      validationStatus: 'valid',
    });
  } else if (numericBudgetNoCurrency) {
    let amount = Number(numericBudgetNoCurrency[1].replace(/,/g, ''));
    const multStr = numericBudgetNoCurrency[2] || '';
    if (/^k|thousand$/i.test(multStr)) amount *= 1000;
    if (/^m|million$/i.test(multStr)) amount *= 1000000;

    requirements.push({
      id: nextReqId('budget-no-currency'),
      category: 'budget-cost',
      description: `Target Construction Budget of ${amount.toLocaleString()} (currency unspecified)`,
      normalizedValue: amount,
      unit: undefined,
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'needs-review',
      confidence: 'low',
      sourceExcerpt: numericBudgetNoCurrency[0],
      validationStatus: 'missing-unit',
      clarificationQuestion: `Which currency applies to the stated construction budget of ${amount.toLocaleString()} (e.g., USD, EUR, GBP, CAD, AUD)?`,
    });
  } else if (qualitativeBudgetMatch) {
    const tierWord = qualitativeBudgetMatch[1].toLowerCase();
    const reqId = nextReqId('budget-qualitative');
    requirements.push({
      id: reqId,
      category: 'budget-cost',
      description: `Qualitative Budget Tier: ${qualitativeBudgetMatch[0]}`,
      normalizedValue: `${tierWord}-budget`,
      unit: project?.currency || undefined,
      priority: 'preferred',
      source: 'explicit',
      reviewStatus: 'needs-review',
      confidence: 'medium',
      sourceExcerpt: qualitativeBudgetMatch[0],
      validationStatus: 'missing-unit',
      clarificationQuestion: `What is your target numeric construction budget cap and currency for the "${qualitativeBudgetMatch[0]}" requirement?`,
    });

    assumptions.push({
      id: nextAssumpId('budget-tier'),
      category: 'budget-cost',
      description: `Qualitative "${qualitativeBudgetMatch[0]}" interpreted as Balanced Mid-Range specification pending numeric budget confirmation.`,
      assumedValue: project?.budget ? `${project.budget}` : 'Balanced Mid-Range Specification',
      unit: project?.currency || 'unspecified-currency',
      rationale: 'A qualitative budget tier was stated without a numeric cap or currency.',
      status: 'pending',
      relatedRequirementId: reqId,
    });
  }

  // 10. Materials & Sustainability Preferences
  const matMatch = normalized.match(
    /\b(timber|mass\s+timber|cross[-\s]*laminated\s+timber|brick|stone|exposed\s+concrete|lime\s+plaster|passive\s+house|net[-\s]*zero|solar\s+panels|rainwater\s+harvesting|low[-\s]*carbon|sustainable\s+materials)\b/i
  );
  if (matMatch) {
    requirements.push({
      id: nextReqId('materials'),
      category: 'materials-sustainability',
      description: `Material / Sustainability Preference: ${matMatch[0]}`,
      normalizedValue: matMatch[0].toLowerCase(),
      priority: detectSentencePriority(matMatch[0]),
      source: 'explicit',
      reviewStatus: 'confirmed',
      confidence: 'high',
      sourceExcerpt: matMatch[0],
      validationStatus: 'valid',
    });
  }

  // 11. Regulatory & Safety Constraints
  const regMatch = normalized.match(
    /\b(zoning\s+setbacks?|setback\s+limits?|building\s+code|fire\s+egress|height\s+limit|historic\s+preservation|council\s+approval|statutory\s+compliance|seismic\s+zone)\b/i
  );
  if (regMatch) {
    requirements.push({
      id: nextReqId('regulatory'),
      category: 'regulatory-safety',
      description: `Regulatory / Code Consideration: ${regMatch[0]}`,
      normalizedValue: regMatch[0].toLowerCase(),
      priority: 'must-have',
      source: 'explicit',
      reviewStatus: 'needs-review',
      confidence: 'medium',
      sourceExcerpt: regMatch[0],
      validationStatus: 'requires-professional-verification',
      clarificationQuestion:
        'Which local municipal Authority Having Jurisdiction (AHJ) and statutory building code edition govern this site?',
    });
  }

  // 12. Retain any unrecognized / custom clauses under 'other-unclassified' rather than dropping them
  for (const clause of sentences) {
    const cTrim = clause.trim();
    if (cTrim.length < 4) continue;
    const alreadyCovered = requirements.some(
      (r) =>
        r.sourceExcerpt &&
        (cTrim.toLowerCase().includes(r.sourceExcerpt.toLowerCase()) ||
          r.sourceExcerpt.toLowerCase().includes(cTrim.toLowerCase()))
    );
    if (!alreadyCovered) {
      requirements.push({
        id: nextReqId('unclassified'),
        category: 'other-unclassified',
        description: `Unclassified Project Requirement: ${cTrim}`,
        normalizedValue: cTrim,
        priority: detectSentencePriority(cTrim),
        source: 'explicit',
        reviewStatus: 'needs-review',
        confidence: 'medium',
        sourceExcerpt: cTrim,
        validationStatus: 'valid',
      });
    }
  }

  // Default Circulation & Wall Allowance Assumption
  assumptions.push({
    id: nextAssumpId('circulation'),
    category: 'floors-circulation',
    description: 'Assumed 15% gross-to-net circulation and structural wall thickness allowance.',
    assumedValue: 15,
    unit: '%',
    rationale: 'Standard preliminary space-programming allowance when exact corridor dimensions are not specified.',
    status: 'pending',
  });

  // Build concise summary
  const useSummary = matchedBuildingLabel || 'Architectural Project';
  const floorReq = requirements.find((r) => r.category === 'floors-circulation');
  const occReq = requirements.find((r) => r.category === 'occupancy-household');
  const spaceReqs = requirements.filter((r) => r.category === 'spaces-program');

  const summaryParts = [
    `${useSummary}`,
    floorReq ? `(${floorReq.normalizedValue} floor(s))` : '',
    occReq ? `for ${occReq.normalizedValue} occupants` : '',
    spaceReqs.length > 0
      ? `with ${spaceReqs.map((s) => s.description).join(', ')}`
      : '',
  ].filter(Boolean);

  return {
    projectSummary: summaryParts.join(' ') + '.',
    requirements,
    assumptions,
  };
}

/**
 * Stage 3: Runtime Validation of External or AI-Generated Output
 * Ensures untrusted or malformed payloads are safely validated, unknown categories
 * fall back to 'other-unclassified', and inferred items are never silently marked confirmed.
 */
export function validateExternalBriefOutput(
  rawPayload: unknown,
  rawText: string,
  project?: Partial<Project>
): {
  isValid: boolean;
  errors: string[];
  projectSummary: string;
  requirements: ProjectRequirement[];
  assumptions: BriefAssumption[];
} {
  const errors: string[] = [];

  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return {
      isValid: false,
      errors: ['External AI output must be a non-null JSON object.'],
      projectSummary: '',
      requirements: [],
      assumptions: [],
    };
  }

  const obj = rawPayload as Record<string, unknown>;
  if (!Array.isArray(obj.requirements)) {
    return {
      isValid: false,
      errors: ['External AI output is missing a valid "requirements" array.'],
      projectSummary: '',
      requirements: [],
      assumptions: [],
    };
  }

  const validatedRequirements: ProjectRequirement[] = [];
  const seenIds = new Set<string>();

  obj.requirements.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      errors.push(`Requirement at index ${index} is not a valid object.`);
      return;
    }
    const r = item as Record<string, unknown>;
    const desc = typeof r.description === 'string' ? normalizeBriefInput(r.description) : '';
    if (!desc) {
      errors.push(`Requirement at index ${index} is missing a valid description.`);
      return;
    }

    let id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `req-ext-${index + 1}`;
    if (seenIds.has(id)) {
      id = `${id}-${index + 1}`;
    }
    seenIds.add(id);

    const category = normalizeRequirementCategory(r.category);
    const rawPriority = typeof r.priority === 'string' ? r.priority.toLowerCase() : 'must-have';
    const priority: RequirementPriority =
      rawPriority === 'preferred' || rawPriority === 'optional' ? rawPriority : 'must-have';

    const rawSource = typeof r.source === 'string' ? r.source.toLowerCase() : 'inferred';
    const source: RequirementSource =
      rawSource === 'explicit' || rawSource === 'user-edited' ? rawSource : 'inferred';

    // CRITICAL RULE: Never silently convert an inference into a confirmed user requirement
    const rawReview = typeof r.reviewStatus === 'string' ? r.reviewStatus.toLowerCase() : '';
    const reviewStatus: RequirementReviewStatus =
      source === 'inferred'
        ? 'needs-review'
        : rawReview === 'confirmed' || rawReview === 'rejected'
        ? (rawReview as RequirementReviewStatus)
        : 'confirmed';

    const rawConf = typeof r.confidence === 'string' ? r.confidence.toLowerCase() : 'medium';
    const confidence: 'high' | 'medium' | 'low' =
      rawConf === 'high' || rawConf === 'low' ? rawConf : 'medium';

    let normalizedValue: string | number | boolean = '';
    if (
      typeof r.normalizedValue === 'string' ||
      typeof r.normalizedValue === 'number' ||
      typeof r.normalizedValue === 'boolean'
    ) {
      normalizedValue =
        typeof r.normalizedValue === 'string'
          ? normalizeBriefInput(r.normalizedValue)
          : r.normalizedValue;
    } else {
      normalizedValue = desc;
    }

    const unit = typeof r.unit === 'string' && r.unit.trim() ? normalizeBriefInput(r.unit) : undefined;
    const sourceExcerpt =
      typeof r.sourceExcerpt === 'string' && r.sourceExcerpt.trim()
        ? normalizeBriefInput(r.sourceExcerpt)
        : undefined;

    const validationStatus =
      category === 'regulatory-safety'
        ? 'requires-professional-verification'
        : (category === 'area-dimensions' || category === 'budget-cost') && !unit
        ? 'missing-unit'
        : 'valid';

    validatedRequirements.push({
      id,
      category,
      description: desc,
      normalizedValue,
      unit,
      priority,
      source,
      reviewStatus,
      confidence,
      sourceExcerpt,
      validationStatus,
      clarificationQuestion:
        typeof r.clarificationQuestion === 'string'
          ? normalizeBriefInput(r.clarificationQuestion)
          : undefined,
      quantity: typeof r.quantity === 'number' && r.quantity > 0 ? Math.round(r.quantity) : undefined,
    });
  });

  if (validatedRequirements.length === 0) {
    return {
      isValid: false,
      errors: [...errors, 'No valid requirements could be extracted from external payload.'],
      projectSummary: '',
      requirements: [],
      assumptions: [],
    };
  }

  const validatedAssumptions: BriefAssumption[] = [];
  if (Array.isArray(obj.assumptions)) {
    obj.assumptions.forEach((aItem, idx) => {
      if (!aItem || typeof aItem !== 'object') return;
      const a = aItem as Record<string, unknown>;
      const desc = typeof a.description === 'string' ? normalizeBriefInput(a.description) : '';
      if (!desc) return;
      validatedAssumptions.push({
        id: typeof a.id === 'string' && a.id.trim() ? a.id.trim() : `assump-ext-${idx + 1}`,
        category: normalizeRequirementCategory(a.category),
        description: desc,
        assumedValue:
          typeof a.assumedValue === 'string' ||
          typeof a.assumedValue === 'number' ||
          typeof a.assumedValue === 'boolean'
            ? a.assumedValue
            : desc,
        unit: typeof a.unit === 'string' ? normalizeBriefInput(a.unit) : undefined,
        rationale:
          typeof a.rationale === 'string' && a.rationale.trim()
            ? normalizeBriefInput(a.rationale)
            : 'Inferred assumption requiring client review.',
        status: 'pending', // Always pending until user explicitly confirms!
      });
    });
  }

  const projectSummary =
    typeof obj.projectSummary === 'string' && obj.projectSummary.trim()
      ? normalizeBriefInput(obj.projectSummary)
      : `Interpreted ${validatedRequirements.length} architectural requirement(s) from description.`;

  return {
    isValid: true,
    errors,
    projectSummary,
    requirements: validatedRequirements,
    assumptions: validatedAssumptions,
  };
}

/**
 * Stage 4: Deterministic Ambiguity, Missing Information, and Conflict Detection
 */
export function detectBriefConflictsAndCompleteness(
  requirements: ProjectRequirement[],
  assumptions: BriefAssumption[],
  rawText: string,
  project?: Partial<Project>
): {
  conflicts: BriefConflict[];
  clarificationQuestions: ClarificationQuestion[];
} {
  const conflicts: BriefConflict[] = [];
  const clarificationQuestions: ClarificationQuestion[] = [];
  const activeReqs = requirements.filter((r) => r.reviewStatus !== 'rejected');

  // 1. Check for Missing Plot Dimensions
  const plotDimReq = activeReqs.find(
    (r) =>
      r.category === 'site-orientation' &&
      typeof r.normalizedValue === 'string' &&
      /^\d+(\.\d+)?x\d+(\.\d+)?$/i.test(r.normalizedValue)
  );
  const hasProjectPlotDims =
    typeof project?.plotWidth === 'number' &&
    project.plotWidth > 0 &&
    typeof project?.plotLength === 'number' &&
    project.plotLength > 0;

  if (!plotDimReq) {
    conflicts.push({
      id: 'conf-missing-plot-dims',
      disposition: 'missing-information',
      severity: hasProjectPlotDims ? 'info' : 'warning',
      title: 'Plot Dimensions Not Stated in Brief Description',
      description: hasProjectPlotDims
        ? `The text description does not specify site boundary dimensions. Evaluation can use existing project plot bounds (${project?.plotWidth} × ${project?.plotLength} ${project?.unit}) if confirmed.`
        : 'Plot boundary width and length are missing from both the brief description and project parameters.',
      affectedRequirementIds: [],
      requiresProfessionalVerification: false,
      resolutionSuggestion: 'Specify plot width and length with units (e.g., 50 × 80 ft or 15 × 25 m).',
    });
    clarificationQuestions.push({
      id: 'q-missing-plot-dims',
      category: 'site-orientation',
      question: 'What are the exact site plot dimensions (width × length) and measurement unit?',
      reason: 'Plot dimensions are required to verify ground footprint coverage and setback compliance.',
      importance: hasProjectPlotDims ? 'important' : 'critical',
      status: 'open',
    });
  }

  // 2. Check for Ambiguous or Mixed Measurement Units
  const missingUnitReqs = activeReqs.filter((r) => r.validationStatus === 'missing-unit');
  for (const mur of missingUnitReqs) {
    if (mur.category === 'area-dimensions' || mur.category === 'site-orientation') {
      conflicts.push({
        id: `conf-missing-unit-${mur.id}`,
        disposition: 'missing-information',
        severity: 'warning',
        title: `Unspecified Measurement Unit: ${mur.description}`,
        description: `Requirement "${mur.description}" specifies a numeric dimension or area (${mur.normalizedValue}) without an explicit unit (feet/sq ft vs metres/m²).`,
        affectedRequirementIds: [mur.id],
        requiresProfessionalVerification: false,
        resolutionSuggestion: `Confirm whether "${mur.normalizedValue}" is measured in imperial (ft / sq ft) or metric (m / m²).`,
      });
      clarificationQuestions.push({
        id: `q-unit-${mur.id}`,
        category: mur.category,
        question:
          mur.clarificationQuestion ||
          `Which measurement unit applies to "${mur.description}" (${mur.normalizedValue})?`,
        reason: 'Mixing or guessing measurement units can cause a 10.76× area scaling error.',
        importance: 'critical',
        relatedRequirementId: mur.id,
        status: 'open',
      });
    }
  }

  // Check if both imperial and metric units are mixed in the same brief
  const hasImperial = activeReqs.some((r) => r.unit === 'sq ft' || r.unit === 'ft');
  const hasMetric = activeReqs.some((r) => r.unit === 'm²' || r.unit === 'm');
  if (hasImperial && hasMetric) {
    const mixedIds = activeReqs
      .filter((r) => ['sq ft', 'ft', 'm²', 'm'].includes(r.unit || ''))
      .map((r) => r.id);
    conflicts.push({
      id: 'conf-mixed-unit-systems',
      disposition: 'confirmed-contradiction',
      severity: 'conflict',
      title: 'Mixed Imperial and Metric Units Detected',
      description:
        'The brief contains both Imperial (ft / sq ft) and Metric (m / m²) measurements. Plotify never silently mixes measurement systems.',
      affectedRequirementIds: mixedIds,
      requiresProfessionalVerification: false,
      resolutionSuggestion: `Normalize all area and dimensional requirements to a single unit system (${project?.unit || 'feet or metres'}).`,
    });
  }

  // 3. Check for Unspecified Budget Currency or Qualitative Budget
  const budgetReqs = activeReqs.filter((r) => r.category === 'budget-cost');
  if (budgetReqs.length === 0) {
    conflicts.push({
      id: 'conf-missing-budget',
      disposition: 'missing-information',
      severity: 'info',
      title: 'Construction Budget Not Specified in Description',
      description: 'No explicit construction budget or cost target was mentioned in the description.',
      affectedRequirementIds: [],
      requiresProfessionalVerification: false,
      resolutionSuggestion: 'Enter a target construction budget and currency if cost feasibility checks are needed.',
    });
  } else {
    for (const br of budgetReqs) {
      if (!br.unit || typeof br.normalizedValue === 'string') {
        const isQualitative = typeof br.normalizedValue === 'string';
        conflicts.push({
          id: `conf-budget-currency-${br.id}`,
          disposition: isQualitative ? 'assumption-awaiting-confirmation' : 'missing-information',
          severity: 'warning',
          title: isQualitative
            ? `Qualitative Budget Requires Numeric Target & Currency (${br.description})`
            : `Unspecified Budget Currency (${br.description})`,
          description: isQualitative
            ? `The description specifies a "${br.sourceExcerpt || br.description}" without an exact numeric cap or currency code.`
            : `A numeric budget of ${br.normalizedValue} was provided without an explicit currency code (e.g., USD, EUR, GBP).`,
          affectedRequirementIds: [br.id],
          requiresProfessionalVerification: false,
          resolutionSuggestion: 'Specify a numeric budget cap and ISO currency code (e.g., 450,000 USD).',
        });
        clarificationQuestions.push({
          id: `q-budget-${br.id}`,
          category: 'budget-cost',
          question:
            br.clarificationQuestion ||
            'What is your target numeric construction budget and currency (e.g., USD, EUR, GBP)?',
          reason: 'Cost feasibility cannot be evaluated without a confirmed numeric cap and currency.',
          importance: 'important',
          relatedRequirementId: br.id,
          status: 'open',
        });
      }
    }
  }

  // 4. Conflicting Room Counts or Conflicting Floor Counts
  const bedroomReqs = activeReqs.filter(
    (r) =>
      r.category === 'spaces-program' &&
      /\bbedroom/i.test(r.description) &&
      !/guest/i.test(r.description) &&
      r.source === 'explicit'
  );
  if (bedroomReqs.length > 1) {
    const distinctQtys = Array.from(new Set(bedroomReqs.map((r) => r.quantity || r.normalizedValue)));
    if (distinctQtys.length > 1) {
      conflicts.push({
        id: 'conf-contradictory-bedrooms',
        disposition: 'confirmed-contradiction',
        severity: 'conflict',
        title: 'Conflicting Bedroom Counts in Description',
        description: `The description contains contradictory bedroom counts (${bedroomReqs
          .map((r) => `"${r.sourceExcerpt || r.description}"`)
          .join(' vs ')}).`,
        affectedRequirementIds: bedroomReqs.map((r) => r.id),
        requiresProfessionalVerification: false,
        resolutionSuggestion: 'Remove or edit the duplicate bedroom requirement so a single bedroom count is confirmed.',
      });
      clarificationQuestions.push({
        id: 'q-contradictory-bedrooms',
        category: 'spaces-program',
        question: 'Which total bedroom count is correct for this project?',
        reason: 'Multiple conflicting bedroom counts were detected in the description.',
        importance: 'critical',
        relatedRequirementId: bedroomReqs[0].id,
        status: 'open',
      });
    }
  }

  const floorReqs = activeReqs.filter((r) => r.category === 'floors-circulation' && r.source === 'explicit');
  if (floorReqs.length > 1) {
    const distinctFloors = Array.from(new Set(floorReqs.map((r) => Number(r.normalizedValue))));
    if (distinctFloors.length > 1) {
      conflicts.push({
        id: 'conf-contradictory-floors',
        disposition: 'confirmed-contradiction',
        severity: 'conflict',
        title: 'Contradictory Building Floor / Storey Counts',
        description: `Conflicting floor counts were specified (${distinctFloors.join(' vs ')} floors).`,
        affectedRequirementIds: floorReqs.map((r) => r.id),
        requiresProfessionalVerification: false,
        resolutionSuggestion: 'Confirm the exact number of building storeys.',
      });
    }
  }

  // 5. Total Floor-Area Target Inconsistent with Requested Room Program
  const explicitAreaReq = activeReqs.find(
    (r) => r.category === 'area-dimensions' && typeof r.normalizedValue === 'number'
  );
  const spaceProgramReqs = activeReqs.filter((r) => r.category === 'spaces-program');
  if (explicitAreaReq && spaceProgramReqs.length > 0) {
    const targetTotalArea = Number(explicitAreaReq.normalizedValue);
    const isMetricArea = explicitAreaReq.unit === 'm²' || (!explicitAreaReq.unit && project?.unit === 'metres');
    const minAreaPerSpace = isMetricArea ? 10 : 105;
    const totalRoomInstances = spaceProgramReqs.reduce((acc, r) => acc + (r.quantity || 1), 0);
    const minPlausibleProgramArea = totalRoomInstances * minAreaPerSpace;

    if (targetTotalArea > 0 && targetTotalArea < minPlausibleProgramArea * 0.75) {
      conflicts.push({
        id: 'conf-area-program-mismatch',
        disposition: 'confirmed-contradiction',
        severity: 'conflict',
        title: 'Target Total Area Too Small for Requested Room Program',
        description: `Stated total area (${targetTotalArea} ${explicitAreaReq.unit || 'units'}) is insufficient to accommodate ${totalRoomInstances} programmed spaces (minimum plausible net area ~${minPlausibleProgramArea} ${isMetricArea ? 'm²' : 'sq ft'}).`,
        affectedRequirementIds: [explicitAreaReq.id, ...spaceProgramReqs.map((s) => s.id)],
        requiresProfessionalVerification: true,
        resolutionSuggestion: 'Increase the target total floor area or reduce the number of requested rooms.',
      });
      clarificationQuestions.push({
        id: 'q-area-program-mismatch',
        category: 'area-dimensions',
        question: `Should the total floor area (${targetTotalArea} ${explicitAreaReq.unit || ''}) be increased to fit all ${totalRoomInstances} requested rooms, or should the room count be reduced?`,
        reason: 'The requested room program exceeds the stated total floor area cap.',
        importance: 'critical',
        relatedRequirementId: explicitAreaReq.id,
        status: 'open',
      });
    }
  }

  // 6. Budget Constraints Potentially Incompatible with Specified Scope
  const numericBudgetReq = budgetReqs.find((r) => typeof r.normalizedValue === 'number');
  const totalRoomCount = spaceProgramReqs.reduce((acc, r) => acc + (r.quantity || 1), 0);
  if (numericBudgetReq && typeof numericBudgetReq.normalizedValue === 'number') {
    const budgetVal = numericBudgetReq.normalizedValue;
    if (budgetVal > 0 && budgetVal < totalRoomCount * 15000) {
      conflicts.push({
        id: 'conf-budget-scope-mismatch',
        disposition: 'potential-conflict-professional-review',
        severity: 'warning',
        title: 'Budget Constraint May Be Incompatible with Program Scope',
        description: `The stated budget (${numericBudgetReq.unit || ''} ${budgetVal.toLocaleString()}) appears tight relative to a program of ${totalRoomCount} spaces. Requires professional Quantity Surveyor feasibility review.`,
        affectedRequirementIds: [numericBudgetReq.id],
        requiresProfessionalVerification: true,
        resolutionSuggestion: 'Review scope priorities or consult a Quantity Surveyor to align budget with local construction rates.',
      });
    }
  }

  // 7. Contradictory Privacy, Circulation, or Spatial Requirements
  const hasStreetPrivacy = activeReqs.some((r) => r.normalizedValue === 'street-frontage-privacy');
  const hasTransparentStreet = activeReqs.some((r) => r.normalizedValue === 'transparent-street-facade');
  if (hasStreetPrivacy && hasTransparentStreet) {
    conflicts.push({
      id: 'conf-privacy-street-contradiction',
      disposition: 'confirmed-contradiction',
      severity: 'conflict',
      title: 'Contradictory Street Privacy vs Transparent Facade Requirements',
      description:
        'The brief simultaneously requests strict privacy from the street and an unscreened transparent street-facing glass facade.',
      affectedRequirementIds: activeReqs
        .filter(
          (r) =>
            r.normalizedValue === 'street-frontage-privacy' ||
            r.normalizedValue === 'transparent-street-facade'
        )
        .map((r) => r.id),
      requiresProfessionalVerification: false,
      resolutionSuggestion:
        'Clarify whether street-facing glazing should use architectural louvers/courtyard setbacks or high-level clerestory windows.',
    });
  }

  const hasUnpartitionedOpen = activeReqs.some((r) => r.normalizedValue === 'unpartitioned-open-plan');
  const hasStrictAcousticSeparation = activeReqs.some((r) => r.normalizedValue === 'zoned-privacy-separation');
  if (hasUnpartitionedOpen && hasStrictAcousticSeparation) {
    conflicts.push({
      id: 'conf-open-vs-acoustic-contradiction',
      disposition: 'confirmed-contradiction',
      severity: 'conflict',
      title: 'Contradictory Open-Plan vs Acoustic Separation Requirements',
      description:
        'The brief requests an unpartitioned open-plan layout with no interior walls alongside strict acoustic/private room separation.',
      affectedRequirementIds: activeReqs
        .filter(
          (r) =>
            r.normalizedValue === 'unpartitioned-open-plan' ||
            r.normalizedValue === 'zoned-privacy-separation'
        )
        .map((r) => r.id),
      requiresProfessionalVerification: false,
      resolutionSuggestion: 'Clarify which zones are open-plan (e.g., kitchen/living) and which are acoustically enclosed (e.g., bedrooms/guest area).',
    });
  }

  // 8. Regulatory Requirements Without Verified Jurisdiction
  const regReqs = activeReqs.filter((r) => r.category === 'regulatory-safety');
  const hasConfirmedJurisdiction = Boolean(
    project?.regulations?.profile?.country && project.regulations.profile.country !== 'Unknown'
  );
  if (regReqs.length > 0 && !hasConfirmedJurisdiction) {
    conflicts.push({
      id: 'conf-regulatory-unverified-jurisdiction',
      disposition: 'potential-conflict-professional-review',
      severity: 'warning',
      title: 'Regulatory Constraints Require Verified Jurisdiction & Professional Review',
      description:
        'Regulatory or code requirements were mentioned, but legal compliance cannot be verified without an established municipal jurisdiction and licensed professional review.',
      affectedRequirementIds: regReqs.map((r) => r.id),
      requiresProfessionalVerification: true,
      resolutionSuggestion: 'Configure the project jurisdiction in the Regulatory Workspace and consult a licensed local architect.',
    });
  }

  // 9. Surface Pending Assumptions Awaiting Confirmation
  const pendingAssumptions = assumptions.filter((a) => a.status === 'pending');
  for (const pa of pendingAssumptions) {
    conflicts.push({
      id: `conf-assumption-${pa.id}`,
      disposition: 'assumption-awaiting-confirmation',
      severity: 'info',
      title: `Assumption Awaiting Confirmation: ${pa.description}`,
      description: `${pa.rationale} (Assumed value: ${pa.assumedValue}${pa.unit ? ` ${pa.unit}` : ''}).`,
      affectedRequirementIds: pa.relatedRequirementId ? [pa.relatedRequirementId] : [],
      requiresProfessionalVerification: false,
      resolutionSuggestion: 'Review and explicitly Confirm or Reject this assumption in the Brief Interpreter.',
    });
  }

  return {
    conflicts,
    clarificationQuestions,
  };
}

/**
 * Stage 5: Evaluate Structured Brief Validation Summary
 */
export function evaluateBriefValidation(
  briefData: {
    requirements: ProjectRequirement[];
    assumptions: BriefAssumption[];
    conflicts: BriefConflict[];
    clarificationQuestions: ClarificationQuestion[];
  },
  project?: Partial<Project>
): BriefValidationResult {
  const activeReqs = briefData.requirements.filter((r) => r.reviewStatus !== 'rejected');
  const confirmedReqs = activeReqs.filter((r) => r.reviewStatus === 'confirmed');
  const unverifiedAssumptions = briefData.assumptions.filter((a) => a.status === 'pending');

  const unresolvedConflicts = briefData.conflicts.filter(
    (c) =>
      !c.resolved &&
      (c.disposition === 'confirmed-contradiction' ||
        (c.disposition === 'potential-conflict-professional-review' && c.severity === 'conflict'))
  );

  const missingInfoItems = briefData.conflicts
    .filter((c) => !c.resolved && c.disposition === 'missing-information')
    .map((c) => c.title);

  const profItems = [
    ...briefData.conflicts
      .filter((c) => c.requiresProfessionalVerification)
      .map((c) => c.title),
    ...activeReqs
      .filter((r) => r.validationStatus === 'requires-professional-verification')
      .map((r) => r.description),
    'Statutory Zoning Setback, FAR & Height Envelope Verification (Local AHJ)',
    'Structural Framing & Foundation Adequacy (Licensed Structural Engineer)',
  ];

  const structurallyValidItems: string[] = [];
  if (activeReqs.some((r) => r.category === 'project-identity')) {
    structurallyValidItems.push('Project identity and building use classification');
  }
  const spaceCount = activeReqs.filter((r) => r.category === 'spaces-program').length;
  if (spaceCount > 0) {
    structurallyValidItems.push(`${spaceCount} programmed space definition(s) extracted`);
  }
  if (activeReqs.some((r) => r.category === 'occupancy-household')) {
    structurallyValidItems.push('Occupant capacity and household profile');
  }
  if (activeReqs.some((r) => r.category === 'floors-circulation')) {
    structurallyValidItems.push('Storey count and vertical circulation parameters');
  }

  const isStructurallyValid = activeReqs.length > 0 && unresolvedConflicts.length === 0;
  const readyForIntegration = isStructurallyValid && confirmedReqs.length > 0;

  const downstreamCompatibility: DownstreamWorkflowCompatibility[] = [
    {
      workflowId: 'brief-space-schedule',
      workflowName: 'Architectural Brief & Space Program Schedule',
      supportedFields: ['spaces', 'objectives', 'occupancy', 'preferences', 'constraints'],
      canConsume: spaceCount > 0,
      notes: 'Populates programmed rooms, target areas, priorities, and unresolved clarification questions.',
    },
    {
      workflowId: 'floor-plan-reconciliation',
      workflowName: '2D Floor-Plan Reconciliation Engine',
      supportedFields: ['spaces.name', 'spaces.category', 'spaces.targetArea', 'spaces.quantity', 'spaces.priority'],
      canConsume: spaceCount > 0,
      notes: 'Checks placed 2D rooms against brief space requirements without automatically overwriting 2D geometry.',
    },
    {
      workflowId: 'cost-intelligence',
      workflowName: 'Cost Intelligence & Budget Control',
      supportedFields: ['objectives.targetBudget', 'constraints.budgetCapKnown'],
      canConsume: activeReqs.some((r) => r.category === 'budget-cost' && typeof r.normalizedValue === 'number'),
      notes: 'Consumes confirmed numeric budget targets when currency matches project settings.',
    },
    {
      workflowId: 'evidence-ledger',
      workflowName: 'Proof-Carrying Evidence Ledger (Section 9)',
      supportedFields: ['ev-brief-program-area', 'ev-brief-mandatory-compliance', 'ev-brief-governance-status'],
      canConsume: true,
      notes: 'Tracks brief program area, mandatory space fulfillment, and approval baseline status.',
    },
  ];

  return {
    isStructurallyValid,
    readyForIntegration,
    complianceDisclaimer: P30_COMPLIANCE_DISCLAIMER,
    structurallyValidItems,
    missingNonBlockingItems: missingInfoItems,
    unresolvedConflicts,
    confirmedRequirementsCount: confirmedReqs.length,
    unverifiedAssumptionsCount: unverifiedAssumptions.length,
    professionalVerificationItems: Array.from(new Set(profItems)),
    downstreamCompatibility,
  };
}

/**
 * Full Synchronous Deterministic Interpretation Pipeline (Stages 1–5)
 */
export function interpretDesignBrief(
  rawText: string,
  project?: Partial<Project>,
  options?: {
    requestSequenceId?: number;
    existingBrief?: ArchitecturalBrief;
  }
): ArchitecturalBrief {
  const normalizedInputText = normalizeBriefInput(rawText);
  if (!normalizedInputText) {
    throw new Error('Cannot interpret an empty brief description. Please enter project requirements.');
  }

  const extracted = extractBriefRequirementsDeterministically(rawText, project);
  const { conflicts, clarificationQuestions } = detectBriefConflictsAndCompleteness(
    extracted.requirements,
    extracted.assumptions,
    rawText,
    project
  );

  const validation = evaluateBriefValidation(
    {
      requirements: extracted.requirements,
      assumptions: extracted.assumptions,
      conflicts,
      clarificationQuestions,
    },
    project
  );

  const seqId =
    options?.requestSequenceId ??
    (options?.existingBrief ? options.existingBrief.requestSequenceId + 1 : 1);

  return {
    id: options?.existingBrief?.id || `brief-p30-${Date.now()}`,
    rawInputText: rawText,
    normalizedInputText,
    interpretedAt: new Date().toISOString(),
    interpreterMode: 'deterministic-local',
    requestSequenceId: seqId,
    projectSummary: extracted.projectSummary,
    requirements: extracted.requirements,
    assumptions: extracted.assumptions,
    conflicts,
    clarificationQuestions,
    validation,
    integrationHistory: options?.existingBrief?.integrationHistory || [],
  };
}

/**
 * Asynchronous Interpretation Pipeline with Server-Side AI + Deterministic Validation & Safe Fallback
 */
export async function interpretDesignBriefAsync(
  rawText: string,
  project?: Partial<Project>,
  options?: {
    requestSequenceId?: number;
    existingBrief?: ArchitecturalBrief;
    signal?: AbortSignal;
    preferAi?: boolean;
  }
): Promise<ArchitecturalBrief> {
  const normalizedInputText = normalizeBriefInput(rawText);
  if (!normalizedInputText) {
    throw new Error('Cannot interpret an empty brief description. Please enter project requirements.');
  }

  if (options?.signal?.aborted) {
    throw new Error('Interpretation request was cancelled.');
  }

  const seqId =
    options?.requestSequenceId ??
    (options?.existingBrief ? options.existingBrief.requestSequenceId + 1 : 1);

  // First run deterministic extraction as baseline and fallback
  const localBrief = interpretDesignBrief(rawText, project, {
    requestSequenceId: seqId,
    existingBrief: options?.existingBrief,
  });

  if (options?.preferAi === false || typeof fetch === 'undefined') {
    return localBrief;
  }

  try {
    const response = await fetch('/api/brief/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: rawText,
        projectContext: project
          ? {
              unit: project.unit,
              currency: project.currency,
              plotWidth: project.plotWidth,
              plotLength: project.plotLength,
            }
          : undefined,
      }),
      signal: options?.signal,
    });

    if (options?.signal?.aborted) {
      throw new Error('Interpretation request was cancelled.');
    }

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.aiAvailable || !data?.payload) {
      const notice =
        data?.error ||
        'AI provider unavailable in this environment; used deterministic local architectural interpreter.';
      return {
        ...localBrief,
        interpreterMode: 'deterministic-local',
        aiProviderNotice: notice,
      };
    }

    // Validate untrusted AI output at runtime
    const validated = validateExternalBriefOutput(data.payload, rawText, project);
    if (!validated.isValid) {
      return {
        ...localBrief,
        interpreterMode: 'deterministic-local',
        aiProviderNotice: `AI output failed runtime schema validation (${validated.errors[0] || 'invalid format'}); fell back to deterministic interpreter.`,
      };
    }

    // Merge with deterministic conflict & completeness checks
    const { conflicts, clarificationQuestions } = detectBriefConflictsAndCompleteness(
      validated.requirements,
      validated.assumptions,
      rawText,
      project
    );

    const validation = evaluateBriefValidation(
      {
        requirements: validated.requirements,
        assumptions: validated.assumptions,
        conflicts,
        clarificationQuestions,
      },
      project
    );

    return {
      id: localBrief.id,
      rawInputText: rawText,
      normalizedInputText,
      interpretedAt: new Date().toISOString(),
      interpreterMode: 'ai-assisted',
      requestSequenceId: seqId,
      projectSummary: validated.projectSummary,
      requirements: validated.requirements,
      assumptions: validated.assumptions,
      conflicts,
      clarificationQuestions,
      validation,
      integrationHistory: localBrief.integrationHistory,
    };
  } catch (err: any) {
    if (err?.name === 'AbortError' || err?.message?.includes('cancelled')) {
      throw new Error('Interpretation request was cancelled.');
    }
    return {
      ...localBrief,
      interpreterMode: 'deterministic-local',
      aiProviderNotice:
        'External AI endpoint unreachable; interpreted requirements using deterministic local engine.',
    };
  }
}

/**
 * Prevents stale asynchronous responses from overwriting newer user edits or newer requests.
 */
export function shouldApplyInterpretationResponse(
  currentBrief: ArchitecturalBrief | undefined,
  incomingBrief: ArchitecturalBrief,
  requestStartedAtIso?: string
): boolean {
  if (!currentBrief) return true;
  if (incomingBrief.requestSequenceId < currentBrief.requestSequenceId) {
    return false;
  }
  if (
    requestStartedAtIso &&
    currentBrief.lastUserEditAt &&
    new Date(currentBrief.lastUserEditAt).getTime() > new Date(requestStartedAtIso).getTime()
  ) {
    return false;
  }
  return true;
}

/**
 * Recomputes conflicts, questions, and validation after a user edits requirements or assumptions.
 */
function recomputeBriefDiagnostics(
  brief: ArchitecturalBrief,
  project?: Partial<Project>
): ArchitecturalBrief {
  const { conflicts, clarificationQuestions } = detectBriefConflictsAndCompleteness(
    brief.requirements,
    brief.assumptions,
    brief.rawInputText,
    project
  );

  // Preserve existing user answers on matching clarification questions
  const mergedQuestions = clarificationQuestions.map((q) => {
    const existingQ = brief.clarificationQuestions.find((eq) => eq.id === q.id);
    if (existingQ && existingQ.status !== 'open') {
      return existingQ;
    }
    return q;
  });

  const validation = evaluateBriefValidation(
    {
      requirements: brief.requirements,
      assumptions: brief.assumptions,
      conflicts,
      clarificationQuestions: mergedQuestions,
    },
    project
  );

  return {
    ...brief,
    conflicts,
    clarificationQuestions: mergedQuestions,
    validation,
  };
}

/**
 * Updates an individual requirement and marks user edits cleanly.
 */
export function updateInterpretedRequirement(
  brief: ArchitecturalBrief,
  requirementId: string,
  updates: Partial<ProjectRequirement>,
  project?: Partial<Project>
): ArchitecturalBrief {
  const now = new Date().toISOString();
  const updatedReqs = brief.requirements.map((r) => {
    if (r.id !== requirementId) return r;
    const merged: ProjectRequirement = {
      ...r,
      ...updates,
      category: updates.category ? normalizeRequirementCategory(updates.category) : r.category,
      source: updates.source || 'user-edited',
    };
    if (merged.unit && merged.validationStatus === 'missing-unit') {
      merged.validationStatus = 'valid';
    }
    return merged;
  });

  return recomputeBriefDiagnostics(
    {
      ...brief,
      lastUserEditAt: now,
      requirements: updatedReqs,
    },
    project
  );
}

/**
 * Adds a manual requirement to the structured brief.
 */
export function addManualInterpretedRequirement(
  brief: ArchitecturalBrief,
  newReq: {
    category: RequirementCategory;
    description: string;
    normalizedValue: string | number | boolean;
    unit?: string;
    priority: RequirementPriority;
    quantity?: number;
    targetSpaceCategory?: SpaceCategory;
    notes?: string;
  },
  project?: Partial<Project>
): ArchitecturalBrief {
  const now = new Date().toISOString();
  const cleanDesc = normalizeBriefInput(newReq.description);
  if (!cleanDesc) {
    throw new Error('Requirement description cannot be empty.');
  }

  const req: ProjectRequirement = {
    id: `req-manual-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    category: normalizeRequirementCategory(newReq.category),
    description: cleanDesc,
    normalizedValue: newReq.normalizedValue,
    unit: newReq.unit?.trim() || undefined,
    priority: newReq.priority,
    source: 'user-edited',
    reviewStatus: 'confirmed',
    confidence: 'high',
    quantity: newReq.quantity,
    targetSpaceCategory: newReq.targetSpaceCategory,
    notes: newReq.notes,
    validationStatus:
      newReq.category === 'regulatory-safety'
        ? 'requires-professional-verification'
        : 'valid',
  };

  return recomputeBriefDiagnostics(
    {
      ...brief,
      lastUserEditAt: now,
      requirements: [...brief.requirements, req],
    },
    project
  );
}

/**
 * Removes an incorrect interpretation from the structured brief.
 */
export function removeInterpretedRequirement(
  brief: ArchitecturalBrief,
  requirementId: string,
  project?: Partial<Project>
): ArchitecturalBrief {
  const now = new Date().toISOString();
  return recomputeBriefDiagnostics(
    {
      ...brief,
      lastUserEditAt: now,
      requirements: brief.requirements.filter((r) => r.id !== requirementId),
      assumptions: brief.assumptions.filter((a) => a.relatedRequirementId !== requirementId),
    },
    project
  );
}

/**
 * Confirms or rejects an inferred assumption, updating any linked requirement accordingly.
 */
export function reviewBriefAssumption(
  brief: ArchitecturalBrief,
  assumptionId: string,
  decision: 'confirmed' | 'rejected',
  editedValue?: string | number | boolean,
  editedUnit?: string,
  project?: Partial<Project>
): ArchitecturalBrief {
  const now = new Date().toISOString();
  const targetAssumption = brief.assumptions.find((a) => a.id === assumptionId);
  if (!targetAssumption) return brief;

  const updatedAssumptions = brief.assumptions.map((a) =>
    a.id === assumptionId
      ? {
          ...a,
          status: decision,
          assumedValue: editedValue !== undefined ? editedValue : a.assumedValue,
          unit: editedUnit !== undefined ? editedUnit : a.unit,
        }
      : a
  );

  const updatedRequirements = brief.requirements.map((r) => {
    if (r.id !== targetAssumption.relatedRequirementId) return r;
    return {
      ...r,
      reviewStatus: decision === 'confirmed' ? ('confirmed' as const) : ('rejected' as const),
      normalizedValue: editedValue !== undefined ? editedValue : r.normalizedValue,
      unit: editedUnit !== undefined ? editedUnit : r.unit,
      validationStatus:
        editedUnit || r.unit ? ('valid' as const) : r.validationStatus,
    };
  });

  return recomputeBriefDiagnostics(
    {
      ...brief,
      lastUserEditAt: now,
      assumptions: updatedAssumptions,
      requirements: updatedRequirements,
    },
    project
  );
}

/**
 * Records a user's clarification response and updates linked requirement status if applicable.
 */
export function answerClarificationQuestion(
  brief: ArchitecturalBrief,
  questionId: string,
  answer: string,
  resolutionMode: 'answered' | 'proceed-with-assumption' = 'answered',
  project?: Partial<Project>
): ArchitecturalBrief {
  const now = new Date().toISOString();
  const targetQ = brief.clarificationQuestions.find((q) => q.id === questionId);
  const cleanAnswer = normalizeBriefInput(answer);

  const updatedQuestions = brief.clarificationQuestions.map((q) =>
    q.id === questionId
      ? {
          ...q,
          userAnswer: cleanAnswer,
          status: resolutionMode,
        }
      : q
  );

  const updatedReqs = brief.requirements.map((r) => {
    if (!targetQ || r.id !== targetQ.relatedRequirementId) return r;
    const updatedNotes = [r.notes, `Clarification: ${cleanAnswer}`].filter(Boolean).join(' | ');
    let updatedUnit = r.unit;
    if (!updatedUnit && /\b(sq\s*ft|ft|feet)\b/i.test(cleanAnswer)) {
      updatedUnit = r.category === 'area-dimensions' ? 'sq ft' : 'ft';
    } else if (!updatedUnit && /\b(m2|m²|metres|meters|m)\b/i.test(cleanAnswer)) {
      updatedUnit = r.category === 'area-dimensions' ? 'm²' : 'm';
    } else if (!updatedUnit && /\b(USD|EUR|GBP|CAD|AUD|INR|AED|CHF)\b/i.test(cleanAnswer)) {
      const m = cleanAnswer.match(/\b(USD|EUR|GBP|CAD|AUD|INR|AED|CHF)\b/i);
      if (m) updatedUnit = m[1].toUpperCase();
    }

    return {
      ...r,
      unit: updatedUnit,
      notes: updatedNotes,
      reviewStatus: 'confirmed' as const,
      validationStatus: updatedUnit && r.validationStatus === 'missing-unit' ? ('valid' as const) : r.validationStatus,
    };
  });

  const recomputed = recomputeBriefDiagnostics(
    {
      ...brief,
      lastUserEditAt: now,
      requirements: updatedReqs,
      clarificationQuestions: updatedQuestions,
    },
    project
  );

  return {
    ...recomputed,
    clarificationQuestions: updatedQuestions,
  };
}

/**
 * Stage 7: Integrate Confirmed Interpreted Brief into Existing Plotify Project & Brief Services
 * Preserves project IDs, 2D floorPlan geometry, 3D settings, and all unrelated project data.
 */
export function integrateInterpretedBriefIntoProject(
  project: Project,
  currentBriefData: ArchitecturalBriefData,
  interpreted: ArchitecturalBrief,
  options?: {
    replaceExistingSpaces?: boolean;
  }
): {
  updatedProject: Project;
  updatedBriefData: ArchitecturalBriefData;
  syncedSpacesCount: number;
} {
  const now = new Date().toISOString();
  const activeConfirmedReqs = interpreted.requirements.filter(
    (r) => r.reviewStatus === 'confirmed'
  );
  const areas = getDefaultSpaceAreas(project.unit);

  // Convert confirmed space-program requirements into SpaceRequirement items
  const spaceReqs = activeConfirmedReqs.filter((r) => r.category === 'spaces-program');
  const newSpaces: SpaceRequirement[] = spaceReqs.map((sr, idx) => {
    const qty = sr.quantity && sr.quantity > 0 ? sr.quantity : 1;
    const totalOrEachArea =
      typeof sr.normalizedValue === 'number' && sr.normalizedValue > 0
        ? sr.normalizedValue
        : areas.living;
    const targetAreaEach = Math.max(20, Math.round(totalOrEachArea / qty));
    const cat: SpaceCategory = sr.targetSpaceCategory || 'living';

    return {
      id: `sp-${sr.id}`,
      name: sr.description.replace(/^Inferred\s+/i, ''),
      category: cat,
      targetArea: targetAreaEach,
      minArea: Math.round(targetAreaEach * 0.85),
      maxArea: Math.round(targetAreaEach * 1.25),
      quantity: qty,
      floorPreference: sr.floorPreference ?? 'any',
      priority: mapToBriefPriority(sr.priority),
      privacyLevel:
        cat === 'sleeping' || cat === 'hygiene' || cat === 'work'
          ? ('private' as PrivacyLevel)
          : ('semi-private' as PrivacyLevel),
      naturalLightRequired: cat !== 'hygiene',
      plumbingRequired: cat === 'hygiene' || cat === 'service',
      outdoorAccessRequired: cat === 'outdoor',
      acousticPrivacyRequired: cat === 'sleeping' || cat === 'work',
      wheelchairAccessible: true,
      notes: sr.sourceExcerpt ? `Source: "${sr.sourceExcerpt}"` : sr.notes || 'Integrated from P30 Brief Interpreter',
    };
  });

  // Merge or replace spaces safely
  let mergedSpaces: SpaceRequirement[] = currentBriefData.spaces;
  if (newSpaces.length > 0) {
    if (options?.replaceExistingSpaces) {
      mergedSpaces = newSpaces;
    } else {
      const existingById = new Set(currentBriefData.spaces.map((s) => s.id));
      const toAdd = newSpaces.filter((ns) => !existingById.has(ns.id));
      const updatedExisting = currentBriefData.spaces.map((es) => {
        const replacement = newSpaces.find((ns) => ns.id === es.id);
        return replacement || es;
      });
      mergedSpaces = [...updatedExisting, ...toAdd];
    }
  }

  // Update objectives, occupancy, preferences, and constraints non-destructively
  const occReq = activeConfirmedReqs.find((r) => r.category === 'occupancy-household');
  const useReq = activeConfirmedReqs.find((r) => r.category === 'project-identity');
  const daylightReqs = activeConfirmedReqs.filter((r) => r.category === 'daylight-ventilation');
  const privacyReqs = activeConfirmedReqs.filter((r) => r.category === 'privacy-circulation');
  const materialReqs = activeConfirmedReqs.filter((r) => r.category === 'materials-sustainability');
  const accessReqs = activeConfirmedReqs.filter((r) => r.category === 'accessibility');
  const budgetReq = activeConfirmedReqs.find(
    (r) => r.category === 'budget-cost' && typeof r.normalizedValue === 'number'
  );

  const openQuestions = interpreted.clarificationQuestions
    .filter((q) => q.status === 'open')
    .map((q) => q.question);

  const confirmedInterpretation: ArchitecturalBrief = {
    ...interpreted,
    lastConfirmedAt: now,
    integrationHistory: [
      {
        id: `int-${Date.now()}`,
        timestamp: now,
        summary: `Integrated ${activeConfirmedReqs.length} confirmed requirement(s) and ${newSpaces.length} programmed space group(s).`,
        syncedSpacesCount: newSpaces.length,
      },
      ...(interpreted.integrationHistory || []),
    ],
  };

  const baseUpdatedBrief: ArchitecturalBriefData = {
    ...currentBriefData,
    lastUpdated: now,
    objectives: {
      ...currentBriefData.objectives,
      primaryPurpose: interpreted.projectSummary || currentBriefData.objectives.primaryPurpose,
      buildingUse:
        (useReq?.normalizedValue as BuildingUseClassification) ||
        currentBriefData.objectives.buildingUse,
      targetBudget:
        typeof budgetReq?.normalizedValue === 'number'
          ? budgetReq.normalizedValue
          : currentBriefData.objectives.targetBudget,
    },
    occupancy: {
      ...currentBriefData.occupancy,
      regularOccupants:
        typeof occReq?.normalizedValue === 'number'
          ? occReq.normalizedValue
          : currentBriefData.occupancy.regularOccupants,
      accessibilityNotes:
        accessReqs.length > 0
          ? accessReqs.map((a) => a.description).join('; ')
          : currentBriefData.occupancy.accessibilityNotes,
    },
    preferences: {
      ...currentBriefData.preferences,
      naturalLightPriorities:
        daylightReqs.length > 0
          ? daylightReqs.map((d) => d.description).join('; ')
          : currentBriefData.preferences.naturalLightPriorities,
      circulationPreferences:
        privacyReqs.length > 0
          ? privacyReqs.map((p) => p.description).join('; ')
          : currentBriefData.preferences.circulationPreferences,
      materialPreferences:
        materialReqs.length > 0
          ? materialReqs.map((m) => m.description).join('; ')
          : currentBriefData.preferences.materialPreferences,
    },
    constraints: {
      ...currentBriefData.constraints,
      budgetCapKnown:
        typeof budgetReq?.normalizedValue === 'number'
          ? budgetReq.normalizedValue
          : currentBriefData.constraints.budgetCapKnown,
      unresolvedQuestions: Array.from(
        new Set([...(currentBriefData.constraints.unresolvedQuestions || []), ...openQuestions])
      ),
    },
    spaces: mergedSpaces,
    interpretedBrief: confirmedInterpretation,
  };

  const withRevision = recordBriefRevision(
    baseUpdatedBrief,
    'P30 Design Brief Interpreter',
    `Confirmed and integrated structured brief (${activeConfirmedReqs.length} requirements, ${newSpaces.length} space definitions)`,
    currentBriefData.approvalStatus === 'locked' ? 'locked' : 'under-review'
  );

  // Preserve all existing project fields (ID, 2D floorPlan geometry, 3D alternatives, costPlanning, etc.)
  const updatedProject: Project = {
    ...project,
    brief: withRevision,
    updatedAt: now,
  };

  return {
    updatedProject,
    updatedBriefData: withRevision,
    syncedSpacesCount: newSpaces.length,
  };
}

