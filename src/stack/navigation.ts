// Module-level flags for cross-component communication

// Flag to distinguish arrow-nav entry from click entry
export let _arrowNav = false
export function setArrowNav(v: boolean) { _arrowNav = v }
export function consumeArrowNav(): boolean {
  if (_arrowNav) { _arrowNav = false; return true }
  return false
}

// Auto-focus a newly created item after split/insert
let _pendingFocusId: number | null = null
export function setPendingFocus(id: number) { _pendingFocusId = id }
export function consumePendingFocus(id: number): boolean {
  if (id && id === _pendingFocusId) { _pendingFocusId = null; return true }
  return false
}

// 4-direction navigation using data-nav-* attributes
export function navigateFrom(currentEl: HTMLElement, direction: 'up' | 'down' | 'left' | 'right') {
  const section = currentEl.closest<HTMLElement>('[data-nav-section]')?.dataset.navSection
    || currentEl.dataset.navSection
  const col = currentEl.dataset.navCol || currentEl.closest<HTMLElement>('[data-nav-col]')?.dataset.navCol
  const rawIdx = currentEl.dataset.navIdx || currentEl.closest<HTMLElement>('[data-nav-idx]')?.dataset.navIdx || '-1'
  const idx = parseInt(rawIdx)

  if (!section) return

  const allNav = Array.from(document.querySelectorAll<HTMLElement>('[data-nav-col]'))
  const sections = [...new Set(allNav.map(el => el.dataset.navSection).filter(Boolean))] as string[]
  const sectionIdx = sections.indexOf(section)

  if (direction === 'up') {
    navigateUp(allNav, sections, sectionIdx, section, col, idx, rawIdx)
  } else if (direction === 'down') {
    navigateDown(allNav, sections, sectionIdx, section, col, idx, rawIdx)
  } else if (direction === 'left' && col === 'waiting') {
    const items = allNav.filter(el => el.dataset.navSection === section && el.dataset.navCol === 'actionable')
    const target = items[Math.min(idx, items.length - 1)]
    if (target) clickNav(target)
  } else if (direction === 'right' && col === 'actionable') {
    const items = allNav.filter(el => el.dataset.navSection === section && el.dataset.navCol === 'waiting')
    const target = items[Math.min(idx, items.length - 1)]
    if (target) clickNav(target)
  }
}

function navigateUp(allNav: HTMLElement[], sections: string[], sectionIdx: number, section: string, col: string | undefined, idx: number, rawIdx: string) {
  if (col === 'header') {
    if (sectionIdx > 0) {
      const prevSection = sections[sectionIdx - 1]
      const prevItems = allNav.filter(el => el.dataset.navSection === prevSection && el.dataset.navCol === 'actionable')
      const target = prevItems.length > 0 ? prevItems[prevItems.length - 1] : allNav.find(el => el.dataset.navSection === prevSection && el.dataset.navCol === 'header')
      if (target) clickNav(target)
    }
  } else if (rawIdx === 'capture') {
    // From capture input: go to last numbered item in same column
    const colItems = allNav.filter(el => el.dataset.navSection === section && el.dataset.navCol === col && el.dataset.navIdx !== undefined && el.dataset.navIdx !== 'capture')
    if (colItems.length > 0) {
      clickNav(colItems[colItems.length - 1])
    } else {
      const header = allNav.find(el => el.dataset.navSection === section && el.dataset.navCol === 'header')
      if (header) clickNav(header)
    }
  } else if (idx === 0) {
    const header = allNav.find(el => el.dataset.navSection === section && el.dataset.navCol === 'header')
    if (header) clickNav(header)
  } else {
    const target = allNav.find(el => el.dataset.navSection === section && el.dataset.navCol === col && el.dataset.navIdx === String(idx - 1))
    if (target) clickNav(target)
  }
}

function navigateDown(allNav: HTMLElement[], sections: string[], sectionIdx: number, section: string, col: string | undefined, idx: number, rawIdx: string) {
  if (col === 'header') {
    const target = allNav.find(el => el.dataset.navSection === section && el.dataset.navCol === 'actionable' && el.dataset.navIdx === '0')
    if (target) clickNav(target)
  } else if (rawIdx === 'capture') {
    // From capture: go to next section's header
    if (sectionIdx < sections.length - 1) {
      const nextSection = sections[sectionIdx + 1]
      const header = allNav.find(el => el.dataset.navSection === nextSection && el.dataset.navCol === 'header')
      if (header) clickNav(header)
    }
  } else {
    const target = allNav.find(el => el.dataset.navSection === section && el.dataset.navCol === col && el.dataset.navIdx === String(idx + 1))
    if (target) {
      clickNav(target)
    } else {
      // No next item: try capture input at bottom of column
      const capture = allNav.find(el => el.dataset.navSection === section && el.dataset.navCol === col && el.dataset.navIdx === 'capture')
      if (capture) {
        clickNav(capture)
      } else if (sectionIdx < sections.length - 1) {
        const nextSection = sections[sectionIdx + 1]
        const header = allNav.find(el => el.dataset.navSection === nextSection && el.dataset.navCol === 'header')
        if (header) clickNav(header)
      }
    }
  }
}

function clickNav(el: HTMLElement) {
  _arrowNav = true
  if (el.dataset.navCol === 'header') {
    const h2 = el.querySelector<HTMLElement>('h2.cursor-text')
    if (h2) h2.click()
    else el.click()
  } else if (el.dataset.navIdx === 'capture') {
    const input = el.querySelector<HTMLInputElement>('input')
    if (input) input.focus()
  } else {
    const textSpan = el.querySelector<HTMLElement>('span.cursor-text')
    if (textSpan) textSpan.click()
  }
}
