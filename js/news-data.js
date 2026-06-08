const NEWS_BASE_DATE_UTC = Date.UTC(2026, 3, 8);

function fixedIsoDate(daysBeforeBase){
  return new Date(NEWS_BASE_DATE_UTC - (daysBeforeBase * 86400000))
    .toISOString()
    .slice(0, 10);
}

export const CATEGORIES = [
  { key: 'all', label: 'Всі' },
  { key: 'politics', label: 'Політика' },
  { key: 'tech', label: 'Технології' },
  { key: 'sport', label: 'Спорт' },
  { key: 'world', label: 'Світ' },
  { key: 'culture', label: 'Культура' }
];

const ARTICLES = [
  {
    category: 'tech',
    slug: 'messenger-phishing-checklist',
    title: 'Нова хвиля фішингу в месенджерах: як розпізнати підробку за 30 секунд',
    excerpt: 'Шахраї змістили фокус на термінові повідомлення та фальшиві сторінки входу. Ось короткий чек-лист ознак і дій.',
    tags: ['кібербезпека', 'гайд'],
    image: 'assets/images/news-01.jpg'
  },
  {
    category: 'tech',
    slug: 'ukrainian-startups-eu-market',
    title: 'Українські стартапи активніше виходять на європейський ринок: які ніші ростуть',
    excerpt: 'Команди роблять ставку на B2B-сервіси, аналітику та автоматизацію. Розбираємо, що допомагає масштабуватися.',
    tags: ['стартапи', 'економіка'],
    image: 'assets/images/news-02.jpg'
  },
  {
    category: 'tech',
    slug: 'smartphone-privacy-basics',
    title: 'Смартфони отримали нові інструменти приватності: що варто увімкнути одразу',
    excerpt: 'Пояснюємо простими словами, які дозволи краще обмежити і як перевірити тихі фонові доступи застосунків.',
    tags: ['приватність', 'поради'],
    image: 'assets/images/news-03.jpg'
  },
  {
    category: 'tech',
    slug: 'ai-assistants-data-safety',
    title: 'ШІ-помічники в роботі: як не злити дані клієнтів і не зламати процеси',
    excerpt: 'Три правила безпеки, приклади коректних задач для ШІ та типові помилки команд, які переходять на автоматизацію.',
    tags: ['AI', 'безпека'],
    image: 'assets/images/news-04.jpg'
  },
  {
    category: 'world',
    slug: 'eu-inflation-markets',
    title: 'Європейські ринки реагують на нові дані щодо інфляції: що це означає для споживачів',
    excerpt: 'Коливання ставок і цін впливають на кредити та заощадження. Пояснюємо, які сценарії розглядають аналітики.',
    tags: ['економіка', 'пояснення'],
    image: 'assets/images/news-05.jpg'
  },
  {
    category: 'world',
    slug: 'smart-transport-cities',
    title: 'Міста оновлюють транспортні стратегії: більше розумних зупинок і пріоритет для громадського транспорту',
    excerpt: 'Тренд на менше заторів і більше прогнозованості. Дивимось на рішення, які найчастіше обирають мегаполіси.',
    tags: ['міста', 'транспорт'],
    image: 'assets/images/news-06.jpg'
  },
  {
    category: 'world',
    slug: 'climate-insurance-costs',
    title: 'Кліматичні ризики змінюють правила страхування: чому поліси дорожчають',
    excerpt: 'Пояснюємо, як погодні екстреми впливають на ціни та які інструменти зменшують ризики для домогосподарств.',
    tags: ['клімат', 'пояснення'],
    image: 'assets/images/news-07.jpg'
  },
  {
    category: 'world',
    slug: 'education-after-pandemic',
    title: 'Освіта після пандемії: університети переглядають формати навчання і оцінювання',
    excerpt: 'Гібридні моделі залишаються, але правила стають жорсткішими. Розбираємо, що змінюється для студентів.',
    tags: ['освіта', 'суспільство'],
    image: 'assets/images/news-08.jpg'
  },
  {
    category: 'politics',
    slug: 'public-procurement-rules-update',
    title: 'У парламенті обговорюють оновлення правил держзакупівель: ключові зміни',
    excerpt: 'Що пропонують змінити, які аргументи у сторін і як це може вплинути на бізнес та громади.',
    tags: ['реформа', 'пояснення'],
    image: 'assets/images/news-09.jpg'
  },
  {
    category: 'politics',
    slug: 'local-budgets-2026',
    title: 'Місцеві бюджети: які статті витрат зростають і чому це важливо',
    excerpt: 'Пояснюємо на прикладах: інфраструктура, освіта, соціальні програми. Де найчастіше виникають вузькі місця.',
    tags: ['економіка', 'громади'],
    image: 'assets/images/news-10.jpg'
  },
  {
    category: 'politics',
    slug: 'epetitions-guide',
    title: 'Прозорість рішень: як працюють електронні петиції та що підвищує шанс відповіді',
    excerpt: 'Короткий гайд: як формулювати пропозицію, які дані додавати і як відстежувати прогрес.',
    tags: ['цифровізація', 'гайд'],
    image: 'assets/images/news-11.jpg'
  },
  {
    category: 'politics',
    slug: 'small-business-regulation',
    title: 'Регуляція малого бізнесу: які зміни обговорюють і що хвилює підприємців',
    excerpt: 'Зібрали позиції сторін та перелік запитань, які найчастіше ставлять підприємці в публічних консультаціях.',
    tags: ['бізнес', 'пояснення'],
    image: 'assets/images/news-12.jpg'
  },
  {
    category: 'sport',
    slug: 'national-team-squad',
    title: 'Збірна оголосила заявку на турнір: на кого робить ставку тренерський штаб',
    excerpt: 'Є кілька несподіваних рішень. Розбираємо склад і можливі тактичні схеми.',
    tags: ['огляд', 'команда'],
    image: 'assets/images/news-13.jpg'
  },
  {
    category: 'sport',
    slug: 'running-season-plan',
    title: 'Біговий сезон стартує: як підготуватися без травм і з прогресом',
    excerpt: 'План на 4 тижні для початківців, розминка, відновлення та типові помилки, які ламають мотивацію.',
    tags: ['здоровʼя', 'гайд'],
    image: 'assets/images/news-14.jpg'
  },
  {
    category: 'sport',
    slug: 'sports-analytics-impact',
    title: 'Клуби роблять ставку на аналітику: як дані впливають на трансфери та тактику',
    excerpt: 'Від GPS-трекінгу до відеоаналізу: що реально допомагає, а що поки більше маркетинг.',
    tags: ['аналітика', 'технології'],
    image: 'assets/images/news-15.jpg'
  },
  {
    category: 'sport',
    slug: 'home-workout-routine',
    title: 'Домашні тренування: мінімум спорядження - максимум користі',
    excerpt: 'Проста програма на 20 хвилин, яку можна робити вдома. Підійде для підтримки форми без залу.',
    tags: ['фітнес', 'поради'],
    image: 'assets/images/news-16.jpg'
  },
  {
    category: 'culture',
    slug: 'festival-program-guide',
    title: 'Фестиваль оголосив програму: що подивитися і як спланувати день',
    excerpt: 'Добірка подій, поради щодо квитків та кілька рекомендацій, щоб не пропустити головне.',
    tags: ['афіша', 'гайд'],
    image: 'assets/images/news-17.jpg'
  },
  {
    category: 'culture',
    slug: 'modern-art-exhibition',
    title: 'Нова виставка про сучасне мистецтво: які теми піднімають художники',
    excerpt: 'Гід по експозиції: на що звернути увагу, як читати підказки кураторів і з чого почати.',
    tags: ['мистецтво', 'огляд'],
    image: 'assets/images/news-18.jpg'
  },
  {
    category: 'culture',
    slug: 'cinema-week-premieres',
    title: 'Кінотиждень: пʼять премʼєр, які обговорюють найбільше',
    excerpt: 'Від драм до документалістики - коротко, без спойлерів: кому що зайде і чому ці фільми стали подіями.',
    tags: ['кіно', 'добірка'],
    image: 'assets/images/news-19.jpg'
  },
  {
    category: 'culture',
    slug: 'reading-habit-without-burnout',
    title: 'Як читати більше без вигорання: поради для тих, хто не встигає',
    excerpt: 'Малі звички, правильний вибір формату і простий план, який допомагає повернути регулярне читання.',
    tags: ['книги', 'поради'],
    image: 'assets/images/news-20.jpg'
  }
];

function categoryLabel(key){
  return CATEGORIES.find((c) => c.key === key)?.label || key;
}

export const NEWS = ARTICLES.map((a, i) => ({
  id: `n${i + 1}`,
  slug: a.slug,
  title: a.title,
  excerpt: a.excerpt,
  category: a.category,
  categoryLabel: categoryLabel(a.category),
  dateISO: fixedIsoDate(i),
  minutes: 3 + (i % 6),
  url: a.url ?? `/news/${a.slug}`,
  image: a.image,
  imageAlt: a.title,
  tags: a.tags || [],
  content: a.content || [
    a.excerpt,
    `Матеріал у категорії "${categoryLabel(a.category)}" зібраний як короткий практичний огляд для швидкого ознайомлення.`,
    `Ключові теми: ${(a.tags || []).join(', ')}.`
  ]
}));
