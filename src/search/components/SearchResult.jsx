import React, { useState, useEffect, useLayoutEffect, useRef, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { motion, AnimatePresence } from 'framer-motion';
import { List } from 'react-window';
import { useSearch } from '../hooks/useSearch';
import { useCurrencyAnswer } from '../hooks/useCurrencyAnswer';
import { useMarketAnswer } from '../hooks/useMarketAnswer';
import { Favicon } from './Favicon';
import { CurrencyAnswer } from './CurrencyAnswer';
import { MarketAnswer } from './MarketAnswer';
import GlassSurface from '../../components/glass/GlassSurface';
import '../styles/search.css';

// Layout after macOS 26 Spotlight: a large field with the top hit hinted after the typed text,
// a row of category chips, and results with an icon, a title and a subtitle naming the source.

const SEARCH_TABS = [
  { id: 'all', label: 'All' },
  { id: 'images', label: 'Images' },
  { id: 'videos', label: 'Videos' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'maps', label: 'Maps' },
  { id: 'settings', label: 'Settings' },
];

const SOURCE_LABELS = { history: 'History', bookmark: 'Bookmark', typesense: 'Suggestion', web: 'Web' };

function hostOf(url) {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The grey line under a result: "reddit.com · History", a command's description, … */
function resultSubtitle(item) {
  if (item.type === 'command') {
    return item.title.startsWith('/') ? item.url || 'Command' : 'Recent Search';
  }
  const source = item.folder ? `Bookmarks — ${item.folder}` : SOURCE_LABELS[item.type] || '';
  return [item.url ? hostOf(item.url) : '', source].filter(Boolean).join(' · ');
}

// Highlights the part of `text` that matches the query.
function HighlightText({ text, highlight }) {
  if (!highlight.trim()) return <span>{text}</span>;
  const regex = new RegExp(`(${highlight.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
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
}

// One result row for react-window. Defined here, not inside SearchResult: a component created
// during render is a new type every render, so hovering (which re-renders) remounted every
// row and each favicon flashed its letter placeholder before reloading.
function ResultRow({ index, style, items, answerOffset, selectedIndex, query, onItemClick, onHover }) {
  const item = items[index];
  if (!item) return null;
  const isSelected = index + answerOffset === selectedIndex;
  return (
    <div style={style}>
      <div
        className={`search-result-row ${isSelected ? 'selected' : ''}`}
        onClick={() => onItemClick(item, index)}
        onMouseEnter={() => onHover(index + answerOffset)}
      >
        <div className="search-result-favicon-container">
          <Favicon url={item.url} title={item.title} type={item.type} />
        </div>
        <div className="search-result-details">
          <div className="search-result-title">
            <HighlightText text={item.title} highlight={query} />
          </div>
          <div className="search-result-url">{resultSubtitle(item)}</div>
        </div>
        {isSelected && <kbd className="search-result-enter" aria-hidden="true">↩</kbd>}
      </div>
    </div>
  );
}

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
  const answerRef = useRef(null);

  // Instant answers (currency conversion, market quote); null for every other query.
  // The market parser yields to conversions, so at most one card shows.
  const currencyAnswer = useCurrencyAnswer(query);
  const marketAnswer = useMarketAnswer(query);
  const marketCard = !currencyAnswer && marketAnswer?.visible ? marketAnswer : null;
  const hasAnswer = Boolean(currencyAnswer || marketCard);

  // Combine suggestions and results for keyboard navigation when in 'all' tab
  const activeItems = useMemo(() => {
    if (query.trim() === '') {
      return suggestions;
    }
    // "/" lists iWeb's slash commands (/music, /notes, …) instead of search results.
    if (query.trim().startsWith('/')) {
      const seen = new Set(); // a past search for "/notes" would repeat the command
      return suggestions.filter((item) => {
        // Commands carry a description in `url`; a past search for "/…" has none.
        if (item.type !== 'command' || !item.title.startsWith('/') || !item.url || seen.has(item.title)) return false;
        seen.add(item.title);
        return true;
      });
    }
    return results;
  }, [query, suggestions, results]);

  // When an answer card is shown it takes selection index 0 and list rows shift down by one
  const answerOffset = hasAnswer ? 1 : 0;
  const navCount = activeItems.length + answerOffset;

  // Top-hit hint after the typed text ("— Reddit Home"): the result Enter would open.
  const measureRef = useRef(null);
  const completionRef = useRef(null);
  const hinted = activeTab === 'all' && query.trim() ? activeItems[selectedIndex - answerOffset] : null;
  const completion = hinted && hinted.title.trim().toLowerCase() !== query.trim().toLowerCase() ? hinted.title : '';
  useLayoutEffect(() => {
    if (completionRef.current && measureRef.current) {
      completionRef.current.style.left = `${measureRef.current.offsetWidth}px`;
    }
  }, [query, completion]);

  const scrollToSelection = (index) => {
    if (index < answerOffset) {
      answerRef.current?.scrollIntoView({ block: 'nearest' });
    } else {
      listRef.current?.scrollToRow({ index: index - answerOffset, align: 'smart' });
    }
  };

  // Keep selected index bounded (a market card can appear or go away after its lookup settles)
  useEffect(() => {
    setSelectedIndex(0);
    if (listRef.current) {
      listRef.current.scrollToRow({ index: 0 });
    }
  }, [activeItems, query, hasAnswer]);

  // Keyboard navigation handler
  const handleKeyDown = (e) => {
    if (activeTab !== 'all') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = prev + 1 >= navCount ? 0 : prev + 1;
        scrollToSelection(next);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = prev - 1 < 0 ? navCount - 1 : prev - 1;
        scrollToSelection(next);
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (answerOffset && selectedIndex === 0) {
        if (currencyAnswer) {
          // Currency: Enter copies the result, Cmd/Ctrl+Enter shows this pair in the currency widget
          if (e.metaKey || e.ctrlKey) {
            currencyAnswer.saveToWidget();
          } else {
            currencyAnswer.copy();
          }
        } else if (e.metaKey || e.ctrlKey) {
          // Market: Cmd/Ctrl+Enter adds it to the watchlist, Enter opens it in the Markets app
          marketCard.addToWatchlist();
        } else {
          openMarketAnswer();
        }
        return;
      }
      const item = activeItems[selectedIndex - answerOffset];
      if (item) {
        handleItemClick(item, selectedIndex - answerOffset);
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
          const notesBtn = document.querySelector('[data-action="notes"] button');
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

  // Market answer: open it in the Markets app and close the palette like opening a result
  // (no click analytics; nothing happens until a stock name has resolved to a symbol)
  const openMarketAnswer = () => {
    if (marketCard?.openInMarkets()) onClose();
  };

  // Focus input on mount
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      setActiveTab('all');
    }
  }, [isOpen]);

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
                    className="search-modal-content glass-host"
                    initial={{ scale: 0.95, y: 15, opacity: 0 }}
                    animate={{ scale: 1, y: 0, opacity: 1 }}
                    exit={{ scale: 0.95, y: 15, opacity: 0 }}
                    transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                    onKeyDown={handleKeyDown}
                  >
                    <GlassSurface preset="spotlight" />
                    {/* Search Bar Input */}
                    <div className="search-input-wrapper">
                      <div className="search-icon-left">
                        {isLoading ? (
                          <svg className="animate-spin" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2">
                            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12"></circle>
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <circle cx="10.5" cy="10.5" r="7"></circle>
                            <line x1="20.5" y1="20.5" x2="15.6" y2="15.6"></line>
                          </svg>
                        )}
                      </div>
                      <div className="search-input-box">
                        <input
                          ref={inputRef}
                          type="text"
                          className="search-input-field"
                          placeholder="Spotlight Search"
                          aria-label="Search history, bookmarks and commands (/music, /settings, /notes)"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        {/* Measures the typed text so the top-hit hint can follow it. */}
                        <span ref={measureRef} className="search-input-measure" aria-hidden="true">{query}</span>
                        {completion && (
                          <span ref={completionRef} className="search-completion" aria-hidden="true">
                            — {completion}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Tabs bar */}
                    <div className="search-tabs-list" role="tablist" aria-label="Search categories">
                      {SEARCH_TABS.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={activeTab === tab.id}
                          className={`search-tab-trigger ${activeTab === tab.id ? 'active' : ''}`}
                          onClick={() => setActiveTab(tab.id)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>

                    {/* Results Container Panel */}
                    <div className="search-results-panel">
                      {activeTab === 'all' && currencyAnswer && (
                        <CurrencyAnswer
                          ref={answerRef}
                          answer={currencyAnswer}
                          isSelected={selectedIndex === 0}
                          onHover={() => setSelectedIndex(0)}
                        />
                      )}
                      {activeTab === 'all' && marketCard && (
                        <MarketAnswer
                          ref={answerRef}
                          answer={marketCard}
                          isSelected={selectedIndex === 0}
                          onHover={() => setSelectedIndex(0)}
                          onOpen={openMarketAnswer}
                        />
                      )}
                      {activeTab === 'all' && (
                        activeItems.length > 0 ? (
                          <List
                            listRef={listRef}
                            height={Math.min(activeItems.length * 60, hasAnswer ? 360 : 480)}
                            rowCount={activeItems.length}
                            rowHeight={60}
                            width="100%"
                            rowComponent={ResultRow}
                            rowProps={{
                              items: activeItems,
                              answerOffset,
                              selectedIndex,
                              query,
                              onItemClick: handleItemClick,
                              onHover: setSelectedIndex,
                            }}
                          />
                        ) : !hasAnswer && (
                          <div className="search-empty">
                            {query.trim() ? (
                              <>
                                <p className="search-empty-title">No Results in History or Bookmarks</p>
                                <p className="search-empty-hint">Press Enter to search the web for “{query.trim()}”.</p>
                              </>
                            ) : (
                              <p className="search-empty-hint">Search your history and bookmarks, or type / for commands.</p>
                            )}
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
                              <div>Select highlighted option, execute command or trigger Google search. On a currency answer, copy the result; on a market answer, open it in Markets.</div>

                              <div className="search-help-key">Ctrl / ⌘ + Enter</div>
                              <div>On a currency answer, show that conversion in the currency widget; on a market answer, add it to your watchlist.</div>

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
