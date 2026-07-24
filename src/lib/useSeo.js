import { useEffect } from 'react';

export default function useSeo({ title, noindex = false }) {
  useEffect(() => {
    if (title) document.title = title;

    let tag = document.querySelector('meta[name="robots"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'robots');
      document.head.appendChild(tag);
    }
    const previous = tag.getAttribute('content');
    tag.setAttribute('content', noindex ? 'noindex, nofollow' : 'index, follow');

    return () => { if (previous) tag.setAttribute('content', previous); };
  }, [title, noindex]);
}
