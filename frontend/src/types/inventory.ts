/**
 * 盘点（Stocktake）：每季按字盘逐格盘存的一轮盘点。
 * 发起时冻结账面布局快照，逐格记录实盘字符或空格；
 * 不一致先形成差异，由保管员逐格选择保留账面或确认调账，全部处理完才可结束。
 */
import type { CaseKind, CaseSlot } from './case';

/** 盘点轮次状态：进行中 / 已结束 */
export const STOCKTAKE_STATUSES = ['open', 'closed'] as const;
export type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

/** 逐格核对结果：未盘 / 相符 / 差异 */
export const CELL_RESULTS = ['pending', 'match', 'diff'] as const;
export type CellResult = (typeof CELL_RESULTS)[number];

/** 差异处理方式：未处理 / 保留账面 / 确认调账 */
export const DIFF_RESOLUTIONS = ['none', 'keep', 'adjust'] as const;
export type DiffResolution = (typeof DIFF_RESOLUTIONS)[number];

/** 一个格位的盘点记录（行、列均为 0 基下标） */
export interface StocktakeCell {
  row: number;
  col: number;
  /** 账面字符（发起盘点时的布局快照），空串表示账面空格 */
  expectedCharacter: string;
  /** 账面字模 id（快照），空格为空串 */
  expectedMatrixId: string;
  /** 实盘字符，空串表示实盘空格；null 表示该格尚未盘 */
  actualCharacter: string | null;
  /** 核对结果 */
  result: CellResult;
  /** 差异处理方式 */
  resolution: DiffResolution;
  /** 确认调账时落位的字模 id（实盘为空格、取出字模时为空串） */
  adjustMatrixId: string;
}

export interface StocktakeRound {
  id: string;
  /** 盘点批次号，例：PD-20260926-01 */
  code: string;
  /** 被盘字盘 id */
  caseId: string;
  /** 冗余保存字盘基本信息，字盘档案后续被改动时历史清单仍可直接展示 */
  caseCode: string;
  caseKind: CaseKind;
  workStation: string;
  rows: number;
  cols: number;
  /** 发起时的账面布局快照：差异核对与调账应用的基准，结束后作为历史留存 */
  snapshotSlots: CaseSlot[];
  /** 逐格盘点清单 */
  cells: StocktakeCell[];
  status: StocktakeStatus;
  /** 保管员 */
  keeper: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  /** 结束时间（进行中为空串） */
  closedAt: string;
  /** 结束时实际应用的调账格数 */
  appliedCount: number;
  /** 结束时记录的遗留提醒（如实盘字符在档案中找不到字模），作为差异历史的一部分留存 */
  closeWarnings: string[];
}

export interface StocktakeInput {
  caseId: string;
  keeper: string;
  note?: string;
}

/** 发起盘点表单校验 */
export function validateStocktakeInput(input: Partial<StocktakeInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!(input.caseId || '').trim()) errors.caseId = '请选择要盘点的字盘';
  if (!(input.keeper || '').trim()) errors.keeper = '请填写保管员';
  return errors;
}
