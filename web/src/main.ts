import './style.css';
import { startShell } from './platform/shell';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('missing #app');

startShell(root);
