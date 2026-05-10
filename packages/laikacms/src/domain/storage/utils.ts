export const pathToSegments = (path: string) => {
  const segments = path
    .split('/')
    .map(x => x.trim())
    .filter(x => x.length > 0);
  return segments;
};

export const pathCombine = (...segments: string[]) => {
  const path = segments
    .map(x => x.trim())
    .filter(x => x.length > 0)
    .join('/');
  return path;
};

export const basename = (path: string) => {
  if (typeof path !== 'string') return '';

  if (path.length === 0) return '';

  // Remove trailing separators
  let end = path.length - 1;
  while (end > 0 && (path[end] === '/' || path[end] === '\\')) end--;

  // If path is all separators like "/" or "\\\\" -> return single separator
  if (end === 0 && (path[0] === '/' || path[0] === '\\')) return path[0];

  // Find last separator before the basename
  let start = end;
  while (start >= 0 && path[start] !== '/' && path[start] !== '\\') start--;

  return path.slice(start + 1, end + 1);
};

export const extension = (path: string) => {
  const base = basename(path);
  const lastDotIndex = base.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === 0) {
    return '';
  }
  return base.slice(lastDotIndex + 1);
};
