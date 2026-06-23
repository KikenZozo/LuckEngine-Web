# Mettre à jour le dépôt GitHub (Windows)

Le `.gitignore` exclut tout contenu Key/VisualArts (`.PAK`, `.webm`, `.png`,
`.cz*`, etc.). Seul le **code du moteur** part sur GitHub. Le `.gitattributes`
gère les fins de ligne pour éviter les diffs parasites sous Windows.

> Utilise **Git Bash** (installé avec Git for Windows) ou **PowerShell**.
> Les commandes git ci-dessous sont identiques dans les deux.

## 1. Copier les nouveaux fichiers dans ton dépôt local

Ouvre ton dossier de dépôt dans l'Explorateur Windows et copie par-dessus le
contenu du zip (le dossier `LuckEngine-Web`). Écrase les fichiers existants.

Ne copie PAS : `node_modules\`, les `.zip`, ni tes fichiers de jeu dans `game\AIR\`.

## 2. Ouvrir un terminal dans le dépôt

- Explorateur → va dans le dossier du dépôt
- Clic droit dans le dossier → **« Ouvrir dans le Terminal »** (ou « Git Bash Here »)

## 3. Vérifier qu'aucun fichier de jeu ne partira

```powershell
git status
git status --ignored
```

Les `.PAK`, `.webm`, `.png` doivent apparaître sous **Ignored files**, jamais
sous « Changes to be committed ». Si un fichier de jeu apparaît à committer, STOP.

## 4. Commit + push

```powershell
git add .
git commit -m "Audio complet, videos MOVIE, UI MWIN/SELWIN, ecran titre, demarrage seen163"
git push
```

(Évite les accents dans le message de commit sous Windows : certains terminaux
les affichent mal.)

## Si un fichier de jeu a déjà été suivi par git AVANT le .gitignore

Le `.gitignore` n'enlève pas un fichier déjà suivi. Pour le retirer du dépôt
(en le gardant sur ton disque) :

```powershell
git rm -r --cached game/AIR
git rm --cached *.PAK
git commit -m "Retire les fichiers de jeu du suivi git"
git push
```

## Première fois : pas encore de dépôt GitHub ?

```powershell
git init
git add .
git commit -m "LuckEngine-Web"
git branch -M main
git remote add origin https://github.com/TON-PSEUDO/TON-DEPOT.git
git push -u origin main
```
