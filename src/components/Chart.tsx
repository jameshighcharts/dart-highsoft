"use client";
import Highcharts from 'highcharts';
import HighchartsReact, { type HighchartsReactProps } from 'highcharts-react-official';
import { useMemo } from 'react';

const darkChartOptions: Highcharts.Options = {
  chart: {
    backgroundColor: 'transparent',
    style: {
      color: '#f8fafc',
      fontFamily: 'inherit',
    },
  },
  title: {
    style: { color: '#f8fafc' },
  },
  subtitle: {
    style: { color: '#94a3b8' },
  },
  xAxis: {
    gridLineColor: '#1e293b',
    lineColor: '#334155',
    tickColor: '#334155',
    labels: {
      style: { color: '#cbd5e1' },
    },
    title: {
      style: { color: '#94a3b8' },
    },
  },
  yAxis: {
    gridLineColor: '#1e293b',
    lineColor: '#334155',
    tickColor: '#334155',
    labels: {
      style: { color: '#cbd5e1' },
    },
    title: {
      style: { color: '#94a3b8' },
    },
  },
  legend: {
    itemStyle: { color: '#e2e8f0' },
    itemHoverStyle: { color: '#ffffff' },
    itemHiddenStyle: { color: '#64748b' },
  },
  tooltip: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    style: { color: '#f8fafc' },
  },
  plotOptions: {
    series: {
      dataLabels: {
        style: {
          color: '#f8fafc',
          textOutline: 'none',
        },
      },
    },
  },
  credits: {
    style: { color: '#64748b' },
  },
};

type ChartProps = Omit<HighchartsReactProps, 'highcharts' | 'options'> & {
  options: object;
};

export default function Chart({ options, ...props }: ChartProps) {
  const themedOptions = useMemo(
    () => Highcharts.merge(darkChartOptions, options),
    [options]
  );

  return (
    <HighchartsReact
      {...props}
      highcharts={Highcharts}
      options={themedOptions}
    />
  );
}
