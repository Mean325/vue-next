import {
  RootNode,
  NodeTypes,
  TemplateChildNode,
  SimpleExpressionNode,
  ElementTypes,
  PlainElementNode,
  ComponentNode,
  TemplateNode,
  ElementNode,
  VNodeCall,
  ParentNode
} from '../ast'
import { TransformContext } from '../transform'
import { PatchFlags, isString, isSymbol } from '@vue/shared'
import { isSlotOutlet, findProp } from '../utils'

// 提升静态节点
export function hoistStatic(root: RootNode, context: TransformContext) {
  walk(
    root,
    context,
    new Map(),
    // Root node is unfortunately non-hoistable due to potential parent
    // fallthrough attributes.
    isSingleElementRoot(root, root.children[0])
  )
}

// 是否为单元素节点
// 子节点只有一个,且为元素节点,且不是插槽插座
export function isSingleElementRoot(
  root: RootNode,
  child: TemplateChildNode
): child is PlainElementNode | ComponentNode | TemplateNode {
  const { children } = root
  return (
    children.length === 1 &&
    child.type === NodeTypes.ELEMENT &&
    !isSlotOutlet(child)
  )
}

// 静态类别枚举
const enum StaticType {
  NOT_STATIC = 0,   // 不静态
  FULL_STATIC,    // 全静态
  HAS_RUNTIME_CONSTANT  // 有运行常数 
}

// 运行???
function walk(
  node: ParentNode,
  context: TransformContext,
  resultCache: Map<TemplateChildNode, StaticType>,  // 结果缓存
  doNotHoistNode: boolean = false   // 不提升节点
) {
  let hasHoistedNode = false  // 是否有提升的节点
  // Some transforms, e.g. transformAssetUrls from @vue/compiler-sfc, replaces
  // static bindings with expressions. These expressions are guaranteed to be
  // constant so they are still eligible for hoisting, but they are only
  // available at runtime and therefore cannot be evaluated ahead of time.
  // This is only a concern for pre-stringification (via transformHoist by
  // @vue/compiler-dom), but doing it here allows us to perform only one full
  // walk of the AST and allow `stringifyStatic` to stop walking as soon as its
  // stringficiation threshold is met.
  // 一些转换，例如 @ vue / compiler-sfc中的transformAssetUrls用表达式替换静态绑定。
  // 这些表达式被保证是恒定的，因此它们仍然可以提升，但是它们仅在运行时可用，因此无法提前进行评估。
  // 这只是预字符串化的一个问题（通过transformHoist by @ vue / compiler-dom），但是在这里这样做
  // 只能让我们执行一次AST的完整遍历，并允许`stringifyStatic`在达到其字符串化阈值后立即停止行走。???
  let hasRuntimeConstant = false  // 是否有运行常数 

  const { children } = node   // 获取子节点列表
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    // only plain elements & text calls are eligible for hoisting.
    // 只有普通元素和文本调用才能进行提升

    // 当子节点为元素节点时
    if (
      child.type === NodeTypes.ELEMENT &&
      child.tagType === ElementTypes.ELEMENT
    ) {
      let staticType    // 静态类型
      // 如果不提升节点且静态类型大于0
      if (
        !doNotHoistNode &&
        (staticType = getStaticType(child, resultCache)) > 0
      ) {
        // 有运行常数时
        if (staticType === StaticType.HAS_RUNTIME_CONSTANT) {
          hasRuntimeConstant = true
        }
        // 整棵树是静态的
        // <div>good job!</div>转化为_createVNode("div", null, "good job!", -1 /* HOISTED */)
        ;(child.codegenNode as VNodeCall).patchFlag =
          PatchFlags.HOISTED + (__DEV__ ? ` /* HOISTED */` : ``)
        child.codegenNode = context.hoist(child.codegenNode!)   // 调用context中自带的提升方法
        hasHoistedNode = true
        continue
      } else {
        // node may contain dynamic children, but its props may be eligible for
        // hoisting.
        // 节点可能包含动态子节点，但它的props可能静态提升。
        const codegenNode = child.codegenNode!
        // 编辑节点类型为静态节点时
        if (codegenNode.type === NodeTypes.VNODE_CALL) {
          const flag = getPatchFlag(codegenNode)    // 获取patchFlag的十进制
          if (
            // 如果
            // 没有patchFlag
            // 或flag===512 (如 ref 或 指令 (onVnodeXXX的事件钩子)
            // 或flag===1 (具有动态文本的元素)
            (!flag ||
              flag === PatchFlags.NEED_PATCH ||
              flag === PatchFlags.TEXT) &&
            // 且没有动态Key和Ref
            !hasDynamicKeyOrRef(child) &&
            // 且没有缓存的props时
            !hasCachedProps(child)
          ) {
            const props = getNodeProps(child)   // 获取节点的props
            if (props) {
              codegenNode.props = context.hoist(props)   // 调用context中自带的提升方法
            }
          }
        }
      }
    } else if (child.type === NodeTypes.TEXT_CALL) {
      // 当子节点为文本调用时
      const staticType = getStaticType(child.content, resultCache)
      // 如果静态类型大于0
      if (staticType > 0) {
        // 有运行常数时
        if (staticType === StaticType.HAS_RUNTIME_CONSTANT) {
          hasRuntimeConstant = true
        }
        child.codegenNode = context.hoist(child.codegenNode)   // 调用context中自带的提升方法
        hasHoistedNode = true
      }
    }

    // walk further
    // 走的更远???
    if (child.type === NodeTypes.ELEMENT) {
      walk(child, context, resultCache)
    } else if (child.type === NodeTypes.FOR) {
      // Do not hoist v-for single child because it has to be a block
      // 不要提升v-for的单个子节点，因为它必须是一个块
      walk(child, context, resultCache, child.children.length === 1)
    } else if (child.type === NodeTypes.IF) {
      for (let i = 0; i < child.branches.length; i++) {
        // Do not hoist v-if single child because it has to be a block
        // 不要提升v-if的单个子节点，因为它必须是一个块
        walk(
          child.branches[i],
          context,
          resultCache,
          child.branches[i].children.length === 1
        )
      }
    }
  }

  // 如果没有运行常数且没有提升的节点且transformHoist事件钩子不为空
  if (!hasRuntimeConstant && hasHoistedNode && context.transformHoist) {
    context.transformHoist(children, context, node)   // 转换需要转换的节点
  }
}

// 获取静态类型
export function getStaticType(
  node: TemplateChildNode | SimpleExpressionNode,   // 节点
  resultCache: Map<TemplateChildNode, StaticType> = new Map()   // 结果缓存
): StaticType {
  // 如果节点的类型
  switch (node.type) {
    // 为元素节点时
    case NodeTypes.ELEMENT:
      // 如果不为元素节点时(如组件,slot,模板)
      // 返回静态类型为0,即为非静态
      if (node.tagType !== ElementTypes.ELEMENT) {
        return StaticType.NOT_STATIC
      }

      const cached = resultCache.get(node)
      // 如果缓存中有当前"节点"的缓存,则返回缓存
      if (cached !== undefined) {
        return cached
      }

      const codegenNode = node.codegenNode!
      // 当编译节点类型不为静态节点时
      // 返回静态类型为0,即为非静态
      if (codegenNode.type !== NodeTypes.VNODE_CALL) {
        return StaticType.NOT_STATIC
      }

      const flag = getPatchFlag(codegenNode)
      // 当当前节点的patchFlag为空,且没有动态key和ref,且没有缓存的props时
      if (!flag && !hasDynamicKeyOrRef(node) && !hasCachedProps(node)) {
        // 元素自身是静态的,检查它的子节点。
        let returnType = StaticType.FULL_STATIC   // 返回静态类型为1,即为全静态
        
        // 循环子节点
        for (let i = 0; i < node.children.length; i++) {
          const childType = getStaticType(node.children[i], resultCache)
          if (childType === StaticType.NOT_STATIC) {
            // 如果子节点静态类型为非静态时
            // 缓存中增加该节点
            // 并返回静态类型为0,即为非静态
            resultCache.set(node, StaticType.NOT_STATIC)
            return StaticType.NOT_STATIC
          } else if (childType === StaticType.HAS_RUNTIME_CONSTANT) {
            // 如果子节点静态类型为运行时为常量时
            // 并返回静态类型为2,即运行时为常量???
            returnType = StaticType.HAS_RUNTIME_CONSTANT
          }
        }

        // 检查任何props是否包含运行时常量
        if (returnType !== StaticType.HAS_RUNTIME_CONSTANT) {
          for (let i = 0; i < node.props.length; i++) {
            const p = node.props[i]
            if (
              p.type === NodeTypes.DIRECTIVE &&   // props类型为Vue指令
              p.name === 'bind' &&    // props名为bind
              p.exp &&    // ???
              (p.exp.type === NodeTypes.COMPOUND_EXPRESSION ||
                p.exp.isRuntimeConstant)  // props.exp类型为复合表达式或者运行时为常量
            ) {
              returnType = StaticType.HAS_RUNTIME_CONSTANT  // 返回静态类型为2,即运行时为常量
            }
          }
        }

        // only svg/foreignObject could be block here, however if they are
        // stati then they don't need to be blocks since there will be no
        // nested updates.
        // 只有svg / foreignObject可以在此处被阻止
        // 但是如果它们是stati，那么它们就不需要成为块，因为不会有嵌套的更新。
        if (codegenNode.isBlock) {
          codegenNode.isBlock = false
        }

        resultCache.set(node, returnType)   // 缓存中增加该节点
        return returnType
      } else {
        // 如果元素本身是动态的
        resultCache.set(node, StaticType.NOT_STATIC)   // 缓存中增加该节点
        return StaticType.NOT_STATIC    // 返回静态类型为0,即非静态
      }
    // 为文本节点, 注释节点时,返回静态类型为1,即全静态
    case NodeTypes.TEXT:
    case NodeTypes.COMMENT:
      return StaticType.FULL_STATIC
    // 为if,for, if分支指令时,返回静态类型为0,即非静态
    case NodeTypes.IF:
    case NodeTypes.FOR:
    case NodeTypes.IF_BRANCH:
      return StaticType.NOT_STATIC
    // 为双花插值{{ }}, 文本调用时, ???
    case NodeTypes.INTERPOLATION:
    case NodeTypes.TEXT_CALL:
      return getStaticType(node.content, resultCache)
    // 为简单表达式时
    case NodeTypes.SIMPLE_EXPRESSION:
      return node.isConstant
        ? node.isRuntimeConstant
          ? StaticType.HAS_RUNTIME_CONSTANT
          : StaticType.FULL_STATIC
        : StaticType.NOT_STATIC
    // 为复合表达式时
    case NodeTypes.COMPOUND_EXPRESSION:
      let returnType = StaticType.FULL_STATIC
      // 循环子节点
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        // 子节点为字符串或symbol时
        if (isString(child) || isSymbol(child)) {
          continue
        }
        const childType = getStaticType(child, resultCache)   // 获取子节点静态类型
        if (childType === StaticType.NOT_STATIC) {
          // 如果子节点静态类型为0,即非静态
          // 则返回非静态
          return StaticType.NOT_STATIC
        } else if (childType === StaticType.HAS_RUNTIME_CONSTANT) {
          // 如果子节点静态类型为2,即运行时为常量
          // 则返回运行时为常量
          returnType = StaticType.HAS_RUNTIME_CONSTANT
        }
      }
      return returnType
    // 默认返回非静态
    default:
      if (__DEV__) {
        const exhaustiveCheck: never = node
        exhaustiveCheck
      }
      return StaticType.NOT_STATIC
  }
}

// 是否有动态KeyOrRef???
function hasDynamicKeyOrRef(node: ElementNode): boolean {
  return !!(findProp(node, 'key', true) || findProp(node, 'ref', true))
}

// 是否有缓存的props???
function hasCachedProps(node: PlainElementNode): boolean {
  if (__BROWSER__) {
    return false
  }
  const props = getNodeProps(node)
  if (props && props.type === NodeTypes.JS_OBJECT_EXPRESSION) {
    const { properties } = props
    for (let i = 0; i < properties.length; i++) {
      const val = properties[i].value
      if (val.type === NodeTypes.JS_CACHE_EXPRESSION) {
        return true
      }
      // merged event handlers
      if (
        val.type === NodeTypes.JS_ARRAY_EXPRESSION &&
        val.elements.some(
          e => !isString(e) && e.type === NodeTypes.JS_CACHE_EXPRESSION
        )
      ) {
        return true
      }
    }
  }
  return false
}

// 获取节点的props???
function getNodeProps(node: PlainElementNode) {
  const codegenNode = node.codegenNode!
  if (codegenNode.type === NodeTypes.VNODE_CALL) {
    return codegenNode.props
  }
}

// 获取patchFlag的十进制
function getPatchFlag(node: VNodeCall): number | undefined {
  const flag = node.patchFlag
  return flag ? parseInt(flag, 10) : undefined
}
