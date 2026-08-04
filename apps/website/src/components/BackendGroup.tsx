import { Backend, type BackendItem } from './Backend';

export interface BackendGroupData {
  /** Present only on the numbered `content/backends/*` groups; the ordering key. */
  id?: string;
  label: string;
  via?: string;
  note: string;
  items: BackendItem[];
}

export function BackendGroup({ label, via, note, items }: Omit<BackendGroupData, 'id'>) {
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
        {items.map(it => <Backend key={it.name} name={it.name} sub={it.sub} icon={it.icon} />)}
      </div>
    </div>
  );
}
