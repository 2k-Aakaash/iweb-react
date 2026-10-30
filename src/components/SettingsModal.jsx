import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseIwebBackup, restoreFromIwebBackup } from '../libs/backupService';
import { openIwebDB } from '../libs/wallpaper/db';
import WallpaperSettings from './WallpaperSettings';
import { useMacWindow } from '../libs/window/useMacWindow';
import GlassSurface from './glass/GlassSurface';
import { setGlassMode, useGlassMode } from './glass/glassMode';
import { MENUBAR_MODES, setMenubarMode, useMenubarMode } from '../libs/menubar/menubarPrefs';
import { CLOCK_STYLES, setClockStyle, useClockStyle } from '../libs/clock/clockStyle';
import ConfirmDialog from './wallpaper/ConfirmDialog';
import SettingsTabIcon from './settings/SettingsTabIcon';
import AboutPane from './settings/AboutPane';
import ProfileCard from './settings/ProfileCard';
import DataControlsPane from './settings/DataControlsPane';
import WidgetsPane from './settings/WidgetsPane';
import { deleteCustomFonts, listCustomFonts } from '../libs/fonts/customFonts';

export default function SettingsModal({
  isOpen,
  onClose,
  customName,
  setCustomName,
  clockFont,
  setClockFont,
  bookmarks,
  setBookmarks
}) {
  // Visited panes, for the toolbar's back / forward buttons (like System Settings).
  const [nav, setNav] = useState({ stack: ['general'], index: 0 });
  const activeTab = nav.stack[nav.index];
  const goToTab = useCallback((id) => {
    setNav((prev) => {
      if (prev.stack[prev.index] === id) return prev;
      const stack = [...prev.stack.slice(0, prev.index + 1), id].slice(-50);
      return { stack, index: stack.length - 1 };
    });
  }, []);
  const stepHistory = (delta) => {
    setNav((prev) => {
      const index = prev.index + delta;
      return index >= 0 && index < prev.stack.length ? { ...prev, index } : prev;
    });
  };
  const overlayRef = useRef(null);
  const windowRef = useRef(null);
  const glassMode = useGlassMode();
  const menubarMode = useMenubarMode();
  const clockStyle = useClockStyle();

  // Escape closes Settings, like the other macOS-style windows.
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Other parts of the app (e.g. the update notice) can open a specific tab.
  useEffect(() => {
    const handleOpenTab = (e) => {
      if (e.detail?.tab) goToTab(e.detail.tab);
    };
    window.addEventListener('settings:open', handleOpenTab);
    return () => window.removeEventListener('settings:open', handleOpenTab);
  }, [goToTab]);
  const [nameInput, setNameInput] = useState(customName || '');
  const [searchQuery, setSearchQuery] = useState('');

  // Import state
  const [importingZip, setImportingZip] = useState(null);
  const [importMetadata, setImportMetadata] = useState(null);
  const [importModules, setImportModules] = useState({
    images: true,
    bookmarks: true,
    music: true,
    notes: true
  });
  const [showImportConfirm, setShowImportConfirm] = useState(false);

  // Custom fonts state & ref
  const [customFonts, setCustomFonts] = useState([]);
  const fontFileInputRef = useRef(null);
  // Deleting custom fonts: one from its card, or several in Select mode (like the wallpapers).
  const [fontSelecting, setFontSelecting] = useState(false);
  const [selectedFonts, setSelectedFonts] = useState(() => new Set());
  const [fontsToDelete, setFontsToDelete] = useState(null); // families awaiting confirmation
  const [deletingFonts, setDeletingFonts] = useState(false);

  // Music state
  const [musicSettings, setMusicSettings] = useState({
    volume: 80,
    rememberPlayback: true,
    silentAutoReconnect: true,
    enableHoverExpand: true,
    displayLyrics: false
  });
  const [musicFolderName, setMusicFolderName] = useState('');

  // Sync props to local inputs
  useEffect(() => {
    setNameInput(customName || '');
  }, [customName]);

  // Load Custom Fonts and Music settings
  useEffect(() => {
    if (isOpen) {
      loadMusicSettings();
      loadCustomFonts();
    }
  }, [isOpen]);

  const loadCustomFonts = () => {
    listCustomFonts()
      .then(setCustomFonts)
      .catch((err) => {
        console.error('Error opening iWebDB for custom fonts:', err);
      });
  };

  const exitFontSelection = () => {
    setFontSelecting(false);
    setSelectedFonts(new Set());
  };

  const toggleFontSelected = (family) => {
    setSelectedFonts((prev) => {
      const next = new Set(prev);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  };

  const handleConfirmDeleteFonts = async () => {
    if (!fontsToDelete || deletingFonts) return;
    setDeletingFonts(true);
    try {
      const deleted = await deleteCustomFonts(fontsToDelete);
      // The clock goes back to the default font if its font was deleted.
      if (deleted.includes(clockFont)) {
        setClockFont('');
        localStorage.removeItem('selectedFont');
      }
      exitFontSelection();
    } catch (err) {
      console.error('Failed to delete custom fonts:', err);
      alert('Couldn’t delete the selected fonts.');
    } finally {
      setDeletingFonts(false);
      setFontsToDelete(null);
      loadCustomFonts();
    }
  };

  const handleUploadCustomFont = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const arrayBuffer = ev.target.result;
        const fontName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
        // Make clean font-family name
        const cleanFontFamily = "custom_" + fontName.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();
        
        // Save to IndexedDB
        let db;
        try {
          db = await openIwebDB();
        } catch (err) {
          console.error('Error opening iWebDB for custom fonts:', err);
          return;
        }
        const tx = db.transaction('custom_fonts', 'readwrite');
        const store = tx.objectStore('custom_fonts');
        
        const newFontBlob = new Blob([arrayBuffer], { type: file.type || 'font/woff2' });
        const record = {
          family: cleanFontFamily,
          name: fontName,
          blob: newFontBlob
        };
        
        const putReq = store.put(record);
        putReq.onsuccess = async () => {
          // Load dynamically into the document
          try {
            const fontUrl = URL.createObjectURL(newFontBlob);
            const fontFace = new FontFace(cleanFontFamily, `url(${fontUrl})`);
            await fontFace.load();
            document.fonts.add(fontFace);
            console.log(`Registered custom font: ${fontName}`);
          } catch (err) {
            console.error("Error registering FontFace:", err);
          }
          // Reload custom fonts list
          loadCustomFonts();
        };
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const loadMusicSettings = () => {
    const request = indexedDB.open('iweb-music-player', 1);
    request.onsuccess = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) return;
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');

      // Get settings
      const settingsReq = store.get('music-settings');
      settingsReq.onsuccess = () => {
        if (settingsReq.result) {
          setMusicSettings(settingsReq.result);
        }
      };

      // Get folder handle name
      const handleReq = store.get('directory-handle');
      handleReq.onsuccess = () => {
        if (handleReq.result) {
          setMusicFolderName(handleReq.result.name);
        } else {
          setMusicFolderName('');
        }
      };
    };
  };

  // Font options matching Background.jsx
  const fontOptions = [
    { name: "New York Extra Large Heavy", family: "new_york_extra_largeheavy" },
    { name: "SF-Pro Rails", family: "SF-Pro Rails" },
    { name: "SF Pro Stencil Regular", family: "sf_pro_-_stencilregular" },
    { name: "SF Pro Display Heavy", family: "SFProDisplay-Heavy" },
  ];

  const handleNameSave = () => {
    const val = nameInput.trim();
    if (val) {
      setCustomName(val);
      localStorage.setItem('customName', val);
    }
  };

  const handleSelectFont = (family) => {
    setClockFont(family);
    localStorage.setItem('selectedFont', family);
  };

  const handleMusicSettingChange = (key, val) => {
    const updated = { ...musicSettings, [key]: val };
    setMusicSettings(updated);

    const request = indexedDB.open('iweb-music-player', 1);
    request.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      store.put(updated, 'music-settings');
    };
  };

  // Select Folder reconnect handler
  const handleReconnectMusicFolder = async () => {
    if (!('showDirectoryPicker' in window)) {
      alert('Browser does not support folder picker.');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      const request = indexedDB.open('iweb-music-player', 1);
      request.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('settings', 'readwrite');
        const store = tx.objectStore('settings');
        store.put(handle, 'directory-handle');
        setMusicFolderName(handle.name);
        alert(`Successfully reconnected folder: ${handle.name}. Please rescan files in your Music Library to play tracks.`);
      };
    } catch (err) {
      console.error(err);
    }
  };


  // Import Backups picker
  const handleImportFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const { metadata, zip } = await parseIwebBackup(file);
      setImportMetadata(metadata);
      setImportingZip(zip);
      
      // Auto pre-check modules that exist in metadata
      const initialModules = { images: false, bookmarks: false, music: false, notes: false };
      metadata.exportedModules.forEach(mod => {
        initialModules[mod] = true;
      });
      setImportModules(initialModules);
      
      setShowImportConfirm(true);
    } catch (err) {
      alert(`Invalid backup: ${err.message}`);
    }
    e.target.value = null; // Reset input picker
  };

  // Finalize import restore
  const handleConfirmImport = async () => {
    try {
      await restoreFromIwebBackup(importingZip, importMetadata, importModules);
      alert('Backup imported successfully. The page will reload to apply changes.');
      window.location.reload();
    } catch (err) {
      alert(`Restore failed: ${err.message}`);
    }
  };

  // macOS window: genies out of the Dock's Settings icon; red closes, yellow minimizes into
  // the icon, green zooms to full size.
  const setSettingsOpen = useCallback((value) => {
    if (!value) onClose();
  }, [onClose]);
  const menusRef = useRef(null); // menu-bar menus, set below once the tabs exist
  const win = useMacWindow({ app: 'settings', open: isOpen, setOpen: setSettingsOpen, windowRef, overlayRef, menus: menusRef });
  const mounted = win.mounted;

  // Filter tabs for search (icons: SettingsTabIcon)
  // `group`: the sidebar leaves a gap between groups, as System Settings does.
  const tabs = [
    { id: 'general', name: 'General', group: 1 },
    { id: 'appearance', name: 'Appearance', group: 1 },
    { id: 'wallpaper', name: 'Wallpaper', group: 1 },
    { id: 'widgets', name: 'Widgets', group: 1 },
    { id: 'music', name: 'Music', group: 2 },
    { id: 'bookmarks', name: 'Bookmarks', group: 2 },
    { id: 'data_controls', name: 'Data Controls', group: 3 },
    { id: 'about', name: 'About', group: 3 }
  ];

  // Menu bar: View lists the panes, like System Settings.
  useEffect(() => {
    menusRef.current = () => ({
      View: [
        { label: 'Back', disabled: nav.index === 0, onSelect: () => stepHistory(-1) },
        { label: 'Forward', disabled: nav.index >= nav.stack.length - 1, onSelect: () => stepHistory(1) },
        { type: 'separator' },
        ...tabs.map((tab) => ({ label: tab.name, checked: activeTab === tab.id, onSelect: () => goToTab(tab.id) })),
      ],
    });
  });

  if (!mounted) return null;


  const filteredTabs = tabs.filter(tab => 
    tab.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="settings-overlay" ref={overlayRef} onClick={onClose}>
      <div className={`settings-modal glass-host${win.maximized ? ' window-maximized' : ''}`} ref={windowRef} onClick={(e) => e.stopPropagation()}>
        <GlassSurface preset="window" />
        
        {/* Left Sidebar */}
        <aside className="settings-sidebar">
          {/* Traffic Light Dots */}
          <div className="settings-window-controls">
            <span className="settings-dot settings-dot-close" role="button" aria-label="Close" onClick={win.close}></span>
            <span className="settings-dot settings-dot-minimize" role="button" aria-label="Minimize" onClick={win.minimize}></span>
            <span className="settings-dot settings-dot-maximize" role="button" aria-label={win.maximized ? 'Exit full size' : 'Zoom'} onClick={win.toggleMaximize}></span>
          </div>

          {/* Search Field */}
          <div className="settings-search-container">
            <input
              type="text"
              className="settings-search-input"
              placeholder="Search"
              aria-label="Search Settings"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Profile: photo (iWebDB) or monogram, and name */}
          <ProfileCard name={customName} />

          {/* Sidebar Tabs List */}
          <nav className="settings-sidebar-nav">
            {filteredTabs.length === 0 && <p className="settings-sidebar-empty">No Results</p>}
            {filteredTabs.map((tab, i) => (
              <React.Fragment key={tab.id}>
                {i > 0 && filteredTabs[i - 1].group !== tab.group && <span className="settings-sidebar-gap" aria-hidden="true" />}
                <button
                  type="button"
                  className={`settings-sidebar-item ${activeTab === tab.id ? 'active' : ''}`}
                  aria-current={activeTab === tab.id ? 'page' : undefined}
                  onClick={() => {
                    goToTab(tab.id);
                    exitFontSelection();
                  }}
                >
                  <SettingsTabIcon id={tab.id} />
                  <span className="settings-tab-name">{tab.name}</span>
                </button>
              </React.Fragment>
            ))}
          </nav>
        </aside>

        {/* Right Content Pane */}
        <main className="settings-content">
          <div className="settings-content-header">
            <div className="settings-history">
              <button
                type="button"
                aria-label="Back"
                title="Back"
                disabled={nav.index === 0}
                onClick={() => {
                  stepHistory(-1);
                  exitFontSelection();
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
              </button>
              <button
                type="button"
                aria-label="Forward"
                title="Forward"
                disabled={nav.index >= nav.stack.length - 1}
                onClick={() => {
                  stepHistory(1);
                  exitFontSelection();
                }}
              >
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
            <h2>{tabs.find(t => t.id === activeTab)?.name}</h2>
          </div>

          <div className="settings-content-body custom-scrollbar">
            
            {/* 1. GENERAL TAB */}
            {activeTab === 'general' && (
              <div className="settings-tab-pane">
                <div className="settings-group-card">
                  <div className="settings-row">
                    <span className="settings-label">User Custom Name</span>
                    <div className="settings-value">
                      <input
                        type="text"
                        className="settings-input-text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        onBlur={handleNameSave}
                        onKeyDown={(e) => e.key === 'Enter' && handleNameSave()}
                      />
                    </div>
                  </div>
                </div>

                {/* wp-root: the Wallpaper library's selection bar, dialog and colours. */}
                <div className="wp-root settings-font-section">
                <div className="settings-group-card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>Clock Font</span>
                  <div className="settings-font-actions">
                    {customFonts.length > 0 && !fontSelecting && (
                      <button
                        type="button"
                        className="settings-btn settings-btn-secondary"
                        style={{ fontSize: '11px', padding: '4px 12px' }}
                        onClick={() => setFontSelecting(true)}
                      >
                        Select
                      </button>
                    )}
                    <button
                      type="button"
                      className="settings-btn settings-btn-primary"
                      style={{ fontSize: '11px', padding: '4px 12px' }}
                      onClick={() => fontFileInputRef.current.click()}
                    >
                      Add New Font
                    </button>
                  </div>
                  <input
                    type="file"
                    ref={fontFileInputRef}
                    style={{ display: 'none' }}
                    accept=".ttf,.otf,.woff,.woff2"
                    onChange={handleUploadCustomFont}
                  />
                </div>
                {fontSelecting && (
                  <div className="wp-selection-bar" role="toolbar" aria-label="Font selection actions">
                    <span className="wp-selection-count" aria-live="polite">{selectedFonts.size} selected</span>
                    <div className="wp-selection-actions">
                      <button type="button" className="settings-btn settings-btn-secondary" onClick={() => setSelectedFonts(new Set(customFonts.map((f) => f.family)))} disabled={deletingFonts}>
                        Select All
                      </button>
                      <button type="button" className="settings-btn settings-btn-secondary" onClick={() => setSelectedFonts(new Set())} disabled={deletingFonts || selectedFonts.size === 0}>
                        Clear
                      </button>
                      <button type="button" className="settings-btn settings-btn-secondary" onClick={exitFontSelection} disabled={deletingFonts}>
                        Cancel
                      </button>
                      <button type="button" className="settings-btn wp-btn-danger" onClick={() => setFontsToDelete([...selectedFonts])} disabled={deletingFonts || selectedFonts.size === 0}>
                        {deletingFonts ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                )}
                <div className={`settings-font-grid${fontSelecting ? ' is-selecting' : ''}`}>
                  {[
                    ...fontOptions,
                    ...customFonts.map(f => ({ name: f.name, family: f.family, custom: true }))
                  ].map((font) => {
                    const isActive = clockFont === font.family;
                    const isSelected = selectedFonts.has(font.family);
                    // Built-in fonts can't be deleted, so Select mode skips them.
                    const locked = fontSelecting && !font.custom;
                    return (
                      <div
                        key={font.family}
                        className={`settings-font-card ${isActive ? 'active' : ''}${isSelected ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}
                        role="button"
                        tabIndex={locked ? -1 : 0}
                        aria-pressed={fontSelecting ? isSelected : isActive}
                        aria-disabled={locked || undefined}
                        onClick={() => {
                          if (locked) return;
                          if (fontSelecting) toggleFontSelected(font.family);
                          else handleSelectFont(font.family);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.currentTarget.click();
                          }
                        }}
                      >
                        <div className="settings-font-preview" style={{ fontFamily: font.family }}>
                          12
                        </div>
                        <span className="settings-font-name" title={font.name}>{font.name}</span>
                        {fontSelecting && font.custom ? (
                          <span className={`settings-font-select${isSelected ? ' is-checked' : ''}`} aria-hidden="true">
                            {isSelected ? '✓' : ''}
                          </span>
                        ) : isActive && (
                          <span className="settings-font-check">✓</span>
                        )}
                        {font.custom && !fontSelecting && (
                          <button
                            type="button"
                            className="settings-font-delete"
                            aria-label={`Delete ${font.name}`}
                            title="Delete font"
                            onClick={(e) => {
                              e.stopPropagation();
                              setFontsToDelete([font.family]);
                            }}
                          >
                            <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden="true">
                              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {fontsToDelete && (() => {
                  const count = fontsToDelete.length;
                  const single = count === 1 ? customFonts.find((f) => f.family === fontsToDelete[0]) : null;
                  return (
                    <ConfirmDialog
                      title={single ? `Delete “${single.name}”?` : `Delete ${count} fonts?`}
                      message={
                        `${count === 1 ? 'This font' : `These ${count} fonts`} will be removed from this browser. `
                        + (fontsToDelete.includes(clockFont) ? 'The clock will go back to the default font. ' : '')
                        + 'This can’t be undone.'
                      }
                      confirmLabel="Delete"
                      destructive
                      busy={deletingFonts}
                      onConfirm={handleConfirmDeleteFonts}
                      onCancel={() => setFontsToDelete(null)}
                    />
                  );
                })()}
                </div>
              </div>
            )}

            {/* 2. APPEARANCE TAB */}
            {activeTab === 'appearance' && (
              <div className="settings-tab-pane">
                <div className="settings-group-card">
                  <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                    <span className="settings-label" style={{ marginTop: '10px' }}>Appearance</span>
                    <div className="settings-appearance-picker">
                      <div className="settings-appearance-option active">
                        <div className="appearance-preview-light"></div>
                        <span>Light</span>
                      </div>
                      <div className="settings-appearance-option">
                        <div className="appearance-preview-dark"></div>
                        <span>Dark</span>
                      </div>
                      <div className="settings-appearance-option">
                        <div className="appearance-preview-auto"></div>
                        <span>Auto</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="settings-group-card-title">Theme Accent</div>
                <div className="settings-group-card">
                  <div className="settings-row">
                    <span className="settings-label">Accent Colour</span>
                    <div className="settings-accent-colors">
                      <span className="accent-dot accent-multicolor active"></span>
                      <span className="accent-dot accent-blue"></span>
                      <span className="accent-dot accent-purple"></span>
                      <span className="accent-dot accent-pink"></span>
                      <span className="accent-dot accent-red"></span>
                      <span className="accent-dot accent-orange"></span>
                      <span className="accent-dot accent-green"></span>
                    </div>
                  </div>
                </div>

                <div className="settings-group-card-title">Glass Effect</div>
                <div className="settings-group-card">
                  <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                    <span className="settings-label" style={{ marginTop: '6px' }}>Glass</span>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                      <div role="radiogroup" aria-label="Glass effect" style={{ display: 'flex', gap: '8px' }}>
                        {[
                          { id: 'static', label: 'Static' },
                          { id: 'liquid', label: 'Liquid' },
                        ].map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            role="radio"
                            aria-checked={glassMode === option.id}
                            className={`settings-btn${glassMode === option.id ? ' settings-btn-primary' : ''}`}
                            onClick={() => setGlassMode(option.id)}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <span style={{ fontSize: '11px', opacity: 0.6, maxWidth: '300px', textAlign: 'right' }}>
                        {glassMode === 'static'
                          ? 'Rendered once and reused. Smooth on every device.'
                          : 'Live refraction. Uses more GPU while things animate.'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="settings-group-card-title">Clock</div>
                <div className="settings-group-card">
                  <div className="settings-row">
                    <label className="settings-label" htmlFor="clock-style">Clock style</label>
                    <select
                      id="clock-style"
                      className="settings-select"
                      value={clockStyle}
                      onChange={(e) => setClockStyle(e.target.value)}
                    >
                      {CLOCK_STYLES.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-row-hint">
                    {clockStyle === 'glass'
                      ? 'Frosted glass over the wallpaper, as on the iOS 26 Lock Screen.'
                      : 'Painted in the most vibrant colour of the wallpaper.'}
                  </div>
                </div>

                <div className="settings-group-card-title">Menu Bar</div>
                <div className="settings-group-card">
                  <div className="settings-row">
                    <label className="settings-label" htmlFor="menubar-autohide">Automatically hide and show the menu bar</label>
                    <select
                      id="menubar-autohide"
                      className="settings-select"
                      value={menubarMode}
                      onChange={(e) => setMenubarMode(e.target.value)}
                    >
                      {MENUBAR_MODES.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-row-hint">
                    {menubarMode === 'never'
                      ? 'The menu bar always stays at the top of the screen.'
                      : 'While hidden, move the pointer to the top edge of the screen to show it.'}
                  </div>
                </div>
              </div>
            )}

            {/* 3. WALLPAPER TAB */}
            {activeTab === 'wallpaper' && (
              <WallpaperSettings isOpen={isOpen} />
            )}

            {/* 4. MUSIC TAB */}
            {activeTab === 'music' && (
              <div className="settings-tab-pane">
                <div className="settings-group-card">
                  <div className="settings-row">
                    <span className="settings-label">Playback Volume</span>
                    <div className="settings-value" style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '60%' }}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={musicSettings.volume}
                        onChange={(e) => handleMusicSettingChange('volume', parseInt(e.target.value, 10))}
                        style={{ flex: 1 }}
                      />
                      <span style={{ fontSize: '13px', width: '25px', textAlign: 'right' }}>{musicSettings.volume}%</span>
                    </div>
                  </div>
                </div>

                <div className="settings-group-card-title">Preferences</div>
                <div className="settings-group-card">
                  <div className="settings-row">
                    <span className="settings-label">Remember Playback Position</span>
                    <input
                      type="checkbox"
                      className="settings-switch"
                      checked={musicSettings.rememberPlayback}
                      onChange={(e) => handleMusicSettingChange('rememberPlayback', e.target.checked)}
                    />
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">Silent Auto-Reconnect</span>
                    <input
                      type="checkbox"
                      className="settings-switch"
                      checked={musicSettings.silentAutoReconnect}
                      onChange={(e) => handleMusicSettingChange('silentAutoReconnect', e.target.checked)}
                    />
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">Enable Hover Expand</span>
                    <input
                      type="checkbox"
                      className="settings-switch"
                      checked={musicSettings.enableHoverExpand}
                      onChange={(e) => handleMusicSettingChange('enableHoverExpand', e.target.checked)}
                    />
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">Display Lyrics Pane</span>
                    <input
                      type="checkbox"
                      className="settings-switch"
                      checked={musicSettings.displayLyrics}
                      onChange={(e) => handleMusicSettingChange('displayLyrics', e.target.checked)}
                    />
                  </div>
                </div>

                <div className="settings-group-card-title">Music Library Connection</div>
                <div className="settings-group-card">
                  <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
                    <span className="settings-label" style={{ fontWeight: '600' }}>Directory Reconnection</span>
                    <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', margin: 0 }}>
                      If browser security prevents access to your local music directory, reconnect it below:
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginTop: '5px', width: '100%' }}>
                      <span className="settings-value" style={{ fontSize: '13px', color: '#ffb300' }}>
                        {musicFolderName ? `Connected: ${musicFolderName}` : 'Access lost / Folder disconnected'}
                      </span>
                      <button 
                        className="settings-btn settings-btn-primary" 
                        onClick={handleReconnectMusicFolder}
                        style={{ marginLeft: 'auto' }}
                      >
                        Choose Folder
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 5. BOOKMARKS TAB */}
            {activeTab === 'bookmarks' && (
              <div className="settings-tab-pane">
                <div className="settings-group-card-title">Dock Bookmarks ({bookmarks.length})</div>
                <div className="settings-group-card" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                  {bookmarks.map((bm, index) => (
                    <div key={index} className="settings-row">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <img src={bm.favicon} alt="" style={{ width: '16px', height: '16px', borderRadius: '4px' }} />
                        <span className="settings-label" style={{ fontWeight: '500' }}>{bm.websiteName}</span>
                      </div>
                      <a href={bm.url} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: '#0a84ff', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                        {bm.url}
                      </a>
                    </div>
                  ))}
                  {bookmarks.length === 0 && (
                    <div className="settings-row">
                      <span className="settings-label" style={{ color: 'rgba(255,255,255,0.5)' }}>No dock bookmarks.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 6. DATA CONTROLS TAB */}
            {activeTab === 'widgets' && <WidgetsPane onClose={onClose} />}

            {activeTab === 'data_controls' && <DataControlsPane onImportFile={handleImportFileChange} />}

            {/* 7. ABOUT TAB */}
            {activeTab === 'about' && <AboutPane customName={customName} />}

          </div>
        </main>
      </div>

      {/* Import Confirmation Dialog */}
      {showImportConfirm && importMetadata && (
        <div className="settings-dialog-overlay" onClick={() => setShowImportConfirm(false)}>
          <div className="settings-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Replace Existing Data?</h3>
            <p style={{ fontSize: '13px', color: 'rgba(255,255,255,0.7)', marginBottom: '15px' }}>
              Are you sure you want to import this backup? Importing will replace the selected datasets on this browser instance.
            </p>

            <div className="settings-group-card" style={{ marginBottom: '20px', background: 'rgba(255,255,255,0.06)' }}>
              <div className="settings-row">
                <span className="settings-label">Backup Version</span>
                <span className="settings-value">iWeb {importMetadata.version}</span>
              </div>
              <div className="settings-row">
                <span className="settings-label">Created At</span>
                <span className="settings-value">{new Date(importMetadata.createdAt).toLocaleString()}</span>
              </div>
            </div>

            <div className="settings-dialog-modules" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '20px' }}>
              <span style={{ fontSize: '13px', fontWeight: '600' }}>Choose modules to restore:</span>
              {importMetadata.exportedModules.map(mod => (
                <div key={mod} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
                  <input
                    type="checkbox"
                    id={`import-mod-${mod}`}
                    checked={importModules[mod]}
                    onChange={(e) => setImportModules({ ...importModules, [mod]: e.target.checked })}
                  />
                  <label htmlFor={`import-mod-${mod}`}>
                    {mod === 'images' && 'Stored Images & Wallpapers'}
                    {mod === 'bookmarks' && 'Dock & Browser Bookmarks'}
                    {mod === 'music' && 'Music Playlists & Favorites'}
                    {mod === 'notes' && 'Notes Database'}
                  </label>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button 
                className="settings-btn settings-btn-secondary" 
                onClick={() => setShowImportConfirm(false)}
              >
                Cancel
              </button>
              <button 
                className="settings-btn settings-btn-primary" 
                onClick={handleConfirmImport}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
