import { useEffect } from 'react';

export default function useSeo({ title, noindex = false, description }) {
  useEffect(() => {
    if (title) document.title = title;

    let descriptionTag = null;
    let previousDescription = null;
    if (description) {
      descriptionTag = document.querySelector('meta[name="description"]');
      if (!descriptionTag) {
        descriptionTag = document.createElement('meta');
        descriptionTag.setAttribute('name', 'description');
        document.head.appendChild(descriptionTag);
      }
      previousDescription = descriptionTag.getAttribute('content');
      descriptionTag.setAttribute('content', description);
    }

    let tag = document.querySelector('meta[name="robots"]');
    if (!tag) {
      tag = document.createElement('meta');
      tag.setAttribute('name', 'robots');
      document.head.appendChild(tag);
    }
    const previous = tag.getAttribute('content');
    tag.setAttribute('content', noindex ? 'noindex, nofollow' : 'index, follow');

    return () => {
      if (previous) tag.setAttribute('content', previous);
      if (descriptionTag && previousDescription) descriptionTag.setAttribute('content', previousDescription);
    };
  }, [title, noindex, description]);
}
