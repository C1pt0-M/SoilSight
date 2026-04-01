import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  IrrigationConstraint,
  PlanChatMessage,
  PlanGenerateResponse,
  PlanObjective,
  PlanTaskType,
  PlanSimulateResponse,
  ProgressMode,
  ScenarioPackId,
} from '../models/shi';
import { normalizeSimulationResult } from '../utils/simulationResultNormalization.js';

export type DrawerTab = 'assessment' | 'plan' | 'simulation';
export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error';

const PLAN_STORAGE_KEY = 'soilsight-plan-store-v1';

interface PlanState {
  activeTab: DrawerTab;
  selectedScenarioPack: ScenarioPackId;
  selectedObjective: PlanObjective;
  selectedTaskType: PlanTaskType;
  selectedIrrigation: IrrigationConstraint;
  selectedProgressMode: ProgressMode;
  currentPointKey: string | null;
  planStatus: AsyncStatus;
  simulationStatus: AsyncStatus;
  planError: string | null;
  simulationError: string | null;
  planResult: PlanGenerateResponse | null;
  simulationResult: PlanSimulateResponse | null;
  chatDraft: string;
  chatMessages: PlanChatMessage[];
  setActiveTab: (tab: DrawerTab) => void;
  setSelectedScenarioPack: (id: ScenarioPackId) => void;
  setSelectedObjective: (objective: PlanObjective) => void;
  setSelectedTaskType: (taskType: PlanTaskType) => void;
  setSelectedIrrigation: (constraint: IrrigationConstraint) => void;
  setSelectedProgressMode: (mode: ProgressMode) => void;
  setCurrentPointKey: (pointKey: string | null) => void;
  setPlanStatus: (status: AsyncStatus) => void;
  setSimulationStatus: (status: AsyncStatus) => void;
  setPlanError: (msg: string | null) => void;
  setSimulationError: (msg: string | null) => void;
  setPlanResult: (result: PlanGenerateResponse | null) => void;
  setSimulationResult: (result: PlanSimulateResponse | null) => void;
  setChatDraft: (text: string) => void;
  setChatMessages: (messages: PlanChatMessage[]) => void;
  appendChatMessage: (msg: PlanChatMessage) => void;
  resetPlanFlow: () => void;
}

export const usePlanStore = create<PlanState>()(
  persist(
    (set) => ({
      activeTab: 'assessment',
      selectedScenarioPack: 'integrated_stable',
      selectedObjective: '稳产优先',
      selectedTaskType: 'priority_actions',
      selectedIrrigation: '有限',
      selectedProgressMode: 'stable',
      currentPointKey: null,
      planStatus: 'idle',
      simulationStatus: 'idle',
      planError: null,
      simulationError: null,
      planResult: null,
      simulationResult: null,
      chatDraft: '',
      chatMessages: [],
      setActiveTab: (activeTab) => set({ activeTab }),
      setSelectedScenarioPack: (selectedScenarioPack) => set({ selectedScenarioPack }),
      setSelectedObjective: (selectedObjective) => set({ selectedObjective }),
      setSelectedTaskType: (selectedTaskType) => set({ selectedTaskType }),
      setSelectedIrrigation: (selectedIrrigation) => set({ selectedIrrigation }),
      setSelectedProgressMode: (selectedProgressMode) => set({ selectedProgressMode }),
      setCurrentPointKey: (currentPointKey) => set({ currentPointKey }),
      setPlanStatus: (planStatus) => set({ planStatus }),
      setSimulationStatus: (simulationStatus) => set({ simulationStatus }),
      setPlanError: (planError) => set({ planError }),
      setSimulationError: (simulationError) => set({ simulationError }),
      setPlanResult: (planResult) => set({ planResult }),
      setSimulationResult: (simulationResult) =>
        set({ simulationResult: normalizeSimulationResult(simulationResult) }),
      setChatDraft: (chatDraft) => set({ chatDraft }),
      setChatMessages: (chatMessages) => set({ chatMessages }),
      appendChatMessage: (msg) => set((state) => ({ chatMessages: [...state.chatMessages, msg] })),
      resetPlanFlow: () =>
        set({
          activeTab: 'assessment',
          planStatus: 'idle',
          simulationStatus: 'idle',
          planError: null,
          simulationError: null,
          planResult: null,
          simulationResult: null,
          chatDraft: '',
          chatMessages: [],
        }),
    }),
    {
      name: PLAN_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeTab: state.activeTab,
        selectedScenarioPack: state.selectedScenarioPack,
        selectedObjective: state.selectedObjective,
        selectedTaskType: state.selectedTaskType,
        selectedIrrigation: state.selectedIrrigation,
        selectedProgressMode: state.selectedProgressMode,
        currentPointKey: state.currentPointKey,
        planResult: state.planResult,
        simulationResult: state.simulationResult,
        chatDraft: state.chatDraft,
        chatMessages: state.chatMessages,
      }),
      merge: (persistedState, currentState) => {
        const partial = (persistedState as Partial<PlanState> | undefined) ?? {};
        const normalizedSimulationResult = normalizeSimulationResult(partial.simulationResult ?? null);
        return {
          ...currentState,
          ...partial,
          simulationResult: normalizedSimulationResult,
          planStatus: partial.planResult ? 'ready' : 'idle',
          simulationStatus: normalizedSimulationResult ? 'ready' : 'idle',
          planError: null,
          simulationError: null,
        };
      },
    }
  )
);
