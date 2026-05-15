import React from 'react'
import Header from './components/Header'
import HeroTitle from './components/HeroTitle'
import HeroVisual from './components/HeroVisual'
import CornerMark from './components/CornerMark'

export default function App() {
  return (
    <main className="page-shell">
      <div className="page-frame">
        <Header />
        <HeroTitle />
        <HeroVisual />
        <CornerMark />
      </div>
    </main>
  )
}
