/**
 * Seed corpus for the milestone-2 audit: the Tax Code plus tax-adjacent acts,
 * discovered via the ARLIS search endpoint (see README for the query format).
 *
 * `id` is the ARLIS act id. Titles are the Armenian originals, truncated for
 * readability — the audit refetches the authoritative title from each page.
 *
 * Two `-Ա` acts are included as CONTROLS. Every tax document found by search is
 * `-Ն`, so the corpus on its own cannot demonstrate that the suffix rule
 * discriminates. The controls give the classifier something to reject.
 */
export type ExpectedType =
  | 'code'
  | 'law'
  | 'gov_decision'
  | 'ministerial_order';

export interface CorpusEntry {
  id: number;
  label: string;
  expect: ExpectedType;
  /** Act number reported by ARLIS search, for cross-checking the parser. */
  expectedActNumber?: string;
  /** Control documents are audited but are not part of the tax corpus. */
  control?: boolean;
  note?: string;
}

/**
 * Alias ARLIS id -> canonical ARLIS id.
 *
 * Established by the milestone-2 audit: 109017 and 228650 serve byte-identical
 * `/latest` content, but 228650's bare version IS its `/latest` — it is the
 * current consolidation snapshot, which the next amendment supersedes with a
 * new id. 109017's bare version differs from `/latest`, marking it as the
 * original act record that `/latest` advances from. ARLIS's own codes index
 * links 109017.
 */
export const CANONICAL_ID: Record<number, number> = {
  228650: 109017,
};

export function resolveCanonicalId(arlisId: number): number {
  return CANONICAL_ID[arlisId] ?? arlisId;
}

export const TAX_CORPUS: CorpusEntry[] = [
  // --- the code itself (two candidate ids — see canonical-id analysis) -------
  { id: 109017, label: 'ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ', expect: 'code', expectedActNumber: 'ՀՕ-165-Ն', note: 'candidate canonical id' },
  { id: 228650, label: 'ՀՀ ՀԱՐԿԱՅԻՆ ՕՐԵՆՍԳԻՐՔ', expect: 'code', expectedActNumber: 'ՀՕ-165-Ն', note: 'duplicate surfaced by search' },

  // --- tax-adjacent laws ----------------------------------------------------
  { id: 228654, label: 'ՊԵՏԱԿԱՆ ՏՈՒՐՔԻ ՄԱՍԻՆ', expect: 'law', expectedActNumber: 'ՀՕ-186' },
  { id: 228232, label: 'ՏԵՂԱԿԱՆ ՏՈՒՐՔԵՐԻ ԵՎ ՎՃԱՐՆԵՐԻ ՄԱՍԻՆ', expect: 'law', expectedActNumber: 'ՀՕ-185' },
  { id: 215606, label: 'ԵԿԱՄՏԱՅԻՆ ՀԱՐԿԻ, ՇԱՀՈՒԹԱՀԱՐԿԻ ԵՎ ՍՈՑ. ՎՃԱՐԻ ԱՆՁՆԱՎՈՐՎԱԾ ՀԱՇՎԱՌՄԱՆ ՄԱՍԻՆ', expect: 'law', expectedActNumber: 'ՀՕ-247-Ն' },
  { id: 178425, label: 'ԱԿՑԻԶԱՅԻՆ ՀԱՐԿՈՎ ՉՀԱՐԿՎՈՂ / ԱԱՀ-ԻՑ ԱԶԱՏՎԱԾ ԱՊՐԱՆՔՆԵՐԻ ՑԱՆԿԸ', expect: 'law', expectedActNumber: 'ՀՕ-195', note: 'rate/code tables — table parsing test' },

  // --- government decisions (all -Ն) ---------------------------------------
  { id: 200966, label: 'ԱԱՀ/ԱԿՑԻԶԻ ՓՈԽՀԱՏՈՒՑՎՈՂ ԳՈՒՄԱՐՆԵՐԻ ՌԻՍԿԱՅԻՆ ՉԱՓԱՆԻՇՆԵՐԸ', expect: 'gov_decision', expectedActNumber: 'N 155-Ն' },
  { id: 175466, label: 'ՈՉ ՌԵԶԻԴԵՆՏԻ ԷԼԵԿՏՐՈՆԱՅԻՆ ԾԱՌԱՅՈՒԹՅՈՒՆՆԵՐԻ ԱԱՀ', expect: 'gov_decision', expectedActNumber: 'N 406-Ն' },
  { id: 175201, label: 'ՄԱՔՍԱՏՈՒՐՔԻ, ԱԱՀ-Ի, ԱԿՑԻԶԻ ՎՃԱՐՄԱՆ ԿԱՐԳԸ', expect: 'gov_decision', expectedActNumber: 'N 883-Ն' },
  { id: 178806, label: 'ԱԿՑԻԶԱՅԻՆ ՀԱՐԿԻ ՓՈԽՀԱՏՈՒՑՈՒՄԸ ԱՐՏԱՀԱՆՄԱՆ ԴԵՊՔՈՒՄ', expect: 'gov_decision', expectedActNumber: 'N 904-Ն' },
  { id: 175945, label: 'ՆԵՐՄՈՒԾՄԱՆ ՀԱՐԿԵՐԻ ՎՃԱՐՈՒՄԸ ՀԵՏԱՁԳԵԼՈՒ ԿԱՐԳԸ', expect: 'gov_decision', expectedActNumber: 'N 1481-Ն' },
  { id: 226146, label: 'ՃԱՆԱՊԱՐՀԱՅԻՆ ՀԱՐԿ ՎՃԱՐՈՂՆԵՐԸ (ՏԱՐԱՆՑՈՒՄ)', expect: 'gov_decision', expectedActNumber: 'N 787-Ն' },

  // --- SRC (ՊԵԿ) orders -----------------------------------------------------
  { id: 175524, label: 'ԱԱՀ-Ի ԵՎ ԱԿՑԻԶԱՅԻՆ ՀԱՐԿԻ ՄԻԱՍՆԱԿԱՆ ՀԱՇՎԱՐԿԻ ՁԵՎԸ', expect: 'ministerial_order', expectedActNumber: 'N 298-Ն' },
  { id: 136993, label: 'ԱԱՀ ՎՃԱՐՈՂ ՀԱՇՎԱՌՎԵԼՈՒ ՀԱՅՏԱՐԱՐՈՒԹՅԱՆ ՁԵՎԸ', expect: 'ministerial_order', expectedActNumber: 'N 190-Ն' },
  { id: 174166, label: 'ՈՉ ՌԵԶԻԴԵՆՏԻ ԷԼ. ԾԱՌԱՅՈՒԹՅԱՆ ԱԱՀ ՀԱՇՎԱՌՈՒՄԸ', expect: 'ministerial_order', expectedActNumber: 'N 47-Ն' },
  { id: 223829, label: 'ԵԿԱՄՏԱՅԻՆ ՀԱՐԿԻ ԱՄՍԱԿԱՆ ՀԱՇՎԱՐԿՆԵՐԻ ՁԵՎԵՐԸ', expect: 'ministerial_order', expectedActNumber: 'N 300-Ն' },
  { id: 201802, label: 'ՃՇՏՎԱԾ ՀԱՐԿԱՅԻՆ ՀԱՇՎԱՐԿՆԵՐԻ ՆԵՐԿԱՅԱՑՄԱՆ ԿԱՐԳԸ', expect: 'ministerial_order', expectedActNumber: 'N 849-Ն' },
  { id: 194786, label: 'ՀԱՐԿԱՅԻՆ ՊԱՐՏԱՎՈՐՈՒԹՅՈՒՆՆԵՐԻ ՀԱՇՎԱՌՄԱՆ ԿԱՐԳԸ', expect: 'ministerial_order', expectedActNumber: 'N 415-Ն' },
  { id: 199961, label: 'ՄԻՆՉԵՎ 2025Թ. ՉՄԱՐՎԱԾ ՊԱՐՏԱՎՈՐՈՒԹՅՈՒՆՆԵՐԻ ՀԱՇՎԱՌՈՒՄԸ', expect: 'ministerial_order', expectedActNumber: 'N 1512-Ն' },
  { id: 180531, label: 'ՀԱՇՎԱՌՈՒՄԻՑ ՀԱՆԵԼՈՒ ԿԱՐԳԸ (ՀՕԳ 380.1, 381)', expect: 'ministerial_order', expectedActNumber: 'N 1061-Ն', note: 'cites Tax Code arts. 380.1 and 381 — cross-ref test' },
  { id: 122913, label: 'ՈՉ ՌԵԶԻԴԵՆՏԻ ՎՃԱՐԱԾ ՀԱՐԿԻ ՏԵՂԵԿԱՆՔԻ ՁԵՎԸ', expect: 'ministerial_order', expectedActNumber: 'N 344-Ն' },

  // --- outside the tax vertical --------------------------------------------
  // The Labour Code is not a tax act, and `CLAUDE.md` scopes v1 to tax. It is
  // ingested anyway on demand evidence: labour/payroll drives ~24% of real
  // traffic and 40% of hard failures (`OPEN-ITEMS.md` 19a), and three sampled
  // real questions in a row needed articles 112 / 129 / 130 / 192 / 198, which
  // no amount of retrieval work on a tax-only corpus can reach.
  { id: 51, label: 'ՀՀ ԱՇԽԱՏԱՆՔԱՅԻՆ ՕՐԵՆՍԳԻՐՔ', expect: 'code', expectedActNumber: 'ՀՕ-124-Ն', note: 'non-tax; see OPEN-ITEMS 19a' },

  // --- wave 1: the accountant corpus beyond tax (2026-08-24) ---------------
  // Laws an Armenian accountant needs daily but that no tax act contains. All
  // six audited before ingest: parse clean, -Ն normative, no parser work.
  //
  // Two acts on the requested list are DEAD and deliberately excluded:
  // «Հաշվապահական հաշվառման մասին» exists as 55786 (repealed 2019-12-04, the
  // adoption date of its successor ՀՕ-284-Ն) and 143005 (repealed 2002). The
  // audit found no articles in either — a repealed act, not a parse failure.
  { id: 208604, label: 'ՀԱՇՎԱՊԱՀԱԿԱՆ ՀԱՇՎԱՌՄԱՆ ԵՎ ԱՈՒԴԻՏՈՐԱԿԱՆ ԳՈՐԾՈՒՆԵՈՒԹՅԱՆ ԿԱՐԳԱՎՈՐՄԱՆ ՄԱՍԻՆ', expect: 'law', expectedActNumber: 'ՀՕ-284-Ն', note: 'replaced the repealed 55786' },
  { id: 64546, label: 'ԿՈՒՏԱԿԱՅԻՆ ԿԵՆՍԱԹՈՇԱԿՆԵՐԻ ՄԱՍԻՆ', expect: 'law', expectedActNumber: 'ՀՕ-244-Ն' },
  { id: 94823, label: 'ԺԱՄԱՆԱԿԱՎՈՐ ԱՆԱՇԽԱՏՈՒՆԱԿՈՒԹՅԱՆ ԵՎ ՄԱՅՐՈՒԹՅԱՆ ՆՊԱՍՏՆԵՐԻ ՄԱՍԻՆ', expect: 'law', expectedActNumber: 'ՀՕ-160-Ն' },
  { id: 160074, label: 'ԱՆԿԱՆԽԻԿ ԳՈՐԾԱՌՆՈՒԹՅՈՒՆՆԵՐԻ ՄԱՍԻՆ', expect: 'law', expectedActNumber: 'ՀՕ-12-Ն' },
  { id: 50589, label: 'ԱՐԺՈՒԹԱՅԻՆ ԿԱՐԳԱՎՈՐՄԱՆ ԵՎ ԱՐԺՈՒԹԱՅԻՆ ՎԵՐԱՀՍԿՈՂՈՒԹՅԱՆ ՄԱՍԻՆ', expect: 'law', expectedActNumber: 'ՀՕ-135-Ն' },
  // The source of the դրոշմանիշային վճար accountants ask about — there is no
  // standalone «ապահովագրության հիմնադրամին վճարների մասին» act.
  { id: 148984, label: 'ՊԱՇՏՊԱՆՈՒԹՅԱՆ ԺԱՄԱՆԱԿ ԶԻՆԾԱՌԱՅՈՂՆԵՐԻ ԿՅԱՆՔԻՆ ԿԱՄ ԱՌՈՂՋՈՒԹՅԱՆԸ ՊԱՏՃԱՌՎԱԾ ՎՆԱՍՆԵՐԻ ՀԱՏՈՒՑՄԱՆ ՄԱՍԻՆ', expect: 'law', expectedActNumber: 'ՀՕ-245-Ն' },

  // --- wave 2: the form-filling instructions (2026-08-24) ------------------
  // The highest-value and highest-risk addition. Accountants ask "which line
  // do I fill in" constantly and the corpus could never answer: the tax
  // treatment was retrievable, the form was not. Unlike the Labour Code and
  // wave 1, these are NEAR-MISS documents — tax vocabulary competing directly
  // with the Tax Code for the same questions, which is the profile that took
  // Gemini from 91.3% to 73.9% when the corpus went 638 -> 885 chunks.
  // Ingested as their own wave so a regression is attributable.
  { id: 137687, label: 'ՇՐՋԱՆԱՌՈՒԹՅԱՆ ՀԱՐԿԻ ՀԱՇՎԱՐԿԻ ՁԵՎԸ ԵՎ ԴՐԱ ԼՐԱՑՄԱՆ ԿԱՐԳԸ', expect: 'ministerial_order', expectedActNumber: 'N 299-Ն' },
  { id: 123048, label: 'ՀԱՇՎԱՐԿԱՅԻՆ ՓԱՍՏԱԹՂԹԵՐԻ ԴՈՒՐՍԳՐՄԱՆ, ԱՆՎԱՎԵՐ ՃԱՆԱՉՄԱՆ, ՉԵՂԱՐԿՄԱՆ ԿԱՐԳԸ', expect: 'gov_decision', expectedActNumber: 'N 1257-Ն' },

  // --- wave 3: procedures and remaining forms (2026-08-24) -----------------
  // Same near-miss profile as wave 2. Note 159676 serves the SAME act as
  // 47926 (both report N 2335-Ն with identical structure, 37 pts + 22 ann) —
  // a duplicate-id pair like 109017/228650. Only 47926 is ingested; 159676 is
  // deliberately absent rather than aliased, since nothing references it.
  { id: 47926, label: 'ԳՈՐԾՈՒՂՄԱՆ ԾԱԽՍԵՐԻ ՀԱՏՈՒՑՄԱՆ ՉԱՓԵՐՆ ՈՒ ԿԱՐԳԸ', expect: 'gov_decision', expectedActNumber: 'N 2335-Ն', note: 'duplicate id 159676 not ingested' },
  { id: 120263, label: 'ԴՐԱՄԱՐԿՂԱՅԻՆ ԳՈՐԾԱՌՆՈՒԹՅՈՒՆՆԵՐԻ ԵՎ ԴՐԱՄԱՐԿՂԱՅԻՆ ԳՐՔԻ ՎԱՐՄԱՆ ԿԱՐԳԸ', expect: 'gov_decision', expectedActNumber: 'N 1260-Ն' },
  { id: 116284, label: 'ՈՉ ՌԵԶԻԴԵՆՏԻՆ ՎՃԱՐՎԱԾ ԵԿԱՄՈՒՏՆԵՐԻ ՇԱՀՈՒԹԱՀԱՐԿԻ ՀԱՇՎԱՐԿԻ ՁԵՎԸ', expect: 'ministerial_order', expectedActNumber: 'N 326-Ն' },
  { id: 191005, label: 'ՀԱՇՎԱՐԿԱՅԻՆ ՓԱՍՏԱԹՈՒՂԹ ՉՀԱՄԱՐՎՈՂ ԱՅԼ ՓԱՍՏԱԹՂԹԵՐԻ ԴՈՒՐՍԳՐՄԱՆ ԿԱՐԳԸ', expect: 'gov_decision', expectedActNumber: 'N 392-Ն' },

  // --- controls: individual (-Ա) acts, expected rag_eligible = false ---------
  { id: 229061, label: '[CONTROL] ՓՈԽՎԱՐՉԱՊԵՏԻ ՈՐՈՇՈՒՄ — ԲԵՌԻ ՆԵՐՄՈՒԾՈՒՄ', expect: 'gov_decision', expectedActNumber: 'N 486-Ա', control: true },
  { id: 229087, label: '[CONTROL] ՎԱՐՉԱՊԵՏԻ ՈՐՈՇՈՒՄ — ԱՐՁԱԿՈՒՐԴ', expect: 'gov_decision', expectedActNumber: 'N 681-Ա', control: true },
];
