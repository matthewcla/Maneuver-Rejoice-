import React from 'react';
import ReactDOM from 'react-dom/client';
import { CanvasView } from './ui/CanvasView.js';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <CanvasView />
  </React.StrictMode>
);
