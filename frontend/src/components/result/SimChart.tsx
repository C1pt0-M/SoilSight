import React, { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { PercentileBandPoint } from '../../models/shi';
import {
  buildStageTicks,
  formatStageTickLabel,
  formatTooltipStage,
  getStageExtent,
  mapStageIndexToX,
} from './simChartUtils';
import './SimChart.css';

interface SimChartProps {
  series: {
    baseline: Array<{ stageIndex: number; shi: number }>;
    expected: Array<{ stageIndex: number; shi: number }>;
    conservative: Array<{ stageIndex: number; shi: number }>;
    optimistic: Array<{ stageIndex: number; shi: number }>;
  };
  percentileBands?: PercentileBandPoint[];
  mlPredEndShi?: number;
  stageLabels?: string[];
}

export interface SimChartHandle {
  exportPNG: () => void;
}

const WIDTH = 360;
const HEIGHT = 220;
const PAD = { top: 20, right: 20, bottom: 36, left: 40 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

const computeYDomain = (
  series: SimChartProps['series'],
  percentileBands?: PercentileBandPoint[],
  mlPredEndShi?: number,
): { yMin: number; yMax: number; yTicks: number[] } => {
  const values: number[] = [];
  for (const s of [series.baseline, series.expected, series.conservative, series.optimistic]) {
    for (const p of s) values.push(p.shi);
  }
  if (percentileBands) {
    for (const b of percentileBands) {
      values.push(b.p10, b.p90);
    }
  }
  if (typeof mlPredEndShi === 'number') values.push(mlPredEndShi);

  if (values.length === 0) return { yMin: 0, yMax: 100, yTicks: [0, 20, 40, 60, 80, 100] };

  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const dataRange = dataMax - dataMin;
  const padding = Math.max(dataRange * 0.1, 1);
  let yMin = Math.floor((dataMin - padding) / 5) * 5;
  let yMax = Math.ceil((dataMax + padding) / 5) * 5;

  // Ensure minimum range of 20
  if (yMax - yMin < 20) {
    const mid = (yMin + yMax) / 2;
    yMin = Math.floor((mid - 10) / 5) * 5;
    yMax = yMin + 20;
  }
  yMin = Math.max(0, yMin);
  yMax = Math.min(100, yMax);

  // Generate ticks
  const step = yMax - yMin > 40 ? 10 : 5;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += step) yTicks.push(v);
  if (yTicks[yTicks.length - 1] !== yMax) yTicks.push(yMax);

  return { yMin, yMax, yTicks };
};

const SimChart = forwardRef<SimChartHandle, SimChartProps>(({ series, percentileBands, mlPredEndShi, stageLabels }, ref) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{
    stageIndex: number;
    svgX: number;
    tooltipLeft: number;
    tooltipTop: number;
    values: Record<string, number>;
  } | null>(null);

  const { yMin, yMax, yTicks: Y_TICKS } = useMemo(
    () => computeYDomain(series, percentileBands, mlPredEndShi),
    [series, percentileBands, mlPredEndShi],
  );

  useImperativeHandle(ref, () => ({
    exportPNG: () => {
      const svg = svgRef.current;
      if (!svg) return;

      // Clone SVG and inline computed styles
      const clone = svg.cloneNode(true) as SVGSVGElement;
      const originalElements = svg.querySelectorAll('*');
      const cloneElements = clone.querySelectorAll('*');
      for (let i = 0; i < originalElements.length; i++) {
        const computed = window.getComputedStyle(originalElements[i]);
        const target = cloneElements[i] as SVGElement;
        target.style.cssText = '';
        for (let j = 0; j < computed.length; j++) {
          const prop = computed[j];
          target.style.setProperty(prop, computed.getPropertyValue(prop));
        }
      }

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);
      const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = WIDTH * scale;
        canvas.height = HEIGHT * scale;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');
          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `soilsight_chart_${Date.now()}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
    },
  }));

  const hasBands = percentileBands && percentileBands.length > 0;

  const { minStageIndex, maxStageIndex } = useMemo(
    () => getStageExtent(series.expected.map((p) => p.stageIndex)),
    [series.expected],
  );

  const mapX = useCallback(
    (stageIndex: number) => mapStageIndexToX(stageIndex, minStageIndex, maxStageIndex, PAD.left, PLOT_W),
    [minStageIndex, maxStageIndex],
  );

  const mapY = useCallback(
    (shi: number) => PAD.top + (1 - (Math.max(yMin, Math.min(yMax, shi)) - yMin) / (yMax - yMin)) * PLOT_H,
    [yMin, yMax],
  );

  const polyline = useCallback(
    (points: Array<{ stageIndex: number; shi: number }>) =>
      points.map((p) => `${mapX(p.stageIndex)},${mapY(p.shi)}`).join(' '),
    [mapX, mapY],
  );

  // Build confidence band polygons from percentile bands
  const band90Poly = useMemo(() => {
    if (!hasBands) return '';
    const sorted = [...percentileBands!].sort((a, b) => a.stageIndex - b.stageIndex);
    const forward = sorted.map((p) => `${mapX(p.stageIndex)},${mapY(p.p10)}`);
    const backward = [...sorted].reverse().map((p) => `${mapX(p.stageIndex)},${mapY(p.p90)}`);
    return [...forward, ...backward].join(' ');
  }, [percentileBands, hasBands, mapX, mapY]);

  const band50Poly = useMemo(() => {
    if (!hasBands) return '';
    const sorted = [...percentileBands!].sort((a, b) => a.stageIndex - b.stageIndex);
    const forward = sorted.map((p) => `${mapX(p.stageIndex)},${mapY(p.p25)}`);
    const backward = [...sorted].reverse().map((p) => `${mapX(p.stageIndex)},${mapY(p.p75)}`);
    return [...forward, ...backward].join(' ');
  }, [percentileBands, hasBands, mapX, mapY]);

  // Legacy range polygon (fallback when no percentile bands)
  const rangePoly = useMemo(() => {
    if (hasBands) return '';
    const consPoints = [...series.conservative].sort((a, b) => a.stageIndex - b.stageIndex);
    const optPoints = [...series.optimistic].sort((a, b) => a.stageIndex - b.stageIndex);
    const forward = consPoints.map((p) => `${mapX(p.stageIndex)},${mapY(p.shi)}`);
    const backward = [...optPoints].reverse().map((p) => `${mapX(p.stageIndex)},${mapY(p.shi)}`);
    return [...forward, ...backward].join(' ');
  }, [series.conservative, series.optimistic, hasBands, mapX, mapY]);

  // Improvement fill polygon between baseline and expected lines
  const improvementPoly = useMemo(() => {
    const baseSorted = [...series.baseline].sort((a, b) => a.stageIndex - b.stageIndex);
    const expSorted = [...series.expected].sort((a, b) => a.stageIndex - b.stageIndex);
    if (baseSorted.length === 0 || expSorted.length === 0) return '';
    const forward = baseSorted.map((p) => `${mapX(p.stageIndex)},${mapY(p.shi)}`);
    const backward = [...expSorted].reverse().map((p) => `${mapX(p.stageIndex)},${mapY(p.shi)}`);
    return [...forward, ...backward].join(' ');
  }, [series.baseline, series.expected, mapX, mapY]);

  // Endpoint data for labels
  const endpoints = useMemo(() => {
    const baseSorted = [...series.baseline].sort((a, b) => a.stageIndex - b.stageIndex);
    const expSorted = [...series.expected].sort((a, b) => a.stageIndex - b.stageIndex);
    return {
      baselineStart: baseSorted.length > 0 ? baseSorted[0] : null,
      expectedEnd: expSorted.length > 0 ? expSorted[expSorted.length - 1] : null,
    };
  }, [series.baseline, series.expected]);

  // X-axis stage ticks
  const xTicks = useMemo(
    () => buildStageTicks(minStageIndex, maxStageIndex, stageLabels),
    [minStageIndex, maxStageIndex, stageLabels],
  );

  // Build stage lookup for tooltip
  const stageLookup = useMemo(() => {
    const lookup = new Map<number, Record<string, number>>();
    if (hasBands) {
      // When we have percentile bands, show band values in tooltip
      for (const p of series.baseline) {
        if (!lookup.has(p.stageIndex)) lookup.set(p.stageIndex, {});
        lookup.get(p.stageIndex)!.baseline = p.shi;
      }
      for (const b of percentileBands!) {
        if (!lookup.has(b.stageIndex)) lookup.set(b.stageIndex, {});
        const entry = lookup.get(b.stageIndex)!;
        entry.p50 = b.p50;
        entry.p25 = b.p25;
        entry.p75 = b.p75;
      }
    } else {
      const META = [
        { key: 'baseline', data: series.baseline },
        { key: 'expected', data: series.expected },
        { key: 'conservative', data: series.conservative },
        { key: 'optimistic', data: series.optimistic },
      ] as const;
      for (const { key, data } of META) {
        for (const p of data) {
          if (!lookup.has(p.stageIndex)) lookup.set(p.stageIndex, {});
          lookup.get(p.stageIndex)![key] = p.shi;
        }
      }
    }
    return lookup;
  }, [series, percentileBands, hasBands]);

  const allStageIndices = useMemo(
    () => [...stageLookup.keys()].sort((a, b) => a - b),
    [stageLookup],
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || allStageIndices.length === 0) return;
      const rect = svg.getBoundingClientRect();
      const scaleX = WIDTH / rect.width;
      const svgX = (e.clientX - rect.left) * scaleX;
      const wrapperRect = e.currentTarget.parentElement?.getBoundingClientRect();

      let closest = allStageIndices[0];
      let minDist = Math.abs(mapX(closest) - svgX);
      for (const stageIndex of allStageIndices) {
        const dist = Math.abs(mapX(stageIndex) - svgX);
        if (dist < minDist) {
          minDist = dist;
          closest = stageIndex;
        }
      }

      const values = stageLookup.get(closest) || {};
      setHover({
        stageIndex: closest,
        svgX: mapX(closest),
        tooltipLeft: wrapperRect ? e.clientX - wrapperRect.left + 12 : 12,
        tooltipTop: wrapperRect ? e.clientY - wrapperRect.top - 20 : 12,
        values,
      });
    },
    [allStageIndices, mapX, stageLookup],
  );

  const onMouseLeave = useCallback(() => setHover(null), []);

  const tooltipStyle = useMemo(() => {
    if (!hover) return undefined;
    return {
      left: hover.tooltipLeft,
      top: hover.tooltipTop,
    } as React.CSSProperties;
  }, [hover]);

  // Legend items
  const legendItems = useMemo(() => {
    if (hasBands) {
      return [
        { label: '基线', color: '#999', dash: true },
        { label: '中位数', color: '#3b82f6', dash: false },
        { label: '改善幅度', color: '#22c55e', band: true, opacity: 0.15 },
        { label: '50%参考范围', color: '#3b82f6', band: true, opacity: 0.14 },
        { label: '90%参考范围', color: '#3b82f6', band: true, opacity: 0.06 },
      ];
    }
    return [
      { label: '基线', color: '#999', dash: true },
      { label: '预期', color: '#3b82f6' },
      { label: '改善幅度', color: '#22c55e', band: true, opacity: 0.15 },
      { label: '保守', color: '#f59e0b' },
      { label: '乐观', color: '#22c55e' },
    ];
  }, [hasBands]);

  // Tooltip rows
  const tooltipRows = useMemo(() => {
    if (!hover) return [];
    if (hasBands) {
      return [
        { label: '基线', color: '#999', value: hover.values.baseline },
        { label: '中位数', color: '#3b82f6', value: hover.values.p50 },
        { label: 'P25', color: '#3b82f6', value: hover.values.p25 },
        { label: 'P75', color: '#3b82f6', value: hover.values.p75 },
      ].filter((r) => r.value !== undefined);
    }
    return [
      { label: '基线', color: '#999', value: hover.values.baseline },
      { label: '预期', color: '#3b82f6', value: hover.values.expected },
      { label: '保守', color: '#f59e0b', value: hover.values.conservative },
      { label: '乐观', color: '#22c55e', value: hover.values.optimistic },
    ].filter((r) => r.value !== undefined);
  }, [hover, hasBands]);

  return (
    <div className="sim-chart-wrapper">
      <svg
        ref={svgRef}
        className="sim-chart-svg"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        {/* Horizontal grid lines */}
        {Y_TICKS.map((v) => (
          <line
            key={`grid-${v}`}
            x1={PAD.left}
            y1={mapY(v)}
            x2={WIDTH - PAD.right}
            y2={mapY(v)}
            className="sim-chart-grid-line"
          />
        ))}

        {/* Y axis */}
        <line
          x1={PAD.left}
          y1={PAD.top}
          x2={PAD.left}
          y2={HEIGHT - PAD.bottom}
          className="sim-chart-axis-line"
        />
        {/* X axis */}
        <line
          x1={PAD.left}
          y1={HEIGHT - PAD.bottom}
          x2={WIDTH - PAD.right}
          y2={HEIGHT - PAD.bottom}
          className="sim-chart-axis-line"
        />

        {/* Y-axis labels */}
        {Y_TICKS.map((v) => (
          <text
            key={`ylabel-${v}`}
            x={PAD.left - 6}
            y={mapY(v) + 3}
            className="sim-chart-axis-label"
            textAnchor="end"
          >
            {v}
          </text>
        ))}

        {/* X-axis tick marks and labels */}
        {xTicks.map((m) => (
          <g key={`xtick-${m}`}>
            <line
              x1={mapX(m)}
              y1={HEIGHT - PAD.bottom}
              x2={mapX(m)}
              y2={HEIGHT - PAD.bottom + 4}
              className="sim-chart-axis-line"
            />
            <text
              x={mapX(m)}
              y={HEIGHT - PAD.bottom + 16}
              className="sim-chart-axis-label"
              textAnchor="middle"
            >
              {formatStageTickLabel(m, maxStageIndex, stageLabels)}
            </text>
          </g>
        ))}

        {/* Confidence bands (Monte Carlo) */}
        {hasBands && band90Poly && (
          <polygon points={band90Poly} className="sim-chart-ci-band-90" />
        )}
        {hasBands && band50Poly && (
          <polygon points={band50Poly} className="sim-chart-ci-band-50" />
        )}

        {/* Legacy range fill (fallback) */}
        {!hasBands && rangePoly && (
          <polygon points={rangePoly} className="sim-chart-range-fill" />
        )}

        {/* Improvement fill between baseline and expected */}
        {improvementPoly && (
          <polygon points={improvementPoly} className="sim-chart-improvement-fill" />
        )}

        {/* Data lines */}
        <polyline points={polyline(series.baseline)} className="sim-chart-line baseline" />
        {hasBands ? (
          // Monte Carlo mode: only show median line
          <polyline points={polyline(series.expected)} className="sim-chart-line expected" />
        ) : (
          // Legacy mode: show all 4 lines
          <>
            <polyline points={polyline(series.expected)} className="sim-chart-line expected" />
            <polyline points={polyline(series.conservative)} className="sim-chart-line conservative" />
            <polyline points={polyline(series.optimistic)} className="sim-chart-line optimistic" />
          </>
        )}

        {/* ML prediction marker */}
        {typeof mlPredEndShi === 'number' && maxStageIndex > 0 && (
          <circle
            cx={mapX(maxStageIndex)}
            cy={mapY(mlPredEndShi)}
            r={4}
            className="sim-chart-ml-marker"
          />
        )}

        {/* Endpoint labels: baseline start + expected end */}
        {endpoints.baselineStart && (
          <g className="sim-chart-endpoint-label">
            <circle cx={mapX(endpoints.baselineStart.stageIndex)} cy={mapY(endpoints.baselineStart.shi)} r={3} fill="#999" />
            <text
              x={mapX(endpoints.baselineStart.stageIndex) + 6}
              y={mapY(endpoints.baselineStart.shi) - 6}
              fill="#666"
            >
              {endpoints.baselineStart.shi.toFixed(1)}
            </text>
          </g>
        )}
        {endpoints.expectedEnd && (
          <g className="sim-chart-endpoint-label">
            <circle cx={mapX(endpoints.expectedEnd.stageIndex)} cy={mapY(endpoints.expectedEnd.shi)} r={3} fill="#3b82f6" />
            <text
              x={mapX(endpoints.expectedEnd.stageIndex) - 6}
              y={mapY(endpoints.expectedEnd.shi) - 6}
              fill="#3b82f6"
              textAnchor="end"
            >
              {endpoints.expectedEnd.shi.toFixed(1)}
            </text>
          </g>
        )}

        {/* Hover vertical line */}
        {hover && (
          <line
            x1={hover.svgX}
            y1={PAD.top}
            x2={hover.svgX}
            y2={HEIGHT - PAD.bottom}
            className="sim-chart-hover-line"
          />
        )}
      </svg>

      {/* Legend row below the SVG */}
      <div className="sim-chart-legend">
        {legendItems.map((item) => (
          <div key={item.label} className="sim-chart-legend-item">
            {'band' in item && item.band ? (
              <span
                className="sim-chart-legend-swatch"
                style={{ backgroundColor: item.color, opacity: item.opacity }}
              />
            ) : (
              <span
                className="sim-chart-legend-line"
                style={{
                  backgroundColor: item.color,
                  ...(item.dash ? { backgroundImage: `repeating-linear-gradient(90deg, ${item.color} 0 4px, transparent 4px 7px)`, backgroundColor: 'transparent' } : {}),
                }}
              />
            )}
            <span>{item.label}</span>
          </div>
        ))}
        {typeof mlPredEndShi === 'number' && (
          <div className="sim-chart-legend-item">
            <span className="sim-chart-legend-dot" style={{ backgroundColor: '#16a34a' }} />
            <span>空间参考</span>
          </div>
        )}
      </div>

      {/* Tooltip */}
      {hover && tooltipStyle && (
        <div className="sim-chart-tooltip" style={tooltipStyle}>
          <div className="sim-chart-tooltip-row" style={{ fontWeight: 700 }}>
            {formatTooltipStage(hover.stageIndex, stageLabels)}
          </div>
          {tooltipRows.map((r) => (
            <div key={r.label} className="sim-chart-tooltip-row">
              <span className="sim-chart-tooltip-dot" style={{ backgroundColor: r.color }} />
              <span>{r.label}: {r.value!.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

SimChart.displayName = 'SimChart';

export default SimChart;
