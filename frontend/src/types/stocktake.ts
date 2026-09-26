import type { TypeCase } from './case';

/** 盘点轮次（StocktakeRound）：按字盘逐格盘存的一轮盘点与差异处理留档 */

/** 轮次状态：盘点中 / 已结束 */
export const STOCKTAKE_STATUSES = ['盘点中', '已结束'] as const;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

/** 差异处理方式：保留账面（账面原值不动）/ 确认调账（结束时按实盘改账面） */
export const STOCKTAKE_RESOLUTIONS = ['保留账面', '确认调账'] as const;
export type StocktakeResolution = (typeof STOCKTAKE_RESOLUTIONS)[number];

/** 一个格位的盘点记录（账面快照 + 实盘录入 + 差异处理） */
export interface StocktakeItem {
  row: number;
  col: number;
  /** 账面字符：开始盘点时的布局快照，空串表示账面为空格 */
  bookCharacter: string;
  /** 账面字模 id（快照），空格为空串 */
  bookMatrixId: string;
  /** 实盘字符：null=未盘；空串=实盘为空格；其余为实盘字符 */
  actual: string | null;
  /** 差异处理结论，未处理为空串 */
  resolution: StocktakeResolution | '';
  /** 差异处理时间 */
  resolvedAt: string;
}

export interface StocktakeRound {
  id: string;
  /** 被盘字盘 id */
  caseId: string;
  /** 冗余字盘编号与工位，字盘日后变动时历史仍可读 */
  caseCode: string;
  workStation: string;
  status: StocktakeStatus;
  /** 保管员 */
  operator: string;
  /** 逐格清单（行优先展开，覆盖字盘全部格位） */
  items: StocktakeItem[];
  startedAt: string;
  /** 结束时间，盘点中为空串 */
  finishedAt: string;
  /** 结束时实际写入布局的调账格数 */
  adjustedCount: number;
}

/** 由当前布局生成逐格清单（账面快照，全部未盘） */
export function buildStocktakeItems(typeCase: TypeCase): StocktakeItem[] {
  const items: StocktakeItem[] = [];
  for (let row = 0; row < typeCase.rows; row += 1) {
    for (let col = 0; col < typeCase.cols; col += 1) {
      const slot = typeCase.slots.find((s) => s.row === row && s.col === col);
      items.push({
        row,
        col,
        bookCharacter: slot?.character ?? '',
        bookMatrixId: slot?.matrixId ?? '',
        actual: null,
        resolution: '',
        resolvedAt: '',
      });
    }
  }
  return items;
}

/** 该格是否已录入实盘 */
export function isCounted(item: StocktakeItem): boolean {
  return item.actual !== null;
}

/** 该格是否形成差异（已盘且实盘与账面不一致） */
export function isDifference(item: StocktakeItem): boolean {
  return item.actual !== null && item.actual !== item.bookCharacter;
}

export interface StocktakeProgress {
  total: number;
  counted: number;
  diffCount: number;
  /** 已处理差异数 */
  resolved: number;
  /** 未处理差异数 */
  unresolved: number;
  /** 是否可结束：逐格盘完且差异全部处理 */
  canFinish: boolean;
}

/** 盘点进度汇总：结束盘点前必须逐格盘完且差异全部处理 */
export function stocktakeProgress(items: StocktakeItem[]): StocktakeProgress {
  const total = items.length;
  const counted = items.filter(isCounted).length;
  const diffs = items.filter(isDifference);
  const resolved = diffs.filter((d) => d.resolution !== '').length;
  return {
    total,
    counted,
    diffCount: diffs.length,
    resolved,
    unresolved: diffs.length - resolved,
    canFinish: counted === total && diffs.length === resolved,
  };
}

/** 实盘字符的展示：未盘 / 实盘空格（空串）分别显示为「未盘」「空」 */
export function actualLabel(actual: string | null): string {
  if (actual === null) return '未盘';
  return actual === '' ? '空' : actual;
}

/** 账面字符的展示：账面空格（空串）显示为「空」 */
export function bookLabel(bookCharacter: string): string {
  return bookCharacter === '' ? '空' : bookCharacter;
}

/** 格位行列 → 仓位名，例：0 行 2 列 → A3 */
export function cellLabel(row: number, col: number): string {
  const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[row] ?? `${row + 1}`;
  return `${letter}${col + 1}`;
}
