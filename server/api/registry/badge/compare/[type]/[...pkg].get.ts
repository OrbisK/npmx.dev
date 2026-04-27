import * as v from 'valibot'
import { hash } from 'ohash'
import { createError, getRouterParam, getQuery, setHeader } from 'h3'
import { PackageRouteParamsSchema } from '#shared/schemas/package'
import { CACHE_MAX_AGE_ONE_YEAR, ERROR_NPM_FETCH_FAILED } from '#shared/utils/constants'
import { fetchNpmPackage } from '#server/utils/npm'
import { assertValidPackageName } from '#shared/utils/npm'
import { handleApiError } from '#server/utils/error-handler'
import {
  BADGE_COLORS,
  BADGE_RENDERERS,
  BadgeQuerySchema,
  BadgeStyleSchema,
  formatBadgeBytes,
  resolveBadgeAppearance,
} from '#server/utils/badges/render'

const BUNDLEPHOBIA_API = 'https://bundlephobia.com/api/size'
const COMPARE_ARROW = '→'
const SIZE_DELTA_THRESHOLD = 0.05

interface CompareStrategyContext {
  fromPkgData: globalThis.Packument
  fromVersion: string
  toPkgData: globalThis.Packument
  toVersion: string
}

interface CompareStrategyResult {
  label: string
  fromValue: string
  toValue: string
  color: string
}

function getVersionData(
  pkgData: globalThis.Packument,
  version: string,
): PackumentVersion | undefined {
  return pkgData.versions?.[version]
}

function assertVersionExists(pkgData: globalThis.Packument, version: string, role: string) {
  if (!getVersionData(pkgData, version)) {
    throw createError({
      statusCode: 404,
      message: `Version "${version}" of "${pkgData.name}" not found (${role}).`,
    })
  }
}

function deltaColor(from: number, to: number, threshold = SIZE_DELTA_THRESHOLD): string {
  if (from === to) return BADGE_COLORS.slate
  if (from === 0) {
    return to > 0 ? BADGE_COLORS.red : BADGE_COLORS.slate
  }
  const ratio = (to - from) / from
  if (Math.abs(ratio) < threshold) return BADGE_COLORS.slate
  return ratio > 0 ? BADGE_COLORS.red : BADGE_COLORS.green
}

async function fetchInstallSize(packageName: string, version: string): Promise<number | null> {
  try {
    const response = await fetch(`${BUNDLEPHOBIA_API}?package=${packageName}@${version}`)
    if (!response.ok) return null
    const data = await response.json()
    return typeof data.size === 'number' ? data.size : null
  } catch {
    return null
  }
}

async function resolveSize(pkgData: globalThis.Packument, version: string): Promise<number> {
  const installSize = await fetchInstallSize(pkgData.name, version)
  if (installSize !== null) return installSize
  return getVersionData(pkgData, version)?.dist?.unpackedSize ?? 0
}

const compareBadgeStrategies = {
  version: async ({
    fromVersion,
    toVersion,
  }: CompareStrategyContext): Promise<CompareStrategyResult> => {
    return {
      label: 'version',
      fromValue: `v${fromVersion}`,
      toValue: `v${toVersion}`,
      color: BADGE_COLORS.blue,
    }
  },

  size: async ({
    fromPkgData,
    fromVersion,
    toPkgData,
    toVersion,
  }: CompareStrategyContext): Promise<CompareStrategyResult> => {
    const [fromBytes, toBytes] = await Promise.all([
      resolveSize(fromPkgData, fromVersion),
      resolveSize(toPkgData, toVersion),
    ])
    return {
      label: 'install size',
      fromValue: formatBadgeBytes(fromBytes),
      toValue: formatBadgeBytes(toBytes),
      color: deltaColor(fromBytes, toBytes),
    }
  },

  dependencies: async ({
    fromPkgData,
    fromVersion,
    toPkgData,
    toVersion,
  }: CompareStrategyContext): Promise<CompareStrategyResult> => {
    const fromCount = Object.keys(
      getVersionData(fromPkgData, fromVersion)?.dependencies ?? {},
    ).length
    const toCount = Object.keys(getVersionData(toPkgData, toVersion)?.dependencies ?? {}).length
    return {
      label: 'dependencies',
      fromValue: String(fromCount),
      toValue: String(toCount),
      color: deltaColor(fromCount, toCount),
    }
  },

  license: async ({
    fromPkgData,
    fromVersion,
    toPkgData,
    toVersion,
  }: CompareStrategyContext): Promise<CompareStrategyResult> => {
    const fromLicense = getVersionData(fromPkgData, fromVersion)?.license ?? 'unknown'
    const toLicense = getVersionData(toPkgData, toVersion)?.license ?? 'unknown'
    return {
      label: 'license',
      fromValue: fromLicense,
      toValue: toLicense,
      color: fromLicense === toLicense ? BADGE_COLORS.green : BADGE_COLORS.yellow,
    }
  },

  engines: async ({
    fromPkgData,
    fromVersion,
    toPkgData,
    toVersion,
  }: CompareStrategyContext): Promise<CompareStrategyResult> => {
    const fromEngine = getVersionData(fromPkgData, fromVersion)?.engines?.node ?? '*'
    const toEngine = getVersionData(toPkgData, toVersion)?.engines?.node ?? '*'
    return {
      label: 'node',
      fromValue: fromEngine,
      toValue: toEngine,
      color: fromEngine === toEngine ? BADGE_COLORS.slate : BADGE_COLORS.yellow,
    }
  },
}

const CompareBadgeTypeSchema = v.picklist(
  Object.keys(compareBadgeStrategies) as [string, ...string[]],
)

interface CompareTarget {
  packageName: string
  version: string
}

interface ParsedCompareUrl {
  from: CompareTarget
  to: CompareTarget
  /** True when both sides resolve to the same package name. Lets us de-dupe the
   *  npm registry fetch and pick a more compact value format. */
  isSamePackage: boolean
}

/**
 * Parse the path segments after `/api/registry/badge/compare/{type}/`.
 *
 * Supports two forms:
 * - **Same-package shorthand**: `{pkg}/v/{from}...{to}` —
 *   e.g. `nuxt/v/2.18.1...4.3.1`
 * - **Cross-package** (uses `vs` separator): `{pkgA}/v/{verA}/vs/{pkgB}/v/{verB}` —
 *   e.g. `nuxt/v/4.3.1/vs/next/v/15.0.0`
 *
 * Returns null on shapes that don't match either form so the handler can
 * surface a helpful 400.
 */
function parseCompareUrlSegments(segments: string[]): ParsedCompareUrl | null {
  const vsIndex = segments.indexOf('vs')

  if (vsIndex !== -1) {
    const left = segments.slice(0, vsIndex)
    const right = segments.slice(vsIndex + 1)
    if (left.length === 0 || right.length === 0) return null

    const leftParsed = parsePackageParams(left)
    const rightParsed = parsePackageParams(right)
    if (!leftParsed.rawVersion || !rightParsed.rawVersion) return null

    return {
      from: { packageName: leftParsed.rawPackageName, version: leftParsed.rawVersion },
      to: { packageName: rightParsed.rawPackageName, version: rightParsed.rawVersion },
      isSamePackage: leftParsed.rawPackageName === rightParsed.rawPackageName,
    }
  }

  // Same-package shorthand
  const parsed = parsePackageParams(segments)
  if (!parsed.rawVersion) return null
  const range = parseVersionRange(parsed.rawVersion)
  if (!range) return null
  return {
    from: { packageName: parsed.rawPackageName, version: range.from },
    to: { packageName: parsed.rawPackageName, version: range.to },
    isSamePackage: true,
  }
}

function buildCompareValue(result: CompareStrategyResult): string {
  return `${result.fromValue} ${COMPARE_ARROW} ${result.toValue}`
}

export default defineCachedEventHandler(
  async event => {
    const query = getQuery(event)
    const typeParam = getRouterParam(event, 'type')
    const pkgParamSegments = getRouterParam(event, 'pkg')?.split('/') ?? []

    if (pkgParamSegments.length === 0) {
      throw createError({ statusCode: 404, message: 'Package name is required.' })
    }

    const parsedUrl = parseCompareUrlSegments(pkgParamSegments)
    if (!parsedUrl) {
      throw createError({
        statusCode: 400,
        message:
          'Invalid compare URL. Use `{pkg}/v/{from}...{to}` for same-package compare or `{pkgA}/v/{verA}/vs/{pkgB}/v/{verB}` for cross-package compare.',
      })
    }

    try {
      const fromParams = v.parse(PackageRouteParamsSchema, {
        packageName: parsedUrl.from.packageName,
        version: parsedUrl.from.version,
      })
      const toParams = v.parse(PackageRouteParamsSchema, {
        packageName: parsedUrl.to.packageName,
        version: parsedUrl.to.version,
      })
      // Both sides use the optional-version schema, but at this point the
      // URL parser guarantees a version is present for each side.
      const fromVersion = fromParams.version!
      const toVersion = toParams.version!

      assertValidPackageName(fromParams.packageName)
      assertValidPackageName(toParams.packageName)

      const queryParams = v.safeParse(BadgeQuerySchema, query)
      const userColor = queryParams.success ? queryParams.output.color : undefined
      const userLabelColor = queryParams.success ? queryParams.output.labelColor : undefined
      const showName = queryParams.success && queryParams.output.name === 'true'
      const userLabel = queryParams.success ? queryParams.output.label : undefined
      const userValue = queryParams.success ? queryParams.output.value : undefined
      const badgeStyleResult = v.safeParse(BadgeStyleSchema, query.style)
      const badgeStyle = badgeStyleResult.success ? badgeStyleResult.output : 'default'

      const badgeTypeResult = v.safeParse(CompareBadgeTypeSchema, typeParam)
      if (!badgeTypeResult.success) {
        throw createError({
          statusCode: 404,
          message: `Compare badge type "${typeParam}" is not supported. Supported types: ${Object.keys(compareBadgeStrategies).join(', ')}.`,
        })
      }
      const strategy =
        compareBadgeStrategies[badgeTypeResult.output as keyof typeof compareBadgeStrategies]

      const [fromPkgData, toPkgData] = parsedUrl.isSamePackage
        ? await fetchNpmPackage(fromParams.packageName).then(d => [d, d] as const)
        : await Promise.all([
            fetchNpmPackage(fromParams.packageName),
            fetchNpmPackage(toParams.packageName),
          ])

      assertVersionExists(fromPkgData, fromVersion, 'from')
      assertVersionExists(toPkgData, toVersion, 'to')

      const strategyResult = await strategy({
        fromPkgData,
        fromVersion,
        toPkgData,
        toVersion,
      })

      // The rendered value never includes package names (cross-package badges
      // stay visually compact; package context lives in the URL/aria-label).
      // For `name=true` we mirror the regular single-package badge behavior
      // and put the package name in the label — for cross-package this means
      // both names joined by the compare arrow, e.g. `nuxt → next`.
      const appearancePackageName = parsedUrl.isSamePackage
        ? fromPkgData.name
        : `${fromPkgData.name} ${COMPARE_ARROW} ${toPkgData.name}`

      const appearance = resolveBadgeAppearance({
        strategyLabel: strategyResult.label,
        strategyValue: buildCompareValue(strategyResult),
        strategyColor: strategyResult.color,
        badgeStyle,
        packageName: appearancePackageName,
        userLabel,
        userValue,
        userColor,
        userLabelColor,
        showName,
      })

      const renderFn = BADGE_RENDERERS[badgeStyle]
      const svg = renderFn(appearance)

      setHeader(event, 'Content-Type', 'image/svg+xml')
      setHeader(
        event,
        'Cache-Control',
        `public, max-age=${CACHE_MAX_AGE_ONE_YEAR}, s-maxage=${CACHE_MAX_AGE_ONE_YEAR}`,
      )

      return svg
    } catch (error: unknown) {
      handleApiError(error, {
        statusCode: 502,
        message: ERROR_NPM_FETCH_FAILED,
      })
    }
  },
  {
    // Comparing two pinned versions (same- or cross-package) is immutable,
    // so cache permanently and let SWR keep things fresh.
    maxAge: CACHE_MAX_AGE_ONE_YEAR,
    swr: true,
    getKey: event => {
      const type = getRouterParam(event, 'type') ?? ''
      const pkg = getRouterParam(event, 'pkg') ?? ''
      const query = getQuery(event)
      return `badge-compare:${type}:${pkg}:${hash(query)}`
    },
  },
)
