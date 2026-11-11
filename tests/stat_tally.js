// node tests/stat_tally.js — aggregateDay_ 순수 함수 시험(합성 데이터만)
const fs = require('fs'), vm = require('vm'), assert = require('assert');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/stat-tally.gs', 'utf8'), ctx);
const raw = {
  p1: { a: 'aaaa', t: '2026-11-12', v: [{ k: 'open', t: '2026-11-12', v: '1' }, { k: 'view', t: '2026-11-12', d: 'XN', e: 'Err A' }, { k: 'fb', t: '2026-11-12', d: 'XN', e: 'Err A', r: 'y' }] },
  p2: { a: 'bbbb', t: '2026-11-12', v: [{ k: 'view', t: '2026-11-12', d: 'XN', e: 'Err A' }, { k: 'fb', t: '2026-11-12', d: 'XN', e: 'Err A', r: 'n' }, { k: 'view', t: '2026-11-12', d: 'UF', e: 'Err B' }] },
  p3: { a: 'aaaa', t: '2026-11-12', v: [{ k: 'view', t: '2026-11-12', d: 'XN', e: 'Err A' }, { k: 'zzz' }, { k: 'fb', t: '2026-11-12', d: 'XN', e: 'Err A', r: 'q' }] },
  bad: null, empty: { a: 'c' }
};
const g = ctx.aggregateDay_('2026-11-12', raw);
assert.deepStrictEqual(JSON.parse(JSON.stringify(g.day)), { date: '2026-11-12', opens: 1, devices: 2, views: 4, fb: 3 });
const a = g.errors.find(r => r.err === 'Err A'), b = g.errors.find(r => r.err === 'Err B');
assert.strictEqual(a.views, 3); assert.strictEqual(a.viewDevs, 2);
assert.strictEqual(a.y, 1); assert.strictEqual(a.n, 1); assert.strictEqual(a.o, 0); // r:'q' 는 세지 않음
assert.strictEqual(b.views, 1);
assert.strictEqual(g.errors[0].err, 'Err A'); // 많이 본 순
assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.aggregateDay_('d', null))), { day: { date: 'd', opens: 0, devices: 0, views: 0, fb: 0 }, errors: [] });
console.log('stat_tally: OK');
