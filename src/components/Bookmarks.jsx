import React, { useState, useEffect, useRef } from 'react';

export default function Bookmarks({ mode, onChangeBg, bookmarks = [], setBookmarks }) {
  const [showBox, setShowBox] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);

  const favoriteBarRef = useRef(null);

  const saveBookmarks = (newBookmarks) => {
    localStorage.setItem('bookmarks', JSON.stringify(newBookmarks));
    if (setBookmarks) {
      setBookmarks(newBookmarks);
    }
  };

  const getWebsiteName = (url) => {
    try {
      const parser = new URL(url);
      const websiteName = parser.hostname;
      return websiteName.replace(/^www\.|\.com$/g, '');
    } catch (e) {
      return url.replace(/^https?:\/\/|www\.|\.com$/g, '');
    }
  };

  const capitalizeWords = (str) => {
    return str.replace(/\b\w/g, (char) => char.toUpperCase());
  };

  const addBookmark = () => {
    let input = urlInput.trim();
    if (!input) {
      alert('Please enter a valid URL.');
      return;
    }

    if (!/^((ftp|http|https):\/\/|www\.)[^ "]+$/.test(input)) {
      input = "https://www." + input + ".com";
    }

    if (/^(.*\.)?[a-z0-9-]+\.[a-z]+(\.[a-z]+)?$/i.test(input) && !/\.[a-z]+$/.test(input)) {
      input += ".com";
    }

    const specialDomains = ["mail.google.com", "drive.google.com", "chat.openai.com", "photos.google.com", "web.whatsapp.com"];
    const parsedDomain = getWebsiteName(input);
    if (specialDomains.includes(parsedDomain)) {
      input = "https://" + parsedDomain;
    }

    const websiteName = capitalizeWords(getWebsiteName(input));
    const favicon = 'https://s2.googleusercontent.com/s2/favicons?domain=' + input + '&sz=128';
    const maxOrder = bookmarks.length > 0 ? Math.max(...bookmarks.map(b => b.order || 0)) : 0;

    const newB = {
      url: input,
      favicon,
      websiteName,
      order: maxOrder + 1
    };

    const updated = [...bookmarks, newB];
    saveBookmarks(updated);
    setUrlInput('');
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addBookmark();
    }
  };

  const toggleBox = () => {
    setShowBox(!showBox);
  };

  const handleToggleDeleteMode = () => {
    if (deleteMode) {
      setSelectedForDelete([]);
    }
    setDeleteMode(!deleteMode);
  };

  const handleCheckboxChange = (name) => {
    if (selectedForDelete.includes(name)) {
      setSelectedForDelete(selectedForDelete.filter(item => item !== name));
    } else {
      setSelectedForDelete([...selectedForDelete, name]);
    }
  };

  const confirmDelete = () => {
    if (selectedForDelete.length === 0) {
      alert('No bookmarks selected.');
      return;
    }

    const isSingular = selectedForDelete.length === 1;
    const msg = isSingular
      ? 'Are you sure you want to delete the selected link? This action cannot be undone.'
      : 'Are you sure you want to delete the selected links? This action cannot be undone.';

    if (window.confirm(msg)) {
      const updated = bookmarks.filter(b => !selectedForDelete.includes(b.websiteName));
      saveBookmarks(updated);
      setSelectedForDelete([]);
      setDeleteMode(false);
    }
  };

  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.target.parentNode);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const items = [...bookmarks];
    const draggedItem = items[draggedIndex];
    items.splice(draggedIndex, 1);
    items.splice(index, 0, draggedItem);

    const updated = items.map((b, idx) => ({ ...b, order: idx }));
    setDraggedIndex(index);
    setBookmarks(updated);
  };

  const handleDragEnd = () => {
    saveBookmarks(bookmarks);
    setDraggedIndex(null);
  };

  const handleBookmarkClick = (e, url) => {
    if (deleteMode || dragActive) {
      e.preventDefault();
      return;
    }
    window.open(url, '_blank');
  };

  useEffect(() => {
    const clickOutside = (e) => {
      const boxEl = document.getElementById('box');
      const btnEl = document.getElementById('linksButton');
      if (boxEl && !boxEl.contains(e.target) && btnEl && !btnEl.contains(e.target)) {
        setShowBox(false);
      }
    };
    window.addEventListener('click', clickOutside);
    return () => window.removeEventListener('click', clickOutside);
  }, []);

  useEffect(() => {
    const bar = favoriteBarRef.current;
    if (!bar) return;

    let targetScrollLeft = bar.scrollLeft;
    let isAnimating = false;

    const smoothScroll = () => {
      const distance = targetScrollLeft - bar.scrollLeft;
      if (Math.abs(distance) < 1) {
        isAnimating = false;
        return;
      }
      bar.scrollLeft += distance * 0.2;
      requestAnimationFrame(smoothScroll);
    };

    const handleWheel = (e) => {
      e.preventDefault();
      targetScrollLeft += e.deltaY;
      targetScrollLeft = Math.max(0, Math.min(targetScrollLeft, bar.scrollWidth - bar.clientWidth));

      if (!isAnimating) {
        isAnimating = true;
        requestAnimationFrame(smoothScroll);
      }
    };

    bar.addEventListener('wheel', handleWheel, { passive: false });
    return () => bar.removeEventListener('wheel', handleWheel);
  }, [bookmarks]);

  if (mode === 'bar') {
    return (
      <div className="favorite-links-container" ref={favoriteBarRef}>
        <div className="favorite-links-bar" id="favorite-links-bar">
          {bookmarks.map((b, idx) => (
            <a key={idx} href={b.url} className="favorite-link" target="_blank" rel="noreferrer">
              <img src={b.favicon} alt="Favicon" />
              <div>{b.websiteName}</div>
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="links-container">
      <button id="linksButton" className="link-button" onClick={toggleBox}>
        Links
      </button>
      <button className="change-bg" onClick={onChangeBg}>
        Change BG
      </button>

      <div 
        id="box" 
        className="box" 
        style={{ display: showBox ? 'block' : 'none' }}
      >
        <div className="bookmark-input-container">
          <input 
            type="text" 
            id="bookmark-input" 
            className="link-input"
            placeholder="Enter URL"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          <button id="addBookmarkButton" className="add-bookmark" onClick={addBookmark}>
            +
          </button>
        </div>

        <div className="links-text-container">
          {bookmarks.map((b, index) => (
            <div 
              key={index} 
              className={`bookmark-container ${deleteMode ? 'delete-mode' : ''} ${draggedIndex === index ? 'dragged' : ''}`}
              draggable={dragActive}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onClick={(e) => handleBookmarkClick(e, b.url)}
              style={{ cursor: dragActive ? 'grab' : 'pointer' }}
            >
              {dragActive && <span className="equals-symbol">=</span>}
              {deleteMode && (
                <input 
                  type="checkbox" 
                  id={b.websiteName} 
                  checked={selectedForDelete.includes(b.websiteName)}
                  onChange={() => handleCheckboxChange(b.websiteName)}
                  onClick={(e) => e.stopPropagation()}
                />
              )}
              <img src={b.favicon} alt="Favicon" />
              <a href={b.url} target="_blank" rel="noreferrer" onClick={(e) => e.preventDefault()}>
                {b.websiteName}
              </a>
            </div>
          ))}
        </div>

        <button 
          id="drag-n-drop-button" 
          className="drag-n-drop-button"
          onClick={() => {
            setDragActive(!dragActive);
            setDeleteMode(false);
          }}
        >
          {dragActive ? 'Lock Order' : "Drag 'n Drop"}
        </button>
        <button id="delete-links-button" onClick={handleToggleDeleteMode}>
          {deleteMode ? 'Exit Delete Mode' : 'Delete Links'}
        </button>
        {deleteMode && (
          <button 
            id="confirm-delete-button" 
            className="delete-button"
            onClick={confirmDelete}
            style={{ display: 'block' }}
          >
            Confirm Delete
          </button>
        )}
      </div>
    </div>
  );
}
