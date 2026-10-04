/**
 * 麻将规则库的回归测试。
 *
 * 测试重点覆盖本项目特有的宝牌循环、满贯起胡、役满识别、振听以及
 * Unicode 麻将牌图案，防止修改 lib/mahjong.ts 时破坏核心玩法。
 */
import assert from "node:assert/strict";
import test from "node:test";
import { doraFromIndicator, evaluateWin, isFuriten, tileGlyph, waitTypes } from "../lib/mahjong";

test("宝牌指示牌按数牌、风牌和三元牌循环", () => {
  assert.equal(doraFromIndicator(8), 0);
  assert.equal(doraFromIndicator(30), 27);
  assert.equal(doraFromIndicator(33), 31);
});

test("国士无双十三面听按役满结算并触发舍牌振听", () => {
  const hand = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];
  assert.equal(waitTypes(hand).length, 13);
  assert.equal(evaluateWin(hand, 0, 1, "east")?.tier, "役满");
  assert.equal(isFuriten(hand, [0], false), true);
});

test("清一色复合牌型达到三倍满", () => {
  const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  const score = evaluateWin(hand, 8, 12, "east");
  assert.equal(score?.tier, "三倍满");
  assert.ok((score?.han ?? 0) >= 11);
});

test("临时振听会阻止任何荣和", () => {
  const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  assert.equal(isFuriten(hand, [], true), true);
});

test("牌面使用麻将图案字符并在和牌后计算里宝牌", () => {
  assert.equal(tileGlyph(0), "🀇");
  assert.equal(tileGlyph(9), "🀙");
  assert.equal(tileGlyph(18), "🀐");
  const hand = [0, 1, 2, 0, 1, 2, 3, 4, 5, 6, 7, 8, 8];
  const withoutUra = evaluateWin(hand, 8, 12, "east");
  const withUra = evaluateWin(hand, 8, 12, "east", 8);
  assert.ok((withUra?.han ?? 0) > (withoutUra?.han ?? 0));
  assert.equal(withUra?.uraDora, 2);
});
