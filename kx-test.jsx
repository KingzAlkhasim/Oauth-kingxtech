import './src/index.css';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import DashboardShell from './src/components/DashboardShell';
import KXpertHost from './src/components/KXpertHost';
const P = (t) => () => <DashboardShell><h1 id="page">{t}</h1></DashboardShell>;
createRoot(document.getElementById('r')).render(<MemoryRouter initialEntries={['/projects']}><KXpertHost /><Routes><Route path="/projects" element={<>{P('Projects page')()}</>} /><Route path="/billing" element={<>{P('Billing page')()}</>} /><Route path="/" element={<div id="landing">landing</div>} /></Routes></MemoryRouter>);
