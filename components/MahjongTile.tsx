'use client';

import { tileGlyph, tileLabel, tileText } from '../lib/mahjong';
import type { KeyboardEvent } from 'react';

export function MahjongTile({
  tile,
  physicalId,
  selected,
  hidden,
  small,
  onClick,
  disabled,
  title,
}: {
  tile: number;
  physicalId?: number;
  selected?: boolean;
  hidden?: boolean;
  small?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const label = tileLabel(tile);
  const Tag = onClick ? 'button' : 'span';
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      !onClick ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)
    )
      return;
    const buttons = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
        'button.game-tile:not(:disabled)',
      ) ?? [],
    );
    if (buttons.length < 2) return;
    const currentIndex = buttons.indexOf(event.currentTarget);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (currentIndex +
              (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) +
              buttons.length) %
            buttons.length;
    event.preventDefault();
    buttons[nextIndex]?.focus();
  };
  return (
    <Tag
      className={`game-tile ${label.kind} ${small ? 'is-small' : ''} ${selected ? 'is-selected' : ''} ${hidden ? 'is-hidden' : ''}`}
      onClick={onClick}
      onKeyDown={onClick ? handleKeyDown : undefined}
      disabled={disabled}
      type={onClick ? 'button' : undefined}
      title={title ?? (hidden ? '暗牌' : tileText(tile))}
      aria-label={hidden ? '暗牌' : tileText(tile)}
      aria-pressed={onClick ? Boolean(selected) : undefined}
      aria-hidden={hidden && !onClick ? true : undefined}
      role={onClick ? undefined : hidden ? 'presentation' : 'img'}
      data-id={physicalId}
    >
      {hidden ? (
        <span className="tile-back-mark">雀</span>
      ) : (
        <span className="mahjong-symbol" aria-hidden="true">
          {tileGlyph(tile)}
        </span>
      )}
    </Tag>
  );
}
