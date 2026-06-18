import React, { useState, useEffect } from 'react';
import { getSearchPhrase } from '../libs/search-bar-text';

export default function Search() {
  const [placeholder, setPlaceholder] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    // Initial placeholder
    setPlaceholder(getSearchPhrase());

    const interval = setInterval(() => {
      setPlaceholder(getSearchPhrase());
    }, 60000); // Updates every minute

    return () => clearInterval(interval);
  }, []);

  const isValidURL = (url) => {
    const urlPattern = /^([a-z]+:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?].*)?$/i;
    return urlPattern.test(url);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const searchTerm = query.trim();
    if (!searchTerm) return;

    if (isValidURL(searchTerm)) {
      window.location.href = `http://${searchTerm}`;
    } else {
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`;
    }
  };

  const handleKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      const searchTerm = query.trim();
      if (searchTerm) {
        window.location.href = `http://${searchTerm}.com`;
      }
    }
  };

  return (
    <div className="search-container">
      <label className="search-bar-text" id="search-label" htmlFor="search-input">
        {placeholder}
      </label>
      <form id="search-form" onSubmit={handleSearchSubmit}>
        <input 
          type="text" 
          id="search-input" 
          autoComplete="on" 
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </form>
    </div>
  );
}
