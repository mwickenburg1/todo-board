import { useState } from 'react'
import BoardView from './BoardView'
import StackView from './StackView'

function App() {
  const [view, setView] = useState<'board' | 'stack'>(() => {
    return (localStorage.getItem('todo-view') as 'board' | 'stack') || 'stack'
  })

  const switchView = () => {
    const next = view === 'board' ? 'stack' : 'board'
    localStorage.setItem('todo-view', next)
    setView(next)
  }

  if (view === 'stack') {
    return <StackView onSwitchView={switchView} />
  }

  return <BoardView onSwitchView={switchView} />
}

export default App
