import { DEFAULT_STAGE_COUNT, DEFAULT_STAGE_LABELS } from './stageLabels.js';

const toFiniteNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toOptionalFiniteNumber = (value) => {
  const parsed = toFiniteNumber(value);
  return parsed === null ? undefined : parsed;
};

const toStageIndex = (rawPoint) =>
  toFiniteNumber(rawPoint.stageIndex ?? rawPoint.stage_index ?? rawPoint.month);

const normalizePoint = (rawPoint) => {
  if (!rawPoint || typeof rawPoint !== 'object') return null;
  const stageIndex = toStageIndex(rawPoint);
  const shi = toFiniteNumber(rawPoint.shi);
  if (stageIndex === null || shi === null) return null;

  return {
    stageIndex,
    shi,
    prod: toFiniteNumber(rawPoint.prod) ?? 0,
    stab: toFiniteNumber(rawPoint.stab) ?? 0,
    soil: toFiniteNumber(rawPoint.soil) ?? 0,
    water: toFiniteNumber(rawPoint.water) ?? 0,
    salinity: toFiniteNumber(rawPoint.salinity) ?? 0,
    terrain: toFiniteNumber(rawPoint.terrain) ?? 0,
  };
};

const normalizeSeries = (rawSeries) => {
  if (!Array.isArray(rawSeries)) return null;
  const points = rawSeries.map(normalizePoint);
  if (points.some((point) => point === null)) return null;
  const normalized = points.slice().sort((left, right) => left.stageIndex - right.stageIndex);
  if (normalized.length !== DEFAULT_STAGE_COUNT) return null;
  for (let index = 0; index < DEFAULT_STAGE_COUNT; index += 1) {
    if (normalized[index].stageIndex !== index) return null;
  }
  return normalized;
};

const normalizePercentileBand = (rawBand) => {
  if (!rawBand || typeof rawBand !== 'object') return null;
  const stageIndex = toStageIndex(rawBand);
  const p10 = toFiniteNumber(rawBand.p10);
  const p25 = toFiniteNumber(rawBand.p25);
  const p50 = toFiniteNumber(rawBand.p50);
  const p75 = toFiniteNumber(rawBand.p75);
  const p90 = toFiniteNumber(rawBand.p90);
  if (
    stageIndex === null ||
    p10 === null ||
    p25 === null ||
    p50 === null ||
    p75 === null ||
    p90 === null
  ) {
    return null;
  }
  return { stageIndex, p10, p25, p50, p75, p90 };
};

const normalizePercentileBands = (rawBands) => {
  if (!Array.isArray(rawBands)) return undefined;
  const bands = rawBands.map(normalizePercentileBand);
  if (bands.some((band) => band === null)) return undefined;
  const normalized = bands.slice().sort((left, right) => left.stageIndex - right.stageIndex);
  if (normalized.length !== DEFAULT_STAGE_COUNT) return undefined;
  for (let index = 0; index < DEFAULT_STAGE_COUNT; index += 1) {
    if (normalized[index].stageIndex !== index) return undefined;
  }
  return normalized;
};

const normalizeStageLabels = (rawLabels) => {
  if (!Array.isArray(rawLabels) || rawLabels.length !== DEFAULT_STAGE_COUNT) {
    return [...DEFAULT_STAGE_LABELS];
  }
  const labels = rawLabels
    .map((label) => String(label ?? '').trim())
    .filter((label) => label.length > 0);
  return labels.length === DEFAULT_STAGE_COUNT ? labels : [...DEFAULT_STAGE_LABELS];
};

export const normalizeSimulationResult = (rawResult) => {
  if (!rawResult || typeof rawResult !== 'object') return null;

  const simulation = rawResult.simulation;
  const scenarioPack = rawResult.scenarioPack;
  const comparison = simulation?.comparison;
  const series = simulation?.series;
  if (!simulation || !scenarioPack || !comparison || !series) return null;

  const baseline = normalizeSeries(series.baseline);
  const expected = normalizeSeries(series.expected);
  const conservative = normalizeSeries(series.conservative);
  const optimistic = normalizeSeries(series.optimistic);
  if (!baseline || !expected || !conservative || !optimistic) return null;

  const baselineEndShi = toFiniteNumber(comparison.baselineEndShi);
  const expectedEndShi = toFiniteNumber(comparison.expectedEndShi);
  const conservativeEndShi = toFiniteNumber(comparison.conservativeEndShi);
  const optimisticEndShi = toFiniteNumber(comparison.optimisticEndShi);
  const expectedDeltaShi = toFiniteNumber(comparison.expectedDeltaShi);
  if (
    baselineEndShi === null ||
    expectedEndShi === null ||
    conservativeEndShi === null ||
    optimisticEndShi === null ||
    expectedDeltaShi === null
  ) {
    return null;
  }

  return {
    sessionId: String(rawResult.sessionId ?? ''),
    scenarioPack: {
      id: String(scenarioPack.id ?? ''),
      name: String(scenarioPack.name ?? ''),
    },
    simulation: {
      progressMode: String(simulation.progressMode ?? 'stable'),
      stageCount: DEFAULT_STAGE_COUNT,
      stageLabels: normalizeStageLabels(simulation.stageLabels),
      series: {
        baseline,
        expected,
        conservative,
        optimistic,
      },
      comparison: {
        baselineEndShi,
        expectedEndShi,
        conservativeEndShi,
        optimisticEndShi,
        expectedDeltaShi,
      },
      percentileBands: normalizePercentileBands(simulation.percentileBands),
      hasMonteCarlo: typeof simulation.hasMonteCarlo === 'boolean' ? simulation.hasMonteCarlo : undefined,
      nSamples: toOptionalFiniteNumber(simulation.nSamples),
      parameterSources: Array.isArray(simulation.parameterSources) ? simulation.parameterSources : undefined,
      sensitivity: Array.isArray(simulation.sensitivity) ? simulation.sensitivity : undefined,
      mlReference: simulation.mlReference,
      uncertaintyNote: String(simulation.uncertaintyNote ?? ''),
    },
    ruleTraces: Array.isArray(rawResult.ruleTraces) ? rawResult.ruleTraces : [],
  };
};
