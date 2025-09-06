import path from "node:path"
import fs from "fs-extra"
import TurndownService from "turndown"

async function captureMHTML(page) {
  const cdp = await page.target().createCDPSession()
  // Page.captureSnapshot "mhtml" includes external resources + iframes
  const { data } = await cdp.send("Page.captureSnapshot", { format: "mhtml" })
  return data
}

async function htmlAfterMods(page) {
  return await page.evaluate(
    () => "<!doctype html>\n" + document.documentElement.outerHTML,
  )
}

// Optional: best-effort assets dump for "raw" alongside a static HTML snapshot.
async function dumpAssetsAndRewrite(html, outDir) {
  // Collect candidates
  const urls = new Set()
  const re = /<(?:link|script|img)\b[^>]*(?:href|src)="([^"]+)"/gi
  let m
  while ((m = re.exec(html))) {
    const u = m[1]
    if (/^data:|^mailto:|^tel:/i.test(u)) continue
    urls.add(u)
  }

  const assetsDir = path.join(outDir, "assets")
  await fs.ensureDir(assetsDir)

  const map = new Map()

  // Use Node 18+ global fetch
  for (const u of urls) {
    try {
      const urlObj = new URL(u, "http://base.invalid") // will be resolved later
    } catch {
      // leave unresolved relative; we'll resolve at write time using placeholder
    }
  }

  // We can't resolve relative without the original page URL inside this function.
  // We'll instead rewrite at read time using <base> tag we inject.
  return { htmlWithBase: html, assetsDir, map }
}

export async function doExports(page, { format, baseName, outDir, tmpDir }) {
  const lower = format.toLowerCase()
  let finalPath = ""

  if (["png", "jpg", "jpeg", "webp"].includes(lower)) {
    const type = lower === "jpg" ? "jpeg" : lower === "jpeg" ? "jpeg" : lower
    finalPath = path.join(
      outDir,
      `${baseName}.${lower === "jpeg" ? "jpg" : lower}`,
    )
    await page.screenshot({
      path: finalPath,
      fullPage: true,
      type,
      quality: type === "jpeg" || type === "webp" ? 85 : undefined,
    })
    return { finalName: path.basename(finalPath), finalPath }
  }

  if (lower === "pdf") {
    finalPath = path.join(outDir, `${baseName}.pdf`)
    await page.pdf({
      path: finalPath,
      printBackground: true,
      preferCSSPageSize: true,
    })
    return { finalName: path.basename(finalPath), finalPath }
  }

  if (lower === "md") {
    const html = await htmlAfterMods(page)
    const turndown = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
    })
    // Keep tables and images; add simple rule to preserve <pre>
    turndown.addRule("pre", {
      filter: ["pre"],
      replacement: (content) =>
        "```\n" + content.replace(/^\n+/, "").replace(/\n+$/, "") + "\n```",
    })
    const md = turndown.turndown(html)
    finalPath = path.join(outDir, `${baseName}.md`)
    await fs.writeFile(finalPath, md, "utf8")
    return { finalName: path.basename(finalPath), finalPath }
  }

  if (lower === "raw") {
    // 1) MHTML snapshot (captures iframes + external resources)
    const mhtml = await captureMHTML(page)
    const mhtmlPath = path.join(outDir, `${baseName}.mhtml`)
    await fs.writeFile(mhtmlPath, mhtml, "utf8")

    // 2) Also dump a static HTML snapshot of the DOM after expansions/cleanup
    let html = await htmlAfterMods(page)

    // Inject a <base> so relative assets can still resolve to the live origin when opened offline
    const origin = await page.evaluate(() => location.origin)
    if (!html.includes("<base")) {
      html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${origin}/">`)
    }
    const htmlPath = path.join(outDir, `${baseName}.html`)
    await fs.writeFile(htmlPath, html, "utf8")

    // Return primary as the MHTML (full-fidelity) path
    return { finalName: path.basename(mhtmlPath), finalPath: mhtmlPath }
  }

  throw new Error(`Unsupported format : ${format}`)
}
