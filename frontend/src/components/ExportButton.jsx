import React, { useState } from 'react';

const API_BASE = '';

export default function ExportButton({ groupId = 'all' }) {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const handleExport = async (format) => {
    try {
      setDownloading(true);
      setError('');
      const url = `${API_BASE}/api/export?format=${format}${groupId === 'all' ? '' : `&group_id=${groupId}`}`;
      const response = await fetch(url);
      if (!response.ok) {
        const result = await response.json();
        if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
        throw new Error(result.error || 'Ошибка экспорта');
      }
      const downloadUrl = URL.createObjectURL(await response.blob());
      
      // Trigger browser download
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `techmonitor_export.${format === 'sql' ? 'sql' : 'csv'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="export-section">
      {error && <span role="alert" className="export-error">{error}</span>}
      <button
        className="export-btn"
        onClick={() => handleExport('csv')}
        disabled={downloading}
        id="export-csv"
      >
        Экспорт CSV
      </button>
      <button
        className="export-btn secondary"
        onClick={() => handleExport('sql')}
        disabled={downloading}
        id="export-sql"
      >
        Экспорт БД
      </button>
    </div>
  );
}
