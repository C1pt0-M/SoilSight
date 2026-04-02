import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import AppHeader from '../../components/common/AppHeader';
import LayerPanel from '../../components/map/LayerPanel';
import MapCanvas from '../../components/map/MapCanvas';
import type { MapCanvasHandle } from '../../components/map/MapCanvas';
import ResultDrawer from '../../components/result/ResultDrawer';
import { useMapStore } from '../../store/mapStore';
import { usePlanStore } from '../../store/planStore';
import { useResultStore } from '../../store/resultStore';
import { shiService } from '../../services/shiService';
import { buildClickRequestKey, resolveClickRequestProfileId } from '../../utils/clickRequest';
import './MapAssessmentPage.css';

const MapAssessmentPage: React.FC = () => {
  const clickedPoint = useMapStore((state) => state.clickedPoint);
  const activeLayer = useMapStore((state) => state.activeLayer);
  const activeScoreProfileId = useMapStore((state) => state.activeScoreProfileId);
  const setStatus = useResultStore((state) => state.setStatus);
  const setCurrentResult = useResultStore((state) => state.setCurrentResult);
  const setLastError = useResultStore((state) => state.setLastError);
  const addHistory = useResultStore((state) => state.addHistory);
  const currentPointKey = usePlanStore((state) => state.currentPointKey);
  const setCurrentPointKey = usePlanStore((state) => state.setCurrentPointKey);
  const resetPlanFlow = usePlanStore((state) => state.resetPlanFlow);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mapCanvasRef = useRef<MapCanvasHandle>(null);
  const requestProfileId = useMemo(
    () => resolveClickRequestProfileId(activeLayer, activeScoreProfileId),
    [activeLayer, activeScoreProfileId],
  );
  const requestPointKey = useMemo(
    () => buildClickRequestKey(clickedPoint, requestProfileId),
    [clickedPoint, requestProfileId],
  );

  const handleExportMap = useCallback(() => {
    mapCanvasRef.current?.exportMapPNG();
  }, []);

  useEffect(() => {
    if (!clickedPoint || !requestPointKey) return;

    const [lon, lat] = clickedPoint;
    if (currentPointKey !== requestPointKey) {
      setCurrentPointKey(requestPointKey);
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
    requestPointKey,
    requestProfileId,
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
