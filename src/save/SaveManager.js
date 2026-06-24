// ============================================================================
// LuckEngine-Web — src/save/SaveManager.js
// ----------------------------------------------------------------------------
// Sauvegardes côté client via IndexedDB (store dédié "saves"). Chaque slot
// contient l'état du VM + variables + une vignette (dataURL PNG) + métadonnées.
// IndexedDB est préféré à localStorage car les vignettes dépassent vite ~5 Mo.
// Fallback mémoire si IndexedDB indisponible (ex : Node, pour les tests).
// ============================================================================

const DB_NAME = "LuckEngineWeb";
const STORE = "saves";
const VERSION = 2; // bump pour créer le store "saves" à côté de "files"

const hasIDB = (() => { try { return typeof indexedDB !== "undefined"; } catch { return false; } })();
const mem = new Map(); // fallback hors navigateur

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("files")) db.createObjectStore("files", { keyPath: "name" });
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "slot" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class SaveManager {
  constructor() { this.ready = hasIDB; }

  // Enregistre un slot. `record` = { state, vars, thumb, meta }.
  async put(slot, record) {
    const entry = { slot: String(slot), ...record, ts: Date.now() };
    if (!hasIDB) { mem.set(String(slot), entry); return entry; }
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    return entry;
  }

  // Lit un slot (ou null).
  async get(slot) {
    if (!hasIDB) return mem.get(String(slot)) || null;
    const db = await openDB();
    return new Promise((res, rej) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(String(slot));
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => rej(req.error);
    });
  }

  // Liste tous les slots existants (triés par numéro de slot).
  async list() {
    if (!hasIDB) return [...mem.values()].sort((a, b) => +a.slot - +b.slot);
    const db = await openDB();
    return new Promise((res, rej) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => res((req.result || []).sort((a, b) => +a.slot - +b.slot));
      req.onerror = () => rej(req.error);
    });
  }

  // Supprime un slot.
  async remove(slot) {
    if (!hasIDB) { mem.delete(String(slot)); return; }
    const db = await openDB();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(String(slot));
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  }
}
