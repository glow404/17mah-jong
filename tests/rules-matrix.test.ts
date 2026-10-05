import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateWin,
  isFuriten,
  isWinningHand,
  limitFor,
  createWall,
  createSeededRandom,
  type LimitTier,
} from '../lib/mahjong';

type YakuCase = {
  name: string;
  hand: number[];
  winningTile: number;
  wind: 'east' | 'west';
  expected: string;
};

const yakuCases: YakuCase[] = [
  {
    name: '断幺九',
    hand: [1, 2, 3, 1, 2, 3, 4, 5, 6, 10, 11, 12, 13],
    winningTile: 13,
    wind: 'east',
    expected: '断幺九',
  },
  {
    name: '混老头',
    hand: [0, 0, 8, 8, 9, 9, 17, 17, 18, 18, 27, 27, 31],
    winningTile: 31,
    wind: 'east',
    expected: '混老头',
  },
  {
    name: '平和',
    hand: [2, 3, 9, 10, 11, 18, 19, 20, 4, 5, 6, 7, 7],
    winningTile: 1,
    wind: 'east',
    expected: '平和',
  },
  {
    name: '一杯口',
    hand: [0, 1, 2, 0, 1, 2, 3, 4, 5, 9, 10, 11, 6],
    winningTile: 6,
    wind: 'east',
    expected: '一杯口',
  },
  {
    name: '三色同顺',
    hand: [27, 27, 27, 0, 1, 2, 9, 10, 11, 18, 19, 20, 31],
    winningTile: 31,
    wind: 'west',
    expected: '三色同顺',
  },
  {
    name: '三色同刻',
    hand: [0, 0, 0, 9, 9, 9, 18, 18, 18, 3, 4, 5, 6],
    winningTile: 6,
    wind: 'east',
    expected: '三色同刻',
  },
  {
    name: '一气通贯',
    hand: [0, 1, 2, 3, 4, 5, 6, 7, 8, 27, 27, 27, 31],
    winningTile: 31,
    wind: 'east',
    expected: '一气通贯',
  },
  {
    name: '三暗刻',
    hand: [0, 0, 0, 9, 9, 9, 27, 27, 27, 1, 2, 3, 31],
    winningTile: 31,
    wind: 'east',
    expected: '三暗刻',
  },
  {
    name: '自风东',
    hand: [27, 27, 27, 0, 1, 2, 9, 10, 11, 18, 19, 20, 31],
    winningTile: 31,
    wind: 'east',
    expected: '自风 东',
  },
  {
    name: '自风西',
    hand: [29, 29, 29, 0, 1, 2, 9, 10, 11, 18, 19, 20, 31],
    winningTile: 31,
    wind: 'west',
    expected: '自风 西',
  },
  {
    name: '役牌白',
    hand: [31, 31, 31, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27],
    winningTile: 27,
    wind: 'east',
    expected: '役牌 白',
  },
  {
    name: '役牌发',
    hand: [32, 32, 32, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27],
    winningTile: 27,
    wind: 'east',
    expected: '役牌 发',
  },
  {
    name: '役牌中',
    hand: [33, 33, 33, 0, 1, 2, 9, 10, 11, 18, 19, 20, 27],
    winningTile: 27,
    wind: 'east',
    expected: '役牌 中',
  },
  {
    name: '混全带幺九',
    hand: [0, 1, 2, 6, 7, 8, 27, 27, 27, 9, 9, 9, 31],
    winningTile: 31,
    wind: 'east',
    expected: '混全带幺九',
  },
  {
    name: '纯全带幺九',
    hand: [0, 1, 2, 6, 7, 8, 9, 10, 11, 15, 16, 17, 8],
    winningTile: 8,
    wind: 'east',
    expected: '纯全带幺九',
  },
  {
    name: '混一色',
    hand: [0, 1, 2, 3, 4, 5, 6, 6, 6, 27, 27, 27, 31],
    winningTile: 31,
    wind: 'east',
    expected: '混一色',
  },
  {
    name: '清一色',
    hand: [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8],
    winningTile: 8,
    wind: 'east',
    expected: '清一色',
  },
  {
    name: '七对子',
    hand: [0, 0, 9, 9, 18, 18, 27, 27, 28, 28, 31, 31, 6],
    winningTile: 6,
    wind: 'west',
    expected: '七对子',
  },
  {
    name: '小三元',
    hand: [31, 31, 31, 32, 32, 32, 33, 33, 0, 1, 2, 9, 10],
    winningTile: 11,
    wind: 'west',
    expected: '小三元',
  },
];

test('已支持普通役种使用表驱动矩阵逐一验证', () => {
  for (const current of yakuCases) {
    const score = evaluateWin(current.hand, current.winningTile, 12, current.wind);
    assert.ok(score, `${current.name} should be a winning hand`);
    assert.ok(score.yaku.includes(current.expected), `${current.name} was not detected`);
  }
});

test('役满矩阵覆盖国士、四暗刻、字一色、绿一色、清老头、四喜和九莲', () => {
  const cases: Array<[string, number[], number, string]> = [
    ['国士无双', [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33], 0, '国士无双'],
    ['四暗刻', [0, 0, 0, 9, 9, 9, 18, 18, 18, 27, 27, 32, 32], 27, '四暗刻'],
    ['字一色', [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 30, 31], 31, '字一色'],
    ['绿一色', [19, 20, 21, 19, 20, 21, 23, 23, 23, 25, 25, 25, 32], 32, '绿一色'],
    ['清老头', [0, 0, 0, 8, 8, 8, 9, 9, 9, 17, 17, 17, 18], 18, '清老头'],
    ['大三元', [31, 31, 31, 32, 32, 32, 33, 33, 33, 0, 1, 2, 27], 27, '大三元'],
    ['小四喜', [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 0, 1, 2], 30, '小四喜'],
    ['大四喜', [27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 30, 0], 0, '大四喜'],
    ['九莲宝灯', [0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8], 0, '九莲宝灯'],
  ];
  for (const [name, hand, winningTile, expected] of cases) {
    const score = evaluateWin(hand, winningTile, 12, 'east');
    assert.equal(score?.tier, '役满', `${name} should be yakuman`);
    assert.ok(score?.yaku.includes(expected), `${name} was not detected`);
  }
});

test('限界分界线覆盖满贯、跳满、倍满、三倍满和役满', () => {
  const cases: Array<[number, number, LimitTier, number]> = [
    [5, 20, '满贯', 1],
    [4, 40, '满贯', 1],
    [3, 70, '满贯', 1],
    [6, 20, '跳满', 1.5],
    [8, 20, '倍满', 2],
    [11, 20, '三倍满', 3],
    [13, 20, '役满', 4],
  ];
  for (const [han, fu, tier, multiplier] of cases) {
    assert.deepEqual(limitFor(han, fu), { tier, multiplier });
  }
});

test('多种合法拆解时选择倍率最高的结果', () => {
  const hand = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 4, 5, 6];
  const score = evaluateWin(hand, 6, 12, 'east');
  assert.ok(score);
  assert.equal(score.tier, '倍满');
  assert.ok(score.yaku.includes('清一色'));
});

test('宝牌、里宝牌与两立直会共同计入番数', () => {
  const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  const withoutUra = evaluateWin(hand, 8, 12, 'east');
  const withUra = evaluateWin(hand, 8, 12, 'east', 8);
  assert.equal(withoutUra?.dora, 0);
  assert.equal(withUra?.uraDora, 2);
  assert.ok(withUra?.yaku.includes('两立直'));
  assert.ok((withUra?.han ?? 0) > (withoutUra?.han ?? 0));
});

test('非法牌数、第五张同牌和非法牌编号不会被判定为和牌', () => {
  const valid = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8];
  assert.equal(isWinningHand(valid), true);
  assert.equal(isWinningHand(valid.slice(0, 13)), false);
  assert.equal(isWinningHand([...valid.slice(0, 13), 0]), false);
  assert.equal(isWinningHand([...valid.slice(0, 13), 34]), false);
  assert.equal(isWinningHand([...valid.slice(0, 13), -1]), false);
});

test('振听状态覆盖永久振听、临时振听和解除条件', () => {
  const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  assert.equal(isFuriten(hand, [8], false), true);
  assert.equal(isFuriten(hand, [], true), true);
  assert.equal(isFuriten(hand, [9], false), false);
  assert.equal(isFuriten(hand, [], false), false);
});

test('固定种子随机牌墙始终是 136 张且不会出现第五张同牌', () => {
  const first = createWall(createSeededRandom(17));
  const second = createWall(createSeededRandom(17));
  assert.deepEqual(first, second);
  for (let seed = 0; seed < 100; seed += 1) {
    const wall = createWall(createSeededRandom(seed));
    assert.equal(wall.length, 136);
    assert.equal(new Set(wall).size, 136);
    const counts = new Map<number, number>();
    for (const physicalTile of wall) {
      const type = Math.floor(physicalTile / 4);
      counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    assert.ok([...counts.values()].every((count) => count <= 4));
  }
});
