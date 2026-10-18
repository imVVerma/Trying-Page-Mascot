import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { downloadSingleSticker, type StickerItem } from '../utils/stickerSlicer';

interface StickerPackProps {
  stickers: StickerItem[];
  isLoading: boolean;
  isZipping: boolean;
  onDownloadAll: () => void;
}

type Filter = 'all' | 'direction' | 'reaction';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'direction', label: 'Angles' },
  { id: 'reaction', label: 'Reactions' },
];

export function StickerPack({
  stickers,
  isLoading,
  isZipping,
  onDownloadAll,
}: StickerPackProps) {
  const [filter, setFilter] = useState<Filter>('all');

  const visible =
    filter === 'all' ? stickers : stickers.filter((s) => s.type === filter);

  return (
    <>
      <div className="sticker-toolbar">
        <div className="filter-group" role="group" aria-label="Filter stickers">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`filter-chip ${filter === f.id ? 'active' : ''}`}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
            >
              {f.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className="primary-button small"
          onClick={onDownloadAll}
          disabled={isZipping || stickers.length === 0}
        >
          {isZipping ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Download size={15} />
          )}
          <span>{isZipping ? 'Packing…' : 'Download all'}</span>
        </button>
      </div>

      {isLoading ? (
        <div className="empty-state">
          <Loader2 size={22} className="spin" />
          <span>Preparing your stickers…</span>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <span>Your stickers will appear here.</span>
        </div>
      ) : (
        <ul className="sticker-grid">
          {visible.map((sticker) => (
            <li key={sticker.id} className="sticker">
              <button
                type="button"
                className="sticker-image"
                onClick={() => downloadSingleSticker(sticker)}
                title={`Download ${sticker.label}`}
                aria-label={`Download ${sticker.label}`}
              >
                <img src={sticker.dataUrl} alt={sticker.label} decoding="async" />
              </button>
              <span className="sticker-label">{sticker.label}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
