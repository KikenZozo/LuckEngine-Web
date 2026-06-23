// ============================================================================
// LuckEngine-Web — src/image/czimage.js
// ----------------------------------------------------------------------------
// PORTAGE JS du décodeur CZ de LuckSystem (czimage/*.go). Décode CZ0/CZ1/CZ3/CZ4
// vers RGBA (Uint8ClampedArray) prêt pour ImageData/canvas.
// CZ2 (polices, LZW bit-packé) sera ajouté plus tard.
//
// Sources : cz.go (header), util.go (GetOutputInfo/Decompress), lzw.go
// (decompressLZW), imagefix.go (LineDiff/LineDiff4), cz0/1/3/4.go.
// ============================================================================

// En-tête CZ commun (15 octets).
function parseHeader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    magic: String.fromCharCode(bytes[0], bytes[1], bytes[2]), // "CZ0".."CZ4"
    headerLength: dv.getUint32(4, true),
    width: dv.getUint16(8, true),
    height: dv.getUint16(10, true),
    colorbits: dv.getUint16(12, true),
    colorblock: bytes[14],
  };
}

// Table de blocs : FileCount(u32) + [compressedSize(u32), rawSize(u32)] * FileCount
function getOutputInfo(bytes, at) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fileCount = dv.getUint32(at, true);
  const blocks = [];
  let o = at + 4;
  for (let i = 0; i < fileCount; i++) {
    blocks.push({
      compressedSize: dv.getUint32(o, true), // nombre de codes uint16
      rawSize: dv.getUint32(o + 4, true),
    });
    o += 8;
  }
  return { fileCount, blocks, offset: 4 + fileCount * 8 };
}

// LZW (codes 16 bits). Porté à l'identique de decompressLZW (lzw.go).
function decompressLZW(codes, rawSize) {
  const dict = new Array(256);
  for (let i = 0; i < 256; i++) dict[i] = [i];
  let dictCount = 256;
  let w = dict[codes[0]].slice();
  const out = rawSize ? new Uint8Array(rawSize) : [];
  let p = 0;
  const push = (arr) => {
    if (rawSize) { out.set(arr, p); p += arr.length; }
    else for (const b of arr) out.push(b);
  };
  for (let k = 0; k < codes.length; k++) {
    const el = codes[k];
    let entry;
    if (dict[el] !== undefined) entry = dict[el].slice();
    else if (el === dictCount) entry = w.concat(w[0]);
    else throw new Error(`LZW: code invalide ${el}`);
    push(entry);
    dict[dictCount++] = w.concat(entry[0]);
    w = entry;
  }
  return rawSize ? out : Uint8Array.from(out);
}

// Décompresse tous les blocs (codes uint16 LE) en un buffer brut.
function decompress(bytes, start, outputInfo) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts = [];
  let off = start;
  let total = 0;
  for (const block of outputInfo.blocks) {
    const codes = new Uint16Array(block.compressedSize);
    for (let j = 0; j < block.compressedSize; j++) {
      codes[j] = dv.getUint16(off, true);
      off += 2;
    }
    const raw = decompressLZW(codes, block.rawSize);
    parts.push(raw);
    total += raw.length;
  }
  const buf = new Uint8Array(total);
  let p = 0;
  for (const part of parts) { buf.set(part, p); p += part.length; }
  return buf;
}

// LineDiff (CZ3) : delta par ligne, blockHeight = (height+2)/3.
function lineDiff(header, data) {
  const { width, height, colorbits } = header;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const blockHeight = Math.floor((height + 2) / 3);
  const pbc = colorbits >> 3; // octets par pixel (3 ou 4)
  const lineBytes = width * pbc;
  const prev = new Uint8Array(lineBytes);
  let i = 0;
  for (let y = 0; y < height; y++) {
    const curr = data.slice(i, i + lineBytes);
    if (y % blockHeight !== 0) {
      for (let x = 0; x < lineBytes; x++) curr[x] = (curr[x] + prev[x]) & 0xff;
    }
    prev.set(curr);
    const row = y * width * 4;
    if (pbc === 4) {
      rgba.set(curr, row);
    } else { // 24 bits -> RGB + alpha plein
      for (let x = 0; x < width; x++) {
        rgba[row + x * 4] = curr[x * 3];
        rgba[row + x * 4 + 1] = curr[x * 3 + 1];
        rgba[row + x * 4 + 2] = curr[x * 3 + 2];
        rgba[row + x * 4 + 3] = 0xff;
      }
    }
    i += lineBytes;
  }
  return rgba;
}

// LineDiff4 (CZ4) : [RGB w*h*3][Alpha w*h], chaque section en delta par ligne.
function lineDiff4(header, data) {
  const { width, height } = header;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const blockHeight = Math.floor((height + 2) / 3);
  const rgbSize = width * height * 3;
  const prevRGB = new Uint8Array(width * 3);
  const prevA = new Uint8Array(width);
  let rgbOff = 0;
  let aOff = rgbSize;
  for (let y = 0; y < height; y++) {
    const curRGB = data.slice(rgbOff, rgbOff + width * 3);
    const curA = data.slice(aOff, aOff + width);
    if (y % blockHeight !== 0) {
      for (let x = 0; x < width * 3; x++) curRGB[x] = (curRGB[x] + prevRGB[x]) & 0xff;
      for (let x = 0; x < width; x++) curA[x] = (curA[x] + prevA[x]) & 0xff;
    }
    prevRGB.set(curRGB);
    prevA.set(curA);
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      rgba[row + x * 4] = curRGB[x * 3];
      rgba[row + x * 4 + 1] = curRGB[x * 3 + 1];
      rgba[row + x * 4 + 2] = curRGB[x * 3 + 2];
      rgba[row + x * 4 + 3] = curA[x];
    }
    rgbOff += width * 3;
    aOff += width;
  }
  return rgba;
}

/**
 * Décode un buffer CZ en image RGBA.
 * @param {Uint8Array|ArrayBuffer} input
 * @returns {{width:number,height:number,rgba:Uint8ClampedArray,format:string}|null}
 */
export function decodeCZ(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 15 || bytes[0] !== 0x43 || bytes[1] !== 0x5a) return null; // "CZ"
  const h = parseHeader(bytes);
  const { width, height, headerLength } = h;
  const rgba = new Uint8ClampedArray(width * height * 4);

  if (h.magic === "CZ0") {
    // RGBA brut non compressé à partir de headerLength (colorbits 32)
    let o = headerLength;
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = bytes[o]; rgba[i * 4 + 1] = bytes[o + 1];
      rgba[i * 4 + 2] = bytes[o + 2]; rgba[i * 4 + 3] = bytes[o + 3];
      o += 4;
    }
    bleedEdges(rgba, width, height);
    return { width, height, rgba, format: "CZ0" };
  }

  if (h.magic === "CZ1") {
    let colorbits = h.colorbits > 32 ? 8 : h.colorbits;
    let palOff = headerLength;
    let palette = null;
    if (colorbits === 4 || colorbits === 8) {
      const n = 1 << colorbits;
      palette = new Array(n);
      for (let i = 0; i < n; i++) {
        // fichier en BGRA -> RGBA
        palette[i] = [bytes[palOff + 2], bytes[palOff + 1], bytes[palOff], bytes[palOff + 3]];
        palOff += 4;
      }
    }
    const info = getOutputInfo(bytes, palOff);
    const buf = decompress(bytes, palOff + info.offset, info);
    if (colorbits === 8) {
      for (let i = 0; i < width * height; i++) {
        const c = palette[buf[i]];
        rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = c[3];
      }
    } else if (colorbits === 4) {
      for (let i = 0; i < width * height; i++) {
        const idx = i % 2 === 0 ? buf[i >> 1] & 0x0f : (buf[i >> 1] & 0xf0) >> 4;
        const c = palette[idx];
        rgba[i * 4] = c[0]; rgba[i * 4 + 1] = c[1]; rgba[i * 4 + 2] = c[2]; rgba[i * 4 + 3] = c[3];
      }
    } else if (colorbits === 24) {
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = buf[i * 3]; rgba[i * 4 + 1] = buf[i * 3 + 1];
        rgba[i * 4 + 2] = buf[i * 3 + 2]; rgba[i * 4 + 3] = 0xff;
      }
    } else { // 32
      rgba.set(buf.subarray(0, width * height * 4));
    }
    bleedEdges(rgba, width, height);
    return { width, height, rgba, format: "CZ1" };
  }

  if (h.magic === "CZ3" || h.magic === "CZ4") {
    const info = getOutputInfo(bytes, headerLength);
    const buf = decompress(bytes, headerLength + info.offset, info);
    const out = h.magic === "CZ4" ? lineDiff4(h, buf) : lineDiff(h, buf);
    bleedEdges(out, width, height);
    const ext = readExtHeader(bytes, headerLength);
    return { width, height, rgba: out, format: h.magic, ...ext };
  }

  return null; // CZ2 ou inconnu
}

// En-tête étendu (Flag u8, X u16, Y u16, W1 u16, H1 u16, W2 u16, H2 u16) à
// l'offset 15 pour CZ0/CZ3/CZ4. X,Y = position du sprite ; W2,H2 = canvas plein.
function readExtHeader(bytes, headerLength) {
  if (headerLength < 28) return { offsetX: 0, offsetY: 0, canvasW: 0, canvasH: 0 };
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    offsetX: dv.getUint16(16, true),
    offsetY: dv.getUint16(18, true),
    canvasW: dv.getUint16(24, true),
    canvasH: dv.getUint16(26, true),
  };
}

/**
 * Edge-bleed : propage le RGB des pixels opaques vers les pixels transparents
 * voisins, SANS modifier l'alpha. Empêche le RGB parasite (laissé sous les zones
 * transparentes) de baver sur les bords lors de la composition/mise à l'échelle
 * (matte fringe). S'auto-désactive sur une image entièrement opaque ou entièrement
 * transparente. Mute rgba en place et le renvoie.
 */
function bleedEdges(rgba, w, h, iters = 4) {
  const A = 16; // seuil "opaque" : sert de source de couleur
  const srcA = new Uint8Array(w * h);
  let hasTrans = false, hasOpaque = false;
  for (let p = 0; p < w * h; p++) {
    const a = rgba[p * 4 + 3];
    srcA[p] = a;
    if (a >= A) hasOpaque = true; else hasTrans = true;
  }
  if (!hasTrans || !hasOpaque) return rgba; // rien à corriger
  for (let it = 0; it < iters; it++) {
    const fills = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (srcA[p] >= A) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const q = ny * w + nx;
            if (srcA[q] >= A) { const j = q * 4; r += rgba[j]; g += rgba[j + 1]; b += rgba[j + 2]; c++; }
          }
        }
        if (c > 0) fills.push(p, (r / c) | 0, (g / c) | 0, (b / c) | 0);
      }
    }
    if (!fills.length) break;
    for (let k = 0; k < fills.length; k += 4) {
      const p = fills[k], i = p * 4;
      rgba[i] = fills[k + 1]; rgba[i + 1] = fills[k + 2]; rgba[i + 2] = fills[k + 3];
      srcA[p] = A; // devient source pour l'itération suivante (propagation), alpha réel inchangé
    }
  }
  return rgba;
}

// Exposé pour les tests
export const _internals = { decompressLZW, lineDiff4, lineDiff, getOutputInfo, parseHeader, bleedEdges };
