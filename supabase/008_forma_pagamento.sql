-- Morada do Ser · Forma de pagamento escolhida pelo cliente (rode depois do 007)
--  · Pix ou link de pagamento (cartão de crédito). No link, a clínica envia o link pelo WhatsApp
--    e pode salvá-lo na reserva para o cliente pagar pela área Minha conta.
alter table public.reservations
  add column if not exists forma_escolhida text not null default 'pix',
  add column if not exists link_pagamento text not null default '';
alter table public.reservations drop constraint if exists reservations_forma_escolhida_check;
alter table public.reservations add constraint reservations_forma_escolhida_check check (forma_escolhida in ('pix','link'));

create or replace function public.request_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rid uuid; cod text; s jsonb; n int := 0; hrs int := 0; v_total numeric; v_mes date;
  v_room  uuid := (p->>'room_id')::uuid;
  v_uid   uuid := auth.uid();
  v_plano text := coalesce(p->>'plano', '');
  v_now   timestamp := now() at time zone 'America/Sao_Paulo';
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_max   date := (now() at time zone 'America/Sao_Paulo')::date + 92;   -- até ~13 semanas à frente
  v_cpf   text := regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g');
  v_tel   text := regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g');
  v_d date; v_ini int; v_fim int; v_freq text; v_email text; v_pcpf text; v_h int[];
  v_forma text := coalesce(nullif(p->>'forma', ''), 'pix');
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
  if v_forma not in ('pix','link') then
    raise exception 'Escolha como vai pagar: Pix ou link de pagamento.';
  end if;
  if coalesce(p->>'aceite', '') <> 'true' then
    raise exception 'Para reservar, é preciso aceitar as regras de uso.';
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

  insert into public.reservations (room_id, user_id, plano, nome, telefone, email, cpf, profissao, registro, obs, total, resumo, aceite_em, forma_escolhida)
  values (v_room, v_uid, v_plano, left(trim(p->>'nome'), 120), left(p->>'telefone', 30), coalesce(v_email, ''), v_cpf,
          left(coalesce(p->>'profissao', ''), 80), left(coalesce(p->>'registro', ''), 40), left(coalesce(p->>'obs', ''), 1000),
          null, left(coalesce(p->>'resumo', ''), 3000), now(), v_forma)
  returning id, codigo into rid, cod;

  for s in select * from jsonb_array_elements(coalesce(p->'slots', '[]'::jsonb)) loop
    n := n + 1;
    if n > 60 then raise exception 'Horários demais numa reserva só.'; end if;
    begin
      v_d := (s->>'data')::date; v_ini := (s->>'hora_ini')::int; v_fim := (s->>'hora_fim')::int; v_freq := s->>'freq';
    exception when others then raise exception 'Horário inválido.';
    end;
    if v_d is null or v_ini is null or v_fim is null or v_fim <= v_ini then raise exception 'Horário inválido.'; end if;
    if v_freq is distinct from (case v_plano when 'semanal' then 'semanal' when 'quinzenal' then 'quinzenal' else 'unica' end) then
      raise exception 'Horário inválido para este plano.';
    end if;
    if v_d < v_today or (v_d = v_today and v_ini <= extract(hour from v_now)) then
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
  v_total := round(v_total, 2);
  update public.reservations set total = v_total where id = rid;

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
  return jsonb_build_object('id', rid, 'codigo', cod, 'total', v_total);
end $$;

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
    if public.has_conflict(v_room, s->>'freq', (s->>'data')::date, (s->>'hora_ini')::int, (s->>'hora_fim')::int, rid) then
      raise exception 'Esse horário já está ocupado.';
    end if;
    insert into public.reservation_slots (reservation_id, room_id, freq, data, hora_ini, hora_fim)
    values (rid, v_room, s->>'freq', (s->>'data')::date, (s->>'hora_ini')::int, (s->>'hora_fim')::int);
  end loop;

  if v_pago and coalesce(nullif(p->>'total', '')::numeric, 0) > 0 then
    insert into public.payments (reservation_id, competencia, valor, forma, created_by)
    values (rid, case when p->>'plano' = 'pacote' then date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date end,
            (p->>'total')::numeric, left(coalesce(p->>'forma', ''), 40), auth.uid());
  end if;
  return jsonb_build_object('id', rid, 'codigo', cod);
end $$;


-- Visitante consulta a reserva pelo código + WhatsApp (agora com a forma de pagamento e o link)
create or replace function public.reservation_by_code(p_codigo text, p_telefone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'codigo', r.codigo, 'status', r.status, 'plano', r.plano, 'sala', ro.name, 'resumo', r.resumo,
    'total', r.total, 'created_at', r.created_at, 'pago_em', r.pago_em,
    'forma', r.forma_escolhida, 'link', case when r.status = 'confirmada' then r.link_pagamento else '' end,
    'pago', coalesce((select sum(valor) from public.payments p where p.reservation_id = r.id), 0))
  from public.reservations r join public.rooms ro on ro.id = r.room_id
  where r.codigo = upper(trim(p_codigo)) and r.plano <> 'bloqueio'
    and length(regexp_replace(p_telefone, '\D', '', 'g')) >= 8
    and (right(regexp_replace(r.telefone, '\D', '', 'g'), 8) = right(regexp_replace(p_telefone, '\D', '', 'g'), 8)
         or (r.cpf <> '' and r.cpf = regexp_replace(p_telefone, '\D', '', 'g')))
$$;

revoke all on function public.request_reservation(jsonb) from public;
grant execute on function public.request_reservation(jsonb) to anon, authenticated;
revoke all on function public.staff_create_reservation(jsonb) from public, anon;
grant execute on function public.staff_create_reservation(jsonb) to authenticated;
revoke all on function public.reservation_by_code(text, text) from public;
grant execute on function public.reservation_by_code(text, text) to anon, authenticated;
