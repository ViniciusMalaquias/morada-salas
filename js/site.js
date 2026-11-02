(async function () {
  const M = window.Morada;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const rich = s => esc(s).replace(/\*(.+?)\*/g, "<em>$1</em>");
  const el = (tag, attrs = {}, html = "") => { const e = document.createElement(tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); if (html) e.innerHTML = html; return e; };

  if (!M.configured) $("#demo-notice").hidden = false;

  let C = structuredClone(M.DEFAULTS), rooms = [];
  try { C = await M.loadContent(); } catch (e) { console.error("Erro ao carregar textos", e); }
  try { rooms = await M.loadRooms(); } catch (e) { console.error("Erro ao carregar salas", e); }

  // textos simples
  document.querySelectorAll("[data-c]").forEach(n => {
    const v = C[n.dataset.c];
    if (n.hasAttribute("data-rich")) n.innerHTML = rich(v); else n.textContent = v ?? "";
  });

  const wa = (text) => `https://wa.me/${String(C.whatsapp || "").replace(/\D/g, "")}${text ? "?text=" + encodeURIComponent(text) : ""}`;
  document.querySelectorAll("[data-wa]").forEach(a => a.href = wa());
  $("#map").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(`${C.endereco} ${C.bairro_cidade}`);

  // destaques
  $("#facts").innerHTML = (C.destaques || []).slice(0, 3).map(d => `<div><strong>${esc(d.titulo)}</strong><span>${esc(d.texto)}</span></div>`).join("");

  // foto do topo (ou primeira foto da primeira sala)
  const heroSrc = M.photoUrl(C.hero_foto) || (rooms[0]?.photos?.[0] ? M.photoUrl(rooms[0].photos[0].path) : "");
  if (heroSrc) $("#hero-photo").innerHTML = `<img src="${esc(heroSrc)}" alt="Sala de atendimento da Clínica Morada do Ser">`;

  $("#publico").innerHTML = (C.publico_lista || []).map(p => `<span>${esc(p)}</span>`).join("");
  $("#estrutura").innerHTML = (C.estrutura_itens || []).map(i => `<div class="feat"><h3>${esc(i.titulo)}</h3><p>${esc(i.texto)}</p></div>`).join("");
  $("#passos").innerHTML = (C.passos || []).map(i => `<li><h3>${esc(i.titulo)}</h3><p>${esc(i.texto)}</p></li>`).join("");

  // salas
  const roomsBox = $("#rooms");
  roomsBox.classList.toggle("one", rooms.length === 1);
  roomsBox.innerHTML = rooms.length ? "" : `<p class="hint">Nenhuma sala disponível no momento. Fale com a gente pelo WhatsApp.</p>`;
  rooms.forEach(r => {
    const card = el("article", { class: "room" });
    const urls = (r.photos || []).map(p => M.photoUrl(p.path)).filter(Boolean);
    const main = el("div", { class: "room-main" });
    main.innerHTML = urls[0]
      ? `<img src="${esc(urls[0])}" alt="${esc(r.name)}" loading="lazy">`
      : `<div class="ph"><div>Fotos em breve</div></div>`;
    card.appendChild(main);
    if (urls.length > 1) {
      const th = el("div", { class: "thumbs" });
      urls.forEach((u, i) => {
        const b = el("button", { type: "button", "aria-label": `Foto ${i + 1} de ${r.name}`, "aria-current": i === 0 ? "true" : "false" }, `<img src="${esc(u)}" alt="" loading="lazy">`);
        b.onclick = () => { main.querySelector("img").src = u; th.querySelectorAll("button").forEach(x => x.setAttribute("aria-current", x === b ? "true" : "false")); };
        th.appendChild(b);
      });
      card.appendChild(th);
    }
    const body = el("div", { class: "room-body" });
    body.innerHTML = `<h3>${esc(r.name)}</h3>${r.description ? `<p>${esc(r.description)}</p>` : ""}${(r.features || []).length ? `<ul>${r.features.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}`;
    const go = el("a", { class: "btn", href: "#agenda" }, "Ver horários desta sala");
    go.onclick = () => { $("#f-sala").value = r.name; update(); };
    body.appendChild(go);
    card.appendChild(body);
    roomsBox.appendChild(card);
  });

  // agenda
  const days = (C.dias && C.dias.length ? C.dias : M.DEFAULTS.dias);
  const h0 = Number(C.hora_inicio ?? 8), h1 = Number(C.hora_fim ?? 18);
  $("#agenda-texto").textContent = `Escolha a sala e toque nos horários que te interessam. Cada período é de 1 hora, das ${h0}h às ${h1}h. A mensagem para o WhatsApp é montada com as suas escolhas e a gente responde com a disponibilidade e os valores.`;
  $("#sched thead").innerHTML = `<tr><th></th>${days.map(d => `<th scope="col">${esc(d)}</th>`).join("")}</tr>`;
  const tbody = $("#sched tbody");
  for (let h = h0; h < h1; h++) {
    const tr = el("tr");
    tr.innerHTML = `<th scope="row">${h}h</th>`;
    days.forEach(d => {
      const td = el("td");
      const b = el("button", { type: "button", class: "slot", "aria-pressed": "false", "aria-label": `${d} às ${h}h`, "data-day": d, "data-hour": `${h}h` });
      b.onclick = () => { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); update(); };
      td.appendChild(b); tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }

  const sala = $("#f-sala");
  sala.innerHTML = rooms.length > 1 ? `<option value="">Qualquer sala</option>` : "";
  sala.innerHTML += rooms.map(r => `<option>${esc(r.name)}</option>`).join("");
  $("#f-sala-wrap").hidden = rooms.length === 0;
  sala.onchange = update;
  $("#f-prof").innerHTML = [...(C.publico_lista || []), "Outra área da saúde"].map(p => `<option>${esc(p)}</option>`).join("");

  function picked() {
    const out = {};
    document.querySelectorAll('.slot[aria-pressed="true"]').forEach(b => (out[b.dataset.day] ||= []).push(b.dataset.hour));
    return days.filter(d => out[d]).map(d => `${d}: ${out[d].join(", ")}`);
  }
  function update() {
    const n = document.querySelectorAll('.slot[aria-pressed="true"]').length;
    const s = sala.value ? `<br>${esc(sala.value)}` : "";
    $("#summary").innerHTML = n ? `<b>${n} hora${n > 1 ? "s" : ""} por semana</b>${s}<br>${esc(picked().join(" · "))}` : "Nenhum horário marcado ainda.";
  }
  $("#req").addEventListener("submit", e => {
    e.preventDefault();
    const nome = $("#f-nome").value.trim(), prof = $("#f-prof").value, obs = $("#f-obs").value.trim(), p = picked();
    let m = `Olá! ${nome ? `Sou ${nome}, ` : ""}${prof.toLowerCase()}, e tenho interesse em alugar ${sala.value ? `a ${sala.value}` : "uma sala"} da Morada do Ser.`;
    m += p.length ? `\n\nHorários que procuro:\n- ${p.join("\n- ")}` : `\n\nGostaria de saber os horários disponíveis.`;
    if (obs) m += `\n\n${obs}`;
    m += `\n\nPoderia me passar a disponibilidade e os valores?`;
    window.open(wa(m), "_blank", "noopener");
  });
  update();
})();
