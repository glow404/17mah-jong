import { useState, type ReactNode } from 'react';

export function OnlineScreen({
  baseScore,
  onBack,
  onCreate,
  onJoin,
  busy,
  error,
  connectionMessage,
  header,
}: {
  baseScore: number;
  onBack: () => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  busy: boolean;
  error: string;
  connectionMessage?: string;
  header: ReactNode;
}) {
  const [code, setCode] = useState('');
  return (
    <main className="game-shell online-shell" data-screen="online">
      {header}
      <section className="online-card">
        <p className="eyebrow">
          <span /> 联机对战
        </p>
        <h2>隔桌，也能听见牌响。</h2>
        <p>创建一个六位房间码发给朋友，或输入对方的房间码加入。双方各自选牌，手牌全程保密。</p>
        <div className="online-options">
          <article>
            <span className="option-number">01</span>
            <h3>创建新房间</h3>
            <p>本局底分 {baseScore.toLocaleString()}，你固定为东家。</p>
            <button
              className="primary-action wide"
              type="button"
              disabled={busy}
              onClick={onCreate}
            >
              {busy ? '正在开桌…' : '创建并等待朋友'} <span>→</span>
            </button>
          </article>
          <div className="or-divider">或</div>
          <article>
            <span className="option-number">02</span>
            <h3>加入朋友房间</h3>
            <input
              value={code}
              onChange={(event) =>
                setCode(
                  event.target.value
                    .toUpperCase()
                    .replace(/[^A-Z0-9]/g, '')
                    .slice(0, 6),
                )
              }
              placeholder="输入 6 位房间码"
              aria-label="房间码"
            />
            <button
              className="secondary-action wide"
              type="button"
              disabled={busy || code.length !== 6}
              onClick={() => onJoin(code)}
            >
              加入房间
            </button>
          </article>
        </div>
        {connectionMessage && (
          <p className="online-error" role="status" aria-live="polite">
            {connectionMessage}
          </p>
        )}
        {error && <p className="online-error">{error}</p>}
        <button className="rules-link" type="button" onClick={onBack}>
          返回首页
        </button>
      </section>
    </main>
  );
}
