/**
 * One automatic post: build it, check it, publish it to the Telegram channel,
 * the Facebook Page and Instagram, and tell the team chat what went out.
 *
 * Run by the armlex-autopost timer (deploy/), 11 times a week. No person
 * approves these (the owner's decision, 2026-09-21), so everything a post says
 * is either the product's own live answer with a quote cut from the law by
 * code, or a rephrasing of `facts.ts`. A post that fails a check is not
 * published; the team chat is told why.
 *
 * Off unless SOCIAL_AUTOPUBLISH=on. Manual run:
 *   npx tsx packages/backend/src/social/autopost.ts [demo|feature|problem|offer|difference]
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
import { ALLOWED_NUMBERS, DEMO_QUESTIONS, FACTS, OVERCLAIMS } from './facts.js';
import { publishEverywhere, type Published } from './publish.js';
import { DRAFT_MODEL } from './draft.js';

export type Kind = 'demo' | 'feature' | 'problem' | 'offer' | 'difference';

/** A week of 11: four live answers, four features, one each of the rest. */
export const ROTATION: Kind[] = [
  'demo', 'feature', 'demo', 'problem', 'feature', 'demo', 'offer', 'feature', 'demo', 'difference', 'feature',
];

const LABELS: Record<Exclude<Kind, 'demo'>, string> = {
  feature: 'Ինչու MatyanAI',
  problem: 'Խնդիրը և լուծումը',
  offer: 'Անվճար փաթեթ',
  difference: 'Ոչ թե պարզապես չաթբոտ',
};

const BRIEF: Record<Exclude<Kind, 'demo'>, string> = {
  feature: 'Pick ONE fact and build the post around that single benefit.',
  problem:
    'Open with a real pain of an accountant (hunting through ARLIS, comparing amended versions, not knowing which article applies), then show how the facts solve it.',
  offer: 'Invite them to register free: the free plan and the team rule, from the facts, nothing more.',
  difference:
    'Contrast with a general-purpose AI chatbot WITHOUT naming any product: MatyanAI answers only from the law text, cites the article, and says so when the law does not answer. Never claim the other is always wrong.',
};

const PROMO_SYSTEM = `You write one promotional social-media post, in Armenian, for MatyanAI. The audience: accountants, tax specialists and heads of accounting firms in Armenia.

You may ONLY restate these facts — no other claims about the product, no numbers that are not in them, no prices:
${FACTS.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Style: professional, calm, concrete; a colleague recommending a tool, not an advert shouting. Correct Armenian spelling and punctuation (։ at sentence end). No emojis, no hashtags, no links.

Reply with JSON only:
{"headline": "...", "points": ["...", "...", "..."], "body": "..."}
- headline: at most 50 characters.
- points: exactly three, each at most 60 characters.
- body: 250-600 characters, 2-3 short paragraphs.`;

/** Hand-written, true, and used when generation fails every check. */
const FALLBACKS: Record<Exclude<Kind, 'demo'>, Omit<PromoCard, 'label' | 'cta'> & { body: string }> = {
  feature: {
    headline: 'Պատասխան, որը կարող եք ստուգել',
    points: [
      'Յուրաքանչյուր պատասխան՝ ակտով և հոդվածով',
      'Մեջբերումները բառացի են և ստուգվում են ծրագրով',
      'Հղում ARLIS-ի պաշտոնական տեքստին',
    ],
    body: 'Հարկային կամ աշխատանքային հարցի պատասխանը քիչ արժե, եթե չգիտեք՝ որտեղից է այն։\n\nMatyanAI-ի յուրաքանչյուր պատասխան հղում է կոնկրետ ակտին և հոդվածին, իսկ օրենքից մեջբերումները բառացի են և ստուգվում են ծրագրով։ Մեկ սեղմումով բացում եք հոդվածը ARLIS-ում։',
  },
  problem: {
    headline: 'ARLIS-ը թերթելու փոխարեն՝ մեկ հարց',
    points: [
      'Հարցրեք ազատ ձևով՝ հայերեն',
      'Պատասխան՝ մոտ մեկ րոպեում',
      'Կոնկրետ հոդված և բառացի մեջբերում',
    ],
    body: 'Ճիշտ հոդվածը գտնելը հաճախ ավելի երկար է տևում, քան հարցի պատասխանը։\n\nMatyanAI-ին հարցնում եք այնպես, ինչպես կհարցնեիք գործընկերոջը, և մոտ մեկ րոպեում ստանում եք պատասխան՝ կոնկրետ հոդվածով և օրենքից բառացի մեջբերումով։',
  },
  offer: {
    headline: 'Սկսեք անվճար',
    points: [
      'Շաբաթական 5 հարց՝ անվճար',
      'Յուրաքանչյուր գործընկեր՝ ևս 5 հարց',
      'Մեկ աշխատանքային տարածք՝ մինչև 5 անդամ',
    ],
    body: 'Գրանցումն անվճար է։ Անվճար փաթեթով ստանում եք շաբաթական 5 հարց, և յուրաքանչյուր միացող գործընկեր ավելացնում է ևս 5 հարց։\n\nԹիմը աշխատում է մեկ աշխատանքային տարածքում՝ մինչև 5 անդամ։',
  },
  difference: {
    headline: 'Օրենքի տեքստից, ոչ թե հիշողությունից',
    points: [
      'Պատասխանում է միայն օրենքի տեքստից',
      'Ցույց է տալիս ակտը և հոդվածը',
      'Եթե պատասխան չկա, ուղղակի ասում է',
    ],
    body: 'Ընդհանուր նշանակության AI օգնականը կարող է վստահ պատասխանել՝ առանց աղբյուրի։\n\nMatyanAI-ը պատասխանում է միայն ՀՀ օրենսդրության տեքստից, նշում է ակտը և հոդվածը, իսկ եթե գտնված հոդվածները հարցին չեն պատասխանում, դա ուղղակի ասում է։',
  },
};

const CTA = 'Փորձեք անվճար · matyanai.am';
const PUBLIC_URL = process.env['PUBLIC_URL'] ?? 'https://matyanai.am';

/** Every problem with a generated promo, or none. */
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

async function promo(kind: Exclude<Kind, 'demo'>, recent: string[]): Promise<{ card: PromoCard; body: string; source: string }> {
  const label = LABELS[kind];
  for (let attempt = 0; attempt < 3; attempt++) {
    let reply = '';
    try {
      await generate(
        {
          system: PROMO_SYSTEM,
          history: [],
          user: `${BRIEF[kind]}\n\nDo not repeat these recent headlines:\n${recent.map((h) => `- ${h}`).join('\n') || '(none)'}`,
          onText: (d) => {
            reply += d;
          },
        },
        DRAFT_MODEL,
      );
      const json = JSON.parse(reply.slice(reply.indexOf('{'), reply.lastIndexOf('}') + 1)) as {
        headline?: string;
        points?: string[];
        body?: string;
      };
      const p = {
        headline: String(json.headline ?? '').trim(),
        points: (json.points ?? []).map((x) => String(x).trim()),
        body: String(json.body ?? '').trim(),
      };
      const card = { label, headline: p.headline, points: p.points, cta: CTA };
      if (promoProblems(p).length === 0 && promoFits(card)) {
        return { card, body: `${p.body}\n\nՓորձեք անվճար՝ matyanai.am`, source: DRAFT_MODEL };
      }
    } catch {
      // fall through to the next attempt
    }
  }
  const f = FALLBACKS[kind];
  return {
    card: { label, headline: f.headline, points: f.points, cta: CTA },
    body: `${f.body}\n\nՓորձեք անվճար՝ matyanai.am`,
    source: 'fallback',
  };
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

async function permalinks(p: Published): Promise<string[]> {
  const out: string[] = [];
  const channel = process.env['TELEGRAM_CHANNEL']?.replace(/^@/, '');
  if (p.telegram.id && channel) out.push(`Telegram: https://t.me/${channel}/${p.telegram.id}`);
  if (p.facebook.id) out.push(`Facebook: https://www.facebook.com/${p.facebook.id}`);
  if (p.instagram.id) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v25.0/${p.instagram.id}?fields=permalink&access_token=${process.env['META_PAGE_TOKEN']}`,
      );
      const j = (await r.json()) as { permalink?: string };
      out.push(`Instagram: ${j.permalink ?? p.instagram.id}`);
    } catch {
      out.push(`Instagram: ${p.instagram.id}`);
    }
  }
  const failed = Object.entries(p)
    .filter(([, r]) => !r.id)
    .map(([k, r]) => `${k}: ❌ ${r.error ?? r.skipped}`);
  return [...out, ...failed];
}

export async function autopost(forced?: Kind): Promise<void> {
  const published = await db()<{ topic: string; headline: string }[]>`
    SELECT topic, headline FROM social_drafts
     WHERE topic LIKE 'auto:%' AND status = 'published'
     ORDER BY created_at DESC`;
  const kind = forced ?? ROTATION[published.length % ROTATION.length]!;
  const recentTopics = published.slice(0, 30).map((r) => r.topic);
  const recentHeadlines = published.slice(0, 10).map((r) => r.headline);

  let image: Buffer;
  let body: string;
  let topic: string;
  let headline: string;
  let model: string;
  if (kind === 'demo') {
    const d = await demo(recentTopics);
    if ('skip' in d) {
      await sendToTeam(`Ավտոմատ գրառումը բաց թողնվեց (կենդանի պատասխան)՝ ${d.skip}`);
      return;
    }
    ({ image, body, topic } = d);
    headline = 'Հարց և պատասխան՝ օրենքի հոդվածով';
    model = 'live';
  } else {
    const p = await promo(kind, recentHeadlines);
    image = renderPromoCard(p.card);
    body = p.body;
    topic = `auto:${kind}`;
    headline = p.card.headline;
    model = p.source;
  }

  const imageName = `${randomUUID()}.jpg`;
  await mkdir(MEDIA_DIR, { recursive: true });
  await writeFile(join(MEDIA_DIR, imageName), image);
  const rows = await db()<{ id: string }[]>`
    INSERT INTO social_drafts (topic, headline, subline, body, source_label, source_url, image_name, model, status, decided_at)
    VALUES (${topic}, ${headline}, '', ${body}, ${kind}, ${PUBLIC_URL}, ${imageName}, ${model}, 'publishing', now())
    RETURNING id`;
  const result = await publishEverywhere(body, imageName);
  const ok = [result.telegram, result.facebook, result.instagram].some((r) => r.id);
  await db()`
    UPDATE social_drafts SET status = ${ok ? 'published' : 'failed'}, results = ${db().json(result as never)}
     WHERE id = ${rows[0]!.id}`;
  await sendToTeam([`Ավտոմատ գրառում (${kind})`, ...(await permalinks(result))].join('\n'));
}

// Run directly (the timer, or by hand).
if (process.argv[1]?.endsWith('autopost.ts')) {
  const forced = process.argv[2] as Kind | undefined;
  if (process.env['SOCIAL_AUTOPUBLISH'] !== 'on') {
    console.log('SOCIAL_AUTOPUBLISH is not "on" — nothing posted');
    process.exit(0);
  }
  autopost(forced && (ROTATION as string[]).includes(forced) ? forced : undefined)
    .then(() => process.exit(0))
    .catch(async (err) => {
      console.error(err);
      await sendToTeam(`Ավտոմատ գրառումը ձախողվեց՝ ${(err as Error).message}`).catch(() => {});
      process.exit(1);
    });
}
