import type { PlanSimulateResponse } from '../models/shi';

export declare const normalizeSimulationResult: (
  rawResult: PlanSimulateResponse | null | undefined,
) => PlanSimulateResponse | null;
