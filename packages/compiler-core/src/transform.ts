import { TransformOptions } from './options'
import {
  RootNode,
  NodeTypes,
  ParentNode,
  TemplateChildNode,
  ElementNode,
  DirectiveNode,
  Property,
  ExpressionNode,
  createSimpleExpression,
  JSChildNode,
  SimpleExpressionNode,
  ElementTypes,
  CacheExpression,
  createCacheExpression,
  TemplateLiteral,
  createVNodeCall
} from './ast'
import {
  isString,
  isArray,
  NOOP,
  PatchFlags,
  PatchFlagNames
} from '@vue/shared'
import { defaultOnError } from './errors'
import {
  TO_DISPLAY_STRING,
  FRAGMENT,
  helperNameMap,
  CREATE_BLOCK,
  CREATE_COMMENT,
  OPEN_BLOCK
} from './runtimeHelpers'
import { isVSlot } from './utils'
import { hoistStatic, isSingleElementRoot } from './transforms/hoistStatic'

// There are two types of transforms:
// 有两种类型的转换：
// - NodeTransform:
//   Transforms that operate directly on a ChildNode. NodeTransforms may mutate,
//   replace or remove the node being processed.
// - 节点转换：
// 直接在ChildNode上运行的转换。 NodeTransforms可能会变异，替换或删除正在处理的节点。
export type NodeTransform = (
  node: RootNode | TemplateChildNode,
  context: TransformContext
) => void | (() => void) | (() => void)[]

// - DirectiveTransform:
//   Transforms that handles a single directive attribute on an element.
//   It translates the raw directive into actual props for the VNode.
// - 指令转换：
// 处理元素上单个指令属性的转换。
// 将原始指令转换为VNode的实际道具。
export type DirectiveTransform = (
  dir: DirectiveNode,
  node: ElementNode,
  context: TransformContext,
  // a platform specific compiler can import the base transform and augment
  // it by passing in this optional argument.
  augmentor?: (ret: DirectiveTransformResult) => DirectiveTransformResult
) => DirectiveTransformResult

// 指令转换结果
export interface DirectiveTransformResult {
  props: Property[]
  needRuntime?: boolean | symbol
  ssrTagParts?: TemplateLiteral['elements']
}

// A structural directive transform is a technically a NodeTransform;
// Only v-if and v-for fall into this category.
// 从结构上来讲，结构化指令转换是一个NodeTransform；
// 只有v-if和v-for属于此类别。
export type StructuralDirectiveTransform = (
  node: ElementNode,
  dir: DirectiveNode,
  context: TransformContext
) => void | (() => void)

export interface ImportItem {
  exp: string | ExpressionNode
  path: string
}

export interface TransformContext extends Required<TransformOptions> {
  root: RootNode
  helpers: Set<symbol>  // 创建 VNode 的函数名称的Symbol集合
  components: Set<string>
  directives: Set<string>   // vue指令
  hoists: (JSChildNode | null)[]  // 静态节点
  imports: Set<ImportItem>
  temps: number
  cached: number
  identifiers: { [name: string]: number | undefined }
  scopes: {
    vFor: number
    vSlot: number
    vPre: number
    vOnce: number
  }
  parent: ParentNode | null
  childIndex: number    // 子节点数量
  currentNode: RootNode | TemplateChildNode | null  // 当前节点
  helper<T extends symbol>(name: T): T
  helperString(name: symbol): string
  replaceNode(node: TemplateChildNode): void
  removeNode(node?: TemplateChildNode): void
  onNodeRemoved(): void
  addIdentifiers(exp: ExpressionNode | string): void
  removeIdentifiers(exp: ExpressionNode | string): void
  hoist(exp: JSChildNode): SimpleExpressionNode
  cache<T extends JSChildNode>(exp: T, isVNode?: boolean): CacheExpression | T
}

export function createTransformContext(
  root: RootNode,
  {
    prefixIdentifiers = false,  // 代码转化方式,此处为function
    hoistStatic = false,  // 静态节点提升
    cacheHandlers = false,  // 事件缓存
    nodeTransforms = [],  // 节点转换??
    directiveTransforms = {},  // 指令转换??
    transformHoist = null,
    isBuiltInComponent = NOOP,
    isCustomElement = NOOP,
    expressionPlugins = [],
    scopeId = null,
    ssr = false,
    ssrCssVars = ``,
    bindingMetadata = {},
    onError = defaultOnError
  }: TransformOptions
): TransformContext {
  const context: TransformContext = {
    // options

    // 代码生成	
    // 如 {{ foo }} 在 module 模式下生成的代码为 _ctx.foo，而在 function 模式下是 with (this) { ... }。	
    // 因为在 module 模式下，默认为严格模式，不能使用 with 语句
    prefixIdentifiers,

    // 是否开启静态节点提升	
    // 当该值为true时，静态节点将被提升到 render() 函数外面生成，并被命名为 _hoisted_x 变量	
    // 如"一个文本节点"生成的代码为 const _hoisted_2 = /*#__PURE__*/_createTextVNode(" 一个文本节点 ")
    // 每次渲染时候被不停的复用，这样就免去了重复的创建节点，大型应用会受益于这个改动，免去了重复的创建操作，优化了运行时候的内存占用
    hoistStatic,

    // 是否开启事件缓存, 如@click="foo" 默认编译为 { onClick: foo }	
    // 如果该值为true时，则编译为{ onClick: _cache[0] || (_cache[0] = e => _ctx.foo(e)) }
    // 使用cacheHandlers，在第一次渲染时会自动生成一个内联的函数，在内联函数里面引用当前的fn，
    // 然后把内联函数cache起来，后续的更新会从缓存中读同一个函数，因为是同一个函数，也就没有追踪变化的必要，
    // 这样把node变成了静态的。手写的内联函数也会被cache起来，这样就会避免一些没必要的更新
    cacheHandlers,
    nodeTransforms,
    directiveTransforms,
    transformHoist,
    isBuiltInComponent,
    isCustomElement,
    expressionPlugins,
    scopeId,
    
    // 当有大量静态的内容时候，这些内容会被当做纯字符串推进一个buffer里面，即使存在动态的绑定
    // 例如会通过模板插值嵌入进去。这样会比通过虚拟dom来渲染的快上很多很多
    ssr,
    ssrCssVars,
    bindingMetadata,
    onError,

    // state
    root,
    helpers: new Set(),   // 创建 VNode 的函数名称的Symbol集合
    components: new Set(),
    directives: new Set(),
    hoists: [],   // 静态节点
    imports: new Set(),
    temps: 0,
    cached: 0,
    identifiers: Object.create(null),
    scopes: {
      vFor: 0,
      vSlot: 0,
      vPre: 0,
      vOnce: 0
    },
    parent: null,
    currentNode: root,
    childIndex: 0,

    // methods

    // 添加函数名称的Symbol至数组中
    helper(name) {
      context.helpers.add(name)
      return name
    },
    // 返回以"_"开头的函数名
    helperString(name) {
      return `_${helperNameMap[context.helper(name)]}`
    },
    // 替换节点???
    replaceNode(node) {
      /* istanbul ignore if */
      if (__DEV__) {
        if (!context.currentNode) {
          throw new Error(`Node being replaced is already removed.`)
        }
        if (!context.parent) {
          throw new Error(`Cannot replace root node.`)
        }
      }
      // 此处的"!"表示一定有值，不为 undefined
      context.parent!.children[context.childIndex] = context.currentNode = node
    },
    // 移除节点
    removeNode(node) {
      if (__DEV__ && !context.parent) {
        throw new Error(`Cannot remove root node.`)
      }
      const list = context.parent!.children
      // 如果node不为空则取children中的序号, 没有值且当前节点不为空,则取子节点序号,否则为-1
      const removalIndex = node
        ? list.indexOf(node)
        : context.currentNode
          ? context.childIndex
          : -1
      /* istanbul ignore if */
      if (__DEV__ && removalIndex < 0) {
        throw new Error(`node being removed is not a child of current parent`)
      }
      // 节点为空或操作的是当前节点时
      // 当天节点置为null, 调用onNodeRemoved函数
      if (!node || node === context.currentNode) {
        // 当前节点删除
        context.currentNode = null
        context.onNodeRemoved()
      } else {
        // 兄弟节点删除
        if (context.childIndex > removalIndex) {
          context.childIndex--
          context.onNodeRemoved()
        }
      }
      // 子节点列表中删除该序号的节点
      context.parent!.children.splice(removalIndex, 1)
    },
    onNodeRemoved: () => {},
    // 添加标识符???
    addIdentifiers(exp) {
      // identifier tracking only happens in non-browser builds.
      // 标识符跟踪仅在非浏览器版本中发生。
      if (!__BROWSER__) {
        if (isString(exp)) {
          addId(exp)
        } else if (exp.identifiers) {
          exp.identifiers.forEach(addId)
        } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          addId(exp.content)
        }
      }
    },
    // 移除标识符???
    removeIdentifiers(exp) {
      if (!__BROWSER__) {
        if (isString(exp)) {
          removeId(exp)
        } else if (exp.identifiers) {
          exp.identifiers.forEach(removeId)
        } else if (exp.type === NodeTypes.SIMPLE_EXPRESSION) {
          removeId(exp.content)
        }
      }
    },
    // 提升静态节点操作
    // 在./transforms/hoistStatic.ts中调用
    hoist(exp) {
      context.hoists.push(exp)
      const identifier = createSimpleExpression(
        `_hoisted_${context.hoists.length}`,
        false,
        exp.loc,
        true
      )
      identifier.hoisted = exp
      return identifier
    },
    // 事件缓存???
    cache(exp, isVNode = false) {
      return createCacheExpression(++context.cached, exp, isVNode)
    }
  }

  // 添加标识
  function addId(id: string) {
    const { identifiers } = context
    if (identifiers[id] === undefined) {
      identifiers[id] = 0
    }
    identifiers[id]!++
  }

  // 移除标识
  function removeId(id: string) {
    context.identifiers[id]!--
  }

  return context
}

// 转换
export function transform(root: RootNode, options: TransformOptions) {
  const context = createTransformContext(root, options)   // 创建转化内容
  traverseNode(root, context)   // 遍历节点
  // 当静态节点提升为true时
  if (options.hoistStatic) {
    hoistStatic(root, context)
  }
  if (!options.ssr) {
    createRootCodegen(root, context)
  }
  // finalize meta information
  // 完成meta信息
  root.helpers = [...context.helpers]   // 创建VNode所用到的函数名称(其实是 Symbol)
  root.components = [...context.components]   // 组件???
  root.directives = [...context.directives]   // vue指令
  root.imports = [...context.imports]   // 引入???
  root.hoists = context.hoists  // 静态节点
  root.temps = context.temps  // ???
  root.cached = context.cached  // ???
}

function createRootCodegen(root: RootNode, context: TransformContext) {
  const { helper } = context
  const { children } = root
  const child = children[0]
  if (children.length === 1) {
    // if the single child is an element, turn it into a block.
    if (isSingleElementRoot(root, child) && child.codegenNode) {
      // single element root is never hoisted so codegenNode will never be
      // SimpleExpressionNode
      const codegenNode = child.codegenNode
      if (codegenNode.type === NodeTypes.VNODE_CALL) {
        codegenNode.isBlock = true
        helper(OPEN_BLOCK)
        helper(CREATE_BLOCK)
      }
      root.codegenNode = codegenNode    // 生成代码要用到的数据
    } else {
      // - single <slot/>, IfNode, ForNode: already blocks.
      // - single text node: always patched.
      // root codegen falls through via genNode()
      root.codegenNode = child
    }
  } else if (children.length > 1) {
    // root has multiple nodes - return a fragment block.
    root.codegenNode = createVNodeCall(
      context,
      helper(FRAGMENT),  // Fragment的Symbol
      undefined,  // props为空
      root.children,  // 子节点
      `${PatchFlags.STABLE_FRAGMENT} /* ${
        PatchFlagNames[PatchFlags.STABLE_FRAGMENT]
      } */`,  // patchflags为 64 /* STABLE_FRAGMENT */代表 一个不会改变子节点顺序的 fragment
      undefined,  // 动态props为空
      undefined,  // vue指令为空
      true  // 是块
    )
  } else {
    // no children = noop. codegen will return null.
  }
}

// 遍历子节点???
export function traverseChildren(
  parent: ParentNode,
  context: TransformContext
) {
  let i = 0
  const nodeRemoved = () => {
    i--
  }
  for (; i < parent.children.length; i++) {
    const child = parent.children[i]
    if (isString(child)) continue
    context.parent = parent
    context.childIndex = i
    context.onNodeRemoved = nodeRemoved
    traverseNode(child, context)
  }
}

// 遍历节点
export function traverseNode(
  node: RootNode | TemplateChildNode,
  context: TransformContext
) {
  context.currentNode = node
  // apply transform plugins
  const { nodeTransforms } = context
  const exitFns = []
  for (let i = 0; i < nodeTransforms.length; i++) {
    const onExit = nodeTransforms[i](node, context)
    if (onExit) {
      if (isArray(onExit)) {
        exitFns.push(...onExit)
      } else {
        exitFns.push(onExit)
      }
    }
    if (!context.currentNode) {
      // node was removed
      return
    } else {
      // node may have been replaced
      node = context.currentNode
    }
  }

  switch (node.type) {
    case NodeTypes.COMMENT:
      if (!context.ssr) {
        // inject import for the Comment symbol, which is needed for creating
        // comment nodes with `createVNode`
        context.helper(CREATE_COMMENT)
      }
      break
    case NodeTypes.INTERPOLATION:
      // no need to traverse, but we need to inject toString helper
      if (!context.ssr) {
        context.helper(TO_DISPLAY_STRING)
      }
      break

    // for container types, further traverse downwards
    case NodeTypes.IF:
      for (let i = 0; i < node.branches.length; i++) {
        traverseNode(node.branches[i], context)
      }
      break
    case NodeTypes.IF_BRANCH:
    case NodeTypes.FOR:
    case NodeTypes.ELEMENT:
    case NodeTypes.ROOT:
      traverseChildren(node, context)
      break
  }

  // exit transforms
  let i = exitFns.length
  while (i--) {
    exitFns[i]()
  }
}

// 创建结构指令转换???
export function createStructuralDirectiveTransform(
  name: string | RegExp,
  fn: StructuralDirectiveTransform
): NodeTransform {
  const matches = isString(name)
    ? (n: string) => n === name
    : (n: string) => name.test(n)

  return (node, context) => {
    if (node.type === NodeTypes.ELEMENT) {
      const { props } = node
      // structural directive transforms are not concerned with slots
      // as they are handled separately in vSlot.ts
      if (node.tagType === ElementTypes.TEMPLATE && props.some(isVSlot)) {
        return
      }
      const exitFns = []
      for (let i = 0; i < props.length; i++) {
        const prop = props[i]
        if (prop.type === NodeTypes.DIRECTIVE && matches(prop.name)) {
          // structural directives are removed to avoid infinite recursion
          // also we remove them *before* applying so that it can further
          // traverse itself in case it moves the node around
          props.splice(i, 1)
          i--
          const onExit = fn(node, prop, context)
          if (onExit) exitFns.push(onExit)
        }
      }
      return exitFns
    }
  }
}
