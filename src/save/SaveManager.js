// ============================================================================
// LuckEngine-Web — src/save/SaveManager.js
// ----------------------------------------------------------------------------
// Sauvegardes via localStorage (navigateur). Fallback mémoire si indisponible
// (ex: Node), pour que l'import du module ne casse pas hors navigateur.
// ============================================================================

const hasLocalStorage = (() => {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
})();

const mem = new Map();

export class SaveManager {
  constructor(dbName = "LuckEngineWeb") {
    this.dbName = dbName;
  }

  _key(slot) {
    return `${this.dbName}:save:${slot}`;
  }

  save(slot, data) {
    const v = JSON.stringify(data);
    if (hasLocalStorage) localStorage.setItem(this._key(slot), v);
    else mem.set(this._key(slot), v);
  }

  load(slot) {
    const raw = hasLocalStorage
      ? localStorage.getItem(this._key(slot))
      : mem.get(this._key(slot));
    return raw ? JSON.parse(raw) : null;
  }

  reset(slot) {
    if (hasLocalStorage) localStorage.removeItem(this._key(slot));
    else mem.delete(this._key(slot));
  }
}
