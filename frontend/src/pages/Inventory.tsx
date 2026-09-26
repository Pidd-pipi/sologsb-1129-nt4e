import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import CharacterPicker from '../components/common/CharacterPicker';
import EmptyState from '../components/common/EmptyState';
import { useCaseStore } from '../stores/caseStore';
import { useInventoryStore } from '../stores/inventoryStore';
import { useMatrixStore } from '../stores/matrixStore';
import { useUiStore } from '../stores/uiStore';
import { describeCapacity } from '../types/case';
import {
  validateStocktakeInput,
  type DiffResolution,
  type StocktakeCell,
  type StocktakeRound,
} from '../types/inventory';
import { dash, formatStamp } from '../utils/format';
import {
  cellLabel,
  rowLabel,
  stocktakeProgress,
} from '../utils/inventory';

/** `/stocktakes` 逐格盘点：发起逐格盘存、逐格录实盘、差异逐格处理，全部处理完才可结束调账 */
export default function Inventory() {
  const rounds = useInventoryStore((s) => s.rounds);
  const loaded = useInventoryStore((s) => s.loaded);
  const load = useInventoryStore((s) => s.load);
  const startRound = useInventoryStore((s) => s.startRound);
  const cases = useCaseStore((s) => s.cases);
  const pushToast = useUiStore((s) => s.pushToast);

  const [form, setForm] = useState({ caseId: '', keeper: '', note: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    void load();
  }, [load]);

  const openRounds = useMemo(() => rounds.filter((r) => r.status === 'open'), [rounds]);
  const closedRounds = useMemo(() => rounds.filter((r) => r.status === 'closed'), [rounds]);
  const openCaseIds = useMemo(() => new Set(openRounds.map((r) => r.caseId)), [openRounds]);

  useEffect(() => {
    if (!form.caseId && cases.length > 0) {
      const first = cases.find((c) => !openCaseIds.has(c.id)) ?? cases[0];
      setForm((f) => ({ ...f, caseId: first.id }));
    }
  }, [cases, form.caseId, openCaseIds]);

  const active = openRounds.find((r) => r.id === activeId) ?? openRounds[0];

  const handleStart = async (e: FormEvent) => {
    e.preventDefault();
    const errs = validateStocktakeInput(form);
    if (form.caseId && openCaseIds.has(form.caseId)) errs.caseId = '该字盘已有进行中的盘点，请先结束再发起';
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      pushToast('盘点信息未通过校验，请按提示修正', 'warn');
      return;
    }
    const typeCase = cases.find((c) => c.id === form.caseId);
    if (!typeCase) return;
    try {
      const round = await startRound(form, typeCase);
      setActiveId(round.id);
      setForm((f) => ({ ...f, note: '' }));
      setErrors({});
      pushToast(`已发起盘点 ${round.code}（${round.caseCode}，共 ${round.cells.length} 格）`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '发起盘点失败', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="mt-title" data-testid="inventory-title">
            逐格盘点
          </h2>
          <p className="mt-sub">
            每季按字盘逐格盘存：从当前布局生成逐格清单，录入每格实盘字符或空格；不一致先形成差异，由保管员逐格保留账面或确认调账，全部处理完才能结束。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="mt-chip border-seal/40 text-seal" data-testid="stocktake-open-count">
            进行中 {openRounds.length} 轮
          </span>
          <span className="mt-chip" data-testid="stocktake-closed-count">
            历史 {closedRounds.length} 轮
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr]">
        <aside className="space-y-3">
          <form className="mt-panel space-y-3 px-4 py-3" onSubmit={handleStart} data-testid="stocktake-start-form">
            <h3 className="font-song text-sm font-semibold text-ink">发起一轮盘点</h3>
            <div>
              <label className="mt-label" htmlFor="stocktake-case-select">
                要盘点的字盘
              </label>
              <select
                id="stocktake-case-select"
                data-testid="stocktake-case-select"
                className="mt-input"
                value={form.caseId}
                onChange={(e) => setForm((f) => ({ ...f, caseId: e.target.value }))}
              >
                {cases.length === 0 ? <option value="">暂无字盘</option> : null}
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.kind} · {describeCapacity(c.rows, c.cols)}
                    {openCaseIds.has(c.id) ? '（盘点进行中）' : ''}
                  </option>
                ))}
              </select>
              {errors.caseId ? <p className="mt-error" data-testid="error-caseId">{errors.caseId}</p> : null}
            </div>
            <div>
              <label className="mt-label" htmlFor="stocktake-keeper-input">
                保管员
              </label>
              <input
                id="stocktake-keeper-input"
                data-testid="stocktake-keeper-input"
                className="mt-input"
                placeholder="例：周介庵"
                value={form.keeper}
                onChange={(e) => setForm((f) => ({ ...f, keeper: e.target.value }))}
              />
              {errors.keeper ? <p className="mt-error" data-testid="error-keeper">{errors.keeper}</p> : null}
            </div>
            <div>
              <label className="mt-label" htmlFor="stocktake-note-input">
                盘点备注
              </label>
              <input
                id="stocktake-note-input"
                data-testid="stocktake-note-input"
                className="mt-input"
                placeholder="例：三季度例行盘点"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              />
            </div>
            <button type="submit" className="mt-btn mt-btn-primary" data-testid="start-stocktake-btn">
              发起盘点
            </button>
            <p className="mt-hint">发起时冻结账面快照，随后字盘布局将锁定，盘点期间不能改动。</p>
          </form>

          <div className="mt-panel">
            <div className="mt-panel-head">
              <h3 className="font-song text-sm font-semibold text-ink">进行中的批次</h3>
            </div>
            <ul className="divide-y divide-paper-line" data-testid="open-round-list">
              {!loaded ? (
                <li className="px-4 py-3 text-xs text-ink-mute">正在读取盘点档案…</li>
              ) : openRounds.length === 0 ? (
                <li className="px-4 py-3 text-xs text-ink-mute">当前没有进行中的盘点。</li>
              ) : (
                openRounds.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      data-testid={`open-round-${r.id}`}
                      onClick={() => setActiveId(r.id)}
                      className={`flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left transition hover:bg-paper-deep/60 ${
                        active?.id === r.id ? 'bg-seal-pale/70' : ''
                      }`}
                    >
                      <span className="font-song text-sm text-ink">{r.code}</span>
                      <span className="text-[11px] text-ink-mute">
                        {r.caseCode} · 已盘 {stocktakeProgress(r.cells).checked}/{r.cells.length}
                        {stocktakeProgress(r.cells).diffs > 0
                          ? ` · 差异 ${stocktakeProgress(r.cells).diffs}`
                          : ''}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </aside>

        {active ? (
          <RoundWorkspace key={active.id} round={active} />
        ) : (
          <EmptyState
            title="尚未进行盘点"
            description="选择一个字盘并填写保管员后发起盘点；系统会从当前布局生成逐格清单，按格录入实盘字符或空格。"
            testId="stocktake-empty"
          />
        )}
      </div>

      <HistorySection closedRounds={closedRounds} loaded={loaded} />
    </div>
  );
}

// ---------------------------------------------------------------------------

const RESULT_META: Record<StocktakeCell['result'], { text: string; cls: string }> = {
  pending: { text: '未盘', cls: 'border-paper-line bg-paper/60 text-ink-mute' },
  match: { text: '相符', cls: 'border-jade/50 bg-jade-pale text-jade' },
  diff: { text: '差异', cls: 'border-seal/50 bg-seal-pale text-seal' },
};

function RoundWorkspace({ round }: { round: StocktakeRound }) {
  const recordCell = useInventoryStore((s) => s.recordCell);
  const resolveCellDiff = useInventoryStore((s) => s.resolveCellDiff);
  const closeRound = useInventoryStore((s) => s.closeRound);
  const matrices = useMatrixStore((s) => s.matrices);
  const cases = useCaseStore((s) => s.cases);
  const reloadCases = useCaseStore((s) => s.load);
  const pushToast = useUiStore((s) => s.pushToast);

  const [selected, setSelected] = useState({ row: 0, col: 0 });
  const [filter, setFilter] = useState<'all' | StocktakeCell['result']>('all');
  const [confirming, setConfirming] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  const progress = useMemo(() => stocktakeProgress(round.cells), [round.cells]);
  const cell =
    round.cells.find((c) => c.row === selected.row && c.col === selected.col) ?? round.cells[0];

  const matrixCodeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of matrices) map.set(m.id, m.code);
    return map;
  }, [matrices]);

  const advance = () => {
    const idx = round.cells.findIndex((c) => c.row === selected.row && c.col === selected.col);
    const after = round.cells.slice(idx + 1).find((c) => c.result === 'pending');
    const target = after ?? round.cells.find((c) => c.result === 'pending');
    if (target) setSelected({ row: target.row, col: target.col });
  };

  const handleRecord = async (actual: string | null) => {
    setBusy(true);
    try {
      await recordCell(round.id, cell.row, cell.col, actual);
      // 相符才自动跳到下一未盘格；差异停在本格，便于保管员立即处理
      if (actual !== null) {
        const normalized = actual.trim();
        if (normalized === cell.expectedCharacter.trim()) advance();
      }
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '录入失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleResolveAt = async (
    row: number,
    col: number,
    resolution: DiffResolution,
    adjustMatrixId = '',
  ) => {
    try {
      await resolveCellDiff(round.id, row, col, resolution, adjustMatrixId);
      pushToast(
        resolution === 'keep'
          ? `${cellLabel(row, col)} 已按保留账面处理`
          : `${cellLabel(row, col)} 已确认调账`,
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '差异处理失败', 'error');
    }
  };

  const handleResolve = async (resolution: DiffResolution, adjustMatrixId = '') =>
    handleResolveAt(cell.row, cell.col, resolution, adjustMatrixId);

  const handleClose = async () => {
    setClosing(true);
    try {
      const { warnings } = await closeRound(round.id, matrices);
      await reloadCases();
      setConfirming(false);
      pushToast(
        warnings.length > 0
          ? `盘点 ${round.code} 已结束，调账已应用；${warnings.length} 条遗留提醒见差异历史`
          : `盘点 ${round.code} 已结束，确认的调账已应用`,
        warnings.length > 0 ? 'warn' : 'ok',
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '结束盘点失败', 'error');
    } finally {
      setClosing(false);
    }
  };

  const adjustCount = round.cells.filter(
    (c) => c.result === 'diff' && c.resolution === 'adjust',
  ).length;
  const keepCount = round.cells.filter(
    (c) => c.result === 'diff' && c.resolution === 'keep',
  ).length;
  const filteredCells = round.cells.filter((c) => filter === 'all' || c.result === filter);

  return (
    <section className="mt-panel space-y-3" data-testid="stocktake-workspace">
      <div className="mt-panel-head">
        <div>
          <h3 className="font-song text-sm font-semibold text-ink">
            {round.code} · {round.caseCode}（{round.caseKind}）
          </h3>
          <p className="mt-sub">
            {describeCapacity(round.rows, round.cols)} · 工位 {round.workStation} · 保管员 {round.keeper} ·
            发起于 {formatStamp(round.createdAt)}
            {round.note ? ` · ${round.note}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="mt-chip" data-testid="st-checked">
            已盘 {progress.checked}/{progress.total}
          </span>
          <span className="mt-chip border-jade/50 text-jade" data-testid="st-matched">
            相符 {progress.matched}
          </span>
          <span className="mt-chip border-seal/50 text-seal" data-testid="st-diffs">
            差异 {progress.diffs}（未处理 {progress.diffs - progress.resolved}）
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 px-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-2">
          <StocktakeGrid
            round={round}
            selected={selected}
            onSelect={(row, col) => setSelected({ row, col })}
          />
          <div className="rounded border border-paper-line bg-paper/50 px-3 py-2 text-[11px] text-ink-soft" data-testid="st-legend">
            <span className="mr-3">格内大字为实盘，小字为账面；绿框相符，红框差异待处理，黄框差异已处理。</span>
            {progress.hasPending ? (
              <span className="text-seal" data-testid="st-pending-hint">
                还有 {progress.pending} 格未盘。
              </span>
            ) : progress.hasUnresolvedDiff ? (
              <span className="text-seal" data-testid="st-unresolved-hint">
                全部格已盘，但还有 {progress.diffs - progress.resolved} 处差异未处理，未处理完不能结束。
              </span>
            ) : (
              <span className="text-jade" data-testid="st-ready-hint">
                全部格已盘，差异均已处理，可以结束盘点。
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <CellEntry
            key={`${round.id}-${cell.row}-${cell.col}`}
            round={round}
            cell={cell}
            busy={busy}
            matrixCode={matrixCodeMap.get(cell.expectedMatrixId) ?? ''}
            onRecord={handleRecord}
            onNavigate={(row, col) => setSelected({ row, col })}
          />

          {cell.result === 'diff' ? (
            <DiffPanel
              key={`diff-${round.id}-${cell.row}-${cell.col}`}
              cell={cell}
              matrices={matrices}
              cases={cases}
              onResolve={handleResolve}
            />
          ) : null}

          <Link className="mt-btn block text-center" to="/cases" data-testid="st-goto-cases">
            查看字盘布局
          </Link>
        </div>
      </div>

      <ChecklistTable
        round={round}
        cells={filteredCells}
        filter={filter}
        progress={progress}
        selected={selected}
        matrixCodeMap={matrixCodeMap}
        onFilter={setFilter}
        onSelect={(row, col) => setSelected({ row, col })}
        onQuickKeep={(row, col) => void handleResolveAt(row, col, 'keep')}
      />

      <div
        className="flex flex-wrap items-center gap-2 border-t border-paper-line px-4 py-3"
        data-testid="st-finish-bar"
      >
        {!confirming ? (
          <>
            <button
              type="button"
              className="mt-btn mt-btn-primary"
              data-testid="finish-stocktake-btn"
              disabled={!progress.canClose || closing}
              onClick={() => setConfirming(true)}
            >
              结束盘点
            </button>
            <span className="text-xs text-ink-mute" data-testid="finish-hint">
              {progress.canClose
                ? `结束后只应用确认的调账（${adjustCount} 格），保留账面 ${keepCount} 格；其它字盘与字模档案不动。`
                : `未盘 ${progress.pending} 格 · 未处理差异 ${progress.diffs - progress.resolved} 处，未处理完不能结束。`}
            </span>
          </>
        ) : (
          <>
            <span className="text-xs text-ink-soft" data-testid="finish-confirm-text">
              确认结束 {round.code}？将应用调账 {adjustCount} 格、保留账面 {keepCount} 格、相符 {progress.matched}
              格不动，结束后清单与差异处理将作为历史留存。
            </span>
            <button
              type="button"
              className="mt-btn mt-btn-primary"
              data-testid="confirm-finish-btn"
              disabled={closing}
              onClick={handleClose}
            >
              {closing ? '结束中…' : '确认结束并调账'}
            </button>
            <button
              type="button"
              className="mt-btn"
              data-testid="cancel-finish-btn"
              disabled={closing}
              onClick={() => setConfirming(false)}
            >
              再想想
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function StocktakeGrid({
  round,
  selected,
  onSelect,
}: {
  round: StocktakeRound;
  selected: { row: number; col: number };
  onSelect: (row: number, col: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        <div
          className="grid gap-1"
          style={{ gridTemplateColumns: `28px repeat(${round.cols}, minmax(46px, 1fr))` }}
          data-testid="stocktake-grid"
          data-rows={round.rows}
          data-cols={round.cols}
        >
          <div className="flex h-7 items-center justify-center text-[10px] text-ink-mute">列</div>
          {Array.from({ length: round.cols }, (_, c) => (
            <div key={`h-${c}`} className="flex h-7 items-center justify-center font-song text-[11px] text-ink-mute">
              {c + 1}
            </div>
          ))}

          {Array.from({ length: round.rows }, (_, r) => (
            <div key={`row-${r}`} className="contents">
              <div className="flex h-12 items-center justify-center font-song text-[11px] text-ink-mute">
                {rowLabel(r)}
              </div>
              {Array.from({ length: round.cols }, (_, c) => {
                const item = round.cells[r * round.cols + c];
                const isSelected = selected.row === r && selected.col === c;
                const meta = RESULT_META[item.result];
                const tone =
                  item.result === 'pending'
                    ? 'border-dashed border-paper-line bg-paper/50'
                    : item.result === 'match'
                      ? 'border-jade/50 bg-jade-pale/50'
                      : item.resolution === 'none'
                        ? 'border-seal/60 bg-seal-pale'
                        : 'border-brass/50 bg-brass-pale';
                return (
                  <button
                    key={`${r}-${c}`}
                    type="button"
                    onClick={() => onSelect(r, c)}
                    title={`${cellLabel(r, c)}：账面「${item.expectedCharacter || '空'}」实盘「${
                      item.actualCharacter === null ? '未盘' : item.actualCharacter || '空'
                    }」`}
                    data-testid={`st-cell-${r}-${c}`}
                    data-result={item.result}
                    className={`flex h-12 flex-col items-center justify-center rounded border text-center transition hover:border-seal ${tone} ${
                      isSelected ? 'ring-2 ring-seal' : ''
                    }`}
                  >
                    <span className="font-song text-base leading-none text-ink">
                      {item.actualCharacter === null
                        ? item.expectedCharacter || ''
                        : item.actualCharacter || '空'}
                    </span>
                    <span className="mt-0.5 text-[9px] leading-none text-ink-mute">
                      {item.actualCharacter === null
                        ? `账面 ${item.expectedCharacter || '空'} · 未盘`
                        : `账 ${item.expectedCharacter || '空'} · ${meta.text}`}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CellEntry({
  round,
  cell,
  busy,
  matrixCode,
  onRecord,
  onNavigate,
}: {
  round: StocktakeRound;
  cell: StocktakeCell;
  busy: boolean;
  matrixCode: string;
  onRecord: (actual: string | null) => void;
  onNavigate: (row: number, col: number) => void;
}) {
  const idx = round.cells.indexOf(cell);
  const prev = idx > 0 ? round.cells[idx - 1] : null;
  const next = idx < round.cells.length - 1 ? round.cells[idx + 1] : null;
  return (
    <div className="rounded border border-paper-line bg-white/70 px-3 py-3" data-testid="cell-entry">
      <h4 className="font-song text-sm font-semibold text-ink">实盘录入 · {cellLabel(cell.row, cell.col)}</h4>
      <p className="mt-1 text-[11px] text-ink-soft" data-testid="cell-expected">
        账面：
        <span className="font-song text-sm text-ink">{cell.expectedCharacter || '空格'}</span>
        {cell.expectedMatrixId ? <span className="text-ink-mute">（{matrixCode || cell.expectedMatrixId}）</span> : null}
      </p>
      <div className="mt-2">
        <CharacterPicker
          value={cell.actualCharacter ?? ''}
          onChange={(char) => void onRecord(char)}
          label="实盘字符"
          testId="st-char-picker"
          compact
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className="mt-btn"
          data-testid="record-empty-btn"
          disabled={busy || cell.actualCharacter === ''}
          onClick={() => void onRecord('')}
        >
          记为空格
        </button>
        <button
          type="button"
          className="mt-btn"
          data-testid="record-pending-btn"
          disabled={busy || cell.actualCharacter === null}
          onClick={() => void onRecord(null)}
        >
          标为未盘
        </button>
      </div>
      <div className="mt-2 flex justify-between">
        <button
          type="button"
          className="mt-btn"
          data-testid="prev-cell-btn"
          disabled={!prev}
          onClick={() => prev && onNavigate(prev.row, prev.col)}
        >
          上一格
        </button>
        <button
          type="button"
          className="mt-btn"
          data-testid="next-cell-btn"
          disabled={!next}
          onClick={() => next && onNavigate(next.row, next.col)}
        >
          下一格
        </button>
      </div>
    </div>
  );
}

function DiffPanel({
  cell,
  matrices,
  cases,
  onResolve,
}: {
  cell: StocktakeCell;
  matrices: ReturnType<typeof useMatrixStore.getState>['matrices'];
  cases: ReturnType<typeof useCaseStore.getState>['cases'];
  onResolve: (resolution: DiffResolution, adjustMatrixId?: string) => void;
}) {
  const actual = cell.actualCharacter ?? '';
  const candidates = useMemo(
    () =>
      matrices
        .filter((m) => m.character === actual)
        .sort((a, b) => (a.availability === b.availability ? 0 : a.availability === '可用' ? -1 : 1)),
    [matrices, actual],
  );
  const [pickedId, setPickedId] = useState('');
  const adjustId =
    pickedId && candidates.some((m) => m.id === pickedId)
      ? pickedId
      : cell.adjustMatrixId && candidates.some((m) => m.id === cell.adjustMatrixId)
        ? cell.adjustMatrixId
        : candidates.find((m) => m.availability === '可用')?.id ?? candidates[0]?.id ?? '';

  const placementOf = (id: string) => {
    for (const c of cases) {
      const hit = c.slots.find((s) => s.matrixId === id);
      if (hit) return `${c.code} ${cellLabel(hit.row, hit.col)}`;
    }
    return '';
  };

  return (
    <div className="rounded border border-seal/30 bg-seal-pale/30 px-3 py-3" data-testid="diff-panel">
      <h4 className="font-song text-sm font-semibold text-ink">差异处理 · {cellLabel(cell.row, cell.col)}</h4>
      <p className="mt-1 text-[11px] text-ink-soft" data-testid="diff-text">
        账面「{cell.expectedCharacter || '空'}」 → 实盘「{actual || '空'}」
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          className={`mt-btn ${cell.resolution === 'keep' ? 'border-brass bg-brass text-paper' : ''}`}
          data-testid="keep-book-btn"
          onClick={() => void onResolve('keep')}
        >
          保留账面原值
        </button>
        {actual ? (
          <>
            <select
              className="mt-input w-auto"
              aria-label="调账字模"
              data-testid="adjust-matrix-select"
              value={adjustId}
              onChange={(e) => setPickedId(e.target.value)}
            >
              {candidates.length === 0 ? <option value="">档案中无此字符字模</option> : null}
              {candidates.map((m) => {
                const place = placementOf(m.id);
                return (
                  <option key={m.id} value={m.id}>
                    {m.character} · {m.code} · {m.sizeName} · {m.availability}
                    {place ? ` · 现落 ${place}` : ''}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              className={`mt-btn mt-btn-primary ${cell.resolution === 'adjust' ? 'ring-2 ring-brass' : ''}`}
              data-testid="confirm-adjust-btn"
              onClick={() => void onResolve('adjust', adjustId)}
            >
              确认调账
            </button>
          </>
        ) : (
          <button
            type="button"
            className={`mt-btn mt-btn-primary ${cell.resolution === 'adjust' ? 'ring-2 ring-brass' : ''}`}
            data-testid="confirm-adjust-empty-btn"
            onClick={() => void onResolve('adjust', '')}
          >
            确认调账（取出该格字模）
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] text-ink-mute" data-testid="diff-hint">
        {actual && candidates.length === 0
          ? '档案中没有该字符的字模；确认调账后将按实盘字符落位，并在结束时记入遗留提醒，请事后补登字模。'
          : '保留账面：结束后布局不动；确认调账：结束时只改这一格，其它字盘与字模档案不跟着改。'}
      </p>
      {cell.resolution !== 'none' ? (
        <p className="mt-1 text-[11px] text-brass" data-testid="diff-resolved">
          当前结论：{cell.resolution === 'keep' ? '保留账面原值' : '确认调账'}
        </p>
      ) : null}
    </div>
  );
}

const FILTERS: Array<{ key: 'all' | StocktakeCell['result']; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '未盘' },
  { key: 'match', label: '相符' },
  { key: 'diff', label: '差异' },
];

function ChecklistTable({
  round,
  cells,
  filter,
  progress,
  selected,
  matrixCodeMap,
  onFilter,
  onSelect,
  onQuickKeep,
}: {
  round: StocktakeRound;
  cells: StocktakeCell[];
  filter: 'all' | StocktakeCell['result'];
  progress: ReturnType<typeof stocktakeProgress>;
  selected: { row: number; col: number };
  matrixCodeMap: Map<string, string>;
  onFilter: (f: 'all' | StocktakeCell['result']) => void;
  onSelect: (row: number, col: number) => void;
  onQuickKeep: (row: number, col: number) => void;
}) {
  const counts: Record<string, number> = {
    all: round.cells.length,
    pending: progress.pending,
    match: progress.matched,
    diff: progress.diffs,
  };
  return (
    <div className="border-t border-paper-line" data-testid="st-checklist">
      <div className="mt-panel-head">
        <h3 className="font-song text-sm font-semibold text-ink">逐格清单</h3>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              data-testid={`filter-${f.key}`}
              onClick={() => onFilter(f.key)}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                filter === f.key
                  ? 'border-seal bg-seal text-paper'
                  : 'border-paper-line bg-white text-ink-soft hover:border-seal'
              }`}
            >
              {f.label} {counts[f.key] ?? 0}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="min-w-full" data-testid="st-table">
          <thead className="sticky top-0 border-b border-paper-line bg-paper/90">
            <tr>
              <th className="mt-th">格位</th>
              <th className="mt-th">账面</th>
              <th className="mt-th">实盘</th>
              <th className="mt-th">核对</th>
              <th className="mt-th">差异处理</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {cells.map((c) => {
              const isSel = selected.row === c.row && selected.col === c.col;
              return (
                <tr
                  key={`${c.row}-${c.col}`}
                  data-testid={`st-row-${c.row}-${c.col}`}
                  onClick={() => onSelect(c.row, c.col)}
                  className={`cursor-pointer hover:bg-paper-deep/50 ${isSel ? 'bg-seal-pale/40' : ''}`}
                >
                  <td className="mt-td font-song text-xs">{cellLabel(c.row, c.col)}</td>
                  <td className="mt-td">
                    <span className="font-song">{c.expectedCharacter || '空'}</span>
                    {c.expectedMatrixId ? (
                      <span className="ml-1 text-[10px] text-ink-mute">
                        {matrixCodeMap.get(c.expectedMatrixId) ?? c.expectedMatrixId}
                      </span>
                    ) : null}
                  </td>
                  <td className="mt-td font-song" data-testid={`st-actual-${c.row}-${c.col}`}>
                    {c.actualCharacter === null ? <span className="text-ink-mute">—</span> : c.actualCharacter || '空'}
                  </td>
                  <td className="mt-td">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${RESULT_META[c.result].cls}`}>
                      {RESULT_META[c.result].text}
                    </span>
                  </td>
                  <td className="mt-td" data-testid={`st-resolution-${c.row}-${c.col}`}>
                    {c.result !== 'diff' ? (
                      <span className="text-[11px] text-ink-mute">—</span>
                    ) : c.resolution === 'none' ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[11px] text-seal">待处理</span>
                        <button
                          type="button"
                          className="rounded border border-paper-line px-1.5 py-0.5 text-[10px] hover:border-brass"
                          data-testid={`quick-keep-${c.row}-${c.col}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onQuickKeep(c.row, c.col);
                          }}
                        >
                          保留账面
                        </button>
                      </span>
                    ) : (
                      <span className="text-[11px] text-brass">
                        {c.resolution === 'keep' ? '保留账面' : '确认调账'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HistorySection({ closedRounds, loaded }: { closedRounds: StocktakeRound[]; loaded: boolean }) {
  return (
    <section className="mt-panel">
      <div className="mt-panel-head">
        <h3 className="font-song text-sm font-semibold text-ink">盘点历史 · 差异留存</h3>
        <span className="mt-sub">结束时只应用确认的调账；每格账面 / 实盘 / 处理结论永久留存</span>
      </div>
      {!loaded ? (
        <p className="px-4 py-4 text-xs text-ink-mute">正在读取盘点档案…</p>
      ) : closedRounds.length === 0 ? (
        <div className="px-4 py-4">
          <EmptyState
            title="还没有已结束的盘点"
            description="结束一轮盘点后，逐格清单、差异处理结论与遗留提醒会在这里留存，可随时回溯每季的盘存结果。"
            testId="history-empty"
          />
        </div>
      ) : (
        <ul className="divide-y divide-paper-line" data-testid="history-list">
          {closedRounds.map((r) => (
            <HistoryItem key={r.id} round={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function HistoryItem({ round }: { round: StocktakeRound }) {
  const matrices = useMatrixStore((s) => s.matrices);
  const removeRound = useInventoryStore((s) => s.removeRound);
  const pushToast = useUiStore((s) => s.pushToast);
  const [open, setOpen] = useState(false);

  const progress = useMemo(() => stocktakeProgress(round.cells), [round.cells]);
  const diffs = useMemo(() => round.cells.filter((c) => c.result === 'diff'), [round.cells]);
  const codeOf = (id: string) => matrices.find((m) => m.id === id)?.code ?? id;

  return (
    <li className="px-4 py-3" data-testid={`history-item-${round.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="flex flex-col items-start gap-0.5 text-left" onClick={() => setOpen((v) => !v)}>
          <span className="font-song text-sm text-ink">
            {round.code} · {round.caseCode}
            <span className="ml-2 text-[11px] text-ink-mute">{round.caseKind}</span>
          </span>
          <span className="text-[11px] text-ink-mute">
            {formatStamp(round.createdAt)} 发起 · {formatStamp(round.closedAt)} 结束 · 保管员 {dash(round.keeper)} ·
            已盘 {progress.checked}/{progress.total} · 相符 {progress.matched} · 差异 {progress.diffs}（调账{' '}
            {round.appliedCount} 格）
            {round.note ? ` · ${round.note}` : ''}
          </span>
        </button>
        <div className="flex items-center gap-2">
          <button type="button" className="mt-btn" data-testid={`history-toggle-${round.id}`} onClick={() => setOpen((v) => !v)}>
            {open ? '收起' : '查看差异'}
          </button>
          <button
            type="button"
            className="mt-btn"
            data-testid={`history-delete-${round.id}`}
            onClick={async () => {
              try {
                await removeRound(round.id);
                pushToast(`已删除盘点历史 ${round.code}（字盘布局不受影响）`, 'warn');
              } catch (err) {
                pushToast(err instanceof Error ? err.message : '删除失败', 'error');
              }
            }}
          >
            删除记录
          </button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-2" data-testid={`history-detail-${round.id}`}>
          {round.closeWarnings.length > 0 ? (
            <div className="rounded border border-brass/40 bg-brass-pale px-3 py-2 text-[11px] text-brass" data-testid={`history-warnings-${round.id}`}>
              <p className="font-semibold">遗留提醒（{round.closeWarnings.length}）</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {round.closeWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="min-w-full" data-testid={`history-table-${round.id}`}>
              <thead className="border-b border-paper-line bg-paper/60">
                <tr>
                  <th className="mt-th">格位</th>
                  <th className="mt-th">账面</th>
                  <th className="mt-th">实盘</th>
                  <th className="mt-th">处理结论</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper-line">
                {diffs.length === 0 ? (
                  <tr>
                    <td className="mt-td text-ink-mute" colSpan={4}>
                      本轮全部相符，没有差异。
                    </td>
                  </tr>
                ) : (
                  diffs.map((c) => (
                    <tr key={`${c.row}-${c.col}`} data-testid={`history-diff-${round.id}-${c.row}-${c.col}`}>
                      <td className="mt-td font-song text-xs">{cellLabel(c.row, c.col)}</td>
                      <td className="mt-td font-song">{c.expectedCharacter || '空'}</td>
                      <td className="mt-td font-song">{c.actualCharacter || '空'}</td>
                      <td className="mt-td text-xs">
                        {c.resolution === 'keep'
                          ? '保留账面原值'
                          : (c.actualCharacter ?? '') === ''
                            ? '确认调账（取出字模，该格置空）'
                            : c.adjustMatrixId
                              ? `确认调账（${codeOf(c.adjustMatrixId)}）`
                              : `确认调账（按字符「${c.actualCharacter}」落位）`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </li>
  );
}
