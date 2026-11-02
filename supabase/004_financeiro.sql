-- Morada do Ser · Financeiro: pagamentos, mensalidades dos planos fixos e reserva manual pela equipe

create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  competencia    date,                       -- mês de referência (dia 1) para planos fixos
  valor          numeric(10,2) not null default 0,
  forma          text not null default '',
  obs            text not null default '',
  pago_em        timestamptz not null default now(),
  created_by     uuid references auth.users(id) on delete set null
);
create index if not exists payments_res_idx on public.payments(reservation_id);
create index if not exists payments_pago_idx on public.payments(pago_em);
create unique index if not exists payments_mes_idx on public.payments(reservation_id, competencia) where competencia is not null;

alter table public.payments enable row level security;
create policy "equipe gerencia" on public.payments for all to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "cliente vê os seus" on public.payments for select to authenticated
  using (exists (select 1 from public.reservations r where r.id = reservation_id and r.user_id = auth.uid()));

-- Pagamentos de reservas já confirmadas antes desta tabela existir
insert into public.payments (reservation_id, competencia, valor, forma, obs, pago_em)
select r.id,
       case when r.plano in ('semanal','quinzenal') then date_trunc('month', coalesce(r.pago_em, r.decided_at, r.created_at))::date end,
       coalesce(r.pagamento_valor, r.total, 0), coalesce(r.pagamento_forma, ''), coalesce(r.pagamento_obs, ''),
       coalesce(r.pago_em, r.decided_at, r.created_at)
from public.reservations r
where r.status = 'confirmada' and r.plano <> 'bloqueio'
  and not exists (select 1 from public.payments p where p.reservation_id = r.id);

-- Confirmar = registrar o primeiro pagamento
create or replace function public.confirm_reservation(p_id uuid, p_forma text, p_valor numeric, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservations; s public.reservation_slots; v_first date;
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
  select min(data) into v_first from public.reservation_slots where reservation_id = p_id;
  insert into public.payments (reservation_id, competencia, valor, forma, obs, created_by)
  values (p_id,
          case when r.plano in ('semanal','quinzenal')
               then date_trunc('month', greatest(coalesce(v_first, current_date), (now() at time zone 'America/Sao_Paulo')::date))::date end,
          coalesce(p_valor, r.total, 0), left(coalesce(p_forma, ''), 40), left(coalesce(p_obs, ''), 500), auth.uid());
end $$;

-- Registrar a mensalidade de um plano fixo (ou um pagamento avulso extra)
create or replace function public.register_payment(p_res uuid, p_competencia date, p_valor numeric, p_forma text, p_obs text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  if not exists (select 1 from public.reservations where id = p_res and status = 'confirmada') then
    raise exception 'Só dá para registrar pagamento de reserva confirmada.';
  end if;
  insert into public.payments (reservation_id, competencia, valor, forma, obs, created_by)
  values (p_res, case when p_competencia is null then null else date_trunc('month', p_competencia)::date end,
          coalesce(p_valor, 0), left(coalesce(p_forma, ''), 40), left(coalesce(p_obs, ''), 500), auth.uid());
exception when unique_violation then
  raise exception 'Esta mensalidade já foi registrada.';
end $$;

-- Reserva criada pela equipe (pedido por WhatsApp, telefone, balcão)
create or replace function public.staff_create_reservation(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rid uuid; cod text; s jsonb; v_room uuid := (p->>'room_id')::uuid; v_status text := coalesce(p->>'status', 'pendente');
begin
  if not public.is_staff() then raise exception 'Sem permissão.'; end if;
  if v_status not in ('pendente','confirmada') then raise exception 'Status inválido.'; end if;
  if coalesce(trim(p->>'nome'), '') = '' then raise exception 'Informe o nome do cliente.'; end if;
  if coalesce(p->>'plano', '') not in ('avulso','pacote','periodo','semanal','quinzenal') then raise exception 'Plano inválido.'; end if;
  if coalesce(p->>'cpf', '') <> '' and not public.cpf_valido(p->>'cpf') then raise exception 'CPF inválido.'; end if;

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

revoke all on function public.register_payment(uuid, date, numeric, text, text) from public, anon;
revoke all on function public.staff_create_reservation(jsonb) from public, anon;
grant execute on function public.register_payment(uuid, date, numeric, text, text) to authenticated;
grant execute on function public.staff_create_reservation(jsonb) to authenticated;
