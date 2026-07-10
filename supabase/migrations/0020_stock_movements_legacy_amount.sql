-- supabase/migrations/0020_stock_movements_legacy_amount.sql
-- El histórico legacy (historico_movimiento) no guarda sale_id/return_id
-- confiable (id_detalle_venta e id_devolucion vienen NULL en el 100% de las
-- 90k filas del dump real), así que los movimientos de venta/devolución
-- migrados desde ahí no pueden calcular su monto vía join con sale_items/
-- sale_returns como hace un movimiento creado en vivo por la app. El legacy
-- sí guardaba el monto inline (venta_cf/venta_sf/venta_may/devolucion), así
-- que lo preservamos acá como fallback de solo lectura.

alter table stock_movements add column legacy_amount_bs numeric;
alter table stock_movements add column legacy_price_tier text
  check (legacy_price_tier in ('sf', 'cf', 'may'));
