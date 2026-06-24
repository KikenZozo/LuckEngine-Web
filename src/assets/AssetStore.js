// ============================================================================
// LuckEngine-Web — src/assets/AssetStore.js
// ----------------------------------------------------------------------------
// Stockage persistant des fichiers du jeu (PAK) dans IndexedDB.
// Le joueur importe SES fichiers une fois ; ils sont rejoués automatiquement
// aux lancements suivants. Aucun asset n'est hébergé côté serveur.
// ============================================================================

const DB_NAME = "LuckEngineWeb";
const STORE = "files";
const VERSION = 2; // v2 : ajout du store "saves" (cf. SaveManager)

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "name" });
      }
      // garde les deux stores cohérents quel que soit le module qui ouvre en 1er
      if (!db.objectStoreNames.contains("saves")) {
        db.createObjectStore("saves", { keyPath: "slot" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Normalise un chemin/nom en NOM DE FICHIER MAJUSCULE (clé stable).
function keyOf(nameOrPath) {
  const base = String(nameOrPath).split(/[\\/]/).pop();
  return base.toUpperCase();
}

export class AssetStore {
  /** Enregistre une Map<nom, ArrayBuffer>. */
  async saveFiles(fileMap) {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      for (const [name, bytes] of fileMap) {
        os.put({ name: keyOf(name), bytes });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  /** @returns {Promise<ArrayBuffer|null>} */
  async getFile(name) {
    const db = await openDB();
    const out = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(keyOf(name));
      req.onsuccess = () => resolve(req.result ? req.result.bytes : null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return out;
  }

  /** @returns {Promise<string[]>} noms stockés */
  async listFiles() {
    const db = await openDB();
    const keys = await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return keys;
  }

  /** Le jeu est-il déjà importé ? (présence du script principal) */
  async hasGame(scriptPak = "SCRIPT.PAK") {
    const keys = await this.listFiles();
    return keys.includes(keyOf(scriptPak));
  }

  async clear() {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
}
