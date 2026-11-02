(async function () {
  const M = window.Morada;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const roomId = new URLSearchParams(location.search).get("id");

  let C = structuredClone(M.DEFAULTS), rooms = [];
  try { C = await M.loadContent(); } catch (e) { console.error("Erro ao carregar textos", e); }
  try { rooms = await M.loadRooms(); } catch (e) { console.error("Erro ao carregar salas", e); }

  document.querySelectorAll("[data-c]").forEach(n => n.textContent = C[n.dataset.c] ?? "");
  const wa = text => `https://wa.me/${String(C.whatsapp || "").replace(/\D/g, "")}${text ? "?text=" + encodeURIComponent(text) : ""}`;
  document.querySelectorAll("[data-wa]").forEach(a => a.href = wa());

  const room = rooms.find(r => r.id === roomId);
  if (!room) {
    $("#room-top").innerHTML = `<p>Não encontramos esta sala, ou ela não está disponível agora. <a href="index.html#salas">Ver todas as salas</a></p>`;
    return;
  }
  document.title = `${room.name} · Morada do Ser`;

  // ---------- topo da sala ----------
  const urls = (room.photos || []).map(p => M.photoUrl(p.path)).filter(Boolean);
  const plans = M.plans(C);
  const minRate = Math.min(C.preco_avulso, C.preco_periodo, C.preco_quinzenal, C.semanal_1, C.semanal_4, C.semanal_8, C.pacote_preco / C.pacote_horas);
  $("#room-top").innerHTML = `
    <div class="gallery-main">${urls[0] ? `<img id="g-main" src="${esc(urls[0])}" alt="${esc(room.name)}">` : `<div class="ph"><div>Fotos em breve</div></div>`}</div>
    <div class="room-info">
      <h1>${esc(room.name)}</h1>
      ${room.description ? `<p class="lead">${esc(room.description)}</p>` : ""}
      ${(room.features || []).length ? `<ul class="feats">${room.features.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      <p class="from">A partir de <strong>${M.money(minRate)}</strong> por hora</p>
      <a class="btn" href="#reservar">Reservar esta sala</a>
    </div>
    ${urls.length > 1 ? `<div class="gallery-thumbs">${urls.map((u, i) => `<button type="button" data-i="${i}" aria-label="Foto ${i + 1}" aria-current="${i === 0}"><img src="${esc(u)}" alt=""></button>`).join("")}</div>` : ""}`;
  document.querySelectorAll(".gallery-thumbs button").forEach(b => b.onclick = () => {
    $("#g-main").src = urls[+b.dataset.i];
    document.querySelectorAll(".gallery-thumbs button").forEach(x => x.setAttribute("aria-current", x === b));
  });
  $("#reservar").hidden = false;

  // ---------- estado da reserva ----------
  const H = C.horarios || M.DEFAULTS.horarios;
  const P = (C.periodos && C.periodos.length ? C.periodos : M.DEFAULTS.periodos);
  const openOf = d => H[M.DOW_NAME[d.getDay()]] || null;
  const openDows = [1, 2, 3, 4, 5, 6, 0].filter(i => H[M.DOW_NAME[i]]);
  const minH = Math.min(...openDows.map(i => H[M.DOW_NAME[i]][0]));
  const maxH = Math.max(...openDows.map(i => H[M.DOW_NAME[i]][1]));
  const now = new Date(), todayIso = M.iso(now), nowH = now.getHours();
  const firstWeek = M.monday(now), lastWeek = M.addDays(firstWeek, 7 * 12);

  let plan = null, week = firstWeek, sel = new Set(), occ = {}, loading = false;
  const startInput = $("#f-inicio");
  startInput.min = todayIso;
  startInput.value = M.iso(M.addDays(now, 1));

  const mode = () => !plan ? null : (plan === "avulso" || plan === "pacote") ? "hora" : plan === "periodo" ? "periodo" : "fixo";
  const isPast = (d, h) => { const s = M.iso(d); return s < todayIso || (s === todayIso && h <= nowH); };

  // ---------- escolher plano ----------
  $("#plan-pick").innerHTML = plans.map(p => `
    <label class="pick"><input type="radio" name="plano" value="${p.id}">
      <span class="pick-body"><span class="pick-top"><b>${esc(p.nome)}</b>${p.off > 0 ? `<span class="off">−${p.off}%</span>` : ""}</span>
      <strong>${esc(p.preco)}</strong><small>${esc(p.desc)}</small></span></label>`).join("");
  document.querySelectorAll('input[name="plano"]').forEach(r => r.addEventListener("change", () => {
    plan = r.value; sel.clear(); occ = {};
    $("#step-time").hidden = false; $("#step-data").hidden = false;
    const m = mode();
    $("#rec-start").hidden = m !== "fixo";
    $("#weeknav").hidden = m === "fixo";
    $("#time-title").textContent = m === "fixo" ? "Escolha seus horários fixos" : m === "periodo" ? "Escolha os períodos" : "Escolha os horários";
    $("#time-hint").textContent =
      plan === "avulso" ? "Toque nas horas que quer reservar. Cada hora comporta uma sessão de 50 minutos." :
      plan === "pacote" ? `Marque agora as primeiras horas do pacote, se quiser. As outras você combina depois com a clínica (até ${C.pacote_horas}h no total).` :
      plan === "periodo" ? "Toque nos períodos que quer reservar." :
      plan === "semanal" ? "Toque nas horas que vão se repetir toda semana. Quanto mais horas por semana, menor o valor da hora." :
      "Toque nas horas que vão se repetir a cada 15 dias.";
    refresh();
  }));
  startInput.addEventListener("change", () => { if (startInput.value < todayIso) startInput.value = todayIso; sel.clear(); occ = {}; refresh(); });
  $("#wk-prev").onclick = () => { week = M.addDays(week, -7); refresh(); };
  $("#wk-next").onclick = () => { week = M.addDays(week, 7); refresh(); };

  // ---------- ocupação ----------
  async function loadOcc() {
    const m = mode();
    const from = m === "fixo" ? M.parse(startInput.value) : week;
    const to = m === "fixo" ? M.addDays(from, 181) : M.addDays(week, 6);
    loading = true; drawCal();
    try { Object.assign(occ, await M.loadOccupied(room.id, from, to)); }
    catch (e) { console.error(e); showErr("Não foi possível carregar os horários. Atualize a página."); }
    loading = false;
  }
  // datas relevantes de um dia da semana num plano fixo
  function recDates(dow) {
    const start = M.parse(startInput.value);
    let d = M.addDays(start, (dow - start.getDay() + 7) % 7);
    const step = plan === "quinzenal" ? 14 : 7, out = [];
    for (let i = 0; d <= M.addDays(start, 181); i++, d = M.addDays(d, step)) out.push(d);
    return out;
  }

  // ---------- calendário ----------
  function columns() {
    if (mode() === "fixo") return openDows.map(i => ({ key: String(i), label: M.DOW_NAME[i], sub: "", dow: i }));
    return [0, 1, 2, 3, 4, 5, 6].map(n => M.addDays(week, n)).filter(d => openOf(d))
      .map(d => ({ key: M.iso(d), label: M.DOW_NAME[d.getDay()], sub: M.br(d), date: d }));
  }
  function stateHour(c, h) {
    if (c.date) {
      const o = openOf(c.date);
      if (!o || h < o[0] || h >= o[1]) return "closed";
      if (isPast(c.date, h)) return "past";
      if (occ[c.key]?.has(h)) return "busy";
      return sel.has(`${c.key}|${h}`) ? "sel" : "free";
    }
    const o = H[M.DOW_NAME[c.dow]];
    if (!o || h < o[0] || h >= o[1]) return "closed";
    if (recDates(c.dow).some(d => occ[M.iso(d)]?.has(h))) return "busy";
    return sel.has(`${c.dow}|${h}`) ? "sel" : "free";
  }
  function statePeriod(c, pi) {
    const p = P[pi], o = openOf(c.date);
    if (!o || p.ini < o[0] || p.fim > o[1]) return "closed";
    if (isPast(c.date, p.ini)) return "past";
    for (let h = p.ini; h < p.fim; h++) if (occ[c.key]?.has(h)) return "busy";
    return sel.has(`${c.key}|${pi}`) ? "sel" : "free";
  }
  const LBL = { free: "Livre", sel: "Escolhido", busy: "Ocupado", past: "", closed: "" };

  function drawCal() {
    const cal = $("#cal"), m = mode(); if (!m) return;
    const cols = columns();
    $("#wk-label").textContent = `${M.br(week)} a ${M.br(M.addDays(week, 6))}`;
    $("#wk-prev").disabled = week <= firstWeek;
    $("#wk-next").disabled = week >= lastWeek;
    if (loading) { cal.innerHTML = `<tbody><tr><td class="hint">Carregando horários…</td></tr></tbody>`; return; }
    let html = `<thead><tr><th></th>${cols.map(c => `<th scope="col">${c.label}${c.sub ? `<small>${c.sub}</small>` : ""}</th>`).join("")}</tr></thead><tbody>`;
    if (m === "periodo") {
      P.forEach((p, pi) => {
        html += `<tr><th scope="row">${esc(p.nome)}<small>${p.ini}h–${p.fim}h</small></th>`;
        cols.forEach(c => { const st = statePeriod(c, pi); html += cell(st, `${c.key}|${pi}`, `${c.label} ${c.sub}, ${p.nome}`); });
        html += `</tr>`;
      });
    } else {
      for (let h = minH; h < maxH; h++) {
        html += `<tr><th scope="row">${h}h</th>`;
        cols.forEach(c => { const st = stateHour(c, h); html += cell(st, `${c.key}|${h}`, `${c.label} ${c.sub} às ${h}h`); });
        html += `</tr>`;
      }
    }
    cal.innerHTML = html + "</tbody>";
    cal.classList.toggle("periods", m === "periodo");
  }
  function cell(st, key, label) {
    if (st === "closed") return `<td class="c-closed"></td>`;
    const can = st === "free" || st === "sel";
    return `<td><button type="button" class="cell ${st}" data-k="${esc(key)}" ${can ? "" : "disabled"} aria-pressed="${st === "sel"}" aria-label="${esc(label)}: ${LBL[st] || "indisponível"}">${st === "busy" ? "Ocupado" : st === "sel" ? "✓" : ""}</button></td>`;
  }
  $("#cal").addEventListener("click", e => {
    const b = e.target.closest("button.cell"); if (!b || b.disabled) return;
    const k = b.dataset.k;
    if (sel.has(k)) sel.delete(k);
    else {
      if (plan === "pacote" && sel.size >= C.pacote_horas) return showErr(`O pacote tem ${C.pacote_horas} horas. Desmarque uma hora para escolher outra.`);
      sel.add(k);
    }
    hideErr(); drawCal(); summary();
  });

  async function refresh() { hideErr(); await loadOcc(); drawCal(); summary(); }

  // ---------- resumo ----------
  function compute() {
    const m = mode(), slots = [], lines = [];
    if (!m) return null;
    let hours = 0, total = 0, priceLines = [];
    if (m === "hora") {
      const byDate = {};
      sel.forEach(k => { const [d, h] = k.split("|"); (byDate[d] ||= []).push(+h); });
      Object.keys(byDate).sort().forEach(d => {
        M.ranges(byDate[d]).forEach(([a, b]) => { slots.push({ freq: "unica", data: d, hora_ini: a, hora_fim: b }); lines.push(`${M.DOW_NAME[M.parse(d).getDay()]} ${M.br(M.parse(d))}: ${a}h–${b}h`); });
      });
      hours = sel.size;
      if (plan === "avulso") { total = hours * C.preco_avulso; priceLines.push(`${hours}h × ${M.money(C.preco_avulso)}`); }
      else { total = C.pacote_preco; priceLines.push(`Pacote ${C.pacote_horas}h (${M.money(C.pacote_preco / C.pacote_horas)}/h)`, `${hours} de ${C.pacote_horas}h marcadas agora`); }
    } else if (m === "periodo") {
      [...sel].sort().forEach(k => {
        const [d, pi] = k.split("|"), p = P[+pi];
        slots.push({ freq: "unica", data: d, hora_ini: p.ini, hora_fim: p.fim });
        lines.push(`${M.DOW_NAME[M.parse(d).getDay()]} ${M.br(M.parse(d))}: ${p.nome} (${p.ini}h–${p.fim}h)`);
        hours += p.fim - p.ini;
      });
      total = hours * C.preco_periodo; priceLines.push(`${hours}h × ${M.money(C.preco_periodo)}`);
    } else {
      const byDow = {};
      sel.forEach(k => { const [d, h] = k.split("|"); (byDow[d] ||= []).push(+h); });
      const freq = plan === "quinzenal" ? "quinzenal" : "semanal";
      openDows.filter(d => byDow[d]).forEach(dow => {
        const first = recDates(dow)[0];
        M.ranges(byDow[dow]).forEach(([a, b]) => {
          slots.push({ freq, data: M.iso(first), hora_ini: a, hora_fim: b });
          lines.push(`${freq === "semanal" ? "Toda" : "A cada 15 dias,"} ${M.DOW_LONG[dow]}, ${a}h–${b}h (a partir de ${M.br(first)})`);
        });
      });
      hours = sel.size;
      const rate = freq === "semanal" ? M.semanalRate(C, hours) : C.preco_quinzenal;
      const perMonth = freq === "semanal" ? 4 : 2;
      total = hours * rate * perMonth;
      priceLines.push(`${hours}h por ${freq === "semanal" ? "semana" : "encontro"} × ${M.money(rate)}/h`, `≈ ${perMonth} ${freq === "semanal" ? "semanas" : "encontros"} por mês`);
      if (freq === "semanal" && hours > 0) {
        const next = hours < 4 ? [4, C.semanal_4] : hours < 8 ? [8, C.semanal_8] : null;
        if (next && next[1] < rate) priceLines.push(`Com ${next[0]}h por semana, a hora cai para ${M.money(next[1])}.`);
      }
    }
    const planObj = plans.find(p => p.id === plan);
    const totalLabel = mode() === "fixo" ? "Estimativa por mês" : "Total";
    return { slots, lines, priceLines, total, totalLabel, planName: planObj.nome, hours };
  }

  function summary() {
    const r = compute();
    if (!r) return;
    $("#sum-body").innerHTML = `
      <dl class="sum">
        <dt>Sala</dt><dd>${esc(room.name)}</dd>
        <dt>Plano</dt><dd>${esc(r.planName)}</dd>
        <dt>Horários</dt><dd>${r.lines.length ? `<ul>${r.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : `<span class="hint">${plan === "pacote" ? "Nenhum ainda (opcional)" : "Nenhum escolhido ainda"}</span>`}</dd>
      </dl>
      <div class="price">${r.priceLines.map(l => `<span>${esc(l)}</span>`).join("")}
        <p class="total"><span>${r.totalLabel}</span><strong>${M.money(r.total)}</strong></p></div>`;
    $("#btn-send").disabled = !(r.slots.length || plan === "pacote");
  }

  // ---------- dados e envio ----------
  $("#f-prof").innerHTML = [...(C.publico_lista || []), "Outra área da saúde"].map(p => `<option>${esc(p)}</option>`).join("");
  const showErr = msg => { const e = $("#sum-err"); e.textContent = msg; e.hidden = false; };
  const hideErr = () => { $("#sum-err").hidden = true; };

  $("#btn-send").addEventListener("click", async () => {
    const r = compute(); if (!r) return;
    const nome = $("#f-nome").value.trim(), tel = $("#f-tel").value.trim();
    if (!r.slots.length && plan !== "pacote") return showErr("Escolha pelo menos um horário.");
    if (!nome) { $("#f-nome").focus(); return showErr("Preencha seu nome no passo 3."); }
    if (tel.replace(/\D/g, "").length < 10) { $("#f-tel").focus(); return showErr("Preencha seu WhatsApp com DDD no passo 3."); }
    if (!M.client) return showErr("O site está em modo demonstração e não recebe reservas.");
    hideErr();
    const btn = $("#btn-send"); btn.disabled = true; btn.textContent = "Enviando…";
    const resumo = [`Plano: ${r.planName}`, ...r.lines, `${r.totalLabel}: ${M.money(r.total)}`].join("\n");
    const { data, error } = await M.client.rpc("create_reservation", { p: {
      room_id: room.id, plano: plan, nome, telefone: tel,
      email: $("#f-email").value.trim(), profissao: $("#f-prof").value,
      registro: $("#f-reg").value.trim(), obs: $("#f-obs").value.trim(),
      total: Math.round(r.total * 100) / 100, resumo, slots: r.slots
    }});
    btn.textContent = "Enviar pré-reserva";
    if (error) {
      btn.disabled = false;
      showErr(error.message || "Não foi possível enviar. Tente de novo.");
      if (/reservado/.test(error.message || "")) { sel.clear(); occ = {}; refresh(); }
      return;
    }
    const code = String(data).slice(0, 8).toUpperCase();
    $("#done-code").textContent = code;
    $("#done-wa").href = wa(`Olá! Fiz uma pré-reserva pelo site.\nCódigo: ${code}\nSala: ${room.name}\n${resumo}\nNome: ${nome}`);
    document.querySelector(".booking").hidden = true;
    $("#done").hidden = false;
    $("#done").scrollIntoView({ behavior: "smooth", block: "center" });
  });
})();
