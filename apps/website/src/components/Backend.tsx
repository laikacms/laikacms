import { BackendIcon, type BackendIconSpec } from './BackendIcon';

export interface BackendItem {
  name: string;
  sub: string;
  icon: BackendIconSpec;
}

/* The subtitle lights up on hover — a `group-hover` rule, no React state. */
export function Backend({ name, sub, icon }: BackendItem) {
  return (
    <div className="group flex flex-col gap-2.5 p-[18px] border border-hairline rounded-[13px] bg-surface min-h-[104px] transition-[transform,box-shadow,border-color] duration-150 hover:-translate-y-[3px] hover:border-hairline-2 hover:shadow-[0_14px_30px_-18px_rgba(31,38,95,0.4)]">
      <BackendIcon icon={icon} size={30} />
      <span className="font-display font-semibold text-[15.5px] mt-auto tracking-[-0.02em] leading-[1.05]">
        {name}
      </span>
      <span className="font-mono text-[11px] transition-opacity duration-150 opacity-55 text-ink-3 group-hover:opacity-100 group-hover:text-indigo">
        {sub}
      </span>
    </div>
  );
}
