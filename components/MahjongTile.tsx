'use client';

import { tileGlyph, tileLabel, tileText } from '../lib/mahjong';

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
  return (
    <Tag
      className={`game-tile ${label.kind} ${small ? 'is-small' : ''} ${selected ? 'is-selected' : ''} ${hidden ? 'is-hidden' : ''}`}
      onClick={onClick}
      disabled={disabled}
      type={onClick ? 'button' : undefined}
      title={title ?? (hidden ? '暗牌' : tileText(tile))}
      aria-label={hidden ? '暗牌' : tileText(tile)}
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
