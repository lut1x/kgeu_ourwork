import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const API_BASE = '';

const PAGE_SIZE = 20;
const POLL_INTERVAL = 2000; // Poll every 2 seconds as fallback

export default function Logs({ latestReading }) {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [newIds, setNewIds] = useState(new Set());
  const lastFetchedIdRef = useRef(null);
  const pollTimerRef = useRef(null);

  const fetchLogs = useCallback(async (pageNum, highlight = false) => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE}/api/readings`, {
        params: {
          limit: PAGE_SIZE,
          offset: pageNum * PAGE_SIZE,
        }
      });
      const data = res.data.data || [];
      
      // Highlight new rows on first page
      if (highlight && pageNum === 0 && data.length > 0 && lastFetchedIdRef.current) {
        const ids = new Set();
        for (const row of data) {
          if (row.id > lastFetchedIdRef.current) {
            ids.add(row.id);
          }
        }
        if (ids.size > 0) {
          setNewIds(ids);
          setTimeout(() => setNewIds(new Set()), 600);
        }
      }

      if (data.length > 0) {
        lastFetchedIdRef.current = Math.max(...data.map(r => r.id));
      }

      setLogs(data);
      setTotal(res.data.total);
    } catch (err) {
      console.error('Error fetching logs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load & page changes
  useEffect(() => {
    fetchLogs(page);
  }, [page, fetchLogs]);

  // Polling: always poll on first page for live updates
  useEffect(() => {
    if (page !== 0) return;

    pollTimerRef.current = setInterval(() => {
      fetchLogs(0, true);
    }, POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [page, fetchLogs]);

  // Also refresh immediately when WebSocket delivers new reading
  useEffect(() => {
    if (page === 0 && latestReading) {
      fetchLogs(0, true);
    }
  }, [latestReading, page, fetchLogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const formatTime = (ts) => {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="glass-card" id="logs-panel">
      <div className="glass-card__header">
        <span className="glass-card__title">
          Журнал записей
          <span style={{ 
            marginLeft: '12px', 
            fontSize: '0.8rem', 
            color: 'var(--text-muted)', 
            fontWeight: 400 
          }}>
            Всего: {total.toLocaleString('ru-RU')}
          </span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {page === 0 && (
            <span style={{ 
              fontSize: '0.75rem', 
              color: 'var(--color-ok)', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '4px' 
            }}>
              <span className="connection-dot" />
              Live
            </span>
          )}
        </div>
      </div>
      <div className="glass-card__body" style={{ padding: 0 }}>
        {loading && logs.length === 0 ? (
          <div className="loading-state">
            <div className="loading-spinner" />
            <span>Загрузка данных...</span>
          </div>
        ) : (
          <>
            <div className="logs-table-wrapper">
              <table className="logs-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Время</th>
                    <th>Датчик (°C)</th>
                    <th>Fan Speed (RPM)</th>
                    <th>Voltage (V)</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(row => (
                    <tr key={row.id} className={newIds.has(row.id) ? 'new-row' : ''}>
                      <td className="cell-id">#{row.id}</td>
                      <td className="cell-time">{formatTime(row.created_at)}</td>
                      <td className="cell-temp">{row.cpu_temp}°C</td>
                      <td className="cell-fan">{Math.round(row.fan_speed)} RPM</td>
                      <td className="cell-voltage">{row.voltage} V</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="pagination">
              <button
                className="pagination-btn"
                disabled={page === 0}
                onClick={() => setPage(0)}
                id="page-first"
              >
                ⟪ Первая
              </button>
              <button
                className="pagination-btn"
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                id="page-prev"
              >
                ← Назад
              </button>
              <span className="pagination-info">
                {page + 1} / {totalPages || 1}
              </span>
              <button
                className="pagination-btn"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                id="page-next"
              >
                Вперёд →
              </button>
              <button
                className="pagination-btn"
                disabled={page >= totalPages - 1}
                onClick={() => setPage(totalPages - 1)}
                id="page-last"
              >
                Последняя ⟫
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
