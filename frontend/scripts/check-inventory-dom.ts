/* eslint-disable no-console */
import './dom-harness';
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import Inventory from '../src/pages/Inventory';
import { useCaseStore } from '../src/stores/caseStore';
import { useMatrixStore } from '../src/stores/matrixStore';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok - ${msg}`);
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

async function input(el: Element | null, value: string) {
  if (!el) throw new Error('element missing');
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    ?? Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

async function select(el: Element | null, value: string) {
  if (!el) throw new Error('select missing');
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    ?? Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

async function click(testid: string) {
  const el = document.querySelector(`[data-testid="${testid}"]`) as HTMLElement | null;
  assert(!!el, `找到元素 ${testid}`);
  await act(async () => {
    el.click();
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function main() {
  // AppShell 负责加载业务档案，单测中显式加载（会触发首次种子）
  await Promise.all([
    useCaseStore.getState().load(),
    useMatrixStore.getState().load(),
  ]);

  const container = document.getElementById('root')!;
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <Inventory />
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 50));
  });

assert(!!document.querySelector('[data-testid="inventory-title"]'), '盘点页标题渲染');
assert(!!document.querySelector('[data-testid="stocktake-start-form"]'), '发起盘点表单渲染');

// 选择第一个字盘并填写保管员，发起盘点
const caseSelect = document.querySelector('[data-testid="stocktake-case-select"]') as HTMLSelectElement;
await select(caseSelect, 'case-1001');
await input(document.querySelector('[data-testid="stocktake-keeper-input"]'), '周介庵');
await click('start-stocktake-btn');
await flush();

assert(!!document.querySelector('[data-testid="stocktake-workspace"]'), '发起后进入盘点工作台');
assert(
  document.querySelector('[data-testid="stocktake-grid"]')?.getAttribute('data-rows') === '6',
  '盘点网格按 6 行渲染（ZP-A-01 = 6×8）',
);
assert(
  document.querySelectorAll('[data-testid^="st-cell-"]').length === 48,
  '渲染 48 个格位',
);
assert((document.querySelector('[data-testid="st-checked"]')?.textContent ?? '').includes('0/48'), '初始已盘 0/48');

// 第一格 A1 账面为「活」：点击该格 → 用字符选择器录入「活」→ 判定相符
await click('st-cell-0-0');
await flush();
await input(document.querySelector('[data-testid="st-char-picker-input"]'), '活');
await flush();
assert(
  document.querySelector('[data-testid="st-cell-0-0"]')?.getAttribute('data-result') === 'match',
  'A1 录入「活」后显示相符（绿）',
);
assert((document.querySelector('[data-testid="st-checked"]')?.textContent ?? '').includes('1/48'), '已盘更新为 1/48');

// 第二格 A2 账面「字」录成空格 → 差异，结束按钮仍禁用
await click('st-cell-0-1');
await flush();
await click('record-empty-btn');
await flush();
assert(
  document.querySelector('[data-testid="st-cell-0-1"]')?.getAttribute('data-result') === 'diff',
  'A2 记为空格后显示差异（红）',
);
assert(!!document.querySelector('[data-testid="diff-panel"]'), '差异处理面板出现');
const finishBtn = document.querySelector('[data-testid="finish-stocktake-btn"]') as HTMLButtonElement;
assert(finishBtn.disabled, '还有未盘格位时结束按钮禁用');
assert(
  (document.querySelector('[data-testid="finish-hint"]')?.textContent ?? '').includes('未盘 46 格'),
  `结束提示显示未盘 46 格，实际：${document.querySelector('[data-testid="finish-hint"]')?.textContent ?? ''}`,
);

// 保留账面
await click('keep-book-btn');
await flush();
assert(
  (document.querySelector('[data-testid="st-resolution-0-1"]')?.textContent ?? '').includes('保留账面'),
  '清单中 A2 标记为保留账面',
);

// 清单过滤：只看未盘
await click('filter-pending');
await flush();
assert(
  document.querySelectorAll('[data-testid^="st-row-"]').length === 46,
  '未盘筛选显示 46 行（48 - 相符1 - 差异1）',
);
await click('filter-all');
await flush();

// 切换到历史 tab 区域：尚无历史
assert(
  (document.querySelector('[data-testid="history-empty"]')?.textContent ?? '').includes('还没有已结束的盘点'),
  '历史空态渲染',
);

// ---------------------------------------------------------------------------
// 完整收尾：其余格按账面录相符 → 再造一格调账差异 → 结束 → 调账生效 → 历史留存
// ---------------------------------------------------------------------------
const { useInventoryStore } = await import('../src/stores/inventoryStore');
const inv = useInventoryStore.getState();
const open = inv.rounds.find((r) => r.status === 'open')!;
assert(!!open, '存在进行中的盘点批次');
for (const c0 of open.cells) {
  if (c0.result === 'pending') await inv.recordCell(open.id, c0.row, c0.col, c0.expectedCharacter);
}
await flush();
// D1（3,0）账面空 → 实盘「匠」并在 UI 上确认调账
await inv.recordCell(open.id, 3, 0, '匠');
await flush();
await click('st-cell-3-0');
await flush();
// 调账字模下拉默认选 m-1015，直接点确认调账
await click('confirm-adjust-btn');
await flush();
assert(
  (document.querySelector('[data-testid="st-resolution-3-0"]')?.textContent ?? '').includes('确认调账'),
  '清单中 D1 标记为确认调账',
);

// 现在所有差异已处理 → 结束按钮可点
const finishBtn2 = document.querySelector('[data-testid="finish-stocktake-btn"]') as HTMLButtonElement;
assert(!finishBtn2.disabled, '差异处理完后结束按钮可用');
await click('finish-stocktake-btn');
await flush();
assert(!!document.querySelector('[data-testid="confirm-finish-btn"]'), '出现二次确认');
await click('confirm-finish-btn');
await flush();

// 工作台消失，历史区出现本轮批次，且记录 1 格调账
assert(!document.querySelector('[data-testid="stocktake-workspace"]'), '结束后工作台收起');
const histItem = document.querySelector('[data-testid^="history-item-"]');
assert(!!histItem, '差异历史列表出现已结束批次');
assert((histItem?.textContent ?? '').includes('差异 2'), `历史摘要含「差异 2」：${histItem?.textContent ?? ''}`);
assert((histItem?.textContent ?? '').includes('调账 1 格'), '历史摘要含「调账 1 格」');

// 展开历史，看到两条差异结论
histItem?.querySelector('[data-testid^="history-toggle-"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await flush();
const histRows = document.querySelectorAll('[data-testid^="history-diff-"]');
assert(histRows.length === 2, `历史明细列出 2 条差异，实际 ${histRows.length}`);

// 字盘布局已调账：D1 = 匠 m-1015（跨字盘提醒）
const { useCaseStore: ucs } = await import('../src/stores/caseStore');
await ucs.getState().load();
const cA = ucs.getState().cases.find((c) => c.code === 'ZP-A-01')!;
const d1Slot = cA.slots.find((s) => s.row === 3 && s.col === 0);
assert(d1Slot?.character === '匠' && d1Slot.matrixId === 'm-1015', '结束后字盘 D1 已调账为「匠」m-1015');
const a2Slot = cA.slots.find((s) => s.row === 0 && s.col === 1);
assert(a2Slot?.character === '字', '保留账面的 A2 仍是「字」');
const cB = ucs.getState().cases.find((c) => c.code === 'ZP-B-02')!;
assert(JSON.stringify(cB.slots.map((s) => s.character)) === JSON.stringify(['匠', '序']), '其它字盘未受影响');

console.log('DOM SMOKE TESTS PASSED');
  root.unmount();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
