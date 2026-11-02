// Opens the widget gallery (Settings → Widgets) on one widget, e.g. a Creator widget's
// "Manage Accounts…". Settings mounts on first open, after the event has fired, so the
// request is also kept here for the gallery to pick up when it mounts.

export const GALLERY_FOCUS_EVENT = 'settings:open';
let pending = null;

export function openGalleryOn(id) {
  pending = id;
  window.dispatchEvent(new CustomEvent(GALLERY_FOCUS_EVENT, { detail: { tab: 'widgets', widget: id } }));
}

/** The widget the gallery was asked to show, once (null if none). */
export function takeGalleryFocus() {
  const id = pending;
  pending = null;
  return id;
}
