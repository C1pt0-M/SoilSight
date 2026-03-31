import { create } from 'zustand';

export type MapLayerId =
  | 'cotton_shi'
  | 'sugarbeet_shi'
  | 'maize_shi'
  | 'cropland'
  | 'drought_risk'
  | 'heat_risk'
  | 'soil_norm'
  | 'water_norm';

export interface ScoreProfileOption {
  id: string;
  name: string;
}

interface MapState {
  center: [number, number];
  zoom: number;
  clickedPoint: [number, number] | null;
  activeLayer: MapLayerId;
  activeScoreProfileId: string;
  availableScoreProfiles: ScoreProfileOption[];
  setCenter: (center: [number, number]) => void;
  setZoom: (zoom: number) => void;
  setClickedPoint: (point: [number, number] | null) => void;
  setActiveLayer: (layer: MapLayerId) => void;
  setActiveScoreProfileId: (profileId: string) => void;
  setAvailableScoreProfiles: (profiles: ScoreProfileOption[]) => void;
  flyTo: (lon: number, lat: number, zoom?: number) => void;
  resetView: () => void;
}

export const SCORE_PROFILE_LAYER_MAP = {
  cotton: 'cotton_shi',
  sugarbeet: 'sugarbeet_shi',
  maize: 'maize_shi',
} as const satisfies Record<string, MapLayerId>;

export const layerToScoreProfileId = (layer: MapLayerId, fallback: string = 'cotton'): string => {
  if (layer === 'cotton_shi') return 'cotton';
  if (layer === 'sugarbeet_shi') return 'sugarbeet';
  if (layer === 'maize_shi') return 'maize';
  return fallback;
};

export const scoreProfileIdToLayer = (profileId: string): MapLayerId => {
  if (profileId === 'maize') return 'maize_shi';
  if (profileId === 'sugarbeet') return 'sugarbeet_shi';
  return 'cotton_shi';
};

const DEFAULT_SCORE_PROFILES: ScoreProfileOption[] = [
  { id: 'cotton', name: '棉花 profile 评分' },
  { id: 'sugarbeet', name: '甜菜 profile 评分' },
  { id: 'maize', name: '玉米 profile 评分' },
];

export const useMapStore = create<MapState>((set) => ({
  center: [85.0, 41.5],
  zoom: 5.5,
  clickedPoint: null,
  activeLayer: 'cotton_shi',
  activeScoreProfileId: 'cotton',
  availableScoreProfiles: DEFAULT_SCORE_PROFILES,
  setCenter: (center) => set({ center }),
  setZoom: (zoom) => set({ zoom }),
  setClickedPoint: (clickedPoint) => set({ clickedPoint }),
  setActiveLayer: (activeLayer) =>
    set((state) => ({
      activeLayer,
      activeScoreProfileId: layerToScoreProfileId(activeLayer, state.activeScoreProfileId),
    })),
  setActiveScoreProfileId: (activeScoreProfileId) => set({ activeScoreProfileId }),
  setAvailableScoreProfiles: (availableScoreProfiles) =>
    set({
      availableScoreProfiles: availableScoreProfiles.length > 0 ? availableScoreProfiles : DEFAULT_SCORE_PROFILES,
    }),
  flyTo: (lon, lat, zoom) =>
    set(() => ({
      center: [lon, lat],
      clickedPoint: [lon, lat],
      ...(zoom !== undefined ? { zoom } : {}),
    })),
  resetView: () => set({ center: [85.0, 41.5], zoom: 5.5 }),
}));
