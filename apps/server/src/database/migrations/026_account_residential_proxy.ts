import { sql, type Kysely } from 'kysely';
import type { Database } from '../schema.js';

export async function up(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table account_operational_profiles
      add column residential_proxy_sid text,
      add column residential_proxy_country text,
      add column residential_proxy_asn text,
      add column residential_proxy_state text,
      add column residential_proxy_city text,
      add constraint account_operational_profiles_residential_proxy_complete check (
        (residential_proxy_sid is null and residential_proxy_country is null and residential_proxy_asn is null
          and residential_proxy_state is null and residential_proxy_city is null)
        or (residential_proxy_sid is not null and residential_proxy_country is not null)
      )
  `.execute(db);
}

export async function down(db: Kysely<Database>): Promise<void> {
  await sql`
    alter table account_operational_profiles
      drop constraint if exists account_operational_profiles_residential_proxy_complete,
      drop column if exists residential_proxy_sid,
      drop column if exists residential_proxy_country,
      drop column if exists residential_proxy_asn,
      drop column if exists residential_proxy_state,
      drop column if exists residential_proxy_city
  `.execute(db);
}
