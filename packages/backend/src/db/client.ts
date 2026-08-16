import postgres from 'postgres';
import { config } from '@armlex/shared';

export const sql = postgres(config.databaseUrl, {
  max: 10,
  onnotice: () => {},
});

export type Sql = typeof sql;
