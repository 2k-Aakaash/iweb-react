import { useEffect } from 'react';
import { ATMOSPHERE_SCENE_EVENT, getAmbience } from '../../libs/ambience/store.js';
import { ambienceScenesPref } from '../../libs/ambience/prefs.js';
import { startSuggestions } from '../../libs/ambience/suggestions.js';
import { notify } from '../../libs/notifications/notifications.js';
import { subscribe as subscribeWallpaper } from '../../libs/wallpaper/sync.js';
import { getWallpaperRecord } from '../../libs/wallpaper/repository.js';

// Atmosphere's background services for the page (App.jsx), rendering nothing:
//   - wallpaper-linked and time-aware scene suggestions (libs/ambience/suggestions.js), which
//     only ever post a notification;
//   - a suggestion's action: clicking it (a user gesture) applies the scene and plays.
// Making the engine here creates no audio: that waits for Play.
export default function AtmosphereServices() {
  useEffect(() => {
    const engine = getAmbience();
    const stop = startSuggestions({
      engine,
      notify,
      subscribeWallpaper,
      getRecord: getWallpaperRecord,
      customScenes: () => ambienceScenesPref.get() || [],
      sceneEvent: ATMOSPHERE_SCENE_EVENT,
    });
    const onScene = (e) => {
      const id = e.detail?.sceneId;
      if (typeof id === 'string') engine.applyScene(id, { play: true });
    };
    window.addEventListener(ATMOSPHERE_SCENE_EVENT, onScene);
    return () => {
      stop();
      window.removeEventListener(ATMOSPHERE_SCENE_EVENT, onScene);
    };
  }, []);
  return null;
}
