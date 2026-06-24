// ============================================================================
// LuckEngine-Web — src/app/Game.js
// ----------------------------------------------------------------------------
// Colle le pipeline : ArrayBuffer(.PAK) -> PakReader -> parseScript -> AIRVM,
// pilote l'affichage via CanvasRenderer, et branche un évaluateur d'expressions
// + un store de variables (les SELECT y écrivent l'index choisi, les IFN les
// relisent). Conçu pour le navigateur (avance/choix au clic).
// ============================================================================

import { PakReader } from "../pak/PakReader.js";
import { parseScript } from "../script/AIRParser.js";
import { AIRVM } from "../vm/AIRVM.js";
import { evalExprValue } from "../vm/ExprEval.js";
import { decodeCZ } from "../image/czimage.js";
import { spriteKey } from "./charcgKeys.js";
import { AudioManager } from "../audio/AudioManager.js";
import { SaveManager } from "../save/SaveManager.js";

export class Game {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.lang = opts.lang ?? "jp";
    this.pak = null;
    this.vars = {}; // store de variables AIR (#NNNN)
    this._advance = null;
    this._choose = null;
    this.audio = new AudioManager();
    this.saves = new SaveManager();
    this.movies = new Map(); // nom de fichier -> ArrayBuffer (vidéos opening…)
    this._history = [];      // backlog : répliques déjà lues (speaker, text, voice)

    // Logs de debug : silencieux par défaut, activable via game.debug = true
    // ou en ajoutant ?debug à l'URL. Garde la console propre pour le joueur.
    this.debug = (() => {
      try { return /[?&]debug\b/.test(location.search); } catch { return false; }
    })();
  }

  // Log de diagnostic conditionnel (n'affiche que si this.debug est activé).
  dbg(...args) { if (this.debug) console.log(...args); }

  /** Enregistre une vidéo importée (AIR_OP_A.webm…) par son nom de fichier. */
  addMovie(name, arrayBuffer) {
    this.movies.set(name.toLowerCase(), arrayBuffer);
  }

  // Résout un nom de MOVIE du script ("AIR_OP_A") vers le bon fichier importé,
  // en tenant compte de la langue (suffixe _EN / _ZC) et de l'extension.
  _resolveMovie(baseName) {
    const lang = this.lang;
    const suffixes = lang === "en" ? ["_en", ""] : lang === "zh" ? ["_zc", ""] : ["", "_en"];
    const exts = [".webm", ".mp4", ".ogv", ".ogg"];
    const b = baseName.toLowerCase();
    for (const sfx of suffixes) {
      for (const ext of exts) {
        const key = b + sfx + ext;
        if (this.movies.has(key)) return this.movies.get(key);
      }
    }
    // repli : n'importe quelle clé qui commence par le nom de base
    for (const [k, v] of this.movies) {
      if (k.startsWith(b)) return v;
    }
    return null;
  }

  /** Ajoute un PAK audio (voice.PAK / SE.PAK / BGM…). Appelable plusieurs fois. */
  loadAudioPak(arrayBuffer, name = "") {
    if (!this.audioPaks) this.audioPaks = [];
    const pak = new PakReader(arrayBuffer);
    this.audioPaks.push({ name, pak });
    return pak.listEntries();
  }

  /** Charge SYSSE.PAK (sons d'interface : CURSOR/ENTER/CANCEL/INVALID/…) et les
   *  enregistre auprès de l'AudioManager pour remplacer les bips synthétiques. */
  loadSystemSe(arrayBuffer, name = "SYSSE") {
    const pak = new PakReader(arrayBuffer);
    const map = {};
    for (const e of pak.listEntries()) {
      try { map[String(e.name).toUpperCase()] = pak.getEntry(e.index); } catch {}
    }
    this.audio.registerSystemSounds(map);
    this._hasSysSe = true;
    return pak.listEntries();
  }

  /** Joue un son système nommé (CURSOR/ENTER/CANCEL/INVALID/TOGGLE/PAGE). */
  sysSe(name) { try { this.audio.playSystem(name); } catch {} }

  // ---- Résolution audio (mapping id-script -> entrée PAK) -------------------
  // Mapping CONFIRMÉ par rétro-ingénierie des scripts AIR + noms d'entrées PAK :
  //
  //  SE  : l'opcode porte un u16 dont l'OCTET HAUT est l'index (0-based à partir
  //        de 0x41=65). L'octet bas (0x00/0xFF/…) est un flag de volume/canal.
  //          index = (u16 >> 8) - 65   ;  idPAK = idStart(SE.PAK) + index
  //        u16==255 (0x00FF) => SE_STOP (octet haut nul -> pas un id).
  //
  //  BGM : l'octet HAUT est constant (0x86), l'OCTET BAS est l'index (0-based à
  //        partir de 0xA1=161). u16 nul (BGM(0,…)) => arrêt/fondu.
  //          index = (u16 & 0xFF) - 161 ;  idPAK = idStart(BGM.PAK) + index
  //
  //  VOICE : PAS d'opcode VOICE — la voix est portée par le u16 `unk` du MESSAGE,
  //          qui est DIRECTEMENT l'id d'entrée VOICE.PAK (cf. _resolveVoice).
  //
  // On localise le PAK par son nom, puis on récupère l'entrée par son id PAK et
  // on renvoie {id,bytes,from,fmt}. La détection de format se fait à la lecture.
  _audioPakByName(...needles) {
    if (!this.audioPaks) return null;
    for (const needle of needles) {
      // match strict sur le nom de fichier (sans l'extension), insensible à la casse
      const up = needle.toUpperCase();
      const hit = this.audioPaks.find((p) => {
        const n = p.name.toUpperCase().replace(/\.PAK$/, "");
        return n === up;
      });
      if (hit) return hit;
    }
    return null;
  }

  _resolveFromPak(pakEntry, idPak) {
    if (!pakEntry) return null;
    const { name, pak } = pakEntry;
    const head = pak.headById(idPak, 16);
    if (!head || head.length < 4) return null;
    return { id: idPak, bytes: pak.getEntryById(idPak), from: `${name}#id${idPak}`, fmt: this.audio.inspect(head) };
  }

  /** SE : u16-script -> entrée SE.PAK. `loopFlag` = 3e arg de l'opcode (512=boucle). */
  _resolveSe(u16val, loopFlag) {
    if (!u16val) return null;
    const hi = (u16val >> 8) & 0xff;
    if (hi === 0) return { stop: true }; // 0x00FF & co : arrêt SE
    const pk = this._audioPakByName("SE");
    if (!pk) return null;
    const idPak = pk.pak.header.idStart + (hi - 65);
    const r = this._resolveFromPak(pk, idPak);
    if (r) r.loop = (loopFlag === 512); // ambiances (higurashi/kaze/ame…) bouclent
    return r;
  }

  /** BGM : u16-script -> entrée MUSIC.PAK (ou BGM.PAK). {…} | {stop:true} | null. */
  _resolveBgm(u16val) {
    if (!u16val) return { stop: true }; // BGM(0,…) : arrêt/fondu
    const lo = u16val & 0xff;
    const pk = this._audioPakByName("MUSIC", "BGM");
    if (!pk) return null; // pas de MUSIC.PAK/BGM.PAK importé
    const idPak = pk.pak.header.idStart + (lo - 161);
    return this._resolveFromPak(pk, idPak);
  }

  /** VOICE : id = unk du MESSAGE (id direct VOICE.PAK). Cherche aussi VOICE1. */
  _resolveVoice(idPak) {
    if (!idPak) return null;
    for (const nm of ["VOICE", "VOICE1"]) {
      const pk = this._audioPakByName(nm);
      if (!pk) continue;
      const r = this._resolveFromPak(pk, idPak);
      if (r) return r;
    }
    return null;
  }

  loadPakBuffer(arrayBuffer) {
    this.pak = new PakReader(arrayBuffer);
    return this.pak.listEntries();
  }

  /** Ajoute un PAK d'images (BGCG/CHARCG/EVENTCG…). Appelable plusieurs fois. */
  loadImagePak(arrayBuffer, name = "") {
    if (!this.imagePaks) this.imagePaks = [];
    const pak = new PakReader(arrayBuffer);
    this.imagePaks.push({ name, pak });
    return pak.listEntries();
  }

  // Résout un imgId -> octets CZ : id global (IDStart+index) sur tous les CG
  // paks, puis index en repli. Renvoie { bytes, from } ou null.
  _imageBytes(imgId) {
    if (!this.imagePaks || !this.imagePaks.length) return null;
    const looksCZ = (b) => b && b.length > 2 && b[0] === 0x43 && b[1] === 0x5a;
    // 1) par id global
    for (const { name, pak } of this.imagePaks) {
      try {
        const b = pak.getEntryById(imgId);
        if (looksCZ(b)) return { bytes: b, from: `${name}#id${imgId}`, name: pak.nameById(imgId), pakName: name };
      } catch {}
    }
    // 2) par index (repli)
    for (const { name, pak } of this.imagePaks) {
      try {
        const b = pak.getEntry(imgId);
        if (looksCZ(b)) return { bytes: b, from: `${name}[${imgId}]`, name: null, pakName: name };
      } catch {}
    }
    return null;
  }

  // Met à jour le médaillon de date (haut-gauche) à partir du mois+jour. Les
  // médaillons OTHCG sont nommés jul_16..jul_31 et aug_01..aug_31 (universels,
  // pas de variante de langue). Petits (≈192x200), positionnés en overlay.
  async _updateDateBadge(month, day) {
    const mm = month === 8 ? "aug" : month === 7 ? "jul" : null;
    if (!mm) { return; } // hors juillet/août : pas de médaillon connu
    const name = `${mm}_${String(day).padStart(2, "0")}`;
    if (this._dateBadge && this._dateBadge.name === name) return; // déjà à jour
    const found = this._imageBytesByName(name);
    if (!found) { console.warn(`Médaillon date "${name}" introuvable`); return; }
    const img = decodeCZ(found.bytes);
    if (!img) return;
    const bitmap = typeof createImageBitmap === "function"
      ? await createImageBitmap(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height))
      : { rgba: img.rgba, width: img.width, height: img.height };
    this._dateBadge = {
      name, bitmap,
      ox: img.offsetX || 0, oy: img.offsetY || 0,
      w: img.width, h: img.height,
      canvasW: img.canvasW || 1280, canvasH: img.canvasH || 720,
    };
    this.dbg(`MÉDAILLON "${name}" [${img.width}x${img.height}] off(${img.offsetX || 0},${img.offsetY || 0})`);
    this._redraw();
  }

  // Récupère les octets CZ d'une image par son NOM (toutes images PAK confondues).
  _imageBytesByName(targetName) {
    if (!this.imagePaks || !this.imagePaks.length) return null;
    const looksCZ = (b) => b && b.length > 2 && b[0] === 0x43 && b[1] === 0x5a;
    for (const { name, pak } of this.imagePaks) {
      try {
        const b = pak.getEntryByName(targetName);
        if (looksCZ(b)) return { bytes: b, from: `${name}:${targetName}`, name: targetName, pakName: name };
      } catch {}
    }
    return null;
  }

  // Décode une image d'UI (par nom) en bitmap utilisable par le renderer.  // `withInset` calcule en plus la zone non-transparente (utile pour caler le
  // texte/le contenu dans une fenêtre qui a des marges transparentes).
  async _decodeUiImage(name, withInset = false) {
    const found = this._imageBytesByName(name);
    if (!found) return null;
    const img = decodeCZ(found.bytes);
    if (!img) return null;
    const bitmap = typeof createImageBitmap === "function"
      ? await createImageBitmap(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height))
      : { rgba: img.rgba, width: img.width, height: img.height };
    const out = { bitmap, w: img.width, h: img.height, ox: img.offsetX || 0, oy: img.offsetY || 0 };
    if (withInset) out.inset = this._opaqueBounds(img.rgba, img.width, img.height);
    return out;
  }

  // Rend une image (par nom, ex "title1a") en data URL PNG, pour l'afficher dans
  // un élément HTML (écran titre, etc.). Renvoie null si introuvable.
  titleImageURL(name) {
    const found = this._imageBytesByName(name);
    if (!found) return null;
    const img = decodeCZ(found.bytes);
    if (!img) return null;
    const cv = document.createElement("canvas");
    cv.width = img.width; cv.height = img.height;
    const ctx = cv.getContext("2d");
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
    return cv.toDataURL("image/png");
  }

  // Découpe une bande horizontale (ex ControlPanel_icon0 = 5 icônes côte à côte)
  // en N dataURL PNG, une par cellule. Sert à reconstruire l'UI in-game à partir
  // des vraies planches d'icônes du jeu. Renvoie null si l'image est absente.
  sliceStripURLs(name, n) {
    const found = this._imageBytesByName(name);
    if (!found) return null;
    const img = decodeCZ(found.bytes);
    if (!img) return null;
    const full = document.createElement("canvas");
    full.width = img.width; full.height = img.height;
    full.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
    const cw = img.width / n;
    const urls = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement("canvas");
      c.width = Math.round(cw); c.height = img.height;
      c.getContext("2d").drawImage(full, i * cw, 0, cw, img.height, 0, 0, Math.round(cw), img.height);
      urls.push(c.toDataURL("image/png"));
    }
    return urls;
  }

  // Rassemble les vraies images d'UI in-game (panneau de contrôle + fond Options)
  // en dataURL, pour que l'interface HTML colle au jeu d'origine. Champs null si
  // PARTS.PAK n'est pas importé (l'UI retombe alors sur les boutons génériques).
  getInGameUiAssets() {
    return {
      cpBase: this.titleImageURL("ControlPanel_base"),
      cpIcon0: this.sliceStripURLs("ControlPanel_icon0", 5),
      cpIcon1: this.sliceStripURLs("ControlPanel_icon1", 5),
      cpAuto: this.titleImageURL("ControlPanel_auto"),
      optionsBg: this.titleImageURL("options_bg"),
      systemBg: this.titleImageURL("system_menu_bg"),
    };
  }

  // Bornes (en RATIO 0..1) de la zone non-transparente d'une image RGBA.
  _opaqueBounds(rgba, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (rgba[(y * w + x) * 4 + 3] > 8) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    return { x0: minX / w, y0: minY / h, x1: (maxX + 1) / w, y1: (maxY + 1) / h };
  }

  // Précharge les éléments d'UI d'AIR (fenêtre dialogue, choix) et les donne au
  // renderer pour un rendu fidèle. Variante de langue pour les images textuelles.
  async loadUiSkin() {
    const sfx = this.lang === "en" ? "_en" : this.lang === "zh" ? "_zc" : "";
    const skin = {};
    skin.mwin = await this._decodeUiImage("MWIN0", true);    // fenêtre de dialogue (+inset)
    skin.mwinCursor = await this._decodeUiImage("MWIN_CURSOR"); // curseur "continuer"
    if (skin.mwinCursor) skin.mwinCursor.frames = 4; // 4 frames empilées (animation plume)
    skin.selwin = await this._decodeUiImage("SELWIN");        // choix (normal)
    skin.selwinSel = await this._decodeUiImage("SELWIN_s");   // choix (survol)
    // SELWIN contient 3 bandes empilées (3 états du bouton). On n'en affiche
    // qu'UNE : la bande du milieu (la barre bleue standard). On indique au
    // renderer quelle tranche source découper (en ratio de hauteur).
    const band = { y0: 78 / 222, y1: 144 / 222 }; // bande du milieu / hauteur image
    if (skin.selwin) skin.selwin.band = band;
    if (skin.selwinSel) skin.selwinSel.band = band;
    this.uiSkin = skin;
    if (this.renderer.setUiSkin) this.renderer.setUiSkin(skin);
    const ok = Object.entries(skin).filter(([, v]) => v).map(([k]) => k);
    this.dbg(`UI skin chargée : ${ok.join(", ") || "(aucune image trouvée)"}`);
    return skin;
  }

  async _loadBackground(imgId) {
    if (!this.imagePaks || !this.imagePaks.length) {
      if (!this._warnedNoPak) {
        console.warn("IMAGELOAD: aucun CG pak chargé — importe BGCG.PAK (et CHARCG.PAK…).");
        this._warnedNoPak = true;
      }
      return;
    }
    const found = this._imageBytes(imgId);
    if (!found) {
      // ids hors plages CG = fonds SPÉCIAUX. Dans AIR, 65000 et 65001 sont des
      // écrans NOIRS (endormissement "I close my eyes", transitions "this is
      // goodbye", fondus entre scènes). Les fonds BLANCS qu'on voit ("My child…",
      // "DREAM") sont de VRAIES images OTHCG (25190…), pas ces ids spéciaux.
      // On rend donc NOIR, et surtout on REMPLACE le fond précédent (sinon le
      // carton/décor d'avant reste collé).
      this.currentBg = { solid: "#000000" };
      this._currentBgId = imgId;
      this._currentBgName = null;
      this.sprites = new Map();
      this.eventExprs = [];
      this._inEventCG = false;
      this.bgOverlays = new Map();
      this._currentBgNum = null;
      this.dbg(`IMAGELOAD ${imgId} = fond noir spécial`);
      return;
    }
    const img = decodeCZ(found.bytes);
    if (!img) {
      console.warn(`IMAGELOAD ${imgId} (${found.from}): CZ non décodé — format ` +
        `"${String.fromCharCode(found.bytes[0], found.bytes[1], found.bytes[2])}" non géré ?`);
      return;
    }
    this.dbg(`IMAGELOAD ${imgId} -> ${found.from} [${img.format} ${img.width}x${img.height}]`);
    // Carton de date plein écran "day_MDD" (ex day_719 = 19 juil) : dans le vrai
    // jeu il n'est PAS posé comme fond persistant — c'est le MÉDAILLON compact
    // (jul_/aug_) qui s'affiche en haut à gauche. On met donc à jour le médaillon
    // et on N'AFFICHE PAS le carton 1280x720 (sinon il masque toute la scène).
    const dm = /^day_(\d)(\d\d)$/i.exec(found.name || "");
    if (dm) {
      this._updateDateBadge(+dm[1], +dm[2]);
      return; // ne pas poser le carton comme fond
    }
    try {
      const bitmap = typeof createImageBitmap === "function"
        ? await createImageBitmap(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height))
        : { rgba: img.rgba, width: img.width, height: img.height };
      // EVENTCG : on distingue base et expression par la TAILLE (comme les BGCG),
      // car le nommage n'est pas universel — certaines familles sont en lettres
      // (fgka08a base / fgka08b expr) et d'autres en numéros (fgmp02 base /
      // fgmp03,04,05 expr). Un EVENTCG PLEIN CADRE (≈1280x960) = base ; un PETIT
      // EVENTCG = expression positionnée par son offset par-dessus la base.
      const isEvent = (found.pakName || "").toUpperCase().includes("EVENTCG");
      if (isEvent) {
        const nm = (found.name || "").toLowerCase();
        const isEventBase = img.width >= 1000 && img.height >= 700;
        if (!isEventBase) {
          // petit -> expression positionnée, EMPILÉE sur la base EVENTCG (plusieurs
          // peuvent coexister : fgmp02 papier + fgmp03/04/05 détails = note complète).
          // Cas base manquante : une expression "...b/c/d" (ex fgka02b) doit se
          // poser sur sa base "...a" (fgka02a). Si cette base n'est pas affichée
          // (changement de scène, transition…), on la charge d'abord.
          const baseName = this._eventBaseName(nm);
          if (baseName && this._currentBgName !== baseName) {
            const bf = this._imageBytesByName(baseName);
            if (!bf) console.warn(`  [EVENTCG] base "${baseName}" introuvable (pour "${nm}")`);
            if (bf) {
              try {
                const bimg = decodeCZ(bf.bytes);
                if (bimg) {
                  const bbitmap = typeof createImageBitmap === "function"
                    ? await createImageBitmap(new ImageData(new Uint8ClampedArray(bimg.rgba), bimg.width, bimg.height))
                    : { rgba: bimg.rgba, width: bimg.width, height: bimg.height };
                  this.currentBg = bbitmap;
                  this._currentBgName = baseName;
                  this.eventExprs = [];        // repart d'une base propre
                  this.bgOverlays = new Map();
                  this.sprites = new Map();
                  this.dbg(`EVENTCG base auto "${baseName}" (pour l'expression "${nm}")`);
                }
              } catch {}
            }
          }
          this._addEventExpr({
            bitmap, ox: img.offsetX || 0, oy: img.offsetY || 0,
            w: img.width, h: img.height,
            canvasW: img.canvasW || 1280, canvasH: img.canvasH || 960,
          });
          this.dbg(`EVENTCG expr "${nm}" [${img.width}x${img.height}] off(${img.offsetX || 0},${img.offsetY || 0}) -> empilée (${this.eventExprs.length})`);
        } else {
          // plein cadre -> base (nouvelle scène CG)
          if (imgId !== this._currentBgId) { this.sprites = new Map(); this._currentBgId = imgId; }
          this.currentBg = bitmap;
          this._currentBgName = nm;
          this.eventExprs = [];
          this.bgOverlays = new Map();
          this.dbg(`EVENTCG base "${nm}" [${img.width}x${img.height}] off(${img.offsetX || 0},${img.offsetY || 0}) canvas(${img.canvasW || 0}x${img.canvasH || 0}) -> nouvelle base`);
        }
        this._inEventCG = true; // on est dans une illustration EVENTCG -> pas de sprites
        return;
      }
      // BGCG : une BASE remplit le CADRE PLEIN (~1280x720). Tout ce qui est plus
      // petit (872x720 comme bg011n1, 728x248 comme les enfants bg098b, bandes…)
      // est une EXPRESSION qui se compose PAR-DESSUS la base de SA famille (numéro
      // du nom : bg011n1 -> 11, ne s'affiche que sur la base bg011*). Confirmé par
      // l'utilisateur : bg011n1 (872x720) est l'expression de bg011n2 (1280x720).
      const bgNum = this._bgNum(found.name);
      const isFull = img.width >= 1200 && img.height >= 680;
      if (isFull) {
        // nouvelle base -> nouvelle scène : on efface persos
        if (imgId !== this._currentBgId) {
          this.sprites = new Map();
          this._currentBgId = imgId;
        }
        this.currentBg = bitmap;
        this._currentBgName = found.name;
        this.eventExprs = []; // on quitte un éventuel EVENTCG
        this._inEventCG = false; // scène BGCG normale -> sprites autorisés
        this._currentBgNum = bgNum;
        this.dbg(`BGCG base "${found.name}" (#${imgId}, famille ${bgNum})`);
        // on ne garde que les expressions de CETTE famille ; celles d'autres
        // scènes (enfants restés collés…) sont jetées.
        if (this.bgOverlays) {
          this.bgOverlays = new Map(
            [...this.bgOverlays].filter(([, o]) => bgNum != null && o.num === bgNum)
          );
        }
      } else {
        // expression : positionnée par l'offset CZ, sur le fond, liée à sa base.
        // Cas porte/fenêtre "open" (ex bg007n1o) : le calque OUVERT doit se poser
        // sur sa base FERMÉE plein écran (bg007n1c). Si cette base n'est pas le
        // fond courant (effacée par une transition noire…), on la charge d'abord.
        const baseName = this._closedBaseName(found.name);
        if (baseName && this._currentBgName !== baseName) {
          const baseFound = this._imageBytesByName(baseName);
          if (!baseFound) console.warn(`  [expr] base "${baseName}" INTROUVABLE dans les PAK`);
          if (baseFound) {
            try {
              const bimg = decodeCZ(baseFound.bytes);
              if (bimg && bimg.width >= 1200 && bimg.height >= 680) {
                const bbitmap = typeof createImageBitmap === "function"
                  ? await createImageBitmap(new ImageData(new Uint8ClampedArray(bimg.rgba), bimg.width, bimg.height))
                  : { rgba: bimg.rgba, width: bimg.width, height: bimg.height };
                this.currentBg = bbitmap;
                this._currentBgName = baseName;
                this._currentBgNum = bgNum;
                this._inEventCG = false;
                this.dbg(`BGCG base auto "${baseName}" (pour l'expression "${found.name}")`);
              }
            } catch {}
          }
        }
        if (!this.bgOverlays) this.bgOverlays = new Map();
        this.bgOverlays.set(imgId, {
          bitmap, ox: img.offsetX || 0, oy: img.offsetY || 0,
          w: img.width, h: img.height,
          canvasW: img.canvasW || 1280, canvasH: img.canvasH || 720,
          num: bgNum, name: found.name,
        });
        this.dbg(`BGCG expr "${found.name}" (#${imgId}, base ${bgNum}) -> overlay lié`);
      }
      // pas de rendu ici : on compose seulement à l'affichage (message/DRAW)
    } catch (e) {
      console.warn(`IMAGELOAD ${imgId}: décodé (${img.width}x${img.height}) mais affichage KO:`, e.message);
    }
  }

  // Empile une expression EVENTCG positionnée. Un patch qui recouvre largement
  // un existant (visage ré-émis) le REMPLACE sur place ; sinon il s'empile au-dessus
  // (fgmp02 papier + fgmp03/04/05 détails = note complète).
  _addEventExpr(layer) {
    if (!this.eventExprs) this.eventExprs = [];
    const overlap = (a, b) => {
      const ix = Math.max(0, Math.min(a.ox + a.w, b.ox + b.w) - Math.max(a.ox, b.ox));
      const iy = Math.max(0, Math.min(a.oy + a.h, b.oy + b.h) - Math.max(a.oy, b.oy));
      const inter = ix * iy, minA = Math.min(a.w * a.h, b.w * b.h);
      return minA > 0 ? inter / minA : 0;
    };
    let bestI = -1, best = 0;
    this.eventExprs.forEach((o, i) => { const r = overlap(o, layer); if (r > best) { best = r; bestI = i; } });
    if (bestI >= 0 && best > 0.6) this.eventExprs[bestI] = layer;
    else this.eventExprs.push(layer);
  }

  // Numéro de famille d'un nom BGCG/EVENTCG : "bg098b" -> 98, "bg042" -> 42.
  _bgNum(name) {
    if (!name) return null;
    const m = String(name).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Déduit le nom de la BASE (plein écran) d'une expression EVENTCG. Convention
  // AIR : la base finit par "a", les expressions par "b"/"c"/"d"/"e"
  // (ex fgka02b -> fgka02a, fgka08c -> fgka08a). Renvoie null si déjà une base.
  _eventBaseName(name) {
    if (!name) return null;
    const m = String(name).match(/^(.*?)([b-z])$/i);
    if (!m || m[2].toLowerCase() === "a") return null;
    return m[1] + "a";
  }

  // Déduit le nom de la BASE fermée (plein écran) à partir d'une expression
  // "ouverte". Convention AIR : le calque open finit par "o", la base par "c"
  // (ex bg007n1o -> bg007n1c, bg007o -> bg007c, bg007yo -> bg007yc).
  // Renvoie null si le nom ne se termine pas par "o" (pas une expression open).
  _closedBaseName(name) {
    if (!name || !/o$/i.test(name)) return null;
    return name.slice(0, -1) + "c";
  }

  // Sprite de personnage (IMAGELOAD mode != 0). ins = {imgId, mode, var1, x, y}.
  async _loadSprite(ins) {
    if (!this.imagePaks || !this.imagePaks.length) return;
    const found = this._imageBytes(ins.imgId);
    if (!found) {
      console.debug(`SPRITE: imgId ${ins.imgId} introuvable (spécial ?)`);
      return;
    }
    const img = decodeCZ(found.bytes);
    if (!img) {
      console.warn(`SPRITE ${ins.imgId} (${found.from}): CZ non décodé`);
      return;
    }
    // Cadre propre de ce morceau (depuis l'en-tête CZ).
    const ownFrameW = img.canvasW || this.renderer.canvas.width;
    const ownFrameH = img.canvasH || this.renderer.canvas.height;
    // BASE (corps) = morceau quasi pleine hauteur du cadre ; sinon expression.
    const isBase = img.height >= 0.6 * ownFrameH;

    if (!this.sprites) this.sprites = new Map();
    const key = spriteKey(ins.imgId);             // ex "cgyk1" (perso+pose) ou null
    const charId = key ? key.slice(0, 4) : null;  // ex "cgyk" = le personnage
    // EMPLACEMENT = position écran (on ignore le drapeau du mode, ex. 258 vs 2).
    const slot = ins.x > 0 ? "x" + Math.round(ins.x) : "m" + (ins.mode || 1);
    // Une base retire le MÊME personnage des AUTRES positions (il ne peut être
    // qu'à un endroit) -> règle les "jumelles" quand un perso se déplace.
    if (isBase && charId) {
      for (const [k, L] of this.sprites) {
        if (k !== slot && L.baseChar === charId) this.sprites.delete(k);
      }
    }
    if (!this.sprites.has(slot)) {
      this.sprites.set(slot, { base: null, overlays: [], pending: [], frameW: ownFrameW, frameH: ownFrameH });
    }
    const layers = this.sprites.get(slot);

    // Offset (position du morceau dans le cadre), avec repli sur (x,y).
    let ox = img.offsetX || 0;
    let oy = img.offsetY || 0;
    if (ox === 0 && oy === 0 && (ins.x || ins.y)) {
      ox = (ins.x || 0) - img.width / 2;
      oy = (ins.y || 0) - img.height;
    }
    this.dbg(`SPRITE ${ins.imgId} -> ${found.from} [${img.width}x${img.height}] ` +
      `off(${ox},${oy}) pos(${ins.x},${ins.y}) mode=${ins.mode} var1=${ins.var1} -> ${isBase ? "BASE" : "expression"}`);
    try {
      const bitmap = typeof createImageBitmap === "function"
        ? await createImageBitmap(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height))
        : { rgba: img.rgba, width: img.width, height: img.height };
      // On stocke les DONNÉES BRUTES ; le placement est calculé au rendu avec le
      // cadre de la base => peu importe l'ordre de chargement base/expression.
      const layer = { bitmap, ox, oy, w: img.width, h: img.height, imgId: ins.imgId, key };
      if (isBase) {
        layers.frameW = ownFrameW; // la base fixe le cadre de référence du perso
        layers.frameH = ownFrameH;
        layers.baseChar = charId;  // pour retirer ce perso des autres positions
        // position écran du personnage (xPos), pour ne pas tout centrer
        layers.charX = ins.x > 0 ? ins.x : null;
        const changed = layers.baseKey !== key || (layers.base && layers.base.imgId !== ins.imgId);
        layers.base = layer;
        layers.baseKey = key;
        if (changed) layers.overlays = []; // nouvelle pose -> les anciens patches ne valent plus
        // les patches en attente collent-ils à cette nouvelle base ?
        if (layers.pending && layers.pending.length) {
          const keep = [];
          for (const p of layers.pending) {
            if (p.key === key) this._addOverlay(layers, p);
            else keep.push(p);
          }
          layers.pending = keep;
        }
      } else {
        // patch (yeux/bouche/main/manpu) : il s'empile sur la base ACTUELLE si même
        // perso+pose. Sinon il est destiné à une base FUTURE -> mis en attente.
        if (!key || !layers.baseKey || key === layers.baseKey) {
          this._addOverlay(layers, layer);
        } else {
          layers.pending.push(layer);
        }
      }
      // pas de rendu ici : on compose seulement à l'affichage (message/DRAW)
    } catch (e) {
      console.warn(`SPRITE ${ins.imgId}: affichage KO:`, e.message);
    }
  }

  // Ajoute un patch à la pile d'overlays d'un emplacement, EN ORDRE D'ARRIVÉE.
  // Un patch ré-émis (lip-sync, clignement) RECOUVRE largement un overlay existant
  // -> on le remplace SUR PLACE (il garde sa position dans la pile, donc son z-order).
  // Un patch sur une NOUVELLE zone (la main, un manpu) -> empilé au-dessus.
  _addOverlay(layers, layer) {
    const overlap = (a, b) => {
      const ix = Math.max(0, Math.min(a.ox + a.w, b.ox + b.w) - Math.max(a.ox, b.ox));
      const iy = Math.max(0, Math.min(a.oy + a.h, b.oy + b.h) - Math.max(a.oy, b.oy));
      const inter = ix * iy;
      const minArea = Math.min(a.w * a.h, b.w * b.h);
      return minArea > 0 ? inter / minArea : 0;
    };
    let bestI = -1, best = 0;
    layers.overlays.forEach((o, i) => {
      const r = overlap(o, layer);
      if (r > best) { best = r; bestI = i; }
    });
    if (bestI >= 0 && best > 0.6) {
      layers.overlays[bestI] = layer; // même feature ré-émise -> remplace sur place
    } else {
      layers.overlays.push(layer);    // feature distincte -> nouvelle couche au-dessus
    }
  }

  listEntries() {
    return this.pak ? this.pak.listEntries() : [];
  }

  _pick(o) {
    return (o && (o[this.lang] || o.jp || o.en || o.zh)) || "";
  }

  /** Change la langue à chaud et repeint la ligne courante. */
  setLang(lang) {
    this.lang = lang;
    this._finishReveal();   // ne pas rester bloqué si on change de langue en pleine frappe
    this._redraw();
  }

  // Repeint la ligne actuellement affichée (après changement de langue).
  _redraw() {
    if (!this._cur) return;
    if (this._cur.type === "message") {
      const raw = this._pick(this._cur.ins);
      const m = raw.match(/^@([^@]*)@([\s\S]*)$/);
      this._renderBase();
      this.renderer.drawDialogue(m ? m[1] : "", m ? m[2] : raw);
    } else if (this._cur.type === "select") {
      const labels = (this._cur.ins.choices || []).map((ch) => this._pick(ch));
      this._renderBase();
      this.renderer.drawChoices(labels);
    }
  }

  // Repeint la base : fond, puis chaque perso. Le placement est calculé ICI
  // avec le cadre de la BASE, donc l'ordre de chargement n'a pas d'importance.
  // Un visage n'est JAMAIS dessiné sans sa base (pas de visage flottant).
  // Transition fluide (fondu) entre l'écran courant et le nouveau décor.
  // Capture l'image actuelle du canvas, dessine la nouvelle scène, puis fait
  // un cross-fade en animant l'opacité — au lieu d'un changement brutal/noir.
  async _fadeTransition(duration = 340) {
    const r = this.renderer;
    const cv = r.canvas;
    let prev = null;
    try {
      prev = document.createElement("canvas");
      prev.width = cv.width; prev.height = cv.height;
      prev.getContext("2d").drawImage(cv, 0, 0); // photo de l'écran AVANT
    } catch { prev = null; }
    this._renderBase(); // dessine le nouveau décor
    if (!prev) return;
    let after = null;
    try {
      after = document.createElement("canvas");
      after.width = cv.width; after.height = cv.height;
      after.getContext("2d").drawImage(cv, 0, 0); // photo de l'écran APRÈS
    } catch { return; }
    // ease-in-out cubique : départ/arrivée doux comme dans le jeu original
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const start = performance.now();
    this._transitioning = true;
    await new Promise((res) => {
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const e = ease(t);
        r.clear();
        r.ctx.globalAlpha = 1; r.ctx.drawImage(prev, 0, 0);   // ancien dessous
        r.ctx.globalAlpha = e; r.ctx.drawImage(after, 0, 0);  // nouveau qui apparaît
        r.ctx.globalAlpha = 1;
        if (t < 1) requestAnimationFrame(step);
        else { this._renderBase(); this._transitioning = false; res(); }
      };
      requestAnimationFrame(step);
    });
    // la scène vient d'être présentée : évite un 2e fondu redondant au MESSAGE
    // qui suit un HAIKEI_SET déjà fondu.
    this._lastMsgScene = this._sceneKey();
  }

  // Clé d'identité de la scène (décor + EVENTCG). Sert à déclencher un fondu
  // automatique uniquement quand le DÉCOR change (pas à chaque clignement de sprite).
  _sceneKey() {
    return `${this._currentBgId}|${this._currentBgName || ""}|${this._inEventCG ? 1 : 0}`;
  }

  _renderBase() {
    this.renderer.clear();
    const cw = this.renderer.canvas.width;
    const ch = this.renderer.canvas.height;
    if (this.currentBg) this.renderer.drawBackground(this.currentBg);
    // expressions EVENTCG empilées (papier + détails…), chacune positionnée par
    // son offset/cadre, fusionnées par-dessus la base
    if (this.eventExprs) {
      for (const e of this.eventExprs) {
        const sx = cw / (e.canvasW || cw), sy = ch / (e.canvasH || ch);
        this.renderer.drawSprite(e.bitmap, e.ox * sx, e.oy * sy, e.w * sx, e.h * sy);
      }
    }
    // compléments de fond (nuit/matin/jour…) posés à leur offset, sous les persos
    if (this.bgOverlays && !this.hideOverlays) {
      for (const o of this.bgOverlays.values()) {
        // une expression ne s'affiche que sur SA base (même numéro de famille)
        if (o.num != null && this._currentBgNum != null && o.num !== this._currentBgNum) continue;
        const sx = cw / (o.canvasW || cw), sy = ch / (o.canvasH || ch);
        this.renderer.drawSprite(o.bitmap, o.ox * sx, o.oy * sy, o.w * sx, o.h * sy);
      }
    }
    // Un EVENTCG est une illustration COMPLÈTE : on ne dessine pas les sprites
    // de personnage par-dessus. (mais la date, elle, reste affichée.)
    if (this.sprites && !this._inEventCG) {
    const place = (layer, frameW, frameH, charX) => {
      const scale = ch / frameH;
      // horizontal : centré sur xPos du perso si connu, sinon cadre centré écran
      const fLeft = charX != null
        ? charX - (frameW * scale) / 2
        : (cw - frameW * scale) / 2;
      return [layer.bitmap, fLeft + layer.ox * scale, layer.oy * scale, layer.w * scale, layer.h * scale];
    };
    const slots = [...this.sprites.values()].sort((a, b) => (a.charX || 0) - (b.charX || 0));
    for (const L of slots) {
      if (!L.base) continue; // pas de base -> on ne dessine rien (ni les patches)
      const fW = L.frameW || cw, fH = L.frameH || ch;
      const baseRect = place(L.base, fW, fH, L.charX);
      this.renderer.drawSprite(...baseRect);
      if (this.layerDebug) this.renderer.drawDebugBox(baseRect[1], baseRect[2], baseRect[3], baseRect[4], `BASE ${L.base.imgId}`, 0);
      (L.overlays || []).forEach((ov, i) => {
        const r = place(ov, fW, fH, L.charX);
        this.renderer.drawSprite(...r);
        if (this.layerDebug) this.renderer.drawDebugBox(r[1], r[2], r[3], r[4], `${ov.imgId} [${ov.w}x${ov.h}]`, i + 1);
      });
    }
    } // fin du bloc sprites (sauté pour les EVENTCG)
    this._drawDateBadge(cw, ch);
  }

  // Médaillon de calendrier (jul_/aug_) en haut à gauche, par-dessus la scène.
  // Masqué pendant les EVENTCG (illustrations plein écran), comme le vrai jeu.
  // L'image est définie dans un petit repère (~200x200), PAS dans le repère écran :
  // on la pose donc à une taille proportionnelle à l'écran, calée dans le coin.
  _drawDateBadge(cw, ch) {
    const d = this._dateBadge;
    if (!d || this._inEventCG) return;
    // taille cible ~ 13% de la largeur écran (comme le jeu d'origine), ratio gardé
    const targetW = cw * 0.13;
    const scale = targetW / d.w;
    const margin = cw * 0.012; // petite marge depuis le bord
    this.renderer.drawSprite(d.bitmap, margin, margin, d.w * scale, d.h * scale);
  }

  advance() {
    // Si le texte est encore en train de s'écrire, le 1er clic le complète
    // d'un coup (au lieu d'avancer) — exactement comme le jeu original.
    if (this._reveal && !this._reveal.done) { this._finishReveal(); return; }
    this._clearAutoTimer();
    this._stopCursorAnim();
    if (this._advance) {
      const r = this._advance;
      this._advance = null;
      r();
    }
  }

  // ---- Effet machine à écrire (révélation progressive du texte) -------------
  // Révèle le texte caractère par caractère à une vitesse réglable (Options ->
  // "Vitesse du texte"). Résout la promesse quand tout est affiché. En mode Skip,
  // ou à vitesse maximale, l'affichage est instantané.
  _typewrite(name, text) {
    this._stopReveal();
    const ts = this.textSpeed ?? 7;              // 1 (lent) .. 10 (instantané)
    const instant = this.skipMode || ts >= 10 || !text;
    if (instant) {
      this.renderer.drawDialogue(name, text);    // tout le texte + plume
      this._reveal = { done: true };
      return Promise.resolve();
    }
    // total révélable = renvoyé par le renderer (dépend du retour à la ligne).
    const total = this.renderer.drawDialogue(name, text, 0); // fenêtre vide
    const cps = 18 + ts * 14;                     // caractères/seconde (ts7 ≈ 116)
    const start = performance.now();
    return new Promise((resolve) => {
      const rev = (this._reveal = { name, text, total, count: 0, done: false, resolve });
      const loop = (now) => {
        if (this._reveal !== rev || rev.done) return;
        if (this.skipMode) { this._finishReveal(); return; } // Skip activé en cours
        const n = Math.min(total, Math.floor(((now - start) / 1000) * cps));
        rev.count = n;
        this._renderBase();                       // réinitialise la zone (anti-cumul d'alpha)
        this.renderer.drawDialogue(name, text, n);
        if (n >= total) { rev.done = true; this._revealRAF = null; resolve(); }
        else this._revealRAF = requestAnimationFrame(loop);
      };
      this._revealRAF = requestAnimationFrame(loop);
    });
  }

  // Termine la frappe immédiatement (clic du joueur ou bascule Skip).
  _finishReveal() {
    const rev = this._reveal;
    if (!rev || rev.done) return false;
    if (this._revealRAF) { cancelAnimationFrame(this._revealRAF); this._revealRAF = null; }
    rev.done = true;
    this._renderBase();
    this.renderer.drawDialogue(rev.name, rev.text);  // tout le texte + plume
    if (rev.resolve) rev.resolve();
    return true;
  }

  _stopReveal() {
    if (this._revealRAF) { cancelAnimationFrame(this._revealRAF); this._revealRAF = null; }
  }

  // Attente d'avancement d'un MESSAGE : clic normal, ou résolution auto si Auto
  // (après un délai) ou Skip (quasi immédiat) sont actifs.
  _waitAdvance() {
    this._startCursorAnim();
    return new Promise((res) => {
      this._advance = () => { this._stopCursorAnim(); res(); };
      if (this.skipMode) {
        this._autoTimer = setTimeout(() => this.advance(), 30); // Skip : très rapide
      } else if (this.autoMode) {
        // Auto : délai proportionnel à la longueur du texte, modulé par la vitesse
        // choisie dans les Options (autoSpeed 1..10, 5 = normal ; plus haut = plus rapide).
        const txt = (this._cur && this._cur.ins && this._pick(this._cur.ins)) || "";
        const speed = this.autoSpeed || 5;
        const factor = 11 - speed; // 1->10 (lent), 10->1 (rapide)
        const delay = Math.min(8000, (400 + txt.length * 18) * factor / 5);
        this._autoTimer = setTimeout(() => this.advance(), delay);
      }
    });
  }

  // Animation de la plume (curseur "continuer") : cycle les 4 frames + léger
  // battement vertical sinusoïdal. Ne redessine QUE la zone de la plume.
  _startCursorAnim() {
    this._stopCursorAnim();
    const r = this.renderer;
    if (!r._cursorBox || !r._cursorBox.clean) return; // pas de plume / pas de fond propre
    const start = performance.now();
    const loop = (now) => {
      const c = r._cursorBox;
      if (!c || !c.clean) return;
      const t = (now - start) / 1000;
      const frame = Math.floor(t * 6) % c.frames;       // ~6 fps de cycle de frames
      const dy = Math.sin(t * 2.6) * 3;                  // battement vertical doux
      // restaure le fond propre (efface l'ancienne plume sans carré noir)
      try { r.ctx.putImageData(c.clean, c.cleanX, c.cleanY); } catch {}
      r._drawCursorFrame(frame, dy);
      this._cursorRAF = requestAnimationFrame(loop);
    };
    this._cursorRAF = requestAnimationFrame(loop);
  }
  _stopCursorAnim() {
    if (this._cursorRAF) { cancelAnimationFrame(this._cursorRAF); this._cursorRAF = null; }
  }

  // Annule un timer auto/skip en cours (au clic manuel, changement de mode…)
  _clearAutoTimer() { if (this._autoTimer) { clearTimeout(this._autoTimer); this._autoTimer = null; } }

  setAuto(on) {
    this.autoMode = on === undefined ? !this.autoMode : !!on;
    if (this.autoMode) this.skipMode = false;
    this._clearAutoTimer();
    if ((this.autoMode || this.skipMode) && this._advance) this.advance(); // relance le flux
    return this.autoMode;
  }
  setSkip(on) {
    this.skipMode = on === undefined ? !this.skipMode : !!on;
    if (this.skipMode) this.autoMode = false;
    this._clearAutoTimer();
    if (this.skipMode && this._advance) this.advance();
    return this.skipMode;
  }
  // Bouton "Voice" : rejoue la voix de la réplique courante.
  replayVoice() {
    if (this._lastVoice) this.audio.playVoice(this._lastVoice.bytes, this._lastVoice.from);
  }

  // Joue une vidéo (opening AIR_OP_A/B…) en plein écran par-dessus le canvas,
  // et ne rend la main au script qu'à la FIN de la lecture. Clic ou Échap = skip.
  async _playMovie(baseName) {
    const buf = this._resolveMovie(baseName);
    if (!buf) {
      console.warn(`MOVIE "${baseName}" : fichier introuvable (importe AIR_OP_*.webm)`);
      return;
    }
    // coupe le son du jeu pendant la vidéo (la vidéo a sa propre piste)
    try { this.audio.stopBgm(); this.audio.stopSe(); this.audio.stopVoice(); } catch {}

    const blob = new Blob([buf], { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const canvas = this.renderer.canvas;
    const host = canvas.parentElement || document.body;

    const video = document.createElement("video");
    video.src = url;
    video.autoplay = true;
    video.controls = false;
    video.playsInline = true;
    // plein cadre par-dessus le canvas
    Object.assign(video.style, {
      position: "absolute", left: "0", top: "0",
      width: "100%", height: "100%", objectFit: "contain",
      background: "#000", zIndex: "50",
    });
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(video);

    this.dbg(`MOVIE "${baseName}" -> lecture`);
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return; done = true;
        try { video.pause(); } catch {}
        video.remove();
        URL.revokeObjectURL(url);
        window.removeEventListener("keydown", onKey);
        canvas.removeEventListener("click", onClick);
        resolve();
      };
      const onKey = (e) => { if (e.key === "Escape" || e.key === " " || e.key === "Enter") finish(); };
      const onClick = () => finish();
      video.addEventListener("ended", finish);
      video.addEventListener("error", finish);
      window.addEventListener("keydown", onKey);
      // petit délai avant d'armer le clic-skip (évite de zapper par le clic d'avant)
      setTimeout(() => video.addEventListener("click", onClick), 300);
      video.play().catch(() => { /* autoplay bloqué : le clic relancera */ });
    });
  }

  // DIAGNOSTIC : exporte chaque couche chargée en PNG à sa RÉSOLUTION NATIVE
  // (sans redimensionnement). Permet de distinguer un bug de décodage CZ (bords
  // bruités dans le PNG natif) d'un fringe de matte (PNG natif propre, bruit
  // n'apparaissant qu'à l'écran après mise à l'échelle). Touche P.
  dumpLayers() {
    const dump = (bitmap, w, h, name) => {
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      x.imageSmoothingEnabled = false;
      x.clearRect(0, 0, w, h);
      x.drawImage(bitmap, 0, 0, w, h);
      c.toBlob((b) => {
        const u = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = u; a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(u), 1500);
      });
    };
    let n = 0;
    if (this.currentBg) {
      dump(this.currentBg, this.currentBg.width, this.currentBg.height, `bg_full_${this._currentBgId || "x"}_${this.currentBg.width}x${this.currentBg.height}.png`);
      n++;
    }
    if (this.bgOverlays) {
      for (const [id, o] of this.bgOverlays) { dump(o.bitmap, o.w, o.h, `overlay_${id}_${o.w}x${o.h}.png`); n++; }
    }
    if (this.sprites) {
      for (const L of this.sprites.values()) {
        if (L.base) { dump(L.base.bitmap, L.base.w, L.base.h, `base_${L.base.imgId}_${L.base.w}x${L.base.h}.png`); n++; }
        for (const ov of (L.overlays || [])) { dump(ov.bitmap, ov.w, ov.h, `lay_${ov.imgId}_${ov.w}x${ov.h}.png`); n++; }
      }
    }
    console.log(`Dump: ${n} couche(s) exportée(s) en PNG natif (autorise les téléchargements multiples si demandé).`);
  }

  choose(i) {
    if (this._choose) {
      this._playConfirmSe();   // son de validation du choix
      const r = this._choose;
      this._choose = null;
      r(i);
    }
  }

  // Son de confirmation (clic sur un choix) : le vrai SE système "ENTER" si
  // SYSSE.PAK est chargé, sinon un repli synthétique (deux tons brefs).
  _playConfirmSe() {
    if (this.audio.hasSystem && this.audio.hasSystem("ENTER")) { this.sysSe("ENTER"); return; }
    try {
      const ctx = this.audio && this.audio.ctx;
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(740, now);
      osc.frequency.exponentialRampToValueAtTime(1180, now + 0.06);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.07, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      osc.connect(gain);
      gain.connect(this.audio.gain.se || ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {}
  }

  // Survol d'un choix : si l'index change, redessine la barre survolée en SELWIN_s
  // et joue un petit son de sélection (feedback comme le vrai jeu).
  hoverChoice(i) {
    if (!this._activeChoices) return;       // pas en train de choisir
    if (i === this._hoverChoice) return;    // pas de changement
    this._hoverChoice = i;
    this._renderBase();
    this.renderer.drawChoices(this._activeChoices, i);
    if (i >= 0) this._playSelectSe();       // son au survol d'un choix
  }

  // Son de survol d'un choix : le vrai SE système "CURSOR" si SYSSE.PAK est
  // chargé, sinon un "tick" doux synthétisé via Web Audio (toujours disponible).
  _playSelectSe() {
    if (this.audio.hasSystem && this.audio.hasSystem("CURSOR")) { this.sysSe("CURSOR"); return; }
    try {
      const ctx = this.audio && this.audio.ctx;
      if (!ctx) return;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";                              // plus doux qu'une sinus pure
      osc.frequency.setValueAtTime(660, now);             // tick discret, médium
      osc.frequency.exponentialRampToValueAtTime(990, now + 0.03);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.05, now + 0.008); // attaque douce, volume bas
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09); // extinction rapide
      osc.connect(gain);
      gain.connect(this.audio.gain.se || ctx.destination);
      osc.start(now);
      osc.stop(now + 0.10);
    } catch {}
  }

  /** @param {number|string} ref index ou nom d'entrée (ex: "seen0000") */
  // Résout une entrée script par nom (insensible à la casse / extension).
  _resolveScript(name) {
    const norm = (s) => String(s).toUpperCase().replace(/\.[A-Z0-9]+$/, "");
    const target = norm(name);
    return this.pak.listEntries().find((x) => norm(x.name) === target);
  }

  // Codes parsés d'un seen par nom, avec cache (pour les sauts inter-fichiers).
  _codesFor(name) {
    if (!this._scriptCache) this._scriptCache = new Map();
    const e = this._resolveScript(name);
    if (!e) return null;
    if (this._scriptCache.has(e.index)) return this._scriptCache.get(e.index);
    const codes = parseScript(this.pak.getEntry(e.index));
    this._scriptCache.set(e.index, codes);
    return codes;
  }

  async playEntry(ref) {
    if (!this.pak) throw new Error("Aucun PAK chargé");
    let index = ref;
    let entryName = typeof ref === "string" ? ref : "";
    if (typeof ref === "string") {
      const e = this._resolveScript(ref);
      if (!e) throw new Error(`Entrée "${ref}" introuvable dans le PAK`);
      index = e.index;
      entryName = e.name;
    } else {
      const e = this.pak.listEntries().find((x) => x.index === index);
      entryName = e ? e.name : String(index);
    }
    this.vars = {};
    // Si on charge une sauvegarde : restaurer les variables capturées.
    if (this._pendingVars) { this.vars = { ...this._pendingVars }; this._pendingVars = null; }
    this.currentBg = null;
    this._currentBgId = null;
    this.bgOverlays = new Map();
    this.sprites = new Map();
    this._lastMsgScene = undefined; // pas de fondu sur la 1re réplique d'un seen
    const codes = parseScript(this.pak.getEntry(index));

    const vm = new AIRVM(codes, {
      message: async (ins) => {
        this._cur = { type: "message", ins };
        // VOIX : le u16 `unk` du MESSAGE est l'id direct d'entrée VOICE.PAK.
        // unk==0 => narration sans voix. On coupe la voix précédente puis on joue.
        if (ins.unk) {
          const rv = this._resolveVoice(ins.unk);
          if (rv) {
            if (this.voiceDiag) console.log(`VOICE ${rv.from} [${rv.fmt}]`);
            this.audio.playVoice(rv.bytes, rv.from);
            this._lastVoice = rv; // mémorisé pour le bouton "Voice" (rejouer)
          } else {
            this.audio.stopVoice();
            this._lastVoice = null;
            if (this.voiceDiag) console.log(`VOICE id${ins.unk} introuvable dans VOICE.PAK/VOICE1.PAK`);
          }
        } else {
          this.audio.stopVoice(); // narration : couper toute voix qui traîne
          this._lastVoice = null;
        }
        const raw = this._pick(ins);
        const m = raw.match(/^@([^@]*)@([\s\S]*)$/);
        const name = m ? m[1] : "";
        const text = m ? m[2] : raw;
        // Point de sauvegarde courant (stable, au niveau d'un MESSAGE) : on
        // mémorise où on en est pour pouvoir reprendre exactement ici.
        this._savePoint = {
          state: vm.snapshot(),
          speaker: name,
          preview: (text || "").slice(0, 60),
          bgId: this._currentBgId,   // pour restaurer le décor au chargement
        };
        // Fondu enchaîné automatique quand le DÉCOR a changé depuis la dernière
        // réplique (transition douce entre scènes, comme le jeu original). Pas de
        // fondu en mode Skip (instantané) ni sur la toute 1re réplique.
        const sceneKey = this._sceneKey();
        const sceneChanged = this._lastMsgScene !== undefined && this._lastMsgScene !== sceneKey;
        this._lastMsgScene = sceneKey;
        if (sceneChanged && !this.skipMode) await this._fadeTransition();
        else this._renderBase();
        await this._typewrite(name, text); // frappe progressive (clic = complète)
        await this._waitAdvance();         // puis attend le clic pour avancer
      },
      select: async (ins) => {
        this._cur = { type: "select", ins };
        this._clearAutoTimer();
        this.autoMode = false; this.skipMode = false; // un choix interrompt auto/skip
        const labels = (ins.choices || []).map((ch) => this._pick(ch));
        this._activeChoices = labels;   // mémorisé pour le survol (hover)
        this._hoverChoice = -1;
        this._renderBase();
        this.renderer.drawChoices(labels);
        const idx = await new Promise((res) => (this._choose = res));
        this._activeChoices = null;
        if (ins.varId != null) this.vars["#" + ins.varId] = idx; // SELECT -> #varId
        return idx;
      },
      debug: async (ins) => {
        // On observe les opcodes sprites non encore décodés pour reverse leur
        // structure depuis les octets réels (comme on a fait pour IMAGELOAD).
        const watch = ["BASE", "FACE", "DISP", "IMAGEUPDATE", "SWAP", "MASK", "PRIORITY", "UVWH", "SIZE", "MANPU"];
        if (watch.includes(ins.op)) {
          this.dbg(`OP ${ins.op}: u16=[${(ins.u16 || []).join(",")}]`);
        }
        // Opcodes de variable/flag : on extrait les chaînes ASCII (ex "#6001=1")
        // des octets bruts, pour reverse leur format et brancher l'exécution.
        const flagOps = ["EQU", "EQUN", "EQUV", "ADD", "SUB", "MUL", "DIV", "MOD", "AND", "OR", "RANDOM", "SET", "FLAGCLR", "VARSTR", "VARSTR_ADD"];
        // EQUN [idVar, valeur] : affectation littérale #idVar = valeur.
        // Format confirmé sur dump réel (strings=[], u16=[id,val]). Remplit
        // this.vars pour que les conditions IFN/IFY s'évaluent correctement.
        if (ins.op === "EQUN" && ins.u16 && ins.u16.length >= 2) {
          this.vars["#" + ins.u16[0]] = ins.u16[1];
          // 8001 = id de l'image de FOND de base de la scène. Le jeu compose
          // base(8001) + expression(8002). Notre classement par taille se trompe
          // pour les bases petites (ex bg007n1o 448x664 = base via 8001). Quand
          // 8001 désigne une image qu'on avait rangée en overlay, on la PROMEUT
          // en fond plein écran pour que le décor s'affiche (sinon "il manque la
          // base", l'expression flotte sans fond).
          if (ins.u16[0] === 8001) {
            const id = ins.u16[1];
            if (id && id !== 65000 && id !== 65001 && this.bgOverlays && this.bgOverlays.has(id)) {
              const ov = this.bgOverlays.get(id);
              // NE PAS promouvoir une expression "open" (bg007n1o…) : elle a déjà
              // sa base fermée chargée par _closedBaseName, et la promouvoir
              // étirerait le petit calque (448x664) en plein écran. On ne promeut
              // que les vraies bases mal classées (sans base "...c" associée).
              const isOpenExpr = ov.name && /o$/i.test(ov.name) && this._imageBytesByName(this._closedBaseName(ov.name));
              if (!isOpenExpr) {
                this.currentBg = ov.bitmap;          // étirée plein cadre par drawBackground
                this._currentBgId = id;
                this._currentBgNum = ov.num;
                this.bgOverlays.delete(id);          // ce n'était pas un overlay : c'est la base
                this.dbg(`BGCG base (via 8001) #${id} -> promue en fond`);
              } else {
                this.dbg(`BGCG (via 8001) #${id} = expression open, base déjà chargée -> pas de promotion`);
              }
            }
          }
        }
        if (flagOps.includes(ins.op) && ins.raw) {
          const strs = [];
          let cur = "";
          for (const b of ins.raw) {
            if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b);
            else { if (cur.length >= 2) strs.push(cur); cur = ""; }
          }
          if (cur.length >= 2) strs.push(cur);
          this.dbg(`FLAG ${ins.op}: strings=${JSON.stringify(strs)} u16=[${(ins.u16 || []).join(",")}]`);
        }
        // Opcodes AUDIO : on reverse leurs paramètres (chaînes + u16) ET on tente
        // la lecture en best-effort (id = 1er u16) depuis voice.PAK / SE.PAK / BGM.
        const audioOps = ["VOICE", "VOICE_STOP", "BGM", "BGM_WAIT_START", "BGM_WAIT_FADE",
          "BGM_PUSH", "BGM_POP", "BGM_ASYNC_FADE_STOP", "SE", "SE_STOP", "SE_WAIT",
          "SE_WAIT_FADE", "VOLUME", "CHAR_VOLUME", "SETBGMFLAG"];
        if (audioOps.includes(ins.op)) {
          const strs = [];
          let cur = "";
          for (const b of (ins.raw || [])) {
            if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b);
            else { if (cur.length >= 2) strs.push(cur); cur = ""; }
          }
          if (cur.length >= 2) strs.push(cur);
          const u16 = ins.u16 || [];
          this.dbg(`AUDIO-OP ${ins.op}: strings=${JSON.stringify(strs)} u16=[${u16.join(",")}]`);
          try {
            const idScript = u16[0] || 0;
            if (ins.op === "VOICE_STOP") {
              this.audio.stopVoice();
            } else if (ins.op === "SE_STOP") {
              this.audio.stopSe();
            } else if (ins.op === "BGM_ASYNC_FADE_STOP" || ins.op === "BGM_POP") {
              this.audio.stopBgm();
            } else if (ins.op === "SE" || ins.op === "SE_WAIT") {
              const r = this._resolveSe(idScript, u16[2]);
              if (!r) { this.dbg(`  SE id=${idScript}: aucun PAK SE / hors plage`); }
              else if (r.stop) { this.audio.stopSe(); this.dbg("  SE: stop"); }
              else if (r.fmt === "inconnu" || r.fmt.startsWith("riff:")) {
                const hex = [...r.bytes.slice(0, 12)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
                console.warn(`  SE -> ${r.from} format "${r.fmt}" NON décodable (octets: ${hex})`);
              } else {
                this.dbg(`  SE -> ${r.from} [${r.fmt}]${r.loop ? " (boucle)" : ""}`);
                this.audio.playSe(r.bytes, r.from, r.loop);
              }
            } else if (ins.op === "BGM" || ins.op === "BGM_WAIT_START" || ins.op === "BGM_WAIT_FADE") {
              const r = this._resolveBgm(idScript);
              if (!r) { this.dbg(`  BGM id=${idScript}: aucun BGM.PAK importé`); }
              else if (r.stop) { this.audio.stopBgm(); this.dbg("  BGM: stop/fondu"); }
              else if (r.fmt === "inconnu" || r.fmt.startsWith("riff:")) {
                const hex = [...r.bytes.slice(0, 12)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
                console.warn(`  BGM -> ${r.from} format "${r.fmt}" NON décodable (octets: ${hex})`);
              } else {
                this.dbg(`  BGM -> ${r.from} [${r.fmt}] (boucle)`);
                this.audio.playBgm(r.bytes, r.from);
              }
            }
          } catch (e) { console.warn(`AUDIO-OP ${ins.op} KO:`, e.message); }
        }
      },
      imageload: async (ins) => {
        if (ins.kind === "background") await this._loadBackground(ins.imgId);
        else await this._loadSprite(ins); // mode != 0 = sprite personnage
      },
      draw: async () => {
        // DRAW compose la scène à l'écran : on repeint la base (fond chargé).
        this._renderBase();
      },
      movie: async (ins) => {
        await this._playMovie(ins.file);
      },
      // WAIT(n) : pause auto de ~n unités (≈16ms/unité), puis continue seul.
      // WAIT() : attend un clic du joueur. Pendant un WAIT auto, un clic abrège.
      wait: async (ins) => {
        const n = (ins.u16 && ins.u16[0]) || 0;
        if (n > 0) {
          await new Promise((res) => {
            this._advance = res;
            const ms = Math.min(8000, n * 16);
            this._autoTimer = setTimeout(() => this.advance(), ms);
          });
        } else {
          await this._waitAdvance(); // WAIT() = clic (respecte aussi auto/skip)
        }
      },
      // FADE : marque qu'un fondu est demandé pour le prochain HAIKEI_SET.
      fade: async () => { this._pendingFade = true; },
      // HAIKEI_SET : applique le décor courant. Si un FADE a été demandé, on
      // fait une transition fluide (fondu) au lieu d'un changement brutal.
      haikeiSet: async () => {
        if (this._pendingFade) {
          this._pendingFade = false;
          await this._fadeTransition();
        } else {
          this._renderBase();
        }
      },
      // LOG_BEGIN : texte narratif de cinématique, centré, qui s'ACCUMULE à
      // l'écran (les lignes précédentes restent jusqu'au LOG_END).
      logBegin: async (ins) => {
        if (!this._logLines) this._logLines = [];
        this._logLines.push(this._pick(ins));
        this._renderBase();
        this.renderer.drawNarration(this._logLines);
      },
      // LOG_END : efface le texte narratif accumulé.
      logEnd: async () => {
        this._logLines = [];
        this._renderBase();
      },
    });

    // évaluateur branché sur le store de variables
    vm.setExprEvaluator((expr) => evalExprValue(expr, this.vars));
    // continuité inter-seen : la VM peut suivre JUMP/FARCALL vers d'autres seen
    vm.scriptName = entryName;
    vm.setScriptLoader((name) => this._codesFor(name));
    this._vm = vm; // référence pour snapshot/restore (sauvegarde)

    // Restauration éventuelle d'une sauvegarde (position dans le script).
    if (this._pendingRestore) {
      vm.restoreState(this._pendingRestore);
      this._pendingRestore = null;
    }
    // Recharger le décor de la sauvegarde pour que la 1re réplique s'affiche
    // sur le bon fond (sinon écran vide jusqu'au prochain IMAGELOAD).
    if (this._pendingScreen) {
      // image de reprise plein écran (scène complète capturée au save) : on
      // l'affiche comme fond jusqu'à ce que le script recompose naturellement.
      try {
        const bmp = await this._dataURLToBitmap(this._pendingScreen);
        if (bmp) { this.currentBg = bmp; this._currentBgId = null; }
      } catch {}
      this._pendingScreen = null;
      this._pendingBgId = null;
    } else if (this._pendingBgId != null) {
      try { await this._loadBackground(this._pendingBgId); } catch {}
      this._pendingBgId = null;
    }

    await vm.run();
    this.renderer.clear();
    this.renderer.drawDialogue("", "[fin du script]");
  }

  // ---- Sauvegarde / chargement (slots multi avec vignette) -----------------

  // Capture une vignette du canvas courant (dataURL PNG réduit ~256px de large).
  _captureThumb(maxW = 256) {
    try {
      const src = this.renderer.canvas;
      const scale = maxW / src.width;
      const cv = document.createElement("canvas");
      cv.width = maxW; cv.height = Math.round(src.height * scale);
      cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
      return cv.toDataURL("image/jpeg", 0.7); // JPEG léger pour la vignette
    } catch { return null; }
  }

  // Capture l'écran en pleine résolution (dataURL JPEG) : sert d'image de reprise
  // affichée au chargement jusqu'à ce que le script recompose la scène. Évite les
  // black screens quand l'état visuel (fond + sprites + EVENTCG) est complexe.
  _captureScreen() {
    try {
      return this.renderer.canvas.toDataURL("image/jpeg", 0.85);
    } catch { return null; }
  }

  // Sauvegarde l'état courant (dernier MESSAGE) dans un slot.
  async saveToSlot(slot) {
    if (!this._savePoint) throw new Error("Rien à sauvegarder pour l'instant");
    // Capture la scène SANS la fenêtre de dialogue (fond + sprites + EVENTCG),
    // pour la réafficher telle quelle au chargement (pas de black screen).
    this._renderBase();
    const screen = this._captureScreen();
    const thumb = this._captureThumb();
    // re-affiche le dialogue courant (on n'a fait que recomposer pour la capture)
    if (this._cur && this._cur.type === "message") {
      const raw = this._pick(this._cur.ins);
      const m = raw.match(/^@([^@]*)@([\s\S]*)$/);
      this.renderer.drawDialogue(m ? m[1] : "", m ? m[2] : raw);
    }
    const record = {
      state: this._savePoint.state,
      vars: { ...this.vars },
      bgId: this._savePoint.bgId,
      screen,   // image plein écran de reprise
      thumb,
      meta: {
        speaker: this._savePoint.speaker || "",
        preview: this._savePoint.preview || "",
        seen: this._savePoint.state.scriptName,
        date: new Date().toLocaleString(),
        lang: this.lang,
      },
    };
    await this.saves.put(slot, record);
    return record;
  }

  // Charge un slot : relance le seen sauvegardé, restaure variables + position.
  async loadFromSlot(slot) {
    const rec = await this.saves.get(slot);
    if (!rec) throw new Error("Slot vide");
    this.dbg(`LOAD slot ${slot}: seen=${rec.state?.scriptName} pos=${rec.state?.pos} bgId=${rec.bgId} vars=${Object.keys(rec.vars || {}).length}`);
    this._pendingRestore = rec.state;
    this._pendingVars = { ...(rec.vars || {}) };
    this._pendingBgId = rec.bgId || null;
    this._pendingScreen = rec.screen || null;  // image de reprise plein écran
    await this.playEntry(rec.state.scriptName);
  }

  async listSaves() { return this.saves.list(); }
  async deleteSave(slot) { return this.saves.remove(slot); }

  // Sauvegarde/chargement rapide (slot dédié "quick", comme les boutons du
  // panneau de contrôle in-game). N'apparaît pas dans la grille de slots numérotés.
  async quickSave() { return this.saveToSlot("quick"); }
  async hasQuickSave() { return !!(await this.saves.get("quick")); }
  async quickLoad() {
    const rec = await this.saves.get("quick");
    if (!rec) return false;
    await this.loadFromSlot("quick");
    return true;
  }
}
