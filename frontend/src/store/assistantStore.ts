import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { AssistantConversationRecord, AssistantMode, PlanChatMessage } from '../models/shi';

type AssistantAsyncStatus = 'idle' | 'loading' | 'ready' | 'error';

const ASSISTANT_STORAGE_KEY = 'soilsight-assistant-store-v1';

const GENERAL_WELCOME_MESSAGE: PlanChatMessage = {
  role: 'assistant',
  content:
    '你好，我是 SoilSight 规划工作台。当前系统主线聚焦新疆特色作物 profile 评分，你可以直接咨询棉花、甜菜、玉米、水盐、灌溉、盐碱治理、干旱风险或新疆农业相关问题；如果需要针对具体地块规划，请从地图进入并带入地块上下文。',
};

const createConversationId = () => `general-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const cleanConversationText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .replace(/[`#>*_()[\]-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
};

const buildConversationTitle = (messages: PlanChatMessage[]): string => {
  const firstUserMessage = messages.find((message) => message.role === 'user' && message.content.trim());
  if (!firstUserMessage) return '新对话';
  const text = cleanConversationText(firstUserMessage.content);
  return truncateText(text || '新对话', 18);
};

const buildConversationPreview = (messages: PlanChatMessage[]): string => {
  const latestMessage = [...messages]
    .reverse()
    .find((message) => message.content.trim() && message.content !== GENERAL_WELCOME_MESSAGE.content);
  if (!latestMessage) return '点击开始新一轮对话';
  return truncateText(cleanConversationText(latestMessage.content) || '点击开始新一轮对话', 34);
};

const buildConversationRecord = (messages: PlanChatMessage[]): AssistantConversationRecord => ({
  id: createConversationId(),
  title: buildConversationTitle(messages),
  preview: buildConversationPreview(messages),
  updatedAt: new Date().toISOString(),
  messages,
});

const moveConversationToFront = (
  conversations: AssistantConversationRecord[],
  activeConversationId: string
): AssistantConversationRecord[] => {
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  if (!activeConversation) return conversations;
  return [activeConversation, ...conversations.filter((conversation) => conversation.id !== activeConversationId)];
};

interface AssistantState {
  mode: AssistantMode;
  autoLaunchContextPlan: boolean;
  generalStatus: AssistantAsyncStatus;
  generalError: string | null;
  generalDraft: string;
  generalMessages: PlanChatMessage[];
  generalConversations: AssistantConversationRecord[];
  activeGeneralConversationId: string;
  openGeneralAssistant: () => void;
  openContextualAssistant: (options?: { autoLaunch?: boolean }) => void;
  consumeAutoLaunchContextPlan: () => void;
  setGeneralStatus: (status: AssistantAsyncStatus) => void;
  setGeneralError: (msg: string | null) => void;
  setGeneralDraft: (text: string) => void;
  setGeneralMessages: (messages: PlanChatMessage[]) => void;
  activateGeneralConversation: (id: string) => void;
  deleteGeneralConversation: (id: string) => void;
  primeGeneralConversation: () => void;
  resetGeneralConversation: () => void;
}

const INITIAL_GENERAL_CONVERSATION = buildConversationRecord([GENERAL_WELCOME_MESSAGE]);

const resolveGeneralConversationState = (partial: Partial<AssistantState>) => {
  const conversations =
    Array.isArray(partial.generalConversations) && partial.generalConversations.length > 0
      ? partial.generalConversations
      : [INITIAL_GENERAL_CONVERSATION];
  const activeId =
    typeof partial.activeGeneralConversationId === 'string' &&
    conversations.some((conversation) => conversation.id === partial.activeGeneralConversationId)
      ? partial.activeGeneralConversationId
      : conversations[0].id;
  const activeConversation = conversations.find((conversation) => conversation.id === activeId) ?? conversations[0];
  return {
    generalConversations: conversations,
    activeGeneralConversationId: activeId,
    generalMessages:
      Array.isArray(partial.generalMessages) && partial.generalMessages.length > 0
        ? partial.generalMessages
        : activeConversation.messages,
  };
};

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set) => ({
      mode: 'general',
      autoLaunchContextPlan: false,
      generalStatus: 'idle',
      generalError: null,
      generalDraft: '',
      generalMessages: INITIAL_GENERAL_CONVERSATION.messages,
      generalConversations: [INITIAL_GENERAL_CONVERSATION],
      activeGeneralConversationId: INITIAL_GENERAL_CONVERSATION.id,
      openGeneralAssistant: () => set({ mode: 'general', autoLaunchContextPlan: false }),
      openContextualAssistant: (options) =>
        set({
          mode: 'contextual',
          autoLaunchContextPlan: options?.autoLaunch ?? false,
        }),
      consumeAutoLaunchContextPlan: () => set({ autoLaunchContextPlan: false }),
      setGeneralStatus: (generalStatus) => set({ generalStatus }),
      setGeneralError: (generalError) => set({ generalError }),
      setGeneralDraft: (generalDraft) => set({ generalDraft }),
      setGeneralMessages: (generalMessages) =>
        set((state) => {
          const updatedAt = new Date().toISOString();
          let activeGeneralConversationId = state.activeGeneralConversationId;
          let generalConversations = state.generalConversations.map((conversation) => {
            if (conversation.id !== state.activeGeneralConversationId) {
              return conversation;
            }
            return {
              ...conversation,
              messages: generalMessages,
              title: buildConversationTitle(generalMessages),
              preview: buildConversationPreview(generalMessages),
              updatedAt,
            };
          });
          if (!generalConversations.some((conversation) => conversation.id === activeGeneralConversationId)) {
            const newConversation = buildConversationRecord(generalMessages);
            activeGeneralConversationId = newConversation.id;
            generalConversations = [newConversation, ...generalConversations];
          } else {
            generalConversations = moveConversationToFront(generalConversations, activeGeneralConversationId);
          }
          return { generalMessages, generalConversations, activeGeneralConversationId };
        }),
      activateGeneralConversation: (id) =>
        set((state) => {
          const target = state.generalConversations.find((conversation) => conversation.id === id);
          if (!target) return state;
          return {
            activeGeneralConversationId: target.id,
            generalMessages: target.messages,
            generalDraft: '',
            generalStatus: 'idle',
            generalError: null,
          };
        }),
      deleteGeneralConversation: (id) =>
        set((state) => {
          const remaining = state.generalConversations.filter((conversation) => conversation.id !== id);
          if (remaining.length === 0) {
            const newConversation = buildConversationRecord([GENERAL_WELCOME_MESSAGE]);
            return {
              generalConversations: [newConversation],
              activeGeneralConversationId: newConversation.id,
              generalMessages: newConversation.messages,
              generalDraft: '',
              generalStatus: 'idle',
              generalError: null,
            };
          }
          const nextActive =
            state.activeGeneralConversationId === id
              ? remaining[0]
              : remaining.find((conversation) => conversation.id === state.activeGeneralConversationId) || remaining[0];
          return {
            generalConversations: remaining,
            activeGeneralConversationId: nextActive.id,
            generalMessages: nextActive.messages,
            generalDraft: '',
            generalStatus: 'idle',
            generalError: null,
          };
        }),
      primeGeneralConversation: () =>
        set((state) => {
          const resolved = resolveGeneralConversationState(state);
          return {
            activeGeneralConversationId: resolved.activeGeneralConversationId,
            generalMessages: resolved.generalMessages,
          };
        }),
      resetGeneralConversation: () =>
        set((state) => {
          const newConversation = buildConversationRecord([GENERAL_WELCOME_MESSAGE]);
          return {
            generalStatus: 'idle',
            generalError: null,
            generalDraft: '',
            generalMessages: newConversation.messages,
            activeGeneralConversationId: newConversation.id,
            generalConversations: [newConversation, ...state.generalConversations],
          };
        }),
    }),
    {
      name: ASSISTANT_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        mode: state.mode,
        generalDraft: state.generalDraft,
        generalMessages: state.generalMessages,
        generalConversations: state.generalConversations,
        activeGeneralConversationId: state.activeGeneralConversationId,
      }),
      merge: (persistedState, currentState) => {
        const partial = (persistedState as Partial<AssistantState> | undefined) ?? {};
        const resolved = resolveGeneralConversationState(partial);
        return {
          ...currentState,
          ...partial,
          autoLaunchContextPlan: false,
          generalStatus: 'idle',
          generalError: null,
          generalConversations: resolved.generalConversations,
          activeGeneralConversationId: resolved.activeGeneralConversationId,
          generalMessages: resolved.generalMessages,
        };
      },
    }
  )
);
