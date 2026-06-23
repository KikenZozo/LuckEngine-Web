// ============================================================================
// LuckEngine-Web — src/pak/PakReader.js
// ----------------------------------------------------------------------------
// Lecteur de conteneur .PAK, dérivé de docs/reverse/pak.go (fonction open()).
//
// FORMAT (little-endian) :
//   Header (9 x uint32 = 36 octets) :
//     0  HeaderLength   taille de la zone d'en-tête (multiple de BlockSize)
//     4  FileCount
//     8  IDStart
//     12 BlockSize
//     16 Unk2 .. 28 Unk5
//     32 Flags          bit 512 => entrées nommées
//
//   Table des entrées : pak.go la localise en SCANNANT à partir de l'offset 32,
//   par pas de 4 octets, le premier uint32 égal à HeaderLength / BlockSize
//   (= l'Offset en blocs de la 1re entrée, dont les données commencent juste
//   après l'en-tête). C'est exactement ce qu'on reproduit ici.
//
//   Chaque entrée = { Offset uint32 (en BLOCS), Length uint32 }.
//   Offset en octets = Offset * BlockSize.  (pak.go : file.Offset *= BlockSize)
//
//   Noms (si Flags & 512) : un uint32 situé en (tableOffset - 4) pointe (dans
//   la zone d'en-tête) vers une liste de chaînes null-terminées, une par
//   entrée, dans l'ordre. (pak.go, branche `named`.)
// ============================================================================

export class PakReader {
  /** @param {ArrayBuffer} buffer contenu complet du .PAK */
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.bytes = new Uint8Array(buffer);

    this.header = this.readHeader();
    this.tableOffset = this.findEntryTableOffset();
    this.entries = this.readEntries();

    this.nameMap = new Map(); // name -> index
    this.idMap = new Map(); // id   -> index
    for (const e of this.entries) {
      this.nameMap.set(e.name, e.index);
      this.idMap.set(e.id, e.index);
    }
  }

  u32(offset) {
    return this.view.getUint32(offset, true);
  }

  readHeader() {
    return {
      headerLength: this.u32(0),
      fileCount: this.u32(4),
      idStart: this.u32(8),
      blockSize: this.u32(12),
      unk2: this.u32(16),
      unk3: this.u32(20),
      unk4: this.u32(24),
      unk5: this.u32(28),
      flags: this.u32(32),
    };
  }

  findEntryTableOffset() {
    const { headerLength, blockSize } = this.header;
    if (blockSize === 0) throw new Error("PAK invalide: BlockSize = 0");
    const target = headerLength / blockSize; // Offset (en blocs) de la 1re entrée

    // Scan depuis l'offset 32, par pas de 4 (cf. pak.go open()).
    for (let off = 32; off + 4 <= headerLength; off += 4) {
      if (this.u32(off) === target) return off;
    }
    throw new Error(
      `Table d'entrées introuvable (target=${target}, ` +
        `headerLength=${headerLength}, blockSize=${blockSize})`
    );
  }

  readEntries() {
    const { fileCount, idStart, blockSize, flags } = this.header;
    const entries = [];

    for (let i = 0; i < fileCount; i++) {
      const off = this.tableOffset + i * 8;
      const blockIndex = this.u32(off);
      const length = this.u32(off + 4);
      entries.push({
        index: i,
        id: idStart + i,
        blockIndex,
        length,
        offset: blockIndex * blockSize, // octets
        name: String(i),
      });
    }

    // Entrées nommées (Flags & 512)
    if ((flags & 512) !== 0) {
      let nameOff = this.u32(this.tableOffset - 4);
      const dec = new TextDecoder("utf-8");
      for (const e of entries) {
        let end = nameOff;
        while (end < this.bytes.length && this.bytes[end] !== 0x00) end++;
        e.name = dec.decode(this.bytes.subarray(nameOff, end));
        nameOff = end + 1;
      }
    }

    return entries;
  }

  /** @returns {Uint8Array} octets bruts de l'entrée (copie). */
  getEntry(index) {
    const e = this.entries[index];
    if (!e) throw new Error(`Entrée ${index} introuvable`);
    return this.bytes.slice(e.offset, e.offset + e.length);
  }

  getEntryByName(name) {
    const idx = this.nameMap.get(name);
    if (idx === undefined) throw new Error(`Entrée nommée introuvable: ${name}`);
    return this.getEntry(idx);
  }

  getEntryById(id) {
    const idx = this.idMap.get(id);
    if (idx === undefined) throw new Error(`Entrée id introuvable: ${id}`);
    return this.getEntry(idx);
  }

  /** Premiers octets d'une entrée par id (vue, sans copie) — pour détecter un format. */
  headById(id, n = 16) {
    const idx = this.idMap.get(id);
    if (idx === undefined) return null;
    const e = this.entries[idx];
    return this.bytes.subarray(e.offset, e.offset + Math.min(n, e.length));
  }

  /** Nom d'entrée pour un id global (ou null). */
  nameById(id) {
    const idx = this.idMap.get(id);
    return idx === undefined ? null : this.entries[idx].name;
  }

  listEntries() {
    return this.entries.map((e) => ({
      index: e.index,
      id: e.id,
      name: e.name,
      offset: e.offset,
      blockIndex: e.blockIndex,
      length: e.length,
    }));
  }
}
