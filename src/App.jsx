import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import SignIn from './pages/SignIn';
import SignUp from './pages/SignUp';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import VerifyEmail from './pages/VerifyEmail';
import TwoFactor from './pages/TwoFactor';
import Welcome from './pages/Welcome';
import Settings from './pages/Settings';
import Sessions from './pages/Sessions';
import Projects from './pages/Projects';
import ProjectWorkspace from './pages/ProjectWorkspace';
import Console from './pages/Console';
import Activity from './pages/Activity';
import Confirmed from './pages/Confirmed';
import Billing from './pages/Billing';
import Domains from './pages/Domains';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/2fa" element={<TwoFactor />} />
        <Route path="/welcome" element={<Welcome />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id/workspace" element={<ProjectWorkspace />} />
        <Route path="/console" element={<Console />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/confirmed" element={<Confirmed />} />
        <Route path="/billing" element={<Billing />} />
        <Route path="/domains" element={<Domains />} />
      </Routes>
    </BrowserRouter>
  );
}
