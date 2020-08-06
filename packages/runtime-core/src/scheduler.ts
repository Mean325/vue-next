import { ErrorCodes, callWithErrorHandling } from './errorHandling'
import { isArray } from '@vue/shared'

export interface SchedulerJob {
  (): void
  /**
   * unique job id, only present on raw effects, e.g. component render effect
   * 唯一的工作ID，仅在原始效果中显示，例如 组件渲染效果
   */
  id?: number
  /**
   * Indicates this is a watch() callback and is allowed to trigger itself.
   * A watch callback doesn't track its dependencies so if it triggers itself
   * again, it's likely intentional and it is the user's responsibility to
   * perform recursive state mutation that eventually stabilizes.
   */
  cb?: boolean
}

const queue: (SchedulerJob | null)[] = []   // 队列
const postFlushCbs: Function[] = []

// 此方法可以使实例转为一个新的 Promise 对象
// new Promise(resolve => resolve('foo'))
const resolvedPromise: Promise<any> = Promise.resolve() // 已解决的Promise
let currentFlushPromise: Promise<void> | null = null  // 当前正在清空的Promise

let isFlushing = false    // 正在清空
let isFlushPending = false  // 清空准备
let flushIndex = 0    // 清空的序列号
let pendingPostFlushCbs: Function[] | null = null
let pendingPostFlushIndex = 0
let hasPendingPreFlushJobs = false    // 有待处理的预清空工作

const RECURSION_LIMIT = 100   // 递归上限
type CountMap = Map<SchedulerJob | Function, number>

export function nextTick(fn?: () => void): Promise<void> {
  const p = currentFlushPromise || resolvedPromise
  return fn ? p.then(fn) : p
}

// 队列工作
export function queueJob(job: SchedulerJob) {
  // the dedupe search uses the startIndex argument of Array.includes()
  // by default the search index includes the current job that is being run
  // so it cannot recursively trigger itself again.
  // if the job is a watch() callback, the search will start with a +1 index to
  // allow it recursively trigger itself - it is the user's responsibility to
  // ensure it doesn't end up in an infinite loop.
  // 去重搜索默认情况下使用Array.includes（）的startIndex参数，搜索索引包含正在运行的当前作业，因此它无法递归地再次触发自身。
  // 如果作业是watch（）回调，则搜索将从+1索引开始，以允许它递归触发自身-用户有责任确保它不会以无限循环结束。
  if (
    !queue.length ||
    !queue.includes(job, isFlushing && job.cb ? flushIndex + 1 : flushIndex)
  ) {
    // 如果队列为空或者当前清空的序列号之后不包含该工作
    // 则将该工作推入队列中
    queue.push(job)
    // 该工作id小于0,则将"有待处理的预清空工作"置为true
    if ((job.id as number) < 0) hasPendingPreFlushJobs = true
    // 队列清空
    queueFlush()
  }
}

// 使工作无效
export function invalidateJob(job: SchedulerJob) {
  const i = queue.indexOf(job)
  if (i > -1) {
    queue[i] = null
  }
}

// 运行预清空作业
export function runPreflushJobs() {
  // 当有预清空作业时
  if (hasPendingPreFlushJobs) {
    hasPendingPreFlushJobs = false
    for (let job, i = queue.length - 1; i > flushIndex; i--) {
      job = queue[i]
      if (job && (job.id as number) < 0) {
        job()
        queue[i] = null
      }
    }
  }
}

export function queuePostFlushCb(cb: Function | Function[]) {
  if (!isArray(cb)) {
    if (
      !pendingPostFlushCbs ||
      !pendingPostFlushCbs.includes(
        cb,
        (cb as SchedulerJob).cb
          ? pendingPostFlushIndex + 1
          : pendingPostFlushIndex
      )
    ) {
      postFlushCbs.push(cb)
    }
  } else {
    // if cb is an array, it is a component lifecycle hook which can only be
    // triggered by a job, which is already deduped in the main queue, so
    // we can skip dupicate check here to improve perf
    postFlushCbs.push(...cb)
  }
  queueFlush()
}

// 队列清空
function queueFlush() {
  // 当不是清状态且不是清空等待状态时
  if (!isFlushing && !isFlushPending) {
    // "清空等待"状态置为true
    // 清空作业转化为Promise,赋值给"当前清空Promise"
    isFlushPending = true
    currentFlushPromise = resolvedPromise.then(flushJobs)
  }
}

// 
export function flushPostFlushCbs(seen?: CountMap) {
  if (postFlushCbs.length) {
    pendingPostFlushCbs = [...new Set(postFlushCbs)]
    postFlushCbs.length = 0
    if (__DEV__) {
      seen = seen || new Map()
    }
    for (
      pendingPostFlushIndex = 0;
      pendingPostFlushIndex < pendingPostFlushCbs.length;
      pendingPostFlushIndex++
    ) {
      if (__DEV__) {
        checkRecursiveUpdates(seen!, pendingPostFlushCbs[pendingPostFlushIndex])
      }
      pendingPostFlushCbs[pendingPostFlushIndex]()
    }
    pendingPostFlushCbs = null
    pendingPostFlushIndex = 0
  }
}

const getId = (job: SchedulerJob) => (job.id == null ? Infinity : job.id)

// 执行清空工作
function flushJobs(seen?: CountMap) {
  isFlushPending = false
  isFlushing = true
  if (__DEV__) {
    seen = seen || new Map()
  }

  // Sort queue before flush.
  // This ensures that:
  // 1. Components are updated from parent to child. (because parent is always
  //    created before the child so its render effect will have smaller
  //    priority number)
  // 2. If a component is unmounted during a parent component's update,
  //    its update can be skipped.
  // Jobs can never be null before flush starts, since they are only invalidated
  // during execution of another flushed job.
  // 在刷新之前对队列进行排序。
  // 这样可以确保：
  // 1.组件从父级更新为子级。 （因为父级总是在子级之前创建的，因此其渲染效果的优先级编号会较小）
  // 2.如果在上级组件更新期间卸载了某个组件，则可以跳过其更新。
  // 作业在刷新开始之前永远不能为空，因为它们仅在执行另一个刷新作业时才无效。
  queue.sort((a, b) => getId(a!) - getId(b!))

  try {
    // 循环执行队列的清空工作
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex]
      if (job) {
        if (__DEV__) {
          checkRecursiveUpdates(seen!, job)
        }
        callWithErrorHandling(job, null, ErrorCodes.SCHEDULER)
      }
    }
  } finally {
    flushIndex = 0
    queue.length = 0

    flushPostFlushCbs(seen)
    isFlushing = false
    currentFlushPromise = null
    // some postFlushCb queued jobs!
    // keep flushing until it drains.
    if (queue.length || postFlushCbs.length) {
      flushJobs(seen)
    }
  }
}

function checkRecursiveUpdates(seen: CountMap, fn: SchedulerJob | Function) {
  if (!seen.has(fn)) {
    seen.set(fn, 1)
  } else {
    const count = seen.get(fn)!
    if (count > RECURSION_LIMIT) {
      throw new Error(
        `Maximum recursive updates exceeded. ` +
          `This means you have a reactive effect that is mutating its own ` +
          `dependencies and thus recursively triggering itself. Possible sources ` +
          `include component template, render function, updated hook or ` +
          `watcher source function.`
      )
    } else {
      seen.set(fn, count + 1)
    }
  }
}
