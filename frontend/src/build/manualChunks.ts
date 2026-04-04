const APP_VENDOR_TOKENS = [
  '/react/',
  '\\react\\',
  '/react-dom/',
  '\\react-dom\\',
  '/react-router/',
  '\\react-router\\',
  '/react-router-dom/',
  '\\react-router-dom\\',
  '/scheduler/',
  '\\scheduler\\',
];

const MAP_VENDOR_TOKENS = [
  '/react-map-gl/',
  '\\react-map-gl\\',
  '/maplibre-gl/',
  '\\maplibre-gl\\',
];

const CHART_VENDOR_TOKENS = [
  '/echarts/',
  '\\echarts\\',
  '/echarts-for-react/',
  '\\echarts-for-react\\',
  '/zrender/',
  '\\zrender\\',
];

const UI_VENDOR_TOKENS = [
  '/lucide-react/',
  '\\lucide-react\\',
];

const includesAny = (id: string, tokens: string[]) => tokens.some((token) => id.includes(token));

export const getManualChunk = (id: string): string | undefined => {
  if (!id.includes('node_modules')) {
    return undefined;
  }
  if (includesAny(id, CHART_VENDOR_TOKENS)) {
    return 'chart-vendor';
  }
  if (includesAny(id, MAP_VENDOR_TOKENS)) {
    return 'map-vendor';
  }
  if (includesAny(id, UI_VENDOR_TOKENS)) {
    return 'ui-vendor';
  }
  if (includesAny(id, APP_VENDOR_TOKENS)) {
    return 'app-vendor';
  }
  return 'vendor';
};
