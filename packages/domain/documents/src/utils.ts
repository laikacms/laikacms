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
