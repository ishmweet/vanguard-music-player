import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Home, Search, Play, Pause, SkipBack, SkipForward,
  ListMusic, Heart, DownloadCloud, Music, Volume2, VolumeX,
  MoreVertical, ListPlus, Share2, Download, ExternalLink, Copy,
  Info, X, Clock, Youtube, Disc, Hash, FileCode2, PlaySquare,
  PlusCircle, FileBadge2, Settings, RefreshCw, FolderDown,
  Shuffle, Repeat, Repeat1, ListOrdered, Trash2, Pencil,
  ChevronRight, ChevronLeft, ImagePlus, AlignLeft, HardDrive,
  FileMusic, AlertCircle, Gauge, Sliders, Moon, FolderOpen,
  PackageCheck, RotateCcw, Timer, Zap, BarChart2, FileOutput,
  CheckCircle, WifiOff, Database, Upload, ArchiveRestore,
  AlertTriangle, Terminal, ChevronDown, Sparkles, ArrowLeft,
  Loader2, Link2, CheckCircle2, XCircle
} from 'lucide-react';

// ─── TYPES ───────────────────────────────────────────────────────────────────
type Track = {
  id: number;
  title: string;
  artist: string;
  duration: string;
  url: string;
  cover: string;
};


// ─── SPOTIFY IMPORT ──────────────────────────────────────────────────────────


type LocalTrack = {
  title: string;
  path: string;
  size_bytes: number;
  extension: string;
  artist?: string;
  duration?: string;
};

type Playlist = {
  id: string;
  name: string;
  description: string;
  tracks: Track[];
  customCover?: string;
};

type RepeatMode = 'off' | 'all' | 'one';

type CtxMenu = {
  x: number; y: number;
  type: 'track' | 'playlist' | 'sidebar-playlist' | 'queue-track' | 'quickpick';
  track?: Track;
  playlist?: Playlist;
};

type DepsStatus = { mpv: boolean; yt_dlp: boolean; ffprobe: boolean };
type AudioInfo = { codec: string; bitrate: number; samplerate: number; channels: string; format: string; url: string };
type DiskInfo = { used_bytes: number; track_count: number };
type BatchProgress = { index: number; total: number; title: string; success: boolean; error?: string };
type InstallResult = { success: boolean; message: string };
type SettingsTab = 'dependencies' | 'downloads' | 'storage';
type NavPage = 'home' | 'downloads' | 'settings' | 'library' | 'stats';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function parseDurationToSeconds(d: string): number {
  const p = d.split(':').map(Number);
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return p[0] || 0;
}
function formatTime(s: number): string {
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}
function formatBytes(b: number): string {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function loadLS<T>(key: string, fb: T): T {
  try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fb; } catch { return fb; }
}
function saveLS(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
}
function clampMenu(x: number, y: number, w = 260, h = 420) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Flip to left if not enough room on right
  const cx = x + w > vw - 8 ? Math.max(8, x - w) : x;
  // Flip upward if not enough room below
  const cy = y + h > vh - 8 ? Math.max(8, y - h) : y;
  return { x: cx, y: cy };
}

// ─── SLEEP TIMER BUTTON (top-right, animated) ─────────────────────────────────
const SleepTimerButton = React.memo(({
  sleepTimer, onOpen,
}: { sleepTimer: number; onOpen: () => void }) => {
  const active = sleepTimer > 0;
  const mins = active ? Math.ceil(sleepTimer / 60) : 0;
  return (
    <button
      onClick={onOpen}
      title={active ? `Sleep in ${mins}m, click to change` : 'Set sleep timer'}
      className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-300
        ${active
          ? 'bg-amber-500/15 border border-amber-500/40 text-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.2)]'
          : 'text-neutral-600 hover:text-neutral-400 border border-transparent hover:border-neutral-800'}`}
    >
      <Moon size={13} className={active ? 'animate-pulse' : ''} />
      {active && <span className="tabular-nums">{mins}m</span>}
    </button>
  );
});

// ─── INFO HINT BUTTON ────────────────────────────────────────────────────────
const InfoHintButton = React.memo(({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    title="Before using, install dependencies from Settings → Dependencies"
    className="w-7 h-7 rounded-full border-2 border-amber-500/60 text-amber-400 hover:border-amber-400 hover:text-amber-300 hover:shadow-[0_0_10px_rgba(251,191,36,0.4)] transition-all duration-200 flex items-center justify-center text-xs font-black bg-amber-500/10"
  >
    !
  </button>
));

// ─── SLEEP TIMER POPOVER ─────────────────────────────────────────────────────
const SleepTimerPopover = React.memo(({
  sleepTimer, onSet, onCancel, onClose,
}: { sleepTimer: number; onSet: (m: number) => void; onCancel: () => void; onClose: () => void }) => {
  const [input, setInput] = useState('');
  const presets = [5, 10, 15, 20, 30, 45, 60, 90];
  return (
    <div className="w-64 bg-[#0e0e0e] border border-neutral-800 rounded-xl shadow-[0_8px_32px_rgba(0,0,0,0.9)] overflow-hidden"
      onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
        <span className="text-sm font-bold text-white flex items-center gap-2"><Moon size={14} className="text-amber-400" /> Sleep Timer</span>
        <button onClick={onClose} className="text-neutral-600 hover:text-white transition-colors"><X size={14} /></button>
      </div>
      {sleepTimer > 0 ? (
        <div className="px-4 py-4 flex flex-col gap-3">
          <div className="flex items-center justify-between py-2 px-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
            <span className="text-sm text-amber-400">Pausing in <strong>{Math.ceil(sleepTimer / 60)}m</strong></span>
            <button onClick={() => { onCancel(); onClose(); }} className="text-xs text-red-400 hover:text-red-300 transition-colors flex items-center gap-1">
              <X size={11} /> Cancel
            </button>
          </div>
          <p className="text-xs text-neutral-600">Set a new timer to override:</p>
        </div>
      ) : (
        <div className="px-4 pt-4 pb-1">
          <p className="text-xs text-neutral-600 mb-3">Auto-pause after:</p>
        </div>
      )}
      <div className="px-4 pb-2 grid grid-cols-4 gap-1.5">
        {presets.map(m => (
          <button key={m} onClick={() => { onSet(m); onClose(); }}
            className="py-1.5 rounded-lg text-xs font-semibold bg-neutral-900 border border-neutral-800 text-neutral-400 hover:border-amber-500/50 hover:text-amber-400 hover:bg-amber-500/10 transition-all">
            {m}m
          </button>
        ))}
      </div>
      <div className="px-4 pb-4 flex gap-2 mt-1">
        <input type="number" min="1" max="999" placeholder="Custom (min)"
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { const m = parseInt(input); if (m > 0) { onSet(m); onClose(); } } }}
          className="flex-1 bg-[#050505] border border-neutral-800 text-white rounded-lg py-1.5 px-2.5 focus:outline-none focus:border-amber-500/50 text-xs placeholder-neutral-700"
        />
        <button onClick={() => { const m = parseInt(input); if (m > 0) { onSet(m); onClose(); } }}
          className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-lg text-xs font-semibold hover:bg-amber-500/20 transition-colors">
          Set
        </button>
      </div>
    </div>
  );
});

// ─── DEPS BANNER ─────────────────────────────────────────────────────────────
const DepsBanner = React.memo(({ deps, onGoToSettings }: { deps: DepsStatus | null; onGoToSettings: () => void }) => {
  if (!deps) return null;
  const playbackMissing = [!deps.mpv && 'mpv', !deps.yt_dlp && 'yt-dlp'].filter(Boolean) as string[];
  if (playbackMissing.length === 0) return null;
  return (
    <div className="flex flex-col shrink-0 z-30">
      {playbackMissing.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-400 text-xs font-medium">
          <WifiOff size={13} className="shrink-0" />
          <span className="flex-1"><strong>{playbackMissing.join(', ')}</strong> not found, playback won't work.</span>
          <button onClick={onGoToSettings} className="shrink-0 px-2.5 py-1 bg-red-500/20 border border-red-500/30 rounded-lg hover:bg-red-500/30 transition-colors">Install →</button>
        </div>
      )}
      
    </div>
  );
});

// ─── TRACK ROW ───────────────────────────────────────────────────────────────
type TrackRowProps = {
  track: Track; index: number; showRemove?: boolean; onRemove?: () => void;
  isActive: boolean; isHovered: boolean; isLoadingTrack: boolean; isPlaying: boolean;
  isLiked: boolean; isDownloading: boolean;
  onPlay: () => void; onHoverEnter: () => void; onHoverLeave: () => void;
  onLike: () => void; onDownload: () => void; onCtx: (e: React.MouseEvent) => void;

};
const TrackRow = React.memo(({
  track, index, showRemove, onRemove,
  isActive, isHovered, isLoadingTrack, isPlaying, isLiked, isDownloading,
  onPlay, onHoverEnter, onHoverLeave, onLike, onDownload, onCtx,
}: TrackRowProps) => (
  <div
    className={`flex items-center gap-4 px-4 py-3.5 rounded-lg cursor-pointer transition-all duration-150 group
      ${isActive ? 'bg-[#39FF14]/[0.07] border border-[#39FF14]/20' : 'hover:bg-white/5 border border-transparent'}`}
    onClick={onPlay} onContextMenu={onCtx} onMouseEnter={onHoverEnter} onMouseLeave={onHoverLeave}
  >
    <div className="w-8 flex items-center justify-center shrink-0">
      {isActive && isLoadingTrack
        ? <div className="w-3.5 h-3.5 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
        : isActive && isPlaying
          ? <div className="flex gap-[2px] items-end h-4">
              {[100, 65, 80].map((h, i) => <div key={i} className="w-[3px] bg-[#39FF14] rounded-full animate-pulse shadow-[0_0_4px_#39FF14]" style={{ height: `${h}%`, animationDelay: `${i * 150}ms` }} />)}
            </div>
          : isHovered ? <Play size={16} fill="white" className="text-white" />
          : <span className={`text-[13px] tabular-nums ${isActive ? 'text-[#39FF14]' : 'text-neutral-500'}`}>{index + 1}</span>}
    </div>
    <div className="w-12 h-12 rounded-md overflow-hidden shrink-0 border border-neutral-800/60 bg-neutral-900">
      <img src={track.cover} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
    </div>
    <div className="flex-1 min-w-0">
      <p className={`font-semibold text-[15px] truncate ${isActive ? 'text-[#39FF14]' : 'text-white'}`}>{track.title}</p>
      <p className="text-[13px] text-neutral-500 truncate mt-0.5">{track.artist}</p>
    </div>
    <div className={`flex items-center gap-1 transition-opacity duration-150 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
      <button onClick={e => { e.stopPropagation(); onLike(); }} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
        <Heart size={14} className={isLiked ? 'text-[#39FF14] fill-[#39FF14]' : 'text-neutral-400'} />
      </button>
      <button onClick={e => { e.stopPropagation(); onDownload(); }} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
        {isDownloading ? <div className="w-3.5 h-3.5 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" /> : <Download size={14} className="text-neutral-400" />}
      </button>
      {showRemove && onRemove
        ? <button onClick={e => { e.stopPropagation(); onRemove(); }} className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors"><X size={14} className="text-neutral-400 hover:text-red-400" /></button>
        : <button onClick={e => { e.stopPropagation(); onCtx(e); }} className="p-1.5 rounded-md hover:bg-white/10 transition-colors"><MoreVertical size={14} className="text-neutral-400" /></button>}
    </div>
    <span className="text-[13px] text-neutral-500 tabular-nums w-12 text-right shrink-0">{track.duration}</span>
  </div>
));

const TrackRowSkeleton = ({ index }: { index: number }) => (
  <div className="flex items-center gap-4 px-4 py-3.5">
    <div className="w-8 shrink-0" />
    <div className="w-12 h-12 rounded-md shrink-0 bg-neutral-800/60 animate-pulse" />
    <div className="flex-1 flex flex-col gap-2">
      <div className="h-3.5 bg-neutral-800/70 rounded-full animate-pulse" style={{ width: `${55 + (index * 13) % 35}%` }} />
      <div className="h-2.5 bg-neutral-800/50 rounded-full animate-pulse" style={{ width: `${30 + (index * 7) % 25}%` }} />
    </div>
    <div className="w-12 h-2.5 bg-neutral-800/50 rounded-full animate-pulse shrink-0" />
  </div>
);

// ─── WAVEFORM ─────────────────────────────────────────────────────────────────
const WaveformBar = React.memo(({ waveform, progressPercent, isDragging }: { waveform: number[]; progressPercent: number; isDragging: boolean }) => {
  if (!waveform.length) return null;
  const max = Math.max(...waveform, 0.01);
  return (
    <div className="absolute inset-0 flex items-center gap-[1px] px-0 pointer-events-none overflow-hidden rounded-full opacity-50">
      {waveform.map((v, i) => (
        <div key={i} className="flex-1 rounded-sm"
          style={{
            height: `${Math.max(8, (v / max) * 100)}%`,
            background: (i / waveform.length) * 100 <= progressPercent ? '#39FF14' : '#333',
            transition: isDragging ? 'none' : 'background 0.3s',
          }} />
      ))}
    </div>
  );
});

// ─── CUSTOM SELECT (themed dropdown) ─────────────────────────────────────────
const ThemedSelect = ({ value, options, onChange }: {
  value: string;
  options: { label: string; value: string; desc?: string }[];
  onChange: (v: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const dropW = Math.max(r.width, 220);
      // Right-align dropdown to button's right edge, clamp to viewport
      const left = Math.min(r.right - dropW, window.innerWidth - dropW - 12);
      setDropPos({ top: r.bottom + 6, left: Math.max(8, left), width: dropW });
    }
    setOpen(o => !o);
  };

  return (
    <div ref={ref} className="relative">
      <button ref={btnRef}
        onClick={handleOpen}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-all duration-200 min-w-[120px]
          ${open ? 'bg-[#39FF14]/15 border-[#39FF14]/50 text-[#39FF14]' : 'bg-[#39FF14]/10 border-[#39FF14]/30 text-[#39FF14] hover:bg-[#39FF14]/15'}`}
      >
        <span className="flex-1 text-left">{current?.label}</span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className="fixed rounded-xl overflow-hidden z-[99999]"
          style={{
            top: dropPos.top,
            left: dropPos.left,
            minWidth: dropPos.width,
            animation: 'dropIn 0.15s ease-out',
            background: '#0e0e0e',
            border: '1px solid rgba(57,255,20,0.2)',
            boxShadow: '0 8px 30px rgba(0,0,0,0.95)',
            opacity: 1,
          }}>
          {options.map((opt, i) => (
            <button key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full flex flex-col items-start px-4 py-3 text-left transition-all duration-150
                ${i !== 0 ? 'border-t border-neutral-900' : ''}
                ${value === opt.value
                  ? 'bg-[#39FF14]/10 text-[#39FF14]'
                  : 'text-neutral-300 hover:bg-white/[0.04] hover:text-white'}`}
            >
              <span className="text-sm font-semibold">{opt.label}</span>
              {opt.desc && <span className="text-[11px] text-neutral-600 mt-0.5">{opt.desc}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── SPOTIFY IMPORT MODAL ────────────────────────────────────────────────────
// ── CSV Playlist Import Modal ─────────────────────────────────────────────────
// Uses exportify.net — no API keys or spotdl needed
function ImportResultModal({
  matchedCount, failedCount,
  onSave, onClose,
}: { matchedCount: number; failedCount: number; onSave: (name: string, desc: string) => void; onClose: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/85 backdrop-blur-md">
      <div className="w-[420px] rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.95)]"
        style={{ background: '#0e0e0e', border: '1px solid rgba(57,255,20,0.2)' }}>
        <div className="px-7 py-5 border-b border-neutral-800/60">
          <h2 className="text-base font-bold text-white">Save Playlist</h2>
          <p className="text-xs text-neutral-500 mt-1">
            <span style={{ color: '#39FF14' }} className="font-bold">{matchedCount}</span> tracks matched
            {failedCount > 0 && <span className="text-neutral-600"> · {failedCount} not found</span>}
          </p>
        </div>
        <div className="px-7 py-5 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-widest mb-1.5 block">Playlist Name</label>
            <input ref={inputRef} value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onSave(name.trim(), desc.trim()); }}
              placeholder="My Playlist" maxLength={80}
              className="w-full bg-[#0a0a0a] border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-700 outline-none focus:border-[#39FF14]/40 transition-colors" />
          </div>
          <div>
            <label className="text-xs font-semibold text-neutral-400 uppercase tracking-widest mb-1.5 block">Description <span className="text-neutral-700 normal-case font-normal">(optional)</span></label>
            <input value={desc} onChange={e => setDesc(e.target.value)}
              placeholder="e.g. Chill vibes, road trip..."  maxLength={160}
              className="w-full bg-[#0a0a0a] border border-neutral-800 rounded-xl px-4 py-2.5 text-sm text-white placeholder-neutral-700 outline-none focus:border-[#39FF14]/40 transition-colors" />
          </div>
          <div className="flex gap-3 mt-1">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-600 transition-colors">Cancel</button>
            <button onClick={() => { if (name.trim()) onSave(name.trim(), desc.trim()); }}
              disabled={!name.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 hover:shadow-[0_0_20px_rgba(57,255,20,0.3)] active:scale-[0.98]"
              style={{ background: '#39FF14', color: '#000' }}>
              Save Playlist
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Inline copy button with "Copied ✓" flash ──────────────────────────────────
function CopyButton({ text, label, icon: Icon, disabled = false, className = '' }: {
  text: string; label: string; icon: React.ElementType; disabled?: boolean; className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async () => {
    if (!text || disabled) return;
    try {
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else { const el = document.createElement('textarea'); el.value = text; el.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(el); el.select(); document.execCommand('copy'); document.body.removeChild(el); }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button onClick={handleCopy} disabled={disabled}
      className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 transition-colors disabled:opacity-30 ${className}`}>
      {copied ? <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#39FF14" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span style={{color:'#39FF14'}}>Copied!</span></> : <><Icon size={14} />{label}</>}
    </button>
  );
}

function CsvImportModal({
  onClose,
  onSavePlaylist,
  showToast,
}: {
  onClose: () => void;
  onSavePlaylist: (name: string, desc: string, tracks: Track[]) => void;
  showToast: (m: string) => void;
}) {
  const [phase, setPhase] = useState<'instructions' | 'matching' | 'saving' | 'done'>('instructions');
  const [results, setResults] = useState<{ title: string; artist: string; status: 'pending' | 'fetching' | 'matched' | 'failed'; url?: string; cover?: string }[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const [matchedTracks, setMatchedTracks] = useState<Track[]>([]);
  const [failedCount, setFailedCount] = useState(0);
  const abortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const handleFile = async (file: File) => {
    if (!file.name.endsWith('.csv')) { showToast('Please upload a .csv file from Exportify'); return; }
    const text = await file.text();

    setStatusMsg('Parsing CSV...');
    let raw: string;
    try {
      raw = await invoke<string>('import_csv_playlist', { csvContent: text });
    } catch (e) {
      showToast(`Failed to parse CSV: ${e}`);
      setStatusMsg('');
      return;
    }

    const lines = raw.trim().split('\n').filter(Boolean);
    let trackLines = lines;
    if (lines[0]?.startsWith('PLAYLIST:')) trackLines = lines.slice(1);
    if (trackLines.length === 0) { showToast('No tracks found in CSV'); return; }

    const initial = trackLines.map(l => {
      const [title, artist] = l.split('====');
      return { title: title?.trim() || 'Unknown', artist: artist?.trim() || '', status: 'pending' as const };
    });

    setResults(initial);
    setPhase('matching');
    abortRef.current = false;

    // ── FULLY PARALLEL — all tracks at once, max concurrency via Promise.all ──
    const CONCURRENCY = 12; // 12 simultaneous yt-dlp searches
    const total = initial.length;
    let completed = 0;

    const semaphore = new Array(CONCURRENCY).fill(null);
    const matched: Track[] = [];
    let failed = 0;

    const processTrack = async (track: typeof initial[0], i: number) => {
      if (abortRef.current) return;
      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'fetching' } : r));
      try {
        const q = `${track.title} ${track.artist} audio`;
        const res: string = await invoke('search_youtube', { query: q });
        const firstLine = res.trim().split('\n')[0];
        const parts = firstLine?.split('====') || [];
        const cleanId = parts[3]?.trim();
        if (cleanId) {
          const t: Track = { id: i, title: track.title, artist: track.artist, duration: parts[2]?.trim() || '0:00',
            url: `https://youtube.com/watch?v=${cleanId}`, cover: `https://i.ytimg.com/vi/${cleanId}/mqdefault.jpg` };
          matched.push(t);
          setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'matched', url: t.url, cover: t.cover } : r));
        } else {
          failed++;
          setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'failed' } : r));
        }
      } catch {
        failed++;
        setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'failed' } : r));
      }
      completed++;
      setStatusMsg(`Matching ${completed} / ${total}...`);
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    };

    // Chunk into groups of CONCURRENCY and process each group fully in parallel
    for (let start = 0; start < initial.length; start += CONCURRENCY) {
      if (abortRef.current) break;
      const chunk = initial.slice(start, start + CONCURRENCY);
      await Promise.all(chunk.map((track, bi) => processTrack(track, start + bi)));
    }

    setMatchedTracks(matched);
    setFailedCount(failed);
    setPhase('saving');
    setStatusMsg('');
  };

  const matched = results.filter(r => r.status === 'matched');
  const failed = results.filter(r => r.status === 'failed');
  const isDone = phase === 'done' || phase === 'saving';

  return (
    <>
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md" onClick={onClose}>
      <div className="w-[740px] max-h-[88vh] flex flex-col rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.95)]"
        style={{ background: '#0e0e0e', border: '1px solid rgba(57,255,20,0.15)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-neutral-800/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#1DB954' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
            </div>
            <h2 className="text-base font-bold text-white">Import Spotify Playlist</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 hover:text-white hover:bg-white/[0.06] transition-all">
            <X size={16} />
          </button>
        </div>

        {/* Instructions phase */}
        {phase === 'instructions' && (
          <div className="flex-1 flex flex-col px-7 py-6 gap-5 overflow-y-auto custom-scrollbar">
            <p className="text-sm text-neutral-400 leading-relaxed">
              Vanguard uses <span className="text-white font-semibold">Exportify</span> to import Spotify playlists, no extra software needed.
            </p>
            {[
              { n: '1', title: 'Go to Exportify', desc: 'Open exportify.net in your browser', link: 'https://exportify.net', linkLabel: 'exportify.net →' },
              { n: '2', title: 'Log in with Spotify', desc: 'Click "Log in with Spotify" and authorise Exportify to read your playlists.' },
              { n: '3', title: 'Export your playlist', desc: 'Find the playlist and click the green Export button. A .csv file will download.' },
              { n: '4', title: 'Upload the CSV here', desc: 'Click the button below and select the downloaded .csv file.' },
            ].map(step => (
              <div key={step.n} className="flex gap-4 items-start">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-black mt-0.5" style={{ background: '#39FF14' }}>{step.n}</div>
                <div>
                  <p className="text-sm font-semibold text-white">{step.title}</p>
                  <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{step.desc}</p>
                  {step.link && <button onClick={() => import('@tauri-apps/plugin-opener').then(m => m.openUrl(step.link!)).catch(() => window.open(step.link!, '_blank'))}
                    className="text-base mt-2 inline-block font-bold hover:underline cursor-pointer" style={{ color: '#39FF14' }}>{step.linkLabel}</button>}
                </div>
              </div>
            ))}
            <input ref={fileInputRef} type="file" accept=".csv" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <button onClick={() => fileInputRef.current?.click()}
              className="mt-2 w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:shadow-[0_0_20px_rgba(57,255,20,0.35)] active:scale-[0.98]"
              style={{ background: '#39FF14', color: '#000' }}>
              <Upload size={16} /> Upload Exportify CSV
            </button>
          </div>
        )}

        {/* Matching / done phase */}
        {(phase === 'matching' || phase === 'saving' || phase === 'done') && (
          <>
            <div className="px-7 py-3 border-b border-neutral-800/40 shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-bold tracking-widest uppercase" style={{ color: '#39FF14' }}>
                  {isDone ? `Done · ${matched.length} matched` : `Matching · ${matched.length + failed.length} / ${results.length}`}
                  {failed.length > 0 && <span className="text-neutral-600 ml-2">· {failed.length} not found</span>}
                </span>
                {statusMsg && <span className="text-[10px] text-neutral-600 font-mono">{statusMsg}</span>}
              </div>
              <div className="h-1 rounded-full bg-neutral-800 overflow-hidden">
                <div className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${results.length > 0 ? ((matched.length + failed.length) / results.length) * 100 : 0}%`, background: '#39FF14' }} />
              </div>
            </div>
            <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar">
              {results.map((r, i) => (
                <div key={i} className="flex items-center gap-4 px-7 py-2.5 border-b border-neutral-800/30 last:border-0">
                  <div className="w-8 h-8 rounded-md shrink-0 overflow-hidden bg-neutral-900 flex items-center justify-center">
                    {r.cover ? <img src={r.cover} className="w-full h-full object-cover" alt="" /> : <Music size={13} className="text-neutral-700" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate leading-snug">{r.title}</p>
                    <p className="text-xs text-neutral-600 truncate">{r.artist}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5 w-24 justify-end">
                    {r.status === 'pending'  && <span className="text-xs text-neutral-800">·</span>}
                    {r.status === 'fetching' && <Loader2 size={12} className="animate-spin text-neutral-500" />}
                    {r.status === 'matched'  && <CheckCircle2 size={13} style={{ color: '#39FF14' }} />}
                    {r.status === 'failed'   && <XCircle size={13} className="text-red-600" />}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
    {/* Name prompt shown after matching completes */}
    {phase === 'saving' && (
      <ImportResultModal
        matchedCount={matchedTracks.length}
        failedCount={failedCount}
        onSave={(name, desc) => {
          onSavePlaylist(name, desc, matchedTracks);
          setPhase('done');
          onClose();
        }}
        onClose={() => { setPhase('done'); onClose(); }}
      />
    )}
    </>
  );
}

// ── YouTube Playlist Import Modal ─────────────────────────────────────────────
function YtImportModal({
  onClose,
  onSavePlaylist,
  showToast,
}: {
  onClose: () => void;
  onSavePlaylist: (name: string, desc: string, tracks: Track[]) => void;
  showToast: (m: string) => void;
}) {
  const [phase, setPhase] = useState<'input' | 'loading' | 'saving' | 'done'>('input');
  const [url, setUrl] = useState('');
  const [results, setResults] = useState<{ title: string; artist: string; id: string; cover: string }[]>([]);
  const [statusMsg, setStatusMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleImport = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    if (!trimmed.includes('youtube.com') && !trimmed.includes('youtu.be')) {
      showToast('Please paste a YouTube playlist URL');
      return;
    }
    setPhase('loading');
    setStatusMsg('Fetching playlist from YouTube...');
    try {
      const raw: string = await invoke('import_youtube_playlist', { url: trimmed });
      const lines = raw.trim().split('\n').filter(Boolean);
      const parsed = lines.map(l => {
        const [title, artist, , id] = l.split('====');
        return {
          title: title?.trim() || 'Unknown',
          artist: artist?.trim() || '',
          id: id?.trim() || '',
          cover: id?.trim() ? `https://i.ytimg.com/vi/${id.trim()}/mqdefault.jpg` : '',
        };
      }).filter(t => t.id);

      if (parsed.length === 0) { showToast('No tracks found'); setPhase('input'); return; }
      setResults(parsed);
      setPhase('saving');
      setStatusMsg('');
    } catch (e) {
      showToast(`Import failed: ${e}`);
      setPhase('input');
      setStatusMsg('');
    }
  };

  const isYtUrl = url.includes('youtube.com') || url.includes('youtu.be');

  return (
    <>
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md" onClick={onClose}>
      <div className="w-[680px] max-h-[86vh] flex flex-col rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.95)]"
        style={{ background: '#0e0e0e', border: '1px solid rgba(255,0,0,0.15)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-7 py-5 border-b border-neutral-800/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-600">
              <svg width="18" height="14" viewBox="0 0 18 14" fill="white"><path d="M17.6 2.2C17.4 1.4 16.8.8 16 .6 14.6.2 9 .2 9 .2S3.4.2 2 .6C1.2.8.6 1.4.4 2.2 0 3.6 0 6.5 0 6.5s0 2.9.4 4.3c.2.8.8 1.4 1.6 1.6C3.4 12.8 9 12.8 9 12.8s5.6 0 7-.4c.8-.2 1.4-.8 1.6-1.6.4-1.4.4-4.3.4-4.3s0-2.9-.4-4.3zM7.2 9.3V3.7l4.7 2.8-4.7 2.8z"/></svg>
            </div>
            <h2 className="text-base font-bold text-white">Import YouTube Playlist</h2>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 hover:text-white hover:bg-white/[0.06] transition-all">
            <X size={16} />
          </button>
        </div>

        {/* Input phase */}
        {(phase === 'input' || phase === 'loading') && (
          <div className="flex-1 flex flex-col px-7 py-6 gap-5">
            <p className="text-sm text-neutral-400">Paste a public YouTube playlist URL below. All videos will be imported instantly, no matching needed.</p>
            <div className="flex gap-3">
              <div className="flex-1 flex items-center gap-2 bg-[#0a0a0a] border border-neutral-800 rounded-xl px-4 py-2.5 focus-within:border-red-500/40 transition-colors">
                <svg width="14" height="11" viewBox="0 0 18 14" fill="#666" className="shrink-0"><path d="M17.6 2.2C17.4 1.4 16.8.8 16 .6 14.6.2 9 .2 9 .2S3.4.2 2 .6C1.2.8.6 1.4.4 2.2 0 3.6 0 6.5 0 6.5s0 2.9.4 4.3c.2.8.8 1.4 1.6 1.6C3.4 12.8 9 12.8 9 12.8s5.6 0 7-.4c.8-.2 1.4-.8 1.6-1.6.4-1.4.4-4.3.4-4.3s0-2.9-.4-4.3zM7.2 9.3V3.7l4.7 2.8-4.7 2.8z"/></svg>
                <input ref={inputRef} value={url} onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && phase === 'input' && isYtUrl) handleImport(); }}
                  placeholder="https://youtube.com/playlist?list=..."
                  disabled={phase === 'loading'}
                  className="flex-1 bg-transparent text-sm text-neutral-300 placeholder-neutral-700 outline-none" />
              </div>
              <button onClick={handleImport} disabled={phase === 'loading' || !isYtUrl}
                className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white">
                {phase === 'loading' ? <Loader2 size={15} className="animate-spin" /> : <><svg width="13" height="10" viewBox="0 0 18 14" fill="white"><path d="M17.6 2.2C17.4 1.4 16.8.8 16 .6 14.6.2 9 .2 9 .2S3.4.2 2 .6C1.2.8.6 1.4.4 2.2 0 3.6 0 6.5 0 6.5s0 2.9.4 4.3c.2.8.8 1.4 1.6 1.6C3.4 12.8 9 12.8 9 12.8s5.6 0 7-.4c.8-.2 1.4-.8 1.6-1.6.4-1.4.4-4.3.4-4.3s0-2.9-.4-4.3zM7.2 9.3V3.7l4.7 2.8-4.7 2.8z"/></svg>Import</>}
              </button>
            </div>
            {statusMsg && <p className="text-xs text-neutral-500 font-mono">{statusMsg}</p>}
          </div>
        )}

        {/* Preview loaded */}
        {phase === 'saving' && (
          <div className="flex-1 overflow-y-auto custom-scrollbar px-7 py-4">
            <p className="text-xs text-neutral-500 mb-3">{results.length} videos found. Enter a name and save.</p>
            <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1">
              {results.slice(0, 50).map((r, i) => (
                <div key={i} className="flex items-center gap-3">
                  <img src={r.cover} className="w-10 h-7 rounded object-cover shrink-0 bg-neutral-900" alt="" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{r.title}</p>
                    <p className="text-xs text-neutral-600 truncate">{r.artist}</p>
                  </div>
                </div>
              ))}
              {results.length > 50 && <p className="text-xs text-neutral-700 pt-1">+ {results.length - 50} more...</p>}
            </div>
          </div>
        )}
      </div>
    </div>
    {phase === 'saving' && (
      <ImportResultModal
        matchedCount={results.length}
        failedCount={0}
        onSave={(name, desc) => {
          const tracks: Track[] = results.map((r, i) => ({
            id: i, title: r.title, artist: r.artist, duration: '0:00',
            url: `https://youtube.com/watch?v=${r.id}`, cover: r.cover,
          }));
          onSavePlaylist(name, desc, tracks);
          setPhase('done');
          onClose();
        }}
        onClose={() => { setPhase('done'); onClose(); }}
      />
    )}
    </>
  );
}



function SettingsPanel({
  downloadQuality, setDownloadQuality, downloadPath, handleSelectDirectory,
  playbackSpeed, setPlaybackSpeed, eq, setEq,
  sleepTimer, setSleepTimerMinutes, cancelSleepTimer,
  deps, setDeps, ytDlpVersion, setYtDlpVersion,
  onUpdateYtDlp, isUpdatingYtDlp,
  onBackup, onRestore,
  backupPath, setBackupPath,
  cachePath, setCachePath,
  crossfadeSeconds, setCrossfadeSeconds,
  showToast,
}: {
  downloadQuality: string; setDownloadQuality: (q: string) => void;
  downloadPath: string; handleSelectDirectory: () => void;
  playbackSpeed: number; setPlaybackSpeed: (s: number) => void;
  eq: { bass: number; mid: number; treble: number }; setEq: (eq: { bass: number; mid: number; treble: number }) => void;
  sleepTimer: number; setSleepTimerMinutes: (m: number) => void; cancelSleepTimer: () => void;
  deps: DepsStatus | null; setDeps: (d: DepsStatus) => void;
  ytDlpVersion: string; setYtDlpVersion: (v: string) => void;
  onUpdateYtDlp: () => void; isUpdatingYtDlp: boolean;
  onBackup: () => void; onRestore: () => void;
  backupPath: string; setBackupPath: (p: string) => void;
  cachePath: string; setCachePath: (p: string) => void;
  crossfadeSeconds: number; setCrossfadeSeconds: (s: number) => void;
  showToast: (m: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('dependencies');
  const [isInstalling, setIsInstalling] = useState(false);
  const [installLog, setInstallLog] = useState('');
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [cacheSize, setCacheSize] = useState<number>(0);

  useEffect(() => {
    invoke<DiskInfo>('get_disk_usage', { path: downloadPath }).then(setDiskInfo).catch(() => {});
  }, [downloadPath]);
  useEffect(() => {
    invoke<number>('get_cache_size').then(setCacheSize).catch(() => {});
  }, [cachePath]);

  const fmtBytes = (b: number) => b < 1024 * 1024 ? `${(b/1024).toFixed(1)} KB` : b < 1024**3 ? `${(b/1024**2).toFixed(1)} MB` : `${(b/1024**3).toFixed(2)} GB`;

  const handleInstall = async () => {
    setIsInstalling(true);
    setInstallLog('Installing dependencies...\n');
    try {
      const result: InstallResult = await invoke('install_dependencies');
      setInstallLog(result.message);
      if (result.success) showToast('Dependencies installed!');
      // Re-check
      const d: DepsStatus = await invoke('check_dependencies');
      setDeps(d);
        const v: string = await invoke('get_yt_dlp_version').catch(() => '');
      setYtDlpVersion(v);
    } catch (e) {
      setInstallLog(`Error: ${e}`);
    } finally {
      setIsInstalling(false);
    }
  };

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'dependencies', label: 'Dependencies', icon: <PackageCheck size={15} /> },
    { id: 'downloads', label: 'Downloads', icon: <FolderDown size={15} /> },
    { id: 'storage', label: 'Storage', icon: <Database size={15} /> },
  ];

  const allInstalled = deps?.mpv && deps?.yt_dlp && deps?.ffprobe;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar tabs */}
      <div className="w-48 shrink-0 border-r border-neutral-800/50 flex flex-col p-4 gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 px-3 mb-2">Settings</p>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 text-left w-full
              ${activeTab === tab.id
                ? 'bg-[#39FF14]/[0.08] text-[#39FF14] border border-[#39FF14]/15 shadow-[inset_2px_0_0_#39FF14]'
                : 'text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.03] border border-transparent'}`}>
            <span className={activeTab === tab.id ? 'text-[#39FF14]' : 'text-neutral-600'}>{tab.icon}</span>
            {tab.label}
            {tab.id === 'dependencies' && deps && (!deps.mpv || !deps.yt_dlp) && (
              <span className="ml-auto w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content — fills remaining space, no empty right gap */}
      <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">

        {/* ── DEPENDENCIES ── */}
        {activeTab === 'dependencies' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Dependencies</h2>
              <p className="text-sm text-neutral-500">Vanguard requires mpv, yt-dlp, and ffprobe to work. Install or update them here.</p>
            </div>

            {/* Status list */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden divide-y divide-neutral-800/60">
              {([
                { key: 'mpv', label: 'mpv', desc: 'Audio playback', ok: deps?.mpv },
                { key: 'yt_dlp', label: 'yt-dlp', desc: 'YouTube streaming', ok: deps?.yt_dlp },
                { key: 'ffprobe', label: 'ffprobe', desc: 'Metadata & waveforms', ok: deps?.ffprobe },
              ] as { key: string; label: string; desc: string; ok: boolean | undefined }[]).map(d => (
                <div key={d.key} className="flex items-center justify-between px-5 py-3.5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${d.ok === undefined ? 'bg-neutral-700 animate-pulse' : d.ok ? 'bg-[#39FF14]' : 'bg-red-500'}`} />
                    <div>
                      <span className="text-sm font-bold font-mono text-white">{d.label}</span>
                      <span className="text-xs text-neutral-600 ml-2">{d.desc}</span>
                    </div>
                  </div>
                  <span className={`text-xs font-semibold ${d.ok === undefined ? 'text-neutral-600' : d.ok ? 'text-[#39FF14]' : 'text-red-400'}`}>
                    {d.ok === undefined ? 'Checking...' : d.ok ? 'Installed' : 'Not found'}
                  </span>
                </div>
              ))}
            </div>

            {/* yt-dlp version row */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden divide-y divide-neutral-800/60">
              <div className="px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">yt-dlp</p>
                  <p className="text-xs text-neutral-600 font-mono mt-0.5">{ytDlpVersion || (deps?.yt_dlp ? 'checking...' : 'Not installed')}</p>
                </div>
                <button onClick={onUpdateYtDlp} disabled={isUpdatingYtDlp || !deps?.yt_dlp}
                  className="flex items-center gap-2 px-4 py-2 bg-[#39FF14]/10 border border-[#39FF14]/30 text-[#39FF14] rounded-lg text-sm font-semibold hover:bg-[#39FF14]/20 disabled:opacity-40 transition-colors">
                  {isUpdatingYtDlp ? <div className="w-3.5 h-3.5 border-2 border-[#39FF14]/70 border-t-transparent rounded-full animate-spin" /> : <RotateCcw size={14} />}
                  Update
                </button>
              </div>
            </div>

            {/* Install button */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Terminal size={15} className="text-[#39FF14]" /> Install All Dependencies
                </h3>
                <p className="text-xs text-neutral-600 mt-1">
                  Installs mpv, ffmpeg, and yt-dlp using your system's package manager (apt, pacman, dnf, winget, brew).
                </p>
              </div>
              <div className="px-5 py-4 flex flex-col gap-3">
                <button onClick={handleInstall} disabled={isInstalling || !!allInstalled}
                  className={`flex items-center justify-center gap-2.5 py-3 px-5 rounded-xl font-bold text-sm transition-all duration-200
                    ${allInstalled
                      ? 'bg-[#39FF14]/10 border border-[#39FF14]/20 text-[#39FF14]/50 cursor-not-allowed'
                      : isInstalling
                        ? 'bg-[#39FF14]/10 border border-[#39FF14]/30 text-[#39FF14] cursor-wait'
                        : 'bg-[#39FF14] text-black hover:shadow-[0_0_25px_#39FF14] hover:scale-[1.02] active:scale-[0.98]'}`}>
                  {isInstalling
                    ? <><div className="w-4 h-4 border-2 border-current/60 border-t-transparent rounded-full animate-spin" /> Installing...</>
                    : allInstalled
                      ? <><CheckCircle size={16} /> All Installed</>
                      : <><Zap size={16} /> Install Dependencies</>}
                </button>
                {installLog && (
                  <div className="bg-[#050505] border border-neutral-800 rounded-lg p-3 font-mono text-[11px] text-neutral-400 whitespace-pre-wrap max-h-40 overflow-y-auto custom-scrollbar">
                    {installLog}
                  </div>
                )}
                {allInstalled && (
                  <p className="text-xs text-[#39FF14]/60 flex items-center gap-1.5"><CheckCircle size={11} /> All dependencies are installed and ready.</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── DOWNLOADS ── */}
        {activeTab === 'downloads' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Downloads</h2>
              <p className="text-sm text-neutral-500">Configure download quality and destination folder.</p>
            </div>

            {/* Quality */}
            <div className="border border-neutral-800/60 rounded-xl overflow-visible">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white">Audio Quality</h3>
                <p className="text-xs text-neutral-600 mt-0.5">Quality of downloaded MP3 files.</p>
              </div>
              <div className="px-5 py-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Download Quality</p>
                  <p className="text-xs text-neutral-600 mt-1">
                    {downloadQuality === 'High' ? 'Best available audio bitrate (320kbps+)' : downloadQuality === 'Medium' ? 'Balanced quality (~128kbps)' : 'Smallest file size'}
                  </p>
                </div>
                <ThemedSelect
                  value={downloadQuality}
                  onChange={setDownloadQuality}
                  options={[
                    { value: 'High', label: 'High', desc: 'Best quality · largest files' },
                    { value: 'Medium', label: 'Medium', desc: 'Balanced · ~128kbps' },
                    { value: 'Low', label: 'Low', desc: 'Smallest files' },
                  ]}
                />
              </div>
            </div>

            {/* Folder */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white">Download Folder</h3>
              </div>
              <div className="flex items-center justify-between px-5 py-4 cursor-pointer group hover:bg-white/[0.02] transition-colors" onClick={handleSelectDirectory}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-neutral-300 truncate">{downloadPath}</p>
                  {diskInfo && <p className="text-xs text-neutral-600 mt-1">{formatBytes(diskInfo.used_bytes)} used · {diskInfo.track_count} audio files</p>}
                </div>
                <button className="p-2 ml-4 text-neutral-600 group-hover:text-[#39FF14] transition-colors shrink-0 rounded-lg">
                  <FolderOpen size={17} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STORAGE ── */}
        {activeTab === 'storage' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Storage</h2>
              <p className="text-sm text-neutral-500">Backup and restore your playlists, queue, settings, and history.</p>
            </div>

            {/* Stream Cache Location */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Zap size={14} className="text-[#39FF14]" /> Stream Cache</h3>
                <p className="text-xs text-neutral-600 mt-0.5">Audio chunks cached to disk for instant replay and faster loading. Default: Documents/VanguardCache</p>
              </div>
              <div className="flex items-center justify-between px-5 py-4 cursor-pointer group hover:bg-white/[0.02] transition-colors"
                onClick={async () => {
                  try {
                    const sel = await (await import('@tauri-apps/plugin-dialog')).open({ directory: true, multiple: false, defaultPath: cachePath });
                    if (sel) setCachePath(sel as string);
                  } catch {}
                }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-neutral-300 truncate">{cachePath || 'Documents/VanguardCache'}</p>
                  <p className="text-xs text-neutral-600 mt-1">Cache size: <span className="text-neutral-400">{fmtBytes(cacheSize)}</span></p>
                </div>
                <button className="p-2 ml-4 text-neutral-600 group-hover:text-[#39FF14] transition-colors shrink-0 rounded-lg"><FolderOpen size={17} /></button>
              </div>
              <div className="px-5 py-3 border-t border-neutral-800/40 flex items-center justify-between">
                <p className="text-xs text-neutral-600">Clear to free disk space</p>
                <button
                  onClick={async () => {
                    try {
                      const freed = await invoke<number>('clear_cache');
                      setCacheSize(0);
                      showToast(`Cache cleared, freed ${fmtBytes(freed)}`);
                    } catch (e) { showToast(`Failed: ${e}`); }
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
                  Clear Cache
                </button>
              </div>
            </div>

            {/* Backup Location — explicit picker */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white">Backup Location</h3>
                <p className="text-xs text-neutral-600 mt-0.5">Choose where backup files are saved.</p>
              </div>
              <div className="flex items-center justify-between px-5 py-4 cursor-pointer group hover:bg-white/[0.02] transition-colors" onClick={async () => {
                try {
                  const sel = await (await import('@tauri-apps/plugin-dialog')).open({ directory: true, multiple: false, defaultPath: backupPath });
                  if (sel) setBackupPath(sel as string);
                } catch {}
              }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono text-neutral-300 truncate">{backupPath || downloadPath}</p>
                  <p className="text-xs text-neutral-600 mt-1">Backup file: vanguard_backup.json</p>
                </div>
                <button className="p-2 ml-4 text-neutral-600 group-hover:text-[#39FF14] transition-colors shrink-0 rounded-lg">
                  <FolderOpen size={17} />
                </button>
              </div>
            </div>

            <div className="border border-neutral-800/60 rounded-xl divide-y divide-neutral-800/60 overflow-hidden">
              {/* Create backup */}
              <div className="px-5 py-4 flex items-center justify-between group hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={onBackup}>
                <div>
                  <h3 className="text-sm font-semibold text-white">Create Backup</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">Save all playlists, queue, history and settings to a JSON file.</p>
                </div>
                <button className="p-2 text-neutral-600 group-hover:text-[#39FF14] transition-colors rounded-lg ml-4 shrink-0">
                  <Upload size={17} />
                </button>
              </div>

              {/* Restore */}
              <div className="px-5 py-4 flex items-center justify-between group hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={onRestore}>
                <div>
                  <h3 className="text-sm font-semibold text-white">Restore Backup</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">Restore your data and settings from a backup file.</p>
                </div>
                <button className="p-2 text-neutral-600 group-hover:text-[#39FF14] transition-colors rounded-lg ml-4 shrink-0">
                  <ArchiveRestore size={17} />
                </button>
              </div>

              {/* Reset */}
              <div className="px-5 py-4 flex items-center justify-between group hover:bg-red-500/[0.04] transition-colors cursor-pointer"
                onClick={() => {
                  if (window.confirm('Reset all Vanguard data? This cannot be undone.')) {
                    localStorage.clear();
                    window.location.reload();
                  }
                }}>
                <div>
                  <h3 className="text-sm font-semibold text-white">Reset Vanguard App</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">Clear all data and reset the app to its default state.</p>
                </div>
                <button className="p-2 text-neutral-700 group-hover:text-red-400 transition-colors rounded-lg ml-4 shrink-0">
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          </div>
        )}


      </div>
    </div>
  );
}

// ─── DOWNLOADS PANEL ─────────────────────────────────────────────────────────
function DownloadsPanel({
  downloadPath, onPlayLocalTrack, onDeleteLocalTrack,
  currentTrackPath, isPlaying, isLoadingTrack,
  onOpenInFileManager, onExportM3u, onChangeFolder,
}: {
  downloadPath: string; onPlayLocalTrack: (t: LocalTrack, list?: LocalTrack[], idx?: number) => void;
  onDeleteLocalTrack: (t: LocalTrack) => void; currentTrackPath: string | null;
  isPlaying: boolean; isLoadingTrack: boolean;
  onOpenInFileManager: (p: string) => void; onExportM3u: (ts: LocalTrack[]) => void;
  onChangeFolder: () => void;
}) {
  const [tracks, setTracks] = useState<LocalTrack[]>([]);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [renaming, setRenaming] = useState<LocalTrack | null>(null);
  const [renameVal, setRenameVal] = useState('');

  const scan = useCallback(async () => {
    setScanning(true); setError(null);
    try {
      const raw: LocalTrack[] = await invoke('scan_downloads', { path: downloadPath });
      // Enrich with metadata (title/artist/duration only — no useless fields)
      const enriched = await Promise.allSettled(raw.map(async t => {
        try {
          const m: { title: string; artist: string; duration: string } = await invoke('get_audio_metadata', { path: t.path });
          return { ...t, title: m.title || t.title, artist: m.artist || undefined, duration: m.duration !== '0:00' ? m.duration : undefined };
        } catch { return t; }
      }));
      setTracks(enriched.map(r => r.status === 'fulfilled' ? r.value : (r as PromiseRejectedResult).reason));
      const di: DiskInfo = await invoke('get_disk_usage', { path: downloadPath }).catch(() => null);
      if (di) setDiskInfo(di);
    } catch (e) { setError(String(e)); }
    finally { setScanning(false); }
  }, [downloadPath]);

  useEffect(() => { scan(); }, [scan]);

  const confirmRename = async () => {
    if (!renaming || !renameVal.trim()) return;
    try {
      const newPath: string = await invoke('rename_local_file', { oldPath: renaming.path, newTitle: renameVal.trim() });
      setTracks(prev => prev.map(t => t.path === renaming.path ? { ...t, title: renameVal.trim(), path: newPath } : t));
      setRenaming(null);
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 z-10 custom-scrollbar">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center bg-[#39FF14]/10 border border-[#39FF14]/30 shrink-0">
          <HardDrive size={22} className="text-[#39FF14] drop-shadow-[0_0_6px_#39FF14]" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold text-white">Offline</h2>
          {/* Folder path — click to change */}
          <button onClick={onChangeFolder}
            className="flex items-center gap-1.5 mt-0.5 text-sm text-neutral-500 hover:text-[#39FF14] transition-colors font-mono truncate max-w-full group" title="Change folder">
            <span className="truncate">{downloadPath}</span>
            <FolderOpen size={13} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
          {diskInfo && <p className="text-xs text-neutral-600 mt-0.5">{formatBytes(diskInfo.used_bytes)} used · {diskInfo.track_count} files</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onChangeFolder} className="p-2 text-neutral-500 hover:text-[#39FF14] transition-colors rounded-lg hover:bg-white/5" title="Change folder"><FolderOpen size={16} /></button>
          {tracks.length > 0 && (
            <button onClick={() => onExportM3u(tracks)} className="p-2 text-neutral-500 hover:text-[#39FF14] transition-colors rounded-lg hover:bg-white/5" title="Export M3U"><FileOutput size={16} /></button>
          )}
          <button onClick={scan} disabled={scanning} className="p-2 text-neutral-500 hover:text-[#39FF14] disabled:opacity-40 rounded-lg hover:bg-white/5" title="Refresh"><RefreshCw size={16} className={scanning ? 'animate-spin' : ''} /></button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm mb-6">
          <AlertCircle size={16} className="shrink-0" /><span>{error}</span>
        </div>
      )}

      {scanning && (
        <div className="flex flex-col gap-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3.5 rounded-lg">
              <div className="w-10 h-10 rounded-md bg-neutral-800/60 animate-pulse shrink-0" />
              <div className="flex-1 flex flex-col gap-2">
                <div className="h-3 bg-neutral-800/70 rounded-full animate-pulse" style={{ width: `${50 + (i * 11) % 35}%` }} />
                <div className="h-2.5 bg-neutral-800/40 rounded-full animate-pulse" style={{ width: `${25 + (i * 7) % 20}%` }} />
              </div>
              <div className="w-12 h-2.5 bg-neutral-800/40 rounded-full animate-pulse shrink-0" />
            </div>
          ))}
        </div>
      )}

      {!scanning && tracks.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center h-48 text-neutral-700 gap-4">
          <FileMusic size={40} strokeWidth={1} />
          <div className="text-center">
            <p className="text-sm font-medium text-neutral-600">No audio files found</p>
            <p className="text-xs text-neutral-700 mt-1">Download tracks from Home, or change your folder in Settings → Downloads.</p>
          </div>
        </div>
      )}

      {!scanning && tracks.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-3">
            <span className="w-1.5 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
            <h3 className="text-base font-bold text-white flex-1">{tracks.length} track{tracks.length !== 1 ? 's' : ''}</h3>
          </div>
          <div className="flex flex-col gap-1">
            {tracks.map((track, i) => {
              const isActive = currentTrackPath === track.path;
              const isHov = hovered === track.path;
              return (
                <div key={track.path}
                  className={`flex items-center gap-4 px-4 py-3.5 rounded-lg cursor-pointer transition-all duration-150 group border
                    ${isActive ? 'bg-[#39FF14]/[0.07] border-[#39FF14]/20' : 'hover:bg-white/5 border-transparent'}`}
                  onClick={() => onPlayLocalTrack(track, tracks, i)}
                  onMouseEnter={() => setHovered(track.path)} onMouseLeave={() => setHovered(null)}
                >
                  <div className="w-8 flex items-center justify-center shrink-0">
                    {isActive && isLoadingTrack
                      ? <div className="w-3.5 h-3.5 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
                      : isActive && isPlaying
                        ? <div className="flex gap-[2px] items-end h-4">{[100, 65, 80].map((h, j) => <div key={j} className="w-[3px] bg-[#39FF14] rounded-full animate-pulse shadow-[0_0_4px_#39FF14]" style={{ height: `${h}%`, animationDelay: `${j * 150}ms` }} />)}</div>
                        : isHov ? <Play size={16} fill="white" className="text-white" />
                        : <span className={`text-[13px] tabular-nums ${isActive ? 'text-[#39FF14]' : 'text-neutral-500'}`}>{i + 1}</span>}
                  </div>
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center shrink-0 border ${isActive ? 'bg-[#39FF14]/10 border-[#39FF14]/20' : 'bg-neutral-900 border-neutral-800/60'}`}>
                    <FileMusic size={18} className={isActive ? 'text-[#39FF14]' : 'text-neutral-500'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`font-semibold text-[15px] truncate ${isActive ? 'text-[#39FF14]' : 'text-white'}`}>{track.title}</p>
                    <p className="text-[13px] text-neutral-500 truncate mt-0.5">{track.artist || track.extension.toUpperCase()} · {formatBytes(track.size_bytes)}</p>
                  </div>
                  <div className={`flex items-center gap-1 transition-opacity ${isHov ? 'opacity-100' : 'opacity-0'}`}>
                    <button onClick={e => { e.stopPropagation(); setRenaming(track); setRenameVal(track.title); }} className="p-1.5 rounded-md hover:bg-white/10 transition-colors" title="Rename"><Pencil size={13} className="text-neutral-400" /></button>
                    <button onClick={e => { e.stopPropagation(); onOpenInFileManager(track.path); }} className="p-1.5 rounded-md hover:bg-white/10 transition-colors" title="Show in folder"><FolderOpen size={13} className="text-neutral-400" /></button>
                    <button onClick={e => { e.stopPropagation(); onDeleteLocalTrack(track); scan(); }} className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors" title="Delete"><Trash2 size={13} className="text-neutral-400 hover:text-red-400" /></button>
                  </div>
                  <span className="text-[13px] text-neutral-500 tabular-nums w-12 text-right shrink-0">{track.duration || '—'}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Rename modal */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-neutral-800 p-6 rounded-xl w-80 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Rename Track</h3>
            <input autoFocus type="text" value={renameVal} onChange={e => setRenameVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenaming(null); }}
              className="w-full bg-[#050505] border border-neutral-800 text-white rounded-lg py-2.5 px-3 focus:outline-none focus:border-[#39FF14] mb-4 text-sm" />
            <div className="flex justify-end gap-3">
              <button onClick={() => setRenaming(null)} className="px-4 py-2 text-sm text-neutral-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={confirmRename} className="px-4 py-2 bg-[#39FF14] text-black text-sm font-bold rounded-lg hover:shadow-[0_0_15px_#39FF14] transition-all">Rename</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SPEED SELECTOR (in player bar) ──────────────────────────────────────────
const SpeedSelector = React.memo(({ speed, onChange }: { speed: number; onChange: (s: number) => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold transition-all border
          ${speed !== 1 ? 'text-[#39FF14] border-[#39FF14]/30 bg-[#39FF14]/10' : 'text-neutral-600 border-neutral-800 hover:text-neutral-400 hover:border-neutral-700'}`}>
        <Gauge size={11} />
        {speed}x
      </button>
      {open && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-[#0e0e0e] border border-neutral-800 rounded-xl overflow-hidden shadow-2xl z-50"
          style={{ animation: 'dropIn 0.12s ease-out' }}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 px-3 pt-2.5 pb-1">Speed</p>
          {speeds.map(s => (
            <button key={s} onClick={() => { onChange(s); setOpen(false); }}
              className={`w-full text-left px-4 py-2 text-sm font-semibold transition-colors
                ${speed === s ? 'text-[#39FF14] bg-[#39FF14]/10' : 'text-neutral-400 hover:text-white hover:bg-white/5'}`}>
              {s}x {s === 1 && <span className="text-neutral-700 text-xs font-normal ml-1">normal</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function VanguardPlayer() {

  // ── Core state ───────────────────────────────────────────────────────────────
  const [tracks, setTracks] = useState<Track[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(() => loadLS('vg_searchHistory', []));
  const [showHistory, setShowHistory] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => loadLS('vg_currentTrack', null));
  const [currentLocalPath, setCurrentLocalPath] = useState<string | null>(null);
  const currentLocalPathRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const setIsPlayingSync = useCallback((v: boolean) => { isPlayingRef.current = v; setIsPlaying(v); }, []);

  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const [navHistory, setNavHistory] = useState<string[]>([]);

  // Wrap setActiveNav to push to history
  const navigateTo = useCallback((nav: string) => {
    setNavHistory(prev => [...prev.slice(-20), activeNav]);
    setActiveNav(nav);
  }, [activeNav]);

  // navigateBack always goes to home and resets search state
  // (search state refs are set below — JS closures capture them at call time, not definition time)
  const navigateBack = useCallback(() => {
    setActiveNav('home');
    setNavHistory([]);
  }, []);

  const [trackDurationSeconds, setTrackDurationSeconds] = useState(0);
  const trackDurationRef = useRef(0);
  const [progressSeconds, setProgressSeconds] = useState(0);
  const progressSecondsRef = useRef(0);

  const [isSearching, setIsSearching] = useState(false);

  // When navigating to home (via back button or sidebar), clear search results
  useEffect(() => {
    if (activeNav === 'home') {
      setSearchQuery('');
      setTracks([]);
      setIsSearching(false);
    }
  }, [activeNav]);

  const [quickPicks, setQuickPicks] = useState<Track[]>(() => loadLS('vg_quickPicks', []));

  const [queue, setQueue] = useState<Track[]>(() => loadLS('vg_queue', []));
  const [playHistory, setPlayHistory] = useState<Track[]>(() => loadLS('vg_playHistory', []));
  // ── Real stats ─────────────────────────────────────────────────────────────
  const [playCounts, setPlayCounts] = useState<Record<string, number>>(() => loadLS('vg_playCounts', {}));
  const [listenSecs, setListenSecs] = useState<Record<string, number>>(() => loadLS('vg_listenSecs', {}));
  const [firstSeen, setFirstSeen] = useState<Record<string, string>>(() => loadLS('vg_firstSeen', {}));
  const [dailyPlays, setDailyPlays] = useState<Record<string, number>>(() => loadLS('vg_dailyPlays', {}));
  const listenSecsRef = useRef(listenSecs);
  useEffect(() => { listenSecsRef.current = listenSecs; }, [listenSecs]);
  const [shuffle, setShuffle] = useState<boolean>(() => loadLS('vg_shuffle', false));
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => loadLS('vg_repeatMode', 'off'));
  const repeatModeRef = useRef<RepeatMode>(loadLS('vg_repeatMode', 'off'));
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const dragQueueIdx = useRef<number | null>(null);
  const dragOverQueueIdxRef = useRef<number | null>(null);
  const [dragOverQueueIdx, setDragOverQueueIdx] = React.useState<number | null>(null);
  const dragPlaylistIdx = useRef<number | null>(null);
  const dragOverPlaylistIdxRef = useRef<number | null>(null);
  const [dragOverPlaylistIdx, setDragOverPlaylistIdx] = React.useState<number | null>(null);
  const dragPlaylistCardIdx = useRef<number | null>(null);
  const dragOverPlaylistCardIdxRef = useRef<number | null>(null);
  const [dragOverPlaylistCardIdx, setDragOverPlaylistCardIdx] = React.useState<number | null>(null);

  const [volume, setVolume] = useState<number>(() => loadLS('vg_volume', 100));
  const [previousVolume, setPreviousVolume] = useState(100);

  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const isDraggingProgressRef = useRef(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);

  // ── Playlists ─────────────────────────────────────────────────────────────────
  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    loadLS('vg_playlists', [{ id: 'p1', name: 'Liked Songs', description: '', tracks: [] }])
  );
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDesc, setNewPlaylistDesc] = useState('');
  const [renamingPlaylist, setRenamingPlaylist] = useState<Playlist | null>(null);
  const [showCsvImportModal, setShowCsvImportModal] = useState(false);
  const [showYtImportModal, setShowYtImportModal] = useState(false);
  const [showDuplicatesPlaylist, setShowDuplicatesPlaylist] = useState<Playlist | null>(null);
  const [bulkEditPlaylist, setBulkEditPlaylist] = useState<Playlist | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [renameDescVal, setRenameDescVal] = useState('');
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null);
  const [sidebarPlaylistsExpanded, setSidebarPlaylistsExpanded] = useState(true);

  // ── UI ────────────────────────────────────────────────────────────────────────
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [infoModalTrack, setInfoModalTrack] = useState<Track | null>(null);
  const [downloadingTracks, setDownloadingTracks] = useState<Record<string, boolean>>({});
  const [hoveredTrackUrl, setHoveredTrackUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Settings ──────────────────────────────────────────────────────────────────
  const [downloadQuality, setDownloadQuality] = useState<string>(() => loadLS('vg_dlQuality', 'High'));
  const [downloadPath, setDownloadPath] = useState<string>(() => loadLS('vg_dlPath', '~/Downloads'));
  const [backupPath, setBackupPathState] = useState<string>(() => loadLS('vg_backupPath', ''));
  const setBackupPath = useCallback((p: string) => { setBackupPathState(p); saveLS('vg_backupPath', p); }, []);
  const [cachePath, setCachePathState] = useState<string>(() => loadLS('vg_cachePath', ''));
  const setCachePath = useCallback((p: string) => {
    setCachePathState(p);
    saveLS('vg_cachePath', p);
    invoke('set_cache_dir', { path: p }).catch(() => {});
  }, []);
  const [playbackSpeed, setPlaybackSpeedState] = useState<number>(() => loadLS('vg_speed', 1));
  const [crossfadeSeconds, setCrossfadeSecondsState] = useState<number>(() => loadLS('vg_crossfade', 0));
  const [bookmarks, setBookmarks] = useState<Record<string, number>>(() => loadLS('vg_bookmarks', {}));
  useEffect(() => { saveLS('vg_bookmarks', bookmarks); }, [bookmarks]);
  const setCrossfadeSeconds = useCallback((s: number) => {
    setCrossfadeSecondsState(s);
    saveLS('vg_crossfade', s);
  }, []);
  const [abLoop, setAbLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const abLoopRef = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [eq, setEqState] = useState<{ bass: number; mid: number; treble: number }>(() => loadLS('vg_eq', { bass: 0, mid: 0, treble: 0 }));
  const [deps, setDeps] = useState<DepsStatus | null>(null);
  const [ytDlpVersion, setYtDlpVersion] = useState('');
  const [isUpdatingYtDlp, setIsUpdatingYtDlp] = useState(false);
  const [sleepTimer, setSleepTimerState] = useState(-1);
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [showSleepPopover, setShowSleepPopover] = useState(false);
  const [showInfoHint, setShowInfoHint] = useState(false);
  const infoHintBtnRef = useRef<HTMLDivElement>(null);
  const [infoHintPos, setInfoHintPos] = useState<{ top: number; left: number } | null>(null);
  const sleepPopoverRef = useRef<HTMLDivElement>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────────
  const searchRef = useRef<HTMLInputElement>(null);
  const endDetectedRef = useRef(false);
  const currentTrackRef = useRef(currentTrack);
  const queueRef = useRef(queue);
  const bookmarksRef = useRef(bookmarks);
  useEffect(() => { bookmarksRef.current = bookmarks; }, [bookmarks]);
  const localTracksListRef = useRef<LocalTrack[]>([]);
  const localTrackIndexRef = useRef(0);
  // Context for playlist/search track navigation (enables skip fwd/back in any Track[] source)
  const playlistContextRef = useRef<{ tracks: Track[]; index: number } | null>(null);

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

  // ── Persist ───────────────────────────────────────────────────────────────────
  useEffect(() => { saveLS('vg_playlists', playlists); }, [playlists]);
  useEffect(() => { saveLS('vg_queue', queue); }, [queue]);
  useEffect(() => { saveLS('vg_playHistory', playHistory); }, [playHistory]);
  useEffect(() => { saveLS('vg_playCounts', playCounts); }, [playCounts]);
  useEffect(() => { saveLS('vg_listenSecs', listenSecs); }, [listenSecs]);
  useEffect(() => { saveLS('vg_firstSeen', firstSeen); }, [firstSeen]);
  useEffect(() => { saveLS('vg_dailyPlays', dailyPlays); }, [dailyPlays]);
  useEffect(() => { saveLS('vg_shuffle', shuffle); }, [shuffle]);
  useEffect(() => { saveLS('vg_repeatMode', repeatMode); }, [repeatMode]);
  useEffect(() => { saveLS('vg_volume', volume); }, [volume]);
  // Init cache dir — load from localStorage or get default from Rust
  useEffect(() => {
    const saved = loadLS('vg_cachePath', '');
    if (saved) {
      invoke('set_cache_dir', { path: saved }).catch(() => {});
    } else {
      invoke<string>('get_cache_dir').then(d => { setCachePathState(d); saveLS('vg_cachePath', d); }).catch(() => {});
    }
  }, []);
  useEffect(() => { saveLS('vg_currentTrack', currentTrack); }, [currentTrack]);


  // Save position on page close/refresh
  useEffect(() => {
    const save = () => { saveLS('vg_lastPosition', progressSecondsRef.current); };
      window.addEventListener('beforeunload', save);
    return () => {
      window.removeEventListener('beforeunload', save);
    };
  }, []);
  useEffect(() => { saveLS('vg_searchHistory', searchHistory); }, [searchHistory]);
  useEffect(() => { saveLS('vg_dlQuality', downloadQuality); }, [downloadQuality]);
  useEffect(() => { saveLS('vg_dlPath', downloadPath); }, [downloadPath]);
  useEffect(() => { saveLS('vg_quickPicks', quickPicks); }, [quickPicks]);
  useEffect(() => { saveLS('vg_speed', playbackSpeed); }, [playbackSpeed]);
  useEffect(() => { saveLS('vg_eq', eq); }, [eq]);

  // ── Toast ─────────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  // ── Global click ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = () => { setCtxMenu(null); setShowHistory(false); setShowSleepPopover(false); setShowInfoHint(false); };
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, []);

  // ── Init ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    invoke<DepsStatus>('check_dependencies').then(setDeps).catch(() => {});
    invoke<string>('get_yt_dlp_version').then(setYtDlpVersion).catch(() => {});
  }, []);

  // ── Sleep timer poll — actually pauses when expired ──────────────────────
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r: number = await invoke('get_sleep_timer_remaining');
        if (r >= 0) {
          setSleepTimerState(r);
          // If timer just hit 0 (within this poll window), pause playback
          if (r === 0 && isPlayingRef.current) {
            try { await invoke('pause_audio'); setIsPlayingSync(false); } catch {}
            setSleepTimerState(-1);
          }
        } else {
          setSleepTimerState(-1);
        }
      } catch {}
    }, sleepTimer > 0 ? 2000 : 10000);
    return () => clearInterval(id);
  }, [sleepTimer, setIsPlayingSync]);

  // ── Batch download listener ───────────────────────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<BatchProgress>('batch_download_progress', e => {
      showToast(`Downloaded ${e.payload.index + 1}/${e.payload.total}${e.payload.error ? ' (error)' : ''}`);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [showToast]);

  // ── Listen-time accumulator — increments every 5s while playing ──────────
  useEffect(() => {
    if (!isPlaying || !currentTrack || isLoadingTrack) return;
    const url = currentTrack.url;
    const id = setInterval(() => {
      setListenSecs(prev => {
        const next = { ...prev, [url]: (prev[url] || 0) + 5 };
        listenSecsRef.current = next;
        return next;
      });
    }, 5000);
    return () => clearInterval(id);
  }, [isPlaying, currentTrack?.url, isLoadingTrack]);

    // ── Prefetch next in queue — only when queue head URL changes ───────────────
  const lastPrefetchUrl = useRef<string | null>(null);
  useEffect(() => {
    const nextUrl = queue[0]?.url;
    // Never prefetch local files — they're already on disk, no network needed
    if (nextUrl && !nextUrl.startsWith('local://') && nextUrl !== lastPrefetchUrl.current) {
      lastPrefetchUrl.current = nextUrl;
      invoke('prefetch_track', { url: nextUrl }).catch(() => {});
    }
  }, [queue]);

  // ── Audio info ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => { invoke<AudioInfo>('get_audio_info').then(setAudioInfo).catch(() => {}); }, 6000);
    invoke<AudioInfo>('get_audio_info').then(setAudioInfo).catch(() => {});
    return () => clearInterval(id);
  }, [isPlaying]);

  // ── Settings actions ──────────────────────────────────────────────────────────
  const setPlaybackSpeed = useCallback((s: number) => {
    setPlaybackSpeedState(s);
    invoke('set_playback_speed', { speed: s }).catch(() => {});
    showToast(`Speed: ${s}x`);
  }, [showToast]);

  const setEq = useCallback((newEq: typeof eq) => {
    setEqState(newEq);
    invoke('set_equalizer', { bass: newEq.bass, mid: newEq.mid, treble: newEq.treble }).catch(() => {});
  }, []);

  const setSleepTimerMinutes = useCallback((m: number) => {
    invoke('set_sleep_timer', { seconds: m * 60 })
      .then(() => { setSleepTimerState(m * 60); showToast(`Sleep timer: ${m}m`); })
      .catch(() => {});
  }, [showToast]);

  const cancelSleepTimer = useCallback(() => {
    invoke('cancel_sleep_timer').then(() => { setSleepTimerState(-1); showToast('Sleep timer cancelled'); }).catch(() => {});
  }, [showToast]);

  const handleUpdateYtDlp = useCallback(async () => {
    setIsUpdatingYtDlp(true);
    try {
      const r: string = await invoke('update_yt_dlp');
      showToast(r.includes('up-to-date') ? 'yt-dlp is up to date' : 'yt-dlp updated');
      const v: string = await invoke('get_yt_dlp_version').catch(() => '');
      setYtDlpVersion(v);
      const d: DepsStatus = await invoke('check_dependencies');
      setDeps(d);
      } catch (e) { showToast(`Update failed: ${e}`); }
    finally { setIsUpdatingYtDlp(false); }
  }, [showToast]);

  // ── Backup / Restore ──────────────────────────────────────────────────────────
  const handleBackup = useCallback(async () => {
    try {
      const data = {
        playlists,
        queue,
        playHistory,
        shuffle,
        repeatMode,
        volume,
        downloadQuality,
        downloadPath,
        backupPath,
        playbackSpeed,
        eq,
        searchHistory,
        quickPicks,
        currentTrack,
        version: 1,
        exportedAt: new Date().toISOString(),
      };
      const json = JSON.stringify(data, null, 2);
      // Trigger browser download
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'vanguard_backup.json'; a.click();
      URL.revokeObjectURL(url);
      showToast('Backup saved');
    } catch (e) { showToast(`Backup failed: ${e}`); }
  }, [playlists, queue, playHistory, shuffle, repeatMode, volume, downloadQuality, downloadPath, backupPath, playbackSpeed, eq, searchHistory, quickPicks, currentTrack, showToast]);

  const handleRestore = useCallback(async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.json';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const text = await file.text();
        try {
          const data = JSON.parse(text);
          if (data.version !== 1) { showToast('Invalid backup file'); return; }
          if (data.playlists) setPlaylists(data.playlists);
          if (data.queue) setQueue(data.queue);
          if (data.playHistory) setPlayHistory(data.playHistory);
          if (data.shuffle !== undefined) setShuffle(data.shuffle);
          if (data.repeatMode) setRepeatMode(data.repeatMode);
          if (data.volume !== undefined) setVolume(data.volume);
          if (data.downloadQuality) setDownloadQuality(data.downloadQuality);
          if (data.downloadPath) setDownloadPath(data.downloadPath);
          if (data.backupPath) setBackupPath(data.backupPath);
          if (data.playbackSpeed) setPlaybackSpeedState(data.playbackSpeed);
          if (data.eq) setEqState(data.eq);
          if (data.searchHistory) setSearchHistory(data.searchHistory);
          if (data.quickPicks) setQuickPicks(data.quickPicks);
          if (data.currentTrack) setCurrentTrack(data.currentTrack);
          showToast('Backup restored successfully');
        } catch { showToast('Failed to parse backup file'); }
      };
      input.click();
    } catch (e) { showToast(`Restore failed: ${e}`); }
  }, [showToast]);

  // ── PLAY YOUTUBE ──────────────────────────────────────────────────────────────
  const handlePlayTrack = useCallback(async (track: Track, fromQueue = false) => {
    endDetectedRef.current = false;
    setAbLoop({ a: null, b: null }); abLoopRef.current = { a: null, b: null };
    setCurrentTrack(track); currentTrackRef.current = track;
    setCurrentLocalPath(null); currentLocalPathRef.current = null;
    setIsLoadingTrack(true); setIsPlayingSync(false);
    setProgressSeconds(0); progressSecondsRef.current = 0;
    setTrackDurationSeconds(0); trackDurationRef.current = 0;
    setWaveformData([]); setAudioInfo(null);

    if (!fromQueue) {
      setPlayHistory(prev => [track, ...prev].slice(0, 50));
      // Real stats — increment on every play
      setPlayCounts(prev => ({ ...prev, [track.url]: (prev[track.url] || 0) + 1 }));
      const today = new Date().toISOString().slice(0, 10);
      setDailyPlays(prev => ({ ...prev, [today]: (prev[today] || 0) + 1 }));
      setFirstSeen(prev => prev[track.url] ? prev : { ...prev, [track.url]: new Date().toISOString() });
      // If this track is in the current playlist context, update the index
      if (playlistContextRef.current) {
        const idx = playlistContextRef.current.tracks.findIndex(t => t.url === track.url);
        if (idx >= 0) playlistContextRef.current = { ...playlistContextRef.current, index: idx };
        else playlistContextRef.current = null; // track not in current context — clear it
      }
    }
    setQuickPicks(prev => [track, ...prev.filter(t => t.url !== track.url)].slice(0, 20));

    try {
      await invoke('play_audio', { url: track.url });
      await invoke('set_volume', { volume });
      await invoke('set_playback_speed', { speed: playbackSpeed });
      await invoke('set_equalizer', { bass: eq.bass, mid: eq.mid, treble: eq.treble });

      let waited = 0;
      await new Promise<void>(resolve => {
        const t = setInterval(async () => {
          waited += 300;
          try {
            const s: { position: number; duration: number } = await invoke('get_playback_state');
            if (s.position > 0) {
              if (s.duration > 0) { setTrackDurationSeconds(s.duration); trackDurationRef.current = s.duration; }
              clearInterval(t); resolve(); return;
            }
          } catch {}
          if (waited >= 20000) { clearInterval(t); resolve(); }
        }, 300);
      });

      setIsPlayingSync(true);
      // Resume from bookmark if one exists for this track
      const bm = bookmarksRef.current[track.url];
      if (bm && bm > 2) {
        setTimeout(() => invoke('seek_audio', { position: bm }).catch(() => {}), 600);
      }
    } catch { setIsPlayingSync(false); }
    finally { setIsLoadingTrack(false); }
  }, [volume, playbackSpeed, eq, setIsPlayingSync]);

  // ── PLAY LOCAL ────────────────────────────────────────────────────────────────
  const handlePlayLocalTrack = useCallback(async (local: LocalTrack, localList?: LocalTrack[], localIndex?: number) => {
    endDetectedRef.current = false;
    setCurrentLocalPath(local.path); currentLocalPathRef.current = local.path;
    // Track list for next/prev navigation within local tracks
    if (localList !== undefined) {
      localTracksListRef.current = localList;
      localTrackIndexRef.current = localIndex ?? 0;
    } else if (localTracksListRef.current.length === 0) {
      // Single track play — put it in list so auto-advance still works
      localTracksListRef.current = [local];
      localTrackIndexRef.current = 0;
    } else {
      // Find it in existing list
      const idx = localTracksListRef.current.findIndex(t => t.path === local.path);
      if (idx >= 0) localTrackIndexRef.current = idx;
    }

    setIsLoadingTrack(true); setIsPlayingSync(false);
    setProgressSeconds(0); progressSecondsRef.current = 0;
    setTrackDurationSeconds(0); trackDurationRef.current = 0;
    setAudioInfo(null);

    const synth: Track = {
      id: -1, title: local.title,
      artist: local.artist || local.extension.toUpperCase(),
      duration: local.duration || '0:00',
      url: `local://${local.path}`, cover: '',
    };
    setCurrentTrack(synth); currentTrackRef.current = synth;

    // Pre-set duration from metadata so bar is ready immediately
    if (local.duration && local.duration !== '0:00') {
      const d = parseDurationToSeconds(local.duration);
      if (d > 0) { setTrackDurationSeconds(d); trackDurationRef.current = d; }
    }

    // Waveform in background — don't block playback
    invoke<number[]>('get_waveform_thumbnail', { path: local.path })
      .then(setWaveformData).catch(() => setWaveformData([]));

    try {
      await invoke('play_local_file', { path: local.path });
      await invoke('set_volume', { volume });
      await invoke('set_playback_speed', { speed: playbackSpeed });
      // Local files are already on disk — play instantly, no buffering
      setIsPlayingSync(true);
      // Confirm duration from mpv after a short moment
      setTimeout(async () => {
        try {
          const s: { position: number; duration: number } = await invoke('get_playback_state');
          if (s.duration > 0) { setTrackDurationSeconds(s.duration); trackDurationRef.current = s.duration; }
        } catch {}
      }, 500);
    } catch { setIsPlayingSync(false); }
    finally { setIsLoadingTrack(false); }
  }, [volume, playbackSpeed, setIsPlayingSync]);

  const handleDeleteLocalTrack = useCallback(async (t: LocalTrack) => {
    try { await invoke('delete_local_file', { path: t.path }); showToast(`Deleted: ${t.title}`); }
    catch (e) { showToast(`Delete failed: ${e}`); }
  }, [showToast]);

  const handleOpenInFileManager = useCallback((p: string) => { invoke('open_in_file_manager', { path: p }).catch(() => {}); }, []);

  const handleExportM3u = useCallback(async (localTracks: LocalTrack[]) => {
    try {
      const tracks = localTracks.map(t => ({ title: t.title, artist: t.artist || '', url: t.path, duration_secs: t.duration ? Math.round(parseDurationToSeconds(t.duration)) : 0 }));
      await invoke('export_playlist_m3u', { tracks, path: `${downloadPath}/playlist.m3u` });
      showToast('Playlist exported');
    } catch (e) { showToast(`Export failed: ${e}`); }
  }, [downloadPath, showToast]);

  // ── Play track in playlist context (sets nav so skip fwd/back work) ─────────
  const handlePlayInContext = useCallback((track: Track, contextList: Track[]) => {
    const idx = contextList.findIndex(t => t.url === track.url);
    playlistContextRef.current = { tracks: contextList, index: Math.max(0, idx) };
    setQueue([]); // Clear queue — context takes over navigation
    handlePlayTrack(track, true);
    // Don't add to history when playing from a list (handled by context)
  }, [handlePlayTrack]);

  // ── Controls ──────────────────────────────────────────────────────────────────
  const togglePlayPause = useCallback(async () => {
    if (!currentTrackRef.current) return;
    // Cold start: mpv not running — need to fully re-play the track from saved position
    if (!isPlayingRef.current) {
      try {
        const state: { playing: boolean; paused: boolean; position: number; duration: number; eof_reached: boolean } =
          await invoke('get_playback_state');
        // If position is 0 and not paused, mpv is dead — resume from saved position
        if (state.position === 0 && !state.paused) {
          const savedPos: number = loadLS('vg_lastPosition', 0);
          await handlePlayTrack(currentTrackRef.current, true);
          if (savedPos > 3) {
            // Wait for track to start then seek
            await new Promise(r => setTimeout(r, 1500));
            await invoke('seek_audio', { time: savedPos }).catch(() => {});
          }
          return;
        }
      } catch {
        // mpv not running at all — full resume
        const savedPos: number = loadLS('vg_lastPosition', 0);
        await handlePlayTrack(currentTrackRef.current, true);
        if (savedPos > 3) {
          await new Promise(r => setTimeout(r, 1500));
          await invoke('seek_audio', { time: savedPos }).catch(() => {});
        }
        return;
      }
    }
    try { await invoke('pause_audio'); setIsPlayingSync(!isPlayingRef.current); } catch {}
  }, [setIsPlayingSync, handlePlayTrack]);

  const toggleMute = useCallback(async () => {
    const v = volume === 0 ? previousVolume : 0;
    if (volume > 0) setPreviousVolume(volume);
    setVolume(v);
    try { await invoke('set_volume', { volume: v }); } catch {}
  }, [volume, previousVolume]);

  const handleSkipForward = useCallback(async () => {
    const track = currentTrackRef.current;
    const isLocal = track?.url?.startsWith('local://');

    // ── Local file navigation ──────────────────────────────────────────────
    if (isLocal) {
      const list = localTracksListRef.current;
      const idx = localTrackIndexRef.current;
      let nextIdx: number;
      if (shuffle) {
        do { nextIdx = Math.floor(Math.random() * list.length); } while (nextIdx === idx && list.length > 1);
      } else {
        nextIdx = idx + 1;
      }
      if (nextIdx < list.length) {
        localTrackIndexRef.current = nextIdx;
        handlePlayLocalTrack(list[nextIdx], list, nextIdx);
      } else if (repeatModeRef.current === 'all' && list.length > 0) {
        localTrackIndexRef.current = 0;
        handlePlayLocalTrack(list[0], list, 0);
      }
      return;
    }

    // ── Playlist context navigation (takes priority over queue) ───────────
    const ctx = playlistContextRef.current;
    if (ctx && ctx.tracks.length > 1) {
      let nextIdx: number;
      if (shuffle) {
        do { nextIdx = Math.floor(Math.random() * ctx.tracks.length); }
        while (nextIdx === ctx.index && ctx.tracks.length > 1);
      } else {
        nextIdx = ctx.index + 1;
      }
      if (nextIdx < ctx.tracks.length) {
        playlistContextRef.current = { ...ctx, index: nextIdx };
        await handlePlayTrack(ctx.tracks[nextIdx], true);
      } else if (repeatModeRef.current === 'all') {
        playlistContextRef.current = { ...ctx, index: 0 };
        await handlePlayTrack(ctx.tracks[0], true);
      }
      return;
    }

    // ── Queue fallback ─────────────────────────────────────────────────────
    const q = queueRef.current;
    if (q.length > 0) { const [next, ...rest] = q; setQueue(rest); await handlePlayTrack(next, true); }
  }, [handlePlayTrack, handlePlayLocalTrack, shuffle]);

  const handleSkipBack = useCallback(async () => {
    const track = currentTrackRef.current;
    const isLocal = track?.url?.startsWith('local://');

    // ── Local file navigation ──────────────────────────────────────────────
    if (isLocal) {
      if (progressSecondsRef.current > 3) {
        await invoke('seek_audio', { time: 0 }).catch(() => {});
        progressSecondsRef.current = 0; setProgressSeconds(0);
        return;
      }
      const list = localTracksListRef.current;
      const idx = localTrackIndexRef.current;
      if (idx > 0) {
        const prevIdx = idx - 1;
        localTrackIndexRef.current = prevIdx;
        handlePlayLocalTrack(list[prevIdx], list, prevIdx);
      } else {
        await invoke('seek_audio', { time: 0 }).catch(() => {});
        progressSecondsRef.current = 0; setProgressSeconds(0);
      }
      return;
    }

    // Restart if past 3s
    if (progressSecondsRef.current > 3) {
      await invoke('seek_audio', { time: 0 }).catch(() => {});
      progressSecondsRef.current = 0; setProgressSeconds(0);
      return;
    }

    // ── Playlist context navigation ────────────────────────────────────────
    const ctx = playlistContextRef.current;
    if (ctx && ctx.index > 0) {
      const prevIdx = ctx.index - 1;
      playlistContextRef.current = { ...ctx, index: prevIdx };
      await handlePlayTrack(ctx.tracks[prevIdx], true);
      return;
    }

    // ── History fallback ───────────────────────────────────────────────────
    if (playHistory.length > 0) {
      const [prev, ...rest] = playHistory; setPlayHistory(rest); await handlePlayTrack(prev, true);
    } else {
      await invoke('seek_audio', { time: 0 }).catch(() => {});
      progressSecondsRef.current = 0; setProgressSeconds(0);
    }
  }, [playHistory, handlePlayTrack, handlePlayLocalTrack]);

  const toggleShuffle = useCallback(() => setShuffle(p => { showToast(!p ? 'Shuffle on' : 'Shuffle off'); return !p; }), [showToast]);
  const cycleRepeat = useCallback(() => setRepeatMode(p => {
    const n: RepeatMode = p === 'off' ? 'all' : p === 'all' ? 'one' : 'off';
    repeatModeRef.current = n;
    showToast(n === 'off' ? 'Repeat off' : n === 'all' ? 'Repeat all' : 'Repeat one');
    return n;
  }), [showToast]);

  // ── Keyboard ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.code === 'Space' && !isInput) { e.preventDefault(); togglePlayPause(); }
      if (e.code === 'ArrowRight' && !isInput && currentTrackRef.current) { e.preventDefault(); invoke('seek_relative', { seconds: 10 }).catch(() => {}); }
      if (e.code === 'ArrowLeft' && !isInput && currentTrackRef.current) { e.preventDefault(); invoke('seek_relative', { seconds: -10 }).catch(() => {}); }
      if (e.code === 'KeyM' && !isInput) toggleMute();
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [togglePlayPause, toggleMute]);

  // ── Track end ─────────────────────────────────────────────────────────────────
  const handleTrackEnd = useCallback(() => {
    if (endDetectedRef.current) return;
    endDetectedRef.current = true;
    const track = currentTrackRef.current;
    const repeat = repeatModeRef.current;
    const isLocal = track?.url?.startsWith('local://');

    if (repeat === 'one' && track) {
      invoke('seek_to_start').catch(() => {
        invoke('seek_audio', { time: 0 }).catch(() => {});
      });
      progressSecondsRef.current = 0;
      setProgressSeconds(0);
      setIsPlayingSync(true);
      setTimeout(() => { endDetectedRef.current = false; }, 1500);
      return;
    }

    // ── Local track auto-advance ──────────────────────────────────────────
    if (isLocal) {
      const list = localTracksListRef.current;
      const idx = localTrackIndexRef.current;
      if (list.length > 1) {
        let nextIdx: number;
        if (shuffle) {
          // Random next, but not same
          do { nextIdx = Math.floor(Math.random() * list.length); } while (nextIdx === idx && list.length > 1);
        } else {
          nextIdx = idx + 1;
        }
        if (nextIdx < list.length) {
          localTrackIndexRef.current = nextIdx;
          setTimeout(() => handlePlayLocalTrack(list[nextIdx], list, nextIdx), 0);
          return;
        } else if (repeat === 'all') {
          localTrackIndexRef.current = 0;
          setTimeout(() => handlePlayLocalTrack(list[0], list, 0), 0);
          return;
        }
      } else if (repeat === 'all' && list.length === 1) {
        // Single track repeat all = just replay
        invoke('seek_to_start').catch(() => {});
        progressSecondsRef.current = 0; setProgressSeconds(0);
        setIsPlayingSync(true);
        setTimeout(() => { endDetectedRef.current = false; }, 1500);
        return;
      }
      setIsPlayingSync(false);
      return;
    }

    // ── Queue auto-advance ────────────────────────────────────────────────
    const q = queueRef.current;
    if (q.length > 0) {
      const [next, ...rest] = q;
      queueRef.current = rest;
      setQueue(rest);
      setTimeout(() => handlePlayTrack(next, true), 0);
      return;
    }

    // ── Playlist context auto-advance ─────────────────────────────────────
    const ctx = playlistContextRef.current;
    if (ctx && ctx.tracks.length > 1) {
      let nextIdx: number;
      if (shuffle) {
        do { nextIdx = Math.floor(Math.random() * ctx.tracks.length); }
        while (nextIdx === ctx.index && ctx.tracks.length > 1);
      } else {
        nextIdx = ctx.index + 1;
      }
      if (nextIdx < ctx.tracks.length) {
        playlistContextRef.current = { ...ctx, index: nextIdx };
        setTimeout(() => handlePlayTrack(ctx.tracks[nextIdx], true), 0);
        return;
      } else if (repeat === 'all') {
        playlistContextRef.current = { ...ctx, index: 0 };
        setTimeout(() => handlePlayTrack(ctx.tracks[0], true), 0);
        return;
      }
    }

    if (repeat === 'all' && track) {
      setTimeout(() => handlePlayTrack(track, true), 0);
      return;
    }

    // Nothing to play — stop
    setIsPlayingSync(false);
  }, [handlePlayTrack, handlePlayLocalTrack, setIsPlayingSync, shuffle]);

  // ── Progress poll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      if (isDraggingProgressRef.current) return;
      try {
        const s: { playing: boolean; paused: boolean; position: number; duration: number; eof_reached: boolean } =
          await invoke('get_playback_state');

        progressSecondsRef.current = s.position;
        setProgressSeconds(s.position);
        // Persist position every ~5 seconds for resume-on-reopen
        if (Math.floor(s.position) % 5 === 0 && s.position > 3) {
          saveLS('vg_lastPosition', s.position);
        }
        // A-B loop: if B point set and we've passed it, jump back to A
        const ab = abLoopRef.current;
        if (ab.a !== null && ab.b !== null && s.position >= ab.b) {
          invoke('seek_audio', { time: ab.a }).catch(() => {});
        }

        if (s.duration > 0 && s.duration !== trackDurationRef.current) {
          trackDurationRef.current = s.duration; setTrackDurationSeconds(s.duration);
        }

        // Only sync play/pause state when not loading and not in EOF handling
        if (!isLoadingTrack && !endDetectedRef.current) {
          const playing = !s.paused;
          if (playing !== isPlayingRef.current) setIsPlayingSync(playing);
        }

        // Crossfade: when within crossfadeSeconds of end, trigger next track early
        if (!s.eof_reached && !endDetectedRef.current && s.position > 3 && s.duration > 0
            && crossfadeSeconds > 0 && s.position >= s.duration - crossfadeSeconds - 0.5
            && s.position < s.duration - 0.2) {
          // Start fade out via volume ramp, then trigger track end
          const fadeSteps = Math.max(1, Math.round(crossfadeSeconds * 5));
          const volStep = (volume / fadeSteps);
          let step = 0;
          const fadeInterval = setInterval(() => {
            step++;
            const newVol = Math.max(0, volume - volStep * step);
            invoke('set_volume', { volume: newVol }).catch(() => {});
            if (step >= fadeSteps) {
              clearInterval(fadeInterval);
              invoke('set_volume', { volume }).catch(() => {}); // restore after next track loads
              if (!endDetectedRef.current) handleTrackEnd();
            }
          }, (crossfadeSeconds * 1000) / fadeSteps);
          // endDetected already set above to prevent double-fire
          return;
        }
        // EOF detection — only fire if position is meaningful (> 3s to avoid false positives on load)
        if (s.eof_reached && !endDetectedRef.current && s.position > 3) {
          handleTrackEnd();
          return;
        }
        // Secondary check: very close to end (within 1s) — covers cases where eof-reached isn't set yet
        if (!s.eof_reached && !endDetectedRef.current && s.position > 3 && s.duration > 0 && s.position >= s.duration - 1.0) {
          handleTrackEnd();
        }
      } catch {}
    };

    const id = setInterval(poll, isPlaying ? 500 : 2000);
    return () => clearInterval(id);
  }, [isPlaying, isLoadingTrack, handleTrackEnd, setIsPlayingSync]);

  // ── Folder picker ─────────────────────────────────────────────────────────────
  const handleSelectDirectory = useCallback(async () => {
    try {
      const sel = await open({ directory: true, multiple: false, defaultPath: downloadPath });
      if (sel) setDownloadPath(sel as string);
    } catch {}
  }, [downloadPath]);

  // ── Progress drag ─────────────────────────────────────────────────────────────
  const updateProgressFromEvent = useCallback((clientX: number) => {
    if (!progressRef.current || !currentTrackRef.current) return undefined;
    const rect = progressRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const total = trackDurationRef.current || parseDurationToSeconds(currentTrackRef.current.duration);
    const t = total * pct;
    progressSecondsRef.current = t; setProgressSeconds(t);
    return t;
  }, []);

  const updateVolumeFromEvent = useCallback((clientX: number) => {
    if (!volumeRef.current) return;
    const rect = volumeRef.current.getBoundingClientRect();
    const v = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setVolume(v); invoke('set_volume', { volume: v }).catch(() => {});
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDraggingProgressRef.current) updateProgressFromEvent(e.clientX);
      if (isDraggingVolume) updateVolumeFromEvent(e.clientX);
    };
    const onUp = async (e: MouseEvent) => {
      if (isDraggingProgressRef.current) {
        const t = updateProgressFromEvent(e.clientX);
        if (t !== undefined) await invoke('seek_audio', { time: t }).catch(() => {});
        isDraggingProgressRef.current = false; setIsDraggingProgress(false);
      }
      if (isDraggingVolume) setIsDraggingVolume(false);
    };
    if (isDraggingProgress || isDraggingVolume) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDraggingProgress, isDraggingVolume, updateProgressFromEvent, updateVolumeFromEvent]);

  // ── Search ────────────────────────────────────────────────────────────────────
  const searchMusic = useCallback(async (override?: string) => {
    const q = (override ?? searchQuery).trim();
    if (!q || isSearching) return;
    setIsSearching(true); setTracks([]); setShowHistory(false); setHasSearched(true);
    setSearchHistory(prev => [q, ...prev.filter(h => h !== q)].slice(0, 8));
    try {
      const res: string = await invoke('search_youtube', { query: q });
      const parsed = res.trim().split('\n').filter(Boolean).map((line, i) => {
        const [title, artist, duration, id] = line.split('====');
        const cleanId = id?.trim();
        return { id: i, title: title?.trim() || 'Unknown', artist: artist?.trim() || 'Unknown', duration: duration?.trim() || '0:00', url: `https://youtube.com/watch?v=${cleanId}`, cover: `https://i.ytimg.com/vi/${cleanId}/mqdefault.jpg` };
      });
      setTracks(parsed);
    } catch { setTracks([]); }
    finally { setIsSearching(false); }
  }, [searchQuery, isSearching]);

  // ── Context menu ──────────────────────────────────────────────────────────────
  const openCtx = useCallback((e: React.MouseEvent, menu: Omit<CtxMenu, 'x' | 'y'>) => {
    e.preventDefault(); e.stopPropagation();
    const { x, y } = clampMenu(e.clientX, e.clientY);
    setCtxMenu({ x, y, ...menu });
  }, []);

  // ── Download ──────────────────────────────────────────────────────────────────
  const handleDownload = useCallback(async (track: Track) => {
    setDownloadingTracks(p => ({ ...p, [track.url]: true }));
    try {
      await invoke('download_song', { url: track.url, quality: downloadQuality, path: downloadPath });
      showToast(`Downloaded: ${track.title}`);
    } catch { showToast('Download failed'); }
    finally { setTimeout(() => setDownloadingTracks(p => ({ ...p, [track.url]: false })), 2000); }
  }, [downloadQuality, downloadPath, showToast]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      // Tauri: use writeText from clipboard plugin if available, else navigator
      if (typeof navigator?.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback: create temp textarea
        const el = document.createElement('textarea');
        el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
        document.body.appendChild(el); el.select();
        document.execCommand('copy'); document.body.removeChild(el);
      }
      showToast('Copied!');
    } catch { showToast('Copy failed'); }
  }, [showToast]);
  const openInYouTube = useCallback(async (u: string) => {
    if (!u || (!u.startsWith('http://') && !u.startsWith('https://'))) return;
    try {
      await invoke('open_url_in_browser', { url: u });
    } catch {
      try { await openUrl(u); } catch { window.open(u, '_blank'); }
    }
  }, []);

  // ── Playlist helpers ──────────────────────────────────────────────────────────
  const confirmCreatePlaylist = useCallback(() => {
    if (!newPlaylistName.trim()) return;
    setPlaylists(p => [...p, { id: `p${Date.now()}`, name: newPlaylistName.trim(), description: newPlaylistDesc.trim(), tracks: [] }]);
    setIsPlaylistModalOpen(false); setNewPlaylistName(''); setNewPlaylistDesc('');
    showToast(`Playlist "${newPlaylistName.trim()}" created`);
  }, [newPlaylistName, newPlaylistDesc, showToast]);

  const deletePlaylist = useCallback((id: string) => {
    if (id === 'p1') return;
    setPlaylists(p => p.filter(x => x.id !== id));
    setOpenPlaylistId(prev => prev === id ? null : prev);
    showToast('Playlist deleted');
  }, [showToast]);

  const confirmRenamePlaylist = useCallback(() => {
    if (!renameVal.trim() || !renamingPlaylist) return;
    setPlaylists(p => p.map(x => x.id === renamingPlaylist.id ? { ...x, name: renameVal.trim(), description: renameDescVal.trim() } : x));
    setRenamingPlaylist(null); showToast('Playlist updated');
  }, [renameVal, renameDescVal, renamingPlaylist, showToast]);

  const toggleLikeTrack = useCallback((t: Track) => {
    setPlaylists(p => p.map(x => {
      if (x.id !== 'p1') return x;
      const liked = x.tracks.some(y => y.url === t.url);
      return { ...x, tracks: liked ? x.tracks.filter(y => y.url !== t.url) : [...x.tracks, t] };
    }));
  }, []);

  const addTrackToPlaylist = useCallback((pid: string, t: Track) => {
    setPlaylists(p => p.map(x => {
      if (x.id !== pid) return x;
      if (x.tracks.some(y => y.url === t.url)) { showToast('Already in playlist'); return x; }
      showToast(`Added to ${x.name}`); return { ...x, tracks: [...x.tracks, t] };
    }));
    setAddToPlaylistTrack(null); setCtxMenu(null);
  }, [showToast]);

  const removeFromPlaylist = useCallback((pid: string, url: string) => {
    setPlaylists(p => p.map(x => x.id !== pid ? x : { ...x, tracks: x.tracks.filter(t => t.url !== url) }));
    showToast('Removed from playlist');
  }, [showToast]);

  const handleCoverUpload = useCallback((pid: string) => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = e => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      const r = new FileReader();
      r.onload = ev => { const d = ev.target?.result as string; if (d) { setPlaylists(p => p.map(x => x.id === pid ? { ...x, customCover: d } : x)); showToast('Cover updated'); } };
      r.readAsDataURL(f);
    };
    inp.click();
  }, [showToast]);

  const isTrackLiked = useCallback((url: string) => playlists.find(p => p.id === 'p1')?.tracks.some(t => t.url === url) || false, [playlists]);
  const getPlaylistCover = (p: Playlist) => p.customCover || p.tracks[0]?.cover || null;

  const playAll = useCallback((list: Track[]) => {
    if (!list.length) return;
    const sorted = shuffle ? [...list].sort(() => Math.random() - 0.5) : [...list];
    // Set playlist context so skip fwd/back works without a queue
    playlistContextRef.current = { tracks: sorted, index: 0 };
    handlePlayTrack(sorted[0], true); setQueue(sorted.slice(1));
    showToast(shuffle ? 'Shuffle playing all' : 'Playing all');
  }, [shuffle, handlePlayTrack, showToast]);

  const removeFromQueue = useCallback((url: string) => setQueue(p => p.filter(q => q.url !== url)), []);

  const calculateProgressPercent = useCallback(() => {
    const total = trackDurationSeconds || parseDurationToSeconds(currentTrack?.duration || '0:00');
    return total === 0 ? 0 : Math.min((progressSeconds / total) * 100, 100);
  }, [progressSeconds, trackDurationSeconds, currentTrack]);

  const openPlaylist = playlists.find(p => p.id === openPlaylistId);

  // ── RENDER ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-full bg-[#050505] text-white font-sans overflow-hidden selection:bg-[#39FF14] selection:text-black">
      <style>{`
        @keyframes loadbar { 0%{transform:translateX(-100%)} 50%{transform:translateX(150%)} 100%{transform:translateX(400%)} }
        @keyframes dropIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        .slider-track:hover .slider-thumb{opacity:1!important;transform:translateY(-50%) scale(1.25)}
        .custom-scrollbar::-webkit-scrollbar{width:4px}
        .custom-scrollbar::-webkit-scrollbar-track{background:transparent}
        .custom-scrollbar::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
        .custom-scrollbar::-webkit-scrollbar-thumb:hover{background:#444}
        *{-webkit-user-select:none!important;user-select:none!important;}
        input,textarea{-webkit-user-select:text!important;user-select:text!important;}
      `}</style>

      <DepsBanner deps={deps} onGoToSettings={() => navigateTo('settings')} />

      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR ── */}
        <div className="w-64 bg-[#0a0a0a] border-r border-neutral-800/50 flex flex-col p-6 z-10 shrink-0 overflow-visible relative">
          {/* Logo + info hint */}
          <div className="flex items-center gap-2 mb-6 shrink-0">
            <div className="flex items-center gap-3 flex-1 cursor-pointer group" onClick={() => navigateTo('home')}>
              <div className="w-8 h-8 rounded bg-[#39FF14] flex items-center justify-center shadow-[0_0_15px_rgba(57,255,20,0.5)] group-hover:shadow-[0_0_25px_rgba(57,255,20,0.8)] transition-all duration-300 shrink-0">
                <Music size={20} className="text-black" />
              </div>
              <h1 className="text-2xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#39FF14] to-emerald-200 drop-shadow-[0_0_8px_rgba(57,255,20,0.6)]">VANGUARD</h1>
            </div>
            {/* Info hint — only when deps missing */}
            {deps && (!deps.mpv || !deps.yt_dlp || !deps.ffprobe) && (
            <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
              <div ref={infoHintBtnRef as React.RefObject<HTMLDivElement>} style={{ display: 'inline-block' }}>
                <InfoHintButton onClick={() => {
                  if (infoHintBtnRef.current) {
                    const r = infoHintBtnRef.current.getBoundingClientRect();
                    const boxW = 288; // w-72
                    // Right-align to button right edge, but keep on screen
                    const left = Math.min(r.right - boxW, window.innerWidth - boxW - 12);
                    setInfoHintPos({ top: r.bottom + 8, left: Math.max(8, left) });
                  }
                  setShowInfoHint(o => !o);
                }} />
              </div>
              {showInfoHint && infoHintPos && (
                <div className="fixed w-72 rounded-xl p-5 z-[99999]"
                  style={{
                    top: infoHintPos.top,
                    left: infoHintPos.left,
                    animation: 'dropIn 0.15s ease-out',
                    background: '#111111',
                    border: '1px solid rgba(245,158,11,0.35)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.95), 0 0 24px rgba(251,191,36,0.12)',
                    opacity: 1,
                  }}>
                  <p className="font-bold text-white mb-2 flex items-center gap-2 text-sm"><AlertTriangle size={15} className="text-amber-400" /> Getting Started</p>
                  <p className="text-xs text-neutral-300 leading-relaxed">Before using Vanguard, install the required dependencies:</p>
                  <p className="mt-2.5 text-[#39FF14] font-bold text-sm">Settings → Dependencies → Install</p>
                  <p className="mt-2 text-xs text-neutral-500">Requires: mpv · yt-dlp · ffprobe</p>
                  <button onClick={() => { navigateTo('settings'); setShowInfoHint(false); }}
                    className="mt-3 w-full py-2 bg-amber-500/15 border border-amber-500/30 text-amber-400 rounded-lg text-xs font-semibold hover:bg-amber-500/25 transition-colors">
                    Go to Settings →
                  </button>
                </div>
              )}
            </div>
            )}
          </div>

          {/* Sleep timer pill — always visible */}
          <div className="relative mb-4 shrink-0 overflow-visible" onClick={e => e.stopPropagation()}>
            <div
              onClick={() => setShowSleepPopover(o => !o)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all duration-200 border text-sm font-medium w-full
                ${sleepTimer > 0
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-neutral-900/60 border-neutral-800 text-neutral-500 hover:text-neutral-300 hover:border-neutral-700'}`}>
              <Moon size={14} className={sleepTimer > 0 ? 'animate-pulse text-amber-400' : ''} />
              <span className="flex-1">{sleepTimer > 0 ? `Sleep in ${Math.ceil(sleepTimer / 60)}m` : 'Sleep Timer'}</span>
              {sleepTimer > 0
                ? <button onClick={e => { e.stopPropagation(); cancelSleepTimer(); }} className="text-xs text-neutral-500 hover:text-red-400 px-1"><X size={11} /></button>
                : <ChevronDown size={13} className={`transition-transform ${showSleepPopover ? 'rotate-180' : ''}`} />}
            </div>
            {showSleepPopover && (
              <div className="absolute top-full left-0 mt-2 z-[9999]">
                <SleepTimerPopover
                  sleepTimer={sleepTimer}
                  onSet={setSleepTimerMinutes}
                  onCancel={cancelSleepTimer}
                  onClose={() => setShowSleepPopover(false)}
                />
              </div>
            )}
          </div>

          <nav className="flex flex-col gap-1 shrink-0">
            {([
              { id: 'home', label: 'Home', icon: Home },
              { id: 'downloads', label: 'Offline', icon: HardDrive },
              { id: 'stats', label: 'Stats', icon: BarChart2 },
              { id: 'settings', label: 'Settings', icon: Settings },
            ] as { id: string; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[]).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => navigateTo(id)}
                className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-200 w-full text-left
                  ${activeNav === id ? 'bg-neutral-800/50 text-[#39FF14] shadow-[inset_2px_0_0_#39FF14]' : 'text-neutral-400 hover:text-[#39FF14] hover:bg-neutral-900/50'}`}>
                <Icon size={20} className={activeNav === id ? 'drop-shadow-[0_0_5px_#39FF14]' : ''} />
                <span className="font-medium">{label}</span>
                {id === 'settings' && deps && (!deps.mpv || !deps.yt_dlp) && (
                  <span className="ml-auto w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                )}
              </button>
            ))}
            <button onClick={() => setIsQueueOpen(o => !o)}
              className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-200 w-full text-left
                ${isQueueOpen ? 'bg-neutral-800/50 text-[#39FF14] shadow-[inset_2px_0_0_#39FF14]' : 'text-neutral-400 hover:text-[#39FF14] hover:bg-neutral-900/50'}`}>
              <ListOrdered size={20} className={isQueueOpen ? 'drop-shadow-[0_0_5px_#39FF14]' : ''} />
              <span className="font-medium">Queue</span>
              {queue.length > 0 && <span className="ml-auto bg-[#39FF14] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{queue.length}</span>}
            </button>
          </nav>

          {/* Playlists */}
          <div className="mt-5 flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-1 mb-2 shrink-0">
              <button onClick={() => { setSidebarPlaylistsExpanded(o => !o); navigateTo('library'); setOpenPlaylistId(null); }}
                className={`flex items-center gap-3 flex-1 py-2 px-3 rounded-lg transition-all duration-200 text-left ${activeNav === 'library' ? 'text-[#39FF14]' : 'text-neutral-400 hover:text-[#39FF14] hover:bg-neutral-900/50'}`}>
                <ListMusic size={20} className={activeNav === 'library' ? 'drop-shadow-[0_0_5px_#39FF14]' : ''} />
                <span className="font-medium">Playlists</span>
                <ChevronRight size={14} className={`ml-auto transition-transform duration-200 ${sidebarPlaylistsExpanded ? 'rotate-90' : ''}`} />
              </button>
              <button onClick={e => { e.stopPropagation(); setNewPlaylistName(''); setNewPlaylistDesc(''); setIsPlaylistModalOpen(true); }}
                className="p-1.5 ml-1 text-neutral-600 hover:text-[#39FF14] transition-colors rounded-md hover:bg-neutral-900/50 shrink-0" title="New playlist">
                <PlusCircle size={15} />
              </button>
            </div>
            {sidebarPlaylistsExpanded && (
              <div className="flex-1 overflow-y-auto custom-scrollbar -mx-1 px-1">
                <div className="flex flex-col gap-0.5 pb-2">
                  {playlists.map(pl => {
                    const isOpen = openPlaylistId === pl.id && activeNav === 'library';
                    const cover = getPlaylistCover(pl);
                    return (
                      <button key={pl.id}
                        onClick={() => { setOpenPlaylistId(pl.id); navigateTo('library'); }}
                        onContextMenu={e => openCtx(e, { type: 'sidebar-playlist', playlist: pl })}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 w-full text-left group
                          ${isOpen ? 'bg-[#39FF14]/[0.08] text-[#39FF14] border border-[#39FF14]/15' : 'text-neutral-500 hover:text-neutral-200 hover:bg-neutral-900/50 border border-transparent'}`}>
                        <div className="w-7 h-7 rounded-md overflow-hidden shrink-0 border border-neutral-800/60">
                          {cover ? <img src={cover} className="w-full h-full object-cover" alt="" />
                            : <div className={`w-full h-full flex items-center justify-center ${isOpen ? 'bg-[#39FF14]/15' : 'bg-neutral-800/60'}`}>
                                {pl.id === 'p1' ? <Heart size={12} className={isOpen ? 'text-[#39FF14] fill-[#39FF14]' : 'text-neutral-500 group-hover:text-red-400'} /> : <ListMusic size={12} className={isOpen ? 'text-[#39FF14]' : 'text-neutral-500'} />}
                              </div>}
                        </div>
                        <span className="text-[13px] font-medium truncate flex-1">{pl.name}</span>
                        {pl.tracks.length > 0 && <span className={`text-[10px] font-bold tabular-nums shrink-0 ${isOpen ? 'text-[#39FF14]/70' : 'text-neutral-700 group-hover:text-neutral-500'}`}>{pl.tracks.length}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 shrink-0 flex flex-col gap-2">
            <button onClick={() => setShowCsvImportModal(true)} className="w-full relative group overflow-hidden rounded-lg bg-transparent border border-[#39FF14]/50 py-2.5 px-4 flex items-center justify-center gap-2 transition-all duration-300 hover:border-[#39FF14] hover:shadow-[0_0_20px_rgba(57,255,20,0.3)]">
              <div className="absolute inset-0 bg-[#39FF14]/0 group-hover:bg-[#39FF14]/5 transition-all duration-300 rounded-lg" />
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#1DB954" className="relative z-10"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              <span className="text-sm font-semibold text-[#39FF14] relative z-10">Import from Spotify</span>
            </button>
            <button onClick={() => setShowYtImportModal(true)} className="w-full relative group overflow-hidden rounded-lg bg-transparent border border-red-500/40 py-2.5 px-4 flex items-center justify-center gap-2 transition-all duration-300 hover:border-red-500 hover:shadow-[0_0_20px_rgba(239,68,68,0.3)]">
              <div className="absolute inset-0 bg-red-500/0 group-hover:bg-red-500/5 transition-all duration-300 rounded-lg" />
              <svg width="15" height="12" viewBox="0 0 18 14" fill="#ef4444" className="relative z-10"><path d="M17.6 2.2C17.4 1.4 16.8.8 16 .6 14.6.2 9 .2 9 .2S3.4.2 2 .6C1.2.8.6 1.4.4 2.2 0 3.6 0 6.5 0 6.5s0 2.9.4 4.3c.2.8.8 1.4 1.6 1.6C3.4 12.8 9 12.8 9 12.8s5.6 0 7-.4c.8-.2 1.4-.8 1.6-1.6.4-1.4.4-4.3.4-4.3s0-2.9-.4-4.3zM7.2 9.3V3.7l4.7 2.8-4.7 2.8z"/></svg>
              <span className="text-sm font-semibold text-red-400 relative z-10 group-hover:text-red-300">Import from YouTube</span>
            </button>
          </div>
        </div>

        {/* ── CENTER ── */}
        <div className="flex-1 flex flex-col bg-gradient-to-b from-[#0f1115] to-[#050505] overflow-hidden relative">
          <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#39FF14]/10 via-transparent to-transparent" />

          {/* ── BACK BUTTON — always visible ── */}
          <div className="flex items-center gap-3 px-6 pt-4 pb-0 shrink-0 z-20 relative">
            <button
              onClick={navigateBack}
              disabled={activeNav === 'home'}
              title="Go back to Home"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all duration-200
                ${activeNav !== 'home'
                  ? 'text-white border-neutral-700 bg-neutral-900/80 hover:border-[#39FF14]/50 hover:text-[#39FF14] hover:bg-[#39FF14]/5 active:scale-95'
                  : 'text-neutral-700 border-neutral-800/40 bg-neutral-900/30 cursor-not-allowed opacity-40'}`}
            >
              <ChevronLeft size={16} />
              <span>Back</span>
            </button>
            {/* Breadcrumb */}
            <span className="text-xs text-neutral-600 font-medium uppercase tracking-widest">
              {activeNav === 'home' ? 'Home' : activeNav === 'downloads' ? 'Offline' : activeNav === 'settings' ? 'Settings' : activeNav === 'library' ? (openPlaylistId ? playlists.find(p => p.id === openPlaylistId)?.name || 'Playlist' : 'Playlists') : activeNav}
            </span>
          </div>

          {/* ── HOME ── */}
          {activeNav === 'home' && (
            <>
              <div className="p-6 pb-3 relative z-30 shrink-0">
                <div className="relative w-full flex gap-3" onClick={e => e.stopPropagation()}>
                  <div className="relative flex-1">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      {isSearching
                        ? <div className="w-4 h-4 border-2 border-[#39FF14]/70 border-t-transparent rounded-full animate-spin" />
                        : <Search size={18} className={`transition-colors duration-200 ${showHistory || searchQuery ? 'text-[#39FF14]' : 'text-neutral-500'}`} />}
                    </div>
                    <input ref={searchRef} type="text"
                      placeholder="Search YouTube... (Ctrl+F)"
                      value={searchQuery} readOnly={isSearching}
                      onChange={e => setSearchQuery(e.target.value)}
                      onFocus={() => !isSearching && setShowHistory(searchHistory.length > 0)}
                      onKeyDown={e => { if (e.key === 'Enter') { setShowHistory(false); searchMusic(); } if (e.key === 'Escape') setShowHistory(false); }}
                      className={`w-full bg-[#111] border text-white rounded-xl py-3 pl-11 pr-4 focus:outline-none transition-all duration-200 placeholder-neutral-600 font-medium text-sm
                        ${isSearching ? 'border-[#39FF14]/40 ring-1 ring-[#39FF14]/30 opacity-60 cursor-not-allowed' : 'border-neutral-800 focus:border-[#39FF14] focus:ring-1 focus:ring-[#39FF14] focus:shadow-[0_0_20px_rgba(57,255,20,0.1)]'}`} />
                    {showHistory && (
                      <div className="absolute top-full left-0 right-0 mt-2 bg-[#0e0e0e] border border-neutral-800/80 rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-[100]">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/50">
                          <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-600">Recent searches</span>
                          <button onClick={e => { e.stopPropagation(); setSearchHistory([]); setShowHistory(false); }} className="text-[11px] text-neutral-600 hover:text-red-400 transition-colors px-1">Clear</button>
                        </div>
                        {searchHistory.map((h, i) => (
                          <button key={i} onClick={e => { e.stopPropagation(); setSearchQuery(h); setShowHistory(false); searchMusic(h); }}
                            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors text-left">
                            <Clock size={13} className="text-neutral-600 shrink-0" />
                            <span className="text-sm text-neutral-300 truncate flex-1">{h}</span>
                            <ChevronRight size={12} className="text-neutral-700 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setShowHistory(false); searchMusic(); }}
                    disabled={isSearching || !searchQuery.trim()}
                    className={`px-4 py-3 rounded-xl font-semibold text-sm transition-all duration-200 shrink-0 flex items-center gap-2
                      ${isSearching
                        ? 'bg-[#39FF14]/10 border border-[#39FF14]/30 text-[#39FF14]/60 cursor-not-allowed'
                        : 'bg-[#39FF14]/10 border border-[#39FF14]/30 text-[#39FF14] hover:bg-[#39FF14]/20 hover:border-[#39FF14]/60 disabled:opacity-30 disabled:cursor-not-allowed'}`}>
                    {isSearching ? <div className="w-4 h-4 border-2 border-[#39FF14]/70 border-t-transparent rounded-full animate-spin" /> : <Search size={16} />}
                    {!isSearching && 'Search'}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-4 z-10 custom-scrollbar" onClick={() => setShowHistory(false)}>
                {/* Empty state */}
                {!isSearching && tracks.length === 0 && quickPicks.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-5 text-neutral-700 select-none">
                    <div className="relative">
                      <Music size={56} strokeWidth={0.8} className="text-neutral-800" />
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-[#39FF14]/10 rounded-full flex items-center justify-center border border-[#39FF14]/20">
                        <Search size={10} className="text-[#39FF14]/40" />
                      </div>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-neutral-600">Nothing playing yet</p>
                      <p className="text-xs text-neutral-700 mt-1">Search for something above to get started.</p>
                    </div>
                  </div>
                )}

              {/* Quick picks */}
                {!isSearching && tracks.length === 0 && quickPicks.length > 0 && (
                  <div className="mb-6 pt-1">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-1.5 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
                      <h2 className="text-base font-bold text-white flex-1">Recently Played</h2>
                      <button onClick={() => { setQuickPicks([]); }} className="text-[11px] text-neutral-600 hover:text-neutral-400 transition-colors">Clear</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {quickPicks.slice(0, 8).map(track => {
                        const isActive = currentTrack?.url === track.url;
                        return (
                          <div key={track.url} onClick={() => handlePlayInContext(track, quickPicks.slice(0, 8))} onContextMenu={e => openCtx(e, { type: 'quickpick', track })}
                            className={`flex items-center gap-3 rounded-lg p-3 cursor-pointer transition-all duration-150 group border
                              ${isActive ? 'bg-[#39FF14]/[0.07] border-[#39FF14]/20' : 'bg-neutral-900/40 border-neutral-800/30 hover:bg-neutral-800/60 hover:border-neutral-700/50'}`}>
                            <div className="relative w-12 h-12 rounded-md overflow-hidden shrink-0">
                              <img src={track.cover} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
                              <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${isActive && isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                {isActive && isLoadingTrack ? <div className="w-4 h-4 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
                                  : isActive && isPlaying ? <div className="flex gap-[2px] items-end h-3">{[100, 65, 80].map((h, i) => <div key={i} className="w-[2px] bg-[#39FF14] rounded-full animate-pulse" style={{ height: `${h}%`, animationDelay: `${i * 150}ms` }} />)}</div>
                                  : <Play size={14} fill="white" className="text-white ml-0.5" />}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-semibold truncate ${isActive ? 'text-[#39FF14]' : 'text-white'}`}>{track.title}</p>
                              <p className="text-xs text-neutral-500 truncate mt-0.5">{track.artist}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Search results */}
                {(isSearching || tracks.length > 0) && (
                  <div className="flex items-center gap-3 mb-3 py-2">
                    <span className="w-1.5 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
                    <h2 className="text-base font-bold text-white flex-1">{isSearching ? 'Searching...' : 'Results'}</h2>
                    {isSearching && <div className="flex gap-1 items-end h-4">{[100, 60, 80, 50].map((h, i) => <div key={i} className="w-1 bg-[#39FF14]/60 rounded-full animate-pulse" style={{ height: `${h}%`, animationDelay: `${i * 100}ms` }} />)}</div>}
                    {tracks.length > 0 && !isSearching && (
                      <button onClick={() => playAll(tracks)} className="flex items-center gap-2 px-3 py-1.5 bg-[#39FF14]/10 border border-[#39FF14]/30 text-[#39FF14] rounded-lg text-xs font-semibold hover:bg-[#39FF14]/20 transition-colors">
                        <Play size={12} fill="currentColor" /> Play All
                      </button>
                    )}
                  </div>
                )}
                {(tracks.length > 0 || isSearching) && (
                  <div className="flex items-center gap-4 px-4 mb-1 border-b border-neutral-800/40 pb-2">
                    <div className="w-8 shrink-0" /><div className="w-12 shrink-0" />
                    <p className="flex-1 text-[11px] font-semibold uppercase tracking-widest text-neutral-600">Title</p>
                    <div className="w-20 shrink-0" />
                    <Clock size={12} className="text-neutral-600 w-12 shrink-0" />
                  </div>
                )}
                {isSearching && <div className="flex flex-col gap-1 mt-1">{Array.from({ length: 8 }).map((_, i) => <TrackRowSkeleton key={i} index={i} />)}</div>}
                {!isSearching && tracks.length > 0 && (
                  <div className="flex flex-col gap-1 mt-1">
                    {tracks.map((track, i) => (
                      <TrackRow key={track.id} track={track} index={i}
                        isActive={currentTrack?.url === track.url}
                        isHovered={hoveredTrackUrl === track.url}
                        isLoadingTrack={isLoadingTrack} isPlaying={isPlaying}
                        isLiked={isTrackLiked(track.url)} isDownloading={!!downloadingTracks[track.url]}
                        onPlay={() => handlePlayInContext(track, tracks)}
                        onHoverEnter={() => setHoveredTrackUrl(track.url)}
                        onHoverLeave={() => setHoveredTrackUrl(null)}
                        onLike={() => toggleLikeTrack(track)}
                        onDownload={() => handleDownload(track)}
                        onCtx={e => openCtx(e, { type: 'track', track })}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── DOWNLOADS ── */}
          {activeNav === 'downloads' && (
            <DownloadsPanel
              downloadPath={downloadPath} onPlayLocalTrack={handlePlayLocalTrack}
              onDeleteLocalTrack={handleDeleteLocalTrack} currentTrackPath={currentLocalPath}
              isPlaying={isPlaying} isLoadingTrack={isLoadingTrack}
              onOpenInFileManager={handleOpenInFileManager} onExportM3u={handleExportM3u}
              onChangeFolder={handleSelectDirectory}
            />
          )}

          {/* ── LIBRARY ── */}
          {activeNav === 'library' && (
            openPlaylist ? (
              <div className="flex-1 overflow-y-auto p-8 z-10 custom-scrollbar">
                <button onClick={() => setOpenPlaylistId(null)} className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors mb-8 group">
                  <ChevronLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
                  <span className="text-sm font-medium">Playlists</span>
                </button>
                <div className="flex items-end gap-6 mb-8">
                  <div className="w-28 h-28 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center shrink-0 relative group cursor-pointer overflow-hidden"
                    onClick={() => handleCoverUpload(openPlaylist.id)}>
                    {getPlaylistCover(openPlaylist)
                      ? <img src={getPlaylistCover(openPlaylist)!} className="w-full h-full object-cover" alt="" />
                      : openPlaylist.id === 'p1' ? <Heart size={48} className="text-red-400" /> : <ListMusic size={48} className="text-neutral-500" />}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><ImagePlus size={22} className="text-white" /></div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-1">Playlist</p>
                    <h2 className="text-3xl font-black text-white truncate">{openPlaylist.name}</h2>
                    {openPlaylist.description && <p className="text-sm text-neutral-500 mt-1 italic">{openPlaylist.description}</p>}
                    <p className="text-sm text-neutral-600 mt-1">{openPlaylist.tracks.length} tracks</p>
                    <div className="flex items-center gap-3 mt-4">
                      <button onClick={() => playAll(openPlaylist.tracks)} disabled={!openPlaylist.tracks.length}
                        className="flex items-center gap-2 px-5 py-2 bg-[#39FF14] text-black font-bold rounded-lg hover:shadow-[0_0_20px_#39FF14] transition-all disabled:opacity-40 text-sm">
                        <Play size={16} fill="currentColor" /> Play All
                      </button>
                      <button onClick={() => { setRenamingPlaylist(openPlaylist); setRenameVal(openPlaylist.name); setRenameDescVal(openPlaylist.description); }}
                        className="p-2 text-neutral-500 hover:text-white transition-colors rounded-lg hover:bg-white/5"><Pencil size={16} /></button>
                      {openPlaylist.id !== 'p1' && (
                        <button onClick={() => { deletePlaylist(openPlaylist.id); setOpenPlaylistId(null); }}
                          className="p-2 text-neutral-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"><Trash2 size={16} /></button>
                      )}
                    </div>
                  </div>
                </div>
                {openPlaylist.tracks.length === 0
                  ? <div className="flex flex-col items-center justify-center h-40 text-neutral-700 gap-3"><Music size={32} strokeWidth={1} /><p className="text-sm">No tracks yet.</p></div>
                  : <div className="flex flex-col gap-1">
                      {openPlaylist.tracks.map((t, i) => (
                        <div key={t.url}
                          className="relative group/row flex items-center gap-1"
                          onMouseEnter={() => { if (dragPlaylistIdx.current !== null) { dragOverPlaylistIdxRef.current = i; setDragOverPlaylistIdx(i); } }}>
                          {dragOverPlaylistIdx === i && dragPlaylistIdx.current !== null && dragPlaylistIdx.current !== i && (
                            <div className="absolute top-0 left-8 right-0 h-0.5 bg-[#39FF14] rounded-full z-10 shadow-[0_0_6px_#39FF14] pointer-events-none" />
                          )}
                          <div
                            className="px-1.5 py-4 cursor-grab flex items-center justify-center shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                            onMouseDown={e => {
                              e.preventDefault();
                              dragPlaylistIdx.current = i;
                              dragOverPlaylistIdxRef.current = i;
                              setDragOverPlaylistIdx(i);
                              const onUp = () => {
                                const from = dragPlaylistIdx.current;
                                const to = dragOverPlaylistIdxRef.current;
                                dragPlaylistIdx.current = null;
                                dragOverPlaylistIdxRef.current = null;
                                setDragOverPlaylistIdx(null);
                                window.removeEventListener('mouseup', onUp);
                                if (from === null || to === null || from === to) return;
                                setPlaylists(prev => prev.map(pl => {
                                  if (pl.id !== openPlaylist.id) return pl;
                                  const arr = [...pl.tracks];
                                  const [moved] = arr.splice(from, 1);
                                  arr.splice(to, 0, moved);
                                  return { ...pl, tracks: arr };
                                }));
                              };
                              window.addEventListener('mouseup', onUp);
                            }}>
                            <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" className="text-neutral-500">
                              <circle cx="3" cy="3" r="1.3"/><circle cx="7" cy="3" r="1.3"/>
                              <circle cx="3" cy="8" r="1.3"/><circle cx="7" cy="8" r="1.3"/>
                              <circle cx="3" cy="13" r="1.3"/><circle cx="7" cy="13" r="1.3"/>
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <TrackRow track={t} index={i} showRemove onRemove={() => removeFromPlaylist(openPlaylist.id, t.url)}
                              isActive={currentTrack?.url === t.url} isHovered={hoveredTrackUrl === t.url}
                              isLoadingTrack={isLoadingTrack} isPlaying={isPlaying}
                              isLiked={isTrackLiked(t.url)} isDownloading={!!downloadingTracks[t.url]}
                              onPlay={() => handlePlayInContext(t, openPlaylist.tracks)}
                              onHoverEnter={() => setHoveredTrackUrl(t.url)} onHoverLeave={() => setHoveredTrackUrl(null)}
                              onLike={() => toggleLikeTrack(t)} onDownload={() => handleDownload(t)}
                              onCtx={e => openCtx(e, { type: 'track', track: t })} />
                          </div>
                        </div>
                      ))}
                    </div>}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-8 z-10 custom-scrollbar">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-bold text-white flex items-center gap-3"><ListMusic className="text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]" size={32} /> Playlists</h2>
                  <button onClick={() => { setNewPlaylistName(''); setNewPlaylistDesc(''); setIsPlaylistModalOpen(true); }}
                    className="px-5 py-2.5 bg-transparent border border-[#39FF14]/50 text-[#39FF14] rounded-lg hover:bg-[#39FF14] hover:text-black transition-all duration-300 font-semibold flex items-center gap-2">
                    <ListMusic size={18} /> Create Playlist
                  </button>
                </div>
                <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(148px, 1fr))' }}>
                  {playlists.map((pl, plIdx) => {
                    const cover = getPlaylistCover(pl);
                    const isDragTarget = dragOverPlaylistCardIdx === plIdx && dragPlaylistCardIdx.current !== null && dragPlaylistCardIdx.current !== plIdx;
                    return (
                      <div key={pl.id}
                        onMouseEnter={() => { if (dragPlaylistCardIdx.current !== null) { dragOverPlaylistCardIdxRef.current = plIdx; setDragOverPlaylistCardIdx(plIdx); } }}
                        className={`group relative rounded-lg transition-all duration-200 p-2
                          ${isDragTarget
                            ? 'ring-2 ring-[#39FF14] ring-offset-1 ring-offset-[#050505] bg-[#39FF14]/[0.05]'
                            : 'hover:bg-white/[0.04]'}`}
                        onClick={() => { if (dragPlaylistCardIdx.current === null) setOpenPlaylistId(pl.id); }}
                        onContextMenu={e => openCtx(e, { type: 'playlist', playlist: pl })}>
                        <div
                          className="w-full aspect-square rounded-md overflow-hidden bg-neutral-900 flex items-center justify-center relative mb-2 shadow-md cursor-grab active:cursor-grabbing"
                          onMouseDown={e => {
                            e.preventDefault();
                            dragPlaylistCardIdx.current = plIdx;
                            dragOverPlaylistCardIdxRef.current = plIdx;
                            setDragOverPlaylistCardIdx(plIdx);
                            const onUp = () => {
                              const from = dragPlaylistCardIdx.current;
                              const to = dragOverPlaylistCardIdxRef.current;
                              dragPlaylistCardIdx.current = null;
                              dragOverPlaylistCardIdxRef.current = null;
                              setDragOverPlaylistCardIdx(null);
                              window.removeEventListener('mouseup', onUp);
                              if (from === null || to === null || from === to) return;
                              setPlaylists(prev => {
                                const arr = [...prev];
                                const [moved] = arr.splice(from, 1);
                                arr.splice(to, 0, moved);
                                return arr;
                              });
                            };
                            window.addEventListener('mouseup', onUp);
                          }}>
                          {cover
                            ? <img src={cover} className="w-full h-full object-cover" alt="" />
                            : pl.id === 'p1'
                              ? <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-red-900/60 to-neutral-900"><Heart size={28} className="text-red-400" /></div>
                              : <div className="w-full h-full flex items-center justify-center bg-neutral-800/60"><ListMusic size={28} className="text-neutral-600 group-hover:text-[#39FF14] transition-colors" /></div>}
                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                            <button onClick={e => { e.stopPropagation(); playAll(pl.tracks); }}
                              className="w-9 h-9 bg-[#39FF14] rounded-full flex items-center justify-center shadow-[0_4px_14px_rgba(57,255,20,0.5)] hover:scale-105 active:scale-95 transition-transform">
                              <Play size={15} fill="black" className="text-black ml-0.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[13px] font-semibold text-white group-hover:text-[#39FF14] transition-colors truncate leading-snug">{pl.name}</p>
                        <p className="text-[11px] text-neutral-600 mt-0.5 truncate">
                          {pl.description ? pl.description : `${pl.tracks.length} track${pl.tracks.length !== 1 ? 's' : ''}`}
                        </p>
                        {pl.id !== 'p1' && (
                          <button onClick={e => { e.stopPropagation(); deletePlaylist(pl.id); }}
                            className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 w-6 h-6 flex items-center justify-center bg-black/70 rounded-md hover:bg-red-500/40 hover:text-red-400 text-neutral-500 transition-all">
                            <Trash2 size={11} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )
          )}

          {/* ── SETTINGS ── */}
          {activeNav === 'stats' && (() => {
            const totalSecs = Object.values(listenSecs).reduce((s, n) => s + n, 0);
            const hrs = Math.floor(totalSecs / 3600);
            const mins = Math.floor((totalSecs % 3600) / 60);
            const secs = Math.floor(totalSecs % 60);
            const segments = hrs > 0
              ? [{ val: String(hrs).padStart(2,'0'), unit: 'h' }, { val: String(mins).padStart(2,'0'), unit: 'm' }, { val: String(secs).padStart(2,'0'), unit: 's' }]
              : [{ val: String(mins).padStart(2,'0'), unit: 'm' }, { val: String(secs).padStart(2,'0'), unit: 's' }];
            return (
              <div className="flex-1 flex flex-col items-center justify-center gap-8 relative overflow-hidden">
                {/* Ambient glow */}
                <div className="absolute inset-0 pointer-events-none" style={{
                  background: 'radial-gradient(ellipse 70% 50% at 50% 50%, rgba(57,255,20,0.06) 0%, transparent 65%)'
                }} />

                {/* Label */}
                <div className="relative z-10 flex items-center gap-3">
                  <div className="h-px w-8" style={{ background: 'linear-gradient(90deg, transparent, #39FF14)' }} />
                  <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/60">Time Listened</p>
                  <div className="h-px w-8" style={{ background: 'linear-gradient(90deg, #39FF14, transparent)' }} />
                </div>

                {/* Time display */}
                <div className="relative z-10 flex items-end gap-1">
                  {segments.map(({ val, unit }, idx) => (
                    <div key={unit} className="flex items-end gap-0.5">
                      {idx > 0 && <span className="text-3xl font-black mb-2 mx-0.5" style={{ color: 'rgba(57,255,20,0.3)' }}>:</span>}
                      <div className="flex flex-col items-center">
                        <span className="font-black text-white leading-none tabular-nums"
                          style={{ fontSize: '96px', letterSpacing: '-5px', textShadow: '0 0 60px rgba(57,255,20,0.4), 0 0 120px rgba(57,255,20,0.15)' }}>
                          {val}
                        </span>
                        <span className="text-[11px] font-bold uppercase tracking-widest mt-1" style={{ color: '#39FF14' }}>{unit === 'h' ? 'hrs' : unit === 'm' ? 'min' : 'sec'}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Divider */}
                <div className="relative z-10 flex flex-col items-center gap-3">
                  <div className="h-px w-48" style={{ background: 'linear-gradient(90deg, transparent, rgba(57,255,20,0.5), transparent)' }} />
                  {totalSecs === 0
                    ? <p className="text-xs font-medium tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>Play something to start tracking</p>
                    : <p className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>
                        {hrs > 0 ? `${hrs}h ${mins}m total` : `${mins} minutes total`}
                      </p>}
                </div>
              </div>
            );
          })()}

          {activeNav === 'settings' && (
            <SettingsPanel
              downloadQuality={downloadQuality} setDownloadQuality={setDownloadQuality}
              downloadPath={downloadPath} handleSelectDirectory={handleSelectDirectory}
              playbackSpeed={playbackSpeed} setPlaybackSpeed={setPlaybackSpeed}
              eq={eq} setEq={setEq}
              sleepTimer={sleepTimer} setSleepTimerMinutes={setSleepTimerMinutes} cancelSleepTimer={cancelSleepTimer}
              deps={deps} setDeps={setDeps} ytDlpVersion={ytDlpVersion} setYtDlpVersion={setYtDlpVersion}
              onUpdateYtDlp={handleUpdateYtDlp} isUpdatingYtDlp={isUpdatingYtDlp}
              onBackup={handleBackup} onRestore={handleRestore}
              backupPath={backupPath} setBackupPath={setBackupPath}
              cachePath={cachePath} setCachePath={setCachePath}
              crossfadeSeconds={crossfadeSeconds} setCrossfadeSeconds={setCrossfadeSeconds}
              showToast={showToast}
            />
          )}
        </div>

        {/* ── QUEUE PANEL ── */}
        <div className={`shrink-0 bg-[#0a0a0a] border-l border-neutral-800/50 flex flex-col transition-all duration-300 ease-in-out overflow-hidden ${isQueueOpen ? 'w-80' : 'w-0'}`}>
          {isQueueOpen && (
            <>
              <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/50 shrink-0">
                <div className="flex items-center gap-2.5">
                  <ListOrdered size={18} className="text-[#39FF14]" />
                  <h3 className="font-bold text-white text-[15px]">Queue</h3>
                  {queue.length > 0 && <span className="bg-[#39FF14] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{queue.length}</span>}
                </div>
                {queue.length > 0 && <button onClick={() => { setQueue([]); showToast('Queue cleared'); }} className="text-xs text-neutral-600 hover:text-red-400 transition-colors">Clear</button>}
              </div>
              {currentTrack && (
                <div className="px-4 py-3.5 border-b border-neutral-800/40 shrink-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 mb-3">Now Playing</p>
                  <div className="flex items-center gap-3 rounded-lg p-2.5 bg-[#39FF14]/[0.05] border border-[#39FF14]/15">
                    <div className="relative w-11 h-11 rounded-md overflow-hidden shrink-0 border border-[#39FF14]/30 bg-neutral-900 flex items-center justify-center">
                      {currentTrack.cover ? <img src={currentTrack.cover} className="w-full h-full object-cover" alt="" /> : <FileMusic size={18} className="text-neutral-500" />}
                      {!isLoadingTrack && isPlaying && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <div className="flex gap-[2px] items-end h-3.5">{[100, 60, 80].map((h, i) => <div key={i} className="w-[2.5px] bg-[#39FF14] rounded-full animate-pulse" style={{ height: `${h}%`, animationDelay: `${i * 150}ms` }} />)}</div>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-[#39FF14] truncate leading-snug">{currentTrack.title}</p>
                      <p className="text-xs text-neutral-500 truncate mt-0.5">{currentTrack.artist}</p>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {queue.length === 0
                  ? <div className="flex flex-col items-center justify-center h-40 text-neutral-700 gap-2"><ListOrdered size={26} strokeWidth={1} /><p className="text-sm">Queue is empty</p></div>
                  : <>
                      <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 px-5 pt-4 pb-2">Up Next</p>
                      {queue.map((track, i) => (
                        <div key={`${track.url}-${i}`}
                          className={`relative flex items-center gap-3 px-4 py-3 group transition-colors ${currentTrack?.url === track.url ? 'bg-[#39FF14]/[0.06]' : 'hover:bg-white/[0.04]'}`}
                          onMouseEnter={() => { if (dragQueueIdx.current !== null) { dragOverQueueIdxRef.current = i; setDragOverQueueIdx(i); } }}
                          onContextMenu={e => openCtx(e, { type: 'queue-track', track })}>
                          {dragOverQueueIdx === i && dragQueueIdx.current !== null && dragQueueIdx.current !== i && (
                            <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#39FF14] rounded-full z-10 shadow-[0_0_6px_#39FF14] pointer-events-none" />
                          )}
                          <div className="w-5 shrink-0 flex items-center justify-center"
                            onMouseDown={e => {
                              e.preventDefault();
                              dragQueueIdx.current = i;
                              dragOverQueueIdxRef.current = i;
                              setDragOverQueueIdx(i);
                              const onUp = () => {
                                const from = dragQueueIdx.current;
                                const to = dragOverQueueIdxRef.current;
                                dragQueueIdx.current = null;
                                dragOverQueueIdxRef.current = null;
                                setDragOverQueueIdx(null);
                                window.removeEventListener('mouseup', onUp);
                                if (from === null || to === null || from === to) return;
                                setQueue(prev => {
                                  const next = [...prev];
                                  const [moved] = next.splice(from, 1);
                                  next.splice(to, 0, moved);
                                  return next;
                                });
                              };
                              window.addEventListener('mouseup', onUp);
                            }}>
                            <span className="text-xs text-neutral-700 group-hover:hidden tabular-nums">{i + 1}</span>
                            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" className="text-neutral-600 hidden group-hover:block cursor-grab"><circle cx="3" cy="2.5" r="1.2"/><circle cx="7" cy="2.5" r="1.2"/><circle cx="3" cy="7" r="1.2"/><circle cx="7" cy="7" r="1.2"/><circle cx="3" cy="11.5" r="1.2"/><circle cx="7" cy="11.5" r="1.2"/></svg>
                          </div>
                          <img src={track.cover} className="w-10 h-10 rounded-md object-cover shrink-0 border border-neutral-800/60" alt="" onClick={() => { if (dragQueueIdx.current === null) { setQueue(prev => prev.filter((_, idx) => idx !== i)); handlePlayTrack(track, true); } }} />
                          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { if (dragQueueIdx.current === null) { setQueue(prev => prev.filter((_, idx) => idx !== i)); handlePlayTrack(track, true); } }}>
                            <p className={`text-sm font-semibold truncate leading-snug ${currentTrack?.url === track.url ? 'text-[#39FF14]' : 'text-white'}`}>{track.title}</p>
                            <p className="text-xs text-neutral-500 truncate mt-0.5">{track.artist}</p>
                          </div>
                          <button onClick={e => { e.stopPropagation(); removeFromQueue(track.url); }} className="opacity-0 group-hover:opacity-100 p-1.5 text-neutral-600 hover:text-red-400 transition-all shrink-0 rounded"><X size={13} /></button>
                        </div>
                      ))}
                    </>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── PLAYER BAR ── */}
      <div className="h-[88px] bg-[#0a0a0a] border-t border-neutral-800 flex items-center justify-between px-6 relative z-20 shadow-[0_-8px_40px_rgba(0,0,0,0.9)] shrink-0" style={{ backdropFilter: 'none' }}>
        {isPlaying && !isLoadingTrack && <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#39FF14]/50 to-transparent" />}
        {isLoadingTrack && (
          <div className="absolute top-0 left-0 w-full h-[2px] overflow-hidden bg-neutral-800/40">
            <div className="h-full bg-[#39FF14]/80 shadow-[0_0_6px_#39FF14]" style={{ animation: 'loadbar 1.4s ease-in-out infinite', width: '35%' }} />
          </div>
        )}

        {/* Left: track info */}
        <div className="flex items-center gap-4 w-1/4 min-w-[180px]">
          {currentTrack ? (
            <>
              <div className="relative w-14 h-14 rounded-md overflow-hidden group border border-neutral-800 shrink-0 cursor-pointer bg-neutral-900 flex items-center justify-center"
                onClick={() => { if (!currentTrack.url.startsWith('local://')) setInfoModalTrack(currentTrack); }}
                onContextMenu={e => { if (!currentTrack.url.startsWith('local://')) openCtx(e, { type: 'track', track: currentTrack }); }}>
                {currentTrack.cover
                  ? <img src={currentTrack.cover} alt={currentTrack.title} className={`w-full h-full object-cover transition-opacity ${isLoadingTrack ? 'opacity-40' : 'opacity-100'}`} />
                  : <FileMusic size={22} className="text-neutral-500" />}
                {isLoadingTrack ? <div className="absolute inset-0 flex items-center justify-center bg-black/30"><div className="w-5 h-5 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" /></div>
                  : !currentTrack.url.startsWith('local://') ? <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><Info size={16} className="text-white" /></div>
                  : null}
              </div>
              <div className="flex flex-col overflow-hidden max-w-[140px]">
                <span className="font-bold text-white text-sm truncate">{currentTrack.title}</span>
                {isLoadingTrack
                  ? <span className="text-xs text-[#39FF14]/70 flex items-center gap-1.5 mt-0.5">
                      <span className="flex gap-[3px] items-end h-3">{[1, 0.6, 0.8, 0.5].map((h, i) => <span key={i} className="w-[2px] bg-[#39FF14]/60 rounded-full animate-pulse inline-block" style={{ height: `${h * 100}%`, animationDelay: `${i * 120}ms` }} />)}</span>
                      Buffering...
                    </span>
                  : <span className="text-xs text-neutral-400 truncate">{currentTrack.artist}</span>}
                {audioInfo && !isLoadingTrack && (
                  <span className="text-[10px] text-neutral-600 truncate mt-0.5 font-mono">
                    {audioInfo.codec.toUpperCase()}{audioInfo.samplerate > 0 ? ` · ${Math.round(audioInfo.samplerate / 1000)}kHz` : ''}
                  </span>
                )}
              </div>
              {!currentTrack.url.startsWith('local://') && (
                <button onClick={() => toggleLikeTrack(currentTrack)} className="ml-1 p-1.5 focus:outline-none hover:scale-110 active:scale-95 transition-transform shrink-0">
                  <Heart size={18} className={isTrackLiked(currentTrack.url) ? 'text-[#39FF14] fill-[#39FF14] drop-shadow-[0_0_8px_rgba(57,255,20,0.6)]' : 'text-neutral-400 hover:text-white'} />
                </button>
              )}
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-md border border-neutral-800/50 bg-[#0d0d0d] flex items-center justify-center shrink-0"><Music size={20} className="text-neutral-600" /></div>
              <div className="flex flex-col overflow-hidden"><span className="font-bold text-neutral-600 text-sm">No track</span><span className="text-xs text-neutral-700">---</span></div>
            </>
          )}
        </div>

        {/* Center: controls + progress + speed */}
        <div className="flex flex-col items-center justify-center w-2/4 gap-2 max-w-2xl">
          <div className="flex items-center gap-5">
            <button onClick={toggleShuffle} className={`transition-all duration-200 ${shuffle ? 'text-[#39FF14] drop-shadow-[0_0_6px_#39FF14]' : 'text-neutral-600 hover:text-neutral-300'}`}><Shuffle size={18} /></button>
            <button onClick={handleSkipBack} className={`transition-all duration-200 ${currentTrack ? 'text-neutral-300 hover:text-[#39FF14]' : 'text-neutral-700 cursor-not-allowed'}`}><SkipBack size={22} /></button>
            <button onClick={togglePlayPause} disabled={!currentTrack || isLoadingTrack}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-white text-black hover:bg-[#39FF14] hover:shadow-[0_0_20px_#39FF14] hover:scale-105 transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-white disabled:hover:shadow-none">
              {isLoadingTrack ? <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                : isPlaying ? <Pause fill="currentColor" size={22} />
                : <Play fill="currentColor" size={22} className="ml-0.5" />}
            </button>
            <button onClick={handleSkipForward} className={`transition-all duration-200 ${(queue.length > 0 || playlistContextRef.current !== null || (currentTrack?.url?.startsWith('local://') && localTracksListRef.current.length > 1)) ? 'text-neutral-300 hover:text-[#39FF14]' : 'text-neutral-700 cursor-not-allowed'}`}><SkipForward size={22} /></button>
            <button onClick={cycleRepeat} className={`transition-all duration-200 ${repeatMode !== 'off' ? 'text-[#39FF14] drop-shadow-[0_0_6px_#39FF14]' : 'text-neutral-600 hover:text-neutral-300'}`}>
              {repeatMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          {/* Progress row + speed selector */}
          <div className="w-full flex items-center gap-2 mt-1">
            {/* Speed selector — left of time */}
            <SpeedSelector speed={playbackSpeed} onChange={setPlaybackSpeed} />
            {/* A-B Loop button */}
            <button
              title={abLoop.a === null ? 'Set A point' : abLoop.b === null ? 'Set B point' : 'Clear A-B loop'}
              onClick={() => {
                if (abLoop.a === null) {
                  const a = progressSecondsRef.current;
                  setAbLoop({ a, b: null }); abLoopRef.current = { a, b: null };
                  showToast(`A: ${formatTime(a)}`);
                } else if (abLoop.b === null) {
                  const b = progressSecondsRef.current;
                  if (b > (abLoop.a ?? 0) + 1) {
                    setAbLoop(prev => ({ ...prev, b })); abLoopRef.current = { ...abLoopRef.current, b };
                    showToast(`Loop: ${formatTime(abLoop.a!)} → ${formatTime(b)}`);
                  } else { showToast('B must be after A'); }
                } else {
                  setAbLoop({ a: null, b: null }); abLoopRef.current = { a: null, b: null };
                  showToast('A-B loop cleared');
                }
              }}
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                abLoop.b !== null ? 'text-[#39FF14] bg-[#39FF14]/15 border border-[#39FF14]/30' :
                abLoop.a !== null ? 'text-amber-400 bg-amber-400/15 border border-amber-400/30' :
                'text-neutral-700 hover:text-neutral-400 border border-neutral-800'}`}>
              {abLoop.b !== null ? 'A-B✓' : abLoop.a !== null ? 'A-…' : 'A-B'}
            </button>
            <span className="text-xs font-medium text-neutral-400 tabular-nums min-w-[32px] text-right">
              {currentTrack ? formatTime(progressSeconds) : '0:00'}
            </span>
            <div ref={progressRef}
              className="slider-track relative flex-1 h-1 bg-neutral-800 rounded-full cursor-pointer hover:h-1.5 transition-[height] duration-150 ease-out"
              onMouseDown={e => { isDraggingProgressRef.current = true; setIsDraggingProgress(true); updateProgressFromEvent(e.clientX); }}>
              {waveformData.length > 0 && <WaveformBar waveform={waveformData} progressPercent={calculateProgressPercent()} isDragging={isDraggingProgress} />}
              <div className="absolute top-0 left-0 h-full bg-[#39FF14] rounded-full shadow-[0_0_6px_rgba(57,255,20,0.5)] pointer-events-none"
                style={{ width: `${calculateProgressPercent()}%`, transition: isDraggingProgress ? 'none' : 'width 0.5s linear' }}>
                <div className="slider-thumb absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-[0_0_6px_rgba(255,255,255,0.8)] opacity-0 pointer-events-none" />
              </div>
            </div>
            <span className="text-xs font-medium text-neutral-400 tabular-nums min-w-[32px]">
              {currentTrack ? formatTime(trackDurationSeconds || parseDurationToSeconds(currentTrack.duration)) : '0:00'}
            </span>
          </div>
        </div>

        {/* Right: crossfade + volume */}
        <div className="w-1/4 flex items-center justify-end gap-3 pr-4">
          {/* Crossfade indicator */}
          {/* Bookmark button */}
          {currentTrack && (
            <button
              onClick={() => {
                if (bookmarks[currentTrack.url] !== undefined) {
                  setBookmarks(prev => { const n = {...prev}; delete n[currentTrack.url]; return n; });
                  showToast('Bookmark removed');
                } else {
                  setBookmarks(prev => ({ ...prev, [currentTrack.url]: progressSeconds }));
                  const m = Math.floor(progressSeconds / 60);
                  const s = Math.floor(progressSeconds % 60).toString().padStart(2, '0');
                  showToast(`Bookmarked at ${m}:${s}`);
                }
              }}
              title={bookmarks[currentTrack.url] !== undefined ? `Bookmarked at ${Math.floor(bookmarks[currentTrack.url]/60)}:${Math.floor(bookmarks[currentTrack.url]%60).toString().padStart(2,'0')} — click to remove` : 'Bookmark current position'}
              className={`transition-colors ${bookmarks[currentTrack.url] !== undefined ? 'text-amber-400' : 'text-neutral-700 hover:text-neutral-400'}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
            </button>
          )}
          {crossfadeSeconds > 0 && (
            <span className="text-[10px] text-purple-400 font-bold tabular-nums" title={`Crossfade: ${crossfadeSeconds}s`}>
              ×{crossfadeSeconds}s
            </span>
          )}
          <button onClick={toggleMute} className="focus:outline-none shrink-0">
            {volume === 0 ? <VolumeX size={18} className="text-red-500" /> : <Volume2 size={18} className="text-neutral-400 hover:text-white transition-colors" />}
          </button>
          <div ref={volumeRef}
            className="slider-track relative w-24 h-1 bg-neutral-800 rounded-full cursor-pointer hover:h-1.5 transition-[height] duration-150 ease-out"
            onMouseDown={e => { setIsDraggingVolume(true); updateVolumeFromEvent(e.clientX); }}>
            <div className="absolute top-0 left-0 h-full rounded-full pointer-events-none"
              style={{ width: `${volume}%`, background: volume > 0 ? '#39FF14' : '#404040', boxShadow: volume > 0 ? '0 0 5px rgba(57,255,20,0.45)' : 'none', transition: isDraggingVolume ? 'none' : 'width 0.15s ease-out' }}>
              <div className="slider-thumb absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* ── CONTEXT MENU ── */}
      {ctxMenu && (() => {
        const { track, playlist } = ctxMenu;
        if ((ctxMenu.type === 'track' || ctxMenu.type === 'quickpick' || ctxMenu.type === 'queue-track') && track) {
          return (
            <div className="fixed z-50 bg-[#0a0a0a] border border-neutral-800 rounded-xl shadow-2xl py-2 w-64 text-sm font-medium text-neutral-300"
              style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={e => e.stopPropagation()}>
              <div className="px-4 py-3 border-b border-neutral-800 mb-1 flex items-center gap-3">
                <img src={track.cover} className="w-10 h-10 rounded-md object-cover shrink-0" alt="" />
                <div className="flex flex-col overflow-hidden">
                  <span className="text-white truncate font-bold text-[13px]">{track.title}</span>
                  <span className="text-xs text-neutral-500 truncate">{track.artist}</span>
                </div>
              </div>
              <button onClick={() => { handlePlayTrack(track); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><Play size={15} /> Play Now</button>
              <button onClick={() => { setQueue(p => [track, ...p]); showToast('Playing next'); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><PlaySquare size={15} /> Play Next</button>
              <button onClick={() => { setQueue(p => [...p, track]); showToast('Added to queue'); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><ListPlus size={15} /> Add to Queue</button>
              <button onClick={() => { toggleLikeTrack(track); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors">
                <Heart size={15} className={isTrackLiked(track.url) ? 'text-[#39FF14] fill-[#39FF14]' : ''} />
                {isTrackLiked(track.url) ? 'Remove from Liked' : 'Add to Liked Songs'}
              </button>
              <button onClick={e => { e.stopPropagation(); setAddToPlaylistTrack(track); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><PlusCircle size={15} /> Add to Playlist</button>
              {ctxMenu.type === 'queue-track' && (
                <button onClick={() => { removeFromQueue(track.url); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-500/20 hover:text-red-400 transition-colors"><X size={15} /> Remove from Queue</button>
              )}
              <div className="h-px bg-neutral-800 my-1" />
              <button onClick={() => { setInfoModalTrack(track); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><Info size={15} /> Track Info</button>
              <button onClick={() => { copyToClipboard(track.url); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><Share2 size={15} /> Copy Link</button>
              <button onClick={() => { handleDownload(track); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors">
                {downloadingTracks[track.url] ? <div className="w-4 h-4 rounded-full border-2 border-[#39FF14] border-t-transparent animate-spin" /> : <Download size={15} />}
                Download MP3
              </button>
              <button onClick={() => { openInYouTube(track.url); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><ExternalLink size={15} /> Open in YouTube</button>
            </div>
          );
        }
        if ((ctxMenu.type === 'playlist' || ctxMenu.type === 'sidebar-playlist') && playlist) {
          return (
            <div className="fixed z-50 bg-[#0a0a0a] border border-neutral-800 rounded-xl shadow-2xl py-2 w-56 text-sm font-medium text-neutral-300"
              style={{ top: ctxMenu.y, left: ctxMenu.x }} onClick={e => e.stopPropagation()}>
              <div className="px-4 py-2.5 border-b border-neutral-800 mb-1">
                <span className="text-white font-bold text-[13px] truncate block">{playlist.name}</span>
                <span className="text-xs text-neutral-600">{playlist.tracks.length} tracks</span>
              </div>
              <button onClick={() => { playAll(playlist.tracks); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><Play size={15} /> Play All</button>
              <button onClick={() => { const s = [...playlist.tracks].sort(() => Math.random() - 0.5); if (s.length) { handlePlayTrack(s[0]); setQueue(s.slice(1)); } setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><Shuffle size={15} /> Shuffle Play</button>
              <button onClick={() => { setQueue(p => [...p, ...playlist.tracks]); showToast(`Added ${playlist.tracks.length} tracks`); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><ListPlus size={15} /> Add to Queue</button>
              <div className="h-px bg-neutral-800 my-1" />
              <button onClick={() => { setRenamingPlaylist(playlist); setRenameVal(playlist.name); setRenameDescVal(playlist.description); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><Pencil size={15} /> Edit</button>
              <button onClick={() => { setShowDuplicatesPlaylist(playlist); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><Copy size={15} /> Find Duplicates</button>
              <button onClick={() => { setBulkEditPlaylist(playlist); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><Pencil size={15} /> Bulk Edit Tags</button>
              <button onClick={() => { handleCoverUpload(playlist.id); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><ImagePlus size={15} /> Change Cover</button>
              {playlist.id !== 'p1' && <button onClick={() => { deletePlaylist(playlist.id); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-500/20 hover:text-red-400 transition-colors"><Trash2 size={15} /> Delete</button>}
            </div>
          );
        }
        return null;
      })()}

      {/* ── ADD TO PLAYLIST MODAL ── */}
      {addToPlaylistTrack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setAddToPlaylistTrack(null)}>
          <div className="bg-[#111] border border-neutral-800 rounded-xl w-80 overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
              <h3 className="font-bold text-white">Add to Playlist</h3>
              <button onClick={() => setAddToPlaylistTrack(null)} className="text-neutral-500 hover:text-white transition-colors"><X size={18} /></button>
            </div>
            <div className="py-2 max-h-64 overflow-y-auto custom-scrollbar">
              {playlists.map(p => (
                <button key={p.id} onClick={() => addTrackToPlaylist(p.id, addToPlaylistTrack)}
                  className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors text-left">
                  {p.id === 'p1' ? <Heart size={16} className="text-red-400 shrink-0" /> : <ListMusic size={16} className="text-neutral-500 shrink-0" />}
                  <span className="text-sm text-white truncate">{p.name}</span>
                  <span className="ml-auto text-xs text-neutral-600">{p.tracks.length}</span>
                </button>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-neutral-800">
              <button onClick={() => { setAddToPlaylistTrack(null); setNewPlaylistName(''); setNewPlaylistDesc(''); setIsPlaylistModalOpen(true); }}
                className="flex items-center gap-2 text-[#39FF14] text-sm font-medium hover:underline">
                <PlusCircle size={14} /> New Playlist
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── INFO MODAL ── */}
      {infoModalTrack && (() => {
        const ytId = infoModalTrack.url?.match(/[?&]v=([^&]+)/)?.[1] || infoModalTrack.url?.split('youtu.be/')?.[1]?.split('?')?.[0] || '';
        const ytUrl = ytId ? `https://youtube.com/watch?v=${ytId}` : infoModalTrack.url;
        const isYt = !!ytId;
        const trackAudioInfo = infoModalTrack.url === currentTrack?.url ? audioInfo : null;
        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(20px)' }}
            onClick={() => setInfoModalTrack(null)}>
            <div className="rounded-2xl w-full max-w-[420px] overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.9)] flex flex-col"
              style={{ background: '#0c0c0c', border: '1px solid rgba(255,255,255,0.08)' }}
              onClick={e => e.stopPropagation()}>

              {/* Cover hero */}
              <div className="relative h-44 w-full shrink-0 overflow-hidden">
                <img src={infoModalTrack.cover} className="w-full h-full object-cover opacity-30" style={{ filter: 'blur(20px)', transform: 'scale(1.1)' }} alt="" />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0c0c0c]" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <img src={infoModalTrack.cover} className="h-28 w-28 rounded-xl shadow-2xl object-cover border border-white/10" alt="" />
                </div>
                <button onClick={() => setInfoModalTrack(null)}
                  className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-black/70 text-neutral-400 hover:text-white hover:bg-black transition-colors">
                  <X size={14} />
                </button>
              </div>

              {/* Track title + artist */}
              <div className="px-6 pt-3 pb-4 text-center">
                <p className="text-base font-bold text-white leading-snug">{infoModalTrack.title}</p>
                <p className="text-sm text-neutral-500 mt-0.5">{infoModalTrack.artist}</p>
              </div>

              {/* Pills row */}
              <div className="flex gap-2 px-6 pb-4 flex-wrap justify-center">
                {infoModalTrack.duration && infoModalTrack.duration !== '0:00' && (
                  <span className="bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-full text-xs font-bold text-cyan-400 flex items-center gap-1.5">
                    <Clock size={10} /> {infoModalTrack.duration}
                  </span>
                )}
                {isYt && (
                  <span className="bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-full text-xs font-bold text-red-500 flex items-center gap-1.5">
                    <Youtube size={10} /> YouTube
                  </span>
                )}
                {trackAudioInfo && trackAudioInfo.codec && trackAudioInfo.codec !== 'unknown' && (
                  <span className="bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-full text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <BarChart2 size={10} /> {trackAudioInfo.codec.toUpperCase()}
                    {trackAudioInfo.bitrate > 0 ? ` ${Math.round(trackAudioInfo.bitrate / 1000)}kbps` : ''}
                  </span>
                )}
                {trackAudioInfo && trackAudioInfo.samplerate > 0 && (
                  <span className="bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-full text-xs font-bold text-violet-400 flex items-center gap-1.5">
                    <Gauge size={10} /> {(trackAudioInfo.samplerate / 1000).toFixed(1)}kHz
                  </span>
                )}
                {trackAudioInfo && trackAudioInfo.channels && (
                  <span className="bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-full text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <AlignLeft size={10} /> {trackAudioInfo.channels}
                  </span>
                )}
                {trackAudioInfo && trackAudioInfo.format && (
                  <span className="bg-neutral-900 border border-neutral-800 px-2.5 py-1 rounded-full text-xs font-bold text-neutral-400 flex items-center gap-1.5">
                    <FileCode2 size={10} /> {trackAudioInfo.format}
                  </span>
                )}
              </div>

              {/* Info rows */}
              <div className="mx-6 mb-4 rounded-xl overflow-hidden border border-neutral-800/60 divide-y divide-neutral-800/60">
                {[
                  { icon: Music, label: 'Title', value: infoModalTrack.title, color: 'text-blue-400', bg: 'bg-blue-500/10' },
                  { icon: FileBadge2, label: 'Artist', value: infoModalTrack.artist, color: 'text-purple-400', bg: 'bg-purple-500/10' },
                  ...(ytId ? [{ icon: Hash, label: 'Video ID', value: ytId, color: 'text-neutral-400', bg: 'bg-neutral-800/50' }] : []),
                ].map(({ icon: Icon, label, value, color, bg }) => (
                  <div key={label}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] cursor-pointer transition-colors group"
                    onClick={() => copyToClipboard(value)}
                    title={`Click to copy ${label}`}>
                    <div className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center ${color} shrink-0`}><Icon size={15} /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-neutral-600 uppercase tracking-wider font-semibold">{label}</p>
                      <p className="text-sm font-semibold text-white truncate leading-snug">{value || '—'}</p>
                    </div>
                    <Copy size={12} className="text-neutral-700 group-hover:text-neutral-400 shrink-0 transition-colors" />
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div className="px-6 pb-5 flex flex-col gap-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <CopyButton text={ytId || ''} label="Copy ID" icon={Copy} disabled={!ytId} />
                  <CopyButton text={ytUrl} label="Copy Link" icon={Share2} />
                </div>
                <button
                  onClick={() => { openInYouTube(ytUrl); }}
                  disabled={!ytUrl}
                  className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all hover:shadow-[0_0_20px_rgba(239,68,68,0.3)] active:scale-[0.98] disabled:opacity-30"
                  style={{ background: 'rgb(220,38,38)', color: 'white' }}>
                  <svg width="14" height="11" viewBox="0 0 18 14" fill="white"><path d="M17.6 2.2C17.4 1.4 16.8.8 16 .6 14.6.2 9 .2 9 .2S3.4.2 2 .6C1.2.8.6 1.4.4 2.2 0 3.6 0 6.5 0 6.5s0 2.9.4 4.3c.2.8.8 1.4 1.6 1.6C3.4 12.8 9 12.8 9 12.8s5.6 0 7-.4c.8-.2 1.4-.8 1.6-1.6.4-1.4.4-4.3.4-4.3s0-2.9-.4-4.3zM7.2 9.3V3.7l4.7 2.8-4.7 2.8z"/></svg>
                  Open in YouTube
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── DUPLICATE FINDER MODAL ── */}
      {showYtImportModal && (
        <YtImportModal
          onClose={() => setShowYtImportModal(false)}
          onSavePlaylist={(name, desc, tracks) => {
            const id = `yt_${Date.now()}`;
            setPlaylists(prev => [...prev, { id, name, description: desc || 'Imported from YouTube', tracks }]);
            showToast(`"${name}" saved — ${tracks.length} tracks`);
          }}
          showToast={showToast}
        />
      )}
      {showCsvImportModal && (
        <CsvImportModal
          onClose={() => setShowCsvImportModal(false)}
          onSavePlaylist={(name, desc, tracks) => {
            const id = `csv_${Date.now()}`;
            setPlaylists(prev => [...prev, { id, name, description: desc || 'Imported from Spotify', tracks }]);
            showToast(`"${name}" saved — ${tracks.length} tracks`);
          }}
          showToast={showToast}
        />
      )}
      {showDuplicatesPlaylist && (() => {
        const seen = new Map<string, Track>();
        const dupes: Track[] = [];
        showDuplicatesPlaylist.tracks.forEach(t => {
          const key = `${t.title.toLowerCase().trim()}|||${t.artist.toLowerCase().trim()}`;
          if (seen.has(key)) dupes.push(t);
          else seen.set(key, t);
        });
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}>
            <div className="bg-[#0d0d0d] border border-neutral-800 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
              <div className="p-5 border-b border-neutral-800 flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-white">Duplicate Finder</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">{showDuplicatesPlaylist.name}</p>
                </div>
                <button onClick={() => setShowDuplicatesPlaylist(null)} className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"><X size={16} /></button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                {dupes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-neutral-600">
                    <CheckCircle size={32} className="mb-2 text-[#39FF14]" />
                    <p className="text-sm text-white">No duplicates found.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-amber-400 mb-3">{dupes.length} duplicate{dupes.length > 1 ? 's' : ''} found</p>
                    {dupes.map((t, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-neutral-900/60 border border-amber-500/20">
                        <img src={t.cover} className="w-10 h-10 rounded-md object-cover shrink-0" alt="" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{t.title}</p>
                          <p className="text-xs text-neutral-500 truncate">{t.artist}</p>
                        </div>
                        <button onClick={() => {
                          setPlaylists(prev => prev.map(p => p.id === showDuplicatesPlaylist.id
                            ? { ...p, tracks: (() => { let removed = false; return p.tracks.filter(x => { if (!removed && x.url === t.url) { removed = true; return false; } return true; }); })() }
                            : p));
                          setShowDuplicatesPlaylist(prev => prev ? { ...prev, tracks: (() => { let removed = false; return prev.tracks.filter(x => { if (!removed && x.url === t.url) { removed = true; return false; } return true; }); })() } : null);
                          showToast('Duplicate removed');
                        }} className="text-xs px-3 py-1.5 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors shrink-0">Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── BULK TAG EDITOR MODAL ── */}
      {bulkEditPlaylist && (() => {
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}>
            <div className="bg-[#0d0d0d] border border-neutral-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl">
              <div className="p-5 border-b border-neutral-800 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="font-bold text-white">Bulk Tag Editor</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">{bulkEditPlaylist.tracks.length} tracks in {bulkEditPlaylist.name}</p>
                </div>
                <button onClick={() => setBulkEditPlaylist(null)} className="p-2 hover:bg-neutral-800 rounded-lg transition-colors"><X size={16} /></button>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#0d0d0d] border-b border-neutral-800 z-10">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500 w-8">#</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500">Title</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-neutral-500">Artist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bulkEditPlaylist.tracks.map((t, i) => (
                      <tr key={t.url} className="border-b border-neutral-800/40 hover:bg-neutral-900/40">
                        <td className="px-4 py-2 text-neutral-600 text-xs">{i + 1}</td>
                        <td className="px-4 py-2">
                          <input defaultValue={t.title}
                            onBlur={e => {
                              const newTitle = e.target.value.trim();
                              if (newTitle && newTitle !== t.title) {
                                setPlaylists(prev => prev.map(p => p.id === bulkEditPlaylist.id
                                  ? { ...p, tracks: p.tracks.map(x => x.url === t.url ? { ...x, title: newTitle } : x) }
                                  : p));
                                setBulkEditPlaylist(prev => prev ? { ...prev, tracks: prev.tracks.map(x => x.url === t.url ? { ...x, title: newTitle } : x) } : null);
                              }
                            }}
                            className="w-full bg-transparent text-white text-sm px-2 py-1 rounded border border-transparent hover:border-neutral-700 focus:border-[#39FF14] focus:outline-none transition-colors" />
                        </td>
                        <td className="px-4 py-2">
                          <input defaultValue={t.artist}
                            onBlur={e => {
                              const newArtist = e.target.value.trim();
                              if (newArtist !== t.artist) {
                                setPlaylists(prev => prev.map(p => p.id === bulkEditPlaylist.id
                                  ? { ...p, tracks: p.tracks.map(x => x.url === t.url ? { ...x, artist: newArtist } : x) }
                                  : p));
                                setBulkEditPlaylist(prev => prev ? { ...prev, tracks: prev.tracks.map(x => x.url === t.url ? { ...x, artist: newArtist } : x) } : null);
                              }
                            }}
                            className="w-full bg-transparent text-neutral-400 text-sm px-2 py-1 rounded border border-transparent hover:border-neutral-700 focus:border-[#39FF14] focus:outline-none transition-colors" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4 border-t border-neutral-800 flex justify-end gap-3 shrink-0">
                <button onClick={() => { showToast('Tags saved'); setBulkEditPlaylist(null); }}
                  className="px-5 py-2 bg-[#39FF14] text-black font-bold rounded-lg hover:shadow-[0_0_15px_#39FF14] transition-all">
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── CREATE PLAYLIST MODAL ── */}
      {isPlaylistModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-[#39FF14]/40 p-6 rounded-xl w-96 shadow-[0_0_30px_rgba(57,255,20,0.1)]">
            <h3 className="text-xl font-bold text-white mb-5">Create Playlist</h3>
            <div className="flex flex-col gap-3 mb-6">
              <div>
                <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1.5 block">Name</label>
                <input autoFocus type="text" value={newPlaylistName} onChange={e => setNewPlaylistName(e.target.value)} placeholder="e.g. Cyberpunk Mix"
                  className="w-full bg-[#050505] border border-neutral-800 text-white rounded-lg py-2.5 px-3 focus:outline-none focus:border-[#39FF14] placeholder-neutral-700"
                  onKeyDown={e => e.key === 'Enter' && confirmCreatePlaylist()} />
              </div>
              <div>
                <label className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><AlignLeft size={11} /> Description <span className="text-neutral-700 normal-case font-normal">(optional)</span></label>
                <textarea value={newPlaylistDesc} onChange={e => setNewPlaylistDesc(e.target.value)} placeholder="What's this playlist about?" rows={2}
                  className="w-full bg-[#050505] border border-neutral-800 text-white rounded-lg py-2.5 px-3 focus:outline-none focus:border-[#39FF14] placeholder-neutral-700 resize-none text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsPlaylistModalOpen(false)} className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={confirmCreatePlaylist} disabled={!newPlaylistName.trim()} className="px-4 py-2 bg-[#39FF14] text-black text-sm font-bold rounded-lg hover:shadow-[0_0_15px_#39FF14] transition-all disabled:opacity-50">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT PLAYLIST MODAL ── */}
      {renamingPlaylist && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-neutral-800 p-6 rounded-xl w-96 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-5">Edit Playlist</h3>
            <div className="flex flex-col gap-3 mb-6">
              <input autoFocus type="text" value={renameVal} onChange={e => setRenameVal(e.target.value)}
                className="w-full bg-[#050505] border border-neutral-800 text-white rounded-lg py-2.5 px-3 focus:outline-none focus:border-[#39FF14] transition-all"
                onKeyDown={e => { if (e.key === 'Enter') confirmRenamePlaylist(); if (e.key === 'Escape') setRenamingPlaylist(null); }} />
              <textarea value={renameDescVal} onChange={e => setRenameDescVal(e.target.value)} rows={2}
                className="w-full bg-[#050505] border border-neutral-800 text-white rounded-lg py-2.5 px-3 focus:outline-none focus:border-[#39FF14] resize-none text-sm" />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setRenamingPlaylist(null)} className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={confirmRenamePlaylist} className="px-4 py-2 bg-[#39FF14] text-black text-sm font-bold rounded-lg hover:shadow-[0_0_15px_#39FF14] transition-all">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SPOTIFY IMPORT MODAL ── */}
      

      {/* ── TOAST ── */}
      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 bg-[#111] border border-neutral-800/80 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-2xl pointer-events-none">
          {toast}
        </div>
      )}
    </div>
  );
}