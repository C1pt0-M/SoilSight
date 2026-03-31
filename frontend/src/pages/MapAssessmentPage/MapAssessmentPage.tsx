import React, { useCallback, useEffect, useRef } from 'react';
import AppHeader from '../../components/common/AppHeader';
import LayerPanel from '../../components/map/LayerPanel';
import MapCanvas from '../../components/map/MapCanvas';
import type { MapCanvasHandle } from '../../components/map/MapCanvas';
import ResultDrawer from '../../components/result/ResultDrawer';
import { useMapStore } from '../../store/mapStore';
import { usePlanStore } from '../../store/planStore';
import { useResultStore } from '../../store/resultStore';
import { shiService } from '../../services/shiService';
import './MapAssessmentPage.css';

const MapAssessmentPage: React.FC = () => {
  const { clickedPoint, activeLayer, activeScoreProfileId } = useMapStore();
  const { setStatus, setCurrentResult, setLastError, addHistory } = useResultStore();
  const { currentPointKey, setCurrentPointKey, resetPlanFlow } = usePlanStore();
  const abortControllerRef = useRef<AbortController | null>(null);
  const mapCanvasRef = useRef<MapCanvasHandle>(null);

  const handleExportMap = useCallback(() => {
    mapCanvasRef.current?.exportMapPNG();
  }, []);

  useEffect(() => {
    if (!clickedPoint) return;

    const [lon, lat] = clickedPoint;
    const isCropScoreLayer =
      activeLayer === 'cotton_shi' || activeLayer === 'sugarbeet_shi' || activeLayer === 'maize_shi';
    const requestProfileId = isCropScoreLayer ? activeScoreProfileId : 'general';
    const pointKey = `${requestProfileId}:${lon.toFixed(5)}_${lat.toFixed(5)}`;
    if (currentPointKey !== pointKey) {
      setCurrentPointKey(pointKey);
      resetPlanFlow();
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    const fetchData = async () => {
      setStatus('loading');
      setLastError(null);
      try {
        const result = await shiService.getShiClick(lon, lat, requestProfileId, signal);
        setCurrentResult(result);
        setStatus(result.status);
        addHistory(result);
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;

        console.error('Fetch error:', error);
        if (error instanceof DOMException && error.name === 'TimeoutError') {
          setLastError('查询超时，请重试或提高前端超时配置（VITE_API_TIMEOUT_MS）。');
        } else if (error instanceof Error && /timed out/i.test(error.message)) {
          setLastError('查询超时，请重试或提高前端超时配置（VITE_API_TIMEOUT_MS）。');
        } else {
          setLastError(error instanceof Error && error.message ? error.message : '查询服务异常');
        }
        setStatus('error');
      }
    };

    fetchData();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [
    clickedPoint,
    activeLayer,
    activeScoreProfileId,
    currentPointKey,
    setCurrentPointKey,
    resetPlanFlow,
    setStatus,
    setCurrentResult,
    setLastError,
    addHistory,
  ]);

  return (
    <div className="page-container">
      <AppHeader />
      <main className="main-content">
        <LayerPanel onExportMap={handleExportMap} />
        <div className="map-area">
          <MapCanvas ref={mapCanvasRef} />
        </div>
        <ResultDrawer />
      </main>
    </div>
  );
};

export default MapAssessmentPage;
