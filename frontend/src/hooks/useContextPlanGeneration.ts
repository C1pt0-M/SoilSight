import { useCallback } from 'react';
import type { ClickResultEvaluated, PlanTaskType } from '../models/shi';
import { shiService } from '../services/shiService';
import { useMapStore } from '../store/mapStore';
import { usePlanStore } from '../store/planStore';

export const useContextPlanGeneration = () => {
  const activeScoreProfileId = useMapStore((state) => state.activeScoreProfileId);
  const selectedScenarioPack = usePlanStore((state) => state.selectedScenarioPack);
  const selectedObjective = usePlanStore((state) => state.selectedObjective);
  const selectedTaskType = usePlanStore((state) => state.selectedTaskType);
  const selectedIrrigation = usePlanStore((state) => state.selectedIrrigation);
  const selectedProgressMode = usePlanStore((state) => state.selectedProgressMode);
  const setActiveTab = usePlanStore((state) => state.setActiveTab);
  const setSelectedTaskType = usePlanStore((state) => state.setSelectedTaskType);
  const setPlanStatus = usePlanStore((state) => state.setPlanStatus);
  const setPlanError = usePlanStore((state) => state.setPlanError);
  const setPlanResult = usePlanStore((state) => state.setPlanResult);
  const setSimulationStatus = usePlanStore((state) => state.setSimulationStatus);
  const setSimulationError = usePlanStore((state) => state.setSimulationError);
  const setSimulationResult = usePlanStore((state) => state.setSimulationResult);
  const setChatMessages = usePlanStore((state) => state.setChatMessages);

  return useCallback(
    async (evaluatedResult: ClickResultEvaluated | null, taskTypeOverride?: PlanTaskType) => {
      if (!evaluatedResult) {
        return null;
      }
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
        return result;
      } catch (error: unknown) {
        setPlanStatus('error');
        setPlanError(error instanceof Error && error.message ? error.message : '生成方案失败');
        return null;
      }
    },
    [
      activeScoreProfileId,
      selectedIrrigation,
      selectedObjective,
      selectedProgressMode,
      selectedScenarioPack,
      selectedTaskType,
      setActiveTab,
      setChatMessages,
      setPlanError,
      setPlanResult,
      setPlanStatus,
      setSelectedTaskType,
      setSimulationError,
      setSimulationResult,
      setSimulationStatus,
    ],
  );
};
