export function deriveName(urlStr) {
  try {
    const u = new URL(urlStr)
    const host = u.host.replace(/^www\./, "")
    const path = u.pathname.replace(/\/+/g, "_").replace(/^_+|_+$/g, "")
    const last = path || ""
    const queryHint = u.searchParams.size ? "_q" : ""
    const raw = [host, last].filter(Boolean).join("_") + queryHint
    return raw.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-")
  } catch {
    return "capture"
  }
}
