import type { PercentileBandPoint } from '../models/shi';

type PercentileBandRaw = {
  stage_index: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const parsePercentileBands = (
  raw?: PercentileBandRaw[] | null,
): PercentileBandPoint[] | undefined => {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((band) => ({
    stageIndex: toFiniteNumber(band.stage_index),
    p10: toFiniteNumber(band.p10),
    p25: toFiniteNumber(band.p25),
    p50: toFiniteNumber(band.p50),
    p75: toFiniteNumber(band.p75),
    p90: toFiniteNumber(band.p90),
  }));
};
