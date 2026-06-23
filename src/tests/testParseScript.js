import fs from "fs";
import { parseScript } from "../script/AIRParser.js";

const path = process.argv[2] ?? "./scripts/8.bin";

const file = fs.readFileSync(path);
const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);

console.log("Loaded:", path);
console.log("Bytes:", file.length);

const codes = parseScript(buffer);

console.log("Instructions:", codes.length);

for (const c of codes.slice(0, 50)) {
  console.log({
    index: c.index,
    pos: c.pos,
    len: c.len,
    opcode: c.opcode,
    op: c.op,
    fixedFlag: c.fixedFlag,
    fixedParam: c.fixedParam,
    instruction: c.instruction
  });
}
