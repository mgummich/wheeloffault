import { describe, expect, it } from 'vitest';
import { parseRoute } from './route.ts';

describe('parseRoute', () => {
  it('maps hashes to routes', () => {
    expect(parseRoute('')).toEqual({ page: 'home' });
    expect(parseRoute('#/')).toEqual({ page: 'home' });
    expect(parseRoute('#/team/abc')).toEqual({ page: 'spin', teamId: 'abc' });
    expect(parseRoute('#/team/abc/')).toEqual({ page: 'spin', teamId: 'abc' });
    expect(parseRoute('#/team/abc/statistik')).toEqual({ page: 'statistik', teamId: 'abc' });
    expect(parseRoute('#/team/abc/bericht/m1')).toEqual({
      page: 'bericht',
      teamId: 'abc',
      memberId: 'm1',
    });
    expect(parseRoute('#/team/abc/bericht')).toEqual({ page: 'spin', teamId: 'abc' });
    expect(parseRoute('#/team/abc/ziehung/s1')).toEqual({
      page: 'ziehung',
      teamId: 'abc',
      spinId: 's1',
    });
    expect(parseRoute('#/team/abc/unbekannt')).toEqual({ page: 'spin', teamId: 'abc' });
  });
});
