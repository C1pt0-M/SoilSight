import type {
  IrrigationConstraint,
  PlanGenerateResponse,
  PlanObjective,
  PlanSimulateResponse,
  ProgressMode,
  ScenarioPackId,
} from '../../models/shi';
import { normalizeSimulationResult } from '../../utils/simulationResultNormalization.js';

export type SimulationPlanState =
  | 'missing_plan'
  | 'ready'
  | 'summary_outdated'
  | 'plan_regeneration_required';

interface SimulationPlanInputs {
  scenarioPack: ScenarioPackId;
  objective: PlanObjective;
  irrigation: IrrigationConstraint;
  progressMode: ProgressMode;
}

interface SimulationResultInputs {
  sessionId: string;
  scenarioPack: ScenarioPackId;
  progressMode: ProgressMode;
}

export const getSimulationPlanState = (
  planResult: PlanGenerateResponse | null,
  inputs: SimulationPlanInputs,
): SimulationPlanState => {
  if (!planResult) return 'missing_plan';
  if (
    planResult.plan.goal !== inputs.objective ||
    planResult.plan.constraints.irrigation !== inputs.irrigation
  ) {
    return 'plan_regeneration_required';
  }
  if (
    planResult.plan.scenarioPack.id !== inputs.scenarioPack ||
    planResult.plan.progressMode !== inputs.progressMode
  ) {
    return 'summary_outdated';
  }
  return 'ready';
};

export type SimulationPanelState =
  | 'missing_plan'
  | 'plan_regeneration_required'
  | 'ready_to_run'
  | 'show_result';

interface SimulationPanelInputs {
  planState: SimulationPlanState;
  hasCurrentSimulation: boolean;
}

export const getSimulationPanelState = (
  inputs: SimulationPanelInputs,
): SimulationPanelState => {
  if (inputs.planState === 'missing_plan') return 'missing_plan';
  if (inputs.planState === 'plan_regeneration_required') {
    return 'plan_regeneration_required';
  }
  return inputs.hasCurrentSimulation ? 'show_result' : 'ready_to_run';
};

export const isSimulationResultCurrent = (
  simulationResult: PlanSimulateResponse | null,
  inputs: SimulationResultInputs,
): boolean => {
  const normalized = normalizeSimulationResult(simulationResult);
  if (!normalized) return false;
  return (
    normalized.sessionId === inputs.sessionId &&
    normalized.scenarioPack.id === inputs.scenarioPack &&
    normalized.simulation.progressMode === inputs.progressMode
  );
};
