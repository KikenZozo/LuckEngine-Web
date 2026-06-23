import fs from "fs";
import { PakReader } from "../pak/PakReader.js";

const pakPath = process.argv[2] ?? "./game/AIR/SCRIPT.PAK";

const file = fs.readFileSync(pakPath);
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

const pak = new PakReader(buffer);

console.log("Header:", pak.header);
console.log("Entries:", pak.entries.length);
console.table(pak.listEntries().slice(0, 20));
