import { toDecimal } from './money.js';

// Rank milestone table. `alternatives` are OR-ed leg requirements:
// each alternative means "at least `count` legs with volume >= `volume` each".
// NOTE: rows 7–10 in the shared plan read 1,000,000 / 2,000,000 / 5,000,000 /
// 10,000,000 for the 2-leg option — the progression strongly suggests these
// should be 100,000 / 200,000 / 500,000 / 1,000,000. Values below follow the
// progression; adjust here if the official plan confirms the literal figures.
export const RANK_TABLE = [
  { rank: 1, directs: 2,  reward: '50',    alternatives: [{ count: 2, volume: '1000' }] },
  { rank: 2, directs: 4,  reward: '100',   alternatives: [{ count: 2, volume: '2500' }] },
  { rank: 3, directs: 6,  reward: '200',   alternatives: [{ count: 2, volume: '5000' }] },
  { rank: 4, directs: 10, reward: '400',   alternatives: [{ count: 2, volume: '10000' }, { count: 4, volume: '5000' }] },
  { rank: 5, directs: 20, reward: '750',   alternatives: [{ count: 2, volume: '20000' }, { count: 4, volume: '10000' }] },
  { rank: 6, directs: 30, reward: '2000',  alternatives: [{ count: 2, volume: '50000' }, { count: 4, volume: '25000' }] },
  { rank: 7, directs: 40, reward: '3000',  alternatives: [{ count: 2, volume: '100000' }, { count: 4, volume: '50000' }] },
  { rank: 8, directs: 50, reward: '5000',  alternatives: [{ count: 2, volume: '200000' }, { count: 4, volume: '100000' }] },
  { rank: 9, directs: 50, reward: '10000', alternatives: [{ count: 2, volume: '500000' }, { count: 5, volume: '200000' }] },
  { rank: 10, directs: 50, reward: '20000', alternatives: [{ count: 2, volume: '1000000' }, { count: 5, volume: '400000' }] },
];

// Does a rank qualify given activeDirects and an array of leg volumes (Decimal|number|string)?
// Returns the matched alternative { count, volume, qualifiedLegs } or null.
export function matchRank(rankDef, activeDirects, legVolumes) {
  if (activeDirects < rankDef.directs) return null;

  for (const alt of rankDef.alternatives) {
    const need = toDecimal(alt.volume);
    const qualifiedLegs = legVolumes.filter((v) => toDecimal(v).gte(need));
    if (qualifiedLegs.length >= alt.count) {
      return { ...alt, qualifiedLegs: qualifiedLegs.map((v) => v.toString()) };
    }
  }
  return null;
}
