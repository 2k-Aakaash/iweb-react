import React, { useState, useEffect } from 'react';

const PRESET_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981', 
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'
];

export const Favicon = ({ url, title, className = '', type }) => {
  const [src, setSrc] = useState('');
  const [failedGoogle, setFailedGoogle] = useState(false);
  const [failedDirect, setFailedDirect] = useState(false);

  // Extract domain name
  const getDomainInfo = (targetUrl) => {
    try {
      const parsed = new URL(targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`);
      return {
        origin: parsed.origin,
        hostname: parsed.hostname,
        letter: parsed.hostname.replace('www.', '').charAt(0).toUpperCase()
      };
    } catch {
      return {
        origin: '',
        hostname: '',
        letter: title ? title.charAt(0).toUpperCase() : 'W'
      };
    }
  };

  const domain = getDomainInfo(url);

  useEffect(() => {
    setFailedGoogle(false);
    setFailedDirect(false);

    if (!url || type === 'command') {
      setSrc('');
      return;
    }

    if (domain.origin) {
      // Step 1: Try Google Favicon service
      setSrc(`https://www.google.com/s2/favicons?sz=256&domain_url=${encodeURIComponent(domain.origin)}`);
    } else {
      setSrc('');
    }
  }, [url, type]);

  const handleLoadError = () => {
    if (!failedGoogle && domain.origin) {
      // Step 2: Fallback to direct favicon.ico fetch
      setFailedGoogle(true);
      setSrc(`${domain.origin}/favicon.ico`);
    } else {
      // Step 3: Fallback to Letter Avatar
      setFailedDirect(true);
    }
  };

  // Determine avatar background color from domain name hash
  const getAvatarColor = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % PRESET_COLORS.length;
    return PRESET_COLORS[index];
  };

  // Render direct SVG for command/suggestions if no url exists
  if (!url || type === 'command' || failedDirect) {
    let svgIcon = (
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
    );

    if (title.startsWith('/')) {
      // Command icon
      svgIcon = (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5"></polyline>
          <line x1="12" y1="19" x2="20" y2="19"></line>
        </svg>
      );
    }

    if (failedDirect && url) {
      const bgColor = getAvatarColor(domain.hostname || title);
      return (
        <div 
          className={`search-result-letter-avatar ${className}`}
          style={{ backgroundColor: bgColor }}
        >
          {domain.letter}
        </div>
      );
    }

    return (
      <div className={`search-result-letter-avatar ${className}`} style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}>
        {svgIcon}
      </div>
    );
  }

  return (
    <img 
      src={src} 
      alt="" 
      className={`search-result-favicon ${className}`}
      onError={handleLoadError}
    />
  );
};
