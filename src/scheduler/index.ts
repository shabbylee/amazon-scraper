import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import type { AppConfig } from '../config.js';
import { listWatches, type WatchRow } from '../db/store.js';
import { executeWatch } from './watch-runner.js';

/**
 * 调度器：进程启动时从 DB 加载所有 active Watch，按 cron_expr 注册定时任务。
 * 见 docs/adr/0005-phase4-persistence-scheduler.md。
 */

export interface Scheduler {
  start(): void;
  stop(): void;
  /** 动态添加/更新一个 Watch 的调度（创建或修改 Watch 后调用）。 */
  scheduleWatch(watch: WatchRow): void;
  /** 取消一个 Watch 的调度（删除或停用时调用）。 */
  unscheduleWatch(watchId: number): void;
  readonly scheduledCount: number;
}

export function createScheduler(config: AppConfig): Scheduler {
  const tasks = new Map<number, ScheduledTask>();
  let running = false;

  function scheduleWatch(watch: WatchRow): void {
    // 先取消旧的
    unscheduleWatch(watch.id);
    if (!watch.active) return;
    if (!cron.validate(watch.cron_expr)) {
      console.warn(`[scheduler] watch ${watch.id}: invalid cron "${watch.cron_expr}", skipping`);
      return;
    }
    const task = cron.schedule(watch.cron_expr, () => {
      if (!running) return;
      console.log(`[scheduler] triggering watch ${watch.id} ("${watch.keyword}")`);
      executeWatch(watch, { config }).catch((err) => {
        console.error(`[scheduler] watch ${watch.id} error:`, err);
      });
    });
    tasks.set(watch.id, task);
  }

  function unscheduleWatch(watchId: number): void {
    const existing = tasks.get(watchId);
    if (existing) {
      existing.stop();
      tasks.delete(watchId);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      const watches = listWatches(true);
      for (const w of watches) scheduleWatch(w);
      console.log(`[scheduler] started with ${watches.length} active watch(es)`);
    },
    stop() {
      running = false;
      for (const [id, task] of tasks) {
        task.stop();
        tasks.delete(id);
      }
      console.log('[scheduler] stopped');
    },
    scheduleWatch,
    unscheduleWatch,
    get scheduledCount() {
      return tasks.size;
    },
  };
}
