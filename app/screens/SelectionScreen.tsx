import type { ReactNode } from 'react';
import { GameActionBar } from '../../components/GameActionBar';
import { MahjongTile } from '../../components/MahjongTile';
import { describeWaits } from '../../lib/rules/scoring';
import { doraFromIndicator, sortTiles, tileText, tileType } from '../../lib/rules/tiles';

export interface SelectionScreenProps {
  pool: number[];
  selected: number[];
  indicator: number;
  wind: 'east' | 'west';
  title: string;
  subtitle: string;
  readyLabel: string;
  waiting?: boolean;
  onToggle: (id: number) => void;
  onRecommend: () => void;
  onReady: () => void;
  onBack: () => void;
  header: ReactNode;
}

export function SelectionScreenPage({
  pool,
  selected,
  indicator,
  wind,
  title,
  subtitle,
  readyLabel,
  waiting,
  onToggle,
  onRecommend,
  onReady,
  onBack,
  header,
}: SelectionScreenProps) {
  const selectedTypes = selected.map(tileType).sort((a, b) => a - b);
  const waits = selected.length === 13 ? describeWaits(selectedTypes, indicator, wind) : [];
  const qualifying = waits.filter((wait) => wait.score?.tier);
  const canReady = selected.length === 13 && waits.length > 0 && !waiting;
  return (
    <main className="game-shell selection-shell" data-screen="selection">
      {header}
      <section className="selection-header">
        <div>
          <p className="eyebrow">
            <span /> 组建手牌
          </p>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="selection-status">
          <span>{selected.length}</span>
          <small>/ 13 张</small>
        </div>
      </section>
      <section className="selection-workbench">
        <div className="pool-panel">
          <div className="panel-title">
            <div>
              <b>你的 34 张牌池</b>
              <small>点击牌面加入或移出手牌</small>
            </div>
            <button type="button" onClick={onRecommend}>
              智能推荐听牌
            </button>
          </div>
          <div className="pool-grid">
            {sortTiles(pool).map((id) => (
              <MahjongTile
                key={id}
                physicalId={id}
                tile={tileType(id)}
                selected={selected.includes(id)}
                disabled={!selected.includes(id) && selected.length >= 13}
                onClick={() => onToggle(id)}
              />
            ))}
          </div>
        </div>
        <aside className="insight-panel">
          <div className="dora-card">
            <div>
              <small>宝牌指示牌</small>
              <b>本局宝牌 · {tileText(doraFromIndicator(indicator))}</b>
            </div>
            <MahjongTile tile={indicator} />
          </div>
          <div className="wait-card">
            <small>听牌分析</small>
            {selected.length !== 13 ? (
              <p>再选择 {13 - selected.length} 张牌</p>
            ) : waits.length ? (
              <>
                <div className="wait-list">
                  {waits.map(({ tile, score }) => (
                    <div key={tile}>
                      <MahjongTile tile={tile} small />
                      <span>
                        <b>{score?.tier ?? `${score?.han ?? 0}番·未满贯`}</b>
                        <small>
                          {score?.han ?? 0} 番 {score?.fu ?? 0} 符
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
                {!qualifying.length && (
                  <p className="warning-text">
                    当前牌型虽已听牌，但所有等待牌均未达到满贯，实战中不能荣和。
                  </p>
                )}
              </>
            ) : (
              <p className="warning-text">这 13 张还没有听牌，请调整组合或使用推荐。</p>
            )}
          </div>
          <GameActionBar>
            <div className="selection-actions">
              <button className="secondary-action" type="button" onClick={onBack}>
                返回
              </button>
              <button
                className="primary-action"
                type="button"
                disabled={!canReady}
                onClick={onReady}
              >
                {waiting ? '等待对手…' : readyLabel} <span>→</span>
              </button>
            </div>
          </GameActionBar>
        </aside>
      </section>
    </main>
  );
}
