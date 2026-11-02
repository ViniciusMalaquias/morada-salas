-- Morada do Ser · Contas de clientes, equipe e pagamento (rode depois do 002_reservas.sql)

-- ========== Equipe ==========
-- Antes, qualquer usuário logado era tratado como equipe. Com cadastro aberto para clientes,
-- só quem está nesta tabela acessa o painel.
create table if not exists public.staff (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text not null default '',
  created_at timestamptz not null default now()
);
alter table public.staff enable row level security;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;

create policy "equipe vê equipe" on public.staff for select to authenticated using (public.is_staff());

alter policy "equipe edita" on public.site_content to authenticated using (public.is_staff()) with check (public.is_staff());
alter policy "equipe edita" on public.rooms        to authenticated using (public.is_staff()) with check (public.is_staff());
alter policy "equipe edita" on public.room_photos  to authenticated using (public.is_staff()) with check (public.is_staff());
alter policy "leitura publica" on public.rooms using (active or public.is_staff());
alter policy "equipe gerencia" on public.reservations      to authenticated using (public.is_staff()) with check (public.is_staff());
alter policy "equipe gerencia" on public.reservation_slots to authenticated using (public.is_staff()) with check (public.is_staff());
alter policy "fotos equipe lista"  on storage.objects to authenticated using (bucket_id = 'fotos' and public.is_staff());
alter policy "fotos equipe envia"  on storage.objects to authenticated with check (bucket_id = 'fotos' and public.is_staff());
alter policy "fotos equipe altera" on storage.objects to authenticated using (bucket_id = 'fotos' and public.is_staff());
alter policy "fotos equipe apaga"  on storage.objects to authenticated using (bucket_id = 'fotos' and public.is_staff());

create or replace function public.add_staff(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_email text;
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  select id, email into v_id, v_email from auth.users where lower(email) = lower(trim(p_email));
  if v_id is null then raise exception 'Essa pessoa ainda não tem conta. Peça para ela se cadastrar em "Entrar" no site e tente de novo.'; end if;
  insert into public.staff (user_id, email) values (v_id, v_email) on conflict (user_id) do nothing;
end $$;

create or replace function public.remove_staff(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode tirar o seu próprio acesso.'; end if;
  delete from public.staff where user_id = p_user;
end $$;

-- ========== CPF ==========
create or replace function public.cpf_valido(p text) returns boolean
language plpgsql immutable set search_path = public as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
  r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;

-- ========== Perfis de clientes ==========
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nome       text not null default '',
  telefone   text not null default '',
  email      text not null default '',
  profissao  text not null default '',
  registro   text not null default '',
  cpf        text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists profiles_cpf_idx on public.profiles(cpf) where cpf <> '';
alter table public.profiles enable row level security;
create policy "cliente vê o seu"     on public.profiles for select to authenticated using (id = auth.uid() or public.is_staff());
create policy "cliente cria o seu"   on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "cliente edita o seu"  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nome, telefone, profissao, registro, cpf)
  values (new.id, coalesce(new.email, ''),
          left(coalesce(new.raw_user_meta_data->>'nome', ''), 120),
          left(coalesce(new.raw_user_meta_data->>'telefone', ''), 30),
          left(coalesce(new.raw_user_meta_data->>'profissao', ''), 80),
          left(coalesce(new.raw_user_meta_data->>'registro', ''), 40),
          case when public.cpf_valido(new.raw_user_meta_data->>'cpf')
                and not exists (select 1 from public.profiles where cpf = regexp_replace(new.raw_user_meta_data->>'cpf', '\D', '', 'g'))
               then regexp_replace(new.raw_user_meta_data->>'cpf', '\D', '', 'g') else '' end)
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ========== Reservas: dono, código, pagamento ==========
alter table public.reservations
  add column if not exists user_id         uuid references auth.users(id) on delete set null,
  add column if not exists codigo          text,
  add column if not exists pagamento_forma text,
  add column if not exists pagamento_valor numeric(10,2),
  add column if not exists pago_em         timestamptz,
  add column if not exists pagamento_obs   text not null default '',
  add column if not exists aceite_em       timestamptz,
  add column if not exists cancelado_por   text,
  add column if not exists cpf             text not null default '';
create index if not exists reservations_cpf_idx on public.reservations(cpf) where cpf <> '';
update public.reservations set codigo = upper(substr(replace(id::text, '-', ''), 1, 8)) where codigo is null;
alter table public.reservations alter column codigo set default upper(substr(md5(gen_random_uuid()::text), 1, 8));
alter table public.reservations alter column codigo set not null;
create unique index if not exists reservations_codigo_idx on public.reservations(codigo);
create index if not exists reservations_user_idx on public.reservations(user_id);

create policy "cliente vê as suas" on public.reservations for select to authenticated using (user_id = auth.uid());
create policy "cliente vê os seus horários" on public.reservation_slots for select to authenticated
  using (exists (select 1 from public.reservations r where r.id = reservation_id and r.user_id = auth.uid()));

-- Prazo (horas) para pagar uma pré-reserva antes de o horário ser liberado
create or replace function public.prazo_pagamento_horas() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric::int end
                   from public.site_content where key = 'prazo_pagamento_horas'), 24)
$$;

-- Ocupação considerando: confirmadas + pendentes ainda dentro do prazo; opcionalmente ignora uma reserva
create or replace function public.occupied_slots_ex(p_room uuid, p_from date, p_to date, p_exclude uuid)
returns table(data date, hora_ini smallint, hora_fim smallint)
language sql stable security definer set search_path = public as $$
  select d::date, s.hora_ini, s.hora_fim
  from public.reservation_slots s
  join public.reservations r on r.id = s.reservation_id
   and (r.status = 'confirmada'
        or (r.status = 'pendente' and r.created_at > now() - make_interval(hours => public.prazo_pagamento_horas())))
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

create or replace function public.occupied_slots(p_room uuid, p_from date, p_to date)
returns table(data date, hora_ini smallint, hora_fim smallint)
language sql stable security definer set search_path = public as $$
  select * from public.occupied_slots_ex(p_room, p_from, p_to, null)
$$;

create or replace function public.has_conflict(p_room uuid, p_freq text, p_data date, p_ini int, p_fim int, p_exclude uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.occupied_slots_ex(p_room, p_data, p_data + case when p_freq = 'unica' then 0 else 182 end, p_exclude) o
    where o.hora_ini < p_fim and p_ini < o.hora_fim
      and case p_freq
            when 'unica'   then o.data = p_data
            when 'semanal' then extract(dow from o.data) = extract(dow from p_data)
            else extract(dow from o.data) = extract(dow from p_data) and ((o.data - p_data) / 7) % 2 = 0
          end)
$$;

-- Nova pré-reserva (visitante ou cliente logado). Devolve {id, codigo}.
create or replace function public.request_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  rid uuid; cod text; s jsonb; n int := 0;
  v_room uuid := (p->>'room_id')::uuid;
  v_uid  uuid := auth.uid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_d date; v_ini int; v_fim int; v_freq text; v_email text;
begin
  if not exists (select 1 from public.rooms where id = v_room and active) then
    raise exception 'Esta sala não está disponível para reserva.';
  end if;
  if array_length(regexp_split_to_array(trim(coalesce(p->>'nome', '')), '\s+'), 1) < 2 then
    raise exception 'Informe seu nome completo.';
  end if;
  if length(regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g')) < 10 then
    raise exception 'Informe um telefone de contato com DDD.';
  end if;
  if not public.cpf_valido(p->>'cpf') then
    raise exception 'CPF inválido. Confira os números.';
  end if;
  if coalesce(p->>'plano', '') not in ('avulso','pacote','periodo','semanal','quinzenal') then
    raise exception 'Plano inválido.';
  end if;
  if coalesce(p->>'aceite', '') <> 'true' then
    raise exception 'Para reservar, é preciso aceitar as regras de uso.';
  end if;
  v_email := left(coalesce(p->>'email', ''), 120);
  if v_uid is not null then select email into v_email from auth.users where id = v_uid; end if;
  if coalesce(v_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Informe um e-mail válido.';
  end if;

  insert into public.reservations (room_id, user_id, plano, nome, telefone, email, cpf, profissao, registro, obs, total, resumo, aceite_em)
  values (v_room, v_uid, p->>'plano', left(trim(p->>'nome'), 120), left(p->>'telefone', 30), coalesce(v_email, ''),
          regexp_replace(p->>'cpf', '\D', '', 'g'),
          left(coalesce(p->>'profissao', ''), 80), left(coalesce(p->>'registro', ''), 40), left(coalesce(p->>'obs', ''), 1000),
          nullif(p->>'total', '')::numeric, left(coalesce(p->>'resumo', ''), 3000), now())
  returning id, codigo into rid, cod;

  for s in select * from jsonb_array_elements(coalesce(p->'slots', '[]'::jsonb)) loop
    n := n + 1;
    if n > 80 then raise exception 'Horários demais numa reserva só.'; end if;
    v_d := (s->>'data')::date; v_ini := (s->>'hora_ini')::int; v_fim := (s->>'hora_fim')::int; v_freq := s->>'freq';
    if v_freq not in ('unica','semanal','quinzenal') or v_fim <= v_ini then raise exception 'Horário inválido.'; end if;
    if v_d < v_today then raise exception 'Não dá para reservar uma data que já passou.'; end if;
    if public.has_conflict(v_room, v_freq, v_d, v_ini, v_fim, null) then
      raise exception 'Um dos horários escolhidos acabou de ser reservado. Atualize a página e escolha outro.';
    end if;
    insert into public.reservation_slots (reservation_id, room_id, freq, data, hora_ini, hora_fim)
    values (rid, v_room, v_freq, v_d, v_ini, v_fim);
  end loop;
  if n = 0 and p->>'plano' <> 'pacote' then raise exception 'Escolha pelo menos um horário.'; end if;

  -- completa o perfil do cliente logado com o que ele digitou
  if v_uid is not null then
    update public.profiles set
      nome = case when nome = '' then left(trim(p->>'nome'), 120) else nome end,
      telefone = case when telefone = '' then left(p->>'telefone', 30) else telefone end,
      profissao = case when profissao = '' then left(coalesce(p->>'profissao', ''), 80) else profissao end,
      registro = case when registro = '' then left(coalesce(p->>'registro', ''), 40) else registro end,
      cpf = case when cpf = '' and not exists (select 1 from public.profiles x where x.cpf = regexp_replace(p->>'cpf', '\D', '', 'g'))
                 then regexp_replace(p->>'cpf', '\D', '', 'g') else cpf end,
      updated_at = now()
    where id = v_uid;
  end if;
  return jsonb_build_object('id', rid, 'codigo', cod);
end $$;

-- Cliente cancela a própria reserva (pendente sempre; confirmada só com 24h de antecedência do próximo horário avulso)
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
        and (s.data + make_interval(hours => s.hora_ini)) at time zone 'America/Sao_Paulo' between now() and now() + interval '24 hours') then
    raise exception 'Faltam menos de 24 horas para um dos horários. Para cancelar, fale com a clínica pelo WhatsApp.';
  end if;
  update public.reservations set status = 'cancelada', cancelado_por = 'cliente', decided_at = now() where id = r.id;
end $$;

-- Visitante consulta uma reserva pelo código + WhatsApp
create or replace function public.reservation_by_code(p_codigo text, p_telefone text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'codigo', r.codigo, 'status', r.status, 'plano', r.plano, 'sala', ro.name, 'resumo', r.resumo,
    'total', r.total, 'created_at', r.created_at, 'pago_em', r.pago_em,
    'expira_em', r.created_at + make_interval(hours => public.prazo_pagamento_horas()))
  from public.reservations r join public.rooms ro on ro.id = r.room_id
  where r.codigo = upper(trim(p_codigo)) and r.plano <> 'bloqueio'
    and length(regexp_replace(p_telefone, '\D', '', 'g')) >= 8
    and (right(regexp_replace(r.telefone, '\D', '', 'g'), 8) = right(regexp_replace(p_telefone, '\D', '', 'g'), 8)
         or (r.cpf <> '' and r.cpf = regexp_replace(p_telefone, '\D', '', 'g')))
$$;

-- Cliente logado vincula uma reserva feita como visitante (código + WhatsApp)
create or replace function public.claim_reservation(p_codigo text, p_telefone text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta primeiro.'; end if;
  select id into v_id from public.reservations
  where codigo = upper(trim(p_codigo)) and user_id is null and plano <> 'bloqueio'
    and length(regexp_replace(p_telefone, '\D', '', 'g')) >= 8
    and (right(regexp_replace(telefone, '\D', '', 'g'), 8) = right(regexp_replace(p_telefone, '\D', '', 'g'), 8)
         or (cpf <> '' and cpf = regexp_replace(p_telefone, '\D', '', 'g')));
  if v_id is null then raise exception 'Não encontramos uma reserva sem conta com esse código e WhatsApp.'; end if;
  update public.reservations set user_id = auth.uid() where id = v_id;
end $$;

-- Vincula automaticamente reservas de visitante à conta:
--  · pelo e-mail, quando o e-mail da conta está confirmado; ou
--  · pelo CPF do perfil, desde que o telefone (últimos 8 dígitos) também bata.
create or replace function public.claim_my_reservations() returns int
language plpgsql security definer set search_path = public as $$
declare v_email text; v_cpf text; v_tel text; n int;
begin
  if auth.uid() is null then return 0; end if;
  select u.email, p.cpf, right(regexp_replace(p.telefone, '\D', '', 'g'), 8)
    into v_email, v_cpf, v_tel
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = auth.uid();
  update public.reservations r set user_id = auth.uid()
  where r.user_id is null and r.plano <> 'bloqueio'
    and ( (v_email is not null and lower(r.email) = lower(v_email)
           and exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null))
       or (coalesce(v_cpf, '') <> '' and r.cpf = v_cpf and length(coalesce(v_tel, '')) = 8
           and right(regexp_replace(r.telefone, '\D', '', 'g'), 8) = v_tel) );
  get diagnostics n = row_count;
  return n;
end $$;

-- Equipe confirma (pagamento recebido), checando se o horário continua livre
create or replace function public.confirm_reservation(p_id uuid, p_forma text, p_valor numeric, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservations; s public.reservation_slots;
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  select * into r from public.reservations where id = p_id;
  if r.id is null or r.status <> 'pendente' then raise exception 'Só dá para confirmar reservas pendentes.'; end if;
  for s in select * from public.reservation_slots where reservation_id = p_id loop
    if public.has_conflict(r.room_id, s.freq, s.data, s.hora_ini, s.hora_fim, p_id) then
      raise exception 'O horário desta reserva já foi ocupado por outra pessoa (o prazo de pagamento tinha passado). Combine outro horário com o cliente.';
    end if;
  end loop;
  update public.reservations set status = 'confirmada', decided_at = now(), pago_em = now(),
    pagamento_forma = left(coalesce(p_forma, ''), 40), pagamento_valor = p_valor, pagamento_obs = left(coalesce(p_obs, ''), 500)
  where id = p_id;
end $$;

-- A função antiga fica sem acesso público (o site usa request_reservation)
revoke all on function public.create_reservation(jsonb) from anon, authenticated;

revoke all on function public.is_staff() from public;
revoke all on function public.add_staff(text) from public;
revoke all on function public.remove_staff(uuid) from public;
revoke all on function public.occupied_slots_ex(uuid, date, date, uuid) from public;
revoke all on function public.has_conflict(uuid, text, date, int, int, uuid) from public;
revoke all on function public.request_reservation(jsonb) from public;
revoke all on function public.cancel_my_reservation(uuid) from public;
revoke all on function public.reservation_by_code(text, text) from public;
revoke all on function public.claim_reservation(text, text) from public;
revoke all on function public.claim_my_reservations() from public;
revoke all on function public.confirm_reservation(uuid, text, numeric, text) from public;
revoke all on function public.prazo_pagamento_horas() from public;
revoke all on function public.handle_new_user() from public;

grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.add_staff(text) to authenticated;
grant execute on function public.remove_staff(uuid) to authenticated;
grant execute on function public.request_reservation(jsonb) to anon, authenticated;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;
grant execute on function public.reservation_by_code(text, text) to anon, authenticated;
grant execute on function public.claim_reservation(text, text) to authenticated;
grant execute on function public.claim_my_reservations() to authenticated;
grant execute on function public.cpf_valido(text) to anon, authenticated;
grant execute on function public.confirm_reservation(uuid, text, numeric, text) to authenticated;
grant execute on function public.prazo_pagamento_horas() to anon, authenticated;
