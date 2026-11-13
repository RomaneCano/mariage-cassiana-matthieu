/**
 * Écrit chaque allergie reçue dans la colonne « Allergie » (E) de la liste d'invités.
 * Installation : ouvrir le Google Sheet > Extensions > Apps Script > coller ce code
 * > Déployer > Application Web (exécuter en tant que : moi, accès : tout le monde)
 * puis coller l'URL obtenue dans CONFIG.APPS_SCRIPT_URL de index.html.
 */
const SHEET_NAME = "Feuille 1";
const HEADER_ROW = 2;          // ligne « Nom | Prénom | Tél | Présence | Allergie ... »
const COL_NOM = 1, COL_PRENOM = 2, COL_ALLERGIE = 5;

function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function doPost(e) {
  const rec = JSON.parse(e.postData.contents);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  const last = sh.getLastRow();
  const values = sh.getRange(HEADER_ROW + 1, 1, last - HEADER_ROW, COL_ALLERGIE).getValues();
  const nom = norm(rec.nom), prenom = norm(rec.prenom);

  for (let i = 0; i < values.length; i++) {
    const rNom = norm(values[i][COL_NOM - 1]), rPrenom = norm(values[i][COL_PRENOM - 1]);
    // Correspondance sur le prénom, et sur le nom quand il est renseigné dans la liste.
    if (rPrenom && rPrenom.indexOf(prenom) !== -1 && (!rNom || rNom === nom)) {
      const cell = sh.getRange(HEADER_ROW + 1 + i, COL_ALLERGIE);
      const existing = String(cell.getValue() || "").trim();
      if (!existing || existing.indexOf(rec.allergies) === -1) {
        cell.setValue(existing ? existing + ", " + rec.allergies : rec.allergies);
      }
      return ContentService.createTextOutput("ok");
    }
  }
  // Aucune ligne trouvée : on garde la réponse dans un onglet à rattacher à la main.
  let aux = ss.getSheetByName("Allergies à rattacher");
  if (!aux) { aux = ss.insertSheet("Allergies à rattacher"); aux.appendRow(["Date", "Nom", "Prénom", "Allergies"]); }
  aux.appendRow([new Date(), rec.nom, rec.prenom, rec.allergies]);
  return ContentService.createTextOutput("a-rattacher");
}
