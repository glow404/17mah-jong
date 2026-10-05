import type { ReactNode } from 'react';
import { MahjongTile } from '../../components/MahjongTile';
import type { AiDifficulty } from '../game/ai';
import { summarizeDifficulty, type AiStats } from '../game/aiStats';

export function HomeScreen({
  baseScore,
  setBaseScore,
  aiDifficulty,
  setAiDifficulty,
  aiStats,
  onCpu,
  onOnline,
  header,
}: {
  baseScore: number;
  setBaseScore: (score: number) => void;
  aiDifficulty: AiDifficulty;
  setAiDifficulty: (difficulty: AiDifficulty) => void;
  aiStats: AiStats;
  onCpu: () => void;
  onOnline: () => void;
  header: ReactNode;
}) {
  const previewTiles = [0, 1, 2, 12, 13, 14, 24, 25, 26, 27, 27, 33, 33];
  return (
    <main className="home-shell" data-screen="home">
      {header}
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">
            <span /> 34 张选牌 · 满贯起胡
          </p>
          <h1>
            从一副牌里，
            <br />
            挑出你的<span>胜负手。</span>
          </h1>
          <p className="lede">
            两位牌手各得 34 张牌，自选 13 张听牌后双立直。每巡从剩余牌中自由选择舍牌，在第 17
            巡前一决胜负。
          </p>
          <div className="score-picker" role="group" aria-label="初始底分">
            <span>本局底分</span>
            {[1000, 5000, 10000].map((score) => (
              <button
                className={score === baseScore ? 'active' : ''}
                type="button"
                key={score}
                aria-pressed={score === baseScore}
                onClick={() => setBaseScore(score)}
              >
                {score.toLocaleString()}
              </button>
            ))}
          </div>
          <div className="score-picker ai-difficulty-picker" role="group" aria-label="电脑难度">
            <span>电脑难度</span>
            {(
              [
                ['easy', '简单'],
                ['normal', '普通'],
                ['hard', '困难'],
              ] as const
            ).map(([difficulty, label]) => (
              <button
                className={difficulty === aiDifficulty ? 'active' : ''}
                type="button"
                key={difficulty}
                aria-pressed={difficulty === aiDifficulty}
                onClick={() => setAiDifficulty(difficulty)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="hero-actions">
            <button className="primary-action" type="button" onClick={onCpu}>
              开始电脑对战 <span>→</span>
            </button>
            <button className="secondary-action" type="button" onClick={onOnline}>
              <span className="online-dot" /> 联机对战
            </button>
          </div>
          <p className="micro-copy">电脑对战无需注册 · 联机账号用于保护房间</p>
          <section className="ai-metrics" aria-label="电脑对战统计">
            <div className="ai-metrics-heading">
              <b>本机电脑对战统计</b>
              <small>仅保存在此浏览器</small>
            </div>
            <div className="ai-metrics-grid">
              {(
                [
                  ['easy', '简单'],
                  ['normal', '普通'],
                  ['hard', '困难'],
                ] as const
              ).map(([difficulty, label]) => {
                const summary = summarizeDifficulty(aiStats[difficulty]);
                return (
                  <div key={difficulty}>
                    <b>{label}</b>
                    <span>
                      {aiStats[difficulty].matches} 局 · 胜率 {(summary.winRate * 100).toFixed(0)}%
                    </span>
                    <small>
                      平均 {Math.round(summary.averageDurationMs / 1000)} 秒 · 思考{' '}
                      {summary.averageDecisionMs.toFixed(1)} 毫秒
                    </small>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
        <div className="table-preview" role="img" aria-label="麻将牌桌预览">
          <div className="preview-topline">
            <span>东一局 · 0 本场</span>
            <strong>第 08 巡</strong>
          </div>
          <div className="rival-seat">
            <div className="avatar">AI</div>
            <div>
              <b>电脑牌手</b>
              <small>西家 · 25,000</small>
            </div>
            <span className="riichi-stick">•</span>
          </div>
          <div className="river preview-river" aria-hidden="true">
            {[8, 31, 20, 30, 10, 32, 6, 18].map((tile, index) => (
              <MahjongTile tile={tile} small key={`${tile}-${index}`} />
            ))}
          </div>
          <div className="center-piece">
            <span>东</span>
            <b>08</b>
            <small>残 34</small>
          </div>
          <div className="dora-panel">
            <small>宝牌指示</small>
            <MahjongTile tile={3} small />
          </div>
          <div className="hand-row" role="group" aria-label="示例手牌">
            {previewTiles.map((tile, index) => (
              <MahjongTile tile={tile} key={`${tile}-${index}`} />
            ))}
            <span className="draw-gap" />
            <MahjongTile tile={13} />
          </div>
          <div className="player-strip">
            <div>
              <b>你</b>
              <small>东家 · 25,000</small>
            </div>
            <span className="riichi-badge">两立直</span>
          </div>
        </div>
      </section>
      <section className="rule-strip" aria-label="核心规则">
        <article>
          <span>01</span>
          <div>
            <b>自选听牌</b>
            <p>从 34 张私有牌池中组建 13 张手牌</p>
          </div>
        </article>
        <article>
          <span>02</span>
          <div>
            <b>双立直开局</b>
            <p>各自舍一张牌立直，固定计 2 番</p>
          </div>
        </article>
        <article>
          <span>03</span>
          <div>
            <b>满贯起胡</b>
            <p>只能荣和对手舍牌，保留振听规则</p>
          </div>
        </article>
      </section>
    </main>
  );
}
