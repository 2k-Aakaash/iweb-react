// The Weather widget's data: where (a city you searched, or where you are now), the
// met.no forecast for it, and keeping both fresh.
//
//   Location   localStorage `weatherLocation` holds a searched city { lat, lon, name };
//              without one, the widget follows your current location (the browser's, or
//              your IP's when that's refused), found again each time iWeb opens.
//   Forecast   met.no's, refreshed every REFRESH_MS while iWeb is open and when you come back
//              to a tab that's been away a while. The last one is kept (`weatherCache`) so the
//              widget shows weather straight away at start.

export const LOCATION_KEY = 'weatherLocation';
const CACHE_KEY = 'weatherCache';
export const REFRESH_MS = 30 * 60 * 1000;
export const STALE_MS = 10 * 60 * 1000; // coming back to the tab: refresh if older than this
const FALLBACK = { lat: 40.7128, lon: -74.006, name: 'New York' };

const readJson = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};
const writeJson = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: it's just fetched again.
  }
};

const validPlace = (p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)) && typeof p.name === 'string' && p.name;

/** The searched city, or null when following the current location. */
export function savedCity() {
  const p = readJson(LOCATION_KEY);
  return validPlace(p) ? { lat: Number(p.lat), lon: Number(p.lon), name: p.name } : null;
}

export const saveCity = (place) => writeJson(LOCATION_KEY, place ? { lat: place.lat, lon: place.lon, name: place.name } : null);

/** The last forecast shown: { place, data, fetchedAt, current } or null. */
export const cachedWeather = () => {
  const c = readJson(CACHE_KEY);
  return c && validPlace(c.place) && c.data?.properties?.timeseries ? c : null;
};

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function browserPosition(signal) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No geolocation'));
    navigator.geolocation.getCurrentPosition(
      (p) => (signal?.aborted ? reject(new DOMException('Aborted', 'AbortError')) : resolve(p.coords)),
      reject,
      { maximumAge: 10 * 60 * 1000, timeout: 10000 },
    );
  });
}

/** Where you are now: the browser's location, else your IP's, else New York. */
export async function currentPlace(signal) {
  try {
    const { latitude: lat, longitude: lon } = await browserPosition(signal);
    let name = 'Current Location';
    try {
      const geo = await getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`, signal);
      name = geo.city || geo.locality || geo.principalSubdivision || name;
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
    return { lat, lon, name };
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  try {
    const ip = await getJson('https://ipapi.co/json/', signal);
    if (Number.isFinite(ip.latitude) && Number.isFinite(ip.longitude)) {
      return { lat: ip.latitude, lon: ip.longitude, name: ip.city || 'Current Location' };
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
  }
  return FALLBACK;
}

/** A place by name (OpenStreetMap), or null when nothing matches. */
export async function findPlace(query, signal) {
  const data = await getJson(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, signal);
  if (!data?.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), name: data[0].display_name.split(',')[0] };
}

/** The forecast for a place; kept as the last one shown. */
export async function fetchForecast(place, { current }, signal) {
  // met.no asks for at most 4 decimals.
  const lat = Number(place.lat).toFixed(4);
  const lon = Number(place.lon).toFixed(4);
  const data = await getJson(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`, signal);
  if (!data?.properties?.timeseries?.length) throw new Error('No forecast data');
  const result = { place, data, fetchedAt: Date.now(), current };
  writeJson(CACHE_KEY, result);
  return result;
}

/**
 * The index of the forecast hour for `now`: the latest entry that has started (a forecast
 * fetched an hour ago starts an hour in the past).
 */
export function nowIndex(timeseries, now = Date.now()) {
  let index = 0;
  for (let i = 0; i < timeseries.length; i++) {
    if (Date.parse(timeseries[i].time) <= now) index = i;
    else break;
  }
  return index;
}

/** "Updated just now", "Updated 5 min ago", "Updated 2 h ago". */
export function updatedLabel(fetchedAt, now = Date.now()) {
  const min = Math.floor((now - fetchedAt) / 60000);
  if (min < 1) return 'Updated just now';
  if (min < 60) return `Updated ${min} min ago`;
  return `Updated ${Math.floor(min / 60)} h ago`;
}
