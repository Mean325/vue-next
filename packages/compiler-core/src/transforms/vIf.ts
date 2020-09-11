import {
  createStructuralDirectiveTransform,
  TransformContext,
  traverseNode
} from '../transform'
import {
  NodeTypes,
  ElementTypes,
  ElementNode,
  DirectiveNode,
  IfBranchNode,
  SimpleExpressionNode,
  createCallExpression,
  createConditionalExpression,
  createSimpleExpression,
  createObjectProperty,
  createObjectExpression,
  IfConditionalExpression,
  BlockCodegenNode,
  IfNode,
  createVNodeCall
} from '../ast'
import { createCompilerError, ErrorCodes } from '../errors'
import { processExpression } from './transformExpression'
import { validateBrowserExpression } from '../validateExpression'
import {
  CREATE_BLOCK,
  FRAGMENT,
  CREATE_COMMENT,
  OPEN_BLOCK,
  TELEPORT
} from '../runtimeHelpers'
import { injectProp, findDir, findProp } from '../utils'
import { PatchFlags, PatchFlagNames } from '@vue/shared'

export const transformIf = createStructuralDirectiveTransform(
  /^(if|else|else-if)$/,
  (node, dir, context) => {
    return processIf(node, dir, context, (ifNode, branch, isRoot) => {
      // #1587: We need to dynamically increment the key based on the current
      // node's sibling nodes, since chained v-if/else branches are
      // rendered at the same depth
      const siblings = context.parent!.children
      let i = siblings.indexOf(ifNode)
      let key = 0
      while (i-- >= 0) {
        const sibling = siblings[i]
        if (sibling && sibling.type === NodeTypes.IF) {
          key += sibling.branches.length
        }
      }

      // Exit callback. Complete the codegenNode when all children have been
      // transformed.
      return () => {
        if (isRoot) {
          ifNode.codegenNode = createCodegenNodeForBranch(
            branch,
            key,
            context
          ) as IfConditionalExpression
        } else {
          // attach this branch's codegen node to the v-if root.
          let parentCondition = ifNode.codegenNode!
          while (
            parentCondition.alternate.type ===
            NodeTypes.JS_CONDITIONAL_EXPRESSION
          ) {
            parentCondition = parentCondition.alternate
          }
          parentCondition.alternate = createCodegenNodeForBranch(
            branch,
            key + ifNode.branches.length - 1,
            context
          )
        }
      }
    })
  }
)

// target-agnostic transform used for both Client and SSR
// 目标无关的转换用于客户端和SSR
// 处理If
export function processIf(
  node: ElementNode,  // 元素节点
  dir: DirectiveNode,   // 指令节点
  context: TransformContext,  // 转换内容
  processCodegen?: (
    node: IfNode,
    branch: IfBranchNode,
    isRoot: boolean
  ) => (() => void) | undefined   // 处理编译?
) {
  if (
    dir.name !== 'else' &&
    (!dir.exp || !(dir.exp as SimpleExpressionNode).content.trim())
  ) {
    // 当指令名称不为else,且exp中的内容不为空,即v-else后带有参数时,给出报错信息
    const loc = dir.exp ? dir.exp.loc : node.loc  // 获取指令节点的位置信息
    context.onError(
      createCompilerError(ErrorCodes.X_V_IF_NO_EXPRESSION, dir.loc)
    )
    dir.exp = createSimpleExpression(`true`, false, loc)  // ???
  }

  if (!__BROWSER__ && context.prefixIdentifiers && dir.exp) {
    // dir.exp can only be simple expression because vIf transform is applied
    // before expression transform.
    // dir.exp只能是简单表达式，因为vIf变换应用在表达式变换之前。
    dir.exp = processExpression(dir.exp as SimpleExpressionNode, context)
  }

  if (__DEV__ && __BROWSER__ && dir.exp) {
    validateBrowserExpression(dir.exp as SimpleExpressionNode, context)   // 验证非前缀表达式
  }

  const userKey = /*#__PURE__*/ findProp(node, 'key') // 获取是否有为'key'的属性
  if (userKey) {
    // v-if分支必须使用编译器生成的key。
    // 如果该标签位于<template v-for =“ ...”>内，则可以将密钥移至父<template>。
    // 即v-if与:key不能共用
    context.onError(createCompilerError(ErrorCodes.X_V_IF_KEY, userKey.loc))
  }

  if (dir.name === 'if') {
    // 当指令名称为if时
    const branch = createIfBranch(node, dir)    // 创建v-else节点
    const ifNode: IfNode = {
      type: NodeTypes.IF,
      loc: node.loc,
      branches: [branch]
    }   // 创建v-if节点
    context.replaceNode(ifNode) // 替换节点???
    if (processCodegen) { 
      return processCodegen(ifNode, branch, true)
    }
  } else {
    // locate the adjacent v-if
    // 向上查找相邻的v-if
    const siblings = context.parent!.children  // 兄弟节点
    const comments = []
    let i = siblings.indexOf(node)  // 获取当前节点的位置
    while (i-- >= -1) {
      const sibling = siblings[i]
      if (__DEV__ && sibling && sibling.type === NodeTypes.COMMENT) {
        // 如果是注释,则删除该节点
        context.removeNode(sibling)
        // comments新增该节点
        comments.unshift(sibling)
        continue
      }
      if (sibling && sibling.type === NodeTypes.IF) {
        // 当节点类型为v-if时
        // 将节点移动到if节点的分支
        context.removeNode()
        const branch = createIfBranch(node, dir)    // 创建v-else节点
        if (__DEV__ && comments.length) {
          branch.children = [...comments, ...branch.children]
        } 
        sibling.branches.push(branch)   // if节点分支中存入该节点
        const onExit = processCodegen && processCodegen(sibling, branch, false)   //???
        // since the branch was removed, it will not be traversed.
        // make sure to traverse here.
        // 由于分支已删除，因此将不会遍历该分支。确保在这里遍历。
        traverseNode(branch, context)
        // call on exit
        if (onExit) onExit()
        // make sure to reset currentNode after traversal to indicate this
        // node has been removed.
        // 确保在遍历后重置currentNode以指示该节点已被删除。
        context.currentNode = null
      } else {
        // v-else / v-else-if没有相邻的v-if。
        context.onError(
          createCompilerError(ErrorCodes.X_V_ELSE_NO_ADJACENT_IF, node.loc)
        )
      }
      break
    }
  }
}

// 创建if分支
function createIfBranch(node: ElementNode, dir: DirectiveNode): IfBranchNode {
  return {
    type: NodeTypes.IF_BRANCH,
    loc: node.loc,
    condition: dir.name === 'else' ? undefined : dir.exp,   // 条件
    children:
      node.tagType === ElementTypes.TEMPLATE && !findDir(node, 'for')   // 当节点的标签为Template,且没有v-for的指令
        ? node.children
        : [node]
  }
}

// 创建分支的编译节点
function createCodegenNodeForBranch(
  branch: IfBranchNode,
  keyIndex: number,
  context: TransformContext
): IfConditionalExpression | BlockCodegenNode {
  if (branch.condition) {
    return createConditionalExpression(
      branch.condition,
      createChildrenCodegenNode(branch, keyIndex, context),
      // make sure to pass in asBlock: true so that the comment node call
      // closes the current block.
      createCallExpression(context.helper(CREATE_COMMENT), [
        __DEV__ ? '"v-if"' : '""',
        'true'
      ])
    ) as IfConditionalExpression
  } else {
    return createChildrenCodegenNode(branch, keyIndex, context)
  }
}

// 创建children的编译节点
function createChildrenCodegenNode(
  branch: IfBranchNode,
  keyIndex: number,
  context: TransformContext
): BlockCodegenNode {
  const { helper } = context
  const keyProperty = createObjectProperty(
    `key`,
    createSimpleExpression(`${keyIndex}`, false)
  )
  const { children } = branch
  const firstChild = children[0]
  const needFragmentWrapper =
    children.length !== 1 || firstChild.type !== NodeTypes.ELEMENT
  if (needFragmentWrapper) {
    if (children.length === 1 && firstChild.type === NodeTypes.FOR) {
      // optimize away nested fragments when child is a ForNode
      const vnodeCall = firstChild.codegenNode!
      injectProp(vnodeCall, keyProperty, context)
      return vnodeCall
    } else {
      return createVNodeCall(
        context,
        helper(FRAGMENT),
        createObjectExpression([keyProperty]),
        children,
        `${PatchFlags.STABLE_FRAGMENT} /* ${
          PatchFlagNames[PatchFlags.STABLE_FRAGMENT]
        } */`,
        undefined,
        undefined,
        true,
        false,
        branch.loc
      )
    }
  } else {
    const vnodeCall = (firstChild as ElementNode)
      .codegenNode as BlockCodegenNode
    // Change createVNode to createBlock.
    if (
      vnodeCall.type === NodeTypes.VNODE_CALL &&
      // component vnodes are always tracked and its children are
      // compiled into slots so no need to make it a block
      ((firstChild as ElementNode).tagType !== ElementTypes.COMPONENT ||
        // teleport has component type but isn't always tracked
        vnodeCall.tag === TELEPORT)
    ) {
      vnodeCall.isBlock = true
      helper(OPEN_BLOCK)
      helper(CREATE_BLOCK)
    }
    // inject branch key
    injectProp(vnodeCall, keyProperty, context)
    return vnodeCall
  }
}
