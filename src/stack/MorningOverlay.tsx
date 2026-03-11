import { useEffect, useState } from 'react'

/**
 * Morning overlay — sunrise gradient with energizing copy.
 * Dismissed with Cmd+Shift+D to start the day.
 */
export function MorningOverlay({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (active) {
      setMounted(true)
      requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)))
    } else {
      setVisible(false)
      const t = setTimeout(() => setMounted(false), 800)
      return () => clearTimeout(t)
    }
  }, [active])

  useEffect(() => {
    if (!active) return
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        onDismiss()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [active, onDismiss])

  if (!mounted) return null

  return (
    <div
      className="fixed inset-0 z-50 select-none overflow-hidden cursor-pointer"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.8s ease-in-out',
      }}
      onClick={onDismiss}
    >
      {/* Base gradient — cool dawn to warm gold */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgb(12,18,35) 0%, rgb(18,28,55) 20%, rgb(35,45,75) 40%, rgb(55,50,65) 60%, rgb(75,55,45) 80%, rgb(85,60,35) 100%)',
        }}
      />

      {/* Wave layers — sunrise tones */}
      <div className="morning-wave" style={{
        bottom: '-5%', height: '55%',
        background: 'linear-gradient(180deg, rgba(255,160,60,0) 0%, rgba(255,140,50,0.12) 50%, rgba(220,100,30,0.20) 100%)',
        borderRadius: '45% 55% 50% 50% / 100% 100% 0% 0%',
        animation: 'mwave-1 25s ease-in-out infinite',
      }} />
      <div className="morning-wave" style={{
        bottom: '-8%', height: '45%',
        background: 'linear-gradient(180deg, rgba(255,180,80,0) 0%, rgba(255,160,60,0.08) 50%, rgba(240,120,40,0.15) 100%)',
        borderRadius: '50% 48% 52% 48% / 100% 100% 0% 0%',
        animation: 'mwave-2 19s ease-in-out infinite',
      }} />
      <div className="morning-wave" style={{
        bottom: '-6%', height: '35%',
        background: 'linear-gradient(180deg, rgba(255,200,120,0) 0%, rgba(255,180,90,0.06) 50%, rgba(250,150,60,0.12) 100%)',
        borderRadius: '52% 48% 50% 50% / 100% 100% 0% 0%',
        animation: 'mwave-3 22s ease-in-out infinite',
      }} />
      <div className="morning-wave" style={{
        bottom: '-4%', height: '25%',
        background: 'linear-gradient(180deg, rgba(255,220,150,0) 0%, rgba(255,200,120,0.10) 50%, rgba(240,170,80,0.18) 100%)',
        borderRadius: '48% 52% 50% 50% / 100% 100% 0% 0%',
        animation: 'mwave-4 17s ease-in-out infinite',
      }} />

      {/* Upper atmosphere — cool blue dawn */}
      <div className="morning-wave" style={{
        top: '-8%', height: '35%',
        background: 'linear-gradient(0deg, rgba(60,100,180,0) 0%, rgba(50,80,150,0.06) 50%, rgba(40,65,130,0.10) 100%)',
        borderRadius: '50% 50% 48% 52% / 0% 0% 100% 100%',
        animation: 'mwave-5 28s ease-in-out infinite',
      }} />
      <div className="morning-wave" style={{
        top: '-5%', height: '50%',
        background: 'linear-gradient(0deg, rgba(80,120,200,0) 0%, rgba(65,95,170,0.04) 60%, rgba(50,75,140,0.07) 100%)',
        borderRadius: '48% 52% 55% 45% / 0% 0% 100% 100%',
        animation: 'mwave-6 24s ease-in-out infinite',
      }} />

      {/* Mid bridge */}
      <div className="morning-wave" style={{
        bottom: '10%', height: '60%',
        background: 'linear-gradient(180deg, rgba(180,120,80,0) 0%, rgba(160,100,60,0.05) 40%, rgba(140,80,45,0.09) 100%)',
        borderRadius: '50% 50% 52% 48% / 100% 100% 0% 0%',
        animation: 'mwave-7 26s ease-in-out infinite',
      }} />

      {/* Orbs — sunrise glow */}
      <div className="morning-orb" style={{
        width: 400, height: 400, bottom: '5%', right: '10%',
        background: 'radial-gradient(circle, rgba(255,160,60,0.08) 0%, transparent 70%)',
        animation: 'morb-1 22s ease-in-out infinite',
      }} />
      <div className="morning-orb" style={{
        width: 350, height: 350, top: '15%', left: '10%',
        background: 'radial-gradient(circle, rgba(80,120,200,0.06) 0%, transparent 70%)',
        animation: 'morb-2 18s ease-in-out infinite',
      }} />
      <div className="morning-orb" style={{
        width: 300, height: 300, top: '40%', right: '20%',
        background: 'radial-gradient(circle, rgba(200,140,80,0.05) 0%, transparent 70%)',
        animation: 'morb-3 20s ease-in-out infinite',
      }} />

      {/* Morning copy */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-4"
        style={{ animation: 'morning-pulse 4s ease-in-out infinite' }}
      >
        <span className="text-[30px] font-extralight tracking-[0.12em]"
          style={{ color: 'rgba(255,210,140,0.55)' }}>
          peak &middot; don't waste it
        </span>
        <span className="text-[12px] font-light tracking-[0.3em] uppercase"
          style={{ color: 'rgba(180,200,240,0.25)' }}>
          &#8984;&#8679;D to start
        </span>
      </div>

      <style>{`
        .morning-wave {
          position: absolute;
          left: -10%;
          width: 120%;
          will-change: transform;
        }
        .morning-orb {
          position: absolute;
          border-radius: 50%;
          will-change: transform;
        }
        @keyframes mwave-1 {
          0%, 100% { transform: translateX(0) scaleX(1); }
          50% { transform: translateX(-4%) scaleX(1.03); }
        }
        @keyframes mwave-2 {
          0%, 100% { transform: translateX(2%) scaleX(1); }
          50% { transform: translateX(-3%) scaleX(0.97); }
        }
        @keyframes mwave-3 {
          0%, 100% { transform: translateX(-1%) scaleX(1.01); }
          50% { transform: translateX(3%) scaleX(0.98); }
        }
        @keyframes mwave-4 {
          0%, 100% { transform: translateX(1%) scaleX(1); }
          50% { transform: translateX(-2%) scaleX(1.02); }
        }
        @keyframes mwave-5 {
          0%, 100% { transform: translateX(0) scaleX(1); }
          50% { transform: translateX(-3%) scaleX(1.02); }
        }
        @keyframes mwave-6 {
          0%, 100% { transform: translateX(1%) scaleX(1); }
          50% { transform: translateX(-2%) scaleX(0.98); }
        }
        @keyframes mwave-7 {
          0%, 100% { transform: translateX(-1%) scaleX(1); }
          50% { transform: translateX(2%) scaleX(1.01); }
        }
        @keyframes morb-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-20px, -15px) scale(1.08); }
          66% { transform: translate(15px, 10px) scale(0.94); }
        }
        @keyframes morb-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(20px, -12px) scale(1.05); }
          70% { transform: translate(-12px, 15px) scale(0.92); }
        }
        @keyframes morb-3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          45% { transform: translate(-15px, -18px) scale(1.06); }
          75% { transform: translate(10px, 12px) scale(0.95); }
        }
        @keyframes morning-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
