import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Landing from './pages/Landing';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import TwoFactor from './pages/TwoFactor';
import Welcome from './pages/Welcome';
import Settings from './pages/Settings';
import Projects from './pages/Projects';
import ProjectCollaborationOverlay from './components/ProjectCollaborationOverlay';
import Console from './pages/Console';
import Confirmed from './pages/Confirmed';
import Billing from './pages/Billing';
import Domains from './pages/Domains';
import Help from './pages/Help';
import Admin from './pages/Admin';
import Suspended from './pages/Suspended';
import SuspensionGate from './components/SuspensionGate';
import ProjectInvite from './pages/ProjectInvite';

function LegacySettingsRedirect() {
  const location = useLocation();
  const legacyTab = location.pathname.replace(/^\/settings\/?/, '').split('/')[0];
  if (legacyTab === 'api') return <Navigate to="/console" replace />;
  const tabMap = { profile: 'profile', security: 'security', sessions: 'sessions', activity: 'activity', logs: 'activity' };
  return <Navigate to={`/account/${tabMap[legacyTab] || 'profile'}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <SuspensionGate />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/2fa" element={<TwoFactor />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/settings" element={<Navigate to="/account/profile" replace />} />
        <Route path="/settings/*" element={<LegacySettingsRedirect />} />
        <Route path="/account" element={<Navigate to="/account/profile" replace />} />
        <Route path="/account/profile" element={<Settings />} />
        <Route path="/account/security" element={<Settings />} />
        <Route path="/account/sessions" element={<Settings />} />
        <Route path="/account/activity" element={<Settings />} />
        <Route path="/sessions" element={<Navigate to="/account/sessions" replace />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id/workspace" element={<ProjectCollaborationOverlay />} />
        <Route path="/invite/:token" element={<ProjectInvite />} />
        <Route path="/console" element={<Console />} />
        <Route path="/activity" element={<Navigate to="/account/activity" replace />} />
        <Route path="/confirmed" element={<Confirmed />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/store" element={<Navigate to="/billing" replace />} />
        <Route path="/domains" element={<Domains />} />
        <Route path="/help" element={<Help />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/suspended" element={<Suspended />} />
      </Routes>
    </BrowserRouter>
  );
}