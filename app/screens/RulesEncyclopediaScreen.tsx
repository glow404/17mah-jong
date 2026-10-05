import type { ReactNode } from 'react';

const YAKU_GROUPS = [
  {
    title: '固定规则与一般役种',
    description: '本项目采用固定两立直开局；下列役种按日本麻将常见定义计算。',
    items: [
      ['两立直', '2 番', '双方第一次舍牌即立直，本规则固定计 2 番。'],
      ['断幺九', '1 番', '和牌中只包含数牌 2～8，不含幺九牌与字牌。'],
      ['平和', '1 番', '四组顺子、非役牌雀头，并以两面听牌荣和。'],
      ['一杯口', '1 番', '门清手牌中有两组完全相同的顺子。'],
      ['对对和', '2 番', '四组刻子或杠子加一组雀头；本项目没有副露或杠牌操作。'],
      ['三暗刻', '2 番', '手牌中有三组暗刻。'],
      ['自风 东 / 西', '1 番', '东家刻子计东风役，西家刻子计西风役。'],
      ['役牌 白 / 发 / 中', '各 1 番', '白、发、中任一组三元牌刻子各计 1 番，可复合。'],
      ['三色同顺', '2 番', '万、筒、索三种花色各有同数值的一组顺子。'],
      ['三色同刻', '2 番', '万、筒、索三种花色各有同数值的一组刻子。'],
      ['一气通贯', '2 番', '同一花色包含 123、456、789 三组顺子。'],
      ['小三元', '2 番', '两组三元牌刻子，另一种三元牌作雀头；役牌番数另计。'],
      ['混全带幺九', '2 番', '每组面子及雀头都含幺九牌或字牌，且手牌含字牌。'],
      ['纯全带幺九', '3 番', '每组面子及雀头都含数牌 1 或 9，且不含字牌。'],
      ['混老头', '2 番', '手牌只由数牌 1、9 与字牌组成；可与对对和等役复合。'],
      ['混一色', '3 番', '只使用一种数牌花色并混有字牌。'],
      ['清一色', '6 番', '只使用一种数牌花色，不含字牌。'],
      ['七对子', '2 番', '由七种不同牌各组成一对；本规则依旧要求总番数达到满贯。'],
    ],
  },
  {
    title: '役满',
    description: '任一役满直接按役满档计分（底分 ×4），多个役满役种会显示在结算明细中。',
    items: [
      ['国士无双', '役满', '十三种幺九牌各一张，另有其中任意一种的重复牌。'],
      ['字一色', '役满', '和牌全部由风牌与三元牌组成。'],
      ['清老头', '役满', '和牌全部由数牌 1 与 9 组成。'],
      ['绿一色', '役满', '和牌全部为二索、三索、四索、六索、八索与发。'],
      ['九莲宝灯', '役满', '同一花色具备 1112345678999 的基础牌形并完成和牌。'],
      ['大三元', '役满', '白、发、中三种牌都组成刻子。'],
      ['大四喜', '役满', '东、南、西、北四种风牌都组成刻子。'],
      ['小四喜', '役满', '三种风牌组成刻子，剩下一种风牌作雀头。'],
      ['四暗刻', '役满', '四组暗刻加雀头；本项目只支持荣和，按引擎规则判定。'],
    ],
  },
] as const;

export function RulesEncyclopediaScreen({
  header,
  onBack,
}: {
  header: ReactNode;
  onBack: () => void;
}) {
  return (
    <main className="game-shell encyclopedia-shell" data-screen="rules">
      {header}
      <section className="encyclopedia-heading">
        <p className="eyebrow">
          <span /> 规则百科
        </p>
        <h1>役种与计分</h1>
        <p>
          这是本项目当前规则引擎实际支持的役种。荣和必须达到满贯；表宝牌与里宝牌会增加番数，但不单独构成和牌资格。
        </p>
        <div className="limit-guide" role="group" aria-label="满贯档位与底分倍数">
          <span>满贯 ×1</span>
          <span>跳满 ×1.5</span>
          <span>倍满 ×2</span>
          <span>三倍满 ×3</span>
          <span>役满 ×4</span>
        </div>
      </section>
      {YAKU_GROUPS.map((group) => (
        <section className="encyclopedia-section" key={group.title}>
          <div className="encyclopedia-section-heading">
            <h2>{group.title}</h2>
            <p>{group.description}</p>
          </div>
          <div className="yaku-grid">
            {group.items.map(([name, han, description]) => (
              <article className="yaku-card" key={name}>
                <div>
                  <h3>{name}</h3>
                  <span>{han}</span>
                </div>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
      ))}
      <section className="encyclopedia-section dora-section">
        <div className="encyclopedia-section-heading">
          <h2>宝牌与里宝牌</h2>
          <p>
            每张与指示牌对应的宝牌各加 1
            番。荣和成立后翻开里宝牌指示牌，再将对应的里宝牌计入本局结算。
          </p>
        </div>
        <p className="variant-note">
          <strong>与标准日麻的差异：</strong>
          本项目为两人定制规则，没有摸牌、自摸、吃碰杠、流局听牌罚符或庄家连庄；双方固定为东家与西家，首巡固定两立直，只能荣和对手舍牌，且低于满贯不能和牌。
        </p>
      </section>
      <div className="encyclopedia-footer">
        <button className="secondary-action" type="button" onClick={onBack}>
          返回牌桌
        </button>
      </div>
    </main>
  );
}
