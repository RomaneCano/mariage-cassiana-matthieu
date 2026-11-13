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
      el("p", { class: "verse-day", text: (g.jour ? g.jour + " · " : "") + frDate(d) }),
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
const CATS_BUDGET = ["Lieu & réception", "Traiteur & boissons", "Cérémonie", "Tenues & beauté", "Décoration & fleurs", "Photo & vidéo", "Musique & animation", "Papeterie", "Transport", "Imprévus"];
const ROLES = ["Lieu", "Église", "Traiteur", "Photographe", "Vidéaste", "DJ / Musiciens", "Fleuriste", "Pâtissier", "Coiffure / Maquillage", "Voiture", "Hébergement", "Autre"];
const WHO = ["Cassiana", "Matthieu", "Les deux", "Autre"];

const ORG = {
  tasks: { table: "org_tasks", label: "Tâches", order: "due", defaults: { done: false, cat: CATS_TASK[0], who: "Les deux" }, fields: [
    { k: "done", l: "Fait", t: "check" }, { k: "title", l: "Tâche", t: "text", req: true, wide: true }, { k: "cat", l: "Catégorie", t: "select", o: CATS_TASK },
    { k: "due", l: "Échéance", t: "date" }, { k: "who", l: "Qui", t: "select", o: WHO }, { k: "notes", l: "Notes", t: "text" }] },
  budget: { table: "org_budget", label: "Budget", order: "cat", defaults: { cat: CATS_BUDGET[0] }, fields: [
    { k: "cat", l: "Poste", t: "select", o: CATS_BUDGET }, { k: "item", l: "Dépense", t: "text", req: true, wide: true },
    { k: "estimated", l: "Prévu (€)", t: "number" }, { k: "actual", l: "Réel (€)", t: "number" }, { k: "paid", l: "Payé (€)", t: "number" },
    { k: "vendor", l: "Prestataire", t: "text" }, { k: "notes", l: "Notes", t: "text" }] },
  vendors: { table: "org_vendors", label: "Prestataires", order: "created_at", defaults: { status: "À contacter", role: "Autre" }, fields: [
    { k: "name", l: "Nom", t: "text", req: true, wide: true }, { k: "role", l: "Rôle", t: "select", o: ROLES },
    { k: "status", l: "Statut", t: "select", o: ["À contacter", "Devis demandé", "Réservé", "Acompte versé", "Soldé"] },
    { k: "contact", l: "Contact", t: "text" }, { k: "phone", l: "Téléphone", t: "text" }, { k: "email", l: "E-mail", t: "text" },
    { k: "price", l: "Prix (€)", t: "number" }, { k: "deposit", l: "Acompte (€)", t: "number" }, { k: "notes", l: "Notes", t: "text" }] },
  seating: { table: "org_tables", label: "Plan de tables", order: "position", defaults: { capacity: 10 }, fields: [
    { k: "name", l: "Table", t: "text", req: true }, { k: "capacity", l: "Places", t: "number" },
    { k: "guests", l: "Invités (un par ligne)", t: "long", wide: true }, { k: "notes", l: "Notes", t: "text" }] },
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
    ["Lieu & réception", "Location du Clos du Colombier"], ["Lieu & réception", "Hébergement des mariés"],
    ["Traiteur & boissons", "Cocktail"], ["Traiteur & boissons", "Dîner"], ["Traiteur & boissons", "Boissons et vins"], ["Traiteur & boissons", "Pièce montée / gâteau"],
    ["Cérémonie", "Offrande à la paroisse"], ["Cérémonie", "Livrets de messe"], ["Cérémonie", "Chorale / musiciens"], ["Cérémonie", "Fleurs de l'église"],
    ["Tenues & beauté", "Robe de la mariée"], ["Tenues & beauté", "Costume du marié"], ["Tenues & beauté", "Alliances"], ["Tenues & beauté", "Coiffure et maquillage"],
    ["Décoration & fleurs", "Décoration de la salle"], ["Décoration & fleurs", "Bouquet de la mariée"], ["Photo & vidéo", "Photographe"], ["Photo & vidéo", "Vidéaste"],
    ["Musique & animation", "DJ / orchestre"], ["Papeterie", "Faire-part et enveloppes"], ["Papeterie", "Timbres"], ["Transport", "Voiture des mariés"], ["Transport", "Navettes invités"],
    ["Imprévus", "Imprévus (environ 5 % du budget)"]
  ].map(([cat, item]) => ({ cat, item })),
  vendors: () => [
    { name: "Le Clos du Colombier", role: "Lieu", status: "Réservé", notes: "Ferme de Malassise, D402, 77610 Fontenay-Trésigny" },
    { name: "Paroisse Notre-Dame des Ardents", role: "Église", status: "Réservé", notes: "1 rue du Docteur-Nodier, 77400 Lagny-sur-Marne" },
    { name: "Traiteur à choisir", role: "Traiteur", status: "À contacter" }, { name: "Photographe à choisir", role: "Photographe", status: "À contacter" },
    { name: "DJ ou musiciens à choisir", role: "DJ / Musiciens", status: "À contacter" }, { name: "Fleuriste à choisir", role: "Fleuriste", status: "À contacter" },
    { name: "Pâtissier à choisir", role: "Pâtissier", status: "À contacter" }, { name: "Coiffure et maquillage à choisir", role: "Coiffure / Maquillage", status: "À contacter" },
    { name: "Voiture des mariés à choisir", role: "Voiture", status: "À contacter" }
  ],
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

const orgState = { key: "tasks", filter: { status: "todo", cat: "" } };

function sortRows(key, rows) {
  const by = (f) => rows.slice().sort(f);
  if (key === "tasks") return by((a, b) => (a.done - b.done) || String(a.due || "9999").localeCompare(String(b.due || "9999")) || String(a.title).localeCompare(String(b.title)));
  if (key === "budget") return by((a, b) => CATS_BUDGET.indexOf(a.cat) - CATS_BUDGET.indexOf(b.cat) || String(a.item).localeCompare(String(b.item)));
  if (key === "seating") return by((a, b) => (a.position || 0) - (b.position || 0) || String(a.name).localeCompare(String(b.name), "fr", { numeric: true }));
  if (key === "timeline") { const k = t => { const [h, m] = String(t || "99:00").split(":").map(Number); return (h < 6 ? h + 24 : h) * 60 + (m || 0); }; return by((a, b) => k(a.time) - k(b.time)); }
  return by((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function fieldInput(f, value) {
  let inp;
  if (f.t === "select") { inp = el("select", {}, ...["", ...f.o].map(o => el("option", { value: o, text: o || "—" }))); inp.value = value || ""; }
  else if (f.t === "check") { inp = el("input", { type: "checkbox" }); inp.checked = !!value; }
  else if (f.t === "long") { inp = el("textarea", { rows: "3" }); inp.value = value || ""; }
  else { inp = el("input", { type: f.t === "number" ? "number" : f.t === "date" ? "date" : f.t === "time" ? "time" : "text", step: f.t === "number" ? "any" : null }); inp.value = value == null ? "" : value; }
  inp.setAttribute("aria-label", f.l);
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
    const s = f => rows.reduce((a, r) => a + (Number(r[f]) || 0), 0), est = s("estimated"), act = s("actual"), paid = s("paid"), total = act || est;
    chip("prévu", eur(est)); chip("réel", eur(act)); chip("payé", eur(paid)); chip("reste à payer", eur(Math.max(0, total - paid)), total - paid > 0 ? "warn" : "");
  } else if (key === "vendors") {
    const c = st => rows.filter(r => r.status === st).length;
    chip("à contacter", String(c("À contacter"))); chip("devis", String(c("Devis demandé"))); chip("réservés", String(c("Réservé") + c("Acompte versé"))); chip("soldés", String(c("Soldé")));
    chip("prix cumulés", eur(rows.reduce((a, r) => a + (Number(r.price) || 0), 0)));
  } else if (key === "seating") {
    const placed = rows.reduce((a, r) => a + String(r.guests || "").split("\n").filter(x => x.trim()).length, 0), cap = rows.reduce((a, r) => a + (Number(r.capacity) || 0), 0);
    chip("tables", String(rows.length)); chip("invités placés", String(placed)); chip("places", String(cap), cap && placed > cap ? "warn" : "");
  } else if (key === "timeline") chip("étapes", String(rows.length));
  return box;
}

async function renderOrg(key) {
  orgState.key = key;
  document.querySelectorAll("[data-org]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.org === key)));
  const host = $("#org-body"); host.replaceChildren();
  if (key === "notes") return renderNotes(host);
  const M = ORG[key]; let rows = [];
  try { rows = await orgStore.list(M.table); } catch (e) { host.append(el("p", { class: "msg err", text: "Impossible de charger : " + explainErr(e) + " Exécutez supabase-tout-en-un.sql dans Supabase." })); return; }
  rows = sortRows(key, rows);
  host.append(orgSummary(key, rows));

  // barre d'outils : filtres (tâches) et modèle
  const bar = el("div", { class: "org-tools" });
  if (key === "tasks") {
    const st = el("select", { "aria-label": "Afficher" }, el("option", { value: "all", text: "Toutes" }), el("option", { value: "todo", text: "À faire" }), el("option", { value: "done", text: "Faites" })); st.value = orgState.filter.status;
    const ct = el("select", { "aria-label": "Catégorie" }, el("option", { value: "", text: "Toutes les catégories" }), ...CATS_TASK.map(c => el("option", { value: c, text: c }))); ct.value = orgState.filter.cat;
    st.addEventListener("change", () => { orgState.filter.status = st.value; renderOrg(key); }); ct.addEventListener("change", () => { orgState.filter.cat = ct.value; renderOrg(key); });
    bar.append(st, ct);
  }
  const tplBtn = el("button", { class: "btn small", type: "button", text: rows.length ? "Compléter avec le modèle type" : "Charger le modèle type", onclick: async () => {
    const have = new Set(rows.map(r => String(r.title || r.item || r.name || r.time + r.title)));
    const add = TPL[key]().filter(r => !have.has(String(r.title || r.item || r.name || r.time + r.title)));
    if (!add.length) return showToast("Le modèle est déjà entièrement chargé.");
    try { await orgStore.insert(M.table, add); showToast(add.length + " ligne(s) ajoutée(s)"); renderOrg(key); } catch (e) { showToast(orgErr(e)); }
  } });
  bar.append(tplBtn);
  host.append(bar);

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
    try { await orgStore.insert(M.table, row); renderOrg(key); } catch (e) { showMsg(msg, orgErr(e), "err"); }
  });
  host.append(form);

  // tableau modifiable
  let shown = rows;
  if (key === "tasks") shown = rows.filter(r => (orgState.filter.status === "all" || (orgState.filter.status === "done" ? r.done : !r.done)) && (!orgState.filter.cat || r.cat === orgState.filter.cat));
  if (!shown.length) { host.append(el("p", { class: "empty", text: rows.length ? "Aucune ligne avec ce filtre." : "Rien pour l'instant. Utilisez « Charger le modèle type » ou ajoutez une première ligne." })); return; }
  const table = el("table", { class: "org-table" });
  table.append(el("thead", {}, el("tr", {}, ...M.fields.map(f => el("th", { text: f.l })), el("th", {}))));
  const tb = el("tbody");
  let lastCat = null;
  shown.forEach(r => {
    if ((key === "budget" || key === "tasks") && (key === "budget" ? r.cat : null) !== null && r.cat !== lastCat) {
      lastCat = r.cat; const sub = rows.filter(x => x.cat === r.cat).reduce((a, x) => a + (Number(x.actual) || Number(x.estimated) || 0), 0);
      tb.append(el("tr", { class: "grp" }, el("td", { colspan: String(M.fields.length + 1), text: r.cat + " · " + eur(sub) })));
    }
    const late = key === "tasks" && !r.done && r.due && r.due < todayISO();
    const tr = el("tr", { class: (late ? "late " : "") + (key === "tasks" && r.done ? "done" : "") });
    M.fields.forEach(f => {
      const inp = fieldInput(f, r[f.k]);
      inp.addEventListener("change", async () => {
        const v = readInput(f, inp);
        try { await orgStore.update(M.table, r.id, { [f.k]: v }); r[f.k] = v; if (key === "tasks" || key === "budget" || key === "seating") renderOrg(key); else showToast("Enregistré"); }
        catch (e) { showToast(orgErr(e)); }
      });
      tr.append(el("td", { "data-label": f.l }, inp));
    });
    tr.append(el("td", {}, el("button", { class: "btn small danger", type: "button", text: "Supprimer", "aria-label": "Supprimer la ligne", onclick: async () => {
      try { await orgStore.remove(M.table, r.id); renderOrg(key); } catch (e) { showToast(orgErr(e)); }
    } })));
    tb.append(tr);
  });
  table.append(tb);
  host.append(el("div", { class: "tbl org-wrap" }, table));
}

async function renderNotes(host) {
  let v = ""; try { v = await store.getSetting("org_notes"); } catch {}
  const ta = el("textarea", { class: "org-notes", rows: "16", placeholder: "Idées, numéros utiles, mots de passe de réservation à ne pas écrire ici, questions à poser au prêtre, listes en vrac…", "aria-label": "Notes" }); ta.value = v || "";
  const st = el("p", { class: "hint", text: "Enregistrement automatique quand vous quittez le champ." });
  ta.addEventListener("blur", async () => { try { await store.setSetting("org_notes", ta.value); st.textContent = "✓ Enregistré à " + new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); } catch (e) { st.textContent = "⚠ " + orgErr(e); } });
  host.append(el("h3", { class: "cat", text: "Notes libres" }), ta, st);
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
const COMMONS = f => "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(f) + "?width=900";
const SACRED = [
  { f: "Christ Pantocrator Deesis mosaic Hagia Sophia.jpg", c: "Christ Pantocrator, mosaïque de la Déisis, Sainte-Sophie (XIIIe siècle). Domaine public, via Wikimedia Commons." },
  { f: "\"The good Shepherd\" mosaic - Mausoleum of Galla Placidia.jpg", c: "Le Bon Pasteur, mosaïque du mausolée de Galla Placidia, Ravenne (Ve siècle). Photo : Petar Milošević, CC BY-SA 4.0, via Wikimedia Commons." }
];
async function renderPrayer() {
  const host = $("#pray-body"); host.replaceChildren();
  const verse = el("div", { class: "verse-card" }); host.append(verse);
  renderVerse(verse);
  host.append(el("h3", { class: "cat", text: "Images" }), el("p", { class: "hint", text: "Cet espace est privé : rien de ce qui se trouve ici n'apparaît sur le site public." }));
  const grid = el("div", { class: "pray-grid" });
  SACRED.forEach(s => { const img = el("img", { src: COMMONS(s.f), alt: s.c.split(".")[0], loading: "lazy", referrerpolicy: "no-referrer" }); const fig = el("figure", { class: "pray-item" }, img, el("figcaption", { text: s.c })); img.addEventListener("error", () => fig.remove()); grid.append(fig); });
  host.append(grid);
  // images privées déposées par les mariés
  const mine = el("div", { class: "pray-mine" }); host.append(el("h3", { class: "cat", text: "Vos images" }));
  const drop = el("label", { class: "drop", for: "pray-input" }, el("b", { text: "Ajouter une image" }), el("span", { text: "Une icône, une image de Jésus, de la Vierge, une prière… Privé, visible uniquement ici." }));
  const input = el("input", { id: "pray-input", type: "file", accept: "image/*", multiple: true, hidden: true });
  const status = el("p", { class: "hint", role: "status" });
  input.addEventListener("change", async () => { const r = await uploadPhotos(input.files, "prive", (i, n, name) => { status.textContent = "Envoi " + i + " / " + n + " : " + name; }); status.textContent = r.ok + " image(s) ajoutée(s)." + (r.fail.length ? " Échecs : " + r.fail.join(" ; ") : ""); loadMine(); });
  host.append(drop, input, status, mine);
  async function loadMine() {
    mine.replaceChildren();
    const { data, error } = await remote.storage.from("prive").list("", { limit: 100, sortBy: { column: "created_at", order: "desc" } });
    if (error) { mine.append(el("p", { class: "msg err", text: "Espace privé indisponible : " + explainErr(error) + " Exécutez supabase-tout-en-un.sql dans Supabase." })); return; }
    const files = (data || []).filter(f => f.name && !f.name.startsWith("."));
    if (!files.length) { mine.append(el("p", { class: "empty", text: "Aucune image pour l'instant." })); return; }
    const { data: urls } = await remote.storage.from("prive").createSignedUrls(files.map(f => f.name), 3600);
    const g = el("div", { class: "pray-grid" });
    files.forEach((f, i) => { const u = urls && urls[i] && urls[i].signedUrl; if (!u) return;
      g.append(el("figure", { class: "pray-item" }, el("img", { src: u, alt: "Image privée", loading: "lazy" }),
        el("button", { class: "btn small danger", type: "button", text: "Supprimer", onclick: async () => { await remote.storage.from("prive").remove([f.name]); loadMine(); } }))); });
    mine.append(g);
  }
  loadMine();
}

/* ---------------------------------------------------------------------------
   5. Aujourd'hui : accueil de l'espace mariés
   --------------------------------------------------------------------------- */
async function renderToday() {
  const host = $("#today-body"); host.replaceChildren();
  const days = daysBetween(todayISO(), WEDDING_ISO);
  host.append(el("div", { class: "today-head" },
    el("div", { class: "count" }, el("b", { text: days > 0 ? "J-" + days : days === 0 ? "C'est aujourd'hui !" : "Jour " + Math.abs(days) + " de vie à deux" }), el("span", { text: days > 0 ? "avant le mariage, le samedi 9 octobre 2027" : days === 0 ? "Que cette journée soit belle" : "depuis le mariage" })),
    el("div", { class: "verse-card" })));
  renderVerse($(".verse-card", host));
  const cols = el("div", { class: "today-cols" }); host.append(cols);
  try {
    const tasks = sortRows("tasks", await orgStore.list("org_tasks")).filter(t => !t.done).slice(0, 6);
    const rep = await store.listResponses().catch(() => []);
    const oui = rep.filter(r => r.presence !== "non").length, non = rep.filter(r => r.presence === "non").length;
    cols.append(
      el("div", { class: "card" }, el("h3", { text: "À faire bientôt" }), tasks.length
        ? el("ul", { class: "today-list" }, ...tasks.map(t => el("li", { class: t.due && t.due < todayISO() ? "late" : "" }, el("span", { text: t.title }), el("small", { text: t.due ? frDate(t.due) : "sans date" }))))
        : el("p", { class: "hint", text: "Aucune tâche en attente. Chargez le rétroplanning type dans Organisation." }),
        el("button", { class: "btn small", type: "button", text: "Ouvrir les tâches", onclick: () => { showMain("org"); renderOrg("tasks"); } })),
      el("div", { class: "card" }, el("h3", { text: "Réponses des invités" }), el("p", { class: "bignum", text: oui + " présent" + (oui > 1 ? "s" : "") }), el("p", { class: "hint", text: non + " absent" + (non > 1 ? "s" : "") + " · date limite : 9 juillet 2027" }),
        el("button", { class: "btn small", type: "button", text: "Voir les réponses", onclick: () => { showMain("site"); document.querySelector('[data-tab="al"]').click(); } })));
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
  const top = el("div", { class: "admin-bar2" }, nav, logout);
  const today = el("section", { "data-main-sec": "today" }, el("div", { id: "today-body" }));
  const org = el("section", { "data-main-sec": "org", hidden: true },
    el("div", { class: "admin-tabs", role: "group", "aria-label": "Organisation" },
      ...[["tasks", "Tâches"], ["budget", "Budget"], ["vendors", "Prestataires"], ["seating", "Plan de tables"], ["timeline", "Jour J"], ["notes", "Notes"]].map(([k, l]) => el("button", { type: "button", "data-org": k, "aria-pressed": "false", text: l, onclick: () => renderOrg(k) }))),
    el("div", { id: "org-body" }));
  const photos = el("section", { "data-main-sec": "photos", hidden: true }, el("h3", { class: "cat", text: "Photos du mariage" }), el("div", { id: "photos-admin" }));
  const pray = el("section", { "data-main-sec": "pray", hidden: true }, el("h3", { class: "cat", text: "Prière du jour" }), el("div", { id: "pray-body" }));
  panel.replaceChildren(top, today, site, org, photos, pray);
}
function adminExtraRefresh() { buildAdminShell(); let k = "today"; try { k = sessionStorage.getItem("mariage:main") || "today"; } catch {} showMain(MAINS.includes(k) ? k : "today"); }

buildAdminShell();
applyPostWedding();
if (!$("#admin-panel").hidden) adminExtraRefresh(); // l'espace s'est ouvert avant le chargement de ce fichier
