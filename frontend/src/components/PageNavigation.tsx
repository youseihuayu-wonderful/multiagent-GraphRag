import { useEffect, useState } from 'react'
import {
  Blocks,
  ChevronDown,
  FlaskConical,
  GitFork,
  Home,
  Menu,
  Play,
  Terminal,
  Workflow,
} from 'lucide-react'

const NAVIGATION = [
  { id: 'top', label: 'Overview', group: 'Start', icon: Home },
  { id: 'playground', label: 'Live workbench', group: 'Start', icon: Play },
  { id: 'scenarios', label: 'Examples + checks', group: 'Explore', icon: FlaskConical },
  { id: 'build', label: 'Build pipeline', group: 'Understand', icon: Workflow },
  { id: 'agents', label: 'Agent workflow', group: 'Understand', icon: GitFork },
  { id: 'concepts', label: 'Core concepts', group: 'Reference', icon: Blocks },
  { id: 'api', label: 'API examples', group: 'Reference', icon: Terminal },
] as const

function NavigationLinks({ activeId, onNavigate }: { activeId: string; onNavigate?: () => void }) {
  return (
    <ol className="page-nav__list">
      {NAVIGATION.map((item, index) => {
        const Icon = item.icon
        const showGroup = index === 0 || NAVIGATION[index - 1].group !== item.group

        return (
          <li key={item.id}>
            {showGroup ? <span className="page-nav__group">{item.group}</span> : null}
            <a
              href={`#${item.id}`}
              className={activeId === item.id ? 'page-nav__link page-nav__link--active' : 'page-nav__link'}
              aria-current={activeId === item.id ? 'location' : undefined}
              onClick={onNavigate}
            >
              <span className="page-nav__index">{String(index + 1).padStart(2, '0')}</span>
              <Icon size={15} aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          </li>
        )
      })}
    </ol>
  )
}

export function PageNavigation() {
  const [activeId, setActiveId] = useState('top')
  const [progress, setProgress] = useState(0)
  const activeItem = NAVIGATION.find((item) => item.id === activeId) ?? NAVIGATION[0]

  useEffect(() => {
    const sections = NAVIGATION.map((item) => document.getElementById(item.id)).filter(
      (section): section is HTMLElement => section !== null,
    )

    let animationFrame: number | undefined
    const updateNavigation = () => {
      if (animationFrame !== undefined) return
      animationFrame = window.requestAnimationFrame(() => {
        const marker = window.innerHeight * 0.3
        let currentSection = sections[0]
        let closestTop = Number.NEGATIVE_INFINITY
        for (const section of sections) {
          const sectionTop = section.getBoundingClientRect().top
          if (sectionTop <= marker && sectionTop > closestTop) {
            currentSection = section
            closestTop = sectionTop
          }
        }
        if (currentSection) setActiveId(currentSection.id)

        const scrollable = document.documentElement.scrollHeight - window.innerHeight
        setProgress(scrollable > 0 ? Math.min(100, (window.scrollY / scrollable) * 100) : 0)
        animationFrame = undefined
      })
    }
    updateNavigation()
    window.addEventListener('scroll', updateNavigation, { passive: true })
    window.addEventListener('resize', updateNavigation)

    return () => {
      if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('scroll', updateNavigation)
      window.removeEventListener('resize', updateNavigation)
    }
  }, [])

  function closeMobileNavigation() {
    document.querySelector<HTMLDetailsElement>('.mobile-page-nav[open]')?.removeAttribute('open')
  }

  return (
    <>
      <aside className="page-nav" aria-label="Page sections">
        <div className="page-nav__header">
          <span>System map</span>
          <strong>{String(NAVIGATION.findIndex((item) => item.id === activeId) + 1).padStart(2, '0')} / {NAVIGATION.length}</strong>
        </div>
        <NavigationLinks activeId={activeId} />
        <div className="page-nav__progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <p>{Math.round(progress)}% explored</p>
      </aside>

      <details className="mobile-page-nav">
        <summary>
          <span><Menu size={17} aria-hidden="true" /> {activeItem.label}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </summary>
        <nav aria-label="Page sections">
          <NavigationLinks activeId={activeId} onNavigate={closeMobileNavigation} />
        </nav>
      </details>
    </>
  )
}
