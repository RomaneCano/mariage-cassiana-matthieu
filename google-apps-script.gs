/**
 * Reporte chaque réponse du site dans la liste d'invités :
 *   colonne D « Présence » : OUI ou NON
 *   colonne E « Allergie »  : allergies déclarées
 *
 * Installation : ouvrir le Google Sheet > Extensions > Apps Script > coller ce code
 * > Déployer > Nouveau déploiement > Application Web
 * (Exécuter en tant que : moi / Accès : tout le monde)
 * puis donner l'URL obtenue (elle se termine par /exec).
 *
 * Règle de sécurité : on n'écrit dans une ligne que si la correspondance est certaine
 * (une seule personne possible). Sinon la réponse est notée dans l'onglet « Réponses à rattacher ».
 */
const SHEET_NAME = "Feuille 1";
const HEADER_ROW = 2;                 // ligne « Nom | Prénom | Tél | Présence | Allergie ... »
const COL_NOM = 1, COL_PRENOM = 2, COL_PRESENCE = 4, COL_ALLERGIE = 5;

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
// Empêche qu'un texte saisi par un invité soit interprété comme une formule.
function safe(s) {
  s = String(s || "").slice(0, 300);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function doGet() { return ContentService.createTextOutput("ok"); }

function doPost(e) {
  const rec = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  const last = sh.getLastRow();
  const values = sh.getRange(HEADER_ROW + 1, 1, Math.max(1, last - HEADER_ROW), COL_ALLERGIE).getValues();
  const nom = norm(rec.nom), prenom = norm(rec.prenom);
  const presence = rec.presence === "non" ? "NON" : "OUI";

  // Candidats : même prénom (exact, ou contenu dans « Tata Lydie », « Papy Robert »...)
  let cands = [];
  values.forEach((r, i) => {
    const rp = norm(r[COL_PRENOM - 1]), rn = norm(r[COL_NOM - 1]);
    if (!prenom || !rp) return;
    const exact = rp === prenom, contains = rp.split(" ").indexOf(prenom) !== -1 || rp.indexOf(prenom) !== -1;
    if (exact || contains) cands.push({ i: i, exact: exact, rn: rn });
  });
  // On affine : d'abord le nom de famille, puis le prénom exact.
  let pick = cands.filter(c => c.rn && c.rn === nom);
  if (!pick.length) pick = cands.filter(c => !c.rn);          // lignes sans nom de famille
  if (pick.length > 1) { const ex = pick.filter(c => c.exact); if (ex.length) pick = ex; }

  if (pick.length === 1) {
    const row = HEADER_ROW + 1 + pick[0].i;
    sh.getRange(row, COL_PRESENCE).setValue(presence);
    if (presence === "OUI" && rec.allergies) {
      const cell = sh.getRange(row, COL_ALLERGIE);
      const existing = String(cell.getValue() || "").trim(), add = safe(rec.allergies);
      if (!existing || existing.indexOf(add) === -1) cell.setValue(existing ? existing + ", " + add : add);
    }
    return ContentService.createTextOutput("ok");
  }
  // Aucune ligne, ou plusieurs possibles : on ne devine pas.
  let aux = ss.getSheetByName("Réponses à rattacher");
  if (!aux) { aux = ss.insertSheet("Réponses à rattacher"); aux.appendRow(["Date", "Nom", "Prénom", "Présence", "Allergies", "Pourquoi"]); }
  aux.appendRow([new Date(), safe(rec.nom), safe(rec.prenom), presence, safe(rec.allergies), pick.length > 1 ? "Plusieurs personnes possibles" : "Aucune ligne correspondante"]);
  return ContentService.createTextOutput("a-rattacher");
}
