import { EventEmitter } from 'events';

/**
 * LLM 请求队列管理器
 * 实现 FIFO 队列 + 并发控制 + 超时机制
 */
class LLMQueue extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.queue = [];
    this.activeRequests = 0;
    this.maxConcurrent = options.maxConcurrent || parseInt(process.env.LLM_MAX_CONCURRENT) || 5;
    this.timeoutMs = options.timeoutMs || parseInt(process.env.LLM_REQUEST_TIMEOUT) || 60000;
    this.processing = false;
  }

  /**
   * 将请求加入队列
   * @param {Object} request - LLM 请求参数
   * @param {Function} executeFn - 实际执行 LLM 调用的函数
   * @returns {Promise}
   */
  async enqueue(request, executeFn) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        id: this._generateId(),
        request,
        executeFn,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        position: this.queue.length + 1,
      };

      this.queue.push(queueItem);
      this._updatePositions();
      
      this.emit('enqueued', {
        queueLength: this.queue.length,
        position: queueItem.position,
      });

      // 设置超时
      const timeoutId = setTimeout(() => {
        const index = this.queue.findIndex(item => item.id === queueItem.id);
        if (index !== -1) {
          this.queue.splice(index, 1);
          this._updatePositions();
          reject(new Error('Request timeout in queue'));
          this.emit('timeout', { id: queueItem.id });
        }
      }, this.timeoutMs);

      queueItem.timeoutId = timeoutId;

      // 触发队列处理
      this._processQueue();
    });
  }

  /**
   * 处理队列中的请求
   */
  async _processQueue() {
    if (this.processing) return;
    this.processing = true;

    while (this.activeRequests < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      // 清除超时定时器
      clearTimeout(item.timeoutId);

      this.activeRequests++;
      
      this.emit('processing', {
        id: item.id,
        activeRequests: this.activeRequests,
        queueLength: this.queue.length,
      });

      // 异步执行请求（不阻塞循环）
      this._executeRequest(item);
    }

    this.processing = false;
  }

  /**
   * 执行单个请求
   */
  async _executeRequest(item) {
    const startTime = Date.now();

    try {
      const result = await item.executeFn(item.request);
      
      const duration = Date.now() - startTime;
      this.emit('completed', {
        id: item.id,
        duration,
      });

      item.resolve(result);
    } catch (error) {
      this.emit('failed', {
        id: item.id,
        error: error.message,
      });

      item.reject(error);
    } finally {
      this.activeRequests--;
      this._updatePositions();
      this.emit('status', this.getStatus());
      
      // 继续处理队列
      this._processQueue();
    }
  }

  /**
   * 更新队列中所有项目的位置
   */
  _updatePositions() {
    this.queue.forEach((item, index) => {
      item.position = index + 1;
    });
  }

  /**
   * 生成唯一 ID
   */
  _generateId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取队列状态
   */
  getStatus() {
    return {
      pending: this.queue.length,
      active: this.activeRequests,
      maxConcurrent: this.maxConcurrent,
      estimatedWaitTime: this.queue.length * 5000, // 假设每个请求平均 5 秒
    };
  }

  /**
   * 清空队列
   */
  clear() {
    this.queue.forEach(item => {
      clearTimeout(item.timeoutId);
      item.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    this.emit('cleared');
  }
}

// 创建全局队列实例
const llmQueue = new LLMQueue();

export { LLMQueue, llmQueue };
export default llmQueue;
