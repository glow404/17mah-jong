import type { ReactNode } from 'react';
import { DiscardRiver } from '../../components/DiscardRiver';
import { MahjongTile } from '../../components/MahjongTile';
import {
  doraFromIndicator,
  sortTiles,
  tileText,
  tileType,
  type ScoreResult,
} from '../../lib/mahjong';
import type { GameResult, Seat } from '../game/localGameReducer';
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
  furiten: boolean;
  result: GameResult | null;
  baseScore: number;
  onSelectDiscard: (id: number) => void;
  onDiscard: (id: number) => void;
  onRon: () => void;
  onPass: () => void;
  onAgain: () => void;
  onHome: () => void;
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
  furiten,
  result,
  baseScore,
  onSelectDiscard,
  onDiscard,
  onRon,
  onPass,
  onAgain,
  onHome,
  header,
  waitingText,
}: TableScreenProps) {
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
          <div className="hidden-hand">
            {hand.map((_, index) => (
              <MahjongTile tile={0} hidden small key={index} />
            ))}
          </div>
          <DiscardRiver tiles={discards[1]} />
        </div>
        <div className="table-center">
          <div className="wind-box">
            <span>东</span>
            <b>{String(Math.max(counts[0], counts[1])).padStart(2, '0')}</b>
            <small>各余 {Math.max(0, 17 - Math.max(counts[0], counts[1]))} 巡</small>
          </div>
          <div className="battle-dora">
            <small>宝牌指示</small>
            <MahjongTile tile={indicator} small />
            <em>宝牌 {tileText(doraFromIndicator(indicator))}</em>
          </div>
          <div className={`turn-notice ${turn === 0 ? 'your-turn' : ''}`}>
            {waitingText ?? (turn === 0 ? '轮到你舍牌' : `${opponentName}正在思考…`)}
          </div>
        </div>
        <div className="player-zone">
          <DiscardRiver tiles={discards[0]} />
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
            <div className="reserve-tiles">
              {sortTiles(remainingTiles).map((id) => (
                <MahjongTile
                  key={id}
                  physicalId={id}
                  tile={tileType(id)}
                  small
                  selected={selectedDiscard === id}
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
                    disabled={turn !== 0 || pendingRon || Boolean(result)}
                    onClick={() => onDiscard(selectedDiscard)}
                  >
                    {counts[0] === 0 ? '打出并立直' : '打出此牌'} <b>→</b>
                  </button>
                </>
              ) : (
                <p>{turn === 0 ? '请从上方剩余牌中选择一张' : '可先选择下一张舍牌'}</p>
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
          <button className="ron-button" type="button" onClick={onRon}>
            荣和
          </button>
          <button className="pass-button" type="button" onClick={onPass}>
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
        />
      )}
    </main>
  );
}
