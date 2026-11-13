import React, { useState, useRef, useEffect, useSyncExternalStore } from "react";
import styles from "./Dock.module.css";
import GlassSurface from "./glass/GlassSurface";
import DockAppIcon from "./dock/DockAppIcon";
import { WINDOW_EVENT } from "../libs/window/useMacWindow";
import { useFavicons } from "../libs/favicons/useFavicons";
import { restoreMarkets } from "../libs/markets/marketService";
import { openNews } from "../libs/news/newsEvents";
import { addBookmark, moveBookmark, removeBookmark, saveBookmarks } from "../libs/dock/bookmarks";
import { notify } from "../libs/notifications/notifications";
import { openAtmosphere, openFrontier } from "../libs/ambience/store.js";
import PopupMenu from "./notes/PopupMenu";
import AddAppSheet from "./dock/AddAppSheet";
import { appMenu, bookmarkMenu, dockMenu } from "./dock/dockMenu";
import { usePref } from "../libs/prefs/storedPref";
import {
  dockMagnificationPref,
  dockSizePref,
  fitIconSize,
  magnificationPx,
  normalizeDockSize,
} from "../libs/dock/dockPrefs";

const defaultFavicon = "https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100";
// Room kept clear on each side of the Dock when it shrinks to fit the window.
const DOCK_MARGIN = 16;
// Built-in apps always in the Dock: Add, Change BG, Notes, Music, Settings.
const BUILT_IN_APPS = 5;

const subscribeWidth = (cb) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const getWidth = () => window.innerWidth;

const scaleValue = (value, from, to) => {
  const scale = (to[1] - to[0]) / (from[1] - from[0]);
  const capped = Math.min(from[1], Math.max(from[0], value)) - from[0];
  return Math.floor(capped * scale + to[0]);
};

export default function Dock({ bookmarks = [], setBookmarks, onChangeBg, onOpenNotes, onOpenSettings, onOpenMusicLibrary }) {
  const [isJiggling, setIsJiggling] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [faviconSteps, setFaviconSteps] = useState({});
  // Bookmark icons from iWebDB (refreshed weekly from /api/favicon); a broken cached image
  // falls back to the network chain below.
  const [badCached, setBadCached] = useState({});

  const dockRef = useRef(null);

  // Apps with an open or minimized window get the running dot under their icon (macOS).
  const [running, setRunning] = useState({});
  // Hover labels. Their glass is mounted only for the label showing and the one fading out,
  // not for every icon (in Liquid mode each glass surface is a live WebGL pass).
  const [labelGlass, setLabelGlass] = useState([]);
  const showLabel = (key) =>
    setLabelGlass((prev) => (prev[0] === key ? prev : [key, ...prev.filter((k) => k !== key)].slice(0, 2)));
  const labelProps = (key) => ({
    onMouseEnter: () => showLabel(key),
    onFocus: (e) => {
      if (e.target.matches(":focus-visible")) showLabel(key);
    },
  });
  const label = (key, text) => (
    <span className={`${styles.tooltip} glass-host`}>
      {labelGlass.includes(key) && <GlassSurface preset="label" />}
      {text}
    </span>
  );
  useEffect(() => {
    const onWindow = (e) => {
      const { app, state } = e.detail || {};
      if (app) setRunning((prev) => (prev[app] === state ? prev : { ...prev, [app]: state }));
    };
    window.addEventListener(WINDOW_EVENT, onWindow);
    return () => window.removeEventListener(WINDOW_EVENT, onWindow);
  }, []);
  const runningProps = (app) => (running[app] && running[app] !== "closed" ? { "data-running": running[app] } : {});

  // Size, as in macOS 26 (dockPrefs.js): the chosen icon size, smaller when the apps wouldn't
  // fit the window. Magnification grows with the chosen size, not the shrunk one.
  const chosenSize = usePref(dockSizePref);
  const magnification = usePref(dockMagnificationPref);
  const viewportWidth = useSyncExternalStore(subscribeWidth, getWidth, () => 1440);
  const magPx = magnificationPx(chosenSize, magnification);
  const transientCount = ["markets", "news", "atmosphere", "frontier"].filter((app) => running[app] && running[app] !== "closed").length;
  const iconSize = fitIconSize({
    size: chosenSize,
    count: bookmarks.length + BUILT_IN_APPS + transientCount,
    dividers: bookmarks.length > 0 ? 1 : 0,
    available: viewportWidth - DOCK_MARGIN * 2,
    magnification: magPx,
  });
  // The wave's left/right lean follows the pointer across the icon (a sixth of the growth).
  const maxAdditionalSize = magPx / 6;

  // Drag the divider up or down to resize the Dock (macOS).
  const [resizing, setResizing] = useState(false);
  const resizeFrom = useRef(null);
  const onDividerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeFrom.current = { y: e.clientY, size: chosenSize };
    setResizing(true);
  };
  const onDividerMove = (e) => {
    const from = resizeFrom.current;
    if (!from) return;
    const next = normalizeDockSize(from.size + (from.y - e.clientY));
    if (next !== null) dockSizePref.set(next);
  };
  const onDividerUp = () => {
    resizeFrom.current = null;
    setResizing(false);
  };

  // A click that opens a new tab leaves Chrome's :hover stuck on that icon (the page gets no
  // mouse events while it is in the background), so on return the icon was still magnified
  // with its label up until the next click. Hover effects pause when the page loses focus and
  // resume on the next real pointer move over the Dock.
  const [hoverOff, setHoverOff] = useState(false);
  useEffect(() => {
    const pause = () => {
      setHoverOff(true);
      dockRef.current?.style.setProperty("--dock-offset-left", "0px");
      dockRef.current?.style.setProperty("--dock-offset-right", "0px");
    };
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  const longPressTimer = useRef(null);

  // Exiting edit/jiggle mode when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (isJiggling && dockRef.current && !dockRef.current.contains(e.target)) {
        setIsJiggling(false);
      }
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, [isJiggling]);

  const handleAppHover = (ev) => {
    if (!dockRef.current) return;

    const mousePosition = ev.clientX;
    const rect = ev.currentTarget.getBoundingClientRect();
    const cursorDistance = (mousePosition - rect.left) / rect.width;

    const offsetPixels = scaleValue(
      cursorDistance,
      [0, 1],
      [maxAdditionalSize * -1, maxAdditionalSize]
    );

    dockRef.current.style.setProperty("--dock-offset-left", `${offsetPixels * -1}px`);
    dockRef.current.style.setProperty("--dock-offset-right", `${offsetPixels}px`);
  };

  // Long press detection for Jiggle / Edit Mode
  const handlePressStart = () => {
    if (isJiggling) return;
    longPressTimer.current = setTimeout(() => {
      setIsJiggling(true);
    }, 600); // 600ms hold
  };

  const handlePressEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
    }
  };

  const handleAppClick = (e, url) => {
    if (isJiggling) {
      e.preventDefault();
      return;
    }
  };

  const getWebsiteDomain = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch (e) {
      return url.replace(/^https?:\/\/|www\./g, "");
    }
  };

  const cachedIcons = useFavicons(bookmarks.map((app) => getWebsiteDomain(app.url)));

  // Drag and Drop reordering
  const handleDragStart = (e, index) => {
    if (!isJiggling) {
      e.preventDefault();
      return;
    }
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  // Drag and Drop reordering over
  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const items = [...bookmarks];
    const draggedItem = items[draggedIndex];
    items.splice(draggedIndex, 1);
    items.splice(index, 0, draggedItem);

    const updated = items.map((b, idx) => ({ ...b, order: idx }));
    setDraggedIndex(index);
    setBookmarks(updated);
  };

  const handleDragEnd = (e) => {
    const top = dockRef.current?.getBoundingClientRect().top ?? 0;
    const index = draggedIndex;
    setDraggedIndex(null);
    if (index !== null && e.clientY > 0 && e.clientY < top - 60) {
      removeAt(index);
      return;
    }
    localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
  };

  // Remove from Dock (its menu, or dragged out of the Dock): gone at once, as in macOS, with
  // Undo in the notification it posts.
  const removeAt = (index) => {
    const item = bookmarks[index];
    if (!item) return;
    const { list } = removeBookmark(bookmarks, index);
    saveBookmarks(list);
    setBookmarks(list);
    notify({
      app: "dock",
      title: `Removed “${item.websiteName}” from the Dock`,
      body: "Click to put it back.",
      key: `dock-removed:${item.websiteName}`,
      action: { event: "dock:restore", detail: { item, index } },
    });
  };
  const moveAt = (from, to) => {
    const { list } = moveBookmark(bookmarks, from, to);
    saveBookmarks(list);
    setBookmarks(list);
  };
  const restoreRef = useRef(null);
  useEffect(() => {
    restoreRef.current = ({ item, index }) => {
      setBookmarks((current) => {
        if (current.some((b) => b.websiteName === item.websiteName)) return current;
        const list = [...current];
        list.splice(Math.min(index, list.length), 0, item);
        const next = list.map((b, i) => ({ ...b, order: i }));
        saveBookmarks(next);
        return next;
      });
    };
  });
  useEffect(() => {
    const onRestore = (e) => e.detail?.item && restoreRef.current?.(e.detail);
    window.addEventListener("dock:restore", onRestore);
    return () => window.removeEventListener("dock:restore", onRestore);
  }, []);

  // Apps' Add App tile (and this Dock's Apps menu) open the Add App dialog.
  useEffect(() => {
    const onAdd = () => setShowAddModal(true);
    window.addEventListener("dock:add-app", onAdd);
    return () => window.removeEventListener("dock:add-app", onAdd);
  }, []);

  // Right-click menus (dock/dockMenu.js), above the icon as in macOS.
  const [menu, setMenu] = useState(null); // { anchor: { x, y }, items, label }
  const onContextMenu = (e) => {
    if (isJiggling) return;
    e.preventDefault();
    e.stopPropagation(); // not the desktop's menu too (ContextMenu.jsx)
    // The icon under the menu settles back (no magnification or label while it's open).
    setHoverOff(true);
    dockRef.current?.style.setProperty("--dock-offset-left", "0px");
    dockRef.current?.style.setProperty("--dock-offset-right", "0px");
    const li = e.target.closest("li");
    const top = dockRef.current?.getBoundingClientRect().top ?? e.clientY;
    const anchor = { x: e.clientX - 20, y: top - 8 };
    let items;
    let label = "Dock";
    const index = li?.dataset.index !== undefined ? Number(li.dataset.index) : -1;
    if (index >= 0 && bookmarks[index]) {
      label = bookmarks[index].websiteName;
      items = bookmarkMenu({ bookmark: bookmarks[index], index, count: bookmarks.length, move: moveAt, remove: removeAt });
    } else if (li?.dataset.action) {
      const app = li.dataset.action;
      const opens = { notes: onOpenNotes, music: onOpenMusicLibrary, settings: onOpenSettings, markets: restoreMarkets, news: openNews, atmosphere: openAtmosphere, frontier: openFrontier };
      label = app;
      items = appMenu({
        app,
        state: running[app],
        open: opens[app] || (() => {}),
        actions: { addApp: () => setShowAddModal(true), changeBg: onChangeBg },
      });
    } else {
      items = dockMenu();
    }
    setMenu({ anchor, items, label });
  };

  // The × badge in edit mode: removed at once, with Undo in its notification (removeAt).
  const requestDelete = (e, bookmark) => {
    e.preventDefault();
    e.stopPropagation();
    removeAt(bookmarks.findIndex((b) => b.websiteName === bookmark.websiteName));
  };

  // Add App (the sheet; the same checks as Settings → Bookmarks: libs/dock/bookmarks.js).
  const handleAddApp = ({ name, url }) => {
    const result = addBookmark(bookmarks, { name, url });
    if (result.error) return result.error;
    saveBookmarks(result.list);
    setBookmarks(result.list);
    setShowAddModal(false);
    return null;
  };

  const handleMouseLeave = () => {
    if (!dockRef.current) return;
    dockRef.current.style.setProperty("--dock-offset-left", "0px");
    dockRef.current.style.setProperty("--dock-offset-right", "0px");
  };

  return (
    <>
      <nav
        ref={dockRef}
        className={styles.dock}
        data-glass="dock"
        data-hover-off={hoverOff || resizing || undefined}
        data-resizing={resizing || undefined}
        style={{ "--dock-u": `${iconSize}px`, "--dock-m": `${magPx}px` }}
        onPointerMove={hoverOff ? () => setHoverOff(false) : undefined}
        onMouseLeave={handleMouseLeave}
        onContextMenu={onContextMenu}
      >
        <div className={`${styles.dockBg} glass-host`}>
          <GlassSurface preset="dock" />
        </div>
        <ul
          className={styles.list}
          // Like macOS, a clicked Dock icon doesn't keep focus: otherwise the next key press
          // (Escape closing the window it opened) turns it into keyboard focus and its label
          // reappears. Keyboard users still focus icons with Tab.
          onPointerUp={(e) => e.target.closest("a, button")?.blur()}
        >
          {/* ── Bookmark Icons Section ── */}
          {bookmarks.map((app, index) => {
            const domain = getWebsiteDomain(app.url);
            const step = faviconSteps[app.url] || 0;
            const lookedUp = domain in cachedIcons;
            const cached = !badCached[domain] ? cachedIcons[domain] : null;

            let src;
            if (cached) {
              src = cached;
            } else if (!lookedUp) {
              src = undefined; // checking iWebDB first, so the network isn't hit on every load
            } else if (step === 0) {
              src = `https://www.google.com/s2/favicons?sz=256&domain_url=https://${domain}`;
            } else if (step === 1) {
              // Not DuckDuckGo here: for unknown sites it answers 404 with a grey-arrow image,
              // which an <img> still shows (no error). The /api/favicon proxy checks it properly.
              src = `https://${domain}/favicon.ico`;
            } else {
              src = defaultFavicon; // no favicon anywhere: the iWeb icon
            }

            return (
              <li
                key={app.websiteName}
                data-index={index}
                className={`${styles.app} ${isJiggling ? styles.jiggling : ""}`}
                onMouseMove={handleAppHover}
                {...labelProps(`app:${app.url}`)}
                draggable={isJiggling}
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
              >
                {isJiggling && (
                  <button
                    className={styles.deleteBadge}
                    onClick={(e) => requestDelete(e, app)}
                    title="Delete link"
                  >
                    &times;
                  </button>
                )}
                <a
                  href={app.url}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.link}
                  onClick={(e) => handleAppClick(e, app.url)}
                  onMouseDown={handlePressStart}
                  onMouseUp={handlePressEnd}
                  onTouchStart={handlePressStart}
                  onTouchEnd={handlePressEnd}
                >
                  {/* While the cached icon is still being read, an empty tile, never the alt text. */}
                  {src === undefined ? (
                    <span className={styles.iconPlaceholder} aria-hidden="true" />
                  ) : (
                  <img
                    src={src}
                    onLoad={(e) => {
                      // Google S2 returns a 16x16 globe icon when a favicon is not found
                      if (!cached && step === 0 && e.currentTarget.naturalWidth === 16 && e.currentTarget.naturalHeight === 16) {
                        setFaviconSteps((prev) => ({ ...prev, [app.url]: 1 }));
                      }
                    }}
                    onError={() => {
                      if (cached) setBadCached((prev) => ({ ...prev, [domain]: true }));
                      else setFaviconSteps((prev) => ({ ...prev, [app.url]: step + 1 }));
                    }}
                    alt={app.websiteName}
                    draggable={false}
                  />
                  )}
                  {label(`app:${app.url}`, app.websiteName)}
                </a>
              </li>
            );
          })}

          {/* ── macOS-style vertical separator ── */}
          {/* Dragging it up or down resizes the Dock, as in macOS. */}
          {bookmarks.length > 0 && (
            <li
              className={styles.separator}
              aria-hidden="true"
              title="Drag up or down to resize the Dock"
              onPointerDown={onDividerDown}
              onPointerMove={onDividerMove}
              onPointerUp={onDividerUp}
              onPointerCancel={onDividerUp}
              onLostPointerCapture={onDividerUp}
            />
          )}

          {/* ── Add App Button ── */}
          {/* ── Apps (macOS 26): every app and bookmark; Add App is in it and in this icon's menu ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="apps" onMouseMove={handleAppHover} {...labelProps("apps")}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => window.dispatchEvent(new Event("apps:toggle"))}
            >
              <DockAppIcon name="add" className={styles.appIcon} />
              {label("apps", "Apps")}
            </button>
          </li>

          {/* ── Change Background Button ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="bg" onMouseMove={handleAppHover} {...labelProps("bg")}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={onChangeBg}
            >
              <DockAppIcon name="bg" className={styles.appIcon} />
              {label("bg", "Change BG")}
            </button>
          </li>
          {/* ── Notes Button ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="notes" {...runningProps("notes")} onMouseMove={handleAppHover} {...labelProps("notes")}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={onOpenNotes}
            >
              <DockAppIcon name="notes" className={styles.appIcon} />
              {label("notes", "Notes")}
            </button>
          </li>
          {/* ── Music Library Button ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="music" {...runningProps("music")} onMouseMove={handleAppHover} {...labelProps("music")}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={onOpenMusicLibrary}
            >
              <DockAppIcon name="music" className={styles.appIcon} />
              {label("music", "Music Library")}
            </button>
          </li>
          {/* ── Settings Button ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="settings" {...runningProps("settings")} onMouseMove={handleAppHover} {...labelProps("settings")}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={onOpenSettings}
            >
              <DockAppIcon name="settings" className={styles.appIcon} />
              {label("settings", "Settings")}
            </button>
          </li>
          {/* ── Markets: in the Dock only while it runs (open or minimized), like a macOS app
               that isn't kept in the Dock. It minimizes into this icon; clicking restores it. */}
          {runningProps("markets")["data-running"] && (
            <li className={`${styles.app} ${styles.action} ${styles.transient}`} data-action="markets" {...runningProps("markets")} onMouseMove={handleAppHover} {...labelProps("markets")}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={restoreMarkets}
              >
                <DockAppIcon name="markets" className={styles.appIcon} />
                {label("markets", "Markets")}
              </button>
            </li>
          )}
          {/* ── Atmosphere: likewise, while its window runs. ── */}
          {runningProps("atmosphere")["data-running"] && (
            <li className={`${styles.app} ${styles.action} ${styles.transient}`} data-action="atmosphere" {...runningProps("atmosphere")} onMouseMove={handleAppHover} {...labelProps("atmosphere")}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={openAtmosphere}
              >
                <DockAppIcon name="atmosphere" className={styles.appIcon} />
                {label("atmosphere", "Atmosphere")}
              </button>
            </li>
          )}
          {/* ── Frontier World: likewise, while its window runs. ── */}
          {runningProps("frontier")["data-running"] && (
            <li className={`${styles.app} ${styles.action} ${styles.transient}`} data-action="frontier" {...runningProps("frontier")} onMouseMove={handleAppHover} {...labelProps("frontier")}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={openFrontier}
              >
                <DockAppIcon name="frontier" className={styles.appIcon} />
                {label("frontier", "Frontier World")}
              </button>
            </li>
          )}
          {/* ── News: likewise, while it runs. ── */}
          {runningProps("news")["data-running"] && (
            <li className={`${styles.app} ${styles.action} ${styles.transient}`} data-action="news" {...runningProps("news")} onMouseMove={handleAppHover} {...labelProps("news")}>
              <button
                type="button"
                className={styles.actionBtn}
                onClick={openNews}
              >
                <DockAppIcon name="news" className={styles.appIcon} />
                {label("news", "News")}
              </button>
            </li>
          )}
        </ul>
      </nav>

      {menu && (
        <PopupMenu anchor={menu.anchor} items={menu.items} label={menu.label} onClose={() => setMenu(null)} />
      )}

      {showAddModal && <AddAppSheet onAdd={handleAddApp} onClose={() => setShowAddModal(false)} />}
    </>
  );
}
