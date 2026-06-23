// ============================================================================
// LuckEngine-Web — src/app/boot.js
// ----------------------------------------------------------------------------
// Démarrage : si le jeu est déjà importé (IndexedDB) -> lancement automatique.
// Sinon -> écran d'import (glisser le dossier de jeu ou choisir les .PAK),
// puis stockage + lancement. Aux fois suivantes : plus aucune manip.
// ============================================================================

import { CanvasRenderer } from "../render/CanvasRenderer.js";
import { Game } from "./Game.js";
import { CONFIG } from "./config.js";
import { AssetStore } from "../assets/AssetStore.js";

const store = new AssetStore();
const canvas = document.querySelector("#game");
const overlay = document.querySelector("#import");
const renderer = new CanvasRenderer(canvas);

// langue : localStorage > CONFIG par défaut
const savedLang = (() => { try { return localStorage.getItem("luck.lang"); } catch { return null; } })();
const game = new Game(renderer, { lang: savedLang || CONFIG.lang });

// --- DIAGNOSTIC : expose `game` + un dump audio dans la console -------------
// Tape `audioDiag()` dans la console F12 après chargement pour voir les PAK
// audio, leurs plages d'id et des exemples de NOMS d'entrées (clé pour
// comprendre le mapping id-script -> fichier).
window.game = game;
window.audioDiag = function () {
  const paks = game.audioPaks || [];
  if (!paks.length) { console.warn("audioDiag: aucun PAK audio chargé."); return; }
  for (const { name, pak } of paks) {
    const e = pak.listEntries();
    const head = e.slice(0, 12).map((x) => `${x.id}:${x.name}`).join("  ");
    const tail = e.slice(-4).map((x) => `${x.id}:${x.name}`).join("  ");
    console.log(`AUDIO ${name} — ${e.length} entrées | ids ${e[0]?.id}..${e[e.length - 1]?.id}`);
    console.log(`   début: ${head}`);
    console.log(`   fin  : ${tail}`);
  }
  console.log("Astuce: tape `voiceDiag(true)` puis avance dans une scène voisée pour logger l'id voix de chaque MESSAGE.");
};
window.voiceDiag = function (on = true) { game.voiceDiag = !!on; console.log("voiceDiag:", game.voiceDiag ? "ON" : "OFF"); };
// DIAG médaillon : force l'affichage d'une date, et liste les noms jul_/aug_ trouvés.
window.testBadge = function (month = 7, day = 19) {
  game._updateDateBadge(month, day);
};
window.badgeDiag = function () {
  if (!game.imagePaks) { console.warn("Pas d'imagePaks"); return; }
  for (const { name, pak } of game.imagePaks) {
    const hits = pak.listEntries().filter((e) => /^(jul|aug|day)_/i.test(e.name || ""));
    if (hits.length) console.log(`${name}: ${hits.slice(0, 8).map((e) => `${e.id}:${e.name}`).join("  ")} … (${hits.length} total)`);
  }
};

function wireLangBar() {
  const bar = document.querySelector("#langbar");
  if (!bar) return;
  const sync = () =>
    bar.querySelectorAll("button").forEach((b) =>
      b.classList.toggle("active", b.dataset.lang === game.lang)
    );
  bar.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      game.setLang(b.dataset.lang);
      try { localStorage.setItem("luck.lang", b.dataset.lang); } catch {}
      sync();
    })
  );
  sync();
}
wireLangBar();

canvas.addEventListener("click", (ev) => {
  if (game.audio) game.audio.resume(); // débloque l'audio au 1er geste
  const r = canvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * (canvas.width / r.width);
  const py = (ev.clientY - r.top) * (canvas.height / r.height);
  const hit = renderer.hitChoice(px, py);
  if (hit >= 0) game.choose(hit);
  else game.advance();
});

// Touche L : affiche/masque l'overlay de debug des couches (cadre + n° par couche).
window.addEventListener("keydown", (ev) => {
  const k = ev.key.toLowerCase();
  if (k === "l") {
    game.layerDebug = !game.layerDebug;
    console.log("Layer debug:", game.layerDebug ? "ON" : "OFF", "(touche L)");
    game._redraw();
  } else if (k === "s") {
    renderer.smoothing = !renderer.smoothing;
    console.log("Lissage (imageSmoothing):", renderer.smoothing ? "ON" : "OFF", "(touche S)");
    game._redraw();
  } else if (k === "p") {
    console.log("Export des couches en PNG natif… (touche P)");
    game.dumpLayers();
  } else if (k === "o") {
    game.hideOverlays = !game.hideOverlays;
    console.log("Compléments de décor:", game.hideOverlays ? "MASQUÉS" : "affichés", "(touche O)");
    game._redraw();
  } else if (k === "a") {
    syncCtrl(game.setAuto());          // A = bascule Auto
  } else if (ev.ctrlKey || k === "control") {
    if (!game.skipMode) syncCtrl(game.setSkip(true)); // Ctrl maintenu = Skip
  } else if (k === "v") {
    game.replayVoice();                // V = rejoue la voix
  }
});
window.addEventListener("keyup", (ev) => {
  if (ev.key === "Control") { game.setSkip(false); syncCtrl(); } // relâche Ctrl = stop Skip
});

// Synchronise l'état visuel des boutons de contrôle avec le moteur.
function syncCtrl() {
  document.querySelector("#btn-auto")?.classList.toggle("active", !!game.autoMode);
  document.querySelector("#btn-skip")?.classList.toggle("active", !!game.skipMode);
}

// Câblage des boutons de contrôle (Auto / Skip / Voice / Menu système).
function wireControls() {
  document.querySelector("#btn-auto")?.addEventListener("click", () => { game.setAuto(); syncCtrl(); });
  document.querySelector("#btn-skip")?.addEventListener("click", () => { game.setSkip(); syncCtrl(); });
  document.querySelector("#btn-voice")?.addEventListener("click", () => game.replayVoice());
  document.querySelector("#btn-sysmenu")?.addEventListener("click", () => {
    console.log("Menu système : à implémenter (save/load/config/titre)");
  });
}
wireControls();

// ---- collecte de fichiers (input dossier / multi / glisser-déposer) --------
function isPak(name) {
  return /\.pak$/i.test(name);
}
function isMovie(name) {
  return /\.(webm|mp4|ogv)$/i.test(name);
}

async function filesToMap(fileList) {
  const map = new Map();
  for (const f of fileList) {
    if (isPak(f.name) || isMovie(f.name)) map.set(f.name, await f.arrayBuffer());
  }
  return map;
}

// Lecture récursive d'un dossier glissé (DataTransferItem)
function readAllEntries(reader) {
  return new Promise((resolve) => {
    const all = [];
    const step = () =>
      reader.readEntries((ents) => {
        if (!ents.length) return resolve(all);
        all.push(...ents);
        step();
      });
    step();
  });
}
async function walkEntry(entry, out) {
  if (entry.isFile) {
    const f = await new Promise((res) => entry.file(res));
    out.push(f);
  } else if (entry.isDirectory) {
    const ents = await readAllEntries(entry.createReader());
    for (const e of ents) await walkEntry(e, out);
  }
}
async function dropToMap(dataTransfer) {
  const items = [...dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  const files = [];
  if (items.length) {
    for (const e of items) await walkEntry(e, files);
  } else {
    files.push(...dataTransfer.files);
  }
  return filesToMap(files);
}

// ---- chargement des PAK (une fois) ----------------------------------------
async function loadAll() {
  const buf = await store.getFile(CONFIG.scriptPak);
  if (!buf) throw new Error(`${CONFIG.scriptPak} absent du stockage`);
  game.loadPakBuffer(buf);
  for (const name of CONFIG.imagePaks || []) {
    try {
      const img = await store.getFile(name);
      if (img) game.loadImagePak(img, name);
    } catch (e) {
      console.warn(`${name} indisponible:`, e.message);
    }
  }
  if (game.imagePaks && game.imagePaks.length) {
    for (const { name, pak } of game.imagePaks) {
      const list = pak.listEntries();
      console.log(`CG ${name}: ${list.length} entrées, ids ${list[0]?.id}..${list[list.length - 1]?.id}`);
    }
  } else {
    console.warn("Aucun CG pak chargé — réimporte en incluant BGCG.PAK et CHARCG.PAK.");
  }
  // PAK audio : on SCANNE les fichiers importés et on charge tout ce qui ressemble
  // à de l'audio (VOICE/SE/BGM dans le nom), quel que soit le nom exact du BGM.
  const knownPaks = new Set([CONFIG.scriptPak, ...(CONFIG.imagePaks || [])].map((n) => n.toUpperCase()));
  let audioNames = [];
  try {
    audioNames = (await store.listFiles()).filter((n) => !knownPaks.has(n) && /VOICE|BGM|MUSIC|SE/i.test(n));
  } catch {}
  for (const name of audioNames) {
    try {
      const buf2 = await store.getFile(name);
      if (buf2) {
        const list = game.loadAudioPak(buf2, name);
        console.log(`AUDIO ${name}: ${list.length} entrées, ids ${list[0]?.id}..${list[list.length - 1]?.id}`);
      }
    } catch (e) {
      console.warn(`${name} indisponible:`, e.message);
    }
  }
  if (!game.audioPaks || !game.audioPaks.length) {
    console.info("Aucun PAK audio chargé — importe voice.PAK / SE.PAK / BGM.PAK pour le son.");
  }
  // UI : précharge la fenêtre de dialogue (MWIN) et les choix (SELWIN) depuis
  // PARTS.PAK pour un rendu fidèle au jeu original.
  try { await game.loadUiSkin(); } catch (e) { console.warn("UI skin:", e.message); }
  // VIDÉOS : on scanne les .webm/.mp4/.ogv importés (opening AIR_OP_A/B, etc.).
  // Le VM les jouera sur l'opcode MOVIE. On garde les octets bruts par nom.
  try {
    const vids = (await store.listFiles()).filter((n) => /\.(webm|mp4|ogv)$/i.test(n));
    for (const name of vids) {
      const buf = await store.getFile(name);
      if (buf) game.addMovie(name, buf);
    }
    if (vids.length) console.log(`VIDÉO : ${vids.length} fichier(s) — ${vids.join(", ")}`);
    else {
      console.info("Aucune vidéo importée — l'opening (AIR_OP_A/B) ne pourra pas jouer.");
      showVidBanner(); // propose d'ajouter les vidéos sans tout réimporter
    }
  } catch (e) { console.warn("scan vidéos:", e.message); }
}

// Bannière de rattrapage : ajoute juste les vidéos au store existant.
function showVidBanner() {
  const banner = document.querySelector("#vidbanner");
  const input = document.querySelector("#addvid");
  const close = document.querySelector("#vidclose");
  if (!banner || !input) return;
  banner.style.display = "block";
  close?.addEventListener("click", () => { banner.style.display = "none"; });
  input.addEventListener("change", async (e) => {
    const files = [...e.target.files].filter((f) => /\.(webm|mp4|ogv)$/i.test(f.name));
    if (!files.length) return;
    const map = new Map();
    for (const f of files) map.set(f.name, await f.arrayBuffer());
    await store.saveFiles(map);
    for (const [name, buf] of map) game.addMovie(name, buf);
    console.log(`VIDÉO ajoutée(s) : ${[...map.keys()].join(", ")}`);
    banner.style.display = "none";
  });
}

// ---- menu de sélection d'entrée (= choix de chapitre provisoire) -----------
function buildMenu(filter = "") {
  const listEl = document.querySelector("#entrylist");
  listEl.innerHTML = "";
  const f = filter.trim().toLowerCase();
  const entries = game.listEntries().slice().sort((a, b) =>
    String(a.name).localeCompare(String(b.name), undefined, { numeric: true })
  );
  for (const e of entries) {
    const label = `${e.name}`;
    if (f && !label.toLowerCase().includes(f) && !String(e.index).includes(f)) continue;
    const b = document.createElement("button");
    b.textContent = `#${e.index} ${e.name}`;
    b.addEventListener("click", () => playRef(e.index));
    listEl.appendChild(b);
  }
}
function showMenu() { buildMenu(); document.querySelector("#menu").classList.add("show"); }
function hideMenu() { document.querySelector("#menu").classList.remove("show"); }

function playRef(ref) {
  hideMenu();
  try { localStorage.setItem("luck.entry", String(ref)); } catch {}
  renderer.drawText("Chargement…");
  game.playEntry(ref).catch((err) => {
    renderer.drawText("Erreur : " + err.message);
    console.error(err);
  });
}

function wireMenu() {
  document.querySelector("#menubtn").addEventListener("click", showMenu);
  document.querySelector("#entrysearch").addEventListener("input", (e) => buildMenu(e.target.value));
}

async function importMap(map) {
  const hasScript = [...map.keys()].some((k) => /SCRIPT\.PAK$/i.test(k));
  if (!hasScript) {
    setStatus("SCRIPT.PAK introuvable dans ce que tu as déposé.");
    return;
  }
  setStatus("Import en cours…");
  await store.saveFiles(map);
  overlay.classList.remove("show");
  await loadAll();
  showTitle(); // 1re fois : écran titre comme le vrai jeu
}

function setStatus(t) {
  const el = document.querySelector("#import-status");
  if (el) el.textContent = t;
}

function wireImportUI() {
  const drop = document.querySelector("#dropzone");
  const dirInput = document.querySelector("#dir");
  const fileInput = document.querySelector("#files");
  const reset = document.querySelector("#reset");

  ["dragenter", "dragover"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add("over");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove("over");
    })
  );
  drop.addEventListener("drop", async (e) => {
    try {
      await importMap(await dropToMap(e.dataTransfer));
    } catch (err) {
      setStatus("Erreur : " + err.message);
    }
  });
  dirInput.addEventListener("change", async (e) => {
    try {
      await importMap(await filesToMap(e.target.files));
    } catch (err) {
      setStatus("Erreur : " + err.message);
    }
  });
  fileInput.addEventListener("change", async (e) => {
    try {
      await importMap(await filesToMap(e.target.files));
    } catch (err) {
      setStatus("Erreur : " + err.message);
    }
  });
  if (reset)
    reset.addEventListener("click", async () => {
      await store.clear();
      location.reload();
    });
}

async function boot() {
  wireImportUI();
  wireMenu();
  wireTitle();
  try {
    if (await store.hasGame(CONFIG.scriptPak)) {
      await loadAll();
      showTitle(); // écran titre (NEW GAME / LOAD / …) comme le vrai jeu
    } else {
      overlay.classList.add("show"); // 1re fois -> import
    }
  } catch (err) {
    console.error(err);
    overlay.classList.add("show");
    setStatus("Erreur : " + err.message);
  }
}

// ---- Écran titre (style AIR) -----------------------------------------------
function showTitle() {
  const el = document.querySelector("#title");
  const bg = document.querySelector("#title-bg");
  if (bg && !bg.src) {
    const url = game.titleImageURL("title1a");
    if (url) bg.src = url;
  }
  // au 1er lancement (pas de sauvegarde), LOAD est grisé
  let hasSave = false;
  try { hasSave = !!localStorage.getItem("luck.save"); } catch {}
  const loadBtn = document.querySelector('.title-btn[data-act="load"]');
  if (loadBtn) loadBtn.disabled = !hasSave;
  if (el) el.style.display = "block";
}
function hideTitle() {
  const el = document.querySelector("#title");
  if (el) el.style.display = "none";
}
function wireTitle() {
  document.querySelectorAll(".title-btn").forEach((b) => {
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "new") { hideTitle(); try { localStorage.removeItem("luck.entry"); } catch {}; playRef(CONFIG.startEntry); }
      else if (act === "load") { console.log("LOAD : menu de chargement à venir"); }
      else if (act === "options") { console.log("OPTIONS : config à venir"); }
      else if (act === "manual") { console.log("MANUAL : manuel à venir"); }
      else if (act === "exit") { hideTitle(); showMenu(); } // EXIT -> menu chapitres (debug)
    });
  });
}

console.log("LuckEngine-Web boot v3.16 — scan auto des PAK audio + BGM (id = u16 non nul)");
boot();
