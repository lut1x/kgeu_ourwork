import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Area, AreaChart
} from 'recharts';

const TIME_OPTIONS = [
  { label: '1 мин', value: 60 },
  { label: '5 мин', value: 300 },
  { label: '15 мин', value: 900 },
];

const CHARTS = [
  { key: 'cpu_temp', label: 'TT-101 / Температура', unit: '°C', color: '#a57528' },
  { key: 'fan_speed', label: 'ST-102 / Скорость вентилятора', unit: 'RPM', color: '#276b89' },
  { key: 'voltage', label: 'VT-103 / Напряжение питания', unit: 'V', color: '#35765c' },
];

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="custom-tooltip">
      <div className="custom-tooltip__time">{label}</div>
      {payload.map((entry, i) => (
        <div key={i} className="custom-tooltip__item">
          <div className="custom-tooltip__dot" style={{ background: entry.color }} />
          <span style={{ color: entry.color, fontWeight: 600 }}>{entry.value}</span>
          <span style={{ color: 'var(--text-muted)' }}>{entry.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function Graphs({ readingsBuffer }) {
  const [timeRange, setTimeRange] = useState(60);

  const chartData = useMemo(() => {
    const sliceCount = Math.min(timeRange, readingsBuffer.length);
    return readingsBuffer.slice(0, sliceCount).reverse().map((r, i) => ({
      ...r,
      time: r.created_at
        ? new Date(r.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        : `${i}s`
    }));
  }, [readingsBuffer, timeRange]);

  return (
    <div className="graphs-container">
      {/* Time range selector */}
      <div className="glass-card">
        <div className="glass-card__header">
          <span className="glass-card__title">Временной диапазон</span>
          <div className="time-controls">
            {TIME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                id={`time-btn-${opt.value}`}
                className={`time-btn ${timeRange === opt.value ? 'active' : ''}`}
                onClick={() => setTimeRange(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Charts */}
      {CHARTS.map(chart => (
        <div key={chart.key} className="glass-card" id={`chart-${chart.key}`}>
          <div className="glass-card__header">
            <span className="glass-card__title">{chart.label}</span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {chartData.length} точек
            </span>
          </div>
          <div className="glass-card__body">
            {chartData.length < 2 ? (
              <div className="loading-state">
                <div className="loading-spinner" />
                <span>Ожидание данных...</span>
              </div>
            ) : (
              <div className="chart-wrapper">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id={`grad-${chart.key}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={chart.color} stopOpacity={0.25} />
                        <stop offset="95%" stopColor={chart.color} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 11 }}
                      interval="preserveStartEnd"
                      tickCount={6}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      domain={['auto', 'auto']}
                      width={50}
                      tickFormatter={(v) => chart.key === 'fan_speed' ? Math.round(v) : v}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey={chart.key}
                      name={chart.unit}
                      stroke={chart.color}
                      strokeWidth={2.5}
                      fill={`url(#grad-${chart.key})`}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
