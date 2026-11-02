// Creator widget storage in iWebDB:
//   creator_accounts  — one row per account: who it is, how it's connected (the sealed
//                       grant, owner accounts only), its latest data and last error
//   creator_snapshots — lifetime counters after each successful refresh (snapshots.js)
// Neither store is part of backups: grants belong to this device, and history rebuilds.
import { openIwebDB, reqToPromise, STORES, txDone } from '../wallpaper/db.js';
import { pruneSnapshots } from './snapshots.js';

export async function readAccounts() {
  const db = await openIwebDB();
  return (await reqToPromise(db.transaction(STORES.CREATOR_ACCOUNTS, 'readonly').objectStore(STORES.CREATOR_ACCOUNTS).getAll())) || [];
}

export async function readAccount(id) {
  const db = await openIwebDB();
  return (await reqToPromise(db.transaction(STORES.CREATOR_ACCOUNTS, 'readonly').objectStore(STORES.CREATOR_ACCOUNTS).get(id))) || null;
}

export async function writeAccount(account) {
  const db = await openIwebDB();
  const tx = db.transaction(STORES.CREATOR_ACCOUNTS, 'readwrite');
  tx.objectStore(STORES.CREATOR_ACCOUNTS).put(account);
  await txDone(tx);
}

/** Removes an account and everything kept for it. */
export async function deleteAccount(id) {
  const db = await openIwebDB();
  const tx = db.transaction([STORES.CREATOR_ACCOUNTS, STORES.CREATOR_SNAPSHOTS], 'readwrite');
  tx.objectStore(STORES.CREATOR_ACCOUNTS).delete(id);
  const snapshots = tx.objectStore(STORES.CREATOR_SNAPSHOTS);
  const keys = await reqToPromise(snapshots.index('accountId').getAllKeys(id));
  for (const key of keys || []) snapshots.delete(key);
  await txDone(tx);
}

export async function readSnapshots(accountId) {
  const db = await openIwebDB();
  const store = db.transaction(STORES.CREATOR_SNAPSHOTS, 'readonly').objectStore(STORES.CREATOR_SNAPSHOTS);
  const list = (await reqToPromise(store.index('accountId').getAll(accountId))) || [];
  return list.sort((a, b) => a.at - b.at);
}

/** Adds a snapshot and applies the retention rules; resolves to the kept list (oldest first). */
export async function addSnapshot(snapshot, now = Date.now()) {
  const db = await openIwebDB();
  const tx = db.transaction(STORES.CREATOR_SNAPSHOTS, 'readwrite');
  const store = tx.objectStore(STORES.CREATOR_SNAPSHOTS);
  const row = { ...snapshot, key: `${snapshot.accountId}|${snapshot.at}` };
  store.put(row);
  const existing = (await reqToPromise(store.index('accountId').getAll(snapshot.accountId))) || [];
  const all = existing.some((s) => s.key === row.key) ? existing : [...existing, row];
  const kept = pruneSnapshots(all, now);
  const keep = new Set(kept.map((s) => s.key));
  for (const s of all) if (!keep.has(s.key)) store.delete(s.key);
  await txDone(tx);
  return kept;
}
