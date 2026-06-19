import React, { useState, useEffect } from 'react';
import { getSearchPhrase } from '../../libs/search-bar-text';

export const SearchBar = ({ onOpenSearch }) => {
  const [placeholder, setPlaceholder] = useState('Search or type command...');

  useEffect(() => {
    // Initial placeholder
    setPlaceholder(getSearchPhrase() || 'Search or type command...');

    const interval = setInterval(() => {
      setPlaceholder(getSearchPhrase() || 'Search or type command...');
    }, 60000); // Updates every minute

    return () => clearInterval(interval);
  }, []);

  const isMac = typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);

  return (
    <div className="dashboard-search-trigger" onClick={onOpenSearch}>
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
