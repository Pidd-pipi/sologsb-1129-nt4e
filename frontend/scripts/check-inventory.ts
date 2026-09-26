/* eslint-disable no-console */
import { describeCapacity } from '../src/types/case';
import type { TypeCase } from '../src/types/case';
import type { StocktakeRound } from '../src/types/inventory';
import {
  applyPlanToSlots,
  buildCells,
  cellLabel,
  planAdjustments,
  recordActual,
  resolveCell,
  stocktakeProgress,
} from '../src/utils/inventory';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok - ${msg}`);
}

const now = new Date().toISOString();
const fakeCase: TypeCase = {
  id: 'case-1',
  code: 'ZP-A-01',
  kind: '常用字盘',
  rows: 2,
  cols: 2,
  slots: [
    { row: 0, col: 0, character: '活', matrixId: 'm-1', placedAt: now },
    { row: 0, col: 1, character: '字', matrixId: 'm-2', placedAt: now },
    { row: 1, col: 0, character: '印', matrixId: 'm-3', placedAt: now },
    // (1,1) 账面空格
  ],
  workStation: '一号排字工位',
  matrixId: ['m-1', 'm-2', 'm-3'],
  createdAt: now,
  updatedAt: now,
};

// 1. 从当前布局生成逐格清单
let cells = buildCells(fakeCase);
assert(cells.length === 4, '逐格清单格数 = 4');
assert(cells[0].expectedCharacter === '活', 'A1 账面为「活」');
assert(cells[3].expectedCharacter === '' && cells[3].actualCharacter === null, 'B2 账面空格、初始未盘');

let p = stocktakeProgress(cells);
assert(p.total === 4 && p.checked === 0 && p.hasPending && !p.canClose, '初始全部未盘，不能结束');

// 2. 相符录入
cells = recordActual(cells, 0, 0, '活');
assert(cells[0].result === 'match', 'A1 录「活」判定相符');

// 3. 差异录入：A2 账面「字」实盘「纸」
cells = recordActual(cells, 0, 1, '纸');
assert(cells[1].result === 'diff', 'A2 录「纸」判定差异');
p = stocktakeProgress(cells);
assert(p.hasPending && p.hasUnresolvedDiff && !p.canClose, '有未盘且差异未处理，不能结束');

// 4. A2 保留账面
cells = resolveCell(cells, 0, 1, 'keep');
assert(cells[1].resolution === 'keep', 'A2 保留账面原值');

// 5. B1 账面「印」实盘空（取出）→ 确认调账
cells = recordActual(cells, 1, 0, '   ');
assert(cells[2].result === 'diff' && cells[2].actualCharacter === '', 'B1 录空白视为实盘空格差异');
cells = resolveCell(cells, 1, 0, 'adjust');
assert(cells[2].resolution === 'adjust', 'B1 确认调账（取出）');

// 6. B2 账面空实盘「刷」→ 确认调账，字模 m-4
cells = recordActual(cells, 1, 1, '刷');
assert(cells[3].result === 'diff', 'B2 实盘「刷」相对账面空格为差异');
cells = resolveCell(cells, 1, 1, 'adjust', 'm-4');

// 7. 重新录入会作废旧结论
cells = recordActual(cells, 1, 1, '墨');
assert(cells[3].result === 'diff' && cells[3].resolution === 'none', 'B2 改录「墨」后旧结论作废');
cells = resolveCell(cells, 1, 1, 'adjust', 'm-5');

// 8. 标为未盘
cells = recordActual(cells, 0, 0, null);
assert(cells[0].result === 'pending' && cells[0].actualCharacter === null, 'A1 标为未盘');
p = stocktakeProgress(cells);
assert(p.pending === 1 && !p.canClose, '有 1 格未盘不能结束');
cells = recordActual(cells, 0, 0, '活');

p = stocktakeProgress(cells);
assert(p.checked === 4 && p.matched === 1 && p.diffs === 3 && p.resolved === 3 && p.canClose,
  '全部盘完且差异处理完，可以结束');

// 9. 调账计划：保留账面格不动、调账格替换 / 取出
const matrices = [
  { id: 'm-1', character: '活' },
  { id: 'm-2', character: '字' },
  { id: 'm-5', character: '墨' },
];
const roundLike = {
  cells,
  snapshotSlots: fakeCase.slots,
} as unknown as StocktakeRound;

const plan = planAdjustments(roundLike, (character, cell) => {
  if (cell.adjustMatrixId) {
    const picked = matrices.find((m) => m.id === cell.adjustMatrixId);
    if (picked) return picked;
  }
  return matrices.find((m) => m.character === character);
});
assert(plan.changes.length === 2, '调账计划仅含 2 格（保留账面的 A2 不动）');
const changeKeys = plan.changes.map((c) => cellLabel(c.cell.row, c.cell.col)).sort();
assert(changeKeys[0] === 'B1' && changeKeys[1] === 'B2', '调账格位为 B1、B2');
const b1 = plan.changes.find((c) => c.cell.row === 1 && c.cell.col === 0);
assert(b1 && b1.slot === undefined, 'B1 实盘空格 → 取出');
const b2 = plan.changes.find((c) => c.cell.row === 1 && c.cell.col === 1);
assert(b2?.slot?.character === '墨' && b2.slot.matrixId === 'm-5', 'B2 调账为「墨」m-5');
assert(plan.warnings.length === 0, '改录后 m-4 不再出现，且无其它警告');

// 10. 应用到「当前实时布局」：模拟盘点期间 B1 无变化，只改确认调账的两格
const nextSlots = applyPlanToSlots(fakeCase.slots, plan);
assert(nextSlots.length === 3, '应用后共 3 格落位（取出 1 格、替换 1 格）');
const charAt = (r: number, c: number) => nextSlots.find((s) => s.row === r && s.col === c)?.character ?? '';
assert(charAt(0, 0) === '活', 'A1 保持「活」（相符不动）');
assert(charAt(0, 1) === '字', 'A2 保持「字」（保留账面）');
assert(charAt(1, 0) === '' && !nextSlots.some((s) => s.row === 1 && s.col === 0), 'B1 已取出');
assert(charAt(1, 1) === '墨', 'B2 已调为「墨」');
const ids = Array.from(new Set(nextSlots.map((s) => s.matrixId)));
assert(JSON.stringify(ids.sort()) === JSON.stringify(['m-1', 'm-2', 'm-5']), '字模 id 索引更新为 m-1/m-2/m-5');

// 11. 无档案字模的调账：按字符落位 + 遗留提醒
let cells2 = buildCells(fakeCase);
cells2 = recordActual(cells2, 1, 1, '罕');
cells2 = resolveCell(cells2, 1, 1, 'adjust');
const round2 = { cells: cells2, snapshotSlots: fakeCase.slots } as unknown as StocktakeRound;
const plan2 = planAdjustments(round2, () => undefined);
assert(plan2.changes[0].slot?.character === '罕' && plan2.changes[0].slot.matrixId === '',
  '无字模时按字符落位、matrixId 为空');
assert(plan2.warnings.some((w) => w.includes('罕')), '无字模产生遗留提醒');

// 12. 同一字模调两次的重复提醒
let cells3 = buildCells(fakeCase);
cells3 = recordActual(cells3, 1, 0, '字');
cells3 = recordActual(cells3, 1, 1, '字');
cells3 = resolveCell(cells3, 1, 0, 'adjust', 'm-2');
cells3 = resolveCell(cells3, 1, 1, 'adjust', 'm-2');
const round3 = { cells: cells3, snapshotSlots: fakeCase.slots } as unknown as StocktakeRound;
const plan3 = planAdjustments(round3, () => matrices.find((m) => m.id === 'm-2'));
assert(plan3.warnings.some((w) => w.includes('m-2') && w.includes('B1') && w.includes('B2')),
  '同字模调两格产生去向提醒');

console.log(describeCapacity(fakeCase.rows, fakeCase.cols));
console.log('ALL TESTS PASSED');
