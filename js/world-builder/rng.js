// ═══════════════════════════════════════════════════════════════
// RNG - Seeded pseudo-random number generator
// ═══════════════════════════════════════════════════════════════

/**
 * Hash string to 32-bit integer (djb2 algorithm)
 * @param {string} str - String to hash
 * @returns {number} - 32-bit unsigned integer
 */
export function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 PRNG - Fast, good distribution, 32-bit state
 * Same seed always produces the same sequence
 *
 * @param {number|string} seed - Seed value (number or string)
 * @returns {function} - Returns random float [0, 1)
 *
 * @example
 * const rng = createRNG('weekly-challenge');
 * console.log(rng()); // Always same value for same seed
 */
export function createRNG(seed) {
  let state = typeof seed === 'string' ? hashString(seed) : (seed | 0);

  // Ensure non-zero state
  if (state === 0) state = 1;

  return function() {
    state |= 0;
    state = state + 0x6D2B79F5 | 0;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * RNG helper with common operations
 * Wraps base RNG with convenient methods
 *
 * @param {function} rng - Base RNG function from createRNG()
 * @returns {object} - Helper object with utility methods
 *
 * @example
 * const rng = createRNGHelper(createRNG(12345));
 * rng.int(1, 10);     // Random integer 1-10
 * rng.chance(0.5);    // 50% chance returns true
 * rng.pick(['a','b']); // Random element
 */
export function createRNGHelper(rng) {
  return {
    /** Raw random [0, 1) */
    random: rng,

    /** Integer in range [min, max] inclusive */
    int(min, max) {
      return min + Math.floor(rng() * (max - min + 1));
    },

    /** Float in range [min, max) */
    float(min, max) {
      return min + rng() * (max - min);
    },

    /** Boolean with probability p (0-1) */
    chance(p) {
      return rng() < p;
    },

    /** Pick random element from array */
    pick(array) {
      if (!array || array.length === 0) return undefined;
      return array[Math.floor(rng() * array.length)];
    },

    /** Pick N random elements from array (no duplicates) */
    pickN(array, n) {
      if (!array || array.length === 0) return [];
      const copy = [...array];
      const result = [];
      const count = Math.min(n, copy.length);
      for (let i = 0; i < count; i++) {
        const idx = Math.floor(rng() * copy.length);
        result.push(copy.splice(idx, 1)[0]);
      }
      return result;
    },

    /** Shuffle array in place (Fisher-Yates) */
    shuffle(array) {
      for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
      }
      return array;
    },

    /** Weighted random selection */
    weighted(options) {
      // options: [{ value: any, weight: number }, ...]
      const total = options.reduce((sum, opt) => sum + opt.weight, 0);
      let r = rng() * total;
      for (const opt of options) {
        r -= opt.weight;
        if (r <= 0) return opt.value;
      }
      return options[options.length - 1].value;
    }
  };
}

/**
 * Create a seeded RNG helper in one call
 * @param {number|string|null} seed - Seed (null = use Date.now())
 * @returns {object} - RNG helper object
 */
export function createSeededRNG(seed = null) {
  const actualSeed = seed ?? Date.now();
  return createRNGHelper(createRNG(actualSeed));
}
