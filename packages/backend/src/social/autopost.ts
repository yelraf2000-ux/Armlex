/**
 * One automatic post: build it, check it, publish it to the Telegram channel,
 * the Facebook Page and Instagram, and report it to the team chat with a 🗑
 * button that deletes it everywhere.
 *
 * Run by the armlex-autopost timer (deploy/), 11 times a week: 4 live answers
 * and 7 "problem → solved" posts. No person approves these (the owner's
 * decision, 2026-09-21), so:
 *   - a live answer is the product's own answer, with the quote cut from the
 *     law by code, and is skipped unless coverage is full and every number is
 *     in the cited article;
 *   - everything else is written by Gemini (the owner's choice), may only
 *     restate `facts.ts`, is proofread by a second Gemini pass, and is refused
 *     on any number outside the facts, a price, a link or an overclaim. After
 *     three refusals the slot is skipped — there is no hand-written fallback.
 *
 * Off unless SOCIAL_AUTOPUBLISH=on. Manual run (`--dry`: to the team chat only):
 *   npx tsx packages/backend/src/social/autopost.ts [demo|problem] [--dry]
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { db } from '../db/pool.js';
import { COOKIE, issue } from '../auth/cookie.js';
import { createWithPassword, findByEmail } from '../auth/users.js';
import { generate } from '../answer/llm.js';
import { validateNumbers } from '../answer/validateNumbers.js';
import { sendToTeam } from '../contact/telegram.js';
import { MEDIA_DIR } from './channel.js';
import { renderDemoCard, demoFits } from './demoCard.js';
import { renderPromoCard, promoFits, type PromoCard } from './promoCard.js';
import { demoParts, type AnswerChunk } from './demoPost.js';
import { ALLOWED_NUMBERS, DEMO_QUESTIONS, FACTS, OVERCLAIMS, PROBLEMS } from './facts.js';
import { publishEverywhere } from './publish.js';
import { reportPublished } from './remove.js';
import { tg } from './bot.js';

export type Kind = 'demo' | 'problem';

/** A week of 11: four live answers, seven problems solved, interleaved. */
export const ROTATION: Kind[] = [
  'demo', 'problem', 'problem', 'demo', 'problem', 'problem', 'demo', 'problem', 'problem', 'demo', 'problem',
];

/** Gemini writes everything but the live answers (owner's decision). */
const PROMO_MODEL = process.env['SOCIAL_PROMO_MODEL'] ?? 'gemini-3.5-flash';
const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'https://matyanai.am';
const CTA = 'Փորձեք անվճար · matyanai.am';
const LABEL = 'Խնդիրը և լուծումը';

const PROMO_SYSTEM = `You write one social-media post, in Armenian, for MatyanAI. The audience: accountants, tax specialists and heads of accounting firms in Armenia.

The post takes ONE everyday problem of an accountant and shows how MatyanAI solves it. You may ONLY use these facts about MatyanAI — no other claims, no numbers that are not in them, no prices:
${FACTS.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Style: professional, calm, concrete — a colleague recommending a tool, not an advert shouting. Correct Armenian grammar, case endings, spelling and punctuation (։ at sentence end). No emojis, no hashtags, no links.

Reply with JSON only:
{"headline": "...", "points": ["...", "...", "..."], "body": "..."}
- headline: the problem, as the accountant feels it; at most 50 characters; may be a question.
- points: exactly three short ways MatyanAI solves it, each at most 60 characters, each restating a fact.
- body: 250-600 characters, 2-3 short paragraphs: the problem, then how MatyanAI solves it.`;

const PROOFREAD_SYSTEM = `You are a meticulous Armenian copy editor. You receive a JSON object with Armenian text. Correct grammar (case endings, agreement), spelling and punctuation only. Do not add, remove or change any claim, number or meaning, and keep each string about the same length. Reply with the same JSON object only.`;

/** Every problem with a generated post, or none. */
export function promoProblems(p: { headline: string; points: string[]; body: string }): string[] {
  const problems: string[] = [];
  const all = [p.headline, ...p.points, p.body].join('\n');
  if (!p.headline || p.headline.length > 60) problems.push('headline length');
  if (p.points.length !== 3 || p.points.some((x) => !x || x.length > 70)) problems.push('points');
  if (p.body.length < 150 || p.body.length > 800) problems.push('body length');
  const numbers = all.match(/\d+/g) ?? [];
  const foreign = numbers.filter((n) => !ALLOWED_NUMBERS.has(n));
  if (foreign.length) problems.push(`numbers not in the facts: ${foreign.join(', ')}`);
  if (OVERCLAIMS.test(all)) problems.push('overclaim');
  if (/https?:|www\.|[֏$€]|դրամ/iu.test(all)) problems.push('link or price');
  return problems;
}

type Promo = { headline: string; points: string[]; body: string };

/** Run a Gemini call and read the JSON object out of its reply. */
async function geminiJson(system: string, user: string): Promise<Promo> {
  let reply = '';
  await generate({ system, history: [], user, onText: (d) => (reply += d) }, PROMO_MODEL);
  const json = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as Partial<Promo>;
  return {
    headline: String(json.headline ?? '').trim(),
    points: (json.points ?? []).map((x) => String(x).trim()),
    body: String(json.body ?? '').trim(),
  };
}

async function problemPost(
  recentTopics: string[],
): Promise<{ card: PromoCard; body: string; topic: string } | { skip: string }> {
  const fresh = PROBLEMS.filter((p) => !recentTopics.includes(`auto:problem:${p}`));
  const problem = (fresh.length ? fresh : PROBLEMS)[Math.floor(Math.random() * (fresh.length || PROBLEMS.length))]!;
  const reasons: string[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const draft = await geminiJson(PROMO_SYSTEM, `The problem: ${problem}`);
      const draftProblems = promoProblems(draft);
      if (draftProblems.length) {
        reasons.push(draftProblems.join(', '));
        continue;
      }
      // Proofread; keep the draft if the edit breaks a rule it had kept.
      let final = draft;
      try {
        const edited = await geminiJson(PROOFREAD_SYSTEM, JSON.stringify(draft));
        if (promoProblems(edited).length === 0) final = edited;
      } catch {
        // proofreading is best effort
      }
      const card = { label: LABEL, headline: final.headline, points: final.points, cta: CTA };
      if (!promoFits(card)) {
        reasons.push('does not fit the card');
        continue;
      }
      return { card, body: `${final.body}\n\nՓորձեք անվճար՝ matyanai.am`, topic: `auto:problem:${problem}` };
    } catch (err) {
      reasons.push((err as Error).message.slice(0, 120));
    }
  }
  return { skip: `«${problem}»: ${reasons.join('; ')}` };
}

/** The internal account the live answers are asked from. Nobody can sign in to it. */
async function botUser(): Promise<{ id: string; session_version: number }> {
  const email = 'social-bot@matyanai.invalid';
  const found = await findByEmail(email);
  if (found) return { id: found.id, session_version: found.session_version ?? 0 };
  const u = await createWithPassword(email, randomBytes(32).toString('hex'), 'MatyanAI · սոց. ցանցեր', {
    companyName: 'MatyanAI',
    companySize: '1-5',
  });
  await db()`UPDATE users SET plan = 'unlimited' WHERE id = ${u.id}`;
  await db()`UPDATE users SET email_verified_at = now() WHERE id = ${u.id}`.catch(() => {});
  return { id: u.id, session_version: u.session_version ?? 0 };
}

/** Ask the running product, exactly as a user would. */
async function askLive(question: string): Promise<{ answer: string; chunks: AnswerChunk[]; coverage: string | null }> {
  const user = await botUser();
  const res = await fetch('http://127.0.0.1:3001/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `${COOKIE}=${issue(user.id, user.session_version)}` },
    body: JSON.stringify({ query: question }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok || !res.body) throw new Error(`chat HTTP ${res.status}`);
  let buf = '';
  let answer = '';
  let done: { freshChunks?: AnswerChunk[]; coverage?: string | null } = {};
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += Buffer.from(part).toString('utf8');
    const frames = buf.split('\n\n');
    buf = frames.pop() ?? '';
    for (const f of frames) {
      const ev = /^event: (.*)$/m.exec(f)?.[1];
      const data = /^data: (.*)$/m.exec(f)?.[1];
      if (!ev || !data) continue;
      const json = JSON.parse(data);
      if (ev === 'delta') answer += json.text;
      if (ev === 'done') done = json;
      if (ev === 'error') throw new Error(`chat error: ${json.error ?? ''} ${json.detail ?? ''}`);
    }
  }
  return { answer, chunks: done.freshChunks ?? [], coverage: done.coverage ?? null };
}

const DEMO_CAPTIONS = [
  (q: string, s: string) =>
    `Հարց՝ «${q}»\n\nMatyanAI-ը պատասխանում է մոտ մեկ րոպեում՝ կոնկրետ հոդվածով, օրենքից բառացի մեջբերումով և ARLIS-ի հղումով։\n\nԱղբյուրը՝ ${s}\n\nՓորձեք Ձեր հարցով՝ matyanai.am`,
  (q: string, s: string) =>
    `«${q}»\n\nՀարց, որ հաշվապահները տալիս են ամեն օր։ MatyanAI-ը գտնում է պատասխանը օրենքի տեքստում և ցույց է տալիս, թե որտեղ է այն գրված։\n\nԱղբյուրը՝ ${s}\n\nՓորձեք անվճար՝ matyanai.am`,
  (q: string, s: string) =>
    `Ստուգեք MatyanAI-ը Ձեր հարցով։\n\nՕրինակ՝ «${q}»։ Պատասխանը՝ հոդվածով և օրենքից մեջբերումով։\n\nԱղբյուրը՝ ${s}\n\nmatyanai.am`,
];

async function demo(recentTopics: string[]): Promise<{ image: Buffer; body: string; topic: string } | { skip: string }> {
  const fresh = DEMO_QUESTIONS.filter((q) => !recentTopics.includes(`auto:demo:${q}`));
  const pool = (fresh.length ? fresh : DEMO_QUESTIONS).slice().sort(() => Math.random() - 0.5);
  const reasons: string[] = [];
  for (const question of pool.slice(0, 3)) {
    const live = await askLive(question);
    if (live.coverage !== 'full') {
      reasons.push(`«${question}»: coverage ${live.coverage}`);
      continue;
    }
    const parts = demoParts(live.answer, live.chunks);
    if ('skip' in parts) {
      reasons.push(`«${question}»: ${parts.skip}`);
      continue;
    }
    const numbers = validateNumbers(parts.lines.join('\n'), [parts.articleText], [question]);
    if (numbers.legalCount > 0 || numbers.otherCount > 0) {
      reasons.push(`«${question}»: numbers not in the article`);
      continue;
    }
    const card = {
      headline: 'Հարց և պատասխան՝ օրենքի հոդվածով',
      question,
      answer: parts.lines,
      source: parts.source,
      quote: parts.quote,
      cta: 'Փորձեք Ձեր հարցով · matyanai.am',
    };
    if (!demoFits(card)) {
      reasons.push(`«${question}»: does not fit the card`);
      continue;
    }
    const caption = DEMO_CAPTIONS[Math.floor(Math.random() * DEMO_CAPTIONS.length)]!(question, parts.source);
    return { image: renderDemoCard(card), body: caption, topic: `auto:demo:${question}` };
  }
  return { skip: reasons.join('; ') };
}

export async function autopost(forced?: Kind, dry = false): Promise<void> {
  const published = await db()<{ topic: string }[]>`
    SELECT topic FROM social_drafts
     WHERE topic LIKE 'auto:%' AND status IN ('published', 'deleted')
     ORDER BY created_at DESC`;
  const kind = forced ?? ROTATION[published.length % ROTATION.length]!;
  const recentTopics = published.slice(0, 30).map((r) => r.topic);

  let image: Buffer;
  let body: string;
  let topic: string;
  let headline: string;
  let model: string;
  if (kind === 'demo') {
    const d = await demo(recentTopics);
    if ('skip' in d) {
      console.log(`skipped: ${d.skip}`);
      await sendToTeam(`Ավտոմատ գրառումը բաց թողնվեց (կենդանի պատասխան)՝ ${d.skip}`);
      return;
    }
    ({ image, body, topic } = d);
    headline = 'Հարց և պատասխան՝ օրենքի հոդվածով';
    model = 'live';
  } else {
    const p = await problemPost(recentTopics);
    if ('skip' in p) {
      console.log(`skipped: ${p.skip}`);
      await sendToTeam(`Ավտոմատ գրառումը բաց թողնվեց (խնդիր → լուծում)՝ ${p.skip}`);
      return;
    }
    image = renderPromoCard(p.card);
    body = p.body;
    topic = p.topic;
    headline = p.card.headline;
    model = PROMO_MODEL;
  }

  const imageName = `${randomUUID()}.jpg`;
  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(join(MEDIA_DIR, imageName), image);

  // A rehearsal: the finished post goes to the team chat only.
  if (dry) {
    await tg('sendPhoto', {
      chat_id: process.env['TELEGRAM_CHAT_ID'],
      photo: `${PUBLIC_URL}/media/${imageName}`,
      caption: `ՓՈՐՁ (չի հրապարակվել)՝ ${kind}\n\n${body}`.slice(0, 1024),
    });
    console.log(`dry run: ${kind} sent to the team chat`);
    return;
  }

  const rows = await db()<{ id: string }[]>`
    INSERT INTO social_drafts (topic, headline, subline, body, source_label, source_url, image_name, model, status, decided_at)
    VALUES (${topic}, ${headline}, '', ${body}, ${kind}, ${PUBLIC_URL}, ${imageName}, ${model}, 'publishing', now())
    RETURNING id`;
  const id = rows[0]!.id;
  const result = await publishEverywhere(body, imageName);
  const ok = [result.telegram, result.facebook, result.instagram].some((r) => r.id);
  await db()`
    UPDATE social_drafts SET status = ${ok ? 'published' : 'failed'}, results = ${db().json(result as never)}
     WHERE id = ${id}`;
  await reportPublished(id, `Ավտոմատ գրառում (${kind === 'demo' ? 'կենդանի պատասխան' : 'խնդիր → լուծում'})`, result);
}

// Run directly (the timer, or by hand).
if (process.argv[1]?.endsWith('autopost.ts')) {
  const dry = process.argv.includes('--dry');
  const forced = process.argv.slice(2).find((a) => !a.startsWith('--')) as Kind | undefined;
  if (!dry && process.env['SOCIAL_AUTOPUBLISH'] !== 'on') {
    console.log('SOCIAL_AUTOPUBLISH is not "on" — nothing posted');
    process.exit(0);
  }
  autopost(forced && (ROTATION as string[]).includes(forced) ? forced : undefined, dry)
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await sendToTeam(`Ավտոմատ գրառումը ձախողվեց՝ ${(err as Error).message}`).catch(() => {});
      process.exit(1);
    });
}
