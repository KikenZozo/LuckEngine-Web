import fs from "fs";
import { PakReader } from "../pak/PakReader.js";

const index = Number(process.argv[2] ?? 8);
const pakPath = process.argv[3] ?? "./game/AIR/SCRIPT.PAK";
const outPath = process.argv[4] ?? `./scripts/${index}.bin`;

const file = fs.readFileSync(pakPath);
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

const pak = new PakReader(buffer);
const entry = pak.getEntry(index);

fs.mkdirSync("./scripts", { recursive: true });
fs.writeFileSync(outPath, entry);

console.log(`Extracted entry ${index}`);
console.log(`Size: ${entry.length} bytes`);
console.log(`Output: ${outPath}`);
