// Aba "Reservas" do painel: lista, confirmar/recusar, bloqueios e agenda semanal.
(function () {
  const M = window.Morada, sb = M.client;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const PLANO = { avulso: "Hora avulsa", pacote: "Pacote", periodo: "Período", semanal: "Fixo semanal", quinzenal: "Fixo quinzenal", bloqueio: "Bloqueio" };
  const STATUS = { pendente: "Pendente", confirmada: "Confirmada", recusada: "Recusada", cancelada: "Cancelada" };
  let rooms = [], C = M.DEFAULTS, filter = "pendente", agWeek = M.monday(new Date()), bound = false;

  window.addEventListener("morada:start", init);

  async function init() {
    const { fail } = window.MoradaAdmin;
    try { [rooms, C] = await Promise.all([M.loadRooms({ includeInactive: true }), M.loadContent()]); }
    catch (e) { return fail("Erro ao carregar reservas", e); }
    const opts = rooms.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
    $("#b-sala").innerHTML = opts; $("#ag-sala").innerHTML = opts;
    const hopt = Array.from({ length: 25 }, (_, h) => `<option value="${h}">${h}h</option>`).join("");
    $("#b-ini").innerHTML = hopt; $("#b-fim").innerHTML = hopt; $("#b-ini").value = 8; $("#b-fim").value = 9;
    $("#b-data").value = M.iso(new Date());
    if (!bound) bind();
    bound = true;
    await Promise.all([renderList(), renderAgenda(), updateCount(), renderStaff()]);
  }

  function bind() {
    document.querySelectorAll(".chips-f button").forEach(b => b.addEventListener("click", () => {
      filter = b.dataset.f;
      document.querySelectorAll(".chips-f button").forEach(x => x.setAttribute("aria-pressed", x === b));
      renderList();
    }));
    $("#btn-bloq").onclick = () => { $("#f-bloq").hidden = false; $("#b-motivo").focus(); };
    $("#b-cancel").onclick = () => { $("#f-bloq").hidden = true; };
    $("#f-bloq").addEventListener("submit", saveBloqueio);
    $("#ag-sala").onchange = renderAgenda;
    $("#ag-prev").onclick = () => { agWeek = M.addDays(agWeek, -7); renderAgenda(); };
    $("#ag-next").onclick = () => { agWeek = M.addDays(agWeek, 7); renderAgenda(); };
    $("#res-list").addEventListener("click", onAction);
    $("#f-staff").addEventListener("submit", addStaff);
    $("#staff-list").addEventListener("click", removeStaff);
  }

  // ---------- helpers ----------
  const waNumber = t => { let d = String(t || "").replace(/\D/g, ""); if (d.length === 10 || d.length === 11) d = "55" + d; return d; };
  const code = r => r.codigo || String(r.id).slice(0, 8).toUpperCase();
  const FORMAS = ["Pix", "Link de pagamento", "Cartão na clínica", "Dinheiro", "Outro"];
  const fmtDate = s => { const d = M.parse(s); return `${M.DOW_NAME[d.getDay()]} ${M.br(d)}`; };
  function fmtSlot(s) {
    const d = M.parse(s.data);
    if (s.freq === "unica") return `${fmtDate(s.data)}, ${s.hora_ini}h–${s.hora_fim}h`;
    return `${s.freq === "semanal" ? "Toda" : "A cada 15 dias,"} ${M.DOW_LONG[d.getDay()]}, ${s.hora_ini}h–${s.hora_fim}h (desde ${M.br(d)})`;
  }
  async function updateCount() {
    const { count } = await sb.from("reservations").select("id", { count: "exact", head: true }).eq("status", "pendente");
    const el = $("#pend-count"); el.textContent = count || ""; el.hidden = !count;
  }

  // ---------- lista ----------
  async function renderList() {
    const box = $("#res-list");
    box.innerHTML = `<p class="muted">Carregando…</p>`;
    let q = sb.from("reservations").select("*, rooms(name), reservation_slots(freq,data,hora_ini,hora_fim)").limit(100);
    if (filter === "pendente") q = q.eq("status", "pendente").order("created_at", { ascending: true });
    if (filter === "confirmada") q = q.eq("status", "confirmada").neq("plano", "bloqueio").order("created_at", { ascending: false });
    if (filter === "encerradas") q = q.in("status", ["recusada", "cancelada"]).order("created_at", { ascending: false });
    if (filter === "bloqueio") q = q.eq("plano", "bloqueio").eq("status", "confirmada").order("created_at", { ascending: false });
    const { data, error } = await q;
    if (error) { box.innerHTML = ""; return window.MoradaAdmin.fail("Erro ao carregar reservas", error); }
    const empty = { pendente: "Nenhuma reserva esperando confirmação.", confirmada: "Nenhuma reserva confirmada ainda.", encerradas: "Nada por aqui.", bloqueio: "Nenhum bloqueio ativo." };
    box.innerHTML = data.length ? "" : `<p class="muted">${empty[filter]}</p>`;
    data.forEach(r => box.appendChild(card(r)));
  }

  function card(r) {
    const el = document.createElement("article"); el.className = `res st-${r.status}`; el.dataset.id = r.id;
    const slots = (r.reservation_slots || []).sort((a, b) => a.data.localeCompare(b.data) || a.hora_ini - b.hora_ini);
    const isBloq = r.plano === "bloqueio";
    const when = new Date(r.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const st = M.statusOf(r, C);
    if (st === "expirada") el.classList.add("st-expirada");
    const resumo = (r.resumo || "").split("\n").filter(l => !/^Plano:/.test(l));
    el.innerHTML = `
      <div class="res-head">
        <span class="pill st">${st === "expirada" ? "Prazo vencido" : st === "pendente" ? "Aguardando pagamento" : STATUS[r.status]}</span>
        <strong>${esc(r.nome)}</strong>
        ${isBloq ? "" : `<span class="tag">${r.user_id ? "Com conta" : "Visitante"}</span>`}
        <span class="muted small">${esc(r.rooms?.name || "")} · ${PLANO[r.plano]} · ${isBloq ? "" : `código ${esc(code(r))} · `}${when}</span>
      </div>
      <div class="res-body">
        ${isBloq ? "" : `<dl class="res-dl">
          <dt>WhatsApp</dt><dd><a href="https://wa.me/${waNumber(r.telefone)}" target="_blank" rel="noopener">${esc(r.telefone)}</a></dd>
          ${r.email ? `<dt>E-mail</dt><dd>${esc(r.email)}</dd>` : ""}
          ${r.cpf ? `<dt>CPF</dt><dd>${esc(M.cpfFormat(r.cpf))}</dd>` : ""}
          <dt>Profissão</dt><dd>${esc(r.profissao || "—")}${r.registro ? ` · ${esc(r.registro)}` : ""}</dd>
          ${r.obs ? `<dt>Observação</dt><dd>${esc(r.obs)}</dd>` : ""}
        </dl>`}
        <div class="res-when"><b>Horários</b><ul>${(slots.length ? slots.map(fmtSlot) : ["Nenhum marcado ainda (pacote)"]).map(l => `<li>${esc(l)}</li>`).join("")}</ul>
          ${!isBloq && resumo.length ? `<p class="muted small">${esc(resumo[resumo.length - 1])}</p>` : ""}
          ${st === "pendente" ? `<p class="muted small">Prazo para pagar: ${M.fmtDateTime(M.expiresAt(r, C))}</p>` : ""}
          ${st === "expirada" ? `<p class="small warn">O prazo passou e o horário voltou a aparecer livre no site. Dá para confirmar se ninguém tiver pegado o horário.</p>` : ""}
          ${r.status === "confirmada" && !isBloq && r.pago_em ? `<p class="muted small">Pago em ${M.fmtDateTime(new Date(r.pago_em))}${r.pagamento_forma ? ` · ${esc(r.pagamento_forma)}` : ""}${r.pagamento_valor != null ? ` · ${M.money(r.pagamento_valor)}` : ""}${r.pagamento_obs ? ` · ${esc(r.pagamento_obs)}` : ""}</p>` : ""}</div>
      </div>
      <div class="res-actions">${actions(r)}</div>`;
    el._r = r;
    return el;
  }

  function actions(r) {
    if (r.plano === "bloqueio") return `<button type="button" class="btn ghost small" data-a="ask-cancel">Remover bloqueio</button>`;
    if (r.status === "pendente") return `<button type="button" class="btn small" data-a="ask-confirm">Pagamento recebido</button><a class="btn ghost small" target="_blank" rel="noopener" href="${waLink(r, "cobranca")}">Enviar cobrança</a><button type="button" class="btn ghost small" data-a="ask-refuse">Recusar</button>`;
    if (r.status === "confirmada") return `<a class="btn ghost small" target="_blank" rel="noopener" href="${waLink(r, "confirmada")}">Mensagem no WhatsApp</a><button type="button" class="linkbtn danger-text" data-a="ask-cancel">Cancelar reserva</button>`;
    return "";
  }

  function waLink(r, kind) {
    const first = (r.nome || "").split(" ")[0];
    const msg = kind === "confirmada"
      ? `Olá, ${first}! Recebemos seu pagamento e sua reserva na Clínica Morada do Ser (código ${code(r)}) está confirmada.\n${(r.resumo || "").trim()}\nQualquer dúvida, é só chamar por aqui.`
      : kind === "cobranca"
      ? `Olá, ${first}! Recebemos sua pré-reserva na Clínica Morada do Ser (código ${code(r)}).\n${(r.resumo || "").trim()}\n${C.pix_chave ? `Para garantir o horário, pague por Pix até ${M.fmtDateTime(M.expiresAt(r, C))}:\nChave: ${C.pix_chave}\nRecebedor: ${C.pix_nome || ""}\n` : `Para garantir o horário, o pagamento precisa ser feito até ${M.fmtDateTime(M.expiresAt(r, C))}. `}Depois é só mandar o comprovante por aqui.`
      : kind === "recusada"
      ? `Olá, ${first}! Infelizmente não conseguimos confirmar sua pré-reserva (código ${code(r)}) na Clínica Morada do Ser. Podemos ver outro horário para você?`
      : `Olá, ${first}! Sua reserva (código ${code(r)}) na Clínica Morada do Ser foi cancelada.`;
    return `https://wa.me/${waNumber(r.telefone)}?text=${encodeURIComponent(msg)}`;
  }

  async function setStatus(r, status) {
    const { error } = await sb.from("reservations").update({ status, decided_at: new Date().toISOString(), ...(status === "cancelada" ? { cancelado_por: "clinica" } : {}) }).eq("id", r.id);
    if (error) { window.MoradaAdmin.fail("Erro ao atualizar reserva", error); return false; }
    r.status = status; updateCount(); renderAgenda(); return true;
  }

  async function onAction(e) {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const el = b.closest(".res"), r = el._r, box = el.querySelector(".res-actions"), a = b.dataset.a;
    const ask = (txt, yes, label) => { box.innerHTML = `<span class="small">${txt}</span><button type="button" class="btn danger small" data-a="${yes}">${label}</button><button type="button" class="btn ghost small" data-a="back">Voltar</button>`; };
    if (a === "back") box.innerHTML = actions(r);
    if (a === "ask-confirm") {
      box.innerHTML = `<div class="payform">
        <div class="field"><label>Forma de pagamento</label><select data-pf="forma">${FORMAS.map(f => `<option>${f}</option>`).join("")}</select></div>
        <div class="field"><label>Valor recebido (R$)</label><input data-pf="valor" type="number" step="0.01" min="0" value="${r.total ?? ""}"></div>
        <div class="field"><label>Observação</label><input data-pf="obs" type="text" placeholder="Ex.: referente a novembro"></div>
        <div class="row-actions"><button type="button" class="btn small" data-a="confirm">Confirmar reserva</button><button type="button" class="btn ghost small" data-a="back">Voltar</button></div></div>`;
      return;
    }
    if (a === "confirm") {
      b.disabled = true;
      const v = k => box.querySelector(`[data-pf="${k}"]`).value;
      const { error } = await sb.rpc("confirm_reservation", { p_id: r.id, p_forma: v("forma"), p_valor: v("valor") === "" ? null : Number(v("valor")), p_obs: v("obs") });
      if (error) { b.disabled = false; return window.MoradaAdmin.toast(error.message, true); }
      r.status = "confirmada"; updateCount(); renderAgenda();
      el.className = "res st-confirmada"; el.querySelector(".pill.st").textContent = STATUS.confirmada;
      box.innerHTML = `<span class="small">Confirmada. Avise a pessoa:</span><a class="btn small" target="_blank" rel="noopener" href="${waLink(r, "confirmada")}">Enviar no WhatsApp</a>`;
      window.MoradaAdmin.toast("Reserva confirmada.");
      return;
    }
    if (a === "ask-refuse") ask("Recusar esta pré-reserva? Os horários voltam a ficar livres.", "refuse", "Recusar");
    if (a === "ask-cancel") ask(r.plano === "bloqueio" ? "Remover este bloqueio?" : "Cancelar esta reserva? Os horários voltam a ficar livres.", "cancel", r.plano === "bloqueio" ? "Remover" : "Cancelar reserva");
    if (a === "refuse" || a === "cancel") {
      const status = a === "refuse" ? "recusada" : "cancelada";
      b.disabled = true;
      if (!(await setStatus(r, status))) { b.disabled = false; return; }
      el.className = `res st-${status}`; el.querySelector(".pill.st").textContent = STATUS[status];
      if (r.plano === "bloqueio") { el.remove(); window.MoradaAdmin.toast("Bloqueio removido."); return; }
      box.innerHTML = `<span class="small">${STATUS[status]}. Avise a pessoa:</span><a class="btn small" target="_blank" rel="noopener" href="${waLink(r, status)}">Enviar no WhatsApp</a>`;
      window.MoradaAdmin.toast(`Reserva ${STATUS[status].toLowerCase()}.`);
    }
  }

  // ---------- bloqueio ----------
  async function saveBloqueio(e) {
    e.preventDefault();
    const { toast, fail } = window.MoradaAdmin;
    const room = $("#b-sala").value, data = $("#b-data").value, ini = +$("#b-ini").value, fim = +$("#b-fim").value, freq = $("#b-freq").value;
    if (!room || !data) return toast("Escolha a sala e a data.", true);
    if (!(fim > ini)) return toast("O horário final precisa ser depois do inicial.", true);
    const nome = $("#b-motivo").value.trim() || "Uso da clínica";
    const slot = { freq, data, hora_ini: ini, hora_fim: fim };
    const { data: res, error } = await sb.from("reservations").insert({ room_id: room, plano: "bloqueio", status: "confirmada", nome, resumo: fmtSlot(slot) }).select("id").single();
    if (error) return fail("Erro ao salvar bloqueio", error);
    const { error: e2 } = await sb.from("reservation_slots").insert({ ...slot, reservation_id: res.id, room_id: room });
    if (e2) { await sb.from("reservations").delete().eq("id", res.id); return fail("Erro ao salvar bloqueio", e2); }
    $("#f-bloq").hidden = true; $("#b-motivo").value = "";
    toast("Horário bloqueado.");
    $("#ag-sala").value = room; agWeek = M.monday(M.parse(data));
    renderAgenda(); if (filter === "bloqueio") renderList();
  }

  // ---------- equipe ----------
  async function renderStaff() {
    const { data, error } = await sb.from("staff").select("user_id,email,created_at").order("created_at");
    if (error) return window.MoradaAdmin.fail("Erro ao carregar equipe", error);
    const me = (await M.getUser())?.id;
    $("#staff-list").innerHTML = data.map(s => `<li><span>${esc(s.email)}${s.user_id === me ? ' <span class="muted small">(você)</span>' : ""}</span>
      ${s.user_id === me ? "" : `<button type="button" class="linkbtn danger-text" data-rm="${s.user_id}">Remover acesso</button>`}</li>`).join("");
  }
  async function addStaff(e) {
    e.preventDefault();
    const { error } = await sb.rpc("add_staff", { p_email: $("#st-email").value });
    if (error) return window.MoradaAdmin.toast(error.message, true);
    $("#st-email").value = ""; window.MoradaAdmin.toast("Acesso liberado."); renderStaff();
  }
  async function removeStaff(e) {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Clique de novo para remover"; return; }
    const { error } = await sb.rpc("remove_staff", { p_user: b.dataset.rm });
    if (error) return window.MoradaAdmin.toast(error.message, true);
    window.MoradaAdmin.toast("Acesso removido."); renderStaff();
  }

  // ---------- agenda ----------
  async function renderAgenda() {
    const room = $("#ag-sala").value, cal = $("#agcal"); if (!room) { cal.innerHTML = ""; return; }
    const end = M.addDays(agWeek, 6);
    $("#ag-label").textContent = `${M.br(agWeek)} a ${M.br(end)}`;
    const { data, error } = await sb.from("reservation_slots")
      .select("freq,data,hora_ini,hora_fim,reservations!inner(id,nome,status,plano)")
      .eq("room_id", room).lte("data", M.iso(end)).in("reservations.status", ["pendente", "confirmada"]);
    if (error) return window.MoradaAdmin.fail("Erro ao carregar agenda", error);
    const H = C.horarios || M.DEFAULTS.horarios;
    const days = [0, 1, 2, 3, 4, 5, 6].map(n => M.addDays(agWeek, n)).filter(d => H[M.DOW_NAME[d.getDay()]]);
    const open = days.map(d => H[M.DOW_NAME[d.getDay()]]);
    const minH = Math.min(...open.map(o => o[0])), maxH = Math.max(...open.map(o => o[1]));
    const grid = {}; // iso|h -> entry
    data.forEach(s => days.forEach(d => {
      const di = M.iso(d), sd = M.parse(s.data);
      const diff = Math.round((d - sd) / 86400000);
      const hit = s.freq === "unica" ? di === s.data : diff >= 0 && d.getDay() === sd.getDay() && (s.freq === "semanal" || (diff / 7) % 2 === 0);
      if (hit) for (let h = s.hora_ini; h < s.hora_fim; h++) grid[`${di}|${h}`] = s.reservations;
    }));
    let html = `<thead><tr><th></th>${days.map(d => `<th>${M.DOW_NAME[d.getDay()]}<small>${M.br(d)}</small></th>`).join("")}</tr></thead><tbody>`;
    for (let h = minH; h < maxH; h++) {
      html += `<tr><th scope="row">${h}h</th>`;
      days.forEach((d, i) => {
        const o = open[i];
        if (h < o[0] || h >= o[1]) { html += `<td class="c-closed"></td>`; return; }
        const r = grid[`${M.iso(d)}|${h}`];
        if (!r) { html += `<td></td>`; return; }
        const cls = r.plano === "bloqueio" ? "blk" : r.status === "pendente" ? "pend" : "conf";
        const prev = grid[`${M.iso(d)}|${h - 1}`];
        html += `<td class="${cls}" title="${esc(r.nome)}">${prev && prev.id === r.id ? "" : esc(r.nome.split(" ")[0])}</td>`;
      });
      html += `</tr>`;
    }
    cal.innerHTML = html + "</tbody>";
  }
})();
