import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { DiscardRiver } from '../../components/DiscardRiver';
import { MahjongTile } from '../../components/MahjongTile';
import { doraFromIndicator, sortTiles, tileText, tileType } from '../../lib/rules/tiles';
import type { GameResult, ScoreResult, Seat } from '../../lib/contracts/mahjong';
import type { AiDiscardDecision } from '../game/ai';
import { ResultScreen } from './ResultScreen';

export interface TableScreenProps {
  hand: number[];
  indicator: number;
  discards: [number[], number[]];
  counts: [number, number];
  turn: Seat;
  remainingTiles: number[];
  selectedDiscard: number | null;
  opponentName: string;
  pendingRon: boolean;
  pendingScore?: ScoreResult | null;
  actionBusy?: boolean;
  turnDeadlineAt?: number | null;
  canSurrender?: boolean;
  furiten: boolean;
  aiInsight?: AiDiscardDecision | null;
  result: GameResult | null;
  baseScore: number;
  onSelectDiscard: (id: number) => void;
  onDiscard: (id: number) => void;
  onRon: () => void;
  onPass: () => void;
  onSurrender?: () => void;
  onAgain: () => void;
  onHome: () => void;
  onHistory?: () => void;
  header: ReactNode;
  waitingText?: string;
}

export function TableScreen({
  hand,
  indicator,
  discards,
  counts,
  turn,
  remainingTiles,
  selectedDiscard,
  opponentName,
  pendingRon,
  pendingScore,
  actionBusy = false,
  turnDeadlineAt = null,
  canSurrender = false,
  furiten,
  aiInsight = null,
  result,
  baseScore,
  onSelectDiscard,
  onDiscard,
  onRon,
  onPass,
  onSurrender,
  onAgain,
  onHome,
  onHistory,
  header,
  waitingText,
}: TableScreenProps) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!turnDeadlineAt || result) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [turnDeadlineAt, result]);
  const secondsLeft = turnDeadlineAt ? Math.max(0, Math.ceil((turnDeadlineAt - now) / 1000)) : null;

  return (
    <main className="game-shell battle-shell" data-screen="table">
      {header}
      <div className="match-bar">
        <span>东一局</span>
        <b>底分 {baseScore.toLocaleString()}</b>
        <span>第 {Math.max(counts[0], counts[1], 1)} / 17 巡</span>
      </div>
      <section className="battle-table">
        <div className="opponent-zone">
          <div className="seat-label">
            <div className="avatar">{opponentName === '电脑牌手' ? 'AI' : '客'}</div>
            <div>
              <b>{opponentName}</b>
              <small>西家 · 已舍 {counts[1]} 张</small>
            </div>
            <span className="riichi-badge">两立直</span>
          </div>
          <div className="hidden-hand" role="img" aria-label={`对手手牌，${hand.length}张暗牌`}>
            {hand.map((_, index) => (
              <MahjongTile tile={0} hidden small key={index} />
            ))}
          </div>
          <DiscardRiver tiles={discards[1]} label="对手弃牌区" />
          {aiInsight && (
            <div className="ai-insight" aria-live="polite">
              <div>
                <b>
                  {aiInsight.difficulty === 'easy'
                    ? '简单 AI'
                    : aiInsight.difficulty === 'normal'
                      ? '普通 AI'
                      : '困难 AI'}{' '}
                  已舍
                </b>
                <MahjongTile tile={tileType(aiInsight.physicalId)} small />
                <small>思考 {aiInsight.elapsedMs.toFixed(1)} ms</small>
              </div>
              <p>{aiInsight.reason}</p>
            </div>
          )}
        </div>
        <div className="table-center">
          <div className="wind-box">
            <span>东</span>
            <b>{String(Math.max(counts[0], counts[1])).padStart(2, '0')}</b>
            <small>各余 {Math.max(0, 17 - Math.max(counts[0], counts[1]))} 巡</small>
          </div>
          {secondsLeft !== null && (
            <small className="turn-deadline" role="timer" aria-live="off">
              操作剩余 {now === 0 ? '…' : secondsLeft} 秒
            </small>
          )}
          <div className="battle-dora">
            <small>宝牌指示</small>
            <MahjongTile tile={indicator} small />
            <em>宝牌 {tileText(doraFromIndicator(indicator))}</em>
          </div>
          <div
            className={`turn-notice ${turn === 0 ? 'your-turn' : ''}`}
            role="status"
            aria-live="polite"
          >
            {waitingText ?? (turn === 0 ? '轮到你舍牌' : `${opponentName}正在思考…`)}
          </div>
        </div>
        <div className="player-zone">
          <DiscardRiver tiles={discards[0]} label="你的弃牌区" />
          <div className="active-hand">
            {hand.map((tile, index) => (
              <MahjongTile tile={tile} key={`${tile}-${index}`} />
            ))}
          </div>
          <div className="reserve-tray">
            <div>
              <b>可舍牌</b>
              <small>从剩余 {remainingTiles.length} 张中任选一张</small>
            </div>
            <div className="reserve-tiles" role="group" aria-label="可选择舍出的牌">
              {sortTiles(remainingTiles).map((id) => (
                <MahjongTile
                  key={id}
                  physicalId={id}
                  tile={tileType(id)}
                  small
                  selected={selectedDiscard === id}
                  disabled={actionBusy}
                  onClick={() => onSelectDiscard(id)}
                />
              ))}
            </div>
          </div>
          <div className="player-action-row">
            <div className="seat-label">
              <div className="avatar player-avatar">你</div>
              <div>
                <b>你</b>
                <small>东家 · 已舍 {counts[0]} 张</small>
              </div>
              {furiten && <span className="furiten-badge">振听</span>}
            </div>
            <div className="draw-action">
              {selectedDiscard !== null ? (
                <>
                  <span>
                    <small>{counts[0] === 0 ? '立直舍牌' : '已选择'}</small>
                    <MahjongTile tile={tileType(selectedDiscard)} />
                  </span>
                  <button
                    className="discard-button"
                    type="button"
                    aria-keyshortcuts="Enter"
                    disabled={turn !== 0 || pendingRon || Boolean(result) || actionBusy}
                    onClick={() => onDiscard(selectedDiscard)}
                  >
                    {counts[0] === 0 ? '打出并立直' : '打出此牌'} <b>→</b>
                  </button>
                </>
              ) : (
                <p>{turn === 0 ? '请从上方剩余牌中选择一张' : '可先选择下一张舍牌'}</p>
              )}
              {canSurrender && onSurrender && (
                <button
                  className="pass-button surrender-button"
                  type="button"
                  disabled={actionBusy || Boolean(result)}
                  onClick={onSurrender}
                >
                  认输
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
      {pendingRon && pendingScore && (
        <div className="ron-prompt">
          <div>
            <p>荣和机会</p>
            <h3>
              {pendingScore.tier} · {pendingScore.han} 番 {pendingScore.fu} 符
            </h3>
            <span>{pendingScore.yaku.join(' · ')}</span>
          </div>
          <MahjongTile tile={pendingScore.winningTile} />
          <button
            className="ron-button"
            type="button"
            aria-keyshortcuts="R"
            disabled={actionBusy}
            onClick={onRon}
          >
            荣和
          </button>
          <button
            className="pass-button"
            type="button"
            aria-keyshortcuts="P"
            disabled={actionBusy}
            onClick={onPass}
          >
            放弃
          </button>
        </div>
      )}
      {result && (
        <ResultScreen
          result={result}
          indicator={indicator}
          opponentName={opponentName}
          onHome={onHome}
          onAgain={onAgain}
          onHistory={onHistory}
        />
      )}
    </main>
  );
}
