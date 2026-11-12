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
  const minRate = Math.min(C.preco_avulso, C.preco_antecipada, C.preco_periodo_bloco / 4);
  $("#room-top").innerHTML = `
    <div class="gallery-main">${urls[0] ? `<img id="g-main" src="${esc(urls[0])}" alt="${esc(room.name)}">` : `<div class="ph"><div>Fotos em breve</div></div>`}</div>
    <div class="room-info">
      <h1>${esc(room.name)}</h1>
      ${room.description ? `<p class="lead">${esc(room.description)}</p>` : ""}
      ${(room.features || []).length ? `<ul class="feats">${room.features.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      <p class="from">A partir de <strong>${M.money(minRate)}</strong> por hora</p>
      <a class="btn" data-reservar href="reservar.html">Ver horários livres e reservar</a>
    </div>
    ${urls.length > 1 ? `<div class="gallery-thumbs">${urls.map((u, i) => `<button type="button" data-i="${i}" aria-label="Foto ${i + 1}" aria-current="${i === 0}"><img src="${esc(u)}" alt=""></button>`).join("")}</div>` : ""}`;
  document.querySelectorAll(".gallery-thumbs button").forEach(b => b.onclick = () => {
    $("#g-main").src = urls[+b.dataset.i];
    document.querySelectorAll(".gallery-thumbs button").forEach(x => x.setAttribute("aria-current", x === b));
  });
  // reservar: leva ao fluxo "Reservar horário" com esta sala já filtrada
  document.querySelectorAll("[data-reservar]").forEach(a => a.href = `reservar.html?sala=${encodeURIComponent(room.id)}`);
  $("#room-cta").hidden = false;
})();
