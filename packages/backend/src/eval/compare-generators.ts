/**
 * Head-to-head: which model should write the answer?
 *
 * Identical system prompt, identical retrieved articles, identical question —
 * the only variable is the generator. Everything that can be scored mechanically
 * is scored mechanically:
 *
 *   invalid quotes  — run through the SAME validator that ships, so a model that
 *                     paraphrases the law inside « » is caught rather than
 *                     admired for fluency
 *   coverage        — did it declare full/partial/none, and honestly?
 *   language        — did it answer in the language it was asked in?
 *   latency, tokens — what it costs to run
 *
 * What this cannot score is whether the Armenian reads like a lawyer wrote it.
 * That needs a native speaker, and the answers are printed in full for exactly
 * that reason.
 *
 * Usage: npx tsx packages/backend/src/eval/compare-generators.ts
 */
import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM } from '../answer/chat.js';
import { retrieve, closeRetrieval } from '../retrieval/retrieve.js';
import { validateQuotes } from '../answer/validateQuotes.js';
import { CoverageParser } from '../answer/coverage.js';
import { answerLanguage } from '../answer/language.js';

const QUESTIONS = [
  'В какие сроки нужно подавать декларацию по налогу с оборота?',
  'ես բուդկա եմ ուզում բացել',
  'Нужно ли платить НДС при импорте товаров?', // known retrieval miss — tests honesty
];

/** Same shape the live chat builds, so the comparison is not against a toy. */
function buildUserContent(message: string, chunks: { ref: string; text: string; documentTitle: string }[]): string {
  return [
    `User message: ${message}`,
    `\n\nANSWER LANGUAGE: ${answerLanguage(message) === 'ru' ? 'RUSSIAN' : 'ARMENIAN'}.`,
    ' Write the entire answer in that language, including the closing',
    ' disclaimer. Verbatim quotes of the law stay Armenian regardless.',
    `\n\nLegal act fragments:\n\n${chunks.map((c) => c.text).join('\n\n---\n\n')}`,
  ].join('');
}

interface Result {
  model: string;
  ms: number;
  outChars: number;
  coverage: string | null;
  invalidQuotes: number;
  rejected: string[];
  answeredIn: 'ru' | 'hy' | 'other';
  text: string;
}

function scoreLanguage(text: string): 'ru' | 'hy' | 'other' {
  const cyr = (text.match(/[Ѐ-ӿ]/g) ?? []).length;
  const arm = (text.match(/[԰-֏]/g) ?? []).length;
  if (cyr === 0 && arm === 0) return 'other';
  return cyr > arm ? 'ru' : 'hy';
}

function score(model: string, ms: number, raw: string, chunkTexts: string[]): Result {
  const cov = new CoverageParser();
  const body = cov.feed(raw) + cov.flush();
  const check = validateQuotes(body, chunkTexts);
  return {
    model,
    ms,
    outChars: body.length,
    coverage: cov.coverage,
    invalidQuotes: check.invalidCount,
    rejected: check.checks.filter((c) => !c.valid).map((c) => c.quote.slice(0, 90)),
    answeredIn: scoreLanguage(body),
    text: body,
  };
}

async function runClaude(model: string, user: string): Promise<{ ms: number; raw: string }> {
  const client = new Anthropic();
  const t0 = Date.now();
  const res = await client.messages.create({
    model,
    max_tokens: 4000,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
  });
  const raw = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return { ms: Date.now() - t0, raw };
}

async function runGemini(model: string, user: string): Promise<{ ms: number; raw: string }> {
  const t0 = Date.now();
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env['GEMINI_API_KEY']}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 4000, temperature: 1 },
      }),
    },
  );
  if (!res.ok) throw new Error(`${model}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  return { ms: Date.now() - t0, raw };
}

async function main(): Promise<void> {
  const contenders = [
    { name: 'claude-sonnet-5', run: runClaude },
    { name: 'gemini-3.5-flash', run: runGemini },
    { name: 'gemini-3.5-flash-lite', run: runGemini },
  ];

  const all: Result[] = [];

  for (const question of QUESTIONS) {
    // Retrieve ONCE per question: every model must answer from the same
    // articles, or the comparison measures retrieval luck instead of the model.
    const chunks = await retrieve(question, 4);
    const chunkTexts = chunks.map((c) => c.text);
    const user = buildUserContent(question, chunks);

    console.log(`\n${'='.repeat(78)}\nQ: ${question}`);
    console.log(`articles: ${chunks.map((c) => `${c.arlisId}#${c.ref}`).join(' | ')}`);

    for (const c of contenders) {
      try {
        const { ms, raw } = await c.run(c.name, user);
        const r = score(c.name, ms, raw, chunkTexts);
        all.push(r);
        console.log(
          `\n--- ${r.model} — ${(r.ms / 1000).toFixed(1)}s, ${r.outChars} chars, ` +
            `coverage=${r.coverage}, lang=${r.answeredIn}, invalidQuotes=${r.invalidQuotes}`,
        );
        for (const q of r.rejected) console.log(`      rejected: ${q}`);
        console.log(r.text);
      } catch (err) {
        console.log(`\n--- ${c.name} FAILED: ${String(err).slice(0, 180)}`);
      }
    }
  }

  console.log(`\n${'='.repeat(78)}\nSUMMARY\n`);
  console.log('model                   avg s   avg chars   bad quotes   wrong lang');
  for (const name of contenders.map((c) => c.name)) {
    const rs = all.filter((r) => r.model === name);
    if (rs.length === 0) continue;
    const avg = (f: (r: Result) => number): string =>
      (rs.reduce((s, r) => s + f(r), 0) / rs.length).toFixed(1);
    const badQuotes = rs.reduce((s, r) => s + r.invalidQuotes, 0);
    const wrongLang = rs.filter(
      (r, i) => r.answeredIn !== (answerLanguage(QUESTIONS[i]!) as string),
    ).length;
    console.log(
      `${name.padEnd(24)}${avg((r) => r.ms / 1000).padStart(5)}${avg((r) => r.outChars).padStart(12)}` +
        `${String(badQuotes).padStart(13)}${String(wrongLang).padStart(13)}`,
    );
  }

  await closeRetrieval();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
