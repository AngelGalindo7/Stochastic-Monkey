import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium } from 'playwright'
import { startFixtureServer, stopFixtureServer } from './fixture-server.mjs'
import { pruneLayout } from '../../src/perception/a11yTree.js'

let fixtureServer, fixtureUrl

beforeAll(async () => {
  const result = await startFixtureServer()
  fixtureServer = result.server
  fixtureUrl = result.url
}, 30000)

afterAll(async () => {
  if (fixtureServer) await stopFixtureServer(fixtureServer)
})

// Playwright 1.44+ removed page.accessibility; use CDP to get the AX tree and
// pipe through pruneLayout from a11yTree.js to exercise the same snapshot path.
async function snapshotViaPlaywright(browser, page) {
  const context = page.context()
  const cdp = await context.newCDPSession(page)
  const { nodes } = await cdp.send('Accessibility.getFullAXTree')
  await cdp.detach()

  // Build a minimal role/name tree compatible with pruneLayout's input shape
  const nodeMap = new Map(nodes.map(n => [n.nodeId, n]))
  function build(node) {
    if (!node) return null
    return {
      role: node.role?.value ?? 'generic',
      name: node.name?.value ?? '',
      children: (node.childIds ?? []).map(id => build(nodeMap.get(id))).filter(Boolean),
    }
  }
  const root = nodes[0]
  return pruneLayout(build(root))
}

describe('integration smoke', () => {
  it('crawls clean fixture without fatal error', async () => {
    const browser = await chromium.launch({ headless: true })
    const pageErrors = []

    try {
      const context = await browser.newContext()
      const page = await context.newPage()
      page.on('pageerror', e => pageErrors.push(e.message))

      await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' })

      const snapshot = await snapshotViaPlaywright(browser, page)

      expect(snapshot).not.toBeNull()
      expect(typeof snapshot).toBe('object')
      expect(snapshot).toHaveProperty('role')

      await page.goto(fixtureUrl + '/about.html', { waitUntil: 'domcontentloaded' })
      expect(pageErrors.filter(m => m.includes('500'))).toHaveLength(0)
    } finally {
      await browser.close()
    }
  }, 20000)

  it('detects JS error on error.html via PAGEERROR signal', async () => {
    const browser = await chromium.launch({ headless: true })
    const pageErrors = []

    try {
      const context = await browser.newContext()
      const page = await context.newPage()
      page.on('pageerror', e => pageErrors.push(e.message))

      await page.goto(fixtureUrl + '/error.html', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(500)

      expect(pageErrors.length).toBeGreaterThan(0)
      expect(pageErrors[0]).toContain('test-pageerror')
    } finally {
      await browser.close()
    }
  }, 20000)
})
