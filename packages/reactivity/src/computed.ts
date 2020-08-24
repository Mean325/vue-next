import { effect, ReactiveEffect, trigger, track } from './effect'
import { TriggerOpTypes, TrackOpTypes } from './operations'
import { Ref } from './ref'
import { isFunction, NOOP } from '@vue/shared'
import { ReactiveFlags } from './reactive'

// 计算字符串,数字,boolean等简单类型
export interface ComputedRef<T = any> extends WritableComputedRef<T> {
  readonly value: T
}

export interface WritableComputedRef<T> extends Ref<T> {
  readonly effect: ReactiveEffect<T>
}

export type ComputedGetter<T> = (ctx?: any) => T    // getter函数别名
export type ComputedSetter<T> = (v: T) => void    // 泛型函数别名

export interface WritableComputedOptions<T> {
  get: ComputedGetter<T>
  set: ComputedSetter<T>
}   // 接口 - 可写计算选项

export function computed<T>(getter: ComputedGetter<T>): ComputedRef<T>
export function computed<T>(
  options: WritableComputedOptions<T>
): WritableComputedRef<T>   // 可写计算选项
export function computed<T>(
  getterOrOptions: ComputedGetter<T> | WritableComputedOptions<T>
) {
  let getter: ComputedGetter<T>
  let setter: ComputedSetter<T>

  // 如果computed中为函数,则赋值给getter; setter设为空
  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions
    setter = __DEV__
      ? () => {
          console.warn('Write operation failed: computed value is readonly')
        }
      : NOOP
  } else {
    // 如果不为函数,则取参数中的get和set
    getter = getterOrOptions.get
    setter = getterOrOptions.set
  }

  let dirty = true
  let value: T
  let computed: ComputedRef<T>

  const runner = effect(getter, {
    lazy: true,   // effect时不触发回调
    scheduler: () => {
      // 通过dirty防止出现内存溢出 ???
      if (!dirty) {
        dirty = true
        trigger(computed, TriggerOpTypes.SET, 'value')
      }
    }
  })
  computed = {
    __v_isRef: true,
    [ReactiveFlags.IS_READONLY]:
      isFunction(getterOrOptions) || !getterOrOptions.set,

    // 暴露effrct，因此computed可以停止
    effect: runner,
    get value() {
      if (dirty) {
        // 在真正的去获取计算属性的value的时候
        // 依据dirty的值决定去不去重新执行getter 获取最新值
        // ???
        value = runner()
        dirty = false
      }
      track(computed, TrackOpTypes.GET, 'value')
      return value
    },
    set value(newValue: T) {
      // 执行空方法,computed不支持set
      setter(newValue)
    }
  } as any
  return computed
}
