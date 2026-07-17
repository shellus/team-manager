import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  SubaccountRegistrationJobStatus,
  SubaccountRegistrationJobView
} from '@team-manager/shared';

const JOB_FILE = 'subaccount-registration-jobs.json';
const COMPLETED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SubaccountRegistrationJobPatch {
  status?: SubaccountRegistrationJobStatus;
  phase?: string;
  message?: string;
  progress?: number;
  email?: string;
  subaccountId?: string;
  completedAt?: number;
  error?: string;
}

export class SubaccountRegistrationJobStore {
  private readonly file: string;
  private readonly tempFile: string;
  private jobs = new Map<string, SubaccountRegistrationJobView>();
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {
    this.file = join(dataDir, JOB_FILE);
    this.tempFile = `${this.file}.tmp`;
  }

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    if (existsSync(this.file)) {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const job = normalizeJob(item);
          if (job) this.jobs.set(job.id, job);
        }
      }
    }

    const now = Date.now();
    let changed = false;
    for (const [id, job] of this.jobs) {
      if (job.status === 'queued' || job.status === 'running') {
        this.jobs.set(id, {
          ...job,
          status: 'interrupted',
          phase: 'registration_interrupted',
          message: '服务重启导致注册任务中断，请重新发起',
          error: 'registration_interrupted_by_server_restart',
          progress: Math.min(job.progress, 99),
          updatedAt: now,
          completedAt: now
        });
        changed = true;
      }
      if (job.completedAt && now - job.completedAt > COMPLETED_RETENTION_MS) {
        this.jobs.delete(id);
        changed = true;
      }
    }
    if (changed) await this.persist();
  }

  list(): SubaccountRegistrationJobView[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map(cloneJob);
  }

  get(id: string): SubaccountRegistrationJobView | undefined {
    const job = this.jobs.get(id);
    return job ? cloneJob(job) : undefined;
  }

  async create(): Promise<SubaccountRegistrationJobView> {
    const now = Date.now();
    const job: SubaccountRegistrationJobView = {
      id: randomUUID(),
      status: 'queued',
      phase: 'registration_queued',
      message: '已加入自动注册队列',
      progress: 0,
      createdAt: now,
      updatedAt: now
    };
    this.jobs.set(job.id, job);
    await this.persist();
    return cloneJob(job);
  }

  async update(id: string, patch: SubaccountRegistrationJobPatch): Promise<SubaccountRegistrationJobView> {
    const current = this.jobs.get(id);
    if (!current) throw new Error(`自动注册任务不存在: ${id}`);
    const next: SubaccountRegistrationJobView = {
      ...current,
      ...patch,
      progress: clampProgress(patch.progress ?? current.progress),
      updatedAt: Date.now()
    };
    this.jobs.set(id, next);
    await this.persist();
    return cloneJob(next);
  }

  private async persist(): Promise<void> {
    const body = JSON.stringify(this.list(), null, 2);
    this.persistQueue = this.persistQueue.then(async () => {
      await writeFile(this.tempFile, body, 'utf8');
      await rename(this.tempFile, this.file);
    });
    await this.persistQueue;
  }
}

function cloneJob(job: SubaccountRegistrationJobView): SubaccountRegistrationJobView {
  return { ...job };
}

function clampProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeJob(value: unknown): SubaccountRegistrationJobView | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<SubaccountRegistrationJobView>;
  if (!record.id || !record.status || !record.phase || !record.message) return undefined;
  return {
    id: record.id,
    status: record.status,
    phase: record.phase,
    message: record.message,
    progress: clampProgress(typeof record.progress === 'number' ? record.progress : 0),
    ...(record.email ? { email: record.email } : {}),
    ...(record.subaccountId ? { subaccountId: record.subaccountId } : {}),
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
    ...(typeof record.completedAt === 'number' ? { completedAt: record.completedAt } : {}),
    ...(record.error ? { error: record.error } : {})
  };
}
