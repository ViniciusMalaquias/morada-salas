-- Morada do Ser · E-mails para o cliente: pré-reserva recebida, confirmação e lembrete na véspera
-- (rode depois do 008). Precisa da Edge Function "email-cliente" e dos segredos do Gmail.
create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table public.reservations
  add column if not exists email_pedido_em timestamptz,
  add column if not exists email_confirmada_em timestamptz;

create table if not exists public.lembretes_enviados (
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  data           date not null,
  enviado_em     timestamptz not null default now(),
  primary key (reservation_id, data)
);
alter table public.lembretes_enviados enable row level security;  -- só a função (chave de serviço) usa

-- Atendimentos confirmados que começam nas próximas 24h e ainda não receberam lembrete.
-- Só lembra quem foi confirmado com mais de 24h de antecedência (os outros acabaram de receber a confirmação).
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
    and ((d::date + make_interval(hours => s.hora_ini)) at time zone 'America/Sao_Paulo') between now() and now() + interval '24 hours'
    and coalesce(r.decided_at, r.created_at) < ((d::date + make_interval(hours => s.hora_ini)) at time zone 'America/Sao_Paulo') - interval '24 hours'
    and not exists (select 1 from public.lembretes_enviados l where l.reservation_id = r.id and l.data = d::date)
$$;
revoke all on function public.lembretes_pendentes() from public, anon, authenticated;

-- Dispara os e-mails ao cliente
create or replace function public.email_cliente_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tipo text;
begin
  if new.plano = 'bloqueio' or coalesce(new.email, '') = '' then return new; end if;
  if tg_op = 'INSERT' and new.aceite_em is not null then v_tipo := 'pedido';
  elsif tg_op = 'INSERT' and new.status = 'confirmada' then v_tipo := 'confirmada';
  elsif tg_op = 'UPDATE' and old.status = 'pendente' and new.status = 'confirmada' then v_tipo := 'confirmada';
  end if;
  if v_tipo is not null then
    perform net.http_post(
      url := 'https://zfkfjbjvmnjycjoprxqi.supabase.co/functions/v1/email-cliente',
      body := jsonb_build_object('tipo', v_tipo, 'id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 15000);
  end if;
  return new;
end $$;
revoke all on function public.email_cliente_gatilho() from public, anon, authenticated;

create trigger email_cliente_insert after insert on public.reservations
  for each row execute function public.email_cliente_gatilho();
create trigger email_cliente_update after update of status on public.reservations
  for each row execute function public.email_cliente_gatilho();

-- Lembretes: de hora em hora, aos 5 minutos
select cron.schedule('lembretes-reservas', '5 * * * *', $cron$
  select net.http_post(
    url := 'https://zfkfjbjvmnjycjoprxqi.supabase.co/functions/v1/email-cliente',
    body := '{"tipo":"lembretes"}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000)
$cron$);
