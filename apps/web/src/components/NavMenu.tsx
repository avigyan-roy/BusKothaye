import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { en } from '../content/en.js';
import { site } from '../config/site.js';
import { api } from '../lib/api.js';
import { clearAccountSession, loadAccountSession } from '../lib/auth-session.js';
import { MapControlButton, icons } from './MapControlButton.js';
import './nav-menu.css';

/**
 * Everything that is not the map, kept off the map.
 *
 * The map screen has no header, so this is where the rest of the application
 * lives. It is a native `<dialog>` rather than a hand-built overlay: the browser
 * already gives a modal dialog Escape-to-close, a focus trap, inert content
 * behind it and focus returning to the button that opened it. None of that is
 * worth reimplementing.
 */
export function NavMenu({ onOpenRoutes }: { onOpenRoutes: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [account, setAccount] = useState(() => loadAccountSession());

  useEffect(() => {
    const refresh = () => setAccount(loadAccountSession());
    window.addEventListener('buskothay-account-changed', refresh);
    return () => window.removeEventListener('buskothay-account-changed', refresh);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  const close = () => setIsOpen(false);

  const signOut = async () => {
    const token = account?.token;
    close();
    if (token !== undefined) await api.logout(token).catch(() => undefined);
    clearAccountSession();
  };

  return (
    <>
      <MapControlButton
        label={en.nav.openMenu}
        icon={icons.menu}
        onClick={() => setIsOpen(true)}
        expanded={isOpen}
        controls="app-menu"
      />
      <dialog
        id="app-menu"
        ref={dialogRef}
        className="nav-menu"
        aria-label={en.nav.menuLabel}
        onClose={() => setIsOpen(false)}
        /* A click on the backdrop lands on the dialog element itself. */
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
      >
        <div className="nav-menu__head">
          <span className="nav-menu__wordmark">{site.name}</span>
          <MapControlButton label={en.common.close} icon={icons.close} onClick={close} />
        </div>

        <nav aria-label={en.nav.menuLabel}>
          <ul className="nav-menu__list">
            <li>
              <Link className="nav-menu__item" to={`/r/${site.defaultRouteId}`} onClick={close}>
                {en.nav.map}
              </Link>
            </li>
            <li>
              <button
                type="button"
                className="nav-menu__item"
                onClick={() => {
                  close();
                  onOpenRoutes();
                }}
              >
                {en.nav.routes}
              </button>
            </li>
            <li>
              <Link className="nav-menu__item" to={site.drivePath} onClick={close}>
                {en.nav.drive}
              </Link>
            </li>
            {account?.account.isAdmin === true ? (
              <li>
                <Link className="nav-menu__item" to="/demo" onClick={close}>
                  {en.nav.demo}
                </Link>
              </li>
            ) : null}
            <li>
              <Link className="nav-menu__item" to="/account" onClick={close}>
                {account === null ? en.nav.signIn : account.account.username}
                {account === null ? null : (
                  <span className="nav-menu__hint">
                    {account.account.isAdmin === true
                      ? en.account.administrator
                      : en.account.roles[account.account.role]}
                  </span>
                )}
              </Link>
            </li>
            {account === null ? null : (
              <li>
                <button type="button" className="nav-menu__item" onClick={() => void signOut()}>
                  {en.account.logout}
                </button>
              </li>
            )}
          </ul>
        </nav>
      </dialog>
    </>
  );
}
