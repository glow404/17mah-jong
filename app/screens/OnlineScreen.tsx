import type { ReactNode } from 'react';

export function OnlineScreen({ children }: { children: ReactNode }) {
  return <div data-screen="online">{children}</div>;
}
