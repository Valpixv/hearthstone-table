// Only the standard set can be rolled: d7, d9 and the like are refused with a readable message.
import { describe, it, expect } from 'vitest';
import { standardOnly } from '../../src/ui/DiceTray.js';
import * as P from '../../src/rules/dicePool.js';

describe('standard dice only', () => {
  it('accepts every standard die', () => { expect(() => standardOnly(P.parse('1d4+1d6+1d8+1d10+1d12+1d20+1d100'))).not.toThrow(); });
  it('refuses a d7 and names it', () => { expect(() => standardOnly(P.parse('1d7'))).toThrow(/d7/); });
  it('refuses a mixed pool with a d9', () => { expect(() => standardOnly(P.parse('2d6+3d9'))).toThrow(/d9/); });
});
