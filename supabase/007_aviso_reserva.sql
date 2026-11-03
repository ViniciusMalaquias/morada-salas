-- Morada do Ser · Aviso por e-mail para a clínica a cada nova pré-reserva (rode depois do 006)
-- Precisa da Edge Function "avisar-reserva" publicada e dos segredos GMAIL_USER e GMAIL_APP_PASSWORD.
create extension if not exists pg_net;

alter table public.reservations add column if not exists avisado_em timestamptz;

create or replace function public.avisar_nova_reserva() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- só pré-reservas feitas pelo site (as criadas pela equipe não têm aceite)
  if new.aceite_em is not null then
    perform net.http_post(
      url := 'https://zfkfjbjvmnjycjoprxqi.supabase.co/functions/v1/avisar-reserva',
      body := jsonb_build_object('id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 10000
    );
  end if;
  return new;
end $$;

drop trigger if exists avisar_nova_reserva on public.reservations;
create trigger avisar_nova_reserva after insert on public.reservations
  for each row execute function public.avisar_nova_reserva();

revoke all on function public.avisar_nova_reserva() from public, anon, authenticated;
