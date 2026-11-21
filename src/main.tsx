import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/tokens.css';
import './ui/app.css';
import { App } from './ui/App';
import { seedDemo } from './testkit/seedDemo';

// Tester helper: ?seedDemo=1 fills a fresh profile before the first paint.
seedDemo();

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
