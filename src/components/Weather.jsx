import React, { useState, useEffect, useRef, useCallback } from 'react';
import { collapsedWidth, morphCard } from './widgets/shared/useCardExpand';
import GlassSurface from './glass/GlassSurface';
import { showAlert } from '../libs/dialogs/dialogs';
import {
  REFRESH_MS,
  STALE_MS,
  cachedWeather,
  currentPlace,
  fetchForecast,
  findPlace,
  nowIndex,
  saveCity,
  savedCity,
  updatedLabel,
} from '../libs/weather/weatherData';

export default function Weather({ onExpandedChange }) {
  // The last forecast shows at once; a fresh one replaces it (libs/weather/weatherData.js).
  const [weather, setWeather] = useState(cachedWeather); // { place, data, fetchedAt, current }
  const weatherData = weather?.data || null;
  const locationName = weather?.place.name || '';
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0); // re-renders "Updated … ago" and the current hour
  const [searchInput, setSearchInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  
  const containerRef = useRef(null);
  const searchRef = useRef(null);
  const dividerRef = useRef(null);
  const forecastRef = useRef(null);
  const forecastScrollRef = useRef(null);

  // References for text elements that undergo animations
  const locTextRef = useRef(null);
  const tempTextRef = useRef(null);
  const iconImgRef = useRef(null);
  const condTextRef = useRef(null);
  const hlTextRef = useRef(null);

  // Loads the weather: for the searched city, or where you are now. Only the latest request
  // counts (a new search or refresh replaces one still running).
  const request = useRef(null);
  const load = useCallback(async ({ place = null } = {}) => {
    request.current?.abort();
    const ctl = new AbortController();
    request.current = ctl;
    setBusy(true);
    try {
      const city = place || savedCity();
      const where = city || await currentPlace(ctl.signal);
      const result = await fetchForecast(where, { current: !city }, ctl.signal);
      if (!ctl.signal.aborted) setWeather(result);
    } catch (err) {
      if (err?.name !== 'AbortError') console.warn('[weather] Could not load the weather:', err);
    } finally {
      if (request.current === ctl) setBusy(false);
    }
  }, []);

  // At start, then every half hour, and when you come back to the tab after a while.
  const weatherRef = useRef(weather);
  useEffect(() => {
    weatherRef.current = weather;
  }, [weather]);
  useEffect(() => {
    load(); // eslint-disable-line react-hooks/set-state-in-effect -- the first load, at start
    const timer = setInterval(() => load(), REFRESH_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const at = weatherRef.current?.fetchedAt || 0;
      if (Date.now() - at > STALE_MS) load();
      else setTick((t) => t + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
      request.current?.abort();
    };
  }, [load]);

  const formatConditionText = (symbolCode) => {
    if (!symbolCode) return "";
    const cleanCode = symbolCode.replace(/_(day|night|polartwilight)$/, "");
    const words = cleanCode.split('_');
    for (let i = 0; i < words.length; i++) {
      if (words[i] === "lightsleetshowersandthunder") {
        words[i] = "Light Sleet Showers & Thunder";
      } else if (words[i] === "lightssnowshowersandthunder") {
        words[i] = "Light Snow Showers & Thunder";
      } else {
        words[i] = words[i].charAt(0).toUpperCase() + words[i].slice(1);
      }
    }
    return words.join(' ');
  };

  const getWeatherGradient = (symbol) => {
    if (!symbol) return 'linear-gradient(to top, rgba(20, 24, 45, 0.85), rgba(10, 11, 20, 0.9))';
    const s = symbol.toLowerCase();
    
    if (s.endsWith('_night') || s.includes('night')) {
      if (s.includes('thunder')) {
        return 'linear-gradient(to top, rgba(30, 15, 50, 0.85), rgba(12, 6, 22, 0.9))';
      } else if (s.includes('rain') || s.includes('shower') || s.includes('sleet') || s.includes('snow')) {
        return 'linear-gradient(to top, rgba(15, 32, 67, 0.85), rgba(7, 15, 33, 0.9))';
      } else if (s.includes('cloud') || s.includes('fog') || s.includes('mist') || s.includes('haze') || s.includes('smog')) {
        return 'linear-gradient(to top, rgba(23, 27, 44, 0.85), rgba(11, 13, 21, 0.9))';
      }
      return 'linear-gradient(to top, rgba(20, 24, 45, 0.85), rgba(10, 11, 20, 0.9))';
    }
    
    if (s.includes('thunder')) {
      return 'linear-gradient(to top, rgba(74, 30, 112, 0.85), rgba(29, 11, 46, 0.9))';
    }
    if (s.includes('sand') || s.includes('dust') || s.includes('ash')) {
      return 'linear-gradient(to top, rgba(160, 130, 90, 0.8), rgba(210, 180, 140, 0.85))';
    }
    if (s.includes('fog') || s.includes('mist') || s.includes('haze') || s.includes('smog')) {
      return 'linear-gradient(to top, rgba(90, 103, 120, 0.8), rgba(150, 163, 180, 0.85))';
    }
    if (s.includes('rain') || s.includes('shower') || s.includes('sleet') || s.includes('snow') || s.includes('sleetshowers') || s.includes('snowshowers')) {
      return 'linear-gradient(to top, rgba(35, 75, 120, 0.8), rgba(20, 45, 75, 0.85))';
    }
    if (s.includes('partlycloudy') || s.includes('fair') || s.includes('cloudy') || s.includes('heavycloudy')) {
      return 'linear-gradient(to top, rgba(60, 120, 195, 0.8), rgba(135, 185, 230, 0.85))';
    }
    if (s.includes('clearsky') || s.includes('sun') || s.includes('sunny')) {
      return 'linear-gradient(to top, rgba(211, 84, 0, 0.8), rgba(243, 156, 18, 0.85))';
    }
    return 'linear-gradient(to top, rgba(60, 120, 195, 0.8), rgba(135, 185, 230, 0.85))';
  };

  const handleSearch = async () => {
    const query = searchInput.trim();
    if (!query) return; // nothing typed yet
    let place;
    try {
      place = await findPlace(query);
    } catch (error) {
      console.error('Geocoding error:', error);
      showAlert({ title: 'The place couldn’t be looked up', message: 'Check your connection and try again.' });
      return;
    }
    if (!place) {
      showAlert({ title: `“${query}” wasn’t found`, message: 'Try another place name.' });
      return;
    }
    saveCity(place);
    setSearchInput('');
    load({ place });
  };

  // Back to where you are now: forget the searched city.
  const useCurrentLocation = () => {
    saveCity(null);
    setSearchInput('');
    load();
  };

  // GSAP animation triggered by changes to isExpanded
  useEffect(() => {
    const container = containerRef.current;
    const search = searchRef.current;
    const divider = dividerRef.current;
    const forecast = forecastRef.current;
    
    if (!container || !search || !forecast || !divider) return;

    const locText = locTextRef.current;
    const tempText = tempTextRef.current;
    const iconImg = iconImgRef.current;
    const condText = condTextRef.current;
    const hlText = hlTextRef.current;

    // The headline text grows with the card (sizes from the CSS at rest).
    morphCard(container, isExpanded, {
      sections: [
        { el: search, display: 'flex' },
        { el: divider, display: 'block', opacity: 0.5 },
        { el: forecast, display: 'flex' },
      ],
      width: window.innerWidth <= 480 ? '100%' : Math.max(320, collapsedWidth(container)),
      tweens: [
        { el: locText, open: { fontSize: 20 }, closed: { fontSize: 13 } },
        { el: tempText, open: { fontSize: 56 }, closed: { fontSize: 32 } },
        { el: iconImg, open: { width: 46, height: 46, marginRight: 0 }, closed: { width: 24, height: 24, marginRight: 0 } },
        { el: condText, open: { fontSize: 14 }, closed: { fontSize: 11 } },
        { el: hlText, open: { fontSize: 12 }, closed: { fontSize: 10 } },
      ],
      instant: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
  }, [isExpanded]);

  // Lets a container (the Smart Stack) know when the card is expanded.
  useEffect(() => {
    onExpandedChange?.(isExpanded);
  }, [isExpanded, onExpandedChange]);

  // Like the other cards (useCardExpand): a click anywhere outside, or Esc, collapses it.
  useEffect(() => {
    if (!isExpanded) return undefined;
    const onPointerDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setIsExpanded(false);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) setIsExpanded(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isExpanded]);

  // Translate vertical wheel movements into horizontal scrolling in forecast items
  useEffect(() => {
    const el = forecastScrollRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      if (e.deltaY !== 0) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [weatherData]);

  // The background follows the current hour's weather.
  const series = weatherData?.properties?.timeseries || [];
  const nowAt = nowIndex(series);
  const nowSymbol = series[nowAt]?.data.next_1_hours?.summary.symbol_code || series[nowAt]?.data.next_6_hours?.summary.symbol_code || 'clearsky_day';
  const backgroundGradient = getWeatherGradient(nowSymbol);

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const handleSearchKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  if (!weatherData) {
    return (
      <div className="weather-container glass-host" style={{ '--glass-tint': 'linear-gradient(to top, rgba(20, 24, 45, 0.85), rgba(10, 11, 20, 0.9))' }}>
        <GlassSurface preset="card" />
        <div id="weatherInfo">
          <p className="weather-error">Loading Weather...</p>
        </div>
      </div>
    );
  }

  const timeseries = weatherData.properties.timeseries || [];
  if (timeseries.length === 0) {
    return (
      <div className="weather-container glass-host" style={{ '--glass-tint': 'linear-gradient(to top, rgba(20, 24, 45, 0.85), rgba(10, 11, 20, 0.9))' }}>
        <GlassSurface preset="card" />
        <div id="weatherInfo">
          <p className="weather-error">No forecast data available.</p>
        </div>
      </div>
    );
  }

  // Current values
  const currentInstant = timeseries[nowAt].data.instant.details;
  const currentTemp = Math.round(currentInstant.air_temperature);
  const currentSymbol = nowSymbol;
  const conditionText = formatConditionText(currentSymbol);
  const iconUrl = `https://cdn.jsdelivr.net/gh/metno/weathericons@master/weather/svg/${currentSymbol}.svg`;

  // High / Low temperatures
  const temps = [];
  for (let i = nowAt; i < Math.min(nowAt + 24, timeseries.length); i++) {
    const t = timeseries[i].data.instant.details.air_temperature;
    if (t !== undefined) {
      temps.push(t);
    }
  }
  const highTemp = Math.round(Math.max(...temps));
  const lowTemp = Math.round(Math.min(...temps));

  // Build horizontal hourly list (next 12 hours)
  const hourlyForecast = [];
  for (let k = nowAt + 1; k <= nowAt + 12 && k < timeseries.length; k++) {
    const item = timeseries[k];
    const date = new Date(item.time);
    const hour = date.getHours();
    const ampm = hour >= 12 ? 'PM' : 'AM';
    let hourNum = hour % 12;
    hourNum = hourNum ? hourNum : 12;
    const timeStr = `${hourNum} ${ampm}`;

    const forecastInstant = item.data.instant.details;
    const forecastTemp = Math.round(forecastInstant.air_temperature);
    const forecastNext1H = item.data.next_1_hours;
    const forecastSymbol = forecastNext1H ? forecastNext1H.summary.symbol_code : 'clearsky_day';
    const forecastIconUrl = `https://cdn.jsdelivr.net/gh/metno/weathericons@master/weather/svg/${forecastSymbol}.svg`;

    hourlyForecast.push({
      time: timeStr,
      temp: forecastTemp,
      icon: forecastIconUrl
    });
  }

  return (
    <div 
      className={`weather-container glass-host${isExpanded ? ' is-expanded' : ''}`}
      ref={containerRef}
      style={{ '--glass-tint': backgroundGradient }}
      onClick={toggleExpand}
    >
      <GlassSurface preset="card" />
      <div className="weather-search" ref={searchRef} onClick={(e) => e.stopPropagation()}>
        <input 
          type="text" 
          id="locationInput" 
          placeholder="Search city..."
          autoComplete="off"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyUp={handleSearchKeyPress}
        />
        <button
          type="button"
          className={`get-weather${weather?.current ? ' is-active' : ''}`}
          onClick={useCurrentLocation}
          title={weather?.current ? 'Showing your current location' : 'Use my current location'}
          aria-label="Use my current location"
          aria-pressed={Boolean(weather?.current)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill={weather?.current ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polygon points="3 11 22 2 13 21 11 13 3 11" />
          </svg>
        </button>
        <button
          type="button"
          className={`get-weather${busy ? ' is-busy' : ''}`}
          onClick={() => load()}
          disabled={busy}
          title={weather ? `${updatedLabel(weather.fetchedAt)}. Refresh` : 'Refresh'}
          aria-label="Refresh the weather"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <polyline points="21 3 21 9 15 9" />
          </svg>
        </button>
        <button type="button" className="get-weather" onClick={handleSearch} aria-label="Search">
          <svg 
            width="14" 
            height="14" 
            viewBox="0 0 24 24" 
            fill="none"
            stroke="currentColor" 
            strokeWidth="2.5" 
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
        </button>
      </div>

      <div id="weatherInfo">
        <div className="weather-card">
          <div className="weather-info-main">
            <div className="weather-info-left">
              <span className="weather-location" ref={locTextRef}>{locationName}</span>
              <span className="weather-temp" ref={tempTextRef}>{currentTemp}°</span>
            </div>
            <div className="weather-info-right">
              <img src={iconUrl} alt={conditionText} className="weather-condition-icon" ref={iconImgRef} />
              <span className="weather-condition-text" ref={condTextRef}>{conditionText}</span>
              <span className="weather-hl-temp" ref={hlTextRef}>H:{highTemp}° L:{lowTemp}°</span>
            </div>
          </div>
          <div className="weather-divider" ref={dividerRef}></div>
          <div className="weather-forecast-container" ref={forecastRef} onClick={(e) => e.stopPropagation()}>
            <div className="forecast-scroll-wrapper" ref={forecastScrollRef} style={{ display: 'flex', overflowX: 'auto', width: '100%' }}>
              {hourlyForecast.map((item, idx) => (
                <div className="forecast-item" key={idx}>
                  <span className="forecast-time">{item.time}</span>
                  <img src={item.icon} alt="weather icon" className="forecast-icon" />
                  <span className="forecast-temp">{item.temp}°</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
