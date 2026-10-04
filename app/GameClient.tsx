/**
 * 二人麻将的客户端主界面。
 *
 * 本文件负责把麻将规则库连接到 React 交互层，包含首页、选牌、
 * 本地电脑对战、联机房间、登录弹窗、音效和结果展示。真正的牌型
 * 判断与计分位于 lib/mahjong.ts；这里主要维护界面状态和用户操作。
 */
"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  createWall,
  describeWaits,
  doraFromIndicator,
  evaluateWin,
  isFuriten,
  sortTiles,
  suggestTenpaiHand,
  tileLabel,
  tileGlyph,
  tileText,
  tileType,
  type ScoreResult,
} from "../lib/mahjong";

type Screen = "home" | "select" | "playing" | "online";
type Seat = 0 | 1;

interface Deal {
  pools: [number[], number[]];
  suggestions: [number[], number[]];
  indicator: number;
  uraIndicator: number;
}

interface GameResult {
  kind: "ron" | "draw";
  winner?: Seat;
  score?: ScoreResult;
  payment?: number;
  winnerHand?: number[];
  uraIndicator?: number;
}

interface LocalGame {
  hands: [number[], number[]];
  reserves: [number[], number[]];
  discards: [number[], number[]];
  counts: [number, number];
  temporaryFuriten: [boolean, boolean];
  indicator: number;
  uraIndicator: number;
  turn: Seat;
  pendingRon: Seat | null;
  pendingScore: ScoreResult | null;
  lastDiscard: { seat: Seat; tile: number } | null;
  result: GameResult | null;
}

interface RemoteSnapshot {
  code: string;
  phase: "waiting" | "selecting" | "playing" | "finished";
  seat: Seat;
  opponentJoined: boolean;
  opponentReady: boolean;
  ownReady: boolean;
  ownPool?: number[];
  ownHand?: number[];
  indicator: number;
  baseScore: number;
  turn: Seat;
  discards: [number[], number[]];
  counts: [number, number];
  reserveCounts: [number, number];
  ownRemaining?: number[];
  pendingRon: Seat | null;
  canRon: boolean;
  pendingScore?: ScoreResult | null;
  temporaryFuriten: boolean;
  permanentFuriten: boolean;
  lastDiscard: { seat: Seat; tile: number } | null;
  result: GameResult | null;
  version: number;
}

interface AuthUser { id: string; email: string }

const AppContext = createContext<{
  user: AuthUser | null;
  openAuth: () => void;
  logout: () => void;
  soundEnabled: boolean;
  toggleSound: () => void;
}>({ user: null, openAuth: () => undefined, logout: () => undefined, soundEnabled: true, toggleSound: () => undefined });

class GameAudio {
  private context: AudioContext | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;

  async ensure() {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") await this.context.resume();
    return this.context;
  }

  private async tone(frequency: number, duration: number, volume: number, delay = 0, type: OscillatorType = "sine") {
    const context = await this.ensure();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(55, frequency * .78), start + duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + .02);
  }

  discard() {
    void this.tone(240, .075, .09, 0, "triangle");
    void this.tone(105, .1, .055, .025, "sine");
  }

  ron() {
    [392, 523.25, 659.25, 783.99].forEach((frequency, index) => void this.tone(frequency, .42, .075, index * .105, "triangle"));
  }

  async startMusic() {
    if (this.musicTimer !== null) return;
    await this.ensure();
    const notes = [130.81, 164.81, 196, 246.94, 196, 164.81];
    const play = () => {
      void this.tone(notes[this.musicStep % notes.length], .7, .018, 0, "sine");
      if (this.musicStep % 3 === 0) void this.tone(65.41, .9, .012, 0, "triangle");
      this.musicStep += 1;
    };
    play();
    this.musicTimer = window.setInterval(play, 720);
  }

  stopMusic() {
    if (this.musicTimer !== null) window.clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

function Tile({ tile, physicalId, selected, hidden, small, onClick, disabled, title }: {
  tile: number;
  physicalId?: number;
  selected?: boolean;
  hidden?: boolean;
  small?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const label = tileLabel(tile);
  const glyph = tileGlyph(tile);
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      className={`game-tile ${label.kind} ${small ? "is-small" : ""} ${selected ? "is-selected" : ""} ${hidden ? "is-hidden" : ""}`}
      onClick={onClick}
      disabled={disabled}
      type={onClick ? "button" : undefined}
      title={title ?? (hidden ? "暗牌" : tileText(tile))}
      aria-label={hidden ? "暗牌" : tileText(tile)}
      data-id={physicalId}
    >
      {hidden ? <span className="tile-back-mark">雀</span> : <span className="mahjong-symbol" aria-hidden="true">{glyph}</span>}
    </Tag>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="rules-modal" role="dialog" aria-modal="true" aria-labelledby="rules-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭规则">×</button>
        <p className="eyebrow"><span /> 对局规则</p>
        <h2 id="rules-title">17 巡定胜负</h2>
        <div className="rules-grid">
          <article><strong>01</strong><div><b>34 张选牌</b><p>每位牌手从独立的 34 张牌池中选出 13 张听牌。余下 21 张完整保留，每巡任选一张舍出。</p></div></article>
          <article><strong>02</strong><div><b>两立直</b><p>双方第一次舍牌即宣告两立直，固定 2 番。之后按东家、闲家顺序轮流打出序列顶牌。</p></div></article>
          <article><strong>03</strong><div><b>只可荣和</b><p>不能自摸，只能用对手刚打出的牌完成手牌；低于满贯的牌型不能和牌。</p></div></article>
          <article><strong>04</strong><div><b>宝牌与振听</b><p>每局翻开表宝牌指示，荣和后再翻里宝牌。自己的舍牌包含等待牌，或放弃一次可荣和牌，都会进入振听。</p></div></article>
          <article><strong>05</strong><div><b>17 巡流局</b><p>双方各打出 17 张仍无人荣和则流局。庄家固定东风，闲家固定西风。</p></div></article>
          <article><strong>06</strong><div><b>底分倍数</b><p>满贯 ×1、跳满 ×1.5、倍满 ×2、三倍满 ×3、役满 ×4，由输方向赢家支付。</p></div></article>
        </div>
        <button className="primary-action wide" type="button" onClick={onClose}>明白了</button>
      </section>
    </div>
  );
}

function AuthModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: mode, email, password }) });
      const data = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || "账号操作失败");
      onSuccess(data.user);
    } catch (submissionError) { setError(submissionError instanceof Error ? submissionError.message : "账号操作失败"); }
    finally { setBusy(false); }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭登录">×</button>
        <p className="eyebrow"><span /> 牌手账号</p>
        <h2 id="auth-title">{mode === "login" ? "登录后联机对战" : "注册新的牌手账号"}</h2>
        <p>电脑对战无需登录。账号仅用于保护你的联机房间与对局身份。</p>
        <form onSubmit={submit}>
          <label>邮箱<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label>
          <label>密码<input type="password" required minLength={8} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 个字符" /></label>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-action wide" type="submit" disabled={busy}>{busy ? "请稍候…" : mode === "login" ? "登录并继续" : "注册并继续"} <span>→</span></button>
        </form>
        <button className="auth-switch" type="button" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "还没有账号？立即注册" : "已经有账号？返回登录"}</button>
      </section>
    </div>
  );
}

function TopBar({ onHome, onRules, roomCode }: { onHome?: () => void; onRules: () => void; roomCode?: string }) {
  const { user, openAuth, logout, soundEnabled, toggleSound } = useContext(AppContext);
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    if (!roomCode) return;
    await navigator.clipboard.writeText(roomCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <header className="site-header compact">
      <button className="brand brand-button" type="button" onClick={onHome} aria-label="返回首页">
        <span className="brand-mark">雀</span><span>二人麻将</span>
      </button>
      <div className="header-meta">
        {roomCode && <button className="room-code-button" type="button" onClick={copyCode}>{copied ? "已复制" : `房间 ${roomCode} · 复制`}</button>}
        <button className="sound-button" type="button" onClick={toggleSound}>{soundEnabled ? "♪ 音乐开启" : "音乐关闭"}</button>
        {user ? <button className="account-button" type="button" onClick={logout} title="点击退出登录">{user.email}</button> : <button className="account-button" type="button" onClick={openAuth}>邮箱登录</button>}
        <button className="rules-link" type="button" onClick={onRules}>规则说明 <span>↗</span></button>
      </div>
    </header>
  );
}

function Home({ baseScore, setBaseScore, onCpu, onOnline, onRules }: {
  baseScore: number;
  setBaseScore: (value: number) => void;
  onCpu: () => void;
  onOnline: () => void;
  onRules: () => void;
}) {
  const previewTiles = [0, 1, 2, 12, 13, 14, 24, 25, 26, 27, 27, 33, 33];
  return (
    <main className="home-shell">
      <TopBar onRules={onRules} />
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow"><span /> 34 张选牌 · 满贯起胡</p>
          <h1>从一副牌里，<br />挑出你的<span>胜负手。</span></h1>
          <p className="lede">两位牌手各得 34 张牌，自选 13 张听牌后双立直。每巡从剩余牌中自由选择舍牌，在第 17 巡前一决胜负。</p>
          <div className="score-picker" aria-label="初始底分">
            <span>本局底分</span>
            {[1000, 5000, 10000].map((score) => <button className={score === baseScore ? "active" : ""} type="button" key={score} onClick={() => setBaseScore(score)}>{score.toLocaleString()}</button>)}
          </div>
          <div className="hero-actions">
            <button className="primary-action" type="button" onClick={onCpu}>开始电脑对战 <span>→</span></button>
            <button className="secondary-action" type="button" onClick={onOnline}><span className="online-dot" /> 联机对战</button>
          </div>
          <p className="micro-copy">电脑对战无需注册 · 联机账号用于保护房间</p>
        </div>

        <div className="table-preview" aria-label="麻将牌桌预览">
          <div className="preview-topline"><span>东一局 · 0 本场</span><strong>第 08 巡</strong></div>
          <div className="rival-seat"><div className="avatar">AI</div><div><b>电脑牌手</b><small>西家 · 25,000</small></div><span className="riichi-stick">•</span></div>
          <div className="river preview-river" aria-hidden="true">{[8, 31, 20, 30, 10, 32, 6, 18].map((tile, index) => <Tile tile={tile} small key={`${tile}-${index}`} />)}</div>
          <div className="center-piece"><span>东</span><b>08</b><small>残 34</small></div>
          <div className="dora-panel"><small>宝牌指示</small><Tile tile={3} small /></div>
          <div className="hand-row" aria-label="示例手牌">{previewTiles.map((tile, index) => <Tile tile={tile} key={`${tile}-${index}`} />)}<span className="draw-gap" /><Tile tile={13} /></div>
          <div className="player-strip"><div><b>你</b><small>东家 · 25,000</small></div><span className="riichi-badge">两立直</span></div>
        </div>
      </section>
      <section className="rule-strip" aria-label="核心规则">
        <article><span>01</span><div><b>自选听牌</b><p>从 34 张私有牌池中组建 13 张手牌</p></div></article>
        <article><span>02</span><div><b>双立直开局</b><p>各自舍一张牌立直，固定计 2 番</p></div></article>
        <article><span>03</span><div><b>满贯起胡</b><p>只能荣和对手舍牌，保留振听规则</p></div></article>
      </section>
    </main>
  );
}

function SelectionScreen({ pool, selected, indicator, wind, title, subtitle, readyLabel, waiting, onToggle, onRecommend, onReady, onBack, onRules, roomCode }: {
  pool: number[];
  selected: number[];
  indicator: number;
  wind: "east" | "west";
  title: string;
  subtitle: string;
  readyLabel: string;
  waiting?: boolean;
  onToggle: (id: number) => void;
  onRecommend: () => void;
  onReady: () => void;
  onBack: () => void;
  onRules: () => void;
  roomCode?: string;
}) {
  const selectedTypes = selected.map(tileType).sort((a, b) => a - b);
  const waits = selected.length === 13 ? describeWaits(selectedTypes, indicator, wind) : [];
  const qualifying = waits.filter((wait) => wait.score?.tier);
  const canReady = selected.length === 13 && waits.length > 0 && !waiting;
  return (
    <main className="game-shell selection-shell">
      <TopBar onHome={onBack} onRules={onRules} roomCode={roomCode} />
      <section className="selection-header">
        <div><p className="eyebrow"><span /> 组建手牌</p><h2>{title}</h2><p>{subtitle}</p></div>
        <div className="selection-status"><span>{selected.length}</span><small>/ 13 张</small></div>
      </section>
      <section className="selection-workbench">
        <div className="pool-panel">
          <div className="panel-title"><div><b>你的 34 张牌池</b><small>点击牌面加入或移出手牌</small></div><button type="button" onClick={onRecommend}>智能推荐听牌</button></div>
          <div className="pool-grid">{sortTiles(pool).map((id) => <Tile key={id} physicalId={id} tile={tileType(id)} selected={selected.includes(id)} disabled={!selected.includes(id) && selected.length >= 13} onClick={() => onToggle(id)} />)}</div>
        </div>
        <aside className="insight-panel">
          <div className="dora-card"><div><small>宝牌指示牌</small><b>本局宝牌 · {tileText(doraFromIndicator(indicator))}</b></div><Tile tile={indicator} /></div>
          <div className="wait-card"><small>听牌分析</small>{selected.length !== 13 ? <p>再选择 {13 - selected.length} 张牌</p> : waits.length ? <><div className="wait-list">{waits.map(({ tile, score }) => <div key={tile}><Tile tile={tile} small /><span><b>{score?.tier ?? `${score?.han ?? 0}番·未满贯`}</b><small>{score?.han ?? 0} 番 {score?.fu ?? 0} 符</small></span></div>)}</div>{!qualifying.length && <p className="warning-text">当前牌型虽已听牌，但所有等待牌均未达到满贯，实战中不能荣和。</p>}</> : <p className="warning-text">这 13 张还没有听牌，请调整组合或使用推荐。</p>}</div>
          <div className="selection-actions"><button className="secondary-action" type="button" onClick={onBack}>返回</button><button className="primary-action" type="button" disabled={!canReady} onClick={onReady}>{waiting ? "等待对手…" : readyLabel} <span>→</span></button></div>
        </aside>
      </section>
    </main>
  );
}

function River({ tiles }: { tiles: number[] }) {
  return <div className="battle-river">{tiles.map((tile, index) => <Tile tile={tile} small key={`${tile}-${index}`} />)}</div>;
}

function GameTable({ hand, indicator, discards, counts, turn, remainingTiles, selectedDiscard, opponentName, pendingRon, pendingScore, furiten, result, baseScore, onSelectDiscard, onDiscard, onRon, onPass, onAgain, onHome, onRules, roomCode, waitingText }: {
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
  onRules: () => void;
  roomCode?: string;
  waitingText?: string;
}) {
  return (
    <main className="game-shell battle-shell">
      <TopBar onHome={onHome} onRules={onRules} roomCode={roomCode} />
      <div className="match-bar"><span>东一局</span><b>底分 {baseScore.toLocaleString()}</b><span>第 {Math.max(counts[0], counts[1], 1)} / 17 巡</span></div>
      <section className="battle-table">
        <div className="opponent-zone">
          <div className="seat-label"><div className="avatar">{opponentName === "电脑牌手" ? "AI" : "客"}</div><div><b>{opponentName}</b><small>西家 · 已舍 {counts[1]} 张</small></div><span className="riichi-badge">两立直</span></div>
          <div className="hidden-hand">{hand.map((_, index) => <Tile tile={0} hidden small key={index} />)}</div>
          <River tiles={discards[1]} />
        </div>

        <div className="table-center">
          <div className="wind-box"><span>东</span><b>{String(Math.max(counts[0], counts[1])).padStart(2, "0")}</b><small>各余 {Math.max(0, 17 - Math.max(counts[0], counts[1]))} 巡</small></div>
          <div className="battle-dora"><small>宝牌指示</small><Tile tile={indicator} small /><em>宝牌 {tileText(doraFromIndicator(indicator))}</em></div>
          <div className={`turn-notice ${turn === 0 ? "your-turn" : ""}`}>{waitingText ?? (turn === 0 ? "轮到你舍牌" : `${opponentName}正在思考…`)}</div>
        </div>

        <div className="player-zone">
          <River tiles={discards[0]} />
          <div className="active-hand">{hand.map((tile, index) => <Tile tile={tile} key={`${tile}-${index}`} />)}</div>
          <div className="reserve-tray">
            <div><b>可舍牌</b><small>从剩余 {remainingTiles.length} 张中任选一张</small></div>
            <div className="reserve-tiles">{sortTiles(remainingTiles).map((id) => <Tile key={id} physicalId={id} tile={tileType(id)} small selected={selectedDiscard === id} onClick={() => onSelectDiscard(id)} />)}</div>
          </div>
          <div className="player-action-row">
            <div className="seat-label"><div className="avatar player-avatar">你</div><div><b>你</b><small>东家 · 已舍 {counts[0]} 张</small></div>{furiten && <span className="furiten-badge">振听</span>}</div>
            <div className="draw-action">{selectedDiscard !== null ? <><span><small>{counts[0] === 0 ? "立直舍牌" : "已选择"}</small><Tile tile={tileType(selectedDiscard)} /></span><button className="discard-button" type="button" disabled={turn !== 0 || pendingRon || Boolean(result)} onClick={() => onDiscard(selectedDiscard)}>{counts[0] === 0 ? "打出并立直" : "打出此牌"} <b>→</b></button></> : <p>{turn === 0 ? "请从上方剩余牌中选择一张" : "可先选择下一张舍牌"}</p>}</div>
          </div>
        </div>
      </section>

      {pendingRon && pendingScore && <div className="ron-prompt"><div><p>荣和机会</p><h3>{pendingScore.tier} · {pendingScore.han} 番 {pendingScore.fu} 符</h3><span>{pendingScore.yaku.join(" · ")}</span></div><Tile tile={pendingScore.winningTile} /><button className="ron-button" type="button" onClick={onRon}>荣和</button><button className="pass-button" type="button" onClick={onPass}>放弃</button></div>}

      {result && <div className="modal-backdrop result-backdrop"><section className="result-card"><p className="eyebrow"><span /> 对局结束</p>{result.kind === "draw" ? <><div className="result-seal neutral">流</div><h2>十七巡流局</h2><p>双方各自打出 17 张牌，仍无人达到满贯荣和。</p></> : <><div className={`result-seal ${result.winner === 0 ? "win" : "lose"}`}>{result.winner === 0 ? "和" : "铳"}</div><h2>{result.winner === 0 ? "荣和！" : `${opponentName}荣和`}</h2><p className="limit-title">{result.score?.tier} · {result.score?.han} 番 {result.score?.fu} 符</p>{result.winnerHand && <div className="revealed-hand"><small>{result.winner === 0 ? "你的和牌" : "对手的和牌"}</small><div>{result.winnerHand.map((tile, index) => <Tile tile={tile} small key={`${tile}-${index}`} />)}<span className="draw-gap" /><Tile tile={result.score?.winningTile ?? 0} small /></div></div>}<div className="revealed-indicators"><div><small>表宝牌指示</small><Tile tile={indicator} small /><span>宝牌 {tileText(doraFromIndicator(indicator))}</span></div>{result.uraIndicator !== undefined && <div className="ura-reveal"><small>里宝牌指示</small><Tile tile={result.uraIndicator} small /><span>里宝牌 {tileText(doraFromIndicator(result.uraIndicator))}</span></div>}</div><div className="yaku-list">{result.score?.yaku.map((yaku) => <span key={yaku}>{yaku}</span>)}</div><div className="payment-line"><small>底分结算</small><b>{result.winner === 0 ? "+" : "−"}{result.payment?.toLocaleString()}</b><span>{result.score?.tier} × {result.score?.multiplier}</span></div></>}<div className="result-actions"><button className="secondary-action" type="button" onClick={onHome}>返回首页</button><button className="primary-action" type="button" onClick={onAgain}>再来一局 <span>→</span></button></div></section></div>}
    </main>
  );
}

function OnlineLobby({ baseScore, onBack, onCreate, onJoin, busy, error, onRules }: {
  baseScore: number;
  onBack: () => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  busy: boolean;
  error: string;
  onRules: () => void;
}) {
  const [code, setCode] = useState("");
  return (
    <main className="game-shell online-shell">
      <TopBar onHome={onBack} onRules={onRules} />
      <section className="online-card">
        <p className="eyebrow"><span /> 联机对战</p><h2>隔桌，也能听见牌响。</h2><p>创建一个六位房间码发给朋友，或输入对方的房间码加入。双方各自选牌，手牌全程保密。</p>
        <div className="online-options">
          <article><span className="option-number">01</span><h3>创建新房间</h3><p>本局底分 {baseScore.toLocaleString()}，你固定为东家。</p><button className="primary-action wide" type="button" disabled={busy} onClick={onCreate}>{busy ? "正在开桌…" : "创建并等待朋友"} <span>→</span></button></article>
          <div className="or-divider">或</div>
          <article><span className="option-number">02</span><h3>加入朋友房间</h3><input value={code} onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="输入 6 位房间码" aria-label="房间码" /><button className="secondary-action wide" type="button" disabled={busy || code.length !== 6} onClick={() => onJoin(code)}>加入房间</button></article>
        </div>
        {error && <p className="online-error">{error}</p>}
      </section>
    </main>
  );
}

export default function GameClient() {
  const [screen, setScreen] = useState<Screen>("home");
  const [baseScore, setBaseScore] = useState(5000);
  const [showRules, setShowRules] = useState(false);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [game, setGame] = useState<LocalGame | null>(null);
  const [remote, setRemote] = useState<RemoteSnapshot | null>(null);
  const [credentials, setCredentials] = useState<{ code: string; token: string } | null>(null);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState("");
  const [remoteSelected, setRemoteSelected] = useState<number[]>([]);
  const [localDiscard, setLocalDiscard] = useState<number | null>(null);
  const [remoteDiscard, setRemoteDiscard] = useState<number | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [afterAuthOnline, setAfterAuthOnline] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioRef = useRef<GameAudio | null>(null);
  const localSoundCount = useRef(0);
  const remoteSoundCount = useRef(0);
  const resultSoundKey = useRef("");

  const ensureAudio = useCallback(() => {
    audioRef.current ??= new GameAudio();
    if (soundEnabled) void audioRef.current.ensure();
  }, [soundEnabled]);

  useEffect(() => {
    fetch("/api/auth", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json() as { user?: AuthUser | null };
      setAuthUser(data.user ?? null);
    }).catch(() => undefined);
  }, []);

  const makeDeal = useCallback(() => {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const wall = createWall();
      const pools: [number[], number[]] = [wall.slice(0, 34), wall.slice(34, 68)];
      const indicator = tileType(wall[68]);
      const east = suggestTenpaiHand(pools[0], indicator, "east");
      const west = suggestTenpaiHand(pools[1], indicator, "west");
      if (east && west) return { pools, suggestions: [east, west] as [number[], number[]], indicator, uraIndicator: tileType(wall[69]) };
    }
    throw new Error("未能生成可听牌的牌池，请重试");
  }, []);

  const startCpu = useCallback(() => {
    const nextDeal = makeDeal();
    setDeal(nextDeal);
    setSelected([]);
    setGame(null);
    setLocalDiscard(null);
    setScreen("select");
  }, [makeDeal]);

  const toggleSelected = (id: number, setter = setSelected) => setter((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 13 ? [...current, id] : current);

  const confirmLocalHand = () => {
    if (!deal || selected.length !== 13) return;
    const selectedSet = new Set(selected);
    const aiSet = new Set(deal.suggestions[1]);
    setGame({
      hands: [selected.map(tileType).sort((a, b) => a - b), deal.suggestions[1].map(tileType).sort((a, b) => a - b)],
      reserves: [sortTiles(deal.pools[0].filter((id) => !selectedSet.has(id))), sortTiles(deal.pools[1].filter((id) => !aiSet.has(id)))],
      discards: [[], []], counts: [0, 0], temporaryFuriten: [false, false], indicator: deal.indicator, uraIndicator: deal.uraIndicator,
      turn: 0, pendingRon: null, pendingScore: null, lastDiscard: null, result: null,
    });
    setLocalDiscard(null);
    ensureAudio();
    setScreen("playing");
  };

  const performLocalDiscard = useCallback((seat: Seat, requestedId?: number) => {
    setGame((current) => {
      if (!current || current.result || current.pendingRon !== null || current.turn !== seat || current.counts[seat] >= 17) return current;
      const physicalId = seat === 0 ? requestedId : current.reserves[seat][Math.floor(Math.random() * current.reserves[seat].length)];
      const tileIndex = current.reserves[seat].indexOf(physicalId ?? -1);
      if (tileIndex < 0) return current;
      const reserves: [number[], number[]] = [[...current.reserves[0]], [...current.reserves[1]]];
      const [discardedId] = reserves[seat].splice(tileIndex, 1);
      const tile = tileType(discardedId);
      const opponent = (1 - seat) as Seat;
      const counts: [number, number] = [...current.counts];
      const discards: [number[], number[]] = [[...current.discards[0]], [...current.discards[1]]];
      const temporaryFuriten: [boolean, boolean] = [...current.temporaryFuriten];
      counts[seat] += 1;
      discards[seat].push(tile);
      temporaryFuriten[seat] = false;
      const score = evaluateWin(current.hands[opponent], tile, current.indicator, opponent === 0 ? "east" : "west", current.uraIndicator);
      const blocked = isFuriten(current.hands[opponent], discards[opponent], temporaryFuriten[opponent]);
      if (score?.tier && !blocked) return { ...current, reserves, counts, discards, temporaryFuriten, lastDiscard: { seat, tile }, pendingRon: opponent, pendingScore: score };
      if (counts[0] >= 17 && counts[1] >= 17) return { ...current, reserves, counts, discards, temporaryFuriten, lastDiscard: { seat, tile }, result: { kind: "draw" } };
      return { ...current, reserves, counts, discards, temporaryFuriten, lastDiscard: { seat, tile }, turn: opponent };
    });
    if (seat === 0) setLocalDiscard(null);
  }, []);

  useEffect(() => {
    if (screen !== "playing" || !game || game.result) return;
    if (game.pendingRon === 1 && game.pendingScore) {
      const timer = window.setTimeout(() => setGame((current) => current?.pendingRon === 1 && current.pendingScore ? { ...current, result: { kind: "ron", winner: 1, score: current.pendingScore, payment: Math.round(baseScore * current.pendingScore.multiplier), winnerHand: current.hands[1], uraIndicator: current.uraIndicator } } : current), 850);
      return () => window.clearTimeout(timer);
    }
    if (game.turn === 1 && game.pendingRon === null) {
      const timer = window.setTimeout(() => performLocalDiscard(1), 850);
      return () => window.clearTimeout(timer);
    }
  }, [screen, game, baseScore, performLocalDiscard]);

  const localPass = () => setGame((current) => {
    if (!current || current.pendingRon !== 0) return current;
    const temporaryFuriten: [boolean, boolean] = [true, current.temporaryFuriten[1]];
    if (current.counts[0] >= 17 && current.counts[1] >= 17) return { ...current, temporaryFuriten, pendingRon: null, pendingScore: null, result: { kind: "draw" } };
    return { ...current, temporaryFuriten, pendingRon: null, pendingScore: null, turn: 0 };
  });
  const localRon = () => setGame((current) => current?.pendingRon === 0 && current.pendingScore ? { ...current, result: { kind: "ron", winner: 0, score: current.pendingScore, payment: Math.round(baseScore * current.pendingScore.multiplier), winnerHand: current.hands[0], uraIndicator: current.uraIndicator } } : current);

  const fetchRemote = useCallback(async (creds = credentials) => {
    if (!creds) return;
    const response = await fetch(`/api/rooms?code=${creds.code}&token=${creds.token}`, { cache: "no-store" });
    const data = await response.json() as RemoteSnapshot & { error?: string };
    if (!response.ok) throw new Error(data.error || "房间同步失败");
    setRemote(data);
    if (data.ownPool && !remoteSelected.length && data.ownReady) setRemoteSelected([]);
  }, [credentials, remoteSelected.length]);

  const createRoom = async () => {
    setOnlineBusy(true); setOnlineError("");
    try {
      const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", baseScore }) });
      const data = await response.json() as { code?: string; token?: string; error?: string };
      if (!response.ok || !data.code || !data.token) throw new Error(data.error || "创建房间失败");
      const creds = { code: data.code, token: data.token };
      setCredentials(creds); setRemoteSelected([]); await fetchRemote(creds);
    } catch (error) { setOnlineError(error instanceof Error ? error.message : "创建房间失败"); }
    finally { setOnlineBusy(false); }
  };

  const joinRoom = async (code: string) => {
    setOnlineBusy(true); setOnlineError("");
    try {
      const response = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "join", code }) });
      const data = await response.json() as { code?: string; token?: string; error?: string };
      if (!response.ok || !data.code || !data.token) throw new Error(data.error || "加入房间失败");
      const creds = { code: data.code, token: data.token };
      setCredentials(creds); setRemoteSelected([]); await fetchRemote(creds);
    } catch (error) { setOnlineError(error instanceof Error ? error.message : "加入房间失败"); }
    finally { setOnlineBusy(false); }
  };

  const remoteAction = async (action: string, payload: Record<string, unknown> = {}) => {
    if (!credentials) return;
    setOnlineError("");
    const response = await fetch("/api/rooms", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...credentials, action, ...payload }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) {
      if (response.status === 401) { setAuthUser(null); setShowAuth(true); }
      setOnlineError(data.error || "操作失败，请重试"); return;
    }
    if (action === "discard") setRemoteDiscard(null);
    await fetchRemote();
  };

  useEffect(() => {
    if (screen !== "online" || !credentials) return;
    const timer = window.setInterval(() => fetchRemote().catch((error) => setOnlineError(error instanceof Error ? error.message : "同步失败")), 1200);
    return () => window.clearInterval(timer);
  }, [screen, credentials, fetchRemote]);

  const goHome = () => { setScreen("home"); setGame(null); setDeal(null); setRemote(null); setCredentials(null); setOnlineError(""); setLocalDiscard(null); setRemoteDiscard(null); };
  const remoteReady = async () => { if (remoteSelected.length === 13) { ensureAudio(); await remoteAction("select", { selected: remoteSelected }); } };
  const remoteSuggest = () => {
    if (!remote?.ownPool) return;
    const suggestion = suggestTenpaiHand(remote.ownPool, remote.indicator, remote.seat === 0 ? "east" : "west");
    if (suggestion) setRemoteSelected(suggestion);
  };

  const openOnline = () => {
    if (!authUser) { setAfterAuthOnline(true); setShowAuth(true); return; }
    setScreen("online"); setRemote(null); setCredentials(null);
  };

  const logout = async () => {
    await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    setAuthUser(null);
    if (screen === "online") goHome();
  };

  useEffect(() => {
    const playing = screen === "playing" || (screen === "online" && remote?.phase === "playing");
    if (playing && soundEnabled) void audioRef.current?.startMusic();
    else audioRef.current?.stopMusic();
    return () => { if (!playing) audioRef.current?.stopMusic(); };
  }, [screen, remote?.phase, soundEnabled]);

  useEffect(() => {
    const count = game ? game.counts[0] + game.counts[1] : 0;
    if (count > localSoundCount.current && soundEnabled) audioRef.current?.discard();
    localSoundCount.current = count;
  }, [game, soundEnabled]);

  useEffect(() => {
    const count = remote ? remote.counts[0] + remote.counts[1] : 0;
    if (count > remoteSoundCount.current && soundEnabled) audioRef.current?.discard();
    remoteSoundCount.current = count;
  }, [remote, soundEnabled]);

  useEffect(() => {
    const result = game?.result ?? remote?.result;
    const key = result?.kind === "ron" ? `${screen}-${result.winner}-${result.score?.han}-${result.payment}` : "";
    if (key && key !== resultSoundKey.current && soundEnabled) audioRef.current?.ron();
    resultSoundKey.current = key;
  }, [game?.result, remote?.result, screen, soundEnabled]);

  const toggleSound = () => {
    if (soundEnabled) { audioRef.current?.stopMusic(); setSoundEnabled(false); }
    else {
      audioRef.current ??= new GameAudio();
      void audioRef.current.ensure();
      setSoundEnabled(true);
    }
  };

  const content = (() => {
    if (screen === "home") return <Home baseScore={baseScore} setBaseScore={setBaseScore} onCpu={startCpu} onOnline={openOnline} onRules={() => setShowRules(true)} />;
    if (screen === "select" && deal) return <SelectionScreen pool={deal.pools[0]} selected={selected} indicator={deal.indicator} wind="east" title="选出 13 张，做成你的听牌。" subtitle="其余 21 张全部保留；对局中每一巡都可从中任选一张舍出。只有达到满贯的等待牌可以荣和。" readyLabel="确认手牌，开始对局" onToggle={(id) => toggleSelected(id)} onRecommend={() => setSelected(deal.suggestions[0])} onReady={confirmLocalHand} onBack={goHome} onRules={() => setShowRules(true)} />;
    if (screen === "playing" && game) {
      const furiten = isFuriten(game.hands[0], game.discards[0], game.temporaryFuriten[0]);
      return <GameTable hand={game.hands[0]} indicator={game.indicator} discards={game.discards} counts={game.counts} turn={game.turn} remainingTiles={game.reserves[0]} selectedDiscard={localDiscard} opponentName="电脑牌手" pendingRon={game.pendingRon === 0} pendingScore={game.pendingScore} furiten={furiten} result={game.result} baseScore={baseScore} onSelectDiscard={setLocalDiscard} onDiscard={(id) => performLocalDiscard(0, id)} onRon={localRon} onPass={localPass} onAgain={startCpu} onHome={goHome} onRules={() => setShowRules(true)} />;
    }
    if (screen === "online" && !remote) return <OnlineLobby baseScore={baseScore} onBack={goHome} onCreate={createRoom} onJoin={joinRoom} busy={onlineBusy} error={onlineError} onRules={() => setShowRules(true)} />;
    if (screen === "online" && remote && (remote.phase === "waiting" || remote.phase === "selecting")) {
      return <SelectionScreen pool={remote.ownPool ?? []} selected={remoteSelected} indicator={remote.indicator} wind={remote.seat === 0 ? "east" : "west"} title={remote.opponentJoined ? "对手已入座，组建你的听牌。" : "牌桌已开，等待朋友入座。"} subtitle={remote.opponentJoined ? (remote.opponentReady ? "对手已经选好牌，正在等你。" : "双方独立选牌，确认后等待对手准备。") : "把房间码复制给朋友；等待期间你可以先选好 13 张。"} readyLabel="确认手牌" waiting={remote.ownReady} onToggle={(id) => toggleSelected(id, setRemoteSelected)} onRecommend={remoteSuggest} onReady={remoteReady} onBack={goHome} onRules={() => setShowRules(true)} roomCode={remote.code} />;
    }
    if (screen === "online" && remote && remote.ownHand) {
      return <GameTable hand={remote.ownHand} indicator={remote.indicator} discards={remote.seat === 0 ? remote.discards : [remote.discards[1], remote.discards[0]]} counts={remote.seat === 0 ? remote.counts : [remote.counts[1], remote.counts[0]]} turn={(remote.seat === 0 ? remote.turn : 1 - remote.turn) as Seat} remainingTiles={remote.ownRemaining ?? []} selectedDiscard={remoteDiscard} opponentName="联机牌友" pendingRon={remote.canRon} pendingScore={remote.pendingScore} furiten={remote.permanentFuriten || remote.temporaryFuriten} result={remote.result ? (remote.seat === 0 ? remote.result : { ...remote.result, winner: remote.result.winner === undefined ? undefined : (1 - remote.result.winner) as Seat }) : null} baseScore={remote.baseScore} onSelectDiscard={setRemoteDiscard} onDiscard={(id) => remoteAction("discard", { tileId: id })} onRon={() => remoteAction("ron")} onPass={() => remoteAction("pass")} onAgain={goHome} onHome={goHome} onRules={() => setShowRules(true)} roomCode={remote.code} waitingText={onlineError || undefined} />;
    }
    return null;
  })();

  return <AppContext.Provider value={{ user: authUser, openAuth: () => { setAfterAuthOnline(false); setShowAuth(true); }, logout, soundEnabled, toggleSound }}>{content}{showRules && <RulesModal onClose={() => setShowRules(false)} />}{showAuth && <AuthModal onClose={() => { setShowAuth(false); setAfterAuthOnline(false); }} onSuccess={(user) => { setAuthUser(user); setShowAuth(false); if (afterAuthOnline) { setScreen("online"); setRemote(null); setCredentials(null); } setAfterAuthOnline(false); }} />}</AppContext.Provider>;
}
