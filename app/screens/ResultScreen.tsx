import { MahjongTile } from '../../components/MahjongTile';
import type { GameResult } from '../../lib/contracts/mahjong';
import { doraFromIndicator, tileText } from '../../lib/rules/tiles';

export function ResultScreen({
  result,
  indicator,
  opponentName,
  onHome,
  onAgain,
}: {
  result: GameResult;
  indicator: number;
  opponentName: string;
  onHome: () => void;
  onAgain: () => void;
}) {
  return (
    <div className="modal-backdrop result-backdrop" data-screen="result">
      <section className="result-card">
        <p className="eyebrow">
          <span /> 对局结束
        </p>
        {result.kind === 'draw' ? (
          <>
            <div className="result-seal neutral">流</div>
            <h2>{result.reason === 'both-disconnected' ? '双方掉线，牌局流局' : '十七巡流局'}</h2>
            <p>
              {result.reason === 'both-disconnected'
                ? '双方都未能在重连宽限时间内恢复连接。'
                : '双方各自打出 17 张牌，仍无人达到满贯荣和。'}
            </p>
          </>
        ) : result.kind === 'forfeit' ? (
          <>
            <div className={`result-seal ${result.winner === 0 ? 'win' : 'lose'}`}>
              {result.winner === 0 ? '胜' : '负'}
            </div>
            <h2>{result.winner === 0 ? '对手认输，你获胜' : '本局判负'}</h2>
            <p>
              {result.reason === 'resigned'
                ? result.loser === 0
                  ? '你已主动认输。'
                  : `${opponentName}已主动认输。`
                : result.reason === 'turn-timeout'
                  ? result.loser === 0
                    ? '你的操作超时。'
                    : `${opponentName}操作超时。`
                  : result.loser === 0
                    ? '重连宽限时间已结束。'
                    : `${opponentName}掉线且未及时重连。`}
            </p>
          </>
        ) : (
          <>
            <div className={`result-seal ${result.winner === 0 ? 'win' : 'lose'}`}>
              {result.winner === 0 ? '和' : '铳'}
            </div>
            <h2>{result.winner === 0 ? '荣和！' : `${opponentName}荣和`}</h2>
            <p className="limit-title">
              {result.score?.tier} · {result.score?.han} 番 {result.score?.fu} 符
            </p>
            {result.winnerHand && (
              <div className="revealed-hand">
                <small>{result.winner === 0 ? '你的和牌' : '对手的和牌'}</small>
                <div>
                  {result.winnerHand.map((tile, index) => (
                    <MahjongTile tile={tile} small key={`${tile}-${index}`} />
                  ))}
                  <span className="draw-gap" />
                  <MahjongTile tile={result.score?.winningTile ?? 0} small />
                </div>
              </div>
            )}
            <div className="revealed-indicators">
              <div>
                <small>表宝牌指示</small>
                <MahjongTile tile={indicator} small />
                <span>宝牌 {tileText(doraFromIndicator(indicator))}</span>
              </div>
              {result.uraIndicator !== undefined && (
                <div className="ura-reveal">
                  <small>里宝牌指示</small>
                  <MahjongTile tile={result.uraIndicator} small />
                  <span>里宝牌 {tileText(doraFromIndicator(result.uraIndicator))}</span>
                </div>
              )}
            </div>
            <div className="yaku-list">
              {result.score?.yaku.map((yaku) => (
                <span key={yaku}>{yaku}</span>
              ))}
            </div>
            <div className="payment-line">
              <small>底分结算</small>
              <b>
                {result.winner === 0 ? '+' : '−'}
                {result.payment?.toLocaleString()}
              </b>
              <span>
                {result.score?.tier} × {result.score?.multiplier}
              </span>
            </div>
          </>
        )}
        <div className="result-actions">
          <button className="secondary-action" type="button" onClick={onHome}>
            返回首页
          </button>
          <button className="primary-action" type="button" onClick={onAgain}>
            再来一局 <span>→</span>
          </button>
        </div>
      </section>
    </div>
  );
}
