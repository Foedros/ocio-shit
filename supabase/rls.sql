-- ════════════════════════════════════════════════════════════════════════════
-- Ocio Shit — Row Level Security (Supabase) · Sprint A · GATE DE SEGURIDAD
-- tecnico.md §3.2.sec — causa #1 de fugas. Ejecutar DESPUÉS de schema.sql.
--
-- Modelo: archivo de UN solo usuario. Patrón canónico a prueba de fallos:
--   · RLS ENABLE explícito en TODAS las tablas (crear por SQL NO lo activa solo).
--   · Una política POR COMANDO (select/insert/update/delete) con owner_id = auth.uid().
--   · NUNCA USING (true)  (equivale a no tener RLS).
--   · INSERT/UPDATE además con WITH CHECK (impide escribir filas de otro owner).
--
-- La clave `sb_secret_` (service_role) BYPASSA RLS por diseño → solo se usa en la carga
-- inicial LOCAL (scripts/, .env gitignored), jamás en el frontend. El frontend lleva SOLO
-- `sb_publishable_` (rol anon/authenticated), que SÍ está sujeto a estas políticas.
--
-- VERIFICACIÓN (no con el SQL Editor, que bypassa RLS): con la publishable real y SIN
-- autenticar, SELECT/POST a cada tabla → vacío/403. Ver scripts/supabase-security-check.mjs.
-- ════════════════════════════════════════════════════════════════════════════

-- meta
alter table meta enable row level security;
create policy meta_sel on meta for select using (owner_id = auth.uid());
create policy meta_ins on meta for insert with check (owner_id = auth.uid());
create policy meta_upd on meta for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy meta_del on meta for delete using (owner_id = auth.uid());

-- plataforma
alter table plataforma enable row level security;
create policy plataforma_sel on plataforma for select using (owner_id = auth.uid());
create policy plataforma_ins on plataforma for insert with check (owner_id = auth.uid());
create policy plataforma_upd on plataforma for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy plataforma_del on plataforma for delete using (owner_id = auth.uid());

-- persona
alter table persona enable row level security;
create policy persona_sel on persona for select using (owner_id = auth.uid());
create policy persona_ins on persona for insert with check (owner_id = auth.uid());
create policy persona_upd on persona for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy persona_del on persona for delete using (owner_id = auth.uid());

-- etapa
alter table etapa enable row level security;
create policy etapa_sel on etapa for select using (owner_id = auth.uid());
create policy etapa_ins on etapa for insert with check (owner_id = auth.uid());
create policy etapa_upd on etapa for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy etapa_del on etapa for delete using (owner_id = auth.uid());

-- obra
alter table obra enable row level security;
create policy obra_sel on obra for select using (owner_id = auth.uid());
create policy obra_ins on obra for insert with check (owner_id = auth.uid());
create policy obra_upd on obra for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy obra_del on obra for delete using (owner_id = auth.uid());

-- entrada
alter table entrada enable row level security;
create policy entrada_sel on entrada for select using (owner_id = auth.uid());
create policy entrada_ins on entrada for insert with check (owner_id = auth.uid());
create policy entrada_upd on entrada for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy entrada_del on entrada for delete using (owner_id = auth.uid());

-- etiqueta
alter table etiqueta enable row level security;
create policy etiqueta_sel on etiqueta for select using (owner_id = auth.uid());
create policy etiqueta_ins on etiqueta for insert with check (owner_id = auth.uid());
create policy etiqueta_upd on etiqueta for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy etiqueta_del on etiqueta for delete using (owner_id = auth.uid());

-- coleccion
alter table coleccion enable row level security;
create policy coleccion_sel on coleccion for select using (owner_id = auth.uid());
create policy coleccion_ins on coleccion for insert with check (owner_id = auth.uid());
create policy coleccion_upd on coleccion for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy coleccion_del on coleccion for delete using (owner_id = auth.uid());

-- pool_ocio (La Indecisión, §11.63)
alter table pool_ocio enable row level security;
create policy pool_ocio_sel on pool_ocio for select using (owner_id = auth.uid());
create policy pool_ocio_ins on pool_ocio for insert with check (owner_id = auth.uid());
create policy pool_ocio_upd on pool_ocio for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pool_ocio_del on pool_ocio for delete using (owner_id = auth.uid());

-- logro
alter table logro enable row level security;
create policy logro_sel on logro for select using (owner_id = auth.uid());
create policy logro_ins on logro for insert with check (owner_id = auth.uid());
create policy logro_upd on logro for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy logro_del on logro for delete using (owner_id = auth.uid());

-- logro_desbloqueado
alter table logro_desbloqueado enable row level security;
create policy logro_desbloqueado_sel on logro_desbloqueado for select using (owner_id = auth.uid());
create policy logro_desbloqueado_ins on logro_desbloqueado for insert with check (owner_id = auth.uid());
create policy logro_desbloqueado_upd on logro_desbloqueado for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy logro_desbloqueado_del on logro_desbloqueado for delete using (owner_id = auth.uid());

-- momento_canon
alter table momento_canon enable row level security;
create policy momento_canon_sel on momento_canon for select using (owner_id = auth.uid());
create policy momento_canon_ins on momento_canon for insert with check (owner_id = auth.uid());
create policy momento_canon_upd on momento_canon for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy momento_canon_del on momento_canon for delete using (owner_id = auth.uid());

-- titulo
alter table titulo enable row level security;
create policy titulo_sel on titulo for select using (owner_id = auth.uid());
create policy titulo_ins on titulo for insert with check (owner_id = auth.uid());
create policy titulo_upd on titulo for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy titulo_del on titulo for delete using (owner_id = auth.uid());

-- titulo_desbloqueado
alter table titulo_desbloqueado enable row level security;
create policy titulo_desbloqueado_sel on titulo_desbloqueado for select using (owner_id = auth.uid());
create policy titulo_desbloqueado_ins on titulo_desbloqueado for insert with check (owner_id = auth.uid());
create policy titulo_desbloqueado_upd on titulo_desbloqueado for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy titulo_desbloqueado_del on titulo_desbloqueado for delete using (owner_id = auth.uid());

-- perfil_usuario
alter table perfil_usuario enable row level security;
create policy perfil_usuario_sel on perfil_usuario for select using (owner_id = auth.uid());
create policy perfil_usuario_ins on perfil_usuario for insert with check (owner_id = auth.uid());
create policy perfil_usuario_upd on perfil_usuario for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy perfil_usuario_del on perfil_usuario for delete using (owner_id = auth.uid());

-- obra_etiqueta
alter table obra_etiqueta enable row level security;
create policy obra_etiqueta_sel on obra_etiqueta for select using (owner_id = auth.uid());
create policy obra_etiqueta_ins on obra_etiqueta for insert with check (owner_id = auth.uid());
create policy obra_etiqueta_upd on obra_etiqueta for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy obra_etiqueta_del on obra_etiqueta for delete using (owner_id = auth.uid());

-- entrada_etiqueta
alter table entrada_etiqueta enable row level security;
create policy entrada_etiqueta_sel on entrada_etiqueta for select using (owner_id = auth.uid());
create policy entrada_etiqueta_ins on entrada_etiqueta for insert with check (owner_id = auth.uid());
create policy entrada_etiqueta_upd on entrada_etiqueta for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy entrada_etiqueta_del on entrada_etiqueta for delete using (owner_id = auth.uid());

-- obra_coleccion
alter table obra_coleccion enable row level security;
create policy obra_coleccion_sel on obra_coleccion for select using (owner_id = auth.uid());
create policy obra_coleccion_ins on obra_coleccion for insert with check (owner_id = auth.uid());
create policy obra_coleccion_upd on obra_coleccion for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy obra_coleccion_del on obra_coleccion for delete using (owner_id = auth.uid());

-- entrada_acompanante
alter table entrada_acompanante enable row level security;
create policy entrada_acompanante_sel on entrada_acompanante for select using (owner_id = auth.uid());
create policy entrada_acompanante_ins on entrada_acompanante for insert with check (owner_id = auth.uid());
create policy entrada_acompanante_upd on entrada_acompanante for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy entrada_acompanante_del on entrada_acompanante for delete using (owner_id = auth.uid());

-- obra_creador
alter table obra_creador enable row level security;
create policy obra_creador_sel on obra_creador for select using (owner_id = auth.uid());
create policy obra_creador_ins on obra_creador for insert with check (owner_id = auth.uid());
create policy obra_creador_upd on obra_creador for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy obra_creador_del on obra_creador for delete using (owner_id = auth.uid());

-- ── Endurecimiento de funciones expuestas (Security Advisor) ────────────────
-- Si existe el event-trigger `rls_auto_enable` (safeguard de "auto-activar RLS en tablas
-- nuevas", añadido FUERA de esta migración), revocar su EXECUTE de los roles públicos: como
-- event trigger se dispara solo en DDL, NO debe ser llamable vía API (/rest/v1/rpc). El Advisor
-- lo marca por ser SECURITY DEFINER ejecutable por anon/authenticated. Idempotente y opcional.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;
