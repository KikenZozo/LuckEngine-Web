import { ScriptBinaryReader } from "./ScriptBinaryReader.js";
import { opcodeName } from "./OpcodeTable.js";

export function parseScript(bufferOrBytes) {
  const reader = new ScriptBinaryReader(bufferOrBytes);
  const codes = [];

  let pos = 0;
  let index = 0;

  while (reader.canRead(4)) {
    const lineStart = reader.offset;
    const len = reader.readUint16();
    const opcode = reader.readUint8();
    const fixedFlag = reader.readUint8();

    if (len < 4) {
      throw new Error(`Invalid CodeLine len=${len} at script offset=${lineStart}`);
    }

    const rawBytes = reader.readBytes(len - 4);

    if (len & 1) {
      if (reader.canRead(1)) reader.readUint8();
    }

    const { fixedParam, paramBytes } = splitFixedParams(rawBytes, fixedFlag);
    const op = opcodeName(opcode);

    const code = {
      index,
      pos,
      lineStart,
      len,
      opcode,
      op,
      fixedFlag,
      fixedParam,
      rawBytes,
      paramBytes
    };

    code.instruction = parseAIRInstruction(code);

    codes.push(code);

    pos += (len + 1) & ~1;
    index++;
  }

  return codes;
}

export function splitFixedParams(rawBytes, fixedFlag) {
  const u16 = (i) => rawBytes[i] | (rawBytes[i + 1] << 8);

  if (fixedFlag >= 2) {
    return {
      fixedParam: [u16(0), u16(2)],
      paramBytes: rawBytes.slice(4)
    };
  }

  if (fixedFlag === 1) {
    return {
      fixedParam: [u16(0)],
      paramBytes: rawBytes.slice(2)
    };
  }

  return {
    fixedParam: [],
    paramBytes: rawBytes
  };
}

export function parseAIRInstruction(code) {
  const op = code.op;
  const r = new ScriptBinaryReader(code.paramBytes);

  try {
    switch (op) {
      case "GOTO":
        return { op, jump: r.readUint32() };

      case "IFN":
      case "IFY":
        return {
          op,
          expr: r.readLenStringUTF8(),
          jump: r.readUint32()
        };

      case "ONGOTO": {
        const expr = r.readLenStringUTF8();
        const count = r.readUint16();
        const jumps = [];
        for (let i = 0; i < count; i++) jumps.push(r.readUint32());
        return { op, expr, count, jumps };
      }

      case "GOSUB":
        return {
          op,
          unk: r.readUint16(),
          jump: r.readUint32()
        };

      case "JUMP": {
        const file = r.readLenStringUTF8();
        const out = { op, file };
        if (r.canRead(4)) out.jump = r.readUint32();
        if (r.remaining() > 0) out.tail = [...r.readBytes(r.remaining())];
        return out;
      }

      case "FARCALL":
        return {
          op,
          unk: r.readUint16(),
          file: r.readLenStringUTF8(),
          jump: r.readUint32()
        };

<<<<<<< HEAD
      case "LOG_BEGIN": {
        // Texte narratif de cinématique (ex intro "My child…"). Même structure
        // de chaînes que MESSAGE : un u16 puis jp / en / zh.
        const unk = r.readUint16();
        const jp = r.readLenStringUTF16LE();
        const out = { op, unk, jp, text: jp };
        if (jp.length > 0 && r.canRead(2)) {
          out.en = r.readLenStringUTF8();
          if (r.canRead(2)) out.zh = r.readLenStringUTF16LE();
        }
        if (r.remaining() > 0) out.tail = [...r.readBytes(r.remaining())];
        return out;
      }

=======
>>>>>>> b5f05467b54fe6d8bb590c7f6a4856e34cae41e7
      case "MESSAGE": {
        const unk = r.readUint16();
        const jp = r.readLenStringUTF16LE();

        const out = {
          op,
          unk,
          jp,
          text: jp
        };

        if (jp.length > 0 && r.canRead(2)) {
          out.en = r.readLenStringUTF8();
          if (r.canRead(2)) out.zh = r.readLenStringUTF16LE();
        }

        if (r.remaining() > 0) out.tail = [...r.readBytes(r.remaining())];

        return out;
      }

      case "VARSTR_SET": {
        const constValue = r.readUint16();
        const filename = readCStringUTF8BestEffort(r);
        const varstrId = r.canRead(2) ? r.readUint16() : null;
        const jp = r.canRead(2) ? r.readLenStringUTF16LE() : "";
        const out = { op, constValue, filename, varstrId, jp };
        if (jp.length > 0 && r.canRead(2)) {
          out.en = r.readLenStringUTF16LE();
          if (r.canRead(2)) out.zh = r.readLenStringUTF16LE();
        }
        if (r.remaining() > 0) out.tail = [...r.readBytes(r.remaining())];
        return out;
      }

      case "SELECT": {
        // CONFIRMÉ sur données AIR réelles : 4 uint16, puis jp/en/zh en UTF-16LE.
        // Le 1er uint16 (a) est la VARIABLE qui reçoit l'index choisi (ex: 6001,
        // testée ensuite par IFN "(#6001==0)"). Les choix sont concaténés dans
        // UNE chaîne, séparés par "$d".
        const a = r.readUint16();
        const b = r.readUint16();
        const c = r.readUint16();
        const d = r.readUint16();

        const jp = r.readLenStringUTF16LE();
        let en = "";
        let zh = "";
        if (jp.length > 0 && r.canRead(2)) {
          en = r.readLenStringUTF16LE();
          if (r.canRead(2)) zh = r.readLenStringUTF16LE();
        }

        const split = (s) => (s ? s.split("$d") : []);
        const cj = split(jp);
        const ce = split(en);
        const cz = split(zh);
        const n = Math.max(cj.length, ce.length, cz.length);
        const choices = [];
        for (let k = 0; k < n; k++) {
          choices.push({ jp: cj[k] ?? "", en: ce[k] ?? "", zh: cz[k] ?? "" });
        }

        const out = { op, a, b, c, d, varId: a, jp, en, zh, text: jp, choices };
        if (r.remaining() > 0) out.tail = [...r.readBytes(r.remaining())];
        return out;
      }

      case "LOG_BEGIN": {
        const a = r.readUint8();
        const b = r.readUint8();
        const c = r.readUint8();
        const jp = r.readLenStringUTF16LE();
        const out = { op, a, b, c, jp, text: jp };
        if (jp.length > 0 && r.canRead(2)) {
          out.en = r.readLenStringUTF16LE();
          if (r.canRead(2)) out.zh = r.readLenStringUTF16LE();
        }
        if (r.remaining() > 0) out.tail = [...r.readBytes(r.remaining())];
        return out;
      }

      case "DIALOG": {
        const a = r.readUint16();
        const b = r.readUint16();
        const jp = r.readLenStringUTF16LE();
        const out = { op, a, b, jp, text: jp };
        if (r.remaining() > 0) out.tail = [...r.readBytes(r.remaining())];
        return out;
      }

      case "MOVIE": {
        const unk = r.readUint16();
        const file = readCStringUTF8BestEffort(r);
        const out = { op, unk, file };
        if (r.remaining() > 0) out.tail = [...r.readBytes(r.remaining())];
        return out;
      }

      case "IMAGELOAD": {
        // D'après LB_EN.go : mode(u16), imgID(u16) ; mode==0 => fond (background),
        // sinon => sprite (立绘) avec var1 + position. Sur AIR la position est en
        // float32 (confirmé : x=640.0, y=720.0). Structure tolérante : on lit ce
        // qu'on peut, on garde le reste en raw.
        const mode = r.readUint16();
        const imgId = r.readUint16();
        const out = { op, mode, imgId, kind: mode === 0 ? "background" : "sprite" };
        if (mode !== 0) {
          if (r.canRead(2)) out.var1 = r.readUint16();
          if (r.canRead(8)) {
            out.x = r.readFloat32();
            out.y = r.readFloat32();
          }
        }
        if (r.remaining() > 0) out.tail = [...r.readBytes(r.remaining())];
        return out;
      }

      case "DRAW":
      case "DISP": {
        // Non documenté finement par LuckSystem (dump uint16). On expose le 1er
        // u16 (souvent une couche/slot) + le reste.
        const slot = r.canRead(2) ? r.readUint16() : null;
        const out = { op, slot, u16: dumpU16(code.paramBytes) };
        return out;
      }

      default:
        return {
          op,
          raw: [...code.paramBytes],
          u16: dumpU16(code.paramBytes)
        };
    }
  } catch (error) {
    return {
      op,
      parseError: error.message,
      raw: [...code.paramBytes],
      u16: dumpU16(code.paramBytes)
    };
  }
}

function dumpU16(bytes) {
  const out = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    out.push(bytes[i] | (bytes[i + 1] << 8));
  }
  return out;
}

function readCStringUTF8BestEffort(r) {
  const start = r.offset;
  while (r.canRead(1) && r.bytes[r.offset] !== 0x00) {
    r.offset++;
  }

  const bytes = r.bytes.slice(start, r.offset);
  if (r.canRead(1)) r.offset++;

  return new TextDecoder("utf-8").decode(bytes);
}
