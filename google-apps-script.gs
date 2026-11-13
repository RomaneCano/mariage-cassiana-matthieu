/**
 * Reporte chaque réponse du site dans la liste d'invités :
 *   colonne D « Présence » : OUI ou NON
 *   colonne E « Allergie »  : allergies déclarées
 *
 * Installation : ouvrir le Google Sheet > Extensions > Apps Script > coller ce code
 * > Déployer > Nouveau déploiement > Application Web
 * (Exécuter en tant que : moi / Accès : tout le monde)
 * puis coller l'URL obtenue dans CONFIG.APPS_SCRIPT_URL de index.html.
 */
const SHEET_NAME = "Feuille 1";
const HEADER_ROW = 2;                 // ligne « Nom | Prénom | Tél | Présence | Allergie ... »
const COL_NOM = 1, COL_PRENOM = 2, COL_PRESENCE = 4, COL_ALLERGIE = 5;

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
// Empêche qu'un texte saisi par un invité soit interprété comme une formule.
function safe(s) {
  s = String(s || "").slice(0, 300);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function doPost(e) {
  const rec = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  const last = sh.getLastRow();
  const values = sh.getRange(HEADER_ROW + 1, 1, last - HEADER_ROW, COL_ALLERGIE).getValues();
  const nom = norm(rec.nom), prenom = norm(rec.prenom);
  const presence = rec.presence === "non" ? "NON" : "OUI";

  for (let i = 0; i < values.length; i++) {
    const rNom = norm(values[i][COL_NOM - 1]), rPrenom = norm(values[i][COL_PRENOM - 1]);
    // Correspondance sur le prénom, et sur le nom quand il est renseigné dans la liste.
    if (prenom && rPrenom && rPrenom.indexOf(prenom) !== -1 && (!rNom || rNom === nom)) {
      const row = HEADER_ROW + 1 + i;
      sh.getRange(row, COL_PRESENCE).setValue(presence);
      if (presence === "OUI" && rec.allergies) {
        const cell = sh.getRange(row, COL_ALLERGIE);
        const existing = String(cell.getValue() || "").trim();
        const add = safe(rec.allergies);
        if (!existing || existing.indexOf(add) === -1) cell.setValue(existing ? existing + ", " + add : add);
      }
      return ContentService.createTextOutput("ok");
    }
  }
  // Aucune ligne trouvée : la réponse est gardée dans un onglet à rattacher à la main.
  let aux = ss.getSheetByName("Réponses à rattacher");
  if (!aux) { aux = ss.insertSheet("Réponses à rattacher"); aux.appendRow(["Date", "Nom", "Prénom", "Présence", "Allergies"]); }
  aux.appendRow([new Date(), safe(rec.nom), safe(rec.prenom), presence, safe(rec.allergies)]);
  return ContentService.createTextOutput("a-rattacher");
}
