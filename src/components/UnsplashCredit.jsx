import { useEffect, useState } from 'react';
import { getActiveWallpaper } from '../libs/wallpaper/settings';
import { getUnsplash } from '../libs/wallpaper/repository';
import { subscribe } from '../libs/wallpaper/sync';
import { withUtm } from '../libs/wallpaper/unsplashClient';
import '../styles/unsplash-credit.css';

// Unsplash API guideline: wherever a photo is displayed, credit the photographer and Unsplash
// with links back (utm_source/utm_medium). Shown on the new-tab page while the active
// wallpaper is an Unsplash photo; hidden for local wallpapers.

export default function UnsplashCredit() {
  const [credit, setCredit] = useState(null);

  useEffect(() => {
    let seq = 0;
    const load = () => {
      const current = ++seq;
      const ref = getActiveWallpaper();
      if (ref?.source !== 'unsplash') {
        setCredit(null);
        return;
      }
      getUnsplash(ref.id)
        .then((record) => {
          if (current !== seq) return;
          const name = record?.photographer?.name;
          setCredit(name ? {
            name,
            profileUrl: record.photographer.profileUrl || withUtm('https://unsplash.com/'),
            photoUrl: record.photoPageUrl || withUtm('https://unsplash.com/'),
          } : null);
        })
        .catch(() => {
          if (current === seq) setCredit(null);
        });
    };
    load();
    const unsubscribe = subscribe(({ type }) => {
      if (type === 'active-changed' || type === 'library-changed') load();
    });
    return () => {
      seq += 1;
      unsubscribe();
    };
  }, []);

  if (!credit) return null;

  return (
    <p className="unsplash-credit">
      Photo by{' '}
      <a href={credit.profileUrl} target="_blank" rel="noopener noreferrer">{credit.name}</a>
      {' '}on{' '}
      <a href={credit.photoUrl} target="_blank" rel="noopener noreferrer">Unsplash</a>
    </p>
  );
}
