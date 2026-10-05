import type { ReactNode } from 'react';

export function AuthScreen({ children }: { children: ReactNode }) {
  return <div data-screen="auth">{children}</div>;
}
