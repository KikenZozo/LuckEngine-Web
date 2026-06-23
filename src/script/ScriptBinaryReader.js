export class ScriptBinaryReader {
  constructor(bufferOrBytes) {
    if (bufferOrBytes instanceof Uint8Array) {
      this.bytes = bufferOrBytes;
      this.buffer = bufferOrBytes.buffer.slice(
        bufferOrBytes.byteOffset,
        bufferOrBytes.byteOffset + bufferOrBytes.byteLength
      );
    } else {
      this.buffer = bufferOrBytes;
      this.bytes = new Uint8Array(bufferOrBytes);
    }

    this.view = new DataView(this.buffer);
    this.offset = 0;
  }

  remaining() {
    return this.bytes.length - this.offset;
  }

  canRead(n = 1) {
    return this.offset + n <= this.bytes.length;
  }

  readUint8() {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  readUint16() {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  readUint32() {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readFloat32() {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  readBytes(length) {
    this.ensure(length);
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  readLenStringUTF16LE() {
    const charCount = this.readUint16();
    const bytes = this.readBytes(charCount * 2);

    const text = new TextDecoder("utf-16le").decode(bytes);

    // null terminator UTF-16
    if (this.canRead(2)) this.offset += 2;

    return text.replace(/\u0000+$/g, "");
  }

  readLenStringUTF8() {
    const lenRaw = this.readUint16();

    // LuckSystem CodeString écrit UTF-8 len comme 0x10000 - size.
    const byteLength = lenRaw > 0x8000 ? 0x10000 - lenRaw : lenRaw;

    const bytes = this.readBytes(byteLength);

    const text = new TextDecoder("utf-8").decode(bytes);

    // null terminator UTF-8
    if (this.canRead(1)) this.offset += 1;

    return text.replace(/\u0000+$/g, "");
  }

  ensure(n) {
    if (!this.canRead(n)) {
      throw new Error(`Read overflow at offset=${this.offset}, need=${n}, remaining=${this.remaining()}`);
    }
  }
}
