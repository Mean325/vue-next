import { NodeTransform } from '../transform'
import { findDir } from '../utils'
import { NodeTypes } from '../ast'
import { SET_BLOCK_TRACKING } from '../runtimeHelpers'

// 转换once
export const transformOnce: NodeTransform = (node, context) => {
  // 节点为元素节点,且查找once属性
  if (node.type === NodeTypes.ELEMENT && findDir(node, 'once', true)) {
    context.helper(SET_BLOCK_TRACKING)  // 块追踪???
    return () => {
      if (node.codegenNode) {
        node.codegenNode = context.cache(node.codegenNode, true /* isVNode */)
      }
    }
  }
}
