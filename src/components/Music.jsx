import React, { useState, useEffect, useRef } from 'react';
import { Howl, Howler } from 'howler';
import * as musicMetadata from 'music-metadata-browser';
import { directoryOpen } from 'browser-fs-access';
import Fuse from 'fuse.js';
import { Index } from 'flexsearch';
import { parseSearchIntent } from '../libs/intentParser';

// Supported formats
const SUPPORTED_FORMATS = ['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'alac', 'aiff', 'opus'];
const defaultArtwork = 'https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100';
const DB_NAME = 'iweb-music-player';
const STORE_NAME = 'settings';
const HANDLE_KEY = 'directory-handle';
const TRACKS_KEY = 'tracks-list';
const FAVORITES_KEY = 'favorites-list';
const PLAYLISTS_KEY = 'playlists-data';
const LAST_PLAYED_KEY = 'last-played-state';

function isSupportedAudio(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return SUPPORTED_FORMATS.includes(ext);
}

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

export default function Music({ showModal: propShowModal, setShowModal: propSetShowModal }) {
  // --- React State ---
  const [library, setLibrary] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [playlists, setPlaylists] = useState({});
  const [activeView, setActiveView] = useState('home'); // 'home', 'search', 'playlist'
  const [currentPlaylistId, setCurrentPlaylistId] = useState('all'); // 'all', 'favorites', custom playlist name
  
  // Navigation History
  const [history, setHistory] = useState([{ view: 'home', playlistId: null }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Directory and status
  const [dirHandle, setDirHandle] = useState(null);
  const [statusText, setStatusText] = useState('No folder loaded.');
  
  // Playback State
  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [volume, setVolume] = useState(80);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState('off'); // 'off', 'one', 'all'
  const [outputDevice, setOutputDevice] = useState('speakers'); // speakers, buds, headphones
  const [rememberPlayback, setRememberPlayback] = useState(true);
  const [silentAutoReconnect, setSilentAutoReconnect] = useState(true);
  const [enableHoverExpand, setEnableHoverExpand] = useState(true);
  const [displayLyrics, setDisplayLyrics] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [focusedSuggestionIndex, setFocusedSuggestionIndex] = useState(-1);
  const [toast, setToast] = useState(null);
  const [matchedArtistInfo, setMatchedArtistInfo] = useState(null);
  const [aiFilteredTracks, setAiFilteredTracks] = useState(null);

  // Search Indexes
  const flexSearchRef = useRef(null);
  const fuseSearchRef = useRef(null);

  // UI state
  const [localShowModal, setLocalShowModal] = useState(false);
  const showModal = propShowModal !== undefined ? propShowModal : localShowModal;
  const setShowModal = propSetShowModal !== undefined ? propSetShowModal : setLocalShowModal;
  const [islandState, setIslandState] = useState('collapsed'); // 'collapsed', 'hovered', 'expanded'
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const [contextMenuTrackId, setContextMenuTrackId] = useState(null);
  const [contextMenuPlaylistKey, setContextMenuPlaylistKey] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // --- Refs for continuous playback and objects ---
  const soundRef = useRef(null);
  const playlistRef = useRef([]);
  const currentIndexRef = useRef(-1);
  const progressIntervalRef = useRef(null);

  // Sync state reference to playlistRef
  useEffect(() => {
    playlistRef.current = getPlaylistTracks(currentPlaylistId);
  }, [currentPlaylistId, library, favorites, playlists]);

  // Build search indexes when library updates
  useEffect(() => {
    if (library.length === 0) {
      flexSearchRef.current = null;
      fuseSearchRef.current = null;
      return;
    }

    try {
      // 1. Build FlexSearch Index
      const flexIndex = new Index({
        tokenize: 'forward',
        resolution: 9
      });
      library.forEach((track, idx) => {
        const textToSearch = `${track.title || ''} ${track.artist || ''} ${track.album || ''} ${track.genre || ''}`.toLowerCase();
        flexIndex.add(idx, textToSearch);
      });
      flexSearchRef.current = flexIndex;

      // 2. Build Fuse.js Index for typo tolerance
      const fuseIndex = new Fuse(library, {
        keys: ['artist', 'title', 'album'],
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2
      });
      fuseSearchRef.current = fuseIndex;
    } catch (e) {
      console.error("Failed to build search indexes:", e);
    }
  }, [library]);

  // Alternating page title between song name and "iWeb <Time>" every 5 seconds when playing, otherwise showing time
  useEffect(() => {
    const getFormattedTime = () => {
      const now = new Date();
      let hours = now.getHours();
      let minutes = now.getMinutes();
      hours = hours % 12 || 12;
      minutes = minutes < 10 ? `0${minutes}` : minutes;
      return `${hours}:${minutes}`;
    };

    let showSongTitle = true;
    let lastTimeStr = getFormattedTime();

    const updateTitle = () => {
      const timeStr = getFormattedTime();
      const timeTitle = `iWeb ${timeStr}`;

      if (isPlaying && currentTrack) {
        const songTitle = `🎶 ${currentTrack.title}`;
        document.title = showSongTitle ? songTitle : timeTitle;
      } else {
        document.title = timeTitle;
      }
      lastTimeStr = timeStr;
    };

    // Initial update
    updateTitle();

    let secondsCounter = 0;
    const interval = setInterval(() => {
      const currentTimeStr = getFormattedTime();
      let needsUpdate = false;

      // 1. Time change check (every minute)
      if (currentTimeStr !== lastTimeStr) {
        needsUpdate = true;
      }

      // 2. Playback alternation check (every 5 seconds)
      if (isPlaying && currentTrack) {
        secondsCounter += 1;
        if (secondsCounter >= 5) {
          showSongTitle = !showSongTitle;
          secondsCounter = 0;
          needsUpdate = true;
        }
      } else {
        secondsCounter = 0;
        showSongTitle = true; // reset to show song title first when playback starts
      }

      if (needsUpdate) {
        updateTitle();
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      document.title = "iWeb"; // Restore default
    };
  }, [isPlaying, currentTrack]);

  // Load playlists & tracks from DB on startup
  useEffect(() => {
    initDatabase();
    checkAudioOutputDevice();
    
    // Set Howler global volume
    Howler.volume(volume / 100);

    return () => {
      stopProgressTimer();
      if (soundRef.current) {
        soundRef.current.unload();
      }
    };
  }, []);

  // Click outside dynamic island to collapse it
  useEffect(() => {
    let added = false;
    const handleClickOutside = (e) => {
      const island = document.getElementById('dynamic-island');
      if (island && !island.contains(e.target)) {
        setIslandState('collapsed');
      }
    };
    let timer;
    if (islandState !== 'collapsed') {
      timer = setTimeout(() => {
        document.addEventListener('click', handleClickOutside);
        added = true;
      }, 0);
    }
    return () => {
      if (timer) clearTimeout(timer);
      if (added) document.removeEventListener('click', handleClickOutside);
      else document.removeEventListener('click', handleClickOutside);
    };
  }, [islandState]);

  // Listen to custom events from search bar setting triggers
  useEffect(() => {
    const handleOpenMusic = () => {
      setShowModal(true);
      setActiveView('home');
    };
    
    const handleOpenSettings = () => {
      setShowModal(true);
      setActiveView('settings');
    };

    const handleSelectFolderEvent = () => {
      handleSelectFolder();
    };

    const handleRescanEvent = () => {
      handleRescan();
    };

    window.addEventListener('music:open', handleOpenMusic);
    window.addEventListener('music:openSettings', handleOpenSettings);
    window.addEventListener('music:selectFolder', handleSelectFolderEvent);
    window.addEventListener('music:rescan', handleRescanEvent);

    return () => {
      window.removeEventListener('music:open', handleOpenMusic);
      window.removeEventListener('music:openSettings', handleOpenSettings);
      window.removeEventListener('music:selectFolder', handleSelectFolderEvent);
      window.removeEventListener('music:rescan', handleRescanEvent);
    };
  }, [library, dirHandle]);

  const initDatabase = async () => {
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);

      const tracksReq = store.get(TRACKS_KEY);
      const favsReq = store.get(FAVORITES_KEY);
      const playlistsReq = store.get(PLAYLISTS_KEY);
      const handleReq = store.get(HANDLE_KEY);
      const playbackReq = store.get(LAST_PLAYED_KEY);
      const settingsReq = store.get('music-settings');

      // Create promises for parallel awaiting of onsuccess event triggers
      const tracksPromise = new Promise(r => tracksReq.onsuccess = () => r(tracksReq.result || []));
      const favsPromise = new Promise(r => favsReq.onsuccess = () => r(favsReq.result || []));
      const plPromise = new Promise(r => playlistsReq.onsuccess = () => r(playlistsReq.result || {}));
      const handlePromise = new Promise(r => handleReq.onsuccess = () => r(handleReq.result || null));
      const playbackPromise = new Promise(r => playbackReq.onsuccess = () => r(playbackReq.result || null));
      const settingsPromise = new Promise(r => settingsReq.onsuccess = () => r(settingsReq.result || null));

      const [tracks, favs, pl, handle, playback, settings] = await Promise.all([
        tracksPromise, favsPromise, plPromise, handlePromise, playbackPromise, settingsPromise
      ]);

      setFavorites(favs);
      setPlaylists(pl);
      setDirHandle(handle);

      let autoReconnectEnabled = true;

      if (settings) {
        if (settings.volume !== undefined) {
          setVolume(settings.volume);
          Howler.volume(settings.volume / 100);
        }
        if (settings.outputDevice !== undefined) setOutputDevice(settings.outputDevice);
        if (settings.rememberPlayback !== undefined) setRememberPlayback(settings.rememberPlayback);
        if (settings.isShuffle !== undefined) setIsShuffle(settings.isShuffle);
        if (settings.isRepeat !== undefined) setIsRepeat(settings.isRepeat);
        if (settings.silentAutoReconnect !== undefined) {
          setSilentAutoReconnect(settings.silentAutoReconnect);
          autoReconnectEnabled = settings.silentAutoReconnect;
        }
        if (settings.enableHoverExpand !== undefined) setEnableHoverExpand(settings.enableHoverExpand);
        if (settings.displayLyrics !== undefined) setDisplayLyrics(settings.displayLyrics);
      }

      const convertedTracks = tracks.map(t => {
        let artwork = defaultArtwork;
        if (t.artworkBlob) {
          artwork = URL.createObjectURL(t.artworkBlob);
        }
        return {
          ...t,
          artwork,
          file: null
        };
      });

      setLibrary(convertedTracks);

      if (convertedTracks.length > 0) {
        setStatusText('Library loaded. Click play or Rescan to connect files.');
      }

      // Try silent auto-reconnect if handle exists and permissions are granted
      if (handle && autoReconnectEnabled) {
        try {
          const modeOpt = { mode: 'read' };
          const hasPermission = await handle.queryPermission(modeOpt) === 'granted';
          if (hasPermission) {
            reconnectFiles(handle, convertedTracks);
          }
        } catch (e) {
          console.error("Silent auto-reconnect failed:", e);
        }
      }

      // Restore last playback state
      if (playback && convertedTracks.length > 0) {
        const lastIdx = convertedTracks.findIndex(t => t.id === playback.trackId);
        if (lastIdx >= 0) {
          currentIndexRef.current = lastIdx;
          const track = convertedTracks[lastIdx];
          setCurrentTrack(track);
          setElapsed(playback.seekTime);
          setDuration(track.duration);
        }
      }
    } catch (e) {
      console.error("Startup DB load failed:", e);
    }
  };

  const reconnectFiles = async (handle, currentLibrary) => {
    try {
      const filesList = await scanDirectoryRecursive(handle);
      const fileMap = new Map(filesList.map(f => [f.path, f.file]));
      
      const updated = currentLibrary.map(track => {
        if (fileMap.has(track.path)) {
          track.file = fileMap.get(track.path);
        }
        return track;
      });

      setLibrary(updated);
      setStatusText(`Library connected (${updated.length} tracks).`);
      return true;
    } catch (err) {
      console.error("File reconnection failed:", err);
      return false;
    }
  };

  const ensureFilesConnected = async () => {
    if (library.length === 0) return false;
    const connected = library.some(t => t.file !== null);
    if (connected) return true;

    if (!dirHandle) {
      alert("Please open the Music Library and select a folder first.");
      return false;
    }

    try {
      const permission = await dirHandle.requestPermission({ mode: 'read' });
      if (permission === 'granted') {
        setStatusText("Connecting files...");
        const ok = await reconnectFiles(dirHandle, library);
        return ok;
      }
    } catch (err) {
      console.error("Permission request error:", err);
    }
    alert("Folder access permission denied. Please grant permission to play local tracks.");
    return false;
  };

  const scanDirectoryRecursive = async (handle, path = '') => {
    let list = [];
    for await (const entry of handle.values()) {
      if (entry.kind === 'file') {
        if (isSupportedAudio(entry.name)) {
          try {
            const file = await entry.getFile();
            list.push({
              file,
              path: path ? `${path}/${entry.name}` : entry.name
            });
          } catch (e) {
            console.error("Failed to read file:", entry.name, e);
          }
        }
      } else if (entry.kind === 'directory') {
        const sub = await scanDirectoryRecursive(entry, path ? `${path}/${entry.name}` : entry.name);
        list.push(...sub);
      }
    }
    return list;
  };

  const extractMetadata = async (fileObj) => {
    const file = fileObj.file;
    let title = file.name;
    let artist = 'Unknown Artist';
    let album = 'Unknown Album';
    let duration = 0;
    let artwork = defaultArtwork;
    let artworkBlob = null;

    try {
      const metadata = await musicMetadata.parseBlob(file);
      if (metadata.common) {
        if (metadata.common.title) title = metadata.common.title;
        if (metadata.common.artist) artist = metadata.common.artist;
        if (metadata.common.album) album = metadata.common.album;
        
        if (metadata.common.picture && metadata.common.picture.length > 0) {
          const pic = metadata.common.picture[0];
          artworkBlob = new Blob([pic.data], { type: pic.format });
          artwork = URL.createObjectURL(artworkBlob);
        }
      }
      if (metadata.format && metadata.format.duration) {
        duration = metadata.format.duration;
      }
    } catch (err) {
      console.error('Metadata parsing error:', file.name, err);
    }

    // Smart filename parsing fallback when artist is 'Unknown Artist'
    if (artist === 'Unknown Artist') {
      const cleanName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
      const dashIdx = cleanName.indexOf(' - ');
      if (dashIdx > 0) {
        artist = cleanName.substring(0, dashIdx).trim();
        const extractedTitle = cleanName.substring(dashIdx + 3).trim();
        // If we didn't get a title from ID3 metadata (i.e. it defaulted to file.name), use the cleaner extracted title
        if (title === file.name) {
          title = extractedTitle;
        }
      }
    }

    return {
      id: `${file.name}-${file.size}`,
      file,
      path: fileObj.path,
      title,
      artist,
      album,
      duration,
      artwork,
      artworkBlob
    };
  };

  const handleSelectFolder = async () => {
    try {
      setStatusText("Selecting folder...");
      let filesList = [];
      let handle = null;

      if ('showDirectoryPicker' in window) {
        handle = await window.showDirectoryPicker();
        const db = await getDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
        setDirHandle(handle);
        filesList = await scanDirectoryRecursive(handle);
      } else {
        // browser-fs-access fallback
        const files = await directoryOpen({ recursive: true });
        filesList = files.filter(f => isSupportedAudio(f.name)).map(f => ({
          file: f,
          path: f.webkitRelativePath || f.name
        }));
      }

      setStatusText(`Scanning ${filesList.length} files...`);

      const newLibrary = [];
      for (const fileObj of filesList) {
        const track = await extractMetadata(fileObj);
        newLibrary.push(track);
      }

      setLibrary(newLibrary);
      playlistRef.current = newLibrary;
      setCurrentPlaylistId('all');

      // Group by folders and generate playlists automatically
      const updatedPlaylists = { ...playlists };
      const folderGroups = {};
      newLibrary.forEach(track => {
        const parts = track.path.split('/');
        if (parts.length > 1) {
          const folderName = parts.slice(0, -1).join('/');
          if (!folderGroups[folderName]) {
            folderGroups[folderName] = [];
          }
          folderGroups[folderName].push(track.id);
        }
      });
      Object.keys(folderGroups).forEach(folderName => {
        updatedPlaylists[folderName] = folderGroups[folderName];
      });
      setPlaylists(updatedPlaylists);

      // Save to IndexedDB
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const serialized = newLibrary.map(t => ({
        id: t.id,
        path: t.path,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        artworkBlob: t.artworkBlob
      }));
      store.put(serialized, TRACKS_KEY);
      store.put(updatedPlaylists, PLAYLISTS_KEY);

      setStatusText(`Loaded ${newLibrary.length} tracks.`);
    } catch (e) {
      console.error("Folder scan error:", e);
      setStatusText("Folder selection failed.");
    }
  };

  const handleRescan = async () => {
    if (!dirHandle) {
      alert("No directory loaded. Please select a folder first.");
      return;
    }
    try {
      setStatusText("Verifying permission...");
      const permission = await dirHandle.requestPermission({ mode: 'read' });
      if (permission !== 'granted') {
        alert("Permission denied to folder.");
        return;
      }

      setStatusText("Scanning directory...");
      const filesList = await scanDirectoryRecursive(dirHandle);
      setStatusText(`Comparing ${filesList.length} files...`);

      const existingMap = new Map(library.map(t => [t.path, t]));
      const updatedLibrary = [];

      for (const fileObj of filesList) {
        const existing = existingMap.get(fileObj.path);
        if (existing) {
          existing.file = fileObj.file;
          updatedLibrary.push(existing);
          existingMap.delete(fileObj.path);
        } else {
          const track = await extractMetadata(fileObj);
          updatedLibrary.push(track);
        }
      }

      setLibrary(updatedLibrary);

      // Group by folders and generate playlists automatically
      const updatedPlaylists = { ...playlists };
      const folderGroups = {};
      updatedLibrary.forEach(track => {
        const parts = track.path.split('/');
        if (parts.length > 1) {
          const folderName = parts.slice(0, -1).join('/');
          if (!folderGroups[folderName]) {
            folderGroups[folderName] = [];
          }
          folderGroups[folderName].push(track.id);
        }
      });
      Object.keys(folderGroups).forEach(folderName => {
        updatedPlaylists[folderName] = folderGroups[folderName];
      });
      setPlaylists(updatedPlaylists);
      
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const serialized = updatedLibrary.map(t => ({
        id: t.id,
        path: t.path,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        artworkBlob: t.artworkBlob
      }));
      store.put(serialized, TRACKS_KEY);
      store.put(updatedPlaylists, PLAYLISTS_KEY);

      setStatusText(`Library updated. Total tracks: ${updatedLibrary.length}.`);
    } catch (err) {
      console.error("Rescan failed:", err);
      setStatusText("Rescan failed.");
    }
  };

  // --- Playback Controls ---
  const playTrack = async (index, playlistTracks = playlistRef.current) => {
    if (playlistTracks.length === 0) return;
    let idx = index;
    if (idx < 0) idx = 0;
    if (idx >= playlistTracks.length) idx = playlistTracks.length - 1;

    const connected = await ensureFilesConnected();
    if (!connected) return;

    if (soundRef.current) {
      soundRef.current.unload();
    }

    currentIndexRef.current = idx;
    const track = playlistTracks[idx];
    setCurrentTrack(track);

    if (!track.file) {
      console.warn("Track file not found.");
      return;
    }

    const objectURL = URL.createObjectURL(track.file);
    const ext = track.file.name.split('.').pop().toLowerCase();

    const newSound = new Howl({
      src: [objectURL],
      format: [ext],
      html5: false,
      volume: 0, // Fade-in
      onload: () => {
        setDuration(newSound.duration());
      },
      onplay: () => {
        setIsPlaying(true);
        startProgressTimer();
        newSound.fade(newSound.volume(), isMuted ? 0 : volume / 100, 600);
      },
      onpause: () => {
        setIsPlaying(false);
        stopProgressTimer();
      },
      onstop: () => {
        setIsPlaying(false);
        stopProgressTimer();
      },
      onend: () => {
        handleTrackEnd();
      }
    });

    soundRef.current = newSound;
    newSound.play();
  };

  const handlePlayPause = () => {
    const sound = soundRef.current;
    if (sound) {
      if (sound.playing()) {
        const currentVol = sound.volume();
        sound.fade(currentVol, 0, 300);
        sound.once('fade', () => {
          if (sound.volume() === 0) {
            sound.pause();
          }
        });
        
        // Save state on pause
        savePlaybackState(currentTrack.id, sound.seek() || 0);
      } else {
        sound.off('fade');
        sound.play();
      }
    } else if (playlistRef.current.length > 0) {
      const idx = currentIndexRef.current >= 0 ? currentIndexRef.current : 0;
      playTrack(idx);
    }
  };

  const handleNext = () => {
    const list = playlistRef.current;
    if (list.length === 0) return;

    if (isShuffle) {
      const rand = Math.floor(Math.random() * list.length);
      playTrack(rand);
    } else {
      let nextIdx = currentIndexRef.current + 1;
      if (nextIdx >= list.length) {
        nextIdx = isRepeat === 'all' ? 0 : list.length - 1;
      }
      playTrack(nextIdx);
    }
  };

  const handlePrev = () => {
    const list = playlistRef.current;
    if (list.length === 0) return;

    let prevIdx = currentIndexRef.current - 1;
    if (prevIdx < 0) {
      prevIdx = isRepeat === 'all' ? list.length - 1 : 0;
    }
    playTrack(prevIdx);
  };

  const handleTrackEnd = () => {
    if (isRepeat === 'one') {
      playTrack(currentIndexRef.current);
    } else {
      handleNext();
    }
  };

  const handleSeek = (pct) => {
    const sound = soundRef.current;
    if (sound && sound.state() === 'loaded') {
      const target = sound.duration() * pct;
      sound.seek(target);
      setElapsed(target);
      savePlaybackState(currentTrack.id, target);
    }
  };

  const savePlaybackState = async (trackId, seekTime) => {
    if (!rememberPlayback) return;
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ trackId, seekTime }, LAST_PLAYED_KEY);
    } catch (e) {
      console.error("Failed to save playback state:", e);
    }
  };

  const startProgressTimer = () => {
    stopProgressTimer();
    let lastSave = Date.now();
    progressIntervalRef.current = setInterval(() => {
      const sound = soundRef.current;
      if (sound && sound.playing() && !isDragging) {
        const seek = sound.seek() || 0;
        setElapsed(seek);
        
        // Save state every 10 seconds during playback
        const now = Date.now();
        if (now - lastSave >= 10000) {
          savePlaybackState(currentTrack.id, seek);
          lastSave = now;
        }
      }
    }, 250);
  };

  const stopProgressTimer = () => {
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
  };

  const handleUpdateSetting = async (key, val) => {
    if (key === 'volume') {
      setVolume(val);
      if (soundRef.current) {
        soundRef.current.volume(isMuted ? 0 : val / 100);
      }
      Howler.volume(isMuted ? 0 : val / 100);
    } else if (key === 'outputDevice') {
      setOutputDevice(val);
    } else if (key === 'rememberPlayback') {
      setRememberPlayback(val);
      if (!val) {
        try {
          const db = await getDB();
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(LAST_PLAYED_KEY);
        } catch (e) {}
      }
    } else if (key === 'isShuffle') {
      setIsShuffle(val);
    } else if (key === 'isRepeat') {
      setIsRepeat(val);
    } else if (key === 'silentAutoReconnect') {
      setSilentAutoReconnect(val);
    } else if (key === 'enableHoverExpand') {
      setEnableHoverExpand(val);
    } else if (key === 'displayLyrics') {
      setDisplayLyrics(val);
    }

    try {
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get('music-settings');
      getReq.onsuccess = () => {
        const currentSettings = getReq.result || {};
        currentSettings[key] = val;
        store.put(currentSettings, 'music-settings');
      };
    } catch (e) {
      console.error("Failed to save setting:", e);
    }
  };

  const handleClearLibrary = async () => {
    if (window.confirm("Are you sure you want to clear your music library and all playlists?")) {
      if (soundRef.current) {
        soundRef.current.stop();
        soundRef.current.unload();
        soundRef.current = null;
      }
      setLibrary([]);
      setFavorites([]);
      setPlaylists({});
      setDirHandle(null);
      setCurrentTrack(null);
      setElapsed(0);
      setDuration(0);
      setIsPlaying(false);
      setStatusText("Library cleared.");
      
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(TRACKS_KEY);
      store.delete(FAVORITES_KEY);
      store.delete(PLAYLISTS_KEY);
      store.delete(HANDLE_KEY);
      store.delete(LAST_PLAYED_KEY);
    }
  };

  const handleVolumeChange = (e) => {
    const val = parseInt(e.target.value, 10);
    handleUpdateSetting('volume', val);
  };

  const handleToggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    const targetVol = nextMute ? 0 : volume / 100;
    if (soundRef.current) {
      soundRef.current.volume(targetVol);
    }
    Howler.volume(targetVol);
  };

  const checkAudioOutputDevice = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputs = devices.filter(d => d.kind === 'audiooutput');
      
      let type = 'speakers';
      for (const d of outputs) {
        const label = d.label.toLowerCase();
        if (label.includes('headphone') || label.includes('headset') || label.includes('wired')) {
          type = 'headphones';
        }
        if (label.includes('buds') || label.includes('airpods') || label.includes('bluetooth') || label.includes('wireless')) {
          type = 'buds';
        }
      }
      handleUpdateSetting('outputDevice', type);
    } catch (e) {
      handleUpdateSetting('outputDevice', 'speakers');
    }
  };

  const getPlaylistTracks = (playlistId) => {
    if (playlistId === 'all') return library;
    if (playlistId === 'favorites') {
      return library.filter(t => favorites.includes(t.id));
    }
    const ids = playlists[playlistId] || [];
    return library.filter(t => ids.includes(t.id));
  };

  // --- View Actions ---
  const applyView = (view, playlistId) => {
    setActiveView(view);
    setCurrentPlaylistId(playlistId);
  };

  const handleNavigateTo = (view, playlistId) => {
    // Truncate history forward
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ view, playlistId });
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    applyView(view, playlistId);
  };

  const handleGoBack = () => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      const state = history[nextIdx];
      applyView(state.view, state.playlistId);
    }
  };

  const handleGoForward = () => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      setHistoryIndex(nextIdx);
      const state = history[nextIdx];
      applyView(state.view, state.playlistId);
    }
  };

  const handleCreatePlaylist = async () => {
    const name = prompt("Enter a name for your new playlist:");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    if (playlists[trimmed]) {
      alert("A playlist with that name already exists.");
      return;
    }

    const updated = { ...playlists, [trimmed]: [] };
    setPlaylists(updated);
    
    // Save to DB
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(updated, PLAYLISTS_KEY);

    handleNavigateTo('playlist', trimmed);
  };

  const handleDeletePlaylist = async (e, name) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete the playlist "${name}"?`)) {
      const updated = { ...playlists };
      delete updated[name];
      setPlaylists(updated);

      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(updated, PLAYLISTS_KEY);

      if (currentPlaylistId === name) {
        handleNavigateTo('home');
      }
    }
  };

  const toggleFavoriteTrack = async (e, trackId) => {
    e.stopPropagation();
    let updated;
    const idx = favorites.indexOf(trackId);
    if (idx >= 0) {
      updated = favorites.filter(id => id !== trackId);
    } else {
      updated = [...favorites, trackId];
    }

    setFavorites(updated);
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(updated, FAVORITES_KEY);
  };

  const showPlaylistContextMenu = (e, trackId, playlistKey) => {
    e.stopPropagation();
    setContextMenuTrackId(trackId);
    setContextMenuPlaylistKey(playlistKey);
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  // Close context menu on outside click
  useEffect(() => {
    const hide = () => setShowContextMenu(false);
    if (showContextMenu) {
      window.addEventListener('click', hide);
    }
    return () => window.removeEventListener('click', hide);
  }, [showContextMenu]);

  const handleAddTrackToPlaylist = async (playlistName) => {
    if (!contextMenuTrackId) return;
    const pTracks = playlists[playlistName] || [];
    if (pTracks.includes(contextMenuTrackId)) {
      alert(`Song is already in playlist "${playlistName}"`);
      return;
    }

    const updatedPlaylists = {
      ...playlists,
      [playlistName]: [...pTracks, contextMenuTrackId]
    };

    setPlaylists(updatedPlaylists);
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(updatedPlaylists, PLAYLISTS_KEY);
    alert(`Added to playlist "${playlistName}"`);
  };

  const handleRemoveTrackFromPlaylist = async () => {
    if (!contextMenuTrackId || !contextMenuPlaylistKey) return;
    
    if (contextMenuPlaylistKey === 'favorites') {
      const updated = favorites.filter(id => id !== contextMenuTrackId);
      setFavorites(updated);
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(updated, FAVORITES_KEY);
    } else {
      const pTracks = playlists[contextMenuPlaylistKey] || [];
      const updatedList = pTracks.filter(id => id !== contextMenuTrackId);
      const updatedPlaylists = {
        ...playlists,
        [contextMenuPlaylistKey]: updatedList
      };
      setPlaylists(updatedPlaylists);

      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(updatedPlaylists, PLAYLISTS_KEY);
    }
  };

  // Format MM:SS
  const formatSecs = (secs) => {
    if (isNaN(secs) || secs === null) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handlePlayAll = (shuffle = false) => {
    const list = getPlaylistTracks(currentPlaylistId);
    if (list.length === 0) return;

    playlistRef.current = list;
    setIsShuffle(shuffle);

    if (shuffle) {
      const rand = Math.floor(Math.random() * list.length);
      playTrack(rand, list);
    } else {
      playTrack(0, list);
    }
  };

  const showToastAlert = (message, submessage) => {
    setToast({ message, submessage });
  };

  // Toast auto-dismissal
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Generate suggestions matching query
  const generateSuggestions = (query) => {
    if (!query || query.trim().length < 2) {
      setSearchSuggestions([]);
      setFocusedSuggestionIndex(-1);
      return;
    }

    const normQuery = query.toLowerCase().trim();
    const uniqueArtists = new Set();
    const uniqueAlbums = new Set();
    const uniqueTitles = new Set();

    const testMatchAndAdd = (track) => {
      const artist = track.artist || '';
      const album = track.album || '';
      const title = track.title || '';

      if (artist.toLowerCase().includes(normQuery)) uniqueArtists.add(artist);
      if (album.toLowerCase().includes(normQuery)) uniqueAlbums.add(album);
      if (title.toLowerCase().includes(normQuery)) uniqueTitles.add(title);
    };

    // 1. FlexSearch matches
    if (flexSearchRef.current) {
      const hits = flexSearchRef.current.search(normQuery, 50);
      hits.forEach(hit => {
        const idx = typeof hit === 'string' ? parseInt(hit, 10) : hit;
        if (!isNaN(idx) && idx >= 0 && idx < library.length) {
          testMatchAndAdd(library[idx]);
        }
      });
    }

    // 2. Fuse.js matches (typo tolerance)
    if (fuseSearchRef.current) {
      const results = fuseSearchRef.current.search(normQuery);
      results.forEach(res => {
        if (res.item) {
          testMatchAndAdd(res.item);
        }
      });
    }

    const list = [];
    
    // Prioritize Artists
    Array.from(uniqueArtists).slice(0, 3).forEach(art => {
      list.push({ type: 'Artist', text: art });
    });
    
    // Suggest Albums
    Array.from(uniqueAlbums).slice(0, 3).forEach(alb => {
      list.push({ type: 'Album', text: alb });
    });
    
    // Suggest Song Titles
    Array.from(uniqueTitles).slice(0, 5).forEach(tit => {
      list.push({ type: 'Song', text: tit });
    });

    setSearchSuggestions(list.slice(0, 8));
    setFocusedSuggestionIndex(-1);
  };

  const handleSearchChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    generateSuggestions(val);
    
    if (!val.trim()) {
      setAiFilteredTracks(null);
      setMatchedArtistInfo(null);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedSuggestionIndex(prev => 
        searchSuggestions.length > 0 ? (prev + 1) % searchSuggestions.length : -1
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedSuggestionIndex(prev => 
        searchSuggestions.length > 0 
          ? (prev <= 0 ? searchSuggestions.length - 1 : prev - 1) 
          : -1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (focusedSuggestionIndex >= 0 && focusedSuggestionIndex < searchSuggestions.length) {
        const selected = searchSuggestions[focusedSuggestionIndex];
        setSearchQuery(selected.text);
        handleSearchSubmit(selected.text);
      } else {
        handleSearchSubmit(searchQuery);
      }
    } else if (e.key === 'Escape') {
      setSearchSuggestions([]);
      setFocusedSuggestionIndex(-1);
    }
  };

  const handleSearchSubmit = async (queryText) => {
    if (!queryText || !queryText.trim()) return;
    setSearchSuggestions([]);

    const parseResult = parseSearchIntent(queryText);
    if (!parseResult) return;

    const { intent, artist, playlistName } = parseResult;

    // Helper to get tracks matching an artist search term
    const getTracksForArtistSearch = (artistQuery) => {
      if (!artistQuery) return { name: '', tracks: [] };

      // 1. Try exact/case-insensitive match on non-unknown artists
      let matchedName = artistQuery;
      let tracks = library.filter(t => 
        t.artist && 
        t.artist.toLowerCase() === artistQuery.toLowerCase() && 
        t.artist.toLowerCase() !== 'unknown artist'
      );

      // 2. If no tracks found, check fuzzy matches in the search index
      if (tracks.length === 0 && fuseSearchRef.current) {
        const fuzzyResults = fuseSearchRef.current.search(artistQuery);
        if (fuzzyResults.length > 0) {
          // If the best match has a real artist, filter by that artist
          const bestMatch = fuzzyResults[0].item;
          if (bestMatch.artist && bestMatch.artist.toLowerCase() !== 'unknown artist') {
            matchedName = bestMatch.artist;
            tracks = library.filter(t => (t.artist || '').toLowerCase() === matchedName.toLowerCase());
          } else {
            // If the matched track is "Unknown Artist", we ONLY include the tracks from the search index
            // that actually contain the query word in their title or path/filename.
            matchedName = artistQuery;
            const matchedIds = new Set();
            fuzzyResults.forEach(res => {
              const item = res.item;
              const text = `${item.title || ''} ${item.artist || ''} ${item.path || ''}`.toLowerCase();
              if (text.includes(artistQuery.toLowerCase()) && !matchedIds.has(item.id)) {
                matchedIds.add(item.id);
                tracks.push(item);
              }
            });
          }
        }
      }

      // If we still have absolutely nothing, but it's a specific query, do a simple substring fallback
      if (tracks.length === 0) {
        const queryLower = artistQuery.toLowerCase();
        tracks = library.filter(t => 
          (t.title || '').toLowerCase().includes(queryLower) ||
          (t.artist || '').toLowerCase().includes(queryLower) ||
          (t.path || '').toLowerCase().includes(queryLower)
        );
      }

      return { name: matchedName, tracks };
    };

    if (intent === 'create_playlist' && artist) {
      const { name: matchedArtist, tracks: artistTracks } = getTracksForArtistSearch(artist);

      if (artistTracks.length === 0) {
        showToastAlert(`No songs found for "${artist}"`, "Could not create playlist.");
        return;
      }

      let baseName = matchedArtist;
      // Capitalize the first letter for nicer presentation if it matched the query directly
      if (baseName.toLowerCase() === artist.toLowerCase()) {
        baseName = artist.charAt(0).toUpperCase() + artist.slice(1);
      }
      let finalName = baseName;
      let count = 1;
      while (playlists[finalName]) {
        count++;
        finalName = `${baseName} (${count})`;
      }

      const songIds = artistTracks.map(t => t.id);
      const updatedPlaylists = {
        ...playlists,
        [finalName]: songIds
      };

      setPlaylists(updatedPlaylists);
      const db = await getDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(updatedPlaylists, PLAYLISTS_KEY);

      showToastAlert(`Playlist created successfully`, `${songIds.length} Songs Added`);
      handleNavigateTo('playlist', finalName);
    }

    else if (intent === 'find_songs' && artist) {
      const { name: matchedArtist, tracks: artistTracks } = getTracksForArtistSearch(artist);

      if (artistTracks.length > 0) {
        setAiFilteredTracks(artistTracks);
        const uniqueAlbums = Array.from(new Set(artistTracks.map(t => t.album).filter(Boolean)));
        setMatchedArtistInfo({
          name: matchedArtist.toLowerCase() === artist.toLowerCase() ? (artist.charAt(0).toUpperCase() + artist.slice(1)) : matchedArtist,
          count: artistTracks.length,
          albums: uniqueAlbums.slice(0, 3)
        });
      } else {
        setAiFilteredTracks([]);
        setMatchedArtistInfo(null);
      }
    }

    else if (intent === 'play_artist' && artist) {
      const { name: matchedArtist, tracks: artistTracks } = getTracksForArtistSearch(artist);

      if (artistTracks.length > 0) {
        setAiFilteredTracks(artistTracks);
        const displayName = matchedArtist.toLowerCase() === artist.toLowerCase() ? (artist.charAt(0).toUpperCase() + artist.slice(1)) : matchedArtist;
        showToastAlert(`Playing songs by ${displayName}`, `${artistTracks.length} tracks started.`);
        playlistRef.current = artistTracks;
        playTrack(0, artistTracks);
      } else {
        showToastAlert(`No tracks by "${artist}"`, "Could not play artist.");
      }
    }

    else if (intent === 'show_favorites') {
      handleNavigateTo('playlist', 'favorites');
    }

    else if (intent === 'show_playlist' && playlistName) {
      const matchKey = Object.keys(playlists).find(k => k.toLowerCase() === playlistName.toLowerCase());
      if (matchKey) {
        handleNavigateTo('playlist', matchKey);
      } else if (playlistName.toLowerCase() === 'favorites') {
        handleNavigateTo('playlist', 'favorites');
      } else {
        showToastAlert(`Playlist not found`, `No playlist matching "${playlistName}".`);
      }
    }
  };

  // Filtered search tracks using FlexSearch + Fuse.js
  const getFilteredSearchTracks = () => {
    if (aiFilteredTracks !== null) {
      return aiFilteredTracks;
    }

    const query = searchQuery.toLowerCase().trim();
    if (!query) return [];

    const matchedIds = new Set();
    const results = [];

    // 1. FlexSearch matches
    if (flexSearchRef.current) {
      const hits = flexSearchRef.current.search(query, 50);
      hits.forEach(hit => {
        const idx = typeof hit === 'string' ? parseInt(hit, 10) : hit;
        if (!isNaN(idx) && idx >= 0 && idx < library.length) {
          const track = library[idx];
          if (!matchedIds.has(track.id)) {
            matchedIds.add(track.id);
            results.push(track);
          }
        }
      });
    }

    // 2. Fuse.js matches (typo tolerance)
    if (fuseSearchRef.current) {
      const fuzzyResults = fuseSearchRef.current.search(query);
      fuzzyResults.forEach(res => {
        if (res.item && !matchedIds.has(res.item.id)) {
          matchedIds.add(res.item.id);
          results.push(res.item);
        }
      });
    }

    return results;
  };

  // Dynamic Island toggles
  const handleIslandClick = (e) => {
    // If user clicked inside control rows, ignore card toggle
    if (e.target.closest('.expanded-control-btn') || e.target.closest('.expanded-slider')) {
      return;
    }
    
    const isArtwork = e.target.classList.contains('island-art') || e.target.classList.contains('island-art-large');
    const isText = e.target.id === 'island-hovered-title' || e.target.id === 'island-expanded-title' || e.target.classList.contains('island-title') || e.target.classList.contains('expanded-title');
    
    if (islandState === 'expanded') {
      if (isArtwork || isText) {
        setShowModal(true);
      }
      // Do not collapse when clicking inside the expanded state (user can click outside to collapse)
    } else if (islandState === 'collapsed') {
      if (isArtwork) {
        handlePlayPause();
      } else {
        setIslandState('expanded');
      }
    } else { // hovered
      if (isArtwork || isText) {
        setShowModal(true);
      } else {
        setIslandState('expanded');
      }
    }
  };

  // --- Output Device Render Helper ---
  const renderDeviceIcon = () => {
    if (outputDevice === 'buds') {
      return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15.5c-1.38 0-2.5-1.12-2.5-2.5V13c0-1.1.9-2 2-2h1V7.5c0-1.38-1.12-2.5-2.5-2.5S6.5 6.12 6.5 7.5c0 .28-.22.5-.5.5s-.5-.22-.5-.5C5.5 5.01 7.51 3 10 3s4.5 2.01 4.5 4.5V11h1c1.1 0 2 .9 2 2v2c0 1.38-1.12 2.5-2.5 2.5h-1c-.28 0-.5-.22-.5-.5V13c0-.28-.22-.5-.5-.5h-2c-.28 0-.5.22-.5.5v4c0 .28-.22.5-.5.5h-1z"/></svg>;
    }
    if (outputDevice === 'headphones') {
      return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>;
    }
    return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"/><circle cx="12" cy="14" r="4"/><line x1="12" y1="6" x2="12.01" y2="6"/></svg>;
  };

  const activeTrack = currentTrack || (library.length > 0 ? library[0] : null);

  return (
    <>
      {/* ── Apple-Style Dynamic Island Music Player ── */}
      {library.length > 0 && (
        <div 
          className={`dynamic-island-container active`} 
          id="dynamic-island"
          onMouseEnter={() => { if (enableHoverExpand && islandState === 'collapsed') setIslandState('hovered'); }}
          onMouseLeave={() => { setIslandState('collapsed'); }}
        >
          <div 
            className={`dynamic-island-pill ${islandState}`} 
            id="island-pill"
            onClick={handleIslandClick}
          >
            {/* 1. Collapsed State Content */}
            {islandState === 'collapsed' && activeTrack && (
              <div className="island-collapsed-content">
                <img 
                  className="island-art" 
                  id="island-collapsed-art"
                  src={activeTrack.artwork} 
                  alt="Artwork" 
                  title="Click to open Library"
                />
                <span className="island-elapsed-time" id="island-collapsed-elapsed">
                  {formatSecs(elapsed)}
                </span>
                <div className={`island-waveform ${isPlaying ? 'playing' : ''}`} id="island-collapsed-waveform">
                  <span className="wave-bar"></span>
                  <span className="wave-bar"></span>
                  <span className="wave-bar"></span>
                  <span className="wave-bar"></span>
                </div>
              </div>
            )}

            {/* 2. Hovered State Content */}
            {islandState === 'hovered' && activeTrack && (
              <div className="island-hovered-content">
                <img 
                  className="island-art" 
                  id="island-hovered-art"
                  src={activeTrack.artwork} 
                  alt="Artwork" 
                  title="Click to open Library"
                />
                <div className="island-info">
                  <span className="island-title" id="island-hovered-title">
                    {activeTrack.title}
                  </span>
                  <span className="island-artist" id="island-hovered-artist">
                    {activeTrack.artist}
                  </span>
                </div>
                <div className={`island-waveform ${isPlaying ? 'playing' : ''}`} id="island-hovered-waveform">
                  <span className="wave-bar"></span>
                  <span className="wave-bar"></span>
                  <span className="wave-bar"></span>
                  <span className="wave-bar"></span>
                </div>
              </div>
            )}

            {/* 3. Clicked/Expanded State Content */}
            {islandState === 'expanded' && activeTrack && (
              <div className="island-expanded-content">
                <div className="expanded-top-row">
                  <img 
                    className="island-art-large" 
                    id="island-expanded-art"
                    src={activeTrack.artwork} 
                    alt="Artwork" 
                    title="Click to open Library"
                  />
                  <div className="expanded-info">
                    <span className="expanded-title" id="island-expanded-title">
                      {activeTrack.title}
                    </span>
                    <span className="expanded-artist" id="island-expanded-artist">
                      {activeTrack.artist}
                    </span>
                  </div>
                  <div className={`expanded-waveform ${isPlaying ? 'playing' : ''}`} id="island-expanded-waveform">
                    <span className="wave-bar"></span>
                    <span className="wave-bar"></span>
                    <span className="wave-bar"></span>
                    <span className="wave-bar"></span>
                    <span className="wave-bar"></span>
                  </div>
                </div>
                <div className="expanded-progress-row">
                  <span className="expanded-time-elapsed" id="island-expanded-elapsed">
                    {formatSecs(elapsed)}
                  </span>
                  <div className="slider-wrapper">
                    <input 
                      type="range" 
                      className="expanded-slider"
                      id="island-expanded-progress" 
                      min="0" 
                      max="100" 
                      value={duration > 0 ? (elapsed / duration) * 100 : 0}
                      step="0.1"
                      onChange={(e) => handleSeek(parseFloat(e.target.value) / 100)}
                      onMouseDown={() => setIsDragging(true)}
                      onMouseUp={() => setIsDragging(false)}
                      style={{
                        background: `linear-gradient(to right, rgb(255, 255, 255) 0%, rgb(255, 255, 255) ${duration > 0 ? (elapsed / duration) * 100 : 0}%, rgba(255, 255, 255, 0.16) ${duration > 0 ? (elapsed / duration) * 100 : 0}%, rgba(255, 255, 255, 0.16) 100%)`
                      }}
                    />
                  </div>
                  <span className="expanded-time-remaining" id="island-expanded-remaining">
                    -{formatSecs(duration - elapsed)}
                  </span>
                </div>
                <div className="expanded-controls-row">
                  <div className="controls-spacer"></div>

                  <div className="controls-center">
                    <button className="expanded-control-btn btn-prev" title="Previous" onClick={handlePrev}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 18V6l-8.5 6 8.5 6zm8.5 0V6L12 12l8.5 6z" />
                      </svg>
                    </button>
                    <button className="expanded-control-btn btn-play" title="Play/Pause" onClick={handlePlayPause}>
                      {isPlaying ? (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                        </svg>
                      ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      )}
                    </button>
                    <button className="expanded-control-btn btn-next" title="Next" onClick={handleNext}>
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 6v12l8.5-6L12 6zM3.5 6v12L12 12 3.5 6z" />
                      </svg>
                    </button>
                  </div>

                  <button className="expanded-control-btn btn-output" title="Output Audio Source" onClick={checkAudioOutputDevice}>
                    {renderDeviceIcon()}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* ── Music Player Library Modal ── */}
      <div 
        id="music-player-modal" 
        className="remove-bg-window"
        style={{ display: showModal ? 'block' : 'none' }}
      >
        <div className="remove-bg-content music-overhaul-modal">
          {/* macOS window dots */}
          <div className="window-controls">
            <span className="window-dot dot-close" onClick={() => setShowModal(false)}></span>
            <span className="window-dot dot-minimize"></span>
            <span className="window-dot dot-maximize"></span>
          </div>
          <div className="music-app-layout">
            {/* Left Sidebar */}
            <aside className="music-sidebar">
              <nav className="sidebar-nav">
                <div 
                  className={`nav-item ${activeView === 'home' ? 'active' : ''}`}
                  onClick={() => handleNavigateTo('home')}
                >
                  <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
                  </svg>
                  <span>Home</span>
                </div>
                <div 
                  className={`nav-item ${activeView === 'search' ? 'active' : ''}`}
                  onClick={() => handleNavigateTo('search')}
                >
                  <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <span>Search</span>
                </div>
                <div 
                  className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
                  onClick={() => handleNavigateTo('settings')}
                >
                  <svg className="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                  <span>Settings</span>
                </div>
              </nav>

              <div className="sidebar-section">
                <div className="section-header">
                  <span>Your Library</span>
                  <div className="section-actions">
                    <button className="section-btn" id="playlist-create-btn" title="Create Playlist" onClick={handleCreatePlaylist}>
                      +
                    </button>
                  </div>
                </div>

                <ul className="sidebar-playlist-list" id="sidebar-playlists">
                  <li 
                    className={`playlist-item ${currentPlaylistId === 'favorites' && activeView === 'playlist' ? 'active' : ''}`}
                    onClick={() => handleNavigateTo('playlist', 'favorites')}
                  >
                    <span className="playlist-color-box fav-box">
                      <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                      </svg>
                    </span>
                    <div className="playlist-info">
                      <span className="playlist-name">Favorites</span>
                      <span className="playlist-desc">Playlist • You</span>
                    </div>
                  </li>

                  {Object.keys(playlists).map((name) => (
                    <li 
                      key={name}
                      className={`playlist-item ${currentPlaylistId === name && activeView === 'playlist' ? 'active' : ''}`}
                      onClick={() => handleNavigateTo('playlist', name)}
                    >
                      <span className="playlist-color-box custom-box">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">
                          <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
                        </svg>
                      </span>
                      <div className="playlist-info">
                        <span className="playlist-name">{name}</span>
                        <span className="playlist-desc">Playlist • You</span>
                      </div>
                      <button 
                        className="playlist-item-delete" 
                        title="Delete Playlist"
                        onClick={(e) => handleDeletePlaylist(e, name)}
                      >
                        &times;
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>

            {/* Main Content Area */}
            <main className="music-main-content">
              <header className="main-header">
                <div className="header-navigation">
                  <button className="nav-arrow" title="Go back" onClick={handleGoBack} disabled={historyIndex <= 0}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
                    </svg>
                  </button>
                  <button className="nav-arrow" title="Go forward" onClick={handleGoForward} disabled={historyIndex >= history.length - 1}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                      <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
                    </svg>
                  </button>
                  <span className="header-title" id="current-view-title">
                    {activeView === 'home' ? 'Home' : activeView === 'search' ? 'Search' : activeView === 'settings' ? 'Settings' : currentPlaylistId === 'favorites' ? 'Favorites' : currentPlaylistId === 'all' ? 'All Songs' : currentPlaylistId}
                  </span>
                </div>

                <div className="header-folder-actions">
                  <span id="music-modal-status" className="header-status-text">
                    {statusText}
                  </span>
                </div>
              </header>

              <div className="music-views-container">
                {/* 1. Home View */}
                {activeView === 'home' && (
                  <div className="music-view active" id="view-home">
                    <h2 className="view-section-title">Library Overview</h2>
                    <div className="home-grid">
                      <div className="home-card" id="card-all-songs" onClick={() => handleNavigateTo('playlist', 'all')}>
                        <div className="card-artwork-placeholder gradient-all">
                          <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
                            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                          </svg>
                        </div>
                        <h3>All Songs</h3>
                        <p>Everything in your library ({library.length})</p>
                      </div>
                      <div className="home-card" id="card-favorites" onClick={() => handleNavigateTo('playlist', 'favorites')}>
                        <div className="card-artwork-placeholder gradient-fav">
                          <svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                          </svg>
                        </div>
                        <h3>Favorites</h3>
                        <p>Songs you marked as favorite ({library.filter(t => favorites.includes(t.id)).length})</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. Search View */}
                {activeView === 'search' && (
                  <div className="music-view active" id="view-search">
                    <div className="search-input-wrapper" style={{ position: 'relative' }}>
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                      <input 
                        type="text" 
                        id="music-search-field"
                        placeholder="Search for songs, artists, or albums..."
                        value={searchQuery}
                        onChange={handleSearchChange}
                        onKeyDown={handleSearchKeyDown}
                        autoComplete="off"
                      />

                      {/* Apple Music Style Search Suggestions Dropdown */}
                      {searchSuggestions.length > 0 && (
                        <div className="search-suggestions-card">
                          {searchSuggestions.map((sug, idx) => {
                            const matchStr = searchQuery.trim().toLowerCase();
                            const fullText = sug.text;
                            const matchIdx = fullText.toLowerCase().indexOf(matchStr);
                            let content;

                            if (matchIdx >= 0) {
                              const before = fullText.slice(0, matchIdx);
                              const match = fullText.slice(matchIdx, matchIdx + matchStr.length);
                              const after = fullText.slice(matchIdx + matchStr.length);
                              content = (
                                <>
                                  {before}
                                  <strong className="highlighted-match">{match}</strong>
                                  {after}
                                </>
                              );
                            } else {
                              content = fullText;
                            }

                            return (
                              <div
                                key={idx}
                                className={`search-suggestion-row ${focusedSuggestionIndex === idx ? 'focused' : ''}`}
                                onClick={() => {
                                  setSearchQuery(sug.text);
                                  handleSearchSubmit(sug.text);
                                }}
                              >
                                <span className="suggestion-type-badge">{sug.type}</span>
                                <span className="suggestion-text">{content}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="search-results-section">
                      {/* Matched Artist Highlight Card */}
                      {matchedArtistInfo && (
                        <div className="artist-highlight-card">
                          <div className="artist-highlight-left">
                            <h3 className="artist-highlight-name">{matchedArtistInfo.name}</h3>
                            <p className="artist-highlight-songs">{matchedArtistInfo.count} Songs Found</p>
                            <div className="artist-highlight-albums">
                              {matchedArtistInfo.albums.map((album, aIdx) => (
                                <span key={aIdx} className="artist-album-badge">{album}</span>
                              ))}
                            </div>
                          </div>
                          <div className="artist-highlight-right">
                            <button 
                              className="settings-btn settings-btn-primary artist-create-playlist-btn"
                              onClick={() => handleSearchSubmit(`Create a playlist in the artist name of ${matchedArtistInfo.name}`)}
                            >
                              Create Playlist
                            </button>
                          </div>
                        </div>
                      )}
                      <h2 className="view-section-title" id="search-results-header">
                        {searchQuery ? `Search results (${getFilteredSearchTracks().length})` : 'Start searching'}
                      </h2>
                      <div className="music-track-list search-results-list">
                        {getFilteredSearchTracks().map((track) => {
                          const idxInLib = library.findIndex(t => t.id === track.id);
                          const isFav = favorites.includes(track.id);
                          return (
                            <div 
                              key={track.id} 
                              className={`track-row ${currentTrack && currentTrack.id === track.id ? 'active-track' : ''}`}
                              onClick={() => {
                                playTrack(idxInLib, library);
                              }}
                              style={{
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(255,255,255,0.06)',
                                padding: '8px 12px',
                                borderRadius: '10px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                marginBottom: '8px'
                              }}
                            >
                              <div className="track-row-left" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <img 
                                  className="track-row-art" 
                                  src={track.artwork} 
                                  style={{ width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover' }}
                                  onError={(e) => e.target.src = defaultArtwork}
                                />
                                <div className="track-row-details" style={{ display: 'flex', flexDirection: 'column' }}>
                                  <span className="track-row-title" style={{ color: '#fff', fontWeight: '500' }}>{track.title}</span>
                                  <span className="track-row-artist-album" style={{ color: 'rgba(255,255,255,0.6)', fontSize: '12px' }}>
                                    {track.artist} • {track.album}
                                  </span>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto' }}>
                                <button 
                                  className={`btn-row-action btn-fav ${isFav ? 'heart-active' : ''}`} 
                                  title="Favorite"
                                  onClick={(e) => toggleFavoriteTrack(e, track.id)}
                                >
                                  <svg viewBox="0 0 24 24" width="16" height="16" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                  </svg>
                                </button>
                                <button className="btn-row-action btn-more" title="Add to Playlist" onClick={(e) => showPlaylistContextMenu(e, track.id, 'all')}>
                                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                                    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                                  </svg>
                                </button>
                                <span className="track-row-duration" style={{ marginLeft: '10px', color: 'rgba(255,255,255,0.6)', fontSize: '13px' }}>
                                  {formatSecs(track.duration)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. Settings View */}
                {activeView === 'settings' && (
                  <div className="music-view active" id="view-settings">
                    <h2 className="view-section-title">Settings</h2>
                    <div className="settings-container" style={{ padding: '10px 0', color: '#fff', maxHeight: 'calc(100% - 40px)', overflowY: 'auto' }}>
                      
                      {/* Section 1: Library & Folders */}
                      <div className="settings-section" style={{ marginBottom: '24px' }}>
                        <h3 style={{ fontSize: '15px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '12px', fontWeight: '600' }}>Library Management</h3>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          <button className="settings-action-btn" onClick={handleSelectFolder} style={{
                            background: '#1db954', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px'
                          }}>
                            Select Music Folder
                          </button>
                          {dirHandle && (
                            <button className="settings-action-btn" onClick={handleRescan} style={{
                              background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '8px 16px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px'
                            }}>
                              Rescan Folder
                            </button>
                          )}
                          <button className="settings-action-btn" onClick={handleClearLibrary} style={{
                            background: '#ff5f56', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '20px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px'
                          }}>
                            Clear Library
                          </button>
                        </div>
                        <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)', marginTop: '8px' }}>
                          Status: {statusText}
                        </p>
                      </div>

                      {/* Section 2: Audio & Playback Options */}
                      <div className="settings-section" style={{ marginBottom: '24px' }}>
                        <h3 style={{ fontSize: '15px', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '12px', fontWeight: '600' }}>Audio & Playback</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                          
                          {/* Audio Device */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: '500', fontSize: '14px' }}>Audio Output Device</div>
                              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Choose your active listening device type</div>
                            </div>
                            <select 
                              value={outputDevice} 
                              onChange={(e) => handleUpdateSetting('outputDevice', e.target.value)}
                              style={{
                                background: '#282828', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px'
                              }}
                            >
                              <option value="speakers">Speakers</option>
                              <option value="buds">Earbuds</option>
                              <option value="headphones">Headphones</option>
                            </select>
                          </div>

                          {/* Default Volume */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: '500', fontSize: '14px' }}>Default Startup Volume</div>
                              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Initial playback volume level ({volume}%)</div>
                            </div>
                            <input 
                              type="range" 
                              min="0" 
                              max="100" 
                              value={volume}
                              onChange={(e) => handleUpdateSetting('volume', parseInt(e.target.value))}
                              style={{ width: '120px', cursor: 'pointer' }}
                            />
                          </div>

                          {/* Remember Playback State */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: '500', fontSize: '14px' }}>Remember Playback State</div>
                              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Save active track and seek location between sessions</div>
                            </div>
                            <input 
                              type="checkbox" 
                              checked={rememberPlayback}
                              onChange={(e) => handleUpdateSetting('rememberPlayback', e.target.checked)}
                              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                            />
                          </div>

                          {/* Silent Auto-Reconnect */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: '500', fontSize: '14px' }}>Silent Auto-Reconnect</div>
                              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Attempt reconnection of files automatically on page load</div>
                            </div>
                            <input 
                              type="checkbox" 
                              checked={silentAutoReconnect}
                              onChange={(e) => handleUpdateSetting('silentAutoReconnect', e.target.checked)}
                              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                            />
                          </div>

                          {/* Enable Hover Expand */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: '500', fontSize: '14px' }}>Enable Hover Expand</div>
                              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Expand dynamic island pill on mouse hover</div>
                            </div>
                            <input 
                              type="checkbox" 
                              checked={enableHoverExpand}
                              onChange={(e) => handleUpdateSetting('enableHoverExpand', e.target.checked)}
                              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                            />
                          </div>

                          {/* Display Lyrics Panel */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontWeight: '500', fontSize: '14px' }}>Display Lyrics Panel</div>
                              <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.5)' }}>Show visual lyrics helper overlay</div>
                            </div>
                            <input 
                              type="checkbox" 
                              checked={displayLyrics}
                              onChange={(e) => handleUpdateSetting('displayLyrics', e.target.checked)}
                              style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                            />
                          </div>

                        </div>
                      </div>

                    </div>
                  </div>
                )}

                {/* 3. Playlist / Album View */}
                {activeView === 'playlist' && (
                  <div className="music-view active" id="view-playlist">
                    <div className="playlist-header-block">
                      <img 
                        className="playlist-cover-art" 
                        id="playlist-view-cover"
                        src={getPlaylistTracks(currentPlaylistId).length > 0 ? getPlaylistTracks(currentPlaylistId)[0].artwork : defaultArtwork}
                        style={{
                          background: currentPlaylistId === 'favorites' ? 'linear-gradient(135deg, #ff2a5f, #ff7e5f)' : 'transparent'
                        }}
                        alt="Cover"
                      />
                      <div className="playlist-metadata-details">
                        <span className="playlist-category" id="playlist-view-category">
                          {currentPlaylistId === 'favorites' ? 'Playlist' : 'Collection'}
                        </span>
                        <h1 className="playlist-title-large" id="playlist-view-title">
                          {currentPlaylistId === 'favorites' ? 'Favorites' : currentPlaylistId === 'all' ? 'All Songs' : currentPlaylistId}
                        </h1>
                        <div className="playlist-creator-row">
                          <span className="playlist-creator-name" id="playlist-view-artist">
                            {currentPlaylistId === 'favorites' ? 'You' : 'Various Artists'}
                          </span>
                          <span className="bullet-sep">•</span>
                          <span className="playlist-release-year" id="playlist-view-year">2026</span>
                        </div>
                        <div className="playlist-stats" id="playlist-view-stats">
                          {getPlaylistTracks(currentPlaylistId).length} songs
                        </div>

                        <p className="playlist-description" id="playlist-view-desc">
                          {currentPlaylistId === 'favorites' 
                            ? 'Your absolute favorites, collected in one place. Press Play to listen.'
                            : 'Explore and listen to tracks loaded directly from your folder structure.'}
                        </p>

                        <div className="playlist-actions-row">
                          <button className="playlist-pill-btn btn-play-all" id="playlist-play-btn" onClick={() => handlePlayAll(false)}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                            <span>Play</span>
                          </button>
                          <button className="playlist-pill-btn btn-shuffle-all" id="playlist-shuffle-btn" onClick={() => handlePlayAll(true)}>
                            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                              <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.54 5.46 20 18 7.46l2.04 2.04V4h-5.54zm.35 11.06l-1.41 1.41L18 20l5.54-5.54-1.41-1.41-4.13 4.13-3.14-3.12z" />
                            </svg>
                            <span>Shuffle</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="tracks-table-container">
                      <table className="tracks-table">
                        <thead>
                          <tr>
                            <th className="col-index">#</th>
                            <th className="col-title">Title</th>
                            <th className="col-album">Album</th>
                            <th className="col-actions"></th>
                            <th className="col-duration">Time</th>
                          </tr>
                        </thead>
                        <tbody className="music-track-list" id="playlist-tracks-body">
                          {getPlaylistTracks(currentPlaylistId).length === 0 ? (
                            <tr>
                              <td colSpan="5" style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', padding: '40px' }}>
                                No songs in this list.
                              </td>
                            </tr>
                          ) : (
                            getPlaylistTracks(currentPlaylistId).map((track, idx) => {
                              const isFav = favorites.includes(track.id);
                              const idxInLib = library.findIndex(t => t.id === track.id);
                              const isActive = currentTrack && currentTrack.id === track.id;
                              return (
                                <tr 
                                  key={track.id} 
                                  className={isActive ? 'active-row' : ''}
                                  onClick={() => playTrack(idxInLib, library)}
                                >
                                  <td className="col-index">{idx + 1}</td>
                                  <td className="col-title">
                                    <img className="table-track-art" src={track.artwork} onError={(e) => e.target.src = defaultArtwork} alt="" />
                                    <div className="table-track-details">
                                      <span className="table-track-title">{track.title}</span>
                                      <span className="table-track-artist">{track.artist}</span>
                                    </div>
                                  </td>
                                  <td className="col-album">{track.album}</td>
                                  <td className="col-actions">
                                    <button 
                                      className={`btn-row-action btn-fav ${isFav ? 'heart-active' : ''}`} 
                                      title="Favorite"
                                      onClick={(e) => toggleFavoriteTrack(e, track.id)}
                                    >
                                      <svg viewBox="0 0 24 24" width="15" height="15" fill={isFav ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                                      </svg>
                                    </button>
                                    <button className="btn-row-action btn-more" title="Add to Playlist" onClick={(e) => showPlaylistContextMenu(e, track.id, currentPlaylistId)}>
                                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
                                        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
                                      </svg>
                                    </button>
                                  </td>
                                  <td className="col-duration">{formatSecs(track.duration)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </main>
          </div>

          {/* Bottom Playback Control Bar */}
          <footer className="music-bottom-bar">
            {/* Left: Active Track Details */}
            <div className="bottom-active-track">
              {activeTrack ? (
                <>
                  <img className="bottom-track-art" id="bottom-bar-art" src={activeTrack.artwork} onError={(e) => e.target.src = defaultArtwork} alt="" />
                  <div className="bottom-track-info">
                    <span className="bottom-track-title" id="bottom-bar-title">{activeTrack.title}</span>
                    <span className="bottom-track-artist" id="bottom-bar-artist">{activeTrack.artist}</span>
                  </div>
                </>
              ) : (
                <>
                  <img className="bottom-track-art" id="bottom-bar-art" src={defaultArtwork} alt="" />
                  <div className="bottom-track-info">
                    <span className="bottom-track-title" id="bottom-bar-title">No Track Selected</span>
                    <span className="bottom-track-artist" id="bottom-bar-artist">Select a folder to start</span>
                  </div>
                </>
              )}
            </div>

            {/* Center: Controls & Seek */}
            <div className="bottom-playback-center">
              <div className="bottom-controls-row">
                <button 
                  className={`bottom-control-btn ${isShuffle ? 'shuffle-active' : ''}`} 
                  id="bottom-bar-shuffle" 
                  title="Shuffle"
                  onClick={() => handleUpdateSetting('isShuffle', !isShuffle)}
                  style={{ color: isShuffle ? '#1db954' : 'inherit' }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.54 5.46 20 18 7.46l2.04 2.04V4h-5.54zm.35 11.06l-1.41 1.41L18 20l5.54-5.54-1.41-1.41-4.13 4.13-3.14-3.12z" />
                  </svg>
                </button>
                <button className="bottom-control-btn" id="bottom-bar-prev" title="Previous" onClick={handlePrev}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                  </svg>
                </button>
                <button className="bottom-control-btn play-pause-btn" id="bottom-bar-play" title="Play/Pause" onClick={handlePlayPause}>
                  {isPlaying ? (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  )}
                </button>
                <button className="bottom-control-btn" id="bottom-bar-next" title="Next" onClick={handleNext}>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6z" />
                  </svg>
                </button>
                <button 
                  className={`bottom-control-btn ${isRepeat !== 'off' ? 'repeat-active' : ''}`} 
                  id="bottom-bar-repeat" 
                  title={`Repeat: ${isRepeat}`}
                  onClick={() => {
                    const states = ['off', 'all', 'one'];
                    const next = states[(states.indexOf(isRepeat) + 1) % states.length];
                    handleUpdateSetting('isRepeat', next);
                  }}
                  style={{ color: isRepeat !== 'off' ? '#1db954' : 'inherit' }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
                  </svg>
                  {isRepeat === 'one' && <span style={{ fontSize: '8px', position: 'absolute', top: '12px', left: '10px' }}>1</span>}
                </button>
              </div>

              <div className="bottom-seek-row">
                <span className="seek-time elapsed-time" id="bottom-bar-elapsed">
                  {formatSecs(elapsed)}
                </span>
                <div className="seek-slider-wrapper">
                  <input 
                    type="range" 
                    className="seek-slider" 
                    id="bottom-bar-progress" 
                    min="0" 
                    max="100" 
                    value={duration > 0 ? (elapsed / duration) * 100 : 0}
                    step="0.1"
                    onChange={(e) => handleSeek(parseFloat(e.target.value) / 100)}
                    onMouseDown={() => setIsDragging(true)}
                    onMouseUp={() => setIsDragging(false)}
                    style={{
                      background: `linear-gradient(to right, rgb(255, 255, 255) 0%, rgb(255, 255, 255) ${duration > 0 ? (elapsed / duration) * 100 : 0}%, rgba(255, 255, 255, 0.16) ${duration > 0 ? (elapsed / duration) * 100 : 0}%, rgba(255, 255, 255, 0.16) 100%)`
                    }}
                  />
                </div>
                <span className="seek-time total-time" id="bottom-bar-duration">
                  {formatSecs(duration)}
                </span>
              </div>
            </div>

            {/* Right: Extras & Volume */}
            <div className="bottom-playback-right">
              <div className="volume-control-wrapper">
                <button className="bottom-control-btn volume-btn" id="bottom-bar-volume-btn" title="Mute/Unmute" onClick={handleToggleMute}>
                  {isMuted || volume === 0 ? (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.21.05-.42.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                    </svg>
                  )}
                </button>
                <input 
                  type="range" 
                  className="volume-slider" 
                  id="bottom-bar-volume" 
                  min="0" 
                  max="100" 
                  value={volume}
                  onChange={handleVolumeChange}
                  style={{
                    background: `linear-gradient(to right, rgb(255, 255, 255) 0%, rgb(255, 255, 255) ${volume}%, rgba(255, 255, 255, 0.16) ${volume}%, rgba(255, 255, 255, 0.16) 100%)`
                  }}
                />
              </div>
            </div>
          </footer>

          {/* Playlist Add Context Menu Popup */}
          {showContextMenu && (
            <div 
              id="playlist-context-menu" 
              className="music-context-menu"
              style={{
                display: 'block',
                position: 'fixed',
                left: `${contextMenuPos.x}px`,
                top: `${contextMenuPos.y}px`
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="context-header">Add to Playlist</div>
              <div className="context-list">
                {/* Remove action */}
                {(favorites.includes(contextMenuTrackId) || (contextMenuPlaylistKey && contextMenuPlaylistKey !== 'all')) && (
                  <>
                    <div 
                      className="context-item remove-action" 
                      style={{ color: '#ff5f56' }}
                      onClick={handleRemoveTrackFromPlaylist}
                    >
                      <span>Remove</span>
                    </div>
                    <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />
                  </>
                )}
                {/* Custom Playlists list */}
                {Object.keys(playlists).map(name => {
                  if (name === contextMenuPlaylistKey) return null;
                  return (
                    <div 
                      key={name}
                      className="context-item"
                      onClick={() => handleAddTrackToPlaylist(name)}
                    >
                      {name}
                    </div>
                  );
                })}
                {Object.keys(playlists).length === 0 && (
                  <div className="context-no-playlists">
                    No custom playlists. Click + in sidebar to create.
                  </div>
                )}
              </div>
            </div>
          )}
          {toast && (
            <div className="music-toast">
              <div className="music-toast-icon">✨</div>
              <div className="music-toast-text">
                <strong>{toast.message}</strong>
                <span>{toast.submessage}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
