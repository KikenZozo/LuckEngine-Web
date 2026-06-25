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

// Effets d'écran : `fx(false)` désactive shake/sépia/négatif si un opcode
// déclenche un effet indésirable ; `fxTest()` essaie une secousse + un flash.
window.fx = function (on = true) { game.fxEnabled = !!on; console.log("Effets d'écran:", game.fxEnabled ? "ON" : "OFF"); };
window.fxTest = function () { renderer.shake?.({ amp: 18, duration: 600 }); renderer.flash?.({ color: "#fff", duration: 240 }); };

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
    if (galleryViewOpen()) { closeGalleryView(); }
    else if (galleryOpen()) { closeGallery(); }
    else if (helpOpen()) { closeHelp(); }
    else if (backlogOpen()) { closeBacklog(); }
    else if (opt && opt.style.display === "block") { opt.style.display = "none"; }
    else if (sav && sav.style.display === "block") { closeSaveMenu(); }
    else if (sys && sys.style.display === "block") { closeSysMenu(); }
    else { openSysMenu(); }
    return;
  }
  // Pendant une saisie (champ texte), on ne capture aucun raccourci (sauf Échap, géré au-dessus).
  const _tag = (ev.target && ev.target.tagName) || "";
  if (_tag === "INPUT" || _tag === "TEXTAREA") return;
  // Aide / manuel : F1 ou « ? ».
  if (k === "f1" || k === "?") { ev.preventDefault(); if (helpOpen()) closeHelp(); else if (!anyOverlayOpen()) openHelp(); return; }
  // Plein écran : F.
  if (k === "f") { toggleFullscreen(); return; }
  // Backlog : Page↑ ou H ouvre/ferme l'historique des répliques.
  if (k === "pageup" || k === "h") {
    if (backlogOpen()) closeBacklog();
    else if (!anyOverlayOpen() && game.getHistory && game.getHistory().length) openBacklog();
    return;
  }
  // Galerie : G ouvre/ferme la galerie d'assets décoratifs.
  if (k === "g") {
    if (galleryOpen()) closeGallery();
    else if (!anyOverlayOpen()) openGallery();
    return;
  }
  // Espace / Entrée : avance le texte (comme un clic), si aucun menu n'est ouvert
  // et qu'on n'est pas en train de cliquer un bouton / saisir dans un champ.
  if (k === " " || k === "enter" || k === "spacebar") {
    const tag = (ev.target && ev.target.tagName) || "";
    if (anyOverlayOpen() || tag === "INPUT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    ev.preventDefault();
    game.advance();
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
      else if (act === "gallery") openGallery();
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
  renderer.windowOpacity = load("luck.winopacity", 100) / 100;
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

  const vVoice = get("#opt-voice"), vBgm = get("#opt-bgm"), vSe = get("#opt-se"), vAuto = get("#opt-auto"), vText = get("#opt-text"), vWin = get("#opt-winop");
  if (vVoice) vVoice.value = load("luck.vol.voice", 100);
  if (vBgm) vBgm.value = load("luck.vol.bgm", 55);
  if (vSe) vSe.value = load("luck.vol.se", 90);
  if (vAuto) vAuto.value = load("luck.autospeed", 5);
  if (vText) vText.value = load("luck.textspeed", 7);
  if (vWin) vWin.value = load("luck.winopacity", 100);

  // applique immédiatement les volumes mémorisés
  const apply = () => {
    game.audio?.setVolume("voice", (+vVoice.value) / 100);
    game.audio?.setVolume("bgm", (+vBgm.value) / 100);
    game.audio?.setVolume("se", (+vSe.value) / 100);
    game.autoSpeed = +vAuto.value; // 1..10, utilisé par le délai auto
    game.textSpeed = +vText.value; // 1..10, vitesse de la frappe (10 = instantané)
    if (vWin) { renderer.windowOpacity = (+vWin.value) / 100; game._redraw?.(); } // opacité fenêtre
  };
  apply();

  vVoice?.addEventListener("input", () => { save("luck.vol.voice", vVoice.value); apply(); });
  vBgm?.addEventListener("input", () => { save("luck.vol.bgm", vBgm.value); apply(); });
  vSe?.addEventListener("input", () => { save("luck.vol.se", vSe.value); apply(); });
  vAuto?.addEventListener("input", () => { save("luck.autospeed", vAuto.value); apply(); });
  vText?.addEventListener("input", () => { save("luck.textspeed", vText.value); apply(); });
  vWin?.addEventListener("input", () => { save("luck.winopacity", vWin.value); apply(); });

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

// ---- Backlog / historique des répliques (molette ↑, comme le vrai AIR) ------
const BL_VOICE_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.3v5.4h3.4L12 18.6V5.4L7.4 9.3H4z"/><path d="M15.4 9a3.6 3.6 0 0 1 0 6"/><path d="M17.9 6.4a7 7 0 0 1 0 11.2"/></svg>';

function backlogOpen() { return document.querySelector("#backlog")?.classList.contains("show"); }

let _backlogTex; // dataURL du vrai fond de backlog (PARTS.PAK: backlog_texture), résolu une fois
function openBacklog() {
  const el = document.querySelector("#backlog");
  const list = document.querySelector("#backlog-list");
  if (!el || !list) return;
  game._clearAutoTimer?.();
  // Skin avec la vraie texture du jeu si disponible (sinon le dégradé CSS reste).
  if (_backlogTex === undefined) _backlogTex = game.titleImageURL?.("backlog_texture") || null;
  if (_backlogTex) el.style.background = `#0c1018 url(${_backlogTex}) center/cover`;          // un menu interrompt auto/skip
  const hist = game.getHistory ? game.getHistory() : [];
  list.innerHTML = "";
  if (!hist.length) {
    list.innerHTML = '<div id="backlog-empty">Aucune réplique pour l’instant.</div>';
  } else {
    for (const h of hist) {
      const row = document.createElement("div");
      row.className = "bl-row";
      const hasVoice = !!(h.voice && h.voice.bytes);
      const vb = document.createElement("button");
      vb.className = "bl-voice" + (hasVoice ? "" : " empty");
      vb.innerHTML = BL_VOICE_SVG;
      vb.title = hasVoice ? "Réécouter la voix" : "";
      if (hasVoice) vb.addEventListener("click", () => { uiSound("ENTER"); game.replayHistoryVoice(h.voice); });
      const tx = document.createElement("div");
      tx.className = "bl-text";
      tx.innerHTML = (h.name ? `<span class="bl-name">${escapeHtml(h.name)}</span>` : "") + escapeHtml(h.text);
      row.append(vb, tx);
      list.appendChild(row);
    }
  }
  el.classList.add("show");
  list.scrollTop = list.scrollHeight; // démarre en bas (réplique la plus récente)
}
function closeBacklog() { document.querySelector("#backlog")?.classList.remove("show"); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
document.querySelector("#backlog-close")?.addEventListener("click", () => { uiSound("CANCEL"); closeBacklog(); });

// Un overlay plein écran est-il ouvert ? (pour ne pas avancer le texte derrière)
function anyOverlayOpen() {
  if (backlogOpen() || galleryOpen() || helpOpen()) return true;
  const ids = ["#sysmenu", "#savemenu", "#optionsmenu", "#menu", "#title", "#gallery", "#help"];
  return ids.some((id) => { const e = document.querySelector(id); return e && (e.style.display === "block" || e.classList.contains("show")); });
}

// Molette vers le HAUT sur la scène = ouvrir le backlog (geste AIR classique).
canvas.addEventListener("wheel", (ev) => {
  if (anyOverlayOpen()) return;
  if (ev.deltaY < 0 && game.getHistory && game.getHistory().length) { ev.preventDefault(); openBacklog(); }
}, { passive: false });

// Clic droit sur la scène = ouvrir le menu système (comme le vrai jeu).
canvas.addEventListener("contextmenu", (ev) => {
  ev.preventDefault();
  if (anyOverlayOpen()) return;
  uiSound("CANCEL");
  openSysMenu();
});

// ---- Galerie d'assets décoratifs (OTHCG / SYSCG / PARTS / EVENTCG…) --------
const GAL_PER_PAGE = 60;
let _galPak = null, _galPage = 0;

function galleryOpen() { return document.querySelector("#gallery")?.classList.contains("show"); }
function galleryViewOpen() { return document.querySelector("#gallery-view")?.classList.contains("show"); }

function openGallery() {
  const el = document.querySelector("#gallery");
  const tabs = document.querySelector("#gallery-tabs");
  const grid = document.querySelector("#gallery-grid");
  if (!el || !tabs || !grid) return;
  game._clearAutoTimer?.();
  const paks = game.galleryPaks ? game.galleryPaks() : [];
  tabs.innerHTML = "";
  if (!paks.length) {
    grid.innerHTML = '<div style="color:#8a93a8; padding:30px;">Aucun PAK décoratif chargé (OTHCG/SYSCG/PARTS…).</div>';
    document.querySelector("#gallery-pager").innerHTML = "";
    el.classList.add("show");
    return;
  }
  if (!_galPak || !paks.some((p) => p.name === _galPak)) { _galPak = paks[0].name; _galPage = 0; }
  for (const p of paks) {
    const b = document.createElement("button");
    b.className = "gal-tab";
    b.dataset.pak = p.name;
    b.textContent = `${p.base} (${p.count})`;
    b.addEventListener("click", () => { uiSound("CURSOR"); _galPak = p.name; _galPage = 0; buildGallery(); });
    tabs.appendChild(b);
  }
  buildGallery();
  el.classList.add("show");
}

let _galGen = 0; // jeton de génération : invalide le décodage en cours si on change d'onglet/page
function buildGallery() {
  const grid = document.querySelector("#gallery-grid");
  const pager = document.querySelector("#gallery-pager");
  if (!grid) return;
  const gen = ++_galGen;
  const pak = _galPak; // capturé localement (l'onglet peut changer pendant le décodage)
  document.querySelectorAll("#gallery-tabs .gal-tab").forEach((b) => b.classList.toggle("active", b.dataset.pak === pak));
  const entries = game.galleryEntries ? game.galleryEntries(pak) : [];
  const pages = Math.max(1, Math.ceil(entries.length / GAL_PER_PAGE));
  if (_galPage >= pages) _galPage = 0;
  const first = _galPage * GAL_PER_PAGE;
  const slice = entries.slice(first, first + GAL_PER_PAGE);

  // 1) crée d'abord toutes les cellules (placeholders) -> affichage instantané
  grid.innerHTML = "";
  const cells = slice.map((e) => {
    const cell = document.createElement("div");
    cell.className = "gal-cell"; cell.style.cursor = "default";
    const thumb = document.createElement("div");
    thumb.className = "gal-thumb";
    thumb.innerHTML = '<span style="color:#5b6478; font-size:12px;">…</span>';
    const cap = document.createElement("div");
    cap.className = "gal-cap";
    cap.textContent = e.name || `#${e.index}`;
    cell.append(thumb, cap);
    grid.appendChild(cell);
    return { e, cell, thumb, cap };
  });

  // 2) pagination (immédiate)
  pager.innerHTML = "";
  if (pages > 1) {
    for (let p = 0; p < pages; p++) {
      const b = document.createElement("button");
      b.textContent = String(p + 1);
      if (p === _galPage) b.classList.add("active");
      b.addEventListener("click", () => { uiSound("PAGE"); _galPage = p; buildGallery(); grid.scrollTop = 0; });
      pager.appendChild(b);
    }
  }

  // 3) décodage progressif : vignette réduite, en rendant la main au navigateur
  //    entre chaque image (plus de gel), annulable si on change d'onglet/page.
  (async () => {
    for (const { e, cell, thumb, cap } of cells) {
      if (gen !== _galGen) return;
      const got = game.galleryImage ? game.galleryImage(pak, e.index, 180) : null;
      if (gen !== _galGen) return;
      if (got) {
        const im = document.createElement("img");
        im.src = got.url;
        thumb.innerHTML = ""; thumb.appendChild(im);
        cap.title = `${e.name || "#" + e.index} — ${got.w}×${got.h}`;
        cell.style.cursor = "pointer";
        cell.addEventListener("click", () => {
          uiSound("ENTER");
          const full = game.galleryImage(pak, e.index); // plein résolution à la demande
          openGalleryView((full || got).url, `${e.name || "#" + e.index}  ·  ${got.w}×${got.h}  ·  ${pak}`);
        });
      } else {
        thumb.innerHTML = '<span style="color:#5b6478; font-size:12px;">non décodable</span>';
      }
      await new Promise((r) => setTimeout(r, 0)); // laisse respirer le navigateur
    }
  })();
}

function openGalleryView(url, caption) {
  const v = document.querySelector("#gallery-view");
  if (!v) return;
  v.querySelector("img").src = url;
  v.querySelector(".gv-cap").textContent = caption || "";
  v.classList.add("show");
}
function closeGalleryView() { const v = document.querySelector("#gallery-view"); if (v) { v.classList.remove("show"); const im = v.querySelector("img"); if (im) im.src = ""; } }
function closeGallery() { document.querySelector("#gallery")?.classList.remove("show"); closeGalleryView(); }
document.querySelector("#gallery-close")?.addEventListener("click", () => { uiSound("CANCEL"); closeGallery(); });
document.querySelector("#gallery-view")?.addEventListener("click", () => { uiSound("CANCEL"); closeGalleryView(); });

// ---- Plein écran -----------------------------------------------------------
function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  } catch (e) { console.warn("Plein écran indisponible:", e.message); }
}

// ---- Aide / manuel (raccourcis clavier & souris) ---------------------------
function helpOpen() { return document.querySelector("#help")?.classList.contains("show"); }
function openHelp() { document.querySelector("#help")?.classList.add("show"); }
function closeHelp() { document.querySelector("#help")?.classList.remove("show"); }
document.querySelector("#help-close")?.addEventListener("click", () => { uiSound("CANCEL"); closeHelp(); });
document.querySelector("#help")?.addEventListener("click", (e) => { if (e.target.id === "help") closeHelp(); });

// ---- Indicateur de voix (haut-parleur animé speaker_anim, 6 frames) --------
let _voiceIndTimer = null;
function setupVoiceIndicator() {
  const host = canvas.parentElement || document.body;
  let el = document.querySelector("#voice-ind");
  if (!el) {
    el = document.createElement("img");
    el.id = "voice-ind"; el.alt = "";
    el.style.cssText = "position:absolute; left:2.6%; bottom:24%; width:34px; height:34px; z-index:41; display:none; pointer-events:none; filter:drop-shadow(0 1px 2px rgba(0,0,0,.6));";
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(el);
  }
  const frames = (game.sliceStripURLs && game.sliceStripURLs("speaker_anim", 6)) || null;
  game.onLineVoice = (has) => {
    if (_voiceIndTimer) { clearInterval(_voiceIndTimer); _voiceIndTimer = null; }
    if (!has || !frames) { el.style.display = "none"; return; }
    let i = 0;
    el.src = frames[0]; el.style.display = "block";
    _voiceIndTimer = setInterval(() => { i = (i + 1) % frames.length; el.src = frames[i]; }, 110);
  };
}

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
  // Panneau de contrôle in-game : on garde la barre HTML verticale (Menu/Skip/
  // Auto/Voice) qui reproduit fidèlement le vrai UI AIR. On N'utilise PAS le
  // strip horizontal ControlPanel_base du PAK (autre disposition, rendu moche).
  // buildControlPanel() reste dispo mais n'est plus appelé.
  try { applyMenuSkins(); } catch (e) { console.warn("Menu skins:", e.message); }
  // Motifs de tremblement d'écran (SHAKELIST_SET du seen "_shakelist").
  try { game.preloadShakePatterns(); } catch (e) { console.warn("Shake patterns:", e.message); }
  // Indicateur de voix animé (speaker_anim de PARTS.PAK).
  try { setupVoiceIndicator(); } catch (e) { console.warn("Voice indicator:", e.message); }
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
      else if (act === "options") { openOptions(); }   // ouvre les Options par-dessus le titre
      else if (act === "manual") { openHelp(); }        // manuel = aide (raccourcis)
      else if (act === "exit") { hideTitle(); showMenu(); } // EXIT -> menu chapitres (debug)
    });
  });
}

console.log("LuckEngine-Web boot v3.18 — panneau de contrôle ControlPanel_*, menus skinés, fondus de scène");
boot();
