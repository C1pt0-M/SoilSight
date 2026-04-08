import React, { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { ArrowUpDown, Download, Eye, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../../components/common/AppHeader';
import { shiService } from '../../services/shiService';
import { useMapStore } from '../../store/mapStore';
import { scoreProfileIdToLayer } from '../../store/mapStore';
import { createInitialDataLedgerState, dataLedgerReducer } from './dataLedgerState';
import './DataLedgerPage.css';

const loadDistributionChart = () => import('./DistributionChart');
const loadPrefectureChart = () => import('./PrefectureChart');
const DistributionChart = lazy(loadDistributionChart);
const PrefectureChart = lazy(loadPrefectureChart);

const ChartFallback = () => (
  <div style={{ minHeight: '280px', display: 'grid', placeItems: 'center', color: '#8c8278' }}>
    图表加载中...
  </div>
);

interface CountyStat {
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
}

type SortKey = 'name' | 'shi_mean' | 'healthy_pct' | 'sub_healthy_pct' | 'unhealthy_pct' | 'pixel_count';

interface SortHeaderProps {
  label: string;
  field: SortKey;
  active: boolean;
  onSort: (field: SortKey) => void;
}

const SortHeader: React.FC<SortHeaderProps> = ({ label, field, active, onSort }) => (
  <th className={`sortable${active ? ' active' : ''}`} onClick={() => onSort(field)}>
    <span>{label}</span>
    <ArrowUpDown size={12} />
  </th>
);

const DataLedgerPage: React.FC = () => {
  const [requestState, dispatch] = useReducer(
    dataLedgerReducer<CountyStat>,
    undefined,
    () => createInitialDataLedgerState<CountyStat>(),
  );
  const [sortKey, setSortKey] = useState<SortKey>('shi_mean');
  const [sortAsc, setSortAsc] = useState(false);
  const [filter, setFilter] = useState('');
  const { activeScoreProfileId, setActiveScoreProfileId, setActiveLayer } = useMapStore();
  const navigate = useNavigate();
  const cropLabel =
    activeScoreProfileId === 'sugarbeet' ? '甜菜' : activeScoreProfileId === 'maize' ? '玉米' : '棉花';

  const profileSummary =
    activeScoreProfileId === 'cotton'
      ? {
          gradeThresholds: { low: 45, high: 60 },
          thresholdLabel: '45/60',
          scopeNote: '棉花区域统计按棉花主导像元汇总，重点观察水盐约束下的棉田内部差异。',
        }
      : activeScoreProfileId === 'maize'
        ? {
            gradeThresholds: { low: 40, high: 60 },
            thresholdLabel: '40/60',
            scopeNote: '玉米区域统计按玉米主导像元汇总，重点观察供水约束下的玉米适宜度梯度。',
          }
        : {
            gradeThresholds: { low: 35, high: 65 },
            thresholdLabel: '35/65',
            scopeNote: '甜菜区域统计按甜菜主导像元汇总，沿用当前比赛版统一展示阈值观察甜菜区差异。',
          };

  useEffect(() => {
    void loadDistributionChart();
    void loadPrefectureChart();
  }, []);

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: 'request_started' });
    shiService
      .getCountyStats(activeScoreProfileId)
      .then((data) => {
        if (!cancelled) {
          dispatch({ type: 'request_succeeded', stats: data });
        }
      })
      .catch((err) => {
        if (!cancelled) {
          dispatch({
            type: 'request_failed',
            error: err instanceof Error ? err.message : '加载失败',
          });
        }
      });
    return () => { cancelled = true; };
  }, [activeScoreProfileId]);

  const switchScoreProfile = useCallback((profileId: 'cotton' | 'sugarbeet' | 'maize') => {
    if (profileId === activeScoreProfileId) return;
    setActiveScoreProfileId(profileId);
    setActiveLayer(scoreProfileIdToLayer(profileId));
  }, [activeScoreProfileId, setActiveLayer, setActiveScoreProfileId]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortAsc((a) => !a);
        return key;
      }
      setSortAsc(key === 'name');
      return key;
    });
  }, []);

  const filtered = useMemo(() => {
    let list = requestState.stats;
    if (filter.trim()) {
      const q = filter.trim().toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    const sorted = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return sorted;
  }, [requestState.stats, filter, sortKey, sortAsc]);

  const handleView = useCallback((item: CountyStat) => {
    const [lon, lat] = item.centroid;
    useMapStore.getState().setActiveScoreProfileId(activeScoreProfileId);
    useMapStore.getState().setActiveLayer(scoreProfileIdToLayer(activeScoreProfileId));
    useMapStore.getState().flyTo(lon, lat, item.type === 'prefecture' ? 8 : 10);
    navigate('/');
  }, [activeScoreProfileId, navigate]);

  const handleExportCSV = useCallback(() => {
    if (filtered.length === 0) return;
    const BOM = String.fromCharCode(0xfeff);
    const header = `地区,类型,${cropLabel}评分均值,${cropLabel}评分中位数,健康%,亚健康%,不健康%,主导约束,建议优先级,像元数,中心经度,中心纬度`;
    const rows = filtered.map((s) =>
      [s.name, s.type === 'prefecture' ? '地州' : '县', s.shi_mean, s.shi_median,
       s.healthy_pct, s.sub_healthy_pct, s.unhealthy_pct, s.dominant_constraint ?? '—', s.priority_level ?? '—', s.pixel_count,
       s.centroid[0].toFixed(4), s.centroid[1].toFixed(4)].join(',')
    );
    const csv = BOM + header + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soilsight_${activeScoreProfileId}_county_stats_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [activeScoreProfileId, cropLabel, filtered]);

  const gradeThresholds = profileSummary.gradeThresholds;

  const summaryScopeStats = useMemo(() => {
    const counties = requestState.stats.filter((item) => item.type === 'county');
    return counties.length > 0 ? counties : requestState.stats;
  }, [requestState.stats]);

  const levelClass = (score: number) => {
    if (score >= gradeThresholds.high) return 'level-healthy';
    if (score >= gradeThresholds.low) return 'level-sub';
    return 'level-unhealthy';
  };

  const summaryData = useMemo(() => {
    if (summaryScopeStats.length === 0) return null;
    const totalPixels = summaryScopeStats.reduce((sum, s) => sum + s.pixel_count, 0);
    const totalArea = (totalPixels * 0.25).toFixed(0);
    const weightedSHI = (summaryScopeStats.reduce((sum, s) => sum + s.shi_mean * s.pixel_count, 0) / totalPixels).toFixed(1);
    const healthyPct = (summaryScopeStats.reduce((sum, s) => sum + s.healthy_pct * s.pixel_count, 0) / totalPixels).toFixed(1);
    const subHealthyPct = (summaryScopeStats.reduce((sum, s) => sum + s.sub_healthy_pct * s.pixel_count, 0) / totalPixels).toFixed(1);
    const unhealthyPct = (summaryScopeStats.reduce((sum, s) => sum + s.unhealthy_pct * s.pixel_count, 0) / totalPixels).toFixed(1);
    const dominantConstraintWeights = summaryScopeStats.reduce<Record<string, number>>((acc, item) => {
      const key = item.dominant_constraint || '未判定';
      acc[key] = (acc[key] ?? 0) + item.pixel_count;
      return acc;
    }, {});
    const dominantConstraint =
      Object.entries(dominantConstraintWeights).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '未判定';
    return {
      totalArea,
      weightedSHI,
      healthyPct,
      subHealthyPct,
      unhealthyPct,
      regionCount: summaryScopeStats.length,
      dominantConstraint,
    };
  }, [summaryScopeStats]);

  const priorityClass = (level?: string | null) => {
    if (level === '高') return 'priority-high';
    if (level === '中') return 'priority-medium';
    return 'priority-low';
  };

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppHeader />
      <main className="ledger-main">
        <div className="ledger-container">
          <div className="stats-header">
            <div>
              <h1 className="ledger-title">区域画像</h1>
              <p className="ledger-subtitle">按特色作物口径查看新疆各地州与区县的土壤质量分布和等级结构。</p>
            </div>
            <div className="stats-header-actions">
              <div className="profile-switch" role="tablist" aria-label="特色作物切换">
                <button
                  className={`profile-switch-btn ${activeScoreProfileId === 'cotton' ? 'active' : ''}`}
                  onClick={() => switchScoreProfile('cotton')}
                >
                  棉花
                </button>
                <button
                  className={`profile-switch-btn ${activeScoreProfileId === 'sugarbeet' ? 'active' : ''}`}
                  onClick={() => switchScoreProfile('sugarbeet')}
                >
                  甜菜
                </button>
                <button
                  className={`profile-switch-btn ${activeScoreProfileId === 'maize' ? 'active' : ''}`}
                  onClick={() => switchScoreProfile('maize')}
                >
                  玉米
                </button>
              </div>
              <input
                className="stats-filter"
                type="text"
                placeholder="搜索地区名称..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button className="export-csv-btn" onClick={handleExportCSV} disabled={filtered.length === 0}>
                <Download size={14} />
                <span>导出 CSV</span>
              </button>
            </div>
          </div>

          {requestState.loading && (
            <div className="stats-loading">
              <Loader2 size={24} className="spin" />
              <span>正在统计各区县{cropLabel}评分数据...</span>
            </div>
          )}

          {requestState.error && <div className="stats-error">{requestState.error}</div>}

          {!requestState.loading && !requestState.error && summaryData && (
            <div className="summary-cards">
              <div className="summary-card">
                <div className="summary-card-label">分析覆盖面积</div>
                <div className="summary-card-value">{summaryData.totalArea}</div>
                <div className="summary-card-unit">km²</div>
              </div>
              <div className="summary-card">
                <div className="summary-card-label">全疆加权平均评分</div>
                <div className="summary-card-value">{summaryData.weightedSHI}</div>
                <div className="summary-card-unit">{cropLabel}土壤质量评分</div>
              </div>
              <div className="summary-card">
                <div className="summary-card-label">区域分级结构</div>
                <div className="summary-card-value">{summaryData.healthyPct}%</div>
                <div className="summary-card-unit">健康 / {summaryData.subHealthyPct}% 亚健康 / {summaryData.unhealthyPct}% 不健康</div>
              </div>
              <div className="summary-card">
                <div className="summary-card-label">全疆主导约束</div>
                <div className="summary-card-value">{summaryData.dominantConstraint}</div>
                <div className="summary-card-unit">{summaryData.regionCount} 个地州 + 县级行政区画像汇总</div>
              </div>
            </div>
          )}

          {!requestState.loading && !requestState.error && (
            <div className="charts-row">
              <div className="chart-card">
                <h3 className="chart-title">{cropLabel}区域分级结构</h3>
                <Suspense fallback={<ChartFallback />}>
                  <DistributionChart stats={summaryScopeStats} />
                </Suspense>
              </div>
              <div className="chart-card">
                <h3 className="chart-title">{cropLabel}地州画像对比</h3>
                <Suspense fallback={<ChartFallback />}>
                  <PrefectureChart stats={requestState.stats} />
                </Suspense>
              </div>
            </div>
          )}

          {!requestState.loading && !requestState.error && (
            <div className="organic-card table-card">
              <div className="table-wrapper">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <SortHeader label="地区" field="name" active={sortKey === 'name'} onSort={handleSort} />
                      <SortHeader label="评分均值" field="shi_mean" active={sortKey === 'shi_mean'} onSort={handleSort} />
                      <SortHeader label="健康 %" field="healthy_pct" active={sortKey === 'healthy_pct'} onSort={handleSort} />
                      <SortHeader label="亚健康 %" field="sub_healthy_pct" active={sortKey === 'sub_healthy_pct'} onSort={handleSort} />
                      <SortHeader label="不健康 %" field="unhealthy_pct" active={sortKey === 'unhealthy_pct'} onSort={handleSort} />
                      <th>主导约束</th>
                      <th>建议优先级</th>
                      <SortHeader label="像元数" field="pixel_count" active={sortKey === 'pixel_count'} onSort={handleSort} />
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item) => (
                      <tr key={`${item.type}-${item.name}`}>
                        <td className="name-cell">
                          <span className={`type-badge ${item.type}`}>{item.type === 'prefecture' ? '地州' : '县'}</span>
                          <span>{item.name}</span>
                        </td>
                        <td>
                          <span className={`shi-value ${levelClass(item.shi_mean)}`}>{item.shi_mean}</span>
                        </td>
                        <td>{item.healthy_pct}%</td>
                        <td>{item.sub_healthy_pct}%</td>
                        <td>{item.unhealthy_pct}%</td>
                        <td>{item.dominant_constraint ?? '—'}</td>
                        <td>
                          <span className={`priority-badge ${priorityClass(item.priority_level)}`}>
                            {item.priority_level ?? '—'}
                          </span>
                        </td>
                        <td className="muted">{item.pixel_count}</td>
                        <td>
                          <button className="view-btn" onClick={() => handleView(item)}>
                            <Eye size={14} />
                            <span>查看</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filtered.length === 0 && (
                      <tr>
                        <td colSpan={9} className="empty-row">无匹配结果</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="stats-footer">
                共 {filtered.length} 个地区 · 当前作物：{cropLabel} · 分级口径：健康 ≥ {gradeThresholds.high} · {gradeThresholds.low} ≤ 亚健康 &lt; {gradeThresholds.high} · 不健康 &lt; {gradeThresholds.low}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default DataLedgerPage;
