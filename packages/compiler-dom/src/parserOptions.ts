import {
  TextModes,
  ParserOptions,
  ElementNode,
  Namespaces,
  NodeTypes,
  isBuiltInType
} from '@vue/compiler-core'
import { makeMap, isVoidTag, isHTMLTag, isSVGTag } from '@vue/shared'
import { TRANSITION, TRANSITION_GROUP } from './runtimeHelpers'
import { decodeHtml } from './decodeHtml'
import { decodeHtmlBrowser } from './decodeHtmlBrowser'

const isRawTextContainer = /*#__PURE__*/ makeMap(
  'style,iframe,script,noscript',
  true
)

export const enum DOMNamespaces {
  HTML = Namespaces.HTML,
  SVG,
  MATH_ML
}

export const parserOptions: ParserOptions = {
  isVoidTag,
  isNativeTag: tag => isHTMLTag(tag) || isSVGTag(tag),
  isPreTag: tag => tag === 'pre',
  decodeEntities: __BROWSER__ ? decodeHtmlBrowser : decodeHtml,

  isBuiltInComponent: (tag: string): symbol | undefined => {
    if (isBuiltInType(tag, `Transition`)) {
      return TRANSITION
    } else if (isBuiltInType(tag, `TransitionGroup`)) {
      return TRANSITION_GROUP
    }
  },

  // https://html.spec.whatwg.org/multipage/parsing.html#tree-construction-dispatcher
  // 获取命名空间
  getNamespace(tag: string, parent: ElementNode | undefined): DOMNamespaces {
    let ns = parent ? parent.ns : DOMNamespaces.HTML

    if (parent && ns === DOMNamespaces.MATH_ML) {
      if (parent.tag === 'annotation-xml') {
        if (tag === 'svg') {
          return DOMNamespaces.SVG
        }
        if (
          parent.props.some(
            a =>
              a.type === NodeTypes.ATTRIBUTE &&
              a.name === 'encoding' &&
              a.value != null &&
              (a.value.content === 'text/html' ||
                a.value.content === 'application/xhtml+xml')
          )
        ) {
          ns = DOMNamespaces.HTML
        }
      } else if (
        /^m(?:[ions]|text)$/.test(parent.tag) &&
        tag !== 'mglyph' &&
        tag !== 'malignmark'
      ) {
        ns = DOMNamespaces.HTML
      }
    } else if (parent && ns === DOMNamespaces.SVG) {
      if (
        parent.tag === 'foreignObject' ||
        parent.tag === 'desc' ||
        parent.tag === 'title'
      ) {
        ns = DOMNamespaces.HTML
      }
    }

    if (ns === DOMNamespaces.HTML) {
      if (tag === 'svg') {
        return DOMNamespaces.SVG
      }
      if (tag === 'math') {
        return DOMNamespaces.MATH_ML
      }
    }
    return ns
  },

  // https://html.spec.whatwg.org/multipage/parsing.html#parsing-html-fragments
  // 获取模板字符串模式
  getTextMode({ tag, ns }: ElementNode): TextModes {
    // 节点命名空间是html时
    if (ns === DOMNamespaces.HTML) {
      // 当节点为textarea或title时
      if (tag === 'textarea' || tag === 'title') {
        return TextModes.RCDATA
      }
      // 当节点为style,iframe,script,noscript时
      if (isRawTextContainer(tag)) {
        return TextModes.RAWTEXT
      }
    }
    // 非html命名空间的节点归类到DATA
    return TextModes.DATA
  }
}
