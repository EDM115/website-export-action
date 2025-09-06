export async function expandContent(page) {
  await page.evaluate(() => {
    // Expand all <details>
    document.querySelectorAll("details").forEach((d) => {
      try {
        d.open = true
      } catch {}
    })

    // Click generic "show more" buttons if present
    const clickPhrases = [
      "show more",
      "show all",
      "view more",
      "read more",
      "load more",
      "expand",
      "afficher plus",
      "lire la suite",
      "voir plus",
      "mehr anzeigen",
      "mehr lesen",
      "ver más",
      "leer más",
      "cargar más",
      "mostra di più",
      "leggi di più",
    ]
    const candidates = Array.from(
      document.querySelectorAll("button,[role=button],a"),
    )
    candidates.forEach((el) => {
      const t = (el.innerText || el.ariaLabel || "").toLowerCase().trim()
      if (t && clickPhrases.some((p) => t.includes(p))) {
        try {
          el.click()
        } catch {}
      }
      if (el.getAttribute && el.getAttribute("aria-expanded") === "false") {
        try {
          el.click()
        } catch {}
      }
    })
  })
}
