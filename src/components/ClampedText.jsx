import { useEffect, useRef, useState } from 'react';

// Shows long text as 2 lines with a "See more" toggle. The toggle only appears when the
// text is really cut off, so short descriptions don't get a pointless link.
export default function ClampedText({ text, lines = 2, className = '' }) {
  const ref = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => {
      if (!expanded) setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [text, expanded, lines]);

  if (!text) return null;
  const clampStyle = expanded
    ? undefined
    : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines, overflow: 'hidden' };

  return (
    <div>
      <p ref={ref} style={clampStyle} className={`${className} break-words whitespace-pre-line`}>{text}</p>
      {(overflowing || expanded) && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="min-h-11 inline-flex items-center text-[12.5px] text-kxblue hover:text-white"
        >
          {expanded ? 'See less' : 'See more'}
        </button>
      )}
    </div>
  );
}
