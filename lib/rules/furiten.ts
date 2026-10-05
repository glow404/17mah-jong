import { waitTypes } from './hand';
import type { TileType } from './types';

/**
 * 判断当前手牌是否振听。临时振听优先成立；否则自家弃牌与当前听牌有交集即永久振听。
 * 输入手牌非法时因没有有效等待牌而返回 false（除临时振听已成立外）。
 */
export function isFuriten(
  hand: readonly TileType[],
  ownDiscards: readonly TileType[],
  temporary: boolean,
): boolean {
  if (temporary) return true;
  const waits = new Set(waitTypes(hand));
  return ownDiscards.some((tile) => waits.has(tile));
}
