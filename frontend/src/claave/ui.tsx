import React from 'react';

export function Pill({
  active,
  children,
  onClick
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 10px',
        borderRadius: 999,
        border: '1px solid rgba(255,255,255,0.12)',
        background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.05)',
        fontWeight: 800,
        fontSize: 12
      }}
    >
      {children}
    </button>
  );
}

export function SmallLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, opacity: 0.7 }}>{children}</div>;
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, opacity: 0.72, marginTop: 4 }}>{children}</div>;
}

export function AmountChips({
  values,
  onPick
}: {
  values: string[];
  onPick: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
      {values.map((v) => (
        <button key={v} onClick={() => onPick(v)} style={{ padding: '6px 10px', borderRadius: 999, fontSize: 12 }}>
          {v}
        </button>
      ))}
    </div>
  );
}
