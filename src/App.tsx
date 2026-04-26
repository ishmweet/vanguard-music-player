import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Home, Search, Play, Pause, SkipBack, SkipForward,
  ListMusic, Heart, Music, Volume2, VolumeX,
  MoreVertical, ListPlus, Share2, Download, ExternalLink, Copy,
  Info, X, Clock, Youtube, Hash, FileCode2, PlaySquare,
  PlusCircle, FileBadge2, Settings, RefreshCw, FolderDown,
  Shuffle, Repeat, Repeat1, ListOrdered, Trash2, Pencil,
  ChevronRight, ChevronLeft, ImagePlus, AlignLeft, HardDrive,
  FileMusic, AlertCircle, Gauge, Moon, FolderOpen,
  Zap, BarChart2, FileOutput,
  CheckCircle, Database, Upload, ArchiveRestore,
  ChevronDown,
  Loader2, CheckCircle2, XCircle, ArrowUpCircle, Image, Mic2
} from 'lucide-react';

const __APP_VERSION__ = '0.1.1';

type Track = {
  id: number;
  title: string;
  artist: string;
  duration: string;
  url: string;
  cover: string;
};

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

type AudioInfo = { codec: string; bitrate: number; samplerate: number; channels: string; format: string; url: string };
type DiskInfo = { used_bytes: number; track_count: number };
type BatchProgress = { index: number; total: number; title: string; success: boolean; error?: string };
type SettingsTab = 'updates' | 'downloads' | 'playback' | 'storage' | 'appearance';

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
function clampMenu(x: number, y: number, w = 260, h = 320) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  
  const cx = x + w > vw - 8 ? Math.max(8, x - w) : x;
  
  const cy = y + h > vh - 8 ? Math.max(8, y - h) : y;
  return { x: cx, y: cy };
}

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

type TrackRowProps = {
  track: Track; index: number; showRemove?: boolean; onRemove?: () => void;
  isActive: boolean; isHovered: boolean; isLoadingTrack: boolean; isPlaying: boolean;
  isLiked: boolean; isDownloading: number;
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
              {[100, 65, 80].map((h, i) => <div key={i} className="w-[3px] bg-[#39FF14] rounded-full shadow-[0_0_4px_#39FF14]" style={{ height: `${h}%`, animation: `barBounce ${0.7 + i * 0.12}s ease-in-out ${i * 110}ms infinite`, transformOrigin: "bottom" }} />)}
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
        {isDownloading > 0
          ? <svg width="14" height="14" viewBox="0 0 14 14" className="shrink-0">
              <circle cx="7" cy="7" r="5.5" fill="none" stroke="#333" strokeWidth="1.5"/>
              <circle cx="7" cy="7" r="5.5" fill="none" stroke={isDownloading >= 100 ? '#39FF14' : '#39FF14'}
                strokeWidth="1.5" strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 5.5}`}
                strokeDashoffset={`${2 * Math.PI * 5.5 * (1 - Math.min(isDownloading, 100) / 100)}`}
                style={{ transformOrigin: '7px 7px', transform: 'rotate(-90deg)', transition: 'stroke-dashoffset 0.3s ease' }}
              />
              {isDownloading >= 100 && <path d="M4.5 7l2 2 3-3" stroke="#39FF14" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>}
            </svg>
          : <Download size={14} className="text-neutral-400" />}
      </button>
      {showRemove && onRemove
        ? <button onClick={e => { e.stopPropagation(); onRemove(); }} className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors"><X size={14} className="text-neutral-400 hover:text-red-400" /></button>
        : <button onClick={e => { e.stopPropagation(); onCtx(e); }} className="p-1.5 rounded-md hover:bg-white/10 transition-colors"><MoreVertical size={14} className="text-neutral-400" /></button>}
    </div>
    <span className="text-[13px] text-neutral-500 tabular-nums w-12 text-right shrink-0">{track.duration && track.duration !== '0:00' ? track.duration : '—'}</span>
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

const ThemedSelect = ({ value, options, onChange }: {
  value: string;
  options: { label: string; value: string; desc?: string }[];
  onChange: (v: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const current = options.find(o => o.value === value);

  // Close on outside click — must check both button and dropdown
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || dropRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Recompute position on scroll/resize while open
  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!btnRef.current) return;
      const r = btnRef.current.getBoundingClientRect();
      const dropW = Math.max(r.width, 220);
      const left = Math.min(r.left, window.innerWidth - dropW - 8);
      setDropPos({ top: r.bottom + 4, left: Math.max(8, left), width: dropW });
    };
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [open]);

  const handleOpen = () => {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const dropW = Math.max(r.width, 220);
      const left = Math.min(r.left, window.innerWidth - dropW - 8);
      setDropPos({ top: r.bottom + 4, left: Math.max(8, left), width: dropW });
    }
    setOpen(o => !o);
  };

  // Use a portal so the dropdown renders into document.body, escaping all
  // overflow:hidden / overflow:auto scroll containers and stacking contexts.
  const dropdown = open ? (
    <div
      ref={dropRef}
      style={{
        position: 'fixed',
        top: dropPos.top,
        left: dropPos.left,
        minWidth: dropPos.width,
        zIndex: 999999,
        animation: 'dropIn 0.15s ease-out',
        background: '#0e0e0e',
        border: '1px solid rgba(57,255,20,0.25)',
        borderRadius: '12px',
        overflow: 'hidden',
        boxShadow: '0 16px 48px rgba(0,0,0,0.99), 0 0 0 1px rgba(57,255,20,0.08)',
      }}>
      {options.map((opt, i) => (
        <button key={opt.value}
          onMouseDown={e => { e.preventDefault(); onChange(opt.value); setOpen(false); }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', padding: '10px 16px', textAlign: 'left', cursor: 'pointer', borderTop: i !== 0 ? '1px solid #1a1a1a' : 'none', background: value === opt.value ? 'rgba(57,255,20,0.08)' : 'transparent', color: value === opt.value ? '#39FF14' : '#ccc', transition: 'background 0.1s' }}
          onMouseEnter={e => { if (value !== opt.value) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
          onMouseLeave={e => { if (value !== opt.value) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
        >
          <span style={{ fontSize: '14px', fontWeight: 600 }}>{opt.label}</span>
          {opt.desc && <span style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>{opt.desc}</span>}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div style={{ position: 'relative' }}>
      <button ref={btnRef}
        onClick={handleOpen}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border transition-all duration-200 min-w-[120px]
          ${open ? 'bg-[#39FF14]/15 border-[#39FF14]/50 text-[#39FF14]' : 'bg-[#39FF14]/10 border-[#39FF14]/30 text-[#39FF14] hover:bg-[#39FF14]/15'}`}
      >
        <span className="flex-1 text-left">{current?.label}</span>
        <ChevronDown size={14} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {typeof document !== 'undefined' && dropdown
        ? ReactDOM.createPortal(dropdown, document.body)
        : null}
    </div>
  );
};

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

function ImportButton({ onSpotify, onYoutube, onM3u }: {
  onSpotify: () => void; onYoutube: () => void; onM3u: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} className="mt-4 shrink-0 relative">
      <button onClick={() => setOpen(o => !o)}
        className={`w-full rounded-lg border py-2.5 px-4 flex items-center gap-2 transition-all duration-200 text-sm font-semibold
          ${open ? 'border-[#39FF14]/60 text-[#39FF14] bg-[#39FF14]/[0.08]' : 'border-neutral-700 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'}`}>
        <PlusCircle size={14} />
        <span>Import Playlist</span>
        <ChevronDown size={13} className={`ml-auto transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-1" style={{ animation: 'dropIn 0.15s ease-out' }}>
          <button onClick={() => { onSpotify(); setOpen(false); }}
            className="w-full rounded-lg border border-[#1DB954]/30 py-2 px-4 flex items-center gap-2.5 text-sm font-medium text-neutral-300 hover:text-white hover:border-[#1DB954]/60 hover:bg-[#1DB954]/5 transition-all duration-150">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
            From Spotify
          </button>
          <button onClick={() => { onYoutube(); setOpen(false); }}
            className="w-full rounded-lg border border-red-500/30 py-2 px-4 flex items-center gap-2.5 text-sm font-medium text-neutral-300 hover:text-white hover:border-red-500/60 hover:bg-red-500/5 transition-all duration-150">
            <svg width="14" height="11" viewBox="0 0 18 14" fill="#ef4444"><path d="M17.6 2.2C17.4 1.4 16.8.8 16 .6 14.6.2 9 .2 9 .2S3.4.2 2 .6C1.2.8.6 1.4.4 2.2 0 3.6 0 6.5 0 6.5s0 2.9.4 4.3c.2.8.8 1.4 1.6 1.6C3.4 12.8 9 12.8 9 12.8s5.6 0 7-.4c.8-.2 1.4-.8 1.6-1.6.4-1.4.4-4.3.4-4.3s0-2.9-.4-4.3zM7.2 9.3V3.7l4.7 2.8-4.7 2.8z"/></svg>
            From YouTube
          </button>
          <button onClick={() => { onM3u(); setOpen(false); }}
            className="w-full rounded-lg border border-neutral-700/50 py-2 px-4 flex items-center gap-2.5 text-sm font-medium text-neutral-300 hover:text-white hover:border-neutral-500 hover:bg-white/[0.03] transition-all duration-150">
            <FileOutput size={14} className="text-neutral-500" />
            From M3U File
          </button>
        </div>
      )}
    </div>
  );
}

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
  onProgress,
  onMatchingDone,
}: {
  onClose: () => void;
  onSavePlaylist: (name: string, desc: string, tracks: Track[]) => void;
  showToast: (m: string) => void;
  onProgress?: (matched: number, total: number, label: string) => void;
  onMatchingDone?: (tracks: Track[], matched: number, failed: number) => void;
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

    // 12 true concurrent tasks with a semaphore (not chunked — starts new task
    // immediately when any slot frees). Uses ytsearch5 (5 results) with a
    // title+artist scoring pass to pick the best match, not just the first result.
    const CONCURRENCY = 12;
    const total = initial.length;
    let completed = 0;
    const matched: Track[] = [];
    let failed = 0;

    // Match cache — skip re-searching identical title+artist within session
    const matchCache = new Map<string, string | null>();

    // Scoring: prefer results whose title contains both artist and track name.
    // Returns the video ID of the best result, or null if none found.
    const pickBestMatch = (lines: string[], title: string, artist: string): string | null => {
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
      const tNorm = norm(title);
      const aNorm = norm(artist);
      let bestId: string | null = null;
      let bestScore = -1;
      for (const line of lines) {
        const parts = line.split('====');
        const rTitle = norm(parts[0] || '');
        const rArtist = norm(parts[1] || '');
        const id = parts[3]?.trim();
        if (!id) continue;
        let score = 0;
        if (rTitle.includes(tNorm) || tNorm.includes(rTitle)) score += 3;
        if (rArtist.includes(aNorm) || aNorm.includes(rArtist)) score += 2;
        // bonus for "official" / "audio" / "lyrics"
        if (rTitle.includes('official') || rTitle.includes('audio') || rTitle.includes('lyric')) score += 1;
        if (score > bestScore) { bestScore = score; bestId = id; }
      }
      // Fall back to first result if nothing scored
      if (!bestId) {
        const id = lines[0]?.split('====')[3]?.trim();
        bestId = id || null;
      }
      return bestId;
    };

    const processTrack = async (track: typeof initial[0], i: number): Promise<void> => {
      if (abortRef.current) return;
      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: 'fetching' } : r));
      try {
        const cacheKey = `${track.title}|||${track.artist}`.toLowerCase();
        let cleanId: string | null | undefined = matchCache.get(cacheKey);

        if (cleanId === undefined) {
          const q = `${track.title} ${track.artist} audio`;
          const res: string = await invoke('search_youtube', { query: q });
          const lines = res.trim().split('\n').filter(Boolean).slice(0, 5);
          cleanId = pickBestMatch(lines, track.title, track.artist);
          matchCache.set(cacheKey, cleanId);
        }

        if (cleanId) {
          const t: Track = {
            id: i, title: track.title, artist: track.artist,
            duration: '0:00', url: `https://youtube.com/watch?v=${cleanId}`,
            cover: `https://i.ytimg.com/vi/${cleanId}/mqdefault.jpg`,
          };
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
      onProgress?.(matched.length, total, `${completed}/${total} matched`);
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    };

    // Semaphore: allow at most CONCURRENCY tasks running at once
    // (unlike chunking, new tasks start immediately when one finishes)
    const semaphore = {
      running: 0,
      queue: [] as (() => void)[],
      acquire() { return new Promise<void>(r => { if (this.running < CONCURRENCY) { this.running++; r(); } else { this.queue.push(r); } }); },
      release() { this.running--; const next = this.queue.shift(); if (next) { this.running++; next(); } },
    };

    await Promise.all(initial.map(async (track, i) => {
      await semaphore.acquire();
      try { await processTrack(track, i); }
      finally { semaphore.release(); }
    }));

    setMatchedTracks(matched);
    setFailedCount(failed);
    onProgress?.(matched.length, total, 'Done!');
    if (onMatchingDone) {
      // Notify parent — parent will show name popup even if we were minimized
      onMatchingDone(matched, matched.length, failed);
    } else {
      setPhase('saving');
    }
    setStatusMsg('');
  };

  const matched = results.filter(r => r.status === 'matched');
  const failed = results.filter(r => r.status === 'failed');
  const isDone = phase === 'done' || phase === 'saving';

  return (
    <>
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/85 backdrop-blur-md" onClick={phase === 'matching' ? undefined : onClose}>
      <div className="w-[740px] max-h-[88vh] flex flex-col rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.95)]"
        style={{ background: '#0e0e0e', border: '1px solid rgba(57,255,20,0.15)' }}
        onClick={e => e.stopPropagation()}>

        {}
        <div className="flex items-center justify-between px-7 py-5 border-b border-neutral-800/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#1DB954' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
            </div>
            <h2 className="text-base font-bold text-white">Import Spotify Playlist</h2>
          </div>
          <div className="flex items-center gap-2">
            {phase === 'matching' && (
              <button onClick={onClose} title="Minimize — import continues in background"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-[#39FF14] hover:bg-[#39FF14]/10 transition-all text-xs font-bold border border-neutral-800">
                —
              </button>
            )}
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-500 hover:text-white hover:bg-white/[0.06] transition-all">
              <X size={16} />
            </button>
          </div>
        </div>

        {}
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
                  {step.link && <button onClick={() => openUrl(step.link!).catch(() => window.open(step.link!, '_blank'))}
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

        {}
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
    {}
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

        {}
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

        {}
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

        {}
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

// ── Settings Validation Layer ─────────────────────────────────────────────────
// Detects conflicting settings before applying them. Returns a warning string
// if a conflict exists, or null if safe to apply.
function validateSettingsChange(
  key: string,
  newVal: unknown,
  current: {
    loudnormEnabled: boolean; skipSilence: boolean;
    eq: { bass: number; mid: number; treble: number };
    streamQuality: string;
  }
): string | null {
  const { loudnormEnabled, skipSilence, eq } = current;
  const hasEq = eq.bass !== 0 || eq.mid !== 0 || eq.treble !== 0;

  if (key === 'loudnormEnabled' && newVal === true && skipSilence) {
    return 'Loudnorm + Skip Silence together can cause audio distortion on short tracks. Consider disabling one.';
  }
  if (key === 'skipSilence' && newVal === true && loudnormEnabled) {
    return 'Loudnorm + Skip Silence together can cause audio distortion on short tracks. Consider disabling one.';
  }
  if (key === 'loudnormEnabled' && newVal === true && hasEq) {
    const extreme = Math.max(Math.abs(eq.bass), Math.abs(eq.mid), Math.abs(eq.treble));
    if (extreme >= 10) {
      return `Loudnorm with high EQ values (${extreme}dB) may clip audio. Reduce EQ or disable Loudnorm.`;
    }
  }
  return null; // no conflict
}

function SettingsPanel({
  downloadQuality, setDownloadQuality, downloadPath, handleSelectDirectory,
  downloadFormat, setDownloadFormat,
  embedThumbnail, setEmbedThumbnail,
  duplicateDetect, setDuplicateDetect,
  onBackup, onRestore, onReset,
  backupPath, setBackupPath,
  loudnormEnabled, setLoudnormEnabled,
  streamQuality, setStreamQuality,
  skipSilence, setSkipSilence,
  eq, setEq,
  showToast,
  updateAvailable,
  appVersion,
  lyricsSource, setLyricsSource,
  trayEnabled, setTrayEnabled,
  audioDevices, setAudioDevices,
}: {
  downloadQuality: string; setDownloadQuality: (q: string) => void;
  downloadPath: string; handleSelectDirectory: () => void;
  downloadFormat: string; setDownloadFormat: (f: string) => void;
  embedThumbnail: boolean; setEmbedThumbnail: (v: boolean) => void;
  duplicateDetect: boolean; setDuplicateDetect: (v: boolean) => void;
  onBackup: () => void; onRestore: () => void; onReset: () => void;
  backupPath: string; setBackupPath: (p: string) => void;
  loudnormEnabled: boolean; setLoudnormEnabled: (e: boolean) => void;
  streamQuality: string; setStreamQuality: (v: string) => void;
  skipSilence: boolean; setSkipSilence: (v: boolean) => void;
  eq: { bass: number; mid: number; treble: number }; setEq: (v: { bass: number; mid: number; treble: number }) => void;
  showToast: (m: string) => void;
  updateAvailable: string | null;
  appVersion: string;
  onNavigateToUpdates?: () => void;
  lyricsSource: string; setLyricsSource: (v: string) => void;
  trayEnabled: boolean; setTrayEnabled: (v: boolean) => void;
  audioDevices: { id: string; name: string; form: string; is_default: boolean }[];
  setAudioDevices: React.Dispatch<React.SetStateAction<{ id: string; name: string; form: string; is_default: boolean }[]>>;
}) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('updates');
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [switchingDevice, setSwitchingDevice] = useState(false);

  useEffect(() => {
    invoke<DiskInfo>('get_disk_usage', { path: downloadPath }).then(setDiskInfo).catch(() => {});
  }, [downloadPath]);

  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'updates',    label: 'Updates',    icon: <ArrowUpCircle size={15} /> },
    { id: 'downloads',  label: 'Downloads',  icon: <FolderDown size={15} /> },
    { id: 'playback',   label: 'Playback',   icon: <Zap size={15} /> },
    { id: 'storage',    label: 'Storage',    icon: <Database size={15} /> },
    { id: 'appearance', label: 'Appearance', icon: <Moon size={15} /> },
  ];

  return (
    <div className="flex-1 flex overflow-hidden">
      {}
      <div className="w-48 shrink-0 border-r border-neutral-800/50 flex flex-col p-4 gap-1">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 px-3 mb-2">Settings</p>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 text-left w-full
              ${activeTab === tab.id
                ? 'bg-[#39FF14]/[0.08] text-[#39FF14] border border-[#39FF14]/15 shadow-[inset_2px_0_0_#39FF14]'
                : 'text-neutral-500 hover:text-neutral-200 hover:bg-white/[0.03] border border-transparent'}`}>
            <span className={activeTab === tab.id ? 'text-[#39FF14]' : 'text-neutral-600'}>{tab.icon}</span>
            <span className="flex-1">{tab.label}</span>
            {tab.id === 'updates' && updateAvailable && (
              <span className="w-2 h-2 rounded-full bg-[#39FF14] shadow-[0_0_6px_#39FF14] shrink-0" />
            )}
          </button>
        ))}
      </div>

      {}
      <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">

        {}
        {activeTab === 'updates' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Updates</h2>
              <p className="text-sm text-neutral-500">Check for new releases of Vanguard Player.</p>
            </div>

            <div className={`rounded-xl border p-5 flex items-start gap-4 ${updateAvailable ? 'bg-[#39FF14]/[0.04] border-[#39FF14]/20' : 'bg-neutral-900/40 border-neutral-800/40'}`}>
              <div className={`mt-0.5 shrink-0 ${updateAvailable ? 'text-[#39FF14]' : 'text-neutral-600'}`}>
                {updateAvailable ? <ArrowUpCircle size={22} /> : <CheckCircle size={22} />}
              </div>
              <div className="flex-1 min-w-0">
                {updateAvailable ? (
                  <>
                    <p className="text-sm font-semibold text-white mb-0.5">Update available — v{updateAvailable}</p>
                    <p className="text-xs text-neutral-500 mb-3">A new version of Vanguard Player is ready to download.</p>
                    <a
                      href="#"
                      onClick={e => { e.preventDefault(); openUrl('https://github.com/ishmweet/vanguard-player/releases/latest'); }}
                      className="inline-flex items-center gap-2 text-xs font-semibold text-[#39FF14] hover:underline"
                    >
                      <ExternalLink size={13} />
                      View release on GitHub
                    </a>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-white mb-0.5">You're up to date</p>
                    <p className="text-xs text-neutral-500">Vanguard Player v{appVersion} is the latest release.</p>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'downloads' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Downloads</h2>
              <p className="text-sm text-neutral-500">Configure download quality and destination folder.</p>
            </div>

            {}
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

            {}
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

            {}
            <div className="border border-neutral-800/60 rounded-xl overflow-visible">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white">Audio Format</h3>
                <p className="text-xs text-neutral-600 mt-0.5">Container format for downloaded files.</p>
              </div>
              <div className="px-5 py-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-white">Format</p>
                  <p className="text-xs text-neutral-600 mt-1">
                    {downloadFormat === 'opus' ? 'Best compression, native YouTube codec' : downloadFormat === 'm4a' ? 'AAC in M4A, great Apple/car stereo compat' : downloadFormat === 'flac' ? 'Lossless — largest files' : 'MP3 — widest compatibility'}
                  </p>
                </div>
                <ThemedSelect
                  value={downloadFormat}
                  onChange={setDownloadFormat}
                  options={[
                    { value: 'mp3',  label: 'MP3',  desc: 'Most compatible' },
                    { value: 'opus', label: 'Opus', desc: 'Best compression' },
                    { value: 'm4a',  label: 'M4A',  desc: 'AAC / Apple' },
                    { value: 'flac', label: 'FLAC', desc: 'Lossless' },
                  ]}
                />
              </div>
            </div>

            {}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Image size={14} className="text-[#39FF14]" /> File Options</h3>
              </div>
              <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/30">
                <div>
                  <p className="text-sm font-medium text-white">Embed Thumbnail</p>
                  <p className="text-xs text-neutral-600 mt-1">{embedThumbnail ? 'Cover art written into file tags' : 'No cover art in downloaded files'}</p>
                </div>
                <button onClick={() => setEmbedThumbnail(!embedThumbnail)}
                  className={`relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 ${embedThumbnail ? 'bg-[#39FF14]/80 shadow-[0_0_10px_rgba(57,255,20,0.3)]' : 'bg-neutral-700'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${embedThumbnail ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-white">Duplicate Detection</p>
                  <p className="text-xs text-neutral-600 mt-1">{duplicateDetect ? 'Skips tracks already in your download folder' : 'Always download regardless of duplicates'}</p>
                </div>
                <button onClick={() => setDuplicateDetect(!duplicateDetect)}
                  className={`relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 ${duplicateDetect ? 'bg-[#39FF14]/80 shadow-[0_0_10px_rgba(57,255,20,0.3)]' : 'bg-neutral-700'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${duplicateDetect ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'playback' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Playback</h2>
              <p className="text-sm text-neutral-500">Audio engine and playback behaviour settings.</p>
            </div>

            {/* Loudnorm */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Zap size={14} className="text-[#39FF14]" /> Audio Normalization</h3>
                <p className="text-xs text-neutral-600 mt-0.5">Equalizes loudness across all tracks so nothing is too loud or too quiet.</p>
              </div>
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-white">Loudnorm (EBU R128)</p>
                  <p className="text-xs text-neutral-600 mt-1">{loudnormEnabled ? 'Active — consistent volume across tracks' : 'Disabled — faster start, raw volume'}</p>
                </div>
                <button onClick={() => {
                  const next = !loudnormEnabled;
                  const warn = validateSettingsChange('loudnormEnabled', next, { loudnormEnabled, skipSilence, eq, streamQuality });
                  if (warn) { showToast(`⚠ ${warn}`); }
                  setLoudnormEnabled(next);
                }}
                  className={`relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 ${loudnormEnabled ? 'bg-[#39FF14]/80 shadow-[0_0_10px_rgba(57,255,20,0.3)]' : 'bg-neutral-700'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${loudnormEnabled ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>

            {/* Playback Quality */}
            <div className="border border-neutral-800/60 rounded-xl overflow-visible">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Gauge size={14} className="text-[#39FF14]" /> Stream Quality</h3>
                <p className="text-xs text-neutral-600 mt-0.5">Higher quality uses more bandwidth. Opus is native YouTube codec with best compression.</p>
              </div>
              <div className="flex items-center justify-between px-5 py-5">
                <div>
                  <p className="text-sm font-medium text-white">Streaming Format</p>
                  <p className="text-xs text-neutral-600 mt-1">Preferred audio codec for streaming playback</p>
                </div>
                <ThemedSelect
                  value={streamQuality}
                  onChange={setStreamQuality}
                  options={[
                    { value: 'best', label: 'Best', desc: 'Highest quality available' },
                    { value: 'opus', label: 'Opus', desc: 'Native YouTube, best compression' },
                    { value: 'webm', label: 'WebM', desc: 'WebM container, efficient' },
                  ]}
                />
              </div>
            </div>

            {/* Skip Silence */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><SkipForward size={14} className="text-[#39FF14]" /> Smart Playback</h3>
              </div>
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-white">Skip Silence</p>
                  <p className="text-xs text-neutral-600 mt-1">{skipSilence ? 'Auto-skips silent parts between tracks' : 'Play all audio including silence'}</p>
                </div>
                <button onClick={() => {
                  const next = !skipSilence;
                  const warn = validateSettingsChange('skipSilence', next, { loudnormEnabled, skipSilence, eq, streamQuality });
                  if (warn) { showToast(`⚠ ${warn}`); }
                  setSkipSilence(next);
                }}
                  className={`relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 ${skipSilence ? 'bg-[#39FF14]/80 shadow-[0_0_10px_rgba(57,255,20,0.3)]' : 'bg-neutral-700'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${skipSilence ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>

            {/* Audio Output */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Volume2 size={14} className="text-[#39FF14]" /> Audio Output</h3>
                  <p className="text-xs text-neutral-600 mt-0.5">Select output device. Switches instantly without restarting playback.</p>
                </div>
                <button onClick={() => invoke<{ id: string; name: string; form: string; is_default: boolean }[]>('list_audio_devices').then(setAudioDevices).catch(() => {})}
                  className="p-1.5 text-neutral-600 hover:text-[#39FF14] transition-colors rounded-lg" title="Refresh">
                  <RefreshCw size={13} />
                </button>
              </div>
              <div className="flex flex-col divide-y divide-neutral-800/40">
                {audioDevices.length === 0 ? (
                  <div className="px-5 py-4 text-sm text-neutral-600">No devices found</div>
                ) : audioDevices.map(dev => {
                  const isDefault = dev.is_default;
                  return (
                    <button key={dev.id} disabled={switchingDevice}
                      onClick={async () => {
                        if (isDefault) return;
                        setSwitchingDevice(true);
                        try {
                          await invoke('set_audio_device', { id: dev.id });
                          setAudioDevices(prev => prev.map(d => ({ ...d, is_default: d.id === dev.id })));
                          showToast(`Output: ${dev.name}`);
                        } catch (e) { showToast(`Switch failed: ${e}`); }
                        finally { setSwitchingDevice(false); }
                      }}
                      className={`flex items-center gap-3 px-5 py-3.5 text-left transition-colors w-full
                        ${isDefault ? 'bg-[#39FF14]/[0.04]' : 'hover:bg-white/[0.03] cursor-pointer'}
                        ${switchingDevice && !isDefault ? 'opacity-40' : ''}`}>
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border
                        ${isDefault ? 'bg-[#39FF14]/15 border-[#39FF14]/30' : 'bg-neutral-900 border-neutral-800'}`}>
                        {dev.form === 'headphones'
                          ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isDefault ? '#39FF14' : '#666'} strokeWidth="2" strokeLinecap="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/><path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
                          : <Volume2 size={13} className={isDefault ? 'text-[#39FF14]' : 'text-neutral-600'} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isDefault ? 'text-white' : 'text-neutral-400'}`}>{dev.name}</p>
                        {dev.form && <p className="text-xs text-neutral-600 capitalize mt-0.5">{dev.form}</p>}
                      </div>
                      {isDefault && <span className="text-[10px] font-bold text-[#39FF14] shrink-0">ACTIVE</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lyrics Source */}
            <div className="border border-neutral-800/60 rounded-xl overflow-visible">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Mic2 size={14} className="text-[#39FF14]" /> Lyrics Source</h3>
                <p className="text-xs text-neutral-600 mt-0.5">Primary source for synced lyrics. Falls back to lrclib → lyrics.ovh automatically.</p>
              </div>
              <div className="flex items-center justify-between px-5 py-5">
                <div>
                  <p className="text-sm font-medium text-white">Primary source</p>
                  <p className="text-xs text-neutral-600 mt-1">
                    {lyricsSource === 'musixmatch' ? 'Musixmatch — word-level richsync when available'
                      : lyricsSource === 'netease' ? 'NetEase — strong for C-pop / K-pop'
                      : 'lrclib — open, fast, no rate limits'}
                  </p>
                </div>
                <ThemedSelect value={lyricsSource} onChange={setLyricsSource} options={[
                  { value: 'lrclib', label: 'lrclib', desc: 'Open source, fast' },
                  { value: 'musixmatch', label: 'Musixmatch', desc: 'Word-level sync' },
                  { value: 'netease', label: 'NetEase', desc: 'Best for C/K-pop' },
                ]} />
              </div>
            </div>

            {/* Equalizer */}
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2"><BarChart2 size={14} className="text-[#39FF14]" /> Equalizer</h3>
                  <p className="text-xs text-neutral-600 mt-0.5">Adjust bass, mid, and treble. Applied in real-time via mpv.</p>
                </div>
                <button onClick={() => { setEq({ bass: 0, mid: 0, treble: 0 }); invoke('set_equalizer', { bass: 0, mid: 0, treble: 0 }).catch(() => {}); }}
                  className="text-xs text-neutral-600 hover:text-neutral-300 transition-colors px-2 py-1 rounded border border-neutral-800 hover:border-neutral-700">
                  Reset
                </button>
              </div>
              <div className="px-5 py-5 flex flex-col gap-5">
                {([
                  { label: 'Bass', key: 'bass' as const, desc: 'Low frequencies (60–250Hz)' },
                  { label: 'Mid', key: 'mid' as const, desc: 'Mids (500Hz–2kHz)' },
                  { label: 'Treble', key: 'treble' as const, desc: 'High frequencies (4–16kHz)' },
                ] as { label: string; key: 'bass' | 'mid' | 'treble'; desc: string }[]).map(({ label, key, desc }) => (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-sm font-medium text-white">{label}</span>
                        <span className="text-xs text-neutral-600 ml-2">{desc}</span>
                      </div>
                      <span className={`text-xs font-bold tabular-nums w-12 text-right ${eq[key] > 0 ? 'text-[#39FF14]' : eq[key] < 0 ? 'text-red-400' : 'text-neutral-500'}`}>
                        {eq[key] > 0 ? `+${eq[key]}` : eq[key]}dB
                      </span>
                    </div>
                    <div className="relative h-2 bg-neutral-800 rounded-full">
                      {/* center tick */}
                      <div className="absolute top-0 left-1/2 w-px h-full bg-neutral-600 rounded-full pointer-events-none" />
                      <input type="range" min="-12" max="12" step="1" value={eq[key]}
                        onChange={e => {
                          const v = parseInt(e.target.value);
                          const next = { ...eq, [key]: v };
                          setEq(next);
                          invoke('set_equalizer', { bass: next.bass, mid: next.mid, treble: next.treble }).catch(() => {});
                        }}
                        className="absolute inset-0 w-full opacity-0 cursor-pointer h-full"
                      />
                      {/* filled track */}
                      <div className="absolute top-0 h-full rounded-full pointer-events-none transition-all"
                        style={{
                          left: eq[key] >= 0 ? '50%' : `${((eq[key] + 12) / 24) * 100}%`,
                          width: `${(Math.abs(eq[key]) / 24) * 100}%`,
                          background: eq[key] >= 0 ? '#39FF14' : '#f87171',
                        }} />
                      {/* thumb */}
                      <div className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full border-2 border-white bg-[#0a0a0a] shadow pointer-events-none transition-all"
                        style={{ left: `calc(${((eq[key] + 12) / 24) * 100}% - 8px)` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>


          </div>
        )}

        {}
        {activeTab === 'storage' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Storage</h2>
              <p className="text-sm text-neutral-500">Backup and restore your playlists, queue, settings, and history.</p>
            </div>

            {}
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
              {}
              <div className="px-5 py-4 flex items-center justify-between group hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={onBackup}>
                <div>
                  <h3 className="text-sm font-semibold text-white">Create Backup</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">Save all playlists, queue, history and settings to a JSON file.</p>
                </div>
                <button className="p-2 text-neutral-600 group-hover:text-[#39FF14] transition-colors rounded-lg ml-4 shrink-0">
                  <Upload size={17} />
                </button>
              </div>

              {}
              <div className="px-5 py-4 flex items-center justify-between group hover:bg-white/[0.02] transition-colors cursor-pointer" onClick={onRestore}>
                <div>
                  <h3 className="text-sm font-semibold text-white">Restore Backup</h3>
                  <p className="text-xs text-neutral-500 mt-0.5">Restore your data and settings from a backup file.</p>
                </div>
                <button className="p-2 text-neutral-600 group-hover:text-[#39FF14] transition-colors rounded-lg ml-4 shrink-0">
                  <ArchiveRestore size={17} />
                </button>
              </div>

              {}
              <div className="px-5 py-4 flex items-center justify-between group hover:bg-red-500/[0.04] transition-colors cursor-pointer"
                onClick={onReset}>
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

        {activeTab === 'appearance' && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">Appearance</h2>
              <p className="text-sm text-neutral-500">Tray icon and window behaviour.</p>
            </div>
            <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
              <div className="px-5 py-4 border-b border-neutral-800/40 bg-neutral-900/20">
                <h3 className="text-sm font-semibold text-white">System Tray</h3>
                <p className="text-xs text-neutral-600 mt-0.5">Left-click icon toggles window. Tray menu: play/pause, next, prev, quit.</p>
              </div>
              <div className="flex items-center justify-between px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-white">Enable Tray Icon</p>
                  <p className="text-xs text-neutral-600 mt-1">{trayEnabled ? 'Active — close button hides to tray' : 'Disabled — close exits app'}</p>
                </div>
                <button onClick={async () => {
                  const next = !trayEnabled;
                  try { await invoke('tray_set', { enabled: next }); setTrayEnabled(next); }
                  catch (e) { showToast(`Tray unavailable: ${e}`); }
                }} className={`relative w-11 h-6 rounded-full transition-all duration-200 shrink-0 ${trayEnabled ? 'bg-[#39FF14]/80 shadow-[0_0_10px_rgba(57,255,20,0.3)]' : 'bg-neutral-700'}`}>
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all duration-200 ${trayEnabled ? 'left-5' : 'left-0.5'}`} />
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

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
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [diskInfo, setDiskInfo] = useState<DiskInfo | null>(null);
  const [renaming, setRenaming] = useState<LocalTrack | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const dragLocalIdx = useRef<number | null>(null);
  const dragOverLocalIdxRef = useRef<number | null>(null);
  const [dragOverLocalIdx, setDragOverLocalIdx] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = searchQ.trim()
    ? tracks.filter(t => {
        const q = searchQ.toLowerCase();
        return t.title.toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q);
      })
    : tracks;

  const scan = useCallback(async () => {
    setScanning(true); setError(null);
    try {
      const raw: LocalTrack[] = await invoke('scan_downloads', { path: downloadPath });
      setTracks(raw);
      setScanning(false);

      const di = await invoke<DiskInfo>('get_disk_usage', { path: downloadPath }).catch(() => null);
      if (di) setDiskInfo(di);

      setEnriching(true);
      for (const t of raw) {
        try {
          const m: { title: string; artist: string; duration: string } = await invoke('get_audio_metadata', { path: t.path });
          const enriched = { ...t, title: m.title || t.title, artist: m.artist || undefined, duration: m.duration !== '0:00' ? m.duration : undefined };
          setTracks(prev => prev.map(p => p.path === t.path ? enriched : p));
        } catch { /* keep original */ }
      }
      setEnriching(false);
    } catch (e) { setError(String(e)); setScanning(false); setEnriching(false); }
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
      {}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-11 h-11 rounded-lg flex items-center justify-center bg-[#39FF14]/10 border border-[#39FF14]/30 shrink-0">
          <HardDrive size={22} className="text-[#39FF14] drop-shadow-[0_0_6px_#39FF14]" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-bold text-white">Offline</h2>
          {}
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

      {}
      {!scanning && tracks.length > 0 && (
        <div className="relative mb-4">
          <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
            <Search size={15} className={searchQ ? 'text-[#39FF14]' : 'text-neutral-600'} />
          </div>
          <input
            ref={searchRef}
            type="text"
            placeholder="Filter tracks..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
            className="w-full bg-neutral-900/60 border border-neutral-800 text-white rounded-xl py-2.5 pl-9 pr-9 focus:outline-none focus:border-[#39FF14]/50 focus:ring-1 focus:ring-[#39FF14]/20 transition-all text-sm placeholder-neutral-600"
          />
          {searchQ && (
            <button onClick={() => setSearchQ('')} className="absolute inset-y-0 right-0 pr-3 flex items-center text-neutral-500 hover:text-white transition-colors">
              <X size={14} />
            </button>
          )}
        </div>
      )}

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
            <h3 className="text-base font-bold text-white flex-1">
              {searchQ.trim() ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}` : `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`}
            </h3>
            {enriching && <span className="text-[11px] text-neutral-600 flex items-center gap-1.5"><div className="w-2.5 h-2.5 border border-neutral-600 border-t-transparent rounded-full animate-spin" />reading metadata</span>}
            {!searchQ && !enriching && <p className="text-xs text-neutral-700">Drag to reorder</p>}
          </div>

          {filtered.length === 0 && searchQ && (
            <div className="flex flex-col items-center justify-center h-32 text-neutral-700 gap-2">
              <Search size={28} strokeWidth={1} />
              <p className="text-sm text-neutral-600">No tracks match "{searchQ}"</p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            {filtered.map((track, i) => {
              const isActive = currentTrackPath === track.path;
              const isHov = hovered === track.path;
              const isDragOver = dragOverLocalIdx === i && dragLocalIdx.current !== null && dragLocalIdx.current !== i;
              return (
                <div key={track.path}
                  className={`relative flex items-center gap-4 px-4 py-3.5 rounded-lg cursor-pointer transition-all duration-150 group border
                    ${isDragOver ? 'border-[#39FF14]/40 bg-[#39FF14]/[0.04]' : ''}
                    ${isActive && !isDragOver ? 'bg-[#39FF14]/[0.07] border-[#39FF14]/20' : !isDragOver ? 'hover:bg-white/5 border-transparent' : ''}`}
                  onMouseEnter={() => {
                    setHovered(track.path);
                    if (dragLocalIdx.current !== null) { dragOverLocalIdxRef.current = i; setDragOverLocalIdx(i); }
                  }}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => onPlayLocalTrack(track, searchQ ? filtered : tracks, i)}
                >
                  {isDragOver && <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#39FF14] rounded-full z-10 shadow-[0_0_6px_#39FF14] pointer-events-none" />}
                  {!searchQ && (
                    <div className="w-4 flex items-center justify-center shrink-0 cursor-grab opacity-0 group-hover:opacity-40 hover:!opacity-70 transition-opacity"
                      onMouseDown={e => {
                        e.preventDefault();
                        dragLocalIdx.current = i;
                        dragOverLocalIdxRef.current = i;
                        setDragOverLocalIdx(i);
                        const onUp = () => {
                          const from = dragLocalIdx.current;
                          const to = dragOverLocalIdxRef.current;
                          dragLocalIdx.current = null;
                          dragOverLocalIdxRef.current = null;
                          setDragOverLocalIdx(null);
                          window.removeEventListener('mouseup', onUp);
                          if (from === null || to === null || from === to) return;
                          setTracks(prev => {
                            const next = [...prev];
                            const [moved] = next.splice(from, 1);
                            next.splice(to, 0, moved);
                            return next;
                          });
                        };
                        window.addEventListener('mouseup', onUp);
                      }}>
                      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" className="text-neutral-400">
                        <circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/>
                        <circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/>
                        <circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>
                      </svg>
                    </div>
                  )}
                  <div className="w-8 flex items-center justify-center shrink-0">
                    {isActive && isLoadingTrack
                      ? <div className="w-3.5 h-3.5 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
                      : isActive && isPlaying
                        ? <div className="flex gap-[2px] items-end h-4">{[100, 65, 80].map((h, j) => <div key={j} className="w-[3px] bg-[#39FF14] rounded-full shadow-[0_0_4px_#39FF14]" style={{ height: `${h}%`, animation: `barBounce ${0.7 + j * 0.12}s ease-in-out ${j * 110}ms infinite`, transformOrigin: "bottom" }} />)}</div>
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

      {}
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

function LyricsAudioDropdown({ devices, switching, onSwitch }: {
  devices: { id: string; name: string; form: string; is_default: boolean }[];
  switching: boolean;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const active = devices.find(d => d.is_default) ?? devices[0];
  return (
    <div className="w-full relative">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Volume2 size={12} className="text-[#39FF14] shrink-0" />
        <span className="text-xs truncate flex-1" style={{ color: 'rgba(255,255,255,0.7)' }}>{active?.name ?? 'No device'}</span>
        <ChevronDown size={12} style={{ color: 'rgba(255,255,255,0.3)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} className="shrink-0" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 rounded-xl overflow-hidden z-20"
          style={{ background: 'rgba(12,12,16,0.95)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' }}>
          {devices.map(dev => (
            <button key={dev.id} disabled={switching}
              onClick={() => { if (!dev.is_default) onSwitch(dev.id); setOpen(false); }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.05]">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dev.is_default ? '#39FF14' : 'rgba(255,255,255,0.2)' }} />
              <span className="text-xs truncate" style={{ color: dev.is_default ? '#fff' : 'rgba(255,255,255,0.5)' }}>{dev.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VanguardPlayer() {

  
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    
    const id = requestAnimationFrame(() => setIsHydrated(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(() => loadLS('vg_searchHistory', []));
  const [showHistory, setShowHistory] = useState(false);
  const [, setHasSearched] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => loadLS('vg_currentTrack', null));
  const [currentLocalPath, setCurrentLocalPath] = useState<string | null>(null);
  const currentLocalPathRef = useRef<string | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const setIsPlayingSync = useCallback((v: boolean) => { isPlayingRef.current = v; setIsPlaying(v); }, []);

  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const [updateAvailable, setUpdateAvailable] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState(__APP_VERSION__);
  useEffect(() => {
    import('@tauri-apps/api/app').then(m => m.getVersion()).then(setAppVersion).catch(() => {});
  }, []);
  const [_navHistory, setNavHistory] = useState<string[]>([]);

  const navigateTo = useCallback((nav: string) => {
    setNavHistory(prev => [...prev.slice(-20), activeNav]);
    setActiveNav(nav);
  }, [activeNav]);

  const navigateBack = useCallback(() => {
    setNavHistory(prev => {
      const next = [...prev];
      const dest = next.pop() ?? 'home';
      setActiveNav(dest);
      return next;
    });
  }, []);
  const [trackDurationSeconds, setTrackDurationSeconds] = useState(0);
  const trackDurationRef = useRef(0);
  const [progressSeconds, setProgressSeconds] = useState(0);
  const progressSecondsRef = useRef(0);

  const [isSearching, setIsSearching] = useState(false);

  
  useEffect(() => {
    if (activeNav === 'home') {
      setSearchQuery('');
      setTracks([]);
      setIsSearching(false);
    }
  }, [activeNav]);

  const [quickPicks, setQuickPicks] = useState<Track[]>(() => loadLS('vg_quickPicks', []));

  const [queue, setQueue] = useState<Track[]>(() => loadLS('vg_queue', []));
  const [queuePulseKey, setQueuePulseKey] = useState(0);
  const [playHistory, setPlayHistory] = useState<Track[]>(() => loadLS('vg_playHistory', []));
  
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

  
  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    loadLS('vg_playlists', [{ id: 'p1', name: 'Liked Songs', description: '', tracks: [] }])
  );
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [playlistSearchQ, setPlaylistSearchQ] = useState('');
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);

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
  // Background Spotify import progress pill
  const [bgImport, setBgImport] = useState<{ matched: number; total: number; label: string } | null>(null);
  // Pending spotify save — survives modal minimize so name popup appears when done
  const [pendingSpotifyImport, setPendingSpotifyImport] = useState<{ tracks: Track[]; matchedCount: number; failedCount: number } | null>(null);
  // Lyrics state
  const [showLyrics, setShowLyrics] = useState(false);
  const [lyricsData, setLyricsData] = useState<{ lines: {time:number;text:string}[]; title: string; artist: string } | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  // Artist thumbnail cache for Stats page
  const [artistThumbs, setArtistThumbs] = useState<Record<string, string>>({});

  
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [infoModalTrack, setInfoModalTrack] = useState<Track | null>(null);
  const [downloadingTracks, setDownloadingTracks] = useState<Record<string, number>>({});
  const [hoveredTrackUrl, setHoveredTrackUrl] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  
  const [downloadQuality, setDownloadQuality] = useState<string>(() => loadLS('vg_dlQuality', 'High'));
  const [downloadFormat, setDownloadFormatState] = useState<string>(() => loadLS('vg_dlFormat', 'mp3'));
  const [embedThumbnail, setEmbedThumbnailState] = useState<boolean>(() => loadLS('vg_embedThumb', true));
  const [duplicateDetect, setDuplicateDetectState] = useState<boolean>(() => loadLS('vg_dupDetect', true));
  const [downloadPath, setDownloadPath] = useState<string>(() => loadLS('vg_dlPath', '~/Downloads'));
  const [backupPath, setBackupPathState] = useState<string>(() => loadLS('vg_backupPath', ''));
  const setBackupPath = useCallback((p: string) => { setBackupPathState(p); saveLS('vg_backupPath', p); }, []);
  const [playbackSpeed, setPlaybackSpeedState] = useState<number>(() => loadLS('vg_speed', 1));
  const [crossfadeSeconds] = useState<number>(() => loadLS('vg_crossfade', 0));
  const [loudnormEnabled, setLoudnormEnabledState] = useState<boolean>(() => loadLS('vg_loudnorm', true));
  const [streamQuality, setStreamQualityState] = useState<string>(() => loadLS('vg_streamQuality', 'best'));
  const [skipSilence, setSkipSilenceState] = useState<boolean>(() => loadLS('vg_skipSilence', false));
  const [lyricsSource, setLyricsSource] = useState<string>(() => loadLS('vg_lyricsSource', 'lrclib'));
  const [trayEnabled, setTrayEnabled] = useState<boolean>(() => loadLS('vg_trayEnabled', false));
  const [audioDevices, setAudioDevices] = useState<{ id: string; name: string; form: string; is_default: boolean }[]>([]);
  const [switchingDevice, setSwitchingDevice] = useState(false);

  useEffect(() => {
    invoke<{ id: string; name: string; form: string; is_default: boolean }[]>('list_audio_devices')
      .then(setAudioDevices).catch(() => {});
  }, []);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const bookmarksRef = useRef<Record<string, number>>(loadLS('vg_bookmarks', {}));
  const [abLoop, setAbLoop] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const abLoopRef = useRef<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [eq, setEqState] = useState<{ bass: number; mid: number; treble: number }>(() => loadLS('vg_eq', { bass: 0, mid: 0, treble: 0 }));

  const [sleepTimer, setSleepTimerState] = useState(-1);
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [waveformData, setWaveformData] = useState<number[]>([]);
  const [showSleepPopover, setShowSleepPopover] = useState(false);

  
  const searchRef = useRef<HTMLInputElement>(null);
  const endDetectedRef = useRef(false);
  const currentTrackRef = useRef(currentTrack);
  const queueRef = useRef(queue);

  const localTracksListRef = useRef<LocalTrack[]>([]);
  const localTrackIndexRef = useRef(0);
  
  const playlistContextRef = useRef<{ tracks: Track[]; index: number } | null>(null);

  useEffect(() => { currentTrackRef.current = currentTrack; }, [currentTrack]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);

  
  useEffect(() => { saveLS('vg_playlists', playlists); }, [playlists]);
  const prevQueueLenRef = useRef(0);
  useEffect(() => {
    saveLS('vg_queue', queue);
    if (queue.length > prevQueueLenRef.current) setQueuePulseKey(k => k + 1);
    prevQueueLenRef.current = queue.length;
  }, [queue]);
  useEffect(() => { saveLS('vg_playHistory', playHistory); }, [playHistory]);
  useEffect(() => { saveLS('vg_playCounts', playCounts); }, [playCounts]);
  useEffect(() => { saveLS('vg_listenSecs', listenSecs); }, [listenSecs]);
  useEffect(() => { saveLS('vg_firstSeen', firstSeen); }, [firstSeen]);
  useEffect(() => { saveLS('vg_dailyPlays', dailyPlays); }, [dailyPlays]);
  useEffect(() => { saveLS('vg_shuffle', shuffle); }, [shuffle]);
  useEffect(() => { saveLS('vg_repeatMode', repeatMode); }, [repeatMode]);
  useEffect(() => { saveLS('vg_volume', volume); }, [volume]);
  
  useEffect(() => { saveLS('vg_currentTrack', currentTrack); }, [currentTrack]);

  useEffect(() => {
    if (!currentTrack) return;
    const parseDuration = (d: string): number => {
      const parts = d.split(':').map(Number);
      if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
      if (parts.length === 3) return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
      return 0;
    };
    invoke('set_mpris_metadata', {
      title:        currentTrack.title  ?? '',
      artist:       currentTrack.artist ?? '',
      coverUrl:     currentTrack.cover  ?? '',
      durationSecs: parseDuration(currentTrack.duration ?? '0:00'),
      playing:      isPlaying,
    }).catch(() => {});
  }, [currentTrack, isPlaying]);

  
  useEffect(() => { saveLS('vg_searchHistory', searchHistory); }, [searchHistory]);
  useEffect(() => { saveLS('vg_dlQuality', downloadQuality); }, [downloadQuality]);
  useEffect(() => { saveLS('vg_dlFormat', downloadFormat); }, [downloadFormat]);
  useEffect(() => { saveLS('vg_embedThumb', embedThumbnail); }, [embedThumbnail]);
  useEffect(() => { saveLS('vg_dupDetect', duplicateDetect); }, [duplicateDetect]);
  useEffect(() => { saveLS('vg_dlPath', downloadPath); }, [downloadPath]);
  useEffect(() => { saveLS('vg_quickPicks', quickPicks); }, [quickPicks]);
  useEffect(() => { saveLS('vg_speed', playbackSpeed); }, [playbackSpeed]);
  useEffect(() => { saveLS('vg_loudnorm', loudnormEnabled); invoke('set_loudnorm_enabled', { enabled: loudnormEnabled }).catch(() => {}); }, [loudnormEnabled]);
  useEffect(() => { saveLS('vg_streamQuality', streamQuality); invoke('set_stream_quality', { quality: streamQuality }).catch(() => {}); }, [streamQuality]);
  useEffect(() => { saveLS('vg_skipSilence', skipSilence); invoke('set_skip_silence', { enabled: skipSilence }).catch(() => {}); }, [skipSilence]);
  useEffect(() => { saveLS('vg_eq', eq); }, [eq]);
  useEffect(() => { saveLS('vg_lyricsSource', lyricsSource); }, [lyricsSource]);
  useEffect(() => { saveLS('vg_trayEnabled', trayEnabled); }, [trayEnabled]);

  // Restore tray on startup
  useEffect(() => {
    if (trayEnabled) invoke('tray_set', { enabled: true }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tray events — wire to same refs as MPRIS
  useEffect(() => {
    const unsubs = [
      listen('tray_play_pause', () => mprisToggleRef.current()),
      listen('tray_next', () => mprisNextRef.current()),
      listen('tray_prev', () => mprisPrevRef.current()),
    ];
    return () => { unsubs.forEach(p => p.then(fn => fn())); };
  }, []);

  
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  
  useEffect(() => {
    const h = () => { setCtxMenu(null); setShowHistory(false); setShowSleepPopover(false); };
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, []);

  
  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const r: number = await invoke('get_sleep_timer_remaining');
        if (r >= 0) {
          setSleepTimerState(r);
          
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

  
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<BatchProgress>('batch_download_progress', e => {
      showToast(`Downloaded ${e.payload.index + 1}/${e.payload.total}${e.payload.error ? ' (error)' : ''}`);
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [showToast]);

  const mprisToggleRef    = useRef<() => void>(() => {});
  const mprisNextRef      = useRef<() => void>(() => {});
  const mprisPrevRef      = useRef<() => void>(() => {});

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    listen('mpris_play_pause', () => mprisToggleRef.current()).then(fn => unlisteners.push(fn));
    listen('mpris_next',       () => mprisNextRef.current()).then(fn => unlisteners.push(fn));
    listen('mpris_prev',       () => mprisPrevRef.current()).then(fn => unlisteners.push(fn));

    return () => unlisteners.forEach(fn => fn());
  }, []);



  useEffect(() => {
    invoke<string | null>('check_for_update').then(v => setUpdateAvailable(v ?? null)).catch(() => {});
  }, []);

  // Fetch artist thumbnails when stats page opens
  useEffect(() => {
    if (activeNav !== 'stats') return;
    const artistCounts: Record<string, number> = {};
    Object.entries(playCounts).forEach(([url, count]) => {
      const artist = [...quickPicks, ...playHistory].find(t => t.url === url)?.artist;
      if (artist?.trim()) artistCounts[artist] = (artistCounts[artist] || 0) + (count as number);
    });
    const top5 = Object.entries(artistCounts).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([a])=>a);
    top5.forEach(async (artist) => {
      if (artistThumbs[artist]) return;
      try {
        const res: string = await invoke('search_yt_music', { query: artist, searchType: 'artist' });
        const items = JSON.parse(res);
        const thumb = items[0]?.thumbnail;
        if (thumb) setArtistThumbs(prev => ({ ...prev, [artist]: thumb }));
      } catch {}
    });
  }, [activeNav]);
  useEffect(() => {
    if (!showLyrics || !currentTrack) return;
    const title = currentTrack.title;
    const artist = currentTrack.artist;
    if (!title || !artist) return;
    setLyricsLoading(true);
    setLyricsData(null);
    invoke<string>('fetch_lyrics', { title, artist, album: '', duration: trackDurationSeconds || 0, source: lyricsSource })
      .then(raw => {
        try {
          const lines: {time:number;text:string}[] = JSON.parse(raw);
          setLyricsData({ lines, title, artist });
        } catch { setLyricsData({ lines: [], title, artist }); }
      })
      .catch(() => setLyricsData({ lines: [], title, artist }))
      .finally(() => setLyricsLoading(false));
  }, [showLyrics, currentTrack?.url]);

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

    
  const lastPrefetchUrl = useRef<string | null>(null);
  useEffect(() => {
    const nextUrl = queue[0]?.url;
    
    if (nextUrl && !nextUrl.startsWith('local://') && nextUrl !== lastPrefetchUrl.current) {
      lastPrefetchUrl.current = nextUrl;
      invoke('prefetch_track', { url: nextUrl }).catch(() => {});
    }
  }, [queue]);

  
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => { invoke<AudioInfo>('get_audio_info').then(setAudioInfo).catch(() => {}); }, 6000);
    invoke<AudioInfo>('get_audio_info').then(setAudioInfo).catch(() => {});
    return () => clearInterval(id);
  }, [isPlaying]);

  
  const setPlaybackSpeed = useCallback((s: number) => {
    setPlaybackSpeedState(s);
    invoke('set_playback_speed', { speed: s }).catch(() => {});
    showToast(`Speed: ${s}x`);
  }, [showToast]);

  const setSleepTimerMinutes = useCallback((m: number) => {
    invoke('set_sleep_timer', { seconds: m * 60 })
      .then(() => { setSleepTimerState(m * 60); showToast(`Sleep timer: ${m}m`); })
      .catch(() => {});
  }, [showToast]);

  const cancelSleepTimer = useCallback(() => {
    invoke('cancel_sleep_timer').then(() => { setSleepTimerState(-1); showToast('Sleep timer cancelled'); }).catch(() => {});
  }, [showToast]);

  
  const handleBackup = useCallback(async () => {
    try {
      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        playlists, queue, playHistory, playCounts, listenSecs, dailyPlays, firstSeen,
        shuffle, repeatMode, volume, playbackSpeed, eq,
        downloadQuality, downloadFormat, downloadPath, backupPath,
        embedThumbnail, duplicateDetect,
        loudnormEnabled, streamQuality, skipSilence,
        searchHistory, quickPicks, currentTrack,
      };
      const json = JSON.stringify(data, null, 2);
      const sep = navigator.platform.includes('Win') ? '\\' : '/';
      const resolvedBase = backupPath || downloadPath || '';
      if (resolvedBase) {
        const filePath = resolvedBase.replace(/[/\\]$/, '') + sep + 'vanguard_backup.json';
        await invoke('write_text_file', { path: filePath, content: json });
        showToast(`Backup saved to ${filePath}`);
      } else {
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'vanguard_backup.json'; a.click();
        URL.revokeObjectURL(url);
        showToast('Backup saved — set a Backup Location in Storage settings to choose a folder');
      }
    } catch (e) { showToast(`Backup failed: ${e}`); }
  }, [playlists, queue, playHistory, playCounts, listenSecs, dailyPlays, firstSeen,
      shuffle, repeatMode, volume, playbackSpeed, eq,
      downloadQuality, downloadFormat, downloadPath, backupPath,
      embedThumbnail, duplicateDetect, loudnormEnabled, streamQuality, skipSilence,
      searchHistory, quickPicks, currentTrack, showToast]);

  // Must be synchronous so the file picker works in Tauri (async breaks gesture context)
  const handleRestore = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async (e) => {
      document.body.removeChild(input);
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.version !== 1) { showToast('Invalid or incompatible backup file'); return; }

        // Restore every field and persist each to localStorage immediately
        const ls = <T,>(key: string, val: T): T => { saveLS(key, val); return val; };

        if (data.playlists)       setPlaylists(ls('vg_playlists', data.playlists));
        if (data.queue)           setQueue(ls('vg_queue', data.queue));
        if (data.playHistory)     setPlayHistory(ls('vg_playHistory', data.playHistory));
        if (data.playCounts)      setPlayCounts(ls('vg_playCounts', data.playCounts));
        if (data.listenSecs)      setListenSecs(ls('vg_listenSecs', data.listenSecs));
        if (data.dailyPlays)      setDailyPlays(ls('vg_dailyPlays', data.dailyPlays));
        if (data.firstSeen)       setFirstSeen(ls('vg_firstSeen', data.firstSeen));
        if (data.shuffle !== undefined) setShuffle(ls('vg_shuffle', data.shuffle));
        if (data.repeatMode)      setRepeatMode(ls('vg_repeat', data.repeatMode));
        if (data.volume !== undefined)  { setVolume(ls('vg_volume', data.volume)); invoke('set_volume', { volume: data.volume }).catch(() => {}); }
        if (data.playbackSpeed)   setPlaybackSpeedState(ls('vg_speed', data.playbackSpeed));
        if (data.eq)              setEqState(ls('vg_eq', data.eq));
        if (data.downloadQuality) setDownloadQuality(ls('vg_dlQuality', data.downloadQuality));
        if (data.downloadFormat)  setDownloadFormatState(ls('vg_dlFormat', data.downloadFormat));
        if (data.downloadPath)    setDownloadPath(ls('vg_dlPath', data.downloadPath));
        if (data.backupPath)      setBackupPath(ls('vg_backupPath', data.backupPath));
        if (data.embedThumbnail !== undefined) setEmbedThumbnailState(ls('vg_embedThumb', data.embedThumbnail));
        if (data.duplicateDetect !== undefined) setDuplicateDetectState(ls('vg_dupDetect', data.duplicateDetect));
        if (data.loudnormEnabled !== undefined) { setLoudnormEnabledState(ls('vg_loudnorm', data.loudnormEnabled)); invoke('set_loudnorm_enabled', { enabled: data.loudnormEnabled }).catch(() => {}); }
        if (data.streamQuality)   { setStreamQualityState(ls('vg_streamQuality', data.streamQuality)); invoke('set_stream_quality', { quality: data.streamQuality }).catch(() => {}); }
        if (data.skipSilence !== undefined) { setSkipSilenceState(ls('vg_skipSilence', data.skipSilence)); invoke('set_skip_silence', { enabled: data.skipSilence }).catch(() => {}); }
        if (data.searchHistory)   setSearchHistory(ls('vg_searchHistory', data.searchHistory));
        if (data.quickPicks)      setQuickPicks(ls('vg_quickPicks', data.quickPicks));
        if (data.currentTrack)    { setCurrentTrack(data.currentTrack); currentTrackRef.current = data.currentTrack; }

        showToast('Backup restored — all data loaded');
      } catch (err) {
        showToast(`Restore failed: could not read file (${err})`);
      }
    };
    input.click();
  }, [showToast, setBackupPath]);

  
  const handlePlayTrack = useCallback(async (track: Track, fromQueue = false) => {
    endDetectedRef.current = false;
    setAbLoop({ a: null, b: null }); abLoopRef.current = { a: null, b: null };
    setCurrentTrack(track); currentTrackRef.current = track;
    setCurrentLocalPath(null); currentLocalPathRef.current = null;
    setIsLoadingTrack(true); setIsPlayingSync(false);
    setProgressSeconds(0); progressSecondsRef.current = 0;
    setTrackDurationSeconds(0); trackDurationRef.current = 0;
    setWaveformData([]); setAudioInfo(null);
    setLyricsData(null); // clear stale lyrics on every new track

    // Always track play counts and daily plays, even for autoplay/queue
    setPlayCounts(prev => { const n = { ...prev, [track.url]: (prev[track.url] || 0) + 1 }; saveLS('vg_playCounts', n); return n; });
    const today = new Date().toISOString().slice(0, 10);
    setDailyPlays(prev => { const n = { ...prev, [today]: (prev[today] || 0) + 1 }; saveLS('vg_dailyPlays', n); return n; });
    setFirstSeen(prev => { if (prev[track.url]) return prev; const n = { ...prev, [track.url]: new Date().toISOString() }; saveLS('vg_firstSeen', n); return n; });

    if (!fromQueue) {
      setPlayHistory(prev => [track, ...prev].slice(0, 50));
      
      if (playlistContextRef.current) {
        const idx = playlistContextRef.current.tracks.findIndex(t => t.url === track.url);
        if (idx >= 0) playlistContextRef.current = { ...playlistContextRef.current, index: idx };
        else playlistContextRef.current = null; 
      }
    }
    setQuickPicks(prev => [track, ...prev.filter(t => t.url !== track.url)].slice(0, 20));

    try {
      await invoke('play_audio', { url: track.url });
      await invoke('set_volume', { volume });
      await invoke('set_playback_speed', { speed: playbackSpeed });
      await invoke('set_equalizer', { bass: eq.bass, mid: eq.mid, treble: eq.treble });

      // With persistent mpv + loadfile replace, play_audio returns fast (~200ms).
      // Poll until mpv reports duration > 0 (file opened and demuxed), then explicitly unpause.
      let waited = 0;
      await new Promise<void>(resolve => {
        const t = setInterval(async () => {
          waited += 200;
          try {
            const s: { position: number; duration: number; playing: boolean; paused: boolean } = await invoke('get_playback_state');
            if (s.duration > 0 || s.playing) {
              if (s.duration > 0) { setTrackDurationSeconds(s.duration); trackDurationRef.current = s.duration; }
              // Explicitly unpause if mpv started in paused state
              if (s.paused) { invoke('pause_audio').catch(() => {}); }
              clearInterval(t); resolve(); return;
            }
          } catch {}
          if (waited >= 12000) { clearInterval(t); resolve(); }
        }, 200);
      });

      setIsPlayingSync(true);

      // Poll for codec info — mpv reports 'unknown' until the demuxer finishes.
      // Keep retrying for up to 6s so the player bar never shows "UNKNOWN".
      let codecWaited = 0;
      const codecPoll = setInterval(async () => {
        codecWaited += 400;
        try {
          const info: AudioInfo = await invoke('get_audio_info');
          if (info?.codec && info.codec !== 'unknown' && info.codec !== '') {
            setAudioInfo(info);
            clearInterval(codecPoll);
          }
        } catch {}
        if (codecWaited >= 6000) clearInterval(codecPoll);
      }, 400);

      const bm = bookmarksRef.current[track.url];
      if (bm && bm > 2) {
        setTimeout(() => invoke('seek_audio', { time: bm }).catch(() => {}), 800);
      }
    } catch { setIsPlayingSync(false); }
    finally { setIsLoadingTrack(false); }
  }, [volume, playbackSpeed, eq, setIsPlayingSync]);

  
  const handlePlayLocalTrack = useCallback(async (local: LocalTrack, localList?: LocalTrack[], localIndex?: number) => {
    endDetectedRef.current = false;
    setCurrentLocalPath(local.path); currentLocalPathRef.current = local.path;
    
    if (localList !== undefined) {
      localTracksListRef.current = localList;
      localTrackIndexRef.current = localIndex ?? 0;
    } else if (localTracksListRef.current.length === 0) {
      
      localTracksListRef.current = [local];
      localTrackIndexRef.current = 0;
    } else {
      
      const idx = localTracksListRef.current.findIndex(t => t.path === local.path);
      if (idx >= 0) localTrackIndexRef.current = idx;
    }

    
    setIsLoadingTrack(false); setIsPlayingSync(false);
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

    
    if (local.duration && local.duration !== '0:00') {
      const d = parseDurationToSeconds(local.duration);
      if (d > 0) { setTrackDurationSeconds(d); trackDurationRef.current = d; }
    }

    
    invoke<number[]>('get_waveform_thumbnail', { path: local.path })
      .then(setWaveformData).catch(() => setWaveformData([]));

    try {
      await invoke('play_local_file', { path: local.path });
      await invoke('set_volume', { volume });
      await invoke('set_playback_speed', { speed: playbackSpeed });
      
      setIsPlayingSync(true);
      
      setTimeout(async () => {
        try {
          const s: { position: number; duration: number } = await invoke('get_playback_state');
          if (s.duration > 0) { setTrackDurationSeconds(s.duration); trackDurationRef.current = s.duration; }
        } catch {}
      }, 300);
    } catch { setIsPlayingSync(false); }
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

  const handleExportPlaylistM3u = useCallback(async (playlist: Playlist) => {
    try {
      const tracks = playlist.tracks.map(t => ({
        title: t.title, artist: t.artist || '',
        url: t.url,
        duration_secs: t.duration ? Math.round(parseDurationToSeconds(t.duration)) : 0,
      }));
      const safeName = playlist.name.replace(/[/\\:*?"<>|]/g, '_');
      const path = `${downloadPath}/${safeName}.m3u`;
      await invoke('export_playlist_m3u', { tracks, path });
      showToast(`Exported "${playlist.name}" to ${path}`);
    } catch (e) { showToast(`Export failed: ${e}`); }
  }, [downloadPath, showToast]);

  const handleImportPlaylistM3u = useCallback(() => {
    // Must be synchronous from user gesture for file picker to work in Tauri
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.m3u,.m3u8';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = async (e) => {
      document.body.removeChild(input);
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        if (!lines.length) { showToast('Empty M3U file'); return; }

        const tracks: Track[] = [];
        let pendingTitle = '';
        let pendingArtist = '';

        for (const line of lines) {
          if (line.startsWith('#EXTINF:')) {
            // #EXTINF:duration,Artist - Title
            const meta = line.slice(line.indexOf(',') + 1);
            const dashIdx = meta.indexOf(' - ');
            if (dashIdx !== -1) {
              pendingArtist = meta.slice(0, dashIdx).trim();
              pendingTitle  = meta.slice(dashIdx + 3).trim();
            } else {
              pendingTitle  = meta.trim();
              pendingArtist = '';
            }
          } else if (!line.startsWith('#')) {
            const url = line;
            // Extract YouTube video ID for cover art
            const ytId = url.match(/(?:[?&]v=|youtu\.be\/)([A-Za-z0-9_-]{11})/)?.[1] || '';
            // If no EXTINF title, derive from URL
            if (!pendingTitle) {
              pendingTitle = ytId
                ? 'YouTube Track'
                : url.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Track';
            }
            tracks.push({
              id: Date.now() + tracks.length,
              title:  pendingTitle,
              artist: pendingArtist,
              duration: '0:00',
              url,
              cover: ytId ? `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg` : '',
            });
            pendingTitle = '';
            pendingArtist = '';
          }
        }

        if (!tracks.length) { showToast('No tracks found in M3U file'); return; }
        const name = file.name.replace(/\.m3u8?$/i, '');
        setPlaylists(prev => [...prev, {
          id: `pl_${Date.now()}`,
          name,
          description: `Imported from ${file.name}`,
          tracks,
        }]);
        showToast(`Imported "${name}" — ${tracks.length} track${tracks.length !== 1 ? 's' : ''}`);
      } catch (err) {
        showToast(`Import failed: ${err}`);
      }
    };
    input.click();
  }, [showToast, setPlaylists]);

  
  const handlePlayInContext = useCallback((track: Track, contextList: Track[]) => {
    const idx = contextList.findIndex(t => t.url === track.url);
    playlistContextRef.current = { tracks: contextList, index: Math.max(0, idx) };
    setQueue([]); 
    handlePlayTrack(track, true);
    
  }, [handlePlayTrack]);

  
  const togglePlayPause = useCallback(async () => {
    if (!currentTrackRef.current) return;
    
    if (!isPlayingRef.current) {
      try {
        const state: { playing: boolean; paused: boolean; position: number; duration: number; eof_reached: boolean } =
          await invoke('get_playback_state');
        // If mpv has no file loaded (position=0, not paused), restart the track from beginning
        if (state.position === 0 && !state.paused) {
          await handlePlayTrack(currentTrackRef.current, true);
          return;
        }
      } catch {
        // mpv not running — restart from beginning
        await handlePlayTrack(currentTrackRef.current, true);
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

    
    const q = queueRef.current;
    if (q.length > 0) { const [next, ...rest] = q; setQueue(rest); await handlePlayTrack(next, true); }
  }, [handlePlayTrack, handlePlayLocalTrack, shuffle]);

  const handleSkipBack = useCallback(async () => {
    const track = currentTrackRef.current;
    const isLocal = track?.url?.startsWith('local://');

    
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

    
    if (progressSecondsRef.current > 3) {
      await invoke('seek_audio', { time: 0 }).catch(() => {});
      progressSecondsRef.current = 0; setProgressSeconds(0);
      return;
    }

    
    const ctx = playlistContextRef.current;
    if (ctx && ctx.index > 0) {
      const prevIdx = ctx.index - 1;
      playlistContextRef.current = { ...ctx, index: prevIdx };
      await handlePlayTrack(ctx.tracks[prevIdx], true);
      return;
    }

    
    if (playHistory.length > 0) {
      const [prev, ...rest] = playHistory; setPlayHistory(rest); await handlePlayTrack(prev, true);
    } else {
      await invoke('seek_audio', { time: 0 }).catch(() => {});
      progressSecondsRef.current = 0; setProgressSeconds(0);
    }
  }, [playHistory, handlePlayTrack, handlePlayLocalTrack]);

  mprisToggleRef.current = togglePlayPause;
  mprisNextRef.current   = handleSkipForward;
  mprisPrevRef.current   = handleSkipBack;

  const toggleShuffle = useCallback(() => setShuffle(p => { showToast(!p ? 'Shuffle on' : 'Shuffle off'); return !p; }), [showToast]);
  const cycleRepeat = useCallback(() => setRepeatMode(p => {
    const n: RepeatMode = p === 'off' ? 'all' : p === 'all' ? 'one' : 'off';
    repeatModeRef.current = n;
    showToast(n === 'off' ? 'Repeat off' : n === 'all' ? 'Repeat all' : 'Repeat one');
    return n;
  }), [showToast]);

  
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.code === 'Space' && !isInput) { e.preventDefault(); togglePlayPause(); }
      if (e.code === 'ArrowRight' && !isInput && currentTrackRef.current) { e.preventDefault(); invoke('seek_relative', { seconds: 10 }).catch(() => {}); }
      if (e.code === 'ArrowLeft' && !isInput && currentTrackRef.current) { e.preventDefault(); invoke('seek_relative', { seconds: -10 }).catch(() => {}); }
      if (e.code === 'KeyM' && !isInput) toggleMute();
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === '?' && !isInput) { e.preventDefault(); setShowShortcuts(s => !s); }
      if (e.code === 'Escape') { setShowShortcuts(false); setConfirmModal(null); }

    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [togglePlayPause, toggleMute]);



  
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

    
    if (isLocal) {
      const list = localTracksListRef.current;
      const idx = localTrackIndexRef.current;
      if (list.length > 1) {
        let nextIdx: number;
        if (shuffle) {
          
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
        
        invoke('seek_to_start').catch(() => {});
        progressSecondsRef.current = 0; setProgressSeconds(0);
        setIsPlayingSync(true);
        setTimeout(() => { endDetectedRef.current = false; }, 1500);
        return;
      }
      setIsPlayingSync(false);
      return;
    }

    
    const q = queueRef.current;
    if (q.length > 0) {
      const [next, ...rest] = q;
      queueRef.current = rest;
      setQueue(rest);
      setTimeout(() => handlePlayTrack(next, true), 0);
      return;
    }

    
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

    
    setIsPlayingSync(false);
  }, [handlePlayTrack, handlePlayLocalTrack, setIsPlayingSync, shuffle]);

  
  useEffect(() => {
    const poll = async () => {
      if (isDraggingProgressRef.current) return;
      try {
        const s: { playing: boolean; paused: boolean; position: number; duration: number; eof_reached: boolean } =
          await invoke('get_playback_state');

        progressSecondsRef.current = s.position;
        setProgressSeconds(s.position);
        
        const ab = abLoopRef.current;
        if (ab.a !== null && ab.b !== null && s.position >= ab.b) {
          invoke('seek_audio', { time: ab.a }).catch(() => {});
        }

        if (s.duration > 0 && s.duration !== trackDurationRef.current) {
          trackDurationRef.current = s.duration; setTrackDurationSeconds(s.duration);
        }

        
        if (!isLoadingTrack && !endDetectedRef.current) {
          const playing = !s.paused;
          if (playing !== isPlayingRef.current) setIsPlayingSync(playing);
        }

        
        if (!s.eof_reached && !endDetectedRef.current && s.position > 3 && s.duration > 0
            && crossfadeSeconds > 0 && s.position >= s.duration - crossfadeSeconds - 0.5
            && s.position < s.duration - 0.2) {
          
          const fadeSteps = Math.max(1, Math.round(crossfadeSeconds * 5));
          const volStep = (volume / fadeSteps);
          let step = 0;
          const fadeInterval = setInterval(() => {
            step++;
            const newVol = Math.max(0, volume - volStep * step);
            invoke('set_volume', { volume: newVol }).catch(() => {});
            if (step >= fadeSteps) {
              clearInterval(fadeInterval);
              invoke('set_volume', { volume }).catch(() => {}); 
              if (!endDetectedRef.current) handleTrackEnd();
            }
          }, (crossfadeSeconds * 1000) / fadeSteps);
          
          return;
        }
        
        if (s.eof_reached && !endDetectedRef.current && s.position > 3) {
          handleTrackEnd();
          return;
        }
        
        if (!s.eof_reached && !endDetectedRef.current && s.position > 3 && s.duration > 0 && s.position >= s.duration - 1.0) {
          handleTrackEnd();
        }
      } catch {}
    };

    const id = setInterval(poll, isPlaying ? 500 : 2000);
    return () => clearInterval(id);
  }, [isPlaying, isLoadingTrack, handleTrackEnd, setIsPlayingSync]);

  
  const handleSelectDirectory = useCallback(async () => {
    try {
      const sel = await open({ directory: true, multiple: false, defaultPath: downloadPath });
      if (sel) setDownloadPath(sel as string);
    } catch {}
  }, [downloadPath]);

  
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

  // Scroll wheel on volume — must be non-passive to call preventDefault
  useEffect(() => {
    const el = volumeRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setVolume(prev => {
        const next = Math.max(0, Math.min(100, prev + (e.deltaY < 0 ? 5 : -5)));
        invoke('set_volume', { volume: next }).catch(() => {});
        return next;
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
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

  
  const openCtx = useCallback((e: React.MouseEvent, menu: Omit<CtxMenu, 'x' | 'y'>) => {
    e.preventDefault(); e.stopPropagation();
    const { x, y } = clampMenu(e.clientX, e.clientY);
    setCtxMenu({ x, y, ...menu });
  }, []);

  
  const handleDownload = useCallback(async (track: Track) => {
    if (duplicateDetect) {
      try {
        const scanned: LocalTrack[] = await invoke('scan_downloads', { path: downloadPath });
        const existing = scanned.map(t => t.title.toLowerCase());
        if (existing.includes(track.title.toLowerCase())) {
          showToast(`Already downloaded: ${track.title}`);
          return;
        }
      } catch { /* proceed if check fails */ }
    }
    setDownloadingTracks(p => ({ ...p, [track.url]: 1 }));
    // Simulate smooth progress while yt-dlp runs (actual progress not available via IPC)
    let prog = 1;
    const progInterval = setInterval(() => {
      prog = Math.min(prog + Math.random() * 8, 90);
      setDownloadingTracks(p => p[track.url] !== undefined ? { ...p, [track.url]: prog } : p);
    }, 400);
    try {
      await invoke('download_song', { url: track.url, quality: downloadQuality, format: downloadFormat, embedThumbnail, path: downloadPath });
      clearInterval(progInterval);
      setDownloadingTracks(p => ({ ...p, [track.url]: 100 }));
      setTimeout(() => setDownloadingTracks(p => { const n = {...p}; delete n[track.url]; return n; }), 1200);
      showToast(`Downloaded: ${track.title}`);
    } catch {
      clearInterval(progInterval);
      setDownloadingTracks(p => { const n = {...p}; delete n[track.url]; return n; });
      showToast('Download failed');
    }
  }, [downloadQuality, downloadFormat, embedThumbnail, duplicateDetect, downloadPath, showToast]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      
      if (typeof navigator?.clipboard?.writeText === 'function') {
        await navigator.clipboard.writeText(text);
      } else {
        
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
    inp.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(inp);
    inp.onchange = e => {
      const f = (e.target as HTMLInputElement).files?.[0];
      if (f) {
        const r = new FileReader();
        r.onload = ev => {
          const d = ev.target?.result as string;
          if (d) { setPlaylists(p => p.map(x => x.id === pid ? { ...x, customCover: d } : x)); showToast('Cover updated'); }
        };
        r.readAsDataURL(f);
      }
      inp.remove();
    };
    inp.oncancel = () => inp.remove();
    inp.click();
  }, [showToast]);

  const isTrackLiked = useCallback((url: string) => playlists.find(p => p.id === 'p1')?.tracks.some(t => t.url === url) || false, [playlists]);
  const getPlaylistCover = (p: Playlist) => p.id === 'p1' ? null : (p.customCover || p.tracks[0]?.cover || null);

  const playAll = useCallback((list: Track[]) => {
    if (!list.length) return;
    const sorted = shuffle ? [...list].sort(() => Math.random() - 0.5) : [...list];
    
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

  
  return (
    <div className="flex flex-col h-screen w-full bg-[#050505] text-white font-sans overflow-hidden selection:bg-[#39FF14] selection:text-black"
      onContextMenu={e => e.preventDefault()}>
      <style>{`
        @keyframes loadbar { 0%{transform:translateX(-100%)} 50%{transform:translateX(150%)} 100%{transform:translateX(400%)} }
        @keyframes dropIn { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeUpSm { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes toastIn { from{opacity:0;transform:translateX(-50%) translateY(6px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes barBounce { 0%,100%{transform:scaleY(0.35)} 50%{transform:scaleY(1)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes slideLeft { from{opacity:0;transform:translateX(10px)} to{opacity:1;transform:translateX(0)} }
        @keyframes popIn { from{opacity:0;transform:scale(0.92)} to{opacity:1;transform:scale(1)} }
        @keyframes queuePulse { 0%{transform:scale(1)} 40%{transform:scale(1.45)} 70%{transform:scale(0.9)} 100%{transform:scale(1)} }
        .queue-badge-pulse { animation: queuePulse 0.4s cubic-bezier(0.2,0,0,1) both; }
        .slider-track:hover .slider-thumb{opacity:1!important;transform:translateY(-50%) scale(1.25)}
        .custom-scrollbar::-webkit-scrollbar{width:4px}
        .custom-scrollbar::-webkit-scrollbar-track{background:transparent}
        .custom-scrollbar::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
        .custom-scrollbar::-webkit-scrollbar-thumb:hover{background:#444}
        *{-webkit-user-select:none!important;user-select:none!important;}
        input,textarea{-webkit-user-select:text!important;user-select:text!important;}
        .home-card { animation: fadeUp 0.22s cubic-bezier(0.2,0,0,1) both; }
        .home-card:hover { transform: translateY(-1px); }
        .ctx-menu { animation: popIn 0.15s cubic-bezier(0.2,0,0,1) both; }
        .playlist-card { transition: transform 0.15s ease, box-shadow 0.15s ease; }
        .playlist-card:hover { transform: translateY(-2px); }
      `}</style>

      <div className="flex flex-1 overflow-hidden">

        {}
        <div className="w-64 bg-[#0a0a0a] border-r border-neutral-800/50 flex flex-col p-6 z-10 shrink-0 overflow-visible relative">
          {}
          <div className="flex items-center gap-2 mb-6 shrink-0">
            <div className="flex items-center gap-3 flex-1 cursor-pointer group" onClick={() => navigateTo('home')}>
              <div className="w-8 h-8 rounded bg-[#39FF14] flex items-center justify-center shadow-[0_0_15px_rgba(57,255,20,0.5)] group-hover:shadow-[0_0_25px_rgba(57,255,20,0.8)] transition-all duration-300 shrink-0">
                <Music size={20} className="text-black" />
              </div>
              <h1 className="text-2xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#39FF14] to-emerald-200 drop-shadow-[0_0_8px_rgba(57,255,20,0.6)]">VANGUARD</h1>
            </div>
          </div>

          {}
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
                  ${activeNav === id ? 'bg-[#39FF14]/10 text-[#39FF14] shadow-[inset_2px_0_0_#39FF14]' : 'text-neutral-300 hover:text-[#39FF14] hover:bg-neutral-900/60'}`}>
                <Icon size={20} className={activeNav === id ? 'drop-shadow-[0_0_5px_#39FF14]' : 'opacity-80'} />
                <span className="font-medium">{label}</span>
              </button>
            ))}
            <button onClick={() => setIsQueueOpen(o => !o)}
              className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-200 w-full text-left
                ${isQueueOpen ? 'bg-[#39FF14]/10 text-[#39FF14] shadow-[inset_2px_0_0_#39FF14]' : 'text-neutral-300 hover:text-[#39FF14] hover:bg-neutral-900/60'}`}>
              <ListOrdered size={20} className={isQueueOpen ? 'drop-shadow-[0_0_5px_#39FF14]' : 'opacity-80'} />
              <span className="font-medium">Queue</span>
              {queue.length > 0 && <span key={queuePulseKey} className="ml-auto bg-[#39FF14] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none queue-badge-pulse">{queue.length}</span>}
            </button>
          </nav>

          {}
          <div className="mt-5 flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between px-1 mb-2 shrink-0">
              <button onClick={() => { setSidebarPlaylistsExpanded(o => !o); navigateTo('library'); setOpenPlaylistId(null); }}
                className={`flex items-center gap-3 flex-1 py-2 px-3 rounded-lg transition-all duration-200 text-left ${activeNav === 'library' ? 'text-[#39FF14]' : 'text-neutral-300 hover:text-[#39FF14] hover:bg-neutral-900/60'}`}>
                <ListMusic size={20} className={activeNav === 'library' ? 'drop-shadow-[0_0_5px_#39FF14]' : 'opacity-80'} />
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

          <ImportButton
            onSpotify={() => setShowCsvImportModal(true)}
            onYoutube={() => setShowYtImportModal(true)}
            onM3u={handleImportPlaylistM3u}
          />
        </div>

        {}
        <div className="flex-1 flex flex-col bg-gradient-to-b from-[#0f1115] to-[#050505] overflow-hidden relative">
          <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#39FF14]/10 via-transparent to-transparent" />

          <div className="flex items-center gap-3 px-6 pt-4 pb-0 shrink-0 z-20 relative">
            <button
              onClick={() => {
                if (activeNav === 'home' && tracks.length > 0) {
                  setTracks([]); setSearchQuery(''); setIsSearching(false);
                } else {
                  navigateBack();
                }
              }}
              disabled={activeNav === 'home' && tracks.length === 0}
              title="Go back"
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all duration-200
                ${(activeNav !== 'home' || tracks.length > 0)
                  ? 'text-white border-neutral-700 bg-neutral-900/80 hover:border-[#39FF14]/50 hover:text-[#39FF14] hover:bg-[#39FF14]/5 active:scale-95'
                  : 'text-neutral-700 border-neutral-800/40 bg-neutral-900/30 cursor-not-allowed opacity-40'}`}
            >
              <ChevronLeft size={16} />
              <span>Back</span>
            </button>
            <span className="text-xs text-neutral-600 font-medium uppercase tracking-widest">
              {activeNav === 'home' ? 'Home' : activeNav === 'downloads' ? 'Offline' : activeNav === 'settings' ? 'Settings' : activeNav === 'stats' ? 'Stats' : activeNav === 'library' ? (openPlaylistId ? 'Playlist' : 'Playlists') : activeNav}
            </span>
          </div>

          {}
          <div key={activeNav + (openPlaylistId || '')} style={{ animation: 'fadeUp 0.2s cubic-bezier(0.25,0,0,1) both' }} className="flex-1 flex flex-col overflow-hidden min-h-0">
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
                  {updateAvailable && (
                    <button
                      onClick={() => { setActiveNav('settings'); }}
                      title={`Update available — v${updateAvailable}`}
                      className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl border border-[#39FF14]/30 bg-[#39FF14]/[0.06] text-[#39FF14] hover:bg-[#39FF14]/15 transition-all duration-200 relative"
                    >
                      <Info size={17} />
                      <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#39FF14] shadow-[0_0_5px_#39FF14]" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 pb-4 z-10 custom-scrollbar" onClick={() => setShowHistory(false)}>
                {}
                {!isSearching && tracks.length === 0 && quickPicks.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-6">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-2xl bg-neutral-900 border border-neutral-800/60 flex items-center justify-center shadow-[0_0_40px_rgba(57,255,20,0.05)]">
                        <Music size={36} strokeWidth={1} className="text-neutral-700" />
                      </div>
                      <div className="absolute -bottom-2 -right-2 w-7 h-7 bg-[#39FF14]/10 rounded-full flex items-center justify-center border border-[#39FF14]/20 shadow-[0_0_12px_rgba(57,255,20,0.15)]">
                        <Search size={12} className="text-[#39FF14]/60" />
                      </div>
                    </div>
                    <div className="text-center flex flex-col gap-1.5">
                      <p className="text-sm font-semibold text-neutral-500">Search YouTube to start</p>
                      <p className="text-xs text-neutral-700">Type above and press Enter, or use <kbd className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-900 border border-neutral-800 text-neutral-500">Ctrl+F</kbd></p>
                    </div>
                  </div>
                )}

                {!isSearching && tracks.length === 0 && quickPicks.length > 0 && isHydrated && (() => {
                  // --- Genre detection via keyword matching on title + artist ---
                  const GENRES: { id: string; label: string; keywords: string[] }[] = [
                    { id: 'hiphop',    label: 'Hip-Hop / Rap',    keywords: ['rap','hip hop','hip-hop','trap','drill','freestyle','cypher','bars','lil ','young ','big ','21 savage','kendrick','drake','kanye','jay-z','eminem','nicki','cardi','asap','uzi','juice','polo g','gunna','future','offset','quavo','takeoff','21savage','dababy','roddy','pooh shiesty','moneybagg'] },
                    { id: 'synthwave', label: 'Synthwave',        keywords: ['synthwave','retrowave','outrun','neon','vaporwave','dreamwave','80s','retro wave','chillwave','darksynth','perturbator','kavinsky','gunship','carpenter brut','the midnight','timecop1983','FM-84','dreamwave','miami','nightcall'] },
                    { id: 'lofi',      label: 'Lo-Fi',            keywords: ['lofi','lo-fi','lo fi','chill beats','study beats','study music','sleep music','relax beats','chillhop','cafe music','coffee','anime lofi','jazz hop','nujabes'] },
                    { id: 'pop',       label: 'Pop',              keywords: ['pop','taylor swift','ariana','billie eilish','the weeknd','olivia rodrigo','dua lipa','harry styles','justin bieber','ed sheeran','selena','shawn mendes','camila','chainsmokers','imagine dragons','maroon 5','post malone'] },
                    { id: 'rock',      label: 'Rock',             keywords: ['rock','metal','punk','grunge','alternative','linkin park','nirvana','green day','foo fighters','system of a down','metallica','acdc','ac/dc','guns n roses','queen','led zeppelin','arctic monkeys','radiohead','muse','twenty one pilots','bring me','parkway drive','bmth','slipknot'] },
                    { id: 'rnb',       label: 'R&B / Soul',       keywords: ['r&b','rnb','soul','neo soul','smooth','frank ocean','sza','daniel caesar','jorja smith','h.e.r.','bryson tiller','partynextdoor','brent faiyaz','khalid','usher','alicia keys','john legend','maxwell','erykah badu','d\'angelo'] },
                    { id: 'edm',       label: 'EDM / Dance',      keywords: ['edm','electronic','dance','techno','house','trance','dubstep','dnb','drum and bass','bass','club','rave','festival','martin garrix','david guetta','tiesto','avicii','marshmello','skrillex','deadmau5','flume','diplo','zedd','alan walker','kygo','dj'] },
                    { id: 'jazz',      label: 'Jazz',             keywords: ['jazz','blues','swing','bebop','miles davis','coltrane','bill evans','thelonious','monk','duke ellington','charlie parker','herbie hancock','wynton','louis armstrong','nina simone'] },
                    { id: 'classical', label: 'Classical',        keywords: ['classical','orchestra','symphony','beethoven','mozart','bach','chopin','debussy','brahms','schubert','vivaldi','handel','liszt','tchaikovsky','strauss','mahler','piano sonata','concerto','sonata','nocturne','étude'] },
                    { id: 'kpop',      label: 'K-Pop',            keywords: ['kpop','k-pop','bts','blackpink','exo','nct','stray kids','twice','red velvet','aespa','ive','new jeans','newjeans','itzy','mamamoo','seventeen','got7','shinee','bigbang','2ne1','super junior','astro','monsta x','ateez'] },
                    { id: 'afrobeats', label: 'Afrobeats',        keywords: ['afrobeats','afrobeat','amapiano','burna boy','wizkid','davido','rema','omah lay','ckay','tems','ayra starr','afropop','naija','afro','fireboy'] },
                    { id: 'latin',     label: 'Latin',            keywords: ['latin','reggaeton','salsa','bachata','cumbia','bad bunny','j balvin','maluma','ozuna','daddy yankee','nicky jam','jhay cortez','anuel','karol g','rosalia','shakira','marc anthony','romeo santos'] },
                    { id: 'slowed',    label: 'Slowed + Reverb',  keywords: ['slowed','reverb','slowed and reverb','slowed reverb','slowed + reverb','night drive','late night','4am','3am','2am','midnight drive','sad slowed'] },
                    { id: 'phonk',     label: 'Phonk',            keywords: ['phonk','memphis','drift phonk','aggressive phonk','gym phonk','dark phonk','sakkijarven polkka','kordhell','ghostemane','bones','night lovell'] },
                  ];

                  // Map local files to Track shape for genre matching
                  const localAsTrack: Track[] = localTracksListRef.current.map((lt, i) => ({
                    id: -(i + 1), title: lt.title, artist: lt.artist || '',
                    url: `local://${lt.path}`, cover: '', duration: lt.duration || '',
                  }));

                  // Build the fullest possible track pool:
                  // quickPicks + playHistory + ALL local files + ALL playlist tracks
                  const allTracksForGenre = [...new Map([
                    ...quickPicks,
                    ...playHistory,
                    ...localAsTrack,
                    ...playlists.flatMap(p => p.tracks),
                  ].map(t => [t.url, t])).values()];

                  const genreScores: Record<string, { score: number; tracks: Track[] }> = {};
                  GENRES.forEach(g => { genreScores[g.id] = { score: 0, tracks: [] }; });

                  allTracksForGenre.forEach(track => {
                    const text = (track.title + ' ' + track.artist).toLowerCase();
                    const playCount = playCounts[track.url] || 1;
                    GENRES.forEach(g => {
                      if (g.keywords.some(kw => text.includes(kw))) {
                        genreScores[g.id].score += playCount;
                        if (!genreScores[g.id].tracks.find(t => t.url === track.url)) {
                          genreScores[g.id].tracks.push(track);
                        }
                      }
                    });
                  });

                  // Sort tracks within each genre by play count descending
                  GENRES.forEach(g => {
                    genreScores[g.id].tracks.sort((a, b) => (playCounts[b.url] || 0) - (playCounts[a.url] || 0));
                  });

                  const activeGenres = GENRES
                    .filter(g => genreScores[g.id].tracks.length >= 2)
                    .sort((a, b) => genreScores[b.id].score - genreScores[a.id].score)
                    .slice(0, 5);

                  const topTracks = Object.entries(playCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([url]) => allTracksForGenre.find(t => t.url === url))
                    .filter(Boolean) as Track[];
                  const recentHistory = playHistory.slice(0, 5);

                  return (
                    <div className="space-y-8 pt-1">

                      {/* Recently Played */}
                      <div>
                        <div className="flex items-center gap-3 mb-3">
                          <span className="w-1 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
                          <h2 className="text-sm font-bold text-white uppercase tracking-widest flex-1">Recently Played</h2>
                          <button onClick={() => setQuickPicks([])} className="text-[11px] text-neutral-600 hover:text-neutral-400 transition-colors">Clear</button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          {quickPicks.slice(0, 8).map((track, cardIdx) => {
                            const isActive = currentTrack?.url === track.url;
                            return (
                              <div key={track.url}
                                onClick={() => handlePlayInContext(track, quickPicks.slice(0, 8))}
                                onContextMenu={e => openCtx(e, { type: 'quickpick', track })}
                                className={`home-card flex items-center gap-3 rounded-xl p-3 cursor-pointer transition-all duration-200 group border
                                  ${isActive ? 'bg-[#39FF14]/[0.07] border-[#39FF14]/20' : 'bg-neutral-900/50 border-neutral-800/40 hover:bg-neutral-800/70 hover:border-neutral-700/60'}`}
                                style={{ animationDelay: `${cardIdx * 35}ms` }}>
                                <div className="relative w-11 h-11 rounded-lg overflow-hidden shrink-0 transition-transform duration-200 group-hover:scale-105">
                                  <img src={track.cover} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
                                  <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${isActive && isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    {isActive && isLoadingTrack
                                      ? <div className="w-3.5 h-3.5 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
                                      : isActive && isPlaying
                                        ? <div className="flex gap-[2px] items-end h-3">{[100, 65, 80].map((h, i) => <div key={i} className="w-[2px] bg-[#39FF14] rounded-full" style={{ height: `${h}%`, animation: `barBounce ${0.7 + i * 0.12}s ease-in-out ${i * 110}ms infinite`, transformOrigin: 'bottom' }} />)}</div>
                                        : <Play size={13} fill="white" className="text-white ml-0.5" />}
                                  </div>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-semibold truncate leading-tight ${isActive ? 'text-[#39FF14]' : 'text-white'}`}>{track.title}</p>
                                  <p className="text-xs text-neutral-500 truncate mt-0.5">{track.artist}</p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Genre shelves — auto-detected from listening history */}
                      {activeGenres.map((genre, gIdx) => {
                        const genreTracks = genreScores[genre.id].tracks.slice(0, 10);
                        return (
                          <div key={genre.id} style={{ animation: `fadeUp 0.22s cubic-bezier(0.2,0,0,1) ${gIdx * 60 + 100}ms both` }}>
                            <div className="flex items-center gap-3 mb-3">
                              <span className="w-1 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
                              <h2 className="text-sm font-bold text-white uppercase tracking-widest flex-1">
                                {genre.label}
                              </h2>
                              <span className="text-[10px] text-neutral-600">{genreTracks.length} tracks</span>
                            </div>
                            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1" style={{ scrollbarWidth: 'none' }}>
                              {genreTracks.map((track, tIdx) => {
                                const isActive = currentTrack?.url === track.url;
                                return (
                                  <div key={track.url}
                                    onClick={() => handlePlayInContext(track, genreTracks)}
                                    onContextMenu={e => openCtx(e, { type: 'track', track })}
                                    className="flex-shrink-0 w-36 group cursor-pointer"
                                    style={{ animation: `fadeUpSm 0.18s cubic-bezier(0.2,0,0,1) ${tIdx * 25 + gIdx * 60}ms both` }}>
                                    <div className={`relative w-36 h-36 rounded-xl overflow-hidden mb-2 border transition-all duration-200 group-hover:scale-[1.03] ${isActive ? 'border-[#39FF14]/40 shadow-[0_0_12px_rgba(57,255,20,0.2)]' : 'border-neutral-800/60'}`}>
                                      <img src={track.cover} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
                                      <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${isActive && isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                        {isActive && isPlaying
                                          ? <div className="flex gap-[3px] items-end h-5">{[100, 65, 80].map((h, j) => <div key={j} className="w-[3px] bg-[#39FF14] rounded-full" style={{ height: `${h}%`, animation: `barBounce ${0.7 + j * 0.12}s ease-in-out ${j * 110}ms infinite`, transformOrigin: 'bottom' }} />)}</div>
                                          : <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center"><Play size={18} fill="white" className="text-white ml-0.5" /></div>}
                                      </div>
                                      {isActive && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#39FF14] shadow-[0_0_6px_#39FF14]" />}
                                    </div>
                                    <p className={`text-xs font-semibold truncate ${isActive ? 'text-[#39FF14]' : 'text-white'}`}>{track.title}</p>
                                    <p className="text-[11px] text-neutral-500 truncate mt-0.5">{track.artist}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}

                      {/* Most Played */}
                      {topTracks.length >= 3 && (
                        <div style={{ animation: 'fadeUp 0.22s cubic-bezier(0.2,0,0,1) 200ms both' }}>
                          <div className="flex items-center gap-3 mb-3">
                            <span className="w-1 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
                            <h2 className="text-sm font-bold text-white uppercase tracking-widest flex-1">Most Played</h2>
                          </div>
                          <div className="flex flex-col gap-1">
                            {topTracks.map((track, i) => {
                              const isActive = currentTrack?.url === track.url;
                              const count = playCounts[track.url] || 0;
                              const maxCount = playCounts[topTracks[0].url] || 1;
                              return (
                                <div key={track.url}
                                  onClick={() => handlePlayInContext(track, topTracks)}
                                  onContextMenu={e => openCtx(e, { type: 'track', track })}
                                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 group border"
                                  style={{ animation: `fadeUpSm 0.2s cubic-bezier(0.2,0,0,1) ${i * 40}ms both`, ...(isActive ? { background: 'rgba(57,255,20,0.07)', borderColor: 'rgba(57,255,20,0.2)' } : { borderColor: 'transparent' }) }}
                                  onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.04)'; } }}
                                  onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = ''; (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; } }}>
                                  <span className="w-5 text-center text-xs font-bold text-neutral-600 tabular-nums shrink-0">{i + 1}</span>
                                  <img src={track.cover} alt={track.title} className="w-10 h-10 rounded-lg object-cover shrink-0" loading="lazy" />
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold truncate ${isActive ? 'text-[#39FF14]' : 'text-white'}`}>{track.title}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <div className="flex-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-[#39FF14]/60 rounded-full transition-all duration-500" style={{ width: `${(count / maxCount) * 100}%` }} />
                                      </div>
                                      <span className="text-[10px] text-neutral-600 tabular-nums shrink-0">{count}×</span>
                                    </div>
                                  </div>
                                  <div className={`transition-opacity ${isActive && isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    {isActive && isPlaying
                                      ? <div className="flex gap-[2px] items-end h-3">{[100, 65, 80].map((h, j) => <div key={j} className="w-[2px] bg-[#39FF14] rounded-full" style={{ height: `${h}%`, animation: `barBounce ${0.7 + j * 0.12}s ease-in-out ${j * 110}ms infinite`, transformOrigin: 'bottom' }} />)}</div>
                                      : <Play size={13} fill="white" className="text-white" />}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Play History */}
                      {recentHistory.length >= 3 && (
                        <div style={{ animation: 'fadeUp 0.22s cubic-bezier(0.2,0,0,1) 250ms both' }}>
                          <div className="flex items-center gap-3 mb-3">
                            <span className="w-1 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
                            <h2 className="text-sm font-bold text-white uppercase tracking-widest flex-1">Play History</h2>
                          </div>
                          <div className="flex flex-col gap-1">
                            {recentHistory.map((track, i) => {
                              const isActive = currentTrack?.url === track.url;
                              return (
                                <div key={track.url + i}
                                  onClick={() => handlePlayInContext(track, recentHistory)}
                                  onContextMenu={e => openCtx(e, { type: 'track', track })}
                                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-150 group border"
                                  style={{ animation: `fadeUpSm 0.2s cubic-bezier(0.2,0,0,1) ${i * 40}ms both`, ...(isActive ? { background: 'rgba(57,255,20,0.07)', borderColor: 'rgba(57,255,20,0.2)' } : { borderColor: 'transparent' }) }}
                                  onMouseEnter={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.04)'; } }}
                                  onMouseLeave={e => { if (!isActive) { (e.currentTarget as HTMLElement).style.background = ''; (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; } }}>
                                  <img src={track.cover} alt={track.title} className="w-10 h-10 rounded-lg object-cover shrink-0" loading="lazy" />
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-semibold truncate ${isActive ? 'text-[#39FF14]' : 'text-white'}`}>{track.title}</p>
                                    <p className="text-xs text-neutral-500 truncate mt-0.5">{track.artist}</p>
                                  </div>
                                  <div className={`transition-opacity ${isActive && isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                    {isActive && isPlaying
                                      ? <div className="flex gap-[2px] items-end h-3">{[100, 65, 80].map((h, j) => <div key={j} className="w-[2px] bg-[#39FF14] rounded-full" style={{ height: `${h}%`, animation: `barBounce ${0.7 + j * 0.12}s ease-in-out ${j * 110}ms infinite`, transformOrigin: 'bottom' }} />)}</div>
                                      : <Play size={13} fill="white" className="text-white" />}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                    </div>
                  );
                })()}

                {}
                {(isSearching || tracks.length > 0) && (
                  <div className="flex items-center gap-3 mb-3 py-2">
                    <span className="w-1.5 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
                    <h2 className="text-base font-bold text-white flex-1">{isSearching ? 'Searching...' : 'Results'}</h2>
                    {isSearching && <div className="flex gap-1 items-end h-4">{[100, 60, 80, 50].map((h, i) => <div key={i} className="w-1 bg-[#39FF14]/60 rounded-full" style={{ height: `${h}%`, animation: `barBounce ${0.65 + i * 0.1}s ease-in-out ${i * 100}ms infinite`, transformOrigin: "bottom" }} />)}</div>}
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
                        isLiked={isTrackLiked(track.url)} isDownloading={(downloadingTracks[track.url] ?? 0)}
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

          {}
          {activeNav === 'downloads' && (
            <DownloadsPanel
              downloadPath={downloadPath} onPlayLocalTrack={handlePlayLocalTrack}
              onDeleteLocalTrack={handleDeleteLocalTrack} currentTrackPath={currentLocalPath}
              isPlaying={isPlaying} isLoadingTrack={isLoadingTrack}
              onOpenInFileManager={handleOpenInFileManager} onExportM3u={handleExportM3u}
              onChangeFolder={handleSelectDirectory}
            />
          )}

          {}
          {activeNav === 'library' && (
            openPlaylist ? (
              <div className="flex-1 overflow-y-auto p-8 z-10 custom-scrollbar">
                <button onClick={() => { setOpenPlaylistId(null); setPlaylistSearchQ(''); }} className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors mb-8 group">
                  <ChevronLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
                  <span className="text-sm font-medium">Playlists</span>
                </button>
                <div className="flex items-end gap-6 mb-8">
                  <div className={`w-28 h-28 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center shrink-0 relative overflow-hidden ${openPlaylist.id !== 'p1' ? 'group cursor-pointer' : ''}`}
                    onClick={() => openPlaylist.id !== 'p1' && handleCoverUpload(openPlaylist.id)}>
                    {getPlaylistCover(openPlaylist)
                      ? <img src={getPlaylistCover(openPlaylist)!} className="w-full h-full object-cover" alt="" />
                      : openPlaylist.id === 'p1' ? <Heart size={48} className="text-red-400 fill-red-400/20" /> : <ListMusic size={48} className="text-neutral-500" />}
                    {openPlaylist.id !== 'p1' && <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity"><ImagePlus size={22} className="text-white" /></div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-1">Playlist</p>
                    <h2 className="text-3xl font-black text-white truncate">{openPlaylist.name}</h2>
                    {openPlaylist.description && openPlaylist.description.trim() && (
                      <p className="text-sm text-neutral-500 mt-1">{openPlaylist.description}</p>
                    )}
                    <p className="text-sm text-neutral-600 mt-1">{openPlaylist.tracks.length} {openPlaylist.tracks.length === 1 ? 'track' : 'tracks'}</p>
                    <div className="flex items-center gap-2 mt-4">
                      <button onClick={() => playAll(openPlaylist.tracks)} disabled={!openPlaylist.tracks.length}
                        className="flex items-center gap-2 px-5 py-2 bg-[#39FF14] text-black font-bold rounded-lg hover:shadow-[0_0_20px_#39FF14] transition-all disabled:opacity-40 text-sm">
                        <Play size={16} fill="currentColor" /> Play All
                      </button>
                      <button onClick={() => { setRenamingPlaylist(openPlaylist); setRenameVal(openPlaylist.name); setRenameDescVal(openPlaylist.description); }}
                        className="flex items-center gap-1.5 px-3 py-2 text-neutral-400 hover:text-white transition-colors rounded-lg hover:bg-white/5 text-sm font-medium border border-neutral-800 hover:border-neutral-700">
                        <Pencil size={14} /> Edit
                      </button>
                      {openPlaylist.id !== 'p1' && (
                        <button onClick={() => { deletePlaylist(openPlaylist.id); setOpenPlaylistId(null); }}
                          className="flex items-center gap-1.5 px-3 py-2 text-neutral-400 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10 text-sm font-medium border border-neutral-800 hover:border-red-500/30">
                          <Trash2 size={14} /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {openPlaylist.tracks.length === 0
                  ? <div className="flex flex-col items-center justify-center h-40 text-neutral-700 gap-3"><Music size={32} strokeWidth={1} /><p className="text-sm">No tracks yet.</p></div>
                  : (() => {
                      const q = playlistSearchQ.trim().toLowerCase();
                      const filteredTracks = q
                        ? openPlaylist.tracks.filter(t => {
                            const title = (t.title || '').toLowerCase();
                            const artist = (t.artist || '').toLowerCase();
                            return title.includes(q) || artist.includes(q);
                          })
                        : openPlaylist.tracks;
                      return (
                        <div className="flex flex-col gap-1">
                          <div className="relative mb-3">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
                            <input
                              type="text"
                              value={playlistSearchQ}
                              onChange={e => setPlaylistSearchQ(e.target.value)}
                              placeholder="Search in playlist..."
                              className="w-full bg-neutral-900 border border-neutral-800 rounded-lg pl-8 pr-8 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-[#39FF14]/40 transition-colors"
                            />
                            {playlistSearchQ && (
                              <button onClick={() => setPlaylistSearchQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white transition-colors">
                                <X size={13} />
                              </button>
                            )}
                          </div>
                          {filteredTracks.length === 0
                            ? <div className="flex flex-col items-center justify-center h-32 text-neutral-700 gap-2"><Search size={24} strokeWidth={1} /><p className="text-sm">No results for "{playlistSearchQ}"</p></div>
                            : filteredTracks.map((t, i) => {
                                const origIdx = openPlaylist.tracks.indexOf(t);
                                return (
                                  <div key={t.url + origIdx}
                                    className="relative group/row flex items-center gap-1"
                                    onMouseEnter={() => { if (dragPlaylistIdx.current !== null) { dragOverPlaylistIdxRef.current = origIdx; setDragOverPlaylistIdx(origIdx); } }}>
                                    {dragOverPlaylistIdx === origIdx && dragPlaylistIdx.current !== null && dragPlaylistIdx.current !== origIdx && (
                                      <div className="absolute top-0 left-8 right-0 h-0.5 bg-[#39FF14] rounded-full z-10 shadow-[0_0_6px_#39FF14] pointer-events-none" />
                                    )}
                                    {!playlistSearchQ && (
                                      <div
                                        className="px-1.5 py-4 cursor-grab flex items-center justify-center shrink-0 opacity-0 group-hover/row:opacity-100 transition-opacity"
                                        onMouseDown={e => {
                                          e.preventDefault();
                                          dragPlaylistIdx.current = origIdx;
                                          dragOverPlaylistIdxRef.current = origIdx;
                                          setDragOverPlaylistIdx(origIdx);
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
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <TrackRow track={t} index={i} showRemove onRemove={() => removeFromPlaylist(openPlaylist.id, t.url)}
                                        isActive={currentTrack?.url === t.url} isHovered={hoveredTrackUrl === t.url}
                                        isLoadingTrack={isLoadingTrack} isPlaying={isPlaying}
                                        isLiked={isTrackLiked(t.url)} isDownloading={(downloadingTracks[t.url] ?? 0)}
                                        onPlay={() => handlePlayInContext(t, openPlaylist.tracks)}
                                        onHoverEnter={() => setHoveredTrackUrl(t.url)} onHoverLeave={() => setHoveredTrackUrl(null)}
                                        onLike={() => toggleLikeTrack(t)} onDownload={() => handleDownload(t)}
                                        onCtx={e => openCtx(e, { type: 'track', track: t })} />
                                    </div>
                                  </div>
                                );
                              })
                          }
                        </div>
                      );
                    })()
                }
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
                        className={`playlist-card group relative rounded-lg transition-all duration-200 p-2
                          ${isDragTarget
                            ? 'ring-2 ring-[#39FF14] ring-offset-1 ring-offset-[#050505] bg-[#39FF14]/[0.05]'
                            : 'hover:bg-white/[0.04]'}`}
                        style={{ animation: `fadeUp 0.2s cubic-bezier(0.2,0,0,1) ${plIdx * 30}ms both` }}
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

          {}
          {activeNav === 'stats' && (() => {
            const totalSecs = Object.values(listenSecs).reduce((s: number, n) => s + (n as number), 0);
            const totalPlays = Object.values(playCounts).reduce((s: number, n) => s + (n as number), 0);
            const hrs = Math.floor(totalSecs / 3600);
            const mins = Math.floor((totalSecs % 3600) / 60);

            // Build a comprehensive track lookup from all known sources
            const allKnownTracks: Track[] = [...new Map(
              [...quickPicks, ...playHistory].map((t: Track) => [t.url, t])
            ).values()];

            // Top 5 tracks — only include entries where we have track metadata
            const topTracks: { track: Track; count: number }[] = Object.entries(playCounts)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .slice(0, 5)
              .reduce((acc: { track: Track; count: number }[], [url, count]) => {
                const track = allKnownTracks.find(t => t.url === url);
                if (track) acc.push({ track, count: count as number });
                return acc;
              }, []);

            // Top 5 artists
            const artistCounts: Record<string, number> = {};
            Object.entries(playCounts).forEach(([url, count]) => {
              const artist = allKnownTracks.find(t => t.url === url)?.artist;
              if (artist && artist.trim()) {
                artistCounts[artist] = (artistCounts[artist] || 0) + (count as number);
              }
            });
            const topArtists: [string, number][] = Object.entries(artistCounts)
              .sort((a, b) => b[1] - a[1]).slice(0, 5);

            // Last 7 days bar chart
            const today = new Date();
            const days = Array.from({ length: 7 }, (_, i) => {
              const d = new Date(today);
              d.setDate(today.getDate() - (6 - i));
              const key = d.toISOString().slice(0, 10);
              return { label: d.toLocaleDateString('en', { weekday: 'short' }), count: (dailyPlays[key] as number) || 0 };
            });
            const maxDay = Math.max(...days.map(d => d.count), 1);

            const resetStats = () => {
              setConfirmModal({
                message: 'Reset all stats? This will clear play counts, listen time, history, and daily plays. Cannot be undone.',
                onConfirm: () => {
                  setPlayCounts({}); saveLS('vg_playCounts', {});
                  setListenSecs({}); saveLS('vg_listenSecs', {});
                  setDailyPlays({}); saveLS('vg_dailyPlays', {});
                  setFirstSeen({}); saveLS('vg_firstSeen', {});
                  setPlayHistory([]); saveLS('vg_playHistory', []);
                  showToast('Stats reset');
                }
              });
            };

            const hasAnyStats = totalPlays > 0 || totalSecs > 0 || Object.keys(dailyPlays).some(k => (dailyPlays[k] as number) > 0);
            if (!hasAnyStats) {
              return (
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                  <BarChart2 size={36} className="text-neutral-700" strokeWidth={1} />
                  <p className="text-sm text-neutral-600">Play something to start tracking stats</p>
                </div>
              );
            }

            return (
              <div className="flex-1 overflow-y-auto custom-scrollbar px-8 py-8">
                {/* Header with reset button */}
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-lg font-black text-white uppercase tracking-widest">Stats</h1>
                  <button onClick={resetStats}
                    className="text-xs text-neutral-600 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg border border-neutral-800 hover:border-red-500/40">
                    Reset Stats
                  </button>
                </div>

                {/* Summary cards */}
                <div className="grid grid-cols-3 gap-4 mb-8">
                  {([
                    { label: 'Time Listened', value: hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`, sub: 'total' },
                    { label: 'Tracks Played', value: totalPlays.toLocaleString(), sub: 'all time' },
                    { label: 'Unique Tracks', value: Object.keys(playCounts).length.toLocaleString(), sub: 'tracked' },
                  ] as { label: string; value: string; sub: string }[]).map(({ label, value, sub }) => (
                    <div key={label} className="bg-neutral-900/60 border border-neutral-800/60 rounded-xl p-5">
                      <p className="text-xs font-semibold uppercase tracking-widest text-neutral-600 mb-2">{label}</p>
                      <p className="text-3xl font-black text-white tabular-nums">{value}</p>
                      <p className="text-xs text-neutral-600 mt-1">{sub}</p>
                    </div>
                  ))}
                </div>

                {/* Daily plays bar chart */}
                <div className="mb-8">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="w-1 h-4 bg-[#39FF14] rounded-full shadow-[0_0_6px_#39FF14] shrink-0" />
                    <h2 className="text-sm font-bold text-white uppercase tracking-widest">Last 7 Days</h2>
                    <span className="ml-auto text-xs text-neutral-600">{days.reduce((s,d)=>s+d.count,0)} total plays</span>
                  </div>
                  <div className="bg-neutral-900/40 border border-neutral-800/40 rounded-xl p-5">
                    <div className="flex items-end gap-3" style={{height:'140px'}}>
                      {days.map(({ label, count }, di) => {
                        const isToday = di === 6;
                        const barH = count === 0 ? 6 : Math.max(20, Math.round((count / maxDay) * 110));
                        return (
                          <div key={label} className="flex-1 flex flex-col items-center justify-end gap-1.5 h-full">
                            {count > 0 && (
                              <span className="text-[11px] font-bold tabular-nums" style={{color: isToday ? '#39FF14' : '#aaa'}}>{count}</span>
                            )}
                            <div className="w-full rounded-lg transition-all duration-500 relative overflow-hidden"
                              style={{
                                height: `${barH}px`,
                                background: count === 0
                                  ? 'rgba(255,255,255,0.04)'
                                  : isToday
                                    ? 'linear-gradient(180deg,#39FF14,#22cc0a)'
                                    : 'linear-gradient(180deg,rgba(57,255,20,0.65),rgba(57,255,20,0.3))',
                                boxShadow: count > 0 && isToday ? '0 0 16px rgba(57,255,20,0.5)' : 'none',
                                border: isToday && count > 0 ? '1px solid rgba(57,255,20,0.4)' : '1px solid transparent',
                              }} />
                            <span className={`text-[11px] font-semibold ${isToday ? 'text-[#39FF14]' : 'text-neutral-500'}`}>{label}</span>
                            {isToday && <span className="text-[9px] text-[#39FF14]/60 font-bold -mt-1">TODAY</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  {/* Top tracks */}
                  {topTracks.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <span className="w-1 h-4 bg-[#39FF14] rounded-full shadow-[0_0_6px_#39FF14] shrink-0" />
                        <h2 className="text-sm font-bold text-white uppercase tracking-widest">Top Tracks</h2>
                      </div>
                      <div className="flex flex-col gap-2">
                        {topTracks.map(({ track, count }, i) => (
                          <div key={track.url}
                            onClick={() => handlePlayInContext(track, topTracks.map(x => x.track))}
                            className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors group">
                            <span className="text-xs font-bold text-neutral-600 w-4 tabular-nums shrink-0">{i + 1}</span>
                            <img src={track.cover} className="w-9 h-9 rounded-md object-cover shrink-0 border border-neutral-800/60" alt="" loading="lazy" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-white truncate group-hover:text-[#39FF14] transition-colors">{track.title}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <div className="flex-1 h-0.5 bg-neutral-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-[#39FF14]/60 rounded-full" style={{ width: `${(count / (topTracks[0]?.count || 1)) * 100}%` }} />
                                </div>
                                <span className="text-[10px] text-neutral-600 tabular-nums shrink-0">{count}×</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Top artists */}
                  {topArtists.length > 0 && (
                    <div>
                      <div className="flex items-center gap-3 mb-4">
                        <span className="w-1 h-4 bg-[#39FF14] rounded-full shadow-[0_0_6px_#39FF14] shrink-0" />
                        <h2 className="text-sm font-bold text-white uppercase tracking-widest">Top Artists</h2>
                      </div>
                      <div className="flex flex-col gap-2">
                        {topArtists.map(([artist, count], i) => {
                          const thumb = artistThumbs[artist];
                          return (
                          <div key={artist} className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.04] transition-colors cursor-pointer"
                            onClick={() => { setSearchQuery(artist); searchMusic(artist); setActiveNav('home'); }}>
                            <span className="text-xs font-bold text-neutral-600 w-4 tabular-nums shrink-0">{i + 1}</span>
                            <div className="w-10 h-10 rounded-full bg-neutral-800 border border-neutral-700/60 flex items-center justify-center shrink-0 overflow-hidden">
                              {thumb
                                ? <img src={thumb} alt={artist} className="w-full h-full object-cover" />
                                : <span className="text-xs font-bold text-neutral-400">{artist.slice(0, 2).toUpperCase()}</span>}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{artist}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <div className="flex-1 h-0.5 bg-neutral-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-[#39FF14]/40 rounded-full" style={{ width: `${(count / (topArtists[0]?.[1] || 1)) * 100}%` }} />
                                </div>
                                <span className="text-[10px] text-neutral-600 tabular-nums shrink-0">{count} plays</span>
                              </div>
                            </div>
                          </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Recent history */}
                {playHistory.length > 0 && (
                  <div className="mt-6">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="w-1 h-4 bg-[#39FF14] rounded-full shadow-[0_0_6px_#39FF14] shrink-0" />
                      <h2 className="text-sm font-bold text-white uppercase tracking-widest">Recent Plays</h2>
                      <button onClick={() => { setPlayHistory([]); saveLS('vg_playHistory', []); }}
                        className="ml-auto text-[11px] text-neutral-600 hover:text-neutral-400 transition-colors">Clear</button>
                    </div>
                    <div className="flex flex-col gap-1">
                      {playHistory.slice(0, 8).map((track: Track, i: number) => (
                        <div key={track.url + i}
                          onClick={() => handlePlayInContext(track, playHistory.slice(0, 8))}
                          className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors group">
                          <img src={track.cover} className="w-8 h-8 rounded-md object-cover shrink-0 border border-neutral-800/60" alt="" loading="lazy" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-neutral-300 truncate group-hover:text-white transition-colors">{track.title}</p>
                            <p className="text-xs text-neutral-600 truncate">{track.artist}</p>
                          </div>
                          <Play size={12} className="text-neutral-700 group-hover:text-[#39FF14] transition-colors shrink-0" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {activeNav === 'settings' && (
            <SettingsPanel
              downloadQuality={downloadQuality} setDownloadQuality={setDownloadQuality}
              downloadPath={downloadPath} handleSelectDirectory={handleSelectDirectory}
              downloadFormat={downloadFormat} setDownloadFormat={setDownloadFormatState}
              embedThumbnail={embedThumbnail} setEmbedThumbnail={setEmbedThumbnailState}
              duplicateDetect={duplicateDetect} setDuplicateDetect={setDuplicateDetectState}
              onBackup={handleBackup} onRestore={handleRestore}
              onReset={() => setConfirmModal({ message: 'Reset all Vanguard data? This cannot be undone.', onConfirm: () => { localStorage.clear(); window.location.reload(); } })}
              backupPath={backupPath} setBackupPath={setBackupPath}
              loudnormEnabled={loudnormEnabled} setLoudnormEnabled={setLoudnormEnabledState}
              streamQuality={streamQuality} setStreamQuality={setStreamQualityState}
              skipSilence={skipSilence} setSkipSilence={setSkipSilenceState}
              eq={eq} setEq={v => { setEqState(v); saveLS('vg_eq', v); }}
              showToast={showToast}
              updateAvailable={updateAvailable}
              appVersion={appVersion}
              lyricsSource={lyricsSource} setLyricsSource={setLyricsSource}
              trayEnabled={trayEnabled} setTrayEnabled={setTrayEnabled}
              audioDevices={audioDevices} setAudioDevices={setAudioDevices}
            />
          )}
          </div>
        </div>

        {}
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
                          <div className="flex gap-[2px] items-end h-3.5">{[100, 60, 80].map((h, i) => <div key={i} className="w-[2.5px] bg-[#39FF14] rounded-full" style={{ height: `${h}%`, animation: `barBounce ${0.7 + i * 0.12}s ease-in-out ${i * 110}ms infinite`, transformOrigin: "bottom" }} />)}</div>
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

      {}
      <div className="h-[88px] bg-[#0a0a0a] border-t border-neutral-800 flex items-center justify-between px-6 relative z-20 shadow-[0_-8px_40px_rgba(0,0,0,0.9)] shrink-0" style={{ backdropFilter: 'none' }}>
        {isPlaying && !isLoadingTrack && <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#39FF14]/50 to-transparent" />}
        {isLoadingTrack && (
          <div className="absolute top-0 left-0 w-full h-[2px] overflow-hidden bg-neutral-800/40">
            <div className="h-full bg-[#39FF14]/80 shadow-[0_0_6px_#39FF14]" style={{ animation: 'loadbar 1.4s ease-in-out infinite', width: '35%' }} />
          </div>
        )}
        {}
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
              <div key={currentTrack.url} className="flex flex-col overflow-hidden max-w-[140px]" style={{ animation: 'fadeIn 0.25s ease both' }}>
                <span className="font-bold text-white text-sm truncate">{currentTrack.title}</span>
                {isLoadingTrack
                  ? <span className="text-xs text-[#39FF14]/70 flex items-center gap-1.5 mt-0.5">
                      <span className="flex gap-[3px] items-end h-3">{[1, 0.6, 0.8, 0.5].map((h, i) => <span key={i} className="w-[2px] bg-[#39FF14]/60 rounded-full inline-block" style={{ height: `${h * 100}%`, animation: `barBounce ${0.65 + i * 0.1}s ease-in-out ${i * 100}ms infinite`, transformOrigin: "bottom" }} />)}</span>
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
                  <Heart size={22} className={isTrackLiked(currentTrack.url) ? 'text-[#39FF14] fill-[#39FF14] drop-shadow-[0_0_8px_rgba(57,255,20,0.6)]' : 'text-neutral-400 hover:text-white'} />
                </button>
              )}
              {currentTrack && !currentTrack.url.startsWith('local://') && (() => {
                const dl = downloadingTracks[currentTrack.url];
                return (
                  <button onClick={() => handleDownload(currentTrack)} className="p-1.5 focus:outline-none hover:scale-110 active:scale-95 transition-transform shrink-0" title="Download">
                    {dl > 0
                      ? <svg width="20" height="20" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.5" fill="none" stroke="#333" strokeWidth="1.5"/><circle cx="7" cy="7" r="5.5" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round" strokeDasharray={`${2*Math.PI*5.5}`} strokeDashoffset={`${2*Math.PI*5.5*(1-Math.min(dl,100)/100)}`} style={{transformOrigin:'7px 7px',transform:'rotate(-90deg)',transition:'stroke-dashoffset 0.3s ease'}}/>{dl>=100&&<path d="M4.5 7l2 2 3-3" stroke="#39FF14" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>}</svg>
                      : <Download size={20} className="text-neutral-400 hover:text-white" />}
                  </button>
                );
              })()}
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-md border border-neutral-800/50 bg-[#0d0d0d] flex items-center justify-center shrink-0"><Music size={20} className="text-neutral-600" /></div>
              <div className="flex flex-col overflow-hidden"><span className="font-bold text-neutral-600 text-sm">No track</span><span className="text-xs text-neutral-700">---</span></div>
            </>
          )}
        </div>

        {}
        <div className="flex flex-col items-center justify-center w-2/4 gap-2 max-w-2xl">
          <div className="flex items-center gap-5">
            <button onClick={toggleShuffle} className={`transition-all duration-200 ${shuffle ? 'text-[#39FF14] drop-shadow-[0_0_6px_#39FF14]' : 'text-neutral-600 hover:text-neutral-300'}`}><Shuffle size={20} /></button>
            <button onClick={handleSkipBack} className={`transition-all duration-150 active:scale-90 ${currentTrack ? 'text-neutral-300 hover:text-[#39FF14]' : 'text-neutral-700 cursor-not-allowed'}`}><SkipBack size={24} /></button>
            <button onClick={togglePlayPause} disabled={!currentTrack || isLoadingTrack}
              className="w-12 h-12 flex items-center justify-center rounded-full bg-white text-black hover:bg-[#39FF14] hover:shadow-[0_0_22px_rgba(57,255,20,0.65)] hover:scale-110 transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-white disabled:hover:shadow-none">
              {isLoadingTrack ? <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                : isPlaying ? <Pause fill="currentColor" size={22} />
                : <Play fill="currentColor" size={22} className="ml-0.5" />}
            </button>
            <button onClick={handleSkipForward} className={`transition-all duration-150 active:scale-90 ${(queue.length > 0 || playlistContextRef.current !== null || (currentTrack?.url?.startsWith('local://') && localTracksListRef.current.length > 1)) ? 'text-neutral-300 hover:text-[#39FF14]' : 'text-neutral-700 cursor-not-allowed'}`}><SkipForward size={24} /></button>
            <button onClick={cycleRepeat} className={`transition-all duration-200 ${repeatMode !== 'off' ? 'text-[#39FF14] drop-shadow-[0_0_6px_#39FF14]' : 'text-neutral-600 hover:text-neutral-300'}`}>
              {repeatMode === 'one' ? <Repeat1 size={20} /> : <Repeat size={20} />}
            </button>
          </div>

          {}
          <div className="w-full flex items-center gap-2 mt-1">
            <SpeedSelector speed={playbackSpeed} onChange={setPlaybackSpeed} />
            {/* A-B Loop — same style as SpeedSelector */}
            <button
              title={abLoop.a === null ? 'Set loop start (A)' : abLoop.b === null ? 'Set loop end (B)' : 'Clear A-B loop'}
              onClick={() => {
                if (abLoop.a === null) {
                  const a = progressSecondsRef.current;
                  setAbLoop({ a, b: null }); abLoopRef.current = { a, b: null };
                  showToast(`Loop start: ${formatTime(a)}`);
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
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-bold transition-all border shrink-0
                ${abLoop.b !== null
                  ? 'text-[#39FF14] border-[#39FF14]/30 bg-[#39FF14]/10'
                  : abLoop.a !== null
                  ? 'text-amber-400 border-amber-400/30 bg-amber-400/10'
                  : 'text-neutral-600 border-neutral-800 hover:text-neutral-400 hover:border-neutral-700'}`}>
              A-B{abLoop.b !== null ? ' ✓' : abLoop.a !== null ? ' …' : ''}
            </button>
            <span className="text-xs font-medium text-neutral-400 tabular-nums min-w-[32px] text-right">
              {currentTrack ? formatTime(progressSeconds) : '0:00'}
            </span>
            <div ref={progressRef}
              className="slider-track relative flex-1 h-1 bg-neutral-800 rounded-full cursor-pointer hover:h-1.5 transition-[height] duration-150 ease-out group/prog"
              onMouseDown={e => { isDraggingProgressRef.current = true; setIsDraggingProgress(true); updateProgressFromEvent(e.clientX); }}
              onMouseMove={e => {
                if (!progressRef.current || !currentTrack) return;
                const rect = progressRef.current.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const total = trackDurationRef.current || parseDurationToSeconds(currentTrack.duration);
                const el = progressRef.current.querySelector<HTMLElement>('.prog-tooltip');
                if (el) {
                  el.textContent = formatTime(total * pct);
                  el.style.left = `${pct * 100}%`;
                }
              }}>
              {/* Hover timestamp tooltip */}
              {currentTrack && <div className="prog-tooltip absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 bg-neutral-900 border border-neutral-800 rounded text-[10px] font-bold text-neutral-300 opacity-0 group-hover/prog:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10" style={{ left: '0%' }} />}
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

        {}
        <div className="w-1/4 flex items-center justify-end gap-3 pr-4">
          {}
          {crossfadeSeconds > 0 && (
            <span className="text-[10px] text-purple-400 font-bold tabular-nums" title={`Crossfade: ${crossfadeSeconds}s`}>
              ×{crossfadeSeconds}s
            </span>
          )}
          {/* Lyrics button */}
          <button
            onClick={() => { if (currentTrack) setShowLyrics(o => !o); }}
            disabled={!currentTrack}
            title="Lyrics"
            className={`transition-all duration-200 shrink-0 disabled:opacity-30 ${showLyrics ? 'text-[#39FF14] drop-shadow-[0_0_6px_#39FF14]' : 'text-neutral-500 hover:text-neutral-300'}`}>
            <Mic2 size={18} />
          </button>
          <button onClick={toggleMute} className="focus:outline-none shrink-0">
            {volume === 0 ? <VolumeX size={20} className="text-red-500" /> : <Volume2 size={20} className="text-neutral-400 hover:text-white transition-colors" />}
          </button>
          <div ref={volumeRef} title={`Volume: ${Math.round(volume)}%`}
            className="slider-track relative w-24 h-1 bg-neutral-800 rounded-full cursor-pointer hover:h-1.5 transition-[height] duration-150 ease-out group/vol"
            onMouseDown={e => { setIsDraggingVolume(true); updateVolumeFromEvent(e.clientX); }}>
            <div className="absolute top-0 left-0 h-full rounded-full pointer-events-none"
              style={{ width: `${volume}%`, background: volume > 0 ? '#39FF14' : '#404040', boxShadow: volume > 0 ? '0 0 5px rgba(57,255,20,0.45)' : 'none', transition: isDraggingVolume ? 'none' : 'width 0.15s ease-out' }}>
              <div className="slider-thumb absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 pointer-events-none" />
            </div>
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-neutral-900 border border-neutral-800 rounded text-[10px] font-bold text-neutral-300 opacity-0 group-hover/vol:opacity-100 transition-opacity pointer-events-none whitespace-nowrap">
              {Math.round(volume)}%
            </div>
          </div>
        </div>
      </div>

      {}
      {ctxMenu && (() => {
        const { track, playlist } = ctxMenu;
        if ((ctxMenu.type === 'track' || ctxMenu.type === 'quickpick' || ctxMenu.type === 'queue-track') && track) {
          return (
            <div className="ctx-menu fixed z-50 bg-[#0a0a0a] border border-neutral-800 rounded-xl shadow-2xl py-2 w-64 text-sm font-medium text-neutral-300"
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
                {(downloadingTracks[track.url] ?? 0) > 0
                  ? <svg width="16" height="16" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6" fill="none" stroke="#333" strokeWidth="1.5"/>
                      <circle cx="8" cy="8" r="6" fill="none" stroke="#39FF14" strokeWidth="1.5" strokeLinecap="round"
                        strokeDasharray={`${2 * Math.PI * 6}`}
                        strokeDashoffset={`${2 * Math.PI * 6 * (1 - Math.min(downloadingTracks[track.url] ?? 0, 100) / 100)}`}
                        style={{ transformOrigin: '8px 8px', transform: 'rotate(-90deg)', transition: 'stroke-dashoffset 0.3s ease' }}
                      />
                    </svg>
                  : <Download size={15} />}
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
              <div className="h-px bg-neutral-800 my-1" />
              <button onClick={() => { handleExportPlaylistM3u(playlist); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors"><FileOutput size={15} /> Export as M3U</button>
              {playlist.id !== 'p1' && <button onClick={() => { deletePlaylist(playlist.id); setCtxMenu(null); }} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-500/20 hover:text-red-400 transition-colors"><Trash2 size={15} /> Delete</button>}
            </div>
          );
        }
        return null;
      })()}

      {}
      {addToPlaylistTrack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md" onClick={() => setAddToPlaylistTrack(null)}>
          <div className="bg-[#0d0d0d] border border-neutral-800/60 rounded-2xl w-80 overflow-hidden shadow-[0_24px_60px_rgba(0,0,0,0.95)]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/60">
              <div>
                <h3 className="font-bold text-white text-sm">Add to Playlist</h3>
                <p className="text-[11px] text-neutral-600 mt-0.5 truncate max-w-[180px]">{addToPlaylistTrack.title}</p>
              </div>
              <button onClick={() => setAddToPlaylistTrack(null)} className="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-500 hover:text-white hover:bg-white/[0.06] transition-all"><X size={14} /></button>
            </div>
            <div className="py-1 max-h-64 overflow-y-auto custom-scrollbar">
              {playlists.map(p => {
                const alreadyIn = p.tracks.some(t => t.url === addToPlaylistTrack.url);
                return (
                  <button key={p.id} onClick={() => !alreadyIn && addTrackToPlaylist(p.id, addToPlaylistTrack)}
                    disabled={alreadyIn}
                    className={`w-full flex items-center gap-3 px-5 py-3 transition-colors text-left ${alreadyIn ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/[0.04]'}`}>
                    <div className="w-7 h-7 rounded-md overflow-hidden shrink-0 bg-neutral-800 flex items-center justify-center border border-neutral-700/60">
                      {p.id === 'p1' ? <Heart size={13} className="text-red-400" /> : <ListMusic size={13} className="text-neutral-500" />}
                    </div>
                    <span className="text-sm text-white truncate flex-1">{p.name}</span>
                    {alreadyIn ? <span className="text-[10px] text-[#39FF14] font-bold shrink-0">Added</span>
                      : <span className="text-xs text-neutral-700 shrink-0">{p.tracks.length}</span>}
                  </button>
                );
              })}
            </div>
            <div className="px-5 py-3 border-t border-neutral-800/60">
              <button onClick={() => { setAddToPlaylistTrack(null); setNewPlaylistName(''); setNewPlaylistDesc(''); setIsPlaylistModalOpen(true); }}
                className="flex items-center gap-2 text-[#39FF14] text-sm font-semibold hover:text-[#39FF14]/80 transition-colors">
                <PlusCircle size={14} /> New Playlist
              </button>
            </div>
          </div>
        </div>
      )}

      {}
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

              {}
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

              {}
              <div className="px-6 pt-3 pb-4 text-center">
                <p className="text-base font-bold text-white leading-snug">{infoModalTrack.title}</p>
                <p className="text-sm text-neutral-500 mt-0.5">{infoModalTrack.artist}</p>
              </div>

              {}
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

              {}
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

              {}
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

      {}
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
            setBgImport(null);
            setPendingSpotifyImport(null);
          }}
          onMatchingDone={(tracks, matched, failed) => {
            // Store in parent state so name popup shows even if modal was minimized
            setPendingSpotifyImport({ tracks, matchedCount: matched, failedCount: failed });
            setShowCsvImportModal(false);
          }}
          showToast={showToast}
          onProgress={(matched, total, label) => setBgImport(total > 0 ? { matched, total, label } : null)}
        />
      )}
      {/* Name/desc popup for minimized Spotify imports */}
      {pendingSpotifyImport && !showCsvImportModal && (
        <ImportResultModal
          matchedCount={pendingSpotifyImport.matchedCount}
          failedCount={pendingSpotifyImport.failedCount}
          onSave={(name, desc) => {
            const id = `csv_${Date.now()}`;
            setPlaylists(prev => [...prev, { id, name, description: desc || 'Imported from Spotify', tracks: pendingSpotifyImport.tracks }]);
            showToast(`"${name}" saved — ${pendingSpotifyImport.tracks.length} tracks`);
            setBgImport(null);
            setPendingSpotifyImport(null);
          }}
          onClose={() => setPendingSpotifyImport(null)}
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

      {}
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

      {}
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

      {}
      {renamingPlaylist && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-neutral-800 p-6 rounded-xl w-96 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-5">Edit Playlist</h3>
            <div className="flex flex-col gap-4 mb-6">
              <div>
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-widest mb-1.5 block">Name</label>
                <input autoFocus type="text" value={renameVal} onChange={e => setRenameVal(e.target.value)}
                  className="w-full bg-[#050505] border border-neutral-800 text-white rounded-lg py-2.5 px-3 focus:outline-none focus:border-[#39FF14] transition-all text-sm"
                  onKeyDown={e => { if (e.key === 'Enter') confirmRenamePlaylist(); if (e.key === 'Escape') setRenamingPlaylist(null); }} />
              </div>
              <div>
                <label className="text-xs font-semibold text-neutral-400 uppercase tracking-widest mb-1.5 block">Description <span className="text-neutral-700 normal-case font-normal">(optional)</span></label>
                <textarea value={renameDescVal} onChange={e => setRenameDescVal(e.target.value)} rows={2}
                  placeholder="e.g. Chill vibes, road trip..."
                  className="w-full bg-[#050505] border border-neutral-800 text-white rounded-lg py-2.5 px-3 focus:outline-none focus:border-[#39FF14] resize-none text-sm placeholder-neutral-700" />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setRenamingPlaylist(null)} className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={confirmRenamePlaylist} className="px-4 py-2 bg-[#39FF14] text-black text-sm font-bold rounded-lg hover:shadow-[0_0_15px_#39FF14] transition-all">Save</button>
            </div>
          </div>
        </div>
      )}

      {}
      

      {}
      {/* Keyboard Shortcuts Overlay — press ? to toggle */}
      {showShortcuts && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setShowShortcuts(false)}>
          <div className="bg-[#0e0e0e] border border-neutral-800 rounded-2xl w-[520px] max-h-[80vh] overflow-y-auto shadow-2xl custom-scrollbar"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-800">
              <h2 className="text-base font-bold text-white">Keyboard Shortcuts</h2>
              <button onClick={() => setShowShortcuts(false)} className="text-neutral-500 hover:text-white transition-colors"><X size={16} /></button>
            </div>
            <div className="px-6 py-4 grid grid-cols-2 gap-x-8 gap-y-1">
              {([
                ['Playback', null],
                ['Space', 'Play / Pause'],
                ['←', 'Seek back 10s'],
                ['→', 'Seek forward 10s'],
                ['M', 'Mute / Unmute'],
                ['Navigation', null],
                ['Ctrl+F', 'Focus search'],

                ['?', 'Show this overlay'],
                ['Esc', 'Close any overlay'],
              ] as [string, string | null][]).map(([key, action], i) =>
                action === null ? (
                  <div key={i} className="col-span-2 mt-3 mb-1 text-[10px] font-bold uppercase tracking-widest text-neutral-600">{key}</div>
                ) : (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-neutral-800/40 col-span-2 md:col-span-1">
                    <span className="text-sm text-neutral-400">{action}</span>
                    <kbd className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-neutral-900 border border-neutral-700 text-[#39FF14] ml-4 shrink-0">{key}</kbd>
                  </div>
                )
              )}
            </div>
            <div className="px-6 py-4 border-t border-neutral-800 text-center">
              <p className="text-xs text-neutral-600">Press <kbd className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-900 border border-neutral-800 text-neutral-400">?</kbd> or <kbd className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-900 border border-neutral-800 text-neutral-400">Esc</kbd> to close</p>
            </div>
          </div>
        </div>
      )}

      {/* Custom confirm dialog — replaces window.confirm to avoid double native boxes */}
      {confirmModal && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setConfirmModal(null)}>
          <div className="bg-[#111] border border-neutral-700 rounded-xl w-96 shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-neutral-800">
              <h3 className="text-base font-bold text-white">Confirm</h3>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-neutral-300 leading-relaxed">{confirmModal.message}</p>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors rounded-lg hover:bg-neutral-800">
                Cancel
              </button>
              <button onClick={() => { confirmModal.onConfirm(); setConfirmModal(null); }}
                className="px-4 py-2 text-sm font-bold bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20 hover:border-red-500/60 rounded-lg transition-all">
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-28 left-1/2 z-50 bg-[#111] border border-neutral-800/80 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-2xl pointer-events-none"
          style={{ animation: 'toastIn 0.2s cubic-bezier(0.25,0,0,1) both' }}>
          {toast}
        </div>
      )}

      {/* Background import progress pill */}
      {bgImport && !showCsvImportModal && (
        <div className="fixed bottom-28 right-6 z-[9998] flex items-center gap-3 px-4 py-2.5 rounded-xl shadow-2xl border border-[#1DB954]/30 bg-[#0d0d0d]"
          style={{ animation: 'fadeUp 0.2s ease both' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
          <div className="flex flex-col gap-1 min-w-[160px]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white">Importing Spotify…</span>
              <span className="text-[10px] text-[#1DB954] font-bold tabular-nums">{bgImport.matched}/{bgImport.total}</span>
            </div>
            <div className="h-1 rounded-full bg-neutral-800 overflow-hidden w-full">
              <div className="h-full rounded-full transition-all duration-300" style={{ width: `${(bgImport.matched / bgImport.total) * 100}%`, background: '#1DB954' }} />
            </div>
          </div>
          <button onClick={() => setBgImport(null)} className="text-neutral-600 hover:text-white transition-colors ml-1"><X size={12} /></button>
        </div>
      )}


      {/* Live Lyrics Modal — immersive full-screen */}
      {showLyrics && currentTrack && (() => {
        const lines = lyricsData?.lines || [];
        // End glitch fix: once past last line, keep last line active (not index 0)
        let currentIdx = lines.length > 0 ? lines.length - 1 : 0;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].time > progressSeconds) { currentIdx = Math.max(0, i - 1); break; }
        }
        const pct = trackDurationSeconds > 0 ? Math.min((progressSeconds / trackDurationSeconds) * 100, 100) : 0;
        return (
          <div className="fixed inset-0 z-[9999] flex" style={{ userSelect: 'none', background: '#0a0a0a' }}>
            {/* Always render gradient base so there's never a black void */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(135deg,#0d1a10 0%,#080810 100%)' }} />
            {/* Full-screen blurred cover — overflow visible so blur doesn't get clipped */}
            {currentTrack.cover && (
              <div className="absolute pointer-events-none" style={{
                inset: '-60px',
                backgroundImage: `url(${currentTrack.cover})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(80px) brightness(0.6) saturate(2.0)',
              }} />
            )}
            {/* Scrim */}
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(135deg,rgba(0,0,0,0.42) 0%,rgba(0,0,0,0.28) 100%)' }} />

            {/* Left panel */}
            <div className="relative z-10 w-[360px] shrink-0 flex flex-col items-center justify-center px-8 gap-5">
              <button onClick={() => setShowLyrics(false)}
                className="absolute top-6 left-6 w-9 h-9 flex items-center justify-center rounded-full text-white transition-all"
                style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)' }}>
                <X size={16} />
              </button>

              {/* Album art */}
              <div className="w-44 h-44 rounded-2xl overflow-hidden shrink-0"
                style={{ boxShadow: '0 20px 60px rgba(0,0,0,0.85)', border: '1px solid rgba(255,255,255,0.12)' }}>
                {currentTrack.cover
                  ? <img src={currentTrack.cover} alt={currentTrack.title} className="w-full h-full object-cover" />
                  : <div className="w-full h-full bg-neutral-900 flex items-center justify-center"><Music size={36} className="text-neutral-600" /></div>}
              </div>

              <div className="text-center w-full">
                <p className="text-lg font-black text-white truncate px-1">{currentTrack.title}</p>
                <p className="text-sm mt-0.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{currentTrack.artist}</p>
              </div>

              {/* Progress bar — identical to default player bar */}
              <div className="w-full flex flex-col gap-1">
                <div className="slider-track relative w-full h-1 rounded-full cursor-pointer hover:h-1.5 transition-[height] duration-150 ease-out"
                  style={{ background: 'rgba(255,255,255,0.18)' }}
                  onMouseDown={e => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * (trackDurationSeconds || 0);
                    invoke('seek_audio', { time: t }).catch(() => {});
                  }}>
                  <div className="absolute top-0 left-0 h-full rounded-full pointer-events-none"
                    style={{ width: `${pct}%`, background: '#39FF14', boxShadow: '0 0 6px rgba(57,255,20,0.5)', transition: 'width 0.5s linear' }}>
                    <div className="slider-thumb absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full opacity-0 pointer-events-none"
                      style={{ boxShadow: '0 0 6px rgba(255,255,255,0.8)' }} />
                  </div>
                </div>
                <div className="flex justify-between text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  <span>{formatTime(progressSeconds)}</span>
                  <span>{formatTime(trackDurationSeconds)}</span>
                </div>
              </div>

              {/* Playback controls */}
              <div className="flex items-center gap-6">
                <button onClick={handleSkipBack} style={{ color: 'rgba(255,255,255,0.65)' }} className="hover:text-white transition-colors"><SkipBack size={20} /></button>
                <button onClick={togglePlayPause}
                  className="w-12 h-12 rounded-full bg-white flex items-center justify-center active:scale-95 transition-all"
                  style={{ boxShadow: isPlaying ? '0 0 20px rgba(57,255,20,0.5)' : '0 4px 16px rgba(0,0,0,0.5)' }}>
                  {isPlaying ? <Pause fill="black" size={20} className="text-black" /> : <Play fill="black" size={20} className="text-black ml-0.5" />}
                </button>
                <button onClick={handleSkipForward} style={{ color: 'rgba(255,255,255,0.65)' }} className="hover:text-white transition-colors"><SkipForward size={20} /></button>
              </div>

              {/* Audio output — clean dropdown */}
              {audioDevices.length > 0 && (
                <LyricsAudioDropdown
                  devices={audioDevices}
                  switching={switchingDevice}
                  onSwitch={async (id) => {
                    setSwitchingDevice(true);
                    try { await invoke('set_audio_device', { id }); setAudioDevices(prev => prev.map(d => ({ ...d, is_default: d.id === id }))); showToast(`Output: ${audioDevices.find(d=>d.id===id)?.name ?? id}`); }
                    catch (e) { showToast(`Switch failed: ${e}`); }
                    finally { setSwitchingDevice(false); }
                  }}
                />
              )}
            </div>

            {/* Divider */}
            <div className="relative z-10 w-px shrink-0 my-8" style={{ background: 'rgba(255,255,255,0.07)' }} />

            {/* Lyrics panel */}
            <div className="relative z-10 flex-1 overflow-hidden">
              {lyricsLoading ? (
                <div className="flex flex-col items-center justify-center gap-4 h-full">
                  <Loader2 size={24} className="animate-spin text-[#39FF14]" />
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>Fetching lyrics…</p>
                </div>
              ) : lines.length > 0 ? (
                <div className="relative h-full">
                  <div className="absolute top-0 left-0 right-0 h-28 z-10 pointer-events-none"
                    style={{ background: 'linear-gradient(to bottom,rgba(0,0,0,0.7) 0%,transparent 100%)' }} />
                  <div className="absolute bottom-0 left-0 right-0 h-28 z-10 pointer-events-none"
                    style={{ background: 'linear-gradient(to top,rgba(0,0,0,0.7) 0%,transparent 100%)' }} />
                  <div className="h-full overflow-y-auto px-10 py-24" style={{ scrollbarWidth: 'none' }}
                    ref={el => {
                      if (!el) return;
                      const active = el.querySelector('[data-active="true"]') as HTMLElement;
                      if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}>
                    {lines.map((line, idx) => {
                      const isCurrent = idx === currentIdx;
                      const isPast = idx < currentIdx;
                      return (
                        <p key={idx}
                          data-active={isCurrent ? 'true' : 'false'}
                          onClick={async () => { await invoke('seek_audio', { time: line.time }).catch(() => {}); }}
                          className="cursor-pointer leading-snug py-2.5 select-none"
                          style={{
                            fontSize: '1.45rem',
                            fontWeight: isCurrent ? 700 : 500,
                            color: isCurrent ? '#fff' : isPast ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.48)',
                            transition: 'color 0.3s ease',
                          }}>
                          {line.text || '\u00A0'}
                        </p>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 h-full" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  <Mic2 size={36} strokeWidth={1} />
                  <p className="text-base font-medium">No lyrics found</p>
                  <p className="text-sm" style={{ color: 'rgba(255,255,255,0.15)' }}>Try Genius or AZLyrics</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}