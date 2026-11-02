(async function () {
  const M = window.Morada, sb = M.client;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const show = id => ["#v-out", "#v-reset", "#v-in"].forEach(v => $(v).hidden = v !== id);
  const PLANO = { avulso: "Hora avulsa", pacote: "Pacote de horas", periodo: "Período", semanal: "Fixo semanal", quinzenal: "Fixo quinzenal" };

  let toastTimer;
  const toast = (msg, isErr) => { const t = $("#toast"); t.textContent = msg; t.classList.toggle("error", !!isErr); t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, isErr ? 6000 : 3000); };
  const err = (sel, msg) => { const e = $(sel); e.textContent = msg; e.hidden = !msg; };

  let C = structuredClone(M.DEFAULTS);
  try { C = await M.loadContent(); } catch (e) { console.error(e); }
  document.querySelectorAll("[data-c]").forEach(n => n.textContent = C[n.dataset.c] ?? "");
  const waNum = String(C.whatsapp || "").replace(/\D/g, "");
  const wa = t => `https://wa.me/${waNum}${t ? "?text=" + encodeURIComponent(t) : ""}`;
  document.querySelectorAll("[data-wa]").forEach(a => a.href = wa());
  const profs = [...(C.publico_lista || []), "Outra área da saúde"].map(p => `<option>${esc(p)}</option>`).join("");
  $("#s-prof").innerHTML = profs; $("#p-prof").innerHTML = profs;

  if (!sb) { show("#v-out"); err("#l-err", "O site está em modo demonstração."); return; }

  // ---------- sessão ----------
  let started = false;
  const recovering = location.hash.includes("type=recovery");
  sb.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { show("#v-reset"); return; }
    if (session && !started && !recovering) startIn(session.user);
    if (!session) { started = false; show("#v-out"); }
  });
  const { data: { session } } = await sb.auth.getSession();
  if (!session && !recovering) show("#v-out");

  // ---------- abas entrar / criar conta ----------
  document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-selected", x === b));
    $("#f-login").hidden = b.dataset.t !== "login"; $("#f-signup").hidden = b.dataset.t !== "signup"; $("#s-ok").hidden = true;
  }));
  if (location.hash === "#criar") document.querySelector('.seg button[data-t="signup"]').click();

  $("#f-login").addEventListener("submit", async e => {
    e.preventDefault(); err("#l-err", "");
    const { error } = await sb.auth.signInWithPassword({ email: $("#l-email").value.trim(), password: $("#l-pass").value });
    if (error) err("#l-err", /confirm/i.test(error.message) ? "Confirme seu e-mail pelo link que enviamos antes de entrar." : "E-mail ou senha incorretos.");
  });
  $("#l-forgot").addEventListener("click", async () => {
    const email = $("#l-email").value.trim();
    if (!email) return err("#l-err", "Digite seu e-mail acima para receber o link de nova senha.");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] });
    if (error) return err("#l-err", "Não foi possível enviar o e-mail agora. Tente de novo em alguns minutos.");
    err("#l-err", ""); toast("Se existir uma conta com esse e-mail, enviamos um link para criar nova senha.");
  });
  $("#f-signup").addEventListener("submit", async e => {
    e.preventDefault(); err("#s-err", "");
    const nome = $("#s-nome").value.trim(), telefone = $("#s-tel").value.trim(), email = $("#s-email").value.trim(), pass = $("#s-pass").value;
    if (!nome) return err("#s-err", "Preencha seu nome.");
    if (telefone.replace(/\D/g, "").length < 10) return err("#s-err", "Preencha seu WhatsApp com DDD.");
    if (!/^\S+@\S+\.\S+$/.test(email)) return err("#s-err", "Confira o e-mail.");
    if (pass.length < 8) return err("#s-err", "A senha precisa ter pelo menos 8 caracteres.");
    const { data, error } = await sb.auth.signUp({ email, password: pass, options: {
      emailRedirectTo: location.href.split("#")[0],
      data: { nome, telefone, profissao: $("#s-prof").value, registro: $("#s-reg").value.trim() } } });
    if (error) return err("#s-err", /registered|exists/i.test(error.message) ? "Já existe uma conta com esse e-mail. Use a aba Entrar." : error.message);
    if (!data.session) {
      $("#f-signup").hidden = true;
      const ok = $("#s-ok"); ok.hidden = false;
      ok.textContent = `Conta criada! Enviamos um e-mail para ${email}. Clique no link do e-mail para ativar a conta e depois entre aqui.`;
    }
  });
  $("#f-reset").addEventListener("submit", async e => {
    e.preventDefault();
    const p = $("#r-pass").value;
    if (p.length < 8) return err("#r-err", "A senha precisa ter pelo menos 8 caracteres.");
    const { error } = await sb.auth.updateUser({ password: p });
    if (error) return err("#r-err", error.message);
    history.replaceState(null, "", location.pathname); toast("Senha alterada.");
    const u = await M.getUser(); if (u) startIn(u);
  });

  // ---------- consulta de visitante ----------
  $("#f-code").addEventListener("submit", async e => {
    e.preventDefault(); err("#c-err", ""); $("#c-result").innerHTML = "";
    const { data, error } = await sb.rpc("reservation_by_code", { p_codigo: $("#c-code").value, p_telefone: $("#c-tel").value });
    if (error || !data) return err("#c-err", "Não encontramos uma reserva com esse código e WhatsApp. Confira os dados.");
    const r = { ...data, slots: null };
    $("#c-result").innerHTML = resCard(r, true);
  });

  // ---------- área logada ----------
  async function startIn(user) {
    started = true; show("#v-in");
    const [{ data: prof }, { data: staff }] = await Promise.all([
      sb.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      sb.rpc("is_staff")
    ]);
    const p = prof || {};
    $("#hello").textContent = p.nome ? `Olá, ${p.nome.split(" ")[0]}!` : "Olá!";
    $("#to-admin").hidden = !staff;
    $("#p-nome").value = p.nome || ""; $("#p-tel").value = p.telefone || ""; $("#p-reg").value = p.registro || ""; $("#p-email").value = user.email || "";
    if (p.profissao) $("#p-prof").value = p.profissao;
    const { data: n } = await sb.rpc("claim_by_email");
    if (n > 0) toast(`${n} reserva${n > 1 ? "s" : ""} feita${n > 1 ? "s" : ""} com seu e-mail foi vinculada${n > 1 ? "s" : ""} à sua conta.`);
    loadMine(user.id);
  }
  $("#logout").addEventListener("click", () => sb.auth.signOut());
  document.querySelectorAll(".tabs-c button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs-c button").forEach(x => { x.setAttribute("aria-selected", x === b); $("#" + x.dataset.p).hidden = x !== b; });
  }));

  let mine = [];
  async function loadMine(uid) {
    const { data, error } = await sb.from("reservations")
      .select("id,codigo,status,plano,resumo,total,created_at,pago_em,pagamento_forma,rooms(name),reservation_slots(freq,data,hora_ini,hora_fim)")
      .eq("user_id", uid).order("created_at", { ascending: false }).limit(100);
    const box = $("#my-list");
    if (error) { box.innerHTML = `<p class="err">Não foi possível carregar suas reservas.</p>`; return; }
    mine = data || [];
    if (!mine.length) { box.innerHTML = `<div class="card empty"><p>Você ainda não tem reservas.</p><a class="btn" href="index.html#salas">Ver salas e horários</a></div>`; return; }
    const groups = [
      ["Aguardando pagamento", mine.filter(r => M.statusOf(r, C) === "pendente")],
      ["Confirmadas", mine.filter(r => r.status === "confirmada")],
      ["Encerradas", mine.filter(r => ["recusada", "cancelada", "expirada"].includes(M.statusOf(r, C)))]
    ].filter(g => g[1].length);
    box.innerHTML = groups.map(([t, list]) => `<h2 class="h3 grp">${t}</h2>${list.map(r => resCard({ ...r, sala: r.rooms?.name, slots: r.reservation_slots }, false)).join("")}`).join("");
  }

  function fmtSlot(s) {
    const d = M.parse(s.data);
    if (s.freq === "unica") return `${M.DOW_NAME[d.getDay()]} ${M.br(d)}, ${s.hora_ini}h–${s.hora_fim}h`;
    return `${s.freq === "semanal" ? "Toda" : "A cada 15 dias,"} ${M.DOW_LONG[d.getDay()]}, ${s.hora_ini}h–${s.hora_fim}h (desde ${M.br(d)})`;
  }

  function resCard(r, guest) {
    const st = M.statusOf(r, C);
    const lines = r.slots ? r.slots.sort((a, b) => a.data.localeCompare(b.data) || a.hora_ini - b.hora_ini).map(fmtSlot)
      : String(r.resumo || "").split("\n").filter(l => l && !/^Plano:|^Total|^Estimativa/.test(l));
    const pay = st === "pendente" ? `
      <div class="paybox">
        <p><b>Pague até ${M.fmtDateTime(M.expiresAt(r, C))}</b> para garantir o horário. ${r.total ? `Valor: <b>${M.money(r.total)}</b>${r.plano === "semanal" || r.plano === "quinzenal" ? " por mês" : ""}.` : ""}</p>
        ${C.pix_chave ? `<div class="pix"><span>Pix (${esc(C.pix_nome || "")}):</span> <code>${esc(C.pix_chave)}</code> <button type="button" class="copy" data-copy="${esc(C.pix_chave)}">Copiar</button></div>` : ""}
        <p class="muted small">${esc(C.pagamento_texto || "")}</p>
        <a class="btn small" target="_blank" rel="noopener" href="${wa(`Olá! Segue o comprovante da reserva ${r.codigo} (${r.sala || ""}).`)}">Enviar comprovante no WhatsApp</a>
      </div>` : st === "expirada" ? `<p class="muted small">O prazo de pagamento passou e o horário foi liberado. Se ainda quiser, fale com a clínica ou faça uma nova reserva.</p>` : "";
    const canCancel = !guest && (r.status === "pendente" || r.status === "confirmada");
    return `<article class="card myres st-${st}" data-id="${r.id || ""}">
      <div class="myres-head"><span class="pill">${M.STATUS_CLIENTE[st]}</span><strong>${esc(r.sala || "")}</strong>
        <span class="muted small">${PLANO[r.plano] || ""} · código ${esc(r.codigo)}</span></div>
      <ul class="myres-slots">${(lines.length ? lines : ["Horários a combinar com a clínica"]).map(l => `<li>${esc(l)}</li>`).join("")}</ul>
      ${r.total && st !== "pendente" ? `<p class="small muted">Valor: ${M.money(r.total)}${r.plano === "semanal" || r.plano === "quinzenal" ? " por mês (estimativa)" : ""}</p>` : ""}
      ${pay}
      ${canCancel ? `<div class="myres-actions"><button type="button" class="linkbtn danger-text" data-cancel>Cancelar reserva</button></div>` : ""}
    </article>`;
  }

  // copiar Pix / cancelar
  document.addEventListener("click", async e => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copy); toast("Chave Pix copiada."); }
      catch { const r = document.createRange(); r.selectNodeContents(c.previousElementSibling); getSelection().removeAllRanges(); getSelection().addRange(r); }
      return;
    }
    const x = e.target.closest("[data-cancel]");
    if (x) {
      const card = x.closest(".myres"), box = x.parentElement;
      box.innerHTML = `<span class="small">Cancelar esta reserva? Os horários ficam livres para outras pessoas.</span>
        <button type="button" class="btn danger small" data-cancel-yes>Cancelar reserva</button><button type="button" class="btn ghost small" data-cancel-no>Voltar</button>`;
      box.dataset.id = card.dataset.id;
      return;
    }
    if (e.target.closest("[data-cancel-no]")) { const u = await M.getUser(); loadMine(u.id); return; }
    const y = e.target.closest("[data-cancel-yes]");
    if (y) {
      y.disabled = true;
      const { error } = await sb.rpc("cancel_my_reservation", { p_id: y.parentElement.dataset.id });
      if (error) { toast(error.message, true); y.disabled = false; return; }
      toast("Reserva cancelada."); const u = await M.getUser(); loadMine(u.id);
    }
  });

  $("#f-claim").addEventListener("submit", async e => {
    e.preventDefault(); err("#k-err", "");
    const { error } = await sb.rpc("claim_reservation", { p_codigo: $("#k-code").value, p_telefone: $("#k-tel").value });
    if (error) return err("#k-err", error.message);
    toast("Reserva vinculada à sua conta."); $("#f-claim").reset();
    const u = await M.getUser(); loadMine(u.id);
  });

  $("#f-perfil").addEventListener("submit", async e => {
    e.preventDefault();
    const u = await M.getUser();
    const row = { id: u.id, email: u.email, nome: $("#p-nome").value.trim(), telefone: $("#p-tel").value.trim(), profissao: $("#p-prof").value, registro: $("#p-reg").value.trim(), updated_at: new Date().toISOString() };
    if (!row.nome) return toast("Preencha seu nome.", true);
    if (row.telefone.replace(/\D/g, "").length < 10) return toast("Preencha seu WhatsApp com DDD.", true);
    const { error } = await sb.from("profiles").upsert(row);
    if (error) return toast("Não foi possível salvar. Tente de novo.", true);
    $("#hello").textContent = `Olá, ${row.nome.split(" ")[0]}!`; toast("Dados salvos.");
  });
})();
