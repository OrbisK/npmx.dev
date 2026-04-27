import * as v from 'valibot'
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas'

export const BADGE_COLORS = {
  blue: '#3b82f6',
  green: '#22c55e',
  purple: '#a855f7',
  orange: '#f97316',
  red: '#ef4444',
  cyan: '#06b6d4',
  slate: '#64748b',
  yellow: '#eab308',
  black: '#0a0a0a',
  white: '#ffffff',
} as const

const BADGE_PADDING_X = 8
const MIN_BADGE_TEXT_WIDTH = 40
export const FALLBACK_VALUE_EXTRA_PADDING_X = 8
const SHIELDS_LABEL_PADDING_X = 5
const COMPACT_BADGE_PADDING_X = 5

const BADGE_FONT_SHORTHAND = 'normal normal 400 11px Geist, system-ui, -apple-system, sans-serif'
const SHIELDS_FONT_SHORTHAND = 'normal normal 400 11px Verdana, Geneva, DejaVu Sans, sans-serif'

let cachedCanvasContext: SKRSContext2D | null | undefined

const NARROW_CHARS = new Set([' ', '!', '"', "'", '(', ')', '*', ',', '-', '.', ':', ';', '|'])
const MEDIUM_CHARS = new Set([
  '#',
  '$',
  '+',
  '/',
  '<',
  '=',
  '>',
  '?',
  '@',
  '[',
  '\\',
  ']',
  '^',
  '_',
  '`',
  '{',
  '}',
  '~',
])

const FALLBACK_WIDTHS = {
  default: {
    narrow: 3,
    medium: 5,
    digit: 6,
    uppercase: 7,
    other: 6,
  },
  shieldsio: {
    narrow: 3,
    medium: 5,
    digit: 6,
    uppercase: 7,
    other: 5.5,
  },
} as const

function estimateTextWidth(text: string, fallbackFont: 'default' | 'shieldsio'): number {
  // Heuristic coefficients tuned to keep fallback rendering close to canvas metrics.
  const widths = FALLBACK_WIDTHS[fallbackFont]
  let totalWidth = 0

  for (const character of text) {
    if (NARROW_CHARS.has(character)) {
      totalWidth += widths.narrow
      continue
    }

    if (MEDIUM_CHARS.has(character)) {
      totalWidth += widths.medium
      continue
    }

    if (/\d/.test(character)) {
      totalWidth += widths.digit
      continue
    }

    if (/[A-Z]/.test(character)) {
      totalWidth += widths.uppercase
      continue
    }

    totalWidth += widths.other
  }

  return Math.max(1, Math.round(totalWidth))
}

function getCanvasContext(): SKRSContext2D | null {
  if (cachedCanvasContext !== undefined) {
    return cachedCanvasContext
  }

  try {
    cachedCanvasContext = createCanvas(1, 1).getContext('2d')
  } catch {
    cachedCanvasContext = null
  }

  return cachedCanvasContext
}

function measureTextWidth(text: string, font: string): number | null {
  const context = getCanvasContext()

  if (context) {
    context.font = font

    const measuredWidth = context.measureText(text).width

    if (Number.isFinite(measuredWidth) && measuredWidth > 0) {
      return Math.ceil(measuredWidth)
    }
  }

  return null
}

function measureDefaultTextWidth(text: string, fallbackExtraPadding = 0): number {
  const measuredWidth = measureTextWidth(text, BADGE_FONT_SHORTHAND)

  if (measuredWidth !== null) {
    return Math.max(MIN_BADGE_TEXT_WIDTH, measuredWidth + BADGE_PADDING_X * 2)
  }

  return Math.max(
    MIN_BADGE_TEXT_WIDTH,
    estimateTextWidth(text, 'default') + BADGE_PADDING_X * 2 + fallbackExtraPadding,
  )
}

function measureCompactTextWidth(text: string): number {
  const measuredWidth = measureTextWidth(text, BADGE_FONT_SHORTHAND)

  if (measuredWidth !== null) {
    return measuredWidth + COMPACT_BADGE_PADDING_X * 2
  }

  return estimateTextWidth(text, 'default') + COMPACT_BADGE_PADDING_X * 2
}

function measureShieldsTextLength(text: string): number {
  const measuredWidth = measureTextWidth(text, SHIELDS_FONT_SHORTHAND)

  if (measuredWidth !== null) {
    return Math.max(1, measuredWidth)
  }

  return estimateTextWidth(text, 'shieldsio')
}

export function escapeBadgeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * The character used by compare badges to separate `from` and `to` values.
 * Exported so renderers can detect it for vertical-alignment adjustment.
 */
export const COMPARE_ARROW = '→'

/**
 * Wrap any compare-arrow occurrences in an already-XML-escaped value so the
 * arrow renders aligned with the surrounding digits/letters instead of
 * sitting at the math axis (visibly below the digits' visual middle in Geist
 * and most sans-serif fallbacks at this font-size).
 *
 * Every segment goes into its own `<tspan>` so the dy adjustments are
 * relative-to-previous-tspan and don't get out of sync with bare text inside
 * the parent `<text>` (browsers handle that interleaving inconsistently and
 * the result is visibly mis-aligned `from` vs. `to` digits). The arrow itself
 * gets `dy="-1"` (one user unit up); the next segment then gets `dy="1"` to
 * return to the parent baseline.
 *
 * Inputs without the arrow are returned untouched.
 */
export function wrapCompareArrow(escapedValue: string): string {
  if (!escapedValue.includes(COMPARE_ARROW)) return escapedValue
  const parts = escapedValue.split(COMPARE_ARROW)
  let result = `<tspan>${parts[0]}</tspan>`
  for (let i = 1; i < parts.length; i++) {
    result += `<tspan dy="-1">${COMPARE_ARROW}</tspan><tspan dy="1">${parts[i]}</tspan>`
  }
  return result
}

function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function getBadgeContrastTextColor(bgHex: string): string {
  let clean = bgHex.replace('#', '')
  if (clean.length === 3)
    clean = clean[0]! + clean[0]! + clean[1]! + clean[1]! + clean[2]! + clean[2]!
  if (!/^[0-9a-f]{6}$/i.test(clean)) return '#ffffff'
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
  // threshold where contrast ratio with white equals contrast ratio with black
  return luminance > 0.179 ? '#000000' : '#ffffff'
}

export interface BadgeRenderParams {
  finalColor: string
  finalLabel: string
  finalLabelColor: string
  finalValue: string
  labelTextColor: string
  valueTextColor: string
}

function renderGeistBadgeSvg(
  params: BadgeRenderParams & { leftWidth: number; rightWidth: number },
): string {
  const {
    finalColor,
    finalLabel,
    finalLabelColor,
    finalValue,
    labelTextColor,
    valueTextColor,
    leftWidth,
    rightWidth,
  } = params
  const totalWidth = leftWidth + rightWidth
  const height = 20
  const escapedLabel = wrapCompareArrow(escapeBadgeXML(finalLabel))
  const escapedValue = wrapCompareArrow(escapeBadgeXML(finalValue))
  // The aria-label ignores tspan adjustments and uses the raw arrow so screen
  // readers receive the original "from → to" text.
  const ariaLabel = `${escapeBadgeXML(finalLabel)}: ${escapeBadgeXML(finalValue)}`

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" role="img" aria-label="${ariaLabel}">
  <clipPath id="r">
    <rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="${height}" fill="${finalLabelColor}"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="${height}" fill="${finalColor}"/>
  </g>
  <g text-anchor="middle" font-family="Geist, system-ui, -apple-system, sans-serif" font-size="11">
    <text x="${leftWidth / 2}" y="14" fill="${labelTextColor}">${escapedLabel}</text>
    <text x="${leftWidth + rightWidth / 2}" y="14" fill="${valueTextColor}">${escapedValue}</text>
  </g>
</svg>
  `.trim()
}

function renderDefaultBadgeSvg(params: BadgeRenderParams): string {
  const leftWidth =
    params.finalLabel.trim().length === 0 ? 0 : measureDefaultTextWidth(params.finalLabel)
  const rightWidth = measureDefaultTextWidth(params.finalValue, FALLBACK_VALUE_EXTRA_PADDING_X)
  return renderGeistBadgeSvg({ ...params, leftWidth, rightWidth })
}

function renderCompactBadgeSvg(params: BadgeRenderParams): string {
  const leftWidth =
    params.finalLabel.trim().length === 0 ? 0 : measureCompactTextWidth(params.finalLabel)
  const rightWidth = measureCompactTextWidth(params.finalValue)
  return renderGeistBadgeSvg({ ...params, leftWidth, rightWidth })
}

function renderShieldsBadgeSvg(params: BadgeRenderParams): string {
  const { finalColor, finalLabel, finalLabelColor, finalValue, labelTextColor, valueTextColor } =
    params
  const hasLabel = finalLabel.trim().length > 0

  const leftTextLength = hasLabel ? measureShieldsTextLength(finalLabel) : 0
  const rightTextLength = measureShieldsTextLength(finalValue)
  const leftWidth = hasLabel ? leftTextLength + SHIELDS_LABEL_PADDING_X * 2 : 0
  const rightWidth = rightTextLength + SHIELDS_LABEL_PADDING_X * 2
  const totalWidth = leftWidth + rightWidth
  const height = 20
  const escapedLabelRaw = escapeBadgeXML(finalLabel)
  const escapedValueRaw = escapeBadgeXML(finalValue)
  const escapedLabel = wrapCompareArrow(escapedLabelRaw)
  const escapedValue = wrapCompareArrow(escapedValueRaw)
  const title = `${escapedLabelRaw}: ${escapedValueRaw}`

  const leftCenter = Math.round((leftWidth / 2) * 10)
  const rightCenter = Math.round((leftWidth + rightWidth / 2) * 10)
  const leftTextLengthAttr = leftTextLength * 10
  const rightTextLengthAttr = rightTextLength * 10

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" role="img" aria-label="${title}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="${height}" fill="${finalLabelColor}"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="${height}" fill="${finalColor}"/>
    <rect width="${totalWidth}" height="${height}" fill="url(#s)"/>
  </g>
  <g text-anchor="middle" font-family="Verdana, Geneva, DejaVu Sans, sans-serif" text-rendering="geometricPrecision" font-size="110">
    <text aria-hidden="true" x="${leftCenter}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${leftTextLengthAttr}">${escapedLabel}</text>
    <text x="${leftCenter}" y="140" transform="scale(.1)" fill="${labelTextColor}" textLength="${leftTextLengthAttr}">${escapedLabel}</text>
    <text aria-hidden="true" x="${rightCenter}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${rightTextLengthAttr}">${escapedValue}</text>
    <text x="${rightCenter}" y="140" transform="scale(.1)" fill="${valueTextColor}" textLength="${rightTextLengthAttr}">${escapedValue}</text>
  </g>
</svg>
  `.trim()
}

export const BADGE_RENDERERS = {
  default: renderDefaultBadgeSvg,
  shieldsio: renderShieldsBadgeSvg,
  compact: renderCompactBadgeSvg,
} as const

export const BadgeStyleSchema = v.picklist(['default', 'shieldsio', 'compact'])
export type BadgeStyle = v.InferOutput<typeof BadgeStyleSchema>

export const COMPACT_LABEL_MAP: Record<string, string> = {
  'install size': 'size',
  'downloads/day': 'dl/day',
  'downloads/wk': 'dl/wk',
  'downloads/mo': 'dl/mo',
  'downloads/yr': 'dl/yr',
  'dependencies': 'deps',
  'maintainers': 'maint',
}

export const BadgeSafeStringSchema = v.pipe(v.string(), v.regex(/^[^<>"&]*$/, 'Invalid characters'))

export const BadgeSafeColorSchema = v.pipe(
  v.string(),
  v.transform(value => (value.startsWith('#') ? value : `#${value}`)),
  v.hexColor(),
)

export const BadgeQuerySchema = v.object({
  name: v.optional(v.string()),
  label: v.optional(BadgeSafeStringSchema),
  value: v.optional(BadgeSafeStringSchema),
  color: v.optional(BadgeSafeColorSchema),
  labelColor: v.optional(BadgeSafeColorSchema),
})

export interface ResolveBadgeAppearanceInput {
  strategyLabel: string
  strategyValue: string
  strategyColor: string
  badgeStyle: BadgeStyle
  packageName: string
  userLabel?: string
  userValue?: string
  userColor?: string
  userLabelColor?: string
  showName?: boolean
}

export interface ResolvedBadgeAppearance {
  finalLabel: string
  finalValue: string
  finalColor: string
  finalLabelColor: string
  labelTextColor: string
  valueTextColor: string
}

/**
 * Apply user overrides + style-specific label shortening + contrast text
 * colors to a strategy's raw output. Used by all badge endpoints to keep
 * customization parity (`label`, `value`, `color`, `labelColor`, `name`,
 * `style=compact` shortening) consistent.
 */
export function resolveBadgeAppearance(
  input: ResolveBadgeAppearanceInput,
): ResolvedBadgeAppearance {
  const strategyLabel =
    input.badgeStyle === 'compact'
      ? (COMPACT_LABEL_MAP[input.strategyLabel] ?? input.strategyLabel)
      : input.strategyLabel

  const finalLabel = input.userLabel
    ? input.userLabel
    : input.showName
      ? input.packageName
      : strategyLabel
  const finalValue = input.userValue ? input.userValue : input.strategyValue

  const rawColor = input.userColor ?? input.strategyColor
  const finalColor = rawColor.startsWith('#') ? rawColor : `#${rawColor}`

  const defaultLabelColor = input.badgeStyle === 'shieldsio' ? '#555' : '#0a0a0a'
  const rawLabelColor = input.userLabelColor ?? defaultLabelColor
  const finalLabelColor = rawLabelColor.startsWith('#') ? rawLabelColor : `#${rawLabelColor}`

  return {
    finalLabel,
    finalValue,
    finalColor,
    finalLabelColor,
    labelTextColor: getBadgeContrastTextColor(finalLabelColor),
    valueTextColor: getBadgeContrastTextColor(finalColor),
  }
}

export function formatBadgeBytes(bytes: number): string {
  if (!+bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  const value = parseFloat((bytes / Math.pow(k, i)).toFixed(2))
  return `${value} ${sizes[i]}`
}

export function formatBadgeNumber(num: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(
    num,
  )
}

export function formatBadgeDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
