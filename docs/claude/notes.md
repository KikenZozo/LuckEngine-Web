# Notes reverse engineering

## PAK (src/pak/PakReader.js ← docs/reverse/pak.go)

Header (little-endian, 9 × uint32) :

```txt
0  HeaderLength   8  IDStart     16 Unk2  24 Unk4   32 Flags
4  FileCount      12 BlockSize   20 Unk3  28 Unk5
```

- Table d'entrées : scanner depuis l'offset 32, pas de 4, jusqu'au 1er
  `uint32 == HeaderLength / BlockSize`.
- Entrée = `{ Offset(u32, en blocs), Length(u32) }` ; octets = `Offset*BlockSize`.
- ID d'entrée = `IDStart + index`.
- Noms (si `Flags & 512`) : `uint32` en `(tableOffset-4)` → liste de chaînes
  null-terminées, une par entrée.

## Script CodeLine (src/script/AIRParser.js ← docs/reverse/script.go)

```txt
Len(u16) Opcode(u8) FixedFlag(u8) RawBytes[Len-4] Align[Len&1]
Pos += (Len + 1) & ~1
```

FixedFlag : 0 → ParamBytes = RawBytes ; 1 → strip 1×u16 ; ≥2 → strip 2×u16.

Chaînes (inverse de CodeString) :
- UTF-16LE : préfixe = nb code units ; corps ; `00 00`.
- UTF-8    : préfixe = `0x10000 − nbOctets` ; corps ; `00`.

## Pipeline

```txt
SCRIPT.PAK → PakReader → entry N → parseScript → CodeLine[]
           → parseAIRInstruction → Instruction[] → AIRVM → CanvasRenderer
```

## État

- ✅ PakReader vérifié (selftest, PAK synthétique avec/sans noms)
- ✅ CodeLine + MESSAGE/SELECT/IFN/IFY/GOTO/JUMP/FARCALL/ONGOTO/GOSUB/
     VARSTR_SET/LOG_BEGIN/DIALOG/MOVIE décodés et testés
- ✅ AIRVM : sauts, GOSUB/RETURN, END non terminal, conditions = fall-through
     si non évaluables (exprEvaluator injectable)
- ⏳ IMAGELOAD/DRAW/FADE/BGM/VOICE : à décoder (besoin des défs AIR.py)
- ⏳ évaluateur d'expressions LuckSystem : non fourni

## Validé sur dump réel (AIR FR)

- Décalage opcode = 0 (MESSAGE=36, SELECT=40, FADE=62...) — 56 CodeLine OK.
- MESSAGE : jp UTF-16 / en UTF-8 (len négative) / zh UTF-16 ; ~5 o de tail.
- SELECT : choix séparés par "$d" ; 1er uint16 = variable (#varId) relue par IFN.
- IFN/IFY : expr type "(#6001==0)" / "(#47!=1)" + jump uint32 (Pos).
