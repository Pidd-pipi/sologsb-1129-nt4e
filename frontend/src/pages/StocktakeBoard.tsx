import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import CharacterPicker from '../components/common/CharacterPicker';
import EmptyState from '../components/common/EmptyState';
import { useCaseStore } from '../stores/caseStore';
import { useStocktakeStore } from '../stores/stocktakeStore';
import { useUiStore } from '../stores/uiStore';
import type { StocktakeItem, StocktakeRound } from '../types/stocktake';
import {
  STOCKTAKE_RESOLUTIONS,
  actualLabel,
  bookLabel,
  cellLabel,
  isDifference,
  stocktakeProgress,
} from '../types/stocktake';
import { formatStamp } from '../utils/format';
import { parseRcKey, rcKey } from '../utils/layout';

/** `/stocktakes` 字盘盘点：按字盘逐格盘存，差异处理完后才允许结束，结束时只写入确认的调账 */
export default function StocktakeBoard() {
  const cases = useCaseStore((s) => s.cases);
  const casesLoaded = useCaseStore((s) => s.loaded);
  const rounds = useStocktakeStore((s) => s.rounds);
  const roundsLoaded = useStocktakeStore((s) => s.loaded);
  const loadRounds = useStocktakeStore((s) => s.load);
  const startRound = useStocktakeStore((s) => s.startRound);
  const pushToast = useUiStore((s) => s.pushToast);
  const selectedCaseId = useUiStore((s) => s.selectedCaseId);
  const setSelectedCaseId = useUiStore((s) => s.setSelectedCaseId);

  const [operator, setOperator] = useState('');
  const [operatorError, setOperatorError] = useState('');

  useEffect(() => {
    void loadRounds();
  }, [loadRounds]);

  const selected = useMemo(
    () => cases.find((c) => c.id === selectedCaseId) ?? cases[0],
    [cases, selectedCaseId],
  );

  /** 各字盘进行中的盘点（同一字盘同时最多一轮） */
  const activeByCase = useMemo(() => {
    const map = new Map<string, StocktakeRound>();
    rounds.forEach((r) => {
      if (r.status === '盘点中') map.set(r.caseId, r);
    });
    return map;
  }, [rounds]);

  const activeRound = selected ? activeByCase.get(selected.id) : undefined;
  const history = useMemo(() => rounds.filter((r) => r.status === '已结束'), [rounds]);

  const handleStart = async () => {
    if (!selected) return;
    if (!operator.trim()) {
      setOperatorError('请填写保管员姓名');
      pushToast('开始盘点前请填写保管员姓名', 'warn');
      return;
    }
    setOperatorError('');
    try {
      const round = await startRound(selected.id, operator);
      pushToast(`已开始盘点 ${round.caseCode}，逐格清单共 ${round.items.length} 格`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '开始盘点失败', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="mt-title" data-testid="stocktake-title">
            字盘盘点
          </h2>
          <p className="mt-sub">
            按字盘生成逐格清单，逐格录入实盘字符或空格；不一致形成差异，由保管员保留账面或确认调账，全部处理完才能结束，结束后只写入确认的调账。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="mt-chip" data-testid="stocktake-active-count">
            进行中 {activeByCase.size} 轮
          </span>
          <span className="mt-chip" data-testid="stocktake-history-count">
            历史 {history.length} 轮
          </span>
        </div>
      </section>

      {cases.length === 0 ? (
        <EmptyState
          title={casesLoaded ? '还没有可盘点的字盘' : '正在读取字盘档案…'}
          description="请先到「字盘布局」新建字盘并落位，再回来开始逐格盘点。"
          action={
            <Link className="mt-btn" to="/cases" data-testid="goto-cases">
              去字盘布局
            </Link>
          }
          testId="stocktake-no-case"
        />
      ) : (
        <section className="mt-panel">
          <div className="mt-panel-head">
            <h3 className="font-song text-sm font-semibold text-ink">开始新一轮盘点</h3>
            <span className="mt-sub">每季按字盘逐格盘存；同一字盘同时只能有一轮进行中</span>
          </div>
          <div className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_220px_auto]">
            <div>
              <label className="mt-label" htmlFor="stocktake-case-select">
                盘点字盘
              </label>
              <select
                id="stocktake-case-select"
                data-testid="stocktake-case-select"
                className="mt-input"
                value={selected?.id ?? ''}
                onChange={(e) => setSelectedCaseId(e.target.value)}
              >
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.kind} · {c.workStation}
                    {activeByCase.has(c.id) ? '（盘点中）' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mt-label" htmlFor="stocktake-operator-input">
                保管员
              </label>
              <input
                id="stocktake-operator-input"
                data-testid="stocktake-operator-input"
                className="mt-input"
                placeholder="例：陈之安"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
              />
              {operatorError ? (
                <p className="mt-error" data-testid="error-operator">
                  {operatorError}
                </p>
              ) : null}
            </div>
            <div className="flex items-end">
              <button
                type="button"
                className="mt-btn mt-btn-primary"
                data-testid="start-stocktake-btn"
                disabled={!selected || Boolean(activeRound) || !roundsLoaded}
                onClick={handleStart}
              >
                {activeRound ? '该字盘盘点中' : '开始盘点'}
              </button>
            </div>
          </div>
          {selected && !activeRound ? (
            <p
              className="border-t border-paper-line px-4 py-2 text-[11px] text-ink-mute"
              data-testid="start-hint"
            >
              将以当前落库布局为账面，生成 {selected.rows} 行 × {selected.cols} 列逐格清单（已落位{' '}
              {selected.slots.length} 格）。
            </p>
          ) : null}
        </section>
      )}

      {activeRound ? <ActiveRoundPanel key={activeRound.id} round={activeRound} /> : null}

      <HistoryPanel rounds={history} loaded={roundsLoaded} />
    </div>
  );
}

type CellState = 'uncounted' | 'match' | 'diff' | 'resolved';

const CELL_STYLE: Record<CellState, string> = {
  uncounted: 'border-dashed border-paper-line bg-paper/50',
  match: 'border-jade/40 bg-jade-pale/60',
  diff: 'border-seal/60 bg-seal-pale',
  resolved: 'border-brass/60 bg-brass-pale/70',
};

function cellStateOf(item: StocktakeItem): CellState {
  if (item.actual === null) return 'uncounted';
  if (!isDifference(item)) return 'match';
  return item.resolution ? 'resolved' : 'diff';
}

function cellSubText(item: StocktakeItem): string {
  const state = cellStateOf(item);
  if (state === 'uncounted') return '未盘';
  if (state === 'match') return '一致';
  if (state === 'diff') return `账 ${bookLabel(item.bookCharacter)}`;
  return item.resolution === '确认调账' ? '调账' : '保留';
}

/** 进行中的盘点：逐格录入 + 差异处理 + 结束 / 作废 */
function ActiveRoundPanel({ round }: { round: StocktakeRound }) {
  const setActual = useStocktakeStore((s) => s.setActual);
  const clearActual = useStocktakeStore((s) => s.clearActual);
  const fillRestWithBook = useStocktakeStore((s) => s.fillRestWithBook);
  const resolveDiff = useStocktakeStore((s) => s.resolveDiff);
  const finishRound = useStocktakeStore((s) => s.finishRound);
  const discardRound = useStocktakeStore((s) => s.discardRound);
  const pushToast = useUiStore((s) => s.pushToast);

  const [selectedKey, setSelectedKey] = useState('');
  const [finishing, setFinishing] = useState(false);

  const progress = useMemo(() => stocktakeProgress(round.items), [round.items]);
  const rows = useMemo(() => Math.max(...round.items.map((i) => i.row), -1) + 1, [round.items]);
  const cols = useMemo(() => Math.max(...round.items.map((i) => i.col), -1) + 1, [round.items]);
  const diffs = useMemo(() => round.items.filter(isDifference), [round.items]);

  const selectedCell = selectedKey ? parseRcKey(selectedKey) : null;
  const selectedItem = selectedCell
    ? round.items.find((i) => i.row === selectedCell.row && i.col === selectedCell.col)
    : undefined;

  const jumpNextUncounted = (after?: StocktakeItem) => {
    const next = round.items.find(
      (i) => i.actual === null && !(after && i.row === after.row && i.col === after.col),
    );
    if (next) setSelectedKey(rcKey(next.row, next.col));
  };

  const recordActual = async (item: StocktakeItem, actual: string) => {
    const wasUncounted = item.actual === null;
    try {
      await setActual(round.id, item.row, item.col, actual);
      if (wasUncounted) jumpNextUncounted(item);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '实盘录入失败', 'error');
    }
  };

  const handleFillRest = async () => {
    const rest = progress.total - progress.counted;
    if (!window.confirm(`将剩余 ${rest} 个未盘格全部按「与账面一致」补录？`)) return;
    try {
      const n = await fillRestWithBook(round.id);
      pushToast(`已按账面补录 ${n} 格，请复核差异并逐条处理`);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '补录失败', 'error');
    }
  };

  const handleFinish = async () => {
    setFinishing(true);
    try {
      const adjusted = await finishRound(round.id);
      pushToast(
        adjusted > 0 ? `盘点已结束，已按确认调账写入 ${adjusted} 格` : '盘点已结束，账面保持一致',
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '结束盘点失败', 'error');
    } finally {
      setFinishing(false);
    }
  };

  const handleDiscard = async () => {
    if (!window.confirm(`确定作废 ${round.caseCode} 本轮盘点吗？盘点记录将被删除，字盘布局不受影响。`))
      return;
    try {
      await discardRound(round.id);
      pushToast('已作废本轮盘点，字盘布局未改动', 'warn');
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '作废失败', 'error');
    }
  };

  return (
    <section className="mt-panel" data-testid="stocktake-active">
      <div className="mt-panel-head">
        <div>
          <h3 className="font-song text-sm font-semibold text-ink">{round.caseCode} · 盘点中</h3>
          <p className="mt-sub">
            开始于 {formatStamp(round.startedAt)} · 保管员 {round.operator} · 工位 {round.workStation}
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="stocktake-progress">
          <span className="mt-chip" data-testid="progress-counted">
            已盘 {progress.counted}/{progress.total}
          </span>
          <span className="mt-chip border-seal/40 text-seal" data-testid="progress-diff">
            差异 {progress.diffCount}
          </span>
          <span className="mt-chip border-brass/40 text-brass" data-testid="progress-unresolved">
            待处理 {progress.unresolved}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[1fr_320px]">
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
              <div
                className="grid gap-1"
                style={{ gridTemplateColumns: `28px repeat(${cols}, minmax(44px, 1fr))` }}
                data-testid="stocktake-grid"
                data-rows={rows}
                data-cols={cols}
              >
                <div className="flex h-7 items-center justify-center text-[10px] text-ink-mute">列</div>
                {Array.from({ length: cols }, (_, c) => (
                  <div
                    key={`h-${c}`}
                    className="flex h-7 items-center justify-center font-song text-[11px] text-ink-mute"
                  >
                    {c + 1}
                  </div>
                ))}
                {Array.from({ length: rows }, (_, r) => (
                  <div key={`row-${r}`} className="contents">
                    <div className="flex h-11 items-center justify-center font-song text-[11px] text-ink-mute">
                      {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[r] ?? r + 1}
                    </div>
                    {Array.from({ length: cols }, (_, c) => {
                      const item = round.items.find((i) => i.row === r && i.col === c);
                      if (!item) return <div key={`${r}-${c}`} />;
                      const state = cellStateOf(item);
                      const main = item.actual === null ? item.bookCharacter : item.actual;
                      const isSelected = selectedKey === rcKey(r, c);
                      return (
                        <button
                          key={rcKey(r, c)}
                          type="button"
                          onClick={() => setSelectedKey(rcKey(r, c))}
                          title={`${cellLabel(r, c)} 账 ${bookLabel(item.bookCharacter)} · 实 ${actualLabel(item.actual)}`}
                          data-testid={`stocktake-cell-${r}-${c}`}
                          data-state={state}
                          className={`flex h-11 cursor-pointer flex-col items-center justify-center rounded border text-center transition hover:border-seal ${CELL_STYLE[state]} ${
                            isSelected ? 'ring-2 ring-seal' : ''
                          }`}
                        >
                          <span
                            className={`font-song text-lg leading-none ${
                              main ? 'text-ink' : 'text-ink-mute/70'
                            }`}
                          >
                            {main || (item.actual === null ? '' : '空')}
                          </span>
                          <span className="mt-0.5 text-[9px] leading-none text-ink-mute">
                            {cellSubText(item)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] text-ink-mute" data-testid="stocktake-legend">
            <span className="mt-chip">虚线：未盘</span>
            <span className="mt-chip border-jade/40 text-jade">绿：与账面一致</span>
            <span className="mt-chip border-seal/40 text-seal">红：差异待处理</span>
            <span className="mt-chip border-brass/40 text-brass">黄：差异已处理</span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded border border-paper-line bg-white/70 px-3 py-3" data-testid="stocktake-entry">
            <h4 className="mb-2 font-song text-sm font-semibold text-ink">逐格录入</h4>
            {selectedItem ? (
              <div className="space-y-2">
                <p className="text-xs text-ink-soft" data-testid="entry-position">
                  格位 {cellLabel(selectedItem.row, selectedItem.col)} · 账面{' '}
                  {bookLabel(selectedItem.bookCharacter)}
                  {selectedItem.bookMatrixId ? `（${selectedItem.bookMatrixId}）` : ''} · 实盘{' '}
                  {actualLabel(selectedItem.actual)}
                </p>
                <CharacterPicker
                  value={selectedItem.actual ?? ''}
                  onChange={(char) => void recordActual(selectedItem, char)}
                  label="实盘字符（选取即录入）"
                  testId="stocktake-char-picker"
                  compact
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="mt-btn"
                    data-testid="entry-match-btn"
                    disabled={selectedItem.actual === selectedItem.bookCharacter}
                    onClick={() => void recordActual(selectedItem, selectedItem.bookCharacter)}
                  >
                    与账面一致
                  </button>
                  <button
                    type="button"
                    className="mt-btn"
                    data-testid="entry-blank-btn"
                    disabled={selectedItem.actual === ''}
                    onClick={() => void recordActual(selectedItem, '')}
                  >
                    实盘为空格
                  </button>
                  <button
                    type="button"
                    className="mt-btn"
                    data-testid="entry-clear-btn"
                    disabled={selectedItem.actual === null}
                    onClick={async () => {
                      try {
                        await clearActual(round.id, selectedItem.row, selectedItem.col);
                      } catch (err) {
                        pushToast(err instanceof Error ? err.message : '操作失败', 'error');
                      }
                    }}
                  >
                    标回未盘
                  </button>
                  <button
                    type="button"
                    className="mt-btn"
                    data-testid="entry-next-btn"
                    disabled={progress.counted === progress.total}
                    onClick={() => jumpNextUncounted()}
                  >
                    下一未盘格
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-ink-mute" data-testid="entry-empty">
                点击左侧格位开始逐格录入实盘；字符从选择器选取即落账，也可用快捷按钮记「一致」或「空格」。
              </p>
            )}
          </div>

          <div className="rounded border border-paper-line bg-white/70 px-3 py-3" data-testid="stocktake-diffs">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h4 className="font-song text-sm font-semibold text-ink">差异处理</h4>
              <span className="text-[11px] text-ink-mute" data-testid="diff-count">
                差异 {progress.diffCount} · 待处理 {progress.unresolved}
              </span>
            </div>
            {diffs.length === 0 ? (
              <p className="text-[11px] text-ink-mute" data-testid="diff-empty">
                暂无差异；逐格录入后不一致的格位会列在这里。
              </p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto" data-testid="diff-list">
                {diffs.map((item) => (
                  <li
                    key={rcKey(item.row, item.col)}
                    className="rounded border border-paper-line bg-paper/40 px-2 py-1.5"
                    data-testid={`diff-row-${item.row}-${item.col}`}
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-song text-sm text-ink">
                        {cellLabel(item.row, item.col)}
                      </span>
                      <span className="text-ink-soft">账 {bookLabel(item.bookCharacter)}</span>
                      <span className="text-ink-mute">→</span>
                      <span className="text-seal">实 {actualLabel(item.actual)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {STOCKTAKE_RESOLUTIONS.map((res) => (
                        <button
                          key={res}
                          type="button"
                          data-testid={`${res === '保留账面' ? 'diff-keep' : 'diff-adjust'}-${item.row}-${item.col}`}
                          onClick={async () => {
                            try {
                              await resolveDiff(round.id, item.row, item.col, res);
                            } catch (err) {
                              pushToast(err instanceof Error ? err.message : '差异处理失败', 'error');
                            }
                          }}
                          className={`rounded border px-2 py-0.5 text-[11px] transition ${
                            item.resolution === res
                              ? res === '确认调账'
                                ? 'border-seal bg-seal text-paper'
                                : 'border-brass bg-brass text-paper'
                              : 'border-paper-line bg-white text-ink-soft hover:border-seal'
                          }`}
                        >
                          {res}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[11px] text-ink-mute">
              保留账面：账面原值不动；确认调账：结束时把该格账面改为实盘。差异全部处理完才能结束盘点。
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-paper-line px-4 py-3">
        <button
          type="button"
          className="mt-btn mt-btn-primary"
          data-testid="finish-stocktake-btn"
          disabled={!progress.canFinish || finishing}
          onClick={handleFinish}
        >
          {finishing ? '结束中…' : '结束盘点'}
        </button>
        <button
          type="button"
          className="mt-btn"
          data-testid="fill-rest-btn"
          disabled={progress.counted === progress.total}
          onClick={handleFillRest}
        >
          其余未盘格均与账面一致
        </button>
        <button type="button" className="mt-btn" data-testid="discard-stocktake-btn" onClick={handleDiscard}>
          作废本轮
        </button>
        <span className="text-[11px] text-ink-mute" data-testid="finish-hint">
          {progress.canFinish
            ? '差异已全部处理，可以结束；结束后只写入确认的调账，其余档案不动。'
            : `还不能结束：未盘 ${progress.total - progress.counted} 格 · 未处理差异 ${progress.unresolved} 条`}
        </span>
      </div>
    </section>
  );
}

/** 盘点历史：已结束轮次的差异与调账留档 */
function HistoryPanel({ rounds, loaded }: { rounds: StocktakeRound[]; loaded: boolean }) {
  const [openId, setOpenId] = useState('');

  return (
    <section className="mt-panel">
      <div className="mt-panel-head">
        <h3 className="font-song text-sm font-semibold text-ink">盘点历史</h3>
        <span className="mt-sub">已结束轮次的差异处理留档；字模档案不随调账改动</span>
      </div>
      {rounds.length === 0 ? (
        <div className="px-4 py-4">
          <EmptyState
            title={loaded ? '还没有已结束的盘点' : '正在读取盘点历史…'}
            description="结束一轮盘点后，差异处理与调账结果会留档在这里。"
            testId="history-empty"
          />
        </div>
      ) : (
        <ul className="divide-y divide-paper-line" data-testid="stocktake-history">
          {rounds.map((r) => {
            const diffs = r.items.filter(isDifference);
            const keep = diffs.filter((d) => d.resolution === '保留账面').length;
            const adjust = diffs.filter((d) => d.resolution === '确认调账').length;
            const open = openId === r.id;
            return (
              <li key={r.id} data-testid={`history-row-${r.id}`}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-2 px-4 py-2.5 text-left transition hover:bg-paper-deep/60"
                  data-testid={`history-toggle-${r.id}`}
                  onClick={() => setOpenId(open ? '' : r.id)}
                >
                  <span className="font-song text-sm text-ink">{r.caseCode}</span>
                  <span className="text-[11px] text-ink-mute">
                    {formatStamp(r.finishedAt)} 结束 · 保管员 {r.operator}
                  </span>
                  <span className="mt-chip">差异 {diffs.length}</span>
                  <span className="mt-chip border-seal/40 text-seal">调账 {adjust}</span>
                  <span className="mt-chip border-brass/40 text-brass">保留账面 {keep}</span>
                  <span className="ml-auto text-[11px] text-ink-mute">{open ? '收起' : '展开'}</span>
                </button>
                {open ? (
                  <div className="border-t border-paper-line px-4 py-3" data-testid={`history-diffs-${r.id}`}>
                    {diffs.length === 0 ? (
                      <p className="text-xs text-ink-mute">全盘一致，无差异；账面未改动。</p>
                    ) : (
                      <>
                        <div className="overflow-x-auto">
                          <table className="min-w-full">
                            <thead className="border-b border-paper-line bg-paper/60">
                              <tr>
                                <th className="mt-th">格位</th>
                                <th className="mt-th">账面</th>
                                <th className="mt-th">实盘</th>
                                <th className="mt-th">处理</th>
                                <th className="mt-th">处理时间</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-paper-line">
                              {diffs.map((d) => (
                                <tr key={rcKey(d.row, d.col)} data-testid={`history-diff-${r.id}-${d.row}-${d.col}`}>
                                  <td className="mt-td font-song text-ink">{cellLabel(d.row, d.col)}</td>
                                  <td className="mt-td">{bookLabel(d.bookCharacter)}</td>
                                  <td className="mt-td">{actualLabel(d.actual)}</td>
                                  <td className="mt-td">
                                    <span
                                      className={`mt-chip ${
                                        d.resolution === '确认调账'
                                          ? 'border-seal/40 text-seal'
                                          : 'border-brass/40 text-brass'
                                      }`}
                                    >
                                      {d.resolution}
                                    </span>
                                  </td>
                                  <td className="mt-td">{formatStamp(d.resolvedAt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="mt-2 text-[11px] text-ink-mute">
                          共 {r.items.length} 格，一致 {r.items.length - diffs.length} 格从略；确认调账 {adjust}{' '}
                          格已写入字盘布局（实际写入 {r.adjustedCount} 格），保留账面 {keep} 格未改动。
                        </p>
                      </>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
