import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'antd/dist/reset.css';
import { AppRoot } from './app/AppRoot.js';
import { TeamManagerThemeProvider } from './theme/ThemeProvider.js';
import './styles.css';

const RrwebDevTools = import.meta.env.DEV
  ? React.lazy(async () => ({ default: (await import('./devtools/RrwebDevTools.js')).RrwebDevTools }))
  : null;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <TeamManagerThemeProvider>
        <AppRoot />
        {RrwebDevTools && (
          <React.Suspense fallback={null}>
            <RrwebDevTools />
          </React.Suspense>
        )}
      </TeamManagerThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
