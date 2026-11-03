-- Morada do Ser · Segurança das reservas (rode depois do 004_financeiro.sql)
--  · vínculo automático só por e-mail confirmado (sai o vínculo por CPF)
--  · CPF e e-mail do perfil travados depois de preenchidos
--  · horário de funcionamento, períodos, antecedência e plano validados no banco
--  · preço calculado no banco (o valor enviado pelo navegador é ignorado)
--  · limite de pré-reservas em aberto por pessoa e por hora
--  · trava por sala para duas pessoas não pegarem o mesmo horário ao mesmo tempo

-- ========== Configurações (site_content com valores padrão) ==========
create or replace function public.conf_num(p_key text, p_default numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case
             when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric
             when jsonb_typeof(value) = 'string' and replace(value #>> '{}', ',', '.') ~ '^\s*\d+(\.\d+)?\s*$'
               then replace(value #>> '{}', ',', '.')::numeric
           end
    from public.site_content where key = p_key), p_default)
$$;

create or replace function public.conf_json(p_key text, p_default jsonb) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.site_content where key = p_key and jsonb_typeof(value) in ('object','array')), p_default)
$$;

-- [abre, fecha] do dia, ou null se fechado
create or replace function public.horario_do_dia(p_data date) returns int[]
language sql stable security definer set search_path = public as $$
  select case when jsonb_typeof(h) = 'array' and jsonb_array_length(h) = 2
              then array[(h->>0)::int, (h->>1)::int] end
  from (select public.conf_json('horarios',
          '{"Seg":[8,21],"Ter":[8,21],"Qua":[8,21],"Qui":[8,21],"Sex":[8,21],"Sáb":[8,15],"Dom":null}'::jsonb)
          -> (array['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'])[extract(dow from p_data)::int + 1] as h) x
$$;

create or replace function public.periodo_valido(p_ini int, p_fim int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from jsonb_array_elements(public.conf_json('periodos',
      '[{"nome":"Manhã","ini":8,"fim":12},{"nome":"Tarde","ini":14,"fim":18},{"nome":"Noite","ini":18,"fim":21}]'::jsonb)) p
    where (p->>'ini')::int = p_ini and (p->>'fim')::int = p_fim)
$$;

-- ========== Nova pré-reserva ==========
create or replace function public.request_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rid uuid; cod text; s jsonb; n int := 0; hrs int := 0; v_total numeric;
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
  if v_plano not in ('avulso','pacote','periodo','semanal','quinzenal') then
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
        and r.created_at > now() - make_interval(hours => public.prazo_pagamento_horas())
        and (r.cpf = v_cpf
             or right(regexp_replace(r.telefone, '\D', '', 'g'), 8) = right(v_tel, 8)
             or (v_uid is not null and r.user_id = v_uid))) >= 3 then
    raise exception 'Você já tem 3 pré-reservas aguardando pagamento. Pague ou cancele uma delas antes de fazer outra, ou fale com a clínica pelo WhatsApp.';
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
    if public.has_conflict(v_room, v_freq, v_d, v_ini, v_fim, null) then
      raise exception 'Um dos horários escolhidos acabou de ser reservado. Atualize a página e escolha outro.';
    end if;
    insert into public.reservation_slots (reservation_id, room_id, freq, data, hora_ini, hora_fim)
    values (rid, v_room, v_freq, v_d, v_ini, v_fim);
    hrs := hrs + (v_fim - v_ini);
  end loop;
  if n = 0 and v_plano <> 'pacote' then raise exception 'Escolha pelo menos um horário.'; end if;

  -- Preço calculado aqui, com os valores do painel
  if v_plano = 'pacote' and hrs > public.conf_num('pacote_horas', 10) then
    raise exception 'O pacote tem % horas. Desmarque alguns horários.', public.conf_num('pacote_horas', 10);
  end if;
  v_total := case v_plano
    when 'avulso'    then hrs * public.conf_num('preco_avulso', 45)
    when 'pacote'    then public.conf_num('pacote_preco', 400)
    when 'periodo'   then hrs * public.conf_num('preco_periodo', 37.5)
    when 'quinzenal' then hrs * public.conf_num('preco_quinzenal', 40) * 2
    when 'semanal'   then hrs * 4 * case when hrs >= 8 then public.conf_num('semanal_8', 32)
                                         when hrs >= 4 then public.conf_num('semanal_4', 35)
                                         else public.conf_num('semanal_1', 38) end
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

-- ========== Vínculo automático: só pelo e-mail confirmado ==========
create or replace function public.claim_my_reservations() returns int
language plpgsql security definer set search_path = public as $$
declare v_email text; n int;
begin
  if auth.uid() is null then return 0; end if;
  select email into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if coalesce(v_email, '') = '' then return 0; end if;
  update public.reservations r set user_id = auth.uid()
  where r.user_id is null and r.plano <> 'bloqueio' and lower(r.email) = lower(v_email);
  get diagnostics n = row_count;
  return n;
end $$;

-- ========== Perfil: CPF e e-mail travados ==========
create or replace function public.protect_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.cpf := regexp_replace(coalesce(new.cpf, ''), '\D', '', 'g');
  if public.is_staff() and auth.uid() is distinct from new.id then return new; end if;
  if tg_op = 'UPDATE' then
    new.email := old.email;
    new.created_at := old.created_at;
    if old.cpf <> '' and new.cpf <> old.cpf then
      raise exception 'O CPF não pode ser alterado. Se estiver errado, fale com a clínica.';
    end if;
  else
    new.email := coalesce((select email from auth.users where id = new.id), '');
  end if;
  if new.cpf <> '' and not public.cpf_valido(new.cpf) then
    raise exception 'CPF inválido. Confira os números.';
  end if;
  return new;
end $$;
drop trigger if exists protect_profile on public.profiles;
create trigger protect_profile before insert or update on public.profiles
  for each row execute function public.protect_profile();

-- ========== Reserva pela equipe também usa a trava por sala ==========
create or replace function public.staff_create_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid; cod text; s jsonb; v_room uuid := (p->>'room_id')::uuid; v_status text := coalesce(p->>'status', 'pendente');
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
          case when v_status = 'confirmada' then now() end,
          case when v_status = 'confirmada' then left(coalesce(p->>'forma', ''), 40) end,
          case when v_status = 'confirmada' then nullif(p->>'total', '')::numeric end)
  returning id, codigo into rid, cod;

  for s in select * from jsonb_array_elements(coalesce(p->'slots', '[]'::jsonb)) loop
    if public.has_conflict(v_room, s->>'freq', (s->>'data')::date, (s->>'hora_ini')::int, (s->>'hora_fim')::int, rid) then
      raise exception 'Esse horário já está ocupado.';
    end if;
    insert into public.reservation_slots (reservation_id, room_id, freq, data, hora_ini, hora_fim)
    values (rid, v_room, s->>'freq', (s->>'data')::date, (s->>'hora_ini')::int, (s->>'hora_fim')::int);
  end loop;

  if v_status = 'confirmada' and coalesce(nullif(p->>'total', '')::numeric, 0) > 0 then
    insert into public.payments (reservation_id, competencia, valor, forma, created_by)
    values (rid, case when p->>'plano' in ('semanal','quinzenal') then date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date end,
            (p->>'total')::numeric, left(coalesce(p->>'forma', ''), 40), auth.uid());
  end if;
  return jsonb_build_object('id', rid, 'codigo', cod);
end $$;

-- ========== Limpeza ==========
drop function if exists public.create_reservation(jsonb);
-- chaves antigas sem uso e textos desatualizados (o site volta a usar os textos padrão atuais)
delete from public.site_content where key in ('dias', 'hora_inicio', 'hora_fim', 'destaques', 'passos', 'salas_texto');

-- ========== Permissões ==========
revoke all on function public.conf_num(text, numeric) from public, anon, authenticated;
revoke all on function public.conf_json(text, jsonb) from public, anon, authenticated;
revoke all on function public.horario_do_dia(date) from public, anon, authenticated;
revoke all on function public.periodo_valido(int, int) from public, anon, authenticated;
revoke all on function public.protect_profile() from public, anon, authenticated;
revoke all on function public.request_reservation(jsonb) from public;
grant execute on function public.request_reservation(jsonb) to anon, authenticated;
revoke all on function public.claim_my_reservations() from public, anon;
grant execute on function public.claim_my_reservations() to authenticated;
revoke all on function public.staff_create_reservation(jsonb) from public, anon;
grant execute on function public.staff_create_reservation(jsonb) to authenticated;
