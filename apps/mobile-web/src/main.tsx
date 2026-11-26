import './polyfills';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ChainProvider } from './state/ChainProvider';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { reportClientError } from './services/errorReporter';
import './styles.css';

window.addEventListener('error', event => reportClientError(event.error || event.message, 'window-error'));
window.addEventListener('unhandledrejection', event => reportClientError(event.reason, 'unhandled-rejection'));

// ChainProvider owns one long-lived Graphene WebSocket. React StrictMode's
// development-only mount probe would start and tear down that socket twice,
// racing the second connection and leaving the API ids unset.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <AppErrorBoundary><ChainProvider><App /></ChainProvider></AppErrorBoundary>
  </BrowserRouter>,
);
