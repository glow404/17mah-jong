import { MahjongTile } from './MahjongTile';

export function DiscardRiver({ tiles }: { tiles: number[] }) {
  return (
    <div className="battle-river">
      {tiles.map((tile, index) => (
        <MahjongTile tile={tile} small key={`${tile}-${index}`} />
      ))}
    </div>
  );
}
