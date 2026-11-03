(async function () {
  const M = window.Morada, sb = M.client, BUCKET = M.cfg.BUCKET || "fotos";
  const $ = s => document.querySelector(s);
  const show = id => {
    ["#v-config", "#v-login", "#v-reset", "#v-app", "#v-noaccess"].forEach(v => $(v).hidden = v !== id);
    $("#auth-shell").hidden = id === "#v-app";
  };

  let toastTimer;
  function toast(msg, isError) {
    const t = $("#toast"); t.textContent = msg; t.classList.toggle("error", !!isError); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, isError ? 6000 : 2800);
  }
  const fail = (what, e) => { console.error(e); toast(`${what}: ${e?.message || "erro desconhecido"}`, true); };
  window.MoradaAdmin = { toast, fail };

  if (!sb) { show("#v-config"); return; }

  // ---------- autenticação ----------
  let started = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { show("#v-reset"); return; }
    if (session && !started && !location.hash.includes("type=recovery")) start();
    if (!session) { started = false; show("#v-login"); }
  });
  const { data: { session } } = await sb.auth.getSession();
  if (!session && !location.hash.includes("type=recovery")) show("#v-login");

  $("#f-login").addEventListener("submit", async e => {
    e.preventDefault();
    const err = $("#l-err"); err.hidden = true;
    const { error } = await sb.auth.signInWithPassword({ email: $("#l-email").value.trim(), password: $("#l-pass").value });
    if (error) { err.textContent = "E-mail ou senha incorretos. Confira e tente de novo."; err.hidden = false; }
  });
  $("#l-forgot").addEventListener("click", async () => {
    const email = $("#l-email").value.trim(), err = $("#l-err");
    if (!email) { err.textContent = "Digite seu e-mail acima para receber o link de nova senha."; err.hidden = false; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
    if (error) return fail("Não foi possível enviar o e-mail", error);
    err.hidden = true; toast("Enviamos um link para criar nova senha no seu e-mail.");
  });
  $("#f-reset").addEventListener("submit", async e => {
    e.preventDefault();
    const p = $("#r-pass").value, err = $("#r-err");
    if (p.length < 8) { err.textContent = "A senha precisa ter pelo menos 8 caracteres."; err.hidden = false; return; }
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    history.replaceState(null, "", location.pathname); toast("Senha alterada."); if (!started) start();
  });
  $("#logout").addEventListener("click", () => sb.auth.signOut());
  $("#noaccess-out").addEventListener("click", () => sb.auth.signOut());

  // ---------- navegação ----------
  const TITLES = { inicio: "Início", agenda: "Agenda", reservas: "Reservas", clientes: "Clientes", financeiro: "Financeiro", salas: "Salas", conteudo: "Conteúdo e preços", equipe: "Equipe" };
  function go(page) {
    if (!TITLES[page]) page = "inicio";
    document.querySelectorAll(".page").forEach(p => p.hidden = p.dataset.page !== page);
    document.querySelectorAll("[data-page].nav-i, [data-page].mnav-i").forEach(b => b.setAttribute("aria-current", b.dataset.page === page ? "page" : "false"));
    $("#page-title").textContent = TITLES[page];
    $("#side").classList.remove("open"); $("#side-bg").hidden = true;
    if (location.hash !== "#" + page) history.replaceState(null, "", "#" + page);
    window.dispatchEvent(new CustomEvent("morada:page", { detail: page }));
    window.scrollTo(0, 0);
  }
  window.MoradaAdmin.go = go;
  document.querySelectorAll("button[data-page]").forEach(b => b.addEventListener("click", () => go(b.dataset.page)));
  const openSide = () => { $("#side").classList.add("open"); $("#side-bg").hidden = false; };
  $("#menu-btn").addEventListener("click", openSide);
  $("#mnav-more").addEventListener("click", openSide);
  $("#side-bg").addEventListener("click", () => { $("#side").classList.remove("open"); $("#side-bg").hidden = true; });

  async function start() {
    started = true;
    const { data: staff, error: se } = await sb.rpc("is_staff");
    if (se || !staff) { show("#v-noaccess"); return; }
    show("#v-app");
    const u = await M.getUser(); $("#me-email").textContent = u?.email || "";
    go(location.hash.replace("#", "") || "inicio");
    await Promise.all([renderRooms(), renderTextos()]);
    window.dispatchEvent(new CustomEvent("morada:start"));
  }

  // ---------- imagens ----------
  async function resize(file, max = 1600) {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas"); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    let blob = await new Promise(r => c.toBlob(r, "image/webp", 0.85));
    if (!blob || blob.type !== "image/webp") blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
    return blob;
  }
  async function uploadImage(file, folder) {
    const blob = await resize(file);
    const ext = blob.type === "image/webp" ? "webp" : "jpg";
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
    if (error) throw error;
    return path;
  }
  const removeFiles = paths => paths.length ? sb.storage.from(BUCKET).remove(paths) : null;

  // ---------- salas ----------
  let rooms = [];
  async function renderRooms() {
    try { rooms = await M.loadRooms({ includeInactive: true }); } catch (e) { return fail("Erro ao carregar salas", e); }
    const list = $("#room-list"); list.innerHTML = "";
    if (!rooms.length) list.innerHTML = `<p class="muted">Nenhuma sala cadastrada. Clique em “Adicionar sala”.</p>`;
    rooms.forEach((r, i) => list.appendChild(roomCard(r, i)));
  }

  function roomCard(r, idx) {
    const node = $("#tpl-room").content.firstElementChild.cloneNode(true);
    const f = k => node.querySelector(`[data-f="${k}"]`);
    const uid = r.id.slice(0, 8);
    node.querySelectorAll("[data-f]").forEach(inp => { inp.id = `${inp.dataset.f}-${uid}`; const lab = inp.closest(".field")?.querySelector("label"); if (lab) lab.htmlFor = inp.id; });
    f("name").value = r.name; f("description").value = r.description || "";
    f("features").value = (r.features || []).join("\n"); f("active").checked = r.active !== false;
    const title = node.querySelector(".aroom-title"), pill = node.querySelector(".pill");
    const paint = () => { title.textContent = f("name").value || "Sem nome"; pill.textContent = f("active").checked ? "No site" : "Oculta"; pill.classList.toggle("off", !f("active").checked); };
    paint();
    node.addEventListener("input", () => { node.classList.add("dirty"); paint(); });
    node.querySelector('[data-act="up"]').disabled = idx === 0;
    node.querySelector('[data-act="down"]').disabled = idx === rooms.length - 1;

    // fotos
    const photosBox = node.querySelector(".photos");
    const drawPhotos = () => {
      photosBox.innerHTML = "";
      r.photos.forEach((p, i) => {
        const d = document.createElement("div"); d.className = "photo";
        d.innerHTML = `<img src="${M.photoUrl(p.path)}" alt="Foto ${i + 1}">${i === 0 ? '<span class="cover">Capa</span>' : ""}
          <div class="tools"><span><button type="button" data-p="left" aria-label="Mover para a esquerda">←</button> <button type="button" data-p="right" aria-label="Mover para a direita">→</button></span><button type="button" data-p="del" aria-label="Apagar foto">✕</button></div>`;
        d.querySelector('[data-p="left"]').disabled = i === 0;
        d.querySelector('[data-p="right"]').disabled = i === r.photos.length - 1;
        d.querySelector('[data-p="left"]').onclick = () => movePhoto(i, -1);
        d.querySelector('[data-p="right"]').onclick = () => movePhoto(i, 1);
        const del = d.querySelector('[data-p="del"]');
        del.onclick = async () => {
          if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "?"; del.setAttribute("aria-label", "Clique de novo para apagar"); toast("Clique de novo no ✕ para apagar a foto."); setTimeout(() => { del.dataset.armed = ""; del.textContent = "✕"; }, 3000); return; }
          const { error } = await sb.from("room_photos").delete().eq("id", p.id);
          if (error) return fail("Erro ao apagar foto", error);
          await removeFiles([p.path]); r.photos.splice(i, 1); await saveOrder(); drawPhotos(); toast("Foto apagada.");
        };
        photosBox.appendChild(d);
      });
    };
    async function saveOrder() {
      const results = await Promise.all(r.photos.map((p, i) => (p.sort = i, sb.from("room_photos").update({ sort: i }).eq("id", p.id))));
      const err = results.find(x => x.error); if (err) fail("Erro ao ordenar fotos", err.error);
    }
    async function movePhoto(i, dir) {
      const j = i + dir; [r.photos[i], r.photos[j]] = [r.photos[j], r.photos[i]];
      drawPhotos(); await saveOrder();
    }
    drawPhotos();

    const fileInput = node.querySelector('input[type="file"]'), upStatus = node.querySelector(".up-status");
    fileInput.addEventListener("change", async () => {
      const files = [...fileInput.files]; fileInput.value = "";
      upStatus.hidden = false;
      for (let k = 0; k < files.length; k++) {
        upStatus.textContent = `Enviando foto ${k + 1} de ${files.length}…`;
        try {
          const path = await uploadImage(files[k], `salas/${r.id}`);
          const { data, error } = await sb.from("room_photos").insert({ room_id: r.id, path, sort: r.photos.length }).select().single();
          if (error) throw error;
          r.photos.push(data); drawPhotos();
        } catch (e) { fail(`Erro ao enviar ${files[k].name}`, e); }
      }
      upStatus.hidden = true; toast("Fotos enviadas.");
    });

    // ações
    node.addEventListener("click", async e => {
      const act = e.target.closest("[data-act]")?.dataset.act; if (!act) return;
      if (act === "save") {
        const row = { name: f("name").value.trim() || "Sala sem nome", description: f("description").value.trim(), features: f("features").value.split("\n").map(s => s.trim()).filter(Boolean), active: f("active").checked };
        const { error } = await sb.from("rooms").update(row).eq("id", r.id);
        if (error) return fail("Erro ao salvar sala", error);
        Object.assign(r, row); node.classList.remove("dirty"); toast(`${row.name} salva.`);
      }
      if (act === "up" || act === "down") {
        const j = idx + (act === "up" ? -1 : 1); [rooms[idx], rooms[j]] = [rooms[j], rooms[idx]];
        const res = await Promise.all(rooms.map((x, i) => sb.from("rooms").update({ sort: i }).eq("id", x.id)));
        const err = res.find(x => x.error); if (err) return fail("Erro ao reordenar", err.error);
        renderRooms();
      }
      if (act === "del") { node.querySelector(".confirm").hidden = false; e.target.hidden = true; }
      if (act === "del-no") { node.querySelector(".confirm").hidden = true; node.querySelector('[data-act="del"]').hidden = false; }
      if (act === "del-yes") {
        const paths = r.photos.map(p => p.path);
        const { error } = await sb.from("rooms").delete().eq("id", r.id);
        if (error) return fail("Erro ao excluir sala", error);
        await removeFiles(paths); toast("Sala excluída."); renderRooms();
      }
    });
    return node;
  }

  $("#add-room").addEventListener("click", async () => {
    const { data, error } = await sb.from("rooms").insert({ name: `Sala ${rooms.length + 1}`, sort: rooms.length, active: false }).select().single();
    if (error) return fail("Erro ao criar sala", error);
    await renderRooms();
    toast("Sala criada como oculta. Preencha, adicione fotos e marque “Mostrar no site”.");
    const cards = document.querySelectorAll(".aroom"); cards[cards.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------- textos ----------
  let content = {};
  async function renderTextos() {
    try { content = await M.loadContent(); } catch (e) { return fail("Erro ao carregar textos", e); }
    const form = $("#f-textos"); form.innerHTML = "";
    M.FIELDS.forEach(g => {
      const box = document.createElement("fieldset"); box.className = "group"; box.style.border = "1px solid var(--line)";
      box.innerHTML = `<h3>${g.group}</h3>`;
      g.fields.forEach(fd => box.appendChild(fieldEl(fd, content[fd.key])));
      form.appendChild(box);
    });
    form.addEventListener("input", () => $("#textos-status").textContent = "Alterações não salvas.");
  }

  function fieldEl(fd, val) {
    const w = document.createElement("div"); w.className = "field"; w.dataset.key = fd.key; w.dataset.type = fd.type;
    const id = "c-" + fd.key;
    const label = `<label for="${id}">${fd.label}</label>`;
    const hint = fd.hint ? `<p class="hint">${fd.hint}</p>` : "";
    if (fd.type === "text") { w.innerHTML = label + `<input id="${id}" type="text">` + hint; w.querySelector("input").value = val ?? ""; }
    if (fd.type === "number") { w.innerHTML = label + `<input id="${id}" type="number" min="${fd.min}" max="${fd.max}" style="max-width:120px">`; w.querySelector("input").value = val ?? ""; }
    if (fd.type === "money") { w.innerHTML = label + `<div class="money"><span>R$</span><input id="${id}" type="number" min="0" step="0.5" inputmode="decimal"></div>`; w.querySelector("input").value = val ?? ""; }
    if (fd.type === "hours") {
      const hs = Array.from({ length: 25 }, (_, h) => h);
      const opt = (sel) => hs.map(h => `<option value="${h}" ${h === sel ? "selected" : ""}>${h}h</option>`).join("");
      w.innerHTML = `<label>${fd.label}</label><div class="hours">${M.ALL_DAYS.map(d => { const v = (val || {})[d];
        return `<div class="hrow" data-d="${d}"><label class="check"><input type="checkbox" ${v ? "checked" : ""}> ${d}</label>
          <select aria-label="${d}: abre" ${v ? "" : "disabled"}>${opt(v ? v[0] : 8)}</select><span>às</span>
          <select aria-label="${d}: fecha" ${v ? "" : "disabled"}>${opt(v ? v[1] : 18)}</select></div>`; }).join("")}</div>`;
      w.querySelectorAll(".hrow").forEach(r => r.querySelector("input").addEventListener("change", e => r.querySelectorAll("select").forEach(s => s.disabled = !e.target.checked)));
    }
    if (fd.type === "periods") {
      w.innerHTML = label + `<textarea id="${id}" rows="4"></textarea><p class="hint">Formato: Nome início-fim. Ex.: Tarde 14-18</p>`;
      w.querySelector("textarea").value = (val || []).map(p => `${p.nome} ${p.ini}-${p.fim}`).join("\n");
    }
    if (fd.type === "textarea" || fd.type === "list") {
      w.innerHTML = label + `<textarea id="${id}" rows="${fd.type === "list" ? 6 : 3}"></textarea>` + hint;
      w.querySelector("textarea").value = fd.type === "list" ? (val || []).join("\n") : (val ?? "");
    }
    if (fd.type === "days") {
      w.innerHTML = `<label>${fd.label}</label><div class="days">${M.ALL_DAYS.map(d => `<label><input type="checkbox" value="${d}" ${(val || []).includes(d) ? "checked" : ""}> ${d}</label>`).join("")}</div>`;
    }
    if (fd.type === "image") {
      w.innerHTML = `<label>${fd.label}</label><div class="imgfield"><div class="prev"></div><div class="stack" style="gap:8px"><label class="btn ghost small upload">Trocar foto<input type="file" accept="image/*" hidden></label><button type="button" class="linkbtn">Remover foto</button><p class="hint">Sem foto aqui, o site usa a capa da primeira sala.</p></div></div>`;
      w.dataset.value = val || "";
      const prev = w.querySelector(".prev");
      const paint = () => prev.style.backgroundImage = w.dataset.value ? `url("${M.photoUrl(w.dataset.value)}")` : "";
      paint();
      w.querySelector("input").addEventListener("change", async ev => {
        const file = ev.target.files[0]; ev.target.value = ""; if (!file) return;
        try { toast("Enviando foto…"); w.dataset.value = await uploadImage(file, "site"); paint(); $("#textos-status").textContent = "Alterações não salvas."; toast("Foto pronta. Clique em Salvar textos."); }
        catch (e) { fail("Erro ao enviar foto", e); }
      });
      w.querySelector(".linkbtn").addEventListener("click", () => { w.dataset.value = ""; paint(); $("#textos-status").textContent = "Alterações não salvas."; });
    }
    if (fd.type === "pairs") {
      w.innerHTML = `<label>${fd.label}</label><div class="pairs"></div><button type="button" class="linkbtn">+ Adicionar item</button>`;
      const box = w.querySelector(".pairs"), addBtn = w.querySelector(".linkbtn");
      const addRow = (p = { titulo: "", texto: "" }) => {
        const row = document.createElement("div"); row.className = "pair";
        row.innerHTML = `<input type="text" placeholder="Título" aria-label="Título"><textarea rows="1" placeholder="Texto" aria-label="Texto"></textarea><button type="button" class="icon" aria-label="Remover item">✕</button>`;
        row.querySelector("input").value = p.titulo; row.querySelector("textarea").value = p.texto;
        row.querySelector("button").onclick = () => { row.remove(); sync(); $("#textos-status").textContent = "Alterações não salvas."; };
        box.appendChild(row); sync();
      };
      const sync = () => addBtn.hidden = !!fd.max && box.children.length >= fd.max;
      (val || []).forEach(addRow);
      addBtn.onclick = () => addRow();
    }
    return w;
  }

  function readField(w) {
    const t = w.dataset.type;
    if (t === "text" || t === "textarea") return w.querySelector("input,textarea").value.trim();
    if (t === "number" || t === "money") return Number(w.querySelector("input").value);
    if (t === "hours") { const o = {}; w.querySelectorAll(".hrow").forEach(r => { const [a, b] = r.querySelectorAll("select"); o[r.dataset.d] = r.querySelector("input").checked ? [+a.value, +b.value] : null; }); return o; }
    if (t === "periods") return w.querySelector("textarea").value.split("\n").map(l => l.trim().match(/^(.+?)\s+(\d{1,2})\s*-\s*(\d{1,2})$/)).filter(Boolean).map(m => ({ nome: m[1], ini: +m[2], fim: +m[3] }));
    if (t === "list") return w.querySelector("textarea").value.split("\n").map(s => s.trim()).filter(Boolean);
    if (t === "days") return [...w.querySelectorAll("input:checked")].map(i => i.value);
    if (t === "image") return w.dataset.value || "";
    if (t === "pairs") return [...w.querySelectorAll(".pair")].map(r => ({ titulo: r.querySelector("input").value.trim(), texto: r.querySelector("textarea").value.trim() })).filter(p => p.titulo || p.texto);
  }

  $("#f-textos").addEventListener("submit", async e => {
    e.preventDefault();
    const rows = [...e.target.querySelectorAll(".field[data-key]")].map(w => ({ key: w.dataset.key, value: readField(w), updated_at: new Date().toISOString() }));
    const get = k => rows.find(r => r.key === k)?.value;
    const hrs = get("horarios") || {};
    if (!Object.values(hrs).some(Boolean)) return toast("Marque pelo menos um dia de funcionamento.", true);
    const badDay = Object.entries(hrs).find(([, v]) => v && !(v[1] > v[0]));
    if (badDay) return toast(`${badDay[0]}: o horário de fechar precisa ser depois do de abrir.`, true);
    const per = get("periodos") || [];
    if (!per.length || per.some(p => !(p.fim > p.ini))) return toast("Confira os períodos: use o formato Nome início-fim, ex.: Tarde 14-18.", true);
    for (const k of ["preco_avulso", "preco_antecipada", "antecipadas_min", "preco_periodo_bloco"])
      if (!(get(k) > 0)) return toast("Preencha todos os preços com valores maiores que zero.", true);
    if (per.some(p => p.fim - p.ini !== 4)) return toast("Cada período precisa ter 4 horas (ex.: Tarde 13-17), porque o preço é por período de 4h.", true);
    const { error } = await sb.from("site_content").upsert(rows);
    if (error) return fail("Erro ao salvar textos", error);
    $("#textos-status").textContent = "Tudo salvo."; toast("Textos salvos. O site já mostra a versão nova.");
  });
})();
