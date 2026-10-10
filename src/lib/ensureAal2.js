import { createElement, useCallback, useRef, useState } from 'react';
import { Button, Input } from '../components/ui';
import { supabase } from './supabase';

export function useEnsureAal2() {
  const [open, setOpen] = useState(false);
  const [factorId, setFactorId] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resolver = useRef(null);

  const ensureAal2 = useCallback(async () => {
    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance?.currentLevel !== 'aal1' || assurance?.nextLevel !== 'aal2') return true;

    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const factor = factors?.totp?.find((item) => item.status === 'verified');
    if (!factor) throw new Error('Two-factor verification is required, but no verified authenticator was found.');

    setFactorId(factor.id);
    setCode('');
    setError('');
    setOpen(true);
    return new Promise((resolve) => { resolver.current = resolve; });
  }, []);

  const verify = useCallback(async () => {
    if (!factorId || code.length !== 6 || busy) return;
    setBusy(true);
    setError('');
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (verifyError) {
      setError(verifyError.message || 'That code could not be verified. Try again.');
      return;
    }
    setOpen(false);
    resolver.current?.(true);
    resolver.current = null;
    setCode('');
  }, [factorId, code, busy]);

  const cancel = useCallback(() => {
    setOpen(false);
    resolver.current?.(false);
    resolver.current = null;
    setCode('');
    setError('');
  }, []);

  return {
    ensureAal2,
    modal: createElement(Aal2CodeModal, {
      open, code, error, busy,
      onCodeChange: (value) => setCode(value.replace(/\D/g, '').slice(0, 6)),
      onVerify: verify,
      onCancel: cancel,
    }),
  };
}

function Aal2CodeModal({ open, code, error, busy, onCodeChange, onVerify, onCancel }) {
  if (!open) return null;
  return createElement('div', { className: 'mt-4 rounded-xl border border-kxpurple/30 bg-kxpurple/5 p-4' },
    createElement('h3', { className: 'text-sm font-semibold' }, 'Verify it’s you'),
    createElement('p', { className: 'text-[12.5px] text-kxmist mt-1 mb-3' },
      'Enter the 6-digit code from your authenticator app to continue.'),
    createElement(Input, {
      label: 'Authenticator code',
      value: code,
      onChange: (event) => onCodeChange(event.target.value),
      inputMode: 'numeric',
      autoComplete: 'one-time-code',
      maxLength: 6,
      placeholder: '000000',
    }),
    error && createElement('p', { role: 'alert', className: 'text-[12px] text-red-400 mt-2' }, error),
    createElement('div', { className: 'flex gap-2 mt-3' },
      createElement(Button, {
        type: 'button', variant: 'glow', onClick: onVerify,
        loading: busy, disabled: code.length !== 6 || busy,
      }, 'Verify'),
      createElement(Button, {
        type: 'button', variant: 'subtle', onClick: onCancel, disabled: busy,
      }, 'Cancel')
    )
  );
}
