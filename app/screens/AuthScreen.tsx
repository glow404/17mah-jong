import { useState, type FormEvent } from 'react';
import { useAccessibleDialog } from '../hooks/useAccessibleDialog';

export interface AuthUser {
  id: string;
  email: string;
}

export function AuthScreen({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: (user: AuthUser) => void;
}) {
  const dialogRef = useAccessibleDialog<HTMLElement>(onClose);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: mode, email, password }),
      });
      const data = (await response.json()) as { user?: AuthUser; error?: string };
      if (!response.ok || !data.user) throw new Error(data.error || '账号操作失败');
      onSuccess(data.user);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : '账号操作失败');
    } finally {
      setBusy(false);
    }
  };
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
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        aria-describedby="auth-description"
        tabIndex={-1}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭登录">
          ×
        </button>
        <p className="eyebrow">
          <span /> 牌手账号
        </p>
        <h2 id="auth-title">{mode === 'login' ? '登录后联机对战' : '注册新的牌手账号'}</h2>
        <p id="auth-description">电脑对战无需登录。账号仅用于保护你的联机房间与对局身份。</p>
        <form onSubmit={submit}>
          <label>
            邮箱
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </label>
          <label>
            密码
            <input
              type="password"
              required
              minLength={8}
              maxLength={128}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="至少 8 个字符"
            />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="primary-action wide" type="submit" disabled={busy}>
            {busy ? '请稍候…' : mode === 'login' ? '登录并继续' : '注册并继续'} <span>→</span>
          </button>
        </form>
        <button
          className="auth-switch"
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError('');
          }}
        >
          {mode === 'login' ? '还没有账号？立即注册' : '已经有账号？返回登录'}
        </button>
      </section>
    </div>
  );
}
