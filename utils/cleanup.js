// Heuristic cookie/overlay handling across frames + CSS nuking
export async function applyCleanup(page, { level }) {
  // 1) Try to click obvious consent buttons in all frames
  const phrases = [
    // EN
    "accept all",
    "accept",
    "agree",
    "i agree",
    "allow all",
    "allow",
    "reject all",
    "reject",
    "deny",
    "decline",
    "consent",
    "got it",
    "ok",
    "okay",
    "close",
    "no thanks",
    // FR
    "tout accepter",
    "accepter",
    "refuser",
    "tout refuser",
    "paramètres des cookies",
    "continuer sans accepter",
    // DE
    "alle akzeptieren",
    "akzeptieren",
    "ablehnen",
    "zustimmen",
    // ES
    "aceptar todo",
    "aceptar",
    "rechazar",
    "rechazar todo",
    // IT
    "accetta tutto",
    "accetta",
    "rifiuta",
    "rifiuta tutto",
    // PT
    "aceitar tudo",
    "aceitar",
    "rejeitar",
    "rejeitar tudo",
  ]
  const selCandidates = [
    "button",
    "[role=button]",
    "input[type=button]",
    "input[type=submit]",
    "a",
    "[data-testid],[data-test]",
  ]

  async function clickInFrame(frame) {
    try {
      for (const s of selCandidates) {
        const handles = await frame.$$(s)
        for (const h of handles) {
          const txt = (
            await frame.evaluate(
              (el) => el.innerText || el.value || el.ariaLabel || "",
              h,
            )
          ).toLowerCase()
          if (!txt) continue
          if (phrases.some((p) => txt.includes(p))) {
            try {
              await h.click({ delay: 10 })
            } catch {}
          }
        }
      }
    } catch {}
  }

  // top frame + iframes
  await clickInFrame(page.mainFrame())
  for (const f of page.mainFrame().childFrames()) {
    await clickInFrame(f)
  }

  // 2) CSS nuke common overlays/banners if still visible
  if (level !== "off") {
    await page.addStyleTag({
      content: `
      /* common cookie/consent/banner/popup selectors */
      [id*="cookie"],[class*="cookie"],
      [id*="consent"],[class*="consent"],
      [id*="gdpr"],[class*="gdpr"],
      [id*="banner"],[class*="banner"],
      [class*="overlay"],[class*="popover"],[class*="modal"],[id*="modal"],
      [class*="subscribe"],[id*="subscribe"],
      [class*="newsletter"],[id*="newsletter"] {
        display: none !important; visibility: hidden !important; opacity: 0 !important;
      }
      body { overflow: auto !important; }
    `,
    })
  }
}
