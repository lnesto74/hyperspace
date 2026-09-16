import React from 'react';
import ReactDOM from 'react-dom/client';
import ClienteMedioDashboard from './features/businessReporting/esselunga/clienteMedio/ClienteMedioDashboard';
import type { DailyKpiPayload } from './features/businessReporting/dailyKpi/types';
import fixture from './features/businessReporting/esselunga/clienteMedio/fixtures/daily_kpi_2026-09-14.json';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClienteMedioDashboard payload={fixture as unknown as DailyKpiPayload} venueName="Treviglio" />
  </React.StrictMode>,
);
