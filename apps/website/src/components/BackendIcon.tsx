import { GenericIcon } from './icons';

/* `si`  — a simple-icons slug, served (brand-coloured) from cdn.simpleicons.org.
   `svg` — one of the local generic glyphs keyed in icons.tsx.
   `img` — a bundled logo under public/assets/backends/<name>.svg, for brands
           simple-icons doesn't carry (e.g. the Amazon/Microsoft marks, Hygraph). */
export type BackendIconSpec = { si: string } | { svg: string } | { img: string };

/* Fifteen of the wall's brand colours are ink-dark — GitHub's #181717, Vercel's
   black, SQLite's navy — and vanish against a dark card. Each maps to a stand-in
   that clears 4.5:1 on the dark surface: white for the marks whose owners
   already publish an inverse (the achromatic ones), and the brand hue lightened
   toward white for the rest, so the wall keeps its colour instead of going
   monochrome. Anything absent from this map already clears 3:1 as shipped and is
   served unchanged in both themes.

   The lookup is by slug for `si` and by filename for `img`; the two namespaces
   are disjoint today, and an overlap would only pick the same treatment twice.

   Recompute when the palette moves: measure each brand colour against the dark
   `--color-surface` in styles.css and re-derive anything that lands under 3:1. */
const ON_DARK: Record<string, string> = {
  // achromatic marks — these brands publish a white logo of their own
  github: 'ffffff',
  markdown: 'ffffff',
  notion: 'ffffff',
  planetscale: 'ffffff',
  vercel: 'ffffff',
  sanity: 'ffffff',
  aws: 'ffffff',
  hygraph: 'ffffff',
  // dark chromatic marks — the brand hue, lightened until it reads
  algolia: '547dff',
  bitbucket: '4c86db',
  trello: '4c86db',
  cloudinary: '717fd6',
  sqlite: '698b9c',
  solid: '7087a6',
  obsidian: '9b69f1',
};

const IMG = 'block w-[30px] h-[30px] object-contain';

/* Both variants are rendered and CSS picks one. Swapping `src` on a theme change
   would mean hydrating every tile on the wall; a second <img> costs one small
   SVG for the fifteen brands that need it, and nothing for the rest. */
export function BackendIcon({ icon, size = 28 }: { icon: BackendIconSpec, size?: number }) {
  if ('svg' in icon) {
    return (
      <span className="inline-grid place-items-center w-8 h-8 text-accent">
        <GenericIcon name={icon.svg} />
      </span>
    );
  }

  const local = 'img' in icon;
  const name = local ? icon.img : icon.si;
  const src = local ? `/assets/backends/${name}.svg` : `https://cdn.simpleicons.org/${name}`;
  /* A local file has no colour parameter, so its dark variant is a sibling
     asset; a simple-icons URL takes the colour as a path segment. */
  const onDark = ON_DARK[name] === undefined
    ? undefined
    : local
    ? `/assets/backends/${name}-dark.svg`
    : `https://cdn.simpleicons.org/${name}/${ON_DARK[name]}`;

  return (
    <span className="inline-grid place-items-center w-8 h-8">
      <img
        src={src}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        className={onDark ? `${IMG} dark:hidden` : IMG}
      />
      {onDark !== undefined && (
        <img
          src={onDark}
          width={size}
          height={size}
          alt=""
          loading="lazy"
          className={`${IMG} hidden dark:block`}
        />
      )}
    </span>
  );
}
