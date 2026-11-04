// Painel da equipe: início, agenda, reservas, clientes, financeiro, equipe e painel lateral de detalhes.
(function () {
  const M = window.Morada, sb = M.client;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const A = () => window.MoradaAdmin;
  const PLANO = { avulso: "Hora avulsa", pacote: "Horas antecipadas", periodo: "Período de 4h", semanal: "Fixo semanal", quinzenal: "Fixo quinzenal", bloqueio: "Bloqueio" };
  const FORMAS = ["Pix", "Link de pagamento", "Cartão na clínica", "Dinheiro", "Outro"];
  const FORMA_ESC = { pix: "Pix", link: "Cartão (link)" };
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const fixo = r => r.plano === "semanal" || r.plano === "quinzenal";

  let C = M.DEFAULTS, rooms = [], all = [], ajustes = [], bound = false, current = "inicio";
  let agView = "dia", agDate = startOfDay(new Date()), rsFilter = "pendente", fiMonth = monthStart(new Date());

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  const todayIso = () => M.iso(new Date());
  const roomName = id => rooms.find(r => r.id === id)?.name || "";
  const st = r => r.plano === "bloqueio" ? "bloqueio" : M.statusOf(r, C);
  const PILL = { pendente: ["Aguardando confirmação", "p-pend"], expirada: ["Prazo vencido", "p-exp"], confirmada: ["Confirmada", "p-conf"], recusada: ["Recusada", "p-off"], cancelada: ["Cancelada", "p-off"], bloqueio: ["Bloqueio", "p-blk"] };
  const pill = r => { const [t, c] = PILL[st(r)]; const due = r.status === "confirmada" && r.plano !== "bloqueio" && M.dueOf(r) > 0;
    return `<span class="pill ${c}">${t}</span>${r.usa_banco_de ? `<span class="pill p-banco">Banco de horas</span>` : M.isCompraBanco(r) ? `<span class="pill p-banco">Compra de horas</span>` : ""}${due ? `<span class="pill ${atrasado(r) ? "p-late" : "p-pend"}">${atrasado(r) ? "Pagamento atrasado" : "A pagar"}</span>` : ""}`; };
  // pagamento em atraso: avulsa/período depois do dia do atendimento; horas antecipadas depois do dia 05
  function atrasado(r) {
    if (r.status !== "confirmada" || M.dueOf(r) <= 0) return false;
    if (r.plano === "pacote") { const v = M.vencimento(r); return !!v && new Date() > v; }
    const datas = (r.reservation_slots || []).map(x => x.data).sort(), hoje = M.iso(new Date());
    if (!datas.length) return false;
    return datas[0] < hoje;
  }
  const aReceber = () => all.filter(r => r.status === "confirmada" && r.plano !== "bloqueio" && M.dueOf(r) > 0);
  const waNum = t => { let d = M.onlyDigits(t); if (d.length === 10 || d.length === 11) d = "55" + d; return d; };
  const first = n => String(n || "").split(" ")[0];
  const H = () => C.horarios || M.DEFAULTS.horarios;
  const openOf = d => H()[M.DOW_NAME[d.getDay()]] || null;
  const paidTotal = r => (r.payments || []).reduce((s, p) => s + Number(p.valor || 0), 0);

  function fmtSlot(s) {
    const d = M.parse(s.data);
    if (s.freq === "unica") return `${M.DOW_NAME[d.getDay()]} ${M.br(d)}, ${M.hh(s.hora_ini)}–${M.hh(s.hora_fim)}`;
    return `${s.freq === "semanal" ? "Toda" : "A cada 15 dias,"} ${M.DOW_LONG[d.getDay()]}, ${M.hh(s.hora_ini)}–${M.hh(s.hora_fim)} (desde ${M.br(d)})`;
  }
  const bancoLinha = r => `Banco de horas: ${M.dur(r.horas_compradas)} para ${M.mesNome(r.mes_referencia)}`;
  const slotsText = r => M.isCompraBanco(r) ? [bancoLinha(r)] : (r.reservation_slots || []).slice().sort((a, b) => a.data.localeCompare(b.data) || a.hora_ini - b.hora_ini).map(fmtSlot);

  // reserva ocupa a agenda?
  const active = r => r.status === "confirmada" || (r.status === "pendente" && M.statusOf(r, C) === "pendente");
  // ocorrências de uma reserva num dia
  function occursOn(s, d) {
    const di = M.iso(d);
    if (s.freq === "unica") return s.data === di;
    const sd = M.parse(s.data), diff = Math.round((d - sd) / 864e5);
    return diff >= 0 && d.getDay() === sd.getDay() && (s.freq === "semanal" || (diff / 7) % 2 === 0);
  }
  function dayEvents(d, roomId) {
    const out = [];
    all.filter(active).forEach(r => (r.reservation_slots || []).forEach(s => {
      if ((!roomId || s.room_id === roomId) && occursOn(s, d)) out.push({ r, s });
    }));
    return out.sort((a, b) => a.s.hora_ini - b.s.hora_ini);
  }

  // ---------- banco de horas (mesma conta do banco: saldo_horas) ----------
  const mesDe = d => M.iso(new Date(d.getFullYear(), d.getMonth(), 1));
  function bancoResumo(userId, mes) {
    const compras = all.filter(r => M.isCompraBanco(r) && r.user_id === userId && r.mes_referencia === mes && ["pendente", "confirmada"].includes(r.status));
    const comp = compras.filter(r => r.status === "confirmada").reduce((t, r) => t + Number(r.horas_compradas), 0);
    const pend = compras.filter(r => r.status === "pendente").reduce((t, r) => t + Number(r.horas_compradas), 0);
    const ajs = ajustes.filter(a => a.user_id === userId && a.mes === mes).sort((a, b) => b.created_at.localeCompare(a.created_at));
    const aj = ajs.reduce((t, a) => t + Number(a.horas), 0);
    const usos = all.filter(r => r.usa_banco_de && r.user_id === userId && ["pendente", "confirmada"].includes(r.status))
      .flatMap(r => (r.reservation_slots || []).filter(s => s.data.slice(0, 7) === mes.slice(0, 7)).map(s => ({ r, s })))
      .sort((a, b) => a.s.data.localeCompare(b.s.data) || a.s.hora_ini - b.s.hora_ini);
    const usadas = usos.reduce((t, x) => t + Number(x.s.hora_fim) - Number(x.s.hora_ini), 0);
    return { mes, compras, comp, pend, ajs, aj, usos, usadas, saldo: comp + aj - usadas };
  }
  // meses com banco de horas de um cliente (os com compra, mais o atual)
  function bancoMeses(userId) {
    const ms = new Set(all.filter(r => M.isCompraBanco(r) && r.user_id === userId).map(r => r.mes_referencia));
    ajustes.filter(a => a.user_id === userId).forEach(a => ms.add(a.mes));
    return [...ms].sort().reverse();
  }
  const hz = h => h === 0 ? "0h" : (h < 0 ? "−" : "") + M.dur(Math.abs(h));
  function bancoHtml(userId, mes, compraId) {
    const b = bancoResumo(userId, mes);
    return `<div class="bh-box" data-bh-user="${userId}" data-bh-mes="${mes}">
      <div class="bh-top"><b>${esc(M.mesNome(mes).replace(/^./, c => c.toUpperCase()))}</b><span class="bh-saldo ${b.saldo < 0 ? "neg" : ""}">Saldo ${hz(b.saldo)}</span></div>
      <div class="mini-kpis"><div><strong>${hz(b.comp)}</strong><small>compradas</small></div><div><strong>${hz(b.usadas)}</strong><small>usadas</small></div><div><strong>${b.aj > 0 ? "+" : ""}${hz(b.aj)}</strong><small>ajustes</small></div></div>
      ${b.pend ? `<p class="muted small">${hz(b.pend)} em compra aguardando confirmação (ainda não entram no saldo).</p>` : ""}
      ${b.usos.length ? `<ul class="cli-res">${b.usos.map(({ r, s }) => `<li><button type="button" class="linkrow" data-open-res="${r.id}"><span><b>${esc(fmtSlot(s))}</b><small>${esc(roomName(s.room_id))} · ${M.dur(s.hora_fim - s.hora_ini)}${r.status === "pendente" ? " · aguardando" : ""}</small></span></button></li>`).join("")}</ul>` : `<p class="muted small">Nenhum horário marcado com este saldo.</p>`}
      ${b.ajs.length ? `<ul class="pays">${b.ajs.map(a => `<li><span>${M.fmtDateTime(new Date(a.created_at))}<small>${esc(a.motivo)}</small></span><b>${a.horas > 0 ? "+" : ""}${hz(Number(a.horas))}</b></li>`).join("")}</ul>` : ""}
      <button type="button" class="btn ghost small" data-bh-ajustar data-compra="${compraId || ""}">Ajustar saldo</button>
      <div class="bh-form"></div></div>`;
  }
  function ajusteForm(box) {
    const f = box.querySelector(".bh-form");
    f.innerHTML = `<form class="dr-payform" novalidate>
      <div class="grid-f">
        <div class="field"><label>Horas (+ ou −)</label><input name="h" type="number" step="0.5" placeholder="Ex.: 2 ou -1,5"></div>
        <div class="field wide"><label>Motivo</label><input name="m" type="text" maxlength="300" placeholder="Ex.: cortesia, horário cancelado pela clínica"></div>
      </div>
      <p class="err" hidden></p>
      <div class="row-actions"><button type="submit" class="btn small">Salvar ajuste</button><button type="button" class="btn ghost small" data-bh-cancel>Cancelar</button></div></form>`;
    const form = f.querySelector("form"), e = f.querySelector(".err");
    f.querySelector("[data-bh-cancel]").onclick = () => f.innerHTML = "";
    form.onsubmit = async ev => {
      ev.preventDefault();
      const h = Number(String(form.h.value).replace(",", ".").replace("−", "-"));
      const btn = form.querySelector("[type=submit]"); btn.disabled = true;
      const { error } = await sb.rpc("ajustar_banco_horas", { p_user: box.dataset.bhUser, p_mes: box.dataset.bhMes, p_horas: h || 0, p_motivo: form.m.value, p_compra: box.querySelector("[data-bh-ajustar]").dataset.compra || null });
      if (error) { btn.disabled = false; e.textContent = error.message; e.hidden = false; return; }
      A().toast("Saldo ajustado.");
      const reopen = $("#drawer").dataset.reopen;
      await reload();
      if (reopen) { const i = reopen.indexOf(":"), k = reopen.slice(0, i), v = reopen.slice(i + 1); k === "res" ? openRes(v) : openCliente(v); }
    };
  }

  window.addEventListener("morada:start", init);
  window.addEventListener("morada:page", e => { current = e.detail; render(); });

  async function init() {
    try {
      [rooms, C] = await Promise.all([M.loadRooms({ includeInactive: true }), M.loadContent()]);
    } catch (e) { return A().fail("Erro ao carregar dados", e); }
    if (!bound) bind();
    bound = true;
    await reload();
    renderStaff();
  }

  async function reload() {
    const { data, error } = await sb.from("reservations")
      .select("*, reservation_slots(id,freq,data,hora_ini,hora_fim,room_id), payments(id,competencia,valor,forma,obs,pago_em)")
      .order("created_at", { ascending: false }).limit(2000);
    if (error) return A().fail("Erro ao carregar reservas", error);
    all = data || [];
    const { data: aj } = await sb.from("ajustes_banco_horas").select("*").order("created_at", { ascending: false }).limit(2000);
    ajustes = aj || [];
    const pend = all.filter(r => st(r) === "pendente").length;
    const b = $("#pend-count"); b.textContent = pend || ""; b.hidden = !pend;
    render();
  }

  function render() {
    if (!all) return;
    if (current === "inicio") renderInicio();
    if (current === "agenda") renderAgenda();
    if (current === "reservas") renderReservas();
    if (current === "clientes") renderClientes();
    if (current === "financeiro") renderFinanceiro();
    if (current === "equipe") renderStaff();
  }

  function bind() {
    $$("[data-view]").forEach(b => b.onclick = () => { agView = b.dataset.view; $$("[data-view]").forEach(x => x.setAttribute("aria-pressed", x === b)); renderAgenda(); });
    $("#ag-prev").onclick = () => { agDate = M.addDays(agDate, agView === "dia" ? -1 : -7); renderAgenda(); };
    $("#ag-next").onclick = () => { agDate = M.addDays(agDate, agView === "dia" ? 1 : 7); renderAgenda(); };
    $("#ag-today").onclick = () => { agDate = startOfDay(new Date()); renderAgenda(); };
    $("#ag-sala").innerHTML = rooms.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
    $("#ag-sala").onchange = renderAgenda;
    $("#cal-grid").addEventListener("click", e => {
      const ev = e.target.closest("[data-res]"); if (ev) return openRes(ev.dataset.res);
      const c = e.target.closest("[data-new]"); if (c) openNew(c.dataset.room, c.dataset.date, +c.dataset.h);
    });
    $$(".chips-f button").forEach(b => b.onclick = () => { rsFilter = b.dataset.f; $$(".chips-f button").forEach(x => x.setAttribute("aria-pressed", x === b)); renderReservas(); });
    $("#rs-q").oninput = renderReservas;
    $("#cl-q").oninput = renderClientes;
    $("#fi-prev").onclick = () => { fiMonth = new Date(fiMonth.getFullYear(), fiMonth.getMonth() - 1, 1); renderFinanceiro(); };
    $("#fi-next").onclick = () => { fiMonth = new Date(fiMonth.getFullYear(), fiMonth.getMonth() + 1, 1); renderFinanceiro(); };
    $("#fi-csv").onclick = downloadCsv;
    document.addEventListener("click", e => {
      const r = e.target.closest("[data-open-res]"); if (r) { e.preventDefault(); openRes(r.dataset.openRes); }
      const c = e.target.closest("[data-open-cli]"); if (c) { e.preventDefault(); openCliente(c.dataset.openCli); }
      const m = e.target.closest("[data-mens]"); if (m) { e.preventDefault(); openMensalidade(m.dataset.mens, m.dataset.comp); }
      const pb = e.target.closest("[data-pay]"); if (pb) { e.preventDefault(); openRes(pb.dataset.pay); $("#dr-actions [data-a=pay-extra]")?.click(); }
      const g = e.target.closest("[data-goto]"); if (g) { e.preventDefault(); A().go(g.dataset.goto); }
    });
    $("#bk-json").onclick = backupJson;
    $("#bk-csv").onclick = backupCsv;
    $("#drawer").addEventListener("click", e => {
      if (e.target.closest("[data-close]")) closeDrawer();
      const aj = e.target.closest("[data-bh-ajustar]"); if (aj) ajusteForm(aj.closest(".bh-box"));
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });
    $("#f-staff").addEventListener("submit", addStaff);
    $("#staff-list").addEventListener("click", removeStaff);
  }

  // ================= INÍCIO =================
  function weekStats() {
    const ws = M.monday(new Date()), days = [0, 1, 2, 3, 4, 5, 6].map(i => M.addDays(ws, i));
    return rooms.filter(r => r.active).map(room => {
      let open = 0, used = 0;
      days.forEach(d => { const o = openOf(d); if (!o) return; open += o[1] - o[0]; dayEvents(d, room.id).forEach(({ s }) => used += s.hora_fim - s.hora_ini); });
      return { room, open, used, pct: open ? Math.round(used / open * 100) : 0 };
    });
  }
  function mensalidades(month) {
    const ms = monthStart(month), me = new Date(ms.getFullYear(), ms.getMonth() + 1, 0), comp = M.iso(ms);
    return all.filter(r => r.status === "confirmada" && fixo(r) && (r.reservation_slots || []).some(s => s.data <= M.iso(me))).map(r => {
      const pay = (r.payments || []).find(p => p.competencia === comp);
      const venc = new Date(ms.getFullYear(), ms.getMonth(), 5, 23, 59);
      const status = pay ? "paga" : new Date() > venc ? "atrasada" : "aberta";
      return { r, comp, pay, status, valor: Number(r.total || 0) };
    });
  }
  function renderInicio() {
    const now = new Date(), today = startOfDay(now);
    const pend = all.filter(r => st(r) === "pendente");
    const recMes = all.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.pago_em); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).reduce((s, p) => s + Number(p.valor), 0);
    const ev = dayEvents(today).filter(x => x.r.plano !== "bloqueio");
    const ws = weekStats(), tot = ws.reduce((a, w) => [a[0] + w.used, a[1] + w.open], [0, 0]);
    const rec = aReceber(), late = rec.filter(atrasado);
    $("#kpis").innerHTML = [
      kpi("Aguardando confirmação", pend.length, pend.length ? "pré-reservas para confirmar" : "Nada pendente", "reservas", pend.length ? "warn" : ""),
      kpi(`Recebido em ${MESES[now.getMonth()]}`, M.money(recMes), "pagamentos registrados", "financeiro"),
      kpi("Atendimentos hoje", ev.length, ev.length ? `${M.dur(ev.reduce((s, x) => s + x.s.hora_fim - x.s.hora_ini, 0))} reservadas` : "Agenda livre", "agenda"),
      kpi("Ocupação da semana", `${tot[1] ? Math.round(tot[0] / tot[1] * 100) : 0}%`, `${M.dur(tot[0])} de ${M.dur(tot[1])} disponíveis`, "agenda"),
      kpi("A receber", M.money(rec.reduce((t, r) => t + M.dueOf(r), 0)), late.length ? `${late.length} pagamento(s) atrasado(s)` : `${rec.length} reserva(s) confirmada(s)`, "financeiro", late.length ? "warn" : "")
    ].join("");
    $$("#kpis [data-go]").forEach(k => k.onclick = () => A().go(k.dataset.go));

    $("#today-label").textContent = `${M.DOW_LONG[now.getDay()]}, ${M.br(now)}`;
    const nowDec = now.getHours() + now.getMinutes() / 60;
    $("#today-list").innerHTML = ev.length ? ev.map(({ r, s }) => `
      <button type="button" class="tl-item ${s.hora_fim <= nowDec ? "past" : s.hora_ini <= nowDec ? "now" : ""}" data-open-res="${r.id}">
        <span class="tl-time">${M.hh(s.hora_ini)}<small>${M.hh(s.hora_fim)}</small></span>
        <span class="tl-body"><b>${esc(r.nome)}</b><small>${esc(roomName(s.room_id))} · ${PLANO[r.plano]}</small></span>${pill(r)}</button>`).join("")
      : `<p class="empty-s">Nenhum atendimento hoje.</p>`;

    const att = [];
    pend.forEach(r => { const h = (now - new Date(r.created_at)) / 36e5; att.push({ w: -h, html: `<button type="button" class="att" data-open-res="${r.id}"><span class="dot ${h > 12 ? "red" : "amber"}"></span><span><b>${esc(r.nome)}</b> aguarda confirmação<small>${esc(roomName(r.room_id))} · ${PLANO[r.plano]} · ${M.money(r.total)} · pedido ${h < 1 ? "agora há pouco" : `há ${Math.floor(h)}h`}</small></span></button>` }); });
    late.forEach(r => att.push({ w: 500, html: `<button type="button" class="att" data-open-res="${r.id}"><span class="dot red"></span><span><b>${esc(r.nome)}</b>: pagamento atrasado<small>${esc(roomName(r.room_id))} · ${PLANO[r.plano]} · falta ${M.money(M.dueOf(r))}</small></span></button>` }));
    const bk = C.ultimo_backup ? new Date(C.ultimo_backup) : null;
    if (!bk || now - bk > 7 * 864e5) att.push({ w: 2000, html: `<button type="button" class="att" data-goto="equipe"><span class="dot amber"></span><span><b>Fazer o backup da semana</b><small>${bk ? `Último backup em ${M.br(bk)}` : "Nenhum backup baixado ainda"} · leva 10 segundos</small></span></button>` });
    $("#attention").innerHTML = att.length ? att.sort((a, b) => a.w - b.w).map(a => a.html).join("") : `<p class="empty-s">Tudo em dia. ✓</p>`;

    $("#occ-bars").innerHTML = ws.length ? ws.map(w => `<div class="bar-row"><span>${esc(w.room.name)}</span><div class="bar"><i style="width:${w.pct}%"></i></div><b>${w.pct}%</b></div>`).join("") : `<p class="empty-s">Nenhuma sala ativa.</p>`;

    const months = [5, 4, 3, 2, 1, 0].map(i => new Date(now.getFullYear(), now.getMonth() - i, 1));
    const vals = months.map(m => all.flatMap(r => r.payments || []).filter(p => { const d = new Date(p.pago_em); return d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear(); }).reduce((s, p) => s + Number(p.valor), 0));
    const max = Math.max(...vals, 1);
    $("#rev-chart").innerHTML = months.map((m, i) => `<div class="rev-col" title="${M.money(vals[i])}"><span class="rev-v">${vals[i] ? M.money(vals[i]).replace(",00", "") : ""}</span><div class="rev-bar ${i === 5 ? "cur" : ""}" style="height:${Math.max(2, vals[i] / max * 100)}%"></div><span class="rev-m">${MESES[m.getMonth()].slice(0, 3)}</span></div>`).join("");
  }
  function kpi(label, value, sub, go, cls = "") {
    return `<button type="button" class="kpi ${cls}" data-go="${go}"><span class="kpi-l">${label}</span><strong>${value}</strong><small>${sub}</small></button>`;
  }

  // ================= AGENDA =================
  function renderAgenda() {
    const grid = $("#cal-grid");
    $("#ag-sala").hidden = agView !== "semana";
    if (!$("#ag-sala").value && rooms[0]) $("#ag-sala").value = rooms[0].id;
    let cols, label;
    if (agView === "dia") {
      cols = rooms.filter(r => r.active || dayEvents(agDate, r.id).length).map(r => ({ key: r.id, label: r.name, room: r.id, date: agDate }));
      label = `${M.DOW_LONG[agDate.getDay()]}, ${agDate.getDate()} de ${MESES[agDate.getMonth()]}`;
    } else {
      const ws = M.monday(agDate);
      cols = [0, 1, 2, 3, 4, 5, 6].map(i => M.addDays(ws, i)).filter(d => openOf(d)).map(d => ({ key: M.iso(d), label: `${M.DOW_NAME[d.getDay()]} ${M.br(d)}`, room: $("#ag-sala").value, date: d }));
      label = `Semana de ${M.br(ws)} a ${M.br(M.addDays(ws, 6))}`;
    }
    $("#ag-label").textContent = label.charAt(0).toUpperCase() + label.slice(1);
    const opens = cols.map(c => openOf(c.date)).filter(Boolean);
    if (!cols.length || !opens.length) { grid.style.gridTemplateColumns = ""; grid.innerHTML = `<p class="empty-s">${agView === "dia" ? "A clínica não abre neste dia." : "Nenhuma sala cadastrada."}</p>`; return; }
    const h0 = Math.min(...opens.map(o => o[0])), h1 = Math.max(...opens.map(o => o[1]));
    grid.style.gridTemplateColumns = `52px repeat(${cols.length}, minmax(120px, 1fr))`;
    grid.style.gridTemplateRows = `auto repeat(${(h1 - h0) * 2}, 27px)`;
    const row = t => Math.round((t - h0) * 2) + 2;
    const now = new Date();
    let html = `<div class="cg-corner"></div>` + cols.map((c, i) => `<div class="cg-head ${M.iso(c.date) === todayIso() && agView === "semana" ? "today" : ""}" style="grid-column:${i + 2}">${esc(c.label)}</div>`).join("");
    for (let h = h0; h < h1; h++) html += `<div class="cg-hour" style="grid-row:${row(h)} / span 2">${h}h</div>`;
    cols.forEach((c, i) => {
      const o = openOf(c.date);
      for (let h = h0; h < h1; h += 0.5) {
        const closed = !o || h < o[0] || h >= o[1];
        const past = new Date(c.date.getFullYear(), c.date.getMonth(), c.date.getDate(), Math.floor(h), (h % 1) * 60 + 30) < now;
        html += closed ? `<div class="cg-cell closed ${h % 1 ? "half" : ""}" style="grid-column:${i + 2};grid-row:${row(h)}"></div>`
          : `<button type="button" class="cg-cell ${past ? "past" : ""} ${h % 1 ? "half" : ""}" style="grid-column:${i + 2};grid-row:${row(h)}" data-new data-room="${c.room}" data-date="${M.iso(c.date)}" data-h="${h}" aria-label="Criar reserva ${c.label} às ${M.hh(h)}"><span>+</span></button>`;
      }
      dayEvents(c.date, c.room).forEach(({ r, s }) => {
        const cls = (r.plano === "bloqueio" ? "blk" : st(r) === "pendente" ? "pend" : "conf") + (r.usa_banco_de ? " bh" : "");
        const a = Math.max(Number(s.hora_ini), h0), b = Math.min(Number(s.hora_fim), h1); if (b <= a) return;
        html += `<button type="button" class="cg-ev ${cls} ${b - a <= 0.5 ? "short" : ""}" style="grid-column:${i + 2};grid-row:${row(a)} / ${row(b)}" data-res="${r.id}">
          <b>${esc(r.plano === "bloqueio" ? r.nome : first(r.nome) + " " + (r.nome.split(" ").slice(-1)[0] || ""))}</b><small>${M.hh(s.hora_ini)}–${M.hh(s.hora_fim)} · ${r.usa_banco_de ? "Banco de horas" : PLANO[r.plano]}</small>${r.usa_banco_de ? `<i class="ev-selo">Banco de horas</i>` : ""}</button>`;
      });
    });
    grid.innerHTML = html;
  }

  // ================= RESERVAS =================
  function matches(r, q) {
    if (!q) return true;
    const d = M.onlyDigits(q), t = q.toLowerCase();
    return (r.nome || "").toLowerCase().includes(t) || (r.codigo || "").toLowerCase().includes(t) || (r.email || "").toLowerCase().includes(t)
      || (d.length >= 3 && (M.onlyDigits(r.telefone).includes(d) || (r.cpf || "").includes(d)));
  }
  function renderReservas() {
    const q = $("#rs-q").value.trim();
    const list = all.filter(r => {
      const s = st(r);
      if (rsFilter === "pendente" && s !== "pendente") return false;
      if (rsFilter === "confirmada" && s !== "confirmada") return false;
      if (rsFilter === "encerradas" && !["recusada", "cancelada", "expirada"].includes(s)) return false;
      if (rsFilter === "bloqueio" && !(s === "bloqueio" && r.status === "confirmada")) return false;
      if (rsFilter !== "bloqueio" && rsFilter !== "todas" && s === "bloqueio") return false;
      return matches(r, q);
    });
    if (rsFilter === "pendente") list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    $("#rs-table").innerHTML = `<thead><tr><th>Cliente</th><th>Sala e plano</th><th>Horários</th><th class="num">Valor</th><th>Status</th><th>Pedido em</th></tr></thead><tbody>${
      list.length ? list.map(r => `<tr data-open-res="${r.id}" tabindex="0">
        <td><b>${esc(r.nome)}</b><small>${r.plano === "bloqueio" ? "Uso da clínica" : `${esc(r.codigo)} · ${r.user_id ? "com conta" : "visitante"}`}</small></td>
        <td>${esc(roomName(r.room_id))}<small>${PLANO[r.plano]}</small></td>
        <td class="clip">${esc(slotsText(r)[0] || "A combinar")}${(r.reservation_slots || []).length > 1 ? `<small>+${r.reservation_slots.length - 1} horário(s)</small>` : ""}</td>
        <td class="num">${r.usa_banco_de ? `—<small>Banco de horas</small>` : `${r.total ? M.money(r.total) : "—"}${r.plano !== "bloqueio" ? `<small>${FORMA_ESC[r.forma_escolhida] || "Pix"}</small>` : ""}`}</td>
        <td>${pill(r)}</td>
        <td>${M.fmtDateTime(new Date(r.created_at))}</td></tr>`).join("")
      : `<tr><td colspan="6" class="empty-s">Nenhuma reserva aqui.</td></tr>`}</tbody>`;
  }

  // ================= CLIENTES =================
  function clientes() {
    const map = new Map();
    all.filter(r => r.plano !== "bloqueio").forEach(r => {
      const key = r.cpf || (r.email || "").toLowerCase() || M.onlyDigits(r.telefone).slice(-8) || r.id;
      const c = map.get(key) || { key, nome: r.nome, telefone: r.telefone, email: r.email, cpf: r.cpf, conta: false, res: [], pago: 0, last: r.created_at };
      c.res.push(r); c.pago += paidTotal(r); c.conta ||= !!r.user_id; c.userId ||= r.user_id || null;
      if (r.created_at >= c.last) { c.last = r.created_at; c.nome = r.nome; c.telefone = r.telefone || c.telefone; c.email = r.email || c.email; }
      map.set(key, c);
    });
    return [...map.values()].sort((a, b) => b.last.localeCompare(a.last));
  }
  function renderClientes() {
    const q = $("#cl-q").value.trim().toLowerCase(), d = M.onlyDigits(q);
    const list = clientes().filter(c => !q || c.nome.toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q) || (d.length >= 3 && ((c.cpf || "").includes(d) || M.onlyDigits(c.telefone).includes(d))));
    $("#cl-table").innerHTML = `<thead><tr><th>Cliente</th><th>Contato</th><th class="num">Reservas</th><th class="num">Total pago</th><th>Última reserva</th></tr></thead><tbody>${
      list.length ? list.map(c => `<tr data-open-cli="${esc(c.key)}" tabindex="0">
        <td><b>${esc(c.nome)}</b><small>${c.cpf ? esc(M.cpfFormat(c.cpf)) : "sem CPF"}${c.conta ? " · com conta" : ""}</small></td>
        <td>${esc(c.telefone)}<small>${esc(c.email)}</small></td>
        <td class="num">${c.res.length}<small>${c.res.filter(r => r.status === "confirmada").length} confirmada(s)</small></td>
        <td class="num">${M.money(c.pago)}</td>
        <td>${M.fmtDateTime(new Date(c.last))}</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty-s">Nenhum cliente ainda.</td></tr>`}</tbody>`;
  }

  // ================= FINANCEIRO =================
  function paymentsOfMonth(m) {
    return all.flatMap(r => (r.payments || []).map(p => ({ ...p, r }))).filter(p => { const d = new Date(p.pago_em); return d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear(); })
      .sort((a, b) => new Date(b.pago_em) - new Date(a.pago_em));
  }
  function renderFinanceiro() {
    $("#fi-label").textContent = `${MESES[fiMonth.getMonth()].replace(/^./, c => c.toUpperCase())} de ${fiMonth.getFullYear()}`;
    const pays = paymentsOfMonth(fiMonth);
    const rec = pays.reduce((s, p) => s + Number(p.valor), 0);
    const pend = all.filter(r => st(r) === "pendente");
    const open = aReceber().sort((a, b) => (atrasado(b) - atrasado(a)) || String((a.reservation_slots || [])[0]?.data).localeCompare(String((b.reservation_slots || [])[0]?.data)));
    const late = open.filter(atrasado);
    $("#fi-kpis").innerHTML = [
      kpi("Recebido no mês", M.money(rec), `${pays.length} pagamento(s)`, "financeiro"),
      kpi("A receber", M.money(open.reduce((t, r) => t + M.dueOf(r), 0)), `${open.length} reserva(s) confirmada(s)`, "financeiro", late.length ? "warn" : ""),
      kpi("Aguardando confirmação", pend.length, pend.length ? `${M.money(pend.reduce((t, r) => t + Number(r.total || 0), 0))} se confirmadas` : "Nada pendente", "reservas", pend.length ? "warn" : "")
    ].join("");
    $$("#fi-kpis [data-go]").forEach(k => k.onclick = () => A().go(k.dataset.go));
    $("#fi-mens").innerHTML = `<thead><tr><th>Cliente</th><th>Sala e plano</th><th class="num">Em aberto</th><th>Vencimento</th><th></th></tr></thead><tbody>${
      open.length ? open.map(r => `<tr>
        <td><b>${esc(r.nome)}</b><small>${esc(r.telefone)}</small></td>
        <td>${esc(roomName(r.room_id))}<small>${PLANO[r.plano]} · ${esc(slotsText(r)[0] || "")}${(r.reservation_slots || []).length > 1 ? ` +${r.reservation_slots.length - 1}` : ""}</small></td>
        <td class="num">${M.money(M.dueOf(r))}<small>${FORMA_ESC[r.forma_escolhida] || "Pix"}${M.paidOf(r) > 0 ? ` · de ${M.money(r.total)}` : ""}</small></td>
        <td>${atrasado(r) ? `<span class="pill p-late">Atrasado</span>` : esc(M.dueText(r))}</td>
        <td class="act"><button type="button" class="btn small" data-pay="${r.id}">Registrar</button>
          <a class="btn ghost small" target="_blank" rel="noopener" href="${waLink(r, r.forma_escolhida === "link" ? "link" : "cobranca")}">${r.forma_escolhida === "link" ? (r.link_pagamento ? "Reenviar link" : "Enviar link") : "Cobrar"}</a></td></tr>`).join("")
      : `<tr><td colspan="5" class="empty-s">Nada em aberto. ✓</td></tr>`}</tbody>`;
    $("#fi-pays").innerHTML = `<thead><tr><th>Data</th><th>Cliente</th><th>Referência</th><th>Forma</th><th class="num">Valor</th></tr></thead><tbody>${
      pays.length ? pays.map(p => `<tr data-open-res="${p.r.id}" tabindex="0">
        <td>${M.fmtDateTime(new Date(p.pago_em))}</td><td><b>${esc(p.r.nome)}</b><small>${esc(roomName(p.r.room_id))}</small></td>
        <td>${p.competencia ? `Horas antecipadas de ${MESES[M.parse(p.competencia).getMonth()]}` : PLANO[p.r.plano]}<small>${esc(p.r.codigo)}</small></td>
        <td>${esc(p.forma || "—")}</td><td class="num">${M.money(p.valor)}</td></tr>`).join("")
      : `<tr><td colspan="5" class="empty-s">Nenhum pagamento registrado neste mês.</td></tr>`}</tbody>`;
  }
  function waCobrancaMensal(m) {
    const mes = MESES[M.parse(m.comp).getMonth()];
    const msg = `Olá, ${first(m.r.nome)}! Tudo bem? Passando para lembrar da mensalidade de ${mes} da ${roomName(m.r.room_id)} (${PLANO[m.r.plano].toLowerCase()}): ${M.money(m.valor)}.${C.pix_chave ? `\nPix: ${C.pix_chave} (${C.pix_nome || ""})` : ""}\nDepois é só mandar o comprovante por aqui. Obrigada!`;
    return `https://wa.me/${waNum(m.r.telefone)}?text=${encodeURIComponent(msg)}`;
  }
  function downloadCsv() {
    const pays = paymentsOfMonth(fiMonth);
    const rows = [["Data", "Cliente", "CPF", "Sala", "Plano", "Referência", "Forma", "Valor", "Código"]].concat(pays.map(p => [
      new Date(p.pago_em).toLocaleString("pt-BR"), p.r.nome, p.r.cpf ? M.cpfFormat(p.r.cpf) : "", roomName(p.r.room_id), PLANO[p.r.plano],
      p.competencia ? `Horas antecipadas ${MESES[M.parse(p.competencia).getMonth()]}` : "Reserva", p.forma, String(p.valor).replace(".", ","), p.r.codigo]));
    const csv = "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `pagamentos-${fiMonth.getFullYear()}-${M.pad(fiMonth.getMonth() + 1)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ================= PAINEL LATERAL =================
  function openDrawer(title, html) {
    $("#dr-title").textContent = title; $("#dr-body").innerHTML = html;
    $("#drawer").hidden = false; document.body.classList.add("noscroll");
    setTimeout(() => $("#drawer .drawer-panel").classList.add("in"), 10);
  }
  function closeDrawer() { $("#drawer .drawer-panel").classList.remove("in"); $("#drawer").hidden = true; document.body.classList.remove("noscroll"); }

  function waLink(r, kind) {
    const resumo = slotsText(r).join("\n");
    const due = M.dueOf(r), isLink = r.forma_escolhida === "link";
    const pix = isLink ? "" : C.pix_chave ? `\nPix (CNPJ): ${C.pix_chave}\nClínica de Psicologia Morada do Ser Ltda` : "";
    const comoPagar = isLink ? (r.link_pagamento ? `\nLink de pagamento (cartão de crédito): ${r.link_pagamento}` : "\nVamos te enviar o link de pagamento (cartão de crédito) por aqui.") : pix;
    const msgs = {
      cobranca: `Olá, ${first(r.nome)}! Tudo bem? Passando para lembrar do pagamento da reserva ${r.codigo} na Clínica Morada do Ser.\n${roomName(r.room_id)} · ${PLANO[r.plano]}\n${resumo}\nValor em aberto: ${M.money(due)} (${M.dueText(r)})${comoPagar}${isLink ? "" : "\nDepois é só mandar o comprovante por aqui."} Obrigada!`,
      link: `Olá, ${first(r.nome)}! Segue o link de pagamento (cartão de crédito) da sua reserva ${r.codigo} na Clínica Morada do Ser:\n${r.link_pagamento || "[cole o link aqui]"}\n${roomName(r.room_id)} · ${PLANO[r.plano]}\n${resumo}\nValor: ${M.money(due)} (${M.dueText(r)}).\nQualquer dúvida, é só chamar por aqui.`,
      confirmada: `Olá, ${first(r.nome)}! Sua reserva na Clínica Morada do Ser (código ${r.codigo}) está confirmada.\n${roomName(r.room_id)} · ${PLANO[r.plano]}\n${resumo}\n${due > 0 ? `Valor: ${M.money(due)}, a pagar ${M.dueText(r)}.${comoPagar}\n` : "Pagamento recebido, obrigada!\n"}Qualquer dúvida, é só chamar por aqui.`,
      recusada: `Olá, ${first(r.nome)}! Infelizmente não conseguimos confirmar sua pré-reserva (código ${r.codigo}) na Clínica Morada do Ser. Podemos ver outro horário para você?`,
      cancelada: `Olá, ${first(r.nome)}! Sua reserva (código ${r.codigo}) na Clínica Morada do Ser foi cancelada.`,
      livre: `Olá, ${first(r.nome)}! Aqui é da Clínica Morada do Ser, sobre sua reserva ${r.codigo}.`
    };
    return `https://wa.me/${waNum(r.telefone)}?text=${encodeURIComponent(msgs[kind] || msgs.livre)}`;
  }

  function openRes(id) {
    const r = all.find(x => x.id === id); if (!r) return;
    const s = st(r), isB = r.plano === "bloqueio";
    const pays = (r.payments || []).slice().sort((a, b) => new Date(b.pago_em) - new Date(a.pago_em));
    const html = `
      <div class="dr-top">${pill(r)}${isB ? "" : `<span class="tag">${r.user_id ? "Com conta" : "Visitante"}</span><span class="muted small">Código <b>${esc(r.codigo)}</b></span>`}</div>
      ${isB ? "" : `<section class="dr-sec"><h3>Cliente</h3>
        <dl class="dl">
          <dt>Telefone</dt><dd><a href="https://wa.me/${waNum(r.telefone)}" target="_blank" rel="noopener">${esc(r.telefone)}</a></dd>
          <dt>E-mail</dt><dd>${r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : "—"}</dd>
          <dt>CPF</dt><dd>${r.cpf ? esc(M.cpfFormat(r.cpf)) : "—"}</dd>
          <dt>Profissão</dt><dd>${esc(r.profissao || "—")}${r.registro ? ` · ${esc(r.registro)}` : ""}</dd>
        </dl>
        ${r.cpf || r.email ? `<button type="button" class="linkbtn" data-open-cli="${esc(r.cpf || r.email.toLowerCase())}">Ver histórico do cliente</button>` : ""}</section>`}
      <section class="dr-sec"><h3>${isB ? "Bloqueio" : "Reserva"}</h3>
        <dl class="dl">
          <dt>Sala</dt><dd>${esc(roomName(r.room_id))}</dd>
          <dt>Plano</dt><dd>${PLANO[r.plano]}</dd>
          <dt>Horários</dt><dd><ul class="ul">${(slotsText(r).length ? slotsText(r) : ["A combinar"]).map(l => `<li>${esc(l)}</li>`).join("")}</ul></dd>
          ${isB ? "" : `<dt>Valor</dt><dd><b>${r.total ? M.money(r.total) : "—"}</b>${r.desconto_pct > 0 ? ` <span class="tag">−${r.desconto_pct}% desconto</span>` : ""}${r.total && M.dueOf(r) > 0 ? ` · em aberto ${M.money(M.dueOf(r))} (${atrasado(r) ? "atrasado" : M.dueText(r)})` : r.total ? " · pago" : ""}</dd>`}
          <dt>Pedido em</dt><dd>${M.fmtDateTime(new Date(r.created_at))}</dd>
          ${r.obs ? `<dt>Observação</dt><dd>${esc(r.obs)}</dd>` : ""}
        </dl>
      </section>
      ${M.isCompraBanco(r) || r.usa_banco_de ? `<section class="dr-sec"><h3>Banco de horas</h3>
        ${r.usa_banco_de ? `<p class="small">Horário marcado com o saldo da compra <button type="button" class="linkbtn" data-open-res="${r.usa_banco_de}">${esc(all.find(x => x.id === r.usa_banco_de)?.codigo || "ver compra")}</button>. Cancelado, as horas voltam ao saldo.</p>` : ""}
        ${r.user_id ? bancoHtml(r.user_id, r.mes_referencia || (r.reservation_slots || [])[0]?.data.slice(0, 8) + "01", M.isCompraBanco(r) ? r.id : r.usa_banco_de)
          : `<p class="muted small">Compra sem conta vinculada: o saldo só aparece para clientes com conta.</p>`}</section>` : ""}
      ${isB || r.usa_banco_de ? "" : `<section class="dr-sec"><h3>Forma de pagamento</h3>
        <div class="grid-f">
          <div class="field wide"><label for="dr-forma">Cliente escolheu</label><select id="dr-forma"><option value="pix" ${r.forma_escolhida !== "link" ? "selected" : ""}>Pix</option><option value="link" ${r.forma_escolhida === "link" ? "selected" : ""}>Cartão de crédito (link)</option></select></div>
        </div>
        <div id="dr-link-w" ${r.forma_escolhida === "link" ? "" : "hidden"}>
          <div class="field"><label for="dr-link">Link de pagamento</label><input id="dr-link" type="url" inputmode="url" placeholder="Cole aqui o link (Mercado Pago, InfinitePay, PagSeguro…)" value="${esc(r.link_pagamento || "")}"></div>
          <p class="muted small">Salvo aqui, o link também aparece para o cliente em Minha conta, no botão "Pagar com cartão".</p>
          <div class="row-actions"><button type="button" class="btn small" id="dr-link-save">Salvar link</button>
            <a class="btn ghost small" id="dr-link-wa" target="_blank" rel="noopener" href="${waLink(r, "link")}">Enviar link pelo WhatsApp</a></div>
        </div></section>
      <section class="dr-sec"><h3>Pagamentos</h3>${pays.length ? `<ul class="pays">${pays.map(p => `<li><span>${M.fmtDateTime(new Date(p.pago_em))}<small>${p.competencia ? `Horas antecipadas de ${MESES[M.parse(p.competencia).getMonth()]}` : "Reserva"} · ${esc(p.forma || "—")}${p.obs ? ` · ${esc(p.obs)}` : ""}</small></span><b>${M.money(p.valor)}</b></li>`).join("")}</ul>` : `<p class="muted small">Nenhum pagamento registrado.</p>`}</section>`}
      <div class="dr-actions" id="dr-actions">${resActions(r)}</div>
      <div id="dr-form"></div>`;
    openDrawer(isB ? r.nome : r.nome, html);
    $("#drawer").dataset.reopen = `res:${r.id}`;
    $("#dr-actions").onclick = e => onResAction(e, r);
    if (!isB && !r.usa_banco_de) {
      $("#dr-forma").onchange = async e => {
        const v = e.target.value;
        const { error } = await sb.from("reservations").update({ forma_escolhida: v }).eq("id", r.id);
        if (error) return A().fail("Erro ao salvar", error);
        r.forma_escolhida = v; $("#dr-link-w").hidden = v !== "link";
        $("#dr-link-wa").href = waLink(r, "link"); A().toast("Forma de pagamento atualizada.");
      };
      $("#dr-link").oninput = () => { r.link_pagamento = $("#dr-link").value.trim(); $("#dr-link-wa").href = waLink(r, "link"); };
      $("#dr-link-save").onclick = async () => {
        const v = $("#dr-link").value.trim();
        if (v && !/^https?:\/\/\S+$/i.test(v)) return A().toast("Cole o link completo, começando com https://", true);
        const { error } = await sb.from("reservations").update({ link_pagamento: v }).eq("id", r.id);
        if (error) return A().fail("Erro ao salvar", error);
        r.link_pagamento = v; A().toast(v ? "Link salvo. O cliente já vê o botão Pagar com cartão." : "Link removido.");
        const local = all.find(x => x.id === r.id); if (local) local.link_pagamento = v;
      };
    }
  }

  function resActions(r) {
    const s = st(r);
    if (r.plano === "bloqueio") return r.status === "confirmada" ? `<button type="button" class="btn ghost" data-a="ask-cancel">Remover bloqueio</button>` : "";
    if (s === "pendente" || s === "expirada") return `
      <button type="button" class="btn" data-a="confirm">Confirmar reserva</button>
      <button type="button" class="btn ghost" data-a="pay-confirm">Confirmar e registrar pagamento</button>
      <button type="button" class="linkbtn danger-text" data-a="ask-refuse">Recusar</button>`;
    if (s === "confirmada") return `
      ${M.dueOf(r) > 0 ? `<button type="button" class="btn" data-a="pay-extra">Registrar pagamento</button>
      <a class="btn ghost" target="_blank" rel="noopener" href="${waLink(r, r.forma_escolhida === "link" ? "link" : "cobranca")}">${r.forma_escolhida === "link" ? "Enviar link pelo WhatsApp" : "Cobrar no WhatsApp"}</a>` : ""}
      <a class="btn ghost" target="_blank" rel="noopener" href="${waLink(r, "confirmada")}">Mensagem de confirmação</a>
      <button type="button" class="linkbtn danger-text" data-a="ask-cancel">Cancelar reserva</button>`;
    return `<a class="btn ghost" target="_blank" rel="noopener" href="${waLink(r, "livre")}">Falar no WhatsApp</a>`;
  }

  function payForm(r, { withMonth, label }) {
    const now = new Date();
    const months = [-1, 0, 1, 2].map(i => new Date(now.getFullYear(), now.getMonth() + i, 1));
    const paidComps = new Set((r.payments || []).map(p => p.competencia).filter(Boolean));
    return `<form class="dr-payform" id="payform" novalidate>
      ${withMonth ? `<div class="field"><label for="pf-comp">Mês de referência</label><select id="pf-comp">${months.map(m => { const v = M.iso(m); return `<option value="${v}" ${paidComps.has(v) ? "disabled" : ""} ${m.getMonth() === now.getMonth() && !paidComps.has(v) ? "selected" : ""}>${MESES[m.getMonth()]} ${m.getFullYear()}${paidComps.has(v) ? " (paga)" : ""}</option>`; }).join("")}</select></div>` : ""}
      <div class="field"><label for="pf-forma">Forma de pagamento</label><select id="pf-forma">${FORMAS.map(f => `<option ${f === (r.forma_escolhida === "link" ? "Link de pagamento" : "Pix") ? "selected" : ""}>${f}</option>`).join("")}</select></div>
      <div class="field"><label for="pf-valor">Valor recebido (R$)</label><input id="pf-valor" type="number" step="0.01" min="0" value="${M.dueOf(r) || ""}"></div>
      <div class="field"><label for="pf-obs">Observação</label><input id="pf-obs" type="text" placeholder="Opcional"></div>
      <div class="row-actions"><button type="submit" class="btn">${label}</button><button type="button" class="btn ghost" data-a="back">Cancelar</button></div></form>`;
  }

  async function onResAction(e, r) {
    const b = e.target.closest("[data-a]"); if (!b) return;
    const a = b.dataset.a, form = $("#dr-form"), acts = $("#dr-actions");
    const ask = (txt, yes, lbl) => { acts.innerHTML = `<p class="small">${txt}</p><button type="button" class="btn danger" data-a="${yes}">${lbl}</button><button type="button" class="btn ghost" data-a="back">Voltar</button>`; };
    if (a === "back") { acts.innerHTML = resActions(r); form.innerHTML = ""; return; }
    if (a === "ask-refuse") return ask("Recusar esta pré-reserva? Os horários voltam a ficar livres.", "refuse", "Recusar");
    if (a === "ask-cancel") return ask(r.plano === "bloqueio" ? "Remover este bloqueio?" : "Cancelar esta reserva? Os horários voltam a ficar livres.", "cancel", r.plano === "bloqueio" ? "Remover" : "Cancelar reserva");
    if (a === "confirm") {
      b.disabled = true;
      const { error } = await sb.rpc("confirm_reservation", { p_id: r.id, p_forma: null, p_valor: null, p_obs: null });
      if (error) { b.disabled = false; return A().toast(error.message, true); }
      A().toast("Reserva confirmada.");
      await reload(); openRes(r.id);
      const nr = all.find(x => x.id === r.id);
      $("#dr-actions").insertAdjacentHTML("afterbegin", `<p class="note ok">Reserva confirmada. <a href="${waLink(nr, "confirmada")}" target="_blank" rel="noopener">Avisar no WhatsApp →</a></p>`);
      return;
    }
    if (a === "pay-confirm" || a === "pay-month" || a === "pay-extra") {
      acts.innerHTML = "";
      form.innerHTML = payForm(r, { withMonth: a === "pay-month", label: a === "pay-confirm" ? "Confirmar reserva" : "Registrar" });
      form.querySelector("[data-a=back]").onclick = () => { form.innerHTML = ""; acts.innerHTML = resActions(r); };
      $("#payform").onsubmit = async ev => {
        ev.preventDefault();
        const btn = ev.submitter || $("#payform button[type=submit]"); btn.disabled = true;
        const v = $("#pf-valor").value === "" ? null : Number($("#pf-valor").value);
        const { error } = a === "pay-confirm"
          ? await sb.rpc("confirm_reservation", { p_id: r.id, p_forma: $("#pf-forma").value, p_valor: v, p_obs: $("#pf-obs").value })
          : await sb.rpc("register_payment", { p_res: r.id, p_competencia: a === "pay-month" ? $("#pf-comp").value : null, p_valor: v, p_forma: $("#pf-forma").value, p_obs: $("#pf-obs").value });
        if (error) { btn.disabled = false; return A().toast(error.message, true); }
        A().toast(a === "pay-confirm" ? "Reserva confirmada." : "Pagamento registrado.");
        await reload(); openRes(r.id);
        if (a === "pay-confirm") { const nr = all.find(x => x.id === r.id); $("#dr-actions").insertAdjacentHTML("afterbegin", `<p class="note ok">Reserva confirmada. <a href="${waLink(nr, "confirmada")}" target="_blank" rel="noopener">Avisar no WhatsApp →</a></p>`); }
      };
      return;
    }
    if (a === "refuse" || a === "cancel") {
      b.disabled = true;
      const status = a === "refuse" ? "recusada" : "cancelada";
      const { error } = await sb.from("reservations").update({ status, decided_at: new Date().toISOString(), ...(status === "cancelada" ? { cancelado_por: "clinica" } : {}) }).eq("id", r.id);
      if (error) { b.disabled = false; return A().fail("Erro ao atualizar", error); }
      A().toast(r.plano === "bloqueio" ? "Bloqueio removido." : `Reserva ${status}.`);
      await reload();
      if (r.plano === "bloqueio") return closeDrawer();
      openRes(r.id);
      $("#dr-actions").innerHTML = `<p class="note">Avise a pessoa: <a href="${waLink(r, status)}" target="_blank" rel="noopener">enviar mensagem no WhatsApp →</a></p>`;
    }
  }

  function openMensalidade(resId, comp) {
    openRes(resId);
    const r = all.find(x => x.id === resId);
    $("#dr-actions").innerHTML = "";
    $("#dr-form").innerHTML = payForm(r, { withMonth: true, label: "Registrar" });
    if (comp) $("#pf-comp").value = comp;
    $("#dr-form [data-a=back]").onclick = () => { $("#dr-form").innerHTML = ""; $("#dr-actions").innerHTML = resActions(r); };
    $("#payform").onsubmit = async ev => {
      ev.preventDefault();
      const { error } = await sb.rpc("register_payment", { p_res: r.id, p_competencia: $("#pf-comp").value, p_valor: $("#pf-valor").value === "" ? null : Number($("#pf-valor").value), p_forma: $("#pf-forma").value, p_obs: $("#pf-obs").value });
      if (error) return A().toast(error.message, true);
      A().toast("Mensalidade registrada."); await reload(); openRes(r.id);
    };
  }

  function openCliente(key) {
    const c = clientes().find(x => x.key === key || x.cpf === key || (x.email || "").toLowerCase() === key);
    if (!c) return;
    openDrawer(c.nome, `
      <div class="dr-top">${c.conta ? `<span class="tag">Com conta</span>` : `<span class="tag">Visitante</span>`}</div>
      <section class="dr-sec"><h3>Contato</h3><dl class="dl">
        <dt>Telefone</dt><dd><a href="https://wa.me/${waNum(c.telefone)}" target="_blank" rel="noopener">${esc(c.telefone)}</a></dd>
        <dt>E-mail</dt><dd>${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</dd>
        <dt>CPF</dt><dd>${c.cpf ? esc(M.cpfFormat(c.cpf)) : "—"}</dd></dl></section>
      <section class="dr-sec"><h3>Resumo</h3><div class="mini-kpis"><div><strong>${c.res.length}</strong><small>reservas</small></div><div><strong>${c.res.filter(r => r.status === "confirmada").length}</strong><small>confirmadas</small></div><div><strong>${M.money(c.pago)}</strong><small>pago no total</small></div></div></section>
      <section class="dr-sec"><h3>Reservas</h3><ul class="cli-res">${c.res.map(r => `<li><button type="button" class="linkrow" data-open-res="${r.id}"><span><b>${esc(roomName(r.room_id))}</b> · ${PLANO[r.plano]}<small>${esc(slotsText(r)[0] || "")}</small></span>${pill(r)}</button></li>`).join("")}</ul></section>
      ${c.userId && bancoMeses(c.userId).length ? `<section class="dr-sec"><h3>Banco de horas</h3>${
        [...new Set([mesDe(new Date()), ...bancoMeses(c.userId)])].sort().reverse().slice(0, 4).map(m => bancoHtml(c.userId, m, all.find(r => M.isCompraBanco(r) && r.user_id === c.userId && r.mes_referencia === m && r.status === "confirmada")?.id)).join("")}</section>` : ""}
      <div class="dr-actions"><a class="btn ghost" href="https://wa.me/${waNum(c.telefone)}" target="_blank" rel="noopener">Falar no WhatsApp</a></div>`);
    $("#drawer").dataset.reopen = `cli:${c.key}`;
  }

  // nova reserva / bloqueio a partir da agenda
  function openNew(roomId, date, h) {
    const d = M.parse(date), o = openOf(d) || [h, h + 1];
    const hopt = (sel, from, to) => Array.from({ length: Math.round((to - from) * 2) + 1 }, (_, i) => from + i / 2).map(x => `<option value="${x}" ${x === sel ? "selected" : ""}>${M.hh(x)}</option>`).join("");
    openDrawer("Novo horário", `
      <div class="seg-a" role="tablist"><button type="button" data-k="res" aria-pressed="true">Reserva de cliente</button><button type="button" data-k="blk" aria-pressed="false">Bloquear (uso da clínica)</button></div>
      <form id="nf" class="dr-payform" novalidate>
        <div class="grid-f">
          <div class="field"><label for="nf-sala">Sala</label><select id="nf-sala">${rooms.map(r => `<option value="${r.id}" ${r.id === roomId ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select></div>
          <div class="field"><label for="nf-data">Data</label><input id="nf-data" type="date" value="${date}"></div>
          <div class="field"><label for="nf-ini">Das</label><select id="nf-ini">${hopt(h, o[0], o[1] - 0.5)}</select></div>
          <div class="field"><label for="nf-fim">Até</label><select id="nf-fim">${hopt(Math.min(h + 1, o[1]), o[0] + 0.5, o[1])}</select></div>
          <div class="field wide"><label for="nf-freq">Repetir</label><select id="nf-freq"><option value="unica">Não repetir</option><option value="semanal">Toda semana</option><option value="quinzenal">A cada 15 dias</option></select></div>
        </div>
        <div id="nf-res" class="grid-f">
          <div class="field wide"><label for="nf-nome">Nome do cliente</label><input id="nf-nome" type="text" required></div>
          <div class="field"><label for="nf-tel">Telefone</label><input id="nf-tel" type="tel"></div>
          <div class="field"><label for="nf-cpf">CPF</label><input id="nf-cpf" type="text" inputmode="numeric" data-cpf></div>
          <div class="field wide"><label for="nf-email">E-mail</label><input id="nf-email" type="email"></div>
          <div class="field"><label for="nf-plano">Plano</label><select id="nf-plano"><option value="avulso">Hora avulsa</option><option value="periodo">Período de 4h</option><option value="pacote">Horas antecipadas</option></select></div>
          <div class="field"><label for="nf-valor">Valor (R$)</label><input id="nf-valor" type="number" step="0.01" min="0"></div>
          <div class="field wide"><label for="nf-status">Pagamento</label><select id="nf-status"><option value="confirmada">Confirmar agora, pagamento depois</option><option value="pago">Confirmar agora, já pagou</option><option value="pendente">Deixar aguardando confirmação</option></select></div>
          <div class="field wide"><label for="nf-fesc">Forma de pagamento</label><select id="nf-fesc"><option value="pix">Pix</option><option value="link">Cartão de crédito (link)</option></select></div>
          <div class="field wide" id="nf-forma-w" hidden><label for="nf-forma">Forma de pagamento</label><select id="nf-forma">${FORMAS.map(f => `<option>${f}</option>`).join("")}</select></div>
        </div>
        <div id="nf-blk" hidden><div class="field"><label for="nf-motivo">Motivo</label><input id="nf-motivo" type="text" placeholder="Ex.: atendimento da clínica"></div></div>
        <p class="err" id="nf-err" hidden></p>
        <div class="row-actions"><button type="submit" class="btn" id="nf-save">Salvar reserva</button><button type="button" class="btn ghost" data-close>Cancelar</button></div>
      </form>`);
    let kind = "res";
    const f = s => $("#nf-" + s);
    const sync = () => {
      const hrs = Math.max(0, +f("fim").value - +f("ini").value), plano = f("plano").value;
      if (kind === "res" && !f("valor").dataset.touched) {
        f("valor").value = (plano === "periodo" ? C.preco_periodo_bloco * Math.max(1, Math.round(hrs / 4)) : hrs * (plano === "pacote" ? C.preco_antecipada : C.preco_avulso)).toFixed(2);
      }
      f("forma-w").hidden = f("status").value !== "pago";
    };
    ["ini", "fim", "plano", "status", "freq"].forEach(k => f(k).addEventListener("change", sync));
    f("valor").addEventListener("input", () => f("valor").dataset.touched = "1");
    sync();
    $$("#dr-body .seg-a button").forEach(b => b.onclick = () => {
      kind = b.dataset.k; $$("#dr-body .seg-a button").forEach(x => x.setAttribute("aria-pressed", x === b));
      f("res").hidden = kind !== "res"; f("blk").hidden = kind !== "blk"; f("save").textContent = kind === "res" ? "Salvar reserva" : "Salvar bloqueio";
    });
    $("#nf").onsubmit = async ev => {
      ev.preventDefault();
      const err = m => { f("err").textContent = m; f("err").hidden = !m; };
      const slot = { freq: f("freq").value, data: f("data").value, hora_ini: +f("ini").value, hora_fim: +f("fim").value };
      if (!(slot.hora_fim > slot.hora_ini)) return err("O horário final precisa ser depois do inicial.");
      const room = f("sala").value, btn = f("save"); btn.disabled = true;
      if (kind === "blk") {
        const nome = f("motivo").value.trim() || "Uso da clínica";
        const { data: res, error } = await sb.from("reservations").insert({ room_id: room, plano: "bloqueio", status: "confirmada", nome, resumo: fmtSlot(slot) }).select("id").single();
        if (error) { btn.disabled = false; return err(error.message); }
        const { error: e2 } = await sb.from("reservation_slots").insert({ ...slot, reservation_id: res.id, room_id: room });
        if (e2) { await sb.from("reservations").delete().eq("id", res.id); btn.disabled = false; return err(e2.message); }
        A().toast("Horário bloqueado.");
      } else {
        const nome = f("nome").value.trim(), cpf = M.onlyDigits(f("cpf").value);
        if (!nome) { btn.disabled = false; return err("Preencha o nome do cliente."); }
        if (cpf && !M.cpfValid(cpf)) { btn.disabled = false; return err("CPF inválido."); }
        const plano = f("plano").value;
        const { error } = await sb.rpc("staff_create_reservation", { p: {
          room_id: room, plano, status: f("status").value === "pago" ? "confirmada" : f("status").value, pago: f("status").value === "pago" ? "true" : "false", forma_escolhida: f("fesc").value, nome, telefone: f("tel").value.trim(), email: f("email").value.trim(), cpf,
          total: f("valor").value, forma: f("forma").value, resumo: `Plano: ${PLANO[plano]}\n${fmtSlot(slot)}`, slots: [slot] } });
        if (error) { btn.disabled = false; return err(error.message); }
        A().toast("Reserva criada.");
      }
      closeDrawer(); await reload();
    };
  }

  // ================= EQUIPE =================
  // ================= BACKUP =================
  function paintBackup() {
    const bk = C.ultimo_backup ? new Date(C.ultimo_backup) : null;
    $("#bk-last").textContent = bk ? `Último backup: ${M.fmtDateTime(bk)}` : "Nenhum backup baixado ainda.";
  }
  function save(name, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  async function markBackup() {
    const when = new Date().toISOString();
    const { error } = await sb.from("site_content").upsert({ key: "ultimo_backup", value: when });
    if (!error) { C.ultimo_backup = when; paintBackup(); }
  }
  async function backupJson() {
    const b = $("#bk-json"); b.disabled = true; b.textContent = "Gerando…";
    try {
      const tables = ["rooms", "room_photos", "site_content", "reservations", "reservation_slots", "payments", "profiles", "staff", "ajustes_banco_horas"];
      const out = { gerado_em: new Date().toISOString(), projeto: "Salas Morada do Ser", tabelas: {} };
      for (const t of tables) {
        let rows = [], from = 0;
        for (;;) {
          const { data, error } = await sb.from(t).select("*").range(from, from + 999);
          if (error) throw new Error(`${t}: ${error.message}`);
          rows = rows.concat(data); if (data.length < 1000) break; from += 1000;
        }
        out.tabelas[t] = rows;
      }
      save(`backup-morada-salas-${M.iso(new Date())}.json`, new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
      await markBackup();
      A().toast("Backup baixado. Guarde o arquivo no Drive da clínica.");
    } catch (e) { console.error(e); A().toast("Não foi possível gerar o backup: " + e.message, true); }
    b.disabled = false; b.textContent = "Baixar backup completo";
  }
  function backupCsv() {
    const head = ["Código", "Status", "Plano", "Sala", "Nome", "CPF", "Telefone", "E-mail", "Profissão", "Registro", "Horários", "Total", "Pago (soma)", "Criada em", "Observações"];
    const rows = all.filter(r => r.plano !== "bloqueio").map(r => [
      r.codigo, PILL[st(r)]?.[0] || st(r), PLANO[r.plano], roomName(r.room_id), r.nome, r.cpf ? M.cpfFormat(r.cpf) : "", r.telefone, r.email, r.profissao, r.registro,
      slotsText(r).join(" | "), String(r.total ?? "").replace(".", ","),
      String((r.payments || []).reduce((s, p) => s + Number(p.valor), 0)).replace(".", ","),
      new Date(r.created_at).toLocaleString("pt-BR"), r.obs]);
    const csv = "\ufeff" + [head, ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    save(`reservas-morada-salas-${M.iso(new Date())}.csv`, new Blob([csv], { type: "text/csv;charset=utf-8" }));
  }

  async function renderStaff() {
    paintBackup();
    const { data, error } = await sb.from("staff").select("user_id,email,created_at").order("created_at");
    if (error) return;
    const me = (await M.getUser())?.id;
    $("#staff-list").innerHTML = data.map(s => `<li><span>${esc(s.email)}${s.user_id === me ? ' <span class="muted small">(você)</span>' : ""}</span>
      ${s.user_id === me ? "" : `<button type="button" class="linkbtn danger-text" data-rm="${s.user_id}">Remover acesso</button>`}</li>`).join("");
  }
  async function addStaff(e) {
    e.preventDefault();
    const { error } = await sb.rpc("add_staff", { p_email: $("#st-email").value });
    if (error) return A().toast(error.message, true);
    $("#st-email").value = ""; A().toast("Acesso liberado."); renderStaff();
  }
  async function removeStaff(e) {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Clique de novo para remover"; return; }
    const { error } = await sb.rpc("remove_staff", { p_user: b.dataset.rm });
    if (error) return A().toast(error.message, true);
    A().toast("Acesso removido."); renderStaff();
  }

  // atualiza sozinho a cada 2 minutos (novas pré-reservas)
  setInterval(() => { if (bound && document.visibilityState === "visible" && $("#drawer").hidden) reload(); }, 120000);
})();
