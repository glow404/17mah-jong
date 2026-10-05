import type { ReactNode } from 'react';

export function TableScreen({ children }: { children: ReactNode }) {
  return <div data-screen="table">{children}</div>;
}
