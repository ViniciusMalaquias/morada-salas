// E-mails para o cliente: pré-reserva recebida, reserva confirmada e lembrete na véspera.
// Chamada pelo banco (gatilhos e agendamento via pg_net/pg_cron):
//   { tipo: "pedido", id }     → logo depois da pré-reserva pelo site
//   { tipo: "confirmada", id } → quando a clínica confirma (e quando o cliente marca um horário pelo banco de horas)
//   { tipo: "lembretes" }      → a cada hora; manda o lembrete de quem atende nas próximas 24h
// Segura para ficar pública: cada e-mail sai uma vez só e apenas na janela de tempo certa.
// Segredos: GMAIL_USER e GMAIL_APP_PASSWORD.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";

const SITE = "https://viniciusmalaquias.github.io/morada-salas/";
const LOGO = SITE + "img/logo-email.png";
const DOW = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const PLANO: Record<string, string> = { avulso: "Hora avulsa", pacote: "Horas antecipadas", periodo: "Período de 4h", semanal: "Fixo semanal", quinzenal: "Fixo quinzenal" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (v: unknown) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const pad = (n: number) => String(n).padStart(2, "0");
const hh = (h: unknown) => { const n = Number(h), H = Math.floor(n), m = Math.round((n - H) * 60); return m ? `${H}h${String(m).padStart(2, "0")}` : `${H}h`; };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mesNome = (iso: string) => { const [y, m] = String(iso).split("-").map(Number); return `${MESES[m - 1]} de ${y}`; };
const dur = (h: unknown) => { const n = Number(h), H = Math.floor(n), m = Math.round((n - H) * 60); return H ? (m ? `${H}h${String(m).padStart(2, "0")}` : `${H}h`) : m ? `${m} min` : "0h"; };
const first = (n: string) => String(n || "").trim().split(/\s+/)[0] || "";

// ---------- Pix copia e cola (mesmo formato do site) ----------
function crc16(str: string) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) { crc ^= str.charCodeAt(i) << 8; for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
function pixPayload(chave: string, nome: string, cidade: string, valor: number, txid: string) {
  const norm = (v: string) => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, "").toUpperCase().trim();
  const f = (id: string, v: string) => id + String(v.length).padStart(2, "0") + v;
  const p = f("00", "01") + f("26", f("00", "br.gov.bcb.pix") + f("01", chave.trim())) + f("52", "0000") + f("53", "986")
    + (valor > 0 ? f("54", valor.toFixed(2)) : "") + f("58", "BR") + f("59", norm(nome).slice(0, 25) || "RECEBEDOR")
    + f("60", norm(cidade).slice(0, 15) || "JUNDIAI") + f("62", f("05", txid.replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***")) + "6304";
  return p + crc16(p);
}

function fmtSlot(s: any) {
  const [y, m, d] = s.data.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]}, ${pad(d)}/${pad(m)}, das ${hh(s.hora_ini)} às ${hh(s.hora_fim)}`;
}
function dueText(r: any) {
  if (r.plano !== "pacote") return "no dia do atendimento";
  const firstDate = r.mes_referencia || (r.reservation_slots || []).map((s: any) => s.data).sort()[0];
  if (!firstDate) return "até o dia 05";
  const [y, m] = firstDate.split("-").map(Number);
  // banco de horas comprado depois do dia 05: paga no dia da compra
  if (r.horas_compradas != null && r.created_at) {
    const c = new Date(new Date(r.created_at).getTime() - 3 * 3600e3);   // horário de Brasília
    if (c.getUTCFullYear() === y && c.getUTCMonth() + 1 === m && c.getUTCDate() > 5) return `até ${pad(c.getUTCDate())}/${pad(m)}`;
  }
  return `até 05/${pad(m)}`;
}

function layout(o: { pre: string; titulo: string; corpo: string; botao?: [string, string]; extra?: string }) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3efeb;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${o.pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efeb;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e9e2dc;">
<tr><td align="center" style="background:#f9f7f5;padding:26px 24px 18px;border-bottom:3px solid #ce8b7e;"><a href="${SITE}"><img src="${LOGO}" width="110" alt="Clínica Morada do Ser" style="display:block;border:0;width:110px;height:auto;"></a></td></tr>
<tr><td style="padding:32px 36px 4px;font-family:Georgia,'Times New Roman',serif;font-size:25px;line-height:1.25;color:#38312e;">${o.titulo}</td></tr>
<tr><td style="padding:12px 36px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#5b514c;">${o.corpo}</td></tr>
${o.botao ? `<tr><td style="padding:24px 36px 4px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#b35a4d;"><a href="${o.botao[1]}" style="display:inline-block;padding:13px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#fff;text-decoration:none;border-radius:999px;">${o.botao[0]}</a></td></tr></table></td></tr>` : ""}
${o.extra || ""}
<tr><td style="padding:24px 36px 28px;"></td></tr>
<tr><td style="background:#38312e;padding:20px 36px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#d9cfc8;"><strong style="color:#fff;">Clínica Morada do Ser</strong> · Salas para atendimento<br>Rua Adolfo Torricelli, 284 · Vianelo, Jundiaí · SP<br>WhatsApp <a href="https://wa.me/5511953063868" style="color:#e8b8ad;text-decoration:none;">(11) 95306-3868</a> · <a href="${SITE}conta.html" style="color:#e8b8ad;text-decoration:none;">Minha conta</a></td></tr>
</table><p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#a69a93;margin:16px 0 0;">E-mail automático. Para falar com a clínica, use o WhatsApp.</p></td></tr></table></body></html>`;
}
const box = (html: string) => `<tr><td style="padding:18px 36px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9f7f5;border:1px solid #e9e2dc;border-radius:12px;"><tr><td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#38312e;">${html}</td></tr></table></td></tr>`;
const isCompra = (r: any) => r.plano === "pacote" && r.horas_compradas != null;
const bancoLinha = (r: any) => `Banco de horas: ${dur(r.horas_compradas)} para usar em ${mesNome(r.mes_referencia)}`;
const detalhes = (r: any, slots: any[]) => isCompra(r)
  ? box(`<b>${esc(PLANO[r.plano])}</b> · banco de horas<br>${esc(bancoLinha(r))}<br>As horas valem em qualquer sala, só dentro desse mês.<br>Código: <b>${esc(r.codigo)}</b>`)
  : box(`<b>${esc(r.rooms?.name || "Sala")}</b> · ${esc(r.usa_banco_de ? "Horas antecipadas · banco de horas" : PLANO[r.plano] || r.plano)}<br>${slots.map((s) => esc(fmtSlot(s))).join("<br>")}<br>Código da reserva: <b>${esc(r.codigo)}</b>`);

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  const { tipo, id } = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) { console.error("Faltam GMAIL_USER/GMAIL_APP_PASSWORD"); return json({ error: "sem segredos" }, 500); }
  const tr = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
  const send = (to: string, subject: string, html: string, text: string) =>
    tr.sendMail({ from: `"Clínica Morada do Ser" <${user}>`, to, subject, html, text, replyTo: "clinica.moradadoser@gmail.com" });
  const SEL = "id,codigo,nome,email,plano,status,total,desconto_pct,forma_escolhida,link_pagamento,created_at,decided_at,aceite_em,email_pedido_em,email_confirmada_em,horas_compradas,mes_referencia,usa_banco_de,user_id,rooms(name),reservation_slots(data,hora_ini,hora_fim),payments(valor)";
  const descLine = (r: any) => Number(r.desconto_pct || 0) > 0 ? `Desconto aplicado: ${Number(r.desconto_pct)}%<br>` : "";
  const descTxt = (r: any) => Number(r.desconto_pct || 0) > 0 ? `Desconto aplicado: ${Number(r.desconto_pct)}%\n` : "";
  const ord = (a: any, b: any) => a.data.localeCompare(b.data) || a.hora_ini - b.hora_ini;

  // ---------- pré-reserva recebida ----------
  if (tipo === "pedido") {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return json({ error: "id" }, 400);
    const { data: r } = await sb.from("reservations").select(SEL).eq("id", id).maybeSingle();
    if (!r || !r.email || !r.aceite_em || r.email_pedido_em || Date.now() - new Date(r.created_at).getTime() > 15 * 60e3) return json({ skipped: true });
    const { data: ok } = await sb.from("reservations").update({ email_pedido_em: new Date().toISOString() }).eq("id", id).is("email_pedido_em", null).select("id");
    if (!ok?.length) return json({ skipped: true });
    const slots = (r.reservation_slots || []).sort(ord);
    const pag = r.forma_escolhida === "link" ? "cartão de crédito (a clínica envia o link pelo WhatsApp)" : "Pix";
    const compra = isCompra(r);
    try {
      await send(r.email, compra ? `Recebemos sua compra de horas · ${mesNome(r.mes_referencia)}` : `Recebemos sua pré-reserva · ${r.rooms?.name || "Morada do Ser"}`,
        layout({ pre: compra ? "A clínica confirma a compra em até 2 horas." : "Seu horário está separado. A clínica confirma em até 2 horas.", titulo: compra ? "Recebemos sua compra de horas" : "Recebemos sua pré-reserva",
          corpo: compra ? `Olá, ${esc(first(r.nome))}! A clínica confirma a compra pelo WhatsApp em até 2 horas, no horário de funcionamento. Depois disso, as horas aparecem no seu Banco de horas, em Minha conta, onde você marca os horários.`
            : `Olá, ${esc(first(r.nome))}! Seu horário já está separado. A clínica confirma pelo WhatsApp em até 2 horas, no horário de funcionamento.`,
          extra: detalhes(r, slots) + box(`${descLine(r)}Valor: <b>${money(r.total)}</b>, a pagar ${dueText(r)}<br>Forma de pagamento: ${pag}`),
          botao: ["Acompanhar a reserva", SITE + "conta.html"] }),
        `Recebemos sua ${compra ? "compra de horas" : "pré-reserva"} (código ${r.codigo}).\n${compra ? bancoLinha(r) : `${r.rooms?.name} · ${PLANO[r.plano]}\n${slots.map(fmtSlot).join("\n")}`}\n${descTxt(r)}Valor: ${money(r.total)}, a pagar ${dueText(r)} (${pag}).\nA clínica confirma pelo WhatsApp em até 2 horas.\nAcompanhe em ${SITE}conta.html`);
    } catch (e) { await sb.from("reservations").update({ email_pedido_em: null }).eq("id", id); console.error("pedido", String(e)); return json({ error: "envio" }, 502); }
    return json({ ok: true });
  }

  // ---------- reserva confirmada ----------
  if (tipo === "confirmada") {
    if (!/^[0-9a-f-]{36}$/i.test(String(id))) return json({ error: "id" }, 400);
    const { data: r } = await sb.from("reservations").select(SEL).eq("id", id).maybeSingle();
    if (!r || !r.email || r.status !== "confirmada" || r.plano === "bloqueio" || r.email_confirmada_em || Date.now() - new Date(r.decided_at || 0).getTime() > 60 * 60e3) return json({ skipped: true });
    const { data: ok } = await sb.from("reservations").update({ email_confirmada_em: new Date().toISOString() }).eq("id", id).is("email_confirmada_em", null).select("id");
    if (!ok?.length) return json({ skipped: true });
    const slots = (r.reservation_slots || []).sort(ord);
    const pago = (r.payments || []).reduce((s: number, p: any) => s + Number(p.valor || 0), 0);
    const falta = Math.max(0, Number(r.total || 0) - pago);
    const compra = isCompra(r), uso = !!r.usa_banco_de;
    let pagHtml = "Pagamento recebido. Obrigada!";
    let pagTxt = pagHtml;
    if (uso) {
      const mes = slots[0] ? slots[0].data.slice(0, 8) + "01" : "";
      const { data: b } = mes && r.user_id ? await sb.rpc("banco_horas_resumo", { p_user: r.user_id, p_mes: mes }) : { data: null };
      pagHtml = `Estas horas saíram do seu banco de horas${b ? `. Saldo de ${esc(mesNome(mes))}: <b>${dur(b.saldo)}</b>` : ""}.<br><span style="font-size:12px;color:#8a7f79">Cancelando com mais de 24 horas de antecedência, em Minha conta, as horas voltam para o saldo.</span>`;
      pagTxt = `Estas horas saíram do seu banco de horas${b ? `. Saldo de ${mesNome(mes)}: ${dur(b.saldo)}` : ""}.`;
    } else if (falta > 0) {
      if (r.forma_escolhida === "link") {
        const link = /^https?:\/\//i.test(r.link_pagamento || "") ? r.link_pagamento : "";
        pagHtml = `Valor: <b>${money(falta)}</b>, a pagar ${dueText(r)}, com cartão de crédito.<br>${link ? `<a href="${esc(link)}" style="color:#a24f43;font-weight:bold">Pagar com cartão →</a>` : "A clínica vai enviar o link de pagamento pelo WhatsApp."}`;
        pagTxt = `Valor: ${money(falta)}, a pagar ${dueText(r)}, com cartão de crédito. ${link || "A clínica vai enviar o link pelo WhatsApp."}`;
      } else {
        const { data: cfg } = await sb.from("site_content").select("key,value").in("key", ["pix_chave", "pix_nome", "pix_cidade"]);
        const g = (k: string, d: string) => { const v = cfg?.find((x) => x.key === k)?.value; return typeof v === "string" && v.trim() ? v.trim() : d; };
        const chave = g("pix_chave", "08174363000155");
        const pl = pixPayload(chave, g("pix_nome", "Clinica Morada do Ser"), g("pix_cidade", "Jundiai"), Math.round(falta * 100) / 100, r.codigo);
        pagHtml = `Valor: <b>${money(falta)}</b>, a pagar ${dueText(r)}, por Pix.<br>Chave Pix (CNPJ): <b>${esc(chave)}</b><br><span style="font-size:12px;color:#8a7f79">Pix copia e cola (já com o valor):</span><br><span style="font-family:monospace;font-size:11px;word-break:break-all;color:#5b514c">${esc(pl)}</span><br><span style="font-size:12px;color:#8a7f79">Depois de pagar, envie o comprovante pelo WhatsApp com o código da reserva.</span>`;
        pagTxt = `Valor: ${money(falta)}, a pagar ${dueText(r)}, por Pix.\nChave (CNPJ): ${chave}\nPix copia e cola: ${pl}\nDepois envie o comprovante pelo WhatsApp.`;
      }
    }
    try {
      await send(r.email,
        uso ? `Horário marcado pelo banco de horas · ${r.rooms?.name || "Morada do Ser"} · ${slots[0] ? fmtSlot(slots[0]) : ""}`
          : compra ? `Compra de horas confirmada · ${mesNome(r.mes_referencia)}`
          : `Reserva confirmada · ${r.rooms?.name || "Morada do Ser"} · ${slots[0] ? fmtSlot(slots[0]) : ""}`,
        layout({ pre: uso ? "Seu horário está marcado e confirmado." : compra ? "Suas horas já estão no seu banco de horas." : "Sua reserva na Clínica Morada do Ser está confirmada.",
          titulo: uso ? "Horário marcado pelo banco de horas" : compra ? "Sua compra de horas está confirmada" : "Sua reserva está confirmada",
          corpo: uso ? `Olá, ${esc(first(r.nome))}! Seu horário está marcado e confirmado. Na véspera, mandamos um lembrete.`
            : compra ? `Olá, ${esc(first(r.nome))}! As horas já estão no seu Banco de horas. Para marcar os horários, entre em Minha conta e toque em <b>Marcar horário</b>.`
            : `Olá, ${esc(first(r.nome))}! Está tudo certo: a sala é sua no horário abaixo. Na véspera, mandamos um lembrete.`,
          extra: detalhes(r, slots) + box(descLine(r) + pagHtml), botao: [compra ? "Marcar meus horários" : "Ver minha reserva", SITE + "conta.html"] }),
        `${uso ? "Horário marcado pelo banco de horas" : compra ? "Sua compra de horas está confirmada" : "Sua reserva está confirmada"} (código ${r.codigo}).\n${compra ? bancoLinha(r) + "\nMarque os horários em " + SITE + "conta.html" : `${r.rooms?.name} · ${PLANO[r.plano]}\n${slots.map(fmtSlot).join("\n")}`}\n${descTxt(r)}${pagTxt}\nEndereço: Rua Adolfo Torricelli, 284, Vianelo, Jundiaí`);
    } catch (e) { await sb.from("reservations").update({ email_confirmada_em: null }).eq("id", id); console.error("confirmada", String(e)); return json({ error: "envio" }, 502); }
    return json({ ok: true });
  }

  // ---------- lembrete da véspera ----------
  if (tipo === "lembretes") {
    const { data: due, error } = await sb.rpc("lembretes_pendentes");
    if (error) { console.error("lembretes_pendentes", error.message); return json({ error: error.message }, 500); }
    let n = 0;
    for (const d of due || []) {
      const { error: insErr } = await sb.from("lembretes_enviados").insert({ reservation_id: d.reservation_id, data: d.data });
      if (insErr) continue; // já enviado
      const { data: r } = await sb.from("reservations").select(SEL).eq("id", d.reservation_id).maybeSingle();
      if (!r?.email) continue;
      const slots = (r.reservation_slots || []).filter((s: any) => s.data === d.data).sort(ord);
      try {
        await send(r.email, `Lembrete: ${r.rooms?.name || "sua sala"} · ${slots[0] ? fmtSlot(slots[0]) : ""}`,
          layout({ pre: "Seu atendimento na Morada do Ser é amanhã.", titulo: "Seu horário está chegando",
            corpo: `Olá, ${esc(first(r.nome))}! Passando para lembrar do seu horário na Clínica Morada do Ser.`,
            extra: detalhes(r, slots) + box(`Rua Adolfo Torricelli, 284 · Vianelo, Jundiaí<br><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("Rua Adolfo Torricelli, 284, Vianelo, Jundiaí")}" style="color:#a24f43;font-weight:bold">Abrir no mapa →</a><br><span style="font-size:12px;color:#8a7f79">Desmarcações precisam de 24 horas de antecedência. Em caso de atraso, o horário agendado é mantido.</span>`),
            botao: ["Ver minha reserva", SITE + "conta.html"] }),
          `Lembrete: ${r.rooms?.name} · ${slots.map(fmtSlot).join(", ")} (código ${r.codigo}).\nRua Adolfo Torricelli, 284, Vianelo, Jundiaí.`);
        n++;
      } catch (e) { await sb.from("lembretes_enviados").delete().eq("reservation_id", d.reservation_id).eq("data", d.data); console.error("lembrete", String(e)); }
    }
    return json({ ok: true, enviados: n });
  }
  return json({ error: "tipo inválido" }, 400);
});
