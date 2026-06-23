import { describe, it, expect, beforeEach } from 'vitest';
import { LLMQueue } from '../../queue/llm-queue.js';

describe('LLMQueue', () => {
  let queue;

  beforeEach(() => {
    queue = new LLMQueue({ maxConcurrent: 2, timeoutMs: 1000 });
  });

  it('应该按 FIFO 顺序处理请求', async () => {
    const results = [];
    const mockFn = async (req) => {
      await new Promise(resolve => setTimeout(resolve, 50));
      results.push(req.id);
      return { success: true };
    };

    const promises = [1, 2, 3, 4].map(id =>
      queue.enqueue({ id }, mockFn)
    );

    await Promise.all(promises);
    expect(results).toEqual([1, 2, 3, 4]);
  });

  it('应该限制并发数', async () => {
    let activeCount = 0;
    let maxActive = 0;

    const mockFn = async () => {
      activeCount++;
      maxActive = Math.max(maxActive, activeCount);
      await new Promise(resolve => setTimeout(resolve, 100));
      activeCount--;
      return { success: true };
    };

    const promises = Array.from({ length: 10 }, () =>
      queue.enqueue({}, mockFn)
    );

    await Promise.all(promises);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it('应该处理超时', async () => {
    // Fill both concurrency slots with blocker tasks so the test item stays in queue
    const blocker = async () => {
      await new Promise(resolve => setTimeout(resolve, 3000));
      return { success: true };
    };
    // Don't await — these occupy the 2 concurrent slots
    queue.enqueue({}, blocker);
    queue.enqueue({}, blocker);

    // Give the queue a tick to start processing the blockers
    await new Promise(resolve => setTimeout(resolve, 50));

    // This item should be queued (both slots are full) and timeout after 1000ms
    const slowFn = async () => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { success: true };
    };

    await expect(queue.enqueue({}, slowFn))
      .rejects.toThrow('Request timeout in queue');
  });

  it('应该正确返回队列状态', () => {
    const status = queue.getStatus();
    expect(status).toHaveProperty('pending');
    expect(status).toHaveProperty('active');
    expect(status).toHaveProperty('maxConcurrent');
    expect(status).toHaveProperty('estimatedWaitTime');
  });

  it('应该能清空队列', async () => {
    // Fill slots with blockers
    const blocker = async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return { success: true };
    };
    queue.enqueue({}, blocker).catch(() => {});
    queue.enqueue({}, blocker).catch(() => {});

    await new Promise(resolve => setTimeout(resolve, 50));

    // Enqueue items that will be in the queue
    const pendingPromise = queue.enqueue({}, async () => 'should not run').catch(e => e.message);

    // Clear the queue
    queue.clear();

    const result = await pendingPromise;
    expect(result).toBe('Queue cleared');
    expect(queue.getStatus().pending).toBe(0);
  });
});
