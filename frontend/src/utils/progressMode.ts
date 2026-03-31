import type { ProgressMode } from '../models/shi';

export const progressModeLabel = (progressMode: ProgressMode): string => {
  if (progressMode === 'aggressive') return '积极推进';
  if (progressMode === 'conservative') return '保守推进';
  return '稳健推进';
};
