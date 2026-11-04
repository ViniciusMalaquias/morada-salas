-- Morada do Ser · Banco de horas do plano Horas antecipadas (rode depois do 011)
--  · "Comprar horas para usar depois": reserva plano 'pacote' SEM horários, com horas_compradas e mes_referencia
--    (dia 1 do mês atual ou do próximo). Preço = horas × preco_antecipada, com o desconto progressivo do plano
--    (cada hora inteira conta como um horário). Fica pendente até a clínica confirmar; pagamento até o dia 05.
--  · Saldo do mês = horas das compras CONFIRMADAS do mês + ajustes da equipe − horas já marcadas no mês.
--    Vale só dentro do mês de referência; não acumula.
--  · Usar o saldo (Minha conta → Banco de horas → Marcar horário): reserva plano 'pacote' com usa_banco_de
--    (a compra), total 0, já confirmada. Cancelar (com mais de 24h) devolve as horas ao saldo.

-- ========== Colunas e tabela de ajustes ==========
alter table public.reservations
  add column if not exists horas_compradas numeric(5,1)
    check (horas_compradas is null or (horas_compradas > 0 and horas_compradas * 2 = trunc(horas_compradas * 2))),
  add column if not exists mes_referencia date
    check (mes_referencia is null or extract(day from mes_referencia) = 1),
  add column if not exists usa_banco_de uuid references public.reservations(id) on delete set null;
create index if not exists reservations_banco_compra_idx on public.reservations(user_id, mes_referencia) where horas_compradas is not null;
create index if not exists reservations_banco_uso_idx on public.reservations(usa_banco_de) where usa_banco_de is not null;

create table if not exists public.ajustes_banco_horas (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  mes        date not null check (extract(day from mes) = 1),
  horas      numeric(5,1) not null check (horas <> 0 and horas * 2 = trunc(horas * 2)),
  motivo     text not null check (length(trim(motivo)) > 0),
  compra_id  uuid references public.reservations(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ajustes_banco_user_idx on public.ajustes_banco_horas(user_id, mes);
alter table public.ajustes_banco_horas enable row level security;
drop policy if exists "equipe vê ajustes" on public.ajustes_banco_horas;
create policy "equipe vê ajustes" on public.ajustes_banco_horas for select to authenticated using (public.is_staff());
-- inclusão só pela função ajustar_banco_horas (equipe)

-- ========== Saldo ==========
-- 6.5 -> '6h30', 0.5 -> '0h30', 10 -> '10h'
create or replace function public.fmt_horas(p numeric) returns text
language sql immutable set search_path = public as $$
  select case when p < 0 then '−' else '' end || trunc(abs(p))::int || 'h' || case when abs(p) % 1 <> 0 then '30' else '' end
$$;

create or replace function public.banco_horas_resumo(p_user uuid, p_mes date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_comp numeric; v_pend numeric; v_aj numeric; v_uso numeric;
begin
  if p_user is null or v_mes is null then return null; end if;
  if p_user is distinct from auth.uid() and not public.is_staff()
     and coalesce(auth.role(), '') <> 'service_role'
     and nullif(current_setting('request.jwt.claims', true), '') is not null then   -- sem JWT = SQL editor/agendamento
    raise exception 'Sem permissão.';
  end if;
  select coalesce(sum(horas_compradas) filter (where status = 'confirmada'), 0),
         coalesce(sum(horas_compradas) filter (where status = 'pendente'), 0)
    into v_comp, v_pend
  from public.reservations
  where user_id = p_user and plano = 'pacote' and horas_compradas is not null and mes_referencia = v_mes;
  select coalesce(sum(horas), 0) into v_aj from public.ajustes_banco_horas where user_id = p_user and mes = v_mes;
  select coalesce(sum(s.hora_fim - s.hora_ini), 0) into v_uso
  from public.reservations u join public.reservation_slots s on s.reservation_id = u.id
  where u.user_id = p_user and u.usa_banco_de is not null and u.status in ('pendente','confirmada')
    and date_trunc('month', s.data)::date = v_mes;
  return jsonb_build_object('mes', v_mes, 'compradas', v_comp, 'pendentes', v_pend, 'ajustes', v_aj,
                            'usadas', v_uso, 'saldo', v_comp + v_aj - v_uso);
end $$;

create or replace function public.saldo_horas(p_user uuid, p_mes date) returns numeric
language sql stable security definer set search_path = public as $$
  select (public.banco_horas_resumo(p_user, p_mes)->>'saldo')::numeric
$$;

-- ========== Pré-reserva: modo "banco" (comprar horas para usar depois) ==========
-- Mesma request_reservation do 011_descontos.sql, com {modo:'banco', mes, horas}
create or replace function public.request_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rid uuid; cod text; s jsonb; n int := 0; hrs numeric := 0; v_total numeric; v_desc numeric; v_mes date;
  v_room  uuid := (p->>'room_id')::uuid;
  v_uid   uuid := auth.uid();
  v_plano text := coalesce(p->>'plano', '');
  v_modo  text := coalesce(nullif(p->>'modo', ''), 'horarios');
  v_now   timestamp := now() at time zone 'America/Sao_Paulo';
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_max   date := (now() at time zone 'America/Sao_Paulo')::date + 92;   -- até ~13 semanas à frente
  v_cpf   text := regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g');
  v_tel   text := regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g');
  v_d date; v_ini numeric; v_fim numeric; v_freq text; v_email text; v_pcpf text; v_h int[];
  v_forma text := coalesce(nullif(p->>'forma', ''), 'pix');
  v_bh numeric;
begin
  if not exists (select 1 from public.rooms where id = v_room and active) then
    raise exception 'Esta sala não está disponível para reserva.';
  end if;
  if array_length(regexp_split_to_array(trim(coalesce(p->>'nome', '')), '\s+'), 1) < 2 then
    raise exception 'Informe seu nome completo.';
  end if;
  if length(v_tel) not between 10 and 13 then
    raise exception 'Informe um telefone de contato com DDD.';
  end if;
  if v_plano not in ('avulso','pacote','periodo') then
    raise exception 'Plano inválido.';
  end if;
  if v_modo not in ('horarios','banco') then
    raise exception 'Escolha como quer usar as horas.';
  end if;
  if v_forma not in ('pix','link') then
    raise exception 'Escolha como vai pagar: Pix ou link de pagamento.';
  end if;
  if coalesce(p->>'aceite', '') <> 'true' then
    raise exception 'Para reservar, é preciso aceitar as regras de uso.';
  end if;

  -- Banco de horas: só com conta, plano Horas antecipadas, mês atual ou próximo, mínimo do plano
  if v_modo = 'banco' then
    if v_uid is null then
      raise exception 'Para comprar horas e marcar depois, entre na sua conta (ou crie uma) no passo 3.';
    end if;
    if v_plano <> 'pacote' then raise exception 'O banco de horas é do plano Horas antecipadas.'; end if;
    begin
      v_mes := date_trunc('month', (p->>'mes')::date)::date; v_bh := (p->>'horas')::numeric;
    exception when others then raise exception 'Escolha o mês e a quantidade de horas.';
    end;
    if v_mes is null or v_mes not in (date_trunc('month', v_today)::date, (date_trunc('month', v_today) + interval '1 month')::date) then
      raise exception 'As horas podem ser compradas para o mês atual ou para o próximo.';
    end if;
    if v_bh is null or v_bh * 2 <> trunc(v_bh * 2) then raise exception 'A quantidade de horas vai de meia em meia hora.'; end if;
    if v_bh < public.conf_num('antecipadas_min', 4) then
      raise exception 'As horas antecipadas são de no mínimo % horas no mês.', public.conf_num('antecipadas_min', 4);
    end if;
    if v_bh > 300 then raise exception 'Quantidade de horas muito alta. Fale com a clínica pelo WhatsApp.'; end if;
    if jsonb_array_length(coalesce(p->'slots', '[]'::jsonb)) > 0 then
      raise exception 'Na compra de horas para usar depois, os horários são marcados depois, em Minha conta.';
    end if;
  end if;

  v_email := left(coalesce(p->>'email', ''), 120);
  if v_uid is not null then
    select u.email, coalesce(pr.cpf, '') into v_email, v_pcpf
    from auth.users u left join public.profiles pr on pr.id = u.id where u.id = v_uid;
    if v_pcpf <> '' then v_cpf := v_pcpf; end if;   -- cliente logado usa sempre o CPF da conta
  end if;
  if not public.cpf_valido(v_cpf) then
    raise exception 'CPF inválido. Confira os números.';
  end if;
  if coalesce(v_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Informe um e-mail válido.';
  end if;

  -- Limites contra abuso
  if (select count(*) from public.reservations r
      where r.status = 'pendente' and r.plano <> 'bloqueio'
        and r.created_at > now() - interval '30 days'
        and (r.cpf = v_cpf
             or right(regexp_replace(r.telefone, '\D', '', 'g'), 8) = right(v_tel, 8)
             or (v_uid is not null and r.user_id = v_uid))) >= 3 then
    raise exception 'Você já tem 3 pré-reservas aguardando a confirmação da clínica. Aguarde a confirmação ou cancele uma delas antes de fazer outra, ou fale com a clínica pelo WhatsApp.';
  end if;
  if (select count(*) from public.reservations r
      where r.aceite_em is not null and r.created_at > now() - interval '1 hour') >= 20 then
    raise exception 'Recebemos muitas reservas agora. Tente de novo daqui a pouco ou fale com a clínica pelo WhatsApp.';
  end if;

  -- Uma reserva por vez em cada sala (evita duas pessoas pegarem o mesmo horário juntas)
  perform pg_advisory_xact_lock(hashtext('sala:' || v_room::text));

  insert into public.reservations (room_id, user_id, plano, nome, telefone, email, cpf, profissao, registro, obs, total, resumo, aceite_em, forma_escolhida,
                                   horas_compradas, mes_referencia)
  values (v_room, v_uid, v_plano, left(trim(p->>'nome'), 120), left(p->>'telefone', 30), coalesce(v_email, ''), v_cpf,
          left(coalesce(p->>'profissao', ''), 80), left(coalesce(p->>'registro', ''), 40), left(coalesce(p->>'obs', ''), 1000),
          null, left(coalesce(p->>'resumo', ''), 3000), now(), v_forma,
          case when v_modo = 'banco' then v_bh end, case when v_modo = 'banco' then v_mes end)
  returning id, codigo into rid, cod;

  if v_modo = 'banco' then
    -- preço: horas × valor da hora antecipada; cada hora inteira conta como um horário no desconto progressivo
    v_total := v_bh * public.conf_num('preco_antecipada', 28);
    v_desc := public.desconto_pct('pacote', floor(v_bh)::int);
  else
    for s in select * from jsonb_array_elements(coalesce(p->'slots', '[]'::jsonb)) loop
      n := n + 1;
      if n > 60 then raise exception 'Horários demais numa reserva só.'; end if;
      begin
        v_d := (s->>'data')::date; v_ini := (s->>'hora_ini')::numeric; v_fim := (s->>'hora_fim')::numeric; v_freq := s->>'freq';
      exception when others then raise exception 'Horário inválido.';
      end;
      if v_d is null or v_ini is null or v_fim is null or v_fim <= v_ini then raise exception 'Horário inválido.'; end if;
      if v_ini * 2 <> trunc(v_ini * 2) or v_fim * 2 <> trunc(v_fim * 2) then raise exception 'Os horários são de 30 em 30 minutos.'; end if;
      if v_freq is distinct from (case v_plano when 'semanal' then 'semanal' when 'quinzenal' then 'quinzenal' else 'unica' end) then
        raise exception 'Horário inválido para este plano.';
      end if;
      if v_d < v_today or (v_d = v_today and v_ini <= extract(hour from v_now) + extract(minute from v_now) / 60.0) then
        raise exception 'Não dá para reservar um horário que já passou.';
      end if;
      if v_d > v_max then raise exception 'Dá para reservar com até 3 meses de antecedência.'; end if;
      v_h := public.horario_do_dia(v_d);
      if v_h is null or v_ini < v_h[1] or v_fim > v_h[2] then
        raise exception 'Um dos horários está fora do horário de funcionamento da clínica.';
      end if;
      if v_plano = 'periodo' and not public.periodo_valido(v_ini, v_fim) then
        raise exception 'Escolha um dos períodos da clínica.';
      end if;
      if v_plano = 'pacote' then
        if v_mes is null then v_mes := date_trunc('month', v_d)::date;
        elsif date_trunc('month', v_d)::date <> v_mes then
          raise exception 'As horas antecipadas precisam ser todas no mesmo mês.';
        end if;
      end if;
      if public.has_conflict(v_room, v_freq, v_d, v_ini, v_fim, null) then
        raise exception 'Um dos horários escolhidos acabou de ser reservado. Atualize a página e escolha outro.';
      end if;
      insert into public.reservation_slots (reservation_id, room_id, freq, data, hora_ini, hora_fim)
      values (rid, v_room, v_freq, v_d, v_ini, v_fim);
      hrs := hrs + (v_fim - v_ini);
    end loop;

    -- Preço calculado aqui, com os valores do painel
    if n = 0 then raise exception 'Escolha pelo menos um horário.'; end if;
    if v_plano = 'pacote' and hrs < public.conf_num('antecipadas_min', 4) then
      raise exception 'As horas antecipadas são de no mínimo % horas no mês.', public.conf_num('antecipadas_min', 4);
    end if;
    v_total := case v_plano
      when 'avulso'  then hrs * public.conf_num('preco_avulso', 38)
      when 'pacote'  then hrs * public.conf_num('preco_antecipada', 28)
      when 'periodo' then n * public.conf_num('preco_periodo_bloco', 90)
    end;
    -- Desconto progressivo pela quantidade de horários (n), configurado no painel
    v_desc := public.desconto_pct(v_plano, n);
  end if;
  if v_desc > 0 then v_total := v_total * (1 - v_desc / 100); end if;
  v_total := round(v_total, 2);
  update public.reservations set total = v_total, desconto_pct = v_desc where id = rid;

  -- completa o perfil do cliente logado com o que ele digitou
  if v_uid is not null then
    update public.profiles set
      nome = case when nome = '' then left(trim(p->>'nome'), 120) else nome end,
      telefone = case when telefone = '' then left(p->>'telefone', 30) else telefone end,
      profissao = case when profissao = '' then left(coalesce(p->>'profissao', ''), 80) else profissao end,
      registro = case when registro = '' then left(coalesce(p->>'registro', ''), 40) else registro end,
      cpf = case when cpf = '' and not exists (select 1 from public.profiles x where x.cpf = v_cpf) then v_cpf else cpf end,
      updated_at = now()
    where id = v_uid;
  end if;
  return jsonb_build_object('id', rid, 'codigo', cod, 'total', v_total, 'desconto_pct', v_desc,
                            'horas', case when v_modo = 'banco' then v_bh end, 'mes', case when v_modo = 'banco' then v_mes end);
end $$;

-- ========== Marcar horário com o saldo ==========
-- p_slots: [{data:'2026-11-10', hora_ini:14, hora_fim:15.5}, ...] (todos no mesmo mês)
create or replace function public.usar_banco_horas(p_room uuid, p_slots jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); s jsonb; n int := 0; hrs numeric := 0; v_mes date; v_saldo numeric;
  v_now timestamp := now() at time zone 'America/Sao_Paulo';
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_d date; v_ini numeric; v_fim numeric; v_h int[];
  c public.reservations; pr public.profiles; rid uuid; cod text; v_lines text := '';
  v_dow text[] := array['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  fh text;
begin
  if v_uid is null then raise exception 'Entre na sua conta para usar o banco de horas.'; end if;
  if not exists (select 1 from public.rooms where id = p_room and active) then
    raise exception 'Esta sala não está disponível para reserva.';
  end if;
  if jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots) = 0 then
    raise exception 'Escolha pelo menos um horário.';
  end if;
  if jsonb_array_length(p_slots) > 30 then raise exception 'Horários demais de uma vez só.'; end if;
  begin
    v_mes := date_trunc('month', (p_slots->0->>'data')::date)::date;
  exception when others then raise exception 'Horário inválido.';
  end;

  -- um uso por vez por cliente (o saldo não estoura) e uma reserva por vez por sala
  perform pg_advisory_xact_lock(hashtext('banco:' || v_uid::text));
  perform pg_advisory_xact_lock(hashtext('sala:' || p_room::text));

  select * into c from public.reservations
  where user_id = v_uid and plano = 'pacote' and horas_compradas is not null and status = 'confirmada' and mes_referencia = v_mes
  order by created_at limit 1;
  if c.id is null then
    raise exception 'Você não tem horas compradas e confirmadas para %. As horas valem só dentro do mês da compra.',
      to_char(v_mes, 'MM/YYYY');
  end if;
  select * into pr from public.profiles where id = v_uid;

  insert into public.reservations (room_id, user_id, plano, status, nome, telefone, email, cpf, profissao, registro, total, resumo,
                                   decided_at, forma_escolhida, usa_banco_de)
  values (p_room, v_uid, 'pacote', 'confirmada', coalesce(nullif(pr.nome, ''), c.nome), coalesce(nullif(pr.telefone, ''), c.telefone),
          coalesce((select email from auth.users where id = v_uid), c.email), coalesce(nullif(pr.cpf, ''), c.cpf),
          coalesce(nullif(pr.profissao, ''), c.profissao), coalesce(nullif(pr.registro, ''), c.registro),
          0, '', now(), c.forma_escolhida, c.id)
  returning id, codigo into rid, cod;

  for s in select * from jsonb_array_elements(p_slots) loop
    n := n + 1;
    begin
      v_d := (s->>'data')::date; v_ini := (s->>'hora_ini')::numeric; v_fim := (s->>'hora_fim')::numeric;
    exception when others then raise exception 'Horário inválido.';
    end;
    if v_d is null or v_ini is null or v_fim is null or v_fim <= v_ini then raise exception 'Horário inválido.'; end if;
    if v_ini * 2 <> trunc(v_ini * 2) or v_fim * 2 <> trunc(v_fim * 2) then raise exception 'Os horários são de 30 em 30 minutos.'; end if;
    if date_trunc('month', v_d)::date <> v_mes then
      raise exception 'As horas do banco valem só dentro do mês da compra. Marque horários de um mês por vez.';
    end if;
    if v_d < v_today or (v_d = v_today and v_ini <= extract(hour from v_now) + extract(minute from v_now) / 60.0) then
      raise exception 'Não dá para marcar um horário que já passou.';
    end if;
    v_h := public.horario_do_dia(v_d);
    if v_h is null or v_ini < v_h[1] or v_fim > v_h[2] then
      raise exception 'Um dos horários está fora do horário de funcionamento da clínica.';
    end if;
    if public.has_conflict(p_room, 'unica', v_d, v_ini, v_fim, null) then
      raise exception 'Um dos horários escolhidos acabou de ser reservado. Atualize e escolha outro.';
    end if;
    insert into public.reservation_slots (reservation_id, room_id, freq, data, hora_ini, hora_fim)
    values (rid, p_room, 'unica', v_d, v_ini, v_fim);
    hrs := hrs + (v_fim - v_ini);
    fh := v_dow[extract(dow from v_d)::int + 1] || ' ' || to_char(v_d, 'DD/MM') || ': '
          || trim(to_char(trunc(v_ini), '99')) || 'h' || case when v_ini % 1 <> 0 then '30' else '' end || '–'
          || trim(to_char(trunc(v_fim), '99')) || 'h' || case when v_fim % 1 <> 0 then '30' else '' end;
    v_lines := v_lines || E'\n' || fh;
  end loop;

  -- o novo uso já entra na conta: se o saldo ficou negativo, não cabia
  v_saldo := public.saldo_horas(v_uid, v_mes);
  if v_saldo < 0 then
    raise exception 'Seu saldo de % é de % e estes horários somam %. Escolha menos horários.',
      to_char(v_mes, 'MM/YYYY'), public.fmt_horas(v_saldo + hrs), public.fmt_horas(hrs);
  end if;
  update public.reservations set resumo = left('Plano: Horas antecipadas (banco de horas)' || v_lines, 3000) where id = rid;
  return jsonb_build_object('id', rid, 'codigo', cod, 'horas', hrs, 'saldo', v_saldo, 'mes', v_mes);
end $$;

-- ========== Ajuste manual do saldo (equipe) ==========
create or replace function public.ajustar_banco_horas(p_user uuid, p_mes date, p_horas numeric, p_motivo text, p_compra uuid)
returns numeric
language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', p_mes)::date; v_saldo numeric;
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  if p_user is null or not exists (select 1 from auth.users where id = p_user) then
    raise exception 'O banco de horas é de clientes com conta.';
  end if;
  if v_mes is null then raise exception 'Escolha o mês.'; end if;
  if coalesce(p_horas, 0) = 0 or p_horas * 2 <> trunc(p_horas * 2) then
    raise exception 'Informe as horas de meia em meia hora (ex.: 1,5 ou −2).';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escreva o motivo do ajuste.'; end if;
  perform pg_advisory_xact_lock(hashtext('banco:' || p_user::text));
  insert into public.ajustes_banco_horas (user_id, mes, horas, motivo, compra_id, created_by)
  values (p_user, v_mes, p_horas, left(trim(p_motivo), 300), p_compra, auth.uid());
  v_saldo := public.saldo_horas(p_user, v_mes);
  if v_saldo < 0 then raise exception 'O saldo não pode ficar negativo (ficaria em %).', public.fmt_horas(v_saldo); end if;
  return v_saldo;
end $$;

-- ========== Confirmar: compra de horas registra o mês de referência ==========
-- Mesma confirm_reservation do 006_novos_planos.sql; a competência da compra é o mes_referencia
create or replace function public.confirm_reservation(p_id uuid, p_forma text, p_valor numeric, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservations; s public.reservation_slots; v_first date;
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  select * into r from public.reservations where id = p_id;
  if r.id is null or r.status <> 'pendente' then raise exception 'Só dá para confirmar reservas aguardando confirmação.'; end if;
  perform pg_advisory_xact_lock(hashtext('sala:' || r.room_id::text));
  for s in select * from public.reservation_slots where reservation_id = p_id loop
    if public.has_conflict(r.room_id, s.freq, s.data, s.hora_ini, s.hora_fim, p_id) then
      raise exception 'Um dos horários desta reserva já está ocupado por outra reserva. Combine outro horário com o cliente.';
    end if;
  end loop;
  update public.reservations set status = 'confirmada', decided_at = now() where id = p_id;
  if coalesce(p_valor, 0) > 0 then
    select min(data) into v_first from public.reservation_slots where reservation_id = p_id;
    update public.reservations set pago_em = now(), pagamento_forma = left(coalesce(p_forma, ''), 40),
      pagamento_valor = p_valor, pagamento_obs = left(coalesce(p_obs, ''), 500) where id = p_id;
    insert into public.payments (reservation_id, competencia, valor, forma, obs, created_by)
    values (p_id, case when r.plano = 'pacote' then coalesce(r.mes_referencia, date_trunc('month', coalesce(v_first, current_date))::date) end,
            p_valor, left(coalesce(p_forma, ''), 40), left(coalesce(p_obs, ''), 500), auth.uid());
  end if;
end $$;

-- ========== Cancelamento pelo cliente ==========
-- Igual ao 010, mas a compra de horas confirmada só é cancelada pela clínica.
-- Cancelar um horário marcado pelo banco devolve as horas (reserva cancelada não conta como usada).
create or replace function public.cancel_my_reservation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservations;
begin
  select * into r from public.reservations where id = p_id and user_id = auth.uid();
  if r.id is null then raise exception 'Reserva não encontrada.'; end if;
  if r.status not in ('pendente','confirmada') then raise exception 'Esta reserva já foi encerrada.'; end if;
  if r.status = 'confirmada' and r.horas_compradas is not null then
    raise exception 'Compra de horas confirmada só pode ser cancelada pela clínica. Fale com a gente pelo WhatsApp.';
  end if;
  if r.status = 'confirmada' and exists (
      select 1 from public.reservation_slots s
      where s.reservation_id = r.id and s.freq = 'unica'
        and (s.data + s.hora_ini * interval '1 hour') at time zone 'America/Sao_Paulo' between now() and now() + interval '24 hours') then
    raise exception 'Faltam menos de 24 horas para um dos horários. Para cancelar, fale com a clínica pelo WhatsApp.';
  end if;
  update public.reservations set status = 'cancelada', cancelado_por = 'cliente', decided_at = now() where id = r.id;
end $$;

-- ========== Aviso para a clínica também no uso do banco ==========
create or replace function public.avisar_nova_reserva() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- pré-reservas feitas pelo site (as criadas pela equipe não têm aceite) e horários marcados pelo banco de horas
  if new.aceite_em is not null or new.usa_banco_de is not null then
    perform net.http_post(
      url := 'https://zfkfjbjvmnjycjoprxqi.supabase.co/functions/v1/avisar-reserva',
      body := jsonb_build_object('id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
  end if;
  return new;
end $$;
-- (o e-mail ao cliente já sai como "confirmada": o uso nasce confirmado e sem aceite_em)

revoke all on function public.banco_horas_resumo(uuid, date) from public, anon;
grant execute on function public.banco_horas_resumo(uuid, date) to authenticated, service_role;
revoke all on function public.saldo_horas(uuid, date) from public, anon;
grant execute on function public.saldo_horas(uuid, date) to authenticated, service_role;
revoke all on function public.request_reservation(jsonb) from public;
grant execute on function public.request_reservation(jsonb) to anon, authenticated;
revoke all on function public.usar_banco_horas(uuid, jsonb) from public, anon;
grant execute on function public.usar_banco_horas(uuid, jsonb) to authenticated;
revoke all on function public.ajustar_banco_horas(uuid, date, numeric, text, uuid) from public, anon;
grant execute on function public.ajustar_banco_horas(uuid, date, numeric, text, uuid) to authenticated;
revoke all on function public.confirm_reservation(uuid, text, numeric, text) from public, anon;
grant execute on function public.confirm_reservation(uuid, text, numeric, text) to authenticated;
revoke all on function public.cancel_my_reservation(uuid) from public, anon;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;
revoke all on function public.avisar_nova_reserva() from public, anon, authenticated;
