import { Route } from '../main'
import {
  transformFileAsync,
  PluginObj,
  types as t,
  NodePath,
} from '@babel/core'

const parseRoutes = async (routesFilePath: string): Promise<Route[]> => {
  const routes: Route[] = []
  const plugin: PluginObj = {
    name: 'retrieve-routes',
    visitor: {
      Import(path) {
        const parent = path.parentPath
        if (!parent.isCallExpression()) return
        const fileArg = parent.node.arguments[0]
        const filePath = t.isStringLiteral(fileArg) && fileArg.value
        if (!filePath) return
        const parentObject = parent.findParent(p =>
          p.isObjectExpression(),
        ) as NodePath<t.ObjectExpression>
        const routeProp = parentObject.node.properties.find(
          p =>
            t.isObjectProperty(p) &&
            t.isIdentifier(p.key) &&
            p.key.name === 'path',
        ) as t.ObjectProperty | undefined
        if (!routeProp) return
        const route =
          t.isStringLiteral(routeProp.value) && routeProp.value.value
        if (route) routes.push({ filePath, route })
      },
    },
    manipulateOptions(_opts, parserOpts) {
      parserOpts.plugins.push('dynamicImport')
    },
  }

  await transformFileAsync(routesFilePath, {
    plugins: [plugin],
    babelrc: false,
  })

  return routes
}

export default parseRoutes
