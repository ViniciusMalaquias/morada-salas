-- Morada do Ser · Meia hora só na hora avulsa, com preço próprio (rode depois do 012)
--  · Nova chave preco_meia_hora no site_content (R$ por 30 min, editável no painel). Sem ela, vale preco_avulso / 2.
--  · Hora avulsa: o preço é por faixa contínua de horário: horas cheias × preco_avulso + (sobrou meia hora ? preco_meia_hora : 0).
--    Ex.: 10h–11h30 = 1 hora + 1 meia hora; 10h–10h30 e 11h–11h30 = 2 meias horas. O desconto progressivo continua sobre o total.
--  · Nos outros planos (horas antecipadas, período, banco de horas) só horas inteiras: cada faixa tem duração inteira
--    (pode começar em :30, ex.: 14h30–15h30); compra do banco, uso do banco e ajuste de saldo só em horas inteiras.
--  · Só create or replace / insert ... on conflict do nothing (pode rodar de novo sem problema).

-- ========== Preço da meia hora ==========
insert into public.site_content (key, value)
select 'preco_meia_hora', to_jsonb(round(public.conf_num('preco_avulso', 38) / 2, 2))
on conflict (key) do nothing;

create or replace function public.preco_meia_hora() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(public.conf_num('preco_meia_hora', null), public.conf_num('preco_avulso', 38) / 2)
$$;

-- Valor (sem desconto) da hora avulsa de uma reserva: junta as meias horas seguidas de cada dia em faixas contínuas
create or replace function public.avulso_total(p_res uuid) returns numeric
language sql stable security definer set search_path = public as $$
  with s as (
    select data, hora_ini, hora_fim,
           case when hora_ini = lag(hora_fim) over (partition by data order by hora_ini) then 0 else 1 end as nova
    from public.reservation_slots where reservation_id = p_res
  ), g as (
    select data, hora_fim - hora_ini as d, sum(nova) over (partition by data order by hora_ini) as faixa from s
  ), f as (
    select sum(d) as d from g group by data, faixa
  )
  select coalesce(sum(trunc(d)), 0) * public.conf_num('preco_avulso', 38)
       + count(*) filter (where d <> trunc(d)) * public.preco_meia_hora()
  from f
$$;

-- ========== Pré-reserva ==========
-- Mesma request_reservation do 012_banco_horas.sql: avulsa com preço por faixa; outros planos e banco só com horas inteiras
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
    if v_bh is null or v_bh <> trunc(v_bh) then raise exception 'O banco de horas é só de horas inteiras.'; end if;
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
    -- preço: horas (inteiras) × valor da hora antecipada; cada hora inteira conta como um horário no desconto progressivo
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
      -- meia hora só na hora avulsa: nos outros planos, cada faixa tem horas inteiras (pode começar em :30)
      if v_plano <> 'avulso' and (v_fim - v_ini) <> trunc(v_fim - v_ini) then
        raise exception 'Meia hora só existe na hora avulsa. Neste plano, escolha horas inteiras (ex.: 14h30–15h30).';
      end if;
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
      when 'avulso'  then public.avulso_total(rid)
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

-- ========== Marcar horário com o saldo: só horas inteiras ==========
-- Mesma usar_banco_horas do 012_banco_horas.sql, recusando faixa com meia hora
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
    if (v_fim - v_ini) <> trunc(v_fim - v_ini) then
      raise exception 'Os horários do banco de horas são de horas inteiras (ex.: 14h30–15h30).';
    end if;
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

-- ========== Ajuste manual do saldo (equipe): só horas inteiras ==========
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
  if coalesce(p_horas, 0) = 0 or p_horas <> trunc(p_horas) then
    raise exception 'Informe horas inteiras (ex.: 2 ou −1).';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Escreva o motivo do ajuste.'; end if;
  perform pg_advisory_xact_lock(hashtext('banco:' || p_user::text));
  insert into public.ajustes_banco_horas (user_id, mes, horas, motivo, compra_id, created_by)
  values (p_user, v_mes, p_horas, left(trim(p_motivo), 300), p_compra, auth.uid());
  v_saldo := public.saldo_horas(p_user, v_mes);
  if v_saldo < 0 then raise exception 'O saldo não pode ficar negativo (ficaria em %).', public.fmt_horas(v_saldo); end if;
  return v_saldo;
end $$;

-- ========== Reserva criada pela equipe ==========
-- Mesma staff_create_reservation do 010_meia_hora.sql; fora da hora avulsa, só durações inteiras
create or replace function public.staff_create_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid; cod text; s jsonb; v_room uuid := (p->>'room_id')::uuid; v_status text := coalesce(p->>'status', 'pendente');
        v_pago boolean := coalesce(p->>'pago', 'false') = 'true' and coalesce(p->>'status', '') = 'confirmada';
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  if v_status not in ('pendente','confirmada') then raise exception 'Status inválido.'; end if;
  if coalesce(trim(p->>'nome'), '') = '' then raise exception 'Informe o nome do cliente.'; end if;
  if coalesce(p->>'plano', '') not in ('avulso','pacote','periodo','semanal','quinzenal') then raise exception 'Plano inválido.'; end if;
  if coalesce(p->>'cpf', '') <> '' and not public.cpf_valido(p->>'cpf') then raise exception 'CPF inválido.'; end if;
  perform pg_advisory_xact_lock(hashtext('sala:' || v_room::text));

  insert into public.reservations (room_id, plano, status, nome, telefone, email, cpf, profissao, obs, total, resumo, decided_at,
                                   pago_em, pagamento_forma, pagamento_valor, forma_escolhida)
  values (v_room, p->>'plano', v_status, left(trim(p->>'nome'), 120), left(coalesce(p->>'telefone', ''), 30),
          left(coalesce(p->>'email', ''), 120), regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g'),
          left(coalesce(p->>'profissao', ''), 80), left(coalesce(p->>'obs', ''), 1000),
          nullif(p->>'total', '')::numeric, left(coalesce(p->>'resumo', ''), 3000),
          case when v_status = 'confirmada' then now() end,
          case when v_pago then now() end,
          case when v_pago then left(coalesce(p->>'forma', ''), 40) end,
          case when v_pago then nullif(p->>'total', '')::numeric end,
          case when p->>'forma_escolhida' in ('pix','link') then p->>'forma_escolhida' else 'pix' end)
  returning id, codigo into rid, cod;

  for s in select * from jsonb_array_elements(coalesce(p->'slots', '[]'::jsonb)) loop
    if (s->>'hora_fim')::numeric <= (s->>'hora_ini')::numeric
       or (s->>'hora_ini')::numeric * 2 <> trunc((s->>'hora_ini')::numeric * 2)
       or (s->>'hora_fim')::numeric * 2 <> trunc((s->>'hora_fim')::numeric * 2) then
      raise exception 'Horário inválido.';
    end if;
    if p->>'plano' <> 'avulso'
       and ((s->>'hora_fim')::numeric - (s->>'hora_ini')::numeric) <> trunc((s->>'hora_fim')::numeric - (s->>'hora_ini')::numeric) then
      raise exception 'Meia hora só existe na hora avulsa. Neste plano, escolha horas inteiras.';
    end if;
    if public.has_conflict(v_room, s->>'freq', (s->>'data')::date, (s->>'hora_ini')::numeric, (s->>'hora_fim')::numeric, rid) then
      raise exception 'Esse horário já está ocupado.';
    end if;
    insert into public.reservation_slots (reservation_id, room_id, freq, data, hora_ini, hora_fim)
    values (rid, v_room, s->>'freq', (s->>'data')::date, (s->>'hora_ini')::numeric, (s->>'hora_fim')::numeric);
  end loop;

  if v_pago and coalesce(nullif(p->>'total', '')::numeric, 0) > 0 then
    insert into public.payments (reservation_id, competencia, valor, forma, created_by)
    values (rid, case when p->>'plano' = 'pacote' then date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date end,
            (p->>'total')::numeric, left(coalesce(p->>'forma', ''), 40), auth.uid());
  end if;
  return jsonb_build_object('id', rid, 'codigo', cod);
end $$;

revoke all on function public.preco_meia_hora() from public, anon, authenticated;
revoke all on function public.avulso_total(uuid) from public, anon, authenticated;
revoke all on function public.request_reservation(jsonb) from public;
grant execute on function public.request_reservation(jsonb) to anon, authenticated;
revoke all on function public.usar_banco_horas(uuid, jsonb) from public, anon;
grant execute on function public.usar_banco_horas(uuid, jsonb) to authenticated;
revoke all on function public.ajustar_banco_horas(uuid, date, numeric, text, uuid) from public, anon;
grant execute on function public.ajustar_banco_horas(uuid, date, numeric, text, uuid) to authenticated;
revoke all on function public.staff_create_reservation(jsonb) from public, anon;
grant execute on function public.staff_create_reservation(jsonb) to authenticated;
