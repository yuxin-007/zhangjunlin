import React from 'react'

export default function Header() {
  return (
    <header className="top-nav" aria-label="Main navigation">
      <a className="brand" href="#" aria-label="Advanced Corp home">
        <span className="brand-star">✶</span>
        <span>Advanced Corp.</span>
      </a>

      <nav className="nav-links">
        <a href="#pricing">Pricing</a>
        <a href="#about">About moss</a>
        <a href="#login">Login</a>
      </nav>

      <button className="menu-button" aria-label="Open menu">
        <span />
        <span />
        <span />
      </button>
    </header>
  )
}
