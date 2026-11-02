-- Morada do Ser · Reservas (rode depois do schema.sql)

create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms(id) on delete cascade,
  plano       text not null check (plano in ('avulso','pacote','periodo','semanal','quinzenal','bloqueio')),
  status      text not null default 'pendente' check (status in ('pendente','confirmada','recusada','cancelada')),
  nome        text not null,
  telefone    text not null default '',
  email       text not null default '',
  profissao   text not null default '',
  registro    text not null default '',
  obs         text not null default '',
  total       numeric(10,2),
  resumo      text not null default '',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

-- Cada reserva tem um ou mais horários. freq = unica (um dia), semanal ou quinzenal (data = primeiro dia).
create table if not exists public.reservation_slots (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  room_id        uuid not null references public.rooms(id) on delete cascade,
  freq           text not null check (freq in ('unica','semanal','quinzenal')),
  data           date not null,
  hora_ini       smallint not null check (hora_ini between 0 and 23),
  hora_fim       smallint not null check (hora_fim between 1 and 24),
  check (hora_fim > hora_ini)
);
create index if not exists reservation_slots_room_idx on public.reservation_slots(room_id, data);
create index if not exists reservation_slots_res_idx  on public.reservation_slots(reservation_id);
create index if not exists reservations_status_idx    on public.reservations(status, created_at);

-- Só a equipe lê e altera reservas direto. Visitantes usam as funções abaixo.
alter table public.reservations      enable row level security;
alter table public.reservation_slots enable row level security;
create policy "equipe gerencia" on public.reservations      for all to authenticated using (true) with check (true);
create policy "equipe gerencia" on public.reservation_slots for all to authenticated using (true) with check (true);

-- Horários ocupados (pendentes + confirmados) de uma sala num intervalo de datas, sem dados pessoais.
create or replace function public.occupied_slots(p_room uuid, p_from date, p_to date)
returns table(data date, hora_ini smallint, hora_fim smallint)
language sql stable security definer set search_path = public as $$
  select d::date, s.hora_ini, s.hora_fim
  from public.reservation_slots s
  join public.reservations r on r.id = s.reservation_id and r.status in ('pendente','confirmada')
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

-- Cria uma pré-reserva (status pendente) checando conflito de horário.
create or replace function public.create_reservation(p jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rid    uuid;
  s      jsonb;
  v_room uuid := (p->>'room_id')::uuid;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_d    date;
  v_ini  int;
  v_fim  int;
  v_freq text;
  n      int := 0;
begin
  if not exists (select 1 from public.rooms where id = v_room and active) then
    raise exception 'Esta sala não está disponível para reserva.';
  end if;
  if coalesce(trim(p->>'nome'), '') = '' or length(regexp_replace(coalesce(p->>'telefone',''), '\D', '', 'g')) < 10 then
    raise exception 'Informe seu nome e um WhatsApp com DDD.';
  end if;
  if coalesce(p->>'plano','') not in ('avulso','pacote','periodo','semanal','quinzenal') then
    raise exception 'Plano inválido.';
  end if;

  insert into public.reservations (room_id, plano, nome, telefone, email, profissao, registro, obs, total, resumo)
  values (v_room, p->>'plano', left(trim(p->>'nome'), 120), left(p->>'telefone', 30),
          left(coalesce(p->>'email', ''), 120), left(coalesce(p->>'profissao', ''), 80),
          left(coalesce(p->>'registro', ''), 40), left(coalesce(p->>'obs', ''), 1000),
          nullif(p->>'total', '')::numeric, left(coalesce(p->>'resumo', ''), 3000))
  returning id into rid;

  for s in select * from jsonb_array_elements(coalesce(p->'slots', '[]'::jsonb)) loop
    n := n + 1;
    if n > 80 then raise exception 'Horários demais numa reserva só.'; end if;
    v_d := (s->>'data')::date; v_ini := (s->>'hora_ini')::int; v_fim := (s->>'hora_fim')::int; v_freq := s->>'freq';
    if v_freq not in ('unica','semanal','quinzenal') or v_fim <= v_ini then raise exception 'Horário inválido.'; end if;
    if v_d < v_today then raise exception 'Não dá para reservar uma data que já passou.'; end if;
    if exists (
      select 1 from public.occupied_slots(v_room, v_d, v_d + case when v_freq = 'unica' then 0 else 182 end) o
      where o.hora_ini < v_fim and v_ini < o.hora_fim
        and case v_freq
              when 'unica'   then o.data = v_d
              when 'semanal' then extract(dow from o.data) = extract(dow from v_d)
              else extract(dow from o.data) = extract(dow from v_d) and ((o.data - v_d) / 7) % 2 = 0
            end
    ) then
      raise exception 'Um dos horários escolhidos acabou de ser reservado. Atualize a página e escolha outro.';
    end if;
    insert into public.reservation_slots (reservation_id, room_id, freq, data, hora_ini, hora_fim)
    values (rid, v_room, v_freq, v_d, v_ini, v_fim);
  end loop;

  if n = 0 and p->>'plano' <> 'pacote' then
    raise exception 'Escolha pelo menos um horário.';
  end if;
  return rid;
end
$$;

revoke all on function public.occupied_slots(uuid, date, date) from public;
revoke all on function public.create_reservation(jsonb) from public;
grant execute on function public.occupied_slots(uuid, date, date) to anon, authenticated;
grant execute on function public.create_reservation(jsonb) to anon, authenticated;
