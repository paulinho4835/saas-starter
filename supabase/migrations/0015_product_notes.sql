-- supabase/migrations/0015_product_notes.sql
-- Nota libre por producto (ej. "En almacén hay 2 docenas"), visible de solo
-- lectura en Ventas y editable desde Productos. Ver
-- docs/superpowers/specs/2026-07-07-ventas-legacy-replica-design.md

alter table products add column notes text;
