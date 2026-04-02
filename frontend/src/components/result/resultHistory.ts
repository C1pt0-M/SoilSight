import type { ClickResult } from '../../models/shi';

const formatCoord = (value: number | undefined): string => (
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(5) : 'na'
);

export const buildHistoryItemKey = (item: ClickResult): string => {
  const sampleLon = typeof item.sampleLon === 'number' ? item.sampleLon : item.lon;
  const sampleLat = typeof item.sampleLat === 'number' ? item.sampleLat : item.lat;
  return [
    item.status,
    formatCoord(item.lon),
    formatCoord(item.lat),
    formatCoord(sampleLon),
    formatCoord(sampleLat),
  ].join(':');
};
