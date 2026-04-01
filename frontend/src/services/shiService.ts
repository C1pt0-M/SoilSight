import type {
  AIChatResponse,
  APIResultResponse,
  ClickResult,
  CropSupportInfo,
  CropProfileInfo,
  IrrigationConstraint,
  LocationInfo,
  ModelInfo,
  ParameterSource,
  PlanChatMessage,
  PlanChatResponse,
  PlanGenerateResponse,
  PlanObjective,
  PlanSimulateResponse,
  PlanStep,
  PlanTaskType,
  ProgressMode,
  ScenarioPackId,
  SensitivityItem,
} from '../models/shi';
import { attachKnowledgeHitsToMessages, normalizeKnowledgeHits } from '../utils/messageReferences.js';
import { DEFAULT_STAGE_LABELS } from '../utils/stageLabels.js';
import { parsePercentileBands } from './simulationParser.js';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '');
const DEFAULT_API_TIMEOUT_MS = 30000;
const DEFAULT_PLAN_API_TIMEOUT_MS = 60000;
const DEFAULT_HEALTH_TIMEOUT_MS = 10000;
const MIN_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 120000;

const parseTimeout = (rawValue: string | undefined, fallbackMs: number): number => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallbackMs;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(parsed)));
};

const API_TIMEOUT_MS = parseTimeout(import.meta.env.VITE_API_TIMEOUT_MS, DEFAULT_API_TIMEOUT_MS);
const PLAN_API_TIMEOUT_MS = parseTimeout(
  import.meta.env.VITE_PLAN_API_TIMEOUT_MS ?? import.meta.env.VITE_API_TIMEOUT_MS,
  DEFAULT_PLAN_API_TIMEOUT_MS
);
const HEALTH_TIMEOUT_MS = parseTimeout(import.meta.env.VITE_HEALTH_TIMEOUT_MS, DEFAULT_HEALTH_TIMEOUT_MS);


const parseLocation = (raw?: { prefecture?: string | null; county?: string | null } | null): LocationInfo | undefined => {
  if (!raw) return undefined;
  const prefecture = raw.prefecture ?? undefined;
  const county = raw.county ?? undefined;
  if (!prefecture && !county) return undefined;
  return { prefecture, county };
};

const parseTemporalMeta = (
  timeWindow?: number[] | null,
  baselineYears?: [number, number] | number[] | null,
  dataCoverageYears?: number | null
) => {
  const baseline =
    Array.isArray(baselineYears) && baselineYears.length >= 2
      ? [Number(baselineYears[0]), Number(baselineYears[1])]
      : undefined;
  const months =
    Array.isArray(timeWindow) && timeWindow.length > 0
      ? timeWindow.map((value) => Number(value)).filter((value) => Number.isFinite(value))
      : undefined;
  const coverage =
    typeof dataCoverageYears === 'number' && Number.isFinite(dataCoverageYears)
      ? Math.round(dataCoverageYears)
      : undefined;
  if (!months && !baseline && coverage === undefined) {
    return undefined;
  }
  return {
    timeWindow: months,
    baselineYears: baseline as [number, number] | undefined,
    dataCoverageYears: coverage,
  };
};

const normalizeFraction = (value?: number | null): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value > 1.01) return value / 100;
  if (value < 0) return 0;
  return value;
};

const parseCropProfile = (
  raw?: {
    profile_id?: string | null;
    profile_name?: string | null;
    support_fraction?: number | null;
    support_label?: string | null;
    cotton_fraction?: number | null;
    sugarbeet_fraction?: number | null;
    maize_fraction?: number | null;
    profile_reason?: string | null;
  } | null
): CropProfileInfo | undefined => {
  if (!raw) return undefined;
  const profileId = typeof raw.profile_id === 'string' ? raw.profile_id.trim() : '';
  const profileName = typeof raw.profile_name === 'string' ? raw.profile_name.trim() : '';
  const supportFraction = normalizeFraction(raw.support_fraction ?? raw.cotton_fraction ?? raw.sugarbeet_fraction ?? raw.maize_fraction);
  const supportLabel = typeof raw.support_label === 'string' ? raw.support_label.trim() : '';
  const cottonFraction = normalizeFraction(raw.cotton_fraction);
  const sugarbeetFraction = normalizeFraction(raw.sugarbeet_fraction);
  const maizeFraction = normalizeFraction(raw.maize_fraction);
  const profileReason = typeof raw.profile_reason === 'string' ? raw.profile_reason.trim() : '';
  if (!profileId || !profileName || supportFraction === undefined || !supportLabel || !profileReason) {
    return undefined;
  }
  return {
    profileId,
    profileName,
    supportFraction,
    supportLabel,
    cottonFraction,
    sugarbeetFraction,
    maizeFraction,
    profileReason,
  };
};

const parseCropSupport = (
  raw?: {
    ndvi_mean_norm?: number | null;
    ndvi_stability_norm?: number | null;
    note?: string | null;
  } | null
): CropSupportInfo | undefined => {
  if (!raw) return undefined;
  const ndviMeanNorm =
    typeof raw.ndvi_mean_norm === 'number' && Number.isFinite(raw.ndvi_mean_norm)
      ? raw.ndvi_mean_norm
      : undefined;
  const ndviStabilityNorm =
    typeof raw.ndvi_stability_norm === 'number' && Number.isFinite(raw.ndvi_stability_norm)
      ? raw.ndvi_stability_norm
      : undefined;
  const note = typeof raw.note === 'string' ? raw.note.trim() : '';
  if (ndviMeanNorm === undefined && ndviStabilityNorm === undefined && !note) {
    return undefined;
  }
  return {
    ndviMeanNorm,
    ndviStabilityNorm,
    note: note || undefined,
  };
};

const parseAvailableScoreProfiles = (
  raw?: Array<{ id?: string | null; name?: string | null }> | null
): Array<{ id: string; name: string }> | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const parsed = raw
    .map((item) => ({
      id: typeof item?.id === 'string' ? item.id.trim().toLowerCase() : '',
      name: typeof item?.name === 'string' ? item.name.trim() : '',
    }))
    .filter((item) => item.id && item.name);
  return parsed.length > 0 ? parsed : undefined;
};

interface APIPlanGenerateResponseRaw {
  ok: boolean;
  session_id: string;
  snapshot: {
    region_id?: string;
    lon: number;
    lat: number;
    shi_score: number;
    shi_level: string;
    components: {
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
    risk?: {
      drought_risk?: number | null;
      heat_risk?: number | null;
      combined_risk?: number | null;
      risk_level?: string | null;
    } | null;
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
    time_window?: number[] | null;
    baseline_years?: [number, number] | number[] | null;
    data_coverage_years?: number | null;
  };
  plan: {
    goal: string;
    constraints: { irrigation: string };
    progress_mode?: string | null;
    task_type: string;
    scenario_pack: { id: string; name: string; description: string };
    summary: string;
    stages: Array<{
      stage_id: string;
      title: string;
      actions: string[];
      expected_changes: string[];
      rule_ids: string[];
      milestones?: string[];
      entry_conditions?: string[];
      exit_conditions?: string[];
      fallback_actions?: string[];
    }>;
    rule_traces: Array<{
      rule_id: string;
      title: string;
      trigger: string;
      evidence: string;
      explanation: string;
      source: string;
    }>;
    uncertainty_note: string;
  };
  assistant_reply: string;
  used_llm: boolean;
  generated_at: string;
  knowledge_hits?: unknown[];
  error?: string;
}

interface APIPlanSimResponseRaw {
  ok: boolean;
  session_id: string;
  scenario_pack: {
    id: ScenarioPackId;
    name: string;
  };
  simulation: {
    progress_mode?: string | null;
    stage_count?: number | null;
    stage_labels?: string[] | null;
    series: {
      baseline: Array<Record<string, number>>;
      expected: Array<Record<string, number>>;
      conservative: Array<Record<string, number>>;
      optimistic: Array<Record<string, number>>;
    };
    comparison: {
      baseline_end_shi: number;
      expected_end_shi: number;
      conservative_end_shi: number;
      optimistic_end_shi: number;
      expected_delta_shi: number;
    };
    percentile_bands?: Array<{
      stage_index: number;
      p10: number;
      p25: number;
      p50: number;
      p75: number;
      p90: number;
    }> | null;
    has_monte_carlo?: boolean;
    n_samples?: number;
    parameter_sources?: Array<{
      parameter: string;
      value: number;
      std: number;
      source: string;
    }> | null;
    sensitivity?: Array<{
      parameter: string;
      sensitivity: number;
      var_contribution: number;
    }> | null;
    ml_reference?: {
      model_type?: string | null;
      feature_year?: number | null;
      target_year?: number | null;
      base_shi?: number | null;
      base_shi_click?: number | null;
      base_shi_feature_year?: number | null;
      pred_delta_shi?: number | null;
      pred_end_shi?: number | null;
      current_pred_shi?: number | null;
      rule_expected_end_shi?: number | null;
      difference_vs_rule_expected?: number | null;
      train_r2?: number | null;
      train_rmse?: number | null;
      train_n?: number | null;
      comparability_note?: string | null;
      uncertainty_note?: string | null;
    } | null;
    uncertainty_note: string;
  };
  rule_traces: Array<{
    rule_id: string;
    title: string;
    trigger: string;
    evidence: string;
    explanation: string;
    source: string;
  }>;
  error?: string;
}

interface APIPlanChatResponseRaw {
  ok: boolean;
  session_id: string;
  reply: string;
  used_llm: boolean;
  updated_plan_summary?: string;
  rule_traces?: Array<{
    rule_id: string;
    title: string;
    trigger: string;
    evidence: string;
    explanation: string;
    source: string;
  }>;
  chat_history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  knowledge_hits?: unknown[];
  error?: string;
}

interface APIGeneralChatResponseRaw {
  ok: boolean;
  reply: string;
  used_llm: boolean;
  chat_history?: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  knowledge_hits?: unknown[];
  error?: string;
}

interface APIHealthResponseRaw {
  ok: boolean;
  service?: string;
  region_id?: string;
  time_window?: number[] | null;
  baseline_years?: [number, number] | number[] | null;
  score_profile_id?: string | null;
  score_profile_name?: string | null;
  available_score_profiles?: Array<{ id?: string | null; name?: string | null }> | null;
}

export class SHIService {
  private apiUrl(path: string): string {
    return API_BASE_URL ? `${API_BASE_URL}${path}` : path;
  }

  private withTimeoutSignal(signal?: AbortSignal, timeoutMs: number = API_TIMEOUT_MS): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }

  private async readJsonOrThrow<T>(response: Response): Promise<T> {
    const raw = await response.text();
    let data: Record<string, unknown> | null = null;
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        const snippet = raw.slice(0, 80).replace(/\s+/g, ' ');
        throw new Error(
          `API 返回非 JSON 响应：${snippet}。请检查后端是否启动，以及前端 API 地址/代理配置。`
        );
      }
    }

    if (!response.ok) {
      const errMsg = typeof data?.error === 'string' ? data.error : `HTTP error! status=${response.status}`;
      throw new Error(errMsg);
    }
    if (!data || data.ok !== true) {
      const errMsg = typeof data?.error === 'string' ? data.error : 'Unknown API error';
      throw new Error(errMsg);
    }
    return data as T;
  }

  async getHealth(): Promise<{
    ok: boolean;
    service?: string;
    regionId?: string;
    timeWindow?: number[];
    baselineYears?: [number, number];
    scoreProfileId?: string;
    scoreProfileName?: string;
    availableScoreProfiles?: Array<{ id: string; name: string }>;
  } | null> {
    try {
      const response = await fetch(this.apiUrl('/health'), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      const data = await this.readJsonOrThrow<APIHealthResponseRaw>(response);
      const temporalMeta = parseTemporalMeta(data.time_window, data.baseline_years, undefined);
      return {
        ok: data.ok === true,
        service: typeof data.service === 'string' ? data.service : undefined,
        regionId: typeof data.region_id === 'string' ? data.region_id : undefined,
        timeWindow: temporalMeta?.timeWindow,
        baselineYears: temporalMeta?.baselineYears,
        scoreProfileId:
          typeof data.score_profile_id === 'string' ? data.score_profile_id.trim().toLowerCase() || undefined : undefined,
        scoreProfileName:
          typeof data.score_profile_name === 'string' ? data.score_profile_name.trim() || undefined : undefined,
        availableScoreProfiles: parseAvailableScoreProfiles(data.available_score_profiles),
      };
    } catch (error) {
      console.error('Failed to fetch health:', error);
      return null;
    }
  }

  async getShiClick(lon: number, lat: number, profileId?: string, signal?: AbortSignal): Promise<ClickResult> {
    const url = new URL(this.apiUrl('/api/shi/click'), window.location.origin);
    url.searchParams.append('lon', lon.toFixed(6));
    url.searchParams.append('lat', lat.toFixed(6));
    if (profileId) {
      url.searchParams.append('profile', profileId);
    }

    const response = await fetch(url.toString(), { signal: this.withTimeoutSignal(signal) });
    const data = await this.readJsonOrThrow<APIResultResponse>(response);

    if (data.status === 'evaluated') {
      return {
        status: 'evaluated',
        lon: data.lon,
        lat: data.lat,
        sampleLon: data.sample_lon ?? undefined,
        sampleLat: data.sample_lat ?? undefined,
        location: parseLocation(data.location),
        shiScore: data.shi_score!,
        shiLevel: data.shi_level!,
        components: {
          prodNorm: data.components!.prod_norm ?? undefined,
          stabNorm: data.components!.stab_norm ?? undefined,
          soilBaseNorm: data.components!.soil_base_norm ?? data.components!.soil_norm ?? undefined,
          waterSupplyNorm: data.components!.water_supply_norm ?? data.components!.water_norm ?? undefined,
          saltSafetyNorm: data.components!.salt_safety_norm ?? data.components!.salinity_norm ?? undefined,
          soilNorm: data.components!.soil_norm ?? undefined,
          waterNorm: data.components!.water_norm ?? undefined,
          salinityNorm: data.components!.salinity_norm ?? undefined,
          terrainNorm: data.components!.terrain_norm ?? undefined,
          croplandFraction: normalizeFraction(data.components!.cropland_fraction) ?? 0,
          dataQuality: data.components!.data_quality ?? undefined,
        },
        cropSupport: parseCropSupport(data.crop_support),
        risk: data.risk
          ? {
              droughtRisk: data.risk.drought_risk ?? undefined,
              heatRisk: data.risk.heat_risk ?? undefined,
              combinedRisk: data.risk.combined_risk ?? undefined,
              riskLevel: data.risk.risk_level ?? undefined,
            }
          : undefined,
        mlPredEndShi: typeof data.ml_pred_end_shi === 'number' ? data.ml_pred_end_shi : undefined,
        mlPredDeltaShi: typeof data.ml_pred_delta_shi === 'number' ? data.ml_pred_delta_shi : undefined,
        mlFeatureYear: typeof data.ml_feature_year === 'number' ? data.ml_feature_year : undefined,
        mlTargetYear: typeof data.ml_target_year === 'number' ? data.ml_target_year : undefined,
        mlModelType: data.ml_model_type ?? undefined,
        profile: parseCropProfile(data.profile),
        temporalMeta: parseTemporalMeta(data.time_window, data.baseline_years, data.data_coverage_years),
        advice: data.advice || [],
      };
    }
    if (data.status === 'not_evaluated') {
      return {
        status: 'not_evaluated',
        lon: data.lon,
        lat: data.lat,
        sampleLon: data.sample_lon ?? undefined,
        sampleLat: data.sample_lat ?? undefined,
        location: parseLocation(data.location),
        croplandFraction: normalizeFraction(data.cropland_fraction),
        reason: data.reason,
        profile: parseCropProfile(data.profile),
        risk: data.risk
          ? {
              droughtRisk: data.risk.drought_risk ?? undefined,
              heatRisk: data.risk.heat_risk ?? undefined,
              combinedRisk: data.risk.combined_risk ?? undefined,
              riskLevel: data.risk.risk_level ?? undefined,
            }
          : undefined,
        mlPredEndShi: typeof data.ml_pred_end_shi === 'number' ? data.ml_pred_end_shi : undefined,
        mlPredDeltaShi: typeof data.ml_pred_delta_shi === 'number' ? data.ml_pred_delta_shi : undefined,
        mlFeatureYear: typeof data.ml_feature_year === 'number' ? data.ml_feature_year : undefined,
        mlTargetYear: typeof data.ml_target_year === 'number' ? data.ml_target_year : undefined,
        mlModelType: data.ml_model_type ?? undefined,
        temporalMeta: parseTemporalMeta(data.time_window, data.baseline_years, data.data_coverage_years),
      };
    }
    if (data.status === 'outside_aoi') {
      return {
        status: 'outside_aoi',
        lon: data.lon,
        lat: data.lat,
        location: parseLocation(data.location),
        temporalMeta: parseTemporalMeta(data.time_window, data.baseline_years, data.data_coverage_years),
      };
    }
    throw new Error(`Unexpected status: ${data.status}`);
  }

  /**
   * 规划生成：走后端规则引擎
   */
  async generatePlan(
    payload: {
      lon: number;
      lat: number;
      objective: PlanObjective;
      irrigation: IrrigationConstraint;
      scenarioPack: ScenarioPackId;
      progressMode: ProgressMode;
      taskType: PlanTaskType;
      profileId?: string;
    },
    signal?: AbortSignal
  ): Promise<PlanGenerateResponse> {
    const response = await fetch(this.apiUrl('/api/plan/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: this.withTimeoutSignal(signal, PLAN_API_TIMEOUT_MS),
      body: JSON.stringify({
        lon: payload.lon,
        lat: payload.lat,
        objective: payload.objective,
        constraints: { irrigation: payload.irrigation },
        scenario_pack: payload.scenarioPack,
        progress_mode: payload.progressMode,
        task_type: payload.taskType,
        profile: payload.profileId,
      }),
    });
    const backendData = await this.readJsonOrThrow<APIPlanGenerateResponseRaw>(response);

    const snap = backendData.snapshot;
    const plan = backendData.plan;
    const mappedStages: PlanStep[] = plan.stages.map((s) => ({
      stageId: s.stage_id,
      title: s.title,
      actions: s.actions,
      expectedChanges: s.expected_changes,
      ruleIds: s.rule_ids,
      milestones: s.milestones,
      entryConditions: s.entry_conditions,
      exitConditions: s.exit_conditions,
      fallbackActions: s.fallback_actions,
    }));

    return {
      sessionId: backendData.session_id,
      generatedAt: backendData.generated_at,
      assistantReply: backendData.assistant_reply || "已为您生成土壤改良规划",
      assistantKnowledgeHits: normalizeKnowledgeHits(backendData.knowledge_hits),
      snapshot: {
        regionId: snap.region_id,
        lon: snap.lon,
        lat: snap.lat,
        shiScore: snap.shi_score,
        shiLevel: snap.shi_level,
        components: {
          prodNorm: snap.components.prod_norm ?? undefined,
          stabNorm: snap.components.stab_norm ?? undefined,
          soilBaseNorm: snap.components.soil_base_norm ?? snap.components.soil_norm ?? undefined,
          waterSupplyNorm: snap.components.water_supply_norm ?? snap.components.water_norm ?? undefined,
          saltSafetyNorm: snap.components.salt_safety_norm ?? snap.components.salinity_norm ?? undefined,
          soilNorm: snap.components.soil_norm ?? undefined,
          waterNorm: snap.components.water_norm ?? undefined,
          salinityNorm: snap.components.salinity_norm ?? undefined,
          terrainNorm: snap.components.terrain_norm ?? undefined,
          croplandFraction: snap.components.cropland_fraction,
          dataQuality: snap.components.data_quality ?? undefined,
        },
        profile: parseCropProfile(snap.profile),
        risk: snap.risk
          ? {
              droughtRisk: snap.risk.drought_risk ?? undefined,
              heatRisk: snap.risk.heat_risk ?? undefined,
              combinedRisk: snap.risk.combined_risk ?? undefined,
              riskLevel: (snap.risk.risk_level as '低' | '中' | '高' | undefined) ?? undefined,
            }
          : undefined,
        temporalMeta: parseTemporalMeta(snap.time_window, snap.baseline_years, snap.data_coverage_years),
      },
      plan: {
        goal: plan.goal,
        constraints: { irrigation: plan.constraints.irrigation as IrrigationConstraint },
        progressMode: (plan.progress_mode as ProgressMode | undefined) ?? 'stable',
        taskType: plan.task_type as PlanTaskType,
        scenarioPack: {
          id: plan.scenario_pack.id as ScenarioPackId,
          name: plan.scenario_pack.name,
          description: plan.scenario_pack.description,
        },
        summary: plan.summary,
        stages: mappedStages,
        ruleTraces: plan.rule_traces.map((r) => ({
          ruleId: r.rule_id,
          title: r.title,
          trigger: r.trigger,
          evidence: r.evidence,
          explanation: r.explanation,
          source: r.source,
        })),
        uncertaintyNote: plan.uncertainty_note,
      },
    };
  }
  async chatPlan(sessionId: string, message: string, chatHistory: PlanChatMessage[], signal?: AbortSignal): Promise<PlanChatResponse> {
    const response = await fetch(this.apiUrl('/api/plan/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: this.withTimeoutSignal(signal, PLAN_API_TIMEOUT_MS),
      body: JSON.stringify({
        session_id: sessionId,
        message: message,
      }),
    });
    const raw = await this.readJsonOrThrow<APIPlanChatResponseRaw>(response);
    const knowledgeHits = normalizeKnowledgeHits(raw.knowledge_hits);
    const history: PlanChatMessage[] = Array.isArray(raw.chat_history)
      ? attachKnowledgeHitsToMessages(
          raw.chat_history
            .filter((item) => item && typeof item.content === 'string')
            .map((item) => ({
              role: item.role === 'assistant' ? 'assistant' : 'user',
              content: item.content,
            })),
          knowledgeHits
        )
      : attachKnowledgeHitsToMessages(
          [
            ...chatHistory,
            { role: 'user', content: message },
            { role: 'assistant', content: raw.reply },
          ],
          knowledgeHits
        );
    return {
      sessionId: raw.session_id,
      reply: raw.reply,
      updatedPlanSummary: raw.updated_plan_summary || '',
      ruleTraces: (raw.rule_traces || []).map((r) => ({
        ruleId: r.rule_id,
        title: r.title,
        trigger: r.trigger,
        evidence: r.evidence,
        explanation: r.explanation,
        source: r.source,
      })),
      chatHistory: history,
    };
  }

  async chatGeneral(
    message: string,
    chatHistory: PlanChatMessage[],
    signal?: AbortSignal
  ): Promise<AIChatResponse> {
    const response = await fetch(this.apiUrl('/api/ai/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: this.withTimeoutSignal(signal, PLAN_API_TIMEOUT_MS),
      body: JSON.stringify({
        message,
        chat_history: chatHistory,
      }),
    });
    const raw = await this.readJsonOrThrow<APIGeneralChatResponseRaw>(response);
    const knowledgeHits = normalizeKnowledgeHits(raw.knowledge_hits);
    const history: PlanChatMessage[] = Array.isArray(raw.chat_history)
      ? attachKnowledgeHitsToMessages(
          raw.chat_history
            .filter((item) => item && typeof item.content === 'string')
            .map((item) => ({
              role: item.role === 'assistant' ? 'assistant' : 'user',
              content: item.content,
            })),
          knowledgeHits
        )
      : attachKnowledgeHitsToMessages(
          [
            ...chatHistory,
            { role: 'user', content: message },
            { role: 'assistant', content: raw.reply },
          ],
          knowledgeHits
        );
    return {
      reply: raw.reply,
      chatHistory: history,
    };
  }

  async simulatePlan(
    sessionId: string,
    scenarioPack: ScenarioPackId,
    progressMode: ProgressMode,
    signal?: AbortSignal
  ): Promise<PlanSimulateResponse> {
    const response = await fetch(this.apiUrl('/api/plan/simulate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: this.withTimeoutSignal(signal),
      body: JSON.stringify({
        session_id: sessionId,
        scenario_pack: scenarioPack,
        progress_mode: progressMode,
      }),
    });
    const raw = await this.readJsonOrThrow<APIPlanSimResponseRaw>(response);
    const parsedPercentileBands = parsePercentileBands(raw.simulation.percentile_bands);
    const parsedParamSources: ParameterSource[] | undefined = raw.simulation.parameter_sources
      ? raw.simulation.parameter_sources.map((s) => ({
          parameter: s.parameter,
          value: s.value,
          std: s.std,
          source: s.source,
        }))
      : undefined;
    const parsedSensitivity: SensitivityItem[] | undefined = raw.simulation.sensitivity
      ? raw.simulation.sensitivity.map((s) => ({
          parameter: s.parameter,
          sensitivity: s.sensitivity,
          varContribution: s.var_contribution,
        }))
      : undefined;
      
    return {
      sessionId: raw.session_id,
      scenarioPack: raw.scenario_pack,
      simulation: {
        progressMode: (raw.simulation.progress_mode as ProgressMode | undefined) ?? 'stable',
        stageCount: raw.simulation.stage_count ?? 4,
        stageLabels: Array.isArray(raw.simulation.stage_labels) ? raw.simulation.stage_labels.map((item) => String(item)) : [...DEFAULT_STAGE_LABELS],
        series: {
          baseline: raw.simulation.series.baseline.map((p) => ({
            stageIndex: Number(p.stage_index),
            shi: Number(p.shi),
            prod: Number(p.prod),
            stab: Number(p.stab),
            soil: Number(p.soil),
            water: Number(p.water),
            salinity: Number(p.salinity),
            terrain: Number(p.terrain),
          })),
          expected: raw.simulation.series.expected.map((p) => ({
            stageIndex: Number(p.stage_index),
            shi: Number(p.shi),
            prod: Number(p.prod),
            stab: Number(p.stab),
            soil: Number(p.soil),
            water: Number(p.water),
            salinity: Number(p.salinity),
            terrain: Number(p.terrain),
          })),
          conservative: raw.simulation.series.conservative.map((p) => ({
            stageIndex: Number(p.stage_index),
            shi: Number(p.shi),
            prod: Number(p.prod),
            stab: Number(p.stab),
            soil: Number(p.soil),
            water: Number(p.water),
            salinity: Number(p.salinity),
            terrain: Number(p.terrain),
          })),
          optimistic: raw.simulation.series.optimistic.map((p) => ({
            stageIndex: Number(p.stage_index),
            shi: Number(p.shi),
            prod: Number(p.prod),
            stab: Number(p.stab),
            soil: Number(p.soil),
            water: Number(p.water),
            salinity: Number(p.salinity),
            terrain: Number(p.terrain),
          })),
        },
        comparison: {
          baselineEndShi: raw.simulation.comparison.baseline_end_shi,
          expectedEndShi: raw.simulation.comparison.expected_end_shi,
          conservativeEndShi: raw.simulation.comparison.conservative_end_shi,
          optimisticEndShi: raw.simulation.comparison.optimistic_end_shi,
          expectedDeltaShi: raw.simulation.comparison.expected_delta_shi,
        },
        percentileBands: parsedPercentileBands,
        hasMonteCarlo: raw.simulation.has_monte_carlo ?? undefined,
        nSamples: raw.simulation.n_samples ?? undefined,
        parameterSources: parsedParamSources,
        sensitivity: parsedSensitivity,
        mlReference: raw.simulation.ml_reference
          ? {
              modelType: raw.simulation.ml_reference.model_type ?? undefined,
              featureYear: raw.simulation.ml_reference.feature_year ?? undefined,
              targetYear: raw.simulation.ml_reference.target_year ?? undefined,
              baseShiClick:
                raw.simulation.ml_reference.base_shi_click ??
                raw.simulation.ml_reference.base_shi ??
                undefined,
              baseShiFeatureYear:
                raw.simulation.ml_reference.base_shi_feature_year ??
                raw.simulation.ml_reference.base_shi ??
                undefined,
              predDeltaShi: raw.simulation.ml_reference.pred_delta_shi ?? undefined,
              predEndShi: raw.simulation.ml_reference.pred_end_shi ?? undefined,
              currentPredShi: raw.simulation.ml_reference.current_pred_shi ?? undefined,
              ruleExpectedEndShi: raw.simulation.ml_reference.rule_expected_end_shi ?? undefined,
              differenceVsRuleExpected: raw.simulation.ml_reference.difference_vs_rule_expected ?? undefined,
              trainR2: raw.simulation.ml_reference.train_r2 ?? undefined,
              trainRmse: raw.simulation.ml_reference.train_rmse ?? undefined,
              trainN: raw.simulation.ml_reference.train_n ?? undefined,
              comparabilityNote: raw.simulation.ml_reference.comparability_note ?? undefined,
              uncertaintyNote: raw.simulation.ml_reference.uncertainty_note ?? undefined,
            }
          : undefined,
        uncertaintyNote: raw.simulation.uncertainty_note,
      },
      ruleTraces: raw.rule_traces.map((r) => ({
        ruleId: r.rule_id,
        title: r.title,
        trigger: r.trigger,
        evidence: r.evidence,
        explanation: r.explanation,
        source: r.source,
      })),
    };
  }

  async getModelInfo(profileId?: string): Promise<ModelInfo> {
    try {
      const url = new URL(this.apiUrl('/api/model/info'), window.location.origin);
      if (profileId) {
        url.searchParams.append('profile', profileId);
      }
      const response = await fetch(url.toString(), { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
      const data = await this.readJsonOrThrow<{
        ok: boolean;
        trained: boolean;
        r2: number | null;
        rmse: number | null;
        n_samples: number;
        feature_importance: Array<{ feature: string; label: string; importance: number }>;
      }>(response);
      return {
        trained: data.trained,
        r2: data.r2,
        rmse: data.rmse,
        nSamples: data.n_samples,
        featureImportance: (data.feature_importance || []).map((f) => ({
          feature: f.feature,
          label: f.label,
          importance: f.importance,
        })),
      };
    } catch (err) {
      console.warn('getModelInfo failed:', err);
      return { trained: false, r2: null, rmse: null, nSamples: 0, featureImportance: [] };
    }
  }

  async searchLocation(query: string): Promise<Array<{
    name: string;
    lon: number;
    lat: number;
    bbox?: [number, number, number, number];
    type: string;
  }>> {
    const url = new URL(this.apiUrl('/api/geo/search'), window.location.origin);
    url.searchParams.append('q', query);
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
    const data = await this.readJsonOrThrow<{ ok: boolean; results: Array<{ name: string; lon: number; lat: number; bbox?: [number, number, number, number]; type: string }> }>(response);
    return data.results || [];
  }

  async getCountyStats(profileId?: string): Promise<Array<{
    name: string;
    type: string;
    centroid: [number, number];
    bbox: [number, number, number, number];
    pixel_count: number;
    shi_mean: number;
    shi_median: number;
    healthy_pct: number;
    sub_healthy_pct: number;
    unhealthy_pct: number;
    soil_mean?: number | null;
    water_mean?: number | null;
    salinity_mean?: number | null;
    terrain_mean?: number | null;
    dominant_constraint?: string | null;
    priority_level?: string | null;
  }>> {
    const url = new URL(this.apiUrl('/api/geo/county_stats'), window.location.origin);
    if (profileId) {
      url.searchParams.append('profile', profileId);
    }
    const response = await fetch(url.toString(), { signal: AbortSignal.timeout(60000) });
    const data = await this.readJsonOrThrow<{ ok: boolean; stats: Array<Record<string, unknown>> }>(response);
    return (data.stats || []) as Array<{
      name: string;
      type: string;
      centroid: [number, number];
      bbox: [number, number, number, number];
      pixel_count: number;
      shi_mean: number;
      shi_median: number;
      healthy_pct: number;
      sub_healthy_pct: number;
      unhealthy_pct: number;
      soil_mean?: number | null;
      water_mean?: number | null;
      salinity_mean?: number | null;
      terrain_mean?: number | null;
      dominant_constraint?: string | null;
      priority_level?: string | null;
    }>;
  }
}

export const shiService = new SHIService();
