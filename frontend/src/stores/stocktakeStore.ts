import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import type { TypeMatrix } from '../types/matrix';
import type { StocktakeItem, StocktakeResolution, StocktakeRound } from '../types/stocktake';
import { buildStocktakeItems, isDifference, stocktakeProgress } from '../types/stocktake';
import { makeId, toPlain } from '../utils/format';
import { placeSlot, removeSlot } from '../utils/layout';
import { useCaseStore } from './caseStore';
import { useMatrixStore } from './matrixStore';

interface StocktakeState {
  rounds: StocktakeRound[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  /** 以当前落库布局为账面，开始一轮逐格盘点 */
  startRound: (caseId: string, operator: string) => Promise<StocktakeRound>;
  /** 录入一格实盘（空串表示实盘为空格）；重新录入会清空该格已作的差异处理 */
  setActual: (roundId: string, row: number, col: number, actual: string) => Promise<void>;
  /** 把一格标回未盘 */
  clearActual: (roundId: string, row: number, col: number) => Promise<void>;
  /** 其余未盘格全部按「与账面一致」补录，返回补录格数 */
  fillRestWithBook: (roundId: string) => Promise<number>;
  /** 处理一条差异：保留账面 / 确认调账 */
  resolveDiff: (roundId: string, row: number, col: number, resolution: StocktakeResolution) => Promise<void>;
  /** 结束盘点：只把确认调账的格位写回字盘布局，返回调账格数 */
  finishRound: (roundId: string) => Promise<number>;
  /** 作废进行中的盘点（删除记录，不改动字盘布局） */
  discardRound: (roundId: string) => Promise<void>;
}

const byStartedDesc = (a: StocktakeRound, b: StocktakeRound) => (a.startedAt < b.startedAt ? 1 : -1);

function requireActive(rounds: StocktakeRound[], roundId: string): StocktakeRound {
  const round = rounds.find((r) => r.id === roundId);
  if (!round) throw new Error('未找到该盘点轮次');
  if (round.status !== '盘点中') throw new Error('本轮盘点已结束，不能再修改');
  return round;
}

/** 调账落格时挑选关联字模：账面字模字符相符则沿用，否则取该字符的可用字模，都没有则留空 */
function pickMatrixId(matrices: TypeMatrix[], character: string, bookMatrixId: string): string {
  const booked = matrices.find((m) => m.id === bookMatrixId);
  if (booked && booked.character === character) return booked.id;
  const hit = matrices
    .filter((m) => m.character === character)
    .sort((a, b) => {
      const av = a.availability === '可用' ? 0 : 1;
      const bv = b.availability === '可用' ? 0 : 1;
      return av - bv || (a.code < b.code ? -1 : 1);
    })[0];
  return hit?.id ?? '';
}

export const useStocktakeStore = create<StocktakeState>((set, get) => {
  /** 写回逐格清单：先落 IndexedDB，再同步内存状态 */
  const persistItems = async (roundId: string, items: StocktakeItem[]) => {
    const plain = toPlain(items);
    await db.stocktakes.update(roundId, { items: plain });
    set((s) => ({ rounds: s.rounds.map((r) => (r.id === roundId ? { ...r, items: plain } : r)) }));
  };

  return {
    rounds: [],
    loaded: false,
    loading: false,
    error: '',

    load: async () => {
      set({ loading: true, error: '' });
      try {
        await ensureSeed();
        const rounds = await db.stocktakes.toArray();
        set({ rounds: rounds.sort(byStartedDesc), loaded: true, loading: false });
      } catch (err) {
        set({ loading: false, error: err instanceof Error ? err.message : '盘点档案读取失败' });
      }
    },

    startRound: async (caseId, operator) => {
      const op = operator.trim();
      if (!op) throw new Error('请填写保管员姓名');
      const typeCase = useCaseStore.getState().cases.find((c) => c.id === caseId);
      if (!typeCase) throw new Error('未找到字盘，无法开始盘点');
      const existing = get().rounds.find((r) => r.caseId === caseId && r.status === '盘点中');
      if (existing) throw new Error(`字盘 ${typeCase.code} 已有进行中的盘点，请先结束或作废`);
      const now = new Date().toISOString();
      const round: StocktakeRound = toPlain({
        id: makeId('stk'),
        caseId,
        caseCode: typeCase.code,
        workStation: typeCase.workStation,
        status: '盘点中' as const,
        operator: op,
        items: buildStocktakeItems(typeCase),
        startedAt: now,
        finishedAt: '',
        adjustedCount: 0,
      });
      await db.stocktakes.add(round);
      set((s) => ({ rounds: [round, ...s.rounds] }));
      return round;
    },

    setActual: async (roundId, row, col, actual) => {
      const round = requireActive(get().rounds, roundId);
      const char = actual === '' ? '' : (Array.from(actual.trim())[0] ?? '');
      const items: StocktakeItem[] = round.items.map((it) =>
        it.row === row && it.col === col ? { ...it, actual: char, resolution: '', resolvedAt: '' } : it,
      );
      await persistItems(roundId, items);
    },

    clearActual: async (roundId, row, col) => {
      const round = requireActive(get().rounds, roundId);
      const items: StocktakeItem[] = round.items.map((it) =>
        it.row === row && it.col === col ? { ...it, actual: null, resolution: '', resolvedAt: '' } : it,
      );
      await persistItems(roundId, items);
    },

    fillRestWithBook: async (roundId) => {
      const round = requireActive(get().rounds, roundId);
      let filled = 0;
      const items: StocktakeItem[] = round.items.map((it) => {
        if (it.actual !== null) return it;
        filled += 1;
        return { ...it, actual: it.bookCharacter };
      });
      await persistItems(roundId, items);
      return filled;
    },

    resolveDiff: async (roundId, row, col, resolution) => {
      const round = requireActive(get().rounds, roundId);
      const target = round.items.find((it) => it.row === row && it.col === col);
      if (!target || !isDifference(target)) throw new Error('该格没有差异，无需处理');
      const now = new Date().toISOString();
      const items: StocktakeItem[] = round.items.map((it) =>
        it.row === row && it.col === col ? { ...it, resolution, resolvedAt: now } : it,
      );
      await persistItems(roundId, items);
    },

    finishRound: async (roundId) => {
      const round = requireActive(get().rounds, roundId);
      const progress = stocktakeProgress(round.items);
      if (progress.counted < progress.total) {
        throw new Error(`还有 ${progress.total - progress.counted} 格未录入实盘，不能结束盘点`);
      }
      if (progress.unresolved > 0) {
        throw new Error(`还有 ${progress.unresolved} 条差异未处理，不能结束盘点`);
      }
      const adjustments = round.items.filter((it) => it.resolution === '确认调账');
      const now = new Date().toISOString();
      if (adjustments.length > 0) {
        // 只动被盘字盘的确认调账格位，其余格位、其他字盘与字模档案一律不改
        const typeCase = useCaseStore.getState().cases.find((c) => c.id === round.caseId);
        if (!typeCase) throw new Error('字盘档案已不存在，无法应用调账；请作废本轮盘点');
        const matrices = useMatrixStore.getState().matrices;
        let slots = [...typeCase.slots];
        for (const item of adjustments) {
          const actual = item.actual ?? '';
          slots = removeSlot(slots, item.row, item.col);
          if (actual) {
            slots = placeSlot(slots, {
              row: item.row,
              col: item.col,
              character: actual,
              matrixId: pickMatrixId(matrices, actual, item.bookMatrixId),
              placedAt: now,
            });
          }
        }
        await useCaseStore.getState().saveSlots(round.caseId, slots);
      }
      const patch = { status: '已结束' as const, finishedAt: now, adjustedCount: adjustments.length };
      await db.stocktakes.update(roundId, toPlain(patch));
      set((s) => ({ rounds: s.rounds.map((r) => (r.id === roundId ? { ...r, ...patch } : r)) }));
      return adjustments.length;
    },

    discardRound: async (roundId) => {
      requireActive(get().rounds, roundId);
      await db.stocktakes.delete(roundId);
      set((s) => ({ rounds: s.rounds.filter((r) => r.id !== roundId) }));
    },
  };
});
