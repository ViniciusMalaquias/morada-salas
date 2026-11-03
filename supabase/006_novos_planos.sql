-- Morada do Ser · Planos novos da clínica (rode depois do 005_seguranca.sql)
--  · Hora avulsa (R$ 38/h, paga no dia), Horas antecipadas (R$ 28/h, mín. 4h no mesmo mês, acerto até o dia 05)
--    e Período de 4h (R$ 90 cada). Saem os planos fixos semanal e quinzenal do site.
--  · A pré-reserva segura o horário até a clínica confirmar ou recusar (não expira mais sozinha).
--  · Confirmar não exige pagamento: o pagamento é registrado à parte (no dia ou até o dia 05).

-- Períodos novos (manhã 8–12, tarde 13–17, noite 17–21) como padrão
create or replace function public.periodo_valido(p_ini int, p_fim int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jsonb_array_elements(public.conf_json('periodos',
      '[{"nome":"Manhã","ini":8,"fim":12},{"nome":"Tarde","ini":13,"fim":17},{"nome":"Noite","ini":17,"fim":21}]'::jsonb)) p
    where (p->>'ini')::int = p_ini and (p->>'fim')::int = p_fim)
$$;

-- Pré-reserva pendente ocupa o horário até a clínica decidir
create or replace function public.occupied_slots_ex(p_room uuid, p_from date, p_to date, p_exclude uuid)
returns table(data date, hora_ini smallint, hora_fim smallint)
language sql stable security definer set search_path = public as $$
  select d::date, s.hora_ini, s.hora_fim
  from public.reservation_slots s
  join public.reservations r on r.id = s.reservation_id
   and r.status in ('confirmada','pendente')
   and (p_exclude is null or r.id <> p_exclude)
  cross join lateral generate_series(greatest(p_from, s.data)::timestamp, p_to::timestamp, interval '1 day') d
  where s.room_id = p_room
    and p_to >= p_from and p_to - p_from <= 200
    and (s.freq <> 'unica' or s.data between p_from and p_to)
    and case s.freq
          when 'unica'   then d::date = s.data
          when 'semanal' then extract(dow from d) = extract(dow from s.data)
          else extract(dow from d) = extract(dow from s.data) and ((d::date - s.data) / 7) % 2 = 0
        end
$$;

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

  insert into public.reservations (room_id, user_id, plano, nome, telefone, email, cpf, profissao, registro, obs, total, resumo, aceite_em)
  values (v_room, v_uid, v_plano, left(trim(p->>'nome'), 120), left(p->>'telefone', 30), coalesce(v_email, ''), v_cpf,
          left(coalesce(p->>'profissao', ''), 80), left(coalesce(p->>'registro', ''), 40), left(coalesce(p->>'obs', ''), 1000),
          null, left(coalesce(p->>'resumo', ''), 3000), now())
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


-- Clínica confirma a reserva; o pagamento é opcional aqui (pode ser registrado depois)
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
    values (p_id, case when r.plano = 'pacote' then date_trunc('month', coalesce(v_first, current_date))::date end,
            p_valor, left(coalesce(p_forma, ''), 40), left(coalesce(p_obs, ''), 500), auth.uid());
  end if;
end $$;

-- Registrar pagamento (no dia do atendimento, ou das horas antecipadas até o dia 05)
create or replace function public.register_payment(p_res uuid, p_competencia date, p_valor numeric, p_forma text, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  if not exists (select 1 from public.reservations where id = p_res and status in ('pendente','confirmada')) then
    raise exception 'Só dá para registrar pagamento de reserva ativa.';
  end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor recebido.'; end if;
  insert into public.payments (reservation_id, competencia, valor, forma, obs, created_by)
  values (p_res, null, p_valor, left(coalesce(p_forma, ''), 40), left(coalesce(p_obs, ''), 500), auth.uid());
  update public.reservations set pago_em = coalesce(pago_em, now()), pagamento_forma = coalesce(pagamento_forma, left(coalesce(p_forma, ''), 40))
  where id = p_res;
end $$;

revoke all on function public.request_reservation(jsonb) from public;
grant execute on function public.request_reservation(jsonb) to anon, authenticated;
revoke all on function public.confirm_reservation(uuid, text, numeric, text) from public, anon;
grant execute on function public.confirm_reservation(uuid, text, numeric, text) to authenticated;
revoke all on function public.register_payment(uuid, date, numeric, text, text) from public, anon;
grant execute on function public.register_payment(uuid, date, numeric, text, text) to authenticated;
revoke all on function public.occupied_slots_ex(uuid, date, date, uuid) from public, anon, authenticated;
revoke all on function public.periodo_valido(int, int) from public, anon, authenticated;

-- Reserva criada pela equipe: confirmar não significa pago (o pagamento só entra se marcado "já pagou")
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
                                   pago_em, pagamento_forma, pagamento_valor)
  values (v_room, p->>'plano', v_status, left(trim(p->>'nome'), 120), left(coalesce(p->>'telefone', ''), 30),
          left(coalesce(p->>'email', ''), 120), regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g'),
          left(coalesce(p->>'profissao', ''), 80), left(coalesce(p->>'obs', ''), 1000),
          nullif(p->>'total', '')::numeric, left(coalesce(p->>'resumo', ''), 3000),
          case when v_status = 'confirmada' then now() end,
          case when v_pago then now() end,
          case when v_pago then left(coalesce(p->>'forma', ''), 40) end,
          case when v_pago then nullif(p->>'total', '')::numeric end)
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

revoke all on function public.staff_create_reservation(jsonb) from public, anon;
grant execute on function public.staff_create_reservation(jsonb) to authenticated;
