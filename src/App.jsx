import React, { useState, useEffect, useRef } from 'react';
import Background from './components/Background';
import Clock from './components/Clock';
import Dock from './components/Dock';
import Weather from './components/Weather';
import Music from './components/Music';
import Notes from './components/Notes';
import { SearchBar } from './search/components/SearchBar';
import { SearchResult } from './search/components/SearchResult';
import SettingsModal from './components/SettingsModal';

export default function App() {
  const [customName, setCustomName] = useState('');
  const [clockFont, setClockFont] = useState('');
  const [clockColor, setClockColor] = useState('');
  const [showMusicLibrary, setShowMusicLibrary] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const changeBgRef = useRef(null);
  // Ref that Background.jsx will expose to trigger its file input (upload new BG)
  const changeBgUploadRef = useRef(null);

  const [bookmarks, setBookmarks] = useState([]);

  // Initial load of customization details
  useEffect(() => {
    const storedName = localStorage.getItem('customName');
    if (storedName) setCustomName(storedName);

    const storedFont = localStorage.getItem('selectedFont');
    if (storedFont) setClockFont(storedFont);

    const storedBookmarks = JSON.parse(localStorage.getItem('bookmarks')) || [];
    storedBookmarks.sort((a, b) => (a.order || 0) - (b.order || 0));
    setBookmarks(storedBookmarks);
  }, []);

  // Global hotkey Ctrl+K / Cmd+K listener
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Listen to music open event to trigger library modal
  useEffect(() => {
    const handleOpenMusic = () => {
      setShowMusicLibrary(true);
    };
    window.addEventListener('music:open', handleOpenMusic);
    window.addEventListener('music:openSettings', handleOpenMusic);
    return () => {
      window.removeEventListener('music:open', handleOpenMusic);
      window.removeEventListener('music:openSettings', handleOpenMusic);
    };
  }, []);

  const handleClockColorChange = (color) => {
    setClockColor(color);
  };

  return (
    <>
      {/* 1. Dynamic Island & Music System */}
      <Music 
        showModal={showMusicLibrary} 
        setShowModal={setShowMusicLibrary} 
      />

      {/* 2. Top Right Weather widget */}
      <div className="top-right-container">
        <Weather />
      </div>

      {/* 3. Center Dashboard Container */}
      <div className="container">
        <div className="time-container">
          {/* Time, Clock and Greeting Quote */}
          <Clock 
            customName={customName} 
            clockFont={clockFont} 
          />
          <SearchBar onOpenSearch={() => setIsSearchOpen(true)} />
        </div>
      </div>

      {/* 4. Bottom Dock Navigation */}
      <Dock 
        bookmarks={bookmarks}
        setBookmarks={setBookmarks}
        onChangeBg={() => changeBgRef.current?.()}
        onOpenSettings={() => setShowSettings(true)}
      />

      {/* 5. Notes Section */}
      <Notes />

      {/* 6. Background and Customization Controllers */}
      <Background 
        customName={customName}
        clockFont={clockFont}
        onChangeName={setCustomName}
        onChangeFont={setClockFont}
        onClockColorChange={handleClockColorChange}
        onChangeBgRef={changeBgRef}
        onChangeBgUploadRef={changeBgUploadRef}
        onOpenMusicLibrary={() => setShowMusicLibrary(true)}
      />

      <SearchResult isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)}
        customName={customName}
        setCustomName={setCustomName}
        clockFont={clockFont}
        setClockFont={setClockFont}
        bookmarks={bookmarks}
        setBookmarks={setBookmarks}
      />

      <style>{`
        #clock {
          color: ${clockColor || 'inherit'};
          transition: color 200ms ease-in-out;
        }
      `}</style>
    </>
  );
}
