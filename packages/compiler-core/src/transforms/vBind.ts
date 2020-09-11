import { DirectiveTransform } from '../transform'
import { createObjectProperty, createSimpleExpression, NodeTypes } from '../ast'
import { createCompilerError, ErrorCodes } from '../errors'
import { camelize } from '@vue/shared'
import { CAMELIZE } from '../runtimeHelpers'

// v-bind without arg is handled directly in ./transformElements.ts due to it affecting
// codegen for the entire props object. This transform here is only for v-bind
// *with* args.
// 不带arg的v-bind在.transformElements.ts中直接处理，因为它会影响整个props对象的代码生成。
// 这里的转换仅适用于带有* args的v-bind。

// 转换Bind
export const transformBind: DirectiveTransform = (dir, node, context) => {
  const { exp, modifiers, loc } = dir   // 获取表达式,修饰符,位置信息
  const arg = dir.arg!
  // .prop is no longer necessary due to new patch behavior
  // .sync is replaced by v-model:arg
  // 由于新的patch程序，不再需要.prop
  // .sync被v-model：arg取代

  // camel驼峰
  if (modifiers.includes('camel')) {
    if (arg.type === NodeTypes.SIMPLE_EXPRESSION) {
      if (arg.isStatic) {
        arg.content = camelize(arg.content)
      } else {
        arg.content = `${context.helperString(CAMELIZE)}(${arg.content})`
      }
    } else {
      arg.children.unshift(`${context.helperString(CAMELIZE)}(`)
      arg.children.push(`)`)
    }
  }

  // 表达式为空,或者简单表达式但内容为空
  if (
    !exp ||
    (exp.type === NodeTypes.SIMPLE_EXPRESSION && !exp.content.trim())
  ) {
    context.onError(createCompilerError(ErrorCodes.X_V_BIND_NO_EXPRESSION, loc))
    return {
      props: [createObjectProperty(arg!, createSimpleExpression('', true, loc))]  // 创建空白对象吗???
    }
  }

  return {
    props: [createObjectProperty(arg!, exp)]
  }
}
