import { useState } from 'react';

import { type BackendItem, LAIKA_ASSETS, LAIKA_GROUPS, LAIKA_SERIALIZERS, REPO } from '../data';
import { BackendIcon } from './icons';

function Tile({ it }: { it: BackendItem }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex flex-col gap-2.5 p-[18px] border border-hairline rounded-[13px] bg-surface min-h-[104px] transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-[3px] hover:border-hairline-2 hover:shadow-[0_14px_30px_-18px_rgba(31,38,95,0.4)]"
    >
      <BackendIcon icon={it.icon} size={30} />
      <span className="font-display font-semibold text-[15.5px] mt-auto tracking-[-0.02em] leading-[1.05]">
        {it.name}
      </span>
      <span
        className={'font-mono text-[11px] transition-opacity duration-150 '
          + (hover ? 'opacity-100 text-indigo' : 'opacity-55 text-ink-3')}
      >
        {it.sub}
      </span>
    </div>
  );
}

function Group({
  label,
  via,
  note,
  items,
}: {
  label: string,
  via?: string,
  note: string,
  items: BackendItem[],
}) {
  return (
    <div>
      <div className="mb-[18px]">
        <h3 className="font-display font-semibold text-[20px] flex items-baseline gap-3 flex-wrap tracking-[-0.02em] leading-[1.05]">
          {label}
          {via && (
            <span className="text-xs text-ink-3 font-normal px-[9px] py-[3px] rounded-full border border-hairline-2 bg-surface font-mono">
              {via}
            </span>
          )}
        </h3>
        <p className="mt-2 text-ink-2 text-[14.5px] max-w-[60ch]">{note}</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {items.map(it => <Tile key={it.name} it={it} />)}
      </div>
    </div>
  );
}

export function Backends() {
  return (
    <div className="mt-12 flex flex-col gap-11">
      {LAIKA_GROUPS.map(g => <Group key={g.id} label={g.label} via={g.via} note={g.note} items={g.items} />)}

      <Group
        label="Assets"
        via="a second contract · AssetsRepository"
        note={LAIKA_ASSETS.note}
        items={LAIKA_ASSETS.items}
      />

      <Group
        label="Serializers"
        via="the on-disk format"
        note="Store content as whatever reads best in a diff — independent of the backend."
        items={LAIKA_SERIALIZERS}
      />

      <p className="mt-2 text-[13px] text-ink-3 font-mono">
        Adapters are small.{' '}
        <a className="text-indigo" href={REPO} target="_blank" rel="noreferrer">
          Write one for your store ↗
        </a>
      </p>
    </div>
  );
}
