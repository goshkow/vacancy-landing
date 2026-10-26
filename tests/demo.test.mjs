import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRun, SCENARIO_IDS, NODES, EDGES, DOKKY_QUESTIONS, findQuestion, APP_FLOW, INTRO_NODES, INTRO_EDGES, INTRO_RUN } from '../demo-data.js';

test('полная заявка идёт в CRM и не отвечает в чат', () => {
  const run = buildRun('lead');
  assert.equal(run.ready, true);
  assert.deepEqual(run.steps, ['incoming', 'kind', 'kb', 'collect', 'check', 'crm', 'notify', 'log']);
  assert.deepEqual(run.edges, ['e1', 'e3', 'e5', 'e6', 'e7', 'e9', 'e10']);
  assert.equal(run.data.reply, null);
  assert.equal(run.data.stt, null);
  assert.equal(run.data.crm.output.simulated, true);
  assert.equal(run.data.crm.input.phone, '+7 900 000-00-00');
});

test('неполная заявка уходит в уточнение, сделка не создаётся', () => {
  const run = buildRun('question');
  assert.equal(run.ready, false);
  assert.deepEqual(run.steps, ['incoming', 'kind', 'kb', 'collect', 'check', 'reply', 'log']);
  assert.equal(run.data.crm, null);
  assert.ok(run.pruned.check.nodes.includes('crm'));
  assert.ok(run.reply);
  assert.equal(run.data.collect.output.reply, run.reply);
});

test('голосовое сообщение передаёт расшифровку дальше', () => {
  const run = buildRun('voice');
  assert.equal(run.data.incoming.output.type, 'voice');
  assert.equal(run.data.collect.input.message, run.data.incoming.output.transcript);
  assert.ok(run.steps.includes('stt'));
  assert.equal(run.data.stt.output.text, run.data.incoming.output.transcript);
});

test('неизвестные и прототипные ключи не выбирают сценарий', () => {
  for (const key of ['missing', '__proto__', 'constructor', 'toString', '', null, undefined, 1]) {
    assert.throws(() => buildRun(key), RangeError);
  }
});

test('запуски изолированы друг от друга', () => {
  const first = buildRun('lead');
  first.data.collect.output.name = 'изменено';
  first.steps.push('лишний');
  const second = buildRun('lead');
  assert.equal(second.data.collect.output.name, 'Марина');
  assert.equal(second.steps.includes('лишний'), false);
});

test('маршрут каждого сценария проходит по существующим связям', () => {
  for (const id of SCENARIO_IDS) {
    const run = buildRun(id);
    run.edges.forEach((edgeId, index) => {
      const edge = EDGES.find(item => item.id === edgeId);
      assert.ok(edge, edgeId);
      assert.equal(edge.from, run.steps[index]);
      assert.equal(edge.to, run.steps[index + 1]);
    });
    for (const step of run.steps) {
      assert.ok(NODES[step], step);
      assert.ok(run.data[step].input && run.data[step].output, step);
    }
  }
});

test('ветка условия совпадает с готовностью заявки', () => {
  for (const id of SCENARIO_IDS) {
    const run = buildRun(id);
    const edge = EDGES.find(item => item.from === 'check' && run.edges.includes(item.id));
    assert.equal(edge.branch, String(run.ready));
    assert.equal(run.data.check.output.branch, String(run.ready));
  }
});

test('ответы Докки ссылаются на разделы страницы', () => {
  const ids = new Set();
  for (const item of DOKKY_QUESTIONS) {
    assert.ok(item.question && item.answer && item.steps.length);
    assert.ok(!ids.has(item.id));
    ids.add(item.id);
    for (const source of item.sources) assert.match(source.href, /^#[a-z]+$/);
  }
  assert.throws(() => findQuestion('нет'), RangeError);
});

test('сценарий Докки App просит разрешение до проверки', () => {
  const types = APP_FLOW.map(item => item.type);
  assert.equal(types[0], 'task');
  assert.ok(types.indexOf('permission') < types.indexOf('result'));
  assert.ok(types.indexOf('diff') < types.indexOf('permission'));
});

test('у каждого выполненного шага есть понятное событие для чата', () => {
  for (const id of SCENARIO_IDS) {
    const run = buildRun(id);
    for (const step of run.steps) assert.ok(run.notes[step]?.text, `${id}: ${step}`);
    for (const key of Object.keys(NODES)) {
      if (!run.steps.includes(key)) assert.equal(run.notes[key], null, `${id}: ${key}`);
    }
  }
  assert.match(buildRun('question').notes.collect.text, /имя, телефон/);
  assert.deepEqual(buildRun('lead').notes.collect.fields.map(([key]) => key), ['Имя', 'Тема', 'Когда', 'Телефон']);
});

test('блоки Studio не пересекаются на сетке', () => {
  const cells = Object.values(NODES).map(node => node.pos.join(':'));
  assert.equal(new Set(cells).size, cells.length);
  for (const node of Object.values(NODES)) assert.ok(['L', 'C', 'R'].includes(node.pos[0]));
});

test('сценарий сборки в hero связный, запуск идёт по существующим связям', () => {
  const ids = INTRO_NODES.map(node => node.id);
  const order = new Map(ids.map((id, i) => [id, i]));
  for (const [from, to] of INTRO_EDGES) {
    assert.ok(order.has(from) && order.has(to));
    // связь тянется к блоку, который появляется позже
    assert.ok(order.get(from) < order.get(to));
  }
  INTRO_RUN.slice(1).forEach((id, i) => {
    assert.ok(INTRO_EDGES.some(([from, to]) => from === INTRO_RUN[i] && to === id));
  });
  for (const node of INTRO_NODES) assert.ok(node.wide.length === 2 && node.narrow.length === 2);
});
