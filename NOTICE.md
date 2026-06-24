# Notices and third-party attribution

LuckEngine-Web is an independent JavaScript/Web runtime implementation for LuckSystem / LucaSystem style visual novel resources.

## Project code

LuckEngine-Web original code and documentation are licensed under the MIT License.

```txt
Copyright (c) 2026 Enzo Bouarab and LuckEngine-Web contributors
```

## LuckSystem attribution

This project studies, ports, adapts, or references parts of the public LuckSystem project.

```txt
LuckSystem
https://github.com/wetor/LuckSystem
Copyright (c) 2026 WéΤοr
MIT License
```

Known reference/adaptation map:

```txt
LuckSystem pak/pak.go                 -> src/pak/PakReader.js
LuckSystem script/script.go           -> src/script/AIRParser.js, src/script/ScriptBinaryReader.js
LuckSystem game/expr/expr.go          -> src/vm/ExprEval.js
LuckSystem game/expr/utils.go         -> src/vm/ExprEval.js
LuckSystem czimage/*.go               -> src/image/czimage.js
LuckSystem game/operator/*.go         -> opcode semantics and VM behavior notes
LuckSystem data/AIR.py, AIR.txt       -> AIR opcode names and parameter notes
```

The files kept under `docs/reverse/` are reference material used to understand and document the formats. If a file is copied or substantially adapted from LuckSystem, it remains under the upstream MIT license and copyright notice.

## LuckSystem-2.3.2-Yoremi-Update attribution

The Yoremi fork was also used as a practical reference for AIR workflows, fixes, GUI behavior, format support notes, and documentation.

```txt
LuckSystem-2.3.2-Yoremi-Update
https://github.com/yoremi-trad-fr/LuckSystem-2.3.2-Yoremi-Update
Fork of LuckSystem with additional fixes and tooling
```

## Game rights

LuckEngine-Web does not include, license, or redistribute any game content.

AIR and all related commercial assets, including scripts, images, audio, video, fonts, characters, logos, titles, and trademarks, belong to their respective rights holders, including Key / VisualArts depending on the edition.

Users must provide their own legally obtained game files. Those files are not part of the MIT-licensed project.

## AI assistance disclosure

Some implementation, debugging, and documentation work may have been assisted by AI tools. This does not change the attribution requirements for upstream open-source projects or commercial game rights holders.
