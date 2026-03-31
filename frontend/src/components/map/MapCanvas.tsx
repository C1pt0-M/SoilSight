import { useCallback, useRef, useEffect, useState, useImperativeHandle, forwardRef } from 'react';
import type { FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMapStore } from '../../store/mapStore';
import type { MapLayerId } from '../../store/mapStore';
import { scoreProfileIdToLayer } from '../../store/mapStore';
import { useResultStore } from '../../store/resultStore';
import { shiService } from '../../services/shiService';
import SearchBar from './SearchBar';
import './MapCanvas.css';

/* ---- 天地图底图（WMTS 栅格瓦片） ---- */
const TDT_KEY = import.meta.env.VITE_TIANDITU_KEY as string || '';

/** 构建天地图 WMTS 瓦片 URL（使用 t0-t7 子域名负载均衡） */
const tdtTiles = (layer: string): string[] =>
  [0, 1, 2, 3, 4, 5, 6, 7].map(
    (n) =>
      `https://t${n}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0` +
      `&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles` +
      `&TILECOL={x}&TILEROW={y}&TILEMATRIX={z}&tk=${TDT_KEY}`,
  );

/** MapLibre 样式：天地图矢量底图 + 中文注记 */
const TIANDITU_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'tdt-vec': { type: 'raster', tiles: tdtTiles('vec'), tileSize: 256 },
    'tdt-cva': { type: 'raster', tiles: tdtTiles('cva'), tileSize: 256 },
  },
  layers: [
    { id: 'tdt-vec-layer', type: 'raster', source: 'tdt-vec', minzoom: 0, maxzoom: 18 },
    { id: 'tdt-cva-layer', type: 'raster', source: 'tdt-cva', minzoom: 0, maxzoom: 18 },
  ],
};

interface MapMoveEvent {
  viewState: {
    longitude: number;
    latitude: number;
    zoom: number;
  };
}

const DEFAULT_OVERLAY_COORDINATES: [[number, number], [number, number], [number, number], [number, number]] = [
  [76.93234087311833, 39.93749999617405],
  [78.31263433796062, 39.93749999617405],
  [77.5669208423045, 39.27499999623751],
  [76.19977089476822, 39.27499999623751],
];

interface OverlayDef {
  id: string;
  file: string;
  layerKey: MapLayerId;
  opacity: number;
}

const OVERLAY_LAYERS: OverlayDef[] = [
  { id: 'cropland-overlay', file: 'cropland_overlay.png', layerKey: 'cropland', opacity: 0.9 },
  { id: 'cotton-shi-overlay', file: 'cotton_shi_class_overlay.png', layerKey: 'cotton_shi', opacity: 1 },
  { id: 'sugarbeet-shi-overlay', file: 'sugarbeet_shi_class_overlay.png', layerKey: 'sugarbeet_shi', opacity: 1 },
  { id: 'maize-shi-overlay', file: 'maize_shi_class_overlay.png', layerKey: 'maize_shi', opacity: 1 },
  { id: 'drought-risk-overlay', file: 'drought_risk_overlay.png', layerKey: 'drought_risk', opacity: 0.8 },
  { id: 'heat-risk-overlay', file: 'heat_risk_overlay.png', layerKey: 'heat_risk', opacity: 0.8 },
  { id: 'soil-norm-overlay', file: 'soil_norm_overlay.png', layerKey: 'soil_norm', opacity: 0.8 },
  { id: 'water-norm-overlay', file: 'water_norm_overlay.png', layerKey: 'water_norm', opacity: 0.9 },
];

const CROPLAND_OVERLAY_LAYER_ID = 'cropland-overlay-layer';

const isCropScoreLayer = (layer: MapLayerId) =>
  layer === 'cotton_shi' || layer === 'sugarbeet_shi' || layer === 'maize_shi';

const overlayOpacityForLayer = (overlay: OverlayDef, activeLayer: MapLayerId): number => {
  if (overlay.layerKey === activeLayer) return overlay.opacity;
  if (overlay.layerKey === 'cropland' && isCropScoreLayer(activeLayer)) {
    return 0.22;
  }
  return 0;
};

type BoundaryGeoJSON = FeatureCollection<Geometry, GeoJsonProperties>;

export interface MapCanvasHandle {
  exportMapPNG: () => void;
}

const MapCanvas = forwardRef<MapCanvasHandle>((_, ref) => {
  const mapRef = useRef<MapRef>(null);
  const [overlayCoordinates, setOverlayCoordinates] = useState(DEFAULT_OVERLAY_COORDINATES);
  const [overlayVersion, setOverlayVersion] = useState<string>('initial');
  const [boundaryGeojson, setBoundaryGeojson] = useState<BoundaryGeoJSON | null>(null);
  const { center, zoom, clickedPoint, activeLayer, setActiveLayer, setActiveScoreProfileId, setAvailableScoreProfiles, setClickedPoint, setCenter, setZoom } = useMapStore();
  const { currentResult } = useResultStore();
  const aoiMaskOpacity = 0.22;

  useEffect(() => {
    let cancelled = false;
    shiService.getHealth()
      .then((health) => {
        if (cancelled || !health?.ok) return;
        const availableProfiles =
          health.availableScoreProfiles && health.availableScoreProfiles.length > 0
            ? health.availableScoreProfiles
            : health.scoreProfileId
              ? [{ id: health.scoreProfileId, name: health.scoreProfileName ?? health.scoreProfileId }]
              : [];
        if (availableProfiles.length > 0) {
          setAvailableScoreProfiles(availableProfiles);
          const currentProfileId = useMapStore.getState().activeScoreProfileId;
          const currentLayer = useMapStore.getState().activeLayer;
          const nextProfileId = availableProfiles.some((item) => item.id === currentProfileId)
            ? currentProfileId
            : (health.scoreProfileId ?? availableProfiles[0].id);
          setActiveScoreProfileId(nextProfileId);
          if (isCropScoreLayer(currentLayer)) {
            setActiveLayer(scoreProfileIdToLayer(nextProfileId));
          }
        } else if (health.scoreProfileId) {
          setActiveScoreProfileId(health.scoreProfileId);
          setActiveLayer(scoreProfileIdToLayer(health.scoreProfileId));
        }
      })
      .catch(() => {
        return;
      });
    return () => {
      cancelled = true;
    };
  }, [setActiveLayer, setActiveScoreProfileId, setAvailableScoreProfiles]);

  const exportOverlayOnly = async (map: maplibregl.Map) => {
    const overlay = OVERLAY_LAYERS.find((item) => item.layerKey === activeLayer);
    if (!overlay) {
      alert('导出失败：当前图层不可导出');
      return;
    }
    const mapCanvas = map.getCanvas();
    const width = mapCanvas.width;
    const height = mapCanvas.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      alert('导出失败：无法创建画布');
      return;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const overlayUrl = `/overlays/${overlay.file}?v=${overlayVersion}`;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('overlay load failed'));
    });
    img.src = overlayUrl;
    try {
      await loaded;
    } catch (err) {
      console.warn('Overlay export failed:', err);
      alert('导出失败：叠加层加载异常');
      return;
    }

    const coords = overlayCoordinates;
    if (coords.length === 4) {
      const topLeft = map.project({ lng: coords[0][0], lat: coords[0][1] });
      const bottomRight = map.project({ lng: coords[2][0], lat: coords[2][1] });
      const x = Math.min(topLeft.x, bottomRight.x);
      const y = Math.min(topLeft.y, bottomRight.y);
      const w = Math.abs(bottomRight.x - topLeft.x);
      const h = Math.abs(bottomRight.y - topLeft.y);
      if (w > 0 && h > 0) {
        if (isCropScoreLayer(activeLayer)) {
          const cropImg = new Image();
          cropImg.crossOrigin = 'anonymous';
          const cropLoaded = new Promise<void>((resolve, reject) => {
            cropImg.onload = () => resolve();
            cropImg.onerror = () => reject(new Error('cropland overlay load failed'));
          });
          cropImg.src = `/overlays/cropland_overlay.png?v=${overlayVersion}`;
          try {
            await cropLoaded;
            ctx.globalAlpha = 0.22;
            ctx.drawImage(cropImg, x, y, w, h);
            ctx.globalAlpha = 1;
          } catch (err) {
            console.warn('Cropland background export skipped:', err);
          }
        }
        ctx.drawImage(img, x, y, w, h);
      }
    }

    const marker: [number, number] | null = (() => {
      if (currentResult && typeof currentResult.sampleLon === 'number' && typeof currentResult.sampleLat === 'number') {
        return [currentResult.sampleLon, currentResult.sampleLat];
      }
      return clickedPoint;
    })();
    if (marker) {
      const pt = map.project({ lng: marker[0], lat: marker[1] });
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = isCropScoreLayer(activeLayer) ? '#bd842d' : '#2e7d32';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const attribution = '导出不含底图 | 审图号：GS(2024)0650号 | 底图数据 © 天地图';
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    const textMetrics = ctx.measureText(attribution);
    const textWidth = textMetrics.width;
    const textHeight = 16;
    const padding = 8;
    const boxWidth = textWidth + padding * 2;
    const boxHeight = textHeight + padding;
    const boxX = width - boxWidth - 8;
    const boxY = height - boxHeight - 8;
    ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
    ctx.fillStyle = '#333';
    ctx.fillText(attribution, boxX + padding, boxY + padding + 11);

    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length < 100) {
      alert('导出失败：叠加层画布为空，请稍后重试');
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `soilsight_overlay_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    alert('底图受跨域限制，已导出叠加层（不含底图）。');
  };

  useImperativeHandle(ref, () => ({
    exportMapPNG: () => {
      const map = mapRef.current?.getMap();
      if (!map) return;
      try {
        map.once('render', () => {
          try {
            const mapCanvas = map.getCanvas();
            const width = mapCanvas.width;
            const height = mapCanvas.height;

            // Create composite canvas
            const compositeCanvas = document.createElement('canvas');
            compositeCanvas.width = width;
            compositeCanvas.height = height;
            const ctx = compositeCanvas.getContext('2d');
            if (!ctx) {
              alert('导出失败：无法创建画布');
              return;
            }

            // Draw map
            ctx.drawImage(mapCanvas, 0, 0);

            // Draw attribution overlay
            const attribution = '审图号：GS(2024)0650号 | 底图数据 © 天地图';
            ctx.font = '11px sans-serif';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            const textMetrics = ctx.measureText(attribution);
            const textWidth = textMetrics.width;
            const textHeight = 16;
            const padding = 8;
            const boxWidth = textWidth + padding * 2;
            const boxHeight = textHeight + padding;
            const boxX = width - boxWidth - 8;
            const boxY = height - boxHeight - 8;

            ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
            ctx.fillStyle = '#333';
            ctx.fillText(attribution, boxX + padding, boxY + padding + 11);

            // Download
            let dataUrl = '';
            try {
              dataUrl = compositeCanvas.toDataURL('image/png');
            } catch (err) {
              console.warn('Map export failed (tainted canvas):', err);
              exportOverlayOnly(map);
              return;
            }
            if (dataUrl.length < 100) {
              console.warn('Export produced empty canvas data');
              exportOverlayOnly(map);
              return;
            }
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `soilsight_map_${Date.now()}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } catch (err) {
            console.warn('Map export failed:', err);
            exportOverlayOnly(map);
          }
        });
        map.triggerRepaint();
      } catch (err) {
        console.warn('Map export trigger failed:', err);
        exportOverlayOnly(map);
      }
    },
  }));

  const onMapClick = useCallback((event: MapLayerMouseEvent) => {
    const { lng, lat } = event.lngLat;
    setClickedPoint([lng, lat]);
  }, [setClickedPoint]);

  const onMove = useCallback((evt: MapMoveEvent) => {
    const { longitude, latitude } = evt.viewState;
    setCenter([longitude, latitude]);
    setZoom(evt.viewState.zoom);
  }, [setCenter, setZoom]);

  // Handle flyTo when center/zoom changes from outside (e.g. reset view)
  useEffect(() => {
    if (mapRef.current) {
      const currentCenter = mapRef.current.getCenter();
      if (Math.abs(currentCenter.lng - center[0]) > 0.0001 || Math.abs(currentCenter.lat - center[1]) > 0.0001) {
        mapRef.current.flyTo({
          center: center,
          zoom: zoom,
          duration: 1000
        });
      }
    }
  }, [center, zoom]);

  useEffect(() => {
    let cancelled = false;
    fetch('/overlays/overlay_meta.json')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload || !Array.isArray(payload.coordinates) || payload.coordinates.length !== 4) {
          return;
        }
        const parsed = payload.coordinates.map((item: unknown) => {
          if (!Array.isArray(item) || item.length !== 2) return null;
          const lon = Number(item[0]);
          const lat = Number(item[1]);
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
          return [lon, lat] as [number, number];
        });
        if (parsed.some((item: [number, number] | null) => item === null)) {
          return;
        }
        const coords = parsed as [[number, number], [number, number], [number, number], [number, number]];
        setOverlayCoordinates(coords);
        const version = payload.asset_version;
        if (typeof version === 'number' || typeof version === 'string') {
          setOverlayVersion(String(version));
        } else {
          setOverlayVersion(String(Date.now()));
        }
        const lons = coords.map((item) => item[0]);
        const lats = coords.map((item) => item[1]);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const span = Math.max(maxLon - minLon, maxLat - minLat);
        let zoomGuess = 8.5;
        if (span > 15) zoomGuess = 4.8;
        else if (span > 8) zoomGuess = 5.5;
        else if (span > 3) zoomGuess = 6.5;
        else if (span > 1) zoomGuess = 8;
        setCenter([(minLon + maxLon) / 2, (minLat + maxLat) / 2]);
        setZoom(zoomGuess);
      })
      .catch(() => {
        return;
      });
    return () => {
      cancelled = true;
    };
  }, [setCenter, setZoom]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/geo/xinjiang_boundary')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload || !payload.geojson) return;
        if (payload.geojson && payload.geojson.type === 'FeatureCollection') {
          setBoundaryGeojson(payload.geojson as BoundaryGeoJSON);
        }
      })
      .catch(() => {
        return;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const markerPoint: [number, number] | null = (() => {
    if (currentResult && typeof currentResult.sampleLon === 'number' && typeof currentResult.sampleLat === 'number') {
      return [currentResult.sampleLon, currentResult.sampleLat];
    }
    return clickedPoint;
  })();

  return (
    <div className="map-container">
      <Map
        ref={mapRef}
        initialViewState={{
          longitude: center[0],
          latitude: center[1],
          zoom: zoom
        }}
        canvasContextAttributes={{ preserveDrawingBuffer: true }}
        mapStyle={TIANDITU_STYLE}
        onClick={onMapClick}
        onMove={onMove}
        style={{ width: '100%', height: '100%' }}
        mapLib={maplibregl}
      >
        {boundaryGeojson && (
          <Source id="xinjiang-boundary" type="geojson" data={boundaryGeojson} />
        )}
        {boundaryGeojson && (
          <Layer
            id="xinjiang-boundary-fill"
            type="fill"
            source="xinjiang-boundary"
            paint={{
              'fill-color': '#c4beb0',
              'fill-opacity': aoiMaskOpacity,
            }}
          />
        )}
        {OVERLAY_LAYERS.map((ol) => (
          <Source
            key={ol.id}
            id={ol.id}
            type="image"
            url={`/overlays/${ol.file}?v=${overlayVersion}`}
            coordinates={overlayCoordinates}
          >
            <Layer
              id={ol.id === 'cropland-overlay' ? CROPLAND_OVERLAY_LAYER_ID : `${ol.id}-layer`}
              type="raster"
              paint={{
                'raster-opacity': overlayOpacityForLayer(ol, activeLayer),
                'raster-resampling': 'nearest',
              }}
            />
          </Source>
        ))}
        {boundaryGeojson && (
          <Layer
            id="xinjiang-boundary-line"
            type="line"
            source="xinjiang-boundary"
            paint={{
              'line-color': '#8c7a64',
              'line-width': 1.2,
              'line-opacity': 0.7,
            }}
          />
        )}

        {markerPoint && (
          <Marker
            longitude={markerPoint[0]}
            latitude={markerPoint[1]}
            anchor="bottom"
            color={isCropScoreLayer(activeLayer) ? '#bd842d' : '#2e7d32'}
          />
        )}
      </Map>
      <SearchBar />
      <div className="map-attribution">
        审图号：GS(2024)0650号 | 底图数据 © 天地图
      </div>
    </div>
  );
});

MapCanvas.displayName = 'MapCanvas';

export default MapCanvas;
