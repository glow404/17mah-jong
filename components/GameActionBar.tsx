export function GameActionBar({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      className={`game-action-bar ${disabled ? 'is-disabled' : ''}`}
      role="group"
      aria-label="当前操作"
      aria-disabled={disabled}
    >
      {children}
    </div>
  );
}
