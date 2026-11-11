// macOS 26 alerts in place of the browser's alert() and confirm() (components/dialogs/
// DialogHost.jsx shows them, one at a time):
//
//   await showAlert({ title: 'Couldn’t add the image', message: '…' });
//   if (await showConfirm({ title: 'Delete “Road trip”?', message: '…', confirmLabel: 'Delete', destructive: true })) …
//
// Both return promises: showAlert resolves when it's dismissed, showConfirm with true for the
// confirming button and false for Cancel (or Escape).
import { useSyncExternalStore } from 'react';

let queue = [];
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());
let nextId = 1;

function push(dialog) {
  return new Promise((resolve) => {
    queue = [...queue, { ...dialog, id: nextId++, resolve }];
    emit();
  });
}

export function showAlert({ title, message = '', buttonLabel = 'OK' }) {
  return push({ kind: 'alert', title, message, confirmLabel: buttonLabel }).then(() => undefined);
}

export function showConfirm({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', destructive = false }) {
  return push({ kind: 'confirm', title, message, confirmLabel, cancelLabel, destructive });
}

/** Closes the front dialog with `value` (true: its main button). */
export function answer(value) {
  const [front, ...rest] = queue;
  if (!front) return;
  queue = rest;
  emit();
  front.resolve(Boolean(value));
}

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getFront = () => queue[0] || null;
export const useFrontDialog = () => useSyncExternalStore(subscribe, getFront, getFront);

export function _resetDialogs() {
  queue = [];
}
