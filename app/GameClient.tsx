/**
 * 二人麻将的客户端主界面。
 *
 * 页面容器负责全局状态、操作回调和本地/联机模式切换。
 * 首页、选牌、牌桌、结算、认证和联机 UI 分别位于 screens/ 模块；
 * 规则能力由 lib/rules 下的纯函数模块提供。
 */
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { GameAudio } from '../lib/audio';
import type { RoomSnapshot, Seat } from '../lib/contracts/mahjong';
import { isFuriten } from '../lib/rules/furiten';
import { createWall, sortTiles, tileType } from '../lib/rules/tiles';
import { suggestTenpaiHand } from '../lib/rules/selection';
import { localGameReducer } from './game/localGameReducer';
import { useRemotePolling } from '../hooks/useRemotePolling';
import { AuthScreen } from './screens/AuthScreen';
import type { AuthUser } from './screens/AuthScreen';
import { HomeScreen } from './screens/HomeScreen';
import { OnlineScreen } from './screens/OnlineScreen';
import { SelectionScreenPage } from './screens/SelectionScreen';
import { TableScreen } from './screens/TableScreen';

type Screen = 'home' | 'select' | 'playing' | 'online';
interface Deal {
  pools: [number[], number[]];
  suggestions: [number[], number[]];
  indicator: number;
  uraIndicator: number;
}

const AppContext = createContext<{
  user: AuthUser | null;
  openAuth: () => void;
  logout: () => void;
  soundEnabled: boolean;
  toggleSound: () => void;
}>({
  user: null,
  openAuth: () => undefined,
  logout: () => undefined,
  soundEnabled: true,
  toggleSound: () => undefined,
});

function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="rules-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭规则">
          ×
        </button>
        <p className="eyebrow">
          <span /> 对局规则
        </p>
        <h2 id="rules-title">17 巡定胜负</h2>
        <div className="rules-grid">
          <article>
            <strong>01</strong>
            <div>
              <b>34 张选牌</b>
              <p>
                每位牌手从独立的 34 张牌池中选出 13 张听牌。余下 21 张完整保留，每巡任选一张舍出。
              </p>
            </div>
          </article>
          <article>
            <strong>02</strong>
            <div>
              <b>两立直</b>
              <p>双方第一次舍牌即宣告两立直，固定 2 番。之后按东家、闲家顺序轮流打出序列顶牌。</p>
            </div>
          </article>
          <article>
            <strong>03</strong>
            <div>
              <b>只可荣和</b>
              <p>不能自摸，只能用对手刚打出的牌完成手牌；低于满贯的牌型不能和牌。</p>
            </div>
          </article>
          <article>
            <strong>04</strong>
            <div>
              <b>宝牌与振听</b>
              <p>
                每局翻开表宝牌指示，荣和后再翻里宝牌。自己的舍牌包含等待牌，或放弃一次可荣和牌，都会进入振听。
              </p>
            </div>
          </article>
          <article>
            <strong>05</strong>
            <div>
              <b>17 巡流局</b>
              <p>双方各打出 17 张仍无人荣和则流局。庄家固定东风，闲家固定西风。</p>
            </div>
          </article>
          <article>
            <strong>06</strong>
            <div>
              <b>底分倍数</b>
              <p>满贯 ×1、跳满 ×1.5、倍满 ×2、三倍满 ×3、役满 ×4，由输方向赢家支付。</p>
            </div>
          </article>
        </div>
        <button className="primary-action wide" type="button" onClick={onClose}>
          明白了
        </button>
      </section>
    </div>
  );
}

function TopBar({
  onHome,
  onRules,
  roomCode,
}: {
  onHome?: () => void;
  onRules: () => void;
  roomCode?: string;
}) {
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
        <span className="brand-mark">雀</span>
        <span>二人麻将</span>
      </button>
      <div className="header-meta">
        {roomCode && (
          <button className="room-code-button" type="button" onClick={copyCode}>
            {copied ? '已复制' : `房间 ${roomCode} · 复制`}
          </button>
        )}
        <button className="sound-button" type="button" onClick={toggleSound}>
          {soundEnabled ? '♪ 音乐开启' : '音乐关闭'}
        </button>
        {user ? (
          <button className="account-button" type="button" onClick={logout} title="点击退出登录">
            {user.email}
          </button>
        ) : (
          <button className="account-button" type="button" onClick={openAuth}>
            邮箱登录
          </button>
        )}
        <button className="rules-link" type="button" onClick={onRules}>
          规则说明 <span>↗</span>
        </button>
      </div>
    </header>
  );
}

export default function GameClient() {
  const [screen, setScreen] = useState<Screen>('home');
  const [baseScore, setBaseScore] = useState(5000);
  const [showRules, setShowRules] = useState(false);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [game, dispatchGame] = useReducer(localGameReducer, null);
  const [remote, setRemote] = useState<RoomSnapshot | null>(null);
  const [credentials, setCredentials] = useState<{ code: string; token: string } | null>(null);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState('');
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
  const resultSoundKey = useRef('');

  const ensureAudio = useCallback(() => {
    audioRef.current ??= new GameAudio();
    if (soundEnabled) void audioRef.current.ensure();
  }, [soundEnabled]);

  useEffect(() => {
    fetch('/api/auth', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { user?: AuthUser | null };
        setAuthUser(data.user ?? null);
      })
      .catch(() => undefined);
  }, []);

  const makeDeal = useCallback(() => {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const wall = createWall(Math.random);
      const pools: [number[], number[]] = [wall.slice(0, 34), wall.slice(34, 68)];
      const indicator = tileType(wall[68]);
      const east = suggestTenpaiHand(pools[0], indicator, 'east');
      const west = suggestTenpaiHand(pools[1], indicator, 'west');
      if (east && west)
        return {
          pools,
          suggestions: [east, west] as [number[], number[]],
          indicator,
          uraIndicator: tileType(wall[69]),
        };
    }
    throw new Error('未能生成可听牌的牌池，请重试');
  }, []);

  const startCpu = useCallback(() => {
    const nextDeal = makeDeal();
    setDeal(nextDeal);
    setSelected([]);
    dispatchGame({ type: 'reset' });
    setLocalDiscard(null);
    setScreen('select');
  }, [makeDeal]);

  const toggleSelected = (id: number, setter = setSelected) =>
    setter((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length < 13
          ? [...current, id]
          : current,
    );

  const confirmLocalHand = () => {
    if (!deal || selected.length !== 13) return;
    const selectedSet = new Set(selected);
    const aiSet = new Set(deal.suggestions[1]);
    dispatchGame({
      type: 'start',
      game: {
        hands: [
          selected.map(tileType).sort((a, b) => a - b),
          deal.suggestions[1].map(tileType).sort((a, b) => a - b),
        ],
        reserves: [
          sortTiles(deal.pools[0].filter((id) => !selectedSet.has(id))),
          sortTiles(deal.pools[1].filter((id) => !aiSet.has(id))),
        ],
        discards: [[], []],
        counts: [0, 0],
        temporaryFuriten: [false, false],
        indicator: deal.indicator,
        uraIndicator: deal.uraIndicator,
        turn: 0,
        pendingRon: null,
        pendingScore: null,
        lastDiscard: null,
        result: null,
      },
    });
    setLocalDiscard(null);
    ensureAudio();
    setScreen('playing');
  };

  const performLocalDiscard = useCallback(
    (seat: Seat, requestedId?: number) => {
      const physicalId =
        seat === 0
          ? requestedId
          : game?.reserves[seat][Math.floor(Math.random() * game.reserves[seat].length)];
      if (physicalId !== undefined) dispatchGame({ type: 'discard', seat, physicalId });
      if (seat === 0) setLocalDiscard(null);
    },
    [game],
  );

  useEffect(() => {
    if (screen !== 'playing' || !game || game.result) return;
    if (game.pendingRon === 1 && game.pendingScore) {
      const timer = window.setTimeout(() => dispatchGame({ type: 'cpu-ron', baseScore }), 850);
      return () => window.clearTimeout(timer);
    }
    if (game.turn === 1 && game.pendingRon === null) {
      const timer = window.setTimeout(() => performLocalDiscard(1), 850);
      return () => window.clearTimeout(timer);
    }
  }, [screen, game, baseScore, performLocalDiscard]);

  const localPass = () => dispatchGame({ type: 'pass' });
  const localRon = () => dispatchGame({ type: 'ron', baseScore });

  const fetchRemote = useCallback(
    async (creds = credentials) => {
      if (!creds) return;
      const response = await fetch(`/api/rooms?code=${creds.code}&token=${creds.token}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as RoomSnapshot & { error?: string };
      if (!response.ok) throw new Error(data.error || '房间同步失败');
      setRemote(data);
      if (data.ownPool && !remoteSelected.length && data.ownReady) setRemoteSelected([]);
    },
    [credentials, remoteSelected.length],
  );

  const createRoom = async () => {
    setOnlineBusy(true);
    setOnlineError('');
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', baseScore }),
      });
      const data = (await response.json()) as { code?: string; token?: string; error?: string };
      if (!response.ok || !data.code || !data.token) throw new Error(data.error || '创建房间失败');
      const creds = { code: data.code, token: data.token };
      setCredentials(creds);
      setRemoteSelected([]);
      await fetchRemote(creds);
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : '创建房间失败');
    } finally {
      setOnlineBusy(false);
    }
  };

  const joinRoom = async (code: string) => {
    setOnlineBusy(true);
    setOnlineError('');
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'join', code }),
      });
      const data = (await response.json()) as { code?: string; token?: string; error?: string };
      if (!response.ok || !data.code || !data.token) throw new Error(data.error || '加入房间失败');
      const creds = { code: data.code, token: data.token };
      setCredentials(creds);
      setRemoteSelected([]);
      await fetchRemote(creds);
    } catch (error) {
      setOnlineError(error instanceof Error ? error.message : '加入房间失败');
    } finally {
      setOnlineBusy(false);
    }
  };

  const remoteAction = async (action: string, payload: Record<string, unknown> = {}) => {
    if (!credentials) return;
    setOnlineError('');
    const response = await fetch('/api/rooms', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...credentials, action, ...payload }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      if (response.status === 401) {
        setAuthUser(null);
        setShowAuth(true);
      }
      setOnlineError(data.error || '操作失败，请重试');
      return;
    }
    if (action === 'discard') setRemoteDiscard(null);
    await fetchRemote();
  };

  useRemotePolling({
    enabled: screen === 'online' && Boolean(credentials),
    poll: fetchRemote,
    onError: (error) => setOnlineError(error instanceof Error ? error.message : '同步失败'),
  });

  const goHome = () => {
    setScreen('home');
    dispatchGame({ type: 'reset' });
    setDeal(null);
    setRemote(null);
    setCredentials(null);
    setOnlineError('');
    setLocalDiscard(null);
    setRemoteDiscard(null);
  };
  const remoteReady = async () => {
    if (remoteSelected.length === 13) {
      ensureAudio();
      await remoteAction('select', { selected: remoteSelected });
    }
  };
  const remoteSuggest = () => {
    if (!remote?.ownPool) return;
    const suggestion = suggestTenpaiHand(
      remote.ownPool,
      remote.indicator,
      remote.seat === 0 ? 'east' : 'west',
    );
    if (suggestion) setRemoteSelected(suggestion);
  };

  const openOnline = () => {
    if (!authUser) {
      setAfterAuthOnline(true);
      setShowAuth(true);
      return;
    }
    setScreen('online');
    setRemote(null);
    setCredentials(null);
  };

  const logout = async () => {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' }),
    });
    setAuthUser(null);
    if (screen === 'online') goHome();
  };

  useEffect(() => {
    const playing = screen === 'playing' || (screen === 'online' && remote?.phase === 'playing');
    if (playing && soundEnabled) void audioRef.current?.startMusic();
    else audioRef.current?.stopMusic();
    return () => {
      if (!playing) audioRef.current?.stopMusic();
    };
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
    const key =
      result?.kind === 'ron'
        ? `${screen}-${result.winner}-${result.score?.han}-${result.payment}`
        : '';
    if (key && key !== resultSoundKey.current && soundEnabled) audioRef.current?.ron();
    resultSoundKey.current = key;
  }, [game?.result, remote?.result, screen, soundEnabled]);

  const toggleSound = () => {
    if (soundEnabled) {
      audioRef.current?.stopMusic();
      setSoundEnabled(false);
    } else {
      audioRef.current ??= new GameAudio();
      void audioRef.current.ensure();
      setSoundEnabled(true);
    }
  };

  const content = (() => {
    if (screen === 'home')
      return (
        <HomeScreen
          baseScore={baseScore}
          setBaseScore={setBaseScore}
          onCpu={startCpu}
          onOnline={openOnline}
          header={<TopBar onRules={() => setShowRules(true)} />}
        />
      );
    if (screen === 'select' && deal)
      return (
        <SelectionScreenPage
          pool={deal.pools[0]}
          selected={selected}
          indicator={deal.indicator}
          wind="east"
          title="选出 13 张，做成你的听牌。"
          subtitle="其余 21 张全部保留；对局中每一巡都可从中任选一张舍出。只有达到满贯的等待牌可以荣和。"
          readyLabel="确认手牌，开始对局"
          onToggle={(id) => toggleSelected(id)}
          onRecommend={() => setSelected(deal.suggestions[0])}
          onReady={confirmLocalHand}
          onBack={goHome}
          header={<TopBar onHome={goHome} onRules={() => setShowRules(true)} />}
        />
      );
    if (screen === 'playing' && game) {
      const furiten = isFuriten(game.hands[0], game.discards[0], game.temporaryFuriten[0]);
      return (
        <TableScreen
          hand={game.hands[0]}
          indicator={game.indicator}
          discards={game.discards}
          counts={game.counts}
          turn={game.turn}
          remainingTiles={game.reserves[0]}
          selectedDiscard={localDiscard}
          opponentName="电脑牌手"
          pendingRon={game.pendingRon === 0}
          pendingScore={game.pendingScore}
          furiten={furiten}
          result={game.result}
          baseScore={baseScore}
          onSelectDiscard={setLocalDiscard}
          onDiscard={(id) => performLocalDiscard(0, id)}
          onRon={localRon}
          onPass={localPass}
          onAgain={startCpu}
          onHome={goHome}
          header={<TopBar onHome={goHome} onRules={() => setShowRules(true)} />}
        />
      );
    }
    if (screen === 'online' && !remote)
      return (
        <OnlineScreen
          baseScore={baseScore}
          onBack={goHome}
          onCreate={createRoom}
          onJoin={joinRoom}
          busy={onlineBusy}
          error={onlineError}
          header={<TopBar onHome={goHome} onRules={() => setShowRules(true)} />}
        />
      );
    if (
      screen === 'online' &&
      remote &&
      (remote.phase === 'waiting' || remote.phase === 'selecting')
    ) {
      return (
        <SelectionScreenPage
          pool={remote.ownPool ?? []}
          selected={remoteSelected}
          indicator={remote.indicator}
          wind={remote.seat === 0 ? 'east' : 'west'}
          title={remote.opponentJoined ? '对手已入座，组建你的听牌。' : '牌桌已开，等待朋友入座。'}
          subtitle={
            remote.opponentJoined
              ? remote.opponentReady
                ? '对手已经选好牌，正在等你。'
                : '双方独立选牌，确认后等待对手准备。'
              : '把房间码复制给朋友；等待期间你可以先选好 13 张。'
          }
          readyLabel="确认手牌"
          waiting={remote.ownReady}
          onToggle={(id) => toggleSelected(id, setRemoteSelected)}
          onRecommend={remoteSuggest}
          onReady={remoteReady}
          onBack={goHome}
          header={
            <TopBar onHome={goHome} onRules={() => setShowRules(true)} roomCode={remote.code} />
          }
        />
      );
    }
    if (screen === 'online' && remote && remote.ownHand) {
      return (
        <div data-screen="online">
          <TableScreen
            hand={remote.ownHand}
            indicator={remote.indicator}
            discards={
              remote.seat === 0 ? remote.discards : [remote.discards[1], remote.discards[0]]
            }
            counts={remote.seat === 0 ? remote.counts : [remote.counts[1], remote.counts[0]]}
            turn={(remote.seat === 0 ? remote.turn : 1 - remote.turn) as Seat}
            remainingTiles={remote.ownRemaining ?? []}
            selectedDiscard={remoteDiscard}
            opponentName="联机牌友"
            pendingRon={remote.canRon}
            pendingScore={remote.pendingScore}
            furiten={remote.permanentFuriten || remote.temporaryFuriten}
            result={
              remote.result
                ? remote.seat === 0
                  ? remote.result
                  : {
                      ...remote.result,
                      winner:
                        remote.result.winner === undefined
                          ? undefined
                          : ((1 - remote.result.winner) as Seat),
                    }
                : null
            }
            baseScore={remote.baseScore}
            onSelectDiscard={setRemoteDiscard}
            onDiscard={(id) => remoteAction('discard', { tileId: id })}
            onRon={() => remoteAction('ron')}
            onPass={() => remoteAction('pass')}
            onAgain={goHome}
            onHome={goHome}
            header={
              <TopBar onHome={goHome} onRules={() => setShowRules(true)} roomCode={remote.code} />
            }
            waitingText={onlineError || undefined}
          />
        </div>
      );
    }
    return null;
  })();

  return (
    <AppContext.Provider
      value={{
        user: authUser,
        openAuth: () => {
          setAfterAuthOnline(false);
          setShowAuth(true);
        },
        logout,
        soundEnabled,
        toggleSound,
      }}
    >
      {content}
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showAuth && (
        <AuthScreen
          onClose={() => {
            setShowAuth(false);
            setAfterAuthOnline(false);
          }}
          onSuccess={(user) => {
            setAuthUser(user);
            setShowAuth(false);
            if (afterAuthOnline) {
              setScreen('online');
              setRemote(null);
              setCredentials(null);
            }
            setAfterAuthOnline(false);
          }}
        />
      )}
    </AppContext.Provider>
  );
}
