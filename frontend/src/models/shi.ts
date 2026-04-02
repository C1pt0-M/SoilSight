export type SHIStatus = 'evaluated' | 'not_evaluated' | 'outside_aoi' | 'request_error';

export interface SHIComponents {
  prodNorm?: number;
  stabNorm?: number;
  soilBaseNorm?: number;
  waterSupplyNorm?: number;
  saltSafetyNorm?: number;
  soilNorm?: number;
  waterNorm?: number;
  salinityNorm?: number;
  terrainNorm?: number;
  croplandFraction: number;
  dataQuality?: number;
}

export interface CropSupportInfo {
  ndviMeanNorm?: number;
  ndviStabilityNorm?: number;
  note?: string;
}

export interface SHIRisk {
  droughtRisk?: number;
  heatRisk?: number;
  combinedRisk?: number;
  riskLevel?: '低' | '中' | '高';
}

export interface TemporalScopeMeta {
  timeWindow?: number[];
  baselineYears?: [number, number];
  dataCoverageYears?: number;
}

export interface LocationInfo {
  prefecture?: string;
  county?: string;
}

export interface CropProfileInfo {
  profileId: string;
  profileName: string;
  supportFraction: number;
  supportLabel: string;
  cottonFraction?: number;
  sugarbeetFraction?: number;
  maizeFraction?: number;
  profileReason: string;
}

export interface ClickResultEvaluated {
  status: 'evaluated';
  lon: number;
  lat: number;
  sampleLon?: number;
  sampleLat?: number;
  location?: LocationInfo;
  shiScore: number;
  shiLevel: string;
  components: SHIComponents;
  profile?: CropProfileInfo;
  cropSupport?: CropSupportInfo;
  risk?: SHIRisk;
  mlPredEndShi?: number;
  mlPredDeltaShi?: number;
  mlFeatureYear?: number;
  mlTargetYear?: number;
  mlModelType?: string;
  advice: string[];
  temporalMeta?: TemporalScopeMeta;
}

export interface ClickResultNotEvaluated {
  status: 'not_evaluated';
  lon: number;
  lat: number;
  sampleLon?: number;
  sampleLat?: number;
  location?: LocationInfo;
  croplandFraction?: number;
  reason?: string;
  profile?: CropProfileInfo;
  risk?: SHIRisk;
  mlPredEndShi?: number;
  mlPredDeltaShi?: number;
  mlFeatureYear?: number;
  mlTargetYear?: number;
  mlModelType?: string;
  temporalMeta?: TemporalScopeMeta;
}

export interface ClickResultOutsideAOI {
  status: 'outside_aoi';
  lon: number;
  lat: number;
  sampleLon?: number;
  sampleLat?: number;
  location?: LocationInfo;
  temporalMeta?: TemporalScopeMeta;
}

export type ClickResult = ClickResultEvaluated | ClickResultNotEvaluated | ClickResultOutsideAOI;

export interface APIResultResponse {
  ok: boolean;
  lon: number;
  lat: number;
  sample_lon?: number;
  sample_lat?: number;
  in_grid: boolean;
  status: SHIStatus;
  location?: {
    prefecture?: string | null;
    county?: string | null;
  } | null;
  shi_score?: number;
  shi_level_code?: number;
  shi_level?: string;
  components?: {
    prod_norm?: number | null;
    stab_norm?: number | null;
    soil_base_norm?: number | null;
    water_supply_norm?: number | null;
    salt_safety_norm?: number | null;
    soil_norm?: number | null;
    water_norm?: number | null;
    salinity_norm?: number | null;
    terrain_norm?: number | null;
    cropland_fraction: number;
    data_quality?: number | null;
  };
  crop_support?: {
    ndvi_mean_norm?: number | null;
    ndvi_stability_norm?: number | null;
    note?: string | null;
  } | null;
  risk?: {
    drought_risk?: number | null;
    heat_risk?: number | null;
    combined_risk?: number | null;
    risk_level?: '低' | '中' | '高' | null;
  };
  profile?: {
    profile_id?: string | null;
    profile_name?: string | null;
    support_fraction?: number | null;
    support_label?: string | null;
    cotton_fraction?: number | null;
    sugarbeet_fraction?: number | null;
    maize_fraction?: number | null;
    profile_reason?: string | null;
  } | null;
  ml_pred_end_shi?: number | null;
  ml_pred_delta_shi?: number | null;
  ml_feature_year?: number | null;
  ml_target_year?: number | null;
  ml_model_type?: string | null;
  time_window?: number[] | null;
  baseline_years?: [number, number] | number[] | null;
  data_coverage_years?: number | null;
  advice?: string[];
  cropland_fraction?: number;
  reason?: string;
  error?: string;
}

export type ScenarioPackId =
  | 'organic_boost'
  | 'irrigation_opt'
  | 'salt_control'
  | 'conservation_tillage'
  | 'integrated_stable';

export interface ScenarioPackOption {
  id: ScenarioPackId;
  name: string;
  description: string;
}

export const SCENARIO_PACK_OPTIONS: ScenarioPackOption[] = [
  {
    id: 'integrated_stable',
    name: '综合稳产方案',
    description: '统筹改土、控水、稳盐，适合比赛演示默认方案。',
  },
  {
    id: 'organic_boost',
    name: '有机质提升',
    description: '优先改善土壤基础和结构稳定性。',
  },
  {
    id: 'irrigation_opt',
    name: '灌溉优化',
    description: '优先缓解水分胁迫与波动风险。',
  },
  {
    id: 'salt_control',
    name: '控盐排盐',
    description: '优先应对盐碱约束区域。',
  },
  {
    id: 'conservation_tillage',
    name: '保育耕作',
    description: '优先提升稳定性并降低侵蚀风险。',
  },
];

export type PlanObjective = '稳产优先' | '节水优先' | '改土优先';
export type PlanTaskType = 'priority_actions' | 'stage_schedule' | 'risk_explain';
export type IrrigationConstraint = '充足' | '有限' | '无';
export type ProgressMode = 'aggressive' | 'stable' | 'conservative';

export const PLAN_OBJECTIVE_OPTIONS: Array<{ value: PlanObjective; label: string }> = [
  { value: '稳产优先', label: '稳产优先' },
  { value: '节水优先', label: '节水优先' },
  { value: '改土优先', label: '改土优先' },
];

export const IRRIGATION_CONSTRAINT_OPTIONS: Array<{ value: IrrigationConstraint; label: string }> = [
  { value: '充足', label: '充足' },
  { value: '有限', label: '有限' },
  { value: '无', label: '无' },
];

export const PROGRESS_MODE_OPTIONS: Array<{ value: ProgressMode; label: string }> = [
  { value: 'aggressive', label: '积极推进' },
  { value: 'stable', label: '稳健推进' },
  { value: 'conservative', label: '保守推进' },
];

export interface RuleTrace {
  ruleId: string;
  title: string;
  trigger: string;
  evidence: string;
  explanation: string;
  source: string;
}

export interface PlanStep {
  stageId: string;
  title: string;
  actions: string[];
  expectedChanges: string[];
  ruleIds: string[];
  milestones?: string[];
  entryConditions?: string[];
  exitConditions?: string[];
  fallbackActions?: string[];
}

export interface PlanSnapshot {
  regionId?: string;
  lon: number;
  lat: number;
  shiScore: number;
  shiLevel: string;
  components: SHIComponents;
  profile?: CropProfileInfo;
  risk?: SHIRisk;
  temporalMeta?: TemporalScopeMeta;
}

export interface PlanData {
  goal: string;
  constraints: {
    irrigation: IrrigationConstraint;
  };
  progressMode: ProgressMode;
  taskType: PlanTaskType;
  scenarioPack: {
    id: ScenarioPackId;
    name: string;
    description: string;
  };
  summary: string;
  stages: PlanStep[];
  ruleTraces: RuleTrace[];
  uncertaintyNote: string;
}

export interface PlanGenerateResponse {
  sessionId: string;
  snapshot: PlanSnapshot;
  plan: PlanData;
  assistantReply: string;
  assistantKnowledgeHits?: KnowledgeHit[];
  generatedAt: string;
}

export interface KnowledgeHit {
  title: string;
  excerpt: string;
  category: string;
  path: string;
  score?: number;
}

export interface PlanChatMessage {
  role: 'user' | 'assistant';
  content: string;
  knowledgeHits?: KnowledgeHit[];
}

export interface AssistantConversationRecord {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
  messages: PlanChatMessage[];
}

export interface PlanChatResponse {
  sessionId: string;
  reply: string;
  updatedPlanSummary: string;
  ruleTraces: RuleTrace[];
  chatHistory: PlanChatMessage[];
}

export type AssistantMode = 'general' | 'contextual';

export interface AIChatResponse {
  reply: string;
  chatHistory: PlanChatMessage[];
}

export interface SimulationPoint {
  stageIndex: number;
  shi: number;
  prod: number;
  stab: number;
  soil: number;
  water: number;
  salinity: number;
  terrain: number;
}

export interface SimulationSeries {
  baseline: SimulationPoint[];
  expected: SimulationPoint[];
  conservative: SimulationPoint[];
  optimistic: SimulationPoint[];
}

export interface PercentileBandPoint {
  stageIndex: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface ParameterSource {
  parameter: string;
  value: number;
  std: number;
  source: string;
}

export interface SensitivityItem {
  parameter: string;
  sensitivity: number;
  varContribution: number;
}

export interface FeatureImportance {
  feature: string;
  label: string;
  importance: number;
}

export interface ModelInfo {
  trained: boolean;
  r2: number | null;
  rmse: number | null;
  nSamples: number;
  featureImportance: FeatureImportance[];
}

export interface SimulationResult {
  progressMode: ProgressMode;
  stageCount: number;
  stageLabels: string[];
  series: SimulationSeries;
  comparison: {
    baselineEndShi: number;
    expectedEndShi: number;
    conservativeEndShi: number;
    optimisticEndShi: number;
    expectedDeltaShi: number;
  };
  percentileBands?: PercentileBandPoint[];
  hasMonteCarlo?: boolean;
  nSamples?: number;
  parameterSources?: ParameterSource[];
  sensitivity?: SensitivityItem[];
  mlReference?: {
    modelType?: string;
    featureYear?: number;
    targetYear?: number;
    baseShiClick?: number;
    baseShiFeatureYear?: number;
    predDeltaShi?: number;
    predEndShi?: number;
    currentPredShi?: number;
    ruleExpectedEndShi?: number;
    differenceVsRuleExpected?: number;
    trainR2?: number;
    trainRmse?: number;
    trainN?: number;
    comparabilityNote?: string;
    uncertaintyNote?: string;
  };
  uncertaintyNote: string;
}

export interface PlanSimulateResponse {
  sessionId: string;
  scenarioPack: {
    id: ScenarioPackId;
    name: string;
  };
  simulation: SimulationResult;
  ruleTraces: RuleTrace[];
}
