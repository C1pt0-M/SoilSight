import React from 'react';
import { Download, Layers, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useMapStore } from '../../store/mapStore';
import type { MapLayerId } from '../../store/mapStore';
import './LayerPanel.css';

const gradeLegend = (low: number, high: number) => (
  <>
    <div className="legend-item">
      <span className="legend-color healthy"></span>
      <span>健康 ({high}-100)</span>
    </div>
    <div className="legend-item">
      <span className="legend-color subhealthy"></span>
      <span>亚健康 ({low}-{high})</span>
    </div>
    <div className="legend-item">
      <span className="legend-color unhealthy"></span>
      <span>不健康 (0-{low})</span>
    </div>
    <div className="legend-item">
      <span className="legend-color unevaluated"></span>
      <span>未评价</span>
    </div>
  </>
);

const LAYER_LEGENDS: Record<string, React.ReactNode> = {
  cotton_shi: (
    <div className="legend-items">
      {gradeLegend(45, 60)}
      <div style={{ marginTop: '8px', fontSize: '11px', color: '#8c8278' }}>
        棉花图层按棉花专属校准阈值（45/60）解释
      </div>
      <div style={{ marginTop: '4px', fontSize: '11px', color: '#8c8278' }}>
        自动叠加耕地背景，便于识别主导棉区与其他耕地区域
      </div>
    </div>
  ),
  sugarbeet_shi: (
    <div className="legend-items">
      {gradeLegend(35, 65)}
      <div style={{ marginTop: '8px', fontSize: '11px', color: '#8c8278' }}>
        甜菜图层按当前统一校准阈值（35/65）解释
      </div>
      <div style={{ marginTop: '4px', fontSize: '11px', color: '#8c8278' }}>
        自动叠加耕地背景，便于识别主导甜菜区与其他耕地区域
      </div>
    </div>
  ),
  maize_shi: (
    <div className="legend-items">
      {gradeLegend(40, 60)}
      <div style={{ marginTop: '8px', fontSize: '11px', color: '#8c8278' }}>
        玉米图层按玉米主导像元校准阈值（40/60）解释
      </div>
      <div style={{ marginTop: '4px', fontSize: '11px', color: '#8c8278' }}>
        自动叠加耕地背景，便于识别主导玉米区与其他耕地区域
      </div>
    </div>
  ),
  cropland: (
    <div className="legend-items">
      <div className="legend-item">
        <span className="legend-color cropland-mask"></span>
        <span>耕地</span>
      </div>
      <div className="legend-item">
        <span className="legend-color cropland-background"></span>
        <span>非耕地 / 背景</span>
      </div>
    </div>
  ),
  drought_risk: (
    <div className="legend-items">
      <div className="legend-item">
        <span className="legend-color" style={{ background: 'linear-gradient(90deg, #fff 0%, #c62828 100%)' }}></span>
        <span>干旱风险 0 到 1</span>
      </div>
    </div>
  ),
  heat_risk: (
    <div className="legend-items">
      <div className="legend-item">
        <span className="legend-color" style={{ background: 'linear-gradient(90deg, #fff 0%, #e65100 100%)' }}></span>
        <span>热胁迫风险 0 到 1</span>
      </div>
    </div>
  ),
  soil_norm: (
    <div className="legend-items">
      <div className="legend-item">
        <span className="legend-color" style={{ background: 'linear-gradient(90deg, #8b5a2b 0%, #2e7d32 100%)' }}></span>
        <span>土壤本底 0 到 1</span>
      </div>
    </div>
  ),
  water_norm: (
    <div className="legend-items">
      <div className="legend-item">
        <span className="legend-color" style={{ background: 'linear-gradient(90deg, #fff 0%, #1e64ff 100%)' }}></span>
        <span>供水支撑 0 到 1</span>
      </div>
    </div>
  ),
};

interface LayerPanelProps {
  onExportMap?: () => void;
}

const cropLayerOption = (profileId: string): { value: MapLayerId; label: string } | null => {
  if (profileId === 'cotton') {
    return { value: 'cotton_shi', label: '棉花土壤质量评分' };
  }
  if (profileId === 'sugarbeet') {
    return { value: 'sugarbeet_shi', label: '甜菜土壤质量评分' };
  }
  if (profileId === 'maize') {
    return { value: 'maize_shi', label: '玉米土壤质量评分' };
  }
  return null;
};

const activeScoreLayerName = (profileId: string): string => {
  if (profileId === 'sugarbeet') return '甜菜土壤质量评分';
  if (profileId === 'maize') return '玉米土壤质量评分';
  return '棉花土壤质量评分';
};

const LayerPanel: React.FC<LayerPanelProps> = ({ onExportMap }) => {
  const { activeLayer, setActiveLayer, activeScoreProfileId, availableScoreProfiles, resetView, setClickedPoint } = useMapStore();

  const activeScoreProfileName = activeScoreLayerName(activeScoreProfileId);
  const scoreLayerOptions = availableScoreProfiles
    .map((profile) => cropLayerOption(profile.id))
    .filter((option): option is { value: MapLayerId; label: string } => option !== null);

  return (
    <aside className="layer-panel">
      <div className="panel-section">
        <h3 className="section-title">
          <Layers size={18} />
          <span>图层切换</span>
        </h3>
        <select className="layer-select" value={activeLayer} onChange={(e) => setActiveLayer(e.target.value as MapLayerId)}>
          <optgroup label="特色作物主评分">
            {scoreLayerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value="cropland">耕地分布 (2023)</option>
          </optgroup>
          <optgroup label="分项">
            <option value="soil_norm">土壤本底</option>
            <option value="water_norm">供水支撑</option>
          </optgroup>
          <optgroup label="风险">
            <option value="drought_risk">干旱风险</option>
            <option value="heat_risk">热胁迫风险</option>
          </optgroup>
        </select>
      </div>

      <div className="panel-section">
        <h3 className="section-title">
          <ShieldCheck size={18} />
          <span>评估方法</span>
        </h3>
        <div className="rule-card">
          <div className="rule-item">
            <span className="rule-label">适用耕地阈值</span>
            <span className="rule-value">≥ 0.2</span>
          </div>
          <div className="rule-formula">
            {activeScoreProfileName} = 100 × (土壤本底、供水支撑、盐分安全、地形约束的加权组合)
          </div>
          <p className="rule-desc">
            特色作物主评分仅对对应作物主导像元进行评价。各主分量先归一化到 0 到 1，再按所选特色作物口径加权合成；NDVI 均值/稳定性仅作旁路解释，不参与主分。
          </p>
        </div>
      </div>

      <div className="panel-section legend-section">
        <h3 className="section-title">分级图例</h3>
        {LAYER_LEGENDS[activeLayer] || null}
      </div>

      <div className="panel-footer">
        {onExportMap && (
          <button className="footer-btn secondary" onClick={onExportMap}>
            <Download size={14} />
            <span>导出地图</span>
          </button>
        )}
        <button className="footer-btn secondary" onClick={resetView}>
          <RefreshCw size={14} />
          <span>重置视角</span>
        </button>
        <button className="footer-btn danger" onClick={() => setClickedPoint(null)}>
          <Trash2 size={14} />
          <span>清除点击点</span>
        </button>
      </div>
    </aside>
  );
};

export default LayerPanel;
