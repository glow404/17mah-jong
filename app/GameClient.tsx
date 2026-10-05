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
import type { GameResult, RoomSnapshot, Seat } from '../lib/contracts/mahjong';
import { GAME_PROTOCOL_VERSION } from '../lib/contracts/protocol';
import type { MatchEvent, MatchEventInput } from '../lib/history/events';
import { createMatchReplayExport } from '../lib/history/export';
import { saveLocalMatchHistory } from '../lib/history/local';
import { isFuriten } from '../lib/rules/furiten';
import { createSeededRandom, createWall, sortTiles, tileType } from '../lib/rules/tiles';
import { suggestTenpaiHand } from '../lib/rules/selection';
import { aiRandomForTurn, mahjongAi, type AiDifficulty, type AiDiscardDecision } from './game/ai';
import { emptyAiStats, loadAiStats, recordAiMatch, type AiStats } from './game/aiStats';
import { localGameReducer } from './game/localGameReducer';
import { useRemotePolling, type RemoteConnectionStatus } from '../hooks/useRemotePolling';
import { useAccessibleDialog } from './hooks/useAccessibleDialog';
import { AuthScreen } from './screens/AuthScreen';
import type { AuthUser } from './screens/AuthScreen';
import { HomeScreen } from './screens/HomeScreen';
import { OnlineScreen } from './screens/OnlineScreen';
import { SelectionScreenPage } from './screens/SelectionScreen';
import { TableScreen } from './screens/TableScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { OnboardingGuide } from './screens/OnboardingGuide';
import { RulesEncyclopediaScreen } from './screens/RulesEncyclopediaScreen';

type Screen = 'home' | 'select' | 'playing' | 'online' | 'history' | 'rules';
const ROOM_SESSION_KEY = '17mah-jong:active-room:v1';
const ONBOARDING_STORAGE_KEY = '17mah-jong:onboarding-complete:v1';
interface Deal {
  pools: [number[], number[]];
  suggestions: [number[], number[]];
  indicator: number;
  uraIndicator: number;
  seed: number;
}

type WithoutEventMetadata<T> = T extends MatchEventInput
  ? Omit<T, 'stateVersion' | 'createdAt'>
  : never;
type PendingLocalEvent = WithoutEventMetadata<MatchEventInput>;

interface LocalHistorySession {
  matchId: string;
  startedAt: number;
  playStartedAt: number | null;
  baseScore: number;
  difficulty: AiDifficulty;
  seed: number;
  totalDecisionMs: number;
  decisions: number;
  version: number;
  events: MatchEvent[];
  saved: boolean;
}

function orientResultForSeat(result: GameResult, seat: Seat): GameResult {
  if (seat === 0 || result.kind === 'draw') return result;
  if (result.kind === 'forfeit')
    return {
      ...result,
      winner: (1 - result.winner) as Seat,
      loser: (1 - result.loser) as Seat,
    };
  return { ...result, winner: (1 - result.winner) as Seat };
}

const AppContext = createContext<{
  user: AuthUser | null;
  openAuth: () => void;
  openHistory: () => void;
  openGuide: () => void;
  logout: () => void;
  soundEnabled: boolean;
  toggleSound: () => void;
  musicVolume: number;
  effectsVolume: number;
  setMusicVolume: (value: number) => void;
  setEffectsVolume: (value: number) => void;
}>({
  user: null,
  openAuth: () => undefined,
  openHistory: () => undefined,
  openGuide: () => undefined,
  logout: () => undefined,
  soundEnabled: true,
  toggleSound: () => undefined,
  musicVolume: 0.65,
  effectsVolume: 0.8,
  setMusicVolume: () => undefined,
  setEffectsVolume: () => undefined,
});

function RulesModal({
  onClose,
  onEncyclopedia,
}: {
  onClose: () => void;
  onEncyclopedia: () => void;
}) {
  const dialogRef = useAccessibleDialog<HTMLElement>(onClose);
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        aria-describedby="rules-summary"
        tabIndex={-1}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭规则">
          ×
        </button>
        <p className="eyebrow">
          <span /> 对局规则
        </p>
        <h2 id="rules-title">17 巡定胜负</h2>
        <div id="rules-summary" className="rules-grid">
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
        <div className="rules-modal-actions">
          <button className="secondary-action" type="button" onClick={onEncyclopedia}>
            打开规则百科
          </button>
          <button className="primary-action" type="button" onClick={onClose}>
            明白了
          </button>
        </div>
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
  const {
    user,
    openAuth,
    openHistory,
    openGuide,
    logout,
    soundEnabled,
    toggleSound,
    musicVolume,
    effectsVolume,
    setMusicVolume,
    setEffectsVolume,
  } = useContext(AppContext);
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
        <button
          className="sound-button"
          type="button"
          onClick={toggleSound}
          aria-pressed={soundEnabled}
          aria-label={soundEnabled ? '关闭声音' : '开启声音'}
          aria-keyshortcuts="M"
        >
          {soundEnabled ? '♪ 音乐开启' : '音乐关闭'}
        </button>
        <details className="sound-settings">
          <summary aria-label="音量设置">音量设置</summary>
          <div className="sound-settings-panel">
            <label>
              背景音乐
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={musicVolume}
                aria-label="背景音乐音量"
                onChange={(event) => setMusicVolume(Number(event.target.value))}
              />
            </label>
            <label>
              游戏音效
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={effectsVolume}
                aria-label="游戏音效音量"
                onChange={(event) => setEffectsVolume(Number(event.target.value))}
              />
            </label>
          </div>
        </details>
        <button className="rules-link" type="button" onClick={openHistory}>
          对局历史
        </button>
        {user ? (
          <>
            <button className="account-button" type="button" onClick={logout} title="点击退出登录">
              {user.email}
            </button>
          </>
        ) : (
          <button className="account-button" type="button" onClick={openAuth}>
            邮箱登录
          </button>
        )}
        <button className="rules-link" type="button" onClick={onRules} aria-keyshortcuts="Shift+/">
          规则说明 <span aria-hidden="true">↗</span>
        </button>
        <button className="rules-link" type="button" onClick={openGuide}>
          新手引导
        </button>
      </div>
    </header>
  );
}

export default function GameClient() {
  const [screen, setScreen] = useState<Screen>('home');
  const [baseScore, setBaseScore] = useState(5000);
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty>('normal');
  const [aiStats, setAiStats] = useState<AiStats>(() => emptyAiStats());
  const [showRules, setShowRules] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [game, dispatchGame] = useReducer(localGameReducer, null);
  const [remote, setRemote] = useState<RoomSnapshot | null>(null);
  const [credentials, setCredentials] = useState<{ code: string; token: string } | null>(null);
  const [roomStorageReady, setRoomStorageReady] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<RemoteConnectionStatus>('connecting');
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [onlineError, setOnlineError] = useState('');
  const [remoteActionBusy, setRemoteActionBusy] = useState(false);
  const [remoteSelected, setRemoteSelected] = useState<number[]>([]);
  const [localDiscard, setLocalDiscard] = useState<number | null>(null);
  const [aiLastDecision, setAiLastDecision] = useState<AiDiscardDecision | null>(null);
  const [remoteDiscard, setRemoteDiscard] = useState<number | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [afterAuthOnline, setAfterAuthOnline] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [musicVolume, setMusicVolume] = useState(0.65);
  const [effectsVolume, setEffectsVolume] = useState(0.8);
  const [soundPreferencesReady, setSoundPreferencesReady] = useState(false);
  const audioRef = useRef<GameAudio | null>(null);
  const localSoundCount = useRef(0);
  const remoteSoundCount = useRef(0);
  const resultSoundKey = useRef('');
  const remoteActionLock = useRef(false);
  const localHistory = useRef<LocalHistorySession | null>(null);
  const historyReturnScreen = useRef<Screen>('home');
  const rulesReturnScreen = useRef<Screen>('home');

  useEffect(() => {
    document.documentElement.dataset.appReady = 'true';
    return () => {
      delete document.documentElement.dataset.appReady;
    };
  }, []);

  const appendLocalEvents = useCallback((pendingEvents: readonly PendingLocalEvent[]) => {
    const session = localHistory.current;
    if (!session || session.saved || pendingEvents.length === 0) return;
    const version = session.version + 1;
    const createdAt = Date.now();
    session.version = version;
    session.events.push(
      ...pendingEvents.map(
        (event, index) =>
          ({
            ...event,
            sequence: session.events.length + index + 1,
            stateVersion: version,
            createdAt,
          }) as MatchEvent,
      ),
    );
  }, []);

  const finishLocalHistory = useCallback((result: GameResult) => {
    const session = localHistory.current;
    if (!session || session.saved) return;
    session.saved = true;
    saveLocalMatchHistory(
      createMatchReplayExport(
        {
          matchId: session.matchId,
          startedAt: session.startedAt,
          finishedAt: Date.now(),
          baseScore: session.baseScore,
          viewerSeat: 0,
          result,
        },
        session.events,
      ),
    );
    setAiStats(
      recordAiMatch(
        session.difficulty,
        result,
        Date.now() - (session.playStartedAt ?? session.startedAt),
        session.totalDecisionMs,
        session.decisions,
      ),
    );
  }, []);

  const ensureAudio = useCallback(() => {
    audioRef.current ??= new GameAudio();
    audioRef.current.setMuted(!soundEnabled);
    audioRef.current.setVolumes(musicVolume, effectsVolume);
    if (soundEnabled) void audioRef.current.ensure();
  }, [effectsVolume, musicVolume, soundEnabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (localStorage.getItem(ONBOARDING_STORAGE_KEY) !== 'complete') setShowOnboarding(true);
      } catch {
        setShowOnboarding(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const enabled = localStorage.getItem('17mah-jong:sound-enabled:v1');
        const storedMusic = localStorage.getItem('17mah-jong:music-volume:v1');
        const storedEffects = localStorage.getItem('17mah-jong:effects-volume:v1');
        const music = storedMusic === null ? Number.NaN : Number(storedMusic);
        const effects = storedEffects === null ? Number.NaN : Number(storedEffects);
        if (enabled === 'false') setSoundEnabled(false);
        if (Number.isFinite(music) && music >= 0 && music <= 1) setMusicVolume(music);
        if (Number.isFinite(effects) && effects >= 0 && effects <= 1) setEffectsVolume(effects);
      } catch {
        // Storage may be disabled; keep accessible in-memory controls.
      } finally {
        setSoundPreferencesReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!soundPreferencesReady) return;
    try {
      localStorage.setItem('17mah-jong:sound-enabled:v1', String(soundEnabled));
      localStorage.setItem('17mah-jong:music-volume:v1', String(musicVolume));
      localStorage.setItem('17mah-jong:effects-volume:v1', String(effectsVolume));
    } catch {
      // Audio preferences still apply for the current session when storage is unavailable.
    }
    audioRef.current?.setMuted(!soundEnabled);
    audioRef.current?.setVolumes(musicVolume, effectsVolume);
  }, [effectsVolume, musicVolume, soundEnabled, soundPreferencesReady]);

  useEffect(() => () => audioRef.current?.dispose(), []);

  useEffect(() => {
    fetch('/api/auth', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { user?: AuthUser | null };
        setAuthUser(data.user ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = sessionStorage.getItem(ROOM_SESSION_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as { code?: unknown; token?: unknown };
          if (
            typeof parsed.code === 'string' &&
            /^[A-Z0-9]{6}$/i.test(parsed.code) &&
            typeof parsed.token === 'string' &&
            parsed.token.length >= 16 &&
            parsed.token.length <= 128
          ) {
            setCredentials({ code: parsed.code.toUpperCase(), token: parsed.token });
            setScreen('online');
          } else sessionStorage.removeItem(ROOM_SESSION_KEY);
        }
      } catch {
        sessionStorage.removeItem(ROOM_SESSION_KEY);
      } finally {
        setRoomStorageReady(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!roomStorageReady) return;
    if (credentials) sessionStorage.setItem(ROOM_SESSION_KEY, JSON.stringify(credentials));
    else sessionStorage.removeItem(ROOM_SESSION_KEY);
  }, [credentials, roomStorageReady]);

  const makeDeal = useCallback((difficulty: AiDifficulty) => {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const random = createSeededRandom(seed);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const wall = createWall(random);
      const pools: [number[], number[]] = [wall.slice(0, 34), wall.slice(34, 68)];
      const indicator = tileType(wall[68]);
      const east = suggestTenpaiHand(pools[0], indicator, 'east', random);
      if (!east) continue;
      const west = mahjongAi[difficulty].selectHand(pools[1], indicator, 'west', random)?.hand;
      if (west)
        return {
          pools,
          suggestions: [east, west] as [number[], number[]],
          indicator,
          uraIndicator: tileType(wall[69]),
          seed,
        };
    }

    // Bound the combinatorial search on the UI thread. If two random deals
    // do not yield two qualifying hands, put a randomized known tenpai in each
    // 34-tile pool so local play can still start immediately.
    const available = createWall(random);
    const suits = [0, 1, 2];
    const eastSuit = Math.floor(random() * suits.length);
    const westSuit = suits.find((suit) => suit !== eastSuit && suit !== (eastSuit + 1) % 3)!;
    const honorPair = 27 + Math.floor(random() * 7);
    const handTemplates = [
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 1, 5, 6],
      [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6],
      [0, 1, 2, 3, 4, 5, 6, 7, 8, honorPair, honorPair, 5, 6],
    ];
    const eastTemplate = Math.floor(random() * handTemplates.length);
    const westTemplate = (eastTemplate + 1 + Math.floor(random() * 2)) % handTemplates.length;
    const takeTile = (type: number) => {
      const index = available.findIndex((id) => tileType(id) === type);
      if (index < 0) throw new Error('牌墙中缺少预期牌种');
      return available.splice(index, 1)[0];
    };
    const prepareHand = (suit: number, template: readonly number[]) =>
      template.map((tile) => takeTile(tile >= 27 ? tile : suit * 9 + tile));
    const east = prepareHand(eastSuit, handTemplates[eastTemplate]);
    const west = prepareHand(westSuit, handTemplates[westTemplate]);
    const pools: [number[], number[]] = [
      [...east, ...available.splice(0, 21)],
      [...west, ...available.splice(0, 21)],
    ];
    return {
      pools,
      suggestions: [east, west] as [number[], number[]],
      indicator: tileType(available[0]),
      uraIndicator: tileType(available[1]),
      seed,
    };
  }, []);

  const startCpu = useCallback(() => {
    const nextDeal = makeDeal(aiDifficulty);
    const startedAt = Date.now();
    const matchId = crypto.randomUUID().replaceAll('-', '');
    localHistory.current = {
      matchId,
      startedAt,
      playStartedAt: null,
      baseScore,
      difficulty: aiDifficulty,
      seed: nextDeal.seed,
      totalDecisionMs: 0,
      decisions: 0,
      version: 1,
      saved: false,
      events: [
        {
          sequence: 1,
          type: 'match.created',
          seat: 0,
          stateVersion: 1,
          createdAt: startedAt,
          payload: {
            baseScore,
            pools: [nextDeal.pools[0].slice(), nextDeal.pools[1].slice()],
            indicator: nextDeal.indicator,
            uraIndicator: nextDeal.uraIndicator,
            opponentJoined: true,
          },
        },
      ],
    };
    setDeal(nextDeal);
    setSelected([]);
    dispatchGame({ type: 'reset' });
    setLocalDiscard(null);
    setAiLastDecision(null);
    setScreen('select');
  }, [aiDifficulty, baseScore, makeDeal]);

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
    if (localHistory.current) localHistory.current.playStartedAt = Date.now();
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
    appendLocalEvents([
      {
        type: 'hand.selected',
        seat: 0,
        payload: { selectedIds: selected.slice(), turnDeadlineAt: null },
      },
    ]);
    appendLocalEvents([
      {
        type: 'hand.selected',
        seat: 1,
        payload: { selectedIds: deal.suggestions[1].slice(), turnDeadlineAt: null },
      },
    ]);
    setLocalDiscard(null);
    ensureAudio();
    setScreen('playing');
  };

  const performLocalDiscard = useCallback(
    (seat: Seat, requestedId?: number) => {
      let physicalId = requestedId;
      if (seat === 1 && game) {
        const session = localHistory.current;
        const difficulty = session?.difficulty ?? aiDifficulty;
        const decision = mahjongAi[difficulty].chooseDiscard(
          {
            hand: game.hands[1],
            reserves: game.reserves[1],
            ownDiscards: game.discards[1],
            opponentDiscards: game.discards[0],
            temporaryFuriten: game.temporaryFuriten[1],
            indicator: game.indicator,
            wind: 'west',
          },
          aiRandomForTurn(session?.seed ?? 1, game.counts[1]),
          20,
        );
        physicalId = decision.physicalId;
        setAiLastDecision(decision);
        if (session) {
          session.totalDecisionMs += decision.elapsedMs;
          session.decisions += 1;
        }
      }
      if (physicalId !== undefined && game) {
        const action = { type: 'discard' as const, seat, physicalId };
        const next = localGameReducer(game, action);
        if (next !== game) {
          dispatchGame(action);
          const events: PendingLocalEvent[] = [
            {
              type: 'tile.discarded',
              seat,
              payload: { physicalTileId: physicalId, turnDeadlineAt: null },
            },
          ];
          if (next?.result?.kind === 'draw')
            events.push({
              type: 'hand.drawn',
              seat: null,
              payload: { reason: 'seventeen-discard' },
            });
          appendLocalEvents(events);
          if (next?.result) finishLocalHistory(next.result);
        }
      }
      if (seat === 0) setLocalDiscard(null);
    },
    [aiDifficulty, appendLocalEvents, finishLocalHistory, game],
  );

  const resolveLocalRon = useCallback(
    (seat: Seat) => {
      if (!game) return;
      const action =
        seat === 0 ? { type: 'ron' as const, baseScore } : { type: 'cpu-ron' as const, baseScore };
      const next = localGameReducer(game, action);
      if (next === game) return;
      dispatchGame(action);
      appendLocalEvents([{ type: 'ron.claimed', seat, payload: {} }]);
      if (next?.result) finishLocalHistory(next.result);
    },
    [appendLocalEvents, baseScore, finishLocalHistory, game],
  );

  useEffect(() => {
    if (screen !== 'playing' || !game || game.result) return;
    if (game.pendingRon === 1 && game.pendingScore) {
      const timer = window.setTimeout(() => resolveLocalRon(1), 850);
      return () => window.clearTimeout(timer);
    }
    if (game.turn === 1 && game.pendingRon === null) {
      const timer = window.setTimeout(() => performLocalDiscard(1), 850);
      return () => window.clearTimeout(timer);
    }
  }, [screen, game, performLocalDiscard, resolveLocalRon]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAiStats(loadAiStats()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const localPass = useCallback(() => {
    if (!game) return;
    const next = localGameReducer(game, { type: 'pass' });
    if (next === game) return;
    dispatchGame({ type: 'pass' });
    const events: PendingLocalEvent[] = [
      { type: 'ron.declined', seat: 0, payload: { turnDeadlineAt: null } },
    ];
    if (next?.result?.kind === 'draw')
      events.push({ type: 'hand.drawn', seat: null, payload: { reason: 'seventeen-discard' } });
    appendLocalEvents(events);
    if (next?.result) finishLocalHistory(next.result);
  }, [appendLocalEvents, finishLocalHistory, game]);
  const localRon = useCallback(() => resolveLocalRon(0), [resolveLocalRon]);

  const fetchRemote = useCallback(
    async (creds = credentials) => {
      if (!creds) return;
      const response = await fetch(`/api/rooms?code=${creds.code}&token=${creds.token}`, {
        cache: 'no-store',
        headers: { 'X-Game-Protocol': String(GAME_PROTOCOL_VERSION) },
      });
      const data = (await response.json()) as RoomSnapshot & { error?: string };
      if (!response.ok) {
        if (response.status === 404 || response.status === 410) {
          setCredentials(null);
          setRemote(null);
        }
        if (response.status === 401) {
          setAuthUser(null);
          setShowAuth(true);
        }
        throw new Error(data.error || '房间同步失败');
      }
      setRemote((current) => (current && current.version > data.version ? current : data));
      setOnlineError('');
      if (data.ownPool && !remoteSelected.length && data.ownReady) setRemoteSelected([]);
      return data;
    },
    [credentials, remoteSelected.length],
  );

  const heartbeatRemote = useCallback(async () => {
    if (!credentials) return;
    const response = await fetch('/api/rooms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Game-Protocol': String(GAME_PROTOCOL_VERSION),
      },
      body: JSON.stringify({ ...credentials, action: 'heartbeat' }),
    });
    if (!response.ok) {
      const data = (await response.json()) as { error?: string };
      throw new Error(data.error || '联机心跳失败');
    }
  }, [credentials]);

  const createRoom = async () => {
    setOnlineBusy(true);
    setOnlineError('');
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Game-Protocol': String(GAME_PROTOCOL_VERSION),
        },
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
        headers: {
          'Content-Type': 'application/json',
          'X-Game-Protocol': String(GAME_PROTOCOL_VERSION),
        },
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

  const remoteAction = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (!credentials || !remote || remoteActionLock.current) return;
      remoteActionLock.current = true;
      setRemoteActionBusy(true);
      setOnlineError('');
      const actionId = crypto.randomUUID();
      try {
        let actionVersion = remote.version;
        for (let conflictAttempt = 0; conflictAttempt < 2; conflictAttempt += 1) {
          const requestBody = JSON.stringify({
            ...credentials,
            action,
            actionId,
            version: actionVersion,
            ...payload,
          });
          let response: Response | null = null;
          let lastError: unknown;
          for (let networkAttempt = 0; networkAttempt < 2; networkAttempt += 1) {
            try {
              response = await fetch('/api/rooms', {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Game-Protocol': String(GAME_PROTOCOL_VERSION),
                },
                body: requestBody,
              });
              if (response.status < 500 || networkAttempt === 1) break;
            } catch (error) {
              lastError = error;
              if (networkAttempt === 1) throw error;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
          if (!response) throw lastError ?? new Error('网络请求失败');
          const data = (await response.json()) as RoomSnapshot & { error?: string };
          if (!response.ok) {
            if (response.status === 401) {
              setAuthUser(null);
              setShowAuth(true);
            }
            if (response.status === 409 && conflictAttempt === 0) {
              const latest = await fetchRemote();
              if (latest && latest.phase !== 'finished') {
                actionVersion = latest.version;
                continue;
              }
            }
            setOnlineError(data.error || '操作失败，请重试');
            return;
          }
          setRemote((current) => (current && current.version > data.version ? current : data));
          if (action === 'discard') setRemoteDiscard(null);
          return;
        }
      } catch (error) {
        setOnlineError(error instanceof Error ? error.message : '操作失败，请检查网络后重试');
      } finally {
        remoteActionLock.current = false;
        setRemoteActionBusy(false);
      }
    },
    [credentials, fetchRemote, remote],
  );

  const onRemotePollError = useCallback((error: unknown) => {
    setOnlineError(error instanceof Error ? error.message : '同步失败');
  }, []);

  useRemotePolling({
    enabled: screen === 'online' && Boolean(credentials),
    heartbeat: heartbeatRemote,
    poll: fetchRemote,
    onError: onRemotePollError,
    onConnectionChange: setConnectionStatus,
  });

  const connectionMessage =
    !credentials || connectionStatus === 'connected'
      ? undefined
      : connectionStatus === 'offline'
        ? '网络已断开，恢复连接后将自动同步。'
        : connectionStatus === 'reconnecting'
          ? '同步暂时中断，正在自动重连…'
          : '正在恢复联机房间…';

  const goHome = () => {
    setScreen('home');
    dispatchGame({ type: 'reset' });
    setDeal(null);
    setRemote(null);
    setCredentials(null);
    sessionStorage.removeItem(ROOM_SESSION_KEY);
    setOnlineError('');
    setLocalDiscard(null);
    setRemoteDiscard(null);
  };
  const openHistory = () => {
    if (screen !== 'history') historyReturnScreen.current = screen;
    setScreen('history');
  };
  const openEncyclopedia = useCallback(() => {
    rulesReturnScreen.current = screen === 'rules' ? rulesReturnScreen.current : screen;
    setShowRules(false);
    setScreen('rules');
  }, [screen]);
  const closeOnboarding = () => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, 'complete');
    } catch {
      // The guide can still be dismissed when storage is unavailable.
    }
  };
  const openGuide = () => setShowOnboarding(true);
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
    if (screen === 'online' || screen === 'history') goHome();
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

  const toggleSound = useCallback(() => {
    const nextEnabled = !soundEnabled;
    audioRef.current ??= new GameAudio();
    audioRef.current.setVolumes(musicVolume, effectsVolume);
    audioRef.current.setMuted(!nextEnabled);
    if (nextEnabled) void audioRef.current.ensure();
    setSoundEnabled(nextEnabled);
  }, [effectsVolume, musicVolume, soundEnabled]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]')
      )
        return;
      if (showOnboarding || showRules || showAuth) return;
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        toggleSound();
      } else if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        openEncyclopedia();
      } else if (event.key.toLowerCase() === 'r') {
        if (screen === 'playing' && game?.pendingRon === 0) {
          event.preventDefault();
          localRon();
        } else if (screen === 'online' && remote?.canRon) {
          event.preventDefault();
          void remoteAction('ron');
        }
      } else if (event.key.toLowerCase() === 'p') {
        if (screen === 'playing' && game?.pendingRon === 0) {
          event.preventDefault();
          localPass();
        } else if (screen === 'online' && remote?.canRon) {
          event.preventDefault();
          void remoteAction('pass');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    game?.pendingRon,
    localPass,
    localRon,
    openEncyclopedia,
    remote?.canRon,
    remoteAction,
    screen,
    showAuth,
    showOnboarding,
    showRules,
    toggleSound,
  ]);

  const content = (() => {
    if (screen === 'rules')
      return (
        <RulesEncyclopediaScreen
          onBack={() => setScreen(rulesReturnScreen.current)}
          header={
            <TopBar
              onHome={() => setScreen(rulesReturnScreen.current)}
              onRules={() => setShowRules(true)}
            />
          }
        />
      );
    if (screen === 'history')
      return (
        <HistoryScreen
          onBack={() => setScreen(historyReturnScreen.current)}
          onLogin={() => {
            setAfterAuthOnline(false);
            setShowAuth(true);
          }}
          header={<TopBar onHome={goHome} onRules={() => setShowRules(true)} />}
        />
      );
    if (screen === 'home')
      return (
        <HomeScreen
          baseScore={baseScore}
          setBaseScore={setBaseScore}
          aiDifficulty={aiDifficulty}
          setAiDifficulty={setAiDifficulty}
          aiStats={aiStats}
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
          aiInsight={aiLastDecision}
          onHistory={openHistory}
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
          connectionMessage={connectionMessage}
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
          connectionMessage={connectionMessage}
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
            actionBusy={remoteActionBusy}
            turnDeadlineAt={remote.turnDeadlineAt}
            canSurrender={remote.opponentJoined && remote.phase === 'playing'}
            furiten={remote.permanentFuriten || remote.temporaryFuriten}
            result={remote.result ? orientResultForSeat(remote.result, remote.seat) : null}
            baseScore={remote.baseScore}
            onHistory={openHistory}
            onSelectDiscard={setRemoteDiscard}
            onDiscard={(id) => remoteAction('discard', { tileId: id })}
            onRon={() => remoteAction('ron')}
            onPass={() => remoteAction('pass')}
            onSurrender={() => {
              if (window.confirm('确定要认输并结束本局吗？')) void remoteAction('surrender');
            }}
            onAgain={goHome}
            onHome={goHome}
            header={
              <TopBar onHome={goHome} onRules={() => setShowRules(true)} roomCode={remote.code} />
            }
            waitingText={onlineError || connectionMessage}
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
        openHistory,
        openGuide,
        logout,
        soundEnabled,
        toggleSound,
        musicVolume,
        effectsVolume,
        setMusicVolume,
        setEffectsVolume,
      }}
    >
      {content}
      {showRules && (
        <RulesModal onClose={() => setShowRules(false)} onEncyclopedia={openEncyclopedia} />
      )}
      {showOnboarding && (
        <OnboardingGuide
          onClose={closeOnboarding}
          onRules={() => {
            closeOnboarding();
            openEncyclopedia();
          }}
        />
      )}
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
