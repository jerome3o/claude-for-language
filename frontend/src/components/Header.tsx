import { Link } from 'react-router-dom';

export function Header() {
  return (
    <header className="header">
      <div className="container header-content">
        <Link to="/" className="header-title">
          汉语学习
        </Link>
        <nav className="header-nav">
          <Link to="/">Home</Link>
          <Link to="/decks">Decks</Link>
          <Link to="/study">Study</Link>
          <Link to="/generate">AI Generate</Link>
        </nav>
      </div>
    </header>
  );
}
