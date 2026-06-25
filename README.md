# LuckEngine-Web

> Moteur JavaScript/Web expérimental pour faire tourner des visual novels **LuckSystem / LucaSystem / LuckEngine** directement dans le navigateur, à partir des fichiers originaux possédés par l'utilisateur.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Status](https://img.shields.io/badge/status-playable%20prototype-blue)
![Runtime](https://img.shields.io/badge/runtime-browser%20ES%20modules-green)

**LuckEngine-Web** est une réimplémentation web du runtime nécessaire à **AIR** et, à terme, aux autres jeux proches du moteur LuckSystem/LucaSystem. L'objectif est simple : remplacer l'exécutable Windows par un moteur moderne, portable et lisible, capable d'interpréter les ressources du jeu dans un navigateur.

Le projet ne contient **aucune ressource commerciale** : pas de scripts originaux, pas d'images, pas de voix, pas de musiques, pas de vidéos. Le joueur doit posséder le jeu et importer ses propres fichiers `.PAK` localement.

```txt
Fichiers du jeu possédés par l'utilisateur
        │
        ▼
SCRIPT.PAK / BGCG.PAK / CHARCG.PAK / EVENTCG.PAK / PARTS.PAK / voice.PAK / SE.PAK / MUSIC.PAK
        │
        ▼
PakReader ──► AIRParser ──► AIRVM ──► Game ──► CanvasRenderer + AudioManager
        │              │          │         │
        │              │          │         └── sauvegardes navigateur
        │              │          └── variables, choix, sauts, scènes
        │              └── CodeLine, opcodes, chaînes, expressions
        └── extraction d'entrées PAK / images CZ / audio brut
```

## État actuel

Le moteur est **jouable**, mais encore en phase de portage/reverse-engineering. Il permet déjà de lancer AIR dans le navigateur avec une grande partie du rendu, de la logique de script, des choix, de l'audio et de l'interface.

### Fonctionnel

- Lecture des conteneurs `.PAK` du jeu.
- Parsing des scripts `SCRIPT.PAK` en lignes de code interprétables.
- Exécution VM des opcodes importants : dialogues, choix, conditions, sauts, changement de `seen`, appels, variables.
- Décodage des images `CZ0`, `CZ1`, `CZ3`, `CZ4` avec LZW et reconstruction des deltas de lignes.
- Affichage canvas des décors, CG, sprites/personnages, fenêtres de dialogue et choix.
- Gestion des choix `SELECT` avec séparation `$d` et écriture de variable.
- Évaluation d'expressions `#NNNN`, opérateurs arithmétiques/logiques et conditions `IFN` / `IFY`.
- Audio navigateur : voix, SE ponctuels, SE d'ambiance bouclés, BGM.
- Vidéos d'introduction/cinématiques via `<video>` quand les fichiers sont fournis.
- Sauvegarde locale via le navigateur.
- Import des fichiers utilisateur sans upload serveur.
- Tests Node.js synthétiques pour valider les formats essentiels.

### Encore expérimental

- Certains opcodes graphiques avancés restent à affiner selon les scènes.
- Le mapping exact de toutes les images/personnages peut encore demander des corrections par cas réel.
- Le rendu vise la fidélité, mais n'est pas encore une reproduction parfaite de l'exécutable original.
- La compatibilité hors AIR dépendra du travail de mapping opcode/plugin pour les autres titres.

## Installation rapide

```bash
git clone https://github.com/TON-COMPTE/LuckEngine-Web.git
cd LuckEngine-Web
npm test
python3 -m http.server 8080
```

Ouvre ensuite :

```txt
http://localhost:8080
```

Le projet utilise des modules ES côté navigateur. Il faut donc le servir en HTTP, même en local. Ouvrir `index.html` directement en `file://` peut bloquer certains imports selon le navigateur.

## Utilisation avec tes fichiers de jeu

Le dépôt ne fournit pas les fichiers d'AIR. Pour jouer, importe ou place tes propres fichiers dans `game/AIR/` :

```txt
game/AIR/
├── SCRIPT.PAK      obligatoire pour les scripts
├── BGCG.PAK        décors
├── CHARCG.PAK      sprites/personnages
├── EVENTCG.PAK     CG événementiels
├── OTHCG.PAK       images diverses
├── SYSCG.PAK       UI système
├── SYSCG2.PAK      UI système additionnelle
├── PARTS.PAK       fenêtres, choix, éléments UI
├── voice.PAK       voix
├── voice1.PAK      voix additionnelles éventuelles
├── SE.PAK          effets sonores
└── MUSIC.PAK       musiques
```

Tu peux aussi déposer les fichiers directement dans l'interface web. Ils restent côté navigateur, dans le stockage local/IndexedDB, et ne sont pas envoyés à un serveur par LuckEngine-Web.

## Scripts utiles

```bash
npm test
```

Lance les tests synthétiques : lecture PAK, parsing script, `SELECT`, expressions, VM, changement de `seen`, décodeur CZ.

```bash
npm run inspect:pak
```

Inspecte `./game/AIR/SCRIPT.PAK` et liste ses entrées.

```bash
npm run extract:script8
```

Extrait l'entrée 8 du `SCRIPT.PAK` vers `scripts/8.bin`.

```bash
npm run parse:script8
```

Parse une entrée extraite pour vérifier les opcodes et chaînes.

```bash
npm run serve
```

Lance un serveur statique local sur le port `8080`.

## Architecture du dépôt

```txt
LuckEngine-Web/
├── index.html
├── package.json
├── LICENSE
├── NOTICE.md
├── README.md
├── game/
│   └── AIR/
│       └── PUT_AIR_FILES_HERE.txt
├── scripts/
│   ├── README.txt
│   └── UPDATE_GITHUB.md
├── docs/
│   ├── reverse/
│   │   ├── AIR.txt
│   │   ├── AIR.py
│   │   ├── pak.go
│   │   ├── script.go
│   │   └── vm.go
│   └── claude/
│       ├── CLAUDE_PROMPT.md
│       └── notes.md
└── src/
    ├── app/
    │   ├── boot.js
    │   ├── config.js
    │   ├── Game.js
    │   └── charcgKeys.js
    ├── assets/
    │   └── AssetStore.js
    ├── audio/
    │   └── AudioManager.js
    ├── image/
    │   └── czimage.js
    ├── pak/
    │   └── PakReader.js
    ├── render/
    │   └── CanvasRenderer.js
    ├── save/
    │   └── SaveManager.js
    ├── script/
    │   ├── AIRParser.js
    │   ├── OpcodeTable.js
    │   └── ScriptBinaryReader.js
    ├── tests/
    │   ├── extractScriptEntry.js
    │   ├── inspectPak.js
    │   ├── selftest.js
    │   └── testParseScript.js
    └── vm/
        ├── AIRVM.js
        └── ExprEval.js
```

## Comment le reverse-engineering a été fait

Le moteur a été construit en combinant trois sources de compréhension :

1. observation de données réelles extraites d'un jeu possédé légalement ;
2. comparaison avec les outils publics LuckSystem ;
3. réécriture progressive en JavaScript, validée par tests et par exécution dans le navigateur.

L'objectif n'est pas de redistribuer AIR ni de contourner la possession du jeu. Le projet documente et réimplémente un format de ressources pour permettre l'interopérabilité et la préservation côté navigateur.

### 1. Lecture des PAK

Les fichiers `.PAK` sont traités comme des conteneurs de ressources. Le lecteur `src/pak/PakReader.js` est dérivé de l'analyse du fichier `pak.go` de LuckSystem et des dumps réels.

Format utilisé par le moteur :

```txt
Header PAK, little-endian
0x00  uint32 HeaderLength
0x04  uint32 FileCount
0x08  uint32 IDStart
0x0C  uint32 BlockSize
0x10  uint32 Unknown2
0x14  uint32 Unknown3
0x18  uint32 Unknown4
0x1C  uint32 Unknown5
0x20  uint32 Flags
```

La table des entrées n'est pas supposée à un offset fixe. Elle est retrouvée par scan depuis l'offset `0x20`, en cherchant le premier `uint32` égal à :

```txt
HeaderLength / BlockSize
```

Chaque entrée contient ensuite :

```txt
uint32 OffsetInBlocks
uint32 LengthInBytes
```

L'offset réel est calculé ainsi :

```txt
OffsetInBytes = OffsetInBlocks * BlockSize
```

Si `Flags & 512` est actif, le PAK contient une table de noms. Dans ce cas, un pointeur situé juste avant la table d'entrées donne le début des noms null-terminés. Le moteur peut donc récupérer les ressources soit par index, soit par ID, soit par nom.

### 2. Décodage des scripts

Les scripts sont lus sous forme de `CodeLine`. Le parser `src/script/AIRParser.js` et le lecteur binaire `src/script/ScriptBinaryReader.js` reprennent la logique observée dans `script.go`.

Structure générale :

```txt
uint16 Len
uint8  Opcode
uint8  FixedFlag
bytes  RawBytes[Len - 4]
byte   Padding éventuel si Len impair
```

`FixedFlag` indique combien de `uint16` initiaux doivent être séparés du reste des paramètres :

```txt
FixedFlag = 0  → aucun paramètre fixe
FixedFlag = 1  → 1 uint16 fixe
FixedFlag >= 2 → 2 uint16 fixes
```

Les opcodes sont nommés à partir de `docs/reverse/AIR.txt`, puis chaque instruction est interprétée dans `AIRParser.js`.

### 3. Chaînes texte

Les textes de dialogue combinent plusieurs encodages :

- japonais : UTF-16LE ;
- slot anglais/traduction : UTF-8 avec longueur négative encodée sous forme `0x10000 - taille` ;
- chinois/autre slot : UTF-16LE.

Exemple logique pour `MESSAGE` :

```txt
uint16 voiceOrUnknown
string jp UTF-16LE
string en/traduction UTF-8
string zh UTF-16LE
bytes tail éventuels
```

Pour le patch FR testé, le texte français se trouve dans le slot `en`/traduction.

### 4. Choix et branches

`SELECT` contient le texte des choix, séparé par `$d`.

```txt
SELECT("Choix 1$dChoix 2")
```

Le premier `uint16` du `SELECT` est traité comme l'identifiant de variable écrit par le choix. Quand le joueur choisit une option, le moteur écrit par exemple :

```txt
#6001 = 0
#6001 = 1
#6001 = 2
```

Les opcodes suivants comme `IFN` ou `IFY` relisent ensuite cette variable pour décider de la branche.

### 5. VM et contrôle de flux

`src/vm/AIRVM.js` exécute les instructions dans l'ordre et maintient l'état du jeu : variables, pile d'appels, sprites, scène courante, changement de `seen`.

Les opcodes de flux actuellement pris en compte incluent :

```txt
GOTO
ONGOTO
GOSUB
RETURN
JUMP
FARCALL
FARRETURN
IFY
IFN
END
```

Point important observé pendant le reverse : `END` n'est pas traité comme une fin absolue du jeu. Dans certains scripts, il faut continuer la logique de scène ou attendre un changement de `seen`.

### 6. Expressions

`src/vm/ExprEval.js` est un portage JavaScript de la logique d'expressions de LuckSystem.

Il gère notamment :

```txt
#NNNN
+ - * / %
& | ^ << >>
> < >= <= == !=
&& ||
parenthèses
```

Cette partie est essentielle parce que les routes ne sont pas de simples boutons : elles dépendent de variables internes, de conditions et de sauts conditionnels.

### 7. Images CZ

`src/image/czimage.js` est le portage JavaScript du décodeur CZ de LuckSystem.

Formats actuellement gérés :

```txt
CZ0  image brute
CZ1  palette / RGB / RGBA
CZ3  LineDiff
CZ4  LineDiff4 avec RGB et alpha séparés
LZW  décompression utilisée par les variantes compressées
```

Le pipeline image est :

```txt
IMAGELOAD / HAIKEI_SET / nom de ressource
        │
        ▼
Recherche dans BGCG.PAK / CHARCG.PAK / EVENTCG.PAK / PARTS.PAK
        │
        ▼
Extraction de l'entrée PAK
        │
        ▼
decodeCZ(bytes)
        │
        ▼
ImageData RGBA
        │
        ▼
CanvasRenderer
```

Le moteur applique aussi des corrections de rendu comme l'edge-bleed pour éviter les franges autour des pixels transparents.

### 8. Audio

L'audio est résolu à partir des paramètres de script et des PAK fournis par l'utilisateur.

Mapping actuellement utilisé :

```txt
VOICE  id direct depuis le champ du MESSAGE → voice.PAK / voice1.PAK
SE     index = (u16 >> 8) - 65              → SE.PAK
BGM    index = (u16 & 0xFF) - 161           → MUSIC.PAK / BGM.PAK
```

Les SE dont le troisième argument vaut `512` sont traités comme des ambiances bouclées : cigales, pluie, vent, etc. Les SE ponctuels utilisent un autre canal pour ne pas couper l'ambiance.

### 9. Interface AIR

Le rendu utilise les vrais éléments UI importés par l'utilisateur depuis `PARTS.PAK` :

- fenêtre de dialogue `MWIN0` ;
- fenêtres de choix `SELWIN` / `SELWIN_s` ;
- médaillons de date ;
- éléments de titre et de menu quand disponibles.

Le but est d'éviter une interface générique et de se rapprocher progressivement du ressenti original.

## Déploiement web

LuckEngine-Web est un projet statique. Il peut être servi par Nginx, Apache, Caddy, GitHub Pages ou n'importe quel serveur HTTP.

Exemple Nginx minimal :

```nginx
server {
    listen 80;
    server_name example.com;

    root /var/www/luckengine-web;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

Pour un dépôt public, garde cette règle : **aucun fichier de jeu ne doit être commit**.

Le `.gitignore` du projet exclut déjà les extensions et dossiers à risque :

```txt
*.PAK
*.pak
*.webm
*.mp4
*.ogv
*.png
*.jpg
*.wav
*.ogg
game/AIR/*
scripts/*.bin
```

Avant de pousser sur GitHub :

```bash
git status --ignored
```

Les ressources commerciales doivent apparaître dans les fichiers ignorés, jamais dans les fichiers suivis.

## Licence

Le code original de **LuckEngine-Web** est publié sous licence **MIT**. Voir [`LICENSE`](LICENSE).

Cela signifie que le code du moteur peut être utilisé, copié, modifié et redistribué, y compris dans des forks, à condition de conserver la notice de copyright et la licence.

Cette licence ne s'applique pas aux éléments suivants :

- les fichiers originaux d'AIR ou d'autres visual novels ;
- les scripts, images, voix, musiques, vidéos, polices et ressources commerciales ;
- les marques, noms, logos et personnages appartenant à leurs ayants droit ;
- tout fichier importé par l'utilisateur pour jouer.

Les parties portées ou adaptées depuis LuckSystem restent soumises à leurs notices d'origine. Voir [`NOTICE.md`](NOTICE.md).

## Crédits et attribution

### LuckEngine-Web

- Conception du portage web, intégration JavaScript, tests navigateur, reverse-engineering pratique : KikenZozo.
- Assistance de développement et de documentation : outils IA utilisés ponctuellement pour structurer, déboguer et documenter le projet. La responsabilité du dépôt publié reste celle du mainteneur.

### LuckSystem / LucaSystem tools

Ce projet s'appuie fortement sur l'étude de **LuckSystem**, outil open-source de reverse-engineering et de traduction pour les moteurs Prototype/LucaSystem/LuckSystem.

Dépôt principal :

```txt
https://github.com/wetor/LuckSystem
```

Crédit principal :

```txt
LuckSystem — Copyright (c) 2026 WéΤοr — MIT License
```

Éléments étudiés, portés ou adaptés :

```txt
pak/pak.go                  → src/pak/PakReader.js
game/expr/expr.go           → src/vm/ExprEval.js
game/expr/utils.go          → src/vm/ExprEval.js
czimage/*.go                → src/image/czimage.js
script/script.go            → src/script/AIRParser.js + ScriptBinaryReader.js
game/operator/*.go          → sémantique des opcodes
data/AIR.py / AIR.txt       → table et paramètres AIR
```

Le fork **LuckSystem-2.3.2-Yoremi-Update** a aussi servi de référence pratique pour les corrections, le support de formats et les workflows AIR :

```txt
https://github.com/yoremi-trad-fr/LuckSystem-2.3.2-Yoremi-Update
```

### Ayants droit des jeux

AIR, ses ressources, son univers, ses personnages, ses images, ses musiques, ses voix et ses scripts appartiennent à leurs ayants droit, notamment **Key / VisualArts** selon l'édition concernée.

LuckEngine-Web n'est pas affilié, approuvé, sponsorisé ou maintenu par Key, VisualArts, Prototype ou tout autre ayant droit.

## Philosophie du projet

LuckEngine-Web existe pour trois raisons :

1. **Préservation** : permettre à des œuvres anciennes ou dépendantes de vieux runtimes de rester jouables.
2. **Interopérabilité** : comprendre les formats pour les exécuter sur des plateformes modernes.
3. **Accessibilité** : rendre le jeu possible sur PC, tablette, téléphone ou serveur personnel, sans machine virtuelle lourde.

Le projet ne doit pas devenir un moyen de redistribuer des jeux commerciaux. Le dépôt public doit rester un moteur vide : l'utilisateur fournit ses fichiers légalement obtenus.

## Roadmap

- Stabiliser tous les opcodes visuels utilisés dans AIR.
- Améliorer les transitions, fades, shakes et effets spéciaux.
- Reproduire plus fidèlement les menus originaux.
- Renforcer le système de sauvegardes/export/import.
- Ajouter des outils de diagnostic pour mapper plus vite les entrées PAK.
- Préparer des profils pour d'autres jeux LuckSystem/LucaSystem.
- Ajouter une documentation développeur plus complète dans `docs/`.

## Contribution

Les contributions sont bienvenues si elles respectent ces règles :

- ne jamais envoyer de fichiers commerciaux ;
- documenter les observations de reverse-engineering ;
- préférer des tests reproductibles avec données synthétiques ;
- créditer clairement les sources open-source utilisées ;
- séparer le moteur générique des données propres à un jeu.

## Avertissement

Ce projet est fourni à des fins d'interopérabilité, d'apprentissage, de préservation et d'expérimentation technique. Il ne fournit aucun jeu et ne donne aucun droit sur les ressources commerciales nécessaires pour jouer.
