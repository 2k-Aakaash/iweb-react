import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { db as searchDB } from '../search/db/searchDB';

// Generic Promise-based IndexedDB helpers for notes DB
function getNotesDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iweb-notes-db', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = (e) => resolve(e.target.result);
  });
}

function getAllNotes() {
  return getNotesDB().then((db) => {
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains('notes')) {
        resolve([]);
        return;
      }
      const tx = db.transaction('notes', 'readonly');
      const store = tx.objectStore('notes');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

function restoreNotes(notesArray) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iweb-notes-db', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('notes')) {
        db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('notes', 'readwrite');
      const store = tx.objectStore('notes');
      const clearReq = store.clear();
      clearReq.onerror = () => reject(clearReq.error);
      clearReq.onsuccess = () => {
        if (notesArray.length === 0) {
          resolve();
          return;
        }
        let completed = 0;
        notesArray.forEach((note) => {
          const putReq = store.put(note);
          putReq.onsuccess = () => {
            completed++;
            if (completed === notesArray.length) resolve();
          };
          putReq.onerror = () => reject(putReq.error);
        });
      };
    };
  });
}

// Background images (Wallpapers) helpers
function getBackgroundDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iWebDB', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = (e) => resolve(e.target.result);
  });
}

function getAllBackgrounds() {
  return getBackgroundDB().then((db) => {
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains('background_images')) {
        resolve([]);
        return;
      }
      const tx = db.transaction('background_images', 'readonly');
      const store = tx.objectStore('background_images');
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

function restoreBackgrounds(backgroundsArray) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iWebDB', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('background_images')) {
        db.createObjectStore('background_images', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('background_images', 'readwrite');
      const store = tx.objectStore('background_images');
      const clearReq = store.clear();
      clearReq.onerror = () => reject(clearReq.error);
      clearReq.onsuccess = () => {
        if (backgroundsArray.length === 0) {
          resolve();
          return;
        }
        let completed = 0;
        backgroundsArray.forEach((bg) => {
          const putReq = store.put(bg);
          putReq.onsuccess = () => {
            completed++;
            if (completed === backgroundsArray.length) resolve();
          };
          putReq.onerror = () => reject(putReq.error);
        });
      };
    };
  });
}

// Music player helpers
function getMusicDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iweb-music-player', 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = (e) => resolve(e.target.result);
  });
}

function getMusicStoreData() {
  return getMusicDB().then((db) => {
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains('settings')) {
        resolve({});
        return;
      }
      const tx = db.transaction('settings', 'readonly');
      const store = tx.objectStore('settings');
      const keys = ['tracks-list', 'favorites-list', 'playlists-data', 'music-settings', 'last-played-state', 'directory-handle'];
      const data = {};
      let completed = 0;

      keys.forEach((key) => {
        const getReq = store.get(key);
        getReq.onsuccess = () => {
          data[key] = getReq.result;
          completed++;
          if (completed === keys.length) resolve(data);
        };
        getReq.onerror = () => {
          completed++;
          if (completed === keys.length) resolve(data);
        };
      });
    });
  });
}

function restoreMusicStoreData(musicData) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('iweb-music-player', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction('settings', 'readwrite');
      const store = tx.objectStore('settings');
      const clearReq = store.clear();
      clearReq.onerror = () => reject(clearReq.error);
      clearReq.onsuccess = () => {
        const keys = Object.keys(musicData);
        if (keys.length === 0) {
          resolve();
          return;
        }
        let completed = 0;
        keys.forEach((key) => {
          const putReq = store.put(musicData[key], key);
          putReq.onsuccess = () => {
            completed++;
            if (completed === keys.length) resolve();
          };
          putReq.onerror = () => reject(putReq.error);
        });
      };
    };
  });
}

// MAIN BACKUP AND RESTORE EXPORTS
export async function exportToIwebBackup(selectedModules) {
  const zip = new JSZip();

  // Create version.txt
  zip.file('version.txt', 'iWeb v2.0');

  const exportedModules = [];
  const settingsData = {
    localStorage: {}
  };

  // 1. Always back up core settings
  const coreKeys = ['customName', 'selectedFont', 'weatherLocation', 'lastUsedBackgroundId'];
  coreKeys.forEach((key) => {
    const val = localStorage.getItem(key);
    if (val !== null) {
      settingsData.localStorage[key] = val;
    }
  });

  // 2. Export Stored Images (wallpapers, custom backgrounds, gifs)
  if (selectedModules.images) {
    try {
      const backgrounds = await getAllBackgrounds();
      backgrounds.forEach((bg) => {
        if (bg.blob) {
          // Store background files inside wallpapers/ directory
          zip.file(`wallpapers/bg_${bg.id}`, bg.blob);
        }
      });
      // Save settings for backgrounds (e.g. references to ID)
      settingsData.background_meta = backgrounds.map((bg) => ({
        id: bg.id,
        type: bg.blob ? bg.blob.type : null
      }));
      exportedModules.push('images');
    } catch (err) {
      console.error('Error exporting wallpapers:', err);
    }
  }

  // 3. Export Bookmarks
  if (selectedModules.bookmarks) {
    try {
      const bookmarksData = {
        dock: JSON.parse(localStorage.getItem('bookmarks')) || [],
        browser: await searchDB.bookmarks.toArray()
      };
      zip.file('bookmarks.json', JSON.stringify(bookmarksData, null, 2));
      exportedModules.push('bookmarks');
    } catch (err) {
      console.error('Error exporting bookmarks:', err);
    }
  }

  // 4. Export Music Library metadata (favorites, playlists, settings)
  if (selectedModules.music) {
    try {
      const musicStore = await getMusicStoreData();
      const musicData = {
        favorites: musicStore['favorites-list'] || [],
        playlists: musicStore['playlists-data'] || {},
        settings: musicStore['music-settings'] || {},
        lastPlayed: musicStore['last-played-state'] || null,
        directory: {
          folderName: musicStore['directory-handle'] ? musicStore['directory-handle'].name : 'Music',
          needsReconnect: true
        }
      };

      // Extract tracks list, but strip blobs so they can be saved as separate zip files
      const tracks = musicStore['tracks-list'] || [];
      const serializableTracks = [];
      tracks.forEach((track) => {
        if (track.artworkBlob) {
          zip.file(`music_artwork/art_${track.id}`, track.artworkBlob);
        }
        const { artworkBlob, artwork, file, ...cleanTrack } = track;
        serializableTracks.push(cleanTrack);
      });
      musicData.tracks = serializableTracks;

      zip.file('music.json', JSON.stringify(musicData, null, 2));
      exportedModules.push('music');
    } catch (err) {
      console.error('Error exporting music settings:', err);
    }
  }

  // 5. Export Notes
  if (selectedModules.notes) {
    try {
      const notes = await getAllNotes();
      zip.file('notes.json', JSON.stringify(notes, null, 2));
      exportedModules.push('notes');
    } catch (err) {
      console.error('Error exporting notes:', err);
    }
  }

  // 6. Back up search history / clicks / suggestions (part of user search settings)
  try {
    settingsData.searches = await searchDB.searches.toArray();
    settingsData.suggestions = await searchDB.suggestions.toArray();
    settingsData.clicks = await searchDB.clicks.toArray();
    settingsData.history = await searchDB.history.toArray();
  } catch (err) {
    console.error('Error exporting search database:', err);
  }

  // Save settings.json
  zip.file('settings.json', JSON.stringify(settingsData, null, 2));

  // Build metadata.json
  const metadata = {
    app: 'iWeb',
    version: '2.0',
    createdAt: Date.now(),
    exportedModules
  };
  zip.file('metadata.json', JSON.stringify(metadata, null, 2));

  // Trigger download
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, 'backup.iwebbackup');
}

export async function parseIwebBackup(file) {
  const zip = await JSZip.loadAsync(file);

  // Validate presence of metadata.json
  const metaFile = zip.file('metadata.json');
  if (!metaFile) {
    throw new Error('Invalid backup: metadata.json is missing.');
  }

  const metadata = JSON.parse(await metaFile.async('string'));
  if (metadata.app !== 'iWeb') {
    throw new Error('Invalid backup: App identifier mismatch.');
  }

  return {
    metadata,
    zip
  };
}

export async function restoreFromIwebBackup(zip, metadata, selectedModules) {
  // 1. Read settings.json (always exists)
  const settingsFile = zip.file('settings.json');
  if (settingsFile) {
    try {
      const settingsData = JSON.parse(await settingsFile.async('string'));

      // Restore LocalStorage core values
      if (settingsData.localStorage) {
        Object.keys(settingsData.localStorage).forEach((key) => {
          localStorage.setItem(key, settingsData.localStorage[key]);
        });
      }

      // Restore search history, suggestions, clicks, etc.
      await searchDB.transaction('rw', [searchDB.searches, searchDB.suggestions, searchDB.clicks, searchDB.history], async () => {
        if (settingsData.searches) {
          await searchDB.searches.clear();
          if (settingsData.searches.length) await searchDB.searches.bulkAdd(settingsData.searches);
        }
        if (settingsData.suggestions) {
          await searchDB.suggestions.clear();
          if (settingsData.suggestions.length) await searchDB.suggestions.bulkAdd(settingsData.suggestions);
        }
        if (settingsData.clicks) {
          await searchDB.clicks.clear();
          if (settingsData.clicks.length) await searchDB.clicks.bulkAdd(settingsData.clicks);
        }
        if (settingsData.history) {
          await searchDB.history.clear();
          if (settingsData.history.length) await searchDB.history.bulkAdd(settingsData.history);
        }
      });
    } catch (err) {
      console.error('Failed to restore search/localstorage settings:', err);
    }
  }

  // 2. Restore Wallpapers / Background Images
  if (selectedModules.images && metadata.exportedModules.includes('images')) {
    try {
      const settingsData = JSON.parse(await settingsFile.async('string'));
      const bgMeta = settingsData.background_meta || [];
      const backgrounds = [];

      for (const meta of bgMeta) {
        const fileInZip = zip.file(`wallpapers/bg_${meta.id}`);
        if (fileInZip) {
          const blobData = await fileInZip.async('blob');
          // Re-create the blob with its original mime type if present
          const mimeType = meta.type || blobData.type;
          const typedBlob = new Blob([blobData], { type: mimeType });
          backgrounds.push({
            id: meta.id,
            blob: typedBlob
          });
        }
      }

      await restoreBackgrounds(backgrounds);
    } catch (err) {
      console.error('Failed to restore wallpapers:', err);
    }
  }

  // 3. Restore Bookmarks
  if (selectedModules.bookmarks && metadata.exportedModules.includes('bookmarks')) {
    const bookmarksFile = zip.file('bookmarks.json');
    if (bookmarksFile) {
      try {
        const bookmarksData = JSON.parse(await bookmarksFile.async('string'));

        // Restore Dock bookmarks in LocalStorage
        if (bookmarksData.dock) {
          localStorage.setItem('bookmarks', JSON.stringify(bookmarksData.dock));
        }

        // Restore Browser bookmarks in Dexie searchDB
        if (bookmarksData.browser) {
          await searchDB.transaction('rw', searchDB.bookmarks, async () => {
            await searchDB.bookmarks.clear();
            if (bookmarksData.browser.length) {
              await searchDB.bookmarks.bulkAdd(bookmarksData.browser);
            }
          });
        }
      } catch (err) {
        console.error('Failed to restore bookmarks:', err);
      }
    }
  }

  // 4. Restore Music Settings and Playlists
  if (selectedModules.music && metadata.exportedModules.includes('music')) {
    const musicFile = zip.file('music.json');
    if (musicFile) {
      try {
        const musicData = JSON.parse(await musicFile.async('string'));
        const musicStore = {
          'favorites-list': musicData.favorites || [],
          'playlists-data': musicData.playlists || {},
          'music-settings': musicData.settings || {},
          'last-played-state': musicData.lastPlayed || null,
          'directory-handle': null // Force user reconnection
        };

        // Reconnect artwork blobs
        const tracks = musicData.tracks || [];
        for (const track of tracks) {
          const artFile = zip.file(`music_artwork/art_${track.id}`);
          if (artFile) {
            const artBlob = await artFile.async('blob');
            track.artworkBlob = artBlob;
          }
        }
        musicStore['tracks-list'] = tracks;

        await restoreMusicStoreData(musicStore);
      } catch (err) {
        console.error('Failed to restore music metadata:', err);
      }
    }
  }

  // 5. Restore Notes
  if (selectedModules.notes && metadata.exportedModules.includes('notes')) {
    const notesFile = zip.file('notes.json');
    if (notesFile) {
      try {
        const notes = JSON.parse(await notesFile.async('string'));
        await restoreNotes(notes);
      } catch (err) {
        console.error('Failed to restore notes:', err);
      }
    }
  }
}
