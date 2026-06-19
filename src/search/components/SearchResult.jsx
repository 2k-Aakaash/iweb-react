import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { List } from 'react-window';
import { useSearch } from '../hooks/useSearch';
import { Favicon } from './Favicon';
import '../styles/search.css';

export const SearchResult = ({ isOpen, onClose }) => {
  const {
    query,
    setQuery,
    suggestions,
    results,
    isLoading,
    recordClick,
    clearHistory
  } = useSearch();

  const [activeTab, setActiveTab] = useState('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Combine suggestions and results for keyboard navigation when in 'all' tab
  const activeItems = useMemo(() => {
    if (query.trim() === '') {
      return suggestions;
    }
    return results;
  }, [query, suggestions, results]);

  // Keep selected index bounded
  useEffect(() => {
    setSelectedIndex(0);
    if (listRef.current) {
      listRef.current.scrollToRow({ index: 0 });
    }
  }, [activeItems, query]);

  // Keyboard navigation handler
  const handleKeyDown = (e) => {
    if (activeTab !== 'all') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = prev + 1 >= activeItems.length ? 0 : prev + 1;
        listRef.current?.scrollToRow({ index: next, align: 'smart' });
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = prev - 1 < 0 ? activeItems.length - 1 : prev - 1;
        listRef.current?.scrollToRow({ index: next, align: 'smart' });
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeItems[selectedIndex]) {
        handleItemClick(activeItems[selectedIndex], selectedIndex);
      } else if (query.trim()) {
        // Direct search
        window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`, '_blank');
      }
    } else if (e.key === 'Tab') {
      // Rotate tabs
      e.preventDefault();
      const tabs = ['all', 'images', 'videos', 'reddit', 'maps', 'settings'];
      const nextIndex = (tabs.indexOf(activeTab) + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
      setActiveTab(tabs[nextIndex]);
    }
  };

  // Perform action on item select
  const handleItemClick = async (item, index) => {
    // Record click analytics
    await recordClick(query, item, index);

    if (item.type === 'command') {
      if (item.title.startsWith('/')) {
        // Handle local slash command
        const cmd = item.title.trim();
        if (cmd === '/music') {
          window.dispatchEvent(new CustomEvent('music:open'));
          onClose();
        } else if (cmd === '/settings') {
          window.dispatchEvent(new CustomEvent('music:openSettings'));
          onClose();
        } else if (cmd === '/notes') {
          const notesBtn = document.querySelector('.dock-icon[title="Notes"]');
          notesBtn?.click();
          onClose();
        } else if (cmd === '/weather') {
          const weatherWidget = document.querySelector('.weather-container');
          weatherWidget?.click();
          onClose();
        } else if (cmd === '/help') {
          setActiveTab('settings');
        }
      } else {
        // Text search suggestion: populate search input
        setQuery(item.title);
      }
    } else if (item.url) {
      // Navigate to URL
      window.open(item.url.startsWith('http') ? item.url : `https://${item.url}`, '_blank');
      onClose();
    }
  };

  // Focus input on mount
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setActiveTab('all');
    }
  }, [isOpen]);

  // Highlights text matching query
  const HighlightText = ({ text, highlight }) => {
    if (!highlight.trim()) return <span>{text}</span>;
    const regex = new RegExp(`(${highlight.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return (
      <span>
        {parts.map((part, i) => 
          regex.test(part) ? (
            <span key={i} className="search-highlight">{part}</span>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  // Virtualized row renderer for react-window
  const VirtualRow = ({ index, style }) => {
    const item = activeItems[index];
    if (!item) return null;

    const isSelected = index === selectedIndex;
    const formatTime = (ts) => {
      if (!ts) return '';
      const diff = Date.now() - ts;
      const hours = Math.floor(diff / (1000 * 60 * 60));
      if (hours < 1) return 'Just now';
      if (hours < 24) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    };

    return (
      <div style={style}>
        <div 
          className={`search-result-row ${isSelected ? 'selected' : ''}`}
          onClick={() => handleItemClick(item, index)}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <div className="search-result-favicon-container">
            <Favicon url={item.url} title={item.title} type={item.type} />
          </div>
          <div className="search-result-details">
            <div className="search-result-title">
              <HighlightText text={item.title} highlight={query} />
            </div>
            {item.url && (
              <div className="search-result-url">
                <HighlightText text={item.url} highlight={query} />
              </div>
            )}
          </div>
          {item.type && (
            <span className={`search-result-badge ${item.type}`}>
              {item.type === 'typesense' ? 'semantic' : item.type}
            </span>
          )}
          {item.visitCount !== undefined && item.visitCount > 0 && (
            <div className="search-result-meta-info">
              <span>📈 {item.visitCount} visits</span>
              {item.lastVisit && <span>• {formatTime(item.lastVisit)}</span>}
            </div>
          )}
          {item.folder && (
            <div className="search-result-meta-info">
              <span>📂 {item.folder}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Mock search engine data generators based on query
  const mockImages = useMemo(() => {
    const term = query.trim() || 'beautiful';
    const categories = ['nature', 'tech', 'city', 'space', 'music', 'food', 'car'];
    const matchedCategory = categories.find(cat => term.toLowerCase().includes(cat)) || 'abstract';
    
    return Array.from({ length: 12 }).map((_, i) => ({
      id: `img-${i}`,
      title: `${term.charAt(0).toUpperCase() + term.slice(1)} Inspiration ${i + 1}`,
      domain: `${term.toLowerCase()}.com`,
      url: `https://images.unsplash.com/photo-${[
        '1506744038136-46273834b3fb', '1511512578047-dfb367046420',
        '1477959858617-67f85cf4f1df', '1451187580459-43490279c0fa',
        '1511671782779-c97d3d27a1d4', '1498837167922-ddd27525d352',
        '1503376780353-7e6692767b70'
      ][i % 7]}?w=300&auto=format&fit=crop&q=80`
    }));
  }, [query]);

  const mockVideos = useMemo(() => {
    const term = query.trim() || 'trending';
    const videosList = [
      { title: `How to build ${term} in 10 minutes`, dur: '10:45', author: 'CodeAcademy', views: '234K', age: '1 month ago', img: '1511512578047-dfb367046420' },
      { title: `Why ${term} is changing everything`, dur: '18:12', author: 'Tech Insider', views: '1.2M', age: '3 days ago', img: '1451187580459-43490279c0fa' },
      { title: `Everything about ${term} explained for beginners`, dur: '24:50', author: 'Web Developer Simplified', views: '870K', age: '2 weeks ago', img: '1506744038136-46273834b3fb' },
      { title: `Advanced ${term} tips and tricks you should know`, dur: '15:20', author: 'ProCoder', views: '95K', age: '5 months ago', img: '1477959858617-67f85cf4f1df' },
      { title: `${term} crash course for 2026`, dur: '1:05:30', author: 'FreeCodeCamp', views: '3M', age: '6 months ago', img: '1511671782779-c97d3d27a1d4' },
      { title: `Top 5 ${term} library tools you MUST try`, dur: '12:05', author: 'TechStack', views: '142K', age: '3 weeks ago', img: '1498837167922-ddd27525d352' }
    ];
    return videosList.map((v, i) => ({
      id: `vid-${i}`,
      title: v.title,
      duration: v.dur,
      author: v.author,
      views: v.views,
      age: v.age,
      url: `https://images.unsplash.com/photo-${v.img}?w=400&auto=format&fit=crop&q=80`
    }));
  }, [query]);

  const mockReddit = useMemo(() => {
    const term = query.trim() || 'popular';
    const subreddits = ['reactjs', 'javascript', 'webdev', 'technology', 'AskReddit', 'music'];
    return Array.from({ length: 6 }).map((_, i) => ({
      id: `reddit-${i}`,
      subreddit: `r/${subreddits[i % subreddits.length]}`,
      author: `u/dev_expert_${i + 1}`,
      title: `[Discussion] What is the best way to handle ${term} in a frontend application?`,
      upvotes: `${120 + i * 45}`,
      comments: `${34 + i * 12}`,
      timeAgo: `${i + 1}h ago`
    }));
  }, [query]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onClose}>
      <AnimatePresence>
        {isOpen && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div 
                className="search-modal-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                <Dialog.Content asChild>
                  <motion.div 
                    className="search-modal-content"
                    initial={{ scale: 0.95, y: 15, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    exit={{ scale: 0.95, y: 15, opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                    onKeyDown={handleKeyDown}
                  >
                    {/* Search Bar Input */}
                    <div className="search-input-wrapper">
                      <div className="search-icon-left">
                        {isLoading ? (
                          <svg className="animate-spin" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12"></circle>
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          </svg>
                        )}
                      </div>
                      <input 
                        ref={inputRef}
                        type="text" 
                        className="search-input-field"
                        placeholder="Search browser history, bookmarks, or type command (/music, /settings, /notes)..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query && (
                        <button className="search-clear-btn" onClick={() => setQuery('')}>
                          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      )}
                      <button className="search-close-btn" onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </button>
                      <div className="search-hotkey-hint">ESC</div>
                    </div>

                    {/* Tabs bar */}
                    <div className="search-tabs-list">
                      {['all', 'images', 'videos', 'reddit', 'maps', 'settings'].map((tab) => (
                        <button
                          key={tab}
                          className={`search-tab-trigger ${activeTab === tab ? 'active' : ''}`}
                          onClick={() => setActiveTab(tab)}
                        >
                          {tab === 'all' && '🌐 All'}
                          {tab === 'images' && '🖼️ Images'}
                          {tab === 'videos' && '🎥 Videos'}
                          {tab === 'reddit' && '💬 Reddit'}
                          {tab === 'maps' && '🗺️ Maps'}
                          {tab === 'settings' && '⚙️ Settings'}
                          
                          {activeTab === tab && (
                            <motion.div 
                              className="search-tab-active-indicator" 
                              layoutId="activeTabIndicator"
                            />
                          )}
                        </button>
                      ))}
                    </div>

                    {/* Results Container Panel */}
                    <div className="search-results-panel">
                      {activeTab === 'all' && (
                        activeItems.length > 0 ? (
                          <List
                            listRef={listRef}
                            height={Math.min(activeItems.length * 60, 480)}
                            rowCount={activeItems.length}
                            rowHeight={60}
                            width="100%"
                            rowComponent={VirtualRow}
                            rowProps={{}}
                          />
                        ) : (
                          <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(255,255,255,0.4)' }}>
                            <p style={{ fontSize: '15px' }}>No matches found inside history or bookmarks.</p>
                            <p style={{ fontSize: '12px', marginTop: '6px' }}>Press Enter to search Web for "{query}"</p>
                          </div>
                        )
                      )}

                      {activeTab === 'images' && (
                        <div className="search-image-grid">
                          {mockImages.map((img) => (
                            <div 
                              key={img.id} 
                              className="search-image-card"
                              onClick={() => window.open(img.url, '_blank')}
                            >
                              <img src={img.url} className="search-image-thumb" alt={img.title} loading="lazy" />
                              <div className="search-image-info">
                                <div className="search-image-title">{img.title}</div>
                                <div className="search-image-domain">{img.domain}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeTab === 'videos' && (
                        <div className="search-video-grid">
                          {mockVideos.map((vid) => (
                            <div 
                              key={vid.id} 
                              className="search-video-card"
                              onClick={() => window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, '_blank')}
                            >
                              <div className="search-video-thumb-container">
                                <img src={vid.url} className="search-video-thumb" alt="" loading="lazy" />
                                <span className="search-video-duration">{vid.duration}</span>
                                <div className="search-video-play-overlay">
                                  <svg viewBox="0 0 24 24" width="36" height="36" fill="currentColor" color="#ffffff">
                                    <path d="M8 5v14l11-7z"></path>
                                  </svg>
                                </div>
                              </div>
                              <div className="search-video-info">
                                <div className="search-video-title">{vid.title}</div>
                                <div className="search-video-meta">
                                  <span>{vid.author}</span> • <span>{vid.views} views</span> • <span>{vid.age}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeTab === 'reddit' && (
                        <div className="search-reddit-list">
                          {mockReddit.map((post) => (
                            <div 
                              key={post.id} 
                              className="search-reddit-card"
                              onClick={() => window.open(`https://www.reddit.com/search/?q=${encodeURIComponent(query)}`, '_blank')}
                            >
                              <div className="search-reddit-header">
                                <span className="search-reddit-subreddit">{post.subreddit}</span>
                                <span className="search-reddit-author">• Posted by {post.author} • {post.timeAgo}</span>
                              </div>
                              <div className="search-reddit-title">{post.title}</div>
                              <div className="search-reddit-footer">
                                <div className="search-reddit-metric">
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                                    <polyline points="18 15 12 9 6 15"></polyline>
                                  </svg>
                                  <span>{post.upvotes}</span>
                                </div>
                                <div className="search-reddit-metric">
                                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                                  </svg>
                                  <span>{post.comments} comments</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {activeTab === 'maps' && (
                        <div className="search-map-wrapper">
                          <div className="search-map-info-card">
                            <h3 style={{ fontSize: '15px', fontWeight: 'bold' }}>🌐 Google Map Embed</h3>
                            <p style={{ fontSize: '12px', color: 'rgba(255,255,255,0.6)', marginTop: '4px' }}>
                              Showing map results matching: "<strong>{query || 'New York'}</strong>"
                            </p>
                          </div>
                          <div className="search-map-iframe-container">
                            <iframe 
                              className="search-map-iframe"
                              src={`https://maps.google.com/maps?q=${encodeURIComponent(query || 'New York')}&t=&z=13&ie=UTF8&iwloc=&output=embed`}
                              allowFullScreen
                              loading="lazy"
                            />
                          </div>
                        </div>
                      )}

                      {activeTab === 'settings' && (
                        <div className="search-settings-wrapper">
                          <div className="search-settings-group">
                            <div className="search-settings-title">🎵 Music Library controls</div>
                            <div className="search-settings-row">
                              <div>
                                <div className="search-settings-label">Directory Actions</div>
                                <div className="search-settings-desc">Choose a directory or rescan files via custom signals.</div>
                              </div>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button 
                                  onClick={() => {
                                    window.dispatchEvent(new CustomEvent('music:selectFolder'));
                                    onClose();
                                  }}
                                  style={{
                                    background: '#1db954', border: 'none', color: '#fff', 
                                    padding: '6px 12px', borderRadius: '15px', fontSize: '12px', 
                                    fontWeight: 'bold', cursor: 'pointer'
                                  }}
                                >
                                  Select Folder
                                </button>
                                <button 
                                  onClick={() => {
                                    window.dispatchEvent(new CustomEvent('music:rescan'));
                                    onClose();
                                  }}
                                  style={{
                                    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', 
                                    padding: '6px 12px', borderRadius: '15px', fontSize: '12px', 
                                    fontWeight: 'bold', cursor: 'pointer'
                                  }}
                                >
                                  Rescan
                                </button>
                              </div>
                            </div>
                            <div className="search-settings-row" style={{ marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '8px' }}>
                              <div>
                                <div className="search-settings-label">Database Utilities</div>
                                <div className="search-settings-desc">Wipe search metrics, clicks, and logs.</div>
                              </div>
                              <button 
                                onClick={() => {
                                  if (window.confirm('Clear all search query history?')) {
                                    clearHistory();
                                  }
                                }}
                                style={{
                                  background: '#ff5f56', border: 'none', color: '#fff', 
                                  padding: '6px 12px', borderRadius: '15px', fontSize: '12px', 
                                  fontWeight: 'bold', cursor: 'pointer'
                                }}
                              >
                                Clear History
                              </button>
                            </div>
                          </div>

                          <div className="search-settings-group">
                            <div className="search-settings-title">⌨️ Keyboard Shortcuts</div>
                            <div className="search-help-grid">
                              <div className="search-help-key">Ctrl + K</div>
                              <div>Toggle search engine modal overlay anywhere.</div>
                              
                              <div className="search-help-key">Tab</div>
                              <div>Rotate horizontally through available result tabs.</div>
                              
                              <div className="search-help-key">Arrow Down / Up</div>
                              <div>Navigate through virtualized list suggestions.</div>
                              
                              <div className="search-help-key">Enter</div>
                              <div>Select highlighted option, execute command or trigger Google search.</div>
                              
                              <div className="search-help-key">ESC</div>
                              <div>Close the search engine modal overlay.</div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                </Dialog.Content>
              </motion.div>
            </Dialog.Overlay>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
};
