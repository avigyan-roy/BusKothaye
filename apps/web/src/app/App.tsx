import { Navigate, Route, Routes } from 'react-router-dom';
import { RoutePage } from '../pages/RoutePage.js';
import { DrivePage } from '../pages/DrivePage.js';
import { OpsPage } from '../pages/OpsPage.js';
import { NotFoundPage } from '../pages/NotFoundPage.js';
import { site } from '../config/site.js';

/**
 * Three screens and a not-found page. `/` goes straight to the useful map — there
 * is no landing page in between, because a person opening this app wants to know
 * where the bus is.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/r/${site.defaultRouteId}`} replace />} />
      <Route path="/r/:routeId" element={<RoutePage />} />
      <Route path="/drive" element={<DrivePage />} />
      <Route path="/ops/:journeyId" element={<OpsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
