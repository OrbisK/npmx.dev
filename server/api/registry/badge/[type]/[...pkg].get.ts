import * as v from 'valibot'
import { hash } from 'ohash'
import { createError, getRouterParam, getQuery, setHeader } from 'h3'
import { PackageRouteParamsSchema } from '#shared/schemas/package'
import { CACHE_MAX_AGE_ONE_HOUR, ERROR_NPM_FETCH_FAILED } from '#shared/utils/constants'
import { fetchNpmPackage } from '#server/utils/npm'
import { assertValidPackageName } from '#shared/utils/npm'
import { fetchPackageWithTypesAndFiles } from '#server/utils/file-tree'
import { handleApiError } from '#server/utils/error-handler'
import {
  BADGE_COLORS,
  BADGE_RENDERERS,
  BadgeQuerySchema,
  BadgeStyleSchema,
  formatBadgeBytes,
  formatBadgeDate,
  formatBadgeNumber,
  resolveBadgeAppearance,
} from '#server/utils/badges/render'

const NPM_DOWNLOADS_API = 'https://api.npmjs.org/downloads/point'
const OSV_QUERY_API = 'https://api.osv.dev/v1/query'
const BUNDLEPHOBIA_API = 'https://bundlephobia.com/api/size'

function getLatestVersion(pkgData: globalThis.Packument): string | undefined {
  return pkgData['dist-tags']?.latest
}

async function fetchDownloads(
  packageName: string,
  period: 'last-day' | 'last-week' | 'last-month' | 'last-year',
): Promise<number> {
  try {
    const response = await fetch(`${NPM_DOWNLOADS_API}/${period}/${packageName}`)
    const data = await response.json()
    return data.downloads ?? 0
  } catch {
    return 0
  }
}

async function fetchVulnerabilities(packageName: string, version: string): Promise<number> {
  try {
    const response = await fetch(OSV_QUERY_API, {
      method: 'POST',
      body: JSON.stringify({
        version,
        package: { name: packageName, ecosystem: 'npm' },
      }),
    })
    const data = await response.json()
    return data.vulns?.length ?? 0
  } catch {
    return 0
  }
}

async function fetchInstallSize(packageName: string, version: string): Promise<number | null> {
  try {
    const response = await fetch(`${BUNDLEPHOBIA_API}?package=${packageName}@${version}`)
    const data = await response.json()
    return data.size ?? null
  } catch {
    return null
  }
}

const badgeStrategies = {
  'name': async (pkgData: globalThis.Packument) => {
    return { label: 'npm', value: pkgData.name, color: BADGE_COLORS.slate }
  },

  'version': async (pkgData: globalThis.Packument, requestedVersion?: string) => {
    const version = requestedVersion ?? getLatestVersion(pkgData) ?? 'unknown'
    return {
      label: 'version',
      value: version === 'unknown' ? version : `v${version}`,
      color: BADGE_COLORS.blue,
    }
  },

  'license': async (pkgData: globalThis.Packument) => {
    const latest = getLatestVersion(pkgData)
    const versionData = latest ? pkgData.versions?.[latest] : undefined
    const value = versionData?.license ?? 'unknown'
    return { label: 'license', value, color: BADGE_COLORS.green }
  },

  'size': async (pkgData: globalThis.Packument) => {
    const latest = getLatestVersion(pkgData)
    const versionData = latest ? pkgData.versions?.[latest] : undefined
    let bytes = versionData?.dist?.unpackedSize ?? 0
    if (latest) {
      const installSize = await fetchInstallSize(pkgData.name, latest)
      if (installSize !== null) bytes = installSize
    }
    return { label: 'install size', value: formatBadgeBytes(bytes), color: BADGE_COLORS.purple }
  },

  'downloads': async (pkgData: globalThis.Packument) => {
    const count = await fetchDownloads(pkgData.name, 'last-month')
    return { label: 'downloads/mo', value: formatBadgeNumber(count), color: BADGE_COLORS.orange }
  },

  'downloads-day': async (pkgData: globalThis.Packument) => {
    const count = await fetchDownloads(pkgData.name, 'last-day')
    return { label: 'downloads/day', value: formatBadgeNumber(count), color: BADGE_COLORS.orange }
  },

  'downloads-week': async (pkgData: globalThis.Packument) => {
    const count = await fetchDownloads(pkgData.name, 'last-week')
    return { label: 'downloads/wk', value: formatBadgeNumber(count), color: BADGE_COLORS.orange }
  },

  'downloads-month': async (pkgData: globalThis.Packument) => {
    const count = await fetchDownloads(pkgData.name, 'last-month')
    return { label: 'downloads/mo', value: formatBadgeNumber(count), color: BADGE_COLORS.orange }
  },

  'downloads-year': async (pkgData: globalThis.Packument) => {
    const count = await fetchDownloads(pkgData.name, 'last-year')
    return { label: 'downloads/yr', value: formatBadgeNumber(count), color: BADGE_COLORS.orange }
  },

  'vulnerabilities': async (pkgData: globalThis.Packument) => {
    const latest = getLatestVersion(pkgData)
    const count = latest ? await fetchVulnerabilities(pkgData.name, latest) : 0
    const isSafe = count === 0
    const color = isSafe ? BADGE_COLORS.green : BADGE_COLORS.red
    return { label: 'vulns', value: String(count), color }
  },

  'dependencies': async (pkgData: globalThis.Packument) => {
    const latest = getLatestVersion(pkgData)
    const versionData = latest ? pkgData.versions?.[latest] : undefined
    const count = Object.keys(versionData?.dependencies ?? {}).length
    return { label: 'dependencies', value: String(count), color: BADGE_COLORS.cyan }
  },

  'created': async (pkgData: globalThis.Packument) => {
    const dateStr = pkgData.time?.created ?? pkgData.time?.modified
    return { label: 'created', value: formatBadgeDate(dateStr), color: BADGE_COLORS.slate }
  },

  'updated': async (pkgData: globalThis.Packument) => {
    const dateStr = pkgData.time?.modified ?? pkgData.time?.created ?? new Date().toISOString()
    return { label: 'updated', value: formatBadgeDate(dateStr), color: BADGE_COLORS.slate }
  },

  'engines': async (pkgData: globalThis.Packument) => {
    const latest = getLatestVersion(pkgData)
    const nodeVersion = (latest && pkgData.versions?.[latest]?.engines?.node) ?? '*'
    return { label: 'node', value: nodeVersion, color: BADGE_COLORS.yellow }
  },

  'types': async (pkgData: globalThis.Packument, requestedVersion?: string) => {
    const targetVersion = requestedVersion ?? getLatestVersion(pkgData)
    const versionData = targetVersion ? pkgData.versions?.[targetVersion] : undefined

    if (versionData && hasBuiltInTypes(versionData)) {
      return { label: 'types', value: 'included', color: BADGE_COLORS.blue }
    }

    const { pkg, typesPackage, files } = await fetchPackageWithTypesAndFiles(
      pkgData.name,
      targetVersion,
    )

    const typesStatus = detectTypesStatus(pkg, typesPackage, files)

    let value: string
    let color: string

    switch (typesStatus.kind) {
      case 'included':
        value = 'included'
        color = BADGE_COLORS.blue
        break

      case '@types':
        value = '@types'
        color = BADGE_COLORS.purple
        if (typesStatus.deprecated) {
          value += ' (deprecated)'
          color = BADGE_COLORS.red
        }
        break

      case 'none':
      default:
        value = 'missing'
        color = BADGE_COLORS.slate
        break
    }

    return { label: 'types', value, color }
  },

  'maintainers': async (pkgData: globalThis.Packument) => {
    const count = pkgData.maintainers?.length ?? 0
    return { label: 'maintainers', value: String(count), color: BADGE_COLORS.cyan }
  },

  'deprecated': async (pkgData: globalThis.Packument) => {
    const latest = getLatestVersion(pkgData)
    const isDeprecated = !!(latest && pkgData.versions?.[latest]?.deprecated)
    return {
      label: 'status',
      value: isDeprecated ? 'deprecated' : 'active',
      color: isDeprecated ? BADGE_COLORS.red : BADGE_COLORS.green,
    }
  },

  'likes': async (pkgData: globalThis.Packument) => {
    const likesUtil = new PackageLikesUtils()
    const { totalLikes } = await likesUtil.getLikes(pkgData.name)

    return { label: 'likes', value: String(totalLikes ?? 0), color: BADGE_COLORS.red }
  },
}

const BadgeTypeSchema = v.picklist(Object.keys(badgeStrategies) as [string, ...string[]])

export default defineCachedEventHandler(
  async event => {
    const query = getQuery(event)
    const typeParam = getRouterParam(event, 'type')
    const pkgParamSegments = getRouterParam(event, 'pkg')?.split('/') ?? []

    if (pkgParamSegments.length === 0) {
      // TODO: throwing 404 rather than 400 as it's cacheable
      throw createError({ statusCode: 404, message: 'Package name is required.' })
    }

    const { rawPackageName, rawVersion } = parsePackageParams(pkgParamSegments)

    try {
      const { packageName, version: requestedVersion } = v.parse(PackageRouteParamsSchema, {
        packageName: rawPackageName,
        version: rawVersion,
      })

      const queryParams = v.safeParse(BadgeQuerySchema, query)
      const userColor = queryParams.success ? queryParams.output.color : undefined
      const userLabelColor = queryParams.success ? queryParams.output.labelColor : undefined
      const showName = queryParams.success && queryParams.output.name === 'true'
      const userLabel = queryParams.success ? queryParams.output.label : undefined
      const userValue = queryParams.success ? queryParams.output.value : undefined
      const badgeStyleResult = v.safeParse(BadgeStyleSchema, query.style)
      const badgeStyle = badgeStyleResult.success ? badgeStyleResult.output : 'default'

      const badgeTypeResult = v.safeParse(BadgeTypeSchema, typeParam)
      const strategyKey = badgeTypeResult.success ? badgeTypeResult.output : 'version'
      const strategy = badgeStrategies[strategyKey as keyof typeof badgeStrategies]

      assertValidPackageName(packageName)

      const pkgData = await fetchNpmPackage(packageName)
      const strategyResult = await strategy(pkgData, requestedVersion)

      const appearance = resolveBadgeAppearance({
        strategyLabel: strategyResult.label,
        strategyValue: strategyResult.value,
        strategyColor: strategyResult.color,
        badgeStyle,
        packageName,
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
        `public, max-age=${CACHE_MAX_AGE_ONE_HOUR}, s-maxage=${CACHE_MAX_AGE_ONE_HOUR}`,
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
    maxAge: CACHE_MAX_AGE_ONE_HOUR,
    swr: true,
    getKey: event => {
      const type = getRouterParam(event, 'type') ?? 'version'
      const pkg = getRouterParam(event, 'pkg') ?? ''
      const query = getQuery(event)
      return `badge:${type}:${pkg}:${hash(query)}`
    },
  },
)
