import { Route, Routes } from 'react-router-dom';
import { RoutePage } from '../pages/RoutePage.js';
import { DrivePage } from '../pages/DrivePage.js';
import { OpsPage } from '../pages/OpsPage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';
import { AccountPage } from '../pages/AccountPage.js';
import { DemoConsolePage } from '../pages/DemoConsolePage.js';
import { AdminLoginPage } from '../pages/AdminLoginPage.js';
import { HomePage } from '../pages/HomePage.js';
import { RouteAdminPage } from '../pages/RouteAdminPage.js';

/**
 * Three screens and a not-found page. `/` goes straight to the useful map — there
 * is no landing page in between, because a person opening this app wants to know
 * where the bus is.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/r/:routeId" element={<RoutePage />} />
      <Route path="/drive" element={<DrivePage />} />
      <Route path="/account" element={<AccountPage />} />
      <Route path="/admin" element={<AdminLoginPage />} />
      <Route path="/admin/routes" element={<RouteAdminPage />} />
      <Route path="/demo" element={<DemoConsolePage />} />
      <Route path="/ops/:journeyId" element={<OpsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
