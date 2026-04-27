import { expect, test } from './test-utils'

function toLocalUrl(baseURL: string | undefined, path: string): string {
  if (!baseURL) return path
  return baseURL.endsWith('/') ? `${baseURL}${path.slice(1)}` : `${baseURL}${path}`
}

async function fetchBadge(page: { request: { get: (url: string) => Promise<any> } }, url: string) {
  const response = await page.request.get(url)
  const body = await response.text()
  return { response, body }
}

function getSvgWidth(body: string): number {
  const match = body.match(/<svg[^>]*\swidth="(\d+)"/)
  return match ? Number(match[1]) : 0
}

/** The aria-label preserves the canonical `{label}: {value}` text without the
 *  `<tspan>` wrapping that the renderer applies around compare arrows for
 *  vertical alignment. Use it whenever the test cares about *what the badge
 *  reads as*, rather than the exact tspan markup. */
function getAriaLabel(body: string): string {
  return body.match(/aria-label="([^"]+)"/)?.[1] ?? ''
}

const ARROW = '→'

test.describe('compare badge API', () => {
  test.describe('per-strategy rendering', () => {
    test('version compare renders both versions with arrow', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/version/nuxt/v/2.18.1...4.3.1`)
      const { response, body } = await fetchBadge(page, url)

      expect(response.status()).toBe(200)
      expect(response.headers()['content-type']).toContain('image/svg+xml')
      expect(body).toContain('>version<')
      expect(getAriaLabel(body)).toContain(`v2.18.1 ${ARROW} v4.3.1`)
      expect(body).toContain('fill="#3b82f6"')
    })

    test('size compare renders both formatted sizes with arrow', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/size/nuxt/v/2.18.1...4.3.1`)
      const { response, body } = await fetchBadge(page, url)

      expect(response.status()).toBe(200)
      expect(body).toContain('>install size<')
      expect(getAriaLabel(body)).toContain(`14.22 KB ${ARROW} 52.7 KB`)
    })

    test('size compare colors red when size grew significantly', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/size/nuxt/v/2.18.1...4.3.1`)
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('fill="#ef4444"')
    })

    test('size compare colors green when size shrunk significantly', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/size/nuxt/v/4.3.1...2.18.1`)
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('fill="#22c55e"')
    })

    test('size compare colors slate when sizes are identical', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/size/nuxt/v/4.3.1...4.3.1`)
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('fill="#64748b"')
    })

    test('dependencies compare renders both counts with arrow', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/2.18.1...4.3.1`,
      )
      const { response, body } = await fetchBadge(page, url)

      expect(response.status()).toBe(200)
      expect(body).toContain('>dependencies<')
      expect(getAriaLabel(body)).toContain(`15 ${ARROW} 57`)
    })

    test('dependencies compare colors red when dep count grew', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/2.18.1...4.3.1`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('fill="#ef4444"')
    })

    test('dependencies compare colors green when dep count shrunk', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/4.3.1...2.18.1`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('fill="#22c55e"')
    })

    test('license compare colors green when license unchanged', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/license/nuxt/v/2.18.1...4.3.1`)
      const { response, body } = await fetchBadge(page, url)

      expect(response.status()).toBe(200)
      expect(body).toContain('>license<')
      expect(getAriaLabel(body)).toContain(`MIT ${ARROW} MIT`)
      expect(body).toContain('fill="#22c55e"')
    })

    test('engines compare renders both ranges and yellow when changed', async ({
      page,
      baseURL,
    }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/engines/nuxt/v/2.18.1...4.3.1`)
      const { response, body } = await fetchBadge(page, url)

      expect(response.status()).toBe(200)
      expect(body).toContain('>node<')
      expect(getAriaLabel(body)).toContain(ARROW)
      expect(body).toContain('fill="#eab308"')
    })

    test('engines compare colors slate when range unchanged', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/engines/nuxt/v/4.3.1...4.0.0-alpha.4`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('fill="#64748b"')
    })
  })

  test.describe('routing', () => {
    test('scoped package compare renders successfully', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/version/@nuxt/kit/v/3.20.0...3.21.0`,
      )
      const { response, body } = await fetchBadge(page, url)

      expect(response.status()).toBe(200)
      expect(getAriaLabel(body)).toContain(`v3.20.0 ${ARROW} v3.21.0`)
    })

    test('missing version range returns 400', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/version/nuxt`)
      const { response } = await fetchBadge(page, url)

      expect(response.status()).toBe(400)
    })

    test('invalid version range format returns 400', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/version/nuxt/v/2.18.1`)
      const { response } = await fetchBadge(page, url)

      expect(response.status()).toBe(400)
    })

    test('non-existent from-version returns 404', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/0.0.99...4.3.1`,
      )
      const { response } = await fetchBadge(page, url)

      expect(response.status()).toBe(404)
    })

    test('non-existent to-version returns 404', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/4.3.1...99.99.99`,
      )
      const { response } = await fetchBadge(page, url)

      expect(response.status()).toBe(404)
    })

    test('unsupported badge type returns 404', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/downloads/nuxt/v/2.18.1...4.3.1`)
      const { response } = await fetchBadge(page, url)

      expect(response.status()).toBe(404)
    })

    test('missing package returns 404', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/version/`)
      const { response } = await fetchBadge(page, url)

      expect(response.status()).toBe(404)
    })

    test('long-cache headers set on success', async ({ page, baseURL }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/version/nuxt/v/2.18.1...4.3.1`)
      const { response } = await fetchBadge(page, url)

      const cacheControl = response.headers()['cache-control']
      expect(cacheControl).toContain(`s-maxage=${60 * 60 * 24 * 365}`)
    })
  })

  test.describe('styles', () => {
    test('default style uses Geist font', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/version/nuxt/v/2.18.1...4.3.1?style=default`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('font-family="Geist, system-ui, -apple-system, sans-serif"')
    })

    test('shieldsio style uses Verdana font', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/version/nuxt/v/2.18.1...4.3.1?style=shieldsio`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('font-family="Verdana, Geneva, DejaVu Sans, sans-serif"')
    })

    test('compact style shortens long built-in labels', async ({ page, baseURL }) => {
      const cases: Array<[string, string, string]> = [
        ['size', 'install size', 'size'],
        ['dependencies', 'dependencies', 'deps'],
      ]
      for (const [type, fullLabel, shortLabel] of cases) {
        const url = toLocalUrl(
          baseURL,
          `/api/registry/badge/compare/${type}/nuxt/v/2.18.1...4.3.1?style=compact`,
        )
        const { body } = await fetchBadge(page, url)
        expect(body, `${type} should show ${shortLabel}`).toContain(`>${shortLabel}<`)
        expect(body, `${type} should not show ${fullLabel}`).not.toContain(`>${fullLabel}<`)
      }
    })

    test('compact style produces a narrower badge than default for shortened labels', async ({
      page,
      baseURL,
    }) => {
      const defaultUrl = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/2.18.1...4.3.1?style=default`,
      )
      const compactUrl = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/2.18.1...4.3.1?style=compact`,
      )
      const { body: defaultBody } = await fetchBadge(page, defaultUrl)
      const { body: compactBody } = await fetchBadge(page, compactUrl)

      expect(getSvgWidth(compactBody)).toBeGreaterThan(0)
      expect(getSvgWidth(compactBody)).toBeLessThan(getSvgWidth(defaultBody))
    })

    test('compact style does not trim a user-supplied label', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/2.18.1...4.3.1?style=compact&label=my-deps`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('>my-deps<')
      expect(body).not.toContain('>deps<')
    })

    test('compact style uses package name when name=true', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/2.18.1...4.3.1?style=compact&name=true`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('>nuxt<')
      expect(body).not.toContain('>deps<')
      expect(body).not.toContain('>dependencies<')
    })
  })

  test.describe('arrow alignment', () => {
    test('arrow is wrapped in a dy-shifted tspan so it sits on the digit center', async ({
      page,
      baseURL,
    }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/2.18.1...4.3.1`,
      )
      const { body } = await fetchBadge(page, url)

      // Without the wrap, the arrow sits below the digits' visual middle
      // (it renders near the math axis at this font size). The renderer
      // therefore wraps it in a `dy="-1"` tspan and the trailing segment in
      // a `dy="1"` tspan so the digits stay on the parent baseline.
      expect(body).toMatch(/<tspan[^>]*\sdy="-1">→<\/tspan>/)
      expect(body).toMatch(/<tspan[^>]*\sdy="1">/)
    })

    test('aria-label keeps the raw arrow without tspan markup for screen readers', async ({
      page,
      baseURL,
    }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/2.18.1...4.3.1`,
      )
      const { body } = await fetchBadge(page, url)

      const aria = getAriaLabel(body)
      expect(aria).not.toContain('tspan')
      expect(aria).toContain(`15 ${ARROW} 57`)
    })
  })

  test.describe('cross-package compare', () => {
    test('renders raw from/to values without package names', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/4.3.1/vs/next/v/15.5.11`,
      )
      const { response, body } = await fetchBadge(page, url)

      expect(response.status()).toBe(200)
      expect(body).toContain('>dependencies<')
      expect(getAriaLabel(body)).toContain(`57 ${ARROW} 5`)
      // Package names live in the URL and aria-label only — they should not
      // be embedded in the rendered value.
      expect(getAriaLabel(body)).not.toContain('nuxt 57')
      expect(getAriaLabel(body)).not.toContain('next 5')
    })

    test('version cross-pkg shows both raw versions only', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/version/nuxt/v/4.3.1/vs/next/v/15.5.11`,
      )
      const { body } = await fetchBadge(page, url)

      expect(getAriaLabel(body)).toContain(`v4.3.1 ${ARROW} v15.5.11`)
      expect(getAriaLabel(body)).not.toContain('nuxt v4.3.1')
    })

    test('directional color uses delta of cross-pkg counts', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/4.3.1/vs/next/v/15.5.11`,
      )
      const { body } = await fetchBadge(page, url)

      // 57 → 5 is a clear shrink, so the value side should render green.
      expect(body).toContain('fill="#22c55e"')
    })

    test('license compare across packages with same license stays green', async ({
      page,
      baseURL,
    }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/license/nuxt/v/4.3.1/vs/next/v/15.5.11`,
      )
      const { body } = await fetchBadge(page, url)

      expect(getAriaLabel(body)).toContain(`MIT ${ARROW} MIT`)
      expect(body).toContain('fill="#22c55e"')
    })

    test('engines compare across packages goes yellow when ranges differ', async ({
      page,
      baseURL,
    }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/engines/nuxt/v/4.3.1/vs/next/v/15.5.11`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('>node<')
      expect(body).toContain('fill="#eab308"')
    })

    test('scoped → unscoped cross-pkg renders successfully', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/@nuxt/kit/v/3.21.0/vs/next/v/15.5.11`,
      )
      const { response, body } = await fetchBadge(page, url)

      expect(response.status()).toBe(200)
      const aria = getAriaLabel(body)
      expect(aria).toContain(ARROW)
      // The aria-label uses the strategy label (e.g. "dependencies"), not
      // the package names — which are only in the URL.
      expect(aria).not.toContain('@nuxt/kit')
      expect(aria).not.toContain('next')
    })

    test('name=true on cross-pkg shows "{pkgA} → {pkgB}" as the label', async ({
      page,
      baseURL,
    }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/4.3.1/vs/next/v/15.5.11?name=true`,
      )
      const { body } = await fetchBadge(page, url)

      // The label carries both names like a regular `name=true` badge would
      // carry the single package name; the value still has no names in it.
      expect(getAriaLabel(body)).toMatch(/^nuxt → next:/)
      expect(getAriaLabel(body)).toContain(`57 ${ARROW} 5`)
      expect(getAriaLabel(body)).not.toContain('nuxt 57')
      expect(body).not.toContain('>dependencies<')
    })

    test('cross-pkg with vs but missing version on one side returns 400', async ({
      page,
      baseURL,
    }) => {
      const url = toLocalUrl(baseURL, `/api/registry/badge/compare/version/nuxt/vs/next/v/15.5.11`)
      const { response } = await fetchBadge(page, url)

      expect(response.status()).toBe(400)
    })

    test('cross-pkg with non-existent package returns 404 or 502', async ({ page, baseURL }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/version/nuxt/v/4.3.1/vs/this-package-does-not-exist-zzzzz/v/1.0.0`,
      )
      const { response } = await fetchBadge(page, url)

      // Non-existent npm packages bubble up as the npm fetch error path.
      expect([404, 502]).toContain(response.status())
    })
  })

  test.describe('customization', () => {
    test('custom label parameter is applied', async ({ page, baseURL }) => {
      const customLabel = 'compare-version'
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/version/nuxt/v/2.18.1...4.3.1?label=${customLabel}`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain(customLabel)
    })

    test('custom value parameter is applied', async ({ page, baseURL }) => {
      const customValue = 'much-faster-now'
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/version/nuxt/v/2.18.1...4.3.1?value=${encodeURIComponent(customValue)}`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain(customValue)
    })

    test('custom color parameter overrides directional color', async ({ page, baseURL }) => {
      const customColor = 'ff69b4'
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/dependencies/nuxt/v/2.18.1...4.3.1?color=${customColor}`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain(`fill="#${customColor}"`)
    })

    test('custom labelColor parameter is applied', async ({ page, baseURL }) => {
      const customColor = '00ff00'
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/version/nuxt/v/2.18.1...4.3.1?labelColor=${customColor}`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain(`fill="#${customColor}"`)
    })

    test('name=true replaces the strategy label with the package name', async ({
      page,
      baseURL,
    }) => {
      const url = toLocalUrl(
        baseURL,
        `/api/registry/badge/compare/version/nuxt/v/2.18.1...4.3.1?name=true`,
      )
      const { body } = await fetchBadge(page, url)

      expect(body).toContain('>nuxt<')
      expect(body).not.toContain('>version<')
    })
  })
})
