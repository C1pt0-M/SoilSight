import React, { useMemo, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { useNavigate } from 'react-router-dom';
import { useMapStore } from '../../store/mapStore';

interface CountyStat {
  name: string;
  type: string;
  centroid: [number, number];
  pixel_count: number;
  shi_mean: number;
  healthy_pct: number;
  sub_healthy_pct: number;
  unhealthy_pct: number;
}

interface PrefectureChartProps {
  stats: CountyStat[];
}

interface ChartClickParams {
  dataIndex?: number;
}

interface TooltipParam {
  axisValue: string;
  marker: string;
  seriesName: string;
  value: number;
}

const PrefectureChart: React.FC<PrefectureChartProps> = ({ stats }) => {
  const navigate = useNavigate();

  const prefectureData = useMemo(() => {
    const prefectures = stats.filter((s) => s.type === 'prefecture');
    return prefectures
      .sort((a, b) => b.shi_mean - a.shi_mean)
      .map((p) => ({
        name: p.name,
        healthy: p.healthy_pct,
        subHealthy: p.sub_healthy_pct,
        unhealthy: p.unhealthy_pct,
        centroid: p.centroid,
      }));
  }, [stats]);

  const handleBarClick = useCallback((params: ChartClickParams) => {
    if (typeof params.dataIndex !== 'number') return;
    const prefecture = prefectureData[params.dataIndex];
    if (prefecture) {
      const [lon, lat] = prefecture.centroid;
      useMapStore.getState().flyTo(lon, lat, 8);
      navigate('/');
    }
  }, [prefectureData, navigate]);

  const option = useMemo(() => {
    if (prefectureData.length === 0) return {};
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow',
        },
        formatter: (params: TooltipParam[]) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          let result = `<strong>${params[0].axisValue}</strong><br/>`;
          params.forEach((item) => {
            result += `${item.marker} ${item.seriesName}: ${item.value}%<br/>`;
          });
          return result;
        },
      },
      legend: {
        data: ['健康', '亚健康', '不健康'],
        top: 0,
        textStyle: {
          fontSize: 12,
          color: '#3e3a36',
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: '40px',
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        max: 100,
        axisLabel: {
          formatter: '{value}%',
          fontSize: 11,
        },
      },
      yAxis: {
        type: 'category',
        data: prefectureData.map((p) => p.name),
        axisLabel: {
          fontSize: 12,
          color: '#3e3a36',
        },
      },
      series: [
        {
          name: '健康',
          type: 'bar',
          stack: 'total',
          itemStyle: { color: '#5d7b32' },
          data: prefectureData.map((p) => p.healthy),
        },
        {
          name: '亚健康',
          type: 'bar',
          stack: 'total',
          itemStyle: { color: '#d2b48c' },
          data: prefectureData.map((p) => p.subHealthy),
        },
        {
          name: '不健康',
          type: 'bar',
          stack: 'total',
          itemStyle: { color: '#8c4a32' },
          data: prefectureData.map((p) => p.unhealthy),
        },
      ],
    };
  }, [prefectureData]);

  if (prefectureData.length === 0) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#8c8278' }}>暂无地州数据</div>;
  }

  return (
    <ReactECharts
      option={option}
      style={{ height: '280px' }}
      onEvents={{ click: handleBarClick }}
    />
  );
};

export default PrefectureChart;
