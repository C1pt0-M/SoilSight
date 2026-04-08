import React, { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import SimChart from '../../components/result/SimChart';
import { usePlanStore } from '../../store/planStore';
import { useResultStore } from '../../store/resultStore';
import { getSimulationPlanState, isSimulationResultCurrent } from '../../components/result/resultDrawerSimulationState';
import { progressModeLabel } from '../../utils/progressMode';
import './ReportPage.css';

const formatPercent = (value?: number | null, digits = 0): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  const normalized = value > 1.01 ? value / 100 : value;
  return `${(normalized * 100).toFixed(digits)}%`;
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const ReportPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const printTriggeredRef = useRef(false);
  const planResult = usePlanStore((state) => state.planResult);
  const simulationResult = usePlanStore((state) => state.simulationResult);
  const selectedScenarioPack = usePlanStore((state) => state.selectedScenarioPack);
  const selectedObjective = usePlanStore((state) => state.selectedObjective);
  const selectedIrrigation = usePlanStore((state) => state.selectedIrrigation);
  const selectedProgressMode = usePlanStore((state) => state.selectedProgressMode);
  const currentResult = useResultStore((state) => state.currentResult);

  const simulationPlanState = useMemo(
    () => getSimulationPlanState(planResult, {
      scenarioPack: selectedScenarioPack,
      objective: selectedObjective,
      irrigation: selectedIrrigation,
      progressMode: selectedProgressMode,
    }),
    [planResult, selectedScenarioPack, selectedObjective, selectedIrrigation, selectedProgressMode],
  );

  const currentSimulationResult = useMemo(
    () => (
      planResult && isSimulationResultCurrent(simulationResult, {
        sessionId: planResult.sessionId,
        scenarioPack: selectedScenarioPack,
        progressMode: selectedProgressMode,
      })
        ? simulationResult
        : null
    ),
    [planResult, selectedScenarioPack, selectedProgressMode, simulationResult],
  );

  const reportLocationLabel = useMemo(() => {
    if (currentResult?.location) {
      return [currentResult.location.prefecture, currentResult.location.county].filter(Boolean).join(' / ');
    }
    return null;
  }, [currentResult]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('autoprint') !== '1' || !planResult || printTriggeredRef.current) {
      return;
    }
    printTriggeredRef.current = true;
    const timer = window.setTimeout(() => {
      window.print();
    }, 500);
    return () => window.clearTimeout(timer);
  }, [location.search, planResult]);

  if (!planResult) {
    return (
      <main className="report-shell report-shell--empty">
        <section className="report-card">
          <h1>暂无可导出的规划报告</h1>
          <p>请先在主页面生成地块规划，再导出 PDF 报告。</p>
          <div className="report-actions no-print">
            <button type="button" className="report-btn" onClick={() => navigate(-1)}>
              返回
            </button>
          </div>
        </section>
      </main>
    );
  }

  const snapshot = planResult.snapshot;
  const components = snapshot.components;
  const simulation = currentSimulationResult?.simulation ?? null;

  return (
    <main className="report-shell">
      <div className="report-actions no-print">
        <button type="button" className="report-btn" onClick={() => window.print()}>
          打印 / 导出 PDF
        </button>
        <button type="button" className="report-btn secondary" onClick={() => navigate(-1)}>
          返回
        </button>
      </div>

      <article className="report-card">
        <header className="report-header">
          <div>
            <p className="report-kicker">天山土智规划报告</p>
            <h1>地块土壤质量规划与模拟报告</h1>
            <p className="report-subtitle">基于当前地块评估结果、规划摘要与模拟结果生成</p>
          </div>
          <div className="report-meta">
            <span>生成时间：{formatDateTime(planResult.generatedAt)}</span>
            <span>会话 ID：{planResult.sessionId}</span>
          </div>
        </header>

        {(simulationPlanState === 'summary_outdated' || simulationPlanState === 'plan_regeneration_required') && (
          <section className="report-warning">
            当前前端设置已发生变化，报告主体仍基于最近一次生成的规划摘要；如需与当前设置完全一致，请先返回主页面重新生成规划。
          </section>
        )}

        <section className="report-section">
          <h2>1. 地块基本信息</h2>
          <div className="report-grid report-grid--meta">
            <div className="report-metric">
              <span>区域</span>
              <strong>{snapshot.regionId || '—'}</strong>
            </div>
            <div className="report-metric">
              <span>位置</span>
              <strong>{reportLocationLabel || '—'}</strong>
            </div>
            <div className="report-metric">
              <span>经度</span>
              <strong>{snapshot.lon.toFixed(4)}</strong>
            </div>
            <div className="report-metric">
              <span>纬度</span>
              <strong>{snapshot.lat.toFixed(4)}</strong>
            </div>
          </div>
        </section>

        <section className="report-section">
          <h2>2. 当前评估结果摘要</h2>
          <div className="report-grid report-grid--meta">
            <div className="report-metric">
              <span>当前评分</span>
              <strong>{snapshot.shiScore.toFixed(1)}</strong>
            </div>
            <div className="report-metric">
              <span>当前等级</span>
              <strong>{snapshot.shiLevel}</strong>
            </div>
            <div className="report-metric">
              <span>耕地占比</span>
              <strong>{formatPercent(components.croplandFraction, 0)}</strong>
            </div>
            <div className="report-metric">
              <span>风险等级</span>
              <strong>{snapshot.risk?.riskLevel || '—'}</strong>
            </div>
          </div>
          <div className="report-grid report-grid--components">
            <div className="report-metric"><span>土壤本底</span><strong>{formatPercent(components.soilBaseNorm ?? components.soilNorm, 0)}</strong></div>
            <div className="report-metric"><span>供水支撑</span><strong>{formatPercent(components.waterSupplyNorm ?? components.waterNorm, 0)}</strong></div>
            <div className="report-metric"><span>盐分安全</span><strong>{formatPercent(components.saltSafetyNorm ?? components.salinityNorm, 0)}</strong></div>
            <div className="report-metric"><span>稳定性</span><strong>{formatPercent(components.stabNorm, 0)}</strong></div>
            <div className="report-metric"><span>生产表现</span><strong>{formatPercent(components.prodNorm, 0)}</strong></div>
            <div className="report-metric"><span>地形条件</span><strong>{formatPercent(components.terrainNorm, 0)}</strong></div>
          </div>
        </section>

        <section className="report-section">
          <h2>3. 规划设置</h2>
          <div className="report-grid report-grid--meta">
            <div className="report-metric">
              <span>措施包</span>
              <strong>{planResult.plan.scenarioPack.name}</strong>
            </div>
            <div className="report-metric">
              <span>目标偏好</span>
              <strong>{planResult.plan.goal}</strong>
            </div>
            <div className="report-metric">
              <span>灌溉条件</span>
              <strong>{planResult.plan.constraints.irrigation}</strong>
            </div>
            <div className="report-metric">
              <span>推进节奏</span>
              <strong>{progressModeLabel(planResult.plan.progressMode)}</strong>
            </div>
          </div>
        </section>

        <section className="report-section">
          <h2>4. 规划摘要与分阶段措施</h2>
          <p className="report-summary">{planResult.plan.summary}</p>
          <div className="report-stage-list">
            {planResult.plan.stages.map((stage) => (
              <section key={stage.stageId} className="report-stage-card">
                <h3>{stage.title}</h3>
                <ul>
                  {stage.actions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
                {stage.milestones?.length ? (
                  <>
                    <h4>阶段里程碑</h4>
                    <ul>
                      {stage.milestones.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </>
                ) : null}
              </section>
            ))}
          </div>
        </section>

        <section className="report-section">
          <h2>5. 触发依据</h2>
          <div className="report-trace-list">
            {planResult.plan.ruleTraces.map((trace) => (
              <div key={trace.ruleId} className="report-trace-card">
                <strong>{trace.ruleId}</strong>
                <span>{trace.explanation}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="report-section">
          <h2>6. 模拟对比图表</h2>
          {simulation ? (
            <div className="report-chart-card">
              <SimChart
                series={simulation.series}
                percentileBands={simulation.percentileBands}
                mlPredEndShi={simulation.mlReference?.predEndShi}
                stageLabels={simulation.stageLabels}
              />
            </div>
          ) : (
            <p className="report-summary">尚未生成模拟结果，本报告仅导出当前规划内容。</p>
          )}
        </section>

        <section className="report-section">
          <h2>7. 关键模拟指标</h2>
          {simulation ? (
            <div className="report-grid report-grid--meta">
              <div className="report-metric">
                <span>预期评分</span>
                <strong>{simulation.comparison.expectedEndShi.toFixed(1)}</strong>
              </div>
              <div className="report-metric">
                <span>相对当前变化</span>
                <strong>{simulation.comparison.expectedDeltaShi >= 0 ? '+' : ''}{simulation.comparison.expectedDeltaShi.toFixed(1)}</strong>
              </div>
              <div className="report-metric">
                <span>保守情景</span>
                <strong>{simulation.comparison.conservativeEndShi.toFixed(1)}</strong>
              </div>
              <div className="report-metric">
                <span>乐观情景</span>
                <strong>{simulation.comparison.optimisticEndShi.toFixed(1)}</strong>
              </div>
            </div>
          ) : (
            <p className="report-summary">尚未生成模拟结果。</p>
          )}
        </section>
      </article>
    </main>
  );
};

export default ReportPage;
