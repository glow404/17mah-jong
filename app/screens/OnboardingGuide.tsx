import { useState } from 'react';
import { useAccessibleDialog } from '../hooks/useAccessibleDialog';

const STEPS = [
  {
    title: '每局从 34 张牌开始',
    text: '你和对手各拿到 34 张牌，从中选出 13 张组成已经听牌的固定手牌。可以用鼠标点击，也可以 Tab 到牌面后用方向键移动、Enter 或空格选择。',
  },
  {
    title: '达到满贯才可以荣和',
    text: '牌局公开表宝牌指示。第一次舍牌是两立直；只有对手打出你的等待牌，且计分达到满贯或更高时，才能荣和。',
  },
  {
    title: '从 21 张储备牌中选择舍牌',
    text: '选牌后剩下的 21 张就是你的舍牌池，每一巡都可以自由选择其中一张打出。游戏不摸牌，也不能自摸。',
  },
  {
    title: '留意振听与 17 巡流局',
    text: '自己的弃牌包含等待牌会永久振听；放弃一次荣和会进入临时振听。双方各打满 17 张仍无人和牌则流局。键盘快捷键：? 打开规则，M 静音，R 荣和，P 放弃。',
  },
] as const;

export function OnboardingGuide({
  onClose,
  onRules,
}: {
  onClose: () => void;
  onRules: () => void;
}) {
  const [step, setStep] = useState(0);
  const dialogRef = useAccessibleDialog<HTMLElement>(onClose);
  const current = STEPS[step];

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="onboarding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-description"
        tabIndex={-1}
      >
        <div
          className="onboarding-progress"
          role="img"
          aria-label={`第 ${step + 1} 步，共 ${STEPS.length} 步`}
        >
          {STEPS.map((item, index) => (
            <span
              key={item.title}
              className={index <= step ? 'is-current' : ''}
              aria-hidden="true"
            />
          ))}
        </div>
        <p className="eyebrow">
          <span /> 新手引导 · {step + 1}/{STEPS.length}
        </p>
        <h2 id="onboarding-title">{current.title}</h2>
        <p id="onboarding-description">{current.text}</p>
        <div className="onboarding-actions">
          <button className="rules-link" type="button" onClick={onClose}>
            跳过引导
          </button>
          <button className="secondary-action" type="button" onClick={onRules}>
            查看规则百科
          </button>
          {step > 0 && (
            <button type="button" className="secondary-action" onClick={() => setStep(step - 1)}>
              上一步
            </button>
          )}
          <button
            type="button"
            className="primary-action"
            onClick={() => (step === STEPS.length - 1 ? onClose() : setStep(step + 1))}
          >
            {step === STEPS.length - 1 ? '开始体验' : '下一步'} <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </div>
  );
}
