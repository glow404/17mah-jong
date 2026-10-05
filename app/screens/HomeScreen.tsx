import type { ReactNode } from 'react';

export function HomeScreen({ children }: { children: ReactNode }) {
  return <div data-screen="home">{children}</div>;
}
