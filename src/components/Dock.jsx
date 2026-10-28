import React, { useState, useRef, useEffect } from "react";
import styles from "./Dock.module.css";
import GlassSurface from "./glass/GlassSurface";
import DockAppIcon from "./dock/DockAppIcon";
import { WINDOW_EVENT } from "../libs/window/useMacWindow";
import { useFavicons } from "../libs/favicons/useFavicons";

const defaultFavicon = "https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100";
const maxAdditionalSize = 5;

const scaleValue = (value, from, to) => {
  const scale = (to[1] - to[0]) / (from[1] - from[0]);
  const capped = Math.min(from[1], Math.max(from[0], value)) - from[0];
  return Math.floor(capped * scale + to[0]);
};

export default function Dock({ bookmarks = [], setBookmarks, onChangeBg, onOpenNotes, onOpenSettings, onOpenMusicLibrary }) {
  const [isJiggling, setIsJiggling] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  // Escape closes the Add App dialog.
  useEffect(() => {
    if (!showAddModal) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setShowAddModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showAddModal]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState({ show: false, bookmark: null });
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

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

  const handleDragEnd = () => {
    localStorage.setItem("bookmarks", JSON.stringify(bookmarks));
    setDraggedIndex(null);
  };

  // Deletion logic
  const requestDelete = (e, bookmark) => {
    e.preventDefault();
    e.stopPropagation();
    setShowDeleteConfirm({ show: true, bookmark });
  };

  const handleConfirmDelete = () => {
    const target = showDeleteConfirm.bookmark;
    if (!target) return;

    const updated = bookmarks.filter((b) => b.websiteName !== target.websiteName);
    localStorage.setItem("bookmarks", JSON.stringify(updated));
    setBookmarks(updated);
    setShowDeleteConfirm({ show: false, bookmark: null });
  };

  // Adding App logic
  const handleAddApp = () => {
    let url = newUrl.trim();
    let name = newName.trim();

    if (!url || !name) {
      alert("Please enter both a name and URL.");
      return;
    }

    if (!/^((ftp|http|https):\/\/|www\.)[^ "]+$/.test(url)) {
      url = "https://www." + url + ".com";
    }

    const domain = getWebsiteDomain(url);
    const favicon = `https://www.google.com/s2/favicons?sz=256&domain_url=${url}`;
    const maxOrder = bookmarks.length > 0 ? Math.max(...bookmarks.map((b) => b.order || 0)) : 0;

    const newB = {
      url,
      favicon,
      websiteName: name,
      order: maxOrder + 1,
    };

    const updated = [...bookmarks, newB];
    localStorage.setItem("bookmarks", JSON.stringify(updated));
    setBookmarks(updated);

    setNewName("");
    setNewUrl("");
    setShowAddModal(false);
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
        data-hover-off={hoverOff || undefined}
        onPointerMove={hoverOff ? () => setHoverOff(false) : undefined}
        onMouseLeave={handleMouseLeave}
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
          {bookmarks.length > 0 && (
            <li className={styles.separator} aria-hidden="true" />
          )}

          {/* ── Add App Button ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="add" onMouseMove={handleAppHover} {...labelProps("add")}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => setShowAddModal(true)}
            >
              <DockAppIcon name="add" className={styles.appIcon} />
              {label("add", "Add app")}
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
        </ul>
      </nav>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm.show && (
        <div className={styles.confirmOverlay}>
          <div className="confirmation-dialog glass-host">
            <GlassSurface preset="window" />
            <p>
              Are you sure you want to delete the selected link? This action cannot be undone.
            </p>
            <button className="delete-button" onClick={handleConfirmDelete}>
              Delete
            </button>
            <button
              className="cancel-button"
              onClick={() => setShowDeleteConfirm({ show: false, bookmark: null })}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add App Modal */}
      {showAddModal && (
        <div className="remove-bg-window" style={{ display: "block" }}>
          <div className="remove-bg-content glass-host" style={{ maxWidth: "400px", padding: "20px", position: "relative" }}>
            <GlassSurface preset="window" />
            {/* A small dialog, not an app window: close only, title centred (macOS sheet). */}
            <div className={styles.dialogHeader}>
              <div className={`window-controls ${styles.dialogControls}`}>
                <span className="window-dot dot-close" role="button" aria-label="Close" onClick={() => setShowAddModal(false)}></span>
              </div>
              <h2 className={styles.dialogTitle}>Add New App Link</h2>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "15px",
                marginTop: "15px",
              }}
            >
              <input
                type="text"
                placeholder="App Name (e.g. Reddit)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="link-input"
                style={{
                  width: "100%",
                  height: "35px",
                  padding: "5px 10px",
                  boxSizing: "border-box",
                }}
              />
              <input
                type="text"
                placeholder="URL (e.g. reddit.com)"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="link-input"
                style={{
                  width: "100%",
                  height: "35px",
                  padding: "5px 10px",
                  boxSizing: "border-box",
                }}
              />
              <button
                className="add-bookmark"
                style={{ width: "100%", height: "40px", marginTop: 0 }}
                onClick={handleAddApp}
              >
                Add App
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
