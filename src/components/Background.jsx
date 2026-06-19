import React, { useState, useEffect, useRef } from 'react';
import Vibrant from '../libs/vibrant';

const dbName = "iWebDB";
const dbVersion = 1;
const storeName = "background_images";

export default function Background({ 
  onChangeName, 
  onChangeFont, 
  onClockColorChange,
  customName,
  clockFont,
  onChangeBgRef,
  onChangeBgUploadRef,
  onOpenMusicLibrary
}) {
  const [backgrounds, setBackgrounds] = useState([]);
  const [dbIds, setDbIds] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showCustomization, setShowCustomization] = useState(false);
  const [showFontBox, setShowFontBox] = useState(false);
  const [showNameInput, setShowNameInput] = useState(false);
  const [nameInputValue, setNameInputValue] = useState('');
  const [showRemoveBgOverlay, setShowRemoveBgOverlay] = useState(false);
  const [selectedToDelete, setSelectedToDelete] = useState([]);
  
  const fileInputRef = useRef(null);
  const dbRef = useRef(null);

  const changeBackgroundManually = () => {
    if (backgrounds.length === 0) return;
    const nextIdx = (currentIndex + 1) % backgrounds.length;
    setCurrentIndex(nextIdx);
    applyBackground(backgrounds[nextIdx]);
    localStorage.setItem('lastUsedBackgroundId', dbIds[nextIdx]);
  };

  useEffect(() => {
    if (onChangeBgRef) {
      onChangeBgRef.current = changeBackgroundManually;
    }
  }, [backgrounds, currentIndex, dbIds]);

  // Expose file upload trigger to parent (for dock Change BG button)
  useEffect(() => {
    if (onChangeBgUploadRef) {
      onChangeBgUploadRef.current = () => {
        if (fileInputRef.current) fileInputRef.current.click();
      };
    }
  }, [onChangeBgUploadRef]);

  // Initialize IndexedDB and migrate legacy base64 data
  useEffect(() => {
    const request = indexedDB.open(dbName, dbVersion);

    request.onerror = (e) => {
      console.error("IndexedDB error:", e.target.error);
    };

    request.onsuccess = (e) => {
      const db = e.target.result;
      dbRef.current = db;
      
      // Check legacy migration
      const legacyData = localStorage.getItem('backgroundImages');
      if (legacyData) {
        try {
          const legacyImages = JSON.parse(legacyData);
          if (Array.isArray(legacyImages) && legacyImages.length > 0) {
            console.log(`Migrating ${legacyImages.length} legacy images to IndexedDB...`);
            const transaction = db.transaction([storeName], "readwrite");
            const store = transaction.objectStore(storeName);
            
            let count = 0;
            legacyImages.forEach((dataurl) => {
              const blob = dataURLtoBlob(dataurl);
              if (blob) {
                const req = store.add({ blob });
                req.onsuccess = () => {
                  count++;
                  if (count === legacyImages.length) {
                    localStorage.removeItem('backgroundImages');
                    loadBackgrounds(db);
                  }
                };
              } else {
                count++;
                if (count === legacyImages.length) {
                  localStorage.removeItem('backgroundImages');
                  loadBackgrounds(db);
                }
              }
            });
            return;
          }
        } catch (err) {
          console.error("Failed legacy migration:", err);
        }
        localStorage.removeItem('backgroundImages');
      }

      loadBackgrounds(db);
    };

    request.onupgradeneeded = (e) => {
      const dbInstance = e.target.result;
      if (!dbInstance.objectStoreNames.contains(storeName)) {
        dbInstance.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
      }
    };
  }, []);

  const dataURLtoBlob = (dataurl) => {
    try {
      const arr = dataurl.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch (e) {
      console.error("Failed base64 conversion", e);
      return null;
    }
  };

  const loadBackgrounds = (db) => {
    if (!db) return;
    const transaction = db.transaction([storeName], "readonly");
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = (e) => {
      const records = e.target.result || [];
      const urls = [];
      const ids = [];
      records.forEach((r) => {
        if (r.blob) {
          urls.push(URL.createObjectURL(r.blob));
          ids.push(r.id);
        }
      });

      setBackgrounds(urls);
      setDbIds(ids);

      // Restore last used
      const lastUsedIdStr = localStorage.getItem('lastUsedBackgroundId');
      let idx = -1;
      if (lastUsedIdStr && ids.length > 0) {
        const lastUsedId = parseInt(lastUsedIdStr, 10);
        idx = ids.indexOf(lastUsedId);
      }

      if (idx === -1 && urls.length > 0) {
        idx = 0;
        localStorage.setItem('lastUsedBackgroundId', ids[0]);
      }

      if (idx >= 0) {
        setCurrentIndex(idx);
        applyBackground(urls[idx]);
      } else if (urls.length === 0) {
        // Fallback default premium landscape wallpaper so blur always has something to render on initial run
        const defaultBg = "https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?q=80&w=2560";
        applyBackground(defaultBg);
      }
    };
  };

  const applyBackground = (url) => {
    document.body.style.backgroundImage = `url('${url}')`;
    // Set CSS var so ::before fake-blur layers (extension-safe glass) can reference the same image
    document.documentElement.style.setProperty('--page-bg-url', `url('${url}')`);
    extractAverageColor(url);
  };

  const extractAverageColor = (imagePath) => {
    const img = new Image();
    if (imagePath && !imagePath.startsWith('blob:') && !imagePath.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      try {
        const vibrant = new Vibrant(img);
        const swatches = vibrant.swatches();
        const dominantColor = swatches['Vibrant'] || swatches['Muted'] || swatches['DarkVibrant'] || swatches['DarkMuted'] || swatches['LightVibrant'] || swatches['LightMuted'];
        if (dominantColor) {
          onClockColorChange(dominantColor.getHex());
        }
      } catch (err) {
        console.error("Vibrant error:", err);
      }
    };
    img.src = imagePath;
  };

  const handleCustomBgClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.type.match('image/jpeg') || file.type.match('image/png') || file.type.match('image/gif')) {
        const db = dbRef.current;
        if (!db) {
          alert('Database not ready');
          return;
        }

        const transaction = db.transaction([storeName], "readwrite");
        const store = transaction.objectStore(storeName);
        const request = store.add({ blob: file });

        request.onsuccess = (event) => {
          const newId = event.target.result;
          const url = URL.createObjectURL(file);
          
          const newBgs = [...backgrounds, url];
          const newIds = [...dbIds, newId];

          setBackgrounds(newBgs);
          setDbIds(newIds);

          const idx = newBgs.length - 1;
          setCurrentIndex(idx);
          applyBackground(url);
          localStorage.setItem('lastUsedBackgroundId', newId);
        };

        request.onerror = (event) => {
          alert('Failed to save background image: ' + event.target.error);
        };
      } else {
        alert('Invalid file format. Please select an image (jpg, jpeg, png, or gif).');
      }
    }
  };


  // Fonts Options from SVG files
  const fontOptions = [
    { name: "New York Extra Large Heavy", family: "new_york_extra_largeheavy", svg: "images/svg/12.svg" },
    { name: "SF-Pro Rails", family: "SF-Pro Rails", svg: "images/svg/12-2.svg" },
    { name: "SF Pro Stencil Regular", family: "sf_pro_-_stencilregular", svg: "images/svg/12-1.svg" },
    { name: "SF Pro Display Heavy", family: "SFProDisplay-Heavy", svg: "images/svg/12-3.svg" },
  ];

  const handleFontSelect = (family) => {
    onChangeFont(family);
    localStorage.setItem('selectedFont', family);
    setShowFontBox(false);
  };

  const handleNameSave = (e) => {
    if (e.key === 'Enter') {
      const val = nameInputValue.trim();
      if (val) {
        onChangeName(val);
        localStorage.setItem('customName', val);
      }
      setShowNameInput(false);
    }
  };

  const openRemoveBgOverlay = () => {
    setSelectedToDelete([]);
    setShowRemoveBgOverlay(true);
  };

  const closeRemoveBgOverlay = () => {
    setShowRemoveBgOverlay(false);
  };

  const handleToggleSelectDelete = (index) => {
    if (selectedToDelete.includes(index)) {
      setSelectedToDelete(selectedToDelete.filter(i => i !== index));
    } else {
      setSelectedToDelete([...selectedToDelete, index]);
    }
  };

  const handleDeleteSelectedBgs = () => {
    if (selectedToDelete.length === 0) {
      alert('Please select at least one image to delete.');
      return;
    }

    const confirmDelete = window.confirm(
      "Are you sure you want to delete selected images that won't be retrieved in the future?"
    );

    if (confirmDelete) {
      const db = dbRef.current;
      if (!db) return;

      const transaction = db.transaction([storeName], "readwrite");
      const store = transaction.objectStore(storeName);

      // Sort selected indices descending so splicing indices doesn't break
      const sortedSelected = [...selectedToDelete].sort((a, b) => b - a);
      const remainingBgs = [...backgrounds];
      const remainingIds = [...dbIds];

      sortedSelected.forEach((index) => {
        const id = dbIds[index];
        store.delete(id);

        // Revoke URL to free memory
        if (backgrounds[index] && backgrounds[index].startsWith('blob:')) {
          URL.revokeObjectURL(backgrounds[index]);
        }

        remainingBgs.splice(index, 1);
        remainingIds.splice(index, 1);
      });

      transaction.oncomplete = () => {
        setBackgrounds(remainingBgs);
        setDbIds(remainingIds);
        setShowRemoveBgOverlay(false);

        // Adjust active index
        if (remainingBgs.length === 0) {
          localStorage.removeItem('lastUsedBackgroundId');
          document.body.style.backgroundImage = '';
          document.documentElement.style.removeProperty('--page-bg-url');
          onClockColorChange(''); // Reset color
          setCurrentIndex(0);
        } else {
          let nextIdx = currentIndex;
          if (nextIdx >= remainingBgs.length) {
            nextIdx = 0;
          }
          setCurrentIndex(nextIdx);
          applyBackground(remainingBgs[nextIdx]);
          localStorage.setItem('lastUsedBackgroundId', remainingIds[nextIdx]);
        }
      };
    }
  };

  // Close customizations when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      const customBox = document.getElementById('font-box-container');
      const customBtn = document.getElementById('customization-button');
      if (customBox && !customBox.contains(e.target) && customBtn && !customBtn.contains(e.target)) {
        setShowCustomization(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  return (
    <>
      <div className="bottom-left-corner">
        <button 
          id="customization-button" 
          className="custom-button"
          style={{ display: showCustomization ? 'none' : 'block' }}
          onClick={() => setShowCustomization(!showCustomization)}
        >
          Customization ✨
        </button>

        <div 
          id="font-box-container" 
          className={`font-container ${showCustomization ? '' : 'hidden'}`}
        >
          <button id="bgButton" className="bg-button" onClick={handleCustomBgClick}>
            Custom BG
          </button>
          <input 
            type="file" 
            id="fileInput" 
            accept=".jpg, .jpeg, .png, .gif" 
            style={{ display: 'none' }}
            ref={fileInputRef}
            onChange={handleFileChange}
          />

          <button 
            id="custom-name-btn" 
            className="custom-name-button"
            onClick={() => {
              setShowNameInput(!showNameInput);
              setNameInputValue(customName || '');
            }}
          >
            Custom Name
          </button>

          <button id="remove-bg-button" className="remove-bg-button" onClick={openRemoveBgOverlay}>
            Remove BG
          </button>

          <button 
            id="fontButton" 
            className="custom-font-button"
            onClick={() => setShowFontBox(!showFontBox)}
          >
            Custom Font
          </button>

          <button 
            id="musicLibraryButton" 
            className="music-library-button"
            onClick={onOpenMusicLibrary}
          >
            Music Library
          </button>

          <div 
            id="fontBox" 
            className="box-container" 
            style={{ display: showFontBox ? 'block' : 'none' }}
          >
            {fontOptions.map((font, idx) => (
              <img 
                key={idx}
                src={font.svg} 
                className={`font-option ${clockFont === font.family ? 'selected-font' : ''}`}
                data-font-family={font.family}
                alt={font.name}
                onClick={() => handleFontSelect(font.family)}
              />
            ))}
          </div>

          <div 
            className={`input-container ${showNameInput ? 'show-input' : ''}`} 
            id="input-container"
          >
            <input 
              type="text" 
              id="name-input" 
              placeholder="Enter your name"
              value={nameInputValue}
              onChange={(e) => setNameInputValue(e.target.value)}
              onKeyUp={handleNameSave}
            />
          </div>
        </div>
      </div>

      {/* Remove BG Overlay Modal */}
      <div 
        id="remove-bg-window" 
        className="remove-bg-window"
        style={{ display: showRemoveBgOverlay ? 'block' : 'none' }}
      >
        <div className="remove-bg-content" style={{ position: 'relative' }}>
          <div className="window-controls">
            <span className="window-dot dot-close" onClick={closeRemoveBgOverlay}></span>
            <span className="window-dot dot-minimize"></span>
            <span className="window-dot dot-maximize"></span>
          </div>
          <div className="navbar" style={{ paddingTop: '20px' }}>
            <p className="navbar-text">Remove Background Images</p>
            <button 
              id="delete-bg-button" 
              className="delete-button"
              onClick={handleDeleteSelectedBgs}
            >
              Delete Selected
            </button>
          </div>

          <div className="image-grid">
            {backgrounds.map((bg, idx) => (
              <div key={idx} className="image-item">
                <input 
                  type="checkbox" 
                  id={`image-checkbox-${idx}`}
                  checked={selectedToDelete.includes(idx)}
                  onChange={() => handleToggleSelectDelete(idx)}
                />
                <img src={bg} alt={`Saved Background ${idx + 1}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
