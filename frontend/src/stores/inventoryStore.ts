import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import type { TypeCase } from '../types/case';
import type { DiffResolution, StocktakeCell, StocktakeInput, StocktakeRound } from '../types/inventory';
import { validateStocktakeInput } from '../types/inventory';
import type { TypeMatrix } from '../types/matrix';
import { makeId, toPlain, todayStr } from '../utils/format';
import {
  applyPlanToSlots,
  buildCells,
  cellLabel,
  planAdjustments,
  recordActual,
  resolveCell,
  stocktakeProgress,
  suggestStocktakeCode,
} from '../utils/inventory';
import { matrixIdsOf } from '../utils/layout';

interface InventoryState {
  rounds: StocktakeRound[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  startRound: (input: StocktakeInput, typeCase: TypeCase) => Promise<StocktakeRound>;
  recordCell: (id: string, row: number, col: number, actual: string | null) => Promise<void>;
  resolveCellDiff: (
    id: string,
    row: number,
    col: number,
    resolution: DiffResolution,
    adjustMatrixId?: string,
  ) => Promise<void>;
  /** 结束盘点：只应用「确认调账」的格位并写回被盘字盘，其它档案不动；返回遗留提醒 */
  closeRound: (id: string, matrices: TypeMatrix[]) => Promise<{ warnings: string[] }>;
  /** 删除已结束的盘点（差异历史），进行中不允许删 */
  removeRound: (id: string) => Promise<void>;
  /** 该字盘是否存在进行中的盘点 */
  openRoundOfCase: (caseId: string) => StocktakeRound | undefined;
}

const byCreatedDesc = (a: StocktakeRound, b: StocktakeRound) => (a.createdAt < b.createdAt ? 1 : -1);

/** 调账字模解析：优先保管员指定的字模，其次按字符取档案中第一枚 */
function makeResolver(matrices: TypeMatrix[]) {
  return (character: string, cell: StocktakeCell): TypeMatrix | undefined => {
    if (cell.adjustMatrixId) {
      const picked = matrices.find((m) => m.id === cell.adjustMatrixId);
      if (picked) return picked;
    }
    return matrices.find((m) => m.character === character);
  };
}

export const useInventoryStore = create<InventoryState>((set, get) => ({
  rounds: [],
  loaded: false,
  loading: false,
  error: '',

  load: async () => {
    set({ loading: true, error: '' });
    try {
      await ensureSeed();
      const rounds = await db.stocktakes.toArray();
      set({ rounds: rounds.sort(byCreatedDesc), loaded: true, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '盘点档案读取失败' });
    }
  },

  startRound: async (input, typeCase) => {
    const errors = validateStocktakeInput(input);
    if (Object.keys(errors).length > 0) throw new Error(Object.values(errors)[0]);
    if (get().rounds.some((r) => r.caseId === typeCase.id && r.status === 'open')) {
      throw new Error(`字盘 ${typeCase.code} 已有一轮进行中的盘点，请先结束后再发起新盘点`);
    }
    const now = new Date().toISOString();
    const seq = get().rounds.filter((r) => r.createdAt.slice(0, 10) === now.slice(0, 10)).length + 1;
    const round: StocktakeRound = toPlain({
      id: makeId('stk'),
      code: suggestStocktakeCode(todayStr(), seq),
      caseId: typeCase.id,
      caseCode: typeCase.code,
      caseKind: typeCase.kind,
      workStation: typeCase.workStation,
      rows: typeCase.rows,
      cols: typeCase.cols,
      // 冻结账面快照：后续盘点与差异核对均以此为基准
      snapshotSlots: typeCase.slots,
      // 从当前布局生成逐格清单
      cells: buildCells(typeCase),
      status: 'open',
      keeper: input.keeper.trim(),
      note: (input.note ?? '').trim(),
      createdAt: now,
      updatedAt: now,
      closedAt: '',
      appliedCount: 0,
      closeWarnings: [],
    });
    await db.stocktakes.add(round);
    set((s) => ({ rounds: [round, ...s.rounds] }));
    return round;
  },

  recordCell: async (id, row, col, actual) => {
    const current = get().rounds.find((r) => r.id === id);
    if (!current) throw new Error('未找到盘点记录');
    if (current.status !== 'open') throw new Error('该盘点已结束，不能再录入实盘');
    const next = recordActual(current.cells, row, col, actual);
    const updatedAt = new Date().toISOString();
    await db.stocktakes.update(id, { cells: toPlain(next), updatedAt });
    set((s) => ({
      rounds: s.rounds.map((r) => (r.id === id ? { ...r, cells: next, updatedAt } : r)),
    }));
  },

  resolveCellDiff: async (id, row, col, resolution, adjustMatrixId = '') => {
    const current = get().rounds.find((r) => r.id === id);
    if (!current) throw new Error('未找到盘点记录');
    if (current.status !== 'open') throw new Error('该盘点已结束，差异结论不可再改');
    const cell = current.cells.find((c) => c.row === row && c.col === col);
    if (!cell || cell.result !== 'diff') throw new Error('该格不是差异格位，无需处理');
    const next = resolveCell(current.cells, row, col, resolution, adjustMatrixId);
    const updatedAt = new Date().toISOString();
    await db.stocktakes.update(id, { cells: toPlain(next), updatedAt });
    set((s) => ({
      rounds: s.rounds.map((r) => (r.id === id ? { ...r, cells: next, updatedAt } : r)),
    }));
  },

  closeRound: async (id, matrices) => {
    const current = get().rounds.find((r) => r.id === id);
    if (!current) throw new Error('未找到盘点记录');
    if (current.status !== 'open') throw new Error('该盘点已结束');
    const progress = stocktakeProgress(current.cells);
    if (!progress.canClose) {
      throw new Error(
        progress.hasPending
          ? `还有 ${progress.pending} 格未盘，未处理完不能结束`
          : `还有 ${progress.diffs - progress.resolved} 处差异未处理，未处理完不能结束`,
      );
    }

    const plan = planAdjustments(current, makeResolver(matrices));

    // 跨字盘去向提醒：调账字模当前落在其它字盘上时提示人工归位
    const otherCases = await db.cases.where('id').notEqual(current.caseId).toArray();
    const crossWarnings: string[] = [];
    for (const change of plan.changes) {
      const mid = change.slot?.matrixId;
      if (!mid) continue;
      for (const c of otherCases) {
        const hit = c.slots.find((s) => s.matrixId === mid);
        if (hit) {
          crossWarnings.push(
            `${cellLabel(change.cell.row, change.cell.col)} 的调账字模 ${mid}（${change.slot?.character ?? ''}）当前落在字盘 ${c.code} 的 ${cellLabel(hit.row, hit.col)}，请人工归位`,
          );
        }
      }
    }
    const warnings = [...plan.warnings, ...crossWarnings];

    // 同一事务内写盘点结果与被盘字盘；只应用确认调账的格位，其它字盘与字模档案不动
    const now = new Date().toISOString();
    await db.transaction('rw', db.stocktakes, db.cases, async () => {
      const live = await db.cases.get(current.caseId);
      if (!live) throw new Error('被盘字盘已不在档案中，无法应用调账');
      const nextSlots = applyPlanToSlots(live.slots ?? [], plan);
      await db.cases.update(current.caseId, {
        slots: toPlain(nextSlots),
        matrixId: matrixIdsOf(nextSlots),
        updatedAt: now,
      });
      await db.stocktakes.update(id, {
        status: 'closed',
        closedAt: now,
        updatedAt: now,
        appliedCount: plan.changes.length,
        closeWarnings: toPlain(warnings),
      });
    });

    set((s) => ({
      rounds: s.rounds.map((r) =>
        r.id === id
          ? {
              ...r,
              status: 'closed',
              closedAt: now,
              updatedAt: now,
              appliedCount: plan.changes.length,
              closeWarnings: warnings,
            }
          : r,
      ),
    }));
    return { warnings };
  },

  removeRound: async (id) => {
    const current = get().rounds.find((r) => r.id === id);
    if (!current) return;
    if (current.status === 'open') throw new Error('进行中的盘点不能删除，请先结束');
    await db.stocktakes.delete(id);
    set((s) => ({ rounds: s.rounds.filter((r) => r.id !== id) }));
  },

  openRoundOfCase: (caseId) =>
    get().rounds.find((r) => r.caseId === caseId && r.status === 'open'),
}));

export { stocktakeProgress };
