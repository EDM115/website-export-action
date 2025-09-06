import * as core from "@actions/core"
import path from "node:path"
import fs from "fs-extra"
import { fileURLToPath } from "node:url"
import {
  computeExecutablePath,
  install,
  Browser,
  resolveBuildId,
  detectBrowserPlatform,
} from "@puppeteer/browsers"
import puppeteer from "puppeteer-core"

import { deriveName } from "./utils/name.js"
import { applyCleanup } from "./utils/cleanup.js"
import { expandContent } from "./utils/expand.js"
import { doExports } from "./utils/export.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function ensureChrome() {
  // Allow override
  if (
    process.env.CHROME_PATH &&
    (await fs.pathExists(process.env.CHROME_PATH))
  ) {
    return process.env.CHROME_PATH
  }

  // Try compute from local cache; if missing, install Stable
  const platform = detectBrowserPlatform()
  const buildId = await resolveBuildId(Browser.CHROME, platform, "stable")
  const cacheDir = path.join(
    process.env.RUNNER_TEMP || path.join(__dirname, ".cache"),
    "puppeteer-browsers",
  )

  try {
    const exe = computeExecutablePath({
      browser: Browser.CHROME,
      buildId,
      cacheDir,
      platform,
    })
    if (await fs.pathExists(exe)) return exe
  } catch {}

  core.info(
    `Chrome not found in cache. Installing chrome@stable with @puppeteer/browsers...`,
  )
  await install({ browser: Browser.CHROME, buildId, cacheDir, platform })
  const exe = computeExecutablePath({
    browser: Browser.CHROME,
    buildId,
    cacheDir,
    platform,
  })
  core.info(`Chrome installed at : ${exe}`)
  return exe
}

function input(name, def) {
  const v = core.getInput(name, { required: def === undefined })
  return v || def
}

;(async () => {
  const url = input("webpage")
  const clean = input("clean", "banners") // off | banners | complete
  const format = input("format")
  const customName = input("name", "")

  const outDir = process.env.GITHUB_WORKSPACE || process.cwd()
  const baseName = customName || deriveName(url)
  const tmpDir = path.join(outDir, `.capture-${Date.now()}`)
  await fs.ensureDir(tmpDir)

  const chromePath = await ensureChrome()

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    defaultViewport: { width: 1366, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--disable-gpu",
    ],
  })

  let filename = ""
  let absPath = ""

  try {
    const page = await browser.newPage()

    // If "complete", block obvious ad/track/trash hosts at network level
    if (clean === "complete") {
      const BLOCK = [
        /doubleclick\.net/i,
        /googlesyndication\.com/i,
        /adservice\.google\.com/i,
        /adsystem\.com/i,
        /adnxs\.com/i,
        /criteo\.com/i,
        /taboola\.com/i,
        /outbrain\.com/i,
        /facebook\.net/i,
        /connect\.facebook\.net/i,
        /quantserve\.com/i,
        /moatads\.com/i,
        /scorecardresearch\.com/i,
        /zedo\.com/i,
        /rubiconproject\.com/i,
        /1rx\.io/i,
      ]
      await page.route("**/*", (route) => {
        const url = route.request().url()
        if (BLOCK.some((rx) => rx.test(url))) return route.abort()
        route.continue()
      })
    }

    page.setDefaultNavigationTimeout(120000)
    page.setDefaultTimeout(60000)

    // Navigate and wait for network idle first paint
    await page.goto(url, {
      waitUntil: ["load", "domcontentloaded", "networkidle0"],
    })

    // First pass cleanup (plugin handles many cases)
    if (clean !== "off") {
      await applyCleanup(page, { level: clean })
    }

    // Some CMPs trigger a reload - wait again if it happens
    const navPromise = new Promise((resolve) => {
      let navigated = false
      page.on("framenavigated", () => {
        navigated = true
      })
      // resolve after a short grace period
      setTimeout(() => resolve(navigated), 4000)
    })
    const didReload = await navPromise
    if (didReload) {
      await page.waitForNetworkIdle({ idleTime: 1500, timeout: 45000 })
      await applyCleanup(page, { level: clean })
    }

    // Expand <details>, "show more", etc.
    await expandContent(page)

    // Lazy-load/scroll listeners : step 200px with small waits
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      let y = 0
      const step = 200
      const max = Math.max(
        document.body.scrollHeight,
        document.documentElement.scrollHeight,
      )
      while (y < max - innerHeight) {
        window.scrollTo(0, y)
        await sleep(120)
        y += step
      }
      window.scrollTo(0, max)
      await sleep(300)
    })
    await page.waitForNetworkIdle({ idleTime: 1200, timeout: 30000 })

    // Export
    const { finalName, finalPath } = await doExports(page, {
      format,
      baseName,
      outDir,
      tmpDir,
    })
    filename = finalName
    absPath = finalPath

    core.setOutput("name", filename)
    core.setOutput("path", absPath)
    core.info(`✅ Exported ${filename} at ${absPath}`)
  } catch (err) {
    core.setFailed(err.message || String(err))
  } finally {
    await browser.close()
    await fs.remove(tmpDir).catch(() => {})
  }
})()
