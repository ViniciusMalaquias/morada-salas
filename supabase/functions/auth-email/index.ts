// "Send Email Hook" do Supabase Auth: envia os e-mails de cadastro, senha e troca de e-mail
// em português, com a cara da clínica, pelo Gmail (no lugar dos modelos do painel do Supabase).
// Segredos (Edge Functions → Secrets): GMAIL_USER, GMAIL_APP_PASSWORD e SEND_EMAIL_HOOK_SECRET
// (este último é gerado pelo Supabase ao criar o hook em Authentication → Auth Hooks).
import { Webhook } from "npm:standardwebhooks@1.0.0";
import nodemailer from "npm:nodemailer@6.9.16";

const SITE = "https://viniciusmalaquias.github.io/morada-salas/";
const LOGO = SITE + "img/logo-email.png";

type Tpl = { assunto: string; pre: string; titulo: string; corpo: string; botao: string; nota: string };
const TPL: Record<string, Tpl> = {
  signup: { assunto: "Confirme seu cadastro · Morada do Ser", pre: "Confirme seu e-mail para ativar sua conta.", titulo: "Confirme seu cadastro",
    corpo: "Olá! Que bom ter você com a gente.<br><br>Para ativar sua conta e acompanhar suas reservas, pagamentos e recibos, confirme seu e-mail clicando no botão abaixo.",
    botao: "Confirmar meu e-mail", nota: "Se você não criou uma conta na Morada do Ser, pode ignorar este e-mail com segurança." },
  recovery: { assunto: "Redefinir sua senha · Morada do Ser", pre: "Pedido para criar uma nova senha.", titulo: "Redefinir sua senha",
    corpo: "Recebemos um pedido para trocar a senha da sua conta. Clique no botão abaixo para criar uma nova senha.",
    botao: "Criar nova senha", nota: "Se não foi você que pediu, ignore este e-mail. Sua senha atual continua valendo." },
  email_change: { assunto: "Confirme seu novo e-mail · Morada do Ser", pre: "Confirme a troca do e-mail da sua conta.", titulo: "Confirme a troca de e-mail",
    corpo: "Recebemos um pedido para trocar o e-mail da sua conta. Clique no botão abaixo para confirmar.",
    botao: "Confirmar troca de e-mail", nota: "Se não foi você que pediu, fale com a clínica pelo WhatsApp." },
  magiclink: { assunto: "Seu link de acesso · Morada do Ser", pre: "Entre na sua conta com um clique.", titulo: "Entrar na sua conta",
    corpo: "Clique no botão abaixo para entrar na sua conta da Morada do Ser.", botao: "Entrar", nota: "Se não foi você que pediu, pode ignorar este e-mail." },
  invite: { assunto: "Você foi convidado · Morada do Ser", pre: "Crie sua conta na Morada do Ser.", titulo: "Você foi convidado",
    corpo: "A Clínica Morada do Ser convidou você para criar uma conta. Clique no botão abaixo para aceitar.", botao: "Aceitar convite", nota: "Se você não esperava este convite, pode ignorar este e-mail." },
};

function html(t: Tpl, link: string, codigo?: string) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.titulo}</title></head>
<body style="margin:0;padding:0;background:#f3efeb;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${t.pre}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3efeb;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e9e2dc;">
<tr><td align="center" style="background:#f9f7f5;padding:28px 24px 20px;border-bottom:3px solid #ce8b7e;"><a href="${SITE}"><img src="${LOGO}" width="120" alt="Clínica Morada do Ser" style="display:block;border:0;width:120px;height:auto;"></a></td></tr>
<tr><td style="padding:36px 40px 8px;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.25;color:#38312e;">${t.titulo}</td></tr>
<tr><td style="padding:12px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#5b514c;">${t.corpo}</td></tr>
<tr><td style="padding:28px 40px 8px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:999px;background:#b35a4d;">
<a href="${link}" style="display:inline-block;padding:14px 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:999px;">${t.botao}</a></td></tr></table></td></tr>
${codigo ? `<tr><td style="padding:12px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#5b514c;">Ou use o código: <b style="letter-spacing:.12em">${codigo}</b></td></tr>` : ""}
<tr><td style="padding:16px 40px 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a7f79;">Se o botão não funcionar, copie e cole este endereço no navegador:<br><a href="${link}" style="color:#b35a4d;word-break:break-all;">${link}</a></td></tr>
<tr><td style="padding:24px 40px 32px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:#8a7f79;">${t.nota}</td></tr>
<tr><td style="background:#38312e;padding:22px 40px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.7;color:#d9cfc8;"><strong style="color:#ffffff;">Clínica Morada do Ser</strong> · Salas para atendimento<br>Rua Adolfo Torricelli, 284 · Vianelo, Jundiaí · SP<br>WhatsApp <a href="https://wa.me/5511953063868" style="color:#e8b8ad;text-decoration:none;">(11) 95306-3868</a> · <a href="${SITE}" style="color:#e8b8ad;text-decoration:none;">Ver salas e horários</a></td></tr>
</table><p style="font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#a69a93;margin:16px 0 0;">E-mail automático. Para falar com a clínica, use o WhatsApp.</p>
</td></tr></table></body></html>`;
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { error: { http_code: 405, message: "use POST" } });
  const payload = await req.text();
  const secret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "").replace(/^v1,whsec_/, "");
  if (!secret) { console.error("Falta o segredo SEND_EMAIL_HOOK_SECRET"); return reply(500, { error: { http_code: 500, message: "Falta o segredo SEND_EMAIL_HOOK_SECRET" } }); }

  let data: any;
  try { data = new Webhook(secret).verify(payload, Object.fromEntries(req.headers)); }
  catch (err) { console.error("Assinatura inválida", String(err)); return reply(401, { error: { http_code: 401, message: "Assinatura inválida" } }); }

  const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) { console.error("Faltam os segredos GMAIL_USER/GMAIL_APP_PASSWORD", { user: !!user, pass: !!pass }); return reply(500, { error: { http_code: 500, message: "Faltam os segredos GMAIL_USER e GMAIL_APP_PASSWORD" } }); }

  const to: string = data.user?.email;
  const e = data.email_data || {};
  const tipo: string = e.email_action_type;
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const volta = e.redirect_to || e.site_url || SITE;
  const link = (hash: string, type: string) => `${base}/auth/v1/verify?token=${encodeURIComponent(hash)}&type=${encodeURIComponent(type)}&redirect_to=${encodeURIComponent(volta)}`;

  // Monta a lista de envios (a troca de e-mail com confirmação dupla manda um para cada endereço)
  const envios: { to: string; t: Tpl; link: string; codigo?: string }[] = [];
  if (tipo === "email_change") {
    const novo = data.user?.new_email;
    if (e.token_hash_new && novo) envios.push({ to: novo, t: TPL.email_change, link: link(e.token_hash_new, "email_change") });
    if (e.token_hash) envios.push({ to, t: TPL.email_change, link: link(e.token_hash, "email_change") });
  } else if (tipo === "reauthentication") {
    envios.push({ to, t: { ...TPL.magiclink, assunto: "Seu código de confirmação · Morada do Ser", titulo: "Código de confirmação", corpo: "Use o código abaixo para confirmar a operação na sua conta.", botao: "Abrir o site" }, link: SITE + "conta.html", codigo: e.token });
  } else {
    const t = TPL[tipo] || { ...TPL.magiclink, assunto: "Mensagem da sua conta · Morada do Ser", titulo: "Confirme pelo link", corpo: "Clique no botão abaixo para continuar.", botao: "Continuar" };
    envios.push({ to, t, link: link(e.token_hash, tipo), codigo: tipo === "magiclink" ? e.token : undefined });
  }

  try {
    const tr = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass } });
    for (const m of envios) {
      await tr.sendMail({
        from: `"Clínica Morada do Ser" <${user}>`, to: m.to, subject: m.t.assunto,
        text: `${m.t.titulo}\n\n${m.t.corpo.replace(/<br>/g, "\n")}\n\n${m.t.botao}: ${m.link}${m.codigo ? `\nCódigo: ${m.codigo}` : ""}\n\n${m.t.nota}\n\nClínica Morada do Ser · WhatsApp (11) 95306-3868`,
        html: html(m.t, m.link, m.codigo),
      });
    }
  } catch (err) {
    console.error("Falha ao enviar", String((err as Error)?.message || err));
    return reply(500, { error: { http_code: 500, message: "Falha ao enviar o e-mail" } });
  }
  return reply(200, {});
});
