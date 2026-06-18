import React, { useState, useEffect, useRef } from 'react';
import gsap from 'gsap';

export default function Weather() {
  const [weatherData, setWeatherData] = useState(null);
  const [locationName, setLocationName] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const [backgroundGradient, setBackgroundGradient] = useState('');
  
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

  useEffect(() => {
    initWeather();
  }, []);

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

  const initWeather = () => {
    const cachedLocation = localStorage.getItem('weatherLocation');
    if (cachedLocation) {
      try {
        const loc = JSON.parse(cachedLocation);
        if (loc && loc.lat && loc.lon && loc.name) {
          fetchWeatherData(loc.lat, loc.lon, loc.name);
          return;
        }
      } catch (e) {
        console.error("Error parsing cached weather location:", e);
      }
    }

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const lon = position.coords.longitude;
          const reverseGeocodeUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&email=admin@iweb-dashboard.local`;
          fetch(reverseGeocodeUrl)
            .then(res => res.json())
            .then(geo => {
              const city = geo.address.city || geo.address.town || geo.address.village || geo.address.suburb || "Current Location";
              fetchWeatherData(lat, lon, city);
            })
            .catch(() => {
              fetchWeatherData(lat, lon, "Current Location");
            });
        },
        (error) => {
          console.log("Geolocation error, falling back to IP:", error);
          fetchIPLocation();
        }
      );
    } else {
      fetchIPLocation();
    }
  };

  const fetchIPLocation = () => {
    fetch("https://ipapi.co/json/")
      .then(res => res.json())
      .then(data => {
        if (data.latitude && data.longitude) {
          fetchWeatherData(data.latitude, data.longitude, data.city || "Current Location");
        } else {
          fetchWeatherData(40.7128, -74.0060, "New York");
        }
      })
      .catch(error => {
        console.error("Error fetching IP location:", error);
        fetchWeatherData(40.7128, -74.0060, "New York");
      });
  };

  const handleSearch = () => {
    const query = searchInput.trim();
    if (!query) {
      alert("Please enter a location name.");
      return;
    }

    const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&email=admin@iweb-dashboard.local`;

    fetch(geocodeUrl)
      .then(response => response.json())
      .then(data => {
        if (data && data.length > 0) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);
          const displayName = data[0].display_name.split(',')[0];
          
          localStorage.setItem('weatherLocation', JSON.stringify({ lat, lon, name: displayName }));
          fetchWeatherData(lat, lon, displayName);
          setSearchInput('');
        } else {
          alert("Location not found. Please try another search.");
        }
      })
      .catch(error => {
        console.error('Geocoding error:', error);
        alert("Error finding location. Please try again.");
      });
  };

  const fetchWeatherData = (lat, lon, name) => {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`;

    fetch(url)
      .then(response => {
        if (!response.ok) throw new Error("HTTP error " + response.status);
        return response.json();
      })
      .then(data => {
        setLocationName(name);
        setWeatherData(data);
        const timeseries = data.properties.timeseries;
        if (timeseries && timeseries.length > 0) {
          const next1H = timeseries[0].data.next_1_hours;
          const next6H = timeseries[0].data.next_6_hours;
          const currentSymbol = next1H ? next1H.summary.symbol_code : (next6H ? next6H.summary.symbol_code : 'clearsky_day');
          setBackgroundGradient(getWeatherGradient(currentSymbol));
        }
      })
      .catch(error => {
        console.error('Weather API error:', error);
      });
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

    const expandedWidth = window.innerWidth <= 480 ? '100%' : 320;
    const springEase = 'cubic-bezier(0.32, 0.72, 0, 1)';

    // Kill existing animations on these elements before starting new ones
    gsap.killTweensOf([container, search, divider, forecast, locText, tempText, iconImg, condText, hlText]);

    if (isExpanded) {
      gsap.set(search, { display: 'flex' });
      gsap.set(divider, { display: 'block' });
      gsap.set(forecast, { display: 'flex' });

      const tl = gsap.timeline({ defaults: { ease: springEase } });
      tl
        .to(container, { width: expandedWidth, height: 'auto', padding: 16, duration: 0.38 }, 0)
        .to(locText, { fontSize: 20, duration: 0.3 }, 0)
        .to(tempText, { fontSize: 56, duration: 0.3 }, 0)
        .to(iconImg, { width: 46, height: 46, marginRight: 0, duration: 0.3 }, 0)
        .to(condText, { fontSize: 14, duration: 0.3 }, 0)
        .to(hlText, { fontSize: 12, duration: 0.3 }, 0)
        .to(search, { height: 'auto', opacity: 1, duration: 0.32 }, 0.03)
        .to(divider, { height: 1, opacity: 0.5, duration: 0.25 }, 0.03)
        .to(forecast, { height: 'auto', opacity: 1, duration: 0.35 }, 0.03);
    } else {
      const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });
      tl
        .to([search, divider, forecast], {
          height: 0,
          opacity: 0,
          duration: 0.22,
          onComplete: () => {
            gsap.set([search, divider, forecast], { display: 'none' });
          }
        }, 0)
        .to(container, { width: 150, height: 150, padding: 12, duration: 0.28 }, 0)
        .to(locText, { fontSize: 13, duration: 0.22 }, 0)
        .to(tempText, { fontSize: 32, duration: 0.22 }, 0)
        .to(iconImg, { width: 24, height: 24, marginRight: 0, duration: 0.22 }, 0)
        .to(condText, { fontSize: 11, duration: 0.22 }, 0)
        .to(hlText, { fontSize: 10, duration: 0.22 }, 0);
    }
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
      <div className="weather-container" style={{ background: 'rgba(0,0,0,0.1)' }}>
        <div id="weatherInfo">
          <p className="weather-error">Loading Weather...</p>
        </div>
      </div>
    );
  }

  const timeseries = weatherData.properties.timeseries || [];
  if (timeseries.length === 0) {
    return (
      <div className="weather-container">
        <div id="weatherInfo">
          <p className="weather-error">No forecast data available.</p>
        </div>
      </div>
    );
  }

  // Current values
  const currentInstant = timeseries[0].data.instant.details;
  const currentTemp = Math.round(currentInstant.air_temperature);
  const next1H = timeseries[0].data.next_1_hours;
  const next6H = timeseries[0].data.next_6_hours;
  const currentSymbol = next1H ? next1H.summary.symbol_code : (next6H ? next6H.summary.symbol_code : 'clearsky_day');
  const conditionText = formatConditionText(currentSymbol);
  const iconUrl = `https://cdn.jsdelivr.net/gh/metno/weathericons@master/weather/svg/${currentSymbol}.svg`;

  // High / Low temperatures
  const temps = [];
  for (let i = 0; i < Math.min(24, timeseries.length); i++) {
    const t = timeseries[i].data.instant.details.air_temperature;
    if (t !== undefined) {
      temps.push(t);
    }
  }
  const highTemp = Math.round(Math.max(...temps));
  const lowTemp = Math.round(Math.min(...temps));

  // Build horizontal hourly list (next 12 hours)
  const hourlyForecast = [];
  for (let k = 1; k <= 12 && k < timeseries.length; k++) {
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
      className="weather-container" 
      ref={containerRef}
      style={{ background: backgroundGradient }}
      onClick={toggleExpand}
    >
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
        <button className="get-weather" onClick={handleSearch}>
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
