import { adapterIconSrc } from '../data/adapters';
import { GenericIcon } from './icons';

/* `adapter` — the key of an adapter Laika ships (repo-root adapters.yaml); uses that adapter's
             own logo, the same one the docs show, with its dark variant in dark mode.
   `si`  — a simple-icons slug, served (brand-coloured) from cdn.simpleicons.org.
   `svg` — one of the local generic glyphs keyed in icons.tsx.
   `img` — a bundled logo under public/assets/backends/<name>.svg, for brands
           simple-icons doesn't carry (e.g. the Amazon/Microsoft marks, Hygraph). */
export type BackendIconSpec = { adapter: string } | { si: string } | { svg: string } | { img: string };

export function BackendIcon({ icon, size = 28 }: { icon: BackendIconSpec, size?: number }) {
  if ('svg' in icon) {
    return (
      <span className="inline-grid place-items-center w-8 h-8 text-indigo">
        <GenericIcon name={icon.svg} />
      </span>
    );
  }
  const img = (src: string, className = '') => (
    <img
      src={src}
      width={size}
      height={size}
      alt=""
      loading="lazy"
      className={`block w-[30px] h-[30px] object-contain ${className}`}
    />
  );
  if ('adapter' in icon) {
    const { light, dark } = adapterIconSrc(icon.adapter);
    return (
      <span className="inline-grid place-items-center w-8 h-8">
        {img(light, 'dark:hidden')}
        {img(dark, 'hidden dark:block')}
      </span>
    );
  }
  const src = 'img' in icon ? `/assets/backends/${icon.img}.svg` : `https://cdn.simpleicons.org/${icon.si}`;
  return <span className="inline-grid place-items-center w-8 h-8">{img(src)}</span>;
}
