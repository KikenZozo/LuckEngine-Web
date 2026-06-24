// ============================================================================
// LuckEngine-Web — src/render/CanvasRenderer.js
// ----------------------------------------------------------------------------
// Rendu Canvas 2D minimal : boîte de dialogue + liste de choix.
// (Les backgrounds CZ4/BGCG passent par ton pipeline existant ; ils pourront
//  être dessinés avant drawDialogue via drawBackground.)
// ============================================================================

// Pile de polices proche du rendu original : gothique CJK pour le japonais,
// humaniste propre pour le latin (FR/EN). Repli système si rien d'installé.
const DIALOGUE_FONT =
  "'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, 'Noto Sans CJK JP', 'Noto Sans JP', 'Segoe UI', system-ui, sans-serif";

export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { willReadFrequently: true });
    this.smoothing = true; // diagnostic : lissage activé par défaut (touche S)
    this.uiSkin = null;
  }
  setUiSkin(skin) { this.uiSkin = skin || null; }

  // Dessine UNE frame de la plume animée (MWIN_CURSOR = 4 frames empilées),
  // avec un léger décalage vertical `dy` pour un battement fluide.
  _drawCursorFrame(frameIndex, dy = 0) {
    const c = this._cursorBox;
    if (!c) return;
    const { ctx } = this;
    const srcY = (frameIndex % c.frames) * c.fh;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(c.img.bitmap, 0, srcY, c.fw, c.fh, c.x, c.baseY + dy, c.w, c.h);
  }

  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = "#222";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** @param {ImageBitmap|HTMLCanvasElement|HTMLImageElement} img */
  drawBackground(img) {
    // fond uni spécial ({solid:"#000000"}) — couleur pleine au lieu d'un bitmap
    if (img && img.solid) {
      this.ctx.fillStyle = img.solid;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    this.ctx.imageSmoothingEnabled = this.smoothing;
    this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
  }

  /** Dessine un sprite (avec transparence) à une position/taille données. */
  drawSprite(img, dx, dy, dw, dh) {
    this.ctx.imageSmoothingEnabled = this.smoothing;
    this.ctx.drawImage(img, dx, dy, dw, dh);
  }

  _wrap(text, maxWidth) {
    const words = String(text).split(/(\s+)/);
    const lines = [];
    let line = "";
    for (const w of words) {
      const test = line + w;
      if (this.ctx.measureText(test).width > maxWidth && line) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = test;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
  }

  // Dessine la fenêtre de dialogue. `revealCount` (optionnel) limite le nombre
  // de caractères affichés (effet machine à écrire) ; null/omis = tout le texte.
  // Renvoie le nombre total de caractères révélables (après retour à la ligne),
  // ce qui permet à la boucle d'animation de savoir quand la frappe est finie.
  drawDialogue(name, text, revealCount = null) {
    const { ctx, canvas } = this;
    const skin = this.uiSkin;
    // Fenêtre de dialogue : vraie image MWIN0 (1280x240) en bas, sinon fallback.
    if (skin && skin.mwin) {
      const W = canvas.width;
      const h = canvas.height * 0.30;
      const y = canvas.height - h;
      ctx.imageSmoothingEnabled = this.smoothing;
      ctx.drawImage(skin.mwin.bitmap, 0, y, W, h);
      // Zone INTERNE réelle de la fenêtre (la fenêtre a des marges transparentes).
      const ins = skin.mwin.inset || { x0: 0, y0: 0, x1: 1, y1: 1 };
      const inX = ins.x0 * W;                       // bord gauche de la fenêtre
      const inW = (ins.x1 - ins.x0) * W;            // largeur interne
      const inTop = y + ins.y0 * h;                 // haut interne
      const inH = (ins.y1 - ins.y0) * h;            // hauteur interne
      const padX = inX + inW * 0.04;                // petit retrait dans la fenêtre
      let textY = inTop + inH * 0.38;
      if (name) {
        ctx.font = `bold ${Math.round(inH * 0.18)}px ${DIALOGUE_FONT}`;
        ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
        ctx.fillStyle = "#ffd479";
        ctx.fillText(name, padX, inTop + inH * 0.20);
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
        textY = inTop + inH * 0.50;
      }
      const fs = Math.round(inH * 0.16);
      ctx.font = `${fs}px ${DIALOGUE_FONT}`;
      // Découpe en lignes sur le texte COMPLET (mise en page stable pendant la
      // frappe), puis on révèle caractère par caractère selon `revealCount`.
      const lines = this._wrap(text, inW - inW * 0.08);
      const total = lines.reduce((s, l) => s + l.length, 0);
      const fullyShown = revealCount == null || revealCount >= total;
      let budget = fullyShown ? Infinity : Math.max(0, revealCount);
      ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 4; ctx.shadowOffsetY = 1;
      ctx.fillStyle = "white";
      for (const line of lines) {
        const part = budget >= line.length ? line : line.slice(0, budget);
        if (part) ctx.fillText(part, padX, textY);
        budget -= line.length;
        textY += fs * 1.4;
        if (budget <= 0 && !fullyShown) break;
      }
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      // Plume "continuer" : seulement quand TOUT le texte est révélé.
      if (skin.mwinCursor && fullyShown) {
        // Plume animée : MWIN_CURSOR contient 4 frames empilées. On mémorise la
        // zone de dessin pour que la boucle d'animation n'y redessine que la plume.
        const frames = skin.mwinCursor.frames || 1;
        const fw = skin.mwinCursor.w;
        const fh = skin.mwinCursor.h / frames;
        const scale = 0.7;
        const cw = fw * scale, chh = fh * scale;
        const cx = inX + inW - cw - 6;
        const cy = inTop + inH - chh - 4;
        this._cursorBox = { img: skin.mwinCursor, fw, fh, frames, x: cx, y: cy, w: cw, h: chh, baseY: cy };
        // capture une photo propre de la zone (fenêtre sans plume) pour l'effacement
        // pendant l'animation, sans avoir à redessiner toute la scène.
        try {
          const pad = 10;
          const bx = Math.max(0, cx - pad), by = Math.max(0, cy - pad);
          const bw = cw + pad * 2, bh = chh + pad * 2;
          this._cursorBox.clean = ctx.getImageData(bx, by, bw, bh);
          this._cursorBox.cleanX = bx; this._cursorBox.cleanY = by;
        } catch { this._cursorBox.clean = null; }
        this._drawCursorFrame(0, 0);
      } else {
        this._cursorBox = null;
      }
      return total;
    }
    // --- fallback (pas d'image MWIN) ---
    const boxH = 180;
    const y = canvas.height - boxH - 20;
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fillRect(20, y, canvas.width - 40, boxH);
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.strokeRect(20, y, canvas.width - 40, boxH);
    let textY = y + 50;
    if (name) {
      ctx.fillStyle = "#ffd479";
      ctx.font = `bold 24px ${DIALOGUE_FONT}`;
      ctx.fillText(name, 44, y + 36);
      textY = y + 76;
    }
    ctx.fillStyle = "white";
    ctx.font = `26px ${DIALOGUE_FONT}`;
    const lines = this._wrap(text, canvas.width - 100);
    const total = lines.reduce((s, l) => s + l.length, 0);
    const fullyShown = revealCount == null || revealCount >= total;
    let budget = fullyShown ? Infinity : Math.max(0, revealCount);
    for (const line of lines) {
      const part = budget >= line.length ? line : line.slice(0, budget);
      if (part) ctx.fillText(part, 44, textY);
      budget -= line.length;
      textY += 36;
      if (budget <= 0 && !fullyShown) break;
    }
    if (fullyShown) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = `16px ${DIALOGUE_FONT}`;
      ctx.fillText("clic pour continuer \u25B6", canvas.width - 240, canvas.height - 32);
    }
    return total;
  }

  /** @param {string[]} choices */
  drawChoices(choices, selectedIndex = -1) {
    const { ctx, canvas } = this;
    const skin = this.uiSkin;
    this._choiceRects = [];

    // Vraies barres de choix SELWIN : l'image contient 3 bandes (états) empilées,
    // on n'en découpe qu'UNE (skin.selwin.band) par bouton.
    if (skin && skin.selwin && skin.selwin.band) {
      const img = skin.selwin;
      // Boutons plus compacts (largeur réduite) et un peu plus épais que la bande
      // native, pour coller au rendu du jeu et limiter le bleu vide autour du texte.
      const bw = canvas.width * 0.50;              // moins large
      const srcH = (img.band.y1 - img.band.y0) * img.h;
      const ratio = srcH / img.w;
      const bh = Math.max(bw * ratio * 1.4, canvas.height * 0.075); // plus épais
      const gap = bh * 0.55;
      const totalH = choices.length * bh + (choices.length - 1) * gap;
      let y = (canvas.height - totalH) / 2;
      const x = (canvas.width - bw) / 2;
      ctx.imageSmoothingEnabled = this.smoothing;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const fs = Math.round(bh * 0.42);
      choices.forEach((c, i) => {
        const src = (i === selectedIndex && skin.selwinSel) ? skin.selwinSel : img;
        const sy = src.band ? src.band.y0 * src.h : 0;
        const sh = src.band ? (src.band.y1 - src.band.y0) * src.h : src.h;
        ctx.drawImage(src.bitmap, 0, sy, src.w, sh, x, y, bw, bh);
        ctx.fillStyle = "#fff";
        ctx.font = `${fs}px ${DIALOGUE_FONT}`;
        ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 3;
        ctx.fillText(c, canvas.width / 2, y + bh / 2);
        ctx.shadowBlur = 0;
        this._choiceRects.push({ i, x, y, w: bw, h: bh });
        y += bh + gap;
      });
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
      return;
    }

    // --- fallback (pas d'image SELWIN) ---
    const cw = canvas.width * 0.6;
    const ch = 56;
    const gap = 16;
    const totalH = choices.length * ch + (choices.length - 1) * gap;
    let y = (canvas.height - totalH) / 2;
    const x = (canvas.width - cw) / 2;
    ctx.font = "24px system-ui, sans-serif";
    choices.forEach((c, i) => {
      ctx.fillStyle = i === selectedIndex ? "rgba(120,90,40,0.95)" : "rgba(0,0,0,0.8)";
      ctx.fillRect(x, y, cw, ch);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.strokeRect(x, y, cw, ch);
      ctx.fillStyle = "white";
      ctx.fillText(c, x + 24, y + ch / 2 + 8);
      this._choiceRects.push({ i, x, y, w: cw, h: ch });
      y += ch + gap;
    });
  }

  /** Renvoie l'index du choix sous (px,py), ou -1. */
  hitChoice(px, py) {
    for (const r of this._choiceRects ?? []) {
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r.i;
    }
    return -1;
  }

  /** Cadre + étiquette numérotée d'une couche (overlay de debug). */
  drawDebugBox(dx, dy, dw, dh, label, idx) {
    const ctx = this.ctx;
    const colors = ["#ff5252", "#ffd740", "#69f0ae", "#40c4ff", "#e040fb", "#ff9100", "#b388ff"];
    const c = colors[idx % colors.length];
    ctx.save();
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.setLineDash([]);
    const tag = `${idx}: ${label}`;
    ctx.font = "bold 15px system-ui, sans-serif";
    const tw = ctx.measureText(tag).width;
    ctx.fillStyle = c;
    ctx.fillRect(dx, Math.max(0, dy - 20), tw + 10, 20);
    ctx.fillStyle = "#000";
    ctx.fillText(tag, dx + 5, Math.max(14, dy - 5));
    ctx.restore();
  }

  /** Texte simple (écran d'accueil). */
  drawText(text) {
    this.clear();
    this.ctx.fillStyle = "white";
    this.ctx.font = "22px system-ui, sans-serif";
    this.ctx.fillText(text, 40, 60);
  }

  /** Texte narratif de cinématique (LOG_BEGIN) : lignes centrées qui s'accumulent
   *  au centre de l'écran, sans fenêtre de dialogue. */
  drawNarration(lines) {
    const { ctx, canvas } = this;
    this._cursorBox = null; // pas de plume sur la narration cinématique
    const fs = Math.round(canvas.height * 0.045);
    ctx.save();
    ctx.font = `${fs}px ${DIALOGUE_FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lh = fs * 1.7;
    const total = lines.length * lh;
    let y = canvas.height / 2 - total / 2 + lh / 2;
    for (const ln of lines) {
      // léger halo sombre pour la lisibilité sur fonds clairs comme foncés
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillText(ln, canvas.width / 2 + 1, y + 1);
      ctx.fillStyle = "rgba(40,45,60,0.92)";
      ctx.fillText(ln, canvas.width / 2, y);
      y += lh;
    }
    ctx.restore();
  }
}
