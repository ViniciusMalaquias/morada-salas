-- Morada do Ser · Locação de salas
-- Rode este arquivo inteiro no SQL Editor do Supabase (uma vez).

-- 1) Textos e configurações da página (chave → valor JSON)
create table if not exists public.site_content (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- 2) Salas
create table if not exists public.rooms (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text not null default '',
  features    text[] not null default '{}',
  sort        int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- 3) Fotos das salas (arquivo fica no Storage, aqui só o caminho)
create table if not exists public.room_photos (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id) on delete cascade,
  path       text not null,
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists room_photos_room_idx on public.room_photos(room_id, sort);

-- Segurança: qualquer pessoa LÊ, só usuários logados (a equipe da clínica) ESCREVEM
alter table public.site_content enable row level security;
alter table public.rooms        enable row level security;
alter table public.room_photos  enable row level security;

drop policy if exists "leitura publica" on public.site_content;
drop policy if exists "equipe edita"    on public.site_content;
create policy "leitura publica" on public.site_content for select using (true);
create policy "equipe edita"    on public.site_content for all to authenticated using (true) with check (true);

drop policy if exists "leitura publica" on public.rooms;
drop policy if exists "equipe edita"    on public.rooms;
create policy "leitura publica" on public.rooms for select using (active or auth.role() = 'authenticated');
create policy "equipe edita"    on public.rooms for all to authenticated using (true) with check (true);

drop policy if exists "leitura publica" on public.room_photos;
drop policy if exists "equipe edita"    on public.room_photos;
create policy "leitura publica" on public.room_photos for select using (true);
create policy "equipe edita"    on public.room_photos for all to authenticated using (true) with check (true);

-- Storage: bucket público "fotos"
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "fotos leitura publica" on storage.objects;
drop policy if exists "fotos equipe lista"    on storage.objects;
drop policy if exists "fotos equipe envia"    on storage.objects;
drop policy if exists "fotos equipe altera"   on storage.objects;
drop policy if exists "fotos equipe apaga"    on storage.objects;
-- bucket público: as URLs das fotos abrem sem policy; listar arquivos fica só para a equipe
create policy "fotos equipe lista"    on storage.objects for select to authenticated using (bucket_id = 'fotos');
create policy "fotos equipe envia"    on storage.objects for insert to authenticated with check (bucket_id = 'fotos');
create policy "fotos equipe altera"   on storage.objects for update to authenticated using (bucket_id = 'fotos');
create policy "fotos equipe apaga"    on storage.objects for delete to authenticated using (bucket_id = 'fotos');
