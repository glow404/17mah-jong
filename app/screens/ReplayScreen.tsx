'use client';

import { useEffect, useMemo, useState } from 'react';
import { DiscardRiver } from '../../components/DiscardRiver';
import { MahjongTile } from '../../components/MahjongTile';
import { doraFromIndicator, tileText, tileType } from '../../lib/rules/tiles';
import type { MatchReplayExport } from '../../lib/history/events';
import { createMatchReplayExport } from '../../lib/history/export';
import { replayMatchEvents } from '../../lib/history/replay';

export function ReplayScreen({
  replay,
  onBack,
}: {
  replay: MatchReplayExport;
  onBack: () => void;
}) {
  const frames = useMemo(() => replayMatchEvents(replay.events), [replay.events]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const current = frames[Math.min(step, frames.length - 1)];
  const event = replay.events[Math.min(step, replay.events.length - 1)];
  const isPlaying = playing && step < frames.length - 1;

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setStep((value) => Math.min(value + 1, frames.length - 1));
    }, 900);
    return () => window.clearInterval(timer);
  }, [frames.length, isPlaying]);

  const downloadReplay = () => {
    try {
      const sanitized = createMatchReplayExport(replay.match, replay.events);
      const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `17mah-jong-${replay.match.matchId}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setError('');
    } catch {
      setError('导出失败，请重试。');
    }
  };

  const label = describeEvent(event);
  const finishedAt = new Date(replay.match.finishedAt).toLocaleString();

  return (
    <main className="history-shell replay-shell" data-screen="replay">
      <div className="history-heading">
        <div>
          <p className="eyebrow">
            <span /> 对局回放
          </p>
          <h1>
            {replay.match.result.kind === 'ron'
              ? `${replay.match.result.score.tier}荣和`
              : '牌局回放'}
          </h1>
          <p>
            {finishedAt} · 底分 {replay.match.baseScore.toLocaleString()} ·{' '}
            {replay.match.viewerSeat === 0 ? '你是东家' : '你是西家'}
          </p>
        </div>
        <div className="history-heading-actions">
          <button className="secondary-action" type="button" onClick={downloadReplay}>
            导出 JSON ↓
          </button>
          <button className="secondary-action" type="button" onClick={onBack}>
            ← 对局历史
          </button>
        </div>
      </div>

      <section className="replay-card" aria-label="逐巡回放控制">
        <div className="replay-step-label">
          <b>{label.title}</b>
          <span>
            事件 {step + 1} / {frames.length}
          </span>
        </div>
        {label.tile !== undefined && (
          <div className="replay-event-tile">
            <MahjongTile tile={label.tile} small />
            <span>{tileText(label.tile)}</span>
          </div>
        )}
        <input
          className="replay-scrubber"
          type="range"
          min={0}
          max={frames.length - 1}
          value={step}
          aria-label="回放进度"
          onChange={(eventChange) => {
            setPlaying(false);
            setStep(Number(eventChange.currentTarget.value));
          }}
        />
        <div className="replay-controls">
          <button
            type="button"
            className="secondary-action"
            onClick={() => setStep(0)}
            aria-label="回到开局"
          >
            ⏮
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              setPlaying(false);
              setStep((value) => Math.max(0, value - 1));
            }}
            aria-label="上一步"
          >
            ← 上一步
          </button>
          <button
            type="button"
            className="primary-action"
            onClick={() => setPlaying((value) => !value)}
            disabled={step === frames.length - 1}
          >
            {isPlaying ? '暂停Ⅱ' : '播放 ▶'}
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => {
              setPlaying(false);
              setStep((value) => Math.min(frames.length - 1, value + 1));
            }}
            aria-label="下一步"
          >
            下一步 →
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => setStep(frames.length - 1)}
            aria-label="跳到结算"
          >
            ⏭
          </button>
        </div>
        <p className="replay-privacy-note">
          牌谱仅向本局参与者开放；导出文件不含邮箱、账号 ID、房间码或会话凭证。
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>

      <section className="replay-board" aria-label="当前牌局状态">
        <div className="replay-center">
          <div>
            <small>表宝牌指示</small>
            <MahjongTile tile={current.indicator} small />
            <span>宝牌 {tileText(doraFromIndicator(current.indicator))}</span>
          </div>
          <b>第 {Math.max(current.counts[0], current.counts[1], 0)} 巡</b>
          <div>
            <small>里宝牌指示</small>
            {current.result?.kind === 'ron' ? (
              <>
                <MahjongTile tile={current.uraIndicator} small />
                <span>里宝牌 {tileText(doraFromIndicator(current.uraIndicator))}</span>
              </>
            ) : (
              <span>荣和后翻开</span>
            )}
          </div>
        </div>
        <div className="replay-seat-row">
          {[0, 1].map((seat) => {
            const player = seat as 0 | 1;
            const hand = current.hands[player];
            const winningTile =
              current.result?.kind === 'ron' && current.result.winner === player
                ? current.result.score.winningTile
                : undefined;
            return (
              <article className="replay-seat" key={seat}>
                <div className="replay-seat-heading">
                  <b>{player === 0 ? '东家' : '西家'}</b>
                  <span>舍牌 {current.counts[player]} / 17</span>
                  {current.temporaryFuriten[player] && <em>振听</em>}
                </div>
                <div className="replay-hand">
                  {hand?.map((tile, index) => (
                    <MahjongTile tile={tile} small key={`${seat}-${tile}-${index}`} />
                  ))}
                  {winningTile !== undefined && (
                    <MahjongTile tile={winningTile} small key={`${seat}-ron`} />
                  )}
                  {!hand && <span className="replay-empty-hand">尚未选牌</span>}
                </div>
                <DiscardRiver tiles={current.discards[player]} />
              </article>
            );
          })}
        </div>
        {current.result?.kind === 'ron' && (
          <div className="replay-result-line">
            {current.result.winner === 0 ? '东家' : '西家'}荣和 · {current.result.score.tier} ·{' '}
            {current.result.score.han} 番 {current.result.score.fu} 符 · 底分结算{' '}
            {current.result.payment.toLocaleString()}
            <div className="replay-yaku-list">
              {current.result.score.yaku.map((yaku) => (
                <span key={yaku}>{yaku}</span>
              ))}
              <span>宝牌 {current.result.score.dora} 枚</span>
              <span>里宝牌 {current.result.score.uraDora} 枚</span>
            </div>
          </div>
        )}
        {current.result?.kind === 'draw' && <div className="replay-result-line">流局</div>}
        {current.result?.kind === 'forfeit' && (
          <div className="replay-result-line">判负 · {current.result.reason}</div>
        )}
      </section>
    </main>
  );
}

function describeEvent(event: MatchReplayExport['events'][number]) {
  const seat = event.seat === 0 ? '东家' : event.seat === 1 ? '西家' : null;
  switch (event.type) {
    case 'match.created':
      return { title: '建立牌局' };
    case 'match.restored':
      return { title: '记录开始：已恢复当时牌局状态' };
    case 'player.joined':
      return { title: '西家加入牌桌' };
    case 'hand.selected':
      return { title: `${seat}选好 13 张手牌` };
    case 'turn.deadline.started':
      return { title: '启动回合时限' };
    case 'tile.discarded':
      return { title: `${seat}打出一张牌`, tile: tileType(event.payload.physicalTileId) };
    case 'ron.declined':
      return { title: `${seat}放弃荣和` };
    case 'ron.claimed':
      return { title: `${seat}宣布荣和` };
    case 'hand.drawn':
      return {
        title: event.payload.reason === 'both-disconnected' ? '双方掉线，牌局流局' : '十七巡流局',
      };
    case 'player.forfeited':
      return { title: `${seat}判负（${event.payload.reason}）` };
  }
}
