-- Seed de desarrollo local (lo ejecuta `supabase db reset` y el arranque en frío).
--
-- Deja SIEMPRE un login funcionando tras un reset:
--   correo:      admin@gmail.com
--   contraseña:  admin123
--
-- Crea: organización demo (con todos los módulos opt-in habilitados), una
-- sucursal demo, el usuario admin en auth.users + su identidad de email, su
-- profile (rol admin) y lo marca como operador de plataforma (superadmin).
--
-- NOTA: los productos NO se siembran aquí (se importan desde la UI). Si un
-- reset borra el catálogo, re-importa el Excel de productos desde /productos.

-- Idempotente: si ya existe el usuario, no duplica.
do $$
declare
  v_org_id   uuid := '00000000-0000-0000-0000-000000000001';
  v_branch_id uuid := '00000000-0000-0000-0000-0000000000b1';
  v_user_id  uuid := '11111111-1111-1111-1111-111111111111';
begin
  -- 1) Organización demo con todos los addons opt-in encendidos.
  insert into organizations (id, name, features, active)
  values (
    v_org_id,
    'Organización Demo',
    '{
      "items": true,
      "productos": true,
      "proveedores": true,
      "ventas": true,
      "ajuste_inventario": true,
      "movimientos_producto": true,
      "reporte_ventas": true,
      "devoluciones": true,
      "almacen": true,
      "auditoria": true
    }'::jsonb,
    true
  )
  on conflict (id) do update set features = excluded.features;

  -- 2) Sucursal demo (para Ventas / stock).
  insert into branches (id, org_id, name)
  values (v_branch_id, v_org_id, 'Sucursal Central')
  on conflict (id) do nothing;

  -- 2b) Sucursal-almacén demo (depósito central).
  insert into branches (id, org_id, name, is_warehouse)
  values ('00000000-0000-0000-0000-0000000000b2', v_org_id, 'Almacén Central', true)
  on conflict (id) do update set is_warehouse = true;

  -- 3) Usuario admin en auth.users (contraseña: admin123).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    'admin@gmail.com',
    crypt('admin123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    '', '', '', ''
  )
  on conflict (id) do nothing;

  -- 4) Identidad de email (GoTrue la exige para login por correo).
  insert into auth.identities (
    id, provider_id, user_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  )
  values (
    gen_random_uuid(),
    v_user_id::text,
    v_user_id,
    format('{"sub":"%s","email":"admin@gmail.com","email_verified":true}', v_user_id)::jsonb,
    'email',
    now(), now(), now()
  )
  on conflict (provider, provider_id) do nothing;

  -- 5) Profile admin, ligado a la sucursal demo.
  insert into profiles (
    id, org_id, full_name, role, active, branch_id,
    terms_accepted_at, terms_accepted_version
  )
  values (
    v_user_id, v_org_id, 'Admin Demo', 'admin', true, v_branch_id,
    now(), '2026-01-01'
  )
  on conflict (id) do nothing;

  -- 6) Operador de plataforma (superadmin) para ver /superadmin.
  insert into platform_admins (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;
end $$;
