import React, { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Home, Library, Search, Play, Pause, SkipBack, SkipForward,
  ListMusic, Heart, DownloadCloud, Music, Volume2, VolumeX,
  MoreVertical, ListPlus, Share2, Download, ExternalLink, Copy,
  Info, X, Clock, Youtube, Disc, Hash, FileCode2, PlaySquare,
  PlusCircle, FileBadge2, Settings, RefreshCw, FolderDown,
  Shuffle, Repeat, Repeat1, ListOrdered, Trash2, Pencil, ChevronRight, ChevronLeft
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

type Playlist = {
  id: string;
  name: string;
  tracks: Track[];
};

type RepeatMode = 'off' | 'all' | 'one';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function parseDurationToSeconds(duration: string): number {
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveToStorage(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

// ─── SETTINGS PANEL ──────────────────────────────────────────────────────────
function SettingsPanel({
  downloadQuality, setDownloadQuality,
  downloadPath, handleSelectDirectory,
}: {
  downloadQuality: string;
  setDownloadQuality: (q: string) => void;
  downloadPath: string;
  handleSelectDirectory: () => void;
}) {
  const [page, setPage] = useState<'root' | 'downloads'>('root');

  if (page === 'downloads') {
    return (
      <div className="flex-1 overflow-y-auto p-8 z-10 custom-scrollbar">
        <button onClick={() => setPage('root')}
          className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors mb-8 group">
          <ChevronLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
          <span className="text-sm font-medium">Settings</span>
        </button>
        <div className="flex items-center gap-4 mb-8">
          <div className="w-11 h-11 rounded-lg flex items-center justify-center bg-white shrink-0">
            <FolderDown size={22} className="text-black" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Downloads</h2>
            <p className="text-sm text-neutral-500 mt-0.5">Download path, quality and more...</p>
          </div>
        </div>
        <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-5 border-b border-neutral-800/40">
            <div>
              <h4 className="text-white font-medium text-[15px]">YouTube Download Quality</h4>
              <p className="text-[13px] text-neutral-500 mt-1">Quality of audio files downloaded from YouTube.</p>
            </div>
            <div className="relative ml-8 shrink-0">
              <select value={downloadQuality} onChange={(e) => setDownloadQuality(e.target.value)}
                className="bg-transparent text-white font-medium text-[15px] focus:outline-none cursor-pointer appearance-none pr-5">
                <option value="High" className="bg-[#111]">High</option>
                <option value="Medium" className="bg-[#111]">Medium</option>
                <option value="Low" className="bg-[#111]">Low</option>
              </select>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-400">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between px-5 py-5 cursor-pointer group hover:bg-white/[0.02] transition-colors"
            onClick={handleSelectDirectory}>
            <div className="flex-1 min-w-0">
              <h4 className="text-white font-medium text-[15px]">Download Folder</h4>
              <p className="text-[13px] text-neutral-500 mt-1 truncate">{downloadPath}</p>
            </div>
            <button className="p-2 ml-4 text-neutral-500 group-hover:text-white transition-colors shrink-0">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 z-10 custom-scrollbar">
      <div className="flex items-center gap-3 mb-8">
        <Settings className="text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]" size={32} />
        <h2 className="text-3xl font-bold text-white">Settings</h2>
      </div>
      <div className="border border-neutral-800/60 rounded-xl overflow-hidden">
        <button onClick={() => setPage('downloads')}
          className="w-full flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition-colors duration-150 group">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-white shrink-0">
            <FolderDown size={20} className="text-black" />
          </div>
          <div className="flex-1 text-left">
            <h3 className="text-[15px] font-bold text-white">Downloads</h3>
            <p className="text-[13px] text-neutral-500 mt-0.5">Download path, quality and more...</p>
          </div>
          <ChevronRight size={16} className="text-neutral-600 group-hover:text-neutral-400 transition-colors" />
        </button>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function VanguardPlayer() {
  // ── Core ──
  const [tracks, setTracks] = useState<Track[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(() => loadFromStorage('vg_searchHistory', []));
  const [showHistory, setShowHistory] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(() => loadFromStorage('vg_currentTrack', null));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState(false);
  const [activeNav, setActiveNav] = useState('home');
  const [progressSeconds, setProgressSeconds] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [quickPicks, setQuickPicks] = useState<Track[]>(() => loadFromStorage('vg_quickPicks', []));

  // ── Queue & modes ──
  const [queue, setQueue] = useState<Track[]>(() => loadFromStorage('vg_queue', []));
  const [playHistory, setPlayHistory] = useState<Track[]>(() => loadFromStorage('vg_playHistory', []));
  const [shuffle, setShuffle] = useState<boolean>(() => loadFromStorage('vg_shuffle', false));
  const [repeatMode, setRepeatMode] = useState<RepeatMode>(() => loadFromStorage('vg_repeatMode', 'off'));
  const [isQueueOpen, setIsQueueOpen] = useState(false);

  // ── Volume ──
  const [volume, setVolume] = useState<number>(() => loadFromStorage('vg_volume', 100));
  const [previousVolume, setPreviousVolume] = useState(100);

  // ── Drag ──
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);

  // ── Playlists ──
  const [playlists, setPlaylists] = useState<Playlist[]>(() =>
    loadFromStorage('vg_playlists', [{ id: 'p1', name: 'Liked Songs', tracks: [] }])
  );
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [addToPlaylistTrack, setAddToPlaylistTrack] = useState<Track | null>(null);

  // ── Modals ──
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const [infoModalTrack, setInfoModalTrack] = useState<Track | null>(null);
  const [downloadingTracks, setDownloadingTracks] = useState<{ [key: string]: boolean }>({});
  const [hoveredTrack, setHoveredTrack] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // ── Settings ──
  const [downloadQuality, setDownloadQuality] = useState<string>(() => loadFromStorage('vg_dlQuality', 'High'));
  const [downloadPath, setDownloadPath] = useState<string>(() => loadFromStorage('vg_dlPath', '~/Downloads'));

  const searchRef = useRef<HTMLInputElement>(null);
  const endDetectedRef = useRef(false);

  // ─── PERSIST ──────────────────────────────────────────────────────────────
  useEffect(() => { saveToStorage('vg_playlists', playlists); }, [playlists]);
  useEffect(() => { saveToStorage('vg_queue', queue); }, [queue]);
  useEffect(() => { saveToStorage('vg_playHistory', playHistory); }, [playHistory]);
  useEffect(() => { saveToStorage('vg_shuffle', shuffle); }, [shuffle]);
  useEffect(() => { saveToStorage('vg_repeatMode', repeatMode); }, [repeatMode]);
  useEffect(() => { saveToStorage('vg_volume', volume); }, [volume]);
  useEffect(() => { saveToStorage('vg_currentTrack', currentTrack); }, [currentTrack]);
  useEffect(() => { saveToStorage('vg_searchHistory', searchHistory); }, [searchHistory]);
  useEffect(() => { saveToStorage('vg_dlQuality', downloadQuality); }, [downloadQuality]);
  useEffect(() => { saveToStorage('vg_dlPath', downloadPath); }, [downloadPath]);
  useEffect(() => { saveToStorage('vg_quickPicks', quickPicks); }, [quickPicks]);

  // ─── TOAST ────────────────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // ─── CLOSE ON OUTSIDE CLICK ───────────────────────────────────────────────
  useEffect(() => {
    const handleClick = () => { setContextMenu(null); setShowHistory(false); };
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // ─── PLAYBACK (defined early for keyboard hook) ───────────────────────────
  const handlePlayTrack = useCallback(async (track: Track, fromQueue = false) => {
    endDetectedRef.current = false;
    setIsLoadingTrack(true);
    setIsPlaying(false);
    setProgressSeconds(0);
    setCurrentTrack(track);

    if (currentTrack && !fromQueue) {
      setPlayHistory(prev => [currentTrack, ...prev].slice(0, 50));
    }
    setQuickPicks(prev => {
      const filtered = prev.filter(t => t.url !== track.url);
      return [track, ...filtered].slice(0, 20);
    });

    try {
      await invoke("play_audio", { url: track.url });
      await invoke("set_volume", { volume });

      // Poll until mpv actually has audio playing (pos > 0), max 20s
      let waited = 0;
      const maxWait = 20000;
      const pollMs = 300;
      await new Promise<void>((resolve) => {
        const timer = setInterval(async () => {
          waited += pollMs;
          try {
            const pos: number = await invoke("get_progress");
            if (pos > 0) {
              clearInterval(timer);
              resolve();
            }
          } catch {
            // socket not ready yet — keep polling
          }
          if (waited >= maxWait) {
            clearInterval(timer);
            resolve(); // give up waiting, let it through
          }
        }, pollMs);
      });

      setIsPlaying(true);
    } catch {
      showToast("Playback failed — is mpv installed?");
      setIsPlaying(false);
    } finally {
      setIsLoadingTrack(false);
    }
  }, [currentTrack, volume, showToast]);

  const togglePlayPause = useCallback(async () => {
    if (!currentTrack) return;
    try {
      await invoke("pause_audio");
      setIsPlaying(prev => !prev);
    } catch {}
  }, [currentTrack]);

  const toggleMute = useCallback(async () => {
    const newVol = volume === 0 ? previousVolume : 0;
    if (volume > 0) setPreviousVolume(volume);
    setVolume(newVol);
    try { await invoke("set_volume", { volume: newVol }); } catch {}
  }, [volume, previousVolume]);

  // ─── KEYBOARD SHORTCUTS ──────────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === 'INPUT' || tag === 'TEXTAREA';
      if (e.code === 'Space' && !isInput) { e.preventDefault(); togglePlayPause(); }
      if (e.code === 'ArrowRight' && !isInput && currentTrack) {
        e.preventDefault();
        const newTime = Math.min(progressSeconds + 10, parseDurationToSeconds(currentTrack.duration));
        invoke("seek_audio", { time: newTime }).catch(() => {});
        setProgressSeconds(newTime);
      }
      if (e.code === 'ArrowLeft' && !isInput && currentTrack) {
        e.preventDefault();
        const newTime = Math.max(progressSeconds - 10, 0);
        invoke("seek_audio", { time: newTime }).catch(() => {});
        setProgressSeconds(newTime);
      }
      if (e.code === 'KeyM' && !isInput) toggleMute();
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentTrack, progressSeconds, togglePlayPause, toggleMute]);

  // ─── TRACK END HANDLER ────────────────────────────────────────────────────
  const handleTrackEnd = useCallback(() => {
    if (endDetectedRef.current) return;
    endDetectedRef.current = true;

    if (repeatMode === 'one' && currentTrack) {
      endDetectedRef.current = false;
      invoke("seek_audio", { time: 0 }).catch(() => {});
      setProgressSeconds(0);
      return;
    }
    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      handlePlayTrack(next, true);
      return;
    }
    if (repeatMode === 'all' && currentTrack) {
      handlePlayTrack(currentTrack, true);
      return;
    }
    setIsPlaying(false);
  }, [repeatMode, currentTrack, queue, handlePlayTrack]);

  // ─── PROGRESS POLL + END DETECTION ───────────────────────────────────────
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying && !isLoadingTrack && !isDraggingProgress) {
      interval = setInterval(async () => {
        try {
          const pos: number = await invoke("get_progress");
          setProgressSeconds(pos);
          if (currentTrack && pos > 5) {
            const total = parseDurationToSeconds(currentTrack.duration);
            if (total > 0 && pos >= total - 1) handleTrackEnd();
          }
        } catch {}
      }, 500);
    }
    return () => clearInterval(interval);
  }, [isPlaying, isLoadingTrack, isDraggingProgress, currentTrack, handleTrackEnd]);

  // ─── FOLDER PICKER ────────────────────────────────────────────────────────
  const handleSelectDirectory = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, defaultPath: downloadPath });
      if (selected) setDownloadPath(selected as string);
    } catch {}
  };

  // ─── DRAG LOGIC ───────────────────────────────────────────────────────────
  const updateProgressFromEvent = useCallback((clientX: number) => {
    if (!progressRef.current || !currentTrack) return undefined;
    const rect = progressRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = parseDurationToSeconds(currentTrack.duration) * percent;
    setProgressSeconds(newTime);
    return newTime;
  }, [currentTrack]);

  const updateVolumeFromEvent = useCallback((clientX: number) => {
    if (!volumeRef.current) return;
    const rect = volumeRef.current.getBoundingClientRect();
    const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setVolume(percent);
    invoke("set_volume", { volume: percent }).catch(() => {});
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDraggingProgress) updateProgressFromEvent(e.clientX);
      if (isDraggingVolume) updateVolumeFromEvent(e.clientX);
    };
    const onUp = async (e: MouseEvent) => {
      if (isDraggingProgress) {
        const t = updateProgressFromEvent(e.clientX);
        if (t !== undefined) await invoke("seek_audio", { time: t }).catch(() => {});
        setIsDraggingProgress(false);
      }
      if (isDraggingVolume) setIsDraggingVolume(false);
    };
    if (isDraggingProgress || isDraggingVolume) {
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [isDraggingProgress, isDraggingVolume, updateProgressFromEvent, updateVolumeFromEvent]);

  // ─── SEARCH ───────────────────────────────────────────────────────────────
  const searchMusic = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? searchQuery).trim();
    if (!q) return;
    setIsSearching(true);
    setTracks([]);
    setShowHistory(false);
    setSearchHistory(prev => [q, ...prev.filter(h => h !== q)].slice(0, 8));
    try {
      const response: string = await invoke("search_youtube", { query: q });
      const parsed = response.trim().split("\n").filter(l => l.trim()).map((line, index) => {
        const [title, uploader, duration, id] = line.split("====");
        const cleanId = id?.trim();
        return {
          id: index,
          title: title?.trim() || "Unknown Title",
          artist: uploader?.trim() || "Unknown Artist",
          duration: duration?.trim() || "0:00",
          url: `https://youtube.com/watch?v=${cleanId}`,
          cover: `https://i.ytimg.com/vi/${cleanId}/mqdefault.jpg`,
        };
      });
      setTracks(parsed);
    } catch {
      showToast("Search failed — is yt-dlp installed?");
    } finally {
      setIsSearching(false);
    }
  };

  // ─── SKIP CONTROLS ────────────────────────────────────────────────────────
  const handleSkipForward = async () => {
    if (queue.length > 0) {
      const [next, ...rest] = queue;
      setQueue(rest);
      await handlePlayTrack(next, true);
    }
  };

  const handleSkipBack = async () => {
    if (progressSeconds > 3) {
      await invoke("seek_audio", { time: 0 }).catch(() => {});
      setProgressSeconds(0);
    } else if (playHistory.length > 0) {
      const [prev, ...rest] = playHistory;
      setPlayHistory(rest);
      await handlePlayTrack(prev, true);
    } else {
      await invoke("seek_audio", { time: 0 }).catch(() => {});
      setProgressSeconds(0);
    }
  };

  const toggleShuffle = () => setShuffle(prev => { showToast(!prev ? "Shuffle on" : "Shuffle off"); return !prev; });
  const cycleRepeat = () => setRepeatMode(prev => {
    const next: RepeatMode = prev === 'off' ? 'all' : prev === 'all' ? 'one' : 'off';
    showToast(next === 'off' ? "Repeat off" : next === 'all' ? "Repeat all" : "Repeat one");
    return next;
  });

  // ─── CONTEXT MENU ─────────────────────────────────────────────────────────
  const handleContextMenu = (e: React.MouseEvent, track: Track) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 260, menuHeight = 380;
    let x = e.clientX, y = e.clientY;
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 10;
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 10;
    setContextMenu({ x, y, track });
  };

  // ─── DOWNLOAD ─────────────────────────────────────────────────────────────
  const handleDownload = async (track: Track) => {
    try {
      setDownloadingTracks(prev => ({ ...prev, [track.url]: true }));
      await invoke("download_song", { url: track.url, quality: downloadQuality, path: downloadPath });
      showToast(`Downloaded: ${track.title}`);
      setTimeout(() => setDownloadingTracks(prev => ({ ...prev, [track.url]: false })), 2000);
    } catch {
      showToast("Download failed");
      setDownloadingTracks(prev => ({ ...prev, [track.url]: false }));
    }
  };

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text); showToast("Copied to clipboard"); };
  const openInYouTube = (url: string) => window.open(url, '_blank');

  // ─── PLAYLISTS ────────────────────────────────────────────────────────────
  const confirmCreatePlaylist = () => {
    if (!newPlaylistName.trim()) return;
    setPlaylists(prev => [...prev, { id: `p${Date.now()}`, name: newPlaylistName.trim(), tracks: [] }]);
    setIsPlaylistModalOpen(false);
    showToast(`Playlist "${newPlaylistName.trim()}" created`);
  };

  const deletePlaylist = (id: string) => {
    if (id === 'p1') return;
    setPlaylists(prev => prev.filter(p => p.id !== id));
    if (openPlaylistId === id) setOpenPlaylistId(null);
    showToast("Playlist deleted");
  };

  const confirmRenamePlaylist = () => {
    if (!renameValue.trim() || !renamingPlaylistId) return;
    setPlaylists(prev => prev.map(p => p.id === renamingPlaylistId ? { ...p, name: renameValue.trim() } : p));
    setRenamingPlaylistId(null);
    showToast("Playlist renamed");
  };

  const toggleLikeTrack = (t: Track) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id !== 'p1') return p;
      const liked = p.tracks.some(x => x.url === t.url);
      return { ...p, tracks: liked ? p.tracks.filter(x => x.url !== t.url) : [...p.tracks, t] };
    }));
  };

  const addTrackToPlaylist = (playlistId: string, track: Track) => {
    setPlaylists(prev => prev.map(p => {
      if (p.id !== playlistId) return p;
      if (p.tracks.some(t => t.url === track.url)) { showToast("Already in playlist"); return p; }
      showToast(`Added to ${p.name}`);
      return { ...p, tracks: [...p.tracks, track] };
    }));
    setAddToPlaylistTrack(null);
    setContextMenu(null);
  };

  const removeFromPlaylist = (playlistId: string, trackUrl: string) => {
    setPlaylists(prev => prev.map(p => p.id !== playlistId ? p : { ...p, tracks: p.tracks.filter(t => t.url !== trackUrl) }));
    showToast("Removed from playlist");
  };

  const isTrackLiked = (url: string) => playlists.find(p => p.id === 'p1')?.tracks.some(t => t.url === url) || false;

  // ─── QUEUE HELPERS ────────────────────────────────────────────────────────
  const playAll = (trackList: Track[]) => {
    if (!trackList.length) return;
    const list = shuffle ? [...trackList].sort(() => Math.random() - 0.5) : [...trackList];
    handlePlayTrack(list[0]);
    setQueue(list.slice(1));
    showToast(shuffle ? "Shuffle playing all" : "Playing all");
  };

  const removeFromQueue = (index: number) => setQueue(prev => prev.filter((_, i) => i !== index));

  // ─── PROGRESS PERCENT ─────────────────────────────────────────────────────
  const calculateProgressPercent = () => {
    if (!currentTrack) return 0;
    const total = parseDurationToSeconds(currentTrack.duration);
    return total === 0 ? 0 : Math.min((progressSeconds / total) * 100, 100);
  };

  // ─── TRACK ROW ────────────────────────────────────────────────────────────
  const TrackRow = ({
    track, index, showRemove, onRemove,
  }: { track: Track; index: number; showRemove?: boolean; onRemove?: () => void; }) => {
    const isActive = currentTrack?.url === track.url;
    const isHovered = hoveredTrack === track.id;
    return (
      <div
        className={`flex items-center gap-4 px-4 py-3.5 rounded-lg cursor-pointer transition-all duration-150 group
          ${isActive ? 'bg-[#39FF14]/[0.07] border border-[#39FF14]/20' : 'hover:bg-white/5 border border-transparent'}`}
        onClick={() => handlePlayTrack(track)}
        onContextMenu={(e) => handleContextMenu(e, track)}
        onMouseEnter={() => setHoveredTrack(track.id)}
        onMouseLeave={() => setHoveredTrack(null)}
      >
        <div className="w-8 flex items-center justify-center shrink-0">
          {isActive && isLoadingTrack ? (
            <div className="w-3.5 h-3.5 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
          ) : isActive && isPlaying ? (
            <div className="flex gap-[2px] items-end h-4">
              <div className="w-[3px] bg-[#39FF14] rounded-full animate-pulse shadow-[0_0_4px_#39FF14]" style={{ height: '100%' }} />
              <div className="w-[3px] bg-[#39FF14] rounded-full animate-pulse shadow-[0_0_4px_#39FF14]" style={{ height: '65%', animationDelay: '150ms' }} />
              <div className="w-[3px] bg-[#39FF14] rounded-full animate-pulse shadow-[0_0_4px_#39FF14]" style={{ height: '80%', animationDelay: '300ms' }} />
            </div>
          ) : isHovered ? (
            <Play size={16} fill="white" className="text-white" />
          ) : (
            <span className={`text-[13px] tabular-nums ${isActive ? 'text-[#39FF14]' : 'text-neutral-500'}`}>{index + 1}</span>
          )}
        </div>

        <div className="w-12 h-12 rounded-md overflow-hidden shrink-0 border border-neutral-800/60">
          <img src={track.cover} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
        </div>

        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-[15px] truncate transition-colors duration-150 ${isActive ? 'text-[#39FF14]' : 'text-white'}`}>
            {track.title}
          </p>
          <p className="text-[13px] text-neutral-500 truncate mt-0.5">{track.artist}</p>
        </div>

        <div className={`flex items-center gap-1 transition-opacity duration-150 ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
          <button onClick={(e) => { e.stopPropagation(); toggleLikeTrack(track); }}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
            <Heart size={14} className={isTrackLiked(track.url) ? 'text-[#39FF14] fill-[#39FF14]' : 'text-neutral-400'} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); handleDownload(track); }}
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
            {downloadingTracks[track.url]
              ? <div className="w-3.5 h-3.5 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
              : <Download size={14} className="text-neutral-400" />}
          </button>
          {showRemove && onRemove ? (
            <button onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="p-1.5 rounded-md hover:bg-red-500/20 transition-colors">
              <X size={14} className="text-neutral-400 hover:text-red-400" />
            </button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); handleContextMenu(e, track); }}
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
              <MoreVertical size={14} className="text-neutral-400" />
            </button>
          )}
        </div>

        <span className="text-[13px] text-neutral-500 tabular-nums w-12 text-right shrink-0">{track.duration}</span>
      </div>
    );
  };

  // ─── TRACK ROW SKELETON ───────────────────────────────────────────────────
  const TrackRowSkeleton = ({ index }: { index: number }) => (
    <div className="flex items-center gap-4 px-4 py-3.5 rounded-lg border border-transparent">
      <div className="w-8 flex items-center justify-center shrink-0">
        <span className="text-[13px] text-neutral-800">{index + 1}</span>
      </div>
      <div className="w-12 h-12 rounded-md shrink-0 bg-neutral-800/60 animate-pulse" />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="h-3.5 bg-neutral-800/70 rounded-full animate-pulse" style={{ width: `${55 + (index * 13) % 35}%` }} />
        <div className="h-2.5 bg-neutral-800/50 rounded-full animate-pulse" style={{ width: `${30 + (index * 7) % 25}%` }} />
      </div>
      <div className="w-12 h-2.5 bg-neutral-800/50 rounded-full animate-pulse shrink-0" />
    </div>
  );

  // ─── QUICK PICK CARD SKELETON ─────────────────────────────────────────────
  const QuickPickSkeleton = () => (
    <div className="flex items-center gap-3 bg-neutral-900/50 rounded-lg p-3 border border-neutral-800/30">
      <div className="w-12 h-12 rounded-md shrink-0 bg-neutral-800/60 animate-pulse" />
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="h-3 bg-neutral-800/70 rounded-full animate-pulse w-3/4" />
        <div className="h-2.5 bg-neutral-800/40 rounded-full animate-pulse w-1/2" />
      </div>
    </div>
  );

  const openPlaylist = playlists.find(p => p.id === openPlaylistId);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen w-full bg-[#050505] text-white font-sans overflow-hidden selection:bg-[#39FF14] selection:text-black relative">
      <style>{`
        @keyframes loadbar {
          0%   { transform: translateX(-100%); }
          50%  { transform: translateX(150%); }
          100% { transform: translateX(400%); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      <div className="flex flex-1 overflow-hidden">

        {/* ── SIDEBAR ── */}
        <div className="w-64 bg-[#0a0a0a] border-r border-neutral-800/50 flex flex-col p-6 z-10 shrink-0">
          <div className="flex items-center gap-3 mb-10 cursor-pointer group">
            <div className="w-8 h-8 rounded bg-[#39FF14] flex items-center justify-center shadow-[0_0_15px_rgba(57,255,20,0.5)] group-hover:shadow-[0_0_25px_rgba(57,255,20,0.8)] transition-all duration-300">
              <Music size={20} className="text-black" />
            </div>
            <h1 className="text-2xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#39FF14] to-emerald-200 drop-shadow-[0_0_8px_rgba(57,255,20,0.6)]">
              VANGUARD
            </h1>
          </div>

          <nav className="flex flex-col gap-2 mb-auto">
            {[
              { id: 'home', label: 'Home', icon: Home },
              { id: 'library', label: 'Library', icon: Library },
              { id: 'settings', label: 'Settings', icon: Settings },
            ].map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setActiveNav(id)}
                className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-200 w-full text-left
                  ${activeNav === id ? 'bg-neutral-800/50 text-[#39FF14] shadow-[inset_2px_0_0_#39FF14]' : 'text-neutral-400 hover:text-[#39FF14] hover:bg-neutral-900/50'}`}>
                <Icon size={20} className={activeNav === id ? 'drop-shadow-[0_0_5px_#39FF14]' : ''} />
                <span className="font-medium">{label}</span>
              </button>
            ))}

            <button onClick={() => setIsQueueOpen(o => !o)}
              className={`flex items-center gap-4 px-4 py-3 rounded-lg transition-all duration-200 w-full text-left
                ${isQueueOpen ? 'bg-neutral-800/50 text-[#39FF14] shadow-[inset_2px_0_0_#39FF14]' : 'text-neutral-400 hover:text-[#39FF14] hover:bg-neutral-900/50'}`}>
              <ListOrdered size={20} className={isQueueOpen ? 'drop-shadow-[0_0_5px_#39FF14]' : ''} />
              <span className="font-medium">Queue</span>
              {queue.length > 0 && (
                <span className="ml-auto bg-[#39FF14] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                  {queue.length}
                </span>
              )}
            </button>
          </nav>

          <div className="mt-8">
            <button className="w-full relative group overflow-hidden rounded-lg bg-transparent border border-[#39FF14]/50 py-3 px-4 flex items-center justify-center gap-2 transition-all duration-300 hover:border-[#39FF14] hover:shadow-[0_0_20px_rgba(57,255,20,0.3)]">
              <div className="absolute inset-0 bg-[#39FF14]/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
              <DownloadCloud size={18} className="text-[#39FF14] relative z-10" />
              <span className="text-sm font-semibold text-[#39FF14] relative z-10">Import from Spotify</span>
            </button>
          </div>
        </div>

        {/* ── CENTER ── */}
        <div className="flex-1 flex flex-col bg-gradient-to-b from-[#0f1115] to-[#050505] overflow-hidden relative">
          <div className="absolute inset-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#39FF14]/10 via-transparent to-transparent" />

          {activeNav === 'home' ? (
            <>
              {/* Search */}
              <div className="p-6 pb-3 relative z-30 shrink-0">
                <div className="relative w-full" onClick={(e) => e.stopPropagation()}>
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    {isSearching
                      ? <div className="w-4 h-4 border-2 border-[#39FF14]/70 border-t-transparent rounded-full animate-spin" />
                      : <Search size={18} className={`transition-colors duration-200 ${showHistory || searchQuery ? 'text-[#39FF14]' : 'text-neutral-500'}`} />
                    }
                  </div>
                  <input ref={searchRef} type="text"
                    placeholder="Search YouTube or enter a URL... (Ctrl+F)"
                    value={searchQuery}
                    onChange={(e) => !isSearching && setSearchQuery(e.target.value)}
                    onFocus={() => !isSearching && setShowHistory(searchHistory.length > 0)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { setShowHistory(false); searchMusic(); } if (e.key === 'Escape') setShowHistory(false); }}
                    className={`w-full bg-[#111] border text-white rounded-xl py-3 pl-11 pr-4 focus:outline-none transition-all duration-200 placeholder-neutral-600 font-medium text-sm
                      ${isSearching
                        ? 'border-[#39FF14]/40 ring-1 ring-[#39FF14]/30 opacity-70 cursor-not-allowed'
                        : 'border-neutral-800 focus:border-[#39FF14] focus:ring-1 focus:ring-[#39FF14] focus:shadow-[0_0_20px_rgba(57,255,20,0.1)]'}`}
                  />
                  {/* History dropdown — rendered outside scroll, high z-index */}
                  {showHistory && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-[#0e0e0e] border border-neutral-800/80 rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)] z-[100]">
                      <div className="flex items-center justify-between px-4 py-2.5 border-b border-neutral-800/50">
                        <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-600">Recent searches</span>
                        <button onClick={(e) => { e.stopPropagation(); setSearchHistory([]); setShowHistory(false); }}
                          className="text-[11px] text-neutral-600 hover:text-red-400 transition-colors px-1">Clear</button>
                      </div>
                      {searchHistory.map((h, i) => (
                        <button key={i}
                          onClick={(e) => { e.stopPropagation(); setSearchQuery(h); setShowHistory(false); searchMusic(h); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.04] transition-colors text-left">
                          <Clock size={13} className="text-neutral-600 shrink-0" />
                          <span className="text-sm text-neutral-300 truncate flex-1">{h}</span>
                          <ChevronRight size={12} className="text-neutral-700 shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Results */}
              <div className="flex-1 overflow-y-auto px-6 pb-4 z-10 custom-scrollbar" onClick={() => setShowHistory(false)}>

                {/* ── Quick Picks (shown when no active search) ── */}
                {!isSearching && tracks.length === 0 && quickPicks.length > 0 && (
                  <div className="mb-6 pt-1">
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-1.5 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
                      <h2 className="text-base font-bold text-white flex-1">Quick Picks</h2>
                      <button onClick={() => { setQuickPicks([]); showToast("Quick Picks cleared"); }}
                        className="text-[11px] text-neutral-600 hover:text-neutral-400 transition-colors">Clear</button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {quickPicks.slice(0, 8).map((track) => {
                        const isActive = currentTrack?.url === track.url;
                        const isLoading = isLoadingTrack && isActive;
                        return (
                          <div key={track.url}
                            onClick={() => handlePlayTrack(track)}
                            onContextMenu={(e) => handleContextMenu(e, track)}
                            className={`flex items-center gap-3 rounded-lg p-3 cursor-pointer transition-all duration-150 group border
                              ${isActive ? 'bg-[#39FF14]/[0.07] border-[#39FF14]/20' : 'bg-neutral-900/40 border-neutral-800/30 hover:bg-neutral-800/60 hover:border-neutral-700/50'}`}>
                            <div className="relative w-12 h-12 rounded-md overflow-hidden shrink-0">
                              <img src={track.cover} alt={track.title} className="w-full h-full object-cover" loading="lazy" />
                              {/* hover overlay */}
                              <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity duration-150
                                ${isLoading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                {isLoading
                                  ? <div className="w-4 h-4 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
                                  : isActive && isPlaying
                                    ? <div className="flex gap-[2px] items-end h-3">
                                        <div className="w-[2px] bg-[#39FF14] rounded-full animate-pulse" style={{ height: '100%' }} />
                                        <div className="w-[2px] bg-[#39FF14] rounded-full animate-pulse" style={{ height: '65%', animationDelay: '150ms' }} />
                                        <div className="w-[2px] bg-[#39FF14] rounded-full animate-pulse" style={{ height: '80%', animationDelay: '300ms' }} />
                                      </div>
                                    : <Play size={14} fill="white" className="text-white ml-0.5" />}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-semibold truncate ${isActive ? 'text-[#39FF14]' : 'text-white'}`}>
                                {track.title}
                              </p>
                              <p className="text-xs text-neutral-500 truncate mt-0.5">{track.artist}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Search header (only show when searching or have results) ── */}
                {(isSearching || tracks.length > 0) && (
                <div className="flex items-center gap-3 mb-3 py-2">
                  <span className="w-1.5 h-5 bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] shrink-0" />
                  <h2 className="text-base font-bold text-white flex-1">
                    {isSearching ? 'Scanning...' : 'Search Results'}
                  </h2>
                  {isSearching && (
                    <div className="flex gap-1 items-end h-4">
                      {[100, 60, 80, 50].map((h, i) => (
                        <div key={i} className="w-1 bg-[#39FF14]/60 rounded-full animate-pulse shadow-[0_0_4px_#39FF14]"
                          style={{ height: `${h}%`, animationDelay: `${i * 100}ms` }} />
                      ))}
                    </div>
                  )}
                  {tracks.length > 0 && !isSearching && (
                    <button onClick={() => playAll(tracks)}
                      className="flex items-center gap-2 px-3 py-1.5 bg-[#39FF14]/10 border border-[#39FF14]/30 text-[#39FF14] rounded-lg text-xs font-semibold hover:bg-[#39FF14]/20 transition-colors">
                      <Play size={12} fill="currentColor" /> Play All
                    </button>
                  )}
                </div>
                )}

                {/* ── Column headers ── */}
                {(tracks.length > 0 || isSearching) && (
                  <div className="flex items-center gap-4 px-4 mb-1 border-b border-neutral-800/40 pb-2">
                    <div className="w-8 shrink-0" /><div className="w-12 shrink-0" />
                    <p className="flex-1 text-[11px] font-semibold uppercase tracking-widest text-neutral-600">Title</p>
                    <div className="w-20 shrink-0" />
                    <Clock size={12} className="text-neutral-600 w-12 shrink-0" />
                  </div>
                )}

                {/* ── Skeleton rows while searching ── */}
                {isSearching && (
                  <div className="flex flex-col gap-1 mt-1">
                    {Array.from({ length: 8 }).map((_, i) => <TrackRowSkeleton key={i} index={i} />)}
                  </div>
                )}

                {/* ── Real results ── */}
                {!isSearching && tracks.length > 0 && (
                  <div className="flex flex-col gap-1 mt-1">
                    {tracks.map((track, i) => <TrackRow key={track.id} track={track} index={i} />)}
                  </div>
                )}

                {/* ── Empty state (no search, no quick picks) ── */}
              </div>
            </>

          ) : activeNav === 'library' ? (
            openPlaylist ? (
              // Playlist detail
              <div className="flex-1 overflow-y-auto p-8 z-10 custom-scrollbar">
                <button onClick={() => setOpenPlaylistId(null)}
                  className="flex items-center gap-2 text-neutral-400 hover:text-white transition-colors mb-8 group">
                  <ChevronLeft size={18} className="group-hover:-translate-x-0.5 transition-transform" />
                  <span className="text-sm font-medium">Library</span>
                </button>

                <div className="flex items-end gap-6 mb-8">
                  <div className="w-28 h-28 rounded-xl bg-neutral-900 border border-neutral-800 flex items-center justify-center shrink-0">
                    {openPlaylist.id === 'p1'
                      ? <Heart size={48} className="text-red-400" />
                      : <ListMusic size={48} className="text-neutral-500" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-1">Playlist</p>
                    <h2 className="text-3xl font-black text-white truncate">{openPlaylist.name}</h2>
                    <p className="text-sm text-neutral-500 mt-2">{openPlaylist.tracks.length} tracks</p>
                    <div className="flex items-center gap-3 mt-4">
                      <button onClick={() => playAll(openPlaylist.tracks)} disabled={!openPlaylist.tracks.length}
                        className="flex items-center gap-2 px-5 py-2 bg-[#39FF14] text-black font-bold rounded-lg hover:shadow-[0_0_20px_#39FF14] transition-all disabled:opacity-40 text-sm">
                        <Play size={16} fill="currentColor" /> Play All
                      </button>
                      {openPlaylist.id !== 'p1' && (
                        <button onClick={() => { setRenamingPlaylistId(openPlaylist.id); setRenameValue(openPlaylist.name); }}
                          className="p-2 text-neutral-500 hover:text-white transition-colors rounded-lg hover:bg-white/5">
                          <Pencil size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {openPlaylist.tracks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-neutral-700 gap-3">
                    <Music size={32} strokeWidth={1} />
                    <p className="text-sm">No tracks yet</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {openPlaylist.tracks.map((t, i) => (
                      <TrackRow key={t.url} track={t} index={i}
                        showRemove onRemove={() => removeFromPlaylist(openPlaylist.id, t.url)} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              // Library grid
              <div className="flex-1 overflow-y-auto p-8 z-10 custom-scrollbar">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                    <Library className="text-[#39FF14] drop-shadow-[0_0_8px_#39FF14]" size={32} />
                    Your Library
                  </h2>
                  <button onClick={() => { setNewPlaylistName(''); setIsPlaylistModalOpen(true); }}
                    className="px-5 py-2.5 bg-transparent border border-[#39FF14]/50 text-[#39FF14] rounded-lg hover:bg-[#39FF14] hover:text-black transition-all duration-300 font-semibold flex items-center gap-2">
                    <ListMusic size={18} /> Create Playlist
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-6">
                  {playlists.map((playlist) => (
                    <div key={playlist.id}
                      className="group relative cursor-pointer bg-[#0d0d0d] p-5 rounded-xl border border-neutral-800/50 hover:border-[#39FF14]/50 transition-all duration-300 hover:-translate-y-2 hover:shadow-[0_10px_30px_rgba(57,255,20,0.15)]"
                      onClick={() => setOpenPlaylistId(playlist.id)}>
                      <div className="aspect-square rounded-lg bg-neutral-900/80 flex items-center justify-center mb-4 group-hover:bg-[#39FF14]/10 transition-colors duration-300 relative">
                        {playlist.id === 'p1'
                          ? <Heart size={48} className="text-red-400 group-hover:text-red-500 transition-all duration-300" />
                          : <ListMusic size={48} className="text-neutral-500 group-hover:text-[#39FF14] transition-all duration-300" />}
                        {playlist.tracks.length > 0 && (
                          <div className="absolute bottom-2 right-2 bg-[#39FF14] text-black text-xs font-bold px-2 py-0.5 rounded-full shadow-[0_0_5px_#39FF14]">
                            {playlist.tracks.length}
                          </div>
                        )}
                      </div>
                      <h3 className="font-bold text-white group-hover:text-[#39FF14] transition-colors truncate">{playlist.name}</h3>
                      <p className="text-xs text-neutral-500 mt-1">Playlist</p>
                      {playlist.id !== 'p1' && (
                        <button onClick={(e) => { e.stopPropagation(); deletePlaylist(playlist.id); }}
                          className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1.5 bg-black/60 rounded-md hover:bg-red-500/30 hover:text-red-400 text-neutral-500 transition-all">
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <SettingsPanel downloadQuality={downloadQuality} setDownloadQuality={setDownloadQuality}
              downloadPath={downloadPath} handleSelectDirectory={handleSelectDirectory} />
          )}
        </div>

        {/* ── QUEUE PANEL ── */}
        <div className={`shrink-0 bg-[#0a0a0a] border-l border-neutral-800/50 flex flex-col transition-all duration-300 ease-in-out overflow-hidden
          ${isQueueOpen ? 'w-80' : 'w-0'}`}>
          {isQueueOpen && (
            <>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800/50 shrink-0">
                <div className="flex items-center gap-2.5">
                  <ListOrdered size={18} className="text-[#39FF14]" />
                  <h3 className="font-bold text-white text-[15px]">Queue</h3>
                  {queue.length > 0 && (
                    <span className="bg-[#39FF14] text-black text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">{queue.length}</span>
                  )}
                </div>
                {queue.length > 0 && (
                  <button onClick={() => { setQueue([]); showToast("Queue cleared"); }}
                    className="text-xs text-neutral-600 hover:text-red-400 transition-colors">Clear</button>
                )}
              </div>

              {/* Now Playing */}
              {currentTrack && (
                <div className="px-4 py-3.5 border-b border-neutral-800/40 shrink-0">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 mb-3">Now Playing</p>
                  <div
                    className="flex items-center gap-3 rounded-lg p-2.5 cursor-pointer bg-[#39FF14]/[0.05] border border-[#39FF14]/15 hover:bg-[#39FF14]/[0.09] transition-colors"
                    onClick={() => handlePlayTrack(currentTrack, true)}
                  >
                    <div className="relative w-11 h-11 rounded-md overflow-hidden shrink-0 border border-[#39FF14]/30">
                      <img src={currentTrack.cover} className="w-full h-full object-cover" alt="" />
                      {isLoadingTrack && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <div className="w-4 h-4 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                      {!isLoadingTrack && isPlaying && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <div className="flex gap-[2px] items-end h-3.5">
                            <div className="w-[2.5px] bg-[#39FF14] rounded-full animate-pulse" style={{ height: '100%' }} />
                            <div className="w-[2.5px] bg-[#39FF14] rounded-full animate-pulse" style={{ height: '60%', animationDelay: '150ms' }} />
                            <div className="w-[2.5px] bg-[#39FF14] rounded-full animate-pulse" style={{ height: '80%', animationDelay: '300ms' }} />
                          </div>
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

              {/* Up Next list */}
              <div className="flex-1 overflow-y-auto custom-scrollbar">
                {queue.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-40 text-neutral-700 gap-2">
                    <ListOrdered size={26} strokeWidth={1} />
                    <p className="text-sm">Queue is empty</p>
                  </div>
                ) : (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-neutral-600 px-5 pt-4 pb-2">Up Next</p>
                    {queue.map((track, i) => {
                      const isQActive = currentTrack?.url === track.url;
                      return (
                        <div
                          key={i}
                          onClick={() => {
                            setQueue(prev => prev.filter((_, idx) => idx !== i));
                            handlePlayTrack(track, true);
                          }}
                          className={`flex items-center gap-3 px-4 py-3 cursor-pointer group transition-colors
                            ${isQActive ? 'bg-[#39FF14]/[0.06]' : 'hover:bg-white/[0.04]'}`}
                        >
                          {/* Index / play on hover */}
                          <div className="w-5 shrink-0 flex items-center justify-center">
                            <span className="text-xs text-neutral-700 group-hover:hidden tabular-nums">{i + 1}</span>
                            <Play size={12} fill="white" className="text-white hidden group-hover:block" />
                          </div>

                          {/* Thumbnail */}
                          <img src={track.cover} className="w-10 h-10 rounded-md object-cover shrink-0 border border-neutral-800/60" alt="" />

                          {/* Info */}
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold truncate leading-snug ${isQActive ? 'text-[#39FF14]' : 'text-white'}`}>
                              {track.title}
                            </p>
                            <p className="text-xs text-neutral-500 truncate mt-0.5">{track.artist}</p>
                          </div>

                          {/* Remove */}
                          <button
                            onClick={(e) => { e.stopPropagation(); removeFromQueue(i); }}
                            className="opacity-0 group-hover:opacity-100 p-1.5 text-neutral-600 hover:text-red-400 transition-all shrink-0 rounded"
                          >
                            <X size={13} />
                          </button>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── PLAYER BAR ── */}
      <div className="h-[88px] bg-[#080808] border-t border-neutral-800/80 flex items-center justify-between px-6 relative z-20 shadow-[0_-5px_30px_rgba(0,0,0,0.5)] shrink-0">
        {isPlaying && !isLoadingTrack && (
          <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#39FF14]/50 to-transparent" />
        )}
        {isLoadingTrack && (
          <div className="absolute top-0 left-0 w-full h-[2px] overflow-hidden bg-neutral-800/40">
            <div className="h-full bg-[#39FF14]/80 shadow-[0_0_6px_#39FF14]"
              style={{ animation: 'loadbar 1.4s ease-in-out infinite', width: '35%' }} />
          </div>
        )}

        {/* Left */}
        <div className="flex items-center gap-4 w-1/4 min-w-[180px]">
          {currentTrack ? (
            <>
              <div className="relative w-14 h-14 rounded-md overflow-hidden group border border-neutral-800 shrink-0 cursor-pointer"
                onClick={() => setInfoModalTrack(currentTrack)}>
                <img src={currentTrack.cover} alt={currentTrack.title} className={`w-full h-full object-cover transition-opacity duration-300 ${isLoadingTrack ? 'opacity-40' : 'opacity-100'}`} />
                {isLoadingTrack ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <div className="w-5 h-5 border-2 border-[#39FF14] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Info size={16} className="text-white" />
                  </div>
                )}
              </div>
              <div className="flex flex-col overflow-hidden max-w-[140px]">
                <span className="font-bold text-white text-sm truncate cursor-pointer hover:underline" onClick={() => setInfoModalTrack(currentTrack)}>
                  {currentTrack.title}
                </span>
                {isLoadingTrack ? (
                  <span className="text-xs text-[#39FF14]/70 flex items-center gap-1.5 mt-0.5">
                    <span className="flex gap-[3px] items-end h-3">
                      {[1,0.6,0.8,0.5].map((h, i) => (
                        <span key={i} className="w-[2px] bg-[#39FF14]/60 rounded-full animate-pulse inline-block"
                          style={{ height: `${h * 100}%`, animationDelay: `${i * 120}ms` }} />
                      ))}
                    </span>
                    Buffering...
                  </span>
                ) : (
                  <span className="text-xs text-neutral-400 truncate">{currentTrack.artist}</span>
                )}
              </div>
              <button onClick={() => toggleLikeTrack(currentTrack)} className="ml-1 p-1.5 focus:outline-none hover:scale-110 active:scale-95 transition-transform shrink-0">
                <Heart size={18} className={isTrackLiked(currentTrack.url) ? 'text-[#39FF14] fill-[#39FF14] drop-shadow-[0_0_8px_rgba(57,255,20,0.6)]' : 'text-neutral-400 hover:text-white'} />
              </button>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-md border border-neutral-800/50 bg-[#0d0d0d] flex items-center justify-center shrink-0">
                <Music size={20} className="text-neutral-600" />
              </div>
              <div className="flex flex-col overflow-hidden">
                <span className="font-bold text-neutral-600 text-sm">No track selected</span>
                <span className="text-xs text-neutral-700">---</span>
              </div>
            </>
          )}
        </div>

        {/* Center */}
        <div className="flex flex-col items-center justify-center w-2/4 gap-2 max-w-2xl">
          <div className="flex items-center gap-5">
            <button onClick={toggleShuffle} title="Shuffle"
              className={`transition-all duration-200 ${shuffle ? 'text-[#39FF14] drop-shadow-[0_0_6px_#39FF14]' : 'text-neutral-600 hover:text-neutral-300'}`}>
              <Shuffle size={18} />
            </button>
            <button onClick={handleSkipBack}
              className={`transition-all duration-200 ${currentTrack ? 'text-neutral-300 hover:text-[#39FF14]' : 'text-neutral-700 cursor-not-allowed'}`}>
              <SkipBack size={22} />
            </button>
            <button onClick={togglePlayPause} disabled={!currentTrack || isLoadingTrack}
              className="w-11 h-11 flex items-center justify-center rounded-full bg-white text-black hover:bg-[#39FF14] hover:shadow-[0_0_20px_#39FF14] hover:scale-105 transition-all duration-200 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 disabled:hover:bg-white disabled:hover:shadow-none">
              {isLoadingTrack
                ? <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                : isPlaying
                  ? <Pause fill="currentColor" size={22} />
                  : <Play fill="currentColor" size={22} className="ml-0.5" />}
            </button>
            <button onClick={handleSkipForward}
              className={`transition-all duration-200 ${queue.length > 0 ? 'text-neutral-300 hover:text-[#39FF14]' : 'text-neutral-700 cursor-not-allowed'}`}>
              <SkipForward size={22} />
            </button>
            <button onClick={cycleRepeat} title="Repeat"
              className={`transition-all duration-200 ${repeatMode !== 'off' ? 'text-[#39FF14] drop-shadow-[0_0_6px_#39FF14]' : 'text-neutral-600 hover:text-neutral-300'}`}>
              {repeatMode === 'one' ? <Repeat1 size={18} /> : <Repeat size={18} />}
            </button>
          </div>

          <div className="w-full flex items-center gap-3 group mt-1">
            <span className="text-xs font-medium text-neutral-400 tabular-nums min-w-[32px] text-right">
              {currentTrack ? formatTime(progressSeconds) : '0:00'}
            </span>
            <div ref={progressRef}
              className="relative flex-1 h-1 bg-neutral-800 rounded-full cursor-pointer group-hover:h-1.5 transition-all duration-200"
              onMouseDown={(e) => { setIsDraggingProgress(true); updateProgressFromEvent(e.clientX); }}>
              <div className="absolute top-0 left-0 h-full bg-[#39FF14] rounded-full shadow-[0_0_8px_#39FF14] pointer-events-none"
                style={{ width: `${calculateProgressPercent()}%`, transition: isDraggingProgress ? 'none' : 'width 0.2s linear' }}>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow-[0_0_6px_white] opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <span className="text-xs font-medium text-neutral-400 tabular-nums min-w-[32px]">
              {currentTrack ? currentTrack.duration : '0:00'}
            </span>
          </div>
        </div>

        {/* Right */}
        <div className="w-1/4 flex items-center justify-end gap-3 group pr-4">
          <button onClick={toggleMute} className="focus:outline-none shrink-0">
            {volume === 0
              ? <VolumeX size={18} className="text-red-500 hover:text-red-400 transition-colors" />
              : <Volume2 size={18} className="text-neutral-400 hover:text-white transition-colors" />}
          </button>
          <div ref={volumeRef}
            className="relative w-24 h-1 bg-neutral-800 rounded-full cursor-pointer group-hover:h-1.5 transition-all duration-200"
            onMouseDown={(e) => { setIsDraggingVolume(true); updateVolumeFromEvent(e.clientX); }}>
            <div className="absolute top-0 left-0 h-full bg-neutral-400 group-hover:bg-[#39FF14] rounded-full pointer-events-none"
              style={{ width: `${volume}%`, transition: isDraggingVolume ? 'none' : 'width 0.2s linear' }}>
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        </div>
      </div>

      {/* ── CONTEXT MENU ── */}
      {contextMenu && (
        <div className="fixed z-50 bg-[#0a0a0a] border border-neutral-800 rounded-xl shadow-2xl py-2 w-64 text-sm font-medium text-neutral-300"
          style={{ top: contextMenu.y, left: contextMenu.x }}>
          <div className="px-4 py-3 border-b border-neutral-800 mb-2 flex items-center gap-3">
            <img src={contextMenu.track.cover} className="w-10 h-10 rounded-md object-cover" alt="" />
            <div className="flex flex-col overflow-hidden">
              <span className="text-white truncate font-bold">{contextMenu.track.title}</span>
              <span className="text-xs text-neutral-500 truncate">{contextMenu.track.artist}</span>
            </div>
          </div>
          <button onClick={() => { setQueue([contextMenu.track, ...queue]); showToast("Playing next"); setContextMenu(null); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors">
            <PlaySquare size={16} /> Play Next
          </button>
          <button onClick={() => { setQueue([...queue, contextMenu.track]); showToast("Added to queue"); setContextMenu(null); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors">
            <ListPlus size={16} /> Add to Queue
          </button>
          <button onClick={() => { toggleLikeTrack(contextMenu.track); setContextMenu(null); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors">
            <Heart size={16} className={isTrackLiked(contextMenu.track.url) ? 'text-[#39FF14] fill-[#39FF14]' : ''} />
            {isTrackLiked(contextMenu.track.url) ? 'Remove from Liked' : 'Add to Liked Songs'}
          </button>
          <button onClick={(e) => { e.stopPropagation(); setAddToPlaylistTrack(contextMenu.track); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors">
            <PlusCircle size={16} /> Add to Playlist
          </button>
          <div className="h-px bg-neutral-800 my-2" />
          <button onClick={() => { copyToClipboard(contextMenu.track.url); setContextMenu(null); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors">
            <Share2 size={16} /> Copy Link
          </button>
          <button onClick={() => { handleDownload(contextMenu.track); setContextMenu(null); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors">
            {downloadingTracks[contextMenu.track.url]
              ? <div className="w-4 h-4 rounded-full border-2 border-[#39FF14] border-t-transparent animate-spin" />
              : <Download size={16} />}
            Download
          </button>
          <button onClick={() => { openInYouTube(contextMenu.track.url); setContextMenu(null); }}
            className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/80 hover:text-white transition-colors">
            <ExternalLink size={16} /> Open in YouTube
          </button>
        </div>
      )}

      {/* ── ADD TO PLAYLIST MODAL ── */}
      {addToPlaylistTrack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setAddToPlaylistTrack(null)}>
          <div className="bg-[#111] border border-neutral-800 rounded-xl w-80 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
              <h3 className="font-bold text-white">Add to Playlist</h3>
              <button onClick={() => setAddToPlaylistTrack(null)} className="text-neutral-500 hover:text-white transition-colors">
                <X size={18} />
              </button>
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
              <button onClick={() => { setAddToPlaylistTrack(null); setNewPlaylistName(''); setIsPlaylistModalOpen(true); }}
                className="flex items-center gap-2 text-[#39FF14] text-sm font-medium hover:underline">
                <PlusCircle size={14} /> New Playlist
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── INFO MODAL ── */}
      {infoModalTrack && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4">
          <div className="bg-[#0a0a0a] border border-neutral-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="relative h-48 w-full shrink-0">
              <img src={infoModalTrack.cover} className="w-full h-full object-cover opacity-40 blur-md" alt="" />
              <div className="absolute inset-0 flex items-center justify-center pt-4">
                <img src={infoModalTrack.cover} className="h-32 w-32 rounded-lg shadow-2xl object-cover" alt="" />
              </div>
              <button onClick={() => setInfoModalTrack(null)} className="absolute top-4 right-4 bg-black/60 p-2 rounded-full hover:bg-white hover:text-black transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-6 overflow-y-auto custom-scrollbar flex-1 bg-gradient-to-b from-[#111] to-[#0a0a0a]">
              <div className="flex gap-2 mb-6">
                <span className="bg-[#1a1a1a] px-3 py-1.5 rounded-full text-xs font-bold border border-neutral-800 flex items-center gap-2 text-cyan-400">
                  <Clock size={12} /> {infoModalTrack.duration}
                </span>
                <span className="bg-[#1a1a1a] px-3 py-1.5 rounded-full text-xs font-bold border border-neutral-800 flex items-center gap-2 text-red-500">
                  <Youtube size={12} /> YouTube
                </span>
              </div>
              <h4 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">Details</h4>
              <div className="space-y-2 mb-8">
                {[
                  { icon: Music, color: 'blue', label: 'Title', value: infoModalTrack.title },
                  { icon: FileBadge2, color: 'purple', label: 'Artist', value: infoModalTrack.artist },
                  { icon: Disc, color: 'pink', label: 'Album', value: 'Unknown' },
                  { icon: Hash, color: 'emerald', label: 'Genre', value: 'VIDEO' },
                ].map(({ icon: Icon, color, label, value }) => (
                  <div key={label} className="flex items-center gap-4 p-3 bg-[#111] rounded-xl border border-neutral-800/50">
                    <div className={`w-10 h-10 rounded-lg bg-${color}-500/10 flex items-center justify-center text-${color}-400`}>
                      <Icon size={20} />
                    </div>
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-xs text-neutral-500">{label}</span>
                      <span className="font-bold text-sm truncate">{value}</span>
                    </div>
                  </div>
                ))}
              </div>
              <h4 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">Technical Info</h4>
              <div className="flex items-center gap-4 p-3 bg-[#111] rounded-xl border border-neutral-800/50 mb-8">
                <div className="w-10 h-10 rounded-lg bg-neutral-800 flex items-center justify-center text-neutral-400">
                  <FileCode2 size={20} />
                </div>
                <div className="flex flex-col overflow-hidden">
                  <span className="text-xs text-neutral-500">Media ID</span>
                  <span className="font-mono text-sm text-neutral-300">{infoModalTrack.url.split('v=')[1] || 'Unknown'}</span>
                </div>
              </div>
              <h4 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">Actions</h4>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <button onClick={() => copyToClipboard(infoModalTrack.url.split('v=')[1])}
                  className="p-3 bg-[#111] rounded-xl hover:bg-neutral-800 transition-colors border border-neutral-800 flex items-center justify-center gap-2 text-sm font-medium">
                  <Copy size={16} /> Copy ID
                </button>
                <button onClick={() => copyToClipboard(infoModalTrack.url)}
                  className="p-3 bg-[#111] rounded-xl hover:bg-neutral-800 transition-colors border border-neutral-800 flex items-center justify-center gap-2 text-sm font-medium">
                  <Share2 size={16} /> Copy Link
                </button>
              </div>
              <button onClick={() => openInYouTube(infoModalTrack.url)}
                className="w-full p-3 bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500/20 transition-colors border border-red-500/20 flex items-center justify-center gap-2 text-sm font-bold">
                <ExternalLink size={18} /> Open in YouTube
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CREATE PLAYLIST MODAL ── */}
      {isPlaylistModalOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-[#39FF14]/50 p-6 rounded-xl w-96 shadow-[0_0_30px_rgba(57,255,20,0.15)]">
            <h3 className="text-xl font-bold text-white mb-4">Name your playlist</h3>
            <input autoFocus type="text" value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)} placeholder="e.g. Cyberpunk Mix"
              className="w-full bg-[#050505] border border-neutral-800 text-white rounded-lg py-2 px-3 mb-6 focus:outline-none focus:border-[#39FF14] focus:ring-1 focus:ring-[#39FF14] transition-all"
              onKeyDown={(e) => e.key === 'Enter' && confirmCreatePlaylist()} />
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsPlaylistModalOpen(false)} className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={confirmCreatePlaylist} className="px-4 py-2 bg-[#39FF14] text-black text-sm font-bold rounded-lg hover:shadow-[0_0_15px_#39FF14] transition-all">Create</button>
            </div>
          </div>
        </div>
      )}

      {/* ── RENAME PLAYLIST MODAL ── */}
      {renamingPlaylistId && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-[#111] border border-neutral-800 p-6 rounded-xl w-96 shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-4">Rename Playlist</h3>
            <input autoFocus type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
              className="w-full bg-[#050505] border border-neutral-800 text-white rounded-lg py-2 px-3 mb-6 focus:outline-none focus:border-[#39FF14] focus:ring-1 focus:ring-[#39FF14] transition-all"
              onKeyDown={(e) => { if (e.key === 'Enter') confirmRenamePlaylist(); if (e.key === 'Escape') setRenamingPlaylistId(null); }} />
            <div className="flex justify-end gap-3">
              <button onClick={() => setRenamingPlaylistId(null)} className="px-4 py-2 text-sm font-medium text-neutral-400 hover:text-white transition-colors">Cancel</button>
              <button onClick={confirmRenamePlaylist} className="px-4 py-2 bg-[#39FF14] text-black text-sm font-bold rounded-lg hover:shadow-[0_0_15px_#39FF14] transition-all">Rename</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {toast && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-50 bg-[#111] border border-neutral-800/80 text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-2xl pointer-events-none animate-in fade-in duration-200">
          {toast}
        </div>
      )}
    </div>
  );
}