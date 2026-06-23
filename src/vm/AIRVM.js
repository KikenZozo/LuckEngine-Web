// ============================================================================
// LuckEngine-Web — src/vm/AIRVM.js
// ----------------------------------------------------------------------------
// VM qui parcourt les CodeLine décodées (cf. docs/reverse/vm.go : VM.Run).
//
//   - Parcours par index ; les sauts (jump = Pos cible) sont résolus via
//     posToIndex. (vm.go : findCode retrouve l'index d'une position.)
//   - END n'est PAS terminal (commentaire explicite de vm.go) : on ne s'arrête
//     qu'en sortant du tableau d'instructions.
//
// ÉVALUATION DES CONDITIONS (IFN/IFY, ONGOTO)
//   Le sous-VM d'expressions LuckSystem n'est pas fourni. Par défaut on NE PEUT
//   PAS évaluer une condition : exprEvaluator renvoie null => on NE SAUTE PAS
//   (fall-through), pour une lecture linéaire sûre sans boucle infinie.
//   Injecte ton évaluateur via setExprEvaluator((expr) => bool | number | null).
//
// COMPATIBILITÉ
//   API historique conservée : new AIRVM(codes, handlers) + run()/step().
//   Les handlers reçoivent l'instruction décodée (code.instruction).
// ============================================================================

export class AIRVM {
  /**
   * @param {object[]} codes        sortie de parseScript (chaque code a .instruction)
   * @param {object}   handlers     { message, select, debug, ... } callbacks async
   */
  constructor(codes, handlers = {}) {
    this.codes = codes;
    this.handlers = handlers;
    this.ip = 0;
    this.callStack = [];   // GOSUB/RETURN (intra-fichier)
    this.farStack = [];    // FARCALL/FARRETURN (inter-fichier)
    this.scriptName = "";  // nom du seen courant

    this._buildIndex();

    // null = inconnu -> pas de saut. Remplaçable.
    this.exprEvaluator = () => null;
    // (name) => codes[] | null : fournit les CodeLine d'un autre seen.
    this.loadScript = null;
  }

  _buildIndex() {
    this.posToIndex = new Map();
    for (const code of this.codes) this.posToIndex.set(code.pos, code.index);
  }

  setExprEvaluator(fn) { this.exprEvaluator = fn; }
  setScriptLoader(fn) { this.loadScript = fn; }

  // Bascule la VM sur un autre script (codes déjà parsés) à une position octale.
  _switchTo(codes, name, pos) {
    this.codes = codes;
    this.scriptName = name;
    this._buildIndex();
    this.ip = this._indexForPos(pos);
  }

  // Idem mais à un index de code explicite (retour de FARCALL).
  _switchToIndex(codes, name, idx) {
    this.codes = codes;
    this.scriptName = name;
    this._buildIndex();
    this.ip = idx;
  }

<<<<<<< HEAD
  // Capture l'état d'exécution (pour sauvegarde). On stocke la POSITION octale
  // (stable entre rechargements) plutôt que l'index, + les piles d'appel.
  snapshot() {
    const cur = this.codes[this.ip];
    return {
      scriptName: this.scriptName,
      pos: cur ? cur.pos : 0,
      callStack: [...this.callStack],
      farStack: this.farStack.map((f) => ({ ...f })),
    };
  }

  // Restaure un état capturé : recharge le seen et se place à la bonne position.
  restoreState(snap) {
    if (!snap) return;
    const codes = this.loadScript ? this.loadScript(snap.scriptName) : null;
    if (codes) this._switchTo(codes, snap.scriptName, snap.pos);
    else this.ip = this._indexForPos(snap.pos);
    this.callStack = [...(snap.callStack || [])];
    this.farStack = (snap.farStack || []).map((f) => ({ ...f }));
    this._restored = true; // empêche run() de réinitialiser ip à 0
  }

=======
>>>>>>> b5f05467b54fe6d8bb590c7f6a4856e34cae41e7
  // Charge un autre seen par nom et y bascule à la position 'pos'.
  _gotoScript(file, pos) {
    if (!this.loadScript) { this.ip++; return; }
    const codes = this.loadScript(file);
    if (!codes) { console.warn(`JUMP/FARCALL: seen "${file}" introuvable`); this.ip++; return; }
    console.log(`-> bascule sur seen "${file}" @${pos ?? 0}`);
    this._switchTo(codes, file, pos);
  }

  // index du code à la position octale 'pos' (ou le 1er code après, sinon 0).
  _indexForPos(pos) {
    if (pos == null) return 0;
    if (this.posToIndex.has(pos)) return this.posToIndex.get(pos);
    let best = 0, bestPos = Infinity;
    for (const c of this.codes) {
      if (c.pos >= pos && c.pos < bestPos) { bestPos = c.pos; best = c.index; }
    }
    return best;
  }

  _sameScript(file) {
    if (!file) return true;
    const a = String(file).toUpperCase().replace(/\.[A-Z0-9]+$/, "");
    const b = String(this.scriptName).toUpperCase().replace(/\.[A-Z0-9]+$/, "");
    return a === b;
  }

  reset() {
    this.ip = 0;
    this.callStack = [];
    this.farStack = [];
  }

  async run(maxSteps = 200000) {
<<<<<<< HEAD
    // Ne PAS réinitialiser si une sauvegarde vient d'être restaurée (sinon on
    // repartirait du début en écrasant ip/piles posés par restoreState).
    if (!this._restored) this.reset();
    this._restored = false;
=======
    this.reset();
>>>>>>> b5f05467b54fe6d8bb590c7f6a4856e34cae41e7
    let steps = 0;
    while (this.ip >= 0 && this.ip < this.codes.length) {
      const op = this.codes[this.ip].instruction.op;
      // chaque interaction (message/choix) remet le garde-fou à zéro : on ne
      // détecte que les vraies boucles infinies (beaucoup de sauts sans affichage)
      if (op === "MESSAGE" || op === "SELECT") steps = 0;
      if (steps++ > maxSteps) {
        throw new Error(`VM arrêtée après ${maxSteps} instructions sans affichage (boucle ?)`);
      }
      await this.step();
    }
  }

  async step() {
    const code = this.codes[this.ip];
    const ins = code.instruction;

    switch (ins.op) {
      case "MESSAGE":
        await this.call("message", ins, code);
        this.ip++;
        break;

      case "SELECT": {
        this.lastChoice = await this.call("select", ins, code);
        this.ip++;
        break;
      }

      case "GOTO":
        this.jumpTo(ins.jump);
        break;

      case "IFN": {
        const v = this.exprEvaluator(ins.expr, ins);
        // jump si faux ; inconnu (null) -> fall-through
        const decision = (v === null || v === undefined) ? "FALL-THROUGH (exécute la branche, condition non évaluable)"
          : (!v ? "SAUT (condition fausse)" : "passe (condition vraie)");
        console.log(`IF IFN "${ins.expr}" val=${v} -> ${decision}`);
        if (v === null || v === undefined) this.ip++;
        else if (!v) this.jumpTo(ins.jump);
        else this.ip++;
        break;
      }

      case "IFY": {
        const v = this.exprEvaluator(ins.expr, ins);
        const decision = (v === null || v === undefined) ? "FALL-THROUGH (exécute la branche, condition non évaluable)"
          : (v ? "SAUT (condition vraie)" : "passe (condition fausse)");
        console.log(`IF IFY "${ins.expr}" val=${v} -> ${decision}`);
        if (v === null || v === undefined) this.ip++;
        else if (v) this.jumpTo(ins.jump);
        else this.ip++;
        break;
      }

      case "ONGOTO": {
        const v = this.exprEvaluator(ins.expr, ins);
        if (typeof v === "number" && v >= 0 && v < ins.jumps.length) {
          this.jumpTo(ins.jumps[v]);
        } else {
          this.ip++;
        }
        break;
      }

      case "GOSUB":
        this.callStack.push(this.ip + 1);
        this.jumpTo(ins.jump);
        break;

      case "RETURN":
        this.ip = this.callStack.length ? this.callStack.pop() : this.ip + 1;
        break;

      case "FARRETURN":
        if (this.farStack.length) {
          const ret = this.farStack.pop();
          if (this._sameScript(ret.script)) {
            this.ip = ret.ip;
          } else if (this.loadScript) {
            const codes = this.loadScript(ret.script);
            if (codes) { this._switchToIndex(codes, ret.script, ret.ip); }
            else this.ip++;
          } else this.ip++;
        } else {
          this.ip = this.callStack.length ? this.callStack.pop() : this.ip + 1;
        }
        break;

      case "FARCALL": {
        await this.call("farjump", ins, code);
        // retour après l'appel (instruction suivante du seen courant)
        if (!this._sameScript(ins.file)) {
          this.farStack.push({ script: this.scriptName, ip: this.ip + 1 });
          this._gotoScript(ins.file, ins.jump);
        } else {
          this.callStack.push(this.ip + 1);
          if (ins.jump != null) this.jumpTo(ins.jump); else this.ip++;
        }
        break;
      }

      case "JUMP":
        await this.call("farjump", ins, code);
        if (!this._sameScript(ins.file)) {
          this._gotoScript(ins.file, ins.jump);
        } else if (ins.jump != null && this.posToIndex.has(ins.jump)) {
          this.jumpTo(ins.jump);
        } else {
          this.ip++;
        }
        break;

      case "IMAGELOAD":
        await this.call("imageload", ins, code);
        this.ip++;
        break;

      case "DRAW":
      case "DISP":
        await this.call("draw", ins, code);
        this.ip++;
        break;

      case "MOVIE":
        await this.call("movie", ins, code);
        this.ip++;
        break;

<<<<<<< HEAD
      case "WAIT":
        // WAIT(n) = pause auto de n unités puis on continue ; WAIT() = attend le clic.
        await this.call("wait", ins, code);
        this.ip++;
        break;

      case "LOG_BEGIN":
        await this.call("logBegin", ins, code);
        this.ip++;
        break;

      case "LOG_END":
        await this.call("logEnd", ins, code);
        this.ip++;
        break;

=======
>>>>>>> b5f05467b54fe6d8bb590c7f6a4856e34cae41e7
      default:
        await this.call("debug", ins, code);
        this.ip++;
        break;
    }
  }

  jumpTo(pos) {
    const next = this.posToIndex.get(pos);
    if (next === undefined) {
      throw new Error(`Cible de saut introuvable: pos=${pos}`);
    }
    this.ip = next;
  }

  async call(name, ...args) {
    const handler = this.handlers[name];
    if (handler) return await handler(...args);
    return undefined;
  }
}
