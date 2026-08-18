/**
 * UI language.
 *
 * Three languages because the audience genuinely splits three ways: Armenian
 * accountants working in Armenian, the large Russian-working professional
 * community, and English for anyone advising from outside. This is the
 * INTERFACE language only — answers still mirror the language of the question,
 * and Armenian legal quotations stay Armenian in every case, because they are
 * the authoritative text and translating them would defeat the point.
 *
 * A flat dictionary, no i18n library: the string count is small, and a
 * dependency would buy pluralisation rules and lazy loading we do not need.
 */
export type Lang = 'hy' | 'ru' | 'en';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'hy', label: 'ՀԱՅ' },
  { code: 'ru', label: 'РУС' },
  { code: 'en', label: 'ENG' },
];

type Dict = Record<string, string>;

const hy: Dict = {
  'nav.consultations': 'Խորհրդատվություններ',
  'nav.newCase': '+ Նոր խորհրդատվություն',
  'nav.noCases': 'Պահպանված երկխոսություններ դեռ չկան։',

  'mode.chat': 'Երկխոսություն',
  'mode.ask': 'Մեկանգամյա',
  'mode.search': 'Որոնում',
  'mode.chatHint': 'Երկխոսություն հիշողությամբ — ճշտեք և խնդրեք եզրակացություն ամբողջի վերաբերյալ։',
  'mode.askHint': 'Մեկ հարց — մեկ պատասխան, առանց հիշողության։',
  'mode.searchHint': 'Միայն գտնված հատվածները, առանց մոդելի։',

  'corpus.acts': 'ակտ',
  'corpus.chunks': 'հատված',
  'corpus.synced': 'Ստուգված ARLIS-ի հետ',
  'corpus.disclaimer': 'Սա իրավաբանական խորհրդատվություն չէ — ստուգեք ամբողջական տեքստը',

  'turn.question': 'Հարց',
  'turn.searchedFor': 'որոնվել է՝',

  'stage.understanding': 'Վերլուծում եմ հարցը…',
  'stage.searching': 'Փնտրում եմ Հարկային օրենսգրքում…',
  'stage.reading': 'Կարդում եմ գտնված հոդվածները…',
  'stage.writing': 'Ձևակերպում եմ պատասխանը…',

  'coverage.partial':
    'Գտնված հոդվածները հարցը լուսաբանում են մասամբ — ստուգեք, արդյոք ճշտող հարցը չի փոխում եզրակացությունը։',
  'coverage.none':
    'Գտնված հոդվածներում այս հարցին ուղղակի պատասխանող նորմ չկա։ Ստորև՝ միայն հարակից դրույթներ։',

  'intro.lead':
    'Տվեք հարց, ապա ճշտեք — համատեքստը պահպանվում է հաղորդագրությունների միջև, ուստի կարող եք խնդրել եզրակացություն ամբողջ քննարկվածի վերաբերյալ։',

  'composer.first': 'Նկարագրեք իրավիճակը կամ տվեք հարց…',
  'composer.next': 'Ճշտող հարց կամ «եզրակացրու ամբողջ քննարկվածից»',
  'composer.send': 'Ուղարկել',

  'norm.title': 'Նորմ',
  'norm.empty':
    'Տվեք հարց — այստեղ կհայտնվի այն հոդվածը, որի վրա հենվում է պատասխանը՝ ընդգծված մեջբերումով և խմբագրության ամսաթվով։',
  'norm.inForce': 'Գործում է',
  'norm.revised': 'Խմբ.',
  'norm.adopted': 'Ընդունված',
  'norm.revisedFrom': 'Խմբ. թիվ',
  'norm.checked': 'Ստուգված',
  'norm.copyQuote': 'Պատճենել մեջբերումը',
  'norm.copyArticle': 'Պատճենել հոդվածը',
  'norm.copied': 'Պատճենվեց',
  'norm.refersTo': 'Հղվում է',

  'login.note':
    'Մուտքը՝ ընդհանուր գաղտնաբառով։ Յուրաքանչյուր պատասխան ծախսում է վճարովի API-հարցումներ, ուստի գործիքը փակ է։',
  'login.password': 'Գաղտնաբառ',
  'login.enter': 'Մուտք',
  'login.wrong': 'Սխալ գաղտնաբառ։',

  'theme.auto': 'Ավտո',
  'theme.light': 'Լույս',
  'theme.dark': 'Մուգ',

  'error.credit':
    'Anthropic API-ի հաշվեկշիռը սպառվել է — սա ծրագրի սխալ չէ։ Համալրեք հաշիվը Plans & Billing բաժնում; որոնումն աշխատում է առանց դրա։',
  'error.noApi': 'API-ն չի պատասխանում',
};

const ru: Dict = {
  'nav.consultations': 'Консультации',
  'nav.newCase': '+ Новая консультация',
  'nav.noCases': 'Пока нет сохранённых диалогов.',

  'mode.chat': 'Диалог',
  'mode.ask': 'Разовый',
  'mode.search': 'Поиск',
  'mode.chatHint': 'Диалог с памятью — уточняйте и просите вывод по совокупности.',
  'mode.askHint': 'Один вопрос — один ответ, без памяти.',
  'mode.searchHint': 'Только найденные фрагменты, без модели.',

  'corpus.acts': 'актов',
  'corpus.chunks': 'фрагментов',
  'corpus.synced': 'Сверено с ARLIS',
  'corpus.disclaimer': 'Не юридическая консультация — проверяйте полный текст',

  'turn.question': 'Вопрос',
  'turn.searchedFor': 'искали:',

  'stage.understanding': 'Разбираю вопрос…',
  'stage.searching': 'Ищу в Налоговом кодексе…',
  'stage.reading': 'Читаю найденные статьи…',
  'stage.writing': 'Формулирую ответ…',

  'coverage.partial':
    'Найденные статьи покрывают вопрос частично — проверьте, что уточняющий вопрос ниже не меняет вывод.',
  'coverage.none':
    'Прямой нормы по этому вопросу в найденных статьях нет. Ниже — только смежные положения.',

  'intro.lead':
    'Задайте вопрос, затем уточняйте — контекст сохраняется между сообщениями, поэтому можно попросить вывод по совокупности обсуждённого.',

  'composer.first': 'Опишите ситуацию или задайте вопрос…',
  'composer.next': 'Уточняющий вопрос или «сделай вывод по всему обсуждённому»',
  'composer.send': 'Отправить',

  'norm.title': 'Норма',
  'norm.empty':
    'Задайте вопрос — здесь появится статья, на которую опирается ответ, с выделенной цитатой и датой редакции.',
  'norm.inForce': 'Действует',
  'norm.revised': 'Ред.',
  'norm.adopted': 'Принят',
  'norm.revisedFrom': 'Ред. от',
  'norm.checked': 'Сверено',
  'norm.copyQuote': 'Скопировать цитату',
  'norm.copyArticle': 'Скопировать статью',
  'norm.copied': 'Скопировано',
  'norm.refersTo': 'Ссылается на',

  'login.note':
    'Доступ по общему паролю. Каждый ответ расходует платные API-запросы, поэтому инструмент закрыт.',
  'login.password': 'Пароль',
  'login.enter': 'Войти',
  'login.wrong': 'Неверный пароль.',

  'theme.auto': 'Авто',
  'theme.light': 'Светлая',
  'theme.dark': 'Тёмная',

  'error.credit':
    'Закончился баланс Anthropic API — это не ошибка приложения. Пополните счёт в Plans & Billing, поиск работает без него.',
  'error.noApi': 'API не отвечает',
};

const en: Dict = {
  'nav.consultations': 'Consultations',
  'nav.newCase': '+ New consultation',
  'nav.noCases': 'No saved consultations yet.',

  'mode.chat': 'Dialogue',
  'mode.ask': 'One-shot',
  'mode.search': 'Search',
  'mode.chatHint': 'Dialogue with memory — refine, then ask for a conclusion across everything.',
  'mode.askHint': 'One question, one answer, no memory.',
  'mode.searchHint': 'Retrieved fragments only, no model involved.',

  'corpus.acts': 'acts',
  'corpus.chunks': 'fragments',
  'corpus.synced': 'Checked against ARLIS',
  'corpus.disclaimer': 'Not legal advice — verify the full text',

  'turn.question': 'Question',
  'turn.searchedFor': 'searched for:',

  'stage.understanding': 'Reading the question…',
  'stage.searching': 'Searching the Tax Code…',
  'stage.reading': 'Reading the articles found…',
  'stage.writing': 'Drafting the answer…',

  'coverage.partial':
    'The articles found cover this only partly — check whether the clarifying question below changes the conclusion.',
  'coverage.none':
    'No provision answering this was found. Below are related provisions only.',

  'intro.lead':
    'Ask a question, then refine it — context carries between messages, so you can ask for a conclusion across the whole discussion.',

  'composer.first': 'Describe the situation or ask a question…',
  'composer.next': 'A follow-up, or “summarise everything discussed”',
  'composer.send': 'Send',

  'norm.title': 'Provision',
  'norm.empty':
    'Ask a question — the article the answer rests on appears here, with the quoted passage marked and the revision date shown.',
  'norm.inForce': 'In force',
  'norm.revised': 'Rev.',
  'norm.adopted': 'Adopted',
  'norm.revisedFrom': 'Revised',
  'norm.checked': 'Checked',
  'norm.copyQuote': 'Copy quotation',
  'norm.copyArticle': 'Copy article',
  'norm.copied': 'Copied',
  'norm.refersTo': 'Refers to',

  'login.note':
    'Shared-password access. Every answer spends paid API requests, so the tool is closed.',
  'login.password': 'Password',
  'login.enter': 'Sign in',
  'login.wrong': 'Wrong password.',

  'theme.auto': 'Auto',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  'error.credit':
    'The Anthropic API balance is exhausted — this is not an application fault. Top up in Plans & Billing; search works without it.',
  'error.noApi': 'The API is not responding',
};

const DICTS: Record<Lang, Dict> = { hy, ru, en };

const STORAGE_KEY = 'armlex.lang';

/** Remembered choice, else the browser's preference, else Russian. */
export function initialLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === 'hy' || saved === 'ru' || saved === 'en') return saved;
  const nav = navigator.language.slice(0, 2).toLowerCase();
  if (nav === 'hy') return 'hy';
  if (nav === 'en') return 'en';
  return 'ru';
}

export function storeLang(lang: Lang): void {
  localStorage.setItem(STORAGE_KEY, lang);
  // Drives font selection and screen-reader pronunciation for the chrome.
  // Armenian legal text carries its own lang="hy" regardless.
  document.documentElement.lang = lang;
}

/**
 * Look up a string. Falls back to Russian, then to the key itself — a visible
 * key is a bug report, which beats an empty element that hides the omission.
 */
export function translator(lang: Lang) {
  return (key: string): string => DICTS[lang][key] ?? ru[key] ?? key;
}
