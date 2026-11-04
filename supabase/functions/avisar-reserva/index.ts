// Avisa a clínica por e-mail a cada nova pré-reserva feita pelo site (inclui compra de banco de horas)
// e a cada horário marcado pelo cliente com o saldo do banco de horas (já confirmado).
// Chamada pelo banco (trigger em reservations, via pg_net) com { id }.
// Segura para ficar pública: só envia para reservas recém-criadas que ainda não foram avisadas.
// Segredos (Edge Functions → Secrets): GMAIL_USER e GMAIL_APP_PASSWORD (senha de app do Gmail).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import nodemailer from "npm:nodemailer@6.9.16";

const DOW = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const PLANO: Record<string, string> = { avulso: "Hora avulsa", pacote: "Horas antecipadas", periodo: "Período de 4h", semanal: "Fixo semanal", quinzenal: "Fixo quinzenal" };
const SITE = "https://viniciusmalaquias.github.io/morada-salas/";
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const money = (v: unknown) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hh = (h: unknown) => { const n = Number(h), H = Math.floor(n), m = Math.round((n - H) * 60); return m ? `${H}h${String(m).padStart(2, "0")}` : `${H}h`; };
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mesNome = (iso: string) => { const [y, m] = String(iso).split("-").map(Number); return `${MESES[m - 1]} de ${y}`; };
const dur = (h: unknown) => { const n = Number(h), H = Math.floor(n), m = Math.round((n - H) * 60); return H ? (m ? `${H}h${String(m).padStart(2, "0")}` : `${H}h`) : m ? `${m} min` : "0h"; };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  const { id } = await req.json().catch(() => ({}));
  if (!id || !/^[0-9a-f-]{36}$/i.test(String(id))) return json({ error: "id inválido" }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: r } = await sb.from("reservations")
    .select("id,codigo,nome,telefone,email,profissao,registro,obs,plano,total,desconto_pct,forma_escolhida,created_at,avisado_em,aceite_em,horas_compradas,mes_referencia,usa_banco_de,user_id,rooms(name),reservation_slots(data,hora_ini,hora_fim)")
    .eq("id", id).maybeSingle();
  if (!r || r.avisado_em || (!r.aceite_em && !r.usa_banco_de) || Date.now() - new Date(r.created_at).getTime() > 15 * 60e3) return json({ ok: true, skipped: true });

  const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) return json({ error: "Faltam os segredos GMAIL_USER e GMAIL_APP_PASSWORD" }, 500);

  // marca antes de enviar para não mandar duas vezes
  const { data: marked } = await sb.from("reservations").update({ avisado_em: new Date().toISOString() }).eq("id", id).is("avisado_em", null).select("id");
  if (!marked?.length) return json({ ok: true, skipped: true });

  const { data: cfg } = await sb.from("site_content").select("key,value").in("key", ["email_avisos", "email"]);
  const get = (k: string) => { const v = cfg?.find((x) => x.key === k)?.value; return typeof v === "string" ? v.trim() : ""; };
  const to = get("email_avisos") || get("email") || "clinica.moradadoser@gmail.com";

  const slots = (r.reservation_slots || []).slice().sort((a: any, b: any) => a.data.localeCompare(b.data) || a.hora_ini - b.hora_ini)
    .map((s: any) => { const [y, m, d] = s.data.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1, d)); return `${DOW[dt.getUTCDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}, ${hh(s.hora_ini)}–${hh(s.hora_fim)}`; });
  const sala = (r as any).rooms?.name || "Sala";
  const uso = !!r.usa_banco_de, compra = r.plano === "pacote" && r.horas_compradas != null;
  const bancoTxt = compra ? `Banco de horas: ${dur(r.horas_compradas)} para usar em ${mesNome(r.mes_referencia)}` : "";
  let saldoTxt = "";
  if (uso && r.user_id && slots.length) {
    const mes = r.reservation_slots[0].data.slice(0, 8) + "01";
    const { data: b } = await sb.rpc("banco_horas_resumo", { p_user: r.user_id, p_mes: mes });
    if (b) saldoTxt = `Saldo de ${mesNome(mes)} depois deste horário: ${dur(b.saldo)} (de ${dur(Number(b.compradas) + Number(b.ajustes))})`;
  }
  const eyebrow = uso ? "Horário marcado pelo banco de horas · já confirmado" : compra ? "Nova compra de horas · aguardando confirmação" : "Nova pré-reserva · aguardando confirmação";
  let tel = String(r.telefone || "").replace(/\D/g, ""); if (tel.length === 10 || tel.length === 11) tel = "55" + tel;
  const row = (k: string, v: string) => `<tr><td style="padding:6px 12px 6px 0;color:#8a7f79;white-space:nowrap;vertical-align:top">${k}</td><td style="padding:6px 0;color:#38312e">${v}</td></tr>`;

  const html = `<div style="background:#f3efeb;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" style="max-width:540px;margin:auto;background:#fff;border-radius:14px;border:1px solid #e9e2dc;border-top:4px solid #b35a4d" cellpadding="0" cellspacing="0"><tr><td style="padding:28px 32px">
    <p style="margin:0;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a24f43;font-weight:bold">${eyebrow}</p>
    <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;color:#38312e;margin:8px 0 18px">${esc(r.nome)} · ${esc(compra ? "Banco de horas" : sala)}</h1>
    <table role="presentation" style="font-size:14px;line-height:1.5;border-collapse:collapse">
      ${row("Plano", esc(uso ? "Horas antecipadas · banco de horas" : PLANO[r.plano] || r.plano))}
      ${row(compra ? "Horas" : "Horários", compra ? esc(bancoTxt) : slots.map(esc).join("<br>") || "—")}
      ${uso ? row("Saldo", esc(saldoTxt || "—")) : row("Valor", `<b>${money(r.total)}</b>${Number(r.desconto_pct || 0) > 0 ? ` <span style="color:#a24f43">(−${Number(r.desconto_pct)}% desconto)</span>` : ""}`)}
      ${uso ? "" : row("Pagamento", r.forma_escolhida === "link" ? "<b>Cartão de crédito</b> · enviar o link pelo WhatsApp" : "Pix")}
      ${row("Telefone", esc(r.telefone))}
      ${row("E-mail", esc(r.email))}
      ${row("Profissão", esc([r.profissao, r.registro].filter(Boolean).join(" · ") || "—"))}
      ${r.obs ? row("Observação", esc(r.obs)) : ""}
      ${row("Código", esc(r.codigo))}
    </table>
    <p style="margin:24px 0 8px">
      <a href="${SITE}admin.html" style="display:inline-block;background:#b35a4d;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold;font-size:14px">${uso ? "Ver na agenda" : "Abrir o painel para confirmar"}</a>
      ${tel ? `&nbsp;<a href="https://wa.me/${tel}" style="display:inline-block;color:#a24f43;text-decoration:none;padding:12px 10px;font-weight:bold;font-size:14px">WhatsApp do cliente →</a>` : ""}
    </p>
    <p style="font-size:12px;color:#8a7f79;margin:16px 0 0">${uso ? "O horário saiu do saldo do banco de horas do cliente e já está confirmado na agenda. Não precisa fazer nada." : compra ? "Depois de confirmada, as horas entram no banco de horas do cliente, que marca os horários em Minha conta." : "O horário fica separado no site até a clínica confirmar ou recusar."}</p>
  </td></tr></table></div>`;

  try {
    const tr = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
    await tr.sendMail({
      from: `"Salas Morada do Ser" <${user}>`, to, replyTo: r.email || undefined,
      subject: uso ? `Horário marcado pelo banco de horas: ${r.nome} · ${sala} · ${slots[0] || ""}`
        : compra ? `Nova compra de horas: ${r.nome} · ${dur(r.horas_compradas)} para ${mesNome(r.mes_referencia)}`
        : `Nova pré-reserva: ${r.nome} · ${sala} · ${slots[0] || ""}`,
      text: `${eyebrow}\n${r.nome} · ${sala}\n${PLANO[r.plano] || r.plano}\n${compra ? bancoTxt : slots.join("\n")}\n${uso ? saldoTxt + "\n" : ""}Valor: ${money(r.total)}${Number(r.desconto_pct || 0) > 0 ? ` (−${Number(r.desconto_pct)}% desconto)` : ""}\nPagamento: ${r.forma_escolhida === "link" ? "cartão de crédito (enviar link)" : "Pix"}\nTelefone: ${r.telefone}\nE-mail: ${r.email}\nCódigo: ${r.codigo}\n\nPainel: ${SITE}admin.html`,
      html,
    });
  } catch (e) {
    await sb.from("reservations").update({ avisado_em: null }).eq("id", id);
    console.error("Falha ao enviar e-mail", e);
    return json({ error: "Falha ao enviar o e-mail", detail: String((e as Error)?.message || e) }, 502);
  }
  return json({ ok: true, to });
});
