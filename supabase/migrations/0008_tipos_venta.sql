-- ============================================================================
-- Tipos de Venta: Sin/Con Factura, con variante QR, más Mayorista.
-- Ver docs/superpowers/specs/2026-07-02-tipos-venta-design.md
-- ============================================================================

alter table sales add column sale_type text not null default 'sin_factura'
  check (sale_type in ('sin_factura', 'con_factura', 'sin_factura_qr', 'con_factura_qr', 'mayorista'));
