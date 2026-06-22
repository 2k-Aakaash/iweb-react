import React, { useState, useEffect, useRef } from 'react';
import { exportToIwebBackup, parseIwebBackup, restoreFromIwebBackup } from '../libs/backupService';

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
  const [activeTab, setActiveTab] = useState('general');
  const [nameInput, setNameInput] = useState(customName || '');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Data Controls state
  const [exportModules, setExportModules] = useState({
    images: true,
    bookmarks: true,
    music: true,
    notes: true
  });
  
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

  // Background images state (for Wallpaper tab)
  const [wallpapers, setWallpapers] = useState([]);
  const [activeBgId, setActiveBgId] = useState(null);
  const fileInputRef = useRef(null);

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

  // Load Wallpapers and Music settings
  useEffect(() => {
    if (isOpen) {
      loadBackgrounds();
      loadMusicSettings();
    }
  }, [isOpen]);

  const loadBackgrounds = () => {
    const request = indexedDB.open("iWebDB", 1);
    request.onsuccess = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('background_images')) return;
      const tx = db.transaction('background_images', 'readonly');
      const store = tx.objectStore('background_images');
      const req = store.getAll();
      req.onsuccess = (ev) => {
        const records = ev.target.result || [];
        const mapped = records.map(r => ({
          id: r.id,
          url: URL.createObjectURL(r.blob)
        }));
        setWallpapers(mapped);
      };
    };
    const lastUsed = localStorage.getItem('lastUsedBackgroundId');
    if (lastUsed) {
      setActiveBgId(parseInt(lastUsed, 10));
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

  // Upload wallpaper logic
  const handleUploadWallpaper = (e) => {
    const file = e.target.files[0];
    if (file) {
      const request = indexedDB.open("iWebDB", 1);
      request.onsuccess = (ev) => {
        const db = ev.target.result;
        const tx = db.transaction('background_images', 'readwrite');
        const store = tx.objectStore('background_images');
        const addReq = store.add({ blob: file });
        addReq.onsuccess = () => {
          loadBackgrounds();
        };
      };
    }
  };

  // Set active wallpaper
  const handleSetWallpaper = (id, url) => {
    setActiveBgId(id);
    localStorage.setItem('lastUsedBackgroundId', id);
    document.body.style.backgroundImage = `url('${url}')`;
    document.documentElement.style.setProperty('--page-bg-url', `url('${url}')`);
  };

  // Delete wallpaper
  const handleDeleteWallpaper = (id, e) => {
    e.stopPropagation();
    if (window.confirm('Delete this background image?')) {
      const request = indexedDB.open("iWebDB", 1);
      request.onsuccess = (ev) => {
        const db = ev.target.result;
        const tx = db.transaction('background_images', 'readwrite');
        const store = tx.objectStore('background_images');
        const delReq = store.delete(id);
        delReq.onsuccess = () => {
          loadBackgrounds();
          if (activeBgId === id) {
            localStorage.removeItem('lastUsedBackgroundId');
            document.body.style.backgroundImage = '';
            document.documentElement.style.removeProperty('--page-bg-url');
            setActiveBgId(null);
          }
        };
      };
    }
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

  // Export Backups handler
  const handleExportBackup = async () => {
    try {
      await exportToIwebBackup(exportModules);
      alert('Backup file (.iwebbackup) exported successfully.');
    } catch (err) {
      alert(`Export failed: ${err.message}`);
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

  if (!isOpen) return null;

  // Filter tabs for search
  const tabs = [
    { id: 'general', name: 'General', icon: '⚙️' },
    { id: 'appearance', name: 'Appearance', icon: '🎨' },
    { id: 'wallpaper', name: 'Wallpaper', icon: '🖼️' },
    { id: 'music', name: 'Music', icon: '🎵' },
    { id: 'bookmarks', name: 'Bookmarks', icon: '🔖' },
    { id: 'data_controls', name: 'Data Controls', icon: '💾' },
    { id: 'about', name: 'About', icon: 'ℹ️' }
  ];

  const filteredTabs = tabs.filter(tab => 
    tab.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        
        {/* Left Sidebar */}
        <aside className="settings-sidebar">
          {/* Traffic Light Dots */}
          <div className="settings-window-controls">
            <span className="settings-dot settings-dot-close" onClick={onClose}></span>
            <span className="settings-dot settings-dot-minimize"></span>
            <span className="settings-dot settings-dot-maximize"></span>
          </div>

          {/* User Profile widget */}
          <div className="settings-profile-section">
            <div className="settings-profile-avatar">
              {customName ? customName.charAt(0).toUpperCase() : 'iW'}
            </div>
            <div className="settings-profile-info">
              <h3>{customName || 'Apple Account'}</h3>
              <p>Sign in with your Apple Account</p>
            </div>
          </div>

          {/* Search Field */}
          <div className="settings-search-container">
            <input
              type="text"
              className="settings-search-input"
              placeholder="Search Settings"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Sidebar Tabs List */}
          <nav className="settings-sidebar-nav">
            {filteredTabs.map(tab => (
              <button
                key={tab.id}
                className={`settings-sidebar-item ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="settings-tab-icon">{tab.icon}</span>
                <span className="settings-tab-name">{tab.name}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Right Content Pane */}
        <main className="settings-content">
          <div className="settings-content-header">
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

                <div className="settings-group-card-title">Clock Font</div>
                <div className="settings-group-card">
                  {fontOptions.map((font, idx) => (
                    <div
                      key={idx}
                      className="settings-row settings-row-clickable"
                      onClick={() => handleSelectFont(font.family)}
                    >
                      <span className="settings-label">{font.name}</span>
                      {clockFont === font.family && (
                        <span className="settings-check-icon">✓</span>
                      )}
                    </div>
                  ))}
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
              </div>
            )}

            {/* 3. WALLPAPER TAB */}
            {activeTab === 'wallpaper' && (
              <div className="settings-tab-pane">
                <div className="settings-wallpaper-controls">
                  <button 
                    className="settings-btn settings-btn-primary"
                    onClick={() => fileInputRef.current.click()}
                  >
                    Add Wallpaper Image / GIF
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    style={{ display: 'none' }} 
                    accept="image/*"
                    onChange={handleUploadWallpaper}
                  />
                </div>

                <div className="settings-wallpaper-grid">
                  {wallpapers.map((wp) => (
                    <div 
                      key={wp.id} 
                      className={`settings-wallpaper-item ${activeBgId === wp.id ? 'active' : ''}`}
                      onClick={() => handleSetWallpaper(wp.id, wp.url)}
                    >
                      <img src={wp.url} alt="Wallpaper" />
                      <button 
                        className="settings-wallpaper-delete"
                        onClick={(e) => handleDeleteWallpaper(wp.id, e)}
                        title="Delete wallpaper"
                      >
                        &times;
                      </button>
                      {activeBgId === wp.id && (
                        <div className="active-wallpaper-badge">Active</div>
                      )}
                    </div>
                  ))}
                  {wallpapers.length === 0 && (
                    <p className="no-wallpapers-placeholder">No custom wallpapers uploaded yet.</p>
                  )}
                </div>
              </div>
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
            {activeTab === 'data_controls' && (
              <div className="settings-tab-pane">
                <div className="settings-group-card-title">Export Settings</div>
                <div className="settings-group-card">
                  <div className="settings-row">
                    <div className="settings-checkbox-container">
                      <input
                        type="checkbox"
                        id="export-images"
                        checked={exportModules.images}
                        onChange={(e) => setExportModules({ ...exportModules, images: e.target.checked })}
                      />
                      <label htmlFor="export-images">
                        <strong>Stored Images</strong>
                        <p>Includes uploaded custom wallpapers and GIFs.</p>
                      </label>
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-checkbox-container">
                      <input
                        type="checkbox"
                        id="export-bookmarks"
                        checked={exportModules.bookmarks}
                        onChange={(e) => setExportModules({ ...exportModules, bookmarks: e.target.checked })}
                      />
                      <label htmlFor="export-bookmarks">
                        <strong>Bookmarks</strong>
                        <p>Dock bookmarks, browser bookmarks, folders, and icons.</p>
                      </label>
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-checkbox-container">
                      <input
                        type="checkbox"
                        id="export-music"
                        checked={exportModules.music}
                        onChange={(e) => setExportModules({ ...exportModules, music: e.target.checked })}
                      />
                      <label htmlFor="export-music">
                        <strong>Music Library Location</strong>
                        <p>Folder path reference, playlists created, and favorites.</p>
                      </label>
                    </div>
                  </div>

                  <div className="settings-row">
                    <div className="settings-checkbox-container">
                      <input
                        type="checkbox"
                        id="export-notes"
                        checked={exportModules.notes}
                        onChange={(e) => setExportModules({ ...exportModules, notes: e.target.checked })}
                      />
                      <label htmlFor="export-notes">
                        <strong>Notes</strong>
                        <p>Saved notes database records.</p>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="settings-actions-card">
                  <button 
                    className="settings-btn settings-btn-primary" 
                    onClick={handleExportBackup}
                    style={{ flex: 1, padding: '12px' }}
                  >
                    Export Backup (.iwebbackup)
                  </button>

                  <button 
                    className="settings-btn settings-btn-secondary" 
                    onClick={() => document.getElementById('import-file-picker').click()}
                    style={{ flex: 1, padding: '12px' }}
                  >
                    Import Backup
                  </button>
                  <input
                    type="file"
                    id="import-file-picker"
                    style={{ display: 'none' }}
                    accept=".iwebbackup,.zip"
                    onChange={handleImportFileChange}
                  />
                </div>
              </div>
            )}

            {/* 7. ABOUT TAB */}
            {activeTab === 'about' && (
              <div className="settings-tab-pane" style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: '48px', marginBottom: '20px' }}>🌐</div>
                <h3 style={{ fontSize: '24px', margin: '0 0 10px 0', fontFamily: 'SFRounded-Semibold' }}>iWeb</h3>
                <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '14px', margin: '0 0 25px 0' }}>Version: iWeb v2.0</p>
                <div className="settings-group-card" style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'left' }}>
                  <div className="settings-row">
                    <span className="settings-label">Developer</span>
                    <span className="settings-value">2K Aakaash</span>
                  </div>
                  <div className="settings-row">
                    <span className="settings-label">Platform</span>
                    <span className="settings-value">Vite React JS</span>
                  </div>
                </div>
              </div>
            )}

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
