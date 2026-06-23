import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'antd/dist/reset.css';
import { AppRoot } from './app/AppRoot.js';
import { TeamManagerThemeProvider } from './theme/ThemeProvider.js';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <TeamManagerThemeProvider>
        <AppRoot />
      </TeamManagerThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);
