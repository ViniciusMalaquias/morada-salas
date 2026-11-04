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
  const minRate = Math.min(C.preco_avulso, C.preco_antecipada, C.preco_periodo_bloco / 4);
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
  const now = new Date(), todayIso = M.iso(now), nowH = now.getHours() + now.getMinutes() / 60;
  const firstWeek = M.monday(now), lastWeek = M.addDays(firstWeek, 7 * 12);

  let plan = null, week = firstWeek, sel = new Set(), occ = {}, loading = false;
  const startInput = $("#f-inicio");
  startInput.min = todayIso;
  startInput.max = M.iso(M.addDays(now, 90));
  startInput.value = M.iso(M.addDays(now, 1));

  const mode = () => !plan ? null : (plan === "avulso" || plan === "pacote") ? "hora" : plan === "periodo" ? "periodo" : "fixo";
  // Horas antecipadas: "agora" (escolhe no calendário) ou "banco" (compra as horas e marca depois em Minha conta)
  let pacMode = "agora";
  const banco = () => plan === "pacote" && pacMode === "banco";
  const mesIso = d => M.iso(new Date(d.getFullYear(), d.getMonth(), 1));
  $("#bh-mes").innerHTML = [0, 1].map(i => { const v = mesIso(new Date(now.getFullYear(), now.getMonth() + i, 1));
    return `<option value="${v}">${M.mesNome(v).replace(/^./, c => c.toUpperCase())}${i === 0 ? " (este mês)" : ""}</option>`; }).join("");
  const bhMin = () => Number(C.antecipadas_min) || 4;
  const bhHoras = () => { const v = Math.round(Number(String($("#bh-horas").value).replace(",", "."))); return isFinite(v) ? v : 0; };
  $("#bh-horas").min = bhMin(); $("#bh-horas").value = bhMin();
  $("#bh-menos").onclick = () => { $("#bh-horas").value = Math.max(bhMin(), bhHoras() - 1); summary(); };
  $("#bh-mais").onclick = () => { $("#bh-horas").value = Math.min(300, Math.max(bhMin(), bhHoras() + 1)); summary(); };
  $("#bh-horas").addEventListener("input", () => summary());
  $("#bh-horas").addEventListener("change", () => { $("#bh-horas").value = Math.min(300, Math.max(bhMin(), bhHoras())); summary(); });
  $("#bh-mes").addEventListener("change", () => summary());
  document.querySelectorAll('input[name="pacmode"]').forEach(r => r.addEventListener("change", () => { pacMode = r.value; applyPacMode(); }));
  function applyPacMode() {
    const b = banco();
    $("#pac-mode").hidden = plan !== "pacote";
    $("#cal-area").hidden = b;
    $("#banco-box").hidden = !b;
    if (plan === "pacote") {
      $("#time-title").textContent = b ? "Quantas horas você quer comprar" : "Escolha os horários";
      $("#time-hint").textContent = b
        ? `Mínimo de ${C.antecipadas_min} horas, só horas inteiras. As horas valem para qualquer sala, só dentro do mês escolhido (não acumulam). Depois que a clínica confirmar, você marca os horários em Minha conta → Banco de horas. Acerto até o dia 05.`
        : pacHint();
    }
    // banco de horas precisa de conta: some o "Continuar como visitante"
    const g = document.querySelector('#auth-pick [data-m="guest"]');
    if (g) g.hidden = b;
    if (b && authMode === "guest") setMode("login");
    if (!b && authMode !== "user") $("#m-hint").textContent = HINT[authMode] || "";
    hideErr(); summary();
  }
  // Horas antecipadas: só horas inteiras (cada toque marca 1 hora, que pode começar em :30)
  const pacHint = () => `Cada toque marca 1 hora inteira, a partir do quadrinho tocado (ex.: 14h30–15h30); toque de novo para desmarcar. Marque pelo menos ${C.antecipadas_min} horas, todas dentro do mesmo mês. O acerto é feito até o dia 05.`;
  const isPast = (d, h) => { const s = M.iso(d); return s < todayIso || (s === todayIso && h <= nowH); };

  // ---------- escolher plano ----------
  $("#plan-pick").innerHTML = plans.map(p => `
    <label class="pick"><input type="radio" name="plano" value="${p.id}">
      <span class="pick-body"><span class="pick-top"><b>${esc(p.nome)}</b>${p.off > 0 ? `<span class="off">−${p.off}%</span>` : ""}</span>
      <strong>${esc(p.preco)}</strong><small>${esc(p.desc)}</small>${p.desconto ? `<small class="desconto">${esc(p.desconto)}</small>` : ""}</span></label>`).join("");
  document.querySelectorAll('input[name="plano"]').forEach(r => r.addEventListener("change", () => {
    plan = r.value; sel.clear(); occ = {};
    $("#step-time").hidden = false; $("#step-data").hidden = false;
    const m = mode();
    $("#rec-start").hidden = m !== "fixo";
    $("#weeknav").hidden = m === "fixo";
    $("#time-title").textContent = m === "fixo" ? "Escolha seus horários fixos" : m === "periodo" ? "Escolha os períodos" : "Escolha os horários";
    $("#time-hint").textContent =
      plan === "avulso" ? "Cada quadrinho é meia hora (só a hora avulsa aceita meia hora). Toque em cada meia hora que quer usar (toque de novo para desmarcar). Para um intervalo longo, toque no início e no último quadrinho." :
      plan === "pacote" ? pacHint() :
      plan === "periodo" ? `Toque nos períodos que quer reservar. Cada período de 4h sai ${M.money(C.preco_periodo_bloco)}.` :
      plan === "semanal" ? "Toque nas horas que vão se repetir toda semana. Quanto mais horas por semana, menor o valor da hora." :
      "Toque nas horas que vão se repetir a cada 15 dias.";
    applyPacMode();
    refresh();
  }));
  startInput.addEventListener("change", () => { if (startInput.value < todayIso) startInput.value = todayIso;
    if (startInput.value > startInput.max) startInput.value = startInput.max; sel.clear(); occ = {}; refresh(); });
  $("#wk-prev").onclick = () => { week = M.addDays(week, -7); dayKey = null; refresh(); };
  $("#wk-next").onclick = () => { week = M.addDays(week, 7); dayKey = null; refresh(); };

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
  // a meia hora está escolhida? (no pacote, sel guarda só o início de cada hora inteira)
  const selHas = (col, h) => sel.has(`${col}|${h}`) || (plan === "pacote" && sel.has(`${col}|${h - 0.5}`));
  // todas as meias horas escolhidas, como chaves "col|h"
  const selHalves = () => plan === "pacote" ? [...sel].flatMap(k => { const [c, h] = k.split("|"); return [k, `${c}|${+h + 0.5}`]; }) : [...sel];
  function stateHour(c, h) {
    if (c.date) {
      const o = openOf(c.date);
      if (!o || h < o[0] || h >= o[1]) return "closed";
      if (isPast(c.date, h)) return "past";
      if (occ[c.key]?.has(h)) return "busy";
      return selHas(c.key, h) ? "sel" : "free";
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
    for (let h = p.ini; h < p.fim; h += 0.5) if (occ[c.key]?.has(h)) return "busy";
    return sel.has(`${c.key}|${pi}`) ? "sel" : "free";
  }
  const LBL = { free: "Livre", sel: "Escolhido", busy: "Ocupado", past: "", closed: "" };

  // no celular: um dia por vez, com seletor de dias em cima
  const mq = matchMedia("(max-width: 640px)");
  let dayKey = null;
  mq.addEventListener("change", () => drawCal());
  function colInfo(c) {
    const m = mode(); let free = 0, open = 0;
    const count = st => { if (st === "free") free++; if (st !== "past" && st !== "closed") open++; };
    if (m === "periodo") P.forEach((p, pi) => count(statePeriod(c, pi)));
    else for (let h = minH; h < maxH; h += 0.5) count(stateHour(c, h));
    const picked = [...sel].filter(k => k.startsWith(c.key + "|")).length;
    return { free, picked, past: open === 0 };
  }
  function drawDayPick(cols) {
    const box = $("#daypick");
    if (!mq.matches || loading) { box.hidden = true; return cols; }
    const info = cols.map(colInfo);
    if (!cols.some(c => c.key === dayKey)) { const i = info.findIndex(x => x.free > 0); dayKey = cols[Math.max(0, i)]?.key ?? null; }
    box.hidden = false;
    box.innerHTML = cols.map((c, i) => `<button type="button" role="tab" data-day="${esc(c.key)}" aria-selected="${c.key === dayKey}" class="${info[i].free ? "" : "full"}">
      <b>${c.label}</b>${c.sub ? `<small>${c.sub}</small>` : ""}<span>${info[i].picked ? `✓ ${info[i].picked}` : info[i].free ? `${info[i].free} livre${info[i].free > 1 ? "s" : ""}` : info[i].past ? "encerrado" : "lotado"}</span></button>`).join("");
    box.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "center" });
    return cols.filter(c => c.key === dayKey);
  }
  $("#daypick").addEventListener("click", e => { const b = e.target.closest("[data-day]"); if (!b) return; dayKey = b.dataset.day; drawCal(); });

  function drawCal() {
    const cal = $("#cal"), m = mode(); if (!m) return;
    const cols = drawDayPick(columns());
    const one = mq.matches && cols.length === 1;
    $("#wk-label").textContent = `${M.br(week)} a ${M.br(M.addDays(week, 6))}`;
    $("#wk-prev").disabled = week <= firstWeek;
    $("#wk-next").disabled = week >= lastWeek;
    if (loading) { cal.innerHTML = `<tbody><tr><td class="hint">Carregando horários…</td></tr></tbody>`; return; }
    let html = `<thead><tr><th></th>${cols.map(c => `<th scope="col">${c.label}${c.sub ? `<small>${c.sub}</small>` : ""}</th>`).join("")}</tr></thead><tbody>`;
    if (m === "periodo") {
      P.forEach((p, pi) => {
        html += `<tr><th scope="row">${esc(p.nome)}<small>${p.ini}h–${p.fim}h</small></th>`;
        cols.forEach(c => { const st = statePeriod(c, pi); html += cell(st, `${c.key}|${pi}`, `${c.label} ${c.sub}, ${p.nome}`, one); });
        html += `</tr>`;
      });
    } else {
      for (let h = minH; h < maxH; h += 0.5) {
        const half = h % 1 !== 0;
        html += `<tr class="${half ? "half" : "full"}"><th scope="row">${half ? `<span class="hh">${M.hh(h)}</span>` : M.hh(h)}</th>`;
        cols.forEach(c => { const st = stateHour(c, h); html += cell(st, `${c.key}|${h}`, `${c.label} ${c.sub}, das ${M.hh(h)} às ${M.hh(h + 0.5)}`, one); });
        html += `</tr>`;
      }
    }
    cal.innerHTML = html + "</tbody>";
    cal.classList.toggle("periods", m === "periodo");
    cal.classList.toggle("one", one);
  }
  function cell(st, key, label, wide) {
    if (st === "closed") return `<td class="c-closed"></td>`;
    const can = st === "free" || st === "sel";
    const txt = wide ? ({ free: "Livre", sel: "✓ Escolhido", busy: "Ocupado", past: "Já passou" }[st] || "") : st === "busy" ? "Ocupado" : st === "sel" ? "✓" : "";
    return `<td><button type="button" class="cell ${st}" data-k="${esc(key)}" ${can ? "" : "disabled"} aria-pressed="${st === "sel"}" aria-label="${esc(label)}: ${LBL[st] || "indisponível"}">${txt}</button></td>`;
  }
  $("#cal").addEventListener("click", e => {
    const b = e.target.closest("button.cell"); if (!b || b.disabled) return;
    const k = b.dataset.k;
    if (plan === "pacote") { tapHora(k); hideErr(); drawCal(); summary(); return; }
    if (sel.has(k)) { sel.delete(k); lastTap = null; }
    else {
      sel.add(k);
      // tocar no início e depois no fim preenche o intervalo (só horários livres, mesmo dia)
      const [col, hs] = k.split("|"), h = +hs;
      if (mode() === "hora" && lastTap && lastTap.col === col && h >= lastTap.h + 1.5 && sel.has(`${col}|${lastTap.h}`)) {
        const c = columns().find(x => x.key === col), gap = [];
        for (let x = lastTap.h + 0.5; x < h; x += 0.5) gap.push(x);
        if (c && gap.every(x => stateHour(c, x) === "free")) gap.forEach(x => sel.add(`${col}|${x}`));
      }
      lastTap = { col, h };
    }
    hideErr(); drawCal(); summary();
  });
  let lastTap = null;
  // Horas antecipadas: o toque marca a meia hora tocada + a seguinte (ou, se a seguinte não estiver livre, a anterior + a tocada);
  // tocar numa hora escolhida tira a hora inteira
  function tapHora(k) {
    const [col, hs] = k.split("|"), h = +hs;
    const ini = sel.has(k) ? h : sel.has(`${col}|${h - 0.5}`) ? h - 0.5 : null;
    if (ini !== null) { sel.delete(`${col}|${ini}`); return; }
    if (sel.size) {
      const mes = x => x.split("|")[0].slice(0, 7);
      if (mes(k) !== mes([...sel][0])) return showErr("As horas antecipadas precisam ser todas no mesmo mês. Desmarque as do outro mês para escolher estas.");
    }
    const c = columns().find(x => x.key === col); if (!c) return;
    const livre = x => stateHour(c, x) === "free";
    if (livre(h + 0.5)) sel.add(`${col}|${h}`);
    else if (livre(h - 0.5)) sel.add(`${col}|${h - 0.5}`);
    else showErr(`No plano Horas antecipadas os horários são de 1 hora inteira, e não há uma hora livre em ${M.hh(h)}. Escolha outro horário.`);
  }

  async function refresh() { hideErr(); if (!banco()) await loadOcc(); drawCal(); summary(); }

  // ---------- resumo ----------
  function compute() {
    const m = mode(), slots = [], lines = [];
    if (!m) return null;
    let hours = 0, total = 0, priceLines = [];
    if (banco()) {
      const mes = $("#bh-mes").value;
      hours = bhHoras(); total = hours * C.preco_antecipada;
      lines.push(`Banco de horas: ${M.dur(hours)} para usar em ${M.mesNome(mes)}`);
      priceLines.push(`${M.dur(hours)} × ${M.money(C.preco_antecipada)}/h`);
      // no desconto progressivo, cada hora inteira conta como um horário
      const q = Math.floor(hours), descPct = M.descontoPct(C, "pacote", q);
      if (descPct > 0) { total = Math.round(total * (1 - descPct / 100) * 100) / 100; priceLines.push(`Desconto de ${descPct}% (${q} horas)`); }
      const prox = M.descontoProx(C, "pacote", q);
      if (prox) priceLines.push(`Com mais ${prox.falta}h, o desconto vira ${prox.pct}%.`);
      if (hours < C.antecipadas_min) priceLines.push(`O mínimo é de ${C.antecipadas_min}h no mês.`);
      else priceLines.push(`Acerto ${M.dueText({ plano: "pacote", mes_referencia: mes, horas_compradas: hours, created_at: new Date().toISOString() })}`);
      const planObj = plans.find(p => p.id === plan);
      return { slots, lines, priceLines, total, totalLabel: "Total", planName: planObj.nome, hours, banco: true, mes };
    }
    if (m === "hora") {
      const byDate = {};
      selHalves().forEach(k => { const [d, h] = k.split("|"); (byDate[d] ||= []).push(+h); });
      const faixas = [];
      Object.keys(byDate).sort().forEach(d => {
        M.ranges(byDate[d]).forEach(([a, b]) => { faixas.push([a, b]); slots.push({ freq: "unica", data: d, hora_ini: a, hora_fim: b }); lines.push(`${M.DOW_NAME[M.parse(d).getDay()]} ${M.br(M.parse(d))}: ${M.hh(a)}–${M.hh(b)}`); });
      });
      hours = selHalves().length / 2;
      if (plan === "avulso") {
        // por faixa contínua: horas cheias × hora + meia hora que sobrar × preço da meia hora
        const a = M.avulsoDetalhe(C, faixas); total = a.total;
        if (a.cheias) priceLines.push(`${a.cheias}h × ${M.money(C.preco_avulso)}/h`);
        if (a.meias) priceLines.push(`${a.meias} × meia hora (${M.money(M.precoMeia(C))})`);
        priceLines.push("Pago no dia do atendimento");
      }
      else {
        total = hours * C.preco_antecipada; priceLines.push(`${M.dur(hours)} × ${M.money(C.preco_antecipada)}/h`);
        if (hours < C.antecipadas_min) priceLines.push(`Faltam ${M.dur(C.antecipadas_min - hours)} para o mínimo de ${C.antecipadas_min}h no mês.`);
        else priceLines.push("Acerto até o dia 05 do mês");
      }
    } else if (m === "periodo") {
      [...sel].sort().forEach(k => {
        const [d, pi] = k.split("|"), p = P[+pi];
        slots.push({ freq: "unica", data: d, hora_ini: p.ini, hora_fim: p.fim });
        lines.push(`${M.DOW_NAME[M.parse(d).getDay()]} ${M.br(M.parse(d))}: ${p.nome} (${p.ini}h–${p.fim}h)`);
        hours += p.fim - p.ini;
      });
      total = sel.size * C.preco_periodo_bloco; priceLines.push(`${sel.size} ${sel.size > 1 ? "períodos" : "período"} × ${M.money(C.preco_periodo_bloco)}`, "Pago no dia do atendimento");
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
      hours = sel.size / 2;
      const rate = freq === "semanal" ? M.semanalRate(C, hours) : C.preco_quinzenal;
      const perMonth = freq === "semanal" ? 4 : 2;
      total = hours * rate * perMonth;
      priceLines.push(`${hours}h por ${freq === "semanal" ? "semana" : "encontro"} × ${M.money(rate)}/h`, `≈ ${perMonth} ${freq === "semanal" ? "semanas" : "encontros"} por mês`);
      if (freq === "semanal" && hours > 0) {
        const next = hours < 4 ? [4, C.semanal_4] : hours < 8 ? [8, C.semanal_8] : null;
        if (next && next[1] < rate) priceLines.push(`Com ${next[0]}h por semana, a hora cai para ${M.money(next[1])}.`);
      }
    }
    if (m === "hora" || m === "periodo") {
      const n = slots.length, unidade = plan === "periodo" ? "período" : "horário";
      const descPct = M.descontoPct(C, plan, n);
      if (descPct > 0) {
        total = Math.round(total * (1 - descPct / 100) * 100) / 100;
        priceLines.push(`Desconto de ${descPct}% (${n} ${unidade}${n > 1 ? "s" : ""})`);
      }
      const prox = M.descontoProx(C, plan, n);
      if (prox) priceLines.push(`Com mais ${prox.falta} ${unidade}${prox.falta > 1 ? "s" : ""}, o desconto vira ${prox.pct}%.`);
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
        <dt>${r.banco ? "Horas" : "Horários"}</dt><dd>${r.lines.length ? `<ul>${r.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : `<span class="hint">Nenhum escolhido ainda</span>`}${r.banco ? `<span class="hint">Os horários você marca depois, em Minha conta.</span>` : ""}</dd>
      </dl>
      <div class="price">${r.priceLines.map(l => `<span>${esc(l)}</span>`).join("")}
        <p class="total"><span>${r.totalLabel}</span><strong>${M.money(r.total)}</strong></p></div>`;
    $("#btn-send").disabled = (!r.banco && !r.slots.length) || (plan === "pacote" && r.hours < C.antecipadas_min);
    $("#btn-send").textContent = r.banco ? "Enviar compra de horas" : "Enviar pré-reserva";
  }

  // ---------- dados, conta e envio ----------
  $("#f-prof").innerHTML = [...(C.publico_lista || []), "Outra área da saúde"].map(p => `<option>${esc(p)}</option>`).join("");
  $("#regras").innerHTML = (C.regras || []).map(r => `<li>${esc(r)}</li>`).join("");
  const showErr = msg => { const e = $("#sum-err"); e.textContent = msg; e.hidden = false; };
  const hideErr = () => { $("#sum-err").hidden = true; };
  const sb = M.client;
  let authMode = "guest", user = null;
  const HINT = {
    guest: "Sem cadastro. Você acompanha a reserva pelo código e pelo WhatsApp.",
    login: "Entre para ver todas as suas reservas num lugar só.",
    signup: "Crie a conta junto com a reserva: preencha os dados abaixo e escolha uma senha."
  };
  const HINT_BANCO = {
    login: "Para comprar horas e marcar depois, entre na sua conta: é nela que fica o seu banco de horas.",
    signup: "Crie a conta: depois de confirmar o e-mail que enviamos, entre e conclua a compra das horas."
  };
  function setMode(m) {
    authMode = m;
    document.querySelectorAll("#auth-pick .seg button").forEach(b => b.setAttribute("aria-selected", b.dataset.m === m));
    $("#m-hint").textContent = (banco() && HINT_BANCO[m]) || HINT[m] || "";
    $("#login-box").hidden = m !== "login";
    $("#f-res").hidden = m === "login";
    $("#pass-wrap").hidden = m !== "signup";
  }
  document.querySelectorAll("#auth-pick .seg button").forEach(b => b.addEventListener("click", () => setMode(b.dataset.m)));

  async function useUser(u) {
    user = u; if (!u) { $("#who").hidden = true; $("#auth-pick").hidden = false; $("#f-email").disabled = false; setMode(banco() ? "login" : "guest"); return; }
    const p = await M.getProfile();
    $("#who-name").textContent = p?.nome || u.email; $("#who-email").textContent = p?.nome ? `(${u.email})` : "";
    $("#who").hidden = false; $("#auth-pick").hidden = true;
    authMode = "user"; $("#f-res").hidden = false; $("#pass-wrap").hidden = true;
    if (p?.nome) $("#f-nome").value = p.nome;
    if (p?.telefone) $("#f-tel").value = p.telefone;
    if (p?.profissao) $("#f-prof").value = p.profissao;
    if (p?.registro) $("#f-reg").value = p.registro;
    if (p?.cpf) $("#f-cpf").value = M.cpfFormat(p.cpf);
    $("#f-email").value = u.email; $("#f-email").disabled = true;
  }
  if (sb) useUser(await M.getUser());
  $("#who-out").onclick = async () => { await sb.auth.signOut(); useUser(null); };
  $("#a-login").onclick = async () => {
    const e = $("#a-err"); e.hidden = true;
    const { data, error } = await sb.auth.signInWithPassword({ email: $("#a-email").value.trim(), password: $("#a-pass").value });
    if (error) { e.textContent = /confirm/i.test(error.message) ? "Confirme seu e-mail pelo link que enviamos antes de entrar." : "E-mail ou senha incorretos."; e.hidden = false; return; }
    useUser(data.user);
  };

  $("#btn-send").addEventListener("click", async () => {
    const r = compute(); if (!r) return;
    const nome = $("#f-nome").value.trim(), tel = $("#f-tel").value.trim(), email = $("#f-email").value.trim(), cpf = M.onlyDigits($("#f-cpf").value);
    if (!r.banco && !r.slots.length) return showErr("Escolha pelo menos um horário.");
    if (r.banco && authMode === "guest") { setMode("login"); return showErr("Para comprar horas e marcar depois, entre na sua conta ou crie uma no passo 3."); }
    if (plan === "pacote" && r.hours < C.antecipadas_min) return showErr(`As horas antecipadas são de no mínimo ${C.antecipadas_min} horas no mês.`);
    if (authMode === "login") return showErr(r.banco ? "Entre na sua conta no passo 3 (ou crie uma) para comprar as horas." : "Entre na sua conta ou escolha Continuar como visitante.");
    if (!M.fullName(nome)) { $("#f-nome").focus(); return showErr("Preencha seu nome completo no passo 3."); }
    if (!M.emailValid(email)) { $("#f-email").focus(); return showErr("Preencha um e-mail válido no passo 3."); }
    if (!M.cpfValid(cpf)) { $("#f-cpf").focus(); return showErr("CPF inválido. Confira os números no passo 3."); }
    if (tel.replace(/\D/g, "").length < 10) { $("#f-tel").focus(); return showErr("Preencha o telefone de contato com DDD no passo 3."); }
    if (authMode === "signup" && $("#f-pass").value.length < 8) { $("#f-pass").focus(); return showErr("A senha precisa ter pelo menos 8 caracteres."); }
    if (!$("#f-aceite").checked) { $("#f-aceite").focus(); return showErr("Para reservar, marque que você aceita as regras de uso."); }
    if (!sb) return showErr("O site está em modo demonstração e não recebe reservas.");
    hideErr();
    const btn = $("#btn-send"); btn.disabled = true; btn.textContent = "Enviando…";
    const reset = () => { btn.disabled = false; btn.textContent = r.banco ? "Enviar compra de horas" : "Enviar pré-reserva"; };

    let pendingConfirm = false;
    if (authMode === "signup") {
      const { data, error } = await sb.auth.signUp({ email, password: $("#f-pass").value, options: {
        emailRedirectTo: new URL("conta.html", location.href).href,
        data: { nome, telefone: tel, cpf, profissao: $("#f-prof").value, registro: $("#f-reg").value.trim() } } });
      if (error) { reset(); return showErr(/registered|exists/i.test(error.message) ? "Já existe uma conta com esse e-mail. Use a opção Entrar." : `Não foi possível criar a conta: ${error.message}`); }
      if (data.session) user = data.user; else pendingConfirm = true;
      if (r.banco && pendingConfirm) {
        reset();
        return showErr(`Conta criada! Confirme o e-mail que enviamos para ${email} e depois entre (opção Entrar) para concluir a compra das horas.`);
      }
    }

    const resumo = [`Plano: ${r.planName}`, ...r.lines, `${r.totalLabel}: ${M.money(r.total)}`].join("\n");
    const { data, error } = await sb.rpc("request_reservation", { p: {
      room_id: room.id, plano: plan, nome, telefone: tel, email, cpf,
      profissao: $("#f-prof").value, registro: $("#f-reg").value.trim(), obs: $("#f-obs").value.trim(),
      total: Math.round(r.total * 100) / 100, resumo, slots: r.slots, aceite: "true",
      ...(r.banco ? { modo: "banco", mes: r.mes, horas: r.hours } : {}),
      forma: document.querySelector('input[name="forma"]:checked')?.value || "pix"
    }});
    reset();
    if (error) {
      showErr(error.message || "Não foi possível enviar. Tente de novo.");
      if (/reservado/.test(error.message || "")) { sel.clear(); occ = {}; refresh(); }
      return;
    }
    const code = data.codigo;
    if (data.total != null) r.total = Number(data.total); // valor calculado pela clínica (banco)
    const quando = M.dueText(r.banco ? { plano: plan, mes_referencia: r.mes, horas_compradas: r.hours, created_at: new Date().toISOString() } : { plano: plan, slots: r.slots });
    $("#done-title").textContent = r.banco ? "Compra de horas enviada!" : "Pré-reserva enviada!";
    $("#done-lead").textContent = r.banco
      ? `${M.dur(r.hours)} para usar em ${M.mesNome(r.mes)}. Depois que a clínica confirmar, as horas aparecem no seu Banco de horas, em Minha conta, onde você marca os horários.`
      : "Os horários ficam separados para você até a clínica confirmar.";
    $("#done-code").textContent = code;
    const forma = document.querySelector('input[name="forma"]:checked')?.value || "pix";
    const pixPl = forma === "pix" && C.pix_chave ? M.pixPayload({ chave: C.pix_chave, nome: C.pix_nome, cidade: C.pix_cidade, valor: Math.round(r.total * 100) / 100, txid: code }) : "";
    $("#done-pay").innerHTML = `
      <p>${r.banco ? "A clínica confirma a compra pelo WhatsApp" : "Seu horário fica reservado enquanto a clínica confirma pelo WhatsApp"}, em até 2 horas no horário de funcionamento. Valor: <b>${M.money(r.total)}</b>, a pagar <b>${quando}</b>.</p>
      ${forma === "link"
        ? `<p><b>Pagamento com cartão de crédito:</b> a clínica vai entrar em contato pelo WhatsApp para enviar o link de pagamento.</p>`
        : pixPl ? `<div class="pix-done"><div class="qr" data-qr="${esc(pixPl)}" aria-label="QR Code Pix"></div><div class="stack" style="gap:8px;min-width:0;flex:1"><b>Pague com Pix</b><span class="small muted">Aponte a câmera do app do banco para o QR Code ou use o copia e cola:</span><div class="copyrow"><input type="text" readonly value="${esc(pixPl)}" aria-label="Pix copia e cola"><button type="button" class="copy" data-copy="${esc(pixPl)}">Copiar</button></div></div></div>
          <p class="muted small">${esc(C.pagamento_texto || "")}</p>` : ""}`;
    $("#done-note").textContent = pendingConfirm
      ? `Sua conta foi criada. Confirme o e-mail que enviamos para ${email}; depois de entrar, esta reserva aparece em Minha conta.`
      : user ? "Você acompanha esta reserva em Minha conta." : "Guarde o código: com ele e seu WhatsApp você acompanha a reserva em Minha conta.";
    $("#done-wa").href = wa(`Olá! Fiz ${r.banco ? "uma compra de horas antecipadas (banco de horas)" : "uma pré-reserva"} pelo site.\nCódigo: ${code}\nSala: ${room.name}\n${resumo}\nPagamento: ${forma === "link" ? "cartão de crédito (link de pagamento)" : "Pix"}\nNome: ${nome}`);
    if (window.qrcode) document.querySelectorAll("[data-qr]").forEach(el => { const q = qrcode(0, "M"); q.addData(el.dataset.qr); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); });
    document.querySelectorAll("#done [data-copy]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copiado"; } catch { b.previousElementSibling.select(); } });
    document.querySelector(".booking").hidden = true;
    $("#done").hidden = false;
    $("#done").scrollIntoView({ behavior: "smooth", block: "center" });
  });
})();
