/* eslint-disable no-console */
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { db } from '../src/db';
import { useCaseStore } from '../src/stores/caseStore';
import { useInventoryStore } from '../src/stores/inventoryStore';
import { useMatrixStore } from '../src/stores/matrixStore';
import type { CaseSlot, TypeCase } from '../src/types/case';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok - ${msg}`);
}

const DB_NAME = 'gbmovabletype-db';
const phase = process.argv[2] ?? 'flow';

async function deleteDb(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

// ---------------------------------------------------------------------------
// 阶段一：v3 旧库 → v4 升级，旧数据原样保留、盘点表自动建立
// ---------------------------------------------------------------------------
async function runMigration() {
  await deleteDb();
  const old = new Dexie(DB_NAME);
  old.version(1).stores({ matrices: 'id, code, character, font, sizeName, material, availability' });
  old.version(2).stores({
    matrices: 'id, code, character, font, sizeName, material, availability',
    cases: 'id, code, kind, workStation, *matrixId',
  });
  old.version(3).stores({
    matrices: 'id, code, character, font, sizeName, material, availability',
    cases: 'id, code, kind, workStation, *matrixId',
    defects: 'id, matrixId, defectType, severity, availability, foundDate',
    proofs: 'id, matrixId, sampleNo, clarity, proofDate',
  });
  await old.open();
  const now = new Date().toISOString();
  await old.table('matrices').add({
    id: 'm-old', code: 'ZM-2000-999', character: '旧', font: '宋体', sizeName: '五号', sizePt: 10.5,
    material: '铅合金', faceWidthMm: 3.7, bodyHeightMm: 5.6, madeYear: 2000, engraver: '老刻工',
    availability: '可用', note: '升级前已有的本机数据', createdAt: now, updatedAt: now,
  });
  await old.close();
  assert((await Dexie.exists(DB_NAME)) === true, 'v3 旧库已建立');

  await useCaseStore.getState().load();
  await useInventoryStore.getState().load();

  assert((await db.matrices.count()) === 1, '升级后旧字模档案原样保留（仍为 1 条，不触发种子）');
  assert((await db.stocktakes.count()) === 0, 'v4 盘点表已建立（初始为空）');
  const tables = db.tables.map((t) => t.name).sort();
  assert(
    JSON.stringify(tables) === JSON.stringify(['cases', 'defects', 'matrices', 'proofs', 'stocktakes']),
    `v4 共 5 张表：${tables.join('/')}`,
  );
  const oldMatrix = await db.matrices.get('m-old');
  assert(oldMatrix?.note === '升级前已有的本机数据', '旧字模备注字段完好');
  const oldM = oldMatrix!;
  assert(oldM.sizePt === 10.5 && oldM.availability === '可用', '旧字模磅值与可用性字段完好');
  console.log('MIGRATION TESTS PASSED');
}

// ---------------------------------------------------------------------------
// 阶段二：全新 v4 库 + 端到端盘点流程
// ---------------------------------------------------------------------------
async function runFlow() {
  await deleteDb();
  await useCaseStore.getState().load();
  await useMatrixStore.getState().load();
  await useInventoryStore.getState().load();
  assert((await db.matrices.count()) === 16, '新库种子：16 枚字模');
  assert((await db.cases.count()) === 2, '新库种子：2 个字盘');
  assert((await db.stocktakes.count()) === 0, '新库盘点表为空');

  const targetCase = useCaseStore.getState().cases.find((c) => c.code === 'ZP-A-01') as TypeCase;
  assert(!!targetCase && targetCase.slots.length === 12, '取到种子字盘 ZP-A-01（12 格落位）');

  await useInventoryStore.getState().startRound(
    { caseId: targetCase.id, keeper: '周介庵', note: '三季度盘点' },
    targetCase,
  );

  let saveBlocked = '';
  try {
    await useCaseStore.getState().saveSlots(targetCase.id, targetCase.slots);
  } catch (e) {
    saveBlocked = e instanceof Error ? e.message : String(e);
  }
  assert(saveBlocked.includes('锁定'), `盘点期间布局保存被拒：${saveBlocked}`);

  let dupBlocked = '';
  try {
    await useInventoryStore.getState().startRound({ caseId: targetCase.id, keeper: '周介庵' }, targetCase);
  } catch (e) {
    dupBlocked = e instanceof Error ? e.message : String(e);
  }
  assert(dupBlocked.includes('进行中'), `同字盘重复发起被拒：${dupBlocked}`);

  const inv = useInventoryStore.getState();
  const round = inv.rounds.find((r) => r.caseId === targetCase.id && r.status === 'open')!;
  assert(round.cells.length === targetCase.rows * targetCase.cols, '逐格清单按 行×列 生成（48 格）');
  assert(round.snapshotSlots.length === 12, '账面快照冻结 12 格');

  for (const cell of round.cells) {
    await inv.recordCell(round.id, cell.row, cell.col, cell.expectedCharacter);
  }
  // 差异一：A2（0,1）账面「字」实盘空格 → 最终保留账面
  await inv.recordCell(round.id, 0, 1, '');
  // 差异二：D1（3,0）账面空格，实盘「匠」（m-1015 当前落在 B 盘 A1）
  const d1 = round.cells.find((c) => c.row === 3 && c.col === 0)!;
  assert(d1.expectedCharacter === '', 'D1 账面为空格');
  const matrixJiang = useMatrixStore.getState().matrices.find((m) => m.character === '匠');
  assert(matrixJiang?.id === 'm-1015', '找到「匠」字模 m-1015');
  await inv.recordCell(round.id, 3, 0, '匠');

  const statsOf = (cells: { result: string; resolution: string }[]) => {
    let pending = 0;
    let diffs = 0;
    let resolved = 0;
    for (const c of cells) {
      if (c.result === 'pending') pending += 1;
      if (c.result === 'diff') diffs += 1;
      if (c.result === 'diff' && c.resolution !== 'none') resolved += 1;
    }
    return { pending, diffs, resolved };
  };
  const liveRound = useInventoryStore.getState().rounds.find((r) => r.id === round.id)!;
  const s1 = statsOf(liveRound.cells);
  assert(s1.pending === 0 && s1.diffs === 2 && s1.resolved === 0, '全部已盘，形成 2 处差异、0 处理');

  let closeBlocked = '';
  try {
    await inv.closeRound(round.id, useMatrixStore.getState().matrices);
  } catch (e) {
    closeBlocked = e instanceof Error ? e.message : String(e);
  }
  assert(closeBlocked.includes('差异未处理'), `差异未处理完不能结束：${closeBlocked}`);

  await inv.resolveCellDiff(round.id, 0, 1, 'keep');
  await inv.resolveCellDiff(round.id, 3, 0, 'adjust', matrixJiang!.id);

  const { warnings } = await inv.closeRound(round.id, useMatrixStore.getState().matrices);
  assert(
    warnings.some((w) => w.includes('m-1015') && w.includes('ZP-B-02')),
    `跨字盘去向提醒：${warnings.join('；') || '（无）'}`,
  );

  const closed = await db.stocktakes.get(round.id);
  assert(closed.status === 'closed' && !!closed.closedAt, '盘点状态已结束并记录结束时间');
  assert(closed.appliedCount === 1, '仅 1 格确认调账（保留账面的 A2 不计调账）');
  const keptDiff = closed.cells.find(
    (c: CaseSlot & { row: number; col: number }) => c.row === 0 && c.col === 1,
  );
  assert(
    keptDiff.result === 'diff' && keptDiff.resolution === 'keep' && keptDiff.actualCharacter === '',
    '差异历史 A2：实盘空、结论保留账面',
  );
  const adjDiff = closed.cells.find((c: { row: number; col: number }) => c.row === 3 && c.col === 0);
  assert(
    adjDiff.result === 'diff' && adjDiff.resolution === 'adjust' && adjDiff.adjustMatrixId === 'm-1015',
    '差异历史 D1：调账 m-1015',
  );

  await useCaseStore.getState().load();
  const updated = useCaseStore.getState().cases.find((c) => c.id === targetCase.id)!;
  const a2 = updated.slots.find((s) => s.row === 0 && s.col === 1);
  const d1Slot = updated.slots.find((s) => s.row === 3 && s.col === 0);
  assert(a2?.character === '字' && a2.matrixId === 'm-1002', 'A2 保留账面：仍是「字」m-1002');
  assert(d1Slot?.character === '匠' && d1Slot.matrixId === 'm-1015', 'D1 已调账为「匠」m-1015');
  assert(updated.slots.length === 13, '落位 12 → 13 格（D1 新增，A2 保留）');
  assert(updated.matrixId.includes('m-1015'), 'matrixId 多值索引已含 m-1015');

  const caseB = useCaseStore.getState().cases.find((c) => c.code === 'ZP-B-02')!;
  assert(
    caseB.slots.length === 2 && JSON.stringify(caseB.slots.map((s) => s.character)) === JSON.stringify(['匠', '序']),
    '其它字盘（ZP-B-02）布局未跟着改',
  );

  const m1015 = await db.matrices.get('m-1015');
  assert(m1015.availability === '可用' && m1015.note === '', '字模档案未随调账改动（m-1015）');
  assert((await db.defects.count()) === 5 && (await db.proofs.count()) === 6, '缺损 / 试印表未受影响');

  let unlockedSave = true;
  try {
    await useCaseStore.getState().saveSlots(targetCase.id, updated.slots);
  } catch {
    unlockedSave = false;
  }
  assert(unlockedSave, '盘点结束后字盘布局解锁，可正常保存');

  assert((await db.stocktakes.count()) === 1, '盘点历史保留 1 轮');
  let deleteErr = '';
  try {
    await useInventoryStore.getState().removeRound(closed.id);
  } catch (e) {
    deleteErr = e instanceof Error ? e.message : String(e);
  }
  assert(deleteErr === '', '已结束记录可删除');
  assert((await db.stocktakes.count()) === 0, '盘点表已清空');
  assert((await db.cases.count()) === 2, '删除盘点历史不影响字盘档案');
  const afterDelete = await db.cases.get(targetCase.id);
  assert(afterDelete?.slots.length === 13, '删除历史后调账结果仍保留在字盘上');

  console.log('FLOW TESTS PASSED');
}

if (phase === 'migration') await runMigration();
else await runFlow();
