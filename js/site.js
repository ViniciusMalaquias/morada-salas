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
  const addr = `${C.endereco}, ${C.bairro_cidade}`.replace(" · ", ", ");
  $("#map").href = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr);
  $("#map-frame").src = "https://maps.google.com/maps?q=" + encodeURIComponent(addr) + "&z=16&hl=pt-BR&output=embed";

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
    const link = `sala.html?id=${encodeURIComponent(r.id)}`;
    const main = el("a", { class: "room-main", href: link, "aria-label": `Ver horários livres da ${r.name}` });
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
    body.innerHTML = `<h3><a href="${link}">${esc(r.name)}</a></h3>${r.description ? `<p>${esc(r.description)}</p>` : ""}${(r.features || []).length ? `<ul>${r.features.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}`;
    body.appendChild(el("a", { class: "btn btn-res", href: link }, `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>Reservar e ver horários livres`));
    card.appendChild(body);
    roomsBox.appendChild(card);
  });

  // planos
  $("#plans").innerHTML = M.plans(C).map(p => `<article class="plan">
      ${p.off > 0 ? `<span class="off">−${p.off}%</span>` : ""}
      <h3>${esc(p.nome)}</h3><strong>${esc(p.preco)}</strong><p>${esc(p.desc)}</p>
      ${p.desconto ? `<small class="desconto">${esc(p.desconto)}</small>` : ""}</article>`).join("");
  $("#regras").innerHTML = (C.regras || []).map(r => `<li>${esc(r)}</li>`).join("");
})();
