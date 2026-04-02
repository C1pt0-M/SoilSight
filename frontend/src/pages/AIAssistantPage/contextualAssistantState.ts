interface ContextSuggestionState {
  chatSending: boolean;
  canGenerateContextPlan: boolean;
  canChatWithContext: boolean;
}

export const areContextSuggestionChipsDisabled = ({
  chatSending,
  canGenerateContextPlan,
  canChatWithContext,
}: ContextSuggestionState): boolean => {
  if (chatSending) {
    return true;
  }
  return !canGenerateContextPlan && !canChatWithContext;
};
