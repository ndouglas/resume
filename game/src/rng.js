// Seeded PRNG (mulberry32) so runs and tests are reproducible.
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(items, weight) {
      const total = items.reduce((sum, x) => sum + weight(x), 0);
      let r = next() * total;
      for (const x of items) {
        r -= weight(x);
        if (r < 0) return x;
      }
      return items[items.length - 1];
    },
  };
}
