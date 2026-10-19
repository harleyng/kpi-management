/**
 * A seeded pseudo-random generator (mulberry32) for fixture VALUES only — e.g. how far an actual
 * lands from its target. Same seed, same sequence, so the fixtures are identical on every build.
 * Never used for ids (`ids.ts`) and never at runtime.
 */
export function createPrng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** A number in `[min, max)`. */
    between: (min: number, max: number) => min + (max - min) * next(),
    /** An integer in `[min, max]`. */
    int: (min: number, max: number) => Math.floor(min + (max - min + 1) * next()),
  };
}
