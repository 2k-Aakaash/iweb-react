import React, { useState, useEffect } from 'react';
import GlassSurface from '../../components/glass/GlassSurface';

// The day's phrase comes from a long list (search-bar-text.js) that loads after the desktop
// is up; the last one shown is kept, so the bar has its phrase on the first frame.
const FALLBACK = 'Search or type command...';
const PHRASE_KEY = 'iweb:searchPhrase';

function cachedPhrase() {
  try {
    return localStorage.getItem(PHRASE_KEY) || FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export const SearchBar = ({ onOpenSearch }) => {
  const [placeholder, setPlaceholder] = useState(cachedPhrase);

  useEffect(() => {
    let interval = 0;
    let cancelled = false;
    import('../../libs/search-bar-text').then(({ getSearchPhrase }) => {
      if (cancelled) return;
      const update = () => {
        const phrase = getSearchPhrase() || FALLBACK;
        setPlaceholder(phrase);
        try {
          localStorage.setItem(PHRASE_KEY, phrase);
        } catch {
          // Not kept: the next tab shows the fallback until the list loads.
        }
      };
      update();
      interval = setInterval(update, 60000); // Updates every minute
    }).catch(() => {});

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

  return (
    <div className="dashboard-search-trigger glass-host" onClick={onOpenSearch}>
      <GlassSurface preset="bar" />
      <div className="dashboard-search-trigger-left">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <span>{placeholder}</span>
      </div>
      <kbd className="dashboard-search-trigger-kbd">
        {isMac ? '⌘K' : 'Ctrl+K'}
      </kbd>
    </div>
  );
};
