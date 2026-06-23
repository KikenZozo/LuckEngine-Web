# LuckEngine-Web

Implémentation JavaScript/Web du moteur **LuckSystem / LuckEngine** pour AIR.
Aucun `.exe`, aucun Wine, aucune VM, aucun émulateur : le navigateur exécute
directement les ressources du jeu.

```txt
SCRIPT.PAK → PakReader → CodeLine[] → AIRParser → Instruction[] → AIRVM → CanvasRenderer
```

## État actuel

Le moteur joue AIR dans le navigateur : décors, personnages, CG événementiels,
dialogues multilingues (jp / fr / zh), choix, et amorce audio.

**Rendu**
- Décors **BGCG** : base plein cadre + **expressions liées par numéro de famille**
  (ex. `bg098b` ne s'affiche que sur `bg098`), variantes jour/nuit/soir.
- **EVENTCG** : base + **expressions empilées et positionnées** par leur offset CZ
  (distinction base/expression par la taille, robuste aux nommages `a/b/c` comme
  numérotés `02/03/04`). Pas de sprites de personnage par-dessus un CG.
- **Personnages** : base + couches d'expression composées dans l'ordre d'arrivée.
- Décodeur **CZ** (CZ0/1/3/4 + LZW) avec edge-bleed anti-fringe.

**Logique**
- VM avec sauts (`JUMP`/`FARCALL`/`GOSUB`…), continuité des variables/sprites
  entre `seen`.
- Opcode **`EQUN`** exécuté → les conditions `IFN/IFY` s'évaluent réellement
  (fini le contenu optionnel qui s'affichait partout).
- Évaluateur d'expressions porté de LuckSystem (`#NNNN`, opérateurs).

**Audio** (fonctionnel)
- **Voix** : l'id voix est porté par le `unk` du `MESSAGE` (= id direct d'entrée
  `voice.PAK`/`voice1.PAK`). Narration (`unk=0`) → pas de voix.
- **SE** : id-script `(u16 >> 8) - 65` → index dans `SE.PAK`. Le 3ᵉ argument `512`
  marque les SE d'**ambiance** (cigales/vent/pluie) joués **en boucle** sur un canal
  dédié, coupés par `SE(255)` ; les SE ponctuels ne coupent pas l'ambiance.
- **BGM** : id-script `(u16 & 0xFF) - 161` → index dans `MUSIC.PAK`.
- Décodage Web Audio (OGG/WAV natifs), résolution stricte par type.

**Vidéo**
- Opcode `MOVIE` (`AIR_OP_A`/`AIR_OP_B`) joué plein écran via `<video>`, avec
  **variante de langue** (`_EN`/`_ZC`) et skip (clic/Échap). Import auto des
  `.webm`/`.mp4`/`.ogv` (y compris dans les sous-dossiers, ex `AIR/movie/`).

**Interface (vraies images d'AIR)**
- **Fenêtre de dialogue** `MWIN0` et **choix** `SELWIN`/`SELWIN_s` (PARTS.PAK),
  texte calé sur la zone interne réelle de chaque image.
- **Médaillon de date** (`jul_`/`aug_`) en haut à gauche, masqué sur les EVENTCG.
- **Écran titre** (`title1a`) avec boutons NEW GAME / LOAD / OPTIONS / MANUAL / EXIT.
- **Auto / Skip / Voice** : avance auto temporisée, avance rapide, rejeu de la voix.

**Démarrage** : façon jeu original — le jeu commence sur `seen163` (le tout début),
s'enchaîne par `JUMP`, et seuls les **choix** (`SELECT`) font bifurquer les routes.
Le menu ☰ Chapitres reste accessible pour le debug.

**Touches de debug** (en jeu) : `L` couches, `S` lissage, `P` export PNG natif,
`O` masquer les compléments de décor, `A` auto, `Ctrl` skip, `V` rejouer la voix.

## Légal

Ce dépôt ne contient **aucune ressource du jeu** — ni script, ni image, ni audio.
C'est une **réimplémentation du moteur** uniquement. Pour jouer, il faut **posséder
le jeu** et importer **ses propres fichiers** (`SCRIPT.PAK`, `*CG.PAK`, `voice.PAK`…),
qui restent en local (IndexedDB du navigateur) et ne sont jamais envoyés nulle part.
AIR est © **Key / VisualArts**. Ce projet n'est ni affilié ni approuvé par eux.

## Crédits

Reverse-engineering et portage basés sur **LuckSystem**
(https://github.com/wetor/LuckSystem) : décodeur CZ (`czimage/`), évaluateur
d'expressions (`expr/`), sémantique des opcodes (`operator/`), format PAK et
script. Les fichiers de référence sont dans `docs/reverse/`.

## Démarrer

```bash
npm test          # test de bout en bout (synthétique, ne nécessite AUCUN fichier de jeu)
```

Puis, pour jouer tes propres scripts dans le navigateur :

```bash
# sers le dossier en HTTP (modules ES) puis ouvre http://localhost:8080
python3 -m http.server 8080
```

Dans la page : choisis `SCRIPT.PAK`, sélectionne une entrée, clique « Lire »,
clique le canvas pour avancer.

## Workflow Node (avec tes fichiers de jeu)

Place tes fichiers dans `game/AIR/` (au minimum `SCRIPT.PAK`), puis :

```bash
npm run inspect:pak        # liste les entrées du PAK
npm run extract:script8    # extrait l'entrée 8 -> scripts/8.bin
npm run parse:script8      # parse + décode scripts/8.bin
```

## Architecture

```txt
LuckEngine-Web/
├── index.html                  démo navigateur (charge un PAK, joue les dialogues)
├── package.json
├── docs/
│   ├── reverse/                SOURCES de référence : pak.go, script.go, vm.go, AIR.py, AIR.txt
│   └── claude/                 notes + prompt de travail
├── game/AIR/                   (tes .PAK ici — non versionnés)
├── scripts/                    (.bin extraits)
└── src/
    ├── pak/PakReader.js          conteneur .PAK            (← pak.go)
    ├── script/
    │   ├── OpcodeTable.js        opcode → nom              (← AIR.txt)
    │   ├── ScriptBinaryReader.js curseur LE + chaînes      (← CodeString, script.go)
    │   └── AIRParser.js          CodeLine[] + décodage     (← script.go + AIR.py)
    ├── vm/
    │   ├── AIRVM.js              exécution + sauts         (← vm.go)
    │   └── ExprEval.js           évaluateur d'expressions heuristique (#NNNN, ==, !=, &&...)
    ├── render/CanvasRenderer.js  boîte de dialogue + choix
    ├── app/Game.js               colle PAK→VM→rendu (choix branchés via ExprEval)
    ├── audio/AudioManager.js     squelette (BGM/SE/VOICE)
    ├── save/SaveManager.js       sauvegardes (localStorage / mémoire)
    └── tests/
        ├── selftest.js           ✅ test synthétique bout-en-bout (npm test)
        ├── inspectPak.js         inspecte un vrai PAK
        ├── extractScriptEntry.js extrait une entrée
        └── testParseScript.js    parse une entrée extraite
```

## Format (justifications, sources dans docs/reverse/)

- **PAK** : header 9×u32 ; table d'entrées localisée en scannant depuis
  l'offset 32 le 1er u32 égal à `HeaderLength/BlockSize` ; `Offset` est en
  **blocs** (×`BlockSize`) ; noms optionnels si `Flags & 512`. (`pak.go`)
- **CodeLine** : `Len`(u16) `Opcode`(u8) `FixedFlag`(u8) `RawBytes`(Len−4) +
  1 octet de padding si `Len` impair. `Pos` = offset cumulé arrondi au pair
  supérieur. `FixedFlag` retire 0/1/2 `uint16` en tête → `ParamBytes`. (`script.go`)
- **Chaînes** : UTF-16LE (`core.text`, préfixe = nb de code units, terminateur
  `00 00`) ; UTF-8 (`core.expr`, préfixe = `0x10000 − nbOctets` = **négatif**,
  terminateur `00`). (`CodeString`, `script.go`)
- **Sauts** : `uint32` = `Pos` cible. **END n'est pas terminal.** (`vm.go`)

## Vérifié sur données réelles (dump AIR FR)

Un hexdump d'un vrai `SCRIPT.PAK` (AIR, patch FR) a validé le format : **56
CodeLine consécutives** décodées d'une seule phase, tous les opcodes résolus.

1. ✅ **Décalage opcode = 0** : `MESSAGE`=36, `SELECT`=40, `FADE`=62, etc.
   confirmés sur 12 opcodes distincts.
2. ✅ **MESSAGE** : `jp` UTF-16, `en` UTF-8 (longueur négative), `zh` UTF-16.
   Le slot `en` contient la traduction (FR ici). ~5 octets de queue conservés
   dans `tail`.
3. ✅ **SELECT** : un seul champ texte, **choix séparés par `$d`** ; le 1er
   uint16 (`varId`, ex. 6001) est la variable écrite par le choix, relue par les
   `IFN (#6001==…)` suivants.

## Reste à faire

- Décoder les params de `IMAGELOAD`, `DRAW`, `FADE`, `INIT`, `HAIKEI_SET`
  (présents dans le script ; actuellement en `default`/`debug`). Nécessite leurs
  définitions AIR.py pour afficher images/transitions.
- `ExprEval.js` couvre les expressions courantes (`#NNNN`, `==`, `!=`, `<`, `>`,
  `&&`, `||`) ; le sous-VM d'expressions complet de LuckSystem reste à porter
  pour les cas arithmétiques avancés.

## Apport du dépôt de référence LuckSystem

- `game/expr/{expr.go,utils.go}` → **porté fidèlement** dans `src/vm/ExprEval.js`
  (évaluateur par pile, priorités, `&& || == != + - * / % & | ^ << >>`).
  Remplace l'ancien évaluateur heuristique. Les variables sont les jetons
  `#NNNN` ; un `SELECT` écrit `#varId`, les `IFN/IFY/ONGOTO` le relisent.
- `game/operator/LB_EN.go` → sémantique des opcodes confirmée :
  `MESSAGE`(1er u16 = voiceId), `SELECT`(1er u16 = variable du choix),
  `IMAGELOAD`(mode 0 = fond / sinon sprite, imgID, position).
- `IMAGELOAD` décode maintenant `{mode, imgId, kind, var1, x, y}` (position
  float32 sur AIR), vérifié sur données réelles.

### Reste pour AFFICHER les images
1. Le décodeur **CZ** (le dépôt fournit `czimage/` en Go : cz0/1/3/4 + lzw) —
   soit ton portage JS existant, soit on porte `czimage/` en JS.
2. Le mapping **imgId → entrée BGCG.PAK** (liste via `inspectPak.js BGCG.PAK`).
Avec ces deux éléments : `IMAGELOAD#imgId → entrée BGCG → CZ → RGBA → canvas`.

## Décodeur d'images CZ (porté de czimage/)

`src/image/czimage.js` : portage JS du décodeur CZ de LuckSystem.
- **CZ0** (RGBA brut), **CZ1** (palette 4/8 bits, RGB 24, RGBA 32),
  **CZ3** (`LineDiff` delta par ligne), **CZ4** (`LineDiff4`, RGB+Alpha séparés).
- LZW + table de blocs portés à l'identique de `lzw.go`/`util.go`.
- CZ2 (polices, LZW bit-packé) : à ajouter plus tard.
- `decodeCZ(bytes)` → `{ width, height, rgba: Uint8ClampedArray }`.

Pipeline image complet :
```
IMAGELOAD #imgId (mode 0 = fond)
   → BGCG.PAK getEntryById/getEntry → decodeCZ → ImageData → canvas
```
Le joueur dépose `SCRIPT.PAK` **et** `BGCG.PAK` (import 1re fois, persistés en
IndexedDB). `Game` charge le fond au `IMAGELOAD`, `DRAW` repeint la scène, puis
le dialogue se dessine par-dessus.

> À valider sur ton `BGCG.PAK` réel : le sens exact de `imgId` (id d'entrée vs
> index) — `Game._imageBytes` essaie les deux et ne garde que ce qui est un CZ
> valide. Colle la sortie de `inspectPak.js BGCG.PAK` pour verrouiller le mapping.
