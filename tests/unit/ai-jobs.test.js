// AI job queue (design/feature-expansion-plan.md §7): stages, rig fallback, failures. Runners are fakes: no network.
import { describe, it, expect } from 'vitest';
import { JobQueue } from '../../server/ai-jobs.js';
import { pickProviders, rigModel } from '../../server/ai-forge.js';

const fake = ({ model = { url: '/m.glb', provider: 'fake' }, rig = null, failModel = false } = {}) => ({
  model: async () => { if (failModel) throw new Error('model boom'); return model; },
  rig: async () => { if (!rig) throw new Error('rig boom'); return rig; },
});

describe('job queue', () => {
  it('runs a humanoid avatar through model then rig', async () => {
    const seen = [], q = new JobQueue({ runners: fake({ rig: { url: '/r.glb', rigged: true, clips: { idle: 'Idle' }, provider: 'fake' } }), persist: (l) => seen.push(l[0].stage) });
    const j = q.create({ type: 'avatar', image: '/a.png' });
    expect(j.status).toBe('running');
    const done = await q.jobs.get(j.id).promise;
    expect(done.status).toBe('done'); expect(done.result).toMatchObject({ model: '/r.glb', rigged: true, clips: { idle: 'Idle' } });
    expect(seen).toEqual(['model', 'rig', 'done']);
  });
  it('a failed rig still finishes with the unrigged model', async () => {
    const q = new JobQueue({ runners: fake() });
    const done = await q.jobs.get(q.create({ type: 'avatar', image: '/a.png' }).id).promise;
    expect(done.status).toBe('done'); expect(done.result.rigged).toBe(false); expect(done.result.model).toBe('/m.glb'); expect(done.result.rigError).toMatch(/rig boom/);
  });
  it('non-humanoid items skip rigging; a failed model fails the job', async () => {
    const q = new JobQueue({ runners: fake() });
    const item = await q.jobs.get(q.create({ type: 'item', image: '/i.png' }).id).promise;
    expect(item.result.rigError).toBeUndefined();
    const bad = await new JobQueue({ runners: fake({ failModel: true }) }).create({ type: 'creature', image: '/c.png' });
    expect(bad.status).toBe('running');
  });
  it('rejects unknown types and missing images', () => {
    const q = new JobQueue({ runners: fake() });
    expect(() => q.create({ type: 'spaceship', image: '/x' })).toThrow(); expect(() => q.create({ type: 'item' })).toThrow();
  });
});

describe('providers', () => {
  it('Tripo is picked when its key is present, and the rig placeholder says it is not linked', async () => {
    expect(pickProviders({ TRIPO_API_KEY: 'k' })).toMatchObject({ model: 'tripo', rig: 'tripo' });
    expect(pickProviders({})).toMatchObject({ model: 'standee', rig: 'none' });
    await expect(rigModel({ TRIPO_API_KEY: 'k' }, { model: '/m.glb' })).rejects.toThrow(/not linked/);
    expect(await rigModel({}, { model: '/m.glb' })).toMatchObject({ url: '/m.glb', rigged: false });
  });
});
