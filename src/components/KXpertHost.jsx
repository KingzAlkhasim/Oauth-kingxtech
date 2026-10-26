import { useEffect, useSyncExternalStore } from 'react';
import KXpertDrawer from './KXpertDrawer';

/**
 * K-XpertAI lives here, once, above the routes, so it survives navigation:
 * you can open the drawer, click around the site, and the chat (and any run in
 * progress) stays open. Pages that use DashboardShell call useKXpertShell() to
 * say "show the drawer on this page"; other pages (login, landing) don't.
 */
let shells = 0;
let visible = false;
const listeners = new Set();

function publish() {
  // Microtask: when navigating, the old page unmounts and the new one mounts in the
  // same commit; waiting a tick means we never flash "no shell" in between.
  queueMicrotask(() => {
    const next = shells > 0;
    if (next === visible) return;
    visible = next;
    listeners.forEach((l) => l());
  });
}

export function useKXpertShell() {
  useEffect(() => {
    shells += 1;
    publish();
    return () => { shells -= 1; publish(); };
  }, []);
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const getSnapshot = () => visible;

export default function KXpertHost() {
  const show = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return show ? <KXpertDrawer /> : null;
}
