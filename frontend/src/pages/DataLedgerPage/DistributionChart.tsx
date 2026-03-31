import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';

interface CountyStat {
  type?: string;
  pixel_count: number;
  healthy_pct: number;
  sub_healthy_pct: number;
  unhealthy_pct: number;
}

interface DistributionChartProps {
  stats: CountyStat[];
}

const DistributionChart: React.FC<DistributionChartProps> = ({ stats }) => {
  const summaryScopeStats = useMemo(() => {
    const counties = stats.filter((item) => item.type === 'county');
    return counties.length > 0 ? counties : stats;
  }, [stats]);

  const distributionData = useMemo(() => {
    if (summaryScopeStats.length === 0) return null;
    const totalPixels = summaryScopeStats.reduce((sum, s) => sum + s.pixel_count, 0);
    const healthyPct = (summaryScopeStats.reduce((sum, s) => sum + s.healthy_pct * s.pixel_count, 0) / totalPixels);
    const subHealthyPct = (summaryScopeStats.reduce((sum, s) => sum + s.sub_healthy_pct * s.pixel_count, 0) / totalPixels);
    const unhealthyPct = (summaryScopeStats.reduce((sum, s) => sum + s.unhealthy_pct * s.pixel_count, 0) / totalPixels);
    return [
      { name: '健康', value: parseFloat(healthyPct.toFixed(1)), color: '#5d7b32' },
      { name: '亚健康', value: parseFloat(subHealthyPct.toFixed(1)), color: '#d2b48c' },
      { name: '不健康', value: parseFloat(unhealthyPct.toFixed(1)), color: '#8c4a32' },
    ];
  }, [summaryScopeStats]);

  const option = useMemo(() => {
    if (!distributionData) return {};
    return {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c}%',
      },
      legend: {
        orient: 'vertical',
        right: 10,
        top: 'center',
        textStyle: {
          fontSize: 13,
          color: '#3e3a36',
        },
      },
      series: [
        {
          name: 'SHI 分布',
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['40%', '50%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 8,
            borderColor: '#fff',
            borderWidth: 2,
          },
          label: {
            show: false,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 16,
              fontWeight: 'bold',
            },
          },
          labelLine: {
            show: false,
          },
          data: distributionData.map((item) => ({
            name: item.name,
            value: item.value,
            itemStyle: { color: item.color },
          })),
        },
      ],
    };
  }, [distributionData]);

  if (!distributionData) {
    return <div style={{ padding: '20px', textAlign: 'center', color: '#8c8278' }}>暂无数据</div>;
  }

  return <ReactECharts option={option} style={{ height: '280px' }} />;
};

export default DistributionChart;
