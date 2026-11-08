-- Выполните целиком в Supabase → SQL Editor → New query → Run.

-- Таблица с видео пользователей
create table if not exists public.videos (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null,
  source_url  text,
  path        text not null,
  size        bigint,
  created_at  timestamptz not null default now()
);

alter table public.videos enable row level security;

create policy "videos: читать свои"   on public.videos for select using (auth.uid() = user_id);
create policy "videos: добавлять свои" on public.videos for insert with check (auth.uid() = user_id);
create policy "videos: удалять свои"  on public.videos for delete using (auth.uid() = user_id);

-- Закрытое хранилище (лимит 50 МБ на файл — максимум бесплатного тарифа)
insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', false, 52428800)
on conflict (id) do nothing;

-- Каждый пользователь видит и меняет только файлы в своей папке <user_id>/...
create policy "files: читать свои" on storage.objects for select
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "files: загружать свои" on storage.objects for insert
  with check (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "files: удалять свои" on storage.objects for delete
  using (bucket_id = 'videos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Удаление собственного аккаунта (кнопка «Удалить аккаунт и все данные»).
-- Файлы из хранилища приложение удаляет само перед вызовом; строки videos удаляются каскадом.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
