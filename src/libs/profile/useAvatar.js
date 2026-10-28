import { useEffect, useState } from 'react';
import { AVATAR_EVENT, getAvatar } from './avatar';

/** The profile photo as an object URL (null when there is none); follows changes. */
export function useAvatarUrl() {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let current = null;
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      getAvatar()
        .then((blob) => {
          if (mine !== seq) return;
          if (current) URL.revokeObjectURL(current);
          current = blob ? URL.createObjectURL(blob) : null;
          setUrl(current);
        })
        .catch((err) => console.error('Failed to read the profile photo:', err));
    };
    load();
    window.addEventListener(AVATAR_EVENT, load);
    return () => {
      seq += 1;
      window.removeEventListener(AVATAR_EVENT, load);
      if (current) URL.revokeObjectURL(current);
    };
  }, []);

  return url;
}
