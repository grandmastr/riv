import { createRoot } from 'react-dom/client';

import App from './App';
import './style.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Missing side panel root element.');
}

createRoot(container).render(<App />);
