import { useEffect, useRef } from 'react';
import {
  CategoryScale,
  Chart,
  Filler,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from 'chart.js';

Chart.register(CategoryScale, LineController, LineElement, LinearScale, PointElement, Tooltip, Filler);

type Point = { periodKey: string; indices: Record<string, string> };

const palette: Record<string, string> = {
  food: '#ef4444', housing: '#0284c7', car: '#8b5cf6', gold: '#f59e0b',
  currency: '#10b981', equipment: '#3b82f6', materials: '#f97316',
};
const months = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
const labelPeriod = (key: string) => {
  const [year, month] = key.split('-').map(Number);
  return `${months[month - 1]} ${new Intl.NumberFormat('fa-IR').format(year)}`;
};

const priceLabel = (value: number) => `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(Math.round(value))} تومان`;
const compactPrice = (value: number) => value >= 1_000_000
  ? `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 1 }).format(value / 1_000_000)}م`
  : `${new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value / 1_000)}ه`;

export function MarketChart({ points, category, basePriceTomans, unit }: { points: Point[]; category: string; basePriceTomans: string; unit: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    chartRef.current?.destroy();
    if (!points.length) return;
    const values = points.map((point) => {
      const index = Number(point.indices[category]);
      return Number.isFinite(index) ? Math.round(Number(basePriceTomans) * index / 1_000_000) : 0;
    });
    chartRef.current = new Chart(canvas, {
      type: 'line',
      data: {
        labels: points.map((point) => labelPeriod(point.periodKey)),
        datasets: [{
          label: `قیمت هر ${unit}`, data: values, borderColor: palette[category] || '#0284c7',
          backgroundColor: `${palette[category] || '#0284c7'}22`, fill: true,
          pointRadius: 3, pointHoverRadius: 5, borderWidth: 3, tension: 0.15,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { rtl: true, callbacks: { label: (item) => priceLabel(Number(item.raw)) } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#64748b', maxTicksLimit: 5, maxRotation: 0, font: { family: 'Vazirmatn, Tahoma, sans-serif', size: 10 } } },
          y: { grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', callback: (value) => compactPrice(Number(value)), font: { family: 'Vazirmatn, Tahoma, sans-serif', size: 10 } } },
        },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [points, category, basePriceTomans, unit]);

  if (!points.length) return <div className="market-chart-empty">با پایان اولین دوره، روند قیمت این دارایی نمایش داده می‌شود.</div>;
  return <div className="market-chart"><canvas ref={canvasRef} role="img" aria-label={`نمودار قیمت شبیه‌سازی‌شدهٔ هر ${unit} به تومان`} /></div>;
}
