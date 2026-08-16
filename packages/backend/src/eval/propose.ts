/**
 * Propose golden-set answers for the 30 Russian questions, using FTS.
 *
 * IMPORTANT — what this is and is not:
 *
 * The questions are Russian; the corpus is Armenian. Postgres FTS is purely
 * lexical, so a raw Russian query against `tsv_hy` matches NOTHING — there is
 * no Cyrillic in the index. To produce candidates a human can verify, each
 * question is mapped to Armenian legal terms through an explicit glossary
 * below, and those terms are searched with prefix matching (`հարկ:*`) because
 * Armenian is agglutinative and the `simple` text-search config does no
 * stemming (հարկ / հարկի / հարկը / հարկով are distinct lexemes).
 *
 * So this is GLOSSARY-ASSISTED FTS. It is a proposal tool for human review,
 * NOT the retrieval baseline. The baseline must be measured separately, and
 * will be far weaker, because a real user's Russian question arrives without
 * a hand-written Armenian glossary attached.
 *
 * Nothing is scored here. Output is a CSV for manual verification.
 *
 * Usage: npx tsx packages/backend/src/eval/propose.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { config } from '@armlex/shared';

/** Armenian search expressions, by concept. Prefix-matched to survive inflection. */
const CONCEPTS: Record<string, string> = {
  vat: '(ավելացված:* & արժեք:* & հարկ:*)',
  vat_abbr: '(աահ:*)',
  turnover: '(շրջանառ:* & հարկ:*)',
  micro: '(միկրոձեռնարկ:*)',
  sole_prop: '(անհատ:* & ձեռնարկատ:*)',
  threshold: '(շեմ:*)',
  rate: '(դրույքաչափ:*)',
  dividend: '(շահաբաժ:*)',
  income_tax: '(եկամտային:* & հարկ:*)',
  profit_tax: '(շահութահարկ:*)',
  land_tax: '(հող:* & հարկ:*)',
  property_tax: '(գույքահարկ:*)',
  cash_register: '(հսկիչ:* & դրամարկղ:*)',
  penalty: '(տուգանք:*)',
  declaration: '(հաշվարկ:* | հայտարարագ:*)',
  export: '(արտահան:*)',
  import: '(ներմուծ:*)',
  resident: '(ռեզիդենտ:*)',
  social: '(սոցիալական:* & վճար:*)',
  salary: '(աշխատավարձ:*)',
  it_tech: '(տեղեկատվական:* & տեխնոլոգ:*)',
  fixed_payment: '(հաստատագրված:* & վճար:*)',
  employee: '(վարձու:* & աշխատող:*)',
  exempt: '(ազատ:*)',
  deadline: '(ժամկետ:*)',
  tax_object: '(հարկման:* & օբյեկտ:*)',
  registration: '(հաշվառ:*)',
  voluntary: '(կամավոր:*)',
  startup: '(նորաստեղծ:* | ստարտափ:*)',
  services: '(ծառայություն:*)',
  activity_types: '(գործունեության:* & տեսակ:*)',
  nonresident: '(ոչ:* & ռեզիդենտ:*)',
};

interface Question {
  n: number;
  question: string;
  lang: string;
  /** Concepts that must be present for a candidate to be plausible. */
  primary: string[];
  /** Concepts that raise confidence when also present. */
  secondary: string[];
}

const QUESTIONS: Question[] = [
  { n: 1, question: 'Какой налог платит ИП, оказывающий консультационные услуги, с оборотом 30 млн драм в год?', lang: 'ru', primary: ['turnover'], secondary: ['sole_prop', 'threshold', 'services'] },
  { n: 2, question: 'Какой порог оборота для налога с оборота в Армении?', lang: 'ru', primary: ['turnover'], secondary: ['threshold'] },
  { n: 3, question: 'Что происходит при превышении порога налога с оборота — на какой режим переход?', lang: 'ru', primary: ['turnover'], secondary: ['threshold', 'vat'] },
  { n: 4, question: 'Может ли ИП на налоге с оборота нанимать сотрудников?', lang: 'ru', primary: ['turnover'], secondary: ['employee', 'sole_prop'] },
  { n: 5, question: 'Какие виды деятельности исключены из микропредпринимательства?', lang: 'ru', primary: ['micro'], secondary: ['activity_types'] },
  { n: 6, question: 'Какой оборот считается пределом для микропредпринимательства?', lang: 'ru', primary: ['micro'], secondary: ['threshold', 'turnover'] },
  { n: 7, question: 'С какого оборота обязательна регистрация плательщиком НДС?', lang: 'ru', primary: ['vat'], secondary: ['threshold', 'registration'] },
  { n: 8, question: 'Можно ли зарегистрироваться плательщиком НДС добровольно при обороте ниже порога?', lang: 'ru', primary: ['vat'], secondary: ['voluntary', 'registration'] },
  { n: 9, question: 'Какая ставка НДС в Армении?', lang: 'ru', primary: ['vat'], secondary: ['rate'] },
  { n: 10, question: 'Какие налоговые льготы предусмотрены для ИТ-компаний с сертификатом?', lang: 'ru', primary: ['it_tech'], secondary: ['exempt', 'startup'] },
  { n: 11, question: 'Какие условия нужно выполнить для получения ИТ-сертификата (стартап)?', lang: 'ru', primary: ['it_tech'], secondary: ['startup'] },
  { n: 12, question: 'Как облагаются дивиденды, выплачиваемые резиденту?', lang: 'ru', primary: ['dividend'], secondary: ['resident', 'income_tax'] },
  { n: 13, question: 'Как облагаются дивиденды нерезиденту?', lang: 'ru', primary: ['dividend'], secondary: ['nonresident', 'profit_tax'] },
  { n: 14, question: 'Какая ставка подоходного налога с зарплаты сотрудника?', lang: 'ru', primary: ['income_tax'], secondary: ['rate', 'salary'] },
  { n: 15, question: 'Какие социальные платежи обязан делать работодатель за сотрудника?', lang: 'ru', primary: ['social'], secondary: ['salary', 'employee'] },
  { n: 16, question: 'Обязателен ли кассовый аппарат (ՀԴՄ) для ИП на налоге с оборота?', lang: 'ru', primary: ['cash_register'], secondary: ['turnover', 'sole_prop'] },
  { n: 17, question: 'Какие есть исключения из обязательного применения кассового аппарата?', lang: 'ru', primary: ['cash_register'], secondary: ['exempt'] },
  { n: 18, question: 'Какая разница в налоговой нагрузке между ИП и ООО при одинаковом обороте?', lang: 'ru', primary: ['sole_prop'], secondary: ['turnover', 'profit_tax'] },
  { n: 19, question: 'Какие фиксированные платежи существуют и для каких видов деятельности?', lang: 'ru', primary: ['fixed_payment'], secondary: ['activity_types'] },
  { n: 20, question: 'Нужно ли платить НДС при импорте товаров?', lang: 'ru', primary: ['import'], secondary: ['vat'] },
  { n: 21, question: 'Есть ли освобождение от импортного НДС для определённых категорий товаров?', lang: 'ru', primary: ['import'], secondary: ['vat', 'exempt'] },
  { n: 22, question: 'В какие сроки нужно подавать декларацию по налогу с оборота?', lang: 'ru', primary: ['turnover'], secondary: ['declaration', 'deadline'] },
  { n: 23, question: 'Какой штраф за просрочку подачи налоговой декларации?', lang: 'ru', primary: ['penalty'], secondary: ['declaration', 'deadline'] },
  { n: 24, question: 'Как определяется объект налогообложения по налогу на прибыль?', lang: 'ru', primary: ['profit_tax'], secondary: ['tax_object'] },
  { n: 25, question: 'Какая ставка налога на прибыль для юридических лиц?', lang: 'ru', primary: ['profit_tax'], secondary: ['rate'] },
  { n: 26, question: 'Как облагается имущество (недвижимость) налогом?', lang: 'ru', primary: ['property_tax'], secondary: ['tax_object', 'rate'] },
  { n: 27, question: 'Как рассчитывается земельный налог?', lang: 'ru', primary: ['land_tax'], secondary: ['tax_object', 'rate'] },
  { n: 28, question: 'Может ли ИП совмещать налог с оборота с другой деятельностью по общему режиму?', lang: 'ru', primary: ['turnover'], secondary: ['sole_prop', 'activity_types'] },
  { n: 29, question: 'Какие обязательства по НДС возникают при экспорте услуг за пределы Армении?', lang: 'ru', primary: ['export'], secondary: ['vat', 'services'] },
  { n: 30, question: 'Что считается налоговым резидентом Армении для целей НДФЛ?', lang: 'ru', primary: ['resident'], secondary: ['income_tax'] },
];

interface Hit {
  arlisId: number;
  ref: string;
  text: string;
  score: number;
  matched: Set<string>;
  /** How many concepts matched the article TITLE — the strongest signal. */
  titleHits: number;
}

type Confidence = 'high' | 'med' | 'low' | 'none';

function csvCell(v: unknown): string {
  const s = String(v ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return `"${s.replace(/"/g, '""')}"`;
}

/** ~200 chars around the first Armenian term hit, for eyeball verification. */
function snippet(text: string, concepts: string[]): string {
  const body = text.slice(text.indexOf('\n---\n') + 5);
  const roots = concepts
    .flatMap((c) => (CONCEPTS[c] ?? '').match(/[԰-֏]+/g) ?? [])
    .filter((r) => r.length > 3);

  let at = -1;
  for (const r of roots) {
    const i = body.indexOf(r);
    if (i >= 0 && (at === -1 || i < at)) at = i;
  }
  if (at === -1) at = 0;

  const start = Math.max(0, at - 60);
  return body.slice(start, start + 200);
}

function confidenceOf(
  hit: Hit,
  q: Question,
  rank: number,
  margin: number,
): Confidence {
  const primaryHit = q.primary.every((p) => hit.matched.has(p));
  const secondaryCount = q.secondary.filter((s) => hit.matched.has(s)).length;

  if (!primaryHit && secondaryCount === 0) return 'none';
  if (primaryHit && secondaryCount >= 2 && rank === 0 && margin > 0.25) return 'high';
  if (primaryHit && secondaryCount >= 1) return 'med';
  if (primaryHit) return 'low';
  return 'low';
}

async function main(): Promise<void> {
  const sql = postgres(config.databaseUrl, { onnotice: () => {} });
  const outDir = join(process.cwd(), 'data', 'eval');
  await mkdir(outDir, { recursive: true });

  try {
    // --- all refs, for manual resolution ------------------------------------
    const refs = await sql<{ arlis_id: number; article_number: string; ord: number }[]>`
      SELECT d.arlis_id, a.article_number, a.ord
      FROM articles a JOIN documents d ON d.id = a.document_id
      ORDER BY d.arlis_id, a.ord
    `;
    await writeFile(
      join(outDir, 'all_refs.txt'),
      refs.map((r) => `${r.arlis_id}\t${r.article_number}`).join('\n') + '\n',
      'utf8',
    );
    console.log(`all_refs.txt: ${refs.length} refs`);

    // --- proposals ----------------------------------------------------------
    const rows: string[] = [
      ['question', 'lang', 'arlisId', 'ref', 'snippet', 'confidence'].join(','),
    ];
    const summary: Record<Confidence, number> = { high: 0, med: 0, low: 0, none: 0 };

    for (const q of QUESTIONS) {
      const byChunk = new Map<string, Hit>();

      for (const concept of [...q.primary, ...q.secondary]) {
        const expr = CONCEPTS[concept];
        if (!expr) continue;

        // Normalization flag 2 divides rank by document length. Without it the
        // longest chunk wins almost everything: art. 108 ("Եկամուտ չհամարվող
        // տարրերը") is 43,369 chars and simply contains more of every term.
        //
        // A title match is weighted an order of magnitude higher, because an
        // article titled "Ավելացված արժեքի հարկի դրույքաչափերը" IS the answer
        // to "what is the VAT rate" in a way no body-text hit can match.
        const hits = await sql<
          {
            arlis_id: number;
            article_number: string;
            text_hy: string;
            score: number;
            title_hit: boolean;
          }[]
        >`
          SELECT d.arlis_id, a.article_number, a.text_hy,
                 ts_rank_cd(a.tsv_hy, to_tsquery('simple', ${expr}), 2) AS score,
                 to_tsvector('simple', coalesce(a.title, ''))
                   @@ to_tsquery('simple', ${expr}) AS title_hit
          FROM articles a
          JOIN documents d ON d.id = a.document_id
          WHERE d.rag_eligible
            AND d.status = 'in_force'
            AND a.tsv_hy @@ to_tsquery('simple', ${expr})
          ORDER BY title_hit DESC, score DESC
          LIMIT 25
        `;

        const base = q.primary.includes(concept) ? 2 : 1;
        for (const h of hits) {
          const weight = base * (h.title_hit ? 12 : 1);
          const key = `${h.arlis_id}#${h.article_number}`;
          const existing = byChunk.get(key);
          if (existing) {
            existing.score += Number(h.score) * weight;
            existing.matched.add(concept);
            if (h.title_hit) existing.titleHits++;
          } else {
            byChunk.set(key, {
              arlisId: h.arlis_id,
              ref: h.article_number,
              text: h.text_hy,
              score: Number(h.score) * weight,
              matched: new Set([concept]),
              titleHits: h.title_hit ? 1 : 0,
            });
          }
        }
      }

      // Rank: concepts matched first, then accumulated FTS rank.
      const ranked = [...byChunk.values()]
        .sort((a, b) => b.matched.size - a.matched.size || b.score - a.score)
        .slice(0, 3);

      if (ranked.length === 0) {
        rows.push(
          [csvCell(q.question), csvCell(q.lang), '', '', '', csvCell('none')].join(','),
        );
        summary.none++;
        console.log(`  Q${String(q.n).padStart(2)} none`);
        continue;
      }

      const top = ranked[0]!.score;
      const second = ranked[1]?.score ?? 0;
      const margin = top > 0 ? (top - second) / top : 0;

      ranked.forEach((hit, i) => {
        const conf = confidenceOf(hit, q, i, margin);
        rows.push(
          [
            csvCell(q.question),
            csvCell(q.lang),
            hit.arlisId,
            csvCell(hit.ref),
            csvCell(snippet(hit.text, [...q.primary, ...q.secondary])),
            csvCell(conf),
          ].join(','),
        );
        if (i === 0) summary[conf]++;
      });

      const t = ranked[0]!;
      console.log(
        `  Q${String(q.n).padStart(2)} ${confidenceOf(t, q, 0, margin).padEnd(4)} ${t.arlisId} ${t.ref.slice(0, 30)} (${t.matched.size} concepts)`,
      );
    }

    await writeFile(join(outDir, 'golden_proposed.csv'), rows.join('\n') + '\n', 'utf8');

    console.log(`\ngolden_proposed.csv: ${rows.length - 1} candidate rows`);
    console.log(
      `top-candidate confidence: high=${summary.high} med=${summary.med} low=${summary.low} none=${summary.none}`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
