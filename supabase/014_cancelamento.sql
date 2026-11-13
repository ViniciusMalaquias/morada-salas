-- Morada do Ser · Cancelamento (rode depois do 013)
--  · nova coluna cancelado_em, preenchida sozinha sempre que a reserva vira 'cancelada' (pelo cliente ou pela clínica)
--  · cancel_my_reservation passa a devolver a linha atualizada (o site confirma que gravou) e recusa reservas que já passaram
--  · Realtime ligado em reservations e reservation_slots: o painel atualiza sozinho quando algo muda
--  · o cliente continua SEM permissão de UPDATE direto na tabela; cancelar só pela função (só dono, só para 'cancelada')

-- ========== coluna + gatilho ==========
alter table public.reservations add column if not exists cancelado_em timestamptz;

-- reservas já canceladas: usa a data da decisão como melhor estimativa
update public.reservations set cancelado_em = coalesce(decided_at, created_at)
where status = 'cancelada' and cancelado_em is null;

create or replace function public.marcar_cancelado_em() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status = 'cancelada' and (tg_op = 'INSERT' or old.status is distinct from 'cancelada') then
    new.cancelado_em := coalesce(new.cancelado_em, now());
  elsif new.status <> 'cancelada' then
    new.cancelado_em := null;
  end if;
  return new;
end $$;
revoke all on function public.marcar_cancelado_em() from public, anon, authenticated;

drop trigger if exists marcar_cancelado_em on public.reservations;
create trigger marcar_cancelado_em before insert or update of status on public.reservations
  for each row execute function public.marcar_cancelado_em();

-- ========== cancelamento pelo cliente ==========
-- Mesmas regras do 012 + não cancela o que já passou + devolve a linha atualizada.
-- (o tipo de retorno mudou de void para jsonb, por isso o drop antes)
drop function if exists public.cancel_my_reservation(uuid);
create function public.cancel_my_reservation(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.reservations; v_out public.reservations;
begin
  select * into r from public.reservations where id = p_id and user_id = auth.uid() for update;
  if r.id is null then raise exception 'Reserva não encontrada.'; end if;
  if r.status not in ('pendente','confirmada') then raise exception 'Esta reserva já foi encerrada.'; end if;
  if r.status = 'confirmada' and r.horas_compradas is not null then
    raise exception 'Compra de horas confirmada só pode ser cancelada pela clínica. Fale com a gente pelo WhatsApp.';
  end if;
  -- só reservas futuras: com horários, todos avulsos e todos já começados → não cancela
  if exists (select 1 from public.reservation_slots s where s.reservation_id = r.id)
     and not exists (
       select 1 from public.reservation_slots s
       where s.reservation_id = r.id
         and (s.freq <> 'unica' or (s.data + s.hora_ini * interval '1 hour') at time zone 'America/Sao_Paulo' > now())) then
    raise exception 'Os horários desta reserva já passaram. Fale com a clínica pelo WhatsApp.';
  end if;
  if r.status = 'confirmada' and exists (
      select 1 from public.reservation_slots s
      where s.reservation_id = r.id and s.freq = 'unica'
        and (s.data + s.hora_ini * interval '1 hour') at time zone 'America/Sao_Paulo' between now() and now() + interval '24 hours') then
    raise exception 'Faltam menos de 24 horas para um dos horários. Para cancelar, fale com a clínica pelo WhatsApp.';
  end if;

  update public.reservations
     set status = 'cancelada', cancelado_por = 'cliente', decided_at = now(), cancelado_em = now()
   where id = r.id and user_id = auth.uid() and status in ('pendente','confirmada')
  returning * into v_out;
  if v_out.id is null then raise exception 'Não foi possível cancelar. Atualize a página e tente de novo.'; end if;

  return jsonb_build_object('id', v_out.id, 'status', v_out.status, 'cancelado_em', v_out.cancelado_em,
                            'room_id', v_out.room_id, 'plano', v_out.plano);
end $$;
revoke all on function public.cancel_my_reservation(uuid) from public, anon;
grant execute on function public.cancel_my_reservation(uuid) to authenticated;

-- ========== Realtime (painel atualiza sozinho) ==========
-- O Realtime respeita o RLS: a equipe recebe tudo; cliente só as próprias reservas; visitante nada.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservations') then
      alter publication supabase_realtime add table public.reservations;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reservation_slots') then
      alter publication supabase_realtime add table public.reservation_slots;
    end if;
  else
    raise notice 'Publicação supabase_realtime não encontrada: ligue o Realtime em Database → Publications.';
  end if;
end $$;
