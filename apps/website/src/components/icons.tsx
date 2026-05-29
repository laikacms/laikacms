import { useState, type ReactNode } from 'react';

import type { BackendIconSpec, GenericSvgKey } from '../data';

interface IconProps {
  d: ReactNode;
  size?: number;
  stroke?: number;
  fill?: string;
  viewBox?: string;
  className?: string;
}

export const Icon = ({
  d,
  size = 18,
  stroke = 1.8,
  fill = 'none',
  viewBox = '0 0 24 24',
  className,
}: IconProps) => (
  <svg
    className={className ?? 'inline-block shrink-0'}
    width={size}
    height={size}
    viewBox={viewBox}
    fill={fill}
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d}
  </svg>
);

export const IconGitHub = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="block">
    <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.6v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.8 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 5 18.3 5.3 18.3 5.3c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.5-2.7 5.5-5.3 5.8.4.4.8 1.1.8 2.2v3.3c0 .4.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5Z" />
  </svg>
);

export const IconArrow = ({ size = 17 }: { size?: number }) => (
  <Icon
    size={size}
    d={
      <>
        <path d="M5 12h14" />
        <path d="m13 6 6 6-6 6" />
      </>
    }
  />
);

export const IconArrowUpRight = ({ size = 16 }: { size?: number }) => (
  <Icon
    size={size}
    d={
      <>
        <path d="M7 17 17 7" />
        <path d="M8 7h9v9" />
      </>
    }
  />
);

export const IconCopy = ({ size = 16 }: { size?: number }) => (
  <Icon
    size={size}
    stroke={1.7}
    d={
      <>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M5 15V5a2 2 0 0 1 2-2h10" />
      </>
    }
  />
);

export const IconCheck = ({ size = 16 }: { size?: number }) => (
  <Icon size={size} d={<path d="m5 13 4 4L19 7" />} />
);

export const IconBolt = ({ size = 16 }: { size?: number }) => (
  <Icon size={size} d={<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />} />
);

export const IconSwap = ({ size = 17 }: { size?: number }) => (
  <Icon
    size={size}
    d={
      <>
        <path d="M7 4 3 8l4 4" />
        <path d="M3 8h13a4 4 0 0 1 4 4" />
        <path d="m17 20 4-4-4-4" />
        <path d="M21 16H8a4 4 0 0 1-4-4" />
      </>
    }
  />
);

export const IconGlobe = ({ size = 17 }: { size?: number }) => (
  <Icon
    size={size}
    stroke={1.7}
    d={
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18" />
        <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
      </>
    }
  />
);

export const IconCube = ({ size = 17 }: { size?: number }) => (
  <Icon
    size={size}
    stroke={1.7}
    d={
      <>
        <path d="M12 2 21 7v10l-9 5-9-5V7l9-5Z" />
        <path d="m3 7 9 5 9-5" />
        <path d="M12 12v10" />
      </>
    }
  />
);

export const IconBook = ({ size = 17 }: { size?: number }) => (
  <Icon
    size={size}
    stroke={1.7}
    d={
      <>
        <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5Z" />
        <path d="M4 4.5A2.5 2.5 0 0 0 6.5 7H20" />
      </>
    }
  />
);

export const IconScales = ({ size = 17 }: { size?: number }) => (
  <Icon
    size={size}
    stroke={1.7}
    d={
      <>
        <path d="M12 3v18" />
        <path d="M7 21h10" />
        <path d="m5 7 14-2" />
        <path d="m5 7-3 7a3 3 0 0 0 6 0Z" />
        <path d="m19 5-3 7a3 3 0 0 0 6 0Z" />
      </>
    }
  />
);

export const IconSpark = ({ size = 17 }: { size?: number }) => (
  <Icon
    size={size}
    d={<path d="M12 3c.5 4 1.5 5 5.5 5.5C13.5 9 12.5 10 12 14c-.5-4-1.5-5-5.5-5.5C10.5 8 11.5 7 12 3Z" />}
  />
);

export const IconPlug = ({ size = 17 }: { size?: number }) => (
  <Icon
    size={size}
    stroke={1.7}
    d={
      <>
        <path d="M9 2v6M15 2v6" />
        <path d="M7 8h10v3a5 5 0 0 1-10 0Z" />
        <path d="M12 16v6" />
      </>
    }
  />
);

const GENERIC: Record<GenericSvgKey, ReactNode> = {
  folder: (
    <Icon
      size={26}
      stroke={1.6}
      d={<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />}
    />
  ),
  braces: (
    <Icon
      size={26}
      stroke={1.6}
      d={
        <>
          <path d="M8 4c-2 0-2 2-2 4s0 3-2 4c2 1 2 2 2 4s0 4 2 4" />
          <path d="M16 4c2 0 2 2 2 4s0 3 2 4c-2 1-2 2-2 4s0 4-2 4" />
        </>
      }
    />
  ),
  yaml: (
    <Icon
      size={26}
      stroke={1.6}
      d={
        <>
          <path d="M5 4h14v16H5z" fill="none" />
          <path d="M8 9h5M8 12h8M8 15h6" />
        </>
      }
    />
  ),
  file: (
    <Icon
      size={26}
      stroke={1.6}
      d={
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4" />
        </>
      }
    />
  ),
};

const BICON = 'inline-grid place-items-center w-8 h-8';

export function BackendIcon({ icon, size = 28 }: { icon: BackendIconSpec; size?: number }) {
  const [failed, setFailed] = useState(false);
  if ('svg' in icon) {
    return <span className={`${BICON} text-indigo`}>{GENERIC[icon.svg]}</span>;
  }
  if (failed) {
    return (
      <span
        className={`inline-grid place-items-center w-[30px] h-[30px] rounded-md bg-indigo-tint text-indigo text-xs font-semibold font-mono`}
      >
        {icon.si.slice(0, 2)}
      </span>
    );
  }
  return (
    <span className={BICON}>
      <img
        src={`https://cdn.simpleicons.org/${icon.si}`}
        width={size}
        height={size}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className="block w-[30px] h-[30px] object-contain"
      />
    </span>
  );
}

export const Logo = ({ height = 30 }: { height?: number }) => (
  <span className="inline-flex items-center gap-[11px]">
    <img
      src="/assets/laika-icon.png"
      alt=""
      width={height}
      height={height}
      className="rounded-full block"
    />
    <span
      className="font-display font-semibold tracking-[-0.02em] text-ink"
      style={{ fontSize: height * 0.7 }}
    >
      Laika<span className="text-indigo">CMS</span>
    </span>
  </span>
);
