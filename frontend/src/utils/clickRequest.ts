import type { MapLayerId } from '../store/mapStore';

const isScoreLayer = (layer: MapLayerId) =>
  layer === 'cotton_shi' || layer === 'sugarbeet_shi' || layer === 'maize_shi';

export const resolveClickRequestProfileId = (
  activeLayer: MapLayerId,
  activeScoreProfileId: string,
): string => (isScoreLayer(activeLayer) ? activeScoreProfileId : 'general');

export const buildClickRequestKey = (
  clickedPoint: [number, number] | null,
  requestProfileId: string,
): string | null => {
  if (!clickedPoint) return null;
  const [lon, lat] = clickedPoint;
  return `${requestProfileId}:${lon.toFixed(5)}_${lat.toFixed(5)}`;
};
