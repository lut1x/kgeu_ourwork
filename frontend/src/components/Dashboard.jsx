import React, { useMemo } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';

function getStatus(param, value, settings) {
  if (param === 'cpu_temp') {
    if (value >= settings.temp_critical) return { status: 'danger', label: 'Критическая' };
    if (value >= settings.temp_warning) return { status: 'warn', label: 'Повышенная' };
    return { status: 'ok', label: 'Норма' };
  }
  if (param === 'fan_speed') {
    if (value >= 4200) return { status: 'warn', label: 'Высокая' };
    if (value <= 1200) return { status: 'danger', label: 'Низкая' };
    return { status: 'ok', label: 'Норма' };
  }
  if (param === 'voltage') {
    if (value >= 5.2 || value <= 3.2) return { status: 'danger', label: 'Критическое' };
    if (value >= 4.8 || value <= 3.5) return { status: 'warn', label: 'Отклонение' };
    return { status: 'ok', label: 'Норма' };
  }
  return { status: 'ok', label: 'N/A' };
}

const METRICS = [
  { key: 'cpu_temp', label: 'Температура', unit: '°C', tag: 'TT-101', cls: 'temp', color: '#b7791f' },
  { key: 'fan_speed', label: 'Скорость вентилятора', unit: 'RPM', tag: 'ST-102', cls: 'fan', color: '#276b89' },
  { key: 'voltage', label: 'Напряжение', unit: 'V', tag: 'VT-103', cls: 'voltage', color: '#35765c' },
];

export default function Dashboard({ latestReading, readingsBuffer, settings }) {
  // Sparkline data: last 30 readings, reversed for left-to-right chronology
  const sparkData = useMemo(() => {
    return readingsBuffer.slice(0, 30).reverse();
  }, [readingsBuffer]);

  return (
    <div>
      <div className="dashboard-grid">
        {METRICS.map(metric => {
          const value = latestReading ? latestReading[metric.key] : null;
          const { status, label } = value !== null ? getStatus(metric.key, value, settings) : { status: 'ok', label: '—' };

          return (
            <div key={metric.key} className={`metric-card ${metric.cls}`} id={`card-${metric.key}`}>
              <div className="metric-card__header">
                <span className="metric-card__label">{metric.label}</span>
                <div className="metric-card__icon">{metric.tag}</div>
              </div>
              <div className={`metric-card__value ${latestReading ? 'value-updated' : ''}`}>
                {value !== null ? (
                  <>
                    {metric.key === 'fan_speed' ? Math.round(value) : value}
                    <span className="metric-card__unit"> {metric.unit}</span>
                  </>
                ) : (
                  <span style={{ color: 'var(--text-muted)', fontSize: '1.5rem' }}>—</span>
                )}
              </div>
              <div className="metric-card__status">
                <span className={`status-dot ${status}`} />
                <span style={{ color: `var(--color-${status})` }}>{label}</span>
              </div>
              
              {/* Mini sparkline */}
              {sparkData.length > 2 && (
                <div className="metric-card__sparkline">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={sparkData}>
                      <YAxis hide domain={['auto', 'auto']} />
                      <Line
                        type="monotone"
                        dataKey={metric.key}
                        stroke={metric.color}
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
