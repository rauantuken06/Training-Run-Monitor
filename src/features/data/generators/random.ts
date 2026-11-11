/**
 * Deterministic pseudo-random utilities. Nothing in the data layer may use
 * `Math.random()`: every random value derives from an explicit seed.
 */

/** Root seed of the synthetic dataset. Every run's seed is derived from it. */
export const DATASET_SEED = 20_251_111;

/** A source of uniformly distributed numbers in `[0, 1)`. */
export type Rng = () => number;

/** Mulberry32: small, fast, 32-bit seeded PRNG with good statistical quality for synthetic data. */
export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** 32-bit FNV-1a hash of a string. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Derive a child seed from a parent seed and a key (e.g. a run ID).
 * Keyed by ID rather than position, so reordering the catalog never changes a run's data.
 */
export function deriveSeed(parentSeed: number, key: string): number {
  return (hashString(key) ^ Math.imul(parentSeed >>> 0, 0x9e3779b1)) >>> 0;
}

/** Default clipping bound for normal samples, in standard deviations. */
export const GAUSSIAN_CLIP = 4;

/**
 * Standard normal sampler (Box–Muller), clipped to `±clip` standard deviations.
 *
 * Clipping is deliberate: it guarantees an upper bound on noise, so no
 * accidental outlier can be mistaken for an intended anomaly (e.g. the single
 * spike in the million-point run).
 */
export function createGaussian(rng: Rng, clip = GAUSSIAN_CLIP): () => number {
  let spare: number | null = null;
  const bound = (z: number) => Math.min(clip, Math.max(-clip, z));

  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = rng();
    while (u === 0) u = rng(); // avoid log(0)
    const v = rng();
    const radius = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    spare = bound(radius * Math.sin(angle));
    return bound(radius * Math.cos(angle));
  };
}
