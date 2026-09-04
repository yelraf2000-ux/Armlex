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


  'composer.first': 'Նկարագրեք իրավիճակը կամ տվեք հարց…',
  'composer.next': 'Ճշտող հարց կամ «եզրակացրու ամբողջ քննարկվածից»',
  'composer.send': 'Ուղարկել',

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
  'auth.signIn': 'Մուտք',
  'auth.register': 'Գրանցում',
  'auth.signInNote':
    'Մուտք գործեք՝ Ձեր զրույցները տեսնելու համար։ Յուրաքանչյուրը տեսնում է միայն իրենը։',
  'auth.registerNote': 'Ստեղծեք հաշիվ։ Անվճար փաթեթը ներառում է ամսական 5 հարց։',
  'auth.email': 'Էլ. փոստ',
  'auth.name': 'Անուն',
  'auth.createAccount': 'Ստեղծել հաշիվ',
  'auth.or': 'կամ',
  'auth.google': 'Շարունակել Google-ով',
  'auth.badCredentials': 'Սխալ էլ. փոստ կամ գաղտնաբառ։',
  'auth.emailTaken': 'Այս էլ. փոստով հաշիվ արդեն կա։',
  'auth.weakPassword': 'Գաղտնաբառը պետք է լինի առնվազն 8 նիշ։',
  'auth.invalidEmail': 'Էլ. փոստի սխալ հասցե։',
  'auth.signOut': 'Ելք',
  'auth.quotaLeft': 'հարց մնացել է այս ամիս',
  'auth.quotaOut': 'Այս ամսվա սահմանաչափը սպառված է։',
  'share.share': 'Կիսվել',
  'share.copied': 'Հղումը պատճենվեց',
  'share.stop': 'Դադարեցնել կիսվելը',
  'share.shared': 'Կիսված',
  'share.gone': 'Այս հղումը այլևս գործող չէ։',
  'share.readOnly': 'Կիսված խորհրդատվություն',
  'share.ownQuestion': 'Ունե՞ք Ձեր հարցը։',
  'share.openTool': 'Բացել MatyanAI-ն',
  'preview.lede':
    'Տվեք Ձեր հարկային կամ աշխատանքային հարցը։ Պատասխանը հենվում է ՀՀ օրենսդրության իրական տեքստի վրա։',
  'preview.ask': 'Հարցնել',
  'preview.thinking': 'Փնտրում եմ…',
  'preview.rest': 'Պատասխանի մնացած մասը՝ հոդվածներով և բառացի մեջբերումներով',
  'preview.sources': 'հոդված',
  'preview.unlock': 'Գրանցվել և տեսնել ամբողջը',
  'preview.free': 'Անվճար · ամսական 5 հարց',
  'preview.back': '← Վերադառնալ հարցին',
  'preview.failed': 'Չհաջողվեց ստանալ պատասխանը։',
  'preview.resuming': 'Պատրաստում եմ Ձեր ամբողջական պատասխանը…',

  'theme.auto': 'Ավտո',
  'theme.light': 'Լույս',
  'theme.dark': 'Մուգ',

  'error.credit':
    'Anthropic API-ի հաշվեկշիռը սպառվել է — սա ծրագրի սխալ չէ։ Համալրեք հաշիվը Plans & Billing բաժնում; որոնումն աշխատում է առանց դրա։',
  'error.noApi': 'API-ն չի պատասխանում',
  'norm.title': 'Աղբյուրներ',
  'norm.carried': 'Փոխանցված է նախորդ հաղորդագրություններից — կարդացվել է, բայց այս պատասխանում չի մեջբերվել։',
  'norm.openArlis': 'Բացել ARLIS-ում',
  'intro.title': 'Ես {brand}-ն եմ՝ Ձեր իրավական և հարկային աջակիցը բարդ որոշումներում։',
  'intro.start': 'Հարցերի օրինակներ',
  'cites.label': 'Կարդացված հոդվածներ',
  'masthead.sub': 'ՀՀ հարկային և աշխատանքային օրենսդրության տեղեկատու',
  'card.expand': 'Ցույց տալ հոդվածը',
  'card.collapse': 'Ծալել',
  'oneshot.placeholder': 'Հարց ռուսերեն, հայերեն կամ լատինատառ (xanut bacel)',
  'oneshot.run': 'Կատարել',
  'oneshot.nothing': 'Ոչինչ չի գտնվել։ Կորպուսը՝ հարկային և աշխատանքային օրենսդրություն՝ Հարկային օրենսգիրք, Աշխատանքային օրենսգիրք, Կառավարության որոշումներ և ՊԵԿ հրամաններ։ Քաղաքացիական իրավունքը և դատական պրակտիկան դրա մեջ չեն մտնում։',
  'search.note': 'Մոդելը չի մասնակցում — միայն գտնված հատվածները',
  'search.found': 'Գտնվել է հատված՝',
  'example.1': 'Որքա՞ն է ԱԱՀ-ի դրույքաչափը։',
  'example.2': 'Ինչպե՞ս է հաշվարկվում արձակուրդային փոխհատուցումը աշխատանքից ազատվելիս։',
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


  'composer.first': 'Опишите ситуацию или задайте вопрос…',
  'composer.next': 'Уточняющий вопрос или «сделай вывод по всему обсуждённому»',
  'composer.send': 'Отправить',

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
  'auth.signIn': 'Вход',
  'auth.register': 'Регистрация',
  'auth.signInNote': 'Войдите, чтобы увидеть свои консультации. Каждый видит только свои.',
  'auth.registerNote': 'Создайте аккаунт. Бесплатный тариф включает 5 вопросов в месяц.',
  'auth.email': 'Эл. почта',
  'auth.name': 'Имя',
  'auth.createAccount': 'Создать аккаунт',
  'auth.or': 'или',
  'auth.google': 'Продолжить с Google',
  'auth.badCredentials': 'Неверная почта или пароль.',
  'auth.emailTaken': 'Аккаунт с этой почтой уже существует.',
  'auth.weakPassword': 'Пароль должен быть не короче 8 символов.',
  'auth.invalidEmail': 'Неверный адрес почты.',
  'auth.signOut': 'Выйти',
  'auth.quotaLeft': 'вопросов осталось в этом месяце',
  'auth.quotaOut': 'Лимит вопросов на этот месяц исчерпан.',
  'share.share': 'Поделиться',
  'share.copied': 'Ссылка скопирована',
  'share.stop': 'Закрыть доступ',
  'share.shared': 'Открыт доступ',
  'share.gone': 'Эта ссылка больше не действует.',
  'share.readOnly': 'Консультация по ссылке',
  'share.ownQuestion': 'Есть свой вопрос?',
  'share.openTool': 'Открыть MatyanAI',
  'preview.lede':
    'Задайте свой налоговый или трудовой вопрос. Ответ опирается на реальный текст законодательства РА.',
  'preview.ask': 'Спросить',
  'preview.thinking': 'Ищу…',
  'preview.rest': 'Остальная часть ответа — со статьями и дословными цитатами',
  'preview.sources': 'статей',
  'preview.unlock': 'Зарегистрироваться и увидеть всё',
  'preview.free': 'Бесплатно · 5 вопросов в месяц',
  'preview.back': '← Вернуться к вопросу',
  'preview.failed': 'Не удалось получить ответ.',
  'preview.resuming': 'Готовлю ваш полный ответ…',

  'theme.auto': 'Авто',
  'theme.light': 'Светлая',
  'theme.dark': 'Тёмная',

  'error.credit':
    'Закончился баланс Anthropic API — это не ошибка приложения. Пополните счёт в Plans & Billing, поиск работает без него.',
  'error.noApi': 'API не отвечает',
  'norm.title': 'Источники',
  'norm.carried': 'Перенесено из прошлых сообщений — прочитано, но в этом ответе не процитировано.',
  'norm.openArlis': 'Открыть в ARLIS',
  'intro.title': 'Я {brand} — ваша правовая и налоговая поддержка в сложных решениях.',
  'intro.start': 'Примеры вопросов',
  'cites.label': 'Прочитанные статьи',
  'masthead.sub': 'справочник по налоговому и трудовому законодательству Республики Армения',
  'card.expand': 'Показать статью',
  'card.collapse': 'Свернуть',
  'oneshot.placeholder': 'Вопрос на русском, армянском или латиницей (xanut bacel)',
  'oneshot.run': 'Выполнить',
  'oneshot.nothing': 'Ничего не найдено. Корпус — налоговое и трудовое законодательство: Налоговый кодекс, Трудовой кодекс, решения Правительства и приказы КГД. Гражданское право и судебная практика в него не входят.',
  'search.note': 'Модель не участвует — только найденные фрагменты',
  'search.found': 'Найдено фрагментов:',
  'example.1': 'Какая ставка НДС в Армении?',
  'example.2': 'Отпускные при увольнении в середине месяца',
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


  'composer.first': 'Describe the situation or ask a question…',
  'composer.next': 'A follow-up, or “summarise everything discussed”',
  'composer.send': 'Send',

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
  'auth.signIn': 'Sign in',
  'auth.register': 'Register',
  'auth.signInNote': 'Sign in to see your consultations. Each account sees only its own.',
  'auth.registerNote': 'Create an account. The free plan includes 5 questions a month.',
  'auth.email': 'Email',
  'auth.name': 'Name',
  'auth.createAccount': 'Create account',
  'auth.or': 'or',
  'auth.google': 'Continue with Google',
  'auth.badCredentials': 'Wrong email or password.',
  'auth.emailTaken': 'An account with this email already exists.',
  'auth.weakPassword': 'Password must be at least 8 characters.',
  'auth.invalidEmail': 'Invalid email address.',
  'auth.signOut': 'Sign out',
  'auth.quotaLeft': 'questions left this month',
  'auth.quotaOut': "This month's question limit is used up.",
  'share.share': 'Share',
  'share.copied': 'Link copied',
  'share.stop': 'Stop sharing',
  'share.shared': 'Shared',
  'share.gone': 'This link is no longer active.',
  'share.readOnly': 'Shared consultation',
  'share.ownQuestion': 'Have a question of your own?',
  'share.openTool': 'Open MatyanAI',
  'preview.lede':
    'Ask your tax or labour question. The answer rests on the real text of Armenian law.',
  'preview.ask': 'Ask',
  'preview.thinking': 'Searching…',
  'preview.rest': 'The rest of the answer — with the articles and verbatim quotes',
  'preview.sources': 'articles',
  'preview.unlock': 'Register and see it all',
  'preview.free': 'Free · 5 questions a month',
  'preview.back': '← Back to your question',
  'preview.failed': 'Could not get an answer.',
  'preview.resuming': 'Preparing your full answer…',

  'theme.auto': 'Auto',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  'error.credit':
    'The Anthropic API balance is exhausted — this is not an application fault. Top up in Plans & Billing; search works without it.',
  'error.noApi': 'The API is not responding',
  'norm.title': 'Sources',
  'norm.carried': 'Carried from earlier messages — read, but not quoted in this answer.',
  'norm.openArlis': 'Open in ARLIS',
  'intro.title': 'I am {brand} — your legal and tax support in difficult decisions.',
  'intro.start': 'Example questions',
  'cites.label': 'Articles read',
  'masthead.sub': 'a reference to the tax and labour law of the Republic of Armenia',
  'card.expand': 'Show the article',
  'card.collapse': 'Collapse',
  'oneshot.placeholder': 'A question in Russian, Armenian or Latin script (xanut bacel)',
  'oneshot.run': 'Run',
  'oneshot.nothing': 'Nothing found. The corpus is tax and labour law: the Tax Code, the Labour Code, government decisions and SRC orders. Civil law and court practice are not in it.',
  'search.note': 'No model involved — retrieved fragments only',
  'search.found': 'Fragments found:',
  'example.1': 'What is the VAT rate in Armenia?',
  'example.2': 'How is unused leave compensated on dismissal?',
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
