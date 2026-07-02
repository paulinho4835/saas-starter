alter table customers add column nit text;

create unique index customers_org_nit_idx on customers (org_id, lower(nit))
  where nit is not null and nit <> '';
