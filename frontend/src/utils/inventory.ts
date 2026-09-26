import type { CaseSlot, TypeCase } from '../types/case';
import type { DiffResolution, StocktakeCell, StocktakeRound } from '../types/inventory';
import { placeSlot, rcKey, removeSlot } from './layout';

/** 盘点逐格清单的生成、差异判定、进度统计与调账换算（纯函数，便于核对） */

/** 空格实盘的统一表示 */
export const EMPTY_CHARACTER = '';

/** 行标签（A 起），与网格展示一致 */
export function rowLabel(row: number): string {
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[row] ?? String(row + 1);
}

/** 格位文字编号，例：A1、C3 */
export function cellLabel(row: number, col: number): string {
  return `${rowLabel(row)}${col + 1}`;
}

/** 字符规范化：去掉首尾空白；空串 / 纯空白均视为空格 */
export function normalizeCharacter(raw: string | null | undefined): string {
  return (raw ?? '').trim();
}

/** 从当前字盘布局发起一轮盘点：冻结账面快照并生成逐格清单（全部待盘） */
export function buildCells(typeCase: TypeCase): StocktakeCell[] {
  const byKey = new Map<string, CaseSlot>();
  for (const s of typeCase.slots ?? []) byKey.set(rcKey(s.row, s.col), s);
  const cells: StocktakeCell[] = [];
  for (let r = 0; r < typeCase.rows; r += 1) {
    for (let c = 0; c < typeCase.cols; c += 1) {
      const slot = byKey.get(rcKey(r, c));
      cells.push({
        row: r,
        col: c,
        expectedCharacter: slot?.character ?? '',
        expectedMatrixId: slot?.matrixId ?? '',
        actualCharacter: null,
        result: 'pending',
        resolution: 'none',
        adjustMatrixId: '',
      });
    }
  }
  return cells;
}

/** 记录一格的实盘字符（传空串表示实盘空格，传 null 标为未盘），返回新清单，不修改入参 */
export function recordActual(
  cells: StocktakeCell[],
  row: number,
  col: number,
  raw: string | null,
): StocktakeCell[] {
  return cells.map((cell) => {
    if (cell.row !== row || cell.col !== col) return cell;
    if (raw === null) {
      return {
        ...cell,
        actualCharacter: null,
        result: 'pending' as const,
        resolution: 'none' as const,
        adjustMatrixId: '',
      };
    }
    const character = normalizeCharacter(raw);
    return {
      ...cell,
      actualCharacter: character,
      result: character === cell.expectedCharacter.trim() ? ('match' as const) : ('diff' as const),
      // 改实盘后旧的处理结论作废，需重新判定
      resolution: 'none' as const,
      adjustMatrixId: '',
    };
  });
}

/** 设置一格差异的处理方式；确认调账时同步候选字模 */
export function resolveCell(
  cells: StocktakeCell[],
  row: number,
  col: number,
  resolution: DiffResolution,
  adjustMatrixId = '',
): StocktakeCell[] {
  return cells.map((cell) =>
    cell.row === row && cell.col === col
      ? { ...cell, resolution, adjustMatrixId: resolution === 'adjust' ? adjustMatrixId : '' }
      : cell,
  );
}

export interface StocktakeProgress {
  total: number;
  checked: number;
  pending: number;
  matched: number;
  diffs: number;
  resolved: number;
  /** 是否还有未盘格位 */
  hasPending: boolean;
  /** 是否还有差异未处理 */
  hasUnresolvedDiff: boolean;
  /** 是否允许结束：全部格已盘且差异均有处理结论 */
  canClose: boolean;
}

/** 盘点进度统计 */
export function stocktakeProgress(cells: StocktakeCell[]): StocktakeProgress {
  let checked = 0;
  let matched = 0;
  let diffs = 0;
  let resolved = 0;
  for (const cell of cells) {
    if (cell.result === 'pending') continue;
    checked += 1;
    if (cell.result === 'match') matched += 1;
    else {
      diffs += 1;
      if (cell.resolution !== 'none') resolved += 1;
    }
  }
  const pending = cells.length - checked;
  const hasPending = pending > 0;
  const hasUnresolvedDiff = resolved < diffs;
  return {
    total: cells.length,
    checked,
    pending,
    matched,
    diffs,
    resolved,
    hasPending,
    hasUnresolvedDiff,
    canClose: !hasPending && !hasUnresolvedDiff,
  };
}

/** 一条调账：slot 为 undefined 表示取出该格字模（实盘空格） */
export interface AdjustmentChange {
  cell: StocktakeCell;
  slot?: CaseSlot;
}

export interface AdjustmentPlan {
  changes: AdjustmentChange[];
  /** 调账后仍需人工留意的问题（字符无对应字模、字模跨字盘去向等） */
  warnings: string[];
}

/** 字模最小信息（避免与 matrix 类型循环依赖） */
export interface TypeMatrixLike {
  id: string;
  character: string;
}

/**
 * 依据处理结论换算调账计划（不落库，供预览与结束时应用）：
 * - 相符 / 保留账面：不动账；
 * - 确认调账：按实盘字符替换落位（实盘空格则取出该格）。
 * 只产出确认调账的格位改动，其它字盘与字模档案不在此处变更。
 */
export function planAdjustments(
  round: StocktakeRound,
  matrixResolver: (character: string, cell: StocktakeCell) => TypeMatrixLike | undefined,
): AdjustmentPlan {
  const now = new Date().toISOString();
  const changes: AdjustmentChange[] = [];
  const warnings: string[] = [];
  const usedMatrixIds = new Map<string, string>();

  for (const cell of round.cells) {
    if (cell.result !== 'diff' || cell.resolution !== 'adjust') continue;
    const actual = cell.actualCharacter ?? '';
    if (actual === EMPTY_CHARACTER) {
      // 实盘空格：取出该格字模
      changes.push({ cell });
      continue;
    }
    const matrix = matrixResolver(actual, cell);
    if (!matrix) {
      warnings.push(
        `${cellLabel(cell.row, cell.col)} 实盘为「${actual}」，档案中未找到该字符的字模，已按字符调账，请补登字模后补挂编号`,
      );
    }
    if (matrix) {
      const firstCell = usedMatrixIds.get(matrix.id);
      if (firstCell) {
        warnings.push(
          `字模 ${matrix.id}（${matrix.character}）同时被调到 ${firstCell} 与 ${cellLabel(cell.row, cell.col)}，请人工核对去向`,
        );
      } else {
        usedMatrixIds.set(matrix.id, cellLabel(cell.row, cell.col));
      }
    }
    changes.push({
      cell,
      slot: {
        row: cell.row,
        col: cell.col,
        character: actual,
        matrixId: matrix?.id ?? cell.adjustMatrixId ?? '',
        placedAt: now,
      },
    });
  }
  return { changes, warnings };
}

/** 把调账计划应用到一组 slots 上（纯函数，无 side effect，返回新数组） */
export function applyPlanToSlots(slots: CaseSlot[], plan: AdjustmentPlan): CaseSlot[] {
  let next = slots;
  for (const change of plan.changes) {
    next = change.slot
      ? placeSlot(next, change.slot)
      : removeSlot(next, change.cell.row, change.cell.col);
  }
  return next;
}

/** 盘点批次号，例：PD-20260926-01 */
export function suggestStocktakeCode(dateStr: string, seq: number): string {
  const compact = (dateStr || '').replace(/-/g, '');
  return `PD-${compact}-${`${seq}`.padStart(2, '0')}`;
}
