-- Morada do Ser · Reservas de 30 em 30 minutos (rode depois do 009)
--  · horários passam a aceitar meia hora (ex.: 14,5 = 14h30); preço proporcional (meia hora = metade da hora)
alter table public.reservation_slots
  alter column hora_ini type numeric(4,1),
  alter column hora_fim type numeric(4,1);
alter table public.reservation_slots add constraint reservation_slots_meia_hora
  check (hora_ini * 2 = trunc(hora_ini * 2) and hora_fim * 2 = trunc(hora_fim * 2));

-- Ocupação com meia hora
create or replace function public.occupied_slots_ex2(p_room uuid, p_from date, p_to date, p_exclude uuid)
returns table(data date, hora_ini numeric, hora_fim numeric)
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

create or replace function public.occupied_slots2(p_room uuid, p_from date, p_to date)
returns table(data date, hora_ini numeric, hora_fim numeric)
language sql stable security definer set search_path = public as $$
  select * from public.occupied_slots_ex2(p_room, p_from, p_to, null)
$$;

-- As antigas continuam funcionando (arredondando para a hora cheia) até todo mundo carregar o site novo
create or replace function public.occupied_slots_ex(p_room uuid, p_from date, p_to date, p_exclude uuid)
returns table(data date, hora_ini smallint, hora_fim smallint)
language sql stable security definer set search_path = public as $$
  select o.data, floor(o.hora_ini)::smallint, ceil(o.hora_fim)::smallint from public.occupied_slots_ex2(p_room, p_from, p_to, p_exclude) o
$$;

create or replace function public.has_conflict(p_room uuid, p_freq text, p_data date, p_ini numeric, p_fim numeric, p_exclude uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.occupied_slots_ex2(p_room, p_data, p_data + case when p_freq = 'unica' then 0 else 182 end, p_exclude) o
    where o.hora_ini < p_fim and p_ini < o.hora_fim
      and case p_freq
            when 'unica'   then o.data = p_data
            when 'semanal' then extract(dow from o.data) = extract(dow from p_data)
            else extract(dow from o.data) = extract(dow from p_data) and ((o.data - p_data) / 7) % 2 = 0
          end)
$$;

create or replace function public.has_conflict(p_room uuid, p_freq text, p_data date, p_ini int, p_fim int, p_exclude uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_conflict(p_room, p_freq, p_data, p_ini::numeric, p_fim::numeric, p_exclude)
$$;

create or replace function public.periodo_valido(p_ini numeric, p_fim numeric) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jsonb_array_elements(public.conf_json('periodos',
      '[{"nome":"Manhã","ini":8,"fim":12},{"nome":"Tarde","ini":13,"fim":17},{"nome":"Noite","ini":17,"fim":21}]'::jsonb)) p
    where (p->>'ini')::numeric = p_ini and (p->>'fim')::numeric = p_fim)
$$;

create or replace function public.request_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rid uuid; cod text; s jsonb; n int := 0; hrs numeric := 0; v_total numeric; v_mes date;
  v_room  uuid := (p->>'room_id')::uuid;
  v_uid   uuid := auth.uid();
  v_plano text := coalesce(p->>'plano', '');
  v_now   timestamp := now() at time zone 'America/Sao_Paulo';
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_max   date := (now() at time zone 'America/Sao_Paulo')::date + 92;   -- até ~13 semanas à frente
  v_cpf   text := regexp_replace(coalesce(p->>'cpf', ''), '\D', '', 'g');
  v_tel   text := regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g');
  v_d date; v_ini numeric; v_fim numeric; v_freq text; v_email text; v_pcpf text; v_h int[];
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



-- Cancelamento pelo cliente (hora com meia hora)
create or replace function public.cancel_my_reservation(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservations;
begin
  select * into r from public.reservations where id = p_id and user_id = auth.uid();
  if r.id is null then raise exception 'Reserva não encontrada.'; end if;
  if r.status not in ('pendente','confirmada') then raise exception 'Esta reserva já foi encerrada.'; end if;
  if r.status = 'confirmada' and exists (
      select 1 from public.reservation_slots s
      where s.reservation_id = r.id and s.freq = 'unica'
        and (s.data + s.hora_ini * interval '1 hour') at time zone 'America/Sao_Paulo' between now() and now() + interval '24 hours') then
    raise exception 'Faltam menos de 24 horas para um dos horários. Para cancelar, fale com a clínica pelo WhatsApp.';
  end if;
  update public.reservations set status = 'cancelada', cancelado_por = 'cliente', decided_at = now() where id = r.id;
end $$;

-- Lembretes (hora com meia hora)
create or replace function public.lembretes_pendentes()
returns table(reservation_id uuid, data date)
language sql stable security definer set search_path = public as $$
  select distinct r.id, d::date
  from public.reservations r
  join public.reservation_slots s on s.reservation_id = r.id
  cross join lateral generate_series((now() at time zone 'America/Sao_Paulo')::date,
                                     (now() at time zone 'America/Sao_Paulo')::date + 1, interval '1 day') d
  where r.status = 'confirmada' and r.plano <> 'bloqueio' and coalesce(r.email, '') <> ''
    and d::date >= s.data
    and case s.freq
          when 'unica'   then d::date = s.data
          when 'semanal' then extract(dow from d) = extract(dow from s.data)
          else extract(dow from d) = extract(dow from s.data) and ((d::date - s.data) / 7) % 2 = 0
        end
    and ((d::date + s.hora_ini * interval '1 hour') at time zone 'America/Sao_Paulo') between now() and now() + interval '24 hours'
    and coalesce(r.decided_at, r.created_at) < ((d::date + s.hora_ini * interval '1 hour') at time zone 'America/Sao_Paulo') - interval '24 hours'
    and not exists (select 1 from public.lembretes_enviados l where l.reservation_id = r.id and l.data = d::date)
$$;

revoke all on function public.occupied_slots_ex2(uuid, date, date, uuid) from public, anon, authenticated;
revoke all on function public.occupied_slots2(uuid, date, date) from public;
grant execute on function public.occupied_slots2(uuid, date, date) to anon, authenticated;
revoke all on function public.has_conflict(uuid, text, date, numeric, numeric, uuid) from public, anon, authenticated;
revoke all on function public.periodo_valido(numeric, numeric) from public, anon, authenticated;
revoke all on function public.request_reservation(jsonb) from public;
grant execute on function public.request_reservation(jsonb) to anon, authenticated;
revoke all on function public.staff_create_reservation(jsonb) from public, anon;
grant execute on function public.staff_create_reservation(jsonb) to authenticated;
revoke all on function public.cancel_my_reservation(uuid) from public, anon;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;
revoke all on function public.lembretes_pendentes() from public, anon, authenticated;
