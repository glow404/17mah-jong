import type { MatchReplayExport } from './events';
import { replayMatchEvents } from './replay';

const LOCAL_HISTORY_KEY = '17mah-jong:match-history:v1';
const MAX_LOCAL_MATCHES = 50;

/** Reads validated, completed computer-match replays from this browser only. */
export function readLocalMatchHistory(
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): MatchReplayExport[] {
  try {
    const stored = storage.getItem(LOCAL_HISTORY_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCompleteReplay).slice(0, MAX_LOCAL_MATCHES);
  } catch {
    return [];
  }
}

/** Stores the newest local match while keeping only a bounded on-device history. */
export function saveLocalMatchHistory(
  replay: MatchReplayExport,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
) {
  const previous = readLocalMatchHistory(storage).filter(
    (item) => item.match.matchId !== replay.match.matchId,
  );
  storage.setItem(
    LOCAL_HISTORY_KEY,
    JSON.stringify([replay, ...previous].slice(0, MAX_LOCAL_MATCHES)),
  );
}

function isCompleteReplay(value: unknown): value is MatchReplayExport {
  if (!value || typeof value !== 'object') return false;
  const replay = value as Partial<MatchReplayExport>;
  if (
    replay.format !== '17mah-jong-replay' ||
    replay.schemaVersion !== 1 ||
    !replay.match ||
    !Array.isArray(replay.events)
  )
    return false;
  try {
    return Boolean(replayMatchEvents(replay.events).at(-1)?.result);
  } catch {
    return false;
  }
}
