import type { ForfeitReason, GameResult, Seat } from '../lib/contracts/mahjong';
import type { MatchEventInput } from '../lib/history/events';
import { saveRoomWithHistory } from '../db/roomStore';

const DISCONNECT_GRACE_MS = 90_000;
const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const SWEEP_LIMIT = 200;

interface MaintenanceRoom {
  code: string;
  state: string;
}

interface StoredRoom {
  tokens: [string, string | null];
  hands: [number[] | null, number[] | null];
  turn: Seat;
  pendingRon: Seat | null;
  pendingScore?: unknown;
  result: GameResult | null;
  version: number;
  turnDeadlineAt?: number | null;
}

/**
 * Settles overdue active games and removes rooms inactive for 24 hours.
 * The SQL compare-and-set and exact presence timestamps prevent a cron scan
 * from overwriting an action or a newer heartbeat.
 */
export async function runRoomMaintenance(db: D1Database, now = Date.now()) {
  const staleBefore = now - DISCONNECT_GRACE_MS;
  const candidates = await db
    .prepare(
      `SELECT r.code, r.state
       FROM game_rooms r
       LEFT JOIN room_presence p0 ON p0.room_code = r.code AND p0.seat = 0
       LEFT JOIN room_presence p1 ON p1.room_code = r.code AND p1.seat = 1
       WHERE json_extract(r.state, '$.result') IS NULL
         AND json_extract(r.state, '$.hands[0]') IS NOT NULL
         AND json_extract(r.state, '$.hands[1]') IS NOT NULL
         AND (
           (json_extract(r.state, '$.turnDeadlineAt') IS NOT NULL
             AND json_extract(r.state, '$.turnDeadlineAt') <= ?)
           OR p0.last_seen_at IS NULL OR p0.last_seen_at <= ?
           OR p1.last_seen_at IS NULL OR p1.last_seen_at <= ?
         )
       ORDER BY r.updated_at ASC
       LIMIT ?`,
    )
    .bind(now, staleBefore, staleBefore, SWEEP_LIMIT)
    .all<MaintenanceRoom>();

  let settled = 0;
  for (const candidate of candidates.results ?? []) {
    const room = JSON.parse(candidate.state) as StoredRoom;
    const presenceResult = await db
      .prepare('SELECT seat, last_seen_at FROM room_presence WHERE room_code = ?')
      .bind(candidate.code)
      .all<{ seat: number; last_seen_at: number }>();
    const lastSeenAt: [number | null, number | null] = [null, null];
    for (const presence of presenceResult.results ?? []) {
      if (presence.seat === 0 || presence.seat === 1)
        lastSeenAt[presence.seat] = presence.last_seen_at;
    }

    let result: GameResult | null = null;
    if (room.turnDeadlineAt && room.turnDeadlineAt <= now) {
      const loser = room.pendingRon ?? room.turn;
      const reason: ForfeitReason = 'turn-timeout';
      result = { kind: 'forfeit', winner: (1 - loser) as Seat, loser, reason };
    } else {
      const disconnected = ([0, 1] as const).filter(
        (seat) => lastSeenAt[seat] === null || lastSeenAt[seat]! <= staleBefore,
      );
      if (disconnected.length === 2) result = { kind: 'draw', reason: 'both-disconnected' };
      else if (disconnected.length === 1) {
        const [loser] = disconnected;
        result = {
          kind: 'forfeit',
          winner: (1 - loser) as Seat,
          loser,
          reason: 'disconnect',
        };
      }
    }
    if (!result) continue;

    const expectedVersion = room.version;
    room.result = result;
    room.pendingRon = null;
    room.pendingScore = null;
    room.turnDeadlineAt = null;
    room.version += 1;
    const event: MatchEventInput =
      result.kind === 'draw'
        ? {
            type: 'hand.drawn',
            seat: null,
            stateVersion: room.version,
            createdAt: now,
            payload: { reason: 'both-disconnected' },
          }
        : {
            type: 'player.forfeited',
            seat: result.loser,
            stateVersion: room.version,
            createdAt: now,
            payload: { winner: result.winner, reason: result.reason },
          };
    const updated = await saveRoomWithHistory(db, candidate.code, room, expectedVersion, {
      events: [event],
      expectedPresence: [
        { seat: 0, lastSeenAt: lastSeenAt[0] },
        { seat: 1, lastSeenAt: lastSeenAt[1] },
      ],
    });
    if (updated) settled += 1;
  }

  const removed = await db
    .prepare('DELETE FROM game_rooms WHERE updated_at < ?')
    .bind(now - ROOM_TTL_MS)
    .run();

  return { scanned: candidates.results?.length ?? 0, settled, removed: removed.meta.changes ?? 0 };
}
