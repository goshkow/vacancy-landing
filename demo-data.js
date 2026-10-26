// учебная модель для презентации: повторяет блоки и ветвление Studio, но ничего не вызывает

// pos: колонка (L, C, R) и ряд на холсте Studio
export const NODES = Object.freeze({
  incoming: Object.freeze({ kind: 'start', icon: 'play', title: 'Получить сообщение', preview: 'Telegram, текст или голос', pos: ['C', 0] }),
  kind: Object.freeze({ kind: 'condition', icon: 'split', title: 'Это голосовое?', preview: 'Проверяет тип сообщения', pos: ['C', 1] }),
  stt: Object.freeze({ kind: 'ai', icon: 'mic', title: 'Распознать речь', preview: 'Голос в текст', pos: ['L', 2] }),
  kb: Object.freeze({ kind: 'knowledge', icon: 'file', title: 'Найти в регламенте', preview: 'База знаний компании', pos: ['R', 2] }),
  collect: Object.freeze({ kind: 'ai', icon: 'sparkle', title: 'Собрать заявку', preview: 'Имя, тема, телефон', pos: ['C', 3] }),
  check: Object.freeze({ kind: 'condition', icon: 'split', title: 'Заявка полная?', preview: 'Есть имя и телефон', pos: ['C', 4] }),
  crm: Object.freeze({ kind: 'crm', icon: 'stack', title: 'Создать сделку', preview: 'CRM, новая заявка', pos: ['L', 5] }),
  reply: Object.freeze({ kind: 'message', icon: 'send', title: 'Уточнить у клиента', preview: 'Ответ в тот же чат', pos: ['R', 5] }),
  notify: Object.freeze({ kind: 'message', icon: 'send', title: 'Позвать менеджера', preview: 'Чат менеджеров', pos: ['L', 6] }),
  log: Object.freeze({ kind: 'sheet', icon: 'history', title: 'Записать в журнал', preview: 'Google Sheets', pos: ['C', 7] })
});

export const EDGES = Object.freeze([
  Object.freeze({ id: 'e1', from: 'incoming', to: 'kind', branch: null }),
  Object.freeze({ id: 'e2', from: 'kind', to: 'stt', branch: 'true' }),
  Object.freeze({ id: 'e3', from: 'kind', to: 'kb', branch: 'false' }),
  Object.freeze({ id: 'e4', from: 'stt', to: 'kb', branch: null }),
  Object.freeze({ id: 'e5', from: 'kb', to: 'collect', branch: null }),
  Object.freeze({ id: 'e6', from: 'collect', to: 'check', branch: null }),
  Object.freeze({ id: 'e7', from: 'check', to: 'crm', branch: 'true' }),
  Object.freeze({ id: 'e8', from: 'check', to: 'reply', branch: 'false' }),
  Object.freeze({ id: 'e9', from: 'crm', to: 'notify', branch: null }),
  Object.freeze({ id: 'e10', from: 'notify', to: 'log', branch: null }),
  Object.freeze({ id: 'e11', from: 'reply', to: 'log', branch: null })
]);

const SCENARIOS = Object.freeze({
  lead: Object.freeze({
    label: 'Полная заявка',
    channel: 'text',
    message: 'Здравствуйте! Я Марина, нужна консультация по договору аренды. Удобно завтра после 15:00, телефон +7 900 000-00-00',
    fields: Object.freeze({ name: 'Марина', topic: 'Договор аренды', time: 'завтра после 15:00', phone: '+7 900 000-00-00' }),
    reply: null
  }),
  question: Object.freeze({
    label: 'Только вопрос',
    channel: 'text',
    message: 'Сколько стоит консультация по наследству?',
    fields: Object.freeze({ name: null, topic: 'Наследство', time: null, phone: null }),
    reply: 'Стоимость зависит от сложности дела, на первой консультации юрист её оценит. Как к вам обращаться и по какому номеру удобно связаться?'
  }),
  voice: Object.freeze({
    label: 'Голосовое',
    channel: 'voice',
    message: 'Добрый день, это Олег. Хочу записаться на консультацию по банкротству, мой номер +7 900 000-00-01',
    fields: Object.freeze({ name: 'Олег', topic: 'Банкротство', time: null, phone: '+7 900 000-00-01' }),
    reply: null
  })
});

export const SCENARIO_IDS = Object.freeze(Object.keys(SCENARIOS));

export function scenarioLabel(id) {
  return scenarioOf(id).label;
}

function scenarioOf(id) {
  if (typeof id !== 'string' || !Object.hasOwn(SCENARIOS, id)) throw new RangeError('Неизвестный сценарий');
  return SCENARIOS[id];
}

// путь по связям: на условии берём ветку по значению, на остальных блоках единственную связь
function route(voice, ready) {
  const steps = ['incoming'];
  const edges = [];
  while (steps.at(-1) !== 'log') {
    const from = steps.at(-1);
    const out = EDGES.filter(edge => edge.from === from);
    let edge = out[0];
    if (from === 'kind') edge = out.find(item => item.branch === String(voice));
    if (from === 'check') edge = out.find(item => item.branch === String(ready));
    edges.push(edge.id);
    steps.push(edge.to);
  }
  return { steps, edges };
}

// что гаснет после условия: невыбранная связь и блоки, куда теперь не попасть
function prune(steps, edges) {
  const pruned = {};
  for (const id of steps) {
    const out = EDGES.filter(edge => edge.from === id);
    if (out.length < 2) continue;
    const nodes = new Set();
    const dim = new Set(out.filter(edge => !edges.includes(edge.id)).map(edge => edge.id));
    const queue = out.filter(edge => !edges.includes(edge.id)).map(edge => edge.to);
    while (queue.length) {
      const next = queue.shift();
      if (steps.includes(next) || nodes.has(next)) continue;
      nodes.add(next);
      for (const edge of EDGES.filter(item => item.from === next)) { dim.add(edge.id); queue.push(edge.to); }
    }
    pruned[id] = { nodes: [...nodes], edges: [...dim] };
  }
  return pruned;
}

// каждый вызов собирает новые объекты, чтобы прошлый запуск не влиял на следующий
export function buildRun(id) {
  const scenario = scenarioOf(id);
  const voice = scenario.channel === 'voice';
  const incoming = voice
    ? { channel: 'telegram', type: 'voice', duration: '0:09', transcript: scenario.message }
    : { channel: 'telegram', type: 'text', text: scenario.message };
  const fields = { ...scenario.fields };
  const ready = Boolean(fields.name && fields.topic && fields.phone);
  const collected = { ...fields, ready, ...(ready ? {} : { reply: scenario.reply }) };
  const { steps, edges } = route(voice, ready);
  const data = {
    incoming: { input: { update: 'message', chat: 'Заявки' }, output: incoming },
    kind: { input: { type: incoming.type }, output: { branch: String(voice), next: voice ? 'Расшифровать' : 'Найти в регламенте' } },
    stt: voice ? { input: { file: 'voice.ogg', duration: '0:09' }, output: { text: scenario.message } } : null,
    kb: { input: { query: scenario.message }, output: { source: 'Регламент приёма заявок', found: 2 } },
    collect: { input: { message: scenario.message, knowledge: 'Регламент приёма заявок' }, output: collected },
    check: { input: { ready }, output: { branch: String(ready), next: ready ? 'Создать сделку' : 'Ответить клиенту' } },
    crm: ready
      ? { input: { name: fields.name, topic: fields.topic, phone: fields.phone, ...(fields.time ? { time: fields.time } : {}) }, output: { deal: 'Сделка 1042', stage: 'Новая заявка' } }
      : null,
    notify: ready ? { input: { deal: 'Сделка 1042', manager: 'дежурный' }, output: { chat: 'менеджеры', delivered: true } } : null,
    reply: ready
      ? null
      : { input: { text: scenario.reply }, output: { chat: 'Заявки', delivered: true } },
    log: { input: { event: ready ? 'deal_created' : 'question_answered', channel: incoming.type }, output: { sheet: 'Журнал заявок', row: ready ? 18 : 19 } }
  };
  const missing = [['name', 'имя'], ['phone', 'телефон']].filter(([key]) => !fields[key]).map(([, label]) => label);
  const notes = {
    incoming: voice ? { text: 'Получено голосовое, 0:09' } : { text: 'Получено сообщение' },
    kind: { text: voice ? 'Это голосовое, отправляю на распознавание' : 'Это текст, распознавание не нужно' },
    stt: voice ? { text: 'Речь распознана', detail: scenario.message } : null,
    kb: { text: 'Нашёл в регламенте 2 фрагмента', detail: 'Регламент приёма заявок' },
    collect: ready
      ? { text: 'Заявка собрана', fields: [['Имя', fields.name], ['Тема', fields.topic], ['Когда', fields.time], ['Телефон', fields.phone]].filter(([, value]) => value) }
      : { text: `Не хватает: ${missing.join(', ')}`, fields: [['Тема', fields.topic]] },
    check: { text: ready ? 'Заявка полная, передаю в CRM' : 'Заявка неполная, уточню у клиента' },
    crm: ready ? { text: 'Сделка создана', detail: 'Стадия «Новая заявка»' } : null,
    notify: ready ? { text: 'Менеджер получил уведомление' } : null,
    reply: ready ? null : { text: 'Ответ отправлен клиенту' },
    log: { text: `Записано в журнал, строка ${ready ? 18 : 19}` }
  };
  return {
    id,
    label: scenario.label,
    channel: scenario.channel,
    message: scenario.message,
    reply: ready ? null : scenario.reply,
    ready,
    steps,
    edges,
    pruned: prune(steps, edges),
    data,
    notes
  };
}

// сборка сценария в hero: блоки появляются по прокрутке. координаты wide и narrow - левый верхний угол блока
export const INTRO_NODES = Object.freeze([
  Object.freeze({ id: 'a', from: 'left', kind: 'start', icon: 'play', title: 'Сообщение', preview: 'Telegram', wide: [0, 190], narrow: [90, 0] }),
  Object.freeze({ id: 'b', from: 'left', kind: 'condition', icon: 'split', title: 'Голосовое?', preview: 'Тип сообщения', wide: [220, 190], narrow: [90, 92] }),
  Object.freeze({ id: 'c', from: 'top', kind: 'ai', icon: 'mic', title: 'Речь в текст', preview: 'Распознавание', wide: [440, 60], narrow: [0, 194] }),
  Object.freeze({ id: 'd', from: 'bottom', kind: 'knowledge', icon: 'file', title: 'База знаний', preview: 'Регламент', wide: [440, 320], narrow: [180, 194] }),
  Object.freeze({ id: 'e', from: 'bottom', kind: 'ai', icon: 'sparkle', title: 'Собрать заявку', preview: 'Имя, тема, телефон', wide: [660, 190], narrow: [90, 296] }),
  Object.freeze({ id: 'f', from: 'right', kind: 'crm', icon: 'stack', title: 'Сделка в CRM', preview: 'Новая заявка', wide: [880, 60], narrow: [0, 398] }),
  Object.freeze({ id: 'g', from: 'right', kind: 'message', icon: 'send', title: 'Ответ клиенту', preview: 'Telegram', wide: [880, 320], narrow: [180, 398] })
]);

export const INTRO_EDGES = Object.freeze([
  Object.freeze(['a', 'b']), Object.freeze(['b', 'c']), Object.freeze(['b', 'd']), Object.freeze(['c', 'e']),
  Object.freeze(['d', 'e']), Object.freeze(['e', 'f']), Object.freeze(['e', 'g'])
]);

// в каком порядке курсоры приносят блоки; последний остаётся и жмёт «Запустить»
export const INTRO_ORDER = Object.freeze(['c', 'a', 'f', 'd', 'b', 'g', 'e']);

// путь тестового запуска после сборки
export const INTRO_RUN = Object.freeze(['a', 'b', 'c', 'e', 'f']);

export const DOKKY_QUESTIONS = Object.freeze([
  Object.freeze({
    id: 'prod',
    question: 'Что Иван запускал в production?',
    steps: Object.freeze(['Ищу в резюме']),
    answer: 'В «Стороженко и партнеры» Иван был единственным IT-специалистом и запустил 5+ AI-агентов: чат-боты продаж, голосовые агенты, суммаризаторы и автоматизации. Это 600+ пользователей и 18 000+ вызовов AI в день.',
    sources: Object.freeze([Object.freeze({ label: 'Опыт', href: '#experience' }), Object.freeze({ label: 'Результаты', href: '#results' })])
  }),
  Object.freeze({
    id: 'impact',
    question: 'Какой эффект дали его боты?',
    steps: Object.freeze(['Ищу цифры в резюме']),
    answer: 'Заявки обрабатываются в 10 раз быстрее, удержание в чате выросло в 3 раза, контакты оставляют в 2 раза чаще. Закрытых записей без человека стало до 7 в неделю вместо 1-2 с человеком. Более 90% собеседников не поняли, что говорят с ботом.',
    sources: Object.freeze([Object.freeze({ label: 'Результаты', href: '#results' })])
  }),
  Object.freeze({
    id: 'fit',
    question: 'Почему он подходит на AI-инженера?',
    steps: Object.freeze(['Сверяю опыт с ролью']),
    answer: 'Он сам находил процессы для автоматизации, проектировал агентов, подключал CRM, телефонию и мессенджеры и отвечал за работу в production. Плюс свои продукты: Докки и конструктор агентов Докки Studio.',
    sources: Object.freeze([Object.freeze({ label: 'Под роль', href: '#stack' }), Object.freeze({ label: 'Studio', href: '#studio' })])
  }),
  Object.freeze({
    id: 'stack',
    question: 'На чём он пишет?',
    steps: Object.freeze(['Ищу раздел «Стек»']),
    answer: 'Основа - Python и FastAPI, данные в PostgreSQL и Redis. Модели OpenAI, DeepSeek, YandexGPT и Ollama, RAG, tool calling и своя оркестрация. Интерфейсы на React и Telegram WebApp, запуск на Docker, Linux и Nginx.',
    sources: Object.freeze([Object.freeze({ label: 'Стек', href: '#stack' })])
  })
]);

export function findQuestion(id) {
  const item = DOKKY_QUESTIONS.find(question => question.id === id);
  if (!item) throw new RangeError('Неизвестный вопрос');
  return item;
}

// сценарий Докки App: план, разрешение, правка, проверка
export const APP_FLOW = Object.freeze([
  Object.freeze({ type: 'task', text: 'Добавь лимит на частоту запросов к /orders и тест на него' }),
  Object.freeze({ type: 'step', text: 'Прочитал api/orders.py и настройки' }),
  Object.freeze({ type: 'step', text: 'Нашёл готовый limiter в core/limits.py' }),
  Object.freeze({ type: 'step', text: 'Подключил его к маршруту, новый код лимитов не нужен' }),
  Object.freeze({ type: 'diff' }),
  Object.freeze({ type: 'permission', command: 'pytest tests/test_orders.py -q' }),
  Object.freeze({ type: 'result', text: '12 passed', detail: 'Изменения в рабочей области, их можно откатить.' })
]);

export const APP_DIFF = Object.freeze([
  Object.freeze({ kind: 'meta', text: 'api/orders.py' }),
  Object.freeze({ kind: 'ctx', text: 'from core.limits import limiter' }),
  Object.freeze({ kind: 'ctx', text: '' }),
  Object.freeze({ kind: 'add', text: '@limiter.limit("30/minute")' }),
  Object.freeze({ kind: 'ctx', text: '@router.post("/orders")' }),
  Object.freeze({ kind: 'del', text: 'async def create_order(body: OrderIn):' }),
  Object.freeze({ kind: 'add', text: 'async def create_order(request: Request, body: OrderIn):' })
]);
