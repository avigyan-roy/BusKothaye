import { Link } from 'react-router-dom';
import { Header } from '../components/Header.js';
import { en } from '../content/en.js';
import { site } from '../config/site.js';

export function NotFoundPage() {
  return (
    <>
      <Header />
      <main className="page stack" style={{ maxWidth: 520 }}>
        <h1>{en.errors.notFoundTitle}</h1>
        <p className="muted">{en.errors.notFoundBody}</p>
        <Link className="button" to={`/r/${site.defaultRouteId}`}>
          {en.errors.goToRoute}
        </Link>
      </main>
    </>
  );
}
