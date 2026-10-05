import type { ReactNode } from 'react';

export function SelectionScreenPage({ children }: { children: ReactNode }) {
  return <div data-screen="selection">{children}</div>;
}
