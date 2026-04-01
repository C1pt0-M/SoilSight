import { DEFAULT_STAGE_LABELS } from '../../utils/stageLabels.js';

const normalizeStageIndices = (stageIndices: number[]): number[] =>
  stageIndices.filter((stageIndex) => Number.isFinite(stageIndex)).sort((a, b) => a - b);

export const getStageExtent = (
  stageIndices: number[],
): { minStageIndex: number; maxStageIndex: number } => {
  const normalized = normalizeStageIndices(stageIndices);
  if (normalized.length === 0) {
    return { minStageIndex: 0, maxStageIndex: 1 };
  }
  return {
    minStageIndex: normalized[0],
    maxStageIndex: normalized[normalized.length - 1],
  };
};

export const mapStageIndexToX = (
  stageIndex: number,
  minStageIndex: number,
  maxStageIndex: number,
  leftPad: number,
  plotWidth: number,
): number => {
  const span = Math.max(1, maxStageIndex - minStageIndex);
  return leftPad + ((stageIndex - minStageIndex) / span) * plotWidth;
};

export const buildStageTicks = (
  minStageIndex: number,
  maxStageIndex: number,
  stageLabels?: string[],
): number[] => {
  if (stageLabels && stageLabels.length > 0) {
    return stageLabels.map((_, idx) => idx);
  }
  const ticks: number[] = [];
  for (let current = minStageIndex; current <= maxStageIndex; current += 1) {
    ticks.push(current);
  }
  return ticks.length > 0 ? ticks : [0];
};

export const buildSmoothStagePath = (
  points: Array<{ stageIndex: number; shi: number }>,
  mapX: (stageIndex: number) => number,
  mapY: (shi: number) => number,
): string => {
  if (!points.length) return '';
  const sorted = points.slice().sort((left, right) => left.stageIndex - right.stageIndex);
  const first = sorted[0];
  let path = `M ${mapX(first.stageIndex)} ${mapY(first.shi)}`;

  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1];
    const current = sorted[index];
    const prevX = mapX(prev.stageIndex);
    const prevY = mapY(prev.shi);
    const currentX = mapX(current.stageIndex);
    const currentY = mapY(current.shi);
    const controlX = prevX + ((currentX - prevX) / 2);
    path += ` C ${controlX} ${prevY}, ${controlX} ${currentY}, ${currentX} ${currentY}`;
  }

  return path;
};

export const formatStageTickLabel = (
  stageIndex: number,
  _maxStageIndex: number,
  stageLabels?: string[],
): string => {
  if (stageLabels && stageLabels[stageIndex]) return stageLabels[stageIndex];
  return DEFAULT_STAGE_LABELS[stageIndex] ?? `Stage ${stageIndex}`;
};

export const formatTooltipStage = (stageIndex: number, stageLabels?: string[]): string => (
  stageLabels && stageLabels[stageIndex]
    ? stageLabels[stageIndex]
    : (DEFAULT_STAGE_LABELS[stageIndex] ?? `Stage ${stageIndex}`)
);
