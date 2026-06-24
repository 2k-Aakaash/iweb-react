import React, { useState, useRef, useEffect } from "react";
import styles from "./Dock.module.css";

const defaultFavicon = "https://ik.imagekit.io/026k2i7ys/iWeb%20Favicon.svg?updatedAt=1700227200100";
const maxAdditionalSize = 5;

const scaleValue = (value, from, to) => {
  const scale = (to[1] - to[0]) / (from[1] - from[0]);
  const capped = Math.min(from[1], Math.max(from[0], value)) - from[0];
  return Math.floor(capped * scale + to[0]);
};

export default function Dock({ bookmarks = [], setBookmarks, onChangeBg, onOpenNotes, onOpenSettings }) {
  const [isJiggling, setIsJiggling] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState({ show: false, bookmark: null });
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const [draggedIndex, setDraggedIndex] = useState(null);
  const [faviconSteps, setFaviconSteps] = useState({});

  const dockRef = useRef(null);
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
        onMouseLeave={handleMouseLeave}
      >
        <div className={styles.dockBg} />
        <ul className={styles.list}>
          {/* ── Bookmark Icons Section ── */}
          {bookmarks.map((app, index) => {
            const domain = getWebsiteDomain(app.url);
            const step = faviconSteps[app.url] || 0;

            let src;
            if (step === 0) {
              src = `https://www.google.com/s2/favicons?sz=256&domain_url=https://${domain}`;
            } else if (step === 1) {
              src = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
            } else if (step === 2) {
              src = `https://${domain}/favicon.ico`;
            } else {
              src = defaultFavicon;
            }

            return (
              <li
                key={app.websiteName}
                className={`${styles.app} ${isJiggling ? styles.jiggling : ""}`}
                onMouseMove={handleAppHover}
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
                  title={app.websiteName}
                  onClick={(e) => handleAppClick(e, app.url)}
                  onMouseDown={handlePressStart}
                  onMouseUp={handlePressEnd}
                  onTouchStart={handlePressStart}
                  onTouchEnd={handlePressEnd}
                >
                  <img
                    src={src}
                    onLoad={(e) => {
                      // Google S2 returns a 16x16 globe icon when a favicon is not found
                      if (step === 0 && e.currentTarget.naturalWidth === 16 && e.currentTarget.naturalHeight === 16) {
                        setFaviconSteps((prev) => ({ ...prev, [app.url]: 1 }));
                      }
                    }}
                    onError={() => {
                      setFaviconSteps((prev) => ({ ...prev, [app.url]: step + 1 }));
                    }}
                    alt={app.websiteName}
                    draggable={false}
                  />
                  <span className={`${styles.tooltip} ${styles.liquidBtn}`}>
                    {app.websiteName}
                  </span>
                </a>
              </li>
            );
          })}

          {/* ── macOS-style vertical separator ── */}
          {bookmarks.length > 0 && (
            <li className={styles.separator} aria-hidden="true" />
          )}

          {/* ── Add App Button ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="add" onMouseMove={handleAppHover}>
            <button
              type="button"
              className={styles.actionBtn}
              title="Add app"
              onClick={() => setShowAddModal(true)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.actionIcon}
              >
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
              <span className={`${styles.tooltip} ${styles.liquidBtn}`}>Add app</span>
            </button>
          </li>

          {/* ── Change Background Button ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="bg" onMouseMove={handleAppHover}>
            <button
              type="button"
              className={styles.actionBtn}
              title="Change background"
              onClick={onChangeBg}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.actionIcon}
              >
                {/* Mountains / landscape wallpaper icon */}
                <rect x="3" y="3" width="18" height="18" rx="3" ry="3" />
                <polyline points="3 16 8 11 12 14 16 9 21 14" />
                <circle cx="8.5" cy="7.5" r="1.5" />
              </svg>
              <span className={`${styles.tooltip} ${styles.liquidBtn}`}>Change BG</span>
            </button>
          </li>
          {/* ── Notes Button ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="notes" onMouseMove={handleAppHover}>
            <button
              type="button"
              className={styles.actionBtn}
              title="Notes"
              onClick={onOpenNotes}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.actionIcon}
              >
                {/* Note / Notepad icon */}
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="9" y1="9" x2="15" y2="9" />
                <line x1="9" y1="13" x2="15" y2="13" />
                <line x1="9" y1="17" x2="13" y2="17" />
              </svg>
              <span className={`${styles.tooltip} ${styles.liquidBtn}`}>Notes</span>
            </button>
          </li>
          {/* ── Settings Button ── */}
          <li className={`${styles.app} ${styles.action}`} data-action="settings" onMouseMove={handleAppHover}>
            <button
              type="button"
              className={styles.actionBtn}
              title="Settings"
              onClick={onOpenSettings}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={styles.actionIcon}
              >
                {/* Gear settings icon */}
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span className={`${styles.tooltip} ${styles.liquidBtn}`}>Settings</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm.show && (
        <div className={styles.confirmOverlay}>
          <div className="confirmation-dialog">
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
          <div className="remove-bg-content" style={{ maxWidth: "400px", padding: "20px", position: "relative" }}>
            <div className="window-controls">
              <span className="window-dot dot-close" onClick={() => setShowAddModal(false)}></span>
              <span className="window-dot dot-minimize"></span>
              <span className="window-dot dot-maximize"></span>
            </div>
            <div className="navbar" style={{ borderBottom: "none", paddingTop: "15px" }}>
              <p className="navbar-text">Add New App Link</p>
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
                style={{ width: "100%", height: "40px", marginTop: "10px" }}
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
