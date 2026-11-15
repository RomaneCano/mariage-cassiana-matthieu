/* Covoiturage : annonces des invités (aller vers le domaine, retour après la soirée).
   Données : table Supabase « covoiturage » (lecture publique sans le code secret, écriture contrôlée),
   suppression / mise à jour des places via des fonctions protégées par un code propre à chaque annonce. */
(function () {
  const LS_MINE = "mariage:covoit-mine";
  const LS_LOCAL = "mariage:covoit";
  const SENS = { aller: "De l'église au domaine", retour: "Du domaine à l'hébergement", venir: "Pour se rendre au mariage", rentrer: "Pour rentrer chez soi" };
  const SUBS = { aller: "Après la cérémonie, environ 40 min", retour: "Après la soirée, vers 4 h", venir: "De chez vous jusqu'au mariage", rentrer: "Du mariage jusqu'à chez vous" };
  let list = [], filter = "all", isAdm = false, panelBuilt = false;

  const mine = () => { try { return JSON.parse(localStorage.getItem(LS_MINE) || "{}"); } catch { return {}; } };
  const saveMine = m => { try { localStorage.setItem(LS_MINE, JSON.stringify(m)); } catch {} };
  const code = () => (crypto.randomUUID ? crypto.randomUUID() : uid() + uid()).replace(/-/g, "");
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : null);

  const api = {
    async list() {
      if (remote) {
        const { data, error } = await remote.from("covoiturage").select("id,created_at,type,sens,prenom,lieu,heure,places,contact,note").order("created_at", { ascending: false });
        if (error) throw error; return data || [];
      }
      return local.read("covoit");
    },
    async add(rec) {
      if (remote) { const { error } = await remote.from("covoiturage").insert(rec); if (error) throw error; return; }
      const l = local.read("covoit"); const { edit_code, ...pub } = rec; l.unshift({ created_at: new Date().toISOString(), ...pub, _code: edit_code }); local.write("covoit", l);
    },
    async remove(id, c, admin) {
      if (remote) {
        if (admin) { const { error } = await remote.from("covoiturage").delete().eq("id", id); if (error) throw error; return; }
        const { error } = await remote.rpc("covoit_supprimer", { p_id: id, p_code: c }); if (error) throw error; return;
      }
      local.write("covoit", local.read("covoit").filter(r => r.id !== id));
    },
    async take(id, prenom, contact) {
      if (remote) { const { error } = await remote.rpc("covoit_prendre", { p_id: id, p_prenom: prenom, p_contact: contact }); if (error) throw error; return; }
      const l = local.read("covoit"), r = l.find(x => x.id === id); if (!r || r.places < 1) throw new Error("complet");
      r.places -= 1; local.write("covoit", l);
      const res = local.read("covoit-res"); res.push({ offer_id: id, prenom, contact, created_at: new Date().toISOString() }); local.write("covoit-res", res);
    },
    async passengers(id, c) {
      if (remote) { const { data, error } = await remote.rpc("covoit_passagers", { p_id: id, p_code: c }); if (error) throw error; return data || []; }
      return local.read("covoit-res").filter(x => x.offer_id === id);
    },
    async places(id, c, n) {
      if (remote) { const { error } = await remote.rpc("covoit_places", { p_id: id, p_code: c, p_places: n }); if (error) throw error; return; }
      const l = local.read("covoit"); const r = l.find(x => x.id === id); if (r) r.places = n; local.write("covoit", l);
    }
  };

  const clean = s => String(s || "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  const digits = s => String(s || "").replace(/[^\d+]/g, "");
  function waLink(tel) {
    let d = String(tel || "").replace(/\(0\)/g, "").replace(/[^\d+]/g, "");
    if (d.startsWith("+")) d = d.slice(1); else if (d.startsWith("00")) d = d.slice(2); else if (/^0\d{9}$/.test(d)) d = "33" + d.slice(1);
    d = d.replace(/^330/, "33");
    return /^\d{9,15}$/.test(d) ? "https://api.whatsapp.com/send?phone=" + d : "";
  }
  const isPhone = s => /^(\+?\d[\d .-]{7,17}\d)$/.test(String(s).trim());
  const isMail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s).trim());

  const DEF = { aller: ["L'église", "Le domaine"], retour: ["Le domaine", ""], venir: ["", "Le mariage (Lagny-sur-Marne)"], rentrer: ["Le mariage (Lagny-sur-Marne)", ""] };
  const LEG = { aller: ["L'église", "Le domaine"], retour: ["Le domaine", "Mon hébergement"] };
  function route(r) {
    const parts = String(r.lieu || "").split(" → ");
    if (parts.length === 2 && parts[0] && parts[1]) return { from: parts[0], to: parts[1] };
    const d = LEG[r.sens === "retour" ? "retour" : "aller"];      // anciennes annonces : un seul lieu
    return r.type === "demande" ? { from: r.lieu, to: d[1] } : { from: d[0], to: r.lieu };
  }
  function card(r) {
    const m = mine()[r.id]; const full = r.type === "offre" && Number(r.places) <= 0;
    const kind = r.type === "demande" ? (Number(r.places) > 1 ? "Recherche pour " + r.places + " personnes" : "Recherche") : full ? "Complet" : r.places + " place" + (r.places > 1 ? "s" : "") + " disponible" + (r.places > 1 ? "s" : "");
    const ct = String(r.contact || ""); const wa = isPhone(ct) ? waLink(ct) : "";
    const actions = el("div", { class: "cv-actions" });
    if (isPhone(ct)) actions.append(el("a", { class: "btn small solid", href: "tel:" + digits(ct), text: "Appeler" }));
    if (isPhone(ct)) {
      actions.append(el("a", { class: "btn small", href: "sms:" + digits(ct), text: "SMS" }));
    }
    if (isMail(ct)) actions.append(el("a", { class: "btn small solid", href: "mailto:" + ct.trim(), text: "Écrire" }));
    const own = el("div", { class: "cv-own" });
    if (m && r.type === "offre") own.append(
      el("button", { class: "btn small", type: "button", text: full ? "Il reste des places" : "Complet", onclick: async () => { try { await api.places(r.id, m, full ? 1 : 0); load(); } catch { toast("Action impossible pour le moment."); } } }));
    if (m || isAdm) own.append(el("button", { class: "btn small danger", type: "button", text: m ? "Retirer mon annonce" : "Supprimer", onclick: async () => { try { await api.remove(r.id, m, !m && isAdm); const mm = mine(); delete mm[r.id]; saveMine(mm); load(); } catch { toast("Suppression impossible pour le moment."); } } }));
    const extra = el("div", { class: "cv-extra" });
    if (r.type === "offre" && !full && !m) {
      const f = el("form", { class: "cv-take", hidden: true, novalidate: true },
        el("label", {}, el("span", { text: "Votre prénom" }), el("input", { name: "prenom", maxlength: "40", autocomplete: "given-name", required: true })),
        el("label", {}, el("span", { text: "Votre téléphone ou e-mail" }), el("input", { name: "contact", maxlength: "80", autocomplete: "off", required: true })),
        el("label", { class: "cv-ok" }, el("input", { type: "checkbox", name: "ok" }), el("span", { text: "J'accepte que ces informations soient transmises à " + r.prenom + "." })),
        el("p", { class: "msg", hidden: true }),
        el("button", { class: "btn small solid", type: "submit", text: "Confirmer ma place" }));
      f.addEventListener("submit", async e => {
        e.preventDefault(); const msg = f.querySelector(".msg"), d = new FormData(f), pr = clean(d.get("prenom")), co = clean(d.get("contact"));
        if (!pr || !co) return showMsg(msg, "Merci d'indiquer votre prénom et un moyen de vous contacter.", "err");
        if (!isPhone(co) && !isMail(co)) return showMsg(msg, "Le contact doit être un numéro de téléphone ou une adresse e-mail valide.", "err");
        if (!d.get("ok")) return showMsg(msg, "Cochez la case pour confirmer.", "err");
        try { await api.take(r.id, pr, co); toast("Place réservée. " + r.prenom + " a bien reçu vos coordonnées. Vous pouvez aussi la contacter."); load(); }
        catch { showMsg(msg, "Cette place n'est plus disponible ou la réservation a échoué. Réessayez.", "err"); load(); }
      });
      extra.append(el("button", { class: "btn small solid", type: "button", text: "Prendre une place", onclick: () => { f.hidden = !f.hidden; if (!f.hidden) f.querySelector("input").focus(); } }), f);
    }
    if (m && r.type === "offre") {
      const det = el("details", { class: "cv-pass" }, el("summary", { text: "Mes passagers" }));
      let loaded = false;
      det.addEventListener("toggle", async () => {
        if (!det.open || loaded) return; loaded = true;
        try {
          const ps = await api.passengers(r.id, m);
          det.append(ps.length ? el("ul", {}, ...ps.map(x => el("li", {}, el("b", { text: x.prenom }), " · " + x.contact + " ", isPhone(x.contact) ? el("a", { href: "tel:" + digits(x.contact), text: "Appeler" }) : isMail(x.contact) ? el("a", { href: "mailto:" + x.contact.trim(), text: "Écrire" }) : ""))) : el("p", { class: "hint", text: "Personne n'a encore pris de place." }));
        } catch { det.append(el("p", { class: "hint", text: "Liste indisponible pour le moment." })); }
      });
      extra.append(det);
    }
    const rt = route(r);
    return el("article", { class: "cv-item" + (full ? " full" : "") + (r.type === "demande" ? " ask" : "") },
      el("div", { class: "cv-top" }, el("span", { class: "cv-who" }, el("b", { text: r.prenom }), el("span", { class: "cv-kind", text: r.type === "demande" ? "cherche une place" : "propose" })), el("span", { class: "cv-badge", text: kind })),
      el("dl", { class: "cv-route" }, el("dt", { text: "Départ" }), el("dd", { text: rt.from }), el("span", { class: "ar", "aria-hidden": "true", text: "↓" }), el("dt", { text: "Arrivée" }), el("dd", { text: rt.to })),
      r.heure ? el("p", { class: "cv-line", text: "Vers " + r.heure }) : "",
      r.note ? el("p", { class: "cv-note", text: r.note }) : "",
      el("p", { class: "cv-contact", text: "Contact : " + ct }),
      actions, extra, own);
  }
  const toast = t => { if (typeof showToast === "function") showToast(t); else alert(t); };

  const nz = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const sq = { t: "", d: "", a: "", n: 0 };
  const split = r => { const i = String(r.lieu || "").indexOf(" → "); return i < 0 ? [r.lieu || "", r.lieu || ""] : [r.lieu.slice(0, i), r.lieu.slice(i + 3)]; };
  const matchQ = r => {
    if (sq.t && r.type !== sq.t) return false;
    const [d, a] = split(r);
    if (sq.d && !nz(d).includes(nz(sq.d))) return false;
    if (sq.a && !nz(a).includes(nz(sq.a))) return false;
    if (sq.n && !(r.type === "offre" && Number(r.places) >= sq.n)) return false;
    return true;
  };
  const searching = () => !!(sq.t || sq.d || sq.a || sq.n);
  function refreshSearch() {
    const f = $("#cv-search"); if (!f) return; f.hidden = list.length < 5 && !searching();
    const dl = $("#cv-places-dl"); if (dl) { const set = new Set(); list.forEach(r => split(r).forEach(x => x && set.add(x))); dl.replaceChildren(...[...set].sort().map(v => el("option", { value: v }))); }
  }
  const isFull = r => r.type === "offre" && Number(r.places) <= 0;
  function renderList() {
    const host = $("#cv-list"); if (!host) return; host.replaceChildren();
    const GRP = { j: ["aller", "retour"], h: ["venir", "rentrer"] }, inG = sv => filter === "all" || filter === sv || (GRP[filter] || []).includes(sv);
    const shown = list.filter(r => (inG(r.sens) || (r.sens === "both" && (inG("aller") || inG("retour")))) && matchQ(r));
    refreshSearch(); const cnt = $("#cv-count"); if (cnt) { cnt.hidden = !searching(); cnt.textContent = shown.length ? shown.length + " annonce" + (shown.length > 1 ? "s correspondent" : " correspond") + " à votre recherche." : "Aucune annonce ne correspond. Essayez moins de critères ou proposez votre propre trajet."; }
    const open = shown.filter(r => !isFull(r)), full = shown.filter(isFull);
    const groups = [["aller", "retour"], ["venir", "rentrer"]];
    const HEAD = [["", "Le jour J, sur place", "Les petits trajets de la journée et de la fin de soirée."], ["", "Depuis chez vous", "Les trajets entre chez vous et le mariage, à l'aller comme au retour."]];
    groups.forEach((g, gi) => {
      if (!g.some(inG)) return;
      const blk = el("section", { class: "cv-block b" + gi }, filter === "all" ? el("h3", { class: "cv-btitle", text: HEAD[gi][1] }) : "");
      host.append(blk); if (searching() && !g.some(sv => open.some(r => r.sens === sv || (r.sens === "both" && gi === 0)))) { blk.remove(); return; }
      const cols = el("div", { class: "cv-cols" + (g.filter(inG).length > 1 ? "" : " one") }); blk.append(cols);
      g.forEach(sv => {
        if (!inG(sv)) return;
        const rows = open.filter(r => r.sens === sv || r.sens === "both" && gi === 0);
        const col = el("div", { class: "cv-col" }, el("h3", { class: "cat", text: SENS[sv] }), el("p", { class: "cv-sub", text: SUBS[sv] }));
        if (!rows.length && searching()) return;
        if (!rows.length) col.append(el("p", { class: "hint cv-empty", text: "Aucune annonce pour l'instant. Soyez le premier à vous proposer !" }));
        else col.append(el("div", { class: "cv-grid" }, ...rows.map(card)));
        cols.append(col);
      });
    });
    if (full.length) host.append(el("details", { class: "cv-archive" }, el("summary", { text: "Trajets complets (" + full.length + ")" }), el("div", { class: "cv-grid" }, ...full.map(card))));
  }
  async function load() {
    try { list = await api.list(); } catch { list = []; const h = $("#cv-list"); if (h) h.replaceChildren(el("p", { class: "hint", text: "Les annonces ne peuvent pas être chargées pour le moment. Réessayez dans un instant." })); return; }
    renderList();
  }

  function build() {
    if (panelBuilt) return; panelBuilt = true;
    const sf = $("#cv-search");
    if (sf) {
      const upd = () => { sq.t = sf.elements.t.value; sq.d = sf.elements.d.value; sq.a = sf.elements.a.value; sq.n = Number(sf.elements.n.value) || 0; renderList(); };
      sf.addEventListener("input", upd); sf.addEventListener("change", upd); sf.addEventListener("submit", e => { e.preventDefault(); upd(); });
      $("#cv-search-clear").addEventListener("click", () => { sf.reset(); upd(); });
    }
    const fbox = $("#cv-filter"), sub = $("#cv-sub2");
    const SUBL = { j: [["j", "Les deux trajets"], ["aller", "De l'église au domaine"], ["retour", "Du domaine à l'hébergement"]], h: [["h", "Les deux trajets"], ["venir", "Se rendre au mariage"], ["rentrer", "Rentrer chez soi"]] };
    const refreshF = () => {
      const top = filter === "all" ? "all" : (filter === "j" || filter === "aller" || filter === "retour") ? "j" : "h";
      fbox.querySelectorAll(".cv-seg [data-cv]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.cv === top)));
      sub.replaceChildren(); sub.hidden = top === "all";
      if (top !== "all") SUBL[top].forEach(([v, l]) => sub.append(el("button", { type: "button", "data-cv": v, class: "cv-chip", "aria-pressed": String(v === filter), text: l })));
    };
    fbox.addEventListener("click", e => { const b = e.target.closest("[data-cv]"); if (!b) return; filter = b.dataset.cv; refreshF(); renderList(); });
    refreshF();
    const form = $("#cv-form"), msg = $("#cv-msg"), btns = document.querySelectorAll("[data-cvt]"), typeSel0 = form.querySelector("[name=type]");
    const mark = () => btns.forEach(x => { const on = !form.hidden && typeSel0.value === x.dataset.cvt; x.classList.toggle("solid", on); x.setAttribute("aria-expanded", String(on)); });
    const closeForm = () => { form.hidden = true; mark(); };
    typeSel0.addEventListener("change", mark);
    btns.forEach(b => b.addEventListener("click", () => {
      const same = !form.hidden && typeSel0.value === b.dataset.cvt;
      if (same) return closeForm();
      typeSel0.value = b.dataset.cvt; typeSel0.dispatchEvent(new Event("change"));
      form.hidden = false; mark();
      form.scrollIntoView({ block: "nearest", behavior: "smooth" }); form.querySelector("[name=prenom]").focus({ preventScroll: true });
    }));
    form.addEventListener("submit", async e => {
      e.preventDefault(); msg.hidden = true;
      const f = new FormData(form); if (f.get("website")) return; // piège à robots
      const type = f.get("type"), sens = f.get("sens"), prenom = clean(f.get("prenom")), depart = clean(f.get("depart")), arrivee = clean(f.get("arrivee")), heure = clean(f.get("heure")), contact = clean(f.get("contact")), note = clean(f.get("note"));
      let places = parseInt(f.get("places"), 10);
      if (!prenom || !depart || !arrivee || !contact) return showMsg(msg, "Merci de remplir le prénom, le lieu de départ, le lieu d'arrivée et un moyen de vous contacter.", "err");
      const lieu = depart.slice(0, 38) + " → " + arrivee.slice(0, 38);
      if (!isPhone(contact) && !isMail(contact)) return showMsg(msg, "Le contact doit être un numéro de téléphone ou une adresse e-mail valide.", "err");
      if (!(places >= 1 && places <= 8)) return showMsg(msg, type === "offre" ? "Indiquez entre 1 et 8 places." : "Indiquez entre 1 et 8 personnes.", "err");
      if (!f.get("ok")) return showMsg(msg, "Cochez la case pour confirmer que ces informations peuvent être visibles des invités.", "err");
      const last = Number(localStorage.getItem("mariage:covoit-last") || 0);
      if (Date.now() - last < 15000) return showMsg(msg, "Un instant avant de publier une nouvelle annonce.", "err");
      const edit_code = code(), id = newId() || uid();
      try {
        await api.add({ id, type, sens, prenom, lieu, heure: heure || null, places, contact, note: note || null, edit_code });
        const m = mine(); m[id] = edit_code; saveMine(m); try { localStorage.setItem("mariage:covoit-last", String(Date.now())); } catch {}
        form.reset(); lastOffre = null; auto = { d: "", a: "" }; closeForm(); syncType();
        toast("Annonce publiée. Merci ! Vous pourrez la retirer depuis cet appareil."); load();
      } catch (err) {
        showMsg(msg, /covoiturage/i.test(String(err && err.message)) || (err && err.code === "PGRST205") ? "Le covoiturage n'est pas encore activé sur le site. Revenez plus tard." : "Publication impossible pour le moment. Réessayez dans un instant.", "err");
      }
    });
    const typeSel = form.querySelector("[name=type]"), placesLbl = $("#cv-places-l");
    const dep = form.querySelector("[name=depart]"), arr = form.querySelector("[name=arrivee]"), sensSel = form.querySelector("[name=sens]");
    let auto = { d: "", a: "" };
    const PH = { aller: ["l'église", "le domaine"], retour: ["le domaine", "mon hôtel, Meaux, Paris 12e…"], venir: ["chez moi, Paris, Toulouse…", "le mariage"], rentrer: ["le mariage", "chez moi, Paris, Toulouse…"] };
    const syncSens = () => {
      const d = DEF[sensSel.value]; if (!d) return;
      if (!dep.value || dep.value === auto.d) dep.value = d[0];
      if (!arr.value || arr.value === auto.a) arr.value = d[1];
      auto = { d: d[0], a: d[1] };
      const ph = PH[sensSel.value]; dep.placeholder = "ex. " + ph[0]; arr.placeholder = "ex. " + ph[1];
    };
    sensSel.addEventListener("change", syncSens);
    const placesIn = placesLbl.querySelector("input"); let lastOffre = null;
    const syncType = () => { const offre = typeSel.value === "offre"; placesLbl.firstChild.nodeValue = offre ? "Nombre de places" : "Nombre de personnes"; if (lastOffre !== offre) { placesIn.value = offre ? "3" : "1"; lastOffre = offre; } syncSens(); };
    typeSel.addEventListener("change", syncType); syncType();
  }

  window.covoitInit = async function () {
    build();
    try { isAdm = typeof checkAdmin === "function" ? await checkAdmin() : false; } catch { isAdm = false; }
    load();
  };
  if (document.querySelector("#panel-covoiturage.active")) window.covoitInit();
})();
