// AI job queue (design/feature-expansion-plan.md §7, §8): long generations run as jobs the client polls,
// instead of one HTTP request held open for minutes. A job chains stages server-side:
//   image (already approved) → model → rig → done
// PLACEHOLDER: the model and rig stages go through providers in ai-forge.js. Tripo is reserved (TRIPO_API_KEY) and
// not wired yet; until it is, a job finishes with the standee fallback (model null) and rigged: false, so the
// client keeps using the cut-out standee. Link Tripo in tripoModel() / tripoRig() in ai-forge.js; nothing here changes.
import { randomUUID } from 'node:crypto';

export const JOB_STAGES = ['queued', 'model', 'rig', 'done'];
export const JOB_TYPES = ['creature', 'item', 'avatar'];

/**
 * In-memory job queue with an optional persist hook. Stage runners are injected so tests need no network.
 * runners: { model(job) → { url, provider }, rig(job) → { url, rigged, clips, provider } }
 */
export class JobQueue {
  constructor({ runners, persist = () => {}, now = () => Date.now(), maxJobs = 200 } = {}) {
    Object.assign(this, { runners, persist, now, maxJobs }); this.jobs = new Map();
  }

  /** Starts a job; returns its public view straight away (the work continues in the background). */
  create({ type, image, prompt = '', humanoid = null }) {
    if (!JOB_TYPES.includes(type)) throw new Error(`job type must be one of ${JOB_TYPES.join(', ')}`);
    if (!image) throw new Error('an approved image is required');
    const job = { id: randomUUID(), type, image, prompt: String(prompt).slice(0, 400), humanoid: humanoid ?? type === 'avatar',
      status: 'running', stage: 'queued', progress: 0, error: null, result: null, created: this.now(), updated: this.now() };
    this.jobs.set(job.id, job);
    if (this.jobs.size > this.maxJobs) this.jobs.delete(this.jobs.keys().next().value);
    job.promise = this.run(job);
    return this.view(job);
  }

  async run(job) {
    const step = (stage, progress) => { Object.assign(job, { stage, progress, updated: this.now() }); this.persist(this.list()); };
    try {
      step('model', 0.1);
      const model = await this.runners.model(job);
      job.result = { model: model.url, modelProvider: model.provider, rigged: false, clips: {} };
      if (job.humanoid && model.url) {
        step('rig', 0.6);
        try {
          const rig = await this.runners.rig({ ...job, model: model.url });
          Object.assign(job.result, { model: rig.url || model.url, rigged: !!rig.rigged, clips: rig.clips || {}, rigProvider: rig.provider });
        } catch (e) { job.result.rigError = e.message; } // an unrigged model is still usable (procedural idle)
      }
      Object.assign(job, { status: 'done' }); step('done', 1);
    } catch (e) {
      Object.assign(job, { status: 'failed', error: e.message }); step(job.stage, job.progress);
    }
    return this.view(job);
  }

  get(id) { const j = this.jobs.get(id); return j ? this.view(j) : null; }
  list() { return [...this.jobs.values()].map((j) => this.view(j)); }
  /** Public JSON (no promise). */
  view(j) { const { promise: _p, ...v } = j; return v; }
}
