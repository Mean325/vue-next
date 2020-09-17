import { isString } from '@vue/shared'
import { ForParseResult } from './transforms/vFor'
import {
  RENDER_SLOT,
  CREATE_SLOTS,
  RENDER_LIST,
  OPEN_BLOCK,
  CREATE_BLOCK,
  FRAGMENT,
  CREATE_VNODE,
  WITH_DIRECTIVES
} from './runtimeHelpers'
import { PropsExpression } from './transforms/transformElement'
import { ImportItem, TransformContext } from './transform'

// Vue template is a platform-agnostic superset of HTML (syntax only).
// More namespaces like SVG and MathML are declared by platform specific
// compilers.
export type Namespace = number

export const enum Namespaces {
  HTML
}

// 节点类型枚举
export const enum NodeTypes {
  ROOT, // 根节点 0
  ELEMENT, // 元素节点 1
  TEXT, // 文本节点 2
  COMMENT, // 注释节点 3
  SIMPLE_EXPRESSION, // 表达式 4
  INTERPOLATION, // 双花插值 {{ }} 5
  ATTRIBUTE, // HTML普通属性 6
  DIRECTIVE, // Vue指令 7
  // containers
  COMPOUND_EXPRESSION,  // 复合表达式
  IF,   // v-if
  IF_BRANCH,  // v-else
  FOR,  // v-for
  TEXT_CALL,  // 文本调用
  // codegen
  VNODE_CALL, // 静态节点, props
  JS_CALL_EXPRESSION,
  JS_OBJECT_EXPRESSION,
  JS_PROPERTY,  // JS属性
  JS_ARRAY_EXPRESSION,
  JS_FUNCTION_EXPRESSION,
  JS_CONDITIONAL_EXPRESSION,  // 条件表达式,v-if
  JS_CACHE_EXPRESSION,

  // ssr codegen
  JS_BLOCK_STATEMENT,
  JS_TEMPLATE_LITERAL,
  JS_IF_STATEMENT,
  JS_ASSIGNMENT_EXPRESSION,
  JS_SEQUENCE_EXPRESSION,
  JS_RETURN_STATEMENT
}

export const enum ElementTypes {
  ELEMENT, // 0 元素节点
  COMPONENT, // 1 组件
  SLOT, // 2 插槽
  TEMPLATE // 3 模板
}

export interface Node {
  type: NodeTypes
  loc: SourceLocation   // 位置信息，表明这个节点在源 HTML 字符串中的位置，包含行，列，偏移量等信息
}

// The node's range. The `start` is inclusive and `end` is exclusive.
// [start, end)
export interface SourceLocation {
  start: Position
  end: Position
  source: string
}

export interface Position {
  offset: number // from start of file
  line: number
  column: number
}

export type ParentNode = RootNode | ElementNode | IfBranchNode | ForNode

export type ExpressionNode = SimpleExpressionNode | CompoundExpressionNode

export type TemplateChildNode =
  | ElementNode
  | InterpolationNode
  | CompoundExpressionNode
  | TextNode
  | CommentNode
  | IfNode
  | IfBranchNode
  | ForNode
  | TextCallNode

export interface RootNode extends Node {
  type: NodeTypes.ROOT
  children: TemplateChildNode[] // 子节点
  helpers: symbol[]
  components: string[]
  directives: string[]
  hoists: (JSChildNode | null)[]
  imports: ImportItem[]
  cached: number
  temps: number
  ssrHelpers?: symbol[]
  codegenNode?: TemplateChildNode | JSChildNode | BlockStatement | undefined
}

export type ElementNode =
  | PlainElementNode
  | ComponentNode
  | SlotOutletNode
  | TemplateNode

// 元素节点
export interface BaseElementNode extends Node {
  type: NodeTypes.ELEMENT   // 节点类型
  ns: Namespace   // 命名空间,默认为 HTML，即 0
  tag: string   // 标签名
  tagType: ElementTypes   // 元素类型
  isSelfClosing: boolean    // 是否是自闭合标签 例如 <br/> <hr/>
  props: Array<AttributeNode | DirectiveNode>   // props 属性，包含 HTML 属性和指令
  children: TemplateChildNode[]   // 子节点
}

// 普通元素节点
export interface PlainElementNode extends BaseElementNode {
  tagType: ElementTypes.ELEMENT
  codegenNode:
    | VNodeCall
    | SimpleExpressionNode // when hoisted
    | CacheExpression // when cached by v-once
    | undefined
  ssrCodegenNode?: TemplateLiteral
}

export interface ComponentNode extends BaseElementNode {
  tagType: ElementTypes.COMPONENT
  codegenNode:
    | VNodeCall
    | CacheExpression // when cached by v-once
    | undefined
  ssrCodegenNode?: CallExpression
}

export interface SlotOutletNode extends BaseElementNode {
  tagType: ElementTypes.SLOT
  codegenNode:
    | RenderSlotCall
    | CacheExpression // when cached by v-once
    | undefined
  ssrCodegenNode?: CallExpression
}

export interface TemplateNode extends BaseElementNode {
  tagType: ElementTypes.TEMPLATE
  // TemplateNode is a container type that always gets compiled away
  codegenNode: undefined
}

export interface TextNode extends Node {
  type: NodeTypes.TEXT
  content: string
}

export interface CommentNode extends Node {
  type: NodeTypes.COMMENT
  content: string
}

export interface AttributeNode extends Node {
  type: NodeTypes.ATTRIBUTE
  name: string
  value: TextNode | undefined
}

// 指令节点
export interface DirectiveNode extends Node {
  type: NodeTypes.DIRECTIVE   // 节点类型,此处为Vue指令
  name: string  // 指令名称
  exp: ExpressionNode | undefined   // 表达式
  arg: ExpressionNode | undefined   // 参数
  modifiers: string[]   // 修饰符,如.prevent, .once等
  /**
   * optional property to cache the expression parse result for v-for
   * 可选属性，用于缓存v-for的表达式解析结果
   */
  parseResult?: ForParseResult  // For的解析结果
}

// 简单表达式节点
export interface SimpleExpressionNode extends Node {
  type: NodeTypes.SIMPLE_EXPRESSION
  content: string   // 内容
  isStatic: boolean // 是否为静态节点，静态节点只会生成一次，并且在后面的阶段一直复用同一个，不用进行 diff 比较
  isConstant: boolean
  /**
   * Indicates this is an identifier for a hoist vnode call and points to the
   * hoisted node.
   * 指示是否提升vnode调用的标识符，并指向提升的节点。
   */
  hoisted?: JSChildNode   // 是否为静态提升
  /**
   * an expression parsed as the params of a function will track
   * the identifiers declared inside the function body.
   * 解析为函数参数的表达式将跟踪在函数体内声明的标识符。
   */
  identifiers?: string[]  // 标识符
  /**
   * some expressions (e.g. transformAssetUrls import identifiers) are constant,
   * but cannot be stringified because they must be first evaluated at runtime.
   */
  // 一些表达式（例如transformAssetUrls导入标识符）是常量
  // 但不能进行字符串化，因为必须首先在运行时对其进行求值。
  isRuntimeConstant?: boolean
}

export interface InterpolationNode extends Node {
  type: NodeTypes.INTERPOLATION
  content: ExpressionNode
}

// 复合表达式节点
export interface CompoundExpressionNode extends Node {
  type: NodeTypes.COMPOUND_EXPRESSION
  children: (
    | SimpleExpressionNode
    | CompoundExpressionNode
    | InterpolationNode
    | TextNode
    | string
    | symbol)[]

  /**
   * an expression parsed as the params of a function will track
   * the identifiers declared inside the function body.
   */
  identifiers?: string[]
}

// IF节点
export interface IfNode extends Node {
  type: NodeTypes.IF
  branches: IfBranchNode[]
  codegenNode?: IfConditionalExpression
}

// IF节点分支,即ELSE
export interface IfBranchNode extends Node {
  type: NodeTypes.IF_BRANCH
  condition: ExpressionNode | undefined // else
  children: TemplateChildNode[]
}

export interface ForNode extends Node {
  type: NodeTypes.FOR
  source: ExpressionNode
  valueAlias: ExpressionNode | undefined
  keyAlias: ExpressionNode | undefined
  objectIndexAlias: ExpressionNode | undefined
  parseResult: ForParseResult
  children: TemplateChildNode[]
  codegenNode?: ForCodegenNode
}

export interface TextCallNode extends Node {
  type: NodeTypes.TEXT_CALL
  content: TextNode | InterpolationNode | CompoundExpressionNode
  codegenNode: CallExpression | SimpleExpressionNode // when hoisted
}

export type TemplateTextChildNode =
  | TextNode
  | InterpolationNode
  | CompoundExpressionNode

export interface VNodeCall extends Node {
  type: NodeTypes.VNODE_CALL
  tag: string | symbol | CallExpression
  props: PropsExpression | undefined
  children:
    | TemplateChildNode[] // multiple children
    | TemplateTextChildNode // single text child
    | SlotsExpression // component slots
    | ForRenderListExpression // v-for fragment call
    | undefined
  patchFlag: string | undefined
  dynamicProps: string | undefined
  directives: DirectiveArguments | undefined
  isBlock: boolean
  disableTracking: boolean
}

// JS Node Types ---------------------------------------------------------------

// We also include a number of JavaScript AST nodes for code generation.
// The AST is an intentionally minimal subset just to meet the exact needs of
// Vue render function generation.

export type JSChildNode =
  | VNodeCall
  | CallExpression
  | ObjectExpression
  | ArrayExpression
  | ExpressionNode
  | FunctionExpression
  | ConditionalExpression
  | CacheExpression
  | AssignmentExpression
  | SequenceExpression

export interface CallExpression extends Node {
  type: NodeTypes.JS_CALL_EXPRESSION
  callee: string | symbol
  arguments: (
    | string
    | symbol
    | JSChildNode
    | SSRCodegenNode
    | TemplateChildNode
    | TemplateChildNode[])[]
}

export interface ObjectExpression extends Node {
  type: NodeTypes.JS_OBJECT_EXPRESSION
  properties: Array<Property>
}

// 属性
export interface Property extends Node {
  type: NodeTypes.JS_PROPERTY
  key: ExpressionNode
  value: JSChildNode
}

export interface ArrayExpression extends Node {
  type: NodeTypes.JS_ARRAY_EXPRESSION
  elements: Array<string | JSChildNode>
}

export interface FunctionExpression extends Node {
  type: NodeTypes.JS_FUNCTION_EXPRESSION
  params: ExpressionNode | string | (ExpressionNode | string)[] | undefined
  returns?: TemplateChildNode | TemplateChildNode[] | JSChildNode
  body?: BlockStatement | IfStatement
  newline: boolean
  /**
   * This flag is for codegen to determine whether it needs to generate the
   * withScopeId() wrapper
   */
  isSlot: boolean
}

export interface ConditionalExpression extends Node {
  type: NodeTypes.JS_CONDITIONAL_EXPRESSION
  test: JSChildNode
  consequent: JSChildNode   // 结果
  alternate: JSChildNode  // 备用
  newline: boolean  // 是否另起一行
}

export interface CacheExpression extends Node {
  type: NodeTypes.JS_CACHE_EXPRESSION
  index: number
  value: JSChildNode
  isVNode: boolean
}

// SSR-specific Node Types -----------------------------------------------------

export type SSRCodegenNode =
  | BlockStatement
  | TemplateLiteral
  | IfStatement
  | AssignmentExpression
  | ReturnStatement
  | SequenceExpression

export interface BlockStatement extends Node {
  type: NodeTypes.JS_BLOCK_STATEMENT
  body: (JSChildNode | IfStatement)[]
}

export interface TemplateLiteral extends Node {
  type: NodeTypes.JS_TEMPLATE_LITERAL
  elements: (string | JSChildNode)[]
}

export interface IfStatement extends Node {
  type: NodeTypes.JS_IF_STATEMENT
  test: ExpressionNode
  consequent: BlockStatement
  alternate: IfStatement | BlockStatement | ReturnStatement | undefined
}

export interface AssignmentExpression extends Node {
  type: NodeTypes.JS_ASSIGNMENT_EXPRESSION
  left: SimpleExpressionNode
  right: JSChildNode
}

export interface SequenceExpression extends Node {
  type: NodeTypes.JS_SEQUENCE_EXPRESSION
  expressions: JSChildNode[]
}

export interface ReturnStatement extends Node {
  type: NodeTypes.JS_RETURN_STATEMENT
  returns: TemplateChildNode | TemplateChildNode[] | JSChildNode
}

// Codegen Node Types ----------------------------------------------------------

export interface DirectiveArguments extends ArrayExpression {
  elements: DirectiveArgumentNode[]
}

export interface DirectiveArgumentNode extends ArrayExpression {
  elements:  // dir, exp, arg, modifiers
    | [string]
    | [string, ExpressionNode]
    | [string, ExpressionNode, ExpressionNode]
    | [string, ExpressionNode, ExpressionNode, ObjectExpression]
}

// renderSlot(...)
export interface RenderSlotCall extends CallExpression {
  callee: typeof RENDER_SLOT
  arguments:  // $slots, name, props, fallback
    | [string, string | ExpressionNode]
    | [string, string | ExpressionNode, PropsExpression]
    | [
        string,
        string | ExpressionNode,
        PropsExpression | '{}',
        TemplateChildNode[]
      ]
}

export type SlotsExpression = SlotsObjectExpression | DynamicSlotsExpression

// { foo: () => [...] }
export interface SlotsObjectExpression extends ObjectExpression {
  properties: SlotsObjectProperty[]
}

export interface SlotsObjectProperty extends Property {
  value: SlotFunctionExpression
}

export interface SlotFunctionExpression extends FunctionExpression {
  returns: TemplateChildNode[]
}

// createSlots({ ... }, [
//    foo ? () => [] : undefined,
//    renderList(list, i => () => [i])
// ])
export interface DynamicSlotsExpression extends CallExpression {
  callee: typeof CREATE_SLOTS
  arguments: [SlotsObjectExpression, DynamicSlotEntries]
}

export interface DynamicSlotEntries extends ArrayExpression {
  elements: (ConditionalDynamicSlotNode | ListDynamicSlotNode)[]
}

export interface ConditionalDynamicSlotNode extends ConditionalExpression {
  consequent: DynamicSlotNode
  alternate: DynamicSlotNode | SimpleExpressionNode
}

export interface ListDynamicSlotNode extends CallExpression {
  callee: typeof RENDER_LIST
  arguments: [ExpressionNode, ListDynamicSlotIterator]
}

export interface ListDynamicSlotIterator extends FunctionExpression {
  returns: DynamicSlotNode
}

export interface DynamicSlotNode extends ObjectExpression {
  properties: [Property, DynamicSlotFnProperty]
}

export interface DynamicSlotFnProperty extends Property {
  value: SlotFunctionExpression
}

export type BlockCodegenNode = VNodeCall | RenderSlotCall

export interface IfConditionalExpression extends ConditionalExpression {
  consequent: BlockCodegenNode
  alternate: BlockCodegenNode | IfConditionalExpression
}

export interface ForCodegenNode extends VNodeCall {
  isBlock: true
  tag: typeof FRAGMENT
  props: undefined
  children: ForRenderListExpression
  patchFlag: string
  disableTracking: boolean
}

export interface ForRenderListExpression extends CallExpression {
  callee: typeof RENDER_LIST
  arguments: [ExpressionNode, ForIteratorExpression]
}

export interface ForIteratorExpression extends FunctionExpression {
  returns: BlockCodegenNode
}

// AST Utilities ---------------------------------------------------------------

// Some expressions, e.g. sequence and conditional expressions, are never
// associated with template nodes, so their source locations are just a stub.
// Container types like CompoundExpression also don't need a real location.
export const locStub: SourceLocation = {
  source: '',
  start: { line: 1, column: 1, offset: 0 },
  end: { line: 1, column: 1, offset: 0 }
}

// 创建虚拟根节点容器
// rootNode的加入使Vue3.0支持多根模版
export function createRoot(
  children: TemplateChildNode[],
  loc = locStub
): RootNode {
  return {
    type: NodeTypes.ROOT, // 节点类型
    children, // 子节点
    helpers: [],
    components: [], // 组件节点
    directives: [], // 指令节点
    hoists: [],
    imports: [],
    cached: 0,
    temps: 0,
    codegenNode: undefined,
    loc
  }
}

// 创建VNode调用
export function createVNodeCall(
  context: TransformContext | null,
  tag: VNodeCall['tag'],
  props?: VNodeCall['props'],
  children?: VNodeCall['children'],
  patchFlag?: VNodeCall['patchFlag'],
  dynamicProps?: VNodeCall['dynamicProps'],
  directives?: VNodeCall['directives'],
  isBlock: VNodeCall['isBlock'] = false,
  disableTracking: VNodeCall['disableTracking'] = false,
  loc = locStub
): VNodeCall {
  if (context) {
    if (isBlock) {  // 如果是块
      context.helper(OPEN_BLOCK)  // helper中新增openBlock和createBlock函数名
      context.helper(CREATE_BLOCK)
    } else {
      context.helper(CREATE_VNODE)  // 不为块时,新增createVnode函数名
    }
    if (directives) {   // 当有vue指令时
      context.helper(WITH_DIRECTIVES)   // 新增withDirectives函数名
    }
  }

  return {
    type: NodeTypes.VNODE_CALL,
    tag,
    props,
    children,
    patchFlag,
    dynamicProps,
    directives,
    isBlock,
    disableTracking,
    loc
  }
}

// 创建数组表达式
export function createArrayExpression(
  elements: ArrayExpression['elements'],
  loc: SourceLocation = locStub
): ArrayExpression {
  return {
    type: NodeTypes.JS_ARRAY_EXPRESSION,
    loc,
    elements
  }
}

// 创建对象表达式
export function createObjectExpression(
  properties: ObjectExpression['properties'],
  loc: SourceLocation = locStub
): ObjectExpression {
  return {
    type: NodeTypes.JS_OBJECT_EXPRESSION,
    loc,
    properties
  }
}

// 创建对象属性
export function createObjectProperty(
  key: Property['key'] | string,
  value: Property['value']
): Property {
  return {
    type: NodeTypes.JS_PROPERTY,
    loc: locStub,
    key: isString(key) ? createSimpleExpression(key, true) : key,
    value
  }
}

// 创建简单表达式
export function createSimpleExpression(
  content: SimpleExpressionNode['content'],
  isStatic: SimpleExpressionNode['isStatic'],   // 是否为静态节点
  loc: SourceLocation = locStub,  // 定位
  isConstant: boolean = false   // 是否为常量
): SimpleExpressionNode {
  return {
    type: NodeTypes.SIMPLE_EXPRESSION,
    loc,
    isConstant,
    content,
    isStatic
  }
}

// 创建插值
export function createInterpolation(
  content: InterpolationNode['content'] | string,
  loc: SourceLocation
): InterpolationNode {
  return {
    type: NodeTypes.INTERPOLATION,
    loc,
    content: isString(content)
      ? createSimpleExpression(content, false, loc)
      : content
  }
}

// 创建复合表达式
export function createCompoundExpression(
  children: CompoundExpressionNode['children'],
  loc: SourceLocation = locStub
): CompoundExpressionNode {
  return {
    type: NodeTypes.COMPOUND_EXPRESSION,
    loc,
    children
  }
}

type InferCodegenNodeType<T> = T extends typeof RENDER_SLOT
  ? RenderSlotCall
  : CallExpression

export function createCallExpression<T extends CallExpression['callee']>(
  callee: T,
  args: CallExpression['arguments'] = [],
  loc: SourceLocation = locStub
): InferCodegenNodeType<T> {
  return {
    type: NodeTypes.JS_CALL_EXPRESSION,
    loc,
    callee,
    arguments: args
  } as any
}

export function createFunctionExpression(
  params: FunctionExpression['params'],
  returns: FunctionExpression['returns'] = undefined,
  newline: boolean = false,
  isSlot: boolean = false,
  loc: SourceLocation = locStub
): FunctionExpression {
  return {
    type: NodeTypes.JS_FUNCTION_EXPRESSION,
    params,
    returns,
    newline,
    isSlot,
    loc
  }
}

// 创建条件表达式
export function createConditionalExpression(
  test: ConditionalExpression['test'],
  consequent: ConditionalExpression['consequent'],
  alternate: ConditionalExpression['alternate'],
  newline = true
): ConditionalExpression {
  return {
    type: NodeTypes.JS_CONDITIONAL_EXPRESSION,
    test,
    consequent,
    alternate,
    newline,
    loc: locStub
  }
}

export function createCacheExpression(
  index: number,
  value: JSChildNode,
  isVNode: boolean = false
): CacheExpression {
  return {
    type: NodeTypes.JS_CACHE_EXPRESSION,
    index,
    value,
    isVNode,
    loc: locStub
  }
}

export function createBlockStatement(
  body: BlockStatement['body']
): BlockStatement {
  return {
    type: NodeTypes.JS_BLOCK_STATEMENT,
    body,
    loc: locStub
  }
}

export function createTemplateLiteral(
  elements: TemplateLiteral['elements']
): TemplateLiteral {
  return {
    type: NodeTypes.JS_TEMPLATE_LITERAL,
    elements,
    loc: locStub
  }
}

export function createIfStatement(
  test: IfStatement['test'],
  consequent: IfStatement['consequent'],
  alternate?: IfStatement['alternate']
): IfStatement {
  return {
    type: NodeTypes.JS_IF_STATEMENT,
    test,
    consequent,
    alternate,
    loc: locStub
  }
}

export function createAssignmentExpression(
  left: AssignmentExpression['left'],
  right: AssignmentExpression['right']
): AssignmentExpression {
  return {
    type: NodeTypes.JS_ASSIGNMENT_EXPRESSION,
    left,
    right,
    loc: locStub
  }
}

export function createSequenceExpression(
  expressions: SequenceExpression['expressions']
): SequenceExpression {
  return {
    type: NodeTypes.JS_SEQUENCE_EXPRESSION,
    expressions,
    loc: locStub
  }
}

export function createReturnStatement(
  returns: ReturnStatement['returns']
): ReturnStatement {
  return {
    type: NodeTypes.JS_RETURN_STATEMENT,
    returns,
    loc: locStub
  }
}
