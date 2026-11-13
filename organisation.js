/* ============================================================================
   Espace des mariés étendu : Aujourd'hui (verset du jour), Organisation, Photos, Prière.
   Ce fichier s'appuie sur les fonctions du script principal (el, $, remote, store,
   showToast, showMsg, explainErr, CONTENT, state...). Tout ce qui est ici est réservé
   aux mariés connectés, sauf la galerie publique des photos affichée après le mariage.
   ============================================================================ */
"use strict";

const WEDDING_ISO = "2027-10-09";
const dayMs = 86400000;
const isoOf = d => d.toISOString().slice(0, 10);
const addDays = (iso, n) => isoOf(new Date(Date.parse(iso + "T12:00:00Z") + n * dayMs));
const todayISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
const daysBetween = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / dayMs);
const eur = n => (Number(n) || 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const frDate = iso => { try { return new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }); } catch { return iso || ""; } };
const stripHtml = h => { const d = new DOMParser().parseFromString(String(h || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n"), "text/html"); return (d.body.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); };

/* ---------------------------------------------------------------------------
   1. Verset du jour (Évangile de la messe du jour, AELF)
   --------------------------------------------------------------------------- */
const FALLBACK_VERSES = [
  { t: "Que l'homme ne sépare donc pas ce que Dieu a joint.", r: "Évangile selon saint Matthieu 19, 6 (Louis Segond)" },
  { t: "Maintenant ces trois choses demeurent : la foi, l'espérance, la charité ; mais la plus grande de ces choses, c'est la charité.", r: "1 Corinthiens 13, 13 (Louis Segond)" },
  { t: "Si l'Éternel ne bâtit la maison, ceux qui la bâtissent travaillent en vain.", r: "Psaume 127, 1 (Louis Segond)" }
];
function firstSentences(text, max = 280) {
  const t = text.replace(/\s+/g, " ").trim(); if (t.length <= max) return t;
  const cut = t.slice(0, max), i = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf(" ; "));
  return (i > 80 ? cut.slice(0, i + 1) : cut.replace(/\s+\S*$/, "") + "…");
}
async function fetchGospel(dateStr) {
  const key = "mariage:evangile:" + dateStr;
  try { const c = JSON.parse(localStorage.getItem(key) || "null"); if (c) return c; } catch {}
  const r = await fetch("https://api.aelf.org/v1/messes/" + dateStr + "/france", { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("AELF " + r.status);
  const j = await r.json();
  const lectures = ((j.messes || [])[0] || {}).lectures || [];
  const ev = lectures.find(l => /evangile/i.test(l.type || "")) || null;
  if (!ev) throw new Error("pas d'évangile");
  const full = stripHtml(ev.contenu);
  const out = {
    jour: (j.informations || {}).jour_liturgique_nom || "",
    ref: ev.ref || "",
    titre: ev.titre || "Évangile",
    verset: ev.verset_evangile ? stripHtml(ev.verset_evangile) : firstSentences(full),
    full
  };
  try { localStorage.setItem(key, JSON.stringify(out)); } catch {}
  return out;
}
async function renderVerse(host, opts = {}) {
  host.replaceChildren(el("p", { class: "hint", text: "Chargement du verset du jour…" }));
  const d = todayISO();
  let g = null;
  try { g = await fetchGospel(d); } catch {}
  host.replaceChildren();
  const cross = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  cross.setAttribute("viewBox", "0 0 40 40"); cross.setAttribute("class", "verse-cross"); cross.setAttribute("aria-hidden", "true");
  cross.innerHTML = '<path d="M20 4v32M11 14h18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M6 31c5-1 9 0 14 5M34 31c-5-1-9 0-14 5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity=".7"/>';
  host.append(cross);
  if (g) {
    host.append(
      el("p", { class: "verse-day", text: frDate(d) }),
      el("blockquote", { class: "verse-text", text: "« " + g.verset + " »" }),
      el("p", { class: "verse-ref", text: g.titre + (g.ref ? " (" + g.ref + ")" : "") }));
    if (opts.full !== false && g.full) host.append(el("details", { class: "verse-more" }, el("summary", { text: "Lire l'Évangile du jour" }), el("div", { class: "verse-full", text: g.full })));
  } else {
    const f = FALLBACK_VERSES[Math.floor(Date.parse(d) / dayMs) % FALLBACK_VERSES.length];
    host.append(
      el("p", { class: "verse-day", text: frDate(d) }),
      el("blockquote", { class: "verse-text", text: "« " + f.t + " »" }),
      el("p", { class: "verse-ref", text: f.r }),
      el("p", { class: "hint", text: "L'Évangile du jour n'a pas pu être chargé. Verset proposé à la place." }));
  }
  host.append(el("p", { class: "verse-link" }, el("a", { href: "https://www.aelf.org/" + d + "/romain/messe", target: "_blank", rel: "noopener", text: "Toutes les lectures du jour sur aelf.org" })));
  return g;
}

/* ---------------------------------------------------------------------------
   2. Organisation : modules (tâches, budget, prestataires, plan de tables, jour J, notes)
   --------------------------------------------------------------------------- */
const CATS_TASK = ["Administratif & église", "Lieu & réception", "Prestataires", "Tenues & beauté", "Cérémonie religieuse", "Invités & faire-part", "Budget", "Jour J & logistique", "Après le mariage"];
const CATS_BUDGET = ["Lieu", "Traiteur", "Photographe", "DJ", "Musicien", "Fleuriste", "Coiffure / Maquillage", "Jeux & animations", "Cérémonie", "Tenues", "Décoration", "Papeterie", "Transport", "Imprévus"];
const ROLES = ["Lieu", "Traiteur", "Photographe", "DJ", "Musicien", "Fleuriste", "Coiffure / Maquillage", "Autre"];
const STATUS = ["À contacter", "En attente de devis", "En attente de réponse", "Réponse finale à donner", "Réponse négative à donner", "Retenu (OUI)", "Refusé (NON)", "Réservé", "Acompte versé", "Soldé"];
const RETAINED = ["Retenu (OUI)", "Réservé", "Acompte versé", "Soldé"];
const WHO = ["Cassiana", "Matthieu", "Les deux", "Autre"];

const ORG = {
  tasks: { table: "org_tasks", label: "Tâches", order: "due", defaults: { done: false, cat: CATS_TASK[0], who: "Les deux" }, fields: [
    { k: "done", l: "Fait", t: "check" }, { k: "title", l: "Tâche", t: "text", req: true, wide: true }, { k: "cat", l: "Catégorie", t: "select", o: CATS_TASK, newable: true },
    { k: "due", l: "Échéance", t: "date" }, { k: "who", l: "Qui", t: "select", o: WHO }, { k: "notes", l: "Notes", t: "text" }] },
  budget: { table: "org_budget", label: "Budget", order: "cat", defaults: { cat: CATS_BUDGET[0] }, fields: [
    { k: "cat", l: "Poste", t: "select", o: CATS_BUDGET, newable: true }, { k: "item", l: "Dépense", t: "text", req: true, wide: true },
    { k: "estimated", l: "Prévu (€)", t: "number" }, { k: "family", l: "Pris en charge par la famille (€)", t: "number" }, { k: "paid", l: "Payé (€)", t: "number" },
    { k: "notes", l: "Notes", t: "text" }] },
  vendors: { table: "org_vendors", label: "Prestataires", order: "role", defaults: { status: "À contacter", role: "Autre" }, fields: [
    { k: "name", l: "Prestataire", t: "text", req: true, wide: true }, { k: "role", l: "Catégorie", t: "select", o: ROLES, newable: true },
    { k: "status", l: "Statut", t: "select", o: STATUS }, { k: "location", l: "Localisation", t: "text" },
    { k: "price", l: "Prix (€)", t: "number" }, { k: "distance", l: "Distance", t: "text" },
    { k: "contact", l: "Contact", t: "text" }, { k: "phone", l: "Téléphone", t: "text" }, { k: "email", l: "E-mail", t: "text" },
    { k: "availability", l: "Disponibilité", t: "text" }, { k: "deposit", l: "Acompte (€)", t: "number" }, { k: "notes", l: "Notes", t: "long", wide: true }] },
  guests: { table: "org_guests", label: "Invités", order: "position", defaults: { presence: "ATT" }, fields: [
    { k: "nom", l: "Nom", t: "text" }, { k: "prenom", l: "Prénom", t: "text", req: true }, { k: "tel", l: "Téléphone", t: "text" },
    { k: "presence", l: "Présence", t: "select", o: ["ATT", "OUI", "NON"], labels: { ATT: "En attente", OUI: "Présent(e)", NON: "Absent(e)" } },
    { k: "allergie", l: "Allergie", t: "text" }, { k: "adresse", l: "Adresse", t: "text" },
    { k: "envoi", l: "Invitation", t: "select", o: ["Courrier", "QR code", "Remise en main"] }, { k: "age", l: "Âge", t: "text" }, { k: "notes", l: "Notes", t: "text" }] },
  games: { table: "org_games", label: "Jeux", order: "created_at", defaults: { chosen: false }, fields: [
    { k: "chosen", l: "Retenu", t: "check" }, { k: "name", l: "Idée de jeu", t: "text", req: true, wide: true }, { k: "people", l: "Nb de personnes", t: "text" },
    { k: "material", l: "Matériel", t: "text" }, { k: "price", l: "Prix (€)", t: "number" }, { k: "notes", l: "Notes", t: "text" }] },
  seating: { table: "org_tables", label: "Plan de tables", order: "position", defaults: { capacity: 10, shape: "Ronde" }, fields: [
    { k: "name", l: "Nom de la table", t: "text", req: true, ph: "ex. Table 1, Famille Martin, Amis…" }, { k: "shape", l: "Forme", t: "select", o: ["Ronde", "Rectangulaire"] }, { k: "capacity", l: "Nombre de places", t: "number" },
    { k: "guests", l: "Invités", t: "long", wide: true }, { k: "notes", l: "Notes", t: "text" }] },
  timeline: { table: "org_timeline", label: "Jour J", order: "time", defaults: {}, fields: [
    { k: "time", l: "Heure", t: "time", req: true }, { k: "title", l: "Étape", t: "text", req: true, wide: true },
    { k: "who", l: "Qui", t: "text" }, { k: "notes", l: "Notes", t: "text" }] }
};

const TPL = {
  tasks: () => [
    [365, 0, "Contacter la paroisse Notre-Dame des Ardents (Lagny) pour la préparation au mariage"], [330, 0, "Fixer les dates de préparation au mariage (rencontres, week-end)"],
    [270, 0, "Rassembler les pièces du dossier de mariage : extraits d'acte de naissance, baptême, pièces d'identité"], [210, 0, "Rendez-vous avec le prêtre : date de la cérémonie, lectures, déroulé"],
    [150, 0, "Démarches à la mairie pour le mariage civil et la publication des bans"], [120, 0, "Contrat de mariage : rendez-vous chez le notaire si souhaité"], [60, 0, "Confirmer la date et l'heure du mariage civil à la mairie"],
    [330, 1, "Verser l'acompte du Clos du Colombier et relire le contrat"], [180, 1, "Valider le menu et le nombre de convives avec le traiteur"], [90, 1, "Visite de repérage et plan de salle au Clos du Colombier"],
    [30, 1, "Confirmer le nombre définitif d'invités au domaine"], [14, 1, "Transmettre la liste des allergies au traiteur"],
    [330, 2, "Réserver le photographe"], [300, 2, "Réserver le DJ ou les musiciens"], [270, 2, "Réserver le fleuriste (église et réception)"],
    [240, 2, "Choisir la pièce montée ou le gâteau"], [180, 2, "Réserver coiffure et maquillage, prévoir un essai"], [150, 2, "Réserver la voiture des mariés"],
    [300, 3, "Choisir la robe de la mariée"], [240, 3, "Choisir le costume du marié"], [150, 3, "Choisir les alliances"], [60, 3, "Dernier essayage des tenues"], [14, 3, "Essai coiffure et maquillage"],
    [150, 4, "Choisir les chants de la messe et préparer la chorale"], [150, 4, "Choisir les lectures et le psaume"], [90, 4, "Préparer le livret de messe"],
    [60, 4, "Choisir les témoins et les personnes qui liront"], [30, 4, "Répétition de la cérémonie à l'église"],
    [330, 5, "Finaliser la liste d'invités"], [270, 5, "Commander et envoyer les faire-part"], [200, 5, "Envoyer le lien du site aux invités numériques"],
    [92, 5, "Relancer les invités sans réponse (date limite de confirmation : 9 juillet)"], [60, 5, "Faire le plan de tables"], [45, 5, "Conseiller des logements aux invités venant de loin"],
    [365, 6, "Définir le budget global et se répartir les dépenses"], [180, 6, "Faire le point sur les acomptes et paiements"], [30, 6, "Préparer les paiements des prestataires du jour J"],
    [14, 7, "Préparer le déroulé de la journée et le partager aux témoins"], [7, 7, "Préparer la valise des mariés et la trousse de secours"], [7, 7, "Confirmer les horaires avec tous les prestataires"],
    [3, 7, "Récupérer les tenues, les alliances et les fleurs"], [1, 7, "Préparer les affaires pour l'église (livrets, offrande, alliances)"],
    [-1, 8, "Rendre les tenues de location et récupérer la décoration"], [-7, 8, "Remercier les invités (cartes ou message)"], [-14, 8, "Déposer les photos sur le site (Espace mariés > Photos)"], [-30, 8, "Faire le bilan du budget et solder les prestataires"]
  ].map(([d, c, title]) => ({ title, cat: CATS_TASK[c], due: addDays(WEDDING_ISO, -d), who: "Les deux", done: false })),
  budget: () => [
    ["Lieu", "Location du Clos du Colombier", 3950, "Clos du Colombier"], ["Lieu", "Ménage", 260, "Clos du Colombier"], ["Lieu", "Chambre de la mariée", 80, "Clos du Colombier"], ["Lieu", "Hébergement des mariés"],
    ["Traiteur", "Dîner et cocktail (110 adultes)", 10428, "La graine d'envie"], ["Traiteur", "Boissons et vins"], ["Traiteur", "Pièce montée / gâteau"],
    ["Photographe", "Photographe", 1100, "Thomas Vallette"], ["DJ", "DJ", 990, "L'onirique"], ["DJ", "Photobooth", 400, "L'onirique"],
    ["Musicien", "Saxophoniste (cocktail, 2 h)", 380, "Alexandre Adler"], ["Fleuriste", "Fleurs (pose facturée 40 €/h)", 500, "L'onirique"], ["Coiffure / Maquillage", "Coiffure et maquillage"],
    ["Jeux & animations", "Matériel des jeux"],
    ["Cérémonie", "Offrande à la paroisse"], ["Cérémonie", "Livrets de messe"], ["Cérémonie", "Chorale / musiciens"], ["Cérémonie", "Fleurs de l'église"],
    ["Tenues", "Robe de la mariée"], ["Tenues", "Costume du marié"], ["Tenues", "Alliances"], ["Décoration", "Décoration de la salle"],
    ["Papeterie", "Faire-part et enveloppes"], ["Transport", "Voiture des mariés"], ["Imprévus", "Imprévus (environ 5 % du budget)"]
  ].map(([cat, item, estimated, vendor]) => ({ cat, item, ...(estimated ? { estimated, vendor } : {}) })),
  vendors: () => {
    const V = (role, status, name, location, price, extra) => ({ role, status, name, location, price, ...extra });
    const OUI = "Retenu (OUI)", DEV = "En attente de devis", REP = "En attente de réponse", FIN = "Réponse finale à donner", NEG = "Réponse négative à donner", CON = "À contacter", NON = "Refusé (NON)";
    return [
      V("Lieu", CON, "Domaine de Champigny (nom à confirmer)", "Champigny", null, { distance: "40 min", phone: "01.64.38.89.42", email: "Vajou@ledomainedeChampigny.com", availability: "18-25 septembre / 2-9 octobre", notes: "Réservation du vendredi 14 h au dimanche 19 h · 90 places de parking · gardiennage · pas de musique autorisée pendant le cocktail dehors" }),
      V("Lieu", OUI, "Clos du Colombier", "Fontenay-Trésigny (77)", 3950, { distance: "40 min", phone: "07.62.44.12.12", email: "Closducolombier77@gmail.com", availability: "9, 16, 23 oct 2027 / novembre", notes: "Prix HS 3 950 € · capacité 150 pers · ménage 260 € · traiteur non imposé · droit de bouchon 0 € · réservation vendredi 9 h-18 h, samedi 9 h, dimanche 18 h · 100 places de parking · 80 € pour la chambre de la mariée · salle pour faire dormir les bébés · écran projecteur déjà présent" }),
      V("Traiteur", FIN, "Mademoiselle Marguerite", "Clais (Normandie)", 8400, { distance: "350", notes: "Prix pour 110 adultes · droit de bouchon 0 € · serveurs/cuisto inclus · vaisselle/nappes non incluses · soft non inclus · dégustation 28/29 novembre à Clais, 50 €/pers" }),
      V("Traiteur", OUI, "La graine d'envie", "Tournan-en-Brie", 10428, { phone: "06 81 08 45 34", notes: "Prix pour 110 adultes · droit de bouchon 0 € · serveurs et vaisselle/nappes inclus · dégustations : vendredi 30/10 à 18 h, samedi 31/10 à 11 h et à 14 h à Pontault-Combault · super gentil, lui donner toutes les allergies" }),
      V("Traiteur", DEV, "Guyot traiteur", "Bruyères-le-Châtel", 9400, { notes: "Prix pour 110 adultes · serveurs et vaisselle inclus · dégustation 12 nov (35 €) · à demander : le DJ est-il en repas presta ? combien coûte l'heure supp jusqu'à 4 h ?" }),
      V("Traiteur", FIN, "Idélice traiteur", "Fontenay-Trésigny", 11070, { notes: "Prix pour 110 adultes · serveurs et vaisselle inclus · dégustation 30 € · heure supp déjà incluse" }),
      V("Traiteur", NON, "Prog traiteur 77", "Moissy-Cramayel", 11118.8, { notes: "Noté « donner réponse finale, NON » dans le tableur · serveurs et vaisselle inclus · dégustation : 120 € pour 2, déduite du devis si on continue (200 €)" }),
      V("Traiteur", DEV, "La marinade", "Combs-la-Ville", null, {}),
      V("Traiteur", DEV, "Romain Merlet", "", 10649, { distance: "??", notes: "Prix pour 110 adultes · droit de bouchon 0 € · 3510 (à préciser)" }),
      V("Traiteur", FIN, "Axel : Le petit gourmet", "Tournan-en-Brie", 11355, { notes: "Prix pour 110 adultes · serveurs inclus · droit de bouchon 0 €" }),
      V("Traiteur", NON, "KB traiteur", "Croissy-Beaubourg", 12440, { notes: "Serveurs et vaisselle inclus" }),
      V("Traiteur", NON, "Traiteur artisan 77", "Ozoir-la-Ferrière", 9500, { distance: "22 min", email: "artisantraiteur77@gmail.com", notes: "Vins à discrétion · pas de ristourne si c'est NOTRE vin · soft non inclus · jusqu'à 1 h" }),
      V("Traiteur", DEV, "Gourmet traiteur", "Normandie / Île-de-France", null, {}),
      V("Traiteur", DEV, "L'heure des mets", "Montigny", null, { notes: "Serveurs et vaisselle inclus" }),
      V("Traiteur", REP, "Dolcezza Gourmet", "Cesson (77)", null, { notes: "Pièce montée en choux" }),
      V("Photographe", OUI, "Thomas Vallette", "", 1100, { contact: "mail / insta", availability: "2, 9, 16 oct 2027", notes: "Catho · photo avant le mariage · aime le jeu du bouquet" }),
      V("Photographe", REP, "unrayon2solene", "Paris", null, { email: "unrayon2solene@gmail.com", notes: "Catho" }),
      V("Photographe", NON, "Salomé Orieux", "Perpignan", 1100, { contact: "insta", notes: "300 photos (j'aime beaucoup) · attente d'un autre couple sur cette date" }),
      V("Photographe", NEG, "Elise Delattre", "Provins", 1600, { contact: "insta", notes: "1600 à 2000 € · catho" }),
      V("Photographe", REP, "Alaïs Rousseau", "Paris", 1500, { email: "contact@alais-rousseau.com" }),
      V("Photographe", REP, "Joséphine Gilbert", "Paris", 1400, { email: "josephineglbt@gmail.com", notes: "Catho" }),
      V("Photographe", NON, "tesbellesphotos", "Paris", 1350, { email: "contact@tesbellesphotos.fr", notes: "150 à 250 photos retouchées (pas fan du style photos 2012)" }),
      V("Photographe", NON, "Marguerite de Gastines", "Paris", 2100, { email: "margueritedegastines.pro@gmail.com" }),
      V("Photographe", NEG, "Albane CT (albanect)", "Paris", 2550, { email: "albanect@gmail.com" }),
      V("Photographe", CON, "Domitille Daief", "Toulon", 1775, { distance: "inclus dans le tarif", email: "domi.photographie.dd@gmail.com", availability: "ok" }),
      V("DJ", OUI, "L'onirique", "77", 990, { distance: "20 min", availability: "visio le 13", notes: "400 € le photobooth · faire une playlist, déroulé de la journée / soirée" }),
      V("Musicien", CON, "Cyril Morin", "Paris", 850, { contact: "insta", notes: "Saxo · durée 2 h" }),
      V("Musicien", FIN, "Music tous style", "Étampes", 590, { contact: "saxo", notes: "Saxo · durée 2 h" }),
      V("Musicien", CON, "Joosax", "Bussy-Saint-Georges", null, { contact: "saxo", phone: "06 65 60 10 31", notes: "Revenir vers lui en janvier" }),
      V("Musicien", REP, "Sevsax", "Sainte-Aulde (77)", null, { contact: "saxo" }),
      V("Musicien", REP, "Marc Denouel", "La Ferté-sous-Jouarre", 600, { contact: "saxo", notes: "Saxo + piano" }),
      V("Musicien", OUI, "Alexandre Adler", "Montcourt-Fromonville", 380, { contact: "saxo", notes: "Saxo · durée 2 h" }),
      V("Fleuriste", REP, "L'onirique (fleurs)", "77", 500, { availability: "OK pour le 09 oct 27", notes: "Rencontre en vrai nécessaire · temps de pose des fleurs facturé 40 € de l'heure" }),
      V("Coiffure / Maquillage", CON, "Mélise Bycoiff", "Andrezel (77)", 80, { notes: "À partir de 80 €" }),
      V("Coiffure / Maquillage", CON, "BLD coiffure", "Provins (77)", 50, { notes: "À partir de 50 €" }),
      V("Coiffure / Maquillage", CON, "L'atelier beauté", "Varennes-sur-Seine", 70, { notes: "À partir de 70 €" })
    ];
  },
  games: () => [
    ["Chaise musicale", "10", "Chaises", 0], ["LUI ou ELLE", "Toutes les tables", "1 panneau CASS / MATT par table", 0], ["Premier qui trouve l'objet", "5", "", 0],
    ["Pétanque", "Illimité", "Cagette + boules", 0], ["Molkky", "Illimité", "", null], ["Blind test", "Toutes les tables", "Sono", null], ["Jeu des binômes", "Tout le monde", "Papier", null],
    ["Course saucisson", "Les hommes", "Saucisson", 15], ["Pallet breton", "Illimité", "", null], ["Jeu photo : imiter des poses", "Illimité", "Imprimer des images", null],
    ["Jeu des pinces à linge à accrocher sur les autres", "Illimité", "Pinces à linge + corbeille", 20]
  ].map(([name, people, material, price]) => ({ name, people, material: material || null, price, chosen: false })),
  seating: () => ["Table d'honneur", ...Array.from({ length: 10 }, (_, i) => "Table " + (i + 1))].map((name, i) => ({ name, capacity: 10, guests: "", position: i })),
  timeline: () => [
    ["08:30", "Petit-déjeuner et début des préparatifs"], ["10:00", "Coiffure et maquillage de la mariée"], ["12:30", "Habillage et photos de préparation"],
    ["13:00", "Arrivée à l'église, accueil des invités"], ["13:30", "Cérémonie religieuse à Notre-Dame des Ardents"], ["15:00", "Sortie de l'église et photos de groupe (heure indicative)"],
    ["16:30", "Trajet vers le Clos du Colombier (environ 40 minutes)"], ["17:30", "Cocktail"], ["19:30", "Dîner"], ["23:00", "Gâteau et ouverture de bal (à préciser)"], ["04:00", "Fin de la soirée"]
  ].map(([time, title]) => ({ time, title }))
};

const orgStore = {
  async list(t) { const { data, error } = await remote.from(t).select("*"); if (error) throw error; return data || []; },
  async insert(t, rows) { const { data, error } = await remote.from(t).insert(rows).select(); if (error) throw error; if (!data || !data.length) throw { code: "42501", message: "row-level security" }; return data; },
  async update(t, id, patch) { const { data, error } = await remote.from(t).update(patch).eq("id", id).select(); if (error) throw error; if (!data || !data.length) throw { code: "42501", message: "row-level security" }; },
  async remove(t, id) { const { error } = await remote.from(t).delete().eq("id", id); if (error) throw error; }
};
const orgErr = e => "Non enregistré : " + explainErr(e) + (/table|relation|schema/i.test(String((e && e.message) || "")) || (e && e.code === "PGRST205") ? " Exécutez supabase-tout-en-un.sql dans Supabase." : "");

const orgOpen = new Set();
const orgState = { key: "tasks", filter: { status: "todo", cat: "", gp: "", gq: "" } };

function sortRows(key, rows) {
  const by = (f) => rows.slice().sort(f);
  if (key === "guests") return by((a, b) => (a.position || 0) - (b.position || 0) || String(a.nom || "").localeCompare(String(b.nom || ""), "fr") || String(a.prenom || "").localeCompare(String(b.prenom || ""), "fr"));
  if (key === "tasks") return by((a, b) => (a.done - b.done) || String(a.due || "9999").localeCompare(String(b.due || "9999")) || String(a.title).localeCompare(String(b.title)));
  if (key === "budget") return by((a, b) => CATS_BUDGET.indexOf(a.cat) - CATS_BUDGET.indexOf(b.cat) || String(a.item).localeCompare(String(b.item)));
  if (key === "vendors") return by((a, b) => { const ia = ROLES.indexOf(a.role), ib = ROLES.indexOf(b.role); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a.created_at || "").localeCompare(String(b.created_at || "")); });
  if (key === "seating") return by((a, b) => (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name), "fr", { numeric: true }));
  if (key === "timeline") { const k = t => { const [h, m] = String(t || "99:00").split(":").map(Number); return (h < 6 ? h + 24 : h) * 60 + (m || 0); }; return by((a, b) => k(a.time) - k(b.time)); }
  return by((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function guestEditor(value, cap) {
  let guests = String(value || "").split("\n").map(x => x.trim()).filter(Boolean);
  const box = el("div", { class: "guest-ed" }), slots = el("div", { class: "slots" });
  const input = el("input", { type: "text", maxlength: "60", placeholder: "Nom de l'invité, puis Entrée", "aria-label": "Ajouter un invité" });
  const emit = () => box.dispatchEvent(new Event("change", { bubbles: true }));
  const render = () => {
    slots.replaceChildren();
    guests.forEach((g, i) => slots.append(el("span", { class: "slot filled", title: g },
      el("i", { text: initials(g), style: "background:" + colorOf(g) }), el("span", { text: g }),
      el("button", { type: "button", "aria-label": "Retirer " + g, text: "×", onclick: () => { guests.splice(i, 1); render(); emit(); } }))));
    for (let k = guests.length; k < (Number(cap) || 10); k++) slots.append(el("button", { type: "button", class: "slot empty", "aria-label": "Place libre", text: "+", onclick: () => input.focus() }));
  };
  const add = () => { const names = input.value.split(/[,;]/).map(x => x.trim()).filter(Boolean); if (!names.length) return; guests.push(...names); input.value = ""; render(); emit(); input.focus(); };
  input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); add(); } });
  box.append(slots, el("div", { class: "add-guest" }, input, el("button", { type: "button", class: "btn small", text: "Ajouter", onclick: add })));
  Object.defineProperty(box, "value", { get: () => guests.join("\n"), set: v => { guests = String(v || "").split("\n").map(x => x.trim()).filter(Boolean); render(); } });
  render();
  return box;
}
function fieldInput(f, value, row) {
  let inp;
  if (f.t === "select") {
    const opts = ["", ...f.o]; if (value && !opts.includes(value)) opts.push(value);
    inp = el("select", {}, ...opts.map(o => el("option", { value: o, text: (f.labels && f.labels[o]) || o || "—" })));
    if (f.newable) inp.append(el("option", { value: "__new__", text: "➕ Nouvelle catégorie…" }));
    inp.value = value || ""; inp.dataset.prev = inp.value;
    if (f.newable) inp.addEventListener("change", () => {
      if (inp.value !== "__new__") { inp.dataset.prev = inp.value; return; }
      const name = (window.prompt("Nom de la nouvelle catégorie :") || "").trim().slice(0, 60);
      if (!name) { inp.value = inp.dataset.prev; return; }
      if (![...inp.options].some(o => o.value === name)) inp.insertBefore(el("option", { value: name, text: name }), inp.querySelector('option[value="__new__"]'));
      inp.value = name; inp.dataset.prev = name;
      if (!f.o.includes(name)) f.o.push(name);
    });
  }
  else if (f.t === "check") { inp = el("input", { type: "checkbox" }); inp.checked = !!value; }
  else if (f.t === "long" && f.k === "guests") inp = guestEditor(value, row ? row.capacity : 10);
  else if (f.t === "long") {
    inp = el("textarea", { rows: "1" }); inp.value = value || "";
    const grow = () => { inp.style.height = "auto"; if (inp.scrollHeight) inp.style.height = (inp.scrollHeight + 2) + "px"; };
    inp.addEventListener("input", grow);
    new ResizeObserver(() => { if (inp._w !== inp.offsetWidth) { inp._w = inp.offsetWidth; grow(); } }).observe(inp);
  }
  else { inp = el("input", { type: f.t === "number" ? "number" : f.t === "date" ? "date" : f.t === "time" ? "time" : "text", step: f.t === "number" ? "any" : null }); inp.value = value == null ? "" : value; }
  inp.setAttribute("aria-label", f.l);
  if (f.ph && inp.tagName === "INPUT") inp.placeholder = f.ph;
  return inp;
}
const readInput = (f, inp) => f.t === "check" ? inp.checked : f.t === "number" ? (inp.value === "" ? null : Number(inp.value)) : (inp.value.trim() === "" ? null : inp.value.trim());

function orgSummary(key, rows) {
  const box = el("div", { class: "org-sum" });
  const chip = (label, value, cls) => box.append(el("div", { class: "sum-chip " + (cls || "") }, el("b", { text: value }), el("span", { text: label })));
  if (key === "tasks") {
    const done = rows.filter(r => r.done).length, late = rows.filter(r => !r.done && r.due && r.due < todayISO()).length;
    chip("faites", done + " / " + rows.length); chip("en retard", String(late), late ? "warn" : ""); chip("avant le mariage", Math.max(0, daysBetween(todayISO(), WEDDING_ISO)) + " j");
    if (rows.length) box.append(el("div", { class: "bar big" }, el("i", { style: "width:" + Math.round(done / rows.length * 100) + "%" })));
  } else if (key === "budget") {
    const s = f => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0), est = s("estimated"), paid = s("paid"), total = est;
    const fam = s("family"); chip("prévu", eur(est)); chip("pris en charge par la famille", eur(fam)); chip("à notre charge", eur(Math.max(0, est - fam))); chip("payé", eur(paid)); chip("reste à payer", eur(Math.max(0, total - paid)), total - paid > 0 ? "warn" : "");
  } else if (key === "vendors") {
    const c = st => rows.filter(r => st.includes(r.status)).length;
    chip("à contacter", String(c(["À contacter"]))); chip("en attente", String(c(["En attente de devis", "En attente de réponse", "Réponse finale à donner", "Réponse négative à donner"]))); chip("retenus", String(c(RETAINED))); chip("refusés", String(c(["Refusé (NON)"])));
    chip("prix des retenus", eur(rows.filter(r => RETAINED.includes(r.status)).reduce((a, r) => a + (Number(r.price) || 0), 0)));
  } else if (key === "guests") {
    const c = f => rows.filter(f).length;
    chip("invités", String(rows.length)); chip("présents", String(c(r => r.presence === "OUI")), ""); chip("absents", String(c(r => r.presence === "NON")));
    chip("en attente", String(c(r => !r.presence || r.presence === "ATT"))); chip("allergies", String(c(r => r.allergie && r.allergie.trim())));
    chip("enfants", String(c(r => r.age && r.age.trim()))); chip("courrier", String(c(r => r.envoi === "Courrier"))); chip("QR code", String(c(r => r.envoi === "QR code"))); chip("remise en main", String(c(r => r.envoi === "Remise en main")));
  } else if (key === "games") {
    chip("idées", String(rows.length)); chip("retenues", String(rows.filter(r => r.chosen).length)); chip("coût des retenues", eur(rows.filter(r => r.chosen).reduce((a, r) => a + (Number(r.price) || 0), 0)));
  } else if (key === "seating") {
    const placed = rows.reduce((a, r) => a + String(r.guests || "").split("\n").filter(x => x.trim()).length, 0), cap = rows.reduce((a, r) => a + (Number(r.capacity) || 0), 0);
    chip("tables", String(rows.length)); chip("invités placés", String(placed)); chip("places", String(cap), cap && placed > cap ? "warn" : "");
  } else if (key === "timeline") chip("étapes", String(rows.length));
  return box;
}


/* ---------------------------------------------------------------------------
   Plan de tables : schéma avec avatars (glisser-déposer, ou toucher puis toucher la table)
   --------------------------------------------------------------------------- */
const PALETTE = ["#8d8f45", "#a1624a", "#5f7f8c", "#9b7aa6", "#c08a3e", "#6e8f6a", "#b5586b", "#7b7355"];
const guestsOf = r => String(r.guests || "").split("\n").map(x => x.trim()).filter(Boolean);
const initials = n => n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
const colorOf = n => { let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const rawSeats = r => { const a = String(r.guests || "").split("\n").map(x => x.trim()); while (a.length && !a[a.length - 1]) a.pop(); return a; };
async function seatPlan(rows) {
  const M = ORG.seating; let sel = null;
  const wrap = el("section", { class: "seat-plan-wrap" });
  const hint = el("p", { class: "hint", text: "Glissez un invité sur une place (libre ou occupée : ils échangent) ou sur une autre table. Sur téléphone : touchez l'invité, puis la place. Déposez-le dans « À placer » pour le retirer." });
  const plan = el("div", { class: "seat-plan" });
  const pool = el("div", { class: "seat-pool", "data-pool": "1" }, el("b", { text: "À placer" }));
  const save = async (r, list) => { const a = list.slice(); while (a.length && !a[a.length - 1]) a.pop(); const v = a.join("\n"); await orgStore.update(M.table, r.id, { guests: v }); r.guests = v; };
  const byId = id => id ? rows.find(r => r.id === id) : null;
  // déplacement : de (table, place) vers (table, place) ; place = null → à la suite de la table
  async function place(from, fromIdx, name, toId, toIdx) {
    const src = byId(from), dst = byId(toId);
    if (!src && !dst) return;
    try {
      if (src && dst && src.id === dst.id) {
        if (toIdx == null || toIdx === fromIdx) return;
        const a = rawSeats(src); while (a.length <= Math.max(fromIdx, toIdx)) a.push("");
        [a[fromIdx], a[toIdx]] = [a[toIdx], a[fromIdx]]; await save(src, a);
      } else {
        const a = src ? rawSeats(src) : null, b = dst ? rawSeats(dst) : null; let swapped = "";
        if (b) {
          let at = toIdx;
          if (at == null) { at = b.findIndex((x, k) => !x && k < (Number(dst.capacity) || 0)); if (at < 0) at = b.length; }
          while (b.length <= at) b.push("");
          swapped = b[at]; b[at] = name;
        }
        if (a) { a[fromIdx != null ? fromIdx : a.indexOf(name)] = swapped; }
        if (a) await save(src, a);
        if (b) await save(dst, b);
      }
      renderOrg("seating");
    } catch (e) { showToast(orgErr(e)); }
  }
  const avatar = (name, fromId, over, idx) => {
    const a = el("button", { type: "button", class: "av" + (over ? " over" : ""), draggable: "true", title: name, "aria-label": name + (fromId ? " (cliquer pour déplacer)" : " (à placer)") },
      el("i", { text: initials(name), style: "background:" + colorOf(name) }), el("span", { text: name.split(/\s+/)[0] }));
    a.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", JSON.stringify({ from: fromId, idx, name })); e.dataTransfer.effectAllowed = "move"; });
    a.addEventListener("click", e => {
      e.stopPropagation();
      if (sel && !(sel.name === name && sel.from === fromId)) { const s0 = sel; sel = null; if (fromId) place(s0.from, s0.idx, s0.name, fromId, idx); return; }   // 2e clic sur un invité : échange de places
      sel = sel && sel.name === name && sel.from === fromId ? null : { from: fromId, idx, name };
      document.querySelectorAll(".av.sel").forEach(x => x.classList.remove("sel")); if (sel) a.classList.add("sel");
      hint.textContent = sel ? name + " : touchez maintenant la place libre, un autre invité (pour échanger) ou une table." : "Glissez un invité sur une place (libre ou occupée : ils échangent) ou sur une autre table. Sur téléphone : touchez l'invité, puis la place. Déposez-le dans « À placer » pour le retirer.";
    });
    return a;
  };
  const zone = (node, toId, toIdx) => {
    node.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); node.classList.add("drop"); });
    node.addEventListener("dragleave", () => node.classList.remove("drop"));
    node.addEventListener("drop", e => { e.preventDefault(); e.stopPropagation(); node.classList.remove("drop"); try { const d = JSON.parse(e.dataTransfer.getData("text/plain")); place(d.from, d.idx, d.name, toId, toIdx); } catch {} });
    node.addEventListener("click", e => { e.stopPropagation(); if (sel) { const s0 = sel; sel = null; place(s0.from, s0.idx, s0.name, toId, toIdx); } });
  };
  const placed = new Set();
  rows.forEach(r => {
    const g = rawSeats(r), cap = Number(r.capacity) || 0, n = Math.max(cap, g.length), R = 96, rect = r.shape === "Rectangulaire", W = rect ? 336 : 280, H = rect ? 232 : 280, count = g.filter(Boolean).length;
    g.filter(Boolean).forEach(x => placed.add(norm(x)));
    const t = el("div", { class: "seat-table" + (rect ? " rect" : "") + (count > cap && cap ? " full" : ""), style: "width:" + W + "px;height:" + H + "px" },
      el("div", { class: "t-disc" }, el("b", { text: r.name }), el("span", { text: count + " / " + (cap || "?") })));
    for (let i = 0; i < n; i++) {
      let x, y, topRow = false;
      if (rect) {
        const top = Math.ceil(n / 2), bot = n - top, onTop = i < top, k = onTop ? i : i - top, cnt = onTop ? top : bot, sp = Math.min(60, (W - 70) / Math.max(1, cnt));
        x = W / 2 + (onTop ? (k - (cnt - 1) / 2) : ((cnt - 1) / 2 - k)) * sp; y = H / 2 + (onTop ? -62 : 62); topRow = onTop;
      } else { const ang = -Math.PI / 2 + i * 2 * Math.PI / n; x = W / 2 + R * Math.cos(ang); y = H / 2 + R * Math.sin(ang); }
      const seat = el("div", { class: "seat" + (topRow ? " top" : ""), style: "left:" + x + "px;top:" + y + "px" });
      if (g[i]) seat.append(avatar(g[i], r.id, cap && i >= cap, i)); else seat.append(el("i", { class: "empty-seat", "aria-hidden": "true" }));
      zone(seat, r.id, i); t.append(seat);
    }
    zone(t, r.id, null); plan.append(t);
  });
  // invités ayant répondu « oui » mais pas encore placés
  let names = [];
  try { const gl = await orgStore.list("org_guests"); names = [...new Set(sortRows("guests", gl).filter(x => x.presence !== "NON").map(x => ((x.prenom || "") + " " + (x.nom || "")).trim()).filter(Boolean))]; } catch {}
  if (!names.length) { let rep = []; try { rep = await store.listResponses(); } catch {} names = [...new Set(rep.filter(x => x.presence !== "non").map(x => ((x.prenom || "") + " " + (x.nom || "")).trim()).filter(Boolean))]; }
  const left = names.filter(n => !placed.has(norm(n)));
  const chips = el("div", { class: "pool-chips" }, ...left.map(n => avatar(n, null)));
  pool.append(chips, left.length ? "" : el("small", { text: names.length ? "Tout le monde est placé 🎉" : "Les invités qui confirment leur présence apparaîtront ici." }));
  zone(pool, null);
  wrap.append(titled("h3", "cat", "Agneau couché", "Schéma des tables", 30), hint, pool, plan);
  return wrap;
}


let orgTok = 0;
async function renderOrg(key) {
  const tok = ++orgTok;
  orgState.key = key;
  document.querySelectorAll("[data-org]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.org === key)));
  const host = $("#org-body"); host.replaceChildren();
  if (key === "notes") return renderNotes(host, () => tok === orgTok);
  const M = ORG[key]; let rows = [];
  try { rows = await orgStore.list(M.table); } catch (e) { host.append(el("p", { class: "msg err", text: "Impossible de charger : " + explainErr(e) + " Exécutez supabase-tout-en-un.sql dans Supabase." })); return; }
  if (tok !== orgTok) return;
  rows = sortRows(key, rows);
  M.fields.filter(f => f.t === "select").forEach(f => rows.forEach(r => { if (r[f.k] && !f.o.includes(r[f.k])) f.o.push(r[f.k]); }));
  host.append(orgSummary(key, rows));

  // barre d'outils : filtres (tâches) et modèle
  const bar = el("div", { class: "org-tools" });
  if (key === "tasks") {
    const st = el("select", { "aria-label": "Afficher" }, el("option", { value: "all", text: "Toutes" }), el("option", { value: "todo", text: "À faire" }), el("option", { value: "done", text: "Faites" })); st.value = orgState.filter.status;
    const ct = el("select", { "aria-label": "Catégorie" }, el("option", { value: "", text: "Toutes les catégories" }), ...ORG.tasks.fields.find(f => f.k === "cat").o.map(c => el("option", { value: c, text: c }))); ct.value = orgState.filter.cat;
    st.addEventListener("change", () => { orgState.filter.status = st.value; renderOrg(key); }); ct.addEventListener("change", () => { orgState.filter.cat = ct.value; renderOrg(key); });
    bar.append(st, ct);
  }
  let guestFilter = () => {};
  if (key === "guests") {
    const gp = el("select", { "aria-label": "Présence" }, ...[["", "Tous les invités"], ["ATT", "En attente"], ["OUI", "Présents"], ["NON", "Absents"], ["ALL", "Avec allergie"]].map(([v, t]) => el("option", { value: v, text: t }))); gp.value = orgState.filter.gp;
    const gq = el("input", { type: "search", placeholder: "Rechercher un invité…", "aria-label": "Rechercher un invité", style: "max-width:260px;min-height:38px;padding:4px 10px;font-size:var(--fs-small)" }); gq.value = orgState.filter.gq;
    guestFilter = () => { orgState.filter.gp = gp.value; orgState.filter.gq = gq.value; const q = norm(gq.value); document.querySelectorAll("#org-body tr[data-q]").forEach(tr => { const okP = !gp.value || (gp.value === "ALL" ? tr.dataset.a === "1" : tr.dataset.p === gp.value), okQ = !q || tr.dataset.q.includes(q); tr.hidden = !(okP && okQ); }); };
    gp.addEventListener("change", guestFilter); gq.addEventListener("input", guestFilter);
    bar.append(gp, gq);
  }
  host.append(bar);

  if (key === "seating" && rows.length) { const sp = await seatPlan(rows); if (tok !== orgTok) return; host.append(sp); }

  // formulaire d'ajout
  const form = el("form", { class: "card org-add", novalidate: true });
  const inputs = {};
  const grid = el("div", { class: "org-grid" });
  M.fields.filter(f => f.t !== "check").forEach(f => { const inp = fieldInput(f, M.defaults[f.k]); inputs[f.k] = inp; grid.append(el("label", { class: f.wide ? "wide" : "" }, el("span", { text: f.l }), inp)); });
  const msg = el("p", { class: "msg", role: "status", hidden: true });
  form.append(el("h3", { text: "Ajouter" }), grid, el("button", { class: "btn solid small", type: "submit", text: "Ajouter" }), msg);
  form.addEventListener("submit", async ev => {
    ev.preventDefault();
    const row = { ...M.defaults };
    for (const f of M.fields) if (inputs[f.k]) row[f.k] = readInput(f, inputs[f.k]);
    const miss = M.fields.find(f => f.req && (row[f.k] == null || row[f.k] === ""));
    if (miss) return showMsg(msg, "Renseignez : " + miss.l + ".", "err");
    if (key === "seating") row.position = rows.length;
    if (key === "guests") row.position = rows.reduce((m, r) => Math.max(m, r.position || 0), 0) + 1;
    try { await orgStore.insert(M.table, row); renderOrg(key); } catch (e) { showMsg(msg, orgErr(e), "err"); }
  });
  const addBox = el("details", { class: "org-addbox" }, el("summary", {}, icon("Plus", 22), " Ajouter (" + M.label.toLowerCase() + ")"), form);
  host.append(addBox);

  // tableau modifiable
  let shown = rows;
  if (key === "tasks") shown = rows.filter(r => (orgState.filter.status === "all" || (orgState.filter.status === "done" ? r.done : !r.done)) && (!orgState.filter.cat || r.cat === orgState.filter.cat));
  if (!shown.length) { host.append(el("div", { class: "empty-ico" }, icon("Agneau couché", 44)), el("p", { class: "empty", text: rows.length ? "Aucune ligne avec ce filtre." : "Rien pour l'instant. Ajoutez une première ligne avec « Ajouter »." })); return; }
  if (key === "vendors" || key === "seating" || key === "budget") {
    const list = el("div", { class: "org-cards" });
    const bar2 = el("div", { class: "org-fold" },
      el("button", { class: "btn small", type: "button", text: "Tout déplier", onclick: () => list.querySelectorAll("details.org-card").forEach(d => { d.open = true; }) }),
      el("button", { class: "btn small", type: "button", text: "Tout replier", onclick: () => list.querySelectorAll("details.org-card").forEach(d => { d.open = false; }) }));
    host.append(bar2);
    let lastCat = null;
    const badge = st => { const c = RETAINED.includes(st) ? "ok" : st === "Refusé (NON)" ? "no" : /attente|donner/i.test(st || "") ? "wait" : ""; return el("span", { class: "st-badge " + c, text: st || "—" }); };
    const sumFor = r => {
      if (key === "vendors") return [el("b", { text: r.name }), badge(r.status), el("span", { class: "num", text: r.price != null ? eur(r.price) : "" }), el("span", { class: "sm", text: r.phone || r.email || r.contact || r.location || "" })];
      if (key === "budget") return [el("b", { text: r.item }), el("span", { class: "sm", text: r.family ? "famille " + eur(r.family) : "" }), el("span", { class: "num", text: "prévu " + eur(r.estimated || 0) }), el("span", { class: "num", text: "payé " + eur(r.paid || 0) })];
      const g = guestsOf(r).length; return [el("b", { text: r.name }), el("span", { class: "sm", text: r.shape || "Ronde" }), el("span", { class: "num", text: g + " / " + (r.capacity || "?") }), el("span", { class: "sm", text: "" })];
    };
    shown.forEach((r, i) => {
      if (key === "budget" && r.cat !== lastCat) { lastCat = r.cat; const inCat = rows.filter(x => x.cat === r.cat), sub = inCat.reduce((a, x) => a + (Number(x.estimated) || 0), 0), fam = inCat.reduce((a, x) => a + (Number(x.family) || 0), 0); list.append(el("h3", { class: "org-grp", text: (r.cat || "Sans poste") + " · " + eur(sub) + (fam ? " · dont famille " + eur(fam) : "") })); }
      if (key === "vendors" && r.role !== lastCat) { lastCat = r.role; list.append(el("h3", { class: "org-grp", text: (r.role || "Autre") + " · " + rows.filter(x => x.role === r.role).length })); }
      const card = el("details", { class: "card org-card" });
      if (orgOpen.has(r.id)) card.open = true;
      card.addEventListener("toggle", () => { if (card.open) orgOpen.add(r.id); else orgOpen.delete(r.id); });
      const head = el("summary", { class: "org-sum-row" }); const fill = () => head.replaceChildren(...sumFor(r)); fill();
      const g = el("div", { class: "org-grid" });
      M.fields.forEach(f => {
        const inp = fieldInput(f, r[f.k], r);
        inp.addEventListener("change", async () => {
          const v = readInput(f, inp);
          try { await orgStore.update(M.table, r.id, { [f.k]: v }); r[f.k] = v; fill(); setTimeout(() => { if (!card.contains(document.activeElement)) renderOrg(key); }, 200); } catch (e) { showToast(orgErr(e)); }
        });
        g.append(el("label", { class: f.wide ? "wide" : "" }, el("span", { text: f.l }), inp));
      });
      const acts = el("div", { class: "org-card-actions" });
      if (key === "seating") {
        const swap = async d => { const o = shown[i + d]; if (!o) return; try { await orgStore.update(M.table, r.id, { position: o.position }); await orgStore.update(M.table, o.id, { position: r.position }); renderOrg(key); } catch (e) { showToast(orgErr(e)); } };
        acts.append(el("button", { class: "btn small", type: "button", text: "▲", "aria-label": "Monter la table", disabled: i === 0, onclick: () => swap(-1) }), el("button", { class: "btn small", type: "button", text: "▼", "aria-label": "Descendre la table", disabled: i === shown.length - 1, onclick: () => swap(1) }));
      }
      acts.append(el("button", { class: "btn small danger", type: "button", text: "Supprimer", "aria-label": "Supprimer", onclick: async () => { try { await orgStore.remove(M.table, r.id); orgOpen.delete(r.id); renderOrg(key); } catch (e) { showToast(orgErr(e)); } } }));
      card.append(head, el("div", { class: "org-card-body" }, g, acts));
      list.append(card);
    });
    host.append(list);
    return;
  }
  const table = el("table", { class: "org-table" + (key === "guests" ? " guests" : "") });
  table.append(el("thead", {}, el("tr", {}, ...M.fields.map(f => el("th", { text: f.l })), ...(key === "seating" ? [el("th", { text: "Ordre" })] : []), el("th", {}))));
  const tb = el("tbody");
  let lastCat = null;
  shown.forEach(r => {
    if ((key === "budget" || key === "tasks") && (key === "budget" ? r.cat : null) !== null && r.cat !== lastCat) {
      lastCat = r.cat; const sub = rows.filter(x => x.cat === r.cat).reduce((a, x) => a + (Number(x.estimated) || 0), 0);
      tb.append(el("tr", { class: "grp" }, el("td", { colspan: String(M.fields.length + 1), text: r.cat + " · " + eur(sub) })));
    }
    const late = key === "tasks" && !r.done && r.due && r.due < todayISO();
    const tr = el("tr", { class: (late ? "late " : "") + (key === "tasks" && r.done ? "done" : "") + (key === "guests" ? " p-" + (r.presence || "ATT") : "") });
    if (key === "guests") { tr.dataset.q = norm((r.nom || "") + " " + (r.prenom || "")); tr.dataset.p = r.presence || "ATT"; tr.dataset.a = r.allergie && r.allergie.trim() ? "1" : "0"; }
    M.fields.forEach(f => {
      const inp = fieldInput(f, r[f.k]);
      inp.addEventListener("change", async () => {
        const v = readInput(f, inp);
        try { await orgStore.update(M.table, r.id, { [f.k]: v }); r[f.k] = v; if (key === "tasks" || key === "budget" || key === "seating" || (key === "guests" && (f.k === "presence" || f.k === "allergie" || f.k === "envoi" || f.k === "age"))) renderOrg(key); else showToast("Enregistré"); }
        catch (e) { showToast(orgErr(e)); }
      });
      tr.append(el("td", { "data-label": f.l }, inp));
    });
    if (key === "seating") {
      const i = shown.indexOf(r), swap = async d => { const o = shown[i + d]; if (!o) return; try { await orgStore.update(M.table, r.id, { position: o.position }); await orgStore.update(M.table, o.id, { position: r.position }); renderOrg(key); } catch (e) { showToast(orgErr(e)); } };
      tr.append(el("td", {}, el("button", { class: "btn small", type: "button", text: "▲", "aria-label": "Monter la table", disabled: i === 0, onclick: () => swap(-1) }), " ", el("button", { class: "btn small", type: "button", text: "▼", "aria-label": "Descendre la table", disabled: i === shown.length - 1, onclick: () => swap(1) })));
    }
    tr.append(el("td", {}, el("button", { class: "btn small danger", type: "button", text: "Supprimer", "aria-label": "Supprimer la ligne", onclick: async () => {
      try { await orgStore.remove(M.table, r.id); renderOrg(key); } catch (e) { showToast(orgErr(e)); }
    } })));
    tb.append(tr);
  });
  table.append(tb); guestFilter();
  host.append(el("div", { class: "tbl org-wrap" }, table));
}

async function renderNotes(host, current) {
  let v = ""; try { v = await store.getSetting("org_notes"); } catch {}
  if (current && !current()) return;
  const ta = el("textarea", { class: "org-notes", rows: "16", placeholder: "Idées, numéros utiles, mots de passe de réservation à ne pas écrire ici, questions à poser au prêtre, listes en vrac…", "aria-label": "Notes" }); ta.value = v || "";
  const st = el("p", { class: "hint", text: "Enregistrement automatique quand vous quittez le champ." });
  ta.addEventListener("blur", async () => { try { await store.setSetting("org_notes", ta.value); st.textContent = "✓ Enregistré à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); } catch (e) { st.textContent = "⚠ " + orgErr(e); } });
  host.append(titled("h3", "cat", "Rameau d'olivier", "Notes libres", 28), ta, st);
}

/* ---------------------------------------------------------------------------
   3. Photos : dépôt par les mariés, galerie publique après le mariage
   --------------------------------------------------------------------------- */
const photoUrl = path => remote.storage.from("photos").getPublicUrl(path).data.publicUrl;
async function listPhotos() { const { data, error } = await remote.from("photos").select("*"); if (error) throw error; return (data || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0) || String(a.created_at || "").localeCompare(String(b.created_at || ""))); }

async function resizeImage(file, max = 1800, q = .82) {
  let bmp = null;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { return null; }
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise(res => c.toBlob(b => res(b), "image/jpeg", q));
}

async function uploadPhotos(files, bucket, onProgress) {
  let ok = 0, fail = [];
  const existing = bucket === "photos" ? (await listPhotos().catch(() => [])) : [];
  let pos = existing.reduce((m, p) => Math.max(m, p.position || 0), 0);
  for (const [i, f] of [...files].entries()) {
    onProgress && onProgress(i + 1, files.length, f.name);
    try {
      const blob = await resizeImage(f);
      if (!blob) { fail.push(f.name + " (format non lisible par ce navigateur, enregistrez-la en JPEG)"); continue; }
      const path = Date.now() + "-" + Math.random().toString(36).slice(2, 8) + ".jpg";
      const up = await remote.storage.from(bucket).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
      if (up.error) throw up.error;
      if (bucket === "photos") { const { error } = await remote.from("photos").insert({ path, caption: null, position: ++pos }); if (error) throw error; }
      ok++;
    } catch (e) { fail.push(f.name + " (" + explainErr(e) + ")"); }
  }
  return { ok, fail };
}

async function renderPhotoAdmin() {
  const host = $("#photos-admin"); host.replaceChildren();
  let pub = "0"; try { pub = await store.getSetting("photos_public"); } catch {}
  let photos = []; try { photos = await listPhotos(); } catch (e) { host.append(el("p", { class: "msg err", text: "Photos indisponibles : " + explainErr(e) + " Exécutez supabase-tout-en-un.sql dans Supabase." })); return; }
  const isPub = pub === "1";
  host.append(
    el("div", { class: "card pub-card" + (isPub ? " on" : "") },
      el("div", {}, el("h3", { text: isPub ? "La galerie est visible sur le site" : "La galerie n'est pas encore publiée" }),
        el("p", { class: "hint", text: isPub ? "Les invités voient l'onglet « Photos ». Les onglets Logement, S'y rendre, Dress code et Chants sont masqués, puisque le mariage est passé." : "Déposez vos photos ci-dessous, puis publiez la galerie quand vous êtes prêts. L'onglet « Photos » apparaîtra pour tout le monde." })),
      el("button", { class: "btn " + (isPub ? "" : "solid"), type: "button", text: isPub ? "Retirer la galerie du site" : "Publier la galerie sur le site", onclick: async () => {
        try { await store.setSetting("photos_public", isPub ? "0" : "1"); showToast(isPub ? "Galerie retirée du site" : "Galerie publiée"); renderPhotoAdmin(); applyPostWedding(); } catch (e) { showToast(orgErr(e)); } } })));
  const drop = el("label", { class: "drop", for: "photo-input" }, el("b", { text: "Ajouter des photos" }), el("span", { text: "Cliquez ou glissez vos photos ici. Plusieurs à la fois. Elles sont allégées automatiquement." }));
  const input = el("input", { id: "photo-input", type: "file", accept: "image/*", multiple: true, hidden: true });
  const status = el("p", { class: "hint", role: "status" });
  const go = async files => {
    if (!files.length) return;
    const r = await uploadPhotos(files, "photos", (i, n, name) => { status.textContent = "Envoi " + i + " / " + n + " : " + name; });
    status.textContent = r.ok + " photo(s) ajoutée(s)." + (r.fail.length ? " Échecs : " + r.fail.join(" ; ") : "");
    renderPhotoAdmin().then(() => { const s = $("#photos-admin .hint[role=status]"); if (s) s.textContent = status.textContent; }); applyPostWedding();
  };
  input.addEventListener("change", () => go(input.files));
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); }); drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); go([...e.dataTransfer.files].filter(f => f.type.startsWith("image/"))); });
  host.append(drop, input, status);
  if (!photos.length) { host.append(el("p", { class: "empty", text: "Aucune photo pour l'instant." })); return; }
  host.append(el("p", { class: "hint", text: photos.length + " photo(s). Les flèches changent l'ordre d'affichage." }));
  const grid = el("div", { class: "pg-admin" });
  photos.forEach((p, i) => {
    const cap = el("input", { type: "text", maxlength: "120", placeholder: "Légende (facultatif)", "aria-label": "Légende" }); cap.value = p.caption || "";
    cap.addEventListener("change", async () => { try { await orgStore.update("photos", p.id, { caption: cap.value.trim() || null }); showToast("Enregistré"); } catch (e) { showToast(orgErr(e)); } });
    const move = async d => { const q = photos[i + d]; if (!q) return; try { await orgStore.update("photos", p.id, { position: q.position }); await orgStore.update("photos", q.id, { position: p.position }); renderPhotoAdmin(); } catch (e) { showToast(orgErr(e)); } };
    grid.append(el("figure", { class: "pg-item" },
      el("img", { src: photoUrl(p.path), alt: p.caption || "Photo du mariage", loading: "lazy" }), cap,
      el("div", { class: "pg-actions" },
        el("button", { class: "btn small", type: "button", text: "◀", "aria-label": "Avancer", disabled: i === 0, onclick: () => move(-1) }),
        el("button", { class: "btn small", type: "button", text: "▶", "aria-label": "Reculer", disabled: i === photos.length - 1, onclick: () => move(1) }),
        el("button", { class: "btn small danger", type: "button", text: "Supprimer", onclick: async () => {
          try { await remote.storage.from("photos").remove([p.path]); await orgStore.remove("photos", p.id); renderPhotoAdmin(); applyPostWedding(); } catch (e) { showToast(orgErr(e)); } } }))));
  });
  host.append(grid);
}

/* Galerie publique + visionneuse */
let galleryPhotos = [], lbIndex = 0;
function renderGallery() {
  const g = $("#gallery"); if (!g) return; g.replaceChildren();
  galleryPhotos.forEach((p, i) => g.append(el("button", { class: "gal-item", type: "button", "aria-label": "Agrandir la photo " + (i + 1), onclick: () => openLightbox(i) },
    el("img", { src: photoUrl(p.path), alt: p.caption || "Photo du mariage de Cassiana et Matthieu", loading: "lazy", decoding: "async" }))));
}
function openLightbox(i) {
  lbIndex = i; let lb = $("#lightbox");
  if (!lb) {
    lb = el("div", { id: "lightbox", role: "dialog", "aria-modal": "true", "aria-label": "Photo agrandie" },
      el("button", { class: "lb-close", type: "button", "aria-label": "Fermer", text: "×", onclick: closeLightbox }),
      el("button", { class: "lb-nav prev", type: "button", "aria-label": "Photo précédente", text: "‹", onclick: () => stepLightbox(-1) }),
      el("figure", {}, el("img", { alt: "" }), el("figcaption", {})),
      el("button", { class: "lb-nav next", type: "button", "aria-label": "Photo suivante", text: "›", onclick: () => stepLightbox(1) }));
    lb.addEventListener("click", e => { if (e.target === lb) closeLightbox(); });
    document.body.append(lb);
  }
  const p = galleryPhotos[lbIndex]; $("img", lb).src = photoUrl(p.path); $("img", lb).alt = p.caption || "Photo du mariage"; $("figcaption", lb).textContent = p.caption || "";
  lb.classList.add("open"); document.body.classList.add("lb-open"); $(".lb-close", lb).focus();
}
function stepLightbox(d) { if (!galleryPhotos.length) return; openLightbox((lbIndex + d + galleryPhotos.length) % galleryPhotos.length); }
function closeLightbox() { const lb = $("#lightbox"); if (lb) lb.classList.remove("open"); document.body.classList.remove("lb-open"); }
document.addEventListener("keydown", e => { const lb = $("#lightbox"); if (!lb || !lb.classList.contains("open")) return; if (e.key === "Escape") closeLightbox(); if (e.key === "ArrowLeft") stepLightbox(-1); if (e.key === "ArrowRight") stepLightbox(1); });

/* Après le mariage : l'onglet Photos remplace les onglets pratiques */
async function applyPostWedding() {
  if (!remote) return;
  let pub = "0", photos = [];
  try { pub = await store.getSetting("photos_public"); } catch {}
  if (pub === "1") { try { photos = await listPhotos(); } catch {} }
  const on = pub === "1" && photos.length > 0;
  galleryPhotos = photos;
  document.body.classList.toggle("post", on);
  const li = $("#nav-photos"); if (li) li.hidden = !on;
  const cta = document.querySelector(".hero .cta a");
  if (cta) { cta.textContent = on ? "Voir les photos du mariage" : "Confirmer ma présence"; cta.setAttribute("href", on ? "#photos" : "#presence"); }
  if (on) { renderGallery(); if (location.hash === "#photos" && typeof route === "function") route(); }
  if (!on && location.hash === "#photos") location.hash = "#accueil";
}

/* ---------------------------------------------------------------------------
   4. Prière : Évangile du jour et images (espace privé)
   --------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
   Icônes dessinées (traits, sans fichier externe) : agneaux, colombe, croix, calice…
   --------------------------------------------------------------------------- */
const WOOL = (cs) => '<g class="wool">' + cs.map(([x, y, r]) => '<circle cx="' + x + '" cy="' + y + '" r="' + r + '"/>').join("") + '</g><g class="woolfill">' + cs.map(([x, y, r]) => '<circle cx="' + x + '" cy="' + y + '" r="' + (r - 1.1) + '"/>').join("") + "</g>";
const LAMB_BODY = [[15, 37, 7], [23, 30, 8], [33, 28, 9], [43, 32, 8], [44, 41, 7], [32, 41, 9], [21, 43, 7]];
const LEGS = '<path d="M22 49V59M32 50V59M40 49V59M47 46V59" class="ln"/>';
const HEAD = '<ellipse cx="55" cy="31" rx="5.5" ry="7" class="ln"/><path d="M52 26c-5-2-7 2-6 5" class="ln"/><circle cx="57" cy="29" r="1.1" class="dot"/>';
const ICONS = {
  "Agneau": WOOL(LAMB_BODY) + LEGS + HEAD,
  "Agneau pascal": WOOL(LAMB_BODY.map(([x, y, r]) => [x, y + 4, r])) + '<path d="M22 53V61M32 54V61M40 53V61M47 50V61" class="ln"/><ellipse cx="55" cy="35" rx="5.5" ry="7" class="ln"/><circle cx="57" cy="33" r="1.1" class="dot"/><path d="M46 8V32" class="ln"/><path d="M46 9l14 3-14 5z" class="ln"/><path d="M53 11v4M51 13h4" class="ln thin"/>',
  "Agneau couché": WOOL([[14, 44, 7], [22, 38, 8], [32, 36, 9], [43, 40, 8], [43, 48, 6], [32, 49, 8], [21, 50, 6]]) + '<path d="M16 56h34M44 54c3 1 5 2 8 2" class="ln"/><ellipse cx="54" cy="40" rx="5.5" ry="6.5" class="ln"/><path d="M51 35c-5-2-7 2-6 5" class="ln"/><circle cx="56" cy="38" r="1.1" class="dot"/>',
  "Cartes": '<rect x="9" y="14" width="30" height="42" rx="4" transform="rotate(-12 24 35)" class="ln"/><rect x="25" y="9" width="30" height="42" rx="4" transform="rotate(9 40 30)" class="ln"/><path d="M40 37c-6-4-9-7-9-10a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1c0 3-3 6-9 10z" class="ln thin" transform="rotate(9 40 30)"/>',
  "Alliances": '<circle cx="24" cy="40" r="15" class="ln"/><circle cx="40" cy="40" r="15" class="ln"/><circle cx="24" cy="40" r="11.5" class="ln thin"/><circle cx="40" cy="40" r="11.5" class="ln thin"/><path d="M32 14l5 6-5 6-5-6z" class="ln"/><path d="M27 20h10" class="ln thin"/>',
  "Musique": '<path d="M24 46V16l26-6v30" class="ln"/><path d="M24 24l26-6" class="ln"/><ellipse cx="18" cy="47" rx="7" ry="5.5" transform="rotate(-18 18 47)" class="ln"/><ellipse cx="44" cy="41" rx="7" ry="5.5" transform="rotate(-18 44 41)" class="ln"/>',
  "Soleil": '<circle cx="32" cy="32" r="9" class="ln"/><circle cx="32" cy="32" r="5.5" class="ln thin"/><path d="M32 6v10M32 48v10M6 32h10M48 32h10M13.6 13.6l7 7M43.4 43.4l7 7M50.4 13.6l-7 7M20.6 43.4l-7 7" class="ln"/><path d="M19 10.5l3.5 6M45 10.5l-3.5 6M19 53.5l3.5-6M45 53.5l-3.5-6M10.5 19l6 3.5M53.5 19l-6 3.5M10.5 45l6-3.5M53.5 45l-6-3.5" class="ln thin"/>',  "Croix": '<path d="M27 6h10v18h18v10H37v26H27V34H9V24h18z" class="ln"/><path d="M32 12v40M16 29h32" class="ln thin"/>',
  "Calice": '<path d="M16 14h32c0 14-5 22-16 22S16 28 16 14z" class="ln"/><path d="M32 36v12M22 56h20c0-5-4-8-10-8s-10 3-10 8z" class="ln"/><circle cx="32" cy="7" r="4.5" class="ln"/><path d="M32 4.5v5M29.5 7h5" class="ln thin"/>',
  "Poisson": '<path d="M6 32C20 12 38 14 46 32 38 50 20 52 6 32z" class="ln"/><path d="M46 32l14-12v24z" class="ln"/><circle cx="18" cy="29" r="1.6" class="dot"/><path d="M26 22c4 6 4 14 0 20M33 24c3 5 3 11 0 16" class="ln thin"/>',
  "Épi de blé": '<path d="M32 60V22" class="ln"/><g class="ln"><ellipse cx="25" cy="42" rx="4" ry="8" transform="rotate(-25 25 42)"/><ellipse cx="39" cy="42" rx="4" ry="8" transform="rotate(25 39 42)"/><ellipse cx="25" cy="29" rx="4" ry="8" transform="rotate(-25 25 29)"/><ellipse cx="39" cy="29" rx="4" ry="8" transform="rotate(25 39 29)"/><ellipse cx="32" cy="14" rx="4" ry="8"/></g>',
  "Rameau d'olivier": '<path d="M8 54C20 44 38 32 56 10" class="ln"/><g class="ln"><ellipse cx="20" cy="40" rx="3.5" ry="8" transform="rotate(50 20 40)"/><ellipse cx="30" cy="49" rx="3.5" ry="8" transform="rotate(-10 30 49)"/><ellipse cx="32" cy="31" rx="3.5" ry="8" transform="rotate(50 32 31)"/><ellipse cx="43" cy="39" rx="3.5" ry="8" transform="rotate(-5 43 39)"/><ellipse cx="45" cy="21" rx="3.5" ry="8" transform="rotate(50 45 21)"/><ellipse cx="55" cy="29" rx="3.5" ry="8" transform="rotate(5 55 29)"/></g>',
  "Plus": '<circle cx="32" cy="32" r="24" class="ln"/><path d="M32 20v24M20 32h24" class="ln"/>',
  "Bougie": '<path d="M23 26h18v32H23z" class="ln"/><path d="M32 26v-5" class="ln thin"/><path d="M32 4c6 6 8 10 8 13a8 8 0 0 1-16 0c0-3 2-7 8-13z" class="ln"/>'
};
const icon = (name, size) => { const s = el("span", { class: "ico", role: "img", "aria-label": name, title: name }); s.innerHTML = '<svg viewBox="0 0 64 64" width="' + (size || 56) + '" height="' + (size || 56) + '" aria-hidden="true">' + ICONS[name] + "</svg>"; return s; };
const titled = (tag, cls, name, text, size) => el(tag, { class: cls }, icon(name, size || 24), " ", text);
const iconRow = (names, size) => el("div", { class: "ico-row", "aria-hidden": "true" }, ...names.map(n => icon(n, size)));

async function renderPrayer() {
  const host = $("#pray-body"); host.replaceChildren();
  const verse = el("div", { class: "verse-card" }); host.append(verse);
  renderVerse(verse);
}

/* ---------------------------------------------------------------------------
   5. Aujourd'hui : accueil de l'espace mariés
   --------------------------------------------------------------------------- */
async function renderToday() {
  const host = $("#today-body"); host.replaceChildren();
  const days = daysBetween(todayISO(), WEDDING_ISO);
  host.append(el("div", { class: "today-head" },
    el("div", { class: "count" }, iconRow(["Agneau", "Soleil", "Croix"], 34), el("b", { text: days > 0 ? "J-" + days : days === 0 ? "C'est aujourd'hui !" : "Jour " + Math.abs(days) + " de vie à deux" }), el("span", { text: days > 0 ? "avant le mariage, le samedi 9 octobre 2027" : days === 0 ? "Que cette journée soit belle" : "depuis le mariage" })),
    el("div", { class: "verse-card" })));
  renderVerse($(".verse-card", host));
  const cols = el("div", { class: "today-cols" }); host.append(cols);
  try {
    const tasks = sortRows("tasks", await orgStore.list("org_tasks")).filter(t => !t.done).slice(0, 6);
    const gl = await orgStore.list("org_guests").catch(() => []);
    const rep = gl.length ? [] : await store.listResponses().catch(() => []);
    const oui = gl.length ? gl.filter(r => r.presence === "OUI").length : rep.filter(r => r.presence !== "non").length, non = gl.length ? gl.filter(r => r.presence === "NON").length : rep.filter(r => r.presence === "non").length, att = gl.filter(r => !r.presence || r.presence === "ATT").length;
    cols.append(
      el("div", { class: "card" }, el("h3", { text: "À faire bientôt" }), tasks.length
        ? el("ul", { class: "today-list" }, ...tasks.map(t => el("li", { class: t.due && t.due < todayISO() ? "late" : "" }, el("span", { text: t.title }), el("small", { text: t.due ? frDate(t.due) : "sans date" }))))
        : el("p", { class: "hint", text: "Aucune tâche en attente. Chargez le rétroplanning type dans Organisation." }),
        el("button", { class: "btn small", type: "button", text: "Ouvrir les tâches", onclick: () => { showMain("org"); renderOrg("tasks"); } })),
      el("div", { class: "card" }, el("h3", { text: "Réponses des invités" }), el("p", { class: "bignum", text: oui + " présent" + (oui > 1 ? "s" : "") }), el("p", { class: "hint", text: non + " absent" + (non > 1 ? "s" : "") + (gl.length ? " · " + att + " en attente" : "") + " · date limite : 9 juillet 2027" }),
        el("button", { class: "btn small", type: "button", text: "Voir les invités", onclick: () => { showMain("org"); renderOrg("guests"); } })));
  } catch {}
}

/* ---------------------------------------------------------------------------
   6. Navigation de l'espace mariés
   --------------------------------------------------------------------------- */
const MAINS = ["today", "site", "org", "photos", "pray"];
function showMain(k) {
  MAINS.forEach(m => { const s = document.querySelector('[data-main-sec="' + m + '"]'); if (s) s.hidden = m !== k; });
  document.querySelectorAll("[data-main]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.main === k)));
  try { sessionStorage.setItem("mariage:main", k); } catch {}
  if (k === "today") renderToday();
  if (k === "org") renderOrg(orgState.key);
  if (k === "photos") renderPhotoAdmin();
  if (k === "pray") renderPrayer();
}
function buildAdminShell() {
  const panel = $("#admin-panel"); if (!panel || panel.dataset.shell) return; panel.dataset.shell = "1";
  const editCard = panel.querySelector(".edit-card"), logout = $("#logout"), rest = [...panel.children].filter(n => !n.classList.contains("admin-top"));
  panel.querySelector(".admin-top").remove();
  const site = el("section", { "data-main-sec": "site", hidden: true });
  site.append(editCard, ...rest);
  const nav = el("div", { class: "admin-main", role: "group", "aria-label": "Espaces" },
    ...[["today", "Aujourd'hui"], ["site", "Le site"], ["org", "Organisation"], ["photos", "Photos"], ["pray", "Prière"]].map(([k, l]) => el("button", { type: "button", "data-main": k, "aria-pressed": "false", text: l, onclick: () => showMain(k) })));
  const sortBtn = el("button", { type: "button", class: "link", id: "tab-sort", "aria-pressed": "false", title: "Changer l'ordre des onglets", text: "⇄ Réorganiser les onglets", onclick: () => { const on = !document.body.classList.contains("sorting"); document.body.classList.toggle("sorting", on); sortBtn.setAttribute("aria-pressed", String(on)); sortBtn.textContent = on ? "✓ Terminer" : "⇄ Réorganiser les onglets"; sortHint.hidden = !on; } });
  const sortHint = el("p", { class: "hint sort-hint", hidden: true, text: "Glissez un onglet à sa nouvelle place, ou utilisez ‹ › sur chaque onglet. L'ordre est enregistré." });
  const top = el("div", { class: "admin-bar2" }, nav, el("div", { class: "admin-bar-right" }, sortBtn, logout));
  const today = el("section", { "data-main-sec": "today" }, el("div", { id: "today-body" }));
  const org = el("section", { "data-main-sec": "org", hidden: true },
    el("div", { class: "admin-tabs", role: "group", "aria-label": "Organisation" },
      ...[["tasks", "Tâches"], ["guests", "Invités"], ["budget", "Budget"], ["games", "Jeux"], ["seating", "Plan de tables"], ["timeline", "Jour J"], ["notes", "Notes"]].map(([k, l]) => el("button", { type: "button", "data-org": k, "aria-pressed": "false", text: l, onclick: () => renderOrg(k) }))),
    el("div", { id: "org-body" }));
  const photos = el("section", { "data-main-sec": "photos", hidden: true }, titled("h3", "cat", "Rameau d'olivier", "Photos du mariage", 28), el("div", { id: "photos-admin" }));
  const pray = el("section", { "data-main-sec": "pray", hidden: true }, titled("h3", "cat", "Calice", "Prière du jour", 28), el("div", { id: "pray-body" }));
  const ICO = { today: "Soleil", site: "Croix", org: "Agneau", photos: "Rameau d'olivier", pray: "Calice" };
  nav.querySelectorAll("[data-main]").forEach(b => b.prepend(icon(ICO[b.dataset.main], 24)));
  const OICO = { tasks: "Bougie", budget: "Épi de blé", games: "Cartes", guests: "Alliances", seating: "Agneau couché", timeline: "Croix", notes: "Rameau d'olivier" };
  org.querySelectorAll("[data-org]").forEach(b => b.prepend(icon(OICO[b.dataset.org], 22)));
  const SICO = { al: "Épi de blé", so: "Musique", fq: "Bougie", gi: "Poisson" };
  site.querySelectorAll("[data-tab]").forEach(b => { if (SICO[b.dataset.tab]) b.prepend(icon(SICO[b.dataset.tab], 22)); });
  panel.replaceChildren(el("div", { class: "admin-orn" }, iconRow(["Croix"], 34)), top, sortHint, today, site, org, photos, pray);
  setupTabSorting(panel);
}

/* --- Onglets déplaçables (glisser-déposer ou flèches), ordre enregistré --- */
const TAB_GROUPS = [["main", ".admin-main", "data-main"], ["org", '[data-main-sec="org"] .admin-tabs', "data-org"], ["site", '[data-main-sec="site"] .admin-tabs', "data-tab"]];
function readTabOrder(panel) { const o = {}; TAB_GROUPS.forEach(([g, sel, attr]) => { const box = panel.querySelector(sel); if (box) o[g] = [...box.children].map(b => b.getAttribute(attr)); }); return o; }
let tabSaveTimer = null;
function saveTabOrder(panel) {
  const json = JSON.stringify(readTabOrder(panel));
  try { localStorage.setItem("mariage:tab-order", json); } catch {}
  clearTimeout(tabSaveTimer);
  tabSaveTimer = setTimeout(async () => { try { await store.setSetting("admin_tab_order", json); showToast("Ordre des onglets enregistré"); } catch {} }, 500);
}
async function setupTabSorting(panel) {
  // 1) applique l'ordre enregistré
  let saved = null;
  try { saved = JSON.parse((await store.getSetting("admin_tab_order")) || localStorage.getItem("mariage:tab-order") || "null"); } catch {}
  TAB_GROUPS.forEach(([g, sel, attr]) => {
    const box = panel.querySelector(sel); if (!box) return;
    if (saved && Array.isArray(saved[g])) { const rank = k => { const i = saved[g].indexOf(k); return i < 0 ? 999 : i; }; box.append(...[...box.children].map((b, i) => [b, i]).sort((a, c) => rank(a[0].getAttribute(attr)) - rank(c[0].getAttribute(attr)) || a[1] - c[1]).map(a => a[0])); }
  });
  // 2) rend les onglets déplaçables
  TAB_GROUPS.forEach(([g, sel, attr]) => {
    const box = panel.querySelector(sel); if (!box || box.dataset.sortable) return; box.dataset.sortable = "1";
    let drag = null; const clear = () => box.querySelectorAll(".drop-before,.drop-after").forEach(x => x.classList.remove("drop-before", "drop-after"));
    [...box.children].forEach(b => {
      b.draggable = true;
      [["‹", -1, "Déplacer à gauche"], ["›", 1, "Déplacer à droite"]].forEach(([t, d, lab]) => b.append(el("span", { class: "mv", role: "button", tabindex: "0", "aria-label": lab, text: t, onclick: e => {
        e.preventDefault(); e.stopPropagation();
        if (d < 0 && b.previousElementSibling) box.insertBefore(b, b.previousElementSibling); else if (d > 0 && b.nextElementSibling) box.insertBefore(b.nextElementSibling, b);
        saveTabOrder(panel);
      } })));
      b.addEventListener("dragstart", e => { drag = b; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.getAttribute(attr) || ""); b.classList.add("dragging"); });
      b.addEventListener("dragend", () => { b.classList.remove("dragging"); clear(); drag = null; });
      b.addEventListener("dragover", e => { if (!drag || drag === b) return; e.preventDefault(); const r = b.getBoundingClientRect(), before = e.clientX < r.left + r.width / 2; clear(); b.classList.add(before ? "drop-before" : "drop-after"); });
      b.addEventListener("drop", e => { e.preventDefault(); if (!drag || drag === b) return; const before = b.classList.contains("drop-before"); clear(); box.insertBefore(drag, before ? b : b.nextSibling); saveTabOrder(panel); });
    });
  });
}

/* Reprise automatique (une seule fois) du tableur Prestataires des mariés : prestataires, jeux et budget prévisionnel. */

/* Nettoyage unique : supprime les doublons créés par une double exécution et l'ancienne ligne générique du Clos du Colombier. */
async function dedupeOnce() {
  if ((await store.getSetting("dedupe_v1")) === "1") return;
  const clean = async (table, keyFn, extra) => {
    const rows = (await orgStore.list(table)).sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
    const seen = new Set();
    for (const r of rows) { if ((extra && extra(r)) || seen.has(keyFn(r))) await orgStore.remove(table, r.id); else seen.add(keyFn(r)); }
  };
  await clean("org_budget", r => norm(r.cat) + "|" + norm(r.item) + "|" + (r.estimated || 0));
  await clean("org_games", r => norm(r.name));
  await store.setSetting("dedupe_v1", "1");
}
/* Vide le budget une seule fois : les mariés le saisissent eux-mêmes. */
async function clearBudgetOnce() {
  if ((await store.getSetting("budget_cleared_v1")) === "1") return;
  const rows = await orgStore.list("org_budget");
  for (const r of rows) await orgStore.remove("org_budget", r.id);
  await store.setSetting("budget_cleared_v1", "1");
  if (rows.length && typeof orgState !== "undefined" && orgState.key === "budget" && !$("#org-body").closest("[hidden]")) renderOrg("budget");
}
let seeding = null;
function seedFromSheet() { return seeding || (seeding = seedInner().finally(() => { seeding = null; })); }
async function seedInner() {
  try {
    await clearBudgetOnce();
    if ((await store.getSetting("seed_sheet_v1")) === "1") { await dedupeOnce(); return; }
    const games = await orgStore.list("org_games"), gn = new Set(games.map(g => norm(g.name)));
    const addG = TPL.games().filter(g => !gn.has(norm(g.name)));
    if (addG.length) await orgStore.insert("org_games", addG);
    await store.setSetting("seed_sheet_v1", "1");
    await dedupeOnce();
    showToast("Vos prestataires, jeux et budget prévisionnel ont été repris de votre tableur.");
    if (typeof orgState !== "undefined" && !$("#org-body").closest("[hidden]")) renderOrg(orgState.key);
  } catch (e) { console.warn("Reprise du tableur :", e); }
}
function adminExtraRefresh() { seedFromSheet(); buildAdminShell(); const pc = $("#panel-connexion"); if (pc) pc.classList.add("wide"); let k = "today"; try { k = sessionStorage.getItem("mariage:main") || "today"; } catch {} showMain(MAINS.includes(k) ? k : "today"); }

buildAdminShell();
applyPostWedding();
if (!$("#admin-panel").hidden) adminExtraRefresh(); // l'espace s'est ouvert avant le chargement de ce fichier
