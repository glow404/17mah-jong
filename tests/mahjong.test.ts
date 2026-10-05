/**
 * 麻将规则库的回归测试。
 *
 * 测试重点覆盖本项目特有的宝牌循环、满贯起胡、役满识别、振听以及
 * Unicode 麻将牌图案，防止修改 lib/mahjong.ts 时破坏核心玩法。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWall,
  describeWaits,
  doraFromIndicator,
  evaluateWin,
  isFuriten,
  isWinningHand,
  shuffle,
  sortTiles,
  suggestTenpaiHand,
  tileGlyph,
  tileLabel,
  tileText,
  tileType,
  waitTypes,
} from '../lib/mahjong';

test('宝牌指示牌按数牌、风牌和三元牌循环', () => {
  assert.equal(doraFromIndicator(8), 0);
  assert.equal(doraFromIndicator(30), 27);
  assert.equal(doraFromIndicator(33), 31);
});

test('国士无双十三面听按役满结算并触发舍牌振听', () => {
  const hand = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  assert.equal(waitTypes(hand).length, 13);
  assert.equal(evaluateWin(hand, 0, 1, 'east')?.tier, '役满');
  assert.equal(isFuriten(hand, [0], false), true);
});

test('清一色复合牌型达到三倍满', () => {
  const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  const score = evaluateWin(hand, 8, 12, 'east');
  assert.equal(score?.tier, '三倍满');
  assert.ok((score?.han ?? 0) >= 11);
});

test('临时振听会阻止任何荣和', () => {
  const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  assert.equal(isFuriten(hand, [], true), true);
});

test('牌面使用麻将图案字符并在和牌后计算里宝牌', () => {
  assert.equal(tileGlyph(0), '🀇');
  assert.equal(tileGlyph(9), '🀙');
  assert.equal(tileGlyph(18), '🀐');
  const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  const withoutUra = evaluateWin(hand, 8, 12, 'east');
  const withUra = evaluateWin(hand, 8, 12, 'east', 8);
  assert.ok((withUra?.han ?? 0) > (withoutUra?.han ?? 0));
  assert.equal(withUra?.uraDora, 2);
});

test('牌面工具保持实体牌、图案和排序的一致性', () => {
  assert.equal(tileType(0), 0);
  assert.equal(tileType(35), 8);
  assert.deepEqual(tileLabel(0), { main: '一', suit: '万', kind: 'man' });
  assert.equal(tileText(27), '东');
  assert.deepEqual(sortTiles([8, 0, 7, 4]), [0, 4, 7, 8]);
  assert.equal(shuffle([], Math.random).length, 0);
  assert.equal(createWall(Math.random).length, 136);
});

test('牌型判断区分合法和牌、非法数量与等待牌说明', () => {
  const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  assert.equal(isWinningHand([...hand, 8]), true);
  assert.equal(isWinningHand(hand), false);
  assert.ok(describeWaits(hand, 12, 'west').some((entry) => entry.tile === 8));
  assert.deepEqual(waitTypes(hand.slice(0, 12)), []);
});

test('标准拆解覆盖对子、刻子、三色和七对子计分', () => {
  const toitoiHand = [0, 0, 0, 9, 9, 9, 18, 18, 18, 27, 27, 32, 32];
  const toitoi = evaluateWin(toitoiHand, 27, 0, 'east');
  assert.equal(toitoi?.tier, '役满');
  assert.ok(toitoi?.yaku.includes('四暗刻'));

  const sanshokuHand = [27, 27, 27, 0, 1, 2, 9, 10, 11, 18, 19, 20, 31];
  const sanshoku = evaluateWin(sanshokuHand, 31, 8, 'west');
  assert.ok(sanshoku?.yaku.includes('三色同顺'));

  const chiitoitsuHand = [0, 0, 9, 9, 18, 18, 27, 27, 28, 28, 31, 31, 6];
  const chiitoitsu = evaluateWin(chiitoitsuHand, 6, 8, 'west');
  assert.ok(chiitoitsu?.yaku.includes('七对子'));
  assert.equal(chiitoitsu?.fu, 25);

  const smallDragonsHand = [31, 31, 31, 32, 32, 32, 33, 33, 0, 1, 2, 9, 10];
  const smallDragons = evaluateWin(smallDragonsHand, 11, 8, 'west');
  assert.ok(smallDragons?.yaku.includes('小三元'));
});

test('副役和边张结构会进入最高分候选', () => {
  const hand = [27, 27, 27, 0, 1, 2, 9, 10, 11, 18, 19, 20, 31];
  const score = evaluateWin(hand, 31, 0, 'east');
  assert.ok(score);
  assert.ok(score.yaku.includes('一气通贯') || score.yaku.includes('三色同顺'));
});

test('智能推荐可以从包含三组面子的牌池生成实体牌', () => {
  const types = [
    ...Array(3).fill([0, 1, 2]).flat(),
    ...Array(3).fill([9, 10, 11]).flat(),
    ...Array(3).fill([18, 19, 20]).flat(),
    27,
    27,
    28,
    28,
    31,
    31,
    32,
  ];
  const used = new Map<number, number>();
  const pool = types.map((type) => {
    const copy = used.get(type) ?? 0;
    used.set(type, copy + 1);
    return type * 4 + copy;
  });
  const selection = suggestTenpaiHand(pool, 0, 'east');
  assert.equal(selection?.length, 13);
  assert.equal(new Set(selection).size, 13);
  assert.ok(selection.every((id) => pool.includes(id)));
});
