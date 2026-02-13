import type { EnvSlotInfo, EnvStatusRemote } from './types'

const ENV_ORDER = ['env1', 'env2', 'env3', 'env4', 'env5', 'env6', 'env7', 'env8', 'sync']

export function EnvStatusBar({ envSlots, remoteStatus }: {
  envSlots: Record<string, EnvSlotInfo>
  remoteStatus: Record<string, EnvStatusRemote>
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-gray-100 px-6 py-2 z-50">
      <div className="max-w-5xl mx-auto flex gap-3 text-[10px]">
        {ENV_ORDER.map(slot => {
          const info = envSlots[slot]
          const remote = remoteStatus[`vm1/${slot}`] || remoteStatus[`vm2/${slot}`]
          const isActive = info?.item !== null || remote

          return (
            <div
              key={slot}
              className={`flex items-center gap-1.5 ${isActive ? 'text-gray-600' : 'text-gray-300'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-400' : 'bg-gray-200'}`} />
              <span className="font-medium uppercase">{slot}</span>
              {info?.item && (
                <span className="text-gray-400 truncate max-w-[60px]">{info.item.text}</span>
              )}
              {remote && !info?.item && (
                <span className="text-gray-400 truncate max-w-[60px]">{remote.branch || remote.status}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
