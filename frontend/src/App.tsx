import { useEffect, useState } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Activity, AlertTriangle, CheckCircle, RefreshCw, Cpu, Search, X } from 'lucide-react';

interface TelemetryLog {
  id: number;
  service_name: string;
  level: string;
  latency_ms: number;
  message: string;
  timestamp: string;
  ai_analysis?: string;
}

type TimeRange = '5m' | '15m' | '1h';
type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

// Set VITE_API_URL in a .env file (or your hosting platform's env vars) to
// point at your deployed backend. Falls back to localhost for local dev.
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1h' },
];

const LEVEL_OPTIONS: LogLevel[] = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'];

// Styling per level, reused for both the filter chips and the log rows so
// the two stay visually consistent.
const LEVEL_STYLES: Record<LogLevel, string> = {
  ERROR: 'bg-rose-950/80 text-rose-300 border-rose-800',
  WARNING: 'bg-amber-950/80 text-amber-300 border-amber-800',
  CRITICAL: 'bg-rose-950/80 text-rose-300 border-rose-800',
  INFO: 'bg-emerald-950/80 text-emerald-300 border-emerald-800',
};

// Higher row caps for wider windows so a busy 1h view isn't truncated to
// the same 30 rows as a 5m view.
const LIMIT_BY_RANGE: Record<TimeRange, number> = {
  '5m': 150,
  '15m': 400,
  '1h': 1000,
};

// How long to wait after the user stops typing before firing a search
// request, so every keystroke doesn't trigger its own API call.
const SEARCH_DEBOUNCE_MS = 400;

export default function App() {
  const [logs, setLogs] = useState<TelemetryLog[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRange>('5m');
  // Empty set = no level filter applied (show all levels).
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(new Set());
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce the free-text search box.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const toggleLevel = (level: LogLevel) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  };

  const fetchLogs = async (range: TimeRange, levels: Set<LogLevel>, search: string) => {
    try {
      const params: Record<string, unknown> = { range, limit: LIMIT_BY_RANGE[range] };
      if (levels.size > 0) {
        params.level = Array.from(levels);
      }
      if (search) {
        params.search = search;
      }
      const res = await axios.get<TelemetryLog[]>(`${API_BASE_URL}/api/v1/logs`, {
        params,
        paramsSerializer: { indexes: null }, // level=A&level=B instead of level[0]=A
      });
      setLogs(res.data.reverse());
    } catch (err) {
      console.error('Failed to fetch telemetry logs:', err);
    }
  };

  useEffect(() => {
    fetchLogs(timeRange, activeLevels, debouncedSearch);
    const interval = setInterval(() => fetchLogs(timeRange, activeLevels, debouncedSearch), 2000);
    return () => clearInterval(interval);
    // activeLevels is a Set, so we key the effect off its serialized contents
    // to avoid re-running on every render due to reference inequality.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, Array.from(activeLevels).sort().join(','), debouncedSearch]);

  const totalLogs = logs.length;
  const errorCount = logs.filter((l) => l.level === 'ERROR').length;
  const avgLatency = totalLogs > 0
    ? Math.round(logs.reduce((acc, curr) => acc + curr.latency_ms, 0) / totalLogs)
    : 0;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <header className="flex justify-between items-center border-b border-slate-800 pb-5">
        <div className="flex items-center space-x-3">
          <Cpu className="w-8 h-8 text-indigo-400" />
          <h1 className="text-2xl font-bold tracking-tight">System Observability Engine</h1>
        </div>
        <div className="flex items-center space-x-5">
          <div className="flex items-center bg-slate-800/60 border border-slate-700 rounded-lg p-1">
            {TIME_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTimeRange(opt.value)}
                className={`px-3 py-1 text-sm font-medium rounded-md transition ${
                  timeRange === opt.value
                    ? 'bg-indigo-500 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center space-x-2 text-sm text-slate-400">
            <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
            <span>Streaming Live Telemetry</span>
          </div>
        </div>
      </header>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-800/60 border border-slate-700 p-5 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm font-medium">Avg Latency</p>
            <p className="text-3xl font-bold mt-1">{avgLatency} <span className="text-lg text-slate-400 font-normal">ms</span></p>
          </div>
          <Activity className="w-10 h-10 text-emerald-400 bg-emerald-950/40 p-2 rounded-lg" />
        </div>

        <div className="bg-slate-800/60 border border-slate-700 p-5 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm font-medium">Logged Events</p>
            <p className="text-3xl font-bold mt-1">{totalLogs}</p>
          </div>
          <CheckCircle className="w-10 h-10 text-indigo-400 bg-indigo-950/40 p-2 rounded-lg" />
        </div>

        <div className="bg-slate-800/60 border border-slate-700 p-5 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-slate-400 text-sm font-medium">Errors (Recent)</p>
            <p className="text-3xl font-bold mt-1 text-rose-400">{errorCount}</p>
          </div>
          <AlertTriangle className="w-10 h-10 text-rose-400 bg-rose-950/40 p-2 rounded-lg" />
        </div>
      </div>

      {/* Latency Chart */}
      <div className="bg-slate-800/60 border border-slate-700 p-6 rounded-xl">
        <h2 className="text-lg font-semibold mb-4 text-slate-200">Real-Time Latency (ms)</h2>
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={logs}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="id" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569' }} />
              <Line type="monotone" dataKey="latency_ms" stroke="#818cf8" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Live Log Stream */}
      <div className="bg-slate-800/60 border border-slate-700 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-700 bg-slate-800/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-200">Live Ingested Telemetry Logs</h2>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Level filter chips */}
            <div className="flex items-center gap-2">
              {LEVEL_OPTIONS.map((level) => {
                const isActive = activeLevels.has(level);
                return (
                  <button
                    key={level}
                    onClick={() => toggleLevel(level)}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                      isActive
                        ? LEVEL_STYLES[level]
                        : 'bg-transparent text-slate-500 border-slate-700 hover:text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    {level}
                  </button>
                );
              })}
            </div>
            {/* Text search */}
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search service or message..."
                className="pl-8 pr-8 py-1.5 text-sm bg-slate-900/60 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 w-56"
              />
              {searchInput && (
                <button
                  onClick={() => setSearchInput('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="divide-y divide-slate-700/50 max-h-96 overflow-y-auto">
          {logs.length === 0 && (
            <div className="p-8 text-center text-sm text-slate-500">
              No logs match the current filters.
            </div>
          )}
          {logs.slice().reverse().map((log) => (
            <div key={log.id} className="p-4 flex flex-col space-y-2 hover:bg-slate-800/40 transition">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center space-x-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold border ${LEVEL_STYLES[log.level as LogLevel] ?? LEVEL_STYLES.INFO}`}>
                    {log.level}
                  </span>
                  <span className="font-mono text-indigo-300">{log.service_name}</span>
                  <span className="text-slate-300">{log.message}</span>
                </div>
                <span className="text-xs text-slate-400">{new Date(log.timestamp).toLocaleTimeString()}</span>
              </div>
              {log.ai_analysis && (
                <div className="ml-6 p-2 rounded bg-indigo-950/30 border border-indigo-900/50 text-xs text-indigo-200">
                  <strong className="text-indigo-400">AI Diagnosis: </strong>{log.ai_analysis}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
