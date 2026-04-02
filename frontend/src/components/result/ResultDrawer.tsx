import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  History,
  Info,
  LineChart,
  MapPin,
  Sparkles,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ClickResult, ClickResultEvaluated, ClickResultNotEvaluated, CropProfileInfo, CropSupportInfo, FeatureImportance, LocationInfo, ParameterSource, SensitivityItem } from '../../models/shi';
import { shiService } from '../../services/shiService';
import { useAssistantStore } from '../../store/assistantStore';
import { useMapStore } from '../../store/mapStore';
import type { MapLayerId } from '../../store/mapStore';
import { usePlanStore } from '../../store/planStore';
import { useResultStore } from '../../store/resultStore';
import { getSimulationPanelState, getSimulationPlanState, isSimulationResultCurrent } from './resultDrawerSimulationState';
import { progressModeLabel } from '../../utils/progressMode';
import type { SimChartHandle } from './SimChart';
import './ResultDrawer.css';

const loadSimChart = () => import('./SimChart');
const SimChart = lazy(loadSimChart);

const SimChartFallback = () => (
  <div style={{ minHeight: '220px', display: 'grid', placeItems: 'center', color: '#8c8278' }}>
    模拟图表加载中...
  </div>
);

const isEvaluatedResult = (result: ClickResult): result is ClickResultEvaluated => result.status === 'evaluated';
const isNotEvaluatedResult = (result: ClickResult): result is ClickResultNotEvaluated => result.status === 'not_evaluated';

const formatErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return '请求超时，请稍后重试或提高规划接口超时配置（VITE_PLAN_API_TIMEOUT_MS，通用配置为 VITE_API_TIMEOUT_MS）。';
  }
  if (error instanceof Error && /timed out/i.test(error.message)) {
    return '请求超时，请稍后重试或提高规划接口超时配置（VITE_PLAN_API_TIMEOUT_MS，通用配置为 VITE_API_TIMEOUT_MS）。';
  }
  return error instanceof Error && error.message ? error.message : fallback;
};

const formatLocation = (location?: LocationInfo): string | null => {
  if (!location) return null;
  const parts = [location.prefecture, location.county].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
};

const ParamSourcesSection: React.FC<{ sources: ParameterSource[] }> = ({ sources }) => {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="param-sources-section">
      <button className="param-sources-toggle" onClick={() => setExpanded(!expanded)}>
        <Info size={14} />
        <span>参数来源（{sources.length} 项）</span>
        <span className="toggle-arrow">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="param-sources-list">
          {sources.map((s) => (
            <div key={s.parameter} className="param-source-item">
              <span className="param-name">{s.parameter}</span>
              <span className="param-value">{s.value.toFixed(3)} ± {s.std.toFixed(3)}</span>
              <span className="param-ref">{s.source}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const FeatureImportanceSection: React.FC<{ features: FeatureImportance[] }> = ({ features }) => {
  if (features.length === 0) return null;
  const maxImp = Math.max(...features.map((f) => f.importance), 0.01);
  return (
    <div className="feature-importance-section">
      <h5>空间对照因子贡献</h5>
      <div className="fi-bars">
        {features.slice(0, 8).map((f) => (
          <div key={f.feature} className="fi-bar-item">
            <div className="fi-bar-label">
              <span>{f.label}</span>
              <span>{(f.importance * 100).toFixed(1)}%</span>
            </div>
            <div className="fi-bar-bg">
              <div
                className="fi-bar-fill"
                style={{ width: `${(f.importance / maxImp) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const SensitivitySection: React.FC<{ items: SensitivityItem[] }> = ({ items }) => {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
  const total = items.reduce((sum, item) => sum + item.sensitivity, 0);
  return (
    <div className="param-sources-section">
      <button className="param-sources-toggle" onClick={() => setExpanded(!expanded)}>
        <Info size={14} />
        <span>敏感性分析（方差分解）</span>
        <span className="toggle-arrow">{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div className="sensitivity-content">
          <div className="sensitivity-stack-bar">
            {items.map((item) => {
              const pct = total > 0 ? (item.sensitivity / total) * 100 : 0;
              if (pct < 2) return null;
              return (
                <div
                  key={item.parameter}
                  className="sensitivity-segment"
                  style={{ width: `${pct}%` }}
                  title={`${item.parameter}: ${(item.sensitivity * 100).toFixed(1)}%`}
                >
                  {pct > 8 && <span className="segment-label">{item.parameter.replace('_impact', '')}</span>}
                </div>
              );
            })}
          </div>
          <div className="sensitivity-detail-list">
            {items.map((item, idx) => (
              <div key={item.parameter} className="sensitivity-detail-item">
                <span className="sensitivity-dot" style={{ backgroundColor: `hsl(${idx * 45}, 65%, 55%)` }} />
                <span className="sensitivity-name">{item.parameter}</span>
                <span className="sensitivity-pct">{(item.sensitivity * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const LAYER_META: Record<MapLayerId, { title: string; desc: string; note?: string }> = {
  cotton_shi: {
    title: '棉花土壤质量评分',
    desc: '棉花主导像元的土壤质量评分（2010–2025，5–9月）。',
  },
  sugarbeet_shi: {
    title: '甜菜土壤质量评分',
    desc: '甜菜主导像元的土壤质量评分（2010–2025，5–9月）。',
  },
  maize_shi: {
    title: '玉米土壤质量评分',
    desc: '玉米主导像元的土壤质量评分（2010到2025，5到9月）。',
  },
  cropland: {
    title: '耕地分布 (2023)',
    desc: '当前数据为耕地掩膜，用于表示是否为耕地。',
  },
  soil_norm: {
    title: '土壤本底',
    desc: '主分项：土壤本底支撑（0–1）。',
  },
  water_norm: {
    title: '供水支撑',
    desc: '主分项：供水支撑（0–1）。',
  },
  drought_risk: {
    title: '干旱风险',
    desc: '气象旁路风险指标（0–1）。',
  },
  heat_risk: {
    title: '热胁迫风险',
    desc: '气象旁路风险指标（0–1）。',
  },
};

const formatPercent = (value?: number | null, digits = 0): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const normalized = value > 1.01 ? value / 100 : value;
  return `${(normalized * 100).toFixed(digits)}%`;
};

const getCroplandMaskState = (value?: number | null) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  if (value >= 0.5) return { label: '耕地', className: 'cropland-yes' };
  return { label: '非耕地', className: 'cropland-no' };
};

const ResultDrawer: React.FC = () => {
  const navigate = useNavigate();
  const openContextualAssistant = useAssistantStore((state) => state.openContextualAssistant);
  const { clickedPoint, activeLayer, activeScoreProfileId } = useMapStore();
  const { status, currentResult, lastError, setStatus, setCurrentResult, history } = useResultStore();
  const {
    activeTab,
    setActiveTab,
    selectedScenarioPack,
    selectedObjective,
    selectedIrrigation,
    selectedProgressMode,
    planStatus,
    simulationStatus,
    planError,
    simulationError,
    planResult,
    simulationResult,
    setSimulationStatus,
    setSimulationError,
    setSimulationResult,
  } = usePlanStore();

  const [featureImportance, setFeatureImportance] = useState<FeatureImportance[]>([]);
  const chartRef = useRef<SimChartHandle>(null);
  const evaluatedResult = status === 'evaluated' && currentResult && isEvaluatedResult(currentResult) ? currentResult : null;
  const notEvaluatedResult =
    status === 'not_evaluated' && currentResult && isNotEvaluatedResult(currentResult) ? currentResult : null;
  const sampledPoint = useMemo(() => {
    if (!currentResult) return null;
    if (typeof currentResult.sampleLon === 'number' && typeof currentResult.sampleLat === 'number') {
      return { lon: currentResult.sampleLon, lat: currentResult.sampleLat };
    }
    return null;
  }, [currentResult]);
  const targetPoint = useMemo(() => {
    if (evaluatedResult) {
      return sampledPoint ?? { lon: evaluatedResult.lon, lat: evaluatedResult.lat };
    }
    if (clickedPoint) {
      return { lon: clickedPoint[0], lat: clickedPoint[1] };
    }
    return null;
  }, [evaluatedResult, clickedPoint, sampledPoint]);

  // Fetch model info (feature importance) when simulation tab first activated
  useEffect(() => {
    if (activeTab !== 'simulation') return;
    void loadSimChart();
    let cancelled = false;
    shiService.getModelInfo(activeScoreProfileId).then((info) => {
      if (cancelled) return;
      setFeatureImportance(info.featureImportance.length > 0 ? info.featureImportance : []);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, activeScoreProfileId]);

  const renderTemporalMeta = (meta?: { timeWindow?: number[]; baselineYears?: [number, number]; dataCoverageYears?: number }) => {
    if (!meta) return null;
    const monthText = meta.timeWindow?.length ? meta.timeWindow.join('、') : '5、6、7、8、9';
    const baselineText =
      meta.baselineYears && meta.baselineYears.length >= 2
        ? `${meta.baselineYears[0]}–${meta.baselineYears[1]}`
        : '2010–2025';
    return (
      <div className="temporal-meta-card">
        <h4 className="sub-title">时间范围</h4>
        <div className="temporal-meta-grid">
          <div className="metric-card">
            <span>时间窗</span>
            <strong>{monthText} 月</strong>
          </div>
          <div className="metric-card">
            <span>基线年份</span>
            <strong>{baselineText}</strong>
          </div>
          {typeof meta.dataCoverageYears === 'number' && (
            <div className="metric-card">
              <span>像元有效年数</span>
              <strong>{meta.dataCoverageYears}</strong>
            </div>
          )}
        </div>
      </div>
    );
  };

  const layerMeta = LAYER_META[activeLayer];

  const renderLayerContext = () => (
    <div className="layer-context-card">
      <span className="layer-context-kicker">当前图层</span>
      <div className="layer-context-title">{layerMeta.title}</div>
      <p className="layer-context-desc">{layerMeta.desc}</p>
    </div>
  );

  const renderLayerNote = () => {
    if (!layerMeta.note) return null;
    return (
      <div className="status-card info compact layer-note">
        <Info size={16} />
        <span>{layerMeta.note}</span>
      </div>
    );
  };

  const renderCropProfile = (profile?: CropProfileInfo) => {
    if (!profile) return null;
    return (
      <div className="temporal-meta-card">
        <h4 className="sub-title">当前分型</h4>
        <div className="temporal-meta-grid">
          <div className="metric-card">
            <span>主导类型</span>
            <strong>{profile.supportLabel ? `${profile.supportLabel}主导像元` : profile.profileName}</strong>
          </div>
          <div className="metric-card">
            <span>{profile.supportLabel}占比</span>
            <strong>{formatPercent(profile.supportFraction, 0)}</strong>
          </div>
        </div>
        <div className="status-card info compact">
          <Info size={16} />
          <span>识别依据：{profile.profileReason}</span>
        </div>
      </div>
    );
  };

  const renderCropSupport = (cropSupport?: CropSupportInfo) => {
    if (!cropSupport) return null;
    const hasMean = typeof cropSupport.ndviMeanNorm === 'number';
    const hasStability = typeof cropSupport.ndviStabilityNorm === 'number';
    if (!hasMean && !hasStability && !cropSupport.note) return null;
    return (
      <div className="component-section">
        <h4 className="sub-title">作物表现旁路</h4>
        <div className="component-bars">
          {hasMean && (
            <div className="bar-item">
              <div className="bar-label">
                <span>NDVI 均值代理</span>
                <span>{formatPercent(cropSupport.ndviMeanNorm, 0)}</span>
              </div>
              <div className="bar-bg">
                <div className="bar-fill healthy" style={{ width: `${(cropSupport.ndviMeanNorm ?? 0) * 100}%` }}></div>
              </div>
            </div>
          )}
          {hasStability && (
            <div className="bar-item">
              <div className="bar-label">
                <span>NDVI 稳定性代理</span>
                <span>{formatPercent(cropSupport.ndviStabilityNorm, 0)}</span>
              </div>
              <div className="bar-bg">
                <div className="bar-fill primary" style={{ width: `${(cropSupport.ndviStabilityNorm ?? 0) * 100}%` }}></div>
              </div>
            </div>
          )}
        </div>
        {cropSupport.note && (
          <div className="status-card info compact">
            <Info size={16} />
            <span>{cropSupport.note}</span>
          </div>
        )}
      </div>
    );
  };

  const renderPrimaryValue = (value: string, label: string, tag?: React.ReactNode) => (
    <div className="score-section">
      <div className="score-main">
        <span className="score-value">{value}</span>
        <span className="score-label">{label}</span>
      </div>
      {tag}
    </div>
  );

  const renderLayerSpecificValue = () => {
    if (!evaluatedResult) return null;
    switch (activeLayer) {
      case 'cropland': {
        const croplandValue = evaluatedResult.components.croplandFraction;
        const state = getCroplandMaskState(croplandValue);
        return renderPrimaryValue(
          state?.label || '—',
          '耕地分布',
          state ? <div className={`level-tag ${state.className}`}>掩膜值 {croplandValue >= 0.5 ? '1' : '0'}</div> : undefined
        );
      }
      case 'soil_norm': {
        const soilValue = evaluatedResult.components.soilBaseNorm ?? evaluatedResult.components.soilNorm;
        return renderPrimaryValue(formatPercent(soilValue, 0), '土壤本底');
      }
      case 'water_norm': {
        const waterValue = evaluatedResult.components.waterSupplyNorm ?? evaluatedResult.components.waterNorm;
        return renderPrimaryValue(formatPercent(waterValue, 0), '供水支撑');
      }
      case 'drought_risk': {
        const droughtValue = evaluatedResult.risk?.droughtRisk;
        return (
          <>
            {renderPrimaryValue(formatPercent(droughtValue, 0), '干旱风险')}
            {evaluatedResult.risk?.riskLevel && (
              <div className={`risk-level-chip level-${evaluatedResult.risk.riskLevel}`}>综合风险等级：{evaluatedResult.risk.riskLevel}</div>
            )}
          </>
        );
      }
      case 'heat_risk': {
        const heatValue = evaluatedResult.risk?.heatRisk;
        return (
          <>
            {renderPrimaryValue(formatPercent(heatValue, 0), '热胁迫风险')}
            {evaluatedResult.risk?.riskLevel && (
              <div className={`risk-level-chip level-${evaluatedResult.risk.riskLevel}`}>综合风险等级：{evaluatedResult.risk.riskLevel}</div>
            )}
          </>
        );
      }
      case 'cotton_shi':
      case 'sugarbeet_shi':
      default:
        return null;
    }
  };

  const renderCoordsFooter = () => {
    if (!evaluatedResult) return null;
    return (
      <>
        <div className="coords-info footer">
          <span>经度: {evaluatedResult.lon.toFixed(4)}</span>
          <span>纬度: {evaluatedResult.lat.toFixed(4)}</span>
        </div>
        {sampledPoint && (
          <div className="coords-info footer">
            <span>采样像元经度: {sampledPoint.lon.toFixed(4)}</span>
            <span>采样像元纬度: {sampledPoint.lat.toFixed(4)}</span>
          </div>
        )}
      </>
    );
  };

  const simulationPlanState = useMemo(
    () => getSimulationPlanState(planResult, {
      scenarioPack: selectedScenarioPack,
      objective: selectedObjective,
      irrigation: selectedIrrigation,
      progressMode: selectedProgressMode,
    }),
    [planResult, selectedScenarioPack, selectedObjective, selectedIrrigation, selectedProgressMode],
  );

  const hasCurrentSimulation = useMemo(
    () =>
      planResult
        ? isSimulationResultCurrent(simulationResult, {
            sessionId: planResult.sessionId,
            scenarioPack: selectedScenarioPack,
            progressMode: selectedProgressMode,
          })
        : false,
    [planResult, simulationResult, selectedScenarioPack, selectedProgressMode],
  );

  const simulationPanelState = useMemo(
    () =>
      getSimulationPanelState({
        planState: simulationPlanState,
        hasCurrentSimulation,
      }),
    [simulationPlanState, hasCurrentSimulation],
  );

  const onClose = () => {
    setStatus('idle');
    setCurrentResult(null);
  };

  const goToAssistant = (autoLaunch = false) => {
    openContextualAssistant({ autoLaunch });
    navigate('/ai');
  };

  const onRunSimulation = async () => {
    if (!planResult?.sessionId) return;
    setActiveTab('simulation');
    if (simulationPlanState === 'plan_regeneration_required') return;
    setSimulationStatus('loading');
    setSimulationError(null);
    try {
      const result = await shiService.simulatePlan(
        planResult.sessionId,
        selectedScenarioPack,
        selectedProgressMode,
      );
      setSimulationResult(result);
      setSimulationStatus('ready');
    } catch (error: unknown) {
      setSimulationStatus('error');
      setSimulationError(formatErrorMessage(error, '模拟失败'));
    }
  };

  const renderAssessmentContent = () => {
    if (status === 'idle') {
      return (
        <div className="empty-state">
          <MapPin size={48} className="empty-icon" />
          <h3>请在地图上点击</h3>
          <p>点击任意位置查看特色作物评分、耕地背景与风险图层解释。</p>
        </div>
      );
    }

    if (status === 'loading') {
      return (
        <div className="loading-state">
          <div className="spinner"></div>
          <p>正在评估中...</p>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <div className="error-state">
          <AlertCircle size={40} className="error-icon" />
          <h3>查询失败</h3>
          <p>{lastError || '服务暂时不可用，请稍后重试。'}</p>
        </div>
      );
    }

    if (status === 'outside_aoi') {
      const locationText = formatLocation(currentResult?.location);
      return (
        <div className="status-card info">
          <Info size={24} />
          <div className="status-text">
            <h3>超出评估范围</h3>
            <p>当前仅支持新疆范围内评估。</p>
          </div>
          {locationText && <div className="location-info"><MapPin size={14} /><span>{locationText}</span></div>}
          <div className="coords-info">
            <span>经度: {currentResult?.lon.toFixed(4)}</span>
            <span>纬度: {currentResult?.lat.toFixed(4)}</span>
          </div>
        </div>
      );
    }

    if (status === 'not_evaluated') {
      const locationText = formatLocation(notEvaluatedResult?.location);
      const croplandState = getCroplandMaskState(notEvaluatedResult?.croplandFraction);
      if (activeLayer === 'cropland') {
        return (
          <div className="result-success">
            {renderLayerContext()}
            {renderPrimaryValue(
              croplandState?.label || '未判定',
              '耕地分布',
              croplandState ? (
                <div className={`level-tag ${croplandState.className}`}>
                  掩膜值 {notEvaluatedResult?.croplandFraction !== undefined && notEvaluatedResult.croplandFraction >= 0.5 ? '1' : '0'}
                </div>
              ) : undefined
            )}
            <div className="status-card warning compact">
              <AlertCircle size={16} />
              <span className="partial-data-hint">
                当前点位不在当前特色作物评分适用范围，仍可查看耕地分布。
              </span>
            </div>
            {renderCropProfile(notEvaluatedResult?.profile)}
            {locationText && <div className="location-info"><MapPin size={14} /><span>{locationText}</span></div>}
            <div className="coords-info">
              <span>经度: {currentResult?.lon.toFixed(4)}</span>
              <span>纬度: {currentResult?.lat.toFixed(4)}</span>
            </div>
            {sampledPoint && (
              <div className="coords-info">
                <span>采样像元经度: {sampledPoint.lon.toFixed(4)}</span>
                <span>采样像元纬度: {sampledPoint.lat.toFixed(4)}</span>
              </div>
            )}
          </div>
        );
      }
      const isRiskLayer = activeLayer === 'drought_risk' || activeLayer === 'heat_risk';
      const riskValue = isRiskLayer
        ? activeLayer === 'drought_risk'
          ? notEvaluatedResult?.risk?.droughtRisk
          : notEvaluatedResult?.risk?.heatRisk
        : undefined;
      const showRisk = typeof riskValue === 'number';
      if (isRiskLayer && showRisk) {
        return (
          <div className="result-success">
            {renderLayerContext()}
            {renderPrimaryValue(formatPercent(riskValue, 0), activeLayer === 'drought_risk' ? '干旱风险' : '热胁迫风险')}
            {notEvaluatedResult?.risk?.riskLevel && (
              <div className={`risk-level-chip level-${notEvaluatedResult.risk.riskLevel}`}>综合风险等级：{notEvaluatedResult.risk.riskLevel}</div>
            )}
            <div className="status-card warning compact">
              <AlertCircle size={16} />
              <span className="partial-data-hint">当前点位不在当前特色作物评分适用范围，仍可查看风险水平。</span>
            </div>
            {renderCropProfile(notEvaluatedResult?.profile)}
            {locationText && <div className="location-info"><MapPin size={14} /><span>{locationText}</span></div>}
            <div className="coords-info">
              <span>经度: {currentResult?.lon.toFixed(4)}</span>
              <span>纬度: {currentResult?.lat.toFixed(4)}</span>
            </div>
            {sampledPoint && (
              <div className="coords-info">
                <span>采样像元经度: {sampledPoint.lon.toFixed(4)}</span>
                <span>采样像元纬度: {sampledPoint.lat.toFixed(4)}</span>
              </div>
            )}
            {renderTemporalMeta(notEvaluatedResult?.temporalMeta)}
          </div>
        );
      }

      const outsideProfileScope =
        notEvaluatedResult?.reason === 'outside_cotton_profile_scope' ||
        notEvaluatedResult?.reason === 'outside_sugarbeet_profile_scope' ||
        notEvaluatedResult?.reason === 'outside_maize_profile_scope';
      return (
        <>
          <div className="status-card warning">
            <AlertCircle size={24} />
            <div className="status-text">
              <h3>{outsideProfileScope ? '当前点位不在当前特色作物评分适用范围' : '当前点位暂无法评估'}</h3>
              <p>{outsideProfileScope ? (notEvaluatedResult?.profile?.profileReason || '该位置属于耕地，但当前特色作物占比未达到主导阈值。') : '该位置为非耕地或有效数据不足。'}</p>
            </div>
            <div className="detail-item">
              <span className="label">耕地掩膜:</span>
              <span className="value">
                {croplandState?.label || '未知'}
              </span>
            </div>
            {locationText && <div className="location-info"><MapPin size={14} /><span>{locationText}</span></div>}
            <div className="coords-info">
              <span>经度: {currentResult?.lon.toFixed(4)}</span>
              <span>纬度: {currentResult?.lat.toFixed(4)}</span>
            </div>
            {sampledPoint && (
              <div className="coords-info">
                <span>采样像元经度: {sampledPoint.lon.toFixed(4)}</span>
                <span>采样像元纬度: {sampledPoint.lat.toFixed(4)}</span>
              </div>
            )}
          </div>
          {renderCropProfile(notEvaluatedResult?.profile)}
          {renderTemporalMeta(notEvaluatedResult?.temporalMeta)}
        </>
      );
    }

    if (!evaluatedResult) return null;
    const hasRisk =
      typeof evaluatedResult.risk?.droughtRisk === 'number' ||
      typeof evaluatedResult.risk?.heatRisk === 'number' ||
      typeof evaluatedResult.risk?.combinedRisk === 'number';
    const evalLocationText = formatLocation(evaluatedResult.location);
    const showDataQuality =
      activeLayer === 'cotton_shi' ||
      activeLayer === 'sugarbeet_shi' ||
      activeLayer === 'maize_shi' ||
      activeLayer === 'soil_norm' ||
      activeLayer === 'water_norm';
    const showTemporalMeta = activeLayer !== 'cropland';

    if (activeLayer !== 'cotton_shi' && activeLayer !== 'sugarbeet_shi' && activeLayer !== 'maize_shi') {
      return (
        <div className="result-success">
          {renderLayerContext()}
          {renderLayerNote()}
          {renderLayerSpecificValue()}
          {renderCropProfile(evaluatedResult.profile)}

          {evalLocationText && (
            <div className="location-info evaluated">
              <MapPin size={14} />
              <span>{evalLocationText}</span>
            </div>
          )}

          {showDataQuality && typeof evaluatedResult.components.dataQuality === 'number' && evaluatedResult.components.dataQuality < 4 && (
            <div className="status-card warning compact">
              <AlertTriangle size={16} />
              <span className="partial-data-hint">
                数据完整度 {evaluatedResult.components.dataQuality}/4 — 评分基于可用分量加权
              </span>
            </div>
          )}

          {showTemporalMeta && renderTemporalMeta(evaluatedResult.temporalMeta)}
          {renderCoordsFooter()}
        </div>
      );
    }

    return (
      <div className="result-success">
        <div className="score-section">
          <div className="score-main">
            <span className="score-value">{evaluatedResult.shiScore.toFixed(1)}</span>
            <span className="score-label">
              {activeScoreProfileId === 'sugarbeet'
                ? '甜菜土壤质量评分'
                : activeScoreProfileId === 'maize'
                  ? '玉米土壤质量评分'
                  : '棉花土壤质量评分'}
            </span>
          </div>
        <div className={`level-tag ${evaluatedResult.shiLevel}`}>{evaluatedResult.shiLevel}</div>
        </div>

        {evalLocationText && (
          <div className="location-info evaluated">
            <MapPin size={14} />
            <span>{evalLocationText}</span>
          </div>
        )}

        {typeof evaluatedResult.components.dataQuality === 'number' && evaluatedResult.components.dataQuality < 4 && (
          <div className="status-card warning compact">
            <AlertTriangle size={16} />
            <span className="partial-data-hint">
              数据完整度 {evaluatedResult.components.dataQuality}/4 — 评分基于可用分量加权
            </span>
          </div>
        )}

        {renderCropProfile(evaluatedResult.profile)}
        {renderTemporalMeta(evaluatedResult.temporalMeta)}

        <div className="component-section">
          <h4 className="sub-title">分项贡献</h4>
          <div className="component-bars">
            {[
              ['土壤本底 (Soil Base)', evaluatedResult.components.soilBaseNorm ?? evaluatedResult.components.soilNorm, 'soil'],
              ['供水支撑 (Water Supply)', evaluatedResult.components.waterSupplyNorm ?? evaluatedResult.components.waterNorm, 'water'],
              ['盐分安全 (Salt Safety)', evaluatedResult.components.saltSafetyNorm ?? evaluatedResult.components.salinityNorm, 'salinity'],
              ['地形约束 (Terrain)', evaluatedResult.components.terrainNorm, 'terrain'],
            ].map(([label, value, cls]) =>
              typeof value === 'number' ? (
                <div className="bar-item" key={label}>
                  <div className="bar-label">
                    <span>{label}</span>
                    <span>{(value * 100).toFixed(0)}%</span>
                  </div>
                  <div className="bar-bg">
                    <div className={`bar-fill ${cls}`} style={{ width: `${value * 100}%` }}></div>
                  </div>
                </div>
              ) : null
            )}
          </div>
        </div>

        {renderCropSupport(
          evaluatedResult.cropSupport ?? {
            ndviMeanNorm: evaluatedResult.components.prodNorm,
            ndviStabilityNorm: evaluatedResult.components.stabNorm,
            note: 'NDVI 均值/稳定性仅作作物表现旁路解释，不参与主分。',
          }
        )}

        {hasRisk && (
          <div className="risk-section">
            <h4 className="sub-title">
              <AlertTriangle size={16} />
              <span>气象极端风险（旁路）</span>
            </h4>
            <div className="risk-grid">
              {typeof evaluatedResult.risk?.droughtRisk === 'number' && (
                <div className="risk-card">
                  <span className="risk-label">干旱风险</span>
                  <strong>{(evaluatedResult.risk.droughtRisk * 100).toFixed(0)}%</strong>
                </div>
              )}
              {typeof evaluatedResult.risk?.heatRisk === 'number' && (
                <div className="risk-card">
                  <span className="risk-label">热胁迫风险</span>
                  <strong>{(evaluatedResult.risk.heatRisk * 100).toFixed(0)}%</strong>
                </div>
              )}
              {typeof evaluatedResult.risk?.combinedRisk === 'number' && (
                <div className="risk-card">
                  <span className="risk-label">综合风险</span>
                  <strong>{(evaluatedResult.risk.combinedRisk * 100).toFixed(0)}%</strong>
                </div>
              )}
            </div>
            {evaluatedResult.risk?.riskLevel && (
              <div className={`risk-level-chip level-${evaluatedResult.risk.riskLevel}`}>风险等级：{evaluatedResult.risk.riskLevel}</div>
            )}
          </div>
        )}

        <div className="advice-section">
          <h4 className="sub-title">改良建议</h4>
          <ul className="advice-list">
            {evaluatedResult.advice.map((item, idx) => (
              <li key={idx} className="advice-item">
                <CheckCircle2 size={16} className="advice-icon" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="drawer-actions">
          <button className="action-btn primary" onClick={() => goToAssistant(true)} disabled={!evaluatedResult}>
            <Sparkles size={15} />
            <span>进入规划</span>
          </button>
          <button
            className="action-btn secondary"
            onClick={onRunSimulation}
            disabled={!planResult || simulationStatus === 'loading'}
          >
            <LineChart size={15} />
            <span>{simulationStatus === 'loading' ? '模拟中...' : '运行模拟'}</span>
          </button>
        </div>

        <div className="coords-info footer">
          <span>经度: {evaluatedResult.lon.toFixed(4)}</span>
          <span>纬度: {evaluatedResult.lat.toFixed(4)}</span>
        </div>
        {sampledPoint && (
          <div className="coords-info footer">
            <span>采样像元经度: {sampledPoint.lon.toFixed(4)}</span>
            <span>采样像元纬度: {sampledPoint.lat.toFixed(4)}</span>
          </div>
        )}
      </div>
    );
  };

  const renderPlanContent = () => {
    if (!targetPoint) {
      return <div className="empty-inline">先在地图点击一个地块。</div>;
    }
    if (!evaluatedResult) {
      return <div className="empty-inline">当前点位不在当前特色作物评分适用范围，暂不能生成规划。</div>;
    }
    if (planStatus === 'loading') {
      return (
        <div className="loading-state compact">
          <div className="spinner"></div>
          <p>规划生成中...</p>
        </div>
      );
    }
    if (planStatus === 'error') {
      return (
        <div className="status-card warning">
          <AlertCircle size={18} />
          <div className="status-text">
            <h3>生成失败</h3>
            <p>{planError || '请稍后再试'}</p>
          </div>
          <button className="action-btn primary" onClick={() => goToAssistant(true)}>
            <Sparkles size={15} />
            <span>前往规划工作台重试</span>
          </button>
        </div>
      );
    }
    if (!planResult) {
      return (
        <div className="empty-inline">
          <p>如需生成地块规划或继续追问，请前往规划工作台，系统会自动带入当前地块信息。</p>
          <button className="action-btn primary" onClick={() => goToAssistant(true)}>
            <Sparkles size={15} />
            <span>前往规划工作台生成规划</span>
          </button>
        </div>
      );
    }
    return (
      <div className="plan-content">
        <div className="plan-toolbar">
          <div className="status-chip">
            目标：{planResult.plan.goal}｜措施包：{planResult.plan.scenarioPack.name}｜灌溉：{planResult.plan.constraints.irrigation}
          </div>
          <button className="action-btn secondary" onClick={() => goToAssistant(false)}>
            <ArrowRight size={15} />
            <span>前往规划工作台继续聊</span>
          </button>
        </div>
        {simulationPlanState === 'summary_outdated' && (
          <div className="outdated-tip">
            当前摘要沿用旧的措施包或时长设置；下方模拟会按当前选择重新运行。
          </div>
        )}
        {simulationPlanState === 'plan_regeneration_required' && (
          <div className="outdated-tip">
            已切换目标或灌溉约束，需前往规划工作台重新生成规划摘要与情景基线。
          </div>
        )}
        {planResult.snapshot.risk && (
          <div className="status-chip risk-inline">
            风险：干旱 {typeof planResult.snapshot.risk.droughtRisk === 'number' ? `${(planResult.snapshot.risk.droughtRisk * 100).toFixed(0)}%` : '—'}
            ｜热胁迫 {typeof planResult.snapshot.risk.heatRisk === 'number' ? `${(planResult.snapshot.risk.heatRisk * 100).toFixed(0)}%` : '—'}
            ｜等级 {planResult.snapshot.risk.riskLevel || '—'}
          </div>
        )}
        <p className="plan-summary">{planResult.plan.summary}</p>
        <div className="stage-list">
          {planResult.plan.stages.map((stage) => (
            <div className="stage-card" key={stage.stageId}>
              <h5>{stage.title}</h5>
              <ul>
                {stage.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
              {stage.milestones && stage.milestones.length > 0 && (
                <div className="stage-subsection">
                  <strong>阶段里程碑</strong>
                  <ul>
                    {stage.milestones.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {stage.exitConditions && stage.exitConditions.length > 0 && (
                <div className="stage-subsection">
                  <strong>进入下一阶段的条件</strong>
                  <ul>
                    {stage.exitConditions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {stage.fallbackActions && stage.fallbackActions.length > 0 && (
                <div className="stage-subsection">
                  <strong>未达成时怎么升级</strong>
                  <ul>
                    {stage.fallbackActions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="trace-list">
          <h5>触发依据</h5>
          {planResult.plan.ruleTraces.map((trace) => (
            <div className="trace-item" key={trace.ruleId}>
              <strong>{trace.ruleId}</strong>
              <span>{trace.explanation}</span>
            </div>
          ))}
        </div>
        <div className="status-card info compact">
          <Sparkles size={16} />
          <div className="status-text">
            <h3>继续完善规划</h3>
            <p>如需继续追问、细化执行步骤或调整规划设置，请前往规划工作台。</p>
          </div>
        </div>
      </div>
    );
  };

  const renderSimulationContent = () => {
    if (!planResult) {
      return <div className="empty-inline">请先在规划工作台中生成地块规划，再运行模拟。</div>;
    }
    if (simulationStatus === 'loading') {
      return (
        <div className="loading-state compact">
          <div className="spinner"></div>
          <p>规则情景模拟中...</p>
        </div>
      );
    }
    if (simulationStatus === 'error') {
      return (
        <div className="status-card warning">
          <AlertCircle size={18} />
          <div className="status-text">
            <h3>模拟失败</h3>
            <p>{simulationError || '请稍后再试'}</p>
          </div>
          <button className="action-btn secondary" onClick={onRunSimulation}>
            <LineChart size={15} />
            <span>重试模拟</span>
          </button>
        </div>
      );
    }
    if (simulationPanelState === 'plan_regeneration_required') {
      return (
        <div className="status-card warning">
          <AlertTriangle size={18} />
          <div className="status-text">
            <h3>请先更新规划</h3>
            <p>当前目标或灌溉约束已改变，需先重新生成规划，再运行与之匹配的情景模拟。</p>
          </div>
          <button className="action-btn primary" onClick={() => goToAssistant(true)}>
            <Sparkles size={15} />
            <span>前往规划工作台更新规划</span>
          </button>
        </div>
      );
    }
    if (simulationPanelState === 'ready_to_run') {
      return (
        <div className="empty-inline">
          <p>
            {simulationPlanState === 'summary_outdated'
              ? `当前将按${progressModeLabel(selectedProgressMode)}重新运行阶段推演。`
              : `按当前${progressModeLabel(selectedProgressMode)}运行阶段推演。`}
          </p>
          <button className="action-btn secondary" onClick={onRunSimulation}>
            <LineChart size={15} />
            <span>{simulationPlanState === 'summary_outdated' ? '重新运行模拟' : '开始模拟'}</span>
          </button>
        </div>
      );
    }
    const currentSimulationResult = simulationResult;
    if (!currentSimulationResult) {
      return null;
    }
    const comp = currentSimulationResult.simulation.comparison;
    const mlRef = currentSimulationResult.simulation.mlReference;
    const bands = currentSimulationResult.simulation.percentileBands;
    const hasMC = currentSimulationResult.simulation.hasMonteCarlo;
    const paramSources = currentSimulationResult.simulation.parameterSources;
    const sensitivity = currentSimulationResult.simulation.sensitivity;
    return (
      <div className="sim-content">
        {simulationPlanState === 'summary_outdated' && (
          <div className="outdated-tip">当前图表已按新选择完成模拟，但上方规划摘要仍是旧设置。</div>
        )}
        <div className="sim-chart-toolbar">
          <Suspense fallback={<SimChartFallback />}>
            <SimChart
              ref={chartRef}
              series={currentSimulationResult.simulation.series}
              percentileBands={bands}
              mlPredEndShi={mlRef?.predEndShi}
              stageLabels={currentSimulationResult.simulation.stageLabels}
            />
          </Suspense>
          <button className="action-btn secondary export-chart-btn" onClick={() => chartRef.current?.exportPNG()}>
            <Download size={14} />
            <span>导出图表</span>
          </button>
        </div>
        {/* Before → After delta summary */}
        {(() => {
          const baseSorted = [...currentSimulationResult.simulation.series.baseline].sort((a, b) => a.stageIndex - b.stageIndex);
          const startShi = baseSorted.length > 0 ? baseSorted[0].shi : null;
          const endShi = comp.expectedEndShi;
          const delta = startShi !== null ? endShi - startShi : comp.expectedDeltaShi;
          return startShi !== null ? (
            <div className="delta-summary-card">
              <div className="delta-summary-values">
                <div className="delta-summary-item">
                  <span className="delta-summary-label">当前特色作物评分</span>
                  <strong className="delta-summary-value">{startShi.toFixed(1)}</strong>
                </div>
                <span className="delta-summary-arrow">&rarr;</span>
                <div className="delta-summary-item">
                  <span className="delta-summary-label">预期评分</span>
                  <strong className="delta-summary-value" style={{ color: '#3b82f6' }}>{endShi.toFixed(1)}</strong>
                </div>
              </div>
              <div className="delta-summary-change" style={{ color: delta >= 0 ? '#16a34a' : '#ef4444' }}>
                {delta >= 0 ? '+' : ''}{delta.toFixed(1)} 分
              </div>
            </div>
          ) : null;
        })()}
        <div className="sim-metrics">
          <div className="metric-card">
                  <span>{hasMC ? '第三阶段中位数评分' : '第三阶段预期评分'}</span>
            <strong>{comp.expectedEndShi.toFixed(1)}</strong>
          </div>
          <div className="metric-card">
                  <span>相对当前变化量</span>
            <strong>{comp.expectedDeltaShi >= 0 ? '+' : ''}{comp.expectedDeltaShi.toFixed(1)}</strong>
          </div>
          <div className="metric-card">
                  <span>{hasMC ? '第三阶段90%参考范围' : '第三阶段区间范围'}</span>
            <strong>
              {hasMC && bands && bands.length > 0
                ? `${bands[bands.length - 1].p10.toFixed(1)} ~ ${bands[bands.length - 1].p90.toFixed(1)}`
                : `${comp.conservativeEndShi.toFixed(1)} ~ ${comp.optimisticEndShi.toFixed(1)}`
              }
            </strong>
          </div>
        </div>
        {mlRef && typeof mlRef.predEndShi === 'number' && (
          <div className="ml-reference-card">
            <h5>空间对照参考（{mlRef.modelType || 'model'}）</h5>
            <div className="sim-metrics">
              {typeof mlRef.trainR2 === 'number' && (
                <div className="metric-card">
                  <span>历史拟合 R²</span>
                  <strong>{mlRef.trainR2.toFixed(3)}</strong>
                </div>
              )}
              {typeof mlRef.currentPredShi === 'number' && (
                <div className="metric-card">
                  <span>当前参考评分</span>
                  <strong>{mlRef.currentPredShi.toFixed(1)}</strong>
                </div>
              )}
              <div className="metric-card">
                <span>情景参考 SHI</span>
                <strong>{mlRef.predEndShi.toFixed(1)}</strong>
              </div>
              {typeof mlRef.predDeltaShi === 'number' && (
                <div className="metric-card">
                  <span>参考变化量</span>
                  <strong>{mlRef.predDeltaShi >= 0 ? '+' : ''}{mlRef.predDeltaShi.toFixed(1)}</strong>
                </div>
              )}
              {typeof mlRef.differenceVsRuleExpected === 'number' && (
                <div className="metric-card">
                  <span>相对规则模拟</span>
                  <strong>{mlRef.differenceVsRuleExpected >= 0 ? '+' : ''}{mlRef.differenceVsRuleExpected.toFixed(1)}</strong>
                </div>
              )}
            </div>
            <p className="uncertainty">
              {mlRef.featureYear && mlRef.targetYear ? `时窗：${mlRef.featureYear} → ${mlRef.targetYear}。` : ''}
              {mlRef.comparabilityNote ? `${mlRef.comparabilityNote} ` : ''}
              {mlRef.uncertaintyNote || 'ML结果用于趋势对照，不替代因果模拟。'}
            </p>
          </div>
        )}
        {featureImportance.length > 0 && (
          <FeatureImportanceSection features={featureImportance} />
        )}
        {paramSources && paramSources.length > 0 && (
          <ParamSourcesSection sources={paramSources} />
        )}
        {sensitivity && sensitivity.length > 0 && (
          <SensitivitySection items={sensitivity} />
        )}
        <p className="uncertainty">{currentSimulationResult.simulation.uncertaintyNote}</p>
      </div>
    );
  };

  return (
    <aside className="result-drawer">
      <div className="drawer-header">
        <h2 className="drawer-title">地块评估与规划</h2>
        <button className="close-btn" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <div className="tab-row">
        <button className={`tab-btn ${activeTab === 'assessment' ? 'active' : ''}`} onClick={() => setActiveTab('assessment')}>
          评估结果
        </button>
        <button className={`tab-btn ${activeTab === 'plan' ? 'active' : ''}`} onClick={() => setActiveTab('plan')}>
          规划生成
        </button>
        <button className={`tab-btn ${activeTab === 'simulation' ? 'active' : ''}`} onClick={() => setActiveTab('simulation')}>
          模拟对比
        </button>
      </div>

      <div className="drawer-content">
        {activeTab === 'assessment' && renderAssessmentContent()}
        {activeTab === 'plan' && renderPlanContent()}
        {activeTab === 'simulation' && renderSimulationContent()}

        {history.length > 0 && activeTab === 'assessment' && (
          <div className="history-section">
            <h4 className="sub-title">
              <History size={16} />
              <span>最近评估历史</span>
            </h4>
            <div className="history-list">
              {history.map((item, idx) => (
                <div
                  key={idx}
                  className={`history-item${currentResult === item ? ' active' : ''}`}
                  onClick={() => {
                    setCurrentResult(item);
                    setStatus(item.status);
                    useMapStore.getState().flyTo(item.lon, item.lat);
                  }}
                >
                  <div className="history-left">
                    <span className="history-coords">{formatLocation(item.location) || `${item.lon.toFixed(2)}, ${item.lat.toFixed(2)}`}</span>
                    <span className="history-status">{item.status === 'evaluated' ? item.shiLevel : '未评估'}</span>
                  </div>
                  {item.status === 'evaluated' && <span className="history-score">{item.shiScore.toFixed(0)}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};

export default ResultDrawer;
