import { ElementNode, Namespace, TemplateChildNode, ParentNode } from './ast'
import { TextModes } from './parse'
import { CompilerError } from './errors'
import {
  NodeTransform,
  DirectiveTransform,
  TransformContext
} from './transform'
import { ParserPlugin } from '@babel/parser'

// 解析配置
export interface ParserOptions {
  /**
   * e.g. platform native elements, e.g. `<div>` for browsers
   */
  isNativeTag?: (tag: string) => boolean
  /**
   * e.g. native elements that can self-close, e.g. `<img>`, `<br>`, `<hr>`
   */
  isVoidTag?: (tag: string) => boolean
  /**
   * e.g. elements that should preserve whitespace inside, e.g. `<pre>`
   */
  isPreTag?: (tag: string) => boolean
  /**
   * Platform-specific built-in components e.g. `<Transition>`
   */
  isBuiltInComponent?: (tag: string) => symbol | void
  /**
   * Separate option for end users to extend the native elements list
   */
  isCustomElement?: (tag: string) => boolean | void
  /**
   * Get tag namespace
   */
  getNamespace?: (tag: string, parent: ElementNode | undefined) => Namespace
  /**
   * Get text parsing mode for this element
   */
  getTextMode?: (
    node: ElementNode,
    parent: ElementNode | undefined
  ) => TextModes
  /**
   * @default ['{{', '}}']
   */
  delimiters?: [string, string]
  /**
   * Only needed for DOM compilers
   */
  decodeEntities?: (rawText: string, asAttr: boolean) => string
  onError?: (error: CompilerError) => void
}

export type HoistTransform = (
  children: TemplateChildNode[],
  context: TransformContext,
  parent: ParentNode
) => void

export interface BindingMetadata {
  [key: string]: 'data' | 'props' | 'setup' | 'options'
}

// 转换配置
export interface TransformOptions {
  /**
   * An array of node transforms to be applied to every AST node.
   */
  nodeTransforms?: NodeTransform[]
  /**
   * An object of { name: transform } to be applied to every directive attribute
   * node found on element nodes.
   */
  directiveTransforms?: Record<string, DirectiveTransform | undefined>
  /**
   * An optional hook to transform a node being hoisted.
   * used by compiler-dom to turn hoisted nodes into stringified HTML vnodes.
   * @default null
   */
  // 可选的挂钩，用于转换要转换的节点。
  // 由compiler-dom用于将提升的节点转换为字符串化的HTML vnode。
  transformHoist?: HoistTransform | null
  /**
   * If the pairing runtime provides additional built-in elements, use this to
   * mark them as built-in so the compiler will generate component vnodes
   * for them.
   */
  isBuiltInComponent?: (tag: string) => symbol | void
  /**
   * Used by some transforms that expects only native elements
   */
  isCustomElement?: (tag: string) => boolean | void
  /**
   * Transform expressions like {{ foo }} to `_ctx.foo`.
   * If this option is false, the generated code will be wrapped in a
   * `with (this) { ... }` block.
   * - This is force-enabled in module mode, since modules are by default strict
   * and cannot use `with`
   * @default mode === 'module'
   */
  prefixIdentifiers?: boolean
  /**
   * Hoist static VNodes and props objects to `_hoisted_x` constants
   * @default false
   */
  hoistStatic?: boolean
  /**
   * Cache v-on handlers to avoid creating new inline functions on each render,
   * also avoids the need for dynamically patching the handlers by wrapping it.
   * e.g `@click="foo"` by default is compiled to `{ onClick: foo }`. With this
   * option it's compiled to:
   * ```js
   * { onClick: _cache[0] || (_cache[0] = e => _ctx.foo(e)) }
   * ```
   * - Requires "prefixIdentifiers" to be enabled because it relies on scope
   * analysis to determine if a handler is safe to cache.
   * @default false
   */
  // 开启事件函数缓存
  cacheHandlers?: boolean
  /**
   * A list of parser plugins to enable for `@babel/parser`, which is used to
   * parse expressions in bindings and interpolations.
   * https://babeljs.io/docs/en/next/babel-parser#plugins
   */
  expressionPlugins?: ParserPlugin[]
  /**
   * SFC scoped styles ID
   */
  scopeId?: string | null
  /**
   * Generate SSR-optimized render functions instead.
   * The resulting function must be attached to the component via the
   * `ssrRender` option instead of `render`.
   */
  ssr?: boolean
  /**
   * SFC `<style vars>` injection string
   * needed to render inline CSS variables on component root
   */
  ssrCssVars?: string
  /**
   * Optional binding metadata analyzed from script - used to optimize
   * binding access when `prefixIdentifiers` is enabled.
   */
  bindingMetadata?: BindingMetadata
  onError?: (error: CompilerError) => void
}

// 编译配置
export interface CodegenOptions {
  /**
   * - `module` mode will generate ES module import statements for helpers
   * and export the render function as the default export.
   * - `function` mode will generate a single `const { helpers... } = Vue`
   * statement and return the render function. It expects `Vue` to be globally
   * available (or passed by wrapping the code with an IIFE). It is meant to be
   * used with `new Function(code)()` to generate a render function at runtime.
   * @default 'function'
   */
  /**
   * - `module`模式将为helpers生成ES模块导入语句，并将render函数导出为默认导出。
   * - 函数模式将生成单个const {helpers ...} = Vue语句并返回render函数。
   * 它期望`Vue`可以在全局范围内使用（或通过使用IIFE包装代码来通过）
   * 它打算与`new Function(code)()`一起使用，以在运行时生成渲染函数。
   * @默认为'function'
   */
  mode?: 'module' | 'function'
  /**
   * Generate source map?
   * @default false
   */
  // 生成源码map???
  sourceMap?: boolean
  /**
   * Filename for source map generation.
   * @default 'template.vue.html'
   */
  // 用于生成源映射的文件名???
  filename?: string
  /**
   * SFC scoped styles ID
   */
  // SFC范围样式ID
  scopeId?: string | null
  /**
   * Option to optimize helper import bindings via variable assignment
   * (only used for webpack code-split)
   * @default false
   */
  // * 通过变量分配来优化助手导入绑定的选项
  // *（仅用于webpack代码拆分）
  optimizeImports?: boolean
  /**
   * Customize where to import runtime helpers from.
   * @default 'vue'
   */
  // 运行时模块名称,默认为Vue
  runtimeModuleName?: string
  /**
   * Customize the global variable name of `Vue` to get helpers from
   * in function mode
   * @default 'Vue'
   */
  // 运行时全局名称,默认为Vue
  runtimeGlobalName?: string
  // we need to know this during codegen to generate proper preambles
  // 我们需要在代码生成过程中知道这一点，以生成适当的前同步码???
  prefixIdentifiers?: boolean
  // 绑定元数据???
  bindingMetadata?: BindingMetadata
  // generate ssr-specific code?
  // 生成特定于ssr的代码???
  ssr?: boolean
}

export type CompilerOptions = ParserOptions & TransformOptions & CodegenOptions
