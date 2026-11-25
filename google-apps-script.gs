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

// La feuille des invités : l'onglet nommé SHEET_NAME s'il existe, sinon le premier onglet du classeur.
function guestSheet(ss) { return ss.getSheetByName(SHEET_NAME) || ss.getSheets()[0]; }

function doPost(e) {
  const rec = JSON.parse(e.postData.contents);
  if (rec && rec.action === "invite") return handleInvite(rec);
  if (rec && rec.action === "roadmap") return handleRoadmap(rec);
  if (rec && rec.action === "sync") return handleSync(rec);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = guestSheet(ss);
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


/* ---------------------------------------------------------------------------
   ENVOI DU LIEN D'INVITATION PAR E-MAIL (depuis votre compte Gmail)
   Installation : Paramètres du projet (roue dentée) > Propriétés du script > Ajouter une propriété
      nom : INVITE_KEY      valeur : un mot de passe de votre choix (c'est le « mot de passe d'envoi » à saisir sur le site)
   Puis Déployer > Gérer les déploiements > modifier > Nouvelle version, et accepter l'autorisation d'envoyer des e-mails.
   --------------------------------------------------------------------------- */
const SITE_URL_PAR_DEFAUT = "https://romanecano.github.io/mariage-cassiana-matthieu/";
const REPLY_TO = "cassmattas@gmail.com";
const SENDER = "cassmattas@gmail.com";   // adresse d'envoi : le script doit être déployé depuis ce compte Gmail (« Exécuter en tant que : moi »)
function senderProblem() {
  try { const me = String(Session.getEffectiveUser().getEmail() || "").toLowerCase(); if (me && me !== SENDER) return "Le script est déployé depuis " + me + " : redéployez-le depuis " + SENDER + " pour que les e-mails partent de cette adresse."; } catch (e) {}
  return "";
}
function esc(t) { return String(t == null ? "" : t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function jsonOut(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function handleInvite(rec) {
  const key = PropertiesService.getScriptProperties().getProperty("INVITE_KEY");
  if (!key) return jsonOut({ ok: false, error: "Mot de passe d'envoi non configuré (propriété INVITE_KEY du script)." });
  if (String(rec.key || "") !== key) return jsonOut({ ok: false, error: "Mot de passe d'envoi incorrect." });
  const to = String(rec.to || "").trim(), prenom = String(rec.prenom || "").replace(/[<>]/g, "").trim().slice(0, 60);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 120) return jsonOut({ ok: false, error: "Adresse e-mail invalide." });
  const sp = senderProblem(); if (sp) return jsonOut({ ok: false, error: sp });
  if (MailApp.getRemainingDailyQuota() < 1) return jsonOut({ ok: false, error: "Quota quotidien d'e-mails atteint : réessayez demain." });
  // pas deux fois le même message à la même adresse en 6 h (sécurité anti-doublon)
  const cache = CacheService.getScriptCache(), ck = "inv:" + to.toLowerCase();
  if (cache.get(ck) && !rec.force) return jsonOut({ ok: false, error: "Un message vient déjà d'être envoyé à cette adresse." });
  let site = String(rec.site || "");
  if (!/^https:\/\/[a-z0-9-]+\.github\.io\//i.test(site)) site = SITE_URL_PAR_DEFAUT;
  site = site.split("#")[0];
  const lien = site + "#presence";
  const bonjour = prenom ? "Bonjour " + prenom + "," : "Bonjour,";
  const texte = bonjour + "\n\n" +
    "Cassiana et Matthieu ont la joie de vous inviter à leur mariage, le samedi 9 octobre 2027 à 13h30, en l'église Notre-Dame des Ardents à Lagny-sur-Marne, puis au Clos du Colombier à Fontenay-Trésigny.\n\n" +
    "Toutes les informations pratiques (programme, itinéraire et parkings, logements, dress code, chants, covoiturage) sont sur notre site :\n" + site + "\n\n" +
    "Merci de nous confirmer votre présence avant le 9 juillet 2027, en indiquant vos éventuelles allergies :\n" + lien + "\n\n" +
    "Nous avons hâte de partager ce jour avec vous.\nCassiana & Matthieu";
  const html = '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#4f5020;max-width:560px">' +
    "<p>" + bonjour + "</p>" +
    "<p>Cassiana et Matthieu ont la joie de vous inviter à leur mariage, <b>le samedi 9 octobre 2027 à 13h30</b>, en l'église Notre-Dame des Ardents à Lagny-sur-Marne, puis au Clos du Colombier à Fontenay-Trésigny.</p>" +
    "<p>Toutes les informations pratiques (programme, itinéraire et parkings, logements, dress code, chants, covoiturage) sont sur notre site :<br><a href=\"" + site + "\">" + site + "</a></p>" +
    "<p>Merci de nous confirmer votre présence <b>avant le 9 juillet 2027</b>, en indiquant vos éventuelles allergies :</p>" +
    '<p style="margin:22px 0"><a href="' + lien + '" style="background:#4f5020;color:#f5f1e8;text-decoration:none;padding:12px 26px;border-radius:999px">Confirmer ma présence</a></p>' +
    "<p>Nous avons hâte de partager ce jour avec vous.<br><i>Cassiana &amp; Matthieu</i></p></div>";
  try {
    MailApp.sendEmail({ to: to, subject: "Cassiana & Matthieu vous invitent à leur mariage, le 9 octobre 2027", body: texte, htmlBody: html, name: "Cassiana & Matthieu", replyTo: REPLY_TO });
  } catch (err) { return jsonOut({ ok: false, error: "Envoi impossible : " + err }); }
  cache.put(ck, "1", 21600);
  return jsonOut({ ok: true });
}


/* ---------------------------------------------------------------------------
   ENVOI DE LA FEUILLE DE ROUTE (planning du jour) À UN INVITÉ — même mot de passe d'envoi (INVITE_KEY)
   Le site envoie : to, prenom, message, steps = [{ time, end_time, title, kind, place, notes }]
   --------------------------------------------------------------------------- */
function handleRoadmap(rec) {
  const key = PropertiesService.getScriptProperties().getProperty("INVITE_KEY");
  if (!key) return jsonOut({ ok: false, error: "Mot de passe d'envoi non configuré (propriété INVITE_KEY du script)." });
  if (String(rec.key || "") !== key) return jsonOut({ ok: false, error: "Mot de passe d'envoi incorrect." });
  const to = String(rec.to || "").trim(), prenom = String(rec.prenom || "").replace(/[<>]/g, "").trim().slice(0, 60);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 120) return jsonOut({ ok: false, error: "Adresse e-mail invalide." });
  const sp = senderProblem(); if (sp) return jsonOut({ ok: false, error: sp });
  if (MailApp.getRemainingDailyQuota() < 1) return jsonOut({ ok: false, error: "Quota quotidien d'e-mails atteint : réessayez demain." });
  const cache = CacheService.getScriptCache(), ck = "rm:" + to.toLowerCase();
  if (cache.get(ck) && !rec.force) return jsonOut({ ok: false, error: "Une feuille de route vient déjà d'être envoyée à cette adresse." });
  const steps = (Array.isArray(rec.steps) ? rec.steps : []).slice(0, 80);
  if (!steps.length) return jsonOut({ ok: false, error: "La feuille de route ne contient aucune étape." });
  const hm = function (t) { if (!t) return ""; const a = String(t).split(":"); return Number(a[0]) + "h" + (a[1] && a[1] !== "00" ? a[1] : ""); };
  const message = String(rec.message || "").slice(0, 1500);
  const bonjour = prenom ? "Bonjour " + prenom + "," : "Bonjour,";
  const lignes = steps.map(function (r) { return hm(r.time) + (r.end_time ? " → " + hm(r.end_time) : "") + "  " + String(r.title || "") + (r.place ? " — " + r.place : "") + (r.notes ? "\n      " + r.notes : ""); }).join("\n");
  const texte = bonjour + "\n\nVoici votre feuille de route pour le mariage de Cassiana et Matthieu, le samedi 9 octobre 2027.\n\n" + (message ? message + "\n\n" : "") + lignes + "\n\nNous avons hâte de partager cette journée avec vous.\nCassiana & Matthieu";
  const rows = steps.map(function (r) {
    return '<tr><td style="padding:8px 12px;border-bottom:1px solid #d9d2bd;white-space:nowrap;font-weight:bold;vertical-align:top">' + esc(hm(r.time) + (r.end_time ? " → " + hm(r.end_time) : "")) + "</td>" +
      '<td style="padding:8px 12px;border-bottom:1px solid #d9d2bd;vertical-align:top"><b>' + esc(r.title) + "</b>" + (r.notes ? '<br><span style="font-style:italic;font-size:14px">' + esc(r.notes) + "</span>" : "") + "</td>" +
      '<td style="padding:8px 12px;border-bottom:1px solid #d9d2bd;vertical-align:top;font-size:14px">' + esc(r.place) + "</td></tr>";
  }).join("");
  const html = '<div style="font-family:Georgia,serif;font-size:16px;line-height:1.55;color:#4f5020;max-width:620px">' +
    "<p>" + esc(bonjour) + "</p><p>Voici votre feuille de route pour le mariage de Cassiana et Matthieu, <b>le samedi 9 octobre 2027</b>.</p>" +
    (message ? '<p style="border-left:3px solid #b9a77a;padding-left:12px;font-style:italic;white-space:pre-wrap">' + esc(message) + "</p>" : "") +
    '<table style="border-collapse:collapse;width:100%;margin:14px 0">' + rows + "</table>" +
    "<p>Nous avons hâte de partager cette journée avec vous.<br><i>Cassiana &amp; Matthieu</i></p></div>";
  try {
    MailApp.sendEmail({ to: to, subject: "Votre feuille de route pour le mariage de Cassiana & Matthieu, le 9 octobre 2027", body: texte, htmlBody: html, name: "Cassiana & Matthieu", replyTo: REPLY_TO });
  } catch (err) { return jsonOut({ ok: false, error: "Envoi impossible : " + err }); }
  cache.put(ck, "1", 21600);
  return jsonOut({ ok: true });
}


/* ---------------------------------------------------------------------------
   SYNCHRONISATION DEPUIS LE SITE  (sens unique : site -> tableur, jamais l'inverse)
   Le site fait foi. Pour chaque invité du site déjà présent dans le tableur (même nom + prénom) :
     - Présence (D) et Allergie (E) sont recopiées telles qu'elles sont sur le site ;
     - Téléphone (C), Adresse (F) et Âge (G) sont mis à jour seulement si le site a une valeur.
   Les invités du site absents du tableur sont ajoutés à la fin. Aucune ligne n'est jamais supprimée.
   Même mot de passe que l'envoi d'e-mails (propriété INVITE_KEY).
   --------------------------------------------------------------------------- */
function handleSync(rec) {
  const key = PropertiesService.getScriptProperties().getProperty("INVITE_KEY");
  if (!key) return jsonOut({ ok: false, error: "Mot de passe non configuré (propriété INVITE_KEY du script)." });
  if (String(rec.key || "") !== key) return jsonOut({ ok: false, error: "Mot de passe incorrect." });
  const ss = SpreadsheetApp.getActiveSpreadsheet(), sh = guestSheet(ss);
  const last = sh.getLastRow();
  const values = last > HEADER_ROW ? sh.getRange(HEADER_ROW + 1, 1, last - HEADER_ROW, 7).getValues() : [];
  const index = {};
  values.forEach(function (r, i) { const k = norm(r[0]) + "|" + norm(r[1]); if (!(k in index)) index[k] = i; });
  let updated = 0; const toAdd = [];
  (rec.guests || []).slice(0, 1500).forEach(function (g) {
    const k = norm(g.nom) + "|" + norm(g.prenom);
    const pres = g.presence === "OUI" ? "OUI" : g.presence === "NON" ? "NON" : "ATT";
    if (k in index) {
      const i = index[k], row = HEADER_ROW + 1 + i, cur = values[i];
      let changed = false;
      if (String(cur[3] || "") !== pres) { sh.getRange(row, 4).setValue(pres); changed = true; }
      const al = safe(g.allergie);
      if (String(cur[4] || "") !== al) { sh.getRange(row, 5).setValue(al); changed = true; }
      [[3, g.tel], [6, g.adresse], [7, g.age]].forEach(function (c) {
        const v = safe(c[1]);
        if (v && String(cur[c[0] - 1] || "") !== v) { sh.getRange(row, c[0]).setValue(v); changed = true; }
      });
      if (changed) updated++;
    } else if (norm(g.prenom)) {
      toAdd.push([safe(g.nom), safe(g.prenom), safe(g.tel), pres, safe(g.allergie), safe(g.adresse), safe(g.age)]);
    }
  });
  if (toAdd.length) sh.getRange(sh.getLastRow() + 1, 1, toAdd.length, 7).setValues(toAdd);
  return jsonOut({ ok: true, updated: updated, added: toAdd.length });
}
