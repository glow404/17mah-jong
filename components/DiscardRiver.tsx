import { MahjongTile } from './MahjongTile';

export function DiscardRiver({ tiles, label = '弃牌区' }: { tiles: number[]; label?: string }) {
  return (
    <div className="battle-river" role="group" aria-label={label}>
      {tiles.map((tile, index) => (
        <MahjongTile tile={tile} small key={`${tile}-${index}`} />
      ))}
    </div>
  );
}
