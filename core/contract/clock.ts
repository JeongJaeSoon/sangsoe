// Every timestamp the core writes comes from an injected Clock (R-11); views take `now` as input.
export type Clock = () => string;

export const systemClock: Clock = () => new Date().toISOString();

export function fixedClock(start: string, stepMs = 0): Clock {
  let t = Date.parse(start);
  return () => {
    const out = new Date(t).toISOString();
    t += stepMs;
    return out;
  };
}
