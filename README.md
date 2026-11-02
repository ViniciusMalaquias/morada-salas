# Salas Morada do Ser

Site separado para a locação das salas da Clínica Morada do Ser, com painel para a equipe editar sem precisar de programador.

- `index.html`: página pública (salas, planos e preços, localização).
- `sala.html?id=...`: página de cada sala, com fotos e o fluxo de reserva (plano → horários livres → dados → pré-reserva).
- `conta.html`: área do cliente (entrar, criar conta, minhas reservas, pagamento por Pix, cancelar, meus dados) e consulta de reserva de visitante por código + WhatsApp.
- `admin.html`: painel da equipe (link "Área da equipe" no rodapé).
  - **Reservas**: enviar cobrança pelo WhatsApp, registrar pagamento (confirma a reserva), recusar, cancelar, bloquear horários da clínica e ver a agenda da semana por sala.
  - **Salas**: adicionar, ocultar, reordenar e excluir salas, enviar e reordenar fotos.
  - **Textos, preços e horários**: todos os textos, os preços dos planos, pagamento (chave Pix, prazo), horário de funcionamento, períodos e contatos.
  - **Equipe**: quem acessa o painel.
- Os dados ficam no Supabase (banco + armazenamento de fotos). O site é só HTML/CSS/JS estático, sem build.

## Como colocar no ar

1. **Supabase**: crie um projeto em supabase.com (plano grátis atende).
   - Abra **SQL Editor**, cole todo o `supabase/schema.sql` e rode; depois faça o mesmo com `supabase/002_reservas.sql` e `supabase/003_contas.sql`, nessa ordem. Isso cria as tabelas, as regras de segurança e o bucket público `fotos`.
   - Deixe **Allow new users to sign up** e **Confirm email** ligados (clientes criam conta pelo site).
   - Configure um **SMTP próprio** em **Authentication → Emails → SMTP Settings** (ex.: Resend ou o Gmail da clínica com senha de app). O e-mail padrão do Supabase só envia para membros do projeto, então sem isso clientes não recebem a confirmação de cadastro nem o "esqueci minha senha".
   - Equipe: a primeira pessoa entra na tabela `staff` pelo SQL Editor:
     `insert into public.staff (user_id, email) select id, email from auth.users where email = 'email@da.pessoa';`
     As próximas são liberadas pela aba **Equipe** do painel.
   - Em **Authentication → URL Configuration**, coloque o endereço do site em **Site URL** e adicione `https://SEU-DOMINIO/admin.html` e `https://SEU-DOMINIO/conta.html` em **Redirect URLs** (para o "Esqueci minha senha").
2. **Config**: em **Project Settings → API**, copie a *Project URL* e a *anon public key* para `js/config.js`.
3. **Hospedagem**: suba a pasta inteira em qualquer hospedagem estática (Vercel, Netlify, Cloudflare Pages ou GitHub Pages). Dá para apontar um subdomínio, ex.: `salas.moradadoser.com.br`.

Sem o `config.js` preenchido o site abre em modo demonstração, com textos padrão e duas salas de exemplo.

## Observações

- Fotos são redimensionadas no navegador (máx. 1600 px, WebP) antes do envio, então foto de celular sobe rápido.
- A primeira foto de cada sala é a capa. Se a "Foto do topo" ficar vazia, o site usa a capa da primeira sala.
- No título principal, uma palavra entre `*asteriscos*` aparece em itálico rosé.
- Salas novas nascem ocultas; só aparecem no site depois de marcar "Mostrar esta sala no site" e salvar.

## Reservas

- Planos: hora avulsa, pacote de horas, período (manhã/tarde/noite), fixo semanal (com desconto por faixa de horas) e fixo quinzenal. Valores editáveis no painel.
- O site só mostra horários livres. A pré-reserva fica **pendente** e já segura o horário; a clínica confirma ou recusa no painel e avisa pelo WhatsApp com a mensagem pronta.
- A checagem de conflito acontece no banco (função `create_reservation`), então duas pessoas não conseguem pegar o mesmo horário.
- Visitantes nunca leem dados de outras reservas: só veem quais horas estão ocupadas (função `occupied_slots`).

## Contas e pagamento

- Para reservar, a pessoa escolhe: **continuar como visitante**, **entrar** ou **criar conta** (a conta é criada junto com a reserva).
- Não há cobrança online. A pré-reserva fica **aguardando pagamento** e o horário aparece ocupado por um prazo (padrão 24h, editável). Se não for paga no prazo, o horário volta a ficar livre sozinho.
- A clínica manda a cobrança pelo WhatsApp (mensagem pronta com Pix e prazo), recebe por Pix, link ou na clínica, e clica em **Pagamento recebido**: a reserva vira **confirmada** com forma, valor e data do pagamento registrados.
- O cliente com conta vê tudo em **Minha conta**; o visitante consulta com código + WhatsApp, e pode vincular a reserva depois que criar conta. Reservas feitas com o mesmo e-mail são vinculadas automaticamente quando o e-mail é confirmado.
- Cancelamento pelo cliente: sempre enquanto aguarda pagamento; depois de confirmada, só com mais de 24h para o horário.
- Só quem está na tabela `staff` acessa o painel. Clientes logados não conseguem ver dados de outras pessoas.
