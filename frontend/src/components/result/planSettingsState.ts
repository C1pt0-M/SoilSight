type PlanAsyncStatus = 'idle' | 'loading' | 'ready' | 'error';

interface DrawerPlanActionInputs {
  canGenerateContextPlan: boolean;
  hasPlanResult: boolean;
  planStatus: PlanAsyncStatus;
}

export const getDrawerPlanActionState = ({
  canGenerateContextPlan,
  hasPlanResult,
  planStatus,
}: DrawerPlanActionInputs): { disabled: boolean; label: string } => {
  if (planStatus === 'loading') {
    return { disabled: true, label: '生成中...' };
  }
  return {
    disabled: !canGenerateContextPlan,
    label: hasPlanResult ? '重新生成规划' : '生成当前地块规划',
  };
};
