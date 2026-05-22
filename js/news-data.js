function isoDaysAgo(days){
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
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
    image: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'tech',
    slug: 'ukrainian-startups-eu-market',
    title: 'Українські стартапи активніше виходять на європейський ринок: які ніші ростуть',
    excerpt: 'Команди роблять ставку на B2B-сервіси, аналітику та автоматизацію. Розбираємо, що допомагає масштабуватися.',
    tags: ['стартапи', 'економіка'],
    image: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'tech',
    slug: 'smartphone-privacy-basics',
    title: 'Смартфони отримали нові інструменти приватності: що варто увімкнути одразу',
    excerpt: 'Пояснюємо простими словами, які дозволи краще обмежити і як перевірити тихі фонові доступи застосунків.',
    tags: ['приватність', 'поради'],
    image: 'https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'tech',
    slug: 'ai-assistants-data-safety',
    title: 'ШІ-помічники в роботі: як не злити дані клієнтів і не зламати процеси',
    excerpt: 'Три правила безпеки, приклади коректних задач для ШІ та типові помилки команд, які переходять на автоматизацію.',
    tags: ['AI', 'безпека'],
    image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'world',
    slug: 'eu-inflation-markets',
    title: 'Європейські ринки реагують на нові дані щодо інфляції: що це означає для споживачів',
    excerpt: 'Коливання ставок і цін впливають на кредити та заощадження. Пояснюємо, які сценарії розглядають аналітики.',
    tags: ['економіка', 'пояснення'],
    image: 'https://images.unsplash.com/photo-1559526324-593bc073d938?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'world',
    slug: 'smart-transport-cities',
    title: 'Міста оновлюють транспортні стратегії: більше розумних зупинок і пріоритет для громадського транспорту',
    excerpt: 'Тренд на менше заторів і більше прогнозованості. Дивимось на рішення, які найчастіше обирають мегаполіси.',
    tags: ['міста', 'транспорт'],
    image: 'https://images.unsplash.com/photo-1465447142348-e9952c393450?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'world',
    slug: 'climate-insurance-costs',
    title: 'Кліматичні ризики змінюють правила страхування: чому поліси дорожчають',
    excerpt: 'Пояснюємо, як погодні екстреми впливають на ціни та які інструменти зменшують ризики для домогосподарств.',
    tags: ['клімат', 'пояснення'],
    image: 'https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'world',
    slug: 'education-after-pandemic',
    title: 'Освіта після пандемії: університети переглядають формати навчання і оцінювання',
    excerpt: 'Гібридні моделі залишаються, але правила стають жорсткішими. Розбираємо, що змінюється для студентів.',
    tags: ['освіта', 'суспільство'],
    image: 'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'politics',
    slug: 'public-procurement-rules-update',
    title: 'У парламенті обговорюють оновлення правил держзакупівель: ключові зміни',
    excerpt: 'Що пропонують змінити, які аргументи у сторін і як це може вплинути на бізнес та громади.',
    tags: ['реформа', 'пояснення'],
    image: 'https://images.unsplash.com/photo-1529107386315-e1a2ed48a620?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'politics',
    slug: 'local-budgets-2026',
    title: 'Місцеві бюджети: які статті витрат зростають і чому це важливо',
    excerpt: 'Пояснюємо на прикладах: інфраструктура, освіта, соціальні програми. Де найчастіше виникають вузькі місця.',
    tags: ['економіка', 'громади'],
    image: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'politics',
    slug: 'epetitions-guide',
    title: 'Прозорість рішень: як працюють електронні петиції та що підвищує шанс відповіді',
    excerpt: 'Короткий гайд: як формулювати пропозицію, які дані додавати і як відстежувати прогрес.',
    tags: ['цифровізація', 'гайд'],
    image: 'https://images.unsplash.com/photo-1454165205744-3b78555e5572?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'politics',
    slug: 'small-business-regulation',
    title: 'Регуляція малого бізнесу: які зміни обговорюють і що хвилює підприємців',
    excerpt: 'Зібрали позиції сторін та перелік запитань, які найчастіше ставлять підприємці в публічних консультаціях.',
    tags: ['бізнес', 'пояснення'],
    image: 'https://images.unsplash.com/photo-1444653614773-995cb1ef9efa?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'sport',
    slug: 'national-team-squad',
    title: 'Збірна оголосила заявку на турнір: на кого робить ставку тренерський штаб',
    excerpt: 'Є кілька несподіваних рішень. Розбираємо склад і можливі тактичні схеми.',
    tags: ['огляд', 'команда'],
    image: 'https://images.unsplash.com/photo-1521412644187-c49fa049e84d?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'sport',
    slug: 'running-season-plan',
    title: 'Біговий сезон стартує: як підготуватися без травм і з прогресом',
    excerpt: 'План на 4 тижні для початківців, розминка, відновлення та типові помилки, які ламають мотивацію.',
    tags: ['здоровʼя', 'гайд'],
    image: 'https://images.unsplash.com/photo-1502904550040-7534597429ae?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'sport',
    slug: 'sports-analytics-impact',
    title: 'Клуби роблять ставку на аналітику: як дані впливають на трансфери та тактику',
    excerpt: 'Від GPS-трекінгу до відеоаналізу: що реально допомагає, а що поки більше маркетинг.',
    tags: ['аналітика', 'технології'],
    image: 'https://images.unsplash.com/photo-1547347298-4074fc3086f0?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'sport',
    slug: 'home-workout-routine',
    title: 'Домашні тренування: мінімум спорядження - максимум користі',
    excerpt: 'Проста програма на 20 хвилин, яку можна робити вдома. Підійде для підтримки форми без залу.',
    tags: ['фітнес', 'поради'],
    image: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'culture',
    slug: 'festival-program-guide',
    title: 'Фестиваль оголосив програму: що подивитися і як спланувати день',
    excerpt: 'Добірка подій, поради щодо квитків та кілька рекомендацій, щоб не пропустити головне.',
    tags: ['афіша', 'гайд'],
    image: 'https://images.unsplash.com/photo-1459749411175-04bf5292ceea?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'culture',
    slug: 'modern-art-exhibition',
    title: 'Нова виставка про сучасне мистецтво: які теми піднімають художники',
    excerpt: 'Гід по експозиції: на що звернути увагу, як читати підказки кураторів і з чого почати.',
    tags: ['мистецтво', 'огляд'],
    image: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'culture',
    slug: 'cinema-week-premieres',
    title: 'Кінотиждень: пʼять премʼєр, які обговорюють найбільше',
    excerpt: 'Від драм до документалістики - коротко, без спойлерів: кому що зайде і чому ці фільми стали подіями.',
    tags: ['кіно', 'добірка'],
    image: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80'
  },
  {
    category: 'culture',
    slug: 'reading-habit-without-burnout',
    title: 'Як читати більше без вигорання: поради для тих, хто не встигає',
    excerpt: 'Малі звички, правильний вибір формату і простий план, який допомагає повернути регулярне читання.',
    tags: ['книги', 'поради'],
    image: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=1200&q=80'
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
  dateISO: isoDaysAgo(i),
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
