'use client';

import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { MatchHistorySummary, MatchReplayExport } from '../../lib/history/events';
import { readLocalMatchHistory } from '../../lib/history/local';
import { ReplayScreen } from './ReplayScreen';

export function HistoryScreen({
  onBack,
  onLogin,
  header,
}: {
  onBack: () => void;
  onLogin: () => void;
  header: ReactNode;
}) {
  const [matches, setMatches] = useState<(MatchHistorySummary & { origin: 'online' | 'local' })[]>(
    [],
  );
  const [selectedReplay, setSelectedReplay] = useState<MatchReplayExport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const local = readLocalMatchHistory();
    const localEntries = local.map((replay) => ({
      ...replay.match,
      origin: 'local' as const,
    }));
    fetch('/api/history?limit=50', { cache: 'no-store' })
      .then(async (response) => {
        const data = (await response.json()) as { matches?: MatchHistorySummary[]; error?: string };
        if (response.status === 401) {
          if (!cancelled) {
            setMatches(localEntries);
            setNeedsLogin(true);
          }
          return;
        }
        if (!response.ok) throw new Error(data.error || '读取对局历史失败');
        if (!cancelled)
          setMatches(
            [
              ...localEntries,
              ...(data.matches ?? []).map((match) => ({ ...match, origin: 'online' as const })),
            ].sort((left, right) => right.finishedAt - left.finishedAt),
          );
      })
      .catch((cause) => {
        if (!cancelled) {
          setMatches(localEntries);
          setError(cause instanceof Error ? cause.message : '读取对局历史失败');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openReplay = async (match: HistoryEntry) => {
    setError('');
    if (match.origin === 'local') {
      const replay = readLocalMatchHistory().find((item) => item.match.matchId === match.matchId);
      if (!replay) {
        setError('这条本地牌谱已不存在。');
        return;
      }
      setSelectedReplay(replay);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/history?matchId=${encodeURIComponent(match.matchId)}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as MatchReplayExport & { error?: string };
      if (!response.ok) throw new Error(data.error || '读取牌谱失败');
      setSelectedReplay(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取牌谱失败');
    } finally {
      setLoading(false);
    }
  };

  if (selectedReplay)
    return <ReplayScreen replay={selectedReplay} onBack={() => setSelectedReplay(null)} />;

  return (
    <main className="history-shell" data-screen="history">
      {header}
      <div className="history-heading">
        <div>
          <p className="eyebrow">
            <span /> 个人记录
          </p>
          <h1>对局历史</h1>
          <p>联机对局按时间倒序保存；牌谱只向本局参与者开放。</p>
        </div>
        <button className="secondary-action" type="button" onClick={onBack}>
          ← 返回上一页
        </button>
      </div>

      {loading && (
        <p className="history-state" role="status">
          正在读取…
        </p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {needsLogin && (
        <section className="history-empty">
          <h2>登录后同步联机记录</h2>
          <p>电脑对战记录保存在当前浏览器；登录后还可查看跨设备同步的联机牌局。</p>
          <button className="primary-action" type="button" onClick={onLogin}>
            邮箱登录
          </button>
        </section>
      )}
      {!loading && !needsLogin && matches.length === 0 && !error && (
        <section className="history-empty">
          <h2>还没有已完成的对局</h2>
          <p>电脑对战记录保存在当前浏览器，联机记录会同步到账号。</p>
        </section>
      )}
      {matches.length > 0 && (
        <section className="history-list" aria-label="已完成对局">
          {matches.map((match) => (
            <button
              type="button"
              className="history-row"
              key={`${match.origin}-${match.matchId}`}
              onClick={() => void openReplay(match)}
              disabled={loading}
            >
              <span className={`history-result ${resultTone(match)}`}>{resultLabel(match)}</span>
              <span className="history-row-main">
                <b>{resultTitle(match)}</b>
                <small>
                  {match.origin === 'local' ? '电脑对战' : '联机对战'} ·{' '}
                  {new Date(match.finishedAt).toLocaleString()} ·{' '}
                  {match.viewerSeat === 0 ? '东家' : '西家'} · 底分{' '}
                  {match.baseScore.toLocaleString()}
                </small>
              </span>
              <span className="history-open">逐巡回放 →</span>
            </button>
          ))}
        </section>
      )}
    </main>
  );
}

type HistoryEntry = MatchHistorySummary & { origin: 'online' | 'local' };

function resultLabel(match: HistoryEntry) {
  if (match.result.kind === 'draw') return '流局';
  return match.result.winner === match.viewerSeat ? '胜' : '负';
}

function resultTone(match: HistoryEntry) {
  if (match.result.kind === 'draw') return 'neutral';
  return match.result.winner === match.viewerSeat ? 'win' : 'lose';
}

function resultTitle(match: HistoryEntry) {
  const result = match.result;
  if (result.kind === 'ron')
    return `${result.winner === match.viewerSeat ? '荣和' : '放铳'} · ${result.score.tier} · ${result.score.han} 番 ${result.score.fu} 符`;
  if (result.kind === 'draw')
    return result.reason === 'both-disconnected' ? '双方掉线流局' : '十七巡流局';
  const reason =
    result.reason === 'resigned'
      ? '认输'
      : result.reason === 'turn-timeout'
        ? '超时判负'
        : '掉线判负';
  return result.winner === match.viewerSeat ? `对手${reason}，你获胜` : `你${reason}`;
}
