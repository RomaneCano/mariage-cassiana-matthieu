/* Covoiturage : annonces des invités (aller vers le domaine, retour après la soirée).
   Données : table Supabase « covoiturage » (lecture publique sans le code secret, écriture contrôlée),
   suppression / mise à jour des places via des fonctions protégées par un code propre à chaque annonce. */
(function () {
  const LS_MINE = "mariage:covoit-mine";
  const LS_LOCAL = "mariage:covoit";
  const SENS = { aller: "De l'église au domaine", retour: "Du domaine à l'hébergement" };
  const SUBS = { aller: "Après la cérémonie, environ 40 min", retour: "Après la soirée, vers 4 h" };
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

  function card(r) {
    const m = mine()[r.id]; const full = r.type === "offre" && Number(r.places) <= 0;
    const kind = r.type === "demande" ? "Cherche une place" : full ? "Complet" : r.places + " place" + (r.places > 1 ? "s" : "") + " disponible" + (r.places > 1 ? "s" : "");
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
    return el("article", { class: "cv-item" + (full ? " full" : "") + (r.type === "demande" ? " ask" : "") },
      el("div", { class: "cv-top" }, el("b", { text: r.prenom }), el("span", { class: "cv-badge", text: kind })),
      el("p", { class: "cv-line", text: (r.type === "demande" ? "Part de " : "Va à ") + r.lieu + (r.heure ? " · vers " + r.heure : "") }),
      r.note ? el("p", { class: "cv-note", text: r.note }) : "",
      el("p", { class: "cv-contact", text: "Contact : " + ct }),
      actions, extra, own);
  }
  const toast = t => { if (typeof showToast === "function") showToast(t); else alert(t); };

  const isFull = r => r.type === "offre" && Number(r.places) <= 0;
  function renderList() {
    const host = $("#cv-list"); if (!host) return; host.replaceChildren();
    const shown = list.filter(r => filter === "all" || r.sens === filter || r.sens === "both");
    const open = shown.filter(r => !isFull(r)), full = shown.filter(isFull);
    const cols = el("div", { class: "cv-cols" + (filter === "all" ? "" : " one") }); host.append(cols);
    ["aller", "retour"].forEach(s => {
      if (filter !== "all" && filter !== s) return;
      const rows = open.filter(r => r.sens === s || r.sens === "both");
      const col = el("div", { class: "cv-col" }, el("h3", { class: "cat", text: SENS[s] }), el("p", { class: "cv-sub", text: SUBS[s] }));
      if (!rows.length) col.append(el("p", { class: "hint cv-empty", text: "Aucune annonce pour l'instant. Soyez le premier à vous proposer !" }));
      else col.append(el("div", { class: "cv-grid" }, ...rows.map(card)));
      cols.append(col);
    });
    if (full.length) host.append(el("details", { class: "cv-archive" }, el("summary", { text: "Trajets complets (" + full.length + ")" }), el("div", { class: "cv-grid" }, ...full.map(card))));
  }
  async function load() {
    try { list = await api.list(); } catch { list = []; const h = $("#cv-list"); if (h) h.replaceChildren(el("p", { class: "hint", text: "Les annonces ne peuvent pas être chargées pour le moment. Réessayez dans un instant." })); return; }
    renderList();
  }

  function build() {
    if (panelBuilt) return; panelBuilt = true;
    document.querySelectorAll("[data-cv]").forEach(b => b.addEventListener("click", () => {
      filter = b.dataset.cv; document.querySelectorAll("[data-cv]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); renderList();
    }));
    const form = $("#cv-form"), msg = $("#cv-msg"), btns = document.querySelectorAll("[data-cvt]"), typeSel0 = form.querySelector("[name=type]");
    const closeForm = () => { form.hidden = true; btns.forEach(x => x.setAttribute("aria-expanded", "false")); };
    btns.forEach(b => b.addEventListener("click", () => {
      const same = !form.hidden && typeSel0.value === b.dataset.cvt;
      if (same) return closeForm();
      typeSel0.value = b.dataset.cvt; typeSel0.dispatchEvent(new Event("change"));
      form.hidden = false; btns.forEach(x => x.setAttribute("aria-expanded", String(x === b)));
      form.scrollIntoView({ block: "nearest", behavior: "smooth" }); form.querySelector("[name=prenom]").focus({ preventScroll: true });
    }));
    form.addEventListener("submit", async e => {
      e.preventDefault(); msg.hidden = true;
      const f = new FormData(form); if (f.get("website")) return; // piège à robots
      const type = f.get("type"), sens = f.get("sens"), prenom = clean(f.get("prenom")), lieu = clean(f.get("lieu")), heure = clean(f.get("heure")), contact = clean(f.get("contact")), note = clean(f.get("note"));
      let places = type === "offre" ? parseInt(f.get("places"), 10) : 0;
      if (!prenom || !lieu || !contact) return showMsg(msg, "Merci de remplir le prénom, le lieu de départ et un moyen de vous contacter.", "err");
      if (!isPhone(contact) && !isMail(contact)) return showMsg(msg, "Le contact doit être un numéro de téléphone ou une adresse e-mail valide.", "err");
      if (type === "offre" && !(places >= 1 && places <= 8)) return showMsg(msg, "Indiquez entre 1 et 8 places.", "err");
      if (!f.get("ok")) return showMsg(msg, "Cochez la case pour confirmer que ces informations peuvent être visibles des invités.", "err");
      const last = Number(localStorage.getItem("mariage:covoit-last") || 0);
      if (Date.now() - last < 15000) return showMsg(msg, "Un instant avant de publier une nouvelle annonce.", "err");
      const edit_code = code(), id = newId() || uid();
      try {
        await api.add({ id, type, sens, prenom, lieu, heure: heure || null, places, contact, note: note || null, edit_code });
        const m = mine(); m[id] = edit_code; saveMine(m); try { localStorage.setItem("mariage:covoit-last", String(Date.now())); } catch {}
        form.reset(); closeForm();
        toast("Annonce publiée. Merci ! Vous pourrez la retirer depuis cet appareil."); load();
      } catch (err) {
        showMsg(msg, /covoiturage/i.test(String(err && err.message)) || (err && err.code === "PGRST205") ? "Le covoiturage n'est pas encore activé sur le site. Revenez plus tard." : "Publication impossible pour le moment. Réessayez dans un instant.", "err");
      }
    });
    const typeSel = form.querySelector("[name=type]"), placesLbl = $("#cv-places-l");
    const lieuT = $("#cv-lieu-t"), lieuIn = form.querySelector("[name=lieu]");
    const syncType = () => {
      const offre = typeSel.value === "offre"; placesLbl.hidden = !offre;
      lieuT.textContent = offre ? "Où allez-vous ?" : "D'où partez-vous ?";
      lieuIn.placeholder = offre ? "ex. Paris 12e, Meaux, Lagny-sur-Marne…" : "ex. l'église, Lagny-sur-Marne, un hôtel…";
    };
    typeSel.addEventListener("change", syncType); syncType();
  }

  window.covoitInit = async function () {
    build();
    try { isAdm = typeof checkAdmin === "function" ? await checkAdmin() : false; } catch { isAdm = false; }
    load();
  };
  if (document.querySelector("#panel-covoiturage.active")) window.covoitInit();
})();
