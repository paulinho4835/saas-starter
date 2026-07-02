-- ============================================================================
-- Permisos de módulo por usuario (override de visibilidad sobre el rol).
-- Ver docs/superpowers/specs/2026-07-01-usuarios-permisos-design.md
-- ============================================================================

alter table profiles
  add column allowed_modules jsonb null;

comment on column profiles.allowed_modules is
  'null = usa el whitelist de módulos del rol tal cual. Array de FeatureKey/ReservedFeatureKey = restringe la visibilidad de módulos para este usuario, siempre intersectado con lo que su rol y los feature flags de la organización ya permiten.';
