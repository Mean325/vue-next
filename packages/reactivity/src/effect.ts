import { TrackOpTypes, TriggerOpTypes } from './operations'
import { EMPTY_OBJ, isArray } from '@vue/shared'

// The main WeakMap that stores {target -> key -> dep} connections.
// Conceptually, it's easier to think of a dependency as a Dep class
// which maintains a Set of subscribers, but we simply store them as
// raw Sets to reduce memory overhead.
type Dep = Set<ReactiveEffect>
type KeyToDepMap = Map<any, Dep>
const targetMap = new WeakMap<any, KeyToDepMap>()

export interface ReactiveEffect<T = any> {
  (): T
  _isEffect: true
  id: number
  active: boolean
  raw: () => T
  deps: Array<Dep>
  options: ReactiveEffectOptions
}

export interface ReactiveEffectOptions {
  lazy?: boolean
  scheduler?: (job: ReactiveEffect) => void
  onTrack?: (event: DebuggerEvent) => void
  onTrigger?: (event: DebuggerEvent) => void
  onStop?: () => void
}

export type DebuggerEvent = {
  effect: ReactiveEffect
  target: object
  type: TrackOpTypes | TriggerOpTypes
  key: any
} & DebuggerEventExtraInfo

export interface DebuggerEventExtraInfo {
  newValue?: any
  oldValue?: any
  oldTarget?: Map<any, any> | Set<any>
}

const effectStack: ReactiveEffect[] = []
let activeEffect: ReactiveEffect | undefined

export const ITERATE_KEY = Symbol(__DEV__ ? 'iterate' : '')
export const MAP_KEY_ITERATE_KEY = Symbol(__DEV__ ? 'Map key iterate' : '')

// 标记是否被effect过
export function isEffect(fn: any): fn is ReactiveEffect {
  return fn && fn._isEffect === true
}

// 在trigger, computed中调用
export function effect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions = EMPTY_OBJ
): ReactiveEffect<T> {
  if (isEffect(fn)) {
    // 如果fn被effect过,则返回取raw保存的原始值
    fn = fn.raw
  }
  const effect = createReactiveEffect(fn, options)
  if (!options.lazy) {
    // 当选项中不为lazy时,则立即执行effect
    // 比如配置为lazy的有,computed ???
    effect()
  }
  return effect
}

export function stop(effect: ReactiveEffect) {
  if (effect.active) {
    cleanup(effect)
    if (effect.options.onStop) {
      effect.options.onStop()
    }
    effect.active = false
  }
}

let uid = 0

// 创建响应的effect
// 在effect中调用
function createReactiveEffect<T = any>(
  fn: () => T,
  options: ReactiveEffectOptions
): ReactiveEffect<T> {
  const effect = function reactiveEffect(): unknown {
    // 刚执行完 createReactiveEffect 时, active = true
    if (!effect.active) {
      // ???
      return options.scheduler ? undefined : fn()
    }
    if (!effectStack.includes(effect)) {
      // 如果effect栈中没有该effect
      // 将 effect.deps 清空
      cleanup(effect)
      try {
        // ???
        // effect栈中推入当前的effect
        // activeEffeft赋值为当前的effect
        // 执行effect回调
        enableTracking()
        effectStack.push(effect)
        activeEffect = effect
        return fn()
      } finally {
        // effect栈中推出当前的effect
        // ???
        // activeEffeft赋值为effect栈中最后一个
        effectStack.pop()
        resetTracking()
        activeEffect = effectStack[effectStack.length - 1]
      }
    }
  } as ReactiveEffect
  // id: 递增的唯一标识符
  // _isEffect: 是否有经历过 effect
	// raw：effect 参数函数fn
	// active: 如果是 !active 会在 run 中执行 return fn(...args);
	// deps: 在 track 时收集的dep，
	//   dep 就是在追踪列表中对应的 key
	//   即 targetMap.get(target).get(key)
	// options：参数
  effect.id = uid++
  effect._isEffect = true
  effect.active = true
  effect.raw = fn
  effect.deps = []
  effect.options = options
  return effect
}

// 将 effect.deps 清空
function cleanup(effect: ReactiveEffect) {
  const { deps } = effect
  if (deps.length) {
    for (let i = 0; i < deps.length; i++) {
      deps[i].delete(effect)
    }
    deps.length = 0
  }
}

let shouldTrack = true
// 追踪合集
const trackStack: boolean[] = []

export function pauseTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = false
}

export function enableTracking() {
  trackStack.push(shouldTrack)
  shouldTrack = true
}

export function resetTracking() {
  const last = trackStack.pop()
  shouldTrack = last === undefined ? true : last
}

// 追踪
// 在 computed、reactive（Proxy-> createGetter）、ref 中被调用???
export function track(target: object, type: TrackOpTypes, key: unknown) {
  if (!shouldTrack || activeEffect === undefined) {
    // 如果在执行 effect 方法的时候 options 没有传入 lazy = true, 那会立即执行 effect。
    // 在经过effect之后 activeEffect 会被赋值为 reactiveEffect的effect变量
    // 如果没有被 effect 过，activeEffect 就会 === undefined
    // 而且 shouldTrack 默认为 true
    return
  }
  // 获取目标的依赖map
  let depsMap = targetMap.get(target)
  if (!depsMap) {
    // 如果没有被追踪, 依赖Map赋值为map
    // targetMap中添加以target为key,依赖Map为value的对
    targetMap.set(target, (depsMap = new Map()))
  }

  let dep = depsMap.get(key)
  if (!dep) {
    // 如果没有获取到dep，说明 target.key 并没有被追踪
    // 此时就在 depsMap 中塞一个值
    depsMap.set(key, (dep = new Set()))
  }
  if (!dep.has(activeEffect)) {
    // 如果dep中没有当前effect,
    // dep中添加该effect
    // 该effect的deps中添加dep
    dep.add(activeEffect)
    activeEffect.deps.push(dep)
    if (__DEV__ && activeEffect.options.onTrack) {
      activeEffect.options.onTrack({
        effect: activeEffect,
        target,
        type,
        key
      })
    }
  }
}

export function trigger(
  target: object,
  type: TriggerOpTypes,
  key?: unknown,
  newValue?: unknown,
  oldValue?: unknown,
  oldTarget?: Map<unknown, unknown> | Set<unknown>
) {
  // 获取目标的依赖map
  const depsMap = targetMap.get(target)
  if (!depsMap) {
    // 如果没有被追踪过
    return
  }

  const effects = new Set<ReactiveEffect>()   // 需要执行的effect合集
  // 将 effectsToAdd 数组中的值添加到effect合集中
  const add = (effectsToAdd: Set<ReactiveEffect> | undefined) => {
    if (effectsToAdd) {
      effectsToAdd.forEach(effect => effects.add(effect))
    }
  }

  if (type === TriggerOpTypes.CLEAR) {
    // 集合为clear时,触发目标的所有effect
    depsMap.forEach(add)
  } else if (key === 'length' && isArray(target)) {
    // 当key为length且目标为数组时
    depsMap.forEach((dep, key) => {
      // 当依赖的key为length或者大于新的值时
      // 即当trigger为数组修改长度时,将key为length的依赖和大于新的length长度的依赖添加到effect合集中
      if (key === 'length' || key >= (newValue as number)) {
        add(dep)
      }
    })
  } else {
    // schedule运行为 SET | ADD | DELETE时
    if (key !== void 0) {
      // 当key不为underfind时,添加该key所对应的依赖到effect合集中
      add(depsMap.get(key))
    }
    // also run for iteration key on ADD | DELETE | Map.SET
    // ???

    // 当触发类型为add或者不是delete的删除时
    const isAddOrDelete =
      type === TriggerOpTypes.ADD ||
      (type === TriggerOpTypes.DELETE && !isArray(target))
    if (
      isAddOrDelete ||
      (type === TriggerOpTypes.SET && target instanceof Map)
    ) {
      // 或目标为map,触发类型为set时
      // 当触发类型为数组的add时, 将key为length的依赖添加到effect合集中
      // 当为???
      add(depsMap.get(isArray(target) ? 'length' : ITERATE_KEY))
    }
    // ???
    if (isAddOrDelete && target instanceof Map) {
      add(depsMap.get(MAP_KEY_ITERATE_KEY))
    }
  }

  const run = (effect: ReactiveEffect) => {
    // ???
    if (__DEV__ && effect.options.onTrigger) {
      effect.options.onTrigger({
        effect,
        target,
        key,
        type,
        newValue,
        oldValue,
        oldTarget
      })
    }
    // 调用effect
    if (effect.options.scheduler) {
      // 如果配置中有scheduler,则使用scheduler调用effect
      // 出现在computed中
      effect.options.scheduler(effect)
    } else {
      // 否则直接调用effect
      effect()
    }
  }

  // 循环触发effect合集中的effect
  effects.forEach(run)
}
