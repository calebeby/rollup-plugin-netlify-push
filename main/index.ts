import { OutputChunk, OutputAsset, Plugin } from 'rollup'
import { join } from 'path'
import { writeFile } from 'fs'
import { promisify } from 'util'

const writeFileAsync = promisify(writeFile)

export interface Route {
  route: string
  filePath: string
}

interface Opts {
  getRoutes: () => Promise<Route[]> | Route[]
  from: string
  everyRouteHeaders?: string[]
}

type Output = OutputChunk | OutputAsset

const isChunk = (output: Output): output is OutputChunk =>
  !(output as OutputAsset).isAsset

const isDynamicEntry = (output: Output): output is OutputChunk =>
  isChunk(output) && output.isDynamicEntry

const getChunkDeps = (chunk: OutputChunk) => [
  ...chunk.dynamicImports,
  ...chunk.imports,
]

interface LinkOpts {
  path: string
  rel: string
  as?: string
  crossOrigin?: boolean
}

const isString = (v: unknown): v is string => typeof v === 'string'
export const printHeader = (key: string, value: string) => `${key}: ${value}`
export const printLink = ({ path, rel, as, crossOrigin }: LinkOpts) =>
  printHeader(
    'Link',
    [`<${path}>`, `rel=${rel}`, as && `as=${as}`, crossOrigin && 'crossorigin']
      .filter(isString)
      .join('; '),
  )
export const printPush = ({
  path,
  as,
  crossOrigin,
}: {
  path: string
  as: string
  crossOrigin?: boolean
}) => printLink({ path, as, crossOrigin, rel: 'preload' })

const netlifyPush = (opts: Opts): Plugin => {
  const routesPromise = opts.getRoutes()
  return {
    name: 'rollup-plugin-netlify-push',
    async generateBundle(outputOptions, bundle) {
      const outDir = outputOptions.dir
      if (!outDir) throw new Error('netlifyPush requires output.dir')
      const routes = await routesPromise
      if (!Array.isArray(routes))
        throw new Error('getRoutes must resolve to an array')
      const dynamicEntryChunks = Object.values(bundle).filter(isDynamicEntry)

      const printRouteHeaders = async (route: Route) => {
        const headers = new Set<string>(opts.everyRouteHeaders)
        const resolved = await this.resolve(route.filePath, opts.from)
        if (!resolved || resolved.external)
          throw new Error('Routes must not be external imports')
        const resolvedPath = resolved.id
        const entryChunk = dynamicEntryChunks.find(
          c => c.facadeModuleId === resolvedPath,
        )
        if (!entryChunk)
          throw new Error(`Could not find entry chunk for ${resolvedPath}`)
        const getChunkDepsRecursive = (
          chunk: OutputChunk,
          depsSet = new Set<OutputChunk>(),
        ) => {
          depsSet.add(chunk)
          getChunkDeps(chunk).forEach(dep => {
            const depChunk = bundle[dep]
            if (isChunk(depChunk) && !depsSet.has(depChunk))
              getChunkDepsRecursive(depChunk, depsSet)
          })
          return depsSet
        }
        const routeChunks = getChunkDepsRecursive(entryChunk)
        routeChunks.forEach(chunk =>
          headers.add(
            printPush({
              path: `/${chunk.fileName}`,
              as: 'script',
              crossOrigin: true,
            }),
          ),
        )
        const stringifiedHeaders = Array.from(headers).map(h => '  ' + h)
        return route.route + '\n' + stringifiedHeaders.join('\n')
      }

      const headersFileContents = await Promise.all(
        routes.map(printRouteHeaders),
      ).then(r => r.join('\n\n'))
      const headersFilePath = join(outDir, '_headers')
      await writeFileAsync(headersFilePath, headersFileContents)
    },
  }
}

export default netlifyPush
