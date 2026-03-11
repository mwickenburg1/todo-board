import { useEffect, useState } from 'react'

/**
 * Full-page evening overlay — CSS-only waves for smooth GPU-accelerated animation.
 * No SVGs. Uses pseudo-element-style layered gradients + CSS transforms.
 */
export function EveningOverlay({ active }: { active: boolean }) {
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

  if (!mounted) return null

  return (
    <div
      className="fixed inset-0 z-50 select-none overflow-hidden"
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.8s ease-in-out',
      }}
    >
      {/* Base gradient — full viewport warm evening wash */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(180deg, rgb(18,14,28) 0%, rgb(28,18,22) 25%, rgb(38,20,18) 55%, rgb(45,22,14) 100%)',
        }}
      />

      {/* Wave layers — CSS border-radius blobs, GPU-accelerated transforms */}
      <div className="evening-wave" style={{
        bottom: '-5%', height: '55%',
        background: 'linear-gradient(180deg, rgba(180,80,20,0) 0%, rgba(160,65,15,0.14) 50%, rgba(120,40,10,0.22) 100%)',
        borderRadius: '45% 55% 50% 50% / 100% 100% 0% 0%',
        animation: 'wave-sway-1 25s ease-in-out infinite',
      }} />
      <div className="evening-wave" style={{
        bottom: '-8%', height: '48%',
        background: 'linear-gradient(180deg, rgba(200,100,40,0) 0%, rgba(180,75,30,0.10) 50%, rgba(150,55,20,0.18) 100%)',
        borderRadius: '50% 48% 52% 48% / 100% 100% 0% 0%',
        animation: 'wave-sway-2 19s ease-in-out infinite',
      }} />
      <div className="evening-wave" style={{
        bottom: '-6%', height: '40%',
        background: 'linear-gradient(180deg, rgba(180,60,80,0) 0%, rgba(160,50,60,0.07) 50%, rgba(130,40,45,0.14) 100%)',
        borderRadius: '52% 48% 50% 50% / 100% 100% 0% 0%',
        animation: 'wave-sway-3 22s ease-in-out infinite',
      }} />
      <div className="evening-wave" style={{
        bottom: '-4%', height: '30%',
        background: 'linear-gradient(180deg, rgba(150,50,20,0) 0%, rgba(140,45,15,0.12) 50%, rgba(100,30,10,0.20) 100%)',
        borderRadius: '48% 52% 50% 50% / 100% 100% 0% 0%',
        animation: 'wave-sway-4 17s ease-in-out infinite',
      }} />

      {/* Upper atmosphere — faint cool waves hanging from top */}
      <div className="evening-wave" style={{
        top: '-8%', height: '35%',
        background: 'linear-gradient(0deg, rgba(60,30,80,0) 0%, rgba(50,25,65,0.05) 50%, rgba(40,20,55,0.08) 100%)',
        borderRadius: '50% 50% 48% 52% / 0% 0% 100% 100%',
        animation: 'wave-sway-5 28s ease-in-out infinite',
      }} />
      <div className="evening-wave" style={{
        top: '-5%', height: '50%',
        background: 'linear-gradient(0deg, rgba(80,40,60,0) 0%, rgba(70,32,50,0.04) 60%, rgba(55,25,40,0.07) 100%)',
        borderRadius: '48% 52% 55% 45% / 0% 0% 100% 100%',
        animation: 'wave-sway-6 24s ease-in-out infinite',
      }} />

      {/* Mid-screen bridge wave */}
      <div className="evening-wave" style={{
        bottom: '10%', height: '60%',
        background: 'linear-gradient(180deg, rgba(120,55,40,0) 0%, rgba(110,50,35,0.05) 40%, rgba(90,40,25,0.10) 100%)',
        borderRadius: '50% 50% 52% 48% / 100% 100% 0% 0%',
        animation: 'wave-sway-7 26s ease-in-out infinite',
      }} />

      {/* Floating orbs */}
      <div className="evening-orb" style={{
        width: 400, height: 400, top: '8%', right: '5%',
        background: 'radial-gradient(circle, rgba(80,40,70,0.06) 0%, transparent 70%)',
        animation: 'orb-drift-1 22s ease-in-out infinite',
      }} />
      <div className="evening-orb" style={{
        width: 300, height: 300, bottom: '15%', left: '8%',
        background: 'radial-gradient(circle, rgba(220,120,40,0.07) 0%, transparent 70%)',
        animation: 'orb-drift-2 18s ease-in-out infinite',
      }} />
      <div className="evening-orb" style={{
        width: 350, height: 350, top: '35%', left: '25%',
        background: 'radial-gradient(circle, rgba(160,80,50,0.04) 0%, transparent 70%)',
        animation: 'orb-drift-3 20s ease-in-out infinite',
      }} />

      {/* Evening copy */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center gap-3"
        style={{ animation: 'gentle-pulse 4s ease-in-out infinite' }}
      >
        <span className="text-[28px] font-extralight tracking-[0.12em]"
          style={{ color: 'rgba(235,185,130,0.55)' }}>
          wind down &middot; recharge &middot; max out tomorrow AM
        </span>
        <span className="text-[12px] font-light tracking-[0.3em] uppercase"
          style={{ color: 'rgba(200,150,100,0.28)' }}>
          disconnected
        </span>
      </div>

      <style>{`
        .evening-wave {
          position: absolute;
          left: -10%;
          width: 120%;
          will-change: transform;
        }
        .evening-orb {
          position: absolute;
          border-radius: 50%;
          will-change: transform;
        }
        @keyframes wave-sway-1 {
          0%, 100% { transform: translateX(0) scaleX(1); }
          50% { transform: translateX(-4%) scaleX(1.03); }
        }
        @keyframes wave-sway-2 {
          0%, 100% { transform: translateX(2%) scaleX(1); }
          50% { transform: translateX(-3%) scaleX(0.97); }
        }
        @keyframes wave-sway-3 {
          0%, 100% { transform: translateX(-1%) scaleX(1.01); }
          50% { transform: translateX(3%) scaleX(0.98); }
        }
        @keyframes wave-sway-4 {
          0%, 100% { transform: translateX(1%) scaleX(1); }
          50% { transform: translateX(-2%) scaleX(1.02); }
        }
        @keyframes wave-sway-5 {
          0%, 100% { transform: translateX(0) scaleX(1); }
          50% { transform: translateX(-3%) scaleX(1.02); }
        }
        @keyframes wave-sway-6 {
          0%, 100% { transform: translateX(1%) scaleX(1); }
          50% { transform: translateX(-2%) scaleX(0.98); }
        }
        @keyframes wave-sway-7 {
          0%, 100% { transform: translateX(-1%) scaleX(1); }
          50% { transform: translateX(2%) scaleX(1.01); }
        }
        @keyframes orb-drift-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-20px, 15px) scale(1.08); }
          66% { transform: translate(15px, -10px) scale(0.94); }
        }
        @keyframes orb-drift-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(25px, -15px) scale(1.05); }
          70% { transform: translate(-15px, 10px) scale(0.92); }
        }
        @keyframes orb-drift-3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          45% { transform: translate(-18px, -20px) scale(1.06); }
          75% { transform: translate(12px, 15px) scale(0.95); }
        }
        @keyframes gentle-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}
