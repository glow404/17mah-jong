import type { ReactNode } from 'react';

export function ResultScreen({ children }: { children: ReactNode }) {
  return <div data-screen="result">{children}</div>;
}
