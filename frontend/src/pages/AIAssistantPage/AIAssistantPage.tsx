import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  History,
  Leaf,
  MapPin,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../../components/common/AppHeader';
import MarkdownMessage from '../../components/common/MarkdownMessage';
import { SCENARIO_PACK_OPTIONS } from '../../models/shi';
import type {
  ClickResult,
  ClickResultEvaluated,
  IrrigationConstraint,
  KnowledgeHit,
  PlanObjective,
  PlanSnapshot,
  PlanTaskType,
  ProgressMode,
  ScenarioPackId,
  SHIComponents,
} from '../../models/shi';
import { shiService } from '../../services/shiService';
import { useAssistantStore } from '../../store/assistantStore';
import { useMapStore } from '../../store/mapStore';
import { usePlanStore } from '../../store/planStore';
import { useResultStore } from '../../store/resultStore';
import { progressModeLabel } from '../../utils/progressMode';
import './AIAssistantPage.css';

const GENERAL_SUGGESTIONS = [
  '新疆盐渍化耕地治理有哪些常见路径？',
  '干旱年份怎样稳住土壤水分条件？',
  '有机质提升为什么会影响当前作物评分？',
  '热胁迫风险高时应优先采取哪些措施？',
];


const TASK_ENTRY_OPTIONS: Array<{ id: PlanTaskType; title: string; description: string }> = [
  { id: 'priority_actions', title: '我这块地先做什么', description: '直接给出当前最值得优先做的 1 到 3 件事。' },
  { id: 'stage_schedule', title: '下一阶段怎么推进', description: '按阶段给出动作顺序、复核节点和升级条件。' },
  { id: 'risk_explain', title: '这块地最大风险是什么', description: '解释当前最大的风险来源，以及为什么要先处理它。' },
];

const CONTEXT_TASK_SUGGESTIONS: Record<PlanTaskType, string[]> = {
  priority_actions: ['为什么先做这几件事', '下一阶段怎么推进', '这块地最大的风险点'],
  stage_schedule: ['先看第一阶段安排', '如果灌溉受限怎么改', '哪些节点需要复核'],
  risk_explain: ['先怎么压住这个风险', '为什么它会拖累当前评分', '想看区域推广意义'],
};


const COMPONENT_LABELS: Array<{ key: keyof SHIComponents; label: string }> = [
  { key: 'soilBaseNorm', label: '土壤本底' },
  { key: 'waterSupplyNorm', label: '供水支撑' },
  { key: 'saltSafetyNorm', label: '盐分安全' },
  { key: 'stabNorm', label: '作物表现稳定性' },
  { key: 'prodNorm', label: '作物表现均值' },
  { key: 'terrainNorm', label: '地形条件' },
];

const isEvaluatedResult = (result: ClickResult | null): result is ClickResultEvaluated =>
  !!result && result.status === 'evaluated';

const formatErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return '请求超时，请稍后重试或提高规划接口超时配置（VITE_PLAN_API_TIMEOUT_MS，通用配置为 VITE_API_TIMEOUT_MS）。';
  }
  if (error instanceof Error && /timed out/i.test(error.message)) {
    return '请求超时，请稍后重试或提高规划接口超时配置（VITE_PLAN_API_TIMEOUT_MS，通用配置为 VITE_API_TIMEOUT_MS）。';
  }
  return error instanceof Error && error.message ? error.message : fallback;
};

const formatLocation = (location?: { prefecture?: string; county?: string }): string | null => {
  if (!location) return null;
  const parts = [location.prefecture, location.county].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
};

const formatPercent = (value?: number | null): string => {
  if (typeof value !== 'number' || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(0)}%`;
};

const buildPlanSnapshotFromResult = (result: ClickResultEvaluated): PlanSnapshot => ({
  lon: result.lon,
  lat: result.lat,
  shiScore: result.shiScore,
  shiLevel: result.shiLevel,
  components: result.components,
  profile: result.profile,
  risk: result.risk,
  temporalMeta: result.temporalMeta,
});

const getWeakComponents = (components?: SHIComponents | null) => {
  if (!components) return [];
  return COMPONENT_LABELS.map((item) => ({
    key: item.key,
    label: item.label,
    value: components[item.key],
  }))
    .filter((item): item is { key: keyof SHIComponents; label: string; value: number } => typeof item.value === 'number')
    .sort((a, b) => a.value - b.value)
    .slice(0, 2);
};

const formatKnowledgeCategory = (category: string): string => {
  if (category === 'reference') return '背景参考';
  if (category === 'archive') return '归档资料';
  return '核心资料';
};

const trimKnowledgePath = (path: string): string => path.replace(/^knowledge_base\//, '');

const renderKnowledgeHits = (knowledgeHits?: KnowledgeHit[]) => {
  if (!knowledgeHits || knowledgeHits.length === 0) return null;
  return (
    <details className="assistant-references">
      <summary>
        <span>参考资料</span>
        <strong>{knowledgeHits.length}</strong>
      </summary>
      <div className="assistant-reference-list">
        {knowledgeHits.map((hit) => (
          <article className="assistant-reference-card" key={`${hit.title}-${hit.path}`}>
            <div className="assistant-reference-meta">
              <span className="assistant-reference-badge">{formatKnowledgeCategory(hit.category)}</span>
              {hit.path ? <code>{trimKnowledgePath(hit.path)}</code> : null}
            </div>
            <h4>{hit.title}</h4>
            <p>{hit.excerpt}</p>
          </article>
        ))}
      </div>
    </details>
  );
};

const AIAssistantPage: React.FC = () => {
  const navigate = useNavigate();
  const currentResult = useResultStore((state) => state.currentResult);
  const activeScoreProfileId = useMapStore((state) => state.activeScoreProfileId);
  const evaluatedResult = isEvaluatedResult(currentResult) ? currentResult : null;
  const {
    mode,
    autoLaunchContextPlan,
    generalStatus,
    generalError,
    generalDraft,
    generalMessages,
    generalConversations,
    activeGeneralConversationId,
    openGeneralAssistant,
    openContextualAssistant,
    consumeAutoLaunchContextPlan,
    setGeneralStatus,
    setGeneralError,
    setGeneralDraft,
    setGeneralMessages,
    activateGeneralConversation,
    deleteGeneralConversation,
    primeGeneralConversation,
    resetGeneralConversation,
  } = useAssistantStore();
  const {
    selectedScenarioPack,
    selectedObjective,
    selectedTaskType,
    selectedIrrigation,
    selectedProgressMode,
    planStatus,
    planError,
    planResult,
    chatDraft,
    chatMessages,
    setActiveTab,
    setSelectedScenarioPack,
    setSelectedObjective,
    setSelectedTaskType,
    setSelectedIrrigation,
    setSelectedProgressMode,
    setPlanStatus,
    setPlanError,
    setPlanResult,
    setSimulationStatus,
    setSimulationError,
    setSimulationResult,
    setChatDraft,
    setChatMessages,
  } = usePlanStore();
  const [chatSending, setChatSending] = useState(false);

  const contextSnapshot = useMemo<PlanSnapshot | null>(() => {
    if (planResult?.snapshot) return planResult.snapshot;
    if (evaluatedResult) return buildPlanSnapshotFromResult(evaluatedResult);
    return null;
  }, [evaluatedResult, planResult]);
  const contextLocation = useMemo(() => {
    if (evaluatedResult?.location) {
      const label = formatLocation(evaluatedResult.location);
      if (label) return label;
    }
    if (contextSnapshot) {
      return `${contextSnapshot.lon.toFixed(4)}, ${contextSnapshot.lat.toFixed(4)}`;
    }
    return null;
  }, [contextSnapshot, evaluatedResult]);
  const weakComponents = useMemo(() => getWeakComponents(contextSnapshot?.components), [contextSnapshot]);
  const hasContext = Boolean(contextSnapshot);
  const canGenerateContextPlan = Boolean(evaluatedResult);
  const canChatWithContext = Boolean(planResult?.sessionId);
  const activeMessages = mode === 'contextual' ? chatMessages : generalMessages;
  const activeDraft = mode === 'contextual' ? chatDraft : generalDraft;
  const activeError = mode === 'contextual' ? planError : generalError;
  const activeGeneralConversation = useMemo(
    () => generalConversations.find((conversation) => conversation.id === activeGeneralConversationId) ?? null,
    [activeGeneralConversationId, generalConversations]
  );
  const modeSuggestions =
    mode === 'contextual'
      ? canChatWithContext
        ? CONTEXT_TASK_SUGGESTIONS[selectedTaskType]
        : TASK_ENTRY_OPTIONS.map((item) => item.title)
      : GENERAL_SUGGESTIONS;

  useEffect(() => {
    primeGeneralConversation();
  }, [primeGeneralConversation]);

  useEffect(() => {
    if (planResult?.assistantReply && chatMessages.length === 0) {
      setChatMessages([
        {
          role: 'assistant',
          content: planResult.assistantReply,
          knowledgeHits: planResult.assistantKnowledgeHits,
        },
      ]);
    }
  }, [chatMessages.length, planResult, setChatMessages]);

  const handleGenerateContextPlan = useCallback(async (taskTypeOverride?: PlanTaskType) => {
    if (!evaluatedResult) return;
    const nextTaskType = taskTypeOverride ?? selectedTaskType;
    if (taskTypeOverride && taskTypeOverride !== selectedTaskType) {
      setSelectedTaskType(taskTypeOverride);
    }
    setActiveTab('plan');
    setPlanStatus('loading');
    setPlanError(null);
    setSimulationStatus('idle');
    setSimulationError(null);
    setSimulationResult(null);
    try {
      const result = await shiService.generatePlan({
        lon: evaluatedResult.lon,
        lat: evaluatedResult.lat,
        objective: selectedObjective,
        irrigation: selectedIrrigation,
        scenarioPack: selectedScenarioPack,
        progressMode: selectedProgressMode,
        taskType: nextTaskType,
        profileId: activeScoreProfileId,
      });
      setPlanResult(result);
      setPlanStatus('ready');
      setChatMessages([
        {
          role: 'assistant',
          content: result.assistantReply,
          knowledgeHits: result.assistantKnowledgeHits,
        },
      ]);
    } catch (error: unknown) {
      setPlanStatus('error');
      setPlanError(formatErrorMessage(error, '生成方案失败'));
    }
  }, [
    evaluatedResult,
    selectedObjective,
    selectedIrrigation,
    selectedScenarioPack,
    selectedTaskType,
    selectedProgressMode,
    activeScoreProfileId,
    setActiveTab,
    setPlanError,
    setPlanResult,
    setPlanStatus,
    setSelectedTaskType,
    setSimulationError,
    setSimulationResult,
    setSimulationStatus,
    setChatMessages,
  ]);

  useEffect(() => {
    if (mode !== 'contextual' || !autoLaunchContextPlan) return;
    consumeAutoLaunchContextPlan();
    if (canGenerateContextPlan && !planResult && planStatus !== 'loading') {
      void handleGenerateContextPlan();
    }
  }, [
    autoLaunchContextPlan,
    canGenerateContextPlan,
    consumeAutoLaunchContextPlan,
    handleGenerateContextPlan,
    mode,
    planResult,
    planStatus,
  ]);

  const handleSendContextMessage = useCallback(
    async (preset?: string) => {
      if (!planResult?.sessionId) return;
      const message = (preset ?? chatDraft).trim();
      if (!message || chatSending) return;
      if (!preset) {
        setChatDraft('');
      }
      setChatSending(true);
      try {
        const result = await shiService.chatPlan(planResult.sessionId, message, chatMessages);
        setChatMessages(result.chatHistory);
      } catch (error: unknown) {
        const fallbackMessage = formatErrorMessage(error, '对话服务异常');
        setChatMessages([
          ...chatMessages,
          { role: 'user', content: message },
          { role: 'assistant', content: `对话失败：${fallbackMessage}` },
        ]);
      } finally {
        setChatSending(false);
      }
    },
    [chatDraft, chatMessages, chatSending, planResult, setChatDraft, setChatMessages]
  );

  const handleSendGeneralMessage = useCallback(
    async (preset?: string) => {
      const message = (preset ?? generalDraft).trim();
      if (!message || chatSending) return;
      if (!preset) {
        setGeneralDraft('');
      }
      setGeneralStatus('loading');
      setGeneralError(null);
      setChatSending(true);
      try {
        const result = await shiService.chatGeneral(message, generalMessages);
        setGeneralMessages(result.chatHistory);
        setGeneralStatus('ready');
      } catch (error: unknown) {
        const fallbackMessage = formatErrorMessage(error, '对话服务异常');
        setGeneralStatus('error');
        setGeneralError(fallbackMessage);
        setGeneralMessages([
          ...generalMessages,
          { role: 'user', content: message },
          { role: 'assistant', content: `对话失败：${fallbackMessage}` },
        ]);
      } finally {
        setChatSending(false);
      }
    },
    [
      chatSending,
      generalDraft,
      generalMessages,
      setGeneralDraft,
      setGeneralError,
      setGeneralMessages,
      setGeneralStatus,
    ]
  );

  const handleSubmit = useCallback(() => {
    if (mode === 'contextual') {
      void handleSendContextMessage();
      return;
    }
    void handleSendGeneralMessage();
  }, [handleSendContextMessage, handleSendGeneralMessage, mode]);

  const handleSuggestionClick = useCallback(
    (text: string) => {
      if (mode === 'contextual') {
        const matchedTask = TASK_ENTRY_OPTIONS.find((item) => item.title === text);
        if (matchedTask) {
          void handleGenerateContextPlan(matchedTask.id);
          return;
        }
        if (!canChatWithContext) {
          void handleGenerateContextPlan(selectedTaskType);
          return;
        }
        void handleSendContextMessage(text);
        return;
      }
      void handleSendGeneralMessage(text);
    },
    [canChatWithContext, handleGenerateContextPlan, handleSendContextMessage, handleSendGeneralMessage, mode, selectedTaskType]
  );

  const formatConversationTime = useCallback((value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, []);

  return (
    <div className="assistant-page">
      <AppHeader />
      <main className="assistant-main">
        <div className="assistant-shell">
          <section className="assistant-hero">
            <div className="assistant-hero-copy">
              <div className="assistant-hero-kicker">规划工作台</div>
              <div className="assistant-hero-headline">
                <h1 className="assistant-title">{mode === 'contextual' ? '地块规划对话' : '农业与土壤问答'}</h1>
                {mode === 'contextual' && hasContext ? (
                  <span className="shell-tag">{contextLocation || '已带入地块'}</span>
                ) : null}
              </div>
              <div className="assistant-mode-switch">
                <button
                  className={`mode-btn ${mode === 'general' ? 'active' : ''}`}
                  onClick={() => openGeneralAssistant()}
                >
                  <MessageCircle size={15} />
                  <span>通用问答</span>
                </button>
                <button
                  className={`mode-btn ${mode === 'contextual' ? 'active' : ''}`}
                  onClick={() => openContextualAssistant({ autoLaunch: false })}
                  disabled={!hasContext}
                  title={hasContext ? '切换到地块上下文对话' : '请先从地图带入地块上下文'}
                >
                  <MapPin size={15} />
                  <span>地块规划对话</span>
                </button>
              </div>
            </div>
          </section>

          <section className="assistant-layout">
            <aside className="assistant-rail">
              {mode === 'contextual' ? (
                <>
                  <div className="assistant-panel context-panel">
                    <div className="panel-heading">
                      <MapPin size={15} />
                      <span>地块上下文</span>
                    </div>
                    {hasContext ? (
                      <>
                        <div className="context-location">{contextLocation || '已带入地块上下文'}</div>
                        <div className="context-score-row">
                          <div>
                            <div className="context-score-label">当前作物评分</div>
                            <div className="context-score">{contextSnapshot?.shiScore.toFixed(1)}</div>
                          </div>
                          <div className="context-level-chip">{contextSnapshot?.shiLevel}</div>
                        </div>
                        <div className="context-shortboards">
                          {weakComponents.map((item) => (
                            <div className="context-shortboard" key={item.key}>
                              <span>{item.label}</span>
                              <strong>{Math.round(item.value * 100)}/100</strong>
                            </div>
                          ))}
                        </div>
                        <div className="context-risk-row">
                          <span>干旱 {formatPercent(contextSnapshot?.risk?.droughtRisk)}</span>
                          <span>热胁迫 {formatPercent(contextSnapshot?.risk?.heatRisk)}</span>
                          <span>风险等级 {contextSnapshot?.risk?.riskLevel || '—'}</span>
                        </div>
                        {evaluatedResult?.advice?.length ? (
                          <ul className="context-advice-list">
                            {evaluatedResult.advice.slice(0, 2).map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : (
                      <div className="panel-empty">
                        <p>当前没有可用的地块上下文。</p>
                        <button className="assistant-btn secondary" onClick={() => navigate('/')}>
                          <ArrowRight size={15} />
                          <span>返回地图带入地块</span>
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="assistant-panel task-panel">
                    <div className="panel-heading">
                      <Sparkles size={15} />
                      <span>任务入口</span>
                    </div>
                    <div className="task-entry-list">
                      {TASK_ENTRY_OPTIONS.map((item) => {
                        const active = selectedTaskType === item.id;
                        return (
                          <button
                            key={item.id}
                            className={`task-entry-card ${active ? "active" : ""}`}
                            onClick={() => setSelectedTaskType(item.id)}>
                            <strong>{item.title}</strong>
                            <span>{item.description}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      className="assistant-btn primary"
                      onClick={() => void handleGenerateContextPlan(selectedTaskType)}
                      disabled={!canGenerateContextPlan || planStatus === "loading"}>
                      <Sparkles size={15} />
                      <span>{planStatus === "loading" ? "生成中..." : (TASK_ENTRY_OPTIONS.find((item) => item.id === selectedTaskType)?.title ?? "我这块地先做什么")}</span>
                    </button>
                  </div>

                  <div className="assistant-panel control-panel">
                    <div className="panel-heading">
                      <Sparkles size={15} />
                      <span>规划设置</span>
                    </div>
                    <div className="context-controls">
                      <label>
                        <span>措施包</span>
                        <select
                          value={selectedScenarioPack}
                          onChange={(event) => setSelectedScenarioPack(event.target.value as ScenarioPackId)}
                        >
                          {SCENARIO_PACK_OPTIONS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>目标偏好</span>
                        <select
                          value={selectedObjective}
                          onChange={(event) => setSelectedObjective(event.target.value as PlanObjective)}
                        >
                          <option value="稳产优先">稳产优先</option>
                          <option value="节水优先">节水优先</option>
                          <option value="改土优先">改土优先</option>
                        </select>
                      </label>
                      <label>
                        <span>灌溉条件</span>
                        <select
                          value={selectedIrrigation}
                          onChange={(event) => setSelectedIrrigation(event.target.value as IrrigationConstraint)}
                        >
                          <option value="充足">充足</option>
                          <option value="有限">有限</option>
                          <option value="无">无</option>
                        </select>
                      </label>
                      <label>
                        <span>推进节奏</span>
                        <select
                          value={selectedProgressMode}
                          onChange={(event) => setSelectedProgressMode(event.target.value as ProgressMode)}
                        >
                          <option value="aggressive">积极推进</option>
                          <option value="stable">稳健推进</option>
                          <option value="conservative">保守推进</option>
                        </select>
                      </label>
                    </div>
                    <div className="context-actions">
                      <button
                        className="assistant-btn primary"
                        onClick={() => void handleGenerateContextPlan()}
                        disabled={!canGenerateContextPlan || planStatus === 'loading'}
                      >
                        <Sparkles size={15} />
                        <span>{planStatus === 'loading' ? '生成中...' : planResult ? '重新生成规划' : '生成当前地块规划'}</span>
                      </button>
                      <button className="assistant-btn ghost" onClick={() => navigate('/')}>
                        <ArrowRight size={15} />
                        <span>返回地图</span>
                      </button>
                    </div>
                  </div>

                  <div className="assistant-panel summary-panel">
                    <div className="panel-heading">
                      <Leaf size={15} />
                      <span>规划摘要</span>
                    </div>
                    {planResult ? (
                      <>
                        <div className="context-risk-row">
                          <span>推进节奏 {progressModeLabel(planResult.plan.progressMode ?? selectedProgressMode)}</span>
                          <span>阶段数 {(planResult.plan.stages?.length ?? 0) || 3}</span>
                        </div>
                        <p className="summary-text">{planResult.plan.summary}</p>
                        <div className="summary-stages">
                          {planResult.plan.stages.map((stage) => (
                            <div className="summary-stage" key={stage.stageId}>
                              <strong>{stage.title}</strong>
                              <p>{stage.actions[0]}</p>
                              {stage.milestones?.[0] ? (
                                <p>里程碑：{stage.milestones[0]}</p>
                              ) : null}
                              {stage.exitConditions?.[0] ? (
                                <p>进入下一阶段：{stage.exitConditions[0]}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="summary-empty">规划生成后，这里会展示当前地块的一句话总结和阶段重点。</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="assistant-panel history-panel">
                    <div className="history-header">
                      <div className="panel-heading">
                        <History size={15} />
                        <span>对话记录</span>
                      </div>
                      <button className="assistant-btn ghost compact" onClick={resetGeneralConversation}>
                        <Plus size={14} />
                        <span>新建</span>
                      </button>
                    </div>
                    {activeGeneralConversation ? (
                      <div className="history-current-card">
                        <span className="history-current-kicker">当前对话</span>
                        <strong>{activeGeneralConversation.title}</strong>
                        <p>{activeGeneralConversation.preview}</p>
                        <div className="history-current-meta">
                          <span>{formatConversationTime(activeGeneralConversation.updatedAt)}</span>
                          <span>{activeGeneralConversation.messages.length} 条消息</span>
                        </div>
                      </div>
                    ) : null}
                    <div className="conversation-list">
                      {generalConversations.map((conversation) => {
                        const isActive = conversation.id === activeGeneralConversationId;
                        return (
                          <div key={conversation.id} className={`conversation-row ${isActive ? 'active' : ''}`}>
                            <button
                              className={`conversation-entry ${isActive ? 'active' : ''}`}
                              onClick={() => activateGeneralConversation(conversation.id)}
                            >
                              <div className="conversation-entry-top">
                                <strong>{conversation.title}</strong>
                                <span>{formatConversationTime(conversation.updatedAt)}</span>
                              </div>
                              <p>{conversation.preview}</p>
                              <div className="conversation-entry-meta">
                                <span>{conversation.messages.length} 条消息</span>
                                {isActive ? <span>当前</span> : <span>点击切换</span>}
                              </div>
                            </button>
                            <button
                              className="conversation-delete"
                              onClick={() => deleteGeneralConversation(conversation.id)}
                              aria-label={`删除对话 ${conversation.title}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>


                </>
              )}
            </aside>

            <section className="assistant-chat-shell">
              <div className="chat-shell-header">
                <div>
                  <div className="chat-shell-kicker">{mode === 'contextual' ? '地块规划模式' : '通用问答模式'}</div>
                  <h2>{mode === 'contextual' ? '围绕当前地块继续规划与追问' : '直接发问，获取新疆特色作物、水盐与土壤管理建议'}</h2>
                </div>
                <div className="chat-shell-side">
                  <span className="shell-tag">{mode === 'contextual' ? '地图地块' : '通用问答'}</span>
                </div>
              </div>

              {!hasContext && mode === 'contextual' ? (
                <div className="chat-empty-state">
                  <MapPin size={28} />
                  <h3>当前没有可用于规划的地块上下文</h3>
                  <p>请先从地图点击一个已评估地块，再进入规划工作台；或者直接切换到通用农业问答。</p>
                  <div className="empty-actions">
                    <button className="assistant-btn primary" onClick={() => navigate('/')}>
                      <ArrowRight size={15} />
                      <span>返回地图</span>
                    </button>
                    <button className="assistant-btn ghost" onClick={() => openGeneralAssistant()}>
                      <MessageCircle size={15} />
                      <span>切换到通用问答</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {mode === 'contextual' && planStatus === 'loading' && (
                    <div className="chat-inline-status">正在根据当前地块生成规划，请稍候…</div>
                  )}
                  {mode === 'general' && generalStatus === 'loading' && (
                    <div className="chat-inline-status">规划工作台正在整理农业与土壤健康建议，请稍候…</div>
                  )}
                  {activeError ? <div className="chat-inline-error">{activeError}</div> : null}

                  <div className="message-stream">
                    {mode === 'contextual' && !canChatWithContext && planStatus !== 'loading' ? (
                      <div className="chat-empty-state subtle">
                        <Sparkles size={26} />
                        <h3>还没有生成当前地块规划</h3>
                        <p>点击下方按钮后，系统会先读取当前地块的当前作物评分、风险和主分短板，再进入多轮对话。</p>
                        <button
                          className="assistant-btn primary"
                          onClick={() => void handleGenerateContextPlan()}
                          disabled={!canGenerateContextPlan}
                        >
                          <Sparkles size={15} />
                          <span>生成当前地块规划</span>
                        </button>
                      </div>
                    ) : (
                      activeMessages.map((item, idx) => (
                        <div key={`${item.role}-${idx}`} className={`assistant-message ${item.role}`}>
                          <MarkdownMessage content={item.content} className="assistant-message-content" />
                          {item.role === 'assistant' ? renderKnowledgeHits(item.knowledgeHits) : null}
                        </div>
                      ))
                    )}
                  </div>

                  <div className="suggestion-row">
                    {modeSuggestions.map((item) => (
                      <button
                        key={item}
                        className="suggestion-chip"
                        onClick={() => handleSuggestionClick(item)}
                        disabled={chatSending || (mode === 'contextual' && !canGenerateContextPlan)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>

                  <div className="chat-composer">
                    <textarea
                      className="chat-textarea"
                      value={activeDraft}
                      placeholder={
                        mode === 'contextual'
                          ? canChatWithContext
                            ? '例如：下一阶段怎么推进？'
                            : '请先生成当前地块规划'
                          : '例如：如何提升当前特色作物地块的供水支撑和盐分安全？'
                      }
                      onChange={(event) =>
                        mode === 'contextual'
                          ? setChatDraft(event.target.value)
                          : setGeneralDraft(event.target.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          handleSubmit();
                        }
                      }}
                      disabled={chatSending || (mode === 'contextual' && !canChatWithContext)}
                    />
                    <button
                      className="composer-send"
                      onClick={handleSubmit}
                      disabled={
                        chatSending ||
                        !activeDraft.trim() ||
                        (mode === 'contextual' && !canChatWithContext)
                      }
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </>
              )}
            </section>
          </section>
        </div>
      </main>
    </div>
  );
};

export default AIAssistantPage;
