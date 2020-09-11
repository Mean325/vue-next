// these keywords should not appear inside expressions, but operators like

import { SimpleExpressionNode } from './ast'
import { TransformContext } from './transform'
import { createCompilerError, ErrorCodes } from './errors'

// typeof, instanceof and in are allowed
const prohibitedKeywordRE = new RegExp(
  '\\b' +
    (
      'do,if,for,let,new,try,var,case,else,with,await,break,catch,class,const,' +
      'super,throw,while,yield,delete,export,import,return,switch,default,' +
      'extends,finally,continue,debugger,function,arguments,typeof,void'
    )
      .split(',')
      .join('\\b|\\b') +
    '\\b'
)

// strip strings in expressions
const stripStringRE = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*\$\{|\}(?:[^`\\]|\\.)*`|`(?:[^`\\]|\\.)*`/g

/**
 * Validate a non-prefixed expression.
 * This is only called when using the in-browser runtime compiler since it
 * doesn't prefix expressions.
 */
// 验证非前缀表达式。
// 仅在使用浏览器内运行时编译器时调用，因为它没有前缀表达式。
export function validateBrowserExpression(
  node: SimpleExpressionNode,
  context: TransformContext,
  asParams = false, // 作为参数???, v-if时为false
  asRawStatements = false   // 作为原始陈述???, v-if时为false
) {
  const exp = node.content

  // empty expressions are validated per-directive since some directives
  // do allow empty expressions.
  // 由于某些指令确实允许空表达式，因此按指令验证空表达式。
  if (!exp.trim()) {
    return
  }

  try {
    new Function(
      asRawStatements
        ? ` ${exp} `
        : `return ${asParams ? `(${exp}) => {}` : `(${exp})`}`
    )
  } catch (e) {
    let message = e.message
    const keywordMatch = exp
      .replace(stripStringRE, '')
      .match(prohibitedKeywordRE)
    if (keywordMatch) {
      message = `avoid using JavaScript keyword as property name: "${
        keywordMatch[0]
      }"`
    }
    context.onError(
      createCompilerError(
        ErrorCodes.X_INVALID_EXPRESSION,
        node.loc,
        undefined,
        message
      )
    )
  }
}
