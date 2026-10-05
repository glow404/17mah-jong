export function GameActionBar({
  children,
  disabled = false,
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className={`game-action-bar ${disabled ? 'is-disabled' : ''}`} aria-disabled={disabled}>
      {children}
    </div>
  );
}
