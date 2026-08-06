import { useRef, useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle } from 'lucide-react';
import { API_BASE } from '../../../config/api';

interface ErpCsvUploadPanelProps {
  venueId: string;
  hasData: boolean;
  lastUpload: string | null;
  onUploaded: () => void;
  compact?: boolean;
}

export default function ErpCsvUploadPanel({
  venueId,
  hasData,
  lastUpload,
  onUploaded,
  compact = false,
}: ErpCsvUploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    setMessage(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('venueId', venueId);
      const res = await fetch(`${API_BASE}/api/reporting/erp-upload`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.message || 'Upload failed');
      setMessage(`Imported ${data.upserted} rows from ${data.fileName}`);
      onUploaded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`rounded-lg border ${hasData ? 'border-green-500/30 bg-green-500/5' : 'border-amber-500/30 bg-amber-500/5'} ${compact ? 'p-2' : 'p-3'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <FileSpreadsheet className={`w-3.5 h-3.5 ${hasData ? 'text-green-400' : 'text-amber-400'}`} />
            <span className="text-xs font-medium text-white">ERP / POS data</span>
            {hasData && <CheckCircle className="w-3 h-3 text-green-400" />}
          </div>
          {!compact && (
            <p className="text-xs text-gray-400 mt-1">
              Upload CSV or Excel with columns: date, category (optional), revenue, transactions, avg_ticket.
              Powers SPI, aisle conversion, and shopping efficiency.
            </p>
          )}
          {lastUpload && (
            <p className="text-xs text-gray-400 mt-0.5">
              Last upload: {new Date(lastUpload).toLocaleString()}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 px-2 py-1 rounded-md bg-gray-700 hover:bg-gray-600 text-xs text-white disabled:opacity-50 shrink-0"
        >
          <Upload className="w-3 h-3" />
          {uploading ? 'Uploading…' : 'Upload CSV'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>
      {message && <p className="text-xs text-green-400 mt-1.5">{message}</p>}
      {error && (
        <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  );
}
