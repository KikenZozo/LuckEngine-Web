// ============================================================================
// LuckEngine-Web — src/tests/selftest.js
// ----------------------------------------------------------------------------
// Test de bout en bout SANS fichiers de jeu. On fabrique en mémoire :
//   1. un script (octets CodeLine, suivant CodeString de script.go),
//   2. un conteneur .PAK (suivant open() de pak.go),
// puis on vérifie PakReader -> parseScript -> AIRVM.
//
// Lancer :  npm test   (ou: node src/tests/selftest.js)
// ============================================================================

import { PakReader } from "../pak/PakReader.js";
import { parseScript } from "../script/AIRParser.js";
import { AIRVM } from "../vm/AIRVM.js";
import { evalExpr, evalExprValue } from "../vm/ExprEval.js";
import { decodeCZ, _internals } from "../image/czimage.js";
import { OPCODES } from "../script/OpcodeTable.js";

let pass = 0,
  fail = 0;
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual),
    e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  \u2713 ${msg}`);
  } else {
    fail++;
    console.error(`  \u2717 ${msg}\n      attendu: ${e}\n      obtenu : ${a}`);
  }
}

// ---- encodeurs (miroir de CodeString, script.go) --------------------------
const OP = Object.fromEntries(OPCODES.map((n, i) => [n, i]));
const u16 = (v) => Uint8Array.of(v & 0xff, (v >> 8) & 0xff);
const u32 = (v) =>
  Uint8Array.of(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
function cat(...a) {
  const out = new Uint8Array(a.reduce((s, x) => s + x.length, 0));
  let o = 0;
  for (const x of a) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}
const lenU16 = (s) => {
  const b = new Uint8Array(Buffer.from(s, "utf16le"));
  return cat(u16(b.length / 2), b, u16(0));
};
const lenU8 = (s) => {
  const b = new Uint8Array(Buffer.from(s, "utf8"));
  return cat(u16((0x10000 - b.length) & 0xffff), b, Uint8Array.of(0));
};
function codeLine(opcode, fixedFlag, fixedParams, paramBytes) {
  const raw = cat(cat(...fixedParams.map(u16)), paramBytes);
  const len = 4 + raw.length;
  const align = len & 1 ? Uint8Array.of(0) : new Uint8Array(0);
  return cat(u16(len), Uint8Array.of(opcode & 0xff, fixedFlag & 0xff), raw, align);
}

// ---- script synthétique ----------------------------------------------------
// flux : [0]GOTO -> [1]IFN ; IFN(true) tombe sur [2]MESSAGE ; SELECT ; WAIT ; END
function buildScript(gotoTarget, ifnTarget) {
  const pMsg = cat(
    u16(0),
    lenU16("\u3053\u3093\u306b\u3061\u306f"), // jp こんにちは
    lenU8("Hello"), // en (UTF-8)
    lenU16("\u4f60\u597d"), // zh 你好
    u16(7) // tail
  );
  const pSel = cat(
    u16(1), u16(2), u16(0), u16(0),
    lenU16("\u306f\u3044"), // jp はい
    lenU16("Yes"),
    lenU16("\u662f") // zh 是
  );
  const lines = [
    codeLine(OP.GOTO, 0, [], u32(gotoTarget)),
    codeLine(OP.IFN, 0, [], cat(lenU8("flag==1"), u32(ifnTarget))),
    codeLine(OP.MESSAGE, 0, [], pMsg),
    codeLine(OP.SELECT, 0, [], pSel),
    codeLine(OP.WAIT, 0, [], cat(u16(10), u16(20))),
    codeLine(OP.END, 0, [], new Uint8Array(0)),
  ];
  const positions = [];
  let pos = 0;
  for (const l of lines) {
    positions.push(pos);
    const len = l[0] | (l[1] << 8);
    pos += (len + 1) & ~1;
  }
  return { bytes: cat(...lines), positions };
}

// 1er passage : connaître les Pos, puis ré-encoder avec les bonnes cibles.
const probe = buildScript(0, 0);
const posIFN = probe.positions[1];
const posSELECT = probe.positions[3];
const script = buildScript(posIFN, posSELECT); // GOTO -> IFN ; IFN -> SELECT
const entry1 = buildScript(0, 0).bytes; // 2e entrée (peu importe)

// ---- conteneur PAK synthétique (miroir de pak.go open()) ------------------
function buildPak({ withNames }) {
  const blockSize = 2048;
  const idStart = 100;
  const headerLength = 2048; // 1 bloc
  const target = headerLength / blockSize; // = 1 (Offset bloc 1re entrée)
  const flags = withNames ? 512 : 0;

  const buf = new Uint8Array(blockSize * 4); // header + 2 blocs de data + marge
  const dv = new DataView(buf.buffer);
  const setU32 = (off, v) => dv.setUint32(off, v >>> 0, true);

  // Header (9 x u32)
  setU32(0, headerLength);
  setU32(4, 2); // fileCount
  setU32(8, idStart);
  setU32(12, blockSize);
  setU32(32, flags);

  let tableOffset;
  if (withNames) {
    // pointeur de noms en (tableOffset-4) => table à 40, pointeur à 36
    tableOffset = 40;
    setU32(36, 200); // namesPtr (doit != target)
  } else {
    tableOffset = 36;
  }

  // Table : entrée0 (bloc 1), entrée1 (bloc 2)
  setU32(tableOffset + 0, 1);
  setU32(tableOffset + 4, script.bytes.length);
  setU32(tableOffset + 8, 2);
  setU32(tableOffset + 12, entry1.length);

  if (withNames) {
    const names = cat(
      new Uint8Array(Buffer.from("script0\0", "binary")),
      new Uint8Array(Buffer.from("script1\0", "binary"))
    );
    buf.set(names, 200);
  }

  buf.set(script.bytes, blockSize * 1); // données entrée0 @ bloc 1
  buf.set(entry1, blockSize * 2); // données entrée1 @ bloc 2
  return buf.buffer;
}

// ---- 1) PakReader ----------------------------------------------------------
console.log("== PakReader (PAK sans noms) ==");
{
  const pak = new PakReader(buildPak({ withNames: false }));
  eq(pak.header.fileCount, 2, "fileCount");
  eq(pak.header.blockSize, 2048, "blockSize");
  eq(pak.entries.length, 2, "2 entrées");
  eq(pak.entries[0].offset, 2048, "entrée0 offset = bloc*blockSize");
  eq(pak.entries[0].id, 100, "entrée0 id = idStart");
  eq([...pak.getEntry(0)], [...script.bytes], "getEntry(0) = octets du script");
}

console.log("\n== PakReader (PAK avec noms, Flags&512) ==");
{
  const pak = new PakReader(buildPak({ withNames: true }));
  eq(
    pak.entries.map((e) => e.name),
    ["script0", "script1"],
    "noms lus depuis la table de noms"
  );
  eq([...pak.getEntryByName("script0")], [...script.bytes], "getEntryByName");
}

// ---- 2) parseScript --------------------------------------------------------
console.log("\n== parseScript ==");
const pak = new PakReader(buildPak({ withNames: false }));
const codes = parseScript(pak.getEntry(0));
eq(codes.length, 6, "6 CodeLine");
eq(codes.map((c) => c.op), ["GOTO", "IFN", "MESSAGE", "SELECT", "WAIT", "END"], "opcodes");
eq(codes.map((c) => c.pos), script.positions, "positions Pos");

const msg = codes[2].instruction;
eq(msg.jp, "\u3053\u3093\u306b\u3061\u306f", "MESSAGE jp (UTF-16)");
eq(msg.en, "Hello", "MESSAGE en (UTF-8, longueur négative)");
eq(msg.zh, "\u4f60\u597d", "MESSAGE zh (UTF-16)");

const sel = codes[3].instruction;
eq([sel.a, sel.b, sel.c, sel.d], [1, 2, 0, 0], "SELECT 4 uint16");
eq([sel.jp, sel.en, sel.zh], ["\u306f\u3044", "Yes", "\u662f"], "SELECT jp/en/zh");
eq(sel.choices, [{ jp: "\u306f\u3044", en: "Yes", zh: "\u662f" }], "SELECT 1 choix (sans $d)");

// ---- 2b) SELECT multi-choix séparés par $d (confirmé sur données réelles) --
console.log("\n== SELECT avec $d ==");
{
  const p = cat(
    u16(6001), u16(0), u16(2), u16(0),
    lenU16("\u53f3$d\u5de6"), // 右$d左
    lenU16("Droite$dGauche"),
    lenU16("R$dL")
  );
  const one = parseScript(codeLine(OP.SELECT, 0, [], p));
  const s = one[0].instruction;
  eq(s.varId, 6001, "SELECT varId = 1er uint16 (variable du choix)");
  eq(s.choices.length, 2, "2 choix après split $d");
  eq(s.choices.map((c) => c.en), ["Droite", "Gauche"], "libellés en splittés");
}

// ---- 2c) ExprEval (port fidèle de expr.go) ---------------------------------
console.log("\n== ExprEval ==");
eq(evalExpr("(#6001==0)", { "#6001": 0 }), true, "(#6001==0) avec #6001=0");
eq(evalExpr("(#6001==0)", { "#6001": 1 }), false, "(#6001==0) avec #6001=1");
eq(evalExpr("(#47!=1)", { "#47": 0 }), true, "(#47!=1) avec #47=0");
eq(evalExprValue("(1+2*3)", {}), 7, "priorité des opérateurs : 1+2*3 = 7");
eq(evalExprValue("(#a&&#b)", { "#a": 1, "#b": 0 }), 0, "&& : 1 && 0 = 0");
eq(evalExprValue("(#x)", {}), 0, "variable absente = 0");

const ifn = codes[1].instruction;
eq(ifn.expr, "flag==1", "IFN expr (UTF-8)");
eq(ifn.jump, posSELECT, "IFN cible = Pos(SELECT)");
eq(codes[0].instruction.jump, posIFN, "GOTO cible = Pos(IFN)");

// ---- 3) AIRVM --------------------------------------------------------------
console.log("\n== AIRVM ==");
const events = [];
const vm = new AIRVM(codes, {
  message: (ins) => events.push(["message", ins.jp]),
  select: (ins) => events.push(["select", ins.jp]),
  debug: (ins) => events.push(["debug", ins.op]),
});
vm.setExprEvaluator((expr) => (expr === "flag==1" ? true : null));
await vm.run();

// GOTO -> IFN ; IFN(true) ne saute pas (jump-if-false) -> MESSAGE, SELECT, WAIT, END
// WAIT a désormais son propre handler (non fourni ici) -> n'émet aucun événement.
eq(
  events,
  [
    ["message", "\u3053\u3093\u306b\u3061\u306f"],
    ["select", "\u306f\u3044"],
    ["debug", "END"],
  ],
  "séquence d'événements VM (GOTO+IFN exercés, END non terminal)"
);

// ---- 4) Décodeur CZ (port de czimage) --------------------------------------
console.log("\n== czimage (CZ decoder) ==");
{
  eq([..._internals.decompressLZW(Uint16Array.of(65, 66, 67), 3)], [65, 66, 67], "LZW littéraux A,B,C");
  eq([..._internals.decompressLZW(Uint16Array.of(65, 256), 3)], [65, 65, 65], "LZW reprise dico -> AAA");

  const hdr = { width: 1, height: 4 };
  const data = Uint8Array.of(
    10, 20, 30, 5, 5, 5, 50, 60, 70, 5, 5, 5,
    40, 5, 80, 5
  );
  eq(
    [..._internals.lineDiff4(hdr, data)],
    [10, 20, 30, 40, 15, 25, 35, 45, 50, 60, 70, 80, 55, 65, 75, 85],
    "LineDiff4 reconstruit le delta par bloc"
  );

  const cz0 = new Uint8Array(15 + 16);
  cz0.set([0x43, 0x5a, 0x30, 0x00], 0);
  const dvz = new DataView(cz0.buffer);
  dvz.setUint32(4, 15, true);
  dvz.setUint16(8, 2, true);
  dvz.setUint16(10, 2, true);
  dvz.setUint16(12, 32, true);
  const px = [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255];
  cz0.set(px, 15);
  const img = decodeCZ(cz0);
  eq([img.width, img.height, img.format], [2, 2, "CZ0"], "CZ0 header décodé");

  // edge-bleed : un pixel opaque (RGB 90,90,90) à côté d'un transparent au RGB
  // parasite -> le transparent reçoit le RGB du voisin, alpha INCHANGÉ (=0).
  {
    const w = 2, hh = 1;
    const px = new Uint8ClampedArray([90, 90, 90, 255,  9, 9, 9, 0]); // opaque | transparent+parasite
    _internals.bleedEdges(px, w, hh);
    eq([px[4], px[5], px[6]], [90, 90, 90], "edge-bleed copie le RGB du voisin opaque");
    eq(px[7], 0, "edge-bleed ne touche pas l'alpha");
  }
}

// ---- 5) Saut inter-seen (JUMP vers un autre script) ------------------------
console.log("\n== AIRVM inter-seen ==");
{
  const scriptA = [{ pos: 0, index: 0, instruction: { op: "JUMP", file: "B", jump: 0 } }];
  const scriptB = [{ pos: 0, index: 0, instruction: { op: "MESSAGE" } }];
  let reached = "";
  const vm = new AIRVM(scriptA, {
    message: async () => { reached = vm.scriptName; },
  });
  vm.scriptName = "A";
  vm.setScriptLoader((name) => (String(name).toUpperCase() === "B" ? scriptB : null));
  await vm.run();
  eq([reached], ["B"], "JUMP bascule bien sur le seen B et y exécute MESSAGE");
}

console.log(`\n== Bilan : ${pass} OK, ${fail} KO ==`);
process.exit(fail === 0 ? 0 : 1);
