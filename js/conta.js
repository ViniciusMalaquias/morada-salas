(async function () {
  const M = window.Morada, sb = M.client;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const show = id => ["#v-out", "#v-reset", "#v-in"].forEach(v => $(v).hidden = v !== id);
  const PLANO = { avulso: "Hora avulsa", pacote: "Horas antecipadas", periodo: "Período de 4h", semanal: "Fixo semanal", quinzenal: "Fixo quinzenal" };
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const fixo = r => r.plano === "semanal" || r.plano === "quinzenal";
  const planoTxt = r => r.usa_banco_de ? "Banco de horas" : M.isCompraBanco(r) ? "Horas antecipadas · banco de horas" : (PLANO[r.plano] || "");

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
  let started = false, me = null, profile = {};
  const recovering = location.hash.includes("type=recovery");
  sb.auth.onAuthStateChange((event, session) => setTimeout(() => {   // fora do callback para não travar o Supabase
    if (event === "PASSWORD_RECOVERY") { show("#v-reset"); return; }
    if (session && !started && !recovering) startIn(session.user);
    if (!session) { started = false; show("#v-out"); }
  }, 0));
  const { data: { session } } = await sb.auth.getSession();
  if (!session && !recovering) show("#v-out");

  // ---------- entrar / criar conta ----------
  const pickTab = t => {
    $$(".seg button").forEach(x => x.setAttribute("aria-selected", x.dataset.t === t));
    $("#f-login").hidden = t !== "login"; $("#f-signup").hidden = t !== "signup"; $("#s-ok").hidden = true;
  };
  $$(".seg button").forEach(b => b.addEventListener("click", () => pickTab(b.dataset.t)));
  if (location.hash === "#criar") pickTab("signup");

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
    const nome = $("#s-nome").value.trim(), telefone = $("#s-tel").value.trim(), email = $("#s-email").value.trim(), pass = $("#s-pass").value, cpf = M.onlyDigits($("#s-cpf").value);
    if (!M.fullName(nome)) return err("#s-err", "Preencha seu nome completo.");
    if (!M.cpfValid(cpf)) return err("#s-err", "CPF inválido. Confira os números.");
    if (telefone.replace(/\D/g, "").length < 10) return err("#s-err", "Preencha o telefone de contato com DDD.");
    if (!M.emailValid(email)) return err("#s-err", "Confira o e-mail.");
    if (pass.length < 8) return err("#s-err", "A senha precisa ter pelo menos 8 caracteres.");
    const { data, error } = await sb.auth.signUp({ email, password: pass, options: {
      emailRedirectTo: location.href.split("#")[0],
      data: { nome, telefone, cpf, profissao: $("#s-prof").value, registro: $("#s-reg").value.trim() } } });
    if (error) return err("#s-err", /registered|exists/i.test(error.message) ? "Já existe uma conta com esse e-mail. Use a aba Entrar." : error.message);
    if (!data.session) {
      $("#f-signup").hidden = true;
      const ok = $("#s-ok"); ok.hidden = false;
      ok.textContent = `Conta criada! Enviamos um e-mail para ${email}. Clique no link do e-mail para ativar a conta e depois entre aqui. Suas reservas feitas com esse e-mail ou CPF aparecem sozinhas.`;
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
    if (error || !data) return err("#c-err", "Não encontramos uma reserva com esse código e telefone ou CPF. Confira os dados.");
    const r = { ...data, slots: null, forma_escolhida: data.forma, link_pagamento: data.link || "", payments: data.pago ? [{ valor: data.pago }] : [] };
    $("#c-result").innerHTML = (r.status === "confirmada" && M.dueOf(r) > 0 ? payCard(r) : "") + resCard(r, true) +
      `<div class="card cta-acc"><p><b>Crie sua conta</b> para acompanhar todas as suas reservas e recibos num lugar só. Use o mesmo e-mail da reserva que ela aparece sozinha depois que você confirmar o e-mail.</p><button type="button" class="btn small" id="cta-signup">Criar conta</button></div>`;
    paintQrs();
    $("#cta-signup").onclick = () => { pickTab("signup"); $("#s-nome").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  });

  // ---------- área logada ----------
  async function startIn(user) {
    started = true; me = user; show("#v-in");
    const [{ data: prof }, { data: staff }] = await Promise.all([
      sb.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      sb.rpc("is_staff")
    ]);
    profile = prof || {};
    $("#hello").textContent = profile.nome ? `Olá, ${profile.nome.split(" ")[0]}!` : "Olá!";
    $("#to-admin").hidden = !staff;
    $("#p-cpf").value = M.cpfFormat(profile.cpf || ""); $("#p-cpf").readOnly = !!profile.cpf;
    $("#p-cpf").title = profile.cpf ? "Para corrigir o CPF, fale com a clínica." : ""; $("#p-nome").value = profile.nome || ""; $("#p-tel").value = profile.telefone || "";
    $("#p-reg").value = profile.registro || ""; $("#p-email").value = user.email || "";
    if (profile.profissao) $("#p-prof").value = profile.profissao;
    const { data: n } = await sb.rpc("claim_my_reservations");
    if (n > 0) toast(`${n > 1 ? `${n} reservas feitas` : "1 reserva feita"} antes do cadastro ${n > 1 ? "foram vinculadas" : "foi vinculada"} à sua conta.`);
    loadMine();
  }
  $("#logout").addEventListener("click", () => sb.auth.signOut());
  $$(".tabs-c button").forEach(b => b.addEventListener("click", () => {
    $$(".tabs-c button").forEach(x => { x.setAttribute("aria-selected", x === b); $("#" + x.dataset.p).hidden = x !== b; });
  }));

  let mine = [];
  async function loadMine() {
    const { data, error } = await sb.from("reservations")
      .select("id,codigo,status,plano,resumo,total,created_at,pago_em,room_id,nome,cpf,forma_escolhida,link_pagamento,horas_compradas,mes_referencia,usa_banco_de,rooms(name),reservation_slots(freq,data,hora_ini,hora_fim),payments(id,competencia,valor,forma,pago_em)")
      .eq("user_id", me.id).order("created_at", { ascending: false }).limit(200);
    const box = $("#my-list");
    if (error) { box.innerHTML = `<p class="err">Não foi possível carregar suas reservas.</p>`; return; }
    mine = (data || []).map(r => ({ ...r, sala: r.rooms?.name, slots: r.reservation_slots }));
    renderHero(); renderPend(); renderList(); renderAgenda(); renderPays(); loadBanco();
  }

  const atH = (y, m, d, h) => new Date(y, m, d, Math.floor(h), Math.round((h % 1) * 60));
  // próxima ocorrência de um horário
  function nextOcc(s, from = new Date()) {
    const now = from, today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = M.parse(s.data);
    if (s.freq === "unica") { const d = atH(start.getFullYear(), start.getMonth(), start.getDate(), Number(s.hora_ini)); return d >= now ? d : null; }
    let d = start > today ? start : today;
    for (let i = 0; i < 30; i++) {
      const diff = Math.round((d - start) / 864e5);
      if (d.getDay() === start.getDay() && diff >= 0 && (s.freq === "semanal" || (diff / 7) % 2 === 0)) {
        const at = atH(d.getFullYear(), d.getMonth(), d.getDate(), Number(s.hora_ini));
        if (at >= now) return at;
      }
      d = M.addDays(d, 1);
    }
    return null;
  }
  function relDay(d) {
    const now = new Date(), t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t0) / 864e5);
    if (days === 0) { const h = Math.max(0, Math.round((d - now) / 36e5)); return h <= 0 ? "agora" : `hoje, em ${h}h`; }
    if (days === 1) return "amanhã";
    return `em ${days} dias`;
  }

  function renderHero() {
    const occ = mine.filter(r => r.status === "confirmada").flatMap(r => (r.slots || []).map(s => ({ r, s, at: nextOcc(s) }))).filter(x => x.at).sort((a, b) => a.at - b.at)[0];
    const pend = mine.filter(r => M.statusOf(r, C) === "pendente").length;
    if (!occ) { $("#hero-next").innerHTML = mine.length || pend ? "" : `<div class="hero-next empty"><div><span class="eyebrow">Comece por aqui</span><h2>Reserve sua primeira sala</h2><p class="muted">Escolha a sala, veja os horários livres e faça a pré-reserva em poucos minutos.</p></div><a class="btn" href="index.html#salas">Ver salas</a></div>`; return; }
    const { r, s, at } = occ;
    $("#hero-next").innerHTML = `<div class="hero-next">
      <div class="hn-date"><span>${M.DOW_NAME[at.getDay()]}</span><strong>${at.getDate()}</strong><span>${MESES[at.getMonth()].slice(0, 3)}</span></div>
      <div class="hn-body"><span class="eyebrow">Próximo atendimento · ${relDay(at)}</span>
        <h2>${esc(r.sala)}</h2><p>${M.hh(s.hora_ini)} às ${M.hh(s.hora_fim)} · ${planoTxt(r)}</p></div>
      <div class="hn-act"><a class="btn ghost small" target="_blank" rel="noopener" href="${wa(`Olá! Sobre minha reserva ${r.codigo} (${r.sala}), ${M.DOW_NAME[at.getDay()]} ${M.br(at)} às ${M.hh(s.hora_ini)}:`)}">Falar com a clínica</a></div></div>`;
  }

  // ---------- Minha agenda ----------
  const pad2 = n => String(n).padStart(2, "0");
  // horário de Brasília (UTC−3, sem horário de verão) → formato de calendário em UTC
  const calUtc = (dateIso, h) => { h = Number(h); const [y, m, d] = dateIso.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d, Math.floor(h) + 3, Math.round((h % 1) * 60))); return `${t.getUTCFullYear()}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCDate())}T${pad2(t.getUTCHours())}${pad2(t.getUTCMinutes())}00Z`; };
  const rrule = s => s.freq === "semanal" ? "RRULE:FREQ=WEEKLY" : s.freq === "quinzenal" ? "RRULE:FREQ=WEEKLY;INTERVAL=2" : "";
  const agActive = r => r.status === "confirmada" || M.statusOf(r, C) === "pendente";
  const evTitle = r => `Atendimento · ${r.sala || "Sala"} (Morada do Ser)`;
  const evPlace = () => `${C.endereco}, ${String(C.bairro_cidade || "").replace(" · ", ", ")}`;
  const evDesc = r => `Reserva ${r.codigo} na Clínica Morada do Ser.${r.status !== "confirmada" ? " Aguardando confirmação da clínica." : ""}\nMinha conta: ${new URL("conta.html", location.href).href}`;
  function gcalLink(r, s, dateIso) {
    const q = new URLSearchParams({ action: "TEMPLATE", text: evTitle(r), dates: `${calUtc(dateIso, s.hora_ini)}/${calUtc(dateIso, s.hora_fim)}`, details: evDesc(r), location: evPlace(), ctz: "America/Sao_Paulo" });
    if (rrule(s)) q.set("recur", rrule(s));
    return "https://calendar.google.com/calendar/render?" + q.toString();
  }
  // ocorrências de um horário entre duas datas
  function occBetween(s, from, to) {
    const start = M.parse(s.data), out = [];
    if (s.freq === "unica") return start >= from && start <= to ? [start] : out;
    const step = s.freq === "quinzenal" ? 14 : 7;
    let d = start;
    if (d < from) { const k = Math.ceil(Math.round((from - start) / 864e5) / step); d = M.addDays(start, k * step); }
    for (; d <= to; d = M.addDays(d, step)) out.push(d);
    return out;
  }
  function renderAgenda() {
    const now = new Date(), from = new Date(now.getFullYear(), now.getMonth(), now.getDate()), to = M.addDays(from, 55);
    const ev = mine.filter(agActive).flatMap(r => (r.slots || []).flatMap(s => occBetween(s, from, to)
      .map(d => ({ r, s, d, at: atH(d.getFullYear(), d.getMonth(), d.getDate(), Number(s.hora_fim))}))))
      .filter(x => x.at > now).sort((a, b) => a.d - b.d || a.s.hora_ini - b.s.hora_ini);
    $("#ag-ics").hidden = !ev.length;
    if (!ev.length) {
      $("#ag-list").innerHTML = `<div class="card empty"><p>Nenhum horário marcado nas próximas semanas.</p><a class="btn small" href="index.html#salas">Reservar uma sala</a></div>`;
      return;
    }
    let html = "", lastKey = "";
    ev.forEach(({ r, s, d }) => {
      const key = M.iso(d);
      if (key !== lastKey) {
        if (lastKey) html += `</div>`;
        const rel = Math.round((d - from) / 864e5);
        html += `<div class="ag-day"><h3>${M.DOW_LONG[d.getDay()].replace(/^./, c => c.toUpperCase())}, ${d.getDate()} de ${MESES[d.getMonth()]}${rel === 0 ? " · hoje" : rel === 1 ? " · amanhã" : ""}</h3>`;
        lastKey = key;
      }
      const pend = r.status !== "confirmada";
      html += `<div class="ag-item${pend ? " pend" : ""}">
        <span class="ag-time">${M.hh(s.hora_ini)}<small>${M.hh(s.hora_fim)}</small></span>
        <span class="ag-body"><b>${esc(r.sala || "")}</b><small>${[planoTxt(r), s.freq === "semanal" ? "toda semana" : s.freq === "quinzenal" ? "a cada 15 dias" : "", pend ? "aguardando confirmação" : ""].filter(Boolean).join(" · ")}</small></span>
        <a class="linkbtn ag-g" target="_blank" rel="noopener" href="${esc(gcalLink(r, s, s.freq === "unica" ? s.data : M.iso(d)))}" title="${s.freq !== "unica" ? "Adiciona a série inteira" : "Adiciona este horário"}">+ Google Agenda</a>
      </div>`;
    });
    $("#ag-list").innerHTML = html + `</div>`;
  }
  function downloadIcs() {
    const esc2 = t => String(t).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Morada do Ser//Salas//PT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Morada do Ser"];
    mine.filter(agActive).forEach(r => (r.slots || []).forEach((s, i) => {
      lines.push("BEGIN:VEVENT", `UID:${r.id}-${i}@moradadoser`, `DTSTAMP:${stamp}`,
        `DTSTART:${calUtc(s.data, s.hora_ini)}`, `DTEND:${calUtc(s.data, s.hora_fim)}`);
      if (rrule(s)) lines.push(rrule(s));
      lines.push(`SUMMARY:${esc2(evTitle(r))}`, `LOCATION:${esc2(evPlace())}`, `DESCRIPTION:${esc2(evDesc(r))}`,
        "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", `DESCRIPTION:${esc2(evTitle(r))}`, "END:VALARM", "END:VEVENT");
    }));
    lines.push("END:VCALENDAR");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }));
    a.download = "morada-do-ser-agenda.ics"; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast("Arquivo baixado. Abra-o para adicionar os horários ao seu calendário.");
  }
  $("#ag-ics").addEventListener("click", downloadIcs);

  // ---------- Banco de horas ----------
  const firstOfMonth = d => M.iso(new Date(d.getFullYear(), d.getMonth(), 1));
  const durZ = h => h > 0 ? M.dur(h) : "0h";
  let bancos = [], rooms = null;
  async function loadBanco() {
    const atual = firstOfMonth(new Date());
    const meses = [...new Set(mine.filter(r => M.isCompraBanco(r) && ["pendente", "confirmada"].includes(r.status) && r.mes_referencia >= atual).map(r => r.mes_referencia))].sort();
    const res = await Promise.all(meses.map(m => sb.rpc("banco_horas_resumo", { p_user: me.id, p_mes: m })));
    bancos = meses.map((mes, i) => ({ mes, ...(res[i].data || {}) }));
    renderBanco();
  }
  function renderBanco() {
    $("#banco-box").innerHTML = bancos.map(b => {
      const n = v => Number(v || 0);
      const usos = mine.filter(r => r.usa_banco_de && ["pendente", "confirmada"].includes(r.status))
        .flatMap(r => (r.slots || []).filter(s => s.data.slice(0, 7) === b.mes.slice(0, 7)).map(s => ({ r, s })))
        .sort((x, y) => x.s.data.localeCompare(y.s.data) || x.s.hora_ini - y.s.hora_ini);
      const [y, m] = b.mes.split("-").map(Number), ultimo = new Date(y, m, 0);
      const temConf = n(b.compradas) > 0 || n(b.ajustes) > 0, saldo = n(b.saldo);
      const pode = temConf && saldo >= 0.5 && ultimo >= new Date(new Date().setHours(0, 0, 0, 0));
      return `<article class="card bh-card${temConf ? "" : " pend"}">
        <div class="bh-head"><div><span class="eyebrow">Banco de horas · ${esc(M.mesNome(b.mes))}</span>
          <h2>${temConf ? durZ(saldo) : "Aguardando"}<small>${temConf ? "de saldo" : "confirmação da clínica"}</small></h2></div>
          ${temConf ? `<button type="button" class="btn small" data-marcar="${b.mes}" ${pode ? "" : "disabled"}>Marcar horário</button>` : ""}</div>
        ${temConf ? `<div class="bh-nums"><span>Compradas <b>${durZ(n(b.compradas))}</b></span><span>Usadas <b>${durZ(n(b.usadas))}</b></span>${n(b.ajustes) ? `<span>Ajustes da clínica <b>${n(b.ajustes) > 0 ? "+" : "−"}${M.dur(Math.abs(n(b.ajustes)))}</b></span>` : ""}</div>` : ""}
        ${n(b.pendentes) > 0 ? `<p class="muted small">Compra de ${M.dur(n(b.pendentes))} aguardando a confirmação da clínica${temConf ? " (entra no saldo quando for confirmada)" : ""}.</p>` : ""}
        ${usos.length ? `<ul class="bh-usos">${usos.map(({ r, s }) => `<li>${esc(fmtSlot(s))} · ${esc(r.sala || "")}</li>`).join("")}</ul>` : ""}
        <p class="muted small">As horas valem até ${M.br(ultimo)}, em qualquer sala. Horas não usadas não passam para o mês seguinte.${temConf && saldo < 0.5 ? " Saldo do mês esgotado." : ""}</p>
      </article>`;
    }).join("");
  }
  $("#banco-box").addEventListener("click", e => { const b = e.target.closest("[data-marcar]"); if (b && !b.disabled) openMarcar(b.dataset.marcar); });

  // Marcar horário com o saldo: sala → dia do mês → horários livres de 30 em 30 min (occupied_slots2, como na página da sala)
  const HOR = () => C.horarios || M.DEFAULTS.horarios;
  const openOf = d => HOR()[M.DOW_NAME[d.getDay()]] || null;
  const mc = { mes: null, saldo: 0, room: null, day: null, sel: new Set(), occ: {}, lastTap: null, loading: false };
  const mcErr = msg => err("#mc-err", msg || "");
  async function openMarcar(mes) {
    const b = bancos.find(x => x.mes === mes); if (!b) return;
    if (!rooms) { try { rooms = await M.loadRooms(); } catch (e) { return toast("Não foi possível carregar as salas.", true); } }
    if (!rooms.length) return toast("Nenhuma sala disponível no momento.", true);
    Object.assign(mc, { mes, saldo: Number(b.saldo || 0), room: mc.room && rooms.some(r => r.id === mc.room) ? mc.room : rooms[0].id, day: null, sel: new Set(), lastTap: null });
    $("#mc-title").textContent = `Marcar horário · ${M.mesNome(mes)}`;
    $("#mc-saldo").textContent = `Saldo disponível: ${M.dur(mc.saldo)}. As horas marcadas saem do seu banco de horas.`;
    $("#mc-sala").innerHTML = rooms.map(r => `<option value="${r.id}" ${r.id === mc.room ? "selected" : ""}>${esc(r.name)}</option>`).join("");
    mcErr(""); $("#marcar").hidden = false;
    await mcLoad();
  }
  function mcDays() {
    const [y, m] = mc.mes.split("-").map(Number), today = new Date(new Date().setHours(0, 0, 0, 0)), out = [];
    for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d = M.addDays(d, 1)) if (d >= today && openOf(d)) out.push(new Date(d));
    return out;
  }
  function mcState(d, h) {
    const o = openOf(d), key = M.iso(d), now = new Date();
    if (!o || h < o[0] || h >= o[1]) return "closed";
    if (key < M.iso(now) || (key === M.iso(now) && h <= now.getHours() + now.getMinutes() / 60)) return "past";
    if (mc.occ[key]?.has(h)) return "busy";
    return mc.sel.has(h) ? "sel" : "free";
  }
  function mcFree(d) { const o = openOf(d); let n = 0; if (o) for (let h = o[0]; h < o[1]; h += 0.5) if (mcState(d, h) === "free") n++; return n; }
  async function mcLoad() {
    const days = mcDays();
    mc.loading = true; mcDraw();
    try { mc.occ = days.length ? await M.loadOccupied(mc.room, days[0], days[days.length - 1]) : {}; }
    catch (e) { console.error(e); mcErr("Não foi possível carregar os horários. Tente de novo."); }
    mc.loading = false;
    if (!mc.day || !days.some(d => M.iso(d) === mc.day)) { const f = days.find(d => mcFree(d) > 0) || days[0]; mc.day = f ? M.iso(f) : null; }
    mcDraw();
  }
  function mcDraw() {
    const days = mcDays();
    $("#mc-dias").innerHTML = days.map(d => {
      const k = M.iso(d), f = mc.loading ? 0 : mcFree(d);
      const info = mc.loading ? "…" : k === mc.day && mc.sel.size ? `✓ ${M.dur(mc.sel.size / 2)}` : f ? `${M.dur(f / 2)} livres` : "lotado";
      return `<button type="button" role="tab" data-day="${k}" aria-selected="${k === mc.day}" class="${f || mc.loading ? "" : "full"}"><b>${M.DOW_NAME[d.getDay()]}</b><small>${M.br(d)}</small><span>${info}</span></button>`;
    }).join("") || `<p class="muted small">Não há mais dias de funcionamento neste mês.</p>`;
    $("#mc-dias [aria-selected=true]")?.scrollIntoView({ block: "nearest", inline: "center" });
    const cal = $("#mc-cal");
    if (mc.loading) cal.innerHTML = `<tbody><tr><td class="muted small">Carregando horários…</td></tr></tbody>`;
    else if (!mc.day) cal.innerHTML = "";
    else {
      const d = M.parse(mc.day), o = openOf(d); let html = "<tbody>";
      for (let h = o[0]; h < o[1]; h += 0.5) {
        const st = mcState(d, h);
        const txt = { free: "Livre", sel: "✓ Escolhido", busy: "Ocupado", past: "Já passou" }[st] || "";
        html += `<tr class="${h % 1 ? "half" : "full"}"><th scope="row">${M.hh(h)}</th><td><button type="button" class="cell ${st}" data-h="${h}" ${st === "free" || st === "sel" ? "" : "disabled"} aria-pressed="${st === "sel"}" aria-label="${M.hh(h)} às ${M.hh(h + 0.5)}: ${txt}">${txt}</button></td></tr>`;
      }
      cal.innerHTML = html + "</tbody>";
    }
    const hrs = mc.sel.size / 2;
    $("#mc-sel").innerHTML = hrs ? `${M.ranges([...mc.sel]).map(([a, b]) => `${M.hh(a)}–${M.hh(b)}`).join(", ")} · <b>${M.dur(hrs)}</b> · saldo depois: ${durZ(mc.saldo - hrs)}` : "";
    $("#mc-ok").disabled = !hrs || hrs > mc.saldo;
  }
  $("#mc-sala").addEventListener("change", e => { mc.room = e.target.value; mc.sel.clear(); mc.lastTap = null; mcErr(""); mcLoad(); });
  $("#mc-dias").addEventListener("click", e => { const b = e.target.closest("[data-day]"); if (!b) return; mc.day = b.dataset.day; mc.sel.clear(); mc.lastTap = null; mcErr(""); mcDraw(); });
  $("#mc-cal").addEventListener("click", e => {
    const b = e.target.closest("button.cell"); if (!b || b.disabled) return;
    const h = +b.dataset.h, d = M.parse(mc.day);
    if (mc.sel.has(h)) { mc.sel.delete(h); mc.lastTap = null; mcErr(""); return mcDraw(); }
    const add = [h];
    // tocar no início e depois no fim preenche o intervalo (só horários livres)
    if (mc.lastTap != null && h >= mc.lastTap + 1.5 && mc.sel.has(mc.lastTap)) {
      const gap = []; for (let x = mc.lastTap + 0.5; x < h; x += 0.5) gap.push(x);
      if (gap.every(x => mcState(d, x) === "free")) add.push(...gap);
    }
    if ((mc.sel.size + add.length) / 2 > mc.saldo) return mcErr(`Seu saldo é de ${M.dur(mc.saldo)}. Escolha menos horários.`);
    add.forEach(x => mc.sel.add(x)); mc.lastTap = h; mcErr(""); mcDraw();
  });
  $("#mc-ok").addEventListener("click", async () => {
    const btn = $("#mc-ok"); btn.disabled = true; btn.textContent = "Marcando…";
    const slots = M.ranges([...mc.sel]).map(([a, b]) => ({ data: mc.day, hora_ini: a, hora_fim: b }));
    const { data, error } = await sb.rpc("usar_banco_horas", { p_room: mc.room, p_slots: slots });
    btn.textContent = "Marcar horário";
    if (error) {
      mcErr(error.message || "Não foi possível marcar. Tente de novo."); btn.disabled = false;
      if (/reservado/.test(error.message || "")) { mc.sel.clear(); mcLoad(); }
      return;
    }
    $("#marcar").hidden = true;
    toast(`Horário marcado! Saldo de ${M.mesNome(mc.mes)}: ${durZ(Number(data.saldo))}.`);
    loadMine();
  });
  $("#marcar").addEventListener("click", e => { if (e.target.closest("[data-close-mc]")) $("#marcar").hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") $("#marcar").hidden = true; });

  // Cartões de pagamento: reservas confirmadas com valor em aberto
  function renderPend() {
    const due = mine.filter(r => r.status === "confirmada" && M.dueOf(r) > 0);
    $("#pend-box").innerHTML = due.map(payCard).join("");
    paintQrs();
  }

  function payCard(r) {
    const val = M.dueOf(r), quando = M.dueText(r), atrasado = /venceu/.test(quando);
    const isLink = r.forma_escolhida === "link";
    const payload = !isLink && C.pix_chave ? M.pixPayload({ chave: C.pix_chave, nome: C.pix_nome, cidade: C.pix_cidade, valor: val, txid: r.codigo }) : "";
    return `<article class="paycard">
      <div class="pc-info">
        <span class="pill p-pend">${atrasado ? "Pagamento em atraso" : "A pagar"}</span>
        <h2>${M.money(val)}<small>${M.paidOf(r) > 0 ? ` de ${M.money(r.total)}` : ""}</small></h2>
        <p><b>${M.isCompraBanco(r) ? `Banco de horas: ${M.dur(r.horas_compradas)} para ${esc(M.mesNome(r.mes_referencia))}` : esc(r.sala || "")}</b> · ${planoTxt(r)} · código ${esc(r.codigo)}</p>
        <p>Pagamento <b>${quando}</b>, ${isLink ? "com cartão de crédito (link de pagamento)" : "por Pix"}.</p>
        ${isLink
          ? (/^https?:\/\//i.test(r.link_pagamento || "")
              ? `<div class="row-actions"><a class="btn small" target="_blank" rel="noopener" href="${esc(r.link_pagamento)}">Pagar com cartão</a>
                 <a class="btn ghost small" target="_blank" rel="noopener" href="${wa(`Olá! Prefiro pagar a reserva ${r.codigo} por Pix.`)}">Prefiro pagar por Pix</a></div>`
              : `<p class="muted small">A clínica vai enviar o link de pagamento pelo WhatsApp.</p>
                 <div class="row-actions"><a class="btn small" target="_blank" rel="noopener" href="${wa(`Olá! Pode me enviar o link de pagamento da reserva ${r.codigo} (${r.sala || ""}), valor ${M.money(val)}?`)}">Pedir o link pelo WhatsApp</a></div>`)
          : `<p class="muted small">${esc(C.pagamento_texto || "")}</p>
             <div class="row-actions"><a class="btn small" target="_blank" rel="noopener" href="${wa(`Olá! Segue o comprovante da reserva ${r.codigo} (${r.sala || ""}), valor ${M.money(val)}.`)}">Enviar comprovante</a>
             <a class="btn ghost small" target="_blank" rel="noopener" href="${wa(`Olá! Prefiro pagar a reserva ${r.codigo} com cartão de crédito. Pode me enviar o link de pagamento?`)}">Prefiro pagar com cartão</a></div>`}
      </div>
      ${payload ? `<div class="pc-pix"><div class="qr" data-qr="${esc(payload)}" aria-label="QR Code Pix"></div>
        <span class="small muted">Pix copia e cola</span>
        <div class="copyrow"><input type="text" readonly value="${esc(payload)}" aria-label="Código Pix copia e cola"><button type="button" class="copy" data-copy="${esc(payload)}">Copiar</button></div></div>` : ""}
    </article>`;
  }
  function paintQrs() {
    if (!window.qrcode) return;
    $$("[data-qr]").forEach(el => { if (el.dataset.done) return; const q = qrcode(0, "M"); q.addData(el.dataset.qr); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); el.dataset.done = "1"; });
  }

  function fmtSlot(s) {
    const d = M.parse(s.data);
    if (s.freq === "unica") return `${M.DOW_NAME[d.getDay()]} ${M.br(d)}, ${M.hh(s.hora_ini)}–${M.hh(s.hora_fim)}`;
    return `${s.freq === "semanal" ? "Toda" : "A cada 15 dias,"} ${M.DOW_LONG[d.getDay()]}, ${M.hh(s.hora_ini)}–${M.hh(s.hora_fim)} (desde ${M.br(d)})`;
  }

  function steps(st, r) {
    const done = st === "confirmada" ? (r.usa_banco_de || (r.total && M.dueOf(r) === 0 && r.payments) ? 3 : 2) : st === "pendente" ? 1 : 0;
    const off = ["recusada", "cancelada", "expirada"].includes(st);
    return `<ol class="steps-r ${off ? "off" : ""}">${["Pré-reserva", "Confirmada", "Paga"].map((t, i) => `<li class="${i < done ? "done" : i === done && !off ? "cur" : ""}">${t}</li>`).join("")}</ol>`;
  }

  function resCard(r, guest) {
    const st = M.statusOf(r, C);
    const compra = M.isCompraBanco(r);
    const lines = compra ? [`Banco de horas: ${M.dur(r.horas_compradas)} para usar em ${M.mesNome(r.mes_referencia)}`, st === "confirmada" ? "Marque os horários no card Banco de horas, acima." : "Depois que a clínica confirmar, você marca os horários aqui em Minha conta."]
      : r.slots ? r.slots.slice().sort((a, b) => a.data.localeCompare(b.data) || a.hora_ini - b.hora_ini).map(fmtSlot)
      : String(r.resumo || "").split("\n").filter(l => l && !/^Plano:|^Total|^Estimativa/.test(l));
    const canCancel = !guest && (st === "pendente" || (st === "confirmada" && !compra));
    const acts = guest ? "" : `
      ${r.room_id ? `<a class="btn ghost small" href="sala.html?id=${encodeURIComponent(r.room_id)}">Reservar de novo</a>` : ""}
      ${r.status === "confirmada" ? `<a class="btn ghost small" target="_blank" rel="noopener" href="${wa(`Olá! Gostaria de remarcar um horário da reserva ${r.codigo} (${r.sala || ""}).`)}">Pedir remarcação</a>` : ""}
      ${canCancel ? `<button type="button" class="linkbtn danger-text" data-cancel>Cancelar reserva</button>` : ""}`;
    return `<article class="card myres st-${st}" data-id="${r.id || ""}">
      <div class="myres-head"><div><strong>${esc(compra ? `Banco de horas · ${M.mesNome(r.mes_referencia)}` : r.sala || "")}</strong><span class="muted small">${planoTxt(r)} · código ${esc(r.codigo)}</span></div><span class="pill">${M.STATUS_CLIENTE[st]}</span></div>
      ${steps(st, r)}
      <ul class="myres-slots">${(lines.length ? lines : ["Horários a combinar com a clínica"]).map(l => `<li>${esc(l)}</li>`).join("")}</ul>
      ${r.total ? `<p class="small muted">Valor: <b>${M.money(r.total)}</b>${!r.payments ? "" : M.dueOf(r) === 0 ? " · pago" : M.paidOf(r) > 0 ? ` · pago ${M.money(M.paidOf(r))}, falta ${M.money(M.dueOf(r))}` : ` · pagamento ${M.dueText(r)}`}</p>` : ""}
      ${st === "pendente" ? `<p class="muted small">O horário já está separado para você. A clínica confirma pelo WhatsApp em até 2 horas, no horário de funcionamento.</p>` : ""}
      ${r.usa_banco_de && st === "confirmada" ? `<p class="muted small">Marcado com o banco de horas. Cancelando com mais de 24h, as horas voltam para o seu saldo.</p>` : ""}
      ${acts.trim() ? `<div class="myres-actions">${acts}</div>` : ""}
    </article>`;
  }

  function renderList() {
    const box = $("#my-list");
    if (!mine.length) { box.innerHTML = `<div class="card empty"><p>Você ainda não tem reservas.</p><a class="btn" href="index.html#salas">Ver salas e horários</a></div>`; return; }
    const groups = [
      ["Ativas", mine.filter(r => ["pendente", "confirmada"].includes(M.statusOf(r, C)))],
      ["Histórico", mine.filter(r => ["recusada", "cancelada", "expirada"].includes(M.statusOf(r, C)))]
    ].filter(g => g[1].length);
    box.innerHTML = groups.map(([t, list]) => `<h2 class="h3 grp">${t}</h2>${list.map(r => resCard(r, false)).join("")}`).join("");
  }

  function renderPays() {
    const pays = mine.flatMap(r => (r.payments || []).map(p => ({ ...p, r }))).sort((a, b) => new Date(b.pago_em) - new Date(a.pago_em));
    $("#pay-list").innerHTML = pays.length ? `<ul class="plist">${pays.map(p => `<li>
      <span><b>${M.money(p.valor)}</b><small>${M.fmtDateTime(new Date(p.pago_em))} · ${p.competencia ? `Horas antecipadas de ${MESES[M.parse(p.competencia).getMonth()]}` : "Reserva"} · ${esc(p.r.sala || "")} · ${esc(p.forma || "")}</small></span>
      <button type="button" class="btn ghost small" data-rec="${p.id}">Recibo</button></li>`).join("")}</ul>`
      : `<p class="muted">Os pagamentos confirmados pela clínica aparecem aqui, com recibo.</p>`;
    $("#pay-list").onclick = e => { const b = e.target.closest("[data-rec]"); if (b) openRecibo(pays.find(p => p.id === b.dataset.rec)); };
  }

  function openRecibo(p) {
    const r = p.r;
    $("#recibo-body").innerHTML = `<div class="rec">
      <div class="rec-head"><span class="logo" aria-hidden="true"></span><div><b>Clínica Morada do Ser</b><small>${esc(C.endereco)} · ${esc(C.bairro_cidade)}</small><small>${esc(C.telefone)} · ${esc(C.email)}</small></div></div>
      <h2>Recibo</h2>
      <p>Recebemos de <b>${esc(profile.nome || r.nome || "")}</b>${(profile.cpf || r.cpf) ? `, CPF ${esc(M.cpfFormat(profile.cpf || r.cpf))}` : ""}, a quantia de <b>${M.money(p.valor)}</b>,
      referente à locação da <b>${esc(r.sala || "")}</b> (${PLANO[r.plano]}${p.competencia ? `, horas de ${MESES[M.parse(p.competencia).getMonth()]} de ${M.parse(p.competencia).getFullYear()}` : ""}).</p>
      <dl class="rec-dl"><dt>Código da reserva</dt><dd>${esc(r.codigo)}</dd><dt>Data do pagamento</dt><dd>${new Date(p.pago_em).toLocaleDateString("pt-BR")}</dd><dt>Forma</dt><dd>${esc(p.forma || "—")}</dd>
      <dt>Horários</dt><dd>${M.isCompraBanco(r) ? `Banco de horas: ${M.dur(r.horas_compradas)} para ${esc(M.mesNome(r.mes_referencia))}` : (r.slots || []).map(fmtSlot).map(esc).join("<br>") || "—"}</dd></dl>
      <p class="rec-sign">Jundiaí, ${new Date(p.pago_em).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" })}.</p></div>`;
    $("#recibo").hidden = false;
  }
  $("#recibo").addEventListener("click", e => { if (e.target.closest("[data-close-rec]")) $("#recibo").hidden = true; });
  $("#rec-print").onclick = () => window.print();

  // copiar / cancelar
  document.addEventListener("click", async e => {
    const c = e.target.closest("[data-copy]");
    if (c) {
      try { await navigator.clipboard.writeText(c.dataset.copy); toast("Código Pix copiado. Cole no app do seu banco."); }
      catch { const i = c.parentElement.querySelector("input"); i?.select(); }
      return;
    }
    const x = e.target.closest("[data-cancel]");
    if (x) {
      const card = x.closest(".myres"), box = x.parentElement;
      const rr = mine.find(m => m.id === card.dataset.id);
      box.innerHTML = `<span class="small">${rr?.usa_banco_de ? "Cancelar este horário? As horas voltam para o seu banco de horas." : "Cancelar esta reserva? Os horários ficam livres para outras pessoas."}</span>
        <button type="button" class="btn danger small" data-cancel-yes>Cancelar reserva</button><button type="button" class="btn ghost small" data-cancel-no>Voltar</button>`;
      box.dataset.id = card.dataset.id;
      return;
    }
    if (e.target.closest("[data-cancel-no]")) { renderList(); return; }
    const y = e.target.closest("[data-cancel-yes]");
    if (y) {
      y.disabled = true;
      const { error } = await sb.rpc("cancel_my_reservation", { p_id: y.parentElement.dataset.id });
      if (error) { toast(error.message, true); y.disabled = false; return; }
      toast("Reserva cancelada."); loadMine();
    }
  });

  $("#f-claim").addEventListener("submit", async e => {
    e.preventDefault(); err("#k-err", "");
    const { error } = await sb.rpc("claim_reservation", { p_codigo: $("#k-code").value, p_telefone: $("#k-tel").value });
    if (error) return err("#k-err", error.message);
    toast("Reserva vinculada à sua conta."); $("#f-claim").reset(); loadMine();
  });

  $("#f-perfil").addEventListener("submit", async e => {
    e.preventDefault();
    const row = { id: me.id, email: me.email, nome: $("#p-nome").value.trim(), cpf: M.onlyDigits($("#p-cpf").value), telefone: $("#p-tel").value.trim(), profissao: $("#p-prof").value, registro: $("#p-reg").value.trim(), updated_at: new Date().toISOString() };
    if (!M.fullName(row.nome)) return toast("Preencha seu nome completo.", true);
    if (!M.cpfValid(row.cpf)) return toast("CPF inválido. Confira os números.", true);
    if (row.telefone.replace(/\D/g, "").length < 10) return toast("Preencha o telefone de contato com DDD.", true);
    const { error } = await sb.from("profiles").upsert(row);
    if (error) return toast(/profiles_cpf_idx|duplicate/.test(error.message) ? "Este CPF já está em outra conta. Fale com a clínica." : /CPF/.test(error.message) ? error.message : "Não foi possível salvar. Tente de novo.", true);
    profile = { ...profile, ...row };
    $("#hello").textContent = `Olá, ${row.nome.split(" ")[0]}!`; toast("Dados salvos.");
    const { data: n } = await sb.rpc("claim_my_reservations");
    if (n > 0) loadMine();
  });
})();
