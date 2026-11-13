(async function () {
  // Reservar horário: plano → horários (de todas as salas) → salas livres nesses horários → dados
  const M = window.Morada;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const prefId = new URLSearchParams(location.search).get("sala");

  let C = structuredClone(M.DEFAULTS), rooms = [];
  try { C = await M.loadContent(); } catch (e) { console.error("Erro ao carregar textos", e); }
  try { rooms = await M.loadRooms(); } catch (e) { console.error("Erro ao carregar salas", e); }

  document.querySelectorAll("[data-c]").forEach(n => n.textContent = C[n.dataset.c] ?? "");
  const wa = text => `https://wa.me/${String(C.whatsapp || "").replace(/\D/g, "")}${text ? "?text=" + encodeURIComponent(text) : ""}`;
  document.querySelectorAll("[data-wa]").forEach(a => a.href = wa());

  if (!rooms.length) {
    document.querySelector(".booking").innerHTML = `<div class="card"><p>Nenhuma sala disponível para reserva no momento. <a data-wa href="${esc(wa())}" target="_blank" rel="noopener">Fale com a gente pelo WhatsApp</a>.</p></div>`;
    return;
  }
  const roomById = id => rooms.find(r => r.id === id);

  // ---------- filtro "Ver horários de" (todas as salas ou uma só) ----------
  let onlyRoom = roomById(prefId) ? prefId : "";
  if (rooms.length > 1) {
    $("#room-filter").hidden = false;
    $("#f-sala").innerHTML = `<option value="">Todas as salas</option>` + rooms.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
    $("#f-sala").value = onlyRoom;
    $("#f-sala").addEventListener("change", () => { onlyRoom = $("#f-sala").value; drawCal(); drawRooms(); summary(); });
  } else $("#lg-count").hidden = true;
  const gridRooms = () => onlyRoom ? rooms.filter(r => r.id === onlyRoom) : rooms;

  // ---------- estado da reserva ----------
  const H = C.horarios || M.DEFAULTS.horarios;
  const P = (C.periodos && C.periodos.length ? C.periodos : M.DEFAULTS.periodos);
  const openOf = d => H[M.DOW_NAME[d.getDay()]] || null;
  const openDows = [1, 2, 3, 4, 5, 6, 0].filter(i => H[M.DOW_NAME[i]]);
  const minH = Math.min(...openDows.map(i => H[M.DOW_NAME[i]][0]));
  const maxH = Math.max(...openDows.map(i => H[M.DOW_NAME[i]][1]));
  const now = new Date(), todayIso = M.iso(now), nowH = now.getHours() + now.getMinutes() / 60;
  const firstWeek = M.monday(now), lastWeek = M.addDays(firstWeek, 7 * 12);

  // occ: { salaId: { "2026-11-10": Set([14, 14.5]) } }; loaded: semanas já carregadas
  let plan = null, week = firstWeek, sel = new Set(), occ = {}, loaded = new Set(), loading = false, chosen = null;

  const mode = () => !plan ? null : (plan === "avulso" || plan === "pacote") ? "hora" : "periodo";
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

  // numeração dos passos (no banco de horas não tem o passo "Escolha a sala")
  const nDados = () => banco() ? 3 : 4;
  function renumber() {
    $("#step-room").hidden = !plan || banco();
    $("#step-data .n").textContent = nDados();
  }
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
    renumber();
    // banco de horas precisa de conta: some o "Continuar como visitante"
    const g = document.querySelector('#auth-pick [data-m="guest"]');
    if (g) g.hidden = b;
    if (b && authMode === "guest") setMode("login");
    if (!b && authMode !== "user") $("#m-hint").textContent = HINT[authMode] || "";
    hideErr(); drawRooms(); summary();
  }
  // Horas antecipadas: só horas inteiras (cada toque marca 1 hora, que pode começar em :30)
  const pacHint = () => `Cada toque marca 1 hora inteira, a partir do quadrinho tocado (ex.: 14h30–15h30); toque de novo para desmarcar. Marque pelo menos ${C.antecipadas_min} horas, todas dentro do mesmo mês. O acerto é feito até o dia 05.`;
  const isPast = (d, h) => { const s = M.iso(d); return s < todayIso || (s === todayIso && h <= nowH); };

  // ---------- escolher plano ----------
  const plans = M.plans(C);
  $("#plan-pick").innerHTML = plans.map(p => `
    <label class="pick"><input type="radio" name="plano" value="${p.id}">
      <span class="pick-body"><span class="pick-top"><b>${esc(p.nome)}</b>${p.off > 0 ? `<span class="off">−${p.off}%</span>` : ""}</span>
      <strong>${esc(p.preco)}</strong><small>${esc(p.desc)}</small>${p.desconto ? `<small class="desconto">${esc(p.desconto)}</small>` : ""}</span></label>`).join("");
  document.querySelectorAll('input[name="plano"]').forEach(r => r.addEventListener("change", () => {
    plan = r.value; sel.clear(); lastTap = null;
    $("#step-time").hidden = false; $("#step-data").hidden = false;
    $("#time-title").textContent = mode() === "periodo" ? "Escolha os períodos" : "Escolha os horários";
    $("#time-hint").textContent =
      plan === "avulso" ? "Cada quadrinho é meia hora (só a hora avulsa aceita meia hora). Toque em cada meia hora que quer usar (toque de novo para desmarcar). Para um intervalo longo, toque no início e no último quadrinho." :
      plan === "pacote" ? pacHint() :
      `Toque nos períodos que quer reservar. Cada período de 4h sai ${M.money(C.preco_periodo_bloco)}.`;
    applyPacMode();
    refresh();
  }));
  $("#wk-prev").onclick = () => { week = M.addDays(week, -7); dayKey = null; refresh(); };
  $("#wk-next").onclick = () => { week = M.addDays(week, 7); dayKey = null; refresh(); };

  // ---------- ocupação (de todas as salas) ----------
  async function loadOcc() {
    const wk = M.iso(week);
    if (loaded.has(wk)) return;
    loading = true; drawCal();
    try {
      const to = M.addDays(week, 6);
      const maps = await Promise.all(rooms.map(r => M.loadOccupied(r.id, week, to)));
      rooms.forEach((r, i) => Object.assign(occ[r.id] ||= {}, maps[i]));
      loaded.add(wk);
    } catch (e) { console.error(e); showErr("Não foi possível carregar os horários. Atualize a página."); }
    loading = false;
  }
  const busyIn = (rid, d, h) => !!occ[rid]?.[d]?.has(h);
  const freeAt = (d, h) => gridRooms().filter(r => !busyIn(r.id, d, h));
  const freeInPeriod = (d, p) => gridRooms().filter(r => { for (let h = p.ini; h < p.fim; h += 0.5) if (busyIn(r.id, d, h)) return false; return true; });

  // ---------- calendário ----------
  function columns() {
    return [0, 1, 2, 3, 4, 5, 6].map(n => M.addDays(week, n)).filter(d => openOf(d))
      .map(d => ({ key: M.iso(d), label: M.DOW_NAME[d.getDay()], sub: M.br(d), date: d }));
  }
  // a meia hora está escolhida? (no pacote, sel guarda só o início de cada hora inteira)
  const selHas = (col, h) => sel.has(`${col}|${h}`) || (plan === "pacote" && sel.has(`${col}|${h - 0.5}`));
  // todas as meias horas escolhidas, como chaves "data|h"
  const selHalves = () => plan === "pacote" ? [...sel].flatMap(k => { const [c, h] = k.split("|"); return [k, `${c}|${+h + 0.5}`]; }) : [...sel];
  function stateHour(c, h) {
    const o = openOf(c.date);
    if (!o || h < o[0] || h >= o[1]) return "closed";
    if (isPast(c.date, h)) return "past";
    if (selHas(c.key, h)) return "sel";
    return freeAt(c.key, h).length ? "free" : "busy";
  }
  function statePeriod(c, pi) {
    const p = P[pi], o = openOf(c.date);
    if (!o || p.ini < o[0] || p.fim > o[1]) return "closed";
    if (isPast(c.date, p.ini)) return "past";
    if (sel.has(`${c.key}|${pi}`)) return "sel";
    return freeInPeriod(c.key, p).length ? "free" : "busy";
  }
  const LBL = { free: "Livre", sel: "Escolhido", busy: "Todas as salas ocupadas", past: "", closed: "" };

  // no celular: um dia por vez, com seletor de dias em cima
  const mq = matchMedia("(max-width: 640px)");
  let dayKey = null;
  mq.addEventListener("change", () => drawCal());
  function colInfo(c) {
    let free = 0, open = 0;
    const count = st => { if (st === "free") free++; if (st !== "past" && st !== "closed") open++; };
    if (mode() === "periodo") P.forEach((p, pi) => count(statePeriod(c, pi)));
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
    const many = gridRooms().length > 1;
    $("#wk-label").textContent = `${M.br(week)} a ${M.br(M.addDays(week, 6))}`;
    $("#wk-prev").disabled = week <= firstWeek;
    $("#wk-next").disabled = week >= lastWeek;
    $("#lg-count").hidden = !many;
    if (loading) { cal.innerHTML = `<tbody><tr><td class="hint">Carregando horários…</td></tr></tbody>`; return; }
    let html = `<thead><tr><th></th>${cols.map(c => `<th scope="col">${c.label}${c.sub ? `<small>${c.sub}</small>` : ""}</th>`).join("")}</tr></thead><tbody>`;
    if (m === "periodo") {
      P.forEach((p, pi) => {
        html += `<tr><th scope="row">${esc(p.nome)}<small>${p.ini}h–${p.fim}h</small></th>`;
        cols.forEach(c => { const st = statePeriod(c, pi); html += cell(st, `${c.key}|${pi}`, `${c.label} ${c.sub}, ${p.nome}`, one, many && st === "free" ? freeInPeriod(c.key, p).length : 0); });
        html += `</tr>`;
      });
    } else {
      for (let h = minH; h < maxH; h += 0.5) {
        const half = h % 1 !== 0;
        html += `<tr class="${half ? "half" : "full"}"><th scope="row">${half ? `<span class="hh">${M.hh(h)}</span>` : M.hh(h)}</th>`;
        cols.forEach(c => { const st = stateHour(c, h); html += cell(st, `${c.key}|${h}`, `${c.label} ${c.sub}, das ${M.hh(h)} às ${M.hh(h + 0.5)}`, one, many && st === "free" ? freeAt(c.key, h).length : 0); });
        html += `</tr>`;
      }
    }
    cal.innerHTML = html + "</tbody>";
    cal.classList.toggle("periods", m === "periodo");
    cal.classList.toggle("one", one);
  }
  // n = quantas salas estão livres naquele horário (só quando há mais de uma sala na grade)
  function cell(st, key, label, wide, n) {
    if (st === "closed") return `<td class="c-closed"></td>`;
    const can = st === "free" || st === "sel";
    const salas = n ? `${n} sala${n > 1 ? "s" : ""} livre${n > 1 ? "s" : ""}` : "";
    const txt = wide ? ({ free: salas || "Livre", sel: "✓ Escolhido", busy: "Ocupado", past: "Já passou" }[st] || "") : st === "busy" ? "Ocupado" : st === "sel" ? "✓" : n ? String(n) : "";
    return `<td><button type="button" class="cell ${st}" data-k="${esc(key)}" ${can ? "" : "disabled"} aria-pressed="${st === "sel"}" aria-label="${esc(label)}: ${salas || LBL[st] || "indisponível"}">${txt}</button></td>`;
  }
  $("#cal").addEventListener("click", e => {
    const b = e.target.closest("button.cell"); if (!b || b.disabled) return;
    const k = b.dataset.k;
    if (plan === "pacote") { tapHora(k); hideErr(); drawCal(); drawRooms(); summary(); return; }
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
    hideErr(); drawCal(); drawRooms(); summary();
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
    // a hora inteira precisa estar livre na mesma sala
    const livre2 = (a, b) => gridRooms().some(r => !busyIn(r.id, col, a) && !busyIn(r.id, col, b));
    const ok = x => stateHour(c, x) === "free";
    if (ok(h + 0.5) && livre2(h, h + 0.5)) sel.add(`${col}|${h}`);
    else if (ok(h - 0.5) && livre2(h - 0.5, h)) sel.add(`${col}|${h - 0.5}`);
    else showErr(`No plano Horas antecipadas os horários são de 1 hora inteira, e não há uma hora livre em ${M.hh(h)}. Escolha outro horário.`);
  }

  async function refresh() { hideErr(); if (!banco()) await loadOcc(); drawCal(); drawRooms(); summary(); }

  // ---------- passo 3: salas livres em todos os horários escolhidos ----------
  // meias horas escolhidas, como [data, h]
  function pickedHalves() {
    if (mode() === "periodo") return [...sel].flatMap(k => { const [d, pi] = k.split("|"), p = P[+pi], out = [];
      for (let h = p.ini; h < p.fim; h += 0.5) out.push([d, h]); return out; });
    return selHalves().map(k => { const [d, h] = k.split("|"); return [d, +h]; });
  }
  // horários em que a sala está ocupada (dentre os escolhidos), já em faixas legíveis
  function conflitos(rid, halves) {
    const byDate = {};
    halves.filter(([d, h]) => busyIn(rid, d, h)).forEach(([d, h]) => (byDate[d] ||= []).push(h));
    return Object.keys(byDate).sort().flatMap(d => M.ranges(byDate[d]).map(([a, b]) => `${M.DOW_NAME[M.parse(d).getDay()]} ${M.br(M.parse(d))} ${M.hh(a)}–${M.hh(b)}`));
  }
  function drawRooms() {
    if (!plan || banco()) { chosen = null; return; }
    const halves = pickedHalves(), box = $("#room-pick");
    if (!halves.length) {
      chosen = null;
      $("#room-hint").textContent = "Escolha os horários no passo 2 para ver as salas livres.";
      box.innerHTML = ""; return;
    }
    const list = rooms.map(r => ({ r, busy: conflitos(r.id, halves) }));
    const free = list.filter(x => !x.busy.length);
    // mantém a escolha se a sala continua livre; senão escolhe a do filtro ou a única livre
    if (!free.some(x => x.r.id === chosen)) {
      chosen = free.find(x => x.r.id === onlyRoom)?.r.id || (free.length === 1 ? free[0].r.id : null);
    }
    $("#room-hint").textContent = !free.length
      ? "Nenhuma sala está livre em todos os horários escolhidos. Troque algum horário (cada reserva é numa sala só) ou faça uma reserva para cada sala."
      : free.length === 1 ? "Esta é a sala livre em todos os horários escolhidos." : `${free.length} salas estão livres em todos os horários escolhidos. Escolha uma.`;
    box.innerHTML = [...free, ...list.filter(x => x.busy.length)].map(({ r, busy }) => {
      const foto = r.photos?.[0] ? M.photoUrl(r.photos[0].path) : "";
      const feats = (r.features || []).slice(0, 3);
      return `<label class="rpick${busy.length ? " rp-busy" : ""}"><input type="radio" name="sala" value="${esc(r.id)}" ${busy.length ? "disabled" : ""} ${r.id === chosen ? "checked" : ""}>
        <span class="rpick-body">
          <span class="rpick-img">${foto ? `<img src="${esc(foto)}" alt="" loading="lazy">` : ""}</span>
          <span class="rpick-txt"><b>${esc(r.name)}</b>
            ${busy.length ? `<small class="busy-txt">Ocupada em: ${esc(busy.slice(0, 3).join(", "))}${busy.length > 3 ? ` e mais ${busy.length - 3}` : ""}</small>`
              : `<small class="ok-txt">Livre em todos os horários</small>${feats.length ? `<small>${esc(feats.join(" · "))}</small>` : ""}`}
            <a href="sala.html?id=${encodeURIComponent(r.id)}" target="_blank" rel="noopener" class="small">Ver fotos da sala</a></span>
        </span></label>`;
    }).join("");
  }
  $("#room-pick").addEventListener("change", e => { if (e.target.name === "sala") { chosen = e.target.value; hideErr(); summary(); } });

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
    const totalLabel = "Total";
    return { slots, lines, priceLines, total, totalLabel, planName: planObj.nome, hours };
  }

  const salaNome = () => banco() ? "Qualquer sala (você escolhe ao marcar)" : roomById(chosen)?.name || "";
  function summary() {
    const r = compute();
    if (!r) return;
    const sala = salaNome();
    $("#sum-body").innerHTML = `
      <dl class="sum">
        <dt>Plano</dt><dd>${esc(r.planName)}</dd>
        <dt>${r.banco ? "Horas" : "Horários"}</dt><dd>${r.lines.length ? `<ul>${r.lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : `<span class="hint">Nenhum escolhido ainda</span>`}${r.banco ? `<span class="hint">Os horários você marca depois, em Minha conta.</span>` : ""}</dd>
        <dt>Sala</dt><dd>${sala ? esc(sala) : `<span class="hint">${r.slots.length ? "Escolha no passo 3" : "Depois dos horários"}</span>`}</dd>
      </dl>
      <div class="price">${r.priceLines.map(l => `<span>${esc(l)}</span>`).join("")}
        <p class="total"><span>${r.totalLabel}</span><strong>${M.money(r.total)}</strong></p></div>`;
    $("#btn-send").disabled = (!r.banco && (!r.slots.length || !chosen)) || (plan === "pacote" && r.hours < C.antecipadas_min);
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
    if (!r.banco && !chosen) { $("#step-room").scrollIntoView({ behavior: "smooth", block: "center" }); return showErr("Escolha a sala no passo 3."); }
    if (r.banco && authMode === "guest") { setMode("login"); return showErr(`Para comprar horas e marcar depois, entre na sua conta ou crie uma no passo ${nDados()}.`); }
    if (plan === "pacote" && r.hours < C.antecipadas_min) return showErr(`As horas antecipadas são de no mínimo ${C.antecipadas_min} horas no mês.`);
    if (authMode === "login") return showErr(r.banco ? `Entre na sua conta no passo ${nDados()} (ou crie uma) para comprar as horas.` : "Entre na sua conta ou escolha Continuar como visitante.");
    if (!M.fullName(nome)) { $("#f-nome").focus(); return showErr(`Preencha seu nome completo no passo ${nDados()}.`); }
    if (!M.emailValid(email)) { $("#f-email").focus(); return showErr(`Preencha um e-mail válido no passo ${nDados()}.`); }
    if (!M.cpfValid(cpf)) { $("#f-cpf").focus(); return showErr(`CPF inválido. Confira os números no passo ${nDados()}.`); }
    if (tel.replace(/\D/g, "").length < 10) { $("#f-tel").focus(); return showErr(`Preencha o telefone de contato com DDD no passo ${nDados()}.`); }
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

    // banco de horas vale para qualquer sala; a reserva só precisa de uma sala ativa de referência
    const roomId = r.banco ? (chosen || onlyRoom || rooms[0].id) : chosen;
    const resumo = [`Plano: ${r.planName}`, ...(r.banco ? [] : [`Sala: ${salaNome()}`]), ...r.lines, `${r.totalLabel}: ${M.money(r.total)}`].join("\n");
    const { data, error } = await sb.rpc("request_reservation", { p: {
      room_id: roomId, plano: plan, nome, telefone: tel, email, cpf,
      profissao: $("#f-prof").value, registro: $("#f-reg").value.trim(), obs: $("#f-obs").value.trim(),
      total: Math.round(r.total * 100) / 100, resumo, slots: r.slots, aceite: "true",
      ...(r.banco ? { modo: "banco", mes: r.mes, horas: r.hours } : {}),
      forma: document.querySelector('input[name="forma"]:checked')?.value || "pix"
    }});
    reset();
    if (error) {
      showErr(error.message || "Não foi possível enviar. Tente de novo.");
      if (/reservado/.test(error.message || "")) { sel.clear(); occ = {}; loaded.clear(); refresh(); }
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
    $("#done-wa").href = wa(`Olá! Fiz ${r.banco ? "uma compra de horas antecipadas (banco de horas)" : "uma pré-reserva"} pelo site.\nCódigo: ${code}\n${resumo}\nPagamento: ${forma === "link" ? "cartão de crédito (link de pagamento)" : "Pix"}\nNome: ${nome}`);
    if (window.qrcode) document.querySelectorAll("[data-qr]").forEach(el => { const q = qrcode(0, "M"); q.addData(el.dataset.qr); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); });
    document.querySelectorAll("#done [data-copy]").forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "Copiado"; } catch { b.previousElementSibling.select(); } });
    document.querySelector(".booking").hidden = true;
    $("#done").hidden = false;
    $("#done").scrollIntoView({ behavior: "smooth", block: "center" });
  });

  // ---------- vindo do convite de remarcar (Minha conta): plano, horário e sala já escolhidos ----------
  // reservar.html?sala=ID&plano=avulso|pacote|periodo&data=AAAA-MM-DD&ini=14&fim=15 (no período: &periodo=índice)
  (async () => {
    const q = new URLSearchParams(location.search), pl = q.get("plano"), dt = q.get("data") || "";
    if (!pl || !/^\d{4}-\d{2}-\d{2}$/.test(dt) || dt < todayIso) return;
    const radio = [...document.querySelectorAll('input[name="plano"]')].find(x => x.value === pl);
    const d = M.parse(dt); if (!radio || !openOf(d)) return;
    radio.checked = true; radio.dispatchEvent(new Event("change"));
    week = M.monday(d);
    if (pl === "periodo") { const pi = Number(q.get("periodo")); if (!P[pi]) return; sel.add(`${dt}|${pi}`); }
    else {
      const ini = Number(q.get("ini")), fim = Number(q.get("fim"));
      if (!(fim > ini) || (ini * 2) % 1 || (fim * 2) % 1) return;
      for (let h = ini; h < fim; h += pl === "pacote" ? 1 : 0.5) sel.add(`${dt}|${h}`);
    }
    if (roomById(prefId)) chosen = prefId;
    await refresh();
    const halves = pickedHalves();
    const indisponivel = !chosen || chosen !== prefId || halves.some(([dd, h]) => isPast(M.parse(dd), h)) || conflitos(chosen, halves).length;
    if (indisponivel) {
      sel.clear(); chosen = null; await refresh();
      $("#step-time").scrollIntoView({ behavior: "smooth", block: "start" });
      return showErr("Esse horário acabou de ser ocupado. Escolha outro na agenda abaixo.");
    }
    $("#step-data").scrollIntoView({ behavior: "smooth", block: "start" });
  })();
})();
