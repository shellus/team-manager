import type { ReactNode } from 'react';

export function SensitiveText({ masked, children }: { masked: boolean; children: ReactNode }) {
  return (
    <span className={masked ? 'sensitive-text sensitive-text-masked' : 'sensitive-text'}>
      {children}
    </span>
  );
}
