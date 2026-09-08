/**
 * A guard against SQL template literals that lost their interpolations.
 *
 * Written after a real one reached production. An edit to `upsertGoogleUser`
 * stripped every `${...}` out of two queries, leaving:
 *
 *     SET google_sub = ,
 *     VALUES (, , , now())
 *
 * Nothing caught it. TypeScript is happy — a template literal with no
 * interpolations is still a perfectly valid string — and no unit test touches
 * a database, so the first thing to notice was Postgres, at the moment a real
 * person tried to sign in with Google: `42601 syntax error at or near ","`.
 *
 * This is a text check rather than a type check because the defect is textual:
 * the type system cannot tell a query that MEANT to interpolate from one that
 * did not. It costs milliseconds and needs no database, which is the whole
 * reason it can run on every commit.
 *
 * Run: npx tsx --test packages/backend/src/db/sql-shape.test.ts
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [full] : [];
  });
}

/*
 * Each pattern is a place a value was clearly meant to go and did not. They
 * are deliberately narrow — `(,` and `= ,` and `, ,` do not occur in
 * well-formed SQL, so a match is a defect rather than a style opinion.
 */
const HOLES: [string, RegExp][] = [
  ['assignment with no value', /=\s*,/],
  ['empty leading value in a list', /\(\s*,/],
  ['consecutive empty values', /,\s*,/],
  ['trailing empty value', /,\s*\)/],
];

describe('no SQL template literal has lost its interpolations', () => {
  for (const file of tsFiles(SRC)) {
    const source = readFileSync(file, 'utf8');

    // Only the tagged template bodies, so ordinary TypeScript — object
    // literals, call signatures, array destructuring — is never examined.
    const templates = source.match(/`[^`]*`/g) ?? [];
    const sqlish = templates.filter((t) =>
      /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(t),
    );
    if (sqlish.length === 0) continue;

    test(relative(SRC, file), () => {
      for (const query of sqlish) {
        // Strip line comments first: prose inside a query legitimately
        // contains commas, and one of ours ends "... never landed."
        const body = query.replace(/--[^\n]*/g, '');
        for (const [label, pattern] of HOLES) {
          assert.ok(
            !pattern.test(body),
            `${label} in:\n${query.trim().slice(0, 240)}`,
          );
        }
      }
    });
  }
});
