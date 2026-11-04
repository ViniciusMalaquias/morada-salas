# Salas Morada do Ser

Site separado para a locação das salas da Clínica Morada do Ser, com painel para a equipe editar sem precisar de programador.

- `index.html`: página pública (salas, planos e preços, localização).
- `sala.html?id=...`: página de cada sala, com fotos e o fluxo de reserva (plano → horários livres → dados → pré-reserva).
- `conta.html`: área do cliente (entrar, criar conta, minhas reservas, banco de horas, pagamento por Pix, cancelar, meus dados) e consulta de reserva de visitante por código + WhatsApp.
- `admin.html`: painel da equipe (link "Área da equipe" no rodapé), com menu lateral no computador e barra inferior no celular:
  - **Início**: aguardando confirmação, a receber, recebido no mês, atendimentos de hoje, ocupação da semana, mensalidades em aberto, o que precisa de atenção e gráfico de recebimentos.
  - **Agenda**: dia (todas as salas lado a lado) ou semana; clicar num horário vazio cria reserva ou bloqueio, clicar numa reserva abre os detalhes.
  - **Clientes**: histórico, contato, total pago e banco de horas de cada cliente.
  - **Financeiro**: pagamentos do mês, mensalidades dos planos fixos (paga / em aberto / atrasada, com cobrança pelo WhatsApp) e planilha para baixar.
  - **Reservas**: enviar cobrança pelo WhatsApp, registrar pagamento (confirma a reserva), recusar, cancelar, bloquear horários da clínica e ver a agenda da semana por sala.
  - **Salas**: adicionar, ocultar, reordenar e excluir salas, enviar e reordenar fotos.
  - **Textos, preços e horários**: todos os textos, os preços dos planos, pagamento (chave Pix, prazo), horário de funcionamento, períodos e contatos.
  - **Equipe**: quem acessa o painel.
- Os dados ficam no Supabase (banco + armazenamento de fotos). O site é só HTML/CSS/JS estático, sem build.

## Como colocar no ar

1. **Supabase**: crie um projeto em supabase.com (plano grátis atende).
   - Abra **SQL Editor**, cole todo o `supabase/schema.sql` e rode; depois faça o mesmo com `supabase/002_reservas.sql` `supabase/003_contas.sql`, `supabase/004_financeiro.sql`, `supabase/005_seguranca.sql`, `supabase/006_novos_planos.sql`, `supabase/007_aviso_reserva.sql`, `supabase/008_forma_pagamento.sql`, `supabase/009_emails_cliente.sql`, `supabase/010_meia_hora.sql`, `supabase/011_descontos.sql`, `supabase/012_banco_horas.sql` e `supabase/013_meia_hora_avulsa.sql`, nessa ordem. Isso cria as tabelas, as regras de segurança e o bucket público `fotos`.
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

- Antes de cada commit, rode `python tools/versao.py`: ele carimba uma versão nos links de CSS e JS das páginas, para o navegador de quem já visitou o site baixar os arquivos novos.

- Fotos são redimensionadas no navegador (máx. 1600 px, WebP) antes do envio, então foto de celular sobe rápido.
- A primeira foto de cada sala é a capa. Se a "Foto do topo" ficar vazia, o site usa a capa da primeira sala.
- No título principal, uma palavra entre `*asteriscos*` aparece em itálico rosé.
- Salas novas nascem ocultas; só aparecem no site depois de marcar "Mostrar esta sala no site" e salvar.

## Reservas

- A grade de horários é de **30 em 30 minutos**, mas **meia hora só existe na hora avulsa**:
  - **Hora avulsa**: dá para marcar meias horas (ex.: 14h30 às 15h ou às 16h30). A meia hora tem **preço próprio** (`preco_meia_hora`, "Meia hora avulsa" no painel; pode ser mais que metade da hora; sem valor salvo, vale metade da hora). O valor é calculado **por faixa contínua**: horas cheias × valor da hora + a meia hora que sobrar × valor da meia hora. Ex.: 10h–11h30 = 1 hora + 1 meia hora; 10h–10h30 e 11h–11h30 = 2 meias horas. O desconto progressivo vale sobre o total.
  - **Horas antecipadas** (marcar na hora ou pelo banco de horas): cada toque no calendário marca **1 hora inteira** (o quadrinho tocado e o seguinte; se o seguinte não estiver livre, o anterior), que pode começar em :30 (ex.: 14h30–15h30). Tocar de novo tira a hora inteira. Compra do banco, uso do banco e ajuste de saldo só em horas inteiras.
  - **Período** e reservas criadas pela equipe fora da hora avulsa: só durações inteiras. Tudo isso também é validado no banco.
- Planos: **hora avulsa** (R$ 38/h ou R$ 19 a meia hora, paga no dia), **horas antecipadas** (R$ 28/h, mínimo de 4h no mesmo mês, acerto até o dia 05; horas não usadas não acumulam) e **período de 4h** (R$ 90; manhã 8–12, tarde 13–17, noite 17–21). Valores editáveis no painel.
- **Banco de horas** (plano Horas antecipadas): além de escolher os horários na hora, a pessoa pode **comprar horas para usar depois**. Escolhe o mês (o atual ou o próximo) e a quantidade (mínimo do plano, só horas inteiras); precisa ter conta (entrar ou criar no passo 3). Vira uma pré-reserva sem horários (`horas_compradas`, `mes_referencia`), com preço = horas × valor da hora antecipada e o desconto progressivo do plano (cada hora conta como um horário). A clínica confirma no painel como qualquer pré-reserva; pagamento até o dia 05 (comprando depois do dia 05, no dia da compra).
  - **Saldo do mês** = horas das compras **confirmadas** do mês + ajustes da clínica − horas já marcadas no mês (função `saldo_horas`). Vale só dentro do mês de referência, em qualquer sala; não acumula.
  - **Usar**: em Minha conta, o card **Banco de horas** mostra saldo, horas compradas e usadas, e o botão **Marcar horário** (sala → dia do mês → horários livres; cada toque marca 1 hora inteira, podendo começar em :30). O horário já nasce **confirmado** e com valor zero (`usa_banco_de` aponta para a compra); o banco (`usar_banco_horas`) valida conta, saldo, mês, horário de funcionamento e conflito. Cancelar com mais de 24h devolve as horas ao saldo. A compra confirmada só é cancelada pela clínica.
  - **Painel**: na reserva de compra e no cliente aparecem o saldo do mês, os horários marcados e os ajustes; **Ajustar saldo** soma ou tira horas inteiras com motivo (tabela `ajustes_banco_horas`, só a equipe; o saldo não fica negativo). Na agenda, os horários do banco aparecem como confirmados com o selo "Banco de horas".
- **Desconto progressivo** (opcional, por plano): um percentual sobre o total da reserva a partir de certa quantidade de horários (no período, de períodos) na mesma pré-reserva — ex.: "a partir de 3 horários, 5%; a partir de 6, 10%". Ativado e configurado em **Textos, preços e horários → Planos e preços**; por padrão vem ligado só para o período de 4h. O cálculo é feito no banco junto com o preço, e o valor aplicado fica salvo na reserva (visível no painel, no resumo do site e nos e-mails).
- O site só mostra horários livres. A pré-reserva fica **aguardando confirmação** e já segura o horário até a clínica confirmar ou recusar no painel (com mensagem pronta para o WhatsApp).
- Tudo é validado no banco (função `request_reservation`): horário de funcionamento, períodos, antecedência máxima de 3 meses, conflito de horário (com trava por sala, então duas pessoas não pegam o mesmo horário) e o **preço**, calculado com os valores do painel. O valor enviado pelo navegador é ignorado.
- Limites contra abuso: no máximo 3 pré-reservas aguardando confirmação por CPF/telefone/conta e 20 pré-reservas por hora no site todo.
- Visitantes nunca leem dados de outras reservas: só veem quais horas estão ocupadas (função `occupied_slots`).

## Aviso de nova pré-reserva

- Cada pré-reserva feita pelo site (inclusive compra de banco de horas) e cada horário marcado pelo banco de horas ("Horário marcado pelo banco de horas", já confirmado) dispara um e-mail para a clínica (Edge Function `supabase/functions/avisar-reserva`, chamada pelo banco).
- Em **Edge Functions → Secrets** no Supabase, cadastre `GMAIL_USER` (o Gmail que envia) e `GMAIL_APP_PASSWORD` (senha de app desse Gmail).
- O destino é o campo "E-mail que recebe o aviso" em **Textos, preços e horários → Contato** (ou o e-mail de contato, se vazio).

## E-mails para o cliente

- Função `supabase/functions/email-cliente`: **pré-reserva recebida** (logo após reservar pelo site), **reserva confirmada** (com Pix copia e cola ou link do cartão; no banco de horas, a compra confirmada e cada horário marcado, com o saldo restante) e **lembrete** na véspera (agendamento de hora em hora no banco, para quem foi confirmado com mais de 24h de antecedência).
- Usa os mesmos segredos do Gmail. Cada e-mail sai uma vez só.

## E-mails de cadastro e senha

- Os e-mails do login (confirmar cadastro, redefinir senha, trocar e-mail) saem pela Edge Function `supabase/functions/auth-email`, ligada como **Send Email Hook** em **Authentication → Auth Hooks** (tipo HTTPS, URL `https://<projeto>.supabase.co/functions/v1/auth-email`).
- Segredos: `GMAIL_USER`, `GMAIL_APP_PASSWORD` e `SEND_EMAIL_HOOK_SECRET` (gerado pelo Supabase ao criar o hook). Com o hook ligado, os modelos e o SMTP do painel do Supabase deixam de ser usados.

## Contas e pagamento

- Para reservar, a pessoa escolhe: **continuar como visitante**, **entrar** ou **criar conta** (a conta é criada junto com a reserva).
- Não há cobrança online. Confirmar a reserva não depende de pagamento: depois de confirmada, ela aparece em **A receber** (Financeiro) até a clínica registrar o pagamento — no dia do atendimento (avulsa e período) ou até o dia 05 (horas antecipadas). Pagamentos atrasados aparecem no Início.
- O cliente com conta vê tudo em **Minha conta**; o visitante consulta com código + WhatsApp, e pode vincular a reserva depois que criar conta. Reservas feitas com o mesmo e-mail são vinculadas automaticamente quando o e-mail é confirmado (só pelo e-mail confirmado; CPF não vincula sozinho).
- O CPF da conta não pode ser trocado pelo cliente depois de preenchido (só pela clínica, no banco).
- Cancelamento pelo cliente: sempre enquanto aguarda confirmação; depois de confirmada, só com mais de 24h para o horário.
- Na pré-reserva o cliente escolhe **Pix** ou **cartão de crédito (link de pagamento)**. No link, a clínica cola o link na reserva (painel → reserva → Forma de pagamento) e envia pelo WhatsApp com a mensagem pronta; o cliente também vê o botão "Pagar com cartão" em Minha conta.
- Pix: com a chave cadastrada, o cliente vê um QR Code Pix com o valor e o código da reserva já preenchidos, além do copia e cola.
- Recibo para imprimir ou salvar em PDF em cada pagamento confirmado (área do cliente).
- Só quem está na tabela `staff` acessa o painel. Clientes logados não conseguem ver dados de outras pessoas.
