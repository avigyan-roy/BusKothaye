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
import { ResultsPage } from '../pages/ResultsPage.js';
import { BusPage } from '../pages/BusPage.js';

/**
 * The passenger path is four screens, and each one is a URL.
 *
 *   /              where are you, and which way do you want to search
 *   /find          every bus from one stop to another
 *   /bus/:code     one route: which direction, then when it reaches you
 *   /r/:routeId    the details screen — map, progress and every stop
 *
 * Every piece of state a screen needs is in its own address, so refreshing,
 * sharing a link, opening one directly, and the browser's own back and forward
 * buttons all behave the way they do on any other website.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/find" element={<ResultsPage />} />
      <Route path="/bus/:code" element={<BusPage />} />
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
