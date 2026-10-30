import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { dimFor, focusPref, nightShiftPref, wallpaperBrightnessPref, widgetsHiddenPref } from '../../libs/controlcenter/ccPrefs';
import { usePref } from '../../libs/prefs/storedPref';
import '../../styles/controlcenter.css';

// What Control Center's switches do to the page (controlcenter.css):
//   Focus           html.cc-focus: only the clock, the search bar and the Dock; update notices wait
//   Widgets off     html.cc-widgets-hidden: the widgets step aside
//   Display         a veil over the wallpaper, under everything else (brightness)
//   Night Shift     a warm layer over the whole page that never takes the pointer
export default function DesktopModes() {
  const focus = usePref(focusPref);
  const widgetsHidden = usePref(widgetsHiddenPref);
  const nightShift = usePref(nightShiftPref);
  const brightness = usePref(wallpaperBrightnessPref);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('cc-focus', focus);
    root.classList.toggle('cc-widgets-hidden', widgetsHidden);
    return () => root.classList.remove('cc-focus', 'cc-widgets-hidden');
  }, [focus, widgetsHidden]);

  const dim = dimFor(brightness);
  return createPortal(
    <>
      <div className="cc-wallpaper-veil" style={{ opacity: dim }} aria-hidden="true" />
      <div className={`cc-night-shift${nightShift ? ' is-on' : ''}`} aria-hidden="true" />
    </>,
    document.body,
  );
}
