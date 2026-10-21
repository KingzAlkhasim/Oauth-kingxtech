import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getMyAccountStatus } from '../lib/account';

// Public pages stay open; everything signed-in redirects suspended accounts to /suspended.
const OPEN_PATHS = ['/', '/login', '/signup', '/forgot-password', '/reset-password', '/verify-email', '/confirmed', '/suspended', '/restored', '/terms', '/help'];

export default function SuspensionGate() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (OPEN_PATHS.includes(location.pathname)) return undefined;
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session || !alive) return;
      const status = await getMyAccountStatus();
      if (!alive) return;
      if (status.suspended) navigate('/suspended', { replace: true });
      else if (status.restoredNotice) navigate('/restored', { replace: true });
    });
    return () => { alive = false; };
  }, [location.pathname, navigate]);

  return null;
}
