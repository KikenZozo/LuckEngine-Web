// ============================================================================
// LuckEngine-Web — src/app/boot.js
// ----------------------------------------------------------------------------
// Démarrage : si le jeu est déjà importé (IndexedDB) -> lancement automatique.
// Sinon -> écran d'import (glisser le dossier de jeu ou choisir les .PAK),
// puis stockage + lancement. Aux fois suivantes : plus aucune manip.
// ============================================================================
const DEBUG = (() => { try { return /[?&]debug\b/.test(location.search); } catch { return false; } })();
const dlog = (...a) => { if (DEBUG) console.log(...a); };


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
    dlog(`AUDIO ${name} — ${e.length} entrées | ids ${e[0]?.id}..${e[e.length - 1]?.id}`);
    dlog(`   début: ${head}`);
    dlog(`   fin  : ${tail}`);
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
  if (game.audio) { game.audio.resume(); applySavedVolumes(); } // débloque l'audio + volumes
  const r = canvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * (canvas.width / r.width);
  const py = (ev.clientY - r.top) * (canvas.height / r.height);
  const hit = renderer.hitChoice(px, py);
  if (hit >= 0) game.choose(hit);
  else game.advance();
});

// Survol de la souris : met en évidence le choix sous le curseur (SELWIN_s + son).
canvas.addEventListener("mousemove", (ev) => {
  if (!game._activeChoices) { canvas.style.cursor = ""; return; } // seulement pendant un choix
  const r = canvas.getBoundingClientRect();
  const px = (ev.clientX - r.left) * (canvas.width / r.width);
  const py = (ev.clientY - r.top) * (canvas.height / r.height);
  const hit = renderer.hitChoice(px, py);
  canvas.style.cursor = hit >= 0 ? "pointer" : "";
  game.hoverChoice(hit);
});

// Touche L : affiche/masque l'overlay de debug des couches (cadre + n° par couche).
window.addEventListener("keydown", (ev) => {
  const k = ev.key.toLowerCase();
  if (k === "escape") {
    // Échap : ferme le menu ouvert, sinon ouvre le menu système.
    const sys = document.querySelector("#sysmenu");
    const sav = document.querySelector("#savemenu");
    const opt = document.querySelector("#optionsmenu");
    if (opt && opt.style.display === "block") { opt.style.display = "none"; }
    else if (sav && sav.style.display === "block") { closeSaveMenu(); }
    else if (sys && sys.style.display === "block") { closeSysMenu(); }
    else { openSysMenu(); }
    return;
  }
  if (k === "l") {
    game.layerDebug = !game.layerDebug;
    dlog("Layer debug:", game.layerDebug ? "ON" : "OFF", "(touche L)");
    game._redraw();
  } else if (k === "s") {
    renderer.smoothing = !renderer.smoothing;
    dlog("Lissage (imageSmoothing):", renderer.smoothing ? "ON" : "OFF", "(touche S)");
    game._redraw();
  } else if (k === "p") {
    dlog("Export des couches en PNG natif… (touche P)");
    game.dumpLayers();
  } else if (k === "o") {
    game.hideOverlays = !game.hideOverlays;
    dlog("Compléments de décor:", game.hideOverlays ? "MASQUÉS" : "affichés", "(touche O)");
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

// Synchronise l'état visuel des boutons de contrôle avec le moteur (panneau
// image ET boutons HTML de repli).
function syncCtrl() {
  document.querySelector("#btn-auto")?.classList.toggle("active", !!game.autoMode);
  document.querySelector("#btn-skip")?.classList.toggle("active", !!game.skipMode);
  document.querySelectorAll("#ctrlpanel .cp-btn").forEach((b) => {
    const act = b.dataset.act;
    if (act === "auto" || act === "skip") cpSet(b, cpIsActive(act));
  });
  const led = document.querySelector("#cp-autoled");
  if (led) led.style.display = game.autoMode ? "block" : "none";
}

// Câblage des boutons de contrôle HTML de repli (si PARTS.PAK absent).
function wireControls() {
  document.querySelectorAll("#ctrlbar .ctrlbtn").forEach((b) => wireHoverSound(b));
  document.querySelector("#btn-auto")?.addEventListener("click", () => { uiSound("TOGGLE"); game.setAuto(); syncCtrl(); });
  document.querySelector("#btn-skip")?.addEventListener("click", () => { uiSound("TOGGLE"); game.setSkip(); syncCtrl(); });
  document.querySelector("#btn-voice")?.addEventListener("click", () => { uiSound("ENTER"); game.replayVoice(); });
  document.querySelector("#btn-menu2")?.addEventListener("click", () => { uiSound("ENTER"); openSysMenu(); });
}
wireControls();

// ---- Panneau de contrôle in-game (vraies images ControlPanel_*) ------------
// 5 icônes (Auto, Skip, Sauvegarde rapide, Chargement rapide, Menu) avec état
// éteint (icon0) / allumé (icon1), témoin ambre quand Auto est actif.
let _cpAssets = null;
const CP_ACTS = ["auto", "skip", "qsave", "qload", "menu"];
function cpSet(b, bright) {
  if (!_cpAssets) return;
  const i = +b.dataset.i;
  b.style.backgroundImage = `url(${(bright ? _cpAssets.cpIcon1 : _cpAssets.cpIcon0)[i]})`;
}
function cpIsActive(act) {
  return (act === "auto" && !!game.autoMode) || (act === "skip" && !!game.skipMode);
}
function flashCp(b) { try { b.animate([{ filter: "brightness(2.6)" }, { filter: "brightness(1)" }], { duration: 380 }); } catch {} }

function buildControlPanel() {
  _cpAssets = game.getInGameUiAssets();
  const bar = document.querySelector("#ctrlbar");
  if (!bar || !_cpAssets.cpBase || !_cpAssets.cpIcon0 || !_cpAssets.cpIcon1) return; // repli HTML
  const scale = 1.5;
  const W = 376 * scale, H = 40 * scale;
  const stripW = 336 * scale, iconW = stripW / 5, marginX = (W - stripW) / 2;
  bar.innerHTML = "";
  bar.style.cssText = "position:absolute; right:16px; bottom:14px; z-index:40;";
  const panel = document.createElement("div");
  panel.id = "ctrlpanel";
  panel.style.cssText = `position:relative; width:${W}px; height:${H}px; background:url(${_cpAssets.cpBase}) no-repeat; background-size:100% 100%; filter:drop-shadow(0 2px 7px rgba(0,0,0,.55));`;
  const titles = { auto: "Auto", skip: "Skip", qsave: "Sauvegarde rapide", qload: "Chargement rapide", menu: "Menu" };
  CP_ACTS.forEach((act, i) => {
    const b = document.createElement("button");
    b.className = "cp-btn"; b.dataset.act = act; b.dataset.i = i; b.title = titles[act];
    b.style.cssText = `position:absolute; left:${marginX + i * iconW}px; top:0; width:${iconW}px; height:${H}px; border:0; padding:0; margin:0; cursor:pointer; background:transparent url(${_cpAssets.cpIcon0[i]}) no-repeat center/72%;`;
    panel.appendChild(b);
  });
  if (_cpAssets.cpAuto) {
    const led = document.createElement("img");
    led.id = "cp-autoled"; led.src = _cpAssets.cpAuto;
    led.style.cssText = `position:absolute; left:${marginX + iconW * 0.5 - 14}px; top:${H / 2 - 14}px; width:28px; height:auto; pointer-events:none; display:none;`;
    panel.appendChild(led);
  }
  bar.appendChild(panel);
  wireControlPanel();
}

// Applique les vrais fonds aux menus système et options (system_menu_bg /
// options_bg), avec un voile sombre derrière les contrôles pour la lisibilité.
function applyMenuSkins() {
  if (!_cpAssets) _cpAssets = game.getInGameUiAssets();
  const opt = document.querySelector("#optionsmenu");
  if (opt && _cpAssets.optionsBg) {
    opt.style.background = `#0c1018 url(${_cpAssets.optionsBg}) center/cover no-repeat`;
    const inner = opt.querySelector("div");
    if (inner) { inner.style.background = "rgba(8,12,20,.66)"; inner.style.padding = "26px 36px"; inner.style.borderRadius = "14px"; inner.style.boxShadow = "0 8px 30px rgba(0,0,0,.5)"; }
  }
  const sys = document.querySelector("#sysmenu");
  if (sys && _cpAssets.systemBg) {
    sys.style.background = `#0c1018 url(${_cpAssets.systemBg}) center/cover no-repeat`;
    const inner = sys.querySelector("div");
    if (inner) { inner.style.background = "rgba(8,12,20,.55)"; inner.style.padding = "24px 32px"; inner.style.borderRadius = "14px"; inner.style.boxShadow = "0 8px 30px rgba(0,0,0,.5)"; }
  }
}

function wireControlPanel() {
  document.querySelectorAll("#ctrlpanel .cp-btn").forEach((b) => {
    const act = b.dataset.act;
    b.addEventListener("mouseenter", () => { uiSound("CURSOR"); cpSet(b, true); });
    b.addEventListener("mouseleave", () => cpSet(b, cpIsActive(act)));
    b.addEventListener("click", async () => {
      game.audio?.resume();
      if (act === "auto") { uiSound("TOGGLE"); game.setAuto(); syncCtrl(); }
      else if (act === "skip") { uiSound("TOGGLE"); game.setSkip(); syncCtrl(); }
      else if (act === "menu") { uiSound("ENTER"); openSysMenu(); }
      else if (act === "qsave") {
        try { await game.quickSave(); uiSound("ENTER"); flashCp(b); }
        catch (e) { uiSound("INVALID"); console.warn("Quick save:", e.message); }
      } else if (act === "qload") {
        if (await game.hasQuickSave()) { uiSound("ENTER"); try { await game.quickLoad(); } catch (e) { console.warn("Quick load:", e.message); } }
        else uiSound("INVALID");
      }
    });
  });
}

// ---- Sons d'interface (SYSSE.PAK) ------------------------------------------
// CURSOR = survol, ENTER = validation, CANCEL = retour, INVALID = action interdite.
function uiSound(name) { try { game.audio?.playSystem(name); } catch {} }
function wireHoverSound(el, name = "CURSOR") {
  if (el) el.addEventListener("mouseenter", () => uiSound(name));
}

// ---- Menu système in-game (Reprendre / Save / Load / Options / Titre) ------
function openSysMenu() {
  const el = document.querySelector("#sysmenu");
  if (el) el.style.display = "block";
}
function closeSysMenu() {
  const el = document.querySelector("#sysmenu");
  if (el) el.style.display = "none";
}
function wireSysMenu() {
  document.querySelectorAll(".sysmenu-btn").forEach((b) => {
    wireHoverSound(b);
    b.addEventListener("click", () => {
      game.audio?.resume();
      const act = b.dataset.act;
      uiSound(act === "resume" || act === "title" ? "CANCEL" : "ENTER");
      closeSysMenu();
      if (act === "resume") { /* rien : on ferme juste */ }
      else if (act === "save") openSaveMenu("save");
      else if (act === "load") openSaveMenu("load");
      else if (act === "options") openOptions();
      else if (act === "title") { try { localStorage.removeItem("luck.entry"); } catch {}; showTitle(); }
    });
  });
}
wireSysMenu();

// Applique les volumes (et vitesse auto) mémorisés en localStorage à l'audio.
function applySavedVolumes() {
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : +v; } catch { return d; } };
  game.audio?.setVolume("voice", load("luck.vol.voice", 100) / 100);
  game.audio?.setVolume("bgm", load("luck.vol.bgm", 55) / 100);
  game.audio?.setVolume("se", load("luck.vol.se", 90) / 100);
  game.autoSpeed = load("luck.autospeed", 5);
  game.textSpeed = load("luck.textspeed", 7);
}

// ---- Options (volumes + vitesse auto), persistées en localStorage ----------
function openOptions() {
  const el = document.querySelector("#optionsmenu");
  if (el) el.style.display = "block";
}
function wireOptions() {
  const get = (id) => document.querySelector(id);
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : +v; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, String(v)); } catch {} };

  const vVoice = get("#opt-voice"), vBgm = get("#opt-bgm"), vSe = get("#opt-se"), vAuto = get("#opt-auto"), vText = get("#opt-text");
  if (vVoice) vVoice.value = load("luck.vol.voice", 100);
  if (vBgm) vBgm.value = load("luck.vol.bgm", 55);
  if (vSe) vSe.value = load("luck.vol.se", 90);
  if (vAuto) vAuto.value = load("luck.autospeed", 5);
  if (vText) vText.value = load("luck.textspeed", 7);

  // applique immédiatement les volumes mémorisés
  const apply = () => {
    game.audio?.setVolume("voice", (+vVoice.value) / 100);
    game.audio?.setVolume("bgm", (+vBgm.value) / 100);
    game.audio?.setVolume("se", (+vSe.value) / 100);
    game.autoSpeed = +vAuto.value; // 1..10, utilisé par le délai auto
    game.textSpeed = +vText.value; // 1..10, vitesse de la frappe (10 = instantané)
  };
  apply();

  vVoice?.addEventListener("input", () => { save("luck.vol.voice", vVoice.value); apply(); });
  vBgm?.addEventListener("input", () => { save("luck.vol.bgm", vBgm.value); apply(); });
  vSe?.addEventListener("input", () => { save("luck.vol.se", vSe.value); apply(); });
  vAuto?.addEventListener("input", () => { save("luck.autospeed", vAuto.value); apply(); });
  vText?.addEventListener("input", () => { save("luck.textspeed", vText.value); apply(); });

  get("#opt-close")?.addEventListener("click", () => { uiSound("CANCEL"); const el = get("#optionsmenu"); if (el) el.style.display = "none"; });
}
wireOptions();

// ---- Menu Save / Load (grille de slots + vignettes) ------------------------
const SAVE_SLOTS = 30;        // nombre total de slots
const SAVE_PER_PAGE = 10;     // slots par page
let _savePage = 0;            // page courante (0-based)

async function openSaveMenu(mode = "save") {
  const el = document.querySelector("#savemenu");
  const grid = document.querySelector("#save-grid");
  const title = document.querySelector("#savemenu-title");
  if (!el || !grid) return;
  const pages = Math.ceil(SAVE_SLOTS / SAVE_PER_PAGE);
  if (_savePage >= pages) _savePage = 0;
  title.innerHTML = `${mode === "load" ? "CHARGER" : "SAUVEGARDER"} <span style="font-size:16px; opacity:.6;">— page ${_savePage + 1}/${pages}</span>`;
  grid.innerHTML = "";
  const existing = {};
  try { (await game.listSaves()).forEach((s) => (existing[s.slot] = s)); } catch {}

  const first = _savePage * SAVE_PER_PAGE + 1;
  const last = Math.min(SAVE_SLOTS, first + SAVE_PER_PAGE - 1);
  for (let i = first; i <= last; i++) {
    const rec = existing[String(i)];
    const card = document.createElement("div");
    card.style.cssText = "border:1px solid #aeb6c8; border-radius:8px; overflow:hidden; background:#fff; cursor:pointer; display:flex; flex-direction:column; min-height:120px;";
    const thumb = rec && rec.thumb
      ? `<img src="${rec.thumb}" style="width:100%; height:96px; object-fit:cover;" />`
      : `<div style="width:100%; height:96px; background:#e7eaf1; display:flex; align-items:center; justify-content:center; color:#9aa3b8; font-size:13px;">vide</div>`;
    const info = rec
      ? `<div style="padding:6px 8px; font-size:12px; color:#39435c;">
           <b>Slot ${i}</b> · ${rec.meta?.seen || ""}<br/>
           <span style="opacity:.7;">${rec.meta?.date || ""}</span><br/>
           <span style="opacity:.85;">${(rec.meta?.speaker ? rec.meta.speaker + ' : ' : '') + (rec.meta?.preview || "")}</span>
         </div>`
      : `<div style="padding:6px 8px; font-size:12px; color:#9aa3b8;"><b>Slot ${i}</b> · libre</div>`;
    card.innerHTML = thumb + info;
    wireHoverSound(card);
    card.addEventListener("click", async () => {
      game.audio?.resume();
      if (mode === "save") {
        uiSound("ENTER");
        try { await game.saveToSlot(i); openSaveMenu("save"); }
        catch (e) { console.warn("Save:", e.message); }
      } else {
        if (!rec) { uiSound("INVALID"); return; }
        uiSound("ENTER");
        closeSaveMenu();
        try { await game.loadFromSlot(i); } catch (e) { console.warn("Load:", e.message); }
      }
    });
    if (rec) card.addEventListener("contextmenu", async (ev) => {
      ev.preventDefault();
      if (confirm(`Supprimer la sauvegarde du slot ${i} ?`)) { await game.deleteSave(i); openSaveMenu(mode); }
    });
    grid.appendChild(card);
  }
  // barre de pagination
  let pager = document.querySelector("#save-pager");
  if (!pager) {
    pager = document.createElement("div");
    pager.id = "save-pager";
    pager.style.cssText = "display:flex; justify-content:center; gap:8px; margin-top:16px;";
    grid.parentElement.appendChild(pager);
  }
  pager.innerHTML = "";
  for (let p = 0; p < pages; p++) {
    const b = document.createElement("button");
    b.textContent = String(p + 1);
    b.style.cssText = `border:1px solid #8a93a8; border-radius:6px; padding:5px 12px; cursor:pointer; font-size:14px; ${p === _savePage ? "background:#3a5bd0; color:#fff; border-color:#3a5bd0;" : "background:#fff; color:#39435c;"}`;
    b.addEventListener("click", () => { uiSound("PAGE"); _savePage = p; openSaveMenu(mode); });
    pager.appendChild(b);
  }
  el.style.display = "block";
}
function closeSaveMenu() { const el = document.querySelector("#savemenu"); if (el) el.style.display = "none"; }
document.querySelector("#savemenu-close")?.addEventListener("click", () => { uiSound("CANCEL"); closeSaveMenu(); });

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
      dlog(`CG ${name}: ${list.length} entrées, ids ${list[0]?.id}..${list[list.length - 1]?.id}`);
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
      if (!buf2) continue;
      // SYSSE.PAK = sons d'interface (CURSOR/ENTER/CANCEL/…) : on les enregistre
      // comme sons système plutôt que comme un PAK SE de scène.
      if (/SYSSE/i.test(name)) {
        const list = game.loadSystemSe(buf2, name);
        dlog(`SYSSE ${name}: ${list.length} sons système (${list.map((e) => e.name).join(", ")})`);
      } else {
        const list = game.loadAudioPak(buf2, name);
        dlog(`AUDIO ${name}: ${list.length} entrées, ids ${list[0]?.id}..${list[list.length - 1]?.id}`);
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
  // Panneau de contrôle in-game + fonds des menus, à partir des vraies images.
  try { buildControlPanel(); } catch (e) { console.warn("Control panel:", e.message); }
  try { applyMenuSkins(); } catch (e) { console.warn("Menu skins:", e.message); }
  // VIDÉOS : on scanne les .webm/.mp4/.ogv importés (opening AIR_OP_A/B, etc.).
  // Le VM les jouera sur l'opcode MOVIE. On garde les octets bruts par nom.
  try {
    const vids = (await store.listFiles()).filter((n) => /\.(webm|mp4|ogv)$/i.test(n));
    for (const name of vids) {
      const buf = await store.getFile(name);
      if (buf) game.addMovie(name, buf);
    }
    if (vids.length) dlog(`VIDÉO : ${vids.length} fichier(s) — ${vids.join(", ")}`);
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
    dlog(`VIDÉO ajoutée(s) : ${[...map.keys()].join(", ")}`);
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
async function showTitle() {
  const el = document.querySelector("#title");
  const bg = document.querySelector("#title-bg");
  if (bg && !bg.src) {
    const url = game.titleImageURL("title1a");
    if (url) bg.src = url;
  }
  // au 1er lancement (aucune sauvegarde), LOAD est grisé
  let hasSave = false;
  try { hasSave = (await game.listSaves()).length > 0; } catch {}
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
    wireHoverSound(b);
    b.addEventListener("click", () => {
      game.audio?.resume();
      const act = b.dataset.act;
      uiSound(act === "exit" ? "CANCEL" : "ENTER");
      if (act === "new") { hideTitle(); try { localStorage.removeItem("luck.entry"); } catch {}; playRef(CONFIG.startEntry); }
      else if (act === "load") { hideTitle(); openSaveMenu("load"); }
      else if (act === "options") { console.log("OPTIONS : config à venir"); }
      else if (act === "manual") { console.log("MANUAL : manuel à venir"); }
      else if (act === "exit") { hideTitle(); showMenu(); } // EXIT -> menu chapitres (debug)
    });
  });
}

console.log("LuckEngine-Web boot v3.18 — panneau de contrôle ControlPanel_*, menus skinés, fondus de scène");
boot();
