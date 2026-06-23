// ============================================================================
// LuckEngine-Web — src/app/config.js
// ----------------------------------------------------------------------------
// Configuration de démarrage. Le jeu se lance tout seul avec ces valeurs.
// ============================================================================
export const CONFIG = {
  gameDir: "game/AIR",   // dossier des .PAK (servi en HTTP)
  scriptPak: "SCRIPT.PAK",
  // CG paks dans lesquels résoudre IMAGELOAD imgId (par id global, puis index).
  // L'ordre = priorité de recherche. Tous optionnels : on charge ceux présents.
  imagePaks: [
    "BGCG.PAK",     // fonds
    "CHARCG.PAK",   // sprites personnages
    "EVENTCG.PAK",  // CG d'événement
    "OTHCG.PAK",
    "SYSCG.PAK",
    "SYSCG2.PAK",
    "PARTS.PAK",
  ],
  // PAK audio : VOICE -> voice.PAK, SE -> SE.PAK, BGM -> MUSIC.PAK. Optionnels.
  audioPaks: [
    "voice.PAK",
    "SE.PAK",
    "MUSIC.PAK",
    "BGM.PAK",
  ],
  // Entrée de départ : index (nombre) OU nom (chaîne, ex: "seen0000").
  // Point de départ d'une nouvelle partie (comme le vrai AIR) : seen170 = la
  // cinématique d'ouverture ("My child… the long, long journey…"), l'opening
  // (AIR_OP_A/B) puis le monologue de Yukito. L'histoire s'enchaîne ensuite via
  // JUMP, et seuls les SELECT (choix) font bifurquer les routes.
  startEntry: "seen170",
  lang: "en",            // "jp" | "en" | "zh" (repli automatique si vide)
};
