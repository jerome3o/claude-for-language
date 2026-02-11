import { useState } from 'react';
import { API_BASE, getAuthHeaders } from '../api/client';
import './SettingsPage.css';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SettingsPage() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastExport = localStorage.getItem('lastExportDate');
  const lastExportSize = localStorage.getItem('lastExportSize');

  const handleExport = async () => {
    setIsExporting(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/api/export`, {
        credentials: 'include',
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Export failed (${response.status})`);
      }

      const blob = await response.blob();

      // Store export metadata
      localStorage.setItem('lastExportDate', new Date().toISOString());
      localStorage.setItem('lastExportSize', String(blob.size));

      // Trigger download
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const today = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `chinese-learning-backup-${today}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="page">
      <div className="container settings-page">
        <h1>Settings</h1>

        <div className="settings-section">
          <h2>Export Data</h2>
          <p className="settings-section-desc">
            Download a backup of all your data as a JSON file. Includes decks,
            notes, cards, and review history.
          </p>

          <button
            className="btn btn-primary export-btn"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'Preparing backup...' : 'Download Backup'}
          </button>

          {error && <div className="export-error">{error}</div>}

          <div className="export-meta">
            {lastExport && (
              <div className="export-meta-item">
                Last export: {new Date(lastExport).toLocaleDateString()}
              </div>
            )}
            {lastExportSize && (
              <div className="export-meta-item">
                Last file size: {formatBytes(parseInt(lastExportSize, 10))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
