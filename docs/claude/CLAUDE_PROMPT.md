# Mission Claude : LuckEngine-Web

Tu es un ingénieur reverse engineering senior.

## Objectif

Aider à terminer le parser JavaScript du moteur LuckSystem / LuckEngine pour AIR.

## Fichiers importants

- `src/pak/PakReader.js`
- `src/script/ScriptBinaryReader.js`
- `src/script/AIRParser.js`
- `src/script/OpcodeTable.js`
- `docs/reverse/`

## Sources originales fournies

- `pak.go`
- `script.go`
- `vm.go` si disponible
- `AIR.py` si disponible
- `AIR.txt` si disponible

## Ce qui est confirmé

- BGCG.PAK / CZ4 / LZW / LineDiff4 fonctionne déjà dans un autre pipeline.
- La structure CodeLine vient de `script.go`.
- Le format PAK vient de `pak.go`.
- AIR.py est le vrai décodeur de ParamBytes.

## Ce qui reste à confirmer

1. Opcode base exact dans AIR Steam.
2. Type exact de `core.read()`.
3. Paramètres exacts de `IMAGELOAD`, `DRAW`, `FADE`, `BGM`, `VOICE`.
4. Décodage robuste de `SELECT`.

## Tâche

1. Vérifier `PakReader.js` contre `pak.go`.
2. Vérifier `AIRParser.js` contre `AIR.py`.
3. Proposer des corrections fichier par fichier.
4. Ajouter un mode hexdump par instruction.
5. Produire une VM capable d'afficher les dialogues AIR.
